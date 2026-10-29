"""Alethical Finance's own checks on original TV station files.

Every Finance account records facts, dates and connections on the exact original
version a station filed, validated by the rules alethical.com's review uses
(``alethical/api/services/tv_ad_review.py``), with 1 difference: the evidence is
the original's own machine-read text, so a quotation must appear exactly in that
version's text on the page it names. Checks are keyed by that version (station,
FCC file id, content hash), never by an alethical.com public copy, so nothing done
to a copy changes them (docs/architecture/alethical-finance-architecture.md §5).

Append-only: a correction is a new row naming the 1 it replaces, and a withdrawal
sets its date and reason once; the database refuses any other change. Each row
records whether a team account made it, and nothing else about the account; no
Finance answer serves that flag. Functions flush but never commit.

Every refusal is a ``ValueError`` whose message is a fixed sentence naming the
rule a check broke, never a record's contents, so the route serves it as the
answer's detail.
"""

from __future__ import annotations

from types import SimpleNamespace
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, aliased

from alethical.api.services import tv_ad_review as review
from alethical.api.services import tv_ads as reader
from alethical.api.services.finance_access import FinanceAccount
from alethical.db import models as m
from alethical.pipeline import fcc_expense_links
from alethical.pipeline.campaign_finance_reader import source_copy_date
from alethical.pipeline.fcc_document_text import EXTRACTOR_VERSION

# What a Finance check request may carry. alethical.com's publication and privacy
# approvals are absent: Finance has no public pages, so a request naming one is
# refused rather than silently read as published.
FACT_KEYS = frozenset(
    {
        "field",
        "value",
        "page",
        "quote",
        "evidence",
        "correctness_reviewed",
        "role",
        "qualifier",
        "organization_name",
        "agency_address_reviewed",
        "supersedes_id",
    }
)
CONNECTION_KEYS = frozenset(
    {
        "kind",
        "target_id",
        "page",
        "quote",
        "evidence",
        "correctness_reviewed",
        "expected_target_fingerprint",
        "election_stage",
        "money_office",
        "money_district",
        "money_context_reviewed",
        "role",
        "source_content_hash",
        "file_identity_reviewed",
    }
)
PREVIEW_KEYS = frozenset(
    {"kind", "target_id", "election_stage", "money_office", "money_district", "role"}
)
# Confirmations a person ticks; every other field but the page is text.
FLAGS = frozenset(
    {
        "correctness_reviewed",
        "agency_address_reviewed",
        "money_context_reviewed",
        "file_identity_reviewed",
    }
)
# Records alethical.com's review validates without a public copy.
RECORD_KINDS = frozenset({"committee", "candidate", "election", "principal"})
KINDS = RECORD_KINDS | {"issue", "related_document", "expense"}
# The largest row number Postgres's integer column holds; a larger one names no row.
LAST_ROW = 2**31 - 1
# A held original has at most 100 pages: the page renderer's own limit
# (``MAX_PAGES`` in alethical/pipeline/tv_ad_redaction.py). Stated here rather than
# imported, because that module sits behind the reviewed image-library boundary
# that scripts/pillow_source_guard.py pins to its existing callers.
LAST_PAGE = 100


class CorrectionRace(Exception):
    """Another correction of the same fact was saved first."""


def _text(name, value):
    if not isinstance(value, str):
        raise ValueError(f"{name} must be text")
    if "\x00" in value:
        raise ValueError(f"{name} must not contain a NUL character")
    return value


def _only(data, allowed):
    """Only the request's own fields, each of its own type, so a mistyped value
    is refused by name instead of failing somewhere deeper."""
    if not isinstance(data, dict):
        raise ValueError("A check is a set of named fields")
    if set(data) - allowed:
        raise ValueError("Finance checks take only their own fields")
    for name, value in data.items():
        if value is None or name == "page":
            continue
        if name in FLAGS:
            if not isinstance(value, bool):
                raise ValueError(f"{name} must be true or false")
        else:
            _text(name, value)


