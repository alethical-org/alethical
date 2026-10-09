"""Ownership is granted by a separate reviewer, never by public filing evidence."""

from concurrent.futures import ThreadPoolExecutor
from datetime import date, datetime, timedelta, timezone
from threading import Barrier
import uuid

from fastapi import HTTPException
import pytest
from sqlalchemy import delete, select, text, update

from alethical.api.auth import get_auth_service
from alethical.api.services.auth import AuthenticatedPrincipal
from alethical.api.routers.admin import administrator_access
from alethical.api.services import candidate_claims as service
from alethical.db.models import (
    CandidateClaim,
    CandidateRecord,
    CandidateStatement,
    CandidateStatementReport,
    CandidateStatementRevision,
    UserAccount,
)
from alethical.db.session import get_session_factory

BASE = "/api/v1/candidate-claims"
ADMIN = "/api/v1/admin/candidate-claims"
CANDIDATE = "a" * 64
FIRST = {"Authorization": "Bearer test-supabase-token"}
SECOND = {"Authorization": "Bearer test-supabase-token-grace"}
REVIEWER = {"Authorization": "Bearer candidate-test-reviewer"}


@pytest.fixture(autouse=True)
def clean(seed_database, client, monkeypatch):
    monkeypatch.setenv("ALETHICAL_ADMIN_ACCOUNT_IDS", "")
    original = client.app.dependency_overrides[get_auth_service]()

    # Provisioning joins confirmed identities by email. Keep both fake subjects
    # and emails separate from the shared API fixtures so these tests cannot
    # delete their accounts or attach a second identity to their metric readers.
    class ClaimsAuth:
        def authenticate(self, token):
            if token == "candidate-test-reviewer":
                principal = AuthenticatedPrincipal(
                    provider="supabase",
                    provider_subject="candidate-test-reviewer",
                    email="reviewer@example.com",
                    email_verified=True,
                )
            else:
                principal = original.authenticate(token)
            return AuthenticatedPrincipal(
                provider="supabase",
                provider_subject=str(
                    uuid.uuid5(
                        uuid.NAMESPACE_URL,
                        f"candidate-profile-claim-test:{principal.provider_subject}",
                    )
                ),
                email=f"candidate-profile-claim-test-{principal.email}",
                email_verified=principal.email_verified,
            )

    client.app.dependency_overrides[get_auth_service] = ClaimsAuth
    with get_session_factory()() as db:
        db.execute(text("CREATE SCHEMA IF NOT EXISTS auth"))
        db.execute(
            text("""CREATE TABLE IF NOT EXISTS auth.users (
            id uuid PRIMARY KEY, email text, email_confirmed_at timestamptz,
            deleted_at timestamptz, banned_until timestamptz,
            is_anonymous boolean NOT NULL DEFAULT false)""")
        )
        for subject, email in (
            ("supabase-user-ada", "ada@example.com"),
            ("supabase-user-grace", "grace@example.com"),
            ("candidate-test-reviewer", "reviewer@example.com"),
        ):
            db.execute(
                text("""INSERT INTO auth.users (id,email,email_confirmed_at)
                VALUES (:id,:email,CURRENT_TIMESTAMP) ON CONFLICT (id) DO UPDATE SET
                email=EXCLUDED.email, email_confirmed_at=EXCLUDED.email_confirmed_at,
                deleted_at=NULL, banned_until=NULL, is_anonymous=false"""),
                {
                    "id": uuid.uuid5(
                        uuid.NAMESPACE_URL, f"candidate-profile-claim-test:{subject}"
                    ),
                    "email": f"candidate-profile-claim-test-{email}",
                },
            )
        for model in (
            CandidateStatementReport,
            CandidateStatementRevision,
            CandidateStatement,
            CandidateClaim,
            CandidateRecord,
        ):
            db.execute(delete(model))
        db.execute(update(UserAccount).values(is_active=True))
        db.add(
            CandidateRecord(
                id=CANDIDATE,
                election_id="test",
                election_date=date.today() + timedelta(days=30),
                source_sha256="b" * 64,
                checked_at=datetime.now(timezone.utc),
                public_payload={
                    "candidate": {"name": "Example Candidate"},
                    "office": "School Board",
                },
            )
        )
        db.commit()


