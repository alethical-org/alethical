"""Private administrator access and reader counts, with no database or API calls."""

from __future__ import annotations

from dataclasses import replace
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from unittest.mock import Mock
from uuid import UUID
from zoneinfo import ZoneInfo

from fastapi.testclient import TestClient
from httpx import RequestError
import pytest
from sqlalchemy.orm import Session
from supabase_auth.errors import AuthApiError, AuthInvalidJwtError, AuthRetryableError

from alethical.api.auth import get_auth_service
from alethical.api.main import create_app
from alethical.api.routers import admin
from alethical.api.services.account_classification import (
    canonical_account_email,
    excluded_local_user_ids,
    excluded_provider_subjects,
    is_team_or_test,
)
from alethical.api.services.account_signup_metrics import aggregate_account_signups
from alethical.api.services.admin_accounts import (
    AccountInventory,
    ReaderAccount,
    load_account_inventory,
    load_reader_accounts,
    search_reader_accounts,
)
from alethical.api.services.auth import AuthenticatedPrincipal, SupabaseAuthService
from alethical.db.session import get_db

ADMIN_SUBJECT = "11111111-1111-4111-8111-111111111111"
READER_SUBJECT = "22222222-2222-4222-8222-222222222222"
LOCAL_ACCOUNT = UUID("33333333-3333-4333-8333-333333333333")
HEADERS = {"Authorization": "Bearer fake-admin-token"}
NOW = datetime(2026, 9, 7, 16, tzinfo=timezone.utc)
EXCLUSION_ENV = (
    "TRAFFIC_EXCLUDED_ACCOUNT_IDS",
    "ALETHICAL_TEST_ACCOUNT_IDS",
    "ALETHICAL_ADMIN_ACCOUNT_IDS",
)
APPROVED_ADMIN_EMAILS = (
    "angelzierden@gmail.com",
    "angel@alethical.com",
    "eug@alethical.com",
    "alethicaldev@gmail.com",
    "alexia@alethical.com",
    "joe@alethical.com",
    "afnetter@gmail.com",
    "joseph.fleishman@gmail.com",
)
EXCLUSION_ONLY_EMAILS = (
    "elopinyoga@gmail.com",
    "elopinmisc@gmail.com",
    "eugenelopin@gmail.com",
    "adaonstoa@gmail.com",
    "rohan.mishra1997@gmail.com",
)


@pytest.fixture(scope="module", autouse=True)
def seed_database():
    """Override the suite's database seed: every query here has a local stand-in."""


@pytest.fixture(autouse=True)
def isolated_account_settings(monkeypatch):
    for name in EXCLUSION_ENV:
        monkeypatch.delenv(name, raising=False)
    # Errors must never send an operational report during these tests.
    monkeypatch.setattr("alethical.api.problems.capture_operational_error", Mock())


def principal(**changes):
    return replace(
        AuthenticatedPrincipal(
            provider="supabase",
            provider_subject=ADMIN_SUBJECT,
            email="eug@alethical.com",
            email_verified=True,
        ),
        **changes,
    )


@pytest.fixture
def admin_http(monkeypatch):
    monkeypatch.setenv("ALETHICAL_ADMIN_ACCOUNT_IDS", ADMIN_SUBJECT)
    service = Mock(spec=["authenticate", "resolve_confirmed_email"])
    service.authenticate.return_value = principal(email_verified=False)
    service.resolve_confirmed_email.return_value = principal()
    db = Mock(spec=Session)
    db.scalar.return_value = True
    db.execute.side_effect = AssertionError("Unexpected database query")
    app = create_app()
    app.dependency_overrides[get_auth_service] = lambda: service
    app.dependency_overrides[get_db] = lambda: db
    with TestClient(app, raise_server_exceptions=False) as client:
        yield SimpleNamespace(client=client, app=app, service=service, db=db)
    db.add.assert_not_called()
    db.commit.assert_not_called()
    db.delete.assert_not_called()


def assert_private(response):
    assert response.headers.get("cache-control") == "private, no-store"
    assert "authorization" in response.headers.get("vary", "").lower()
    assert response.headers.get("x-robots-tag") == "noindex, nofollow"


