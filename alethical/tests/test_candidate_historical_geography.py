"""Real ballot styles and conservative edge cases for the held 2026 map."""

import pytest
from shapely import Point, STRtree, box

from alethical.api.services import candidate_historical_streets as streets
from alethical.api.services.candidate_historical_geography import (
    _unique_interior,
    corroborated_school,
    historical_geography,
    historical_precinct,
)
from alethical.pipeline.candidate_ballot import StreetAddress
from scripts.build_2026_candidate_streets import FaceDistricts


# Public MN address points on the two sides of 13th Avenue S in South St. Paul.
# The city published distinct P-3 sample ballots, one for each school district.
# https://www.southstpaulmn.gov/DocumentCenter/View/15815/P3-SSP-ISD-199
# https://www.southstpaulmn.gov/DocumentCenter/View/15816/P3-SSP-SSD-6
SOUTH_ST_PAUL_ISD = (44.883362, -93.050364)
SOUTH_ST_PAUL_SSD = (44.8832, -93.049762)
BREEZY_POINT = (46.594, -94.219)


@pytest.mark.parametrize(
    "point, school_type, school",
    [(SOUTH_ST_PAUL_ISD, "ISD", "199"), (SOUTH_ST_PAUL_SSD, "SSD", "6")],
)
def test_school_ballots_split_one_precinct(point, school_type, school):
    area = historical_geography([point])
    assert area is not None
    assert (area.county_code, area.precinct_code) == ("19", "4430")
    assert (area.school_type, area.school_district) == (school_type, school)


def test_duplicate_points_across_school_only_keep_common_precinct():
    area = historical_geography([SOUTH_ST_PAUL_ISD, SOUTH_ST_PAUL_SSD])
    assert area is not None
    assert area.precinct_code == "4430"
    assert area.school_type is None and area.school_district is None


def test_breezy_point_has_2026_election_geography():
    area = historical_geography([BREEZY_POINT])
    assert area is not None
    assert (area.county_code, area.precinct_code, area.municipality_code) == (
        "18",
        "0055",
        "07516",
    )
    assert (area.house_district, area.senate_district, area.congressional_district) == (
        "6B",
        "6",
        "8",
    )
    assert (area.school_type, area.school_district) == ("ISD", "186")


@pytest.mark.parametrize(
    "points",
    [[], [(45, -90)], [(float("nan"), -94)], [SOUTH_ST_PAUL_SSD, BREEZY_POINT]],
)
def test_absent_or_conflicting_precincts_are_unconfirmed(points):
    assert historical_geography(points) is None


def test_boundary_overlap_polygon_holes_and_nearby_areas():
    polygon = box(0, 0, 50, 50).difference(box(15, 15, 35, 35))
    tree = STRtree([polygon, box(50, 0, 100, 50)])
    for point in (
        Point(25, 25),
        Point(49, 25),
        Point(50, 25),
        Point(52, 25),
        Point(0, 0),
    ):
        assert _unique_interior(tree, point) is None
    assert _unique_interior(tree, Point(7.5, 25)) == 0
    assert _unique_interior(tree, Point(60, 25)) == 1
    assert _unique_interior(STRtree([box(0, 0, 50, 50)] * 2), Point(25, 25)) is None


def test_precinct_only_area_never_chooses_a_school_in_a_split():
    south = historical_precinct("19", "4430")
    assert south is not None and south.school_district is None
    for places in ([], [SOUTH_ST_PAUL_SSD, SOUTH_ST_PAUL_ISD]):
        assert (
            corroborated_school(
                south, places, school_name="SOUTH ST PAUL", school_district="6"
            )
            == south
        )
    assert historical_precinct("99", "4430") is None
    assert historical_precinct("18", "0055").school_district == "186"


@pytest.mark.parametrize(
    "point, name, number",
    [
        ((44.95515, -93.10222), "ST. PAUL", "0625"),
        ((46.6636, -92.4247), "CARLTON-WRENSHALL", "2918"),
        ((46.616, -92.381), "CARLTON-WRENSHALL", "2918"),
        ((44.4157, -95.555), "TRACY AREA", "2913"),
        ((44.232, -95.622), "TRACY AREA", "2913"),
        ((45.3, -93.569), "ISD 728", "728"),
        ((46.532, -93.708), "AITKIN", "0001"),
    ],
)
def test_same_address_school_requires_matching_map_and_sos_name_and_number(
    point, name, number
):
    area = historical_geography([point])
    assert area is not None and not area.school_type
    result = corroborated_school(
        area, [point], school_name=name, school_district=number
    )
    assert (result.school_type, result.school_district) == ("ISD", str(int(number)))
    assert (
        corroborated_school(
            area, [point], school_name="MINNEAPOLIS", school_district=number
        )
        == area
    )
    assert (
        corroborated_school(area, [point], school_name=name, school_district="9999")
        == area
    )


