"""Strict offline reads of SOS result files, without inferring certified outcomes.

The published 2026 layout calls column 3 a precinct name; the original files
contain precinct IDs. Keep that ID and resolve its name from PrctTbl separately.
Candidate IDs are not globally unique: a county and election are part of identity.
"""

from __future__ import annotations

import hashlib
import re
from collections import defaultdict
from dataclasses import asdict, dataclass
from datetime import date, datetime
from decimal import Decimal
from typing import Literal
from urllib.parse import urlparse

from alethical.pipeline.candidate_catalogue import CandidateCatalogue


class ElectionResultsError(ValueError):
    """Invalid or conflicting source data, never a successful empty result."""


def _require(condition: bool, message: str) -> None:
    if not condition:
        raise ElectionResultsError(message)


@dataclass(frozen=True)
class ResultRow:
    row_number: int
    raw_row: str
    state: str
    county_id: str
    precinct_id: str
    office_id: str
    office_name: str
    district: str
    candidate_order_code: str
    candidate_name: str
    suffix: str
    incumbent_code: str
    party: str
    precincts_reporting: int
    precincts_expected: int
    votes: int
    vote_percentage: str
    total_votes: int
    is_write_in_aggregate: bool


@dataclass(frozen=True)
class ResultSnapshot:
    election_id: str
    election_date: date
    source_url: str
    source_sha256: str
    source_bytes: bytes
    fetched_at: datetime
    source_stage: Literal["real", "test", "unverified"]
    source_status: Literal["unofficial"]
    status_evidence_url: str
    status_evidence_sha256: str
    geography: Literal["precinct", "county", "race"]
    rows: tuple[ResultRow, ...]


