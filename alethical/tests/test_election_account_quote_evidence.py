"""Quoted identity bridges must reproduce from the exact retained originals.

These are synthetic public-record shapes, not assertions about real candidates.
"""

# Imported fixtures are deliberately rebound by pytest arguments.
# ruff: noqa: F811, F401

from copy import deepcopy
import hashlib
import io
import json

from pypdf import PdfReader, PdfWriter
import pytest
from sqlalchemy import func, select

from alethical.db import models as m
from alethical.pipeline import election_account_reviews as reviews
from alethical.pipeline import election_comparison as storage
from alethical.pipeline.campaign_finance_report_document_store import DocumentKeeper
from alethical.tests.test_campaign_finance_stated_split import pdf_of
from alethical.tests.test_election_account_reviews import applicable, review_context
from alethical.tests.test_election_comparison_storage import (
    MemoryStore,
    db,
    prepared,
    source_set,
)

OFFICERS = (
    '<div><span class="position">Candidate</span>'
    '<span class="name">Kristofer Example</span></div>'
    '<span class="website">Website: '
    '<a href="http://example.test">Example campaign</a></span>'
)
BOARD_URL = (
    "https://cfb.mn.gov/reports-and-data/viewers/campaign-finance/candidates/api"
)


@pytest.fixture
def quote_context(db, review_context, monkeypatch, tmp_path, request):
    store = MemoryStore()
    officers = storage.archive_source(
        db, store, json.dumps({"tabcontent": OFFICERS}).encode()
    )
    site = storage.archive_source(
        db, store, b"<html><head><title>Kris Example</title></head></html>"
    )
    writer = PdfWriter()
    for lines in [["Synthetic cover"], ["Campaign expenses", "JD campaign stickers"]]:
        writer.add_page(PdfReader(io.BytesIO(pdf_of(lines))).pages[0])
    if hasattr(request, "param"):
        writer.encrypt(request.param, owner_password="synthetic-owner")
    output = io.BytesIO()
    writer.write(output)
    body = output.getvalue()
    fingerprint = hashlib.sha256(body).hexdigest()
    keeper = DocumentKeeper(db=db, store=store, directory=str(tmp_path))
    assert (
        keeper.keep(
            document_hash=fingerprint,
            body=body,
            registration_number="19399",
            filing_year=2026,
            report_type="E",
            amendment_index=0,
            special_election=False,
        )
        != "failed"
    )
    parent = {
        "sha256": officers,
        "kind": "candidate_identity",
        "registration_number": "19399",
        "url": BOARD_URL,
        "request_method": "POST",
        "request_form": {"id": "19399", "tabname": "officers"},
    }
    child = {
        "sha256": site,
        "kind": "candidate_identity",
        "subtype": "registered_site",
        "registration_number": "19399",
        "url": "https://example.test/",
        "request_method": "GET",
        "requested_url": "http://example.test",
        "parent_sha256": officers,
        "parent_locator": "/tabcontent",
    }
    db.add(
        m.ElectionFinanceCollection(
            id="e" * 64,
            election_key=review_context[0]["election_key"],
            copied_at=db.get(m.ElectionFinanceCollection, "c" * 64).copied_at,
            sources=[parent, child],
            coverage={},
        )
    )
    db.flush()
    monkeypatch.setattr(reviews, "raw_file_store_from_env", lambda: store)
    db.add(
        m.ElectionFinanceReport(
            collection_id="e" * 64,
            registration_number="19399",
            report_key="a" * 64,
            document_hash=fingerprint,
            payload={"fixture": "synthetic native report"},
        )
    )
    db.flush()
    identity = {
        "kind": "candidate_identity",
        "sha256": officers,
        "collection_id": "e" * 64,
        "locator": {"type": "json_html_excerpts", "pointer": "/tabcontent"},
        "literal_fields": {"excerpts": [OFFICERS]},
    }
    title = {
        "kind": "candidate_identity",
        "sha256": site,
        "collection_id": "e" * 64,
        "locator": {"type": "html_title"},
        "literal_fields": {"title": "Kris Example"},
    }
    excerpt = {
        "kind": "report_excerpt",
        "sha256": fingerprint,
        "collection_id": "e" * 64,
        "page": 2,
        "locator": {"type": "native_pdf_lines"},
        "literal_fields": {
            "lines": [{"line_number": 2, "text": "JD campaign stickers"}]
        },
    }
    return review_context, store, identity, title, excerpt


