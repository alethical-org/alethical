import json

import pytest

from alethical.api.services.representative_lookup import (
    CensusGeocoder,
    MinnesotaGisLookupClient,
    RepresentativeLookupChoices,
    RepresentativeLookupNotFound,
    RepresentativeLookupOutsideMinnesota,
    RepresentativeLookupService,
    geometry_covers_point,
    prepare_district_geometry,
    validate_district_containment,
)


class FakeResponse:
    def __init__(self, payload):
        self.payload = payload

    def raise_for_status(self):
        return None

    def json(self):
        return self.payload


def census_payload(*matches):
    return {"result": {"addressMatches": list(matches)}}


def census_match(address, *, state="MN", latitude=44.98, longitude=-93.27):
    return {
        "matchedAddress": address,
        "coordinates": {"x": longitude, "y": latitude},
        "addressComponents": {"state": state},
    }


def test_census_returns_no_match_without_silently_choosing(monkeypatch):
    monkeypatch.setattr(
        "alethical.api.services.representative_lookup.requests.get",
        lambda *args, **kwargs: FakeResponse(census_payload()),
    )

    with pytest.raises(
        RepresentativeLookupNotFound, match="address could not be geocoded"
    ):
        CensusGeocoder().geocode_matches("1428 Nonesuch Ave")


def test_census_filters_minnesota_before_limiting_choices(monkeypatch):
    out_of_state = [
        census_match(f"{number} TEST ST, FARGO, ND", state="ND")
        for number in range(1, 7)
    ]
    minnesota = [
        census_match(f"350 {direction} 5TH ST, MINNEAPOLIS, MN 55401")
        for direction in ("N", "NE", "SE", "S", "SW", "W")
    ]
    monkeypatch.setattr(
        "alethical.api.services.representative_lookup.requests.get",
        lambda *args, **kwargs: FakeResponse(census_payload(*out_of_state, *minnesota)),
    )

    matches = CensusGeocoder().geocode_matches("350 5th St, Minneapolis, MN")

    assert len(matches) == 5
    assert all(match.state_code == "MN" for match in matches)
    assert matches[0].matched_address.startswith("350 N 5TH")


def test_census_reports_outside_minnesota_when_only_other_states_match(monkeypatch):
    monkeypatch.setattr(
        "alethical.api.services.representative_lookup.requests.get",
        lambda *args, **kwargs: FakeResponse(
            census_payload(
                census_match("1600 PENNSYLVANIA AVE, WASHINGTON, DC", state="DC")
            )
        ),
    )

    with pytest.raises(RepresentativeLookupOutsideMinnesota):
        CensusGeocoder().geocode_matches("1600 Pennsylvania Ave NW")


def test_single_minnesota_match_continues_to_district_lookup(monkeypatch):
    match = census_match("350 S 5TH ST, MINNEAPOLIS, MN 55415")
    monkeypatch.setattr(
        "alethical.api.services.representative_lookup.requests.get",
        lambda *args, **kwargs: FakeResponse(census_payload(match)),
    )

    class Gis:
        def lookup(self, *, latitude, longitude):
            assert (latitude, longitude) == (44.98, -93.27)
            return (None, None, "5")

    with pytest.raises(
        RepresentativeLookupNotFound, match="no Minnesota legislative districts"
    ):
        RepresentativeLookupService(geocoder=CensusGeocoder(), gis_client=Gis()).lookup(
            "350 S 5th St"
        )


def test_multiple_minnesota_matches_are_returned_as_choices(monkeypatch):
    monkeypatch.setattr(
        "alethical.api.services.representative_lookup.requests.get",
        lambda *args, **kwargs: FakeResponse(
            census_payload(
                census_match("350 5TH ST N, MINNEAPOLIS, MN 55401"),
                census_match("350 S 5TH ST, MINNEAPOLIS, MN 55415"),
            )
        ),
    )

    with pytest.raises(RepresentativeLookupChoices) as raised:
        RepresentativeLookupService(geocoder=CensusGeocoder()).lookup("350 5th St")

    assert [choice.matched_address for choice in raised.value.choices] == [
        "350 5TH ST N, MINNEAPOLIS, MN 55401",
        "350 S 5TH ST, MINNEAPOLIS, MN 55415",
    ]


