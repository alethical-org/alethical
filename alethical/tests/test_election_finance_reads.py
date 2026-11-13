"""A comparison requires current account review and the report's actual dates."""

# ruff: noqa: F811
from copy import deepcopy
from contextlib import ExitStack
from datetime import date
import gzip
import hashlib
from pathlib import Path
from uuid import uuid4

import pytest
from sqlalchemy import event, text, delete
from sqlalchemy.orm import Session

from alethical.api.services import election_finance_reads as reads
from alethical.db import models as m
from alethical.db.session import get_engine
from alethical.api.services import finance_versions
from alethical.pipeline import election_account_reviews as reviews
from alethical.pipeline.election_comparison import archive_source, ComparisonImportError
from alethical.tests.test_election_comparison_storage import MemoryStore
from alethical.tests.finance_fixtures import finance_api, finance_db  # noqa: F401
from alethical.tests.test_election_outside_spending import spending  # noqa: F401
from alethical.tests.test_committee_finance import Published
from alethical.tests.test_election_comparison_reads import (
    KEY,
    RACE,
    SOURCE,
    WHEN,
    _race,
    _snapshot,
    _current,
)

BASE = f"/api/v1/finance/elections/{KEY}"
URL = f"{BASE}/races/{RACE}/finance"
COLLECTION = "e" * 64


def _document(db, report_type):
    body = b"%PDF-1.4\nSynthetic retained fixture " + report_type.encode()
    compressed = gzip.compress(body, mtime=0)
    fingerprint = hashlib.sha256(body).hexdigest()
    db.add(
        m.CampaignFinanceReportDocument(
            document_hash=fingerprint,
            object_key=f"reports/{fingerprint}.gz",
            byte_size=len(body),
            compressed_hash=hashlib.sha256(compressed).hexdigest(),
            compressed_byte_size=len(compressed),
            registration_number="-101",
            filing_year=2026,
            report_type=report_type,
            amendment_index=0,
            special_election=False,
        )
    )
    db.flush()
    return fingerprint, body, compressed


def _report(
    db,
    key,
    report_type,
    cutoff,
    *,
    document_hash=None,
    amount="0.00",
    status="source_verified",
):
    cash = amount
    figures = (
        {
            "contributions_received": dict(
                cash=cash,
                in_kind="0.00",
                total=cash,
                source_page=2,
                source_lines=[2, 3, 4, 5, 6],
            ),
            "campaign_expenditures": dict(
                cash="0.00",
                unpaid="4.00",
                in_kind="3.00",
                total="7.00",
                source_page=2,
                source_lines=[11],
            ),
            "total_expenditures": dict(
                cash="1.00",
                unpaid="4.00",
                in_kind="3.00",
                total="8.00",
                source_page=2,
                source_lines=[19],
            ),
        }
        if status == "source_verified"
        else None
    )
    row = m.ElectionFinanceReport(
        collection_id=COLLECTION,
        registration_number="-101",
        report_key=key,
        document_hash=document_hash,
        payload={
            "filing": dict(
                registration_number="-101",
                filing_year=2026,
                report_type=report_type,
                report_name=report_type,
                cut_off_date=cutoff,
                special_election=False,
                effective_amendment_index=0,
                amendment_count=1,
                termination_date=None,
            ),
            "figures": figures,
            "figure_status": status,
            "period_start": "2026-01-01",
            "period_end": cutoff,
            "period_basis": "calendar_year_to_date",
            "document": {"sha256": document_hash, "local_file": "/private/source.pdf"},
            "catalogue_source": {
                "sha256": SOURCE,
                "url": "https://cfb.mn.gov/catalogue",
            },
            "unavailable_reason": "PDF not held" if figures is None else None,
        },
    )
    db.add(row)
    db.flush()
    return row


def _comparison_race_payload(race):
    payload = deepcopy(race.payload)
    payload["office_name"] = "Attorney General"
    payload["candidate_source_sha256"] = SOURCE
    for candidate in payload["candidates"]:
        candidate["party"] = "TEST"
        candidate["candidate_stable_id"] = (
            None
            if candidate["is_write_in_aggregate"]
            else f"state:201:2026-11-03:general:88:0335:{candidate['candidate_id']}"
        )
    return payload


def _comparison_collection_data(payload):
    return {
        "sources": [
            {
                "sha256": SOURCE,
                "url": "https://cfb.mn.gov/reports/api/",
                "kind": "candidate_directory",
                "private_path": "/secret",
            }
        ],
        "coverage": {
            "reports": 2,
            "candidates": [
                {
                    "candidate_id": c["candidate_id"],
                    "stable_id": c["candidate_stable_id"],
                    "name": c["name"],
                    "party": c["party"],
                    "office_id": "0335",
                    "office": "Attorney General",
                    "county_id": "88",
                    "source_sha256": SOURCE,
                    "source_row": 1,
                    "authority": "board",
                    "authority_scope": "candidate_own_campaign_reports",
                    "outside_support_scope": "available itemized sources",
                    "link_state": "not_confirmed_by_collection",
                    "gap": "Candidate-to-committee confirmation is separate",
                }
                for c in payload["candidates"]
                if not c["is_write_in_aggregate"]
            ],
        },
    }


def _comparison_fixture_digest():
    from types import SimpleNamespace
    from alethical.pipeline.election_finance_collection import collection_digest

    stub = SimpleNamespace(add=lambda row: None, flush=lambda: None)
    payload = _comparison_race_payload(_race(stub))
    current = _document(stub, "E")[0]
    prior = _document(stub, "P")[0]
    reports = [
        _report(stub, "1" * 64, "E", "2026-10-19", document_hash=current),
        _report(
            stub, "2" * 64, "P", "2026-08-01", document_hash=prior, amount="500.00"
        ),
    ]
    return collection_digest(
        {
            "format": 1,
            "election_key": KEY,
            "copied_at": WHEN.isoformat(),
            **_comparison_collection_data(payload),
            "reports": [
                {
                    "registration_number": r.registration_number,
                    "report_key": r.report_key,
                    "document_hash": r.document_hash,
                    "payload": r.payload,
                }
                for r in reports
            ],
        }
    )


COLLECTION = _comparison_fixture_digest()


def _fixture_reports(db):
    return [
        {
            "registration_number": r.registration_number,
            "report_key": r.report_key,
            "document_hash": r.document_hash,
            "payload": deepcopy(r.payload),
        }
        for r in db.query(m.ElectionFinanceReport).filter(
            m.ElectionFinanceReport.collection_id == COLLECTION
        )
    ]