def record(db, context, extra):
    args = context[0][3]
    return reviews.record_decision(
        db, **{**args, "evidence": [*args["evidence"], *extra]}
    )


def test_exact_officers_and_registered_title_are_checked(db, quote_context):
    record(db, quote_context, quote_context[2:4])
    assert applicable(db, quote_context[0])["accounts"]


def test_exact_native_report_page_is_checked(db, quote_context):
    record(db, quote_context, [quote_context[4]])
    assert applicable(db, quote_context[0])["accounts"]


@pytest.mark.parametrize("quote_context", [""], indirect=True)
def test_readable_owner_restricted_pdf_keeps_native_text(db, quote_context):
    record(db, quote_context, [quote_context[4]])
    assert applicable(db, quote_context[0])["accounts"]


@pytest.mark.parametrize("quote_context", ["unavailable-password"], indirect=True)
def test_unreadable_pdf_cannot_substitute_a_page_or_ocr(db, quote_context):
    with pytest.raises(storage.ComparisonImportError):
        record(db, quote_context, [quote_context[4]])


@pytest.mark.parametrize("collection_id", [None, "c" * 64, "f" * 64])
def test_report_requires_exact_collection_document_membership(
    db, quote_context, collection_id
):
    item = {**quote_context[4], "collection_id": collection_id}
    with pytest.raises(storage.ComparisonImportError):
        record(db, quote_context, [item])


@pytest.mark.parametrize("kind", [2, 3, 4], ids=["officers", "title", "pdf"])
@pytest.mark.parametrize("change", ["quote", "locator", "hash", "missing_quotes"])
def test_wrong_or_missing_claim_cannot_create_review(db, quote_context, kind, change):
    item = deepcopy(quote_context[kind])
    if change == "quote":
        if kind == 2:
            item["literal_fields"]["excerpts"][0] = "Different person's name"
        elif kind == 3:
            item["literal_fields"]["title"] = "Different person's title"
        else:
            item["literal_fields"]["lines"][0]["text"] = "Different campaign expense"
    elif change == "locator":
        item["locator"] = {"type": "fuzzy_or_ocr"}
    elif change == "hash":
        item["sha256"] = "f" * 64
    else:
        item.pop("literal_fields")
    with pytest.raises(storage.ComparisonImportError):
        record(db, quote_context, [item])
    assert (
        db.scalar(select(func.count()).select_from(m.ElectionCampaignAccountDecision))
        == 0
    )


@pytest.mark.parametrize("page", [1, 0, -1, 3, True, "2"])
def test_report_quote_never_uses_another_page(db, quote_context, page):
    item = {**quote_context[4], "page": page}
    with pytest.raises(storage.ComparisonImportError):
        record(db, quote_context, [item])


@pytest.mark.parametrize("kind", [2, 3, 4], ids=["officers", "title", "pdf"])
@pytest.mark.parametrize("loss", ["changed", "missing"])
def test_original_loss_blocks_new_and_existing_attribution(
    db, quote_context, kind, loss
):
    item = quote_context[kind]
    decision = record(db, quote_context, [item])
    model = m.CampaignFinanceReportDocument if kind == 4 else m.ElectionResultSource
    source = db.get(model, item["sha256"])
    store = quote_context[1]
    if loss == "changed":
        store.objects[source.object_key] = b"Changed retained original"
    else:
        del store.objects[source.object_key]
    with pytest.raises(storage.ComparisonImportError):
        record(db, quote_context, [item])
    assert decision.id
    result = applicable(db, quote_context[0])
    assert result["accounts"] == []
    assert result["gaps"][0]["state"] == "sources_unavailable"


def test_registered_site_requires_fresh_parent_original(db, quote_context):
    record(db, quote_context, [quote_context[3]])
    source = db.get(m.ElectionResultSource, quote_context[2]["sha256"])
    del quote_context[1].objects[source.object_key]
    with pytest.raises(storage.ComparisonImportError):
        record(db, quote_context, [quote_context[3]])
    assert applicable(db, quote_context[0])["gaps"][0]["state"] == "sources_unavailable"


