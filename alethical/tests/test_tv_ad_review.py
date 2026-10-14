"""Human review gates and immutable evidence; all sources here are synthetic."""

from __future__ import annotations

import io
import uuid
from datetime import date

import pytest
from PIL import Image
from pypdf import PdfReader, PdfWriter
from pypdf.generic import DecodedStreamObject, DictionaryObject, NameObject
from sqlalchemy import func, select

from alethical.api.services import tv_ad_review as service
from alethical.db import models as m
from alethical.db.session import get_session_factory
from alethical.pipeline import fcc_archive, tv_ad_redaction
from alethical.pipeline.fcc_document_text import EXTRACTOR_VERSION
from alethical.tests.test_raw_file_mirror import MemoryStore
from alethical.tests.test_fcc_expense_links import _release, _expense

ACTOR = "synthetic-reviewer"
SAFE = "Agency: Example Media. Gross amount: $100. Credit amount: $10. Name withheld. Principal: Example Committee. Issue: Schools."


def pdf():
    writer = PdfWriter()
    page = writer.add_blank_page(width=200, height=100)
    font = DictionaryObject(
        {
            NameObject("/Type"): NameObject("/Font"),
            NameObject("/Subtype"): NameObject("/Type1"),
            NameObject("/BaseFont"): NameObject("/Helvetica"),
        }
    )
    page[NameObject("/Resources")] = DictionaryObject(
        {
            NameObject("/Font"): DictionaryObject(
                {NameObject("/F1"): writer._add_object(font)}
            )
        }
    )
    stream = DecodedStreamObject()
    stream.set_data(b"BT /F1 10 Tf 10 50 Td (PRIVATE CONTACT NAME) Tj ET")
    page[NameObject("/Contents")] = writer._add_object(stream)
    writer.add_metadata({"/Author": "PRIVATE CONTACT NAME"})
    out = io.BytesIO()
    writer.write(out)
    return out.getvalue()


@pytest.fixture()
def db(seed_database):
    session = get_session_factory()()
    try:
        yield session
    finally:
        session.rollback()
        session.close()


@pytest.fixture()
def source(db):
    store = MemoryStore()
    digest = fcc_archive.archive_body(db, store, pdf())
    db.add(
        m.FCCDocument(
            facility_id="28010",
            file_id=str(uuid.uuid4()),
            content_hash=digest,
            call_sign="KSTP-TV",
            folder_id="folder-1",
            folder_path="political-files/2026/state",
            name="Private title",
            url="https://files.fcc.gov/source.pdf",
        )
    )
    db.flush()
    row = db.scalar(select(m.FCCDocument).where(m.FCCDocument.content_hash == digest))
    return row, store


def preparation(source, **changes):
    row, _ = source
    result = dict(
        facility_id=row.facility_id,
        file_id=row.file_id,
        content_hash=row.content_hash,
        safe_title="Reviewed invoice",
        safe_folder="Reviewed folder",
        category="State",
        safe_pages=[{"page": 1, "text": SAFE, "text_status": "readable"}],
        redactions=[
            {"page": 1, "x": 0, "y": 0, "width": 1, "height": 1, "kind": "blank"}
        ],
        evidence="Synthetic preparation",
    )
    result.update(changes)
    return result


def approved(db, source):
    _, store = source
    row = service.prepare_copy(db, ACTOR, preparation(source), store=store)
    return service.approve_copy(
        db,
        row.id,
        ACTOR,
        {
            "expected_fingerprint": row.fingerprint,
            "privacy_reviewed": True,
            "metadata_reviewed": True,
            "text_reviewed": True,
            "evidence": "Synthetic approval",
        },
        store=store,
    )


def fact(**changes):
    result = dict(
        field="agency_name",
        value="Example Media",
        page=1,
        quote="Agency: Example Media.",
        evidence="Synthetic exact text check",
        correctness_reviewed=True,
        publication_approved=True,
        privacy_reviewed=True,
    )
    result.update(changes)
    return result


def test_raster_copy_has_no_source_text_metadata_or_hidden_original():
    result = tv_ad_redaction.render_redacted(
        pdf(), [{"page": 1, "x": 0, "y": 0, "width": 1, "height": 1}]
    )
    reader = PdfReader(io.BytesIO(result["pdf"]))
    assert reader.pages[0].extract_text() == ""
    assert not reader.metadata
    assert "PRIVATE" not in repr(reader.pages[0])
    assert b"PRIVATE" not in result["pdf"]
    image = Image.open(io.BytesIO(result["pages"][0]["bytes"]))
    assert image.getextrema() == ((214, 214), (218, 218), (215, 215))
    assert set(reader.pages[0]["/Resources"]) == {"/XObject"}


def test_name_withheld_is_burned_and_small_label_is_rejected():
    result = tv_ad_redaction.render_redacted(
        pdf(),
        [{"page": 1, "x": 0, "y": 0, "width": 1, "height": 1, "kind": "name_withheld"}],
    )
    image = Image.open(io.BytesIO(result["pages"][0]["bytes"]))
    assert (238, 240, 239) in {color for _, color in image.getcolors(100000)}
    assert (44, 50, 44) in {color for _, color in image.getcolors(100000)}
    with pytest.raises(ValueError, match="Enlarge"):
        tv_ad_redaction.render_redacted(
            pdf(),
            [
                {
                    "page": 1,
                    "x": 0,
                    "y": 0,
                    "width": 0.001,
                    "height": 0.001,
                    "kind": "name_withheld",
                }
            ],
        )


