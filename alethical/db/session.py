from __future__ import annotations

import os
from functools import lru_cache
from pathlib import Path
from urllib.parse import urlparse

from sqlalchemy import URL, create_engine
from sqlalchemy.engine import make_url
from sqlalchemy.orm import Session, sessionmaker

# The production path connects through the Supabase pgbouncer pooler in
# transaction-pooling mode (port 6543), which multiplexes clients over shared
# backend connections. psycopg's automatic server-side prepared statements reuse
# names per logical connection, so under concurrency a name collides on a reused
# backend -> DuplicatePreparedStatement. `prepare_threshold=None` disables
# server-side prepared statements entirely; pass it as connect_args on every
# engine / pool that may reach the pooler. Harmless (a tiny per-query cost) on
# the direct/local path.
NO_PREPARED_STATEMENTS = {"prepare_threshold": None}


def _parse_dotenv_value(value: str) -> str:
    """Read one .env value: quoted verbatim, unquoted up to a trailing comment.

    .env.example ships comments after values, so `cp .env.example .env` used to
    hand back the comment as part of the value -- ALETHICAL_DATABASE_TARGET came
    out as "local          # local | production", which made every script that
    resolves a target refuse to run, and INTERNAL_API_TOKEN came out mangled the
    same way and failed the internal-token tests (#231). Quoted values keep
    everything inside the quotes, so a password containing '#' still survives.
    """
    value = value.strip()
    if value[:1] in {'"', "'"}:
        closing = value.find(value[0], 1)
        if closing != -1:
            return value[1:closing]
        return value
    return value.split(" #", 1)[0].split("\t#", 1)[0].strip()


def load_dotenv_if_present() -> None:
    for parent in (Path.cwd(), *Path.cwd().parents):
        env_path = parent / ".env"
        if not env_path.exists():
            continue
        for raw_line in env_path.read_text(encoding="utf-8").splitlines():
            line = raw_line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, value = line.split("=", 1)
            key = key.strip()
            value = _parse_dotenv_value(value)
            if key and key not in os.environ:
                os.environ[key] = value
        return


load_dotenv_if_present()


def normalize_database_url(url: str) -> str:
    if url.startswith("postgresql+"):
        return url
    if url.startswith("postgres://"):
        return "postgresql+psycopg://" + url.removeprefix("postgres://")
    if url.startswith("postgresql://"):
        return "postgresql+psycopg://" + url.removeprefix("postgresql://")
    return url


DEFAULT_LOCAL_DATABASE_URL = (
    "postgresql+psycopg://alethical:alethical@localhost:54329/alethical"
)

# Hosts that mean "the database on this machine". ``db`` is the local Postgres
# service name in docker-compose.yml.
_LOCAL_DATABASE_HOSTS = frozenset({"localhost", "127.0.0.1", "::1", "db", ""})


def local_database_url() -> str:
    """Resolve ``DATABASE_URL`` with **no** target check.

    For the callers that specifically want the machine-local database *while*
    ``ALETHICAL_DATABASE_TARGET=production`` is set, which is a real and correct
    combination: ``scripts/check_schema_drift.py --against-production`` builds
    throwaway local databases to compare production against, and
    ``scripts/backfill_rag_bulk.py --source-target local`` reads local and writes
    production. Both have already established which database they mean, so the
    guard in ``get_database_url`` would only second-guess them.

    If you are reaching for this to read data, you almost certainly want
    ``database_url_for_target`` instead."""
    return normalize_database_url(
        os.environ.get("DATABASE_URL", DEFAULT_LOCAL_DATABASE_URL)
    )


