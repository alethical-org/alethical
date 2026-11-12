"""Exact PDF excerpts keep document proof, public pins and historical dependencies."""

# Imported fixtures are intentionally rebound by pytest.
# ruff: noqa: F401,F811

from copy import deepcopy
import csv
import hashlib
import io
from types import SimpleNamespace
from urllib.parse import parse_qs, urlsplit

from fastapi import HTTPException
from pypdf import PdfReader, PdfWriter
import pytest
from sqlalchemy import select

from alethical.api.services import election_analytics as analytics_reads
from alethical.api.services import election_comparison_export as race_export
from alethical.api.services import election_comparison_reads as results
from alethical.api.services import election_expense_analytics as expenses
from alethical.api.services import election_finance_reads as finance
from alethical.api.services import election_outside_spending as outside
from alethical.db import models as m
from alethical.pipeline import election_account_reviews as reviews
from alethical.pipeline.campaign_finance_report_document_store import DocumentKeeper
from alethical.tests.finance_fixtures import finance_api, finance_db
from alethical.tests.test_campaign_finance_stated_split import pdf_of
from alethical.tests.test_election_analytics import analytics
from alethical.tests.test_election_comparison_reads import KEY, RACE, SNAPSHOT
from alethical.tests.test_election_finance_reads import (
    COLLECTION,
    comparison,
    _fixture_reports,
    _publish_fixture_variant,
)
from alethical.tests.test_election_outside_spending import spending


@pytest.fixture
def excerpt_context(finance_db, analytics, comparison, monkeypatch, tmp_path):
    store = analytics.retained_store
    writer = PdfWriter()
    for lines in [["Synthetic cover"], ["Committee evidence", "JD campaign stickers"]]:
        writer.add_page(PdfReader(io.BytesIO(pdf_of(lines))).pages[0])
    output = io.BytesIO()
    writer.write(output)
    body = output.getvalue()
    fingerprint = hashlib.sha256(body).hexdigest()
    keeper = DocumentKeeper(db=finance_db, store=store, directory=str(tmp_path))
    assert (
        keeper.keep(
            document_hash=fingerprint,
            body=body,
            registration_number="-101",
            filing_year=2026,
            report_type="P",
            amendment_index=0,
            special_election=False,
        )
        != "failed"
    )
    reports = _fixture_reports(finance_db)
    prior = next(r for r in reports if r["payload"]["filing"]["report_type"] == "P")
    prior["document_hash"] = fingerprint
    prior["payload"]["document"]["sha256"] = fingerprint
    collection = _publish_fixture_variant(finance_db, reports=reports)
    excerpt = {
        "kind": "report_excerpt",
        "sha256": fingerprint,
        "collection_id": collection.id,
        "page": 2,
        "locator": {"type": "native_pdf_lines"},
        "literal_fields": {
            "lines": [{"line_number": 2, "text": "JD campaign stickers"}]
        },
    }
    for module in (reviews, analytics_reads, expenses, finance, results, outside):
        monkeypatch.setattr(module, "raw_file_store_from_env", lambda: store)
    args = {
        **comparison["args"],
        "evidence": [*comparison["args"]["evidence"], excerpt],
        "expected_previous_id": comparison["decision"].id,
    }
    decision = reviews.record_decision(finance_db, **args)
    finance_db.flush()
    return SimpleNamespace(
        store=store,
        document=finance_db.get(m.CampaignFinanceReportDocument, fingerprint),
        body=body,
        excerpt=excerpt,
        collection=collection,
        args=args,
        decision=decision,
        race=comparison["race"],
    )


def test_excerpt_dependency_is_a_document_without_renaming_kind():
    base = dict(race_id="race", candidate_id="candidate", registration_number="-101")
    decisions = [
        SimpleNamespace(
            id=1, evidence=[{"kind": "report_excerpt", "sha256": "old"}], **base
        ),
        SimpleNamespace(
            id=2, evidence=[{"kind": "candidate_identity", "sha256": "new"}], **base
        ),
    ]
    trace = expenses._source_dependencies(decisions, {})
    old = next(row for row in trace if row["sha256"] == "old")
    assert old["storage_kind"] == "document"
    assert old["uses"][0]["dependency"] == "historical_account_evidence"
    assert old["uses"][0]["evidence_kind"] == "report_excerpt"
    assert (
        next(row for row in trace if row["sha256"] == "new")["storage_kind"] == "source"
    )


