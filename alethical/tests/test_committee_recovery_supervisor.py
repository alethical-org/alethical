"""Finite supervisor tests. No production/source calls or real recovery launch."""

import importlib.util
import json
import os
from datetime import UTC, datetime, timedelta
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import Mock

import pytest

SPEC = importlib.util.spec_from_file_location(
    "recovery_supervisor",
    os.environ.get(
        "SUPERVISOR_TEST_SOURCE",
        Path(__file__).resolve().parents[2]
        / "scripts/supervise_committee_link_recovery.py",
    ),
)
assert SPEC is not None and SPEC.loader is not None
s = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(s)


@pytest.fixture
def setup(tmp_path, monkeypatch):
    clock = [1000.0]
    instant = datetime(2026, 11, 4, tzinfo=UTC)
    monkeypatch.setattr(s.time, "monotonic", lambda: clock[0])
    monkeypatch.setattr(s, "now", lambda: instant + timedelta(seconds=clock[0] - 1000))
    inventory = {
        "format": 1,
        "target": "local",
        "database": "test",
        "bills": [{"id": "a", "key": "HF1", "actions": ["x"]}],
    }
    inventory["sha256"] = s.batch.digest(inventory)
    (tmp_path / "inventory.json").write_text(json.dumps(inventory))
    (tmp_path / "progress.json").write_text(
        json.dumps({"inventory": inventory["sha256"], "apply": 0, "outcomes": {}})
    )
    proof = tmp_path / "proof.json"
    proof.write_text(
        json.dumps(
            {
                "thread": "root",
                "received_at": instant.isoformat(),
                "event_id": "route-test",
            }
        )
    )
    args = SimpleNamespace(
        evidence=tmp_path,
        manifest=inventory["sha256"],
        target="local",
        thread="root",
        return_proof=proof,
        revision="a" * 40,
        schema="0085",
        until=instant + timedelta(seconds=500),
        resume_event=None,
        resume_review=None,
    )
    engine = Mock()
    monkeypatch.setattr(s, "create_engine", lambda *a, **kw: engine)
    monkeypatch.setattr(s, "database_url_for_target", lambda _: "local")
    monkeypatch.setattr(s, "verify_checkout", lambda _: None)
    monkeypatch.setattr(s, "notify", lambda *a: None)
    if hasattr(s, "validate_database"):
        monkeypatch.setattr(s, "validate_database", lambda *a: None)
    if hasattr(s, "check_receipts"):
        monkeypatch.setattr(s, "check_receipts", lambda *a: [])

    def sleep(seconds):
        clock[0] += seconds

    def gate(*a):
        return {"server_time": s.now(), "eligible_at": s.now(), "reasons": []}

    return args, engine, clock, sleep, gate


@pytest.mark.parametrize("code,status", [(75, "continuing"), (76, "deferred")])
def test_every_yield_enforces_local_quiet_even_stale_database(setup, code, status):
    args, engine, clock, sleep, gate = setup
    starts = []

    def child(*a):
        starts.append(clock[0])
        if len(starts) == 2:
            (args.evidence / "STOP").touch()
        return code, json.dumps({"status": status, "mode": "apply", "cursor": 0})

    s.supervise(args, snapshot=gate, child=child, sleep=sleep)
    assert starts[1] - starts[0] >= 60
    engine.dispose.assert_called_once()


def test_saved_run_conflict_disposes_engine(setup):
    args, engine, _, sleep, gate = setup
    (args.evidence / "supervisor.json").write_text("{}")
    with pytest.raises(RuntimeError):
        s.supervise(args, snapshot=gate, sleep=sleep)
    engine.dispose.assert_called_once()


def test_eligibility_timeout_waits_for_fresh_success_before_child(setup):
    args, engine, clock, sleep, gate = setup
    reads, starts = [], []

    def snapshot(*a):
        reads.append(clock[0])
        if len(reads) <= 2:
            raise s.batch.Deferred("turn deadline reached")
        return gate()

    def child(*a):
        starts.append(clock[0])
        (args.evidence / "STOP").touch()
        return 76, '{"status":"deferred"}'

    result = s.supervise(args, snapshot=snapshot, child=child, sleep=sleep)
    assert reads == [1000, 1060, 1180]
    assert starts == [1180]
    assert result["consecutive_eligibility_timeouts"] == 0
    assert len(result["eligibility_timeouts"]) == 2
    assert engine.dispose.call_count == 3  # Two stale pools, then final cleanup.


