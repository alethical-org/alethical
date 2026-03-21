from __future__ import annotations

import os

from fastapi import APIRouter, Depends, Header
from sqlalchemy import select
from sqlalchemy.orm import Session

from alethical.api.problems import problem_exception
from alethical.db.schema import load_schema
from alethical.db.session import get_db

schema = load_schema()
IngestionRun = schema.IngestionRun
ManualOverride = schema.ManualOverride
ParserFailure = schema.ParserFailure

router = APIRouter()


def require_internal_token(x_internal_token: str | None = Header(default=None)):
    expected = os.environ.get("INTERNAL_API_TOKEN", "dev-internal-token")
    if x_internal_token != expected:
        raise problem_exception(401, "Unauthorized", "Valid internal token required")


@router.get("/ingestion-runs")
def ingestion_runs(_=Depends(require_internal_token), db: Session = Depends(get_db)):
    rows = db.scalars(select(IngestionRun).order_by(IngestionRun.started_at.desc())).all()
    data = [
        {
            "id": str(row.id),
            "adapter": row.adapter,
            "target_type": row.target_type,
            "target_key": row.target_key,
            "status": row.status.value,
            "started_at": row.started_at,
            "finished_at": row.finished_at,
        }
        for row in rows
    ]
    return {"data": data, "page": {"limit": len(data), "next_cursor": None, "has_more": False}}


@router.get("/parser-failures")
def parser_failures(_=Depends(require_internal_token), db: Session = Depends(get_db)):
    rows = db.scalars(select(ParserFailure).order_by(ParserFailure.created_at.desc())).all()
    data = [
        {
            "id": str(row.id),
            "adapter": row.adapter,
            "entity_type": row.entity_type,
            "entity_key": row.entity_key,
            "error_message": row.error_message,
            "resolved_at": row.resolved_at,
        }
        for row in rows
    ]
    return {"data": data, "page": {"limit": len(data), "next_cursor": None, "has_more": False}}


@router.get("/manual-overrides")
def manual_overrides(_=Depends(require_internal_token), db: Session = Depends(get_db)):
    rows = db.scalars(select(ManualOverride).order_by(ManualOverride.created_at.desc())).all()
    data = [
        {
            "id": str(row.id),
            "entity_type": row.entity_type,
            "entity_id": str(row.entity_id),
            "field_name": row.field_name,
            "reason": row.reason,
        }
        for row in rows
    ]
    return {"data": data, "page": {"limit": len(data), "next_cursor": None, "has_more": False}}
