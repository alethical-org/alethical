"""Alethical Finance's identity confirmations: people and organizations across records.

An identity ties records together only through a link that names its evidence: a
saved source row, the words it prints, and the reason the reviewer gives. Equal
names or numbers are never enough on their own, and the evidence row must print
the exact spelling or number the link claims (Finance decisions D23 and D24;
docs/architecture/alethical-finance-architecture.md).

Every change is kept: a withdrawn link stays with its date and reason, a merged
identity redirects to the one it joined, and a split identity lists what replaced
it. ``made_by_alethical_team`` is recorded on every change and never served to
Finance; it decides only what alethical.com may print.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any
from urllib.parse import urlsplit
from uuid import UUID

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from alethical.db import models as m

MAX_TEXT = 2000
MAX_KEY = 500
MIN_QUOTE = 3
# Saved source rows are numbered by a PostgreSQL integer.
MAX_ROW = 2**31 - 1

# What each kind of record is keyed by, and which saved source rows may show it.
# A name kind compares the row's printed column exactly; a number kind compares the
# row's registration number or principal id.
_NAME_COLUMNS: dict[str, dict[str, Any]] = {
    "donor_name": {"cf_contribution_row": m.CampaignFinanceContributionRow.contributor},
    "employer_name": {
        "cf_contribution_row": m.CampaignFinanceContributionRow.contrib_employer_name
    },
    "payee_name": {"cf_expenditure_row": m.CampaignFinanceExpenditureRow.vendor_name},
    "independent_payee_name": {
        "cf_independent_expenditure_row": (
            m.CampaignFinanceIndependentExpenditureRow.vendor_name
        )
    },
    "committee": {"cf_filer": m.CampaignFinanceFiler.registration_number},
    "lobbyist": {"lobbyist_row": m.LobbyistRow.registration_number},
    "principal": {"lobbying_expenditure_row": m.LobbyingExpenditureRow.entity_id},
}
# Records Alethical already holds by id; their evidence is an official page.
_HELD_RECORDS = {"legislator": m.Legislator, "public_person": m.PublicPerson}
# Minnesota's own sites: the Legislature, the House, the Senate, the Revisor, the
# Campaign Finance Board, the Secretary of State and every other mn.gov office. A
# legislator's own profile page on record also counts.
_OFFICIAL_DOMAINS = ("mn.gov", "senate.mn", "state.mn.us")

_ROW_MODELS = {
    "cf_contribution_row": m.CampaignFinanceContributionRow,
    "cf_expenditure_row": m.CampaignFinanceExpenditureRow,
    "cf_independent_expenditure_row": m.CampaignFinanceIndependentExpenditureRow,
    "lobbying_expenditure_row": m.LobbyingExpenditureRow,
}
_REGISTERED_MODELS = {
    "cf_filer": m.CampaignFinanceFiler,
    "lobbyist_row": m.LobbyistRow,
}


class IdentityError(ValueError):
    """A request that cannot be saved as asked; the message says why."""


class NotFound(LookupError):
    """No identity or link has that id."""


def _object(value: Any, label: str) -> dict:
    if not isinstance(value, dict):
        raise IdentityError(f"{label} must be an object")
    return value


def _text(value: Any, label: str, limit: int = MAX_TEXT) -> str:
    if not isinstance(value, str) or not value.strip():
        raise IdentityError(f"{label} is required")
    if len(value) > limit:
        raise IdentityError(f"{label} is too long")
    if "\x00" in value:
        raise IdentityError(f"{label} contains a character that cannot be saved")
    return value.strip()


def _official(url: Any, held: Any) -> str:
    if not isinstance(url, str) or len(url) > MAX_TEXT or "\x00" in url:
        raise IdentityError("Give the official page's https address")
    if url == getattr(held, "profile_url", None):
        return url
    try:
        parts = urlsplit(url)
        host = (parts.hostname or "").lower()
    except ValueError:
        raise IdentityError("Give the official page's https address") from None
    if parts.scheme != "https" or any(c.isspace() for c in url):
        raise IdentityError("Give the official page's https address")
    if not any(host == d or host.endswith(f".{d}") for d in _OFFICIAL_DOMAINS):
        raise IdentityError("The page must be on an official Minnesota site")
    return url


@dataclass(frozen=True)
class _Evidence:
    source: str
    snapshot_id: UUID | None
    locator: str | None
    url: str | None
    quote: str


def _evidence(db: Session, kind: str, key: str, data: dict) -> _Evidence:
    """Check the evidence prints exactly the record the link claims."""
    source = data.get("evidence_source")
    quote = _text(data.get("evidence_quote"), "Quotation from the evidence")
    if len(quote) < MIN_QUOTE:
        raise IdentityError(f"Quote at least {MIN_QUOTE} characters of the evidence")
    if kind in _HELD_RECORDS:
        if source != "official_page":
            raise IdentityError("This record's evidence is an official page")
        try:
            held_id = UUID(key)
        except ValueError:
            held_id = None
        # 1 spelling per record, so a differently written id is never a second one.
        if held_id is None or str(held_id) != key:
            raise IdentityError("Give the record's id exactly as held")
        held = db.get(_HELD_RECORDS[kind], held_id)
        if held is None:
            raise IdentityError("No such record is held")
        url = _official(data.get("evidence_url"), held)
        return _Evidence(source, None, None, url, quote)
    columns = _NAME_COLUMNS.get(kind)
    if columns is None or source not in columns:
        raise IdentityError("This evidence cannot show this kind of record")
    try:
        snapshot_id = UUID(str(data.get("evidence_snapshot_id")))
    except ValueError:
        raise IdentityError("Name the saved source copy") from None
    locator = data.get("evidence_locator")
    if source in _ROW_MODELS:
        if (
            isinstance(locator, bool)
            or not isinstance(locator, int)
            or not 1 <= locator <= MAX_ROW
        ):
            raise IdentityError("Name the row in the saved source copy")
        row = db.get(_ROW_MODELS[source], (snapshot_id, locator))
    else:
        row = db.get(_REGISTERED_MODELS[source], (snapshot_id, key))
        locator = key
    if row is None:
        raise IdentityError("No such row is held in that source copy")
    printed = getattr(row, columns[source].key)
    if printed != key:
        raise IdentityError("The evidence row does not print this exact record")
    # The quotation stands inside 1 printed value, never across 2 of them.
    values = (
        value
        for column in row.__table__.columns
        if isinstance(value := getattr(row, column.key), str)
    )
    if not any(quote.casefold() in value.casefold() for value in values):
        raise IdentityError("The quotation must appear in the evidence row")
    return _Evidence(source, snapshot_id, str(locator), None, quote)


def _link(db: Session, entity: m.IdentityEntity, data: Any, *, team: bool):
    data = _object(data, "The record")
    kind = data.get("record_kind")
    if kind not in m.IDENTITY_RECORD_KINDS:
        raise IdentityError("Unsupported kind of record")
    if (kind == "legislator" or kind == "public_person") and entity.kind != "person":
        raise IdentityError("Only a person holds this kind of record")
    key = _text(data.get("record_key"), "Record", MAX_KEY)
    if key != data.get("record_key"):
        raise IdentityError("Give the record exactly as printed")
    evidence = _evidence(db, kind, key, data)
    if _standing(db, kind, key) is not None:
        raise IdentityError("This record is already confirmed for an identity")
    link = m.IdentityLink(
        entity_id=entity.id,
        record_kind=kind,
        record_key=key,
        relation=_text(data.get("relation"), "Relation", 300),
        evidence_source=evidence.source,
        evidence_snapshot_id=evidence.snapshot_id,
        evidence_locator=evidence.locator,
        evidence_url=evidence.url,
        evidence_quote=evidence.quote,
        basis=_text(data.get("basis"), "Basis"),
        made_by_alethical_team=team,
        checked_at=func.clock_timestamp(),
    )
    db.add(link)
    db.flush()
    _event(db, entity, "linked", {"link_id": str(link.id)}, team=team)
    return link


def _standing(db: Session, kind: str, key: str) -> m.IdentityLink | None:
    """The record's confirmed link, if any; the database allows at most 1."""
    return db.scalar(
        select(m.IdentityLink).where(
            m.IdentityLink.record_kind == kind,
            m.IdentityLink.record_key == key,
            m.IdentityLink.status == "confirmed",
        )
    )


