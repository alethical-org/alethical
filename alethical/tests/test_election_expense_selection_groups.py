"""Checked publisher groups choose one report across physical section accounts."""

from copy import deepcopy
from decimal import Decimal

import pytest
from fastapi import HTTPException

from alethical.api.services import election_expense_analytics as s
from alethical.api.services import election_external_finance_reads as external
from alethical.api.services import election_comparison_export as export
from alethical.api.services import election_analytics as analytics
from alethical.tests.test_election_expense_analytics import held  # noqa: F401


@pytest.fixture
def grouped(held, monkeypatch):  # noqa: F811
    context, races, _, _, _ = held
    candidate = races[0].payload["candidates"][0]
    accounts, reports, payments = [], [], []
    for n, end in enumerate(("2026-03-31", "2026-07-31", "2026-10-31"), 1):
        account = {
            "authority": "mn_local",
            "account_id": f"section:{n}",
            "name": "Filed person",
            "period_start": "2026-01-01",
            "period_end": "2026-12-31",
            "issued_id": False,
            "account_id_kind": "physical_section",
            "source_section": {"source_sha256": str(n) * 64, "page": 1},
        }
        accounts.append(account)
        reports.append(
            {
                "authority": "mn_local",
                "account_id": account["account_id"],
                "report_key": str(n) * 64,
                "source_report_id": None,
                "series_id": f"section:{n}",
                "report_type": "Financial report",
                "period_start": "2026-01-01",
                "period_end": end,
                "effective": True,
                "check_status": "checked",
                "figures": [],
                "sources": [],
                "version_scope": "publisher_inventory_as_of",
                "amendment_status": "offered_inventory_checked",
                "version_as_of": "2026-11-11T20:00:00+00:00",
                "version_sources": [],
                "selection_group_key": "local-selection:" + "a" * 64,
            }
        )
        payments.append(
            {
                "payment_key": str(n + 3) * 64,
                "source_row_id": "1",
                "authority": "mn_local",
                "account_id": account["account_id"],
                "report_key": str(n) * 64,
                "transaction_type": "campaign_expenditure",
                "payee": "Printer",
                "payee_address": None,
                "amount": f"{n}0.00",
                "date": end,
                "purpose": "Printing",
                "currency": "USD",
                "amount_role": "reported_payment",
                "nonadditive": False,
                "memo": {},
                "sources": [],
            }
        )
    bulk = {
        "snapshot_id": context["snapshot_id"],
        "generation_id": "e" * 64,
        "version": "f" * 64,
        "authorities": [{"key": "mn_local", "name": "Local filings"}],
        "coverage": [],
        "candidates": [
            {
                "race_id": races[0].id,
                "candidate_id": candidate["candidate_id"],
                "accounts": accounts,
                "reports": reports,
                "own_payments": payments,
                "account_gaps": [],
                "coverage": {"status": "checked"},
            }
        ],
    }
    monkeypatch.setattr(
        s,
        "_source_states",
        lambda db, docs, hashes, *, store=None: dict.fromkeys(hashes, True),
    )

    def read(value=bulk, keys=(), **filters):
        return s._join_external(
            None,
            s._assemble(*held, **filters),
            deepcopy(value),
            races,
            report_keys=list(keys),
            excluded_payee_ids=[],
            _csv=True,
        )

    return bulk, read


def test_checked_listing_chooses_latest_once_without_changing_source_accounts(grouped):
    _, read = grouped
    result = read()
    assert [r["report_key"] for r in result["authority_reports"]] == ["3" * 64]
    assert result["authority_reports"][0]["account_id"] == "section:3"
    assert len(result["authority_reports"][0]["claims"]) == 1
    assert result["authority_summary"][0]["baseline"] == "30.00"
    options = [
        r
        for a in result["report_options"]
        for r in a["reports"]
        if r.get("authority") == "mn_local"
    ]
    assert len(options) == 3
    assert [r["report_key"] for r in options if r["selected"]] == ["3" * 64]
    assert {r["account_id"] for r in options} == {"section:1", "section:2", "section:3"}
    csv_reports = [
        r
        for r in s._external_csv_rows(result)
        if r["Row type"] == "External account report"
    ]
    assert len(csv_reports) == 1
    assert csv_reports[0]["Internal account key"] == "section:3"
    assert csv_reports[0]["Account"] is None


def test_explicit_old_report_replaces_group_default_and_two_are_refused(grouped):
    _, read = grouped
    result = read(keys=["1" * 64])
    assert [r["report_key"] for r in result["authority_reports"]] == ["1" * 64]
    assert result["authority_summary"][0]["baseline"] == "10.00"
    with pytest.raises(HTTPException) as failure:
        read(keys=["1" * 64, "2" * 64])
    assert failure.value.status_code == 422


def test_equal_latest_periods_hold_whole_group_until_explicit_choice(grouped):
    bulk, read = grouped
    bulk["candidates"][0]["reports"][1]["period_end"] = "2026-10-31"
    result = read()
    assert result["authority_reports"] == []
    assert any(
        g["state"] == "ambiguous_latest_report"
        for c in result["candidates"]
        for g in c["gaps"]
    )
    assert len(read(keys=["2" * 64])["authority_reports"]) == 1


