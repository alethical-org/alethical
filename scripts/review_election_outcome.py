#!/usr/bin/env python3
"""Record a private, explicit exact-race outcome review, retaining original bytes.

Default validates JSON shape only. --capture-url with --execute acquires a public
source and its publisher page. A separate --request review verifies retained
bytes and literal identity bindings before appending a decision.
No command imports result votes or changes the result publication pointer.
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from sqlalchemy import create_engine, select  # noqa: E402
from sqlalchemy.exc import SQLAlchemyError  # noqa: E402
from sqlalchemy.orm import Session  # noqa: E402

from alethical.db import models as m  # noqa: E402
from alethical.db.session import database_url_for_target, NO_PREPARED_STATEMENTS  # noqa: E402
from alethical.pipeline.election_comparison import ComparisonImportError  # noqa: E402
from alethical.pipeline.election_outcomes import (  # noqa: E402
    capture_source,
    capture_metadata,
    record_decision,
    validate_request,
)


def _object(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise ComparisonImportError("Review JSON contains duplicate fields")
        result[key] = value
    return result


def _invalid_constant(value):
    raise ComparisonImportError("Review JSON must use finite values")


def read_request(path: Path) -> dict:
    try:
        request = json.loads(
            path.read_text(encoding="utf-8"),
            object_pairs_hook=_object,
            parse_constant=_invalid_constant,
        )
    except (OSError, UnicodeError, json.JSONDecodeError) as error:
        raise ComparisonImportError("Could not read UTF-8 review JSON") from error
    validate_request(request)
    return request


def execute_request(request: dict, target: str) -> dict:
    engine = create_engine(
        database_url_for_target(target), connect_args=NO_PREPARED_STATEMENTS
    )
    try:
        with Session(engine) as db, db.begin():
            row = record_decision(db, **request)
            current = db.scalar(
                select(m.ElectionOutcomeDecision.id)
                .where(
                    m.ElectionOutcomeDecision.snapshot_id == row.snapshot_id,
                    m.ElectionOutcomeDecision.race_id == row.race_id,
                )
                .order_by(m.ElectionOutcomeDecision.id.desc())
                .limit(1)
            )
            receipt = {
                "executed": True,
                "source_validation": "retained_bytes_and_quotes_checked",
                "decision_id": row.id,
                "previous_decision_id": row.previous_decision_id,
                "current_decision_id": current,
                "history_status": "current" if current == row.id else "superseded",
                "request_key": row.request_key,
            }
        return receipt
    finally:
        engine.dispose()


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    operation = parser.add_mutually_exclusive_group(required=True)
    operation.add_argument("--request", type=Path)
    operation.add_argument("--capture-url")
    parser.add_argument("--publisher-url")
    parser.add_argument("--publisher-host", action="append", default=[])
    parser.add_argument("--authority")
    parser.add_argument("--target", choices=("local", "production"), default="local")
    parser.add_argument("--execute", action="store_true")
    args = parser.parse_args(argv)
    try:
        if args.capture_url:
            if not args.publisher_url or not args.publisher_host or not args.authority:
                raise ComparisonImportError(
                    "Capture needs publisher URL, approved publisher hosts and authority"
                )
            receipt = {
                "executed": False,
                "source_validation": "not_run",
                "operation": "capture",
            }
            if args.execute:
                engine = create_engine(
                    database_url_for_target(args.target),
                    connect_args=NO_PREPARED_STATEMENTS,
                )
                try:
                    with Session(engine) as db, db.begin():
                        captured = capture_source(
                            db,
                            url=args.capture_url,
                            publisher_url=args.publisher_url,
                            publisher_hosts=args.publisher_host,
                            authority=args.authority,
                        )
                        receipt = {
                            "executed": True,
                            "operation": "capture",
                            "source": capture_metadata(captured),
                            "outcome_review": "not_recorded",
                        }
                finally:
                    engine.dispose()
            print(json.dumps(receipt, indent=2))
            return 0
        request = read_request(args.request)
        receipt = {
            "executed": False,
            "source_validation": "not_run",
            "snapshot_id": request["snapshot_id"],
            "race_id": request["race_id"],
            "decision": request["decision"],
        }
        if args.execute:
            receipt = execute_request(request, args.target)
    except (ComparisonImportError, ValueError, TypeError) as error:
        print(f"Outcome review not recorded: {error}", file=sys.stderr)
        return 2
    except SQLAlchemyError:
        print(
            "Outcome review not recorded: Database operation failed; no success receipt was issued",
            file=sys.stderr,
        )
        return 2
    print(json.dumps(receipt, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
