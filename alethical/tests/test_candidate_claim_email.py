"""Real database coverage for private claim mail; provider calls are always fake."""

from datetime import date, timedelta
from uuid import uuid4

import httpx
import pytest
from sqlalchemy import delete, func, select, text

from alethical.api.services import candidate_claim_email as service
from alethical.db.models import (
    AuthIdentity,
    CandidateClaim,
    CandidateClaimEmailDelivery,
    CandidateClaimEvent,
    CandidateRecord,
    UserAccount,
)
from alethical.db.session import get_session_factory


@pytest.fixture(autouse=True)
def safe_mail(monkeypatch, seed_database):
    for key, value in {
        "ALETHICAL_PROFILE_CLAIM_EMAIL_ENABLED": "true",
        "ALETHICAL_EMAIL_ENABLED": "true",
        "ALETHICAL_EMAIL_TRANSPORT": "resend",
        "RESEND_API_KEY": "fake-provider-key",
    }.items():
        monkeypatch.setenv(key, value)
    monkeypatch.delenv("ALETHICAL_EMAIL_ALLOWLIST", raising=False)
    monkeypatch.setattr(service, "REQUEST_SPACING", 0)

    def no_network(*args, **kwargs):
        raise AssertionError("A test attempted real email delivery")

    monkeypatch.setattr(service.httpx, "post", no_network)


@pytest.fixture
def delivery(monkeypatch):
    applicant, actor, admin = uuid4(), uuid4(), uuid4()
    subjects = {key: uuid4() for key in (applicant, actor, admin)}
    candidate_id = uuid4().hex * 2
    emails = {
        applicant: "campaign@example.org",
        actor: "eug@alethical.com",
        admin: "angel@alethical.com",
    }
    factory = get_session_factory()
    with factory() as db:
        db.execute(text("CREATE SCHEMA IF NOT EXISTS auth"))
        db.execute(
            text("""CREATE TABLE IF NOT EXISTS auth.users (
            id uuid PRIMARY KEY, email text, email_confirmed_at timestamptz,
            deleted_at timestamptz, banned_until timestamptz,
            is_anonymous boolean NOT NULL DEFAULT false)""")
        )
        for user_id, subject in subjects.items():
            db.add(
                UserAccount(
                    id=user_id,
                    primary_email=f"old-{user_id}@example.org",
                    display_name="Example Admin" if user_id == actor else None,
                    is_active=True,
                )
            )
            db.flush()
            db.add(
                AuthIdentity(
                    user_id=user_id,
                    provider="supabase",
                    provider_subject=str(subject),
                    email="old@example.org",
                    email_verified_at=service._now(),
                )
            )
            db.execute(
                text(
                    "INSERT INTO auth.users(id,email,email_confirmed_at) VALUES(:id,:email,CURRENT_TIMESTAMP)"
                ),
                {"id": subject, "email": emails[user_id]},
            )
        db.add(
            CandidateRecord(
                id=candidate_id,
                election_id="example",
                election_date=date(2030, 11, 5),
                public_payload={},
                source_sha256="a" * 64,
                checked_at=service._now(),
            )
        )
        db.flush()
        claim = CandidateClaim(
            candidate_id=candidate_id,
            user_id=applicant,
            status="approved",
            evidence_url="https://private.example.org",
            request_note="PRIVATE APPLICANT EXPLANATION",
            version=1,
        )
        db.add(claim)
        db.commit()
        claim_id = claim.id
    monkeypatch.setenv(
        "ALETHICAL_ADMIN_ACCOUNT_IDS",
        ",".join(str(subjects[x]) for x in (actor, admin)),
    )

    def queue(kind="approved", recipient_kind="applicant", recipient=None):
        with factory() as db:
            version = (
                db.scalar(
                    select(func.count())
                    .select_from(CandidateClaimEvent)
                    .where(CandidateClaimEvent.claim_id == claim_id)
                )
                + 1
            )
            event = CandidateClaimEvent(
                claim_id=claim_id,
                kind=kind,
                claim_version=version,
                actor_id=actor,
                evidence_url="PRIVATE EVIDENCE",
                request_note="PRIVATE APPLICANT EXPLANATION",
                review_note="PRIVATE REVIEW NOTE",
                candidate_snapshot={
                    "candidate_id": candidate_id,
                    "candidate_name": "Example Candidate",
                    "office": "School Board Member",
                    "voting_area": "Example School District",
                    "election_name": "State general election",
                    "election_date": "2030-11-05",
                },
            )
            db.add(event)
            db.flush()
            row = CandidateClaimEmailDelivery(
                event_id=event.id,
                user_id=recipient
                or (applicant if recipient_kind == "applicant" else admin),
                recipient_kind=recipient_kind,
                next_attempt_at=service._now() - timedelta(seconds=1),
            )
            db.add(row)
            db.commit()
            return row.id

    yield dict(
        queue=queue,
        applicant=applicant,
        actor=actor,
        admin=admin,
        subjects=subjects,
        claim_id=claim_id,
        candidate_id=candidate_id,
        emails=emails,
    )
    with factory() as db:
        db.execute(delete(AuthIdentity).where(AuthIdentity.user_id.in_(subjects)))
        db.execute(delete(UserAccount).where(UserAccount.id.in_(subjects)))
        db.execute(delete(CandidateRecord).where(CandidateRecord.id == candidate_id))
        db.execute(
            text("DELETE FROM auth.users WHERE id::text = ANY(:ids)"),
            {"ids": [str(x) for x in subjects.values()]},
        )
        db.commit()