def version(db: Session, key: str, content_hash: str) -> m.FCCDocument:
    """The exact held original a check is made on."""
    if "\x00" in key or "\x00" in content_hash:
        raise LookupError("Not found")
    facility_id, file_id = reader.identity(key)
    document = db.get(m.FCCDocument, (facility_id, file_id, content_hash))
    if document is None:
        raise LookupError("Not found")
    return document


def _identity(document):
    return document.facility_id, document.file_id, document.content_hash


def _quote(db, document, page, quote):
    """The quotation, exactly as it appears in the original's machine-read text
    on the named page: the evidence alethical.com takes from an approved copy's
    safe text, Finance takes from the original itself."""
    if (
        isinstance(page, bool)
        or not isinstance(page, int)
        or not 1 <= page <= LAST_PAGE
    ):
        raise ValueError("Choose an exact source page")
    quote = review._required(quote, "Source quotation")
    text = db.scalar(
        select(m.FCCPage.text).where(
            m.FCCPage.content_hash == document.content_hash,
            m.FCCPage.version == EXTRACTOR_VERSION,
            m.FCCPage.page == page,
        )
    )
    if not text or quote not in text:
        raise ValueError(
            "Quotation must appear in this original's machine-read text on that page"
        )
    return quote


def _reviewed(data):
    if data.get("correctness_reviewed") is not True:
        raise ValueError("An explicit correctness review is required")


def _standing_facts(document):
    """Facts on this version that are neither withdrawn nor corrected."""
    successor = aliased(m.FinanceTVFact)
    return select(m.FinanceTVFact).where(
        m.FinanceTVFact.facility_id == document.facility_id,
        m.FinanceTVFact.file_id == document.file_id,
        m.FinanceTVFact.content_hash == document.content_hash,
        m.FinanceTVFact.withdrawn_at.is_(None),
        ~select(successor.id)
        .where(successor.supersedes_id == m.FinanceTVFact.id)
        .exists(),
    )


def add_fact(
    db: Session, account: FinanceAccount, key: str, content_hash: str, data: dict
) -> m.FinanceTVFact:
    _only(data, FACT_KEYS)
    document = version(db, key, content_hash)
    field, value = review.fact_field(data)
    quote = _quote(db, document, data.get("page"), data.get("quote"))
    support = review.fact_support(field, value, quote, data)
    if support["agency_address_reviewed"] and (
        field != "organization_address"
        or db.scalar(
            _standing_facts(document)
            .where(
                m.FinanceTVFact.field == "agency_name",
                m.FinanceTVFact.value == support["organization_name"],
            )
            .limit(1)
        )
        is None
    ):
        raise ValueError(
            "Agency address needs the same exact checked agency name on this version"
        )
    _reviewed(data)
    old = None
    if data.get("supersedes_id"):
        old = db.scalar(
            _standing_facts(document)
            .where(
                m.FinanceTVFact.id == review._id(data["supersedes_id"]),
                m.FinanceTVFact.field == field,
            )
            .with_for_update(of=m.FinanceTVFact)
        )
        if old is None:
            raise ValueError(
                "Correction must replace a standing check of this field on this exact version"
            )
    row = m.FinanceTVFact(
        facility_id=document.facility_id,
        file_id=document.file_id,
        content_hash=document.content_hash,
        field=field,
        value=value,
        **support,
        supersedes_id=old.id if old else None,
        page=data["page"],
        quote=quote,
        evidence=review._required(data.get("evidence"), "Review evidence"),
        made_by_alethical_team=account.is_alethical_team,
        checked_at=review.now(),
    )
    db.add(row)
    try:
        db.flush()
    except IntegrityError as error:
        # 2 corrections of 1 fact at once: the database keeps the first.
        constraint = getattr(getattr(error.orig, "diag", None), "constraint_name", "")
        if old is not None and constraint == "uq_finance_tv_fact_supersedes_id":
            raise CorrectionRace from None
        raise
    return row


