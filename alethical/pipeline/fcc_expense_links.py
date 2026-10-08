"""Private, reviewable FCC-to-expense evidence, never additional expenses.

A finance row has identity only inside its original snapshot. Copied evidence
survives pruning; a refreshed row is never silently substituted for that evidence.
"""

from __future__ import annotations

import json
import re
import uuid
from datetime import date, datetime, timezone
from decimal import Decimal, InvalidOperation
from typing import Any

from sqlalchemy import inspect, or_, select
from sqlalchemy.orm import Session

from alethical.db import models as m
from alethical.pipeline.fcc_document_text import EXTRACTOR_VERSION

_DATASETS = {
    "expenditures": (
        m.CampaignFinanceExpenditureRow,
        "expenditures_snapshot_id",
        "committee_name",
    ),
    "independent_expenditures": (
        m.CampaignFinanceIndependentExpenditureRow,
        "independent_expenditures_snapshot_id",
        "spender",
    ),
}
_MONEY_FIELDS = {
    "gross_amount",
    "net_amount",
    "total_order_amount",
    "paid_amount",
    "credit_amount",
}
_NAME_FIELDS = {"advertiser", "agency_name", "payer"}
_DATE_FIELDS = {"invoice_date", "start_date", "end_date"}
_LIMITATIONS = [
    "This link adds no expense and allocates no money.",
    "The finance amount is the filed total, not proof of payment.",
    "An amount difference is unallocated, not proof of agency commission or profit.",
    "Names and dates are matching clues, not confirmed identities.",
]


def _required(value: Any, name: str) -> str:
    if not isinstance(value, str) or not value.strip():
        raise ValueError(f"{name} must be nonblank")
    return value.strip()


def _uuid(value: uuid.UUID | str) -> uuid.UUID:
    try:
        return uuid.UUID(str(value))
    except (ValueError, TypeError, AttributeError) as error:
        raise ValueError("invalid source or link identifier") from error


def _json(value: Any) -> Any:
    if isinstance(value, (date, datetime)):
        return value.isoformat()
    if isinstance(value, (Decimal, uuid.UUID)):
        return str(value)
    return value


def _record(row: Any) -> dict:
    return {
        column.key: _json(getattr(row, column.key))
        for column in inspect(type(row)).columns
    }


def _current(db: Session) -> m.CampaignFinanceRelease | None:
    pointer = db.get(m.CampaignFinanceCurrentRelease, True, populate_existing=True)
    if pointer is None or pointer.release_id is None:
        return None
    release = db.get(
        m.CampaignFinanceRelease, pointer.release_id, populate_existing=True
    )
    if release is None or release.status != m.CampaignFinanceReleaseStatus.published:
        return None
    return release


def _facts(db: Session, content_hash: str, version: str) -> list[dict]:
    extraction = db.get(m.FCCExtraction, (content_hash, version))
    if extraction is None:
        raise ValueError(
            "FCC extraction does not exist for this source hash and version"
        )
    valid = []
    for fact in extraction.facts:
        if not isinstance(fact, dict):
            continue
        name, value, quote, page = (
            fact.get(key) for key in ("field", "value", "quote", "page")
        )
        if (
            name not in _MONEY_FIELDS | _NAME_FIELDS | _DATE_FIELDS
            or not isinstance(value, str)
            or not value.strip()
            or not isinstance(quote, str)
            or not quote.strip()
            or not isinstance(page, int)
            or isinstance(page, bool)
            or page < 1
        ):
            continue
        source_page = db.get(m.FCCPage, (content_hash, version, page))
        if (
            source_page is None
            or source_page.status != "extracted"
            or quote not in source_page.text
        ):
            continue
        valid.append(
            {"field": name, "value": value.strip(), "page": page, "quote": quote}
        )
    distinct: dict[str, set[str]] = {}
    for fact in valid:
        distinct.setdefault(fact["field"], set()).add(fact["value"])
    return [fact for fact in valid if len(distinct[fact["field"]]) == 1]


