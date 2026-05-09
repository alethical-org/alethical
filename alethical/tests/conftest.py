from __future__ import annotations

import os
import subprocess
import sys
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

ROOT = Path(__file__).resolve().parents[2]
DATABASE_URL = os.environ.get(
    "DATABASE_URL", "postgresql+psycopg://alethical:alethical@localhost:54329/alethical"
)


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

    app.dependency_overrides[get_auth_service] = lambda: FakeSupabaseAuthService()
    return TestClient(app)


@pytest.fixture()
def auth_headers() -> dict[str, str]:
    return {"Authorization": "Bearer test-supabase-token"}


@pytest.fixture()
def internal_headers() -> dict[str, str]:
    return {"X-Internal-Token": "dev-internal-token"}
