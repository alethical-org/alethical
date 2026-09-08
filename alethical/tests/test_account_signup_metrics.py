"""Creation counts come from surviving account records, not confirmation or use."""

from datetime import datetime, timedelta, timezone
import json
from unittest.mock import Mock
from uuid import uuid4
from zoneinfo import ZoneInfo

import pytest
from sqlalchemy import text
from sqlalchemy.orm import Session

from alethical.api.services import account_signup_metrics as signup_metrics
from alethical.api.services.admin_accounts import ReaderAccount
from scripts.check_schema_drift import ScratchDatabase, _local_base_url


NOW = datetime(2026, 9, 7, 16, 45, tzinfo=timezone.utc)
END = NOW.replace(minute=0)


@pytest.fixture(scope="module", autouse=True)
def seed_database():
    """Only the SQL test uses a database, created and removed inside that test."""


def account(created_at, confirmed_at=NOW):
    return ReaderAccount(
        str(uuid4()),
        "private@reader.invalid",
        created_at,
        confirmed_at,
        ("email", "google"),
    )


def aggregate(monkeypatch, accounts, now=NOW):
    source = Mock(return_value=accounts)
    monkeypatch.setattr(signup_metrics, "load_reader_accounts", source)
    db = Mock(spec=Session)
    result = signup_metrics.aggregate_account_signups(db, now=now)
    source.assert_called_once_with(db)
    db.add.assert_not_called()
    db.commit.assert_not_called()
    return result


def test_creation_counts_include_pending_accounts_and_ignore_confirmation_date(
    monkeypatch,
):
    result = aggregate(
        monkeypatch,
        [
            account(END - timedelta(days=90), NOW),
            account(END - timedelta(days=2), None),
        ],
    )
    assert result["currentAccountsCreated"] == 2
    assert result["currentConfirmedAccounts"] == 1
    assert result["currentUnconfirmedAccounts"] == 1
    assert result["created7d"] == result["created30d"] == 1
    assert result["previousCreated7d"] == result["previousCreated30d"] == 0


def test_completed_hour_windows_have_exact_boundaries_and_exclude_future_creation(
    monkeypatch,
):
    dates = [
        NOW + timedelta(microseconds=1),
        NOW,
        END,
        END - timedelta(microseconds=1),
        END - timedelta(days=7),
        END - timedelta(days=7, microseconds=1),
        END - timedelta(days=14),
        END - timedelta(days=14, microseconds=1),
        END - timedelta(days=30),
        END - timedelta(days=30, microseconds=1),
        END - timedelta(days=60),
        END - timedelta(days=60, microseconds=1),
    ]
    result = aggregate(monkeypatch, [account(created) for created in dates])
    assert result["currentAccountsCreated"] == 11
    assert result["currentConfirmedAccounts"] == 11
    assert result["currentUnconfirmedAccounts"] == 0
    assert (
        result["created7d"]
        == result["previousCreated7d"]
        == result["previousCreated30d"]
        == 2
    )
    assert result["created30d"] == 6
    for days in (7, 30):
        start = END - timedelta(days=days)
        assert result[f"periods{days}d"] == {
            "startsAt": start.isoformat(),
            "endsAt": END.isoformat(),
            "previousStartsAt": (start - timedelta(days=days)).isoformat(),
            "previousEndsAt": start.isoformat(),
        }


@pytest.mark.parametrize(
    "now",
    [
        datetime(2026, 3, 8, 15, 45, tzinfo=ZoneInfo("America/Chicago")),
        datetime(2026, 11, 1, 15, 45, tzinfo=ZoneInfo("America/Chicago")),
    ],
)
def test_windows_are_utc_durations_across_clock_changes(monkeypatch, now):
    result = aggregate(monkeypatch, [], now)
    assert result["asOf"] == now.astimezone(timezone.utc).isoformat()
    for days in (7, 30):
        period = result[f"periods{days}d"]
        end = datetime.fromisoformat(period["endsAt"])
        start = datetime.fromisoformat(period["startsAt"])
        assert end - start == timedelta(days=days)
        assert end.utcoffset() == timedelta(0)
        assert end.minute == end.second == end.microsecond == 0


def test_empty_source_is_zero_and_explains_surviving_account_limit(monkeypatch):
    result = aggregate(monkeypatch, [])
    assert result["currentAccountsCreated"] == result["created7d"] == 0
    assert result["scope"] == "current_surviving_reader_accounts"
    assert (
        result["historyLimitation"]
        == "Deleted accounts are not included, so past creation totals can decrease."
    )


def test_source_failures_never_become_zero_counts(monkeypatch):
    monkeypatch.setattr(
        signup_metrics,
        "load_reader_accounts",
        Mock(side_effect=RuntimeError("source unavailable")),
    )
    with pytest.raises(RuntimeError, match="source unavailable"):
        signup_metrics.aggregate_account_signups(Mock(spec=Session), now=NOW)


def test_no_account_id_email_provider_or_individual_timestamp_leaves_aggregate(
    monkeypatch,
):
    row = account(END - timedelta(hours=9))
    result = aggregate(monkeypatch, [row])
    encoded = json.dumps(result)
    for private in (row.id, row.email, "google", row.created_at.isoformat()):
        assert private not in encoded
    assert set(result) == {
        "currentAccountsCreated",
        "currentConfirmedAccounts",
        "currentUnconfirmedAccounts",
        "created7d",
        "created30d",
        "previousCreated7d",
        "previousCreated30d",
        "periods7d",
        "periods30d",
        "asOf",
        "source",
        "scope",
        "definition",
        "historyLimitation",
    }


