"""Minimal current account inventory from Supabase's authoritative records."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

from sqlalchemy import text
from sqlalchemy.orm import Session

from alethical.api.services.account_classification import (
    excluded_provider_subjects,
    is_team_or_test,
)


@dataclass(frozen=True)
class ReaderAccount:
    id: str
    email: str | None
    created_at: datetime
    confirmed_at: datetime | None
    sign_in_methods: tuple[str, ...]


@dataclass(frozen=True)
class AccountInventory:
    included: list[ReaderAccount]
    excluded: list[ReaderAccount]


def load_account_inventory(db: Session) -> AccountInventory:
    # Deliberately omit tokens, passwords, user metadata and activity history.
    # Product created_at is first API provisioning, not Supabase signup time.
    rows = (
        db.execute(
            text("""
        SELECT u.id::text AS subject, u.email, u.created_at,
               u.email_confirmed_at AS confirmed_at,
               a.user_id, p.is_active, p.primary_email AS local_email,
               ARRAY(SELECT linked.email FROM public.auth_identity linked
                     WHERE linked.provider = 'supabase'
                       AND linked.user_id = a.user_id) AS linked_emails,
               ARRAY(SELECT linked.provider_subject FROM public.auth_identity linked
                     WHERE linked.provider = 'supabase'
                       AND linked.user_id = a.user_id) AS linked_subjects,
               ARRAY(SELECT DISTINCT i.provider FROM auth.identities i
                     WHERE i.user_id = u.id ORDER BY i.provider) AS providers
        FROM auth.users u
        LEFT JOIN public.auth_identity a
          ON a.provider = 'supabase' AND a.provider_subject = u.id::text
        LEFT JOIN public.user_account p ON p.id = a.user_id
        WHERE u.deleted_at IS NULL AND NOT u.is_anonymous
          AND (u.banned_until IS NULL OR u.banned_until <= CURRENT_TIMESTAMP)
        """)
        )
        .mappings()
        .all()
    )
    subjects = excluded_provider_subjects()
    groups: dict[str, list] = {}
    excluded_groups: set[str] = set()
    inactive_groups: set[str] = set()
    for row in rows:
        key = str(row["user_id"] or row["subject"])
        groups.setdefault(key, []).append(row)
        if row["is_active"] is False:
            inactive_groups.add(key)
        if (
            is_team_or_test(
                email=row["email"], provider_subject=row["subject"], excluded=subjects
            )
            or is_team_or_test(email=row["local_email"], excluded=subjects)
            or any(
                is_team_or_test(email=email, excluded=subjects)
                for email in row["linked_emails"]
            )
            or subjects.intersection(row["linked_subjects"])
        ):
            excluded_groups.add(key)
    included = []
    excluded = []
    for key, members in groups.items():
        if key in inactive_groups:
            continue
        members.sort(key=lambda row: (row["created_at"], row["subject"]))
        confirmed = [row for row in members if row["confirmed_at"] is not None]
        display = confirmed[0] if confirmed else members[0]
        destination = excluded if key in excluded_groups else included
        destination.append(
            ReaderAccount(
                id=key,
                email=display["email"],
                created_at=members[0]["created_at"],
                confirmed_at=min(row["confirmed_at"] for row in confirmed)
                if confirmed
                else None,
                sign_in_methods=tuple(
                    sorted({method for row in members for method in row["providers"]})
                ),
            )
        )
    excluded.sort(key=lambda account: ((account.email or "").casefold(), account.id))
    return AccountInventory(included=included, excluded=excluded)


def load_reader_accounts(db: Session) -> list[ReaderAccount]:
    """Shared metrics source, with team and test accounts always left out."""
    return load_account_inventory(db).included


def search_reader_accounts(
    accounts: list[ReaderAccount],
    *,
    query: str = "",
    status: str = "all",
    created_within_days: int | None = None,
    offset: int = 0,
    limit: int = 25,
    now: datetime | None = None,
) -> dict:
    now = now or datetime.now(timezone.utc)
    today = now.astimezone(ZoneInfo("America/Chicago")).replace(
        hour=0, minute=0, second=0, microsecond=0
    )
    confirmations = [a.confirmed_at for a in accounts if a.confirmed_at is not None]
    summary = {
        "confirmed_accounts": len(confirmations),
        "pending_accounts": len(accounts) - len(confirmations),
        "confirmed_today": sum(today <= value <= now for value in confirmations),
        "confirmed_7d": sum(
            now - timedelta(days=7) <= value <= now for value in confirmations
        ),
        "confirmed_30d": sum(
            now - timedelta(days=30) <= value <= now for value in confirmations
        ),
    }
    query = query.strip().casefold()
    filtered = [
        a
        for a in accounts
        if query in (a.email or "").casefold()
        and (status == "all" or (a.confirmed_at is not None) == (status == "confirmed"))
        and (
            created_within_days is None
            or a.created_at >= now - timedelta(days=created_within_days)
        )
    ]
    filtered.sort(key=lambda a: (a.created_at, a.id), reverse=True)
    return {
        "data": [
            {
                "id": a.id,
                "email": a.email,
                "created_at": a.created_at.isoformat(),
                "confirmed_at": a.confirmed_at.isoformat() if a.confirmed_at else None,
                "sign_in_methods": list(a.sign_in_methods),
            }
            for a in filtered[offset : offset + limit]
        ],
        "summary": summary,
        "page": {
            "offset": offset,
            "limit": limit,
            "total": len(filtered),
            "has_more": offset + limit < len(filtered),
        },
        "as_of": now.isoformat(),
    }
