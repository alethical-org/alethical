#!/usr/bin/env python3
"""Read-only sample of missing bill-action committee links; never applies changes.

Supply saved source bodies as <content_hash>.xml in --xml-dir. No source is
fetched. Without those bytes, metadata alone is reported as unavailable evidence.
"""

from __future__ import annotations

import argparse
from collections import Counter
import json
from pathlib import Path
import re
import sys
from typing import cast
from xml.etree.ElementTree import ParseError

from sqlalchemy import create_engine, select, text
from sqlalchemy.orm import Session

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from alethical.db.models import Bill, BillAction, Chamber, SourceArtifact  # noqa: E402
from alethical.db.session import (  # noqa: E402
    NO_PREPARED_STATEMENTS,
    database_url_for_target,
)
from alethical.pipeline.bill_action_committees import resolve  # noqa: E402
from alethical.pipeline.minnesota import content_hash, parse_bill_xml  # noqa: E402

MAX_XML_BYTES = 2_000_000


def inspect_action(db, bill, action, chamber, artifact, body):
    """Compare one historical action to its exact retained source, without writes."""
    result = {
        "bill_key": bill.bill_key,
        "action_id": str(action.id),
        "action_number": action.action_number,
        "chamber": chamber.slug if chamber else None,
        "source_url": artifact.source_url if artifact else None,
        "source_hash": artifact.content_hash if artifact else None,
        "current_committee_id": str(action.committee_id)
        if action.committee_id
        else None,
        "proposed_committee_id": None,
    }

    def finish(state):
        return {**result, "state": state}

    if artifact is None:
        return finish("missing_artifact")
    if body is None:
        return finish("source_body_unavailable")
    if content_hash(body) != artifact.content_hash:
        return finish("source_hash_mismatch")
    try:
        parsed = parse_bill_xml(body)
    except (ParseError, ValueError):
        return finish("invalid_source_xml")
    if parsed["bill_key"] != bill.bill_key:
        return finish("source_bill_mismatch")
    if chamber is None:
        return finish("missing_chamber")
    actions = cast(dict[str, list[dict[str, str]]], parsed["actions"])
    matches = [
        row
        for row in actions.get(chamber.slug, [])
        if row["action_number"].isdigit()
        and int(row["action_number"]) == action.action_number
    ]
    if len(matches) != 1:
        return finish("source_action_missing_or_ambiguous")
    match = resolve(
        db,
        session_id=bill.session_id,
        chamber_id=action.chamber_id,
        source_id=matches[0]["committee_id"],
    )
    result["proposed_committee_id"] = (
        str(match.committee_id) if match.committee_id else None
    )
    return finish(match.state)


def report(db, *, limit=20, bill_key=None, xml_dir=None):
    if not 1 <= limit <= 100:
        raise ValueError("limit must be between 1 and 100")
    query = (
        select(Bill, BillAction, Chamber, SourceArtifact)
        .join(BillAction, BillAction.bill_id == Bill.id)
        .outerjoin(Chamber, Chamber.id == BillAction.chamber_id)
        .outerjoin(SourceArtifact, SourceArtifact.id == BillAction.source_artifact_id)
        .where(
            BillAction.committee_id.is_(None), BillAction.committee_name.is_not(None)
        )
        .order_by(Bill.bill_key, BillAction.action_number, BillAction.id)
        .limit(limit)
    )
    if bill_key:
        query = query.where(Bill.bill_key == bill_key)
    rows = []
    bodies = {}
    for bill, action, chamber, artifact in db.execute(query):
        body = None
        if (
            xml_dir
            and artifact
            and re.fullmatch(r"[0-9a-f]{64}", artifact.content_hash)
        ):
            digest = artifact.content_hash
            if digest not in bodies:
                source = Path(xml_dir) / f"{digest}.xml"
                try:
                    with source.open("rb") as saved:
                        raw = saved.read(MAX_XML_BYTES + 1)
                    bodies[digest] = (
                        raw.decode("utf-8") if len(raw) <= MAX_XML_BYTES else None
                    )
                except (OSError, UnicodeError):
                    bodies[digest] = None
            body = bodies[digest]
        rows.append(inspect_action(db, bill, action, chamber, artifact, body))
    return {
        "read_only": True,
        "selection": "Named actions with no committee link; bounded sample, not total backlog",
        "limit": limit,
        "bill_key": bill_key,
        "inspected": len(rows),
        "states": dict(Counter(row["state"] for row in rows)),
        "rows": rows,
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--target", choices=("local", "production"), required=True)
    parser.add_argument("--limit", type=int, default=20, choices=range(1, 101))
    parser.add_argument("--bill-key")
    parser.add_argument("--xml-dir", type=Path)
    args = parser.parse_args()
    engine = create_engine(
        database_url_for_target(args.target), connect_args=NO_PREPARED_STATEMENTS
    )
    with Session(engine, autoflush=False) as db:
        db.execute(text("SET TRANSACTION READ ONLY"))
        db.execute(text("SET LOCAL statement_timeout = '10s'"))
        result = report(
            db, limit=args.limit, bill_key=args.bill_key, xml_dir=args.xml_dir
        )
        db.rollback()
    print(json.dumps(result, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