def _publish_fixture_variant(
    db,
    *,
    coverage=None,
    sources=None,
    reports=None,
    election_key=KEY,
    make_current=True,
    published=True,
):
    from alethical.pipeline.election_finance_collection import collection_digest

    old = db.get(m.ElectionFinanceCollection, COLLECTION)
    rows = _fixture_reports(db) if reports is None else reports
    coverage = deepcopy(old.coverage) if coverage is None else coverage
    value = {
        "format": 1,
        "election_key": election_key,
        "copied_at": WHEN.isoformat(),
        "coverage": coverage,
        "sources": old.sources if sources is None else sources,
        "reports": rows,
    }
    identifier = collection_digest(value)
    parent = m.ElectionFinanceCollection(
        id=identifier,
        election_key=election_key,
        copied_at=WHEN,
        sources=value["sources"],
        coverage=coverage,
    )
    db.add(parent)
    db.flush()
    for row in rows:
        db.add(m.ElectionFinanceReport(collection_id=identifier, **row))
    db.flush()
    parent.report_index = db.scalar(
        text("SELECT board_finance_report_index(:id)"), {"id": identifier}
    )
    parent.sealed_at = WHEN
    db.flush()
    if published:
        parent.first_published_at = WHEN
        db.flush()
    if make_current:
        current = db.get(m.ElectionFinanceCurrent, election_key)
        if current:
            current.collection_id = identifier
        else:
            db.add(
                m.ElectionFinanceCurrent(
                    election_key=election_key, collection_id=identifier
                )
            )
        db.flush()
    return parent


@pytest.fixture()
def comparison(finance_db, spending):
    race = _race(finance_db)
    payload = _comparison_race_payload(race)
    race.payload = payload
    finance_db.add(
        m.ElectionFinanceCollection(
            id=COLLECTION,
            election_key=KEY,
            copied_at=WHEN,
            **_comparison_collection_data(payload),
        )
    )
    finance_db.flush()
    current_doc = _document(finance_db, "E")
    prior_doc = _document(finance_db, "P")
    _report(finance_db, "1" * 64, "E", "2026-10-19", document_hash=current_doc[0])
    _report(
        finance_db,
        "2" * 64,
        "P",
        "2026-08-01",
        document_hash=prior_doc[0],
        amount="500.00",
    )
    finance_db.flush()
    parent = finance_db.get(m.ElectionFinanceCollection, COLLECTION)
    parent.report_index = finance_db.scalar(
        text("SELECT board_finance_report_index(:id)"), {"id": COLLECTION}
    )
    parent.sealed_at = WHEN
    finance_db.flush()
    parent.first_published_at = WHEN
    finance_db.flush()
    finance_db.add(m.ElectionFinanceCurrent(election_key=KEY, collection_id=COLLECTION))
    args = dict(
        snapshot_id="a" * 64,
        race_id=RACE,
        candidate_id="a",
        registration_number="-101",
        decision="confirmed",
        identity=reviews.candidate_identity(race, payload["candidates"][0]),
        period_start=date(2026, 1, 1),
        period_end=date(2026, 10, 19),
        evidence=[
            {"kind": "ballot", "sha256": SOURCE},
            {
                "kind": "committee_register",
                "sha256": SOURCE,
                "collection_id": COLLECTION,
            },
            {"kind": "report_cover", "sha256": current_doc[0], "page": 1},
        ],
        reason="Exact synthetic account and report",
        reviewed_by="private-reviewer",
        expected_previous_id=None,
    )
    decision = reviews.record_decision(finance_db, **args)
    finance_db.commit()
    return dict(args=args, decision=decision, doc=current_doc, race=race)


def _data(client, **params):
    response = client.get(URL, params=params)
    assert response.status_code == 200, response.text
    return response.json()["data"]


def test_actual_periods_separate_figures_and_every_candidate(finance_api, comparison):
    data = _data(finance_api)
    assert len(data["candidates"]) == 3
    candidate, unmatched, write_in = data["candidates"]
    assert candidate["votes"] == 7
    assert unmatched["votes"] is None
    assert write_in["votes"] == 0
    assert all(c["outcome"] is None for c in data["candidates"])
    assert unmatched["account_state"] == "no_confirmed_link"
    assert write_in["account_state"] == "write_in_aggregate"
    account = candidate["accounts"][0]
    assert account["period_end"] == "2026-10-19"
    assert len(account["reports"]) == 2
    latest = account["latest_report"]
    assert latest["state"] == "reported"
    assert latest["figures"]["contributions_received"]["total"] == "0.00"
    assert latest["figures"]["campaign_expenditures"]["total"] == "7.00"
    assert latest["figures"]["all_disbursements"]["total"] == "8.00"
    assert "local_file" not in account["reports"][0]["document"]
    assert "private_path" not in data["sources"][0]
    assert "candidates" not in data["coverage"]
    assert "private-reviewer" not in str(data)


def test_outside_money_requires_exact_account_dates_and_retains_missing_values(
    finance_api, comparison
):
    data = _data(finance_api)
    outside = data["candidates"][0]["outside_spending"]
    groups = {(row["category"], row["direction"]): row for row in outside["groups"]}
    assert groups[("PCF", "For")]["amount"] == "20.0000"
    assert groups[("PCF", "For")]["record_count"] == 3
    assert outside["total"]["amount"] is None
    assert outside["excluded_missing_date"]["amount"] == "4.0000"
    assert outside["excluded_missing_year"]["amount"] == "7.0000"
    params = {
        "version": data["version"],
        "snapshot_id": data["snapshot_id"],
        "limit": 2,
    }
    response = finance_api.get(f"{URL}/candidates/a/outside-spending", params=params)
    assert response.status_code == 200
    page = response.json()["data"]
    assert page["page"]["total"] == 4
    assert [row["row_number"] for row in page["rows"]] == [1, 2]
    assert all(
        row["resolution"] == "checked_account_and_period" for row in page["rows"]
    )
    assert page["payment_source"] == data["payment_source"]


def test_withdrawal_invalidates_version_and_removes_attribution(
    finance_api, finance_db, comparison
):
    old = _data(finance_api)
    reviews.record_decision(
        finance_db,
        **{
            **comparison["args"],
            "decision": "withdrawn",
            "expected_previous_id": comparison["decision"].id,
            "reason": "New evidence withdraws review",
        },
    )
    finance_db.commit()
    assert finance_api.get(URL, params={"version": old["version"]}).status_code == 409
    data = _data(finance_api)
    assert data["candidates"][0]["accounts"] == []
    assert data["candidates"][0]["account_gaps"][0]["state"] == "withdrawn"
    assert data["candidates"][0]["outside_spending"]["total"] is None


