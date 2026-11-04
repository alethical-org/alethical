"""One bounded, leased turn of exact historical committee-ID recovery.

Not registered with recurring dispatch. The release owner explicitly invokes each
turn; source evidence and receipts live outside working folders. No ingestion.
"""

from __future__ import annotations

import hashlib
import json
import os
import tempfile
import time
from collections import Counter
from contextlib import contextmanager
from contextvars import ContextVar
from datetime import timedelta
from pathlib import Path
from uuid import UUID
from typing import Any

import httpx
from sqlalchemy import event, func, literal_column, select, text
from sqlalchemy.exc import DBAPIError
from sqlalchemy.orm import Session

from alethical.db.models import Bill, BillAction, SourceRefreshState
from alethical.pipeline import bill_action_committee_backfill as recovery
from alethical.pipeline import record_refresh as refresh
from alethical.pipeline.request_limits import (
    DatabaseRequestLimiter,
    retry_after_seconds,
)
from scripts.recover_bill_action_committee_links import capture, source

JOB = refresh.RefreshJob(
    name="committee-links-recovery",
    interval=timedelta(minutes=1),
    timeout=timedelta(seconds=120),
    arguments=(),
    source="Revisor",
    purpose="One bounded historical committee-ID repair turn",
    lane="legislative",
    review_exit=2,
)
MAX_BILLS = 20_000
MAX_ATTEMPTS = 3
APPLY_RESERVE = 45
LOCK_BUDGET = 5.0
CLEANUP_BUDGET = 5.0
SQL_DEADLINE = ContextVar("committee_recovery_sql_deadline", default=None)


class Deferred(RuntimeError):
    """No unsafe retry in the current turn."""


class AmbiguousReceipt(RuntimeError):
    """A later writer or incomplete evidence requires owner review."""


class CleanupOwnershipLost(RuntimeError):
    """Work evidence remains saved, but this runner no longer owns lane cleanup."""


@contextmanager
def sql_deadline(engine, deadline):
    """Bound every query, including reads inside existing coordination helpers."""
    previous = SQL_DEADLINE.get()
    token = SQL_DEADLINE.set(deadline)

    def before_sql(connection, cursor, statement, parameters, context, many):
        bound = SQL_DEADLINE.get()
        if bound is not None:
            check_time(bound)
            milliseconds = max(1, min(15000, int((bound - time.monotonic()) * 1000)))
            if statement.upper().startswith("SET TRANSACTION"):
                return
            cursor.execute(
                "SELECT set_config('statement_timeout', %s, true)", (str(milliseconds),)
            )

    if previous is None:
        event.listen(engine, "before_cursor_execute", before_sql)
    try:
        yield
    finally:
        if previous is None:
            event.remove(engine, "before_cursor_execute", before_sql)
        SQL_DEADLINE.reset(token)


def target_status(plan, entry, *, committed=False):
    states = plan.get("action_outcomes", {})
    fills = {fill["before"]["id"] for fill in plan["fills"]}
    outcomes = {}
    for action in entry["actions"]:
        state = states.get(
            action, "would_fill" if action in fills else "target_not_recorded"
        )
        outcomes[action] = "applied" if committed and state == "would_fill" else state
    return {
        "targets": outcomes,
        "review_required": any(
            state not in {"would_fill", "applied", "already_set"}
            for state in outcomes.values()
        ),
    }


def implementation_digest():
    files = [
        Path(__file__),
        Path(recovery.__file__),
        Path(__file__).with_name("request_limits.py"),
    ]
    return hashlib.sha256(b"\0".join(p.read_bytes() for p in files)).hexdigest()


def digest(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True).encode()).hexdigest()


def database(db):
    return db.scalar(text("SELECT current_database()"))


def readonly(db):
    db.execute(text("SET TRANSACTION READ ONLY"))
    db.execute(text("SET LOCAL statement_timeout = '15s'"))


