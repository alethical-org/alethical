"""Two signed-in people get two genuinely separate accounts (#13).

Google sign-in went live in July 2026, so the account tables now carry real
traffic, but every test until now authenticated as a single fake user. Nothing
exercised the case this file exists for: one person's tracked bills, chat
sessions and saved places must be invisible to everyone else.

The `/me` statements are already scoped by ``user_id``; these tests prove it
rather than trusting it, because the failure mode -- one reader seeing another
reader's rows -- is the worst bug this product can ship and the cheapest one to
regress silently.

The account model deliberately splits ``UserAccount`` (the product row that
tracked bills, chat sessions and saved places hang off) from ``AuthIdentity``
(the row keyed on provider + provider_subject), so the sign-in provider can
change without rewriting the product tables. The identity-mapping tests below
pin that split: one identity per sign-in, one user per person, and a repeat
sign-in that creates neither.
"""

from __future__ import annotations

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from alethical.api.auth import get_auth_service
from alethical.api.main import create_app
from alethical.api.services.auth import AuthenticatedPrincipal
from alethical.db.schema import load_schema
from alethical.db.session import get_engine

from fastapi.testclient import TestClient

schema = load_schema()
AuthIdentity = schema.AuthIdentity
UserAccount = schema.UserAccount

ADA_BILL = "94-2025-SF1832"
GRACE_BILL = "94-2025-HF5"


def _me(client, headers) -> dict:
    response = client.get("/api/v1/me", headers=headers)
    assert response.status_code == 200
    return response.json()["data"]


def _tracked_bill_ids(client, headers) -> set[str]:
    response = client.get("/api/v1/me/tracked-bills", headers=headers)
    assert response.status_code == 200
    return {row["bill_id"] for row in response.json()["data"]}


def _delete_accounts(*subjects: str) -> None:
    """Remove provisioning-test subjects so a test starts and ends with nothing.

    Provisioning only runs for an identity the database has never seen, so a
    test that asserts on it has to clear its own leftovers first -- otherwise it
    passes on the first run and silently tests the resolution path afterwards.

    Every identity goes before any user account. Deleting a user that still has
    an identity pointing at it makes SQLAlchemy null out that foreign key, which
    the NOT NULL constraint on ``auth_identity.user_id`` rejects.
    """
    with Session(get_engine()) as db:
        identities = db.scalars(
            select(AuthIdentity).where(
                AuthIdentity.provider == "supabase",
                AuthIdentity.provider_subject.in_(subjects),
            )
        ).all()
        user_ids = {identity.user_id for identity in identities}
        for identity in identities:
            db.delete(identity)
        db.flush()
        for user in db.scalars(
            select(UserAccount).where(UserAccount.id.in_(user_ids))
        ).all():
            db.delete(user)
        db.commit()


def _client_for(subject: str, email: str | None, *, email_verified: bool = True):
    """A TestClient whose every request authenticates as one fixed principal."""

    class FakeAuthService:
        def authenticate(self, bearer_token: str) -> AuthenticatedPrincipal:
            return AuthenticatedPrincipal(
                provider="supabase",
                provider_subject=subject,
                email=email,
                email_verified=email_verified,
            )

    app = create_app()
    app.dependency_overrides[get_auth_service] = lambda: FakeAuthService()
    return TestClient(app)


ANY_TOKEN = {"Authorization": "Bearer any"}


def test_two_sign_ins_produce_two_separate_accounts(
    client, auth_headers, second_auth_headers
):
    """Two distinct identities map to two distinct UserAccount rows."""
    ada = _me(client, auth_headers)
    grace = _me(client, second_auth_headers)

    assert ada["id"] != grace["id"]
    assert ada["primary_email"] == "ada@example.com"
    assert grace["primary_email"] == "grace@example.com"

    with Session(get_engine()) as db:
        identities = {
            identity.provider_subject: identity
            for identity in db.scalars(
                select(AuthIdentity).where(
                    AuthIdentity.provider_subject.in_(
                        ["supabase-user-ada", "supabase-user-grace"]
                    )
                )
            ).all()
        }
    assert set(identities) == {"supabase-user-ada", "supabase-user-grace"}
    assert str(identities["supabase-user-ada"].user_id) == ada["id"]
    assert str(identities["supabase-user-grace"].user_id) == grace["id"]


