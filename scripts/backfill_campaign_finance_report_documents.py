#!/usr/bin/env python3
"""Fetch and keep every report document the Board will still serve (#1501, #1886).

Net: Minnesota is taking every campaign-finance report filed since 1 January 2022 off
its website, blacking out donors' street addresses, and putting it back, finishing about
19 November 2026. A filed report itemizes each named donor with their address, so the
redaction rewrites the document itself, and the Board publishes no archive (§4.5). **A
document not copied before the repost reaches it exists nowhere afterwards.** This asks
the Board for each document we do not hold and keeps the bytes.

Two things decide what to ask for, and they answer different questions:

* **A verdict already written** (``cf_stated_split``) names a document by its sha256, so
  the question is "do we hold *these bytes*". This was #1501's whole population.
* **The Board's own catalogue** (``cf_filing_report``) names a filing version and no
  hash, because nobody has ever fetched it, so the question is "do we hold *this filing
  version*". This is what reaches 2022 and 2023, where no verdict exists at all: the
  split check only ever ran on 2024 onward, so a verdict-driven pass cannot see them
  (#1886).

Three things a request can come back with, and all 3 are recorded:

* **The document.** Kept, and for a verdict-driven request its sha256 is compared with
  the one the verdict recorded, so a figure a page shows resolves to bytes we hold.
* **Different bytes than the verdict named.** The Board serves whatever is current at
  that address; an amendment filed since the check would answer with different bytes.
  Stored anyway (content-addressed, so it is a new object and overwrites nothing) and
  reported separately, because the verdict's own hash still names bytes nobody has.
* **Nothing at all.** HTTP 200 with an HTML page or a plain-text refusal, which is how
  the Board reports a document it does not serve (§9.4). Counted by shape.

**The catalogue's effective amendment index can be refused while a lower one serves, so
a catalogue-driven request steps down until one does.** Measured 1 September 2026: filer
20994's 2024 year-end is catalogued at effective index 2, and index 2 answers the 25-byte
"Requested file not found" while index 0 serves 21,262 bytes and index 1 serves 21,607;
filer 30753's 2024 year-end is catalogued at index 2 and serves at index 0. Asking only
at the catalogued index would drop documents the Board is still willing to hand over,
which is the one failure this run cannot afford. The version actually kept is recorded
under its own amendment index, so nothing claims to be a version it is not.

    # what it would ask for, and what is already kept -- no requests, no writes
    ALETHICAL_DATABASE_TARGET=production PYTHONPATH=. uv run \\
        python scripts/backfill_campaign_finance_report_documents.py \\
        --target production --dry-run

    # the real pass, about 2,200 requests at 0.25s apart plus download time
    ALETHICAL_DATABASE_TARGET=production PYTHONPATH=. uv run \\
        python scripts/backfill_campaign_finance_report_documents.py --target production

Safe to re-run and safe to interrupt: each document is committed as it lands, and a
document already kept is skipped without a request to the Board. It only ever adds --
nothing here deletes from either store, because §4.5 retains every body indefinitely.
The fetch date arrives on its own: ``cf_report_document.created_at`` carries it, so a
kept document is dated without this script storing anything extra.

**The second copy is a separate job.** Rows land in ``cf_report_document``, which
``scripts/mirror_raw_files.py`` finds from the schema, so the daily
``.github/workflows/mirror-raw-files.yml`` run copies them to Cloudflare R2 within a day
-- or run that script by hand straight after this one, which is what a deadline warrants.

Pacing is the same 0.25 seconds every other call to the Board in this repo uses. Roughly
5,300 requests over 2 hours on 12 August 2026 drew no refusal, throttle or block, which
is an observation about one night and not a limit the Board has published.

Design: ``docs/architecture/campaign-finance-system-design.md`` §4.5 (where the
downloaded files live, and for how long), §9.4 (report PDFs are a fallback, not a route)
and §9.6 (which version is effective).
"""

from __future__ import annotations

import argparse
import os
import sys
import tempfile
import time
from collections import Counter
from dataclasses import dataclass, field
from pathlib import Path
from typing import Optional