def account(client, headers=FIRST):
    response = client.get(f"{BASE}/me", headers=headers)
    assert response.status_code == 200, response.text
    return response.json()["account_id"]


def apply(client, headers=FIRST, version=0, **changes):
    return client.post(
        BASE,
        headers=headers,
        json={
            "candidate_id": CANDIDATE,
            "expected_account_id": account(client, headers),
            "expected_version": version,
            "evidence_url": "https://example.com/campaign",
            "request_note": "Candidate\n\nI am this candidate; verify through my published campaign contact.",
            **changes,
        },
    )


def claim(client, headers=FIRST):
    response = apply(client, headers)
    assert response.status_code == 200, response.text
    return response.json()["claim"]


def review(client, item, action="approve", headers=REVIEWER, **changes):
    client.app.dependency_overrides[administrator_access] = lambda: True
    return client.post(
        f"{ADMIN}/{item['id']}/review",
        headers=headers,
        json={
            "expected_account_id": account(client, headers),
            "expected_version": item["version"],
            "action": action,
            "identity_verified": True,
            "review_note": "Independently contacted the candidate using the official published contact.",
            **changes,
        },
    )


def approved(client):
    item = claim(client)
    response = review(client, item)
    assert response.status_code == 200, response.text
    return response.json()["claim"]


def statement(client, item, body="Candidate supplied words", version=0, headers=FIRST):
    return client.put(
        f"{BASE}/{item['id']}/statement",
        headers=headers,
        json={
            "expected_account_id": account(client, headers),
            "expected_version": version,
            "body": body,
        },
    )


def public(client):
    return client.get(f"/api/v1/candidate-statements/{CANDIDATE}")


def test_private_requests_require_signin_and_do_not_leak_to_other_account(client):
    assert client.get(f"{BASE}/me").status_code == 401
    assert client.post(BASE, json={}).status_code == 401
    item = claim(client)
    assert client.get(f"{BASE}/me", headers=SECOND).json()["claims"] == []
    response = client.post(
        f"{BASE}/{item['id']}/withdraw",
        headers=SECOND,
        json={
            "expected_account_id": account(client, SECOND),
            "expected_version": item["version"],
        },
    )
    assert response.status_code == 404
    assert statement(client, item, headers=SECOND).status_code == 404
    assert public(client).json() == {"statement": None}


def test_request_does_not_grant_editing_and_account_change_is_rejected(client):
    item = claim(client)
    assert statement(client, item).status_code == 403
    assert apply(client, expected_account_id=str(uuid.uuid4())).status_code == 409
    assert apply(client).status_code == 409
    pending = apply(
        client,
        version=1,
        request_note="Candidate\n\nChanged evidence must not replace the pending request",
    )
    assert pending.json()["claim"]["version"] == 1
    assert pending.json()["already_submitted"] is True
    assert "Changed evidence" not in pending.json()["claim"]["request_note"]


def test_review_requires_admin_independent_person_and_verification(client):
    item = claim(client)
    client.app.dependency_overrides[administrator_access] = lambda: False
    assert client.get(ADMIN, headers=FIRST).status_code == 403
    assert (
        client.post(f"{ADMIN}/{item['id']}/review", headers=FIRST, json={}).status_code
        == 403
    )
    assert review(client, item, headers=FIRST).status_code == 403
    assert review(client, item, identity_verified=False).status_code == 422
    assert review(client, item, review_note=" " * 25).status_code == 422
    assert review(client, item).status_code == 200
    assert review(client, item).status_code == 409
    own = client.get(f"{BASE}/me", headers=FIRST).json()["claims"][0]
    assert "review_note" not in own
    assert "account_email" not in own
    assert "user_id" not in own


