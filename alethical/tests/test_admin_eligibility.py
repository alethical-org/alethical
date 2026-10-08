"""Current admin eligibility and recipient selection against isolated Postgres."""

from unittest.mock import Mock
from uuid import UUID, uuid4

import pytest
from sqlalchemy import text
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

from alethical.api.services.admin_access import (
    EligibleAdministrator,
    administrator_account_access,
    administrator_subject_access,
    eligible_administrator_account_ids,
    eligible_administrator_accounts,
)
from scripts.check_schema_drift import ScratchDatabase, _local_base_url

SUBJECT = "11111111-1111-4111-8111-111111111111"
USER_ID = UUID("22222222-2222-4222-8222-222222222222")
EMAIL = "eug@alethical.com"


@pytest.fixture(scope="module", autouse=True)
def seed_database():
    """These tests own a scratch database instead of using sample app records."""


@pytest.fixture(scope="module")
def eligibility_engine():
    with ScratchDatabase(_local_base_url(), "admin_eligibility") as scratch:
        engine = scratch.engine()
        try:
            with engine.begin() as conn:
                for ddl in (
                    "CREATE SCHEMA auth",
                    """CREATE TABLE auth.users (
                        id uuid PRIMARY KEY, email text, email_confirmed_at timestamptz,
                        banned_until timestamptz, deleted_at timestamptz,
                        is_anonymous boolean DEFAULT false)""",
                    """CREATE TABLE public.user_account (
                        id uuid PRIMARY KEY, primary_email text, is_active boolean)""",
                    """CREATE TABLE public.auth_identity (
                        user_id uuid, provider text, provider_subject text, email text)""",
                ):
                    conn.execute(text(ddl))
            yield engine
        finally:
            engine.dispose()


@pytest.fixture
def eligibility_db(eligibility_engine, monkeypatch):
    monkeypatch.setenv("ALETHICAL_ADMIN_ACCOUNT_IDS", SUBJECT)
    with eligibility_engine.connect() as conn:
        transaction = conn.begin()
        db = Session(bind=conn)
        db.execute(
            text("""INSERT INTO auth.users (id,email,email_confirmed_at)
                VALUES (:subject,:email,CURRENT_TIMESTAMP)"""),
            {"subject": SUBJECT, "email": EMAIL},
        )
        db.execute(
            text(
                "INSERT INTO public.user_account VALUES (:id,'stale@public.test',true)"
            ),
            {"id": USER_ID},
        )
        db.execute(
            text("""INSERT INTO public.auth_identity
                VALUES (:id,'supabase',:subject,'stale@public.test')"""),
            {"id": USER_ID, "subject": SUBJECT},
        )
        try:
            yield db
        finally:
            db.close()
            if transaction.is_active:
                transaction.rollback()


def test_current_confirmed_identity_not_saved_profile_email(eligibility_db):
    assert administrator_subject_access(eligibility_db, SUBJECT)
    assert administrator_subject_access(
        eligibility_db, SUBJECT, expected_email=EMAIL.upper()
    )
    assert administrator_account_access(eligibility_db, USER_ID)
    assert eligible_administrator_accounts(eligibility_db) == [
        EligibleAdministrator(USER_ID, EMAIL)
    ]
    assert not administrator_subject_access(
        eligibility_db, SUBJECT, expected_email="angel@alethical.com"
    )
    assert not administrator_account_access(eligibility_db, uuid4())


@pytest.mark.parametrize(
    "mutation",
    [
        "UPDATE auth.users SET email='public@example.test'",
        "UPDATE auth.users SET email='eug+alias@alethical.com'",
        "UPDATE auth.users SET email_confirmed_at=NULL",
        "UPDATE auth.users SET deleted_at=CURRENT_TIMESTAMP",
        "UPDATE auth.users SET banned_until=CURRENT_TIMESTAMP + interval '1 day'",
        "UPDATE auth.users SET is_anonymous=true",
        "UPDATE public.user_account SET is_active=false",
        "DELETE FROM auth.users",
    ],
)
def test_current_revocation_and_account_changes_remove_eligibility(
    eligibility_db, mutation
):
    eligibility_db.execute(text(mutation))
    assert not administrator_subject_access(eligibility_db, SUBJECT)
    assert not administrator_account_access(eligibility_db, USER_ID)
    assert eligible_administrator_accounts(eligibility_db) == []
    assert eligible_administrator_account_ids(eligibility_db) == set()


def test_allowed_email_change_is_current_and_expected_email_is_bound(eligibility_db):
    eligibility_db.execute(text("UPDATE auth.users SET email='ANGEL@alethical.com'"))
    assert not administrator_subject_access(
        eligibility_db, SUBJECT, expected_email=EMAIL
    )
    assert administrator_account_access(eligibility_db, USER_ID)
    assert eligible_administrator_accounts(eligibility_db) == [
        EligibleAdministrator(USER_ID, "angel@alethical.com")
    ]


def test_removed_subject_grant_takes_effect_immediately(eligibility_db, monkeypatch):
    assert administrator_account_access(eligibility_db, USER_ID)
    monkeypatch.setenv("ALETHICAL_ADMIN_ACCOUNT_IDS", str(uuid4()))
    assert not administrator_subject_access(eligibility_db, SUBJECT)
    assert not administrator_account_access(eligibility_db, USER_ID)
    assert eligible_administrator_accounts(eligibility_db) == []
    assert eligible_administrator_account_ids(eligibility_db) == set()


