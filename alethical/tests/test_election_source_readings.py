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


@pytest.mark.parametrize("literal", ["X", "x", "✓", "✔", "☒", "●", "/", "■"])
def test_exact_checked_mark_literals_preserve_source_representation(literal):
    # The filled radio dot and diagonal selected-box stroke occur in retained
    # Minnesota forms. This accepts their representation, never their review.
    field = r.field_proposal(
        "cover.selection",
        page=1,
        bounds=[10, 10, 20, 20],
        label="Selected box",
        literal=literal,
        value_type="mark",
    )
    assert field["literal"] == literal
    assert field["state"] == "value"
    assert field["normalized"] == "marked"
    assert "decision" not in field and "candidate_name" not in field


@pytest.mark.parametrize(
    "literal", ["○", "◯", "☐", "□", "yes", "1", "0", 0, "·", ".", "● ", "/ ", ""]
)
def test_mark_normalization_refuses_unmarked_or_inferred_values(literal):
    with pytest.raises(ComparisonImportError, match="explicitly checked source mark"):
        r.normalize_field(literal, "mark", "value")


@pytest.mark.parametrize("literal", ["X", "x", "✓", "✔", "☒", "●", "/", "■"])
@pytest.mark.parametrize(
    "state", ["blank", "ambiguous", "unreadable", "not_checked", "redacted"]
)
def test_uncertain_mark_state_never_normalizes_to_marked(literal, state):
    assert r.normalize_field(literal, "mark", state) is None


@pytest.mark.parametrize(
    ("literal", "expected"),
    [
        ("03-10-2026", "2026-03-10"),
        ("6-3-26", "2026-06-03"),
        ("6-16-26", "2026-06-16"),
        ("7-7-26", "2026-07-07"),
        ("2-29-24", "2024-02-29"),
        ("03-10-26", "2026-03-10"),
        ("11-16-2025", "2025-11-16"),
        ("03-09-2026", "2026-03-09"),
        ("2-29-2024", "2024-02-29"),
        ("03/10/2026", "2026-03-10"),
        ("3/10/26", "2026-03-10"),
        ("2026-03-10", "2026-03-10"),
    ],
)
def test_checked_us_dates_preserve_literal_and_exact_calendar_value(literal, expected):
    field = r.field_proposal(
        "cover.period_start",
        page=1,
        bounds=[10, 10, 20, 20],
        label="From",
        literal=literal,
        value_type="date",
    )
    assert field["literal"] == literal
    assert field["normalized"] == expected
    assert "decision" not in field


@pytest.mark.parametrize(
    "literal",
    [
        "02-29-2026",
        "13-01-2026",
        "03-32-2026",
        "00-10-2026",
        "02-29-26",
        "6-32-26",
        "6-3-6",
        "6-3-026",
        "6/3-26",
        "6-3/26",
        "6-3",
        "03/10-2026",
        "03-10/2026",
        "03-10-2026 ",
        "around 03-10-2026",
    ],
)
def test_checked_us_date_refuses_invalid_or_unsupported_representation(literal):
    with pytest.raises(ComparisonImportError):
        r.normalize_field(literal, "date", "value")


@pytest.mark.parametrize(
    "state", ["blank", "ambiguous", "unreadable", "not_checked", "redacted"]
)
def test_uncertain_us_date_never_becomes_a_calendar_value(state):
    assert r.normalize_field("03-10-2026", "date", state) is None


@pytest.mark.parametrize(
    ("literal", "expected"),
    [
        ("6.19.26", "2026-06-19"),
        ("6.20.26", "2026-06-20"),
        ("06.20.2026", "2026-06-20"),
        ("2.29.24", "2024-02-29"),
        ("02022026", "2026-02-02"),
        ("03032026", "2026-03-03"),
        ("03042026", "2026-03-04"),
        ("02292024", "2024-02-29"),
        ("12312025", "2025-12-31"),
    ],
)
def test_checked_dotted_and_compact_us_date_preserves_literal(literal, expected):
    field = r.field_proposal(
        "expense.p1.r1.date",
        page=1,
        bounds=[10, 10, 20, 20],
        label="Date",
        literal=literal,
        value_type="date",
        record_type="expense",
        row=1,
    )
    assert field["literal"] == literal
    assert field["normalized"] == expected
    assert "decision" not in field


