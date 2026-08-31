"""The safe account timestamp transition preserves every stored instant (#1045)."""

from __future__ import annotations

import os
import subprocess
import sys
import time
import uuid
from datetime import datetime, timezone
from pathlib import Path

import pytest
import sqlalchemy as sa

from scripts.check_schema_drift import ScratchDatabase, _local_base_url

ROOT = Path(__file__).resolve().parents[2]
PARENT_REVISION = "0033_bill_short_title"
TARGET_REVISION = "0034_auth_identity_linked_at"
CLEANUP_REVISION = "0035_drop_legacy_auth_times"


def _run_migration(
    url: sa.URL, direction: str, revision: str
) -> subprocess.CompletedProcess[str]:
    env = {
        **os.environ,
        "DATABASE_URL": url.render_as_string(hide_password=False),
    }
    env.pop("ALETHICAL_DATABASE_TARGET", None)
    return subprocess.run(
        [sys.executable, "-m", "alembic", "-c", "alembic.ini", direction, revision],
        cwd=ROOT,
        env=env,
        capture_output=True,
        text=True,
        check=False,
    )


def _migrate(url: sa.URL, direction: str, revision: str) -> None:
    result = _run_migration(url, direction, revision)
    assert result.returncode == 0, result.stdout + result.stderr


def _columns(engine: sa.Engine, table: str) -> set[str]:
    return {column["name"] for column in sa.inspect(engine).get_columns(table)}


def _assert_values(
    engine: sa.Engine,
    *,
    account_column: str,
    identity_column: str,
    account_id: uuid.UUID,
    identity_id: uuid.UUID,
    account_value: datetime,
    identity_value: datetime,
) -> None:
    with engine.connect() as connection:
        saved_account_value = connection.execute(
            sa.text(
                f"SELECT {account_column} FROM user_account WHERE id = :account_id"
            ),
            {"account_id": account_id},
        ).scalar_one()
        saved_identity_value = connection.execute(
            sa.text(
                f"SELECT {identity_column} FROM auth_identity WHERE id = :identity_id"
            ),
            {"identity_id": identity_id},
        ).scalar_one()
    assert saved_account_value == account_value
    assert saved_identity_value == identity_value


def _insert_trigger_row(
    connection: sa.Connection,
    *,
    table: str,
    row_id: uuid.UUID,
    parent_id: uuid.UUID,
    values: dict[str, datetime | None],
) -> None:
    if table == "user_account":
        columns = ["id", "display_name", "is_active", *values]
        parameters: dict[str, object] = {
            "id": row_id,
            "display_name": f"Trigger proof {row_id}",
            "is_active": True,
            **values,
        }
    else:
        columns = [
            "id",
            "user_id",
            "provider",
            "provider_subject",
            *values,
        ]
        parameters = {
            "id": row_id,
            "user_id": parent_id,
            "provider": "migration-proof",
            "provider_subject": str(row_id),
            **values,
        }
    placeholders = [f":{column}" for column in columns]
    connection.execute(
        sa.text(
            f"INSERT INTO {table} ({', '.join(columns)}) "
            f"VALUES ({', '.join(placeholders)})"
        ),
        parameters,
    )


def _read_trigger_pair(
    engine: sa.Engine,
    *,
    table: str,
    old_column: str,
    new_column: str,
    row_id: uuid.UUID,
) -> tuple[datetime | None, datetime | None]:
    with engine.connect() as connection:
        return connection.execute(
            sa.text(f"SELECT {old_column}, {new_column} FROM {table} WHERE id = :id"),
            {"id": row_id},
        ).one()