def test_late_visible_lower_decision_id_changes_version(
    finance_api, finance_db, comparison
):
    # Reserve an earlier sequence value, then make a later decision visible.
    # This models independent transactions committing in reverse allocation
    # order without claiming this rollback-isolated fixture uses two sessions.
    reserved = finance_db.execute(
        text(
            "SELECT nextval(pg_get_serial_sequence('election_campaign_account_decision', 'id'))"
        )
    ).scalar_one()
    later = reviews.record_decision(
        finance_db,
        **{
            **comparison["args"],
            "expected_previous_id": comparison["decision"].id,
            "reason": "Later allocated review",
        },
    )
    finance_db.commit()
    old = _data(finance_api)
    assert later.id > reserved

    def use_reserved(mapper, connection, target):
        target.id = reserved

    event.listen(m.ElectionCampaignAccountDecision, "before_insert", use_reserved)
    try:
        candidate = comparison["race"].payload["candidates"][1]
        reviews.record_decision(
            finance_db,
            **{
                **comparison["args"],
                "candidate_id": candidate["candidate_id"],
                "registration_number": "-102",
                "decision": "rejected",
                "identity": reviews.candidate_identity(comparison["race"], candidate),
                "evidence": comparison["args"]["evidence"][:2],
                "reason": "Earlier allocated review becomes visible last",
            },
        )
        finance_db.commit()
    finally:
        event.remove(m.ElectionCampaignAccountDecision, "before_insert", use_reserved)
    new = _data(finance_api)
    assert old["review_decision_id"] == new["review_decision_id"]
    assert old["version"] != new["version"]
    assert finance_api.get(URL, params={"version": old["version"]}).status_code == 409
    assert new["candidates"][1]["account_gaps"][0]["state"] == "rejected"


@pytest.mark.parametrize("rows", [False, True])
def test_same_transaction_review_mutation_refuses_mixed_response(
    finance_api, finance_db, comparison, monkeypatch, rows
):
    # finance_db uses REPEATABLE READ. External commits remain invisible for the
    # whole request and invalidate the next page. This deliberate mutation inside
    # the same transaction exercises the additional end-of-read guard.
    context = _data(finance_api)
    original = reads._accounts
    changed = False

    def withdraw_then_read(db, election_key, race, candidate):
        nonlocal changed
        if not changed:
            changed = True
            reviews.record_decision(
                db,
                **{
                    **comparison["args"],
                    "decision": "withdrawn",
                    "expected_previous_id": comparison["decision"].id,
                    "reason": "Changed during same transaction",
                },
            )
        return original(db, election_key, race, candidate)

    monkeypatch.setattr(reads, "_accounts", withdraw_then_read)
    response = (
        finance_api.get(
            f"{URL}/candidates/a/outside-spending",
            params={
                "version": context["version"],
                "snapshot_id": context["snapshot_id"],
            },
        )
        if rows
        else finance_api.get(URL)
    )
    assert response.status_code == 409


def test_reader_evidence_does_not_include_internal_notes(
    finance_api, finance_db, comparison
):
    evidence = deepcopy(comparison["args"]["evidence"])
    evidence[0]["internal_notes"] = "private account discussion"
    reviews.record_decision(
        finance_db,
        **{
            **comparison["args"],
            "evidence": evidence,
            "expected_previous_id": comparison["decision"].id,
            "reason": "Additional internal detail",
        },
    )
    finance_db.commit()
    data = _data(finance_api)
    public = data["candidates"][0]["accounts"][0]["evidence"]
    assert public[0] == {"kind": "ballot", "sha256": SOURCE}
    assert "private account discussion" not in str(data)


def test_primary_does_not_borrow_general_report_series(
    finance_api, finance_db, comparison
):
    finance_db.get(m.ElectionComparisonSnapshot, "a" * 64).stage = "primary"
    finance_db.commit()
    assert finance_api.get(URL).status_code == 422


def test_report_outside_review_period_is_not_prorated(
    finance_api, finance_db, comparison
):
    reviews.record_decision(
        finance_db,
        **{
            **comparison["args"],
            "period_start": date(2026, 9, 1),
            "expected_previous_id": comparison["decision"].id,
            "reason": "Only September onward is checked",
        },
    )
    finance_db.commit()
    candidate = _data(finance_api)["candidates"][0]
    assert candidate["account_state"] == "checked"
    assert candidate["accounts"][0]["period_start"] == "2026-09-01"
    assert all(
        report["figures"] is None for report in candidate["accounts"][0]["reports"]
    )
    assert candidate["accounts"][0]["latest_report"]["state"] == "unavailable"
    assert candidate["outside_spending"]["total"]["record_count"] == 4


def test_newer_missing_pdf_does_not_fall_back_to_older_totals(
    finance_api, finance_db, comparison
):
    from types import SimpleNamespace

    stub = SimpleNamespace(add=lambda row: None, flush=lambda: None)
    extra = _report(stub, "3" * 64, "G", "2026-11-04", status="unavailable")
    rows = _fixture_reports(finance_db) + [
        {
            "registration_number": extra.registration_number,
            "report_key": extra.report_key,
            "document_hash": extra.document_hash,
            "payload": extra.payload,
        }
    ]
    _publish_fixture_variant(finance_db, coverage={"reports": 3}, reports=rows)
    finance_db.commit()
    latest = _data(finance_api)["candidates"][0]["accounts"][0]["latest_report"]
    assert latest["state"] == "unavailable"
    assert latest["report_key"] == "3" * 64
    assert latest["figures"] is None


def test_checked_account_with_no_report_is_distinct(
    finance_api, finance_db, comparison
):
    _publish_fixture_variant(finance_db, coverage={"reports": 0}, reports=[])
    finance_db.commit()
    candidate = _data(finance_api)["candidates"][0]
    assert candidate["account_state"] == "checked"
    assert candidate["accounts"][0]["latest_report"]["state"] == "no_held_report"


