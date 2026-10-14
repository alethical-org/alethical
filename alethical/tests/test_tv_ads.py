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
        "/api/v1/admin/political-ads/copies/" + str(uuid.UUID(int=1)) + "/suggestions",
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
    # FCC folder pages we only listed (the root, a year or office level, a failed
    # listing) are not held folders: the station page counts the same unit as the tab.
    for path, status in [
        ("", "stored"),
        ("/2026", "stored"),
        ("/2026/federal", "failed"),
    ]:
        db.add(
            m.FCCObservation(
                scan_id=scan.id,
                url="https://publicfiles.fcc.gov/tv-profile/kstp-tv/political-files"
                + path,
                facility_id="28010",
                kind="folder",
                status=status,
                details={},
            )
        )
    db.flush()
    page = reader.station_detail(db, "kstp-tv")
    assert page["folder_count"] == station["folder_count"] == 1
    assert sum(c["count"] for y in page["years"] for c in y["categories"]) == 1
    assert page["folder_failures"] == 1
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


def test_admin_browses_and_opens_unapproved_archive_without_approving(
    db, source, api, monkeypatch
):
    document, store = source
    document.year = 2026
    document.folder_path = "political-files/2026/State/Sample Committee"
    db.add(
        m.FCCExtraction(
            content_hash=document.content_hash,
            version=EXTRACTOR_VERSION,
            document_kind="unknown",
            status="readable",
            errors=[],
            facts=[
                {
                    "field": "agency_name",
                    "value": "Example Media",
                    "page": 1,
                    "quote": "Agency: Example Media",
                }
            ],
        )
    )
    db.flush()
    db.add(
        m.FCCPage(
            content_hash=document.content_hash,
            version=EXTRACTOR_VERSION,
            page=1,
            text="Agency: Example Media. PRIVATE CONTACT NAME",
            status="readable",
            method="native",
        )
    )
    db.flush()
    client, state = api
    key = reader.file_key(document.facility_id, document.file_id)
    folders = client.get("/api/v1/ads/browse").json()
    assert folders["total"] == 1
    assert folders["rows"][0]["label"] == "Sample Committee"
    assert folders["rows"][0]["file_count"] == 1
    folder = client.get("/api/v1/ads/folders/" + folders["rows"][0]["key"]).json()
    assert folder["files"][0]["name"] == document.name
    assert folder["files"][0]["copy_id"] is None
    for tab in ("years", "stations"):
        result = client.get("/api/v1/ads/browse", params={"tab": tab}).json()
        assert sum(row["file_count"] for row in result["rows"]) == 1
    names = client.get("/api/v1/ads/browse?tab=agencies").json()
    assert names["rows"][0]["unchecked"] is True
    agency = client.get("/api/v1/ads/agencies/" + names["rows"][0]["key"]).json()
    assert agency["unchecked"] is True
    assert agency["groups"][0]["files"][0]["agency_unchecked"] is True
    assert agency["addresses"] == []
    detail = client.get("/api/v1/ads/files/" + key)
    assert detail.status_code == 200
    body = detail.json()
    assert body["copy_status"] == "archive"
    assert body["facts"] == body["dates"] == body["connections"] == []
    assert body["pages"][0]["text"].endswith("PRIVATE CONTACT NAME")
    assert body["versions"][0]["status"] == "archive"
    assert "no-store" in detail.headers["cache-control"]
    assert client.get("/api/v1/ads/browse?q=PRIVATE").json()["total"] == 1
    monkeypatch.setattr(review, "raw_file_store_from_env", lambda: store)
    image_path = "/api/v1" + body["pages"][0]["image_path"]
    image = client.get(image_path)
    assert image.status_code == 200
    assert image.content.startswith(b"\x89PNG")
    assert "no-store" in image.headers["cache-control"]
    assert reader.counts(db)["files_with_approved_copy"] == 0
    assert db.query(m.TVAdPublication).count() == 0
    state["allowed"] = False
    for url in ("/api/v1/ads/browse", "/api/v1/ads/files/" + key, image_path):
        denied = client.get(url)
        assert denied.status_code == 404
        assert "PRIVATE CONTACT NAME" not in denied.text


