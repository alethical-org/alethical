"""Private expense-link evidence survives disposable finance row replacement."""

from __future__ import annotations

import hashlib
import uuid
from datetime import date, datetime, timezone
from decimal import Decimal
from typing import Any

import pytest
from sqlalchemy import delete, event, func, select

from alethical.db import models as m
from alethical.db.session import get_session_factory
from alethical.pipeline import fcc_expense_links as links
from alethical.pipeline.fcc_document_text import EXTRACTOR_VERSION


@pytest.fixture()
def db(seed_database):
    session = get_session_factory()()
    try:
        yield session
    finally:
        session.rollback()
        session.close()


def _snapshot(db, dataset):
    digest = hashlib.sha256(uuid.uuid4().bytes).hexdigest()
    snapshot = m.CampaignFinanceSnapshot(
        dataset=dataset,
        download_id="-123",
        source_url="https://cfb.mn.gov/reports/test.csv",
        content_hash=digest,
        byte_size=100,
        row_count=1,
        status=m.CampaignFinanceSnapshotStatus.loaded,
    )
    db.add(snapshot)
    db.flush()
    return snapshot


def _release(db):
    snapshots = {
        dataset.value: _snapshot(db, dataset) for dataset in m.CampaignFinanceDataset
    }
    now = datetime.now(timezone.utc)
    release = m.CampaignFinanceRelease(
        contributions_snapshot_id=snapshots["contributions"].id,
        expenditures_snapshot_id=snapshots["expenditures"].id,
        independent_expenditures_snapshot_id=snapshots["independent_expenditures"].id,
        status=m.CampaignFinanceReleaseStatus.published,
        fetch_started_at=now,
        fetch_completed_at=now,
        published_at=now,
    )
    db.add(release)
    db.flush()
    pointer = db.get(m.CampaignFinanceCurrentRelease, True)
    if pointer is None:
        db.add(m.CampaignFinanceCurrentRelease(id=True, release_id=release.id))
    else:
        pointer.release_id = release.id
    db.flush()
    return snapshots


@pytest.fixture()
def finance(db):
    return _release(db)


def _expense(db, snapshot, **changes):
    data = {
        "snapshot_id": snapshot.id,
        "row_number": 1,
        "committee_name": "Example Candidate Committee",
        "committee_reg_num": "19000",
        "vendor_name": "Example Media Agency",
        "vendor_city": "Saint Paul",
        "vendor_state": "MN",
        "amount": Decimal("17378.2500"),
        "unpaid_amount": Decimal("0.0000"),
        "transaction_date": date(2026, 7, 26),
        "purpose": "Broadcast advertising",
        "year": 2026,
        "type": "Campaign Expenditure",
    }
    data.update(changes)
    row = m.CampaignFinanceExpenditureRow(**data)
    db.add(row)
    db.flush()
    return row


def _fcc(db, facts: list[dict[str, Any]] | None = None):
    digest = hashlib.sha256(uuid.uuid4().bytes).hexdigest()
    db.add(
        m.FCCSourceBody(
            content_hash=digest,
            object_key=f"fcc/{digest}",
            byte_size=100,
            compressed_hash="a" * 64,
            compressed_byte_size=80,
            compression="gzip",
        )
    )
    db.flush()
    if facts is None:
        facts = [
            {
                "field": "advertiser",
                "value": "Example Candidate Committee",
                "page": 1,
                "quote": "Advertiser: Example Candidate Committee",
            },
            {
                "field": "agency_name",
                "value": "Example Media Agency",
                "page": 1,
                "quote": "Agency Name: Example Media Agency",
            },
            {
                "field": "net_amount",
                "value": "17378.25",
                "page": 1,
                "quote": "Net Amount Due: $17,378.25",
            },
            {
                "field": "invoice_date",
                "value": "07/26/26",
                "page": 1,
                "quote": "Invoice Date: 07/26/26",
            },
        ]
    extraction = m.FCCExtraction(
        content_hash=digest,
        version=EXTRACTOR_VERSION,
        document_kind="invoice",
        status="pending_review",
        facts=facts,
        errors=[],
    )
    db.add(extraction)
    db.flush()
    db.add(
        m.FCCPage(
            content_hash=digest,
            version=EXTRACTOR_VERSION,
            page=1,
            text="\n".join(f.get("quote", "") for f in facts),
            method="pypdf",
            status="extracted",
        )
    )
    db.flush()
    return digest


