"""Finish the zero-downtime rename of two account timestamps (#1045).

Release 0034 added the honest names beside the old names and kept each pair
equal. The application now uses only the honest names. Refuse to choose between
unequal values, then remove the matching triggers, functions, and old columns.

The reverse migration restores the old columns, copies every honest-name value,
and reinstalls the matching rules so older application code can run safely.

Revision ID: 0035_drop_legacy_auth_times
Revises: 0034_auth_identity_linked_at
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0035_drop_legacy_auth_times"
down_revision = "0034_auth_identity_linked_at"
branch_labels = None
depends_on = None


def _lock_account_tables() -> None:
    # First-time sign-in writes user_account then auth_identity, while ordinary
    # authenticated reads touch them in the reverse order. Try both locks inside
    # one exception block: if either is busy, PostgreSQL rolls back and releases
    # every lock from that attempt before retrying, so neither migration direction
    # can deadlock with either application order.
    op.execute(
        """
        DO $migration_lock$
        DECLARE
            deadline timestamptz := clock_timestamp() + interval '30 seconds';
        BEGIN
            LOOP
                BEGIN
                    LOCK TABLE user_account, auth_identity
                        IN ACCESS EXCLUSIVE MODE NOWAIT;
                    EXIT;
                EXCEPTION WHEN lock_not_available THEN
                    IF clock_timestamp() >= deadline THEN
                        RAISE EXCEPTION
                            'account timestamp cleanup could not acquire both table locks'
                            USING ERRCODE = '55P03';
                    END IF;
                    PERFORM pg_sleep(0.1);
                END;
            END LOOP;
        END;
        $migration_lock$;
        """
    )


def upgrade() -> None:
    _lock_account_tables()
    op.execute(
        """
        DO $$
        BEGIN
            IF EXISTS (
                SELECT 1
                FROM user_account
                WHERE last_signed_in_at IS DISTINCT FROM last_identity_linked_at
            ) THEN
                RAISE EXCEPTION 'user account identity-link timestamps do not match';
            END IF;
            IF EXISTS (
                SELECT 1
                FROM auth_identity
                WHERE last_used_at IS DISTINCT FROM linked_at
            ) THEN
                RAISE EXCEPTION 'auth identity link timestamps do not match';
            END IF;
        END;
        $$
        """
    )
    op.execute("DROP TRIGGER sync_auth_identity_link_timestamps ON auth_identity")
    op.execute("DROP FUNCTION sync_auth_identity_link_timestamps()")
    op.execute(
        "DROP TRIGGER sync_user_account_identity_link_timestamps ON user_account"
    )
    op.execute("DROP FUNCTION sync_user_account_identity_link_timestamps()")
    op.drop_column("auth_identity", "last_used_at")
    op.drop_column("user_account", "last_signed_in_at")


def downgrade() -> None:
    _lock_account_tables()
    op.add_column(
        "user_account",
        sa.Column("last_signed_in_at", sa.DateTime(timezone=True)),
    )
    op.add_column(
        "auth_identity",
        sa.Column("last_used_at", sa.DateTime(timezone=True)),
    )
    op.execute(
        """
        UPDATE user_account
        SET last_signed_in_at = last_identity_linked_at
        """
    )
    op.execute(
        """
        UPDATE auth_identity
        SET last_used_at = linked_at
        """
    )
    op.execute(
        """
        CREATE FUNCTION sync_user_account_identity_link_timestamps()
        RETURNS trigger
        LANGUAGE plpgsql
        AS $$
        BEGIN
            IF TG_OP = 'INSERT' THEN
                IF NEW.last_identity_linked_at IS NULL THEN
                    NEW.last_identity_linked_at := NEW.last_signed_in_at;
                ELSIF NEW.last_signed_in_at IS NULL THEN
                    NEW.last_signed_in_at := NEW.last_identity_linked_at;
                ELSIF NEW.last_identity_linked_at IS DISTINCT FROM NEW.last_signed_in_at THEN
                    RAISE EXCEPTION 'identity-link timestamp names must match';
                END IF;
            ELSE
                IF NEW.last_identity_linked_at IS DISTINCT FROM OLD.last_identity_linked_at
                   AND NEW.last_signed_in_at IS NOT DISTINCT FROM OLD.last_signed_in_at THEN
                    NEW.last_signed_in_at := NEW.last_identity_linked_at;
                ELSIF NEW.last_signed_in_at IS DISTINCT FROM OLD.last_signed_in_at
                      AND NEW.last_identity_linked_at IS NOT DISTINCT FROM OLD.last_identity_linked_at THEN
                    NEW.last_identity_linked_at := NEW.last_signed_in_at;
                ELSIF NEW.last_identity_linked_at IS DISTINCT FROM OLD.last_identity_linked_at
                      AND NEW.last_signed_in_at IS DISTINCT FROM OLD.last_signed_in_at
                      AND NEW.last_identity_linked_at IS DISTINCT FROM NEW.last_signed_in_at THEN
                    RAISE EXCEPTION 'identity-link timestamp names must match';
                END IF;
            END IF;
            RETURN NEW;
        END;
        $$
        """
    )
    op.execute(
        """
        CREATE TRIGGER sync_user_account_identity_link_timestamps
        BEFORE INSERT OR UPDATE ON user_account
        FOR EACH ROW
        EXECUTE FUNCTION sync_user_account_identity_link_timestamps()
        """
    )
    op.execute(
        """
        CREATE FUNCTION sync_auth_identity_link_timestamps()
        RETURNS trigger
        LANGUAGE plpgsql
        AS $$
        BEGIN
            IF TG_OP = 'INSERT' THEN
                IF NEW.linked_at IS NULL THEN
                    NEW.linked_at := NEW.last_used_at;
                ELSIF NEW.last_used_at IS NULL THEN
                    NEW.last_used_at := NEW.linked_at;
                ELSIF NEW.linked_at IS DISTINCT FROM NEW.last_used_at THEN
                    RAISE EXCEPTION 'identity-link timestamp names must match';
                END IF;
            ELSE
                IF NEW.linked_at IS DISTINCT FROM OLD.linked_at
                   AND NEW.last_used_at IS NOT DISTINCT FROM OLD.last_used_at THEN
                    NEW.last_used_at := NEW.linked_at;
                ELSIF NEW.last_used_at IS DISTINCT FROM OLD.last_used_at
                      AND NEW.linked_at IS NOT DISTINCT FROM OLD.linked_at THEN
                    NEW.linked_at := NEW.last_used_at;
                ELSIF NEW.linked_at IS DISTINCT FROM OLD.linked_at
                      AND NEW.last_used_at IS DISTINCT FROM OLD.last_used_at
                      AND NEW.linked_at IS DISTINCT FROM NEW.last_used_at THEN
                    RAISE EXCEPTION 'identity-link timestamp names must match';
                END IF;
            END IF;
            RETURN NEW;
        END;
        $$
        """
    )
    op.execute(
        """
        CREATE TRIGGER sync_auth_identity_link_timestamps
        BEFORE INSERT OR UPDATE ON auth_identity
        FOR EACH ROW
        EXECUTE FUNCTION sync_auth_identity_link_timestamps()
        """
    )
