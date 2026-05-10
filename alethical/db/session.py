from __future__ import annotations

import os
import re
from functools import lru_cache
from pathlib import Path

from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker


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
            "DATABASE_URL", "postgresql+psycopg://alethical:alethical@localhost:54329/alethical"
        )
    )


def supabase_database_url() -> str | None:
    project_url = os.environ.get("SUPABASE_PROJECT_URL")
    password = os.environ.get("SUPABASE_DB_PASSWORD")
    if not project_url or not password:
        return None
    project_ref = re.sub(r"^https?://([^.]+).*$", r"\1", project_url)
    return normalize_database_url(
        f"postgresql://postgres:{password}@db.{project_ref}.supabase.co:5432/postgres?sslmode=require"
    )


def database_url_for_target(target: str | None, explicit_url: str | None = None) -> str:
    if explicit_url:
        return normalize_database_url(explicit_url)
    if target in {None, "", "local"}:
        return get_database_url()
    if target == "production":
        url = supabase_database_url()
        if not url:
            raise RuntimeError("SUPABASE_PROJECT_URL and SUPABASE_DB_PASSWORD are required for target=production")
        return url
    raise RuntimeError(f"Unknown database target: {target}")


@lru_cache(maxsize=1)
def get_engine():
    return create_engine(get_database_url(), echo=False, pool_pre_ping=True)


@lru_cache(maxsize=1)
def get_session_factory():
    return sessionmaker(bind=get_engine(), autoflush=False, autocommit=False, expire_on_commit=False)


def get_db():
    db: Session = get_session_factory()()
    try:
        yield db
    finally:
        db.close()