def inventory(engine, root: Path, target: str):
    """Freeze existing named, unlinked actions; subsequent turns never grow it."""
    with Session(engine) as db, db.begin():
        readonly(db)
        rows = db.execute(
            select(Bill.id, Bill.bill_key, func.array_agg(BillAction.id))
            .join(BillAction, BillAction.bill_id == Bill.id)
            .where(
                BillAction.committee_id.is_(None),
                func.length(func.trim(BillAction.committee_name)) > 0,
            )
            .group_by(Bill.id, Bill.bill_key)
            .order_by(Bill.bill_key, Bill.id)
            .limit(MAX_BILLS + 1)
        ).all()
        if len(rows) > MAX_BILLS:
            raise ValueError("inventory exceeds reviewed bill bound")
        entries = [
            {"id": str(id_), "key": key, "actions": sorted(map(str, actions))}
            for id_, key, actions in rows
        ]
        value = {
            "format": 1,
            "target": target,
            "database": database(db),
            "implementation_sha256": implementation_digest(),
            "bills": entries,
        }
    value["sha256"] = digest(value)
    recovery.write_evidence(root / "inventory.json", value)
    return value


def load_inventory(engine, root, target):
    value = json.loads((root / "inventory.json").read_text())
    payload = {key: item for key, item in value.items() if key != "sha256"}
    if value.get("format") != 1 or value.get("sha256") != digest(payload):
        raise ValueError("inventory digest or format changed")
    bills = value["bills"]
    if value["target"] != target or len(bills) > MAX_BILLS:
        raise ValueError("inventory target or size mismatch")
    if len({row["id"] for row in bills}) != len(bills):
        raise ValueError("duplicate inventory bill")
    for row in bills:
        UUID(row["id"])
        if len(row["actions"]) > recovery.MAX_ACTIONS:
            # The per-bill reader also rejects oversized action inventories.
            raise ValueError("inventory bill exceeds reviewed action bound")
    with Session(engine) as db:
        if value["database"] != database(db):
            raise ValueError("inventory database mismatch")
    return value


def normal_work_due(db, now):
    for name, job in refresh.jobs(now).items():
        if job.lane != JOB.lane:
            continue
        row = db.get(SourceRefreshState, name)
        # Honor held schedules even if this local process lacks the server's env.
        if row is not None and refresh._next_due_at(row, job) <= now:
            return True
        if row is None and refresh.enabled_job(name):
            return True
    return False


def claim(engine):
    with Session(engine) as db:
        db.execute(text("SET LOCAL statement_timeout = '15s'"))
        now = db.scalar(select(func.clock_timestamp()))
        if normal_work_due(db, now):
            return None
        return refresh.claim_job(db, JOB, now=now)


def guard_lease(db, held, *, reserve=0):
    """Lock both lease rows through apply commit; never steal or renew a lease."""
    db.execute(text("SET LOCAL lock_timeout = '3s'"))
    db.execute(text("SET LOCAL statement_timeout = '15s'"))
    names = [f"lane:{JOB.lane}", JOB.name]
    # Match claim/finish lock order: lane first, then job.
    rows = [
        db.scalar(
            select(SourceRefreshState)
            .where(SourceRefreshState.name == name)
            .with_for_update()
        )
        for name in names
    ]
    now = db.scalar(select(func.clock_timestamp()))
    if any(
        row is None
        or row.token != held.token
        or row.lease_expires_at is None
        or row.lease_expires_at <= now + timedelta(seconds=reserve)
        for row in rows
    ):
        raise Deferred("recovery lease lost or too close to expiry")


def check_time(deadline, reserve=0):
    if time.monotonic() + reserve >= deadline:
        raise Deferred("turn deadline reached")


