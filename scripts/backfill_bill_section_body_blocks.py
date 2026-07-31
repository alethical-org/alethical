#!/usr/bin/env python3
"""Fill bill_version_section.body_blocks from each bill's page on the Revisor (#741, #752).

Why this exists: ingestion stores a section's body as one flat string, which
throws away the subdivision numbers ("Subd. 2."), the marks saying which words the
bill *adds*, and the row/column shape of appropriation tables. The parser now
keeps all three in `body_blocks`, but only for bills ingested after that landed —
the production ingest is human-triggered and skips already-ingested bills by
default (`only_missing`), so nothing re-visits the ~10,400 bills already stored.
This does.

**It never writes `raw_text`, and that is the point, not a detail.** Two paid
caches hash that column: every section's search embedding (`rag_ingest.py:104`
hashes `raw_text`; `:172` re-embeds on a mismatch) and every bill's AI summary
(`ai_enrichment.py:350` folds the same hash into `source_version_hash`, and
`should_enqueue` re-runs a bill whose hash moved). Writing only `body_blocks`
means no hash can change, so this run costs nothing beyond time and polite rate
limiting — no re-embed, no re-summarisation.

Primary source, per `.claude/rules/workflow.md` rule 9: each bill's own current
version page, at the URL ingestion recorded (`bill_version.html_url`), parsed with
the same parser the pipeline uses (`parse_bill_text_html`).

Scope discipline:
  * only the current version of each bill, matching what the Bill Text tab reads;
  * a stored row whose position is absent from the page is reported and skipped —
    that means the page has moved on since ingest, which is an ingestion-freshness
    gap (`.claude/rules/grounded-answers.md` rule 7), not this script's job;
  * blocks are matched to a row by the section's POSITION on the page, not by its
    id, because a page may repeat one id — `laws.0.1.0` is what the Revisor hands
    every section outside an article, and 6 of the 12 largest bills repeat it
    (#763). Matching by id would copy the last repeat's blocks onto every row
    sharing that id, so the structured body would disagree with the flat text
    stored beside it.

Safe + idempotent: writes a section only when its blocks differ from what is
stored, so a second run is a no-op. Free, resumable, and reversible (the column is
nullable and nothing else reads it yet).

Usage (run from the repo root; PYTHONPATH=. so `alethical` imports as a file):
    # dry run (default) — reports what would change, writes nothing
    ALETHICAL_DATABASE_TARGET=production PYTHONPATH=. uv run \
        python scripts/backfill_bill_section_body_blocks.py

    # scoped live check — one bill first, then read it back before the full run
    ALETHICAL_DATABASE_TARGET=production PYTHONPATH=. uv run \
        python scripts/backfill_bill_section_body_blocks.py \
        --apply --bill-key 94-2025-HF1157

    # full apply
    ALETHICAL_DATABASE_TARGET=production PYTHONPATH=. uv run \
        python scripts/backfill_bill_section_body_blocks.py --apply
"""

from __future__ import annotations

import argparse
import os
import threading
import time
from concurrent.futures import ThreadPoolExecutor

from sqlalchemy import create_engine, select, update
from sqlalchemy.orm import Session

from alethical.db.models import Bill, BillVersion, BillVersionSection
from alethical.db.session import (
    NO_PREPARED_STATEMENTS,
    database_url_for_target,
    normalize_database_url,
)
from alethical.pipeline.minnesota import fetch_text, http_session, parse_bill_text_html

# The Revisor serves these pages happily at a handful of concurrent requests
# (the title backfill uses 6), and a page can be 2 MB, so keep it modest.
DEFAULT_WORKERS = 6
PROGRESS_EVERY = 200
# Bills per fetch-then-write batch. Small enough that a couple of 2 MB omnibus
# pages are never all in memory at once, big enough to keep the pool busy.
BATCH_SIZE = 50


