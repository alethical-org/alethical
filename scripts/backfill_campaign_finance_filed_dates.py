#!/usr/bin/env python3
"""Fill in the date the Board received each report, so a feed can order by it (#1670).

Net: we hold every report Minnesota catalogues and no record of when any of them was
filed, so the newest-filings feed orders by the period a report covers. Every 2026
pre-primary report shares the period end 20 Jul 2026, so the top of that feed is one
large tie broken alphabetically rather than a chronology of arrivals. This reads the
``Received by the Board`` line out of each report's own document and stores it.

Two passes, and the first is free:

1. **Carry forward.** A report version's received date cannot change, so a row whose
   ``(filer, year, report type, special-election flag, effective amendment index)``
   matches an already-dated row in another snapshot takes that date with no request to
   anyone. This is what makes a run after a fresh catalogue load cheap instead of a
   second hour: the loader leaves ``filed_date`` NULL on every new row, and one spare
   generation of the previous snapshot is retained (``KEEP_SUPERSEDED_GENERATIONS``).
2. **Read the documents** for whatever is still blank, one request per report at the
   0.25-second spacing every other call to the Board in this repo uses.

    # what it would ask for, per year. No request to the Board, no writes.
    ALETHICAL_DATABASE_TARGET=production PYTHONPATH=. uv run \\
        python scripts/backfill_campaign_finance_filed_dates.py \\
        --target production --dry-run

    # a scoped live slice first, then the full pass
    ... --target production --limit 25
    ... --target production

Safe to re-run and safe to interrupt. Each batch commits as it lands, a row that already
carries a date is never asked about again, and nothing here ever deletes or overwrites a
date. Re-running after an interrupted pass resumes where it stopped.

**Why most rows will stay blank, and why that is the correct result rather than a
shortfall.** Measured 31 Aug 2026 on a 54-report sample spanning 2021 to 2026: all 9
sampled 2021 reports and 5 of 9 sampled 2022 ones came back as the HTML page §9.4
measures at 30,424 bytes, and 2 of the 38 served documents were scans that ``pypdf``
reads as 0 lines. So ``--year-from`` defaults to 2023, the boundary §9.4 walked, and a
blank date is Minnesota's silence. **Nothing in this script may fall back to the period
end**: that is the fabricated fact #1670 exists to prevent.

Design: ``docs/architecture/campaign-finance-system-design.md`` §9.4 (report PDFs are a
fallback, not a route) and §9.6 (which version is effective).
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import time
from collections import Counter
from dataclasses import dataclass, field
from datetime import date
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
    REQUEST_SPACING_SECONDS,
    http_session,
    live_filings_snapshot,
)
from alethical.pipeline.request_limits import DatabaseRequestLimiter, RateLimitedSession  # noqa: E402
from alethical.pipeline.campaign_finance_report_documents import (  # noqa: E402
    DocumentOutcome,
    extract_lines,
    fetch_document,
    filed_date_from_lines,
)

# The default floor. §9.4 walked the boundary to 2023 on year-end reports; a 2022 pass is
# legitimate (4 of 9 sampled 2022 reports served) and is asked for with --year-from 2022.
DEFAULT_YEAR_FROM = 2023
# How many rows to write before committing. Small enough that an interrupted run loses
# seconds of work, large enough that the commit is not the slowest part of the loop.
COMMIT_EVERY = 25

# Every filed report in the live snapshot that still has no date, newest year first so a
# run that is stopped early has dated the reports a "newest filings" feed actually shows.
#
# ``effective_amendment_index IS NOT NULL`` is the Board's own signal that a report was
# FILED rather than merely scheduled (§9.6), and it is also the version to ask for: an
# amended report's received date is the amendment's own, not the original's.
_WANTED_SQL = """
SELECT r.registration_number,
       r.filing_year,
       r.report_type,
       r.special_election,
       r.effective_amendment_index,
       r.row_number,
       f.kind
  FROM cf_filing_report r
  JOIN cf_filer f
    ON f.snapshot_id = r.snapshot_id
   AND f.registration_number = r.registration_number
 WHERE r.snapshot_id = :snapshot_id
   AND r.filed_date IS NULL
   AND r.effective_amendment_index IS NOT NULL
   AND r.filing_year >= :year_from
 ORDER BY r.filing_year DESC, r.registration_number, r.row_number
