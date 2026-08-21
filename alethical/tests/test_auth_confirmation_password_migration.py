"""The email-confirmation guard removes only an unproved password (#1734)."""

from __future__ import annotations

import os
import subprocess
import sys
import uuid
from datetime import datetime, timezone
from pathlib import Path

import sqlalchemy as sa

from scripts.check_schema_drift import ScratchDatabase, _local_base_url

ROOT = Path(__file__).resolve().parents[2]
PARENT_REVISION = "0040_cf_name_indexes"
TARGET_REVISION = "0041_confirmation_password_guard"
FUNCTION_NAME = "alethical_clear_unproved_password_on_confirmation"
TRIGGER_NAME = "alethical_clear_unproved_password_on_confirmation"


def _migrate(url: sa.URL, direction: str, revision: str) -> None:
    env = {
        **os.environ,
        "DATABASE_URL": url.render_as_string(hide_password=False),
    }
    env.pop("ALETHICAL_DATABASE_TARGET", None)
    result = subprocess.run(
        [sys.executable, "-m", "alembic", "-c", "alembic.ini", direction, revision],
        cwd=ROOT,
        env=env,
        capture_output=True,
        text=True,
        check=False,
    )
    assert result.returncode == 0, result.stdout + result.stderr


def _create_supabase_users_table(engine: sa.Engine) -> None:
    with engine.begin() as connection:
        connection.execute(sa.text("CREATE SCHEMA auth"))
        connection.execute(
            sa.text(
                """
                CREATE TABLE auth.users (
                    id uuid PRIMARY KEY,
                    email_confirmed_at timestamptz,
                    encrypted_password text,
                    updated_at timestamptz
                )
                """
            )
        )


def _insert_user(
    engine: sa.Engine,
    *,
    confirmed_at: datetime | None = None,
    password: str = "planted-password-hash",
) -> uuid.UUID:
    user_id = uuid.uuid4()
    with engine.begin() as connection:
        connection.execute(
            sa.text(
                """
                INSERT INTO auth.users
                    (id, email_confirmed_at, encrypted_password, updated_at)
                VALUES
                    (:id, :confirmed_at, :password, now())
                """
            ),
            {"id": user_id, "confirmed_at": confirmed_at, "password": password},
        )
    return user_id


def _password(engine: sa.Engine, user_id: uuid.UUID) -> str | None:
    with engine.connect() as connection:
        return connection.execute(
            sa.text("SELECT encrypted_password FROM auth.users WHERE id = :id"),
            {"id": user_id},
        ).scalar_one()


def _confirm(engine: sa.Engine, user_id: uuid.UUID) -> None:
    with engine.begin() as connection:
        connection.execute(
            sa.text(
                """
                UPDATE auth.users
                SET email_confirmed_at = :confirmed_at,
                    updated_at = :confirmed_at
                WHERE id = :id
                """
            ),
            {"id": user_id, "confirmed_at": datetime.now(timezone.utc)},
        )


def test_confirmation_clears_only_the_unproved_password() -> None:
    with ScratchDatabase(_local_base_url(), "confirmation_password_guard") as scratch:
        _migrate(scratch.url, "upgrade", PARENT_REVISION)
        engine = scratch.engine()
        try:
            _create_supabase_users_table(engine)
            unconfirmed = _insert_user(engine)
            already_confirmed = _insert_user(
                engine,
                confirmed_at=datetime(2026, 1, 2, tzinfo=timezone.utc),
                password="confirmed-password-hash",
            )
            unrelated_update = _insert_user(engine, password="untouched-password-hash")

            _migrate(scratch.url, "upgrade", TARGET_REVISION)
            _confirm(engine, unconfirmed)
            with engine.begin() as connection:
                connection.execute(
                    sa.text(
                        """
                        UPDATE auth.users
                        SET email_confirmed_at = :confirmed_at
                        WHERE id = :id
                        """
                    ),
                    {
                        "id": already_confirmed,
                        "confirmed_at": datetime(2026, 2, 3, tzinfo=timezone.utc),
                    },
                )
                connection.execute(
                    sa.text("UPDATE auth.users SET updated_at = now() WHERE id = :id"),
                    {"id": unrelated_update},
                )

            assert _password(engine, unconfirmed) is None
            assert _password(engine, already_confirmed) == "confirmed-password-hash"
            assert _password(engine, unrelated_update) == "untouched-password-hash"

            with engine.begin() as connection:
                connection.execute(
                    sa.text(
                        """
                        UPDATE auth.users
                        SET encrypted_password = :password
                        WHERE id = :id
                        """
                    ),
                    {"id": unconfirmed, "password": "owner-chosen-password-hash"},
                )
            assert _password(engine, unconfirmed) == "owner-chosen-password-hash"
        finally:
            engine.dispose()