def test_three_consecutive_eligibility_timeouts_stop_without_child(setup):
    args, _, clock, sleep, _ = setup
    reads = []
    child = Mock()

    def snapshot(*a):
        reads.append(clock[0])
        raise s.batch.Deferred("turn deadline reached")

    result = s.supervise(args, snapshot=snapshot, child=child, sleep=sleep)
    assert reads == [1000, 1060, 1180]
    child.assert_not_called()
    assert result["status"] == "stopped_for_review"
    assert result["consecutive_eligibility_timeouts"] == 3
    assert result["eligibility"] is None


@pytest.mark.parametrize("reason", ["schema changed", "lease lost"])
def test_other_eligibility_failures_are_not_retried(setup, reason):
    args, _, _, sleep, _ = setup
    snapshot = Mock(side_effect=s.batch.Deferred(reason))
    child = Mock()
    result = s.supervise(args, snapshot=snapshot, child=child, sleep=sleep)
    snapshot.assert_called_once()
    child.assert_not_called()
    assert result["status"] == "stopped_for_review"


def test_stop_during_eligibility_retry_wait_starts_no_child(setup):
    args, _, _, sleep, _ = setup
    snapshot = Mock(side_effect=s.batch.Deferred("turn deadline reached"))
    child = Mock()

    def stop_while_waiting(seconds):
        (args.evidence / "STOP").touch()
        sleep(seconds)

    result = s.supervise(args, snapshot=snapshot, child=child, sleep=stop_while_waiting)
    snapshot.assert_called_once()
    child.assert_not_called()
    assert result["status"] == "stopped_at_window_or_request"


def test_keyboard_interrupt_is_saved_and_disposes(setup):
    args, engine, _, sleep, gate = setup

    def child(*a):
        raise KeyboardInterrupt()

    result = s.supervise(args, snapshot=gate, child=child, sleep=sleep)
    assert result["status"] == "stopped_for_review"
    assert json.loads((args.evidence / "supervisor.json").read_text())["finished_at"]
    engine.dispose.assert_called_once()


def test_reviewed_resume_keeps_old_run_and_waits_full_quiet(setup):
    args, engine, clock, sleep, gate = setup

    def fail(*a):
        raise RuntimeError("prior interrupted turn")

    previous = s.supervise(args, snapshot=gate, child=fail, sleep=sleep)
    prior_file = args.evidence / "supervisor-runs" / previous["event_id"] / "state.json"
    before = prior_file.read_bytes()
    args.resume_event = previous["event_id"]
    args.resume_review = args.evidence / "review.json"
    review = {
        k: getattr(args, k)
        for k in ("revision", "schema", "manifest", "target", "thread")
    }
    review.update(
        event_id=previous["event_id"],
        checkpoint_sha256=s.batch.digest(previous),
        reviewer="root",
        reviewed_at=s.now().isoformat(),
        reason="reviewed stopped child and preserved receipts",
    )
    args.resume_review.write_text(json.dumps(review))
    began = clock[0]
    starts = []

    def child(*a):
        starts.append(clock[0])
        (args.evidence / "STOP").touch()
        return 76, '{"status":"deferred"}'

    resumed = s.supervise(args, snapshot=gate, child=child, sleep=sleep)
    assert starts[0] - began >= 60
    assert resumed["resume_of"] == previous["event_id"]
    assert resumed["event_id"] != previous["event_id"]
    assert prior_file.read_bytes() == before
    assert engine.dispose.call_count == 2


@pytest.mark.parametrize("change", ["hash", "manifest", "terminal"])
def test_resume_rejects_wrong_review_or_finished_pass(setup, change):
    args, _, _, sleep, gate = setup
    previous = {
        "event_id": "old",
        "manifest": args.manifest,
        "target": "local",
        "thread": "root",
        "status": "stopped_for_review",
    }
    if change == "terminal":
        previous["status"] = "pass_finished"
    (args.evidence / "supervisor.json").write_text(json.dumps(previous))
    args.resume_event = "old"
    args.resume_review = args.evidence / "review.json"
    review = {
        k: getattr(args, k)
        for k in ("revision", "schema", "manifest", "target", "thread")
    }
    review.update(
        event_id="old",
        checkpoint_sha256=s.batch.digest(previous),
        reviewer="root",
        reviewed_at=s.now().isoformat(),
        reason="review",
    )
    if change == "hash":
        review["checkpoint_sha256"] = "wrong"
    if change == "manifest":
        review["manifest"] = "wrong"
    args.resume_review.write_text(json.dumps(review))
    with pytest.raises(RuntimeError):
        s.supervise(args, snapshot=gate, sleep=sleep)


