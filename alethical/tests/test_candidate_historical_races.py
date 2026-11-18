"""The public historical roster is constrained by published election-day geography."""

from __future__ import annotations

from datetime import UTC, date, datetime
import json

import pytest
from sqlalchemy.orm import Session

from alethical.api.services.candidate_historical_geography import HistoricalGeography
from alethical.pipeline.candidate_ballot import parse_candidate_ballot
from alethical.api.services.candidate_historical_races import (
    ELECTION_KEY,
    _area,
    historical_candidate_results,
)
from alethical.db import models as m
from alethical.db.session import get_engine

WHEN = datetime(2026, 11, 8, 1, tzinfo=UTC)
SNAPSHOT = "f" * 64
SOURCE = "d" * 64
URL = "https://electionresultsfiles.sos.mn.gov/20261103/cand.txt"


def geography(**overrides):
    values = dict(
        precinct_name="Example",
        county_code="18",
        precinct_code="0055",
        municipality_code="07516",
        house_district="06B",
        senate_district="06",
        congressional_district="08",
        commissioner_district="02",
        judicial_district="09",
        ward="01",
        school_district="186",
        school_type="ISD",
        soil_water_district="8035",
        soil_water_name="Crow Wing",
        hospital_district=None,
        hospital_name=None,
        park_district=None,
        park_name=None,
    )
    return HistoricalGeography(**(values | overrides))


@pytest.mark.parametrize(
    "title,kind,jurisdiction,expected",
    [
        (
            "State Representative District 6B",
            "statewide_or_multicounty",
            "88",
            ("state", "House District 6B"),
        ),
        ("State Representative District 6A", "statewide_or_multicounty", "88", None),
        (
            "State Senator District 6",
            "statewide_or_multicounty",
            "88",
            ("state", "Senate District 6"),
        ),
        (
            "U.S. Representative District 8",
            "statewide_or_multicounty",
            "88",
            ("state", "Congressional District 8"),
        ),
        (
            "Judge - 9th District Court 4",
            "statewide_or_multicounty",
            "88",
            ("state", "Judicial District 9th"),
        ),
        ("Judge - 8th District Court 4", "statewide_or_multicounty", "88", None),
        ("County Sheriff", "county", "19", None),
        (
            "County Commissioner District 2",
            "county",
            "18",
            ("county", "Crow Wing County · District 2"),
        ),
        (
            "Mayor (Breezy Point)",
            "municipality",
            "municipality:7516",
            ("municipal", "Breezy Point"),
        ),
        (
            "Council Member (Breezy Point) (Elect 2)",
            "municipality",
            "municipality:7516",
            ("municipal", "Breezy Point"),
        ),
        (
            "Council Member Ward 1 (Example)",
            "municipality",
            "municipality:7516",
            ("municipal", "Example · Ward 1"),
        ),
        ("Council Member Ward 2 (Example)", "municipality", "municipality:7516", None),
        (
            "Council Member Section II (Example)",
            "municipality",
            "municipality:7516",
            None,
        ),
        (
            "Council Member District 1 (Example)",
            "municipality",
            "municipality:7516",
            None,
        ),
        (
            "School Board Member (ISD #186) (Elect 3)",
            "school_district",
            "school_district:186",
            ("school", "ISD #186 · Whole district"),
        ),
        (
            "School Board Member (SSD #186)",
            "school_district",
            "school_district:186",
            None,
        ),
        (
            "School Board Member (ISD #181)",
            "school_district",
            "school_district:181",
            None,
        ),
        (
            "School Board Member District 1 (ISD #186)",
            "school_district",
            "school_district:186",
            None,
        ),
        (
            "Hospital District Board Member (Example)",
            "hospital_municipal_seat",
            "hospital_municipal_seat:7516",
            None,
        ),
    ],
)
def test_proof_must_cover_the_whole_office(title, kind, jurisdiction, expected):
    assert _area(title, kind, jurisdiction, "Crow Wing", geography()) == expected


@pytest.fixture
def db(seed_database):
    with get_engine().connect() as connection:
        transaction = connection.begin()
        with Session(bind=connection) as db:
            yield db
        transaction.rollback()


def publish(db):
    db.add(
        m.ElectionComparisonSnapshot(
            id=SNAPSHOT,
            election_key=ELECTION_KEY,
            election_date=date(2026, 11, 3),
            stage="general",
            fetched_at=WHEN,
            first_published_at=WHEN,
            sources=[
                {
                    "file": "cand.txt",
                    "sha256": SOURCE,
                    "fetched_at": WHEN.isoformat(),
                    "url": URL,
                }
            ],
            coverage={"county_names": {"18": "Crow Wing"}},
        )
    )
    db.flush()
    db.add(m.ElectionComparisonCurrent(election_key=ELECTION_KEY, snapshot_id=SNAPSHOT))
    db.flush()