def test_confirmation_guard_round_trips() -> None:
    with ScratchDatabase(
        _local_base_url(), "confirmation_password_round_trip"
    ) as scratch:
        _migrate(scratch.url, "upgrade", PARENT_REVISION)
        engine = scratch.engine()
        try:
            _create_supabase_users_table(engine)
            _migrate(scratch.url, "upgrade", TARGET_REVISION)

            with engine.connect() as connection:
                trigger_count = connection.execute(
                    sa.text(
                        """
                        SELECT count(*)
                        FROM pg_trigger
                        WHERE tgname = :name AND NOT tgisinternal
                        """
                    ),
                    {"name": TRIGGER_NAME},
                ).scalar_one()
                function_settings = connection.execute(
                    sa.text(
                        """
                        SELECT prosecdef, proconfig
                        FROM pg_proc
                        WHERE oid = to_regprocedure(:signature)
                        """
                    ),
                    {"signature": f"public.{FUNCTION_NAME}()"},
                ).one()
                public_can_execute = connection.execute(
                    sa.text(
                        """
                        SELECT EXISTS (
                            SELECT 1
                            FROM pg_proc AS function
                            CROSS JOIN LATERAL aclexplode(
                                COALESCE(
                                    function.proacl,
                                    acldefault('f', function.proowner)
                                )
                            ) AS privilege
                            WHERE function.oid = to_regprocedure(:signature)
                              AND privilege.grantee = 0
                              AND privilege.privilege_type = 'EXECUTE'
                        )
                        """
                    ),
                    {"signature": f"public.{FUNCTION_NAME}()"},
                ).scalar_one()
            assert trigger_count == 1
            assert function_settings.prosecdef is False
            assert function_settings.proconfig == ['search_path=""']
            assert public_can_execute is False

            _migrate(scratch.url, "downgrade", PARENT_REVISION)
            with engine.connect() as connection:
                trigger_count = connection.execute(
                    sa.text(
                        """
                        SELECT count(*)
                        FROM pg_trigger
                        WHERE tgname = :name AND NOT tgisinternal
                        """
                    ),
                    {"name": TRIGGER_NAME},
                ).scalar_one()
                function_after_downgrade = connection.execute(
                    sa.text("SELECT to_regprocedure(:signature)"),
                    {"signature": f"public.{FUNCTION_NAME}()"},
                ).scalar_one()
            assert trigger_count == 0
            assert function_after_downgrade is None

            without_guard = _insert_user(engine, password="preserved-after-downgrade")
            _confirm(engine, without_guard)
            assert _password(engine, without_guard) == "preserved-after-downgrade"

            _migrate(scratch.url, "upgrade", TARGET_REVISION)
            with_guard_again = _insert_user(engine, password="cleared-after-reupgrade")
            _confirm(engine, with_guard_again)
            assert _password(engine, with_guard_again) is None
        finally:
            engine.dispose()


def test_migration_skips_databases_without_supabase_users() -> None:
    with ScratchDatabase(_local_base_url(), "confirmation_password_no_auth") as scratch:
        _migrate(scratch.url, "upgrade", TARGET_REVISION)
        engine = scratch.engine()
        try:
            with engine.connect() as connection:
                assert (
                    connection.execute(
                        sa.text("SELECT to_regprocedure(:signature)"),
                        {"signature": f"public.{FUNCTION_NAME}()"},
                    ).scalar_one()
                    is None
                )
            _migrate(scratch.url, "downgrade", PARENT_REVISION)
            _migrate(scratch.url, "upgrade", TARGET_REVISION)
        finally:
            engine.dispose()
