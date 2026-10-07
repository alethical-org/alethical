"""Retry saved-page clearing for the exact published lobbying generation."""

from __future__ import annotations

from sqlalchemy.orm import Session

from alethical.db.models import LobbyingCurrentRelease, SourceRefreshState
from alethical.pipeline.cache_purge import Clearing, clear
from alethical.pipeline.lobbying_registrations import load_lobbying

CLEARING = Clearing(
    event="a checked lobbying release",
    prefixes=(
        "api.alethical.com/api/v1/lobbying",
        "api.alethical.com/api/v1/campaign-finance/search",
    ),
)


def clear_pending(db: Session, *, name: str, token, target: str, purge=clear) -> bool:
    row = db.get(SourceRefreshState, name, populate_existing=True)
    if row is None or str(row.token) != str(token):
        raise RuntimeError("Lost lobbying refresh lease")
    live = db.get(LobbyingCurrentRelease, True, populate_existing=True)
    generation = str(live.release_id) if live and live.release_id else None
    progress = dict(row.progress or {})
    if generation is None or generation == progress.get("cleared_release"):
        db.rollback()
        return True
    db.rollback()
    result = purge(CLEARING)
    if not result.ok or (target == "production" and not result.armed):
        return False
    row = db.get(SourceRefreshState, name, populate_existing=True)
    if row is None or str(row.token) != str(token):
        raise RuntimeError("Lost lobbying refresh lease after clearing")
    progress["cleared_release"] = generation
    row.progress = progress
    db.commit()
    # A later publication, even by another operator, remains different from this
    # marker and is picked up on the next attempt. Never borrow its source date.
    return True


def refresh(
    db: Session, *, name: str, token, target: str, load=load_lobbying, purge=clear
) -> bool:
    if not clear_pending(db, name=name, token=token, target=target, purge=purge):
        return False
    report = load(db)
    cleared = clear_pending(db, name=name, token=token, target=target, purge=purge)
    return not report.refusal and cleared
