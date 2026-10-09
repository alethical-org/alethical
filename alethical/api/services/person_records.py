"""Source-bound public people, election records and official research.

Private claims and submitted addresses are deliberately absent from this module.
Reviewed identity links are revalidated against their frozen source identity when
read. Public records remain when any private account is removed.
"""

from __future__ import annotations

import copy
import calendar
import hashlib
import json
import re
import uuid
from datetime import UTC, date, datetime
from functools import lru_cache
from pathlib import Path
from zoneinfo import ZoneInfo

from sqlalchemy import select, text
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.orm import Session

from alethical.db.models import (
    CandidateElection,
    CandidateRaceMember,
    CandidateRaceRecord,
    CandidateRecord,
    Legislator,
    PersonCandidacy,
    PersonResearchRecord,
    PersonServiceRecord,
    PublicPerson,
    PublicRecordVersion,
)

REGISTER_PATH = (
    Path(__file__).resolve().parents[1] / "data/candidate_person_records.json"
)
MINNESOTA = ZoneInfo("America/Chicago")
RESULT_STATES = {"pending", "unofficial", "certified", "recount", "tie", "unavailable"}


class PublicRecordConflict(ValueError):
    """A source change needs review, not an automatic identity transfer."""


@lru_cache(maxsize=1)
def reviewed_register() -> dict:
    return json.loads(REGISTER_PATH.read_text())


def canonical_hash(value: object) -> str:
    return hashlib.sha256(
        json.dumps(
            value, sort_keys=True, ensure_ascii=False, separators=(",", ":")
        ).encode()
    ).hexdigest()


def candidate_identity(profile: dict) -> dict:
    candidate = profile.get("candidate", {})
    election = profile.get("election", {})
    return {
        "candidateId": candidate.get("id"),
        "name": candidate.get("name"),
        "party": candidate.get("party"),
        "electionId": election.get("id"),
        "electionDate": election.get("date"),
        "stage": election.get("type"),
        "office": profile.get("office"),
        "votingArea": profile.get("votingArea"),
    }


def public_version(
    *,
    kind: str,
    record_id: str,
    payload: dict,
    source_hash: str,
    checked_at: datetime,
) -> dict:
    """One accepted read, keyed by its exact facts, source and check time."""
    if kind not in {"candidate", "ballot", "race", "person", "service", "research"}:
        raise ValueError("Unsupported public record kind")
    if checked_at.tzinfo is None or not re.fullmatch(r"[a-f0-9]{64}", source_hash):
        raise ValueError("Public evidence requires a source hash and aware check time")
    return {
        "id": canonical_hash(
            [kind, record_id, source_hash, checked_at.isoformat(), payload]
        ),
        "record_kind": kind,
        "record_id": record_id,
        "public_payload": payload,
        "source_sha256": source_hash,
        "checked_at": checked_at,
    }


def retain_public_versions(db: Session, versions: list[dict]) -> None:
    """Retain accepted reads in 1 statement; an already-retained read is kept."""
    unique = list({version["id"]: version for version in versions}.values())
    if unique:
        db.execute(
            insert(PublicRecordVersion)
            .values(unique)
            .on_conflict_do_nothing(index_elements=["id"])
        )


def retain_public_version(
    db: Session,
    *,
    kind: str,
    record_id: str,
    payload: dict,
    source_hash: str,
    checked_at: datetime,
) -> None:
    """Retain each accepted read unchanged, including identical facts read later."""
    retain_public_versions(
        db,
        [
            public_version(
                kind=kind,
                record_id=record_id,
                payload=payload,
                source_hash=source_hash,
                checked_at=checked_at,
            )
        ],
    )


