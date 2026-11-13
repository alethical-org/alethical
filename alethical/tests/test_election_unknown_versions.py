"""Unknown local amendment status remains inspectable, never current/superseded."""

from types import SimpleNamespace
import csv
import io

import pytest

from alethical.api.services import election_analytics as analytics
from alethical.api.services import election_comparison_export as export


def external_payload(effective=None, *, memo=False):
    candidate = {"candidate_id": "candidate", "is_write_in_aggregate": False}
    race = SimpleNamespace(id="race", payload={"candidates": [candidate]})
    payment = {
        "authority": "local:county:18",
        "account_id": "group:example",
        "payment_key": "p" * 64,
        "report_key": "r" * 64,
        "source_report_id": "123",
        "source_row_id": "page1:row1",
        "date": "2026-10-01",
        "target_source_candidate_id": "candidate",
        "amount": "12.34",
        "currency": "USD",
        "direction": "independent_for",
        "transaction_type": "local_source_row",
        "amount_role": "supplemental_memo" if memo else "reported_payment",
        "nonadditive": memo,
        "memo": {},
        "payee": "Source vendor",
        "purpose": "Source purpose",
        "period_start": "2026-09-01",
        "period_end": "2026-10-19",
        "effective": effective,
        "version_scope": "exact_document",
        "amendment_status": "not_established",
        "sources": [
            {
                "source_sha256": "a" * 64,
                "locator": {"page": 1, "row": 1},
                "quote": "12.34",
            }
        ],
    }
    report = {
        k: payment[k]
        for k in (
            "authority",
            "account_id",
            "report_key",
            "source_report_id",
            "period_start",
            "period_end",
            "effective",
            "version_scope",
            "amendment_status",
        )
    }
    payload = {
        "generation_id": "b" * 64,
        "sources": [
            {
                "sha256": "a" * 64,
                "url": "https://example.test/original",
                "copied_at": "2026-11-12T00:00:00+00:00",
            }
        ],
        "authorities": [{"key": "local:county:18", "name": "Crow Wing County"}],
        "candidates": [
            {
                "race_id": "race",
                "candidate_id": "candidate",
                "reports": [report],
                "payments": [payment],
            }
        ],
    }
    return payload, race


def events(effective=None, **kwargs):
    payload, race = external_payload(effective, **kwargs)
    return analytics._external_events(payload, [race])


def test_unknown_version_does_not_become_superseded_or_attributed():
    rows, reports = events()
    assert rows[0]["effective"] is None
    assert rows[0]["resolution"] == "amendment_status_not_established"
    assert rows[0]["claims"] == []
    assert rows[0]["related_candidacies"]
    assert rows[0]["version_scope"] == reports[0]["version_scope"] == "exact_document"
    assert rows[0]["amendment_status"] == "not_established"
    assert rows[0]["amount"] == "12.34" and rows[0]["source_bindings"]


def test_unknown_version_diagnostic_buckets_and_native_measures_do_not_sum():
    rows, _ = events()
    buckets = analytics._buckets(rows)
    assert buckets[0]["amount"] is None
    assert buckets[0]["known_amount_subtotal"] is None
    assert buckets[0]["withheld_reason"] == "amendment_status_not_established"
    native = analytics._native_measures(rows)[0]
    assert native["effective"] is None
    assert native["amount"] is None
    assert native["state"] == "amendment_status_not_established"
    assert native["amendment_status"] == "not_established"
    assert not analytics._keys(rows, {"independent_For"})


@pytest.mark.parametrize(
    "effective,resolution", [(True, "attributed"), (False, "superseded_report")]
)
def test_established_versions_keep_existing_meaning(effective, resolution):
    rows, _ = events(effective)
    assert rows[0]["effective"] is effective
    assert rows[0]["resolution"] == resolution
    assert analytics._native_measures(rows)[0]["amount"] == (
        "12.34" if effective else None
    )


def test_csv_keeps_unknown_exact_amount_out_of_current_and_superseded_columns():
    rows, reports = events()
    # This scalar exporter test does not add candidacy display fixtures. Source
    # row and its evidence remain intact; attribution is tested above.
    rows[0]["related_candidacies"] = []
    data = dict(
        election_key="mn-2026-11-03-general",
        election_date="2026-11-03",
        snapshot_id="s" * 64,
        version="v" * 64,
        release_id=None,
        currency="USD",
        scope_note="Exact retained records",
        definitions={"support": "Source support", "opposition": "Source opposition"},
        sources={},
        external_sources=[],
        external_reports=reports,
        rows=rows,
        candidacies=[],
        outcomes={},
    )
    body = analytics._csv_export(data, [])
    parsed = list(
        csv.DictReader(
            io.StringIO(body.decode("utf-8-sig") if isinstance(body, bytes) else body)
        )
    )
    held = next(r for r in parsed if r["Row type"] == "Version not established")
    assert held["Document amount"] == "12.34"
    assert held["Payment USD"] == held["Superseded payment USD"] == ""
    assert held["Amendment status"] == "not_established"
    assert held["Version scope"] == "exact_document"
    assert held["Source URL"]
    assert not any(r["Row type"] == "Superseded payment" for r in parsed)


def test_latest_never_chooses_unknown_and_selected_record_keeps_its_scope():
    payload, _ = external_payload()
    report = payload["candidates"][0]["reports"][0]
    assert export._latest_external([report]) is None
    assert (
        export._latest_external([report | {"effective": True}]) == report["report_key"]
    )
    assert not export._include_external_payment(
        payload["candidates"][0]["payments"][0], set()
    )
    assert export._include_external_payment(
        payload["candidates"][0]["payments"][0], {report["report_key"]}
    )