@pytest.mark.parametrize(
    "change", [{"x": float("nan")}, {"width": 2}, {"page": True}, {"page": 2}]
)
def test_invalid_redactions_cannot_be_prepared(change):
    box = {"page": 1, "x": 0, "y": 0, "width": 1, "height": 1, **change}
    with pytest.raises(ValueError):
        tv_ad_redaction.validate_redactions([box], 1)


def test_exact_prepared_fingerprint_and_separate_privacy_attestations(db, source):
    row = service.prepare_copy(db, ACTOR, preparation(source), store=source[1])
    for data in (
        {"expected_fingerprint": "bad"},
        {"expected_fingerprint": row.fingerprint, "privacy_reviewed": True},
    ):
        with pytest.raises(ValueError):
            service.approve_copy(db, row.id, ACTOR, data, store=source[1])
    assert row.status == "draft"
    assert (
        service.review_payload(db, row.id)["publication"]["safe_pages"][0]["text"]
        == SAFE
    )
    with pytest.raises(ValueError, match="not approved"):
        service.add_fact(db, row.id, ACTOR, fact())


def test_new_revision_has_no_inherited_approval_and_active_copy_must_be_withdrawn(
    db, source
):
    first = approved(db, source)
    second = service.prepare_copy(
        db,
        ACTOR,
        preparation(source, safe_title="Another reviewed title"),
        store=source[1],
    )
    assert second.status == "draft" and second.reviewed_at is None
    with pytest.raises(ValueError, match="Withdraw"):
        service.approve_copy(
            db,
            second.id,
            ACTOR,
            {
                "expected_fingerprint": second.fingerprint,
                "privacy_reviewed": True,
                "metadata_reviewed": True,
                "text_reviewed": True,
                "evidence": "Synthetic review",
            },
            store=source[1],
        )
    assert first.status == "approved"


def test_artifact_corruption_prevents_approval(db, source):
    row = service.prepare_copy(db, ACTOR, preparation(source), store=source[1])
    source[1].objects[row.artifacts["pdf"]["object_key"]] = b"corrupt"
    with pytest.raises((ValueError, RuntimeError)):
        service.approve_copy(
            db,
            row.id,
            ACTOR,
            {
                "expected_fingerprint": row.fingerprint,
                "privacy_reviewed": True,
                "metadata_reviewed": True,
                "text_reviewed": True,
                "evidence": "Synthetic review",
            },
            store=source[1],
        )
    assert row.status == "draft"


def test_facts_require_approved_safe_quote_not_raw_source_and_separate_publication(
    db, source
):
    row = approved(db, source)
    with pytest.raises(ValueError, match="safe page text"):
        service.add_fact(
            db,
            row.id,
            ACTOR,
            fact(quote="PRIVATE CONTACT NAME", value="PRIVATE CONTACT NAME"),
        )
    with pytest.raises(ValueError, match="correctness"):
        service.add_fact(db, row.id, ACTOR, fact(correctness_reviewed=False))
    with pytest.raises(ValueError, match="privacy"):
        service.add_fact(db, row.id, ACTOR, fact(privacy_reviewed=False))
    checked = service.add_fact(
        db, row.id, ACTOR, fact(publication_approved=False, privacy_reviewed=False)
    )
    assert checked.status == "checked" and not checked.publication_approved


def test_fact_amount_and_role_not_inferred(db, source):
    row = approved(db, source)
    with pytest.raises(ValueError, match="explicitly printed"):
        service.add_fact(
            db,
            row.id,
            ACTOR,
            fact(
                field="net_amount",
                value="90",
                quote="Gross amount: $100. Credit amount: $10.",
            ),
        )
    with pytest.raises(ValueError, match="organizational role"):
        service.add_fact(db, row.id, ACTOR, fact(field="officer_name"))


def test_fact_correction_preserves_internal_history_without_reprinting_old_value(
    db, source
):
    row = approved(db, source)
    old = service.add_fact(db, row.id, ACTOR, fact())
    corrected = service.add_fact(
        db, row.id, ACTOR, fact(supersedes_id=str(old.id), qualifier="Name as printed")
    )
    result = service.review_payload(db, row.id)
    assert old.status == "withdrawn" and corrected.supersedes_id == old.id
    assert result["facts"][0]["value"] is None and result["facts"][0]["quote"] is None
    assert old.value == "Example Media"
    assert any(event["action"] == "corrected" for event in result["events"])


def test_copy_withdrawal_revokes_facts_and_related_connections(db, source):
    first = approved(db, source)
    checked = service.add_fact(db, first.id, ACTOR, fact())
    connection = service.add_connection(
        db,
        ACTOR,
        {
            "scope": "file",
            "publication_id": str(first.id),
            "kind": "issue",
            "target_id": "Schools",
            "expected_target_fingerprint": service.target_preview(
                db, "issue", "Schools", first.id
            )["target_fingerprint"],
            "page": 1,
            "quote": "Issue: Schools.",
            "evidence": "Synthetic printed principal",
            "correctness_reviewed": True,
            "publication_approved": True,
            "privacy_reviewed": True,
        },
    )
    service.withdraw_copy(db, first.id, ACTOR, "Synthetic privacy correction")
    assert checked.status == connection.status == "withdrawn"
    assert not checked.publication_approved and not connection.publication_approved
    with pytest.raises(ValueError, match="not approved"):
        service.add_fact(db, first.id, ACTOR, fact())


