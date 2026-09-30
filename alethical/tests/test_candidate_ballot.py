"""Synthetic source shapes; no voter addresses or live service calls."""

from __future__ import annotations

import copy
import hashlib
import json
from dataclasses import FrozenInstanceError, replace
from datetime import date, datetime, timezone

import pytest

from alethical.pipeline.candidate_ballot import (
    AUTHORITY,
    SOURCE_URL,
    CandidateBallotError,
    StreetAddress,
    candidate_ballot_document,
    match_street_range,
    parse_candidate_ballot,
)

CHECKED = datetime(2026, 9, 30, 12, tzinfo=timezone.utc)
DAY = date(2026, 11, 3)


def candidate(**changes):
    row = {
        "UploadOfficeCode": "5000",
        "UploadCandidateCode": "9001",
        "OfficeTitle": "School Board Member (ISD #9999) (Elect 2)",
        "PartyName": "NONPARTISAN",
        "CandidateScreenName": "Example Candidate",
        "CampaignWebsite": "https://example.invalid/campaign",
        "QuestionId": "",
        "IsConstitutionalAmendment": "0",
    }
    return row | changes


def source(*rows, **context):
    return {
        "PollingResult": {
            "ElectionId": "8334",
            "ElectionDate": "11/03/2026 00:00:00",
            "FullElectionDescription": "11/03/2026 STATE GENERAL ELECTION",
            "CountyName": "Synthetic County",
            "PrecinctCode": "0001",
            "PrecinctName": "SYNTHETIC P-1",
            **context,
        },
        "Ballots": list(rows),
    }


def parse(payload=None, **options):
    body = json.dumps(payload if payload is not None else source(candidate())).encode()
    return parse_candidate_ballot(
        body,
        **{
            "expected_election_id": "8334",
            "expected_election_date": DAY,
            "checked_at": CHECKED,
            **options,
        },
    )


def test_minimal_immutable_records_and_original_hash():
    payload = source(candidate())
    body = json.dumps(payload).encode()
    parsed = parse(payload)
    assert parsed.source_sha256 == hashlib.sha256(body).hexdigest()
    assert parsed.authority == AUTHORITY
    assert parsed.source_url == SOURCE_URL
    assert parsed.checked_at == CHECKED
    assert parsed.election.election_date == DAY
    assert parsed.publication_status == "staged_only"
    race = parsed.races[0]
    record = race.candidates[0]
    assert race.coverage == "unknown"
    assert record.candidate_code == "9001"
    assert record.office_title == candidate()["OfficeTitle"]
    assert record.party_name == "NONPARTISAN"
    assert record.campaign_website == "https://example.invalid/campaign"
    with pytest.raises(FrozenInstanceError):
        record.name = "changed"
    json.dumps(candidate_ballot_document(parsed))


def test_private_source_fields_never_enter_normalized_index():
    payload = source(candidate(), FullStreetName="SYNTHETIC PRIVATE MARKER")
    payload["PollingResult"].update(
        ProdAddressRangeId=7777,
        Latitude=99,
        Longitude=99,
        SchoolSubDistrict="9",
    )
    payload["SampleBallots"] = [{"ImageFileId": "source-handle"}]
    document = json.dumps(candidate_ballot_document(parse(payload)))
    for private in (
        "SYNTHETIC PRIVATE MARKER",
        "ProdAddressRangeId",
        "7777",
        "Latitude",
        "Longitude",
        "PrecinctCode",
        "PrecinctName",
        "SYNTHETIC P-1",
        "source-handle",
        "SchoolSubDistrict",
    ):
        assert private not in document
    with pytest.raises(CandidateBallotError, match="omit lookup parameters"):
        parse(source_url=SOURCE_URL + "?prodAddressRangeId=7777")


def test_same_candidate_identity_across_precincts_and_source_order():
    rows = [
        candidate(),
        candidate(UploadCandidateCode="9002", CandidateScreenName="Alpha Example"),
    ]
    first = parse(source(*rows))
    second = parse(
        source(*reversed(rows), PrecinctCode="0002", PrecinctName="SYNTHETIC P-2")
    )
    assert first.races == second.races
    assert [x.name for x in first.races[0].candidates] == [
        "Alpha Example",
        "Example Candidate",
    ]


