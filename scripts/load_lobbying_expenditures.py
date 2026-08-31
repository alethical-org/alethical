#!/usr/bin/env python3
"""Load Minnesota's lobbying principal-expenditure download as a dated, replaceable set (#1862).

Net: this fetches the Board's "Principal expenditures - 2009 - Present" file, keeps the
download's exact bytes, checks the new set against the one already published, and
publishes it by replacing the previous set entirely. Running it twice on an unchanged
file changes nothing. It exists so the $886 million lobbying figure our research piece
*The Money Only Goes One Way* publishes recomputes from data we hold.

    # what would happen, writing nothing to the database or the file store
    uv run python scripts/load_lobbying_expenditures.py --dry-run

    # the real thing, locally
    uv run python scripts/load_lobbying_expenditures.py --target local

    # the real thing, against production
    uv run python scripts/load_lobbying_expenditures.py --target production

**A set that fails its checks is quarantined, not published**, and the command exits
non-zero. Its bytes are kept either way. That includes the very first import, which has
nothing to compare against: read the measurements it printed, then publish by naming
the record hash you reviewed (the "records" line in its output, in full).

    uv run python scripts/load_lobbying_expenditures.py --target local \\
        --publish-hash <records sha256>

Naming the hash waives only the **comparison** checks. It never waives a structural
one: a header that does not match the pinned contract, a record with the wrong number
of fields, or an amount that would have to be rounded stops the run whatever you pass.

Which database, and what it needs: ``--target production`` needs
``SUPABASE_PROJECT_URL`` and ``SUPABASE_DB_PASSWORD``, and a real (non-dry) run of
either target needs the 4 ``SUPABASE_STORAGE_S3_*`` credentials, because the downloaded
bytes are kept in a private Supabase Storage bucket. All of them live in the gitignored
``.env`` at the repository root. A dry run needs neither.

Design: ``docs/architecture/campaign-finance-system-design.md`` §2.2 (Lobbying) and §4
(Ingestion: snapshot and replace).
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
from alethical.pipeline.lobbying_expenditures import (  # noqa: E402
    LobbyingRefusal,
    load_lobbying_expenditures,
)


def main() -> int:
    parser = argparse.ArgumentParser(
        description=(
            "Fetch Minnesota's lobbying principal-expenditure download, check it, and "
            "publish it as a dated set that replaces the previous one."
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
    args = parser.parse_args()

    database_url = normalize_database_url(
        args.database_url or database_url_for_target(args.target)
    )
    engine = create_engine(
        database_url, echo=False, connect_args=NO_PREPARED_STATEMENTS
    )
    with Session(engine) as session:
        try:
            report = load_lobbying_expenditures(
                session,
                dry_run=args.dry_run,
                publish_hash=args.publish_hash,
                log=lambda message: print(message, file=sys.stderr),
            )
        except LobbyingRefusal as refusal:
            print(f"refused: {refusal}", file=sys.stderr)
            return 1

    print(report.summary())
    if report.refusal:
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
