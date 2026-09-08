"""Aggregate-only leadership measurements and their limits."""

from __future__ import annotations

import json
import uuid
from datetime import UTC, datetime, timedelta

import pytest
from sqlalchemy import event, func, select, text

from alethical.api.services.leadership_metrics import leadership_metrics
from alethical.db import models
from alethical.db.session import get_session_factory


NOW = datetime(2026, 9, 7, 12, tzinfo=UTC)
START = datetime(2026, 8, 8, tzinfo=UTC)
END = datetime(2026, 9, 7, tzinfo=UTC)


@pytest.fixture
def db():
    # The suite's conftest selects a worktree-specific local database. Every
    # fixture row below stays in this transaction and is rolled back.
    with get_session_factory()() as session:
        session.execute(text("UPDATE cf_current_release SET release_id = NULL"))
        session.execute(text("UPDATE cf_filing_current SET snapshot_id = NULL"))
        session.execute(
            text("UPDATE lobbying_expenditure_current SET snapshot_id = NULL")
        )
        session.execute(text("DELETE FROM bill_summary_request"))
        session.execute(text("UPDATE ingestion_run SET status = 'cancelled'"))
        yield session
        session.rollback()


def run(
    db, *, adapter="minnesota_live", target="bill", status="succeeded", finished=NOW
):
    item = models.IngestionRun(
        adapter=adapter,
        target_type=target,
        status=models.IngestionStatus(status),
        started_at=finished - timedelta(minutes=1),
        finished_at=finished,
        stats={},
        error_text="private failure details",
        target_key="private target detail",
    )
    db.add(item)
    db.flush()
    return item


def summary(db, *, status="completed", finished=START, cost=1000, reserved=999999999):
    item = models.BillSummaryRequest(
        bill_id=uuid.uuid4(),
        bill_version_id=uuid.uuid4(),
        source_text_fingerprint="f" * 64,
        prompt_context_version="test",
        prepared_prompt_fingerprint=uuid.uuid4().hex * 2,
        model_name="test",
        status=models.BillSummaryRequestStatus(status),
        provider_call_started_at=finished - timedelta(seconds=1),
        provider_call_finished_at=finished,
        actual_cost_microusd=cost,
        reserved_cost_microusd=reserved,
        failure_kind="private failure details",
        provider_response_json={"private": "provider text"},
    )
    db.add(item)
    db.flush()
    return item


def by_source(result, source):
    return next(row for row in result["freshness"] if row["source"] == source)


def test_corpus_counts_are_stored_rows_not_official_coverage(db):
    result = leadership_metrics(db, now=NOW)
    for key, model in (
        ("bills", models.Bill),
        ("legislators", models.Legislator),
        ("committees", models.Committee),
    ):
        assert result["corpus"][key] == db.scalar(select(func.count(model.id)))
    assert "all sessions" in result["corpus"]["scope"]
    assert result["corpus"]["coveragePercentage"]["value"] is None
    assert "official" in result["corpus"]["coveragePercentage"]["reason"]


def test_absent_measurements_are_unavailable_not_zero_cost_or_fake_freshness(db):
    result = leadership_metrics(db, now=NOW)
    assert all(row["lastSucceededAt"] is None for row in result["freshness"])
    assert all(row["unavailableReason"] for row in result["freshness"])
    cost = result["costs"]["billSummaryLoggedCost"]
    assert cost["valueMicrousd"] is None
    assert cost["status"] == "unavailable"
    assert cost["unavailableReason"]
    assert result["costs"]["totalOperatingCost"]["value"] is None
    assert result["reliability"]["allRequestFailures"]["value"] is None
    assert result["reliability"]["allJobFailures"]["value"] is None


def test_freshness_uses_successful_source_specific_finish_times_not_row_updates(db):
    earlier = NOW - timedelta(days=3)
    completed = run(db, finished=earlier)
    completed.updated_at = NOW
    run(db, status="failed", finished=NOW - timedelta(hours=1))
    run(db, status="running", finished=NOW)
    run(db, adapter="unknown_source", finished=NOW)
    run(db, target="legislator_roster", finished=NOW - timedelta(days=1))
    run(db, finished=NOW + timedelta(days=1))
    db.flush()

    result = leadership_metrics(db, now=NOW)
    bills = by_source(result, "Minnesota bills")
    assert bills["lastSucceededAt"] == earlier.isoformat()
    assert "1 bill" in bills["meaning"]
    assert "every bill" in bills["meaning"]
    roster = by_source(result, "Minnesota legislator roster")
    assert roster["lastSucceededAt"] == (NOW - timedelta(days=1)).isoformat()
    assert len(result["freshness"]) == 5


