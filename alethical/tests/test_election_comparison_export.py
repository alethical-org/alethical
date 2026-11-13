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
from alethical.pipeline import election_outcomes
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
from alethical.tests.test_election_finance_outcomes import reviewed_race

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


def test_precinct_paging_reuses_originals_but_final_check_is_fresh(
    finance_api, finance_db, reviewed_race, spending, monkeypatch
):
    _, _, store, request, _ = reviewed_race
    store.objects.update(spending.retained_store.objects)
    for module in (results, finance, outside):
        monkeypatch.setattr(module, "raw_file_store_from_env", lambda: store)
    decision = election_outcomes.record_decision(finance_db, **request())
    finance_db.commit()
    source = finance_db.get(m.ElectionResultSource, decision.evidence[0]["sha256"])
    key = source.object_key
    calls = []
    original_get = store.get

    def get(object_key, path, *, max_bytes=None):
        if object_key == key:
            calls.append(object_key)
        return original_get(object_key, path, max_bytes=max_bytes)

    monkeypatch.setattr(store, "get", get)
    first = parsed(finance_api.get(URL, params={"snapshot_id": SNAPSHOT}))
    assert any(r["Outcome"] == "elected" for r in first)
    single_page_reads = len(calls)
    assert single_page_reads > 1  # End checks must independently fetch the source.
    for i in range(105):
        _precinct(finance_db, key=f"01:{i + 10:04}", name=f"Precinct {i}", vote=i)
    finance_db.commit()
    calls.clear()
    rows = parsed(finance_api.get(URL, params={"snapshot_id": SNAPSHOT}))
    assert int(rows[0]["Matching precincts"]) > 100
    assert len(calls) == single_page_reads

    original_precincts = results.precincts

    def lose_source_after_last_page(*args, **kwargs):
        page = original_precincts(*args, **kwargs)
        if not page["page"]["has_more"]:
            store.objects.pop(key)
        return page

    monkeypatch.setattr(results, "precincts", lose_source_after_last_page)
    failed = finance_api.get(URL, params={"snapshot_id": SNAPSHOT})
    assert failed.status_code in (409, 503)
    assert not failed.text.startswith("Row type")


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


def test_aggregate_write_in_without_candidate_id_keeps_source_row(
    finance_api, finance_db, originals
):
    race = finance_db.get(m.ElectionComparisonRace, (SNAPSHOT, RACE))
    payload = deepcopy(race.payload)
    aggregate = next(c for c in payload["candidates"] if c["is_write_in_aggregate"])
    aggregate["votes"] = 189
    aggregate["candidate_id"] = None  # Real result aggregates have no candidacy ID.
    race.payload = payload
    _precinct(finance_db, key="01:0099", name="Write-in source precinct")
    precinct = finance_db.get(m.ElectionComparisonPrecinct, (SNAPSHOT, RACE, "01:0099"))
    precinct_payload = deepcopy(precinct.payload)
    precinct_payload["rows"][0]["candidate_id"] = "a"
    precinct_payload["rows"].append(
        {
            "row_number": 2,
            "candidate_id": None,
            "candidate_name": "WRITE-IN",
            "votes": 189,
        }
    )
    precinct.payload = precinct_payload
    finance_db.commit()

    rows = parsed(finance_api.get(URL, params={"snapshot_id": SNAPSHOT}))
    candidates = [r for r in rows if r["Row type"] == "Candidate"]
    assert len(candidates) == 3
    assert {r["Candidate ID"] for r in candidates} == {"a", "b", ""}
    named = {r["Candidate ID"]: r for r in candidates if r["Candidate ID"]}
    assert named["a"]["Candidate"] == "José Example"
    assert named["a"]["Candidate votes"] == "7"
    assert named["b"]["Candidate"] == "Another Candidate"
    assert named["b"]["Candidate votes"] == ""
    write_in = next(r for r in candidates if r["Candidate ID"] == "")
    assert write_in["Candidate"] == "WRITE-IN"
    assert write_in["Party"] == aggregate["party"]
    assert write_in["Candidate votes"] == "189"
    assert write_in["Vote status"] == "reported"
    assert write_in["Outcome"] == "" and write_in["Outcome status"] == "pending"
    aggregate_precincts = [
        r
        for r in rows
        if r["Row type"] == "Precinct candidate" and r["Candidate"] == "WRITE-IN"
    ]
    assert len(aggregate_precincts) == 1
    assert aggregate_precincts[0]["Candidate ID"] == ""
    assert aggregate_precincts[0]["Precinct votes"] == "189"
    assert aggregate_precincts[0]["Vote status"] == "reported"
    assert all(r["Candidate ID"] == "a" for r in rows if r["Row type"] == "Report")
    assert all(
        r["Candidate ID"] or r["Candidate"] == "WRITE-IN"
        for r in rows
        if r["Row type"] in {"Candidate", "Precinct candidate"}
    )


