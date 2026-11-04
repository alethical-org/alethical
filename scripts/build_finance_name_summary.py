#!/usr/bin/env python3
"""Build the Confirm identities queue's per-name totals for the live release.

Net: a one-time catch-up for files loaded before ``cf_identity_name_summary``
existed (migration 0087). Every later publish writes its own totals inside the
publish transaction (``alethical/pipeline/campaign_finance.py``, ``publish``), so
this is not a scheduled job. Until a file and kind have a complete build, the queue
groups that file's raw rows on every request, which is slow but never wrong.

    uv run python scripts/build_finance_name_summary.py --target production --dry-run
    uv run python scripts/build_finance_name_summary.py --target production
    uv run python scripts/build_finance_name_summary.py --target production --remove --dry-run
    uv run python scripts/build_finance_name_summary.py --target production --remove

Safe to re-run: a (file, kind) with a complete build is skipped unless
``--rebuild`` is given. ``--dry-run`` writes nothing; it reads how many exact names
each build would write. ``--remove`` is the rollback: it deletes the live
release's totals and their build markers, so the queue reads the raw rows again.
Each file is written in its own transaction holding the publish lock, so a publish
or a prune cannot run between reading the live release and writing. Payment rows
are never changed. ``--target production`` needs ``SUPABASE_PROJECT_URL`` and
``SUPABASE_DB_PASSWORD`` from the gitignored ``.env``. Prints counts and seconds
only.

Design: ``docs/architecture/alethical-finance-architecture.md`` (Confirm
identities queue).
"""

from __future__ import annotations

import argparse
import os
import sys
import time
from pathlib import Path

from sqlalchemy import create_engine, func, select, text
from sqlalchemy.orm import Session

REPO_ROOT = Path(__file__).resolve().parent.parent
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from alethical.db.session import (  # noqa: E402
    NO_PREPARED_STATEMENTS,
    database_url_for_target,
    normalize_database_url,
)
from alethical.pipeline import campaign_finance_name_summary as name_summary  # noqa: E402
from alethical.pipeline.campaign_finance import (  # noqa: E402
    PUBLISH_LOCK_KEY,
    RELEASE_SNAPSHOT_COLUMN,
    live_release,
)


def _names_to_write(db: Session, kind: str, snapshot_id) -> int:
    spec = name_summary.NAME_KINDS[kind]
    return (
        db.scalar(
            select(func.count(func.distinct(spec.name))).where(
                *name_summary.named(kind, snapshot_id)
            )
        )
        or 0
    )


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description="Build the identity queue's per-name totals for the live release."
    )
    parser.add_argument(
        "--target",
        default=os.environ.get("ALETHICAL_DATABASE_TARGET") or "local",
        choices=("local", "production"),
    )
    parser.add_argument("--database-url", default=None)
    parser.add_argument(
        "--rebuild",
        action="store_true",
        help="Replace a complete build. Without it, a complete build is skipped.",
    )
    parser.add_argument(
        "--remove",
        action="store_true",
        help="Delete the live release's totals and build markers (the rollback).",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Say what would be built or removed, with counts, and write nothing.",
    )
    args = parser.parse_args(argv)
    url = normalize_database_url(
        args.database_url or database_url_for_target(args.target)
    )
    engine = create_engine(url, connect_args=NO_PREPARED_STATEMENTS)
    try:
        with Session(engine) as db:
            release = live_release(db)
            if release is None:
                print("nothing is published; nothing to do")
                return 0
            snapshots = {
                dataset: getattr(release, column)
                for dataset, column in RELEASE_SNAPSHOT_COLUMN.items()
            }
            built = name_summary.complete(
                db,
                [
                    (snapshot_id, kind)
                    for dataset, snapshot_id in snapshots.items()
                    for kind in name_summary.kinds_for(dataset)
                ],
            )
            plan = {}
            for dataset, snapshot_id in snapshots.items():
                for kind in name_summary.kinds_for(dataset):
                    held = (snapshot_id, kind) in built
                    if args.remove:
                        rows = db.scalar(
                            select(func.count())
                            .select_from(name_summary.Summary)
                            .where(
                                name_summary.Summary.snapshot_id == snapshot_id,
                                name_summary.Summary.record_kind == kind,
                            )
                        )
                        print(
                            f"{dataset.value} {kind}: "
                            f"{'would remove' if args.dry_run else 'removing'} "
                            f"{rows:,} rows and {'1 marker' if held else 'no marker'}"
                        )
                    elif held and not args.rebuild:
                        print(f"{dataset.value} {kind}: complete build held, skipped")
                        continue
                    elif args.dry_run:
                        print(
                            f"{dataset.value} {kind}: would build "
                            f"{_names_to_write(db, kind, snapshot_id):,} names"
                        )
                    plan.setdefault(dataset, snapshot_id)
            db.rollback()
        if args.dry_run:
            return 0
        for dataset, snapshot_id in plan.items():
            started = time.monotonic()
            with Session(engine) as db:
                db.execute(
                    text("SELECT pg_advisory_xact_lock(:key)"),
                    {"key": PUBLISH_LOCK_KEY},
                )
                # Re-read inside the lock: a publish may have moved the pointer.
                current = live_release(db)
                if (
                    current is None
                    or getattr(current, RELEASE_SNAPSHOT_COLUMN[dataset]) != snapshot_id
                ):
                    db.rollback()
                    print(f"{dataset.value}: the live release changed, skipped; re-run")
                    continue
                if args.remove:
                    rows = name_summary.remove(db, snapshot_id)
                    verb = "removed"
                elif not args.rebuild and name_summary.held(db, dataset, [snapshot_id]):
                    # A publish built it while this script waited for the lock.
                    db.rollback()
                    print(f"{dataset.value}: complete build held, skipped")
                    continue
                else:
                    rows = name_summary.rebuild(db, dataset, snapshot_id)
                    verb = "built"
                db.commit()
            print(
                f"{dataset.value}: {verb} {rows:,} name rows in "
                f"{time.monotonic() - started:.1f} s"
            )
        return 0
    finally:
        engine.dispose()


if __name__ == "__main__":
    raise SystemExit(main())
