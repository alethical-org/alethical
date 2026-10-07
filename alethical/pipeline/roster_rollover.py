"""Atomic current-session promotion after the official roster has been accepted."""

from datetime import date

from sqlalchemy import select, update

from alethical.db.models import (
    Bill,
    Committee,
    CommitteeMembership,
    LegislativeSession,
    LegislatorServicePeriod,
)
from alethical.pipeline.sessions import SessionDef


def roster_session_transition(db, definition: SessionDef, *, today: date):
    """Lock current session and require real next-session bills before promotion."""
    if definition.session_type != "regular" or definition.start_date.date() > today:
        raise ValueError("The reviewed regular session has not started")
    current = db.scalars(
        select(LegislativeSession)
        .where(LegislativeSession.is_current.is_(True))
        .with_for_update()
    ).all()
    if len(current) != 1:
        raise ValueError("Roster refresh requires exactly 1 current session")
    previous = current[0]
    if previous.slug == definition.slug:
        return previous, previous
    if definition.session_number <= previous.session_number:
        raise ValueError("The live roster cannot replace a newer current legislature")
    target = db.scalar(
        select(LegislativeSession).where(
            LegislativeSession.slug == definition.slug,
            LegislativeSession.jurisdiction_id == previous.jurisdiction_id,
        )
    )
    if (
        target is None
        or db.scalar(select(Bill.id).where(Bill.session_id == target.id).limit(1))
        is None
    ):
        raise ValueError("Next-session roster waits for accepted official bill records")
    return previous, target


def promote_roster_session(db, previous, target) -> bool:
    """Call only after complete PDF/profile agreement, in that same transaction.

    Historical rows and human-reviewed campaign links are retained unchanged;
    only the membership/session flags saying 'current' change.
    """
    if previous.id == target.id:
        return False
    old_sessions = select(LegislativeSession.id).where(
        LegislativeSession.jurisdiction_id == target.jurisdiction_id,
        LegislativeSession.id != target.id,
    )
    db.execute(
        update(LegislatorServicePeriod)
        .where(LegislatorServicePeriod.session_id.in_(old_sessions))
        .values(is_current=False)
    )
    old_committees = select(Committee.id).where(Committee.session_id.in_(old_sessions))
    db.execute(
        update(CommitteeMembership)
        .where(CommitteeMembership.committee_id.in_(old_committees))
        .values(is_current=False)
    )
    previous.is_current = False
    target.is_current = True
    db.flush()
    return True
