"""Fresh official ballot lookups; only address-free candidate evidence is durable."""

from __future__ import annotations

import hashlib
import json
import re
import threading
import time
from collections import OrderedDict
from collections.abc import Callable
from datetime import UTC, date, datetime, timedelta
from functools import lru_cache
from typing import Any
from zoneinfo import ZoneInfo

import requests
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.orm import Session

from alethical.api.services.address_format import normalize_address_format
from alethical.api.services.representative_lookup import (
    MINNESOTA_ADDRESS_POINTS_URL,
    MinnesotaAddressPointGeocoder,
    RepresentativeLookupNotFound,
    RepresentativeLookupOutsideMinnesota,
    RepresentativeLookupUpstreamError,
)
from alethical.api.services.zip_state_reference import SUPPORTED_STATES
from alethical.pipeline.candidate_ballot import (
    AUTHORITY,
    SOURCE_URL,
    BallotCatalogue,
    BallotRace,
    CandidateAddressNotFound,
    CandidateBallotError,
    StreetAddress,
    ballot_jurisdiction,
    candidate_ballot_document,
    match_street_range,
    parse_candidate_ballot,
    validate_street_rows,
)

STREETS_URL = "https://myballotmn.sos.mn.gov/api/Streets/GetStreets"
BALLOT_HOME = "https://myballotmn.sos.mn.gov/"
SUPPORTED_ELECTION = {
    "id": "8334",
    "label": "November 3, 2026 general election",
    "date": "2026-11-03",
    "type": "general",
}
PRIVATE_HEADERS = {"Cache-Control": "private, no-store", "Vary": "Origin"}


class CandidateLookupUnavailable(Exception):
    """Public safe error; no source URL, address or underlying exception text."""


def official_bytes(url: str, params: dict[str, str | int]) -> bytes:
    """The fixed source allowlist cannot be changed by a submitted address."""
    if url not in (STREETS_URL, SOURCE_URL):
        raise CandidateLookupUnavailable("Unsupported candidate source")
    expected = "ZipCode" if url == STREETS_URL else "prodAddressRangeId"
    if set(params) != {expected} or not re.fullmatch(
        r"[0-9]{1,12}", str(params[expected])
    ):
        raise CandidateLookupUnavailable("Unsupported candidate source request")
    # Do not follow a redirect to an unrelated host, or include source exceptions
    # (which can contain the request parameters) in operational reports.
    try:
        started = time.monotonic()
        with requests.get(
            url,
            params=params,
            timeout=(3.05, 12),
            allow_redirects=False,
            stream=True,
            # This official service double-encodes its JSON into a JSON string
            # for application/json, but sends the actual object as text/plain.
            headers={"Accept": "text/plain"},
        ) as response:
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
    return " ".join(
        _ALIASES.get(word, word) for word in value.upper().replace(".", "").split()
    )


def _choice(address: str) -> dict:
    return {
        "id": hashlib.sha256(address.encode()).hexdigest(),
        "label": address,
        "address": address,
    }


