"""Prepare a zero-downtime rename of two account timestamps (#1045).

Add the honest names beside the old names and copy every value exactly. Triggers
keep each old/new pair equal while old and new Railway copies overlap. A later
release switches the application to the honest names; only a release after that
may remove the compatibility columns and triggers.

The reverse migration copies the honest-name values back before removing the new
columns, so values written through either name survive the downgrade.

Revision ID: 0034_auth_identity_linked_at
Revises: 0033_bill_short_title
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0034_auth_identity_linked_at"
down_revision = "0033_bill_short_title"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "user_account",
        sa.Column("last_identity_linked_at", sa.DateTime(timezone=True)),
    )
    op.add_column(
        "auth_identity",
        sa.Column("linked_at", sa.DateTime(timezone=True)),
    )
    op.execute(
        """
        UPDATE user_account
        SET last_identity_linked_at = last_signed_in_at
        """
    )
    op.execute(
        """
        UPDATE auth_identity
        SET linked_at = last_used_at
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


def downgrade() -> None:
    op.execute(
        """
        UPDATE user_account
        SET last_signed_in_at = last_identity_linked_at
        WHERE last_signed_in_at IS DISTINCT FROM last_identity_linked_at
        """
    )
    op.execute(
        """
        UPDATE auth_identity
        SET last_used_at = linked_at
        WHERE last_used_at IS DISTINCT FROM linked_at
        """
    )
    op.execute("DROP TRIGGER sync_auth_identity_link_timestamps ON auth_identity")
    op.execute("DROP FUNCTION sync_auth_identity_link_timestamps()")
    op.execute(
        "DROP TRIGGER sync_user_account_identity_link_timestamps ON user_account"
    )
    op.execute("DROP FUNCTION sync_user_account_identity_link_timestamps()")
    op.drop_column("auth_identity", "linked_at")
    op.drop_column("user_account", "last_identity_linked_at")
