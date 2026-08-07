from __future__ import annotations

import argparse
import json
import logging
import os
import re
from dataclasses import asdict, dataclass
from functools import lru_cache
from pathlib import Path

import requests
from shapely.geometry import Point, mapping, shape
from shapely.geometry.base import BaseGeometry

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
MAX_SHARED_EDGE_DIFFERENCE_FRACTION = 0.001
CONGRESSIONAL_DISTRICTS_PATH = (
    Path(__file__).resolve().parents[1]
    / "data"
    / "congressional_districts_2022.geojson"
)
MINNESOTA_ADDRESS_POINTS_URL = (
    "https://enterprise.gisdata.mn.gov/aghost/rest/services/"
    "us_mn_state_mngeo/loc_addresses_open/FeatureServer/0/query"
)

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
    "AVE": "AVENUE",
    "AVENUE": "AVENUE",
    "BLVD": "BOULEVARD",
    "BOULEVARD": "BOULEVARD",
    "CIR": "CIRCLE",
    "CIRCLE": "CIRCLE",
    "CT": "COURT",
    "COURT": "COURT",
    "DR": "DRIVE",
    "DRIVE": "DRIVE",
    "HWY": "HIGHWAY",
    "HIGHWAY": "HIGHWAY",
    "LN": "LANE",
    "LANE": "LANE",
    "PKWY": "PARKWAY",
    "PARKWAY": "PARKWAY",
    "PL": "PLACE",
    "PLACE": "PLACE",
    "RD": "ROAD",
    "ROAD": "ROAD",
    "ST": "STREET",
    "STREET": "STREET",
    "TER": "TERRACE",
    "TERRACE": "TERRACE",
    "TRL": "TRAIL",
    "TRAIL": "TRAIL",
    "WAY": "WAY",
}
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
    """Validate nesting while allowing tiny source shared-edge slivers.

    Minnesota reduces House and Senate shapes separately, so large rural
    districts do not carry byte-identical copies of their shared outside edge.
    The interior point and area cap test logical containment away from that edge.
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
    outside_fraction = house.difference(senate).area / house.area
    if outside_fraction > MAX_SHARED_EDGE_DIFFERENCE_FRACTION:
        raise RepresentativeLookupUpstreamError(
            "House district geometry is not contained by Senate district geometry"
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
        relaxed_address = self._minnesota_street_only_address(address_text)
        if (
            not raw_matches
            and relaxed_address is not None
            and relaxed_address.casefold() != address_text.strip().casefold()
        ):
            raw_matches = self._raw_matches(relaxed_address)
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
        response = requests.get(
            self.base_url,
            params={
                "address": address_text,
                "benchmark": self.benchmark,
                "format": "json",
            },
            timeout=self.timeout_seconds,
        )
        response.raise_for_status()
        payload = response.json()
        raw_matches = payload.get("result", {}).get("addressMatches", [])
        return raw_matches if isinstance(raw_matches, list) else []

    @staticmethod
    def _minnesota_street_only_address(address_text: str) -> str | None:
        parts = [part.strip() for part in address_text.split(",")]
        if len(parts) < 2:
            return None
        locality = ", ".join(parts[1:])
        if re.search(r"\b(?:MN|MINNESOTA)\b", locality, re.IGNORECASE) is None:
            return None
        street = parts[0]
        if re.match(r"^\d+\S*\s+\S", street) is None:
            return None
        return f"{street}, MN"

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

    def geocode_matches(self, address_text: str) -> list[GeocodedAddress]:
        query = self._parse_query(address_text)
        if query is None:
            raise RepresentativeLookupNotFound("address could not be geocoded")

        street_names = ", ".join(
            f"'{name.replace("'", "''")}'" for name in query.street_names
        )
        where_parts = [
            f"anumber = {query.house_number}",
            f"UPPER(st_name) IN ({street_names})",
            "(state_code IS NULL OR UPPER(state_code) = 'MN')",
            "(status IS NULL OR UPPER(status) <> 'RETIRED')",
        ]
        if query.house_suffix:
            suffix = query.house_suffix.replace("'", "''")
            where_parts.append(f"UPPER(anumbersuf) = '{suffix}'")

        response = requests.get(
            self.base_url,
            params={
                "where": " AND ".join(where_parts),
                "outFields": ",".join(_ADDRESS_POINT_FIELDS),
                "returnGeometry": "false",
                "resultRecordCount": "100",
                "f": "json",
            },
            timeout=self.timeout_seconds,
        )
        response.raise_for_status()
        payload = response.json()
        if not isinstance(payload, dict) or payload.get("error"):
            raise RepresentativeLookupUpstreamError(
                "Minnesota address service returned an error"
            )
        features = payload.get("features", [])
        if not isinstance(features, list):
            raise RepresentativeLookupUpstreamError(
                "Minnesota address service response missing features"
            )

        candidates: list[tuple[GeocodedAddress, str, str]] = []
        seen_addresses: set[str] = set()
        for feature in features:
            if not isinstance(feature, dict):
                continue
            attributes = feature.get("attributes")
            if not isinstance(attributes, dict):
                continue
            candidate = self._candidate(address_text, query, attributes)
            if candidate is None:
                continue
            match, locality, zip_code = candidate
            key = match.matched_address.casefold()
            if key in seen_addresses:
                continue
            seen_addresses.add(key)
            candidates.append((match, locality, zip_code))

        if not candidates:
            raise RepresentativeLookupNotFound("address could not be geocoded")

        if query.zip_code:
            zip_matches = [item for item in candidates if item[2] == query.zip_code]
            if zip_matches:
                candidates = zip_matches
        if query.locality:
            locality_matches = [
                item
                for item in candidates
                if self._normalize(item[1]) == self._normalize(query.locality)
            ]
            if locality_matches:
                candidates = locality_matches
        return [match for match, _, _ in candidates[:5]]

    def _candidate(
        self,
        requested_address: str,
        query: _AddressPointQuery,
        attributes: dict,
    ) -> tuple[GeocodedAddress, str, str] | None:
        state = self._normalize(attributes.get("state_code"))
        if state and state != "MN":
            return None
        street_name = self._normalize(attributes.get("st_name"))
        if street_name not in query.street_names:
            return None
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
        )

    @classmethod
    def _parse_query(cls, address_text: str) -> _AddressPointQuery | None:
        parts = [part.strip() for part in address_text.split(",")]
        if len(parts) < 2:
            return None
        locality_text = ", ".join(parts[1:])
        if re.search(r"\b(?:MN|MINNESOTA)\b", locality_text, re.IGNORECASE) is None:
            return None
        street_match = re.match(r"^(\d+)([A-Z]?)\s+(.+)$", parts[0], re.IGNORECASE)
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

        post_direction = cls._direction(tokens[-1])
        if post_direction:
            tokens.pop()
        possible_name_without_type: str | None = None
        street_type = cls._street_type(tokens[-1]) if tokens else None
        if street_type:
            tokens.pop()
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

        locality = parts[1] if len(parts) > 2 else None
        zip_match = re.search(r"\b(\d{5})(?:-\d{4})?\b", locality_text)
        return _AddressPointQuery(
            house_number=house_number,
            house_suffix=house_suffix,
            street_names=tuple(street_names),
            street_type=street_type,
            pre_direction=pre_direction,
            post_direction=post_direction,
            locality=locality,
            zip_code=zip_match.group(1) if zip_match else None,
        )

    @staticmethod
    def _normalize(value) -> str:
        return " ".join(re.findall(r"[A-Z0-9]+", str(value or "").upper()))

    @classmethod
    def _direction(cls, value) -> str | None:
        return _DIRECTION_ALIASES.get(cls._normalize(value))

    @classmethod
    def _street_type(cls, value) -> str | None:
        return _STREET_TYPE_ALIASES.get(cls._normalize(value))


class MinnesotaGisLookupClient:
    def __init__(
        self,
        *,
        base_url: str | None = None,
        timeout_seconds: float | None = None,
    ) -> None:
        self.base_url = base_url or os.environ.get(
            "ALETHICAL_MN_GIS_LOOKUP_URL",
            "https://gis.lcc.mn.gov/api/",
        )
        self.timeout_seconds = timeout_seconds or float(
            os.environ.get("ALETHICAL_HTTP_TIMEOUT_SECONDS", "10")
        )

    def lookup(
        self, *, latitude: float, longitude: float
    ) -> tuple[DistrictMatch | None, DistrictMatch | None, str | None]:
        response = requests.get(
            self.base_url,
            params={"lat": latitude, "lng": longitude},
            timeout=self.timeout_seconds,
        )
        response.raise_for_status()
        payload = response.json()
        features = payload.get("features", [])
        if not isinstance(features, list):
            raise RepresentativeLookupUpstreamError("GIS response missing features")

        house_match: DistrictMatch | None = None
        senate_match: DistrictMatch | None = None
        house_source_geometry: dict | None = None
        senate_source_geometry: dict | None = None
        congressional_district = congressional_district_for_point(
            longitude=longitude,
            latitude=latitude,
        )
        for feature in features:
            properties = feature.get("properties") or {}
            district_code = self._extract_district_code(properties)
            chamber = self._infer_chamber(properties, district_code)
            if not district_code or chamber not in {"house", "senate"}:
                continue
            raw_geometry = feature.get("geometry")
            if not isinstance(raw_geometry, dict):
                raise RepresentativeLookupUpstreamError(
                    "GIS response missing district geometry"
                )
            match = DistrictMatch(
                chamber=chamber,
                district_code=district_code,
                member_name=self._string_or_none(properties.get("name")),
                party=self._string_or_none(properties.get("party")),
                geometry=prepare_district_geometry(
                    raw_geometry, longitude=longitude, latitude=latitude
                ),
            )
            if chamber == "house" and house_match is None:
                house_match = match
                house_source_geometry = raw_geometry
            if chamber == "senate" and senate_match is None:
                senate_match = match
                senate_source_geometry = raw_geometry

        if (
            house_match
            and senate_match
            and house_match.geometry
            and senate_match.geometry
            and house_source_geometry is not None
            and senate_source_geometry is not None
        ):
            validate_district_containment(
                house_source_geometry,
                senate_source_geometry,
                house_code=house_match.district_code,
                senate_code=senate_match.district_code,
            )

        return house_match, senate_match, congressional_district

    def _extract_district_code(self, properties: dict) -> str | None:
        for key in ("district", "district_code", "districtCode", "code", "name"):
            value = properties.get(key)
            if not isinstance(value, str):
                continue
            cleaned = value.strip().upper()
            if re.fullmatch(r"\d{1,2}[A-Z]?", cleaned):
                return self._canonical_district_code(cleaned)
            match = re.search(r"\b(\d{1,2}[A-Z]?)\b", cleaned)
            if match:
                return self._canonical_district_code(match.group(1))
        return None

    @staticmethod
    def _canonical_district_code(value: str) -> str:
        match = re.fullmatch(r"(\d{1,2})([A-Z]?)", value)
        if not match:
            return value
        return f"{int(match.group(1))}{match.group(2)}"

    def _infer_chamber(self, properties: dict, district_code: str | None) -> str | None:
        chamber_text = " ".join(
            str(properties.get(key, ""))
            for key in (
                "chamber",
                "district_type",
                "districtType",
                "office",
                "layer",
                "source",
            )
        ).lower()
        if "senate" in chamber_text:
            return "senate"
        if "house" in chamber_text or "state house" in chamber_text:
            return "house"
        memid = self._string_or_none(properties.get("memid"))
        if (
            district_code
            and re.fullmatch(r"\d{1,2}", district_code)
            and memid
            and memid.lower() != "none"
        ):
            return "senate"
        member_name = self._string_or_none(properties.get("name")) or ""
        lowered_name = member_name.lower()
        if district_code and re.fullmatch(r"\d{1,2}[A-Z]", district_code):
            return "house"
        if lowered_name.startswith("sen."):
            return "senate"
        if (
            lowered_name.startswith("rep.")
            and district_code
            and re.fullmatch(r"\d{1,2}[A-Z]", district_code)
        ):
            return "house"
        return None

    def _string_or_none(self, value) -> str | None:
        if value is None:
            return None
        text = str(value).strip()
        return text or None


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

    def lookup(self, address_text: str) -> RepresentativeLookupResult:
        try:
            matches = self.geocoder.geocode_matches(address_text)
        except RepresentativeLookupNotFound:
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
