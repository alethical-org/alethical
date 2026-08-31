"""Load Minnesota's lobbying principal-expenditure download as dated snapshots that replace, not merge.

Net: download the Board's "Principal expenditures - 2009 - Present" file whole, keep
its exact bytes, check the new set against the one already published, and publish by
replacing the previous set entirely. Never merge rows into an existing table.

This exists because *The Money Only Goes One Way* states $886 million of lobbying
spending across 3,056 organisations, summed from this file's rows — and we held none of
the records behind it, so it was the only cross-member figure we publish that no
recompute of ours protects (#1862). Once loaded, that figure recomputes from a pinned
snapshot like every other figure we publish.

It is its own pipeline rather than a 4th slot in ``campaign_finance.py``: lobbying
comes from a different landing page on a different filing cycle (annual, due 15 March),
nothing joins it to the campaign-finance sets day-for-day, and ``cf_release``'s
3-named-columns shape deliberately cannot grow a 4th. The step structure mirrors that
module's, simplified to one dataset with no release table — the snapshot is the
release, and a single-row pointer names the live one, the way
``campaign_finance_filings.py`` does it.

What §2.2 of ``docs/architecture/campaign-finance-system-design.md`` measures about
this source, and this module leans on:

* 9 columns; ``Report Year`` is the calendar year the money was SPENT, not filed.
* ``Total spent`` equals the sum of the 5 type columns on every row (blank read as 0).
* 0 duplicate (Entity ID, Report Year) pairs, and a 1:1 name-to-id mapping.
* 48 rows carry no amounts at all — blank is "not reported", never 0.
* 2 downloads a minute apart returned byte-identical files on 31 Aug 2026, unlike the
  shuffling campaign-finance exports. The record-set hash still decides "did the data
  change", because 2 fetches of 1 file are not a property of the source.
* A stale download number answers HTTP 200 with an HTML error page, so the
  ``Content-Disposition`` filename and an exact header-line match are what catch a
  wrong file.
"""

from __future__ import annotations

import csv
import hashlib
import html
import os
import re
import tempfile
import time
import uuid
from dataclasses import dataclass, field
from datetime import UTC, datetime
from decimal import Decimal, InvalidOperation
from typing import Any, Iterable, Optional

import requests
from sqlalchemy import delete, func, select, text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from alethical.db import models as schema

# Byte-identical jobs share one definition with the campaign-finance loader: the
# deterministic gzip (mtime=0 AND filename="" are both load-bearing), the
# length-prefixed record fingerprint (a separator join lets 2 different records
# collide), and the band arithmetic. Their reasons live on their own docstrings.
from alethical.pipeline.campaign_finance import Band, _record_fingerprint, gzip_to
from alethical.pipeline.http_text import response_text

SnapshotStatus = schema.CampaignFinanceSnapshotStatus

LANDING_PAGE = "https://cfb.mn.gov/reports-and-data/self-help/data-downloads/lobbying/"
USER_AGENT = "Alethical Lobbying Ingest/0.1 (+https://alethical.com)"
# The file is 1.5 MB; the generous timeout costs nothing on the happy path.
DOWNLOAD_TIMEOUT_SECONDS = 600
LANDING_PAGE_TIMEOUT_SECONDS = 60
MAX_ATTEMPTS = 3
RETRY_PAUSE_SECONDS = 5
COPY_CHUNK_BYTES = 1 << 20

# One key for the whole publish, so two overlapping imports queue instead of
# colliding. Transaction-scoped, because production connects through Supabase's
# transaction pooler. Deliberately distinct from campaign_finance.py's ...010 and
# campaign_finance_filings.py's ...011: the pipelines take different locks on purpose.
PUBLISH_LOCK_KEY = 610312263012

# One spare generation, same reason as the campaign-finance loader: a reader resolves
# the live snapshot in one statement and asks for rows in the next, so deleting the
# previous set the instant a new one lands hands that request zero rows. One
# generation of this file is about 2 MB of rows.
KEEP_SUPERSEDED_GENERATIONS = 1

FOUR_DIGIT_YEAR = re.compile(r"^\d{4}$")
# `-?\d+`, never `\d+`: the download numbers are signed and the file we want is
# negative (-728390027), so a pattern that drops the minus sign resolves a
# different file.
DOWNLOAD_LINK = re.compile(r'href="([^"]*\?download=(-?\d+))"')
TAG = re.compile(r"<[^>]+>")

MAX_REPORTED_ROW_ERRORS = 5

# What the landing page calls the file. The heading is matched against the <h1>
# above each table, lowercased; the row label against the row's first cell — the
# same heading also carries a "Principal expenditures - 2020 only" row, which is a
# strict subset of this file and must not be resolved in its place.
HEADING = "principal expenditures"
ROW_LABEL = "principal expenditures - 2009 - present"
# Must appear in the download's Content-Disposition filename. The full served name
# on 31 Aug 2026: "Principal Expenditures - 2009 - Present - Principal Expenditures
# - Lobbying.csv". "2009 - Present" is in the marker so the 2020-only file can
# never pass for it.
DISPOSITION_MARKER = "Principal Expenditures - 2009 - Present"

# The header line is pinned as a contract in code rather than learned from the
# first import, exactly like the campaign-finance loader's. A test asserts it
# parses to exactly the column list below.
HEADER_LINE = (
    'Principal,"Entity ID","Report Year","PUC lobbying amount",'
    '"Legislative lobbying amount","Administrative lobbying amount",'
    '"MGU lobbying amount","General lobbying amount","Total spent"'
)


@dataclass(frozen=True)
class Column:
    source: str
    attribute: str
    # "text" keeps the value exactly as printed; "money" is numeric(18,4);
    # "year" is a 4-digit integer.
    kind: str = "text"


COLUMNS: tuple[Column, ...] = (
    Column("Principal", "principal"),
    # Text exactly as printed, like every registration number in this repo.
    Column("Entity ID", "entity_id"),
    Column("Report Year", "report_year", "year"),
    Column("PUC lobbying amount", "puc_lobbying_amount", "money"),
    Column("Legislative lobbying amount", "legislative_lobbying_amount", "money"),
    Column("Administrative lobbying amount", "administrative_lobbying_amount", "money"),
    Column("MGU lobbying amount", "mgu_lobbying_amount", "money"),
    Column("General lobbying amount", "general_lobbying_amount", "money"),
    Column("Total spent", "total_spent", "money"),
)