def _event(db: Session, entity, action: str, detail: dict, *, team: bool) -> None:
    db.add(
        m.IdentityEvent(
            entity_id=entity.id,
            action=action,
            detail=detail,
            made_by_alethical_team=team,
            # The moment of the insert, not of the transaction, so history from
            # 1 request keeps its order.
            created_at=func.clock_timestamp(),
        )
    )


def _active(db: Session, *entity_ids: UUID) -> list[m.IdentityEntity]:
    """The identities, locked in id order so 2 opposite merges never deadlock."""
    locked = {
        entity.id: entity
        for entity in db.scalars(
            select(m.IdentityEntity)
            .where(m.IdentityEntity.id.in_(entity_ids))
            .order_by(m.IdentityEntity.id)
            .with_for_update()
        )
    }
    for entity_id in entity_ids:
        if entity_id not in locked:
            raise NotFound("Not found")
        if locked[entity_id].status != "active":
            raise IdentityError(
                "This identity was merged or split; use what replaced it"
            )
    return [locked[entity_id] for entity_id in entity_ids]


def _confirmed(db: Session, entity: m.IdentityEntity) -> list[m.IdentityLink]:
    return list(
        db.scalars(
            select(m.IdentityLink)
            .where(
                m.IdentityLink.entity_id == entity.id,
                m.IdentityLink.status == "confirmed",
            )
            .order_by(m.IdentityLink.checked_at, m.IdentityLink.id)
        )
    )