from sqlalchemy import create_engine, text
from sqlalchemy.orm import Session

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from alethical.db.models import CampaignFinanceFilerKind as FilerKind  # noqa: E402
from alethical.db.session import (  # noqa: E402
    NO_PREPARED_STATEMENTS,
    database_url_for_target,
    normalize_database_url,
)
from alethical.pipeline.campaign_finance_filings import (  # noqa: E402
    BOARD_BASE_URL,
    REQUEST_SPACING_SECONDS,
    http_session,
    live_filings_snapshot,
)
from alethical.pipeline.campaign_finance_report_document_store import (  # noqa: E402
    ALREADY_STORED,
    STORED,
    DocumentKeeper,
    FilingKey,
    stored_document_filings,
    stored_document_hashes,
)
from alethical.pipeline.campaign_finance_report_documents import (  # noqa: E402
    DocumentOutcome,
    fetch_document,
)
from alethical.pipeline.raw_file_store import raw_file_store_from_env  # noqa: E402

# Which question a wanted document came from. It decides the skip test -- a hash for a
# verdict, a filing version for the catalogue -- and whether a refusal may step down to
# an earlier amendment.
VERDICT = "verdict"
CATALOGUE = "catalogue"

# The catalogue's default reach. Year-end because that is the report every figure we
# publish is drawn from (§9.6: within a completed year the year-end report is the final
# snapshot), and because it is the only old report type the Board still serves --
# measured 1 September 2026, 30 of 30 non-year-end 2022 and 2023 reports answered with
# §9.4's 30,424-byte HTML page, across all 5 of the other types the catalogue names.
# 2022 because Minnesota's redaction order covers reports filed on or after
# 1 January 2022 and nothing earlier is at risk from it.
DEFAULT_REPORT_TYPE = "YE"
DEFAULT_FROM_YEAR = 2022

# Every verdict that names a document, with what the Board needs to serve it again. The
# filer kind decides the request's `type` field and lives on the filings snapshot that
# proved the reader, so it is read from there rather than guessed.
#
# Ordered oldest-year-first so the documents most likely to have been withdrawn are
# attempted before a long run has any chance of being interrupted.
_WANTED_SQL = """
SELECT s.registration_number,
       s.filing_year,
       s.report_type,
       s.amendment_index,
       s.document_hash,
       s.document_byte_size,
       f.kind
  FROM cf_stated_split s
  LEFT JOIN cf_filer f
    ON f.snapshot_id = s.filings_snapshot_id
   AND f.registration_number = s.registration_number
 WHERE s.document_hash IS NOT NULL
   AND s.report_type IS NOT NULL
   AND s.amendment_index IS NOT NULL
 ORDER BY s.filing_year, s.registration_number
"""

# Every report of one type the Board's own catalogue lists from a year onward, with the
# version it says is effective (§9.6) and the special-election flag that makes a second
# series its own report rather than a duplicate of the first.
#
# DISTINCT because the catalogue is keyed on (snapshot, row_number) and asserts no
# uniqueness of its own -- one filer-year can hold more than one row. Read from the
# **live** snapshot, so a run never asks the Board for a filing a superseded catalogue
# listed and the current one does not.
#
# `effective_amendment_index IS NULL` is left in rather than filtered out. §9.6 records
# that a null amendments array marks a report as never filed, so index 0 is expected to
# be refused -- but the whole cost of asking is one request, and a document the Board
# does serve here would otherwise be lost for good.
_CATALOGUED_SQL = """
SELECT DISTINCT r.registration_number,
       r.filing_year,
       r.report_type,
       r.effective_amendment_index,
       r.special_election,
       f.kind
  FROM cf_filing_report r
  JOIN cf_filer f
    ON f.snapshot_id = r.snapshot_id
   AND f.registration_number = r.registration_number
 WHERE r.snapshot_id = :snapshot_id
   AND r.report_type = :report_type
   AND r.filing_year >= :from_year
 ORDER BY r.filing_year, r.registration_number
"""


