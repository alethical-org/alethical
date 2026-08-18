from __future__ import annotations

import json
from pathlib import Path

from fastapi.testclient import TestClient
from sqlalchemy.exc import SQLAlchemyError

from alethical.api import main
from alethical.api.readiness import database_schema_is_ready, expected_schema_head


class _VersionsResult:
    def __init__(self, versions: list[str]) -> None:
        self._versions = versions

    def scalars(self) -> _VersionsResult:
        return self

    def all(self) -> list[str]:
        return self._versions


class _Connection:
    def __init__(self, versions: list[str]) -> None:
        self._versions = versions

    def __enter__(self) -> _Connection:
        return self

    def __exit__(self, *_args: object) -> None:
        return None

    def execute(self, _statement: object) -> _VersionsResult:
        return _VersionsResult(self._versions)


class _Engine:
    def __init__(self, versions: list[str]) -> None:
        self._versions = versions

    def connect(self) -> _Connection:
        return _Connection(self._versions)


class _UnavailableEngine:
    def connect(self) -> None:
        raise SQLAlchemyError("database unavailable")


def test_database_is_ready_only_at_the_code_schema_head() -> None:
    expected = "0036_pending_action"

    assert database_schema_is_ready(_Engine([expected]), expected) is True
    assert database_schema_is_ready(_Engine(["0035_old"]), expected) is False
    assert database_schema_is_ready(_Engine([]), expected) is False
    assert (
        database_schema_is_ready(_Engine([expected, "other_head"]), expected) is False
    )


def test_database_connection_failure_is_not_ready() -> None:
    assert (
        database_schema_is_ready(_UnavailableEngine(), "0036_pending_action") is False
    )


def test_migrated_test_database_is_ready() -> None:
    assert expected_schema_head()
    assert database_schema_is_ready() is True


def test_ready_endpoint_refuses_traffic_until_database_is_current(monkeypatch) -> None:
    monkeypatch.setattr(main, "database_schema_is_ready", lambda: False)

    with TestClient(main.create_app()) as client:
        response = client.get("/readyz")

    assert response.status_code == 503
    assert response.json() == {"status": "not_ready"}


def test_railway_migrates_before_starting_and_checks_database_readiness() -> None:
    config = json.loads(Path("railway.json").read_text(encoding="utf-8"))
    migration_workflow = Path(".github/workflows/migrate.yml").read_text(
        encoding="utf-8"
    )
    deploy_workflow = Path(".github/workflows/railway-deploy.yml").read_text(
        encoding="utf-8"
    )

    assert config["deploy"]["preDeployCommand"] == (
        "uv run python -m alembic -c alembic.ini upgrade head"
    )
    assert config["deploy"]["healthcheckPath"] == "/readyz"
    assert "\n  workflow_dispatch:\n" in migration_workflow
    assert "\n  push:\n" not in migration_workflow.split("\nconcurrency:", 1)[0]
    assert "\n  check-production-drift:\n" in migration_workflow
    assert "\n  workflow_dispatch:\n" in deploy_workflow
    assert "\n  push:\n" not in deploy_workflow.split("\nconcurrency:", 1)[0]