ATTRIBUTES: tuple[str, ...] = tuple(column.attribute for column in COLUMNS)
MONEY_SOURCES: tuple[str, ...] = tuple(
    column.source for column in COLUMNS if column.kind == "money"
)

# --- How much movement is too much ------------------------------------------
#
# These bands are a guess and are stated as one, sized to this file's annual
# rhythm rather than the campaign-finance files' daily one: reports are due
# 15 March, so the file sits still most of the year and then gains roughly one
# year's filings — about 1,300 rows (7%) and $90 million (10%) on the 31 Aug 2026
# measurements. Growth quarantines as well as shrinkage, because a file duplicated
# end to end passes every check that only watches for a fall. A legitimate annual
# jump that lands outside these is published by an operator naming the record-set
# hash they reviewed.

ROW_COUNT_BAND = Band(shrink=0.005, growth=0.12)
BYTE_SIZE_BAND = Band(shrink=0.01, growth=0.15)
TOTAL_SPENT_BAND = Band(shrink=0.01, growth=0.20)
# Past years are nearly static, so a year losing rows is the sharpest truncation
# signal there is. The floor keeps a year holding a handful of rows from tripping
# on normal noise.
YEAR_ROW_LOSS_FRACTION = 0.01
YEAR_ROW_LOSS_FLOOR = 25


# --- Results ----------------------------------------------------------------


@dataclass
class Check:
    name: str
    # "passed" | "failed" | "not_run" | "overridden".
    status: str
    detail: str

    @property
    def blocks_publication(self) -> bool:
        return self.status == "failed"

    def as_json(self) -> dict:
        return {"name": self.name, "status": self.status, "detail": self.detail}


@dataclass
class Measurements:
    row_count: int = 0
    record_set_hash: str = ""
    column_names: list[str] = field(default_factory=list)
    total_spent_sum: Decimal = Decimal("0")
    # Across all 6 money columns. 0 on every measured file, so movement is signal.
    negative_amount_sum: Decimal = Decimal("0")
    distinct_row_count: int = 0
    distinct_entity_count: int = 0
    duplicate_entity_year_count: int = 0
    total_mismatch_count: int = 0
    entity_ids_with_multiple_names_count: int = 0
    names_with_multiple_entity_ids_count: int = 0
    rows_by_report_year: dict[str, int] = field(default_factory=dict)
    blank_counts_by_column: dict[str, int] = field(default_factory=dict)
    malformed_quote_record_count: int = 0
    errors: list[str] = field(default_factory=list)


@dataclass
class FetchedFile:
    download_id: str
    requested_url: str
    final_url: str
    path: str
    byte_size: int
    content_hash: str
    disposition_filename: Optional[str]
    response_headers: dict[str, str]
    started_at: datetime
    completed_at: datetime
    content_error: Optional[str] = None


@dataclass
class Outcome:
    fetched: FetchedFile
    # Minted before the parse so the COPY file can carry it. Becomes the snapshot's
    # real id when these records are new, and is discarded when they are not.
    candidate_snapshot_id: uuid.UUID = field(default_factory=uuid.uuid4)
    snapshot_id: Optional[uuid.UUID] = None
    measurements: Optional[Measurements] = None
    checks: list[Check] = field(default_factory=list)
    unchanged: bool = False
    reused_rows: bool = False
    copy_path: Optional[str] = None

    @property
    def blocked(self) -> list[Check]:
        return [check for check in self.checks if check.blocks_publication]

    @property
    def copy_file_matches_snapshot(self) -> bool:
        """Whether this run's COPY file can be loaded as it stands.

        Only when the snapshot is the one this run created: if the records matched
        an earlier run's snapshot, this file's row numbers belong to a different
        download than the bytes we retained.
        """
        return self.snapshot_id == self.candidate_snapshot_id


@dataclass
class LoadReport:
    outcome: Optional[Outcome] = None
    published_snapshot_id: Optional[uuid.UUID] = None
    published: bool = False
    no_change: bool = False
    dry_run: bool = False
    pruned_snapshots: int = 0
    pruned_rows: int = 0
    refusal: Optional[str] = None

    def summary(self) -> str:
        lines: list[str] = []
        outcome = self.outcome
        if outcome is not None:
            measured = outcome.measurements
            rows = f"{measured.row_count:,} rows" if measured else "not parsed"
            state = (
                "unchanged"
                if outcome.unchanged
                else ("quarantined" if outcome.blocked else "ready")
            )
            lines.append(
                f"  principal expenditures: {state}, {rows}, "
                f"{outcome.fetched.byte_size:,} bytes"
            )
            # The record-set hash in full, because it is what an operator passes to
            # --publish-hash and a truncated one would silently not match.
            lines.append(
                f"      records {measured.record_set_hash or '(unparsed)'}"
                if measured
                else "      records (unparsed)"
            )
            lines.append(f"      bytes   {outcome.fetched.content_hash}")
            if measured is not None and not measured.errors:
                lines.append(
                    f"      total spent {measured.total_spent_sum}, "
                    f"{measured.distinct_entity_count:,} entities, "
                    f"years {min(measured.rows_by_report_year, default='?')}–"
                    f"{max(measured.rows_by_report_year, default='?')}"
                )
            for check in outcome.checks:
                if check.status in ("failed", "not_run", "overridden"):
                    lines.append(f"      {check.status}: {check.name} — {check.detail}")
        if self.refusal:
            lines.append(f"  refused: {self.refusal}")
        elif self.dry_run:
            lines.append("  dry run: nothing was written")
        elif self.no_change:
            lines.append(
                "  no change: the published snapshot already holds these records"
            )
        elif self.published:
            lines.append(f"  published snapshot {self.published_snapshot_id}")
            lines.append(
                f"  pruned {self.pruned_rows:,} rows from "
                f"{self.pruned_snapshots} superseded snapshot(s)"
            )
        else:
            lines.append("  nothing published")
        return "\n".join(lines)


class LobbyingRefusal(RuntimeError):
    """Raised when the run must stop without publishing."""


# --- Step 1: resolve the link -------------------------------------------------


def _strip_tags(fragment: str) -> str:
    return html.unescape(TAG.sub(" ", fragment)).strip()


@dataclass(frozen=True)
class ResolvedDownload:
    download_id: str
    url: str


