"""Exact source election context, separate from report dates and query cycle.

Synthetic source bytes exercise the retained FEC column layout. The P2024 and
S2025 cases reproduce the literal election/target fields independently observed
in official files1923989 row325 and1944383 row5; no full real filing is embedded.
"""

from copy import deepcopy
from dataclasses import replace
from typing import Any

import pytest

from alethical.pipeline.election_fec_sources import FecSourceError, extract_fec_source
from alethical.tests.test_election_fec_sources import (
    f5_report,
    f57_payment,
    filing,
    report,
    source,
    spending,
)


def extracts(code="G2026", **fields):
    body = filing(report("F3X"), [spending("SE", **{"18": code, **fields})])
    metadata = source(body)
    payment = extract_fec_source(body, metadata, {"kind": "payment", "row": 3})
    context = extract_fec_source(
        body, metadata, {"kind": "payment_election_context", "row": 3}
    )
    return payment.facts, context.facts


def scope(**overrides: Any):
    from alethical.pipeline.election_payment_scope import FecPaymentScope

    base = FecPaymentScope(
        kind="election",
        year=2026,
        candidate_id="H6MN01111",
        office="H",
        state="MN",
        district="01",
        election_type="general",
    )
    return replace(base, **overrides)


def assess(payment, context, **overrides):
    from alethical.pipeline.election_payment_scope import assess_fec_payment_scope

    return assess_fec_payment_scope(payment, context, scope(**overrides))


def test_checked_context_preserves_exact_source_fields_without_changing_legacy():
    payment, context = extracts("P2024", **{"28": "H8MN05239", "35": "05"})
    assert "election_code" not in payment
    assert context == {
        "authority": "fec",
        "account_id": "C00123456",
        "source_report_id": "1234567",
        "source_row_id": "3",
        "target_source_candidate_id": "H8MN05239",
        "election_code": "P2024",
        "target_office": {"office": "H", "state": "MN", "district": "05"},
    }
    result = assess(payment, context, candidate_id="H8MN05239", district="05")
    assert not result.admitted
    assert result.reason == "election_year_mismatch"


def test_special_other_year_and_missing_candidate_do_not_become_general_race():
    payment, context = extracts("S2025", **{"28": "", "34": "S", "35": "47"})
    assert context["target_source_candidate_id"] is None
    assert context["target_office"]["district"] == "47"
    assert not assess(payment, context).admitted


@pytest.mark.parametrize("code", ["G2026", "P2026"])
def test_exact_general_or_primary_is_admitted_only_to_matching_election(code):
    payment, context = extracts(code)
    kind = "general" if code.startswith("G") else "primary"
    assert assess(payment, context, election_type=kind).admitted
    assert not assess(
        payment, context, election_type="primary" if kind == "general" else "general"
    ).admitted


def test_report_or_payment_year_does_not_override_explicit_election_year():
    payment, context = extracts("P2026", **{"20": "20250802", "22": "20250802"})
    assert payment["date"] == "2025-08-02"
    assert assess(payment, context, election_type="primary").admitted
    assert not assess(payment, context).admitted
    assert assess(payment, context, kind="cycle", election_type=None).admitted
    assert not assess(
        payment, context, kind="cycle", election_type=None, year=2024
    ).admitted


@pytest.mark.parametrize("code", ["S2026", "R2026", "C2026", "E2026", "O2026"])
def test_other_stages_are_not_general_and_cycle_is_explicit(code):
    payment, context = extracts(code)
    assert not assess(payment, context).admitted
    assert assess(payment, context, kind="cycle", election_type=None).admitted


@pytest.mark.parametrize(
    ("field", "bad"),
    [
        ("authority", "mn_cfb"),
        ("account_id", "C00999999"),
        ("source_report_id", "7654321"),
        ("source_row_id", "4"),
        ("target_source_candidate_id", "H6MN02222"),
    ],
)
def test_context_cannot_be_borrowed_from_another_payment(field, bad):
    payment, context = extracts()
    context[field] = bad
    assert assess(payment, context).reason == "payment_context_identity_mismatch"


