from datetime import UTC, datetime, timedelta
import uuid

import pytest
from sqlalchemy import delete
from sqlalchemy.orm import sessionmaker

from alethical.db.models import SourceRefreshAttempt, SourceRefreshState
from alethical.db.session import get_engine
from alethical.pipeline import record_refresh as runner

NOW = datetime(2026, 10, 7, tzinfo=UTC)


@pytest.fixture
def sessions(seed_database):
    factory = sessionmaker(bind=get_engine())
    with factory() as db:
        db.execute(delete(SourceRefreshAttempt))
        db.execute(delete(SourceRefreshState))
        db.commit()
    yield factory
    with factory() as db:
        db.execute(delete(SourceRefreshAttempt))
        db.execute(delete(SourceRefreshState))
        db.commit()


def job(name="test", **kwargs):
    return runner.RefreshJob(
        name,
        timedelta(days=1),
        timedelta(seconds=5),
        ("unused",),
        "https://example.test",
        "test",
        **kwargs,
    )


def test_claim_prevents_overlap_and_stale_owner_finish(sessions):
    definition = job()
    with sessions() as db:
        first = runner.claim_job(db, definition, now=NOW)
    with sessions() as db:
        assert runner.claim_job(db, definition, now=NOW, force=True) is None
    with sessions() as db:
        replacement = runner.claim_job(db, definition, now=NOW + timedelta(hours=1))
        assert replacement.token != first.token
        assert not runner.finish_job(db, first, code=0, now=NOW + timedelta(hours=1))
        assert db.get(SourceRefreshState, definition.name).last_succeeded_at is None
        assert db.get(SourceRefreshAttempt, first.token).status == "interrupted"


def test_lane_blocks_other_job_until_finished(sessions):
    with sessions() as db:
        first = runner.claim_job(db, job("one", lane="shared"), now=NOW)
        assert runner.claim_job(db, job("two", lane="shared"), now=NOW) is None
        assert runner.finish_job(db, first, code=0, now=NOW)
        assert runner.claim_job(db, job("two", lane="shared"), now=NOW)


def test_review_is_checked_not_published_and_keeps_evidence(sessions, monkeypatch):
    definition = job(review_exit=2)
    monkeypatch.setattr(runner, "jobs", lambda *args: {"test": definition})
    evidence = {"finding_key": "map-shape-changed", "published": False}
    with sessions() as db:
        claim = runner.claim_job(db, definition, now=NOW)
        runner.finish_job(db, claim, code=2, now=NOW, finding=evidence)
        row = db.get(SourceRefreshState, "test")
        assert row.last_checked_at == NOW
        assert row.last_succeeded_at is None
        assert row.finding == evidence
        assert row.failures == 0
        assert runner.health(db, now=NOW)[0]["overdue"] is False
        assert runner.health(db, now=NOW)[0]["status"] == "review_required"


def test_failure_does_not_advance_success_and_retries(sessions):
    with sessions() as db:
        claim = runner.claim_job(db, job(), now=NOW)
        runner.finish_job(db, claim, code=0, now=NOW)
        claim = runner.claim_job(db, job(), now=NOW + timedelta(days=1))
        runner.finish_job(db, claim, code=1, now=NOW + timedelta(days=1))
        row = db.get(SourceRefreshState, "test")
        assert row.last_succeeded_at == NOW
        assert row.next_due_at == NOW + timedelta(days=1, minutes=15)
        assert row.failures == 1


def test_continuation_preserves_progress_and_is_not_complete(sessions):
    with sessions() as db:
        claim = runner.claim_job(db, job(), now=NOW)
        db.get(SourceRefreshState, "test").progress = {"cursor": "SF123"}
        db.commit()
        runner.finish_job(db, claim, code=75, now=NOW)
        row = db.get(SourceRefreshState, "test")
        assert row.last_checked_at is None
        assert row.progress == {"cursor": "SF123"}
        assert row.next_due_at == NOW
        assert row.failures == 0


