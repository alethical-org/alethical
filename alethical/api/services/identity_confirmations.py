"""Alethical Finance's identity confirmations: people and organizations across records.

An identity ties records together only through a confirmation that names its
evidence: a saved source row or an official page, words quoted from it, and the
reviewer's basis. Equal names or numbers are never enough on their own (Finance
decisions D23 and D24; docs/architecture/alethical-finance-architecture.md §4).

A printed name (a donor, an employer, a payee) is confirmed record by record. Each
record is kept as a content fingerprint of its printed fields and matched against the
Board's current file on every read, so a refresh re-matches it, identical repeated
rows share it, a record that leaves the file shows as no longer there, and a new
record is never covered until someone confirms it. A registration number, a principal
id or a held record's id is itself an identifier and is confirmed whole.

Confirmations are append-only: the 1 change ever made to one is its withdrawal. A
merge moves nothing; the merged identity keeps its confirmations and redirects to the
identity standing today. A split withdraws each confirmation it moves and makes a
replacement on the part that takes it. ``made_by_alethical_team`` is recorded on every
identity, confirmation and event and never served to Finance; it decides only what
alethical.com may print.
"""

from __future__ import annotations

import re
from collections import defaultdict
from dataclasses import dataclass
from itertools import chain
from typing import Any
from urllib.parse import urlsplit
from uuid import UUID

from sqlalchemy import Numeric, Text, any_, cast, func, literal, literal_column, select
from sqlalchemy.dialects.postgresql import ARRAY, aggregate_order_by
from sqlalchemy.orm import Session

from alethical.db import models as m
from alethical.pipeline import campaign_finance_reader as reader

Dataset = m.CampaignFinanceDataset
Entity = m.IdentityEntity
Confirmation = m.IdentityConfirmation
Record = m.IdentityConfirmedRecord

MAX_TEXT = 2000
MAX_KEY = 500
MAX_NAME = 300
MIN_QUOTE = 3
# Saved source rows are numbered by a PostgreSQL integer.
MAX_ROW = 2**31 - 1
# Listings are bounded; a confirmation may cover every matching record.
MAX_PAGE_SIZE = 500
_FINGERPRINT = re.compile(r"[0-9a-f]{64}")
# An official page's address: printable ASCII with no backslash, so no space,
# control character or anything a browser would rewrite into another host.
_URL_CHARACTERS = re.compile(r"[!-\[\]-~]+")
# Minnesota's own sites: the Legislature, the House, the Senate, the Revisor, the
# Campaign Finance Board, the Secretary of State and every other mn.gov office.
_OFFICIAL_DOMAINS = ("mn.gov", "senate.mn", "state.mn.us")


@dataclass(frozen=True)
class _PrintedName:
    """Where a printed name appears, and the printed fields that identify its record."""

    model: Any
    dataset: Dataset
    name: Any
    fields: tuple[Any, ...]
    evidence_source: str

    def printed_fields(self):
        """The record's fingerprinted fields as JSON, each amount as printed text."""
        return func.jsonb_build_object(
            *chain.from_iterable(
                (
                    cast(literal(column.key), Text),
                    cast(column, Text) if isinstance(column.type, Numeric) else column,
                )
                for column in self.fields
            )
        )

    def fingerprint(self, kind: str):
        """sha256, in hex, of the record kind, the file and the printed fields.

        Only the database computes it, so every fingerprint is made the same way,
        and the stored ``fields`` alone are enough to recompute it.
        """
        printed = func.jsonb_build_array(
            cast(literal(kind), Text),
            cast(literal(self.dataset.value), Text),
            self.printed_fields(),
        )
        utf8 = func.convert_to(cast(printed, Text), literal_column("'UTF8'"))
        return func.encode(func.sha256(utf8), literal_column("'hex'"))


