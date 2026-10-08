"""Real PostgreSQL checks for retained facts, identities and evidence boundaries."""

from copy import deepcopy
from datetime import UTC, date, datetime, timedelta
from uuid import UUID, uuid4

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import func, select, update
from sqlalchemy.exc import IntegrityError

from alethical.api.routers.people import router
from alethical.api.services import person_records as records
from alethical.api.services.candidate_lookup import CandidateLookupService, load_profile
from alethical.db.models import (
    CandidateClaim,
    CandidateRaceRecord,
    CandidateRecord,
    PersonCandidacy,
    PersonServiceRecord,
    PublicPerson,
    PublicRecordVersion,
    UserAccount,
)
from alethical.db.session import get_db, get_session_factory
from alethical.tests.test_candidate_legislators import subject  # noqa: F401, F811
from alethical.pipeline.candidate_person_records import (
    import_reviewed_records,
    validate_register,
)

NOW = datetime(2026, 10, 8, 20, tzinfo=UTC)


@pytest.fixture
def public_db(seed_database):
    with get_session_factory()() as db:
        import_reviewed_records(db, today=NOW.date())
        yield db
        db.rollback()


def test_real_register_keeps_ballot_certification_service_separate(public_db):
    db = public_db
    source = records.reviewed_register()
    outcomes = {}
    for item in source["candidates"]:
        profile = load_profile(db, item["id"], now=NOW + timedelta(days=100))
        outcomes[profile["candidate"]["name"]] = profile["result"]["outcome"]
        assert profile["source"]["retained"] is True
        assert "stale" not in profile["source"]
        assert profile["source"]["url"].endswith("/LocalCandTbl.txt")
        assert "boardbook.org" in profile["result"]["source"]["url"]
        assert profile["result"]["certification"]["date"] == "2024-11-12"
        assert profile["election"]["sourceIds"] == {"sosResults": "170"}
        assert "legislator" not in profile
    assert outcomes == {
        "Kim Ellison": "elected",
        "Shayla Owodunni": "not-elected",
        "Sharon El-Amin": "elected",
        "Adriana Cerrillo": "elected",
        "Lara Bergman": "not-elected",
        "Greta Callahan": "elected",
    }
    for person in source["people"]:
        result = records.load_person(db, person["id"], now=NOW)
        assert result["name"] == person["name"]
        assert result["service"][0]["status"] == "current"
        assert result["service"][0]["termStart"] == {
            "value": "2025",
            "precision": "year",
        }
        assert result["service"][0]["expectedStart"] == {
            "value": "2025-01",
            "precision": "month",
        }
        assert "startDate" not in result["service"][0]
        assert (
            result["service"][0]["source"]["url"]
            != result["elections"][0]["source"]["url"]
        )
        assert len(result["research"]["items"]) == 2
        assert result["research"]["nextCursor"] is None


def test_import_idempotence_and_late_reads_retain_actual_versions(public_db):
    db = public_db

    def count():
        return db.scalar(select(func.count()).select_from(PublicRecordVersion))

    original = count()
    import_reviewed_records(db, today=NOW.date())
    assert count() == original
    candidate = records.reviewed_register()["candidates"][0]
    profile = deepcopy(candidate["profile"])
    cid = candidate["id"]
    current = db.get(CandidateRecord, cid)
    before = deepcopy(current.public_payload)
    checked_before = current.checked_at
    newer = checked_before + timedelta(hours=2)
    profile["source"]["checkedDate"] = (
        newer.astimezone(records.MINNESOTA).date().isoformat()
    )
    records.save_candidate_record(
        db, profile=profile, source_hash="f" * 64, checked_at=newer
    )
    assert current.checked_at == newer
    records.save_candidate_record(
        db,
        profile=before,
        source_hash="e" * 64,
        checked_at=checked_before - timedelta(hours=1),
    )
    assert current.checked_at == newer
    versions = db.scalars(
        select(PublicRecordVersion).where(
            PublicRecordVersion.record_kind == "candidate",
            PublicRecordVersion.record_id == cid,
        )
    ).all()
    assert len(versions) == 3
    assert any(
        row.public_payload == before and row.checked_at == checked_before
        for row in versions
    )
    assert any(row.source_sha256 == "e" * 64 for row in versions)
    assert load_profile(db, cid, now=NOW)["result"]["outcome"] == "not-elected"


