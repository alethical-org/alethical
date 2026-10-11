"""Private claim history, admin eligibility and queued notifications use real Postgres."""

from concurrent.futures import ThreadPoolExecutor
from datetime import date, datetime, timedelta, timezone
from threading import Barrier
from typing import cast
from uuid import UUID, uuid4

import pytest
from fastapi import HTTPException
from sqlalchemy import delete, event, func, select, text
from sqlalchemy.exc import SQLAlchemyError

from alethical.api.routers.admin import administrator_access
from alethical.api.services import candidate_claims as service
from alethical.db.models import (
    AuthIdentity,
    CandidateClaim,
    CandidateClaimEmailDelivery,
    CandidateClaimEvent,
    CandidateRecord,
    UserAccount,
)
from alethical.db.session import get_session_factory
from scripts.check_schema_drift import ScratchDatabase, _local_base_url
from alethical.tests.test_candidates_migration import migrate
from alethical.tests.test_candidate_claims import (
    ADMIN,
    BASE,
    CANDIDATE,
    FIRST,
    SECOND,
    REVIEWER,
    account,
    apply,
    approved,
    claim,
    public,
    review,
    statement,
    clean,  # noqa: F401 - shared autouse fixture owns cleanup and fake authentication
)


def withdraw(client, item):
    response = client.post(
        f"{BASE}/{item['id']}/withdraw",
        headers=FIRST,
        json={
            "expected_account_id": account(client),
            "expected_version": item["version"],
        },
    )
    assert response.status_code == 200, response.text
    return response.json()["claim"]


def admin_detail(client, item):
    client.app.dependency_overrides[administrator_access] = lambda: True
    response = client.get(f"{ADMIN}/{item['id']}", headers=REVIEWER)
    assert response.status_code == 200, response.text
    return response.json()["claim"]


@pytest.fixture
def grant_admin(client, monkeypatch):
    subjects = []
    identity_ids = []
    with get_session_factory()() as db:
        db.execute(text("CREATE SCHEMA IF NOT EXISTS auth"))
        db.execute(
            text("""CREATE TABLE IF NOT EXISTS auth.users (
            id uuid PRIMARY KEY, email text, email_confirmed_at timestamptz,
            deleted_at timestamptz, banned_until timestamptz,
            is_anonymous boolean NOT NULL DEFAULT false)""")
        )
        db.commit()

    def grant(user_id, email):
        subject = uuid4()
        with get_session_factory()() as db:
            db.execute(
                text("""INSERT INTO auth.users (id,email,email_confirmed_at)
                VALUES (:id,:email,CURRENT_TIMESTAMP)"""),
                {"id": subject, "email": email},
            )
            identity = AuthIdentity(
                user_id=UUID(str(user_id)),
                provider="supabase",
                provider_subject=str(subject),
                email=email,
                email_verified_at=datetime.now(timezone.utc),
            )
            db.add(identity)
            db.flush()
            identity_ids.append(identity.id)
            db.commit()
        subjects.append(str(subject))
        monkeypatch.setenv("ALETHICAL_ADMIN_ACCOUNT_IDS", ",".join(subjects))
        return subject

    yield grant
    with get_session_factory()() as db:
        db.execute(delete(AuthIdentity).where(AuthIdentity.id.in_(identity_ids)))
        if subjects:
            db.execute(
                text("DELETE FROM auth.users WHERE id::text = ANY(:subjects)"),
                {"subjects": subjects},
            )
        db.commit()


