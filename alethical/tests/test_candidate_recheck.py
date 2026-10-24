"""Official rechecks must never promote a stale or different profile identity."""

from __future__ import annotations

import copy
import hashlib
import json
from dataclasses import FrozenInstanceError
from datetime import UTC, date, datetime

import pytest

from alethical.api.services import candidate_recheck as recheck
from alethical.api.services.candidate_lookup import CandidateLookupUnavailable
from alethical.pipeline.candidate_ballot import (
    SOURCE_URL,
    BallotCatalogue,
    parse_candidate_ballot,
)

ELECTION_DATE = date(2026, 11, 3)


def source(reference):
    """Public candidate projection rebuilt from retained real official rows.

    Reference register retains normalized candidates, not the response's address
    envelope. Add private sentinels here to prove the public output strips it.
    """
    return {
        "PollingResult": {
            "ElectionId": reference.election.election_id,
            "ElectionDate": "11/03/2026 00:00:00",
            "FullElectionDescription": reference.election.description,
            "CountyName": reference.candidates[0].county_name,
            "PrecinctCode": "PUBLIC REFERENCE PRECINCT",
            "PrecinctName": "PUBLIC REFERENCE NAME",
            "FullStreetName": "PRIVATE ADDRESS SENTINEL",
        },
        "Ballots": [
            {
                "UploadOfficeCode": candidate.office_code,
                "UploadCandidateCode": candidate.candidate_code,
                "OfficeTitle": candidate.office_title,
                "PartyName": candidate.party_name or "",
                "CandidateScreenName": candidate.name,
                "CampaignWebsite": candidate.campaign_website or "",
                "QuestionId": "",
                "IsConstitutionalAmendment": "0",
            }
            for candidate in reference.candidates
        ],
    }


def profile(reference, candidate):
    catalogue = BallotCatalogue(
        reference.election,
        "Minnesota Secretary of State",
        SOURCE_URL,
        reference.checked_at,
        reference.source_sha256,
        (),
    )
    return recheck._profile(candidate, catalogue)


@pytest.fixture
def mock_source(monkeypatch):
    references = recheck._references()
    bodies = {ref.range_id: source(ref) for ref in references}
    calls = []

    def fetch(url, params):
        calls.append((url, params))
        return json.dumps(bodies[params["prodAddressRangeId"]]).encode()

    monkeypatch.setattr(recheck, "official_bytes", fetch)
    monkeypatch.setattr(recheck, "_MIN_START_INTERVAL", 0)
    monkeypatch.setattr(recheck, "_LAST_START", 0)
    return references, bodies, calls


def test_all_retained_source_memberships_keep_original_profile_ids(mock_source):
    references, _, calls = mock_source
    all_ids = set()
    appearances = 0
    for ref in references:
        parsed = parse_candidate_ballot(
            json.dumps(source(ref)).encode(),
            expected_election_id="8334",
            expected_election_date=ELECTION_DATE,
            checked_at=datetime.now(UTC),
        )
        assert {c.stable_id for race in parsed.races for c in race.candidates} == {
            c.stable_id for c in ref.candidates
        }
        for candidate in ref.candidates:
            appearances += 1
            if candidate.stable_id in all_ids:
                continue
            all_ids.add(candidate.stable_id)
            result = recheck.fetch_candidate_recheck(
                candidate.stable_id,
                profile(ref, candidate),
                "8334",
                ELECTION_DATE,
            )
            assert result.candidate.stable_id == candidate.stable_id
            assert result.candidate.name == candidate.name
            assert (
                result.public_payload()["election"]["label"]
                == "November 3, 2026 general election"
            )
            assert result.matches_record(
                candidate.stable_id, profile(ref, candidate), "8334", ELECTION_DATE
            )
            output = json.dumps(result.public_payload())
            for excluded in (
                "PRIVATE ADDRESS SENTINEL",
                "prodAddressRangeId",
                "PrecinctCode",
                "PUBLIC REFERENCE NAME",
            ):
                assert excluded not in output
    assert len(all_ids) == 112
    assert appearances == 158
    assert len(calls) == 112
    assert {params["prodAddressRangeId"] for _, params in calls} == {
        316911,
        364000,
        801,
    }


