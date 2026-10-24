"""Bounded checks cannot skip work, reuse older reader proof, or hold collection all day."""

from types import SimpleNamespace
import time

import pytest
from sqlalchemy import text

from alethical.db import models
from alethical.pipeline import campaign_finance_refresh as refresh
from alethical.pipeline import campaign_finance_stated_split as split
from alethical.pipeline import campaign_finance_recheck_batches as batches
from alethical.api.services.committee_stated_verdicts import verdict_rows, SPLIT
from alethical.tests.test_campaign_finance_load import (
    seed_filings_snapshot,
    publish_first,
    live,
)

pytest_plugins = ["alethical.tests.test_campaign_finance_load"]


@pytest.fixture
def prepared(db, board, store, monkeypatch):
    seed_filings_snapshot(db, reported={})
    publish_first(db, board, store)
    live_version = refresh.live_versions(db)
    refresh.state_set(db, "money_check_reader_identity", {"fingerprint": "a" * 64})
    refresh.state_set(
        db,
        refresh.RECHECK_PENDING_KEY,
        {
            **live_version.as_marker(),
            "pending_files": {
                "contributions": live_version.payment_files["contributions"]
            },
        },
    )
    proof = {"value": "a" * 64}
    calls = []

    def check(db, http, release, totals, target, **kwargs):
        calls.append((target.registration_number, target.filing_year))
        return split.Verdict(
            target.registration_number,
            target.filing_year,
            models.CampaignFinanceStatedSplitStatus.not_checked,
            "test: document absent",
        ), (False, False)

    monkeypatch.setattr(split, "check_one", check)
    monkeypatch.setattr(split, "reader_identity", lambda: proof["value"])

    class Http:
        def close(self):
            pass

    options = dict(
        lease=SimpleNamespace(held=True, refusal=lambda: None),
        store_factory=lambda: store,
        http_factory=Http,
        clear=lambda *a, **k: False,
        fingerprint=lambda: proof["value"],
        log=lambda _: None,
    )
    return options, proof, calls


def test_exact_committee_year_cap_and_next_turn_resume_without_full_completion(
    db, prepared
):
    options, _, calls = prepared
    first = batches.run_recheck_batch(db, limit=1, **options)
    assert first.ok and first.unfinished
    assert first.checked == first.completed == 1 and first.total > 1
    assert refresh.state_get(db, refresh.RECHECK_PENDING_KEY)
    second = batches.run_recheck_batch(db, limit=1, **options)
    assert second.ok and second.completed == 2
    assert calls[0] != calls[1]
    remaining = batches.run_recheck_batch(db, limit=100, **options)
    assert remaining.ok and not remaining.unfinished
    assert remaining.completed == remaining.total
    assert refresh.state_get(db, refresh.RECHECK_PENDING_KEY) is None


def test_new_reader_with_one_batch_cannot_reuse_previous_full_population_proof(
    db, prepared
):
    options, proof, _ = prepared
    old = batches.run_recheck_batch(db, limit=100, **options)
    assert old.ok and old.completed == old.total and old.total > 1
    current = refresh.live_versions(db)
    refresh.state_set(
        db,
        refresh.RECHECK_PENDING_KEY,
        {
            **current.as_marker(),
            "pending_files": {"contributions": current.payment_files["contributions"]},
        },
    )
    proof["value"] = "b" * 64  # A code or dependency change is a different proof.
    new = batches.run_recheck_batch(db, limit=1, **options)
    assert new.ok and new.completed == 1 and new.unfinished
    total_rows = db.scalar(text("SELECT count(*) FROM cf_stated_split"))
    coverage = split.stated_split_coverage(db, live(db).contributions_snapshot_id)
    assert total_rows == old.total
    assert coverage.total == 1
    resolved = batches.reader.live_release(db)
    all_current = [
        row
        for reg in {
            one[0]
            for one in db.execute(
                text("SELECT DISTINCT registration_number FROM cf_stated_split")
            )
        }
        for row in verdict_rows(db, resolved, reg)[SPLIT]
    ]
    assert len(all_current) == 1


