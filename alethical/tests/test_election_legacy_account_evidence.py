"""Historical Board evidence keeps exact source checks without rewriting history."""

# ruff: noqa: F811, F401
from copy import deepcopy
from datetime import UTC, datetime
import json

import pytest
from sqlalchemy import select, func

from alethical.db import models as m
from alethical.pipeline import election_account_reviews as reviews
from alethical.pipeline import election_account_quote_evidence as quotes
from alethical.pipeline import election_comparison as storage
from alethical.tests.test_election_account_reviews import review_context, applicable
from alethical.tests.test_election_comparison_storage import (
    db,
    prepared,
    source_set,
    MemoryStore,
)

INFO = dict(
    RegisteredEntityID="19399",
    CommitteeName="Example committee",
    CandidateFullName="Example, Candidate",
    PartyAffiliation="IND",
    ElectionYear="2026",
    OfficeSoughtFullName="Senate",
    AffidavitOfCandidacyDate="2026-05-20 00:00:00.000",
    District="01",
    LTGCFormattedName=None,
)
FILING = dict(
    FullName="Example, Candidate",
    RegisteredEntityID="19399",
    StatementFiled="2026-06-16 00:00:00.000",
    ElectionYear="2026",
    AffidavitOfCandidacyDate="2026-05-20 00:00:00.000",
)
HREFS = ["https://example.test", "https://login.test", "https://login.test"]
SITE_LOCATOR = "HTML document linked by exact Board officers /tabcontent href"


@pytest.fixture
def legacy(db, review_context, monkeypatch):
    store = MemoryStore()
    sources = []
    items = []
    originals = {}
    stamp = "2026-11-11T16:12:54.490388+00:00"

    def add(tab, payload, locator, claim):
        body = json.dumps(payload).encode()
        h = storage.archive_source(db, store, body)
        originals[h] = body
        source = dict(
            kind="candidate_identity",
            registration_number="19399",
            url=quotes.BOARD_URL,
            request_method="POST",
            request_form={
                "id": "19399",
                "year": "2026",
                "year_data[ElectionSegmentStartDate]": "2025",
                "year_data[ElectionSegmentEndDate]": "2026",
                "tabname": tab,
            },
            copied_at=stamp,
            sha256=h,
        )
        sources.append(source)
        item = {**source, "collection_id": "e" * 64, "locator": locator, **claim}
        items.append(item)
        return source

    add("information", {"data": [INFO]}, "/data/0", {"literal_identity_fields": INFO})
    for tab in (
        "election_economic_interest_statement",
        "ltgc_election_economic_interest_statement",
    ):
        add(
            tab,
            {"data": {"filinginfo": FILING}, "tab": tab},
            "/data/filinginfo",
            {"literal_identity_fields": FILING},
        )
    parent = add(
        "officers",
        {"tabcontent": "".join(f'<a href="{u}">link</a>' for u in HREFS)},
        "/tabcontent",
        {"literal_registered_websites": HREFS},
    )
    body = b"<html><title>Not a claimed name</title></html>"
    h = storage.archive_source(db, store, body)
    originals[h] = body
    source = dict(
        kind="candidate_identity",
        registration_number="19399",
        subtype="registered_site",
        parent_sha256=parent["sha256"],
        parent_locator="/tabcontent",
        requested_url=HREFS[0],
        url="https://example.test/",
        retrieval_url="https://example.test/",
        request_method="GET",
        copied_at=stamp,
        sha256=h,
    )
    sources.append(source)
    items.append(
        {
            **source,
            "collection_id": "e" * 64,
            "locator": SITE_LOCATOR,
            "purpose": "PRIVATE note, no literal quotation",
        }
    )
    db.add(
        m.ElectionFinanceCollection(
            id="e" * 64,
            election_key=review_context[0]["election_key"],
            copied_at=datetime.now(UTC),
            sources=sources,
            coverage={},
        )
    )
    db.flush()
    monkeypatch.setattr(reviews, "raw_file_store_from_env", lambda: store)
    return review_context, store, items, sources, originals


def record(db, legacy, items=None):
    args = dict(legacy[0][3])
    args["evidence"] = [*args["evidence"], *(legacy[2] if items is None else items)]
    return reviews.record_decision(db, **args)


def test_legacy_exact_replay_remains_idempotent(db, legacy):
    before = deepcopy(legacy[2])
    decision = record(db, legacy)
    assert record(db, legacy).id == decision.id
    assert legacy[2] == before and decision.evidence[-5:] == before
    assert (
        db.scalar(select(func.count()).select_from(m.ElectionCampaignAccountDecision))
        == 1
    )


def test_existing_legacy_decision_remains_readable(db, legacy, monkeypatch):
    # Simulate the previous version's accepted, immutable evidence format.
    with monkeypatch.context() as old:
        old.setattr(reviews, "_validate_quotes", lambda *a, **kw: None)
        prior = record(db, legacy)
    assert applicable(db, legacy[0])["accounts"][0]["decision_id"] == prior.id


@pytest.mark.parametrize(
    "index", range(5), ids=["information", "filing", "ltgc", "hrefs", "site"]
)
def test_each_legacy_shape_is_checked_and_original_loss_recovers_without_new_review(
    db, legacy, index
):
    item = legacy[2][index]
    prior = record(db, legacy, [item])
    original = deepcopy(prior.evidence)
    source = db.get(m.ElectionResultSource, item["sha256"])
    body = legacy[1].objects.pop(source.object_key)
    assert applicable(db, legacy[0])["accounts"] == []
    with pytest.raises(storage.ComparisonImportError):
        record(db, legacy, [item])
    legacy[1].objects[source.object_key] = body
    assert applicable(db, legacy[0])["accounts"][0]["decision_id"] == prior.id
    assert record(db, legacy, [item]).id == prior.id and prior.evidence == original


