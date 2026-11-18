"""Fresh official ballot lookups; only address-free candidate evidence is durable."""

from __future__ import annotations

import hashlib
import json
import re
import threading
import time
from collections import OrderedDict
from collections.abc import Callable
from concurrent.futures import ThreadPoolExecutor
from datetime import UTC, date, datetime, timedelta
from functools import lru_cache
from typing import Any
from zoneinfo import ZoneInfo

import requests
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.orm import Session

from alethical.api.services.address_format import normalize_address_format
from alethical.api.services.representative_lookup import (
    _ADDRESS_POINT_FIELDS,
    _STREET_TYPE_ALIASES,
    MINNESOTA_ADDRESS_POINTS_URL,
    AddressPointsIncomplete,
    MinnesotaAddressPointGeocoder,
    RepresentativeLookupNotFound,
    RepresentativeLookupOutsideMinnesota,
    RepresentativeLookupUpstreamError,
    public_source_session,
)
from alethical.api.services.zip_state_reference import SUPPORTED_STATES
from alethical.pipeline.candidate_ballot import (
    AUTHORITY,
    SOURCE_URL,
    BallotCatalogue,
    BallotRace,
    CandidateAddressNotFound,
    CandidateBallotError,
    CandidateUnitRangesNeeded,
    CandidateUnitRequired,
    StreetAddress,
    StreetRangeMatch,
    UnitNumberRange,
    ballot_jurisdiction,
    candidate_ballot_document,
    match_street_range,
    parse_candidate_ballot,
    parse_unit_ranges,
    validate_street_rows,
)

STREETS_URL = "https://myballotmn.sos.mn.gov/api/Streets/GetStreets"
# The official app reads a flagged range's unit list in 2 steps: the street's
# listing number, then that street's unit-number ranges (read 2026-10-09).
STREET_ID_URL = "https://myballotmn.sos.mn.gov/api/FilteredAddress/GetFilteredAddresses"
UNIT_RANGES_URL = (
    "https://myballotmn.sos.mn.gov/api/UnitNumberRangesData/GetUnitNumberRanges"
)


def _source_params(url: str) -> tuple[str, str] | None:
    # Read at call time, so a test's local stand-in for a URL is honoured.
    return {
        STREETS_URL: ("ZipCode", r"[0-9]{1,12}"),
        SOURCE_URL: ("prodAddressRangeId", r"[0-9]{1,12}"),
        # Street, city and ZIP from the official street table: never a house number.
        STREET_ID_URL: ("address", r"[A-Z0-9][A-Z0-9 .'&/-]{2,149}"),
        UNIT_RANGES_URL: ("FullStreetNameCityNameZipCodeId", r"[0-9]{1,12}"),
    }.get(url)


BALLOT_HOME = "https://myballotmn.sos.mn.gov/"
SUPPORTED_ELECTION = {
    "id": "8334",
    "label": "November 3, 2026 general election",
    "date": "2026-11-03",
    "type": "general",
}
PRIVATE_HEADERS = {"Cache-Control": "private, no-store", "Vary": "Origin"}
# Device-location suggestions. A browser's accuracy is a 95% radius in meters.
# Address points can sit up to about 30m from where a person stands in the
# building; neighbouring Minneapolis points are about 11m apart.
MINNESOTA_BOUNDS = (43.499, 49.385, -97.24, -89.48)
LOCATION_MAX_ACCURACY_METERS = 100
LOCATION_PLACEMENT_SLACK_METERS = 30
LOCATION_MIN_SEPARATION_METERS = 8


class CandidateLookupUnavailable(Exception):
    """Public safe error; no source URL, address or underlying exception text."""


class _AddressPointServiceOffline(CandidateLookupUnavailable):
    """An independent dated source can still establish the voting area."""


def official_bytes(url: str, params: dict[str, str | int]) -> bytes:
    """The fixed source allowlist cannot be changed by a submitted address."""
    allowlisted = _source_params(url)
    if allowlisted is None:
        raise CandidateLookupUnavailable("Unsupported candidate source")
    expected, allowed = allowlisted
    if set(params) != {expected} or not re.fullmatch(allowed, str(params[expected])):
        raise CandidateLookupUnavailable("Unsupported candidate source request")
    # Do not follow a redirect to an unrelated host, or include source exceptions
    # (which can contain the request parameters) in operational reports.
    try:
        started = time.monotonic()
        with public_source_session().get(
            url,
            params=params,
            timeout=(3.05, 12),
            allow_redirects=False,
            stream=True,
            # This official service double-encodes its JSON into a JSON string
            # for application/json, but sends the actual object as text/plain.
            headers={"Accept": "text/plain"},
        ) as response:
            if url == UNIT_RANGES_URL and response.status_code == 404:
                # The source's own answer for a street with no unit list.
                try:
                    payload = json.loads(response.raw.read(1000, decode_content=True))
                except Exception:
                    # A broken or slow error body is a failure, never "no list".
                    payload = None
                if payload == {"message": "Unit number data not found."}:
                    return b"[]"
            if response.status_code != 200:
                raise CandidateLookupUnavailable("Official ballot service unavailable")
            body = bytearray()
            for chunk in response.iter_content(65536):
                body.extend(chunk)
                if len(body) > 20_000_000 or time.monotonic() - started > 20:
                    raise CandidateLookupUnavailable(
                        "Official ballot response too large"
                    )
            return bytes(body)
    except requests.RequestException:
        raise CandidateLookupUnavailable(
            "Official ballot service unavailable"
        ) from None


_ALIASES = {
    "NORTH": "N",
    "SOUTH": "S",
    "EAST": "E",
    "WEST": "W",
    "NORTHEAST": "NE",
    "NORTHWEST": "NW",
    "SOUTHEAST": "SE",
    "SOUTHWEST": "SW",
    "STREET": "ST",
    "AVENUE": "AVE",
    "ROAD": "RD",
    "DRIVE": "DR",
    "BOULEVARD": "BLVD",
    "LANE": "LN",
    "COURT": "CT",
    "PLACE": "PL",
    "PARKWAY": "PKWY",
    "TRAIL": "TRL",
    "CIRCLE": "CIR",
    "HIGHWAY": "HWY",
}


