"""Real ballot styles and conservative edge cases for the held 2026 map."""

import pytest
from shapely import Point, STRtree, box

from alethical.api.services.candidate_historical_geography import (
    _unique_interior,
    historical_geography,
)


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
