"""The Finance queue uses originals and suggestions never become checks."""

# ruff: noqa: F811 -- pytest fixtures are imported below
from datetime import timedelta

from sqlalchemy import select

from alethical.api.services import finance_station_checks as checks
from alethical.api.services import tv_ads as reader
from alethical.db import models as m
from alethical.pipeline.fcc_document_text import EXTRACTOR_VERSION
from alethical.tests.finance_fixtures import finance_api, finance_db  # noqa: F401
from alethical.tests.test_finance_media_buys import (  # noqa: F401
    BASE,
    held,
    listed,
    problems,
    source,
)
from alethical.tests.test_finance_station_checks import (  # noqa: F401
    CLIENT,
    _fact,
    _file,
    original,
)


def test_suggestions_are_exact_version_drafts_with_original_evidence(
    finance_api, original
):
    db, document = original.db, original.document
    extraction = db.get(m.FCCExtraction, (document.content_hash, EXTRACTOR_VERSION))
    extraction.facts = [
        {
            "field": "agency_name",
            "value": "Example Media",
            "page": 1,
            "quote": "Agency: Example Media.",
        },
        {
            "field": "agency_name",
            "value": "Example Media",
            "page": 2,
            "quote": "not on that page",
        },
        {
            "field": "agency_address",
            "value": "456 Example Avenue",
            "page": 1,
            "quote": "456 Example Avenue",
        },
        {"field": "payer", "value": "Bad page", "page": True, "quote": "bad"},
        {"field": "not_a_fact", "value": "Unknown", "page": 1, "quote": "Unknown"},
        {"field": "payer", "value": "No quote", "page": 1},
    ]
    fact = checks.add_fact(db, CLIENT, original.key, document.content_hash, _fact())
    db.commit()
    route = f"{BASE}/files/{original.key}/suggestions"
    response = finance_api.get(route, params={"version": document.content_hash})
    assert response.status_code == 200, response.text
    data = response.json()["data"]
    assert response.headers["cache-control"] == "private, no-store"
    assert not problems(data)
    assert data["key"] == original.key and data["version_id"] == document.content_hash
    assert len(data["facts"]) == 2
    assert data["facts"][0]["pages"] == [1, 2]
    assert data["facts"][0]["in_source_text"] is False  # extraction is partial
    assert data["facts"][0]["already_checked"] is True
    assert data["facts"][1]["field"] == "organization_address"
    assert db.scalar(select(m.FinanceTVFact.id)) == fact.id
    assert finance_api.get(route, params={"version": "a" * 64}).status_code == 404
    assert finance_api.get(route).status_code == 422


def test_queue_counts_current_version_suggestions_and_checked_elsewhere(
    finance_api, original
):
    db, document = original.db, original.document
    extraction = db.get(m.FCCExtraction, (document.content_hash, EXTRACTOR_VERSION))
    extraction.facts = [_fact()]
    checks.add_fact(db, CLIENT, original.key, document.content_hash, _fact())
    other = _file(db, original.store, name="Next 100% original", folder="other")
    other.first_seen_at = document.first_seen_at + timedelta(days=1)
    db.add(
        m.FCCExtraction(
            content_hash=other.content_hash,
            version=EXTRACTOR_VERSION,
            document_kind="unknown",
            status="partial",
            facts=[_fact()],
            errors=[],
        )
    )
    newer = _file(db, original.store, like=document)
    newer.first_seen_at = document.first_seen_at + timedelta(days=2)
    db.add(
        m.FCCExtraction(
            content_hash=newer.content_hash,
            version=EXTRACTOR_VERSION,
            document_kind="unknown",
            status="partial",
            facts=[_fact()],
            errors=[],
        )
    )
    db.commit()
    response = finance_api.get(f"{BASE}/queue", params={"limit": 1})
    assert response.status_code == 200, response.text
    data = response.json()["data"]
    assert data["total"] == 2 and data["has_more"]
    row = data["rows"][0]
    assert row["key"] == reader.file_key(other.facility_id, other.file_id)
    assert row["suggestion_count"] == 1
    assert row["reasons"] == [
        {"kind": "agency_checked_elsewhere", "label": "Example Media"}
    ]
    assert not problems(data)
    newest = finance_api.get(f"{BASE}/queue", params={"sort": "newest"}).json()["data"]
    assert newest["rows"][0]["version_id"] == newer.content_hash
    assert (
        newest["rows"][0]["suggestion_count"] == 1
    )  # old-version check does not cover new
    literal = finance_api.get(f"{BASE}/queue", params={"q": "%"}).json()["data"]
    assert literal["total"] == 1 and literal["q"] == "%"
    empty = finance_api.get(f"{BASE}/queue", params={"station": "kare"}).json()["data"]
    assert empty["total"] == 0
    finance_api.headers.pop("Authorization")
    assert finance_api.get(f"{BASE}/queue").status_code == 401


def test_queue_folder_priority_ends_with_finance_withdrawal(finance_api, held, listed):
    connection = listed.scalar(
        select(m.TVAdConnection).where(m.TVAdConnection.scope == "folder")
    )
    response = finance_api.get(f"{BASE}/queue")
    assert response.status_code == 200, response.text
    assert all(
        any(r["kind"] == "folder_committee_checked" for r in row["reasons"])
        for row in response.json()["data"]["rows"]
    )
    listed.add(
        m.FinanceTVCopyWithdrawal(
            connection_id=connection.id,
            withdrawn_at=connection.checked_at,
            withdrawal_reason="Synthetic withdrawal",
        )
    )
    listed.commit()
    rows = finance_api.get(f"{BASE}/queue").json()["data"]["rows"]
    assert all(
        not any(r["kind"] == "folder_committee_checked" for r in row["reasons"])
        for row in rows
    )
