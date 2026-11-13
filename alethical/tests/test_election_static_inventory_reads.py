"""Normal static groups through current/history, expense and export readers."""

# ruff: noqa: F401, F811 - imported pytest fixtures are requested by name.
from copy import deepcopy
from functools import wraps
import csv
import io
import json

from fastapi import HTTPException
import pytest
from sqlalchemy.orm import Session

from alethical.api.services import election_analytics as analytics
from alethical.api.services import election_comparison_export as export
from alethical.api.services import election_comparison_reads as results
from alethical.api.services import election_expense_analytics as expenses
from alethical.api.services import election_external_finance_reads as reads
from alethical.api.services import election_source_io
from alethical.db import models as m
from alethical.pipeline import election_account_reviews as reviews
from alethical.pipeline import election_external_finance as storage
from alethical.pipeline import election_source_readings as readings
from alethical.pipeline.election_comparison import ComparisonImportError
from alethical.pipeline.election_source_files import SourceFileLimitError
from alethical.tests.test_election_static_inventory_integration import (
    db,
    isolated_engine,
    local_generation,
    static_generation,
    static_relationship_review_args,
)

pytestmark = [
    pytest.mark.parametrize(
        "local_generation", [{"ballot_county": "31"}], indirect=True
    ),
    pytest.mark.parametrize(
        "static_generation", [{"financial_fields": True}], indirect=True
    ),
]


@pytest.fixture
def published_static(db, static_generation, monkeypatch):
    item = static_generation
    storage.stage_generation(db, item.store, item.g, item.originals)
    for index in range(3):
        binding = item.binding(index, "candidate_relationship")
        reviews.record_decision(
            db, **static_relationship_review_args(item, binding, index)
        )
    storage.publish_generation(db, item.store, item.g["id"], expected_previous=None)
    snapshot = db.get(m.ElectionComparisonSnapshot, item.g["snapshot_id"])
    snapshot.first_published_at = snapshot.fetched_at
    db.add(
        m.ElectionComparisonCurrent(
            election_key=item.g["election_key"], snapshot_id=snapshot.id
        )
    )
    db.flush()
    for module in (reads, expenses, analytics, results):
        monkeypatch.setattr(module, "raw_file_store_from_env", lambda: item.store)
    monkeypatch.setattr(election_source_io, "reader_store_from_env", lambda: item.store)

    def request_wrapper(fn):
        fn = getattr(fn, "__wrapped__", fn)

        @wraps(fn)
        def request(session, *args, **kwargs):
            if session is not db:
                # Nested readers stay in the same already-pinned request.
                assert session.connection().get_isolation_level() == "REPEATABLE READ"
                return fn(session, *args, **kwargs)
            db.commit()
            with (
                db.get_bind()
                .connect()
                .execution_options(isolation_level="REPEATABLE READ") as connection
            ):
                with Session(connection) as reader:
                    return fn(reader, *args, **kwargs)

        return request

    for module, name in (
        (reads, "candidate_finance"),
        (reads, "bulk_finance"),
        (expenses, "report"),
        (analytics, "funders"),
        (export, "export_csv"),
    ):
        monkeypatch.setattr(module, name, request_wrapper(getattr(module, name)))
    return item


def query(item):
    return dict(
        election_key=item.g["election_key"],
        race_id=item.base.race.id,
        candidate_id=item.base.candidate["candidate_id"],
        store=item.store,
    )


def checked_reports(data, *, derived):
    reports = data["reports"]
    assert len(reports) == 3
    assert all(r["figures"][0]["value"] == "1101.75" for r in reports)
    if derived:
        assert all(r["effective"] is True for r in reports)
        assert len({r["selection_group_key"] for r in reports}) == 1
    else:
        assert all(r["effective"] is None for r in reports)
        assert all("selection_group_key" not in r for r in reports)
    return reports


