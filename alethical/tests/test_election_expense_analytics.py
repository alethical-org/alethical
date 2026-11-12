"""Source totals, distinct accounts, unknown fields and safe dated exports."""

# ruff: noqa: F811
from copy import deepcopy
from datetime import UTC, datetime
from decimal import Decimal
from types import SimpleNamespace
import csv
import gzip
import hashlib
import io
import json

import pytest
from fastapi import HTTPException

from alethical.api.services import election_expense_analytics as s
from alethical.tests.test_election_comparison_storage import MemoryStore

# Actual database reads exercise the generation/source version path, rather than
# substituting a typed expense payload as evidence.
from alethical.tests.finance_fixtures import finance_db  # noqa: F401,E402
from alethical.tests.test_election_finance_reads import comparison  # noqa: F401,E402
from alethical.tests.test_election_outside_spending import spending  # noqa: F401,E402
from alethical.tests.test_election_comparison_reads import BODY, KEY, SOURCE  # noqa: E402


def money(paid="10.00", unpaid="2.00", in_kind="3.00"):
    return dict(
        paid=paid,
        unpaid=unpaid,
        in_kind=in_kind,
        total=format(Decimal(paid) + Decimal(unpaid) + Decimal(in_kind), ".2f"),
    )


def payee(name="Example Print", state="MN"):
    return {
        "name": name,
        "address": {
            "lines": [f"Example City, {state} 55101"],
            "street": None,
            "city": "Example City",
            "state": state,
            "postal_code": "55101",
            "geography_status": "filed_us",
        },
        "source": [
            {
                "page": 3,
                "line": 5,
                "text": name,
                "source_sha256": "d" * 64,
                "private_path": "/secret",
            }
        ],
        "reviewed_by": "private-name",
    }


@pytest.fixture
def held():
    key = "a" * 64
    sha = "d" * 64
    loc = {
        "source_sha256": sha,
        "page": 3,
        "line": 8,
        "text": "Original payment line",
        "object_key": "private/object",
    }
    row = {
        "source_row_id": sha + ":3:8",
        "payee": payee(),
        "underlying_vendor": None,
        "relationship": "direct",
        "date": "2026-02-03",
        "raw_date": "02/03/2026",
        "purpose": "Printing: signs",
        "amounts": money(),
        "raw_amounts": money(),
        "source": [loc],
        "payee_header_source": loc,
        "uncertainties": ["payee_street_not_filed"],
    }
    p = {
        "filing": {
            "registration_number": "19399",
            "filing_year": 2026,
            "report_type": "E",
            "report_name": "2026 Pre-General",
            "cut_off_date": "2026-10-19",
            "special_election": False,
            "effective_amendment_index": 0,
            "amendment_count": 1,
        },
        "period_start": "2026-01-01",
        "period_end": "2026-10-19",
        "period_basis": "calendar_year_to_date",
        "figure_status": "source_verified",
        "figures": {
            "campaign_expenditures": {
                "cash": "11.00",
                "unpaid": "2.00",
                "in_kind": "3.00",
                "total": "16.00",
            },
            "public_subsidy_payments": {
                "cash": "0.00",
                "total": "0.00",
                "source_page": 2,
                "source_lines": [7],
                "review_reason": "private-reason",
            },
        },
        "document": {
            "sha256": sha,
            "url": "https://cfb.mn.gov/report",
            "local_file": "/private/original",
        },
        "catalogue_source": {"sha256": "c" * 64},
        "campaign_expenses": {
            "status": "checked",
            "rows": [row],
            "itemized_totals": money(),
            "non_itemized_totals": money("1.00", "0.00", "0.00"),
            "gaps": [],
        },
    }
    report = SimpleNamespace(
        report_key=key, registration_number="19399", document_hash=sha, payload=p
    )
    race = SimpleNamespace(
        id="race",
        jurisdiction="Minnesota",
        payload={
            "office_name": "Example Office",
            "district": "1",
            "candidate_source_sha256": "b" * 64,
            "candidates": [
                {
                    "candidate_id": "one",
                    "candidate_stable_id": "stable-one",
                    "name": "Example Candidate",
                    "party": "R",
                },
                {
                    "candidate_id": "two",
                    "candidate_stable_id": "stable-two",
                    "name": "Unmatched Candidate",
                    "party": "DFL",
                },
                {
                    "candidate_id": "write-in",
                    "name": "Write-in",
                    "party": None,
                    "is_write_in_aggregate": True,
                },
            ],
        },
    )
    account = {
        "registration_number": "19399",
        "decision_id": 45,
        "period_start": "2026-01-01",
        "period_end": "2026-10-19",
        "checked_on": "2026-11-12",
        "evidence": [
            {
                "kind": "committee_register",
                "sha256": "c" * 64,
                "reviewed_by": "private-name",
                "reason": "private-reason",
            }
        ],
    }
    context = {
        "schema_version": 1,
        "election_key": "mn-2026-11-03-general",
        "election_date": "2026-11-03",
        "collection_id": "e" * 64,
        "snapshot_id": "f" * 64,
        "version": "v1",
        "common_reporting_period": False,
        "_candidate_authorities": {"stable-one": "board", "stable-two": "federal"},
        "_read_stamp": ["private-decision-ids"],
    }
    return (
        context,
        [race],
        {("race", "one"): {"accounts": [account], "gaps": []}},
        {"19399": (report, "reported")},
        {sha: True, "c" * 64: True, "b" * 64: True},
    )


def test_report_keeps_full_denominator_and_independent_money_categories(held):
    data = s._assemble(*held)
    assert data["coverage"]["named_candidacies"] == 2
    assert data["coverage"]["scoped_candidacies_with_confirmed_accounts"] == 1
    assert data["candidates"][1]["filing_authority"] == "federal"
    summary = data["summary"]
    assert summary["source_report_totals"]["amounts"]["total"] == "16.00"
    assert summary["baseline_checked_itemized_detail"]["amounts"]["total"] == "15.00"
    assert summary["non_itemized_on_checked_detail_reports"]["total"] == "1.00"
    assert summary["public_subsidy_receipts"]["amount"] == "0.00"
    assert summary["public_subsidy_receipts"]["by_party"]["DFL"]["amount"] is None
    assert summary["source_report_totals"]["by_party"]["DFL"]["amounts"] is None
    assert summary["subsidy_tracing"] is False
    assert data["account_reports"][0]["filing"]["effective_amendment_index"] == 0
    assert (
        "/finance/sources/"
        in data["account_reports"][0]["source"]["retained_source_url"]
    )
    assert data["payments"][0]["uncertainties"] == ["payee_street_not_in_source"]
    public = json.dumps(data)
    for private in (
        "private-name",
        "private-reason",
        "private/object",
        "/secret",
        "/private/original",
        "decision_id",
        "_read_stamp",
    ):
        assert private not in public


def test_exclusion_changes_checked_detail_only_and_keeps_baseline(held):
    first = s._assemble(*held)
    pid = first["payees"][0]["payee_id"]
    value = s._assemble(*held, excluded_payee_ids=[pid])
    assert (
        value["summary"]["source_report_totals"]
        == first["summary"]["source_report_totals"]
    )
    assert (
        value["summary"]["baseline_checked_itemized_detail"]["amounts"]["paid"]
        == "10.00"
    )
    assert (
        value["summary"]["adjusted_checked_itemized_detail"]["amounts"]["paid"]
        == "0.00"
    )
    assert value["summary"]["non_itemized_on_checked_detail_reports"]["paid"] == "1.00"
    assert value["payments"] == []
    assert value["filters"]["excluded_payee_ids"] == [pid]


def test_vendor_passthrough_never_replaces_reimbursed_payee_or_double_counts(held):
    row = held[3]["19399"][0].payload["campaign_expenses"]["rows"][0]
    row["relationship"] = "reimbursement"
    row["underlying_vendor"] = payee("Out of State Vendor", "CA")
    value = s._assemble(*held)
    assert value["payments"][0]["payee"]["name"] == "Example Print"
    assert value["payments"][0]["underlying_vendor"]["name"] == "Out of State Vendor"
    assert (
        value["summary"]["baseline_checked_itemized_detail"]["by_filed_address"]["MN"][
            "total"
        ]
        == "15.00"
    )
    assert (
        value["summary"]["baseline_checked_itemized_detail"]["by_filed_address"][
            "out_of_state"
        ]["total"]
        == "0.00"
    )
    assert len(value["payments"]) == 1


def test_unknown_payee_and_foreign_address_are_explicit_unknown(held):
    row = held[3]["19399"][0].payload["campaign_expenses"]["rows"][0]
    row["payee"] = None
    value = s._assemble(*held)
    assert value["payees"][0]["excludable"] is False
    assert value["payees"][0]["payee_id"] is None
    assert (
        value["summary"]["baseline_checked_itemized_detail"]["by_filed_address"][
            "unknown"
        ]["total"]
        == "15.00"
    )
    with pytest.raises(HTTPException):
        s._assemble(*held, excluded_payee_ids=["0" * 64])


def test_unnamed_payee_drilldown_stays_with_its_exact_report(monkeypatch):
    first, second, named = "a" * 64, "b" * 64, "c" * 64
    data = {
        "candidates": [],
        "payees": [],
        "filters": {},
        "payments": [
            {"record_id": "1", "report_key": first, "payee_id": None},
            {"record_id": "2", "report_key": second, "payee_id": None},
            {"record_id": "3", "report_key": first, "payee_id": named},
        ],
    }
    monkeypatch.setattr(s, "_build", lambda *a, **kw: deepcopy(data))
    result = s.payments(None, unnamed_report_key=first)
    assert [r["record_id"] for r in result["payments"]] == ["1"]
    assert result["page"]["total"] == 1
    assert result["filters"]["unnamed_report_key"] == first


@pytest.mark.parametrize(
    "kwargs",
    [
        {"unnamed_report_key": "bad"},
        {"unnamed_report_key": "a" * 64, "payee_id": "b" * 64},
    ],
)
def test_invalid_unnamed_selection_fails_before_source_reads(monkeypatch, kwargs):
    monkeypatch.setattr(
        s, "_build", lambda *a, **kw: pytest.fail("invalid selector read sources")
    )
    with pytest.raises(HTTPException) as error:
        s.payments(None, **kwargs)
    assert error.value.status_code == 422


def test_shared_account_contributes_once_across_claimed_candidates(held):
    held[1][0].payload["candidates"][1]["party"] = "R"
    held[2][("race", "two")] = deepcopy(held[2][("race", "one")])
    value = s._assemble(*held)
    assert len(value["account_reports"]) == 1
    assert len(value["account_reports"][0]["claims"]) == 2
    assert value["summary"]["source_report_totals"]["amounts"]["total"] == "16.00"
    assert len(value["payments"]) == 1


@pytest.mark.parametrize("failure", ["parent", "detail", "source", "legacy"])
def test_gaps_never_become_zero_or_drop_candidates(held, failure):
    p = held[3]["19399"][0].payload
    if failure == "parent":
        p["figure_status"] = "unavailable"
        p["figures"] = None
    elif failure == "detail":
        p["campaign_expenses"]["status"] = "unavailable"
        p["campaign_expenses"]["rows"] = []
    elif failure == "legacy":
        p.pop("campaign_expenses")
    else:
        held[4]["d" * 64] = False
    value = s._assemble(*held)
    assert value["coverage"]["named_candidacies"] == 2
    assert value["payments"] == []
    assert value["summary"]["baseline_checked_itemized_detail"]["amounts"] is None
    assert value["summary"]["withheld_detail_accounts"] == 1
    if failure in {"parent", "source"}:
        assert value["summary"]["source_report_totals"]["amounts"] is None
    else:
        assert value["summary"]["source_report_totals"]["amounts"]["total"] == "16.00"


