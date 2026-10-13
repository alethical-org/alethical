"""Adversarial reader/API checks with synthetic station files and expense rows."""

from __future__ import annotations

import json
import uuid
from datetime import date, datetime, timezone
from types import SimpleNamespace

import pytest
from sqlalchemy.orm import Session

from alethical.api.auth import get_auth_service
from alethical.api.routers import tv_ads as router
from alethical.api.services import tv_ad_review as review
from alethical.api.services import tv_ads as reader
from alethical.db import models as m
from alethical.db.session import get_db, get_engine
from alethical.pipeline import fcc_archive
from alethical.pipeline.fcc_document_text import EXTRACTOR_VERSION
from alethical.tests.test_fcc_expense_links import _expense, _release
from alethical.tests import test_tv_ad_review as review_fixtures
from alethical.tests.test_tv_ad_review import (
    ACTOR,
    SAFE,
    approved,
    fact,
    pdf,
    preparation,
)
from alethical.tests.test_raw_file_mirror import MemoryStore


@pytest.fixture()
def db(seed_database):
    # Route handlers commit or roll back; neither should escape this test.
    with get_engine().connect() as connection:
        transaction = connection.begin()
        with Session(
            bind=connection, join_transaction_mode="create_savepoint"
        ) as session:
            yield session
        transaction.rollback()


@pytest.fixture()
def source(db):
    return review_fixtures.source.__wrapped__(db)


def _encoded(value):
    return json.dumps(value, default=str)


@pytest.fixture()
def api(client, db, monkeypatch):
    state = {"allowed": True}
    monkeypatch.setattr(router, "administrator_access", lambda *args: state["allowed"])
    client.app.dependency_overrides[get_db] = lambda: db
    client.app.dependency_overrides[get_auth_service] = lambda: SimpleNamespace(
        authenticate=lambda token: SimpleNamespace(
            provider_subject=ACTOR,
            provider="supabase",
            email="tv-api@example.invalid",
            email_verified=True,
        )
    )
    client.headers["Authorization"] = "Bearer synthetic-admin-token"
    return client, state


@pytest.mark.parametrize(
    "path",
    [
        "/api/v1/ads/counts",
        "/api/v1/ads/browse?q=private",
        "/api/v1/ads/files/kstp-tv-hidden-file",
        "/api/v1/ads/files/kstp-tv-hidden-file/pages/1?version="
        + "a" * 64
        + "&copy="
        + str(uuid.UUID(int=1)),
        "/api/v1/admin/political-ads/queue",
        "/api/v1/admin/political-ads/folders",
    ],
)
def test_every_surface_denies_ordinary_accounts_without_details(api, path):
    client, access = api
    access["allowed"] = False
    response = client.get(path)
    assert response.status_code == 404
    assert "no-store" in response.headers["cache-control"]
    payload = response.json()
    assert payload["title"] == "Not Found"
    assert payload["detail"] == "Not found."
    assert set(payload) <= {"type", "title", "status", "detail", "instance"}


def test_access_revocation_applies_on_the_next_request(api):
    client, access = api
    first = client.get("/api/v1/ads/access")
    assert first.status_code == 200
    assert "no-store" in first.headers["cache-control"]
    access["allowed"] = False
    second = client.get("/api/v1/ads/access")
    assert second.status_code == 404
    assert "no-store" in second.headers["cache-control"]


def test_metadata_only_is_searchable_but_never_exposes_original_or_text(db, source):
    document, store = source
    copy = review.prepare_copy(
        db, ACTOR, preparation(source, metadata_only=True), store=store
    )
    with pytest.raises(LookupError):
        reader.file_detail(db, reader.file_key(document.facility_id, document.file_id))
    review.approve_metadata(
        db,
        copy.id,
        ACTOR,
        {
            "expected_fingerprint": copy.fingerprint,
            "metadata_reviewed": True,
            "evidence": "Synthetic metadata approval",
        },
    )
    detail = reader.file_detail(
        db, reader.file_key(document.facility_id, document.file_id)
    )
    assert detail["copy_status"] == "not_ready"
    assert (
        detail["pages"] == [] and detail["facts"] == [] and detail["connections"] == []
    )
    assert "Private title" not in _encoded(detail)
    assert "PRIVATE CONTACT NAME" not in _encoded(detail)
    assert reader.browse(db, q="Reviewed invoice")["total"] == 1
    assert reader.browse(db, q="Agency: Example")["total"] == 0
    with pytest.raises(LookupError):
        reader.approved_media(db, detail["key"], document.content_hash, copy.id)