def test_old_district_ids_cannot_override_confirmed_mergers():
    point = (46.6636, -92.4247)
    area = historical_geography([point])
    assert (
        corroborated_school(area, [point], school_name="Carlton", school_district="93")
        == area
    )


def test_whole_precinct_and_fixed_school_subdistricts():
    area = historical_precinct("62", "0020")
    assert (
        corroborated_school(
            area, [], school_name="Mounds View", school_district="621"
        ).school_district
        == "621"
    )
    mpls = historical_precinct("27", "1515")
    assert (mpls.school_type, mpls.school_district, mpls.school_subdistrict) == (
        "SSD",
        "1",
        "4",
    )
    point = (47.75, -90.335)
    cook = corroborated_school(
        historical_geography([point]),
        [point],
        school_name="Cook County",
        school_district="166",
    )
    assert cook.school_subdistrict == cook.commissioner_district


def test_explicit_hospital_and_municipal_assignments():
    bangor = historical_precinct("61", "0005")
    assert (bangor.hospital_district, bangor.hospital_name) == ("710", "Glacial Ridge")
    assert historical_precinct("82", "0280").municipality_code == "45952"


def test_nashwauk_city_residents_live_in_three_distinct_townships():
    areas = [
        historical_geography([point])
        for point in (
            (47.363491, -93.235911),
            (47.369718, -93.170834),
            (47.387587, -93.153598),
        )
    ]
    assert {area.precinct_code for area in areas} == {"0280"}
    assert [area.township_code for area in areas] == ["25892", "37934", "44998"]
    assert historical_precinct("31", "0280").township_code is None


def test_census_side_faces_withhold_boundaries_crossed_by_more_than_ten_centimetres():
    districts = FaceDistricts(
        [box(0, 0, 50, 50), box(50, 0, 100, 50)], ["left", "right"]
    )
    assert districts.containing(box(20, 10, 50.09, 35)) == "left"
    assert districts.containing(box(49.91, 10, 70, 35)) == "right"
    assert districts.containing(box(20, 10, 50.11, 35)) == ""
    assert districts.containing(box(40, 10, 65, 35)) == ""
    assert districts.containing(box(-1, 10, 20, 35)) == ""
    overlap = FaceDistricts([box(0, 0, 60, 50), box(50, 0, 100, 50)], ["left", "right"])
    assert overlap.containing(box(45, 5, 56, 15)) == ""


def test_public_cottage_grove_school_has_a_verified_census_address_side():
    # This school is on a boundary road. Its Census address side independently
    # agrees with the education directory's point for the physical building.
    address = StreetAddress("80TH ST S", "COTTAGE GROVE", "MN", "55016", 7516)
    assert streets.street_precinct(address) == "820050"
    area = historical_geography(streets.facility_points(address))
    assert (area.county_code, area.precinct_code) == ("82", "0050")


def test_matched_street_school_requires_all_compatible_ranges_and_sos(monkeypatch):
    area = historical_precinct("19", "4430")
    address = StreetAddress("13TH AVE S", "SOUTH ST PAUL", "MN", "55075", 500)
    base = [450, 550, "E", "194430", "ISD:199"]
    for conflicting in (None, "SSD:6", ""):
        rows = [base, [450, 550, "O", "194430", "SSD:6"]]
        if conflicting is not None:
            rows.append([500, 502, "E", "194430", conflicting])
        monkeypatch.setattr(
            streets, "_street_ranges", lambda _, rows=rows: {"13TH AVENUE S": rows}
        )
        school = streets.street_school(address, area)
        checked = corroborated_school(
            area,
            [],
            school_name="INVER GROVE HEIGHTS",
            school_district="199",
            street_school=school,
        )
        assert checked.school_district == ("199" if conflicting is None else None)
        assert (
            corroborated_school(
                area,
                [],
                school_name="SOUTH ST PAUL",
                school_district="6",
                street_school=school,
            ).school_district
            is None
        )