def resolve_download(
    http: requests.Session, landing_page: str = LANDING_PAGE
) -> ResolvedDownload:
    """Find the "Principal expenditures - 2009 - Present" download on the landing page.

    Resolved from the page's own labels every run — the ``<h1>`` naming the
    dataset and the row whose first cell carries the full row label — never from a
    saved number or a position. The same heading carries a "2020 only" row, and
    the page's other headings carry lobbyist lists this loader does not want.

    Fails loudly on no match or more than one. A renamed heading has to break the
    run: silently resolving a different file is the one failure this whole module
    is built to prevent.
    """
    response = http.get(landing_page, timeout=LANDING_PAGE_TIMEOUT_SECONDS)
    response.raise_for_status()
    page = response_text(response)

    matches: list[ResolvedDownload] = []
    for section in re.split(r"<h1[^>]*>", page)[1:]:
        heading, _, body = section.partition("</h1>")
        if HEADING not in _strip_tags(heading).lower():
            continue
        for row in re.findall(r"<tr[^>]*>(.*?)</tr>", body, re.S):
            cells = re.findall(r"<t[dh][^>]*>(.*?)</t[dh]>", row, re.S)
            if not cells or _strip_tags(cells[0]).lower() != ROW_LABEL:
                continue
            link = DOWNLOAD_LINK.search(row)
            if not link:
                continue
            url = requests.compat.urljoin(landing_page, html.unescape(link.group(1)))
            matches.append(ResolvedDownload(link.group(2), url))

    if len(matches) != 1:
        raise LobbyingRefusal(
            f"Expected exactly 1 {ROW_LABEL!r} download under a heading containing "
            f"{HEADING!r} on {landing_page}, found {len(matches)}. The page's labels "
            "have changed, so refusing to guess which file is which."
        )
    return matches[0]


# --- Step 2: fetch, and prove it is the right file ----------------------------


def fetch_download(
    http: requests.Session, resolved: ResolvedDownload, directory: str
) -> FetchedFile:
    """Stream the download to disk, hashing the response bytes as they arrive.

    Two content checks, because the response itself cannot tell you the file
    arrived: a stale download number answers HTTP 200 with an HTML error page. A
    failure here is recorded on the returned object rather than raised, so the
    bytes are still retained for diagnosis.
    """
    last_error: Optional[Exception] = None
    for attempt in range(1, MAX_ATTEMPTS + 1):
        started_at = datetime.now(UTC)
        path = os.path.join(directory, "principal-expenditures.csv")
        try:
            response = http.get(
                resolved.url, timeout=DOWNLOAD_TIMEOUT_SECONDS, stream=True
            )
            if response.status_code >= 500:
                response.close()
                raise requests.HTTPError(
                    f"{resolved.url} answered HTTP {response.status_code}"
                )
            response.raise_for_status()
            digest = hashlib.sha256()
            byte_size = 0
            with open(path, "wb") as handle:
                for chunk in response.iter_content(chunk_size=COPY_CHUNK_BYTES):
                    if not chunk:
                        continue
                    digest.update(chunk)
                    byte_size += len(chunk)
                    handle.write(chunk)
            completed_at = datetime.now(UTC)
            headers = {key: value for key, value in response.headers.items()}
            response.close()
        except (requests.RequestException, OSError) as error:
            last_error = error
            if attempt < MAX_ATTEMPTS:
                time.sleep(RETRY_PAUSE_SECONDS)
                continue
            raise LobbyingRefusal(
                f"Could not download the principal expenditures file from "
                f"{resolved.url} after {MAX_ATTEMPTS} attempts: {error}"
            ) from error

        fetched = FetchedFile(
            download_id=resolved.download_id,
            requested_url=resolved.url,
            final_url=response.url,
            path=path,
            byte_size=byte_size,
            content_hash=digest.hexdigest(),
            disposition_filename=_disposition_filename(headers),
            response_headers=headers,
            started_at=started_at,
            completed_at=completed_at,
        )
        fetched.content_error = _content_error(fetched)
        return fetched

    raise LobbyingRefusal(  # pragma: no cover - the loop always returns or raises
        f"Could not download the principal expenditures file: {last_error}"
    )


def _disposition_filename(headers: dict[str, str]) -> Optional[str]:
    disposition = headers.get("Content-Disposition") or ""
    match = re.search(r'filename="?([^"]+)"?', disposition)
    return match.group(1) if match else None


def _content_error(fetched: FetchedFile) -> Optional[str]:
    name = fetched.disposition_filename or ""
    if DISPOSITION_MARKER not in name:
        return (
            "The download did not name the principal expenditures file "
            f"(Content-Disposition filename: {name!r}). A stale download number "
            "answers HTTP 200 with an HTML error page, so this is refused."
        )
    try:
        with open(fetched.path, encoding="utf-8-sig", newline="") as handle:
            first_line = handle.readline().rstrip("\r\n")
    except (OSError, UnicodeDecodeError) as error:
        return f"Could not read the first line of the download: {error}"
    if first_line != HEADER_LINE:
        return (
            "The download's first line is not the expected column header. "
            f"Got {first_line[:160]!r}"
        )
    return None


# --- Step 3: parse, type and measure in one pass ------------------------------


def _blank(value: str) -> bool:
    return value.strip() == ""


