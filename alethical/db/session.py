from __future__ import annotations

import os
from functools import lru_cache

from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker


def get_database_url() -> str:
    return os.environ.get(
        "DATABASE_URL", "postgresql+psycopg://alethical:alethical@localhost:54329/alethical"
    )


@lru_cache(maxsize=1)
def get_engine():
    return create_engine(get_database_url(), echo=False)


@lru_cache(maxsize=1)
def get_session_factory():
    return sessionmaker(bind=get_engine(), autoflush=False, autocommit=False, expire_on_commit=False)


def get_db():
    db: Session = get_session_factory()()
    try:
        yield db
    finally:
        db.close()
