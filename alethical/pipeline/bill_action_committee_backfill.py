"""Bounded historical committee-link recovery from retained official XML.

No name matching, ingestion, or publication. A plan identifies one bill and keeps
all before values. Apply re-plans under short write-excluding locks, changes only
committee_id, and fsyncs an exclusive receipt BEFORE the caller commits. Rollback
requires the exact written row version, so it cannot undo a later writer's work.
The CLI owns transaction boundaries; these helpers never commit.
"""

from __future__ import annotations

import hashlib
import json
import os
from collections import Counter, defaultdict
from datetime import UTC, datetime
from pathlib import Path
from typing import cast
from urllib.parse import urlsplit
from uuid import UUID

from sqlalchemy import literal_column, select, text

from alethical.db.models import ArtifactType, Bill, BillAction, Chamber, SourceArtifact
from alethical.pipeline.bill_action_committees import resolve
from alethical.pipeline.minnesota import parse_bill_xml, parse_datetime

MAX_XML_BYTES = 2_000_000
MAX_ACTIONS = 2000


def encode(value):
    if isinstance(value, datetime):
        return value.astimezone(UTC).isoformat()
    if isinstance(value, UUID):
        return str(value)
    if hasattr(value, "value"):
        return value.value
    return value


def before(row):
    return {
        column.name: encode(getattr(row, column.name))
        for column in row.__table__.columns
    }


def version(db, table, key):
    # Table names are internal constants, never command-line input.
    if table not in {"bill", "bill_action", "source_artifact", "committee"}:
        raise ValueError("unsupported table")
    return db.scalar(
        text(f"SELECT xmin::text FROM {table} WHERE id = :id"), {"id": key}
    )


def official(url):
    parsed = urlsplit(url)
    if (
        parsed.scheme != "https"
        or parsed.netloc != "www.revisor.mn.gov"
        or parsed.path != "/bills/status_result.php"
        or parsed.fragment
    ):
        raise ValueError("expected held official Revisor bill-status XML address")
    return url


def write_evidence(path, value):
    """Never overwrite evidence; sync bytes and parent directory before DB commit."""
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("x", encoding="utf-8") as out:
        json.dump(value, out, sort_keys=True, indent=2)
        out.write("\n")
        out.flush()
        os.fsync(out.fileno())
    descriptor = os.open(path.parent, os.O_RDONLY)
    try:
        os.fsync(descriptor)
    finally:
        os.close(descriptor)


def plan_bill(db, bill, xml_text, chambers, *, source_url=None):
    """Return exact proposed fills and skipped/conflicting row counts; write nothing."""
    if len(xml_text.encode("utf-8")) > MAX_XML_BYTES:
        raise ValueError("XML exceeds bounded source size")
    parsed = parse_bill_xml(xml_text)
    if parsed["bill_key"] != bill.bill_key:
        return [], Counter(source_bill_mismatch=1)
    selected = list(
        db.execute(
            select(BillAction, literal_column("bill_action.xmin::text"))
            .where(BillAction.bill_id == bill.id)
            .order_by(BillAction.id)
            .limit(MAX_ACTIONS + 1)
        )
    )
    rows = [row for row, _ in selected]
    row_versions = {row.id: stamp for row, stamp in selected}
    if len(rows) > MAX_ACTIONS:
        raise ValueError("bill exceeds bounded action count")
    source = defaultdict(list)
    parsed_actions = cast(dict[str, list[dict[str, str]]], parsed["actions"])
    for slug, actions in parsed_actions.items():
        for action in actions:
            number = action.get("action_number", "")
            if number.isdigit():
                source[(slug, int(number))].append(action)
    counts = Counter()
    stored = Counter((row.chamber_id, row.action_number) for row in rows)
    fills = []
    artifacts = {}
    committee_matches = {}
    versions = {}

    def held_version(table, key):
        if (table, key) not in versions:
            versions[(table, key)] = version(db, table, key)
        return versions[(table, key)]

    for row in rows:
        slug = chambers.get(row.chamber_id)
        matches = source[(slug, row.action_number)]
        if row.source_artifact_id not in artifacts:
            artifacts[row.source_artifact_id] = (
                db.get(SourceArtifact, row.source_artifact_id)
                if row.source_artifact_id
                else None
            )
        artifact = artifacts[row.source_artifact_id]
        state = None
        if not slug:
            state = "missing_chamber"
        elif stored[(row.chamber_id, row.action_number)] != 1:
            state = "stored_action_ambiguous"
        elif len(matches) != 1:
            state = "source_action_missing_or_ambiguous"
        elif artifact is None or artifact.artifact_type != ArtifactType.xml:
            state = "missing_xml_artifact"
        elif source_url and artifact.source_url != source_url:
            state = "source_address_changed"
        else:
            official(artifact.source_url)
            action = matches[0]
            if (
                action.get("action_text", "") != row.action_text
                or parse_datetime(action.get("action_date")) != row.action_at
                or (action.get("committee_name") or None) != row.committee_name
            ):
                state = "source_row_changed"
            else:
                code = action.get("committee_id") or None
                identity = (row.chamber_id, code)
                if identity not in committee_matches:
                    committee_matches[identity] = resolve(
                        db,
                        session_id=bill.session_id,
                        chamber_id=row.chamber_id,
                        source_id=code,
                    )
                found = committee_matches[identity]
                if found.state != "matched":
                    state = found.state
                elif row.committee_id:
                    state = (
                        "already_set"
                        if row.committee_id == found.committee_id
                        else "conflicting_value_kept"
                    )
                else:
                    state = "would_fill"
                    fills.append(
                        {
                            "before": before(row),
                            "row_version": row_versions[row.id],
                            "source_code": code,
                            "committee_id": str(found.committee_id),
                            "committee_version": held_version(
                                "committee", found.committee_id
                            ),
                            "artifact": before(artifact),
                            "artifact_version": held_version(
                                "source_artifact", artifact.id
                            ),
                        }
                    )
        counts[state] += 1
    return fills, counts


