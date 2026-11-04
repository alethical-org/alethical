"""Resolve a bill action's source committee ID without matching printed names."""

from dataclasses import dataclass
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.orm import Session

from alethical.db.models import Committee


@dataclass(frozen=True)
class CommitteeMatch:
    state: str
    committee_id: UUID | None = None


def resolve(
    db: Session, *, session_id: UUID, chamber_id: UUID | None, source_id: str | None
) -> CommitteeMatch:
    if not source_id:
        return CommitteeMatch("missing_source_id")
    if chamber_id is None:
        return CommitteeMatch("missing_chamber")
    # code is the literal comm/cmte_id saved from the official committee URL.
    # Neither a similar name nor a code from another session/chamber is evidence.
    matches = list(
        db.scalars(
            select(Committee.id)
            .where(
                Committee.session_id == session_id,
                Committee.chamber_id == chamber_id,
                Committee.code == source_id,
            )
            .limit(2)
        )
    )
    if len(matches) > 1:
        return CommitteeMatch("ambiguous_code")
    if not matches:
        return CommitteeMatch("unheld_code")
    return CommitteeMatch("matched", matches[0])
