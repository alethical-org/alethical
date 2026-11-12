"""Checked source observations need explicit, immutable review and fresh originals."""

# ruff: noqa: F811

from copy import deepcopy

import pytest
from sqlalchemy import select, text
from sqlalchemy.exc import SQLAlchemyError

from alethical.db import models as m
from alethical.pipeline import election_source_readings as r
from alethical.pipeline.election_comparison import ComparisonImportError, archive_source
from alethical.tests.test_election_comparison_storage import db, MemoryStore  # noqa: F401
from alethical.tests.test_election_local_financial_form import native_pdf


def reading(body=None, **changes):
    body = body or native_pdf()
    fields = [
        r.field_proposal(
            "cover.total_received",
            page=1,
            bounds=[258, 347, 305, 364],
            label="TOTAL AMOUNT RECEIVED",
            literal="1,482.11",
            value_type="money",
            currency="USD",
        ),
        r.field_proposal(
            "cover.missing",
            page=1,
            bounds=[10, 10, 20, 20],
            label="Unfilled cell",
            literal="",
            state="blank",
            value_type="money",
            currency="USD",
        ),
    ]
    receipt = r.prepare_receipt(body, fields=fields, document_kind="financial_report")
    return body, receipt | changes


def retain(db, body):
    store = MemoryStore()
    archive_source(db, store, body)
    return store


def check(db, store, receipt, **changes):
    return r.record_reading(
        db,
        store,
        receipt=receipt,
        decision="checked",
        reviewed_by="private test reviewer",
        reason="Synthetic listed cells checked against rendered original",
        expected_previous_id=None,
        **changes,
    )


def test_proposal_has_no_approval_and_blank_is_not_zero():
    _, receipt = reading()
    assert set(receipt) == r.RECEIPT_FIELDS
    assert "checked" not in receipt and "figures_accepted" not in receipt
    assert receipt["fields"][0]["normalized"] == "1482.11"
    assert receipt["fields"][1]["normalized"] is None
    assert r.validate_receipt(receipt) == receipt


@pytest.mark.parametrize(
    "change",
    [
        "digit",
        "blank_zero",
        "page",
        "bounds",
        "duplicate",
        "extra",
        "float",
        "expression",
    ],
)
def test_receipt_rejects_ambiguous_or_forged_shape(change):
    _, receipt = reading()
    if change == "digit":
        receipt["fields"][0]["normalized"] = "1482.12"
    elif change == "blank_zero":
        receipt["fields"][1]["normalized"] = "0.00"
    elif change == "page":
        receipt["fields"][0]["page"] = 2
    elif change == "bounds":
        receipt["fields"][0]["bounds"][2] = float("inf")
    elif change == "duplicate":
        receipt["fields"].append(deepcopy(receipt["fields"][0]))
    elif change == "extra":
        receipt["figures_accepted"] = True
    elif change == "float":
        receipt["fields"][0]["normalized"] = 1482.11
    else:
        receipt["fields"][0]["literal"] = "100 + loan"
    with pytest.raises(ComparisonImportError):
        r.validate_receipt(receipt)


def test_record_checks_render_and_bytes_before_any_decision(db):
    body, receipt = reading()
    store = retain(db, body)
    receipt["pages"][0]["image_sha256"] = "f" * 64
    with pytest.raises(ComparisonImportError, match="render"):
        check(db, store, receipt)
    assert db.scalar(select(m.ElectionSourceReadingDecision.id)) is None
    receipt = reading()[1]
    key = db.get(m.ElectionResultSource, receipt["original_sha256"]).object_key
    store.objects[key] = b"corrupt"
    with pytest.raises(ComparisonImportError, match="original"):
        check(db, store, receipt)
    assert db.scalar(select(m.ElectionSourceReadingDecision.id)) is None


def test_linear_review_withdrawal_same_content_recovery_and_old_retry(db):
    body, receipt = reading()
    store = retain(db, body)
    first = check(db, store, receipt)
    assert check(db, store, receipt).id == first.id
    context = r.load_verified_reading_context(db, store, [first.receipt_sha256])
    assert context.receipt(first.receipt_sha256) == receipt
    withdrawn = r.record_reading(
        db,
        store,
        receipt=receipt,
        decision="withdrawn",
        reviewed_by="private",
        reason="Withdraw synthetic check",
        expected_previous_id=first.id,
    )
    with pytest.raises(ComparisonImportError, match="current checked"):
        r.load_verified_reading_context(db, store, [first.receipt_sha256])
    assert check(db, store, receipt).id == first.id
    assert (
        r.reading_heads(db, [first.receipt_sha256])[first.receipt_sha256]["decision_id"]
        == withdrawn.id
    )
    restored = r.record_reading(
        db,
        store,
        receipt=receipt,
        decision="checked",
        reviewed_by="private",
        reason="Exact listed fields checked again",
        expected_previous_id=withdrawn.id,
    )
    assert restored.id != first.id
    assert (
        r.load_verified_reading_context(db, store, [first.receipt_sha256]).version
        != context.version
    )
    with pytest.raises(ComparisonImportError, match="changed"):
        r.record_reading(
            db,
            store,
            receipt=receipt,
            decision="checked",
            reviewed_by="private",
            reason="Stale fork",
            expected_previous_id=first.id,
        )