def lock_candidate_records(db: Session, candidate_ids) -> None:
    """Take every candidate's save lock in 1 statement, in ascending candidate-ID order.

    Each save lock is ``hashtext(candidate_id)``. This is the same order, and the same
    locks held to commit, as saving 1 record at a time in candidate-ID order, so a
    batched writer and such a writer, including one still running on a previous
    release, do not take shared candidates' locks in opposite orders. DISTINCT and
    ORDER BY keep the subquery from being flattened, so the outer function runs once
    per ID in sorted order. A lock this transaction already holds is taken again
    without waiting.
    """
    ids = sorted(set(candidate_ids))
    if ids:
        db.execute(
            text(
                "SELECT count(pg_advisory_xact_lock(hashtext(ordered.candidate_id))) "
                'FROM (SELECT DISTINCT candidate_id COLLATE "C" AS candidate_id '
                "FROM unnest(CAST(:candidate_ids AS text[])) AS candidate_id "
                "ORDER BY candidate_id) AS ordered"
            ),
            {"candidate_ids": ids},
        )


def save_candidate_records(
    db: Session, *, profiles: list[dict], source_hash: str, checked_at: datetime
) -> None:
    """Save accepted official records from 1 source read in the caller's transaction.

    Take these same advisory locks before any claim row lock. A title/name change
    must be reviewed as a new identity, never overwrite an already-linked URL.
    Every accepted read is retained, and an older read never replaces a newer one.
    Person and result data live in separate tables and are not replaced here.
    Profiles apply in the given order, exactly as 1-at-a-time saves would.
    """
    ids = [profile["candidate"]["id"] for profile in profiles]
    if not all(re.fullmatch(r"[a-f0-9]{64}", cid) for cid in ids):
        raise ValueError("Invalid candidate identity")
    if not ids:
        return
    # Write pending changes before rows are read and replaced below.
    db.flush()
    lock_candidate_records(db, ids)
    current = {
        row.id: {
            "public_payload": row.public_payload,
            "source_sha256": row.source_sha256,
            "checked_at": row.checked_at,
        }
        for row in db.execute(
            select(
                CandidateRecord.id,
                CandidateRecord.public_payload,
                CandidateRecord.source_sha256,
                CandidateRecord.checked_at,
            )
            .where(CandidateRecord.id.in_(sorted(set(ids))))
            .order_by(CandidateRecord.id)
            .with_for_update()
        )
    }
    versions: list[dict] = []
    changed: dict[str, dict] = {}
    for profile, cid in zip(profiles, ids, strict=True):
        row = current.get(cid)
        if row is not None:
            if candidate_identity(row["public_payload"]) != candidate_identity(profile):
                raise PublicRecordConflict("Candidacy identity changed")
            versions.append(
                public_version(
                    kind="candidate",
                    record_id=cid,
                    payload=row["public_payload"],
                    source_hash=row["source_sha256"],
                    checked_at=row["checked_at"],
                )
            )
        versions.append(
            public_version(
                kind="candidate",
                record_id=cid,
                payload=profile,
                source_hash=source_hash,
                checked_at=checked_at,
            )
        )
        if row is None or checked_at >= row["checked_at"]:
            current[cid] = changed[cid] = {
                "id": cid,
                "election_id": profile["election"]["id"],
                "election_date": date.fromisoformat(profile["election"]["date"]),
                "public_payload": copy.deepcopy(profile),
                "source_sha256": source_hash,
                "checked_at": checked_at,
            }
    retain_public_versions(db, versions)
    if changed:
        upsert = insert(CandidateRecord).values(list(changed.values()))
        # Existing rows keep their election; an older read never replaces a newer one.
        db.execute(
            upsert.on_conflict_do_update(
                index_elements=["id"],
                set_={
                    "public_payload": upsert.excluded.public_payload,
                    "source_sha256": upsert.excluded.source_sha256,
                    "checked_at": upsert.excluded.checked_at,
                },
                where=CandidateRecord.checked_at <= upsert.excluded.checked_at,
            )
        )
        for instance in list(db.identity_map.values()):
            if isinstance(instance, CandidateRecord) and instance.id in changed:
                db.expire(instance)


def save_candidate_record(
    db: Session, *, profile: dict, source_hash: str, checked_at: datetime
) -> CandidateRecord:
    """Save exactly one accepted official record in the caller's transaction."""
    save_candidate_records(
        db, profiles=[profile], source_hash=source_hash, checked_at=checked_at
    )
    return db.get(CandidateRecord, profile["candidate"]["id"], populate_existing=True)


