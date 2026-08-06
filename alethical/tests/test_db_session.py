from __future__ import annotations

import os
from urllib.parse import unquote, urlparse

import pytest

from alethical.db.session import (
    DEFAULT_LOCAL_DATABASE_URL,
    database_url_for_target,
    get_database_url,
    load_dotenv_if_present,
    local_database_url,
    supabase_database_url,
)
from alethical.tests.local_database_guard import assert_local_database

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


# --- The silent wrong-database read (#1090) ---------------------------------
#
# ALETHICAL_DATABASE_TARGET is read by database_url_for_target() and by nothing
# else. get_database_url() and get_engine() ignore it, so a command that set it
# and reached for either used to connect to local Postgres with no error and no
# warning. These pin the guard that now refuses.


def test_asking_for_production_and_getting_local_refuses_instead_of_connecting(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """The exact shape of the 6 Aug 2026 incident, created on purpose.

    Nobody makes this state deliberately, which is precisely why it needs a test
    that does. The old behaviour returned a local URL here and the caller went on
    to print believable numbers.
    """
    monkeypatch.setenv("ALETHICAL_DATABASE_TARGET", "production")
    monkeypatch.delenv("DATABASE_URL", raising=False)

    with pytest.raises(RuntimeError) as excinfo:
        get_database_url()

    message = str(excinfo.value)
    assert "ALETHICAL_DATABASE_TARGET=production" in message
    assert "localhost" in message, "the message must name the host actually resolved"
    assert "database_url_for_target" in message, (
        "the message must carry the correct call, not send the reader hunting "
        "through two functions to work out which one reads which variable"
    )


def test_the_guard_reads_the_resolved_url_not_just_the_default(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """An explicit DATABASE_URL pointing at local is the same mistake."""
    monkeypatch.setenv("ALETHICAL_DATABASE_TARGET", "production")
    monkeypatch.setenv(
        "DATABASE_URL",
        "postgresql+psycopg://alethical:alethical@127.0.0.1:54329/alethical",
    )

    with pytest.raises(RuntimeError, match="127.0.0.1"):
        get_database_url()


def test_a_remote_database_url_passes_so_a_deployed_container_cannot_be_broken(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """The guard must never fire on a real deployment.

    docker-compose's production path exports DATABASE_URL to the pooler itself,
    and Railway's environment is not described in this repository. So the check
    is narrow on purpose: local-while-claiming-production only. Anything remote
    passes untouched.
    """
    monkeypatch.setenv("ALETHICAL_DATABASE_TARGET", "production")
    remote = (
        "postgresql+psycopg://postgres.abcdefghij:pw"
        "@aws-1-us-east-2.pooler.supabase.com:6543/postgres?sslmode=require"
    )
    monkeypatch.setenv("DATABASE_URL", remote)

    assert get_database_url() == remote


@pytest.mark.parametrize("target", ["", "local"])
def test_local_development_is_untouched_and_stays_quiet(
    monkeypatch: pytest.MonkeyPatch, target: str
) -> None:
    """The common case must not get noisier -- no raise, no warning."""
    monkeypatch.setenv("ALETHICAL_DATABASE_TARGET", target)
    monkeypatch.delenv("DATABASE_URL", raising=False)

    assert get_database_url() == DEFAULT_LOCAL_DATABASE_URL


def test_no_target_set_at_all_is_untouched(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("ALETHICAL_DATABASE_TARGET", raising=False)
    monkeypatch.delenv("DATABASE_URL", raising=False)

    assert get_database_url() == DEFAULT_LOCAL_DATABASE_URL


def test_naming_local_outright_beats_an_ambient_production_target(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """An explicit argument is a decision; the environment variable is ambient.

    ``database_url_for_target("local")`` says which database it means, so the
    guard would only be second-guessing a caller who has already been explicit.
    """
    monkeypatch.setenv("ALETHICAL_DATABASE_TARGET", "production")
    monkeypatch.delenv("DATABASE_URL", raising=False)

    assert database_url_for_target("local") == DEFAULT_LOCAL_DATABASE_URL


def test_the_deliberate_local_callers_are_not_caught_by_the_guard(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Two real callers want local *while* the target says production (#1090).

    ``scripts/check_schema_drift.py --against-production`` is documented as being
    run with ``ALETHICAL_DATABASE_TARGET=production`` and still needs the local
    server, to build the throwaway databases it compares production against.
    ``scripts/backfill_rag_bulk.py --source-target local`` reads local and writes
    production. A guard that caught them would have broken a documented ops
    command, which is why ``local_database_url`` exists as its own name rather
    than the guard having an exception in it.
    """
    monkeypatch.setenv("ALETHICAL_DATABASE_TARGET", "production")
    monkeypatch.delenv("DATABASE_URL", raising=False)

    assert local_database_url() == DEFAULT_LOCAL_DATABASE_URL
    with pytest.raises(RuntimeError):
        get_database_url()
