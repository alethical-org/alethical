from dataclasses import replace

from alethical.api.services import candidate_historical_county_addresses as county
from alethical.pipeline.candidate_ballot import StreetAddress
from scripts.build_2026_candidate_county_addresses import traverse_points


def test_sibley_public_county_gis_office_matches_only_the_full_address():
    address = StreetAddress("8th Street", "Gaylord", "MN", "55334", 111)
    assert county.county_address_points(address) == {
        (44.552059962341445, -94.22714302740611)
    }
    for fields in (
        {"house_number": 999999},
        {"state": "ND"},
        {"zip_code": "55111"},
        {"street": "8th St W"},
        {"city": "Other"},
        {"house_number_suffix": "A"},
        {"unit": "1"},
    ):
        assert not county.county_address_points(replace(address, **fields))


def test_each_possible_published_coordinate_survives(monkeypatch):
    address = StreetAddress("West 2nd Street", "Saint Paul", "MN", "55101", 10)
    key = county.address_key(address)
    points = [[44.91, -93.1], [44.92, -93.1]]
    monkeypatch.setattr(county, "_index", lambda: {key: points})
    assert county.county_address_points(
        replace(address, street="W 2nd St", city="St. Paul")
    ) == set(map(tuple, points))
    assert not county.county_address_points(replace(address, street="2nd St W"))


def test_traverse_archived_and_postelection_records_must_agree_at_every_point():
    old = dict(
        NUMBER="10",
        STREET="Main St",
        CITY="Town",
        REGION="MN",
        POSTCODE="55555",
        UNIT="",
        LAT="45.5",
        LON="-96.0",
    )
    attrs = dict(
        STR_NUM="10",
        PRE_DIR="",
        STR_NAME="Main",
        STR_TYPE="Street",
        POST_DIR="",
        CITY="Town",
        STATE="MN",
        ZIP_CODE="55555",
        UNIT_TYPE="",
        UNIT_NUM="",
        DLVRY_ADD="10 Main St",
    )
    point = dict(attributes=attrs, geometry={"x": -96.0, "y": 45.50000001})
    assert list(traverse_points([old], [point]).values()) == [{(45.5, -96.0)}]
    other = dict(point, geometry={"x": -96.0, "y": 45.5001})
    assert not traverse_points([old], [other])
    assert not traverse_points([old], [point, other])
    assert not traverse_points([old, dict(old, LAT="45.51")], [point])
    assert not traverse_points(
        [old], [dict(point, attributes=dict(attrs, DLVRY_ADD="10 Main St N"))]
    )
    assert not traverse_points(
        [old], [dict(point, attributes=dict(attrs, ZIP_CODE="55554"))]
    )


def test_county_range_alias_requires_the_correct_side_and_a_nearby_edge_interior():
    from shapely.geometry import box, LineString, Point
    from scripts.build_2026_candidate_county_addresses import (
        confirmed_side,
        direction_base,
    )

    line = LineString([(0, 0), (100, 0)])
    side = box(0, 0, 100, 150)
    assert confirmed_side([Point(50, 15)], line, side)
    for bad in (Point(50, -5), Point(50, 51), Point(50, 0.1), Point(110, 12)):
        assert not confirmed_side([Point(50, 15), bad], line, side)
    assert direction_base("W MAIN AVE") == "MAIN AVE"
    assert direction_base("MAIN AVE W") == "MAIN AVE"
    assert direction_base("W MAIN AVE E") is None


def test_gaylord_census_direction_alias_keeps_east_points_separate():
    # No private address fixture. Compare every house number in both published
    # ZIP 55334 ranges, including unrelated ranges on the same street.
    def points(street, number):
        return county.county_address_points(
            StreetAddress(street, "Gaylord", "MN", "55334", number)
        )

    present_west = 0
    present_east = 0
    for number in range(1, 1000):
        west, east = points("W Main Ave", number), points("Main Ave E", number)
        if west:
            assert 800 <= number <= 999
            assert west == points("Main Ave", number)
            present_west += 1
        assert not (west & east)
        present_east += bool(east)
    assert present_west and present_east