def test_published_filing_timestamp_is_separate_from_newer_unchanged_check(db):
    older = NOW - timedelta(days=8)
    snapshot = models.CampaignFinanceFilingSnapshot(
        fetch_started_at=older - timedelta(hours=1),
        fetch_completed_at=older,
        status=models.CampaignFinanceSnapshotStatus.loaded,
    )
    db.add(snapshot)
    db.flush()
    pointer = db.get(models.CampaignFinanceFilingCurrentSnapshot, True)
    if pointer is None:
        pointer = models.CampaignFinanceFilingCurrentSnapshot(id=True)
        db.add(pointer)
    pointer.snapshot_id = snapshot.id
    run(
        db,
        adapter="minnesota_campaign_finance_filings",
        target="campaign_finance_filing_snapshot",
        finished=NOW - timedelta(days=1),
    )
    # A later candidate not referenced by the published pointer is not live data.
    db.add(
        models.CampaignFinanceFilingSnapshot(
            fetch_started_at=NOW,
            fetch_completed_at=NOW,
            status=models.CampaignFinanceSnapshotStatus.quarantined,
        )
    )
    db.flush()

    item = by_source(leadership_metrics(db, now=NOW), "Minnesota campaign filings")
    assert item["lastSucceededAt"] == (NOW - timedelta(days=1)).isoformat()
    assert item["currentPublishedFetchCompletedAt"] == older.isoformat()
    assert "fetch window" in item["publishedDataMeaning"]


def test_failed_ingestion_counts_only_recorded_finishes_in_complete_utc_days(db):
    for finished in (START, END - timedelta(microseconds=1)):
        run(db, status="failed", finished=finished)
    for finished in (START - timedelta(microseconds=1), END, NOW):
        run(db, status="failed", finished=finished)
    run(db, status="succeeded", finished=START)
    unfinished = run(db, status="failed", finished=START)
    unfinished.finished_at = None
    db.flush()

    result = leadership_metrics(db, now=NOW)
    assert result["periodStartedAt"] == START.isoformat()
    assert result["periodEndedAt"] == END.isoformat()
    assert result["reliability"]["recordedIngestionFailures"]["value"] == 2
    assert "not all" in result["reliability"]["recordedIngestionFailures"]["meaning"]


def test_costs_use_logged_microusd_not_reserved_budget_or_status(db):
    summary(db, cost=125001, status="completed", finished=START)
    summary(db, cost=999, status="superseded", finished=END - timedelta(seconds=1))
    summary(db, cost=1000000, finished=START - timedelta(seconds=1))
    summary(db, cost=1000000, finished=END)
    result = leadership_metrics(db, now=NOW)
    cost = result["costs"]["billSummaryLoggedCost"]
    assert cost["valueMicrousd"] == 126000
    assert cost["requestsWithLoggedCost"] == 2
    assert cost["requestsWithoutLoggedCost"] == 0
    assert cost["status"] == "available"
    assert "list-price" in cost["meaning"]
    assert "not invoices" in cost["meaning"]


def test_missing_costs_are_partial_and_unknown_outcomes_are_not_failures(db):
    summary(db, cost=0)
    summary(db, cost=None, status="failed")
    summary(db, cost=None, status="ambiguous")
    result = leadership_metrics(db, now=NOW)
    cost = result["costs"]["billSummaryLoggedCost"]
    assert cost["valueMicrousd"] == 0
    assert cost["status"] == "partial"
    assert cost["requestsWithLoggedCost"] == 1
    assert cost["requestsWithoutLoggedCost"] == 2
    assert cost["unavailableReason"]
    assert result["reliability"]["billSummaryFailures"]["value"] == 1
    assert result["reliability"]["billSummaryAmbiguous"]["value"] == 1


def test_unlogged_or_invalid_costs_cannot_claim_zero_spending(db):
    summary(db, cost=None)
    summary(db, cost=-10)
    cost = leadership_metrics(db, now=NOW)["costs"]["billSummaryLoggedCost"]
    assert cost["valueMicrousd"] is None
    assert cost["status"] == "unavailable"
    assert cost["requestsWithLoggedCost"] == 0
    assert cost["requestsWithoutLoggedCost"] == 2