"""

# The free pass. Same report version in another snapshot, already dated. Keyed on every
# field that identifies the version, so a date can never move between 2 different
# reports; ``special_election`` is in the key because a candidate in a special election
# files a whole second series under the same year and report type (§9.5).
_CARRY_FORWARD_SQL = """
UPDATE cf_filing_report AS target
   SET filed_date = source.filed_date
  FROM cf_filing_report AS source
 WHERE target.snapshot_id = :snapshot_id
   AND target.filed_date IS NULL
   AND source.snapshot_id <> target.snapshot_id
   AND source.filed_date IS NOT NULL
   AND source.registration_number = target.registration_number
   AND source.filing_year = target.filing_year
   AND source.report_type = target.report_type
   AND source.special_election = target.special_election
   AND source.effective_amendment_index = target.effective_amendment_index
"""


@dataclass
class Wanted:
    registration_number: str
    filing_year: int
    report_type: str
    special_election: bool
    amendment_index: int
    row_number: int
    kind: FilerKind


@dataclass
class Report:
    """What one pass did, in the terms an operator has to act on."""

    carried_forward: int = 0
    dated: int = 0
    asked: int = 0
    outcomes: Counter = field(default_factory=Counter)
    unreadable: list[str] = field(default_factory=list)
    snapshot_changed: bool = False
    incomplete: bool = False
    snapshot_id: str | None = None
    last_key: list | None = None

    @property
    def exit_code(self) -> int:
        if self.snapshot_changed or self.incomplete:
            return 75
        known = {outcome.value for outcome in DocumentOutcome} | {
            "served_without_a_readable_date"
        }
        if any(
            count and (name in {"http_error", "empty"} or name not in known)
            for name, count in self.outcomes.items()
        ):
            return 1
        if any(count and name != "served" for name, count in self.outcomes.items()):
            return 2
        return 0

    def finding(self) -> dict:
        return {
            "status": {
                0: "succeeded",
                1: "failed",
                2: "review_required",
                75: "continuing",
            }[self.exit_code],
            "carried_forward": self.carried_forward,
            "documents_asked": self.asked,
            "dates_stored": self.dated,
            "outcomes": dict(self.outcomes),
            "snapshot_changed": self.snapshot_changed,
            "incomplete": self.incomplete,
            "filings_snapshot_id": self.snapshot_id,
        }

    def summary(self) -> str:
        lines = [
            f"carried forward from an earlier snapshot: {self.carried_forward:,}",
            f"documents asked for: {self.asked:,}",
            f"dates stored: {self.dated:,}",
        ]
        for name, count in sorted(self.outcomes.items(), key=lambda pair: -pair[1]):
            lines.append(f"  {name}: {count:,}")
        if self.unreadable:
            lines.append(
                f"{len(self.unreadable)} document(s) served but carry no readable "
                "received stamp, which is Minnesota's gap and not a failure here:"
            )
            lines.extend(f"  {note}" for note in self.unreadable[:20])
        return "\n".join(lines)


def _wanted(db: Session, snapshot_id, year_from: int) -> list[Wanted]:
    rows = db.execute(
        text(_WANTED_SQL), {"snapshot_id": snapshot_id, "year_from": year_from}
    ).all()
    wanted: list[Wanted] = []
    for reg, year, report_type, special, amendment, row_number, kind in rows:
        wanted.append(
            Wanted(
                registration_number=reg,
                filing_year=year,
                report_type=report_type,
                special_election=bool(special),
                amendment_index=amendment,
                row_number=row_number,
                kind=kind if isinstance(kind, FilerKind) else FilerKind(kind),
            )
        )
    return wanted


def _store(db: Session, snapshot_id, item: Wanted, filed_date: date) -> bool:
    """Write one date, and only onto the row that is still blank.

    The ``IS NULL`` guard is what makes a re-run idempotent rather than merely
    repeatable: 2 passes overlapping cannot move a date that is already stored.
    """
    result = db.execute(
        text(
            "UPDATE cf_filing_report SET filed_date = :filed_date "
            "WHERE snapshot_id = :snapshot_id AND row_number = :row_number "
            "AND filed_date IS NULL"
        ),
        {
            "filed_date": filed_date,
            "snapshot_id": snapshot_id,
            "row_number": item.row_number,
        },
    )

    if result.rowcount == 1:
        from alethical.pipeline.source_record_clearing import stage_source_clearing

        stage_source_clearing(db, "filing-dates")
    return result.rowcount == 1


def describe(db: Session, *, year_from: int, limit: int | None) -> None:
    snapshot = live_filings_snapshot(db)
    if snapshot is None:
        print("refused: no filings snapshot is loaded, so there is nothing to date.")
        return
    would_carry = db.execute(
        text(
            "SELECT count(*) FROM cf_filing_report target "
            "WHERE target.snapshot_id = :snapshot_id AND target.filed_date IS NULL "
            "AND EXISTS (SELECT 1 FROM cf_filing_report source "
            "  WHERE source.snapshot_id <> target.snapshot_id "
            "    AND source.filed_date IS NOT NULL "
            "    AND source.registration_number = target.registration_number "
            "    AND source.filing_year = target.filing_year "
            "    AND source.report_type = target.report_type "
            "    AND source.special_election = target.special_election "
            "    AND source.effective_amendment_index = "
            "        target.effective_amendment_index)"
        ),
        {"snapshot_id": snapshot.id},
    ).scalar()
    already = db.execute(
        text(
            "SELECT count(*) FROM cf_filing_report "
            "WHERE snapshot_id = :snapshot_id AND filed_date IS NOT NULL"
        ),
        {"snapshot_id": snapshot.id},
    ).scalar()
    todo = _wanted(db, snapshot.id, year_from)
    by_year: Counter = Counter(item.filing_year for item in todo)
    print(f"live filings snapshot: {snapshot.id}")
    print(f"already dated: {already:,}")
    print(f"free, carried forward from an earlier snapshot: {would_carry:,}")
    print(f"documents that would be asked for (>= {year_from}): {len(todo):,}")
    for year in sorted(by_year, reverse=True):
        print(f"  {year}: {by_year[year]:,}")
    seconds = len(todo) * REQUEST_SPACING_SECONDS
    print(f"pacing alone: about {seconds / 60:.0f} minutes, plus download time.")
    if limit is not None and limit < len(todo):
        print(f"--limit {limit} holds back {len(todo) - limit:,} of {len(todo):,}.")


def backfill(
    db: Session,
    *,
    year_from: int,
    limit: int | None,
    carry_forward: bool,
    progress,
    source_session=None,
    after_key=None,
    on_item=None,
    before_write=None,
    max_seconds=None,
    expected_snapshot_id=None,
) -> Report:
    report = Report()
    snapshot = live_filings_snapshot(db)
    if snapshot is None:
        raise SystemExit("refused: no filings snapshot is loaded.")

    snapshot_id = snapshot.id
    report.snapshot_id = str(snapshot_id)
    if expected_snapshot_id is not None and report.snapshot_id != expected_snapshot_id:
        report.snapshot_changed = True
        return report
    if carry_forward:
        if before_write is not None:
            before_write(db)
        result = db.execute(text(_CARRY_FORWARD_SQL), {"snapshot_id": snapshot_id})
        report.carried_forward = result.rowcount or 0
        if report.carried_forward:
            from alethical.pipeline.source_record_clearing import stage_source_clearing

            stage_source_clearing(db, "filing-dates")
        db.commit()
        progress(f"carried forward {report.carried_forward:,} date(s), free.")

    todo = _wanted(db, snapshot_id, year_from)
    if after_key is not None:
        todo = [
            item
            for item in todo
            if (-item.filing_year, item.registration_number, item.row_number)
            > tuple(after_key)
        ]
    if limit is not None:
        report.incomplete = len(todo) > limit
        todo = todo[:limit]
    db.commit()
    if on_item is not None:
        on_item(report)
    deadline = None if max_seconds is None else time.monotonic() + max_seconds
    progress(f"{len(todo):,} document(s) to ask for.")
    http = source_session or http_session()
    for index, item in enumerate(todo, start=1):
        if deadline is not None and time.monotonic() >= deadline:
            report.incomplete = True
            break
        response, outcome, _note = fetch_document(
            http,
            registration_number=item.registration_number,
            filing_year=item.filing_year,
            kind=item.kind,
            report_type=item.report_type,
            amendment_index=item.amendment_index,
            special_election=item.special_election,
        )
        report.asked += 1
        report.outcomes[outcome.value] += 1
        if outcome is DocumentOutcome.served:
            lines, _pages = extract_lines(response.body)
            filed_date, errors = filed_date_from_lines(lines)
            if filed_date is None:
                report.outcomes["served_without_a_readable_date"] += 1
                report.unreadable.append(
                    f"{item.registration_number} {item.filing_year} "
                    f"{item.report_type} a{item.amendment_index}: "
                    + ("; ".join(errors) if errors else "no received stamp in the text")
                )
            else:
                if before_write is not None:
                    before_write(db)
                report.dated += int(_store(db, snapshot_id, item, filed_date))
        report.last_key = [-item.filing_year, item.registration_number, item.row_number]
        if on_item is not None:
            db.commit()
            on_item(report)
        if index % COMMIT_EVERY == 0:
            db.commit()
            progress(
                f"{index:,}/{len(todo):,} asked, {report.dated:,} dated "
                f"({item.filing_year})"
            )
        time.sleep(REQUEST_SPACING_SECONDS)
    db.commit()
    # Old snapshot rows remain safe, but a completed old pass never dates the
    # newly published register. Retry current work on the next bounded turn.
    current = db.execute(
        text("SELECT snapshot_id FROM cf_filing_current WHERE id = true")
    ).scalar_one_or_none()
    report.snapshot_changed = current != snapshot_id
    return report


def run_batch(
    engine, *, name, token, year_from, limit, max_seconds, carry_forward, progress
):
    from alethical.pipeline.record_refresh import load_progress, save_progress

    saved = load_progress(engine, name, token)
    with Session(engine) as db:
        current = live_filings_snapshot(db)
        if current is None:
            raise RuntimeError("No published filing snapshot")
        snapshot_id = str(current.id)
        scope = saved.get("filing_date_pass") or {}
        if (
            scope.get("snapshot_id") != snapshot_id
            or scope.get("year_from") != year_from
        ):
            scope = {
                "snapshot_id": snapshot_id,
                "year_from": year_from,
                "after_key": None,
                "carried_forward": 0,
                "dated": 0,
                "asked": 0,
                "outcomes": {},
            }
        base = dict(scope)

        def fence(session):
            owner = session.execute(
                text(
                    "SELECT name FROM source_refresh_state WHERE name=:name AND token=CAST(:token AS uuid) AND lease_expires_at>clock_timestamp() FOR UPDATE"
                ),
                {"name": name, "token": token},
            ).first()
            if owner is None:
                raise RuntimeError("Filing-date turn lost its owner before writing")

        def checkpoint(report):
            scope.update(
                after_key=report.last_key or base["after_key"],
                carried_forward=base["carried_forward"] + report.carried_forward,
                dated=base["dated"] + report.dated,
                asked=base["asked"] + report.asked,
                outcomes=dict(Counter(base["outcomes"]) + report.outcomes),
            )
            saved["filing_date_pass"] = scope
            save_progress(engine, name, token, saved)

        source = RateLimitedSession(http_session(), DatabaseRequestLimiter(engine))
        try:
            report = backfill(
                db,
                year_from=year_from,
                limit=limit,
                carry_forward=carry_forward and base["after_key"] is None,
                progress=progress,
                source_session=source,
                after_key=base["after_key"],
                on_item=checkpoint,
                before_write=fence,
                max_seconds=max_seconds,
                expected_snapshot_id=snapshot_id,
            )
        finally:
            source.close()
        checkpoint(report)
        combined = Report(
            carried_forward=scope["carried_forward"],
            dated=scope["dated"],
            asked=scope["asked"],
            outcomes=Counter(scope["outcomes"]),
            snapshot_id=base["snapshot_id"],
            snapshot_changed=report.snapshot_changed,
            incomplete=report.incomplete,
        )
        if report.snapshot_changed or not report.incomplete:
            saved.pop("filing_date_pass", None)
            save_progress(engine, name, token, saved)
        return combined


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
        "--year-from",
        type=int,
        default=DEFAULT_YEAR_FROM,
        help="Oldest filing year to ask about. Below 2023 the Board serves almost "
        "nothing (§9.4), so asking is mostly wasted load on its service.",
    )
    parser.add_argument(
        "--limit",
        type=int,
        default=None,
        help="Stop after this many documents. For a scoped live check before the full "
        "pass.",
    )
    parser.add_argument(
        "--no-carry-forward",
        action="store_true",
        help="Skip the free pass that copies a date from an identical report version in "
        "an earlier snapshot.",
    )
    parser.add_argument(
        "--json", action="store_true", help="Print structured stage outcomes"
    )
    parser.add_argument("--batch-size", type=int, default=None)
    parser.add_argument("--max-seconds", type=int, default=120)
    args = parser.parse_args()
    if args.batch_size is not None and not 1 <= args.batch_size <= 100:
        parser.error("batch size must be between 1 and 100")
    if not 1 <= args.max_seconds <= 240:
        parser.error("batch seconds must be between 1 and 240")

    engine = create_engine(
        normalize_database_url(
            args.database_url or database_url_for_target(args.target)
        ),
        connect_args=NO_PREPARED_STATEMENTS,
        # A run of thousands of documents holds one database connection for the better
        # part of an hour while spending almost all of it waiting on the Board, and the
        # pooler in front of Postgres will drop an idle one. Without this the first
        # commit after a drop raises and the whole pass dies -- measured on the first
        # production run, which stopped after 248 rows on
        # ``psycopg.OperationalError: Can't assign requested address`` while rolling back
        # a dead connection. Every long-running script in this repo sets it; this one
        # should have from the start.
        pool_pre_ping=True,
    )
    with Session(engine) as session:
        # Said plainly rather than as a traceback: on a database whose migrations have
        # not run this is the whole story and the first thing anybody sees.
        has_column = session.execute(
            text(
                "SELECT 1 FROM information_schema.columns "
                "WHERE table_name = 'cf_filing_report' AND column_name = 'filed_date'"
            )
        ).scalar()
        if not has_column:
            print(
                "refused: cf_filing_report has no filed_date column, so there is "
                "nowhere to store a filing date. Apply the migrations "
                "(alembic upgrade head).",
                file=sys.stderr,
            )
            return 1
        if args.dry_run:
            describe(session, year_from=args.year_from, limit=args.limit)
            return 0
        if args.batch_size is not None:
            session.rollback()
            report = run_batch(
                engine,
                name=os.environ["ALETHICAL_REFRESH_JOB_NAME"],
                token=os.environ["ALETHICAL_REFRESH_JOB_TOKEN"],
                year_from=args.year_from,
                limit=args.batch_size,
                max_seconds=args.max_seconds,
                carry_forward=not args.no_carry_forward,
                progress=lambda message: print(message, file=sys.stderr, flush=True),
            )
        else:
            report = backfill(
                session,
                year_from=args.year_from,
                limit=args.limit,
                carry_forward=not args.no_carry_forward,
                progress=lambda message: print(message, file=sys.stderr, flush=True),
                source_session=RateLimitedSession(
                    http_session(), DatabaseRequestLimiter(engine)
                ),
            )
    print(json.dumps(report.finding()) if args.json else "\n" + report.summary())
    return report.exit_code


if __name__ == "__main__":
    raise SystemExit(main())