def _target(db, kind, target_id, data, document, *, quote=None):
    """The record a connection names, validated by alethical.com's rules, as
    Finance keeps it: never an alethical.com address. ``quote`` is absent when
    previewing, before the quotation is chosen."""
    if kind not in KINDS:
        raise ValueError("Unsupported connection kind")
    target_id = review._required(target_id, "Target", limit=2000)
    if kind in RECORD_KINDS:
        checked = {**data, "quote": quote} if quote is not None else dict(data)
        content = review._target(db, kind, target_id, checked, None)
        content.pop("href", None)
        return content
    if kind == "issue":
        if quote is None:
            return {"label": target_id, "role": "Printed issue"}
        return review.printed_issue(target_id, quote)
    if kind == "related_document":
        # "<file key>@<content hash>": the related file's exact original version.
        related_key, _, related_hash = target_id.rpartition("@")
        try:
            related = version(db, related_key, related_hash)
        except LookupError:
            raise ValueError(
                "Related document must be a held original version"
            ) from None
        if _identity(related) == _identity(document):
            raise ValueError("Related document must be another original version")
        return {
            "label": related.name,
            "facility_id": related.facility_id,
            "file_id": related.file_id,
            "content_hash": related.content_hash,
        }
    # An expense is the exact retained Campaign Finance Board row, never a value
    # the browser supplies; it is copied whole so the check keeps what it read.
    number = target_id.rsplit(":", 1)[-1]
    if number.isdecimal() and (len(number) > 10 or int(number) > LAST_ROW):
        raise ValueError("Expense row number is beyond any held row")
    dataset, snapshot, row = review._expense_target(db, target_id)
    return {
        "label": "Reported campaign expense",
        "source_dataset": dataset,
        "source_snapshot_id": str(snapshot.id),
        "source_content_hash": snapshot.content_hash,
        "source_row_number": row.row_number,
        "source_row": fcc_expense_links._record(row),
        "facility_id": document.facility_id,
        "file_id": document.file_id,
        "content_hash": document.content_hash,
    }


def _fingerprint(kind, target_id, document, content):
    return review._fingerprint(
        {
            "kind": kind,
            "target_id": target_id,
            "version": list(_identity(document)),
            "content": content,
        }
    )


PREVIEW_FIELDS = (
    "registration_number",
    "election_id",
    "election_stage",
    "office",
    "jurisdiction_scope",
    "year",
    "role",
    "money_context",
)


def target_preview(
    db: Session,
    key: str,
    content_hash: str,
    kind: str,
    target_id: str,
    *,
    election_stage: str | None = None,
    money_office: str | None = None,
    money_district: str | None = None,
    role: str | None = None,
) -> dict:
    """The exact record a connection would name, with the fingerprint its save
    must repeat, so a target that changes after it is read is never saved."""
    _only(
        {
            "kind": kind,
            "target_id": target_id,
            "election_stage": election_stage,
            "money_office": money_office,
            "money_district": money_district,
            "role": role,
        },
        PREVIEW_KEYS,
    )
    document = version(db, key, content_hash)
    content = _target(
        db,
        kind,
        target_id,
        {
            "election_stage": election_stage,
            "money_office": money_office,
            "money_district": money_district,
            "role": role,
        },
        document,
    )
    result = {
        "kind": kind,
        "target_id": target_id,
        "label": content["label"],
        "target_fingerprint": _fingerprint(kind, target_id, document, content),
    }
    if kind == "expense":
        snapshot = db.get(
            m.CampaignFinanceSnapshot, UUID(content["source_snapshot_id"])
        )
        copied = source_copy_date(db, snapshot.dataset, snapshot.id)
        result |= {
            key: content[key]
            for key in (
                "source_dataset",
                "source_snapshot_id",
                "source_content_hash",
                "source_row_number",
            )
        }
        result["source_date"] = copied.isoformat() if copied else None
        result["fields"] = [
            {"label": name.replace("_", " ").capitalize(), "value": str(value)}
            for name, value in content["source_row"].items()
            if value is not None and not isinstance(value, (list, dict))
        ]
    else:
        result["fields"] = [
            {"label": name.replace("_", " ").capitalize(), "value": str(content[name])}
            for name in PREVIEW_FIELDS
            if name in content
        ]
    return result


