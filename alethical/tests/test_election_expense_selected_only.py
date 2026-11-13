"""An explicit global period never adds another account's latest report."""

# ruff: noqa: F811

from copy import deepcopy
from datetime import UTC, date, datetime
from types import SimpleNamespace
from typing import Any
import csv
import io

import pytest
from fastapi import HTTPException

from alethical.api.services import election_expense_analytics as s
from alethical.tests.finance_fixtures import finance_api, finance_db  # noqa: F401
from alethical.tests.test_election_expense_analytics import held  # noqa: F401
from alethical.tests.test_election_finance_reads import comparison  # noqa: F401
from alethical.tests.test_election_outside_spending import spending  # noqa: F401
from alethical.tests.test_election_expense_selection_groups import grouped  # noqa: F401

KEY = "mn-2026-11-03-general"
BASE = f"/api/v1/finance/elections/{KEY}/analytics/expenses"


@pytest.fixture
def two_accounts(held, monkeypatch):  # noqa: F811
    context, races, accounts, selected, available = deepcopy(held)
    current = selected["19399"][0]
    current.report_key = "a" * 64
    old = deepcopy(current)
    old.report_key = "b" * 64
    old.payload["filing"].update(report_type="C", cut_off_date="2026-07-20")
    old.payload["period_end"] = "2026-07-20"
    other = deepcopy(current)
    other.registration_number = "19400"
    other.report_key = "e" * 64
    other.payload["filing"]["registration_number"] = "19400"
    account = deepcopy(accounts[("race", "one")]["accounts"][0])
    account["registration_number"] = "19400"
    account["decision_id"] = 46
    accounts[("race", "two")] = {"accounts": [account], "gaps": []}
    collection = SimpleNamespace(
        id=context["collection_id"],
        copied_at=datetime(2026, 11, 12, tzinfo=UTC),
        sealed_at=None,
        coverage={},
    )
    election = SimpleNamespace(
        id=context["snapshot_id"],
        stage="general",
        election_date=date(2026, 11, 3),
    )

    decisions = [
        SimpleNamespace(
            id=a["decision_id"],
            race_id=key[0],
            candidate_id=key[1],
            registration_number=a["registration_number"],
            evidence=a["evidence"],
        )
        for key, links in accounts.items()
        for a in links["accounts"]
    ]

    class DB:
        def get(self, *args, **kwargs):
            return SimpleNamespace(collection_id=collection.id)

        def scalars(self, statement):
            return races if "election_comparison_race" in str(statement) else decisions

    monkeypatch.setattr(s.results, "snapshot", lambda *a, **kw: election)
    monkeypatch.setattr(s.finance, "_collection", lambda *a, **kw: collection)
    monkeypatch.setattr(s.finance, "expense_report_index", lambda *a: load.reports)
    monkeypatch.setattr(s, "_bulk_accounts", lambda *a, **kw: (deepcopy(accounts), []))
    monkeypatch.setattr(
        s,
        "_source_states",
        lambda db, docs, hashes, **kw: dict.fromkeys(docs | hashes, True),
    )

    class Loader:
        def __init__(self):
            self.reports = [current, old, other]

        def __call__(self, **kwargs):
            return s._load(DB(), KEY, **kwargs)

    load = Loader()
    return load


def test_global_older_period_does_not_fill_other_account_with_latest(
    finance_api, two_accounts, monkeypatch
):
    def read(db, **kwargs):
        args = {"report_keys": kwargs["report_keys"]}
        # Exercise the live router boundary: before the fix it discards this
        # query field, so the unchanged reader mixes July with October.
        if kwargs.get("selected_only"):
            args["selected_only"] = True
        return s._assemble(*two_accounts(**args), **args)

    monkeypatch.setattr(s, "report", read)
    response = finance_api.get(
        BASE, params={"selected_only": "true", "report_keys": "b" * 64}
    )
    assert response.status_code == 200, response.text
    data = response.json()["data"]
    assert [r["report_key"] for r in data["account_reports"]] == ["b" * 64]
    missing = next(c for c in data["candidates"] if c["candidate_id"] == "two")
    assert missing["confirmed_account_count"] == 1
    assert {g["state"] for g in missing["gaps"]} == {"report_figures_not_held"}


