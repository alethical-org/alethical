"""Private TV-copy preparation and explicit reviewer decisions.

Authorization belongs to the authenticated router. Actor is the authenticated
server identity, never a request-body reviewer name. Functions flush but never
commit. No command here automatically reviews source data or publishes a draft.
"""

from __future__ import annotations

import hashlib
import html
import json
import re
import tempfile
import uuid
from datetime import datetime, timezone
from decimal import Decimal, InvalidOperation
from pathlib import Path

from sqlalchemy import or_, select
from sqlalchemy.orm import Session

from alethical.db import models as m
from alethical.pipeline import fcc_archive, fcc_expense_links, tv_ad_redaction
from alethical.pipeline.raw_file_store import raw_file_store_from_env

STATIONS = {"28010", "23079", "68883"}

FACT_FIELDS = {
    "agency_name",
    "organization_address",
    "document_kind",
    "advertiser",
    "payer",
    "order_number",
    "invoice_number",
    "gross_amount",
    "net_amount",
    "commission_rate",
    "commission_amount",
    "invoice_date",
    "start_date",
    "end_date",
    "total_order_amount",
    "paid_amount",
    "credit_amount",
    "officer_name",
    "officer_role",
    "principal",
    "issue",
    "scheduled_airing",
}
MONEY_FIELDS = {
    "gross_amount",
    "net_amount",
    "commission_amount",
    "total_order_amount",
    "paid_amount",
    "credit_amount",
}


def now():
    return datetime.now(timezone.utc)


def _required(value, label, *, limit=10000):
    if not isinstance(value, str) or not value.strip() or len(value) > limit:
        raise ValueError(f"{label} must be nonblank and within its length limit")
    return value.strip()


def _id(value):
    try:
        return uuid.UUID(str(value))
    except (ValueError, TypeError, AttributeError) as error:
        raise ValueError("Invalid review identifier") from error


def _fingerprint(payload):
    return hashlib.sha256(
        json.dumps(
            payload, sort_keys=True, separators=(",", ":"), ensure_ascii=False
        ).encode()
    ).hexdigest()


def publication_content(row):
    return {
        key: getattr(row, key)
        for key in (
            "facility_id",
            "file_id",
            "content_hash",
            "safe_title",
            "safe_folder",
            "category",
            "safe_pages",
            "artifacts",
            "redactions",
        )
    }


def _event(db, kind, row, action, actor, evidence, snapshot):
    db.flush()
    db.add(
        m.TVAdReviewEvent(
            entity_type=kind,
            entity_id=row.id,
            action=action,
            actor=_required(actor, "Actor", limit=200),
            evidence=_required(evidence, "Review evidence"),
            snapshot=snapshot,
        )
    )
    db.flush()


def _publication(db, id, *, approved=False, lock=False):
    query = (
        select(m.TVAdPublication)
        .where(m.TVAdPublication.id == _id(id))
        .execution_options(populate_existing=True)
    )
    row = db.scalar(query.with_for_update() if lock else query)
    if row is None:
        raise ValueError("Copy not found")
    if approved and row.status != "approved":
        raise ValueError("This copy is not approved")
    if row.fingerprint != _fingerprint(publication_content(row)):
        raise ValueError("Prepared copy changed; prepare a new revision")
    return row


def _source(db, facility_id, file_id, content_hash):
    if facility_id not in STATIONS:
        raise ValueError("Station is outside the approved collection")
    row = db.get(m.FCCDocument, (facility_id, file_id, content_hash))
    if row is None:
        raise ValueError("Exact source version not found")
    return row


def _safe_pages(pages, page_count):
    if not isinstance(pages, list) or len(pages) != page_count:
        raise ValueError("Review text status for every page")
    result = []
    for position, page in enumerate(pages, 1):
        if (
            not isinstance(page, dict)
            or page.get("page") != position
            or isinstance(page.get("page"), bool)
        ):
            raise ValueError("Safe text pages must be in document order")
        text = page.get("text")
        status = page.get("text_status", "readable")
        if (
            not isinstance(text, str)
            or len(text) > 200000
            or status not in {"readable", "unreadable", "blank"}
        ):
            raise ValueError("Invalid safe page text or status")
        if status != "readable" and text.strip():
            raise ValueError("Unreadable or blank pages cannot contain searchable text")
        if status == "readable" and not text.strip():
            raise ValueError("Choose blank or unreadable for a page without text")
        result.append({"page": position, "text": text, "text_status": status})
    return result


def prepare_copy(
    db: Session, actor: str, data: dict, *, store=None
) -> m.TVAdPublication:
    """Prepare a NEW draft; never inherit any approval from another revision."""
    actor = _required(actor, "Actor", limit=200)
    evidence = _required(data.get("evidence"), "Preparation evidence")
    source = _source(
        db, data.get("facility_id"), data.get("file_id"), data.get("content_hash")
    )
    title = _required(data.get("safe_title"), "Safe title", limit=500)
    folder = _required(data.get("safe_folder"), "Safe folder", limit=1000)
    category = _required(data.get("category"), "Literal station category", limit=500)
    if data.get("metadata_only") is True:
        pages, redactions, artifacts = [], [], {"pdf": None, "pages": []}
    else:
        store = store or raw_file_store_from_env()
        body = db.get(m.FCCSourceBody, source.content_hash)
        if body is None:
            raise ValueError("Source contents unavailable")
        rendered = tv_ad_redaction.render_redacted(
            fcc_archive.read_body(store, body), data.get("redactions", [])
        )
        pages = _safe_pages(data.get("safe_pages"), len(rendered["pages"]))
        artifacts = tv_ad_redaction.store_artifacts(store, rendered)
        redactions = rendered["redactions"]
    row = m.TVAdPublication(
        facility_id=source.facility_id,
        file_id=source.file_id,
        content_hash=source.content_hash,
        status="draft",
        safe_title=title,
        safe_folder=folder,
        category=category,
        safe_pages=pages,
        artifacts=artifacts,
        redactions=redactions,
        created_by=actor,
    )
    row.fingerprint = _fingerprint(publication_content(row))
    db.add(row)
    _event(
        db,
        "publication",
        row,
        "prepared",
        actor,
        evidence,
        {"fingerprint": row.fingerprint},
    )
    return row


