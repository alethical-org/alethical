"""Public candidate rosters for voting areas established for November 3, 2026.

A precinct return includes contests for every ballot style used in that precinct.
Its presence alone cannot put a school, ward or special-district contest on a
reader's ballot. Only positively identified constituencies are projected here.
"""

from __future__ import annotations

from collections import defaultdict
from datetime import date, datetime
import re
from typing import TYPE_CHECKING
from zoneinfo import ZoneInfo

from sqlalchemy import select, text
from sqlalchemy.orm import Session

from alethical.api.services.candidate_lookup import (
    BALLOT_HOME,
    _area as saved_ballot_area,
)
from alethical.db import models as m
from alethical.pipeline.candidate_ballot import (
    AUTHORITY,
    BallotRace,
    ballot_identity,
    ballot_jurisdiction,
)
from alethical.pipeline.candidate_catalogue import STATEWIDE_TITLES, legislative_seat
from alethical.pipeline.election_comparison import digest

if TYPE_CHECKING:
    from alethical.api.services.candidate_historical_geography import (
        HistoricalGeography,
    )

ELECTION_KEY = "mn-2026-11-03-general"
ELECTION_DATE = date(2026, 11, 3)
ELECTION_ID = "8334"
RESULTS_URL = "https://electionresults.sos.mn.gov/Results/Index?ersElectionId=201"
# Minnesota's election-day party register:
# https://electionresultsfiles.sos.mn.gov/20261103/PartyTbl.txt
_PARTIES = {
    "R": "Republican",
    "DFL": "Democratic-Farmer-Labor",
    "FI": "Forward Independence",
    "GP": "Green",
    "IND": "Independent",
    "LIB": "Libertarian",
    "UNI": "United New Independence",
    "NP": "Nonpartisan",
}
_COUNTY_OFFICES = {
    "County Attorney",
    "County Auditor",
    "County Auditor/Treasurer",
    "County Recorder",
    "County Sheriff",
    "County Surveyor",
    "County Treasurer",
}
# Match the complete office part. A section, district or named neighbourhood
# that we cannot resolve must never become municipality-wide by default.
_MUNICIPAL_OFFICE = re.compile(
    r"(?:Mayor|Council Member(?: At Large| Seat [A-Z0-9]+)?|"
    r"(?:City|Town) (?:Clerk(?: - Treasurer)?|Treasurer)|"
    r"Town Supervisor(?: At Large| Seat [A-Z0-9]+)?)"
)
_STATE_COURTS = re.compile(
    r"(?:Associate Justice - Supreme Court|Judge - Court of Appeals) [0-9]+"
)
_SCHOOL_OFFICE = re.compile(
    r"School Board Member(?: At Large| Position [0-9]+)? \((ISD|SSD|CSD) #([0-9]+)\)"
)


def _code(value: str | None) -> str | None:
    if not value:
        return None
    return value.lstrip("0") or "0"


