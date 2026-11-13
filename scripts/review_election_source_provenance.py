#!/usr/bin/env python3
"""Prepare or explicitly review private local source provenance.

Dry by default. ``prepare`` turns an exact retained collector record into a
proposed acquisition receipt and never approves anything. ``review`` validates a
request; only ``--execute`` appends one provenance decision (checked or
withdrawn) through the existing target connection. It never records a source,
identity, account, source reading, version or publication. No collector or
network code exists here. The private evidence file is read separately as exact
bytes; its path is never stored or treated as proof.
"""

from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from sqlalchemy import create_engine  # noqa: E402
from sqlalchemy.exc import SQLAlchemyError  # noqa: E402
from sqlalchemy.orm import Session  # noqa: E402

from alethical.db.session import NO_PREPARED_STATEMENTS, database_url_for_target  # noqa: E402
from alethical.pipeline import election_source_provenance as provenance  # noqa: E402
from alethical.pipeline.election_comparison import ComparisonImportError  # noqa: E402
from alethical.pipeline.election_source_files import (  # noqa: E402
    SourceFileError,
    SourceFileLimitError,
)
from alethical.pipeline.raw_file_store import raw_file_store_from_env  # noqa: E402

REQUEST_FIELDS = {
    "receipt",
    "decision",
    "reviewed_by",
    "reason",
    "expected_previous_id",
}


def read_bounded(path, limit):
    try:
        provenance.require(
            path.is_file() and path.stat().st_size <= limit,
            "Input file is absent or exceeds its bound",
        )
        with path.open("rb") as handle:
            body = handle.read(limit + 1)
    except OSError as exc:
        raise ComparisonImportError("Cannot read bounded input file") from exc
    provenance.require(0 < len(body) <= limit, "Input file is empty or grew")
    return body


def read_json(path):
    return provenance.parse_json(
        read_bounded(path, provenance.MAX_RECEIPT + 64 * 1024),
        limit=provenance.MAX_RECEIPT + 64 * 1024,
    )


def read_request(path):
    request = read_json(path)
    provenance.require(
        isinstance(request, dict) and set(request) == REQUEST_FIELDS,
        "Unsupported provenance review request",
    )
    provenance.validate_receipt(request["receipt"])
    provenance.require(
        request["decision"] in {"checked", "withdrawn"}
        and provenance.text_value(request["reviewed_by"], limit=500)
        and provenance.text_value(request["reason"], limit=8000),
        "Provenance review needs explicit private review details",
    )
    previous = request["expected_previous_id"]
    provenance.require(
        previous is None or (type(previous) is int and previous > 0),
        "Invalid expected provenance predecessor",
    )
    return request


def check_evidence(request, evidence):
    """Exact private bytes for a checked acquisition; never a path as proof."""
    receipt = request["receipt"]
    if receipt["schema"] != provenance.ACQUISITION:
        provenance.require(
            evidence is None, "Recipient roots carry no capture evidence"
        )
        return None
    if evidence is None:
        provenance.require(
            request["decision"] == "withdrawn",
            "Checked acquisition review needs its exact private evidence file",
        )
        return None
    body = read_bounded(evidence, provenance.MAX_EVIDENCE)
    record = provenance.select_record(
        provenance.parse_json(body), receipt["evidence_locator"]["pointer"]
    )
    observed = provenance.observe_record(record)
    provenance.require(
        hashlib.sha256(body).hexdigest() == receipt["evidence_sha256"]
        and observed["requested_url"] == receipt["requested"]["url"]
        and observed["hops"] == receipt["observed_hops"],
        "Evidence file differs from the receipt's retained record",
    )
    return body


def execute_request(request, evidence, target):
    engine = create_engine(
        database_url_for_target(target),
        connect_args=NO_PREPARED_STATEMENTS,
        isolation_level="READ COMMITTED",
    )
    try:
        with Session(engine) as db, db.begin():
            row = provenance.record_provenance(
                db, raw_file_store_from_env(), evidence_body=evidence, **request
            )
            head = provenance.provenance_heads(db, [row.receipt_sha256])[
                row.receipt_sha256
            ]
            return {
                "executed": True,
                "decision": row.decision,
                "decision_id": row.id,
                "created": row.created,
                "receipt_sha256": row.receipt_sha256,
                "current_decision_id": head["decision_id"],
                "history_status": "current"
                if head["decision_id"] == row.id
                else "superseded",
                "source_validation": "private_evidence_and_retained_originals_replayed"
                if row.decision == "checked"
                else "prior_provenance_withdrawn",
                "sources": "not_changed",
                "identity_review": "not_recorded",
                "publication": "not_changed",
            }
    finally:
        engine.dispose()


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)
    prepare = commands.add_parser("prepare")
    prepare.add_argument("--evidence", type=Path, required=True)
    prepare.add_argument("--pointer", default="")
    prepare.add_argument("--body-capture", type=Path)
    prepare.add_argument("--output", type=Path, required=True)
    review = commands.add_parser("review")
    review.add_argument("--request", type=Path, required=True)
    review.add_argument("--evidence", type=Path)
    review.add_argument("--execute", action="store_true")
    review.add_argument("--target", choices=("local", "production"), default="local")
    args = parser.parse_args(argv)
    try:
        if args.command == "prepare":
            body_capture = read_json(args.body_capture) if args.body_capture else None
            receipt = provenance.prepare_acquisition(
                read_bounded(args.evidence, provenance.MAX_EVIDENCE),
                args.pointer,
                body_capture=body_capture,
            )
            with args.output.open("x", encoding="utf-8") as handle:
                json.dump(receipt, handle, ensure_ascii=False, indent=2)
                handle.write("\n")
            result = {
                "executed": False,
                "operation": "prepared_acquisition_proposal",
                "receipt_sha256": provenance.receipt_id(receipt),
                "capture_kind": receipt["capture_kind"],
                "source_validation": "not_approved",
                "publication": "not_changed",
            }
        else:
            request = read_request(args.request)
            evidence = check_evidence(request, args.evidence)
            result = {
                "executed": False,
                "source_validation": "request_shape_and_evidence_record_only",
                "receipt_sha256": provenance.receipt_id(request["receipt"]),
                "subject_key": provenance.subject_key(request["receipt"]),
                "identity_review": "not_recorded",
                "publication": "not_changed",
            }
            if args.execute:
                result = execute_request(request, evidence, args.target)
    except SourceFileLimitError:
        print(
            "Source provenance not recorded: source file capacity is busy; retry later",
            file=sys.stderr,
        )
        return 75
    except (
        ComparisonImportError,
        SourceFileError,
        OSError,
        TypeError,
        ValueError,
    ) as exc:
        print(f"Source provenance not recorded: {exc}", file=sys.stderr)
        return 2
    except SQLAlchemyError:
        print(
            "Source provenance not recorded: Database operation failed", file=sys.stderr
        )
        return 2
    print(json.dumps(result, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