def _date(value: str) -> date | None:
    for pattern in ("%Y-%m-%d", "%m/%d/%Y", "%m/%d/%y", "%B %d, %Y", "%b %d, %Y"):
        try:
            return datetime.strptime(value, pattern).date()
        except ValueError:
            continue
    return None


def _amount(value: str) -> Decimal | None:
    try:
        amount = Decimal(value)
        return (
            amount
            if amount.is_finite() and abs(amount) < Decimal("100000000000000")
            else None
        )
    except InvalidOperation:
        return None


def _name(value: str | None) -> str:
    # No surname guessing, alias dictionary, or inferred committee identity.
    return " ".join(re.findall(r"[a-z0-9]+", (value or "").casefold()))


def _name_pair(fact: dict, row: Any, expense_field: str) -> dict | None:
    held = getattr(row, expense_field)
    normalized = _name(fact["value"])
    if len(normalized) < 8 or len(normalized.split()) < 2 or normalized != _name(held):
        return None
    return {
        "fcc_fact": fact,
        "expense_field": expense_field,
        "expense_value": held,
        "match": "normalized_exact",
    }


def suggest_links(
    db: Session,
    content_hash: str,
    limit: int = 20,
    *,
    extraction_version: str = EXTRACTOR_VERSION,
) -> dict:
    """Read-only suggestions from the current published release, with reasons.

    Require a page-grounded name pairing and an exact amount or stated-date clue.
    No confidence score, accepted identity, allocation, or write is produced.
    ``truncated`` means the bounded candidate search may have omitted matches.
    """
    if isinstance(limit, bool) or not isinstance(limit, int) or not 1 <= limit <= 100:
        raise ValueError("limit must be between 1 and 100")
    result = {
        "suggestions": [],
        "reason": "",
        "release_id": None,
        "extraction_version": extraction_version,
        "truncated": False,
    }
    try:
        facts = _facts(db, content_hash, extraction_version)
    except ValueError:
        result["reason"] = "extraction_not_found"
        return result
    named = [fact for fact in facts if fact["field"] in _NAME_FIELDS]
    money = [
        (fact, amount)
        for fact in facts
        if fact["field"] in _MONEY_FIELDS
        and (amount := _amount(fact["value"])) is not None
    ]
    dated = {
        fact["field"]: (fact, value)
        for fact in facts
        if fact["field"] in _DATE_FIELDS and (value := _date(fact["value"])) is not None
    }
    if not named or (not money and not dated):
        result["reason"] = "need_page_grounded_name_and_amount_or_date"
        return result
    release = _current(db)
    if release is None:
        result["reason"] = "published_finance_release_unavailable"
        return result
    result["release_id"] = str(release.id)
    for dataset, (model, slot, committee_field) in _DATASETS.items():
        snapshot_id = getattr(release, slot)
        snapshot = db.get(m.CampaignFinanceSnapshot, snapshot_id)
        if snapshot is None:
            continue
        conditions = []
        if money:
            conditions.append(model.amount.in_([amount for _, amount in money]))
        if "invoice_date" in dated:
            conditions.append(model.transaction_date == dated["invoice_date"][1])
        if "start_date" in dated and "end_date" in dated:
            start, end = dated["start_date"][1], dated["end_date"][1]
            if start <= end:
                conditions.append(model.transaction_date.between(start, end))
        if not conditions:
            continue
        # Deterministic bounded search, never the entire multi-year warehouse.
        rows = db.scalars(
            select(model)
            .where(model.snapshot_id == snapshot_id, or_(*conditions))
            .order_by(model.row_number)
            .limit(501)
        ).all()
        if len(rows) > 500:
            result["truncated"] = True
        for row in rows[:500]:
            pairs = []
            failed_known_name = False
            for fact in named:
                field = (
                    "vendor_name" if fact["field"] == "agency_name" else committee_field
                )
                pair = _name_pair(fact, row, field)
                if pair:
                    pairs.append(pair)
                else:
                    failed_known_name = True
            if not pairs or failed_known_name:
                continue
            amount_pairs = [
                {
                    "fcc_fact": fact,
                    "expense_field": "amount",
                    "expense_value": str(row.amount),
                    "match": "exact_amount",
                }
                for fact, amount in money
                if row.amount == amount
            ]
            date_pairs = []
            if row.transaction_date is not None:
                if (
                    "invoice_date" in dated
                    and row.transaction_date == dated["invoice_date"][1]
                ):
                    date_pairs.append(
                        {
                            "fcc_fact": dated["invoice_date"][0],
                            "expense_field": "transaction_date",
                            "expense_value": row.transaction_date.isoformat(),
                            "match": "exact_date",
                        }
                    )
                if (
                    "start_date" in dated
                    and "end_date" in dated
                    and dated["start_date"][1]
                    <= row.transaction_date
                    <= dated["end_date"][1]
                ):
                    date_pairs.append(
                        {
                            "fcc_facts": [dated["start_date"][0], dated["end_date"][0]],
                            "expense_field": "transaction_date",
                            "expense_value": row.transaction_date.isoformat(),
                            "match": "within_stated_flight_dates",
                        }
                    )
            if not amount_pairs and not date_pairs:
                continue
            clues = {
                "names": pairs,
                "amounts": amount_pairs,
                "dates": date_pairs,
                "unallocated_differences": [
                    {
                        "fcc_fact": fact,
                        "expense_amount": str(row.amount),
                        "expense_minus_fcc_amount": str(row.amount - amount),
                    }
                    for fact, amount in money
                    if row.amount is not None and row.amount != amount
                ],
                "limitations": _LIMITATIONS,
            }
            result["suggestions"].append(
                {
                    "content_hash": content_hash,
                    "extraction_version": extraction_version,
                    "source_dataset": dataset,
                    "source_snapshot_id": str(snapshot.id),
                    "source_content_hash": snapshot.content_hash,
                    "source_row_number": row.row_number,
                    "source_row": _record(row),
                    "status": "suggested",
                    "evidence": json.dumps(clues, sort_keys=True),
                    "clues": clues,
                }
            )
            if len(result["suggestions"]) >= limit:
                result["truncated"] = True
                result["reason"] = "review_required"
                return result
    result["reason"] = (
        "review_required"
        if result["suggestions"]
        else "no_supported_pairing_in_bounded_current_release_search"
    )
    return result


