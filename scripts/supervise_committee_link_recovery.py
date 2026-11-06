#!/usr/bin/env python3
"""Continue one frozen, reviewed recovery pass without AI polling.

Never changes the one-turn runner's source, write, lease or quiet-period limits.
The caller supplies an already reviewed revision, schema and tested return route.
"""

from __future__ import annotations

import argparse
import fcntl
import json
import os
import signal
import subprocess
import sys
import time
from contextlib import contextmanager
from datetime import UTC, datetime, timedelta
from pathlib import Path
from uuid import UUID, uuid4
from typing import Any

from sqlalchemy import create_engine, select, text
from sqlalchemy.orm import Session

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from alethical.db.models import SourceRefreshState, SourceRequestLimit  # noqa: E402
from alethical.db.session import NO_PREPARED_STATEMENTS, database_url_for_target  # noqa: E402
from alethical.pipeline import committee_recovery_batch as batch  # noqa: E402
from alethical.pipeline import record_refresh as refresh  # noqa: E402

TURN_TIMEOUT = 135
QUIET_SECONDS = 60


def now():
    return datetime.now(UTC)


def save(path, value):
    """Replace one private checkpoint durably; never touch batch progress."""
    temporary = path.with_name(path.name + ".next")
    with temporary.open("w") as stream:
        json.dump(value, stream, indent=2, default=str)
        stream.flush()
        os.fsync(stream.fileno())
    os.replace(temporary, path)
    sync_directory(path.parent)


def sync_directory(path):
    descriptor = os.open(path, os.O_RDONLY)
    try:
        os.fsync(descriptor)
    finally:
        os.close(descriptor)


@contextmanager
def ownership(root):
    # Distinct from the one-turn child's .owner.lock; held through quiet waits.
    with (root / ".supervisor.lock").open("a") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        yield


def verify_checkout(revision):
    def git(*arguments):
        return subprocess.check_output(
            ["git", "-C", str(ROOT), *arguments], text=True, timeout=10
        ).strip()

    if git("rev-parse", "HEAD") != revision or git("status", "--porcelain"):
        raise RuntimeError("reviewed checkout changed or is not clean")


def manifest(root, expected):
    value = json.loads((root / "inventory.json").read_text())
    payload = {key: item for key, item in value.items() if key != "sha256"}
    if value.get("sha256") != expected or batch.digest(payload) != expected:
        raise RuntimeError("frozen inventory changed")
    return value


def progress(root, inventory):
    value: dict[str, Any] = (
        json.loads((root / "progress.json").read_text())
        if (root / "progress.json").exists()
        else {"inventory": inventory["sha256"], "apply": 0, "outcomes": {}}
    )
    cursor = value["apply"]
    entries = inventory["bills"]
    if (
        value["inventory"] != inventory["sha256"]
        or type(cursor) is not int
        or not 0 <= cursor <= len(entries)
        or any(row["id"] not in value["outcomes"] for row in entries[:cursor])
        or set(value["outcomes"]) - {row["id"] for row in entries}
    ):
        raise RuntimeError("progress does not match the frozen inventory")
    return value


def eligibility(engine, schema):
    """Read server-clock eligibility; make no reservation or schedule changes."""
    with (
        batch.sql_deadline(engine, time.monotonic() + 10),
        Session(engine) as db,
        db.begin(),
    ):
        db.execute(text("SET TRANSACTION READ ONLY"))
        db.execute(text("SET LOCAL statement_timeout = '5s'"))
        if db.scalars(text("SELECT version_num FROM alembic_version")).all() != [
            schema
        ]:
            raise RuntimeError("production schema differs from the reviewed schema")
        current = db.scalar(text("SELECT clock_timestamp()"))
        jobs = {
            name: job
            for name, job in refresh.jobs(current).items()
            if job.lane == batch.JOB.lane
        }
        names = [*jobs, batch.JOB.name, "lane:legislative"]
        rows = {
            row.name: row
            for row in db.scalars(
                select(SourceRefreshState).where(SourceRefreshState.name.in_(names))
            )
        }
        ready = current
        reasons = []
        recovery = rows.get(batch.JOB.name)
        if recovery is not None:
            ready = max(ready, refresh._next_due_at(recovery, batch.JOB))
            if recovery.last_finished_at:
                ready = max(
                    ready, recovery.last_finished_at + timedelta(seconds=QUIET_SECONDS)
                )
        for name, row in rows.items():
            if row.lease_expires_at and row.lease_expires_at > current:
                ready = max(ready, row.lease_expires_at)
                reasons.append("active lease: " + name)
        for name, job in jobs.items():
            row = rows.get(name)
            if (row is not None and refresh._next_due_at(row, job) <= current) or (
                row is None and refresh.enabled_job(name)
            ):
                # Overdue work cannot become permission by sleeping past its due time.
                ready = max(ready, current + timedelta(seconds=QUIET_SECONDS))
                reasons.append("normal work due: " + name)
        source = db.get(SourceRequestLimit, "revisor.mn.gov")
        if source is not None:
            ready = max(
                ready,
                *(
                    value
                    for value in (source.next_request_at, source.blocked_until)
                    if value is not None
                ),
            )
        return {"server_time": current, "eligible_at": ready, "reasons": reasons}


