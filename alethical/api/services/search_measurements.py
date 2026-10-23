"""Private snapshots and deterministic summaries; never log provider payloads."""

import calendar
import json
import math
from datetime import UTC, datetime, timedelta
from typing import Literal

from pydantic import BaseModel, ConfigDict, model_validator
from sqlalchemy import delete, func, select, text, update
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.orm import Session

from alethical.db.search_measurements import SearchMeasurementSnapshot as Snapshot
from alethical.db.search_measurements import SearchMeasurementMaintenance as Maintenance

MAX_PAYLOAD_BYTES = 2_000_000
Provider = Literal["google", "bing"]
View = Literal["queries", "pages", "query-pages"]
SOURCES = (
    ("google", "queries"),
    ("google", "pages"),
    ("google", "query-pages"),
    ("bing", "queries"),
    ("bing", "pages"),
)


class MeasurementInput(BaseModel):
    model_config = ConfigDict(extra="forbid")
    provider: Provider
    view: View
    status: Literal["success", "unavailable"]
    fetched_at: datetime
    payload: dict | None = None

    @model_validator(mode="after")
    def valid_payload(self):
        if self.fetched_at.tzinfo is None:
            raise ValueError("Timestamp needs a time zone")
        if self.provider == "bing" and self.view == "query-pages":
            raise ValueError("Unsupported source view")
        if self.status == "unavailable":
            if self.payload is not None:
                raise ValueError("Failed exports cannot carry provider data")
            return self
        payload = self.payload
        if (
            not payload
            or payload.get("provider") != self.provider
            or payload.get("view") != self.view
        ):
            raise ValueError("Source does not match export")
        if len(json.dumps(payload, allow_nan=False).encode()) > MAX_PAYLOAD_BYTES:
            raise ValueError("Export too large")
        rows = payload.get("rows")
        if not isinstance(rows, list) or len(rows) > 4000:
            raise ValueError("Invalid row count")
        for row in rows:
            if not isinstance(row, dict):
                raise ValueError("Invalid row")
            for field in ("clicks", "impressions"):
                value = row.get(field)
                if (
                    isinstance(value, bool)
                    or not isinstance(value, (float, int))
                    or not math.isfinite(value)
                    or value < 0
                ):
                    raise ValueError("Invalid count")
        for field in ("startDate", "endDate", "finalDataCutoff"):
            value = payload.get(field)
            if value is not None:
                if (
                    not isinstance(value, str)
                    or len(value) != 10
                    or datetime.strptime(value, "%Y-%m-%d").strftime("%Y-%m-%d")
                    != value
                ):
                    raise ValueError("Invalid date")
        if self.provider == "google":
            if (
                payload.get("dataState") != "final"
                or payload.get("timeZone") != "America/Los_Angeles"
                or not payload.get("startDate")
                or not payload.get("endDate")
                or payload.get("finalDataCutoff") != payload.get("endDate")
                or payload["startDate"] > payload["endDate"]
            ):
                raise ValueError("Google export requires a finalized date window")
        elif (
            payload.get("dataState") != "unknown"
            or payload.get("timeZone") is not None
            or any(
                payload.get(field) is not None
                for field in ("startDate", "endDate", "finalDataCutoff")
            )
        ):
            raise ValueError("Bing export cannot claim an unverified date window")
        coverage = payload.get("coverage")
        if (
            not isinstance(coverage, dict)
            or coverage.get("exhaustive") is not False
            or not isinstance(coverage.get("rowLimitReached"), bool)
        ):
            raise ValueError("Export must disclose provider coverage")
        return self


def _after_months(now: datetime, months: int) -> datetime:
    month_index = now.year * 12 + now.month - 1 + months
    year, month = divmod(month_index, 12)
    month += 1
    return now.replace(
        year=year, month=month, day=min(now.day, calendar.monthrange(year, month)[1])
    )


def safe_summary(item: MeasurementInput) -> dict:
    # Only fixed labels, validated dates and aggregate numbers can outlive raw rows.
    if item.status != "success" or item.payload is None:
        return {
            "status": "unavailable",
            "clicks": None,
            "impressions": None,
            "rowCount": None,
        }
    payload = item.payload
    dates_without_rows = payload["coverage"].get("datesWithoutRows")
    return {
        "status": "success",
        "clicks": sum(row["clicks"] for row in payload["rows"]),
        "impressions": sum(row["impressions"] for row in payload["rows"]),
        "rowCount": len(payload["rows"]),
        "startDate": payload.get("startDate"),
        "endDate": payload.get("endDate"),
        "finalDataCutoff": payload.get("finalDataCutoff"),
        "rowLimitReached": payload["coverage"]["rowLimitReached"],
        "exhaustive": False,
        "countScope": "returned-detail-rows",
        "comparableWithPropertyTotals": False,
        "datesWithoutRowsCount": len(dates_without_rows)
        if isinstance(dates_without_rows, list)
        else None,
        "timeZone": "America/Los_Angeles" if item.provider == "google" else None,
        "dataState": "final" if item.provider == "google" else "unknown",
        "limitation": "Provider top rows; omitted rows and missing dates are not proof of no searches.",
    }


def prune(db: Session, *, now: datetime) -> dict:
    cleared = db.execute(
        update(Snapshot)
        .where(Snapshot.raw_expires_at <= now, Snapshot.payload.is_not(None))
        .values(payload=None)
    )
    removed = db.execute(delete(Snapshot).where(Snapshot.expires_at <= now))
    return {"rawCleared": cleared.rowcount, "summariesRemoved": removed.rowcount}