@pytest.mark.parametrize("context", [None, {}, {"election_code": "G2026"}])
def test_missing_checked_context_never_falls_back_to_raw_metadata(context):
    payment, real_context = extracts()
    payment["raw_metadata"] = real_context
    assert not assess(payment, context).admitted


@pytest.mark.parametrize(
    "office",
    [
        {"office": "H", "state": "WI", "district": "01"},
        {"office": "H", "state": "MN", "district": "02"},
        {"office": "H", "state": "MN", "district": None},
        {"office": None, "state": "MN", "district": "01"},
        "H",
        None,
    ],
)
def test_missing_or_conflicting_geography_stays_held(office):
    payment, context = extracts()
    context["target_office"] = office
    assert not assess(payment, context).admitted


@pytest.mark.parametrize("district", [None, "00"])
def test_senate_nondistrict_forms_are_equivalent_without_losing_literal(district):
    payment, context = extracts(
        "G2026", **{"28": "S6MN00572", "34": "S", "35": district or ""}
    )
    original = deepcopy(context)
    assert assess(
        payment, context, candidate_id="S6MN00572", office="S", district="00"
    ).admitted
    assert context == original
    context["target_office"]["district"] = "47"
    assert not assess(
        payment, context, candidate_id="S6MN00572", office="S", district="00"
    ).admitted


@pytest.mark.parametrize("code", [None, "", "G2025", "G2026 ", "garbage", 2026])
def test_missing_malformed_or_different_year_context_stays_held(code):
    payment, context = extracts()
    context["election_code"] = code
    assert not assess(payment, context).admitted


def test_f5_context_uses_its_own_columns_and_selected_cell_quote():
    body = filing(f5_report(), [f57_payment(**{"16": "P2026"})])
    result = extract_fec_source(
        body, source(body), {"kind": "payment_election_context", "row": 3}
    )
    assert result.facts["election_code"] == "P2026"
    assert result.facts["target_office"] == {
        "office": "H",
        "state": "MN",
        "district": "01",
    }
    assert '"column":16,"raw":"P2026"' in result.quote


@pytest.mark.parametrize(
    "locator",
    [
        {"kind": "payment_election_context", "row": True},
        {"kind": "payment_election_context", "row": 2},
        {"kind": "payment_election_context", "row": 3, "election_code": "G2026"},
    ],
)
def test_selector_needs_exact_payment_row(locator):
    body = filing(report("F3X"), [spending("SE")])
    with pytest.raises(FecSourceError):
        extract_fec_source(body, source(body), locator)


def test_selector_rejects_changed_bytes_and_non_independent_schedule():
    body = filing(report("F3X"), [spending("SE")])
    with pytest.raises(FecSourceError):
        extract_fec_source(
            body + b"changed",
            source(body),
            {"kind": "payment_election_context", "row": 3},
        )
    body = filing(report(), [spending("SB17")])
    with pytest.raises(FecSourceError):
        extract_fec_source(
            body, source(body), {"kind": "payment_election_context", "row": 3}
        )


@pytest.mark.parametrize(
    "overrides",
    [
        {"kind": "all"},
        {"year": True},
        {"year": 0},
        {"candidate_id": ""},
        {"candidate_id": "S6MN01111"},
        {"candidate_id": "H6WI01111"},
        {"office": "P"},
        {"state": ""},
        {"district": None},
        {"kind": "cycle"},
        {"election_type": None},
        {"election_type": "special"},
    ],
)
def test_unsettled_target_scope_cannot_broaden_matching(overrides):
    payment, context = extracts()
    assert not assess(payment, context, **overrides).admitted


def test_target_candidate_must_match_the_approved_scope():
    payment, context = extracts()
    assert (
        assess(payment, context, candidate_id="H6MN02222").reason
        == "target_candidate_mismatch"
    )


@pytest.mark.parametrize("candidate_id", ["S6MN01111", "H6WI01111"])
def test_scope_candidate_identity_must_agree_with_its_own_office_and_state(
    candidate_id,
):
    payment, context = extracts(**{"28": candidate_id})
    assert (
        assess(payment, context, candidate_id=candidate_id).reason
        == "invalid_target_scope"
    )