def test_relationship_targets_reject_arbitrary_urls_and_wrong_stage(db, source):
    row = approved(db, source)
    data = dict(
        scope="file",
        publication_id=str(row.id),
        kind="candidate",
        target_id="https://example.com/person",
        page=1,
        quote="Agency: Example Media.",
        evidence="Synthetic",
        correctness_reviewed=True,
    )
    with pytest.raises(ValueError, match="does not exist"):
        service.add_connection(db, ACTOR, data)
    election_id = "tv-test-election"
    db.add(
        m.CandidateElection(
            id=election_id,
            canonical_key="tv-test-primary",
            election_date=date(2026, 8, 11),
            stage="primary",
            public_payload={"label": "Test primary"},
        )
    )
    db.flush()
    db.add(
        m.CandidateRaceRecord(
            id="tv-test-race",
            election_id=election_id,
            stage="primary",
            jurisdiction_scope="Minnesota House District 34A",
            office="State Representative District 34A",
            result_status="pending",
        )
    )
    db.flush()
    with pytest.raises(ValueError, match="exact election stage"):
        service.add_connection(
            db,
            ACTOR,
            {
                **data,
                "kind": "election",
                "target_id": "tv-test-race",
                "election_stage": "general",
            },
        )
    with pytest.raises(ValueError, match="Folder connections"):
        service.add_connection(db, ACTOR, {**data, "scope": "folder"})


def test_expense_preview_and_connection_keep_exact_row_and_identity(db, source):
    publication = approved(db, source)
    snapshots = _release(db)
    snapshot = snapshots["expenditures"]
    expense = _expense(db, snapshot)
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
            content_hash=publication.content_hash,
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
            content_hash=publication.content_hash,
            version=EXTRACTOR_VERSION,
            page=1,
            text=SAFE,
            method="synthetic",
            status="extracted",
        )
    )
    db.flush()
    target = f"expenditures:{snapshot.id}:1"
    preview = service.target_preview(db, "expense", target, publication.id)
    assert preview["source_content_hash"] == snapshot.content_hash
    data = dict(
        scope="file",
        publication_id=str(publication.id),
        kind="expense",
        target_id=target,
        source_content_hash=snapshot.content_hash,
        expected_target_fingerprint=preview["target_fingerprint"],
        extraction_version=EXTRACTOR_VERSION,
        page=1,
        quote="Agency: Example Media.",
        evidence="Synthetic reviewed identity and expense",
        correctness_reviewed=True,
        publication_approved=True,
        privacy_reviewed=True,
        file_identity_reviewed=True,
    )
    with pytest.raises(ValueError, match="fingerprint"):
        service.add_connection(db, ACTOR, {**data, "source_content_hash": "b" * 64})
    data["expected_target_fingerprint"] = service.target_preview(
        db,
        data["kind"],
        data["target_id"],
        data.get("publication_id"),
        election_stage=data.get("election_stage"),
    )["target_fingerprint"]
    connection = service.add_connection(db, ACTOR, data)
    assert connection.target_snapshot["file_id"] == publication.file_id
    assert connection.target_snapshot["source_row"]["amount"] == str(expense.amount)
    assert connection.target_snapshot["source_row_number"] == 1


def test_metadata_only_approval_cannot_publish_images_text_or_facts(db, source):
    row = service.prepare_copy(
        db, ACTOR, preparation(source, metadata_only=True), store=source[1]
    )
    assert row.artifacts == {"pdf": None, "pages": []} and row.safe_pages == []
    service.approve_metadata(
        db,
        row.id,
        ACTOR,
        {
            "expected_fingerprint": row.fingerprint,
            "metadata_reviewed": True,
            "evidence": "Synthetic safe metadata",
        },
    )
    assert row.metadata_approved and row.status == "draft"
    payload = service.review_payload(db, row.id)["publication"]
    assert payload["metadata_only"] and payload["metadata_approved"]
    with pytest.raises(ValueError, match="rendered pages"):
        service.approve_copy(
            db,
            row.id,
            ACTOR,
            {
                "expected_fingerprint": row.fingerprint,
                "privacy_reviewed": True,
                "metadata_reviewed": True,
                "text_reviewed": True,
                "evidence": "Synthetic",
            },
            store=source[1],
        )
    with pytest.raises(ValueError, match="not approved"):
        service.add_fact(db, row.id, ACTOR, fact())
    service.withdraw_copy(db, row.id, ACTOR, "Synthetic metadata withdrawal")
    assert not row.metadata_approved


def test_metadata_only_does_not_need_a_readable_original(db, source):
    source[1].objects.clear()
    row = service.prepare_copy(
        db, ACTOR, preparation(source, metadata_only=True), store=source[1]
    )
    assert row.status == "draft" and not row.metadata_approved


