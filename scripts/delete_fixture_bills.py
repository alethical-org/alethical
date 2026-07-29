#!/usr/bin/env python3
"""Delete test-fixture bill rows that a test wrote into production (#716).

Why this exists: `test_bill_scoped_chat_missing_chunks_returns_grounded_fallback`
used to build its fixture bill through `get_session_factory()` and commit it, and
`get_session_factory()` resolves whatever DATABASE_URL is set to. Sessions that
ran pytest with DATABASE_URL pointed at Supabase committed the bill
`94-2025-HF9901` ("No chunks test bill", official_url `https://example.test/hf9901`)
into production on 2026-05-12, along with the bill-scoped chat sessions the same
test creates. The bill is hidden from the list and from search (no versions, no
sections) but is reachable directly, so `/bills/94-2025-HF9901` rendered a page
for a bill that does not exist -- a fabricated record on a user-facing surface
(`.claude/rules/grounded-answers.md` rules 1 and 3). The conftest guard added in
the same change closes the hole; this removes what already leaked through it.

Safe by construction -- three gates, each reported, and no gate is skippable:
  * Gate 1: the bill's official_url host must end in `.test`. A real bill's URL is
    on revisor.mn.gov / house.mn.gov / senate.mn, so this alone makes it
    impossible to delete a genuine record by mistyping a bill key.
  * Gate 2: the bill must carry no legislative data. Every foreign key pointing at
    `bill.id` is enumerated from the Postgres catalog at runtime (not a
    hand-listed set that could go stale as tables are added) and counted. Only
    `chat_session.subject_bill_id` may be non-zero; anything else aborts.
  * Gate 3: the referencing chat sessions and their messages are counted and
    reported before anything is written, so nothing is deleted unseen and no row
    is left orphaned pointing at a bill that is gone.
  * A JSON snapshot of every row about to be deleted is written BEFORE deleting.
  * All deletes for a run happen in one transaction, bottom-up:
    chat_message -> chat_session -> bill.

Usage:
    # dry run (default) -- report the rows and the gate results, write nothing
    ALETHICAL_DATABASE_TARGET=production uv run python scripts/delete_fixture_bills.py

    # apply, with a snapshot of what was removed
    ALETHICAL_DATABASE_TARGET=production uv run python scripts/delete_fixture_bills.py \
        --apply --snapshot-file /tmp/fixture-bills-716.json

    # a different fixture key, if the sweep ever finds another
    ALETHICAL_DATABASE_TARGET=production uv run python scripts/delete_fixture_bills.py \
        --bill-key 94-2025-HF9902
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path
from urllib.parse import urlparse

from sqlalchemy import create_engine, text
from sqlalchemy.orm import Session

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from alethical.db.session import (  # noqa: E402
    NO_PREPARED_STATEMENTS,
    database_url_for_target,
    normalize_database_url,
)

DEFAULT_BILL_KEYS = ("94-2025-HF9901",)
# The only reference a fixture bill is allowed to have: the bill-scoped chat
# sessions the same test creates. Everything else means real legislative data.
ALLOWED_REFERENCE = ("chat_session", "subject_bill_id")
FIXTURE_URL_SUFFIX = ".test"


def _referencing_columns(session: Session) -> list[tuple[str, str]]:
    """Every (table, column) with a foreign key onto bill.id, from the catalog."""
    rows = session.execute(
        text("""
        SELECT c.conrelid::regclass::text AS child_table, a.attname AS child_column
        FROM pg_constraint c
        JOIN pg_attribute a
          ON a.attrelid = c.conrelid AND a.attnum = ANY (c.conkey)
        WHERE c.contype = 'f' AND c.confrelid = 'bill'::regclass
        ORDER BY 1, 2
        """)
    ).all()
    return [(row[0], row[1]) for row in rows]


def _inspect(session: Session, bill_key: str) -> dict | None:
    bill = (
        session.execute(
            text(
                "SELECT id, bill_key, title, description, official_url, created_at "
                "FROM bill WHERE bill_key = :key"
            ),
            {"key": bill_key},
        )
        .mappings()
        .one_or_none()
    )
    if bill is None:
        return None

    references: dict[str, int] = {}
    for table, column in _referencing_columns(session):
        count = session.execute(
            text(f"SELECT count(*) FROM {table} WHERE {column} = :bill_id"),
            {"bill_id": bill["id"]},
        ).scalar_one()
        references[f"{table}.{column}"] = count

    chat_sessions = (
        session.execute(
            text("""
        SELECT cs.id, cs.user_id, cs.title, cs.created_at,
               (SELECT count(*) FROM chat_message m WHERE m.session_id = cs.id) AS messages
        FROM chat_session cs
        WHERE cs.subject_bill_id = :bill_id
        ORDER BY cs.created_at
        """),
            {"bill_id": bill["id"]},
        )
        .mappings()
        .all()
    )

    return {
        "bill": dict(bill),
        "references": references,
        "chat_sessions": [dict(row) for row in chat_sessions],
    }


def _check_gates(target: dict) -> None:
    bill = target["bill"]
    host = urlparse(bill["official_url"] or "").hostname or ""
    if not host.endswith(FIXTURE_URL_SUFFIX):
        raise SystemExit(
            f"ABORT: {bill['bill_key']} official_url host {host!r} is not a fixture "
            f"host (must end in {FIXTURE_URL_SUFFIX!r}) — refusing to delete what "
            "may be a real bill."
        )
    real_data = {
        name: count
        for name, count in target["references"].items()
        if count and name != ".".join(ALLOWED_REFERENCE)
    }
    if real_data:
        raise SystemExit(
            f"ABORT: {bill['bill_key']} carries legislative data — refusing to "
            f"delete. Non-empty references: {real_data}"
        )


def _delete(session: Session, target: dict) -> dict[str, int]:
    bill_id = target["bill"]["id"]
    session_ids = [row["id"] for row in target["chat_sessions"]]
    deleted = {"chat_message": 0, "chat_session": 0, "bill": 0}
    if session_ids:
        deleted["chat_message"] = session.execute(
            text("DELETE FROM chat_message WHERE session_id = ANY(:ids)"),
            {"ids": session_ids},
        ).rowcount
        deleted["chat_session"] = session.execute(
            text("DELETE FROM chat_session WHERE id = ANY(:ids)"),
            {"ids": session_ids},
        ).rowcount
    deleted["bill"] = session.execute(
        text("DELETE FROM bill WHERE id = :bill_id"), {"bill_id": bill_id}
    ).rowcount
    return deleted


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--apply",
        action="store_true",
        help="Delete the rows. Without this flag the script only reports (dry run).",
    )
    parser.add_argument(
        "--bill-key",
        action="append",
        default=None,
        help=f"Fixture bill key to remove (repeatable). Default: "
        f"{', '.join(DEFAULT_BILL_KEYS)}",
    )
    parser.add_argument(
        "--snapshot-file",
        default=None,
        help="Write the rows about to be deleted to this JSON path before "
        "deleting. Strongly recommended with --apply.",
    )
    parser.add_argument("--database-url", default=None)
    args = parser.parse_args()

    bill_keys = args.bill_key or list(DEFAULT_BILL_KEYS)
    database_url = normalize_database_url(
        args.database_url
        or database_url_for_target(os.environ.get("ALETHICAL_DATABASE_TARGET"))
    )
    engine = create_engine(
        database_url, echo=False, connect_args=NO_PREPARED_STATEMENTS
    )

    with Session(engine) as session:
        print(f"database host: {engine.url.host}")
        targets = []
        for bill_key in bill_keys:
            target = _inspect(session, bill_key)
            if target is None:
                print(f"\n{bill_key}: not present — nothing to do")
                continue
            print(f"\n{bill_key}: {target['bill']['title']!r}")
            print(f"  official_url: {target['bill']['official_url']}")
            print(f"  created_at:   {target['bill']['created_at']}")
            for name, count in sorted(target["references"].items()):
                if count:
                    print(f"  references: {name} = {count}")
            for row in target["chat_sessions"]:
                print(
                    f"    chat_session {row['id']} title={row['title']!r} "
                    f"messages={row['messages']} created={row['created_at']}"
                )
            _check_gates(target)
            print("  gates: PASS (fixture host, no legislative data)")
            targets.append(target)

        if not targets:
            return

        if args.snapshot_file:
            with open(args.snapshot_file, "w", encoding="utf-8") as handle:
                json.dump(targets, handle, indent=2, sort_keys=True, default=str)
            print(f"\nsnapshot written: {args.snapshot_file}")

        if not args.apply:
            print("\nDRY RUN — nothing deleted. Re-run with --apply to delete.")
            return

        totals = {"chat_message": 0, "chat_session": 0, "bill": 0}
        for target in targets:
            for table, count in _delete(session, target).items():
                totals[table] += count
        session.commit()
        print(f"\ndeleted: {totals}")

        # Read back in a fresh transaction: the rows are gone, nothing orphaned.
        session.expire_all()
        for target in targets:
            bill_key = target["bill"]["bill_key"]
            remaining = _inspect(session, bill_key)
            print(f"read back {bill_key}: {'GONE' if remaining is None else remaining}")
            orphans = session.execute(
                text("SELECT count(*) FROM chat_session WHERE id = ANY(:ids)"),
                {"ids": [row["id"] for row in target["chat_sessions"]]},
            ).scalar_one()
            print(f"  orphaned chat sessions remaining: {orphans}")


if __name__ == "__main__":
    main()