def test_uncertain_receipt_blocks_child(setup, monkeypatch):
    args, engine, _, sleep, gate = setup

    def ambiguous(*a):
        raise s.batch.AmbiguousReceipt("later writer")

    monkeypatch.setattr(s, "check_receipts", ambiguous)
    child = Mock()
    result = s.supervise(args, snapshot=gate, child=child, sleep=sleep)
    assert result["status"] == "stopped_for_review"
    assert "later writer" in result["reason"]
    child.assert_not_called()
    engine.dispose.assert_called_once()


@pytest.mark.parametrize("reason", ["lease", "due", "cooldown"])
def test_ineligible_never_starts_before_window(setup, reason):
    args, _, _, sleep, _ = setup
    child = Mock()

    def gate(*a):
        return {
            "server_time": s.now(),
            "eligible_at": s.now() + timedelta(seconds=60),
            "reasons": [reason],
        }

    result = s.supervise(args, snapshot=gate, child=child, sleep=sleep)
    assert result["status"] == "stopped_at_window_or_request"
    child.assert_not_called()


def test_conflicting_evidence_owner_blocks_launch(setup):
    args, _, _, sleep, gate = setup
    child = Mock()
    with (args.evidence / ".owner.lock").open("a") as lock:
        s.fcntl.flock(lock, s.fcntl.LOCK_EX | s.fcntl.LOCK_NB)
        result = s.supervise(args, snapshot=gate, child=child, sleep=sleep)
    assert result["status"] == "stopped_for_review"
    child.assert_not_called()


def test_code_drift_inside_child_stops_and_saves(setup, monkeypatch):
    args, _, _, sleep, gate = setup

    def drift(*a):
        raise RuntimeError("checkout changed")

    def child(command, folder, guard):
        monkeypatch.setattr(s, "verify_checkout", drift)
        guard()

    result = s.supervise(args, snapshot=gate, child=child, sleep=sleep)
    assert result["status"] == "stopped_for_review"
    assert "checkout changed" in result["reason"]
    assert result["active_turn"]


@pytest.mark.parametrize(
    "code,status,review", [(0, "pass_finished", False), (2, "review_required", True)]
)
def test_terminal_result_matches_saved_targets(setup, code, status, review):
    args, _, _, sleep, gate = setup

    def child(*a):
        p = {
            "inventory": args.manifest,
            "apply": 1,
            "outcomes": {"a": {"status": "applied", "review_required": review}},
        }
        (args.evidence / "progress.json").write_text(json.dumps(p))
        return code, json.dumps({"status": status, "mode": "apply", "cursor": 1})

    result = s.supervise(args, snapshot=gate, child=child, sleep=sleep)
    assert result["status"] == status
    assert result["turns"] == 1


@pytest.mark.parametrize(
    "code,output",
    [
        (0, '{"status":"pass_finished","mode":"apply"}'),
        (75, '{"status":"deferred"}'),
        (1, "bad"),
        (76, "{}\n{}"),
    ],
)
def test_bad_or_false_complete_result_stops(setup, code, output):
    args, _, _, sleep, gate = setup
    result = s.supervise(
        args, snapshot=gate, child=lambda *a: (code, output), sleep=sleep
    )
    assert result["status"] == "stopped_for_review"


def test_notification_failure_retained_once_per_run(tmp_path, monkeypatch):
    folder = tmp_path / "supervisor-runs" / "run1"
    folder.mkdir(parents=True)
    call = Mock(side_effect=s.subprocess.TimeoutExpired("codex", 15))
    monkeypatch.setattr(s.subprocess, "run", call)
    state = {"event_id": "run1", "status": "stopped_for_review"}
    s.notify(tmp_path, state, "root")
    s.notify(tmp_path, state, "root")
    assert call.call_count == 1
    saved = json.loads((folder / "notification.json").read_text())
    assert saved["state"] == "delivery_unverified"
    folder2 = tmp_path / "supervisor-runs" / "run2"
    folder2.mkdir()
    s.notify(tmp_path, {"event_id": "run2", "status": "stopped_for_review"}, "root")
    assert call.call_count == 2


