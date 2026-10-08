"""Exercise the private recheck route with real transactions and fake source I/O."""

from copy import deepcopy
from datetime import datetime, timedelta, timezone
from uuid import UUID, uuid4

import pytest
from sqlalchemy import delete, select, text

from alethical.api.routers.admin import administrator_access
from alethical.api.services import candidate_claim_recheck as service
from alethical.api.services.candidate_recheck import (
    CandidateRecheckReason,
    CandidateRecheckUnavailable,
)
from alethical.db.models import (
    AuthIdentity,
    CandidateClaim,
    CandidateRecord,
    PublicRecordVersion,
    UserAccount,
)
from alethical.db.session import get_session_factory
from alethical.tests.test_candidate_claims import (
    ADMIN,
    CANDIDATE,
    FIRST,
    REVIEWER,
    account,
    claim,
    clean,  # noqa: F401
)
from alethical.tests.test_candidate_claim_review import grant_admin  # noqa: F401


class FreshRecord:
    def __init__(self, payload):
        self.original = deepcopy(payload)
        self.payload = deepcopy(payload)
        self.payload["website"] = "https://example.org/current-campaign"
        self.source_sha256 = "c" * 64
        self.checked_at = datetime.now(timezone.utc) + timedelta(seconds=1)

    def matches_record(self, candidate_id, payload, election_id, election_date):
        return (
            candidate_id == CANDIDATE
            and payload == self.original
            and election_id == self.original["election"]["id"]
            and election_date.isoformat() == self.original["election"]["date"]
        )

    def public_payload(self):
        return deepcopy(self.payload)


@pytest.fixture
def recheck_case(client, grant_admin, monkeypatch):  # noqa: F811
    admin_id = UUID(account(client, REVIEWER))
    grant_admin(admin_id, "eug@alethical.com")
    client.app.dependency_overrides[administrator_access] = lambda: True
    with get_session_factory()() as db:
        row = db.get(CandidateRecord, CANDIDATE)
        row.public_payload = {
            "candidate": {"id": CANDIDATE, "name": "Example Candidate"},
            "election": {
                "id": "test",
                "date": row.election_date.isoformat(),
                "type": "general",
                "label": "General election",
            },
            "office": "School Board",
            "votingArea": "Example School District",
            "source": {"url": "https://example.org/official"},
        }
        row.checked_at = datetime.now(timezone.utc) - timedelta(days=2)
        row.claim_source_block = None
        db.commit()
        original = deepcopy(row.public_payload)
        checked = row.checked_at
    item = claim(client)
    fresh = FreshRecord(original)
    calls = []

    def fetch(*args):
        calls.append(args)
        return fresh

    monkeypatch.setattr(service, "fetch_candidate_recheck", fetch)
    return dict(
        admin_id=admin_id,
        item=item,
        fresh=fresh,
        calls=calls,
        checked=checked,
        original=original,
    )


def send(client, case, **changes):
    return client.post(
        f"{ADMIN}/{case['item']['id']}/recheck",
        headers=REVIEWER,
        json={
            "expected_account_id": str(case["admin_id"]),
            "expected_version": case["item"]["version"],
            **changes,
        },
    )


def record():
    with get_session_factory()() as db:
        return db.get(CandidateRecord, CANDIDATE)


def test_recheck_updates_only_target_and_retains_versions(client, recheck_case):
    case = recheck_case
    other = uuid4().hex * 2
    with get_session_factory()() as db:
        row = db.get(CandidateRecord, CANDIDATE)
        row.claim_source_block = "candidate_missing"
        db.add(
            CandidateRecord(
                id=other,
                election_id="test",
                election_date=row.election_date,
                public_payload={"sentinel": "untouched"},
                source_sha256="d" * 64,
                checked_at=case["checked"],
            )
        )
        db.commit()
    response = send(client, case)
    assert response.status_code == 200, response.text
    value = response.json()
    assert value["account_id"] == str(case["admin_id"])
    assert value["claim"]["id"] == case["item"]["id"]
    assert value["claim"]["version"] == case["item"]["version"]
    assert value["claim"]["approval_block"] is None
    row = record()
    assert row.public_payload == case["fresh"].payload
    assert row.checked_at == case["fresh"].checked_at
    assert row.claim_source_block is None
    with get_session_factory()() as db:
        assert db.get(CandidateRecord, other).public_payload == {
            "sentinel": "untouched"
        }
        versions = db.scalars(
            select(PublicRecordVersion).where(
                PublicRecordVersion.record_kind == "candidate",
                PublicRecordVersion.record_id == CANDIDATE,
            )
        ).all()
        assert any(version.public_payload == case["original"] for version in versions)
        assert any(
            version.public_payload == case["fresh"].payload for version in versions
        )
    assert len(case["calls"]) == 1


