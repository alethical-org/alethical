"""Race exports preserve own-account detail without inventing targeted support."""

from copy import deepcopy

import pytest
from fastapi import HTTPException

from alethical.api.services import election_comparison_export as export


def test_selected_own_payment_with_no_target_is_exported():
    payment = {
        "payment_key": "payment-1",
        "report_key": "report-1",
        "amount": "12.34",
        "direction": "unknown",
        "effective": None,
        "version_scope": "exact_document",
        "amendment_status": "not_established",
    }
    rows = export._external_payments(
        [{"candidate_id": "owner", "payments": [], "own_payments": [payment]}],
        {"report-1"},
    )
    assert "payment-1" in rows
    row = rows["payment-1"]
    assert row["payment"]["amount"] == "12.34"
    assert row["payment"]["direction"] == "unknown"
    assert row["own_candidates"] == {"owner"}
    assert row["target_candidates"] == set()


@pytest.mark.parametrize(
    ("version", "selected", "included"),
    [
        ({"effective": True}, {"report-1"}, True),
        ({"effective": True}, set(), False),
        ({"effective": False}, {"report-1"}, False),
        ({"effective": None}, {"report-1"}, False),
        (
            {
                "effective": None,
                "version_scope": "exact_document",
                "amendment_status": "not_established",
            },
            set(),
            False,
        ),
    ],
)
def test_own_details_respect_report_selection_and_version(version, selected, included):
    rows = export._external_payments(
        [
            {
                "candidate_id": "owner",
                "own_payments": [
                    {"payment_key": "one", "report_key": "report-1", **version}
                ],
            }
        ],
        selected,
    )
    assert bool(rows) is included


def test_one_payment_keeps_distinct_owners_and_targets_and_does_not_mutate():
    own = {
        "payment_key": "one",
        "report_key": "report-1",
        "amount": "0.00",
        "direction": "independent_against",
        "effective": True,
        "sources": [{"source_sha256": "a" * 64}],
    }
    target = own | {"target_source_candidate_id": "source-target"}
    entries = [
        {"candidate_id": "owner", "own_payments": [own]},
        {"candidate_id": "other-owner", "own_payments": [own]},
        {"candidate_id": "target", "payments": [target]},
        {"candidate_id": "target", "payments": [target]},
    ]
    before = deepcopy(entries)
    rows = export._external_payments(entries, {"report-1"})
    assert len(rows) == 1
    assert rows["one"]["own_candidates"] == {"owner", "other-owner"}
    assert rows["one"]["target_candidates"] == {"target"}
    assert rows["one"]["payment"]["amount"] == "0.00"
    assert rows["one"]["payment"]["direction"] == "independent_against"
    assert rows["one"]["payment"]["sources"] == own["sources"]
    assert entries == before


@pytest.mark.parametrize("field", ["amount", "report_key", "sources", "direction"])
def test_conflicting_own_and_targeted_payment_refuses(field):
    own = {
        "payment_key": "one",
        "report_key": "report-1",
        "amount": "12.34",
        "effective": True,
        "sources": [],
        "direction": "unknown",
    }
    target = own | {field: "conflict", "target_source_candidate_id": "source-target"}
    with pytest.raises(HTTPException) as error:
        export._external_payments(
            [
                {"candidate_id": "owner", "own_payments": [own]},
                {"candidate_id": "target", "payments": [target]},
            ],
            {"report-1"},
        )
    assert error.value.status_code == 409


def test_target_conflict_is_not_hidden_when_target_field_is_normalized():
    payment = {
        "payment_key": "one",
        "report_key": "report-1",
        "effective": True,
        "target_source_candidate_id": "source-1",
    }
    with pytest.raises(HTTPException) as error:
        export._external_payments(
            [
                {"candidate_id": "one", "payments": [payment]},
                {
                    "candidate_id": "two",
                    "payments": [payment | {"target_source_candidate_id": "source-2"}],
                },
            ],
            set(),
        )
    assert error.value.status_code == 409


def test_targeted_current_payment_keeps_existing_unselected_behavior():
    rows = export._external_payments(
        [
            {
                "candidate_id": "target",
                "payments": [{"payment_key": "one", "effective": True}],
            }
        ],
        set(),
    )
    assert rows["one"]["target_candidates"] == {"target"}
    assert rows["one"]["own_candidates"] == set()
