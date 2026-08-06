from __future__ import annotations

import os
import subprocess
import sys
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, text
from sqlalchemy.engine import make_url

from alethical.db.session import get_database_url
from alethical.tests.database_name import (
    abandoned_test_databases,
    worktree_database_url,
)
from alethical.tests.local_database_guard import assert_local_database

ROOT = Path(__file__).resolve().parents[2]
# Resolve the URL the same way the app does, so the guard below checks the
# database the tests will actually write to -- get_database_url() also applies
# .env and normalizes the driver prefix, which reading os.environ here did not.
#
# Then give this worktree its own database on the shared local dev Postgres
# (#898, #840). The fixture below migrates and re-seeds whatever this points at,
# so a name shared across worktrees meant two sessions running at once wiped each
# other's tables, and a branch with its own migration left an alembic_version
# stamp no other branch could resolve. CI is untouched: it pins DATABASE_URL to
# port 5432 and only 54329 is split.
DATABASE_URL = worktree_database_url(
    get_database_url(), ROOT, override=os.environ.get("ALETHICAL_TEST_DATABASE_URL")
)
# Export it, so *everything* agrees on which database this run uses -- not just
# the migration and the seeder below.
#
# This line is the fix. Without it the split is cosmetic: `get_engine()`,
# `get_session_factory()` and the several test modules that call
# `get_database_url()` directly all re-resolve from the environment, so they
# would have carried on sharing one database while a freshly-migrated per-worktree
# one sat unused beside them. Two concurrent runs proved it -- separate databases
# existed and the suites still corrupted each other.
#
# Safe at import time because conftest is imported before any test module, and
# `get_engine()` is lru_cached on first *call*, which has not happened yet.
os.environ["DATABASE_URL"] = DATABASE_URL

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


def _server_connection(url: str):
    """A connection to the server's own `postgres` database, outside any transaction.

    CREATE DATABASE and DROP DATABASE cannot run inside one, and they cannot run
    from inside the database being created or dropped.
    """
    server = make_url(url).set(database="postgres")
    return create_engine(server, isolation_level="AUTOCOMMIT").connect()


def _live_worktree_paths() -> list[str]:
    listing = subprocess.run(
        ["git", "worktree", "list", "--porcelain"],
        cwd=ROOT,
        capture_output=True,
        text=True,
        check=False,
    )
    if listing.returncode != 0:
        # Not a git checkout, or git is unhappy. Pruning is housekeeping, so the
        # safe answer is to prune nothing rather than to guess a worktree is gone.
        return []
    return [
        line.removeprefix("worktree ").strip()
        for line in listing.stdout.splitlines()
        if line.startswith("worktree ")
    ]


def _prune_abandoned_databases(connection) -> None:
    """Drop test databases whose worktree no longer exists.

    At the start of a run rather than the end of one. Dropping at the end would
    make every single run pay a migrate-from-empty and a full re-seed; this costs
    one query and keeps the local Postgres from accumulating (#898).

    Only ever a database in this mechanism's own namespace whose worktree is
    gone, so a live session's database can never be a candidate -- dropping one
    of those would be the exact collision this change exists to prevent.
    """
    live = _live_worktree_paths()
    if not live:
        return
    existing = [
        row[0] for row in connection.execute(text("SELECT datname FROM pg_database"))
    ]
    for name in abandoned_test_databases(existing, live):
        # Best effort: another process may hold a connection, and housekeeping
        # must never be the reason a suite fails to start.
        connection.exec_driver_sql(f'DROP DATABASE IF EXISTS "{name}" WITH (FORCE)')


def _ensure_database_exists() -> None:
    name = make_url(DATABASE_URL).database
    with _server_connection(DATABASE_URL) as connection:
        _prune_abandoned_databases(connection)
        exists = connection.execute(
            text("SELECT 1 FROM pg_database WHERE datname = :name"), {"name": name}
        ).scalar()
        if not exists:
            connection.exec_driver_sql(f'CREATE DATABASE "{name}"')


def _reset_database() -> None:
    """Drop and recreate, for a database left stamped with a revision that is gone.

    Rebasing onto a `main` that never had your migration, or switching branches
    inside one worktree, leaves `alembic_version` naming a revision the current
    tree cannot locate, and `upgrade head` then dies. Self-healing beats the
    manual `psql` that used to be the only way out (#840).
    """
    name = make_url(DATABASE_URL).database
    with _server_connection(DATABASE_URL) as connection:
        connection.exec_driver_sql(f'DROP DATABASE IF EXISTS "{name}" WITH (FORCE)')
        connection.exec_driver_sql(f'CREATE DATABASE "{name}"')


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
    assert_local_database(DATABASE_URL, os.environ.get("ALETHICAL_DATABASE_TARGET"))


@pytest.fixture(scope="session", autouse=True)
def seed_database() -> None:
    _ensure_database_exists()
    migrate = [sys.executable, "-m", "alembic", "-c", "alembic.ini", "upgrade", "head"]
    result = _run(migrate)
    if result.returncode != 0:
        if "Can't locate revision" not in result.stderr:
            raise RuntimeError(f"alembic upgrade head failed:\n{result.stderr}")
        _reset_database()
        result = _run(migrate)
        if result.returncode != 0:
            raise RuntimeError(
                f"alembic upgrade head failed after a reset:\n{result.stderr}"
            )
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
