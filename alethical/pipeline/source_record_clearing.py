"""Durable clearing owed by committed automatic source-record changes."""

from __future__ import annotations

from datetime import UTC, datetime
import os
import sys
import uuid

from sqlalchemy import delete, select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.orm import Session

from alethical.db.models import SourceRefreshState
from alethical.pipeline.cache_purge import (
    ENABLE_VALUE,
    WEBSITE_ENABLE_SETTING,
    Clearing,
    clear,
)

PREFIXES = {
    "legislative": (
        "api.alethical.com/api/v1/bills",
        "api.alethical.com/api/v1/districts",
        "api.alethical.com/api/v1/legislators",
        "api.alethical.com/api/v1/policy-areas",
        "api.alethical.com/api/v1/search",
        "api.alethical.com/api/v1/sessions",
        "api.alethical.com/api/v1/summary",
    ),
    "filing-dates": (
        "api.alethical.com/api/v1/campaign-finance",
        "api.alethical.com/api/v1/committees",
        "api.alethical.com/api/v1/legislators",
    ),
}


def stage_source_clearing(db, family):
    """Call in the data transaction; rollback removes both facts and obligation."""
    if family not in PREFIXES:
        raise ValueError("Unknown source-record clearing family")
    progress = {"token": str(uuid.uuid4())}
    db.execute(
        insert(SourceRefreshState)
        .values(
            name=f"clearing:{family}",
            next_due_at=datetime.now(UTC),
            failures=0,
            progress=progress,
        )
        .on_conflict_do_update(index_elements=["name"], set_={"progress": progress})
    )


MARKERS = tuple(f"clearing:{family}" for family in PREFIXES)


def drain_source_clearing(engine, *, target, purge=clear):
    with Session(engine) as db:
        rows = db.scalars(
            select(SourceRefreshState).where(SourceRefreshState.name.in_(MARKERS))
        ).all()
        captured = {row.name: row.progress["token"] for row in rows}
    if not captured:
        return True
    paths = sorted(
        {path for name in captured for path in PREFIXES[name.removeprefix("clearing:")]}
    )
    if target == "production":
        # Without the website step a clear can never finish, so purge nothing.
        website = (os.getenv(WEBSITE_ENABLE_SETTING) or "").strip().lower()
        if website != ENABLE_VALUE:
            _record_failed_attempt(engine, captured)
            return False
        result = purge(Clearing("public source records changed", tuple(paths)))
        if not result.ok or not result.armed:
            # The report names the refusing service and never a credential.
            print(result.report(), file=sys.stderr, flush=True)
            _record_failed_attempt(engine, captured)
            return False
    with Session(engine) as db:
        for name, token in captured.items():
            db.execute(
                delete(SourceRefreshState).where(
                    SourceRefreshState.name == name,
                    SourceRefreshState.progress["token"].astext == token,
                )
            )
        db.commit()
        remaining = db.scalar(
            select(SourceRefreshState.name)
            .where(SourceRefreshState.name.in_(MARKERS))
            .limit(1)
        )
    return remaining is None


def _record_failed_attempt(engine, captured):
    """Lateness counts from a failed clear, never from a turn still running."""
    failed_at = datetime.now(UTC).isoformat()
    with Session(engine) as db:
        for name, token in captured.items():
            row = db.scalar(
                select(SourceRefreshState)
                .where(
                    SourceRefreshState.name == name,
                    SourceRefreshState.progress["token"].astext == token,
                )
                .with_for_update()
            )
            if row is not None:
                row.progress = {**row.progress, "failed_at": failed_at}
        db.commit()
