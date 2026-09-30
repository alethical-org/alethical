"""Inactive, offline normalization of Minnesota's public sample-ballot response.

This module does not fetch, save, or publish anything. Ballot availability never
proves complete filing coverage or candidate ownership. Address-range matching
is separate from the public candidate index; caller-supplied input is not retained.
"""

from __future__ import annotations

import hashlib
import json
import re
from collections.abc import Mapping, Sequence
from dataclasses import asdict, dataclass
from datetime import date, datetime
from typing import Literal
from urllib.parse import urlsplit

SOURCE_URL = "https://myballotmn.sos.mn.gov/api/PollingPlaceData/GetPollingPlaceData"
AUTHORITY = "Minnesota Secretary of State"


class CandidateBallotError(ValueError):
    """Unsafe or unresolved source input; never an authoritative empty result."""


def _require(condition: bool, message: str) -> None:
    if not condition:
        raise CandidateBallotError(message)


def _text(value: object, field: str, *, optional: bool = False) -> str:
    if value is None and optional:
        return ""
    _require(isinstance(value, str), f"invalid {field}")
    assert isinstance(value, str)
    _require(len(value) <= 1000, f"oversized {field}")
    _require(not any(ord(c) < 32 or ord(c) == 127 for c in value), f"invalid {field}")
    value = value.strip()
    _require(optional or bool(value), f"missing {field}")
    return value


def _code(value: object, field: str) -> str:
    result = _text(value, field)
    _require(bool(re.fullmatch(r"[0-9]{4}", result)), f"invalid {field}")
    return result


def _identity(parts: tuple[str, ...]) -> str:
    encoded = json.dumps(parts, ensure_ascii=False, separators=(",", ":")).encode()
    return hashlib.sha256(encoded).hexdigest()


@dataclass(frozen=True)
class BallotElection:
    election_id: str
    election_date: date
    description: str


@dataclass(frozen=True)
class BallotCandidate:
    stable_id: str
    race_id: str
    office_code: str
    candidate_code: str
    office_title: str
    county_name: str
    name: str
    party_name: str | None
    campaign_website: str | None
    is_joint_ticket: bool


@dataclass(frozen=True)
class BallotRace:
    stable_id: str
    office_code: str
    office_title: str
    county_name: str
    candidates: tuple[BallotCandidate, ...]
    coverage: Literal["unknown"] = "unknown"


@dataclass(frozen=True)
class BallotCatalogue:
    election: BallotElection
    authority: str
    source_url: str
    checked_at: datetime
    source_sha256: str
    races: tuple[BallotRace, ...]
    publication_status: Literal["staged_only"] = "staged_only"


def _unique_json_object(pairs: list[tuple[str, object]]) -> dict[str, object]:
    result = {}
    for key, value in pairs:
        _require(key not in result, "duplicate JSON field")
        result[key] = value
    return result


def parse_candidate_ballot(
    body: bytes,
    *,
    expected_election_id: str,
    expected_election_date: date,
    checked_at: datetime,
    source_url: str = SOURCE_URL,
) -> BallotCatalogue:
    """Remove private lookup fields while retaining minimal public ballot records.

    Identity is deliberately conservative: election, county, full office title,
    office code and candidate code. It does not establish identity across sources,
    counties or elections. Precincts, range IDs, raw source bytes and addresses are
    absent from the output, including its provenance URL.
    """
    _require(source_url == SOURCE_URL, "source URL must omit lookup parameters")
    _require(
        isinstance(checked_at, datetime) and checked_at.utcoffset() is not None,
        "checked_at needs a timezone",
    )
    _require(
        isinstance(expected_election_id, str)
        and bool(re.fullmatch(r"[0-9]{1,20}", expected_election_id)),
        "invalid expected election ID",
    )
    _require(type(expected_election_date) is date, "invalid expected election date")
    _require(
        isinstance(body, bytes) and 0 < len(body) <= 20_000_000, "invalid source size"
    )
    try:
        payload = json.loads(
            body.decode("utf-8-sig"), object_pairs_hook=_unique_json_object
        )
    except (UnicodeError, json.JSONDecodeError) as error:
        raise CandidateBallotError("invalid ballot JSON") from error
    _require(isinstance(payload, dict), "invalid ballot envelope")
    _require(
        not any(key.lower() in ("error", "errors") for key in payload), "source error"
    )
    context = payload.get("PollingResult")
    rows = payload.get("Ballots")
    _require(isinstance(context, dict), "missing election context")
    _require(isinstance(rows, list) and len(rows) <= 100_000, "invalid ballot rows")
    election_id = _text(context.get("ElectionId"), "ElectionId")
    raw_date = _text(context.get("ElectionDate"), "ElectionDate")
    try:
        election_date = datetime.strptime(raw_date, "%m/%d/%Y %H:%M:%S").date()
    except ValueError as error:
        raise CandidateBallotError("invalid election date") from error
    _require(
        election_id == expected_election_id and election_date == expected_election_date,
        "source election does not match requested election",
    )
    election = BallotElection(
        election_id,
        election_date,
        _text(context.get("FullElectionDescription"), "FullElectionDescription"),
    )
    county = _text(context.get("CountyName"), "CountyName")
    # Validate source scope without copying it into the candidate index.
    _text(context.get("PrecinctCode"), "PrecinctCode")
    _text(context.get("PrecinctName"), "PrecinctName")
    groups: dict[tuple[str, str], dict[str, BallotCandidate]] = {}
    for row in rows:
        _require(isinstance(row, dict), "invalid ballot row")
        question = _text(row.get("QuestionId"), "QuestionId", optional=True)
        amendment = row.get("IsConstitutionalAmendment", "0")
        _require(amendment in ("0", "1"), "invalid amendment flag")
        if question or amendment == "1":
            continue
        title = _text(row.get("OfficeTitle"), "OfficeTitle")
        office = _code(row.get("UploadOfficeCode"), "UploadOfficeCode")
        candidate_code = _code(row.get("UploadCandidateCode"), "UploadCandidateCode")
        name = _text(row.get("CandidateScreenName"), "CandidateScreenName")
        group = office, title
        records = groups.setdefault(group, {})
        if candidate_code == "9901" or name.upper() == "WRITE-IN":
            continue
        party = _text(row.get("PartyName"), "PartyName", optional=True)
        website = _text(row.get("CampaignWebsite"), "CampaignWebsite", optional=True)
        if website:
            try:
                parsed = urlsplit(website)
            except ValueError as error:
                raise CandidateBallotError("invalid campaign website") from error
            _require(
                parsed.scheme in ("http", "https")
                and bool(parsed.hostname)
                and parsed.username is None
                and parsed.password is None,
                "invalid campaign website",
            )
        race_parts = (election_id, election_date.isoformat(), county, office, title)
        race_id = _identity(race_parts)
        candidate = BallotCandidate(
            _identity((*race_parts, candidate_code)),
            race_id,
            office,
            candidate_code,
            title,
            county,
            name,
            party or None,
            website or None,
            title == "Governor & Lt Governor",
        )
        prior = records.get(candidate_code)
        _require(prior is None or prior == candidate, "conflicting candidate identity")
        records[candidate_code] = candidate
    races = tuple(
        BallotRace(
            _identity((election_id, election_date.isoformat(), county, office, title)),
            office,
            title,
            county,
            tuple(
                sorted(
                    records.values(),
                    key=lambda item: (item.name.casefold(), item.stable_id),
                )
            ),
        )
        for (office, title), records in sorted(
            groups.items(), key=lambda item: (item[0][1], item[0][0])
        )
    )
    return BallotCatalogue(
        election,
        AUTHORITY,
        source_url,
        checked_at,
        hashlib.sha256(body).hexdigest(),
        races,
    )