def _area(
    title: str, kind: str, jurisdiction: str, county_name: str, geo: HistoricalGeography
) -> tuple[str, str] | None:
    """Return a group and voting-area label only when the checked geography agrees."""
    title = re.sub(r" \(Elect [1-9][0-9]*\)$", "", title).removeprefix(
        "Special Election for "
    )
    if kind == "statewide_or_multicounty" and jurisdiction == "88":
        if (
            title in STATEWIDE_TITLES
            or title == "U.S. Senator"
            or _STATE_COURTS.fullmatch(title)
        ):
            return "state", "Minnesota"
        seat = legislative_seat(title)
        if seat:
            chamber, district = seat
            value = geo.house_district if chamber == "house" else geo.senate_district
            if _code(value) == district:
                return "state", f"{chamber.capitalize()} District {district}"
        congress = re.fullmatch(r"U\.S\. Representative District ([0-9]+)", title)
        if congress and _code(geo.congressional_district) == congress[1]:
            return "state", f"Congressional District {congress[1]}"
        court = re.fullmatch(
            r"Judge - (([0-9]+)(?:st|nd|rd|th)) District Court [0-9]+", title
        )
        if court and _code(geo.judicial_district) == court[2]:
            return "state", f"Judicial District {court[1]}"
    if kind == "county" and jurisdiction == geo.county_code:
        if title in _COUNTY_OFFICES:
            return "county", f"{county_name} County"
        commissioner = re.fullmatch(r"County Commissioner District ([0-9]+)", title)
        if commissioner and _code(geo.commissioner_district) == commissioner[1]:
            return "county", f"{county_name} County · District {commissioner[1]}"
        soil = re.fullmatch(
            r"Soil and Water Supervisor District ([0-9]+)(?: \((East|West|North|South)\))?",
            title,
        )
        if soil and geo.soil_water_district and geo.soil_water_name:
            # Minnesota Statutes 103C.311: supervisor seats can be elected by
            # the entire conservation district or by a district of whole
            # precincts. The election map names that voting area (Crow Wing
            # versus Dakota District 2); the seat number alone does not.
            regions = {county_name}
            if soil[2]:
                regions = {f"{soil[2]} {county_name}", f"{county_name} {soil[2]}"}
            areas = regions | {f"{region} District {soil[1]}" for region in regions}
            if geo.soil_water_name in areas:
                return "county", f"{geo.soil_water_name} · Soil and Water"
        park = re.fullmatch(r"County Park Commissioner District ([0-9]+)", title)
        if (
            park
            and geo.park_name == "Three Rivers Park District"
            and _code(geo.park_district) == park[1]
        ):
            return "county", f"{geo.park_name} · District {park[1]}"
    if kind == "hospital_district":
        hospital = re.fullmatch(
            r"Hospital District Board Member [Aa]t Large \(([^()]+)\)", title
        )
        if (
            hospital
            and geo.hospital_district
            and geo.hospital_name == hospital[1]
            and jurisdiction == f"hospital_district:{_code(geo.hospital_district)}"
        ):
            return "other", f"{geo.hospital_name} Hospital District"
    if kind == "school_district":
        school = _SCHOOL_OFFICE.fullmatch(title)
        if (
            school
            and school[1] == geo.school_type
            and _code(school[2]) == _code(geo.school_district)
            and jurisdiction == f"school_district:{_code(school[2])}"
        ):
            return "school", f"{school[1]} #{school[2]} · Whole district"
    if (
        kind == "municipality"
        and jurisdiction == f"municipality:{_code(geo.municipality_code)}"
    ):
        municipality = re.fullmatch(r"(.+) \(([^()]+)\)", title)
        if municipality:
            office, place = municipality.groups()
            if _MUNICIPAL_OFFICE.fullmatch(office):
                return "municipal", place
            ward = re.fullmatch(r"Council Member Ward ([A-Z0-9]+)", office)
            if ward and _code(geo.ward) == _code(ward[1]):
                return "municipal", f"{place} · Ward {ward[1]}"
    return None


_ProfileLink = tuple[str, str, dict, dict]


def _link_saved_profiles(db: Session, pending: dict[str, list[_ProfileLink]]) -> None:
    """Expose a profile only for the same official ballot identity and public record."""
    if not pending:
        return
    profiles = db.execute(
        select(m.CandidateRecord.id, m.CandidateRecord.public_payload).where(
            m.CandidateRecord.id.in_(pending.keys()),
            m.CandidateRecord.election_id == ELECTION_ID,
            m.CandidateRecord.election_date == ELECTION_DATE,
        )
    )
    for profile_id, profile in profiles:
        if len(pending[profile_id]) != 1:
            continue
        office, voting_area, person, entry = pending[profile_id][0]
        election, candidate, source = (
            profile["election"],
            profile["candidate"],
            profile["source"],
        )
        if (
            election.get("id") == ELECTION_ID
            and election.get("date") == ELECTION_DATE.isoformat()
            and election.get("type") == "general"
            and profile.get("office") == office
            and profile.get("votingArea") == voting_area
            and candidate.get("id") == profile_id
            and candidate.get("name") == person["name"]
            and (candidate.get("party") or "").casefold() == person["party"].casefold()
            and source.get("url") == BALLOT_HOME
            and source.get("authority") == AUTHORITY
        ):
            person.update(id=profile_id, profileAvailable=True)
            if entry["kind"] == "ticket":
                entry.update(id=profile_id, profileAvailable=True)