@pytest.mark.parametrize(
    "authorization", [None, "Basic fake", "Bearer", "Bearer ", "Bearer   "]
)
@pytest.mark.parametrize("path", ["/access", "/users/search"])
def test_unsigned_requests_cannot_read_accounts(admin_http, authorization, path):
    headers = {"Authorization": authorization} if authorization is not None else {}
    response = admin_http.client.request(
        "GET" if path == "/access" else "POST",
        f"/api/v1/admin{path}",
        headers=headers,
        **({"json": {}} if path == "/users/search" else {}),
    )
    assert response.status_code == 401
    assert_private(response)
    admin_http.service.authenticate.assert_not_called()
    admin_http.service.resolve_confirmed_email.assert_not_called()
    admin_http.db.scalar.assert_not_called()


@pytest.mark.parametrize("email", APPROVED_ADMIN_EMAILS)
def test_each_exact_approved_email_needs_fresh_confirmation(admin_http, email):
    admin_http.service.authenticate.return_value = principal(email="old@reader.us")
    admin_http.service.resolve_confirmed_email.return_value = principal(email=email)
    response = admin_http.client.get("/api/v1/admin/access", headers=HEADERS)
    assert response.status_code == 200
    assert response.json() == {"data": {"is_admin": True}}
    assert_private(response)
    admin_http.service.resolve_confirmed_email.assert_called_once_with(
        "fake-admin-token", admin_http.service.authenticate.return_value
    )


def test_team_exclusions_do_not_expand_the_eight_admin_grants():
    assert admin.ADMIN_EMAILS == set(APPROVED_ADMIN_EMAILS)


@pytest.mark.parametrize(
    "email",
    [
        "angel.zierden@gmail.com",
        "angelzierden+admin@gmail.com",
        "angelzierden@googlemail.com",
        "eug+admin@alethical.com",
        "alexia+admin@alethical.com",
        "al.exia@alethical.com",
        "joe+admin@alethical.com",
        "j.oe@alethical.com",
        "af.netter@gmail.com",
        "afnetter+admin@gmail.com",
        "afnetter@googlemail.com",
        "josephfleishman@gmail.com",
        "joseph.fleishman+admin@gmail.com",
        "joseph.fleishman@googlemail.com",
        *EXCLUSION_ONLY_EMAILS,
        "eug@alethical.com.attacker.us",
        " eug@alethical.com",
        "reader@reader.us",
        None,
    ],
)
def test_aliases_and_exclusion_only_emails_never_grant_admin(admin_http, email):
    admin_http.service.resolve_confirmed_email.return_value = principal(email=email)
    access = admin_http.client.get("/api/v1/admin/access", headers=HEADERS)
    search = admin_http.client.post(
        "/api/v1/admin/users/search", headers=HEADERS, json={}
    )
    assert access.json() == {"data": {"is_admin": False}}
    assert search.status_code == 403
    assert_private(access)
    assert_private(search)
    admin_http.db.scalar.assert_not_called()


@pytest.mark.parametrize(
    "identity",
    [principal(provider_subject=READER_SUBJECT), principal(provider="demo")],
)
@pytest.mark.parametrize("email", APPROVED_ADMIN_EMAILS)
def test_approved_email_alone_never_grants_admin(admin_http, identity, email):
    admin_http.service.authenticate.return_value = replace(identity, email=email)
    response = admin_http.client.get("/api/v1/admin/access", headers=HEADERS)
    assert response.json() == {"data": {"is_admin": False}}
    admin_http.service.resolve_confirmed_email.assert_not_called()
    admin_http.db.scalar.assert_not_called()


@pytest.mark.parametrize("configured_ids", ["", "not-a-uuid"])
def test_empty_or_malformed_pinned_ids_fail_closed(
    admin_http, monkeypatch, configured_ids
):
    monkeypatch.setenv("ALETHICAL_ADMIN_ACCOUNT_IDS", configured_ids)
    admin_http.service.authenticate.return_value = principal(
        provider_subject=configured_ids or ADMIN_SUBJECT
    )
    admin_http.service.resolve_confirmed_email.return_value = principal(
        provider_subject=configured_ids or ADMIN_SUBJECT
    )
    response = admin_http.client.get("/api/v1/admin/access", headers=HEADERS)
    assert response.status_code == 200
    assert response.json() == {"data": {"is_admin": False}}


