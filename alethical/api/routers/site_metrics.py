from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from fastapi.routing import APIRoute
from fastapi.responses import JSONResponse
from pydantic import BaseModel, ConfigDict, UUID4
from sqlalchemy import distinct, func, select
from sqlalchemy.orm import Session

from alethical.api.auth import get_current_user, get_optional_current_user
from alethical.api.services.account_classification import (
    excluded_local_user_ids,
    excluded_provider_subjects,
)
from alethical.api.services.site_metric_history import (
    CREATION_RESPONSE_KEYS,
    claim_event_receipt,
    completed_hour,
    creation_totals,
    ensure_coverage,
)
from alethical.db.schema import load_schema
from alethical.db.session import get_db


class BoundedMetricRoute(APIRoute):
    """Reject oversized action bodies before FastAPI parses or authenticates them."""

    def get_route_handler(self):
        original = super().get_route_handler()

        async def bounded(request: Request):
            if request.method == "POST":
                chunks = []
                size = 0
                async for chunk in request.stream():
                    size += len(chunk)
                    if size > 512:
                        raise HTTPException(
                            status_code=413, detail="Event body too large"
                        )
                    chunks.append(chunk)
                body = b"".join(chunks)

                async def receive():
                    return {"type": "http.request", "body": body, "more_body": False}

                request = Request(request.scope, receive)
            return await original(request)

        return bounded


router = APIRouter(route_class=BoundedMetricRoute)
schema = load_schema()
AuthIdentity = schema.AuthIdentity
SiteMetricEvent = schema.SiteMetricEvent
TrackedBill = schema.TrackedBill
TrackedCommittee = schema.TrackedCommittee
UserAccount = schema.UserAccount

SiteMetricEventName = Literal[
    "bill_search_with_results",
    "legislator_search_with_results",
    "find_my_legislator_with_results",
    "official_source_opened",
    "money_search_with_results",
]

EVENT_RESPONSE_KEYS: dict[str, str] = {
    "bill_search_with_results": "billSearchesWithResults",
    "legislator_search_with_results": "legislatorSearchesWithResults",
    "find_my_legislator_with_results": "findMyLegislatorWithResults",
    "official_source_opened": "officialSourceLinksOpened",
    "money_search_with_results": "moneySearchesWithResults",
}


class SiteMetricEventRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    event: SiteMetricEventName
    # One action's retry key. Older clients may omit it during a staggered release.
    eventId: UUID4 | None = None


def user_is_excluded(db: Session, user_id, excluded: set[str]) -> bool:
    return user_id in excluded_local_user_ids(db, excluded)


@router.get("/site-metrics/collection")
def collection_eligibility(
    db: Session = Depends(get_db), current_user=Depends(get_current_user)
) -> JSONResponse:
    """One exclusion decision for browser and backend collection, not access rights."""
    excluded = user_is_excluded(db, current_user.id, excluded_provider_subjects())
    return JSONResponse(
        {
            "collect": not excluded,
            "teamAccount": excluded,
            "teamExclusionConfigured": True,
        },
        headers={"Cache-Control": "private, no-store"},
    )


@router.post("/site-metrics/events", status_code=204)
def record_site_metric_event(
    request: SiteMetricEventRequest,
    http_request: Request,
    db: Session = Depends(get_db),
    current_user=Depends(get_optional_current_user),
) -> Response:
    # Optional auth intentionally returns None for deactivated accounts on
    # public read routes. That known account must not become an anonymous write.
    if getattr(http_request.state, "account_deactivated", False):
        return Response(status_code=204)
    excluded = excluded_provider_subjects()
    if current_user is not None and user_is_excluded(db, current_user.id, excluded):
        return Response(status_code=204)

    now = datetime.now(timezone.utc)
    if request.eventId is not None and not claim_event_receipt(
        db, request.eventId, now
    ):
        db.commit()
        return Response(status_code=204)
    ensure_coverage(db, request.event, now)
    db.add(SiteMetricEvent(event_kind=request.event))
    db.commit()
    return Response(status_code=204)


def action_totals(db: Session, cutoff: datetime, ends_at: datetime) -> dict[str, int]:
    rows = db.execute(
        select(SiteMetricEvent.event_kind, func.count(SiteMetricEvent.id))
        .where(
            SiteMetricEvent.created_at >= cutoff, SiteMetricEvent.created_at < ends_at
        )
        .group_by(SiteMetricEvent.event_kind)
    ).all()
    counts = {kind: int(count) for kind, count in rows}
    totals = {
        response_key: counts.get(event_kind, 0)
        for event_kind, response_key in EVENT_RESPONSE_KEYS.items()
    }
    totals.update(creation_totals(db, cutoff, ends_at))
    return totals