def test_subsidy_gap_does_not_hide_checked_expenses(held):
    held[3]["19399"][0].payload["figures"].pop("public_subsidy_payments")
    value = s._assemble(*held)
    assert value["summary"]["public_subsidy_receipts"]["amount"] is None
    assert value["payments"][0]["amounts"]["total"] == "15.00"


def test_latest_different_series_same_cutoff_remains_ambiguous(held):
    first = held[3]["19399"][0]
    other = deepcopy(first)
    other.report_key = "1" * 64
    other.payload["filing"]["report_type"] = "H"
    other.payload["filing"]["effective_amendment_index"] = 9
    value, state = s._latest([first, other], datetime(2026, 11, 12, tzinfo=UTC))
    assert value is None and state == "ambiguous_latest_report"


def test_outside_review_interval_retains_candidate_with_period_gap(held):
    held[2][("race", "one")]["accounts"][0]["period_start"] = "2026-02-01"
    value = s._assemble(*held)
    assert value["account_reports"] == []
    assert value["candidates"][0]["gaps"][0]["state"] == "report_period_not_covered"
    assert value["summary"]["source_report_totals"]["amounts"] is None


@pytest.mark.parametrize(
    "changed",
    [
        {"candidate_id": "one"},
        {"party": "Republican"},
        {"geography": "CA"},
        {"excluded_payee_ids": ["alias:Google"]},
        {"limit": 0},
        {"offset": -1},
        {"limit": True},
        {"payee_query": "a" * 201},
    ],
)
def test_query_validation_precedes_any_storage_reads(changed):
    args = dict(
        race_id=None,
        candidate_id=None,
        party=None,
        geography=None,
        payee_query="",
        excluded_payee_ids=(),
        limit=50,
        offset=0,
    )
    with pytest.raises(HTTPException) as failure:
        s._validate_query(**(args | changed))
    assert failure.value.status_code == 422


def test_filtered_json_and_csv_exports_keep_dates_sources_and_safe_text(
    held, monkeypatch
):
    row = held[3]["19399"][0].payload["campaign_expenses"]["rows"][0]
    row["payee"]["name"] = "=FORMULA()"
    row["purpose"] = "  +FORMULA()"
    row["amounts"] = money("-10.00", "2.00", "3.00")
    monkeypatch.setattr(s, "_build", lambda *args, **kwargs: s._assemble(*held))
    body, filename = s.export(None, format="csv", election_key=held[0]["election_key"])
    records = list(csv.DictReader(io.StringIO(body)))
    payment = next(r for r in records if r["Row type"] == "Payment")
    assert payment["Payee"] == "'=FORMULA()" and payment["Purpose"] == "'  +FORMULA()"
    assert (
        payment["Payment paid USD"] == "-10.00"
        and payment["Payment total USD"] == "-5.00"
    )
    assert (
        payment["Period start"] == "2026-01-01"
        and payment["Period end"] == "2026-10-19"
    )
    assert payment["Source pages"] == "3" and "line 8" in payment["Source references"]
    metadata = {
        r["Metadata field"]: r["Metadata value"]
        for r in records
        if r["Row type"] == "Metadata"
    }
    assert metadata["Generated at"] and "Filter: candidate query" in metadata
    body, _ = s.export(None, format="json", election_key=held[0]["election_key"])
    data = json.loads(body)
    assert data["payments"][0]["payee"]["name"] == "=FORMULA()"
    assert data["payments"][0]["amounts"]["paid"] == "-10.00"
    assert filename.endswith(".csv")


def test_original_byte_check_detects_loss_and_equal_length_corruption_without_parser(
    monkeypatch,
):
    store = MemoryStore()
    body = b"%PDF-synthetic-source"
    compressed = gzip.compress(body, mtime=0)
    key = "private/document.gz"
    store.objects[key] = compressed
    row = SimpleNamespace(
        object_key=key,
        compression="gzip",
        compressed_byte_size=len(compressed),
        compressed_hash=hashlib.sha256(compressed).hexdigest(),
        byte_size=len(body),
        document_hash=hashlib.sha256(body).hexdigest(),
    )
    import alethical.pipeline.election_campaign_expenses as parser

    monkeypatch.setattr(
        parser,
        "extract_campaign_expenses",
        lambda *a, **kw: pytest.fail("read reparsed PDF"),
    )
    assert s._restore_one(store, "document", row)
    store.objects[key] = compressed[:-1] + bytes([compressed[-1] ^ 1])
    assert not s._restore_one(store, "document", row)
    store.objects.pop(key)
    assert not s._restore_one(store, "document", row)


def retained_read_store(db, comparison):
    from alethical.db import models as m

    store = MemoryStore()
    source = db.get(m.ElectionResultSource, SOURCE)
    store.objects[source.object_key] = gzip.compress(BODY, mtime=0)
    doc = db.get(m.CampaignFinanceReportDocument, comparison["doc"][0])
    store.objects[doc.object_key] = comparison["doc"][2]
    return store, source, doc


def test_actual_read_version_changes_on_source_loss_without_reparsing(
    finance_db, comparison, monkeypatch
):
    store, source, doc = retained_read_store(finance_db, comparison)
    monkeypatch.setattr(s, "raw_file_store_from_env", lambda: store)
    import alethical.pipeline.election_campaign_expenses as parser

    monkeypatch.setattr(
        parser,
        "extract_campaign_expenses",
        lambda *a, **kw: pytest.fail("read parsed PDF"),
    )
    first = s.report(finance_db, election_key=KEY)
    assert first["summary"]["source_report_totals"]["amounts"]["total"] == "7.00"
    assert first["summary"]["baseline_checked_itemized_detail"]["amounts"] is None
    store.objects.pop(doc.object_key)
    second = s.report(finance_db, election_key=KEY)
    assert second["version"] != first["version"]
    assert (
        second["coverage"]["named_candidacies"]
        == first["coverage"]["named_candidacies"]
    )
    assert second["summary"]["source_report_totals"]["amounts"] is None
    with pytest.raises(HTTPException) as failure:
        s.report(finance_db, election_key=KEY, version=first["version"])
    assert failure.value.status_code == 409


def test_read_query_count_does_not_grow_with_unconfirmed_candidate_count(
    finance_db, comparison, monkeypatch, record_property
):
    from sqlalchemy import event

    store, _, _ = retained_read_store(finance_db, comparison)
    monkeypatch.setattr(s, "raw_file_store_from_env", lambda: store)
    statements = []

    def record(conn, cursor, statement, parameters, context, executemany):
        if statement.lstrip().upper().startswith("SELECT"):
            statements.append(statement)

    bind = finance_db.get_bind()
    event.listen(bind, "before_cursor_execute", record)
    try:
        s.report(finance_db, election_key=KEY)
        baseline = len(statements)
        statements.clear()
        race = comparison["race"]
        payload = deepcopy(race.payload)
        payload["candidates"].extend(
            {
                "candidate_id": f"extra-{n}",
                "name": f"Extra candidate {n}",
                "party": "DFL",
                "candidate_stable_id": None,
                "is_write_in_aggregate": False,
            }
            for n in range(1000)
        )
        race.payload = payload
        finance_db.flush()
        statements.clear()
        value = s.report(finance_db, election_key=KEY)
        assert value["coverage"]["named_candidacies"] == 1002
        record_property("baseline_selects", baseline)
        record_property("expanded_candidate_selects", len(statements))
        assert len(statements) <= baseline + 1
    finally:
        event.remove(bind, "before_cursor_execute", record)


def test_ballot_party_group_keeps_differing_board_party_explicit(held):
    account = held[2][("race", "one")]["accounts"][0]
    account.update(
        account_filed_party="DFL",
        account_party_evidence_state="available",
        register_party_source=[{"sha256": "c" * 64, "filed_party": "DFL"}],
    )
    value = s._assemble(*held)
    public = value["candidates"][0]["accounts"][0]
    assert (
        public["account_filed_party"] == "DFL" and public["party_values_differ"] is True
    )
    assert value["account_reports"][0]["party_group"] == "R"
    assert (
        value["summary"]["source_report_totals"]["by_party"]["R"]["amounts"]["total"]
        == "16.00"
    )


def test_mixed_ballot_parties_on_shared_account_are_unknown(held):
    held[2][("race", "two")] = deepcopy(held[2][("race", "one")])
    value = s._assemble(*held)
    assert value["account_reports"][0]["party_group"] == "unknown"
    assert (
        value["summary"]["source_report_totals"]["by_party"]["unknown"]["amounts"][
            "total"
        ]
        == "16.00"
    )


def test_dependency_trace_distinguishes_current_and_historical_evidence(held):
    base = dict(race_id="race", candidate_id="one", registration_number="19399")
    decisions = [
        SimpleNamespace(
            id=1, evidence=[{"kind": "report_cover", "sha256": "old"}], **base
        ),
        SimpleNamespace(
            id=2, evidence=[{"kind": "committee_register", "sha256": "current"}], **base
        ),
    ]
    trace = s._source_dependencies(decisions, held[3])
    uses = {row["sha256"]: row["uses"] for row in trace}
    assert uses["old"][0]["dependency"] == "historical_account_evidence"
    assert uses["current"][0]["dependency"] == "current_account_evidence"
    assert uses["d" * 64][0]["dependency"] == "selected_report"
    assert uses["c" * 64][0]["dependency"] == "selected_catalogue_source"
    assert "decision_id" not in json.dumps(trace)


def test_actual_source_trace_has_get_timings_and_public_dependency_uses(
    finance_db, comparison, monkeypatch
):
    store, _, _ = retained_read_store(finance_db, comparison)
    monkeypatch.setattr(s, "raw_file_store_from_env", lambda: store)
    trace = s.source_trace(finance_db, election_key=KEY)
    assert trace["max_workers"] == 4 and trace["availability_cache"] == "none"
    assert trace["original_gets"] and all(
        row["available"] for row in trace["original_gets"]
    )
    assert all(row["seconds"] >= 0 for row in trace["original_gets"])
    assert trace["dependencies"]
    assert not any(
        value in json.dumps(trace)
        for value in ("object_key", "reviewed_by", "reason", "decision_id")
    )


def test_filtered_source_trace_skips_other_candidates_current_and_history(
    finance_db, comparison, monkeypatch
):
    from alethical.db import models as m
    from alethical.pipeline.election_comparison import archive_source
    from datetime import date
    from uuid import uuid4

    store, _, _ = retained_read_store(finance_db, comparison)
    other = archive_source(finance_db, store, b"Other candidacy account evidence")
    finance_db.add(
        m.ElectionCampaignAccountDecision(
            request_key=uuid4().hex + uuid4().hex,
            authority="mn_cfb",
            election_key=KEY,
            race_id=comparison["race"].id,
            candidate_id="b",
            registration_number="other-account",
            decision="rejected",
            period_start=date(2026, 1, 1),
            period_end=date(2026, 10, 19),
            identity={},
            evidence=[{"kind": "candidate_identity", "sha256": other}],
            reason="Private reason",
            reviewed_by="Private reviewer",
            reviewed_at=datetime.now(UTC),
        )
    )
    finance_db.flush()
    monkeypatch.setattr(s, "raw_file_store_from_env", lambda: store)
    complete = s.source_trace(finance_db, election_key=KEY)
    scoped = s.source_trace(
        finance_db, election_key=KEY, race_id=comparison["race"].id, candidate_id="a"
    )
    assert other in {row["sha256"] for row in complete["original_gets"]}
    assert other not in {row["sha256"] for row in scoped["original_gets"]}
    assert other not in {row["sha256"] for row in scoped["dependencies"]}
    assert len(scoped["original_gets"]) < len(complete["original_gets"])
    data = s.report(
        finance_db, election_key=KEY, race_id=comparison["race"].id, candidate_id="a"
    )
    assert (
        data["coverage"]["named_candidacies"] == 2
        and data["coverage"]["scoped_candidacies"] == 1
    )


