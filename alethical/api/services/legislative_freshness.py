"""Conservative copy dates for the held legislative records a reader can see.

A successful money import is not evidence about bills. Nor does copying 1 bill
refresh all the other bills. Every held bill in scope must have a successful,
finished source copy; the oldest such copy is the shared date. This describes
our held records, not completeness of the state's bill inventory.
"""

from datetime import datetime
from typing import Iterable
from uuid import UUID

from sqlalchemy import and_, case, func, select
from sqlalchemy.orm import Session

from alethical.db.models import Bill, IngestionRun, IngestionStatus


def legislative_copy_date(
    db: Session,
    session_ids: Iterable[UUID],
    *,
    bill_ids: Iterable[UUID] | None = None,
    roster_slug: str | None = None,
) -> datetime | None:
    """Return a date supported by every held bill, optionally also the roster.

    Unknown or unfinished provenance stays unknown. A roster run covers a whole
    roster, unlike a bill run, so its latest completed full copy is suitable.
    Source checks that did not copy records cannot advance either date.
    """
    copied_at = case(
        (
            and_(
                IngestionRun.status == IngestionStatus.succeeded,
                IngestionRun.target_type == "bill",
            ),
            IngestionRun.finished_at,
        ),
        else_=None,
    )
    query = (
        select(func.count(Bill.id), func.count(copied_at), func.min(copied_at))
        .select_from(Bill)
        .outerjoin(IngestionRun, IngestionRun.id == Bill.ingestion_run_id)
        .where(Bill.session_id.in_(tuple(session_ids)))
    )
    if bill_ids is not None:
        query = query.where(Bill.id.in_(tuple(bill_ids)))
    held, dated, oldest = db.execute(query).one()
    if not held or dated != held:
        return None
    if roster_slug is None:
        return oldest
    roster_date = db.scalar(
        select(func.max(IngestionRun.finished_at)).where(
            IngestionRun.adapter == "minnesota_live",
            IngestionRun.target_type == "legislator_roster",
            IngestionRun.target_key == roster_slug,
            IngestionRun.status == IngestionStatus.succeeded,
            IngestionRun.stats["members_seen"].as_integer() > 0,
            IngestionRun.stats["members_seen"].as_integer()
            == IngestionRun.stats["members_ingested"].as_integer(),
        )
    )
    return min(oldest, roster_date) if roster_date is not None else None