def write_link(
    db: Session,
    content_hash: str,
    extraction_version: str,
    source_dataset: str,
    source_snapshot_id: uuid.UUID | str,
    source_row_number: int,
    evidence: str,
    status: str = "suggested",
    reviewed_by: str | None = None,
) -> m.FCCExpenseLink:
    """Copy exact source evidence; caller commits. Never retarget an existing link."""
    evidence = _required(evidence, "evidence")
    if source_dataset not in _DATASETS:
        raise ValueError("source_dataset must name an expense dataset")
    if status not in {"suggested", "accepted", "rejected"}:
        raise ValueError("invalid link status")
    reviewer = _required(reviewed_by, "reviewed_by") if status != "suggested" else None
    if (
        isinstance(source_row_number, bool)
        or not isinstance(source_row_number, int)
        or source_row_number < 1
    ):
        raise ValueError("source_row_number must be positive")
    extraction_version = _required(extraction_version, "extraction_version")
    # Match the retry job's lock order. An extraction cannot be replaced between
    # copying its facts and writing the link that makes that version immutable.
    extraction = db.scalar(
        select(m.FCCExtraction)
        .where(
            m.FCCExtraction.content_hash == content_hash,
            m.FCCExtraction.version == extraction_version,
        )
        .with_for_update()
        .execution_options(populate_existing=True)
    )
    if extraction is None:
        raise ValueError(
            "FCC extraction does not exist for this source hash and version"
        )
    facts = _facts(db, content_hash, extraction_version)
    if not facts:
        raise ValueError("link requires nonblank page-grounded source facts")
    snapshot_id = _uuid(source_snapshot_id)
    model, _, _ = _DATASETS[source_dataset]
    snapshot = db.get(m.CampaignFinanceSnapshot, snapshot_id)
    if snapshot is None or snapshot.dataset.value != source_dataset:
        raise ValueError("source snapshot does not belong to this expense dataset")
    row = db.get(model, (snapshot_id, source_row_number), populate_existing=True)
    if row is None:
        raise ValueError(
            "source expense row is unavailable; retained links are never retargeted"
        )
    record = _record(row)
    existing = db.scalar(
        select(m.FCCExpenseLink).where(
            m.FCCExpenseLink.content_hash == content_hash,
            m.FCCExpenseLink.extraction_version == extraction_version,
            m.FCCExpenseLink.source_dataset == source_dataset,
            m.FCCExpenseLink.source_snapshot_id == snapshot_id,
            m.FCCExpenseLink.source_row_number == source_row_number,
        )
    )
    if existing:
        previous_record = {
            key: value
            for key, value in existing.source_row.items()
            if not key.startswith("_")
        }
        if (
            existing.extraction_version != extraction_version
            or existing.source_content_hash != snapshot.content_hash
            or previous_record != record
        ):
            raise ValueError(
                "existing source hash, extraction version, and copied row are immutable"
            )
        if (
            existing.status != status
            or existing.evidence != evidence
            or existing.reviewed_by != reviewer
        ):
            raise ValueError(
                "existing link requires an explicit review, not a replacement"
            )
        return existing
    record["_snapshot"] = {
        "dataset": source_dataset,
        "content_hash": snapshot.content_hash,
        "record_set_hash": snapshot.record_set_hash,
        "source_url": snapshot.source_url,
        "download_id": snapshot.download_id,
        "captured_at": snapshot.created_at.isoformat(),
    }
    record["_fcc_facts"] = facts
    record["_limitations"] = list(_LIMITATIONS)
    link = m.FCCExpenseLink(
        content_hash=content_hash,
        extraction_version=extraction_version,
        source_dataset=source_dataset,
        source_snapshot_id=snapshot_id,
        source_content_hash=snapshot.content_hash,
        source_row_number=source_row_number,
        source_row=record,
        status=status,
        evidence=evidence,
        reviewed_by=reviewer,
    )
    db.add(link)
    db.flush()
    return link


