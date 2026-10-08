"""Import the individually reviewed public record register, with an explicit apply.

The default is a transactional preview: staged writes are rolled back. Election
sources, exact identities and every retained version are checked before this
importer commits anything. A changed
public source needs a new reviewed register; it is never silently reinterpreted.
"""

from __future__ import annotations

import argparse
import copy
import hashlib
import json
import re
import uuid
from datetime import UTC, date, datetime
from pathlib import Path
from urllib.parse import urlsplit

from sqlalchemy import text
from sqlalchemy.orm import Session

from alethical.api.services.person_records import (
    PublicRecordConflict,
    candidate_identity,
    MINNESOTA,
    retain_public_version,
    reviewed_register,
    save_candidate_record,
    sync_reviewed_legislators,
)
from alethical.db.models import (
    CandidateElection,
    CandidateRaceMember,
    CandidateRaceRecord,
    CandidateRecord,
    PersonCandidacy,
    PersonResearchRecord,
    PersonServiceRecord,
    PublicPerson,
)


def _checked(source: dict) -> datetime:
    checked = datetime.fromisoformat(source["checkedAt"])
    if checked.tzinfo is None or not re.fullmatch(r"[a-f0-9]{64}", source["sha256"]):
        raise ValueError("Source needs an actual check time and hash")
    if source["checkedDate"] != checked.astimezone(MINNESOTA).date().isoformat():
        raise ValueError("Source dates disagree")
    parsed = urlsplit(source["url"])
    if (
        parsed.scheme != "https"
        or parsed.username
        or parsed.password
        or parsed.hostname
        not in {
            "electionresults.sos.mn.gov",
            "electionresultsfiles.sos.mn.gov",
            "www.sos.mn.gov",
            "www.mpschools.org",
            "mpschools.org",
            "resources.finalsite.net",
            "myballotmn.sos.mn.gov",
            "meetings.boardbook.org",
        }
    ):
        raise ValueError("Unsupported official source")
    return checked


def _retain(db, kind, key, payload, source):
    retain_public_version(
        db,
        kind=kind,
        record_id=str(key),
        payload=payload,
        source_hash=source["sha256"],
        checked_at=_checked(source),
    )


