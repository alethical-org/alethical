"""Private aggregates have server-side access checks and independent sources."""

from alethical.api.routers.admin import administrator_access, require_admin
from alethical.api.routers import (
    leadership_metrics as private,
    site_metric_accounts as accounts,
)
from alethical.api.routers import site_metrics


def test_private_report_rejects_unsigned_requests(client):
    response = client.get("/api/v1/admin/site-metrics")
    assert response.status_code == 401
    assert "operations" not in response.json()


def test_private_report_rejects_nonadmin(client):
    client.app.dependency_overrides[administrator_access] = lambda: False
    response = client.get("/api/v1/admin/site-metrics")
    assert response.status_code == 403


def test_private_sources_fail_independently(client, monkeypatch):
    client.app.dependency_overrides[require_admin] = lambda: None

    def failed(*args, **kwargs):
        raise RuntimeError("private@example.invalid should never leave server")

    monkeypatch.setattr(private, "leadership_metrics", failed)
    monkeypatch.setattr(
        private,
        "aggregate_account_signups",
        lambda *a, **kw: {"currentAccountsCreated": 3},
    )
    monkeypatch.setattr(
        site_metrics, "site_metric_data", lambda *a, **kw: {"actions7d": {}}
    )
    response = client.get("/api/v1/admin/site-metrics")
    assert response.status_code == 200
    assert response.headers["Cache-Control"] == "private, no-store"
    result = response.json()
    assert result["operations"] is None
    assert result["accounts"]["currentAccountsCreated"] == 3
    assert result["activity"] == {"actions7d": {}}
    assert result["errors"]["operations"]
    assert result["errors"]["accounts"] is None
    assert "private@example" not in response.text


def test_public_signup_failure_never_becomes_zero(client, monkeypatch):
    def failed(*args, **kwargs):
        raise RuntimeError("private source detail")

    monkeypatch.setattr(accounts, "aggregate_account_signups", failed)
    response = client.get("/api/v1/site-metrics/accounts")
    assert response.status_code == 503
    assert response.headers["Cache-Control"] == "no-store"
    assert response.json() == {
        "error": "Account creation totals are temporarily unavailable."
    }


def test_public_signup_success_has_only_aggregate_source_result(client, monkeypatch):
    monkeypatch.setattr(
        accounts,
        "aggregate_account_signups",
        lambda *a, **kw: {"currentAccountsCreated": 3},
    )
    response = client.get("/api/v1/site-metrics/accounts")
    assert response.status_code == 200
    assert response.json() == {"currentAccountsCreated": 3}
    assert "s-maxage=300" in response.headers["Cache-Control"]