def test_empty_folder_metadata_binds_exact_listing_and_never_file_approval(db):
    store = MemoryStore()
    digest = fcc_archive.archive_body(db, store, b"<html>Empty political folder</html>")
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
            details={"files": 0, "path": "political-files/2026/state/empty-folder"},
        )
    )
    db.flush()
    row = service.prepare_folder(
        db,
        ACTOR,
        {
            "facility_id": "28010",
            "folder_id": "empty-folder",
            "content_hash": digest,
            "category": "State",
            "year": 2026,
            "safe_label": "Reviewed empty folder",
            "safe_path": "2026 / State / Reviewed empty folder",
            "evidence": "Synthetic metadata",
        },
    )
    assert row.status == "draft"
    with pytest.raises(ValueError, match="exact prepared"):
        service.approve_folder(
            db,
            row.id,
            ACTOR,
            {
                "expected_fingerprint": "stale",
                "metadata_reviewed": True,
                "evidence": "Synthetic",
            },
        )
    service.approve_folder(
        db,
        row.id,
        ACTOR,
        {
            "expected_fingerprint": row.fingerprint,
            "metadata_reviewed": True,
            "evidence": "Synthetic",
        },
    )
    assert service.folder_review_payload(db, row.id)["status"] == "approved"
    assert db.scalar(select(m.TVAdPublication.id).limit(1)) is None
    service.withdraw_folder(db, row.id, ACTOR, "Synthetic withdrawal")
    assert row.status == "withdrawn"


def test_read_artifact_does_not_return_metadata_only_as_file(db, source):
    row = service.prepare_copy(
        db, ACTOR, preparation(source, metadata_only=True), store=source[1]
    )
    with pytest.raises(ValueError, match="not found"):
        service.read_artifact(row, source[1])


def test_unfamiliar_literal_station_category_is_preserved(db, source):
    row = service.prepare_copy(
        db,
        ACTOR,
        preparation(
            source, category="Referenda and community issues", metadata_only=True
        ),
        store=source[1],
    )
    assert row.category == "Referenda and community issues"


def test_safe_correction_history_requires_its_own_privacy_review_and_can_be_removed(
    db, source
):
    publication = approved(db, source)
    old = service.add_fact(db, publication.id, ACTOR, fact())
    with pytest.raises(ValueError, match="separate privacy approval"):
        service.add_fact(
            db,
            publication.id,
            ACTOR,
            fact(supersedes_id=str(old.id), history_publication_approved=True),
        )
    replacement = service.add_fact(
        db,
        publication.id,
        ACTOR,
        fact(
            supersedes_id=str(old.id),
            qualifier="Printed spelling",
            history_publication_approved=True,
            history_privacy_reviewed=True,
        ),
    )
    assert old.status == "withdrawn" and old.history_publication_approved
    assert not old.publication_approved and replacement.publication_approved
    service.withdraw_fact(db, old.id, ACTOR, "Synthetic privacy withdrawal")
    assert not old.history_publication_approved


def test_copy_withdrawal_also_removes_safe_corrected_history(db, source):
    publication = approved(db, source)
    old = service.add_fact(db, publication.id, ACTOR, fact())
    service.add_fact(
        db,
        publication.id,
        ACTOR,
        fact(
            supersedes_id=str(old.id),
            history_publication_approved=True,
            history_privacy_reviewed=True,
        ),
    )
    service.withdraw_copy(
        db, publication.id, ACTOR, "Synthetic copy privacy withdrawal"
    )
    assert not old.history_publication_approved


def test_organization_address_cannot_lose_the_exact_organization_association(
    db, source
):
    publication = approved(db, source)
    with pytest.raises(ValueError, match="exact printed organization"):
        service.add_fact(
            db,
            publication.id,
            ACTOR,
            fact(field="organization_address", value="Example Media", role="Agency"),
        )
    with pytest.raises(ValueError, match="Organization name must"):
        service.add_fact(
            db,
            publication.id,
            ACTOR,
            fact(
                field="organization_address",
                value="Example Media",
                role="Agency",
                organization_name="Another Media",
            ),
        )


def test_race_connection_preserves_exact_office_scope_and_stage(db, source):
    publication = approved(db, source)
    election = m.CandidateElection(
        id="tv-scope-election",
        canonical_key="tv-scope-general",
        election_date=date(2026, 11, 3),
        stage="general",
        public_payload={"label": "General election"},
    )
    db.add(election)
    db.flush()
    race = m.CandidateRaceRecord(
        id="tv-scope-race",
        election_id=election.id,
        stage="general",
        jurisdiction_scope="Minnesota House District 34A",
        office="State Representative District 34A",
        result_status="pending",
    )
    db.add(race)
    db.flush()
    data = dict(
        scope="file",
        publication_id=str(publication.id),
        kind="election",
        target_id=race.id,
        election_stage="general",
        page=1,
        quote="Issue: Schools.",
        evidence="Synthetic exact race evidence",
        correctness_reviewed=True,
    )
    with pytest.raises(ValueError, match="exact election race"):
        service.add_connection(db, ACTOR, {**data, "target_id": election.id})
    preview = service.target_preview(
        db, "election", race.id, publication.id, election_stage="general"
    )
    data["expected_target_fingerprint"] = service.target_preview(
        db,
        data["kind"],
        data["target_id"],
        data.get("publication_id"),
        election_stage=data.get("election_stage"),
    )["target_fingerprint"]
    connection = service.add_connection(db, ACTOR, data)
    assert connection.target_snapshot["race_id"] == race.id
    assert connection.target_snapshot["jurisdiction_scope"] == race.jurisdiction_scope
    assert preview["office"] == race.office and preview["year"] == 2026
    assert connection.target_snapshot["election_stage"] == "general"

    filings = m.CampaignFinanceFilingSnapshot(
        fetch_started_at=service.now(),
        fetch_completed_at=service.now(),
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
            registration_number="tv-context",
            kind=m.CampaignFinanceFilerKind.candidate_committee,
            name="Example Committee",
            office="House",
            district="34A",
        )
    )
    db.flush()
    with pytest.raises(ValueError, match="must exist"):
        service.target_preview(
            db,
            "election",
            race.id,
            publication.id,
            election_stage="general",
            money_office="House",
            money_district="99A",
        )
    preview = service.target_preview(
        db,
        "election",
        race.id,
        publication.id,
        election_stage="general",
        money_office="House",
        money_district="34A",
    )
    assert preview["money_context"] == {
        "office": "House",
        "district": "34A",
        "year": 2026,
    }
    context_data = {
        **data,
        "money_office": "House",
        "money_district": "34A",
        "expected_target_fingerprint": preview["target_fingerprint"],
    }
    with pytest.raises(ValueError, match="office and district"):
        service.add_connection(db, ACTOR, context_data)
    linked = service.add_connection(
        db, ACTOR, {**context_data, "money_context_reviewed": True}
    )
    assert linked.target_snapshot["money_context"] == preview["money_context"]
    race.office = "Changed official office"
    db.flush()
    with pytest.raises(ValueError, match="not previewed"):
        service.add_connection(
            db, ACTOR, {**context_data, "money_context_reviewed": True}
        )


