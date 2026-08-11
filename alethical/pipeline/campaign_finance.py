"""Load Minnesota's campaign-finance downloads as dated snapshots that replace, not merge.

Net: download the Board's 3 "All" files whole, keep each download's exact bytes,
check the new set against the one already published, and publish by replacing the
previous set entirely. Never merge rows into an existing table.

Why this shape rather than the per-record upsert every other source here uses:
Minnesota publishes **no per-transaction identifier**, and two payments can be
legitimately identical — same donor, same day, same amount. A single official
download contains 20,524 rows identical to another row, one of them repeated 119
times. So no key built from a row's contents can tell a genuine repeat payment
apart from a re-import of the same row, and merging cannot be made correct; it can
only be made careful, which is what failed in the system this replaces (241,258 of
its 954,188 money rows repeat another row's fingerprint). Full reasoning:
``docs/architecture/campaign-finance-system-design.md`` §4 (Ingestion: snapshot and
replace).

The cycle, and the reason each step sits where it does:

1. **Resolve the 3 download links from the landing page, every run.** The numbers
   are signed and all 3 we want are negative, so a ``\\d+`` pattern silently
   resolves a different file.
2. **Stream each download to a temporary file, hashing the response bytes.**
   Nothing in the response says it arrived whole: there is no ``Content-Length``,
   transfer is chunked, and a ``Range`` request is ignored. Worse, a stale download
   number answers **HTTP 200 with a 39 KB HTML error page** typed
   ``application/octet-stream``, so 2 content checks are what catch a wrong file —
   the ``Content-Disposition`` filename and an exact match on the header line.
3. **Parse, type and measure in one streaming pass**, writing no database rows yet.
   This pass also produces the record-set hash the next step needs.
4. **Store the bytes and record the fetch, and commit that, before validating
   anything.** A failure record written inside the transaction that later fails
   rolls back with it, which quietly turns "the bad download is retained" into
   "the bad download is gone".
5. **Compare record sets.** All 3 unchanged means nothing to publish. The run still
   records a fetch observation per dataset, because the record of *what we checked
   and when* grows even when the published data does not.
6. **Validate** against the measurements of the live release's snapshots. A
   snapshot that fails is left ``quarantined`` with its reason and its bytes, and
   nothing is published.
7. **Publish in one transaction**: copy the rows in, name the 3 snapshots as a
   release, take the pointer row with ``FOR UPDATE``, re-check, and move it.
8. **Prune in a separate transaction** afterwards. A crash there leaves extra
   rows, which is harmless and self-correcting.

**"Did the data change" is decided on the records, not on the bytes, because this
source shuffles.** Fetching the same file 3 times seconds apart returns 3 different
sha256 hashes at an identical byte size, holding an identical set of records in a
different order: measured 11 Aug 2026 on the independent-expenditures file (41,130
records, 35,905 of the 41,130 positions differing) and on the contributions file
(583,152 records, 511,066 positions differing). So each snapshot carries an
order-independent hash of its records alongside the hash of the bytes we kept, and
one body is stored per distinct record set rather than per download. Keyed on the
bytes alone, every run would look like a new file, publish a new release, renumber
every row, and prune the set it had just replaced.

Two things a reader of this data must know. A request must **resolve one release id
and use it for all 3 datasets**: each statement sees the newest committed state, so
re-resolving "the live release" per query can hand back a mixed set. And the rows
of a superseded release survive one further publish and are then pruned, which is
enough for a request that resolved that release moments before a publish; an id
cached for longer than that resolves to no rows, so re-resolve rather than keeping
one.
"""

from __future__ import annotations

import csv
import gzip
import hashlib
import html
import os
import re
import shutil
import tempfile
import time
import uuid
from dataclasses import dataclass, field
from datetime import UTC, date, datetime
from decimal import Decimal, InvalidOperation
from typing import Any, Iterable, Optional

import requests
from sqlalchemy import delete, func, select, text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from alethical.db import models as schema
from alethical.pipeline.http_text import response_text
from alethical.pipeline.raw_file_store import sha256_of_file

Dataset = schema.CampaignFinanceDataset
SnapshotStatus = schema.CampaignFinanceSnapshotStatus
ReleaseStatus = schema.CampaignFinanceReleaseStatus

LANDING_PAGE = (
    "https://cfb.mn.gov/reports-and-data/self-help/data-downloads/campaign-finance/"
)
USER_AGENT = "Alethical Campaign Finance Ingest/0.1 (+https://alethical.com)"
# The 3 files are 82.6 MB, 67.1 MB and 9.1 MB over a chunked transfer.
DOWNLOAD_TIMEOUT_SECONDS = 600
LANDING_PAGE_TIMEOUT_SECONDS = 60
# The contributions download answered HTTP 500 once on 11 Aug 2026 and succeeded
# on the next attempt from the same unchanged link, so a server error is a retry
# rather than a moved link. The content checks are what tell a genuinely wrong
# file from a bad minute.
MAX_ATTEMPTS = 3
RETRY_PAUSE_SECONDS = 5
COPY_CHUNK_BYTES = 1 << 20

# One key for the whole publish, so two overlapping imports queue instead of
# colliding. Transaction-scoped: production connects through Supabase's
# transaction pooler, where a session-level lock can outlive the client that took
# it and is never safe.
PUBLISH_LOCK_KEY = 610312263010

# How many superseded releases keep their rows after being replaced. One, so a
# request that resolved the previous release a moment before a publish still finds
# its rows instead of an empty page (see prune()). Measured cost: 51 MB per
# generation against 8 GB of database disk.
KEEP_SUPERSEDED_GENERATIONS = 1

ISO_DATE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
FOUR_DIGIT_YEAR = re.compile(r"^\d{4}$")
# `-?\d+`, never `\d+`: the download numbers are signed and all 3 we want are
# negative, so a pattern that drops the minus sign resolves a different file.
DOWNLOAD_LINK = re.compile(r'href="([^"]*\?download=(-?\d+))"')
TAG = re.compile(r"<[^>]+>")

MAX_REPORTED_ROW_ERRORS = 5


# --- What each file looks like ----------------------------------------------
#
# The header line is pinned here as a contract in code rather than taken from the
# previous snapshot, because a header learned from the first import makes one bad
# first import the permanent standard. A test asserts each pinned header line
# parses to exactly this column list, so the two can never drift apart.


@dataclass(frozen=True)
class Column:
    source: str
    attribute: str
    # "text" keeps the value exactly as printed; "money" is numeric(18,4);
    # "date" must be a real calendar date; "year" is the file's own Year claim.
    kind: str = "text"


def _text(*pairs: tuple[str, str]) -> tuple[Column, ...]:
    return tuple(Column(source, attribute) for source, attribute in pairs)


CONTRIBUTION_COLUMNS: tuple[Column, ...] = (
    *_text(
        ("Recipient reg num", "recipient_reg_num"),
        ("Recipient", "recipient"),
        ("Recipient type", "recipient_type"),
        ("Recipient subtype", "recipient_subtype"),
    ),
    Column("Amount", "amount", "money"),
    Column("Receipt date", "receipt_date", "date"),
    Column("Year", "year", "year"),
    *_text(
        ("Contributor", "contributor"),
        ("Contrib Reg Num", "contrib_reg_num"),
        ("Contrib type", "contrib_type"),
        ("Receipt type", "receipt_type"),
        ("In kind?", "in_kind"),
        ("In-kind descr", "in_kind_descr"),
        ("Contrib zip", "contrib_zip"),
        ("Contrib Employer name", "contrib_employer_name"),
    ),
)

