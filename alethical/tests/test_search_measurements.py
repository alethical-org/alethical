"""Private measurements cannot leak through reports, ordinary auth or failed writes."""

from datetime import UTC, datetime, timedelta
import importlib

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import select, text
from alembic.migration import MigrationContext
from alembic.operations import Operations

from alethical.api.routers import search_measurements as routes
from alethical.api.services import search_measurements as service
from alethical.db.search_measurements import SearchMeasurementSnapshot as Snapshot
from alethical.db.search_measurements import SearchMeasurementMaintenance as Maintenance
from alethical.db.session import get_db, get_session_factory

NOW = datetime(2026, 10, 23, 12, tzinfo=UTC)


def export(now=NOW, **changes):
    payload = {
        "provider": "google",
        "view": "queries",
        "startDate": "2026-09-21",
        "endDate": "2026-10-20",
        "finalDataCutoff": "2026-10-20",
        "dataState": "final",
        "timeZone": "America/Los_Angeles",
        "rows": [{"keys": ["PRIVATE SEARCH WORDS"], "clicks": 2, "impressions": 10}],
        "coverage": {
            "exhaustive": False,
            "rowLimitReached": False,
            "privateExtra": "PRIVATE COVERAGE WORDS",
        },
        "property": "PRIVATE PROPERTY",
    }
    return service.MeasurementInput(
        provider="google",
        view="queries",
        status="success",
        fetched_at=now,
        payload={**payload, **changes},
    )


@pytest.fixture
def db():
    with get_session_factory()() as session:
        session.execute(text("DELETE FROM search_measurement_private.snapshot"))
        session.execute(text("DELETE FROM search_measurement_private.maintenance"))
        yield session
        session.rollback()


def test_safe_report_never_selects_raw_words_or_sums_overlapping_pulls(db):
    service.store(db, export(), now=NOW)
    service.store(db, export(NOW + timedelta(days=7)), now=NOW + timedelta(days=7))
    result = service.report(db, now=NOW + timedelta(days=7))
    assert "PRIVATE" not in str(result)
    assert len(result["monthlySnapshots"]) == 1
    assert result["monthlySnapshots"][0]["clicks"] == 2
    assert result["monthlySnapshots"][0]["countScope"] == "returned-detail-rows"
    assert result["crawlerRequests"]["value"] is None
    assert service.latest_private_export(db, "google", "queries", now=NOW)["rows"][0][
        "keys"
    ] == ["PRIVATE SEARCH WORDS"]


def test_failed_run_is_unknown_and_preserves_last_success(db):
    service.store(db, export(), now=NOW)
    failure = service.MeasurementInput(
        provider="google",
        view="queries",
        status="unavailable",
        fetched_at=NOW + timedelta(hours=1),
    )
    service.store(db, failure, now=NOW + timedelta(hours=1))
    result = service.report(db, now=NOW + timedelta(hours=1))
    assert result["latestAttempts"][0]["clicks"] is None
    assert result["latestAttempts"][0]["status"] == "unavailable"
    assert result["monthlySnapshots"][0]["clicks"] == 2
    assert service.latest_private_export(db, "google", "queries", now=NOW)["rows"]


def test_retries_are_idempotent_and_older_writes_cannot_replace_success(db):
    newer = export(NOW + timedelta(hours=1), rows=[{"clicks": 3, "impressions": 12}])
    service.store(db, newer, now=NOW + timedelta(hours=1))
    service.store(db, export(), now=NOW + timedelta(hours=1))
    service.store(db, newer, now=NOW + timedelta(hours=1))
    rows = db.scalars(select(Snapshot)).all()
    assert len(rows) == 1
    assert rows[0].summary["clicks"] == 3


def test_raw_access_ends_at_90_days_and_pruning_keeps_only_safe_summary(db):
    service.store(db, export(), now=NOW)
    expiry = NOW + timedelta(days=90)
    assert service.latest_private_export(db, "google", "queries", now=expiry) is None
    service.prune(db, now=expiry)
    record = db.scalar(select(Snapshot))
    assert record.payload is None
    assert "PRIVATE" not in str(record.summary)
    assert record.expires_at == datetime(2027, 11, 23, 12, tzinfo=UTC)
    service.prune(db, now=datetime(2027, 11, 23, 12, tzinfo=UTC))
    assert db.scalar(select(Snapshot)) is None


def test_independent_sweep_deletes_raw_data_when_collection_has_stopped(
    db, monkeypatch
):
    service.store(db, export(), now=NOW)

    def broken_collection(*args, **kwargs):
        raise RuntimeError("Provider access is broken")

    monkeypatch.setattr(service, "store", broken_collection)
    after_expiry = NOW + timedelta(days=90, hours=1)
    assert service.retention_status(db, now=after_expiry)["status"] == "overdue"
    result = service.sweep_retention(db, now=after_expiry)
    assert result["rawCleared"] == 1
    assert db.scalar(select(Snapshot)).payload is None
    status = service.retention_status(db, now=after_expiry)
    assert status["status"] == "current"
    assert status["lastSuccessAt"] == after_expiry.isoformat()
    assert status["expiredRawAwaitingDeletion"] == 0
    assert (
        service.retention_status(db, now=after_expiry + timedelta(hours=37))["status"]
        == "stale"
    )


