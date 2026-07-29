from __future__ import annotations

import os
from urllib.parse import unquote, urlparse

import pytest
from conftest import assert_local_database

from alethical.db.session import (
    database_url_for_target,
    load_dotenv_if_present,
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
    assert url is not None

    # Assert the project-specific choices, not SQLAlchemy's exact rendering.
    parsed = urlparse(url)
    assert parsed.scheme == "postgresql+psycopg"
    assert parsed.hostname == "aws-1-us-east-2.pooler.supabase.com"
    assert parsed.port == 6543
    assert parsed.username == "postgres.abcdefghij"
    assert parsed.password == "hunter2"
    assert parsed.path == "/postgres"
    assert parsed.query == "sslmode=require"


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


def test_password_with_url_special_chars_yields_parseable_url(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    # Supabase-generated passwords routinely contain @, :, /, #, etc.
    # SQLAlchemy's URL.create percent-encodes them; we just need the URL to
    # round-trip through urlparse cleanly (proves validity without coupling to
    # SQLAlchemy's exact encoding choices).
    monkeypatch.setenv("SUPABASE_PROJECT_URL", "https://abcdefghij.supabase.co")
    monkeypatch.setenv("SUPABASE_DB_PASSWORD", "p@ss:wo/rd#")

    url = supabase_database_url()
    assert url is not None
    parsed = urlparse(url)
    assert unquote(parsed.password or "") == "p@ss:wo/rd#"
    assert parsed.hostname == "aws-1-us-east-2.pooler.supabase.com"


def test_database_url_for_target_production_uses_pooler_dsn(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("SUPABASE_PROJECT_URL", "https://abcdefghij.supabase.co")
    monkeypatch.setenv("SUPABASE_DB_PASSWORD", "hunter2")

    url = database_url_for_target("production")
    parsed = urlparse(url)
    assert parsed.scheme == "postgresql+psycopg"
    assert parsed.hostname == "aws-1-us-east-2.pooler.supabase.com"
    assert parsed.port == 6543
    assert parsed.username == "postgres.abcdefghij"
    assert parsed.path == "/postgres"
    assert parsed.query == "sslmode=require"


def test_database_url_for_target_production_raises_when_env_missing() -> None:
    # No SUPABASE_* env set (autouse fixture clears them).
    with pytest.raises(RuntimeError, match="SUPABASE_PROJECT_URL"):
        database_url_for_target("production")


def test_database_url_for_target_explicit_url_takes_precedence() -> None:
    # Even with production target, an explicit URL should win and not touch env.
    explicit = "postgresql+psycopg://user:pw@host:5432/db"
    assert database_url_for_target("production", explicit_url=explicit) == explicit


# The conftest guard that keeps this suite off production (#716). Covered here
# because a broken guard is invisible: the suite stays green either way, and the
# only symptom is the next fixture row landing in Supabase.
@pytest.mark.parametrize(
    "url",
    [
        "postgresql+psycopg://alethical:alethical@localhost:54329/alethical",
        "postgresql+psycopg://alethical:alethical@127.0.0.1:5432/alethical",
    ],
)
def test_local_database_guard_allows_local_hosts(url: str) -> None:
    assert_local_database(url)


def test_local_database_guard_rejects_remote_host() -> None:
    with pytest.raises(pytest.UsageError, match="pooler.supabase.com"):
        assert_local_database(
            "postgresql+psycopg://postgres.abcdefghij:hunter2"
            "@aws-1-us-east-2.pooler.supabase.com:6543/postgres"
        )


def test_local_database_guard_rejects_production_target() -> None:
    with pytest.raises(pytest.UsageError, match="ALETHICAL_DATABASE_TARGET"):
        assert_local_database(
            "postgresql+psycopg://alethical:alethical@localhost:54329/alethical",
            target="production",
        )


def test_dotenv_strips_inline_comment_but_keeps_quoted_hash(
    tmp_path, monkeypatch: pytest.MonkeyPatch
) -> None:
    # #231: .env.example ships comments after values, so `cp .env.example .env`
    # used to fold the comment into the value.
    (tmp_path / ".env").write_text(
        "ALETHICAL_TEST_TARGET=local          # local | production\n"
        'ALETHICAL_TEST_PASSWORD="p@ss #word"\n',
        encoding="utf-8",
    )
    monkeypatch.chdir(tmp_path)
    monkeypatch.delenv("ALETHICAL_TEST_TARGET", raising=False)
    monkeypatch.delenv("ALETHICAL_TEST_PASSWORD", raising=False)

    load_dotenv_if_present()
    try:
        assert os.environ["ALETHICAL_TEST_TARGET"] == "local"
        assert os.environ["ALETHICAL_TEST_PASSWORD"] == "p@ss #word"
    finally:
        # The loader writes straight to os.environ, which monkeypatch can't undo.
        os.environ.pop("ALETHICAL_TEST_TARGET", None)
        os.environ.pop("ALETHICAL_TEST_PASSWORD", None)