def test_first_sign_in_creates_one_user_and_one_identity_and_a_repeat_creates_neither():
    """Signing in twice as the same person must not fork a second account."""
    subject = "supabase-user-repeat-sign-in-13"
    _delete_accounts(subject)
    fresh = _client_for(subject, "repeat-sign-in-13@example.com")

    def _counts() -> tuple[int, int]:
        with Session(get_engine()) as db:
            return (
                db.scalar(select(func.count()).select_from(UserAccount)),
                db.scalar(select(func.count()).select_from(AuthIdentity)),
            )

    users_before, identities_before = _counts()

    first = _me(fresh, ANY_TOKEN)
    users_after_first, identities_after_first = _counts()
    assert users_after_first == users_before + 1
    assert identities_after_first == identities_before + 1

    second = _me(fresh, ANY_TOKEN)
    users_after_second, identities_after_second = _counts()
    assert second["id"] == first["id"]
    assert users_after_second == users_after_first
    assert identities_after_second == identities_after_first

    _delete_accounts(subject)


def test_a_second_identity_with_the_same_verified_email_joins_the_existing_account():
    """Same verified email, different provider subject -> one shared account.

    This pins a real decision rather than endorsing it. `alethical/api/auth.py`
    looks an existing user up by ``primary_email`` before creating a new one, so
    a person who signs in through a second provider keeps one account instead of
    silently starting an empty one. That is the intended behaviour for one
    person with two sign-in methods, and it is also the only place in the system
    where two identities can reach the same tracked bills -- so it is worth a
    test that fails loudly if the lookup is ever widened or removed.

    The match does NOT currently consult ``principal.email_verified``; see
    the unverified-email case below and #1039.
    """
    first_subject = "supabase-user-shared-email-a-13"
    second_subject = "supabase-user-shared-email-b-13"
    shared_email = "shared-email-13@example.com"
    _delete_accounts(first_subject, second_subject)

    first = _me(_client_for(first_subject, shared_email), ANY_TOKEN)
    second = _me(_client_for(second_subject, shared_email), ANY_TOKEN)

    assert second["id"] == first["id"], (
        "a second verified identity for the same email should join the existing "
        "account, not fork a new one"
    )

    with Session(get_engine()) as db:
        identity_count = db.scalar(
            select(func.count())
            .select_from(AuthIdentity)
            .where(AuthIdentity.user_id == first["id"])
        )
    assert identity_count == 2, "both identities should hang off the one account"

    _delete_accounts(first_subject, second_subject)


def test_an_unverified_email_currently_joins_an_existing_account():
    """Documents today's behaviour, which is looser than the field it ignores.

    The provisioning lookup matches on ``primary_email`` alone, so an identity
    whose email the provider has NOT confirmed still lands on the existing
    account and inherits its tracked bills. Whether a token can reach this path
    at all depends on a Supabase project setting (whether unconfirmed accounts
    may sign in) that this repository neither controls nor records, so the risk
    is real but unquantified from here.

    Left as-is deliberately: tightening it changes who can reach an existing
    account on a live auth path, which is a separate, scoped change (#1039).
    Flip this assertion when that ships.
    """
    verified_subject = "supabase-user-unverified-email-a-13"
    unverified_subject = "supabase-user-unverified-email-b-13"
    shared_email = "unverified-email-13@example.com"
    _delete_accounts(verified_subject, unverified_subject)

    established = _me(_client_for(verified_subject, shared_email), ANY_TOKEN)
    unverified = _me(
        _client_for(unverified_subject, shared_email, email_verified=False), ANY_TOKEN
    )

    assert unverified["id"] == established["id"]

    with Session(get_engine()) as db:
        identity = db.scalar(
            select(AuthIdentity).where(
                AuthIdentity.provider_subject == unverified_subject
            )
        )
        assert identity.email_verified_at is None, (
            "the identity is recorded as unverified even though it joined the "
            "account -- the join simply does not read that field"
        )

    _delete_accounts(verified_subject, unverified_subject)


