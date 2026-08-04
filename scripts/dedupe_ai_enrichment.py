"""Remove the surplus AI-enrichment rows the missing unique key let in (#927).

Net: the step that saves a bill's AI summary looked its existing row up on five
details that nothing forced to be unique, so two workers in one batch could both
look, both find nothing, and both write. Production holds **2,219 pairs** where
there should be one row. This deletes the older row of each pair. Nothing a
reader sees changes -- measured, **0** of those rows is the summary anyone is
shown -- and the delete has to happen before migration ``0019`` can add the key,
because ``ADD CONSTRAINT`` will not succeed while a duplicate exists.

Dry run by default. It prints every row it would delete and writes nothing::

    ALETHICAL_DATABASE_TARGET=production PYTHONPATH=. \\
        uv run python scripts/dedupe_ai_enrichment.py

Then, in order:

``--prove-restore``
    Open one transaction, delete every doomed row, put them all back from the
    in-memory backup, read them back column by column, check the table is
    byte-for-byte where it started -- then **roll back**, so nothing was written
    either way. This is the step that earns the delete: a backup nobody has
    restored is a hope, not a backup.

``--apply --only-bill <bill_key>``
    One bill, written for real, read back from the database afterwards.

``--apply``
    The rest. Writes a full-row JSON backup first and refuses to run without one.

Restoring for real, if it ever comes to that::

    ... uv run python scripts/dedupe_ai_enrichment.py --restore-from <path>

**Why "newest".** The two rows of a pair differ in content 2,217 times out of
2,219, so which one survives is a real choice, and the newest is the one the last
enrichment run wrote. Verified first: no pair shares a ``created_at``, so "newest"
is never a tie.

**The trigger is the part worth watching.** ``ai_enrichment`` carries an
``AFTER DELETE`` trigger that recomputes ``bill.has_current_summary``, and a bill
with that flag false disappears from every list in the product. Deleting a
superseded row should not move it -- the flag counts *current* summaries and none
of these rows is current -- but "should not" is exactly the sort of thing that
turns out to be wrong, so every check below compares that column before and after
rather than reasoning about it.

Idempotent: a second run finds no duplicates and deletes nothing.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import sqlalchemy as sa
from sqlalchemy.engine import make_url

REPO_ROOT = Path(__file__).resolve().parent.parent
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from alethical.db.session import (  # noqa: E402
    NO_PREPARED_STATEMENTS,
    database_url_for_target,
)

# The five columns alethical/pipeline/ai_enrichment.py treats as identifying a
# row, and the columns migration 0019 makes unique.
KEY = "bill_id, bill_version_id, enrichment_type, model_name, source_version_hash"

COLUMNS = (
    "id",
    "bill_id",
    "legislator_id",
    "bill_version_id",
    "enrichment_type",
    "model_name",
    "content_json",
    "source_version_hash",
    "is_current",
    "created_at",
    "updated_at",
)


@dataclass
class Deletion:
    """One surplus row, alongside the row of its pair that survives."""

    bill_key: str
    doomed_id: str
    doomed_created_at: datetime
    doomed_is_current: bool
    kept_id: str
    kept_created_at: datetime
    kept_is_current: bool
    content_differs: bool

    def line(self) -> str:
        current = " CURRENT!" if self.doomed_is_current else ""
        differs = "different summary" if self.content_differs else "identical summary"
        return (
            f"  {self.bill_key:22} delete {self.doomed_id} "
            f"({self.doomed_created_at:%Y-%m-%d %H:%M:%S}){current} "
            f"| keep {self.kept_id} ({self.kept_created_at:%Y-%m-%d %H:%M:%S}) "
            f"| {differs}"
        )


def find_deletions(conn: sa.Connection) -> list[Deletion]:
    """Every row that is not the newest of its group, and the row that outlives it.

    ``NULLS NOT DISTINCT`` is what migration 0019 enforces, and ``GROUP BY`` /
    ``PARTITION BY`` already treat two NULLs as one value, so this window is
    exactly the grouping the constraint will apply -- which matters, because
    9,161 rows have no ``bill_version_id`` and a plain ``UNIQUE`` would ignore
    every one of them.
    """
    rows = conn.execute(
        sa.text(
            f"""
            WITH ranked AS (
                SELECT id, bill_id, is_current, created_at, content_json,
                       row_number() OVER (
                           PARTITION BY {KEY}
                           ORDER BY created_at DESC, id DESC
                       ) AS rn,
                       first_value(id) OVER (
                           PARTITION BY {KEY}
                           ORDER BY created_at DESC, id DESC
                       ) AS keeper_id
                  FROM ai_enrichment
            )
            SELECT b.bill_key AS bill_key,
                   d.id AS doomed_id, d.created_at AS doomed_created_at,
                   d.is_current AS doomed_is_current,
                   k.id AS kept_id, k.created_at AS kept_created_at,
                   k.is_current AS kept_is_current,
                   (d.content_json::text IS DISTINCT FROM k.content_json::text)
                       AS content_differs
              FROM ranked d
              JOIN ranked k ON k.id = d.keeper_id
              LEFT JOIN bill b ON b.id = d.bill_id
             WHERE d.rn > 1
             ORDER BY b.bill_key, d.created_at
            """
        )
    ).all()
    return [
        Deletion(
            bill_key=row.bill_key or "(no bill)",
            doomed_id=str(row.doomed_id),
            doomed_created_at=row.doomed_created_at,
            doomed_is_current=row.doomed_is_current,
            kept_id=str(row.kept_id),
            kept_created_at=row.kept_created_at,
            kept_is_current=row.kept_is_current,
            content_differs=row.content_differs,
        )
        for row in rows
    ]


def snapshot(conn: sa.Connection, bill_ids: list[str]) -> dict[str, Any]:
    """The facts a delete must not change, plus the ones it must.

    ``has_current_summary`` is here because an ``AFTER DELETE`` trigger writes it,
    and a bill whose flag goes false vanishes from every list in the product.
    """

    def scalar(sql: str) -> Any:
        return conn.execute(sa.text(sql)).scalar()

    return {
        "rows": scalar("SELECT count(*) FROM ai_enrichment"),
        "current_rows": scalar("SELECT count(*) FROM ai_enrichment WHERE is_current"),
        "duplicate_groups": scalar(
            f"SELECT count(*) FROM (SELECT 1 FROM ai_enrichment "
            f"GROUP BY {KEY} HAVING count(*) > 1) g"
        ),
        "bills_with_a_current_summary": scalar(
            "SELECT count(*) FROM bill WHERE has_current_summary"
        ),
        # Not just the count: the exact flag on each bill this run touches, so a
        # flip that happened to be offset by another flip cannot hide in a total.
        "affected_bill_flags": dict(
            conn.execute(
                sa.text(
                    "SELECT bill_key, has_current_summary FROM bill "
                    "WHERE id = ANY(CAST(:ids AS uuid[])) ORDER BY bill_key"
                ),
                {"ids": bill_ids},
            ).all()
        ),
    }


def read_rows(conn: sa.Connection, ids: list[str]) -> list[dict[str, Any]]:
    """Every column of the named rows, ordered by id so two reads compare directly."""
    rows = conn.execute(
        sa.text(
            f"SELECT {', '.join(COLUMNS)} FROM ai_enrichment "
            "WHERE id = ANY(CAST(:ids AS uuid[])) ORDER BY id"
        ),
        {"ids": ids},
    ).mappings()
    return [{key: value for key, value in row.items()} for row in rows]


def delete_rows(conn: sa.Connection, ids: list[str]) -> int:
    result = conn.execute(
        sa.text("DELETE FROM ai_enrichment WHERE id = ANY(CAST(:ids AS uuid[]))"),
        {"ids": ids},
    )
    return result.rowcount


# What each column has to be cast back to on the way in. Every value in a backup
# file is plain JSON -- a string or a boolean -- so Postgres is told the type
# rather than left to guess, and the same statement restores from memory or from
# a file that has been sitting on disk for a month.
CASTS = {
    "id": "uuid",
    "bill_id": "uuid",
    "legislator_id": "uuid",
    "bill_version_id": "uuid",
    "enrichment_type": "enrichment_type",
    "content_json": "jsonb",
    "created_at": "timestamptz",
    "updated_at": "timestamptz",
}


def insert_rows(conn: sa.Connection, rows: list[dict[str, Any]]) -> None:
    """Put backed-up rows back exactly as they were, timestamps and all."""
    if not rows:
        return
    placeholders = ", ".join(
        f"CAST(:{name} AS {CASTS[name]})" if name in CASTS else f":{name}"
        for name in COLUMNS
    )
    statement = sa.text(
        f"INSERT INTO ai_enrichment ({', '.join(COLUMNS)}) VALUES ({placeholders})"
    )
    for row in rows:
        payload = dict(row)
        payload["content_json"] = json.dumps(payload["content_json"])
        conn.execute(statement, payload)


def serializable(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """The rows as they are written to the backup file: plain JSON, nothing lost."""

    def plain(value: Any) -> Any:
        if isinstance(value, datetime):
            return value.isoformat()
        if isinstance(value, (dict, list, bool, str, int, float, type(None))):
            return value
        return str(value)  # UUID, and the enum if the driver hands one back

    return [{key: plain(value) for key, value in row.items()} for row in rows]


def prove_restore(engine: sa.Engine, deletions: list[Deletion]) -> bool:
    """Delete every row, restore from the backup, check, then roll it all back.

    Nothing is written: the transaction is abandoned at the end whether it passed
    or failed. What survives is the knowledge that the backup this run would take
    is one that actually goes back in.
    """
    doomed_ids = [d.doomed_id for d in deletions]
    ok = True
    with engine.connect() as conn:
        transaction = conn.begin()
        try:
            bill_ids = [
                str(row[0])
                for row in conn.execute(
                    sa.text(
                        "SELECT DISTINCT bill_id FROM ai_enrichment "
                        "WHERE id = ANY(CAST(:ids AS uuid[])) AND bill_id IS NOT NULL"
                    ),
                    {"ids": doomed_ids},
                )
            ]
            before = snapshot(conn, bill_ids)
            backup = read_rows(conn, doomed_ids)
            print(f"  backed up {len(backup)} row(s), every column")

            deleted = delete_rows(conn, doomed_ids)
            after_delete = snapshot(conn, bill_ids)
            print(
                f"  deleted {deleted} -> rows {after_delete['rows']}, "
                f"current {after_delete['current_rows']}, "
                f"duplicate groups {after_delete['duplicate_groups']}"
            )
            ok &= _check(
                "the delete removed exactly the rows it named",
                deleted == len(doomed_ids),
            )
            ok &= _check(
                "no current summary was deleted",
                after_delete["current_rows"] == before["current_rows"],
            )
            ok &= _check(
                "no duplicate group survived", after_delete["duplicate_groups"] == 0
            )
            # The AFTER DELETE trigger recomputes this. Checked, not assumed.
            ok &= _check(
                "no bill lost its summary flag (the trigger held)",
                after_delete["affected_bill_flags"] == before["affected_bill_flags"]
                and after_delete["bills_with_a_current_summary"]
                == before["bills_with_a_current_summary"],
            )

            # Restore through the exact JSON the backup file holds, not through
            # the live row objects -- otherwise this proves that memory restores,
            # which is not the thing anyone would be reaching for.
            insert_rows(conn, json.loads(json.dumps(serializable(backup))))
            restored = read_rows(conn, doomed_ids)
            after_restore = snapshot(conn, bill_ids)
            ok &= _check(
                "every restored row matches the original in every column",
                restored == backup,
            )
            ok &= _check(
                "the table is exactly where it started", after_restore == before
            )
        except Exception as error:  # noqa: BLE001 - a crash here is a failed proof
            # A restore that raises is a restore that does not work, and it must
            # read as FAIL rather than as a traceback someone has to interpret.
            ok = _check(f"the proof ran without error ({type(error).__name__})", False)
            print(f"        {error}")
        finally:
            transaction.rollback()
    return ok


def _check(label: str, passed: bool) -> bool:
    print(f"  {'PASS' if passed else 'FAIL'}  {label}")
    return passed


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--apply", action="store_true", help="Write. Without this, nothing changes."
    )
    parser.add_argument(
        "--prove-restore",
        action="store_true",
        help="Delete, restore, check, roll back. Writes nothing. Run before --apply.",
    )
    parser.add_argument(
        "--only-bill",
        help="Act on a single bill_key. Use for the scoped live check before the "
        "full run.",
    )
    parser.add_argument(
        "--backup-path",
        help="Where --apply writes the full-row backup. Defaults to a timestamped "
        "file under ~/.alethical-backups (outside this PUBLIC repo).",
    )
    parser.add_argument(
        "--restore-from",
        help="Put the rows in this backup file back. The undo for --apply.",
    )
    parser.add_argument(
        "--target",
        default=os.environ.get("ALETHICAL_DATABASE_TARGET", "local"),
        help="local | production. Defaults to ALETHICAL_DATABASE_TARGET.",
    )
    args = parser.parse_args(argv)

    url = database_url_for_target(args.target)
    # Say which database, every run. A sibling repair script took its target only
    # from --target and ignored ALETHICAL_DATABASE_TARGET, so a command that named
    # production read the local database and printed "nothing to repair" -- a false
    # all-clear, which is the worst thing a repair script can print.
    print(f"Database: {args.target} ({make_url(url).host}/{make_url(url).database})\n")
    engine = sa.create_engine(url, connect_args=NO_PREPARED_STATEMENTS)

    if args.restore_from:
        rows = json.loads(Path(args.restore_from).read_text("utf-8"))
        with engine.begin() as conn:
            insert_rows(conn, rows)
        print(f"Restored {len(rows)} row(s) from {args.restore_from}.")
        return 0

    with engine.connect() as conn:
        deletions = find_deletions(conn)

    if args.only_bill:
        deletions = [d for d in deletions if d.bill_key == args.only_bill]
        if not deletions:
            print(f"Nothing to delete for {args.only_bill!r}.")
            return 0

    if not deletions:
        print("No duplicate enrichment rows. Nothing to delete.")
        return 0

    verb = "Deleting" if args.apply else "Would delete"
    print(f"{verb} {len(deletions)} row(s):\n")
    # Every row, never a count. A sibling script's dry run printed each row and
    # that is what caught a wrong repair rule before it wrote anything.
    for deletion in deletions:
        print(deletion.line())
    print()

    if args.prove_restore:
        print("Proving the backup restores (one transaction, rolled back):")
        ok = prove_restore(engine, deletions)
        print(
            "\nProof passed. Nothing was written."
            if ok
            else "\nProof FAILED. Nothing was written. Do not run --apply."
        )
        return 0 if ok else 1

    if not args.apply:
        print("Dry run: nothing was written.")
        print("Next: --prove-restore, then --apply --only-bill <key>, then --apply.")
        return 0

    backup_path = Path(
        args.backup_path
        or Path.home()
        / ".alethical-backups"
        / (
            "ai_enrichment_dedupe_"
            f"{datetime.now(timezone.utc):%Y%m%dT%H%M%SZ}_{len(deletions)}rows.json"
        )
    )
    if backup_path.exists():
        print(f"Refusing to overwrite an existing backup at {backup_path}.")
        return 1
    backup_path.parent.mkdir(parents=True, exist_ok=True)

    doomed_ids = [d.doomed_id for d in deletions]
    with engine.connect() as conn:
        bill_ids = [
            str(row[0])
            for row in conn.execute(
                sa.text(
                    "SELECT DISTINCT bill_id FROM ai_enrichment "
                    "WHERE id = ANY(CAST(:ids AS uuid[])) AND bill_id IS NOT NULL"
                ),
                {"ids": doomed_ids},
            )
        ]
        before = snapshot(conn, bill_ids)
        backup = read_rows(conn, doomed_ids)
    backup_path.write_text(json.dumps(serializable(backup), indent=2), "utf-8")
    print(f"Backup: {backup_path} ({len(backup)} row(s))")

    with engine.begin() as conn:
        deleted = delete_rows(conn, doomed_ids)

    # Read back from the database, not from what the delete claimed.
    with engine.connect() as conn:
        after = snapshot(conn, bill_ids)
        survivors = read_rows(conn, doomed_ids)

    print(f"\nDeleted {deleted} row(s). Read back from the database:")
    ok = _check("every named row is gone", not survivors)
    ok &= _check(
        f"current summaries unchanged at {before['current_rows']}",
        after["current_rows"] == before["current_rows"],
    )
    ok &= _check(
        "no bill lost its summary flag",
        after["affected_bill_flags"] == before["affected_bill_flags"],
    )
    ok &= _check(
        f"duplicate groups {before['duplicate_groups']} -> {after['duplicate_groups']}",
        after["duplicate_groups"]
        == (before["duplicate_groups"] - len(deletions) if args.only_bill else 0),
    )
    if not ok:
        print(f"\nSomething is off. Undo with --restore-from {backup_path}")
    return 0 if ok else 1


if __name__ == "__main__":
    raise SystemExit(main())
