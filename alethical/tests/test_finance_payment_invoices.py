"""An invoice is related only by checked source-row evidence, never name/amount."""

# ruff: noqa: F811
from datetime import timedelta

import pytest

from alethical.api.services import finance_payment_invoices as invoices
from alethical.api.services import tv_ad_review as review
from alethical.db import models as m
from alethical.pipeline import fcc_expense_links
from alethical.tests.finance_fixtures import finance_db, finance_api  # noqa: F401
from alethical.tests.test_finance_media_buys import listed, source  # noqa: F401
from alethical.tests.test_finance_station_checks import original  # noqa: F401
from alethical.tests.test_fcc_expense_links import _expense, _release


@pytest.fixture()
def linked(original):
    db, doc = original.db, original.document
    snapshot = _release(db)["expenditures"]
    row = _expense(db, snapshot, committee_reg_num="19002")
    common = dict(
        facility_id=doc.facility_id,
        file_id=doc.file_id,
        content_hash=doc.content_hash,
        page=2,
        quote="Synthetic invoice evidence",
        evidence="Synthetic check",
        made_by_alethical_team=False,
        checked_at=review.now(),
    )
    fact = m.FinanceTVFact(**common, field="document_kind", value="Invoice")
    connection = m.FinanceTVConnection(
        **common,
        kind="expense",
        target_id=f"expenditures:{snapshot.id}:1",
        target_snapshot={
            "source_dataset": "expenditures",
            "source_snapshot_id": str(snapshot.id),
            "source_content_hash": snapshot.content_hash,
            "source_row_number": row.row_number,
            "source_row": fcc_expense_links._record(row),
            "facility_id": doc.facility_id,
            "file_id": doc.file_id,
            "content_hash": doc.content_hash,
        },
    )
    db.add_all([fact, connection])
    db.flush()
    return original, snapshot, row, fact, connection


def read(linked, numbers=(1,)):
    original, snapshot, *_ = linked
    return invoices.matching_invoices(
        original.db, snapshot_id=snapshot.id, row_numbers=numbers
    )


def test_pins_exact_expense_row_file_version_and_page(linked):
    original, *_ = linked
    assert read(linked) == {
        1: {"key": original.key, "version": original.version, "page": 2}
    }
    assert read(linked, (2,)) == {}
    assert read(linked, ()) == {}


@pytest.mark.parametrize("which", ["fact", "connection"])
def test_withdrawn_evidence_never_yields_invoice(linked, which):
    original, _, _, fact, connection = linked
    item = fact if which == "fact" else connection
    item.withdrawn_at = review.now()
    item.withdrawal_reason = "Synthetic withdrawal"
    original.db.flush()
    assert read(linked) == {}


def test_changed_payment_row_is_not_reused(linked):
    original, _, row, *_ = linked
    row.amount += 1
    original.db.flush()
    assert read(linked) == {}


def test_new_source_copy_never_rebinds_old_evidence(linked):
    original, *_ = linked
    _release(original.db)
    assert read(linked) == {}


def test_checked_order_is_not_an_invoice(linked):
    original, _, _, fact, _ = linked
    # Corrections are append-only; the old check is superseded by a new check.
    replacement = m.FinanceTVFact(
        facility_id=fact.facility_id,
        file_id=fact.file_id,
        content_hash=fact.content_hash,
        page=2,
        quote="Synthetic order",
        evidence="Synthetic correction",
        made_by_alethical_team=False,
        checked_at=review.now() + timedelta(seconds=1),
        field="document_kind",
        value="Order",
        supersedes_id=fact.id,
    )
    original.db.add(replacement)
    original.db.flush()
    assert read(linked) == {}


def test_preserves_an_enclosing_station_read_scope(linked):
    original, *_ = linked
    marker = {
        "originals": True,
        "scoped": True,
        "original_checks": {"facts": {}, "connections": {}},
    }
    original.db.info["tv_projection"] = marker
    try:
        assert read(linked)
        assert original.db.info["tv_projection"] is marker
    finally:
        original.db.info.pop("tv_projection", None)


def test_non_draft_copy_checks_follow_finance_withdrawals(linked):
    from alethical.tests.test_tv_ad_review import approved
    from alethical.tests.test_finance_media_buys import _check, _connection
    from alethical.pipeline.fcc_document_text import EXTRACTOR_VERSION

    original, snapshot, row, fact, direct = linked
    db = original.db
    direct.withdrawn_at = review.now()
    direct.withdrawal_reason = "Use copied evidence in this fixture"
    db.flush()
    copy = approved(db, (original.document, original.store))
    copied_fact = _check(db, copy, "document_kind", "Invoice")
    link = m.FCCExpenseLink(
        content_hash=original.version,
        extraction_version=EXTRACTOR_VERSION,
        source_dataset="expenditures",
        source_snapshot_id=snapshot.id,
        source_content_hash=snapshot.content_hash,
        source_row_number=row.row_number,
        source_row=fcc_expense_links._record(row),
        status="accepted",
        evidence="Synthetic source match",
        reviewed_by="synthetic-reviewer",
    )
    db.add(link)
    db.flush()
    c = _connection(
        db,
        copy,
        "expense",
        str(link.id),
        {
            **direct.target_snapshot,
            "expense_link_id": str(link.id),
            "extraction_version": EXTRACTOR_VERSION,
        },
        page=2,
    )
    assert read(linked)[1]["version"] == original.version
    link.status = "rejected"
    db.flush()
    assert read(linked) == {}
    link.status = "accepted"
    db.flush()
    db.add(
        m.FinanceTVCopyWithdrawal(
            connection_id=c.id, withdrawal_reason="Synthetic withdrawal"
        )
    )
    db.flush()
    assert read(linked) == {}
    assert copied_fact.status == "checked"