@pytest.mark.parametrize(
    "literal",
    [
        "2.29.26",
        "6.31.26",
        "13.1.26",
        "0.1.26",
        "6.20",
        "6.20.6",
        "6.20.026",
        "6.20/26",
        "6/20.26",
        "6.20-26",
        "6.20.26 ",
        "02292026",
        "02312026",
        "13012026",
        "00012026",
        "06002026",
        "0603206",
        "060326",
        "060320266",
        "20260304",
        "０３０４２０２６",
        "03042026\n",
        "around 03042026",
    ],
)
def test_checked_dotted_and_compact_date_refuses_invalid_literal(literal):
    with pytest.raises(ComparisonImportError):
        r.normalize_field(literal, "date", "value")


@pytest.mark.parametrize("literal", ["6.20.26", "03042026"])
@pytest.mark.parametrize(
    "state", ["blank", "ambiguous", "unreadable", "not_checked", "redacted"]
)
def test_uncertain_dotted_and_compact_date_stays_unknown(literal, state):
    assert r.normalize_field(literal, "date", state) is None


@pytest.mark.parametrize(
    ("literal", "expected"),
    [
        ("Dec 31, 25", "2025-12-31"),
        ("MAR 31, 26", "2026-03-31"),
        ("Jan 1, 25", "2025-01-01"),
        ("February 29, 2024", "2024-02-29"),
        ("apr 30 26", "2026-04-30"),
        ("May 1,2026", "2026-05-01"),
        ("June 30, 2026", "2026-06-30"),
        ("JUL 31, 26", "2026-07-31"),
        ("August 31, 2026", "2026-08-31"),
        ("Sep 30, 26", "2026-09-30"),
        ("October 31, 2026", "2026-10-31"),
        ("November 3, 2026", "2026-11-03"),
        ("Feb 29, 00", "2000-02-29"),
    ],
)
def test_checked_named_month_date_preserves_source_literal(literal, expected):
    field = r.field_proposal(
        "cover.period_start",
        page=1,
        bounds=[10, 10, 20, 20],
        label="From",
        literal=literal,
        value_type="date",
    )
    assert field["literal"] == literal
    assert field["normalized"] == expected


@pytest.mark.parametrize(
    "literal",
    [
        "Feb 29, 26",
        "February 29, 1900",
        "Feb 29, 2100",
        "Apr 31, 2026",
        "Jan 0, 26",
        "January 32, 26",
        "Jan 1",
        "Jan 1, 6",
        "Jan 1, 026",
        "Jan 1, 20266",
        "Janu 1, 26",
        "Septober 1, 26",
        "Jan 1st, 26",
        "1 Jan 26",
        "around Jan 1, 26",
        "Jan 1, 26 to Mar 31, 26",
        "Jan 1, 26\n",
        "Jan\t1, 26",
        "Jan\u00a01, 26",
        "Jan １, 26",
        "Jan 1, ２６",
    ],
)
def test_checked_named_month_date_rejects_incomplete_or_invalid_date(literal):
    with pytest.raises(ComparisonImportError):
        r.normalize_field(literal, "date", "value")


@pytest.mark.parametrize(
    "state", ["blank", "ambiguous", "unreadable", "not_checked", "redacted"]
)
def test_uncertain_named_month_date_stays_unknown(state):
    assert r.normalize_field("Dec 31, 25", "date", state) is None


@pytest.mark.parametrize(
    "literal, expected",
    [
        ("1190⁰⁰", "1190.00"),
        ("$1,007.⁵⁰", "1007.50"),
        ("1190.⁰⁰", "1190.00"),
        ("$1,007⁵⁰", "1007.50"),
    ],
)
def test_checked_money_raised_cents(literal, expected):
    assert r.normalize_field(literal, "money", "value") == expected
    assert r.normalize_field(literal, "text", "value") == literal


@pytest.mark.parametrize(
    "literal",
    [
        "-",
        "Ø",
        ".-",
        "790.-",
        "1⁰",
        "1⁰⁰⁰",
        "1⁰0",
        "1..⁰⁰",
        "1,00⁵⁰",
        "790. -",
        "790.--",
        "790.−",
        "-1⁰⁰",
        "$-1⁰⁰",
    ],
)
def test_checked_money_rejects_incomplete_raised_cents_and_dashes(literal):
    with pytest.raises(ComparisonImportError):
        r.normalize_field(literal, "money", "value")


@pytest.mark.parametrize("literal", ["790.-", "1190⁰⁰", "$1,007.⁵⁰"])
@pytest.mark.parametrize(
    "state", ["ambiguous", "blank", "unreadable", "redacted", "not_checked"]
)
def test_raised_money_never_promotes_uncertain_source(literal, state):
    assert r.normalize_field(literal, "money", state) is None
