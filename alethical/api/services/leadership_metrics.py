"""Server-only leadership aggregates from existing records, without reader tracking.

This service has no route of its own. Its caller must require administrator access
and return Cache-Control: no-store. Database errors propagate to that caller rather
than becoming plausible zero counts.
"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from typing import Any

from sqlalchemy import func, select, tuple_
from sqlalchemy.orm import Session

from alethical.db import models as schema


# Each pair is written by an existing source importer. Do not expose arbitrary
# adapters, target keys, error text, or per-request rows from the ingestion ledger.
SOURCES = (
    (
        "minnesota_live",
        "bill",
        "Minnesota bills",
        "Latest recorded successful refresh of 1 bill, not proof that every bill is current.",
    ),
    (
        "minnesota_live",
        "legislator_roster",
        "Minnesota legislator roster",
        "Latest recorded successful legislator-roster import.",
    ),
    (
        "minnesota_campaign_finance",
        "campaign_finance_release",
        "Minnesota campaign payments",
        "Latest recorded successful campaign-payment import, including unchanged checks.",
    ),
    (
        "minnesota_campaign_finance_filings",
        "campaign_finance_filing_snapshot",
        "Minnesota campaign filings",
        "Latest recorded successful campaign-filing import, including unchanged checks.",
    ),
    (
        "minnesota_lobbying",
        "lobbying_expenditure_snapshot",
        "Minnesota lobbying expenditures",
        "Latest recorded successful lobbying-expenditure import, including unchanged checks.",
    ),
)


def _iso(value: datetime | None) -> str | None:
    return value.astimezone(UTC).isoformat() if value is not None else None


def _published_fetch(snapshot, pointer, foreign_key, status):
    return (
        select(snapshot.fetch_completed_at)
        .join(pointer, foreign_key == snapshot.id)
        .where(pointer.id.is_(True), snapshot.status == status)
        .scalar_subquery()
    )


def leadership_metrics(db: Session, *, now: datetime | None = None) -> dict[str, Any]:
    """Return server-only aggregates without flushing a caller's pending writes."""
    with db.no_autoflush:
        return _leadership_metrics(db, now=now)