def approve_copy(
    db: Session, id, actor: str, data: dict, *, store=None
) -> m.TVAdPublication:
    """Explicit human privacy approval for exactly the displayed preparation."""
    row = _publication(db, id, lock=True)
    if not row.artifacts.get("pdf") or not row.artifacts.get("pages"):
        raise ValueError(
            "Prepare and review rendered pages before approving the full copy"
        )
    if row.status != "draft":
        raise ValueError("Only a draft may be approved")
    if data.get("expected_fingerprint") != row.fingerprint:
        raise ValueError(
            "Preparation changed; review the current copy before approving"
        )
    if any(
        data.get(key) is not True
        for key in ("privacy_reviewed", "metadata_reviewed", "text_reviewed")
    ):
        raise ValueError("Review images, metadata and safe text before approving")
    actor = _required(actor, "Actor", limit=200)
    evidence = _required(data.get("evidence"), "Approval evidence")
    active = db.scalar(
        select(m.TVAdPublication.id)
        .where(
            m.TVAdPublication.facility_id == row.facility_id,
            m.TVAdPublication.file_id == row.file_id,
            m.TVAdPublication.content_hash == row.content_hash,
            m.TVAdPublication.status == "approved",
        )
        .limit(1)
    )
    if active is not None:
        raise ValueError(
            "Withdraw the existing approved revision before approving its replacement"
        )
    store = store or raw_file_store_from_env()
    read_artifact(row, store)
    for page in row.artifacts["pages"]:
        read_artifact(row, store, page=page["page"])
    row.status, row.reviewed_by, row.reviewed_at = "approved", actor, now()
    row.metadata_approved, row.metadata_reviewed_by, row.metadata_reviewed_at = (
        True,
        actor,
        row.reviewed_at,
    )
    _event(
        db,
        "publication",
        row,
        "approved",
        actor,
        evidence,
        {
            "fingerprint": row.fingerprint,
            "privacy_reviewed": True,
            "metadata_reviewed": True,
            "text_reviewed": True,
        },
    )
    return row


def withdraw_copy(db: Session, id, actor: str, evidence: str) -> m.TVAdPublication:
    row = _publication(db, id, lock=True)
    if row.status == "withdrawn":
        raise ValueError("Copy is already withdrawn")
    row.status, row.withdrawn_at = "withdrawn", now()
    row.metadata_approved = False
    # Reader queries must also check the parent status, including old URLs. Keep
    # evidence and review history; withdrawal is not destructive data removal.
    for model in (m.TVAdFact, m.TVAdConnection):
        active = (
            or_(model.status == "checked", model.history_publication_approved.is_(True))
            if model is m.TVAdFact
            else model.status == "checked"
        )
        for child in db.scalars(
            select(model)
            .where(model.publication_id == row.id, active)
            .with_for_update()
        ):
            child.status, child.withdrawn_at, child.publication_approved = (
                "withdrawn",
                row.withdrawn_at,
                False,
            )
            if isinstance(child, m.TVAdFact):
                child.history_publication_approved = False
            _event(
                db,
                "fact" if model is m.TVAdFact else "connection",
                child,
                "withdrawn",
                actor,
                evidence,
                {"parent_copy_withdrawn": str(row.id)},
            )
    # Related-document connections must disappear at either endpoint.
    for child in db.scalars(
        select(m.TVAdConnection)
        .where(
            m.TVAdConnection.kind == "related_document",
            m.TVAdConnection.target_id == str(row.id),
            m.TVAdConnection.status == "checked",
        )
        .with_for_update()
    ):
        child.status, child.withdrawn_at, child.publication_approved = (
            "withdrawn",
            row.withdrawn_at,
            False,
        )
        _event(
            db,
            "connection",
            child,
            "withdrawn",
            actor,
            evidence,
            {"target_copy_withdrawn": str(row.id)},
        )
    _event(
        db,
        "publication",
        row,
        "withdrawn",
        actor,
        evidence,
        {"fingerprint": row.fingerprint},
    )
    return row


def _quote(row, page, quote):
    if isinstance(page, bool) or not isinstance(page, int) or page < 1:
        raise ValueError("Choose an exact source page")
    quote = _required(quote, "Source quotation")
    source = next((p for p in row.safe_pages if p["page"] == page), None)
    if (
        source is None
        or source["text_status"] != "readable"
        or quote not in source["text"]
    ):
        raise ValueError("Quotation must appear in this approved copy's safe page text")
    return quote


def _decision(data):
    if data.get("correctness_reviewed") is not True:
        raise ValueError("An explicit correctness review is required")
    published = data.get("publication_approved", False)
    if (
        not isinstance(published, bool)
        or published
        and data.get("privacy_reviewed") is not True
    ):
        raise ValueError("Publishing a checked item requires its own privacy review")
    return published