@pytest.mark.parametrize("historical", [False, True])
@pytest.mark.parametrize("failure", ["bytes", "account_role"])
def test_excerpt_original_and_role_loss_invalidate_both_reader_pins(
    finance_db, excerpt_context, comparison, historical, failure
):
    ctx = excerpt_context
    if historical:
        reviews.record_decision(
            finance_db,
            **{**comparison["args"], "expected_previous_id": ctx.decision.id},
        )
        finance_db.flush()
    first_expenses = expenses.report(finance_db, election_key=KEY)
    first_analytics = analytics_reads.funders(finance_db, election_key=KEY)
    links, _ = analytics_reads._bulk_accounts(finance_db, KEY, [ctx.race])
    assert links[(RACE, "a")]["accounts"]
    assert (
        next(c for c in first_expenses["candidates"] if c["candidate_id"] == "a")[
            "confirmed_account_count"
        ]
        == 1
    )
    trace = expenses.source_trace(finance_db, election_key=KEY)
    dependency = next(
        row for row in trace["dependencies"] if row["sha256"] == ctx.excerpt["sha256"]
    )
    assert dependency["storage_kind"] == "document"
    old_bytes = ctx.store.objects[ctx.document.object_key]
    if failure == "bytes":
        ctx.store.objects.pop(ctx.document.object_key)
    else:
        ctx.document.registration_number = "other"
        finance_db.flush()
    after_expenses = expenses.report(finance_db, election_key=KEY)
    after_analytics = analytics_reads.funders(finance_db, election_key=KEY)
    assert after_expenses["version"] != first_expenses["version"]
    assert after_analytics["version"] != first_analytics["version"]
    if not historical:
        links, _ = analytics_reads._bulk_accounts(finance_db, KEY, [ctx.race])
        assert links[(RACE, "a")]["accounts"] == []
    for call, before in (
        (expenses.report, first_expenses),
        (analytics_reads.funders, first_analytics),
    ):
        with pytest.raises(HTTPException) as error:
            call(finance_db, election_key=KEY, version=before["version"])
        assert error.value.status_code == 409
    ctx.store.objects[ctx.document.object_key] = old_bytes
    ctx.document.registration_number = "-101"
    finance_db.flush()
    assert (
        expenses.report(finance_db, election_key=KEY)["version"]
        == first_expenses["version"]
    )
    assert (
        analytics_reads.funders(finance_db, election_key=KEY)["version"]
        == first_analytics["version"]
    )


def test_excerpt_public_pdf_url_and_csv_pins_resolve_exact_original(
    finance_api, finance_db, excerpt_context
):
    ctx = excerpt_context
    links, _ = analytics_reads._bulk_accounts(finance_db, KEY, [ctx.race])
    item = next(
        e
        for e in links[(RACE, "a")]["accounts"][0]["evidence"]
        if e["kind"] == "report_excerpt"
    )
    public = finance._public_account(
        finance_db, {"registration_number": "-101", "evidence": [ctx.excerpt]}
    )["evidence"][0]
    for evidence in (item, public):
        assert evidence["kind"] == "report_excerpt" and evidence["page"] == 2
        assert evidence["locator"] == {"type": "native_pdf_lines"}
        assert "literal_fields" not in evidence
        url = evidence["retained_source_url"]
        assert "/raw?" not in url and "object_key" not in url
        response = finance_api.get(url)
        assert response.status_code == 200, response.text
        assert response.content == ctx.body
    body, _ = analytics_reads.export(finance_db, election_key=KEY, format="csv")
    rows = list(csv.DictReader(io.StringIO(body)))
    source = next(
        r
        for r in rows
        if r["Row type"] == "Source" and r["Source role"] == "report_excerpt"
    )
    link = urlsplit(source["Source URL"])
    assert link.netloc == "alethicalfinance.com"
    assert parse_qs(link.query) == {
        "kind": ["report"],
        "collection_id": [ctx.collection.id],
    }
    race_csv = race_export.export_csv(
        finance_db, election_key=KEY, race_id=RACE, snapshot_id=SNAPSHOT
    )
    race_csv = race_csv.decode("utf-8-sig")
    rows = list(csv.DictReader(io.StringIO(race_csv)))
    proof = next(
        r
        for r in rows
        if r["Row type"] == "Evidence" and r["Source hash"] == ctx.excerpt["sha256"]
    )
    assert proof["Source page"] == "2"
    assert parse_qs(urlsplit(proof["Source URL"]).query) == {
        "kind": ["report"],
        "collection_id": [ctx.collection.id],
    }
    assert not any(
        secret in body + race_csv
        for secret in (
            "private-reviewer",
            "literal_fields",
            "object_key",
            "/private/source.pdf",
        )
    )


@pytest.mark.parametrize("visibility", ["unpublished", "not_member", "other_account"])
def test_excerpt_public_link_requires_published_exact_account_membership(
    finance_db, excerpt_context, visibility
):
    ctx = excerpt_context
    if visibility == "other_account":
        account = "-999"
        collection = ctx.collection
    else:
        account = "-101"
        reports = (
            [
                {
                    "registration_number": report.registration_number,
                    "report_key": report.report_key,
                    "document_hash": report.document_hash,
                    "payload": deepcopy(report.payload),
                }
                for report in finance_db.scalars(
                    select(m.ElectionFinanceReport).where(
                        m.ElectionFinanceReport.collection_id == ctx.collection.id
                    )
                )
            ]
            if visibility == "unpublished"
            else []
        )
        collection = _publish_fixture_variant(
            finance_db,
            coverage={"reports": len(reports), "source_visibility_case": visibility},
            reports=reports,
            make_current=False,
            published=visibility != "unpublished",
        )
    evidence = {**ctx.excerpt, "collection_id": collection.id}
    value = finance._public_account(
        finance_db,
        {"registration_number": account, "evidence": [evidence]},
    )["evidence"][0]
    assert value["kind"] == "report_excerpt" and value["page"] == 2
    assert value["source_state"] == "unavailable"
    assert "retained_source_url" not in value