def _normal(value: str) -> str:
    # Both spellings of a street type compare equal ("TER" and "TERRACE"), on both
    # sides of every comparison, so the state's address points and the election
    # source's abbreviations name the same street.
    return " ".join(
        _STREET_TYPE_ALIASES.get(word, word)
        for word in (
            _ALIASES.get(word, word) for word in value.upper().replace(".", "").split()
        )
    )


_DIRECTIONS = {"N", "S", "E", "W", "NE", "NW", "SE", "SW"}


def _city_words(value: str) -> list[str]:
    return [
        "ST" if word in {"ST", "SAINT"} else word
        for word in value.upper().replace(".", "").replace("-", " ").split()
    ]


@lru_cache(maxsize=256)
def _city_ending(city: str) -> re.Pattern:
    words = [
        r"(?:ST\.?|SAINT)" if word == "ST" else re.escape(word)
        for word in _city_words(city)
    ]
    return re.compile(r"(?:,?\s+)" + r"[-\s]+".join(words) + "$")


def _moved_direction(street: str) -> str | None:
    # The same compass point may appear on either end in different records.
    # Require the reader to choose the other spelling before using it.
    words = street.split()
    if len(words) < 3 or (words[0] in _DIRECTIONS) == (words[-1] in _DIRECTIONS):
        return None
    if words[0] in _DIRECTIONS:
        return " ".join([*words[1:], words[0]])
    return " ".join([words[-1], *words[:-1]])


_ORDINALS = dict(
    zip(
        "FIRST SECOND THIRD FOURTH FIFTH SIXTH SEVENTH EIGHTH NINTH TENTH".split(),
        "1ST 2ND 3RD 4TH 5TH 6TH 7TH 8TH 9TH 10TH".split(),
        strict=True,
    )
)
_STREET_TYPES = frozenset(_STREET_TYPE_ALIASES.values())


@lru_cache(maxsize=4096)
def _official_spellings(street: str) -> frozenset[str]:
    """Comparable spellings; callers offer the complete official street for confirmation."""
    words = [_ORDINALS.get(word, word) for word in street.split()]
    spellings = {" ".join(words)}
    if moved := _moved_direction(" ".join(words)):
        spellings.add(moved)
    # Preserve the base name and any supplied compass point.
    for spelling in tuple(spellings):
        parts = spelling.split()
        if len(parts) < 2:
            continue
        for i in (0, len(parts) - 1):
            if parts[i] in _DIRECTIONS:
                spellings.add(" ".join(parts[:i] + parts[i + 1 :]))
        type_pos = len(parts) - (2 if parts[-1] in _DIRECTIONS else 1)
        if type_pos > 0 and parts[type_pos] in _STREET_TYPES:
            spellings.add(" ".join(parts[:type_pos] + parts[type_pos + 1 :]))
    return frozenset(spellings)


def _spelling_choice(supplied: str, expected: str) -> bool:
    normalized = " ".join(_ORDINALS.get(word, word) for word in supplied.split())
    return normalized in _official_spellings(expected)


def _choice(address: str) -> dict:
    return {
        "id": hashlib.sha256(address.encode()).hexdigest(),
        "label": address,
        "address": address,
    }


_UNIT_PATTERN = re.compile(
    r"(?:\b(?:APT|APARTMENT|UNIT|SUITE|STE)(?:\.\s*|\s+)|#\s*)[A-Z0-9-]+\b",
    re.IGNORECASE,
)


def _geocoded_choice(original: str, matched: str) -> dict | None:
    # The address-point source drops apartment/unit information. Carry every
    # supplied unit label into the choice, then let official ranges resolve it.
    # Never turn a unit-specific request into the building's general range.
    units = list(_UNIT_PATTERN.finditer(original))
    if len(units) > 1:
        return None
    if units:
        unit = units[0].group().upper()
        matched_units = list(_UNIT_PATTERN.finditer(matched))
        if matched_units:
            if len(matched_units) != 1 or _normal(matched_units[0].group()) != _normal(
                unit
            ):
                return None
        else:
            street, separator, locality = matched.partition(",")
            if not separator:
                return None
            matched = f"{street.strip()} {unit}, {locality.strip()}"
    return _choice(matched)


def _address_label(address: StreetAddress) -> str:
    unit = f" {address.unit}" if address.unit else ""
    suffix = address.house_number_suffix
    if suffix == "1/2":
        suffix = f" {suffix}"
    return f"{address.house_number}{suffix} {address.street}{unit}, {address.city}, MN {address.zip_code}"


_AFTER_ELECTION_MS = int(
    datetime(2026, 11, 4, tzinfo=ZoneInfo("America/Chicago")).timestamp() * 1000
)


