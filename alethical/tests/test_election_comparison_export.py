"""Race CSV keeps complete scope, independent measures and exact source gates."""

# ruff: noqa: F401,F811
import csv
import gzip
import hashlib
import io
from copy import deepcopy
from datetime import UTC, date, datetime
from decimal import Decimal

import pytest
from sqlalchemy import delete, select

from alethical.api.services import election_comparison_export as export
from alethical.api.services import election_comparison_reads as results
from alethical.api.services import election_finance_reads as finance
from alethical.api.services import election_outside_spending as outside
from alethical.db import models as m
from alethical.pipeline import election_account_reviews as reviews
from alethical.tests.finance_fixtures import finance_api, finance_db
from alethical.tests.test_election_comparison_reads import (
    BODY,
    KEY,
    RACE,
    SNAPSHOT,
    SOURCE,
    _precinct,
)
from alethical.tests.test_election_comparison_storage import MemoryStore
from alethical.tests.test_election_finance_reads import comparison, COLLECTION
from alethical.tests.test_election_outside_spending import spending

URL = f"/api/v1/finance/elections/{KEY}/races/{RACE}/export.csv"


def parsed(response):
    assert response.status_code == 200, response.text
    return list(csv.DictReader(io.StringIO(response.content.decode("utf-8-sig"))))


@pytest.fixture()
def originals(finance_db, comparison, monkeypatch):
    store = MemoryStore()
    stored = finance_db.get(m.ElectionResultSource, SOURCE)
    store.objects[stored.object_key] = gzip.compress(BODY, mtime=0)
    for doc in finance_db.scalars(select(m.CampaignFinanceReportDocument)):
        body = b"%PDF-1.4\nSynthetic retained fixture " + doc.report_type.encode()
        assert hashlib.sha256(body).hexdigest() == doc.document_hash
        store.objects[doc.object_key] = gzip.compress(body, mtime=0)
    # Published fixture's actual independent source ID comes from the reader context.
    context, release = outside._context(
        finance_db,
        election_key=KEY,
        election_snapshot_id=SNAPSHOT,
        version=None,
        release_id=None,
    )
    original = finance_db.get(
        m.CampaignFinanceSnapshot, release.independent_expenditures.snapshot_id
    )
    body = b"Spender,Amount\r\nExample fund,10.00\r\n"
    compressed = gzip.compress(body, mtime=0)
    original.content_hash = hashlib.sha256(body).hexdigest()
    original.byte_size = len(body)
    key = "private/retained/outside.gz"
    store.objects[key] = compressed
    finance_db.add(
        m.CampaignFinanceSnapshotBody(
            snapshot_id=original.id,
            object_key=key,
            compression="gzip",
            compressed_hash=hashlib.sha256(compressed).hexdigest(),
            compressed_byte_size=len(compressed),
        )
    )
    finance_db.commit()
    for module in (results, finance, outside):
        monkeypatch.setattr(module, "raw_file_store_from_env", lambda: store)
    return store


def test_export_all_precinct_pages_and_separate_selected_reports(
    finance_api, finance_db, originals
):
    for i in range(105):
        _precinct(
            finance_db, key=f"01:{i:04}", name=f"Selected precinct {i:03}", vote=i
        )
    _precinct(finance_db, key="02:0001", name="Unrelated precinct", vote=999)
    finance_db.commit()
    started = datetime.now(UTC)
    response = finance_api.get(
        URL,
        params=[
            ("snapshot_id", SNAPSHOT),
            ("report_key", "1" * 64),
            ("report_key", "2" * 64),
            ("q", "Selected"),
            ("county", "01"),
        ],
    )
    rows = parsed(response)
    assert started <= datetime.fromisoformat(rows[0]["Generated"]) <= datetime.now(UTC)
    assert all(row["Generated"] == "" for row in rows[1:])
    assert rows[0]["Row type"] == "Metadata" and rows[0]["Matching precincts"] == "105"
    precincts = [r for r in rows if r["Row type"] == "Precinct candidate"]
    assert len(precincts) == 105 and {r["Precinct votes"] for r in precincts} == {
        str(i) for i in range(105)
    }
    reports = [r for r in rows if r["Row type"] == "Report"]
    assert {r["Report key"] for r in reports} == {"1" * 64, "2" * 64}
    assert all(
        r["Overlapping selected reports"] and r["Nonadditive"] == "Yes" for r in reports
    )
    figures = [r for r in rows if r["Row type"] == "Figure"]
    assert len(figures) == 6
    assert {
        r["Report cash"] for r in figures if r["Measure ID"] == "contributions_received"
    } == {"0.00", "500.00"}
    assert all(r["Payment amount"] == "" for r in figures)
    assert "Unrelated precinct" not in response.text
    assert "private-reviewer" not in response.text and "/private/" not in response.text
    assert "private, no-store" in response.headers["cache-control"]