def test_crash_after_committed_verdict_replays_same_item_before_advancing_cursor(
    db, prepared, monkeypatch
):
    options, _, calls = prepared
    set_state = refresh.state_set

    def crash(db, key, value):
        if key.startswith("money_recheck_progress:") and value["completed"] == 1:
            raise RuntimeError("test crash after verdict commit")
        set_state(db, key, value)

    monkeypatch.setattr(refresh, "state_set", crash)
    first = batches.run_recheck_batch(db, limit=1, **options)
    assert not first.ok
    assert db.scalar(text("SELECT count(*) FROM cf_stated_split")) == 1
    assert (
        refresh.state_get(db, "money_recheck_progress:contributions")["completed"] == 0
    )
    # The verdict and its clearing obligation committed together before the crash.
    assert first.checked == 1
    monkeypatch.setattr(refresh, "state_set", set_state)
    second = batches.run_recheck_batch(db, limit=1, **options)
    assert second.ok and second.completed == 1
    assert calls[0] == calls[1]
    assert db.scalar(text("SELECT count(*) FROM cf_stated_split")) == 1


def test_population_change_resets_cursor_instead_of_skipping_new_target(
    db, prepared, monkeypatch
):
    options, _, calls = prepared
    first = batches.run_recheck_batch(db, limit=1, **options)
    targets = split.targets
    monkeypatch.setattr(split, "targets", lambda *a: targets(*a)[1:])
    second = batches.run_recheck_batch(db, limit=1, **options)
    assert first.completed == second.completed == 1
    assert second.total == first.total - 1
    assert calls[-1] != calls[0]


def test_source_request_cap_includes_retries_and_elapsed_budget_interrupts_parser():
    received = []
    http = SimpleNamespace(post=lambda *a, **k: received.append(k) or object())
    budget = batches.BudgetSession(http, time.monotonic() + 1, 1)
    budget.post("https://cfb.mn.gov/", timeout=30)
    with pytest.raises(batches.BatchBudgetExhausted):
        budget.post("https://cfb.mn.gov/", timeout=30)
    assert len(received) == 1 and received[0]["timeout"] <= 1
    started = time.monotonic()
    with pytest.raises(batches.BatchBudgetExhausted):
        with batches.elapsed_budget(0.01):
            time.sleep(1)
    assert time.monotonic() - started < 0.5


def test_unpaired_file_remains_pending_without_opening_document_store(db, board, store):
    publish_first(db, board, store)

    def forbidden():
        raise AssertionError("unpaired file must not ask for documents")

    result = batches.run_recheck_batch(
        db,
        lease=SimpleNamespace(held=True, refusal=lambda: None),
        store_factory=forbidden,
        clear=lambda *a, **k: False,
    )
    assert (
        not result.ok and result.unfinished and result.checked == result.requests == 0
    )
    assert "not paired" in result.summary()
    assert refresh.state_get(db, refresh.RECHECK_PENDING_KEY)


def test_evidence_storage_failure_keeps_committed_verdict_but_not_cursor_completion(
    db, prepared, monkeypatch
):
    import hashlib

    options, _, _ = prepared
    store = options["store_factory"]()

    def unavailable(*args, **kwargs):
        raise OSError("test storage unavailable")

    monkeypatch.setattr(store, "put_and_verify", unavailable)

    def check(db, http, release, totals, target, **kwargs):
        body = b"%PDF-1.4 test source bytes"
        kwargs["keeper"].keep(
            document_hash=hashlib.sha256(body).hexdigest(),
            body=body,
            registration_number=target.registration_number,
            filing_year=target.filing_year,
            report_type="YE",
            amendment_index=0,
        )
        return split.Verdict(
            target.registration_number,
            target.filing_year,
            models.CampaignFinanceStatedSplitStatus.not_checked,
            "test source absent",
        ), (True, False)

    monkeypatch.setattr(split, "check_one", check)
    result = batches.run_recheck_batch(db, limit=1, **options)
    assert not result.ok and result.unfinished
    assert "could not be kept" in result.summary()
    assert db.scalar(text("SELECT count(*) FROM cf_stated_split")) == 1
    assert (
        refresh.state_get(db, "money_recheck_progress:contributions")["completed"] == 0
    )
    assert refresh.state_get(db, refresh.RECHECK_PENDING_KEY)
