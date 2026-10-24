"""A failed complete file cannot hold back another file or renew its copy date."""

from copy import deepcopy
from dataclasses import replace
from datetime import UTC, datetime, timedelta
import uuid

import pytest
from sqlalchemy import text


from alethical.db import models
from alethical.pipeline import campaign_finance as cf
from alethical.pipeline import campaign_finance_reader as reader
from alethical.pipeline import campaign_finance_refresh as refresh
from alethical.tests.test_campaign_finance_load import (
    CONTRIBUTION_ROWS,
    EXPENDITURE_ROWS,
    Dataset,
    publish_first,
    run,
    live,
)


pytest_plugins = ["alethical.tests.test_campaign_finance_load"]


def test_held_spending_keeps_exact_manifest_while_contributions_publish(
    db, board, store
):
    first = publish_first(db, board, store)
    old = live(db)
    old_manifest = old.file_manifest
    board.set_rows(
        Dataset.contributions,
        [row.replace("250.0000", "251.0000") for row in CONTRIBUTION_ROWS],
    )
    board.set_rows(Dataset.expenditures, EXPENDITURE_ROWS[1:])
    result = run(db, board, store)
    assert result.published, result.summary()
    assert result.refusal and [one.spec.dataset for one in result.quarantined] == [
        Dataset.expenditures
    ]
    current = live(db)
    assert current.id != first.release_id
    assert current.file_manifest["expenditures"] == old_manifest["expenditures"]
    assert current.contributions_snapshot_id != old.contributions_snapshot_id
    assert (
        current.file_manifest["contributions"]["receipt_id"]
        != old_manifest["contributions"]["receipt_id"]
    )
    assert refresh.state_get(db, "payment_file_holds")["expenditures"]["reason"]
    pending = refresh.state_get(db, refresh.RECHECK_PENDING_KEY)
    assert pending["payment_files"] == current.file_manifest
    assert refresh.state_get(db, refresh.CLEARING_PENDING_KEY)
    repeated = run(db, board, store)
    assert repeated.published and repeated.refusal
    assert live(db).file_manifest["expenditures"] == old_manifest["expenditures"]


def test_reordered_bytes_reconfirm_same_rows_using_new_validated_receipt(
    db, board, store
):
    publish_first(db, board, store)
    old = live(db)
    original = old.file_manifest["contributions"]
    board.set_rows(Dataset.contributions, list(reversed(CONTRIBUTION_ROWS)))
    result = run(db, board, store)
    assert result.published, result.summary()
    assert not result.requires_recheck
    new = live(db).file_manifest["contributions"]
    assert new["snapshot_id"] == original["snapshot_id"]
    assert new["record_set_hash"] == original["record_set_hash"]
    assert new["receipt_id"] != original["receipt_id"]
    assert new["copied_at"] > original["copied_at"]
    receipt = db.get(models.CampaignFinanceFetchObservation, new["receipt_id"])
    snapshot = db.get(models.CampaignFinanceSnapshot, new["snapshot_id"])
    assert receipt.content_hash != snapshot.content_hash
    assert receipt.snapshot_id == snapshot.id


def test_failed_download_does_not_stop_other_complete_files(
    db, board, store, monkeypatch
):
    publish_first(db, board, store)
    original = live(db).file_manifest["expenditures"]
    fetch = cf.fetch_download

    def failure(http, spec, resolved, directory):
        if spec.dataset == Dataset.expenditures:
            raise cf.CampaignFinanceRefusal("test: source connection closed")
        return fetch(http, spec, resolved, directory)

    monkeypatch.setattr(cf, "fetch_download", failure)
    result = run(db, board, store)
    assert result.published and result.refusal
    assert live(db).file_manifest["expenditures"] == original
    assert result.outcomes[1].measurements is None


def test_reader_uses_slot_dates_and_keeps_withholdings_on_accepted_checks(
    db, board, store
):
    publish_first(db, board, store)
    release = live(db)
    manifest = {key: dict(value) for key, value in release.file_manifest.items()}
    older = datetime(2026, 10, 9, tzinfo=UTC)
    newer = older + timedelta(days=15)
    manifest["contributions"]["copied_at"] = newer.isoformat()
    manifest["expenditures"]["copied_at"] = older.isoformat()
    manifest["independent_expenditures"]["copied_at"] = newer.isoformat()
    for entry in manifest.values():
        entry["fetch_started_at"] = (older - timedelta(seconds=1)).isoformat()
        receipt = db.get(models.CampaignFinanceFetchObservation, entry["receipt_id"])
        receipt.started_at = datetime.fromisoformat(entry["fetch_started_at"])
        receipt.completed_at = datetime.fromisoformat(entry["copied_at"])
    release.fetch_completed_at = newer
    release.file_manifest = manifest
    db.commit()
    resolved = reader.live_release(db)
    assert resolved.fetched_at is None
    assert resolved.payment_copied_at == {
        "contributions": newer,
        "expenditures": older,
        "independent_expenditures": newer,
    }
    assert resolved.contributions.snapshot_id == release.contributions_snapshot_id


