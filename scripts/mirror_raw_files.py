#!/usr/bin/env python3
"""Copy every stored source file to Cloudflare R2, and prove the copy arrived (#1402).

Net: the exact bytes of every campaign-finance file we keep live in one private
Supabase bucket, and Supabase's own documentation says database backups do not cover
objects stored that way. So today that bucket is the only copy. This copies each one
to Cloudflare, reads it back out to check it arrived whole, and records on the row
that names it that it did. Running it twice copies nothing the second time.

**Every kind of stored body, not only the bulk downloads (#1501).** Which tables hold
one is read out of the schema — any table carrying ``object_key``, ``compressed_hash``
and ``mirrored_at`` — so the 5 kinds today (bulk downloads, the totals archives,
#1433's report documents, #1798's published-source copies, and #1862's lobbying
principal-expenditures download) and any sixth kind added later are covered without
editing this script.

Why losing one matters more than a normal backup: Minnesota's Board publishes no
archive, the download links never change, and the file behind each is replaced as it
grows. A file we fail to keep is not re-fetchable — asking again returns a different
file, so what was published on a past date is gone for good.

    # against the production database, which is the one the schedule uses
    ALETHICAL_DATABASE_TARGET=production PYTHONPATH=. uv run \\
        python scripts/mirror_raw_files.py --target production

    # what it would do, moving no bytes and writing nothing
    PYTHONPATH=. uv run python scripts/mirror_raw_files.py --target production --dry-run

Exits 1 if any object fails to copy, so the scheduled job can raise it. A backup
that quietly stops is worse than none, because it is trusted.

What it needs, all from the gitignored ``.env`` at the repository root (or from
repository secrets of the same names in a GitHub Actions run):

* the 4 ``SUPABASE_STORAGE_S3_*`` credentials, to read the primary copy
* the 4 ``CLOUDFLARE_R2_*`` settings, to write the second one
* ``SUPABASE_PROJECT_URL`` and ``SUPABASE_DB_PASSWORD`` for ``--target production``

What it costs: nothing. R2 includes the first 10 GB and the whole store is 115 MB,
pulling data back out of R2 is free so a restore costs nothing, and GitHub Actions
is free on a public repository. Design:
``docs/architecture/campaign-finance-system-design.md`` §4.5.
"""

from __future__ import annotations

import argparse
import os
import sys
import tempfile

from sqlalchemy import create_engine
from sqlalchemy.orm import Session

from alethical.db.session import (
    NO_PREPARED_STATEMENTS,
    database_url_for_target,
)
from alethical.pipeline.raw_file_mirror import (
    body_tables,
    format_report,
    mirror_raw_files,
    rows_by_object_key,
)
from alethical.pipeline.raw_file_store import (
    mirror_file_store_from_env,
    raw_file_store_from_env,
)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--target", default=os.environ.get("ALETHICAL_DATABASE_TARGET"))
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="List what would be copied and stop. Moves no bytes, writes nothing.",
    )
    args = parser.parse_args()

    source = raw_file_store_from_env()
    mirror = mirror_file_store_from_env()
    print(f"source: {source.bucket}\nsecond copy: {mirror.bucket}")

    engine = create_engine(
        database_url_for_target(args.target), connect_args=NO_PREPARED_STATEMENTS
    )
    with Session(engine) as db:
        if args.dry_run:
            return _describe_only(db, source, mirror)
        with tempfile.TemporaryDirectory(prefix="raw-file-mirror-") as directory:
            report = mirror_raw_files(db, source, mirror, directory)
    print(f"\n{format_report(report)}")
    return 1 if report.failures else 0


def _describe_only(db: Session, source, mirror) -> int:
    """Say what a real run would copy, using only listings — no bytes move.

    Reads the same discovered set of body-bearing tables the real run does
    (``rows_by_object_key``), because a dry run built on its own idea of where bodies
    live is a dry run of a different job.
    """
    rows = rows_by_object_key(db)
    mirrored = {
        key
        for key, named in rows.items()
        if all(row.mirrored_at is not None for row in named)
    }
    objects = source.list_objects()
    present = mirror.list_objects()
    todo = {
        key: size
        for key, size in objects.items()
        if key not in mirrored and key not in present
    }
    tables = ", ".join(model.__tablename__ for model in body_tables())
    print(
        f"\n{len(objects)} object(s) stored, {len(present)} already in the second copy, "
        f"{len(mirrored)} recorded as confirmed on a row.\n"
        f"tables that hold a stored body: {tables}"
    )
    print(f"{len(todo)} object(s) would be copied ({sum(todo.values()):,} bytes):")
    for key in sorted(todo):
        print(f"  {key} ({todo[key]:,} bytes)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