def historical_address_points(
    address: StreetAddress,
    alternate_street: str | None = None,
) -> set[tuple[float, float]] | None:
    """Locate the building only. Election-day maps decide the voting districts."""
    # These values came from an exact SOS range. Check them again before
    # forming a government GIS filter, which never contains the street or unit.
    if type(address.house_number) is not int or not re.fullmatch(
        r"[0-9]{5}", address.zip_code
    ):
        return set()
    try:
        response = public_source_session().post(
            MINNESOTA_ADDRESS_POINTS_URL,
            data={
                "where": f"anumber = {address.house_number} AND zip = '{address.zip_code}'",
                "outFields": ",".join((*_ADDRESS_POINT_FIELDS, "ret_date", "eff_date")),
                "returnGeometry": "true",
                "outSR": "4326",
                "resultRecordCount": "2000",
                "f": "json",
            },
            timeout=(3.05, 8),
            allow_redirects=False,
        )
        if response.status_code != 200:
            raise _AddressPointServiceOffline("Minnesota address points unavailable")
    except requests.RequestException:
        raise _AddressPointServiceOffline(
            "Minnesota address points unavailable"
        ) from None
    try:
        payload = response.json()
    except ValueError:
        raise CandidateLookupUnavailable("Invalid Minnesota address points") from None
    if (
        not isinstance(payload, dict)
        or payload.get("error")
        or not isinstance(payload.get("features"), list)
    ):
        raise CandidateLookupUnavailable("Invalid Minnesota address points")
    if payload.get("exceededTransferLimit"):
        return None
    expected_city = _city_words(address.city)
    expected_streets = {_normal(address.street)}
    if alternate_street:
        expected_streets.add(_normal(alternate_street))
    points = set()
    excluded = False
    uncertain_points = set()
    for feature in payload["features"]:
        attrs = feature.get("attributes") if isinstance(feature, dict) else None
        if not isinstance(attrs, dict):
            raise CandidateLookupUnavailable("Invalid Minnesota address point")
        if (
            str(attrs.get("state_code") or "MN").strip().upper() != "MN"
            or str(attrs.get("zip") or "").strip() != address.zip_code
            or str(attrs.get("anumber") or "").strip() != str(address.house_number)
            or str(attrs.get("anumbersuf") or "").replace(" ", "").upper()
            != address.house_number_suffix
            or str(attrs.get("anumberpre") or "").strip()
        ):
            continue
        if not any(
            _city_words(str(attrs.get(field) or "")) == expected_city
            for field in ("postcomm", "ctu_name")
        ):
            continue
        street = " ".join(
            str(attrs.get(field) or "").strip()
            for field in (
                "st_pre_mod",
                "st_pre_dir",
                "st_pre_typ",
                "st_pre_sep",
                "st_name",
                "st_pos_typ",
                "st_pos_dir",
                "st_pos_mod",
            )
        )
        if _normal(street) not in expected_streets:
            continue
        # Some counties omit status. Evaluate dated retirements on election day,
        # even when today's label says retired. January 1900 is a source placeholder.
        status = str(attrs.get("status") or "").strip().upper()
        retired = attrs.get("ret_date")
        effective = attrs.get("eff_date")
        if effective is not None and type(effective) not in (int, float):
            return None
        if retired is not None and type(retired) not in (int, float):
            return None
        dated_retirement = retired not in (None, 0, -2208988800000)
        if (effective is not None and effective >= _AFTER_ELECTION_MS) or (
            dated_retirement and retired < _AFTER_ELECTION_MS
        ):
            excluded = True
            continue
        dated_active = dated_retirement and effective is not None and effective > 0
        uncertain = status not in {"", "ACTIVE", "CURRENT"} and not (
            status in {"INACTIVE", "RETIRED"} and dated_active
        )
        spatial = feature.get("geometry")
        reference = payload.get("spatialReference") or {}
        positions = []
        if (
            isinstance(reference, dict)
            and isinstance(spatial, dict)
            and reference.get("wkid") == 4326
        ):
            positions.append((spatial.get("y"), spatial.get("x")))
        lat_value, lon_value = attrs.get("latitude"), attrs.get("longitude")
        if lat_value is not None or lon_value is not None:
            positions.append((lat_value, lon_value))
        if not positions:
            return None
        for lat, lon in positions:
            try:
                lat, lon = float(lat), float(lon)
            except (ValueError, TypeError):
                return None
            if not (43 <= lat <= 50 and -98 <= lon <= -89):
                return None
            (uncertain_points if uncertain else points).add((lat, lon))
    if (uncertain_points - points) or (not points and excluded):
        return None
    return points


def _street_json_object(pairs: list[tuple[str, object]]) -> dict:
    result = {}
    for key, value in pairs:
        if key in result:
            raise ValueError("Duplicate street source field")
        result[key] = value
    return result


def _parse_with_rows(
    text: str,
    rows: list[dict],
    *,
    prefix: bool = False,
    alternate_spelling: bool = False,
) -> list[StreetAddress]:
    """Match all supplied words against source streets, not coordinates or incumbents.

    A unit normally ends the street segment. When the canonical reading finds
    nothing, 1 unit elsewhere in the street or locality (after a comma, or after
    the city) is read as that unit. 2 different units are never reconciled.
    """
    matches = _parse_rows_once(
        text, rows, prefix=prefix, alternate_spelling=alternate_spelling
    )
    if matches:
        return matches
    upper = normalize_address_format(text).upper()
    units = list(_UNIT_PATTERN.finditer(upper))
    if len(units) != 1:
        return matches
    unit = units[0]
    without = upper[: unit.start()] + upper[unit.end() :]
    # Drop the empty segment the unit leaves behind ("street, , city").
    without = ", ".join(
        part
        for part in (" ".join(piece.split()) for piece in without.split(","))
        if part
    )
    unit_text = _unit_spelling(unit.group())
    street, separator, locality = without.partition(",")
    if separator:
        matches = _parse_rows_once(
            f"{street.strip()} {unit_text},{locality}",
            rows,
            prefix=prefix,
            alternate_spelling=alternate_spelling,
        )
        if matches:
            return matches
    # Comma-free text, or a unit placed after the city: each source row's own
    # city marks where the street ends.
    return _parse_rows_once(
        without,
        rows,
        prefix=prefix,
        alternate_spelling=alternate_spelling,
        unit=unit_text,
    )


# "Apt.250" is the same supported spelling as "Apt 250" and "Apt. 250".
_UNIT_START = re.compile(r"(?:APT|APARTMENT|UNIT|SUITE|STE)(?:\.|\s)|#")


def _unit_spelling(unit: str) -> str:
    """Print a label's dot as a space: "APT.250" and "APT. 250" become "APT 250"."""
    return re.sub(r"^([A-Z]+)\.\s*", r"\1 ", " ".join(unit.upper().split()))


def _trailing_unit_start(text: str) -> int | None:
    """Where a unit begins in the last comma segment, after whitespace, or None.

    A linear scan: the first unit label after whitespace in that segment that is
    followed by more text, so "APT 2 APT 3" stays 1 unit for the matcher to refuse.
    """
    tail = text.rfind(",") + 1
    for found in _UNIT_START.finditer(text, tail):
        start = found.start()
        if start > tail and text[start - 1].isspace() and text[found.end() :].strip():
            return start
    return None