@pytest.mark.parametrize(
    ("field", "value"),
    [
        ("CandidateScreenName", "Different Person"),
        ("PartyName", "Different Party"),
        ("OfficeTitle", "Different Office"),
        ("UploadOfficeCode", "9999"),
        ("UploadCandidateCode", "9999"),
    ],
)
def test_changed_identity_never_returns_freshness(mock_source, field, value):
    references, bodies, calls = mock_source
    ref = references[0]
    candidate = ref.candidates[0]
    bodies[ref.range_id]["Ballots"][0][field] = value
    with pytest.raises(recheck.CandidateRecheckUnavailable) as error:
        recheck.fetch_candidate_recheck(
            candidate.stable_id, profile(ref, candidate), "8334", ELECTION_DATE
        )
    assert error.value.reason in {"identity_mismatch", "candidate_missing"}
    assert not hasattr(error.value, "checked_at")
    assert len(calls) == 1


def test_joint_ticket_other_member_name_change_fails(mock_source):
    references, bodies, _ = mock_source
    ref = references[0]
    candidate = next(c for c in ref.candidates if c.is_joint_ticket)
    row = next(
        row
        for row in bodies[ref.range_id]["Ballots"]
        if row["CandidateScreenName"] == candidate.name
    )
    row["CandidateScreenName"] += " and A Different Person"
    with pytest.raises(recheck.CandidateRecheckUnavailable, match="identity_mismatch"):
        recheck.fetch_candidate_recheck(
            candidate.stable_id, profile(ref, candidate), "8334", ELECTION_DATE
        )


def test_website_can_change_and_only_source_fields_publish(mock_source):
    references, bodies, _ = mock_source
    ref, candidate = references[0], references[0].candidates[0]
    bodies[ref.range_id]["Ballots"][0]["CampaignWebsite"] = "https://example.org/new"
    saved = profile(ref, candidate)
    saved["private_claim_evidence"] = "DO NOT PUBLISH"
    saved["prodAddressRangeId"] = 999999
    result = recheck.fetch_candidate_recheck(
        candidate.stable_id, saved, "8334", ELECTION_DATE
    )
    assert result.public_payload()["website"] == "https://example.org/new"
    assert result.public_payload()["source"]["url"] == "https://myballotmn.sos.mn.gov/"
    assert "DO NOT PUBLISH" not in json.dumps(result.public_payload())
    assert (
        result.source_sha256
        == hashlib.sha256(json.dumps(bodies[ref.range_id]).encode()).hexdigest()
    )
    with pytest.raises(FrozenInstanceError):
        setattr(result.candidate, "name", "Changed")
    output = result.public_payload()
    output["candidate"]["name"] = "Changed"
    assert result.public_payload()["candidate"]["name"] == candidate.name


@pytest.mark.parametrize("field", ["name", "party", "office", "votingArea", "id"])
def test_saved_record_changed_before_or_during_fetch_fails(mock_source, field):
    refs, _, calls = mock_source
    ref, candidate = refs[0], refs[0].candidates[0]
    saved = profile(ref, candidate)
    result = recheck.fetch_candidate_recheck(
        candidate.stable_id, saved, "8334", ELECTION_DATE
    )
    changed = copy.deepcopy(saved)
    target = changed["candidate"] if field in {"name", "party", "id"} else changed
    target[field] = "changed"
    assert not result.matches_record(
        candidate.stable_id, changed, "8334", ELECTION_DATE
    )
    with pytest.raises(recheck.CandidateRecheckUnavailable, match="identity_mismatch"):
        recheck.fetch_candidate_recheck(
            candidate.stable_id, changed, "8334", ELECTION_DATE
        )
    assert len(calls) == 1


