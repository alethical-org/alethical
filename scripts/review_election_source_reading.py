#!/usr/bin/env python3
"""Prepare local PDF observations or explicitly review listed source cells.

Dry by default. Preparation never approves data. Review execution records only a
source reading, never a candidate/account link, generation or publication.
No source acquisition or OCR exists in this command.
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from sqlalchemy import create_engine  # noqa: E402
from sqlalchemy.exc import SQLAlchemyError  # noqa: E402
from sqlalchemy.orm import Session  # noqa: E402

from alethical.db.session import database_url_for_target, NO_PREPARED_STATEMENTS  # noqa: E402
from alethical.pipeline import election_source_readings as readings  # noqa: E402
from alethical.pipeline.election_comparison import ComparisonImportError  # noqa: E402
from alethical.pipeline.raw_file_store import raw_file_store_from_env  # noqa: E402


def _object(items):
    result = {}
    for key, value in items:
        readings.require(key not in result, "Reading JSON has duplicate fields")
        result[key] = value
    return result


def _constant(value):
    raise ComparisonImportError("Reading JSON needs finite values")


def read_json(path):
    try:
        readings.require(
            path.stat().st_size <= readings.MAX_RECEIPT_BYTES,
            "Reading request is too large",
        )
        return json.loads(
            path.read_text(encoding="utf-8"),
            object_pairs_hook=_object,
            parse_constant=_constant,
        )
    except (OSError, UnicodeError, json.JSONDecodeError) as exc:
        raise ComparisonImportError(
            "Cannot read bounded UTF-8 reading request"
        ) from exc


def read_request(path):
    request = read_json(path)
    readings.require(
        isinstance(request, dict)
        and set(request)
        == {"receipt", "decision", "reviewed_by", "reason", "expected_previous_id"},
        "Unsupported source reading request",
    )
    readings.validate_receipt(request["receipt"])
    readings.require(
        request["decision"] in {"checked", "withdrawn"}
        and readings._string(request["reviewed_by"], limit=500)
        and readings._string(request["reason"], limit=8000),
        "Source reading needs explicit private review details",
    )
    previous = request["expected_previous_id"]
    readings.require(
        previous is None or type(previous) is int and previous > 0,
        "Invalid expected source reading predecessor",
    )
    return request


def execute_request(request, target):
    engine = create_engine(
        database_url_for_target(target), connect_args=NO_PREPARED_STATEMENTS
    )
    try:
        with Session(engine) as db, db.begin():
            row = readings.record_reading(db, raw_file_store_from_env(), **request)
            head = readings.reading_heads(db, [row.receipt_sha256])[row.receipt_sha256]
            return {
                "executed": True,
                "source_validation": "retained_bytes_and_listed_page_renders_checked"
                if row.decision == "checked"
                else "prior_reading_withdrawn",
                "decision_id": row.id,
                "receipt_sha256": row.receipt_sha256,
                "current_decision_id": head["decision_id"],
                "history_status": "current"
                if head["decision_id"] == row.id
                else "superseded",
                "candidate_review": "not_recorded",
                "publication": "not_changed",
            }
    finally:
        engine.dispose()


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)
    prepare = commands.add_parser("prepare")
    prepare.add_argument("--pdf", type=Path, required=True)
    prepare.add_argument("--observations", type=Path, required=True)
    prepare.add_argument("--output", type=Path, required=True)
    review = commands.add_parser("review")
    review.add_argument("--request", type=Path, required=True)
    review.add_argument("--execute", action="store_true")
    review.add_argument("--target", choices=("local", "production"), default="local")
    args = parser.parse_args(argv)
    try:
        if args.command == "prepare":
            readings.require(
                args.pdf.stat().st_size <= readings.MAX_ORIGINAL_BYTES,
                "Original PDF exceeds reading bound",
            )
            value = read_json(args.observations)
            readings.require(
                isinstance(value, dict)
                and set(value)
                == {"fields", "document_kind", "dependencies", "source_context"},
                "Unsupported source observation proposal",
            )
            receipt = readings.prepare_receipt(args.pdf.read_bytes(), **value)
            with args.output.open("x", encoding="utf-8") as handle:
                json.dump(receipt, handle, ensure_ascii=False, indent=2)
                handle.write("\n")
            result = {
                "executed": False,
                "operation": "prepared_observations",
                "receipt_sha256": readings.receipt_digest(receipt),
                "source_validation": "not_approved",
                "candidate_review": "not_recorded",
                "publication": "not_changed",
            }
        else:
            request = read_request(args.request)
            result = {
                "executed": False,
                "source_validation": "request_shape_only",
                "receipt_sha256": readings.receipt_digest(request["receipt"]),
                "candidate_review": "not_recorded",
                "publication": "not_changed",
            }
            if args.execute:
                result = execute_request(request, args.target)
    except (ComparisonImportError, OSError, TypeError, ValueError) as exc:
        print(f"Source reading not recorded: {exc}", file=sys.stderr)
        return 2
    except SQLAlchemyError:
        print("Source reading not recorded: Database operation failed", file=sys.stderr)
        return 2
    print(json.dumps(result, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