def test_withdrawal_removes_search_facts_and_old_exact_media_links(db, source, api):
    copy = approved(db, source)
    review.add_fact(db, copy.id, ACTOR, fact())
    key = reader.file_key(copy.facility_id, copy.file_id)
    image_url = (
        f"/api/v1/ads/files/{key}/pages/1?version={copy.content_hash}&copy={copy.id}"
    )
    assert reader.browse(db, q="Example Media")["total"] == 1
    review.withdraw_copy(db, copy.id, ACTOR, "Synthetic unsafe copy withdrawal")
    assert reader.browse(db, q="Example Media")["total"] == 0
    tombstone = reader.file_detail(db, key, copy.content_hash, copy.id)
    assert tombstone["copy_status"] == "withdrawn"
    assert "Example Media" not in _encoded(tombstone)
    response = api[0].get(image_url)
    assert response.status_code == 410
    assert "no-store" in response.headers["cache-control"]
    assert b"PRIVATE CONTACT NAME" not in response.content


def test_return_to_earlier_bytes_is_current_but_history_uses_first_saved(db, source):
    original, store = source
    january = datetime(2026, 1, 1, tzinfo=timezone.utc)
    february = datetime(2026, 2, 1, tzinfo=timezone.utc)
    march = datetime(2026, 3, 1, tzinfo=timezone.utc)
    original.first_seen_at = january
    original.last_downloaded_at = march
    original.last_seen_at = march
    copy_a = approved(db, source)
    digest_b = fcc_archive.archive_body(
        db, store, pdf() + b"\n% different synthetic body"
    )
    other = m.FCCDocument(
        facility_id=original.facility_id,
        file_id=original.file_id,
        content_hash=digest_b,
        call_sign=original.call_sign,
        folder_id=original.folder_id,
        folder_path=original.folder_path,
        name="Private second title",
        url=original.url,
        first_seen_at=february,
        last_seen_at=february,
        last_downloaded_at=february,
    )
    db.add(other)
    db.flush()
    approved(db, (other, store))
    detail = reader.file_detail(
        db, reader.file_key(original.facility_id, original.file_id)
    )
    assert detail["version_id"] == copy_a.content_hash
    assert detail["source_changed"] is False
    assert reader.browse(db, q="Reviewed invoice")["rows"][0]["source_changed"] is False
    assert reader._row(db, copy_a)["source_changed"] is False
    assert [v["id"] for v in detail["versions"]] == [digest_b, original.content_hash]
    counts = reader.counts(db)
    assert counts["station_files_held"] == 1
    assert counts["unique_file_contents"] == 2
    assert counts["files_with_approved_copy"] == 1


def test_same_file_id_in_different_stations_counts_as_separate_files(db, source):
    first, store = source
    copy1 = approved(db, source)
    review.add_fact(db, copy1.id, ACTOR, fact())
    other = m.FCCDocument(
        facility_id="23079",
        file_id=first.file_id,
        content_hash=first.content_hash,
        call_sign="KARE",
        folder_id=first.folder_id,
        folder_path=first.folder_path,
        name="Private title at KARE",
        url=first.url,
    )
    db.add(other)
    db.flush()
    copy2 = approved(db, (other, store))
    review.add_fact(db, copy2.id, ACTOR, fact())
    agency = reader.browse(db, tab="agencies")
    assert agency["rows"][0]["file_count"] == 2
    assert agency["rows"][0]["stations"] == ["KARE", "KSTP-TV"]
    station_rows = reader.browse(db, tab="stations")["rows"]
    assert all(row["folder_count"] == 1 for row in station_rows if row["file_count"])
    assert reader.counts(db)["station_files_held"] == 2
    assert reader.counts(db)["unique_file_contents"] == 1


def test_unapproved_checked_fact_never_enters_search_or_reader(db, source):
    copy = approved(db, source)
    review.add_fact(
        db, copy.id, ACTOR, fact(value="Example Media", publication_approved=False)
    )
    detail = reader.file_detail(db, reader.file_key(copy.facility_id, copy.file_id))
    assert detail["facts"] == []
    assert reader.browse(db, tab="agencies")["rows"] == []