def saved(row_id):
    with get_session_factory()() as db:
        return db.get(CandidateClaimEmailDelivery, row_id)


def due(row_id):
    with get_session_factory()() as db:
        db.get(CandidateClaimEmailDelivery, row_id).next_attempt_at = db.scalar(
            select(func.now())
        ) - timedelta(seconds=1)
        db.commit()


def accepted(monkeypatch):
    calls = []

    def post(url, **kwargs):
        calls.append((url, kwargs))
        return httpx.Response(200, json={"id": "fake-provider-message"})

    monkeypatch.setattr(service.httpx, "post", post)
    return calls


@pytest.mark.parametrize(
    "kind,recipient",
    [
        ("submitted", "admin"),
        ("resubmitted", "admin"),
        *[
            (k, r)
            for k in ("approved", "rejected", "revoked")
            for r in ("admin", "applicant")
        ],
    ],
)
def test_all_eight_messages_have_exact_identity_and_no_private_evidence(
    monkeypatch, delivery, kind, recipient
):
    row_id = delivery["queue"](kind, recipient)
    calls = accepted(monkeypatch)
    assert service.drain_once() == 1
    assert saved(row_id).state == "sent"
    assert saved(row_id).message_payload is None
    assert len(calls) == 1
    payload = calls[0][1]["json"]
    assert payload["to"] == [
        delivery["emails"][
            delivery["applicant" if recipient == "applicant" else "admin"]
        ]
    ]
    assert payload["reply_to"] == "ask@alethical.com"
    for field in ("text", "html"):
        assert "Example Candidate" in payload[field]
        assert "November 5, 2030" in payload[field]
        assert "PRIVATE" not in payload[field]
        assert "old@example.org" not in payload[field]
    destination = (
        f"/admin/candidate-claims?claim={delivery['claim_id']}"
        if recipient == "admin"
        else f"/candidates/{delivery['candidate_id']}/"
        + ("manage" if kind == "approved" else "claim")
    )
    assert destination in payload["text"]
    assert calls[0][1]["headers"]["Idempotency-Key"] == f"profile-claim-email/{row_id}"
    assert service.drain_once() == 0
    assert len(calls) == 1