@pytest.mark.parametrize(
    "filters",
    [
        {},
        {"party": "R"},
        {"party": "DFL"},
        {"race_id": "race", "candidate_id": "one"},
        {"race_id": "race", "candidate_id": "two"},
    ],
)
def test_display_filter_never_reclassifies_a_mixed_shared_account(held, filters):
    held[2][("race", "two")] = deepcopy(held[2][("race", "one")])
    data = s._assemble(*held, **filters)
    assert data["account_reports"][0]["party_group"] == "unknown"
    assert (
        data["account_reports"][0]["party_classification_state"]
        == "mixed_ballot_parties"
    )
    assert data["summary"]["source_report_totals"]["by_party"]["R"]["amounts"] is None
    assert data["summary"]["source_report_totals"]["by_party"]["DFL"]["amounts"] is None
    assert (
        data["summary"]["source_report_totals"]["by_party"]["unknown"]["amounts"][
            "total"
        ]
        == "16.00"
    )


def test_np_stays_distinct_and_candidacy_counts_do_not_follow_shared_money(held):
    held[1][0].payload["candidates"][0]["party"] = "NP"
    data = s._assemble(*held)
    assert data["candidates"][0]["filed_party"] == "NP"
    assert data["summary"]["candidacy_counts_by_ballot_party"]["NP"] == 1
    assert (
        data["summary"]["source_report_totals"]["by_party"]["NP"]["amounts"]["total"]
        == "16.00"
    )
    held[1][0].payload["candidates"][0]["party"] = "R"
    held[2][("race", "two")] = deepcopy(held[2][("race", "one")])
    data = s._assemble(*held, party="R")
    assert data["summary"]["candidacy_counts_by_ballot_party"]["R"] == 1
    assert data["summary"]["candidacy_counts_by_ballot_party"]["unknown"] == 0
    assert (
        data["summary"]["party_classification"]["mixed_ballot_parties"]["accounts"] == 1
    )
    assert (
        "candidate_count"
        not in data["summary"]["source_report_totals"]["by_party"]["unknown"]
    )


def test_cross_race_membership_closure_source_loss_withdrawal_and_history(
    finance_db, comparison, monkeypatch
):
    from alethical.db import models as m
    from alethical.pipeline import election_account_reviews as reviews
    from alethical.pipeline.election_comparison import archive_source

    store, _, _ = retained_read_store(finance_db, comparison)
    original = comparison["race"]
    payload = deepcopy(original.payload)
    payload["candidates"] = [{**payload["candidates"][0], "party": "DFL"}]
    other = m.ElectionComparisonRace(
        snapshot_id=comparison["args"]["snapshot_id"],
        id="c" * 64,
        label="Other race",
        office_id="other",
        jurisdiction="88",
        result_status="unofficial",
        payload=payload,
    )
    finance_db.add(other)
    finance_db.flush()
    fingerprint = archive_source(
        finance_db, store, b"Checked same-person relationship source"
    )
    evidence = deepcopy(comparison["args"]["evidence"]) + [
        {
            "kind": "same_person",
            "sha256": fingerprint,
            "decision_ids": [comparison["decision"].id],
        }
    ]
    args = {
        **comparison["args"],
        "race_id": other.id,
        "identity": reviews.candidate_identity(other, payload["candidates"][0]),
        "evidence": evidence,
        "compatible_decision_ids": [comparison["decision"].id],
    }
    decision = reviews.record_decision(finance_db, **args)
    finance_db.flush()
    monkeypatch.setattr(s, "raw_file_store_from_env", lambda: store)
    filters = dict(election_key=KEY, race_id=original.id, candidate_id="a")
    first = s.report(finance_db, **filters)
    assert (
        first["account_reports"][0]["party_classification_state"]
        == "mixed_ballot_parties"
    )
    assert (
        len(first["account_reports"][0]["claims"]) == 2
        and len(first["account_reports"][0]["display_claims"]) == 1
    )
    trace = s.source_trace(finance_db, **filters)
    assert any(
        dep["sha256"] == fingerprint
        and any(use.get("race_id") == other.id for use in dep["uses"])
        for dep in trace["dependencies"]
    )
    source = finance_db.get(m.ElectionResultSource, fingerprint)
    kept = store.objects.pop(source.object_key)
    lost = s.report(finance_db, **filters)
    assert lost["version"] != first["version"]
    assert (
        lost["account_reports"][0]["party_classification_state"]
        == "membership_sources_unavailable"
    )
    assert lost["account_reports"][0]["party_group"] == "unknown"
    with pytest.raises(HTTPException) as failure:
        s.report(finance_db, **filters, version=first["version"])
    assert failure.value.status_code == 409
    store.objects[source.object_key] = kept
    reviews.record_decision(
        finance_db,
        **{
            **args,
            "decision": "withdrawn",
            "compatible_decision_ids": None,
            "expected_previous_id": decision.id,
        },
    )
    finance_db.flush()
    withdrawn = s.report(finance_db, **filters)
    assert withdrawn["version"] != first["version"]
    assert withdrawn["account_reports"][0]["party_group"] == "other"
    assert (
        withdrawn["account_reports"][0]["party_classification_state"]
        == "single_ballot_party"
    )
    trace = s.source_trace(finance_db, **filters)
    assert any(
        use["dependency"] == "historical_account_evidence"
        for dep in trace["dependencies"]
        for use in dep["uses"]
    )
    store.objects.pop(source.object_key)
    historical_loss = s.report(finance_db, **filters)
    assert historical_loss["version"] != withdrawn["version"]
    assert historical_loss["account_reports"][0]["party_group"] == "other"


def test_report_document_identity_loss_invalidates_version_without_byte_change(
    finance_db, comparison, monkeypatch
):
    store, _, doc = retained_read_store(finance_db, comparison)
    monkeypatch.setattr(s, "raw_file_store_from_env", lambda: store)
    first = s.report(finance_db, election_key=KEY)
    doc.amendment_index = 99
    finance_db.flush()
    second = s.report(finance_db, election_key=KEY)
    assert second["version"] != first["version"]
    assert second["summary"]["source_report_totals"]["amounts"] is None


def test_local_nonpartisan_party_cites_actual_result_rows_and_loss_stays_unassigned(
    held,
):
    race = held[1][0]
    candidate = race.payload["candidates"][0]
    candidate.update(
        party="NP",
        candidate_stable_id="local_cand:exact",
        summary_sources=[{"source_sha256": "f" * 64, "row_number": 9}],
    )
    held[4]["f" * 64] = True
    data = s._assemble(*held)
    sources = data["candidates"][0]["party_sources"]
    assert sources[0]["source_sha256"] == "f" * 64 and sources[0]["row_number"] == 9
    assert sources[0]["kind"] == "official_result" and sources[0]["party_value"] == "NP"
    assert all(
        source["source_sha256"] != race.payload["candidate_source_sha256"]
        for source in sources
    )
    assert data["account_reports"][0]["party_group"] == "NP"
    held[4]["f" * 64] = False
    lost = s._assemble(*held)
    assert lost["account_reports"][0]["party_group"] == "unknown"
    assert (
        lost["account_reports"][0]["party_classification_state"]
        == "membership_sources_unavailable"
    )
    assert lost["summary"]["candidacy_counts_by_ballot_party"]["NP"] == 1


def test_candidate_identity_gap_changes_version_even_if_source_pointer_is_unchanged(
    finance_db, comparison, monkeypatch
):
    store, _, _ = retained_read_store(finance_db, comparison)
    monkeypatch.setattr(s, "raw_file_store_from_env", lambda: store)
    first = s.report(finance_db, election_key=KEY)
    race = comparison["race"]
    payload = deepcopy(race.payload)
    payload["candidates"][0]["name"] = "Changed source identity"
    race.payload = payload
    finance_db.flush()
    changed = s.report(finance_db, election_key=KEY)
    assert changed["version"] != first["version"]
    with pytest.raises(HTTPException) as failure:
        s.report(finance_db, election_key=KEY, version=first["version"])
    assert failure.value.status_code == 409


@pytest.mark.parametrize("historical", [False, True])
def test_nonselected_review_cover_account_role_changes_version(
    finance_db, comparison, monkeypatch, historical
):
    from sqlalchemy import select

    from alethical.db import models as m
    from alethical.pipeline import election_account_reviews as reviews

    store, _, _ = retained_read_store(finance_db, comparison)
    prior = finance_db.scalar(
        select(m.CampaignFinanceReportDocument).where(
            m.CampaignFinanceReportDocument.report_type == "P",
            m.CampaignFinanceReportDocument.registration_number == "-101",
        )
    )
    body = b"%PDF-1.4\nSynthetic retained fixture P"
    assert hashlib.sha256(body).hexdigest() == prior.document_hash
    store.objects[prior.object_key] = gzip.compress(body, mtime=0)
    evidence = deepcopy(comparison["args"]["evidence"])
    evidence[-1]["sha256"] = prior.document_hash
    args = {
        **comparison["args"],
        "evidence": evidence,
        "expected_previous_id": comparison["decision"].id,
    }
    decision = reviews.record_decision(finance_db, **args)
    finance_db.flush()
    if historical:
        reviews.record_decision(
            finance_db,
            **{**comparison["args"], "expected_previous_id": decision.id},
        )
        finance_db.flush()
    monkeypatch.setattr(s, "raw_file_store_from_env", lambda: store)
    before = s.report(finance_db, election_key=KEY)
    prior.registration_number = "-999"
    finance_db.flush()
    after = s.report(finance_db, election_key=KEY)
    assert after["version"] != before["version"]
    with pytest.raises(HTTPException) as failure:
        s.report(finance_db, election_key=KEY, version=before["version"])
    assert failure.value.status_code == 409
    if historical:
        # The current reviewed cover still proves this account; history changes
        # the version without falsely withdrawing an intact current relationship.
        assert after["account_reports"][0]["figure_status"] == "checked"
        assert (
            next(c for c in after["candidates"] if c["candidate_id"] == "a")[
                "confirmed_account_count"
            ]
            == 1
        )
    else:
        assert after["account_reports"] == []
        assert (
            next(c for c in after["candidates"] if c["candidate_id"] == "a")[
                "confirmed_account_count"
            ]
            == 0
        )
        assert after["summary"]["source_report_totals"]["amounts"] is None


def test_candidate_name_search_and_exact_older_period_keep_full_denominator(
    finance_db, comparison, monkeypatch
):
    from alethical.db import models as m
    from alethical.tests.test_election_finance_reads import COLLECTION

    store, _, _ = retained_read_store(finance_db, comparison)
    old = finance_db.get(m.ElectionFinanceReport, (COLLECTION, "-101", "2" * 64))
    old_doc = finance_db.get(m.CampaignFinanceReportDocument, old.document_hash)
    body = b"%PDF-1.4\nSynthetic retained fixture P"
    assert hashlib.sha256(body).hexdigest() == old_doc.document_hash
    store.objects[old_doc.object_key] = gzip.compress(body, mtime=0)
    monkeypatch.setattr(s, "raw_file_store_from_env", lambda: store)
    name = comparison["race"].payload["candidates"][0]["name"]
    latest = s.report(finance_db, election_key=KEY)
    selected = s.report(
        finance_db,
        election_key=KEY,
        candidate_query=name.swapcase(),
        report_keys=["2" * 64],
    )
    assert (
        selected["coverage"]["named_candidacies"]
        == latest["coverage"]["named_candidacies"]
    )
    assert [c["name"] for c in selected["candidates"]] == [name]
    assert selected["account_reports"][0]["report_key"] == "2" * 64
    assert selected["account_reports"][0]["period_end"] == "2026-08-01"
    assert selected["filters"]["candidate_query"] == name.swapcase()
    assert selected["filters"]["report_keys"] == ["2" * 64]
    assert (
        s.report(finance_db, election_key=KEY, candidate_query="")["coverage"]
        == latest["coverage"]
    )
    with pytest.raises(HTTPException) as changed:
        s.report(
            finance_db,
            election_key=KEY,
            candidate_query=name,
            version=selected["version"],
            report_keys=["2" * 64],
        )
    assert changed.value.status_code == 409