def validate_register(
    register: dict, *, evidence_dir: Path | None = None, today: date | None = None
) -> dict:
    """No byte fetch, name inference, election guess or vote ranking."""
    if register.get("version") != 1:
        raise ValueError("Unsupported public record register")
    today = today or datetime.now(UTC).astimezone(MINNESOTA).date()
    if evidence_dir:
        for source in register["sources"]:
            name = source["file"]
            if (
                Path(name).name != name
                or hashlib.sha256((evidence_dir / name).read_bytes()).hexdigest()
                != source["sha256"]
            ):
                raise ValueError("Reviewed evidence bytes do not match")
    elections = {item["id"]: item for item in register["elections"]}
    if len(elections) != len(register["elections"]):
        raise ValueError("Duplicate election")
    candidates = {item["id"]: item for item in register["candidates"]}
    races = {item["id"]: item for item in register["races"]}
    if len(candidates) != len(register["candidates"]) or len(races) != len(
        register["races"]
    ):
        raise ValueError("Duplicate record")
    for cid, record in candidates.items():
        if hashlib.sha256(record["sourceIdentity"].encode()).hexdigest() != cid:
            raise ValueError("Historical candidacy identity changed")
        profile = record["profile"]
        identity = candidate_identity(profile)
        election = elections[identity["electionId"]]
        namespace = record["sourceIdentity"].split(":")
        if (
            len(namespace) != 7
            or namespace[0] != "local_cand"
            or namespace[1:4] != [election["id"], election["date"], election["type"]]
        ):
            raise ValueError("Historical source namespace disagrees with election")
        if identity["candidateId"] != cid or profile["election"] != election:
            raise ValueError("Candidacy election mismatch")
        race = races[record["raceId"]]
        if (race["electionId"], race["stage"], race["office"]) != (
            election["id"],
            election["type"],
            identity["office"],
        ):
            raise ValueError("Candidacy race mismatch")
        _checked(profile["source"])
    for rid, race in races.items():
        payload = race["payload"]
        if race["testData"]:
            raise ValueError("Test results cannot be published")
        if date.fromisoformat(elections[race["electionId"]]["date"]) > today and race[
            "status"
        ] not in {"pending", "unavailable"}:
            raise ValueError("Future election results cannot be published")
        if (
            race["status"]
            not in {
                "pending",
                "unofficial",
                "certified",
                "recount",
                "tie",
                "unavailable",
            }
            or payload["status"] != race["status"]
        ):
            raise ValueError("Invalid result status")
        if race["final"] and race["status"] != "certified":
            raise ValueError("Only certified results can be final")
        if race["status"] == "certified":
            if race["authorityScope"] != race["jurisdictionScope"] or not payload.get(
                "certificationEvidence"
            ):
                raise ValueError("Certification does not cover this race")
            for evidence in payload["certificationEvidence"]:
                _checked(evidence)
        outcomes = payload.get("outcomes", {})
        if outcomes and not (race["status"] == "certified" and race["final"]):
            raise ValueError("Outcomes require final certified results")
        for cid, outcome in outcomes.items():
            if (
                cid not in candidates
                or candidates[cid]["raceId"] != rid
                or outcome not in {"elected", "not-elected"}
            ):
                raise ValueError("Outcome belongs to a different race")
        for cid, source in payload.get("withdrawals", {}).items():
            if (
                cid not in candidates
                or candidates[cid]["raceId"] != rid
                or cid in outcomes
            ):
                raise ValueError("Withdrawal belongs to a different race")
            _checked(source)
        _checked(payload["source"])
    ids = set()
    for person in register["people"]:
        pid = uuid.UUID(person["id"])
        if pid in ids or not person["identityEvidence"].get("sources"):
            raise ValueError("Person identity lacks distinct evidence")
        ids.add(pid)
        for source in person["identityEvidence"]["sources"]:
            _checked(source)
        for cid in person["candidateIds"]:
            if cid not in candidates:
                raise ValueError("Unknown candidacy link")
        services = {item["id"]: item for item in person["service"]}
        for service in person["service"]:
            uuid.UUID(service["id"])
            if service["status"] not in {"current", "elected", "former", "unknown"}:
                raise ValueError("Invalid service status")
            # Actual dates must be complete dates. Month/year precision stays in
            # separate objects; January never turns into an invented January 1.
            for field in ("startDate", "endDate"):
                if service.get(field):
                    date.fromisoformat(service[field])
            _checked(service["source"])
        for item in person["research"]:
            context = item.get("context", {})
            candidate_id = context.get("candidateId")
            service_id = context.get("serviceId")
            election_context = (
                context.get("kind") == "election"
                and candidate_id in person["candidateIds"]
            )
            service_context = (
                context.get("kind") == "service" and service_id in services
            )
            if item["type"] != "official-record" or not (
                election_context or service_context
            ):
                raise ValueError("Research lacks this person's official context")
            if election_context:
                profile = candidates[candidate_id]["profile"]
                if (
                    context.get("election") != profile["election"]
                    or context.get("office") != profile["office"]
                ):
                    raise ValueError("Research election context disagrees")
            elif context.get("office") != services[service_id]["office"]:
                raise ValueError("Research service context disagrees")
            if item["status"] not in {
                "available",
                "corrected",
                "withdrawn",
                "unavailable",
            }:
                raise ValueError("Invalid source state")
            if item["status"] == "corrected":
                date.fromisoformat(item["correctionDate"])
                if not item.get("correctionNote"):
                    raise ValueError("Correction needs its sourced explanation")
            _checked(item["source"])
    return {
        "elections": len(elections),
        "candidates": len(candidates),
        "races": len(races),
        "people": len(register["people"]),
        "research": sum(len(person["research"]) for person in register["people"]),
    }