def link_state(db: Session, link: m.FCCExpenseLink) -> dict:
    """Expose retained evidence's currentness without moving it to a newer row."""
    release = _current(db)
    dataset = _DATASETS.get(link.source_dataset)
    reason = "published_finance_release_unavailable"
    current = False
    if release is not None and dataset is not None:
        model, slot, _ = dataset
        if getattr(release, slot) != link.source_snapshot_id:
            reason = "source_snapshot_changed"
        else:
            snapshot = db.get(
                m.CampaignFinanceSnapshot,
                link.source_snapshot_id,
                populate_existing=True,
            )
            row = db.get(
                model,
                (link.source_snapshot_id, link.source_row_number),
                populate_existing=True,
            )
            copied = {
                key: value
                for key, value in link.source_row.items()
                if not key.startswith("_")
            }
            if snapshot is None or snapshot.content_hash != link.source_content_hash:
                reason = "source_hash_changed"
            elif row is None:
                reason = "source_row_removed"
            elif _record(row) != copied:
                reason = "source_row_changed"
            else:
                current, reason = True, "current_source_evidence"
    return {
        "current": current,
        "review_needed": link.status != "rejected"
        and (link.status == "suggested" or not current),
        "reason": reason,
    }


def review_link(
    db: Session, id: uuid.UUID | str, status: str, reviewed_by: str, evidence: str
) -> m.FCCExpenseLink:
    """Record an explicit human review; preserve original source and prior evidence."""
    if status not in {"accepted", "rejected"}:
        raise ValueError("review status must be accepted or rejected")
    reviewer = _required(reviewed_by, "reviewed_by")
    evidence = _required(evidence, "evidence")
    link = db.scalar(
        select(m.FCCExpenseLink)
        .where(m.FCCExpenseLink.id == _uuid(id))
        .with_for_update()
    )
    if link is None:
        raise ValueError("expense link does not exist")
    state = link_state(db, link)
    timestamp = datetime.now(timezone.utc).isoformat()
    link.evidence += (
        f"\n\nReview {timestamp}: {status} by {reviewer}; {state['reason']}\n{evidence}"
    )
    link.status, link.reviewed_by = status, reviewer
    db.flush()
    return link
