"""Independent election-period street evidence for the November 3, 2026 ballot."""

from __future__ import annotations

from functools import lru_cache
import json
from pathlib import Path
import re
from zipfile import ZipFile

from alethical.pipeline.candidate_ballot import StreetAddress

INDEX = Path(__file__).resolve().parents[1] / "data" / "candidate_streets_20261103.zip"


@lru_cache(maxsize=1)
def _counties() -> dict[str, str]:
    with ZipFile(INDEX) as archive:
        return json.loads(archive.read("counties"))


def _name(value: str) -> str:
    return " ".join(value.upper().replace(".", "").split()).replace("SAINT ", "ST ")


@lru_cache(maxsize=32)
def _street_ranges(zip_code: str) -> dict[str, list]:
    # A public ZIP's source table is reusable. No visitor address is cached.
    from alethical.api.services.candidate_lookup import _normal

    with ZipFile(INDEX) as archive:
        try:
            raw = json.loads(archive.read(zip_code))
        except KeyError:
            return {}
    streets: dict[str, list] = {}
    for street, ranges in raw.items():
        streets.setdefault(_normal(street), []).extend(ranges)
    return streets


@lru_cache(maxsize=1)
def _facilities() -> dict[tuple, set[tuple[float, float]]]:
    from alethical.api.services.candidate_lookup import _city_words, _normal

    sites = {}
    with ZipFile(INDEX) as archive:
        for zipcode, number, street, city, lat, lon in json.loads(
            archive.read("civic")
        ):
            key = (zipcode, number, _normal(street), tuple(_city_words(city)))
            sites.setdefault(key, set()).add((lat, lon))
    return sites


@lru_cache(maxsize=1)
def civic_zip_codes() -> dict[tuple[str, ...], tuple[str, ...]]:
    """Each city's ZIPs from the packaged public facility list (538 city names).

    Only proposes which public ZIP street tables to read; it never places a
    voter. The list is incomplete, so a missing city means no proposal.
    """
    from alethical.api.services.candidate_lookup import _city_words

    zip_codes: dict[tuple[str, ...], set[str]] = {}
    with ZipFile(INDEX) as archive:
        for zipcode, _number, _street, city, _lat, _lon in json.loads(
            archive.read("civic")
        ):
            zip_codes.setdefault(tuple(_city_words(city)), set()).add(zipcode)
    return {city: tuple(sorted(codes)) for city, codes in zip_codes.items()}


def facility_points(address: StreetAddress) -> set[tuple[float, float]]:
    from alethical.api.services.candidate_lookup import _city_words, _normal

    if address.house_number_suffix or address.unit:
        return set()
    return _facilities().get(
        (
            address.zip_code,
            address.house_number,
            _normal(address.street),
            tuple(_city_words(address.city)),
        ),
        set(),
    )


def _matching_streets(address: StreetAddress) -> list:
    from alethical.api.services.candidate_lookup import _normal

    if address.house_number_suffix or not re.fullmatch(r"[0-9]{5}", address.zip_code):
        return []
    ranges = _street_ranges(address.zip_code).get(_normal(address.street), ())
    parity = "O" if address.house_number % 2 else "E"
    return [
        row
        for row in ranges
        if row[0] <= address.house_number <= row[1] and row[2] in ("B", parity)
    ]


def street_precinct(address: StreetAddress) -> str | None:
    """All matching Census ranges must place the address side in one precinct."""
    matches = {row[3] for row in _matching_streets(address)}
    if len(matches) == 1:
        return matches.pop() or None
    return None


def lancaster_central_precinct(address: StreetAddress) -> str | None:
    """MnDOT maps one continuous Central Avenue through Lancaster (November 2024).

    The official address still specifies north or south. Use the mapped street
    solely to establish a precinct if all numbered sides of *every* variant
    in the ZIP agree. An undirected street never establishes a building point.
    """
    from alethical.api.services.candidate_lookup import _normal

    if (
        address.house_number_suffix
        or address.zip_code != "56735"
        or _name(address.city) != "LANCASTER"
        or _normal(address.street) not in {"CENTRAL AVENUE N", "CENTRAL AVENUE S"}
    ):
        return None
    streets = _street_ranges(address.zip_code)
    base = "CENTRAL AVENUE"
    spellings = {base}
    for direction in ("N", "S", "E", "W", "NE", "NW", "SE", "SW"):
        spellings.update((f"{direction} {base}", f"{base} {direction}"))
    parity = "O" if address.house_number % 2 else "E"
    matches = {
        row[3]
        for street in spellings
        for row in streets.get(street, ())
        if row[0] <= address.house_number <= row[1] and row[2] in ("B", parity)
    }
    # Lancaster's own November precinct. Current SOS confirmation is also mandatory.
    return "350100" if matches == {"350100"} else None


def street_school(address: StreetAddress, geography) -> tuple[str, str] | None:
    """Every compatible segment or address side must confirm the same school."""
    key = geography.county_code + geography.precinct_code
    codes = {
        row[4] if len(row) == 5 and row[3] == key else ""
        for row in _matching_streets(address)
    }
    if (
        len(codes) == 1
        and (code := codes.pop())
        and (match := re.fullmatch(r"(ISD|SSD|CSD):([1-9][0-9]*)", code))
    ):
        return match[1], match[2]
    return None


def agrees_with_precinct(report: dict, geography) -> bool:
    county = _counties().get(geography.county_code)
    return bool(
        county
        and _name(str(report.get("CountyName") or "")) == _name(county)
        and report.get("PrecinctCode") == geography.precinct_code
        and all(
            _district(report.get(field)) == _district(value) and bool(_district(value))
            for field, value in (
                ("HouseDistrict", geography.congressional_district),
                ("SenateDistrict", geography.senate_district),
                ("LegDistrict", geography.house_district),
            )
        )
    )


def _district(value) -> str:
    return str(value or "").strip().upper().lstrip("0")


def report_matches_address(report: dict, address: StreetAddress) -> bool:
    from alethical.api.services.candidate_lookup import _city_words, _normal

    low, high = (
        str(report.get("HouseNumberLow", "")),
        str(report.get("HouseNumberHigh", "")),
    )
    if not (re.fullmatch(r"[0-9]{1,12}", low) and re.fullmatch(r"[0-9]{1,12}", high)):
        return False
    return (
        int(low) <= address.house_number <= int(high)
        and report.get("OddEvenInd") in ("B", "O" if address.house_number % 2 else "E")
        and report.get("ZipCode") == address.zip_code
        and _normal(str(report.get("FullStreetName") or "")) == _normal(address.street)
        and _city_words(str(report.get("CityName") or "")) == _city_words(address.city)
        and str(report.get("HouseNumberSuffix") or "").strip().upper()
        == address.house_number_suffix
        and not str(report.get("UnitNumberRange") or "").strip()
    )