def parse_and_measure(
    source_path: str, snapshot_id: uuid.UUID, copy_path: str
) -> Measurements:
    """Read the file once: type every value, measure it, and write the COPY file.

    Parsed with Python's **default** ``csv`` reader, matching the campaign-finance
    loader: the Board's exports carry a non-RFC-4180 backslash-escaped quote that
    no reader setting handles without damaging other rows. This file carried none
    on 31 Aug 2026 (0 backslash bytes in 17,842 records), so the counter should
    stay 0 — movement means the export changed.

    Blank money becomes NULL, never 0: 48 rows on the 31 Aug 2026 file carry no
    amounts at all, and "not reported" is a different claim from "spent nothing"
    (`.claude/rules/grounded-answers.md` rule 12). The measured sums read a blank
    as contributing nothing, which is how the published $886m figure reproduces.
    """
    measured = Measurements(column_names=[column.source for column in COLUMNS])
    fingerprints: list[bytes] = []
    expected = len(COLUMNS)
    blanks = {column.source: 0 for column in COLUMNS}
    years: dict[str, int] = {}
    sources = [column.source for column in COLUMNS]
    # Positions in the typed row, which starts with the snapshot id and the record
    # number, so a source column at index i lands at i + 2.
    total_at = 2 + sources.index("Total spent")
    money_at = [2 + sources.index(source) for source in MONEY_SOURCES]
    part_at = [position for position in money_at if position != total_at]
    year_at = 2 + sources.index("Report Year")
    # Raw-record positions, without the 2-column offset the typed row carries.
    year_raw_at = sources.index("Report Year")
    entity_at = sources.index("Entity ID")
    principal_at = sources.index("Principal")

    entity_years: set[tuple[str, str]] = set()
    names_by_entity: dict[str, set[str]] = {}
    entities_by_name: dict[str, set[str]] = {}

    with (
        open(source_path, encoding="utf-8-sig", newline="") as source,
        open(copy_path, "w", encoding="utf-8", newline="") as destination,
    ):
        writer = csv.writer(destination, lineterminator="\n")
        reader = csv.reader(source)
        try:
            header = next(reader)
        except (StopIteration, csv.Error) as error:
            measured.errors.append(f"could not read the header row: {error}")
            return measured
        if header != sources:
            measured.errors.append(
                f"header columns are {header!r}, not the pinned contract"
            )
            return measured

        row_number = 0
        for raw in _records(reader, measured):
            row_number += 1
            if len(raw) != expected:
                measured.errors.append(
                    f"record {row_number} has {len(raw)} fields, expected {expected}"
                )
                if len(measured.errors) >= MAX_REPORTED_ROW_ERRORS:
                    break
                continue

            typed: list[Any] = [str(snapshot_id), row_number]
            failure: Optional[str] = None
            for column, value in zip(COLUMNS, raw):
                if "\x00" in value:
                    failure = f"column {column.source!r} contains a NUL byte"
                    break
                if _blank(value):
                    blanks[column.source] += 1
                    typed.append(None)
                    continue
                try:
                    typed.append(_typed_value(column, value))
                except ValueError as error:
                    failure = f"column {column.source!r}: {error}"
                    break
            if failure is not None:
                measured.errors.append(f"record {row_number} {failure}")
                if len(measured.errors) >= MAX_REPORTED_ROW_ERRORS:
                    break
                continue

            measured.row_count += 1
            writer.writerow(typed)

            total = typed[total_at]
            if total is not None:
                measured.total_spent_sum += total
            for position in money_at:
                amount = typed[position]
                if amount is not None and amount < 0:
                    measured.negative_amount_sum += amount
            # Total-versus-parts, with a blank read as 0. A row with every money
            # cell blank makes no claim at all, so it is skipped rather than
            # compared: 48 such rows on the 31 Aug 2026 file.
            if any(typed[position] is not None for position in money_at):
                parts = sum(typed[position] or Decimal("0") for position in part_at)
                if parts != (total or Decimal("0")):
                    measured.total_mismatch_count += 1

            year = typed[year_at]
            if year is not None:
                key = str(year)
                years[key] = years.get(key, 0) + 1
            entity = raw[entity_at].strip()
            principal = raw[principal_at].strip()
            if entity:
                pair = (entity, raw[year_raw_at].strip())
                if pair in entity_years:
                    measured.duplicate_entity_year_count += 1
                entity_years.add(pair)
                if principal:
                    names_by_entity.setdefault(entity, set()).add(principal)
                    entities_by_name.setdefault(principal, set()).add(entity)

            fingerprints.append(_record_fingerprint(raw))
            if any("\\" in cell and cell.endswith('"') for cell in raw):
                measured.malformed_quote_record_count += 1

    measured.distinct_row_count = len(set(fingerprints))
    measured.distinct_entity_count = len(names_by_entity)
    measured.entity_ids_with_multiple_names_count = sum(
        1 for names in names_by_entity.values() if len(names) > 1
    )
    measured.names_with_multiple_entity_ids_count = sum(
        1 for entities in entities_by_name.values() if len(entities) > 1
    )
    measured.rows_by_report_year = dict(sorted(years.items()))
    measured.blank_counts_by_column = blanks
    if not measured.errors:
        # Sorted, so the same records in a different order hash the same.
        fingerprints.sort()
        digest = hashlib.sha256()
        for fingerprint in fingerprints:
            digest.update(fingerprint)
        measured.record_set_hash = digest.hexdigest()
    return measured


def _records(reader: Any, measured: Measurements) -> Iterable[list[str]]:
    """Yield records, turning a reader-level parse error into a recorded failure."""
    while True:
        try:
            yield next(reader)
        except StopIteration:
            return
        except csv.Error as error:
            measured.errors.append(f"the CSV reader could not continue: {error}")
            return


def _typed_value(column: Column, value: str) -> Any:
    if column.kind == "text":
        # Kept exactly as printed. Trimming would change what the Board published.
        return value
    stripped = value.strip()
    if column.kind == "money":
        try:
            amount = Decimal(stripped)
        except InvalidOperation:
            raise ValueError(f"{stripped!r} is not an amount") from None
        if not amount.is_finite():
            raise ValueError(f"{stripped!r} is not a finite amount")
        scale = -int(amount.as_tuple().exponent)
        if scale > 4:
            # Never rounded. A 5-decimal value means the source changed, and
            # rounding it would silently move real money.
            raise ValueError(
                f"{stripped!r} carries {scale} decimal places; the column holds 4, "
                "and an amount is never rounded to fit"
            )
        return amount
    if column.kind == "year":
        if not FOUR_DIGIT_YEAR.match(stripped):
            raise ValueError(f"{stripped!r} is not a 4-digit year")
        return int(stripped)
    raise AssertionError(f"unknown column kind {column.kind!r}")  # pragma: no cover


# --- Step 4: validate ----------------------------------------------------------