def _parse_rows_once(
    text: str,
    rows: list[dict],
    *,
    prefix: bool = False,
    alternate_spelling: bool = False,
    unit: str = "",
) -> list[StreetAddress]:
    supplied_unit = " ".join(unit.upper().split())
    text = normalize_address_format(text).upper()
    found = re.fullmatch(
        r"(\d{1,8})(?:\s+(1/2)|([A-Z]))?\s+(.+?)\s+(\d{5})(?:-\d{4})?", text
    )
    if not found:
        return []
    number, fraction, suffix, remainder, zip_code = found.groups()
    remainder = remainder.strip(" ,")
    state = re.search(r"(?:,?\s+)([A-Z]{2}|MINNESOTA)$", remainder)
    if state and state.group(1) in SUPPORTED_STATES | {"MINNESOTA"}:
        if state.group(1) not in ("MN", "MINNESOTA"):
            return []
        remainder = remainder[: state.start()].strip(" ,")
    matches: dict[tuple, StreetAddress] = {}
    city_spellings: dict[tuple, str] = {}
    for row in rows:
        street, city = row.get("FullStreetName"), row.get("CityName")
        if not isinstance(street, str) or not isinstance(city, str):
            raise CandidateLookupUnavailable("Official street records unavailable")
        if row.get("StateCode") != "MN" or row.get("ZipCode") != zip_code:
            continue
        requested = remainder
        # Postal city belongs to the address match, never to a municipal race.
        city_match = _city_ending(city).search(requested)
        if city_match:
            requested = requested[: city_match.start()].strip(" ,")
        elif "," in requested:
            continue
        unit = supplied_unit
        unit_start = _trailing_unit_start(requested)
        if unit_start is not None:
            if supplied_unit:
                continue
            unit = _unit_spelling(requested[unit_start:].strip())
            # "Street, Apt 3, City" leaves the separating comma behind.
            requested = requested[:unit_start].strip(" ,")
        expected, supplied = _normal(street), _normal(requested)
        if alternate_spelling:
            if not _spelling_choice(supplied, expected):
                continue
        elif not (expected.startswith(supplied) if prefix else expected == supplied):
            continue
        address = StreetAddress(
            street.strip(),
            city.strip(),
            "MN",
            zip_code,
            int(number),
            fraction or suffix or "",
            unit,
        )
        try:
            # An individual row is only a suggestion. Full resolution below
            # still checks every row and rejects overlapping ranges.
            match_street_range([row], address)
        except (CandidateUnitRangesNeeded, CandidateUnitRequired):
            # The house is in a unit-specific range: the street spelling still
            # matches. Its unit list is read only when this address is searched.
            pass
        except CandidateAddressNotFound:
            continue
        except CandidateBallotError:
            raise CandidateLookupUnavailable(
                "Official street records unavailable"
            ) from None
        key = (
            address.street,
            address.city,
            address.zip_code,
            address.house_number,
            address.house_number_suffix,
            address.unit,
        )
        city_key = (
            _normal(address.street),
            tuple(_city_words(address.city)),
            *key[2:],
        )
        if city_key in city_spellings and city_spellings[city_key] != address.city:
            # Equivalent city spellings must not turn overlapping official
            # records into choices a confirmation can use to select a range.
            return []
        city_spellings[city_key] = address.city
        matches[key] = address
    return list(matches.values())


# A shared street-table fetch is bounded by official_bytes (about 23 seconds).
STREET_FETCH_WAIT_SECONDS = 30


class _StreetFetch:
    """1 in-flight public street-table fetch that simultaneous requests share."""

    def __init__(self) -> None:
        self.done = threading.Event()
        self.rows: list[dict] | None = None


