#!/usr/bin/env python3
"""Build the Finance money graph's summary for the live release's 3 payment files.

Net: a one-time catch-up for files loaded before ``cf_graph_money_summary`` existed
(migration 0081). Every later publish writes its own summary inside the publish
transaction (``alethical/pipeline/campaign_finance.py``, ``publish``), so this is
not a scheduled job. Safe to re-run: a file that already has summary rows is left
alone unless ``--rebuild`` is given. Until a file has its summary, the graph groups
its raw rows on every request, which is slow but never wrong.

    uv run python scripts/build_finance_graph_summary.py --target local
    uv run python scripts/build_finance_graph_summary.py --target production
    uv run python scripts/build_finance_graph_summary.py --target production --dry-run

Each file is built in its own transaction holding the publish lock, so a publish
or a prune cannot run between reading the live release and writing its summary.
``--target production`` needs ``SUPABASE_PROJECT_URL`` and ``SUPABASE_DB_PASSWORD``
from the gitignored ``.env``. Prints counts and seconds only.

Design: ``docs/architecture/alethical-finance-architecture.md`` (Recorded connections)
and ``docs/architecture/campaign-finance-system-design.md`` §11.
"""

from __future__ import annotations

import argparse
import os
import sys
import time
from pathlib import Path

from sqlalchemy import create_engine, text
from sqlalchemy.orm import Session

REPO_ROOT = Path(__file__).resolve().parent.parent
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from alethical.db.session import (  # noqa: E402
    NO_PREPARED_STATEMENTS,
    database_url_for_target,
    normalize_database_url,
)
from alethical.pipeline import campaign_finance_graph_summary as graph_summary  # noqa: E402
from alethical.pipeline.campaign_finance import (  # noqa: E402
    PUBLISH_LOCK_KEY,
    RELEASE_SNAPSHOT_COLUMN,
    live_release,
)


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Build the Finance money graph's summary for the live release."
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
        help="Replace summary rows a file already has. Without it, such a file is skipped.",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Say which files would be built and write nothing.",
    )
    args = parser.parse_args()
    url = normalize_database_url(
        args.database_url or database_url_for_target(args.target)
    )
    engine = create_engine(url, connect_args=NO_PREPARED_STATEMENTS)
    try:
        with Session(engine) as db:
            release = live_release(db)
            if release is None:
                print("nothing is published; nothing to build")
                return 0
            snapshots = {
                dataset: getattr(release, column)
                for dataset, column in RELEASE_SNAPSHOT_COLUMN.items()
            }
            held = graph_summary.held(db, snapshots.values())
            db.rollback()
        for dataset, snapshot_id in snapshots.items():
            if snapshot_id in held and not args.rebuild:
                print(f"{dataset.value}: summary held, skipped")
                continue
            if args.dry_run:
                print(f"{dataset.value}: would build")
                continue
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
                rows = graph_summary.rebuild(db, dataset, snapshot_id)
                db.commit()
            print(
                f"{dataset.value}: {rows:,} summary rows in "
                f"{time.monotonic() - started:.1f} s"
            )
        return 0
    finally:
        engine.dispose()


if __name__ == "__main__":
    raise SystemExit(main())