def test_admin_can_open_unapproved_current_and_older_source_without_approval(
    db, source, monkeypatch
):
    original, store = source
    monkeypatch.setattr(review, "raw_file_store_from_env", lambda: store)
    approved(db, source)
    other_hash = fcc_archive.archive_body(db, store, pdf() + b"\n% new source")
    other = m.FCCDocument(
        facility_id=original.facility_id,
        file_id=original.file_id,
        content_hash=other_hash,
        call_sign=original.call_sign,
        folder_id=original.folder_id,
        folder_path=original.folder_path,
        name="New source",
        url=original.url,
        first_seen_at=datetime(2027, 1, 1, tzinfo=timezone.utc),
        last_seen_at=datetime(2027, 1, 1, tzinfo=timezone.utc),
        last_downloaded_at=datetime(2027, 1, 1, tzinfo=timezone.utc),
    )
    db.add(other)
    db.flush()
    key = reader.file_key(original.facility_id, original.file_id)
    detail = reader.file_detail(db, key, include_archive=True)
    assert detail["version_id"] == other_hash
    assert detail["copy_status"] == "archive"
    assert detail["name"] == "New source"
    prior = reader.file_detail(
        db, key, version=original.content_hash, include_archive=True
    )
    assert prior["copy_status"] == "approved"
    assert {v["id"] for v in prior["versions"]} == {other_hash, original.content_hash}
    assert {v["id"]: v["status"] for v in prior["versions"]} == {
        other_hash: "archive",
        original.content_hash: "approved",
    }
    assert detail["page_count"] == 1


@pytest.mark.parametrize(
    "query,text",
    [
        ("Crowley", "Other CROWLEY record"),
        ("strasse", "Straße"),
        ("office", "oﬃce"),
        ("s", "ſ"),
        ("W", "ẘ"),
        ("A", "ẚ"),
        ("K", "K"),
        ("CAFÉ", "café"),
        ("50%_", "literal 50%_"),
        ("\\record", "path \\record"),
    ],
)
def test_archive_search_candidate_filter_preserves_casefold_and_literals(
    db, source, query, text
):
    document, _ = source
    db.add(
        m.FCCExtraction(
            content_hash=document.content_hash,
            version=EXTRACTOR_VERSION,
            document_kind="unknown",
            status="readable",
            facts=[],
            errors=[],
        )
    )
    db.flush()
    db.add_all(
        [
            m.FCCPage(
                content_hash=document.content_hash,
                version=EXTRACTOR_VERSION,
                page=1,
                text=text,
                status="readable",
                method="native",
            ),
            m.FCCPage(
                content_hash=document.content_hash,
                version=EXTRACTOR_VERSION,
                page=2,
                text="unrelated data",
                status="readable",
                method="native",
            ),
        ]
    )
    db.flush()
    answer = reader.browse(db, q=query, include_archive=True)
    assert any(
        row["key"] == reader.file_key(document.facility_id, document.file_id)
        for row in answer["rows"]
    )


def test_default_year_is_resolved_in_first_browse_response(db, source):
    document, _ = source
    document.year = 2026
    db.flush()
    result = reader.browse(db, default_year=True, include_archive=True)
    assert result["year"] == 2026
    assert len(result["rows"]) == 1
    assert reader.browse(db, include_archive=True)["year"] is None
    assert (
        reader.browse(db, tab="stations", default_year=True, include_archive=True)[
            "year"
        ]
        is None
    )


def test_scoped_file_projection_keeps_related_other_station(db, source):
    document, store = source
    publication = approved(db, source)
    # Related records may be outside the requested file's folder and station.
    other = m.FCCDocument(
        facility_id="23079",
        file_id="other-file",
        content_hash=document.content_hash,
        call_sign="KARE",
        folder_id="other-folder",
        folder_path="political-files/2025/State/Other",
        name="Other source",
        url="https://publicfiles.fcc.gov/other",
        year=2025,
    )
    db.add(other)
    db.flush()
    other_publication = approved(db, (other, store))
    db.add(
        m.TVAdConnection(
            publication_id=publication.id,
            facility_id=document.facility_id,
            folder_id=document.folder_id,
            scope="file",
            kind="related_document",
            target_id=str(other_publication.id),
            target_snapshot={},
            quote="Related source",
            page=1,
            status="checked",
            publication_approved=True,
            reviewed_by=ACTOR,
            evidence="Related source on page 1",
            checked_at=datetime.now(timezone.utc),
        )
    )
    db.flush()
    detail = reader.file_detail(
        db,
        reader.file_key(document.facility_id, document.file_id),
        include_archive=True,
    )
    assert detail["related"][0]["key"] == reader.file_key(
        other.facility_id, other.file_id
    )
    assert detail["related"][0]["version_count"] == 1
    assert reader.folder_detail(
        db, reader.file_key(other.facility_id, other.folder_id), include_archive=True
    )["files"][0]["key"] == reader.file_key(other.facility_id, other.file_id)


