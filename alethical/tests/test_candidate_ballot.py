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
    CandidateAddressNotFound,
    CandidateBallotError,
    CandidateUnitRangesNeeded,
    CandidateUnitRequired,
    StreetAddress,
    candidate_ballot_document,
    match_street_range,
    parse_candidate_ballot,
    parse_unit_ranges,
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


def test_school_code_collisions_keep_distinct_districts_and_reuse_same_district():
    first = parse()
    second = parse(
        source(candidate(OfficeTitle="School Board Member (SSD #9999) (Elect 2)"))
    )
    third = parse(source(candidate(), CountyName="Another Synthetic County"))
    changed_name = parse(source(candidate(CandidateScreenName="Another Example")))
    ids = {x.races[0].candidates[0].stable_id for x in (first, second, third)}
    assert len(ids) == 2
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
    with pytest.raises(CandidateUnitRangesNeeded):
        match_street_range(
            [street(DisplayUnitNbr=True)], replace(ADDRESS, unit="UNIT A")
        )
    with pytest.raises(CandidateBallotError, match="unresolved"):
        match_street_range(
            [street(DisplayUnitNbr=True)], replace(ADDRESS, unit="UNIT A"), ()
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


@pytest.mark.parametrize(
    "title",
    [
        "U.S. Senator",
        "Governor & Lt Governor",
        "Secretary of State",
        "State Auditor",
        "Attorney General",
        "U.S. Representative District 5",
        "State Senator District 59",
        "State Representative District 59B",
        "Associate Justice - Supreme Court 1",
        "Judge - Court of Appeals 7",
        "Judge - 4th District Court 1",
        "School Board Member At Large (SSD #1) (Elect 2)",
        "School Board Member District 2 (ISD #2142)",
    ],
)
def test_explicit_jurisdiction_records_have_one_identity_across_counties(title):
    first = parse(source(candidate(OfficeTitle=title), CountyName="County A"))
    second = parse(source(candidate(OfficeTitle=title), CountyName="County B"))
    assert first.races[0].stable_id == second.races[0].stable_id
    assert (
        first.races[0].candidates[0].stable_id
        == second.races[0].candidates[0].stable_id
    )


@pytest.mark.parametrize(
    "title",
    [
        "County Attorney",
        "County Commissioner District 1",
        "Mayor (Example)",
        "Unrecognized Office",
    ],
)
def test_county_and_unknown_jurisdictions_never_merge_across_counties(title):
    first = parse(source(candidate(OfficeTitle=title), CountyName="County A"))
    second = parse(source(candidate(OfficeTitle=title), CountyName="County B"))
    assert first.races[0].stable_id != second.races[0].stable_id


def test_school_type_number_subdistrict_and_municipality_remain_part_of_identity():
    titles = [
        "School Board Member District 1 (ISD #1)",
        "School Board Member District 2 (ISD #1)",
        "School Board Member District 1 (SSD #1)",
        "School Board Member District 1 (ISD #11)",
        "Mayor (City A)",
        "Mayor (City B)",
    ]
    assert len(
        {
            parse(source(candidate(OfficeTitle=title))).races[0].stable_id
            for title in titles
        }
    ) == len(titles)


def test_unit_at_an_unmarked_house_reads_that_houses_only_range():
    # MyBallot asks for no unit on an unmarked range: the whole house is in it.
    assert (
        match_street_range([street()], replace(ADDRESS, unit="UNIT A")).range_id == 123
    )
    # A house that also has a range marked for units never lets the unmarked one
    # stand in for a unit outside the marked list.
    marked = street(DisplayUnitNbr=True, ProdAddressRangeId=124)
    units = parse_unit_ranges(
        [
            {
                "ProdAddressRangeId": 124,
                "UnitNumberRange": "1 - 9",
                "HouseNumberRange": "100 - 100",
                "OddEvenInd": "E",
            }
        ]
    )
    with pytest.raises(CandidateAddressNotFound):
        match_street_range([street(), marked], replace(ADDRESS, unit="UNIT 12"), units)
    with pytest.raises(CandidateAddressNotFound):
        match_street_range([street(), marked], replace(ADDRESS, unit="UNIT 5"), units)
    with pytest.raises(CandidateUnitRequired):
        match_street_range([marked], ADDRESS, units)


# Minnesota's own unit-number ranges, read from MyBallot on 9 October 2026.
OFFICIAL_UNITS = json.loads(
    (
        __import__("pathlib").Path(__file__).parent
        / "fixtures"
        / "sos_unit_number_ranges_2026-10-09.json"
    ).read_text()
)


def official(street_name: str, city: str | None = None):
    found = next(
        s
        for s in OFFICIAL_UNITS["streets"]
        if s["street"] == street_name and city in (None, s["city"])
    )
    return found["GetStreets_rows"], parse_unit_ranges(found["GetUnitNumberRanges"])


def unit_address(rows, house: int, unit: str = "") -> StreetAddress:
    row = rows[0]
    return StreetAddress(
        row["FullStreetName"].strip(),
        row["CityName"].strip(),
        "MN",
        row["ZipCode"],
        house,
        "",
        unit,
    )


@pytest.mark.parametrize(
    ("unit", "range_id"),
    [
        ("101", 313576),
        ("248", 313576),  # inclusive upper endpoint
        ("APT 250", 313578),  # a 1-unit range of its own
        ("#250", 313578),
        ("Unit 252", 313577),
        ("apt. 663", 313577),
        ("0101", 313576),
    ],
)
def test_official_numeric_unit_ranges_choose_the_one_containing_ballot_range(
    unit, range_id
):
    rows, units = official("8TH AVE S")
    assert (
        match_street_range(rows, unit_address(rows, 100, unit), units).range_id
        == range_id
    )


@pytest.mark.parametrize("unit", ["100", "249", "251", "664", "250A", "B", "1-2"])
def test_units_outside_every_official_range_are_refused(unit):
    rows, units = official("8TH AVE S")
    with pytest.raises(CandidateAddressNotFound):
        match_street_range(rows, unit_address(rows, 100, unit), units)


def test_unit_required_by_the_source_is_never_skipped_or_guessed():
    rows, units = official("8TH AVE S")
    with pytest.raises(CandidateAddressNotFound):
        match_street_range(rows, unit_address(rows, 100), units)
    # A general range at the same house never stands in for the missing unit.
    general = street(
        FullStreetName=rows[0]["FullStreetName"],
        CityName=rows[0]["CityName"],
        ZipCode=rows[0]["ZipCode"],
        HouseNumberLow=2,
        HouseNumberHigh=200,
        ProdAddressRangeId=999,
    )
    with pytest.raises(CandidateAddressNotFound):
        match_street_range([*rows, general], unit_address(rows, 100), units)


def test_source_defined_text_unit_and_house_parity():
    rows, units = official("GROVELAND AVE")
    for unit in ("SIDE", "side", "Unit Side"):
        assert (
            match_street_range(rows, unit_address(rows, 511, unit), units).range_id
            == 373719
        )
    with pytest.raises(CandidateAddressNotFound):
        match_street_range(rows, unit_address(rows, 511, "FRONT"), units)
    rows, units = official("UNIVERSITY AVE W")
    # OddEvenInd O names house 625's side of the street, not odd apartments.
    assert (
        match_street_range(rows, unit_address(rows, 625, "202"), units).range_id
        == 312511
    )
    with pytest.raises(CandidateAddressNotFound):
        match_street_range(rows, unit_address(rows, 624, "202"), units)


def test_same_street_in_2_postal_cities_keeps_each_citys_own_unit_list():
    rows, units = official("UTICA AVE S", "ST LOUIS PARK")
    assert (
        match_street_range(rows, unit_address(rows, 1511, "305"), units).range_id
        == 313399
    )
    gv_rows, gv_units = official("UTICA AVE S", "GOLDEN VALLEY")
    assert match_street_range(
        gv_rows, unit_address(gv_rows, 1513, "330"), gv_units
    ) == match_street_range(gv_rows, unit_address(gv_rows, 1513, "#330"), gv_units)
    assert (
        match_street_range(
            gv_rows, unit_address(gv_rows, 1513, "330"), gv_units
        ).range_id
        == 313392
    )
    # St Louis Park's list says nothing about Golden Valley's 1513.
    with pytest.raises(CandidateBallotError, match="unresolved") as raised:
        match_street_range(gv_rows, unit_address(gv_rows, 1513, "330"), units)
    assert not isinstance(raised.value, CandidateAddressNotFound)


def test_unit_lists_are_requested_only_when_the_source_flags_the_range():
    rows, _ = official("8TH AVE S")
    with pytest.raises(CandidateUnitRangesNeeded):
        match_street_range(rows, unit_address(rows, 100, "101"))
    assert match_street_range([street()], ADDRESS).range_id == 123


def test_overlapping_or_unprovable_unit_ranges_refuse():
    rows = [
        street(DisplayUnitNbr=True, ProdAddressRangeId=1),
        street(DisplayUnitNbr=True, ProdAddressRangeId=2),
    ]

    def entry(range_id, label, houses="100 - 100", parity="E"):
        return {
            "ProdAddressRangeId": range_id,
            "UnitNumberRange": label,
            "HouseNumberRange": houses,
            "OddEvenInd": parity,
        }

    overlap = parse_unit_ranges([entry(1, "100 - 200"), entry(2, "150 - 250")])
    assert match_street_range(rows, replace(ADDRESS, unit="120"), overlap).range_id == 1
    with pytest.raises(CandidateAddressNotFound):
        match_street_range(rows, replace(ADDRESS, unit="160"), overlap)
    span = parse_unit_ranges([entry(1, "1A - 1F"), entry(2, "200 - 300")])
    # No order is invented between letters: only an exact endpoint is provable.
    with pytest.raises(CandidateAddressNotFound):
        match_street_range(rows, replace(ADDRESS, unit="1C"), span)
    assert match_street_range(rows, replace(ADDRESS, unit="1F"), span).range_id == 1
    # A letter span cannot rule a number out, so the building's answer stays unproven.
    with pytest.raises(CandidateAddressNotFound):
        match_street_range(rows, replace(ADDRESS, unit="250"), span)
    # An entry for another house or the other side of the street is not this unit.
    for other in (
        parse_unit_ranges([entry(1, "1 - 9", houses="102 - 102")]),
        parse_unit_ranges([entry(1, "1 - 9", parity="O")]),
    ):
        with pytest.raises(CandidateBallotError, match="unresolved"):
            match_street_range(rows[:1], replace(ADDRESS, unit="5"), other)
    assert (
        match_street_range(
            rows[:1],
            replace(ADDRESS, unit="5"),
            parse_unit_ranges([entry(1, "1 - 9", parity="B")]),
        ).range_id
        == 1
    )


@pytest.mark.parametrize(
    "payload",
    [
        {"message": "other"},
        [{"ProdAddressRangeId": "1", "UnitNumberRange": "1 - 2"}],
        [
            {
                "ProdAddressRangeId": 1,
                "UnitNumberRange": "",
                "HouseNumberRange": "1 - 1",
                "OddEvenInd": "B",
            }
        ],
        [
            {
                "ProdAddressRangeId": 1,
                "UnitNumberRange": "1 - 2",
                "HouseNumberRange": "9 - 1",
                "OddEvenInd": "B",
            }
        ],
        [
            {
                "ProdAddressRangeId": 1,
                "UnitNumberRange": "1 - 2",
                "HouseNumberRange": "1 - 1",
                "OddEvenInd": "X",
            }
        ],
    ],
)
def test_malformed_unit_lists_are_source_failures(payload):
    with pytest.raises(CandidateBallotError):
        parse_unit_ranges(payload)


@pytest.mark.parametrize(
    ("unit", "range_id"),
    [("Apt #250", 313578), ("Apt.250", 313578), ("UNIT. 101", 313576)],
)
def test_unit_label_spellings_read_the_same_number(unit, range_id):
    rows, units = official("8TH AVE S")
    assert (
        match_street_range(rows, unit_address(rows, 100, unit), units).range_id
        == range_id
    )


@pytest.mark.parametrize("unit", ["Apt ²", "Apt ①", "Apt ٢٥٠", "Apt 2 5 0"])
def test_non_ascii_or_spaced_digits_are_refused_never_crash(unit):
    rows, units = official("8TH AVE S")
    with pytest.raises(CandidateAddressNotFound):
        match_street_range(rows, unit_address(rows, 100, unit), units)


def test_off_format_labels_and_unmatched_listed_ranges_stay_unproven():
    rows = [
        street(DisplayUnitNbr=True, ProdAddressRangeId=1),
        street(DisplayUnitNbr=True, ProdAddressRangeId=2),
    ]

    def entry(range_id, label):
        return {
            "ProdAddressRangeId": range_id,
            "UnitNumberRange": label,
            "HouseNumberRange": "100 - 100",
            "OddEvenInd": "E",
        }

    for label in ("101-110", "101 -110", "APT 101 - APT 110"):
        units = parse_unit_ranges([entry(1, label), entry(2, "100 - 200")])
        with pytest.raises(CandidateAddressNotFound):
            match_street_range(rows, replace(ADDRESS, unit="105"), units)
    # A listed range for this house with no street row could also hold the unit.
    units = parse_unit_ranges([entry(1, "100 - 200"), entry(7, "100 - 200")])
    with pytest.raises(CandidateAddressNotFound):
        match_street_range(rows[:1], replace(ADDRESS, unit="105"), units)
    units = parse_unit_ranges([entry(1, "100 - 200"), entry(7, "300 - 400")])
    assert (
        match_street_range(rows[:1], replace(ADDRESS, unit="105"), units).range_id == 1
    )