def test_amendment_numbers_do_not_rank_different_report_types(
    finance_api, finance_db, comparison
):
    from types import SimpleNamespace

    report = _report(
        SimpleNamespace(add=lambda row: None, flush=lambda: None),
        "3" * 64,
        "G",
        "2026-10-19",
        status="unavailable",
    )
    report.payload["filing"]["effective_amendment_index"] = 8
    _publish_fixture_variant(
        finance_db,
        coverage={"reports": 3},
        reports=_fixture_reports(finance_db)
        + [
            {
                "registration_number": report.registration_number,
                "report_key": report.report_key,
                "document_hash": None,
                "payload": report.payload,
            }
        ],
    )
    finance_db.commit()
    latest = _data(finance_api)["candidates"][0]["accounts"][0]["latest_report"]
    assert latest["state"] == "ambiguous_latest_report"
    assert latest["figures"] is None


def test_partial_collection_loss_is_unavailable(finance_api, finance_db, comparison):
    from sqlalchemy.exc import SQLAlchemyError

    with pytest.raises(SQLAlchemyError):
        with finance_db.begin_nested():
            finance_db.delete(
                finance_db.get(m.ElectionFinanceReport, (COLLECTION, "-101", "2" * 64))
            )
            finance_db.flush()
    assert _data(finance_api)["report_availability"]["state"] == "available"


@pytest.mark.parametrize("changed", ["results", "reports", "payments"])
def test_each_source_version_change_requires_restart(
    finance_api, finance_db, comparison, changed
):
    old = _data(finance_api)
    if changed == "results":
        _snapshot(finance_db, "d" * 64)
        race = comparison["race"]
        finance_db.add(
            m.ElectionComparisonRace(
                snapshot_id="d" * 64,
                id=race.id,
                label=race.label,
                office_id=race.office_id,
                jurisdiction=race.jurisdiction,
                result_status=race.result_status,
                payload=race.payload,
            )
        )
        _current(finance_db, "d" * 64)
    elif changed == "reports":
        old_collection = finance_db.get(m.ElectionFinanceCollection, COLLECTION)
        _publish_fixture_variant(
            finance_db,
            coverage={
                **old_collection.coverage,
                "scope_note": "New source collection fixture",
            },
        )
    else:
        Published(finance_db)
    finance_db.commit()
    assert finance_api.get(URL, params={"version": old["version"]}).status_code == 409
    assert _data(finance_api)["version"] != old["version"]


def test_missing_catalogue_source_is_unavailable(finance_api, finance_db, comparison):
    finance_db.delete(finance_db.get(m.ElectionResultSource, SOURCE))
    finance_db.commit()
    data = _data(finance_api)
    assert data["report_availability"]["state"] == "unavailable"
    assert data["candidates"][0]["account_state"] == "unavailable"


def test_unpublished_collection_is_hidden(finance_api, finance_db, comparison):
    original = finance_db.get(m.ElectionFinanceCollection, COLLECTION)
    unpublished = _publish_fixture_variant(
        finance_db,
        coverage={**original.coverage, "scope_note": "Unpublished fixture"},
        make_current=False,
        published=False,
    )
    finance_db.delete(finance_db.get(m.ElectionFinanceCurrent, KEY))
    finance_db.commit()
    data = _data(finance_api)
    assert data["collection_id"] is None
    assert data["coverage"] is None
    assert data["report_availability"]["state"] == "unavailable"
    assert (
        finance_api.get(
            f"{BASE}/finance/sources/{comparison['doc'][0]}",
            params={"collection_id": unpublished.id},
        ).status_code
        == 404
    )


def test_pdf_checks_membership_and_raw_fingerprint(
    finance_api, finance_db, comparison, monkeypatch
):
    fingerprint, body, compressed = comparison["doc"]

    class Store:
        def get(self, key, destination):
            Path(destination).write_bytes(compressed)

    monkeypatch.setattr(reads, "raw_file_store_from_env", lambda: Store())
    url = f"{BASE}/finance/sources/{fingerprint}"
    response = finance_api.get(url, params={"collection_id": COLLECTION})
    assert response.status_code == 200
    assert response.content == body
    assert response.headers["content-type"] == "application/pdf"
    assert "attachment" in response.headers["content-disposition"]
    assert response.headers["x-content-type-options"] == "nosniff"
    foreign = _document(finance_db, "X")[0]
    finance_db.commit()
    assert (
        finance_api.get(
            f"{BASE}/finance/sources/{foreign}", params={"collection_id": COLLECTION}
        ).status_code
        == 404
    )
    assert (
        finance_api.get(
            f"{BASE}/finance/sources/{'f' * 64}", params={"collection_id": COLLECTION}
        ).status_code
        == 404
    )
    monkeypatch.setattr(reads, "read_document", lambda *args: b"%PDF wrong bytes")
    assert finance_api.get(url, params={"collection_id": COLLECTION}).status_code == 503


def test_routes_inherit_private_access(finance_api, comparison):
    data = _data(finance_api)
    for url, params in (
        (URL, {}),
        (
            f"{URL}/candidates/a/outside-spending",
            {"version": data["version"], "snapshot_id": data["snapshot_id"]},
        ),
    ):
        response = finance_api.get(url, params=params)
        assert "private" in response.headers["cache-control"]
        assert "no-store" in response.headers["cache-control"]
        assert (
            finance_api.get(
                url, params=params, headers={"Authorization": ""}
            ).status_code
            == 401
        )
    assert (
        finance_api.get(
            f"{BASE}/finance/sources/{comparison['doc'][0]}",
            params={"collection_id": COLLECTION},
            headers={"Authorization": ""},
        ).status_code
        == 401
    )