def supported_elections(db: Session | None = None) -> list[dict]:
    # Register metadata is source-reviewed and remains available before the data
    # import. The capability flags never claim unsupported historical geography.
    if db is not None:
        rows = db.scalars(
            select(CandidateElection).order_by(CandidateElection.election_date.desc())
        ).all()
        if rows:
            return [copy.deepcopy(row.public_payload) for row in rows]
    return copy.deepcopy(reviewed_register()["elections"])


def default_election(elections: list[dict], *, today: date) -> str | None:
    upcoming = sorted(
        (x for x in elections if date.fromisoformat(x["date"]) >= today),
        key=lambda x: x["date"],
    )
    past = sorted(
        (x for x in elections if date.fromisoformat(x["date"]) < today),
        key=lambda x: x["date"],
        reverse=True,
    )
    selected = upcoming or past
    return selected[0]["id"] if selected else None


def _uuid(value: str) -> uuid.UUID | None:
    try:
        return uuid.UUID(value)
    except (ValueError, AttributeError, TypeError):
        return None


def _person_link(person: PublicPerson) -> dict:
    return {
        "id": str(person.id),
        "name": person.name,
        "profileUrl": f"/people/{person.id}",
    }


def _candidate_link_pairs(
    db: Session, candidate_ids
) -> dict[str, list[tuple[PersonCandidacy, PublicPerson]]]:
    pairs: dict[str, list[tuple[PersonCandidacy, PublicPerson]]] = {}
    for link, person in db.execute(
        select(PersonCandidacy, PublicPerson)
        .join(PublicPerson, PublicPerson.id == PersonCandidacy.person_id)
        .where(PersonCandidacy.candidate_id.in_(list(candidate_ids)))
    ).all():
        pairs.setdefault(link.candidate_id, []).append((link, person))
    return pairs


def _valid_links(
    db: Session, candidate_id: str, profile: dict, *, today: date
) -> list[PublicPerson]:
    return _valid_people(
        db,
        _candidate_link_pairs(db, [candidate_id]).get(candidate_id, []),
        profile,
        today=today,
    )


def _valid_people(
    db: Session,
    pairs: list[tuple[PersonCandidacy, PublicPerson]],
    profile: dict,
    *,
    today: date,
) -> list[PublicPerson]:
    from alethical.api.services.candidate_legislators import confirmed_legislator

    identity = candidate_identity(profile)
    result = []
    for link, person in pairs:
        if link.identity != identity:
            continue
        if person.legislator_id and link.evidence.get("legislator_slug"):
            confirmed = confirmed_legislator(db, profile, today=today)
            if confirmed is None or confirmed["id"] != str(person.legislator_id):
                continue
        result.append(person)
    return sorted(result, key=lambda person: person.name)


def candidate_result(db: Session, candidate_id: str, profile: dict) -> dict | None:
    membership = db.get(CandidateRaceMember, candidate_id)
    if membership is None or membership.identity != candidate_identity(profile):
        return None
    race = db.get(CandidateRaceRecord, membership.race_id)
    return _race_result(candidate_id, profile, membership, race)


def _race_result(
    candidate_id: str,
    profile: dict,
    membership: CandidateRaceMember | None,
    race: CandidateRaceRecord | None,
) -> dict | None:
    if membership is None or membership.identity != candidate_identity(profile):
        return None
    if race is None or race.test_data:
        return None
    election = profile.get("election", {})
    if (race.election_id, race.stage, race.office) != (
        election.get("id"),
        election.get("type"),
        profile.get("office"),
    ):
        return None
    payload = race.result_payload
    result = {"status": race.result_status}
    for key in ("source", "updatedDate"):
        if payload.get(key):
            result[key] = copy.deepcopy(payload[key])
    outcome = payload.get("outcomes", {}).get(candidate_id)
    if (
        race.result_status == "certified"
        and race.final
        and race.authority_scope == race.jurisdiction_scope
        and payload.get("certificationEvidence")
    ):
        if payload.get("certification"):
            result["certification"] = copy.deepcopy(payload["certification"])
        if outcome in {"elected", "not-elected"}:
            result["outcome"] = outcome
    # A separately supplied official withdrawal is not an election result.
    if payload.get("withdrawals", {}).get(candidate_id):
        result["outcome"] = "withdrew"
        result["withdrawalSource"] = copy.deepcopy(payload["withdrawals"][candidate_id])
    return result


