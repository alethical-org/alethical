"""Current confirmed applicant emails shared by claims and notification delivery."""

from uuid import UUID

from sqlalchemy import text
from sqlalchemy.orm import Session


def current_confirmed_emails(db: Session, user_ids: set[UUID]) -> dict[UUID, str]:
    """Return only unambiguous, active provider-confirmed emails without rollback.

    Local profile addresses and copied verification timestamps are not current
    identity evidence. Callers must treat a missing account as ineligible, and
    propagate a failed read rather than mistaking it for a negative result.
    """
    if not user_ids:
        return {}
    rows = db.execute(
        text("""
        SELECT p.id, min(lower(u.email)) AS email
        FROM public.user_account p
        JOIN public.auth_identity a ON a.user_id = p.id AND a.provider = 'supabase'
        JOIN auth.users u ON a.provider_subject = u.id::text
        WHERE p.id = ANY(:user_ids) AND p.is_active
          AND u.deleted_at IS NULL AND NOT u.is_anonymous
          AND u.email_confirmed_at IS NOT NULL AND u.email IS NOT NULL
          AND (u.banned_until IS NULL OR u.banned_until <= CURRENT_TIMESTAMP)
        GROUP BY p.id HAVING count(DISTINCT lower(u.email)) = 1
    """),
        {"user_ids": sorted(user_ids)},
    ).all()
    return {user_id: email for user_id, email in rows}
