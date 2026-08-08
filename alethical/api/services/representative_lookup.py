from __future__ import annotations

import argparse
import json
import logging
import os
import re
import time
from dataclasses import asdict, dataclass
from functools import lru_cache
from pathlib import Path

import requests
from shapely.geometry import Point, mapping, shape
from shapely.geometry.base import BaseGeometry

from alethical.api.services.legislative_districts import (
    LegislativeDistrictDataError,
    legislative_districts_for_point,
)
from alethical.logging import configure_logging

logger = logging.getLogger(__name__)


class RepresentativeLookupError(Exception):
    pass


class RepresentativeLookupNotFound(RepresentativeLookupError):
    pass


class RepresentativeLookupOutsideMinnesota(RepresentativeLookupError):
    pass


class RepresentativeLookupChoices(RepresentativeLookupError):
    def __init__(self, choices: list[GeocodedAddress]) -> None:
        super().__init__("more than one Minnesota address matched")
        self.choices = choices


class RepresentativeLookupUpstreamError(RepresentativeLookupError):
    pass


@dataclass(frozen=True)
class GeocodedAddress:
    requested_address: str
    matched_address: str
    latitude: float
    longitude: float
    state_code: str | None = None


@dataclass(frozen=True)
class DistrictMatch:
    chamber: str
    district_code: str
    member_name: str | None = None
    party: str | None = None
    geometry: dict | None = None


@dataclass(frozen=True)
class RepresentativeLookupResult:
    geocoded_address: GeocodedAddress
    house_district: DistrictMatch | None = None
    senate_district: DistrictMatch | None = None
    congressional_district: str | None = None


# The GIS service uses WGS84 longitude/latitude coordinates. At Minnesota's
# latitude, this is no more than 5 metres in either direction and is therefore a
# conservative simplification allowance.
GEOMETRY_REDUCTION_DEGREES = 5 / 111_320
CONGRESSIONAL_DISTRICTS_PATH = (
    Path(__file__).resolve().parents[1]
    / "data"
    / "congressional_districts_2022.geojson"
)
MINNESOTA_ADDRESS_POINTS_URL = (
    "https://enterprise.gisdata.mn.gov/aghost/rest/services/"
    "us_mn_state_mngeo/loc_addresses_open/FeatureServer/0/query"
)
UPSTREAM_RETRY_DELAYS_SECONDS = (0.2, 0.6)
RETRYABLE_UPSTREAM_STATUS_CODES = {408, 425, 500, 502, 503, 504}


def _get_json(*, url: str, params: dict, timeout: float):
    for attempt in range(len(UPSTREAM_RETRY_DELAYS_SECONDS) + 1):
        try:
            response = requests.get(url, params=params, timeout=timeout)
            response.raise_for_status()
            return response.json()
        except (requests.Timeout, requests.ConnectionError):
            if attempt >= len(UPSTREAM_RETRY_DELAYS_SECONDS):
                raise
        except requests.HTTPError as exc:
            status_code = exc.response.status_code if exc.response is not None else None
            if status_code not in RETRYABLE_UPSTREAM_STATUS_CODES or attempt >= len(
                UPSTREAM_RETRY_DELAYS_SECONDS
            ):
                raise
        time.sleep(UPSTREAM_RETRY_DELAYS_SECONDS[attempt])

    raise AssertionError("upstream retry loop ended unexpectedly")