def test_actual_owned_process_interrupt_retains_output(tmp_path):
    import sys
    import time

    began = time.monotonic()
    command = [
        sys.executable,
        "-u",
        "-c",
        "import time; print('retained'); time.sleep(60)",
    ]
    with pytest.raises(RuntimeError, match="interrupted"):
        s.run_child(command, tmp_path, lambda: time.monotonic() - began > 0.15)
    assert "retained" in (tmp_path / "stdout.txt").read_text()
    assert time.monotonic() - began < 7


def test_actual_child_success_flushes_output(tmp_path):
    import sys

    code, _ = s.run_child(
        [sys.executable, "-c", "print('done')"], tmp_path, lambda: False
    )
    assert code == 0
    assert (tmp_path / "stdout.txt").read_text() == "done\n"


@pytest.fixture
def database(seed_database, monkeypatch):
    from sqlalchemy import delete
    from alethical.db.session import get_engine

    engine = get_engine()
    monkeypatch.setenv("ALETHICAL_SOURCE_REFRESH_FAMILIES", "[]")
    with engine.begin() as db:
        db.execute(delete(s.SourceRefreshState))
        db.execute(delete(s.SourceRequestLimit))
        schema = db.scalar(s.text("SELECT version_num FROM alembic_version"))
    yield engine, schema
    with engine.begin() as db:
        db.execute(delete(s.SourceRefreshState))
        db.execute(delete(s.SourceRequestLimit))


@pytest.mark.parametrize("kind", ["due", "lease", "cooldown", "recent"])
def test_real_database_eligibility_preserves_existing_guards(database, kind):
    engine, schema = database
    with s.Session(engine) as db:
        current = db.scalar(s.text("SELECT clock_timestamp()"))
        if kind == "due":
            name = next(
                k
                for k, v in s.refresh.jobs(current).items()
                if v.lane == s.batch.JOB.lane
            )
            db.add(
                s.SourceRefreshState(
                    name=name, next_due_at=current - timedelta(seconds=1)
                )
            )
        elif kind == "lease":
            db.add(
                s.SourceRefreshState(
                    name="lane:legislative",
                    next_due_at=current,
                    lease_expires_at=current + timedelta(seconds=90),
                )
            )
        elif kind == "recent":
            db.add(
                s.SourceRefreshState(
                    name=s.batch.JOB.name, next_due_at=current, last_finished_at=current
                )
            )
        else:
            db.add(
                s.SourceRequestLimit(
                    host="revisor.mn.gov",
                    next_request_at=current,
                    blocked_until=current + timedelta(seconds=90),
                )
            )
        db.commit()
    gate = s.eligibility(engine, schema)
    assert (gate["eligible_at"] - gate["server_time"]).total_seconds() > 55
    if kind == "due":
        assert any("normal work due" in reason for reason in gate["reasons"])
    if kind == "lease":
        assert any("active lease" in reason for reason in gate["reasons"])


def test_real_schema_mismatch_rejects(database):
    engine, _ = database
    with pytest.raises(RuntimeError, match="schema"):
        s.eligibility(engine, "wrong")


from alethical.tests.test_committee_recovery_batch import setup as recovery_setup  # noqa: E402,F401


def test_real_receipt_commit_and_later_writer_reconciliation(recovery_setup):  # noqa: F811
    from alethical.db import models as m

    engine, root, ids, client = recovery_setup
    s.batch.run_turn(engine, root, "local", apply=True, client=client)
    attempt = next((root / str(ids[0])).glob("attempt-*"))
    (attempt / "result.json").unlink()  # Crash after commit, before durable result.
    inventory = json.loads((root / "inventory.json").read_text())
    records = s.check_receipts(engine, root, inventory)
    assert records[0]["outcome"] == "committed"
    with s.Session(engine) as db:
        action = db.get(m.BillAction, ids[1])
        action.committee_id = None
        db.commit()
    with pytest.raises(s.batch.AmbiguousReceipt):
        s.check_receipts(engine, root, inventory)
    assert not (
        attempt / "result.json"
    ).exists()  # This read cannot bless/rewrite evidence.