class SourceClient:
    def __init__(self, engine, client, deadline):
        self.limiter = DatabaseRequestLimiter(engine)
        self.client = client
        self.deadline = deadline

    def __call__(self, url):
        recovery.official(url)
        check_time(self.deadline)
        self.limiter.wait(url, deadline=self.deadline)
        timeout = min(10, self.deadline - time.monotonic())
        check_time(self.deadline)
        body = bytearray()
        with self.client.stream(
            "GET", url, timeout=timeout, follow_redirects=False
        ) as response:
            if response.status_code in {429, 503}:
                self.limiter.defer(
                    url,
                    retry_after_seconds(response.headers.get("Retry-After")),
                    deadline=self.deadline,
                )
                raise Deferred("source requested a shared cooldown")
            response.raise_for_status()
            for chunk in response.iter_bytes():
                check_time(self.deadline)
                body.extend(chunk)
                if len(body) > recovery.MAX_XML_BYTES:
                    raise ValueError("XML exceeds bounded source size")
        return bytes(body).decode("utf-8")


def reconcile(db, receipt):
    """Classify interrupted commit; later edits must never be silently accepted."""
    if database(db) != receipt["database"]:
        raise AmbiguousReceipt("receipt database mismatch")
    fills = receipt["written"]
    if not fills or len(fills) > recovery.MAX_ACTIONS:
        raise AmbiguousReceipt("empty or oversized apply receipt")
    ids = [UUID(fill["before"]["id"]) for fill in fills]
    rows = {
        str(row.id): (recovery.before(row), xmin)
        for row, xmin in db.execute(
            select(BillAction, literal_column("bill_action.xmin::text")).where(
                BillAction.id.in_(ids)
            )
        )
    }
    statuses = []
    for fill in fills:
        current = rows.get(fill["before"]["id"])
        before = (fill["before"], fill["row_version"])
        after = (
            {**fill["before"], "committee_id": fill["committee_id"]},
            fill["after_version"],
        )
        statuses.append(
            "committed"
            if current == after
            else "not_committed"
            if current == before
            else "changed"
        )
    if len(set(statuses)) != 1 or statuses[0] == "changed":
        raise AmbiguousReceipt("receipt rows changed or have mixed commit evidence")
    return statuses[0]


def result(path, status, **fields):
    value = {
        "status": status,
        "implementation_sha256": implementation_digest(),
        **fields,
    }
    recovery.write_evidence(path / "result.json", value)
    return value


def pending_attempt(engine, folder, entry):
    """Reconcile every unfinished attempt before starting another one."""
    attempts = sorted(folder.glob("attempt-*"))
    for attempt in attempts:
        if (attempt / "result.json").exists():
            continue
        receipt_path = attempt / "receipt.json"
        if receipt_path.exists():
            receipt = json.loads(receipt_path.read_text())
            if (
                receipt["plan"]["bill"]["bill_key"] != entry["key"]
                or receipt["plan"]["bill"]["id"] != entry["id"]
            ):
                raise AmbiguousReceipt("receipt names another inventory bill")
            with Session(engine) as db, db.begin():
                readonly(db)
                outcome = reconcile(db, receipt)
            result(
                attempt,
                "applied" if outcome == "committed" else "aborted",
                filled=len(receipt["written"]) if outcome == "committed" else 0,
                **target_status(
                    receipt["plan"], entry, committed=outcome == "committed"
                ),
            )
        else:
            # No durable receipt means helper never crossed its precommit gate.
            # Before retry, still wait for the original lease to finish/expire.
            result(attempt, "interrupted")
    return attempts