def add_fact(db: Session, id, actor: str, data: dict) -> m.TVAdFact:
    publication = _publication(db, id, approved=True, lock=True)
    field = data.get("field")
    if field not in FACT_FIELDS:
        raise ValueError("Unsupported checked field")
    value = _required(data.get("value"), "Value", limit=2000)
    quote = _quote(publication, data.get("page"), data.get("quote"))
    # Amount formatting may be normalized, but its numeric value must still be
    # literally supported by the source quote, never inferred from another field.
    if field in MONEY_FIELDS | {"commission_rate"}:
        try:
            amount = Decimal(value.replace(",", "").replace("$", "").replace("%", ""))
        except InvalidOperation as error:
            raise ValueError("Use the amount printed in the quotation") from error
        tokens = re.findall(r"(?<!\w)-?\d[\d,]*(?:\.\d+)?", quote)
        if not amount.is_finite() or amount not in {
            Decimal(token.replace(",", "")) for token in tokens
        }:
            raise ValueError("Amount must be explicitly printed in the quotation")
    elif value.casefold() not in quote.casefold() and field != "document_kind":
        raise ValueError("Value must be explicitly supported by the quotation")
    role = data.get("role") or None
    if role is not None:
        role = _required(role, "Printed role", limit=500)
        if role.casefold() not in quote.casefold():
            raise ValueError("Role must be printed in the quotation")
    if field in {"organization_address", "officer_name"} and not role:
        raise ValueError("This field needs its printed organizational role")
    qualifier = data.get("qualifier") or None
    if qualifier is not None:
        qualifier = _required(qualifier, "Qualifier", limit=1000)
    organization_name = data.get("organization_name") or None
    if organization_name is not None:
        organization_name = _required(
            organization_name, "Printed organization name", limit=500
        )
        if organization_name.casefold() not in quote.casefold():
            raise ValueError("Organization name must be printed in the quotation")
    if field == "organization_address" and not organization_name:
        raise ValueError(
            "Organization address needs its exact printed organization name"
        )
    agency_address = data.get("agency_address_reviewed", False)
    if not isinstance(agency_address, bool):
        raise ValueError("Agency address association requires an explicit review")
    if agency_address:
        matching_agency = db.scalar(
            select(m.TVAdFact.id)
            .where(
                m.TVAdFact.publication_id == publication.id,
                m.TVAdFact.field == "agency_name",
                m.TVAdFact.value == organization_name,
                m.TVAdFact.status == "checked",
                m.TVAdFact.publication_approved.is_(True),
            )
            .limit(1)
        )
        if field != "organization_address" or matching_agency is None:
            raise ValueError(
                "Agency address needs the same exact approved agency name on this copy"
            )
    published = _decision(data)
    old = None
    if data.get("supersedes_id"):
        old = db.scalar(
            select(m.TVAdFact)
            .where(m.TVAdFact.id == _id(data["supersedes_id"]))
            .with_for_update()
        )
        if (
            old is None
            or old.publication_id != publication.id
            or old.status != "checked"
            or old.field != field
        ):
            raise ValueError(
                "Correction must replace a checked fact on this exact copy and field"
            )
    keep_history = data.get("history_publication_approved", False)
    if (
        not isinstance(keep_history, bool)
        or keep_history
        and (
            old is None
            or not old.publication_approved
            or data.get("history_privacy_reviewed") is not True
        )
    ):
        raise ValueError(
            "Correction history requires separate privacy approval of the previously published value"
        )
    row = m.TVAdFact(
        publication_id=publication.id,
        field=field,
        value=value,
        organization_name=organization_name,
        agency_address_reviewed=agency_address,
        qualifier=qualifier,
        role=role,
        supersedes_id=old.id if old else None,
        page=data["page"],
        quote=quote,
        status="checked",
        evidence=_required(data.get("evidence"), "Review evidence"),
        reviewed_by=_required(actor, "Actor", limit=200),
        checked_at=now(),
        publication_approved=published,
    )
    db.add(row)
    _event(
        db,
        "fact",
        row,
        "checked",
        actor,
        row.evidence,
        {
            "publication_id": str(publication.id),
            "fingerprint": publication.fingerprint,
            "publication_approved": published,
        },
    )
    if old:
        old.history_publication_approved = keep_history
        old.status, old.withdrawn_at, old.publication_approved = (
            "withdrawn",
            now(),
            False,
        )
        _event(
            db,
            "fact",
            old,
            "corrected",
            actor,
            row.evidence,
            {
                "replacement_id": str(row.id),
                "history_publication_approved": keep_history,
            },
        )
    return row


def _expense_target(db, target):
    """Parse an existing exact row, never values supplied by the browser."""
    parts = target.split(":")
    if len(parts) != 3 or parts[0] not in {"expenditures", "independent_expenditures"}:
        raise ValueError("Use dataset:snapshot-id:row-number for an exact expense")
    dataset, snapshot_id, row_number = parts[0], _id(parts[1]), parts[2]
    if not row_number.isdecimal() or int(row_number) < 1:
        raise ValueError("Use a positive expense row number")
    snapshot = db.get(m.CampaignFinanceSnapshot, snapshot_id)
    model = (
        m.CampaignFinanceExpenditureRow
        if dataset == "expenditures"
        else m.CampaignFinanceIndependentExpenditureRow
    )
    row = db.get(model, (snapshot_id, int(row_number)))
    body = db.get(m.CampaignFinanceSnapshotBody, snapshot_id)
    if (
        snapshot is None
        or snapshot.dataset.value != dataset
        or row is None
        or body is None
    ):
        raise ValueError("Exact retained expense source and row are unavailable")
    return dataset, snapshot, row