_Gave = m.CampaignFinanceContributionRow
_Paid = m.CampaignFinanceExpenditureRow
_Independent = m.CampaignFinanceIndependentExpenditureRow
_GIFT_FIELDS = (
    _Gave.contributor,
    _Gave.contrib_employer_name,
    _Gave.recipient_reg_num,
    _Gave.receipt_date,
    _Gave.amount,
    _Gave.contrib_zip,
)
_PRINTED = {
    "donor_name": _PrintedName(
        _Gave,
        Dataset.contributions,
        _Gave.contributor,
        _GIFT_FIELDS,
        "cf_contribution_row",
    ),
    "employer_name": _PrintedName(
        _Gave,
        Dataset.contributions,
        _Gave.contrib_employer_name,
        _GIFT_FIELDS,
        "cf_contribution_row",
    ),
    "payee_name": _PrintedName(
        _Paid,
        Dataset.expenditures,
        _Paid.vendor_name,
        (
            _Paid.vendor_name,
            _Paid.committee_reg_num,
            _Paid.transaction_date,
            _Paid.amount,
            _Paid.vendor_zip,
        ),
        "cf_expenditure_row",
    ),
    "independent_payee_name": _PrintedName(
        _Independent,
        Dataset.independent_expenditures,
        _Independent.vendor_name,
        (
            _Independent.vendor_name,
            _Independent.spender_reg_num,
            _Independent.transaction_date,
            _Independent.amount,
            _Independent.vendor_zip,
        ),
        "cf_independent_expenditure_row",
    ),
}
# An identifier, the saved rows that show it and the column printing it.
_IDENTIFIERS = {
    "committee": ("cf_filer", m.CampaignFinanceFiler.registration_number),
    "lobbyist": ("lobbyist_row", m.LobbyistRow.registration_number),
    "principal": ("lobbying_expenditure_row", m.LobbyingExpenditureRow.entity_id),
}
# Records Alethical already holds by id; their evidence is an official page.
_HELD_RECORDS = {"legislator": m.Legislator, "public_person": m.PublicPerson}
_ROW_MODELS = {
    "cf_contribution_row": _Gave,
    "cf_expenditure_row": _Paid,
    "cf_independent_expenditure_row": _Independent,
    "lobbying_expenditure_row": m.LobbyingExpenditureRow,
}
_REGISTERED_MODELS = {
    "cf_filer": m.CampaignFinanceFiler,
    "lobbyist_row": m.LobbyistRow,
}


class IdentityError(ValueError):
    """A request that cannot be saved as asked; the message says why."""


class NotFound(Exception):
    """No identity or confirmation has that id."""


class Unavailable(RuntimeError):
    """The Board's current file is not loaded, so records cannot be matched."""


def _object(value: Any, label: str) -> dict:
    if not isinstance(value, dict):
        raise IdentityError(f"{label} must be an object")
    return value


def _savable(value: str) -> bool:
    """PostgreSQL text holds neither NUL nor a lone UTF-16 surrogate."""
    try:
        value.encode("utf-8")
    except UnicodeEncodeError:
        return False
    return "\x00" not in value


def _text(value: Any, label: str, limit: int = MAX_TEXT) -> str:
    if not isinstance(value, str) or not value.strip():
        raise IdentityError(f"{label} is required")
    if len(value) > limit:
        raise IdentityError(f"{label} is too long")
    if not _savable(value):
        raise IdentityError(f"{label} contains a character that cannot be saved")
    return value.strip()


def _uuid(value: Any, message: str) -> UUID:
    if not isinstance(value, str):
        raise IdentityError(message)
    try:
        return UUID(value)
    except ValueError:
        raise IdentityError(message) from None


def _kind(value: Any) -> str:
    if not isinstance(value, str) or value not in m.IDENTITY_RECORD_KINDS:
        raise IdentityError("Unsupported kind of record")
    return value


def _key(kind: str, value: Any) -> str:
    """The record exactly as printed or held: never a second spelling of it."""
    key = _text(value, "Record", MAX_KEY)
    if key != value:
        raise IdentityError("Give the record exactly as printed")
    if kind in _HELD_RECORDS:
        try:
            held = UUID(key)
        except ValueError:
            held = None
        if held is None or str(held) != key:
            raise IdentityError("Give the record's id exactly as held")
    return key


