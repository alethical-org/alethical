#!/usr/bin/env python3
"""Collect large-contribution notices, and which notice windows apply, from the source (#2347).

Net: reads the Minnesota Campaign Finance Board's one page of large-contribution
notices, fetches each notice PDF we do not already hold (once, then kept in the
raw-source-files bucket), and records each notice's fields. Then reads the Secretary of
State's primary and general-election candidate files to record which notice windows do
not apply to which candidates (Minnesota Statutes 10A.20 subd. 5(d)).

A failure keeps every record already held and exits 1, so the workflow opens or
updates an issue. ``--dry-run`` reads the sources and writes nothing anywhere.

Usage::

    PYTHONPATH=. uv run python scripts/collect_campaign_finance_notices.py --target production --dry-run
    PYTHONPATH=. uv run python scripts/collect_campaign_finance_notices.py --target production
"""

from __future__ import annotations

import argparse
import os
import sys
from datetime import UTC, datetime
from pathlib import Path

from sqlalchemy import create_engine, select, text
from sqlalchemy.orm import Session

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from alethical.api.services.campaign_finance_register import sub_types_for  # noqa: E402
from alethical.db import models as schema  # noqa: E402
from alethical.db.session import (  # noqa: E402
    NO_PREPARED_STATEMENTS,
    database_url_for_target,
    normalize_database_url,
)
from alethical.pipeline import campaign_finance_filings as filings  # noqa: E402
from alethical.pipeline import campaign_finance_notices as notices  # noqa: E402
from alethical.pipeline.campaign_finance_reader import live_release  # noqa: E402
from alethical.pipeline.raw_file_store import raw_file_store_from_env  # noqa: E402


def _ballot(http) -> tuple[list, list, list[str]]:
    failures = []
    files = []
    for url in (notices.PRIMARY_CANDIDATES_URL, notices.GENERAL_CANDIDATES_URL):
        try:
            status, body = notices.get_bytes(http, url)
        except Exception as error:  # noqa: BLE001 - reported, never swallowed
            failures.append(f"{url}: {error}")
            files.append([])
            continue
        if status != 200:
            failures.append(f"{url}: HTTP {status}")
            files.append([])
            continue
        files.append(notices.parse_candidate_file(body))
    return files[0], files[1], failures


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--target",
        default=os.environ.get("ALETHICAL_DATABASE_TARGET") or "local",
        choices=("local", "production"),
    )
    parser.add_argument("--database-url", default=None)
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument(
        "--pdf-cache",
        default=None,
        help="A folder of notice PDFs already read. Read from it before asking the "
        "Board, and saved into it after, so a dry run's reads are reused.",
    )
    parser.add_argument(
        "--skip-ballot",
        action="store_true",
        help="Leave the notice windows' ballot exclusions as they are.",
    )
    args = parser.parse_args()

    engine = create_engine(
        normalize_database_url(
            args.database_url or database_url_for_target(args.target)
        ),
        connect_args=NO_PREPARED_STATEMENTS,
    )
    now = datetime.now(UTC)
    http = filings.http_session()
    exit_code = 0
    with Session(engine) as db:
        if not db.execute(
            text("SELECT to_regclass('cf_contribution_notice')")
        ).scalar():
            print(
                "refused: this database has no cf_contribution_notice table. Apply the "
                "migrations (alembic upgrade head).",
                file=sys.stderr,
            )
            return 1
        store = None if args.dry_run else raw_file_store_from_env()
        report = notices.collect_notices(
            db,
            http,
            store,
            dry_run=args.dry_run,
            cache=notices.PdfCache(args.pdf_cache),
            now=now,
        )
        print(
            f"notices listed on the Board's page: {report.listed}; already held: "
            f"{report.already_held}; {'would read' if args.dry_run else 'read and kept'}: "
            f"{report.new}"
        )
        for line in report.page_errors:
            print(f"page problem: {line}")
        for line in report.fetch_failures:
            print(f"could not fetch: {line}")
        for line in report.parse_failures:
            print(f"kept but not shown (could not read every field): {line}")
        if not report.ok:
            exit_code = 1

        if not args.skip_ballot and now.year in notices.NOTICE_WINDOWS:
            primary, general, failures = _ballot(http)
            for line in failures:
                print(f"ballot file problem: {line}")
            if failures:
                exit_code = 1
            else:
                snapshot = filings.live_filings_snapshot(db)
                filers = (
                    db.scalars(
                        select(schema.CampaignFinanceFiler).where(
                            schema.CampaignFinanceFiler.snapshot_id == snapshot.id
                        )
                    ).all()
                    if snapshot is not None
                    else []
                )
                release = live_release(db)
                sub_types = (
                    sub_types_for(db, release, [f.registration_number for f in filers])
                    if release is not None
                    else {}
                )
                decided = notices.record_window_exclusions(
                    db,
                    election_year=now.year,
                    filers=filers,
                    sub_types=sub_types,
                    primary=primary,
                    general=general,
                    dry_run=args.dry_run,
                    now=now,
                )
                counts: dict[tuple[str, str], int] = {}
                for _registration, window, reason in decided:
                    counts[(window, reason)] = counts.get((window, reason), 0) + 1
                print(
                    f"notice windows ruled out for {len({r for r, _, _ in decided})} "
                    f"of {len(filers)} registered filers:"
                )
                for (window, reason), count in sorted(counts.items()):
                    print(f"  {window}: {reason}: {count}")
    return exit_code


if __name__ == "__main__":
    raise SystemExit(main())