def test_reviewed_empty_folder_appears_without_inventing_files(db):
    store = MemoryStore()
    digest = fcc_archive.archive_body(
        db, store, b"<html>Private empty folder title</html>"
    )
    scan = m.FCCScan(status="complete", stations=["28010"], counts={})
    db.add(scan)
    db.flush()
    db.add(
        m.FCCObservation(
            scan_id=scan.id,
            url="https://publicfiles.fcc.gov/tv-profile/kstp-tv/political-files/empty-folder",
            facility_id="28010",
            kind="folder",
            status="stored",
            content_hash=digest,
            details={"files": 0, "path": "political-files/2026/State/private-label"},
        )
    )
    db.flush()
    folder = review.prepare_folder(
        db,
        ACTOR,
        {
            "facility_id": "28010",
            "folder_id": "empty-folder",
            "content_hash": digest,
            "safe_label": "Reviewed empty folder",
            "safe_path": "political-files/2026/State/Reviewed empty folder",
            "year": 2026,
            "category": "State",
            "evidence": "Synthetic label review",
        },
    )
    review.approve_folder(
        db,
        folder.id,
        ACTOR,
        {
            "expected_fingerprint": folder.fingerprint,
            "metadata_reviewed": True,
            "evidence": "Synthetic safe metadata",
        },
    )
    detail = reader.folder_detail(db, "kstp-tv-empty-folder")
    assert detail["files"] == []
    assert "Private empty folder title" not in _encoded(detail)
    rows = reader.browse(db, tab="folders")["rows"]
    assert len(rows) == 1 and rows[0]["file_count"] == 0
    assert reader.counts(db)["station_files_held"] == 0
    station = next(
        row
        for row in reader.browse(db, tab="stations")["rows"]
        if row["key"] == "kstp-tv"
    )
    assert station["folder_count"] == 1 and station["file_count"] == 0
    year = reader.browse(db, tab="years")["rows"][0]
    assert year["folder_count"] == 1 and year["file_count"] == 0
    review.withdraw_folder(db, folder.id, ACTOR, "Synthetic withdrawal")
    assert reader.browse(db, tab="folders")["rows"] == []
    assert reader.browse(db, tab="years")["rows"] == []
    assert all(
        row["folder_count"] == 0 for row in reader.browse(db, tab="stations")["rows"]
    )


@pytest.mark.parametrize("change", ["published_source", "link_row", "link_identity"])
def test_expense_evidence_stays_exact_after_current_source_replacement(
    db, source, change
):
    copy = approved(db, source)
    snapshots = _release(db)
    snapshot = snapshots["expenditures"]
    original_row = _expense(db, snapshot)
    db.add(
        m.CampaignFinanceSnapshotBody(
            snapshot_id=snapshot.id,
            object_key=f"synthetic/{snapshot.id}",
            compressed_hash="a" * 64,
            compressed_byte_size=100,
        )
    )
    db.add(
        m.FCCExtraction(
            content_hash=copy.content_hash,
            version=EXTRACTOR_VERSION,
            document_kind="invoice",
            status="pending_review",
            facts=[
                {
                    "field": "agency_name",
                    "value": "Example Media",
                    "page": 1,
                    "quote": "Agency: Example Media.",
                }
            ],
            errors=[],
        )
    )
    db.flush()
    db.add(
        m.FCCPage(
            content_hash=copy.content_hash,
            version=EXTRACTOR_VERSION,
            page=1,
            text=SAFE,
            method="synthetic",
            status="extracted",
        )
    )
    db.flush()
    connection = review.add_connection(
        db,
        ACTOR,
        {
            "scope": "file",
            "publication_id": str(copy.id),
            "kind": "expense",
            "target_id": f"expenditures:{snapshot.id}:1",
            "source_content_hash": snapshot.content_hash,
            "expected_target_fingerprint": review.target_preview(
                db, "expense", f"expenditures:{snapshot.id}:1", copy.id
            )["target_fingerprint"],
            "extraction_version": EXTRACTOR_VERSION,
            "page": 1,
            "quote": "Agency: Example Media.",
            "evidence": "Synthetic exact expense match",
            "correctness_reviewed": True,
            "publication_approved": True,
            "privacy_reviewed": True,
            "file_identity_reviewed": True,
        },
    )
    first = reader.expense_detail(db, connection.id)
    assert first["source_changed"] is False
    detail = reader.file_detail(db, reader.file_key(copy.facility_id, copy.file_id))
    projected = detail["connections"][0]
    assert projected["reported_amount"] == "$17,378"
    assert projected["reported_date"] == "2026-07-26"
    assert f"copy={copy.id}" in projected["href"]
    assert f"version={copy.content_hash}" in projected["href"]
    assert f"expense={connection.id}" in projected["href"]
    if change == "published_source":
        newer = _release(db)["expenditures"]
        _expense(
            db, newer, amount=original_row.amount + 1, vendor_name="Different vendor"
        )
    else:
        link = db.get(
            m.FCCExpenseLink, uuid.UUID(connection.target_snapshot["expense_link_id"])
        )
        if change == "link_row":
            link.source_row = {
                **link.source_row,
                "vendor_name": "Different vendor",
                "amount": "1",
            }
        else:
            link.source_row_number = 99
        db.flush()
    retained = reader.expense_detail(db, connection.id)
    assert retained["source_changed"] is True
    assert "Different vendor" not in _encoded(retained)
    assert retained["fields"] == first["fields"]
    review.withdraw_connection(db, connection.id, ACTOR, "Synthetic withdrawal")
    with pytest.raises(LookupError):
        reader.expense_detail(db, connection.id)


