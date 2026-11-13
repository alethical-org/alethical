"""Private expense reads, exact filter bounds and source-version continuity."""

# ruff: noqa: F811
import csv
import io

import pytest

from alethical.api.services import election_expense_analytics as reads
from alethical.api.services import finance_access
from alethical.tests.finance_fixtures import (  # noqa: F401
    FINANCE_EMAIL,
    finance_api,
    finance_db,
)
from alethical.tests.test_election_finance_reads import comparison  # noqa: F401
from alethical.tests.test_election_outside_spending import spending  # noqa: F401
from alethical.tests.test_election_expense_analytics import retained_read_store
from alethical.tests.test_election_comparison_reads import KEY

BASE = f"/api/v1/finance/elections/{KEY}/analytics/expenses"
PINS = {"snapshot_id": "a" * 64, "version": "b" * 16}
ROUTES = [
    ("", "report"),
    ("/payees", "payees"),
    ("/payments", "payments"),
    ("/export", "export"),
]


def private(response):
    assert "private" in response.headers["cache-control"]
    assert "no-store" in response.headers["cache-control"]
    assert response.headers["x-robots-tag"] == "noindex, nofollow"


@pytest.mark.parametrize("suffix,service", ROUTES)
@pytest.mark.parametrize("status", [401, 403])
def test_no_expense_or_source_reads_without_finance_access(
    finance_api, finance_db, monkeypatch, suffix, service, status
):
    def forbidden(*args, **kwargs):
        pytest.fail("Refused request entered expense or source reads")

    monkeypatch.setattr(reads, service, forbidden)
    monkeypatch.setattr(reads, "raw_file_store_from_env", forbidden)
    if status == 401:
        finance_api.headers.pop("Authorization")
    else:
        finance_access.revoke(finance_db, FINANCE_EMAIL)
        finance_db.commit()
    response = finance_api.get(BASE + suffix, params=PINS)
    assert response.status_code == status, response.text
    private(response)


@pytest.mark.parametrize("suffix,service", ROUTES)
@pytest.mark.parametrize(
    "bad",
    [
        {"race_id": "not-a-race"},
        {"candidate_id": "one"},
        {"candidate_id": "bad\x00", "race_id": "c" * 64},
        {"party": "Republican"},
        {"geography": "CA"},
        {"payee_query": "x" * 201},
        {"payee_query": "bad\x00"},
        {"candidate_query": "x" * 201},
        {"candidate_query": "bad\x00"},
        {"report_keys": "not-a-hash"},
        {"report_keys": ["d" * 64] * 501},
        {"excluded_payee_ids": "alias:Google"},
        {"excluded_payee_ids": ["d" * 64] * 201},
        {"version": "b" * 64},
    ],
)
def test_invalid_filters_fail_before_expensive_reads(
    finance_api, monkeypatch, suffix, service, bad
):
    monkeypatch.setattr(
        reads, service, lambda *a, **kw: pytest.fail("Invalid input reached storage")
    )
    response = finance_api.get(BASE + suffix, params=PINS | bad)
    assert response.status_code == 422, response.text
    private(response)


@pytest.mark.parametrize(
    "suffix,params,service",
    [
        ("", {"offset": 50}, "report"),
        ("/payees", {}, "payees"),
        ("/payments", {}, "payments"),
        ("/export", {}, "export"),
    ],
)
@pytest.mark.parametrize("pins", [{}, {"version": "b" * 16}, {"snapshot_id": "a" * 64}])
def test_drilldown_pagination_and_exports_need_both_pins(
    finance_api, monkeypatch, suffix, params, service, pins
):
    monkeypatch.setattr(
        reads,
        service,
        lambda *a, **kw: pytest.fail("Unpinned continuation reached reads"),
    )
    response = finance_api.get(BASE + suffix, params=params | pins)
    assert response.status_code == 422, response.text


