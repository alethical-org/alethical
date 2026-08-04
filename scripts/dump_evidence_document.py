#!/usr/bin/env python3
"""Dump, restore and compare ``evidence_document`` — the reversal path for #855.

Net: this is what makes dropping 34,033 rows reversible rather than nominally
reversible. The migration's ``downgrade`` rebuilds the empty table; this rebuilds
what was in it.

``evidence_document`` was applied to production out-of-band from the unmerged
``codex/representative-lookup-followups`` branch (#288) and has never existed in
``models.py`` or in any migration. Nothing reads it. Migration
``0022_drop_evidence_document`` removes it; this script is the escape hatch, and
its ``verify`` mode is the pre-flight check that proves the dump still matches
production at the moment of the drop.

The three modes are one loop, and each is meaningless without the others:

``dump``     read every row out of a database into a JSONL file
``restore``  create the table in a database and load every row of a dump back in
``verify``   compare a database against a dump, row for row, column for column

A dump that has never been restored is a file, not a backup. The protocol used
before the drop was: ``dump`` production, ``restore`` into a scratch local
database, ``verify`` that scratch database against the dump, then ``verify``
production against the dump one last time immediately before the migration ran.

Serialization is deliberately lossless and deliberately shared: ``verify``
re-serializes what it reads with the same function ``dump`` used, so the
comparison catches a value that changed shape on the way through the file
(a timestamp losing microseconds, a UUID changing case) rather than hiding it.

Usage (run from the repo root; PYTHONPATH=. so ``alethical`` imports)::

    # dump production (read-only) to a file OUTSIDE the repo -- it is 34,033 rows
    # of generated text and this repository is public
    ALETHICAL_DATABASE_TARGET=production PYTHONPATH=. uv run \
        python scripts/dump_evidence_document.py dump \
        --out ~/.alethical-backups/evidence_document.jsonl

    # prove the dump restorable: load it into a scratch database, then compare
    createdb -h localhost -p 54329 -U alethical evidence_restore_check
    DATABASE_URL=postgresql+psycopg://alethical:alethical@localhost:54329/evidence_restore_check \
        PYTHONPATH=. uv run python scripts/dump_evidence_document.py restore \
        --file ~/.alethical-backups/evidence_document.jsonl
    DATABASE_URL=... PYTHONPATH=. uv run \
        python scripts/dump_evidence_document.py verify \
        --file ~/.alethical-backups/evidence_document.jsonl

    # re-check production against the dump immediately before dropping
    ALETHICAL_DATABASE_TARGET=production PYTHONPATH=. uv run \
        python scripts/dump_evidence_document.py verify \
        --file ~/.alethical-backups/evidence_document.jsonl
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterator
from uuid import UUID

from sqlalchemy import create_engine, text
from sqlalchemy.engine import Engine

from alethical.db.session import (
    NO_PREPARED_STATEMENTS,
    database_url_for_target,
    normalize_database_url,
)

TABLE = "evidence_document"

# Column order is fixed here rather than read from the catalog, so a dump written
# today and a verify run months later line up even if someone adds a column.
COLUMNS: tuple[str, ...] = (
    "id",
    "legislator_id",
    "source_artifact_id",
    "source_type",
    "authority_tier",
    "title",
    "publisher",
    "speaker",
    "source_url",
    "published_at",
    "content",
    "search_text",
    "verified_identity",
    "retrieval_ready",
    "metadata_json",
    "created_at",
    "updated_at",
)

# Transcribed from live production, Aug 4 2026. The constraint names are
# PostgreSQL's own defaults (``*_fkey``) rather than this repo's convention,
# because that is what the out-of-band feature actually created -- a restore has
# to rebuild what was there, not a tidied-up version of it.
CREATE_TABLE_SQL = """
CREATE TABLE IF NOT EXISTS evidence_document (
    legislator_id      uuid        NOT NULL,
    source_artifact_id uuid,
    source_type        varchar(50) NOT NULL,
    authority_tier     integer     NOT NULL,
    title              text        NOT NULL,
    publisher          varchar(255) NOT NULL,
    speaker            varchar(255),
    source_url         text        NOT NULL,
    published_at       timestamptz,
    content            text        NOT NULL,
    search_text        text        NOT NULL,
    verified_identity  boolean     NOT NULL DEFAULT false,
    retrieval_ready    boolean     NOT NULL DEFAULT false,
    metadata_json      jsonb       NOT NULL DEFAULT '{}'::jsonb,
    id                 uuid        NOT NULL,
    created_at         timestamptz NOT NULL DEFAULT now(),
    updated_at         timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT pk_evidence_document PRIMARY KEY (id),
    CONSTRAINT uq_evidence_document_legislator_id_source_url
        UNIQUE (legislator_id, source_url),
    CONSTRAINT ck_evidence_document_authority_tier
        CHECK (authority_tier >= 1 AND authority_tier <= 5)
)
"""

# Deliberately separate from CREATE_TABLE_SQL: a scratch database used to prove a
# restore has no ``legislator`` or ``source_artifact`` table, so the foreign keys
# can only be added where those tables exist.
FOREIGN_KEYS_SQL = (
    "ALTER TABLE evidence_document ADD CONSTRAINT evidence_document_legislator_id_fkey"
    " FOREIGN KEY (legislator_id) REFERENCES legislator(id)",
    "ALTER TABLE evidence_document ADD CONSTRAINT"
    " evidence_document_source_artifact_id_fkey"
    " FOREIGN KEY (source_artifact_id) REFERENCES source_artifact(id)",
)

INDEXES_SQL = (
    "CREATE INDEX IF NOT EXISTS ix_evidence_document_legislator_type"
    " ON evidence_document USING btree (legislator_id, source_type)",
    "CREATE INDEX IF NOT EXISTS ix_evidence_document_search"
    " ON evidence_document USING gin (to_tsvector('english', search_text))",
)


def serialize(value: Any) -> Any:
    """One row value as JSON. Shared by dump and verify so they cannot disagree.

    Timestamps are normalized to UTC on purpose. Every timestamp here is a
    ``timestamptz``, which stores an instant, but a server renders it in whatever
    its own ``TimeZone`` is set to -- production answers in UTC and the local
    Postgres in ``America/New_York``. Comparing the rendered strings made all
    34,033 restored rows look like mismatches when every one held the same
    instant. Normalizing compares what the column actually means.
    """
    if isinstance(value, UUID):
        return str(value)
    if isinstance(value, datetime):
        return (value.astimezone(timezone.utc) if value.tzinfo else value).isoformat()
    return value


def engine_for(args: argparse.Namespace) -> Engine:
    url = database_url_for_target(
        os.environ.get("ALETHICAL_DATABASE_TARGET"), args.database_url
    )
    return create_engine(
        normalize_database_url(url), connect_args=NO_PREPARED_STATEMENTS
    )


def read_rows(engine: Engine) -> Iterator[dict[str, Any]]:
    """Every row, ordered by primary key so two reads always line up."""
    select = f"SELECT {', '.join(COLUMNS)} FROM {TABLE} ORDER BY id"
    with engine.connect().execution_options(stream_results=True) as conn:
        for row in conn.execute(text(select)):
            yield {c: serialize(v) for c, v in zip(COLUMNS, row)}


def cmd_dump(args: argparse.Namespace) -> int:
    engine = engine_for(args)
    out = Path(args.out).expanduser()
    out.parent.mkdir(parents=True, exist_ok=True)
    written = 0
    with out.open("w", encoding="utf-8") as handle:
        for row in read_rows(engine):
            handle.write(json.dumps(row, ensure_ascii=False, sort_keys=True) + "\n")
            written += 1
    print(f"dumped {written} rows to {out} ({out.stat().st_size:,} bytes)")
    return 0


def cmd_restore(args: argparse.Namespace) -> int:
    engine = engine_for(args)
    path = Path(args.file).expanduser()
    columns = ", ".join(COLUMNS)
    placeholders = ", ".join(
        # jsonb needs the cast, spelled CAST(...) rather than ``::`` -- the colon
        # form collides with SQLAlchemy's own bind-parameter marker.
        f"CAST(:{c} AS jsonb)" if c == "metadata_json" else f":{c}"
        for c in COLUMNS
    )
    insert = f"INSERT INTO {TABLE} ({columns}) VALUES ({placeholders})"

    with engine.begin() as conn:
        conn.execute(text(CREATE_TABLE_SQL))
        for statement in INDEXES_SQL:
            conn.execute(text(statement))
        if args.with_foreign_keys:
            for statement in FOREIGN_KEYS_SQL:
                conn.execute(text(statement))

    inserted = 0
    batch: list[dict[str, Any]] = []
    with path.open(encoding="utf-8") as handle, engine.begin() as conn:
        for line in handle:
            row = json.loads(line)
            row["metadata_json"] = json.dumps(row["metadata_json"])
            batch.append(row)
            if len(batch) >= 500:
                conn.execute(text(insert), batch)
                inserted += len(batch)
                batch = []
        if batch:
            conn.execute(text(insert), batch)
            inserted += len(batch)
    print(f"restored {inserted} rows from {path}")
    return 0


def cmd_verify(args: argparse.Namespace) -> int:
    """Compare a database against a dump, row for row and column for column."""
    engine = engine_for(args)
    path = Path(args.file).expanduser()

    mismatches: list[str] = []
    seen = 0
    with path.open(encoding="utf-8") as handle:
        database = read_rows(engine)
        for line in handle:
            expected = json.loads(line)
            actual = next(database, None)
            seen += 1
            if actual is None:
                mismatches.append(
                    f"row {seen} ({expected['id']}): missing from database"
                )
                break
            for column in COLUMNS:
                if expected[column] != actual[column]:
                    mismatches.append(
                        f"row {seen} ({expected['id']}): {column} differs"
                    )
        extra = sum(1 for _ in database)
        if extra:
            mismatches.append(f"database holds {extra} row(s) the dump does not")

    if mismatches:
        print(f"MISMATCH: {len(mismatches)} problem(s) across {seen} dump rows")
        for line in mismatches[:20]:
            print(f"  {line}")
        return 1
    print(f"identical: {seen} rows match the dump on all {len(COLUMNS)} columns")
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--database-url",
        default=None,
        help="explicit connection URL; otherwise ALETHICAL_DATABASE_TARGET decides",
    )
    sub = parser.add_subparsers(dest="command", required=True)

    dump = sub.add_parser("dump", help="write every row to a JSONL file")
    dump.add_argument(
        "--out", required=True, help="destination path (outside the repo)"
    )
    dump.set_defaults(func=cmd_dump)

    restore = sub.add_parser("restore", help="create the table and load a dump back in")
    restore.add_argument("--file", required=True)
    restore.add_argument(
        "--with-foreign-keys",
        action="store_true",
        help="also add the two foreign keys; needs legislator and source_artifact",
    )
    restore.set_defaults(func=cmd_restore)

    verify = sub.add_parser("verify", help="compare a database against a dump")
    verify.add_argument("--file", required=True)
    verify.set_defaults(func=cmd_verify)

    args = parser.parse_args()
    return args.func(args)


if __name__ == "__main__":
    sys.exit(main())