_DIRECTION_ALIASES = {
    "N": "NORTH",
    "NORTH": "NORTH",
    "NE": "NORTHEAST",
    "NORTHEAST": "NORTHEAST",
    "E": "EAST",
    "EAST": "EAST",
    "SE": "SOUTHEAST",
    "SOUTHEAST": "SOUTHEAST",
    "S": "SOUTH",
    "SOUTH": "SOUTH",
    "SW": "SOUTHWEST",
    "SOUTHWEST": "SOUTHWEST",
    "W": "WEST",
    "WEST": "WEST",
    "NW": "NORTHWEST",
    "NORTHWEST": "NORTHWEST",
}
_STREET_TYPE_ALIASES = {
    "ALY": "ALLEY",
    "ALLEY": "ALLEY",
    "ANX": "ANNEX",
    "ANNEX": "ANNEX",
    "AVE": "AVENUE",
    "AVENUE": "AVENUE",
    "BCH": "BEACH",
    "BEACH": "BEACH",
    "BND": "BEND",
    "BEND": "BEND",
    "BLF": "BLUFF",
    "BLUFF": "BLUFF",
    "BLVD": "BOULEVARD",
    "BOULEVARD": "BOULEVARD",
    "BYP": "BYPASS",
    "BYPASS": "BYPASS",
    "CTR": "CENTER",
    "CENTER": "CENTER",
    "CIR": "CIRCLE",
    "CIRCLE": "CIRCLE",
    "CT": "COURT",
    "COURT": "COURT",
    "CV": "COVE",
    "COVE": "COVE",
    "CRK": "CREEK",
    "CREEK": "CREEK",
    "CRES": "CRESCENT",
    "CRESCENT": "CRESCENT",
    "XING": "CROSSING",
    "CROSSING": "CROSSING",
    "XRD": "CROSSROAD",
    "CROSSROAD": "CROSSROAD",
    "DR": "DRIVE",
    "DRIVE": "DRIVE",
    "EST": "ESTATE",
    "ESTATE": "ESTATE",
    "EXT": "EXTENSION",
    "EXTENSION": "EXTENSION",
    "FWY": "FREEWAY",
    "FREEWAY": "FREEWAY",
    "GDN": "GARDEN",
    "GARDEN": "GARDEN",
    "GLN": "GLEN",
    "GLEN": "GLEN",
    "GRN": "GREEN",
    "GREEN": "GREEN",
    "GRV": "GROVE",
    "GROVE": "GROVE",
    "HBR": "HARBOR",
    "HARBOR": "HARBOR",
    "HTS": "HEIGHTS",
    "HEIGHTS": "HEIGHTS",
    "HWY": "HIGHWAY",
    "HIGHWAY": "HIGHWAY",
    "HL": "HILL",
    "HILL": "HILL",
    "HLS": "HILLS",
    "HILLS": "HILLS",
    "HOLW": "HOLLOW",
    "HOLLOW": "HOLLOW",
    "JCT": "JUNCTION",
    "JUNCTION": "JUNCTION",
    "LK": "LAKE",
    "LAKE": "LAKE",
    "LN": "LANE",
    "LANE": "LANE",
    "LNDG": "LANDING",
    "LANDING": "LANDING",
    "LOOP": "LOOP",
    "MNR": "MANOR",
    "MANOR": "MANOR",
    "MEWS": "MEWS",
    "PARK": "PARK",
    "PKWY": "PARKWAY",
    "PARKWAY": "PARKWAY",
    "PASS": "PASS",
    "PATH": "PATH",
    "PL": "PLACE",
    "PLACE": "PLACE",
    "PLZ": "PLAZA",
    "PLAZA": "PLAZA",
    "PT": "POINT",
    "POINT": "POINT",
    "RD": "ROAD",
    "ROAD": "ROAD",
    "RDG": "RIDGE",
    "RIDGE": "RIDGE",
    "RIV": "RIVER",
    "RIVER": "RIVER",
    "RTE": "ROUTE",
    "ROUTE": "ROUTE",
    "ROW": "ROW",
    "RUN": "RUN",
    "SHR": "SHORE",
    "SHORE": "SHORE",
    "SQ": "SQUARE",
    "SQUARE": "SQUARE",
    "ST": "STREET",
    "STREET": "STREET",
    "SMT": "SUMMIT",
    "SUMMIT": "SUMMIT",
    "TER": "TERRACE",
    "TERRACE": "TERRACE",
    "TRCE": "TRACE",
    "TRACE": "TRACE",
    "TRL": "TRAIL",
    "TRAIL": "TRAIL",
    "TURN": "TURN",
    "VW": "VIEW",
    "VIEW": "VIEW",
    "VLG": "VILLAGE",
    "VILLAGE": "VILLAGE",
    "VIS": "VISTA",
    "VISTA": "VISTA",
    "WALK": "WALK",
    "WAY": "WAY",
}
# Full street endings currently present in Minnesota's official address-point
# service. Common typed abbreviations are normalized above.
_MINNESOTA_STREET_TYPES = frozenset(
    item.strip()
    for item in """
ABBEY|ACCESS|ACRES|ALCOVE|ALLEY|ANNEX|AVENUE|AVENUE COURT|BAY|BEACH|BEND|BLUFF|
BLUFFS|BOULEVARD|BYPASS|CAMP|CARTWAY|CENTER|CHASE|CIRCLE|CLOSE|CORNERS|COUNTY ROAD|
COURT|COVE|CREEK|CRESCENT|CREST|CROSS|CROSSING|CROSSINGS|CROSSROAD|CURVE|DALE|DOWN|
DOWNS|DRAW|DRIVE|ECHO|EDGE|END|ENTRANCE|ENTRY|ESTATE|ESTATES|EXTENSION|FOREST ROAD|
FREEWAY|GABLES|GARDEN|GARDENS|GATE|GLADE|GLEN|GRADE|GREEN|GREENWAY|GROVE|HARBOR|
HAVEN|HEIGHTS|HIDEAWAY|HIGHWAY|HILL|HILLS|HOLLOW|HORN|ISLAND|ISLANDS|ISLE|ISLES|
JUNCTION|KNOLL|KNOLLS|LAKE|LANDING|LANE|LINE|LOOKOUT|LOOP|MALL|MANOR|MEWS|NARROWS|
OVERLOOK|PARK|PARKWAY|PASS|PASSAGE|PATH|PLACE|PLAZA|POINT|POINTE|PUBLIC ACCESS|RIDGE|
RISE|RIVER|ROAD|ROADS|ROUTE|ROW|RUN|SHORE|SHORES|SKIES|SPUR|SQUARE|STREET|SUMMIT|
TERRACE|TRACE|TRAIL|TRUCK TRAIL|TURN|VIEW|VILLAGE|VISTA|WALK|WAY
""".split("|")
    if item.strip()
)
_STREET_PREFIX_TYPES = (
    ("COUNTY", "STATE", "AID", "HIGHWAY"),
    ("COUNTY", "HIGHWAY"),
    ("COUNTY", "ROAD"),
    ("COUNTY", "ROUTE"),
    ("STATE", "HIGHWAY"),
    ("STATE", "ROUTE"),
    ("TOWNSHIP", "HIGHWAY"),
    ("TOWNSHIP", "ROAD"),
    ("TRUNK", "HIGHWAY"),
    ("US", "HIGHWAY"),
    ("US", "ROUTE"),
    ("U", "S", "HIGHWAY"),
    ("U", "S", "ROUTE"),
    ("HIGHWAY",),
)
_ADDRESS_POINT_FIELDS = (
    "anumberpre",
    "anumber",
    "anumbersuf",
    "st_pre_mod",
    "st_pre_dir",
    "st_pre_typ",
    "st_pre_sep",
    "st_name",
    "st_pos_typ",
    "st_pos_dir",
    "st_pos_mod",
    "postcomm",
    "ctu_name",
    "zip",
    "state_code",
    "longitude",
    "latitude",
    "status",
)


@dataclass(frozen=True)
class _AddressPointQuery:
    house_number: int
    house_suffix: str | None
    street_names: tuple[str, ...]
    street_type: str | None
    pre_direction: str | None
    post_direction: str | None
    locality: str | None
    zip_code: str | None


@dataclass(frozen=True)
class _ParsedMinnesotaAddress:
    street: str
    locality: str | None
    zip_code: str | None


def _address_words(value: str) -> list[str]:
    return re.findall(r"[A-Z0-9]+(?:[-'][A-Z0-9]+)?", value, re.IGNORECASE)


def _normalized_address_text(value: str) -> str:
    return " ".join(re.findall(r"[A-Z0-9]+", value.upper()))