def test_principal_requires_real_entity_id_not_printed_free_name(
    db, source, monkeypatch
):
    from types import SimpleNamespace
    from alethical.api.services import lobbying

    publication = approved(db, source)
    marker = uuid.uuid4().hex * 2
    snapshot = m.LobbyingExpenditureSnapshot(
        source_url="https://cfb.mn.gov/test.csv",
        download_id="-1",
        content_hash=marker,
        record_set_hash=marker,
        byte_size=10,
        fetch_started_at=service.now(),
        fetch_completed_at=service.now(),
        status=m.CampaignFinanceSnapshotStatus.loaded,
        row_count=1,
    )
    db.add(snapshot)
    db.flush()
    db.add(
        m.LobbyingExpenditureRow(
            snapshot_id=snapshot.id,
            row_number=1,
            entity_id="12345",
            principal="Example Committee",
            report_year=2026,
        )
    )
    db.flush()
    pair = SimpleNamespace(
        id=uuid.uuid4(),
        expenditure_snapshot_id=snapshot.id,
        lobbyist_snapshot_id=uuid.uuid4(),
    )
    monkeypatch.setattr(lobbying, "published_pair", lambda _: pair)
    data = dict(
        scope="file",
        publication_id=str(publication.id),
        kind="principal",
        target_id="12345",
        page=1,
        quote="Principal: Example Committee.",
        evidence="Synthetic existing organization check",
        correctness_reviewed=True,
    )
    with pytest.raises(ValueError, match="entity number"):
        service.add_connection(db, ACTOR, {**data, "target_id": "Example Committee"})
    with pytest.raises(ValueError, match="does not exist"):
        service.add_connection(db, ACTOR, {**data, "target_id": "99999"})
    data["expected_target_fingerprint"] = service.target_preview(
        db,
        data["kind"],
        data["target_id"],
        data.get("publication_id"),
        election_stage=data.get("election_stage"),
    )["target_fingerprint"]
    connection = service.add_connection(db, ACTOR, data)
    assert connection.target_snapshot["entity_id"] == 12345
    assert connection.target_snapshot["label"] == "Example Committee"


def test_folder_evidence_unescapes_retained_json_and_rejects_wrong_identity(db):
    import json

    store = MemoryStore()
    digest = fcc_archive.archive_body(
        db, store, json.dumps({"name": "A & B Committee", "files": []}).encode()
    )
    scan = m.FCCScan(status="complete", stations=["28010"], counts={})
    db.add(scan)
    db.flush()
    db.add(
        m.FCCObservation(
            scan_id=scan.id,
            url="https://publicfiles.fcc.gov/tv-profile/kstp-tv/political-files/folder-quote",
            facility_id="28010",
            kind="folder",
            status="stored",
            content_hash=digest,
            details={},
        )
    )
    db.flush()
    assert (
        service.folder_evidence(db, "28010", "folder-quote", digest, store=store)[
            "text"
        ]
        == "A & B Committee"
    )
    with pytest.raises(ValueError, match="listing not found"):
        service.folder_evidence(db, "28010", "unrelated-folder", digest, store=store)


def test_target_must_match_last_preview(db, source):
    publication = approved(db, source)
    data = dict(
        publication_id=str(publication.id),
        kind="issue",
        target_id="Schools",
        page=1,
        quote="Issue: Schools.",
        correctness_reviewed=True,
        evidence="Synthetic preview guard",
    )
    with pytest.raises(ValueError, match="not previewed"):
        service.add_connection(db, ACTOR, data)
    preview = service.target_preview(db, "issue", "Schools", publication.id)
    with pytest.raises(ValueError, match="not previewed"):
        service.add_connection(
            db, ACTOR, {**data, "expected_target_fingerprint": "0" * 64}
        )
    connection = service.add_connection(
        db,
        ACTOR,
        {**data, "expected_target_fingerprint": preview["target_fingerprint"]},
    )
    assert connection.target_snapshot["label"] == "Schools"