def test_default_preserves_latest_for_unspecified_account(two_accounts):
    data = s._assemble(*two_accounts(report_keys=["b" * 64]))
    assert {r["report_key"] for r in data["account_reports"]} == {"b" * 64, "e" * 64}


def test_selected_empty_keeps_candidates_but_no_financial_rows(two_accounts):
    data = s._assemble(*two_accounts(selected_only=True), selected_only=True)
    assert data["account_reports"] == [] and data["payments"] == []
    assert len(data["candidates"]) == 2
    assert all(c["confirmed_account_count"] == 1 for c in data["candidates"])
    assert all(
        any(g["state"] == "report_figures_not_held" for g in c["gaps"])
        for c in data["candidates"]
    )
    assert data["filters"]["selected_only"] is True
    assert data["reporting_scope"] == "selected_effective_reports_only"


def test_selected_scope_changes_pin_even_when_report_keys_are_the_same(two_accounts):
    default = two_accounts(report_keys=["a" * 64])[0]
    selected = two_accounts(report_keys=["a" * 64], selected_only=True)[0]
    assert default["version"] != selected["version"]


def test_selected_csv_keeps_only_selected_account_and_gap_candidate(two_accounts):
    args = dict(report_keys=["b" * 64], selected_only=True)
    data = s._assemble(*two_accounts(**args), **args, _csv=True)
    data = s._join_external(
        None,
        data,
        None,
        [],
        report_keys=args["report_keys"],
        selected_only=True,
        excluded_payee_ids=[],
    )
    rows = list(csv.DictReader(io.StringIO(s._csv_body(data))))
    reports = [r for r in rows if r["Row type"] == "Account report"]
    assert [r["Report key"] for r in reports] == ["b" * 64]
    assert any(
        r["Row type"] == "Candidate"
        and r["Candidate"] == "Unmatched Candidate"
        and "report figures not held" in r["Gaps"]
        for r in rows
    )


@pytest.mark.parametrize("keys", [[], ["1" * 64]])
def test_native_publisher_groups_obey_selected_only(held, grouped, keys):  # noqa: F811
    bulk, _ = grouped
    base = s._assemble(*held, selected_only=True)
    result = s._join_external(
        None,
        base,
        deepcopy(bulk),
        held[1],
        report_keys=keys,
        selected_only=True,
        excluded_payee_ids=[],
    )
    assert [r["report_key"] for r in result["authority_reports"]] == keys
    assert all(
        not r["selected"]
        for a in result["report_options"]
        for r in a["reports"]
        if r.get("authority") == "mn_local" and r["report_key"] not in keys
    )
    if not keys:
        assert any(
            g["state"] == "report_figures_not_held"
            for c in result["candidates"]
            for g in c["gaps"]
        )


@pytest.mark.parametrize(
    "suffix,service",
    [
        ("", "report"),
        ("/payees", "payees"),
        ("/payments", "payments"),
        ("/export", "export"),
    ],
)
def test_all_four_routes_forward_selection_mode(
    finance_api, monkeypatch, suffix, service
):
    def read(db, **kwargs):
        assert kwargs.get("selected_only") is True
        return ("{}", "expense.json") if service == "export" else {}

    monkeypatch.setattr(s, service, read)
    response = finance_api.get(
        BASE + suffix,
        params={"selected_only": "true", "snapshot_id": "a" * 64, "version": "b" * 16},
    )
    assert response.status_code == 200, response.text


def test_invalid_mode_is_refused_before_storage(monkeypatch):
    monkeypatch.setattr(
        s, "_load", lambda *a, **kw: pytest.fail("invalid mode reached reads")
    )
    with pytest.raises(HTTPException) as error:
        s.report(None, election_key=KEY, selected_only="true")
    assert error.value.status_code == 422