@pytest.mark.parametrize(
    ("table", "old_column", "new_column"),
    (
        ("user_account", "last_signed_in_at", "last_identity_linked_at"),
        ("auth_identity", "last_used_at", "linked_at"),
    ),
)
def test_transition_trigger_keeps_both_names_equal(
    table: str, old_column: str, new_column: str
) -> None:
    first = datetime(2024, 1, 2, 3, 4, 5, tzinfo=timezone.utc)
    second = datetime(2025, 2, 3, 4, 5, 6, tzinfo=timezone.utc)
    third = datetime(2026, 3, 4, 5, 6, 7, tzinfo=timezone.utc)

    with ScratchDatabase(_local_base_url(), f"account_trigger_{table}") as scratch:
        _migrate(scratch.url, "upgrade", TARGET_REVISION)
        engine = scratch.engine()
        try:
            parent_id = uuid.uuid4()
            with engine.begin() as connection:
                if table == "auth_identity":
                    _insert_trigger_row(
                        connection,
                        table="user_account",
                        row_id=parent_id,
                        parent_id=parent_id,
                        values={},
                    )

            old_only_id = uuid.uuid4()
            new_only_id = uuid.uuid4()
            equal_id = uuid.uuid4()
            null_id = uuid.uuid4()
            with engine.begin() as connection:
                _insert_trigger_row(
                    connection,
                    table=table,
                    row_id=old_only_id,
                    parent_id=parent_id,
                    values={old_column: first},
                )
                _insert_trigger_row(
                    connection,
                    table=table,
                    row_id=new_only_id,
                    parent_id=parent_id,
                    values={new_column: second},
                )
                _insert_trigger_row(
                    connection,
                    table=table,
                    row_id=equal_id,
                    parent_id=parent_id,
                    values={old_column: first, new_column: first},
                )
                _insert_trigger_row(
                    connection,
                    table=table,
                    row_id=null_id,
                    parent_id=parent_id,
                    values={old_column: None, new_column: None},
                )

            assert _read_trigger_pair(
                engine,
                table=table,
                old_column=old_column,
                new_column=new_column,
                row_id=old_only_id,
            ) == (first, first)
            assert _read_trigger_pair(
                engine,
                table=table,
                old_column=old_column,
                new_column=new_column,
                row_id=new_only_id,
            ) == (second, second)
            assert _read_trigger_pair(
                engine,
                table=table,
                old_column=old_column,
                new_column=new_column,
                row_id=equal_id,
            ) == (first, first)
            assert _read_trigger_pair(
                engine,
                table=table,
                old_column=old_column,
                new_column=new_column,
                row_id=null_id,
            ) == (None, None)

            with pytest.raises(sa.exc.DBAPIError):
                with engine.begin() as connection:
                    _insert_trigger_row(
                        connection,
                        table=table,
                        row_id=uuid.uuid4(),
                        parent_id=parent_id,
                        values={old_column: first, new_column: second},
                    )

            with engine.begin() as connection:
                connection.execute(
                    sa.text(f"UPDATE {table} SET {new_column} = :value WHERE id = :id"),
                    {"id": old_only_id, "value": second},
                )
            assert _read_trigger_pair(
                engine,
                table=table,
                old_column=old_column,
                new_column=new_column,
                row_id=old_only_id,
            ) == (second, second)

            with engine.begin() as connection:
                connection.execute(
                    sa.text(f"UPDATE {table} SET {old_column} = :value WHERE id = :id"),
                    {"id": old_only_id, "value": first},
                )
                connection.execute(
                    sa.text(
                        f"UPDATE {table} SET {old_column} = :value, "
                        f"{new_column} = :value WHERE id = :id"
                    ),
                    {"id": old_only_id, "value": second},
                )
            assert _read_trigger_pair(
                engine,
                table=table,
                old_column=old_column,
                new_column=new_column,
                row_id=old_only_id,
            ) == (second, second)

            with engine.begin() as connection:
                connection.execute(
                    sa.text(f"UPDATE {table} SET {new_column} = NULL WHERE id = :id"),
                    {"id": old_only_id},
                )
            assert _read_trigger_pair(
                engine,
                table=table,
                old_column=old_column,
                new_column=new_column,
                row_id=old_only_id,
            ) == (None, None)

            with engine.begin() as connection:
                connection.execute(
                    sa.text(f"UPDATE {table} SET {old_column} = :value WHERE id = :id"),
                    {"id": old_only_id, "value": first},
                )
                connection.execute(
                    sa.text(f"UPDATE {table} SET {old_column} = NULL WHERE id = :id"),
                    {"id": old_only_id},
                )
            assert _read_trigger_pair(
                engine,
                table=table,
                old_column=old_column,
                new_column=new_column,
                row_id=old_only_id,
            ) == (None, None)

            with engine.begin() as connection:
                connection.execute(
                    sa.text(
                        f"UPDATE {table} SET {old_column} = :value, "
                        f"{new_column} = :value WHERE id = :id"
                    ),
                    {"id": old_only_id, "value": first},
                )
            with pytest.raises(sa.exc.DBAPIError):
                with engine.begin() as connection:
                    connection.execute(
                        sa.text(
                            f"UPDATE {table} SET {old_column} = :old_value, "
                            f"{new_column} = :new_value WHERE id = :id"
                        ),
                        {
                            "id": old_only_id,
                            "old_value": second,
                            "new_value": third,
                        },
                    )
            assert _read_trigger_pair(
                engine,
                table=table,
                old_column=old_column,
                new_column=new_column,
                row_id=old_only_id,
            ) == (first, first)
        finally:
            engine.dispose()


