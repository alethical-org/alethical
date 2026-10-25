from datetime import UTC, datetime, timedelta

import pytest
from sqlalchemy import delete, select
from sqlalchemy.orm import sessionmaker

from alethical.db.models import SourceRefreshAttempt, SourceRefreshState
from alethical.db.session import get_engine
from alethical.pipeline import record_refresh as runner
from alethical.pipeline import source_record_clearing as clearing
from alethical.pipeline.cache_purge import ClearingResult

NOW = datetime(2026, 10, 24, 20, tzinfo=UTC)


@pytest.fixture(autouse=True)
def activated_families(monkeypatch):
    monkeypatch.setenv("ALETHICAL_SOURCE_REFRESH_FAMILIES", '["legislative"]')


@pytest.fixture
def sessions(seed_database):
    factory = sessionmaker(bind=get_engine())

    def empty():
        with factory() as db:
            db.execute(delete(SourceRefreshAttempt))
            db.execute(delete(SourceRefreshState))
            db.commit()

    empty()
    yield factory
    empty()


def owed(factory):
    with factory() as db:
        return set(
            db.scalars(
                select(SourceRefreshState.name).where(
                    SourceRefreshState.name.in_(clearing.MARKERS)
                )
            )
        )


def purge_answering(ok, calls):
    def purge(request):
        calls.append(request)
        return ClearingResult(clearing=request, armed=True, ok=ok, detail="test")

    return purge


def test_rolled_back_records_owe_no_clearing(sessions):
    with sessions() as db:
        clearing.stage_source_clearing(db, "legislative")
        db.rollback()
    assert owed(sessions) == set()
    with sessions() as db:
        clearing.stage_source_clearing(db, "legislative")
        db.commit()
    assert owed(sessions) == {"clearing:legislative"}


def test_one_shared_clear_covers_every_owed_family(sessions, monkeypatch):
    monkeypatch.setenv("ALETHICAL_CLEAR_WEBSITE_PAGES", "on")
    with sessions() as db:
        clearing.stage_source_clearing(db, "legislative")
        clearing.stage_source_clearing(db, "filing-dates")
        db.commit()
    calls = []
    assert clearing.drain_source_clearing(
        get_engine(), target="production", purge=purge_answering(True, calls)
    )
    assert len(calls) == 1
    assert "api.alethical.com/api/v1/bills" in calls[0].prefixes
    assert "api.alethical.com/api/v1/committees" in calls[0].prefixes
    assert owed(sessions) == set()


@pytest.mark.parametrize(
    "ok, website", [(False, "on"), (True, None)], ids=["refused", "website-off"]
)
def test_failed_or_partial_clear_stays_owed(sessions, monkeypatch, ok, website):
    if website:
        monkeypatch.setenv("ALETHICAL_CLEAR_WEBSITE_PAGES", website)
    else:
        monkeypatch.delenv("ALETHICAL_CLEAR_WEBSITE_PAGES", raising=False)
    with sessions() as db:
        clearing.stage_source_clearing(db, "legislative")
        db.commit()
    calls = []
    assert not clearing.drain_source_clearing(
        get_engine(), target="production", purge=purge_answering(ok, calls)
    )
    assert owed(sessions) == {"clearing:legislative"}
    # Without the website step no purge is sent at all, so nothing repeats each turn.
    assert len(calls) == (1 if website else 0)


def test_change_committed_during_a_clear_stays_owed(sessions, monkeypatch):
    monkeypatch.setenv("ALETHICAL_CLEAR_WEBSITE_PAGES", "on")
    with sessions() as db:
        clearing.stage_source_clearing(db, "legislative")
        db.commit()

    def purge(request):
        # A collector commits newer records after this clear captured its tokens.
        with sessions() as db:
            clearing.stage_source_clearing(db, "legislative")
            db.commit()
        return ClearingResult(clearing=request, armed=True, ok=True, detail="test")

    assert not clearing.drain_source_clearing(
        get_engine(), target="production", purge=purge
    )
    assert owed(sessions) == {"clearing:legislative"}
    assert clearing.drain_source_clearing(
        get_engine(), target="production", purge=purge_answering(True, [])
    )


def test_clearing_job_is_due_only_while_owed(sessions):
    with sessions() as db:
        assert runner.CLEARING_JOB not in runner.due_names(db, now=NOW)
        clearing.stage_source_clearing(db, "legislative")
        db.commit()
        assert runner.CLEARING_JOB in runner.due_names(db, now=NOW)