@pytest.mark.parametrize("query", ["not present", "%", "_"])
def test_search_is_literal_and_empty_matches_keep_denominator(held, query):
    data = s._assemble(*held, candidate_query=query)
    assert data["coverage"]["named_candidacies"] == 2
    assert data["candidates"] == []
    assert data["summary"]["source_report_totals"]["amounts"] is None


def test_name_search_does_not_erase_nonmatching_shared_account_party(held):
    context, races, accounts, selected, available = deepcopy(held)
    accounts[("race", "two")] = deepcopy(accounts[("race", "one")])
    data = s._assemble(
        context, races, accounts, selected, available, candidate_query="EXAMPLE"
    )
    assert len(data["candidates"]) == 1
    assert len(data["account_reports"][0]["claims"]) == 2
    assert len(data["account_reports"][0]["display_claims"]) == 1
    assert (
        data["account_reports"][0]["party_classification_state"]
        == "mixed_ballot_parties"
    )


@pytest.mark.parametrize(
    "change",
    [
        "candidate_long",
        "candidate_NUL",
        "report_count",
        "report_format",
        "report_scalar",
    ],
)
def test_new_query_validation_precedes_storage(monkeypatch, change):
    args = (
        {"candidate_query": "x" * 201}
        if change == "candidate_long"
        else {"candidate_query": "bad\x00"}
        if change == "candidate_NUL"
        else {"report_keys": ["a" * 64] * 501}
        if change == "report_count"
        else {"report_keys": ["invalid"]}
        if change == "report_format"
        else {"report_keys": "a" * 64}
    )
    monkeypatch.setattr(
        s, "_load", lambda *a, **kw: pytest.fail("Invalid query reached reads")
    )
    with pytest.raises(HTTPException) as failure:
        s.report(None, election_key=KEY, **args)
    assert failure.value.status_code == 422


def test_effective_series_refuses_special_wrong_year_and_superseded_amendments(held):
    report = deepcopy(held[3]["19399"][0])
    old = deepcopy(report)
    old.report_key = "b" * 64
    current = deepcopy(report)
    current.report_key = "c" * 64
    current.payload["filing"]["effective_amendment_index"] = 1
    current.payload["figures"] = None
    special = deepcopy(report)
    special.report_key = "e" * 64
    special.payload["filing"]["special_election"] = True
    previous_year = deepcopy(report)
    previous_year.report_key = "f" * 64
    previous_year.payload["filing"]["filing_year"] = 2025
    options = s._effective_options(
        [old, current, special, previous_year], datetime(2026, 11, 12, tzinfo=UTC)
    )
    assert [r.report_key for r in options] == ["c" * 64]
    chosen, state = s._latest([old, current], datetime(2026, 11, 12, tzinfo=UTC))
    assert chosen.report_key == "c" * 64 and state == "unavailable"


def _period_store(db, comparison):
    from alethical.db import models as m
    from alethical.tests.test_election_finance_reads import COLLECTION

    store, source, current = retained_read_store(db, comparison)
    prior = db.get(m.ElectionFinanceReport, (COLLECTION, "-101", "2" * 64))
    document = db.get(m.CampaignFinanceReportDocument, prior.document_hash)
    body = b"%PDF-1.4\nSynthetic retained fixture P"
    assert hashlib.sha256(body).hexdigest() == document.document_hash
    store.objects[document.object_key] = gzip.compress(body, mtime=0)
    return store, current, document


def test_selected_original_loss_and_exports_never_fall_back_to_latest(
    finance_db, comparison, monkeypatch
):
    store, current, prior = _period_store(finance_db, comparison)
    monkeypatch.setattr(s, "raw_file_store_from_env", lambda: store)
    args = dict(
        election_key=KEY,
        report_keys=["2" * 64],
        candidate_query=comparison["race"].payload["candidates"][0]["name"],
    )
    first = s.report(finance_db, **args)
    options = first["report_options"][0]["reports"]
    assert {o["report_key"]: o["source_state"] for o in options} == {
        "1" * 64: "not_checked",
        "2" * 64: "available",
    }
    assert first["account_reports"][0]["figure_status"] == "checked"
    for format in ["json", "csv"]:
        body, _ = s.export(finance_db, **args, version=first["version"], format=format)
        if format == "json":
            data = json.loads(body)
            assert data["filters"]["report_keys"] == ["2" * 64]
            assert data["filters"]["candidate_query"] == args["candidate_query"]
            assert data["summary"]["periods"][0]["report_key"] == "2" * 64
        else:
            records = list(csv.DictReader(io.StringIO(body)))
            metadata = {
                r["Metadata field"]: r["Metadata value"]
                for r in records
                if r["Row type"] == "Metadata"
            }
            assert metadata["Filter: report keys"] == "2" * 64
            assert metadata["Filter: candidate query"] == args["candidate_query"]
            row = next(r for r in records if r["Row type"] == "Account report")
            assert (
                row["Report key"].lstrip("'") == "2" * 64
                and row["Period end"] == "2026-08-01"
            )
    store.objects.pop(prior.object_key)
    after = s.report(finance_db, **args)
    assert after["account_reports"][0]["report_key"] == "2" * 64
    assert after["account_reports"][0]["campaign_expenses"] is None
    assert after["summary"]["source_report_totals"]["amounts"] is None
    assert (
        next(o for o in after["report_options"][0]["reports"] if o["selected"])[
            "source_state"
        ]
        == "unavailable"
    )
    assert current.object_key in store.objects
    with pytest.raises(HTTPException) as error:
        s.report(finance_db, **args, version=first["version"])
    assert error.value.status_code == 409


@pytest.mark.parametrize(
    "bad",
    [
        "unknown",
        "duplicate_account",
        "out_of_scope",
        "unlinked",
        "special",
        "wrong_year",
        "superseded",
    ],
)
def test_explicit_selection_rejects_wrong_account_series_and_versions(
    finance_db, comparison, monkeypatch, bad
):
    from alethical.tests.test_election_finance_reads import (
        _fixture_reports,
        _publish_fixture_variant,
    )

    store, _, _ = _period_store(finance_db, comparison)
    monkeypatch.setattr(s, "raw_file_store_from_env", lambda: store)
    keys = ["f" * 64]
    query = ""
    if bad == "duplicate_account":
        keys = ["1" * 64, "2" * 64]
    elif bad == "out_of_scope":
        keys = ["1" * 64]
        query = "no such candidate"
    elif bad in {"special", "wrong_year", "superseded", "unlinked"}:
        reports = _fixture_reports(finance_db)
        extra = deepcopy(reports[0])
        extra["report_key"] = "3" * 64
        if bad == "special":
            extra["payload"]["filing"]["special_election"] = True
        elif bad == "wrong_year":
            extra["payload"]["filing"]["filing_year"] = 2025
        elif bad == "unlinked":
            extra["registration_number"] = "-999"
            extra["payload"]["filing"]["registration_number"] = "-999"
        else:
            extra["payload"]["filing"]["effective_amendment_index"] = 1
        reports.append(extra)
        _publish_fixture_variant(finance_db, coverage={"reports": 3}, reports=reports)
        keys = ["1" * 64] if bad == "superseded" else ["3" * 64]
    with pytest.raises(HTTPException) as error:
        s.report(finance_db, election_key=KEY, candidate_query=query, report_keys=keys)
    assert error.value.status_code == 422


def test_explicit_report_type_resolves_default_same_cutoff_ambiguity(
    finance_db, comparison, monkeypatch
):
    from alethical.tests.test_election_finance_reads import (
        _fixture_reports,
        _publish_fixture_variant,
    )

    store, _, _ = _period_store(finance_db, comparison)
    monkeypatch.setattr(s, "raw_file_store_from_env", lambda: store)
    reports = _fixture_reports(finance_db)
    extra = deepcopy(reports[0])
    extra["report_key"] = "3" * 64
    extra["payload"]["filing"]["report_type"] = "G"
    reports.append(extra)
    _publish_fixture_variant(finance_db, coverage={"reports": 3}, reports=reports)
    assert s.report(finance_db, election_key=KEY)["account_reports"] == []
    chosen = s.report(finance_db, election_key=KEY, report_keys=["1" * 64])
    assert chosen["account_reports"][0]["report_key"] == "1" * 64
    assert len(chosen["report_options"][0]["reports"]) == 3


def test_same_name_candidates_stay_distinct_in_stable_name_order(held):
    data = deepcopy(held)
    data[1][0].payload["candidates"][:2] = [
        {
            **data[1][0].payload["candidates"][0],
            "name": "Same Name",
            "candidate_id": "z",
        },
        {
            **data[1][0].payload["candidates"][1],
            "name": "Same Name",
            "candidate_id": "a",
        },
    ]
    first = s._assemble(*data, candidate_query="same")
    data[1][0].payload["candidates"].reverse()
    second = s._assemble(*data, candidate_query="same")
    assert (
        [c["candidate_id"] for c in first["candidates"]]
        == ["a", "z"]
        == [c["candidate_id"] for c in second["candidates"]]
    )


def test_search_sources_skip_unrelated_account_but_keep_shared_membership(
    finance_db, comparison, monkeypatch
):
    from alethical.db import models as m
    from alethical.pipeline import election_account_reviews as reviews
    from alethical.pipeline.election_comparison import archive_source

    store, _, _ = _period_store(finance_db, comparison)
    original = comparison["race"]
    payload = deepcopy(original.payload)
    payload["candidates"] = [
        {**payload["candidates"][0], "name": "Nonmatching candidacy", "party": "DFL"}
    ]
    other = m.ElectionComparisonRace(
        snapshot_id=comparison["args"]["snapshot_id"],
        id="c" * 64,
        label="Other race",
        office_id="other",
        jurisdiction="88",
        result_status="unofficial",
        payload=payload,
    )
    finance_db.add(other)
    finance_db.flush()
    fingerprint = archive_source(
        finance_db, store, b"Explicit shared-account relationship source"
    )
    evidence = deepcopy(comparison["args"]["evidence"]) + [
        {
            "kind": "same_person",
            "sha256": fingerprint,
            "decision_ids": [comparison["decision"].id],
        }
    ]
    args = {
        **comparison["args"],
        "race_id": other.id,
        "identity": reviews.candidate_identity(other, payload["candidates"][0]),
        "evidence": evidence,
        "compatible_decision_ids": [comparison["decision"].id],
    }
    decision = reviews.record_decision(finance_db, **args)
    finance_db.flush()
    monkeypatch.setattr(s, "raw_file_store_from_env", lambda: store)
    query = original.payload["candidates"][0]["name"]
    first = s.report(finance_db, election_key=KEY, candidate_query=query)
    assert len(first["candidates"]) == 1
    assert (
        first["account_reports"][0]["party_classification_state"]
        == "mixed_ballot_parties"
    )
    assert len(first["account_reports"][0]["claims"]) == 2
    trace = s.source_trace(
        finance_db, election_key=KEY, candidate_query=query, report_keys=["2" * 64]
    )
    assert any(x["sha256"] == fingerprint for x in trace["dependencies"])
    no_match = s.source_trace(
        finance_db, election_key=KEY, candidate_query="zz-no-match"
    )
    assert no_match["original_gets"] == []
    reviews.record_decision(
        finance_db,
        **{
            **args,
            "decision": "withdrawn",
            "compatible_decision_ids": None,
            "expected_previous_id": decision.id,
        },
    )
    finance_db.flush()
    with pytest.raises(HTTPException) as error:
        s.report(
            finance_db,
            election_key=KEY,
            candidate_query=query,
            version=first["version"],
        )
    assert error.value.status_code == 409


