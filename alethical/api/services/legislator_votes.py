"""Paged, source-linked vote history shared by the public and Finance sites."""

from __future__ import annotations

import hashlib
import json

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from alethical.api.problems import problem_exception
from alethical.api.services import finance_versions
from alethical.db import models as m


def history(
    db: Session,
    legislator: m.Legislator,
    *,
    session: str | None,
    limit: int,
    offset: int,
    version: str | None,
) -> dict:
    """One snapshot, stable ordering and an exact token for the returned history.

    A legislator's held votes are bounded by their service, so the lightweight
    scalar projection also supplies the count and source-change token. No full
    bill text, membership graphs or ORM relationship trees are loaded.
    """
    finance_versions.pin(db)
    statement = (
        select(
            m.VoteRecord.id.label("id"),
            m.VoteRecord.vote_value,
            m.VoteEvent.id.label("vote_event_id"),
            m.VoteEvent.motion_text,
            m.VoteEvent.result_text,
            m.VoteEvent.occurred_at,
            m.VoteEvent.official_url,
            m.Bill.bill_key.label("bill_id"),
            m.Bill.file_type,
            m.Bill.file_number,
            m.LegislativeSession.slug.label("session"),
            m.LegislativeSession.name.label("session_name"),
            m.Chamber.slug.label("chamber"),
        )
        .join(m.VoteEvent, m.VoteEvent.id == m.VoteRecord.vote_event_id)
        .join(m.Bill, m.Bill.id == m.VoteEvent.bill_id)
        .join(m.LegislativeSession, m.LegislativeSession.id == m.Bill.session_id)
        .join(m.Chamber, m.Chamber.id == m.VoteEvent.chamber_id)
        .where(m.VoteRecord.legislator_id == legislator.id)
        .order_by(m.VoteEvent.occurred_at.desc().nullslast(), m.VoteRecord.id)
    )
    if session is not None:
        exists = db.scalar(
            select(m.LegislativeSession.id).where(m.LegislativeSession.slug == session)
        )
        if exists is None:
            raise HTTPException(404, "Session not found")
        statement = statement.where(m.LegislativeSession.slug == session)
    rows = []
    for row in db.execute(statement).mappings():
        item = dict(row)
        item["id"] = str(item["id"])
        item["vote_event_id"] = str(item["vote_event_id"])
        item["vote_value"] = item["vote_value"].value
        item["occurred_at"] = (
            item["occurred_at"].isoformat() if item["occurred_at"] else None
        )
        rows.append(item)
    current = hashlib.sha256(
        json.dumps([str(legislator.id), session, rows], sort_keys=True).encode()
    ).hexdigest()[:16]
    if version is not None and version != current:
        raise problem_exception(
            409,
            "Conflict",
            "These records changed. Reload the list.",
            type_slug="records-changed",
        )
    return {
        "legislator_id": str(legislator.id),
        "session": session,
        "version": current,
        "rows": rows[offset : offset + limit],
        "total": len(rows),
        "page": {
            "limit": limit,
            "offset": offset,
            "has_more": offset + limit < len(rows),
        },
    }
