"""Shared reader exclusions. These rules never grant administrator access."""

from __future__ import annotations

import os
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.orm import Session

from alethical.db.schema import load_schema

TEAM_EMAILS = frozenset(
    {
        "angelzierden@gmail.com",
        "angel@alethical.com",
        "eug@alethical.com",
        "alethicaldev@gmail.com",
        "afnetter@gmail.com",
        "joseph.fleishman@gmail.com",
    }
)


def canonical_account_email(email: str | None) -> str:
    """Normalize same-mailbox aliases for exclusion only, never authorization."""
    address = (email or "").strip().lower()
    local, separator, domain = address.rpartition("@")
    if not separator:
        return address
    local = local.split("+", 1)[0]
    if domain in {"gmail.com", "googlemail.com"}:
        domain = "gmail.com"
        local = local.replace(".", "")
    return f"{local}@{domain}"


def excluded_provider_subjects() -> set[str]:
    return {
        value.strip()
        for name in (
            "TRAFFIC_EXCLUDED_ACCOUNT_IDS",
            "ALETHICAL_TEST_ACCOUNT_IDS",
            "ALETHICAL_ADMIN_ACCOUNT_IDS",
        )
        for value in os.environ.get(name, "").split(",")
        if value.strip()
    }


def is_team_or_test(
    *,
    email: str | None,
    provider_subject: str | None = None,
    excluded: set[str] | None = None,
) -> bool:
    subjects = excluded if excluded is not None else excluded_provider_subjects()
    address = canonical_account_email(email)
    return bool(
        provider_subject in subjects
        or address in {canonical_account_email(value) for value in TEAM_EMAILS}
        or address.rpartition("@")[2]
        in {"example.com", "example.org", "example.net", "test.invalid"}
    )


def excluded_local_user_ids(db: Session, excluded: set[str] | None = None) -> set[UUID]:
    """An excluded identity excludes the entire linked Alethical account."""
    schema = load_schema()
    subjects = excluded if excluded is not None else excluded_provider_subjects()
    users = db.execute(
        select(schema.UserAccount.id, schema.UserAccount.primary_email)
    ).all()
    result = {
        user_id
        for user_id, email in users
        if is_team_or_test(email=email, excluded=subjects)
    }
    identities = db.execute(
        select(
            schema.AuthIdentity.user_id,
            schema.AuthIdentity.email,
            schema.AuthIdentity.provider_subject,
        ).where(schema.AuthIdentity.provider == "supabase")
    ).all()
    result.update(
        user_id
        for user_id, email, subject in identities
        if is_team_or_test(email=email, provider_subject=subject, excluded=subjects)
    )
    return result