def test_read_artifact_uses_configured_private_store(db, source, monkeypatch):
    publication = approved(db, source)
    monkeypatch.setattr(service, "raw_file_store_from_env", lambda: source[1])
    assert service.read_artifact(publication, page=1).startswith(b"\x89PNG")


def test_candidate_role_requires_explicit_quote_and_stays_in_preview(db, source):
    publication = approved(db, source)
    election = m.CandidateElection(
        id="tv-role-election",
        canonical_key="tv-role-general",
        election_date=date(2026, 11, 3),
        stage="general",
        public_payload={},
    )
    candidate = m.CandidateRecord(
        id="tv-role-candidate",
        election_id=election.id,
        election_date=election.election_date,
        public_payload={"name": "Example Candidate"},
        source_sha256="a" * 64,
        checked_at=service.now(),
    )
    db.add_all([election, candidate])
    db.flush()
    preview = service.target_preview(
        db, "candidate", candidate.id, publication.id, election_stage="general"
    )
    assert preview["role"] == "named"
    data = dict(
        publication_id=str(publication.id),
        kind="candidate",
        target_id=candidate.id,
        election_stage="general",
        page=1,
        quote="Issue: Schools.",
        evidence="Synthetic role check",
        correctness_reviewed=True,
    )
    with pytest.raises(ValueError, match="explicitly printed"):
        service.add_connection(
            db,
            ACTOR,
            {
                **data,
                "role": "payer",
                "expected_target_fingerprint": preview["target_fingerprint"],
            },
        )
    checked = service.add_connection(
        db,
        ACTOR,
        {**data, "expected_target_fingerprint": preview["target_fingerprint"]},
    )
    assert checked.target_snapshot["role"] == "named"


def test_source_preview_reuses_pixels_but_requires_exact_source(
    db, source, monkeypatch
):
    document, store = source
    service._source_previews.clear()
    calls = []
    real_render = tv_ad_redaction.render_redacted

    def render(*args, **kwargs):
        calls.append(kwargs)
        return real_render(*args, **kwargs)

    monkeypatch.setattr(tv_ad_redaction, "render_redacted", render)
    args = (db, document.facility_id, document.file_id, document.content_hash, 1)
    first = service.render_original_page(*args, store=store)
    assert service.render_original_page(*args, store=store) == first
    assert len(calls) == 1
    assert calls[0]["include_pdf"] is False
    with pytest.raises(ValueError, match="Exact source"):
        service.render_original_page(
            db,
            document.facility_id,
            "missing-file",
            document.content_hash,
            1,
            store=store,
        )
    db.delete(document)
    db.flush()
    with pytest.raises(ValueError, match="Exact source"):
        service.render_original_page(*args, store=store)
    service._source_previews.clear()


def test_source_preview_memory_is_bounded(monkeypatch):
    service._source_previews.clear()
    monkeypatch.setattr(service, "_SOURCE_PREVIEW_LIMIT", 8)
    service._source_preview_put(("first", 1), b"1234")
    service._source_preview_put(("second", 1), b"5678")
    assert service._source_preview_get(("first", 1)) == b"1234"
    service._source_preview_put(("third", 1), b"9012")
    assert service._source_preview_get(("second", 1)) is None
    service._source_preview_put(("large", 1), b"012345678")
    assert service._source_preview_get(("large", 1)) is None
    service._source_previews.clear()


def test_review_queue_batches_status_and_page_reads(db, source):
    from sqlalchemy import event
    from alethical.api.routers import tv_ads as routes

    document, store = source
    prepared = service.prepare_copy(db, ACTOR, preparation(source), store=store)
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
    db.add(
        m.FCCPage(
            content_hash=document.content_hash,
            version=EXTRACTOR_VERSION,
            page=1,
            text="Synthetic page",
            status="readable",
            method="native",
        )
    )
    for i in range(24):
        db.add(
            m.FCCDocument(
                facility_id=document.facility_id,
                file_id=f"queue-{i}",
                content_hash=document.content_hash,
                call_sign=document.call_sign,
                folder_id=document.folder_id,
                folder_path=document.folder_path,
                name=f"Queue {i}",
                url=document.url,
            )
        )
    db.flush()
    statements = []
    connection = db.connection()

    def record(conn, cursor, statement, parameters, context, executemany):
        statements.append(statement)

    event.listen(connection, "before_cursor_execute", record)
    try:
        answer = routes.queue(station="", q="", page=1, db=db)
    finally:
        event.remove(connection, "before_cursor_execute", record)
    assert len(statements) == 4
    assert answer["total"] == 25
    assert len(answer["rows"]) == 25
    assert all(row["page_count"] == 1 for row in answer["rows"])
    own = next(row for row in answer["rows"] if row["file_id"] == document.file_id)
    assert own["copy_id"] == str(prepared.id)
    assert own["status"] == "draft"
    assert all(row["copy_id"] is None for row in answer["rows"] if row is not own)


AGREEMENT = (
    "Advertiser: Example  Committee\n"
    "Agency: Example Media\n"
    "Bill to: Example Committee Treasurer\n"
    "Requested by: Pat Example, Treasurer"
)