@pytest.mark.parametrize("suffix,service", ROUTES[:3])
def test_exact_filters_reach_reads_unchanged(
    finance_api, finance_db, monkeypatch, suffix, service
):
    filters = PINS | {
        "race_id": "c" * 64,
        "candidate_id": "00000001",
        "party": "NP",
        "geography": "unknown",
        "payee_query": "Example Print",
        "candidate_query": "Literal Candidate",
        "report_keys": ["0" * 64, "1" * 64],
        "excluded_payee_ids": ["d" * 64, "e" * 64],
        "limit": 5,
        "offset": 10,
    }
    if suffix == "/payments":
        filters["payee_id"] = "f" * 64
    calls = []

    def captured(db, **kwargs):
        assert db is finance_db
        calls.append(kwargs)
        return {"version": PINS["version"]}

    monkeypatch.setattr(reads, service, captured)
    response = finance_api.get(BASE + suffix, params=filters)
    assert response.status_code == 200, response.text
    assert calls == [filters | {"election_key": KEY, "selected_only": False}]
    private(response)


@pytest.mark.parametrize("search", ["x" * 201, "bad\x00search"])
def test_export_rejects_invalid_name_search_before_storage(
    finance_api, monkeypatch, search
):
    monkeypatch.setattr(
        reads, "export", lambda *a, **kw: pytest.fail("Invalid search reached storage")
    )
    response = finance_api.get(BASE + "/export", params=PINS | {"search_query": search})
    assert response.status_code == 422
    private(response)


def test_actual_export_name_search_keeps_selected_scope_and_missing_candidates(
    finance_api, finance_db, comparison, monkeypatch
):
    from alethical.tests.test_election_expense_analytics import _period_store

    store, _, _ = _period_store(finance_db, comparison)
    monkeypatch.setattr(reads, "raw_file_store_from_env", lambda: store)
    scope = {"report_keys": ["2" * 64], "selected_only": True}
    first = finance_api.get(BASE, params=scope).json()["data"]
    missing = next(c for c in first["candidates"] if not c["accounts"])
    pins = {key: first[key] for key in PINS}
    response = finance_api.get(
        BASE + "/export",
        params=scope | pins | {"format": "csv", "search_query": missing["name"]},
    )
    assert response.status_code == 200, response.text
    private(response)
    rows = list(csv.DictReader(io.StringIO(response.text)))
    metadata = {
        r["Metadata field"]: r["Metadata value"]
        for r in rows
        if r["Row type"] == "Metadata"
    }
    assert metadata["Filter: search query"] == missing["name"]
    assert metadata["Version"] == first["version"]
    candidates = [r for r in rows if r["Row type"] == "Candidate"]
    assert len(candidates) == len(first["candidates"])
    assert [
        r["Candidate"] for r in candidates if r["Included in filtered view"] == "Yes"
    ] == [missing["name"]]
    reports = [r for r in rows if r["Row type"] == "Account report"]
    assert [r["Report key"].lstrip("'") for r in reports] == ["2" * 64]
    assert (
        reports[0]["Report total USD"]
        == first["summary"]["source_report_totals"]["amounts"]["total"]
    )


