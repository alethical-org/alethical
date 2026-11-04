#!/usr/bin/env python3
"""Retain, plan, apply or undo committee links for ONE explicitly named bill.

Default action is a read-only plan. Capture fetches only the held official XML URL.
Apply requires the saved source and plan, rechecks both under short locks, changes
only committee_id, and durably records undo evidence before committing. No action
runs ingestion or publishes data. See the Layer 1 ingestion guide for the runbook.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import sys
from datetime import UTC, datetime
from pathlib import Path

import httpx
from sqlalchemy import create_engine, select, text
from sqlalchemy.orm import Session

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from alethical.db.models import ArtifactType, Bill, BillAction, SourceArtifact  # noqa: E402
from alethical.db.session import NO_PREPARED_STATEMENTS, database_url_for_target  # noqa: E402
from alethical.pipeline import bill_action_committee_backfill as recovery  # noqa: E402


def fetch(url):
    recovery.official(url)
    body = bytearray()
    with httpx.stream("GET", url, timeout=30, follow_redirects=False) as response:
        response.raise_for_status()
        for chunk in response.iter_bytes():
            body.extend(chunk)
            if len(body) > recovery.MAX_XML_BYTES:
                raise ValueError("XML exceeds bounded source size")
    return bytes(body).decode("utf-8")


def capture(db, bill_key, path, fetcher=fetch):
    urls = list(
        db.scalars(
            select(SourceArtifact.source_url)
            .join(BillAction, BillAction.source_artifact_id == SourceArtifact.id)
            .join(Bill, Bill.id == BillAction.bill_id)
            .where(
                Bill.bill_key == bill_key,
                SourceArtifact.artifact_type == ArtifactType.xml,
            )
            .distinct()
            .limit(2)
        )
    )
    if len(urls) != 1:
        raise ValueError("bill must have one held XML source address")
    url = recovery.official(urls[0])
    captured_generation = recovery.generation(db, bill_key)
    body = fetcher(url)
    # Parse and verify bill identity before saving newly fetched bytes.
    probe = recovery.plan(
        db, bill_key, body, url, source_generation=captured_generation
    )
    if probe["counts"].get("source_bill_mismatch"):
        raise ValueError("source names a different bill")
    recovery.write_evidence(
        path,
        {
            "bill_key": bill_key,
            "source_url": url,
            "fetched_at": datetime.now(UTC).isoformat(),
            "sha256": hashlib.sha256(body.encode("utf-8")).hexdigest(),
            "xml": body,
            "generation": captured_generation,
        },
    )


def source(path, bill_key):
    # JSON escaping can expand the source, but the decoded XML is still bounded.
    with Path(path).open("rb") as stream:
        raw = stream.read(recovery.MAX_XML_BYTES * 6 + 1)
    if len(raw) > recovery.MAX_XML_BYTES * 6:
        raise ValueError("source bundle exceeds size bound")
    value = json.loads(raw)
    body = value["xml"]
    if (
        value["bill_key"] != bill_key
        or len(body.encode("utf-8")) > recovery.MAX_XML_BYTES
        or hashlib.sha256(body.encode("utf-8")).hexdigest() != value["sha256"]
    ):
        raise ValueError("saved source identity or digest changed")
    recovery.official(value["source_url"])
    return value


def parser():
    result = argparse.ArgumentParser(description=__doc__)
    result.add_argument("--target", choices=("local", "production"), required=True)
    result.add_argument(
        "--mode", choices=("capture", "plan", "apply", "rollback"), default="plan"
    )
    result.add_argument("--bill-key", required=True)
    result.add_argument("--source", type=Path)
    result.add_argument("--plan", type=Path)
    result.add_argument("--receipt", type=Path)
    result.add_argument("--rollback-receipt", type=Path)
    return result


def run(db, args):
    if args.mode in {"capture", "plan"}:
        db.execute(text("SET TRANSACTION READ ONLY"))
        db.execute(text("SET LOCAL statement_timeout = '15s'"))
    if args.mode == "capture":
        capture(db, args.bill_key, args.source)
        return {"source_saved": str(args.source), "database_writes": 0}
    if args.mode == "rollback":
        receipt = json.loads(args.receipt.read_text())
        if receipt["plan"]["bill"]["bill_key"] != args.bill_key:
            raise ValueError("receipt names another bill")
        return recovery.rollback(db, receipt, args.rollback_receipt)
    retained = source(args.source, args.bill_key)
    if args.mode == "plan":
        plan = recovery.plan(
            db,
            args.bill_key,
            retained["xml"],
            retained["source_url"],
            source_generation=retained["generation"],
        )
        recovery.write_evidence(args.plan, plan)
        return {"counts": plan["counts"], "database_writes": 0}
    saved = json.loads(args.plan.read_text())
    if (
        saved["source_generation"] != retained["generation"]
        or saved["bill"]["bill_key"] != args.bill_key
        or saved["source_url"] != retained["source_url"]
    ):
        raise ValueError("plan names another bill or source")
    return recovery.apply(db, saved, retained["xml"], args.receipt)


def main():
    cli = parser()
    args = cli.parse_args()
    required = {
        "capture": ("source",),
        "plan": ("source", "plan"),
        "apply": ("source", "plan", "receipt"),
        "rollback": ("receipt", "rollback_receipt"),
    }[args.mode]
    for field in required:
        if getattr(args, field) is None:
            cli.error(f"{args.mode} requires --{field.replace('_', '-')}")
    engine = create_engine(
        database_url_for_target(args.target),
        connect_args=NO_PREPARED_STATEMENTS,
        isolation_level="READ COMMITTED",
    )
    try:
        with Session(engine) as db, db.begin():
            result = run(db, args)
        print(json.dumps(result, sort_keys=True))
    finally:
        engine.dispose()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
