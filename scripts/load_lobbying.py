#!/usr/bin/env python3
"""Load the Board's active lobbyists and expenditures as one checked pair.

Net: a dry run writes nothing to the database or file store. An approved run
publishes both copies atomically, retaining only names and associations from the
active list. The existing expenditure validation and raw-file store still apply.
"""

from __future__ import annotations

import argparse
import os
import sys
from pathlib import Path

from sqlalchemy import create_engine
from sqlalchemy.orm import Session

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from alethical.db.session import (  # noqa: E402
    NO_PREPARED_STATEMENTS,
    database_url_for_target,
    normalize_database_url,
)
from alethical.pipeline.lobbying_expenditures import LobbyingRefusal  # noqa: E402
from alethical.pipeline.lobbying_registrations import load_lobbying  # noqa: E402


def main() -> int:
    parser = argparse.ArgumentParser(
        description=(
            "Fetch Minnesota's current lobbyists and principal expenditures, check both, and "
            "publish one dated pair that replaces the previous pair."
        )
    )
    parser.add_argument(
        "--target",
        default=os.environ.get("ALETHICAL_DATABASE_TARGET") or "local",
        choices=("local", "production"),
        help="Which database the set is published to. Default local.",
    )
    parser.add_argument("--database-url", default=None)
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Fetch, parse and run every check, then report and write nothing — not "
        "to the database and not to the file store. Needs no storage credentials.",
    )
    parser.add_argument(
        "--publish-hash",
        default=None,
        metavar="SHA256",
        help="Publish a set the comparison checks quarantined, by naming its record "
        "hash (the 'records' line this command prints, in full). This is the "
        "intended path for a first import. Structural checks are never waived.",
    )
    parser.add_argument(
        "--publish-lobbyist-hash",
        default=None,
        metavar="SHA256",
        help="Approve the contact-free active-list record hash for initial import or a reviewed row-count change. Structural checks cannot be waived.",
    )
    parser.add_argument(
        "--safe-evidence",
        default=None,
        metavar="PATH",
        help="Write only parsed public names and associations as JSON for link proofs; no contact fields or original CSV.",
    )
    args = parser.parse_args()

    database_url = normalize_database_url(
        args.database_url or database_url_for_target(args.target)
    )
    engine = create_engine(
        database_url, echo=False, connect_args=NO_PREPARED_STATEMENTS
    )
    with Session(engine) as session:
        try:
            report = load_lobbying(
                session,
                dry_run=args.dry_run,
                publish_hash=args.publish_hash,
                publish_lobbyist_hash=args.publish_lobbyist_hash,
                log=lambda message: print(message, file=sys.stderr),
            )
        except LobbyingRefusal as refusal:
            print(f"refused: {refusal}", file=sys.stderr)
            return 1

    if args.safe_evidence:
        import json

        Path(args.safe_evidence).write_text(
            json.dumps(report.active.safe_json(), indent=2), encoding="utf-8"
        )
    print(report.summary())
    if report.refusal:
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