def test_all_seven_events_preserve_evidence_and_give_up_distinction(client):
    first = claim(client)
    initial_note = first["request_note"]
    initial_url = first["evidence_url"]
    item = review(client, first).json()["claim"]
    assert item["has_published_statement"] is False
    assert statement(client, item).status_code == 200
    assert admin_detail(client, item)["has_published_statement"] is True
    item = withdraw(client, item)
    assert admin_detail(client, item)["has_published_statement"] is False
    assert item["last_event_kind"] == "given_up"
    assert item["statement_removed"] is True
    resubmitted = apply(
        client,
        version=item["version"],
        evidence_url="https://example.org/new",
        request_note="Authorized campaign representative\n\nContact the campaign to confirm my authorization",
    ).json()["claim"]
    rejected = review(client, resubmitted, action="reject").json()["claim"]
    resubmitted = apply(client, version=rejected["version"]).json()["claim"]
    reapproved = review(client, resubmitted).json()["claim"]
    revoked = review(client, reapproved, action="revoke").json()["claim"]
    resubmitted = apply(client, version=revoked["version"]).json()["claim"]
    withdrawn = withdraw(client, resubmitted)
    assert withdrawn["last_event_kind"] == "withdrawn"
    assert withdrawn["statement_removed"] is False
    history = admin_detail(client, withdrawn)
    assert history["history_complete"] is True
    events = history["history"]
    assert {row["kind"] for row in events} == {
        "submitted",
        "resubmitted",
        "withdrawn",
        "given_up",
        "approved",
        "rejected",
        "revoked",
    }
    assert events[-1]["request_note"] == initial_note
    assert events[-1]["evidence_url"] == initial_url
    assert events[-1]["review_note"] is None
    assert events[-2]["identity_verified"] is True
    rejection = next(row for row in events if row["kind"] == "rejected")
    assert rejection["request_note"].startswith(
        "Authorized campaign representative\n\n"
    )
    assert rejection["evidence_url"] == "https://example.org/new"
    assert rejection["review_note"]
    assert [row["claim_version"] for row in events] == list(range(len(events), 0, -1))
    latest_submission = next(
        row for row in events if row["kind"] in {"submitted", "resubmitted"}
    )
    assert history["submitted_at"] == latest_submission["created_at"]
    assert public(client).json() == {"statement": None}


def test_giving_up_without_published_statement_does_not_claim_removal(client):
    item = approved(client)
    withdrawn = withdraw(client, item)
    assert withdrawn["statement_removed"] is False
    assert admin_detail(client, withdrawn)["history"][0]["statement_removed"] is False


def test_pending_retry_is_immutable_and_never_queues_a_second_event(client):
    item = claim(client)
    response = apply(
        client,
        version=item["version"],
        evidence_url="https://different.example.org",
        request_note="Candidate\n\nA different explanation must not replace pending evidence",
    )
    assert response.status_code == 200
    assert response.json()["already_submitted"] is True
    assert response.json()["claim"]["request_note"] == item["request_note"]
    assert response.json()["claim"]["evidence_url"] == item["evidence_url"]
    with get_session_factory()() as db:
        assert db.scalar(select(func.count()).select_from(CandidateClaimEvent)) == 1


@pytest.mark.parametrize(
    "note,reason",
    [
        ("Historical unlabelled note must not establish a new role", "role_required"),
        ("Candidate\n\nShort explanation", "explanation_too_short"),
        ("Authorized campaign representative\n\n" + "x" * 1901, "explanation_too_long"),
    ],
)
def test_new_requests_require_explicit_role_and_bounded_explanation(
    client, note, reason
):
    response = apply(client, request_note=note)
    assert response.status_code == 422
    assert response.json()["reason"] == reason
    assert response.json()["detail"]


