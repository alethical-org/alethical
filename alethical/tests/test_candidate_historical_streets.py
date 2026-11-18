"""Dated street evidence must agree with a complete official address and precinct."""

import json
from dataclasses import replace

import pytest

from alethical.api.services import (
    candidate_historical_streets as streets,
    candidate_lookup,
)
from alethical.pipeline.candidate_ballot import StreetAddress, StreetRangeMatch

ADDRESS = StreetAddress("MAY ST", "WABASSO", "MN", "56293", 1333)
REPORT = {
    "CountyName": "Redwood",
    "PrecinctCode": "0195",
    "LegDistrict": "15B",
    "HouseDistrict": "7",
    "SenateDistrict": "15",
    "FullStreetName": "MAY ST ",
    "CityName": "WABASSO",
    "ZipCode": "56293",
    "HouseNumberLow": "1",
    "HouseNumberHigh": "2000",
    "OddEvenInd": "B",
    "HouseNumberSuffix": "",
    "UnitNumberRange": None,
}


def match(monkeypatch, report):
    # Exercise the non-facility path independently of the public school at this address.
    monkeypatch.setattr(streets, "facility_points", lambda _: set())
    monkeypatch.setattr(candidate_lookup, "historical_address_points", lambda _: set())

    def fetch(url, params):
        assert url == candidate_lookup.SOURCE_URL and params == {
            "prodAddressRangeId": 105537
        }
        return json.dumps({"PollingResult": report}).encode()

    return candidate_lookup.CandidateLookupService(fetch=fetch)._historical_match(
        ADDRESS, StreetRangeMatch(105537)
    )


def test_dated_census_range_matches_public_road_and_official_precinct(monkeypatch):
    assert streets.street_precinct(ADDRESS) == "640195"
    area = match(monkeypatch, REPORT)
    assert area and (area.county_code, area.precinct_code) == ("64", "0195")


@pytest.mark.parametrize(
    "change",
    [
        {"FullStreetName": "MAY AVE"},
        {"CountyName": "Brown"},
        {"CityName": "Redwood Falls"},
        {"PrecinctCode": "0190"},
        {"HouseNumberHigh": "1000"},
        {"OddEvenInd": "E"},
        {"HouseDistrict": "6"},
        {"LegDistrict": "15A"},
        {"SenateDistrict": "14"},
        {"ZipCode": "56292"},
        {"HouseNumberSuffix": "A"},
        {"UnitNumberRange": "1 - 3"},
        {"HouseNumberLow": "?"},
    ],
)
def test_census_match_cannot_use_a_different_address_or_district(monkeypatch, change):
    assert match(monkeypatch, REPORT | change) is None


def test_conflicting_or_inconclusive_road_segments_keep_the_location_unconfirmed(
    monkeypatch,
):
    ranges = [[1001, 1399, "O", "640195"], [1201, 1501, "O", ""]]
    monkeypatch.setattr(streets, "_street_ranges", lambda _: {"MAY ST": ranges})
    assert streets.street_precinct(ADDRESS) is None
    ranges[-1][-1] = "640196"
    assert streets.street_precinct(ADDRESS) is None
    assert streets.street_precinct(replace(ADDRESS, house_number_suffix="B")) is None


def test_multiple_facilities_and_address_points_must_agree(monkeypatch):
    source = streets.facility_points(ADDRESS)
    assert source and not streets.facility_points(replace(ADDRESS, unit="Apt 4"))
    monkeypatch.setattr(
        candidate_lookup, "historical_address_points", lambda _: {(46.6, -94.3)}
    )
    assert (
        candidate_lookup.CandidateLookupService()._historical_match(
            ADDRESS, StreetRangeMatch(1)
        )
        is None
    )


def test_offline_address_service_can_use_independently_confirmed_dated_evidence(
    monkeypatch,
):
    def offline(*args):
        raise candidate_lookup._AddressPointServiceOffline()

    monkeypatch.setattr(candidate_lookup, "historical_address_points", offline)
    lookup = candidate_lookup.CandidateLookupService(
        fetch=lambda *args: json.dumps({"PollingResult": REPORT}).encode()
    )
    area = lookup._historical_match(ADDRESS, StreetRangeMatch(105537))
    assert area and area.precinct_code == "0195"
    with pytest.raises(candidate_lookup.CandidateLookupUnavailable):
        lookup._historical_match(
            replace(ADDRESS, street="UNKNOWN"), StreetRangeMatch(105537)
        )


def test_missing_supplemental_report_never_assigns_a_street_only_ballot(monkeypatch):
    monkeypatch.setattr(candidate_lookup, "historical_address_points", lambda _: set())
    monkeypatch.setattr(streets, "facility_points", lambda _: set())
    service = candidate_lookup.CandidateLookupService(
        fetch=lambda *args: b'{"PollingResult":{},"PollingResult":{}}'
    )
    with pytest.raises(candidate_lookup.CandidateLookupUnavailable):
        service._historical_match(ADDRESS, StreetRangeMatch(105537))


def test_lancaster_road_proves_only_an_unanimous_precinct(monkeypatch):
    # Synthetic number. The 2024 MnDOT city map names the physical street Central Avenue.
    a = StreetAddress("CENTRAL AVE N", "LANCASTER", "MN", "56735", 125)
    source = {"CENTRAL AVENUE": [[101, 199, "O", "350100"]]}
    monkeypatch.setattr(streets, "_street_ranges", lambda _: source)
    assert streets.lancaster_central_precinct(a) == "350100"
    assert streets.lancaster_central_precinct(replace(a, city="HALLOCK")) is None
    assert (
        streets.lancaster_central_precinct(replace(a, street="CENTRAL AVE E")) is None
    )
    assert streets.lancaster_central_precinct(replace(a, house_number=126)) is None
    for code in ("", "350115"):
        source["S CENTRAL AVENUE"] = [[101, 199, "O", code]]
        assert streets.lancaster_central_precinct(a) is None