def test_single_owner_and_revoke_hide_statement_immediately(client):
    item = approved(client)
    assert statement(client, item).status_code == 200
    assert public(client).json()["statement"]["body"] == "Candidate supplied words"
    competitor = claim(client, SECOND)
    assert review(client, competitor).status_code == 409
    assert review(client, item, action="revoke").status_code == 200
    assert public(client).json() == {"statement": None}
    assert statement(client, item, version=1).status_code == 403
    assert review(client, competitor).status_code == 200
    assert public(client).json() == {"statement": None}


def test_statement_versions_removal_and_private_history(client):
    item = approved(client)
    assert (
        statement(client, item, "First published text").json()["statement"]["version"]
        == 1
    )
    assert statement(client, item, "Wrong stale write").status_code == 409
    assert statement(client, item, "Second published text", 1).status_code == 200
    removed = client.request(
        "DELETE",
        f"{BASE}/{item['id']}/statement",
        headers=FIRST,
        json={
            "expected_account_id": account(client),
            "expected_version": 2,
        },
    )
    assert removed.status_code == 200, removed.text
    assert removed.json()["statement"] == {
        **removed.json()["statement"],
        "body": "",
        "version": 3,
    }
    assert public(client).json() == {"statement": None}
    history = client.get(f"{BASE}/{item['id']}/statement", headers=FIRST).json()
    assert history["statement"]["version"] == 3
    assert [item["action"] for item in history["history"]] == [
        "removed",
        "published",
        "published",
    ]
    assert history["history"][-1]["body"] == "First published text"
    assert statement(client, item, "New after removal", 3).status_code == 200
    assert "no-store" in public(client).headers["cache-control"]


def test_withdrawal_reapply_does_not_republish_old_statement(client):
    item = approved(client)
    assert statement(client, item).status_code == 200
    response = client.post(
        f"{BASE}/{item['id']}/withdraw",
        headers=FIRST,
        json={
            "expected_account_id": account(client),
            "expected_version": item["version"],
        },
    )
    assert response.status_code == 200
    assert public(client).json() == {"statement": None}
    reapplied = apply(client, version=response.json()["claim"]["version"]).json()[
        "claim"
    ]
    assert review(client, reapplied).status_code == 200
    assert public(client).json() == {"statement": None}


def test_deactivated_owner_immediately_loses_public_statement(client):
    item = approved(client)
    assert statement(client, item).status_code == 200
    owner = uuid.UUID(account(client))
    with get_session_factory()() as db:
        db.get(UserAccount, owner).is_active = False
        db.commit()
    assert public(client).json() == {"statement": None}


def test_deleted_owner_erases_claim_statement_and_private_history(client):
    with get_session_factory()() as db:
        owner = UserAccount(
            primary_email="deleted-candidate@example.org", is_active=True
        )
        db.add(owner)
        db.flush()
        item = CandidateClaim(
            candidate_id=CANDIDATE,
            user_id=owner.id,
            status="approved",
            evidence_url="https://example.org/campaign",
            request_note="Private request explanation",
        )
        db.add(item)
        db.flush()
        claim_id, owner_id = item.id, owner.id
        db.add(
            CandidateStatement(
                candidate_id=CANDIDATE,
                claim_id=item.id,
                body="Published words",
                updated_at=datetime.now(timezone.utc),
                version=1,
            )
        )
        db.add(
            CandidateStatementRevision(
                candidate_id=CANDIDATE,
                claim_id=item.id,
                body="Published words",
                action="published",
                created_at=datetime.now(timezone.utc),
            )
        )
        db.commit()
    assert public(client).json()["statement"]["body"] == "Published words"
    with get_session_factory()() as db:
        db.execute(delete(UserAccount).where(UserAccount.id == owner_id))
        db.commit()
        assert db.get(CandidateClaim, claim_id) is None
        assert (
            db.scalar(
                select(CandidateStatementRevision.id).where(
                    CandidateStatementRevision.claim_id == claim_id
                )
            )
            is None
        )
    assert public(client).json() == {"statement": None}