def run_child(arguments, folder, stopped):
    """Only this new process group may be interrupted; retained receipts survive."""
    with (
        (folder / "stdout.txt").open("x") as stdout,
        (folder / "stderr.txt").open("x") as stderr,
    ):
        child = None
        try:
            child = subprocess.Popen(
                arguments, stdout=stdout, stderr=stderr, start_new_session=True
            )
            save(
                folder / "process.json",
                {
                    "pid": child.pid,
                    "process_group": child.pid,
                    "started_at": now().isoformat(),
                    "arguments": arguments,
                },
            )
            deadline = time.monotonic() + TURN_TIMEOUT
            while child.poll() is None:
                if stopped() or time.monotonic() >= deadline:
                    raise RuntimeError(
                        "owned turn interrupted; reconcile receipts before resuming"
                    )
                time.sleep(0.5)
            return (
                child.returncode,
                "",
            )  # Read retained output only after the finally flush.
        finally:
            try:
                if child is not None:
                    # Descendants may survive an already-exited leader. The new
                    # process group is ours even when the leader has finished.
                    try:
                        os.killpg(child.pid, signal.SIGTERM)
                    except ProcessLookupError:
                        pass
                    try:
                        child.wait(timeout=5)
                    except subprocess.TimeoutExpired:
                        pass
                    try:
                        os.killpg(child.pid, signal.SIGKILL)
                    except ProcessLookupError:
                        pass
                    child.wait(timeout=5)
            finally:
                for stream in (stdout, stderr):
                    stream.flush()
                    os.fsync(stream.fileno())


def classify(code, output, saved, count):
    lines = [line for line in output.splitlines() if line.strip()]
    if len(lines) != 1:
        raise RuntimeError("turn output is not one complete result")
    answer = json.loads(lines[0])
    expected = {
        75: "continuing",
        76: "deferred",
        0: "pass_finished",
        2: "review_required",
    }
    if code not in expected or answer.get("status") != expected[code]:
        raise RuntimeError("turn failed or exit code disagrees with result")
    cursor = saved["apply"]
    if "cursor" in answer and answer["cursor"] != cursor:
        raise RuntimeError("turn result disagrees with saved progress")
    if code in {0, 2}:
        review = any(
            row.get("review_required") or row["status"] in {"review", "retry_exhausted"}
            for row in saved["outcomes"].values()
        )
        if (
            cursor != count
            or answer.get("mode") != "apply"
            or (code == 2) != bool(review)
        ):
            raise RuntimeError("terminal result does not prove the pass outcome")
    elif code == 75 and (answer.get("mode") != "apply" or cursor >= count):
        raise RuntimeError("continuation is inconsistent with inventory")
    return answer


def notify(root, state, thread):
    """Persist an at-most-once queue attempt; queued never means received."""
    path = root / "supervisor-runs" / state["event_id"] / "notification.json"
    if path.exists():
        return
    message = (
        f"Finance recovery event {state['event_id']}: {state['status']}. "
        f"Read {root / 'supervisor-runs' / state['event_id'] / 'state.json'} and retained turn receipts; continue the existing build. "
        "Do not restart Claude or create another recovery writer. This is not final acceptance."
    )
    record = {
        "event_id": state["event_id"],
        "thread": thread,
        "state": "attempting",
        "message": message,
    }
    save(path, record)
    try:
        result = subprocess.run(
            ["codex", "queue", "--thread", thread, "--message", message],
            capture_output=True,
            text=True,
            timeout=15,
        )
        record.update(
            state="queued_not_received"
            if result.returncode == 0
            else "delivery_unverified",
            exit_code=result.returncode,
        )
    except (OSError, subprocess.TimeoutExpired):
        record["state"] = "delivery_unverified"
    save(path, record)


def validate_database(engine, root, target):
    with batch.sql_deadline(engine, time.monotonic() + 10):
        batch.load_inventory(engine, root, target)