@pytest.mark.parametrize(
    "key,value",
    [
        ("ALETHICAL_PROFILE_CLAIM_EMAIL_ENABLED", "false"),
        ("ALETHICAL_EMAIL_ENABLED", "false"),
        ("ALETHICAL_EMAIL_TRANSPORT", "console"),
        ("RESEND_API_KEY", ""),
    ],
)
def test_delivery_gates_preserve_pending(monkeypatch, delivery, key, value):
    row_id = delivery["queue"]()
    monkeypatch.setenv(key, value)
    assert service.drain_once() == 0
    assert saved(row_id).state == "pending"
    assert saved(row_id).attempted_at is None


@pytest.mark.parametrize(
    "change", ["inactive", "unconfirmed", "deleted", "banned", "anonymous", "missing"]
)
def test_current_recipient_eligibility_is_required(monkeypatch, delivery, change):
    row_id = delivery["queue"]()
    with get_session_factory()() as db:
        if change == "inactive":
            db.get(UserAccount, delivery["applicant"]).is_active = False
        else:
            assignments = {
                "unconfirmed": "email_confirmed_at=NULL",
                "deleted": "deleted_at=CURRENT_TIMESTAMP",
                "banned": "banned_until=CURRENT_TIMESTAMP+interval '1 day'",
                "anonymous": "is_anonymous=true",
            }
            command = (
                "DELETE FROM auth.users WHERE id=:id"
                if change == "missing"
                else f"UPDATE auth.users SET {assignments[change]} WHERE id=:id"
            )
            db.execute(
                text(command), {"id": delivery["subjects"][delivery["applicant"]]}
            )
        db.commit()
    calls = accepted(monkeypatch)
    assert service.drain_once() == 0
    assert calls == []
    assert saved(row_id).state == "cancelled"


def test_deciding_admin_is_not_a_recipient(monkeypatch, delivery):
    row_id = delivery["queue"]("approved", "admin", delivery["actor"])
    calls = accepted(monkeypatch)
    assert service.drain_once() == 0
    assert calls == [] and saved(row_id).state == "cancelled"


def test_removed_admin_is_not_a_recipient(monkeypatch, delivery):
    row_id = delivery["queue"]("submitted", "admin")
    monkeypatch.setenv(
        "ALETHICAL_ADMIN_ACCOUNT_IDS", str(delivery["subjects"][delivery["actor"]])
    )
    assert service.drain_once() == 0
    assert saved(row_id).state == "cancelled"


def uncertain(monkeypatch):
    calls = []

    def post(url, **kwargs):
        calls.append(kwargs)
        raise httpx.ReadTimeout("simulated unknown outcome")

    monkeypatch.setattr(service.httpx, "post", post)
    return calls


def test_unknown_send_retries_identical_payload_and_key(monkeypatch, delivery):
    row_id = delivery["queue"]()
    calls = uncertain(monkeypatch)
    assert service.drain_once() == 0
    assert saved(row_id).attempt_count == 1
    due(row_id)
    service.drain_once()
    assert len(calls) == 2
    assert calls[0]["json"] == calls[1]["json"]
    assert calls[0]["headers"] == calls[1]["headers"]


@pytest.mark.parametrize("attempted", [False, True])
def test_deleted_reviewer_clears_prepared_name_while_sender_is_off(
    monkeypatch, delivery, attempted
):
    row_id = delivery["queue"]("approved", "admin")
    if attempted:
        uncertain(monkeypatch)
        service.drain_once()
    else:
        with get_session_factory()() as db:
            assert service._prepare(db, db.get(CandidateClaimEmailDelivery, row_id))
            db.commit()
    before = saved(row_id)
    assert "Example Admin" in before.message_payload["text"]
    monkeypatch.setenv("ALETHICAL_PROFILE_CLAIM_EMAIL_ENABLED", "false")
    with get_session_factory()() as db:
        db.execute(
            delete(AuthIdentity).where(AuthIdentity.user_id == delivery["actor"])
        )
        db.execute(delete(UserAccount).where(UserAccount.id == delivery["actor"]))
        db.commit()
    after = saved(row_id)
    assert after.message_payload is None
    assert after.state == ("cancelled" if attempted else "pending")
    assert (after.id, after.attempt_count, after.attempted_at) == (
        before.id,
        before.attempt_count,
        before.attempted_at,
    )
    calls = accepted(monkeypatch)
    assert service.drain_once() == 0
    assert calls == []
    monkeypatch.setenv("ALETHICAL_PROFILE_CLAIM_EMAIL_ENABLED", "true")
    due(row_id)
    assert service.drain_once() == (0 if attempted else 1)
    if attempted:
        assert calls == []
    else:
        assert "Reviewed by: an administrator" in calls[0][1]["json"]["text"]
        assert "Example Admin" not in calls[0][1]["json"]["text"]


