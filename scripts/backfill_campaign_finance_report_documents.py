#!/usr/bin/env python3
"""Fetch and keep the documents behind verdicts already written (#1501).

Net: #1433's check read 1,277 of Minnesota's report documents, recorded each one's
sha256, and kept none of them. This asks the Board for each of those documents again and
keeps the bytes this time. **The ones it will no longer serve are the point of the
exercise**, not a failure of it: they are the measurement showing that a document read
today and dropped is a document gone, which is exactly why keeping them from now on is
a correctness requirement (§4.5) and not a backup habit.

Three things a re-fetch can return, and all 3 are recorded:

* **The same document.** Its sha256 matches what the verdict recorded, so the figure a
  page shows now resolves to bytes we hold.
* **A different document.** The Board serves whatever is current at that address; an
  amendment filed since the check would answer with different bytes. Stored anyway
  (content-addressed, so it is a new object and overwrites nothing) and reported
  separately, because the verdict's own hash still names bytes nobody has.
* **Nothing at all.** HTTP 200 with an HTML page or a plain-text refusal, which is how
  the Board reports a document it does not serve (§9.4).

    # what it would ask for, and what is already kept — no requests, no writes
    ALETHICAL_DATABASE_TARGET=production PYTHONPATH=. uv run \\
        python scripts/backfill_campaign_finance_report_documents.py \\
        --target production --dry-run

    # the real pass, about 1,300 requests at 0.25s apart plus download time
    ALETHICAL_DATABASE_TARGET=production PYTHONPATH=. uv run \\
        python scripts/backfill_campaign_finance_report_documents.py --target production

Safe to re-run and safe to interrupt: each document is committed as it lands, and a
document already kept is skipped without a request to the Board. It only ever adds --
nothing here deletes from either store, because §4.5 retains every body indefinitely.

Pacing is the same 0.25 seconds every other call to the Board in this repo uses. Roughly
5,300 requests over 2 hours on 12 August 2026 drew no refusal, throttle or block, which
is an observation about one night and not a limit the Board has published.

Design: ``docs/architecture/campaign-finance-system-design.md`` §4.5 (where the
downloaded files live, and for how long) and §9.4 (report PDFs are a fallback, not a
route).
"""

from __future__ import annotations

import argparse
import os
import sys
import tempfile
import time
from dataclasses import dataclass, field
from pathlib import Path

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
)
from alethical.pipeline.campaign_finance_report_document_store import (  # noqa: E402
    ALREADY_STORED,
    STORED,
    DocumentKeeper,
    stored_document_hashes,
)
from alethical.pipeline.campaign_finance_report_documents import (  # noqa: E402
    DocumentOutcome,
    fetch_document,
)
from alethical.pipeline.raw_file_store import raw_file_store_from_env  # noqa: E402

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


@dataclass
class Wanted:
    registration_number: str
    filing_year: int
    report_type: str
    amendment_index: int
    document_hash: str
    document_byte_size: int
    kind: FilerKind


@dataclass
class BackfillReport:
    """What the Board would still serve, and what it would not."""

    already_kept: int = 0
    same_document: int = 0
    different_document: int = 0
    no_kind: list[str] = field(default_factory=list)
    refused: dict[str, int] = field(default_factory=dict)
    refused_examples: dict[str, str] = field(default_factory=dict)
    store_failures: int = 0

    @property
    def retrieved(self) -> int:
        return self.same_document + self.different_document

    @property
    def not_served(self) -> int:
        return sum(self.refused.values())

    def summary(self) -> str:
        lines = [
            f"already kept before this run:      {self.already_kept:>5}",
            f"fetched and kept, same document:   {self.same_document:>5}",
            f"fetched and kept, DIFFERENT bytes: {self.different_document:>5}",
            f"the Board would not serve:         {self.not_served:>5}",
            f"failed to store:                   {self.store_failures:>5}",
        ]
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
                document_hash=document_hash,
                document_byte_size=int(document_byte_size or 0),
                kind=kind if isinstance(kind, FilerKind) else FilerKind(kind),
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