def parse_result_file(
    body: bytes,
    *,
    election_id: str,
    election_date: date,
    source_url: str,
    fetched_at: datetime,
    source_stage: Literal["real", "test", "unverified"],
    source_status: Literal["unofficial"],
    status_evidence_url: str,
    status_evidence_sha256: str,
    geography: Literal["precinct", "county", "race"],
    encoding: Literal["windows-1252", "utf-8"] = "windows-1252",
) -> ResultSnapshot:
    """Parse a retained file; real-source admission is a separate explicit step.

    The caller retains the exact status evidence matching its hash. A date,
    filename, lead, checkmark or completed precinct count never certifies a race.
    This initial reader refuses certified status; a future certification layer
    must validate exact-race certification evidence independently.
    """
    _require(
        isinstance(body, bytes) and 0 < len(body) <= 100_000_000,
        "empty or oversized source",
    )
    _require(
        bool(re.fullmatch(r"[A-Za-z0-9_-]{1,80}", election_id)), "invalid election ID"
    )
    parsed_url = urlparse(source_url)
    _require(
        parsed_url.scheme == "https"
        and parsed_url.netloc == "electionresultsfiles.sos.mn.gov"
        and bool(
            re.fullmatch(
                rf"/{election_date:%Y%m%d}/[A-Za-z0-9_-]+\.txt", parsed_url.path
            )
        )
        and not parsed_url.query
        and not parsed_url.fragment,
        "source URL must identify this election's official result file",
    )
    _require(
        fetched_at.tzinfo is not None and fetched_at.utcoffset() is not None,
        "fetched_at needs a timezone",
    )
    _require(source_stage in ("real", "test", "unverified"), "invalid source stage")
    _require(
        source_status == "unofficial",
        "certified outcomes require separate exact-race evidence",
    )
    evidence_url = urlparse(status_evidence_url)
    _require(
        evidence_url.scheme == "https"
        and evidence_url.netloc
        in ("www.sos.mn.gov", "sos.mn.gov", "electionresults.sos.mn.gov"),
        "status evidence must be an official source",
    )
    _require(
        bool(re.fullmatch(r"[a-f0-9]{64}", status_evidence_sha256)),
        "status evidence needs its retained SHA256",
    )
    _require(geography in ("precinct", "county", "race"), "invalid geography")
    _require(encoding in ("windows-1252", "utf-8"), "unsupported encoding")
    try:
        text = body.decode(encoding, errors="strict")
    except UnicodeDecodeError as error:
        raise ElectionResultsError(
            "source does not use its declared encoding"
        ) from error
    _require(
        not re.search(r"[\x00-\x09\x0b\x0c\x0e-\x1f\x7f-\x9f]", text),
        "source contains control characters",
    )
    result = []
    identities: set[tuple[str, ...]] = set()
    for number, raw in enumerate(text.splitlines(), 1):
        fields = raw.split(";")
        _require(len(fields) == 16, f"row {number}: expected 16 columns")
        _require(all(v == v.strip() for v in fields), f"row {number}: padded field")
        (
            state,
            county,
            precinct,
            office,
            title,
            district,
            order,
            name,
            suffix,
            incumbent,
            party,
        ) = fields[:11]
        _require(state == "MN", f"row {number}: unexpected state")
        _require(
            bool(re.fullmatch(r"[0-9]{4}", office))
            and bool(re.fullmatch(r"[0-9]{4}", order)),
            f"row {number}: invalid office or order code",
        )
        _require(bool(title and name and party), f"row {number}: missing identity")
        if geography in ("precinct", "county"):
            _require(
                bool(re.fullmatch(r"[0-9]{2}", county)) and 1 <= int(county) <= 87,
                f"row {number}: invalid county",
            )
        else:
            _require(
                not county, f"row {number}: race summary must not contain a county"
            )
        _require(
            bool(re.fullmatch(r"[0-9]{4}", precinct))
            if geography == "precinct"
            else not precinct,
            f"row {number}: invalid precinct scope",
        )
        for i in (11, 12, 13, 15):
            _require(
                bool(re.fullmatch(r"[0-9]+", fields[i])),
                f"row {number}: missing or invalid integer in column {i + 1}",
            )
        reporting, expected, votes, total = (int(fields[i]) for i in (11, 12, 13, 15))
        _require(
            reporting <= expected and votes <= total,
            f"row {number}: conflicting counts",
        )
        if geography == "precinct":
            _require(
                expected == 1, f"row {number}: precinct row must describe 1 precinct"
            )
        _require(
            bool(re.fullmatch(r"[0-9]+(?:\.[0-9]+)?", fields[14]))
            and Decimal(fields[14]) <= 100,
            f"row {number}: invalid vote percentage",
        )
        _require(
            (order == "9901") == (name == "WRITE-IN"),
            f"row {number}: conflicting write-in identity",
        )
        identity = (county, precinct, office, title, district, order)
        _require(
            identity not in identities,
            f"row {number}: duplicate or conflicting candidate identity",
        )
        identities.add(identity)
        result.append(
            ResultRow(
                number,
                raw,
                state,
                county,
                precinct,
                office,
                title,
                district,
                order,
                name,
                suffix,
                incumbent,
                party,
                reporting,
                expected,
                votes,
                fields[14],
                total,
                order == "9901",
            )
        )
    _require(bool(result), "source contains no result rows")
    return ResultSnapshot(
        election_id,
        election_date,
        source_url,
        hashlib.sha256(body).hexdigest(),
        body,
        fetched_at,
        source_stage,
        source_status,
        status_evidence_url,
        status_evidence_sha256,
        geography,
        tuple(result),
    )


def snapshot_document(snapshot: ResultSnapshot) -> dict:
    """JSON-ready metadata and rows; retain original bytes in source storage."""
    return {
        "election_id": snapshot.election_id,
        "election_date": snapshot.election_date.isoformat(),
        "source_url": snapshot.source_url,
        "source_sha256": snapshot.source_sha256,
        "fetched_at": snapshot.fetched_at.isoformat(),
        "source_stage": snapshot.source_stage,
        "source_status": snapshot.source_status,
        "status_evidence_url": snapshot.status_evidence_url,
        "status_evidence_sha256": snapshot.status_evidence_sha256,
        "geography": snapshot.geography,
        "rows": [asdict(row) for row in snapshot.rows],
    }