def candidate_ballot_document(catalogue: BallotCatalogue) -> dict:
    """Public-record projection, with no saved visitor or address-range association."""
    result = asdict(catalogue)
    result["election"]["election_date"] = catalogue.election.election_date.isoformat()
    result["checked_at"] = catalogue.checked_at.isoformat()
    return result


@dataclass(frozen=True)
class StreetAddress:
    """Already structured input; street includes its complete direction and type.

    unit must be an exact official unit label. Uninterpreted unit ranges are not
    guessed from an apartment number. Caller handles unresolved address choices.
    """

    street: str
    city: str
    state: str
    zip_code: str
    house_number: int
    house_number_suffix: str = ""
    unit: str = ""


@dataclass(frozen=True)
class StreetRangeMatch:
    """Temporary lookup handle, never a field in a public candidate index."""

    range_id: int


def _same_text(left: str, right: str) -> bool:
    return " ".join(left.upper().split()) == " ".join(right.upper().split())


def match_street_range(
    rows: Sequence[Mapping[str, object]], address: StreetAddress
) -> StreetRangeMatch:
    """Require one exact official range; never infer town from its postal city."""
    _require(
        type(address.house_number) is int and address.house_number >= 0,
        "invalid house number",
    )
    street = _text(address.street, "street")
    city = _text(address.city, "city")
    state = _text(address.state, "state")
    zip_code = _text(address.zip_code, "ZIP")
    suffix = _text(address.house_number_suffix, "house suffix", optional=True)
    unit = _text(address.unit, "unit", optional=True)
    _require(state.upper() == "MN", "address must be in Minnesota")
    _require(bool(re.fullmatch(r"[0-9]{5}", zip_code)), "invalid ZIP")
    _require(
        not isinstance(rows, (str, bytes)) and len(rows) <= 100_000,
        "invalid street rows",
    )
    matches = []
    for row in rows:
        _require(isinstance(row, Mapping), "invalid street row")
        values = {
            key: _text(row.get(key), key)
            for key in ("FullStreetName", "CityName", "StateCode", "ZipCode")
        }
        if not all(
            _same_text(values[key], requested)
            for key, requested in (
                ("FullStreetName", street),
                ("CityName", city),
                ("StateCode", state),
                ("ZipCode", zip_code),
            )
        ):
            continue
        low, high = row.get("HouseNumberLow"), row.get("HouseNumberHigh")
        _require(
            type(low) is int and type(high) is int and 0 <= low <= high,
            "invalid house range",
        )
        assert isinstance(low, int) and isinstance(high, int)
        parity = row.get("OddEvenInd")
        _require(parity in ("B", "E", "O"), "unknown address parity")
        if not low <= address.house_number <= high:
            continue
        if (
            parity == "E"
            and address.house_number % 2
            or parity == "O"
            and address.house_number % 2 == 0
        ):
            continue
        row_suffix = _text(
            row.get("HouseNumberSuffix"), "HouseNumberSuffix", optional=True
        )
        if not _same_text(row_suffix, suffix):
            continue
        needs_unit = row.get("DisplayUnitNbr")
        _require(type(needs_unit) is bool, "invalid unit requirement")
        row_unit = _text(row.get("UnitNumberRange"), "UnitNumberRange", optional=True)
        if needs_unit or row_unit:
            _require(bool(row_unit), "official unit information is unresolved")
            if not unit or not _same_text(row_unit, unit):
                continue
        range_id = row.get("ProdAddressRangeId")
        _require(type(range_id) is int and range_id > 0, "invalid address range ID")
        assert isinstance(range_id, int)
        matches.append(range_id)
    _require(len(matches) == 1, "address range is missing or ambiguous")
    return StreetRangeMatch(matches[0])
