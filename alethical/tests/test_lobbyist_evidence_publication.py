"""Reviewed donor evidence cannot outlive or outrun its source records."""

from collections import defaultdict
from copy import deepcopy
import gzip
import hashlib
import importlib
import json
from pathlib import Path

from alembic.migration import MigrationContext
from alembic.operations import Operations
import pytest
from sqlalchemy import func, inspect, select, text
from sqlalchemy.orm import Session

from alethical.db import models as schema
from alethical.db.session import get_session_factory
from alethical.pipeline import lobbyist_evidence_publication as publication
from alethical.pipeline.lobbyist_donor_proof import PROOF_VERSION, source_fingerprint
from alethical.tests.test_campaign_finance_lists_and_search import _clear
from alethical.tests.test_campaign_finance_report_document_store import MemoryStore
from alethical.tests.test_lobbying_api import _payments


@pytest.fixture()
def db(seed_database):
    session = get_session_factory()()
    _clear(session)
    try:
        yield session
    finally:
        _clear(session)
        session.close()


def _digest(run):
    return hashlib.sha256(
        json.dumps(run, sort_keys=True, default=str).encode()
    ).hexdigest()


def _run(db):
    """Synthetic reviewed evidence, bound to the real temporary source rows."""
    _payments(db)
    release, filings, rows, targets, _ = publication.source_context(db, [2025])
    grouped = defaultdict(list)
    for row in rows:
        grouped[row["recipient_reg_num"], row["year"]].append(row)
    return {
        "version": PROOF_VERSION,
        "contributions_snapshot_id": str(release.contributions.snapshot_id),
        "filings_snapshot_id": str(filings),
        "source_row_count": release.contributions.row_count,
        "release_id": str(release.id),
        "years": [2025],
        "withheld_recipients": [],
        "failures": [],
        "recipients": [
            {
                "registration_number": recipient,
                "year": year,
                "collected_at": "2026-09-19T12:00:00+00:00",
                "source_fingerprint": source_fingerprint(grouped[recipient, year]),
                "documents": [],
                "catalogues": [
                    {"fetched_at": "2026-09-19T12:00:00+00:00", "payload": {}}
                ],
                "donors": {},
            }
            for recipient, year in sorted(targets)
        ],
    }


def _publish(db, store, directory, run, **kwargs):
    return publication.publish_run(
        db, store, directory, run, reviewed_hash=_digest(run), **kwargs
    )


def _active(db):
    return db.scalar(select(schema.LobbyistDonationEvidenceCurrent.evidence_id))


def test_prepare_recomputes_from_current_source_rows(db, tmp_path, monkeypatch):
    _payments(db)
    captured = {}

    def build(directory, rows, targets):
        captured.update(directory=directory, rows=rows, targets=targets)
        return {"version": PROOF_VERSION, "recipients": [], "failures": []}

    monkeypatch.setattr(publication, "build_run", build)
    monkeypatch.setattr(publication, "superseded_comparisons", lambda *args: [])
    result = publication.prepare_run(db, tmp_path, [2025])
    assert captured["directory"] == tmp_path
    assert set(captured["targets"]) == {("17868", 2025), ("20006", 2025)}
    assert captured["rows"]
    assert all(row["receipt_type"] == "Contribution" for row in captured["rows"])
    assert result["source_row_count"] == db.scalar(
        select(func.count()).select_from(schema.CampaignFinanceContributionRow)
    )
    assert result["contributions_snapshot_id"]
    assert result["filings_snapshot_id"]


@pytest.mark.parametrize(
    ("mutation", "reason"),
    [
        ("UPDATE cf_current_release SET release_id=NULL", "no_campaign_release"),
        ("UPDATE cf_filing_current SET snapshot_id=NULL", "no_filing_snapshot"),
        (
            "DELETE FROM cf_contribution_row WHERE row_number=367605",
            "contribution_snapshot_partly_pruned",
        ),
    ],
)
def test_prepare_refuses_missing_or_incomplete_published_sources(
    db, tmp_path, mutation, reason
):
    _payments(db)
    db.execute(text(mutation))
    db.commit()
    with pytest.raises(ValueError, match=reason):
        publication.prepare_run(db, tmp_path, [2025])
    assert _active(db) is None