def test_admin_cannot_claim_edit_withdraw_or_be_approved_but_history_survives(
    client, grant_admin
):
    item = approved(client)
    assert statement(client, item).status_code == 200
    grant_admin(account(client), "eug@alethical.com")
    assert public(client).json() == {"statement": None}
    response = statement(client, item, version=1)
    assert response.status_code == 403
    assert response.json()["reason"] == "applicant_is_admin"
    assert (
        apply(client, version=item["version"]).json()["reason"] == "applicant_is_admin"
    )
    assert (
        client.get(f"{BASE}/{item['id']}/statement", headers=FIRST).status_code == 403
    )
    assert (
        client.post(
            f"{BASE}/{item['id']}/withdraw",
            headers=FIRST,
            json={
                "expected_account_id": account(client),
                "expected_version": item["version"],
            },
        ).status_code
        == 403
    )
    mine = client.get(f"{BASE}/me?candidate_id={CANDIDATE}", headers=FIRST).json()
    assert mine["is_admin"] is True
    assert mine["request_eligibility"] == {
        "allowed": False,
        "reason": "applicant_is_admin",
    }
    assert mine["claims"][0]["can_manage"] is False
    assert len(admin_detail(client, item)["history"]) == 2
    assert review(client, item, action="revoke").status_code == 200


def test_pending_admin_applicant_is_blocked_even_with_ambiguous_admin_email(
    client, grant_admin
):
    item = claim(client)
    grant_admin(account(client), "eug@alethical.com")
    grant_admin(account(client), "angel@alethical.com")
    blocked = admin_detail(client, item)
    assert blocked["approval_block"]["reason"] == "applicant_is_admin"
    assert blocked["applicant_is_admin"] is True
    assert review(client, item).json()["reason"] == "applicant_is_admin"
    assert review(client, item, action="reject").status_code == 200


def test_decisions_queue_account_ids_and_exclude_deciding_admin(client, grant_admin):
    reviewer_id = UUID(account(client, REVIEWER))
    other_admin_id = UUID(account(client, SECOND))
    grant_admin(reviewer_id, "eug@alethical.com")
    grant_admin(other_admin_id, "angel@alethical.com")
    item = claim(client)
    approved_item = review(client, item).json()["claim"]
    assert approved_item["status"] == "approved"
    with get_session_factory()() as db:
        events = db.scalars(
            select(CandidateClaimEvent).order_by(CandidateClaimEvent.claim_version)
        ).all()
        submitted, decision = events
        rows = db.scalars(select(CandidateClaimEmailDelivery)).all()
        submitted_rows = [row for row in rows if row.event_id == submitted.id]
        decision_rows = [row for row in rows if row.event_id == decision.id]
        assert {(row.user_id, row.recipient_kind) for row in submitted_rows} == {
            (reviewer_id, "admin"),
            (other_admin_id, "admin"),
        }
        assert {(row.user_id, row.recipient_kind) for row in decision_rows} == {
            (UUID(account(client)), "applicant"),
            (other_admin_id, "admin"),
        }
        assert all(
            row.message_payload is None and row.state == "pending" for row in rows
        )
        assert len(rows) == len({(row.event_id, row.user_id) for row in rows})


def test_event_or_queue_failure_rolls_back_the_entire_decision(client, monkeypatch):
    item = claim(client)
    real = service.record_event

    def fail_after_queue(*args, **kwargs):
        real(*args, **kwargs)
        raise SQLAlchemyError("private simulated delivery storage failure")

    monkeypatch.setattr(service, "record_event", fail_after_queue)
    response = review(client, item)
    assert response.status_code == 503
    assert "private simulated" not in response.text
    with get_session_factory()() as db:
        row = db.get(CandidateClaim, UUID(item["id"]))
        assert row.status == "pending" and row.version == 1
        assert db.scalar(select(func.count()).select_from(CandidateClaimEvent)) == 1
        assert (
            db.scalar(select(func.count()).select_from(CandidateClaimEmailDelivery))
            == 0
        )