def validate(
    fetched: FetchedFile,
    measured: Optional[Measurements],
    baseline: Optional[Any],
    *,
    operator_approved: bool,
) -> list[Check]:
    """Compare a candidate against the live snapshot's recorded measurements.

    ``operator_approved`` waives the comparison checks only, for an operator who
    has named the exact record-set hash they reviewed. It never waives a
    structural check: a header that does not match, a record with the wrong
    number of fields and an amount that would have to be rounded are not
    judgement calls, and there is no flag that lets one through.

    There is deliberately no blanks-gained check, unlike the campaign-finance
    loader: blank money rows are structural here (48 of them, growing by a
    handful a year as principals file nothing), so "a column gained blanks" is
    this file's normal March. The counts are still recorded on the snapshot.
    """
    checks: list[Check] = []

    def add(name: str, ok: bool, detail: str, *, comparison: bool = False) -> None:
        if ok:
            checks.append(Check(name, "passed", detail))
        elif comparison and operator_approved:
            checks.append(
                Check(
                    name,
                    "overridden",
                    f"{detail} — waived by an operator who named this hash",
                )
            )
        else:
            checks.append(Check(name, "failed", detail))

    add(
        "download_is_the_expected_file",
        fetched.content_error is None,
        fetched.content_error or f"named {fetched.disposition_filename!r}",
    )
    if fetched.content_error is not None or measured is None:
        return checks

    add(
        "parses_completely",
        not measured.errors,
        "; ".join(measured.errors[:MAX_REPORTED_ROW_ERRORS])
        or f"{measured.row_count:,} records, every field typed",
    )
    if measured.errors:
        return checks

    # Properties §2.2 measured of every file so far, each one load-bearing for
    # how the rows get summed. Waivable, because the Board owns its export and a
    # changed shape may be legitimate — but never silent.
    add(
        "entity_year_pairs_stay_unique",
        measured.duplicate_entity_year_count == 0,
        f"{measured.duplicate_entity_year_count} duplicate (Entity ID, Report Year) "
        "pair(s); a duplicate double-counts a principal's year wherever rows are "
        "summed per principal",
        comparison=True,
    )
    add(
        "total_spent_is_the_sum_of_its_parts",
        measured.total_mismatch_count == 0,
        f"{measured.total_mismatch_count} row(s) where Total spent is not the sum "
        "of the 5 type columns; published figures sum Total spent",
        comparison=True,
    )
    add(
        "no_negative_amounts",
        measured.negative_amount_sum == 0,
        f"negative amounts sum to {measured.negative_amount_sum}; every measured "
        "file had none",
        comparison=True,
    )

    add(
        "previous_snapshot_to_compare_against",
        baseline is not None,
        "no published snapshot holds this dataset yet, so there is nothing to "
        "compare against. Review the measurements and publish by naming the "
        "record-set hash",
        comparison=True,
    )

    if baseline is not None:
        add(
            "row_count_within_band",
            ROW_COUNT_BAND.contains(measured.row_count, baseline.row_count or 0),
            f"{measured.row_count:,} rows against {baseline.row_count:,} published",
            comparison=True,
        )
        add(
            "byte_size_within_band",
            BYTE_SIZE_BAND.contains(fetched.byte_size, baseline.byte_size or 0),
            f"{fetched.byte_size:,} bytes against {baseline.byte_size:,} published",
            comparison=True,
        )
        add(
            "total_spent_sum_within_band",
            TOTAL_SPENT_BAND.contains(
                float(measured.total_spent_sum), float(baseline.total_spent_sum or 0)
            ),
            f"{measured.total_spent_sum} against {baseline.total_spent_sum} published",
            comparison=True,
        )
        lost = _years_that_lost_rows(measured, baseline)
        add(
            "no_published_year_lost_rows",
            not lost,
            "; ".join(lost)
            if lost
            else f"{len(measured.rows_by_report_year)} years checked",
            comparison=True,
        )

    return checks


def _years_that_lost_rows(measured: Measurements, baseline: Any) -> list[str]:
    """Which report years hold meaningfully fewer rows than the published set.

    Past years are nearly static in an annual file, so a year losing rows is the
    sharpest truncation signal there is.
    """
    published = baseline.rows_by_report_year or {}
    lost: list[str] = []
    for year, count in published.items():
        candidate = measured.rows_by_report_year.get(year, 0)
        if count < YEAR_ROW_LOSS_FLOOR:
            continue
        if candidate < count * (1 - YEAR_ROW_LOSS_FRACTION):
            lost.append(f"{year}: {candidate:,} rows against {count:,} published")
    return lost


# --- Steps 5, 6 and 7: the three transactions ---------------------------------


def object_key(content_hash: str) -> str:
    return f"lobbying/principal-expenditures/{content_hash}.csv.gz"


def find_snapshot(db: Session, outcome: Outcome) -> Optional[Any]:
    """The snapshot already holding this download's records, if there is one.

    Matched on the record-set hash. An unparseable download has no record set, so
    those fall back to the bytes.
    """
    measured = outcome.measurements
    if measured is not None and measured.record_set_hash:
        return db.scalars(
            select(schema.LobbyingExpenditureSnapshot).where(
                schema.LobbyingExpenditureSnapshot.record_set_hash
                == measured.record_set_hash
            )
        ).one_or_none()
    return db.scalars(
        select(schema.LobbyingExpenditureSnapshot).where(
            schema.LobbyingExpenditureSnapshot.content_hash
            == outcome.fetched.content_hash
        )
    ).one_or_none()


def record_fetch(
    db: Session,
    outcome: Outcome,
    store: Any,
    directory: str,
    ingestion_run_id: Optional[uuid.UUID],
) -> tuple[uuid.UUID, bool]:
    """Store the bytes and record the fetch, then commit — before any validation.

    Its own transaction on purpose, exactly like the campaign-finance loader's: a
    failure record written inside the transaction that later fails rolls back
    with it, which is how "the bad download is retained" becomes "the bad
    download is gone".

    Returns the snapshot id and whether the records were already on file.
    """
    existing = find_snapshot(db, outcome)
    if existing is None:
        # Two runs can reach here with the same new records and both find
        # nothing. The unique index on record_set_hash decides, so the loser
        # re-reads rather than dying.
        try:
            return _create_snapshot_and_record(
                db, outcome, store, directory, ingestion_run_id
            )
        except IntegrityError:
            db.rollback()
            existing = find_snapshot(db, outcome)
            if existing is None:  # pragma: no cover - the index is what conflicted
                raise
    return _record_observation(db, outcome, existing, ingestion_run_id, reused=True)