def test_same_reviewed_run_is_idempotent_and_keeps_complete_audit(db, tmp_path):
    run = _run(db)
    store = MemoryStore()
    first = _publish(db, store, tmp_path, run)
    second = _publish(db, store, tmp_path, run)
    assert first == second == str(_active(db))
    assert (
        db.scalar(select(func.count()).select_from(schema.LobbyistDonationEvidence))
        == 1
    )
    saved = db.scalar(select(schema.LobbyistDonationEvidence))
    assert json.loads(gzip.decompress(store.objects[saved.object_key])) == run
    assert "catalogues" not in saved.evidence["recipients"][0]
    assert len(store.uploads) == 1


@pytest.mark.parametrize("previous", [False, True])
def test_failed_audit_storage_never_replaces_active_evidence(db, tmp_path, previous):
    run = _run(db)
    if previous:
        _publish(db, MemoryStore(), tmp_path, run)
    old = _active(db)
    bad = MemoryStore()
    bad.corrupt_on_write = True
    with pytest.raises(RuntimeError):
        _publish(db, bad, tmp_path, run)
    db.rollback()
    assert _active(db) == old
    assert db.scalar(
        select(func.count()).select_from(schema.LobbyistDonationEvidence)
    ) == int(previous)


def test_unreviewed_run_is_rejected_before_any_storage(db, tmp_path):
    run = _run(db)
    store = MemoryStore()
    with pytest.raises(ValueError, match="review"):
        publication.publish_run(db, store, tmp_path, run, reviewed_hash="0" * 64)
    assert store.uploads == []
    assert _active(db) is None


def test_published_audit_is_discovered_and_verified_by_existing_backup(db, tmp_path):
    from alethical.pipeline.raw_file_mirror import body_tables, mirror_raw_files
    from alethical.tests.test_raw_file_mirror import MemoryStore as MirrorStore

    run = _run(db)
    store = MemoryStore()
    _publish(db, store, tmp_path, run)
    assert schema.LobbyistDonationEvidence in body_tables()
    proof = db.scalar(select(schema.LobbyistDonationEvidence))
    source = MirrorStore(store.objects)
    backup = MirrorStore({})
    report = mirror_raw_files(db, source, backup, str(tmp_path), log=lambda _: None)
    assert not report.failures
    db.refresh(proof)
    assert proof.mirrored_at is not None
    assert backup.objects[proof.object_key] == store.objects[proof.object_key]


@pytest.mark.parametrize(
    ("mutation", "reason"),
    [
        (
            "DELETE FROM cf_contribution_row WHERE row_number=367605",
            "source_rows_changed",
        ),
        (
            "UPDATE cf_contribution_row SET amount=amount+1 WHERE row_number=367605",
            "source_values_changed",
        ),
        ("UPDATE cf_current_release SET release_id=NULL", "sources_changed"),
        ("UPDATE cf_filing_current SET snapshot_id=NULL", "sources_changed"),
    ],
)
def test_source_changes_during_storage_preserve_previous_evidence(
    db, tmp_path, mutation, reason
):
    run = _run(db)
    _publish(db, MemoryStore(), tmp_path, run)
    old = _active(db)

    class ChangingStore(MemoryStore):
        def put_and_verify(self, key, path, expected_sha256):
            super().put_and_verify(key, path, expected_sha256)
            db.execute(text(mutation))
            db.commit()

    with pytest.raises(ValueError, match=reason):
        _publish(db, ChangingStore(), tmp_path, run)
    db.rollback()
    assert _active(db) == old
    assert (
        db.scalar(select(func.count()).select_from(schema.LobbyistDonationEvidence))
        == 1
    )