def test_account_timestamp_transition_round_trip_preserves_values() -> None:
    account_id = uuid.uuid4()
    identity_id = uuid.uuid4()
    account_value = datetime(2024, 2, 3, 4, 5, 6, tzinfo=timezone.utc)
    identity_value = datetime(2025, 6, 7, 8, 9, 10, tzinfo=timezone.utc)

    with ScratchDatabase(_local_base_url(), "account_timestamp") as scratch:
        _migrate(scratch.url, "upgrade", PARENT_REVISION)
        engine = scratch.engine()
        try:
            with engine.begin() as connection:
                connection.execute(
                    sa.text(
                        """
                        INSERT INTO user_account
                            (id, display_name, is_active, last_signed_in_at)
                        VALUES
                            (:id, 'Migration proof', true, :saved_at)
                        """
                    ),
                    {"id": account_id, "saved_at": account_value},
                )
                connection.execute(
                    sa.text(
                        """
                        INSERT INTO auth_identity
                            (id, user_id, provider, provider_subject, last_used_at)
                        VALUES
                            (:id, :user_id, 'migration-proof', :subject, :saved_at)
                        """
                    ),
                    {
                        "id": identity_id,
                        "user_id": account_id,
                        "subject": str(identity_id),
                        "saved_at": identity_value,
                    },
                )

            _migrate(scratch.url, "upgrade", TARGET_REVISION)
            assert "last_identity_linked_at" in _columns(engine, "user_account")
            assert "last_signed_in_at" in _columns(engine, "user_account")
            assert "linked_at" in _columns(engine, "auth_identity")
            assert "last_used_at" in _columns(engine, "auth_identity")
            _assert_values(
                engine,
                account_column="last_signed_in_at",
                identity_column="last_used_at",
                account_id=account_id,
                identity_id=identity_id,
                account_value=account_value,
                identity_value=identity_value,
            )
            _assert_values(
                engine,
                account_column="last_identity_linked_at",
                identity_column="linked_at",
                account_id=account_id,
                identity_id=identity_id,
                account_value=account_value,
                identity_value=identity_value,
            )

            _migrate(scratch.url, "downgrade", PARENT_REVISION)
            assert "last_signed_in_at" in _columns(engine, "user_account")
            assert "last_identity_linked_at" not in _columns(engine, "user_account")
            assert "last_used_at" in _columns(engine, "auth_identity")
            assert "linked_at" not in _columns(engine, "auth_identity")
            _assert_values(
                engine,
                account_column="last_signed_in_at",
                identity_column="last_used_at",
                account_id=account_id,
                identity_id=identity_id,
                account_value=account_value,
                identity_value=identity_value,
            )

            _migrate(scratch.url, "upgrade", TARGET_REVISION)
            for account_column, identity_column in (
                ("last_signed_in_at", "last_used_at"),
                ("last_identity_linked_at", "linked_at"),
            ):
                _assert_values(
                    engine,
                    account_column=account_column,
                    identity_column=identity_column,
                    account_id=account_id,
                    identity_id=identity_id,
                    account_value=account_value,
                    identity_value=identity_value,
                )
        finally:
            engine.dispose()