@dataclass
class Wanted:
    registration_number: str
    filing_year: int
    report_type: str
    amendment_index: int
    kind: FilerKind
    source: str = VERDICT
    special_election: bool = False
    # What a verdict recorded, so a re-fetch can be compared with it. None for a
    # catalogue-driven request: nobody has fetched these, so there is nothing to compare.
    document_hash: Optional[str] = None
    document_byte_size: int = 0
    # True when the catalogue lists the report but carries no amendment record for it.
    # §9.6 reads that as never filed; kept as its own count so a refusal here is not
    # reported as the Board withdrawing a document that was never there.
    no_amendment_record: bool = False

    @property
    def filing_key(self) -> FilingKey:
        """The filing version, keyed the way ``cf_report_document`` names one.

        The special-election flag belongs in it: a candidate in a special election files
        a whole second series, so one filer-year-amendment can name 2 genuinely
        different documents, and 7 of Minnesota's do. Leaving it out collapsed the pair
        onto one key and asked for only one of the 2.
        """
        return self.version_key(self.amendment_index)

    def version_key(self, amendment_index: int) -> FilingKey:
        """The same key at another amendment, for the step-down below."""
        return (
            self.registration_number,
            self.filing_year,
            self.report_type,
            amendment_index,
            self.special_election,
        )


@dataclass
class BackfillReport:
    """What the Board would still serve, and what it would not."""

    already_kept: int = 0
    same_document: int = 0
    different_document: int = 0
    newly_kept: int = 0
    earlier_version_kept: int = 0
    no_kind: list[str] = field(default_factory=list)
    refused: dict[str, int] = field(default_factory=dict)
    refused_examples: dict[str, str] = field(default_factory=dict)
    # By §9.4's own response shapes, which is the vocabulary the design doc uses and the
    # one a refusal rate has to be reported in.
    outcomes: Counter = field(default_factory=Counter)
    refused_no_amendment_record: int = 0
    served_by_year: Counter = field(default_factory=Counter)
    refused_by_year: Counter = field(default_factory=Counter)
    bytes_served: int = 0
    store_failures: int = 0

    @property
    def retrieved(self) -> int:
        return self.same_document + self.different_document + self.newly_kept

    @property
    def not_served(self) -> int:
        return sum(self.refused.values())

    def summary(self) -> str:
        lines = [
            f"already kept before this run:      {self.already_kept:>5}",
            f"fetched and kept, no verdict yet:  {self.newly_kept:>5}",
            f"fetched and kept, same document:   {self.same_document:>5}",
            f"fetched and kept, DIFFERENT bytes: {self.different_document:>5}",
            f"the Board would not serve:         {self.not_served:>5}",
            f"failed to store:                   {self.store_failures:>5}",
            f"bytes served:                      {self.bytes_served:,}",
        ]
        if self.earlier_version_kept:
            lines.append(
                f"\n{self.earlier_version_kept} document(s) were kept at an EARLIER "
                "amendment than the catalogue calls effective, because the effective one "
                "is not served and a lower one is. Each is recorded under the amendment "
                "index it actually is."
            )
        years = sorted(set(self.served_by_year) | set(self.refused_by_year))
        if years:
            lines.append("\nBy filing year:")
            lines.append("  year   served  not served")
            for year in years:
                lines.append(
                    f"  {year}   {self.served_by_year[year]:>6}  "
                    f"{self.refused_by_year[year]:>10}"
                )
        if self.outcomes:
            lines.append("\nBy §9.4 response shape:")
            for shape, count in sorted(self.outcomes.items(), key=lambda p: -p[1]):
                lines.append(f"  {count:>5}  {shape}")
        if self.refused_no_amendment_record:
            lines.append(
                f"\n{self.refused_no_amendment_record} of the refusals are reports the "
                "catalogue lists with no amendment record at all. §9.6 reads that as "
                "never filed, so a refusal there is the expected answer rather than a "
                "document withdrawn."
            )
        if self.refused:
            lines.append("\nWhy the Board would not serve them:")
            for reason, count in sorted(self.refused.items(), key=lambda p: -p[1]):
                lines.append(f"  {count:>5}  {reason}")
                lines.append(f"         e.g. {self.refused_examples[reason]}")
        if self.no_kind:
            lines.append(
                f"\n{len(self.no_kind)} verdict(s) name no filer kind, so the request "
                "cannot be built. The filings snapshot that proved the reader is gone "
                f"(its foreign key is SET NULL on delete): {', '.join(self.no_kind[:5])}"
            )
        if self.different_document:
            lines.append(
                "\nA DIFFERENT document means the Board now serves other bytes at that "
                "address, almost certainly an amendment filed since the check ran. The "
                "new bytes are kept; the hash the verdict recorded still names bytes "
                "nobody holds, and re-running the check will write a verdict against "
                "the document we now have."
            )
        return "\n".join(lines)