def add_profile_records(db: Session, profile: dict, *, today: date) -> dict:
    profile = copy.deepcopy(profile)
    profile["electionEnded"] = today > date.fromisoformat(profile["election"]["date"])
    cid = profile["candidate"]["id"]
    profile["people"] = [
        _person_link(person) for person in _valid_links(db, cid, profile, today=today)
    ]
    result = candidate_result(db, cid, profile)
    if result:
        profile["result"] = result
    return profile


def _loaded_profile_records(
    db: Session,
    profile: dict,
    *,
    today: date,
    pairs: list[tuple[PersonCandidacy, PublicPerson]],
    membership: CandidateRaceMember | None,
    race: CandidateRaceRecord | None,
) -> dict:
    """add_profile_records for rows already loaded together for a whole ballot."""
    profile = copy.deepcopy(profile)
    profile["electionEnded"] = today > date.fromisoformat(profile["election"]["date"])
    cid = profile["candidate"]["id"]
    profile["people"] = [
        _person_link(person)
        for person in _valid_people(db, pairs, profile, today=today)
    ]
    result = _race_result(cid, profile, membership, race)
    if result:
        profile["result"] = result
    return profile


def enrich_lookup_results(db: Session, response: dict, *, today: date) -> dict:
    """Add result facts only for the exact saved row; preserve all address behavior."""
    if response.get("kind") != "results":
        return response
    response = copy.deepcopy(response)
    election = next(
        (
            item
            for item in supported_elections(db)
            if item["id"] == response.get("electionId")
        ),
        None,
    )
    if election:
        response["electionEnded"] = today > date.fromisoformat(election["date"])
    # A joint ticket is one candidacy record; its verified people remain
    # explicit members, never identities inferred from the display label.
    entries = [
        (race, entry["candidate"] if entry["kind"] == "candidate" else entry)
        for race in response.get("races", [])
        for entry in race.get("entries", [])
    ]
    # Load the whole ballot's saved rows together, then apply each profile's checks.
    ids = sorted({candidate["id"] for _, candidate in entries})
    records = (
        {
            record.id: record
            for record in db.scalars(
                select(CandidateRecord).where(CandidateRecord.id.in_(ids))
            )
        }
        if ids
        else {}
    )
    saved = sorted(records)
    pairs = _candidate_link_pairs(db, saved) if saved else {}
    memberships = (
        {
            member.candidate_id: member
            for member in db.scalars(
                select(CandidateRaceMember).where(
                    CandidateRaceMember.candidate_id.in_(saved)
                )
            )
        }
        if saved
        else {}
    )
    race_ids = sorted({member.race_id for member in memberships.values()})
    race_records = (
        {
            item.id: item
            for item in db.scalars(
                select(CandidateRaceRecord).where(CandidateRaceRecord.id.in_(race_ids))
            )
        }
        if race_ids
        else {}
    )
    for race, candidate in entries:
        record = records.get(candidate["id"])
        if record is None:
            continue
        membership = memberships.get(record.id)
        linked = _loaded_profile_records(
            db,
            record.public_payload,
            today=today,
            pairs=pairs.get(record.id, []),
            membership=membership,
            race=race_records.get(membership.race_id) if membership else None,
        )
        candidate["people"] = linked["people"]
        candidate["electionEnded"] = linked["electionEnded"]
        if linked.get("result"):
            candidate["result"] = linked["result"]
            # Every member here shares the same source race. Differing race
            # results remain on their own race card, never a global heading.
            race["result"] = {
                key: value
                for key, value in linked["result"].items()
                if key not in {"outcome", "withdrawalSource"}
            }
    response["resultsAvailable"] = any(
        race.get("result") for race in response.get("races", [])
    )
    return response