@pytest.mark.parametrize("response", ["timeout", "server_error", "accepted"])
def test_reviewer_deletion_during_send_cannot_restart_cancelled_delivery(
    monkeypatch, delivery, response
):
    row_id = delivery["queue"]("approved", "admin")
    calls = []

    def delete_during_send(url, **kwargs):
        calls.append(kwargs)
        with get_session_factory()() as db:
            db.execute(
                delete(AuthIdentity).where(AuthIdentity.user_id == delivery["actor"])
            )
            db.execute(delete(UserAccount).where(UserAccount.id == delivery["actor"]))
            db.commit()
        if response == "timeout":
            raise httpx.ReadTimeout("simulated unknown outcome")
        return httpx.Response(
            200 if response == "accepted" else 503,
            json={"id": "fake-provider-message"},
        )

    monkeypatch.setattr(service.httpx, "post", delete_during_send)
    assert service.drain_once() == 0
    row = saved(row_id)
    assert row.state == "cancelled"
    assert row.message_payload is None
    assert row.attempt_count == 1
    due(row_id)
    assert service.drain_once() == 0
    assert len(calls) == 1


@pytest.mark.parametrize("change", ["email", "actor", "expired"])
def test_unknown_send_never_changes_payload_or_outlives_provider_key(
    monkeypatch, delivery, change
):
    row_id = delivery["queue"]("approved", "admin")
    calls = uncertain(monkeypatch)
    service.drain_once()
    with get_session_factory()() as db:
        row = db.get(CandidateClaimEmailDelivery, row_id)
        if change == "email":
            db.execute(
                text(
                    "UPDATE auth.users SET email='angelzierden@gmail.com' WHERE id=:id"
                ),
                {"id": delivery["subjects"][delivery["admin"]]},
            )
        elif change == "actor":
            db.execute(
                delete(AuthIdentity).where(AuthIdentity.user_id == delivery["actor"])
            )
            db.execute(delete(UserAccount).where(UserAccount.id == delivery["actor"]))
        else:
            row.attempted_at = service._now() - timedelta(hours=23)
        row.next_attempt_at = service._now() - timedelta(seconds=1)
        db.commit()
    service.drain_once()
    assert len(calls) == 1
    assert saved(row_id).state == ("uncertain" if change == "expired" else "cancelled")
    assert saved(row_id).message_payload is None


def test_allowlist_keeps_delivery_pending(monkeypatch, delivery):
    row_id = delivery["queue"]()
    monkeypatch.setenv("ALETHICAL_EMAIL_ALLOWLIST", "someone@example.org")
    assert service.drain_once() == 0
    assert saved(row_id).state == "pending"
    assert saved(row_id).attempted_at is None


def test_account_deletion_during_send_does_not_recreate_private_delivery(
    monkeypatch, delivery
):
    row_id = delivery["queue"]()

    def post(url, **kwargs):
        with get_session_factory()() as db:
            db.execute(
                delete(AuthIdentity).where(
                    AuthIdentity.user_id == delivery["applicant"]
                )
            )
            db.execute(
                delete(UserAccount).where(UserAccount.id == delivery["applicant"])
            )
            db.commit()
        return httpx.Response(200, json={"id": "fake-provider-message"})

    monkeypatch.setattr(service.httpx, "post", post)
    assert service.drain_once() == 0
    assert saved(row_id) is None
    with get_session_factory()() as db:
        assert db.get(CandidateRecord, delivery["candidate_id"]) is not None
        assert db.get(CandidateClaim, delivery["claim_id"]) is None


