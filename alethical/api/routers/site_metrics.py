from __future__ import annotations

import os
from datetime import datetime, timedelta, timezone
from typing import Literal

from fastapi import APIRouter, Depends, Response
from fastapi.responses import JSONResponse
from pydantic import BaseModel, ConfigDict
from sqlalchemy import distinct, func, select
from sqlalchemy.orm import Session

from alethical.api.auth import get_optional_current_user
from alethical.db.schema import load_schema
from alethical.db.session import get_db


router = APIRouter()
schema = load_schema()
AuthIdentity = schema.AuthIdentity
SiteMetricEvent = schema.SiteMetricEvent
TrackedBill = schema.TrackedBill
UserAccount = schema.UserAccount

SiteMetricEventName = Literal[
    "bill_search_with_results",
    "legislator_search_with_results",
    "find_my_legislator_with_results",
    "official_source_opened",
]

EVENT_RESPONSE_KEYS: dict[str, str] = {
    "bill_search_with_results": "billSearchesWithResults",
    "legislator_search_with_results": "legislatorSearchesWithResults",
    "find_my_legislator_with_results": "findMyLegislatorWithResults",
    "official_source_opened": "officialSourceLinksOpened",
}


class SiteMetricEventRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    event: SiteMetricEventName


def excluded_provider_subjects() -> set[str]:
    return {
        value.strip()
        for value in os.environ.get("TRAFFIC_EXCLUDED_ACCOUNT_IDS", "").split(",")
        if value.strip()
    }


def user_is_excluded(db: Session, user_id, excluded: set[str]) -> bool:
    if not excluded:
        return False
    return bool(
        db.scalar(
            select(AuthIdentity.id)
            .where(
                AuthIdentity.user_id == user_id,
                AuthIdentity.provider == "supabase",
                AuthIdentity.provider_subject.in_(excluded),
            )
            .limit(1)
        )
    )


@router.post("/site-metrics/events", status_code=204)
def record_site_metric_event(
    request: SiteMetricEventRequest,
    db: Session = Depends(get_db),
    current_user=Depends(get_optional_current_user),
) -> Response:
    excluded = excluded_provider_subjects()
    if current_user is not None and user_is_excluded(db, current_user.id, excluded):
        return Response(status_code=204)

    db.add(SiteMetricEvent(event_kind=request.event))
    db.commit()
    return Response(status_code=204)


def action_totals(db: Session, cutoff: datetime) -> dict[str, int]:
    rows = db.execute(
        select(SiteMetricEvent.event_kind, func.count(SiteMetricEvent.id))
        .where(SiteMetricEvent.created_at >= cutoff)
        .group_by(SiteMetricEvent.event_kind)
    ).all()
    counts = {kind: int(count) for kind, count in rows}
    totals = {
        response_key: counts.get(event_kind, 0)
        for event_kind, response_key in EVENT_RESPONSE_KEYS.items()
    }
    totals["newBillWatches"] = 0
    return totals


def included_user_ids(excluded: set[str]):
    statement = select(UserAccount.id).where(UserAccount.is_active.is_(True))
    if excluded:
        excluded_ids = select(AuthIdentity.user_id).where(
            AuthIdentity.provider == "supabase",
            AuthIdentity.provider_subject.in_(excluded),
        )
        statement = statement.where(UserAccount.id.not_in(excluded_ids))
    return statement


@router.get("/site-metrics")
def site_metric_totals(db: Session = Depends(get_db)) -> JSONResponse:
    now = datetime.now(timezone.utc)
    excluded = excluded_provider_subjects()
    user_ids = included_user_ids(excluded)
    seven_days_ago = now - timedelta(days=7)
    thirty_days_ago = now - timedelta(days=30)

    actions7d = action_totals(db, seven_days_ago)
    actions30d = action_totals(db, thirty_days_ago)
    actions7d["newBillWatches"] = int(
        db.scalar(
            select(func.count(TrackedBill.id)).where(
                TrackedBill.user_id.in_(user_ids),
                TrackedBill.created_at >= seven_days_ago,
            )
        )
        or 0
    )
    actions30d["newBillWatches"] = int(
        db.scalar(
            select(func.count(TrackedBill.id)).where(
                TrackedBill.user_id.in_(user_ids),
                TrackedBill.created_at >= thirty_days_ago,
            )
        )
        or 0
    )

    readers = {
        "registeredReaders": int(
            db.scalar(select(func.count()).select_from(user_ids.subquery())) or 0
        ),
        "currentBillWatches": int(
            db.scalar(
                select(func.count(TrackedBill.id)).where(
                    TrackedBill.user_id.in_(user_ids)
                )
            )
            or 0
        ),
        "differentBillsCurrentlyWatched": int(
            db.scalar(
                select(func.count(distinct(TrackedBill.bill_id))).where(
                    TrackedBill.user_id.in_(user_ids)
                )
            )
            or 0
        ),
    }

    return JSONResponse(
        content={
            "data": {
                "actions7d": actions7d,
                "actions30d": actions30d,
                "readers": readers,
                "fetchedAt": now.isoformat(),
                "teamExclusionConfigured": bool(excluded),
            }
        },
        headers={
            "Cache-Control": "public, max-age=0, s-maxage=300, stale-while-revalidate=60"
        },
    )
