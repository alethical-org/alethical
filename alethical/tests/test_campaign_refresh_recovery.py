"""Rehearse exact-pointer recovery and unapproved evidence retention off production."""

import hashlib
import io
import json
import tarfile
from uuid import uuid4

import pytest
from sqlalchemy import text

from alethical.db import models as schema
from alethical.pipeline import campaign_finance_rollback as rollback
from alethical.pipeline import campaign_finance_refresh as refresh
from alethical.pipeline import lobbyist_evidence_preparation as preparation
from alethical.db.session import get_session_factory
from alethical.tests.test_campaign_finance_lists_and_search import _clear
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


class Store:
    def __init__(self):
        self.objects = {}

    def put_and_verify(self, key, path, expected):
        from pathlib import Path

        body = Path(path).read_bytes()
        assert hashlib.sha256(body).hexdigest() == expected
        self.objects[key] = body


def test_private_candidate_preserves_every_input_and_never_activates(db, tmp_path):
    _payments(db)
    original = db.scalar(text("SELECT snapshot_id FROM cf_filing_current"))
    pdf = b"%PDF-synthetic-private-input"
    digest = hashlib.sha256(pdf).hexdigest()
    (tmp_path / f"{digest}.pdf").write_bytes(pdf)
    (tmp_path / "recipient.json").write_text('{"catalogues": []}')
    run = {
        "release_id": "release",
        "filings_snapshot_id": str(original),
        "years": [2025],
        "recipients": [],
        "failures": [{"documents": [{"document_hash": digest}]}],
    }
    store = Store()
    receipt = preparation.retain_candidate(store, tmp_path, run)
    assert not receipt["approved"]
    with tarfile.open(
        fileobj=io.BytesIO(store.objects[receipt["object_key"]]), mode="r:gz"
    ) as bundle:
        manifest = json.load(bundle.extractfile("manifest.json"))
        for name, expected in manifest["files"].items():
            assert (
                hashlib.sha256(bundle.extractfile(name).read()).hexdigest() == expected
            )
        assert bundle.extractfile(f"sources/{digest}.pdf").read() == pdf
        assert json.load(bundle.extractfile("audit.json")) == run
    assert db.scalar(text("SELECT snapshot_id FROM cf_filing_current")) == original
    assert (
        db.scalar(text("SELECT count(*) FROM lobbyist_donation_evidence_current")) == 0
    )
    (tmp_path / f"{digest}.pdf").write_bytes(b"changed")
    with pytest.raises(ValueError, match="source_document_changed"):
        preparation.retain_candidate(store, tmp_path, run)


def test_preparation_refuses_held_history_and_current_year(monkeypatch):
    monkeypatch.setattr(preparation, "last_completed_year", lambda: 2025)
    assert preparation.supported_years() == [2022, 2023, 2024, 2025]
    for years in ([2021], [2026], []):
        with pytest.raises(ValueError, match="supported_completed"):
            preparation.prepare_candidate(None, None, years)


def test_exact_rollback_in_temporary_database_and_transaction_abort(db):
    _payments(db)
    live = rollback.live_versions(db)
    baseline_id = live.filings_snapshot_id
    baseline = db.get(schema.CampaignFinanceFilingSnapshot, baseline_id)
    proof = {
        "baseline_snapshot_id": baseline_id,
        "baseline_hash": baseline.record_set_hash,
        "payments_release_id": live.payments_release_id,
        "rows": rollback.retained_rows(db, baseline_id),
    }
    candidate = schema.CampaignFinanceFilingSnapshot(
        id=uuid4(),
        fetch_started_at=baseline.fetch_started_at,
        fetch_completed_at=baseline.fetch_completed_at,
        status=baseline.status,
    )
    db.add(candidate)
    db.flush()
    db.execute(
        text("UPDATE cf_filing_current SET snapshot_id=:id"), {"id": candidate.id}
    )
    db.commit()
    refresh.state_update(
        db, delete_keys=[refresh.RECHECK_PENDING_KEY, refresh.CLEARING_PENDING_KEY]
    )
    replacement = str(candidate.id)
    rollback.restore_baseline(db, proof, expected_current=replacement)
    assert (
        str(db.scalar(text("SELECT snapshot_id FROM cf_filing_current"))) == replacement
    )
    for changed, error in (
        ({"payments_release_id": "changed"}, "payment_release_changed"),
        ({"rows": {}}, "baseline_rows_changed"),
        ({"baseline_hash": "changed"}, "baseline_identity_changed"),
    ):
        with pytest.raises(ValueError, match=error):
            rollback.restore_baseline(
                db, proof | changed, expected_current=replacement, apply=True
            )
        db.rollback()
    with pytest.raises(ValueError, match="unexpected_live_totals"):
        rollback.restore_baseline(db, proof, expected_current=str(uuid4()), apply=True)
    db.rollback()
    # A transaction abort restores the candidate, proving rehearsal cannot leak.
    rollback.restore_baseline(db, proof, expected_current=replacement, apply=True)
    assert (
        str(db.scalar(text("SELECT snapshot_id FROM cf_filing_current"))) == baseline_id
    )
    db.rollback()
    assert (
        str(db.scalar(text("SELECT snapshot_id FROM cf_filing_current"))) == replacement
    )
    assert refresh.state_get(db, refresh.RECHECK_PENDING_KEY) is None
    assert refresh.state_get(db, refresh.CLEARING_PENDING_KEY) is None
    # Committed restore keeps source rows and records follow-up work atomically.
    rollback.restore_baseline(db, proof, expected_current=replacement, apply=True)
    db.commit()
    assert (
        str(db.scalar(text("SELECT snapshot_id FROM cf_filing_current"))) == baseline_id
    )
    assert rollback.retained_rows(db, baseline_id) == proof["rows"]
    assert (
        refresh.state_get(db, refresh.RECHECK_PENDING_KEY)["filings_snapshot_id"]
        == baseline_id
    )
    assert refresh.state_get(db, refresh.CLEARING_PENDING_KEY)


