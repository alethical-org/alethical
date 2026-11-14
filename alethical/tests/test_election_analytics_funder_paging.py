"""Paging changes work performed, never the full answer or global proof."""

# Imported fixtures intentionally share the existing isolated source setup.
# ruff: noqa: F401,F811
from collections import defaultdict
from copy import deepcopy
from datetime import date
from typing import Any

import pytest
from sqlalchemy.orm import Session

from alethical.api.services import election_analytics as reads
from alethical.tests.finance_fixtures import finance_db
from alethical.tests.test_election_analytics import (
    analytics,
    db,
    retain_analytics_originals,
    checked_external,
    external_generation,
)
from alethical.tests.test_election_comparison_reads import KEY, RACE
from alethical.tests.test_election_finance_reads import comparison
from alethical.tests.test_election_outside_spending import spending


# Frozen pre-change implementation: f51e144c funders, full formatter before paging.
def _reference_funders(db, *, limit=50, offset=0, **kwargs):
    context, events, _, _, outcomes = reads._build(db, _include_fields=False, **kwargs)
    grouped = defaultdict(list)
    for event in events:
        grouped[event["funder_id"]].append(event)
    rows = []
    for key, records in sorted(grouped.items()):
        rows.append(
            {
                "funder_id": key,
                "registration_number": records[0]["funder_registration"]
                if records[0]["funder_identity_state"] == "registered_filer"
                else None,
                "source_registration_values": sorted(
                    {
                        row["funder_registration"]
                        for row in records
                        if row["funder_registration"] is not None
                    }
                ),
                "identity_state": records[0]["funder_identity_state"],
                "identity_evidence": [
                    row["funder_identity_evidence"]
                    for row in records[:1]
                    if row["funder_identity_evidence"]
                ],
                "names": sorted(
                    {r["funder_name"] for r in records if r["funder_name"] is not None}
                ),
                "recorded_classifications": [
                    dict(
                        zip(
                            ("category", "recorded_type", "recorded_subtype"),
                            values,
                            strict=True,
                        )
                    )
                    for values in sorted(
                        {
                            (r["category"], r["recorded_type"], r["recorded_subtype"])
                            for r in records
                        },
                        key=lambda x: tuple(v or "" for v in x),
                    )
                ],
                "amounts": reads._metrics(records),
                **(
                    {
                        "source_family": "external",
                        "authority": records[0]["authority"],
                        "source_account_id": records[0]["source_account_id"],
                        "source_measures": reads._native_measures(records),
                    }
                    if records[0].get("source_family") == "external"
                    else {}
                ),
                "reconciliation": reads._buckets(records),
                "supported_outcomes": reads._counts(
                    reads._keys(records, {"direct_contributions", "independent_For"}),
                    outcomes,
                ),
                "support_count_review": reads._support_review(records),
                "opposed_outcomes": reads._counts(
                    reads._keys(records, {"independent_Against"}), outcomes
                ),
                "evidence_url": reads._evidence_url(context, funder_id=key),
            }
        )
    # Sort the complete result before paging; identity stays independent of names.
    rows.sort(
        key=lambda row: (
            not bool(row["names"]),
            str(row["names"][0]).casefold() if row["names"] else "",
            row["funder_id"],
        )
    )
    return {
        **context,
        "funders": rows[offset : offset + limit],
        "page": reads._page(rows, limit, offset),
    }


