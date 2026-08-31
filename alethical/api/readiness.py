from __future__ import annotations

from functools import lru_cache
from pathlib import Path

from alembic.config import Config
from alembic.script import ScriptDirectory
from sqlalchemy import text
from sqlalchemy.engine import Engine
from sqlalchemy.exc import SQLAlchemyError

from alethical.db.session import get_engine


@lru_cache(maxsize=1)
def expected_schema_head() -> str:
    config_path = Path(__file__).resolve().parents[2] / "alembic.ini"
    config = Config(str(config_path))
    config.set_main_option("path_separator", "os")
    head = ScriptDirectory.from_config(config).get_current_head()
    if head is None:
        raise RuntimeError("The migration tree has no current head")
    return head


def database_schema_is_ready(
    engine: Engine | None = None, expected_head: str | None = None
) -> bool:
    try:
        required_head = expected_head or expected_schema_head()
        with (engine or get_engine()).connect() as connection:
            installed_heads = (
                connection.execute(text("SELECT version_num FROM alembic_version"))
                .scalars()
                .all()
            )
    except (OSError, RuntimeError, SQLAlchemyError, ValueError):
        return False

    return installed_heads == [required_head]