def _create_snapshot_and_record(
    db: Session,
    outcome: Outcome,
    store: Any,
    directory: str,
    ingestion_run_id: Optional[uuid.UUID],
) -> tuple[uuid.UUID, bool]:
    """Create the snapshot for records not on file, store its bytes, record the fetch."""
    fetched = outcome.fetched
    measured = outcome.measurements
    key = object_key(fetched.content_hash)
    compressed_path = os.path.join(directory, "principal-expenditures.csv.gz")
    compressed_hash, compressed_size = gzip_to(fetched.path, compressed_path)
    # Upload and verify before the row exists. An orphaned object is recoverable;
    # a row pointing at a missing object destroys the evidence it claims to have.
    store.put_and_verify(key, compressed_path, compressed_hash)
    os.remove(compressed_path)
    snapshot = schema.LobbyingExpenditureSnapshot(
        # Minted before the parse, so the COPY file this run already wrote carries
        # the right id.
        id=outcome.candidate_snapshot_id,
        download_id=fetched.download_id,
        source_url=fetched.requested_url,
        content_disposition_filename=fetched.disposition_filename,
        content_hash=fetched.content_hash,
        record_set_hash=(measured.record_set_hash or None) if measured else None,
        byte_size=fetched.byte_size,
        fetch_started_at=fetched.started_at,
        fetch_completed_at=fetched.completed_at,
        status=SnapshotStatus.quarantined
        if fetched.content_error or (measured and measured.errors)
        else SnapshotStatus.fetched,
        error_text=fetched.content_error,
        validation_json={},
        object_key=key,
        compressed_hash=compressed_hash,
        compressed_byte_size=compressed_size,
        compression="gzip",
    )
    db.add(snapshot)
    db.flush()
    return _record_observation(db, outcome, snapshot, ingestion_run_id, reused=False)


def _record_observation(
    db: Session,
    outcome: Outcome,
    snapshot: Any,
    ingestion_run_id: Optional[uuid.UUID],
    *,
    reused: bool,
) -> tuple[uuid.UUID, bool]:
    """Append this download to the record, whether or not anything changed."""
    fetched = outcome.fetched
    db.add(
        schema.LobbyingExpenditureFetchObservation(
            snapshot_id=snapshot.id,
            ingestion_run_id=ingestion_run_id,
            download_id=fetched.download_id,
            requested_url=fetched.requested_url,
            final_url=fetched.final_url,
            started_at=fetched.started_at,
            completed_at=fetched.completed_at,
            byte_size=fetched.byte_size,
            content_hash=fetched.content_hash,
            response_headers=fetched.response_headers,
            reused_existing_snapshot=reused,
        )
    )
    db.commit()
    return snapshot.id, reused


def live_snapshot(db: Session) -> Optional[Any]:
    """Which snapshot is live, read from the database rather than from memory.

    ``populate_existing=True`` for the same measured reason as the
    campaign-finance loader's ``live_release()``: the session factory sets
    ``expire_on_commit=False`` and ``publish()`` moves the pointer with a
    statement, so a stale pointer object here would make ``prune()`` delete the
    rows of the snapshot that was just published.
    """
    pointer = db.get(
        schema.LobbyingExpenditureCurrentSnapshot, True, populate_existing=True
    )
    if pointer is None or pointer.snapshot_id is None:
        return None
    return db.get(
        schema.LobbyingExpenditureSnapshot, pointer.snapshot_id, populate_existing=True
    )


def ensure_pointer_row(db: Session) -> None:
    """Make sure the single pointer row exists, in its own committed transaction.

    ``SELECT ... FOR UPDATE`` locks nothing when there is no row, so without this
    the very first two concurrent imports would not see each other.
    """
    db.execute(
        text(
            "INSERT INTO lobbying_expenditure_current (id, snapshot_id) "
            "VALUES (true, NULL) ON CONFLICT (id) DO NOTHING"
        )
    )
    db.commit()


def rows_present(db: Session, snapshot_id: uuid.UUID) -> int:
    return int(
        db.scalar(
            select(func.count())
            .select_from(schema.LobbyingExpenditureRow)
            .where(schema.LobbyingExpenditureRow.snapshot_id == snapshot_id)
        )
        or 0
    )


def copy_rows(db: Session, copy_path: str) -> None:
    """Load the rows with ``COPY``, inside the caller's transaction."""
    columns = ", ".join(
        f'"{name}"' for name in ("snapshot_id", "row_number", *ATTRIBUTES)
    )
    statement = (
        f'COPY "lobbying_expenditure_row" ({columns}) FROM STDIN WITH (FORMAT csv)'
    )
    connection = db.connection().connection.driver_connection
    with connection.cursor() as cursor, cursor.copy(statement) as copy:
        with open(copy_path, "rb") as handle:
            for chunk in iter(lambda: handle.read(COPY_CHUNK_BYTES), b""):
                copy.write(chunk)


def rows_from_retained_body(
    db: Session, outcome: Outcome, snapshot: Any, store: Any, directory: str
) -> str:
    """Rebuild a snapshot's COPY file from the bytes we kept, and prove they are them.

    Needed whenever rows must be (re)loaded for a snapshot this run did not
    create — a set whose rows were pruned and is being published again. This
    run's own download may hold the same records in a different order, so
    numbering from it would point a citation at the wrong line of the kept file.
    """
    import gzip as gzip_module
    import shutil

    if snapshot.object_key is None:
        raise LobbyingRefusal(
            f"snapshot {snapshot.id} has no retained body, so its rows cannot be "
            "rebuilt with the record numbers its citations use."
        )
    compressed_path = os.path.join(directory, "retained.csv.gz")
    source_path = os.path.join(directory, "retained.csv")
    store.get(snapshot.object_key, compressed_path)
    with (
        gzip_module.open(compressed_path, "rb") as compressed,
        open(source_path, "wb") as raw,
    ):
        shutil.copyfileobj(compressed, raw, COPY_CHUNK_BYTES)
    copy_path = os.path.join(directory, "retained.copy.csv")
    rebuilt = parse_and_measure(source_path, snapshot.id, copy_path)
    if rebuilt.errors or rebuilt.record_set_hash != snapshot.record_set_hash:
        raise LobbyingRefusal(
            f"retained body {snapshot.object_key} no longer reproduces the records "
            f"recorded against snapshot {snapshot.id}. Refusing to publish rows we "
            f"cannot trace: {'; '.join(rebuilt.errors) or 'hash mismatch'}"
        )
    return copy_path


