"""Fresh MyBallot evidence from independently collected public references.

Call outside database transactions/locks. After fetching, acquire the candidate
lock and call matches_record against the current row before saving public_payload.
Only the requested candidate is approved for persistence. This module neither
writes the reference register nor accepts a visitor's address or range locator.
"""

from __future__ import annotations

import json
import re
import threading
import time
from collections.abc import Mapping
from dataclasses import dataclass
from datetime import UTC, date, datetime
from enum import StrEnum
from functools import lru_cache
from pathlib import Path

from alethical.api.services.candidate_lookup import (
    CandidateLookupUnavailable,
    official_bytes,
    race_payload,
)
from alethical.pipeline.candidate_ballot import (
    SOURCE_URL,
    BallotCandidate,
    BallotCatalogue,
    BallotElection,
    BallotRace,
    CandidateBallotError,
    parse_candidate_ballot,
)

REFERENCE_PATH = (
    Path(__file__).resolve().parents[2]
    / "pipeline/data/candidate_recheck_references_2026_v1.json"
)
# Bound concurrent and repeated traffic. No successful response is cached as a
# fresh check; every success corresponds to an actual source response.
_FETCH_SLOTS = threading.BoundedSemaphore(2)
_START_LOCK = threading.Lock()
_LAST_START = 0.0
_MIN_START_INTERVAL = 0.5


class CandidateRecheckReason(StrEnum):
    REFERENCE_UNAVAILABLE = "reference_unavailable"
    IDENTITY_MISMATCH = "identity_mismatch"
    ELECTION_MISMATCH = "election_mismatch"
    SOURCE_UNAVAILABLE = "source_unavailable"
    INVALID_SOURCE = "invalid_source"
    CANDIDATE_MISSING = "candidate_missing"
    BUSY = "busy"


class CandidateRecheckUnavailable(Exception):
    """Safe machine reason; no source response, address or exception content."""

    def __init__(self, reason: CandidateRecheckReason):
        self.reason = reason
        super().__init__(reason.value)


@dataclass(frozen=True)
class _Reference:
    range_id: int
    election: BallotElection
    source_sha256: str
    checked_at: datetime
    candidates: tuple[BallotCandidate, ...]


@dataclass(frozen=True)
class _RecordIdentity:
    candidate_id: str
    election_id: str
    election_date: date
    name: str
    party: str | None
    office: str
    voting_area: str


def _record_identity(
    candidate_id: str,
    payload: Mapping,
    election_id: str,
    election_date: date,
) -> _RecordIdentity:
    try:
        candidate = payload["candidate"]
        election = payload["election"]
        identity = _RecordIdentity(
            candidate_id,
            election_id,
            election_date,
            candidate["name"],
            candidate.get("party"),
            payload["office"],
            payload["votingArea"],
        )
        if (
            candidate["id"] != candidate_id
            or election["id"] != election_id
            or election["date"] != election_date.isoformat()
            or type(election_date) is not date
            or not all(
                isinstance(value, str) and value
                for value in (
                    candidate_id,
                    election_id,
                    identity.name,
                    identity.office,
                    identity.voting_area,
                )
            )
            or (identity.party is not None and not isinstance(identity.party, str))
        ):
            raise ValueError
        return identity
    except (KeyError, TypeError, AttributeError, ValueError):
        raise CandidateRecheckUnavailable(
            CandidateRecheckReason.IDENTITY_MISMATCH
        ) from None


def _profile(candidate: BallotCandidate, catalogue: BallotCatalogue) -> dict:
    race = BallotRace(
        candidate.race_id,
        candidate.office_code,
        candidate.office_title,
        candidate.county_name,
        (candidate,),
    )
    display = race_payload(race, catalogue)
    person = {
        "id": candidate.stable_id,
        "name": candidate.name,
        "sortName": candidate.name,
    }
    if candidate.party_name:
        person["party"] = candidate.party_name
    profile = {
        "candidate": person,
        "election": {
            "id": catalogue.election.election_id,
            "date": catalogue.election.election_date.isoformat(),
            "label": (
                f"{catalogue.election.election_date:%B} "
                f"{catalogue.election.election_date.day}, "
                f"{catalogue.election.election_date.year} general election"
            ),
            "type": "general",
        },
        "office": display["office"],
        "votingArea": display["votingArea"],
        "source": display["source"],
    }
    if candidate.campaign_website:
        profile["website"] = candidate.campaign_website
    return profile


@dataclass(frozen=True)
class VerifiedCandidateRecheck:
    candidate: BallotCandidate
    catalogue: BallotCatalogue
    original_identity: _RecordIdentity

    @property
    def checked_at(self) -> datetime:
        return self.catalogue.checked_at

    @property
    def source_sha256(self) -> str:
        return self.catalogue.source_sha256

    def public_payload(self) -> dict:
        """New whitelisted profile, excluding every input or source-envelope extra."""
        return _profile(self.candidate, self.catalogue)

    def matches_record(
        self,
        candidate_id: str,
        public_payload: Mapping,
        election_id: str,
        election_date: date,
    ) -> bool:
        """Recheck under the caller's candidate lock; never refresh a changed row."""
        try:
            current = _record_identity(
                candidate_id, public_payload, election_id, election_date
            )
        except CandidateRecheckUnavailable:
            return False
        return current == self.original_identity


