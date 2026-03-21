#!/usr/bin/env python3
from __future__ import annotations

import os
from pathlib import Path
import sys

from alembic import command
from alembic.config import Config

ROOT = Path(__file__).resolve().parents[1]
ALEMBIC_INI = ROOT / "alembic.ini"
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from alethical.db.session import normalize_database_url


def main() -> None:
    database_url = normalize_database_url(
        os.environ.get(
            "DATABASE_URL", "postgresql+psycopg://alethical:alethical@localhost:54329/alethical"
        )
    )
    config = Config(str(ALEMBIC_INI))
    config.set_main_option("sqlalchemy.url", database_url)
    command.upgrade(config, "head")
    print("migrated_to", "head")


if __name__ == "__main__":
    main()