def test_real_independent_commits_in_reverse_id_order_change_next_snapshot(
    seed_database,
):
    # Real independent commits, isolated in an owned schema of pytest's temporary
    # database. No append-only receipts leak into another test's public tables.
    schema = "review_visibility_" + uuid4().hex
    engine = get_engine()
    election_key, race_id = "test-election", "f" * 64
    with engine.begin() as connection:
        connection.execute(text(f"CREATE SCHEMA {schema}"))
        m.ElectionCampaignAccountDecision.__table__.create(
            connection.execution_options(schema_translate_map={None: schema})
        )

    def decision(registration):
        return m.ElectionCampaignAccountDecision(
            request_key=hashlib.sha256(str(uuid4()).encode()).hexdigest(),
            authority="mn_cfb",
            election_key=election_key,
            race_id=race_id,
            candidate_id="a",
            registration_number=registration,
            decision="rejected",
            period_start=date(2026, 1, 1),
            period_end=date(2026, 12, 31),
            identity={},
            evidence=[{"kind": "fixture"}],
            reason="Concurrent version fixture",
            reviewed_by="fixture",
            reviewed_at=WHEN,
        )

    try:
        with ExitStack() as stack:

            def session():
                connection = stack.enter_context(
                    engine.connect().execution_options(
                        schema_translate_map={None: schema},
                        isolation_level="REPEATABLE READ",
                    )
                )
                return stack.enter_context(Session(bind=connection))

            first, second, pinned = session(), session(), session()
            earlier, later = decision("first"), decision("second")
            first.add(earlier)
            first.flush()
            earlier_id = earlier.id
            second.add(later)
            second.flush()
            later_id = later.id
            second.commit()
            finance_versions.pin(pinned)
            old_ids = reads._review_ids(pinned, election_key, race_id)
            assert old_ids == [later_id]
            first.commit()
            assert reads._review_ids(pinned, election_key, race_id) == old_ids
            next_request = session()
            finance_versions.pin(next_request)
            new_ids = reads._review_ids(next_request, election_key, race_id)
            assert new_ids == [earlier_id, later_id]
            assert max(old_ids) == max(new_ids)
            assert reads._version_token(
                "results", "reports", old_ids, "payments"
            ) != reads._version_token("results", "reports", new_ids, "payments")
    finally:
        with engine.begin() as connection:
            connection.execute(text(f"DROP SCHEMA {schema} CASCADE"))


def test_pruned_payments_preserve_reports_and_invalidate_old_version(
    finance_api, finance_db, comparison
):
    previous = _data(finance_api)
    source_id = previous["payment_source"]["snapshot_id"]
    finance_db.execute(
        delete(m.CampaignFinanceIndependentExpenditureRow).where(
            m.CampaignFinanceIndependentExpenditureRow.snapshot_id == source_id,
            m.CampaignFinanceIndependentExpenditureRow.row_number == 1,
        )
    )
    finance_db.commit()
    assert (
        finance_api.get(URL, params={"version": previous["version"]}).status_code == 409
    )
    data = _data(finance_api)
    candidate = data["candidates"][0]
    assert data["report_availability"]["state"] == "available"
    assert (
        candidate["accounts"][0]["latest_report"]["figures"]["campaign_expenditures"][
            "total"
        ]
        == "7.00"
    )
    assert candidate["outside_spending"] == {
        "state": "unavailable",
        "groups": None,
        "total": None,
        "reason": "retained_payment_source_unavailable",
    }
    assert (
        finance_api.get(
            f"{URL}/candidates/a/outside-spending",
            params={"version": data["version"], "snapshot_id": data["snapshot_id"]},
        ).status_code
        == 503
    )


def test_no_current_report_collection_preserves_checked_outside_money(
    finance_api, finance_db, comparison
):
    finance_db.delete(finance_db.get(m.ElectionFinanceCurrent, KEY))
    finance_db.commit()
    data = _data(finance_api)
    candidate = data["candidates"][0]
    assert data["report_availability"]["reason"] == "no_published_collection"
    assert candidate["accounts"][0]["reports"] is None
    assert candidate["accounts"][0]["latest_report"]["state"] == "unavailable"
    assert candidate["outside_spending"]["total"]["record_count"] == 4


def test_missing_report_only_source_preserves_account_evidence(
    finance_api, finance_db, comparison
):
    collection = finance_db.get(m.ElectionFinanceCollection, COLLECTION)
    source_values = [
        *collection.sources,
        {
            "sha256": "0" * 64,
            "kind": "catalogue",
            "url": "https://cfb.mn.gov/reports/api/",
        },
    ]
    _publish_fixture_variant(finance_db, sources=source_values)
    finance_db.commit()
    data = _data(finance_api)
    assert data["report_availability"]["state"] == "unavailable"
    assert data["candidates"][0]["account_state"] == "checked"
    assert data["candidates"][0]["outside_spending"]["total"]["record_count"] == 4


def test_component_recovery_does_not_swallow_programming_errors(
    finance_api, comparison, monkeypatch
):
    def broken(*args):
        raise RuntimeError("unexpected programming failure")

    monkeypatch.setattr(reads, "_held_reports", broken)
    with pytest.raises(RuntimeError, match="unexpected programming failure"):
        finance_api.get(URL)


@pytest.mark.parametrize(
    "change,state",
    [
        ({"stable_id": "local:other:0335:a"}, "not_in_collection_roster"),
        ({"source_sha256": "0" * 64}, "roster_version_mismatch"),
        ({"name": "Different person"}, "candidate_identity_mismatch"),
        ({"office_id": "9999"}, "candidate_identity_mismatch"),
    ],
)
def test_coverage_never_joins_on_name_or_raw_id_alone(
    finance_api, finance_db, comparison, change, state
):
    collection = finance_db.get(m.ElectionFinanceCollection, COLLECTION)
    coverage = deepcopy(collection.coverage)
    coverage["candidates"][0].update(change)
    _publish_fixture_variant(finance_db, coverage=coverage)
    finance_db.commit()
    assert _data(finance_api)["candidates"][0]["finance_coverage"]["state"] == state


def test_duplicate_coverage_key_is_ambiguous(finance_api, finance_db, comparison):
    collection = finance_db.get(m.ElectionFinanceCollection, COLLECTION)
    coverage = deepcopy(collection.coverage)
    coverage["candidates"].append(coverage["candidates"][0])
    _publish_fixture_variant(finance_db, coverage=coverage)
    finance_db.commit()
    assert (
        _data(finance_api)["candidates"][0]["finance_coverage"]["state"]
        == "ambiguous_coverage"
    )


@pytest.mark.parametrize("authority", ["federal", "county_local"])
def test_exact_coverage_preserves_foreign_or_local_collection_gap(
    finance_api, finance_db, comparison, authority
):
    collection = finance_db.get(m.ElectionFinanceCollection, COLLECTION)
    coverage = deepcopy(collection.coverage)
    gap = (
        "Finance sources for this authority have not been recovered in this collection"
    )
    coverage["candidates"][1].update(authority=authority, gap=gap)
    _publish_fixture_variant(finance_db, coverage=coverage)
    finance_db.commit()
    candidate = _data(finance_api)["candidates"][1]
    assert candidate["account_state"] == "no_confirmed_link"
    assert candidate["finance_coverage"]["state"] == "matched"
    assert candidate["finance_coverage"]["authority"] == authority
    assert candidate["report_state"] == "not_collected"
    assert candidate["finance_coverage"]["gap"] == gap
    assert candidate["finance_coverage"]["source_sha256"] == SOURCE