class CandidateLookupService:
    def __init__(
        self,
        *,
        fetch: Callable = official_bytes,
        clock: Callable = time.monotonic,
        now: Callable = lambda: datetime.now(UTC),
        geocoder=None,
    ):
        self.fetch = fetch
        self.clock = clock
        self.now = now
        self.geocoder = geocoder or MinnesotaAddressPointGeocoder(
            base_url=MINNESOTA_ADDRESS_POINTS_URL, timeout_seconds=8
        )
        self._streets: OrderedDict[str, tuple[float, list[dict], int]] = OrderedDict()
        self._street_bytes = 0
        # 1 fetch per ZIP at a time: simultaneous misses wait for the same answer.
        self._street_fetches: dict[str, _StreetFetch] = {}
        self._lock = threading.Lock()

    def elections(self) -> list[dict]:
        from alethical.api.services.person_records import supported_elections

        elections = supported_elections()
        today = self.now().astimezone(ZoneInfo("America/Chicago")).date()
        for election in elections:
            if election["canonicalKey"] == "mn-2026-11-03-general" and today > date(
                2026, 11, 3
            ):
                election["capabilities"].update(
                    addressLookup="historical-ballot", historicalRecords=True
                )
        return elections

    def streets(self, zip_code: str) -> list[dict]:
        if not re.fullmatch(r"\d{5}", zip_code):
            return []
        with self._lock:
            cached = self._streets.get(zip_code)
            if cached and cached[0] > self.clock():
                self._streets.move_to_end(zip_code)
                return cached[1]
            pending = self._street_fetches.get(zip_code)
            leader = pending is None
            if pending is None:
                pending = self._street_fetches[zip_code] = _StreetFetch()
        if not leader:
            # The leading request's own source deadline bounds this wait.
            if not pending.done.wait(STREET_FETCH_WAIT_SECONDS) or pending.rows is None:
                raise CandidateLookupUnavailable("Official street records unavailable")
            return pending.rows
        try:
            rows, size = self._fetch_streets(zip_code)
            with self._lock:
                previous = self._streets.pop(zip_code, None)
                if previous:
                    self._street_bytes -= previous[2]
                self._streets[zip_code] = (self.clock() + 300, rows, size)
                self._street_bytes += size
                self._streets.move_to_end(zip_code)
                while len(self._streets) > 32 or self._street_bytes > 8_000_000:
                    _, dropped = self._streets.popitem(last=False)
                    self._street_bytes -= dropped[2]
            pending.rows = rows
            return rows
        finally:
            with self._lock:
                self._street_fetches.pop(zip_code, None)
            pending.done.set()

    def _fetch_streets(self, zip_code: str) -> tuple[list[dict], int]:
        try:
            body = self.fetch(STREETS_URL, {"ZipCode": zip_code})
            if len(body) > 4_000_000:
                raise ValueError
            payload = json.loads(body, object_pairs_hook=_street_json_object)
            if not isinstance(payload, dict) or any(
                key.lower() in ("error", "errors") for key in payload
            ):
                raise ValueError
            rows = payload["Streets"]
            if (
                not isinstance(rows, list)
                or len(rows) > 100_000
                or not all(isinstance(row, dict) for row in rows)
            ):
                raise ValueError
            validate_street_rows(rows)
        except (KeyError, ValueError, TypeError):
            raise CandidateLookupUnavailable(
                "Official street records unavailable"
            ) from None
        return rows, len(body)

    def _eligible_choices(self, choices: list[dict]) -> list[dict]:
        """Offer only complete addresses supported by one official ballot range.

        Map address points include locations the election source cannot resolve.
        Load each ZIP once, concurrently when necessary, using the existing bounded
        public street-table cache. Never fetch ballots or save personal queries here.
        """
        choices_with_zip = [
            (choice, match.group(1))
            for choice in choices[:5]
            if (match := re.search(r"\b(\d{5})(?:-\d{4})?$", choice["address"]))
        ]
        zip_codes = list(dict.fromkeys(zip_code for _, zip_code in choices_with_zip))
        if not zip_codes:
            return []
        if len(zip_codes) == 1:
            tables = {zip_codes[0]: self.streets(zip_codes[0])}
        else:
            with ThreadPoolExecutor(max_workers=len(zip_codes)) as executor:
                tables = dict(zip(zip_codes, executor.map(self.streets, zip_codes)))
        eligible = []
        for choice, zip_code in choices_with_zip:
            rows = tables[zip_code]
            matches = _parse_with_rows(choice["address"], rows)
            if not matches:
                matches = _parse_with_rows(
                    choice["address"], rows, alternate_spelling=True
                )
                if len(matches) == 1:
                    choice = _choice(_address_label(matches[0]))
            if len(matches) != 1:
                continue
            try:
                match_street_range(rows, matches[0])
            except CandidateUnitRangesNeeded:
                pass
            except CandidateAddressNotFound:
                continue
            except CandidateBallotError:
                raise CandidateLookupUnavailable(
                    "Official street records unavailable"
                ) from None
            if choice not in eligible:
                eligible.append(choice)
        return eligible

    def suggest(self, text: str) -> list[dict]:
        text = normalize_address_format(text)
        zip_match = re.search(r"\b(\d{5})(?:-\d{4})?$", text.strip())
        if zip_match:
            rows = self.streets(zip_match.group(1))
            addresses = _parse_with_rows(text, rows, prefix=True)
            if not addresses:
                addresses = _parse_with_rows(text, rows, alternate_spelling=True)
            return self._eligible_choices(
                [_choice(_address_label(address)) for address in addresses[:5]]
            )
        try:
            matches = self.geocoder.suggest_matches(text)
        except (requests.RequestException, RepresentativeLookupUpstreamError):
            raise CandidateLookupUnavailable(
                "Government address service unavailable"
            ) from None
        return self._eligible_choices(
            [
                choice
                for match in matches[:5]
                if match.state_code in (None, "MN")
                if (choice := _geocoded_choice(text, match.matched_address)) is not None
            ]
        )

    def locate(self, latitude: float, longitude: float, accuracy: float) -> dict:
        """Suggest 1 home address for the reader to confirm; never search with it.

        A device reading is a point plus a 95% accuracy radius. The suggestion is
        offered only when that reading separates the nearest building from every
        other address; otherwise the reader types the address. Nothing is stored.
        """
        if not (
            MINNESOTA_BOUNDS[0] <= latitude <= MINNESOTA_BOUNDS[1]
            and MINNESOTA_BOUNDS[2] <= longitude <= MINNESOTA_BOUNDS[3]
        ):
            return {"kind": "outside-minnesota"}
        if accuracy > LOCATION_MAX_ACCURACY_METERS:
            return {"kind": "imprecise"}
        reach = accuracy + LOCATION_PLACEMENT_SLACK_METERS
        separation = max(accuracy, LOCATION_MIN_SEPARATION_METERS)
        try:
            # Look far enough past the nearest possible building to see every
            # neighbour that the separation rule must rule out.
            nearby = self.geocoder.nearby_addresses(
                latitude, longitude, reach + separation
            )
        except AddressPointsIncomplete:
            return {"kind": "imprecise"}
        except Exception:
            # Upstream text can include the submitted point. Report nothing of it.
            raise CandidateLookupUnavailable(
                "Government address service unavailable"
            ) from None
        if not nearby or nearby[0][1] > reach or nearby[0][0] is None:
            # No building close enough, or the nearest point has no usable address.
            return {"kind": "imprecise"}
        if len(nearby) > 1 and nearby[1][1] - nearby[0][1] < separation:
            return {"kind": "imprecise"}
        return {"kind": "address", "address": self._official_spelling(nearby[0][0])}

    def _official_spelling(self, label: str) -> str:
        """Print the election source's spelling when exactly 1 of its streets matches.

        Anything else keeps the state's address-point wording; the reader's
        confirmed search still decides the match.
        """
        zip_code = re.search(r"\b(\d{5})$", label)
        if not zip_code:
            return label
        try:
            rows = self.streets(zip_code.group(1))
            matches = _parse_with_rows(label, rows)
            if not matches:
                # Postal community names can differ from the source's city name.
                street = label.partition(",")[0]
                matches = _parse_with_rows(f"{street} MN {zip_code.group(1)}", rows)
        except CandidateLookupUnavailable:
            return label
        return _address_label(matches[0]) if len(matches) == 1 else label

    def unit_ranges(self, address: StreetAddress) -> tuple[UnitNumberRange, ...]:
        """Read 1 street's official unit-number ranges, as MyBallot itself does.

        Only the official street, city and ZIP leave Alethical, never the house
        number or unit, and nothing is cached. A source failure is unavailable.
        """
        try:
            listings = json.loads(
                self.fetch(
                    STREET_ID_URL,
                    {"address": f"{address.street} {address.city} {address.zip_code}"},
                ),
                object_pairs_hook=_street_json_object,
            )
            if not isinstance(listings, list) or len(listings) > 1000:
                raise ValueError
            ids = {
                listing.get("FullStreetNameCityNameZipCodeId")
                for listing in listings
                if isinstance(listing, dict)
                and isinstance(listing.get("FullStreetName"), str)
                and isinstance(listing.get("CityName"), str)
                and " ".join(listing["FullStreetName"].upper().split())
                == " ".join(address.street.upper().split())
                and " ".join(listing["CityName"].upper().split())
                == " ".join(address.city.upper().split())
                and listing.get("ZipCode") == address.zip_code
            }
            if len(ids) != 1:
                raise ValueError
            street_id = ids.pop()
            if type(street_id) is not int or street_id <= 0:
                raise ValueError
            return parse_unit_ranges(
                json.loads(
                    self.fetch(
                        UNIT_RANGES_URL, {"FullStreetNameCityNameZipCodeId": street_id}
                    ),
                    object_pairs_hook=_street_json_object,
                )
            )
        except (ValueError, TypeError, CandidateBallotError):
            raise CandidateLookupUnavailable(
                "Official unit records unavailable"
            ) from None

    def resolve(
        self, text: str, confirmed: dict | None = None
    ) -> tuple[StreetAddress, StreetRangeMatch] | dict:
        text = normalize_address_format(text)
        # Confirmation never acts as an arbitrary range selector or replacement
        # address. Recompute choices from the submitted original address first.
        zip_match = re.search(r"\b(\d{5})(?:-\d{4})?$", text.strip())
        if not zip_match:
            try:
                matches = self.geocoder.geocode_matches(text)
            except RepresentativeLookupOutsideMinnesota:
                return {"kind": "outside-minnesota"}
            except RepresentativeLookupNotFound:
                return {"kind": "no-match"}
            except (requests.RequestException, RepresentativeLookupUpstreamError):
                raise CandidateLookupUnavailable(
                    "Government address service unavailable"
                ) from None
            choices = [
                choice
                for match in matches[:5]
                if match.state_code in (None, "MN")
                if (choice := _geocoded_choice(text, match.matched_address)) is not None
            ]
            if confirmed is not None:
                if confirmed not in choices:
                    same_zip = [
                        choice
                        for choice in choices
                        if choice["address"][-5:] == confirmed["address"][-5:]
                    ]
                    if confirmed not in self._eligible_choices(same_zip):
                        return {"kind": "no-match"}
                # Resolve only the chosen address. A source failure for an
                # unrelated alternative must not block a valid confirmation.
                text = confirmed["address"]
                confirmed = None
            else:
                choices = self._eligible_choices(choices)
                # Even one geocoded answer may correct the street or locality.
                # The reader must explicitly choose that complete address.
                return (
                    {"kind": "ambiguous", "choices": choices}
                    if choices
                    else {"kind": "no-match"}
                )
            zip_match = re.search(r"\b(\d{5})(?:-\d{4})?$", text.strip())
        if not zip_match:
            return {"kind": "no-match"}
        state_match = re.search(
            r"(?:,?\s+)([A-Z]{2})[, ]+\d{5}(?:-\d{4})?$", text.upper()
        )
        if state_match and state_match.group(1) in SUPPORTED_STATES - {"MN"}:
            return {"kind": "outside-minnesota"}
        rows = self.streets(zip_match.group(1))
        matches = _parse_with_rows(text, rows)
        if not matches:
            alternatives = _parse_with_rows(text, rows, alternate_spelling=True)
            if alternatives:
                choices = self._eligible_choices(
                    [_choice(_address_label(a)) for a in alternatives]
                )
                if confirmed is None and choices:
                    return {"kind": "ambiguous", "choices": choices}
                if confirmed in choices:
                    matches = alternatives
        choices = [_choice(_address_label(address)) for address in matches]
        if confirmed is not None and confirmed not in choices:
            # For no-ZIP geocoding the original confirmed string may have been
            # standardized. It must nevertheless resolve to exactly 1 official
            # address, including the same unit, through the same exact parser.
            confirmed_matches = _parse_with_rows(confirmed["address"], rows)
            if (
                len(matches) != 1
                or confirmed != _choice(confirmed["address"])
                or len(confirmed_matches) != 1
                or _address_label(confirmed_matches[0]) != choices[0]["address"]
            ):
                return {"kind": "no-match"}
            # The complete choice and input identify the same sole official
            # address. Carry that canonical choice into the exact filter.
            confirmed = choices[0]
        if len(matches) > 1 and confirmed is None:
            eligible = self._eligible_choices(choices)
            return (
                {"kind": "ambiguous", "choices": eligible}
                if eligible
                else {"kind": "no-match"}
            )
        if confirmed is not None:
            matches = [
                address
                for address in matches
                if _choice(_address_label(address)) == confirmed
            ]
        if len(matches) != 1:
            return {"kind": "no-match"}
        try:
            try:
                found = match_street_range(rows, matches[0])
            except CandidateUnitRangesNeeded:
                found = match_street_range(
                    rows, matches[0], self.unit_ranges(matches[0])
                )
        except CandidateAddressNotFound:
            return {"kind": "no-match"}
        except CandidateBallotError:
            raise CandidateLookupUnavailable(
                "Official street records unavailable"
            ) from None
        return matches[0], found

    def _confirmed_spelling(
        self, text: str, address: StreetAddress, found: StreetRangeMatch
    ):
        rows = self.streets(address.zip_code)
        if _parse_with_rows(text, rows) or _parse_with_rows(
            text, rows, alternate_spelling=True
        ) != [address]:
            return None
        # Only the precise wording actually entered can supply a second building
        # point. A reader choosing between multiple possible streets uses only
        # the selected street's location. The SOS precinct must still agree.
        spelling_rows = [
            dict(row, FullStreetName=spelling)
            for row in rows
            if row["ProdAddressRangeId"] == found.range_id
            for spelling in _official_spellings(_normal(address.street))
        ]
        aliases = _parse_with_rows(text, spelling_rows)
        return aliases[0] if len(aliases) == 1 else None

    def _historical_match(
        self,
        address: StreetAddress,
        found: StreetRangeMatch,
        alternate: StreetAddress | None = None,
    ):
        from alethical.api.services.candidate_historical_county_addresses import (
            county_address_points,
        )
        from alethical.api.services.candidate_historical_geography import (
            corroborated_school,
            historical_geography,
            historical_precinct,
        )
        from alethical.api.services.candidate_historical_streets import (
            agrees_with_precinct,
            facility_points,
            lancaster_central_precinct,
            report_matches_address,
            street_precinct,
            street_school,
        )

        offline = False
        try:
            points = (
                historical_address_points(address, alternate.street)
                if alternate
                else historical_address_points(address)
            )
        except _AddressPointServiceOffline:
            offline = True
            points = set()
        if points is None:
            return None
        needs_range_confirmation = not points or alternate is not None
        points = points | facility_points(address) | county_address_points(address)
        if alternate:
            points |= facility_points(alternate) | county_address_points(alternate)
        if points:
            geography = historical_geography(points)
        else:
            key = street_precinct(address) or lancaster_central_precinct(address)
            geography = historical_precinct(key[:2], key[2:]) if key else None
        if geography is None:
            if offline:
                raise CandidateLookupUnavailable("Minnesota address points unavailable")
            return None
        if needs_range_confirmation or not (
            geography.school_type and geography.school_district
        ):
            try:
                report_body = self.fetch(
                    SOURCE_URL, {"prodAddressRangeId": found.range_id}
                )
                payload = json.loads(report_body, object_pairs_hook=_street_json_object)
                report = (
                    payload.get("PollingResult") if isinstance(payload, dict) else None
                )
            except (CandidateLookupUnavailable, ValueError, UnicodeDecodeError):
                if needs_range_confirmation:
                    raise CandidateLookupUnavailable(
                        "Official street confirmation unavailable"
                    ) from None
                report = None
            if (
                isinstance(report, dict)
                and report_matches_address(report, address)
                and agrees_with_precinct(report, geography)
            ):
                geography = corroborated_school(
                    geography,
                    points,
                    school_name=str(report.get("SchoolName") or ""),
                    school_district=str(report.get("SchoolDistrict") or ""),
                    street_school=street_school(address, geography)
                    if not points
                    else None,
                )
            elif needs_range_confirmation:
                return None
        return geography

    def lookup(
        self,
        text: str,
        election_id: str,
        confirmed: dict | None = None,
        *,
        db: Session | None = None,
    ) -> tuple[dict, BallotCatalogue | None]:
        election = next(
            (item for item in self.elections() if item["id"] == election_id), None
        )
        if election is None:
            return {"kind": "no-elections"}, None
        unavailable = {
            "kind": "historical-match-unavailable",
            "electionId": election_id,
            "message": "We couldn’t confirm the races for this address and election",
            "officialResultsUrl": election["officialResultsUrl"],
        }
        lookup_kind = election["capabilities"]["addressLookup"]
        if lookup_kind == "unavailable":
            return unavailable, None
        resolved = self.resolve(text, confirmed)
        if isinstance(resolved, dict):
            return resolved, None
        address, found = resolved
        if lookup_kind == "historical-ballot":
            from alethical.api.services.candidate_historical_races import (
                historical_candidate_results,
            )

            if found.unit_specific or db is None:
                return unavailable, None
            alternate = None
            if confirmed and confirmed == _choice(_address_label(address)):
                alternate = self._confirmed_spelling(text, address, found)
            geography = self._historical_match(address, found, alternate)
            if geography is None:
                return unavailable, None
            return historical_candidate_results(
                db, address=_address_label(address), geography=geography
            ), None
        range_id = found.range_id
        body = self.fetch(SOURCE_URL, {"prodAddressRangeId": range_id})
        try:
            catalogue = parse_candidate_ballot(
                body,
                expected_election_id=election_id,
                expected_election_date=date(2026, 11, 3),
                checked_at=self.now(),
            )
        except CandidateBallotError:
            raise CandidateLookupUnavailable(
                "Official candidate records unavailable for this election"
            ) from None
        return {
            "kind": "results",
            "electionId": election_id,
            "matchedAddress": _address_label(address),
            "races": [race_payload(race, catalogue) for race in catalogue.races],
            "coverage": [
                {
                    "kind": "coverage-unconfirmed",
                    "office": "Some local offices may be missing from Minnesota sample ballot records",
                    "authority": AUTHORITY,
                    "url": "https://www.sos.mn.gov/elections-voting/whats-on-my-ballot/",
                }
            ],
        }, catalogue