def test_distinct_publisher_groups_are_not_merged_by_person_name(grouped):
    bulk, read = grouped
    bulk["candidates"][0]["reports"][0]["selection_group_key"] = (
        "local-selection:" + "b" * 64
    )
    result = read()
    assert {r["report_key"] for r in result["authority_reports"]} == {
        "1" * 64,
        "3" * 64,
    }
    assert sum(Decimal(r["baseline"]) for r in result["authority_summary"]) == Decimal(
        "40.00"
    )


def test_unchecked_version_never_projects_selection_group():
    report = {
        "report_key": "a",
        "version_binding": {},
        "effective": None,
        "version_scope": "exact_document",
        "amendment_status": "not_established",
    }
    facts = {
        "effective": True,
        "version_scope": "publisher_inventory_as_of",
        "amendment_status": "offered_inventory_checked",
        "version_as_of": "2026-11-11",
        "version_sources": [],
        "selection_group_key": "local-selection:" + "a" * 64,
    }
    cache = {
        ("local_inventory_versions", "g"): {"a": {"state": "checked", "facts": facts}}
    }
    assert (
        external._report_version(report, {"id": "g"}, cache)["selection_group_key"]
        == facts["selection_group_key"]
    )
    cache[("local_inventory_versions", "g")]["a"]["state"] = "withdrawn"
    actual = external._report_version(report, {"id": "g"}, cache)
    assert "selection_group_key" not in actual
    assert actual["effective"] is None


def test_comparison_default_uses_whole_group_for_each_physical_account(grouped):
    bulk, _ = grouped
    reports = bulk["candidates"][0]["reports"]
    for account in ("section:1", "section:2", "section:3"):
        assert (
            export._latest_external(reports, account=("mn_local", account)) == "3" * 64
        )
    reports[1]["period_end"] = reports[2]["period_end"]
    assert export._latest_external(reports, account=("mn_local", "section:1")) is None


def test_overlapping_grouped_events_stay_nonadditive_with_raw_funder_ids(grouped, held):  # noqa: F811
    bulk, _ = grouped
    bulk["sources"] = []
    candidate = bulk["candidates"][0]
    candidate["payments"] = [
        payment
        | {
            "direction": "independent_for",
            "source_report_id": None,
            "effective": True,
            "period_start": report["period_start"],
            "period_end": report["period_end"],
        }
        for payment, report in zip(
            candidate["own_payments"], candidate["reports"], strict=True
        )
    ]
    events, _ = analytics._external_events(bulk, held[1])
    assert len(events) == 3
    assert not any(e["sum_eligible"] for e in events)
    assert len({e["funder_id"] for e in events}) == 3
    assert {e["source_account_id"] for e in events} == {
        "section:1",
        "section:2",
        "section:3",
    }
    candidate["reports"][0]["selection_group_key"] = "local-selection:" + "b" * 64
    events, _ = analytics._external_events(bulk, held[1])
    assert [e["report_key"] for e in events if e["sum_eligible"]] == ["1" * 64]


@pytest.mark.parametrize("visible_section", [1, 3])
@pytest.mark.parametrize(
    "filters",
    [
        {"party": "R"},
        {"candidate_query": "Example"},
        {"candidate_id": "one", "race_id": "race"},
    ],
)
def test_display_scope_keeps_group_choice_and_full_party_evidence(
    grouped, visible_section, filters
):
    bulk, read = grouped
    original = bulk["candidates"][0]
    visible, other = deepcopy(original), deepcopy(original)
    other["candidate_id"] = "two"
    for field in ("accounts", "reports", "own_payments"):
        visible[field] = [
            v
            for v in original[field]
            if v["account_id"] == f"section:{visible_section}"
        ]
        other[field] = [
            v
            for v in original[field]
            if v["account_id"] != f"section:{visible_section}"
        ]
    bulk["candidates"] = [visible, other]
    full = read()
    assert [r["report_key"] for r in full["authority_reports"]] == ["3" * 64]
    assert (
        full["authority_reports"][0]["party_classification_state"]
        == "mixed_ballot_parties"
    )
    filtered = read(**filters)
    if visible_section == 3:
        assert [r["report_key"] for r in filtered["authority_reports"]] == ["3" * 64]
        report = filtered["authority_reports"][0]
        assert report["party_classification_state"] == "mixed_ballot_parties"
        assert report["party_group"] == "unknown"
        assert {c["candidate_id"] for c in report["claims"]} == {"one", "two"}
        assert {c["candidate_id"] for c in report["display_claims"]} == {"one"}
        assert filtered["authority_summary"][0]["baseline"] == "30.00"
    else:
        # The checked group does not itself establish an account-candidate link.
        assert filtered["authority_reports"] == []
        assert filtered["authority_summary"] == []
        assert any(
            g["state"] == "selected_report_not_associated"
            and g["report_key"] == "3" * 64
            for c in filtered["candidates"]
            for g in c["gaps"]
        )
        old = read(keys=["1" * 64], **filters)
        assert old["authority_summary"][0]["baseline"] == "10.00"
        with pytest.raises(HTTPException):
            read(keys=["3" * 64], **filters)