def test_local_coverage_does_not_compare_county_to_municipal_jurisdiction(
    finance_api, finance_db, comparison
):
    race = comparison["race"]
    race.jurisdiction = "municipality:12345"
    finance_db.commit()
    assert _data(finance_api)["candidates"][1]["finance_coverage"]["state"] == "matched"


@pytest.mark.parametrize(
    "source_party,result_party,local,expected",
    [
        (None, "NP", True, "matched"),
        (None, "DFL", True, "candidate_identity_mismatch"),
        ("R", "NP", True, "candidate_identity_mismatch"),
        (None, "NP", False, "candidate_identity_mismatch"),
    ],
)
def test_local_roster_without_party_keeps_result_nonpartisan_designation(
    finance_api, finance_db, comparison, source_party, result_party, local, expected
):
    # LocalCandTbl has no party field; the matching official result says NP.
    # This establishes filing-authority coverage, never a campaign account link.
    race = comparison["race"]
    payload = deepcopy(race.payload)
    candidate = payload["candidates"][1]
    stable = candidate["candidate_stable_id"]
    if local:
        stable = "local_cand:" + stable.split(":", 1)[1]
    candidate.update(candidate_stable_id=stable, party=result_party)
    race.payload = payload
    collection = finance_db.get(m.ElectionFinanceCollection, COLLECTION)
    coverage = deepcopy(collection.coverage)
    coverage["candidates"][1].update(
        stable_id=stable, party=source_party, authority="county_local"
    )
    _publish_fixture_variant(finance_db, coverage=coverage)
    finance_db.commit()
    actual = _data(finance_api)["candidates"][1]
    assert actual["finance_coverage"]["state"] == expected
    assert actual["party"] == result_party
    assert actual["accounts"] == []
    if expected == "matched":
        assert actual["finance_coverage"]["party"] is None
        assert actual["report_state"] == "not_collected"


def test_public_account_name_keeps_exact_reviewed_register_value():
    account = {
        "registration_number": "-101",
        "evidence": [
            {
                "kind": "committee_register",
                "literal_fields": {
                    "RegisteredEntityID": "-101",
                    "RegisteredEntityFullName": "Filed committee",
                    "private_note": "do not expose",
                },
            },
            {
                "kind": "report_cover",
                "literal_fields": {"committee_name": "Cover name"},
            },
        ],
    }
    public = reads._public_account(None, account)
    assert public["committee_name"] == "Filed committee"
    assert all("literal_fields" not in item for item in public["evidence"])
    account["evidence"][0]["literal_fields"]["RegisteredEntityID"] = "different"
    assert reads._public_account(None, account)["committee_name"] is None


@pytest.mark.parametrize(
    "category,direction,expected",
    [
        ("PCF", "For", [1, 2, 9]),
        ("PCF", "Against", []),
        ("PTU", "For", []),
    ],
)
def test_candidate_payment_groups_page_only_the_attributed_position(
    finance_api, comparison, category, direction, expected
):
    context = _data(finance_api)
    response = finance_api.get(
        f"{URL}/candidates/a/outside-spending",
        params={
            "snapshot_id": context["snapshot_id"],
            "version": context["version"],
            "spender_type": category,
            "direction": direction,
        },
    )
    assert response.status_code == 200
    data = response.json()["data"]
    assert [r["row_number"] for r in data["rows"]] == expected
    assert data["page"]["total"] == len(expected)
    assert data["filters"] == {
        "spender_type": category,
        "direction": direction,
        "scope": "attributed",
    }


def test_published_historical_raw_sources_lines_auth_and_corruption(
    finance_api, finance_db, comparison, monkeypatch
):
    store = MemoryStore()
    body = b'{"name":"<script>"}\n{"amount":"0.00"}\n'
    fingerprint = archive_source(finance_db, store, body)
    historical = "7" * 64
    historical = _publish_fixture_variant(
        finance_db,
        sources=[
            {
                "sha256": fingerprint,
                "url": "https://cfb.mn.gov/reports/api/",
                "kind": "catalogue",
                "request_method": "POST",
                "request_form": {"id": "-101", "tabname": "reports_data"},
                "private_path": "/not-public",
            }
        ],
        coverage={"reports": 0},
        reports=[],
        make_current=False,
        election_key=KEY,
    ).id
    finance_db.commit()
    monkeypatch.setattr(reads, "raw_file_store_from_env", lambda: store)
    base = f"{BASE}/finance/sources/{fingerprint}"
    params = {"collection_id": historical}
    response = finance_api.get(f"{base}/raw", params=params)
    assert response.status_code == 200
    assert response.content == body
    assert response.headers["content-type"] == "application/octet-stream"
    assert response.headers["x-content-type-options"] == "nosniff"
    assert "private" in response.headers["cache-control"]
    response = finance_api.get(
        f"{base}/lines", params={**params, "start": 2, "limit": 1}
    )
    assert response.status_code == 200
    data = response.json()["data"]
    assert data["lines"] == [{"number": 2, "text": '{"amount":"0.00"}'}]
    assert data["source"]["request_form"] == {"id": "-101", "tabname": "reports_data"}
    assert "private_path" not in data["source"]
    assert data["source"]["collection_id"] == historical
    assert (
        finance_api.get(f"{base}/raw", params={"collection_id": COLLECTION}).status_code
        == 404
    )
    for path in (f"{base}/raw", f"{base}/lines"):
        assert (
            finance_api.get(
                path, params=params, headers={"Authorization": ""}
            ).status_code
            == 401
        )
    assert (
        finance_api.get(f"{base}/lines", params={**params, "limit": 101}).status_code
        == 422
    )
    assert (
        finance_api.get(f"{base}/lines", params={**params, "start": 0}).status_code
        == 422
    )
    row = finance_db.get(m.ElectionResultSource, fingerprint)
    store.objects[row.object_key] = b"corrupt"
    assert finance_api.get(f"{base}/raw", params=params).status_code == 503
    from sqlalchemy.exc import SQLAlchemyError

    with pytest.raises(SQLAlchemyError):
        with finance_db.begin_nested():
            finance_db.get(
                m.ElectionFinanceCollection, historical
            ).first_published_at = None
            finance_db.flush()


def test_account_evidence_keeps_original_collection_locator(finance_api, comparison):
    evidence = _data(finance_api)["candidates"][0]["accounts"][0]["evidence"]
    register = next(item for item in evidence if item["kind"] == "committee_register")
    assert register["collection_id"] == COLLECTION