def approved_text(db, source, text):
    _, store = source
    row = service.prepare_copy(
        db,
        ACTOR,
        preparation(
            source, safe_pages=[{"page": 1, "text": text, "text_status": "readable"}]
        ),
        store=store,
    )
    return service.approve_copy(
        db,
        row.id,
        ACTOR,
        {
            "expected_fingerprint": row.fingerprint,
            "privacy_reviewed": True,
            "metadata_reviewed": True,
            "text_reviewed": True,
            "evidence": "Synthetic approval",
        },
        store=store,
    )


def _filer(db, *names):
    filings = m.CampaignFinanceFilingSnapshot(
        fetch_started_at=service.now(),
        fetch_completed_at=service.now(),
        status=m.CampaignFinanceSnapshotStatus.loaded,
    )
    db.add(filings)
    db.flush()
    pointer = db.get(m.CampaignFinanceFilingCurrentSnapshot, True)
    if pointer:
        pointer.snapshot_id = filings.id
    else:
        db.add(m.CampaignFinanceFilingCurrentSnapshot(id=True, snapshot_id=filings.id))
    for number, name in enumerate(names, 1):
        db.add(
            m.CampaignFinanceFiler(
                snapshot_id=filings.id,
                registration_number=f"tv-suggest-{number}",
                kind=m.CampaignFinanceFilerKind.candidate_committee,
                name=name,
            )
        )
    db.flush()


def test_bill_to_and_requested_by_are_checked_with_their_printed_role(db, source):
    publication = approved_text(db, source, AGREEMENT)
    bill_to = service.add_fact(
        db,
        publication.id,
        ACTOR,
        fact(
            field="billing_recipient",
            value="Example Committee Treasurer",
            quote="Bill to: Example Committee Treasurer",
        ),
    )
    requested = service.add_fact(
        db,
        publication.id,
        ACTOR,
        fact(
            field="requested_by",
            value="Pat Example",
            role="Treasurer",
            quote="Requested by: Pat Example, Treasurer",
        ),
    )
    assert (bill_to.field, requested.role) == ("billing_recipient", "Treasurer")
    with pytest.raises(ValueError, match="Role must be printed"):
        service.add_fact(
            db,
            publication.id,
            ACTOR,
            fact(
                field="requested_by",
                value="Pat Example",
                role="Chair",
                quote="Requested by: Pat Example, Treasurer",
            ),
        )
    from alethical.api.services import tv_ads as reader

    labels = {
        reader._fact_payload(db, row, publication.content_hash)["kind"]
        for row in (bill_to, requested)
    }
    assert labels == {"Bill to", "Requested by"}
    assert (
        reader._fact_payload(db, requested, publication.content_hash)["role"]
        == "Treasurer"
    )


def test_suggestions_carry_evidence_and_never_save_or_check_anything(db, source):
    publication = approved_text(db, source, AGREEMENT)
    db.add(
        m.FCCExtraction(
            content_hash=publication.content_hash,
            version=EXTRACTOR_VERSION,
            document_kind="order",
            status="pending_review",
            facts=[
                {
                    "field": "advertiser",
                    "value": "Example Committee",
                    "page": 1,
                    "quote": "Advertiser: Example  Committee",
                },
                {
                    "field": "agency_name",
                    "value": "Example Media",
                    "page": 1,
                    "quote": "Agency: Example Media",
                },
                {
                    "field": "agency_address",
                    "value": "1 Main St",
                    "page": 2,
                    "quote": "Agency address: 1 Main St",
                },
                {"field": "unsupported", "value": "x", "page": 1, "quote": "x"},
                {
                    "field": "advertiser",
                    "value": "Example Committee",
                    "page": 3,
                    "quote": "Advertiser: Example Committee",
                },
            ],
            errors=[],
        )
    )
    _filer(db, "EXAMPLE committee", "Example Committee Fund")
    db.flush()
    before = (
        db.scalar(select(func.count()).select_from(m.TVAdFact)),
        db.scalar(select(func.count()).select_from(m.TVAdConnection)),
        db.scalar(select(func.count()).select_from(m.FCCExpenseLink)),
        db.scalar(select(func.count()).select_from(m.TVAdReviewEvent)),
    )
    result = service.review_suggestions(db, publication.id)
    after = (
        db.scalar(select(func.count()).select_from(m.TVAdFact)),
        db.scalar(select(func.count()).select_from(m.TVAdConnection)),
        db.scalar(select(func.count()).select_from(m.FCCExpenseLink)),
        db.scalar(select(func.count()).select_from(m.TVAdReviewEvent)),
    )
    assert before == after
    facts = {f["field"]: f for f in result["facts"]}
    assert set(facts) == {"advertiser", "agency_name", "organization_address"}
    assert facts["agency_name"]["in_safe_text"] is True
    assert facts["organization_address"]["in_safe_text"] is False
    assert facts["organization_address"]["machine_field"] == "agency_address"
    assert not any(f["already_checked"] for f in result["facts"])
    # Exact printed spelling only: case and repeated spaces, never extra words.
    assert [c["registration_number"] for c in result["committees"]] == ["tv-suggest-1"]
    match = result["committees"][0]
    assert match["evidence"]["source"] == "machine_read"
    assert match["evidence"]["quote"] == "Advertiser: Example  Committee"
    assert match["already_connected"] is False
    # A value repeated on later pages is one suggestion that lists every page.
    assert facts["advertiser"]["pages"] == [1, 3]
    assert facts["advertiser"]["page"] == 1
    assert match["pages"] == [1, 3]
    assert [f["field"] for f in result["facts"]].count("advertiser") == 1

    service.add_fact(
        db,
        publication.id,
        ACTOR,
        fact(value="Example Media", quote="Agency: Example Media"),
    )
    again = service.review_suggestions(db, publication.id)
    assert next(f for f in again["facts"] if f["field"] == "agency_name")[
        "already_checked"
    ]


