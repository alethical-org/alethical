"""Count surviving reader accounts using their Supabase creation dates.

This is a current inventory grouped by creation time, not gross historical
sign-ups. Removing an account can reduce an earlier period's count. Local
account provisioning and email confirmation dates never substitute for the
Supabase creation date.
"""

from datetime import datetime, timedelta, timezone
from typing import TypedDict

from sqlalchemy.orm import Session

from alethical.api.services.admin_accounts import load_reader_accounts
from alethical.api.services.site_metric_history import completed_hour


class SignupPeriod(TypedDict):
    startsAt: str
    endsAt: str
    previousStartsAt: str
    previousEndsAt: str


class AccountSignupMetrics(TypedDict):
    currentAccountsCreated: int
    currentConfirmedAccounts: int
    currentUnconfirmedAccounts: int
    created7d: int
    created30d: int
    previousCreated7d: int
    previousCreated30d: int
    periods7d: SignupPeriod
    periods30d: SignupPeriod
    asOf: str
    source: str
    scope: str
    definition: str
    historyLimitation: str


def _period(ends_at: datetime, days: int) -> SignupPeriod:
    starts_at = ends_at - timedelta(days=days)
    return {
        "startsAt": starts_at.isoformat(),
        "endsAt": ends_at.isoformat(),
        "previousStartsAt": (starts_at - timedelta(days=days)).isoformat(),
        "previousEndsAt": starts_at.isoformat(),
    }


def aggregate_account_signups(
    db: Session, *, now: datetime | None = None
) -> AccountSignupMetrics:
    """Return count-only data; source failures propagate instead of becoming 0.

    The shared reader-account source excludes deleted, banned, anonymous,
    disabled, team and test accounts and merges linked Supabase records using
    their earliest included creation date. Its eligibility reflects the current
    database state, not a historical snapshot recreated at ``now``.

    Current totals include the unfinished hour through ``now``. Creation windows
    are exact UTC durations ending at the last completed hour, with inclusive
    starts and exclusive ends. Confirmation describes current status only.
    """
    as_of = now if now is not None else datetime.now(timezone.utc)
    if as_of.tzinfo is None or as_of.utcoffset() is None:
        raise ValueError("now must include a timezone")
    as_of = as_of.astimezone(timezone.utc)
    ends_at = completed_hour(as_of)
    accounts = [row for row in load_reader_accounts(db) if row.created_at <= as_of]
    confirmed = sum(
        row.confirmed_at is not None and row.confirmed_at <= as_of for row in accounts
    )

    def created_between(starts_at: datetime, ends_at: datetime) -> int:
        return sum(starts_at <= row.created_at < ends_at for row in accounts)

    start7d = ends_at - timedelta(days=7)
    start30d = ends_at - timedelta(days=30)
    return {
        "currentAccountsCreated": len(accounts),
        "currentConfirmedAccounts": confirmed,
        "currentUnconfirmedAccounts": len(accounts) - confirmed,
        "created7d": created_between(start7d, ends_at),
        "created30d": created_between(start30d, ends_at),
        "previousCreated7d": created_between(start7d - timedelta(days=7), start7d),
        "previousCreated30d": created_between(start30d - timedelta(days=30), start30d),
        "periods7d": _period(ends_at, 7),
        "periods30d": _period(ends_at, 30),
        "asOf": as_of.isoformat(),
        "source": "supabase",
        "scope": "current_surviving_reader_accounts",
        "definition": (
            "Accounts still present, excluding deleted, deactivated, banned, "
            "anonymous, team and test accounts. Linked sign-in records count as "
            "1 account, dated by their earliest included Supabase creation record."
        ),
        "historyLimitation": (
            "Deleted accounts are not included, so past creation totals can decrease."
        ),
    }