@pytest.mark.parametrize(
    "summary_count, aggregate_votes", [(1, 189), (2, 189), (0, 189), (1, None)]
)
def test_candidate_votes_keep_exact_summary_or_precinct_evidence(
    finance_api, finance_db, originals, summary_count, aggregate_votes
):
    from alethical.pipeline.election_comparison import archive_source

    snapshot = finance_db.get(m.ElectionComparisonSnapshot, SNAPSHOT)
    metadata = deepcopy(snapshot.sources)

    def original(body, filename):
        fingerprint = archive_source(finance_db, originals, body)
        metadata.append(
            {
                "file": filename,
                "url": "https://electionresultsfiles.sos.mn.gov/20261103/" + filename,
                "sha256": fingerprint,
                "bytes": len(body),
                "fetched_at": datetime(2026, 11, 11, tzinfo=UTC).isoformat(),
            }
        )
        return fingerprint

    precinct_hash = original(
        "WRITE-IN;80\nWRITE-IN;109\nJosé Example;3\nJosé Example;4\n".encode(),
        "precinct-vote-proof.txt",
    )
    summaries = [
        original(
            (f"Summary header {i}\nJosé Example;7\nWRITE-IN;189\n").encode(),
            f"race-summary-proof-{i}.txt",
        )
        for i in range(summary_count)
    ]
    snapshot.sources = metadata
    race = finance_db.get(m.ElectionComparisonRace, (SNAPSHOT, RACE))
    payload = deepcopy(race.payload)
    payload["source_sha256"] = precinct_hash
    for candidate in payload["candidates"]:
        if candidate["is_write_in_aggregate"]:
            candidate.update(
                candidate_id=None, votes=aggregate_votes, source_rows=[1, 2]
            )
            candidate["summary_sources"] = [
                {"source_sha256": fingerprint, "row_number": 3}
                for fingerprint in summaries
            ]
        elif candidate["candidate_id"] == "a":
            candidate["candidate_source_row"] = 1
            candidate["source_rows"] = [3, 4]
            candidate["summary_sources"] = [
                {"source_sha256": fingerprint, "row_number": 2}
                for fingerprint in summaries
            ]
    race.payload = payload
    finance_db.commit()

    rows = parsed(finance_api.get(URL, params={"snapshot_id": SNAPSHOT}))
    candidate_rows = {
        r["Candidate ID"]: r for r in rows if r["Row type"] == "Candidate"
    }
    assert candidate_rows["a"]["Source hash"] == SOURCE
    assert candidate_rows["a"]["Source row"] == "1"
    assert candidate_rows["a"]["Candidate votes"] == "7"
    assert candidate_rows["b"]["Candidate votes"] == ""
    aggregate = candidate_rows[""]
    assert aggregate["Candidate"] == "WRITE-IN"
    assert aggregate["Candidate votes"] == ("" if aggregate_votes is None else "189")
    assert aggregate["Outcome"] == "" and aggregate["Outcome status"] == "pending"
    if summary_count == 1:
        assert (aggregate["Source hash"], aggregate["Source row"]) == (
            summaries[0],
            "3",
        )
    else:
        assert (aggregate["Source hash"], aggregate["Source row"]) == (
            precinct_hash,
            "1; 2",
        )

    evidence = [
        r
        for r in rows
        if r["Row type"] == "Evidence" and r["Measure"] == "Candidate votes"
    ]
    assert not any(r["Candidate ID"] == "b" for r in evidence)
    for cid, name, value, summary_row, precinct_rows in [
        ("a", "José Example", "7", "2", "3; 4"),
        ("", "WRITE-IN", "189", "3", "1; 2"),
    ]:
        actual = [r for r in evidence if r["Candidate ID"] == cid]
        if cid == "" and aggregate_votes is None:
            assert actual == []
            continue
        expected = (
            {(fingerprint, summary_row) for fingerprint in summaries}
            if summaries
            else {(precinct_hash, precinct_rows)}
        )
        assert {(r["Source hash"], r["Source row"]) for r in actual} == expected
        assert len(actual) == len(expected)
        assert all(
            r["Candidate"] == name
            and r["Candidate votes"] == ""
            and r["Nonadditive"] == "Yes"
            for r in actual
        )
        assert all(f"snapshot_id={SNAPSHOT}" in r["Source URL"] for r in actual)
        if not summaries:
            assert {r["Note"] for r in actual} == {
                "Sum of the listed precinct source rows"
            }


