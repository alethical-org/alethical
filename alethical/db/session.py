from __future__ import annotations

import os
from functools import lru_cache
from pathlib import Path
from urllib.parse import urlparse

from sqlalchemy import URL, create_engine
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
            value = value.strip().strip("\"'")
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


def get_database_url() -> str:
    return normalize_database_url(
        os.environ.get(
            "DATABASE_URL",
            "postgresql+psycopg://alethical:alethical@localhost:54329/alethical",
        )
    )


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
        return get_database_url()
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