def test_actual_prepared_and_approved_image_routes_then_withdrawal(
    db, source, api, monkeypatch
):
    document, store = source
    monkeypatch.setattr(review, "raw_file_store_from_env", lambda: store)
    copy = review.prepare_copy(db, ACTOR, preparation(source), store=store)
    client = api[0]
    private_path = f"/api/v1/admin/political-ads/copies/{copy.id}/pages/1"
    prepared = client.get(private_path)
    assert prepared.status_code == 200
    assert prepared.headers["content-type"] == "image/png"
    assert "no-store" in prepared.headers["cache-control"]
    assert prepared.content.startswith(b"\x89PNG\r\n\x1a\n")
    review.approve_copy(
        db,
        copy.id,
        ACTOR,
        {
            "expected_fingerprint": copy.fingerprint,
            "privacy_reviewed": True,
            "metadata_reviewed": True,
            "text_reviewed": True,
            "evidence": "Synthetic prepared pixels inspected",
        },
        store=store,
    )
    key = reader.file_key(document.facility_id, document.file_id)
    reader_path = (
        f"/api/v1/ads/files/{key}/pages/1?version={copy.content_hash}&copy={copy.id}"
    )
    approved_response = client.get(reader_path)
    assert approved_response.status_code == 200
    assert approved_response.content == prepared.content
    assert "no-store" in approved_response.headers["cache-control"]
    review.withdraw_copy(
        db, copy.id, ACTOR, "Synthetic withdrawal after reading pixels"
    )
    stale = client.get(reader_path, headers={"If-None-Match": '"old-cache"'})
    assert stale.status_code == 410
    assert "no-store" in stale.headers["cache-control"]
    assert not stale.content.startswith(b"\x89PNG")


def test_candidate_connection_route_requires_stage_and_preserves_structured_role(
    db, source, api
):
    client, _ = api
    publication = approved(db, source)
    election = m.CandidateElection(
        id="tv-api-election",
        canonical_key="tv-api-general",
        election_date=date(2026, 11, 3),
        stage="general",
        public_payload={},
    )
    candidate = m.CandidateRecord(
        id="tv-api-candidate",
        election_id=election.id,
        election_date=election.election_date,
        public_payload={"name": "Example Candidate"},
        source_sha256="a" * 64,
        checked_at=review.now(),
    )
    db.add_all([election, candidate])
    db.commit()
    prefix = "/api/v1/admin/political-ads"
    params = {
        "publication_id": str(publication.id),
        "election_stage": "general",
        "role": "named",
    }
    preview = client.get(f"{prefix}/targets/candidate/{candidate.id}", params=params)
    assert preview.status_code == 200
    assert preview.json()["role"] == "named"
    payload = {
        "scope": "file",
        "publication_id": str(publication.id),
        "kind": "candidate",
        "target_id": candidate.id,
        "election_stage": "general",
        "role": "named",
        "expected_target_fingerprint": preview.json()["target_fingerprint"],
        "page": 1,
        "quote": "Issue: Schools.",
        "evidence": "Synthetic candidate identity evidence",
        "correctness_reviewed": True,
        "publication_approved": False,
        "privacy_reviewed": False,
    }
    missing_stage = {
        key: value for key, value in payload.items() if key != "election_stage"
    }
    assert (
        client.post(
            f"{prefix}/copies/{publication.id}/connections", json=missing_stage
        ).status_code
        == 422
    )
    response = client.post(
        f"{prefix}/copies/{publication.id}/connections", json=payload
    )
    assert response.status_code == 200, response.json()
    assert "no-store" in response.headers["cache-control"]
    row = db.get(m.TVAdConnection, uuid.UUID(response.json()["id"]))
    assert row.target_snapshot["role"] == "named"
    assert row.target_snapshot["election_stage"] == "general"