def backfill(
    db: Session,
    keeper: DocumentKeeper,
    *,
    base_url: str = BOARD_BASE_URL,
    spacing_seconds: float = REQUEST_SPACING_SECONDS,
    limit: int | None = None,
    progress=lambda message: None,
) -> BackfillReport:
    report = BackfillReport(no_kind=missing_kinds(db))
    kept = stored_document_hashes(db)
    wanted = wanted_documents(db)
    todo = [item for item in wanted if item.document_hash not in kept]
    report.already_kept = len(wanted) - len(todo)
    if limit is not None:
        todo = todo[:limit]
    progress(f"{len(todo):,} document(s) to ask the Board for")
    http = http_session()
    for index, item in enumerate(todo, start=1):
        response, outcome, note = fetch_document(
            http,
            registration_number=item.registration_number,
            filing_year=item.filing_year,
            kind=item.kind,
            report_type=item.report_type,
            amendment_index=item.amendment_index,
            special_election=False,
            base_url=base_url,
        )
        if outcome is not DocumentOutcome.served:
            # Counted by the opening of the note, which is how the sibling run tallies
            # these: the size is deliberately at the END of the error-page note so one
            # cause does not count as many.
            reason = note.split(":")[0][:80]
            report.refused[reason] = report.refused.get(reason, 0) + 1
            report.refused_examples.setdefault(
                reason, f"{item.registration_number} {item.filing_year}"
            )
        else:
            action = keeper.keep(
                document_hash=response.content_hash,
                body=response.body,
                registration_number=item.registration_number,
                filing_year=item.filing_year,
                report_type=item.report_type,
                amendment_index=item.amendment_index,
            )
            if action in (STORED, ALREADY_STORED):
                if response.content_hash == item.document_hash:
                    report.same_document += 1
                else:
                    report.different_document += 1
            else:
                report.store_failures += 1
        if spacing_seconds and index < len(todo):
            time.sleep(spacing_seconds)
        if index % 50 == 0:
            progress(
                f"  {index:,} of {len(todo):,} — kept {report.retrieved:,}, "
                f"not served {report.not_served:,}"
            )
    return report


def describe(db: Session, *, limit: int | None = None) -> BackfillReport:
    """What a real run would ask for. No requests, no writes.

    ``limit`` is the operator's own bound and must be applied here too. A preview
    that reports the whole pending population while the run it previews would stop
    at 50 is a dry run describing a different run, which is the one thing a dry run
    cannot be allowed to do.
    """
    report = BackfillReport(no_kind=missing_kinds(db))
    kept = stored_document_hashes(db)
    wanted = wanted_documents(db)
    todo = [item for item in wanted if item.document_hash not in kept]
    report.already_kept = len(wanted) - len(todo)
    pending = len(todo)
    if limit is not None:
        todo = todo[:limit]
    print(
        f"\n{len(todo):,} document(s) would be asked for, "
        f"{sum(item.document_byte_size for item in todo):,} bytes as originally read.\n"
        f"{report.already_kept:,} already kept."
    )
    if limit is not None and pending > len(todo):
        print(
            f"--limit {limit} holds back {pending - len(todo):,} of {pending:,} pending."
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
            describe(session, limit=args.limit)
            return 0
        store = raw_file_store_from_env()
        print(f"keeping documents in: {store.bucket}", flush=True)
        with tempfile.TemporaryDirectory(prefix="cf-document-backfill-") as directory:
            keeper = DocumentKeeper(db=session, store=store, directory=directory)
            report = backfill(
                session,
                keeper,
                limit=args.limit,
                progress=lambda message: print(message, file=sys.stderr, flush=True),
            )
    print("\n" + report.summary())
    print("\n" + keeper.report.summary())
    return 1 if keeper.report.failures else 0


if __name__ == "__main__":
    raise SystemExit(main())