def add_race(db, race_id, title, jurisdiction, kind, precinct="0055"):
    choices = [
        {
            "name": "Registered name",
            "candidate_order_code": "9001",
            "candidate_stable_id": title + "-9001",
            "party": "NP",
            "is_write_in_aggregate": False,
            "votes": 0,
        },
        {
            "name": "WRITE-IN",
            "candidate_order_code": "9901",
            "is_write_in_aggregate": True,
            "votes": 10,
        },
    ]
    db.add(
        m.ElectionComparisonRace(
            snapshot_id=SNAPSHOT,
            id=race_id,
            label=title,
            office_id="0001",
            jurisdiction=jurisdiction,
            result_status="unofficial",
            payload={
                "jurisdiction_kind": kind,
                "candidate_source_sha256": SOURCE,
                "candidates": choices,
                "coverage": {"reconciled": True},
            },
        )
    )
    db.flush()
    db.add(
        m.ElectionComparisonPrecinct(
            snapshot_id=SNAPSHOT,
            race_id=race_id,
            county="18",
            key="18:" + precinct,
            name="Example",
            payload={"rows": [], "private_test_value": "never return"},
        )
    )
    db.flush()


def test_lookup_reads_only_the_published_snapshot_and_the_proven_half_of_a_split(db):
    publish(db)
    add_race(
        db,
        "1" * 64,
        "School Board Member (ISD #186) (Elect 3)",
        "school_district:186",
        "school_district",
    )
    add_race(
        db,
        "2" * 64,
        "School Board Member (ISD #181)",
        "school_district:181",
        "school_district",
    )
    add_race(db, "3" * 64, "Governor & Lt Governor", "88", "statewide_or_multicounty")
    add_race(
        db, "4" * 64, "U.S. Senator", "88", "statewide_or_multicounty", precinct="0001"
    )

    def lookup(**scope):
        return historical_candidate_results(
            db, address="Confirmed address", geography=geography(**scope)
        )

    result = lookup()
    assert result["kind"] == "results"
    assert result["electionEnded"] and not result["resultsAvailable"]
    assert {r["id"] for r in result["races"]} == {"1" * 64, "3" * 64}
    school = next(r for r in result["races"] if r["group"] == "school")
    assert school["seatCount"] == 3
    assert school["source"] == {
        "authority": "Minnesota Secretary of State",
        "url": URL,
        "checkedDate": "2026-11-07",
        "retained": True,
    }
    assert len(school["entries"]) == 1
    person = school["entries"][0]["candidate"]
    assert person["name"] == "Registered name"
    assert person["profileAvailable"] is False
    assert "votes" not in person and "outcome" not in person
    ticket = next(r for r in result["races"] if r["group"] == "state")["entries"][0]
    assert ticket["kind"] == "ticket" and not ticket["profileAvailable"]
    assert "private_test_value" not in str(result)
    assert {r["id"] for r in lookup(school_district="181")["races"]} == {
        "2" * 64,
        "3" * 64,
    }
    assert {r["id"] for r in lookup(school_type=None)["races"]} == {"3" * 64}
    assert lookup(precinct_code="9999")["kind"] == "historical-match-unavailable"
    db.get(m.ElectionComparisonSnapshot, SNAPSHOT).first_published_at = None
    db.flush()
    assert lookup()["kind"] == "historical-match-unavailable"


def test_nomination_district_is_not_always_the_voters_district():
    # In an at-large district both seats appearing in the precinct returns
    # are on the ballot. A district-numbered voting boundary is narrower.
    for number in ("2", "3"):
        title = f"Soil and Water Supervisor District {number}"
        assert _area(title, "county", "18", "Crow Wing", geography())
        metro = geography(soil_water_name="Dakota District 2", county_code="19")
        assert bool(_area(title, "county", "19", "Dakota", metro)) == (number == "2")
    east = geography(soil_water_name="Otter Tail East", county_code="56")
    assert _area(
        "Soil and Water Supervisor District 2 (East)",
        "county",
        "56",
        "Otter Tail",
        east,
    )
    assert not _area(
        "Soil and Water Supervisor District 2 (West)",
        "county",
        "56",
        "Otter Tail",
        east,
    )