@pytest.fixture()
def raw_order_precinct(finance_db, originals):
    """Synthetic fixture with the real SOS raw-row contract, not prejoined IDs."""
    race = finance_db.get(m.ElectionComparisonRace, (SNAPSHOT, RACE))
    payload = deepcopy(race.payload)
    rows = []
    for number, (candidate, order) in enumerate(
        zip(payload["candidates"], ("9001", "9002", "9901"), strict=True), 1
    ):
        candidate["candidate_order_code"] = order
        candidate["source_rows"] = [number]
        if candidate["is_write_in_aggregate"]:
            candidate["candidate_id"] = None
        rows.append(
            {
                "row_number": number,
                "candidate_order_code": order,
                "candidate_name": candidate["name"],
                "party": candidate["party"],
                "is_write_in_aggregate": candidate["is_write_in_aggregate"],
                "votes": number,
            }
        )
    race.payload = payload
    _precinct(finance_db, key="01:0042", name="Raw-order precinct")
    precinct = finance_db.get(m.ElectionComparisonPrecinct, (SNAPSHOT, RACE, "01:0042"))
    precinct.payload = {"source_sha256": SOURCE, "rows": rows}
    finance_db.commit()
    return race, precinct


@pytest.mark.parametrize("explicit_ids", [False, True])
def test_precinct_csv_joins_exact_race_source_order(
    finance_api, finance_db, raw_order_precinct, explicit_ids
):
    _, precinct = raw_order_precinct
    if explicit_ids:
        payload = deepcopy(precinct.payload)
        for row, cid in zip(payload["rows"], ("a", "b", None), strict=True):
            row.pop("candidate_order_code")
            row["candidate_id"] = cid
        precinct.payload = payload
        finance_db.commit()
    rows = parsed(finance_api.get(URL, params={"snapshot_id": SNAPSHOT}))
    rows = [r for r in rows if r["Row type"] == "Precinct candidate"]
    assert [(r["Candidate ID"], r["Candidate"], r["Precinct votes"]) for r in rows] == [
        ("a", "José Example", "1"),
        ("b", "Another Candidate", "2"),
        ("", "WRITE-IN", "3"),
    ]
    assert [r["Source row"] for r in rows] == ["1", "2", "3"]
    assert {r["Source hash"] for r in rows} == {SOURCE}


@pytest.mark.parametrize(
    "conflict",
    [
        "order",
        "name",
        "party",
        "aggregate",
        "source_row",
        "source_hash",
        "explicit_id",
        "duplicate_order",
    ],
)
def test_precinct_csv_refuses_conflicting_source_identity(
    finance_api, finance_db, raw_order_precinct, conflict
):
    race, precinct = raw_order_precinct
    payload = deepcopy(precinct.payload)
    row = payload["rows"][0]
    if conflict == "duplicate_order":
        race_payload = deepcopy(race.payload)
        race_payload["candidates"][1]["candidate_order_code"] = row[
            "candidate_order_code"
        ]
        race.payload = race_payload
    elif conflict == "source_hash":
        row["source_sha256"] = "f" * 64
    else:
        key, value = {
            "order": ("candidate_order_code", "9009"),
            "name": ("candidate_name", "Different Name"),
            "party": ("party", "OTHER"),
            "aggregate": ("is_write_in_aggregate", True),
            "source_row": ("row_number", 99),
            "explicit_id": ("candidate_id", "b"),
        }[conflict]
        row[key] = value
    precinct.payload = payload
    finance_db.commit()
    response = finance_api.get(URL, params={"snapshot_id": SNAPSHOT})
    assert response.status_code == 503
    assert not response.text.startswith("Row type")