@pytest.mark.parametrize("reason", list(CandidateRecheckReason))
@pytest.mark.parametrize("prior_block", [None, "identity_mismatch"])
def test_recheck_failure_blocks_only_proved_mismatch_and_never_refreshes(
    client, recheck_case, monkeypatch, reason, prior_block
):
    case = recheck_case
    with get_session_factory()() as db:
        db.get(CandidateRecord, CANDIDATE).claim_source_block = prior_block
        db.commit()

    def fail(*args):
        raise CandidateRecheckUnavailable(reason)

    monkeypatch.setattr(service, "fetch_candidate_recheck", fail)
    response = send(client, case)
    assert response.status_code == 503
    assert response.json()["reason"] == "official_record_recheck_failed"
    row = record()
    assert row.checked_at == case["checked"]
    assert row.public_payload == case["original"]
    assert row.source_sha256 == "b" * 64
    proved = {
        CandidateRecheckReason.IDENTITY_MISMATCH,
        CandidateRecheckReason.ELECTION_MISMATCH,
        CandidateRecheckReason.CANDIDATE_MISSING,
    }
    assert row.claim_source_block == (reason.value if reason in proved else prior_block)


def test_source_io_holds_no_account_candidate_or_source_lock(
    client, recheck_case, monkeypatch
):
    case = recheck_case

    def fetch(*args):
        with get_session_factory()() as db:
            db.execute(text("SET LOCAL lock_timeout='100ms'"))
            db.execute(
                select(UserAccount)
                .where(UserAccount.id == case["admin_id"])
                .with_for_update(nowait=True)
            )
            db.execute(
                select(CandidateRecord)
                .where(CandidateRecord.id == CANDIDATE)
                .with_for_update(nowait=True)
            )
            assert db.scalar(
                text("SELECT pg_try_advisory_xact_lock(hashtext(:id))"),
                {"id": CANDIDATE},
            )
        return case["fresh"]

    monkeypatch.setattr(service, "fetch_candidate_recheck", fetch)
    assert send(client, case).status_code == 200


@pytest.mark.parametrize(
    "change",
    [
        "admin_role",
        "admin_inactive",
        "admin_deleted",
        "request_deleted",
        "request_version",
        "record_hash",
        "record_checked",
        "record_payload",
    ],
)
def test_changes_during_fetch_cannot_save_old_result(
    client, recheck_case, monkeypatch, change
):
    case = recheck_case

    def fetch(*args):
        if change == "admin_role":
            monkeypatch.setenv("ALETHICAL_ADMIN_ACCOUNT_IDS", "")
        else:
            with get_session_factory()() as db:
                if change == "admin_inactive":
                    db.get(UserAccount, case["admin_id"]).is_active = False
                elif change == "admin_deleted":
                    db.execute(
                        delete(AuthIdentity).where(
                            AuthIdentity.user_id == case["admin_id"]
                        )
                    )
                    db.execute(
                        delete(UserAccount).where(UserAccount.id == case["admin_id"])
                    )
                elif change == "request_deleted":
                    db.execute(
                        delete(CandidateClaim).where(
                            CandidateClaim.id == UUID(case["item"]["id"])
                        )
                    )
                elif change == "request_version":
                    db.get(CandidateClaim, UUID(case["item"]["id"])).version += 1
                else:
                    row = db.get(CandidateRecord, CANDIDATE)
                    if change == "record_hash":
                        row.source_sha256 = "d" * 64
                    elif change == "record_checked":
                        row.checked_at += timedelta(seconds=1)
                    else:
                        row.public_payload = {
                            **row.public_payload,
                            "website": "https://example.org/newer",
                        }
                db.commit()
        return case["fresh"]

    monkeypatch.setattr(service, "fetch_candidate_recheck", fetch)
    response = send(client, case)
    expected = {
        "admin_role": 403,
        "admin_inactive": 403,
        "admin_deleted": 401,
        "request_deleted": 404,
    }.get(change, 409)
    assert response.status_code == expected, response.text
    assert record().source_sha256 != "c" * 64


def test_recheck_blocks_wrong_account_and_stale_request_before_fetch(
    client, recheck_case
):
    assert (
        send(client, recheck_case, expected_account_id=str(uuid4())).status_code == 409
    )
    assert send(client, recheck_case, expected_version=0).status_code == 409
    assert recheck_case["calls"] == []


def test_public_user_cannot_recheck_even_with_route_hint_overridden(
    client, recheck_case
):
    response = client.post(
        f"{ADMIN}/{recheck_case['item']['id']}/recheck",
        headers=FIRST,
        json={"expected_account_id": account(client), "expected_version": 1},
    )
    assert response.status_code == 403
    assert recheck_case["calls"] == []


def test_failed_recheck_save_rolls_back_source_and_hides_database_details(
    client, recheck_case, monkeypatch
):
    from sqlalchemy.exc import SQLAlchemyError

    original_save = service.save_candidate_record

    def fail(db, **values):
        original_save(db, **values)
        raise SQLAlchemyError("PRIVATE SOURCE DIAGNOSTIC")

    monkeypatch.setattr(service, "save_candidate_record", fail)
    response = send(client, recheck_case)
    assert response.status_code == 503
    assert "PRIVATE SOURCE DIAGNOSTIC" not in response.text
    assert response.json()["reason"] == "profile_claims_unavailable"
    row = record()
    assert row.public_payload == recheck_case["original"]
    assert row.checked_at == recheck_case["checked"]
    with get_session_factory()() as db:
        assert (
            db.scalar(
                select(PublicRecordVersion.id).where(
                    PublicRecordVersion.record_id == CANDIDATE,
                    PublicRecordVersion.source_sha256 == "c" * 64,
                    PublicRecordVersion.checked_at == recheck_case["fresh"].checked_at,
                )
            )
            is None
        )