@pytest.mark.parametrize(
    "field", ["name", "party", "office", "votingArea", "electionDate"]
)
def test_changed_identity_keeps_original_url_and_does_not_transfer_links(
    public_db, field
):
    db = public_db
    person = records.reviewed_register()["people"][0]
    cid = person["candidateIds"][0]
    row = db.get(CandidateRecord, cid)
    original = deepcopy(row.public_payload)
    changed = deepcopy(original)
    if field in {"name", "party"}:
        changed["candidate"][field] = "Changed"
    elif field == "electionDate":
        changed["election"]["date"] = "2028-11-07"
    else:
        changed[field] = "Changed"
    with pytest.raises(records.PublicRecordConflict):
        records.save_candidate_record(
            db, profile=changed, source_hash="d" * 64, checked_at=NOW
        )
    assert row.public_payload == original
    assert load_profile(db, cid, now=NOW)["people"][0]["id"] == person["id"]
    # Even an out-of-band corrupt update cannot turn a frozen link into a name join.
    row.public_payload = changed
    db.flush()
    assert load_profile(db, cid, now=NOW)["people"] == []
    assert "result" not in load_profile(db, cid, now=NOW)


def test_ticket_only_connects_individually_reviewed_members(public_db):
    db = public_db
    profile = {
        "candidate": {
            "id": "a" * 64,
            "name": "Alex Same and Pat Same",
            "party": "NONPARTISAN",
        },
        "election": {"id": "8334", "date": "2026-11-03", "type": "general"},
        "office": "Governor & Lt Governor",
        "votingArea": "Minnesota",
        "source": {
            "authority": "Minnesota Secretary of State",
            "url": "https://myballotmn.sos.mn.gov/",
            "checkedDate": "2026-10-08",
        },
    }
    records.save_candidate_record(
        db, profile=profile, source_hash="b" * 64, checked_at=NOW
    )
    ids = [uuid4(), uuid4(), uuid4()]
    for pid, name in zip(ids, ["Alex Same", "Pat Same", "Alex Same"]):
        db.add(
            PublicPerson(id=pid, name=name, identity_evidence={"review": "explicit"})
        )
    db.flush()
    for pid in ids[:2]:
        db.add(
            PersonCandidacy(
                person_id=pid,
                candidate_id="a" * 64,
                identity=records.candidate_identity(profile),
                evidence={"review": "each member"},
            )
        )
    db.flush()
    result = load_profile(db, "a" * 64, now=NOW)
    assert result["isJointTicket"] is True
    assert result["candidate"]["name"] == "Alex Same and Pat Same"
    assert {x["id"] for x in result["people"]} == {str(x) for x in ids[:2]}
    lookup = records.enrich_lookup_results(
        db,
        {
            "kind": "results",
            "electionId": "8334",
            "races": [
                {
                    "entries": [
                        {
                            "kind": "ticket",
                            "id": "a" * 64,
                            "members": [profile["candidate"]],
                        }
                    ]
                }
            ],
        },
        today=NOW.date(),
    )
    ticket = lookup["races"][0]["entries"][0]
    assert {x["id"] for x in ticket["people"]} == {str(x) for x in ids[:2]}
    assert "people" not in ticket["members"][0]
    assert records.load_person(db, str(ids[2]), now=NOW)["elections"] == []
    assert (
        records.load_person(db, str(ids[0]), now=NOW)["elections"][0]["profileUrl"]
        == "/candidates/" + "a" * 64
    )


@pytest.mark.parametrize(
    "status", ["pending", "unofficial", "recount", "tie", "unavailable"]
)
def test_nonfinal_race_never_inherits_old_outcome_or_certification(public_db, status):
    db = public_db
    candidate = records.reviewed_register()["candidates"][0]
    race = db.get(CandidateRaceRecord, candidate["raceId"])
    race.result_status = status
    race.final = False
    db.flush()
    result = load_profile(db, candidate["id"], now=NOW)["result"]
    assert result["status"] == status
    assert "outcome" not in result
    assert "certification" not in result