def test_local_code_collisions_do_not_merge_offices_or_counties():
    first = parse()
    second = parse(
        source(candidate(OfficeTitle="School Board Member (SSD #9999) (Elect 2)"))
    )
    third = parse(source(candidate(), CountyName="Another Synthetic County"))
    changed_name = parse(source(candidate(CandidateScreenName="Another Example")))
    ids = {x.races[0].candidates[0].stable_id for x in (first, second, third)}
    assert len(ids) == 3
    assert (
        changed_name.races[0].candidates[0].stable_id
        == first.races[0].candidates[0].stable_id
    )


def test_joint_ticket_not_split_and_names_containing_and_not_marked_tickets():
    rows = [
        candidate(
            UploadOfficeCode="0331",
            UploadCandidateCode="0401",
            OfficeTitle="Governor & Lt Governor",
            CandidateScreenName="Example A and Example B",
        ),
        candidate(CandidateScreenName="Example A and Example B"),
    ]
    records = [x for race in parse(source(*rows)).races for x in race.candidates]
    assert all(x.name == "Example A and Example B" for x in records)
    assert sum(x.is_joint_ticket for x in records) == 1


def test_ballot_questions_and_write_in_placeholders_are_not_candidates():
    rows = [
        candidate(),
        candidate(UploadCandidateCode="9901", CandidateScreenName="WRITE-IN"),
        {
            "QuestionId": "123",
            "IsConstitutionalAmendment": "0",
            "QuestionTextFull": "Synthetic question",
        },
        {"QuestionId": "", "IsConstitutionalAmendment": "1"},
    ]
    parsed = parse(source(*rows))
    assert len(parsed.races) == 1
    assert len(parsed.races[0].candidates) == 1
    assert "Synthetic question" not in json.dumps(candidate_ballot_document(parsed))


def test_empty_or_only_write_in_rows_never_claim_complete_coverage():
    assert parse(source()).races == ()
    parsed = parse(
        source(candidate(UploadCandidateCode="9901", CandidateScreenName="WRITE-IN"))
    )
    assert parsed.races[0].candidates == ()
    assert parsed.races[0].coverage == "unknown"


@pytest.mark.parametrize(
    "context",
    [
        {"ElectionId": "previous"},
        {"ElectionDate": "08/11/2026 00:00:00"},
        {"ElectionDate": "invalid"},
        {"ElectionId": ""},
        {"CountyName": ""},
        {"PrecinctName": ""},
        {"FullElectionDescription": ""},
    ],
)
def test_missing_or_wrong_election_and_scope_rejected(context):
    with pytest.raises(CandidateBallotError):
        parse(source(candidate(), **context))


@pytest.mark.parametrize(
    "payload",
    [{}, {"error": "service unavailable"}, [], {"PollingResult": {}, "Ballots": "bad"}],
)
def test_bad_envelopes_and_upstream_errors_rejected(payload):
    with pytest.raises(CandidateBallotError):
        parse(payload)


@pytest.mark.parametrize(
    "body", [b"", b"<html>challenge</html>", b"\xff", b'{"Ballots":[],"Ballots":[]}']
)
def test_invalid_bytes_and_duplicate_json_fields_rejected(body):
    with pytest.raises(CandidateBallotError):
        parse_candidate_ballot(
            body,
            expected_election_id="8334",
            expected_election_date=DAY,
            checked_at=CHECKED,
        )


def test_duplicate_same_records_deduplicate_but_conflicting_identity_fails():
    assert len(parse(source(candidate(), candidate())).races[0].candidates) == 1
    for changes in (
        {"CandidateScreenName": "Changed"},
        {"PartyName": "Changed"},
        {"CampaignWebsite": "https://example.invalid/changed"},
    ):
        with pytest.raises(
            CandidateBallotError, match="conflicting candidate identity"
        ):
            parse(source(candidate(), candidate(**changes)))


@pytest.mark.parametrize(
    "changes",
    [
        {"UploadCandidateCode": 9001},
        {"UploadOfficeCode": "500"},
        {"CandidateScreenName": ""},
        {"OfficeTitle": "bad\ntext"},
        {"IsConstitutionalAmendment": "unknown"},
        {"CampaignWebsite": "javascript:alert(1)"},
        {"CampaignWebsite": "https://fixture-user@example.invalid"},
    ],
)
def test_malformed_candidate_fields_fail_closed(changes):
    with pytest.raises(CandidateBallotError):
        parse(source(candidate(**changes)))


def test_missing_timezone_rejected():
    with pytest.raises(CandidateBallotError, match="timezone"):
        parse(checked_at=CHECKED.replace(tzinfo=None))


