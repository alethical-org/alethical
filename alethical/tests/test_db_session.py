from __future__ import annotations

import pytest

from alethical.db.session import (
    database_url_for_target,
    supabase_database_url,
)

# Env vars supabase_database_url() reads directly. Tests must control all of
# them so a developer's local .env (loaded at import time by load_dotenv_if_present)
# doesn't leak into assertions.
SUPABASE_ENV_KEYS = (
    "SUPABASE_PROJECT_URL",
    "SUPABASE_DB_PASSWORD",
    "SUPABASE_PROJECT_REF",
    "SUPABASE_POOLER_HOST",
)


@pytest.fixture(autouse=True)
def isolated_supabase_env(monkeypatch: pytest.MonkeyPatch) -> None:
    for key in SUPABASE_ENV_KEYS:
        monkeypatch.delenv(key, raising=False)


def test_returns_none_when_project_url_missing(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("SUPABASE_DB_PASSWORD", "hunter2")
    assert supabase_database_url() is None


def test_returns_none_when_password_missing(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("SUPABASE_PROJECT_URL", "https://abcdefghij.supabase.co")
    assert supabase_database_url() is None


def test_uses_pooler_host_port_and_user_from_project_url(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("SUPABASE_PROJECT_URL", "https://abcdefghij.supabase.co")
    monkeypatch.setenv("SUPABASE_DB_PASSWORD", "hunter2")

    url = supabase_database_url()
    assert url == (
        "postgresql+psycopg://postgres.abcdefghij:hunter2"
        "@aws-1-us-east-2.pooler.supabase.com:6543/postgres?sslmode=require"
    )


def test_project_ref_env_overrides_url_parsing(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("SUPABASE_PROJECT_URL", "https://abcdefghij.supabase.co")
    monkeypatch.setenv("SUPABASE_DB_PASSWORD", "hunter2")
    monkeypatch.setenv("SUPABASE_PROJECT_REF", "explicit-ref-123")

    url = supabase_database_url()
    assert url is not None
    assert "postgres.explicit-ref-123:hunter2@" in url


def test_pooler_host_env_overrides_default(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("SUPABASE_PROJECT_URL", "https://abcdefghij.supabase.co")
    monkeypatch.setenv("SUPABASE_DB_PASSWORD", "hunter2")
    monkeypatch.setenv("SUPABASE_POOLER_HOST", "aws-0-eu-central-1.pooler.supabase.com")

    url = supabase_database_url()
    assert url is not None
    assert "@aws-0-eu-central-1.pooler.supabase.com:6543/postgres" in url


def test_password_with_url_special_chars_is_percent_encoded(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    # Supabase-generated passwords routinely contain @, :, /, #, etc.
    monkeypatch.setenv("SUPABASE_PROJECT_URL", "https://abcdefghij.supabase.co")
    monkeypatch.setenv("SUPABASE_DB_PASSWORD", "p@ss:wo/rd#")

    url = supabase_database_url()
    assert url is not None
    # SQLAlchemy's URL.create percent-encodes the password so the DSN stays valid.
    assert "p%40ss%3Awo%2Frd%23" in url
    # And the raw password never appears verbatim.
    assert "p@ss:wo/rd#" not in url


def test_database_url_for_target_production_uses_pooler_dsn(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("SUPABASE_PROJECT_URL", "https://abcdefghij.supabase.co")
    monkeypatch.setenv("SUPABASE_DB_PASSWORD", "hunter2")

    url = database_url_for_target("production")
    assert url == (
        "postgresql+psycopg://postgres.abcdefghij:hunter2"
        "@aws-1-us-east-2.pooler.supabase.com:6543/postgres?sslmode=require"
    )


def test_database_url_for_target_production_raises_when_env_missing() -> None:
    # No SUPABASE_* env set (autouse fixture clears them).
    with pytest.raises(RuntimeError, match="SUPABASE_PROJECT_URL"):
        database_url_for_target("production")


def test_database_url_for_target_explicit_url_takes_precedence() -> None:
    # Even with production target, an explicit URL should win and not touch env.
    explicit = "postgresql+psycopg://user:pw@host:5432/db"
    assert database_url_for_target("production", explicit_url=explicit) == explicit