def test_sweep_receipt_is_atomic_and_failure_keeps_previous_success(db, monkeypatch):
    service.store(db, export(), now=NOW)
    service.sweep_retention(db, now=NOW)
    after_expiry = NOW + timedelta(days=91)
    execute = db.execute

    def fail_receipt(statement, *args, **kwargs):
        if getattr(getattr(statement, "table", None), "name", None) == "maintenance":
            raise RuntimeError("Receipt write failed")
        return execute(statement, *args, **kwargs)

    with pytest.raises(RuntimeError), db.begin_nested():
        monkeypatch.setattr(db, "execute", fail_receipt)
        service.sweep_retention(db, now=after_expiry)
    monkeypatch.setattr(db, "execute", execute)
    db.expire_all()
    assert db.scalar(select(Snapshot)).payload is not None
    assert db.get(Maintenance, "daily-retention").last_success_at == NOW
    assert service.retention_status(db, now=after_expiry)["status"] == "overdue"


def test_independent_sweep_removes_expired_summaries_and_reports_missing_runs(db):
    assert service.retention_status(db, now=NOW)["status"] == "missing"
    service.store(db, export(), now=NOW)
    after_summary_expiry = datetime(2027, 11, 24, 12, tzinfo=UTC)
    result = service.sweep_retention(db, now=after_summary_expiry)
    assert result["summariesRemoved"] == 1
    assert db.scalar(select(Snapshot)) is None
    assert service.retention_status(db, now=after_summary_expiry)["status"] == "current"


def test_storage_schema_has_no_public_access_and_rls_is_enabled(db):
    assert db.scalar(
        text(
            "SELECT relrowsecurity FROM pg_class WHERE oid = 'search_measurement_private.snapshot'::regclass"
        )
    )
    assert not db.scalar(
        text(
            "SELECT EXISTS(SELECT 1 FROM pg_namespace n CROSS JOIN LATERAL aclexplode(n.nspacl) a WHERE n.nspname = 'search_measurement_private' AND a.grantee = 0)"
        )
    )


def test_additive_migration_rolls_back_only_its_private_schema(db):
    migration = importlib.import_module(
        "alethical.alembic.versions.0071_private_search_measurements"
    )
    before = db.scalar(text("SELECT count(*) FROM public.bill"))
    with Operations.context(MigrationContext.configure(db.connection())):
        migration.downgrade()
        assert (
            db.scalar(text("SELECT to_regnamespace('search_measurement_private')"))
            is None
        )
        assert db.scalar(text("SELECT count(*) FROM public.bill")) == before
        migration.upgrade()
    assert (
        db.scalar(text("SELECT count(*) FROM search_measurement_private.snapshot")) == 0
    )
    assert not db.scalar(
        text(
            "SELECT EXISTS(SELECT 1 FROM pg_class c CROSS JOIN LATERAL aclexplode(c.relacl) a WHERE c.oid = 'search_measurement_private.snapshot'::regclass AND a.grantee = 0)"
        )
    )


@pytest.mark.parametrize(
    "changes",
    [
        {"rows": [{"clicks": -1, "impressions": 1}]},
        {"rows": [{"clicks": True, "impressions": 1}]},
        {"rows": [{"clicks": 1, "impressions": float("inf")}]},
        {"rows": [{"clicks": 1, "impressions": 1}] * 4001},
        {"startDate": "PRIVATE QUERY"},
        {"endDate": "2026-02-30"},
        {"coverage": {"exhaustive": True, "rowLimitReached": False}},
    ],
)
def test_malformed_exports_are_rejected(changes):
    with pytest.raises(ValueError):
        export(**changes)


class FakeDb:
    def commit(self):
        pass

    def rollback(self):
        pass


@pytest.fixture
def route_client():
    app = FastAPI()
    app.include_router(routes.router)
    app.dependency_overrides[get_db] = lambda: FakeDb()
    return TestClient(app)


def test_machine_auth_fails_closed_and_never_becomes_admin_auth(
    route_client, monkeypatch
):
    monkeypatch.delenv("SEARCH_MEASUREMENT_WRITE_TOKEN", raising=False)
    response = route_client.post("/internal/v1/search-measurements", json={})
    assert response.status_code == 401
    monkeypatch.setenv("SEARCH_MEASUREMENT_WRITE_TOKEN", "x" * 32)
    assert (
        route_client.post(
            "/internal/v1/search-measurements",
            headers={"Authorization": "Bearer person"},
            json={},
        ).status_code
        == 401
    )
    assert (
        route_client.get(
            "/api/v1/admin/search-measurements",
            headers={"X-Search-Measurement-Token": "x" * 32},
        ).status_code
        == 401
    )


def test_validation_errors_do_not_echo_raw_provider_data(route_client, monkeypatch):
    monkeypatch.setenv("SEARCH_MEASUREMENT_WRITE_TOKEN", "x" * 32)
    response = route_client.post(
        "/internal/v1/search-measurements",
        headers={"X-Search-Measurement-Token": "x" * 32},
        json={"provider": "PRIVATE SEARCH WORDS"},
    )
    assert response.status_code == 400
    assert "PRIVATE" not in response.text
    assert response.headers["cache-control"] == "private, no-store"


def test_body_size_is_bounded_before_json_parsing(route_client, monkeypatch):
    monkeypatch.setenv("SEARCH_MEASUREMENT_WRITE_TOKEN", "x" * 32)
    response = route_client.post(
        "/internal/v1/search-measurements",
        headers={"X-Search-Measurement-Token": "x" * 32},
        content=b"a" * (service.MAX_PAYLOAD_BYTES + 2049),
    )
    assert response.status_code == 413