ADDRESS = StreetAddress("EXAMPLE ST N", "EXAMPLE CITY", "MN", "99999", 100)


def street(**changes):
    return {
        "ProdAddressRangeId": 123,
        "OddEvenInd": "E",
        "HouseNumberLow": 100,
        "HouseNumberHigh": 110,
        "HouseNumberSuffix": None,
        "FullStreetName": "EXAMPLE ST N ",
        "CityName": "EXAMPLE CITY",
        "StateCode": "MN",
        "ZipCode": "99999",
        "DisplayUnitNbr": False,
        "UnitNumberRange": None,
        **changes,
    }


def test_exact_range_parity_inclusive_endpoints_and_complete_directions():
    assert match_street_range([street()], ADDRESS).range_id == 123
    assert (
        match_street_range([street()], replace(ADDRESS, house_number=110)).range_id
        == 123
    )
    assert (
        match_street_range(
            [street(OddEvenInd="O")], replace(ADDRESS, house_number=101)
        ).range_id
        == 123
    )
    assert (
        match_street_range(
            [street(OddEvenInd="B")], replace(ADDRESS, house_number=101)
        ).range_id
        == 123
    )
    for changes in (
        {"street": "EXAMPLE ST S"},
        {"city": "OTHER CITY"},
        {"zip_code": "99998"},
        {"house_number": 99},
        {"house_number": 111},
        {"house_number": 101},
    ):
        with pytest.raises(CandidateBallotError, match="missing or ambiguous"):
            match_street_range([street()], replace(ADDRESS, **changes))


def test_suffix_requires_exact_match_and_preserves_no_suffix_choice():
    rows = [street(), street(ProdAddressRangeId=124, HouseNumberSuffix="1/2")]
    assert match_street_range(rows, ADDRESS).range_id == 123
    assert (
        match_street_range(rows, replace(ADDRESS, house_number_suffix="1/2")).range_id
        == 124
    )


def test_unit_requirements_fail_closed_and_exact_unit_choices_work():
    rows = [
        street(DisplayUnitNbr=True, UnitNumberRange="UNIT A"),
        street(ProdAddressRangeId=124, DisplayUnitNbr=True, UnitNumberRange="UNIT B"),
    ]
    assert match_street_range(rows, replace(ADDRESS, unit="UNIT A")).range_id == 123
    with pytest.raises(CandidateBallotError):
        match_street_range(rows, ADDRESS)
    with pytest.raises(CandidateBallotError, match="unresolved"):
        match_street_range(
            [street(DisplayUnitNbr=True)], replace(ADDRESS, unit="UNIT A")
        )
    with pytest.raises(CandidateBallotError):
        match_street_range(
            [street(DisplayUnitNbr=True, UnitNumberRange="101-110")],
            replace(ADDRESS, unit="105"),
        )


def test_ambiguous_rows_never_choose_first_even_if_ids_repeat():
    for rows in ([street(), street(ProdAddressRangeId=124)], [street(), street()]):
        with pytest.raises(CandidateBallotError, match="ambiguous"):
            match_street_range(rows, ADDRESS)


@pytest.mark.parametrize(
    "changes",
    [
        {"OddEvenInd": "unknown"},
        {"HouseNumberLow": "100"},
        {"HouseNumberHigh": 99},
        {"ProdAddressRangeId": True},
        {"DisplayUnitNbr": "false"},
        {"StateCode": None},
    ],
)
def test_malformed_matching_street_rows_rejected(changes):
    with pytest.raises(CandidateBallotError):
        match_street_range([street(**changes)], ADDRESS)


def test_matching_does_not_mutate_or_retain_address_table():
    rows = [street()]
    original = copy.deepcopy(rows)
    result = match_street_range(rows, ADDRESS)
    assert rows == original
    assert set(result.__dict__) == {"range_id"}
    for changes in ({"state": "WI"}, {"zip_code": "bad"}, {"house_number": True}):
        with pytest.raises(CandidateBallotError):
            match_street_range(rows, replace(ADDRESS, **changes))


@pytest.mark.parametrize("label", ["Write In", "WRITE IN", "write-in, if any"])
def test_reserved_write_in_code_does_not_depend_on_display_spelling(label):
    parsed = parse(
        source(candidate(UploadCandidateCode="9901", CandidateScreenName=label))
    )
    assert all(not race.candidates for race in parsed.races)