def test_default_latest_and_zero_unknown_votes_are_distinct(
    finance_api, finance_db, originals
):
    row = finance_db.scalar(select(finance.R).where(finance.R.row_number == 1))
    row.amount = Decimal("-5.00")
    finance_db.commit()
    rows = parsed(finance_api.get(URL, params={"snapshot_id": SNAPSHOT}))
    assert [r["Report key"] for r in rows if r["Row type"] == "Report"] == ["1" * 64]
    choices = {r["Candidate ID"]: r for r in rows if r["Row type"] == "Candidate"}
    for candidate in choices.values():
        if candidate["Candidate votes"] == "":
            assert candidate["Vote share %"] == ""
    assert {r["Outcome status"] for r in choices.values()} == {"pending"}
    assert (
        choices["b"]["Candidate votes"] == ""
        and choices["b"]["Vote status"] == "not_available"
    )
    assert (
        choices["w"]["Candidate votes"] == "0"
        and choices["w"]["Vote status"] == "reported"
    )
    payments = [r for r in rows if r["Row type"] == "Outside payment"]
    assert len({r["Payment key"] for r in payments}) == len(payments)
    assert {r["Payment amount"] for r in payments} >= {"10.00", "0.00", "-5.00"}
    assert all(r["Report total"] == "" for r in payments)


@pytest.mark.parametrize("keys", [["f" * 64], ["1" * 64, "1" * 64], ["bad"]])
def test_foreign_or_duplicate_reports_are_refused(finance_api, originals, keys):
    response = finance_api.get(
        URL, params=[("snapshot_id", SNAPSHOT)] + [("report_key", k) for k in keys]
    )
    assert response.status_code == 422


def test_auth_and_pin_inputs(finance_api, originals):
    assert (
        finance_api.get(
            URL, params={"snapshot_id": SNAPSHOT}, headers={"Authorization": ""}
        ).status_code
        == 401
    )
    assert finance_api.get(URL, params={"snapshot_id": "bad"}).status_code == 422
    assert (
        finance_api.get(
            URL, params={"snapshot_id": SNAPSHOT, "version": "0" * 16}
        ).status_code
        == 409
    )
    assert (
        finance_api.get(
            URL,
            params={
                "snapshot_id": SNAPSHOT,
                "external_version": "unrelated:" + "a" * 64,
            },
        ).status_code
        == 422
    )


@pytest.mark.parametrize("kind", ["result", "report", "outside"])
def test_source_corruption_refuses_partial_csv(
    finance_api, finance_db, originals, kind
):
    if kind == "result":
        key = finance_db.get(m.ElectionResultSource, SOURCE).object_key
    elif kind == "report":
        key = finance_db.scalar(
            select(m.CampaignFinanceReportDocument).where(
                m.CampaignFinanceReportDocument.report_type == "E"
            )
        ).object_key
    else:
        key = "private/retained/outside.gz"
    originals.objects[key] = b"corrupt private object key"
    response = finance_api.get(URL, params={"snapshot_id": SNAPSHOT})
    assert response.status_code == 503 and "corrupt private object" not in response.text
    assert not response.text.startswith("Row type")


