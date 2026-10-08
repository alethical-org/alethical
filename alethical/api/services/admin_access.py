"""Current administrator eligibility, shared by private operations and menu hints."""

import os
from dataclasses import dataclass
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
        "alexia@alethical.com",
        "joe@alethical.com",
        "afnetter@gmail.com",
        "joseph.fleishman@gmail.com",
        "ask@alethical.com",
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


_CURRENT_ADMIN = """
    u.deleted_at IS NULL AND NOT u.is_anonymous
    AND u.email_confirmed_at IS NOT NULL
    AND lower(u.email) = ANY(:emails)
    AND (u.banned_until IS NULL OR u.banned_until <= CURRENT_TIMESTAMP)
    AND NOT EXISTS (
        SELECT 1 FROM public.auth_identity linked
        JOIN public.user_account account ON account.id = linked.user_id
        WHERE linked.provider = 'supabase'
          AND linked.provider_subject = u.id::text AND NOT account.is_active
    )
"""


@dataclass(frozen=True)
class EligibleAdministrator:
    user_id: UUID
    email: str


def administrator_subject_access(
    db: Session,
    provider_subject: str | None,
    *,
    expected_email: str | None = None,
) -> bool:
    """Check current provider records after the caller authenticates the subject.

    An expected email binds a freshly authenticated email to the database read.
    Preserve access before local provisioning, but reject any inactive mapping.
    Database failures propagate without rolling back the caller's transaction.
    """
    if provider_subject not in configured_admin_subjects():
        return False
    if expected_email is not None and expected_email.lower() not in ADMIN_EMAILS:
        return False
    email_condition = "AND lower(u.email) = :expected_email" if expected_email else ""
    return (
        db.scalar(
            text(f"""
            SELECT true FROM auth.users u
            WHERE u.id = CAST(:subject AS uuid)
              AND {_CURRENT_ADMIN} {email_condition}
            """),
            {
                "subject": provider_subject,
                "emails": sorted(ADMIN_EMAILS),
                "expected_email": expected_email.lower() if expected_email else None,
            },
        )
        is True
    )


def administrator_account_access(db: Session, user_id: UUID) -> bool:
    """Check a stored account's current admin identity without granting access.

    Local profile email fields are not identity evidence. Failures propagate so a
    surrounding write cannot proceed after an unknown authorization result.
    """
    subjects = configured_admin_subjects()
    if not subjects:
        return False
    return (
        db.scalar(
            text(f"""
            SELECT true FROM public.user_account p
            JOIN public.auth_identity a ON a.user_id = p.id AND a.provider = 'supabase'
            JOIN auth.users u ON a.provider_subject = u.id::text
            WHERE p.id = :user_id AND p.is_active
              AND a.provider_subject = ANY(:subjects) AND {_CURRENT_ADMIN}
            LIMIT 1
            """),
            {
                "user_id": user_id,
                "subjects": sorted(subjects),
                "emails": sorted(ADMIN_EMAILS),
            },
        )
        is True
    )


def eligible_administrator_account_ids(db: Session) -> set[UUID]:
    """Read current administrator accounts in one query, regardless of email ambiguity."""
    subjects = configured_admin_subjects()
    if not subjects:
        return set()
    return set(
        db.scalars(
            text(f"""
        SELECT DISTINCT p.id FROM public.user_account p
        JOIN public.auth_identity a ON a.user_id = p.id AND a.provider = 'supabase'
        JOIN auth.users u ON a.provider_subject = u.id::text
        WHERE p.is_active AND a.provider_subject = ANY(:subjects) AND {_CURRENT_ADMIN}
    """),
            {"subjects": sorted(subjects), "emails": sorted(ADMIN_EMAILS)},
        )
    )


def eligible_administrator_accounts(db: Session) -> list[EligibleAdministrator]:
    """Return an unambiguous current confirmed admin email per active account.

    Skip accounts with multiple distinct eligible emails rather than guessing a
    recipient. Duplicate identities for the same email produce one recipient.
    Call again at delivery time, since eligibility and email are not permanent.
    """
    subjects = configured_admin_subjects()
    if not subjects:
        return []
    rows = db.execute(
        text(f"""
        SELECT p.id AS user_id, min(lower(u.email)) AS email
        FROM public.user_account p
        JOIN public.auth_identity a ON a.user_id = p.id AND a.provider = 'supabase'
        JOIN auth.users u ON a.provider_subject = u.id::text
        WHERE p.is_active AND a.provider_subject = ANY(:subjects) AND {_CURRENT_ADMIN}
        GROUP BY p.id HAVING count(DISTINCT lower(u.email)) = 1
        ORDER BY p.id
        """),
        {"subjects": sorted(subjects), "emails": sorted(ADMIN_EMAILS)},
    ).mappings()
    return [
        EligibleAdministrator(user_id=row["user_id"], email=row["email"])
        for row in rows
    ]


def administrator_menu_access(db: Session, provider_subject: str | None) -> bool | None:
    """Accept only the Supabase subject already verified by get_current_user.

    This hint is returned with /me, so opening a menu needs no network request.
    It grants no data access. None keeps the older capability endpoint available
    when this optional read fails, without breaking ordinary sign-in.
    """
    try:
        return administrator_subject_access(db, provider_subject)
    except SQLAlchemyError:
        db.rollback()
        return None