def test_report_selection_pin_invalidates_after_collection_or_account_changes(
    finance_db, comparison, monkeypatch
):
    from alethical.tests.test_election_finance_reads import (
        _fixture_reports,
        _publish_fixture_variant,
    )
    from alethical.pipeline import election_account_reviews as reviews

    store, _, _ = _period_store(finance_db, comparison)
    monkeypatch.setattr(s, "raw_file_store_from_env", lambda: store)
    args = dict(election_key=KEY, report_keys=["2" * 64])
    first = s.report(finance_db, **args)
    # Exact repeated keys remain a single selection and cannot double count money.
    assert (
        s.report(finance_db, election_key=KEY, report_keys=["2" * 64, "2" * 64])[
            "version"
        ]
        == first["version"]
    )
    _publish_fixture_variant(
        finance_db,
        coverage={"reports": 1},
        reports=[
            r for r in _fixture_reports(finance_db) if r["report_key"] == "1" * 64
        ],
    )
    with pytest.raises(HTTPException) as error:
        s.report(finance_db, **args, version=first["version"])
    assert error.value.status_code == 409
    with pytest.raises(HTTPException) as error:
        s.report(finance_db, **args)
    assert error.value.status_code == 422
    current = s.report(finance_db, election_key=KEY, report_keys=["1" * 64])
    reviews.record_decision(
        finance_db,
        **{
            **comparison["args"],
            "decision": "withdrawn",
            "expected_previous_id": comparison["decision"].id,
        },
    )
    finance_db.flush()
    with pytest.raises(HTTPException) as error:
        s.report(
            finance_db,
            election_key=KEY,
            report_keys=["1" * 64],
            version=current["version"],
        )
    assert error.value.status_code == 409


def test_csv_has_plain_cells_and_disjoint_money_columns(held, monkeypatch):
    monkeypatch.setattr(s, "_build", lambda *a, **kw: s._assemble(*held))
    body, _ = s.export(None, format="csv", election_key=KEY)
    rows = list(csv.DictReader(io.StringIO(body)))
    assert "Row type" in rows[0] and "Metadata field" in rows[0]
    assert not {"context", "detail", "filed_address", "source"} & rows[0].keys()
    payment = next(r for r in rows if r["Row type"] == "Payment")
    assert payment["Payment total USD"] == "15.00"
    assert payment["Report total USD"] == payment["Payee baseline total USD"] == ""
    report = next(r for r in rows if r["Row type"] == "Account report")
    assert (
        report["Report total USD"] == "16.00" and report["Public subsidy USD"] == "0.00"
    )
    assert report["Payment total USD"] == report["Payee baseline total USD"] == ""


def _csv_test_rows(held, monkeypatch, **filters):
    monkeypatch.setattr(
        s,
        "_build",
        lambda *a, **kw: s._assemble(*held, _csv=kw.get("_csv", False), **filters),
    )
    body, _ = s.export(None, format="csv", election_key=KEY)
    return list(csv.DictReader(io.StringIO(body))), body


def test_csv_baseline_adjusted_geography_and_subsidy_reconcile_without_double_counting(
    held, monkeypatch
):
    report = held[3]["19399"][0].payload
    extra = deepcopy(report["campaign_expenses"]["rows"][0])
    extra["source_row_id"] = "d" * 64 + ":3:10"
    extra["amounts"] = money("20.02", "0.00", "0.00")
    extra["payee"] = payee("Other Vendor", "CA")
    extra["purpose"] = "Other purpose"
    report["campaign_expenses"]["rows"].append(extra)
    report["figures"]["public_subsidy_payments"].update(cash="7.65", total="7.65")
    excluded = s._payee_id(report["campaign_expenses"]["rows"][0]["payee"])
    rows, _ = _csv_test_rows(
        held,
        monkeypatch,
        excluded_payee_ids=[excluded],
        geography="out_of_state",
        payee_query="Other",
    )

    def amount(column, subset=rows):
        return sum((Decimal(row[column]) for row in subset if row[column]), Decimal(0))

    assert amount("Payee baseline total USD") == Decimal("35.02")
    assert amount("Payee after exclusions total USD") == Decimal("20.02")
    assert amount("Payment total USD") == Decimal("35.02")
    visible = [row for row in rows if row["Included in filtered view"] == "Yes"]
    assert amount("Payment total USD", visible) == Decimal("20.02")
    assert amount("Public subsidy USD") == Decimal("7.65")
    assert amount("Report total USD") == Decimal("16.00")
    assert amount("Non-itemized total USD") == Decimal("1.00")
    assert amount("Account count") == 1 and amount("Candidate count") == 2
    excluded_rows = [
        row
        for row in rows
        if row["Row type"] == "Payee summary" and row["Excluded payee"] == "Yes"
    ]
    assert (
        len(excluded_rows) == 1
        and excluded_rows[0]["Payee after exclusions total USD"] == ""
    )
    assert excluded_rows[0]["Filed geography"] == "Minnesota"
    assert (
        next(row for row in visible if row["Row type"] == "Payment")["Filed geography"]
        == "Out of state"
    )
    # Every money family belongs to one explicit row type, so summing a column
    # cannot add source totals, grouped payees and their payment detail together.
    owners = {
        "Report": "Account report",
        "Non-itemized": "Account report",
        "Payee baseline": "Payee summary",
        "Payee after exclusions": "Payee summary",
        "Payment": "Payment",
    }
    for row in rows:
        for family, owner in owners.items():
            for column in s.COLUMNS:
                key = f"{family} {column.replace('_', '-')} USD"
                assert not row[key] or row["Row type"] == owner
        assert not row["Public subsidy USD"] or row["Row type"] == "Account report"
    assert len(rows[0]) == len(s._CSV_COLUMNS) == len(set(s._CSV_COLUMNS))


@pytest.mark.parametrize(
    "party,label",
    [
        ("R", "Republican"),
        ("DFL", "Democratic-Farmer-Labor"),
        ("NP", "Nonpartisan"),
        ("GP", "Other parties"),
        (None, "Unknown party"),
    ],
)
def test_csv_preserves_literal_and_grouped_parties(held, monkeypatch, party, label):
    held[1][0].payload["candidates"][0]["party"] = party
    rows, _ = _csv_test_rows(held, monkeypatch)
    candidate = next(
        row
        for row in rows
        if row["Row type"] == "Candidate" and row["Candidate ID"] == "one"
    )
    report = next(row for row in rows if row["Row type"] == "Account report")
    assert (
        candidate["Official party"] == (party or "")
        and candidate["Official party group"] == label
    )
    assert report["Account party group"] == label


def test_csv_shared_account_governing_memberships_survive_search_without_reallocation(
    held, monkeypatch
):
    held[2][("race", "two")] = deepcopy(held[2][("race", "one")])
    held[2][("race", "one")]["accounts"][0]["account_filed_party"] = "DFL"
    held[2][("race", "two")]["accounts"][0]["account_filed_party"] = "R"
    rows, _ = _csv_test_rows(held, monkeypatch, candidate_query="Example")
    reports = [row for row in rows if row["Row type"] == "Account report"]
    assert len(reports) == 1 and reports[0]["Account count"] == "1"
    assert reports[0]["Account party group"] == "Party cannot be assigned"
    assert reports[0]["Party assignment"] == "Shared account, different ballot parties"
    assert "Unmatched Candidate (DFL" in reports[0]["Governing candidates"]
    assert reports[0]["Displayed candidates"] == "Example Candidate"
    assert set(reports[0]["Account filed party"].splitlines()) == {"R", "DFL"}
    assert (
        sum(int(row["Candidate count"]) for row in rows if row["Candidate count"]) == 1
    )
    assert (
        sum(Decimal(row["Report total USD"]) for row in rows if row["Report total USD"])
        == 16
    )


@pytest.mark.parametrize("gap", ["detail", "subsidy", "source"])
def test_csv_missing_amounts_stay_blank_with_independent_statuses(
    held, monkeypatch, gap
):
    payload = held[3]["19399"][0].payload
    if gap == "detail":
        payload["campaign_expenses"]["status"] = "withheld"
    elif gap == "subsidy":
        payload["figures"].pop("public_subsidy_payments")
    else:
        held[4]["d" * 64] = False
    rows, _ = _csv_test_rows(held, monkeypatch)
    report = next(row for row in rows if row["Row type"] == "Account report")
    if gap == "source":
        assert report["Report total USD"] == report["Public subsidy USD"] == ""
    else:
        assert report["Report total USD"] == "16.00"
    if gap == "subsidy":
        assert (
            report["Public subsidy USD"] == ""
            and report["Subsidy status"] == "unavailable"
        )
    elif gap == "detail":
        assert (
            report["Public subsidy USD"] == "0.00"
            and report["Detail status"] == "unavailable"
        )
        assert report["Non-itemized total USD"] == ""
        assert not any(row["Row type"] in {"Payment", "Payee summary"} for row in rows)
    else:
        assert report["Figure status"] == "unavailable"


def test_csv_flat_sources_addresses_vendor_and_all_text_are_injection_safe(
    held, monkeypatch
):
    payload = held[3]["19399"][0].payload
    row = payload["campaign_expenses"]["rows"][0]
    row["payee"]["name"] = "=FORMULA()"
    row["payee"]["address"].update(
        street="  @street", city="+city", postal_code="02101", lines=["=address"]
    )
    row["purpose"] = "\t=purpose"
    row["source"][0]["text"] = "=source text"
    row["underlying_vendor"] = payee("+vendor", "CA")
    row["relationship"] = "reimbursement"
    row["amounts"] = money("-10.00", "2.00", "3.00")
    rows, body = _csv_test_rows(held, monkeypatch)
    payment = next(r for r in rows if r["Row type"] == "Payment")
    assert payment["Payee"] == "'=FORMULA()" and payment["Filed street"] == "'  @street"
    assert payment["Filed city"] == "'+city" and payment["Filed address"] == "'=address"
    assert payment["Filed postal code"] == "'02101"
    assert payment["Purpose"] == "'\t=purpose" and payment["Source text"].startswith(
        "'=source text"
    )
    assert (
        payment["Underlying vendor"] == "'+vendor"
        and payment["Relationship"] == "reimbursement"
    )
    assert (
        payment["Payment paid USD"] == "-10.00"
        and payment["Payment total USD"] == "-5.00"
    )
    assert payment["Source URL"].startswith("https://alethicalfinance.com/elections/")
    assert (
        "page 3" in payment["Source references"]
        and "line 5" in payment["Source references"]
        and "line 8" in payment["Source references"]
    )
    assert not any(
        secret in body
        for secret in ["private-name", "private-reason", "/secret", "private/object"]
    )
    # JSON still retains original values and its accepted structure, without the
    # CSV-only baseline/account internals or safety apostrophes.
    data = json.loads(s.export(None, format="json", election_key=KEY)[0])
    assert data["payments"][0]["payee"]["name"] == "=FORMULA()"
    assert not any(key.startswith("_csv") for key in data)