def create(db: Session, data: dict, *, team: bool) -> m.IdentityEntity:
    """A new identity with its first confirmed record."""
    kind = data.get("kind")
    if kind not in ("person", "organization"):
        raise IdentityError("An identity is a person or an organization")
    entity = m.IdentityEntity(
        kind=kind,
        name=_text(data.get("name"), "Name", 300),
        made_by_alethical_team=team,
    )
    db.add(entity)
    db.flush()
    _event(db, entity, "created", {"name": entity.name}, team=team)
    _link(db, entity, data.get("link"), team=team)
    return entity


def add_link(db: Session, entity_id: UUID, data: dict, *, team: bool) -> m.IdentityLink:
    [entity] = _active(db, entity_id)
    return _link(db, entity, data, team=team)


def withdraw_link(
    db: Session, link_id: UUID, data: dict, *, team: bool
) -> m.IdentityLink:
    """Take back 1 confirmation, keeping it with its date and reason."""
    link = db.scalar(
        select(m.IdentityLink).where(m.IdentityLink.id == link_id).with_for_update()
    )
    if link is None:
        raise NotFound("Not found")
    if link.status != "confirmed":
        raise IdentityError("This confirmation was already withdrawn")
    [entity] = _active(db, link.entity_id)
    link.status = "withdrawn"
    link.withdrawn_at = func.now()
    link.withdrawal_reason = _text(data.get("reason"), "Reason")
    db.flush()
    _event(db, entity, "withdrawn", {"link_id": str(link.id)}, team=team)
    return link


def merge(db: Session, entity_id: UUID, data: dict, *, team: bool) -> m.IdentityEntity:
    """Join 1 identity into another; its address then redirects there.

    Its confirmed records move; withdrawn ones stay with it as its history.
    """
    reason = _text(data.get("reason"), "Reason")
    try:
        into_id = UUID(str(data.get("into")))
    except ValueError:
        raise IdentityError("Name the identity to merge into") from None
    if into_id == entity_id:
        raise IdentityError("An identity cannot merge into itself")
    source, target = _active(db, entity_id, into_id)
    if source.kind != target.kind:
        raise IdentityError("A person and an organization cannot merge")
    moved = _confirmed(db, source)
    for link in moved:
        link.entity_id = target.id
    source.status, source.merged_into_id = "merged", target.id
    detail = {
        "from": str(source.id),
        "into": str(target.id),
        "links": [str(link.id) for link in moved],
        "reason": reason,
    }
    _event(db, source, "merged", detail, team=team)
    _event(db, target, "merged", detail, team=team)
    db.flush()
    return target