def _official(url: Any) -> str:
    """An https page on 1 of Minnesota's own sites."""
    if (
        not isinstance(url, str)
        or len(url) > MAX_TEXT
        or not _URL_CHARACTERS.fullmatch(url)
    ):
        raise IdentityError("Give the official page's https address")
    try:
        parts = urlsplit(url)
        host = (parts.hostname or "").lower()
    except ValueError:
        raise IdentityError("Give the official page's https address") from None
    if parts.scheme != "https":
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
    """Check the evidence prints exactly the record the confirmation claims."""
    source = data.get("evidence_source")
    quote = _text(data.get("evidence_quote"), "Quotation from the evidence")
    if len(quote) < MIN_QUOTE:
        raise IdentityError(f"Quote at least {MIN_QUOTE} characters of the evidence")
    if kind in _HELD_RECORDS:
        if source != "official_page":
            raise IdentityError("This record's evidence is an official page")
        if db.get(_HELD_RECORDS[kind], UUID(key)) is None:
            raise IdentityError("No such record is held")
        return _Evidence(source, None, None, _official(data.get("evidence_url")), quote)
    if kind in _PRINTED:
        expected, column = _PRINTED[kind].evidence_source, _PRINTED[kind].name
    else:
        expected, column = _IDENTIFIERS[kind]
    if source != expected:
        raise IdentityError("This evidence cannot show this kind of record")
    snapshot_id = _uuid(data.get("evidence_snapshot_id"), "Name the saved source copy")
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
    if getattr(row, column.key) != key:
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


def _current_snapshot(db: Session, dataset: Dataset) -> UUID | None:
    """The Board's file as published now, or None when no usable copy is held."""
    try:
        release = reader.live_release(db)
        if release is not None:
            reader._refuse_if_rows_are_gone(db, release, dataset)
    except reader.ReleaseNoLongerHeld:
        return None
    return None if release is None else release.file_for(dataset).snapshot_id


def _same_snapshot(snapshot: UUID, expected: Any) -> None:
    if (
        expected is not None
        and _uuid(str(expected), "Select a source copy") != snapshot
    ):
        raise IdentityError(
            "The Board's file changed. Reload the records and select again."
        )


def _fingerprints_in(column, values):
    # Bind 1 array rather than a parameter per record, including names over
    # PostgreSQL's parameter limit. Fingerprints still match exactly.
    return column == any_(cast(list(values), ARRAY(Text)))


def _selected(
    db: Session, kind: str, key: str, value: Any, selection: Any = None
) -> list[tuple[str, dict]]:
    """Selected current records; quick picks resolve only unconfirmed records."""
    printed = _PRINTED[kind]
    snapshot = _current_snapshot(db, printed.dataset)
    if snapshot is None:
        raise Unavailable("The Board's current file is not loaded. Try again later.")
    fingerprint = printed.fingerprint(kind)
    where = [printed.model.snapshot_id == snapshot, printed.name == key]
    if selection is not None:
        if value is not None:
            raise IdentityError(
                "Choose records individually or use a quick selection, not both"
            )
        selection = _object(selection, "The record selection")
        if set(selection) - {"snapshot_id", "year"} or not selection.get("snapshot_id"):
            raise IdentityError(
                "A quick selection needs its source copy and optional year"
            )
        _same_snapshot(snapshot, selection["snapshot_id"])
        year = selection.get("year")
        if year is not None:
            if type(year) is not int or not 1900 <= year <= 2100:
                raise IdentityError("Select a valid record year")
            where.append(printed.model.year == year)
        where.append(
            ~select(Record.fingerprint)
            .where(Record.fingerprint == fingerprint, Record.active)
            .exists()
        )
    else:
        if not isinstance(value, list) or not value:
            raise IdentityError("Select at least 1 record")
        if not all(
            isinstance(item, str) and _FINGERPRINT.fullmatch(item) for item in value
        ):
            raise IdentityError("Select records by the fingerprints the listing gives")
        if len(set(value)) != len(value):
            raise IdentityError("Select each record once")
        where.append(_fingerprints_in(fingerprint, value))
    found = dict(
        db.execute(
            select(fingerprint, printed.printed_fields()).where(*where).distinct()
        ).all()
    )
    if selection is None:
        if missing := len(set(value) - set(found)):
            raise IdentityError(
                f"{missing} of the selected records are not in the Board's current file under this name"
            )
        if taken := _taken(db, value):
            raise IdentityError(
                f"{len(taken)} of the selected records are already confirmed for an identity"
            )
    if not found:
        raise IdentityError("Select at least 1 unconfirmed record")
    # Lock overlapping claims in 1 order, so a race refuses rather than deadlocks.
    return sorted(found.items())


def _taken(db: Session, fingerprints: list[str]) -> list[str]:
    """The fingerprints an active confirmation holds; the database allows 1 each."""
    return list(
        db.scalars(
            select(Record.fingerprint).where(
                _fingerprints_in(Record.fingerprint, fingerprints), Record.active
            )
        )
    )