def _normalized_locality_text(value: str) -> str:
    words = _normalized_address_text(value).split()
    if words:
        words[0] = {"FT": "FORT", "MT": "MOUNT", "ST": "SAINT"}.get(words[0], words[0])
    return " ".join(words)


def _close_direction(value: str) -> str | None:
    normalized = _normalized_address_text(value)
    exact = _DIRECTION_ALIASES.get(normalized)
    if exact is not None:
        return exact
    matches = {
        direction
        for direction in set(_DIRECTION_ALIASES.values())
        if _close_text_distance(normalized, direction) is not None
    }
    return next(iter(matches)) if len(matches) == 1 else None


def _close_street_type(value: str) -> str | None:
    normalized = _normalized_address_text(value)
    exact = _STREET_TYPE_ALIASES.get(normalized)
    if exact is not None:
        return exact
    if normalized in _MINNESOTA_STREET_TYPES:
        return normalized
    matches = {
        street_type
        for street_type in _MINNESOTA_STREET_TYPES
        if _close_text_distance(normalized, street_type) is not None
    }
    return next(iter(matches)) if len(matches) == 1 else None


def _punctuation_free_address_candidates(
    before_state: str, zip_code: str | None
) -> list[_ParsedMinnesotaAddress]:
    words = _address_words(before_state)
    if len(words) < 3 or re.fullmatch(r"\d+[A-Z]?", words[0], re.IGNORECASE) is None:
        return []

    candidates: list[_ParsedMinnesotaAddress] = []
    for type_end in range(len(words), 2, -1):
        type_widths = (2, 1) if type_end >= 4 else (1,)
        street_type = None
        for width in type_widths:
            street_type = _close_street_type(
                " ".join(words[type_end - width : type_end])
            )
            if street_type:
                break
        if street_type is None:
            continue
        street_end = type_end
        possible_ends = [street_end]
        if street_end < len(words) and _close_direction(words[street_end]):
            possible_ends.insert(0, street_end + 1)
        for end in possible_ends:
            locality_words = words[end:]
            candidates.append(
                _ParsedMinnesotaAddress(
                    street=" ".join(words[:end]),
                    locality=" ".join(locality_words) if locality_words else None,
                    zip_code=zip_code,
                )
            )

    deduped: list[_ParsedMinnesotaAddress] = []
    seen: set[tuple[str, str | None]] = set()
    for candidate in candidates:
        key = (
            candidate.street.casefold(),
            candidate.locality.casefold() if candidate.locality else None,
        )
        if key in seen:
            continue
        seen.add(key)
        deduped.append(candidate)
    return deduped[:4]


def _minnesota_address_candidates(
    address_text: str,
) -> tuple[_ParsedMinnesotaAddress, ...]:
    compact = re.sub(r"\s+", " ", address_text.strip())
    state_matches = list(re.finditer(r"\b(?:MN|MINNESOTA)\b", compact, re.IGNORECASE))
    if not state_matches:
        return ()
    state_match = state_matches[-1]
    after_state = compact[state_match.end() :].strip(" ,;.")
    if after_state and re.fullmatch(r"\d{5}(?:-\d{4})?", after_state) is None:
        return ()
    zip_match = re.search(r"\b(\d{5})(?:-\d{4})?\b", after_state)
    zip_code = zip_match.group(1) if zip_match else None
    before_state = compact[: state_match.start()].strip(" ,;")

    separated = [
        part.strip() for part in re.split(r"[,;]+", before_state) if part.strip()
    ]
    if len(separated) >= 2:
        street = " ".join(_address_words(separated[0]))
        locality = " ".join(_address_words(" ".join(separated[1:]))) or None
        if re.match(r"^\d+[A-Z]?\s+\S", street, re.IGNORECASE):
            return (
                _ParsedMinnesotaAddress(
                    street=street,
                    locality=locality,
                    zip_code=zip_code,
                ),
            )
        return ()

    return tuple(_punctuation_free_address_candidates(before_state, zip_code))


def _damerau_levenshtein(left: str, right: str) -> int:
    rows = len(left) + 1
    columns = len(right) + 1
    distance = [[0] * columns for _ in range(rows)]
    for row in range(rows):
        distance[row][0] = row
    for column in range(columns):
        distance[0][column] = column
    for row in range(1, rows):
        for column in range(1, columns):
            cost = 0 if left[row - 1] == right[column - 1] else 1
            distance[row][column] = min(
                distance[row - 1][column] + 1,
                distance[row][column - 1] + 1,
                distance[row - 1][column - 1] + cost,
            )
            if (
                row > 1
                and column > 1
                and left[row - 1] == right[column - 2]
                and left[row - 2] == right[column - 1]
            ):
                distance[row][column] = min(
                    distance[row][column], distance[row - 2][column - 2] + 1
                )
    return distance[-1][-1]


def _maximum_close_edits(value: str) -> int:
    length = len(value.replace(" ", ""))
    return 0 if length < 5 else 1


def _close_text_distance(requested: str, candidate: str) -> int | None:
    requested_words = _normalized_address_text(requested).split()
    candidate_words = _normalized_address_text(candidate).split()
    if requested_words == candidate_words:
        return 0
    if len(requested_words) != len(candidate_words):
        return None

    total_distance = 0
    for requested_word, candidate_word in zip(
        requested_words, candidate_words, strict=True
    ):
        if requested_word == candidate_word:
            continue
        if _maximum_close_edits(requested_word) == 0:
            return None
        distance = _damerau_levenshtein(requested_word, candidate_word)
        if distance > 1:
            return None
        total_distance += distance
        if total_distance > 1:
            return None
    return total_distance


def _close_locality_distance(requested: str, candidate: str) -> int | None:
    return _close_text_distance(
        _normalized_locality_text(requested),
        _normalized_locality_text(candidate),
    )


