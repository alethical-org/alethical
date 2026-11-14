"""Full global report checks need only filing fields; replies need scoped bodies."""

# Imported fixtures retain the existing isolated finance setup.
# ruff: noqa: F401,F811
from copy import deepcopy
import hashlib
import json
import os
from pathlib import Path
from typing import Any
import signal
import time
from unittest.mock import patch

import pytest
from sqlalchemy import event, select, text

from alethical.api.services import election_finance_reads as reads
from alethical.db import models as m
from alethical.pipeline.raw_file_store import RawFileStore
from alethical.tests.finance_fixtures import finance_db
from alethical.tests.test_election_finance_reads import (
    comparison,
    COLLECTION,
    KEY,
    RACE,
    _fixture_reports,
    _publish_fixture_variant,
)
from alethical.tests.test_election_outside_spending import spending


@pytest.fixture
def report_scale(finance_db, comparison, request):
    count = getattr(request, "param", 100)
    if not count:
        return {"unrelated": 0}
    rows = _fixture_reports(finance_db)
    template = deepcopy(rows[0])
    filler = "\n".join(
        f"Retained source line {i}: synthetic report text and literal values."
        for i in range(128)
    )
    for number in range(count):
        registration = str(-10000 - number)
        digest = hashlib.sha256(f"unrelated document {number}".encode()).hexdigest()
        finance_db.add(
            m.CampaignFinanceReportDocument(
                document_hash=digest,
                object_key=f"fixture/{digest}.gz",
                byte_size=1,
                compressed_hash=digest,
                compressed_byte_size=1,
                registration_number=registration,
                filing_year=2026,
                report_type="E",
                amendment_index=0,
                special_election=False,
            )
        )
        row = deepcopy(template)
        row.update(
            registration_number=registration,
            report_key=hashlib.sha256(
                f"unrelated report {number}".encode()
            ).hexdigest(),
            document_hash=digest,
        )
        row["payload"]["filing"]["registration_number"] = registration
        row["payload"]["document"]["sha256"] = digest
        row["payload"]["retained_text"] = filler
        rows.append(row)
    finance_db.flush()
    old = finance_db.get(m.ElectionFinanceCollection, COLLECTION)
    collection = _publish_fixture_variant(
        finance_db, reports=rows, coverage={**old.coverage, "reports": len(rows)}
    )
    finance_db.commit()
    return {"unrelated": count, "collection_id": collection.id}


def _call(db, operation, module=reads):
    kwargs = dict(election_key=KEY, race_id=RACE, snapshot_id="a" * 64)
    if operation == "comparison":
        return module.comparison(db, **kwargs)
    return module.outside_records(
        db, **kwargs, candidate_id="a", version=None, limit=2, offset=0
    )


def _capture(db, operation, module=reads):
    statements = []

    def after(conn, cursor, statement, parameters, context, many):
        statements.append((" ".join(statement.split()), cursor.rowcount))

    conn = db.connection()
    event.listen(conn, "after_cursor_execute", after)
    start = time.perf_counter()
    try:
        with (
            patch.object(module, "_accounts", wraps=module._accounts) as accounts,
            patch.object(
                module, "applicable_accounts", wraps=module.applicable_accounts
            ) as applicable,
            patch.object(
                RawFileStore,
                "get",
                side_effect=AssertionError("Remote store forbidden in local fixture"),
            ) as raw_get,
        ):
            answer = _call(db, operation, module)
            proof_counts = {
                "accounts_calls": accounts.call_count,
                "applicable_accounts_calls": applicable.call_count,
                "raw_store_get_calls": raw_get.call_count,
            }
    finally:
        elapsed = time.perf_counter() - start
        event.remove(conn, "after_cursor_execute", after)
    full = [
        (sql, rows)
        for sql, rows in statements
        if "FROM election_finance_report " in sql
        and sql.split(" FROM ", 1)[0].endswith("election_finance_report.payload")
    ]
    return answer, {
        **proof_counts,
        "wall_seconds": elapsed,
        "query_count": len(statements),
        "full_report_queries": len(full),
        "full_report_rows": sum(rows for _, rows in full),
        "report_sql": [
            sql for sql, _ in statements if "FROM election_finance_report " in sql
        ],
    }


@pytest.mark.parametrize("operation", ["comparison", "outside"])
def test_full_report_payloads_are_scoped_to_reply(finance_db, report_scale, operation):
    answer, measured = _capture(finance_db, operation)
    assert answer["report_availability"]["state"] == "available"
    assert measured["full_report_queries"] <= (1 if operation == "comparison" else 0)
    assert measured["full_report_rows"] <= (2 if operation == "comparison" else 0)


