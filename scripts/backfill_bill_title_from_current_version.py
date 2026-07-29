#!/usr/bin/env python3
"""Repair bill.title on rows the write-once ingestion bug left stale (#708).

Why this exists (one-time data fix, no money, free public source): until #708,
`bill.title` was assigned only inside the `if bill is None:` branch that creates
the Bill row (minnesota.py upsert_bill), while every neighbouring mutable field
(description, current_status, latest_action_at, official_url) was re-assigned on
every run. Minnesota bills are routinely gutted and replaced mid-session, so a
bill whose title changed after introduction kept the introduced title forever —
SF 334's page said "relating to education" while the enacted law (2026 ch. 120)
is about a Human Services Systems Modernization Advisory Council.

The code fix stops new drift but does not repair the rows already stored: the
production ingest is human-triggered and skips already-ingested bills by default
(`only_missing`), so nothing re-visits them. This script does the repair.

Primary source, per `.claude/rules/workflow.md` rule 9: for each bill it re-fetches
the bill's own status XML from the MN Revisor (the URL the ingest recorded), takes
the LAST entry of TEXT_VERSION_LIST — the bill's current version — and reads the
title off that version's own page with the same parser the pipeline uses
(`parse_bill_text_html` -> `bill_title_text`). No scraper heuristics of its own.

Scope discipline — this repairs the write-once bug and nothing else:
  * a bill whose current version on Revisor is NEWER than the one we ingested is
    reported and SKIPPED, not rewritten. Writing a title from a version whose
    text, sections and status we never ingested would leave the row describing
    one version and rendering another; that is an ingestion-freshness gap
    (`.claude/rules/grounded-answers.md` rule 7), fixed by re-ingesting the bill.
  * an empty or unparseable title never overwrites a stored one.

Safe + idempotent by construction: it only writes where the current version's
title differs from what is stored, so a second run is a no-op. Every fetch is the
same free public request the ingest already makes.

Usage (run from the repo root; PYTHONPATH=. so `alethical` imports as a file):
    # dry run (default) — reports what would change, writes nothing
    ALETHICAL_DATABASE_TARGET=production PYTHONPATH=. uv run \
        python scripts/backfill_bill_title_from_current_version.py

    # scoped live check — one bill first, then read it back before the full run
    ALETHICAL_DATABASE_TARGET=production PYTHONPATH=. uv run \
        python scripts/backfill_bill_title_from_current_version.py \
        --apply --bill-key 94-2025-SF334

    # full apply
    ALETHICAL_DATABASE_TARGET=production PYTHONPATH=. uv run \
        python scripts/backfill_bill_title_from_current_version.py --apply
"""

from __future__ import annotations

import argparse
import os
import threading
from concurrent.futures import ThreadPoolExecutor

from sqlalchemy import create_engine, select, update
from sqlalchemy.orm import Session

from alethical.db.models import ArtifactType, Bill, BillAction, SourceArtifact
from alethical.db.session import (
    NO_PREPARED_STATEMENTS,
    database_url_for_target,
    normalize_database_url,
)
from alethical.pipeline.minnesota import (
    fetch_text,
    http_session,
    parse_bill_text_html,
    parse_bill_xml,
)


class Outcome:
    """What the primary source says about one bill, or why it couldn't say."""

    def __init__(
        self,
        bill_key: str,
        title: str = "",
        current_url: str = "",
        error: str = "",
    ) -> None:
        self.bill_key = bill_key
        self.title = title
        self.current_url = current_url
        self.error = error