def check_receipts(engine, root, inventory):
    """Read-only classification. The child retains its own durable reconciliation."""
    records = []
    with (
        batch.sql_deadline(engine, time.monotonic() + 10),
        Session(engine) as db,
        db.begin(),
    ):
        db.execute(text("SET TRANSACTION READ ONLY"))
        for entry in inventory["bills"]:
            for attempt in sorted((root / entry["id"]).glob("attempt-*")):
                receipt_path = attempt / "receipt.json"
                if not receipt_path.exists() or (attempt / "result.json").exists():
                    continue
                receipt = json.loads(receipt_path.read_text())
                bill = receipt["plan"]["bill"]
                if bill["id"] != entry["id"] or bill["bill_key"] != entry["key"]:
                    raise RuntimeError("receipt names another frozen bill")
                if not {row["before"]["id"] for row in receipt["written"]}.issubset(
                    set(entry["actions"])
                ):
                    raise RuntimeError(
                        "receipt includes an action outside the frozen target set"
                    )
                records.append(
                    {
                        "receipt": str(receipt_path),
                        "outcome": batch.reconcile(db, receipt),
                    }
                )
    return records


def resume_check(args, previous):
    """An explicit owner's review binds the exact stopped checkpoint and new code."""
    if args.resume_event != previous.get("event_id") or args.resume_review is None:
        raise RuntimeError("saved run requires an exact event and owner review")
    review = json.loads(args.resume_review.read_text())
    required = {
        "event_id": args.resume_event,
        "checkpoint_sha256": batch.digest(previous),
        "revision": args.revision,
        "schema": args.schema,
        "manifest": args.manifest,
        "target": args.target,
        "thread": args.thread,
    }
    if any(review.get(key) != value for key, value in required.items()) or not all(
        review.get(key) for key in ("reviewer", "reviewed_at", "reason")
    ):
        raise RuntimeError(
            "resume review does not match saved state and reviewed release"
        )
    if any(
        previous.get(key) != required[key] for key in ("manifest", "target", "thread")
    ):
        raise RuntimeError("resume cannot change frozen pass or return owner")
    if previous.get("status") in {"pass_finished", "review_required"}:
        raise RuntimeError("terminal pass cannot be resumed")
    return review