def test_admin_list_filter_page_count_and_older_history_gap(client):
    item = claim(client)
    with get_session_factory()() as db:
        candidate = db.get(CandidateRecord, CANDIDATE)
        candidate.election_date = date.today() - timedelta(days=2)
        for number in range(29):
            user = UserAccount(
                primary_email=f"claim-list-{uuid4()}@example.org", is_active=True
            )
            db.add(user)
            db.flush()
            db.add(
                CandidateClaim(
                    candidate_id=CANDIDATE,
                    user_id=user.id,
                    evidence_url="https://example.org",
                    request_note="Old unlabelled evidence remains unchanged",
                    status="pending",
                    created_at=datetime.now(timezone.utc) + timedelta(seconds=number),
                )
            )
        db.commit()
    client.app.dependency_overrides[administrator_access] = lambda: True
    assert (
        client.get(f"{ADMIN}/pending-count", headers=REVIEWER).json()["pending_count"]
        == 30
    )
    response = client.get(f"{ADMIN}?candidate_id={CANDIDATE}", headers=REVIEWER)
    assert response.status_code == 200
    first = response.json()
    assert len(first["claims"]) == 25 and first["has_more"]
    assert first["candidate"]["candidate_id"] == CANDIDATE
    assert all(row["election_ended"] for row in first["claims"])
    assert all(
        row["approval_block"]["reason"] == "election_ended" for row in first["claims"]
    )
    second = client.get(
        f"{ADMIN}?candidate_id={CANDIDATE}&offset=25", headers=REVIEWER
    ).json()
    assert len(second["claims"]) == 5 and not second["has_more"]
    historical = admin_detail(client, second["claims"][0])
    assert historical["history"] == [] and historical["history_complete"] is False
    assert historical["request_note"] == "Old unlabelled evidence remains unchanged"
    assert client.get(f"{ADMIN}?limit=100", headers=REVIEWER).status_code == 422
    assert (
        client.get(f"{ADMIN}?candidate_id={'f' * 64}", headers=REVIEWER).json()[
            "reason"
        ]
        == "candidate_unavailable"
    )
    assert (
        client.get(f"{ADMIN}/{uuid4()}", headers=REVIEWER).json()["reason"]
        == "profile_claim_unavailable"
    )
    assert admin_detail(client, item)["official_checked_at"]


def test_queue_read_count_does_not_grow_with_number_of_requests(client):
    claim(client)
    claim(client, SECOND)
    with get_session_factory()() as db:
        statements = []

        def count(conn, cursor, sql, parameters, context, executemany):
            statements.append(sql)

        connection = db.connection()
        event.listen(connection, "before_cursor_execute", count)
        try:
            service.queue(db, status="all", offset=0, limit=1)
            single_count = len(statements)
            statements.clear()
            service.queue(db, status="all", offset=0, limit=25)
            assert len(statements) == single_count
        finally:
            event.remove(connection, "before_cursor_execute", count)


def test_decision_history_is_admin_only_and_errors_are_private(client):
    item = approved(client)
    client.app.dependency_overrides[administrator_access] = lambda: False
    assert client.get(f"{ADMIN}/{item['id']}", headers=FIRST).status_code == 403
    assert client.get(f"{ADMIN}/pending-count", headers=FIRST).status_code == 403
    mine = client.get(f"{BASE}/me", headers=FIRST)
    assert "no-store" in mine.headers["cache-control"]
    for row in mine.json()["claims"]:
        assert (
            not {"history", "review_note", "actor_id", "account_email", "user_id"}
            & row.keys()
        )
    assert client.get(f"{BASE}/me", headers=SECOND).json()["claims"] == []
    assert public(client).json() == {"statement": None}


def test_simultaneous_decisions_save_one_outcome_and_one_decision_event(client):
    item = claim(client)
    reviewer_id = UUID(account(client, REVIEWER))
    barrier = Barrier(2)

    def decide(action):
        with get_session_factory()() as db:
            reviewer = db.get(UserAccount, reviewer_id)
            barrier.wait(timeout=10)
            try:
                service.review(
                    db,
                    reviewer,
                    claim_id=UUID(item["id"]),
                    action=action,
                    review_note="Independent campaign authority check completed",
                    identity_verified=True,
                    expected_version=item["version"],
                    expected_account_id=reviewer_id,
                )
                return 200
            except HTTPException as error:
                db.rollback()
                assert cast(dict, error.detail)["reason"] == "profile_claim_changed"
                return error.status_code

    with ThreadPoolExecutor(max_workers=2) as pool:
        assert sorted(pool.map(decide, ["approve", "reject"])) == [200, 409]
    with get_session_factory()() as db:
        assert db.scalar(select(func.count()).select_from(CandidateClaimEvent)) == 2
        assert (
            db.scalar(select(func.count()).select_from(CandidateClaimEmailDelivery))
            == 1
        )