def _geometry(value: dict) -> BaseGeometry:
    try:
        parsed = shape(value)
    except (AttributeError, TypeError, ValueError) as exc:
        raise RepresentativeLookupUpstreamError(
            "GIS response has invalid geometry"
        ) from exc
    if (
        parsed.is_empty
        or not parsed.is_valid
        or parsed.geom_type
        not in {
            "Polygon",
            "MultiPolygon",
        }
    ):
        raise RepresentativeLookupUpstreamError("GIS response has invalid geometry")
    return parsed


def geometry_covers_point(geometry: dict, *, longitude: float, latitude: float) -> bool:
    """Boundary-inclusive point check for Polygon and MultiPolygon GeoJSON."""
    return _geometry(geometry).covers(Point(longitude, latitude))


def prepare_district_geometry(
    geometry: dict, *, longitude: float, latitude: float
) -> dict:
    """Reduce a district shape only when its topology and selected point survive."""
    original = _geometry(geometry)
    selected = Point(longitude, latitude)
    if not original.covers(selected):
        raise RepresentativeLookupUpstreamError(
            "selected point is not covered by returned district geometry"
        )
    reduced = original.simplify(GEOMETRY_REDUCTION_DEGREES, preserve_topology=True)
    if (
        reduced.is_empty
        or not reduced.is_valid
        or not reduced.buffer(GEOMETRY_REDUCTION_DEGREES).covers(selected)
    ):
        reduced = original
    return mapping(reduced)


def validate_district_containment(
    house_geometry: dict,
    senate_geometry: dict,
    *,
    house_code: str,
    senate_code: str,
) -> None:
    """Validate the House/Senate relationship without comparing full outlines.

    The official API already returns districts that cover the selected point.
    Its House and Senate response shapes are prepared separately, so their shared
    edges need not be identical. Codes and a House interior point still catch a
    mismatched Senate district without rejecting valid lookups over edge slivers.
    """
    house = _geometry(house_geometry)
    senate = _geometry(senate_geometry)
    expected_senate = re.sub(r"[A-Z]$", "", house_code).lstrip("0") or "0"
    normalized_senate = senate_code.lstrip("0") or "0"
    if expected_senate != normalized_senate:
        raise RepresentativeLookupUpstreamError(
            "House and Senate district codes do not nest"
        )
    if not senate.buffer(GEOMETRY_REDUCTION_DEGREES).covers(
        house.representative_point()
    ):
        raise RepresentativeLookupUpstreamError(
            "House district interior is outside Senate district geometry"
        )


@lru_cache(maxsize=1)
def _congressional_district_geometries() -> tuple[tuple[str, BaseGeometry], ...]:
    try:
        payload = json.loads(CONGRESSIONAL_DISTRICTS_PATH.read_text())
    except (OSError, json.JSONDecodeError) as exc:
        raise RepresentativeLookupUpstreamError(
            "Congressional district map could not be loaded"
        ) from exc

    features = payload.get("features", [])
    if not isinstance(features, list):
        raise RepresentativeLookupUpstreamError(
            "Congressional district map is missing features"
        )

    districts: list[tuple[str, BaseGeometry]] = []
    for feature in features:
        properties = feature.get("properties") or {}
        district_code = str(properties.get("district", "")).strip()
        geometry = feature.get("geometry")
        if not re.fullmatch(r"[1-8]", district_code) or not isinstance(geometry, dict):
            raise RepresentativeLookupUpstreamError(
                "Congressional district map has an invalid feature"
            )
        districts.append((district_code, _geometry(geometry)))

    if {district for district, _ in districts} != {
        str(number) for number in range(1, 9)
    }:
        raise RepresentativeLookupUpstreamError(
            "Congressional district map is incomplete"
        )
    return tuple(districts)


def congressional_district_for_point(
    *, longitude: float, latitude: float
) -> str | None:
    point = Point(longitude, latitude)
    matches = [
        district
        for district, geometry in _congressional_district_geometries()
        if geometry.covers(point)
    ]
    if len(matches) > 1:
        raise RepresentativeLookupUpstreamError(
            "Point falls on more than one congressional district boundary"
        )
    return matches[0] if matches else None


class CensusGeocoder:
    def __init__(
        self,
        *,
        base_url: str | None = None,
        benchmark: str | None = None,
        timeout_seconds: float | None = None,
    ) -> None:
        self.base_url = base_url or os.environ.get(
            "ALETHICAL_CENSUS_GEOCODER_URL",
            "https://geocoding.geo.census.gov/geocoder/locations/onelineaddress",
        )
        self.benchmark = benchmark or os.environ.get(
            "ALETHICAL_CENSUS_BENCHMARK", "Public_AR_Current"
        )
        self.timeout_seconds = timeout_seconds or float(
            os.environ.get("ALETHICAL_HTTP_TIMEOUT_SECONDS", "10")
        )

    def geocode_matches(self, address_text: str) -> list[GeocodedAddress]:
        raw_matches = self._raw_matches(address_text)
        if not raw_matches:
            for relaxed_address in self._minnesota_street_only_addresses(address_text):
                if relaxed_address.casefold() == address_text.strip().casefold():
                    continue
                raw_matches = self._raw_matches(relaxed_address)
                if raw_matches:
                    break
        if not raw_matches:
            raise RepresentativeLookupNotFound("address could not be geocoded")

        matches: list[GeocodedAddress] = []
        for match in raw_matches:
            if not isinstance(match, dict):
                continue
            coordinates = match.get("coordinates")
            if not isinstance(coordinates, dict):
                coordinates = {}
            address_components = match.get("addressComponents")
            if not isinstance(address_components, dict):
                address_components = {}
            matched_address = match.get("matchedAddress")
            latitude = coordinates.get("y")
            longitude = coordinates.get("x")
            if matched_address is None or latitude is None or longitude is None:
                continue
            try:
                parsed_latitude = float(str(latitude))
                parsed_longitude = float(str(longitude))
            except (TypeError, ValueError):
                continue
            matches.append(
                GeocodedAddress(
                    requested_address=address_text,
                    matched_address=str(matched_address),
                    latitude=parsed_latitude,
                    longitude=parsed_longitude,
                    state_code=self._state_code(address_components.get("state")),
                )
            )
        if not matches:
            raise RepresentativeLookupUpstreamError(
                "geocoder response missing coordinates"
            )
        minnesota_matches = [match for match in matches if match.state_code == "MN"]
        if not minnesota_matches:
            raise RepresentativeLookupOutsideMinnesota(
                "address resolved outside Minnesota"
            )
        return minnesota_matches[:5]

    def _raw_matches(self, address_text: str) -> list[object]:
        payload = _get_json(
            url=self.base_url,
            params={
                "address": address_text,
                "benchmark": self.benchmark,
                "format": "json",
            },
            timeout=self.timeout_seconds,
        )
        raw_matches = payload.get("result", {}).get("addressMatches", [])
        return raw_matches if isinstance(raw_matches, list) else []

    @staticmethod
    def _minnesota_street_only_address(address_text: str) -> str | None:
        addresses = CensusGeocoder._minnesota_street_only_addresses(address_text)
        return addresses[0] if addresses else None

    @staticmethod
    def _minnesota_street_only_addresses(address_text: str) -> tuple[str, ...]:
        return tuple(
            f"{candidate.street}, MN"
            for candidate in _minnesota_address_candidates(address_text)
        )

    def geocode(self, address_text: str) -> GeocodedAddress:
        """Compatibility helper for callers that require exactly one match."""
        matches = self.geocode_matches(address_text)
        if len(matches) > 1:
            raise RepresentativeLookupChoices(matches)
        return matches[0]

    @staticmethod
    def _state_code(value) -> str | None:
        text = str(value).strip().upper() if value is not None else ""
        return text or None