def test_local_document_change_is_rejected_before_storage(db, tmp_path):
    run = _run(db)
    body = b"%PDF-1.4 synthetic publication evidence"
    digest = hashlib.sha256(body).hexdigest()
    run["recipients"][0]["documents"] = [{"document_hash": digest}]
    (tmp_path / f"{digest}.pdf").write_bytes(b"different bytes")
    store = MemoryStore()
    with pytest.raises(ValueError, match="document_changed_before_storage"):
        _publish(db, store, tmp_path, run)
    assert _active(db) is None
    assert store.uploads == []


@pytest.mark.parametrize("change", ["older", "omitted"])
def test_older_or_missing_recipient_evidence_cannot_replace_newer_run(
    db, tmp_path, change
):
    run = _run(db)
    store = MemoryStore()
    _publish(db, store, tmp_path, run)
    old = _active(db)
    candidate = deepcopy(run)
    if change == "older":
        candidate["recipients"][0]["collected_at"] = "2026-09-18T12:00:00+00:00"
    else:
        candidate["recipients"].pop()
    with pytest.raises(ValueError, match="evidence_collection_would_move_backwards"):
        _publish(db, store, tmp_path, candidate)
    db.rollback()
    assert _active(db) == old
    assert (
        db.scalar(select(func.count()).select_from(schema.LobbyistDonationEvidence))
        == 1
    )


def test_explicit_reviewed_rollback_keeps_both_audits(db, tmp_path):
    run = _run(db)
    store = MemoryStore()
    original = _publish(db, store, tmp_path, run)
    candidate = deepcopy(run)
    candidate["recipients"][0]["collected_at"] = "2026-09-18T12:00:00+00:00"
    replacement = _publish(db, store, tmp_path, candidate, allow_rollback=True)
    assert replacement != original
    assert replacement == str(_active(db))
    assert (
        db.scalar(select(func.count()).select_from(schema.LobbyistDonationEvidence))
        == 2
    )
    assert len(store.uploads) == 2


def test_failed_recipient_pdf_is_audited_without_asserting_shared_report_identity(
    db, tmp_path
):
    run = _run(db)
    body = b"%PDF-1.4 synthetic failed recipient evidence"
    digest = hashlib.sha256(body).hexdigest()
    Path(tmp_path / f"{digest}.pdf").write_bytes(body)
    recipient = run["recipients"].pop()
    recipient["reason"] = "report_registration_mismatch"
    recipient["documents"] = [
        {
            "document_hash": digest,
            "registration_number": recipient["registration_number"],
            "filing_year": recipient["year"],
            "report_type": "YE",
            "amendment_index": 0,
            "special_election": False,
        }
    ]
    run["failures"].append(recipient)
    store = MemoryStore()
    _publish(db, store, tmp_path, run)
    isolated_key = f"campaign-finance/lobbyist-evidence/documents/{digest}.pdf.gz"
    assert gzip.decompress(store.objects[isolated_key]) == body
    assert db.get(schema.CampaignFinanceReportDocument, digest) is None
    proof = db.scalar(select(schema.LobbyistDonationEvidence))
    audit = json.loads(gzip.decompress(store.objects[proof.object_key]))
    assert audit["failures"][0]["documents"][0]["document_hash"] == digest
    assert audit["failures"][0]["reason"] == "report_registration_mismatch"
    key = f"{recipient['registration_number']}:{recipient['year']}"
    assert proof.evidence["collection_versions"][key] == recipient["collected_at"]


