"""A PDF bundle needs independent, nonoverlapping checked report sections."""

# ruff: noqa: F811
from copy import deepcopy

import pytest

from alethical.pipeline import election_source_readings as r
from alethical.pipeline.election_comparison import ComparisonImportError, digest
from alethical.tests.test_election_source_readings import db, reading, retain, check  # noqa: F401

SCHEMA = "mn-local-source-reading:v2"


def section(*, lower=False):
    body, receipt = reading()
    if lower:
        for field in receipt["fields"]:
            field["bounds"][1] += 400
            field["bounds"][3] += 400
    bounds = [0, 400, 612, 792] if lower else [0, 0, 612, 390]
    receipt.update(
        schema=SCHEMA,
        reading_scope={
            "cover": {"page": 1, "bounds": bounds},
            "regions": [{"page": 1, "bounds": bounds, "role": "cover"}],
        },
    )
    return body, receipt


def test_legacy_identity_is_unchanged_and_siblings_have_distinct_subjects():
    _, legacy = reading()
    assert r.subject_key(legacy) == digest([r.SCHEMA, legacy["original_sha256"]])
    _, first = section()
    _, second = section(lower=True)
    assert r.validate_receipt(first) == first
    assert r.subject_key(first) != r.subject_key(second)
    changed = deepcopy(first)
    changed["reading_scope"]["regions"][0]["bounds"] = [0, 0, 612, 395]
    assert r.subject_key(changed) == r.subject_key(first)
    assert r.receipt_digest(changed) != r.receipt_digest(first)


@pytest.mark.parametrize(
    "change",
    [
        "neighbor_field",
        "missing_region",
        "overlap",
        "outside",
        "cover_role",
        "bank_role",
        "cover_outside",
        "extra",
        "bad_schema",
    ],
)
def test_section_shape_cannot_borrow_fields_or_invent_scope(change):
    _, receipt = section()
    scope = receipt["reading_scope"]
    if change == "neighbor_field":
        receipt["fields"][0]["bounds"] = [258, 447, 305, 464]
    elif change == "missing_region":
        scope["regions"] = []
    elif change == "overlap":
        scope["regions"].append(deepcopy(scope["regions"][0]))
    elif change == "outside":
        scope["regions"][0]["bounds"][2] = 700
    elif change == "cover_role":
        scope["regions"][0]["role"] = "continuation"
    elif change == "bank_role":
        scope["regions"][0]["role"] = "bank_attachment"
    elif change == "cover_outside":
        scope["cover"]["bounds"] = [0, 400, 612, 700]
    elif change == "extra":
        scope["account_approved"] = True
    else:
        receipt["schema"] = "mn-local-source-reading:v3"
    with pytest.raises(ComparisonImportError):
        r.validate_receipt(receipt)


def test_sibling_check_withdrawal_and_recovery_are_independent(db):
    body, first = section()
    _, second = section(lower=True)
    store = retain(db, body)
    a = check(db, store, first)
    b = check(db, store, second)
    assert a.schema_id == b.schema_id == SCHEMA
    both = r.load_verified_reading_context(
        db, store, [a.receipt_sha256, b.receipt_sha256]
    )
    r.record_reading(
        db,
        store,
        receipt=first,
        decision="withdrawn",
        reviewed_by="private",
        reason="Withdraw one synthetic section",
        expected_previous_id=a.id,
    )
    partial = r.load_verified_reading_context(
        db, store, [a.receipt_sha256, b.receipt_sha256], partial=True
    )
    assert partial.proof_outcomes == {a.receipt_sha256: False, b.receipt_sha256: True}
    assert partial.version != both.version
    assert partial.receipt(b.receipt_sha256) == second
    assert check(db, store, first).id == a.id
    with pytest.raises(ComparisonImportError, match="current checked"):
        r.load_verified_reading_context(db, store, [a.receipt_sha256])


def test_moved_anchor_cannot_create_overlapping_approval(db):
    body, first = section()
    store = retain(db, body)
    check(db, store, first)
    moved = deepcopy(first)
    moved["reading_scope"]["cover"]["bounds"] = [1, 1, 611, 389]
    assert r.subject_key(moved) != r.subject_key(first)
    with pytest.raises(ComparisonImportError, match="overlap"):
        check(db, store, moved)


@pytest.mark.parametrize("legacy_first", [True, False])
def test_whole_original_and_section_approvals_cannot_overlap(db, legacy_first):
    body, legacy = reading()
    _, scoped = section()
    store = retain(db, body)
    first, second = (legacy, scoped) if legacy_first else (scoped, legacy)
    accepted = check(db, store, first)
    with pytest.raises(ComparisonImportError, match="overlap"):
        check(db, store, second)
    r.record_reading(
        db,
        store,
        receipt=first,
        decision="withdrawn",
        reviewed_by="private",
        reason="Replace whole-original scope explicitly",
        expected_previous_id=accepted.id,
    )
    assert check(db, store, second).schema_id == second["schema"]


def test_prepare_section_keeps_v2_scope_and_nonfinancial_fields_separate():
    body, original = section()
    prepared = r.prepare_receipt(
        body,
        fields=original["fields"],
        document_kind="financial_report",
        reading_scope=original["reading_scope"],
    )
    assert prepared == original
    fields = deepcopy(original["fields"])
    for field in fields:
        field["record_type"] = "bank_transaction"
    bank = r.prepare_receipt(
        body,
        fields=fields,
        document_kind="bank_attachment",
        reading_scope=original["reading_scope"],
    )
    assert bank["document_kind"] == "bank_attachment"
    with pytest.raises(ComparisonImportError, match="region role"):
        r.validate_receipt(bank | {"document_kind": "financial_report"})