def import_reviewed_records(
    db: Session,
    *,
    register: dict | None = None,
    evidence_dir: Path | None = None,
    today: date | None = None,
) -> dict:
    """Stage accepted public facts in the caller's transaction; caller commits."""
    register = copy.deepcopy(register or reviewed_register())
    counts = validate_register(register, evidence_dir=evidence_dir, today=today)
    db.execute(
        text(
            "SELECT pg_advisory_xact_lock(hashtext('candidate-person-reviewed-register'))"
        )
    )
    for election in register["elections"]:
        row = db.get(CandidateElection, election["id"])
        values = {
            "canonical_key": election["canonicalKey"],
            "election_date": date.fromisoformat(election["date"]),
            "stage": election["type"],
            "public_payload": election,
        }
        if row is None:
            db.add(CandidateElection(id=election["id"], **values))
        elif (row.canonical_key, row.election_date, row.stage) != (
            values["canonical_key"],
            values["election_date"],
            values["stage"],
        ):
            raise PublicRecordConflict("Election identity changed")
        else:
            row.public_payload = election
    db.flush()
    for item in sorted(register["candidates"], key=lambda item: item["id"]):
        profile = item["profile"]
        cid = item["id"]
        source = profile["source"]
        checked = _checked(source)
        save_candidate_record(
            db, profile=profile, source_hash=source["sha256"], checked_at=checked
        )
    db.flush()
    for item in register["races"]:
        _retain(db, "race", item["id"], item["payload"], item["payload"]["source"])
        row = db.get(CandidateRaceRecord, item["id"])
        values = {
            "election_id": item["electionId"],
            "stage": item["stage"],
            "jurisdiction_scope": item["jurisdictionScope"],
            "office": item["office"],
            "result_status": item["status"],
            "final": item["final"],
            "test_data": item["testData"],
            "authority_scope": item["authorityScope"],
            "result_payload": item["payload"],
        }
        if row is None:
            db.add(CandidateRaceRecord(id=item["id"], **values))
        else:
            if (row.election_id, row.stage, row.jurisdiction_scope, row.office) != (
                item["electionId"],
                item["stage"],
                item["jurisdictionScope"],
                item["office"],
            ):
                raise PublicRecordConflict("Race identity changed")
            old_source = row.result_payload["source"]
            _retain(db, "race", row.id, row.result_payload, old_source)
            if _checked(values["result_payload"]["source"]) < _checked(old_source):
                continue
            for name, value in values.items():
                setattr(row, name, value)
    db.flush()
    for item in register["candidates"]:
        row = db.get(CandidateRaceMember, item["id"])
        identity = candidate_identity(item["profile"])
        if row is None:
            db.add(
                CandidateRaceMember(
                    candidate_id=item["id"], race_id=item["raceId"], identity=identity
                )
            )
        elif row.race_id != item["raceId"] or row.identity != identity:
            raise PublicRecordConflict("Candidacy race membership changed")
    for item in register["people"]:
        pid = uuid.UUID(item["id"])
        row = db.get(PublicPerson, pid)
        if row is None:
            db.add(
                PublicPerson(
                    id=pid,
                    name=item["name"],
                    identity_evidence=item["identityEvidence"],
                )
            )
        elif row.name != item["name"]:
            raise PublicRecordConflict("Public identity changed")
        db.flush()
        _retain(
            db,
            "person",
            pid,
            {"name": item["name"], "identityEvidence": item["identityEvidence"]},
            item["identityEvidence"]["sources"][0],
        )
        for cid in item["candidateIds"]:
            identity = candidate_identity(db.get(CandidateRecord, cid).public_payload)
            link = db.get(PersonCandidacy, (pid, cid))
            if link is None:
                db.add(
                    PersonCandidacy(
                        person_id=pid,
                        candidate_id=cid,
                        identity=identity,
                        evidence=item["identityEvidence"],
                    )
                )
            elif link.identity != identity:
                raise PublicRecordConflict("Person candidacy identity changed")
        for service in item["service"]:
            sid = uuid.UUID(service["id"])
            row = db.get(PersonServiceRecord, sid)
            if row is None:
                db.add(
                    PersonServiceRecord(
                        id=sid,
                        person_id=pid,
                        status=service["status"],
                        public_payload=service,
                    )
                )
            else:
                if row.person_id != pid:
                    raise PublicRecordConflict("Service belongs to a different person")
                _retain(
                    db, "service", sid, row.public_payload, row.public_payload["source"]
                )
                if _checked(service["source"]) >= _checked(
                    row.public_payload["source"]
                ):
                    row.status = service["status"]
                    row.public_payload = service
            _retain(db, "service", sid, service, service["source"])
        for research in item["research"]:
            row = db.get(PersonResearchRecord, research["id"])
            sort_date = date.fromisoformat(
                research.get("publishedDate")
                or research.get("eventDate")
                or research["source"]["checkedDate"]
            )
            if row is None:
                db.add(
                    PersonResearchRecord(
                        id=research["id"],
                        person_id=pid,
                        kind=research["type"],
                        public_payload=research,
                        sort_date=sort_date,
                    )
                )
            else:
                if row.person_id != pid:
                    raise PublicRecordConflict("Research belongs to a different person")
                _retain(
                    db,
                    "research",
                    row.id,
                    row.public_payload,
                    row.public_payload["source"],
                )
                if _checked(research["source"]) >= _checked(
                    row.public_payload["source"]
                ):
                    row.public_payload = research
                    row.sort_date = sort_date
            _retain(db, "research", research["id"], research, research["source"])
    db.flush()
    counts["legislatorPeopleAdded"] = sync_reviewed_legislators(
        db, today=today or datetime.now(UTC).astimezone(MINNESOTA).date()
    )
    return counts


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--evidence-dir",
        type=Path,
        help="Check retained official source bytes against the reviewed register",
    )
    parser.add_argument(
        "--apply",
        action="store_true",
        help="Commit reviewed records to the configured database",
    )
    args = parser.parse_args()
    from alethical.db.session import get_session_factory

    with get_session_factory()() as db:
        try:
            counts = import_reviewed_records(db, evidence_dir=args.evidence_dir)
            if args.apply:
                db.commit()
            else:
                db.rollback()
        except Exception:
            db.rollback()
            raise
    print(json.dumps({"applied": args.apply, **counts}, sort_keys=True))


if __name__ == "__main__":
    main()