def _target_fingerprint(kind, target_id, publication, content):
    return _fingerprint(
        {
            "kind": kind,
            "target_id": target_id,
            "publication_fingerprint": publication.fingerprint if publication else None,
            "content": content,
        }
    )


def target_preview(
    db,
    kind,
    target_id,
    publication_id=None,
    *,
    election_stage=None,
    money_office=None,
    money_district=None,
    role=None,
):
    """Private comparison data from validated targets, with no review or write."""
    publication = (
        _publication(db, publication_id, approved=True) if publication_id else None
    )
    if kind == "expense" and ":" in target_id:
        dataset, snapshot, row = _expense_target(db, target_id)
        source = fcc_expense_links._record(row)
        return {
            "label": "Reported campaign expense",
            "target_id": target_id,
            "source_dataset": dataset,
            "source_snapshot_id": str(snapshot.id),
            "source_content_hash": snapshot.content_hash,
            "source_row_number": row.row_number,
            "source_date": snapshot.created_at.isoformat(),
            "target_fingerprint": _target_fingerprint(
                kind,
                target_id,
                publication,
                {
                    "snapshot_id": str(snapshot.id),
                    "content_hash": snapshot.content_hash,
                    "row_number": row.row_number,
                    "source_row": source,
                },
            ),
            "fields": [
                {"label": key.replace("_", " ").capitalize(), "value": str(value)}
                for key, value in source.items()
                if value is not None and not isinstance(value, (list, dict))
            ],
        }
    if kind == "issue":
        return {
            "label": _required(target_id, "Printed text"),
            "target_id": target_id,
            "fields": [],
            "requires_printed_quote": True,
            "target_fingerprint": _target_fingerprint(
                kind, target_id, publication, {"label": target_id}
            ),
        }
    target = _target(
        db,
        kind,
        target_id,
        {
            "election_stage": election_stage,
            "file_identity_reviewed": True,
            "money_office": money_office,
            "money_district": money_district,
            "role": role,
        },
        publication,
    )
    public_keys = (
        "label",
        "href",
        "role",
        "election_id",
        "election_stage",
        "source_dataset",
        "source_snapshot_id",
        "source_content_hash",
        "source_row_number",
        "race_id",
        "office",
        "jurisdiction_scope",
        "money_context",
        "year",
    )
    result = {key: target[key] for key in public_keys if key in target}
    result["target_fingerprint"] = _target_fingerprint(
        kind, target_id, publication, target
    )
    if kind == "expense":
        result["fields"] = [
            {"label": key.replace("_", " ").capitalize(), "value": str(value)}
            for key, value in target["source_row"].items()
            if value is not None
            and not key.startswith("_")
            and not isinstance(value, (list, dict))
        ]
        result["target_id"] = target_id
        return result
    result["target_id"] = target_id
    result["fields"] = [
        {"label": key.replace("_", " ").capitalize(), "value": str(target[key])}
        for key in (
            "registration_number",
            "election_id",
            "election_stage",
            "source_dataset",
            "source_row_number",
            "office",
            "jurisdiction_scope",
            "year",
            "role",
            "money_context",
        )
        if key in target
    ]
    return result