@pytest.mark.parametrize(
    "confirmed",
    [
        principal(email_verified=False),
        principal(provider_subject=READER_SUBJECT),
        principal(provider="demo"),
    ],
)
def test_confirmation_must_match_the_signed_account(admin_http, confirmed):
    admin_http.service.resolve_confirmed_email.return_value = confirmed
    response = admin_http.client.get("/api/v1/admin/access", headers=HEADERS)
    assert response.json() == {"data": {"is_admin": False}}
    admin_http.db.scalar.assert_not_called()


@pytest.mark.parametrize("active", [False, None])
def test_disabled_or_missing_current_account_revokes_admin(admin_http, active):
    admin_http.db.scalar.return_value = active
    response = admin_http.client.get("/api/v1/admin/access", headers=HEADERS)
    assert response.json() == {"data": {"is_admin": False}}


def test_every_request_checks_current_email_even_with_the_same_token(admin_http):
    admin_http.service.resolve_confirmed_email.side_effect = [
        principal(),
        principal(email="changed@reader.us"),
    ]
    first = admin_http.client.get("/api/v1/admin/access", headers=HEADERS)
    second = admin_http.client.post(
        "/api/v1/admin/users/search", headers=HEADERS, json={}
    )
    assert first.json() == {"data": {"is_admin": True}}
    assert second.status_code == 403
    assert admin_http.service.resolve_confirmed_email.call_count == 2


@pytest.mark.parametrize(
    ("stage", "error", "expected_status"),
    [
        ("authenticate", ValueError("private token"), 401),
        ("authenticate", AuthInvalidJwtError("private token"), 401),
        ("authenticate", AuthApiError("private token", 401, None), 401),
        ("authenticate", AuthRetryableError("private upstream details", 503), 503),
        ("authenticate", RequestError("private connection details"), 503),
        ("authenticate", RuntimeError("private upstream details"), 503),
        ("resolve_confirmed_email", ValueError("private identity"), 401),
        (
            "resolve_confirmed_email",
            AuthApiError("private revoked identity", 401, None),
            401,
        ),
        ("resolve_confirmed_email", RuntimeError("private upstream details"), 503),
        ("local_account", RuntimeError("private database details"), 503),
        ("unconfigured", None, 503),
    ],
)
def test_identity_source_failures_are_private_and_fail_closed(
    admin_http, stage, error, expected_status
):
    if stage == "local_account":
        admin_http.db.scalar.side_effect = error
    elif stage == "unconfigured":
        admin_http.app.dependency_overrides[get_auth_service] = lambda: None
    else:
        getattr(admin_http.service, stage).side_effect = error
    response = admin_http.client.post(
        "/api/v1/admin/users/search", headers=HEADERS, json={}
    )
    assert response.status_code == expected_status
    assert "private" not in response.text
    assert "fake-admin-token" not in response.text
    assert_private(response)


def test_real_supabase_adapter_ignores_editable_metadata(admin_http):
    service = object.__new__(SupabaseAuthService)
    provider = Mock()
    service._client = SimpleNamespace(auth=provider)
    provider.get_claims.return_value = {
        "claims": {
            "sub": ADMIN_SUBJECT,
            "email": "eug@alethical.com",
            "user_metadata": {"email": "eug@alethical.com", "email_verified": True},
        }
    }
    user = SimpleNamespace(
        id=ADMIN_SUBJECT,
        email="eug@alethical.com",
        email_confirmed_at=None,
        user_metadata={"email_verified": True, "is_admin": True},
    )
    provider.get_user.return_value = SimpleNamespace(user=user)
    admin_http.app.dependency_overrides[get_auth_service] = lambda: service
    pending = admin_http.client.get("/api/v1/admin/access", headers=HEADERS)
    user.email_confirmed_at = "2026-09-01T12:00:00Z"
    confirmed = admin_http.client.get("/api/v1/admin/access", headers=HEADERS)
    user.email = "new@reader.us"
    changed = admin_http.client.get("/api/v1/admin/access", headers=HEADERS)
    assert pending.json() == {"data": {"is_admin": False}}
    assert confirmed.json() == {"data": {"is_admin": True}}
    assert changed.json() == {"data": {"is_admin": False}}
    assert provider.get_user.call_count == 3