@pytest.mark.parametrize("report_scale", [0, 100, 1000], indirect=True)
def test_report_payload_scope_and_answers_hold_at_scale(finance_db, report_scale):
    target = os.environ.get("ELECTION_SPEED_RECEIPT")
    if target:
        finance_db.execute(text("SET LOCAL statement_timeout = '5s'"))
    rows = finance_db.execute(
        text(
            "SELECT count(*), sum(octet_length(payload::text)), sum(octet_length((payload->'filing')::text)) FROM election_finance_report WHERE collection_id=(SELECT collection_id FROM election_finance_current WHERE election_key=:key)"
        ),
        {"key": KEY},
    ).one()
    result = {
        **report_scale,
        "stored_report_count": rows[0],
        "logical_full_payload_bytes_per_check": rows[1],
        "logical_filing_bytes_per_check": rows[2],
        "operations": {},
    }

    def expired(*args):
        raise TimeoutError("Bounded local service call exceeded15seconds")

    prior = signal.signal(signal.SIGALRM, expired) if target else None
    try:
        for operation in ("comparison", "outside"):
            finance_db.expunge_all()
            if target:
                signal.alarm(15)
            answer, measured = _capture(finance_db, operation)
            if target:
                signal.alarm(0)
            assert measured["full_report_queries"] <= (
                1 if operation == "comparison" else 0
            )
            assert measured["full_report_rows"] <= (
                2 if operation == "comparison" else 0
            )
            measured["answer_sha256"] = hashlib.sha256(
                json.dumps(answer, sort_keys=True).encode()
            ).hexdigest()
            measured["reply_report_count"] = sum(
                len(a["reports"] or [])
                for c in answer.get("candidates", [])
                for a in c["accounts"]
            )
            finance_db.expunge_all()
            if target:
                signal.alarm(15)
            with (
                patch.object(reads, "_held_reports", _reference_held_reports),
                patch.object(reads, "comparison", _referencecomparison),
            ):
                reference, reference_measured = _capture(finance_db, operation)
            if target:
                signal.alarm(0)
            assert answer == reference
            measured["old_reference"] = reference_measured
            measured["exact_whole_answer_equal"] = True
            result["operations"][operation] = measured
    finally:
        if target:
            signal.alarm(0)
            signal.signal(signal.SIGALRM, prior)
    if target:
        with Path(target).open("a") as output:
            output.write(json.dumps(result) + "\n")


# Frozen pre-change implementation, main77ab9283.
def _reference_held_reports(db, collection):
    reports = db.scalars(
        select(m.ElectionFinanceReport).where(
            m.ElectionFinanceReport.collection_id == collection.id
        )
    ).all()
    if len(reports) != collection.coverage.get("reports"):
        reads._unavailable()
    hashes = {source["sha256"] for source in collection.sources}
    held = set(
        db.scalars(
            select(m.ElectionResultSource.content_hash).where(
                m.ElectionResultSource.content_hash.in_(hashes)
            )
        )
    )
    if held != hashes:
        reads._unavailable()
    document_hashes = {
        report.document_hash for report in reports if report.document_hash
    }
    documents = {
        doc.document_hash: doc
        for doc in db.scalars(
            select(m.CampaignFinanceReportDocument).where(
                m.CampaignFinanceReportDocument.document_hash.in_(document_hashes)
            )
        )
    }
    if set(documents) != document_hashes:
        reads._unavailable()
    for report in reports:
        if report.document_hash:
            doc, filing = documents[report.document_hash], report.payload["filing"]
            if (
                doc.registration_number,
                doc.filing_year,
                doc.report_type,
                doc.amendment_index,
                doc.special_election,
            ) != (
                report.registration_number,
                filing["filing_year"],
                filing["report_type"],
                filing["effective_amendment_index"],
                filing["special_election"],
            ):
                reads._unavailable()
    return reports