def test_clearing_job_stays_off_with_every_family_off(sessions, monkeypatch):
    monkeypatch.delenv("ALETHICAL_SOURCE_REFRESH_FAMILIES", raising=False)
    with sessions() as db:
        clearing.stage_source_clearing(db, "legislative")
        db.commit()
        assert runner.due_names(db, now=NOW) == []


def test_clearing_is_late_only_after_a_clear_failed(sessions, monkeypatch):
    def late(db, now):
        report = {row["name"]: row for row in runner.health(db, now=now)}
        return report[runner.CLEARING_JOB]["overdue"]

    with sessions() as db:
        clearing.stage_source_clearing(db, "legislative")
        db.commit()
    # Owed while a long turn is still running is not late, however old.
    with sessions() as db:
        assert not late(db, datetime.now(UTC) + timedelta(hours=3))
    monkeypatch.setenv("ALETHICAL_CLEAR_WEBSITE_PAGES", "on")
    assert not clearing.drain_source_clearing(
        get_engine(), target="production", purge=purge_answering(False, [])
    )
    with sessions() as db:
        failed_at = datetime.fromisoformat(
            db.get(SourceRefreshState, "clearing:legislative").progress["failed_at"]
        )
        assert not late(db, failed_at + timedelta(minutes=5))
        assert late(db, failed_at + timedelta(minutes=11))
        # A newer change replaces the obligation; it is not late until it fails.
        clearing.stage_source_clearing(db, "legislative")
        db.commit()
        assert not late(db, failed_at + timedelta(minutes=11))


def test_a_published_turn_with_a_failed_clear_does_not_report_success(
    sessions, monkeypatch
):
    definition = runner.RefreshJob(
        "bills-test",
        timedelta(days=1),
        timedelta(seconds=5),
        ("unused",),
        "https://example.test",
        "test",
        lane="legislative",
    )
    monkeypatch.setattr(runner, "jobs", lambda: {"bills-test": definition})
    drained = []

    def refused(engine, *, target):
        drained.append(target)
        return False

    monkeypatch.setattr(runner, "drain_source_clearing", refused)

    def collect(claim, *, target):
        with sessions() as db:
            clearing.stage_source_clearing(db, "legislative")
            db.commit()
        return 0

    assert runner.run_due(sessions, target="production", execute=collect) == 1
    assert drained == ["production"]
    with sessions() as db:
        # The records were published; only the clearing remains owed.
        assert db.get(SourceRefreshState, "bills-test").last_status == "succeeded"
    assert owed(sessions) == {"clearing:legislative"}


def test_a_turn_with_nothing_owed_never_asks_to_clear(sessions, monkeypatch):
    monkeypatch.setattr(
        runner,
        "jobs",
        lambda: {
            "bills-test": runner.RefreshJob(
                "bills-test",
                timedelta(days=1),
                timedelta(seconds=5),
                ("unused",),
                "https://example.test",
                "test",
            )
        },
    )
    monkeypatch.setattr(
        runner,
        "drain_source_clearing",
        lambda *a, **k: pytest.fail("cleared without an owed change"),
    )
    assert runner.run_due(sessions, target="production", execute=lambda *a, **k: 0) == 0


def test_money_checks_are_due_only_while_work_is_owed(sessions, monkeypatch):
    from alethical.pipeline import campaign_finance_refresh as refresh

    monkeypatch.setenv("ALETHICAL_SOURCE_REFRESH_FAMILIES", '["campaign"]')
    with sessions() as db:
        refresh.state_update(
            db, delete_keys=[refresh.CLEARING_PENDING_KEY, refresh.RECHECK_PENDING_KEY]
        )
        db.commit()
        assert runner.CHECK_JOB not in runner.due_names(db, now=NOW)
        report = {row["name"]: row for row in runner.health(db, now=NOW)}
        assert not report[runner.CHECK_JOB]["overdue"]
        # The daily collector shares the lane; take it out of the way.
        db.get(SourceRefreshState, "campaign-money").next_due_at = NOW + timedelta(
            days=1
        )
        db.commit()
        assert runner.CHECK_JOB not in runner.due_names(db, now=NOW)
        # Owed money page clearing is retried by a bounded turn.
        refresh.state_set(db, refresh.CLEARING_PENDING_KEY, {"events": ["test"]})
        db.commit()
        assert runner.CHECK_JOB in runner.due_names(db, now=NOW)
        refresh.state_update(db, delete_keys=[refresh.CLEARING_PENDING_KEY])
        db.commit()
