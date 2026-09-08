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
from alethical.api.routers import leadership_metrics, site_metric_accounts
from alethical.api.services.account_classification import (
    excluded_local_user_ids,
    excluded_provider_subjects,
)
from alethical.api.services.site_metric_history import (
    CREATION_RESPONSE_KEYS,
    claim_event_receipt,
    completed_hour,
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
router.include_router(site_metric_accounts.router)
router.include_router(leadership_metrics.router)
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


def action_period_totals(
    db: Session, windows: dict[str, tuple[datetime, datetime]], ends_at: datetime
) -> tuple[dict[str, dict[str, int]], dict[str, int]]:
    """Read each anonymous count table once for all comparison periods."""
    totals = {
        period: {
            key: 0
            for key in (*EVENT_RESPONSE_KEYS.values(), *CREATION_RESPONSE_KEYS.values())
        }
        for period in windows
    }
    events = db.execute(
        select(
            SiteMetricEvent.event_kind,
            *(
                func.count(SiteMetricEvent.id)
                .filter(
                    SiteMetricEvent.created_at >= start,
                    SiteMetricEvent.created_at < end,
                )
                .label(period)
                for period, (start, end) in windows.items()
            ),
        )
        .where(
            SiteMetricEvent.created_at >= min(start for start, _ in windows.values()),
            SiteMetricEvent.created_at < ends_at,
        )
        .group_by(SiteMetricEvent.event_kind)
    ).mappings()
    for row in events:
        key = EVENT_RESPONSE_KEYS.get(row["event_kind"])
        if key is not None:
            for period in windows:
                totals[period][key] = int(row[period])

    hourly = schema.SiteMetricHourlyCount
    creations = db.execute(
        select(
            hourly.metric_kind,
            func.sum(hourly.count).label("all_time"),
            *(
                func.sum(hourly.count)
                .filter(
                    hourly.bucket_started_at >= start, hourly.bucket_started_at < end
                )
                .label(period)
                for period, (start, end) in windows.items()
            ),
        )
        .where(hourly.bucket_started_at < ends_at)
        .group_by(hourly.metric_kind)
    ).mappings()
    lifetime = {key: 0 for key in CREATION_RESPONSE_KEYS.values()}
    for row in creations:
        key = CREATION_RESPONSE_KEYS.get(row["metric_kind"])
        if key is not None:
            lifetime[key] = int(row["all_time"] or 0)
            for period in windows:
                totals[period][key] = int(row[period] or 0)
    return totals, lifetime


def included_user_ids(db: Session, excluded: set[str]):
    statement = select(UserAccount.id).where(UserAccount.is_active.is_(True))
    excluded_ids = excluded_local_user_ids(db, excluded)
    if excluded_ids:
        statement = statement.where(UserAccount.id.not_in(excluded_ids))
    return statement


def site_metric_data(db: Session, now: datetime | None = None) -> dict:
    now = now or datetime.now(timezone.utc)
    excluded = excluded_provider_subjects()
    user_ids = included_user_ids(db, excluded)
    # Compare equal windows and exclude the unfinished hour, matching traffic.
    # Current account/follow inventory below is explicitly as of fetchedAt.
    ends_at = completed_hour(now)
    seven_days_ago = ends_at - timedelta(days=7)
    thirty_days_ago = ends_at - timedelta(days=30)
    period_totals, lifetime_totals = action_period_totals(
        db,
        {
            "actions7d": (seven_days_ago, ends_at),
            "actions30d": (thirty_days_ago, ends_at),
            "previousActions7d": (ends_at - timedelta(days=14), seven_days_ago),
            "previousActions30d": (ends_at - timedelta(days=60), thirty_days_ago),
        },
        ends_at,
    )

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
    previous7d: dict[str, int | None] = dict(period_totals["previousActions7d"])
    previous30d: dict[str, int | None] = dict(period_totals["previousActions30d"])
    for key in all_keys.values():
        if not history[key]["previous7dComplete"]:
            previous7d[key] = None
        if not history[key]["previous30dComplete"]:
            previous30d[key] = None

    reader_counts = {
        "registeredReaders": select(func.count()).select_from(user_ids.subquery()),
        "currentBillWatches": select(func.count(TrackedBill.id)).where(
            TrackedBill.user_id.in_(user_ids)
        ),
        "differentBillsCurrentlyWatched": select(
            func.count(distinct(TrackedBill.bill_id))
        ).where(TrackedBill.user_id.in_(user_ids)),
        "currentBillFollowingReaders": select(
            func.count(distinct(TrackedBill.user_id))
        ).where(TrackedBill.user_id.in_(user_ids)),
        "currentCommitteeFollowingReaders": select(
            func.count(distinct(TrackedCommittee.user_id))
        ).where(TrackedCommittee.user_id.in_(user_ids)),
        "currentCommitteeWatches": select(func.count(TrackedCommittee.id)).where(
            TrackedCommittee.user_id.in_(user_ids)
        ),
        "differentCommitteesCurrentlyWatched": select(
            func.count(distinct(TrackedCommittee.registration_number))
        ).where(TrackedCommittee.user_id.in_(user_ids)),
    }
    counts = db.execute(
        select(
            *(
                statement.scalar_subquery().label(key)
                for key, statement in reader_counts.items()
            )
        )
    ).one()
    readers = {key: int(value or 0) for key, value in counts._mapping.items()}
    # Keep the former field as a compatibility alias, not a lifetime-signup claim.
    readers["currentReaderAccounts"] = readers["registeredReaders"]

    def period(days: int):
        starts = ends_at - timedelta(days=days)
        return {
            "startsAt": starts.isoformat(),
            "endsAt": ends_at.isoformat(),
            "previousStartsAt": (starts - timedelta(days=days)).isoformat(),
            "previousEndsAt": starts.isoformat(),
        }

    return {
        "actions7d": period_totals["actions7d"],
        "actions30d": period_totals["actions30d"],
        "previousActions7d": previous7d,
        "previousActions30d": previous30d,
        "periods7d": period(7),
        "periods30d": period(30),
        "history": history,
        "totalsSinceStart": lifetime_totals,
        "readers": readers,
        "fetchedAt": now.isoformat(),
        "teamExclusionConfigured": True,
    }


@router.get("/site-metrics")
def site_metric_totals(
    version: Literal["1", "2"] = "1", db: Session = Depends(get_db)
) -> JSONResponse:
    totals = site_metric_data(db)
    if version == "1":
        # Keep already-open browsers working while the backend and web release
        # roll out separately. The expanded contract is explicitly requested.
        legacy_actions = (
            "billSearchesWithResults",
            "legislatorSearchesWithResults",
            "findMyLegislatorWithResults",
            "officialSourceLinksOpened",
            "newBillWatches",
        )
        totals = {
            "actions7d": {key: totals["actions7d"][key] for key in legacy_actions},
            "actions30d": {key: totals["actions30d"][key] for key in legacy_actions},
            "readers": {
                key: totals["readers"][key]
                for key in (
                    "registeredReaders",
                    "currentBillWatches",
                    "differentBillsCurrentlyWatched",
                )
            },
            "fetchedAt": totals["fetchedAt"],
            "teamExclusionConfigured": totals["teamExclusionConfigured"],
        }
    return JSONResponse(
        content={"data": totals},
        headers={
            "Cache-Control": "public, max-age=0, s-maxage=300, stale-while-revalidate=60"
        },
    )
