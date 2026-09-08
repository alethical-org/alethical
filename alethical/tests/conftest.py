from __future__ import annotations

import os
import subprocess
import sys
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.engine import make_url

from alethical.db.session import get_engine
from alethical.tests.database_session import configure_database
from alethical.tests.empty_data_tables import empty_data_tables

ROOT = Path(__file__).resolve().parents[2]
# pytest_configure chooses and exports the verified URL before test modules
# import application engines. No test fixture connects to the shared dev server.
DATABASE_URL: str

# Two signed-in people, not one, so tests can prove that one account never sees
# the other's rows (#13). The real Supabase service hands back a distinct
# provider_subject per account; these stand in for two of them. Keyed by the
# bearer token a test sends, because that is all the fake has to go on.
FAKE_AUTH_USERS: dict[str, dict[str, str]] = {
    "test-supabase-token": {
        "provider_subject": "supabase-user-ada",
        "email": "ada@example.com",
    },
    "test-supabase-token-grace": {
        "provider_subject": "supabase-user-grace",
        "email": "grace@example.com",
    },
}


def _run(command: list[str]) -> subprocess.CompletedProcess:
    return subprocess.run(
        command,
        cwd=ROOT,
        check=False,
        capture_output=True,
        text=True,
        env={**os.environ, "DATABASE_URL": DATABASE_URL},
    )


def pytest_configure(config: pytest.Config) -> None:
    global DATABASE_URL
    DATABASE_URL = configure_database(config, ROOT)


@pytest.fixture(scope="session", autouse=True)
def seed_database() -> None:
    if get_engine().url != make_url(DATABASE_URL):
        raise pytest.UsageError(
            "The application connection does not match this run's test database. "
            "Refusing to migrate or seed; run `uv run pytest` in a fresh process."
        )
    migrate = [sys.executable, "-m", "alembic", "-c", "alembic.ini", "upgrade", "head"]
    result = _run(migrate)
    if result.returncode != 0:
        raise RuntimeError(f"alembic upgrade head failed:\n{result.stderr}")
    # Before seeding, never after: the seeder is idempotent per row but cannot
    # remove rows it did not create, so without this every run inherited whatever
    # the last one committed and never cleaned up (#1490 -- full account in
    # alethical/tests/empty_data_tables.py).
    empty_data_tables(DATABASE_URL)
    seed = _run([sys.executable, "scripts/load_sample_data.py"])
    if seed.returncode != 0:
        raise RuntimeError(f"load_sample_data.py failed:\n{seed.stderr}")


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
            claims = FAKE_AUTH_USERS.get(bearer_token)
            if claims is None:
                raise ValueError("Invalid test token")
            return AuthenticatedPrincipal(
                provider="supabase",
                provider_subject=claims["provider_subject"],
                email=claims["email"],
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
                congressional_district="4",
            )

    app.dependency_overrides[get_auth_service] = lambda: FakeSupabaseAuthService()
    app.dependency_overrides[get_representative_lookup_service] = lambda: (
        FakeRepresentativeLookupService()
    )
    return TestClient(app)


@pytest.fixture()
def auth_headers() -> dict[str, str]:
    return {"Authorization": "Bearer test-supabase-token"}


@pytest.fixture()
def second_auth_headers() -> dict[str, str]:
    """A second, unrelated signed-in person -- the other half of every isolation
    test (#13). Same `client` fixture, different bearer token, so both users go
    through the one app instance exactly as two browsers would."""
    return {"Authorization": "Bearer test-supabase-token-grace"}


TEST_INTERNAL_TOKEN = "test-internal-token"


@pytest.fixture(autouse=True)
def _internal_api_token(monkeypatch) -> None:
    # The internal API now fails closed when INTERNAL_API_TOKEN is unset (#97),
    # so tests must set it explicitly. internal_headers sends this same value.
    monkeypatch.setenv("INTERNAL_API_TOKEN", TEST_INTERNAL_TOKEN)


@pytest.fixture()
def internal_headers() -> dict[str, str]:
    return {"X-Internal-Token": TEST_INTERNAL_TOKEN}
