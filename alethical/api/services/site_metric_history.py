"""Anonymous totals committed in the same transaction as their saved rows.

Only the caller creating a new account/follow calls this module. Retrying an
existing row and linking another sign-in method do not create another count.
Hourly buckets are private implementation detail, not a public activity feed.
"""

from datetime import datetime, timedelta, timezone
from uuid import UUID

from sqlalchemy import delete, func, select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.orm import Session

from alethical.db.models import (
    SiteMetricCoverage,
    SiteMetricHourlyCount,
    SiteMetricReceipt,
)


CREATION_RESPONSE_KEYS = {
    "account_created": "newReaderAccounts",
    "bill_watch_created": "newBillWatches",
    "committee_watch_created": "newCommitteeWatches",
}
EVENT_RECEIPT_TTL = timedelta(hours=24)


def completed_hour(now: datetime) -> datetime:
    return now.astimezone(timezone.utc).replace(minute=0, second=0, microsecond=0)


def ensure_coverage(db: Session, metric_kind: str, now: datetime) -> None:
    db.execute(
        insert(SiteMetricCoverage)
        .values(metric_kind=metric_kind, recording_started_at=now)
        .on_conflict_do_nothing(index_elements=["metric_kind"])
    )


def record_creation(db: Session, metric_kind: str) -> None:
    """Atomically add 1, retaining no input that points back to the reader."""
    if metric_kind not in CREATION_RESPONSE_KEYS:
        raise ValueError("Unknown creation metric")
    db.flush()
    now = datetime.now(timezone.utc)
    ensure_coverage(db, metric_kind, now)
    db.execute(
        insert(SiteMetricHourlyCount)
        .values(metric_kind=metric_kind, bucket_started_at=completed_hour(now), count=1)
        .on_conflict_do_update(
            index_elements=["metric_kind", "bucket_started_at"],
            set_={"count": SiteMetricHourlyCount.count + 1},
        )
    )


def creation_totals(
    db: Session, starts_at: datetime | None, ends_at: datetime
) -> dict[str, int]:
    statement = (
        select(SiteMetricHourlyCount.metric_kind, func.sum(SiteMetricHourlyCount.count))
        .where(SiteMetricHourlyCount.bucket_started_at < ends_at)
        .group_by(SiteMetricHourlyCount.metric_kind)
    )
    if starts_at is not None:
        statement = statement.where(
            SiteMetricHourlyCount.bucket_started_at >= starts_at
        )
    counts = {kind: count for kind, count in db.execute(statement).all()}
    return {
        key: int(counts.get(kind, 0)) for kind, key in CREATION_RESPONSE_KEYS.items()
    }


def claim_event_receipt(db: Session, event_id: UUID, now: datetime) -> bool:
    """Claim one retry key for 24h, atomically with the event it protects.

    Requests remove expired keys; no timed agent is needed. Expiry bounds the
    deduplication promise, not the age of the anonymous action total.
    """
    db.execute(delete(SiteMetricReceipt).where(SiteMetricReceipt.expires_at <= now))
    return (
        db.scalar(
            insert(SiteMetricReceipt)
            .values(event_id=event_id, expires_at=now + EVENT_RECEIPT_TTL)
            .on_conflict_do_nothing(index_elements=["event_id"])
            .returning(SiteMetricReceipt.event_id)
        )
        is not None
    )