@pytest.mark.parametrize("mutation", ["update", "delete", "late_fork"])
def test_database_enforces_immutable_linear_history(db, mutation):
    body, receipt = reading()
    store = retain(db, body)
    first = check(db, store, receipt)
    with pytest.raises(SQLAlchemyError), db.begin_nested():
        if mutation == "update":
            db.execute(
                text(
                    "UPDATE election_source_reading_decision SET reason='changed' WHERE id=:id"
                ),
                {"id": first.id},
            )
        elif mutation == "delete":
            db.execute(
                text("DELETE FROM election_source_reading_decision WHERE id=:id"),
                {"id": first.id},
            )
        else:
            db.add(
                m.ElectionSourceReadingDecision(
                    subject_key=first.subject_key,
                    receipt_sha256=first.receipt_sha256,
                    original_sha256=first.original_sha256,
                    schema_id=first.schema_id,
                    request_key="f" * 64,
                    previous_decision_id=None,
                    decision="checked",
                    receipt=receipt,
                    reviewed_by="private",
                    reason="Fork",
                    reviewed_at=first.reviewed_at,
                )
            )
            db.flush()


def test_source_loss_and_recovery_are_not_cached(db):
    body, receipt = reading()
    store = retain(db, body)
    row = check(db, store, receipt)
    first = r.load_verified_reading_context(db, store, [row.receipt_sha256])
    key = db.get(m.ElectionResultSource, row.original_sha256).object_key
    old = store.objects.pop(key)
    with pytest.raises(ComparisonImportError, match="original"):
        r.load_verified_reading_context(db, store, [row.receipt_sha256])
    store.objects[key] = old
    assert (
        r.load_verified_reading_context(db, store, [row.receipt_sha256]).version
        == first.version
    )
    with pytest.raises(ComparisonImportError):
        r.load_verified_reading_context(db, store, ["a" * 64])


def test_receipt_lookup_batches_more_than_five_hundred_without_silent_drop(db):
    hashes = {f"{number:064x}" for number in range(501)}
    result = r.reading_heads(db, hashes)
    assert set(result) == hashes and all(v is None for v in result.values())
    assert set(r.reading_requirements(db, hashes)) == hashes


@pytest.mark.parametrize("bound", ["raw", "compressed", "closure"])
def test_original_proof_rejects_allocation_bound_before_store_get(
    db, bound, monkeypatch
):
    body, receipt = reading()
    store = retain(db, body)
    original = db.get(m.ElectionResultSource, receipt["original_sha256"])
    if bound == "raw":
        original.byte_size = r.MAX_ORIGINAL_BYTES + 1
    elif bound == "compressed":
        original.compressed_byte_size = r.MAX_ORIGINAL_BYTES * 2 + 1
    else:
        for index in range(5):
            value = f"synthetic dependency{index}".encode()
            h = archive_source(db, store, value)
            db.get(m.ElectionResultSource, h).byte_size = r.MAX_ORIGINAL_BYTES
            receipt["dependencies"].append({"sha256": h, "literal": ""})
    db.flush()
    monkeypatch.setattr(
        store, "get", lambda *a, **kw: pytest.fail("oversized proof fetched bytes")
    )
    with pytest.raises(ComparisonImportError, match="bounded"):
        check(db, store, receipt)


def test_wrong_gzip_bytes_with_matching_compressed_hash_never_approve(db):
    import hashlib

    body, receipt = reading()
    store = retain(db, body)
    original = db.get(m.ElectionResultSource, receipt["original_sha256"])
    value = b"not gzip"
    store.objects[original.object_key] = value
    original.compressed_hash = hashlib.sha256(value).hexdigest()
    original.compressed_byte_size = len(value)
    db.flush()
    with pytest.raises(ComparisonImportError, match="original"):
        check(db, store, receipt)
    assert db.scalar(select(m.ElectionSourceReadingDecision.id)) is None


def test_partial_ordinary_proof_keeps_unrelated_receipt_usable(db, monkeypatch):
    body, first = reading()
    other_body = native_pdf({"name": "Other Synthetic Candidate"})
    _, second = reading(other_body)
    store = retain(db, body)
    archive_source(db, store, other_body)
    one = check(db, store, first)
    two = check(db, store, second)
    problem = db.get(m.ElectionResultSource, one.original_sha256).object_key
    original_get = store.get

    def fail(key, path, **kwargs):
        if key == problem:
            raise FileNotFoundError("one synthetic source lost")
        return original_get(key, path, **kwargs)

    monkeypatch.setattr(store, "get", fail)
    proof = r.load_verified_reading_context(
        db,
        store,
        [one.receipt_sha256, two.receipt_sha256],
        partial=True,
        allowed_source_hashes={one.original_sha256, two.original_sha256},
    )
    assert proof.proof_outcomes == {one.receipt_sha256: False, two.receipt_sha256: True}
    assert proof.receipt(two.receipt_sha256) == second
    with pytest.raises(ComparisonImportError):
        proof.receipt(one.receipt_sha256)
    with pytest.raises(ComparisonImportError):
        r.load_verified_reading_context(
            db, store, [one.receipt_sha256, two.receipt_sha256], lock=True, partial=True
        )
