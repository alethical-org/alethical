from __future__ import annotations

import logging
from uuid import UUID

from sqlalchemy import text
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

logger = logging.getLogger(__name__)


def current_supabase_sign_in_methods(
    db: Session, provider_subject: str | None
) -> dict[str, bool] | None:
    """Reduce Supabase's current credentials to 2 non-sensitive facts.

    Supabase currently has an open provider-metadata bug: a password added to a
    Google-first account can work without appearing in the public provider
    list. Alethical's backend already connects to the same Supabase database,
    so it reads the credential record without returning hashes or identity data.

    ``None`` deliberately selects the UI's neutral fallback on local installs
    and whenever the auth tables cannot be read.
    """
    if not provider_subject:
        return None
    try:
        subject = str(UUID(provider_subject))
    except ValueError:
        return None

    try:
        readable = db.execute(
            text(
                """
                SELECT
                  to_regclass('auth.users') IS NOT NULL
                  AND to_regclass('auth.identities') IS NOT NULL
                  AND has_table_privilege(
                    current_user, to_regclass('auth.users'), 'SELECT'
                  )
                  AND has_table_privilege(
                    current_user, to_regclass('auth.identities'), 'SELECT'
                  )
                """
            )
        ).scalar_one()
        if not readable:
            return None

        row = (
            db.execute(
                text(
                    """
                    SELECT
                      EXISTS (
                        SELECT 1
                        FROM auth.identities AS identity
                        WHERE identity.user_id = auth_user.id
                          AND identity.provider = 'google'
                      ) AS google,
                      NULLIF(auth_user.encrypted_password, '') IS NOT NULL AS password
                    FROM auth.users AS auth_user
                    WHERE auth_user.id = CAST(:subject AS uuid)
                    """
                ),
                {"subject": subject},
            )
            .mappings()
            .one_or_none()
        )
    except SQLAlchemyError:
        db.rollback()
        logger.warning("Could not read current Supabase sign-in methods")
        return None

    if row is None:
        return None
    return {"google": bool(row["google"]), "password": bool(row["password"])}