def resolve(http, bill_key: str, xml_url: str) -> Outcome:
    """Fetch the bill's current-version title straight from the Revisor."""
    try:
        canonical = parse_bill_xml(fetch_text(http, xml_url))
    except Exception as exc:  # noqa: BLE001 - one bad bill mustn't stop the run
        return Outcome(bill_key, error=f"status XML fetch/parse failed ({exc})")

    versions = list(canonical.get("text_versions", []))
    if not versions:
        return Outcome(bill_key, error="status XML lists no text versions")
    current_url = str(versions[-1].get("html_uri") or "")
    if not current_url:
        return Outcome(bill_key, error="current version has no html_uri")

    try:
        parsed = parse_bill_text_html(fetch_text(http, current_url), current_url)
    except Exception as exc:  # noqa: BLE001 - one bad bill mustn't stop the run
        return Outcome(
            bill_key, current_url=current_url, error=f"text fetch failed ({exc})"
        )

    title = str(parsed.get("bill_title_text") or "").strip()
    if not title:
        return Outcome(
            bill_key, current_url=current_url, error="version page has no bill_title"
        )
    return Outcome(bill_key, title=title, current_url=current_url)


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Repair bill.title from each bill's current version (#708)."
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
        help="Limit to a single bill (e.g. 94-2025-SF334) for a scoped live check.",
    )
    parser.add_argument(
        "--limit", type=int, default=None, help="Process at most N bills (for testing)."
    )
    parser.add_argument(
        "--workers",
        type=int,
        default=6,
        help="Concurrent fetches against the Revisor (default 6; keep it modest).",
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
        # The status XML URL the ingest actually fetched for this bill. Never
        # guessed — a bill with no recorded XML artifact is skipped and reported.
        bills_stmt = select(
            Bill.id, Bill.bill_key, Bill.title, Bill.official_url
        ).order_by(Bill.bill_key)
        if args.bill_key:
            bills_stmt = bills_stmt.where(Bill.bill_key == args.bill_key)
        if args.limit:
            bills_stmt = bills_stmt.limit(args.limit)
        bills = session.execute(bills_stmt).all()
        print(f"bills to scan: {len(bills)}")

        # Bill carries no XML artifact of its own; its actions do. Same join the
        # committee-name backfill uses (scripts/backfill_bill_action_committee_name.py).
        xml_urls: dict[str, str] = {}
        for key, url in session.execute(
            select(Bill.bill_key, SourceArtifact.source_url)
            .join(BillAction, BillAction.bill_id == Bill.id)
            .join(SourceArtifact, SourceArtifact.id == BillAction.source_artifact_id)
            .where(SourceArtifact.artifact_type == ArtifactType.xml)
        ).all():
            xml_urls.setdefault(key, url)

        targets = [(b, xml_urls.get(b.bill_key)) for b in bills]
        no_xml = [b.bill_key for b, url in targets if not url]
        fetchable = [(b, url) for b, url in targets if url]

        http = http_session()
        lock = threading.Lock()
        done = [0]

        def work(pair) -> tuple[object, Outcome]:
            bill, url = pair
            outcome = resolve(http, bill.bill_key, str(url))
            with lock:
                done[0] += 1
                if done[0] % 250 == 0:
                    print(f"  ... resolved {done[0]}/{len(fetchable)}")
            return bill, outcome

        with ThreadPoolExecutor(max_workers=max(1, args.workers)) as pool:
            resolved = list(pool.map(work, fetchable))

        updates: list[tuple[object, Outcome]] = []
        newer_version: list[tuple[object, Outcome]] = []
        errors: list[Outcome] = []
        already_correct = 0

        for bill, outcome in resolved:
            if outcome.error:
                errors.append(outcome)
                continue
            if outcome.current_url != (bill.official_url or ""):
                # Revisor has moved on since our last ingest of this bill. Out of
                # scope here — see the module docstring.
                newer_version.append((bill, outcome))
                continue
            if outcome.title == (bill.title or ""):
                already_correct += 1
                continue
            updates.append((bill, outcome))

        for bill, outcome in updates:
            print(f"\n{bill.bill_key}  {outcome.current_url}")
            print(f"   stored:  {bill.title}")
            print(f"   current: {outcome.title}")
            if args.apply:
                session.execute(
                    update(Bill).where(Bill.id == bill.id).values(title=outcome.title)
                )

        if args.apply:
            session.commit()

        verb = "updated" if args.apply else "would update"
        print(f"\n{verb}: {len(updates)} bill titles.")
        print(f"already matching the current version: {already_correct}")
        if newer_version:
            print(
                f"skipped — Revisor has a newer version than we ingested: "
                f"{len(newer_version)} bills (ingestion-freshness gap, not this bug)"
            )
            for bill, outcome in newer_version[:20]:
                print(
                    f"    {bill.bill_key}: ours {bill.official_url} -> {outcome.current_url}"
                )
            if len(newer_version) > 20:
                print(f"    ... and {len(newer_version) - 20} more")
        if no_xml:
            print(f"skipped (no recorded status-XML artifact): {len(no_xml)} bills.")
        if errors:
            print(f"fetch/parse errors (skipped): {len(errors)} bills.")
            for outcome in errors[:20]:
                print(f"    {outcome.bill_key}: {outcome.error}")
        if not args.apply:
            print("\ndry run — no changes written. Re-run with --apply to write.")


if __name__ == "__main__":
    main()
