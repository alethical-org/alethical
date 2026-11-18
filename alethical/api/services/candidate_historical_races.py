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
    r"School Board Member(?: At Large| Position [0-9]+| District ([0-9]+))? "
    r"\((ISD|SSD|CSD) #([0-9]+)\)"
)


# County:precinct codes named in the districts' own member-area descriptions,
# cross-checked against the 2026 SOS register. They apply only to the portion
# already verified to be inside this school district. In particular, Clara
# City spans several member districts and must not be assigned a single one.
_SCHOOL_MEMBER_PRECINCTS = {
    # Lake Superior's board identifies its constituent townships and wards:
    # https://www.isd381.k12.mn.us/district-information/school-board/
    "381": {
        "1": {"38:0040", "38:0050"},
        "2": {"38:0005", "38:0010", "38:0020", "38:0025", "38:0035", "38:0110"},
        "5": {"38:0090", "38:0105"},
        "7": {"69:0015", "69:0435"},
    },
    # Elk River district election map and 2026 voting instructions:
    # https://www.anokacountymn.gov/DocumentCenter/View/30222
    # https://www.isd728.org/about1/school-board/school-board-election-information
    "728": {
        "1": {
            "02:2405",
            "02:2705",
            "02:2710",
            "02:3005",
            "30:0075",
            # The former Baldwin Township incorporated as the City of Baldwin
            # (Minnesota municipal boundary adjustment I-75); precinct 2 was retained.
            "71:0005",
            "71:0025",
            "71:0045",
            "71:0050",
            "71:0055",
            "71:0070",
            "71:0075",
            "71:0110",
            "71:0111",
            "71:0130",
            "71:0135",
            "71:0140",
            "71:0150",
            "71:0155",
        },
        "2": {
            "27:0640",
            "27:0645",
            "27:2710",
            "27:2715",
            "27:2720",
            "71:0060",
            "71:0145",
            "86:0007",
            "86:0070",
            "86:0140",
            "86:0141",
            "86:0142",
            "86:0143",
            "86:0144",
            "86:0156",
        },
    },
    # St. Louis County Schools' April 26, 2022 districting resolution:
    # https://rst6-livesite.rschooltoday.com/sites/isd2142.net/files/files/Private_User/cmaschka/2022%20R%20Re-confirming%20SB%20Member%20Election%20Districts%202022Apr26.pdf
    "2142": {
        "2": {
            "69:0020",
            "69:0050",
            "69:0125",
            "69:0515",
            "69:0865",
            "69:0880",
            "69:0975",
            "69:0990",
            "69:0992",
            "69:1035",
        },
        "3": {"69:0065", "69:0437", "69:0585", "69:0765", "69:0940"},
        "5": {"69:0095", "69:0115", "69:0775", "69:0795", "69:0950"},
    },
    # MACCRAY April 19, 2022 redistricting resolution. The city of Raymond
    # has precincts in two counties. Neither is Raymond Township.
    # https://resources.finalsite.net/images/v1709024563/maccrayk12mnus/eqpw6j9r1xydq5h86rjc/4-19-2022agenda.pdf
    "2180": {
        "2": {"12:0030", "12:0065", "12:0120", "65:0175"},
        "4": {"12:0105"},
        "5": {"12:0100", "34:0135"},
    },
}


def _school_member_district(geo: HistoricalGeography) -> str | None:
    if geo.school_subdistrict:
        return _code(geo.school_subdistrict)
    if geo.school_type != "ISD" or not geo.school_district:
        return None
    key = f"{geo.county_code}:{geo.precinct_code}"
    for member, precincts in _SCHOOL_MEMBER_PRECINCTS.get(
        geo.school_district, {}
    ).items():
        if key in precincts:
            return member
    return None


def _code(value: str | None) -> str | None:
    if not value:
        return None
    return value.lstrip("0") or "0"


