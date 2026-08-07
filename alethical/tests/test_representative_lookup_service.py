import json

import pytest

from alethical.api.services.representative_lookup import (
    CensusGeocoder,
    GeocodedAddress,
    MinnesotaAddressPointGeocoder,
    MinnesotaGisLookupClient,
    RepresentativeLookupChoices,
    RepresentativeLookupNotFound,
    RepresentativeLookupOutsideMinnesota,
    RepresentativeLookupService,
    congressional_district_for_point,
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


def address_point_feature(**attributes):
    return {"attributes": attributes}


def test_census_returns_no_match_without_silently_choosing(monkeypatch):
    monkeypatch.setattr(
        "alethical.api.services.representative_lookup.requests.get",
        lambda *args, **kwargs: FakeResponse(census_payload()),
    )

    with pytest.raises(
        RepresentativeLookupNotFound, match="address could not be geocoded"
    ):
        CensusGeocoder().geocode_matches("1428 Nonesuch Ave")


def test_census_retries_a_minnesota_street_without_the_wrong_locality(monkeypatch):
    requested = "4255 215th St E, Farmington, MN 55024"
    matched = census_match(
        "4255 215TH ST E, HAMPTON, MN 55031",
        latitude=44.637605981025,
        longitude=-93.020281271416,
    )
    requests = []

    def get(url, *, params, timeout):
        requests.append(params["address"])
        if params["address"] == requested:
            return FakeResponse(census_payload())
        assert params["address"] == "4255 215th St E, MN"
        return FakeResponse(census_payload(matched))

    monkeypatch.setattr(
        "alethical.api.services.representative_lookup.requests.get", get
    )

    matches = CensusGeocoder().geocode_matches(requested)

    assert requests == [requested, "4255 215th St E, MN"]
    assert matches[0].requested_address == requested
    assert matches[0].matched_address == "4255 215TH ST E, HAMPTON, MN 55031"


def test_census_does_not_relax_an_address_without_a_minnesota_locality(monkeypatch):
    requests = []

    def get(url, *, params, timeout):
        requests.append(params["address"])
        return FakeResponse(census_payload())

    monkeypatch.setattr(
        "alethical.api.services.representative_lookup.requests.get", get
    )

    with pytest.raises(RepresentativeLookupNotFound):
        CensusGeocoder().geocode_matches("4255 215th St E")

    assert requests == ["4255 215th St E"]


def test_state_address_fallback_sends_only_house_number_and_street(monkeypatch):
    requested = "4255 215th St E, Farmington, MN 55024"
    seen_params = {}

    def get(url, *, params, timeout):
        seen_params.update(params)
        return FakeResponse(
            {
                "features": [
                    address_point_feature(
                        anumber=4255,
                        anumberpre=None,
                        anumbersuf=None,
                        st_pre_mod=None,
                        st_pre_dir=None,
                        st_pre_typ=None,
                        st_pre_sep=None,
                        st_name="215th",
                        st_pos_typ="Street",
                        st_pos_dir="East",
                        st_pos_mod=None,
                        postcomm="Hampton",
                        ctu_name="Vermillion Township",
                        zip="55031",
                        state_code="MN",
                        longitude=-93.02000538,
                        latitude=44.64011409,
                        status="Active",
                    )
                ]
            }
        )

    monkeypatch.setattr(
        "alethical.api.services.representative_lookup.requests.get", get
    )

    matches = MinnesotaAddressPointGeocoder().geocode_matches(requested)

    assert "4255" in seen_params["where"]
    assert "215TH" in seen_params["where"]
    assert "Farmington" not in str(seen_params)
    assert "55024" not in str(seen_params)
    assert matches == [
        GeocodedAddress(
            requested_address=requested,
            matched_address="4255 215th Street East, Hampton, MN 55031",
            latitude=44.64011409,
            longitude=-93.02000538,
            state_code="MN",
        )
    ]


def test_state_address_fallback_returns_choices_instead_of_guessing(monkeypatch):
    monkeypatch.setattr(
        "alethical.api.services.representative_lookup.requests.get",
        lambda *args, **kwargs: FakeResponse(
            {
                "features": [
                    address_point_feature(
                        anumber=10,
                        st_name="Main",
                        st_pos_typ="Street",
                        postcomm=city,
                        ctu_name=city,
                        zip=zip_code,
                        state_code="MN",
                        longitude=longitude,
                        latitude=45.0,
                        status="Active",
                    )
                    for city, zip_code, longitude in (
                        ("Ada", "56510", -96.5),
                        ("Anoka", "55303", -93.4),
                    )
                ]
            }
        ),
    )

    matches = MinnesotaAddressPointGeocoder().geocode_matches(
        "10 Main St, Somewhere, MN"
    )

    assert [match.matched_address for match in matches] == [
        "10 Main Street, Ada, MN 56510",
        "10 Main Street, Anoka, MN 55303",
    ]


def test_state_address_fallback_accepts_an_uncommon_street_type(monkeypatch):
    monkeypatch.setattr(
        "alethical.api.services.representative_lookup.requests.get",
        lambda *args, **kwargs: FakeResponse(
            {
                "features": [
                    address_point_feature(
                        anumber=10,
                        st_name="Pine",
                        st_pos_typ="Cove",
                        postcomm="Bemidji",
                        ctu_name="Bemidji",
                        zip="56601",
                        state_code="MN",
                        longitude=-94.88,
                        latitude=47.47,
                        status="Active",
                    )
                ]
            }
        ),
    )

    matches = MinnesotaAddressPointGeocoder().geocode_matches(
        "10 Pine Cv, Bemidji, MN 56601"
    )

    assert matches[0].matched_address == "10 Pine Cove, Bemidji, MN 56601"


def test_state_address_fallback_rejects_non_minnesota_without_a_request(monkeypatch):
    monkeypatch.setattr(
        "alethical.api.services.representative_lookup.requests.get",
        lambda *args, **kwargs: pytest.fail("state address service was called"),
    )

    with pytest.raises(RepresentativeLookupNotFound):
        MinnesotaAddressPointGeocoder().geocode_matches("10 Main St, Fargo, ND 58103")


def test_lookup_uses_state_addresses_only_after_census_has_no_match():
    matched = GeocodedAddress(
        requested_address="10 Main St, Ada, MN",
        matched_address="10 Main Street, Ada, MN 56510",
        latitude=47.3,
        longitude=-96.5,
        state_code="MN",
    )

    class Census:
        def geocode_matches(self, address_text):
            raise RepresentativeLookupNotFound("address could not be geocoded")

    class AddressPoints:
        def geocode_matches(self, address_text):
            return [matched]

    class Gis:
        def lookup(self, *, latitude, longitude):
            assert (latitude, longitude) == (47.3, -96.5)
            return (None, None, "7")

    with pytest.raises(
        RepresentativeLookupNotFound, match="no Minnesota legislative districts"
    ):
        RepresentativeLookupService(
            geocoder=Census(),
            address_point_geocoder=AddressPoints(),
            gis_client=Gis(),
        ).lookup("10 Main St, Ada, MN")


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


def test_gis_uses_local_congressional_layer_and_keeps_legislative_geometry(monkeypatch):
    house_geometry = {
        "type": "Polygon",
        "coordinates": [[[-95, 45], [-94, 45], [-94, 46], [-95, 46], [-95, 45]]],
    }
    senate_geometry = {
        "type": "Polygon",
        "coordinates": [[[-96, 44], [-93, 44], [-93, 47], [-96, 47], [-96, 44]]],
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
                # The mixed response's number-only row is deliberately wrong.
                # Congress must come from the official local map instead.
                "properties": {"district": "6", "memid": "none"},
            },
        ]
    }

    def get(url, *, params, timeout):
        return FakeResponse(payload)

    monkeypatch.setattr(
        "alethical.api.services.representative_lookup.requests.get", get
    )

    house, senate, congress = MinnesotaGisLookupClient().lookup(
        latitude=45.4558, longitude=-94.4289
    )

    assert house and house.district_code == "59B" and house.geometry
    assert senate and senate.district_code == "59" and senate.geometry
    assert congress == "7"