def build_races(
    snapshot: ResultSnapshot,
    catalogue: CandidateCatalogue,
    *,
    summary: ResultSnapshot | None = None,
) -> dict:
    """Join exact SOS candidate identities, retaining unresolved coverage.

    Supports federal/state/county candidate registers only. Hospital and other
    local geography need their own reconciliation; unsupported input fails closed.
    Precinct/result sources are independently versioned; a mismatch is a reported
    gap, not a reason to silently choose or combine differing source versions.
    """
    _require(
        snapshot.source_stage == "real",
        "test or unverified results cannot build public races",
    )
    _require(
        snapshot.geography == "precinct", "race building requires precinct results"
    )
    _require(
        catalogue.election.source_kind == "cand",
        "local race geography is not yet reconciled",
    )
    _require(
        catalogue.election.source_stage != "test",
        "test candidate register cannot build public races",
    )
    _require(
        catalogue.election.election_id == snapshot.election_id
        and catalogue.election.election_date == snapshot.election_date,
        "candidate register belongs to another election",
    )
    if summary is not None:
        _require(
            summary.source_stage == "real"
            and summary.geography in ("county", "race")
            and summary.election_id == snapshot.election_id
            and summary.election_date == snapshot.election_date,
            "summary scope does not match results",
        )

    roster: dict[tuple[str, str], list] = defaultdict(list)
    for candidate in catalogue.candidates:
        _require(
            candidate.candidate_id[:4] == candidate.office_id,
            "candidate ID does not identify its office",
        )
        roster[(candidate.county_id, candidate.office_id)].append(candidate)

    # Some contests have no named candidates in cand.txt but do have a sourced
    # write-in aggregate. Keep the contest without inventing a candidate/person.
    unregistered: dict[tuple[str, str], list[ResultRow]] = defaultdict(list)
    for row in snapshot.rows:
        key = (row.county_id, row.office_id)
        if key not in roster and ("88", row.office_id) not in roster:
            unregistered[key].append(row)
    for key, entries in unregistered.items():
        if all(r.is_write_in_aggregate for r in entries):
            _require(
                len({(r.office_name, r.district) for r in entries}) == 1,
                "unregistered write-in contest has conflicting scope",
            )
            roster[key] = []

    def assign(rows: tuple[ResultRow, ...]) -> tuple[dict, list]:
        grouped: dict[tuple[str, str], list] = defaultdict(list)
        excluded = []
        for row in rows:
            key = (row.county_id, row.office_id)
            if key not in roster:
                key = ("88", row.office_id)
            if key not in roster:
                excluded.append(
                    {
                        "row_number": row.row_number,
                        "office_id": row.office_id,
                        "office_name": row.office_name,
                        "reason": "ballot_question"
                        if row.candidate_name in ("YES", "NO", "ESTIMATED BLANKS")
                        and row.party == "NP"
                        else "no_candidate_race_in_register",
                    }
                )
                continue
            grouped[key].append(row)
        return grouped, excluded

    grouped, exclusions = assign(snapshot.rows)
    summaries, summary_exclusions = assign(summary.rows) if summary else ({}, [])
    races = []
    for (county, office), candidates in sorted(roster.items()):
        race_rows = grouped.get((county, office), [])
        summary_rows = summaries.get((county, office), [])
        errors = []
        by_order = {c.candidate_id[-4:]: c for c in candidates}
        _require(
            len(by_order) == len(candidates), "conflicting registered candidate order"
        )
        title = candidates[0].office_title if candidates else race_rows[0].office_name
        by_precinct: dict[tuple[str, str], list] = defaultdict(list)
        candidate_rows: dict[str, list] = defaultdict(list)
        for row in race_rows:
            candidate = by_order.get(row.candidate_order_code)
            if row.office_name != title or (
                not row.is_write_in_aggregate
                and (
                    candidate is None
                    or candidate.name != row.candidate_name
                    or candidate.party_abbreviation != row.party
                )
            ):
                errors.append(
                    f"Result row {row.row_number} conflicts with candidate register"
                )
            by_precinct[(row.county_id, row.precinct_id)].append(row)
            candidate_rows[row.candidate_order_code].append(row)
        for precinct, entries in sorted(by_precinct.items()):
            if set(by_order) - {r.candidate_order_code for r in entries}:
                errors.append(
                    f"Missing registered candidate at precinct {precinct[0]}:{precinct[1]}"
                )
            if (
                len({r.total_votes for r in entries}) != 1
                or sum(r.votes for r in entries) != entries[0].total_votes
            ):
                errors.append(
                    f"Candidate votes do not equal total at precinct {precinct[0]}:{precinct[1]}"
                )
            if (
                len({(r.precincts_reporting, r.precincts_expected) for r in entries})
                != 1
            ):
                errors.append(
                    f"Conflicting reporting counts at precinct {precinct[0]}:{precinct[1]}"
                )
        expected = reported = None
        if summary_rows:
            summary_areas: dict[str, list] = defaultdict(list)
            for row in summary_rows:
                summary_areas[row.county_id].append(row)
            expected = sum(
                rows[0].precincts_expected for rows in summary_areas.values()
            )
            reported = sum(
                rows[0].precincts_reporting for rows in summary_areas.values()
            )
            for area, entries in summary_areas.items():
                area_precincts = [
                    precinct_rows
                    for (precinct_county, _), precinct_rows in by_precinct.items()
                    if not area or precinct_county == area
                ]
                if (
                    len(area_precincts) != entries[0].precincts_expected
                    or sum(rows[0].precincts_reporting for rows in area_precincts)
                    != entries[0].precincts_reporting
                ):
                    errors.append(
                        f"Precinct reporting does not reconcile for area {area or 'race'}"
                    )
                if (
                    len(
                        {
                            (r.precincts_reporting, r.precincts_expected, r.total_votes)
                            for r in entries
                        }
                    )
                    != 1
                ):
                    errors.append(
                        f"Conflicting summary counts for area {area or 'race'}"
                    )
                if set(by_order) - {r.candidate_order_code for r in entries}:
                    errors.append(
                        f"Missing registered candidate in summary area {area or 'race'}"
                    )
            summary_keys = set()
            for row in summary_rows:
                key = (row.county_id, row.candidate_order_code)
                summary_keys.add(key)
                inputs = [
                    r
                    for r in candidate_rows[row.candidate_order_code]
                    if not row.county_id or r.county_id == row.county_id
                ]
                if (
                    not inputs
                    or any(
                        r.candidate_name != row.candidate_name
                        or r.party != row.party
                        or r.office_name != row.office_name
                        or r.district != row.district
                        for r in inputs
                    )
                    or sum(r.votes for r in inputs) != row.votes
                ):
                    errors.append(
                        f"Precinct votes do not reconcile with summary row {row.row_number}"
                    )
            for row in race_rows:
                if (
                    row.county_id if summary and summary.geography == "county" else "",
                    row.candidate_order_code,
                ) not in summary_keys:
                    errors.append(
                        f"Result row {row.row_number} has no summary counterpart"
                    )
            if len(by_precinct) != expected:
                errors.append("Held precinct count differs from expected count")
        else:
            errors.append("No matching summary supplied")
        if not race_rows:
            errors.append("No precinct results held")
        choices = []
        for order in sorted(set(by_order) | set(candidate_rows)):
            candidate = by_order.get(order)
            entries = candidate_rows.get(order, [])
            choices.append(
                {
                    "candidate_id": candidate.candidate_id if candidate else None,
                    "candidate_stable_id": candidate.stable_id if candidate else None,
                    "candidate_order_code": order,
                    "name": candidate.name if candidate else entries[0].candidate_name,
                    "party": candidate.party_abbreviation
                    if candidate
                    else entries[0].party,
                    "is_write_in_aggregate": order == "9901",
                    "votes": sum(r.votes for r in entries) if entries else None,
                    "source_rows": [r.row_number for r in entries],
                    "outcome": None,
                }
            )
        races.append(
            {
                "race_id": f"election:{snapshot.election_id}:jurisdiction:{county}:office:{office}",
                "election_id": snapshot.election_id,
                "office_id": office,
                "office_name": title,
                "jurisdiction_id": county,
                "jurisdiction_kind": "statewide_or_multicounty"
                if county == "88"
                else "county",
                "district": candidates[0].district_code
                if candidates
                else race_rows[0].district,
                "roster_state": "registered_candidates"
                if candidates
                else "no_named_candidates_in_register",
                "source_status": "unofficial",
                "source_sha256": snapshot.source_sha256,
                "candidate_source_sha256": catalogue.source_sha256,
                "summary_source_sha256": summary.source_sha256 if summary else None,
                "candidates": choices,
                "precinct_rows": [asdict(row) for row in race_rows],
                "coverage": {
                    "held_precincts": len(by_precinct),
                    "expected_precincts": expected,
                    "reporting_precincts": reported,
                    "reconciled": bool(race_rows and summary_rows and not errors),
                    "errors": list(dict.fromkeys(errors)),
                },
            }
        )
    return {
        "races": races,
        "excluded_rows": exclusions,
        "excluded_summary_rows": summary_exclusions,
    }