def test_folder_source_url_uses_exact_folder_identity_even_with_shared_body(db):
    store = MemoryStore()
    digest = fcc_archive.archive_body(db, store, b"Shared empty listing")
    scan = m.FCCScan(status="complete", stations=["28010"], counts={})
    db.add(scan)
    db.flush()
    for folder_id in ("folder-a", "folder-b"):
        source_url = f"https://publicfiles.fcc.gov/tv-profile/kstp-tv/political-files/{folder_id}"
        db.add(
            m.FCCObservation(
                scan_id=scan.id,
                url=source_url,
                facility_id="28010",
                kind="folder",
                status="stored",
                content_hash=digest,
                details={"files": 0, "path": f"political-files/2026/State/{folder_id}"},
            )
        )
        db.flush()
        folder = review.prepare_folder(
            db,
            ACTOR,
            {
                "facility_id": "28010",
                "folder_id": folder_id,
                "content_hash": digest,
                "safe_label": folder_id,
                "safe_path": f"political-files/2026/State/{folder_id}",
                "year": 2026,
                "category": "State",
                "evidence": "Synthetic folder review",
            },
        )
        review.approve_folder(
            db,
            folder.id,
            ACTOR,
            {
                "expected_fingerprint": folder.fingerprint,
                "metadata_reviewed": True,
                "evidence": "Synthetic approval",
            },
        )
    for folder_id in ("folder-a", "folder-b"):
        assert reader.folder_detail(db, f"kstp-tv-{folder_id}")["fcc_url"].endswith(
            f"/{folder_id}"
        )


def test_agency_address_requires_separate_review_and_exact_published_agency(db, source):
    _, store = source
    safe = "Agency: Example Media. Billing recipient: Example Media, 123 Example Street. Agency address: Example Media, 456 Example Avenue."
    publication = review.prepare_copy(
        db,
        ACTOR,
        preparation(
            source, safe_pages=[{"page": 1, "text": safe, "text_status": "readable"}]
        ),
        store=store,
    )
    review.approve_copy(
        db,
        publication.id,
        ACTOR,
        {
            "expected_fingerprint": publication.fingerprint,
            "privacy_reviewed": True,
            "metadata_reviewed": True,
            "text_reviewed": True,
            "evidence": "Synthetic safe text review",
        },
        store=store,
    )
    address = fact(
        field="organization_address",
        value="123 Example Street",
        organization_name="Example Media",
        role="Billing recipient",
        quote="Billing recipient: Example Media, 123 Example Street.",
    )
    with pytest.raises(ValueError, match="same exact approved agency"):
        review.add_fact(
            db, publication.id, ACTOR, {**address, "agency_address_reviewed": True}
        )
    agency = review.add_fact(
        db, publication.id, ACTOR, fact(publication_approved=False)
    )
    with pytest.raises(ValueError, match="same exact approved agency"):
        review.add_fact(
            db, publication.id, ACTOR, {**address, "agency_address_reviewed": True}
        )
    agency.publication_approved = True
    db.flush()
    unrelated = review.add_fact(db, publication.id, ACTOR, address)
    assert unrelated.agency_address_reviewed is False
    key = reader.agency_key("Example Media")
    assert reader.agency_detail(db, key)["addresses"] == []
    reviewed = review.add_fact(
        db,
        publication.id,
        ACTOR,
        fact(
            field="organization_address",
            value="456 Example Avenue",
            organization_name="Example Media",
            role="Agency address",
            quote="Agency address: Example Media, 456 Example Avenue.",
            agency_address_reviewed=True,
        ),
    )
    assert reviewed.agency_address_reviewed is True
    projected = reader.agency_detail(db, key)["addresses"]
    assert len(projected) == 1
    assert projected[0]["address"] == "456 Example Avenue"
    assert projected[0]["role"] == "Agency address"


