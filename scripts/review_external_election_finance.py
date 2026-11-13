#!/usr/bin/env python3
"""Stage external originals or record explicit reviews; dry by default.

Dry review checks request shape only, never source truth. Trusted source adapters
must be registered by application code before executing any checked claim. No
input module name, OCR result or operator JSON can install an adapter.
"""

from __future__ import annotations

import argparse
from datetime import date
import inspect
import json
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from alethical.pipeline import election_external_finance as storage  # noqa: E402
from alethical.pipeline.election_account_reviews import record_decision  # noqa: E402
from scripts.review_election_account import _object, _invalid_constant  # noqa: E402


def read_json(path):
    return json.loads(
        path.read_text(encoding="utf-8"),
        object_pairs_hook=_object,
        parse_constant=_invalid_constant,
    )


def review_request(path):
    request = read_json(path)
    fields = inspect.signature(record_decision).parameters
    allowed = set(fields) - {"db"}
    required = {
        k
        for k, v in fields.items()
        if k != "db" and v.default is inspect.Parameter.empty
    }
    storage.require(
        isinstance(request, dict)
        and not (set(request) - allowed or required - set(request)),
        "Review request fields differ from the review contract",
    )
    storage.require(
        request.get("authority", "mn_cfb") != "mn_cfb"
        and (
            request.get("authority") == "fec"
            or request.get("authority", "").startswith("local:")
        ),
        "This command requires an exact external authority",
    )
    storage.require(
        request["decision"] in {"confirmed", "rejected", "withdrawn"},
        "A proposal is not a review decision",
    )
    for key in ("snapshot_id", "race_id"):
        storage.require(
            storage.fingerprint(request[key]),
            "Review requires complete source fingerprints",
        )
    for key in ("period_start", "period_end"):
        request[key] = date.fromisoformat(request[key])
    storage.require(
        request["period_start"] <= request["period_end"], "Review dates are reversed"
    )
    storage.require(
        isinstance(request["evidence"], list) and request["evidence"],
        "Review needs retained evidence",
    )
    return request


def register_builtin_adapters():
    """Only reviewed, fixed application adapters may execute source claims."""
    from alethical.pipeline.election_external_adapters import register_external_adapters

    register_external_adapters()


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)
    stage = commands.add_parser("stage")
    stage.add_argument("--input", type=Path, required=True)
    stage.add_argument("--original-manifest", type=Path, required=True)
    stage.add_argument("--source-directory", type=Path, required=True)
    review = commands.add_parser("review")
    review.add_argument("--input", type=Path, required=True)
    publish = commands.add_parser("publish")
    publish.add_argument("--generation", required=True)
    previous = publish.add_mutually_exclusive_group(required=True)
    previous.add_argument("--expected-current")
    previous.add_argument("--expect-empty", action="store_true")
    publish.add_argument("--restore", action="store_true")
    for command in (stage, review, publish):
        command.add_argument("--execute", action="store_true")
        command.add_argument(
            "--target", choices=("local", "production"), default="local"
        )
    args = parser.parse_args(argv)
    originals = {}
    if args.command == "stage":
        value = read_json(args.input)
        storage.validate_generation(value)
        for entry in read_json(args.original_manifest):
            filename = entry["file"]
            storage.require(
                Path(filename).name == filename,
                "Original manifest path escapes source folder",
            )
            path = (args.source_directory / filename).resolve()
            storage.require(
                path.parent == args.source_directory.resolve(),
                "Original source escapes its folder",
            )
            storage.require(
                entry["sha256"] not in originals, "Duplicate original source"
            )
            originals[entry["sha256"]] = path.read_bytes()
    elif args.command == "review":
        value = review_request(args.input)
    else:
        storage.require(
            storage.fingerprint(args.generation)
            and (
                args.expected_current is None
                or storage.fingerprint(args.expected_current)
            ),
            "Publication needs exact generation fingerprints",
        )
    if not args.execute:
        print(
            json.dumps(
                {
                    "operation": args.command,
                    "executed": False,
                    "validation": "request_shape_only"
                    if args.command == "review"
                    else "prepared_shape_only",
                    "target": args.target,
                }
            )
        )
        return 0
    register_builtin_adapters()
    from sqlalchemy import create_engine
    from sqlalchemy.orm import Session
    from alethical.db.session import database_url_for_target, NO_PREPARED_STATEMENTS
    from alethical.pipeline.raw_file_store import raw_file_store_from_env
    from alethical.pipeline.campaign_finance_refresh import (
        hold_full_run_lease_until_exit,
    )

    engine = create_engine(
        database_url_for_target(args.target), connect_args=NO_PREPARED_STATEMENTS
    )
    try:
        if not hold_full_run_lease_until_exit(
            engine, purpose="explicit external election finance evidence review"
        ):
            return 1
        with Session(engine) as db:
            if args.command == "stage":
                result = {
                    "generation_id": storage.stage_generation(
                        db, raw_file_store_from_env(), value, originals
                    )
                }
            elif args.command == "review":
                row = record_decision(db, **value)
                result = {"decision_id": row.id, "decision": row.decision}
            else:
                result = storage.publish_generation(
                    db,
                    raw_file_store_from_env(),
                    args.generation,
                    expected_previous=args.expected_current,
                    restore=args.restore,
                )
            db.commit()
        print(json.dumps({"operation": args.command, "executed": True, **result}))
    finally:
        engine.dispose()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
