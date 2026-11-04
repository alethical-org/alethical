"""The name summary catch-up writes only under the publish lock, and its dry run
and rollback say what they would do."""

from types import SimpleNamespace
from unittest.mock import Mock
from uuid import uuid4

import pytest

from scripts import build_finance_name_summary as subject


@pytest.fixture()
def runner(monkeypatch):
    snapshots = {dataset: uuid4() for dataset in subject.RELEASE_SNAPSHOT_COLUMN}
    release = SimpleNamespace(
        **{
            column: snapshots[dataset]
            for dataset, column in subject.RELEASE_SNAPSHOT_COLUMN.items()
        }
    )
    state = SimpleNamespace(
        snapshots=snapshots, current=release, built=set(), events=[], written=[]
    )
    engine = Mock()
    state.engine = engine
    monkeypatch.setattr(subject, "create_engine", lambda *args, **kwargs: engine)

    class Session:
        def __init__(self, _engine):
            self.initial = not state.events
            self.locked = False
            self.rechecked = False

        def __enter__(self):
            return self

        def __exit__(self, *args):
            return False

        def execute(self, statement, params):
            assert "pg_advisory_xact_lock" in str(statement)
            assert params == {"key": subject.PUBLISH_LOCK_KEY}
            self.locked = True
            state.events.append("lock")

        def scalar(self, statement):
            return 7

        def rollback(self):
            state.events.append("rollback")

        def commit(self):
            assert self.locked and self.rechecked
            state.events.append("commit")

    def live(db):
        if not db.locked:
            return release
        db.rechecked = True
        state.events.append("recheck")
        return state.current

    def write(verb):
        def act(db, *args):
            assert db.locked and db.rechecked
            state.written.append((verb, args[-1]))
            return 5

        return act

    monkeypatch.setattr(subject, "Session", Session)
    monkeypatch.setattr(subject, "live_release", live)
    monkeypatch.setattr(subject.name_summary, "complete", lambda db, pairs: state.built)
    monkeypatch.setattr(subject.name_summary, "rebuild", write("build"))
    monkeypatch.setattr(subject.name_summary, "remove", write("remove"))
    monkeypatch.setattr(subject, "_names_to_write", lambda db, kind, sid: 11)

    def run(*args):
        return subject.main(
            ["--database-url", "postgresql://unused:unused@localhost/never", *args]
        )

    state.run = run
    return state


def test_a_build_writes_each_file_in_its_own_locked_transaction(runner):
    assert runner.run() == 0
    assert runner.written == [("build", sid) for sid in runner.snapshots.values()]
    assert runner.events == ["rollback"] + ["lock", "recheck", "commit"] * 3


def test_the_dry_run_counts_names_and_writes_nothing(runner, capsys):
    assert runner.run("--dry-run") == 0
    assert runner.written == [] and runner.events == ["rollback"]
    out = capsys.readouterr().out
    assert "contributions donor_name: would build 11 names" in out
    assert "independent_expenditures independent_payee_name: would build 11" in out


def test_a_complete_build_is_skipped_unless_rebuild_is_asked(runner, capsys):
    runner.built = {
        (sid, kind)
        for dataset, sid in runner.snapshots.items()
        for kind in subject.name_summary.kinds_for(dataset)
    }
    assert runner.run() == 0
    assert runner.written == []
    assert "complete build held, skipped" in capsys.readouterr().out
    assert runner.run("--rebuild") == 0
    assert len(runner.written) == 3


def test_remove_is_the_rollback_and_has_its_own_dry_run(runner, capsys):
    assert runner.run("--remove", "--dry-run") == 0
    assert runner.written == []
    assert "would remove 7 rows and no marker" in capsys.readouterr().out
    assert runner.run("--remove") == 0
    assert runner.written == [("remove", sid) for sid in runner.snapshots.values()]


def test_nothing_is_written_when_the_live_release_moves_before_the_lock(runner):
    runner.current = SimpleNamespace(
        **{column: uuid4() for column in subject.RELEASE_SNAPSHOT_COLUMN.values()}
    )
    assert runner.run() == 0
    assert runner.written == []
    assert runner.events == ["rollback"] + ["lock", "recheck", "rollback"] * 3