def test_csv_unknown_payee_and_address_are_explicit_without_an_exclusion_alias(
    held, monkeypatch
):
    held[3]["19399"][0].payload["campaign_expenses"]["rows"][0]["payee"] = None
    rows, _ = _csv_test_rows(held, monkeypatch)
    payment = next(row for row in rows if row["Row type"] == "Payment")
    assert payment["Payee"] == payment["Payee ID"] == ""
    assert (
        payment["Payee status"] == "Payee not shown"
        and payment["Filed address status"] == "Address not shown"
    )
    assert payment["Filed geography"] == "Unknown" and payment["Excluded payee"] == "No"


def test_csv_actual_selected_report_uses_one_build_and_no_extra_original_reads(
    finance_db, comparison, monkeypatch
):
    store, _, _ = _period_store(finance_db, comparison)
    monkeypatch.setattr(s, "raw_file_store_from_env", lambda: store)
    get = store.get
    gets = []

    def counted_get(key, *args, **kwargs):
        gets.append(key)
        return get(key, *args, **kwargs)

    monkeypatch.setattr(store, "get", counted_get)
    original = s._build
    builds = []

    def counted_build(*args, **kwargs):
        builds.append(kwargs.get("_csv", False))
        return original(*args, **kwargs)

    monkeypatch.setattr(s, "_build", counted_build)
    args = dict(election_key=KEY, report_keys=["2" * 64])
    json_data = json.loads(s.export(finance_db, format="json", **args)[0])
    json_gets = list(gets)
    builds.clear()
    gets.clear()
    body, _ = s.export(
        finance_db,
        format="csv",
        version=json_data["version"],
        **args,
    )
    assert builds == [True]
    assert sorted(gets) == sorted(json_gets) and len(gets) == len(set(gets)) > 0
    rows = list(csv.DictReader(io.StringIO(body)))
    report = next(r for r in rows if r["Row type"] == "Account report")
    assert (
        report["Report key"].lstrip("'") == "2" * 64
        and report["Period end"] == "2026-08-01"
    )
    assert report["Source URL"].startswith("https://alethicalfinance.com/elections/")
    assert not any(key.startswith("_csv") for key in json_data)


def test_csv_keeps_numeric_candidate_identifiers_exact_and_payees_first(
    held, monkeypatch
):
    held[1][0].payload["candidates"][0]["candidate_id"] = "00001234"
    held[2][("race", "00001234")] = held[2].pop(("race", "one"))
    rows, _ = _csv_test_rows(held, monkeypatch)
    assert rows[0]["Row type"] == "Metadata" and rows[1]["Row type"] == "Payee summary"
    candidate = next(
        r
        for r in rows
        if r["Row type"] == "Candidate" and r["Candidate"] == "Example Candidate"
    )
    assert candidate["Candidate ID"] == "'00001234"
    data = json.loads(s.export(None, format="json", election_key=KEY)[0])
    assert data["candidates"][0]["candidate_id"] == "00001234"


def test_csv_official_result_party_source_keeps_its_own_hash_and_row(held, monkeypatch):
    candidate = held[1][0].payload["candidates"][0]
    candidate.update(
        party="NP",
        candidate_stable_id="local_cand:example",
        summary_sources=[{"source_sha256": "f" * 64, "row_number": 9}],
    )
    held[4]["f" * 64] = True
    rows, _ = _csv_test_rows(held, monkeypatch)
    candidate_row = next(
        r
        for r in rows
        if r["Row type"] == "Candidate" and r["Candidate"] == "Example Candidate"
    )
    assert candidate_row["Official party"] == "NP"
    assert (
        "official result" in candidate_row["Source references"]
        and "row number 9" in candidate_row["Source references"]
    )
    assert (
        "https://alethicalfinance.com/elections/" in candidate_row["Source references"]
    )
    assert "f" * 64 in candidate_row["Source references"]


@pytest.mark.parametrize(
    "filters",
    [{"candidate_query": "Example"}, {"race_id": "race", "candidate_id": "one"}],
)
def test_csv_shared_account_label_uses_all_governing_memberships(
    held, monkeypatch, filters
):
    held[2][("race", "two")] = deepcopy(held[2][("race", "one")])
    rows, _ = _csv_test_rows(held, monkeypatch, **filters)
    financial = [
        r
        for r in rows
        if r["Row type"] in {"Account report", "Payee summary", "Payment"}
    ]
    assert financial
    assert all(r["Displayed candidates"] == "Example Candidate" for r in financial)
    assert all("Unmatched Candidate" in r["Governing candidates"] for r in financial)
    assert all(r["Candidate"] == "Shared campaign account" for r in financial)


def test_csv_source_links_use_trusted_app_origin_and_exact_pins(held, monkeypatch):
    from urllib.parse import urlsplit, parse_qs

    rows, _ = _csv_test_rows(held, monkeypatch)
    for row in rows:
        if row["Row type"] not in {
            "Account report",
            "Candidate",
            "Payment",
            "Payee summary",
        }:
            continue
        parsed = urlsplit(row["Source URL"])
        assert parsed.scheme == "https" and parsed.netloc == "alethicalfinance.com"
        assert parsed.path == f"/elections/{KEY}/sources/{row['Source SHA256']}"
        query = parse_qs(parsed.query)
        if row["Row type"] == "Candidate":
            assert query == {
                "kind": ["election"],
                "snapshot_id": [held[0]["snapshot_id"]],
            }
        else:
            assert query == {
                "kind": ["report"],
                "collection_id": [held[0]["collection_id"]],
            }


@pytest.mark.parametrize(
    "status", ["checked", "partial", "withheld", "missing", "source_unavailable"]
)
def test_account_checked_detail_totals_preserve_exclusions_and_availability(
    held, status
):
    payload = held[3]["19399"][0].payload
    original = deepcopy(payload)
    excluded = s._payee_id(payload["campaign_expenses"]["rows"][0]["payee"])
    if status == "missing":
        payload.pop("campaign_expenses")
    elif status == "source_unavailable":
        held[4]["d" * 64] = False
    else:
        payload["campaign_expenses"]["status"] = status
    held[2][("race", "two")] = deepcopy(held[2][("race", "one")])
    filters = {"excluded_payee_ids": [excluded]} if status == "checked" else {}
    data = s._assemble(
        *held,
        candidate_query="Example",
        geography="out_of_state",
        payee_query="not a match",
        **filters,
    )
    assert len(data["account_reports"]) == 1
    report = data["account_reports"][0]
    assert report["checked_detail_before_exclusions"] == (
        money() if status == "checked" else None
    )
    assert report["checked_detail_after_exclusions"] == (
        money("0.00", "0.00", "0.00") if status == "checked" else None
    )
    assert report["campaign_expenses"] == (
        None if status == "source_unavailable" else money("11.00", "2.00", "3.00")
    )
    if status == "checked":
        assert (
            report["non_itemized_totals"]
            == original["campaign_expenses"]["non_itemized_totals"]
        )
        assert report["public_subsidy"]["total"] == "0.00"
        assert report["party_classification_state"] == "mixed_ballot_parties"
        assert data["payments"] == []


def test_account_known_empty_checked_detail_is_zero_not_unavailable(held):
    detail = held[3]["19399"][0].payload["campaign_expenses"]
    detail["rows"] = []
    detail["itemized_totals"] = money("0.00", "0.00", "0.00")
    report = s._assemble(*held)["account_reports"][0]
    assert report["checked_detail_before_exclusions"] == detail["itemized_totals"]
    assert report["checked_detail_after_exclusions"] == detail["itemized_totals"]


def test_selected_exclusions_keep_full_baseline_and_account_portions(held):
    first = held[3]["19399"][0]
    second = deepcopy(first)
    second.report_key = "e" * 64
    second.registration_number = "19400"
    second.payload["filing"]["registration_number"] = "19400"
    second.payload["campaign_expenses"]["rows"][0]["amounts"] = money(
        "1.01", "0.00", "0.00"
    )
    held[3]["19400"] = (second, "reported")
    account = deepcopy(held[2][("race", "one")]["accounts"][0])
    account["registration_number"] = "19400"
    held[2][("race", "one")]["accounts"].append(account)
    held[2][("race", "two")] = deepcopy(held[2][("race", "one")])
    pid = s._payee_id(first.payload["campaign_expenses"]["rows"][0]["payee"])
    data = s._assemble(
        *held,
        candidate_query="Example",
        payee_query="no match",
        geography="out_of_state",
        excluded_payee_ids=[pid],
    )
    assert data["payees"] == [] and data["payments"] == []
    assert len(data["excluded_payees"]) == 1
    item = data["excluded_payees"][0]
    assert item["payee_id"] == pid and item["payee"]["name"] == "Example Print"
    assert item["amounts"] == money("11.01", "2.00", "3.00")
    assert item["payment_count"] == 2
    assert [a["registration_number"] for a in item["account_reports"]] == [
        "19399",
        "19400",
    ]
    assert [a["amounts"] for a in item["account_reports"]] == [
        money(),
        money("1.01", "0.00", "0.00"),
    ]
    assert all(len(a["claims"]) == 2 for a in item["account_reports"])
    assert all(a["period_end"] == "2026-10-19" for a in item["account_reports"])
    assert all(
        a["checked_detail_after_exclusions"] == money("0.00", "0.00", "0.00")
        for a in data["account_reports"]
    )
    assert "private-name" not in json.dumps(item) and "/secret" not in json.dumps(item)
    with pytest.raises(HTTPException) as error:
        s._assemble(*held, excluded_payee_ids=["0" * 64])
    assert error.value.status_code == 422


@pytest.mark.parametrize(
    "bad",
    [
        "https://attacker.invalid/api/v1/finance/elections/{key}/finance/sources/{source}?collection_id={pin}",
        "//attacker.invalid/api/v1/finance/elections/{key}/finance/sources/{source}?collection_id={pin}",
        "javascript:alert(1)",
        "/api/v1/finance/private?collection_id={pin}",
        "/api/v1/finance/elections/{key}/finance/sources/{source}?snapshot_id={pin}",
        "/api/v1/finance/elections/{key}/finance/sources/{source}?collection_id={pin}&collection_id={pin}",
        "/api/v1/finance/elections/{key}/finance/sources/{source}?collection_id={pin}&url=https://attacker.invalid",
        "/api/v1/finance/elections/{key}/finance/sources/{source}?collection_id={pin}#fragment",
        "/api/v1/finance/elections/{key}/sources/{source}/raw?snapshot_id={pin}",
        "/api/v1/finance/elections/{key}/finance/sources/{source}",
        "/api/v1/finance/elections/{key}/finance/sources/{source}?collection_id=bad",
    ],
)
def test_csv_app_source_links_refuse_noncanonical_scope(bad):
    assert s._csv_source_url(bad.format(key=KEY, source="a" * 64, pin="b" * 64)) is None


def test_csv_raw_source_links_preserve_finance_collection_pin():
    url = f"/api/v1/finance/elections/{KEY}/finance/sources/{'a' * 64}/raw?collection_id={'b' * 64}"
    assert (
        s._csv_source_url(url)
        == f"https://alethicalfinance.com/elections/{KEY}/sources/{'a' * 64}?kind=finance&collection_id={'b' * 64}"
    )


def test_account_totals_mismatch_remains_unavailable_and_source_amounts_survive(held):
    detail = held[3]["19399"][0].payload["campaign_expenses"]
    # Retention/staging assigns this hold after a failed source reconciliation.
    detail["status"] = "requires_review"
    detail["gaps"] = ["detail_totals_do_not_match_report_summary"]
    account = s._assemble(*held)["account_reports"][0]
    assert account["checked_detail_before_exclusions"] is None
    assert account["checked_detail_after_exclusions"] is None
    assert account["campaign_expenses"] == money("11.00", "2.00", "3.00")