def _target(db, kind, target, data, publication):
    target = _required(target, "Target", limit=2000)
    printed_role = None
    if kind in {"committee", "principal"} and data.get("role"):
        printed_role = _required(data["role"], "Printed role", limit=500)
        if "quote" in data and not re.search(
            r"(?<!\w)" + re.escape(printed_role) + r"(?!\w)", data["quote"], re.I
        ):
            raise ValueError("Role must be printed in the quotation")
    if kind == "committee":
        pointer = db.get(
            m.CampaignFinanceFilingCurrentSnapshot, True, populate_existing=True
        )
        row = (
            db.get(m.CampaignFinanceFiler, (pointer.snapshot_id, target))
            if pointer and pointer.snapshot_id
            else None
        )
        if row is None:
            raise ValueError("Committee must be an existing current registration")
        return {
            "label": row.name,
            "href": f"/money/committees/{target}",
            "registration_number": target,
            "role": printed_role or "",
            "source_snapshot_id": str(row.snapshot_id),
        }
    if kind in {"candidate", "election"}:
        candidate = db.get(m.CandidateRecord, target) if kind == "candidate" else None
        race = db.get(m.CandidateRaceRecord, target) if kind == "election" else None
        if (
            kind == "candidate"
            and candidate is None
            or kind == "election"
            and race is None
        ):
            raise ValueError("Candidate or exact election race does not exist")
        record = candidate or race
        if record is None:
            raise ValueError("Candidate or exact election race does not exist")
        election = db.get(m.CandidateElection, record.election_id)
        if (
            election is None
            or data.get("election_stage") != election.stage
            or race is not None
            and race.stage != election.stage
        ):
            raise ValueError("Choose the exact election stage")
        if race is not None and race.test_data:
            raise ValueError("Test election results cannot establish a real connection")
        if candidate:
            role = data.get("role") or "named"
            if role not in {"named", "advertiser", "payer"}:
                raise ValueError("Choose named, advertiser, or payer candidate role")
            if (
                role != "named"
                and "quote" in data
                and not re.search(r"\b" + role + r"\b", data["quote"], re.I)
            ):
                raise ValueError(
                    "Candidate advertiser or payer role must be explicitly printed"
                )
            label = candidate.public_payload.get(
                "name"
            ) or candidate.public_payload.get("label")
            if not isinstance(label, str) or not label.strip():
                raise ValueError("Candidate's official display name is unavailable")
            return {
                "label": label,
                "href": f"/candidates/{target}",
                "election_id": election.id,
                "election_stage": election.stage,
                "year": election.election_date.year,
                "source_sha256": candidate.source_sha256,
                "role": role,
            }
        assert race is not None
        money_context = None
        if data.get("money_office"):
            office = _required(data["money_office"], "Campaign-money office", limit=60)
            district = data.get("money_district") or None
            pointer = db.get(
                m.CampaignFinanceFilingCurrentSnapshot, True, populate_existing=True
            )
            contest = db.scalar(
                select(m.CampaignFinanceFiler.registration_number)
                .where(
                    m.CampaignFinanceFiler.snapshot_id
                    == (pointer.snapshot_id if pointer else None),
                    m.CampaignFinanceFiler.office == office,
                    m.CampaignFinanceFiler.district == district,
                )
                .limit(1)
            )
            if contest is None:
                raise ValueError(
                    "Campaign-money office and district must exist in current records"
                )
            money_context = {
                "office": office,
                "district": district,
                "year": election.election_date.year,
            }
        elif data.get("money_district"):
            raise ValueError("Campaign-money district requires its exact office")
        # No dedicated race URL is established by this record. Preserve precise
        # race identity rather than sending a reader to an unrelated seat page.
        return {
            "label": race.office,
            "race_id": race.id,
            "office": race.office,
            "jurisdiction_scope": race.jurisdiction_scope,
            "money_context": money_context,
            "election_id": election.id,
            "election_stage": election.stage,
            "year": election.election_date.year,
        }
    if kind == "related_document":
        related = _publication(db, target, approved=True)
        if publication is None or related.id == publication.id:
            raise ValueError("Related document must be another approved copy")
        return {
            "label": related.safe_title,
            "publication_id": str(related.id),
            "facility_id": related.facility_id,
            "file_id": related.file_id,
            "content_hash": related.content_hash,
            "fingerprint": related.fingerprint,
        }
    if kind == "principal":
        from alethical.api.services import lobbying

        if not target.isdecimal() or int(target) < 1:
            raise ValueError("Choose an existing lobbying principal entity number")
        pair = lobbying.published_pair(db)
        if pair is None:
            raise ValueError("Current lobbying records are unavailable")
        names = lobbying._principal_names(pair)
        held = db.execute(
            select(names.c.name).where(names.c.entity_id == target)
        ).scalar_one_or_none()
        if not held:
            raise ValueError("Lobbying principal does not exist in current records")
        if "quote" in data and held.casefold() not in data["quote"].casefold():
            raise ValueError("Principal organization must be printed in the quotation")
        return {
            "label": held,
            "href": f"/money/lobbying/principals/{target}",
            "entity_id": int(target),
            "role": printed_role or "",
            "source_release_id": str(pair.id),
            "expenditure_snapshot_id": str(pair.expenditure_snapshot_id),
            "lobbyist_snapshot_id": str(pair.lobbyist_snapshot_id),
        }
    if kind == "issue":
        if (
            publication is None
            or target.casefold() not in data["quote"].casefold()
            or re.search(r"https?://|www\.", target, re.I)
        ):
            raise ValueError(
                "Issue must be the exact printed text, not an inferred identity or URL"
            )
        return {"label": target, "role": "Printed issue"}
    if kind == "expense":
        link = db.get(m.FCCExpenseLink, _id(target), populate_existing=True)
        if (
            publication is None
            or link is None
            or link.content_hash != publication.content_hash
            or link.status != "accepted"
            or not link.reviewed_by
        ):
            raise ValueError(
                "Use an accepted expense link for this exact source contents"
            )
        state = fcc_expense_links.link_state(db, link)
        if state["review_needed"]:
            raise ValueError(
                "Expense evidence changed; review the exact retained source before connecting"
            )
        # A hash can belong to several FCC files. Binding the connection to this
        # publication is the additional, explicit identity review the archive lacks.
        if data.get("file_identity_reviewed") is not True:
            raise ValueError(
                "Review the exact FCC file identity for this expense connection"
            )
        body = db.get(m.CampaignFinanceSnapshotBody, link.source_snapshot_id)
        if body is None:
            raise ValueError("Retained expense source copy is unavailable")
        return {
            "label": "Reported campaign expense",
            "expense_link_id": str(link.id),
            "source_dataset": link.source_dataset,
            "source_snapshot_id": str(link.source_snapshot_id),
            "source_content_hash": link.source_content_hash,
            "source_row_number": link.source_row_number,
            "source_row": link.source_row,
            "source_changed": False,
            "facility_id": publication.facility_id,
            "file_id": publication.file_id,
            "content_hash": publication.content_hash,
            "extraction_version": link.extraction_version,
        }
    raise ValueError("Unsupported connection kind")


def _require_target_fingerprint(db, kind, target_id, publication, data):
    preview = target_preview(
        db,
        kind,
        target_id,
        publication.id if publication else None,
        election_stage=data.get("election_stage"),
        money_office=data.get("money_office"),
        money_district=data.get("money_district"),
        role=data.get("role"),
    )
    if data.get("expected_target_fingerprint") != preview["target_fingerprint"]:
        raise ValueError(
            "Target changed or was not previewed; review its exact fingerprint again"
        )