def test_static_current_history_and_bulk_preserve_distinct_accounts(
    db, published_static, monkeypatch
):
    item = published_static

    def no_render(*args, **kwargs):
        pytest.fail("Ordinary static reader rendered a source")

    monkeypatch.setattr(readings, "render_page", no_render)
    first = reads.candidate_finance(db, **query(item))
    checked_reports(first, derived=True)
    assert len(first["accounts"]) == 3
    assert len({a["account_id"] for a in first["accounts"]}) == 3
    assert all(a["issued_id"] is False for a in first["accounts"])
    bulk = reads.bulk_finance(db, election_key=item.g["election_key"], store=item.store)
    checked_reports(bulk["candidates"][0], derived=True)
    encoded = json.dumps(first)
    assert "PRIVATE_" not in encoded
    assert all(d.row.receipt_sha256 not in encoded for d in item.documents)
    payload = deepcopy(item.g)
    payload.pop("id")
    for report in payload["reports"]:
        report.pop("version_binding")
    raw = storage.prepare_generation(payload)
    storage.stage_generation(db, item.store, raw, item.originals)
    storage.publish_generation(
        db, item.store, raw["id"], expected_previous=item.g["id"]
    )
    checked_reports(reads.candidate_finance(db, **query(item)), derived=False)
    checked_reports(
        reads.candidate_finance(db, **query(item), generation_id=item.g["id"]),
        derived=True,
    )


@pytest.mark.parametrize("failure", ["withdrawal", "missing_original"])
def test_static_companion_failure_holds_group_without_erasing_figures(
    db, published_static, failure
):
    item = published_static
    first = reads.candidate_finance(db, **query(item))
    companion = item.documents[3]
    if failure == "withdrawal":
        withdrawn = readings.record_reading(
            db,
            item.store,
            receipt=companion.receipt,
            decision="withdrawn",
            reviewed_by="PRIVATE_TEST",
            reason="Withdraw certificate",
            expected_previous_id=companion.row.id,
        )
    else:
        key = db.get(
            m.ElectionResultSource, companion.receipt["original_sha256"]
        ).object_key
        original = item.store.objects.pop(key)
    for scope in ({}, {"generation_id": item.g["id"]}):
        fresh = reads.candidate_finance(db, **query(item), **scope)
        checked_reports(fresh, derived=False)
        assert fresh["version"] != first["version"]
        with pytest.raises(HTTPException) as error:
            reads.candidate_finance(
                db, **query(item), **scope, version=first["version"]
            )
        assert error.value.status_code == 409
    if failure == "withdrawal":
        with pytest.raises(
            ComparisonImportError, match="Source reading review changed"
        ):
            readings.record_reading(
                db,
                item.store,
                receipt=companion.receipt,
                decision="checked",
                reviewed_by="PRIVATE_TEST",
                reason="Stale restore",
                expected_previous_id=companion.row.id,
            )
        readings.record_reading(
            db,
            item.store,
            receipt=companion.receipt,
            decision="checked",
            reviewed_by="PRIVATE_TEST",
            reason="Restore exact certificate",
            expected_previous_id=withdrawn.id,
        )
    else:
        item.store.objects[key] = original
    checked_reports(reads.candidate_finance(db, **query(item)), derived=True)


@pytest.mark.parametrize("route", ["candidate", "bulk"])
def test_static_inventory_capacity_is_retryable(
    db, published_static, monkeypatch, route
):
    item = published_static

    def busy(*args, **kwargs):
        raise SourceFileLimitError("Synthetic capacity")

    monkeypatch.setattr(storage, "validate_report_version", busy)
    with pytest.raises(HTTPException) as error:
        if route == "candidate":
            reads.candidate_finance(db, **query(item))
        else:
            reads.bulk_finance(
                db, election_key=item.g["election_key"], store=item.store
            )
    assert error.value.status_code == 503
    assert error.value.headers == {"Retry-After": "1"}


def test_static_group_reaches_expense_funder_and_race_csv_without_relabelling(
    db, published_static
):
    item = published_static
    args = dict(election_key=item.g["election_key"], snapshot_id=item.g["snapshot_id"])
    data = expenses.report(db, **args)
    assert [r["report_key"] for r in data["authority_reports"]] == [
        item.reports[2]["report_key"]
    ]
    assert data["summary"]["public_subsidy_receipts"]["amount"] is None
    # Own campaign figures do not create a funder supporting the candidate.
    assert analytics.funders(db, **args)["funders"] == []
    body = export.export_csv(db, **args, race_id=item.base.race.id)
    rows = list(csv.DictReader(io.StringIO(body.decode("utf-8-sig"))))
    report_rows = [r for r in rows if r["Row type"] == "Report"]
    assert [r["Report key"] for r in report_rows] == [item.reports[2]["report_key"]]
    measure_rows = [r for r in rows if r["Row type"] == "Figure"]
    assert [(r["Measure ID"], r["Measure value"]) for r in measure_rows] == [
        ("disbursements", "1101.75")
    ]
    explicit = expenses.report(db, **args, report_keys=[item.reports[0]["report_key"]])
    assert [r["report_key"] for r in explicit["authority_reports"]] == [
        item.reports[0]["report_key"]
    ]
