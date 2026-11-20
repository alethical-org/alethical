"""Near-miss addresses become official choices the reader confirms, never guesses."""

from __future__ import annotations

import json
from types import SimpleNamespace

import pytest

from alethical.api.services import (
    candidate_historical_county_addresses as county_addresses,
    candidate_historical_streets as streets,
    candidate_lookup,
)
from alethical.api.services.candidate_lookup import (
    SOURCE_URL,
    STREETS_URL,
    CandidateLookupService,
    CandidateLookupUnavailable,
)
from alethical.api.services.representative_lookup import RepresentativeLookupNotFound
from alethical.pipeline.candidate_ballot import StreetAddress, StreetRangeMatch
from alethical.tests.test_candidate_ballot import street
from alethical.tests.test_candidate_lookup import ADDRESS, service


def rows_at(zip_code, **changes):
    return [street(ZipCode=zip_code, **changes)]


# A real Minnesota ZIP, so the ZIP reference can place it in Minnesota.
MN_ZIP = "56258"


@pytest.mark.parametrize(
    "street_name,typed",
    [
        ("BRUSSELS CT", f"100 Brussels Ct {MN_ZIP}"),
        ("UNIVERSITY AVE NE", f"100 University Ave NE {MN_ZIP}"),
    ],
)
def test_a_street_ending_like_a_state_code_is_the_street_before_a_minnesota_zip(
    street_name, typed
):
    lookup, _ = service(rows=rows_at(MN_ZIP, FullStreetName=street_name))
    assert lookup.lookup(typed, "8334")[0]["kind"] == "results"


@pytest.mark.parametrize(
    "typed",
    [
        "100 Main St, Hartford, CT 06103",
        "100 Main St Hartford CT 06103",
        f"100 Brussels St, CT {MN_ZIP}",  # A comma marks a state, whatever the ZIP.
        "100 Main St Omaha NE 68102",
    ],
)
def test_a_real_state_before_its_zip_is_still_outside_minnesota(typed):
    lookup, calls = service(rows=rows_at(MN_ZIP, FullStreetName="BRUSSELS ST"))
    assert lookup.lookup(typed, "8334")[0] == {"kind": "outside-minnesota"}
    assert calls == []


@pytest.mark.parametrize(
    "official,typed",
    [
        ("EXAMPLE ST N", "100 EXAMPLE ST N, EXAMPEL CITY, MN 99999"),  # city swap
        ("CLEVELAND AVE N", "100 Cleaveland Ave N, Example City, MN 99999"),
        ("OJIBWA RD", "100 ojibwa park road exampel city mn 99999"),  # extra word
        ("OJIBWA RD", "100 Ojibwe Rd 99999"),
    ],
)
def test_close_misspellings_are_offered_as_the_official_address_to_confirm(
    official, typed
):
    lookup, calls = service(rows=[street(FullStreetName=official)])
    label = f"100 {official}, EXAMPLE CITY, MN 99999"
    result = lookup.resolve(typed)
    assert result["kind"] == "ambiguous"
    assert [choice["address"] for choice in result["choices"]] == [label]
    assert all(url != SOURCE_URL for url, _ in calls)
    response, _ = lookup.lookup(typed, "8334", result["choices"][0])
    assert response["kind"] == "results"
    assert response["matchedAddress"] == label
    assert lookup.suggest(typed) == result["choices"]


@pytest.mark.parametrize(
    "official,typed",
    [
        ("3RD ST N", "100 2ND ST N, EXAMPLE CITY, MN 99999"),  # numbers are exact
        ("1ST ST N", "100 FIRST ST S, EXAMPLE CITY, MN 99999"),  # compass is exact
        ("EXAMPLE ST NE", "100 EXAMPEL ST NW, EXAMPLE CITY, MN 99999"),
        ("EXAMPLE ST N", "100 EXAMPEL AVE N, EXAMPLE CITY, MN 99999"),  # type exact
        ("EXAMPLE ST N", "100 EXAMPLE ST N, OTHER CITY, MN 99999"),  # other city
        ("OAK ST", "100 OAKS ST, EXAMPLE CITY, MN 99999"),  # short words exact
        ("OJIBWA RD", "100 OJIBWA 2 RD, EXAMPLE CITY, MN 99999"),  # number added
        ("OJIBWA RD", "100 OJIBWA RD SOMEWHERE 99999"),  # unknown words
        ("EXAMPLE ST N", "101 EXAMPEL ST N, EXAMPLE CITY, MN 99999"),  # parity
        ("CLEVELAND AVE N", "100 KLAVELEND AVE N, EXAMPLE CITY, MN 99999"),
    ],
)
def test_a_close_spelling_never_changes_numbers_compass_type_city_or_unit(
    official, typed
):
    lookup, calls = service(rows=[street(FullStreetName=official)])
    assert lookup.resolve(typed) == {"kind": "no-match"}
    assert all(url != SOURCE_URL for url, _ in calls)