@pytest.mark.parametrize(
    "hold", [None, "pdf", "financial", "catalogue", "figures", "missing_stamp"]
)
def test_received_date_uses_only_selected_cover_and_its_pdf_availability(
    held, monkeypatch, hold
):
    payload = held[3]["19399"][0].payload
    payload["cover"] = {"received_date": "2026-10-26"}
    payload["document"]["copied_at"] = "2026-11-11T01:02:03Z"
    if hold == "pdf":
        held[4]["d" * 64] = False
    elif hold == "financial":
        payload["financial_source"] = {"sha256": "7" * 64}
        held[4]["7" * 64] = False
    elif hold == "catalogue":
        held[4]["c" * 64] = False
    elif hold == "figures":
        payload["figures"] = None
        payload["figure_status"] = "requires_review"
    elif hold == "missing_stamp":
        payload.pop("cover")
    expected = None if hold in {"pdf", "missing_stamp"} else "2026-10-26"
    data = s._assemble(*held)
    assert data["account_reports"][0]["received_date"] == expected
    rows, _ = _csv_test_rows(held, monkeypatch)
    financial = [
        r
        for r in rows
        if r["Row type"] in {"Account report", "Payment", "Payee summary"}
    ]
    assert financial and all(r["Received date"] == (expected or "") for r in financial)
    assert all(r["Report copied at"] == "2026-11-11T01:02:03Z" for r in financial)
    assert all(r["Report cutoff"] == "2026-10-19" for r in financial)


def test_received_date_follows_explicit_report_and_changes_with_pdf_loss(
    finance_db, comparison, monkeypatch
):
    from alethical.tests.test_election_finance_reads import (
        _fixture_reports,
        _publish_fixture_variant,
    )

    store, _, prior = _period_store(finance_db, comparison)
    reports = _fixture_reports(finance_db)
    for report in reports:
        report["payload"]["cover"] = {
            "received_date": "2026-09-09"
            if report["report_key"] == "2" * 64
            else "2026-10-26"
        }
    _publish_fixture_variant(finance_db, reports=reports)
    finance_db.flush()
    monkeypatch.setattr(s, "raw_file_store_from_env", lambda: store)
    args = dict(election_key=KEY, report_keys=["2" * 64])
    first = s.report(finance_db, **args)
    assert first["account_reports"][0]["received_date"] == "2026-09-09"
    assert first["account_reports"][0]["period_end"] == "2026-08-01"
    store.objects.pop(prior.object_key)
    later = s.report(finance_db, **args)
    assert later["account_reports"][0]["received_date"] is None
    assert later["version"] != first["version"]
    with pytest.raises(HTTPException) as error:
        s.report(finance_db, **args, version=first["version"])
    assert error.value.status_code == 409


from alethical.tests.test_election_external_finance import (  # noqa: E402,F401
    db,
    external,
    rewrite_original,
    rehash,
)
from alethical.tests.test_election_external_finance_reads import checked  # noqa: E402


@pytest.fixture
def own_external(db, external, monkeypatch):
    from alethical.db import models as m
    from alethical.pipeline import election_external_finance as storage

    ctx = external
    records = json.loads(ctx.originals[ctx.source_hash])["records"]
    for n, payment in enumerate(ctx.g["payments"]):
        payment.update(
            target_source_candidate_id=None,
            direction="unknown",
            transaction_type="F3:SB17",
            payee="=Exact vendor" if n == 0 else "Memo vendor",
            amount="-12.34" if n == 0 else "10.00",
            memo={
                "code": "X" if n else None,
                "text": None,
                "back_reference_transaction_id": None,
                "back_reference_schedule": None,
            },
            payee_address={
                "street_1": "123 Main",
                "street_2": None,
                "city": "St. Paul",
                "state": "MN" if n == 0 else "WI",
                "postal_code": "05501",
            },
        )
        records[payment["binding"]["locator"]["row"]] = storage.payment_facts(payment)
    rewrite_original(ctx, records)
    checked(db, ctx)
    ctx.snapshot.first_published_at = ctx.snapshot.fetched_at
    db.add(
        m.ElectionComparisonCurrent(
            election_key=ctx.g["election_key"], snapshot_id=ctx.snapshot.id
        )
    )
    db.flush()
    monkeypatch.setattr(s, "raw_file_store_from_env", lambda: ctx.store)
    monkeypatch.setattr(s.external, "raw_file_store_from_env", lambda: ctx.store)
    return ctx


def test_external_own_expenses_work_without_board_and_do_not_blend_measures(
    db, own_external
):
    ctx = own_external
    result = s.report(db, election_key=ctx.g["election_key"])
    assert result["collection_id"] is None
    assert result["summary"]["source_report_totals"]["amounts"] is None
    assert result["summary"]["public_subsidy_receipts"]["amount"] is None
    assert len(result["authority_reports"]) == 1
    report = result["authority_reports"][0]
    assert report["public_subsidy"] is None
    assert report["reported_itemized_before_exclusions"][0]["amount"] == "-12.34"
    assert report["memo_detail_count"] == 1
    assert report["detail_status"] == "partial_itemized"
    assert (
        result["authority_summary"][0]["by_filed_address"]["MN"]["baseline"] == "-12.34"
    )
    assert (
        result["authority_summary"][0]["by_filed_address"]["out_of_state"]["baseline"]
        == "0.00"
    )
    assert result["authority_summary"][0]["by_party"]["DFL"]["baseline"] == "-12.34"
    assert (
        result["candidates"][0]["external_accounts"][0]["authority_name"]
        == "Federal Election Commission"
    )
    options = result["report_options"][0]
    assert options["authority"] == "fec"
    assert options["reports"][0]["filing"]["report_type"] == "F3:synthetic"
    assert not any(
        secret in json.dumps(result)
        for secret in (
            "PRIVATE_REASON",
            "PRIVATE_REVIEWER",
            "raw_metadata",
            "decision_id",
            "object_key",
        )
    )


def test_external_exclusion_pagination_csv_and_original_dates(db, own_external):
    ctx = own_external
    args = {"election_key": ctx.g["election_key"]}
    first = s.report(db, **args)
    args.update(snapshot_id=first["snapshot_id"], version=first["version"])
    page = s.payees(db, **args, limit=1)
    pid = page["payees"][0]["payee_id"]
    assert page["page"]["total"] == 2
    assert page["payees"][0]["amounts"] is None
    excluded = s.report(db, **args, excluded_payee_ids=[pid])
    assert (
        excluded["authority_reports"][0]["reported_itemized_after_exclusions"][0][
            "amount"
        ]
        == "0.00"
    )
    assert excluded["excluded_payees"][0]["reported_amounts"][0]["amount"] == "-12.34"
    assert excluded["excluded_payees"][0]["account_reports"][0]["claims"]
    details = s.payments(db, **args, payee_id=pid)
    assert details["payments"][0]["source"][0]["source_copied_at"]
    assert details["payments"][0]["reported_amount"] == "-12.34"
    body, _ = s.export(db, **args, excluded_payee_ids=[pid], format="csv")
    rows = list(csv.DictReader(io.StringIO(body)))
    assert rows[0]["Row type"] == "Metadata"
    payments = [r for r in rows if r["Row type"] == "External payment"]
    assert len(payments) == 1
    assert payments[0]["Payee"] == "'=Exact vendor"
    assert payments[0]["Reported payment amount"] == "-12.34"
    assert payments[0]["Payment paid USD"] == ""
    assert payments[0]["Excluded payee"] == "Yes"
    assert "kind=external&generation_id=" in payments[0]["Source URL"]
    assert len([r for r in rows if r["Row type"] == "External memo detail"]) == 1


def test_external_source_loss_changes_composite_pin_and_never_becomes_zero(
    db, own_external
):
    ctx = own_external
    args = {"election_key": ctx.g["election_key"]}
    first = s.report(db, **args)
    ctx.store.objects.clear()
    second = s.report(db, **args)
    assert second["version"] != first["version"]
    assert second["authority_reports"] == []
    assert second["summary"]["source_report_totals"]["amounts"] is None
    with pytest.raises(HTTPException) as failure:
        s.report(db, **args, version=first["version"])
    assert failure.value.status_code == 409


def test_external_address_identity_never_guesses_from_name():
    base = {
        "authority": "fec",
        "payee": "Exact Name",
        "payment_key": "a",
        "payee_address": None,
    }
    assert (
        s._external_identity(base)[0]
        != s._external_identity(base | {"payment_key": "b"})[0]
    )
    empty = dict.fromkeys(("street_1", "street_2", "city", "state", "postal_code"))
    assert (
        s._external_identity(base | {"payee_address": empty})[0]
        != s._external_identity(base | {"payment_key": "b", "payee_address": empty})[0]
    )
    addressed = base | {"payee_address": empty | {"state": "MN"}}
    assert (
        s._external_identity(addressed)[0]
        != s._external_identity(addressed | {"authority": "local_authority"})[0]
    )


def test_external_superseded_and_foreign_report_selection_refuses(db, own_external):
    ctx = own_external
    before = s.report(db, election_key=ctx.g["election_key"])
    for key in [ctx.g["reports"][0]["report_key"], "f" * 64]:
        with pytest.raises(HTTPException) as failure:
            s.report(db, election_key=ctx.g["election_key"], report_keys=[key])
        assert failure.value.status_code == 422
        with pytest.raises(HTTPException) as stale:
            s.report(
                db,
                election_key=ctx.g["election_key"],
                report_keys=[key],
                version=before["version"],
            )
        assert stale.value.status_code == 409


def test_external_drilldown_keeps_exact_report_measure_and_memo(db, own_external):
    ctx = own_external
    args = {
        "election_key": ctx.g["election_key"],
        "report_key": ctx.g["reports"][-1]["report_key"],
        "authority": "fec",
        "measure": "fec_schedule_b_disbursements",
    }
    rows = s.payments(db, **args)["payments"]
    assert len(rows) == 2
    assert sum(p["nonadditive"] for p in rows) == 1
    assert (
        s.payments(db, **(args | {"measure": "mn_cfb_campaign_expenditures"}))[
            "payments"
        ]
        == []
    )