def _hold(db: Session, confirmation: Confirmation, records) -> None:
    for fingerprint, fields in records:
        db.add(
            Record(
                confirmation_id=confirmation.id,
                fingerprint=fingerprint,
                record_kind=confirmation.record_kind,
                fields=fields,
            )
        )
    db.flush()


def _confirm(db: Session, entity: Entity, data: Any, *, team: bool) -> Confirmation:
    data = _object(data, "The confirmation")
    kind = _kind(data.get("record_kind"))
    if kind in _HELD_RECORDS and entity.kind != "person":
        raise IdentityError("Only a person holds this kind of record")
    key = _key(kind, data.get("record_key"))
    relation = _text(data.get("relation"), "Relation", MAX_NAME)
    basis = _text(data.get("basis"), "Basis")
    evidence = _evidence(db, kind, key, data)
    if kind in _PRINTED:
        records = _selected(
            db, kind, key, data.get("fingerprints"), data.get("record_selection")
        )
    else:
        if (
            data.get("fingerprints") is not None
            or data.get("record_selection") is not None
        ):
            raise IdentityError("An identifier is confirmed whole; select no records")
        if _standing(db, kind, key) is not None:
            raise IdentityError("This record is already confirmed for an identity")
        records = []
    confirmation = Confirmation(
        entity_id=entity.id,
        record_kind=kind,
        record_key=key,
        relation=relation,
        evidence_source=evidence.source,
        evidence_snapshot_id=evidence.snapshot_id,
        evidence_locator=evidence.locator,
        evidence_url=evidence.url,
        evidence_quote=evidence.quote,
        basis=basis,
        made_by_alethical_team=team,
        checked_at=func.clock_timestamp(),
    )
    db.add(confirmation)
    db.flush()
    _hold(db, confirmation, records)
    detail = {"confirmation_id": str(confirmation.id), "records": len(records)}
    _event(db, entity.id, "confirmed", detail, team=team)
    return confirmation


def _standing(db: Session, kind: str, key: str) -> Confirmation | None:
    """An identifier's active confirmation, if any; the database allows at most 1."""
    return db.scalar(
        select(Confirmation).where(
            Confirmation.record_kind == kind,
            Confirmation.record_key == key,
            Confirmation.active,
        )
    )


def _event(db: Session, entity_id: UUID, action: str, detail: dict, *, team: bool):
    db.add(
        m.IdentityEvent(
            entity_id=entity_id,
            action=action,
            detail=detail,
            made_by_alethical_team=team,
            # The moment of the insert, not of the transaction, so history from
            # 1 request keeps its order.
            created_at=func.clock_timestamp(),
        )
    )


def _lock(db: Session, *entity_ids: UUID) -> dict[UUID, Entity]:
    """Lock identities in id order, so 2 opposite merges never deadlock."""
    return {
        entity.id: entity
        for entity in db.scalars(
            select(Entity)
            .where(Entity.id.in_(entity_ids))
            .order_by(Entity.id)
            .with_for_update()
            .execution_options(populate_existing=True)
        )
    }


def _active(db: Session, *entity_ids: UUID) -> list[Entity]:
    locked = _lock(db, *entity_ids)
    for entity_id in entity_ids:
        if entity_id not in locked:
            raise NotFound("Not found")
        if locked[entity_id].status != "active":
            raise IdentityError(
                "This identity was merged or split; use what replaced it"
            )
    return [locked[entity_id] for entity_id in entity_ids]


def _today(db: Session, entity_id: UUID) -> Entity:
    """The identity standing today: the end of every later merge, or a split one."""
    entity = db.get(Entity, entity_id)
    seen = {entity.id}
    while entity.status == "merged" and entity.merged_into_id not in seen:
        seen.add(entity.merged_into_id)
        entity = db.get(Entity, entity.merged_into_id)
    return entity


def _merged_in(db: Session, entity_id: UUID) -> list[UUID]:
    """Every identity merged into this one, directly or through a later merge."""
    found: list[UUID] = []
    frontier = [entity_id]
    while frontier:
        frontier = [
            merged
            for merged in db.scalars(
                select(Entity.id).where(Entity.merged_into_id.in_(frontier))
            )
            if merged not in found and merged != entity_id
        ]
        found.extend(frontier)
    return found