@pytest.mark.parametrize(
    "status,body,expected",
    [
        (400, {"name": "validation_error"}, "failed"),
        (401, {"name": "missing_api_key"}, "failed"),
        (409, {"name": "invalid_idempotent_request"}, "failed"),
        (409, {"name": "concurrent_idempotent_requests"}, "pending"),
        (408, {}, "pending"),
        (429, {}, "pending"),
        (500, {}, "pending"),
        (200, {}, "pending"),
    ],
)
def test_provider_failures_keep_decision_and_bound_retry_state(
    monkeypatch, delivery, status, body, expected
):
    row_id = delivery["queue"]()
    monkeypatch.setattr(
        service.httpx, "post", lambda *args, **kwargs: httpx.Response(status, json=body)
    )
    assert service.drain_once() == 0
    row = saved(row_id)
    assert row.state == expected
    assert row.attempt_count == 1
    assert (row.message_payload is None) == (expected == "failed")
    with get_session_factory()() as db:
        assert db.get(CandidateClaim, delivery["claim_id"]).status == "approved"
        assert db.get(CandidateClaimEvent, row.event_id).kind == "approved"


def test_parallel_drains_send_one_message(monkeypatch, delivery):
    from concurrent.futures import ThreadPoolExecutor
    from threading import Event

    row_id = delivery["queue"]()
    entered, release = Event(), Event()
    calls = []

    def post(*args, **kwargs):
        calls.append(kwargs)
        entered.set()
        assert release.wait(5)
        return httpx.Response(200, json={"id": "one-delivery"})

    monkeypatch.setattr(service.httpx, "post", post)
    with ThreadPoolExecutor(max_workers=2) as pool:
        first = pool.submit(service.drain_once)
        try:
            assert entered.wait(5)
            assert pool.submit(service.drain_once).result(timeout=5) == 0
        finally:
            release.set()
        assert first.result(timeout=5) == 1
    assert len(calls) == 1 and saved(row_id).state == "sent"


def test_success_followed_by_database_failure_reuses_exact_delivery_key(
    monkeypatch, delivery
):
    from sqlalchemy.exc import SQLAlchemyError
    from sqlalchemy.orm import Session

    row_id = delivery["queue"]()
    original = Session.commit
    fail = {"next_commit": False, "once": True}
    calls = []

    def post(*args, **kwargs):
        calls.append(kwargs)
        if fail["once"]:
            fail["next_commit"] = True
        return httpx.Response(200, json={"id": "one-provider-message"})

    def commit(db):
        if fail["next_commit"]:
            fail["next_commit"] = False
            fail["once"] = False
            raise SQLAlchemyError("simulated saved-result failure")
        return original(db)

    monkeypatch.setattr(service.httpx, "post", post)
    monkeypatch.setattr(Session, "commit", commit)
    with pytest.raises(SQLAlchemyError):
        service.drain_once()
    assert saved(row_id).state == "sending"
    assert saved(row_id).attempt_count == 1
    due(row_id)
    assert service.drain_once() == 1
    assert len(calls) == 2
    assert (
        calls[0]["headers"]["Idempotency-Key"] == calls[1]["headers"]["Idempotency-Key"]
    )
    assert calls[0]["json"] == calls[1]["json"]