def publish(
    db: Session,
    outcome: Outcome,
    *,
    approved_hash: Optional[str] = None,
    store: Any = None,
    directory: Optional[str] = None,
) -> uuid.UUID:
    """Load the rows and move the live pointer, in one transaction.

    The pointer row is taken with ``FOR UPDATE``, the live snapshot re-read
    inside the lock, a candidate whose fetch window opened before it refused, and
    the comparison checks re-run against what is live now — because being newer
    is not the same as having been compared. All 3 hazards and their reasons are
    the campaign-finance loader's; see ``campaign_finance.publish``.
    """
    db.execute(text("SELECT pg_advisory_xact_lock(:key)"), {"key": PUBLISH_LOCK_KEY})
    pointer = db.execute(
        text(
            "SELECT snapshot_id FROM lobbying_expenditure_current "
            "WHERE id = true FOR UPDATE"
        )
    ).one_or_none()
    current_id = pointer[0] if pointer is not None else None
    current = (
        db.get(schema.LobbyingExpenditureSnapshot, current_id, populate_existing=True)
        if current_id
        else None
    )
    if current is not None and current.fetch_started_at > outcome.fetched.started_at:
        raise LobbyingRefusal(
            "Refusing to publish: the live snapshot was fetched starting "
            f"{current.fetch_started_at.isoformat()}, after this run started "
            f"{outcome.fetched.started_at.isoformat()}. Replacing newer data with "
            "older data is the one thing the pointer row exists to prevent. Re-run "
            "to fetch the current file."
        )
    measured = outcome.measurements
    rechecked = validate(
        outcome.fetched,
        measured,
        current,
        operator_approved=bool(
            measured is not None
            and measured.record_set_hash
            and measured.record_set_hash == (approved_hash or "")
        ),
    )
    failed = [check for check in rechecked if check.blocks_publication]
    if failed:
        raise LobbyingRefusal(
            "Refusing to publish: this run passed its checks against the snapshot "
            "that was live when it started and fails them against the one that is "
            "live now, so another import published in between. "
            + "; ".join(f"{check.name}: {check.detail}" for check in failed)
            + ". Re-run to compare against what is actually published."
        )
    outcome.checks = rechecked

    snapshot = db.get(schema.LobbyingExpenditureSnapshot, outcome.snapshot_id)
    if snapshot is None:  # pragma: no cover - written moments ago
        raise LobbyingRefusal("the snapshot vanished before publish")
    if measured is None or outcome.copy_path is None:  # pragma: no cover
        raise LobbyingRefusal("the download reached publication without being parsed")
    if snapshot.record_set_hash != measured.record_set_hash:  # pragma: no cover
        raise LobbyingRefusal(
            f"snapshot {snapshot.id} no longer holds the records this run validated"
        )
    # "Already loaded" has to mean the rows are really there. A snapshot left
    # saying loaded with no rows is exactly what pruning could produce, and
    # reusing it would publish a dataset with nothing in it.
    loaded = snapshot.status == SnapshotStatus.loaded and rows_present(
        db, snapshot.id
    ) == (snapshot.row_count or -1)
    if loaded:
        outcome.reused_rows = True
    else:
        source = (
            outcome.copy_path
            if outcome.copy_file_matches_snapshot
            else rows_from_retained_body(db, outcome, snapshot, store, directory or "")
        )
        db.execute(
            delete(schema.LobbyingExpenditureRow).where(
                schema.LobbyingExpenditureRow.snapshot_id == snapshot.id
            )
        )
        copy_rows(db, source)
    snapshot.status = SnapshotStatus.loaded
    snapshot.row_count = measured.row_count
    snapshot.column_names = measured.column_names
    snapshot.total_spent_sum = measured.total_spent_sum
    snapshot.negative_amount_sum = measured.negative_amount_sum
    snapshot.distinct_row_count = measured.distinct_row_count
    snapshot.distinct_entity_count = measured.distinct_entity_count
    snapshot.duplicate_entity_year_count = measured.duplicate_entity_year_count
    snapshot.total_mismatch_count = measured.total_mismatch_count
    snapshot.entity_ids_with_multiple_names_count = (
        measured.entity_ids_with_multiple_names_count
    )
    snapshot.names_with_multiple_entity_ids_count = (
        measured.names_with_multiple_entity_ids_count
    )
    snapshot.rows_by_report_year = measured.rows_by_report_year
    snapshot.blank_counts_by_column = measured.blank_counts_by_column
    snapshot.malformed_quote_record_count = measured.malformed_quote_record_count
    snapshot.validation_json = {"checks": [check.as_json() for check in outcome.checks]}
    snapshot.error_text = None
    # The snapshot this one replaces keeps its `loaded` status and its rows until
    # `prune` takes them, so the pointer alone says which set is live. There is
    # deliberately no "superseded" status: a status saying loaded with no rows is
    # the one state that would be reused as "unchanged" and publish nothing.
    db.execute(
        text(
            "UPDATE lobbying_expenditure_current SET snapshot_id = :snapshot "
            "WHERE id = true"
        ),
        {"snapshot": snapshot.id},
    )
    db.commit()
    return snapshot.id


def prune(db: Session) -> tuple[int, int]:
    """Delete the rows of every snapshot the live pointer does not name.

    Takes the same lock ``publish`` takes, which is what makes it safe outside
    the publish transaction: without it, this transaction can read the pointer,
    build its keep-list, and have a newer snapshot commit in the gap — absent
    from the list already built, so this would delete the rows of the set that
    is live. The one spare generation and the newest-first ordering by the
    data's own recency are the campaign-finance loader's, for its reasons.
    """
    db.execute(text("SELECT pg_advisory_xact_lock(:key)"), {"key": PUBLISH_LOCK_KEY})
    live = live_snapshot(db)
    loaded = db.scalars(
        select(schema.LobbyingExpenditureSnapshot)
        .where(schema.LobbyingExpenditureSnapshot.status == SnapshotStatus.loaded)
        .order_by(schema.LobbyingExpenditureSnapshot.fetch_completed_at.desc())
    ).all()
    stale: list[Any] = []
    spared = 0
    for snapshot in loaded:
        if live is not None and snapshot.id == live.id:
            continue
        if spared < KEEP_SUPERSEDED_GENERATIONS:
            spared += 1
            continue
        stale.append(snapshot)

    snapshots = 0
    rows = 0
    for snapshot in stale:
        deleted = db.execute(
            delete(schema.LobbyingExpenditureRow).where(
                schema.LobbyingExpenditureRow.snapshot_id == snapshot.id
            )
        ).rowcount
        # The status change and the delete share a transaction on purpose: a
        # snapshot left saying `loaded` with no rows would be reused as
        # "unchanged" the next time the Board republishes those exact records,
        # and would publish a dataset with nothing in it.
        snapshot.status = SnapshotStatus.pruned
        snapshots += 1
        rows += deleted or 0
    db.commit()
    return snapshots, rows


