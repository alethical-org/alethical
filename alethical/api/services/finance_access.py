"""Alethical Finance's access list: who may sign in, and nothing else.

Every active entry has the same access. The list lives only in the database,
because a client's address names the client and the repository is public
(docs/architecture/alethical-finance-architecture.md §3). Addresses reach it
through ``scripts/finance_access.py``, never through a committed file.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from datetime import datetime
from uuid import UUID

from sqlalchemy import func, select, text
from sqlalchemy.orm import Session

from alethical.db.models import FinanceAccessEntry

# One "@", something on each side, a dot in the domain, no spaces. Delivery is
# Supabase's job; this only refuses what can never be a mailbox.
_ADDRESS = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


def normalize_email(raw: str) -> str:
    """The stored form of an address: trimmed and lower-cased, never an alias."""
    address = (raw or "").strip().lower()
    if len(address) > 254 or not _ADDRESS.match(address):
        raise ValueError("Not an email address")
    return address


@dataclass(frozen=True)
class FinanceAccount:
    """The signed-in Finance account. Never serialized to a Finance response."""

    provider_subject: str
    email: str
    is_alethical_team: bool


@dataclass(frozen=True)
class EntryChange:
    email: str
    change: str
    is_alethical_team: bool
    granted_at: datetime
    revoked_at: datetime | None


def _snapshot(entry: FinanceAccessEntry, change: str) -> EntryChange:
    return EntryChange(
        email=entry.email,
        change=change,
        is_alethical_team=entry.is_alethical_team,
        granted_at=entry.granted_at,
        revoked_at=entry.revoked_at,
    )


def grant(db: Session, raw_email: str, *, team: bool) -> EntryChange:
    """Add an address, or restore a revoked one, with the given team flag.

    Dates come from the database clock, so entries written from different
    machines stay in order.
    """
    email = normalize_email(raw_email)
    entry = db.scalar(
        select(FinanceAccessEntry)
        .where(FinanceAccessEntry.email == email)
        .with_for_update()
    )
    if entry is None:
        entry = FinanceAccessEntry(
            email=email, is_alethical_team=team, granted_at=func.now()
        )
        db.add(entry)
        change = "granted"
    elif entry.revoked_at is not None:
        entry.granted_at = func.now()
        entry.revoked_at = None
        entry.is_alethical_team = team
        change = "restored"
    elif entry.is_alethical_team != team:
        entry.is_alethical_team = team
        change = "team flag changed"
    else:
        change = "unchanged"
    db.flush()
    db.refresh(entry)
    return _snapshot(entry, change)


def revoke(db: Session, raw_email: str) -> EntryChange | None:
    """Revoke an address. Returns None when it was never on the list."""
    email = normalize_email(raw_email)
    entry = db.scalar(
        select(FinanceAccessEntry)
        .where(FinanceAccessEntry.email == email)
        .with_for_update()
    )
    if entry is None:
        return None
    if entry.revoked_at is not None:
        return _snapshot(entry, "already revoked")
    entry.revoked_at = func.now()
    db.flush()
    db.refresh(entry)
    return _snapshot(entry, "revoked")


def read_entry(db: Session, raw_email: str) -> EntryChange | None:
    entry = db.scalar(
        select(FinanceAccessEntry).where(
            FinanceAccessEntry.email == normalize_email(raw_email)
        )
    )
    return None if entry is None else _snapshot(entry, "read")


# The current Supabase account, read from Supabase's own records rather than
# the token or a profile field: confirmed, not deleted, not anonymous, not
# banned, and not mapped to a locked Alethical account. The same conditions
# alethical.com's administrator check uses (alethical/api/services/admin_access.py).
_CURRENT_LISTED_ACCOUNT = text("""
    SELECT lower(u.email) AS email, e.is_alethical_team
    FROM auth.users u
    JOIN public.finance_access_entry e
      ON e.email = lower(u.email) AND e.revoked_at IS NULL
    WHERE u.id = CAST(:subject AS uuid)
      AND u.deleted_at IS NULL AND NOT u.is_anonymous
      AND u.email_confirmed_at IS NOT NULL
      AND (u.banned_until IS NULL OR u.banned_until <= CURRENT_TIMESTAMP)
      AND NOT EXISTS (
        SELECT 1 FROM public.auth_identity linked
        JOIN public.user_account account ON account.id = linked.user_id
        WHERE linked.provider = 'supabase'
          AND linked.provider_subject = u.id::text AND NOT account.is_active
      )
""")

_LISTED_ADDRESS = text("""
    SELECT email, is_alethical_team FROM public.finance_access_entry
    WHERE email = :email AND revoked_at IS NULL
""")


def supabase_account_access(
    db: Session, provider_subject: str
) -> FinanceAccount | None:
    """The listed Finance account for a verified Supabase subject, or None.

    Database failures propagate, so a caller can answer "unavailable" rather
    than "no access" when the list could not be read.
    """
    try:
        subject = str(UUID(provider_subject))
    except (TypeError, ValueError):
        return None
    row = db.execute(_CURRENT_LISTED_ACCOUNT, {"subject": subject}).mappings().first()
    if row is None:
        return None
    return FinanceAccount(
        provider_subject=subject,
        email=row["email"],
        is_alethical_team=row["is_alethical_team"],
    )


def confirmed_address_access(
    db: Session, provider_subject: str, confirmed_email: str
) -> FinanceAccount | None:
    """Access for a local development identity whose address its service vouches for.

    Only ``LocalDevAuthService`` produces such an identity, and it refuses to run
    against the production database (alethical/api/services/auth.py).
    """
    try:
        email = normalize_email(confirmed_email)
    except ValueError:
        return None
    row = db.execute(_LISTED_ADDRESS, {"email": email}).mappings().first()
    if row is None:
        return None
    return FinanceAccount(
        provider_subject=provider_subject,
        email=row["email"],
        is_alethical_team=row["is_alethical_team"],
    )