def add_connection(
    db: Session, account: FinanceAccount, key: str, content_hash: str, data: dict
) -> m.FinanceTVConnection:
    _only(data, CONNECTION_KEYS)
    document = version(db, key, content_hash)
    kind = data.get("kind")
    if kind not in KINDS:
        raise ValueError("Unsupported connection kind")
    quote = _quote(db, document, data.get("page"), data.get("quote"))
    _reviewed(data)
    target_id = review._required(data.get("target_id"), "Target", limit=2000)
    if kind == "expense" and data.get("file_identity_reviewed") is not True:
        raise ValueError(
            "Review the exact FCC file identity before connecting expenses"
        )
    content = _target(
        db,
        kind,
        target_id,
        {
            name: data.get(name)
            for name in ("election_stage", "money_office", "money_district", "role")
        },
        document,
        quote=quote,
    )
    if (
        kind == "expense"
        and data.get("source_content_hash") != content["source_content_hash"]
    ):
        raise ValueError("Review the exact expense copy fingerprint before connecting")
    if content.get("money_context") and data.get("money_context_reviewed") is not True:
        raise ValueError("Review the exact campaign-money office and district")
    if data.get("expected_target_fingerprint") != _fingerprint(
        kind, target_id, document, content
    ):
        raise ValueError(
            "Target changed or was not previewed; review its exact fingerprint again"
        )
    row = m.FinanceTVConnection(
        facility_id=document.facility_id,
        file_id=document.file_id,
        content_hash=document.content_hash,
        kind=kind,
        target_id=target_id,
        target_snapshot=content,
        page=data["page"],
        quote=quote,
        evidence=review._required(data.get("evidence"), "Review evidence"),
        made_by_alethical_team=account.is_alethical_team,
        checked_at=review.now(),
    )
    db.add(row)
    db.flush()
    return row


def withdraw(db: Session, model, check_id: UUID, reason: str):
    """Withdraw any shown check once; public-copy checks change only in Finance.

    Lock the original check to serialize competing withdrawals, then append a
    separate record for a copy check. Never mutate a public-site row.
    """
    reason = review._required(_text("reason", reason), "Withdrawal reason", limit=2000)
    row = db.scalar(select(model).where(model.id == check_id).with_for_update())
    if row is None:
        return _withdraw_copy(db, model, check_id, reason)
    if row.withdrawn_at is not None:
        raise ValueError("This check is already withdrawn")
    row.withdrawal_reason = reason
    row.withdrawn_at = review.now()
    db.flush()
    return row


def _withdraw_copy(db, model, check_id, reason):
    copied, column = (
        (m.TVAdFact, m.FinanceTVCopyWithdrawal.fact_id)
        if model is m.FinanceTVFact
        else (m.TVAdConnection, m.FinanceTVCopyWithdrawal.connection_id)
    )
    row = db.scalar(select(copied).where(copied.id == check_id).with_for_update())
    if row is None:
        raise LookupError("Not found")
    if row.publication_id:
        publication = db.get(m.TVAdPublication, row.publication_id)
        if (
            publication.status == "draft"
            or publication.facility_id not in reader.STATIONS
        ):
            raise LookupError("Not found")
    elif (
        copied is not m.TVAdConnection
        or row.scope != "folder"
        or row.facility_id not in reader.STATIONS
    ):
        raise LookupError("Not found")
    if db.scalar(select(m.FinanceTVCopyWithdrawal.id).where(column == check_id)):
        raise ValueError("This check is already withdrawn")
    withdrawal = m.FinanceTVCopyWithdrawal(
        **{column.key: check_id}, withdrawal_reason=reason, withdrawn_at=review.now()
    )
    db.add(withdrawal)
    db.flush()
    return SimpleNamespace(id=check_id, withdrawn_at=withdrawal.withdrawn_at)


def expense_current(db: Session, snapshot: dict) -> bool:
    """Whether the expense row a Finance check copied is still the current
    published release's row, by the same test alethical.com's links use."""
    try:
        evidence = SimpleNamespace(
            status="accepted",
            source_dataset=snapshot["source_dataset"],
            source_snapshot_id=UUID(snapshot["source_snapshot_id"]),
            source_row_number=snapshot["source_row_number"],
            source_content_hash=snapshot["source_content_hash"],
            source_row=snapshot["source_row"],
        )
    except (KeyError, TypeError, ValueError):
        return False
    return fcc_expense_links.link_state(db, evidence)["current"]