def test_account_deletion_cascades_private_events_deliveries_and_preserves_official_record(
    client,
):
    item = review(client, claim(client, SECOND)).json()["claim"]
    actor_id = UUID(account(client, REVIEWER))
    owner_id = UUID(account(client, SECOND))
    with get_session_factory()() as db:
        # Auth identity removal mirrors the existing account-deletion ordering.
        db.execute(delete(AuthIdentity).where(AuthIdentity.user_id == actor_id))
        db.execute(delete(UserAccount).where(UserAccount.id == actor_id))
        db.commit()
        approval = db.scalar(
            select(CandidateClaimEvent).where(CandidateClaimEvent.kind == "approved")
        )
        assert approval.actor_id is None
        assert not any(
            "actor" in key or "reviewer" in key for key in approval.candidate_snapshot
        )
        db.execute(delete(AuthIdentity).where(AuthIdentity.user_id == owner_id))
        db.execute(delete(UserAccount).where(UserAccount.id == owner_id))
        db.commit()
        assert db.get(CandidateClaim, UUID(item["id"])) is None
        assert db.scalar(select(func.count()).select_from(CandidateClaimEvent)) == 0
        assert (
            db.scalar(select(func.count()).select_from(CandidateClaimEmailDelivery))
            == 0
        )
        assert db.get(CandidateRecord, CANDIDATE) is not None


def test_expired_election_keeps_approved_management_but_stops_new_review(client):
    item = approved(client)
    with get_session_factory()() as db:
        db.get(CandidateRecord, CANDIDATE).election_date = date.today() - timedelta(
            days=2
        )
        db.commit()
    mine = client.get(f"{BASE}/me?candidate_id={CANDIDATE}", headers=FIRST).json()
    assert mine["claims"][0]["can_manage"] is True
    assert statement(client, item).status_code == 200
    withdrawn = withdraw(client, item)
    assert withdrawn["can_request_review"] is False
    assert (
        apply(client, version=withdrawn["version"]).json()["reason"] == "election_ended"
    )


def test_official_record_age_read_does_not_mark_it_fresh(client):
    item = claim(client)
    checked = datetime.now(timezone.utc) - timedelta(days=2)
    with get_session_factory()() as db:
        db.get(CandidateRecord, CANDIDATE).checked_at = checked
        db.commit()
    detail = admin_detail(client, item)
    assert detail["official_checked_at"] == checked.isoformat()
    assert detail["approval_block"]["reason"] == "official_record_stale"
    response = review(client, item)
    assert response.status_code == 409
    assert response.json()["reason"] == "official_record_stale"
    assert admin_detail(client, item)["official_checked_at"] == checked.isoformat()