_UNIT_PATTERN = re.compile(
    r"(?:\b(?:APT|APARTMENT|UNIT|SUITE|STE)\s+|#\s*)[A-Z0-9-]+\b", re.IGNORECASE
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


def _street_json_object(pairs: list[tuple[str, object]]) -> dict:
    result = {}
    for key, value in pairs:
        if key in result:
            raise ValueError("Duplicate street source field")
        result[key] = value
    return result


def _parse_with_rows(
    text: str, rows: list[dict], *, prefix: bool = False
) -> list[StreetAddress]:
    """Match all supplied words against source streets, not coordinates or incumbents."""
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
    for row in rows:
        street, city = row.get("FullStreetName"), row.get("CityName")
        if not isinstance(street, str) or not isinstance(city, str):
            raise CandidateLookupUnavailable("Official street records unavailable")
        if row.get("StateCode") != "MN" or row.get("ZipCode") != zip_code:
            continue
        requested = remainder
        # Postal city belongs to the address match, never to a municipal race.
        city_pattern = r"(?:,?\s+)" + re.escape(city.strip()) + r"$"
        city_match = re.search(city_pattern, requested)
        if city_match:
            requested = requested[: city_match.start()].strip(" ,")
        elif "," in requested:
            continue
        unit = ""
        unit_match = re.search(
            r"\s+((?:(?:APT|APARTMENT|UNIT|SUITE|STE)\s+|#\s*)[^,]+)$", requested
        )
        if unit_match:
            unit = unit_match.group(1).strip()
            requested = requested[: unit_match.start()]
        expected, supplied = _normal(street), _normal(requested)
        if not (expected.startswith(supplied) if prefix else expected == supplied):
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
        matches[key] = address
    return list(matches.values())


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
        self._lock = threading.Lock()

    def elections(self) -> list[dict]:
        # Do not offer an old ballot as a future election after its date passes.
        return (
            [dict(SUPPORTED_ELECTION)]
            if self.now().astimezone(ZoneInfo("America/Chicago")).date()
            <= date(2026, 11, 3)
            else []
        )

    def streets(self, zip_code: str) -> list[dict]:
        if not re.fullmatch(r"\d{5}", zip_code):
            return []
        now = self.clock()
        with self._lock:
            cached = self._streets.get(zip_code)
            if cached and cached[0] > now:
                self._streets.move_to_end(zip_code)
                return cached[1]
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
        with self._lock:
            previous = self._streets.pop(zip_code, None)
            if previous:
                self._street_bytes -= previous[2]
            self._streets[zip_code] = (now + 300, rows, len(body))
            self._street_bytes += len(body)
            self._streets.move_to_end(zip_code)
            while len(self._streets) > 32 or self._street_bytes > 8_000_000:
                _, dropped = self._streets.popitem(last=False)
                self._street_bytes -= dropped[2]
        return rows

    def suggest(self, text: str) -> list[dict]:
        text = normalize_address_format(text)
        zip_match = re.search(r"\b(\d{5})(?:-\d{4})?$", text.strip())
        if zip_match:
            addresses = _parse_with_rows(
                text, self.streets(zip_match.group(1)), prefix=True
            )
            return [_choice(_address_label(address)) for address in addresses[:5]]
        try:
            matches = self.geocoder.suggest_matches(text)
        except (requests.RequestException, RepresentativeLookupUpstreamError):
            raise CandidateLookupUnavailable(
                "Government address service unavailable"
            ) from None
        return [
            choice
            for match in matches[:5]
            if match.state_code in (None, "MN")
            if (choice := _geocoded_choice(text, match.matched_address)) is not None
        ]

    def resolve(
        self, text: str, confirmed: dict | None = None
    ) -> tuple[StreetAddress, list[dict]] | dict:
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
                    return {"kind": "no-match"}
                text = confirmed["address"]
                confirmed = None
            elif choices:
                # Even one geocoded answer may correct the street or locality.
                # The reader must explicitly choose that complete address.
                return {"kind": "ambiguous", "choices": choices[:5]}
            else:
                return {"kind": "no-match"}
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
        choices = [_choice(_address_label(address)) for address in matches]
        if confirmed is not None and confirmed not in choices:
            # For no-ZIP geocoding the original confirmed string may have been
            # standardized. It must nevertheless resolve to exactly 1 official
            # address, with the same words after harmless formatting changes.
            if (
                len(matches) != 1
                or confirmed != _choice(confirmed["address"])
                or _normal(confirmed["address"].replace(",", " "))
                != _normal(choices[0]["address"].replace(",", " "))
            ):
                return {"kind": "no-match"}
            # The complete choice's label/id are internally valid and every
            # address word matches the sole official result after abbreviation
            # expansion. Carry that canonical choice into the exact filter.
            confirmed = choices[0]
        if len(matches) > 1 and confirmed is None:
            return {"kind": "ambiguous", "choices": choices[:5]}
        if confirmed is not None:
            matches = [
                address
                for address in matches
                if _choice(_address_label(address)) == confirmed
            ]
        if len(matches) != 1:
            return {"kind": "no-match"}
        try:
            match_street_range(rows, matches[0])
        except CandidateAddressNotFound:
            return {"kind": "no-match"}
        except CandidateBallotError:
            raise CandidateLookupUnavailable(
                "Official street records unavailable"
            ) from None
        return matches[0], rows

    def lookup(
        self, text: str, election_id: str, confirmed: dict | None = None
    ) -> tuple[dict, BallotCatalogue | None]:
        if election_id not in {item["id"] for item in self.elections()}:
            return {"kind": "no-elections"}, None
        resolved = self.resolve(text, confirmed)
        if isinstance(resolved, dict):
            return resolved, None
        address, rows = resolved
        range_id = match_street_range(rows, address).range_id
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
    from alethical.db.models import CandidateRecord, CandidateSnapshot

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
    snapshot = insert(CandidateSnapshot).values(
        id=hashlib.sha256(canonical).hexdigest(),
        election_id=catalogue.election.election_id,
        source_sha256=catalogue.source_sha256,
        public_payload=document,
        checked_at=catalogue.checked_at,
    )
    # Repeated identical public facts share evidence; retain the newest read/hash.
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
            statement = insert(CandidateRecord).values(
                id=candidate.stable_id,
                election_id=catalogue.election.election_id,
                election_date=catalogue.election.election_date,
                public_payload=profile,
                source_sha256=catalogue.source_sha256,
                checked_at=catalogue.checked_at,
            )
            statement = statement.on_conflict_do_update(
                index_elements=["id"],
                set_={
                    "public_payload": statement.excluded.public_payload,
                    "source_sha256": statement.excluded.source_sha256,
                    "checked_at": statement.excluded.checked_at,
                },
                where=CandidateRecord.checked_at <= statement.excluded.checked_at,
            )
            db.execute(statement)
    db.commit()


def load_profile(
    db: Session, candidate_id: str, *, now: datetime | None = None
) -> dict | None:
    from alethical.db.models import CandidateRecord
    from alethical.api.services.candidate_legislators import confirmed_legislator

    if not re.fullmatch(r"[a-f0-9]{64}", candidate_id):
        return None
    record = db.get(CandidateRecord, candidate_id)
    if record is None:
        return None
    payload = {**record.public_payload, "source": dict(record.public_payload["source"])}
    checked_now = now or datetime.now(UTC)
    if checked_now - record.checked_at > timedelta(hours=24):
        payload["source"]["stale"] = True
    payload["isJointTicket"] = payload.get("office") == "Governor & Lt Governor"
    connection = confirmed_legislator(
        db, payload, today=checked_now.astimezone(ZoneInfo("America/Chicago")).date()
    )
    if connection:
        payload["legislator"] = connection
        if connection.get("photoUrl") and not payload["isJointTicket"]:
            payload["photo"] = {"url": connection["photoUrl"]}
    return payload