@pytest.mark.parametrize(
    "body",
    [
        {"status": "administrator"},
        {"created_within_days": 1},
        {"offset": -1},
        {"offset": 1_000_001},
        {"limit": 0},
        {"limit": 101},
        {"query": "private-reader@reader.us" * 20},
        {"unexpected": "private-reader@reader.us"},
        {"include_excluded": True},
        {"include_team": True},
    ],
)
def test_search_validation_never_echoes_private_input(admin_http, body):
    response = admin_http.client.post(
        "/api/v1/admin/users/search", headers=HEADERS, json=body
    )
    assert response.status_code == 422
    assert "private-reader@reader.us" not in response.text
    assert_private(response)


def test_unavailable_account_records_return_a_private_service_error(
    admin_http, monkeypatch
):
    monkeypatch.setattr(
        admin,
        "load_account_inventory",
        Mock(side_effect=RuntimeError("private-reader@reader.us")),
    )
    response = admin_http.client.post(
        "/api/v1/admin/users/search", headers=HEADERS, json={}
    )
    assert response.status_code == 503
    assert "private-reader@reader.us" not in response.text
    assert_private(response)


def test_unexpected_admin_error_still_prevents_caching(admin_http, monkeypatch):
    monkeypatch.setattr(
        admin, "load_account_inventory", lambda _db: AccountInventory([], [])
    )
    monkeypatch.setattr(
        admin, "search_reader_accounts", Mock(side_effect=RuntimeError("private"))
    )
    response = admin_http.client.post(
        "/api/v1/admin/users/search", headers=HEADERS, json={}
    )
    assert response.status_code == 500
    assert "private" not in response.text
    assert_private(response)


@pytest.mark.parametrize(
    ("method", "path", "status"),
    [("GET", "/missing", 404), ("GET", "/users/search", 405)],
)
def test_admin_not_found_and_wrong_method_responses_are_private(
    admin_http, method, path, status
):
    response = admin_http.client.request(method, f"/api/v1/admin{path}")
    assert response.status_code == status
    assert_private(response)


@pytest.mark.parametrize(
    "email",
    [
        *APPROVED_ADMIN_EMAILS,
        " An.Gel.Zierden+trial@GoogleMail.com ",
        "eug+trial@alethical.com",
        "person@example.com",
        "person@example.org",
        "person@example.net",
        "person@test.invalid",
    ],
)
def test_all_team_mailboxes_aliases_and_reserved_test_domains_are_excluded(email):
    assert is_team_or_test(email=email)


@pytest.mark.parametrize(
    "email",
    [
        "reader@gmail.com",
        "eug@alethical.com.attacker.us",
        "reader@sub.example.com",
        None,
    ],
)
def test_similar_or_missing_email_does_not_invent_a_team_match(email):
    assert not is_team_or_test(email=email)


def test_gmail_alias_normalization_is_scoped_to_the_same_mailbox():
    assert canonical_account_email(" A.B+tag@GoogleMail.com ") == "ab@gmail.com"
    assert canonical_account_email(" A.B+tag@reader.us ") == "a.b@reader.us"
    assert canonical_account_email(None) == ""


@pytest.mark.parametrize("setting", EXCLUSION_ENV)
def test_each_explicit_provider_id_list_excludes_without_an_email(monkeypatch, setting):
    monkeypatch.setenv(setting, f"  {READER_SUBJECT},, {ADMIN_SUBJECT} ")
    assert excluded_provider_subjects() == {READER_SUBJECT, ADMIN_SUBJECT}
    assert is_team_or_test(email=None, provider_subject=READER_SUBJECT)
    assert not is_team_or_test(email=None, provider_subject="unlisted")


