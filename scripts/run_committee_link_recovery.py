#!/usr/bin/env python3
"""Freeze a recovery inventory or run ONE bounded, leased committee-ID turn.

Default turn is plan-only. --apply changes only accepted committee IDs. Root owns
production execution and pilot review. Never runs ingestion or schedules itself.
"""

from __future__ import annotations

import argparse
import fcntl
import json
import multiprocessing
import signal
import time
import sys
from pathlib import Path

from sqlalchemy import create_engine

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from alethical.db.session import NO_PREPARED_STATEMENTS, database_url_for_target  # noqa: E402
from alethical.pipeline.committee_recovery_batch import (  # noqa: E402
    inventory,
    run_turn,
    sql_deadline,
)


def worker(args):
    args.evidence.mkdir(parents=True, exist_ok=True, mode=0o700)
    engine = create_engine(
        database_url_for_target(args.target),
        connect_args={**NO_PREPARED_STATEMENTS, "connect_timeout": 10},
        isolation_level="READ COMMITTED",
    )
    try:
        with (args.evidence / ".owner.lock").open("a") as lock:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
            with sql_deadline(engine, time.monotonic() + args.max_seconds):
                answer = (
                    inventory(engine, args.evidence, args.target)
                    if args.inventory
                    else run_turn(
                        engine,
                        args.evidence,
                        args.target,
                        apply=args.apply,
                        max_bills=args.max_bills,
                        max_seconds=args.max_seconds,
                    )
                )
            if args.inventory:
                answer = {
                    "status": "inventory_saved",
                    "bills": len(answer["bills"]),
                    "sha256": answer["sha256"],
                }
            print(json.dumps(answer, sort_keys=True))
    finally:
        engine.dispose()
    raise SystemExit(
        {"deferred": 76, "continuing": 75, "review_required": 2}.get(
            answer.get("status"), 0
        )
    )


def supervise(args, *, target=worker, timeout=None):
    """Only this new owned worker is terminated; receipts survive interruptions."""
    process = multiprocessing.get_context("spawn").Process(target=target, args=(args,))
    previous = signal.getsignal(signal.SIGTERM)

    def cancelled(signum, frame):
        raise SystemExit(128 + signum)

    signal.signal(signal.SIGTERM, cancelled)
    try:
        process.start()
        process.join(args.max_seconds + 10 if timeout is None else timeout)
        if process.is_alive():
            print(
                json.dumps(
                    {
                        "status": "interrupted",
                        "reason": "owned worker exceeded turn and cleanup bounds; retain receipts and reconcile before retry",
                    }
                ),
                file=sys.stderr,
            )
            return 1
        return (
            max(0, process.exitcode)
            if process.exitcode is not None and process.exitcode >= 0
            else 1
        )
    finally:
        if process.pid is not None and process.is_alive():
            process.terminate()
            process.join(5)
            if process.is_alive():
                process.kill()
                process.join(5)
        signal.signal(signal.SIGTERM, previous)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--target", required=True, choices=("local", "production"))
    parser.add_argument("--evidence", required=True, type=Path)
    parser.add_argument("--inventory", action="store_true")
    parser.add_argument("--apply", action="store_true")
    parser.add_argument("--max-bills", type=int, default=10)
    parser.add_argument("--max-seconds", type=int, default=120)
    args = parser.parse_args()
    if args.inventory and args.apply:
        parser.error("inventory never applies writes")
    if not 1 <= args.max_bills <= 10 or not 60 <= args.max_seconds <= 120:
        parser.error("reviewed turn limits: 1–10 bills and 60–120 seconds")
    return supervise(args)


if __name__ == "__main__":
    raise SystemExit(main())