def test_review_withdrawal_invalidates_board_pin(
    finance_api, finance_db, originals, comparison
):
    before = finance.comparison(
        finance_db, election_key=KEY, race_id=RACE, snapshot_id=SNAPSHOT
    )
    args = {
        **comparison["args"],
        "decision": "withdrawn",
        "reason": "Private withdrawal",
        "expected_previous_id": comparison["decision"].id,
    }
    reviews.record_decision(finance_db, **args)
    finance_db.commit()
    response = finance_api.get(
        URL, params={"snapshot_id": SNAPSHOT, "version": before["version"]}
    )
    assert response.status_code == 409


@pytest.mark.parametrize(
    "value", ["=1+1", "+cmd", "-cmd", "@SUM(A1)", "  =1", "\tformula", "\nformula"]
)
def test_formula_text_is_inert_and_amounts_stay_numeric(value):
    assert export._cell(value).startswith("'")
    assert export._cell(Decimal("-123.45")) == "-123.45"
    assert export._cell(None) == "" and export._cell(Decimal("0")) == "0.00"


def test_no_json_or_internal_fields_in_csv(finance_api, originals):
    response = finance_api.get(URL, params={"snapshot_id": SNAPSHOT})
    rows = parsed(response)
    assert tuple(rows[0]) == export.COLUMNS
    assert not any(v.lstrip().startswith(("{", "[")) for r in rows for v in r.values())
    assert not any(
        word in response.text
        for word in ("reviewed_by", "PRIVATE_OBJECT_KEY", "object_key", "request_form")
    )


@pytest.fixture()
def external_originals(finance_db, monkeypatch):
    from alethical.tests.test_election_external_finance import external as fixture
    from alethical.tests.test_election_external_finance_reads import checked
    from alethical.api.services import election_external_finance_reads

    ctx = fixture.__wrapped__(finance_db, monkeypatch)
    ctx.snapshot.first_published_at = ctx.snapshot.fetched_at
    finance_db.add(
        m.ElectionComparisonCurrent(election_key=KEY, snapshot_id=ctx.snapshot.id)
    )
    checked(finance_db, ctx)
    finance_db.commit()
    monkeypatch.setattr(results, "raw_file_store_from_env", lambda: ctx.store)
    monkeypatch.setattr(
        election_external_finance_reads, "raw_file_store_from_env", lambda: ctx.store
    )
    return ctx


def test_external_records_without_board_collection_or_version(
    finance_api, external_originals
):
    ctx = external_originals
    url = f"/api/v1/finance/elections/{KEY}/races/{ctx.race.id}/export.csv"
    response = finance_api.get(url, params={"snapshot_id": ctx.snapshot.id})
    rows = parsed(response)
    assert len([r for r in rows if r["Row type"] == "Report"]) == 1
    figures = [r for r in rows if r["Row type"] == "Figure"]
    assert {r["Measure value"] for r in figures} == {"0.00", "12.34"}
    assert all(r["Authority"] == "fec" for r in figures)
    assert all(r["Account ID"] == ctx.account["account_id"] for r in figures)
    assert all(not r["Internal account key"] and not r["Account kind"] for r in figures)
    payments = [r for r in rows if r["Row type"] == "External payment"]
    assert len(payments) == 2 and {p["Payment amount"] for p in payments} == {
        "0.00",
        "123.45",
    }
    assert any(r["State"] == "outside_spending_unavailable" for r in rows)
    assert any("kind=external" in r["Source URL"] for r in rows)
    assert (
        "PRIVATE_REVIEWER" not in response.text
        and "PRIVATE_OBJECT_KEY" not in response.text
    )
    assert any(
        r["Row type"] == "Version" and len(r["External version"]) == 64 for r in rows
    )


def test_external_both_versions_separate_no_amendment_double_count(
    finance_api, external_originals
):
    ctx = external_originals
    url = f"/api/v1/finance/elections/{KEY}/races/{ctx.race.id}/export.csv"
    rows = parsed(
        finance_api.get(
            url,
            params=[("snapshot_id", ctx.snapshot.id)]
            + [("report_key", r["report_key"]) for r in ctx.g["reports"]],
        )
    )
    reports = [r for r in rows if r["Row type"] == "Report"]
    assert len(reports) == 2 and all(r["Overlapping selected reports"] for r in reports)
    assert {r["Effective amendment"] for r in reports} == {"Yes", "No"}
    assert len([r for r in rows if r["Row type"] == "External payment"]) == 2