@lru_cache(maxsize=1)
def get_candidate_lookup_service() -> CandidateLookupService:
    return CandidateLookupService()


def _source(catalogue: BallotCatalogue) -> dict:
    return {
        "authority": catalogue.authority,
        "url": BALLOT_HOME,
        "checkedDate": catalogue.checked_at.astimezone(ZoneInfo("America/Chicago"))
        .date()
        .isoformat(),
    }


def _group(title: str) -> str:
    if "School Board" in title:
        return "school"
    if title.startswith("County ") or title.startswith("Soil and Water "):
        return "county"
    if any(word in title for word in ("Mayor", "Council Member", "Town ", "Township ")):
        return "municipal"
    if any(
        word in title
        for word in (
            "State ",
            "Governor",
            "Attorney General",
            "Secretary of State",
            "U.S. ",
            "Justice -",
            "Judge -",
        )
    ):
        return "state"
    return "other"


def _area(race: BallotRace) -> str:
    # Extract only jurisdiction words explicitly present in the official title.
    title = race.office_title
    school = re.search(r"\((ISD|SSD|CSD) #(\d+)\)", title)
    if school:
        district = re.search(r"Member District (\d+)", title)
        area = f"{school.group(1)} #{school.group(2)}"
        return (
            f"{area} · Member district {district.group(1)}"
            if district
            else f"{area} · Whole district"
        )
    for pattern, label in (
        (r"State Representative District (\d+[AB])", "House District"),
        (r"State Senator District (\d+)", "Senate District"),
        (r"U\.S\. Representative District (\d+)", "Congressional District"),
        (r"Judge - (\d+(?:st|nd|rd|th)) District Court", "Judicial District"),
    ):
        match = re.search(pattern, title)
        if match:
            return f"{label} {match.group(1)}"
    if ballot_jurisdiction(title, race.county_name) == "Minnesota":
        return "Minnesota"
    district = re.search(r"County Commissioner District (\d+)", title)
    if district:
        return f"{race.county_name} County · District {district.group(1)}"
    if title.startswith(("County ", "Soil and Water ")):
        return f"{race.county_name} County"
    # Local titles retain municipality/seat; a postal city never supplies either.
    return f"{title} · {race.county_name} County"