@pytest.mark.parametrize("change", ["scope", "evidence", "stage", "test"])
def test_database_rejects_wrong_certification_scope_or_test_results(public_db, change):
    db = public_db
    race = records.reviewed_register()["races"][0]
    values = {
        "scope": {"authority_scope": "state:MN"},
        "evidence": {"result_payload": {"source": race["payload"]["source"]}},
        "stage": {"stage": "primary"},
        "test": {"test_data": True},
    }[change]
    with pytest.raises(IntegrityError), db.begin_nested():
        db.execute(
            update(CandidateRaceRecord)
            .where(CandidateRaceRecord.id == race["id"])
            .values(**values)
        )


def test_expected_start_precision_never_confirms_service(public_db):
    db = public_db
    person = records.reviewed_register()["people"][0]
    row = db.get(PersonServiceRecord, UUID(person["service"][0]["id"]))
    value = deepcopy(row.public_payload)
    value.update(
        status="elected", expectedStart={"value": "2027-01", "precision": "month"}
    )
    row.status = "elected"
    row.public_payload = value
    db.flush()
    jan = records.load_person(
        db, person["id"], now=datetime(2027, 1, 20, 12, tzinfo=UTC)
    )["service"][0]
    feb = records.load_person(
        db, person["id"], now=datetime(2027, 2, 1, 12, tzinfo=UTC)
    )["service"][0]
    assert jan["status"] == feb["status"] == "elected"
    assert jan["expectedStartPassed"] is False
    assert feb["expectedStartPassed"] is True
    assert feb["currentServiceConfirmed"] is False
    assert "startDate" not in feb


def test_elections_retained_after_date_and_historical_lookup_never_uses_current_geography():
    def refuse(*args, **kwargs):
        raise AssertionError(
            "Historical lookup must not fetch current address geography"
        )

    service = CandidateLookupService(
        fetch=refuse, now=lambda: datetime(2027, 1, 1, tzinfo=UTC)
    )
    elections = service.elections()
    assert [x["id"] for x in elections] == ["8334", "170"]
    assert records.default_election(elections, today=date(2026, 10, 8)) == "8334"
    assert records.default_election(elections, today=date(2027, 1, 1)) == "8334"
    response, catalogue = service.lookup("PRIVATE ADDRESS", "170")
    assert response == {
        "kind": "historical-match-unavailable",
        "electionId": "170",
        "message": "We couldn’t confirm the races for this address and election",
        "officialResultsUrl": elections[1]["officialResultsUrl"],
    }
    assert catalogue is None
    assert "PRIVATE" not in str(response)


def test_official_research_cursor_is_bound_to_person_and_keeps_own_dates(public_db):
    db = public_db
    person, other = records.reviewed_register()["people"][:2]
    first = records.research_records(db, UUID(person["id"]), limit=1)
    second = records.research_records(
        db, UUID(person["id"]), cursor=first["nextCursor"], limit=1
    )
    assert len(first["items"]) == len(second["items"]) == 1
    assert first["items"][0]["id"] != second["items"][0]["id"]
    assert second["nextCursor"] is None
    assert first["items"][0]["eventDate"] == "2024-11-12"
    assert first["items"][0]["source"]["checkedDate"] == "2026-10-08"
    assert (
        records.research_records(db, UUID(person["id"]), kind="article")["items"] == []
    )
    with pytest.raises(ValueError):
        records.research_records(db, UUID(other["id"]), cursor=first["nextCursor"])
    with pytest.raises(ValueError):
        records.research_records(db, UUID(person["id"]), cursor="not-a-cursor")


def test_public_read_has_no_private_claim_evidence_and_survives_requester_deletion(
    public_db,
):
    db = public_db
    person = records.reviewed_register()["people"][0]
    cid = person["candidateIds"][0]
    user = UserAccount(primary_email="PRIVATE-EMAIL@example.invalid")
    db.add(user)
    db.flush()
    claim = CandidateClaim(
        candidate_id=cid,
        user_id=user.id,
        status="pending",
        evidence_url="https://private.example.invalid",
        request_note="PRIVATE-NOTE",
    )
    db.add(claim)
    db.flush()
    output = str(records.load_person(db, person["id"], now=NOW)) + str(
        load_profile(db, cid, now=NOW)
    )
    assert "PRIVATE" not in output and "private.example" not in output
    db.delete(user)
    db.flush()
    assert records.load_person(db, person["id"], now=NOW)["research"]["items"]
    assert load_profile(db, cid, now=NOW)["result"]["outcome"] == "elected"