class MinnesotaAddressPointGeocoder:
    """Use Minnesota's public address points after the Census has no match."""

    def __init__(
        self,
        *,
        base_url: str | None = None,
        timeout_seconds: float | None = None,
    ) -> None:
        self.base_url = base_url or os.environ.get(
            "ALETHICAL_MN_ADDRESS_POINTS_URL", MINNESOTA_ADDRESS_POINTS_URL
        )
        self.timeout_seconds = timeout_seconds or float(
            os.environ.get("ALETHICAL_HTTP_TIMEOUT_SECONDS", "10")
        )

    def suggest_matches(self, address_text: str) -> list[GeocodedAddress]:
        query = self._parse_suggestion_query(address_text)
        if query is None:
            return []

        street_clauses = []
        for street_name in query.street_names:
            escaped = street_name.replace("'", "''")
            street_clauses.append(f"UPPER(st_name) LIKE '{escaped}%'")
        where_parts = [
            f"anumber = {query.house_number}",
            f"({' OR '.join(street_clauses)})",
            "(state_code IS NULL OR UPPER(state_code) = 'MN')",
            "UPPER(status) = 'ACTIVE'",
        ]
        if query.house_suffix:
            suffix = query.house_suffix.replace("'", "''")
            where_parts.append(f"UPPER(anumbersuf) = '{suffix}'")

        features, _ = self._request_features(where_parts, result_record_count=200)
        active_features = [
            feature
            for feature in features
            if isinstance(feature, dict)
            and isinstance(feature.get("attributes"), dict)
            and self._normalize(feature["attributes"].get("status")) == "ACTIVE"
        ]
        candidates = self._candidates(
            address_text,
            (query,),
            active_features,
            allow_fuzzy_street=False,
            allow_street_prefix=True,
        )
        candidates.sort(key=self._suggestion_candidate_rank)
        return [match for match, _, _, _, _ in candidates[:5]]

    def geocode_matches(self, address_text: str) -> list[GeocodedAddress]:
        queries = self._parse_queries(address_text)
        if not queries:
            raise RepresentativeLookupNotFound("address could not be geocoded")

        query = queries[0]
        street_names = sorted(
            {street_name for item in queries for street_name in item.street_names}
        )
        escaped_street_names = ", ".join(
            f"'{name.replace("'", "''")}'" for name in street_names
        )
        where_parts = [
            f"anumber = {query.house_number}",
            f"UPPER(st_name) IN ({escaped_street_names})",
            "(state_code IS NULL OR UPPER(state_code) = 'MN')",
            "(status IS NULL OR UPPER(status) <> 'RETIRED')",
        ]
        if query.house_suffix:
            suffix = query.house_suffix.replace("'", "''")
            where_parts.append(f"UPPER(anumbersuf) = '{suffix}'")

        features, _ = self._request_features(where_parts, result_record_count=100)
        candidates = self._candidates(
            address_text, queries, features, allow_fuzzy_street=False
        )
        if not candidates:
            fuzzy_street_clause = self._fuzzy_street_clause(queries)
            if fuzzy_street_clause:
                fuzzy_parts = [
                    part
                    for part in where_parts
                    if not part.startswith("UPPER(st_name) IN")
                ]
                fuzzy_parts.insert(1, fuzzy_street_clause)
                fuzzy_features, exceeded_limit = self._request_features(
                    fuzzy_parts, result_record_count=2000
                )
                if not exceeded_limit:
                    candidates = self._candidates(
                        address_text,
                        queries,
                        fuzzy_features,
                        allow_fuzzy_street=True,
                    )

        if not candidates:
            raise RepresentativeLookupNotFound("address could not be geocoded")

        closest_street_distance = min(item[3] for item in candidates)
        candidates = [item for item in candidates if item[3] == closest_street_distance]
        zip_matches = [
            item
            for item in candidates
            if item[4].zip_code and item[2] == item[4].zip_code
        ]
        if zip_matches:
            candidates = zip_matches

        locality_scored = []
        for item in candidates:
            requested_locality = item[4].locality
            if not requested_locality:
                continue
            locality_distance = _close_locality_distance(requested_locality, item[1])
            if locality_distance is not None:
                locality_scored.append((locality_distance, item))
        if locality_scored:
            closest_locality_distance = min(item[0] for item in locality_scored)
            candidates = [
                item[1]
                for item in locality_scored
                if item[0] == closest_locality_distance
            ]
        most_specific_query = max(
            self._query_specificity(item[4]) for item in candidates
        )
        candidates = [
            item
            for item in candidates
            if self._query_specificity(item[4]) == most_specific_query
        ]
        return [match for match, _, _, _, _ in candidates[:5]]

    def _request_features(
        self, where_parts: list[str], *, result_record_count: int
    ) -> tuple[list[object], bool]:
        payload = _get_json(
            url=self.base_url,
            params={
                "where": " AND ".join(where_parts),
                "outFields": ",".join(_ADDRESS_POINT_FIELDS),
                "returnGeometry": "false",
                "resultRecordCount": str(result_record_count),
                "f": "json",
            },
            timeout=self.timeout_seconds,
        )
        if not isinstance(payload, dict) or payload.get("error"):
            raise RepresentativeLookupUpstreamError(
                "Minnesota address service returned an error"
            )
        features = payload.get("features", [])
        if not isinstance(features, list):
            raise RepresentativeLookupUpstreamError(
                "Minnesota address service response missing features"
            )

        return features, bool(payload.get("exceededTransferLimit"))

    def _candidates(
        self,
        address_text: str,
        queries: tuple[_AddressPointQuery, ...],
        features: list[object],
        *,
        allow_fuzzy_street: bool,
        allow_street_prefix: bool = False,
    ) -> list[tuple[GeocodedAddress, str, str, int, _AddressPointQuery]]:
        candidates: list[tuple[GeocodedAddress, str, str, int, _AddressPointQuery]] = []
        seen_addresses: dict[str, int] = {}
        for feature in features:
            if not isinstance(feature, dict):
                continue
            attributes = feature.get("attributes")
            if not isinstance(attributes, dict):
                continue
            query_candidates = [
                candidate
                for candidate in (
                    self._candidate(
                        address_text,
                        item,
                        attributes,
                        allow_fuzzy_street=allow_fuzzy_street,
                        allow_street_prefix=allow_street_prefix,
                    )
                    for item in queries
                )
                if candidate is not None
            ]
            if not query_candidates:
                continue
            candidate = min(query_candidates, key=self._candidate_query_rank)
            match, locality, zip_code, distance, matched_query = candidate
            key = match.matched_address.casefold()
            if key in seen_addresses:
                existing_index = seen_addresses[key]
                if distance < candidates[existing_index][3]:
                    candidates[existing_index] = candidate
                continue
            seen_addresses[key] = len(candidates)
            candidates.append((match, locality, zip_code, distance, matched_query))
        return candidates

    @classmethod
    def _fuzzy_street_clause(
        cls, queries: tuple[_AddressPointQuery, ...]
    ) -> str | None:
        clauses: set[str] = set()
        for query in queries:
            for street_name in query.street_names:
                compact = re.sub(r"[^A-Z0-9]", "", street_name)
                if _maximum_close_edits(compact) == 0:
                    continue
                prefix = compact[:2]
                suffix = compact[-2:]
                clauses.add(f"UPPER(st_name) LIKE '{prefix}%'")
                clauses.add(f"UPPER(st_name) LIKE '%{suffix}'")
        if not clauses:
            return None
        return f"({' OR '.join(sorted(clauses))})"

    @staticmethod
    def _query_specificity(query: _AddressPointQuery) -> int:
        return sum(
            value is not None
            for value in (
                query.street_type,
                query.pre_direction,
                query.post_direction,
            )
        )

    @classmethod
    def _candidate_query_rank(
        cls,
        candidate: tuple[GeocodedAddress, str, str, int, _AddressPointQuery],
    ) -> tuple[int, int, int, int, int]:
        _, locality, zip_code, street_distance, query = candidate
        zip_rank = 0 if query.zip_code and query.zip_code == zip_code else 1
        locality_distance = (
            _close_locality_distance(query.locality, locality)
            if query.locality
            else None
        )
        locality_rank = 0 if locality_distance is not None else 1
        return (
            street_distance,
            zip_rank,
            locality_rank,
            locality_distance or 0,
            -cls._query_specificity(query),
        )

    @classmethod
    def _suggestion_candidate_rank(
        cls,
        candidate: tuple[GeocodedAddress, str, str, int, _AddressPointQuery],
    ) -> tuple[int, int, int, int, str]:
        match, locality, zip_code, street_distance, query = candidate
        zip_rank = 0
        if query.zip_code:
            zip_rank = 0 if zip_code.startswith(query.zip_code) else 1

        locality_rank = 0
        if query.locality:
            requested = _normalized_locality_text(query.locality)
            candidate_locality = _normalized_locality_text(locality)
            if candidate_locality.startswith(requested):
                locality_rank = 0
            elif _close_locality_distance(requested, candidate_locality) is not None:
                locality_rank = 1
            else:
                locality_rank = 2

        return (
            zip_rank,
            locality_rank,
            street_distance,
            -cls._query_specificity(query),
            match.matched_address.casefold(),
        )

    def _candidate(
        self,
        requested_address: str,
        query: _AddressPointQuery,
        attributes: dict,
        *,
        allow_fuzzy_street: bool,
        allow_street_prefix: bool = False,
    ) -> tuple[GeocodedAddress, str, str, int, _AddressPointQuery] | None:
        state = self._normalize(attributes.get("state_code"))
        if state and state != "MN":
            return None
        try:
            candidate_house_number = int(str(attributes["anumber"]))
        except (KeyError, TypeError, ValueError):
            return None
        if candidate_house_number != query.house_number:
            return None
        street_name = self._normalize(attributes.get("st_name"))
        street_distances = []
        for query_name in query.street_names:
            if allow_street_prefix:
                distance = (
                    len(street_name) - len(query_name)
                    if street_name.startswith(query_name)
                    else None
                )
            elif allow_fuzzy_street:
                distance = _close_text_distance(query_name, street_name)
            else:
                distance = 0 if query_name == street_name else None
            if distance is not None:
                street_distances.append(distance)
        if not street_distances:
            return None
        street_distance = min(street_distances)
        candidate_type = self._street_type(attributes.get("st_pos_typ"))
        if query.street_type and candidate_type and query.street_type != candidate_type:
            return None
        candidate_post_direction = self._direction(attributes.get("st_pos_dir"))
        if (
            query.post_direction
            and candidate_post_direction
            and query.post_direction != candidate_post_direction
        ):
            return None
        if street_name != query.street_names[0] and query.pre_direction:
            if self._direction(attributes.get("st_pre_dir")) != query.pre_direction:
                return None
        try:
            latitude = float(attributes["latitude"])
            longitude = float(attributes["longitude"])
        except (KeyError, TypeError, ValueError):
            return None
        if not (43.0 <= latitude <= 50.0 and -98.0 <= longitude <= -89.0):
            return None

        street = " ".join(
            str(attributes.get(field) or "").strip()
            for field in (
                "anumberpre",
                "anumber",
                "anumbersuf",
                "st_pre_mod",
                "st_pre_dir",
                "st_pre_typ",
                "st_pre_sep",
                "st_name",
                "st_pos_typ",
                "st_pos_dir",
                "st_pos_mod",
            )
            if str(attributes.get(field) or "").strip()
        )
        locality = str(
            attributes.get("postcomm") or attributes.get("ctu_name") or "Minnesota"
        ).strip()
        zip_code = str(attributes.get("zip") or "").strip()
        matched_address = f"{street}, {locality}, MN"
        if zip_code:
            matched_address += f" {zip_code}"
        return (
            GeocodedAddress(
                requested_address=requested_address,
                matched_address=matched_address,
                latitude=latitude,
                longitude=longitude,
                state_code="MN",
            ),
            locality,
            zip_code,
            street_distance,
            query,
        )

    @classmethod
    def _parse_query(cls, address_text: str) -> _AddressPointQuery | None:
        queries = cls._parse_queries(address_text)
        return queries[0] if queries else None

    @classmethod
    def _parse_suggestion_query(cls, address_text: str) -> _AddressPointQuery | None:
        compact = re.sub(r"\s+", " ", address_text.strip())
        parts = [part.strip() for part in re.split(r"[,;]+", compact)]
        street = " ".join(_address_words(parts[0] if parts else ""))
        if re.match(r"^\d+[A-Z]?\s+\S", street, re.IGNORECASE) is None:
            return None

        tail = " ".join(parts[1:])
        zip_match = re.search(r"\b(\d{1,5})\b", tail)
        zip_code = zip_match.group(1) if zip_match else None
        locality_words = [
            word
            for word in _address_words(tail)
            if word.upper() not in {"MN", "MINNESOTA"}
            and not re.fullmatch(r"\d{1,5}", word)
        ]
        query = cls._query_from_parsed_address(
            _ParsedMinnesotaAddress(
                street=street,
                locality=" ".join(locality_words) or None,
                zip_code=zip_code,
            )
        )
        if query is None:
            return None

        street_names = tuple(
            street_name
            for street_name in query.street_names
            if len(re.sub(r"[^A-Z0-9]", "", street_name)) >= 2
            or re.fullmatch(r"\d+", street_name)
        )
        if not street_names:
            return None
        return _AddressPointQuery(
            house_number=query.house_number,
            house_suffix=query.house_suffix,
            street_names=street_names,
            street_type=query.street_type,
            pre_direction=query.pre_direction,
            post_direction=query.post_direction,
            locality=query.locality,
            zip_code=query.zip_code,
        )

    @classmethod
    def _parse_queries(cls, address_text: str) -> tuple[_AddressPointQuery, ...]:
        queries: list[_AddressPointQuery] = []
        seen: set[_AddressPointQuery] = set()
        for parsed in _minnesota_address_candidates(address_text):
            query = cls._query_from_parsed_address(parsed)
            if query is None or query in seen:
                continue
            seen.add(query)
            queries.append(query)
        return tuple(queries)

    @classmethod
    def _query_from_parsed_address(
        cls, parsed: _ParsedMinnesotaAddress
    ) -> _AddressPointQuery | None:
        street_match = re.match(r"^(\d+)([A-Z]?)\s+(.+)$", parsed.street, re.IGNORECASE)
        if street_match is None:
            return None
        house_number = int(street_match.group(1))
        house_suffix = cls._normalize(street_match.group(2)) or None
        street_text = re.split(
            r"\s+(?:APT|APARTMENT|UNIT|SUITE|STE|#)\s*[A-Z0-9-]+\b",
            street_match.group(3),
            maxsplit=1,
            flags=re.IGNORECASE,
        )[0]
        tokens = re.findall(r"[A-Z0-9]+", street_text.upper())
        if not tokens:
            return None

        post_direction = _close_direction(tokens[-1])
        if post_direction:
            tokens.pop()
        possible_name_without_type: str | None = None
        street_type = None
        street_type_width = 0
        for width in (2, 1):
            if len(tokens) < width:
                continue
            street_type = _close_street_type(" ".join(tokens[-width:]))
            if street_type:
                street_type_width = width
                break
        if street_type:
            del tokens[-street_type_width:]
        elif len(tokens) > 1:
            # Minnesota's standard allows many uncommon street types. Keep a
            # second candidate that treats the last word as a type so an
            # unfamiliar abbreviation can still return choices instead of a
            # false no-match.
            possible_name_without_type = " ".join(tokens[:-1])

        for prefix in _STREET_PREFIX_TYPES:
            if tuple(tokens[: len(prefix)]) == prefix and len(tokens) > len(prefix):
                tokens = tokens[len(prefix) :]
                break
        if not tokens:
            return None

        primary_name = " ".join(tokens)
        street_names = [primary_name]
        if (
            possible_name_without_type
            and possible_name_without_type not in street_names
        ):
            street_names.append(possible_name_without_type)
        pre_direction = cls._direction(tokens[0]) if len(tokens) > 1 else None
        if pre_direction:
            alternate_name = " ".join(tokens[1:])
            if alternate_name not in street_names:
                street_names.append(alternate_name)

        return _AddressPointQuery(
            house_number=house_number,
            house_suffix=house_suffix,
            street_names=tuple(street_names),
            street_type=street_type,
            pre_direction=pre_direction,
            post_direction=post_direction,
            locality=parsed.locality,
            zip_code=parsed.zip_code,
        )

    @staticmethod
    def _normalize(value) -> str:
        return " ".join(re.findall(r"[A-Z0-9]+", str(value or "").upper()))

    @classmethod
    def _direction(cls, value) -> str | None:
        return _DIRECTION_ALIASES.get(cls._normalize(value))

    @classmethod
    def _street_type(cls, value) -> str | None:
        normalized = cls._normalize(value)
        return _STREET_TYPE_ALIASES.get(normalized) or (
            normalized if normalized in _MINNESOTA_STREET_TYPES else None
        )