def test_candidate_refuses_missing_reviewed_pdf(tmp_path):
    run = {"recipients": [{"documents": [{"document_hash": "a" * 64}]}]}
    with pytest.raises(ValueError, match="source_document_missing"):
        preparation.retain_candidate(Store(), tmp_path, run)


def test_source_replacement_during_collection_never_stores_candidate(db, monkeypatch):
    _payments(db)
    calls = []

    def collect(session, directory, years):
        session.rollback()
        return {"collected": 1}

    monkeypatch.setattr(preparation, "collect_reports", collect)
    monkeypatch.setattr(
        preparation,
        "prepare_run",
        lambda *args: {"release_id": "replaced", "filings_snapshot_id": "replaced"},
    )
    monkeypatch.setattr(
        preparation, "retain_candidate", lambda *args: calls.append(args)
    )
    with pytest.raises(ValueError, match="sources_changed_during_collection"):
        preparation.prepare_candidate(db, Store(), [2025])
    assert calls == []


def test_donor_review_key_ignores_check_times_but_keeps_source_meaning():
    from copy import deepcopy

    def evidence(timestamp, raw_hash):
        return {
            "release_id": "release",
            "filings_snapshot_id": "snapshot",
            "years": [2025],
            "recipients": [
                {
                    "registration_number": "12345",
                    "year": 2025,
                    "collected_at": timestamp,
                    "catalogues": [
                        {
                            "hash": raw_hash,
                            "fetched_at": timestamp,
                            "payload": {
                                "timestamp": timestamp,
                                "data": {
                                    "pdfs": {
                                        "one": {
                                            "RegisteredEntityID": "12345",
                                            "FilingYear": "2025",
                                            "ReportType": "YE",
                                            "ReportName": "Year-end",
                                            "CutOffDate": "2025-12-31",
                                            "amendments": [0],
                                        }
                                    }
                                },
                            },
                            "selected_reports": [],
                        }
                    ],
                    "coverage": {
                        "catalogue_hash": raw_hash,
                        "coverage_start": "2025-01-01",
                    },
                    "coverage_manifest_hash": raw_hash,
                    "documents": [{"document_hash": "pdf-bytes"}],
                    "donors": {"donor": {"state": "checked", "amount": "500"}},
                }
            ],
            "failures": [],
        }

    first = evidence("2026-10-01T12:00:00Z", "old-catalogue-bytes")
    later = evidence("2026-10-02T12:00:00Z", "new-catalogue-bytes")
    assert preparation.finding_key(first) == preparation.finding_key(later)
    changes = []
    for key in ["release_id", "filings_snapshot_id"]:
        changed = deepcopy(later)
        changed[key] = "changed"
        changes.append(changed)
    changed = deepcopy(later)
    changed["recipients"][0]["catalogues"][0]["payload"]["data"]["pdfs"]["one"][
        "amendments"
    ] = [0, 1]
    changes.append(changed)
    changed = deepcopy(later)
    changed["recipients"][0]["documents"][0]["document_hash"] = "new-pdf"
    changes.append(changed)
    changed = deepcopy(later)
    changed["recipients"][0]["donors"]["donor"]["amount"] = "600"
    changes.append(changed)
    changed = deepcopy(later)
    changed["recipients"][0]["coverage"]["coverage_start"] = "2025-02-01"
    changes.append(changed)
    for changed in changes:
        assert preparation.finding_key(first) != preparation.finding_key(changed)