def process_bill(
    engine, held, entry, folder, fetcher, deadline, *, apply, lock_budget=LOCK_BUDGET
):
    attempts = pending_attempt(engine, folder, entry)
    results = [json.loads((p / "result.json").read_text()) for p in attempts]
    terminal = next(
        (
            r
            for r in reversed(results)
            if r["status"] in {"applied", "no_fill", "review"}
        ),
        None,
    )
    if terminal is not None:
        return {**terminal, "resumed": True}
    planned = next(
        (
            p
            for p in reversed(attempts)
            if json.loads((p / "result.json").read_text())["status"] == "planned"
        ),
        None,
    )
    if planned and not apply:
        return {**json.loads((planned / "result.json").read_text()), "resumed": True}
    failures = sum(
        r["status"] in {"deferred", "aborted", "interrupted"} for r in results
    )
    if failures >= MAX_ATTEMPTS:
        return {"status": "retry_exhausted"}
    path = folder / f"attempt-{len(attempts) + 1:04d}"
    path.mkdir(parents=True, exist_ok=False, mode=0o700)
    try:
        check_time(deadline, APPLY_RESERVE)
        with Session(engine) as db, db.begin():
            guard_lease(db, held)
        with Session(engine) as db, db.begin():
            readonly(db)
            bill = db.get(Bill, UUID(entry["id"]))
            if bill is None or bill.bill_key != entry["key"]:
                raise ValueError("inventory bill identity changed")
            # Fresh capture deliberately avoids silently reusing stale planned XML.
            capture(
                db,
                entry["key"],
                path / "source.json",
                fetcher,
                deadline=deadline - APPLY_RESERVE,
            )
        retained = source(path / "source.json", entry["key"])
        with Session(engine) as db, db.begin():
            readonly(db)
            plan = recovery.plan(
                db,
                entry["key"],
                retained["xml"],
                retained["source_url"],
                source_generation=retained["generation"],
                deadline=deadline - APPLY_RESERVE,
                include_outcomes=True,
            )
        if plan["bill"]["id"] != entry["id"] or any(
            fill["before"]["id"] not in entry["actions"] for fill in plan["fills"]
        ):
            raise ValueError("proposed fills extend the frozen inventory")
        recovery.write_evidence(path / "plan.json", plan)
        if not plan["fills"]:
            return result(
                path, "no_fill", counts=plan["counts"], **target_status(plan, entry)
            )
        if not apply:
            return result(
                path, "planned", counts=plan["counts"], **target_status(plan, entry)
            )
        check_time(deadline, APPLY_RESERVE)
        lock_started = time.monotonic()
        lock_deadline = min(deadline, lock_started + lock_budget)
        with sql_deadline(engine, lock_deadline), Session(engine) as db, db.begin():
            guard_lease(db, held, reserve=APPLY_RESERVE)
            recovery.apply(
                db, plan, retained["xml"], path / "receipt.json", deadline=lock_deadline
            )
            check_time(lock_deadline)
        lock_seconds = time.monotonic() - lock_started
        receipt = json.loads((path / "receipt.json").read_text())
        with Session(engine) as db, db.begin():
            readonly(db)
            if reconcile(db, receipt) != "committed":
                raise AmbiguousReceipt("apply commit not confirmed")
        return result(
            path,
            "applied",
            filled=len(receipt["written"]),
            counts=plan["counts"],
            lock_seconds=lock_seconds,
            **target_status(plan, entry, committed=True),
        )
    except DBAPIError as exc:
        if (path / "receipt.json").exists():
            raise
        if getattr(exc.orig, "sqlstate", None) not in {"57014", "55P03"}:
            raise
        result(path, "deferred", reason="database statement or lock deadline")
        raise Deferred("database statement or lock deadline") from exc
    except (Deferred, TimeoutError, httpx.HTTPError) as exc:
        if (path / "receipt.json").exists():
            raise  # Leave prepared evidence for explicit commit reconciliation.
        result(path, "deferred", reason=str(exc))
        raise Deferred(str(exc)) from exc
    except ValueError as exc:
        if (path / "receipt.json").exists():
            raise
        return result(
            path,
            "review",
            reason=str(exc),
            targets={action: "bill_evidence_rejected" for action in entry["actions"]},
            review_required=True,
        )


def save_progress(root, progress):
    # Only the CLI's exclusive evidence-directory owner may replace this index.
    fd, name = tempfile.mkstemp(prefix=".progress-", dir=root)
    try:
        with os.fdopen(fd, "w") as stream:
            json.dump(progress, stream, sort_keys=True)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(name, root / "progress.json")
        directory = os.open(root, os.O_RDONLY)
        try:
            os.fsync(directory)
        finally:
            os.close(directory)
    finally:
        if os.path.exists(name):
            os.unlink(name)