def test_review_source_from_another_published_election_keeps_its_address(
    finance_api, finance_db, comparison, monkeypatch
):
    store = MemoryStore()
    body = b'{"committee":"retained directory"}\n'
    fingerprint = archive_source(finance_db, store, body)
    historical, other_election = "8" * 64, "mn-2024-11-05-general"
    historical = _publish_fixture_variant(
        finance_db,
        sources=[
            {
                "sha256": fingerprint,
                "kind": "candidate_directory",
                "url": "https://cfb.mn.gov/reports/api/",
            }
        ],
        coverage={"reports": 0},
        reports=[],
        make_current=False,
        election_key=other_election,
    ).id
    finance_db.flush()
    evidence = deepcopy(comparison["args"]["evidence"])
    evidence[1].update(collection_id=historical, sha256=fingerprint)
    reviews.record_decision(
        finance_db,
        **{
            **comparison["args"],
            "evidence": evidence,
            "expected_previous_id": comparison["decision"].id,
            "reason": "Retained directory from another published collection",
        },
    )
    finance_db.commit()
    before = _data(finance_api)
    account = before["candidates"][0]["accounts"][0]
    register = next(
        item for item in account["evidence"] if item["kind"] == "committee_register"
    )
    assert register["source_election_key"] == other_election
    assert register["collection_id"] == historical
    monkeypatch.setattr(reads, "raw_file_store_from_env", lambda: store)
    correct = (
        f"/api/v1/finance/elections/{other_election}/finance/sources/{fingerprint}/raw"
    )
    assert register["source_state"] == "available"
    assert finance_api.get(register["retained_source_url"]).content == body
    assert (
        finance_api.get(correct, params={"collection_id": historical}).content == body
    )
    wrong = f"{BASE}/finance/sources/{fingerprint}/raw"
    assert (
        finance_api.get(wrong, params={"collection_id": historical}).status_code == 404
    )
    from sqlalchemy.exc import SQLAlchemyError

    with pytest.raises(SQLAlchemyError):
        with finance_db.begin_nested():
            finance_db.get(
                m.ElectionFinanceCollection, historical
            ).first_published_at = None
            finance_db.flush()
    assert (
        finance_api.get(correct, params={"collection_id": historical}).content == body
    )


def test_unknown_candidate_stays_not_found_when_payment_release_missing(
    finance_api, finance_db, comparison
):
    finance_db.get(m.CampaignFinanceCurrentRelease, True).release_id = None
    finance_db.commit()
    data = _data(finance_api)
    response = finance_api.get(
        f"{URL}/candidates/foreign-candidate/outside-spending",
        params={"snapshot_id": data["snapshot_id"], "version": data["version"]},
    )
    assert response.status_code == 404


def test_received_date_is_report_cover_fact_not_cutoff(
    finance_api, finance_db, comparison
):
    report = finance_db.query(m.ElectionFinanceReport).first()
    payload = deepcopy(report.payload)
    payload["cover"] = {"received_date": "2026-10-26"}
    rows = _fixture_reports(finance_db)
    next(r for r in rows if r["report_key"] == report.report_key)["payload"] = payload
    _publish_fixture_variant(finance_db, reports=rows)
    finance_db.commit()
    reports = _data(finance_api)["candidates"][0]["accounts"][0]["reports"]
    found = next(item for item in reports if item["report_key"] == report.report_key)
    assert found["received_date"] == "2026-10-26"
    assert found["period_end"] == payload["period_end"]


@pytest.mark.parametrize("kind", ["candidate_roster", "local_candidate_roster"])
def test_both_official_rosters_keep_windows_1252_source_lines(
    finance_api, finance_db, comparison, monkeypatch, kind
):
    store = MemoryStore()
    original = "Candidate;Renée\r\n".encode("cp1252")
    fingerprint = archive_source(finance_db, store, original)
    collection = finance_db.get(m.ElectionFinanceCollection, COLLECTION)
    source_values = [*collection.sources, {"sha256": fingerprint, "kind": kind}]
    variant = _publish_fixture_variant(finance_db, sources=source_values)
    finance_db.commit()
    monkeypatch.setattr(reads, "raw_file_store_from_env", lambda: store)
    response = finance_api.get(
        f"{BASE}/finance/sources/{fingerprint}/lines",
        params={"collection_id": variant.id, "start": 1, "limit": 1},
    )
    assert response.status_code == 200
    assert response.json()["data"]["encoding"] == "windows-1252"
    assert response.json()["data"]["lines"] == [
        {"number": 1, "text": "Candidate;Renée"}
    ]


def test_removed_supplemental_evidence_invalidates_comparison_and_payment_pages(
    finance_api, finance_db, comparison
):
    store = MemoryStore()
    body = b"Additional retained source reviewed with this account"
    fingerprint = archive_source(finance_db, store, body)
    evidence = deepcopy(comparison["args"]["evidence"]) + [
        {"kind": "supplemental", "sha256": fingerprint}
    ]
    reviews.record_decision(
        finance_db,
        **{
            **comparison["args"],
            "evidence": evidence,
            "expected_previous_id": comparison["decision"].id,
            "reason": "Additional identity evidence reviewed",
        },
    )
    finance_db.commit()
    before = _data(finance_api)
    candidate = before["candidates"][0]
    assert candidate["account_state"] == "checked"
    payment_url = URL + "/candidates/" + candidate["candidate_id"] + "/outside-spending"
    # Changes to unrelated retained sources must not invalidate this comparison.
    unrelated = archive_source(finance_db, store, b"Unrelated evidence")
    finance_db.commit()
    assert _data(finance_api)["version"] == before["version"]
    finance_db.delete(finance_db.get(m.ElectionResultSource, unrelated))
    finance_db.commit()
    assert _data(finance_api)["version"] == before["version"]
    finance_db.delete(finance_db.get(m.ElectionResultSource, fingerprint))
    finance_db.commit()
    missing = _data(finance_api)
    assert missing["candidates"][0]["account_state"] == "unavailable"
    for url in (URL, payment_url):
        assert (
            finance_api.get(
                url,
                params={
                    "version": before["version"],
                    "snapshot_id": before["snapshot_id"],
                },
            ).status_code
            == 409
        )
    archive_source(finance_db, store, body)
    finance_db.commit()
    restored = _data(finance_api)
    assert restored["candidates"][0]["account_state"] == "checked"
    assert restored["version"] == before["version"]
    for url in (URL, payment_url):
        assert (
            finance_api.get(
                url,
                params={
                    "version": missing["version"],
                    "snapshot_id": missing["snapshot_id"],
                },
            ).status_code
            == 409
        )