def test_account_timestamp_cleanup_round_trip_preserves_values() -> None:
    account_id = uuid.uuid4()
    identity_id = uuid.uuid4()
    account_value = datetime(2024, 10, 11, 12, 13, 14, tzinfo=timezone.utc)
    identity_value = datetime(2025, 11, 12, 13, 14, 15, tzinfo=timezone.utc)

    with ScratchDatabase(_local_base_url(), "account_timestamp_cleanup") as scratch:
        _migrate(scratch.url, "upgrade", TARGET_REVISION)
        engine = scratch.engine()
        try:
            with engine.begin() as connection:
                connection.execute(
                    sa.text(
                        """
                        INSERT INTO user_account
                            (id, display_name, is_active, last_identity_linked_at)
                        VALUES
                            (:id, 'Cleanup proof', true, :saved_at)
                        """
                    ),
                    {"id": account_id, "saved_at": account_value},
                )
                connection.execute(
                    sa.text(
                        """
                        INSERT INTO auth_identity
                            (id, user_id, provider, provider_subject, linked_at)
                        VALUES
                            (:id, :user_id, 'cleanup-proof', :subject, :saved_at)
                        """
                    ),
                    {
                        "id": identity_id,
                        "user_id": account_id,
                        "subject": str(identity_id),
                        "saved_at": identity_value,
                    },
                )

            _migrate(scratch.url, "upgrade", CLEANUP_REVISION)
            assert "last_identity_linked_at" in _columns(engine, "user_account")
            assert "last_signed_in_at" not in _columns(engine, "user_account")
            assert "linked_at" in _columns(engine, "auth_identity")
            assert "last_used_at" not in _columns(engine, "auth_identity")
            _assert_values(
                engine,
                account_column="last_identity_linked_at",
                identity_column="linked_at",
                account_id=account_id,
                identity_id=identity_id,
                account_value=account_value,
                identity_value=identity_value,
            )

            _migrate(scratch.url, "downgrade", TARGET_REVISION)
            assert "last_signed_in_at" in _columns(engine, "user_account")
            assert "last_used_at" in _columns(engine, "auth_identity")
            for account_column, identity_column in (
                ("last_signed_in_at", "last_used_at"),
                ("last_identity_linked_at", "linked_at"),
            ):
                _assert_values(
                    engine,
                    account_column=account_column,
                    identity_column=identity_column,
                    account_id=account_id,
                    identity_id=identity_id,
                    account_value=account_value,
                    identity_value=identity_value,
                )

            _migrate(scratch.url, "upgrade", CLEANUP_REVISION)
            assert "last_signed_in_at" not in _columns(engine, "user_account")
            assert "last_used_at" not in _columns(engine, "auth_identity")
            _assert_values(
                engine,
                account_column="last_identity_linked_at",
                identity_column="linked_at",
                account_id=account_id,
                identity_id=identity_id,
                account_value=account_value,
                identity_value=identity_value,
            )
        finally:
            engine.dispose()


@pytest.mark.parametrize(
    ("first_table", "second_table"),
    (
        ("user_account", "auth_identity"),
        ("auth_identity", "user_account"),
    ),
)
@pytest.mark.parametrize(
    ("direction", "starting_revision", "ending_revision"),
    (
        ("upgrade", TARGET_REVISION, CLEANUP_REVISION),
        ("downgrade", CLEANUP_REVISION, TARGET_REVISION),
    ),
)
def test_cleanup_and_rollback_retry_without_blocking_application_table_orders(
    first_table: str,
    second_table: str,
    direction: str,
    starting_revision: str,
    ending_revision: str,
) -> None:
    account_id = uuid.uuid4()
    identity_id = uuid.uuid4()

    with ScratchDatabase(
        _local_base_url(), f"account_cleanup_lock_order_{direction}_{first_table}"
    ) as scratch:
        _migrate(scratch.url, "upgrade", starting_revision)
        engine = scratch.engine()
        migration: subprocess.Popen[str] | None = None
        sign_in = engine.connect()
        sign_in_transaction = sign_in.begin()
        try:
            with engine.begin() as connection:
                connection.execute(
                    sa.text(
                        """
                        INSERT INTO user_account (id, display_name, is_active)
                        VALUES (:id, 'Lock order proof', true)
                        """
                    ),
                    {"id": account_id},
                )
                connection.execute(
                    sa.text(
                        """
                        INSERT INTO auth_identity
                            (id, user_id, provider, provider_subject)
                        VALUES (:id, :user_id, 'lock-proof', :subject)
                        """
                    ),
                    {
                        "id": identity_id,
                        "user_id": account_id,
                        "subject": str(identity_id),
                    },
                )

            row_ids = {
                "user_account": account_id,
                "auth_identity": identity_id,
            }
            # Model either application order after its first table access but
            # before it reaches the second table.
            sign_in.execute(
                sa.text(f"UPDATE {first_table} SET id = id WHERE id = :id"),
                {"id": row_ids[first_table]},
            )
            env = {
                **os.environ,
                "DATABASE_URL": scratch.url.render_as_string(hide_password=False),
            }
            env.pop("ALETHICAL_DATABASE_TARGET", None)
            migration = subprocess.Popen(
                [
                    sys.executable,
                    "-m",
                    "alembic",
                    "-c",
                    "alembic.ini",
                    direction,
                    ending_revision,
                ],
                cwd=ROOT,
                env=env,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=True,
            )

            deadline = time.monotonic() + 10
            cleanup_is_retrying = False
            while time.monotonic() < deadline:
                with engine.connect() as observer:
                    cleanup_is_retrying = bool(
                        observer.execute(
                            sa.text(
                                """
                                SELECT EXISTS (
                                    SELECT 1
                                    FROM pg_stat_activity
                                    WHERE datname = current_database()
                                      AND pid <> pg_backend_pid()
                                      AND state = 'active'
                                      AND query LIKE '%LOCK TABLE user_account, auth_identity%'
                                )
                                """
                            )
                        ).scalar_one()
                    )
                if cleanup_is_retrying:
                    break
                time.sleep(0.05)
            assert cleanup_is_retrying, "cleanup never entered its lock retry"

            # The cleanup must release the other table between attempts. Holding
            # it would make this application transaction time out or deadlock.
            sign_in.execute(sa.text("SET LOCAL lock_timeout = '2s'"))
            sign_in.execute(
                sa.text(f"UPDATE {second_table} SET id = id WHERE id = :id"),
                {"id": row_ids[second_table]},
            )
            sign_in_transaction.commit()

            stdout, stderr = migration.communicate(timeout=10)
            assert migration.returncode == 0, stdout + stderr
            old_columns_should_exist = direction == "downgrade"
            assert (
                "last_signed_in_at" in _columns(engine, "user_account")
            ) is old_columns_should_exist
            assert (
                "last_used_at" in _columns(engine, "auth_identity")
            ) is old_columns_should_exist
        finally:
            if migration is not None and migration.poll() is None:
                migration.terminate()
                migration.communicate(timeout=5)
            if sign_in_transaction.is_active:
                sign_in_transaction.rollback()
            sign_in.close()
            engine.dispose()


