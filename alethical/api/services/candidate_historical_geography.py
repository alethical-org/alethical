"""Voting areas for the November 3, 2026 Minnesota general election."""

from __future__ import annotations

from collections.abc import Iterable
from dataclasses import dataclass, replace
from functools import lru_cache
import gzip
import json
from pathlib import Path
import re
from threading import Lock

from pyproj import Transformer
from shapely import Point, STRtree, from_wkb


@dataclass(frozen=True)
class HistoricalGeography:
    county_code: str
    precinct_code: str
    precinct_name: str
    municipality_code: str | None = None
    congressional_district: str | None = None
    senate_district: str | None = None
    house_district: str | None = None
    commissioner_district: str | None = None
    judicial_district: str | None = None
    ward: str | None = None
    soil_water_district: str | None = None
    soil_water_name: str | None = None
    hospital_district: str | None = None
    hospital_name: str | None = None
    park_district: str | None = None
    park_name: str | None = None
    school_district: str | None = None
    school_type: str | None = None
    school_subdistrict: str | None = None
    township_code: str | None = None


MAP_PATH = (
    Path(__file__).resolve().parents[1]
    / "data"
    / "candidate_geography_20261103.jsonl.gz"
)
# The source uses NAD83 UTM zone 15 metres. Require room around the point for
# rounding, datum transformation and small differences in source digitization.
_MARGIN_METRES = 5
_PROJECT = Transformer.from_crs("EPSG:4326", "EPSG:26915", always_xy=True)
_LOAD_LOCK = Lock()


@lru_cache(maxsize=1)
def _all_maps():
    precincts: list[HistoricalGeography] = []
    precinct_shapes = []
    school_ids = []
    school_shapes = []
    township_ids = []
    township_shapes = []
    with gzip.open(MAP_PATH, "rt", encoding="utf-8") as f:
        for line in f:
            kind, attributes, wkb = json.loads(line)
            geometry = from_wkb(bytes.fromhex(wkb))
            if kind == "precinct":
                precincts.append(HistoricalGeography(**attributes))
                precinct_shapes.append(geometry)
            elif kind == "school":
                school_ids.append(tuple(attributes))
                school_shapes.append(geometry)
            elif kind == "township":
                township_ids.append(attributes)
                township_shapes.append(geometry)
            else:
                raise ValueError("Unrecognized November election map layer")
    if len(precincts) != 4105 or not school_ids:
        raise ValueError("Incomplete November election map")
    return (
        precincts,
        STRtree(precinct_shapes),
        school_ids,
        STRtree(school_shapes),
        township_ids,
        STRtree(township_shapes),
    )


def _maps():
    """Precinct and school layers in the source's NAD83 UTM zone 15 metres."""
    return _all_maps()[:4]


def _unique_interior(tree: STRtree, point: Point) -> int | None:
    indices = tree.query(point, predicate="dwithin", distance=_MARGIN_METRES)
    if len(indices) != 1:
        return None
    i = int(indices[0])
    polygon = tree.geometries[i]
    if polygon.contains(point) and polygon.boundary.distance(point) > _MARGIN_METRES:
        return i
    return None


@lru_cache(maxsize=1)
def _precinct_index() -> dict[tuple[str, str], int]:
    precincts, *_ = _maps()
    index = {
        (area.county_code, area.precinct_code): i for i, area in enumerate(precincts)
    }
    if len(index) != len(precincts):
        raise ValueError("Duplicate November election precinct code")
    return index


def historical_precinct(
    county_code: str, precinct_code: str
) -> HistoricalGeography | None:
    """Return only districts shared by the entire confirmed November precinct."""
    with _LOAD_LOCK:
        i = _precinct_index().get((county_code, precinct_code))
        return None if i is None else _maps()[0][i]


def _school_name(name: str) -> str:
    return re.sub(r"[^A-Z0-9]", "", re.sub(r"\bSAINT\b", "ST", name.upper()))


@lru_cache(maxsize=1)
def _education_map():
    ids = []
    shapes = []
    with gzip.open(
        MAP_PATH.with_name("candidate_school_boundaries_sy2026.jsonl.gz"),
        "rt",
        encoding="utf-8",
    ) as f:
        for line in f:
            (district_type, number, name, aliases), wkb = json.loads(line)
            ids.append(
                (
                    district_type,
                    number,
                    _school_name(name),
                    {county: _school_name(alias) for county, alias in aliases.items()},
                )
            )
            shapes.append(from_wkb(bytes.fromhex(wkb)))
    if len(ids) != 327 or len({row[:2] for row in ids}) != len(ids):
        raise ValueError("Incomplete historic education map")
    return ids, STRtree(shapes)