def _run_turn(
    engine,
    root,
    target,
    *,
    apply=False,
    max_bills=10,
    max_seconds=120,
    client=None,
    deadline: float,
):
    """Exactly one turn. Caller holds the exclusive evidence-directory lock."""
    if not 1 <= max_bills <= 10 or not 60 <= max_seconds <= 120:
        raise ValueError("reviewed turn limits: 1–10 bills and 60–120 seconds")
    manifest = load_inventory(engine, root, target)
    mode = "apply" if apply else "plan"
    progress: dict[str, Any] = (
        json.loads((root / "progress.json").read_text())
        if (root / "progress.json").exists()
        else {"inventory": manifest["sha256"], "plan": 0, "apply": 0, "outcomes": {}}
    )
    if progress["inventory"] != manifest["sha256"] or not 0 <= progress[mode] <= len(
        manifest["bills"]
    ):
        raise ValueError("progress does not match frozen inventory")
    held = claim(engine)
    if held is None:
        return {
            "status": "deferred",
            "reason": "normal work due, lane busy or recovery cooling down",
        }
    counts = Counter()
    lock_seconds = 0.0
    code = 75
    owns_client = client is None
    try:
        check_time(deadline)
        client = client or httpx.Client(
            headers={"User-Agent": "Alethical Minnesota Ingest/0.1"}
        )
        fetcher = SourceClient(engine, client, deadline - APPLY_RESERVE)
        for index in range(
            progress[mode], min(len(manifest["bills"]), progress[mode] + max_bills)
        ):
            entry = manifest["bills"][index]
            check_time(deadline, APPLY_RESERVE)
            outcome = process_bill(
                engine,
                held,
                entry,
                root / entry["id"],
                fetcher,
                deadline,
                apply=apply,
                lock_budget=LOCK_BUDGET - lock_seconds,
            )
            counts[outcome["status"]] += 1
            progress[mode] = index + 1
            if outcome["status"] != "skipped":
                progress["outcomes"][entry["id"]] = outcome
            save_progress(root, progress)
            if outcome["status"] == "applied":
                lock_seconds += outcome.get("lock_seconds", 0)
                if lock_seconds >= LOCK_BUDGET:
                    break
                # No product lock is held while pacing or between turn invocations.
                check_time(deadline, APPLY_RESERVE + 1)
                time.sleep(1)
        done = progress[mode] == len(manifest["bills"])
        needs_review = any(
            r["status"] in {"review", "retry_exhausted"}
            or r.get("review_required", False)
            for r in progress["outcomes"].values()
        )
        if done:
            code = 2 if needs_review else 0
        return {
            "status": "review_required"
            if done and needs_review
            else "pass_finished"
            if done
            else "continuing",
            "mode": mode,
            "cursor": progress[mode],
            "inventory_bills": len(manifest["bills"]),
            "outcomes": dict(counts),
        }
    except Deferred as exc:
        code = 76
        return {
            "status": "deferred",
            "reason": str(exc),
            "cursor": progress[mode],
            "outcomes": dict(counts),
        }
    except BaseException:
        code = 1
        raise
    finally:
        if owns_client and client is not None:
            client.close()
        with (
            sql_deadline(engine, time.monotonic() + CLEANUP_BUDGET),
            Session(engine) as db,
        ):
            db.execute(text("SET LOCAL statement_timeout = '5s'"))
            db.execute(text("SET LOCAL lock_timeout = '3s'"))
            # Deferred outcome atomically releases the lane and waits one minute.
            finished = refresh.finish_job(
                db,
                held,
                code=76 if code == 75 else code,
                finding={"outcomes": dict(counts)},
            )

            if not finished:
                raise CleanupOwnershipLost(
                    "recovery finish refused: lease owner changed or expired; saved evidence retained"
                )


def run_turn(
    engine, root, target, *, apply=False, max_bills=10, max_seconds=120, client=None
):
    # Starts before inventory validation and claim; cleanup has a separate 5s bound.
    deadline = time.monotonic() + max_seconds
    with sql_deadline(engine, deadline):
        return _run_turn(
            engine,
            root,
            target,
            apply=apply,
            max_bills=max_bills,
            max_seconds=max_seconds,
            client=client,
            deadline=deadline,
        )