def test_scoped_folder_reads_preserve_moved_files_and_older_approved_versions(
    db, source
):
    from datetime import timedelta

    document, store = source
    approved(db, source)
    digest = fcc_archive.archive_body(
        db, store, pdf() + b"\n% another retained version"
    )
    moved = m.FCCDocument(
        facility_id=document.facility_id,
        file_id=document.file_id,
        content_hash=digest,
        call_sign=document.call_sign,
        folder_id="moved-folder",
        folder_path="2026/State/Moved",
        name="Moved source",
        url=document.url,
        year=2026,
        last_seen_at=document.last_seen_at + timedelta(days=1),
        last_downloaded_at=document.last_downloaded_at + timedelta(days=1),
    )
    db.add(moved)
    db.flush()
    old_key = reader.file_key(document.facility_id, document.folder_id)
    new_key = reader.file_key(document.facility_id, moved.folder_id)
    with pytest.raises(LookupError):
        reader.folder_detail(db, old_key, include_archive=True)
    current = reader.folder_detail(db, new_key, include_archive=True)["files"]
    assert len(current) == 1
    assert current[0]["version_count"] == 2
    assert current[0]["version_id"] == digest
    previous = reader.folder_detail(db, old_key)["files"]
    assert len(previous) == 1
    assert previous[0]["version_id"] == document.content_hash
    assert previous[0]["version_count"] == 2


def test_folder_row_describes_itself_by_approved_then_newest_copy():
    # The folder label and category come from one file; list order must not pick it.
    now = datetime(2026, 10, 1, tzinfo=timezone.utc)
    later = datetime(2026, 10, 5, tzinfo=timezone.utc)
    held_newer = SimpleNamespace(id="a", status="archive", safe_folder="a raw name")
    approved_older = SimpleNamespace(id="b", status="approved", safe_folder="Reviewed")
    held_older = SimpleNamespace(
        id="c", status="archive", safe_folder="an older raw name"
    )
    downloads = {"a": later, "b": now, "c": now}
    document = lambda copy: SimpleNamespace(last_downloaded_at=downloads[copy.id])  # noqa: E731
    copies = [held_newer, approved_older, held_older]
    assert reader._representative(copies, document) is approved_older
    assert reader._representative([held_older, held_newer], document) is held_newer
    downloads["a"] = None
    assert reader._representative([held_newer, held_older], document) is held_older


def _connection(db, publication, kind, target_id, snapshot, page=1):
    """A synthetic checked connection written directly; never a real check."""
    row = m.TVAdConnection(
        scope="file",
        publication_id=publication.id,
        facility_id=publication.facility_id,
        folder_id="folder-1",
        kind=kind,
        target_id=target_id,
        target_snapshot=snapshot,
        page=page,
        quote="Synthetic quote.",
        evidence="Synthetic connection",
        reviewed_by=ACTOR,
        checked_at=review.now(),
        publication_approved=True,
    )
    db.add(row)
    db.flush()
    return row


def _register(db, registration_number, name, office=None, district=None):
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
    db.add(
        m.CampaignFinanceFiler(
            snapshot_id=filings.id,
            registration_number=registration_number,
            name=name,
            office=office,
            district=district,
            kind=m.CampaignFinanceFilerKind.candidate_committee,
        )
    )
    db.flush()


ELECTION = {
    "label": "State Representative District 99A",
    "election_stage": "general",
    "year": 2026,
    "money_context": {"office": "House", "district": "99A", "year": 2026},
}


def test_candidate_card_puts_confirmed_committee_files_before_named_files(
    db, source, monkeypatch
):
    from alethical.api.services import candidate_legislators, legislator_finance

    publication = approved(db, source)
    candidate = m.CandidateRecord(
        id="tv-card-candidate",
        election_id="tv-card-election",
        election_date=date(2026, 11, 3),
        public_payload={"name": "Example Candidate"},
        source_sha256="a" * 64,
        checked_at=review.now(),
    )
    db.add(candidate)
    db.flush()
    person = str(uuid.uuid4())
    monkeypatch.setattr(
        candidate_legislators, "confirmed_legislator", lambda *a, **k: {"id": person}
    )
    monkeypatch.setattr(
        legislator_finance,
        "confirmed_committee_links",
        lambda db, legislator_id: (
            [
                SimpleNamespace(
                    registration_number="19001", committee_name="Example Cmte"
                )
            ]
            if str(legislator_id) == person
            else []
        ),
    )
    _connection(db, publication, "committee", "19001", {"role": "Advertiser"})
    _connection(db, publication, "candidate", candidate.id, {"role": "named"}, page=2)
    result = reader.connected(db, "candidate", candidate.id)
    assert [g["label"] for g in result["groups"]] == [
        "Files with a checked connection to Example Cmte",
        "Station files that name this candidate",
    ]
    assert result["groups"][0]["files"][0]["role"] == "Advertiser, as printed"
    assert result["groups"][1]["files"][0]["role"] == "Named on page 2"
    assert result["total"] == 1
    # Without a confirmed committee, only the named group is drawn.
    monkeypatch.setattr(
        candidate_legislators, "confirmed_legislator", lambda *a, **k: None
    )
    assert [
        g["label"] for g in reader.connected(db, "candidate", candidate.id)["groups"]
    ] == ["Station files that name this candidate"]