def test_expense_suggestions_come_from_the_existing_matcher(db, source):
    text = "Advertiser: Example Candidate Committee\nGross amount: $17,378.25"
    publication = approved_text(db, source, text)
    snapshots = _release(db)
    _expense(db, snapshots["expenditures"])
    db.add(
        m.FCCExtraction(
            content_hash=publication.content_hash,
            version=EXTRACTOR_VERSION,
            document_kind="invoice",
            status="pending_review",
            facts=[
                {
                    "field": "advertiser",
                    "value": "Example Candidate Committee",
                    "page": 1,
                    "quote": "Advertiser: Example Candidate Committee",
                },
                {
                    "field": "gross_amount",
                    "value": "17378.25",
                    "page": 1,
                    "quote": "Gross amount: $17,378.25",
                },
            ],
            errors=[],
        )
    )
    db.flush()
    db.add(
        m.FCCPage(
            content_hash=publication.content_hash,
            version=EXTRACTOR_VERSION,
            page=1,
            text=text,
            method="synthetic",
            status="extracted",
        )
    )
    db.flush()
    result = service.review_suggestions(db, publication.id)["expenses"]
    assert result["reason"] == "review_required"
    [suggestion] = result["suggestions"]
    assert suggestion["target_id"] == (f"expenditures:{snapshots['expenditures'].id}:1")
    assert suggestion["existing_link_status"] is None
    assert suggestion["in_safe_text"] is True
    assert {m["match"] for m in suggestion["matches"]} >= {
        "normalized_exact",
        "exact_amount",
    }
    assert db.scalar(select(func.count()).select_from(m.FCCExpenseLink)) == 0


def test_queue_puts_checked_agency_and_checked_folder_files_first(db, source):
    from alethical.api.routers import tv_ads as routes

    document, _ = source
    reviewed = approved_text(db, source, AGREEMENT)
    service.add_fact(
        db,
        reviewed.id,
        ACTOR,
        fact(value="Example Media", quote="Agency: Example Media"),
    )

    def doc(name, folder="folder-new", agency=None, file_id=None):
        digest = uuid.uuid4().hex + uuid.uuid4().hex
        db.add(
            m.FCCSourceBody(
                content_hash=digest,
                object_key=f"fcc/{digest}",
                byte_size=1,
                compressed_hash="a" * 64,
                compressed_byte_size=1,
                compression="gzip",
            )
        )
        db.flush()
        db.add(
            m.FCCDocument(
                facility_id="28010",
                file_id=file_id or f"queue-{name}",
                content_hash=digest,
                call_sign="KSTP-TV",
                folder_id=folder,
                folder_path="political-files/2026",
                name=name,
                url="https://files.fcc.gov/x.pdf",
            )
        )
        if agency:
            db.add(
                m.FCCExtraction(
                    content_hash=digest,
                    version=EXTRACTOR_VERSION,
                    document_kind="order",
                    status="pending_review",
                    facts=[
                        {
                            "field": "agency_name",
                            "value": agency,
                            "page": 1,
                            "quote": agency,
                        },
                        # A malformed reading must not break the queue.
                        {"field": "agency_name", "value": ["x"], "page": 0},
                    ],
                    errors=[],
                )
            )
        db.flush()

    db.add(
        m.FCCExtraction(
            content_hash=document.content_hash,
            version=EXTRACTOR_VERSION,
            document_kind="order",
            status="pending_review",
            facts=[
                {
                    "field": "agency_name",
                    "value": "Example Media",
                    "page": 1,
                    "quote": "Agency: Example Media",
                }
            ],
            errors=[],
        )
    )
    doc("Older same agency", agency="Example Media")
    doc("Different spelling", agency="EXAMPLE MEDIA")
    doc("Checked folder", folder="folder-checked")
    # A newer version of the reviewed file is not suggested by its own check.
    doc("Own newer version", agency="Example Media", file_id=document.file_id)
    doc("Newest plain")
    db.add(
        m.TVAdConnection(
            scope="folder",
            facility_id="28010",
            folder_id="folder-checked",
            folder_content_hash=document.content_hash,
            kind="committee",
            target_id="tv-suggest-1",
            target_snapshot={"label": "Example Committee"},
            quote="Example Committee",
            status="checked",
            evidence="Synthetic",
            reviewed_by=ACTOR,
            checked_at=service.now(),
            publication_approved=False,
        )
    )
    db.flush()
    answer = routes.queue(station="", q="", page=1, db=db)
    names = [row["name"] for row in answer["rows"]]
    assert answer["first_total"] == 2
    assert set(names[:2]) == {"Older same agency", "Checked folder"}
    first = {row["name"]: row for row in answer["rows"][:2]}
    assert first["Older same agency"]["checked_agency_names"] == ["Example Media"]
    assert first["Checked folder"]["folder_committees"] == ["Example Committee"]
    rest = answer["rows"][2:]
    assert not any(row["suggested_first"] for row in rest)
    # The file already approved is not suggested first even though it matches.
    own = next(row for row in rest if row["file_id"] == document.file_id)
    assert own["status"] == "approved"