def test_rollback_restores_all_slot_dates_and_pairings_and_keeps_rows(db, board, store):
    first = publish_first(db, board, store)
    original = live(db).file_manifest
    board.set_rows(
        Dataset.contributions,
        [row.replace("250.0000", "251.0000") for row in CONTRIBUTION_ROWS],
    )
    assert run(db, board, store).published
    cf.rollback_release(db, first.release_id)
    assert live(db).file_manifest == original
    cf.prune(db)
    for spec in cf.DATASETS:
        snapshot_id = getattr(live(db), cf.RELEASE_SNAPSHOT_COLUMN[spec.dataset])
        assert cf.rows_present(db, spec, snapshot_id) > 0
    assert refresh.state_get(db, refresh.CLEARING_PENDING_KEY)


@pytest.mark.parametrize(
    "damage",
    [
        "missing_slot",
        "extra_slot",
        "wrong_snapshot",
        "wrong_hash",
        "bad_receipt",
        "naive_date",
        "future_date",
        "failed_check",
        "missing_parse_check",
        "receipt_other_file",
        "receipt_wrong_hash",
        "receipt_wrong_run",
    ],
)
def test_damaged_nonempty_manifest_never_becomes_legacy(db, board, store, damage):
    publish_first(db, board, store)
    release = live(db)
    manifest = deepcopy(release.file_manifest)
    entry = manifest["contributions"]
    if damage == "missing_slot":
        manifest.pop("expenditures")
    elif damage == "extra_slot":
        manifest["unexpected"] = dict(entry)
    elif damage == "wrong_snapshot":
        entry["snapshot_id"] = str(uuid.uuid4())
    elif damage == "wrong_hash":
        entry["record_set_hash"] = "0" * 64
    elif damage == "bad_receipt":
        entry["receipt_id"] = str(uuid.uuid4())
    elif damage == "receipt_wrong_hash":
        entry["receipt_content_hash"] = "0" * 64
    elif damage == "receipt_wrong_run":
        entry["receipt_ingestion_run_id"] = str(uuid.uuid4())
    elif damage == "receipt_other_file":
        entry["receipt_id"] = manifest["expenditures"]["receipt_id"]
    elif damage == "naive_date":
        entry["copied_at"] = "2026-10-24T12:00:00"
    elif damage == "future_date":
        entry["copied_at"] = (
            release.fetch_completed_at + timedelta(days=1)
        ).isoformat()
    elif damage == "failed_check":
        entry["checks"].append({"name": "unexpected_loss", "status": "failed"})
    elif damage == "missing_parse_check":
        entry["checks"] = [
            c for c in entry["checks"] if c["name"] != "parses_completely"
        ]
    release.file_manifest = manifest
    db.commit()
    with pytest.raises(reader.ReleaseNoLongerHeld):
        reader.live_release(db)


def test_legacy_empty_manifest_keeps_rolling_read_compatibility(db, board, store):
    publish_first(db, board, store)
    release = live(db)
    expected = release.fetch_completed_at
    release.file_manifest = {}
    db.commit()
    resolved = reader.live_release(db)
    assert resolved.fetched_at == expected
    assert set(resolved.payment_copied_at.values()) == {expected}


def test_rejected_or_mutated_snapshot_checks_never_replace_accepted_evidence(
    db, board, store
):
    publish_first(db, board, store)
    original = reader.live_release(db)
    snapshot = db.get(
        models.CampaignFinanceSnapshot, original.contributions.snapshot_id
    )
    snapshot.validation_json = {
        "checks": [
            {
                "name": "reported_totals_reconcile",
                "status": "overridden",
                "filer_years": ["invented:2026"],
            }
        ]
    }
    db.commit()
    resolved = reader.live_release(db)
    assert resolved.contributions.checks == original.contributions.checks
    assert ("invented", 2026) not in reader.filer_years_that_must_not_show_a_split(
        db, resolved
    )


def test_pinned_committee_resolver_uses_own_file_receipts(db, board, store):
    from alethical.api.services import committee_finance

    publish_first(db, board, store)
    expected = reader.live_release(db)
    db.rollback()
    committee_finance.pin_to_one_view(db)
    resolved = committee_finance.current_release(db)
    assert resolved.payment_copied_at == expected.payment_copied_at
    assert resolved.contributions.receipt_id == expected.contributions.receipt_id
    assert (
        resolved.fetched_at is None
    )  # 3 real sequential reads have distinct instants.