EXPENDITURE_COLUMNS: tuple[Column, ...] = (
    *_text(
        ("Committee reg num", "committee_reg_num"),
        ("Committee name", "committee_name"),
        ("Entity type", "entity_type"),
        ("Entity sub-type", "entity_sub_type"),
        ("Vendor name", "vendor_name"),
        ("Vendor city", "vendor_city"),
        ("Vendor state", "vendor_state"),
        ("Vendor zip", "vendor_zip"),
    ),
    Column("Amount", "amount", "money"),
    Column("Unpaid amount", "unpaid_amount", "money"),
    Column("Date", "transaction_date", "date"),
    Column("Purpose", "purpose"),
    Column("Year", "year", "year"),
    *_text(
        ("Type", "type"),
        ("In-kind descr", "in_kind_descr"),
        ("In-kind?", "in_kind"),
        ("Affected committee name", "affected_committee_name"),
        ("Affected committee reg num", "affected_committee_reg_num"),
    ),
)

INDEPENDENT_COLUMNS: tuple[Column, ...] = (
    *_text(
        ("Spender", "spender"),
        ("Spender Reg Num", "spender_reg_num"),
        ("Spender type", "spender_type"),
        ("Spender sub-type", "spender_sub_type"),
        # The file abbreviates these two; the table spells them out so the same
        # fact reads the same way as on the expenditures table.
        ("Affected Comte Name", "affected_committee_name"),
        ("Affected Cmte Reg Num", "affected_committee_reg_num"),
        ("For /Against", "for_against"),
    ),
    Column("Year", "year", "year"),
    Column("Date", "transaction_date", "date"),
    Column("Type", "type"),
    Column("Amount", "amount", "money"),
    Column("Unpaid amount", "unpaid_amount", "money"),
    *_text(
        ("In kind?", "in_kind"),
        ("In kind descr", "in_kind_descr"),
        ("Purpose", "purpose"),
        ("Vendor name", "vendor_name"),
        ("Vendor city", "vendor_city"),
        ("Vendor State", "vendor_state"),
        ("Vendor zip", "vendor_zip"),
    ),
)


@dataclass(frozen=True)
class DatasetSpec:
    dataset: Dataset
    # Matched against the <h1> above each table on the landing page, lowercased.
    heading: str
    # Must appear in the download's Content-Disposition filename.
    disposition_marker: str
    header_line: str
    columns: tuple[Column, ...]
    table: type
    filer_attribute: str

    @property
    def key(self) -> str:
        return self.dataset.value

    @property
    def attributes(self) -> tuple[str, ...]:
        return tuple(column.attribute for column in self.columns)


DATASETS: tuple[DatasetSpec, ...] = (
    DatasetSpec(
        dataset=Dataset.contributions,
        heading="itemized contributions received of over $200",
        disposition_marker="Itemized Contributions Received",
        header_line=(
            '"Recipient reg num",Recipient,"Recipient type","Recipient subtype",'
            'Amount,"Receipt date",Year,Contributor,"Contrib Reg Num",'
            '"Contrib type","Receipt type","In kind?","In-kind descr",'
            '"Contrib zip","Contrib Employer name"'
        ),
        columns=CONTRIBUTION_COLUMNS,
        table=schema.CampaignFinanceContributionRow,
        filer_attribute="recipient_reg_num",
    ),
    DatasetSpec(
        dataset=Dataset.expenditures,
        heading="itemized general expenditures and contributions made of over $200",
        disposition_marker="Itemized General Expenditures",
        header_line=(
            '"Committee reg num","Committee name","Entity type","Entity sub-type",'
            '"Vendor name","Vendor city","Vendor state","Vendor zip",Amount,'
            '"Unpaid amount",Date,Purpose,Year,Type,"In-kind descr",In-kind?,'
            '"Affected committee name","Affected committee reg num"'
        ),
        columns=EXPENDITURE_COLUMNS,
        table=schema.CampaignFinanceExpenditureRow,
        filer_attribute="committee_reg_num",
    ),
    DatasetSpec(
        dataset=Dataset.independent_expenditures,
        heading="itemized independent expenditures of over $200",
        disposition_marker="Itemized Independent Expenditures",
        header_line=(
            'Spender,"Spender Reg Num","Spender type","Spender sub-type",'
            '"Affected Comte Name","Affected Cmte Reg Num","For /Against",Year,'
            'Date,Type,Amount,"Unpaid amount","In kind?","In kind descr",Purpose,'
            '"Vendor name","Vendor city","Vendor State","Vendor zip"'
        ),
        columns=INDEPENDENT_COLUMNS,
        table=schema.CampaignFinanceIndependentExpenditureRow,
        filer_attribute="spender_reg_num",
    ),
)

SPEC_BY_DATASET: dict[Dataset, DatasetSpec] = {spec.dataset: spec for spec in DATASETS}

RELEASE_SNAPSHOT_COLUMN: dict[Dataset, str] = {
    Dataset.contributions: "contributions_snapshot_id",
    Dataset.expenditures: "expenditures_snapshot_id",
    Dataset.independent_expenditures: "independent_expenditures_snapshot_id",
}


# --- How much movement is too much ------------------------------------------
#
# These bands are a guess and are stated as one. They come from a single day's
# observation: the contributions file held 583,120 rows on 10 August 2026 and
# 583,152 on 11 August, a rise of 0.005%. They tighten once there are a few weeks
# of real day-to-day deltas. Growth quarantines as well as shrinkage, because a
# file duplicated end to end would publish roughly twice the money and it passes
# every check that only watches for a fall.


@dataclass(frozen=True)
class Band:
    shrink: float
    growth: float

    def contains(self, candidate: float, baseline: float) -> bool:
        if baseline <= 0:
            return True
        ratio = candidate / baseline
        return (1 - self.shrink) <= ratio <= (1 + self.growth)


ROW_COUNT_BAND = Band(shrink=0.005, growth=0.05)
BYTE_SIZE_BAND = Band(shrink=0.01, growth=0.08)
AMOUNT_SUM_BAND = Band(shrink=0.01, growth=0.10)
# Rows that repeat another row exactly are ordinary here, so what matters is the
# share of them moving: that is what catches rows being swapped for copies of
# other rows while the count and the total both stay put.
REPEAT_FRACTION_TOLERANCE = 0.01
# Past years are nearly static, so a year losing rows is the sharpest truncation
# signal there is. The floor keeps a year holding a handful of rows from tripping
# on normal noise.
YEAR_ROW_LOSS_FRACTION = 0.01
YEAR_ROW_LOSS_FLOOR = 25


# --- Results ----------------------------------------------------------------


@dataclass
class Check:
    name: str
    status: str  # "passed" | "failed" | "not_run" | "overridden"
    detail: str

    @property
    def blocks_publication(self) -> bool:
        return self.status == "failed"

    def as_json(self) -> dict[str, str]:
        return {"name": self.name, "status": self.status, "detail": self.detail}


