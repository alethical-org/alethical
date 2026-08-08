from __future__ import annotations

import gzip
import json
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path

from shapely.geometry import Point, shape
from shapely.geometry.base import BaseGeometry


LEGISLATIVE_DISTRICTS_PATH = (
    Path(__file__).resolve().parents[1]
    / "data"
    / "legislative_districts_2022.geojson.gz"
)


class LegislativeDistrictDataError(Exception):
    pass


@dataclass(frozen=True)
class LegislativeDistrictGeometry:
    chamber: str
    district_code: str
    geometry: dict
    _shape: BaseGeometry


def _expected_districts() -> dict[str, set[str]]:
    return {
        "house": {
            f"{number}{suffix}" for number in range(1, 68) for suffix in ("A", "B")
        },
        "senate": {str(number) for number in range(1, 68)},
    }


@lru_cache(maxsize=1)
def _legislative_district_geometries() -> dict[
    str, tuple[LegislativeDistrictGeometry, ...]
]:
    try:
        with gzip.open(LEGISLATIVE_DISTRICTS_PATH, "rt", encoding="utf-8") as source:
            payload = json.load(source)
    except (OSError, EOFError, json.JSONDecodeError) as exc:
        raise LegislativeDistrictDataError(
            "Legislative district map could not be loaded"
        ) from exc

    if payload.get("crs") != "EPSG:4326" or not isinstance(
        payload.get("features"), list
    ):
        raise LegislativeDistrictDataError("Legislative district map is invalid")

    districts: dict[str, list[LegislativeDistrictGeometry]] = {
        "house": [],
        "senate": [],
    }
    for feature in payload["features"]:
        properties = feature.get("properties") or {}
        chamber = properties.get("chamber")
        district_code = properties.get("district")
        geometry = feature.get("geometry")
        if (
            chamber not in districts
            or not isinstance(district_code, str)
            or not isinstance(geometry, dict)
        ):
            raise LegislativeDistrictDataError(
                "Legislative district map has an invalid feature"
            )
        district_shape = shape(geometry)
        if district_shape.is_empty or not district_shape.is_valid:
            raise LegislativeDistrictDataError(
                "Legislative district map has an invalid geometry"
            )
        districts[chamber].append(
            LegislativeDistrictGeometry(
                chamber=chamber,
                district_code=district_code,
                geometry=geometry,
                _shape=district_shape,
            )
        )

    for chamber, expected_codes in _expected_districts().items():
        actual_codes = {district.district_code for district in districts[chamber]}
        if actual_codes != expected_codes or len(districts[chamber]) != len(
            expected_codes
        ):
            raise LegislativeDistrictDataError(
                f"Legislative {chamber} district map is incomplete"
            )

    return {chamber: tuple(items) for chamber, items in districts.items()}


def legislative_districts_for_point(
    *, longitude: float, latitude: float
) -> tuple[
    LegislativeDistrictGeometry | None,
    LegislativeDistrictGeometry | None,
]:
    point = Point(longitude, latitude)
    districts = _legislative_district_geometries()

    def match(chamber: str) -> LegislativeDistrictGeometry | None:
        matches = [
            district for district in districts[chamber] if district._shape.covers(point)
        ]
        if len(matches) > 1:
            raise LegislativeDistrictDataError(
                f"Point falls on more than one {chamber} district boundary"
            )
        return matches[0] if matches else None

    return match("house"), match("senate")