def test_unconfirmed_claimant_cannot_be_approved(client):
    item = claim(client)
    with get_session_factory()() as db:
        db.execute(
            text("""UPDATE auth.users SET email_confirmed_at=NULL
            WHERE id::text IN (SELECT provider_subject FROM auth_identity WHERE user_id=:user_id)"""),
            {"user_id": uuid.UUID(account(client))},
        )
        db.commit()
    assert review(client, item).status_code == 403


def test_stale_or_ended_election_record_cannot_be_approved(client):
    item = claim(client)
    with get_session_factory()() as db:
        db.get(CandidateRecord, CANDIDATE).checked_at = datetime.now(
            timezone.utc
        ) - timedelta(days=2)
        db.commit()
    assert review(client, item).status_code == 409
    with get_session_factory()() as db:
        row = db.get(CandidateRecord, CANDIDATE)
        row.checked_at = datetime.now(timezone.utc)
        row.election_date = date.today() - timedelta(days=2)
        db.commit()
    assert review(client, item).status_code == 409
    assert apply(client, SECOND).status_code == 409


@pytest.mark.parametrize(
    "url",
    [
        "javascript:alert(1)",
        "http://localhost/x",
        "http://127.0.0.1/x",
        "http://10.0.0.1/x",
        "https://a:b@example.com/x",
        "https://example.com:9000/x",
        "https://campaign.local/x",
        "https://2130706433/x",
    ],
)
def test_evidence_rejects_unsafe_links_without_echoing_private_value(client, url):
    response = apply(client, evidence_url=url)
    assert response.status_code == 422
    assert url not in response.text


def test_report_rejects_a_statement_that_changed_since_the_reader_opened_it(client):
    item = approved(client)
    assert statement(client, item).status_code == 200
    path = f"/api/v1/candidate-statements/{CANDIDATE}/reports"
    assert client.post(path, json={"reason": "Please review"}).status_code == 422
    assert (
        statement(client, item, body="New campaign words", version=1).status_code == 200
    )
    response = client.post(
        path, json={"reason": "Please review", "expected_version": 1}
    )
    assert response.status_code == 409
    with get_session_factory()() as db:
        assert not db.scalars(select(CandidateStatementReport)).all()
    assert (
        client.post(
            path, json={"reason": "Please review", "expected_version": 2}
        ).status_code
        == 200
    )
    with get_session_factory()() as db:
        report = db.scalar(select(CandidateStatementReport))
        assert report.statement_body == "New campaign words"
        assert report.statement_version == 2


def test_reports_are_private_bounded_and_admin_resolved(client):
    item = approved(client)
    assert statement(client, item).status_code == 200
    response = client.post(
        f"/api/v1/candidate-statements/{CANDIDATE}/reports",
        json={"reason": "The statement contains a threat", "expected_version": 1},
    )
    assert response.status_code == 200
    assert response.json() == {"received": True}
    client.app.dependency_overrides[administrator_access] = lambda: False
    assert (
        client.get(
            "/api/v1/admin/candidate-statement-reports", headers=FIRST
        ).status_code
        == 403
    )
    client.app.dependency_overrides[administrator_access] = lambda: True
    queue = client.get(
        "/api/v1/admin/candidate-statement-reports", headers=REVIEWER
    ).json()
    assert len(queue["reports"]) == 1
    report = queue["reports"][0]
    assert "user_id" not in report
    assert report["statement_body"] == "Candidate supplied words"
    assert report["statement_version"] == 1
    response = client.post(
        f"/api/v1/admin/candidate-statement-reports/{report['id']}/resolve",
        headers=REVIEWER,
        json={"expected_account_id": queue["account_id"]},
    )
    assert response.json() == {"resolved": True}
    assert (
        client.get(
            "/api/v1/admin/candidate-statement-reports", headers=REVIEWER
        ).json()["reports"]
        == []
    )