# Frozen pre-change implementation, main77ab9283.
def _referencecomparison(db, *, election_key, race_id, snapshot_id=None, version=None):
    context, election, race, collection, reports, release, outcome = reads._context(
        db, election_key, race_id, snapshot_id, version
    )
    candidates = []
    source_hashes = set()
    for candidate in race.payload["candidates"]:
        links = reads._accounts(db, election_key, race, candidate)
        candidate_coverage = reads._candidate_coverage(collection, race, candidate)
        report_state = (
            "unavailable"
            if reports is None
            else "not_collected"
            if not links["accounts"]
            and candidate_coverage.get("state") == "matched"
            and candidate_coverage.get("authority") in {"federal", "county_local"}
            and candidate_coverage.get("gap")
            else links["state"]
        )
        accounts = []
        for account in links["accounts"]:
            source_hashes.update(item.get("sha256") for item in account["evidence"])
            if reports is None:
                accounts.append(
                    {
                        **reads._public_account(db, account),
                        "reports": None,
                        "latest_report": {
                            "state": "unavailable",
                            "report_key": None,
                            "figures": None,
                        },
                    }
                )
                continue
            entries = [
                reads._report(db, election_key, race, candidate, account, report)
                for report in reports
                if report.registration_number == account["registration_number"]
                and account["authority"] == "mn_cfb"
            ]
            entries.sort(
                key=lambda r: (r["filing"].get("cut_off_date") or "", r["report_key"]),
                reverse=True,
            )
            source_hashes.update(
                entry[field].get("sha256")
                for entry in entries
                for field in ("catalogue_source", "financial_source", "document")
            )
            accounts.append(
                {
                    **reads._public_account(db, account),
                    "reports": entries,
                    "latest_report": reads._latest(entries, collection.copied_at),
                }
            )
        candidates.append(
            {
                **candidate,
                **outcome["candidates"][candidate["candidate_id"]],
                "account_state": links["state"],
                "account_gaps": links["gaps"],
                "accounts": accounts,
                "finance_coverage": candidate_coverage,
                "report_state": report_state,
                "outside_spending": reads._outside(
                    db, release, election.election_date.year, links
                ),
            }
        )
    context["sources"] = [
        source for source in context["sources"] if source.get("sha256") in source_hashes
    ]
    reads._check_end_version(db, context)
    return {
        **context,
        "race_id": race.id,
        "race_label": race.label,
        "candidates": candidates,
        "measure_note": "Each report keeps its own dates and totals; overlapping reports and accounts are not added together",
    }


def _old_reply(db, operation):
    with (
        patch.object(reads, "_held_reports", _reference_held_reports),
        patch.object(reads, "comparison", _referencecomparison),
    ):
        return _call(db, operation)


@pytest.mark.parametrize("operation", ["comparison", "outside"])
def test_complete_reply_matches_old_global_payload_path(
    finance_db, report_scale, operation
):
    assert _call(finance_db, operation) == _old_reply(finance_db, operation)


@pytest.mark.parametrize(
    "damage", ["missing", "wrong_registration", "wrong_collection", "duplicate"]
)
def test_selected_payload_loss_or_substitution_fails_closed(
    finance_db, comparison, monkeypatch, damage
):
    original = finance_db.scalars

    def damaged(query, *args, **kwargs):
        result = original(query, *args, **kwargs)
        if query.column_descriptions[0]["entity"] is not m.ElectionFinanceReport:
            return result
        rows = list(result)
        if damage == "missing":
            return iter(rows[1:])
        if damage == "duplicate":
            return iter([*rows, rows[0]])
        from types import SimpleNamespace

        return iter(
            [
                SimpleNamespace(
                    collection_id="other"
                    if damage == "wrong_collection"
                    else row.collection_id,
                    registration_number="other"
                    if damage == "wrong_registration"
                    else row.registration_number,
                    report_key=row.report_key,
                )
                for row in rows
            ]
        )

    monkeypatch.setattr(finance_db, "scalars", damaged)
    from fastapi import HTTPException

    with pytest.raises(HTTPException) as error:
        _call(finance_db, "comparison")
    assert error.value.status_code == 503


@pytest.mark.parametrize("operation", ["comparison", "outside"])
@pytest.mark.parametrize("when", ["start", "end"])
def test_off_race_missing_document_is_checked_at_both_ends(
    finance_db, report_scale, monkeypatch, operation, when
):
    original = finance_db.scalars
    calls = []

    def documents(query, *args, **kwargs):
        result = original(query, *args, **kwargs)
        if (
            query.column_descriptions[0]["entity"]
            is not m.CampaignFinanceReportDocument
        ):
            return result
        calls.append(1)
        if when == "start" or len(calls) == 2:
            return (row for row in result if row.registration_number == "-101")
        return result

    monkeypatch.setattr(finance_db, "scalars", documents)
    if when == "end":
        from fastapi import HTTPException

        with pytest.raises(HTTPException) as error:
            _call(finance_db, operation)
        assert error.value.status_code == 409
    else:
        actual = _call(finance_db, operation)
        assert actual["report_availability"]["state"] == "unavailable"
        if operation == "comparison":
            candidate = actual["candidates"][0]
            assert candidate["accounts"][0]["reports"] is None
            assert candidate["outside_spending"]["total"]["record_count"] == 4
        else:
            assert actual["page"]["total"] == 4
    assert len(calls) == 2


def test_off_race_filing_mismatch_keeps_old_unavailable_state(finance_db, report_scale):
    document = finance_db.scalar(
        select(m.CampaignFinanceReportDocument).where(
            m.CampaignFinanceReportDocument.registration_number != "-101",
            m.CampaignFinanceReportDocument.object_key.startswith("fixture/"),
        )
    )
    document.filing_year = 2025
    finance_db.commit()
    for operation in ("comparison", "outside"):
        actual = _call(finance_db, operation)
        assert actual == _old_reply(finance_db, operation)
        assert actual["report_availability"]["state"] == "unavailable"