def test_missing_previously_stored_pdf_prevents_reactivation(db, tmp_path):
    run = _run(db)
    body = b"%PDF-1.4 synthetic stored report availability test"
    digest = hashlib.sha256(body).hexdigest()
    (tmp_path / f"{digest}.pdf").write_bytes(body)
    recipient = run["recipients"][0]
    recipient["documents"] = [
        {
            "document_hash": digest,
            "registration_number": recipient["registration_number"],
            "filing_year": recipient["year"],
            "report_type": "YE",
            "amendment_index": 0,
            "special_election": False,
        }
    ]
    store = MemoryStore()
    try:
        _publish(db, store, tmp_path, run)
        old = _active(db)
        stored = db.get(schema.CampaignFinanceReportDocument, digest)
        del store.objects[stored.object_key]
        with pytest.raises(KeyError):
            _publish(db, store, tmp_path, run)
        db.rollback()
        assert _active(db) == old
        assert (
            db.scalar(select(func.count()).select_from(schema.LobbyistDonationEvidence))
            == 1
        )
    finally:
        db.rollback()
        db.execute(
            text("DELETE FROM cf_report_document WHERE document_hash=:hash"),
            {"hash": digest},
        )
        db.commit()


def test_selected_and_period_only_coverage_documents_are_each_stored_and_read_once(
    db, tmp_path
):
    run = _run(db)
    recipient = run["recipients"][0]
    bodies = [
        b"%PDF-1.4 synthetic selected annual report for coverage storage",
        b"%PDF-1.4 synthetic period-only earlier report for coverage storage",
    ]
    documents = []
    for index, body in enumerate(bodies):
        digest = hashlib.sha256(body).hexdigest()
        (tmp_path / f"{digest}.pdf").write_bytes(body)
        documents.append(
            {
                "document_hash": digest,
                "registration_number": recipient["registration_number"],
                "filing_year": recipient["year"],
                "report_type": "YE" if index == 0 else "PR",
                "amendment_index": 0,
                "special_election": False,
                "period_only": index == 1,
            }
        )
    recipient["documents"] = [documents[0]]
    recipient["coverage"] = {"documents": documents}

    class CountingStore(MemoryStore):
        def __init__(self):
            super().__init__()
            self.reads = []

        def get(self, key, destination):
            self.reads.append(key)
            super().get(key, destination)

    store = CountingStore()
    try:
        _publish(db, store, tmp_path, run)
        for document, body in zip(documents, bodies, strict=True):
            saved = db.get(
                schema.CampaignFinanceReportDocument, document["document_hash"]
            )
            assert saved is not None
            assert gzip.decompress(store.objects[saved.object_key]) == body
            assert store.uploads.count(saved.object_key) == 1
            assert store.reads.count(saved.object_key) == 1
        proof = db.scalar(select(schema.LobbyistDonationEvidence))
        audit = json.loads(gzip.decompress(store.objects[proof.object_key]))
        assert audit["recipients"][0]["coverage"]["documents"] == documents
        assert len(store.uploads) == 3  # 2 distinct PDFs and the complete audit.
    finally:
        db.rollback()
        for document in documents:
            db.execute(
                text("DELETE FROM cf_report_document WHERE document_hash=:hash"),
                {"hash": document["document_hash"]},
            )
        db.commit()


def test_migration_round_trip_preserves_original_contribution_rows(db):
    _payments(db)
    original_rows = db.execute(
        text("SELECT row_number, amount FROM cf_contribution_row ORDER BY row_number")
    ).all()
    original_release = db.scalar(
        select(schema.CampaignFinanceCurrentRelease.release_id)
    )
    migration = importlib.import_module(
        "alethical.alembic.versions.0057_lobbyist_donation_evidence"
    )
    connection = db.connection()
    with Operations.context(MigrationContext.configure(connection)):
        migration.downgrade()
        assert "lobbyist_donation_evidence" not in inspect(connection).get_table_names()
        migration.upgrade()
    tables = inspect(connection).get_table_names()
    assert "lobbyist_donation_evidence" in tables
    assert "lobbyist_donation_evidence_current" in tables
    assert (
        db.execute(
            text(
                "SELECT row_number, amount FROM cf_contribution_row ORDER BY row_number"
            )
        ).all()
        == original_rows
    )
    assert (
        db.scalar(select(schema.CampaignFinanceCurrentRelease.release_id))
        == original_release
    )
    db.rollback()