def test_date_only_reconfirmation_keeps_prior_owed_file_and_creates_no_new_one(
    db, board, store
):
    publish_first(db, board, store)
    refresh.state_delete(db, refresh.RECHECK_PENDING_KEY)
    assert run(db, board, store).published
    assert refresh.state_get(db, refresh.RECHECK_PENDING_KEY) is None
    prior = live(db).file_manifest["expenditures"]
    refresh.state_set(
        db,
        refresh.RECHECK_PENDING_KEY,
        {
            **refresh.live_versions(db).as_marker(),
            "pending_files": {"expenditures": prior},
        },
    )
    assert run(db, board, store).published
    assert refresh.state_get(db, refresh.RECHECK_PENDING_KEY)["pending_files"] == {
        "expenditures": prior
    }


def test_one_successful_file_check_cannot_erase_another_files_failed_check(
    db, board, store
):
    from alethical.pipeline.campaign_finance_recheck import (
        CheckOutcome,
        RecheckReport,
        recheck_years,
    )

    publish_first(db, board, store)

    def checks(db, *, log, datasets):
        assert set(datasets) == {"contributions", "expenditures"}
        return RecheckReport(
            years=recheck_years(),
            outcomes=[
                CheckOutcome("money in", verdicts=2),
                CheckOutcome("money out", error="test interrupted"),
            ],
        )

    report = refresh.RefreshReport(started_at=datetime.now(UTC), dry_run=False)
    refresh._run_rechecks(
        db, report, recheck=checks, clear=lambda *a, **k: False, log=lambda _: None
    )
    pending = refresh.state_get(db, refresh.RECHECK_PENDING_KEY)
    assert set(pending["pending_files"]) == {"expenditures"}
    assert not report.ok


def test_rollback_of_one_slot_does_not_cancel_another_slots_owed_check():
    now = datetime.now(UTC)

    def source(identity, age):
        return {
            "snapshot_id": identity,
            "filing_snapshot_id": "totals",
            "fetch_started_at": (now + timedelta(days=age)).isoformat(),
        }

    marker = {
        "pending_files": {
            "contributions": source("c-new", 2),
            "expenditures": source("e", 1),
        }
    }
    current = refresh.LiveVersions(
        payment_files={
            "contributions": source("c-old", 0),
            "expenditures": source("e", 1),
        }
    )
    assert set(refresh.owed_payment_files(marker, current)) == {"expenditures"}
    assert refresh.recheck_still_owed(
        marker, replace(current, payments_release_id="restored")
    )


@pytest.mark.parametrize(
    "module_name,dataset",
    [
        ("campaign_finance_stated_split", Dataset.contributions),
        ("campaign_finance_stated_spending", Dataset.expenditures),
    ],
)
def test_unpaired_file_never_creates_checked_comparison(
    db, board, store, monkeypatch, module_name, dataset
):
    from importlib import import_module

    module = import_module("alethical.pipeline." + module_name)
    publish_first(db, board, store)
    monkeypatch.setattr(module, "_live_filings_snapshot_id", lambda db: uuid.uuid4())
    with pytest.raises(RuntimeError, match="not paired"):
        if dataset is Dataset.contributions:
            module.run_stated_split_check(db, years=[2026])
        else:
            module.run_stated_spending_check(db, None, years=[2026])


def test_failed_pointer_transaction_leaves_old_release_and_no_recovery_half_state(
    db, board, store, monkeypatch
):
    publish_first(db, board, store)
    original = live(db).id
    refresh.state_delete(db, refresh.RECHECK_PENDING_KEY)
    refresh.state_delete(db, refresh.CLEARING_PENDING_KEY)
    board.set_rows(
        Dataset.contributions,
        [row.replace("250.0000", "251.0000") for row in CONTRIBUTION_ROWS],
    )
    commit = db.commit

    def crash():
        db.flush()
        pointer = db.scalar(
            text("SELECT release_id FROM cf_current_release WHERE id = true")
        )
        if pointer != original:
            assert refresh.state_get(db, refresh.RECHECK_PENDING_KEY)
            assert refresh.state_get(db, refresh.CLEARING_PENDING_KEY)
            raise RuntimeError("test crash before pointer commit")
        commit()

    monkeypatch.setattr(db, "commit", crash)
    try:
        with pytest.raises(RuntimeError, match="test crash"):
            run(db, board, store)
    finally:
        monkeypatch.setattr(db, "commit", commit)
        db.rollback()
    assert live(db).id == original
    assert refresh.state_get(db, refresh.RECHECK_PENDING_KEY) is None
    assert refresh.state_get(db, refresh.CLEARING_PENDING_KEY) is None