def historical_candidate_results(
    db: Session, *, address: str, geography: HistoricalGeography
) -> dict:
    """Read a single published returns snapshot. The address is never sent to storage."""
    snapshot = m.ElectionComparisonSnapshot
    current = m.ElectionComparisonCurrent
    held = db.execute(
        select(
            snapshot.id,
            snapshot.sources,
            snapshot.coverage["county_names"][geography.county_code].astext.label(
                "county_name"
            ),
        )
        .join(current, current.snapshot_id == snapshot.id)
        .where(
            current.election_key == ELECTION_KEY,
            snapshot.election_key == ELECTION_KEY,
            snapshot.election_date == ELECTION_DATE,
            snapshot.stage == "general",
            snapshot.first_published_at.is_not(None),
        )
    ).one_or_none()
    unavailable = {
        "kind": "historical-match-unavailable",
        "electionId": ELECTION_ID,
        "message": "We couldn’t confirm the races for this address and election",
        "officialResultsUrl": RESULTS_URL,
    }
    if held is None or not held.county_name:
        return unavailable
    # Extract only the roster fields. Statewide split totals, candidate source-row
    # inventories and financial records have no place in an address lookup.
    rows = db.execute(
        text("""
            SELECT r.id, r.label, r.jurisdiction, r.office_id,
                   r.payload->>'jurisdiction_kind' AS kind,
                   r.payload->>'candidate_source_sha256' AS source_hash,
                   c->>'candidate_stable_id' AS candidate_id, c->>'name' AS name,
                   c->>'party' AS party, c->>'candidate_order_code' AS candidate_code,
                   (c->>'is_write_in_aggregate')::boolean AS write_in
              FROM election_comparison_precinct p
              JOIN election_comparison_race r ON r.snapshot_id = p.snapshot_id AND r.id = p.race_id
              CROSS JOIN LATERAL jsonb_array_elements(r.payload->'candidates') c
             WHERE p.snapshot_id = :snapshot AND p.key = :precinct AND p.county = :county
               AND r.payload #>> '{coverage,reconciled}' = 'true'
             ORDER BY r.label, r.id, c->>'candidate_order_code'
        """),
        {
            "snapshot": held.id,
            "precinct": f"{geography.county_code}:{geography.precinct_code}",
            "county": geography.county_code,
        },
    )
    sources = {
        item["sha256"]: item
        for item in held.sources
        if item["file"] in {"cand.txt", "LocalCandTbl.txt"}
    }
    races: dict[str, dict] = {}
    saved_areas: dict[str, str] = {}
    pending_profiles: dict[str, list[_ProfileLink]] = defaultdict(list)
    school_unconfirmed = False
    for row in rows:
        area = _area(row.label, row.kind, row.jurisdiction, held.county_name, geography)
        source = sources.get(row.source_hash)
        if area is None:
            # The precinct may report multiple school districts. A proved different
            # district is expected. A missing district or unproved member seat is
            # a real coverage gap for the reader.
            if row.kind == "school_district":
                school = re.search(r"\((ISD|SSD|CSD) #([0-9]+)\)", row.label)
                if (
                    geography.school_type is None
                    or geography.school_district is None
                    or (
                        row.jurisdiction
                        == f"school_district:{_code(geography.school_district)}"
                        and (not school or school[1] == geography.school_type)
                    )
                ):
                    school_unconfirmed = True
            continue
        if source is None:
            continue
        if row.id not in races:
            office = re.sub(r" \(Elect [0-9]+\)$", "", row.label)
            checked = datetime.fromisoformat(source["fetched_at"]).astimezone(
                ZoneInfo("America/Chicago")
            )
            race = {
                "id": row.id,
                "group": area[0],
                "office": office,
                "votingArea": area[1],
                "entries": [],
                "source": {
                    "authority": AUTHORITY,
                    "url": source["url"],
                    "checkedDate": checked.date().isoformat(),
                    "retained": True,
                },
            }
            seat_count = re.search(r" \(Elect ([1-9][0-9]*)\)$", row.label)
            if seat_count:
                race["seatCount"] = int(seat_count[1])
            races[row.id] = race
            saved_areas[row.id] = saved_ballot_area(
                BallotRace(row.id, row.office_id, row.label, held.county_name, ())
            )
        if row.write_in or not row.candidate_id:
            continue
        # Preserve the results-register identity unless a saved MyBallot profile
        # agrees on both the official compound key and the displayed person.
        person = {
            "id": digest([row.id, row.candidate_id]),
            "name": row.name,
            "sortName": row.name,
            "profileAvailable": False,
        }
        if row.party:
            person["party"] = _PARTIES.get(row.party, row.party)
        if row.label == "Governor & Lt Governor":
            entry = {
                "kind": "ticket",
                "id": person["id"],
                "members": [person],
                "profileAvailable": False,
            }
            if row.party:
                entry["party"] = person["party"]
        else:
            entry = {"kind": "candidate", "candidate": person}
        races[row.id]["entries"].append(entry)
        if row.party in _PARTIES and re.fullmatch(r"[0-9]{4}", row.candidate_code):
            profile_id = ballot_identity(
                (
                    ELECTION_ID,
                    ELECTION_DATE.isoformat(),
                    ballot_jurisdiction(row.label, held.county_name),
                    row.office_id,
                    row.label,
                    row.candidate_code,
                )
            )
            pending_profiles[profile_id].append(
                (races[row.id]["office"], saved_areas[row.id], person, entry)
            )
    if not races:
        return unavailable
    _link_saved_profiles(db, pending_profiles)
    coverage = [
        {
            "kind": "coverage-unconfirmed",
            "office": "Some local offices may be missing",
            "authority": AUTHORITY,
            "url": RESULTS_URL,
        }
    ]
    if school_unconfirmed:
        coverage.insert(
            0,
            {
                "kind": "district-unconfirmed",
                "office": "school board",
                "authority": AUTHORITY,
                "url": RESULTS_URL,
            },
        )
    return {
        "kind": "results",
        "electionId": ELECTION_ID,
        "matchedAddress": address,
        "electionEnded": True,
        "resultsAvailable": False,
        "races": list(races.values()),
        "coverage": coverage,
    }