def add_connection(
    db: Session, actor: str, data: dict, *, store=None
) -> m.TVAdConnection:
    scope, publication = data.get("scope", "file"), None
    kind = data.get("kind")
    if scope == "file":
        publication = _publication(
            db, data.get("publication_id"), approved=True, lock=True
        )
        source = _source(
            db, publication.facility_id, publication.file_id, publication.content_hash
        )
        facility_id, folder_id, folder_hash = source.facility_id, source.folder_id, None
        quote = _quote(publication, data.get("page"), data.get("quote"))
        page = data["page"]
    elif scope == "folder" and kind == "committee":
        facility_id, folder_id, folder_hash = (
            data.get("facility_id"),
            _required(data.get("folder_id"), "Folder identity"),
            data.get("folder_content_hash"),
        )
        if facility_id not in STATIONS:
            raise ValueError("Station is outside the approved collection")
        # Match a retained folder observation itself, never infer folder identity
        # from the file's content hash or a caller-supplied external address.
        _folder_observations(db, facility_id, folder_id, folder_hash)
        quote, page = _required(data.get("quote"), "Folder evidence quotation"), None
        retained = folder_evidence(db, facility_id, folder_id, folder_hash, store=store)
        if " ".join(quote.split()) not in " ".join(retained["text"].split()):
            raise ValueError(
                "Folder quotation must appear in the exact retained listing"
            )
        if (
            data.get("publication_approved") is True
            and db.scalar(
                select(m.TVAdFolderApproval.id)
                .where(
                    m.TVAdFolderApproval.facility_id == facility_id,
                    m.TVAdFolderApproval.folder_id == folder_id,
                    m.TVAdFolderApproval.content_hash == folder_hash,
                    m.TVAdFolderApproval.status == "approved",
                )
                .limit(1)
            )
            is None
        ):
            raise ValueError(
                "Approve this exact folder's safe metadata before publishing its connection"
            )
    else:
        raise ValueError("Folder connections are separate committee relationships")
    published = _decision(data)
    target_id = _required(data.get("target_id"), "Target", limit=2000)
    if kind == "expense" and ":" in target_id:
        if publication is None or data.get("file_identity_reviewed") is not True:
            raise ValueError(
                "Review the exact FCC file identity before connecting expenses"
            )
        dataset, snapshot, expense_row = _expense_target(db, target_id)
        if data.get("source_content_hash") != snapshot.content_hash:
            raise ValueError(
                "Review the exact expense copy fingerprint before connecting"
            )
        _require_target_fingerprint(db, kind, target_id, publication, data)
        extraction_version = _required(
            data.get("extraction_version"), "Source reading version", limit=80
        )
        link = fcc_expense_links.write_link(
            db,
            publication.content_hash,
            extraction_version,
            dataset,
            snapshot.id,
            expense_row.row_number,
            _required(data.get("evidence"), "Review evidence"),
            status="accepted",
            reviewed_by=_required(actor, "Actor", limit=200),
        )
        target_id = str(link.id)
    target = _target(db, kind, target_id, {**data, "quote": quote}, publication)
    if target.get("money_context") and data.get("money_context_reviewed") is not True:
        raise ValueError("Review the exact campaign-money office and district")
    if not (kind == "expense" and ":" in data["target_id"]):
        expected = _target_fingerprint(
            kind,
            target_id,
            publication,
            {"label": target_id} if kind == "issue" else target,
        )
        if data.get("expected_target_fingerprint") != expected:
            raise ValueError(
                "Target changed or was not previewed; review its exact fingerprint again"
            )
    row = m.TVAdConnection(
        scope=scope,
        publication_id=publication.id if publication else None,
        facility_id=facility_id,
        folder_id=folder_id,
        folder_content_hash=folder_hash,
        kind=kind,
        target_id=target_id,
        target_snapshot=target,
        page=page,
        quote=quote,
        status="checked",
        evidence=_required(data.get("evidence"), "Review evidence"),
        reviewed_by=_required(actor, "Actor", limit=200),
        checked_at=now(),
        publication_approved=published,
    )
    db.add(row)
    _event(
        db,
        "connection",
        row,
        "checked",
        actor,
        row.evidence,
        {
            "publication_id": str(publication.id) if publication else None,
            "folder_content_hash": folder_hash,
            "publication_approved": published,
        },
    )
    return row


def _withdraw(db, model, id, actor, evidence):
    row = db.scalar(select(model).where(model.id == _id(id)).with_for_update())
    if (
        row is None
        or row.status != "checked"
        and not (model is m.TVAdFact and row.history_publication_approved)
    ):
        raise ValueError("Checked item not found")
    row.status, row.withdrawn_at, row.publication_approved = "withdrawn", now(), False
    if model is m.TVAdFact:
        row.history_publication_approved = False
    _event(
        db,
        "fact" if model is m.TVAdFact else "connection",
        row,
        "withdrawn",
        actor,
        evidence,
        {},
    )
    return row


def withdraw_fact(db, id, actor, evidence):
    return _withdraw(db, m.TVAdFact, id, actor, evidence)


def withdraw_connection(db, id, actor, evidence):
    return _withdraw(db, m.TVAdConnection, id, actor, evidence)


def read_artifact(publication, store=None, *, page=None):
    """Private verified bytes. Caller must authorize reviewer or approved reader."""
    if publication.fingerprint != _fingerprint(publication_content(publication)):
        raise ValueError("Copy fingerprint mismatch")
    artifact = (
        publication.artifacts["pdf"]
        if page is None
        else next(
            (p for p in publication.artifacts["pages"] if p["page"] == page), None
        )
    )
    if artifact is None:
        raise ValueError("Prepared page or PDF not found")
    store = store or raw_file_store_from_env()
    with tempfile.TemporaryDirectory(prefix="tv-artifact-") as directory:
        path = Path(directory) / "artifact"
        store.get(artifact["object_key"], str(path), max_bytes=artifact["byte_size"])
        body = path.read_bytes()
    if (
        len(body) != artifact["byte_size"]
        or hashlib.sha256(body).hexdigest() != artifact["sha256"]
    ):
        raise ValueError("Prepared artifact failed its fingerprint check")
    return body