@lru_cache(maxsize=1)
def _references() -> tuple[_Reference, ...]:
    try:
        document = json.loads(REFERENCE_PATH.read_bytes())
        if document["version"] != 1:
            raise ValueError
        references = []
        for item in document["references"]:
            range_id = item["range_id"]
            if (
                type(range_id) is not int
                or range_id <= 0
                or item["source_url"] != f"{SOURCE_URL}?prodAddressRangeId={range_id}"
                or not re.fullmatch(r"[a-f0-9]{64}", item["source_sha256"])
                or item["election_id"] != "8334"
                or item["election_date"] != "2026-11-03"
            ):
                raise ValueError
            reference = _Reference(
                range_id,
                BallotElection(
                    item["election_id"],
                    date.fromisoformat(item["election_date"]),
                    item["description"],
                ),
                item["source_sha256"],
                datetime.fromisoformat(item["checked_at"]),
                tuple(BallotCandidate(**row) for row in item["candidates"]),
            )
            references.append(reference)
        if not references or len(references) > 3:
            raise ValueError
        return tuple(references)
    except (OSError, ValueError, KeyError, TypeError):
        raise CandidateRecheckUnavailable(
            CandidateRecheckReason.REFERENCE_UNAVAILABLE
        ) from None


def _throttled_fetch(range_id: int) -> bytes:
    global _LAST_START
    with _START_LOCK:
        now = time.monotonic()
        wait = max(0.0, _LAST_START + _MIN_START_INTERVAL - now)
        _LAST_START = now + wait
    if wait:
        time.sleep(wait)
    return official_bytes(SOURCE_URL, {"prodAddressRangeId": range_id})


def fetch_candidate_recheck(
    candidate_id: str,
    public_payload: dict,
    election_id: str,
    election_date: date,
) -> VerifiedCandidateRecheck:
    """Fetch outside DB locks; caller persists one result after matches_record.

    At most 2 source attempts, both using the same independently proved locator.
    Transport failure gets 1 bounded retry; malformed/mismatched data never does.
    No failure returns a new check date or source payload.
    """
    original = _record_identity(
        candidate_id, public_payload, election_id, election_date
    )
    matches = [
        (reference, candidate)
        for reference in _references()
        if reference.election.election_id == election_id
        and reference.election.election_date == election_date
        for candidate in reference.candidates
        if candidate.stable_id == candidate_id
    ]
    if not matches:
        raise CandidateRecheckUnavailable(CandidateRecheckReason.REFERENCE_UNAVAILABLE)
    reference, expected = matches[0]
    baseline = BallotCatalogue(
        reference.election,
        "Minnesota Secretary of State",
        SOURCE_URL,
        reference.checked_at,
        reference.source_sha256,
        (),
    )
    if original != _record_identity(
        candidate_id, _profile(expected, baseline), election_id, election_date
    ):
        raise CandidateRecheckUnavailable(CandidateRecheckReason.IDENTITY_MISMATCH)
    if not _FETCH_SLOTS.acquire(blocking=False):
        raise CandidateRecheckUnavailable(CandidateRecheckReason.BUSY)
    try:
        for attempt in range(2):
            try:
                body = _throttled_fetch(reference.range_id)
                break
            except CandidateLookupUnavailable:
                if attempt == 1:
                    raise CandidateRecheckUnavailable(
                        CandidateRecheckReason.SOURCE_UNAVAILABLE
                    ) from None
        checked_at = datetime.now(UTC)
    finally:
        _FETCH_SLOTS.release()
    try:
        catalogue = parse_candidate_ballot(
            body,
            expected_election_id=election_id,
            expected_election_date=election_date,
            checked_at=checked_at,
        )
    except CandidateBallotError as error:
        reason = (
            CandidateRecheckReason.ELECTION_MISMATCH
            if str(error) == "source election does not match requested election"
            else CandidateRecheckReason.INVALID_SOURCE
        )
        raise CandidateRecheckUnavailable(reason) from None
    candidates = [
        candidate for race in catalogue.races for candidate in race.candidates
    ]
    fresh = [
        candidate for candidate in candidates if candidate.stable_id == candidate_id
    ]
    if len(fresh) != 1:
        # A changed title changes the ID: do not mistake that for a safe new row.
        changed_title = any(
            candidate.office_code == expected.office_code
            and candidate.candidate_code == expected.candidate_code
            for candidate in candidates
        )
        raise CandidateRecheckUnavailable(
            CandidateRecheckReason.IDENTITY_MISMATCH
            if changed_title or fresh
            else CandidateRecheckReason.CANDIDATE_MISSING
        )
    candidate = fresh[0]
    # Website is a source fact that may legitimately change; identity may not.
    if any(
        getattr(candidate, field) != getattr(expected, field)
        for field in (
            "stable_id",
            "race_id",
            "office_code",
            "candidate_code",
            "office_title",
            "county_name",
            "name",
            "party_name",
            "is_joint_ticket",
        )
    ):
        raise CandidateRecheckUnavailable(CandidateRecheckReason.IDENTITY_MISMATCH)
    return VerifiedCandidateRecheck(candidate, catalogue, original)