def result_rows(rows):
    return SimpleNamespace(all=lambda: rows, mappings=lambda: result_rows(rows))


def inventory_row(subject, *, email="reader@reader.us", **changes):
    return {
        "subject": subject,
        "email": email,
        "created_at": NOW - timedelta(days=2),
        "confirmed_at": NOW - timedelta(days=1),
        "user_id": None,
        "is_active": None,
        "local_email": None,
        "linked_emails": [],
        "linked_subjects": [],
        "providers": ["email"],
        **changes,
    }


def inventory_db(rows, *, local_users=(), local_identities=()):
    db = Mock(spec=Session)
    joined_rows = []
    for row in rows:
        linked = [
            identity for identity in local_identities if identity[0] == row["user_id"]
        ]
        local = dict(local_users).get(row["user_id"], row["local_email"])
        joined_rows.append(
            {
                **row,
                "local_email": local,
                "linked_emails": [email for _, email, _ in linked]
                or row["linked_emails"],
                "linked_subjects": [subject for _, _, subject in linked]
                or row["linked_subjects"],
            }
        )
    db.execute.side_effect = [result_rows(joined_rows)]
    return db


def test_local_exclusions_include_primary_email_and_any_linked_identity():
    primary = UUID("44444444-4444-4444-8444-444444444444")
    alias = UUID("55555555-5555-4555-8555-555555555555")
    explicit = UUID("66666666-6666-4666-8666-666666666666")
    db = Mock(spec=Session)
    db.execute.side_effect = [
        result_rows(
            [(primary, "eug@alethical.com"), (LOCAL_ACCOUNT, "reader@reader.us")]
        ),
        result_rows(
            [
                (alias, "josephfleishman+test@gmail.com", "alias-subject"),
                (explicit, None, READER_SUBJECT),
                (LOCAL_ACCOUNT, "reader@reader.us", "ordinary"),
            ]
        ),
    ]
    assert excluded_local_user_ids(db, {READER_SUBJECT}) == {primary, alias, explicit}


def test_linked_sign_in_methods_count_once_with_authoritative_dates():
    rows = [
        inventory_row(
            "later",
            user_id=LOCAL_ACCOUNT,
            providers=["google"],
            email="current@reader.us",
            confirmed_at=NOW - timedelta(days=1),
        ),
        inventory_row(
            "earliest",
            user_id=LOCAL_ACCOUNT,
            providers=["email", "google"],
            email="pending@reader.us",
            created_at=NOW - timedelta(days=10),
            confirmed_at=None,
        ),
        inventory_row(
            "middle",
            user_id=LOCAL_ACCOUNT,
            providers=["email"],
            created_at=NOW - timedelta(days=3),
            confirmed_at=NOW - timedelta(days=2),
        ),
    ]
    accounts = load_reader_accounts(inventory_db(rows))
    assert accounts == [
        ReaderAccount(
            id=str(LOCAL_ACCOUNT),
            email="reader@reader.us",
            created_at=NOW - timedelta(days=10),
            confirmed_at=NOW - timedelta(days=2),
            sign_in_methods=("email", "google"),
        )
    ]
    assert (
        search_reader_accounts(accounts, now=NOW)["summary"]["confirmed_accounts"] == 1
    )


