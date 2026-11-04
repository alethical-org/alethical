"""Held profile links that may lead to checked TV files; no name matching."""

from dataclasses import dataclass
from datetime import datetime
from uuid import UUID
from zoneinfo import ZoneInfo

from sqlalchemy import select
from sqlalchemy.orm import Session

from alethical.api.services import identity_confirmations as identities
from alethical.api.services import person_records
from alethical.api.services.legislator_finance import confirmed_committee_links
from alethical.db import models as m


@dataclass(frozen=True)
class ConnectionGroup:
    kind: str
    label: str
    targets: frozenset[tuple[str, str]]


def _uuid(value):
    try:
        return UUID(str(value))
    except ValueError:
        return None


def _owner(db, kind, key):
    confirmation = identities._standing(db, kind, key)
    return identities._today(db, confirmation.entity_id) if confirmation else None


def _identifiers(db, owner):
    if owner is None or owner.status != "active":
        return set()
    owners = [owner.id, *identities._merged_in(db, owner.id)]
    return set(
        db.execute(
            select(
                m.IdentityConfirmation.record_kind, m.IdentityConfirmation.record_key
            ).where(
                m.IdentityConfirmation.entity_id.in_(owners),
                m.IdentityConfirmation.active,
                m.IdentityConfirmation.record_kind.in_(
                    ["committee", "principal", "legislator", "public_person"]
                ),
            )
        )
    )


def groups(db: Session, kind: str, target: str) -> list[ConnectionGroup]:
    """Resolve only an explicit profile's confirmed identifiers and valid candidacies.

    A merged identity follows its successor. A split parent has no combined
    identity left to assert, so it supplies no union of its former records.
    """
    key = _uuid(target)
    owner = None
    identifiers = set()
    if kind == "legislator":
        member = (
            db.get(m.Legislator, key)
            if key
            else db.scalar(select(m.Legislator).where(m.Legislator.slug == target))
        )
        if member is None:
            raise LookupError("Not found")
        identifiers.add(("legislator", str(member.id)))
        owner = _owner(db, "legislator", str(member.id))
    elif kind == "person" and key and (person := db.get(m.PublicPerson, key)):
        identifiers.add(("public_person", str(person.id)))
        owner = _owner(db, "public_person", str(person.id))
    else:
        original = db.get(m.IdentityEntity, key) if key else None
        if original is None or original.kind != kind:
            raise LookupError("Not found")
        owner = identities._today(db, original.id)
    identifiers |= _identifiers(db, owner)
    if kind == "organization":
        targets = frozenset(
            (k, v) for k, v in identifiers if k in {"committee", "principal"}
        )
        return [ConnectionGroup("named", "", targets)] if targets else []

    people = {UUID(v) for k, v in identifiers if k == "public_person"}
    legislators = {UUID(v) for k, v in identifiers if k == "legislator"}
    if people:
        legislators.update(
            db.scalars(
                select(m.PublicPerson.legislator_id).where(
                    m.PublicPerson.id.in_(people),
                    m.PublicPerson.legislator_id.is_not(None),
                )
            )
        )
    if legislators:
        people.update(
            db.scalars(
                select(m.PublicPerson.id).where(
                    m.PublicPerson.legislator_id.in_(legislators)
                )
            )
        )
    committees = {v: None for k, v in identifiers if k == "committee"}
    for legislator_id in sorted(legislators):
        for link in confirmed_committee_links(db, legislator_id):
            committees[link.registration_number] = link.committee_name
    # Use the same source-identity and confirmed legislator guard as People.
    candidates = set()
    if people:
        today = datetime.now(ZoneInfo("America/Chicago")).date()
        for link, person, record in db.execute(
            select(m.PersonCandidacy, m.PublicPerson, m.CandidateRecord)
            .join(m.PublicPerson, m.PublicPerson.id == m.PersonCandidacy.person_id)
            .join(
                m.CandidateRecord,
                m.CandidateRecord.id == m.PersonCandidacy.candidate_id,
            )
            .where(m.PersonCandidacy.person_id.in_(people))
        ):
            if person_records._valid_people(
                db, [(link, person)], record.public_payload, today=today
            ):
                candidates.add(("candidate", record.id))
    pointer = db.get(m.CampaignFinanceFilingCurrentSnapshot, True)
    if pointer and pointer.snapshot_id and committees:
        for number, name in db.execute(
            select(
                m.CampaignFinanceFiler.registration_number, m.CampaignFinanceFiler.name
            ).where(
                m.CampaignFinanceFiler.snapshot_id == pointer.snapshot_id,
                m.CampaignFinanceFiler.registration_number.in_(committees),
            )
        ):
            committees[number] = name
    result = [
        ConnectionGroup(
            "committee",
            f"Files with a checked connection to {name or 'registration ' + number}",
            frozenset({("committee", number)}),
        )
        for number, name in sorted(committees.items())
    ]
    if candidates:
        result.append(
            ConnectionGroup(
                "named", "Station files that name this candidate", frozenset(candidates)
            )
        )
    return result