def test_external_shared_account_money_and_party_use_full_memberships(
    held, monkeypatch
):
    context, races, _, _, _ = held
    race = races[0]
    base = s._assemble(*held, party="R")
    report = {
        "report_key": "1" * 64,
        "authority": "fec",
        "account_id": "C00000001",
        "source_report_id": "123",
        "series_id": "series",
        "report_type": "F3:Q3",
        "period_start": "2026-01-01",
        "period_end": "2026-09-30",
        "received_date": "2026-10-15",
        "predecessor_report_key": None,
        "effective": True,
        "check_status": "checked",
        "figures": [],
        "sources": [],
    }
    account = {
        "authority": "fec",
        "account_id": "C00000001",
        "name": "Shared",
        "period_start": "2026-01-01",
        "period_end": "2026-10-31",
    }
    p = {
        "payment_key": "2" * 64,
        "source_row_id": "3",
        "authority": "fec",
        "account_id": "C00000001",
        "report_key": report["report_key"],
        "transaction_type": "F3:SB17",
        "payee": "Vendor",
        "payee_address": {
            "street_1": "1 Street",
            "street_2": None,
            "city": "City",
            "state": "MN",
            "postal_code": "55101",
        },
        "amount": "100.00",
        "date": "2026-09-01",
        "purpose": "Print",
        "currency": "USD",
        "amount_role": "reported_payment",
        "nonadditive": False,
        "memo": {},
        "sources": [],
    }
    bulk = {
        "snapshot_id": context["snapshot_id"],
        "generation_id": "a" * 64,
        "version": "b" * 64,
        "authorities": [{"key": "fec", "name": "FEC"}],
        "coverage": [],
        "candidates": [],
    }
    for candidate in race.payload["candidates"]:
        bulk["candidates"].append(
            {
                "race_id": race.id,
                "candidate_id": candidate["candidate_id"],
                "accounts": [account],
                "account_gaps": [],
                "reports": [report],
                "own_payments": [p],
                "coverage": {"status": "checked"},
            }
        )
    monkeypatch.setattr(
        s, "_source_states", lambda db, docs, hashes: dict.fromkeys(hashes, True)
    )
    result = s._join_external(
        None, base, bulk, races, report_keys=[], excluded_payee_ids=[]
    )
    assert len(result["authority_reports"]) == 1
    assert len(result["authority_reports"][0]["claims"]) == 2
    assert result["authority_reports"][0]["party_group"] == "unknown"
    assert result["authority_summary"][0]["baseline"] == "100.00"
    assert result["authority_summary"][0]["by_party"]["unknown"]["baseline"] == "100.00"
    assert len([p for p in result["payments"] if p.get("authority") == "fec"]) == 1
    csv_rows = list(s._external_csv_rows(result))
    exported_report = next(
        row for row in csv_rows if row["Row type"] == "External account report"
    )
    assert exported_report["Account party group"] == "Party cannot be assigned"
    assert (
        exported_report["Party assignment"]
        == "Shared account, different ballot parties"
    )
    exported_money = next(
        row
        for row in csv_rows
        if row["Row type"] == "External itemized party"
        and row["Itemized before exclusions"] == "100.00"
    )
    assert exported_money["Account party group"] == "Party cannot be assigned"
    assert (
        exported_money["Party assignment"] == "Shared account, different ballot parties"
    )
    historical = deepcopy(bulk)
    historical["candidates"][1]["accounts"] = [deepcopy(account)]
    historical["candidates"][1]["accounts"][0]["period_start"] = "2025-01-01"
    historical["candidates"][1]["accounts"][0]["period_end"] = "2025-12-31"
    historical["candidates"][1]["reports"] = [
        report | {"check_status": "period_not_covered", "figures": None}
    ]
    historical["candidates"][1]["own_payments"] = []
    dated = s._join_external(
        None,
        s._assemble(*held, party="R"),
        historical,
        races,
        report_keys=[],
        excluded_payee_ids=[],
    )
    assert dated["authority_reports"][0]["party_group"] == "R"
    assert len(dated["authority_reports"][0]["claims"]) == 1
    lost = deepcopy(bulk)
    lost["candidates"][1]["accounts"] = []
    lost["candidates"][1]["reports"] = []
    lost["candidates"][1]["own_payments"] = []
    lost["candidates"][1]["account_gaps"] = [
        {"authority": "fec", "account_id": "C00000001", "state": "sources_unavailable"}
    ]
    held_back = s._join_external(
        None,
        s._assemble(*held, party="R"),
        lost,
        races,
        report_keys=[],
        excluded_payee_ids=[],
    )
    assert (
        held_back["authority_reports"][0]["party_classification_state"]
        == "membership_sources_unavailable"
    )
    assert (
        held_back["authority_summary"][0]["by_party"]["unknown"]["baseline"] == "100.00"
    )
    assert held_back["authority_summary"][0]["by_party"]["R"]["baseline"] == "0.00"
    tied = deepcopy(bulk)
    for candidate in tied["candidates"]:
        candidate["reports"].append(
            report
            | {"report_key": "3" * 64, "report_type": "F3:YE", "series_id": "other"}
        )
    ambiguous = s._join_external(
        None,
        s._assemble(*held, party="R"),
        tied,
        races,
        report_keys=[],
        excluded_payee_ids=[],
    )
    assert ambiguous["authority_reports"] == []
    assert any(
        g["state"] == "ambiguous_latest_report"
        for c in ambiguous["candidates"]
        for g in c["gaps"]
    )
    selected = s._join_external(
        None,
        s._assemble(*held, party="R"),
        tied,
        races,
        report_keys=[report["report_key"]],
        excluded_payee_ids=[],
    )
    assert len(selected["authority_reports"]) == 1
    with pytest.raises(HTTPException):
        s._join_external(
            None,
            s._assemble(*held),
            tied,
            races,
            report_keys=[report["report_key"], "3" * 64],
            excluded_payee_ids=[],
        )


def test_external_withdrawal_during_assembly_is_refused(db, own_external, monkeypatch):
    from alethical.pipeline import election_account_reviews as reviews

    ctx = own_external
    original = s._join_external

    def changed(*args, **kwargs):
        result = original(*args, **kwargs)
        last = db.scalar(
            __import__("sqlalchemy")
            .select(s.m.ElectionCampaignAccountDecision)
            .where(s.m.ElectionCampaignAccountDecision.authority == "fec")
        )
        reviews.record_decision(
            db,
            **(
                ctx.args
                | {
                    "decision": "withdrawn",
                    "expected_previous_id": last.id,
                    "reason": "Withdraw exact relationship",
                }
            ),
        )
        return result

    monkeypatch.setattr(s, "_join_external", changed)
    with pytest.raises(HTTPException) as error:
        s.report(db, election_key=ctx.g["election_key"])
    assert error.value.status_code == 409


def test_external_unknown_exclusion_and_out_of_scope_payment_report_refuse(
    db, own_external
):
    ctx = own_external
    with pytest.raises(HTTPException) as error:
        s.report(db, election_key=ctx.g["election_key"], excluded_payee_ids=["0" * 64])
    assert error.value.status_code == 422
    with pytest.raises(HTTPException) as error:
        s.payments(
            db,
            election_key=ctx.g["election_key"],
            report_key=ctx.g["reports"][0]["report_key"],
        )
    assert error.value.status_code == 422


def test_external_sums_keep_currency_and_source_precision_separate():
    template = {
        "authority": "local:example",
        "report_key": "r",
        "measure": "source_reported_payment",
        "measure_label": "Source payment",
        "basis": "literal",
        "period_start": "2026-01-01",
        "period_end": "2026-10-01",
        "nonadditive": False,
    }
    result = s._reported_amounts(
        [
            template
            | {
                "currency": "USD",
                "reported_amount": "123456789012345678901234567890.01",
            },
            template | {"currency": "USD", "reported_amount": "0.002"},
            template | {"currency": "CAD", "reported_amount": "1.00"},
        ]
    )
    assert {r["currency"]: r["amount"] for r in result} == {
        "USD": "123456789012345678901234567890.012",
        "CAD": "1.00",
    }


from alethical.tests.finance_fixtures import finance_api  # noqa: E402,F401


def test_external_payment_drilldown_parameters_route_without_changing_auth(
    finance_api, monkeypatch
):
    calls = []
    monkeypatch.setattr(
        s, "payments", lambda db, **kw: calls.append(kw) or {"payments": []}
    )
    params = {
        "snapshot_id": "a" * 64,
        "version": "b" * 16,
        "report_key": "c" * 64,
        "authority": "local:county:001",
        "measure": "source_reported_payment",
    }
    path = f"/api/v1/finance/elections/{KEY}/analytics/expenses/payments"
    response = finance_api.get(path, params=params)
    assert response.status_code == 200
    assert calls[0]["report_key"] == params["report_key"]
    assert calls[0]["authority"] == params["authority"]
    assert calls[0]["measure"] == params["measure"]
    assert (
        finance_api.get(path, params=params | {"authority": "bad\nvalue"}).status_code
        == 422
    )
    assert (
        finance_api.get(path, params=params | {"measure": "a" * 201}).status_code == 422
    )


def test_external_csv_detail_filter_flags_match_export_instructions(db, own_external):
    args = dict(election_key=KEY, geography="MN", payee_query="Exact")
    report = s.report(db, **args)
    assert len(s.payments(db, **args, version=report["version"])["payments"]) == 1
    body, _ = s.export(db, **args, version=report["version"], format="csv")
    rows = list(csv.DictReader(io.StringIO(body)))
    payments = [
        r for r in rows if r["Row type"] in {"External payment", "External memo detail"}
    ]
    actual = {
        r["Payee"]: (r["Matches detail filters"], r["Included in filtered view"])
        for r in payments
    }
    assert actual == {"'=Exact vendor": ("Yes", "Yes"), "Memo vendor": ("No", "No")}


def test_external_csv_excluded_row_is_not_in_adjusted_view(db, own_external):
    first = s.report(db, election_key=KEY)
    pid = next(
        p["payee_id"]
        for p in s.payees(db, election_key=KEY, version=first["version"])["payees"]
        if p["payee"]["name"] == "=Exact vendor"
    )
    args = dict(election_key=KEY, version=first["version"], excluded_payee_ids=[pid])
    assert all(p["payee_id"] != pid for p in s.payments(db, **args)["payments"])
    body, _ = s.export(db, **args, format="csv")
    row = next(
        r
        for r in csv.DictReader(io.StringIO(body))
        if r["Row type"] == "External payment"
    )
    assert row["Excluded payee"] == "Yes"
    assert row["Matches detail filters"] == "Yes"
    assert row["Included in filtered view"] == "No"


def test_numeric_external_account_id_survives_spreadsheet_type_coercion(
    db, own_external
):
    # Serializer boundary only: no new source claim or review is applied.
    data = s._build(db, election_key=KEY, _csv=True)
    numeric_id = "000012345678901234567890"
    for report in data["authority_reports"]:
        report["account_id"] = numeric_id
    body = s._csv_body(data)
    row = next(
        r
        for r in csv.DictReader(io.StringIO(body))
        if r["Row type"] == "External payment"
    )
    assert row["Account"] == "'" + numeric_id


def test_document_proof_bounds_download_and_decompression(monkeypatch):
    store = MemoryStore()
    body = b"%PDF-" + b"x" * 200_000
    compressed = gzip.compress(body, mtime=0)
    store.objects["bounded"] = compressed
    row = SimpleNamespace(
        object_key="bounded",
        compression="gzip",
        compressed_byte_size=len(compressed),
        compressed_hash=hashlib.sha256(compressed).hexdigest(),
        byte_size=len(body),
        document_hash=hashlib.sha256(body).hexdigest(),
    )
    calls = []
    original_get = store.get

    def bounded_get(key, path, *, max_bytes=None):
        calls.append(max_bytes)
        assert max_bytes == len(compressed)
        return original_get(key, path, max_bytes=max_bytes)

    monkeypatch.setattr(store, "get", bounded_get)
    original_read = gzip.GzipFile.read

    def bounded_read(reader, size=-1):
        assert 0 < size <= 1024 * 1024
        return original_read(reader, size)

    monkeypatch.setattr(gzip.GzipFile, "read", bounded_read)
    assert s._restore_one(store, "document", row)
    assert calls == [len(compressed)]
    row.byte_size = 16
    assert not s._restore_one(store, "document", row)
    assert calls == [len(compressed), len(compressed)]


def test_document_proof_rejects_empty_original():
    store = MemoryStore()
    compressed = gzip.compress(b"", mtime=0)
    store.objects["empty-document"] = compressed
    row = SimpleNamespace(
        object_key="empty-document",
        compression="gzip",
        compressed_byte_size=len(compressed),
        compressed_hash=hashlib.sha256(compressed).hexdigest(),
        byte_size=0,
        document_hash=hashlib.sha256(b"").hexdigest(),
    )
    assert not s._restore_one(store, "document", row)