def sweep_retention(db: Session, *, now: datetime | None = None) -> dict:
    """Independent daily sweep; no provider identity, token, fetch or new write is needed."""
    now = now or datetime.now(UTC)
    db.execute(text("SET LOCAL lock_timeout = '5s'"))
    db.execute(text("SET LOCAL statement_timeout = '30s'"))
    counts = prune(db, now=now)
    values = {
        "id": "daily-retention",
        "last_success_at": now,
        "raw_cleared": counts["rawCleared"],
        "summaries_removed": counts["summariesRemoved"],
    }
    statement = insert(Maintenance).values(**values)
    db.execute(
        statement.on_conflict_do_update(
            index_elements=[Maintenance.id],
            set_=values,
            where=Maintenance.last_success_at <= now,
        )
    )
    return {"lastSuccessAt": now.isoformat(), **counts}


def retention_status(db: Session, *, now: datetime | None = None) -> dict:
    now = now or datetime.now(UTC)
    receipt = db.get(Maintenance, "daily-retention", populate_existing=True)
    expired_raw = db.scalar(
        select(func.count())
        .select_from(Snapshot)
        .where(Snapshot.raw_expires_at <= now, Snapshot.payload.is_not(None))
    )
    expired_summaries = db.scalar(
        select(func.count()).select_from(Snapshot).where(Snapshot.expires_at <= now)
    )
    last_success = receipt.last_success_at if receipt else None
    state = (
        "missing"
        if last_success is None
        else "stale"
        if last_success < now - timedelta(hours=36)
        else "current"
    )
    if expired_raw or expired_summaries:
        state = "overdue"
    return {
        "status": state,
        "lastSuccessAt": last_success.isoformat() if last_success else None,
        "rawClearedAtLastSweep": receipt.raw_cleared if receipt else None,
        "summariesRemovedAtLastSweep": receipt.summaries_removed if receipt else None,
        "expiredRawAwaitingDeletion": expired_raw,
        "expiredSummariesAwaitingDeletion": expired_summaries,
        "policy": "Raw access expires after 90 days; an independent daily sweep deletes expired raw data. Safe summaries expire after 13 months. Sweep delay can reach 1 day; missing, stale and overdue sweeps are reported.",
    }


def store(db: Session, item: MeasurementInput, *, now: datetime | None = None) -> None:
    now = now or datetime.now(UTC)
    if item.fetched_at > now + timedelta(
        minutes=5
    ) or item.fetched_at < now - timedelta(days=1):
        raise ValueError("Export timestamp outside ingestion window")
    fetched = item.fetched_at.astimezone(UTC)
    # Retry-safe, at most 2 records per source/view/day; a failure never overwrites a success.
    identity = f"{item.provider}:{item.view}:{fetched.date()}:{item.status}"
    values = dict(
        id=identity,
        provider=item.provider,
        view=item.view,
        status=item.status,
        fetched_at=fetched,
        received_at=now,
        raw_expires_at=now + timedelta(days=90),
        expires_at=_after_months(now, 13),
        payload=item.payload,
        summary=safe_summary(item),
    )
    statement = insert(Snapshot).values(**values)
    db.execute(
        statement.on_conflict_do_update(
            index_elements=[Snapshot.id],
            set_=values,
            where=Snapshot.fetched_at < fetched,
        )
    )
    prune(db, now=now)


def report(db: Session, *, now: datetime | None = None) -> dict:
    now = now or datetime.now(UTC)
    # No raw query, page, property or provider error is selected for a report.
    records = db.execute(
        select(
            Snapshot.provider,
            Snapshot.view,
            Snapshot.status,
            Snapshot.fetched_at,
            Snapshot.summary,
        )
        .where(Snapshot.expires_at > now)
        .order_by(Snapshot.fetched_at.desc())
    ).all()
    latest = {}
    monthly = {}
    for provider, view, status, fetched, summary in records:
        key = (provider, view)
        latest.setdefault(
            key,
            {
                "provider": provider,
                "view": view,
                "fetchedAt": fetched.isoformat(),
                **summary,
            },
        )
        month_key = (provider, view, fetched.strftime("%Y-%m"))
        if status == "success":
            monthly.setdefault(
                month_key,
                {
                    "provider": provider,
                    "view": view,
                    "month": month_key[2],
                    "fetchedAt": fetched.isoformat(),
                    **summary,
                },
            )
    for key in SOURCES:
        latest.setdefault(
            key,
            {
                "provider": key[0],
                "view": key[1],
                "status": "missing",
                "fetchedAt": None,
                "clicks": None,
                "impressions": None,
                "rowCount": None,
            },
        )
    return {
        "asOf": now.isoformat(),
        "latestAttempts": list(latest.values()),
        "monthlySnapshots": list(monthly.values()),
        "scope": "Latest successful pull in each month; overlapping pulls are never summed. Each row states its measured date window.",
        "retention": retention_status(db, now=now),
        "crawlerRequests": {
            "value": None,
            "coverage": "missing",
            "reason": "No verified public-page server request source is connected.",
        },
        "aiReferrals": {
            "value": None,
            "coverage": "missing",
            "reason": "Referrer-host source has not been verified.",
        },
    }


def latest_private_export(
    db: Session, provider: Provider, view: View, *, now: datetime | None = None
) -> dict | None:
    now = now or datetime.now(UTC)
    return db.scalar(
        select(Snapshot.payload)
        .where(
            Snapshot.provider == provider,
            Snapshot.view == view,
            Snapshot.status == "success",
            Snapshot.raw_expires_at > now,
            Snapshot.payload.is_not(None),
        )
        .order_by(Snapshot.fetched_at.desc())
        .limit(1)
    )