@pytest.mark.parametrize(
    ("table", "trigger", "old_column", "new_column"),
    (
        (
            "user_account",
            "sync_user_account_identity_link_timestamps",
            "last_signed_in_at",
            "last_identity_linked_at",
        ),
        (
            "auth_identity",
            "sync_auth_identity_link_timestamps",
            "last_used_at",
            "linked_at",
        ),
    ),
)
def test_cleanup_refuses_to_choose_between_unequal_values(
    table: str, trigger: str, old_column: str, new_column: str
) -> None:
    account_id = uuid.uuid4()
    identity_id = uuid.uuid4()
    first = datetime(2024, 1, 2, 3, 4, 5, tzinfo=timezone.utc)
    second = datetime(2025, 2, 3, 4, 5, 6, tzinfo=timezone.utc)

    with ScratchDatabase(
        _local_base_url(), f"account_cleanup_refusal_{table}"
    ) as scratch:
        _migrate(scratch.url, "upgrade", TARGET_REVISION)
        engine = scratch.engine()
        try:
            with engine.begin() as connection:
                connection.execute(
                    sa.text(
                        """
                        INSERT INTO user_account
                            (id, display_name, is_active, last_identity_linked_at)
                        VALUES
                            (:id, 'Refusal proof', true, :saved_at)
                        """
                    ),
                    {"id": account_id, "saved_at": first},
                )
                connection.execute(
                    sa.text(
                        """
                        INSERT INTO auth_identity
                            (id, user_id, provider, provider_subject, linked_at)
                        VALUES
                            (:id, :user_id, 'refusal-proof', :subject, :saved_at)
                        """
                    ),
                    {
                        "id": identity_id,
                        "user_id": account_id,
                        "subject": str(identity_id),
                        "saved_at": first,
                    },
                )
                row_id = account_id if table == "user_account" else identity_id
                connection.execute(
                    sa.text(f"ALTER TABLE {table} DISABLE TRIGGER {trigger}")
                )
                connection.execute(
                    sa.text(
                        f"UPDATE {table} SET {old_column} = :saved_at WHERE id = :id"
                    ),
                    {"id": row_id, "saved_at": second},
                )

            result = _run_migration(scratch.url, "upgrade", CLEANUP_REVISION)

            assert result.returncode != 0
            assert "timestamps do not match" in result.stderr
            assert old_column in _columns(engine, table)
            assert new_column in _columns(engine, table)
        finally:
            engine.dispose()