def test_dated_payments_outside_reviewed_period_stay_traceable_but_unattributed(
    finance_api, comparison
):
    data = _data(finance_api)
    outside = data["candidates"][0]["outside_spending"]
    assert outside["excluded_outside_reviewed_period"]["record_count"] == 1
    assert outside["excluded_outside_reviewed_period"]["amount"] == "2.0000"
    response = finance_api.get(
        f"{URL}/candidates/a/outside-spending",
        params={
            "snapshot_id": data["snapshot_id"],
            "version": data["version"],
            "scope": "outside_reviewed_period",
        },
    )
    assert response.status_code == 200
    excluded = response.json()["data"]
    assert excluded["page"]["total"] == 1
    assert excluded["rows"][0]["row_number"] == 10
    assert excluded["rows"][0]["resolution"] == "outside_checked_period"
    assert excluded["rows"][0]["fields"]["Amount"] == "2.0000"
    assert excluded["filters"]["scope"] == "outside_reviewed_period"
    assert excluded["payment_source"] == data["payment_source"]
    # The ordinary attributed payment page keeps its original four records.
    attributed = finance_api.get(
        f"{URL}/candidates/a/outside-spending",
        params={"snapshot_id": data["snapshot_id"], "version": data["version"]},
    ).json()["data"]
    assert attributed["page"]["total"] == 4
    assert 10 not in [row["row_number"] for row in attributed["rows"]]


def test_typed_register_name_requires_a_matching_retained_source(
    finance_db, comparison
):
    evidence = deepcopy(comparison["args"]["evidence"])
    register = next(item for item in evidence if item["kind"] == "committee_register")
    register["literal_fields"] = {
        "RegisteredEntityID": "-101",
        "RegisteredEntityFullName": "A name never printed in the retained source",
    }
    with pytest.raises(ComparisonImportError, match="register"):
        reviews.record_decision(
            finance_db,
            **{
                **comparison["args"],
                "evidence": evidence,
                "expected_previous_id": comparison["decision"].id,
            },
        )


@pytest.mark.parametrize(
    "change", [None, "name", "columns", "locator", "account", "corrupt"]
)
def test_register_quotes_are_checked_against_exact_retained_bytes(
    finance_db, comparison, monkeypatch, change
):
    import json

    store = MemoryStore()
    columns = ["RegisteredEntityID", "RegisteredEntityFullName"]
    fields = {
        "RegisteredEntityID": "-101",
        "RegisteredEntityFullName": "Filed committee",
    }
    body = json.dumps(
        {"cols": columns, "data": {"-101": [["-101", "Filed committee"]]}}
    ).encode()
    fingerprint = archive_source(finance_db, store, body)
    collection = finance_db.get(m.ElectionFinanceCollection, COLLECTION)
    source_values = [
        *collection.sources,
        {
            "sha256": fingerprint,
            "kind": "candidate_directory",
            "url": "https://cfb.mn.gov/reports/api/",
        },
    ]
    variant = _publish_fixture_variant(finance_db, sources=source_values)
    evidence = deepcopy(comparison["args"]["evidence"])
    register = next(item for item in evidence if item["kind"] == "committee_register")
    register.update(
        sha256=fingerprint,
        collection_id=variant.id,
        column_names=columns,
        literal_fields=fields,
        locator="/data/-101/0",
    )
    monkeypatch.setattr(reviews, "raw_file_store_from_env", lambda: store)
    if change == "name":
        fields["RegisteredEntityFullName"] = "Invented name"
    if change == "columns":
        register["column_names"] = list(reversed(columns))
    if change == "locator":
        register["locator"] = "/data/-101/1"
    if change == "account":
        register["locator"] = "/data/another/0"
    if change == "corrupt":

        def broken(*args, **kwargs):
            raise OSError("missing source")

        monkeypatch.setattr(store, "get", broken)
    args = {
        **comparison["args"],
        "evidence": evidence,
        "expected_previous_id": comparison["decision"].id,
    }
    if change:
        with pytest.raises(ComparisonImportError, match="register"):
            reviews.record_decision(finance_db, **args)
    else:
        row = reviews.record_decision(finance_db, **args)
        assert row.evidence == evidence
        public = reads._public_account(
            finance_db, {"registration_number": "-101", "evidence": row.evidence}
        )
        assert public["committee_name"] == "Filed committee"


def test_report_cover_quote_cannot_override_retained_parsed_fields(
    finance_db, comparison
):
    evidence = deepcopy(comparison["args"]["evidence"])
    cover = next(item for item in evidence if item["kind"] == "report_cover")
    cover["literal_fields"] = {"committee_name": "Invented cover"}
    with pytest.raises(ComparisonImportError, match="Report-cover quotes"):
        reviews.record_decision(
            finance_db,
            **{
                **comparison["args"],
                "evidence": evidence,
                "expected_previous_id": comparison["decision"].id,
            },
        )


def test_release_audit_partitions_each_source_row_once_with_nulls_and_duplicates(
    finance_db, comparison
):
    from scripts.audit_election_attribution import audit

    receipt = audit(finance_db, KEY)
    assert receipt["count"] == 8
    assert receipt["known_amount"] == "51.0000"
    assert receipt["missing_amount_count"] == 1
    assert receipt["each_row_exactly_once"] is True
    assert {key: value["count"] for key, value in receipt["buckets"].items()} == {
        "attributed": 4,
        "no_confirmed_account": 2,
        "missing_date": 1,
        "outside_reviewed_period": 1,
    }
    assert {row["row_number"] for row in receipt["rows"]} == {1, 2, 3, 4, 7, 8, 9, 10}
    assert receipt["decision_ids"] == [comparison["decision"].id]


def test_published_expense_payload_cannot_change_without_generation_id(
    finance_db, comparison
):
    report = finance_db.get(m.ElectionFinanceReport, (COLLECTION, "-101", "1" * 64))
    from sqlalchemy.exc import SQLAlchemyError

    with pytest.raises(SQLAlchemyError):
        with finance_db.begin_nested():
            report.payload = {
                **report.payload,
                "campaign_expenses": {
                    "status": "checked",
                    "rows": [{"payee": "typed change"}],
                },
            }
            finance_db.flush()
