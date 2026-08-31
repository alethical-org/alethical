"""Remove an unproved password when its email becomes confirmed.

Net: an unfinished account can hold a password before anyone proves its email address.
Confirming that address must remove the old password in the same database write, so a
password planted by someone else can never become a working way into the account.

The trigger reads no table and changes only the row Supabase is already confirming. It
is skipped on databases without Supabase's managed ``auth.users`` table, which keeps the
ordinary Alethical test and development databases usable. The function lives in
``public`` because Supabase manages the ``auth`` schema.

Revision ID: 0041_confirmation_password_guard
Revises: 0040_cf_name_indexes
"""

from alembic import op

revision = "0041_confirmation_password_guard"
down_revision = "0040_cf_name_indexes"
branch_labels = None
depends_on = None

FUNCTION_NAME = "alethical_clear_unproved_password_on_confirmation"
TRIGGER_NAME = "alethical_clear_unproved_password_on_confirmation"


def upgrade() -> None:
    op.execute(
        f"""
        DO $migration$
        BEGIN
            IF to_regclass('auth.users') IS NULL THEN
                RETURN;
            END IF;

            EXECUTE $function$
                CREATE OR REPLACE FUNCTION public.{FUNCTION_NAME}()
                RETURNS trigger
                LANGUAGE plpgsql
                SECURITY INVOKER
                SET search_path = ''
                AS $body$
                BEGIN
                    NEW.encrypted_password := NULL;
                    RETURN NEW;
                END;
                $body$
            $function$;

            REVOKE ALL ON FUNCTION public.{FUNCTION_NAME}() FROM PUBLIC;

            DROP TRIGGER IF EXISTS {TRIGGER_NAME} ON auth.users;
            CREATE TRIGGER {TRIGGER_NAME}
                BEFORE UPDATE OF email_confirmed_at ON auth.users
                FOR EACH ROW
                WHEN (
                    OLD.email_confirmed_at IS NULL
                    AND NEW.email_confirmed_at IS NOT NULL
                )
                EXECUTE FUNCTION public.{FUNCTION_NAME}();
        END
        $migration$;
        """
    )


def downgrade() -> None:
    op.execute(
        f"""
        DO $migration$
        BEGIN
            IF to_regclass('auth.users') IS NOT NULL THEN
                DROP TRIGGER IF EXISTS {TRIGGER_NAME} ON auth.users;
            END IF;
        END
        $migration$;

        DROP FUNCTION IF EXISTS public.{FUNCTION_NAME}();
        """
    )