def create(db: Session, data: dict, *, team: bool) -> Entity:
    """A new identity with its first confirmation."""
    kind = data.get("kind")
    if kind not in ("person", "organization"):
        raise IdentityError("An identity is a person or an organization")
    entity = Entity(
        kind=kind,
        name=_text(data.get("name"), "Name", MAX_NAME),
        made_by_alethical_team=team,
    )
    db.add(entity)
    db.flush()
    _event(db, entity.id, "created", {"name": entity.name}, team=team)
    _confirm(db, entity, data.get("confirmation"), team=team)
    return entity


def add_confirmation(
    db: Session, entity_id: UUID, data: dict, *, team: bool
) -> Confirmation:
    [entity] = _active(db, entity_id)
    return _confirm(db, entity, data, team=team)


def _withdraw(confirmation: Confirmation, reason: str) -> None:
    confirmation.active = False
    confirmation.withdrawn_at = func.clock_timestamp()
    confirmation.withdrawal_reason = reason


def withdraw(
    db: Session, confirmation_id: UUID, data: dict, *, team: bool
) -> Confirmation:
    """Take back 1 confirmation everywhere at once, keeping its date and reason."""
    reason = _text(data.get("reason"), "Reason")
    found = db.get(Confirmation, confirmation_id)
    if found is None:
        raise NotFound("Not found")
    # The identity it stands for first, then the confirmation: the order a split
    # takes, so a withdrawal and a split never wait on each other.
    _lock(db, _today(db, found.entity_id).id)
    confirmation = db.scalar(
        select(Confirmation)
        .where(Confirmation.id == confirmation_id)
        .with_for_update()
        .execution_options(populate_existing=True)
    )
    if not confirmation.active:
        raise IdentityError("This confirmation was already withdrawn")
    _withdraw(confirmation, reason)
    db.flush()
    detail = {"confirmation_id": str(confirmation.id)}
    _event(db, confirmation.entity_id, "withdrawn", detail, team=team)
    return confirmation


def merge(db: Session, entity_id: UUID, data: dict, *, team: bool) -> Entity:
    """Join 1 identity into another; it keeps its id and confirmations, and redirects."""
    reason = _text(data.get("reason"), "Reason")
    into_id = _uuid(data.get("into"), "Name the identity to merge into")
    if into_id == entity_id:
        raise IdentityError("An identity cannot merge into itself")
    source, target = _active(db, entity_id, into_id)
    if source.kind != target.kind:
        raise IdentityError("A person and an organization cannot merge")
    source.status, source.merged_into_id = "merged", target.id
    detail = {"from": str(source.id), "into": str(target.id), "reason": reason}
    _event(db, source.id, "merged", detail, team=team)
    _event(db, target.id, "merged", detail, team=team)
    db.flush()
    return target


def _replace(db: Session, old: Confirmation, entity: Entity, *, team: bool):
    """The same evidence, check date and records on another identity, pointing back.

    alethical.com prints only team-made confirmations, so the replacement counts as
    team-made only when the original and the split both were.
    """
    new = Confirmation(
        entity_id=entity.id,
        record_kind=old.record_kind,
        record_key=old.record_key,
        relation=old.relation,
        evidence_source=old.evidence_source,
        evidence_snapshot_id=old.evidence_snapshot_id,
        evidence_locator=old.evidence_locator,
        evidence_url=old.evidence_url,
        evidence_quote=old.evidence_quote,
        basis=old.basis,
        replaces_id=old.id,
        made_by_alethical_team=old.made_by_alethical_team and team,
        # The evidence was checked when the original was, not on the split day.
        checked_at=old.checked_at,
    )
    db.add(new)
    db.flush()
    records = db.execute(
        select(Record.fingerprint, Record.fields)
        .where(Record.confirmation_id == old.id)
        .order_by(Record.fingerprint)
    ).all()
    _hold(db, new, records)
    return new