@pytest.mark.parametrize(
    "index,change",
    [
        (0, "value"),
        (0, "null_type"),
        (0, "account"),
        (0, "missing_key"),
        (0, "extra_key"),
        (0, "wrong_pointer"),
        (1, "wrong_pointer"),
        (2, "value"),
        (3, "reorder"),
        (3, "remove_duplicate"),
        (3, "added_link"),
        (4, "missing_parent"),
        (4, "unknown_locator"),
        (4, "typed_claim"),
        (0, "typed_claim"),
        (3, "dual_claim"),
        (0, "literal_row"),
    ],
)
def test_legacy_shape_and_literal_failures_cannot_approve(db, legacy, index, change):
    item = deepcopy(legacy[2][index])
    if change == "value":
        item["literal_identity_fields"][
            "CandidateFullName" if index == 0 else "FullName"
        ] = "Unsupported person"
    elif change == "null_type":
        item["literal_identity_fields"]["LTGCFormattedName"] = ""
    elif change == "account":
        item["literal_identity_fields"]["RegisteredEntityID"] = "other"
    elif change == "missing_key":
        item["literal_identity_fields"].pop("District")
    elif change == "extra_key":
        item["literal_identity_fields"]["Other"] = "value"
    elif change == "wrong_pointer":
        item["locator"] = "/data/information"
    elif change == "reorder":
        item["literal_registered_websites"].reverse()
    elif change == "remove_duplicate":
        item["literal_registered_websites"].pop()
    elif change == "added_link":
        item["literal_registered_websites"].append("https://other.test")
    elif change == "missing_parent":
        item.pop("parent_sha256")
    elif change == "unknown_locator":
        item["locator"] = "arbitrary absence of quote"
    elif change == "typed_claim":
        item["literal_fields"] = {"title": "An unsupported name"}
    elif change == "dual_claim":
        item["literal_identity_fields"] = INFO
    elif change == "literal_row":
        item["literal_row"] = "An unchecked row"
    with pytest.raises(storage.ComparisonImportError):
        record(db, legacy, [item])
    assert (
        db.scalar(select(func.count()).select_from(m.ElectionCampaignAccountDecision))
        == 0
    )


@pytest.mark.parametrize(
    "change",
    [
        "wrong_tab",
        "duplicate_json",
        "other_object",
        "duplicate_href",
        "site_parent_account",
        "site_parent_collection",
        "site_link",
        "site_metadata",
        "missing_site_bytes",
    ],
)
def test_retained_metadata_cannot_substitute_another_claim_or_chain(db, legacy, change):
    sources = deepcopy(legacy[3])
    index = 0
    item = deepcopy(legacy[2][index])
    store = legacy[1]
    if change in {
        "site_parent_account",
        "site_parent_collection",
        "site_link",
        "site_metadata",
        "missing_site_bytes",
    }:
        index = 4
        item = deepcopy(legacy[2][index])
    if change == "wrong_tab":
        sources[0]["request_form"]["tabname"] = "officers"
        item["request_form"] = deepcopy(sources[0]["request_form"])
    elif change in {"duplicate_json", "other_object", "duplicate_href"}:
        if change == "duplicate_json":
            body = b'{"data":[],"data":' + json.dumps([INFO]).encode() + b"}"
        elif change == "other_object":
            body = json.dumps(
                {"data": [INFO | {"CandidateFullName": "Other"}], "elsewhere": INFO}
            ).encode()
        else:
            index = 3
            item = deepcopy(legacy[2][index])
            body = json.dumps(
                {
                    "tabcontent": '<a href="https://example.test" href="https://other.test">x</a>'
                }
            ).encode()
        h = storage.archive_source(db, store, body)
        sources[index]["sha256"] = item["sha256"] = h
    elif change == "site_parent_account":
        sources[3]["registration_number"] = "different"
    elif change == "site_parent_collection":
        sources.pop(3)
    elif change == "site_link":
        sources[4]["requested_url"] = item["requested_url"] = "https://not-linked.test"
    elif change == "site_metadata":
        item["retrieval_url"] = "https://unrecorded.test"
    elif change == "missing_site_bytes":
        del store.objects[db.get(m.ElectionResultSource, item["sha256"]).object_key]
    collection = m.ElectionFinanceCollection(
        id="f" * 64,
        election_key=legacy[0][0]["election_key"],
        copied_at=datetime.now(UTC),
        sources=sources,
        coverage={},
    )
    db.add(collection)
    db.flush()
    item["collection_id"] = collection.id
    with pytest.raises(storage.ComparisonImportError):
        record(db, legacy, [item])


def test_site_association_does_not_invent_a_quote_from_private_purpose(db, legacy):
    item = deepcopy(legacy[2][4])
    before = deepcopy(item)
    assert quotes.validate_quote(db, legacy[1], item, "19399") is None
    assert item == before and not (
        {"literal_fields", "literal_identity_fields", "literal_row"} & item.keys()
    )


def test_typed_locator_never_accepts_a_mixed_legacy_claim(db, legacy):
    item = deepcopy(legacy[2][3])
    item["locator"] = {"type": "json_html_excerpts", "pointer": "/tabcontent"}
    item["literal_fields"] = {"excerpts": ['<a href="https://example.test">link</a>']}
    with pytest.raises(storage.ComparisonImportError, match="cannot mix"):
        record(db, legacy, [item])
