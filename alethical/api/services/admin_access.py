"""Server-derived menu capability; private requests still authorize independently."""

import os
from uuid import UUID

from sqlalchemy import text
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

ADMIN_EMAILS = frozenset(
    {
        "angelzierden@gmail.com",
        "angel@alethical.com",
        "eug@alethical.com",
        "alethicaldev@gmail.com",
    }
)


def configured_admin_subjects() -> set[str]:
    try:
        return {
            str(UUID(value.strip()))
            for value in os.environ.get("ALETHICAL_ADMIN_ACCOUNT_IDS", "").split(",")
            if value.strip()
        }
    except ValueError:
        return set()


def administrator_menu_access(db: Session, provider_subject: str | None) -> bool | None:
    """Accept only the Supabase subject already verified by get_current_user.

    This hint is returned with /me, so opening a menu needs no network request.
    It grants no data access. None keeps the older capability endpoint available
    when this optional read fails, without breaking ordinary sign-in.
    """
    if provider_subject not in configured_admin_subjects():
        return False
    try:
        return (
            db.scalar(
                text("""
            SELECT true FROM auth.users u
            WHERE u.id = CAST(:subject AS uuid)
              AND u.deleted_at IS NULL AND NOT u.is_anonymous
              AND u.email_confirmed_at IS NOT NULL
              AND lower(u.email) = ANY(:emails)
              AND (u.banned_until IS NULL OR u.banned_until <= CURRENT_TIMESTAMP)
              AND NOT EXISTS (
                SELECT 1 FROM public.auth_identity a
                JOIN public.user_account p ON p.id = a.user_id
                WHERE a.provider = 'supabase' AND a.provider_subject = u.id::text
                  AND NOT p.is_active
              )
            """),
                {"subject": provider_subject, "emails": sorted(ADMIN_EMAILS)},
            )
            is True
        )
    except SQLAlchemyError:
        db.rollback()
        return None