@dataclass
class Measurements:
    row_count: int = 0
    # A hash over this file's records, sorted, so row order cannot change it. This
    # is what "did the data change" is decided on, because the Board's export is
    # byte-unstable (see the module docstring). Empty until the file parses.
    record_set_hash: str = ""
    column_names: list[str] = field(default_factory=list)
    amount_sum: Decimal = Decimal("0")
    negative_amount_sum: Decimal = Decimal("0")
    blank_date_count: int = 0
    distinct_row_count: int = 0
    distinct_filer_count: int = 0
    rows_by_year: dict[str, int] = field(default_factory=dict)
    blank_counts_by_column: dict[str, int] = field(default_factory=dict)
    malformed_quote_record_count: int = 0
    errors: list[str] = field(default_factory=list)

    @property
    def repeat_fraction(self) -> float:
        if self.row_count <= 0:
            return 0.0
        return 1 - (self.distinct_row_count / self.row_count)


@dataclass
class FetchedFile:
    spec: DatasetSpec
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
class DatasetOutcome:
    spec: DatasetSpec
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

        It can only when the snapshot is the one this run created. If the records
        matched a snapshot from an earlier run, the row numbers in this file belong
        to a different shuffle of the same records than the bytes we retained, so
        loading them would make a citation point at the wrong line of the kept file.
        """
        return self.snapshot_id == self.candidate_snapshot_id


@dataclass
class LoadReport:
    outcomes: list[DatasetOutcome] = field(default_factory=list)
    release_id: Optional[uuid.UUID] = None
    published: bool = False
    no_change: bool = False
    dry_run: bool = False
    pruned_snapshots: int = 0
    pruned_rows: int = 0
    refusal: Optional[str] = None

    @property
    def quarantined(self) -> list[DatasetOutcome]:
        return [outcome for outcome in self.outcomes if outcome.blocked]

    def summary(self) -> str:
        lines: list[str] = []
        for outcome in self.outcomes:
            measured = outcome.measurements
            rows = f"{measured.row_count:,} rows" if measured else "not parsed"
            state = (
                "unchanged"
                if outcome.unchanged
                else ("quarantined" if outcome.blocked else "ready")
            )
            lines.append(
                f"  {outcome.spec.key}: {state}, {rows}, "
                f"{outcome.fetched.byte_size:,} bytes"
            )
            # The record-set hash in full, because it is what an operator passes to
            # --publish-hashes and a truncated one would silently not match. The byte
            # hash sits beside it as the identity of the download itself.
            lines.append(
                f"      records {measured.record_set_hash or '(unparsed)'}"
                if measured
                else "      records (unparsed)"
            )
            lines.append(f"      bytes   {outcome.fetched.content_hash}")
            for check in outcome.checks:
                if check.status in ("failed", "not_run", "overridden"):
                    lines.append(f"      {check.status}: {check.name} — {check.detail}")
        if self.refusal:
            lines.append(f"  refused: {self.refusal}")
        elif self.dry_run:
            lines.append("  dry run: nothing was written")
        elif self.no_change:
            lines.append("  no change: the published set already holds these 3 files")
        elif self.published:
            lines.append(f"  published release {self.release_id}")
            lines.append(
                f"  pruned {self.pruned_rows:,} rows from "
                f"{self.pruned_snapshots} superseded snapshot(s)"
            )
        else:
            lines.append("  nothing published")
        return "\n".join(lines)


class CampaignFinanceRefusal(RuntimeError):
    """Raised when the run must stop without publishing."""


# --- Step 1: resolve the links ----------------------------------------------


def _strip_tags(fragment: str) -> str:
    return html.unescape(TAG.sub(" ", fragment)).strip()


@dataclass(frozen=True)
class ResolvedDownload:
    dataset: Dataset
    download_id: str
    url: str


def resolve_downloads(
    http: requests.Session, landing_page: str = LANDING_PAGE
) -> dict[Dataset, ResolvedDownload]:
    """Find each dataset's "All" download on the Board's landing page.

    Resolved from the page's own labels every run — the ``<h1>`` naming the
    dataset and the row whose first cell reads "All" — rather than from a saved
    number or a position. The page offers 23 files, 3 datasets across 8 filer
    categories, and the 3 "All" files contain every row of the other 20.

    Fails loudly when a dataset yields no match or more than one. A renamed
    heading has to break the run: silently resolving a different file is the one
    failure this whole module is built to prevent.
    """
    response = http.get(landing_page, timeout=LANDING_PAGE_TIMEOUT_SECONDS)
    response.raise_for_status()
    page = response_text(response)

    found: dict[Dataset, list[ResolvedDownload]] = {
        spec.dataset: [] for spec in DATASETS
    }
    for section in re.split(r"<h1[^>]*>", page)[1:]:
        heading, _, body = section.partition("</h1>")
        title = _strip_tags(heading).lower()
        matched = [spec for spec in DATASETS if spec.heading in title]
        if not matched:
            continue
        for row in re.findall(r"<tr[^>]*>(.*?)</tr>", body, re.S):
            cells = re.findall(r"<t[dh][^>]*>(.*?)</t[dh]>", row, re.S)
            if not cells or _strip_tags(cells[0]).lower() != "all":
                continue
            link = DOWNLOAD_LINK.search(row)
            if not link:
                continue
            url = requests.compat.urljoin(landing_page, html.unescape(link.group(1)))
            for spec in matched:
                found[spec.dataset].append(
                    ResolvedDownload(spec.dataset, link.group(2), url)
                )

    resolved: dict[Dataset, ResolvedDownload] = {}
    for spec in DATASETS:
        matches = found[spec.dataset]
        if len(matches) != 1:
            raise CampaignFinanceRefusal(
                f"Expected exactly 1 'All' download for {spec.key} under a heading "
                f"containing {spec.heading!r} on {landing_page}, found "
                f"{len(matches)}. The page's labels have changed, so refusing to "
                "guess which file is which."
            )
        resolved[spec.dataset] = matches[0]
    return resolved


# --- Step 2: fetch, and prove it is the right file ---------------------------


def fetch_download(
    http: requests.Session,
    spec: DatasetSpec,
    resolved: ResolvedDownload,
    directory: str,
) -> FetchedFile:
    """Stream one download to disk, hashing the response bytes as they arrive.

    The hash is of the *bytes*, never of decoded text: the ``content_hash`` helper
    in ``minnesota.py`` takes a ``str`` and must not be reused for file identity.

    Two content checks, because the response itself cannot tell you the file
    arrived: a stale download number answers HTTP 200 with an HTML error page
    typed ``application/octet-stream``, with no ``Content-Length``, over a chunked
    transfer that ignores ``Range``. A failure here is recorded on the returned
    object rather than raised, so the bytes are still retained for diagnosis.
    """
    last_error: Optional[Exception] = None
    for attempt in range(1, MAX_ATTEMPTS + 1):
        started_at = datetime.now(UTC)
        path = os.path.join(directory, f"{spec.key}.csv")
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
            raise CampaignFinanceRefusal(
                f"Could not download {spec.key} from {resolved.url} after "
                f"{MAX_ATTEMPTS} attempts: {error}"
            ) from error

        fetched = FetchedFile(
            spec=spec,
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
        fetched.content_error = _content_error(spec, fetched)
        return fetched

    raise CampaignFinanceRefusal(  # pragma: no cover - the loop always returns or raises
        f"Could not download {spec.key}: {last_error}"
    )


def _disposition_filename(headers: dict[str, str]) -> Optional[str]:
    disposition = headers.get("Content-Disposition") or ""
    match = re.search(r'filename="?([^"]+)"?', disposition)
    return match.group(1) if match else None


def _content_error(spec: DatasetSpec, fetched: FetchedFile) -> Optional[str]:
    name = fetched.disposition_filename or ""
    if spec.disposition_marker not in name:
        return (
            f"The download did not name the {spec.key} file "
            f"(Content-Disposition filename: {name!r}). A stale download number "
            "answers HTTP 200 with an HTML error page, so this is refused."
        )
    try:
        # utf-8-sig, so a byte-order mark the Board might add one day is a
        # cosmetic difference rather than a header mismatch. The identity hash is
        # of the raw bytes, so nothing about the file's identity changes here.
        with open(fetched.path, encoding="utf-8-sig", newline="") as handle:
            first_line = handle.readline().rstrip("\r\n")
    except (OSError, UnicodeDecodeError) as error:
        return f"Could not read the first line of the {spec.key} download: {error}"
    if first_line != spec.header_line:
        return (
            f"The {spec.key} download's first line is not the expected column "
            f"header. Got {first_line[:160]!r}"
        )
    return None


# --- Step 5: parse, type and measure in one pass -----------------------------


def _blank(value: str) -> bool:
    return value.strip() == ""


def parse_and_measure(
    spec: DatasetSpec,
    source_path: str,
    snapshot_id: uuid.UUID,
    copy_path: str,
) -> Measurements:
    """Read the file once: type every value, measure it, and write the COPY file.

    Parsed with Python's **default** ``csv`` reader and nothing else, because the
    Board's files are not valid CSV and every other setting loses real money. It
    escapes an inner double quote with a backslash, which RFC 4180 does not allow
    (``"Amazon.com, 1.5\\" Micro Rod"``), and in the expenditures file the same 2
    characters also appear where the backslash is literal data and the quote
    genuinely closes the field — so no mechanical rule reads both correctly.
    Measured on the 11 Aug 2026 files: ``strict=True`` rejects 18 contribution and
    17 expenditure records of real money, ``escapechar="\\\\"`` damages 608 rows
    across the 3 files to fix 35, and substituting ``\\"`` for ``""`` destroys 42
    expenditure records. The default reader is the only setting that keeps every
    row with every field in its right column. The cost is a stray backslash or
    trailing quote inside one free-text field on 35 records, which never reaches a
    name, amount, date, registration number or zip — so those records are counted,
    not repaired.

    Because of that, a parse error can never be the truncation guard. §4.3's count
    and size bands are all there is.
    """
    measured = Measurements(column_names=[column.source for column in spec.columns])
    fingerprints: list[bytes] = []
    filers: set[str] = set()
    expected = len(spec.columns)
    blanks = {column.source: 0 for column in spec.columns}
    years: dict[str, int] = {}
    sources = [column.source for column in spec.columns]
    # Positions in the typed row, which starts with the snapshot id and the record
    # number, so a source column at index i lands at i + 2.
    amount_at = 2 + sources.index("Amount")
    year_at = 2 + next(
        index for index, column in enumerate(spec.columns) if column.kind == "year"
    )
    filer_at = next(
        index
        for index, column in enumerate(spec.columns)
        if column.attribute == spec.filer_attribute
    )
    date_sources = [column.source for column in spec.columns if column.kind == "date"]

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
            for column, value in zip(spec.columns, raw):
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

            amount = typed[amount_at]
            if amount is not None:
                measured.amount_sum += amount
                if amount < 0:
                    measured.negative_amount_sum += amount
            year = typed[year_at]
            if year is not None:
                key = str(year)
                years[key] = years.get(key, 0) + 1
            filer = raw[filer_at].strip()
            if filer:
                filers.add(filer)
            # A 16-byte digest per record rather than the record itself: a list of
            # 583,152 tuples of 15 strings costs hundreds of megabytes. Kept with
            # duplicates, because 20,524 records in one real download repeat another
            # record and a set would throw that multiplicity away.
            fingerprints.append(
                hashlib.blake2b(
                    "\x1f".join(raw).encode("utf-8", "surrogatepass"), digest_size=16
                ).digest()
            )
            # The exact signature of the Board's backslash-escaped quote once the
            # default reader has consumed the closing quote into the value. This
            # definition counts 18 contribution and 17 expenditure records on the
            # 11 Aug 2026 files, which is precisely the set `strict=True` rejects.
            if any("\\" in cell and cell.endswith('"') for cell in raw):
                measured.malformed_quote_record_count += 1

    measured.distinct_row_count = len(set(fingerprints))
    measured.distinct_filer_count = len(filers)
    measured.rows_by_year = dict(sorted(years.items()))
    measured.blank_counts_by_column = blanks
    measured.blank_date_count = sum(blanks[source] for source in date_sources)
    if not measured.errors:
        # Sorted, so the same records in a different order hash the same. Sorting
        # rather than combining with XOR or addition on purpose: XOR cancels a
        # repeated record against its own copy, and this source publishes 20,524 of
        # those.
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
        # Kept exactly as printed. Trimming would change what the Board published,
        # and a leading zero on a zip is the difference between 2 real places.
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
    if column.kind == "date":
        if not ISO_DATE.match(stripped):
            raise ValueError(
                f"{stripped!r} is not an ISO date. Every one of the 1,002,142 rows "
                "measured on 11 Aug 2026 was, so this is a change in the source, "
                "not a row to skip"
            )
        try:
            return date.fromisoformat(stripped)
        except ValueError:
            raise ValueError(f"{stripped!r} is not a real calendar date") from None
    if column.kind == "year":
        if not FOUR_DIGIT_YEAR.match(stripped):
            raise ValueError(f"{stripped!r} is not a 4-digit year")
        return int(stripped)
    raise AssertionError(f"unknown column kind {column.kind!r}")  # pragma: no cover


# --- Step 6: validate -------------------------------------------------------


def validate(
    spec: DatasetSpec,
    fetched: FetchedFile,
    measured: Optional[Measurements],
    baseline: Optional[Any],
    *,
    operator_approved: bool,
) -> list[Check]:
    """Compare a candidate against the live release's snapshot for the same file.

    Comparisons are against **recorded measurements**, never against old rows, so
    a superseded set's rows can be pruned without losing the ability to check the
    next download.

    ``operator_approved`` waives the comparison checks only, for an operator who
    has named the exact hashes they reviewed. It never waives a structural check:
    a header that does not match, a record with the wrong number of fields, a date
    that is not a date and an amount that would have to be rounded are not
    judgement calls, and there is no flag that lets one through.
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

    add(
        "previous_release_to_compare_against",
        baseline is not None,
        "no published release holds this dataset yet, so there is nothing to "
        "compare against. Review the measurements and publish by naming the 3 "
        "hashes",
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
            "amount_sum_within_band",
            AMOUNT_SUM_BAND.contains(
                float(measured.amount_sum), float(baseline.amount_sum or 0)
            ),
            f"{measured.amount_sum} against {baseline.amount_sum} published",
            comparison=True,
        )
        baseline_repeat = _baseline_repeat_fraction(baseline)
        add(
            "repeat_row_share_within_band",
            baseline_repeat is None
            or abs(measured.repeat_fraction - baseline_repeat)
            <= REPEAT_FRACTION_TOLERANCE,
            f"{measured.repeat_fraction:.4%} of records repeat another record, "
            f"against {baseline_repeat:.4%} published"
            if baseline_repeat is not None
            else "the published snapshot recorded no repeat share",
            comparison=True,
        )
        lost = _years_that_lost_rows(measured, baseline)
        add(
            "no_published_year_lost_rows",
            not lost,
            "; ".join(lost) if lost else f"{len(measured.rows_by_year)} years checked",
            comparison=True,
        )
        gained = _columns_that_gained_blanks(spec, measured, baseline)
        add(
            "no_new_blank_dates_or_amounts",
            not gained,
            "; ".join(gained)
            if gained
            else "every dated and every money column is as full as before",
            comparison=True,
        )

    # Two checks §4.3 asks for that this loader cannot run. Recorded as not run,
    # with the reason, never as passed.
    checks.append(
        Check(
            "reported_totals_reconcile",
            "not_run",
            "needs each filing's official total. The Board's per-filer totals "
            "route is established (§9.1) but nothing in this repo fetches or "
            "stores those figures yet, so there is no total to reconcile against",
        )
    )
    checks.append(
        Check(
            "registration_numbers_resolve_to_a_known_filer",
            "not_run",
            "needs the Board's registered-filer directory (§9.7). The route is "
            "established and #1354's matcher reads it live, but no table holds it, "
            "and yesterday's payments are not a filer directory",
        )
    )
    return checks


def _baseline_repeat_fraction(baseline: Any) -> Optional[float]:
    if not baseline.row_count or baseline.distinct_row_count is None:
        return None
    return 1 - (baseline.distinct_row_count / baseline.row_count)


def _years_that_lost_rows(measured: Measurements, baseline: Any) -> list[str]:
    published = baseline.rows_by_year or {}
    lost: list[str] = []
    for year, was in sorted(published.items()):
        now = measured.rows_by_year.get(year, 0)
        allowed = max(YEAR_ROW_LOSS_FLOOR, int(was * YEAR_ROW_LOSS_FRACTION))
        if was - now > allowed:
            lost.append(f"{year} fell from {was:,} rows to {now:,}")
    return lost


def _columns_that_gained_blanks(
    spec: DatasetSpec, measured: Measurements, baseline: Any
) -> list[str]:
    """Only dated and money columns, which is what §4.3 asks for.

    Every column's blank count is recorded on the snapshot for an operator to
    read; enforcing all of them would quarantine a set the first time a name or an
    employer arrived empty, which is ordinary.
    """
    published = baseline.blank_counts_by_column or {}
    gained: list[str] = []
    for column in spec.columns:
        if column.kind not in ("date", "money"):
            continue
        was = published.get(column.source)
        now = measured.blank_counts_by_column.get(column.source, 0)
        if was == 0 and now > 0:
            gained.append(f"{column.source} had no blanks and now has {now:,}")
    return gained


# --- Steps 3, 7 and 8: the three transactions -------------------------------


def gzip_to(source_path: str, destination_path: str) -> tuple[str, int]:
    """Compress with ``mtime=0``, so identical input always compresses identically.

    Without that the same file gets a new timestamp in its gzip header every run
    and an unchanged download would look like a new one in the store.
    """
    with (
        open(source_path, "rb") as source,
        open(destination_path, "wb") as raw,
        gzip.GzipFile(fileobj=raw, mode="wb", mtime=0) as compressed,
    ):
        shutil.copyfileobj(source, compressed, COPY_CHUNK_BYTES)
    return sha256_of_file(destination_path), os.path.getsize(destination_path)


def object_key(spec: DatasetSpec, content_hash: str) -> str:
    return f"campaign-finance/{spec.key}/{content_hash}.csv.gz"


def find_snapshot(db: Session, outcome: DatasetOutcome) -> Optional[Any]:
    """The snapshot already holding this download's records, if there is one.

    Matched on the record-set hash, not on the bytes: the Board's export shuffles
    its rows, so the same data arrives with a different byte hash every time. An
    unparseable download has no record set, so those fall back to the bytes.
    """
    measured = outcome.measurements
    if measured is not None and measured.record_set_hash:
        return db.scalars(
            select(schema.CampaignFinanceSnapshot).where(
                schema.CampaignFinanceSnapshot.dataset == outcome.spec.dataset,
                schema.CampaignFinanceSnapshot.record_set_hash
                == measured.record_set_hash,
            )
        ).one_or_none()
    return db.scalars(
        select(schema.CampaignFinanceSnapshot).where(
            schema.CampaignFinanceSnapshot.dataset == outcome.spec.dataset,
            schema.CampaignFinanceSnapshot.content_hash == outcome.fetched.content_hash,
        )
    ).one_or_none()


def record_fetch(
    db: Session,
    outcome: DatasetOutcome,
    store: Any,
    directory: str,
    ingestion_run_id: Optional[uuid.UUID],
) -> tuple[uuid.UUID, bool]:
    """Store the bytes and record the fetch, then commit — before any validation.

    Its own transaction on purpose. A failure record written inside the transaction
    that later fails rolls back with it, which is how "the bad download is retained"
    becomes "the bad download is gone". A download that could not be parsed is
    stored and recorded here too, for the same reason.

    **A body is stored only for records we have not seen before.** Because the
    export shuffles, keeping every download's bytes would mean 7 to 10 GB a year of
    reshuffled copies of identical data. What is kept instead is one body per
    distinct record set, plus a fetch observation per download carrying that
    download's own byte hash and size — so the shuffling stays on the record and
    measurable without paying for it.

    Returns the snapshot id and whether the records were already on file.
    """
    existing = find_snapshot(db, outcome)
    if existing is None:
        # Two runs can reach here with the same new records and both find nothing.
        # The unique index on (dataset, record_set_hash) is what actually decides, so
        # the loser re-reads rather than dying: without this, a second concurrent
        # import ends in an IntegrityError traceback instead of correctly finding that
        # these records are already on file.
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
    outcome: DatasetOutcome,
    store: Any,
    directory: str,
    ingestion_run_id: Optional[uuid.UUID],
) -> tuple[uuid.UUID, bool]:
    """Create the snapshot for records not on file, store its bytes, record the fetch."""
    spec = outcome.spec
    fetched = outcome.fetched
    measured = outcome.measurements
    snapshot = schema.CampaignFinanceSnapshot(
        # Minted before the parse, so the COPY file this run already wrote carries
        # the right id.
        id=outcome.candidate_snapshot_id,
        dataset=spec.dataset,
        download_id=fetched.download_id,
        source_url=fetched.requested_url,
        content_disposition_filename=fetched.disposition_filename,
        content_hash=fetched.content_hash,
        record_set_hash=(measured.record_set_hash or None) if measured else None,
        byte_size=fetched.byte_size,
        status=SnapshotStatus.quarantined
        if fetched.content_error or (measured and measured.errors)
        else SnapshotStatus.fetched,
        error_text=fetched.content_error,
        validation_json={},
    )
    db.add(snapshot)
    db.flush()
    key = object_key(spec, fetched.content_hash)
    compressed_path = os.path.join(directory, f"{spec.key}.csv.gz")
    compressed_hash, compressed_size = gzip_to(fetched.path, compressed_path)
    # Read back and verify before the row exists. An orphaned object is recoverable;
    # a row pointing at a missing body destroys the evidence it claims to have.
    store.put_and_verify(key, compressed_path, compressed_hash)
    os.remove(compressed_path)
    db.add(
        schema.CampaignFinanceSnapshotBody(
            snapshot_id=snapshot.id,
            object_key=key,
            compressed_hash=compressed_hash,
            compressed_byte_size=compressed_size,
            compression="gzip",
        )
    )
    return _record_observation(db, outcome, snapshot, ingestion_run_id, reused=False)