def _person(candidate) -> dict:
    result = {
        "id": candidate.stable_id,
        "name": candidate.name,
        "sortName": candidate.name,
    }
    if candidate.party_name:
        result["party"] = candidate.party_name
    return result


def race_payload(race: BallotRace, catalogue: BallotCatalogue) -> dict:
    entries = []
    for candidate in race.candidates:
        person = _person(candidate)
        if candidate.is_joint_ticket:
            # The source owns a single joint label. Splitting on "and" would
            # invent separate identities; show that exact label as 1 ticket.
            entry = {"kind": "ticket", "id": candidate.stable_id, "members": [person]}
            if candidate.party_name:
                entry["party"] = candidate.party_name
        else:
            entry = {"kind": "candidate", "candidate": person}
        entries.append(entry)
    result = {
        "id": race.stable_id,
        "group": _group(race.office_title),
        "office": re.sub(r" \(Elect \d+\)$", "", race.office_title),
        "votingArea": _area(race),
        "entries": entries,
        "source": _source(catalogue),
    }
    seats = re.search(r"\(Elect (\d+)\)", race.office_title)
    if seats:
        result["seatCount"] = int(seats.group(1))
    return result


def persist_catalogue(db: Session, catalogue: BallotCatalogue) -> None:
    from alethical.db.models import CandidateSnapshot
    from alethical.api.services.person_records import (
        public_version,
        retain_public_versions,
        save_candidate_records,
        sync_reviewed_legislators,
    )

    document = candidate_ballot_document(catalogue)
    document["publication_status"] = "source_backed_ballot_lookup"
    canonical = json.dumps(
        {
            key: value
            for key, value in document.items()
            if key not in {"checked_at", "source_sha256"}
        },
        sort_keys=True,
        ensure_ascii=False,
        separators=(",", ":"),
    ).encode()
    snapshot_id = hashlib.sha256(canonical).hexdigest()
    old = db.get(CandidateSnapshot, snapshot_id)
    versions = [
        public_version(
            kind="ballot",
            record_id=snapshot_id,
            payload=document,
            source_hash=catalogue.source_sha256,
            checked_at=catalogue.checked_at,
        )
    ]
    if old is not None:
        versions.insert(
            0,
            public_version(
                kind="ballot",
                record_id=snapshot_id,
                payload=old.public_payload,
                source_hash=old.source_sha256,
                checked_at=old.checked_at,
            ),
        )
    retain_public_versions(db, versions)
    snapshot = insert(CandidateSnapshot).values(
        id=snapshot_id,
        election_id=catalogue.election.election_id,
        source_sha256=catalogue.source_sha256,
        public_payload=document,
        checked_at=catalogue.checked_at,
    )
    # This existing index keeps its newest accepted read. Every read and its
    # actual source hash/check time is retained separately above.
    snapshot = snapshot.on_conflict_do_update(
        index_elements=["id"],
        set_={
            "public_payload": snapshot.excluded.public_payload,
            "source_sha256": snapshot.excluded.source_sha256,
            "checked_at": snapshot.excluded.checked_at,
        },
        where=CandidateSnapshot.checked_at <= snapshot.excluded.checked_at,
    )
    db.execute(snapshot)
    profiles = []
    for race in catalogue.races:
        for candidate in race.candidates:
            profile: dict[str, Any] = {
                "candidate": _person(candidate),
                "election": dict(SUPPORTED_ELECTION),
                "office": re.sub(r" \(Elect \d+\)$", "", race.office_title),
                "votingArea": _area(race),
                "source": _source(catalogue),
            }
            if candidate.campaign_website:
                profile["website"] = candidate.campaign_website
            profiles.append(profile)
    # Every candidate lock is taken in 1 ordered statement, so simultaneous ballots
    # sharing races cannot cross locks. Records apply in stable candidate order.
    save_candidate_records(
        db,
        profiles=sorted(profiles, key=lambda item: item["candidate"]["id"]),
        source_hash=catalogue.source_sha256,
        checked_at=catalogue.checked_at,
    )
    sync_reviewed_legislators(
        db,
        today=catalogue.checked_at.astimezone(ZoneInfo("America/Chicago")).date(),
        candidate_ids={profile["candidate"]["id"] for profile in profiles},
    )
    db.commit()


def load_profile(
    db: Session, candidate_id: str, *, now: datetime | None = None
) -> dict | None:
    from alethical.db.models import CandidateRecord
    from alethical.api.services.candidate_legislators import confirmed_legislator
    from alethical.api.services.person_records import add_profile_records

    if not re.fullmatch(r"[a-f0-9]{64}", candidate_id):
        return None
    record = db.get(CandidateRecord, candidate_id)
    if record is None:
        return None
    payload = {**record.public_payload, "source": dict(record.public_payload["source"])}
    checked_now = now or datetime.now(UTC)
    if not payload["source"].get(
        "retained"
    ) and checked_now - record.checked_at > timedelta(hours=24):
        payload["source"]["stale"] = True
    payload["isJointTicket"] = payload.get("office") == "Governor & Lt Governor"
    connection = confirmed_legislator(
        db, payload, today=checked_now.astimezone(ZoneInfo("America/Chicago")).date()
    )
    if connection:
        payload["legislator"] = connection
        if connection.get("photoUrl") and not payload["isJointTicket"]:
            payload["photo"] = {"url": connection["photoUrl"]}
    return add_profile_records(
        db, payload, today=checked_now.astimezone(ZoneInfo("America/Chicago")).date()
    )