def test_real_money_routes_keep_october9_spending_beside_october24_contributions(
    db, board, store, client
):
    publish_first(db, board, store)
    release = live(db)
    manifest = deepcopy(release.file_manifest)
    older = datetime(2026, 10, 9, 15, tzinfo=UTC)
    newer = datetime(2026, 10, 24, 15, tzinfo=UTC)
    for name, entry in manifest.items():
        copied = older if name == "expenditures" else newer
        entry["copied_at"] = copied.isoformat()
        entry["fetch_started_at"] = (copied - timedelta(seconds=1)).isoformat()
        receipt = db.get(models.CampaignFinanceFetchObservation, entry["receipt_id"])
        receipt.started_at = datetime.fromisoformat(entry["fetch_started_at"])
        receipt.completed_at = copied
    release.fetch_completed_at = newer
    release.file_manifest = manifest
    db.commit()
    response = client.get("/api/v1/committees/19200/finance?year=2025")
    assert response.status_code == 200, response.text
    body = response.json()["data"]
    assert body["fetched_at"] is None
    assert datetime.fromisoformat(body["payment_copied_at"]["contributions"]) == newer
    assert datetime.fromisoformat(body["payment_copied_at"]["expenditures"]) == older
    for direction, expected in (("received", newer), ("made", older)):
        response = client.get(
            f"/api/v1/committees/19200/payments?year=2025&direction={direction}"
        )
        assert response.status_code == 200, response.text
        assert datetime.fromisoformat(response.json()["data"]["fetched_at"]) == expected
    response = client.get("/api/v1/campaign-finance/summary")
    assert response.status_code == 200, response.text
    freshness = response.json()["data"]["freshness"]
    assert freshness["downloads_fetched_at"] is None
    assert (
        datetime.fromisoformat(freshness["payment_copied_at"]["expenditures"]) == older
    )


def test_mutable_shared_snapshot_cannot_change_inherited_waiver_after_rollback(
    db, board, store
):
    from alethical.tests.test_campaign_finance_load import seed_filings_snapshot

    seed_filings_snapshot(db, reported={("19200", 2025): "1500.00"})
    publish_first(
        db, board, store, waive=["contributions/reported_totals_reconcile:19200/2025"]
    )
    original = live(db)
    expected = deepcopy(original.file_manifest)
    snapshot = db.get(
        models.CampaignFinanceSnapshot, original.contributions_snapshot_id
    )
    snapshot.validation_json = {
        "checks": [
            {
                "name": "reported_totals_reconcile",
                "status": "overridden",
                "filer_years": ["invented:2025"],
                "figures": {"invented:2025": {"ours": "9", "reported": "8"}},
            }
        ]
    }
    db.commit()
    accepted = cf.baseline_snapshots(db)[Dataset.contributions]
    assert "19200:2025" in cf._carried_reconcile_filer_years(accepted)
    assert "invented:2025" not in cf._carried_reconcile_filer_years(accepted)
    board.set_rows(
        Dataset.contributions,
        [row.replace("Retired", "Nurse") for row in CONTRIBUTION_ROWS],
    )
    result = run(db, board, store)
    assert result.published and not result.refusal, result.summary()
    cf.rollback_release(db, original.id)
    assert live(db).file_manifest == expected
    board.set_rows(
        Dataset.contributions,
        [row.replace("Retired", "Teacher") for row in CONTRIBUTION_ROWS],
    )
    replay = run(db, board, store)
    assert replay.published and not replay.refusal, replay.summary()


def test_first_forward_publish_freezes_legacy_proof_before_shared_snapshot_changes(
    db, board, store
):
    publish_first(db, board, store)
    original = live(db)
    expected = deepcopy(original.file_manifest)
    original.file_manifest = {}
    db.commit()
    assert run(db, board, store).published
    held = db.get(models.CampaignFinanceRelease, original.id, populate_existing=True)
    assert held.file_manifest == expected
    cf.rollback_release(db, original.id)
    assert live(db).file_manifest == expected


@pytest.mark.parametrize("kind", ["split", "spending"])
def test_full_checker_cannot_complete_a_missing_target_population(
    db, board, store, monkeypatch, kind
):
    from importlib import import_module
    from alethical.tests.test_campaign_finance_load import seed_filings_snapshot

    seed_filings_snapshot(db, reported={})
    publish_first(db, board, store)
    module = import_module("alethical.pipeline.campaign_finance_stated_" + kind)
    monkeypatch.setattr(module, "targets", lambda *a: [])
    with pytest.raises(RuntimeError, match="no complete target population"):
        if kind == "split":
            module.run_stated_split_check(db, years=[2025])
        else:
            module.run_stated_spending_check(db, None, years=[2025])


def test_omitting_evidence_columns_never_turns_a_current_release_into_legacy(
    db, board, store
):
    publish_first(db, board, store)
    row = db.execute(reader._LIVE_RELEASE_SQL).one()
    assert len(row) == 20
    with pytest.raises(reader.ReleaseNoLongerHeld, match="omitted source evidence"):
        reader.release_from_row(row[:15])