def _write(db, digest, snapshot, **changes):
    inputs: dict[str, Any] = dict(
        content_hash=digest,
        extraction_version=EXTRACTOR_VERSION,
        source_dataset="expenditures",
        source_snapshot_id=snapshot.id,
        source_row_number=1,
        evidence="The invoice and expense share advertiser, agency and net amount; reviewed as related evidence only",
    )
    inputs.update(changes)
    return links.write_link(db, **inputs)


def test_suggestions_are_read_only_and_never_accepted(db, finance):
    _expense(db, finance["expenditures"])
    digest = _fcc(db)
    result = links.suggest_links(db, digest)
    assert result["reason"] == "review_required"
    assert len(result["suggestions"]) == 1
    suggestion = result["suggestions"][0]
    assert suggestion["status"] == "suggested"
    assert suggestion["source_content_hash"] == finance["expenditures"].content_hash
    assert suggestion["clues"]["amounts"][0]["expense_value"] == "17378.2500"
    assert db.scalar(select(func.count()).select_from(m.FCCExpenseLink)) == 0


def test_only_current_release_is_searched(db, finance):
    _expense(db, finance["expenditures"])
    digest = _fcc(db)
    newer = _release(db)
    result = links.suggest_links(db, digest)
    assert result["suggestions"] == []
    _expense(db, newer["expenditures"])
    assert links.suggest_links(db, digest)["suggestions"][0][
        "source_snapshot_id"
    ] == str(newer["expenditures"].id)


def test_names_alone_and_blank_source_facts_do_not_pair(db, finance):
    _expense(db, finance["expenditures"])
    digest = _fcc(
        db,
        [
            {
                "field": "advertiser",
                "value": "Example Candidate Committee",
                "page": 1,
                "quote": "Advertiser: Example Candidate Committee",
            }
        ],
    )
    assert links.suggest_links(db, digest)["suggestions"] == []
    extraction = db.get(m.FCCExtraction, (digest, EXTRACTOR_VERSION))
    extraction.facts = [
        {"field": "net_amount", "value": "17378.25", "page": 1, "quote": "   "}
    ]
    db.flush()
    assert links.suggest_links(db, digest)["suggestions"] == []
    with pytest.raises(ValueError, match="page-grounded"):
        _write(db, digest, finance["expenditures"])


def test_unheld_quote_and_conflicting_facts_are_not_pairing_evidence(db, finance):
    _expense(db, finance["expenditures"])
    digest = _fcc(db)
    page = db.get(m.FCCPage, (digest, EXTRACTOR_VERSION, 1))
    page.text = "No source quotations from this invoice are held"
    db.flush()
    with pytest.raises(ValueError, match="page-grounded"):
        _write(db, digest, finance["expenditures"])
    assert links.suggest_links(db, digest)["suggestions"] == []
    conflicted = _fcc(
        db,
        [
            {
                "field": "advertiser",
                "value": "Example Candidate Committee",
                "page": 1,
                "quote": "Advertiser: Example Candidate Committee",
            },
            {
                "field": "advertiser",
                "value": "Different Candidate Committee",
                "page": 1,
                "quote": "Advertiser: Different Candidate Committee",
            },
            {
                "field": "net_amount",
                "value": "17378.25",
                "page": 1,
                "quote": "Net Amount Due: $17,378.25",
            },
        ],
    )
    assert links.suggest_links(db, conflicted)["suggestions"] == []


def test_independent_expenses_match_spender_not_affected_candidate(db, finance):
    data = dict(
        snapshot_id=finance["independent_expenditures"].id,
        row_number=1,
        spender="Example Candidate Committee",
        spender_reg_num="19000",
        affected_committee_name="Some Other Candidate Committee",
        affected_committee_reg_num="18000",
        vendor_name="Example Media Agency",
        amount=Decimal("17378.2500"),
        transaction_date=date(2026, 7, 26),
        year=2026,
    )
    db.add(m.CampaignFinanceIndependentExpenditureRow(**data))
    db.flush()
    digest = _fcc(db)
    suggestions = links.suggest_links(db, digest)["suggestions"]
    assert len(suggestions) == 1
    assert suggestions[0]["source_dataset"] == "independent_expenditures"
    assert suggestions[0]["clues"]["names"][0]["expense_field"] == "spender"
    data.update(
        row_number=2,
        spender="Different Spender Committee",
        affected_committee_name="Example Candidate Committee",
    )
    db.add(m.CampaignFinanceIndependentExpenditureRow(**data))
    db.flush()
    assert len(links.suggest_links(db, digest)["suggestions"]) == 1


