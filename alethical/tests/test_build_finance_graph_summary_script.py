"""Summary catch-up selects only requested saved files and keeps publication gates."""

from types import SimpleNamespace
from unittest.mock import Mock
from uuid import uuid4

import pytest

from scripts import build_finance_graph_summary as subject


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
        snapshots=snapshots,
        release=release,
        current=release,
        held=set(),
        built=[],
        held_queries=[],
        sessions=[],
        events=[],
    )
    engine = Mock()
    state.engine = engine
    monkeypatch.setattr(subject, "create_engine", lambda *args, **kwargs: engine)

    class Session:
        def __init__(self, _engine):
            self.initial = not state.sessions
            self.locked = False
            self.rechecked = False
            state.sessions.append(self)

        def __enter__(self):
            return self

        def __exit__(self, *args):
            return False

        def execute(self, statement, params):
            assert "pg_advisory_xact_lock" in str(statement)
            assert params == {"key": subject.PUBLISH_LOCK_KEY}
            self.locked = True
            state.events.append("lock")

        def rollback(self):
            state.events.append("rollback")

        def commit(self):
            assert self.locked and self.rechecked
            state.events.append("commit")

    def current(db):
        if db.initial:
            return state.release
        assert db.locked
        db.rechecked = True
        state.events.append("recheck")
        return state.current

    def held(db, ids):
        state.held_queries.append(list(ids))
        return state.held

    def rebuild(db, dataset, snapshot):
        assert db.locked and db.rechecked
        state.events.append("build")
        state.built.append((dataset, snapshot))
        return 3

    monkeypatch.setattr(subject, "Session", Session)
    monkeypatch.setattr(subject, "live_release", current)
    monkeypatch.setattr(subject.graph_summary, "held", held)
    monkeypatch.setattr(subject.graph_summary, "rebuild", rebuild)

    def run(*args):
        monkeypatch.setattr(
            "sys.argv",
            [
                "build_finance_graph_summary",
                "--database-url",
                "postgresql://unused:unused@localhost/never_connected",
                *args,
            ],
        )
        return subject.main()

    state.run = run
    return state


def test_selected_independent_file_alone_is_checked_and_rebuilt_under_lock(runner):
    selected = subject.graph_summary.Dataset.independent_expenditures
    runner.held = set(runner.snapshots.values())
    assert runner.run("--dataset", selected.value, "--rebuild") == 0
    assert runner.held_queries == [[runner.snapshots[selected]]]
    assert runner.built == [(selected, runner.snapshots[selected])]
    assert runner.events == ["rollback", "lock", "recheck", "build", "commit"]
    runner.engine.dispose.assert_called_once()


def test_default_still_rebuilds_all_three_files_with_separate_locked_transactions(
    runner,
):
    assert runner.run() == 0
    assert runner.built == list(runner.snapshots.items())
    assert runner.events == ["rollback"] + ["lock", "recheck", "build", "commit"] * 3


def test_selected_dry_run_never_locks_builds_or_commits(runner, capsys):
    assert runner.run("--dataset", "independent_expenditures", "--dry-run") == 0
    assert runner.built == []
    assert runner.events == ["rollback"]
    assert capsys.readouterr().out == "independent_expenditures: would build\n"


def test_selected_existing_summary_is_skipped_unless_rebuild_requested(runner, capsys):
    runner.held = set(runner.snapshots.values())
    assert runner.run("--dataset", "independent_expenditures") == 0
    assert runner.events == ["rollback"]
    assert runner.built == []
    assert "summary held, skipped" in capsys.readouterr().out


@pytest.mark.parametrize("current_exists", [True, False])
def test_selected_file_is_not_built_if_live_pointer_changes_before_lock(
    runner, current_exists
):
    runner.current = (
        SimpleNamespace(independent_expenditures_snapshot_id=uuid4())
        if current_exists
        else None
    )
    assert runner.run("--dataset", "independent_expenditures", "--rebuild") == 0
    assert runner.built == []
    assert runner.events == ["rollback", "lock", "recheck", "rollback"]


def test_unknown_dataset_is_rejected_before_opening_a_session(runner):
    with pytest.raises(SystemExit) as error:
        runner.run("--dataset", "made-up-file")
    assert error.value.code == 2
    assert runner.sessions == []