def test_simultaneous_approvals_cannot_grant_two_owners(client):
    first, second = claim(client), claim(client, SECOND)
    reviewer_id = uuid.UUID(account(client, REVIEWER))
    barrier = Barrier(2)

    def approve(item):
        with get_session_factory()() as db:
            barrier.wait(timeout=10)
            try:
                service.review(
                    db,
                    db.get(UserAccount, reviewer_id),
                    claim_id=uuid.UUID(item["id"]),
                    action="approve",
                    review_note="Verified identity through independent contact",
                    identity_verified=True,
                    expected_version=item["version"],
                    expected_account_id=reviewer_id,
                )
                return 200
            except HTTPException as error:
                db.rollback()
                return error.status_code

    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(approve, [first, second]))
    assert sorted(results) == [200, 409]
    with get_session_factory()() as db:
        assert (
            len(
                db.scalars(
                    select(CandidateClaim).where(CandidateClaim.status == "approved")
                ).all()
            )
            == 1
        )


def test_private_history_does_not_leak_and_statement_cannot_change_official_facts(
    client,
):
    item = approved(client)
    assert (
        statement(client, item, "<b>Campaign text is plain text</b>").status_code == 200
    )
    response = client.get(f"{BASE}/{item['id']}/statement", headers=SECOND)
    assert response.status_code == 404
    assert "Campaign text" not in response.text
    assert (
        client.get(f"{BASE}/{uuid.uuid4()}/statement", headers=SECOND).status_code
        == 404
    )
    response = client.put(
        f"{BASE}/{item['id']}/statement",
        headers=FIRST,
        json={
            "expected_account_id": account(client),
            "expected_version": 1,
            "body": "Changed",
            "office": "Governor",
        },
    )
    assert response.status_code == 422
    with get_session_factory()() as db:
        assert (
            db.get(CandidateRecord, CANDIDATE).public_payload["office"]
            == "School Board"
        )


def test_public_reports_are_rate_limited_even_with_rotating_forwarded_headers(client):
    from alethical.api.rate_limit import SlidingWindowLimiter

    item = approved(client)
    assert statement(client, item).status_code == 200
    client.app.state.comment_limiter = SlidingWindowLimiter(1, 60)
    path = f"/api/v1/candidate-statements/{CANDIDATE}/reports"
    assert (
        client.post(
            path,
            json={"reason": "Please review this text", "expected_version": 1},
            headers={"X-Forwarded-For": "1.1.1.1"},
        ).status_code
        == 200
    )
    response = client.post(
        path,
        json={"reason": "Please review this text", "expected_version": 1},
        headers={"X-Forwarded-For": "8.8.8.8"},
    )
    assert response.status_code == 429
    assert response.headers.get("retry-after")


def test_withdrawal_racing_statement_update_cannot_leave_published_words(client):
    item = approved(client)
    assert statement(client, item).status_code == 200
    owner_id = uuid.UUID(account(client))
    barrier = Barrier(2)

    def mutate(action):
        with get_session_factory()() as db:
            owner = db.get(UserAccount, owner_id)
            barrier.wait(timeout=10)
            try:
                if action == "withdraw":
                    service.withdraw(
                        db,
                        owner,
                        claim_id=uuid.UUID(item["id"]),
                        expected_account_id=owner_id,
                        expected_version=item["version"],
                    )
                else:
                    service.write_statement(
                        db,
                        owner,
                        claim_id=uuid.UUID(item["id"]),
                        body="Racing new words",
                        expected_account_id=owner_id,
                        expected_version=1,
                    )
                return 200
            except HTTPException as error:
                db.rollback()
                return error.status_code

    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(mutate, ["withdraw", "write"]))
    assert results[0] == 200
    assert results[1] in {200, 403}
    assert public(client).json() == {"statement": None}


