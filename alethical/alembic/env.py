from __future__ import annotations

import os
from logging.config import fileConfig

from alembic import context
from alethical.db import models
from alethical.db.session import database_url_for_target
from sqlalchemy import engine_from_config, pool

config = context.config

if config.config_file_name is not None:
    fileConfig(config.config_file_name)

target_metadata = models.Base.metadata

# Resolve the connection URL the same way the app does, so migrations and the
# running service share one source of truth (#288). An explicit DATABASE_URL
# still wins (local dev, ad-hoc overrides); otherwise ALETHICAL_DATABASE_TARGET
# selects the target -- target=production builds the Supabase pooler URL from
# SUPABASE_PROJECT_URL + SUPABASE_DB_PASSWORD, so there is no separate copy of
# the DB password to drift out of date.
config.set_main_option(
    "sqlalchemy.url",
    database_url_for_target(
        os.environ.get("ALETHICAL_DATABASE_TARGET"),
        os.environ.get("DATABASE_URL"),
    ),
)


def run_migrations_offline() -> None:
    url = config.get_main_option("sqlalchemy.url")
    context.configure(
        url=url,
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
        compare_type=True,
        compare_server_default=True,
    )

    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online() -> None:
    connectable = engine_from_config(
        config.get_section(config.config_ini_section, {}),
        prefix="sqlalchemy.",
        poolclass=pool.NullPool,
    )

    with connectable.connect() as connection:
        context.configure(
            connection=connection,
            target_metadata=target_metadata,
            compare_type=True,
            compare_server_default=True,
        )

        with context.begin_transaction():
            context.run_migrations()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