def test_tracked_bills_are_visible_only_to_their_owner(
    client, auth_headers, second_auth_headers
):
    """One person's tracked bills never appear in another person's list."""
    assert (
        client.put(
            f"/api/v1/me/tracked-bills/{ADA_BILL}",
            json={"alerts_enabled": True, "note": "ada's note"},
            headers=auth_headers,
        ).status_code
        == 200
    )
    assert (
        client.put(
            f"/api/v1/me/tracked-bills/{GRACE_BILL}",
            json={"alerts_enabled": True, "note": "grace's note"},
            headers=second_auth_headers,
        ).status_code
        == 200
    )

    ada_bills = _tracked_bill_ids(client, auth_headers)
    grace_bills = _tracked_bill_ids(client, second_auth_headers)
    assert ADA_BILL in ada_bills and GRACE_BILL not in ada_bills
    assert GRACE_BILL in grace_bills and ADA_BILL not in grace_bills

    notes = {
        row["bill_id"]: row["note"]
        for row in client.get(
            "/api/v1/me/tracked-bills", headers=second_auth_headers
        ).json()["data"]
    }
    assert notes[GRACE_BILL] == "grace's note"

    # Ada cannot edit a bill only Grace tracks: the statement filters on both
    # user_id and bill_id, so there is no row to find.
    assert (
        client.patch(
            f"/api/v1/me/tracked-bills/{GRACE_BILL}",
            json={"note": "ada overwrote this"},
            headers=auth_headers,
        ).status_code
        == 404
    )

    # DELETE answers 204 either way (it is idempotent), so the check that
    # matters is that Grace's row survived Ada's attempt.
    assert (
        client.delete(
            f"/api/v1/me/tracked-bills/{GRACE_BILL}", headers=auth_headers
        ).status_code
        == 204
    )
    assert GRACE_BILL in _tracked_bill_ids(client, second_auth_headers)
    assert notes[GRACE_BILL] == "grace's note"

    client.delete(f"/api/v1/me/tracked-bills/{ADA_BILL}", headers=auth_headers)
    client.delete(f"/api/v1/me/tracked-bills/{GRACE_BILL}", headers=second_auth_headers)


def test_tracking_state_on_public_bill_lists_is_per_reader(
    client, auth_headers, second_auth_headers
):
    """`include=tracking` reports the caller's own tracking, not anyone else's."""
    assert (
        client.put(
            f"/api/v1/me/tracked-bills/{ADA_BILL}",
            json={"alerts_enabled": True, "note": None},
            headers=auth_headers,
        ).status_code
        == 200
    )

    def _detail_flag(headers) -> bool:
        response = client.get(
            f"/api/v1/bills/{ADA_BILL}",
            params={"include": "tracking"},
            headers=headers,
        )
        assert response.status_code == 200
        return response.json()["data"]["tracking"]["is_tracked"]

    def _list_flag(headers) -> bool:
        response = client.get(
            "/api/v1/bills",
            params={"session": "94-2025-regular", "include": "tracking"},
            headers=headers,
        )
        assert response.status_code == 200
        row = next(item for item in response.json()["data"] if item["id"] == ADA_BILL)
        return row["tracked"]["is_tracked"]

    # The list and the detail page load tracking through separate statements
    # (``bill_list_stmt`` and ``bill_detail_stmt``), each scoping the loader to
    # the caller's own user_id, so both are worth pinning.
    assert _detail_flag(auth_headers) is True
    assert _detail_flag(second_auth_headers) is False
    assert _list_flag(auth_headers) is True
    assert _list_flag(second_auth_headers) is False

    client.delete(f"/api/v1/me/tracked-bills/{ADA_BILL}", headers=auth_headers)