def test_conflicting_checked_document_kind_is_not_selected(linked):
    original, _, _, fact, _ = linked
    original.db.add(
        m.FinanceTVFact(
            facility_id=fact.facility_id,
            file_id=fact.file_id,
            content_hash=fact.content_hash,
            page=2,
            quote="Synthetic conflicting order",
            evidence="Synthetic check",
            made_by_alethical_team=False,
            checked_at=review.now(),
            field="document_kind",
            value="Order",
        )
    )
    original.db.flush()
    assert read(linked) == {}


def test_finance_payment_row_exposes_only_the_exact_invoice_link(linked, finance_api):
    original, *_ = linked
    original.db.commit()
    response = finance_api.get(
        "/api/v1/finance/committees/19002/payments",
        params={"direction": "made", "year": 2026},
    )
    assert response.status_code == 200, response.text
    row = response.json()["data"]["payments"][0]
    assert row["matching_invoice"] == {
        "key": original.key,
        "version": original.version,
        "page": 2,
    }
    public = finance_api.get(
        "/api/v1/committees/19002/payments", params={"direction": "made", "year": 2026}
    )
    assert "matching_invoice" not in public.json()["data"]["payments"][0]


def test_withdrawal_invalidates_payment_paging_and_retry_removes_link(
    linked, finance_api
):
    original, _, _, _, connection = linked
    db = original.db
    db.commit()
    path = "/api/v1/finance/committees/19002/payments"
    params = {"direction": "made", "year": 2026}
    first = finance_api.get(path, params=params)
    assert first.status_code == 200, first.text
    version = first.json()["data"]["version"]
    connection.withdrawn_at = review.now()
    connection.withdrawal_reason = "Synthetic withdrawal"
    db.commit()
    stale = finance_api.get(path, params={**params, "version": version})
    assert stale.status_code == 409, stale.text
    fresh = finance_api.get(path, params=params)
    assert fresh.status_code == 200, fresh.text
    assert "matching_invoice" not in fresh.json()["data"]["payments"][0]


def test_different_checked_destinations_never_choose_arbitrarily(linked):
    original, _, _, fact, connection = linked
    db = original.db
    second = m.FinanceTVConnection(
        facility_id=connection.facility_id,
        file_id=connection.file_id,
        content_hash=connection.content_hash,
        page=1,
        quote="Synthetic second invoice page",
        evidence="Synthetic check",
        made_by_alethical_team=False,
        checked_at=review.now(),
        kind="expense",
        target_id=connection.target_id,
        target_snapshot=connection.target_snapshot,
    )
    db.add(second)
    db.flush()
    assert read(linked) == {}


def test_different_files_are_ambiguous_but_duplicate_exact_checks_are_not(linked):
    from alethical.tests.test_finance_station_checks import _file

    original, _, _, fact, connection = linked
    db = original.db
    common = dict(
        facility_id=connection.facility_id,
        file_id=connection.file_id,
        content_hash=connection.content_hash,
        page=2,
        quote="Synthetic duplicate check",
        evidence="Synthetic check",
        made_by_alethical_team=False,
        checked_at=review.now(),
    )
    db.add(
        m.FinanceTVConnection(
            **common,
            kind="expense",
            target_id=connection.target_id,
            target_snapshot=connection.target_snapshot,
        )
    )
    db.flush()
    assert read(linked)[1]["version"] == original.version
    another = _file(db, original.store)
    other = {
        **common,
        "facility_id": another.facility_id,
        "file_id": another.file_id,
        "content_hash": another.content_hash,
    }
    db.add(m.FinanceTVFact(**other, field="document_kind", value="Invoice"))
    db.add(
        m.FinanceTVConnection(
            **other,
            kind="expense",
            target_id=connection.target_id,
            target_snapshot={
                **connection.target_snapshot,
                "facility_id": another.facility_id,
                "file_id": another.file_id,
                "content_hash": another.content_hash,
            },
        )
    )
    db.flush()
    assert read(linked) == {}


def test_invoice_projection_is_private_and_never_runs_for_receipts(
    linked, finance_api, monkeypatch
):
    original, *_ = linked
    original.db.commit()
    calls = []
    monkeypatch.setattr(
        invoices, "matching_invoices", lambda *a, **kw: calls.append(kw) or {}
    )
    path = "/api/v1/finance/committees/19002/payments"
    denied = finance_api.get(
        path, params={"direction": "made", "year": 2026}, headers={"Authorization": ""}
    )
    assert denied.status_code in (401, 403)
    assert calls == []
    received = finance_api.get(path, params={"direction": "received", "year": 2026})
    assert received.status_code == 200, received.text
    assert calls == []