@pytest.mark.parametrize(
    "block", ["identity_mismatch", "election_mismatch", "candidate_missing"]
)
def test_official_identity_block_stops_requests_and_approval_but_keeps_management(
    client, block
):
    item = approved(client)
    with get_session_factory()() as db:
        db.get(CandidateRecord, CANDIDATE).claim_source_block = block
        db.commit()
    mine = client.get(f"{BASE}/me?candidate_id={CANDIDATE}", headers=FIRST).json()
    assert mine["request_eligibility"] == {
        "allowed": False,
        "reason": "official_record_unavailable",
    }
    assert mine["claims"][0]["can_manage"] is True
    assert statement(client, item).status_code == 200
    assert apply(client, SECOND).json()["reason"] == "official_record_mismatch"
    withdrawn = withdraw(client, item)
    assert withdrawn["can_request_review"] is False
    assert apply(client, version=withdrawn["version"]).status_code == 409
    with get_session_factory()() as db:
        db.get(CandidateRecord, CANDIDATE).claim_source_block = None
        db.commit()
    pending = apply(client, version=withdrawn["version"]).json()["claim"]
    with get_session_factory()() as db:
        db.get(CandidateRecord, CANDIDATE).claim_source_block = block
        db.commit()
    assert (
        admin_detail(client, pending)["approval_block"]["reason"]
        == "official_record_mismatch"
    )
    assert review(client, pending).json()["reason"] == "official_record_mismatch"


@pytest.mark.parametrize(
    "mutation",
    [
        "email_confirmed_at=NULL",
        "deleted_at=CURRENT_TIMESTAMP",
        "is_anonymous=true",
        "banned_until=CURRENT_TIMESTAMP + interval '1 day'",
    ],
)
def test_current_provider_revocation_blocks_writes_and_approval(client, mutation):
    item = claim(client)
    owner_id = UUID(account(client))
    with get_session_factory()() as db:
        db.execute(
            text(f"""UPDATE auth.users SET {mutation}
            WHERE id::text IN (SELECT provider_subject FROM auth_identity WHERE user_id=:user_id)"""),
            {"user_id": owner_id},
        )
        db.commit()
    mine = client.get(f"{BASE}/me?candidate_id={CANDIDATE}", headers=FIRST).json()
    assert mine["request_eligibility"]["reason"] == "email_unconfirmed"
    current = admin_detail(client, item)
    assert current["account_email"] is None
    assert current["approval_block"]["reason"] == "email_unconfirmed"
    assert review(client, item).json()["reason"] == "email_unconfirmed"
    assert apply(client, version=1).status_code == 403


def test_admin_email_display_uses_current_provider_email_and_omits_ambiguity(client):
    item = claim(client)
    user_id = UUID(account(client))
    with get_session_factory()() as db:
        db.execute(
            text("""UPDATE auth.users SET email='current@example.org'
            WHERE id::text IN (SELECT provider_subject FROM auth_identity WHERE user_id=:user_id)"""),
            {"user_id": user_id},
        )
        db.commit()
    assert admin_detail(client, item)["account_email"] == "current@example.org"
    second_subject = uuid4()
    with get_session_factory()() as db:
        db.execute(
            text("""INSERT INTO auth.users (id,email,email_confirmed_at)
            VALUES (:id,'different@example.org',CURRENT_TIMESTAMP)"""),
            {"id": second_subject},
        )
        identity = AuthIdentity(
            user_id=user_id,
            provider="supabase",
            provider_subject=str(second_subject),
            email="stale@example.org",
            email_verified_at=datetime.now(timezone.utc),
        )
        db.add(identity)
        db.commit()
        identity_id = identity.id
    try:
        assert admin_detail(client, item)["account_email"] is None
        assert review(client, item).json()["reason"] == "email_unconfirmed"
    finally:
        with get_session_factory()() as db:
            db.execute(delete(AuthIdentity).where(AuthIdentity.id == identity_id))
            db.execute(
                text("DELETE FROM auth.users WHERE id=:id"), {"id": second_subject}
            )
            db.commit()