@pytest.mark.parametrize(
    "case",
    [
        "unknown",
        "duplicate_account",
        "special",
        "wrong_year",
        "superseded",
        "outside_candidate",
    ],
)
def test_selected_only_keeps_existing_effective_key_guards(two_accounts, case):
    args: dict[str, Any] = dict(selected_only=True, report_keys=["b" * 64])
    if case == "unknown":
        args["report_keys"] = ["f" * 64]
    elif case == "duplicate_account":
        args["report_keys"] = ["a" * 64, "b" * 64]
    elif case == "special":
        two_accounts.reports[1].payload["filing"]["special_election"] = True
    elif case == "wrong_year":
        two_accounts.reports[1].payload["filing"]["filing_year"] = 2025
    elif case == "superseded":
        amended = deepcopy(two_accounts.reports[1])
        amended.report_key = "f" * 64
        amended.payload["filing"]["effective_amendment_index"] = 1
        two_accounts.reports.append(amended)
    else:
        args["candidate_query"] = "Unmatched"
    with pytest.raises(HTTPException) as failure:
        two_accounts(**args)
    assert failure.value.status_code == 422


def test_candidate_subquery_with_no_selected_period_never_falls_back(two_accounts):
    args = dict(selected_only=True, candidate_query="Unmatched", report_keys=[])
    result = s._assemble(*two_accounts(**args), **args)
    assert [c["name"] for c in result["candidates"]] == ["Unmatched Candidate"]
    assert result["candidates"][0]["confirmed_account_count"] == 1
    assert result["account_reports"] == []


def test_normal_service_mode_pins_and_exports(finance_db, comparison, monkeypatch):
    from alethical.tests.test_election_expense_analytics import _period_store
    import json

    store, _, _ = _period_store(finance_db, comparison)
    monkeypatch.setattr(s, "raw_file_store_from_env", lambda: store)
    args = dict(election_key=KEY, report_keys=["2" * 64])
    default = s.report(finance_db, **args)
    strict = s.report(finance_db, **args, selected_only=True)
    assert strict["version"] != default["version"]
    assert strict["filters"]["selected_only"] is True
    assert strict["reporting_scope"] == "selected_effective_reports_only"
    for source, mode in [(default, True), (strict, False)]:
        with pytest.raises(HTTPException) as failure:
            s.report(finance_db, **args, selected_only=mode, version=source["version"])
        assert failure.value.status_code == 409
    for format in ("json", "csv"):
        body, _ = s.export(
            finance_db,
            **args,
            selected_only=True,
            version=strict["version"],
            format=format,
        )
        if format == "json":
            assert json.loads(body)["filters"]["selected_only"] is True
        else:
            rows = list(csv.DictReader(io.StringIO(body)))
            assert {
                r["Report key"].lstrip("'")
                for r in rows
                if r["Row type"] == "Account report"
            } == {"2" * 64}
    empty = s.report(finance_db, election_key=KEY, selected_only=True)
    assert (
        empty["account_reports"] == []
        and empty["coverage"]["selected_account_reports"] == 0
    )


def test_mixed_board_native_selection_keeps_only_explicit_reports(
    two_accounts, grouped, monkeypatch
):
    monkeypatch.setattr(
        s,
        "_source_states",
        lambda db, docs, hashes, **kw: dict.fromkeys(docs | hashes, True),
    )
    bulk, _ = grouped
    for external_keys in ([], ["1" * 64]):
        args = dict(report_keys=["b" * 64], selected_only=True)
        loaded = two_accounts(**args)
        data = s._assemble(*loaded, **args)
        result = s._join_external(
            None,
            data,
            deepcopy(bulk),
            loaded[1],
            report_keys=["b" * 64, *external_keys],
            selected_only=True,
            excluded_payee_ids=[],
        )
        assert [r["report_key"] for r in result["account_reports"]] == ["b" * 64]
        assert [r["report_key"] for r in result["authority_reports"]] == external_keys
        assert result["filters"]["selected_only"] is True


def test_selected_native_group_still_refuses_two_explicit_members(held, grouped):
    bulk, _ = grouped
    with pytest.raises(HTTPException) as failure:
        s._join_external(
            None,
            s._assemble(*held),
            deepcopy(bulk),
            held[1],
            report_keys=["1" * 64, "2" * 64],
            selected_only=True,
            excluded_payee_ids=[],
        )
    assert failure.value.status_code == 422