def split(db: Session, entity_id: UUID, data: dict, *, team: bool) -> list[Entity]:
    """Divide 1 identity into 2 or more; its address then lists what replaced it.

    Every active confirmation standing for it, its own and those of identities merged
    into it, goes to exactly 1 part and every part takes at least 1, so nothing is
    lost or counted twice. Each is withdrawn and replaced on its part; withdrawn ones
    stay behind as history.
    """
    reason = _text(data.get("reason"), "Reason")
    parts = data.get("parts")
    if not isinstance(parts, list) or len(parts) < 2:
        raise IdentityError("A split needs at least 2 parts")
    [source] = _active(db, entity_id)
    standing = {
        str(confirmation.id): confirmation
        for confirmation in db.scalars(
            select(Confirmation)
            .where(
                Confirmation.entity_id.in_([source.id, *_merged_in(db, source.id)]),
                Confirmation.active,
            )
            .order_by(Confirmation.id)
            .with_for_update()
            .execution_options(populate_existing=True)
        )
    }
    assigned: list[str] = []
    names = []
    for part in parts:
        part = _object(part, "Each part")
        moved = part.get("confirmations")
        if not isinstance(moved, list) or not moved:
            raise IdentityError("Each part takes at least 1 confirmation")
        if not all(isinstance(item, str) for item in moved):
            raise IdentityError("Each part lists its confirmations by id")
        assigned.extend(moved)
        names.append(_text(part.get("name"), "Name", MAX_NAME))
    if len(set(assigned)) != len(assigned) or set(assigned) != set(standing):
        raise IdentityError(
            "Give every active confirmation of this identity to exactly 1 part"
        )
    # Withdraw them all first, so each record is free for its replacement.
    for confirmation in standing.values():
        _withdraw(confirmation, reason)
    db.flush()
    created, moves = [], []
    for name, part in zip(names, parts, strict=True):
        entity = Entity(kind=source.kind, name=name, made_by_alethical_team=team)
        db.add(entity)
        db.flush()
        replaced = [
            {"from": old, "to": str(_replace(db, standing[old], entity, team=team).id)}
            for old in part["confirmations"]
        ]
        created.append(entity)
        moves.append({"id": str(entity.id), "confirmations": replaced})
    source.status = "split"
    detail = {
        "from": str(source.id),
        "into": [str(entity.id) for entity in created],
        "parts": moves,
        "reason": reason,
    }
    _event(db, source.id, "split", detail, team=team)
    for entity, move in zip(created, moves, strict=True):
        made = {
            "split_from": str(source.id),
            "confirmations": [item["to"] for item in move["confirmations"]],
        }
        _event(db, entity.id, "created", made, team=team)
    db.flush()
    return created


def _iso(value) -> str | None:
    return value.isoformat() if value else None


def _summary(entity: Entity) -> dict:
    return {"id": str(entity.id), "kind": entity.kind, "name": entity.name}


def _matches(
    db: Session, kind: str, key: str, fingerprints: set[str]
) -> tuple[int, dict[str, int]] | None:
    """How many current rows print a name, and how many each fingerprint matches.

    None when no copy of the Board's file is held, which says nothing either way.
    """
    printed = _PRINTED[kind]
    snapshot = _current_snapshot(db, printed.dataset)
    if snapshot is None:
        return None
    where = (printed.model.snapshot_id == snapshot, printed.name == key)
    total = db.scalar(select(func.count()).select_from(printed.model).where(*where))
    if not fingerprints:
        return total, {}
    fingerprint = printed.fingerprint(kind)
    rows = db.execute(
        select(fingerprint, func.count())
        .where(*where, _fingerprints_in(fingerprint, fingerprints))
        .group_by(fingerprint)
    ).all()
    return total, dict(rows)