def test_committee_printed_role_requires_quote_and_is_in_inspected_target(db, source):
    publication = approved(db, source)
    filings = m.CampaignFinanceFilingSnapshot(
        fetch_started_at=review.now(),
        fetch_completed_at=review.now(),
        status=m.CampaignFinanceSnapshotStatus.loaded,
    )
    db.add(filings)
    db.flush()
    pointer = db.get(m.CampaignFinanceFilingCurrentSnapshot, True)
    if pointer:
        pointer.snapshot_id = filings.id
    else:
        db.add(m.CampaignFinanceFilingCurrentSnapshot(id=True, snapshot_id=filings.id))
    target = "19000"
    db.add(
        m.CampaignFinanceFiler(
            snapshot_id=filings.id,
            registration_number=target,
            name="Example Committee",
            kind=m.CampaignFinanceFilerKind.candidate_committee,
        )
    )
    db.flush()
    preview = review.target_preview(
        db, "committee", target, publication.id, role="Principal"
    )
    assert preview["role"] == "Principal"
    payload = {
        "scope": "file",
        "publication_id": str(publication.id),
        "kind": "committee",
        "target_id": target,
        "role": "Principal",
        "expected_target_fingerprint": preview["target_fingerprint"],
        "page": 1,
        "quote": "Principal: Example Committee.",
        "evidence": "Synthetic printed role",
        "correctness_reviewed": True,
    }
    saved = review.add_connection(db, ACTOR, payload)
    assert saved.target_snapshot["role"] == "Principal"
    with pytest.raises(ValueError, match="Role must be printed"):
        review.add_connection(db, ACTOR, {**payload, "role": "Advertiser"})


def test_reader_response_models_drop_private_fields_at_nested_boundaries(
    api, monkeypatch
):
    client, _ = api
    monkeypatch.setattr(
        reader,
        "expense_detail",
        lambda *_: {
            "id": "synthetic",
            "label": "Expense",
            "dataset": "expenditures",
            "source_date": None,
            "source_url": None,
            "source_changed": False,
            "fields": [{"label": "Amount", "value": "$10", "raw_contact": "PRIVATE"}],
            "checked_at": "2026-01-01",
            "evidence": {
                "page": 1,
                "quote": "Approved quote",
                "version_id": "a" * 64,
                "original_text": "PRIVATE",
            },
            "file": {
                "key": "kstp-tv-test",
                "name": "Approved title",
                "copy_id": "copy",
                "version_id": "a" * 64,
                "object_key": "PRIVATE",
            },
            "reviewed_by": "PRIVATE",
            "target_snapshot": {"original_text": "PRIVATE"},
        },
    )
    response = client.get(f"/api/v1/ads/expenses/{uuid.uuid4()}")
    assert response.status_code == 200
    assert "PRIVATE" not in response.text
    assert response.json()["fields"] == [{"label": "Amount", "value": "$10"}]


def test_all_reader_json_models_accept_real_approved_projections(db, source, api):
    client, _ = api
    publication = approved(db, source)
    review.add_fact(db, publication.id, ACTOR, fact())
    key = reader.file_key(publication.facility_id, publication.file_id)
    paths = [
        "/counts",
        "/sources",
        "/recent",
        "/browse",
        "/browse?tab=agencies",
        "/browse?tab=stations",
        "/browse?tab=years",
        "/browse?q=Reviewed",
        f"/files/{key}",
        "/folders/kstp-tv-folder-1",
        f"/agencies/{reader.agency_key('Example Media')}",
        "/stations/kstp-tv",
        "/connections?kind=name&target=Example%20Media",
    ]
    for path in paths:
        result = client.get("/api/v1/ads" + path)
        assert result.status_code == 200, (path, result.text)
        assert "no-store" in result.headers["cache-control"]
        assert "Private title" not in result.text
        assert "PRIVATE CONTACT NAME" not in result.text
    review.withdraw_copy(db, publication.id, ACTOR, "Synthetic withdrawal")
    result = client.get(
        f"/api/v1/ads/files/{key}?version={publication.content_hash}&copy={publication.id}"
    )
    assert result.status_code == 200
    assert result.json()["copy_status"] == "withdrawn"