def test_precinct_without_any_identity_key_does_not_join_by_name(
    finance_api, finance_db, raw_order_precinct
):
    _, precinct = raw_order_precinct
    payload = deepcopy(precinct.payload)
    for row in payload["rows"]:
        row.pop("candidate_order_code")
    precinct.payload = payload
    finance_db.commit()
    rows = parsed(finance_api.get(URL, params={"snapshot_id": SNAPSHOT}))
    rows = [r for r in rows if r["Row type"] == "Precinct candidate"]
    assert all(r["Candidate ID"] == "" for r in rows)
    assert [(r["Candidate"], r["Precinct votes"], r["Source row"]) for r in rows] == [
        ("José Example", "1", "1"),
        ("Another Candidate", "2", "2"),
        ("WRITE-IN", "3", "3"),
    ]
    assert all(
        r["Gap"] == "Candidate ID is not linked to this source row" for r in rows[:2]
    )
    assert rows[2]["Gap"] == ""


@pytest.mark.parametrize("shared_latest", [False, True])
def test_checked_group_defaults_span_candidate_entries_without_inventing_links(
    finance_api, finance_db, external_originals, monkeypatch, shared_latest
):
    # Adverse projection composition through the actual CSV route. The synthetic
    # group does not claim the source/version provider would admit these links.
    from alethical.api.services import election_external_finance_reads as external_reads

    ctx = external_originals
    second_id = "00000002"
    ctx.race.payload = deepcopy(ctx.race.payload)
    ctx.race.payload["candidates"].append(
        ctx.candidate
        | {
            "candidate_id": second_id,
            "name": "Second Example",
            "candidate_stable_id": "synthetic:second",
        }
    )
    finance_db.commit()
    base = external_reads.candidate_finance(
        finance_db,
        election_key=KEY,
        race_id=ctx.race.id,
        candidate_id=ctx.candidate["candidate_id"],
        store=ctx.store,
    )
    seed_report = next(r for r in base["reports"] if r["effective"] is True)
    original = external_reads._candidate_records

    def split(db, state, *, cache=None):
        entry = original(db, state, cache=cache)
        first = entry["candidate_id"] == ctx.candidate["candidate_id"]
        indexes = [1, 3] if first and shared_latest else [1] if first else [2, 3]
        entry["accounts"], entry["reports"], entry["payments"] = [], [], []
        for n in indexes:
            account = deepcopy(base["accounts"][0]) | {"account_id": f"C0000000{n}"}
            report = deepcopy(seed_report) | {
                "account_id": account["account_id"],
                "report_key": str(n) * 64,
                "period_end": ("2026-03-31", "2026-07-31", "2026-10-31")[n - 1],
                "selection_group_key": "local-selection:" + "a" * 64,
            }
            entry["accounts"].append(account)
            entry["reports"].append(report)
        return entry

    monkeypatch.setattr(external_reads, "_candidate_records", split)
    url = f"/api/v1/finance/elections/{KEY}/races/{ctx.race.id}/export.csv"
    rows = parsed(finance_api.get(url, params={"snapshot_id": ctx.snapshot.id}))
    reports = [r for r in rows if r["Row type"] == "Report"]
    assert [r["Report key"] for r in reports] == ["3" * 64]
    expected_ids = (
        {second_id, ctx.candidate["candidate_id"]} if shared_latest else {second_id}
    )
    assert set(reports[0]["Candidate ID"].split("; ")) == expected_ids
    rows = parsed(
        finance_api.get(
            url,
            params=[
                ("snapshot_id", ctx.snapshot.id),
                ("report_key", "1" * 64),
                ("report_key", "3" * 64),
            ],
        )
    )
    reports = [r for r in rows if r["Row type"] == "Report"]
    assert {r["Report key"] for r in reports} == {"1" * 64, "3" * 64}
    assert all(
        r["Overlapping selected reports"] and r["Nonadditive"] == "Yes" for r in reports
    )