def _payloads(db: Session, confirmations: list[Confirmation]) -> tuple[list, list]:
    """Each confirmation as Finance shows it, and each printed name's k of n."""
    ids = [confirmation.id for confirmation in confirmations]
    replaced_by = dict(
        db.execute(
            select(Confirmation.replaces_id, Confirmation.id).where(
                Confirmation.replaces_id.in_(ids)
            )
        ).all()
    )
    held: dict[UUID, list[Record]] = defaultdict(list)
    for record in db.scalars(
        select(Record)
        .where(Record.confirmation_id.in_(ids))
        .order_by(Record.fingerprint)
    ):
        held[record.confirmation_id].append(record)
    names: dict[tuple[str, str], set[str]] = defaultdict(set)
    for confirmation in confirmations:
        if confirmation.record_kind in _PRINTED:
            names[confirmation.record_kind, confirmation.record_key].update(
                record.fingerprint for record in held[confirmation.id]
            )
    matched = {name: _matches(db, *name, prints) for name, prints in names.items()}

    def records(confirmation: Confirmation) -> list | None:
        if confirmation.record_kind not in _PRINTED:
            return None
        found = matched[confirmation.record_kind, confirmation.record_key]
        rows = None if found is None else found[1]
        return [
            {
                "fingerprint": record.fingerprint,
                "fields": record.fields,
                "rows": None if rows is None else rows.get(record.fingerprint, 0),
                "in_board_file": None if rows is None else record.fingerprint in rows,
            }
            for record in held[confirmation.id]
        ]

    payloads = []
    covered: dict[tuple[str, str], int] = defaultdict(int)
    for confirmation in confirmations:
        payload = {
            "id": str(confirmation.id),
            "identity_id": str(confirmation.entity_id),
            "record_kind": confirmation.record_kind,
            "record_key": confirmation.record_key,
            "relation": confirmation.relation,
            "status": "confirmed" if confirmation.active else "withdrawn",
            "checked_at": _iso(confirmation.checked_at),
            "withdrawn_at": _iso(confirmation.withdrawn_at),
            "withdrawal_reason": confirmation.withdrawal_reason,
            "basis": confirmation.basis,
            "replaces": str(confirmation.replaces_id)
            if confirmation.replaces_id
            else None,
            "replaced_by": str(replaced_by[confirmation.id])
            if confirmation.id in replaced_by
            else None,
            "evidence": {
                "source": confirmation.evidence_source,
                "snapshot_id": str(confirmation.evidence_snapshot_id)
                if confirmation.evidence_snapshot_id
                else None,
                "locator": confirmation.evidence_locator,
                "url": confirmation.evidence_url,
                "quote": confirmation.evidence_quote,
            },
            "records": records(confirmation),
        }
        payloads.append(payload)
        if confirmation.active and payload["records"] is not None:
            covered[confirmation.record_kind, confirmation.record_key] += sum(
                record["rows"] or 0 for record in payload["records"]
            )
    # "Confirmed for {k} of {n} records": for each printed name with an active
    # confirmation here, the current rows those cover of all current rows printing it.
    coverage = [
        {
            "record_kind": kind,
            "record_key": key,
            "records": None if matched[kind, key] is None else matched[kind, key][0],
            "confirmed": None if matched[kind, key] is None else covered[kind, key],
        }
        for kind, key in covered
    ]
    return payloads, coverage


def read(db: Session, entity_id: UUID) -> dict:
    """1 identity as Finance shows it; who made each change is never included.

    Its confirmations are its own and those of every identity merged into it.
    """
    entity = db.get(Entity, entity_id)
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
        payload["redirect_to"] = str(_today(db, entity.id).id)
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
            _summary(part)
            for part in db.scalars(
                select(Entity).where(Entity.id.in_([UUID(value) for value in parts]))
            )
        ]
    confirmations = db.scalars(
        select(Confirmation)
        .where(Confirmation.entity_id.in_([entity.id, *_merged_in(db, entity.id)]))
        .order_by(Confirmation.checked_at, Confirmation.id)
    ).all()
    payload["confirmations"], payload["printed_names"] = _payloads(
        db, list(confirmations)
    )
    payload["history"] = [
        {"action": event.action, "at": _iso(event.created_at), "detail": event.detail}
        for event in events
    ]
    return payload


def lookup(db: Session, record_kind: Any, record_key: Any) -> dict | None:
    """The identity an identifier stands for today, or None: no inference, ever."""
    kind = _kind(record_kind)
    if kind in _PRINTED:
        raise IdentityError(
            "A printed name is confirmed record by record; list its records instead"
        )
    confirmation = _standing(db, kind, _key(kind, record_key))
    if confirmation is None:
        return None
    [payload], _ = _payloads(db, [confirmation])
    return {
        "identity": _summary(_today(db, confirmation.entity_id)),
        "confirmation": payload,
    }


