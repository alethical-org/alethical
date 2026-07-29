from __future__ import annotations

import os
import subprocess
import sys
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.engine import make_url

from alethical.db.session import get_database_url

ROOT = Path(__file__).resolve().parents[2]
# Resolve the URL the same way the app does, so the guard below checks the
# database the tests will actually write to -- get_database_url() also applies
# .env and normalizes the driver prefix, which reading os.environ here did not.
DATABASE_URL = get_database_url()

LOCAL_DATABASE_HOSTS = frozenset({"localhost", "127.0.0.1", "::1"})


def assert_local_database(url: str, target: str | None = None) -> None:
    """Refuse to run the suite against anything but a local Postgres.

    Roughly 50 call sites in these tests commit(), and the ingestion write paths
    delete before they insert. Nothing used to check where those writes landed:
    a session that ran pytest with DATABASE_URL pointed at Supabase committed a
    fixture bill straight into production, where it stayed publicly reachable
    (#716). Fail fast instead, before any fixture opens a connection.
    """
    if target not in (None, "", "local"):
        raise pytest.UsageError(
            f"Refusing to run the test suite with ALETHICAL_DATABASE_TARGET={target!r}. "
            "The suite writes and deletes rows, so it may only run against a local "
            "database. Unset it (or set it to 'local') and re-run."
        )
    host = make_url(url).host
    if host not in LOCAL_DATABASE_HOSTS:
        raise pytest.UsageError(
            f"Refusing to run the test suite against database host {host!r}. "
            "The suite writes and deletes rows, so it may only run against a local "
            f"database ({', '.join(sorted(LOCAL_DATABASE_HOSTS))}). Point DATABASE_URL "
            "at the local Postgres (port 54329) and re-run."
        )


def pytest_configure(config: pytest.Config) -> None:
    assert_local_database(DATABASE_URL, os.environ.get("ALETHICAL_DATABASE_TARGET"))


@pytest.fixture(scope="session", autouse=True)
def seed_database() -> None:
    subprocess.run(
        [sys.executable, "-m", "alembic", "-c", "alembic.ini", "upgrade", "head"],
        cwd=ROOT,
        check=True,
        env={**os.environ, "DATABASE_URL": DATABASE_URL},
    )
    subprocess.run(
        [sys.executable, "scripts/load_sample_data.py"],
        cwd=ROOT,
        check=True,
        env={**os.environ, "DATABASE_URL": DATABASE_URL},
    )


@pytest.fixture()
def client(seed_database: None) -> TestClient:
    from alethical.api.main import create_app
    from alethical.api.auth import get_auth_service
    from alethical.api.services.auth import AuthenticatedPrincipal
    from alethical.api.services.representative_lookup import (
        DistrictMatch,
        GeocodedAddress,
        RepresentativeLookupResult,
        get_representative_lookup_service,
    )

    app = create_app()

    class FakeSupabaseAuthService:
        def authenticate(self, bearer_token: str) -> AuthenticatedPrincipal:
            if bearer_token != "test-supabase-token":
                raise ValueError("Invalid test token")
            return AuthenticatedPrincipal(
                provider="supabase",
                provider_subject="supabase-user-ada",
                email="ada@example.com",
                email_verified=True,
            )

    class FakeRepresentativeLookupService:
        def lookup(self, address_text: str) -> RepresentativeLookupResult:
            return self.lookup_coordinates(
                latitude=44.9551,
                longitude=-93.1022,
                requested_address=address_text,
                matched_address="75 REV DR MARTIN LUTHER KING JR BLVD, SAINT PAUL, MN, 55155",
            )

        def lookup_coordinates(
            self,
            *,
            latitude: float,
            longitude: float,
            requested_address: str | None = None,
            matched_address: str | None = None,
            state_code: str | None = "MN",
        ) -> RepresentativeLookupResult:
            return RepresentativeLookupResult(
                geocoded_address=GeocodedAddress(
                    requested_address=requested_address or f"{latitude}, {longitude}",
                    matched_address=matched_address or f"{latitude}, {longitude}",
                    latitude=latitude,
                    longitude=longitude,
                    state_code=state_code,
                ),
                house_district=DistrictMatch(chamber="house", district_code="51A"),
                senate_district=DistrictMatch(chamber="senate", district_code="35"),
            )

    app.dependency_overrides[get_auth_service] = lambda: FakeSupabaseAuthService()
    app.dependency_overrides[get_representative_lookup_service] = lambda: (
        FakeRepresentativeLookupService()
    )
    return TestClient(app)


@pytest.fixture()
def auth_headers() -> dict[str, str]:
    return {"Authorization": "Bearer test-supabase-token"}


TEST_INTERNAL_TOKEN = "test-internal-token"


@pytest.fixture(autouse=True)
def _internal_api_token(monkeypatch) -> None:
    # The internal API now fails closed when INTERNAL_API_TOKEN is unset (#97),
    # so tests must set it explicitly. internal_headers sends this same value.
    monkeypatch.setenv("INTERNAL_API_TOKEN", TEST_INTERNAL_TOKEN)


@pytest.fixture()
def internal_headers() -> dict[str, str]:
    return {"X-Internal-Token": TEST_INTERNAL_TOKEN}