def sync_reviewed_legislators(
    db: Session, *, today: date, candidate_ids: set[str] | None = None
) -> int:
    """Create lasting links only after the existing full source checks pass."""
    from alethical.api.services.candidate_legislators import (
        confirmed_legislator,
        reviewed_links,
    )

    added = 0
    evidence_by_id = reviewed_links()
    for registered in reviewed_register()["legislatorPeople"]:
        cid = registered["candidateId"]
        if candidate_ids is not None and cid not in candidate_ids:
            continue
        record = db.get(CandidateRecord, cid)
        if record is None:
            continue
        confirmed = confirmed_legislator(db, record.public_payload, today=today)
        if confirmed is None or confirmed["slug"] != registered["legislatorSlug"]:
            continue
        pid = uuid.UUID(registered["id"])
        person = db.get(PublicPerson, pid)
        evidence = evidence_by_id[cid]
        if person is None:
            db.add(
                PublicPerson(
                    id=pid,
                    name=confirmed["name"],
                    legislator_id=uuid.UUID(confirmed["id"]),
                    identity_evidence=evidence,
                )
            )
            db.flush()
            added += 1
        elif (person.name, str(person.legislator_id)) != (
            confirmed["name"],
            confirmed["id"],
        ):
            raise PublicRecordConflict("Reviewed person identity changed")
        link = db.get(PersonCandidacy, (pid, cid))
        identity = candidate_identity(record.public_payload)
        if link is None:
            db.add(
                PersonCandidacy(
                    person_id=pid,
                    candidate_id=cid,
                    identity=identity,
                    evidence=evidence,
                )
            )
        elif link.identity != identity:
            raise PublicRecordConflict("Reviewed candidacy identity changed")
    db.flush()
    return added


def _election_rows(
    db: Session, person: PublicPerson, *, today: date
) -> tuple[list[dict], dict | None]:
    from alethical.api.services.candidate_legislators import confirmed_legislator

    pairs = db.execute(
        select(PersonCandidacy, CandidateRecord)
        .join(CandidateRecord, CandidateRecord.id == PersonCandidacy.candidate_id)
        .where(PersonCandidacy.person_id == person.id)
        .order_by(CandidateRecord.election_date.desc(), CandidateRecord.id)
    ).all()
    result = []
    legislator = None
    for link, record in pairs:
        profile = record.public_payload
        if link.identity != candidate_identity(profile):
            continue
        legislative_link = person.legislator_id and link.evidence.get("legislator_slug")
        connection = (
            confirmed_legislator(db, profile, today=today) if legislative_link else None
        )
        if legislative_link and (
            connection is None or connection["id"] != str(person.legislator_id)
        ):
            continue
        if connection:
            legislator = connection
        row = {
            "candidateId": record.id,
            "profileUrl": f"/candidates/{record.id}",
            "name": profile["candidate"]["name"],
            "election": copy.deepcopy(profile["election"]),
            "office": profile["office"],
            "votingArea": profile["votingArea"],
            "source": copy.deepcopy(profile["source"]),
            "isJointTicket": profile.get(
                "isJointTicket", profile.get("office") == "Governor & Lt Governor"
            ),
        }
        outcome = candidate_result(db, record.id, profile)
        if outcome:
            row["result"] = outcome
        result.append(row)
    return result, legislator


def research_records(
    db: Session,
    person_id: uuid.UUID,
    *,
    kind: str | None = None,
    cursor: str | None = None,
    limit: int = 20,
) -> dict:
    if kind not in {None, "official-record", "article", "debate"}:
        raise ValueError("Unsupported research type")
    # Later types can be selected, but no synthetic material is generated.
    query = select(PersonResearchRecord).where(
        PersonResearchRecord.person_id == person_id
    )
    if kind:
        query = query.where(PersonResearchRecord.kind == kind)
    if cursor:
        if not re.fullmatch(r"[a-f0-9]{64}", cursor):
            raise ValueError("Invalid research cursor")
        anchor = db.get(PersonResearchRecord, cursor)
        if (
            anchor is None
            or anchor.person_id != person_id
            or (kind and anchor.kind != kind)
        ):
            raise ValueError("Invalid research cursor")
        from sqlalchemy import and_, or_

        query = query.where(
            or_(
                PersonResearchRecord.sort_date < anchor.sort_date,
                and_(
                    PersonResearchRecord.sort_date == anchor.sort_date,
                    PersonResearchRecord.id > cursor,
                ),
            )
        )
    limit = max(1, min(limit, 50))
    rows = db.scalars(
        query.order_by(
            PersonResearchRecord.sort_date.desc(), PersonResearchRecord.id
        ).limit(limit + 1)
    ).all()
    return {
        "items": [copy.deepcopy(row.public_payload) for row in rows[:limit]],
        "nextCursor": rows[limit - 1].id if len(rows) > limit else None,
    }