@pytest.mark.parametrize(
    "exclusion",
    ["provider_email", "local_email", "linked_email", "linked_id", "inactive"],
)
def test_any_excluded_identity_hides_the_whole_local_account(exclusion, monkeypatch):
    rows = [
        inventory_row("visible-looking", user_id=LOCAL_ACCOUNT),
        inventory_row("linked", user_id=LOCAL_ACCOUNT, email="linked@reader.us"),
        inventory_row("independent", email="independent@reader.us"),
    ]
    local_users = []
    local_identities = []
    if exclusion == "provider_email":
        rows[1]["email"] = "afnetter+trial@gmail.com"
    elif exclusion == "local_email":
        local_users = [(LOCAL_ACCOUNT, "angel@alethical.com")]
    elif exclusion == "linked_email":
        local_identities = [(LOCAL_ACCOUNT, "joseph.fleishman@gmail.com", "old-link")]
    elif exclusion == "linked_id":
        monkeypatch.setenv("TRAFFIC_EXCLUDED_ACCOUNT_IDS", "old-link")
        local_identities = [(LOCAL_ACCOUNT, "ordinary@reader.us", "old-link")]
    else:
        rows[1]["is_active"] = False
    inventory = load_account_inventory(
        inventory_db(rows, local_users=local_users, local_identities=local_identities)
    )
    accounts = inventory.included
    assert [a.id for a in accounts] == ["independent"]
    assert [a.id for a in inventory.excluded] == (
        [] if exclusion == "inactive" else [str(LOCAL_ACCOUNT)]
    )
    hidden_search = search_reader_accounts(accounts, query="reader@reader.us", now=NOW)
    assert hidden_search["page"]["total"] == 0
    assert hidden_search["summary"]["confirmed_accounts"] == 1


def test_exclusions_happen_before_counts_search_and_paging(monkeypatch):
    monkeypatch.setenv("ALETHICAL_TEST_ACCOUNT_IDS", "explicit-test")
    rows = [inventory_row(str(i), email="eug+test@alethical.com") for i in range(30)]
    rows.extend(
        [
            inventory_row("explicit-test"),
            inventory_row("pending", email="pending@reader.us", confirmed_at=None),
            inventory_row("confirmed", email="confirmed@reader.us"),
        ]
    )
    accounts = load_reader_accounts(inventory_db(rows))
    page = search_reader_accounts(accounts, now=NOW, limit=1)
    assert page["summary"] == {
        "confirmed_accounts": 1,
        "pending_accounts": 1,
        "confirmed_today": 0,
        "confirmed_7d": 1,
        "confirmed_30d": 1,
    }
    assert page["page"] == {"offset": 0, "limit": 1, "total": 2, "has_more": True}
    assert page["data"][0]["id"] == "pending"
    assert search_reader_accounts(accounts, now=NOW, query="eug")["data"] == []


def account(identifier, *, email=None, created_at=NOW, confirmed_at=NOW):
    return ReaderAccount(identifier, email, created_at, confirmed_at, ("email",))


def test_pending_linked_account_stays_pending_and_unlinked_accounts_remain_distinct():
    rows = [
        inventory_row("linked-a", user_id=LOCAL_ACCOUNT, confirmed_at=None),
        inventory_row("linked-b", user_id=LOCAL_ACCOUNT, confirmed_at=None),
        inventory_row("unlinked-a", confirmed_at=None),
        inventory_row("unlinked-b", confirmed_at=None),
    ]
    accounts = load_reader_accounts(inventory_db(rows))
    assert {a.id for a in accounts} == {str(LOCAL_ACCOUNT), "unlinked-a", "unlinked-b"}
    assert all(a.confirmed_at is None for a in accounts)
    assert search_reader_accounts(accounts, now=NOW)["summary"]["pending_accounts"] == 3


@pytest.mark.parametrize(
    "now",
    [
        datetime(2026, 1, 7, 7, tzinfo=timezone.utc),
        datetime(2026, 9, 7, 6, tzinfo=timezone.utc),
        datetime(2026, 3, 8, 18, tzinfo=timezone.utc),
        datetime(2026, 11, 1, 18, tzinfo=timezone.utc),
    ],
)
def test_today_starts_at_minnesota_midnight_including_clock_change_days(now):
    midnight = now.astimezone(ZoneInfo("America/Chicago")).replace(
        hour=0, minute=0, second=0, microsecond=0
    )
    midnight = midnight.astimezone(timezone.utc)
    accounts = [
        account("before", confirmed_at=midnight - timedelta(microseconds=1)),
        account("midnight", confirmed_at=midnight),
        account("now", confirmed_at=now),
        account("future", confirmed_at=now + timedelta(microseconds=1)),
    ]
    assert search_reader_accounts(accounts, now=now)["summary"]["confirmed_today"] == 2