def blocks_by_section(page_html: str, url: str) -> dict[int, list]:
    """Each section's blocks, keyed by its 1-based position on the page.

    Position, not section id: a page may give two sections the same id (#763), and
    keying by id would copy the last repeat's blocks onto every row sharing it.
    """
    parsed = parse_bill_text_html(page_html, url)
    return {
        position: list(section["blocks"])
        for position, section in enumerate(parsed["sections"], start=1)  # type: ignore[arg-type]
    }


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Fill bill_version_section.body_blocks from the Revisor (#741)."
    )
    parser.add_argument("--database-url", default=os.environ.get("DATABASE_URL"))
    parser.add_argument(
        "--apply",
        action="store_true",
        help="Write the changes. Without this flag the script only reports (dry run).",
    )
    parser.add_argument(
        "--bill-key",
        default=None,
        help="Limit to a single bill (e.g. 94-2025-HF1157) for a scoped live check.",
    )
    parser.add_argument(
        "--limit", type=int, default=None, help="Process at most N bills (for testing)."
    )
    parser.add_argument(
        "--only-missing",
        action="store_true",
        help="Skip bills whose sections already all carry blocks (for resuming).",
    )
    parser.add_argument(
        "--workers", type=int, default=DEFAULT_WORKERS, help="Concurrent page fetches."
    )
    args = parser.parse_args()

    database_url = normalize_database_url(
        args.database_url
        or database_url_for_target(os.environ.get("ALETHICAL_DATABASE_TARGET"))
    )
    engine = create_engine(
        database_url, echo=False, connect_args=NO_PREPARED_STATEMENTS
    )

    with Session(engine) as session:
        has_sections = (
            select(BillVersionSection.id)
            .where(BillVersionSection.bill_version_id == BillVersion.id)
            .exists()
        )
        versions_stmt = (
            select(Bill.bill_key, BillVersion.id, BillVersion.html_url)
            .join(BillVersion, BillVersion.bill_id == Bill.id)
            .where(
                BillVersion.is_current.is_(True),
                BillVersion.html_url.isnot(None),
                has_sections,
            )
            .order_by(Bill.bill_key)
        )
        if args.bill_key:
            versions_stmt = versions_stmt.where(Bill.bill_key == args.bill_key)
        if args.only_missing:
            versions_stmt = versions_stmt.where(
                select(BillVersionSection.id)
                .where(
                    BillVersionSection.bill_version_id == BillVersion.id,
                    BillVersionSection.body_blocks.is_(None),
                )
                .exists()
            )
        if args.limit:
            versions_stmt = versions_stmt.limit(args.limit)
        targets = session.execute(versions_stmt).all()
        print(f"bills with stored sections to re-read: {len(targets)}")

        http = http_session()
        lock = threading.Lock()
        done = [0]

        def fetch(target):
            bill_key, version_id, html_url = target
            try:
                page = fetch_text(http, str(html_url))
            except Exception as exc:  # noqa: BLE001 - one bad bill mustn't stop the run
                return bill_key, version_id, None, f"page fetch failed ({exc})"
            try:
                blocks = blocks_by_section(page, str(html_url))
            except Exception as exc:  # noqa: BLE001
                return bill_key, version_id, None, f"parse failed ({exc})"
            with lock:
                done[0] += 1
                if done[0] % PROGRESS_EVERY == 0:
                    print(f"  ... read {done[0]}/{len(targets)} bills")
            # Polite pacing on top of the modest worker count.
            time.sleep(0.2)
            return bill_key, version_id, blocks, ""

        written = 0
        unchanged = 0
        absent_from_page: list[str] = []
        errors: list[str] = []

        # In batches, so a 2 MB omnibus page is never held for the whole run and a
        # stop-and-resume loses at most one batch's fetching.
        with ThreadPoolExecutor(max_workers=max(1, args.workers)) as pool:
            for start in range(0, len(targets), BATCH_SIZE):
                batch = targets[start : start + BATCH_SIZE]
                for bill_key, version_id, blocks, error in pool.map(fetch, batch):
                    if error:
                        errors.append(f"{bill_key}: {error}")
                        continue
                    assert blocks is not None
                    for section in session.scalars(
                        select(BillVersionSection)
                        .where(BillVersionSection.bill_version_id == version_id)
                        .order_by(BillVersionSection.source_order.asc())
                    ).all():
                        fresh = blocks.get(section.source_order)
                        if fresh is None:
                            absent_from_page.append(
                                f"{bill_key} position {section.source_order} "
                                f"({section.section_id_text})"
                            )
                            continue
                        if section.body_blocks == fresh:
                            unchanged += 1
                            continue
                        written += 1
                        if args.apply:
                            session.execute(
                                update(BillVersionSection)
                                .where(BillVersionSection.id == section.id)
                                .values(body_blocks=fresh)
                            )
                if args.apply:
                    session.commit()
                session.expunge_all()

        verb = "wrote" if args.apply else "would write"
        print(f"\n{verb} blocks for {written} sections.")
        print(f"already up to date: {unchanged}")
        if absent_from_page:
            print(
                f"skipped — the page no longer has a section at that position: "
                f"{len(absent_from_page)} sections (ingestion-freshness gap)"
            )
            for item in absent_from_page[:20]:
                print(f"    {item}")
            if len(absent_from_page) > 20:
                print(f"    ... and {len(absent_from_page) - 20} more")
        if errors:
            print(f"fetch/parse errors (skipped): {len(errors)} bills.")
            for item in errors[:20]:
                print(f"    {item}")
        if not args.apply:
            print("\ndry run — no changes written. Re-run with --apply to write.")


if __name__ == "__main__":
    main()