def test_timezone_is_required_before_reading_private_source(monkeypatch):
    source = Mock()
    monkeypatch.setattr(signup_metrics, "load_reader_accounts", source)
    with pytest.raises(ValueError, match="timezone"):
        signup_metrics.aggregate_account_signups(
            Mock(spec=Session), now=datetime(2026, 9, 7)
        )
    source.assert_not_called()


def test_real_account_source_counts_unprovisioned_pending_and_merges_linked_records(
    monkeypatch,
):
    for setting in (
        "TRAFFIC_EXCLUDED_ACCOUNT_IDS",
        "ALETHICAL_TEST_ACCOUNT_IDS",
        "ALETHICAL_ADMIN_ACCOUNT_IDS",
    ):
        monkeypatch.delenv(setting, raising=False)
    linked_user, disabled_user = uuid4(), uuid4()
    (
        linked_a,
        linked_b,
        pending,
        current_hour,
        disabled,
        deleted,
        banned,
        anonymous,
        team,
        test,
    ) = [uuid4() for _ in range(10)]
    with ScratchDatabase(_local_base_url(), "signup_metrics") as scratch:
        engine = scratch.engine()
        try:
            with engine.begin() as conn:
                for ddl in (
                    "CREATE SCHEMA auth",
                    "CREATE TABLE auth.users (id uuid PRIMARY KEY, email text, created_at timestamptz, email_confirmed_at timestamptz, banned_until timestamptz, deleted_at timestamptz, is_anonymous boolean DEFAULT false)",
                    "CREATE TABLE auth.identities (user_id uuid, provider text)",
                    "CREATE TABLE public.user_account (id uuid PRIMARY KEY, primary_email text, is_active boolean)",
                    "CREATE TABLE public.auth_identity (user_id uuid, provider text, provider_subject text, email text)",
                ):
                    conn.execute(text(ddl))
                rows = [
                    (linked_a, "reader@reader.invalid", END - timedelta(days=10), NOW),
                    (linked_b, "reader@reader.invalid", END - timedelta(days=2), NOW),
                    (pending, "pending@reader.invalid", END - timedelta(days=1), None),
                    (current_hour, "recent@reader.invalid", NOW, None),
                    (disabled, "disabled@reader.invalid", END - timedelta(days=1), NOW),
                    (deleted, "deleted@reader.invalid", END - timedelta(days=1), NOW),
                    (banned, "banned@reader.invalid", END - timedelta(days=1), NOW),
                    (
                        anonymous,
                        "anonymous@reader.invalid",
                        END - timedelta(days=1),
                        NOW,
                    ),
                    (
                        team,
                        "af.netter+metrics@googlemail.com",
                        END - timedelta(days=1),
                        NOW,
                    ),
                    (test, "test@example.com", END - timedelta(days=1), NOW),
                ]
                conn.execute(
                    text(
                        "INSERT INTO auth.users(id,email,created_at,email_confirmed_at) VALUES(:id,:email,:created,:confirmed)"
                    ),
                    [
                        {
                            "id": ident,
                            "email": email,
                            "created": created,
                            "confirmed": confirmed,
                        }
                        for ident, email, created, confirmed in rows
                    ],
                )
                conn.execute(
                    text("INSERT INTO public.user_account VALUES(:id,:email,:active)"),
                    [
                        {
                            "id": linked_user,
                            "email": "reader@reader.invalid",
                            "active": True,
                        },
                        {
                            "id": disabled_user,
                            "email": "disabled@reader.invalid",
                            "active": False,
                        },
                    ],
                )
                conn.execute(
                    text(
                        "INSERT INTO public.auth_identity VALUES(:user,'supabase',:subject,:email)"
                    ),
                    [
                        {"user": user, "subject": str(subject), "email": email}
                        for user, subject, email in (
                            (linked_user, linked_a, "reader@reader.invalid"),
                            (linked_user, linked_b, "reader@reader.invalid"),
                            (disabled_user, disabled, "disabled@reader.invalid"),
                        )
                    ],
                )
                conn.execute(
                    text("UPDATE auth.users SET deleted_at=:now WHERE id=:id"),
                    {"now": NOW, "id": deleted},
                )
                conn.execute(
                    text(
                        "UPDATE auth.users SET banned_until=CURRENT_TIMESTAMP + interval '1 day' WHERE id=:id"
                    ),
                    {"id": banned},
                )
                conn.execute(
                    text("UPDATE auth.users SET is_anonymous=true WHERE id=:id"),
                    {"id": anonymous},
                )
                conn.execute(
                    text(
                        "INSERT INTO auth.identities VALUES (:id,'google'),(:linked,'email')"
                    ),
                    {"id": linked_a, "linked": linked_b},
                )
            with Session(engine) as db:
                db.execute(text("SET TRANSACTION READ ONLY"))
                result = signup_metrics.aggregate_account_signups(db, now=NOW)
            assert result["currentAccountsCreated"] == 3
            assert result["currentConfirmedAccounts"] == 1
            assert result["currentUnconfirmedAccounts"] == 2
            assert result["created7d"] == 1
            assert result["created30d"] == 2
            assert result["previousCreated7d"] == 1
            assert result["previousCreated30d"] == 0
            assert "@" not in json.dumps(result)
            # Deletion changes retrospective surviving-account totals by design.
            with engine.begin() as conn:
                conn.execute(
                    text("DELETE FROM auth.users WHERE id=:id"), {"id": pending}
                )
            with Session(engine) as db:
                db.execute(text("SET TRANSACTION READ ONLY"))
                after = signup_metrics.aggregate_account_signups(db, now=NOW)
            assert after["currentAccountsCreated"] == 2
            assert after["created7d"] == 0
        finally:
            engine.dispose()