def load_person(
    db: Session, person_id: str, *, now: datetime | None = None
) -> dict | None:
    pid = _uuid(person_id)
    person = db.get(PublicPerson, pid) if pid else None
    if person is None:
        return None
    today = (now or datetime.now(UTC)).astimezone(MINNESOTA).date()
    elections, connection = _election_rows(db, person, today=today)
    service = [
        copy.deepcopy(row.public_payload)
        for row in db.scalars(
            select(PersonServiceRecord).where(PersonServiceRecord.person_id == pid)
        ).all()
    ]
    # An elapsed expected date never promotes elected-to into confirmed service.
    for item in service:
        if item["status"] == "elected":
            expected = item.get("expectedStart", {}).get("value")
            item["currentServiceConfirmed"] = False
            item["expectedStartPassed"] = bool(
                expected and today > _last_precision_date(expected)
            )
        # A retained current roster proves service at its check time. A term's
        # end cannot silently extend that evidence into a later term.
        term_end = item.get("expectedEnd", {}).get("value") or item.get(
            "termEnd", {}
        ).get("value")
        if (
            item["status"] == "current"
            and term_end
            and today > _last_precision_date(term_end)
        ):
            item["status"] = "unknown"
            item["currentServiceConfirmed"] = False
    if connection and connection["serviceStatus"] in {"current", "former"}:
        entry = {
            "id": f"legislator:{connection['id']}",
            "status": connection["serviceStatus"],
            "office": connection["office"],
            "votingArea": connection["votingArea"],
            "profileUrl": connection["profileUrl"],
        }
        for field in ("source", "startDate", "endDate"):
            if connection.get(field):
                entry[field] = connection[field]
        service.append(entry)
    order = {"current": 0, "elected": 1, "former": 2, "unknown": 3}
    service.sort(
        key=lambda x: (
            order[x["status"]],
            -_service_sort_date(x).toordinal(),
            x.get("office", ""),
        )
    )
    response = {
        "id": str(person.id),
        "name": person.name,
        "service": service,
        "elections": elections,
        "research": research_records(db, person.id),
    }
    if connection:
        response["legislator"] = {
            "slug": connection["slug"],
            "profileUrl": connection["profileUrl"],
        }
    return response


def _last_precision_date(value: str) -> date:
    """A month or year is not an invented first-day service date."""
    if re.fullmatch(r"\d{4}", value):
        return date(int(value), 12, 31)
    if re.fullmatch(r"\d{4}-\d{2}", value):
        year, month = map(int, value.split("-"))
        return date(year, month, calendar.monthrange(year, month)[1])
    return date.fromisoformat(value)


def _service_sort_date(item: dict) -> date:
    value = (
        item.get("startDate")
        or item.get("expectedStart", {}).get("value")
        or item.get("termStart", {}).get("value")
    )
    return _last_precision_date(value) if value else date.min


def person_for_legislator(
    db: Session, slug: str, *, now: datetime | None = None
) -> dict | None:
    person = db.scalar(
        select(PublicPerson)
        .join(Legislator, Legislator.id == PublicPerson.legislator_id)
        .where(Legislator.slug == slug)
    )
    if person is None:
        return None
    _, confirmed = _election_rows(
        db, person, today=(now or datetime.now(UTC)).astimezone(MINNESOTA).date()
    )
    return _person_link(person) if confirmed else None