def test_a_confirmation_must_match_a_correction_recomputed_from_the_typed_text():
    lookup, _ = service(rows=[street(FullStreetName="CLEVELAND AVE N")])
    typed = "100 Cleaveland Ave N, Example City, MN 99999"
    choice = lookup.resolve(typed)["choices"][0]
    for other in (
        typed.replace("100", "102"),
        typed.replace("Cleaveland", "Washington"),
        typed.replace(" N,", " S,"),
    ):
        assert lookup.resolve(other, choice) == {"kind": "no-match"}


def test_closest_corrections_come_first_and_each_is_in_its_number_range():
    lookup, _ = service(
        rows=[
            street(FullStreetName="EXAMPLAR ST N", ProdAddressRangeId=1),
            street(FullStreetName="EXAMPLES ST N", ProdAddressRangeId=2),
            street(
                FullStreetName="EXAMPLED ST N",
                ProdAddressRangeId=3,
                HouseNumberLow=200,
                HouseNumberHigh=300,
            ),
        ]
    )
    result = lookup.resolve("100 EXAMPLEZ ST N, EXAMPLE CITY, MN 99999")
    assert [choice["address"].split(",")[0] for choice in result["choices"]] == [
        "100 EXAMPLES ST N",
        "100 EXAMPLAR ST N",
    ]


class MapAnswer:
    def __init__(self, *addresses):
        self.addresses = addresses

    def geocode_matches(self, text):
        if not self.addresses:
            raise RepresentativeLookupNotFound("no point")
        return [
            SimpleNamespace(matched_address=address, state_code="MN")
            for address in self.addresses
        ]


TOWNSHIP_LABEL = "100 EXAMPLE ST N, FIRST ASSESSMENT UNORGANIZED TERRITORY, MN 99999"


def test_a_map_point_filed_under_a_township_is_offered_with_its_postal_city():
    lookup, _ = service(geocoder=MapAnswer(TOWNSHIP_LABEL))
    result = lookup.resolve("100 EXAMPLE ST N, EXAMPLE CITY, MN")
    assert result == {
        "kind": "ambiguous",
        "choices": [candidate_lookup._choice(ADDRESS)],
    }
    response, _ = lookup.lookup(
        "100 EXAMPLE ST N, EXAMPLE CITY, MN", "8334", result["choices"][0]
    )
    assert response["kind"] == "results"


def test_a_township_point_on_a_street_2_postal_cities_share_offers_nothing():
    lookup, _ = service(
        rows=[street(), street(CityName="OTHER CITY", ProdAddressRangeId=124)],
        geocoder=MapAnswer(TOWNSHIP_LABEL),
    )
    assert lookup.resolve("100 EXAMPLE ST N, EXAMPLE CITY, MN") == {"kind": "no-match"}


def city_zips(monkeypatch, *zip_codes):
    monkeypatch.setattr(
        candidate_lookup, "civic_zip_codes", lambda: {("EXAMPLE", "CITY"): zip_codes}
    )


def test_a_city_without_a_zip_checks_that_citys_public_zip_tables(monkeypatch):
    city_zips(monkeypatch, "99998", "99999")
    lookup, calls = service(geocoder=MapAnswer())
    typed = "100 Example St N, Example City, MN"
    result = lookup.resolve(typed)
    assert result == {
        "kind": "ambiguous",
        "choices": [candidate_lookup._choice(ADDRESS)],
    }
    assert sorted(params["ZipCode"] for url, params in calls if url == STREETS_URL) == [
        "99998",
        "99999",
    ]
    # Only public ZIPs leave; no part of the typed street or number does.
    assert all("Example" not in json.dumps(params) for _, params in calls)
    assert lookup.lookup(typed, "8334", result["choices"][0])[0]["kind"] == "results"
    assert lookup.resolve(typed.replace("100", "102"), result["choices"][0]) == {
        "kind": "no-match"
    }


