#!/usr/bin/env python3
"""Prepare and retain scoped election-finance evidence; publication is separate.

Every command is dry by default. No command downloads public sources or confirms a
candidate-to-committee relationship. --execute is required for database/store writes.
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from alethical.pipeline import election_finance_collection as storage  # noqa: E402


def fingerprint(value):
    if not re.fullmatch(r"[a-f0-9]{64}", value):
        raise argparse.ArgumentTypeError("Expected a complete SHA256")
    return value


def prepare(args):
    return storage.prepare_collection(
        args.directory,
        roster_directory=args.roster_directory,
        directory_file=args.directory_file,
        directory_metadata=args.directory_metadata,
        identity_manifest=args.identity_manifest,
    )


def summary(collection, *, operation, executed):
    coverage = collection["coverage"]
    return {
        "operation": operation,
        "executed": executed,
        "collection_id": collection["id"],
        "election_key": collection["election_key"],
        "copied_at": collection["copied_at"],
        "sources": len(collection["sources"]),
        "coverage": {
            k: v
            for k, v in coverage.items()
            if k not in {"candidates", "requested_registrations"}
        },
    }


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)
    for name in ("prepare", "stage"):
        command = commands.add_parser(name)
        command.add_argument("--directory", type=Path, required=True)
        command.add_argument("--roster-directory", type=Path, required=True)
        command.add_argument("--directory-file", type=Path, required=True)
        command.add_argument("--directory-metadata", type=Path, required=True)
        command.add_argument("--identity-manifest", type=Path)
        command.add_argument("--output", type=Path)
        if name == "stage":
            command.add_argument("--execute", action="store_true")
            command.add_argument(
                "--target", choices=("local", "production"), default="local"
            )
    publish = commands.add_parser("publish")
    publish.add_argument("--collection", type=fingerprint, required=True)
    expected = publish.add_mutually_exclusive_group(required=True)
    expected.add_argument("--expected-current", type=fingerprint)
    expected.add_argument("--expect-empty", action="store_true")
    publish.add_argument("--restore", action="store_true")
    publish.add_argument("--execute", action="store_true")
    publish.add_argument("--target", choices=("local", "production"), default="local")
    args = parser.parse_args(argv)
    if args.command in {"prepare", "stage"}:
        collection, originals, documents = prepare(args)
        if args.output:
            args.output.write_text(
                json.dumps(collection, indent=2) + "\n", encoding="utf-8"
            )
        executed = args.command == "stage" and args.execute
        if executed:
            from sqlalchemy import create_engine
            from sqlalchemy.orm import Session
            from alethical.db.session import (
                database_url_for_target,
                NO_PREPARED_STATEMENTS,
            )
            from alethical.pipeline.raw_file_store import raw_file_store_from_env
            from alethical.pipeline.campaign_finance_refresh import (
                hold_full_run_lease_until_exit,
            )

            engine = create_engine(
                database_url_for_target(args.target),
                connect_args=NO_PREPARED_STATEMENTS,
            )
            if not hold_full_run_lease_until_exit(
                engine, purpose="retain and stage scoped election-finance evidence"
            ):
                return 1
            with Session(engine) as db:
                storage.retain_collection_sources(
                    db, raw_file_store_from_env(), collection, originals, documents
                )
                storage.stage_collection(db, collection)
                db.commit()
            engine.dispose()
        print(
            json.dumps(
                summary(collection, operation=args.command, executed=executed), indent=2
            )
        )
        return 0
    if not args.execute:
        print(
            json.dumps(
                {
                    "operation": "publish",
                    "executed": False,
                    "collection_id": args.collection,
                    "expected_previous": args.expected_current,
                    "restore": args.restore,
                    "target": args.target,
                },
                indent=2,
            )
        )
        return 0
    from sqlalchemy import create_engine
    from sqlalchemy.orm import Session
    from alethical.db.session import database_url_for_target, NO_PREPARED_STATEMENTS

    engine = create_engine(
        database_url_for_target(args.target), connect_args=NO_PREPARED_STATEMENTS
    )
    with Session(engine) as db:
        result = storage.publish_collection(
            db,
            args.collection,
            expected_previous=args.expected_current,
            restore=args.restore,
        )
        db.commit()
    engine.dispose()
    print(json.dumps({"operation": "publish", "executed": True, **result}, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