def build_local_races(
    snapshot: ResultSnapshot,
    catalogue: CandidateCatalogue,
    *,
    summaries: tuple[ResultSnapshot, ...],
    precinct_municipalities: dict[tuple[str, str], str],
    precinct_register_sha256: str,
) -> dict:
    """Reconcile local races without equating hospital IDs with municipal FIPS.

    Local summary keys preserve office, complete title and jurisdiction. Where
    a hospital's municipality seat uses a different ID domain, the exact official
    precinct register supplies its municipality ID. Every original row survives.
    """
    _require(
        snapshot.source_stage == "real" and snapshot.geography == "precinct",
        "local builder requires real precinct returns",
    )
    _require(
        catalogue.election.source_kind == "local_cand"
        and catalogue.election.source_stage != "test"
        and catalogue.election.election_id == snapshot.election_id
        and catalogue.election.election_date == snapshot.election_date,
        "local candidate scope does not match results",
    )
    _require(bool(summaries), "local summaries are required")
    _require(
        bool(re.fullmatch(r"[a-f0-9]{64}", precinct_register_sha256)),
        "official precinct register fingerprint is required",
    )

    def norm(value: str) -> str:
        _require(
            value.isdigit(), "local jurisdiction must be a numeric source identifier"
        )
        return str(int(value))

    def key(row: ResultRow, district: str | None = None) -> tuple[str, str, str]:
        return (
            row.office_id,
            row.office_name,
            norm(row.district if district is None else district),
        )

    summary_groups = defaultdict(dict)
    summary_refs = defaultdict(list)
    for summary in summaries:
        _require(
            summary.source_stage == "real"
            and summary.geography == "race"
            and summary.election_id == snapshot.election_id
            and summary.election_date == snapshot.election_date,
            "local summary scope does not match returns",
        )
        for row in summary.rows:
            group = key(row)
            previous = summary_groups[group].get(row.candidate_order_code)
            _require(
                previous is None or previous.raw_row == row.raw_row,
                "conflicting duplicate local summary",
            )
            summary_groups[group][row.candidate_order_code] = row
            summary_refs[(group, row.candidate_order_code)].append(
                {
                    "source_sha256": summary.source_sha256,
                    "row_number": row.row_number,
                }
            )
    grouped = defaultdict(list)
    bridge = defaultdict(list)
    for row in snapshot.rows:
        _require(
            (row.county_id, row.precinct_id) in precinct_municipalities,
            "local result precinct absent from official register",
        )
        group = key(row)
        choices = []
        if row.candidate_order_code in summary_groups.get(group, {}):
            choices.append(group)
        if "Hospital District" in row.office_name:
            municipal = key(
                row, precinct_municipalities[(row.county_id, row.precinct_id)]
            )
            if municipal != group and row.candidate_order_code in summary_groups.get(
                municipal, {}
            ):
                choices.append(municipal)
        _require(
            len(choices) == 1, "local result has missing or ambiguous summary geography"
        )
        resolved = choices[0]
        grouped[resolved].append(row)
        if resolved != group:
            bridge[resolved].append(
                {
                    "row_number": row.row_number,
                    "county_id": row.county_id,
                    "precinct_id": row.precinct_id,
                    "hospital_district_id": row.district,
                    "municipality_fips": precinct_municipalities[
                        (row.county_id, row.precinct_id)
                    ],
                    "precinct_register_sha256": precinct_register_sha256,
                }
            )

    roster = defaultdict(dict)
    unmatched_roster = []
    for candidate in catalogue.candidates:
        _require(
            candidate.candidate_id[5:9] == candidate.office_id,
            "local candidate ID conflicts with office",
        )
        explicit_geo = candidate.school_district_number or candidate.municipal_fips_code
        matches = []
        for group, entries in summary_groups.items():
            if group[:2] != (candidate.office_id, candidate.office_title):
                continue
            if explicit_geo:
                if norm(explicit_geo) != group[2]:
                    continue
            elif candidate.county_id not in {r.county_id for r in grouped[group]}:
                continue
            matches.append(group)
        _require(len(matches) <= 1, "local candidate has ambiguous race geography")
        if not matches:
            unmatched_roster.append(
                {
                    "candidate_stable_id": candidate.stable_id,
                    "row_number": candidate.row_number,
                    "reason": "no_exact_local_result_jurisdiction",
                }
            )
            continue
        group = matches[0]
        order = candidate.candidate_id[-4:]
        _require(order not in roster[group], "duplicate local candidate order in race")
        roster[group][order] = candidate

    races, questions = [], []
    for group, entries in sorted(summary_groups.items()):
        office, title, district = group
        rows = grouped[group]
        is_question = all(
            r.candidate_name in {"YES", "NO", "ESTIMATED BLANKS"} and r.party == "NP"
            for r in entries.values()
        )
        if is_question:
            questions.append(
                {
                    "office_id": office,
                    "office_name": title,
                    "district": district,
                    "reason": "ballot_question",
                    "source_sha256": snapshot.source_sha256,
                    "row_numbers": [r.row_number for r in rows],
                    "summary_sources": [
                        ref for order in entries for ref in summary_refs[(group, order)]
                    ],
                }
            )
            continue
        _require(
            not any(
                r.candidate_name in {"YES", "NO", "ESTIMATED BLANKS"}
                for r in entries.values()
            ),
            "local race mixes candidates with ballot responses",
        )
        by_order = roster[group]
        errors = []
        by_precinct, candidate_rows = defaultdict(list), defaultdict(list)
        for row in rows:
            by_precinct[(row.county_id, row.precinct_id)].append(row)
            candidate_rows[row.candidate_order_code].append(row)
        representative = next(iter(entries.values()))
        summary_counts = {
            (r.precincts_expected, r.precincts_reporting, r.total_votes)
            for r in entries.values()
        }
        if (
            len(summary_counts) != 1
            or sum(r.votes for r in entries.values()) != representative.total_votes
        ):
            errors.append("Local summary candidate totals or reporting counts conflict")
        if (
            representative.precincts_expected <= 0
            or len(by_precinct) != representative.precincts_expected
        ):
            errors.append(
                "Local held precinct count differs from positive expected count"
            )
        if (
            sum(v[0].precincts_reporting for v in by_precinct.values())
            != representative.precincts_reporting
        ):
            errors.append("Local precinct reporting differs from summary")
        for precinct, precinct_rows in by_precinct.items():
            if len({r.candidate_order_code for r in precinct_rows}) != len(
                precinct_rows
            ):
                errors.append(f"Duplicate local candidate at precinct {precinct}")
            if {r.candidate_order_code for r in precinct_rows} != set(entries):
                errors.append(f"Local candidate roster differs at precinct {precinct}")
            if (
                len(
                    {
                        (r.total_votes, r.precincts_reporting, r.precincts_expected)
                        for r in precinct_rows
                    }
                )
                != 1
                or sum(r.votes for r in precinct_rows) != precinct_rows[0].total_votes
            ):
                errors.append(f"Local precinct totals conflict at {precinct}")
        choices = []
        for order in sorted(set(entries) | set(by_order)):
            candidate = by_order.get(order)
            summary_row = entries.get(order)
            inputs = candidate_rows[order]
            if summary_row is None:
                errors.append(
                    f"Local registered candidate {order} missing from returns"
                )
            elif (
                not inputs
                or sum(r.votes for r in inputs) != summary_row.votes
                or any(
                    (r.candidate_name, r.party)
                    != (summary_row.candidate_name, summary_row.party)
                    for r in inputs
                )
            ):
                errors.append(
                    f"Local candidate {order} differs between precinct and summary"
                )
            write_in = order == "9901"
            if not write_in and (
                candidate is None
                or summary_row is None
                or candidate.name != summary_row.candidate_name
                or summary_row.party != "NP"
            ):
                errors.append(f"Local candidate {order} does not match named register")
            choices.append(
                {
                    "candidate_id": candidate.candidate_id if candidate else None,
                    "candidate_stable_id": candidate.stable_id if candidate else None,
                    "candidate_order_code": order,
                    "name": candidate.name if candidate else summary_row.candidate_name,
                    "party": summary_row.party if summary_row else None,
                    "is_write_in_aggregate": write_in,
                    "votes": sum(r.votes for r in inputs) if inputs else None,
                    "source_rows": [r.row_number for r in inputs],
                    "summary_sources": summary_refs[(group, order)],
                    "candidate_source_row": candidate.row_number if candidate else None,
                    "outcome": None,
                }
            )
        kind = (
            "school_district"
            if "School " in title
            else "hospital_district"
            if "Hospital District" in title
            else "municipality"
        )
        if bridge[group]:
            kind = "hospital_municipal_seat"
        seat_match = re.search(r"\(Elect ([1-9][0-9]*)\)", title)
        seats = int(seat_match.group(1)) if seat_match else None
        races.append(
            {
                "race_id": f"election:{snapshot.election_id}:local:{kind}:{district}:office:{office}:title:{title}",
                "election_id": snapshot.election_id,
                "office_id": office,
                "office_name": title,
                "jurisdiction_id": f"{kind}:{district}",
                "jurisdiction_kind": kind,
                "district": district,
                "county_ids": sorted({r.county_id for r in rows}),
                "seats_to_elect": seats,
                "seats_source": "office_title" if seats else None,
                "roster_state": "registered_candidates"
                if by_order
                else "no_named_candidates_in_register",
                "source_status": "unofficial",
                "source_sha256": snapshot.source_sha256,
                "candidate_source_sha256": catalogue.source_sha256,
                "summary_source_sha256": summary_refs[
                    (group, representative.candidate_order_code)
                ][0]["source_sha256"],
                "summary_source_sha256s": sorted(
                    {
                        ref["source_sha256"]
                        for order in entries
                        for ref in summary_refs[(group, order)]
                    }
                ),
                "geography_bridge": bridge[group],
                "candidates": choices,
                "precinct_rows": [asdict(row) for row in rows],
                "coverage": {
                    "held_precincts": len(by_precinct),
                    "expected_precincts": representative.precincts_expected,
                    "reporting_precincts": representative.precincts_reporting,
                    "reconciled": bool(rows and not errors),
                    "errors": list(dict.fromkeys(errors)),
                },
            }
        )
    return {
        "races": races,
        "excluded_rows": [
            {
                "source_sha256": question["source_sha256"],
                "row_number": number,
                "office_id": question["office_id"],
                "office_name": question["office_name"],
                "district": question["district"],
                "reason": "ballot_question",
            }
            for question in questions
            for number in question["row_numbers"]
        ],
        "excluded_summary_rows": [
            {
                **ref,
                "office_id": question["office_id"],
                "office_name": question["office_name"],
                "district": question["district"],
                "reason": "ballot_question",
            }
            for question in questions
            for ref in question["summary_sources"]
        ],
        "unmatched_roster": unmatched_roster,
        "source_counts": {
            "precinct_rows": len(snapshot.rows),
            "summary_choice_groups": sum(len(v) for v in summary_groups.values()),
            "candidate_races": len(races),
            "ballot_questions": len(questions),
            "municipality_bridge_rows": sum(len(v) for v in bridge.values()),
        },
    }