@pytest.mark.parametrize(
    ("change", "reason"),
    [
        ("election", "election_mismatch"),
        ("missing", "candidate_missing"),
        ("conflict", "invalid_source"),
    ],
)
def test_source_changes_fail_closed(mock_source, change, reason):
    refs, bodies, calls = mock_source
    ref, candidate = refs[0], refs[0].candidates[0]
    body = bodies[ref.range_id]
    if change == "election":
        body["PollingResult"]["ElectionId"] = "9999"
    elif change == "missing":
        body["Ballots"] = body["Ballots"][1:]
    else:
        duplicate = dict(body["Ballots"][0], CandidateScreenName="Conflicting name")
        body["Ballots"].append(duplicate)
    with pytest.raises(recheck.CandidateRecheckUnavailable, match=reason):
        recheck.fetch_candidate_recheck(
            candidate.stable_id, profile(ref, candidate), "8334", ELECTION_DATE
        )
    assert len(calls) == 1


@pytest.mark.parametrize(
    "body", [b"<html>TEST RESULTS</html>", b'"double encoded"', b"{}", b"null"]
)
def test_malformed_responses_do_not_retry_or_publish(mock_source, monkeypatch, body):
    refs, _, _ = mock_source
    ref, candidate = refs[0], refs[0].candidates[0]
    calls = []
    monkeypatch.setattr(
        recheck, "official_bytes", lambda *args: calls.append(args) or body
    )
    with pytest.raises(recheck.CandidateRecheckUnavailable, match="invalid_source"):
        recheck.fetch_candidate_recheck(
            candidate.stable_id, profile(ref, candidate), "8334", ELECTION_DATE
        )
    assert len(calls) == 1


def test_transport_failure_bounded_retry_and_safe_reason(mock_source, monkeypatch):
    refs, _, _ = mock_source
    ref, candidate = refs[0], refs[0].candidates[0]
    calls = []

    def fetch(*args):
        calls.append(args)
        raise CandidateLookupUnavailable("PRIVATE SOURCE EXCEPTION")

    monkeypatch.setattr(recheck, "official_bytes", fetch)
    with pytest.raises(recheck.CandidateRecheckUnavailable) as error:
        recheck.fetch_candidate_recheck(
            candidate.stable_id, profile(ref, candidate), "8334", ELECTION_DATE
        )
    assert str(error.value) == "source_unavailable"
    assert len(calls) == 2
    assert error.value.__cause__ is None


def test_unknown_profile_cannot_supply_visitor_locator(mock_source):
    refs, _, calls = mock_source
    ref, candidate = refs[0], refs[0].candidates[0]
    saved = profile(ref, candidate)
    saved["candidate"]["id"] = "unknown"
    saved["prodAddressRangeId"] = 999999
    before = recheck.REFERENCE_PATH.read_bytes()
    with pytest.raises(
        recheck.CandidateRecheckUnavailable, match="reference_unavailable"
    ):
        recheck.fetch_candidate_recheck("unknown", saved, "8334", ELECTION_DATE)
    assert calls == []
    assert recheck.REFERENCE_PATH.read_bytes() == before


def test_busy_recheck_does_not_queue_unbounded_requests(mock_source):
    refs, _, calls = mock_source
    ref, candidate = refs[0], refs[0].candidates[0]
    assert recheck._FETCH_SLOTS.acquire(blocking=False)
    assert recheck._FETCH_SLOTS.acquire(blocking=False)
    try:
        with pytest.raises(recheck.CandidateRecheckUnavailable, match="busy"):
            recheck.fetch_candidate_recheck(
                candidate.stable_id, profile(ref, candidate), "8334", ELECTION_DATE
            )
    finally:
        recheck._FETCH_SLOTS.release()
        recheck._FETCH_SLOTS.release()
    assert calls == []


def test_address_lookup_does_not_update_independent_reference_register():
    from alethical.tests.test_candidate_lookup import ADDRESS, service

    before = recheck.REFERENCE_PATH.read_bytes()
    references = recheck._references()
    lookup, _ = service()
    lookup.lookup(ADDRESS, "8334")
    assert recheck.REFERENCE_PATH.read_bytes() == before
    assert recheck._references() is references