def test_rolling_summary_windows_include_exact_boundaries_and_exclude_future_dates():
    dates = [
        NOW,
        NOW - timedelta(days=7),
        NOW - timedelta(days=7, microseconds=1),
        NOW - timedelta(days=30),
        NOW - timedelta(days=30, microseconds=1),
        NOW + timedelta(microseconds=1),
        None,
    ]
    summary = search_reader_accounts(
        [account(str(i), confirmed_at=value) for i, value in enumerate(dates)], now=NOW
    )["summary"]
    assert summary == {
        "confirmed_accounts": 6,
        "pending_accounts": 1,
        "confirmed_today": 1,
        "confirmed_7d": 2,
        "confirmed_30d": 4,
    }


def test_search_filters_and_pages_keep_global_summary_unchanged():
    accounts = [
        account("old", email="old@reader.us", created_at=NOW - timedelta(days=31)),
        account("a", email="MATCH@reader.us", created_at=NOW - timedelta(days=7)),
        account("b", email="match@reader.us", created_at=NOW - timedelta(days=7)),
        account("pending", email="match@reader.us", confirmed_at=None),
        account("missing-email", confirmed_at=None),
    ]
    baseline = search_reader_accounts(accounts, now=NOW)
    result = search_reader_accounts(
        accounts,
        query=" MATCH ",
        status="confirmed",
        created_within_days=7,
        offset=1,
        limit=1,
        now=NOW,
    )
    assert [row["id"] for row in result["data"]] == ["a"]
    assert result["page"] == {"offset": 1, "limit": 1, "total": 2, "has_more": False}
    assert result["summary"] == baseline["summary"]
    pending = search_reader_accounts(accounts, status="pending", query="match", now=NOW)
    assert [row["id"] for row in pending["data"]] == ["pending"]
    empty = search_reader_accounts(accounts, offset=99, now=NOW)
    assert empty["data"] == []
    assert empty["page"]["total"] == 5
    assert not empty["page"]["has_more"]


@pytest.mark.parametrize("days", [7, 30])
def test_signup_filter_uses_creation_time_and_includes_exact_boundary(days):
    boundary = NOW - timedelta(days=days)
    accounts = [
        account("just-outside", created_at=boundary - timedelta(microseconds=1)),
        account("boundary", created_at=boundary, confirmed_at=None),
        account("inside", created_at=boundary + timedelta(microseconds=1)),
    ]
    result = search_reader_accounts(accounts, created_within_days=days, now=NOW)
    assert [row["id"] for row in result["data"]] == ["inside", "boundary"]
    assert result["summary"]["confirmed_accounts"] == 2
    assert result["summary"]["pending_accounts"] == 1


def test_admin_search_returns_only_account_fields_and_uses_body_filters(
    admin_http, monkeypatch
):
    records = [
        account("match", email="find@reader.us"),
        account("other", email="other@reader.us"),
    ]
    monkeypatch.setattr(
        admin, "load_account_inventory", lambda db: AccountInventory(records, [])
    )
    response = admin_http.client.post(
        "/api/v1/admin/users/search",
        headers=HEADERS,
        json={"query": "find@", "status": "confirmed", "offset": 0, "limit": 1},
    )
    assert response.status_code == 200
    assert_private(response)
    payload = response.json()
    assert set(payload) == {"data", "summary", "page", "as_of", "excluded_accounts"}
    assert payload["excluded_accounts"] == []
    assert [row["id"] for row in payload["data"]] == ["match"]
    assert set(payload["data"][0]) == {
        "id",
        "email",
        "created_at",
        "confirmed_at",
        "sign_in_methods",
    }
    assert payload["page"] == {"offset": 0, "limit": 1, "total": 1, "has_more": False}
    assert payload["summary"]["confirmed_accounts"] == 2