def render_original_page(db, facility_id, file_id, content_hash, page, store=None):
    """Review-only raster preview, never a reader fallback or original PDF URL."""
    _source(db, facility_id, file_id, content_hash)
    if (
        isinstance(page, bool)
        or not isinstance(page, int)
        or not 1 <= page <= tv_ad_redaction.MAX_PAGES
    ):
        raise ValueError("Invalid source page")
    body_row = db.get(m.FCCSourceBody, content_hash)
    if body_row is None:
        raise ValueError("Source contents unavailable")
    rendered = tv_ad_redaction.render_redacted(
        fcc_archive.read_body(store or raw_file_store_from_env(), body_row),
        [],
        only_page=page,
    )
    result = next(
        (item["bytes"] for item in rendered["pages"] if item["page"] == page), None
    )
    if result is None:
        raise ValueError("Source page not found")
    return result


def review_payload(db, id):
    """Authenticated private reviewer data; never use as reader output."""
    row = _publication(db, id)

    def iso(value):
        return value.isoformat() if value else None

    facts = db.scalars(
        select(m.TVAdFact)
        .where(m.TVAdFact.publication_id == row.id)
        .order_by(m.TVAdFact.checked_at)
    ).all()
    connections = db.scalars(
        select(m.TVAdConnection)
        .where(m.TVAdConnection.publication_id == row.id)
        .order_by(m.TVAdConnection.checked_at)
    ).all()
    ids = [
        row.id,
        *(fact.id for fact in facts),
        *(connection.id for connection in connections),
    ]
    events = db.scalars(
        select(m.TVAdReviewEvent)
        .where(m.TVAdReviewEvent.entity_id.in_(ids))
        .order_by(m.TVAdReviewEvent.created_at)
    ).all()
    return {
        "publication": {
            "id": str(row.id),
            "facility_id": row.facility_id,
            "file_id": row.file_id,
            "content_hash": row.content_hash,
            "status": row.status,
            "metadata_only": row.artifacts.get("pdf") is None,
            "metadata_approved": row.metadata_approved,
            "metadata_reviewed_at": iso(row.metadata_reviewed_at),
            "safe_title": row.safe_title,
            "safe_folder": row.safe_folder,
            "category": row.category,
            "safe_pages": row.safe_pages,
            "redactions": row.redactions,
            "fingerprint": row.fingerprint,
            "created_at": iso(row.created_at),
            "reviewed_at": iso(row.reviewed_at),
            "pages": [
                {key: p[key] for key in ("page", "width", "height")}
                for p in row.artifacts["pages"]
            ],
        },
        "facts": [
            {
                "id": str(f.id),
                "field": f.field,
                "value": f.value if f.status == "checked" else None,
                "qualifier": f.qualifier if f.status == "checked" else None,
                "organization_name": f.organization_name
                if f.status == "checked"
                else None,
                "history_publication_approved": f.history_publication_approved,
                "agency_address_reviewed": f.agency_address_reviewed,
                "role": f.role if f.status == "checked" else None,
                "page": f.page,
                "quote": f.quote if f.status == "checked" else None,
                "status": f.status,
                "publication_approved": f.publication_approved,
                "checked_at": iso(f.checked_at),
                "supersedes_id": str(f.supersedes_id) if f.supersedes_id else None,
            }
            for f in facts
        ],
        "connections": [
            {
                "id": str(c.id),
                "kind": c.kind,
                "scope": c.scope,
                "target_id": c.target_id if c.status == "checked" else None,
                "target_snapshot": c.target_snapshot if c.status == "checked" else None,
                "page": c.page,
                "quote": c.quote if c.status == "checked" else None,
                "status": c.status,
                "publication_approved": c.publication_approved,
                "checked_at": iso(c.checked_at),
            }
            for c in connections
        ],
        "events": [
            {
                "action": e.action,
                "entity_type": e.entity_type,
                "entity_id": str(e.entity_id),
                "actor": e.actor,
                "evidence": e.evidence,
                "created_at": iso(e.created_at),
            }
            for e in events
        ],
    }


def approve_metadata(db, id, actor, data):
    """Publish safe metadata independently from images, text and checked facts."""
    row = _publication(db, id, lock=True)
    if row.status == "withdrawn":
        raise ValueError("Withdrawn metadata cannot be approved again")
    if (
        data.get("expected_fingerprint") != row.fingerprint
        or data.get("metadata_reviewed") is not True
    ):
        raise ValueError("Review the exact safe metadata before approving")
    row.metadata_approved = True
    row.metadata_reviewed_by = _required(actor, "Actor", limit=200)
    row.metadata_reviewed_at = now()
    _event(
        db,
        "publication",
        row,
        "metadata_approved",
        actor,
        _required(data.get("evidence"), "Review evidence"),
        {"fingerprint": row.fingerprint},
    )
    return row


def folder_content(row):
    return {
        key: getattr(row, key)
        for key in (
            "facility_id",
            "folder_id",
            "content_hash",
            "safe_label",
            "safe_path",
            "category",
            "year",
        )
    }


def _folder_observations(db, facility_id, folder_id, content_hash):
    if facility_id not in STATIONS:
        raise ValueError("Station is outside the approved collection")
    rows = db.scalars(
        select(m.FCCObservation).where(
            m.FCCObservation.facility_id == facility_id,
            m.FCCObservation.kind == "folder",
            m.FCCObservation.status == "stored",
            m.FCCObservation.content_hash == content_hash,
        )
    ).all()
    matches = [
        row for row in rows if row.url.rstrip("/").rsplit("/", 1)[-1] == folder_id
    ]
    if not matches:
        raise ValueError("Exact retained folder listing not found")
    return matches