def test_maple_grove_source_shapes_are_checked_before_browser_reduction(monkeypatch):
    # The real House 37B outline around 7840 Main St is within the 0.1% source
    # allowance, but browser reduction pushes it just over. These small shapes
    # reproduce that same boundary condition without storing a large GIS response.
    house_geometry = {
        "type": "Polygon",
        "coordinates": [[[0, 0], [0.02003, 0], [0.02003, 0.02], [0, 0.02], [0, 0]]],
    }
    senate_geometry = {
        "type": "Polygon",
        "coordinates": [
            [
                [0, 0],
                [0.02, 0],
                [0.02003, 0.001],
                [0.02003, 0.019],
                [0.02, 0.02],
                [0, 0.02],
                [0, 0],
            ]
        ],
    }
    payload = {
        "features": [
            {
                "geometry": house_geometry,
                "properties": {"district": "1A", "memid": "1"},
            },
            {
                "geometry": senate_geometry,
                "properties": {"district": "1", "memid": "2"},
            },
        ]
    }
    monkeypatch.setattr(
        "alethical.api.services.representative_lookup.requests.get",
        lambda *args, **kwargs: FakeResponse(payload),
    )

    house, senate, _ = MinnesotaGisLookupClient().lookup(latitude=0.01, longitude=0.01)

    assert house and house.geometry != house_geometry
    assert senate and senate.geometry != senate_geometry


def test_local_congressional_map_covers_cold_spring_without_sharing_the_point():
    assert congressional_district_for_point(longitude=-94.4289, latitude=45.4558) == "7"
    assert congressional_district_for_point(longitude=0, latitude=0) is None


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