def supervise(args, *, snapshot=eligibility, child=run_child, sleep=time.sleep):
    root = args.evidence.resolve()
    if root == ROOT or ROOT in root.parents:
        raise RuntimeError("recovery evidence must stay outside the reviewed checkout")
    inventory = manifest(root, args.manifest)
    if inventory["target"] != args.target:
        raise RuntimeError("inventory target mismatch")
    proof = json.loads(args.return_proof.read_text())
    if (
        proof.get("thread") != args.thread
        or not proof.get("received_at")
        or not proof.get("event_id")
    ):
        raise RuntimeError("return route has no recorded receipt for this chat")
    engine = create_engine(
        database_url_for_target(args.target),
        connect_args={**NO_PREPARED_STATEMENTS, "connect_timeout": 5},
    )
    path = root / "supervisor.json"
    try:
        with ownership(root):
            previous = json.loads(path.read_text()) if path.exists() else None
            review = resume_check(args, previous) if previous is not None else None
            if previous is None and (args.resume_event or args.resume_review):
                raise RuntimeError("resume requires a saved run")
            event = str(uuid4())
            run = root / "supervisor-runs" / event
            run.mkdir(parents=True, mode=0o700)
            sync_directory(run.parent)
            sync_directory(root)
            state = {
                "event_id": event,
                "status": "starting",
                "revision": args.revision,
                "schema": args.schema,
                "manifest": args.manifest,
                "target": args.target,
                "thread": args.thread,
                "started_at": now().isoformat(),
                "until": args.until.isoformat(),
                "turns": 0,
                "cursor": None,
                "resume_of": previous.get("event_id") if previous else None,
                "resume_review": review,
                "return_proof": proof,
                "consecutive_eligibility_timeouts": 0,
                "eligibility_timeouts": [],
            }

            def checkpoint():
                save(run / "state.json", state)
                save(path, state)

            checkpoint()
            # A new process cannot reconstruct the old monotonic clock. Restart
            # conservatively waits a whole quiet interval even if wall time moved.
            quiet_until = time.monotonic() + (QUIET_SECONDS if previous else 0)
            checked_receipts = False
            window_deadline = time.monotonic() + max(
                0, (args.until - now()).total_seconds()
            )

            def stopped():
                return (
                    (root / "STOP").exists()
                    or now() >= args.until
                    or time.monotonic() >= window_deadline
                )

            def guard_child():
                verify_checkout(args.revision)
                manifest(root, args.manifest)
                return stopped()

            try:
                state["cursor"] = progress(root, inventory)["apply"]
                verify_checkout(args.revision)
                validate_database(engine, root, args.target)
                while True:
                    if (
                        stopped()
                        or min(
                            (args.until - now()).total_seconds(),
                            window_deadline - time.monotonic(),
                        )
                        < TURN_TIMEOUT
                    ):
                        state["status"] = "stopped_at_window_or_request"
                        break
                    verify_checkout(args.revision)
                    manifest(root, args.manifest)
                    if time.monotonic() < quiet_until:
                        sleep(min(1.0, quiet_until - time.monotonic()))
                        continue
                    try:
                        gate = snapshot(engine, args.schema)
                    except batch.Deferred as exc:
                        # This check is read-only and runs with no child. Unknown
                        # eligibility never permits writes. Keep all write/receipt
                        # failures on the existing stop-for-review path.
                        if str(exc) != "turn deadline reached":
                            raise
                        failures = state["consecutive_eligibility_timeouts"] + 1
                        state.update(
                            status="waiting_for_eligibility",
                            eligibility=None,
                            consecutive_eligibility_timeouts=failures,
                        )
                        state["eligibility_timeouts"].append(
                            {"at": now().isoformat(), "consecutive": failures}
                        )
                        checkpoint()
                        if failures >= 3:
                            raise
                        engine.dispose()  # Next check uses a fresh connection.
                        quiet_until = time.monotonic() + QUIET_SECONDS * failures
                        continue
                    state["consecutive_eligibility_timeouts"] = 0
                    state["eligibility"] = {
                        **gate,
                        "server_time": gate["server_time"].isoformat(),
                        "eligible_at": gate["eligible_at"].isoformat(),
                    }
                    checkpoint()
                    wait = (gate["eligible_at"] - gate["server_time"]).total_seconds()
                    if wait > 0:
                        quiet_until = time.monotonic() + min(QUIET_SECONDS, wait)
                        continue
                    # No earlier child may still own the batch evidence. A new
                    # conflicting writer after this probe is rejected by child flock.
                    with (root / ".owner.lock").open("a") as lock:
                        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
                        if not checked_receipts:
                            records = check_receipts(engine, root, inventory)
                            save(run / "receipt-reconciliation.json", records)
                            checked_receipts = True
                    if (
                        guard_child()
                        or min(
                            (args.until - now()).total_seconds(),
                            window_deadline - time.monotonic(),
                        )
                        < TURN_TIMEOUT
                    ):
                        state["status"] = "stopped_at_window_or_request"
                        break
                    state["turns"] += 1
                    folder = run / f"turn-{state['turns']:06d}"
                    folder.mkdir(mode=0o700)
                    state.update(status="running", active_turn=str(folder))
                    checkpoint()
                    command = [
                        sys.executable,
                        str(ROOT / "scripts/run_committee_link_recovery.py"),
                        "--target",
                        args.target,
                        "--evidence",
                        str(root),
                        "--apply",
                        "--max-bills",
                        "10",
                        "--max-seconds",
                        "120",
                    ]
                    code, output = child(command, folder, guard_child)
                    if not output and (folder / "stdout.txt").exists():
                        output = (folder / "stdout.txt").read_text()
                    if code in {75, 76}:
                        quiet_until = time.monotonic() + QUIET_SECONDS
                        state["quiet_until"] = (
                            now() + timedelta(seconds=QUIET_SECONDS)
                        ).isoformat()
                    saved = progress(root, inventory)
                    if saved["apply"] < state["cursor"]:
                        raise RuntimeError("saved cursor moved backwards")
                    answer = classify(code, output, saved, len(inventory["bills"]))
                    save(folder / "result.json", {"exit_code": code, "result": answer})
                    state.update(
                        status=answer["status"], cursor=saved["apply"], active_turn=None
                    )
                    checkpoint()
                    if code in {0, 2}:
                        break
            except (Exception, KeyboardInterrupt, SystemExit) as exc:
                state.update(
                    status="stopped_for_review", reason=f"{type(exc).__name__}: {exc}"
                )
            finally:
                state["finished_at"] = now().isoformat()
                checkpoint()
                notify(root, state, args.thread)
            return state
    finally:
        engine.dispose()


def main():
    os.umask(0o077)
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--target", required=True, choices=("local", "production"))
    parser.add_argument("--evidence", required=True, type=Path)
    parser.add_argument("--revision", required=True)
    parser.add_argument("--schema", required=True)
    parser.add_argument("--manifest", required=True)
    parser.add_argument("--thread", required=True, type=lambda value: str(UUID(value)))
    parser.add_argument("--return-proof", required=True, type=Path)
    parser.add_argument("--resume-event")
    parser.add_argument("--resume-review", type=Path)
    parser.add_argument("--until", required=True, type=datetime.fromisoformat)
    args = parser.parse_args()
    if (
        args.until.tzinfo is None
        or not TURN_TIMEOUT < (args.until - now()).total_seconds() <= 7 * 24 * 3600
    ):
        parser.error(
            "until must be an aware future time within7days, allowing one bounded turn"
        )
    signal.signal(
        signal.SIGTERM,
        lambda *_: (_ for _ in ()).throw(RuntimeError("supervisor stop requested")),
    )
    result = supervise(args)
    print(json.dumps(result, default=str))
    return 0 if result["status"] == "pass_finished" else 2


if __name__ == "__main__":
    raise SystemExit(main())