@lru_cache(maxsize=4105)
def _whole_precinct_school(county: str, precinct: str) -> int | None:
    pos = _precinct_index().get((county, precinct))
    if pos is None:
        return None
    shape = _maps()[1].geometries[pos]
    _, schools = _education_map()
    candidates = schools.query(shape, predicate="dwithin", distance=_MARGIN_METRES)
    if len(candidates) == 1:
        i = int(candidates[0])
        polygon = schools.geometries[i]
        if polygon.covers(shape) and polygon.boundary.distance(shape) > _MARGIN_METRES:
            return i
    return None


def corroborated_school(
    geography: HistoricalGeography,
    points: Iterable[tuple[float, float]],
    *,
    school_name: str,
    school_district: str,
    street_school: tuple[str, str] | None = None,
) -> HistoricalGeography:
    """Match the same house's SOS name and number against its pre-election map.

    The caller verifies the house/unit range and precinct. The race reader
    independently requires the matching school type/number on that November
    precinct's results. Without exact points, the entire street range or
    entire precinct must qualify.
    A separately confirmed election-day school takes precedence.
    """
    if geography.school_type or geography.school_district:
        return geography
    if (
        not school_name
        or not school_district.isascii()
        or not school_district.isdigit()
    ):
        return geography
    places = list(points)
    with _LOAD_LOCK:
        schools, tree = _education_map()
        whole = (
            _whole_precinct_school(geography.county_code, geography.precinct_code)
            if not places
            else None
        )
    if places:
        match = None
        for lat, lon in places:
            if not (43 < lat < 50 and -98 < lon < -89):
                return geography
            point = Point(*_PROJECT.transform(lon, lat))
            i = _unique_interior(tree, point)
            if i is None or (match is not None and i != match):
                return geography
            match = i
    elif street_school:
        match = next(
            (i for i, row in enumerate(schools) if row[:2] == street_school), None
        )
        if whole is not None and whole != match:
            return geography
    else:
        match = whole
    if match is None:
        return geography
    district_type, number, name, aliases = schools[match]
    if school_district.lstrip("0") != number or _school_name(school_name) not in {
        name,
        aliases.get(geography.county_code),
    }:
        return geography
    # Minnesota Statutes 128.02 assigns ISD 166 board seats by commissioner district.
    subdistrict = (
        geography.commissioner_district
        if geography.county_code == "16" and district_type == "ISD" and number == "166"
        else None
    )
    return replace(
        geography,
        school_type=district_type,
        school_district=number,
        school_subdistrict=subdistrict,
    )


def historical_geography(
    points: Iterable[tuple[float, float]],
) -> HistoricalGeography | None:
    """Require a single election precinct for all exact MN (lat, lon) address points.

    If the points straddle a school boundary only the school is unconfirmed;
    the rest of their common precinct's supported races can still be shown.
    """
    places = list(points)
    if not places:
        return None
    # A burst of first requests should decompress and index the map only once.
    with _LOAD_LOCK:
        precincts, precinct_tree, schools, school_tree, township_ids, township_tree = (
            _all_maps()
        )
    matched: set[HistoricalGeography] = set()
    matched_schools: set[tuple[str, str] | None] = set()
    matched_townships: set[str | None] = set()
    for lat, lon in places:
        if not (43 < lat < 50 and -98 < lon < -89):
            return None
        xy = Point(*_PROJECT.transform(lon, lat))
        precinct = _unique_interior(precinct_tree, xy)
        if precinct is None:
            return None
        matched.add(precincts[precinct])
        if len(matched) > 1:
            return None
        school = _unique_interior(school_tree, xy)
        matched_schools.add(None if school is None else schools[school])
        if precincts[precinct].municipality_code == "44980":
            township = _unique_interior(township_tree, xy)
            matched_townships.add(None if township is None else township_ids[township])
    area = matched.pop()
    if len(matched_townships) == 1:
        area = replace(area, township_code=matched_townships.pop())
    if len(matched_schools) == 1 and (school_id := matched_schools.pop()):
        return replace(area, school_type=school_id[0], school_district=school_id[1])
    return area