def included_user_ids(db: Session, excluded: set[str]):
    statement = select(UserAccount.id).where(UserAccount.is_active.is_(True))
    excluded_ids = excluded_local_user_ids(db, excluded)
    if excluded_ids:
        statement = statement.where(UserAccount.id.not_in(excluded_ids))
    return statement


@router.get("/site-metrics")
def site_metric_totals(db: Session = Depends(get_db)) -> JSONResponse:
    now = datetime.now(timezone.utc)
    excluded = excluded_provider_subjects()
    user_ids = included_user_ids(db, excluded)
    # Compare equal windows and exclude the unfinished hour, matching traffic.
    # Current account/follow inventory below is explicitly as of fetchedAt.
    ends_at = completed_hour(now)
    seven_days_ago = ends_at - timedelta(days=7)
    thirty_days_ago = ends_at - timedelta(days=30)
    actions7d = action_totals(db, seven_days_ago, ends_at)
    actions30d = action_totals(db, thirty_days_ago, ends_at)

    coverage = {
        kind: started
        for kind, started in db.execute(
            select(
                schema.SiteMetricCoverage.metric_kind,
                schema.SiteMetricCoverage.recording_started_at,
            )
        ).all()
    }
    all_keys = {**EVENT_RESPONSE_KEYS, **CREATION_RESPONSE_KEYS}
    history = {}
    for kind, response_key in all_keys.items():
        started = coverage.get(kind)
        history[response_key] = {
            "recordingStartedAt": started.isoformat() if started else None,
            "current7dComplete": started is not None and started <= seven_days_ago,
            "current30dComplete": started is not None and started <= thirty_days_ago,
            "previous7dComplete": started is not None
            and started <= ends_at - timedelta(days=14),
            "previous30dComplete": started is not None
            and started <= ends_at - timedelta(days=60),
        }
    previous7d: dict[str, int | None] = dict(
        action_totals(db, ends_at - timedelta(days=14), seven_days_ago)
    )
    previous30d: dict[str, int | None] = dict(
        action_totals(db, ends_at - timedelta(days=60), thirty_days_ago)
    )
    for key in all_keys.values():
        if not history[key]["previous7dComplete"]:
            previous7d[key] = None
        if not history[key]["previous30dComplete"]:
            previous30d[key] = None

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
    # Keep the former field as a compatibility alias, not a lifetime-signup claim.
    readers["currentReaderAccounts"] = readers["registeredReaders"]
    readers["currentBillFollowingReaders"] = int(
        db.scalar(
            select(func.count(distinct(TrackedBill.user_id))).where(
                TrackedBill.user_id.in_(user_ids)
            )
        )
        or 0
    )
    readers["currentCommitteeFollowingReaders"] = int(
        db.scalar(
            select(func.count(distinct(TrackedCommittee.user_id))).where(
                TrackedCommittee.user_id.in_(user_ids)
            )
        )
        or 0
    )
    readers["currentCommitteeWatches"] = int(
        db.scalar(
            select(func.count(TrackedCommittee.id)).where(
                TrackedCommittee.user_id.in_(user_ids)
            )
        )
        or 0
    )
    readers["differentCommitteesCurrentlyWatched"] = int(
        db.scalar(
            select(func.count(distinct(TrackedCommittee.registration_number))).where(
                TrackedCommittee.user_id.in_(user_ids)
            )
        )
        or 0
    )

    def period(days: int):
        starts = ends_at - timedelta(days=days)
        return {
            "startsAt": starts.isoformat(),
            "endsAt": ends_at.isoformat(),
            "previousStartsAt": (starts - timedelta(days=days)).isoformat(),
            "previousEndsAt": starts.isoformat(),
        }

    return JSONResponse(
        content={
            "data": {
                "actions7d": actions7d,
                "actions30d": actions30d,
                "previousActions7d": previous7d,
                "previousActions30d": previous30d,
                "periods7d": period(7),
                "periods30d": period(30),
                "history": history,
                "totalsSinceStart": creation_totals(db, None, ends_at),
                "readers": readers,
                "fetchedAt": now.isoformat(),
                "teamExclusionConfigured": True,
            }
        },
        headers={
            "Cache-Control": "public, max-age=0, s-maxage=300, stale-while-revalidate=60"
        },
    )