def test_failed_refresh_keeps_prior_known_donors_and_stable_audit(
    db, tmp_path, monkeypatch
):
    run = _run(db)
    recipient = run["recipients"][0]
    recipient["donors"] = {"141": {"status": "agrees", "row_numbers": [367605]}}
    store = MemoryStore()
    original = _publish(db, store, tmp_path, run)
    replacement = deepcopy(run)
    failed = replacement["recipients"].pop(0)
    failed.pop("donors")
    failed["reason"] = "report_unreadable"
    replacement["failures"].append(failed)
    monkeypatch.setattr(publication, "build_run", lambda *args: deepcopy(replacement))
    monkeypatch.setattr(publication, "superseded_comparisons", lambda *args: [])
    prepared = publication.prepare_run(db, tmp_path, [2025])
    assert prepared["unresolved_donors"] == [
        {
            "donor_registration_number": "141",
            "recipient_registration_number": recipient["registration_number"],
            "year": recipient["year"],
            "previous_evidence_id": original,
        }
    ]
    refreshed = _publish(db, store, tmp_path, prepared)
    assert refreshed != original
    repeated = publication.prepare_run(db, tmp_path, [2025])
    assert publication.audit_digest(repeated) == publication.audit_digest(prepared)
    assert _publish(db, store, tmp_path, repeated) == refreshed


@pytest.mark.parametrize("status", ["agrees", "disagrees"])
def test_current_donor_verdict_resolves_inherited_relationship(
    db, tmp_path, monkeypatch, status
):
    run = _run(db)
    recipient = run["recipients"][0]
    run["unresolved_donors"] = [
        {
            "donor_registration_number": "141",
            "recipient_registration_number": recipient["registration_number"],
            "year": recipient["year"],
            "previous_evidence_id": "older-evidence-origin",
        }
    ]
    _publish(db, MemoryStore(), tmp_path, run)
    replacement = deepcopy(run)
    replacement["recipients"][0]["donors"] = {
        "141": {"status": status, "row_numbers": [367605] if status == "agrees" else []}
    }
    monkeypatch.setattr(publication, "build_run", lambda *args: deepcopy(replacement))
    monkeypatch.setattr(publication, "superseded_comparisons", lambda *args: [])
    assert publication.prepare_run(db, tmp_path, [2025])["unresolved_donors"] == []


def test_prior_relationship_survives_new_filings_but_not_new_contribution_source(
    db, tmp_path
):
    from datetime import datetime, UTC
    from uuid import uuid4

    run = _run(db)
    _publish(db, MemoryStore(), tmp_path, run)
    now = datetime.now(UTC)
    fresh = schema.CampaignFinanceFilingSnapshot(
        fetch_started_at=now,
        fetch_completed_at=now,
        status=schema.CampaignFinanceSnapshotStatus.loaded,
    )
    db.add(fresh)
    db.flush()
    db.execute(text("UPDATE cf_filing_current SET snapshot_id=:id"), {"id": fresh.id})
    db.commit()
    previous = publication._previous_same_source_evidence(
        db, run["contributions_snapshot_id"]
    )
    assert previous is not None
    assert str(previous.filings_snapshot_id) != str(fresh.id)
    assert publication._previous_same_source_evidence(db, uuid4()) is None


def test_pre_migration_dry_run_can_read_prior_evidence_absence(db):
    # Transactional rename simulates an uninstalled additive migration without
    # dropping any source table or data; rollback restores the original name.
    db.execute(
        text(
            "ALTER TABLE lobbyist_donation_evidence_current "
            "RENAME TO test_temporarily_hidden_evidence_current"
        )
    )
    try:
        assert publication._previous_same_source_evidence(db, None) is None
    finally:
        db.rollback()