def _record_observation(
    db: Session,
    outcome: DatasetOutcome,
    snapshot: Any,
    ingestion_run_id: Optional[uuid.UUID],
    *,
    reused: bool,
) -> tuple[uuid.UUID, bool]:
    """Append this download to the record, with its own byte hash and size.

    Every download gets one of these whether or not anything changed, which is what
    makes "all 3 files were confirmed current in the same run" a recorded fact. It is
    also where a reshuffled download's byte hash is kept when its bytes were not.
    """
    fetched = outcome.fetched
    db.add(
        schema.CampaignFinanceFetchObservation(
            snapshot_id=snapshot.id,
            dataset=outcome.spec.dataset,
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


def live_release(db: Session) -> Optional[Any]:
    """Which release is live, read from the database rather than from memory.

    ``populate_existing=True`` is load-bearing, not tidiness. ``publish()`` moves the
    pointer with a statement rather than through the object, and this repo's session
    factory sets ``expire_on_commit=False``, so a caller that still holds the pointer
    object gets the value it had *before* the publish. That is not cosmetic: with a
    stale pointer, ``prune()`` computes an empty keep-set and **deletes the rows of
    the release that was just published** — proved in
    ``test_prune_reads_the_pointer_from_the_database_not_from_memory``, which reported
    3 snapshots and every row pruned moments after they were published. It normally
    hides because the identity map holds objects weakly, so an unreferenced pointer is
    collected and the next read goes to the database anyway; a defect that depends on
    garbage-collection timing is worse than one that always fires, not better.
    """
    pointer = db.get(schema.CampaignFinanceCurrentRelease, True, populate_existing=True)
    if pointer is None or pointer.release_id is None:
        return None
    return db.get(
        schema.CampaignFinanceRelease, pointer.release_id, populate_existing=True
    )


def baseline_snapshots(db: Session) -> dict[Dataset, Any]:
    """The snapshot per dataset that the live release published, if any."""
    release = live_release(db)
    if release is None:
        return {}
    found: dict[Dataset, Any] = {}
    for dataset, column in RELEASE_SNAPSHOT_COLUMN.items():
        snapshot = db.get(schema.CampaignFinanceSnapshot, getattr(release, column))
        if snapshot is not None:
            found[dataset] = snapshot
    return found


def ensure_pointer_row(db: Session) -> None:
    """Make sure the single pointer row exists, in its own committed transaction.

    ``SELECT ... FOR UPDATE`` locks nothing when there is no row, so without this
    the very first two concurrent imports would not see each other.
    """
    db.execute(
        text(
            "INSERT INTO cf_current_release (id, release_id) VALUES (true, NULL) "
            "ON CONFLICT (id) DO NOTHING"
        )
    )
    db.commit()


def rows_present(db: Session, spec: DatasetSpec, snapshot_id: uuid.UUID) -> int:
    return int(
        db.scalar(
            select(func.count())
            .select_from(spec.table)
            .where(spec.table.snapshot_id == snapshot_id)
        )
        or 0
    )


def copy_rows(db: Session, spec: DatasetSpec, copy_path: str) -> None:
    """Load one file's rows with ``COPY``, inside the caller's transaction.

    583,152 rows land in about 1.6 seconds this way, which is what keeps the
    publish transaction short enough to hold the pointer lock through it.
    """
    columns = ", ".join(
        f'"{name}"' for name in ("snapshot_id", "row_number", *spec.attributes)
    )
    statement = (
        f'COPY "{spec.table.__tablename__}" ({columns}) FROM STDIN WITH (FORMAT csv)'
    )
    connection = db.connection().connection.driver_connection
    with connection.cursor() as cursor, cursor.copy(statement) as copy:
        with open(copy_path, "rb") as handle:
            for chunk in iter(lambda: handle.read(COPY_CHUNK_BYTES), b""):
                copy.write(chunk)


def rows_from_retained_body(
    db: Session,
    outcome: DatasetOutcome,
    snapshot: Any,
    store: Any,
    directory: str,
) -> str:
    """Rebuild a snapshot's COPY file from the bytes we kept, and prove they are them.

    Needed whenever rows must be (re)loaded for a snapshot this run did not create —
    a set whose rows were pruned and is being published again. This run's own
    download holds the same records in a different order, so numbering from it would
    point every citation at the wrong line of the retained file.

    The rebuilt record-set hash is checked against the one recorded on the snapshot,
    which is a full integrity check of the stored object rather than a formality: if
    the body has been altered or truncated in the store, this is where it stops.
    """
    spec = outcome.spec
    body = db.get(schema.CampaignFinanceSnapshotBody, snapshot.id)
    if body is None:
        raise CampaignFinanceRefusal(
            f"{spec.key} snapshot {snapshot.id} has no retained body, so its rows "
            "cannot be rebuilt with the record numbers its citations use."
        )
    compressed_path = os.path.join(directory, f"{spec.key}.retained.csv.gz")
    source_path = os.path.join(directory, f"{spec.key}.retained.csv")
    store.get(body.object_key, compressed_path)
    with gzip.open(compressed_path, "rb") as compressed, open(source_path, "wb") as raw:
        shutil.copyfileobj(compressed, raw, COPY_CHUNK_BYTES)
    copy_path = os.path.join(directory, f"{spec.key}.retained.copy.csv")
    rebuilt = parse_and_measure(spec, source_path, snapshot.id, copy_path)
    if rebuilt.errors or rebuilt.record_set_hash != snapshot.record_set_hash:
        raise CampaignFinanceRefusal(
            f"{spec.key} retained body {body.object_key} no longer reproduces the "
            f"records recorded against snapshot {snapshot.id}. Refusing to publish "
            f"rows we cannot trace: {'; '.join(rebuilt.errors) or 'hash mismatch'}"
        )
    return copy_path


def publish(
    db: Session,
    outcomes: list[DatasetOutcome],
    *,
    fetch_started_at: datetime,
    fetch_completed_at: datetime,
    ingestion_run_id: Optional[uuid.UUID],
    notes: Optional[str],
    store: Any = None,
    directory: Optional[str] = None,
) -> uuid.UUID:
    """Load the rows and move the live pointer, in one transaction.

    The pointer row is taken with ``FOR UPDATE`` and the live release re-read
    inside the lock, then a candidate whose fetch window opened before the live
    release's is refused. Without that, two overlapping imports let the one that
    *started* first finish last and replace newer data with older data — a "one
    published release" rule limits quantity, not age.
    """
    db.execute(text("SELECT pg_advisory_xact_lock(:key)"), {"key": PUBLISH_LOCK_KEY})
    pointer = db.execute(
        text("SELECT release_id FROM cf_current_release WHERE id = true FOR UPDATE")
    ).one_or_none()
    current_release_id = pointer[0] if pointer is not None else None
    # populate_existing, for the same reason as in live_release(): the fetch window
    # this comparison turns on has to come from the database inside the lock, never
    # from a copy this session read before the lock existed.
    current = (
        db.get(
            schema.CampaignFinanceRelease, current_release_id, populate_existing=True
        )
        if current_release_id
        else None
    )
    if current is not None and current.fetch_started_at > fetch_started_at:
        raise CampaignFinanceRefusal(
            "Refusing to publish: the live release was fetched starting "
            f"{current.fetch_started_at.isoformat()}, after this run started "
            f"{fetch_started_at.isoformat()}. Replacing newer data with older data "
            "is the one thing the pointer row exists to prevent. Re-run to fetch "
            "the current files."
        )

    for outcome in outcomes:
        spec = outcome.spec
        snapshot = db.get(schema.CampaignFinanceSnapshot, outcome.snapshot_id)
        if snapshot is None:  # pragma: no cover - written moments ago
            raise CampaignFinanceRefusal(f"{spec.key} snapshot vanished before publish")
        measured = outcome.measurements
        if measured is None or outcome.copy_path is None:  # pragma: no cover
            raise CampaignFinanceRefusal(
                f"{spec.key} reached publication without being parsed"
            )
        # Re-read inside the lock: the snapshot must still hold the records this run
        # validated. Compared on the record-set hash, because the byte hash on the
        # snapshot belongs to whichever download's bytes were kept, which is not
        # this run's when the records were already on file.
        if snapshot.record_set_hash != measured.record_set_hash:  # pragma: no cover
            raise CampaignFinanceRefusal(
                f"{spec.key} snapshot {snapshot.id} no longer holds the records this "
                "run validated"
            )
        # "Already loaded" has to mean the rows are really there. A snapshot left
        # saying loaded with no rows is exactly what pruning could produce, and
        # reusing it would publish a dataset with nothing in it.
        loaded = snapshot.status == SnapshotStatus.loaded and rows_present(
            db, spec, snapshot.id
        ) == (snapshot.row_count or -1)
        if loaded:
            outcome.reused_rows = True
        else:
            source = (
                outcome.copy_path
                if outcome.copy_file_matches_snapshot
                else rows_from_retained_body(
                    db, outcome, snapshot, store, directory or ""
                )
            )
            db.execute(delete(spec.table).where(spec.table.snapshot_id == snapshot.id))
            copy_rows(db, spec, source)
        snapshot.status = SnapshotStatus.loaded
        snapshot.row_count = measured.row_count
        snapshot.column_names = measured.column_names
        snapshot.amount_sum = measured.amount_sum
        snapshot.negative_amount_sum = measured.negative_amount_sum
        snapshot.blank_date_count = measured.blank_date_count
        snapshot.distinct_row_count = measured.distinct_row_count
        snapshot.distinct_filer_count = measured.distinct_filer_count
        snapshot.rows_by_year = measured.rows_by_year
        snapshot.blank_counts_by_column = measured.blank_counts_by_column
        snapshot.malformed_quote_record_count = measured.malformed_quote_record_count
        snapshot.validation_json = {
            "checks": [check.as_json() for check in outcome.checks]
        }
        snapshot.error_text = None

    by_dataset = {outcome.spec.dataset: outcome for outcome in outcomes}
    release = schema.CampaignFinanceRelease(
        contributions_snapshot_id=by_dataset[Dataset.contributions].snapshot_id,
        expenditures_snapshot_id=by_dataset[Dataset.expenditures].snapshot_id,
        independent_expenditures_snapshot_id=by_dataset[
            Dataset.independent_expenditures
        ].snapshot_id,
        status=ReleaseStatus.published,
        fetch_started_at=fetch_started_at,
        fetch_completed_at=fetch_completed_at,
        published_at=datetime.now(UTC),
        ingestion_run_id=ingestion_run_id,
        notes=notes,
    )
    db.add(release)
    db.flush()
    if current is not None:
        current.status = ReleaseStatus.superseded
        current.superseded_at = datetime.now(UTC)
    db.execute(
        text("UPDATE cf_current_release SET release_id = :release WHERE id = true"),
        {"release": release.id},
    )
    db.commit()
    return release.id


def prune(db: Session) -> tuple[int, int]:
    """Delete the parsed rows of every snapshot the live release does not name.

    A separate transaction after the publish commits, so a crash here leaves extra
    rows rather than a half-published set. The status change and the delete are in
    the *same* transaction on purpose: a snapshot left saying ``loaded`` with no
    rows would be reused as "unchanged" the next time the Board republishes those
    exact bytes, and would publish a dataset with nothing in it.

    **The release this one just superseded keeps its rows, for one generation.** A
    reader resolves the live release in one statement and queries rows in the next,
    and each statement sees the newest committed state, so deleting the previous set
    the instant a new one lands hands a request that started moments earlier **zero
    rows** — which a page renders as "this committee has no payments", the exact
    missing-versus-zero failure `.claude/rules/grounded-answers.md` rule 12 forbids.
    One spare generation is 51 MB measured, against 8 GB of database disk, and the
    *next* publish removes it, so nothing accumulates.

    Only rows are pruned. Every body is kept indefinitely, including every
    quarantined one, because the checks compare recorded measurements rather than
    old rows and the Board keeps no archive of its own.
    """
    release = live_release(db)
    keep: set[uuid.UUID] = set()
    if release is not None:
        keep |= {
            getattr(release, column) for column in RELEASE_SNAPSHOT_COLUMN.values()
        }
    for older in db.scalars(
        select(schema.CampaignFinanceRelease)
        .where(schema.CampaignFinanceRelease.status == ReleaseStatus.superseded)
        .order_by(schema.CampaignFinanceRelease.superseded_at.desc())
        .limit(KEEP_SUPERSEDED_GENERATIONS)
    ).all():
        keep |= {getattr(older, column) for column in RELEASE_SNAPSHOT_COLUMN.values()}
    snapshots = 0
    rows = 0
    for spec in DATASETS:
        conditions = [
            schema.CampaignFinanceSnapshot.dataset == spec.dataset,
            schema.CampaignFinanceSnapshot.status == SnapshotStatus.loaded,
        ]
        if keep:
            conditions.append(schema.CampaignFinanceSnapshot.id.notin_(keep))
        stale = db.scalars(
            select(schema.CampaignFinanceSnapshot).where(*conditions)
        ).all()
        for snapshot in stale:
            deleted = db.execute(
                delete(spec.table).where(spec.table.snapshot_id == snapshot.id)
            ).rowcount
            snapshot.status = SnapshotStatus.pruned
            snapshots += 1
            rows += deleted or 0
    db.commit()
    return snapshots, rows


def quarantine(db: Session, outcome: DatasetOutcome) -> None:
    snapshot = db.get(schema.CampaignFinanceSnapshot, outcome.snapshot_id)
    if snapshot is None:  # pragma: no cover
        return
    if snapshot.status != SnapshotStatus.loaded:
        snapshot.status = SnapshotStatus.quarantined
    snapshot.validation_json = {"checks": [check.as_json() for check in outcome.checks]}
    # None, not an empty string, when this file itself passed: the run stopped
    # because a sibling file failed, and this snapshot has no fault to record.
    snapshot.error_text = "; ".join(check.detail for check in outcome.blocked) or None
    measured = outcome.measurements
    if measured is not None and not measured.errors:
        snapshot.row_count = measured.row_count
        snapshot.column_names = measured.column_names
        snapshot.amount_sum = measured.amount_sum
        snapshot.negative_amount_sum = measured.negative_amount_sum
        snapshot.blank_date_count = measured.blank_date_count
        snapshot.distinct_row_count = measured.distinct_row_count
        snapshot.distinct_filer_count = measured.distinct_filer_count
        snapshot.rows_by_year = measured.rows_by_year
        snapshot.blank_counts_by_column = measured.blank_counts_by_column
        snapshot.malformed_quote_record_count = measured.malformed_quote_record_count
    db.commit()


# --- The whole cycle --------------------------------------------------------


def load_campaign_finance(
    db: Session,
    *,
    http: Optional[requests.Session] = None,
    store: Any = None,
    dry_run: bool = False,
    publish_hashes: Optional[Iterable[str]] = None,
    landing_page: str = LANDING_PAGE,
    log=print,
) -> LoadReport:
    """Run the whole cycle once and report what happened.

    ``publish_hashes`` is how an operator publishes a set the comparison checks
    quarantined, including the very first import, which has nothing to compare
    against. All 3 record-set hashes must be named, so a set cannot be waved through
    by accident, and they are recorded on the release. Structural checks are never
    waived by it. Record-set hashes rather than byte hashes because the export
    shuffles: a byte hash an operator read off one run may not exist by the next one,
    while the record-set hash survives as long as the data does.

    One consequence of parsing before storing: a crash *during* the parse loses that
    download's bytes. A parse *failure* does not — the file is stored and recorded as
    quarantined, which is what §4.3 asks for. The trade buys not keeping 7 to 10 GB a
    year of reshuffled copies of identical data, and the irreplaceable case, a
    published set, is always stored before it is published.
    """
    http = http or _http_session()
    approved = {value.strip().lower() for value in (publish_hashes or []) if value}
    report = LoadReport(dry_run=dry_run)

    with tempfile.TemporaryDirectory(prefix="alethical-cf-") as directory:
        resolved = resolve_downloads(http, landing_page)
        log(f"resolved 3 downloads from {landing_page}")

        ingestion_run_id = None
        if not dry_run:
            ensure_pointer_row(db)
            run = schema.IngestionRun(
                adapter="minnesota_campaign_finance",
                target_type="campaign_finance_release",
                status=schema.IngestionStatus.running,
                stats={},
            )
            db.add(run)
            db.commit()
            ingestion_run_id = run.id
            store = store or _store_from_env()

        fetch_started_at = datetime.now(UTC)
        for spec in DATASETS:
            fetched = fetch_download(http, spec, resolved[spec.dataset], directory)
            log(
                f"{spec.key}: {fetched.byte_size:,} bytes, "
                f"sha256 {fetched.content_hash[:12]}"
                + (f" — {fetched.content_error}" if fetched.content_error else "")
            )
            report.outcomes.append(DatasetOutcome(spec=spec, fetched=fetched))
        fetch_completed_at = datetime.now(UTC)

        for outcome in report.outcomes:
            spec = outcome.spec
            if outcome.fetched.content_error is not None:
                continue
            outcome.copy_path = os.path.join(directory, f"{spec.key}.copy.csv")
            outcome.measurements = parse_and_measure(
                spec,
                outcome.fetched.path,
                outcome.candidate_snapshot_id,
                outcome.copy_path,
            )
            measured = outcome.measurements
            log(
                f"{spec.key}: {measured.row_count:,} records, "
                f"total {measured.amount_sum}, "
                f"{measured.distinct_row_count:,} distinct, "
                f"{measured.malformed_quote_record_count} with the source's quote "
                f"escape, records {measured.record_set_hash[:12] or 'unparsed'}"
            )

        if not dry_run:
            for outcome in report.outcomes:
                outcome.snapshot_id, reused = record_fetch(
                    db, outcome, store, directory, ingestion_run_id
                )
                if reused:
                    log(f"{outcome.spec.key}: these records were already on file")

        # Read even on a dry run: a dry run's whole point is to show what the real
        # checks would say, and every one of them compares against the live
        # release's recorded measurements.
        baselines = baseline_snapshots(db)
        for outcome in report.outcomes:
            baseline = baselines.get(outcome.spec.dataset)
            measured = outcome.measurements
            outcome.unchanged = bool(
                baseline is not None
                and measured is not None
                and measured.record_set_hash
                and baseline.record_set_hash == measured.record_set_hash
            )

        if not dry_run and all(outcome.unchanged for outcome in report.outcomes):
            usable = all(
                baselines[outcome.spec.dataset].status == SnapshotStatus.loaded
                and rows_present(db, outcome.spec, baselines[outcome.spec.dataset].id)
                == (baselines[outcome.spec.dataset].row_count or -1)
                for outcome in report.outcomes
            )
            if usable:
                report.no_change = True
                _finish_run(db, ingestion_run_id, report)
                log("all 3 files hold the records already published")
                return report

        for outcome in report.outcomes:
            measured = outcome.measurements
            outcome.checks = validate(
                outcome.spec,
                outcome.fetched,
                measured,
                baselines.get(outcome.spec.dataset),
                operator_approved=bool(
                    measured is not None and measured.record_set_hash in approved
                ),
            )

        blocked = [outcome for outcome in report.outcomes if outcome.blocked]
        if blocked:
            if approved and len(approved) != 3:
                log(
                    "note: --publish-hashes needs all 3 hashes, and waives only the "
                    "comparison checks"
                )
            if not dry_run:
                for outcome in report.outcomes:
                    quarantine(db, outcome)
                _finish_run(db, ingestion_run_id, report)
            report.refusal = (
                "quarantined "
                + ", ".join(outcome.spec.key for outcome in blocked)
                + ". Nothing was published and the previous set is still live."
            )
            return report

        if dry_run:
            return report

        notes = (
            "published by an operator naming the reviewed hashes: "
            + ", ".join(sorted(approved))
            if approved
            else None
        )
        report.release_id = publish(
            db,
            report.outcomes,
            fetch_started_at=fetch_started_at,
            fetch_completed_at=fetch_completed_at,
            ingestion_run_id=ingestion_run_id,
            notes=notes,
            store=store,
            directory=directory,
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
    run.stats = {
        "published": report.published,
        "no_change": report.no_change,
        "release_id": str(report.release_id) if report.release_id else None,
        "quarantined": [outcome.spec.key for outcome in report.quarantined],
        "rows": {
            outcome.spec.key: (
                outcome.measurements.row_count if outcome.measurements else None
            )
            for outcome in report.outcomes
        },
    }
    db.commit()


def _http_session() -> requests.Session:
    session = requests.Session()
    session.headers.update({"User-Agent": USER_AGENT})
    return session


def _store_from_env():
    from alethical.pipeline.raw_file_store import raw_file_store_from_env

    return raw_file_store_from_env()
