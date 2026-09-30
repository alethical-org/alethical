"""Strict, offline staging of SOS selected-election candidate files.

This is not a filing register or a publication mechanism. Source coverage is
unknown unless an operator supplies separate, election/hash-scoped evidence.
The SOS layout calls the file ASCII, but observed 2026 files contain single-byte
accented names. Encoding is explicit; decoding never guesses or replaces bytes.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import shutil
import tempfile
from dataclasses import asdict, dataclass
from datetime import date, datetime
from pathlib import Path
from typing import Literal

ElectionType = Literal["general", "primary", "special"]
SourceStage = Literal["test", "unverified"]
CoverageStatus = Literal["unknown", "incomplete", "complete"]
OfficeKind = Literal[
    "house",
    "senate",
    "governor",
    "secretary_of_state",
    "state_auditor",
    "attorney_general",
]
SUPPORTED_KINDS = (
    "house",
    "senate",
    "governor",
    "secretary_of_state",
    "state_auditor",
    "attorney_general",
)
STATEWIDE_TITLES = {
    "Governor & Lt Governor": "governor",
    "Secretary of State": "secretary_of_state",
    "State Auditor": "state_auditor",
    "Attorney General": "attorney_general",
}


class CandidateCatalogueError(ValueError):
    """Invalid source, context, evidence, or saved snapshot; never an empty race."""


def _require(condition: bool, message: str) -> None:
    if not condition:
        raise CandidateCatalogueError(message)


@dataclass(frozen=True)
class ElectionContext:
    election_id: str
    election_date: date
    election_type: ElectionType
    source_url: str
    source_stage: SourceStage
    source_encoding: Literal["windows-1252", "utf-8"] = "windows-1252"
    source_kind: Literal["cand", "local_cand"] = "cand"

    def __post_init__(self) -> None:
        _require(
            bool(re.fullmatch(r"[A-Za-z0-9_-]{1,80}", self.election_id)),
            "election_id must be a nonempty safe identifier",
        )
        _require(
            self.election_type in ("general", "primary", "special"),
            "invalid election type",
        )
        _require(self.source_stage in ("test", "unverified"), "invalid source stage")
        _require(
            self.source_encoding in ("windows-1252", "utf-8"), "invalid source encoding"
        )
        _require(self.source_kind in ("cand", "local_cand"), "invalid source kind")
        filename = "cand.txt" if self.source_kind == "cand" else "LocalCandTbl.txt"
        expected = f"https://electionresultsfiles.sos.mn.gov/{self.election_date:%Y%m%d}/{filename}"
        _require(
            self.source_url == expected,
            "source_url must be this election date's selected SOS candidate file",
        )


@dataclass(frozen=True)
class OfficeCoverage:
    """Separate operator evidence; a successful parse alone does not prove completeness.

    group is house:1A, senate:1, a statewide kind, or source:<county>:<office>.
    Evidence is bound to this election and these exact source bytes. Completeness
    describes this staged source only, never certified or current candidacy.
    """

    group: str
    status: CoverageStatus
    election_id: str
    source_sha256: str
    evidence_url: str
    note: str


@dataclass(frozen=True)
class CandidateRecord:
    stable_id: str
    candidate_id: str
    name: str
    office_id: str
    office_title: str
    county_id: str
    party_id: str | None
    party_abbreviation: str | None
    office_group: str
    office_kind: str | None
    district_code: str | None
    row_number: int
    raw_row: str
    source_sha256: str
    municipal_fips_code: str | None = None
    school_district_number: str | None = None


@dataclass(frozen=True)
class CandidateRace:
    office_group: str
    candidates: tuple[CandidateRecord, ...]
    coverage: CoverageStatus
    coverage_evidence: OfficeCoverage | None
    publication_status: Literal["staged_only"] = "staged_only"


@dataclass(frozen=True)
class CandidateCatalogue:
    election: ElectionContext
    fetched_at: datetime
    source_sha256: str
    source_bytes: bytes
    candidates: tuple[CandidateRecord, ...]
    coverage: tuple[OfficeCoverage, ...]
    publication_status: Literal["staged_only"] = "staged_only"

    def race(
        self, office_kind: OfficeKind, district_code: str | None = None
    ) -> CandidateRace:
        """Exact district match. Unsupported offices cannot be address-matched here."""
        _require(office_kind in SUPPORTED_KINDS, "unsupported lookup office")
        if office_kind in ("house", "senate"):
            district = _district(office_kind, district_code or "")
            _require(district is not None, "invalid district code")
            group = f"{office_kind}:{district}"
        else:
            _require(district_code is None, "statewide lookup cannot have a district")
            group = office_kind
        evidence = next((item for item in self.coverage if item.group == group), None)
        return CandidateRace(
            office_group=group,
            candidates=tuple(
                item for item in self.candidates if item.office_group == group
            ),
            coverage=evidence.status if evidence else "unknown",
            coverage_evidence=evidence,
        )


def _district(kind: str, value: str) -> str | None:
    pattern = r"([0-9]{1,2})([AB])" if kind == "house" else r"([0-9]{1,2})"
    match = re.fullmatch(pattern, value.upper())
    if not match or not 1 <= int(match[1]) <= 67:
        return None
    return f"{int(match[1])}{match[2] if kind == 'house' else ''}"


def _office(
    title: str, county: str, office_id: str
) -> tuple[str, str | None, str | None]:
    # 88 means statewide OR multi-county, not proof of any particular office.
    if county == "88":
        for prefix, kind in (
            ("State Representative District ", "house"),
            ("State Senator District ", "senate"),
        ):
            if title.startswith(prefix):
                district = _district(kind, title.removeprefix(prefix))
                # Only exact observed official title syntax supports this mapping.
                if district and title == f"{prefix}{district}":
                    return f"{kind}:{district}", kind, district
        if title in STATEWIDE_TITLES:
            kind = STATEWIDE_TITLES[title]
            return kind, kind, None
    return f"source:{county}:{office_id}", None, None


def parse_candidate_catalogue(
    body: bytes,
    *,
    election: ElectionContext,
    fetched_at: datetime,
    coverage: tuple[OfficeCoverage, ...] = (),
) -> CandidateCatalogue:
    """Parse cand.txt; reject source-kind confusion before reading any rows."""
    _require(election.source_kind == "cand", "cand.txt parser needs cand source kind")
    return _parse_rows(
        body, election=election, fetched_at=fetched_at, coverage=coverage
    )


def parse_local_candidate_catalogue(
    body: bytes,
    *,
    election: ElectionContext,
    fetched_at: datetime,
    coverage: tuple[OfficeCoverage, ...] = (),
) -> CandidateCatalogue:
    """Preserve LocalCandTbl.txt identifiers; local boundary matching is unsupported."""
    _require(
        election.source_kind == "local_cand",
        "local parser needs local_cand source kind",
    )
    return _parse_rows(
        body, election=election, fetched_at=fetched_at, coverage=coverage
    )


def _parse_rows(
    body: bytes,
    *,
    election: ElectionContext,
    fetched_at: datetime,
    coverage: tuple[OfficeCoverage, ...],
) -> CandidateCatalogue:
    """Validate all rows, retaining each distinct source schema without inferred fields."""
    _require(isinstance(body, bytes), "source must be immutable bytes")
    _require(
        fetched_at.tzinfo is not None and fetched_at.utcoffset() is not None,
        "fetched_at needs a timezone",
    )
    _require(
        bool(body) and len(body) <= 20_000_000, "empty or oversized candidate source"
    )
    digest = hashlib.sha256(body).hexdigest()
    try:
        text = body.decode(election.source_encoding, errors="strict")
    except UnicodeDecodeError as error:
        raise CandidateCatalogueError(
            "candidate source does not use its declared encoding"
        ) from error
    _require(
        not re.search(r"[\x00-\x09\x0b\x0c\x0e-\x1f\x7f-\x9f]", text),
        "source contains control characters",
    )
    rows = text.splitlines()
    _require(bool(rows), "candidate source contains no rows")
    candidates = []
    identities: set[tuple[str, str, str]] = set()
    offices: dict[tuple[str, ...], str] = {}
    groups: dict[str, tuple[str, ...]] = {}
    for number, raw_row in enumerate(rows, start=1):
        parts = raw_row.split(";")
        _require(len(parts) == 7, f"row {number}: expected exactly 7 fields")
        candidate_id, name, office_id, title, county, field6, field7 = parts
        local = election.source_kind == "local_cand"
        municipal = field6 or None if local else None
        school = field7 or None if local else None
        party_id = None if local else field6
        party = None if local else field7
        _require(
            all(value and value == value.strip() for value in parts[:5])
            and all(
                value == value.strip() and (local or bool(value)) for value in parts[5:]
            ),
            f"row {number}: blank or padded field",
        )
        _require(
            bool(re.fullmatch(r"[0-9]{13}" if local else r"[0-9]{8}", candidate_id)),
            f"row {number}: invalid candidate ID",
        )
        _require(
            bool(re.fullmatch(r"[0-9]{4}", office_id)),
            f"row {number}: invalid office ID",
        )
        _require(
            bool(re.fullmatch(r"[0-9]{2}", county)) and 1 <= int(county) <= 88,
            f"row {number}: invalid county ID",
        )
        if local:
            _require(
                municipal is None or bool(re.fullmatch(r"[0-9]{5}", municipal)),
                f"row {number}: invalid municipal FIPS",
            )
            _require(
                school is None or bool(re.fullmatch(r"[0-9]{4}", school)),
                f"row {number}: invalid school district number",
            )
        else:
            _require(
                bool(re.fullmatch(r"[0-9]{2}", field6)),
                f"row {number}: invalid party ID",
            )
        identity = county, office_id, candidate_id
        _require(
            identity not in identities, f"row {number}: duplicate candidate identity"
        )
        identities.add(identity)
        office_key = (
            (county, office_id, field6, field7, title) if local else (county, office_id)
        )
        _require(
            office_key not in offices or offices[office_key] == title,
            f"row {number}: conflicting office title",
        )
        offices[office_key] = title
        if local:
            group = f"local:{county}:{office_id}:{field6}:{field7}:{title}"
            kind = district = None
        else:
            group, kind, district = _office(title, county, office_id)
        _require(
            group not in groups or groups[group] == office_key,
            f"row {number}: ambiguous office group",
        )
        groups[group] = office_key
        stable_id = f"{election.source_kind}:{election.election_id}:{election.election_date.isoformat()}:{election.election_type}:{county}:{office_id}:{candidate_id}"
        candidates.append(
            CandidateRecord(
                stable_id,
                candidate_id,
                name,
                office_id,
                title,
                county,
                party_id,
                party,
                group,
                kind,
                district,
                number,
                raw_row,
                digest,
                municipal,
                school,
            )
        )
    seen_coverage: set[str] = set()
    for item in coverage:
        _require(
            item.status in ("unknown", "incomplete", "complete"),
            "invalid coverage status",
        )
        _require(item.group not in seen_coverage, "duplicate office coverage")
        seen_coverage.add(item.group)
        _require(
            item.election_id == election.election_id and item.source_sha256 == digest,
            "coverage evidence belongs to a different election or source",
        )
        _require(
            bool(item.note.strip())
            and bool(re.fullmatch(r"https://[^\s]+", item.evidence_url)),
            "coverage needs separate evidence URL and explanation",
        )
        # Absent groups must still be a named supported race, not arbitrary text.
        if item.group not in groups:
            kind, _, district = item.group.partition(":")
            valid = (
                kind in ("house", "senate") and _district(kind, district) == district
            ) or item.group in STATEWIDE_TITLES.values()
            _require(
                bool(valid) and not local, "coverage names an unknown office group"
            )
    # Alphabetical official name order, independent of source ballot/party order.
    candidates.sort(
        key=lambda item: (item.office_group, item.name.casefold(), item.stable_id)
    )
    return CandidateCatalogue(
        election,
        fetched_at,
        digest,
        body,
        tuple(candidates),
        tuple(sorted(coverage, key=lambda item: item.group)),
    )


def catalogue_document(catalogue: CandidateCatalogue) -> dict:
    """JSON-safe public interface for a private staged snapshot, without invented fields."""
    election = asdict(catalogue.election)
    election["election_date"] = catalogue.election.election_date.isoformat()
    return {
        "schema_version": 1,
        "publication_status": catalogue.publication_status,
        "source_kind": catalogue.election.source_kind,
        "election": election,
        "fetched_at": catalogue.fetched_at.isoformat(),
        "source_sha256": catalogue.source_sha256,
        "source_byte_count": len(catalogue.source_bytes),
        "candidates": [asdict(item) for item in catalogue.candidates],
        "coverage": [asdict(item) for item in catalogue.coverage],
        "office_groups": [
            {
                "group": group,
                "coverage": next(
                    (item.status for item in catalogue.coverage if item.group == group),
                    "unknown",
                ),
            }
            for group in sorted(
                {item.office_group for item in catalogue.candidates}
                | {item.group for item in catalogue.coverage}
            )
        ],
    }


def load_candidate_snapshot(directory: Path) -> CandidateCatalogue:
    """Reparse retained bytes and compare every saved normalized field before reuse."""
    try:
        document = json.loads(
            (directory / "catalogue.json").read_text(encoding="utf-8")
        )
        context = dict(document["election"])
        context["election_date"] = date.fromisoformat(context["election_date"])
        parse = (
            parse_local_candidate_catalogue
            if context["source_kind"] == "local_cand"
            else parse_candidate_catalogue
        )
        catalogue = parse(
            (directory / "source.bin").read_bytes(),
            election=ElectionContext(**context),
            fetched_at=datetime.fromisoformat(document["fetched_at"]),
            coverage=tuple(OfficeCoverage(**item) for item in document["coverage"]),
        )
        _require(
            directory.name == catalogue.source_sha256,
            "snapshot directory does not match source hash",
        )
        _require(
            directory.parent.name == catalogue.election.source_kind
            and directory.parent.parent.name
            == f"{catalogue.election.election_date.isoformat()}-{catalogue.election.election_type}"
            and directory.parent.parent.parent.name == catalogue.election.election_id,
            "snapshot directory does not match election context",
        )
        _require(
            document == catalogue_document(catalogue),
            "saved snapshot metadata or source is inconsistent",
        )
        return catalogue
    except (OSError, KeyError, TypeError, ValueError) as error:
        raise CandidateCatalogueError(
            f"invalid saved candidate snapshot: {error}"
        ) from error


def import_candidate_file(
    input_path: Path,
    output_directory: Path,
    *,
    election: ElectionContext,
    fetched_at: datetime,
    coverage: tuple[OfficeCoverage, ...] = (),
) -> Path:
    """Keep source+JSON together with atomic rename; never overwrite another snapshot."""
    parse = (
        parse_local_candidate_catalogue
        if election.source_kind == "local_cand"
        else parse_candidate_catalogue
    )
    catalogue = parse(
        input_path.read_bytes(),
        election=election,
        fetched_at=fetched_at,
        coverage=coverage,
    )
    document = catalogue_document(catalogue)
    parent = (
        output_directory
        / election.election_id
        / f"{election.election_date.isoformat()}-{election.election_type}"
    )
    parent = parent / election.source_kind
    target = parent / catalogue.source_sha256
    parent.mkdir(parents=True, exist_ok=True)
    if target.exists():
        _require(
            catalogue_document(load_candidate_snapshot(target)) == document,
            "existing source snapshot has different metadata",
        )
        return target
    temporary = Path(tempfile.mkdtemp(prefix=".candidate-import-", dir=parent))
    try:
        for name, payload in (
            ("source.bin", catalogue.source_bytes),
            (
                "catalogue.json",
                (json.dumps(document, ensure_ascii=False, indent=2) + "\n").encode(
                    "utf-8"
                ),
            ),
        ):
            with (temporary / name).open("wb") as stream:
                stream.write(payload)
                stream.flush()
                os.fsync(stream.fileno())
        try:
            temporary.rename(target)
        except OSError:
            if not target.exists():
                raise
            _require(
                catalogue_document(load_candidate_snapshot(target)) == document,
                "concurrent snapshot has different metadata",
            )
        return target
    finally:
        if temporary.exists():
            shutil.rmtree(temporary)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description="Stage an operator-downloaded SOS cand.txt; no network or public activation."
    )
    parser.add_argument("input", type=Path)
    parser.add_argument("--output-directory", required=True, type=Path)
    parser.add_argument("--election-id", required=True)
    parser.add_argument("--election-date", required=True, type=date.fromisoformat)
    parser.add_argument(
        "--election-type", required=True, choices=("general", "primary", "special")
    )
    parser.add_argument("--source-url", required=True)
    parser.add_argument("--source-kind", required=True, choices=("cand", "local_cand"))
    parser.add_argument("--source-stage", required=True, choices=("test", "unverified"))
    parser.add_argument(
        "--source-encoding", default="windows-1252", choices=("windows-1252", "utf-8")
    )
    parser.add_argument("--fetched-at", required=True, type=datetime.fromisoformat)
    parser.add_argument(
        "--coverage-evidence",
        type=Path,
        help="Optional JSON list of separately supported OfficeCoverage evidence",
    )
    args = parser.parse_args(argv)
    try:
        coverage = (
            tuple(
                OfficeCoverage(**item)
                for item in json.loads(
                    args.coverage_evidence.read_text(encoding="utf-8")
                )
            )
            if args.coverage_evidence
            else ()
        )
        directory = import_candidate_file(
            args.input,
            args.output_directory,
            election=ElectionContext(
                args.election_id,
                args.election_date,
                args.election_type,
                args.source_url,
                args.source_stage,
                args.source_encoding,
                args.source_kind,
            ),
            fetched_at=args.fetched_at,
            coverage=coverage,
        )
    except (CandidateCatalogueError, OSError, TypeError, ValueError) as error:
        parser.error(str(error))
    print(directory)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