def test_writing_link_locks_extraction_before_copying_evidence(db, finance):
    _expense(db, finance["expenditures"])
    digest = _fcc(db)
    statements = []
    connection = db.connection()

    def observe(connection, cursor, statement, parameters, context, executemany):
        statements.append(statement)

    event.listen(connection, "before_cursor_execute", observe)
    try:
        _write(db, digest, finance["expenditures"])
    finally:
        event.remove(connection, "before_cursor_execute", observe)
    lock = next(
        index
        for index, sql in enumerate(statements)
        if "fcc_extraction" in sql and "FOR UPDATE" in sql
    )
    insertion = next(
        index
        for index, sql in enumerate(statements)
        if "INSERT INTO fcc_expense_link" in sql
    )
    assert lock < insertion


def test_sparse_name_and_amount_can_suggest_but_known_name_conflict_cannot(db, finance):
    _expense(db, finance["expenditures"])
    facts = [
        {
            "field": "advertiser",
            "value": "Example Candidate Committee",
            "page": 1,
            "quote": "Advertiser: Example Candidate Committee",
        },
        {
            "field": "net_amount",
            "value": "17378.25",
            "page": 1,
            "quote": "Net Amount Due: $17,378.25",
        },
    ]
    digest = _fcc(db, facts)
    assert len(links.suggest_links(db, digest)["suggestions"]) == 1
    _expense(
        db,
        finance["expenditures"],
        row_number=2,
        committee_name="Different Candidate Committee",
    )
    assert len(links.suggest_links(db, digest)["suggestions"]) == 1


def test_amount_difference_is_only_unallocated_evidence(db, finance):
    _expense(db, finance["expenditures"], amount=Decimal("20000.0000"))
    digest = _fcc(db)
    result = links.suggest_links(db, digest)
    clue = result["suggestions"][0]["clues"]
    assert clue["amounts"] == []
    assert clue["dates"][0]["match"] == "exact_date"
    assert clue["unallocated_differences"][0]["expense_minus_fcc_amount"] == "2621.7500"
    assert "not proof of agency commission" in " ".join(clue["limitations"])


def test_link_copies_exact_row_and_scope_without_new_expense(db, finance):
    row = _expense(db, finance["expenditures"])
    digest = _fcc(db)
    link = _write(db, digest, finance["expenditures"])
    assert link.status == "suggested"
    assert link.reviewed_by is None
    assert link.source_row["amount"] == "17378.2500"
    assert link.source_row["transaction_date"] == "2026-07-26"
    assert link.source_row["committee_reg_num"] == "19000"
    assert (
        link.source_row["_snapshot"]["source_url"] == finance["expenditures"].source_url
    )
    assert link.source_row["_fcc_facts"][0]["page"] == 1
    assert links.link_state(db, link) == {
        "current": True,
        "review_needed": True,
        "reason": "current_source_evidence",
    }
    assert _write(db, digest, finance["expenditures"]).id == link.id
    assert (
        db.scalar(
            select(func.count())
            .select_from(m.CampaignFinanceExpenditureRow)
            .where(m.CampaignFinanceExpenditureRow.snapshot_id == row.snapshot_id)
        )
        == 1
    )


def test_accepted_link_survives_source_row_deletion_and_refresh(db, finance):
    _expense(db, finance["expenditures"])
    digest = _fcc(db)
    link = _write(db, digest, finance["expenditures"])
    links.review_link(
        db,
        link.id,
        "accepted",
        "Test reviewer",
        "Compared exact source pages and the filed expense",
    )
    retained = dict(link.source_row)
    assert links.link_state(db, link)["review_needed"] is False
    db.execute(
        delete(m.CampaignFinanceExpenditureRow).where(
            m.CampaignFinanceExpenditureRow.snapshot_id == finance["expenditures"].id
        )
    )
    db.flush()
    assert links.link_state(db, link)["reason"] == "source_row_removed"
    newer = _release(db)
    _expense(db, newer["expenditures"], amount=Decimal("99.0000"))
    state = links.link_state(db, link)
    assert state == {
        "current": False,
        "review_needed": True,
        "reason": "source_snapshot_changed",
    }
    db.expire(link)
    assert link.status == "accepted"
    assert link.source_row == retained
    assert link.source_snapshot_id == finance["expenditures"].id
    assert link.source_row["amount"] == "17378.2500"


