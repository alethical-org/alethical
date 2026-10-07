"""Callable refresh operations for the shared due-work runner.

Bill text and search remain one transaction per bill. Changed-text embeddings
use the approved ingestion budget; this module never starts a summary job.
"""

from __future__ import annotations

from datetime import date, timedelta
from typing import Any

from sqlalchemy.orm import Session

from alethical.pipeline.minnesota import (
    MinnesotaIngestionPipeline,
    discover_session_bills,
)
from alethical.pipeline.sessions import session_definition
from alethical.pipeline.votes import (
    backfill_votes,
    rate_limited_source_session,
    reconcile_saved_votes,
)


def bill_refresh_interval(
    now: date,
    *,
    sitting_start: date | None = None,
    sitting_end: date | None = None,
    special: bool = False,
) -> timedelta:
    """Use reviewed sitting dates, never a whole-biennium start/end range."""
    if sitting_start and sitting_end and sitting_start > sitting_end:
        raise ValueError("Sitting dates are reversed")
    if (
        sitting_start
        and now >= sitting_start
        and (sitting_end is None or now <= sitting_end)
    ):
        return timedelta(hours=2 if special else 4)
    if sitting_end and sitting_end < now <= sitting_end + timedelta(days=14):
        return timedelta(hours=4)
    return timedelta(days=7)


def refresh_bills(
    engine: Any,
    *,
    session_code: str,
    target: str,
    max_bill_number: int = 6000,
    limit: int = 100,
    after_key: str | None = None,
) -> dict[str, Any]:
    # Reject unmapped future sessions before making any requests or changing rows.
    session_definition(session_code)
    if not 1 <= limit <= 500:
        raise ValueError("A bill refresh chunk must contain between 1 and 500 bills")
    source = rate_limited_source_session(engine, target=target)
    try:
        discovered = discover_session_bills(
            source, session_code=session_code, max_bill_number=max_bill_number
        )
        if not discovered:
            raise RuntimeError(
                "The official bill inventory was empty; refresh was not accepted"
            )
        remaining = [
            item
            for item in sorted(discovered, key=lambda item: item.bill_key)
            if after_key is None or item.bill_key > after_key
        ]
        chunk = remaining[:limit]
        report: dict[str, Any] = {
            "discovered": len(discovered),
            "complete": len(remaining) <= limit,
            "next_cursor": chunk[-1].bill_key if len(remaining) > limit else None,
            "accepted": 0,
            "accepted_bill_keys": [],
            "failed": [],
            "changed_bill_keys": [],
        }
        for result in chunk:
            with Session(engine) as db:
                pipeline = MinnesotaIngestionPipeline(
                    db, sess=source, conditional_bill_text=True
                )
                try:
                    stats = pipeline.ingest_bills([result.target])
                    if stats["bill_refresh_rejections"]:
                        report["failed"].extend(stats["bill_refresh_rejections"])
                        db.commit()  # retain rejected-source evidence, not new bill facts
                        continue
                    changed = sorted(
                        set(
                            stats["text_changed_bill_keys"]
                            + stats["summary_changed_bill_keys"]
                        )
                    )
                    if changed:
                        from alethical.pipeline.rag_ingest import (
                            build_rag_rows_for_bill_keys,
                        )

                        build_rag_rows_for_bill_keys(
                            db, changed, database_target=target
                        )
                    db.commit()
                    report["accepted"] += 1
                    report["accepted_bill_keys"].extend(stats["bill_keys"])
                    report["changed_bill_keys"].extend(changed)
                except Exception as exc:
                    db.rollback()
                    report["failed"].append(
                        {"bill_key": result.bill_key, "error": type(exc).__name__}
                    )
        return report
    finally:
        source.close()


def refresh_votes(
    engine: Any,
    *,
    target: str,
    bill_keys: list[str] | None = None,
    sweep_limit: int = 100,
) -> dict[str, Any]:
    source = rate_limited_source_session(engine, target=target)
    try:
        with Session(engine) as db:
            missing = backfill_votes(
                db, limit=None, dry_run=False, only_missing=True, source_session=source
            )
            corrections = reconcile_saved_votes(
                db,
                bill_keys=bill_keys or [],
                safety_sweep_limit=sweep_limit,
                dry_run=False,
                source_session=source,
            )
        return {"missing": missing, "corrections": corrections.to_dict()}
    finally:
        source.close()


def refresh_roster(engine: Any, *, session_code: str, target: str) -> dict[str, Any]:
    definition = session_definition(session_code)
    if not definition.is_current:
        raise ValueError("The live roster cannot be applied to a historical session")
    source = rate_limited_source_session(engine, target=target)
    try:
        # Read and validate the complete canonical PDF before any roster writes.
        from alethical.pipeline.roster_pdf import (
            fetch_roster_pdf_text,
            parse_roster_pdf,
        )

        members = parse_roster_pdf(fetch_roster_pdf_text(session=source))
        with Session(engine) as db:
            pipeline = MinnesotaIngestionPipeline(
                db, sess=source, conditional_bill_text=True
            )
            stats = pipeline.ingest_roster(session_code=session_code)
            report = pipeline.reconcile_current_members(
                definition.slug, roster_members=members
            )
            if report.missing:
                raise RuntimeError(
                    "The HTML roster does not cover every occupied PDF seat; retaining saved roster"
                )
            db.commit()
        from alethical.pipeline.committee_memberships import backfill

        with Session(engine) as db:
            committees = backfill(
                db, dry_run=False, cleanup_orphans=False, source_session=source
            )
        from alethical.pipeline.legislator_service import backfill as service_backfill

        with Session(engine) as db:
            service = service_backfill(
                db, dry_run=False, only_missing=False, sess=source
            )
        from alethical.pipeline.legislator_bio_backfill import backfill as bio_backfill

        with Session(engine) as db:
            bio = bio_backfill(
                db,
                dry_run=False,
                only_missing=False,
                limit=None,
                legislator=None,
                chamber=None,
                source_session=source,
            )
        return {
            "bio": vars(bio),
            "roster": stats,
            "members": report.pdf_total,
            "deactivated": len(report.deactivated),
            "committees": vars(committees),
            "service": service,
        }
    finally:
        source.close()