class MinnesotaGisLookupClient:
    def lookup(
        self, *, latitude: float, longitude: float
    ) -> tuple[DistrictMatch | None, DistrictMatch | None, str | None]:
        try:
            house_geometry, senate_geometry = legislative_districts_for_point(
                longitude=longitude,
                latitude=latitude,
            )
        except LegislativeDistrictDataError as exc:
            raise RepresentativeLookupUpstreamError(str(exc)) from exc

        def district_match(source) -> DistrictMatch | None:
            if source is None:
                return None
            return DistrictMatch(
                chamber=source.chamber,
                district_code=source.district_code,
                geometry=prepare_district_geometry(
                    source.geometry,
                    longitude=longitude,
                    latitude=latitude,
                ),
            )

        congressional_district = congressional_district_for_point(
            longitude=longitude,
            latitude=latitude,
        )
        return (
            district_match(house_geometry),
            district_match(senate_geometry),
            congressional_district,
        )


class RepresentativeLookupService:
    def __init__(
        self,
        *,
        geocoder: CensusGeocoder | None = None,
        address_point_geocoder: MinnesotaAddressPointGeocoder | None = None,
        gis_client: MinnesotaGisLookupClient | None = None,
    ) -> None:
        self.geocoder = geocoder or CensusGeocoder()
        self.address_point_geocoder = (
            address_point_geocoder or MinnesotaAddressPointGeocoder()
        )
        self.gis_client = gis_client or MinnesotaGisLookupClient()

    def suggest_addresses(self, address_text: str) -> list[GeocodedAddress]:
        return self.address_point_geocoder.suggest_matches(address_text)

    def lookup(self, address_text: str) -> RepresentativeLookupResult:
        try:
            matches = self.geocoder.geocode_matches(address_text)
        except (RepresentativeLookupNotFound, requests.RequestException):
            matches = self.address_point_geocoder.geocode_matches(address_text)
        except RepresentativeLookupOutsideMinnesota as outside_minnesota:
            try:
                matches = self.address_point_geocoder.geocode_matches(address_text)
            except RepresentativeLookupNotFound:
                raise outside_minnesota
        if len(matches) > 1:
            raise RepresentativeLookupChoices(matches)
        geocoded = matches[0]

        return self.lookup_coordinates(
            latitude=geocoded.latitude,
            longitude=geocoded.longitude,
            requested_address=address_text,
            matched_address=geocoded.matched_address,
            state_code=geocoded.state_code,
        )

    def lookup_coordinates(
        self,
        *,
        latitude: float,
        longitude: float,
        requested_address: str | None = None,
        matched_address: str | None = None,
        state_code: str | None = "MN",
    ) -> RepresentativeLookupResult:
        geocoded = GeocodedAddress(
            requested_address=requested_address or f"{latitude}, {longitude}",
            matched_address=matched_address or f"{latitude}, {longitude}",
            latitude=latitude,
            longitude=longitude,
            state_code=state_code,
        )
        house_match, senate_match, congressional_district = self.gis_client.lookup(
            latitude=geocoded.latitude,
            longitude=geocoded.longitude,
        )
        if house_match is None and senate_match is None:
            raise RepresentativeLookupNotFound(
                "no Minnesota legislative districts found"
            )

        return RepresentativeLookupResult(
            geocoded_address=geocoded,
            house_district=house_match,
            senate_district=senate_match,
            congressional_district=congressional_district,
        )


