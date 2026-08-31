#!/usr/bin/env python3
"""Add only fully proven missing member rows to existing House roll calls (#540).

Dry-run by default. This command cannot replace an event, change a tally, delete a
member vote, or alter an existing member's vote. A write requires a complete JSON
backup of every selected event before the first database change.
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path
import re
import time
import uuid

import requests
from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session

from alethical.db.session import NO_PREPARED_STATEMENTS, database_url_for_target
from alethical.db.models import Legislator
from alethical.pipeline.votes import (
    backup_incomplete_vote_records,
    repair_incomplete_vote_records,
    write_json_report,
)


ISSUE_540_MEMBER_KEYS = {"15301", "15610", "15576", "15620"}


def issue_540_legislator_ids(db: Session) -> set[uuid.UUID]:
    """Resolve the 4 official member numbers this repair is allowed to add."""
    found: dict[str, uuid.UUID] = {}
    for legislator in db.scalars(select(Legislator)).all():
        match = re.search(r"(\d+)\s*$", legislator.external_key or "")
        if match is None or match.group(1) not in ISSUE_540_MEMBER_KEYS:
            continue
        member_key = match.group(1)
        if member_key in found:
            raise RuntimeError(
                f"More than 1 legislator has official member id {member_key}"
            )
        found[member_key] = legislator.id
    missing = ISSUE_540_MEMBER_KEYS - found.keys()
    if missing:
        raise RuntimeError(f"Missing official legislator member ids: {sorted(missing)}")
    return set(found.values())


class PacedSourceSession:
    """Keep this one-time official-source pass serial and gently paced."""

    def __init__(self, interval_seconds: float = 0.5) -> None:
        self._session = requests.Session()
        self._interval_seconds = interval_seconds
        self._last_started = 0.0

    def get(self, url: str, **kwargs):  # noqa: ANN201
        wait = self._last_started + self._interval_seconds - time.monotonic()
        if wait > 0:
            time.sleep(wait)
        self._last_started = time.monotonic()
        return self._session.get(url, **kwargs)

    def close(self) -> None:
        self._session.close()


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--target", choices=("local", "production"), required=True)
    parser.add_argument("--write", action="store_true")
    parser.add_argument("--backup-path", type=Path)
    parser.add_argument("--report-path", type=Path)
    parser.add_argument("--max-missing", type=int, default=4)
    parser.add_argument("--event-id", action="append", type=uuid.UUID, default=None)
    args = parser.parse_args()
    if args.write and args.backup_path is None:
        parser.error("--write requires --backup-path")
    if args.max_missing < 1:
        parser.error("--max-missing must be at least 1")

    engine = create_engine(
        database_url_for_target(args.target),
        pool_pre_ping=True,
        connect_args=NO_PREPARED_STATEMENTS,
    )
    source = PacedSourceSession()
    try:
        with Session(engine) as db:
            allowed_legislator_ids = issue_540_legislator_ids(db)
            if args.backup_path is not None:
                write_json_report(
                    args.backup_path,
                    backup_incomplete_vote_records(
                        db,
                        max_missing=args.max_missing,
                        event_ids=args.event_id,
                    ),
                )
            report = repair_incomplete_vote_records(
                db,
                dry_run=not args.write,
                allowed_legislator_ids=allowed_legislator_ids,
                source_session=source,
                max_missing=args.max_missing,
                event_ids=args.event_id,
            )
    finally:
        source.close()

    payload = {
        "target": args.target,
        "write": args.write,
        **report.to_dict(),
    }
    print(json.dumps(payload, indent=2, sort_keys=True))
    if args.report_path is not None:
        write_json_report(args.report_path, payload)
    return 1 if report.rejected or report.failed else 0


if __name__ == "__main__":
    raise SystemExit(main())