def _leadership_metrics(db: Session, *, now: datetime | None) -> dict[str, Any]:
    """Read 4 aggregate queries; never commit, fetch private rows, or call a vendor.

    Corpus counts describe the records stored now, across all sessions. The
    failure and logged-cost window is [start, end): 30 complete UTC days.
    Freshness describes source-specific checks and published fetch windows,
    never a generic row-update timestamp or a promise about every source record.
    """
    now = now if now is not None else datetime.now(UTC)
    if now.tzinfo is None or now.utcoffset() is None:
        raise ValueError("now must have a timezone")
    now = now.astimezone(UTC)
    end = now.replace(hour=0, minute=0, second=0, microsecond=0)
    start = end - timedelta(days=30)
    run = schema.IngestionRun
    request = schema.BillSummaryRequest

    # A single round trip, without multiplying counts through joins.
    counts = db.execute(
        select(
            select(func.count(schema.Bill.id)).scalar_subquery().label("bills"),
            select(func.count(schema.Legislator.id))
            .scalar_subquery()
            .label("legislators"),
            select(func.count(schema.Committee.id))
            .scalar_subquery()
            .label("committees"),
            select(func.count(run.id))
            .where(
                run.status == schema.IngestionStatus.failed,
                run.finished_at >= start,
                run.finished_at < end,
            )
            .scalar_subquery()
            .label("ingestion_failures"),
        )
    ).one()

    latest_checks = {
        (adapter, target): finished
        for adapter, target, finished in db.execute(
            select(run.adapter, run.target_type, func.max(run.finished_at))
            .where(
                tuple_(run.adapter, run.target_type).in_(
                    [(adapter, target) for adapter, target, _, _ in SOURCES]
                ),
                run.status == schema.IngestionStatus.succeeded,
                run.finished_at <= now,
            )
            .group_by(run.adapter, run.target_type)
        )
    }

    published = db.execute(
        select(
            _published_fetch(
                schema.CampaignFinanceRelease,
                schema.CampaignFinanceCurrentRelease,
                schema.CampaignFinanceCurrentRelease.release_id,
                schema.CampaignFinanceReleaseStatus.published,
            ),
            _published_fetch(
                schema.CampaignFinanceFilingSnapshot,
                schema.CampaignFinanceFilingCurrentSnapshot,
                schema.CampaignFinanceFilingCurrentSnapshot.snapshot_id,
                schema.CampaignFinanceSnapshotStatus.loaded,
            ),
            _published_fetch(
                schema.LobbyingExpenditureSnapshot,
                schema.LobbyingExpenditureCurrentSnapshot,
                schema.LobbyingExpenditureCurrentSnapshot.snapshot_id,
                schema.CampaignFinanceSnapshotStatus.loaded,
            ),
        )
    ).one()
    published_by_source = dict(zip([source[2] for source in SOURCES[2:]], published))
    freshness = []
    for adapter, target, source, meaning in SOURCES:
        succeeded_at = latest_checks.get((adapter, target))
        freshness.append(
            {
                "source": source,
                "lastSucceededAt": _iso(succeeded_at),
                "meaning": meaning,
                "unavailableReason": (
                    None
                    if succeeded_at
                    else "No successful completed check is recorded."
                ),
                "currentPublishedFetchCompletedAt": _iso(
                    published_by_source.get(source)
                ),
                "publishedDataMeaning": (
                    "End of the fetch window for the currently published dataset; "
                    "a newer unchanged check may not replace it."
                    if source in published_by_source
                    else "This source has no single published dataset fetch window."
                ),
                "publishedDataUnavailableReason": (
                    None
                    if published_by_source.get(source) is not None
                    else "No current usable published dataset is recorded."
                    if source in published_by_source
                    else "This source has no single published dataset fetch window."
                ),
            }
        )

    valid_cost = request.actual_cost_microusd >= 0
    summary = db.execute(
        select(
            func.count(request.id).label("requests"),
            func.count(request.id).filter(valid_cost).label("with_cost"),
            func.sum(request.actual_cost_microusd)
            .filter(valid_cost)
            .label("cost_microusd"),
            func.count(request.id)
            .filter(request.status == schema.BillSummaryRequestStatus.failed)
            .label("failed"),
            func.count(request.id)
            .filter(request.status == schema.BillSummaryRequestStatus.ambiguous)
            .label("ambiguous"),
        ).where(
            request.provider_call_finished_at >= start,
            request.provider_call_finished_at < end,
        )
    ).one()
    with_cost = int(summary.with_cost)
    without_cost = int(summary.requests) - with_cost
    cost_status = (
        "unavailable" if with_cost == 0 else "partial" if without_cost else "available"
    )
    cost_reason = None
    if cost_status != "available":
        cost_reason = (
            "No finished bill-summary provider requests are recorded in this window."
            if not summary.requests
            else "Some finished bill-summary requests lack a valid logged cost."
        )

    return {
        "fetchedAt": _iso(now),
        "periodStartedAt": _iso(start),
        "periodEndedAt": _iso(end),
        "corpus": {
            "bills": int(counts.bills),
            "legislators": int(counts.legislators),
            "committees": int(counts.committees),
            "scope": (
                "All stored records across all sessions, not just current officeholders. "
                "Committee records are legislative committees, not campaign committees."
            ),
            "coveragePercentage": {
                "value": None,
                "reason": "No matching official denominator is stored for corpus coverage.",
            },
        },
        "freshness": freshness,
        "reliability": {
            "recordedIngestionFailures": {
                "value": int(counts.ingestion_failures),
                "meaning": (
                    "Recorded ingestion runs marked failed and finished in the window; "
                    "not all background-job failures or interrupted runs."
                ),
            },
            "billSummaryFailures": {
                "value": int(summary.failed),
                "meaning": (
                    "Bill-summary requests whose provider call finished in the window "
                    "and whose stored status is failed; not a count of every failed attempt."
                ),
            },
            "billSummaryAmbiguous": {
                "value": int(summary.ambiguous),
                "meaning": (
                    "Bill-summary requests whose provider call finished in the window "
                    "and whose stored outcome remains ambiguous, not proven failures."
                ),
            },
            "allRequestFailures": {
                "value": None,
                "reason": (
                    "API errors are reported to Sentry; no complete durable request-failure "
                    "counter is stored in this database."
                ),
            },
            "allJobFailures": {
                "value": None,
                "reason": (
                    "The ingestion ledger does not record every background job or failed "
                    "attempt; no complete durable job-failure total is available here."
                ),
            },
        },
        "costs": {
            "billSummaryLoggedCost": {
                "valueMicrousd": int(summary.cost_microusd) if with_cost else None,
                "requestsWithLoggedCost": with_cost,
                "requestsWithoutLoggedCost": without_cost,
                "status": cost_status,
                "unavailableReason": cost_reason,
                "meaning": (
                    "Logged bill-summary list-price estimates for provider calls "
                    "finished in the window, in millionths of a US dollar; not invoices, "
                    "reserved budgets, or total operating cost."
                ),
            },
            "totalOperatingCost": {
                "value": None,
                "reason": (
                    "Complete hosting, storage, monitoring, and AI vendor bills are not "
                    "stored together in this database."
                ),
            },
        },
    }