def test_external_source_loss_refuses_old_candidate_pin(
    finance_api, finance_db, external_originals
):
    from alethical.api.services import election_external_finance_reads

    ctx = external_originals
    prior = election_external_finance_reads.candidate_finance(
        finance_db,
        election_key=KEY,
        race_id=ctx.race.id,
        candidate_id=ctx.candidate["candidate_id"],
        store=ctx.store,
    )
    stored = finance_db.get(m.ElectionResultSource, ctx.source_hash)
    ctx.store.objects.pop(stored.object_key)
    url = f"/api/v1/finance/elections/{KEY}/races/{ctx.race.id}/export.csv"
    response = finance_api.get(
        url,
        params={
            "snapshot_id": ctx.snapshot.id,
            "external_generation_id": ctx.g["id"],
            "external_version": ctx.candidate["candidate_id"] + ":" + prior["version"],
        },
    )
    assert response.status_code == 409


def test_shared_report_and_payment_money_is_not_duplicated(
    finance_api, originals, monkeypatch
):
    # Composition stress: the checked reader supplies the same account to two exact candidacies.
    # This does not apply an identity review or weaken the underlying reader gate.
    original = finance.comparison

    def shared(*args, **kwargs):
        data = original(*args, **kwargs)
        data["candidates"][1]["accounts"] = deepcopy(data["candidates"][0]["accounts"])
        return data

    monkeypatch.setattr(finance, "comparison", shared)
    rows = parsed(finance_api.get(URL, params={"snapshot_id": SNAPSHOT}))
    reports = [r for r in rows if r["Row type"] == "Report"]
    assert len(reports) == 1 and reports[0]["Candidate ID"] == "a; b"
    assert len([r for r in rows if r["Row type"] == "Figure"]) == 3


def test_external_value_never_rounds_source_precision():
    assert export._cell(Decimal("12.3456")) == "12.3456"


def test_outcome_pin_is_independent_of_board_pin(finance_api, external_originals):
    ctx = external_originals
    url = f"/api/v1/finance/elections/{KEY}/races/{ctx.race.id}/export.csv"
    response = finance_api.get(
        url, params={"snapshot_id": ctx.snapshot.id, "outcome_version": "0" * 64}
    )
    assert response.status_code == 409


def test_explicit_selection_has_no_200_report_truncation(
    finance_api, originals, monkeypatch
):
    original = finance.comparison
    keys = [f"{i:064x}" for i in range(1, 202)]

    def many(*args, **kwargs):
        data = original(*args, **kwargs)
        account = data["candidates"][0]["accounts"][0]
        report = account["reports"][0]
        account["reports"] = [{**deepcopy(report), "report_key": key} for key in keys]
        return data

    monkeypatch.setattr(finance, "comparison", many)
    rows = parsed(
        finance_api.get(
            URL,
            params=[("snapshot_id", SNAPSHOT)] + [("report_key", key) for key in keys],
        )
    )
    assert {r["Report key"] for r in rows if r["Row type"] == "Report"} == set(keys)


def test_plain_source_links_ignore_untrusted_host(finance_api, originals):
    rows = parsed(
        finance_api.get(
            URL, params={"snapshot_id": SNAPSHOT}, headers={"Host": "foreign.example"}
        )
    )
    urls = [r["Source URL"] for r in rows if r["Source URL"]]
    assert urls and all(
        url.startswith("https://alethicalfinance.com/elections/") for url in urls
    )
    assert all("token=" not in url and "foreign.example" not in url for url in urls)