def test_run_due_resumes_chunks_and_returns_review_success(sessions, monkeypatch):
    monkeypatch.setattr(runner, "jobs", lambda: {"test": job(review_exit=2)})
    codes = iter([75, 2])
    assert (
        runner.run_due(sessions, target="local", execute=lambda *a, **k: next(codes))
        == 0
    )
    with sessions() as db:
        assert db.get(SourceRefreshState, "test").last_status == "review_required"


def test_insufficient_time_does_not_start_job(sessions, monkeypatch):
    monkeypatch.setattr(runner, "jobs", lambda: {"test": job()})

    def forbidden(*a, **k):
        pytest.fail("A job started without enough time to finish")

    assert (
        runner.run_due(sessions, target="local", execute=forbidden, max_seconds=1) == 0
    )
    with sessions() as db:
        assert db.get(SourceRefreshState, "test") is None


def test_shutdown_records_failure_and_stops_queue(sessions, monkeypatch):
    monkeypatch.setattr(runner, "jobs", lambda: {"one": job("one"), "two": job("two")})

    def shutdown(*a, **k):
        raise KeyboardInterrupt

    assert runner.run_due(sessions, target="local", execute=shutdown) == 130
    with sessions() as db:
        assert db.get(SourceRefreshState, "one").last_status == "failed"
        assert db.get(SourceRefreshState, "two") is None


def test_busy_legacy_collector_does_not_spin_or_claim_success(sessions, monkeypatch):
    monkeypatch.setattr(runner, "jobs", lambda: {"test": job()})
    calls = []

    def busy(*a, **k):
        calls.append(1)
        return 76

    assert runner.run_due(sessions, target="local", execute=busy) == 0
    assert calls == [1]
    with sessions() as db:
        row = db.get(SourceRefreshState, "test")
        assert row.last_status == "deferred"
        assert row.last_checked_at is None


def test_process_shutdown_terminates_owned_group(monkeypatch):
    class Process:
        pid = 123456
        waits = 0

        def wait(self, timeout=None):
            self.waits += 1
            if self.waits == 1:
                raise KeyboardInterrupt
            return -15

        def poll(self):
            return None

    signals = []
    monkeypatch.setattr(runner.subprocess, "Popen", lambda *a, **k: Process())
    monkeypatch.setattr(
        runner.os, "killpg", lambda pid, sig: signals.append((pid, sig))
    )
    with pytest.raises(KeyboardInterrupt):
        runner.run_command(runner.Claim(job(), uuid.uuid4(), NOW), target="local")
    assert signals == [(123456, runner.signal.SIGTERM)]


def test_competing_claims_have_one_owner(sessions):
    from concurrent.futures import ThreadPoolExecutor

    def claim():
        with sessions() as db:
            return runner.claim_job(db, job(), now=NOW)

    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(lambda _: claim(), range(2)))
    assert sum(result is not None for result in results) == 1


def test_old_finish_does_not_release_replacement_lane(sessions):
    with sessions() as db:
        old = runner.claim_job(db, job("old", lane="shared"), now=NOW)
    later = NOW + timedelta(hours=1)
    with sessions() as db:
        new = runner.claim_job(db, job("new", lane="shared"), now=later)
        runner.finish_job(db, old, code=1, now=later)
        assert db.get(SourceRefreshState, "lane:shared").token == new.token


def test_due_jobs_respect_oldest_lane_and_keep_distinct_sources(sessions, monkeypatch):
    definitions = {
        "first": job("first", lane="shared"),
        "second": job("second", lane="shared"),
        "third": job("third"),
    }
    monkeypatch.setattr(runner, "jobs", lambda *a: definitions)
    with sessions() as db:
        assert runner.due_names(db, now=NOW) == ["first", "third"]
        claim = runner.claim_job(db, definitions["first"], now=NOW)
        runner.finish_job(db, claim, code=0, now=NOW)
        assert runner.due_names(db, now=NOW) == ["second", "third"]


def test_large_job_fits_default_budget(sessions, monkeypatch):
    from dataclasses import replace

    long = replace(job(), timeout=timedelta(hours=5))
    monkeypatch.setattr(runner, "jobs", lambda: {"test": long})
    called = []
    assert (
        runner.run_due(
            sessions, target="local", execute=lambda *a, **k: called.append(True) or 0
        )
        == 0
    )
    assert called == [True]