def test_report_reads_aggregates_without_private_records_or_writes(db):
    run(db, finished=START)
    summary(db)
    statements = []
    connection = db.connection()

    def collect(_conn, _cursor, statement, _parameters, _context, _executemany):
        statements.append(statement)

    event.listen(connection, "before_cursor_execute", collect)
    try:
        result = leadership_metrics(db, now=NOW)
    finally:
        event.remove(connection, "before_cursor_execute", collect)
    assert len(statements) == 4
    assert all(statement.lstrip().startswith("SELECT") for statement in statements)
    assert not any(
        name in statement.lower()
        for statement in statements
        for name in (
            "error_text",
            "target_key",
            "provider_response_json",
            "user_account",
        )
    )
    encoded = json.dumps(result)
    assert "private failure details" not in encoded
    assert "provider text" not in encoded
    assert "private target detail" not in encoded


def test_read_does_not_flush_pending_writes_from_its_caller(db):
    pending = models.IngestionRun(
        adapter="minnesota_live",
        target_type="bill",
        status=models.IngestionStatus.succeeded,
        finished_at=NOW,
    )
    db.add(pending)
    result = leadership_metrics(db, now=NOW)
    assert pending.id is None
    assert by_source(result, "Minnesota bills")["lastSucceededAt"] is None


@pytest.mark.parametrize(
    "source", ["Minnesota campaign payments", "Minnesota lobbying expenditures"]
)
def test_published_dataset_fetch_dates_follow_the_current_pointer(db, source):
    older = NOW - timedelta(days=9)
    if source == "Minnesota campaign payments":
        snapshots = []
        for dataset in models.CampaignFinanceDataset:
            snapshot = models.CampaignFinanceSnapshot(
                dataset=dataset,
                download_id="test",
                source_url="https://example.test",
                content_hash=uuid.uuid4().hex * 2,
                byte_size=10,
                status=models.CampaignFinanceSnapshotStatus.loaded,
            )
            db.add(snapshot)
            db.flush()
            snapshots.append(snapshot)
        published = models.CampaignFinanceRelease(
            contributions_snapshot_id=snapshots[0].id,
            expenditures_snapshot_id=snapshots[1].id,
            independent_expenditures_snapshot_id=snapshots[2].id,
            status=models.CampaignFinanceReleaseStatus.published,
            fetch_started_at=older - timedelta(minutes=2),
            fetch_completed_at=older,
        )
        pointer_type = models.CampaignFinanceCurrentRelease
        pointer_key = "release_id"
    else:
        published = models.LobbyingExpenditureSnapshot(
            download_id="test",
            source_url="https://example.test",
            content_hash=uuid.uuid4().hex * 2,
            byte_size=10,
            status=models.CampaignFinanceSnapshotStatus.loaded,
            fetch_started_at=older - timedelta(minutes=2),
            fetch_completed_at=older,
        )
        pointer_type = models.LobbyingExpenditureCurrentSnapshot
        pointer_key = "snapshot_id"
    db.add(published)
    db.flush()
    pointer = db.get(pointer_type, True)
    if pointer is None:
        pointer = pointer_type(id=True)
        db.add(pointer)
    setattr(pointer, pointer_key, published.id)
    db.flush()
    item = by_source(leadership_metrics(db, now=NOW), source)
    assert item["currentPublishedFetchCompletedAt"] == older.isoformat()
    assert item["publishedDataUnavailableReason"] is None
    setattr(pointer, pointer_key, None)
    db.flush()
    item = by_source(leadership_metrics(db, now=NOW), source)
    assert item["currentPublishedFetchCompletedAt"] is None
    assert item["publishedDataUnavailableReason"]


def test_window_is_complete_utc_days_even_when_now_has_another_timezone(db):
    from datetime import timezone

    same_instant = NOW.astimezone(timezone(timedelta(hours=-4)))
    result = leadership_metrics(db, now=same_instant)
    assert result["periodStartedAt"] == START.isoformat()
    assert result["periodEndedAt"] == END.isoformat()
    with pytest.raises(ValueError, match="timezone"):
        leadership_metrics(db, now=datetime(2026, 9, 7))