@pytest.mark.parametrize(
    "mutation",
    [
        "DELETE FROM public.auth_identity",
        "UPDATE public.auth_identity SET provider='local'",
    ],
)
def test_unmapped_provider_access_preserves_policy_but_cannot_notify(
    eligibility_db, mutation
):
    eligibility_db.execute(text(mutation))
    assert administrator_subject_access(eligibility_db, SUBJECT)
    assert not administrator_account_access(eligibility_db, USER_ID)
    assert eligible_administrator_accounts(eligibility_db) == []
    assert eligible_administrator_account_ids(eligibility_db) == set()


@pytest.mark.parametrize("configured", ["", "invalid", SUBJECT + ",invalid"])
def test_missing_or_invalid_configuration_fails_closed_without_read(
    monkeypatch, configured
):
    monkeypatch.setenv("ALETHICAL_ADMIN_ACCOUNT_IDS", configured)
    db = Mock(spec=Session)
    assert not administrator_subject_access(db, SUBJECT)
    assert not administrator_account_access(db, USER_ID)
    assert eligible_administrator_accounts(db) == []
    assert eligible_administrator_account_ids(db) == set()
    db.scalar.assert_not_called()
    db.execute.assert_not_called()


@pytest.mark.parametrize("subject", [None, "unknown", str(uuid4())])
def test_unknown_identity_is_not_eligible(monkeypatch, subject):
    monkeypatch.setenv("ALETHICAL_ADMIN_ACCOUNT_IDS", SUBJECT)
    db = Mock(spec=Session)
    assert not administrator_subject_access(db, subject)
    db.scalar.assert_not_called()


@pytest.mark.parametrize(
    "expected_email", ["", "not-approved@example.test", "eug+alias@alethical.com"]
)
def test_invalid_expected_email_does_not_query(monkeypatch, expected_email):
    monkeypatch.setenv("ALETHICAL_ADMIN_ACCOUNT_IDS", SUBJECT)
    db = Mock(spec=Session)
    assert not administrator_subject_access(db, SUBJECT, expected_email=expected_email)
    db.scalar.assert_not_called()


@pytest.mark.parametrize(
    "second_email,recipient_count", [(EMAIL.upper(), 1), ("angel@alethical.com", 0)]
)
def test_duplicate_emails_deduplicate_and_ambiguous_emails_are_skipped(
    eligibility_db, monkeypatch, second_email, recipient_count
):
    second_subject = str(uuid4())
    monkeypatch.setenv("ALETHICAL_ADMIN_ACCOUNT_IDS", f"{SUBJECT},{second_subject}")
    eligibility_db.execute(
        text("""INSERT INTO auth.users (id,email,email_confirmed_at)
            VALUES (:subject,:email,CURRENT_TIMESTAMP)"""),
        {"subject": second_subject, "email": second_email},
    )
    eligibility_db.execute(
        text(
            "INSERT INTO public.auth_identity VALUES (:id,'supabase',:subject,:email)"
        ),
        {"id": USER_ID, "subject": second_subject, "email": second_email},
    )
    assert administrator_account_access(eligibility_db, USER_ID)
    recipients = eligible_administrator_accounts(eligibility_db)
    assert eligible_administrator_account_ids(eligibility_db) == {USER_ID}
    assert len(recipients) == recipient_count
    if recipients:
        assert recipients == [EligibleAdministrator(USER_ID, EMAIL)]


def test_expired_ban_does_not_remove_eligibility(eligibility_db):
    eligibility_db.execute(
        text("UPDATE auth.users SET banned_until=CURRENT_TIMESTAMP - interval '1 day'")
    )
    assert administrator_subject_access(eligibility_db, SUBJECT)
    assert administrator_account_access(eligibility_db, USER_ID)


@pytest.mark.parametrize("operation", ["subject", "account", "recipients", "ids"])
def test_database_failure_propagates_without_rolling_back_caller_write(
    eligibility_db, monkeypatch, operation
):
    eligibility_db.execute(
        text("UPDATE public.user_account SET primary_email='saved@public.test'")
    )
    rollback = Mock(wraps=eligibility_db.rollback)
    monkeypatch.setattr(eligibility_db, "rollback", rollback)
    with pytest.raises(SQLAlchemyError):
        # A real SQL failure inside a caller-owned savepoint must not erase the
        # preceding write by rolling back the caller's entire transaction.
        with eligibility_db.begin_nested():
            eligibility_db.execute(
                text("ALTER TABLE auth.users RENAME TO unavailable_users")
            )
            if operation == "subject":
                administrator_subject_access(eligibility_db, SUBJECT)
            elif operation == "account":
                administrator_account_access(eligibility_db, USER_ID)
            elif operation == "ids":
                eligible_administrator_account_ids(eligibility_db)
            else:
                eligible_administrator_accounts(eligibility_db)
    rollback.assert_not_called()
    assert (
        eligibility_db.scalar(text("SELECT primary_email FROM public.user_account"))
        == "saved@public.test"
    )