def _legacy_collection(db, monkeypatch):
    from types import SimpleNamespace

    rows = _fixture_reports(db)
    rows.append(
        dict(
            registration_number="-legacy",
            report_key="d" * 64,
            document_hash=None,
            payload={},
        )
    )
    old = db.get(m.ElectionFinanceCollection, COLLECTION)
    parent = _publish_fixture_variant(
        db, reports=rows, coverage={**old.coverage, "reports": len(rows)}
    )
    db.commit()
    # Current DB guards correctly forbid creating an unsealed publication.
    # Supply the legacy reader header shape without disabling those guards.
    original = reads._collection
    legacy = SimpleNamespace(
        **{
            column.name: getattr(parent, column.name)
            for column in m.ElectionFinanceCollection.__table__.columns
        }
    )
    legacy.sealed_at, legacy.report_index = None, None

    def collection(*args, **kwargs):
        value = original(*args, **kwargs)
        return legacy if value.id == parent.id else value

    monkeypatch.setattr(reads, "_collection", collection)
    return legacy


@pytest.mark.parametrize("missing_row", [False, True])
def test_unsealed_legacy_absent_filing_and_row_loss_keep_old_behavior(
    finance_db, comparison, monkeypatch, missing_row
):
    collection = _legacy_collection(finance_db, monkeypatch)
    assert collection.sealed_at is None
    if missing_row:
        row = finance_db.get(
            m.ElectionFinanceReport, (collection.id, "-legacy", "d" * 64)
        )
        from sqlalchemy.exc import SQLAlchemyError

        with pytest.raises(SQLAlchemyError, match="immutable"):
            with finance_db.begin_nested():
                finance_db.delete(row)
                finance_db.flush()
        # Actual deletion is forbidden. Inject a missing read result to exercise
        # the existing availability guard without bypassing that DB protection.
        original_execute, original_scalars = finance_db.execute, finance_db.scalars

        def missing_metadata(query, *args, **kwargs):
            result = original_execute(query, *args, **kwargs)
            if [
                column["name"] for column in getattr(query, "column_descriptions", [])
            ] == ["registration_number", "report_key", "document_hash", "filing"]:
                from types import SimpleNamespace

                return SimpleNamespace(
                    all=lambda: [
                        row for row in result if row.registration_number != "-legacy"
                    ]
                )
            return result

        def missing_body(query, *args, **kwargs):
            result = original_scalars(query, *args, **kwargs)
            if query.column_descriptions[0]["entity"] is m.ElectionFinanceReport:

                class Rows(list):
                    def all(self):
                        return self

                return Rows(
                    row for row in result if row.registration_number != "-legacy"
                )
            return result

        monkeypatch.setattr(finance_db, "execute", missing_metadata)
        monkeypatch.setattr(finance_db, "scalars", missing_body)
    for operation in ("comparison", "outside"):
        actual = _call(finance_db, operation)
        assert actual == _old_reply(finance_db, operation)
        assert actual["report_availability"]["state"] == (
            "unavailable" if missing_row else "available"
        )


def test_same_report_key_other_registration_never_substitutes(finance_db, comparison):
    rows = _fixture_reports(finance_db)
    other = deepcopy(rows[0])
    other.update(registration_number="-other", document_hash=None)
    other["payload"] = {"filing": {}, "figure_status": "unavailable"}
    rows.append(other)
    original = finance_db.get(m.ElectionFinanceCollection, COLLECTION)
    _publish_fixture_variant(
        finance_db, reports=rows, coverage={**original.coverage, "reports": len(rows)}
    )
    finance_db.commit()
    actual = _call(finance_db, "comparison")
    assert actual == _old_reply(finance_db, "comparison")
    assert [
        a["registration_number"] for c in actual["candidates"] for a in c["accounts"]
    ] == ["-101"]


def test_withdrawn_accounts_load_no_full_report_bodies(finance_db, comparison):
    from alethical.pipeline import election_account_reviews as reviews

    args: dict[str, Any] = {
        **comparison["args"],
        "decision": "withdrawn",
        "expected_previous_id": comparison["decision"].id,
        "reason": "Synthetic withdrawal keeps complete global checks",
    }
    reviews.record_decision(finance_db, **args)
    finance_db.commit()
    actual, measured = _capture(finance_db, "comparison")
    assert actual == _old_reply(finance_db, "comparison")
    assert measured["full_report_queries"] == measured["full_report_rows"] == 0
    assert actual["report_availability"]["state"] == "available"
    assert actual["candidates"][0]["accounts"] == []