def prepare_folder(db, actor, data):
    facility, folder, digest = (
        data.get("facility_id"),
        _required(data.get("folder_id"), "Folder identity"),
        data.get("content_hash"),
    )
    _folder_observations(db, facility, folder, digest)
    year = data.get("year")
    if year is not None and (
        isinstance(year, bool) or not isinstance(year, int) or not 1900 <= year <= 2100
    ):
        raise ValueError("Use the source folder year or leave it unknown")
    row = m.TVAdFolderApproval(
        facility_id=facility,
        folder_id=folder,
        content_hash=digest,
        category=_required(data.get("category"), "Literal station category", limit=500),
        year=year,
        safe_label=_required(data.get("safe_label"), "Safe folder label", limit=500),
        safe_path=_required(data.get("safe_path"), "Safe folder path", limit=1000),
        status="draft",
        created_by=_required(actor, "Actor", limit=200),
    )
    row.fingerprint = _fingerprint(folder_content(row))
    db.add(row)
    _event(
        db,
        "folder",
        row,
        "prepared",
        actor,
        _required(data.get("evidence"), "Preparation evidence"),
        {"fingerprint": row.fingerprint},
    )
    return row


def _folder(db, id):
    row = db.scalar(
        select(m.TVAdFolderApproval)
        .where(m.TVAdFolderApproval.id == _id(id))
        .with_for_update()
        .execution_options(populate_existing=True)
    )
    if row is None or row.fingerprint != _fingerprint(folder_content(row)):
        raise ValueError("Folder preparation unavailable or changed")
    return row


def approve_folder(db, id, actor, data):
    row = _folder(db, id)
    if (
        row.status != "draft"
        or data.get("expected_fingerprint") != row.fingerprint
        or data.get("metadata_reviewed") is not True
    ):
        raise ValueError("Review the exact prepared folder metadata before approving")
    previous = db.scalar(
        select(m.TVAdFolderApproval.id)
        .where(
            m.TVAdFolderApproval.facility_id == row.facility_id,
            m.TVAdFolderApproval.folder_id == row.folder_id,
            m.TVAdFolderApproval.content_hash == row.content_hash,
            m.TVAdFolderApproval.status == "approved",
        )
        .limit(1)
    )
    if previous:
        raise ValueError(
            "Withdraw the existing approved folder revision before replacing it"
        )
    row.status, row.reviewed_by, row.reviewed_at = (
        "approved",
        _required(actor, "Actor", limit=200),
        now(),
    )
    _event(
        db,
        "folder",
        row,
        "approved",
        actor,
        _required(data.get("evidence"), "Review evidence"),
        {"fingerprint": row.fingerprint},
    )
    return row


def withdraw_folder(db, id, actor, evidence):
    row = _folder(db, id)
    if row.status == "withdrawn":
        raise ValueError("Folder metadata is already withdrawn")
    row.status, row.withdrawn_at = "withdrawn", now()
    for connection in db.scalars(
        select(m.TVAdConnection)
        .where(
            m.TVAdConnection.scope == "folder",
            m.TVAdConnection.facility_id == row.facility_id,
            m.TVAdConnection.folder_id == row.folder_id,
            m.TVAdConnection.folder_content_hash == row.content_hash,
            m.TVAdConnection.status == "checked",
        )
        .with_for_update()
    ):
        connection.status, connection.withdrawn_at, connection.publication_approved = (
            "withdrawn",
            row.withdrawn_at,
            False,
        )
        _event(
            db,
            "connection",
            connection,
            "withdrawn",
            actor,
            evidence,
            {"folder_approval_withdrawn": str(row.id)},
        )
    _event(
        db,
        "folder",
        row,
        "withdrawn",
        actor,
        evidence,
        {"fingerprint": row.fingerprint},
    )
    return row


def folder_review_payload(db, id):
    row = _folder(db, id)
    return {
        "id": str(row.id),
        "status": row.status,
        "facility_id": row.facility_id,
        "folder_id": row.folder_id,
        "content_hash": row.content_hash,
        "safe_label": row.safe_label,
        "safe_path": row.safe_path,
        "category": row.category,
        "year": row.year,
        "fingerprint": row.fingerprint,
        "reviewed_at": row.reviewed_at.isoformat() if row.reviewed_at else None,
        "created_at": row.created_at.isoformat() if row.created_at else None,
    }


def folder_evidence(db, facility_id, folder_id, content_hash, store=None):
    """Private reviewer source text from the exact retained folder listing."""
    observations = _folder_observations(db, facility_id, folder_id, content_hash)
    body = db.get(m.FCCSourceBody, content_hash)
    if body is None:
        raise ValueError("Folder source contents unavailable")
    raw = fcc_archive.read_body(store or raw_file_store_from_env(), body).decode(
        "utf-8", errors="replace"
    )
    try:
        data = json.loads(raw)
    except ValueError:
        text = html.unescape(re.sub(r"<[^>]*>", " ", raw))
    else:

        def values(item):
            if isinstance(item, dict):
                return [part for value in item.values() for part in values(value)]
            if isinstance(item, list):
                return [part for value in item for part in values(value)]
            return [str(item)] if isinstance(item, (str, int, float)) else []

        text = "\n".join(values(data))
    return {
        "text": text,
        "source_url": observations[0].url,
        "content_hash": content_hash,
    }