def _concurrent_missing_id_runs(db):
    """The newer proof alone knows which donor owns an unchanged missing-ID row."""
    initial = _run(db)
    db.execute(
        text(
            "UPDATE cf_contribution_row SET contrib_reg_num=NULL, "
            "contrib_type='Individual', contributor='Previously unnamed donor' "
            "WHERE row_number=367605"
        )
    )
    db.commit()
    _, _, rows, _, _ = publication.source_context(db, [2025])
    for recipient in initial["recipients"]:
        recipient["source_fingerprint"] = source_fingerprint(
            [
                row
                for row in rows
                if row["recipient_reg_num"] == recipient["registration_number"]
                and row["year"] == recipient["year"]
            ]
        )
    newer = deepcopy(initial)
    recipient = next(
        r for r in newer["recipients"] if r["registration_number"] == "17868"
    )
    recipient["donors"] = {"999999": {"status": "agrees", "row_numbers": [367605]}}
    recipient["collected_at"] = "2026-09-19T13:00:00+00:00"
    proposed = deepcopy(initial)
    proposed["unresolved_donors"] = []
    for recipient in proposed["recipients"]:
        recipient["collected_at"] = "2026-09-19T14:00:00+00:00"
    return initial, newer, proposed


def _store_activating_during_upload(db, tmp_path, newer, activated):
    class ConcurrentPublicationStore(MemoryStore):
        def put_and_verify(self, key, path, expected_sha256):
            super().put_and_verify(key, path, expected_sha256)
            # A separate connection commits while the slower publisher uploads,
            # before the slower publisher acquires its activation lock.
            with Session(db.get_bind()) as concurrent:
                activated.append(_publish(concurrent, MemoryStore(), tmp_path, newer))

    return ConcurrentPublicationStore()


@pytest.mark.parametrize("preload_pointer", [False, True])
def test_concurrent_new_missing_id_relationship_cannot_be_forgotten(
    db, tmp_path, preload_pointer
):
    initial, newer, proposed = _concurrent_missing_id_runs(db)
    _publish(db, MemoryStore(), tmp_path, initial)
    held_pointer = (
        db.get(schema.LobbyistDonationEvidenceCurrent, True)
        if preload_pointer
        else None
    )
    failed = next(
        r for r in proposed["recipients"] if r["registration_number"] == "17868"
    )
    proposed["recipients"].remove(failed)
    failed.pop("donors")
    failed["reason"] = "report_unreadable"
    proposed["failures"].append(failed)
    activated = []
    store = _store_activating_during_upload(db, tmp_path, newer, activated)
    with pytest.raises(
        ValueError, match="known_donor_relationships_changed_before_activation"
    ):
        _publish(db, store, tmp_path, proposed)
    db.rollback()
    assert len(activated) == 1
    assert str(_active(db)) == activated[0]
    assert (
        db.scalar(select(func.count()).select_from(schema.LobbyistDonationEvidence))
        == 2
    )
    if held_pointer is not None:
        assert str(held_pointer.evidence_id) == activated[0]


@pytest.mark.parametrize("status", ["agrees", "disagrees"])
def test_current_verdict_resolves_concurrent_relationship_and_remains_idempotent(
    db, tmp_path, status
):
    initial, newer, proposed = _concurrent_missing_id_runs(db)
    _publish(db, MemoryStore(), tmp_path, initial)
    recipient = next(
        r for r in proposed["recipients"] if r["registration_number"] == "17868"
    )
    recipient["donors"] = {
        "999999": {
            "status": status,
            "row_numbers": [367605] if status == "agrees" else [],
        }
    }
    activated = []
    store = _store_activating_during_upload(db, tmp_path, newer, activated)
    replacement = _publish(db, store, tmp_path, proposed)
    assert activated and replacement != activated[0]
    assert str(_active(db)) == replacement
    assert _publish(db, MemoryStore(), tmp_path, proposed) == replacement
    assert (
        db.scalar(select(func.count()).select_from(schema.LobbyistDonationEvidence))
        == 3
    )