def _refuse_local_url_when_target_is_production(url: str) -> None:
    """Stop a command that asked for production quietly reading the local DB.

    ``ALETHICAL_DATABASE_TARGET`` is read by ``database_url_for_target`` and by
    nothing else -- in particular **not** by ``get_database_url`` or
    ``get_engine``. So ``ALETHICAL_DATABASE_TARGET=production python -c "...
    get_engine() ..."`` used to connect to local Postgres with no error and no
    warning (#1090).

    Two properties made that expensive rather than merely wrong. It **fails
    toward plausibility**: a connection error is caught in seconds, whereas
    fixture data that resembles production cannot be spotted from the output at
    all. And the wrongness **compounds** -- on 6 Aug 2026 a row count read this
    way became "an account was deleted", became "probably the test account",
    became doubt cast on an unrelated issue, and reached Eugene before anyone
    caught it. Production had *more* accounts, not fewer.

    Deliberately a refusal, not a redirect. Making ``get_engine`` honour the
    variable would silently change which database existing scripts connect to,
    which is a far larger and riskier change than making the mismatch loud.

    Deliberately narrow, too: it fires only when the resolved URL is *local*.
    A deployed container whose ``DATABASE_URL`` points at any remote passes
    untouched, so this can never take production down -- which matters, because
    the compose production path exports ``DATABASE_URL`` itself and Railway's
    environment is not described in this repository.
    """
    target = os.environ.get("ALETHICAL_DATABASE_TARGET", "").strip()
    if target in {"", "local"}:
        return
    host = (make_url(url).host or "").lower()
    if host not in _LOCAL_DATABASE_HOSTS:
        return
    raise RuntimeError(
        f"ALETHICAL_DATABASE_TARGET={target} but the resolved database is local "
        f"(host {host!r}). ALETHICAL_DATABASE_TARGET is read only by "
        "database_url_for_target(); get_database_url() and get_engine() ignore it "
        "and fall back to local Postgres. Either build the engine explicitly with "
        'create_engine(database_url_for_target("production")), or set DATABASE_URL '
        "to the production URL. Refusing rather than guessing, because the local "
        "database returns believable numbers (#1090)."
    )


def get_database_url() -> str:
    url = local_database_url()
    _refuse_local_url_when_target_is_production(url)
    return url


def supabase_database_url() -> str | None:
    """Build a Supabase connection URL via the pgbouncer session pooler.

    The direct host (db.<ref>.supabase.co:5432) is IPv6-only and unreachable
    from many networks, including Railway's own containers. The pooler host
    (SUPABASE_POOLER_HOST, port 6543, user postgres.<ref>) is what actually
    works everywhere -- it's the same shape docker-compose.yml constructs for
    the backend service's ALETHICAL_DATABASE_TARGET=production path.
    """
    project_url = os.environ.get("SUPABASE_PROJECT_URL")
    password = os.environ.get("SUPABASE_DB_PASSWORD")
    if not project_url or not password:
        return None
    project_ref = os.environ.get("SUPABASE_PROJECT_REF") or _project_ref_from_url(
        project_url
    )
    pooler_host = os.environ.get(
        "SUPABASE_POOLER_HOST", "aws-1-us-east-2.pooler.supabase.com"
    )
    return URL.create(
        "postgresql+psycopg",
        username=f"postgres.{project_ref}",
        password=password,
        host=pooler_host,
        port=6543,
        database="postgres",
        query={"sslmode": "require"},
    ).render_as_string(hide_password=False)


def _project_ref_from_url(project_url: str) -> str:
    """Extract the Supabase project ref (first subdomain label) from its URL."""
    hostname = urlparse(project_url).hostname
    if not hostname:
        raise ValueError(
            f"Could not parse hostname from SUPABASE_PROJECT_URL: {project_url!r}"
        )
    return hostname.split(".")[0]


def database_url_for_target(target: str | None, explicit_url: str | None = None) -> str:
    if explicit_url:
        return normalize_database_url(explicit_url)
    if target in {None, "", "local"}:
        # The unguarded resolution: a caller naming "local" outright has already
        # said which database it means, so the ambient-target check below would
        # only second-guess an explicit choice.
        return local_database_url()
    if target == "production":
        url = supabase_database_url()
        if not url:
            raise RuntimeError(
                "SUPABASE_PROJECT_URL and SUPABASE_DB_PASSWORD are required for target=production"
            )
        return url
    raise RuntimeError(f"Unknown database target: {target}")


@lru_cache(maxsize=1)
def get_engine():
    return create_engine(
        get_database_url(),
        echo=False,
        pool_pre_ping=True,
        connect_args=NO_PREPARED_STATEMENTS,
    )


@lru_cache(maxsize=1)
def get_session_factory():
    return sessionmaker(
        bind=get_engine(), autoflush=False, autocommit=False, expire_on_commit=False
    )


def get_db():
    db: Session = get_session_factory()()
    try:
        yield db
    finally:
        db.close()