@pytest.mark.parametrize("email", (*APPROVED_ADMIN_EMAILS, *EXCLUSION_ONLY_EMAILS))
def test_team_mailboxes_and_aliases_stay_out_of_reader_results_and_metrics(email):
    local, domain = email.split("@")
    aliases = [
        email,
        f"{local}+preview@{domain}",
    ]
    if domain == "gmail.com":
        aliases.extend(
            [
                f"{local.replace('.', '')}@gmail.com",
                f"{'.'.join(local.replace('.', ''))}@googlemail.com",
            ]
        )
    rows = [
        inventory_row(f"team-{index}", email=alias)
        for index, alias in enumerate(aliases)
    ]
    rows.append(inventory_row("reader", email="person@reader.us"))
    db = inventory_db(rows)

    inventory = load_account_inventory(db)

    assert [a.id for a in inventory.included] == ["reader"]
    assert {a.email for a in inventory.excluded} == set(aliases)
    assert db.execute.call_count == 1
    assert [a.id for a in load_reader_accounts(inventory_db(rows))] == ["reader"]
    search = search_reader_accounts(inventory.included, now=NOW)
    assert search["summary"]["confirmed_accounts"] == 1
    assert search["page"]["total"] == 1
    assert [row["id"] for row in search["data"]] == ["reader"]
    for alias in aliases:
        assert (
            search_reader_accounts(inventory.included, query=alias, now=NOW)["data"]
            == []
        )
    metrics = aggregate_account_signups(inventory_db(rows), now=NOW)
    assert metrics["currentAccountsCreated"] == 1
    assert metrics["currentConfirmedAccounts"] == 1
    assert metrics["currentUnconfirmedAccounts"] == 0
    assert metrics["created7d"] == metrics["created30d"] == 1


def test_inactive_team_account_is_absent_from_both_inventory_lists():
    inventory = load_account_inventory(
        inventory_db(
            [
                inventory_row(
                    "disabled", email=EXCLUSION_ONLY_EMAILS[0], is_active=False
                ),
                inventory_row("active", email=EXCLUSION_ONLY_EMAILS[1]),
            ]
        )
    )
    assert inventory.included == []
    assert [a.id for a in inventory.excluded] == ["active"]


@pytest.mark.parametrize(
    "filters",
    [
        {},
        {"query": "no-match", "status": "pending", "created_within_days": 7},
        {"offset": 25, "limit": 1},
    ],
)
def test_excluded_account_list_is_independent_of_reader_filters_and_paging(
    admin_http, monkeypatch, filters
):
    rows = [
        inventory_row("reader", email="person@reader.us"),
        inventory_row("team", email=EXCLUSION_ONLY_EMAILS[0]),
        inventory_row(
            "pending-team", email=EXCLUSION_ONLY_EMAILS[1], confirmed_at=None
        ),
    ]
    db = inventory_db(rows)
    loader = Mock(side_effect=lambda _db: load_account_inventory(db))
    monkeypatch.setattr(admin, "load_account_inventory", loader)

    response = admin_http.client.post(
        "/api/v1/admin/users/search", headers=HEADERS, json=filters
    )

    assert response.status_code == 200
    assert_private(response)
    payload = response.json()
    assert payload["excluded_accounts"] == [
        {"id": "pending-team", "email": EXCLUSION_ONLY_EMAILS[1]},
        {"id": "team", "email": EXCLUSION_ONLY_EMAILS[0]},
    ]
    assert payload["summary"]["confirmed_accounts"] == 1
    assert payload["summary"]["pending_accounts"] == 0
    assert all(row["id"] == "reader" for row in payload["data"])
    assert payload["page"]["total"] == (0 if "query" in filters else 1)
    loader.assert_called_once_with(admin_http.db)
    assert db.execute.call_count == 1


def test_ordinary_account_cannot_read_the_separate_excluded_list(
    admin_http, monkeypatch
):
    admin_http.service.authenticate.return_value = principal(
        provider_subject=READER_SUBJECT
    )
    loader = Mock()
    monkeypatch.setattr(admin, "load_account_inventory", loader)
    response = admin_http.client.post(
        "/api/v1/admin/users/search", headers=HEADERS, json={}
    )
    assert response.status_code == 403
    assert "excluded_accounts" not in response.json()
    loader.assert_not_called()
    assert_private(response)