@pytest.mark.parametrize("operation", ["apply", "mine", "report_statement"])
def test_database_failures_never_escape_with_private_evidence(
    client, monkeypatch, caplog, operation
):
    from sqlalchemy.exc import StatementError

    identity = account(client)
    sentinel = "PRIVATE_CLAIM_EVIDENCE_SENTINEL"

    def broken(*args, **kwargs):
        raise StatementError(
            "driver echoed " + sentinel,
            "INSERT INTO candidate_claim (request_note) VALUES (%s)",
            {"request_note": sentinel},
            RuntimeError(sentinel),
        )

    monkeypatch.setattr(service, operation, broken)
    if operation == "apply":
        response = client.post(
            BASE,
            headers=FIRST,
            json={
                "candidate_id": CANDIDATE,
                "expected_account_id": identity,
                "expected_version": 0,
                "evidence_url": "https://example.com/official",
                "request_note": sentinel,
            },
        )
    elif operation == "mine":
        response = client.get(BASE + "/me", headers=FIRST)
    else:
        response = client.post(
            f"/api/v1/candidate-statements/{CANDIDATE}/reports",
            json={"reason": sentinel, "expected_version": 1},
        )
    assert response.status_code == 503
    assert sentinel not in response.text
    assert sentinel not in caplog.text
    assert "no-store" in response.headers["cache-control"]


def test_database_boundary_suppresses_private_exception_traceback():
    import traceback
    from unittest.mock import Mock
    from sqlalchemy.exc import StatementError
    from alethical.api.routers.candidate_claims import claim_database

    db = Mock()
    boundary = claim_database(db)
    assert next(boundary) is db
    private = "PRIVATE_BOUND_SQL_VALUE"
    try:
        boundary.throw(
            StatementError(private, "INSERT", {"note": private}, RuntimeError(private))
        )
    except HTTPException as error:
        assert error.status_code == 503
        assert private not in "".join(traceback.format_exception(error))
    else:
        pytest.fail("Expected a safe unavailable response")
    db.rollback.assert_called_once()


def remove(client, item, version, headers=FIRST):
    return client.request(
        "DELETE",
        f"{BASE}/{item['id']}/statement",
        headers=headers,
        json={
            "expected_account_id": account(client, headers),
            "expected_version": version,
        },
    )


def test_published_and_edited_dates_follow_the_current_publication(client):
    item = approved(client)
    first = statement(client, item, "First published text").json()["statement"]
    assert first["published_at"] is not None and first["edited_at"] is None
    assert public(client).json()["statement"]["published_at"] == first["published_at"]
    edited = statement(client, item, "Edited text", 1).json()["statement"]
    # An edit keeps the first publication and adds the latest saved edit.
    assert edited["published_at"] == first["published_at"]
    assert edited["edited_at"] == edited["updated_at"]
    assert public(client).json()["statement"]["edited_at"] == edited["edited_at"]
    removed = remove(client, item, 2).json()["statement"]
    assert removed["published_at"] is None and removed["edited_at"] is None
    # Version 4 after a removal is a new publication, not an edit.
    again = statement(client, item, "Published again", 3).json()["statement"]
    assert again["version"] == 4
    assert again["edited_at"] is None
    assert again["published_at"] > first["published_at"]
    private = client.get(f"{BASE}/{item['id']}/statement", headers=FIRST).json()
    assert private["statement"]["published_at"] == again["published_at"]


def test_publication_dates_never_invent_an_edit_without_revision_evidence(client):
    item = approved(client)
    statement(client, item, "Words")
    statement(client, item, "Edited words", 1)
    with get_session_factory()() as db:
        db.execute(delete(CandidateStatementRevision))
        db.commit()
    shown = public(client).json()["statement"]
    assert shown["published_at"] == shown["updated_at"]
    assert shown["edited_at"] is None


def test_new_owner_publication_is_dated_from_its_own_history(client):
    item = approved(client)
    statement(client, item, "Old owner words")
    statement(client, item, "Old owner edit", 1)
    assert review(client, item, action="revoke").status_code == 200
    successor = claim(client, SECOND)
    assert review(client, successor).status_code == 200
    successor = client.get(f"{BASE}/me", headers=SECOND).json()["claims"][0]
    fresh = statement(client, successor, "New owner words", headers=SECOND)
    assert fresh.status_code == 200, fresh.text
    shown = public(client).json()["statement"]
    assert shown["body"] == "New owner words"
    assert shown["edited_at"] is None
    assert shown["published_at"] == fresh.json()["statement"]["published_at"]