def plan(db, bill_key, xml_text, source_url):
    official(source_url)
    bill = db.scalar(select(Bill).where(Bill.bill_key == bill_key))
    if bill is None:
        raise ValueError("bill is not held")
    fills, counts = plan_bill(
        db,
        bill,
        xml_text,
        {row.id: row.slug for row in db.scalars(select(Chamber))},
        source_url=source_url,
    )
    return {
        "format": 1,
        "bill": before(bill),
        "bill_version": version(db, "bill", bill.id),
        "source_url": source_url,
        "xml_sha256": hashlib.sha256(xml_text.encode("utf-8")).hexdigest(),
        "database": db.scalar(text("SELECT current_database()")),
        "counts": dict(counts),
        "fills": fills,
    }


def lock(db):
    # One bill only. Block competing inserts as well as edits while validating;
    # never wait indefinitely behind ingestion. All locks end with this transaction.
    db.execute(text("SET LOCAL lock_timeout = '3s'"))
    db.execute(text("SET LOCAL statement_timeout = '15s'"))
    db.execute(
        text("LOCK TABLE bill, chamber, committee, source_artifact IN SHARE MODE")
    )
    db.execute(text("LOCK TABLE bill_action IN SHARE ROW EXCLUSIVE MODE"))
    db.expire_all()


def apply(db, saved_plan, xml_text, receipt):
    lock(db)
    current = plan(
        db, saved_plan["bill"]["bill_key"], xml_text, saved_plan["source_url"]
    )
    if current != saved_plan:
        raise ValueError(
            "saved plan no longer matches rows or source; make a new dry run"
        )
    payload = [
        {
            "id": fill["before"]["id"],
            "committee_id": fill["committee_id"],
            "version": fill["row_version"],
        }
        for fill in current["fills"]
    ]
    # One bounded update, not one network round trip per action. Raw SQL keeps
    # ORM onupdate from touching updated_at.
    updated = dict(
        db.execute(
            text("""UPDATE bill_action AS action SET committee_id = proposed.committee_id
        FROM jsonb_to_recordset(CAST(:rows AS jsonb)) AS proposed(id uuid, committee_id uuid, version text)
        WHERE action.id = proposed.id AND action.committee_id IS NULL AND action.xmin::text = proposed.version
        RETURNING action.id, action.xmin::text"""),
            {"rows": json.dumps(payload)},
        ).all()
    )
    if len(updated) != len(payload):
        raise ValueError("action changed during apply")
    written = [
        {**fill, "after_version": updated[UUID(fill["before"]["id"])]}
        for fill in current["fills"]
    ]
    evidence = {
        "format": 1,
        "database": current["database"],
        "prepared_at": datetime.now(UTC).isoformat(),
        "note": "Prepared before commit; verify each written row version before undo",
        "plan": saved_plan,
        "written": written,
    }
    write_evidence(receipt, evidence)
    return {"filled": len(written)}


def rollback(db, receipt, rollback_receipt):
    lock(db)
    if receipt["database"] != db.scalar(text("SELECT current_database()")):
        raise ValueError("receipt names another database")
    if len(receipt["written"]) > MAX_ACTIONS:
        raise ValueError("receipt exceeds action count bound")
    keys = [UUID(entry["before"]["id"]) for entry in receipt["written"]]
    if len(set(keys)) != len(keys):
        raise ValueError("receipt repeats an action")
    held = {
        row.id: (row, stamp)
        for row, stamp in db.execute(
            select(BillAction, literal_column("bill_action.xmin::text")).where(
                BillAction.id.in_(keys)
            )
        )
    }
    counts = Counter()
    payload = []
    for entry in receipt["written"]:
        prior = entry["before"]
        row, stamp = held.get(UUID(prior["id"]), (None, None))
        expected = {**prior, "committee_id": entry["committee_id"]}
        if row is None or before(row) != expected or stamp != entry["after_version"]:
            counts["changed_since_kept"] += 1
            continue
        if prior["committee_id"] is not None:
            raise ValueError("receipt is not a null-link recovery")
        payload.append(
            {
                "id": prior["id"],
                "committee_id": entry["committee_id"],
                "version": entry["after_version"],
            }
        )
    updated = db.execute(
        text("""UPDATE bill_action AS action SET committee_id = NULL
        FROM jsonb_to_recordset(CAST(:rows AS jsonb)) AS proposed(id uuid, committee_id uuid, version text)
        WHERE action.id = proposed.id AND action.committee_id = proposed.committee_id AND action.xmin::text = proposed.version
        RETURNING action.id, action.xmin::text"""),
        {"rows": json.dumps(payload)},
    ).all()
    if len(updated) != len(payload):
        raise ValueError("action changed during rollback")
    if updated:
        counts["cleared"] = len(updated)
    restored = [
        {"action_id": str(key), "restored_version": stamp} for key, stamp in updated
    ]
    write_evidence(
        rollback_receipt,
        {
            "database": receipt["database"],
            "prepared_at": datetime.now(UTC).isoformat(),
            "counts": dict(counts),
            "restored": restored,
        },
    )
    return dict(counts)