def test_eligibility_loss_between_preparation_and_send_cancels(monkeypatch, delivery):
    row_id = delivery["queue"]()
    with get_session_factory()() as db:
        row = db.get(CandidateClaimEmailDelivery, row_id)
        assert service._prepare(db, row)
        db.commit()
    with get_session_factory()() as db:
        db.get(UserAccount, delivery["applicant"]).is_active = False
        db.commit()
    calls = accepted(monkeypatch)
    with get_session_factory()() as db:
        service._attempt(db, db.get(CandidateClaimEmailDelivery, row_id))
        db.commit()
    assert calls == [] and saved(row_id).state == "cancelled"
    assert saved(row_id).message_payload is None


def test_email_change_before_first_attempt_uses_current_confirmed_address(
    monkeypatch, delivery
):
    row_id = delivery["queue"]()
    with get_session_factory()() as db:
        assert service._prepare(db, db.get(CandidateClaimEmailDelivery, row_id))
        db.commit()
    with get_session_factory()() as db:
        db.execute(
            text("UPDATE auth.users SET email='current@example.org' WHERE id=:id"),
            {"id": delivery["subjects"][delivery["applicant"]]},
        )
        db.commit()
    calls = accepted(monkeypatch)
    with get_session_factory()() as db:
        service._attempt(db, db.get(CandidateClaimEmailDelivery, row_id))
        db.commit()
    assert calls[0][1]["json"]["to"] == ["current@example.org"]
    assert saved(row_id).state == "sent"


def test_ambiguous_current_applicant_email_cancels(monkeypatch, delivery):
    row_id = delivery["queue"]()
    second_id = uuid4()
    with get_session_factory()() as db:
        db.execute(
            text(
                "INSERT INTO auth.users(id,email,email_confirmed_at) VALUES(:id,'different@example.org',CURRENT_TIMESTAMP)"
            ),
            {"id": second_id},
        )
        db.add(
            AuthIdentity(
                user_id=delivery["applicant"],
                provider="supabase",
                provider_subject=str(second_id),
                email="different@example.org",
                email_verified_at=service._now(),
            )
        )
        db.commit()
    try:
        calls = accepted(monkeypatch)
        assert service.drain_once() == 0
        assert calls == [] and saved(row_id).state == "cancelled"
    finally:
        with get_session_factory()() as db:
            db.execute(
                delete(AuthIdentity).where(
                    AuthIdentity.provider_subject == str(second_id)
                )
            )
            db.execute(text("DELETE FROM auth.users WHERE id=:id"), {"id": second_id})
            db.commit()


def test_new_recipient_cannot_bypass_allowlist_after_preparation(monkeypatch, delivery):
    row_id = delivery["queue"]()
    monkeypatch.setenv(
        "ALETHICAL_EMAIL_ALLOWLIST", delivery["emails"][delivery["applicant"]]
    )
    with get_session_factory()() as db:
        assert service._prepare(db, db.get(CandidateClaimEmailDelivery, row_id))
        db.commit()
    with get_session_factory()() as db:
        db.execute(
            text(
                "UPDATE auth.users SET email='outside-allowlist@example.org' WHERE id=:id"
            ),
            {"id": delivery["subjects"][delivery["applicant"]]},
        )
        db.commit()
    calls = accepted(monkeypatch)
    with get_session_factory()() as db:
        service._attempt(db, db.get(CandidateClaimEmailDelivery, row_id))
        db.commit()
    assert calls == []
    assert saved(row_id).state == "pending"
    assert saved(row_id).attempt_count == 0


def test_allowlist_hold_does_not_retain_expired_uncertain_payload(
    monkeypatch, delivery
):
    row_id = delivery["queue"]()
    calls = uncertain(monkeypatch)
    service.drain_once()
    with get_session_factory()() as db:
        row = db.get(CandidateClaimEmailDelivery, row_id)
        row.attempted_at = service._now() - timedelta(hours=23)
        db.commit()
    due(row_id)
    monkeypatch.setenv("ALETHICAL_EMAIL_ALLOWLIST", "someone-else@example.org")
    service.drain_once()
    assert len(calls) == 1
    assert saved(row_id).state == "uncertain"
    assert saved(row_id).message_payload is None