def wanted_documents(db: Session) -> list[Wanted]:
    rows = db.execute(text(_WANTED_SQL)).all()
    found: list[Wanted] = []
    for (
        registration_number,
        filing_year,
        report_type,
        amendment_index,
        document_hash,
        document_byte_size,
        kind,
    ) in rows:
        if kind is None:
            continue
        found.append(
            Wanted(
                registration_number=registration_number,
                filing_year=int(filing_year),
                report_type=report_type,
                amendment_index=int(amendment_index),
                kind=kind if isinstance(kind, FilerKind) else FilerKind(kind),
                source=VERDICT,
                document_hash=document_hash,
                document_byte_size=int(document_byte_size or 0),
            )
        )
    return found


def catalogued_documents(
    db: Session,
    *,
    report_type: str = DEFAULT_REPORT_TYPE,
    from_year: int = DEFAULT_FROM_YEAR,
) -> list[Wanted]:
    """Every report of one type the live catalogue lists from ``from_year`` onward.

    Empty when no filings snapshot is live, which is a real state rather than an error:
    a database that has never loaded the catalogue has nothing to discover from, and the
    verdict-driven half of the run still works.
    """
    snapshot = live_filings_snapshot(db)
    if snapshot is None:
        return []
    rows = db.execute(
        text(_CATALOGUED_SQL),
        {
            "snapshot_id": snapshot.id,
            "report_type": report_type,
            "from_year": from_year,
        },
    ).all()
    found: list[Wanted] = []
    for (
        registration_number,
        filing_year,
        row_report_type,
        effective_amendment_index,
        special_election,
        kind,
    ) in rows:
        if kind is None:
            continue
        found.append(
            Wanted(
                registration_number=registration_number,
                filing_year=int(filing_year),
                report_type=row_report_type,
                # 0 when the catalogue names no amendment: the original version is the
                # only one that could exist, and asking is one request.
                amendment_index=(
                    0
                    if effective_amendment_index is None
                    else int(effective_amendment_index)
                ),
                kind=kind if isinstance(kind, FilerKind) else FilerKind(kind),
                source=CATALOGUE,
                special_election=bool(special_election),
                no_amendment_record=effective_amendment_index is None,
            )
        )
    return found


def missing_kinds(db: Session) -> list[str]:
    rows = db.execute(
        text(
            "SELECT s.registration_number, s.filing_year FROM cf_stated_split s "
            "  LEFT JOIN cf_filer f ON f.snapshot_id = s.filings_snapshot_id "
            "   AND f.registration_number = s.registration_number "
            " WHERE s.document_hash IS NOT NULL AND f.kind IS NULL "
            " ORDER BY s.registration_number, s.filing_year"
        )
    ).all()
    return [f"{registration}:{year}" for registration, year in rows]


def pending(
    db: Session,
    *,
    report_type: str = DEFAULT_REPORT_TYPE,
    from_year: int = DEFAULT_FROM_YEAR,
) -> tuple[list[Wanted], int]:
    """What is still to ask for, and how many wanted documents are already kept.

    A verdict is skipped on its hash, which proves the exact bytes are held. A
    catalogued report is skipped on its filing version, which is the only test available
    when no hash exists yet. Where both name the same filing version the verdict wins,
    because it can compare hashes and the catalogue cannot.
    """
    kept_hashes = stored_document_hashes(db)
    kept_filings = stored_document_filings(db)

    by_key: dict[FilingKey, Wanted] = {}
    for item in catalogued_documents(db, report_type=report_type, from_year=from_year):
        by_key[item.filing_key] = item
    verdicts = wanted_documents(db)
    for item in verdicts:
        by_key[item.filing_key] = item

    todo: list[Wanted] = []
    already_kept = 0
    for item in by_key.values():
        held = (
            item.document_hash in kept_hashes
            if item.source == VERDICT
            else item.filing_key in kept_filings
        )
        if held:
            already_kept += 1
        else:
            todo.append(item)
    todo.sort(key=lambda item: (item.filing_year, item.registration_number))
    return todo, already_kept