@pytest.mark.parametrize("kind", [2, 3, 4], ids=["officers", "title", "pdf"])
def test_exact_account_required_even_when_quote_matches(db, quote_context, kind):
    with pytest.raises(storage.ComparisonImportError):
        reviews._validate_quotes(db, quote_context[kind], "another-account")


@pytest.mark.parametrize(
    "change",
    [
        "parent_account",
        "parent_hash",
        "parent_request",
        "link",
        "parent_locator",
        "commented_link",
    ],
)
def test_metadata_cannot_invent_a_registered_site_chain(db, quote_context, change):
    previous = db.get(m.ElectionFinanceCollection, "e" * 64)
    sources = deepcopy(previous.sources)
    if change == "parent_account":
        sources[0]["registration_number"] = "different"
    elif change == "parent_hash":
        sources[1]["parent_sha256"] = "f" * 64
    elif change == "parent_request":
        sources[0]["request_form"]["id"] = "different"
    elif change == "link":
        sources[1]["requested_url"] = "https://not-registered.test"
    elif change == "commented_link":
        body = json.dumps(
            {"tabcontent": '<!-- <a href="http://example.test">hidden</a> -->'}
        ).encode()
        h = storage.archive_source(db, quote_context[1], body)
        sources[0]["sha256"] = sources[1]["parent_sha256"] = h
    else:
        sources[1]["parent_locator"] = "/unsupported"
    db.add(
        m.ElectionFinanceCollection(
            id="f" * 64,
            election_key=previous.election_key,
            copied_at=previous.copied_at,
            sources=sources,
            coverage={},
        )
    )
    db.flush()
    item = {**quote_context[3], "collection_id": "f" * 64}
    with pytest.raises(storage.ComparisonImportError):
        record(db, quote_context, [item])


def test_unavailable_store_configuration_withholds_existing_link(
    db, quote_context, monkeypatch
):
    record(db, quote_context, [quote_context[4]])

    def unavailable():
        raise RuntimeError("Synthetic missing store configuration")

    monkeypatch.setattr(reviews, "raw_file_store_from_env", unavailable)
    with pytest.raises(storage.ComparisonImportError, match="store is unavailable"):
        record(db, quote_context, [quote_context[4]])
    assert applicable(db, quote_context[0])["gaps"][0]["state"] == "sources_unavailable"


@pytest.mark.parametrize(
    "kind", ["ballot", "committee_register", "candidate_identity", "report_excerpt"]
)
def test_supplied_store_is_request_local_and_loss_is_rechecked(
    db, quote_context, monkeypatch, kind
):
    store = quote_context[1]
    if kind == "ballot":
        fingerprint = storage.archive_source(db, store, b"Exact synthetic ballot row\n")
        item = {
            "kind": kind,
            "sha256": fingerprint,
            "row_number": 1,
            "literal_row": "Exact synthetic ballot row",
        }
    elif kind == "committee_register":
        payload = {
            "cols": ["RegisteredEntityID", "CandidateFullName"],
            "data": {"19399": [["19399", "Example, Candidate"]]},
        }
        fingerprint = storage.archive_source(db, store, json.dumps(payload).encode())
        item = {
            "kind": kind,
            "sha256": fingerprint,
            "locator": "/data/19399/0",
            "column_names": payload["cols"],
            "literal_fields": dict(
                zip(payload["cols"], payload["data"]["19399"][0], strict=True)
            ),
        }
    else:
        item = quote_context[2 if kind == "candidate_identity" else 4]
    monkeypatch.setattr(
        reviews,
        "raw_file_store_from_env",
        lambda: pytest.fail("Supplied request store was ignored"),
    )
    reviews._validate_quotes(db, item, "19399", store=store)
    other_request = MemoryStore()
    other_request.objects = dict(store.objects)
    source = db.get(
        m.CampaignFinanceReportDocument
        if kind == "report_excerpt"
        else m.ElectionResultSource,
        item["sha256"],
    )
    del store.objects[source.object_key]
    with pytest.raises(storage.ComparisonImportError):
        reviews._validate_quotes(db, item, "19399", store=store)
    reviews._validate_quotes(db, item, "19399", store=other_request)