def get_representative_lookup_service() -> RepresentativeLookupService:
    return RepresentativeLookupService()


def result_to_dict(result: RepresentativeLookupResult) -> dict:
    return {
        "geocoded_address": asdict(result.geocoded_address),
        "house_district": asdict(result.house_district)
        if result.house_district
        else None,
        "senate_district": asdict(result.senate_district)
        if result.senate_district
        else None,
        "congressional_district": result.congressional_district,
    }


def main(argv: list[str] | None = None) -> int:
    configure_logging()
    parser = argparse.ArgumentParser(
        description="Look up Minnesota legislative districts for an address."
    )
    parser.add_argument(
        "address",
        help="Address to geocode, e.g. '75 Rev Dr Martin Luther King Jr Blvd, Saint Paul, MN'",
    )
    parser.add_argument("--json", action="store_true", help="Print the result as JSON.")
    args = parser.parse_args(argv)

    try:
        result = get_representative_lookup_service().lookup(args.address)
    except RepresentativeLookupNotFound as exc:
        logger.warning("Representative lookup not found: %s", exc)
        return 2
    except requests.RequestException:
        logger.exception("Representative lookup upstream request failed")
        return 3
    except RepresentativeLookupError:
        logger.exception("Representative lookup failed")
        return 1

    if args.json:
        print(json.dumps(result_to_dict(result), indent=2, sort_keys=True))
        return 0

    geocoded = result.geocoded_address
    print(f"Requested address: {geocoded.requested_address}")
    print(f"Matched address: {geocoded.matched_address}")
    print(f"Coordinates: {geocoded.latitude}, {geocoded.longitude}")
    print(f"State: {geocoded.state_code or 'unknown'}")
    if result.house_district:
        print(f"House district: {result.house_district.district_code}")
    else:
        print("House district: not found")
    if result.senate_district:
        print(f"Senate district: {result.senate_district.district_code}")
    else:
        print("Senate district: not found")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
