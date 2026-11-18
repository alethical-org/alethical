"""Voting areas for the November 3, 2026 Minnesota general election."""

from __future__ import annotations

from collections.abc import Iterable
from dataclasses import dataclass, replace
from functools import lru_cache
import gzip
import json
from pathlib import Path
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
def _maps():
    precincts: list[HistoricalGeography] = []
    precinct_shapes = []
    school_ids = []
    school_shapes = []
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
            else:
                raise ValueError("Unrecognized November election map layer")
    if len(precincts) != 4105 or not school_ids:
        raise ValueError("Incomplete November election map")
    return precincts, STRtree(precinct_shapes), school_ids, STRtree(school_shapes)


def _unique_interior(tree: STRtree, point: Point) -> int | None:
    indices = tree.query(point, predicate="dwithin", distance=_MARGIN_METRES)
    if len(indices) != 1:
        return None
    i = int(indices[0])
    polygon = tree.geometries[i]
    if polygon.contains(point) and polygon.boundary.distance(point) > _MARGIN_METRES:
        return i
    return None


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
        precincts, precinct_tree, schools, school_tree = _maps()
    matched: set[HistoricalGeography] = set()
    matched_schools: set[tuple[str, str] | None] = set()
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
    area = matched.pop()
    if len(matched_schools) == 1 and (school_id := matched_schools.pop()):
        return replace(area, school_type=school_id[0], school_district=school_id[1])
    return area