def _events():
    events = []
    names = [None, "same", "same", "Aa", "aa", "Ångström", "βeta", "", "Zed"]
    for number in range(123):
        external = number % 3 == 0
        for index, amount in enumerate(["9999999999999999.9999", "-0.0001", None, "0"]):
            row: dict[str, Any] = dict(
                funder_id=f"funder:{number:04d}",
                funder_registration=str(number),
                funder_identity_state="external_account"
                if external
                else "registered_filer",
                funder_identity_evidence={"source": "identity-proof"},
                funder_name=names[number % len(names)],
                category=None if external else "PCF",
                recorded_type=None if external else "Political Committee/Fund",
                recorded_subtype=None,
                metric="independent_Against" if index == 2 else "direct_contributions",
                resolution="outside_selected_period" if index == 3 else "attributed",
                dataset="external" if external else "contributions",
                amount_state="missing" if amount is None else "known",
                amount=amount,
                claims=[{"race_id": "r", "candidate_id": "c"}],
            )
            if external:
                row.update(
                    source_family="external",
                    authority="fec",
                    source_account_id=str(number),
                    report_key=f"report:{number}",
                    source_report_id="filed",
                    period_start="2026-01-01",
                    period_end="2026-12-31",
                    amount_role="payment",
                    currency="EUR" if number == 3 else "USD",
                    effective=None if number == 6 or amount is None else True,
                    nonadditive=number == 9,
                    transaction_type="Contribution",
                    direction="For",
                    source_bindings=[],
                    sum_eligible=number != 12,
                )
            events.append(row)
    # One funder has multiple literal names; sorting uses the first exact sorted name.
    events[1]["funder_name"] = "Alternate name"
    return events


@pytest.fixture
def built_events(monkeypatch):
    events = _events()
    outcomes = {"r": {"candidates": {"c": {"outcome": "elected"}}}}
    context = {
        "election_key": KEY,
        "snapshot_id": "a" * 64,
        "version": "b" * 64,
        "filters": {"race_id": None, "funder_id": None, "q": ""},
        "reconciliation": reads._buckets(events),
        "filtered_reconciliation": reads._buckets(events),
        "source_scopes": {"mn_cfb": {"status": "available"}},
    }
    calls = []

    def build(db, *, _include_fields=True, **kwargs):
        calls.append((_include_fields, kwargs))
        return deepcopy(context), events, [], {}, outcomes

    monkeypatch.setattr(reads, "_build", build)
    return calls


@pytest.mark.parametrize(
    "limit,offset", [(1, 0), (7, 0), (50, 50), (50, 120), (50, 123), (50, 200)]
)
def test_funders_format_only_requested_page(built_events, monkeypatch, limit, offset):
    calls = []
    original = reads._metrics

    def counted(events):
        calls.append(events)
        return original(events)

    monkeypatch.setattr(reads, "_metrics", counted)
    answer = reads.funders(Session(), limit=limit, offset=offset, election_key=KEY)
    assert len(calls) == len(answer["funders"])
    assert answer["page"]["total"] == 123
    assert built_events == [(False, {"election_key": KEY})]


@pytest.mark.parametrize(
    "limit,offset",
    [(1, 0), (7, 8), (50, 0), (50, 50), (50, 120), (50, 123), (100, 200)],
)
def test_funders_match_full_old_answer(built_events, limit, offset):
    kwargs = dict(election_key=KEY, limit=limit, offset=offset)
    assert reads.funders(Session(), **kwargs) == _reference_funders(None, **kwargs)


@pytest.mark.parametrize(
    "scope",
    [
        {},
        {"race_id": RACE},
        {"q": "nothing matches"},
        {"start_date": date(2026, 6, 1), "end_date": date(2026, 11, 3)},
    ],
)
def test_funders_real_source_scope_keeps_old_full_answer(finance_db, analytics, scope):
    kwargs = dict(election_key=KEY, limit=1, offset=1, **scope)
    expected = _reference_funders(finance_db, **kwargs)
    actual = reads.funders(finance_db, **kwargs)
    assert actual == expected
    assert actual["reconciliation"] == expected["reconciliation"]
    assert actual["version"] == expected["version"]


def test_funders_external_source_keeps_old_full_answer(finance_db, checked_external):
    kwargs = dict(election_key=KEY, limit=1, offset=0)
    assert reads.funders(finance_db, **kwargs) == _reference_funders(
        finance_db, **kwargs
    )