def test_actual_report_export_and_source_loss_keep_same_evidence(
    finance_api, finance_db, comparison, monkeypatch
):
    store, source, document = retained_read_store(finance_db, comparison)
    monkeypatch.setattr(reads, "raw_file_store_from_env", lambda: store)
    response = finance_api.get(BASE)
    assert response.status_code == 200, response.text
    private(response)
    first = response.json()["data"]
    assert first["summary"]["source_report_totals"]["amounts"]["total"] == "7.00"
    pins = {key: first[key] for key in PINS}
    for format in ("json", "csv"):
        response = finance_api.get(
            BASE + "/export",
            params=pins | {"format": format},
            headers={
                "Host": "attacker.invalid",
                "X-Forwarded-Host": "attacker.invalid",
                "Origin": "https://attacker.invalid",
            },
        )
        assert response.status_code == 200, response.text
        private(response)
        assert response.headers["x-content-type-options"] == "nosniff"
        assert response.headers["content-disposition"].startswith(
            'attachment; filename="campaign-expenses-'
        )
        assert response.headers["content-disposition"].endswith(f'.{format}"')
        if format == "json":
            context = response.json()
        else:
            rows = list(csv.DictReader(io.StringIO(response.text)))
            metadata = {
                r["Metadata field"]: r["Metadata value"]
                for r in rows
                if r["Row type"] == "Metadata"
            }
            assert metadata["Version"] == first["version"]
            account = next(r for r in rows if r["Row type"] == "Account report")
            assert (
                account["Report total USD"]
                == first["summary"]["source_report_totals"]["amounts"]["total"]
            )
            assert account["Source URL"].startswith(
                "https://alethicalfinance.com/elections/"
            )
            continue
        assert context["version"] == first["version"]
        assert (
            context["summary"]["source_report_totals"]
            == first["summary"]["source_report_totals"]
        )
    store.objects.pop(document.object_key)
    for suffix, _ in ROUTES:
        response = finance_api.get(BASE + suffix, params=pins)
        assert response.status_code == 409, response.text
        private(response)
    fresh = finance_api.get(BASE).json()["data"]
    assert fresh["version"] != first["version"]
    assert fresh["summary"]["source_report_totals"]["amounts"] is None


def test_actual_name_search_report_selection_drilldowns_and_exports(
    finance_api, finance_db, comparison, monkeypatch
):
    from alethical.tests.test_election_expense_analytics import _period_store

    store, _, _ = _period_store(finance_db, comparison)
    monkeypatch.setattr(reads, "raw_file_store_from_env", lambda: store)
    query = comparison["race"].payload["candidates"][0]["name"].swapcase()
    filters = {"candidate_query": query, "report_keys": ["2" * 64]}
    response = finance_api.get(BASE, params=filters)
    assert response.status_code == 200, response.text
    data = response.json()["data"]
    private(response)
    assert (
        len(data["candidates"]) == 1
        and data["account_reports"][0]["report_key"] == "2" * 64
    )
    assert data["account_reports"][0]["period_end"] == "2026-08-01"
    assert data["page"]["limit"] == 50
    pins = {key: data[key] for key in PINS}
    for suffix in ["/payees", "/payments"]:
        result = finance_api.get(BASE + suffix, params=filters | pins)
        assert result.status_code == 200, result.text
        scoped = result.json()["data"]
        assert scoped["account_reports"][0]["report_key"] == "2" * 64
        assert scoped["filters"]["candidate_query"] == query
        private(result)
    for format in ["json", "csv"]:
        result = finance_api.get(
            BASE + "/export", params=filters | pins | {"format": format}
        )
        assert result.status_code == 200, result.text
        if format == "json":
            exported = result.json()
            assert exported["account_reports"][0]["report_key"] == "2" * 64
        else:
            rows = list(csv.DictReader(io.StringIO(result.text)))
            metadata = {
                r["Metadata field"]: r["Metadata value"]
                for r in rows
                if r["Row type"] == "Metadata"
            }
            assert (
                next(r for r in rows if r["Row type"] == "Account report")[
                    "Report key"
                ].lstrip("'")
                == "2" * 64
            )
            assert metadata["Filter: candidate query"] == query
            assert metadata["Filter: report keys"] == "2" * 64
            private(result)
            continue
        assert exported["filters"]["candidate_query"] == query and exported["filters"][
            "report_keys"
        ] == ["2" * 64]
        private(result)
    # Clearing search restores all candidates; clearing selection restores latest.
    cleared = finance_api.get(BASE).json()["data"]
    assert (
        cleared["coverage"]["scoped_candidacies"]
        == cleared["coverage"]["named_candidacies"]
    )
    assert cleared["account_reports"][0]["report_key"] == "1" * 64
    changed = finance_api.get(BASE, params=pins)
    assert changed.status_code == 409