def _keep(
    keeper: DocumentKeeper,
    item: Wanted,
    *,
    amendment_index: int,
    response,
    report: BackfillReport,
) -> None:
    action = keeper.keep(
        document_hash=response.content_hash,
        body=response.body,
        registration_number=item.registration_number,
        filing_year=item.filing_year,
        report_type=item.report_type,
        amendment_index=amendment_index,
        special_election=item.special_election,
    )
    if action not in (STORED, ALREADY_STORED):
        report.store_failures += 1
        return
    report.served_by_year[item.filing_year] += 1
    report.bytes_served += len(response.body)
    if amendment_index != item.amendment_index:
        report.earlier_version_kept += 1
    if item.source == CATALOGUE:
        report.newly_kept += 1
    elif response.content_hash == item.document_hash:
        report.same_document += 1
    else:
        report.different_document += 1


def _note_refusal(item: Wanted, note: str, report: BackfillReport) -> None:
    # Counted by the opening of the note, which is how the sibling run tallies these:
    # the size is deliberately at the END of the error-page note so one cause does not
    # count as many.
    reason = note.split(":")[0][:80]
    report.refused[reason] = report.refused.get(reason, 0) + 1
    report.refused_examples.setdefault(
        reason, f"{item.registration_number} {item.filing_year}"
    )
    report.refused_by_year[item.filing_year] += 1
    if item.no_amendment_record:
        report.refused_no_amendment_record += 1


def backfill(
    db: Session,
    keeper: DocumentKeeper,
    *,
    base_url: str = BOARD_BASE_URL,
    spacing_seconds: float = REQUEST_SPACING_SECONDS,
    limit: int | None = None,
    report_type: str = DEFAULT_REPORT_TYPE,
    from_year: int = DEFAULT_FROM_YEAR,
    progress=lambda message: None,
) -> BackfillReport:
    report = BackfillReport(no_kind=missing_kinds(db))
    todo, report.already_kept = pending(
        db, report_type=report_type, from_year=from_year
    )
    if limit is not None:
        todo = todo[:limit]
    progress(f"{len(todo):,} document(s) to ask the Board for")
    kept_filings = stored_document_filings(db)
    http = http_session()
    requests_made = 0
    for index, item in enumerate(todo, start=1):
        # The catalogued effective version first, then earlier ones until one serves.
        # A verdict names one version and one only: keeping a different version under a
        # verdict's name would be a document claiming to be a version it is not.
        candidates = (
            range(item.amendment_index, -1, -1)
            if item.source == CATALOGUE
            else (item.amendment_index,)
        )
        last_note = ""
        for amendment_index in candidates:
            if (
                amendment_index != item.amendment_index
                and item.version_key(amendment_index) in kept_filings
            ):
                # An earlier version already kept by a previous run. Nothing better is
                # reachable below it, so stop rather than re-fetch what is held.
                last_note = ""
                break
            if spacing_seconds and requests_made:
                time.sleep(spacing_seconds)
            requests_made += 1
            response, outcome, note = fetch_document(
                http,
                registration_number=item.registration_number,
                filing_year=item.filing_year,
                kind=item.kind,
                report_type=item.report_type,
                amendment_index=amendment_index,
                special_election=item.special_election,
                base_url=base_url,
            )
            report.outcomes[outcome.value] += 1
            if outcome is DocumentOutcome.served:
                _keep(
                    keeper,
                    item,
                    amendment_index=amendment_index,
                    response=response,
                    report=report,
                )
                kept_filings.add(item.version_key(amendment_index))
                last_note = ""
                break
            last_note = note
        if last_note:
            _note_refusal(item, last_note, report)
        if index % 50 == 0:
            progress(
                f"  {index:,} of {len(todo):,} — kept {report.retrieved:,}, "
                f"not served {report.not_served:,}, {requests_made:,} request(s) made"
            )
    return report


