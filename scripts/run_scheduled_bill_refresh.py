#!/usr/bin/env python3
"""Continue a leased bill inventory pass without losing corrections after a crash."""

from __future__ import annotations

import argparse
from dataclasses import asdict
import hashlib
import json
import os
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from sqlalchemy import create_engine, text  # noqa: E402
from sqlalchemy.orm import Session  # noqa: E402
from alethical.db.session import NO_PREPARED_STATEMENTS, database_url_for_target  # noqa: E402
from alethical.pipeline.legislative_refresh import refresh_bills  # noqa: E402
from alethical.pipeline.minnesota import BillSearchResult, discover_session_bills  # noqa: E402
from alethical.pipeline.sessions import session_definition  # noqa: E402
from alethical.pipeline.votes import rate_limited_source_session, reconcile_saved_votes  # noqa: E402
from scripts.load_minnesota_data import _validated_database_target  # noqa: E402

CHUNK_SIZE = 100
CONTINUE = 75


def load_progress(engine, name: str, token: str) -> dict:
    with engine.connect() as connection:
        value = connection.execute(
            text("""
            SELECT progress FROM source_refresh_state
            WHERE name=:name AND token=CAST(:token AS uuid)
              AND lease_expires_at > clock_timestamp()
        """),
            {"name": name, "token": token},
        ).scalar_one_or_none()
    if value is None:
        raise RuntimeError("The bill refresh no longer owns its unexpired job lease")
    return dict(value)


def save_progress(engine, name: str, token: str, progress: dict) -> None:
    with engine.begin() as connection:
        changed = connection.execute(
            text("""
            UPDATE source_refresh_state SET progress=CAST(:progress AS jsonb)
            WHERE name=:name AND token=CAST(:token AS uuid)
              AND lease_expires_at > clock_timestamp()
            RETURNING name
        """),
            {"name": name, "token": token, "progress": json.dumps(progress)},
        ).scalar_one_or_none()
        if changed is None:
            raise RuntimeError("The bill refresh lost its lease before saving progress")


def check_pending_votes(engine, *, target: str, bill_keys: list[str]) -> bool:
    source = rate_limited_source_session(engine, target=target)
    try:
        with Session(engine) as db:
            report = reconcile_saved_votes(
                db,
                bill_keys=bill_keys,
                safety_sweep_limit=0,
                dry_run=False,
                source_session=source,
            )
        return not report.failed and not report.rejected
    finally:
        source.close()


def run_chunk(engine, *, name: str, token: str, target: str, session_code: str) -> int:
    session_definition(session_code)
    progress = load_progress(engine, name, token)
    if progress.get("session_code", session_code) != session_code:
        raise RuntimeError("Saved bill refresh progress belongs to another session")
    progress["session_code"] = session_code
    pending = progress.get("pending_votes", [])
    if pending:
        if not check_pending_votes(
            engine, target=target, bill_keys=pending[:CHUNK_SIZE]
        ):
            return 1
        progress["pending_votes"] = pending[CHUNK_SIZE:]
        save_progress(engine, name, token, progress)
        return CONTINUE
    if "inventory" not in progress:
        source = rate_limited_source_session(engine, target=target)
        try:
            inventory = discover_session_bills(source, session_code=session_code)
        finally:
            source.close()
        keys = sorted(item.bill_key for item in inventory)
        if not keys or len(keys) != len(set(keys)):
            raise RuntimeError("The bill source inventory is empty or duplicated")
        missing = set(progress.get("previous_inventory_keys", [])) - set(keys)
        if missing:
            raise RuntimeError(
                f"The bill source inventory omitted {len(missing)} previously listed bills"
            )
        progress.update(
            inventory=[asdict(item) for item in inventory],
            cursor=None,
            failures=[],
            pending_votes=[],
            pass_complete=False,
            inventory_sha256=hashlib.sha256(json.dumps(keys).encode()).hexdigest(),
        )
        save_progress(engine, name, token, progress)
    inventory = [BillSearchResult(**item) for item in progress["inventory"]]
    retrying = progress.get("pass_complete", False)
    if retrying:
        failures = set(progress.get("failures", []))
        work = [item for item in inventory if item.bill_key in failures][:CHUNK_SIZE]
    else:
        cursor = progress.get("cursor")
        work = [
            item
            for item in sorted(inventory, key=lambda item: item.bill_key)
            if cursor is None or item.bill_key > cursor
        ][:CHUNK_SIZE]
    if not work:
        save_progress(
            engine,
            name,
            token,
            {
                "session_code": session_code,
                "previous_inventory_keys": sorted(item.bill_key for item in inventory),
                "last_inventory_sha256": progress["inventory_sha256"],
            },
        )
        return 0
    # Queue before source writes. A crash after a bill commit cannot lose its
    # vote reconciliation; retrying a queued bill is safe and idempotent.
    progress["pending_votes"] = [item.bill_key for item in work]
    save_progress(engine, name, token, progress)
    report = refresh_bills(
        engine,
        session_code=session_code,
        target=target,
        limit=CHUNK_SIZE,
        inventory=work,
    )
    failed = {item["bill_key"] for item in report["failed"]}
    prior_failures = set(progress.get("failures", []))
    progress["failures"] = sorted(
        (prior_failures - {item.bill_key for item in work}) | failed
    )
    if not retrying:
        progress["cursor"] = work[-1].bill_key
        progress["pass_complete"] = not any(
            item.bill_key > work[-1].bill_key for item in inventory
        )
    save_progress(engine, name, token, progress)
    # Finish the rest of an inventory even when one bill needs source review.
    # Once it is done, failed bills alone retry on the runner's failure cadence.
    return 1 if retrying and failed else CONTINUE


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--target", choices=("local", "production"), required=True)
    parser.add_argument("--session-code", required=True)
    args = parser.parse_args(argv)
    name = os.environ.get("ALETHICAL_REFRESH_JOB_NAME")
    token = os.environ.get("ALETHICAL_REFRESH_JOB_TOKEN")
    if not name or not token:
        parser.error("The scheduler must supply the job name and lease token")
    url = database_url_for_target(args.target)
    _validated_database_target(args.target, url)
    engine = create_engine(url, connect_args=NO_PREPARED_STATEMENTS)
    try:
        return run_chunk(
            engine,
            name=name,
            token=token,
            target=args.target,
            session_code=args.session_code,
        )
    finally:
        engine.dispose()


if __name__ == "__main__":
    raise SystemExit(main())