def test_claim_migration_round_trip_keeps_official_records_and_private_tables_closed():
    with ScratchDatabase(_local_base_url(), "profile_claim_review") as scratch:
        result = migrate(scratch.url, "upgrade", "0068_profile_claim_review")
        assert result.returncode == 0, result.stderr
        engine = scratch.engine()
        try:
            with engine.begin() as conn:
                conn.execute(
                    text("""INSERT INTO candidate_record
                    (id,election_id,election_date,public_payload,source_sha256,checked_at)
                    VALUES (:id,'test',CURRENT_DATE,'{}',:hash,CURRENT_TIMESTAMP)"""),
                    {"id": CANDIDATE, "hash": "b" * 64},
                )
                states = conn.execute(
                    text("""SELECT c.relname,c.relrowsecurity,count(p.oid)
                    FROM pg_class c LEFT JOIN pg_policy p ON p.polrelid=c.oid
                    WHERE c.relname IN ('candidate_claim_event','candidate_claim_email_delivery')
                    GROUP BY c.oid,c.relname,c.relrowsecurity""")
                ).all()
                assert len(states) == 2 and all(
                    rls and policies == 0 for _, rls, policies in states
                )
            result = migrate(scratch.url, "downgrade", "0067_fcc_political_files")
            assert result.returncode == 0, result.stderr
            with engine.connect() as conn:
                assert conn.scalar(text("SELECT count(*) FROM candidate_record")) == 1
                assert (
                    conn.scalar(text("SELECT to_regclass('candidate_claim_event')"))
                    is None
                )
            result = migrate(scratch.url, "upgrade", "0068_profile_claim_review")
            assert result.returncode == 0, result.stderr
            with engine.connect() as conn:
                assert conn.scalar(text("SELECT count(*) FROM candidate_record")) == 1
                assert (
                    conn.scalar(text("SELECT count(*) FROM candidate_claim_event")) == 0
                )
                assert (
                    conn.scalar(text("SELECT claim_source_block FROM candidate_record"))
                    is None
                )
        finally:
            engine.dispose()


def test_applicant_sees_latest_submission_time_not_a_decision_time(client):
    item = claim(client)
    rejected = review(client, item, action="reject", identity_verified=False)
    assert rejected.status_code == 200, rejected.text
    again = apply(client, version=rejected.json()["claim"]["version"])
    assert again.status_code == 200, again.text
    with get_session_factory()() as db:
        events = {
            kind: created
            for kind, created in db.execute(
                select(CandidateClaimEvent.kind, CandidateClaimEvent.created_at).where(
                    CandidateClaimEvent.claim_id == UUID(item["id"])
                )
            ).all()
        }
    own = client.get(f"{BASE}/me?candidate_id={CANDIDATE}", headers=FIRST).json()
    shown = datetime.fromisoformat(own["claims"][0]["submitted_at"])
    assert shown == events["resubmitted"]
    assert shown != events["rejected"]
    assert "review_note" not in own["claims"][0]


def test_claim_without_submission_history_falls_back_only_to_creation(client):
    item = claim(client)
    with get_session_factory()() as db:
        db.execute(
            delete(CandidateClaimEmailDelivery).where(
                CandidateClaimEmailDelivery.event_id.in_(
                    select(CandidateClaimEvent.id).where(
                        CandidateClaimEvent.claim_id == UUID(item["id"])
                    )
                )
            )
        )
        db.execute(
            delete(CandidateClaimEvent).where(
                CandidateClaimEvent.claim_id == UUID(item["id"])
            )
        )
        created = db.get(CandidateClaim, UUID(item["id"])).created_at
        db.commit()
    own = client.get(f"{BASE}/me", headers=FIRST).json()["claims"][0]
    assert datetime.fromisoformat(own["submitted_at"]) == created


def test_existing_approved_claim_block_precedes_applicant_email_check(client):
    approved(client)
    competitor = claim(client, SECOND)
    with get_session_factory()() as db:
        db.execute(
            text("""UPDATE auth.users SET email_confirmed_at=NULL
            WHERE id::text IN (SELECT provider_subject FROM auth_identity WHERE user_id=:user_id)"""),
            {"user_id": UUID(account(client, SECOND))},
        )
        db.commit()
    detail = admin_detail(client, competitor)
    assert detail["approval_block"]["reason"] == "profile_already_claimed"