def test_special_district_number_alone_cannot_join_different_boards():
    geo = geography(
        hospital_district="310",
        hospital_name="Canby Community",
        park_district="2",
        park_name="Three Rivers Park District",
    )
    assert _area(
        "Hospital District Board Member at Large (Canby Community) (Elect 3)",
        "hospital_district",
        "hospital_district:310",
        "",
        geo,
    )
    assert not _area(
        "Hospital District Board Member At Large (Pelican Valley)",
        "hospital_district",
        "hospital_district:310",
        "",
        geo,
    )
    assert not _area(
        "Hospital District Board Member 1 (Canby Community)",
        "hospital_district",
        "hospital_district:310",
        "",
        geo,
    )
    metro = geography(
        park_name="Minneapolis Park and Recreation Board",
        park_district="2",
        county_code="27",
    )
    assert not _area(
        "County Park Commissioner District 2", "county", "27", "Hennepin", metro
    )


def saved_profile(db, title):
    # Build the MyBallot ID using its original parser and source field names,
    # independent of how the result reader maps the separate returns register.
    source = {
        "PollingResult": {
            "ElectionId": "8334",
            "ElectionDate": "11/03/2026 00:00:00",
            "FullElectionDescription": "State General Election",
            "CountyName": "Crow Wing",
            "PrecinctCode": "0055",
            "PrecinctName": "Example",
        },
        "Ballots": [
            {
                "OfficeTitle": title,
                "UploadOfficeCode": "0001",
                "UploadCandidateCode": "9001",
                "CandidateScreenName": "Registered name",
                "PartyName": "NONPARTISAN",
            }
        ],
    }
    catalogue = parse_candidate_ballot(
        json.dumps(source).encode(),
        expected_election_id="8334",
        expected_election_date=date(2026, 11, 3),
        checked_at=WHEN,
    )
    item = catalogue.races[0].candidates[0]
    row = m.CandidateRecord(
        id=item.stable_id,
        election_id="8334",
        election_date=date(2026, 11, 3),
        source_sha256=SOURCE,
        checked_at=WHEN,
        public_payload={
            "candidate": {
                "id": item.stable_id,
                "name": item.name,
                "party": item.party_name,
            },
            "election": {"id": "8334", "date": "2026-11-03", "type": "general"},
            "office": title,
            "votingArea": "Minnesota"
            if title == "Governor & Lt Governor"
            else "Crow Wing County",
            "source": {
                "authority": "Minnesota Secretary of State",
                "url": "https://myballotmn.sos.mn.gov/",
            },
        },
    )
    db.add(row)
    db.flush()
    return row


def test_profiles_require_the_saved_election_source_party_name_and_exact_race_key(db):
    publish(db)
    add_race(db, "1" * 64, "Governor & Lt Governor", "88", "statewide_or_multicounty")
    add_race(db, "2" * 64, "County Sheriff", "18", "county")
    add_race(db, "3" * 64, "Attorney General", "88", "statewide_or_multicounty")
    ticket_profile = saved_profile(db, "Governor & Lt Governor")
    sheriff_profile = saved_profile(db, "County Sheriff")
    original = sheriff_profile.public_payload

    def lookup():
        roster = historical_candidate_results(
            db, address="Example", geography=geography()
        )
        return {race["office"]: race["entries"][0] for race in roster["races"]}

    offices = lookup()
    ticket = offices["Governor & Lt Governor"]
    assert ticket["profileAvailable"] and ticket["id"] == ticket_profile.id
    assert ticket["members"][0]["id"] == ticket_profile.id
    assert offices["County Sheriff"]["candidate"]["id"] == sheriff_profile.id
    assert not offices["Attorney General"]["candidate"]["profileAvailable"]
    for changed in [
        {"office": "County Attorney"},
        {"votingArea": "Another County"},
        {"election": {**original["election"], "date": "2024-11-05"}},
        {"candidate": {**original["candidate"], "name": "Another Candidate"}},
        {"candidate": {**original["candidate"], "party": "Republican"}},
        {"source": {**original["source"], "url": "https://other.example/"}},
    ]:
        sheriff_profile.public_payload = {**original, **changed}
        db.flush()
        person = lookup()["County Sheriff"]["candidate"]
        assert not person["profileAvailable"] and person["id"] != sheriff_profile.id


def test_known_school_gap_is_distinct_from_a_different_school(db):
    publish(db)
    add_race(db, "1" * 64, "County Sheriff", "18", "county")
    add_race(
        db,
        "2" * 64,
        "School Board Member (ISD #186)",
        "school_district:186",
        "school_district",
    )
    add_race(
        db,
        "3" * 64,
        "School Board Member District 2 (ISD #186)",
        "school_district:186",
        "school_district",
    )

    def school_gaps(**fields):
        roster = historical_candidate_results(
            db, address="Example", geography=geography(**fields)
        )
        return [
            g["office"]
            for g in roster["coverage"]
            if g["kind"] == "district-unconfirmed"
        ]

    assert school_gaps(school_district=None) == ["school board"]
    assert school_gaps(school_district="186") == ["school board"]
    assert school_gaps(school_district="181") == []
    assert school_gaps(school_district="186", school_type="SSD") == []