def test_committee_card_names_its_seat_and_each_row_its_checked_election(db, source):
    publication = approved(db, source)
    _register(db, "19002", "Example Lakes Committee", "House", "99A")
    _connection(db, publication, "committee", "19002", {"role": "Advertiser"})
    _connection(db, publication, "election", "race-1", ELECTION)
    result = reader.connected(db, "committee", "19002")
    assert result["committee"] == {
        "name": "Example Lakes Committee",
        "office": "House",
        "district": "99A",
    }
    (group,) = result["groups"]
    assert group["label"] == ""
    assert group["files"][0]["role"] == "Advertiser, as printed"
    assert group["files"][0]["election"] == "2026 general election"
    assert router.response.Connected.model_validate(result).committee.office == "House"


def test_file_page_prints_plain_roles_election_stage_and_race_link(db, source):
    publication = approved(db, source)
    for role in ("named", "advertiser"):
        _connection(
            db,
            publication,
            "candidate",
            f"candidate-{role}",
            {"label": "Example Candidate", "role": role},
        )
    _connection(db, publication, "election", "race-1", ELECTION)
    _connection(
        db, publication, "election", "race-2", {**ELECTION, "money_context": None}
    )
    review.add_fact(db, publication.id, ACTOR, fact())
    detail = reader.file_detail(
        db,
        reader.file_key(publication.facility_id, publication.file_id),
        include_archive=True,
    )
    roles = [c["role"] for c in detail["connections"] if c["kind"] == "candidate"]
    # The file page adds " on page {n}" after the role, with the page as a link.
    assert roles == ["Named", "Advertiser, as printed"]
    elections = [c for c in detail["connections"] if c["kind"] == "election"]
    assert elections[0]["label"] == "2026 general election · House District 99A"
    assert elections[0]["href"] == "/money/races/house-99a?year=2026"
    # No checked campaign-money contest: the election prints, but links nowhere.
    assert elections[1]["href"] == ""
    assert elections[1]["label"].endswith("State Representative District 99A")
    assert detail["agencies"] == [
        {
            "key": reader.agency_key("Example Media"),
            "name": "Example Media",
            "unchecked": False,
        }
    ]


def test_agency_groups_identical_addresses_and_links_both_paid_to_roles(db, source):
    _, store = source
    safe = (
        "Agency: Example Media. Agency address: Example Media, 456 Example Avenue. "
        "Remit to: Example Media, 456 Example Avenue."
    )
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
    review.add_fact(db, publication.id, ACTOR, fact())
    for role, quote in (
        ("Agency address", "Agency address: Example Media, 456 Example Avenue."),
        ("Remit to", "Remit to: Example Media, 456 Example Avenue."),
    ):
        review.add_fact(
            db,
            publication.id,
            ACTOR,
            fact(
                field="organization_address",
                value="456 Example Avenue",
                organization_name="Example Media",
                role=role,
                quote=quote,
                agency_address_reviewed=True,
            ),
        )
    projected = reader.agency_detail(db, reader.agency_key("Example Media"))
    assert projected["payments_href"].endswith("&role=vendor")
    assert projected["independent_payments_href"].endswith("&role=independent_vendor")
    (address,) = projected["addresses"]
    assert address["address"] == "456 Example Avenue"
    # The 2 printings differ in role, so each role stays beside its file.
    assert address["role"] is None
    assert [e["role"] for e in address["evidence"]] == ["Agency address", "Remit to"]
    assert router.response.Agency.model_validate(projected).addresses[0].evidence


def test_search_names_what_matched_in_the_drawn_words(db, source):
    publication = approved(db, source)
    review.add_fact(db, publication.id, ACTOR, fact())
    by_text = reader.browse(db, q="schools", include_archive=True)["rows"]
    assert by_text and by_text[0]["match_label"] == "Matched the file text, page 1"
    by_fact = reader.browse(db, q="example media", include_archive=True)["rows"]
    assert by_fact[0]["match_label"] == "Matched a checked fact"
    assert by_fact[0]["excerpt"] == "Agency name: Example Media"
    by_folder = reader.browse(db, q="reviewed folder", include_archive=True)["rows"]
    assert by_folder[0]["match_label"] == "Matched the folder label"
    assert by_folder[0]["excerpt"] == "Folder “Reviewed folder”"