def records(
    db: Session,
    record_kind: Any,
    record_key: Any,
    *,
    page: int = 1,
    page_size: int = 100,
    year: int | None = None,
    snapshot_id: Any = None,
) -> dict:
    """A stable page of complete fingerprints, with counts for the whole filter.

    Paging never splits identical repeated rows. Snapshot pins refuse a refresh
    between pages; confirmations for other pages never look like missing records.
    """
    kind = _kind(record_kind)
    printed = _PRINTED.get(kind)
    if printed is None:
        raise IdentityError("An identifier is confirmed whole; look it up instead")
    if (
        type(page) is not int
        or page < 1
        or type(page_size) is not int
        or not 1 <= page_size <= MAX_PAGE_SIZE
    ):
        raise IdentityError(f"Select a page of 1 to {MAX_PAGE_SIZE} records")
    if year is not None and (type(year) is not int or not 1900 <= year <= 2100):
        raise IdentityError("Select a valid record year")
    key = _key(kind, record_key)
    snapshot = _current_snapshot(db, printed.dataset)
    if snapshot is None:
        raise Unavailable("The Board's current file is not loaded. Try again later.")
    _same_snapshot(snapshot, snapshot_id)
    model = printed.model
    where = [model.snapshot_id == snapshot, printed.name == key]
    years = list(
        db.scalars(
            select(model.year)
            .where(*where, model.year.is_not(None))
            .distinct()
            .order_by(model.year.desc())
        )
    )
    fingerprint = printed.fingerprint(kind)
    all_matches = dict(
        db.execute(
            select(fingerprint, func.count()).where(*where).group_by(fingerprint)
        ).all()
    )
    if year is not None:
        where.append(model.year == year)
    fields = printed.printed_fields()
    grouped = (
        select(
            fingerprint.label("fingerprint"),
            fields.label("fields"),
            func.min(model.row_number).label("first_row"),
            func.count().label("count"),
            func.jsonb_agg(
                aggregate_order_by(
                    func.jsonb_build_object(
                        literal_column("'row_number'"),
                        model.row_number,
                        literal_column("'year'"),
                        model.year,
                    ),
                    model.row_number,
                )
            ).label("rows"),
        )
        .where(*where)
        .group_by(fingerprint, fields)
        .subquery()
    )
    total, total_fingerprints = db.execute(
        select(func.coalesce(func.sum(grouped.c.count), 0), func.count()).select_from(
            grouped
        )
    ).one()
    listed = {
        row.fingerprint: {
            "fingerprint": row.fingerprint,
            "fields": row.fields,
            "rows": row.rows,
            "confirmation": None,
        }
        for row in db.execute(
            select(grouped)
            .order_by(grouped.c.first_row, grouped.c.fingerprint)
            .offset((page - 1) * page_size)
            .limit(page_size)
        )
    }
    filtered_matches = (
        all_matches
        if year is None
        else dict(
            db.execute(
                select(fingerprint, func.count()).where(*where).group_by(fingerprint)
            ).all()
        )
    )
    claims = db.execute(
        select(
            Record.fingerprint, Record.fields, Confirmation.id, Confirmation.entity_id
        )
        .join(Confirmation, Confirmation.id == Record.confirmation_id)
        .where(
            Confirmation.record_kind == kind,
            Confirmation.record_key == key,
            Record.active,
        )
        .order_by(Record.fingerprint)
    ).all()
    today: dict[UUID, Entity] = {}
    covered: dict[UUID, int] = defaultdict(int)
    gone = []
    for claim in claims:
        if claim.entity_id not in today:
            today[claim.entity_id] = _today(db, claim.entity_id)
        identity = today[claim.entity_id]
        reference = {"id": str(claim.id), "identity": _summary(identity)}
        if claim.fingerprint in listed:
            listed[claim.fingerprint]["confirmation"] = reference
        if claim.fingerprint in filtered_matches:
            covered[identity.id] += filtered_matches[claim.fingerprint]
        elif claim.fingerprint not in all_matches:
            gone.append(
                {
                    "fingerprint": claim.fingerprint,
                    "fields": claim.fields,
                    "confirmation": reference,
                }
            )
    standing = {identity.id: identity for identity in today.values()}
    return {
        "record_kind": kind,
        "record_key": key,
        "file": printed.dataset.value,
        "snapshot_id": str(snapshot),
        "records": int(total),
        "confirmed": sum(covered.values()),
        "page": page,
        "page_size": page_size,
        "total_fingerprints": total_fingerprints,
        "pages": (total_fingerprints + page_size - 1) // page_size,
        "years": years,
        "identities": [
            {**_summary(standing[identity_id]), "confirmed": count}
            for identity_id, count in covered.items()
        ],
        "fingerprints": list(listed.values()),
        "no_longer_in_board_file": gone,
    }