def test_chat_sessions_are_visible_only_to_their_owner(
    client, auth_headers, second_auth_headers
):
    """A chat session and its messages are unreachable to anyone but its owner."""
    created = client.post(
        "/api/v1/me/chat-sessions",
        json={"title": "Grace's private chat", "subject_bill_id": GRACE_BILL},
        headers=second_auth_headers,
    )
    assert created.status_code == 201
    session_id = created.json()["data"]["id"]

    listed_for_grace = {
        row["id"]
        for row in client.get(
            "/api/v1/me/chat-sessions", headers=second_auth_headers
        ).json()["data"]
    }
    listed_for_ada = {
        row["id"]
        for row in client.get("/api/v1/me/chat-sessions", headers=auth_headers).json()[
            "data"
        ]
    }
    assert session_id in listed_for_grace
    assert session_id not in listed_for_ada

    # Knowing the id is not enough -- every read filters on user_id too.
    assert (
        client.get(
            f"/api/v1/me/chat-sessions/{session_id}", headers=auth_headers
        ).status_code
        == 404
    )
    assert (
        client.get(
            f"/api/v1/me/chat-sessions/{session_id}/messages", headers=auth_headers
        ).status_code
        == 404
    )
    assert (
        client.post(
            f"/api/v1/me/chat-sessions/{session_id}/messages",
            json={"content": "posted into someone else's chat"},
            headers=auth_headers,
        ).status_code
        == 404
    )
    assert (
        client.get(
            f"/api/v1/me/chat-sessions/{session_id}", headers=second_auth_headers
        ).status_code
        == 200
    )


def test_saved_places_are_visible_only_to_their_owner(
    client, auth_headers, second_auth_headers
):
    """A saved home address is one of the more sensitive rows here."""
    created = client.post(
        "/api/v1/me/saved-places",
        json={"label": "Grace's home", "address_text": "1 Grace Way", "city": "Duluth"},
        headers=second_auth_headers,
    )
    assert created.status_code == 201
    place_id = created.json()["data"]["id"]

    ada_places = client.get("/api/v1/me/saved-places", headers=auth_headers).json()[
        "data"
    ]
    assert place_id not in {row["id"] for row in ada_places}
    assert "1 Grace Way" not in {row["address_text"] for row in ada_places}

    assert (
        client.patch(
            f"/api/v1/me/saved-places/{place_id}",
            json={"label": "ada renamed this"},
            headers=auth_headers,
        ).status_code
        == 404
    )

    # DELETE is idempotent and answers 204 either way; the row surviving is the
    # assertion that matters.
    assert (
        client.delete(
            f"/api/v1/me/saved-places/{place_id}", headers=auth_headers
        ).status_code
        == 204
    )
    grace_places = client.get(
        "/api/v1/me/saved-places", headers=second_auth_headers
    ).json()["data"]
    assert place_id in {row["id"] for row in grace_places}

    client.delete(f"/api/v1/me/saved-places/{place_id}", headers=second_auth_headers)


def test_notification_preferences_are_per_user(
    client, auth_headers, second_auth_headers
):
    """Turning alerts off for one person must not turn them off for another."""
    assert (
        client.put(
            "/api/v1/me/notification-preferences/email",
            json={"frequency": "daily_digest", "is_enabled": True},
            headers=auth_headers,
        ).status_code
        == 200
    )
    assert (
        client.put(
            "/api/v1/me/notification-preferences/email",
            json={"frequency": "weekly_digest", "is_enabled": False},
            headers=second_auth_headers,
        ).status_code
        == 200
    )

    def _email_preference(headers) -> dict:
        rows = client.get(
            "/api/v1/me/notification-preferences", headers=headers
        ).json()["data"]
        return next(row for row in rows if row["channel"] == "email")

    ada_preference = _email_preference(auth_headers)
    grace_preference = _email_preference(second_auth_headers)
    assert ada_preference["is_enabled"] is True
    assert ada_preference["frequency"] == "daily_digest"
    assert grace_preference["is_enabled"] is False
    assert grace_preference["frequency"] == "weekly_digest"