def test_geometry_supports_multipolygons_holes_and_boundary_points():
    geometry = {
        "type": "MultiPolygon",
        "coordinates": [
            [
                [[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]],
                [[4, 4], [6, 4], [6, 6], [4, 6], [4, 4]],
            ],
            [[[20, 20], [22, 20], [22, 22], [20, 22], [20, 20]]],
        ],
    }

    assert geometry_covers_point(geometry, longitude=0, latitude=5)
    assert geometry_covers_point(geometry, longitude=21, latitude=21)
    assert not geometry_covers_point(geometry, longitude=5, latitude=5)


def test_geometry_reduction_keeps_selected_point_and_reduces_large_fixture():
    outer = [[0, 0]]
    for index in range(1, 500):
        outer.append([index / 100, 0.00001 * (index % 2)])
    outer += [[5, 5], [0, 5], [0, 0]]
    geometry = {"type": "Polygon", "coordinates": [outer]}

    prepared = prepare_district_geometry(geometry, longitude=1, latitude=1)

    assert geometry_covers_point(prepared, longitude=1, latitude=1)
    assert len(json.dumps(prepared)) < len(json.dumps(geometry))


def test_gis_keeps_house_senate_congress_and_geometry(monkeypatch):
    house_geometry = {
        "type": "Polygon",
        "coordinates": [[[-94, 44], [-93, 44], [-93, 45], [-94, 45], [-94, 44]]],
    }
    senate_geometry = {
        "type": "Polygon",
        "coordinates": [[[-95, 43], [-92, 43], [-92, 46], [-95, 46], [-95, 43]]],
    }
    payload = {
        "features": [
            {
                "geometry": house_geometry,
                "properties": {"district": "59B", "memid": "1"},
            },
            {
                "geometry": senate_geometry,
                "properties": {"district": "59", "memid": "2"},
            },
            {
                "geometry": senate_geometry,
                "properties": {"district": "5", "memid": "none"},
            },
        ]
    }
    monkeypatch.setattr(
        "alethical.api.services.representative_lookup.requests.get",
        lambda *args, **kwargs: FakeResponse(payload),
    )

    house, senate, congress = MinnesotaGisLookupClient().lookup(
        latitude=44.5, longitude=-93.5
    )

    assert house and house.district_code == "59B" and house.geometry
    assert senate and senate.district_code == "59" and senate.geometry
    assert congress == "5"


def test_rural_codes_and_source_shared_edge_sliver_are_handled():
    house = {
        "type": "Polygon",
        "coordinates": [[[0, 0], [10.001, 0], [10.001, 10], [0, 10], [0, 0]]],
    }
    senate = {
        "type": "Polygon",
        "coordinates": [[[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]]],
    }
    client = MinnesotaGisLookupClient()

    assert client._canonical_district_code("01A") == "1A"
    assert client._canonical_district_code("01") == "1"
    validate_district_containment(house, senate, house_code="1A", senate_code="1")


def test_containment_rejects_wrong_parent_or_material_overlap():
    house = {
        "type": "Polygon",
        "coordinates": [[[0, 0], [12, 0], [12, 10], [0, 10], [0, 0]]],
    }
    senate = {
        "type": "Polygon",
        "coordinates": [[[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]]],
    }
    with pytest.raises(Exception, match="codes do not nest"):
        validate_district_containment(house, senate, house_code="1A", senate_code="2")
    with pytest.raises(Exception, match="not contained"):
        validate_district_containment(house, senate, house_code="1A", senate_code="1")