def split(
    db: Session, entity_id: UUID, data: dict, *, team: bool
) -> list[m.IdentityEntity]:
    """Divide 1 identity into 2 or more; its address then lists what replaced it.

    Every confirmed record goes to exactly 1 part and every part gets at least 1,
    so nothing is lost or counted twice; withdrawn records stay with the identity
    as its history.
    """
    reason = _text(data.get("reason"), "Reason")
    parts = data.get("parts")
    if not isinstance(parts, list) or len(parts) < 2:
        raise IdentityError("A split needs at least 2 parts")
    [source] = _active(db, entity_id)
    owned = {str(link.id): link for link in _confirmed(db, source)}
    assigned: list[str] = []
    for part in parts:
        part = _object(part, "Each part")
        links = part.get("links")
        if not isinstance(links, list) or not links:
            raise IdentityError("Each part lists at least 1 of its records")
        if not all(isinstance(link_id, str) for link_id in links):
            raise IdentityError("Each part lists its records by id")
        assigned.extend(links)
    if sorted(assigned) != sorted(owned) or len(set(assigned)) != len(assigned):
        raise IdentityError("Give every record of this identity to exactly 1 part")
    created = []
    for part in parts:
        entity = m.IdentityEntity(
            kind=source.kind,
            name=_text(part.get("name"), "Name", 300),
            made_by_alethical_team=team,
        )
        db.add(entity)
        db.flush()
        for link_id in part["links"]:
            owned[link_id].entity_id = entity.id
        created.append(entity)
    source.status = "split"
    detail = {
        "from": str(source.id),
        "into": [str(entity.id) for entity in created],
        "parts": [
            {"id": str(entity.id), "links": part["links"]}
            for entity, part in zip(created, parts, strict=True)
        ],
        "reason": reason,
    }
    _event(db, source, "split", detail, team=team)
    for entity in created:
        _event(db, entity, "created", {"split_from": str(source.id)}, team=team)
    db.flush()
    return created


def _iso(value) -> str | None:
    return value.isoformat() if value else None


def _link_payload(link: m.IdentityLink) -> dict:
    return {
        "id": str(link.id),
        "record_kind": link.record_kind,
        "record_key": link.record_key,
        "relation": link.relation,
        "status": link.status,
        "checked_at": _iso(link.checked_at),
        "withdrawn_at": _iso(link.withdrawn_at),
        "withdrawal_reason": link.withdrawal_reason,
        "basis": link.basis,
        "evidence": {
            "source": link.evidence_source,
            "snapshot_id": str(link.evidence_snapshot_id)
            if link.evidence_snapshot_id
            else None,
            "locator": link.evidence_locator,
            "url": link.evidence_url,
            "quote": link.evidence_quote,
        },
    }


def read(db: Session, entity_id: UUID) -> dict:
    """1 identity as Finance shows it; who made each change is never included."""
    entity = db.get(m.IdentityEntity, entity_id)
    if entity is None:
        raise NotFound("Not found")
    payload: dict[str, Any] = {
        "id": str(entity.id),
        "kind": entity.kind,
        "name": entity.name,
        "status": entity.status,
        "created_at": _iso(entity.created_at),
    }
    if entity.status == "merged":
        # Follow every later merge to the identity that stands today, or to the
        # split identity that lists what replaced it.
        current, seen = entity, {entity.id}
        while current.status == "merged" and current.merged_into_id not in seen:
            seen.add(current.merged_into_id)
            current = db.get(m.IdentityEntity, current.merged_into_id)
        payload["redirect_to"] = str(current.id)
    events = db.scalars(
        select(m.IdentityEvent)
        .where(m.IdentityEvent.entity_id == entity.id)
        .order_by(m.IdentityEvent.created_at, m.IdentityEvent.id)
    ).all()
    if entity.status == "split":
        parts = next(
            (event.detail["into"] for event in events if event.action == "split"), []
        )
        payload["split_into"] = [
            {"id": str(part.id), "name": part.name}
            for part in db.scalars(
                select(m.IdentityEntity).where(
                    m.IdentityEntity.id.in_([UUID(value) for value in parts])
                )
            )
        ]
    links = db.scalars(
        select(m.IdentityLink)
        .where(m.IdentityLink.entity_id == entity.id)
        .order_by(m.IdentityLink.checked_at, m.IdentityLink.id)
    ).all()
    payload["records"] = [_link_payload(link) for link in links]
    payload["history"] = [
        {
            "action": event.action,
            "at": _iso(event.created_at),
            "detail": event.detail,
        }
        for event in events
    ]
    return payload


def lookup(db: Session, record_kind: str, record_key: str) -> dict | None:
    """The identity a record is confirmed for, or None: no inference, ever."""
    if record_kind not in m.IDENTITY_RECORD_KINDS:
        raise IdentityError("Unsupported kind of record")
    if "\x00" in record_key:
        raise IdentityError("Record contains a character that cannot be read")
    link = _standing(db, record_kind, record_key)
    if link is None:
        return None
    entity = db.get(m.IdentityEntity, link.entity_id)
    return {
        "identity": {"id": str(entity.id), "kind": entity.kind, "name": entity.name},
        "record": _link_payload(link),
    }