def test_people_routes_are_public_with_safe_errors_and_no_store(public_db):
    app = FastAPI()
    app.include_router(router)
    app.dependency_overrides[get_db] = lambda: public_db
    person = records.reviewed_register()["people"][0]
    with TestClient(app) as client:
        response = client.get("/people/" + person["id"])
        assert response.status_code == 200
        assert response.headers["cache-control"] == "no-store"
        assert client.get("/people/unknown").status_code == 404
        assert client.get("/people/unknown/research").status_code == 404
        assert (
            client.get(
                "/people/" + person["id"] + "/research?type=campaign"
            ).status_code
            == 400
        )
        assert client.get("/people/for-legislator/unknown").status_code == 404


@pytest.mark.parametrize(
    "change", ["test", "future", "wrong-race", "uncertified", "unknown-person"]
)
def test_importer_rejects_unsupported_or_guessed_facts(change):
    register = deepcopy(records.reviewed_register())
    if change == "test":
        register["races"][0]["testData"] = True
    elif change == "future":
        register["elections"][1]["date"] = "2030-11-05"
        for item in register["candidates"]:
            item["profile"]["election"]["date"] = "2030-11-05"
    elif change == "wrong-race":
        register["races"][0]["authorityScope"] = "county:27"
    elif change == "uncertified":
        register["races"][0]["status"] = register["races"][0]["payload"]["status"] = (
            "unofficial"
        )
    else:
        register["people"][0]["candidateIds"] = ["z" * 64]
    with pytest.raises(ValueError):
        validate_register(register, today=NOW.date())


def test_legislator_person_link_requires_existing_full_review_checks(
    subject,  # noqa: F811
    monkeypatch,
):
    # Reuse a complete real PostgreSQL legislature fixture, while the individual
    # identity evidence itself is explicitly synthetic and confined to this test.
    db, profile, period, evidence = subject
    pid = str(uuid4())
    profile["election"]["type"] = "general"
    profile["votingArea"] = "Example source district"
    register = {
        "legislatorPeople": [
            {
                "id": pid,
                "candidateId": profile["candidate"]["id"],
                "legislatorSlug": period.legislator.slug,
            }
        ]
    }
    monkeypatch.setattr(records, "reviewed_register", lambda: register)
    records.save_candidate_record(
        db, profile=profile, source_hash="e" * 64, checked_at=NOW
    )
    assert records.sync_reviewed_legislators(db, today=NOW.date()) == 1
    assert records.sync_reviewed_legislators(db, today=NOW.date()) == 0
    result = records.load_person(db, pid, now=NOW)
    assert result["legislator"]["slug"] == period.legislator.slug
    assert (
        records.person_for_legislator(db, period.legislator.slug, now=NOW)["id"] == pid
    )
    period.profile_url = "https://www.senate.mn/members/member_bio.html?leg_id=123"
    assert records.load_person(db, pid, now=NOW)["elections"] == []
    assert records.person_for_legislator(db, period.legislator.slug, now=NOW) is None


def test_election_ended_uses_minnesota_midnight_not_browser_or_utc(public_db):
    db = public_db
    profile = {
        "candidate": {"id": "d" * 64, "name": "Cutoff example"},
        "election": {"id": "8334", "date": "2026-11-03", "type": "general"},
        "office": "Example office",
        "votingArea": "Example district",
        "source": {
            "authority": "Minnesota Secretary of State",
            "url": "https://myballotmn.sos.mn.gov/",
            "checkedDate": "2026-10-08",
        },
    }
    records.save_candidate_record(
        db, profile=profile, source_hash="e" * 64, checked_at=NOW
    )
    before = datetime(2026, 11, 4, 5, 59, 59, tzinfo=UTC)
    after = datetime(2026, 11, 4, 6, tzinfo=UTC)
    assert load_profile(db, "d" * 64, now=before)["electionEnded"] is False
    assert load_profile(db, "d" * 64, now=after)["electionEnded"] is True