def quarantine(db: Session, outcome: Outcome) -> None:
    snapshot = db.get(schema.LobbyingExpenditureSnapshot, outcome.snapshot_id)
    if snapshot is None:  # pragma: no cover
        return
    if snapshot.status != SnapshotStatus.loaded:
        snapshot.status = SnapshotStatus.quarantined
    snapshot.validation_json = {"checks": [check.as_json() for check in outcome.checks]}
    snapshot.error_text = "; ".join(check.detail for check in outcome.blocked) or None
    measured = outcome.measurements
    if measured is not None and not measured.errors:
        snapshot.row_count = measured.row_count
        snapshot.column_names = measured.column_names
        snapshot.total_spent_sum = measured.total_spent_sum
        snapshot.negative_amount_sum = measured.negative_amount_sum
        snapshot.distinct_row_count = measured.distinct_row_count
        snapshot.distinct_entity_count = measured.distinct_entity_count
        snapshot.duplicate_entity_year_count = measured.duplicate_entity_year_count
        snapshot.total_mismatch_count = measured.total_mismatch_count
        snapshot.entity_ids_with_multiple_names_count = (
            measured.entity_ids_with_multiple_names_count
        )
        snapshot.names_with_multiple_entity_ids_count = (
            measured.names_with_multiple_entity_ids_count
        )
        snapshot.rows_by_report_year = measured.rows_by_report_year
        snapshot.blank_counts_by_column = measured.blank_counts_by_column
        snapshot.malformed_quote_record_count = measured.malformed_quote_record_count
    db.commit()


# --- The whole cycle -----------------------------------------------------------


def load_lobbying_expenditures(
    db: Session,
    *,
    http: Optional[requests.Session] = None,
    store: Any = None,
    dry_run: bool = False,
    publish_hash: Optional[str] = None,
    landing_page: str = LANDING_PAGE,
    log=print,
) -> LoadReport:
    """Run the whole cycle once and report what happened.

    ``publish_hash`` is how an operator publishes a set the comparison checks
    quarantined, including the very first import, which has nothing to compare
    against. It names the record-set hash, so the approval survives a
    re-download; structural checks are never waived by it.
    """
    http = http or _http_session()
    approved = (publish_hash or "").strip().lower() or None
    report = LoadReport(dry_run=dry_run)

    with tempfile.TemporaryDirectory(prefix="alethical-lobbying-") as directory:
        resolved = resolve_download(http, landing_page)
        log(f"resolved download {resolved.download_id} from {landing_page}")

        ingestion_run_id = None
        if not dry_run:
            ensure_pointer_row(db)
            run = schema.IngestionRun(
                adapter="minnesota_lobbying",
                target_type="lobbying_expenditure_snapshot",
                status=schema.IngestionStatus.running,
                stats={},
            )
            db.add(run)
            db.commit()
            ingestion_run_id = run.id
            store = store or _store_from_env()

        fetched = fetch_download(http, resolved, directory)
        log(
            f"principal expenditures: {fetched.byte_size:,} bytes, "
            f"sha256 {fetched.content_hash[:12]}"
            + (f" — {fetched.content_error}" if fetched.content_error else "")
        )
        outcome = Outcome(fetched=fetched)
        report.outcome = outcome

        if fetched.content_error is None:
            outcome.copy_path = os.path.join(directory, "copy.csv")
            outcome.measurements = parse_and_measure(
                fetched.path, outcome.candidate_snapshot_id, outcome.copy_path
            )
            measured = outcome.measurements
            log(
                f"principal expenditures: {measured.row_count:,} records, "
                f"total spent {measured.total_spent_sum}, "
                f"{measured.distinct_entity_count:,} entities, "
                f"records {measured.record_set_hash[:12] or 'unparsed'}"
            )

        if not dry_run:
            outcome.snapshot_id, reused = record_fetch(
                db, outcome, store, directory, ingestion_run_id
            )
            if reused:
                log("these records were already on file")

        # Read even on a dry run: a dry run's whole point is to show what the
        # real checks would say.
        baseline = live_snapshot(db)
        measured = outcome.measurements
        outcome.unchanged = bool(
            baseline is not None
            and measured is not None
            and measured.record_set_hash
            and baseline.record_set_hash == measured.record_set_hash
        )

        if not dry_run and outcome.unchanged:
            usable = baseline.status == SnapshotStatus.loaded and rows_present(
                db, baseline.id
            ) == (baseline.row_count or -1)
            if usable:
                report.no_change = True
                _finish_run(db, ingestion_run_id, report)
                log("the file holds the records already published")
                return report

        outcome.checks = validate(
            fetched,
            measured,
            baseline,
            operator_approved=bool(
                measured is not None
                and measured.record_set_hash
                and measured.record_set_hash == approved
            ),
        )

        if outcome.blocked:
            if not dry_run:
                quarantine(db, outcome)
                _finish_run(db, ingestion_run_id, report)
            report.refusal = "quarantined. Nothing was published" + (
                " and the previous set is still live." if baseline is not None else "."
            )
            return report

        if dry_run:
            return report

        report.published_snapshot_id = publish(
            db, outcome, approved_hash=approved, store=store, directory=directory
        )
        report.published = True
        report.pruned_snapshots, report.pruned_rows = prune(db)
        _finish_run(db, ingestion_run_id, report)
        return report


def _finish_run(db: Session, run_id: Optional[uuid.UUID], report: LoadReport) -> None:
    if run_id is None:
        return
    run = db.get(schema.IngestionRun, run_id)
    if run is None:  # pragma: no cover
        return
    run.status = (
        schema.IngestionStatus.succeeded
        if report.refusal is None
        else schema.IngestionStatus.failed
    )
    run.finished_at = datetime.now(UTC)
    outcome = report.outcome
    run.stats = {
        "published": report.published,
        "no_change": report.no_change,
        "snapshot_id": (
            str(report.published_snapshot_id) if report.published_snapshot_id else None
        ),
        "rows": (
            outcome.measurements.row_count
            if outcome is not None and outcome.measurements is not None
            else None
        ),
    }
    db.commit()


def _http_session() -> requests.Session:
    session = requests.Session()
    session.headers.update({"User-Agent": USER_AGENT})
    return session


def _store_from_env():
    from alethical.pipeline.raw_file_store import raw_file_store_from_env

    return raw_file_store_from_env()