def _municipal_area(title: str, geo: HistoricalGeography) -> tuple[str, str] | None:
    match = re.fullmatch(r"(.+) \(([^()]+)\)", title)
    if not match:
        return None
    office, place = match.groups()
    if _MUNICIPAL_OFFICE.fullmatch(office):
        return "municipal", place
    # Austin Charter 10.01 and Blue Earth's city candidacy notice specify
    # citywide voting for these offices.
    if (geo.municipality_code, title) in {
        ("02908", "Utility Board Commissioner (Austin)"),
        ("06688", "Board of Public Works (Blue Earth)"),
        # Minnesota Laws 1998 ch. 389 art. 15, secs. 3-4: each city's
        # sanitary board representatives are elected at large within that city.
        ("20690", "Sanitary District Board Member (Farwell)"),
        ("32768", "Sanitary District Board Member (Kensington)"),
    }:
        return "municipal", place
    ward = _code((geo.ward or "").removeprefix("W-"))
    numbered = re.fullmatch(r"Council Member Ward ([A-Z0-9]+)", office)
    if numbered and ward == _code(numbered[1]):
        return "municipal", f"{place} · Ward {numbered[1]}"
    paired = re.fullmatch(r"Council Member Wards ([0-9]+) & ([0-9]+)", office)
    if paired and ward in paired.groups():
        return "municipal", f"{place} · Wards {paired[1]} & {paired[2]}"
    # These cities' 2026 elections guides identify their voting areas using
    # different words than the state's office titles.
    if geo.municipality_code == "54880" and place == "Rochester":
        district = re.fullmatch(r"Council Member District ([0-9]+)", office)
        if district and ward == district[1]:
            return "municipal", f"{place} · Ward {ward}"
    if geo.municipality_code == "23948" and place == "Glencoe":
        precinct = re.fullmatch(r"Council Member Precinct ([0-9]+)", office)
        if precinct and geo.precinct_name == f"GLENCOE CITY P-{precinct[1]}":
            return "municipal", f"{place} · Precinct {precinct[1]}"
    if (
        geo.municipality_code == "14158"
        and title == "Council Member Section II (Crystal)"
        and ward in {"3", "4"}
    ):
        return "municipal", "Crystal · Section II"
    return None