def test_shared_account_with_different_report_attribution_keeps_money_once(
    finance_api, originals, monkeypatch
):
    original = finance.comparison

    def partial(*args, **kwargs):
        data = original(*args, **kwargs)
        other = deepcopy(data["candidates"][0]["accounts"])
        for account in other:
            for report in account["reports"]:
                report["figures"] = None
                report["attribution"] = "period_not_covered"
                report["figure_status"] = "unavailable"
        data["candidates"][1]["accounts"] = other
        return data

    monkeypatch.setattr(finance, "comparison", partial)
    rows = parsed(finance_api.get(URL, params={"snapshot_id": SNAPSHOT}))
    figures = [r for r in rows if r["Row type"] == "Figure"]
    assert len(figures) == 3 and {r["Candidate ID"] for r in figures} == {"a"}
    assert any(
        r["Row type"] == "Report association"
        and r["Candidate ID"] == "b"
        and r["State"] == "period_not_covered"
        for r in rows
    )


def test_unselected_report_original_is_not_read(finance_api, finance_db, originals):
    prior = finance_db.scalar(
        select(m.CampaignFinanceReportDocument).where(
            m.CampaignFinanceReportDocument.report_type == "P"
        )
    )
    originals.objects[prior.object_key] = b"broken unselected original"
    assert finance_api.get(URL, params={"snapshot_id": SNAPSHOT}).status_code == 200
    response = finance_api.get(
        URL, params=[("snapshot_id", SNAPSHOT), ("report_key", "2" * 64)]
    )
    assert response.status_code == 503


def test_no_records_still_requires_original_bytes(finance_api, finance_db, originals):
    # Preserve source count and release, but no row refers to this checked account.
    for row in finance_db.scalars(select(finance.R)):
        row.affected_committee_reg_num = "unrelated"
    finance_db.commit()
    rows = parsed(finance_api.get(URL, params={"snapshot_id": SNAPSHOT}))
    assert any(
        r["Row type"] == "Outside availability" and r["Record count"] == "0"
        for r in rows
    )
    originals.objects["private/retained/outside.gz"] = b"corrupt"
    assert finance_api.get(URL, params={"snapshot_id": SNAPSHOT}).status_code == 503


def test_review_change_during_precinct_export_refuses_mixed_csv(
    finance_api, finance_db, originals, comparison, monkeypatch
):
    original = results.precincts
    done = False

    def changed(*args, **kwargs):
        nonlocal done
        page = original(*args, **kwargs)
        if not done:
            done = True
            reviews.record_decision(
                finance_db,
                **{
                    **comparison["args"],
                    "decision": "withdrawn",
                    "reason": "Private test withdrawal",
                    "expected_previous_id": comparison["decision"].id,
                },
            )
            finance_db.commit()
        return page

    monkeypatch.setattr(results, "precincts", changed)
    assert finance_api.get(URL, params={"snapshot_id": SNAPSHOT}).status_code == 409


def test_ambiguous_latest_external_never_picks_arbitrarily():
    assert (
        export._latest_external(
            [
                {"report_key": "a", "effective": True, "period_end": "2026-10-14"},
                {"report_key": "b", "effective": True, "period_end": "2026-10-14"},
            ]
        )
        is None
    )
    assert (
        export._latest_external(
            [
                {"report_key": "a", "effective": False, "period_end": "2026-10-14"},
                {"report_key": "b", "effective": True, "period_end": "2026-09-30"},
            ]
        )
        == "b"
    )


def test_external_adapter_failure_is_private_503(
    finance_api, external_originals, monkeypatch
):
    from alethical.pipeline.election_comparison import ComparisonImportError

    def unavailable():
        raise ComparisonImportError("PRIVATE adapter detail")

    monkeypatch.setattr(export, "register_external_adapters", unavailable)
    ctx = external_originals
    response = finance_api.get(
        f"/api/v1/finance/elections/{KEY}/races/{ctx.race.id}/export.csv",
        params={"snapshot_id": ctx.snapshot.id},
    )
    assert response.status_code == 503 and "PRIVATE" not in response.text


def test_export_limit_refuses_instead_of_truncating(
    finance_api, originals, monkeypatch
):
    monkeypatch.setattr(export, "MAX_BYTES", 100)
    response = finance_api.get(URL, params={"snapshot_id": SNAPSHOT})
    assert response.status_code == 503 and not response.text.startswith("Row type")
