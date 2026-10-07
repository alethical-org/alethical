"""Source health requires private access and separates dispatch from collection."""

from sqlalchemy import delete

from alethical.db.models import SourceRefreshState
from alethical.db.session import get_session_factory


def test_source_health_requires_token_and_reports_disabled_clock(
    client, internal_headers, monkeypatch
):
    monkeypatch.delenv("ALETHICAL_SOURCE_REFRESH_DISPATCH_ENABLED", raising=False)
    with get_session_factory()() as db:
        db.execute(delete(SourceRefreshState))
        db.commit()
    assert client.get("/internal/v1/source-refresh").status_code == 401
    assert (
        client.get(
            "/internal/v1/source-refresh", headers={"X-Internal-Token": "wrong"}
        ).status_code
        == 401
    )
    response = client.get("/internal/v1/source-refresh", headers=internal_headers)
    assert response.status_code == 200
    body = response.json()
    assert body["independent_clock"] == "disabled"
    assert body["dispatches"] == []
    assert body["data"]
    assert all(row["last_succeeded_at"] is None for row in body["data"])
    assert all(row["status"] == "never_completed" for row in body["data"])


def test_source_health_distinguishes_missing_app_access(
    client, internal_headers, monkeypatch
):
    monkeypatch.setenv("ALETHICAL_SOURCE_REFRESH_DISPATCH_ENABLED", "true")
    monkeypatch.delenv("ALETHICAL_SOURCE_REFRESH_APP_ID", raising=False)
    response = client.get("/internal/v1/source-refresh", headers=internal_headers)
    assert response.status_code == 200
    assert response.json()["independent_clock"] == "missing_access"