def describe(
    db: Session,
    *,
    limit: int | None = None,
    report_type: str = DEFAULT_REPORT_TYPE,
    from_year: int = DEFAULT_FROM_YEAR,
) -> BackfillReport:
    """What a real run would ask for. No requests, no writes.

    ``limit`` is the operator's own bound and must be applied here too. A preview
    that reports the whole pending population while the run it previews would stop
    at 50 is a dry run describing a different run, which is the one thing a dry run
    cannot be allowed to do.
    """
    report = BackfillReport(no_kind=missing_kinds(db))
    todo, report.already_kept = pending(
        db, report_type=report_type, from_year=from_year
    )
    outstanding = len(todo)
    if limit is not None:
        todo = todo[:limit]
    from_verdict = sum(1 for item in todo if item.source == VERDICT)
    print(
        f"\n{len(todo):,} document(s) would be asked for: "
        f"{from_verdict:,} named by a verdict, "
        f"{len(todo) - from_verdict:,} named by the Board's catalogue "
        f"({report_type} from {from_year}).\n"
        f"{report.already_kept:,} already kept."
    )
    by_year = Counter(item.filing_year for item in todo)
    for year in sorted(by_year):
        print(f"  {year}: {by_year[year]:,}")
    named_no_amendment = sum(1 for item in todo if item.no_amendment_record)
    if named_no_amendment:
        print(
            f"{named_no_amendment:,} of them are catalogued with no amendment record, "
            "which §9.6 reads as never filed. They are still asked for once, at "
            "amendment 0."
        )
    if limit is not None and outstanding > len(todo):
        print(
            f"--limit {limit} holds back {outstanding - len(todo):,} of "
            f"{outstanding:,} pending."
        )
    if report.no_kind:
        print(
            f"{len(report.no_kind)} verdict(s) name no filer kind and cannot be "
            "requested at all."
        )
    return report


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--target",
        default=os.environ.get("ALETHICAL_DATABASE_TARGET") or "local",
        choices=("local", "production"),
    )
    parser.add_argument("--database-url", default=None)
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Say what would be asked for. Makes no request and writes nothing.",
    )
    parser.add_argument(
        "--limit",
        type=int,
        default=None,
        help="Stop after this many documents. For a scoped live check before the full "
        "pass.",
    )
    parser.add_argument(
        "--report-type",
        default=DEFAULT_REPORT_TYPE,
        help="Which report type to read out of the Board's catalogue, verbatim as the "
        f"catalogue names it. Default {DEFAULT_REPORT_TYPE} (year-end).",
    )
    parser.add_argument(
        "--from-year",
        type=int,
        default=DEFAULT_FROM_YEAR,
        help="Earliest filing year to read out of the catalogue. Default "
        f"{DEFAULT_FROM_YEAR}, the first year Minnesota's redaction order covers.",
    )
    args = parser.parse_args()

    engine = create_engine(
        normalize_database_url(
            args.database_url or database_url_for_target(args.target)
        ),
        connect_args=NO_PREPARED_STATEMENTS,
    )
    with Session(engine) as session:
        # Said plainly rather than as a traceback. On a database whose migrations have
        # not run yet this is the whole story, and the first thing anybody sees.
        if not session.execute(
            text("SELECT to_regclass('cf_report_document')")
        ).scalar():
            print(
                "refused: this database has no cf_report_document table, so there is "
                "nowhere to record a kept document. Apply the migrations (alembic "
                "upgrade head).",
                file=sys.stderr,
            )
            return 1
        if args.dry_run:
            describe(
                session,
                limit=args.limit,
                report_type=args.report_type,
                from_year=args.from_year,
            )
            return 0
        store = raw_file_store_from_env()
        print(f"keeping documents in: {store.bucket}", flush=True)
        with tempfile.TemporaryDirectory(prefix="cf-document-backfill-") as directory:
            keeper = DocumentKeeper(db=session, store=store, directory=directory)
            report = backfill(
                session,
                keeper,
                limit=args.limit,
                report_type=args.report_type,
                from_year=args.from_year,
                progress=lambda message: print(message, file=sys.stderr, flush=True),
            )
    print("\n" + report.summary())
    print("\n" + keeper.report.summary())
    return 1 if keeper.report.failures else 0


if __name__ == "__main__":
    raise SystemExit(main())
