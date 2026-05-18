from __future__ import annotations

import os
import re
import argparse
import json
import logging
from dataclasses import asdict, dataclass

import requests

from alethical.logging import configure_logging

logger = logging.getLogger(__name__)


class RepresentativeLookupError(Exception):
    pass


class RepresentativeLookupNotFound(RepresentativeLookupError):
    pass


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


@dataclass(frozen=True)
class RepresentativeLookupResult:
    geocoded_address: GeocodedAddress
    house_district: DistrictMatch | None = None
    senate_district: DistrictMatch | None = None


class CensusGeocoder:
    def __init__(
        self,
        *,
        base_url: str | None = None,
        benchmark: str | None = None,
        timeout_seconds: float | None = None,
    ) -> None:
        self.base_url = (
            base_url
            or os.environ.get(
                "ALETHICAL_CENSUS_GEOCODER_URL",
                "https://geocoding.geo.census.gov/geocoder/locations/onelineaddress",
            )
        )
        self.benchmark = benchmark or os.environ.get("ALETHICAL_CENSUS_BENCHMARK", "Public_AR_Current")
        self.timeout_seconds = timeout_seconds or float(os.environ.get("ALETHICAL_HTTP_TIMEOUT_SECONDS", "10"))

    def geocode(self, address_text: str) -> GeocodedAddress:
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
        matches = payload.get("result", {}).get("addressMatches", [])
        if not matches:
            raise RepresentativeLookupNotFound("address could not be geocoded")

        match = matches[0]
        coordinates = match.get("coordinates") or {}
        address_components = match.get("addressComponents") or {}
        matched_address = match.get("matchedAddress")
        latitude = coordinates.get("y")
        longitude = coordinates.get("x")
        if matched_address is None or latitude is None or longitude is None:
            raise RepresentativeLookupUpstreamError("geocoder response missing coordinates")

        return GeocodedAddress(
            requested_address=address_text,
            matched_address=matched_address,
            latitude=float(latitude),
            longitude=float(longitude),
            state_code=address_components.get("state"),
        )


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
        self.timeout_seconds = timeout_seconds or float(os.environ.get("ALETHICAL_HTTP_TIMEOUT_SECONDS", "10"))

    def lookup(self, *, latitude: float, longitude: float) -> tuple[DistrictMatch | None, DistrictMatch | None]:
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
        for feature in features:
            properties = feature.get("properties") or {}
            district_code = self._extract_district_code(properties)
            chamber = self._infer_chamber(properties, district_code)
            if not district_code or chamber not in {"house", "senate"}:
                continue
            match = DistrictMatch(
                chamber=chamber,
                district_code=district_code,
                member_name=self._string_or_none(properties.get("name")),
                party=self._string_or_none(properties.get("party")),
            )
            if chamber == "house" and house_match is None:
                house_match = match
            if chamber == "senate" and senate_match is None:
                senate_match = match

        return house_match, senate_match

    def _extract_district_code(self, properties: dict) -> str | None:
        for key in ("district", "district_code", "districtCode", "code", "name"):
            value = properties.get(key)
            if not isinstance(value, str):
                continue
            cleaned = value.strip().upper()
            if re.fullmatch(r"\d{1,2}[A-Z]?", cleaned):
                return cleaned
            match = re.search(r"\b(\d{1,2}[A-Z]?)\b", cleaned)
            if match:
                return match.group(1)
        return None

    def _infer_chamber(self, properties: dict, district_code: str | None) -> str | None:
        chamber_text = " ".join(
            str(properties.get(key, ""))
            for key in ("chamber", "district_type", "districtType", "office", "layer", "source")
        ).lower()
        if "senate" in chamber_text:
            return "senate"
        if "house" in chamber_text or "state house" in chamber_text:
            return "house"
        if "congress" in chamber_text or "congressional" in chamber_text:
            return "congress"

        memid = self._string_or_none(properties.get("memid"))
        if district_code and re.fullmatch(r"\d{1,2}", district_code) and memid and memid.lower() != "none":
            return "senate"
        if district_code and re.fullmatch(r"\d{1,2}", district_code) and memid and memid.lower() == "none":
            return "congress"

        member_name = self._string_or_none(properties.get("name")) or ""
        lowered_name = member_name.lower()
        if district_code and re.fullmatch(r"\d{1,2}[A-Z]", district_code):
            return "house"
        if lowered_name.startswith("sen."):
            return "senate"
        if lowered_name.startswith("rep.") and district_code and re.fullmatch(r"\d{1,2}[A-Z]", district_code):
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
        gis_client: MinnesotaGisLookupClient | None = None,
    ) -> None:
        self.geocoder = geocoder or CensusGeocoder()
        self.gis_client = gis_client or MinnesotaGisLookupClient()

    def lookup(self, address_text: str) -> RepresentativeLookupResult:
        geocoded = self.geocoder.geocode(address_text)
        if geocoded.state_code and geocoded.state_code.upper() != "MN":
            raise RepresentativeLookupNotFound("address resolved outside Minnesota")

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
        house_match, senate_match = self.gis_client.lookup(
            latitude=geocoded.latitude,
            longitude=geocoded.longitude,
        )
        if house_match is None and senate_match is None:
            raise RepresentativeLookupNotFound("no Minnesota legislative districts found")

        return RepresentativeLookupResult(
            geocoded_address=geocoded,
            house_district=house_match,
            senate_district=senate_match,
        )


def get_representative_lookup_service() -> RepresentativeLookupService:
    return RepresentativeLookupService()


def result_to_dict(result: RepresentativeLookupResult) -> dict:
    return {
        "geocoded_address": asdict(result.geocoded_address),
        "house_district": asdict(result.house_district) if result.house_district else None,
        "senate_district": asdict(result.senate_district) if result.senate_district else None,
    }


def main(argv: list[str] | None = None) -> int:
    configure_logging()
    parser = argparse.ArgumentParser(description="Look up Minnesota legislative districts for an address.")
    parser.add_argument("address", help="Address to geocode, e.g. '75 Rev Dr Martin Luther King Jr Blvd, Saint Paul, MN'")
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