def _area(
    title: str,
    kind: str,
    jurisdiction: str,
    county_name: str,
    geo: HistoricalGeography,
    *,
    municipal_hospital_match: bool = False,
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
            # Houston County identifies Root River as its countywide voting area.
            if geo.county_code == "28" and county_name == "Houston":
                regions.add("Root River")
            if soil[2]:
                regions = {f"{soil[2]} {county_name}", f"{county_name} {soil[2]}"}
            areas = regions | {f"{region} District {soil[1]}" for region in regions}
            if geo.soil_water_name.casefold() in {area.casefold() for area in areas}:
                return "county", f"{geo.soil_water_name} · Soil and Water"
        park = re.fullmatch(r"County Park Commissioner District ([0-9]+)", title)
        if (
            park
            and geo.park_name == "Three Rivers Park District"
            and _code(geo.park_district) == park[1]
        ):
            return "county", f"{geo.park_name} · District {park[1]}"
    if (
        kind == "hospital_district"
        and geo.hospital_district
        and geo.hospital_name
        and jurisdiction == f"hospital_district:{_code(geo.hospital_district)}"
    ):
        hospital = re.fullmatch(
            r"Hospital District Board Member [Aa]t Large(?: (Itasca|Koochiching))? \(([^()]+)\)",
            title,
        )
        if hospital and geo.hospital_name == hospital[2]:
            if hospital[1] is None:
                return "other", f"{geo.hospital_name} Hospital District"
            if (
                geo.hospital_district == "1430"
                and geo.hospital_name == "Northern Itasca"
                and county_name == hospital[1]
            ):
                return (
                    "other",
                    f"Northern Itasca Hospital District · {county_name} County",
                )
        # Cook County Hospital District bylaws, article III, elect one member
        # from each county commissioner district.
        cook = re.fullmatch(
            r"Hospital District Board Member ([0-9]+) \(Cook County\)", title
        )
        if (
            cook
            and geo.hospital_district == "340"
            and geo.hospital_name == "Cook County"
            and geo.county_code == "16"
            and _code(geo.commissioner_district) == cook[1]
        ):
            return "other", f"Cook County Hospital District · District {cook[1]}"
        # Dean Lake is an unorganized territory with its own voting precinct
        # and board seat, not an incorporated municipality with a FIPS code.
        if (
            title == "Hospital District Board Member (Dean Lake)"
            and geo.hospital_district == "350"
            and geo.hospital_name == "Cuyuna Range"
            and (geo.county_code, geo.precinct_code, geo.precinct_name)
            == ("18", "0100", "DEAN LAKE PREC")
        ):
            return "other", "Cuyuna Range Hospital District · Dean Lake"
    if (
        kind == "hospital_municipal_seat"
        and municipal_hospital_match
        and geo.hospital_name
        and jurisdiction == f"hospital_municipal_seat:{_code(geo.municipality_code)}"
    ):
        seat = re.fullmatch(r"Hospital District Board Member \(([^()]+)\)", title)
        if seat:
            return "other", f"{geo.hospital_name} Hospital District · {seat[1]}"
    if kind == "school_district":
        # The district clerk's November 3 election notice places all three
        # GFW residence-area seats on the same district-wide ballot.
        if (
            jurisdiction == "school_district:2365"
            and geo.school_type == "ISD"
            and geo.school_district == "2365"
            and re.fullmatch(
                r"School Board Member (?:Gibbon|Fairfax|Winthrop) District \(ISD #2365\)",
                title,
            )
        ):
            return "school", "ISD #2365 · Whole district"
        school = _SCHOOL_OFFICE.fullmatch(title)
        if (
            school
            and school[2] == geo.school_type
            and _code(school[3]) == _code(geo.school_district)
            and jurisdiction == f"school_district:{_code(school[3])}"
        ):
            district = f"{school[2]} #{school[3]}"
            if not school[1]:
                return "school", f"{district} · Whole district"
            if _school_member_district(geo) == school[1]:
                return "school", f"{district} · District {school[1]}"
    if kind == "municipality":
        if jurisdiction == f"municipality:{_code(geo.municipality_code)}":
            return _municipal_area(title, geo)
        # The 2026 TIGER/Line place and county subdivision boundaries put all
        # of Calumet and Marble in Greenway Township. Minnesota election
        # returns record these township offices in both city precincts, too.
        if (
            geo.county_code == "31"
            and jurisdiction == "municipality:25892"
            and geo.municipality_code in {"09316", "40418"}
            and title
            in {
                "Town Clerk (Greenway Township)",
                "Town Supervisor Seat 3 (Greenway Township)",
            }
        ):
            return "municipal", "Greenway Township"
        if (
            geo.county_code == "31"
            and geo.municipality_code == "44980"
            and geo.township_code == "44998"
            and jurisdiction == "municipality:44998"
            and title
            in {
                "Town Clerk (Nashwauk Township)",
                "Town Supervisor Seat A (Nashwauk Township)",
            }
        ):
            return "municipal", "Nashwauk Township"
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
                   CASE WHEN r.payload->>'jurisdiction_kind' = 'hospital_municipal_seat' THEN
                       r.payload->'geography_bridge' @> jsonb_build_array(jsonb_build_object(
                           'county_id', p.county, 'precinct_id', split_part(p.key, ':', 2),
                           'hospital_district_id', CAST(:hospital AS text),
                           'municipality_fips', CAST(:municipality AS text)))
                   END AS municipal_hospital_match,
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
            "hospital": geography.hospital_district,
            "municipality": geography.municipality_code,
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
    unconfirmed_offices: set[str] = set()
    for row in rows:
        area = _area(
            row.label,
            row.kind,
            row.jurisdiction,
            held.county_name,
            geography,
            municipal_hospital_match=row.municipal_hospital_match,
        )
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
                        and (
                            _school_member_district(geography) is None
                            or not re.search(
                                r"School Board Member District [0-9]+ \(", row.label
                            )
                        )
                    )
                ):
                    unconfirmed_offices.add("school board")
            # The City of Nashwauk straddles three townships. Its precinct
            # also reports two Nashwauk Township seats.
            if (
                row.kind == "municipality"
                and row.jurisdiction == "municipality:44998"
                and geography.county_code == "31"
                and geography.municipality_code == "44980"
                and not geography.township_code
            ):
                unconfirmed_offices.add("Nashwauk Township offices")
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
    for office in sorted(unconfirmed_offices, reverse=True):
        coverage.insert(
            0,
            {
                "kind": "district-unconfirmed",
                "office": office,
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