def test_child_timeout_preserves_logs(tmp_path, monkeypatch):
    import sys

    monkeypatch.setattr(s, "TURN_TIMEOUT", 0.1)
    with pytest.raises(RuntimeError, match="interrupted"):
        s.run_child(
            [
                sys.executable,
                "-u",
                "-c",
                "import time; print('before timeout'); time.sleep(60)",
            ],
            tmp_path,
            lambda: False,
        )
    assert "before timeout" in (tmp_path / "stdout.txt").read_text()


def test_notification_queue_is_not_receipt(tmp_path, monkeypatch):
    folder = tmp_path / "supervisor-runs" / "event"
    folder.mkdir(parents=True)
    monkeypatch.setattr(
        s.subprocess, "run", lambda *a, **kw: SimpleNamespace(returncode=0)
    )
    s.notify(tmp_path, {"event_id": "event", "status": "pass_finished"}, "root")
    assert (
        json.loads((folder / "notification.json").read_text())["state"]
        == "queued_not_received"
    )


def test_missing_receipt_proof_never_connects(setup, monkeypatch):
    args, _, _, sleep, gate = setup
    args.return_proof.write_text('{"thread":"root","event_id":"queued-only"}')
    connect = Mock()
    monkeypatch.setattr(s, "create_engine", connect)
    with pytest.raises(RuntimeError, match="no recorded receipt"):
        s.supervise(args, snapshot=gate, sleep=sleep)
    connect.assert_not_called()


def test_wall_clock_rollback_cannot_extend_run(setup, monkeypatch):
    args, _, clock, sleep, _ = setup
    started = s.now()
    monkeypatch.setattr(s, "now", lambda: started)  # Wall clock never advances.

    def gate(*a):
        return {
            "server_time": started,
            "eligible_at": started + timedelta(seconds=60),
            "reasons": ["busy"],
        }

    child = Mock()
    result = s.supervise(args, snapshot=gate, child=child, sleep=sleep)
    assert result["status"] == "stopped_at_window_or_request"
    assert clock[0] <= 1500
    child.assert_not_called()


def test_owner_lock_conflict_always_disposes_engine(setup):
    args, engine, _, sleep, gate = setup
    with s.ownership(args.evidence), pytest.raises(BlockingIOError):
        s.supervise(args, snapshot=gate, sleep=sleep)
    engine.dispose.assert_called_once()


def test_notification_save_failure_still_disposes_engine(setup, monkeypatch):
    args, engine, _, sleep, gate = setup
    (args.evidence / "STOP").touch()

    def fail(*a):
        raise OSError("disk full")

    monkeypatch.setattr(s, "notify", fail)
    with pytest.raises(OSError):
        s.supervise(args, snapshot=gate, sleep=sleep)
    engine.dispose.assert_called_once()
    assert json.loads((args.evidence / "supervisor.json").read_text())["finished_at"]


def test_actual_manifest_drift_fails(tmp_path):
    payload = {"target": "local", "bills": []}
    expected = s.batch.digest(payload)
    (tmp_path / "inventory.json").write_text(
        json.dumps({**payload, "sha256": expected})
    )
    assert s.manifest(tmp_path, expected)["target"] == "local"
    (tmp_path / "inventory.json").write_text(
        json.dumps({**payload, "target": "production", "sha256": expected})
    )
    with pytest.raises(RuntimeError, match="inventory changed"):
        s.manifest(tmp_path, expected)


def test_actual_checkout_drift_and_dirty_files(tmp_path, monkeypatch):
    import subprocess

    subprocess.run(["git", "init", "-q", str(tmp_path)], check=True)
    subprocess.run(
        [
            "git",
            "-C",
            str(tmp_path),
            "-c",
            "user.name=Test",
            "-c",
            "user.email=test@example.invalid",
            "commit",
            "--allow-empty",
            "-qm",
            "test",
        ],
        check=True,
    )
    revision = subprocess.check_output(
        ["git", "-C", str(tmp_path), "rev-parse", "HEAD"], text=True
    ).strip()
    monkeypatch.setattr(s, "ROOT", tmp_path)
    s.verify_checkout(revision)
    with pytest.raises(RuntimeError):
        s.verify_checkout("0" * 40)
    (tmp_path / "unexpected").touch()
    with pytest.raises(RuntimeError):
        s.verify_checkout(revision)