def test_a_city_zip_table_failure_is_unavailable_not_a_choice(monkeypatch):
    city_zips(monkeypatch, "99998", "99999")

    def fetch(url, params):
        if params.get("ZipCode") == "99998":
            raise CandidateLookupUnavailable("Official ballot service unavailable")
        return json.dumps({"Streets": [street()]}).encode()

    lookup = CandidateLookupService(fetch=fetch, geocoder=MapAnswer())
    with pytest.raises(CandidateLookupUnavailable):
        lookup.resolve("100 Example St N, Example City, MN")


@pytest.mark.parametrize(
    "zip_codes,typed",
    [
        (tuple(f"9999{i}" for i in range(7)), "100 Example St N, Example City, MN"),
        (("99999",), "100 Example St N, Example City, WI"),
        (("99999",), "100 Example St N, Unlisted Town, MN"),
    ],
)
def test_a_broad_unlisted_or_other_state_city_reads_no_tables(
    monkeypatch, zip_codes, typed
):
    city_zips(monkeypatch, *zip_codes)
    lookup, calls = service(geocoder=MapAnswer())
    assert lookup.resolve(typed) == {"kind": "no-match"}
    assert calls == []


# Ojibwa Rd, Crow Wing County: a public building point the state map files under
# First Assessment Unorganized Territory, with no postal community.
OJIBWA = StreetAddress("OJIBWA RD", "BRAINERD", "MN", "56401", 6284)
OJIBWA_POINT = (46.44948887, -94.26888475)
OJIBWA_REPORT = {
    "CountyName": "Crow Wing",
    "PrecinctCode": "0300",
    "HouseDistrict": "8",
    "SenateDistrict": "6",
    "LegDistrict": "6B",
    "FullStreetName": "OJIBWA RD ",
    "CityName": "BRAINERD",
    "ZipCode": "56401",
    "HouseNumberLow": "745",
    "HouseNumberHigh": "6749",
    "OddEvenInd": "B",
    "HouseNumberSuffix": "",
    "UnitNumberRange": None,
}


def point(**overrides):
    return {
        "attributes": {
            "anumber": 6284,
            "st_name": "Ojibwa",
            "st_pos_typ": "Road",
            "postcomm": None,
            "ctu_name": "First Assessment Unorganized Territory",
            "state_code": "MN",
            "zip": "56401",
            "status": "Active",
            "latitude": OJIBWA_POINT[0],
            "longitude": OJIBWA_POINT[1],
            **overrides,
        }
    }


def test_township_points_need_an_empty_postal_city_and_a_rural_place(monkeypatch):
    features = [
        point(),
        point(latitude=46.4495, ctu_name="Spencer Brook Township"),
        point(latitude=46.0, postcomm="Nisswa"),
        point(latitude=46.1, ctu_name="Baxter"),
    ]
    monkeypatch.setattr(
        candidate_lookup,
        "historical_point_payload",
        lambda zip_code, house_number: {"features": features},
    )
    assert candidate_lookup.historical_address_points(OJIBWA) == set()
    assert candidate_lookup.historical_township_points(OJIBWA) == {
        OJIBWA_POINT,
        (46.4495, OJIBWA_POINT[1]),
    }


def township_match(monkeypatch, report):
    monkeypatch.setattr(candidate_lookup, "historical_address_points", lambda _: set())
    monkeypatch.setattr(
        candidate_lookup, "historical_township_points", lambda _: {OJIBWA_POINT}
    )
    monkeypatch.setattr(streets, "facility_points", lambda _: set())
    monkeypatch.setattr(county_addresses, "county_address_points", lambda _: set())

    def fetch(url, params):
        assert url == SOURCE_URL and params == {"prodAddressRangeId": 113811}
        if isinstance(report, Exception):
            raise report
        return json.dumps({"PollingResult": report}).encode()

    return CandidateLookupService(fetch=fetch)._historical_match(
        OJIBWA, StreetRangeMatch(113811)
    )


def test_a_township_point_still_needs_the_official_range_report_to_agree(monkeypatch):
    area = township_match(monkeypatch, OJIBWA_REPORT)
    assert area and (area.county_code, area.precinct_code) == ("18", "0300")
    assert (
        township_match(monkeypatch, {**OJIBWA_REPORT, "PrecinctCode": "0290"}) is None
    )
    with pytest.raises(CandidateLookupUnavailable):
        township_match(
            monkeypatch,
            CandidateLookupUnavailable("Official ballot service unavailable"),
        )