def test_same_position_in_new_snapshot_is_not_silent_retargeting(db, finance):
    _expense(db, finance["expenditures"])
    digest = _fcc(db)
    link = _write(db, digest, finance["expenditures"])
    newer = _release(db)
    _expense(db, newer["expenditures"])
    second = _write(db, digest, newer["expenditures"])
    assert second.id != link.id
    assert second.status == "suggested"
    assert links.link_state(db, link)["current"] is False
    assert links.link_state(db, second)["current"] is True


def test_source_hash_extraction_version_and_copied_row_cannot_be_replaced(db, finance):
    row = _expense(db, finance["expenditures"])
    digest = _fcc(db)
    link = _write(db, digest, finance["expenditures"])
    original_hash = link.source_content_hash
    finance["expenditures"].content_hash = "b" * 64
    db.flush()
    with pytest.raises(ValueError, match="immutable"):
        _write(db, digest, finance["expenditures"])
    assert link.source_content_hash == original_hash
    finance["expenditures"].content_hash = original_hash
    row.amount = Decimal("99.0000")
    db.flush()
    with pytest.raises(ValueError, match="immutable"):
        _write(db, digest, finance["expenditures"])
    assert link.source_row["amount"] == "17378.2500"
    assert links.link_state(db, link)["reason"] == "source_row_changed"
    row.amount = Decimal("17378.2500")
    old = db.get(m.FCCExtraction, (digest, EXTRACTOR_VERSION))
    db.add(
        m.FCCExtraction(
            content_hash=digest,
            version="different-version",
            document_kind="invoice",
            status="pending_review",
            facts=old.facts,
            errors=[],
        )
    )
    db.flush()
    page = db.get(m.FCCPage, (digest, EXTRACTOR_VERSION, 1))
    db.add(
        m.FCCPage(
            content_hash=digest,
            version="different-version",
            page=1,
            text=page.text,
            method="pypdf",
            status="extracted",
        )
    )
    db.flush()
    revised = _write(
        db, digest, finance["expenditures"], extraction_version="different-version"
    )
    assert revised.id != link.id
    assert revised.extraction_version == "different-version"
    assert revised.status == "suggested"
    assert link.extraction_version == EXTRACTOR_VERSION


@pytest.mark.parametrize(
    "field,value",
    [
        ("evidence", ""),
        ("evidence", " \t\n"),
        ("reviewed_by", ""),
        ("reviewed_by", "  "),
    ],
)
def test_review_requires_named_reviewer_and_nonblank_evidence(
    db, finance, field, value
):
    _expense(db, finance["expenditures"])
    digest = _fcc(db)
    link = _write(db, digest, finance["expenditures"])
    arguments = {
        "status": "accepted",
        "reviewed_by": "Test reviewer",
        "evidence": "Compared source pages",
    }
    arguments[field] = value
    with pytest.raises(ValueError, match=field):
        links.review_link(db, link.id, **arguments)
    assert link.status == "suggested"


def test_accepting_on_write_requires_review_and_existing_link_needs_explicit_review(
    db, finance
):
    _expense(db, finance["expenditures"])
    digest = _fcc(db)
    with pytest.raises(ValueError, match="reviewed_by"):
        _write(db, digest, finance["expenditures"], status="accepted")
    link = _write(db, digest, finance["expenditures"])
    with pytest.raises(ValueError, match="explicit review"):
        _write(
            db,
            digest,
            finance["expenditures"],
            status="accepted",
            reviewed_by="Test reviewer",
        )
    assert link.status == "suggested"
    first_evidence = link.evidence
    links.review_link(db, link.id, "accepted", "Test reviewer", "Exact source review")
    links.review_link(
        db,
        link.id,
        "rejected",
        "Test reviewer",
        "The document covers a different booking",
    )
    assert first_evidence in link.evidence
    assert "Exact source review" in link.evidence
    assert link.status == "rejected"


def test_many_to_many_links_do_not_modify_finance_amounts(db, finance):
    _expense(db, finance["expenditures"])
    _expense(db, finance["expenditures"], row_number=2)
    first, second = _fcc(db), _fcc(db)
    _write(db, first, finance["expenditures"])
    _write(db, first, finance["expenditures"], source_row_number=2)
    _write(db, second, finance["expenditures"])
    assert db.scalar(select(func.count()).select_from(m.FCCExpenseLink)) == 3
    assert db.scalar(
        select(func.sum(m.CampaignFinanceExpenditureRow.amount)).where(
            m.CampaignFinanceExpenditureRow.snapshot_id == finance["expenditures"].id
        )
    ) == Decimal("34756.5000")
