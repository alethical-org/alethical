#!/usr/bin/env python3
"""Restore the sections lost when a bill page repeats one section id (#763).

Why this exists: ingestion used to look a section row up by its id on the page and
reuse whatever it found. A page may give two sections the same id — `laws.0.1.0`
is the id the Revisor hands every section that sits outside an article, and 6 of
the 12 biggest bills repeat it — so the second such section overwrote the first
and only the last survived. Measured on production: **24 current versions are
missing 57 sections**. The importer is fixed (rows are keyed on the section's
position now), but the production ingest is human-triggered and skips
already-ingested bills by default, so nothing re-visits the bills already stored.
This does.

The repair never rewrites a section that is already stored. It inserts only the
missing official rows. That still changes the bill's complete source text, so an
apply also retires the old full summary, rebuilds that bill's search rows, and
records one replacement-summary request for the new text. Those steps share one
database transaction: if search preparation fails, the section insert and summary
retirement roll back too. Search embeddings may use the paid OpenAI API. The
replacement Claude call remains behind the default-off switch and all 4 spending
and failure limits from issue 457.

How a target is found, without fetching anything: the bug leaves an exact
fingerprint. `source_order` holds the section's position on the page, so a version
that lost sections ends up with a highest position larger than its row count.
`scripts/check_bill_section_gaps.py` runs that query on its own.

Primary source, per `.claude/rules/workflow.md` rule 9: each bill's own current
version page, at the URL ingestion recorded (`bill_version.html_url`), parsed with
the same parser the pipeline uses (`parse_bill_text_html`).

Safety, checked per bill before a single row is written:
  * the fetched page URL and exact page hash must match the source artifact linked
    by ordinary ingestion; a changed page needs a re-ingest, not a repair;
  * the page's section count must equal the version's highest stored position — if
    the page has grown or shrunk since ingest, this is an ingestion-freshness gap
    (`.claude/rules/grounded-answers.md` rule 7) and needs a re-ingest, not a repair;
  * every stored row must still match the page at its own position, by section id
    AND by the hash of its body. One mismatch skips the whole bill.
  Together those two mean a filled position is provably the same section it always
  was, so writing only the empty positions cannot disturb any stored text.

Scope: current versions only — that is what the Bill Text tab renders, what the
search index re-anchors to, and what the AI summary reads. Superseded versions are
missing another 119 sections between them; nothing in the product reads those, and
a re-ingest never revisits them either, so they are reported and left alone.

Safe + idempotent: a second run finds no empty positions and writes nothing.

Usage (run from the repo root; PYTHONPATH=. so `alethical` imports as a file):
    # dry run (default) — reports what would change, writes nothing
    ALETHICAL_DATABASE_TARGET=production PYTHONPATH=. uv run \
        python scripts/repair_missing_bill_sections.py

    # scoped live check — one bill first, then read it back before the full run
    ALETHICAL_DATABASE_TARGET=production PYTHONPATH=. uv run \
        python scripts/repair_missing_bill_sections.py \
        --apply --bill-key 94-2025-SF3045

    # full apply
    ALETHICAL_DATABASE_TARGET=production PYTHONPATH=. uv run \
        python scripts/repair_missing_bill_sections.py --apply
"""

from __future__ import annotations

import argparse
import asyncio
import os
import time

from sqlalchemy import create_engine, select, text
from sqlalchemy.orm import Session

from alethical.db.models import (
    ArtifactType,
    Bill,
    BillVersion,
    BillVersionSection,
    SourceArtifact,
)
from alethical.db.session import (
    NO_PREPARED_STATEMENTS,
    database_url_for_target,
    normalize_database_url,
)
from alethical.pipeline.minnesota import (
    content_hash,
    fetch_text,
    http_session,
    parse_bill_text_html,
    replace_bill_version_prompt_context,
)

# Seconds between page fetches. The pages are public and a repair is at most a few
# dozen of them, so there is no reason to hurry the Revisor.
FETCH_PAUSE = 0.8

# Versions that lost sections: the highest stored position exceeds the row count.
TARGETS_SQL = """
select b.id as bill_id, b.bill_key, v.id as version_id, v.version_code, v.is_current, v.html_url,
       count(*) as stored, max(s.source_order) as page_sections
from bill_version_section s
join bill_version v on v.id = s.bill_version_id
join bill b on b.id = v.bill_id
where v.html_url is not null
group by 1, 2, 3, 4, 5, 6
having max(s.source_order) > count(*)
order by (max(s.source_order) - count(*)) desc, b.bill_key
"""


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Restore sections lost to a repeated section id (#763)."
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
        help="Limit to a single bill (e.g. 94-2025-SF3045) for a scoped live check.",
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
        rows = session.execute(text(TARGETS_SQL)).all()
        targets = [row for row in rows if row.is_current]
        superseded = [row for row in rows if not row.is_current]
        if args.bill_key:
            targets = [row for row in targets if row.bill_key == args.bill_key]

        print(
            f"current versions missing sections: {len(targets)} "
            f"({sum(r.page_sections - r.stored for r in targets)} sections)"
        )
        if superseded and not args.bill_key:
            print(
                f"superseded versions missing sections: {len(superseded)} "
                f"({sum(r.page_sections - r.stored for r in superseded)} sections) "
                f"— out of scope, nothing in the product reads them"
            )

        http = http_session()
        inserted_total = 0
        repaired: list[str] = []
        skipped: list[str] = []
        ready_summary_request_ids: list[str] = []

        for target in targets:
            label = f"{target.bill_key} v{target.version_code}"
            try:
                page = fetch_text(http, str(target.html_url))
                parsed = parse_bill_text_html(page, str(target.html_url))
            except Exception as exc:  # noqa: BLE001 - one bad bill mustn't stop the run
                skipped.append(f"{label}: fetch/parse failed ({exc})")
                continue
            finally:
                time.sleep(FETCH_PAUSE)
            sections = parsed["sections"]

            bill_query = select(Bill).where(Bill.id == target.bill_id)
            if args.apply:
                bill_query = bill_query.with_for_update()
            locked_bill = session.scalar(bill_query)
            version = session.scalar(
                select(BillVersion).where(
                    BillVersion.id == target.version_id,
                    BillVersion.bill_id == target.bill_id,
                    BillVersion.is_current.is_(True),
                )
            )
            if locked_bill is None or version is None:
                skipped.append(
                    f"{label}: current bill version disappeared before repair"
                )
                session.rollback()
                continue

            source_artifact = (
                session.get(SourceArtifact, version.source_artifact_id)
                if version.source_artifact_id is not None
                else None
            )
            if (
                version.version_code != target.version_code
                or str(version.html_url or "") != str(target.html_url)
                or source_artifact is None
                or source_artifact.adapter != "minnesota_live"
                or source_artifact.artifact_type != ArtifactType.html
                or source_artifact.source_key != target.bill_key
                or source_artifact.source_url != str(version.html_url)
                or source_artifact.content_hash != content_hash(page)
            ):
                skipped.append(
                    f"{label}: fetched page does not match the exact official page "
                    "saved by ingestion — needs a re-ingest, not a repair"
                )
                session.rollback()
                continue

            stored_rows = session.scalars(
                select(BillVersionSection)
                .where(BillVersionSection.bill_version_id == target.version_id)
                .order_by(BillVersionSection.source_order.asc())
            ).all()
            by_position = {row.source_order: row for row in stored_rows}

            if len(sections) != target.page_sections:  # type: ignore[arg-type]
                skipped.append(
                    f"{label}: page now has {len(sections)} sections, stored "  # type: ignore[arg-type]
                    f"positions go up to {target.page_sections} — needs a re-ingest, "
                    f"not a repair"
                )
                continue

            mismatch = next(
                (
                    row
                    for row in stored_rows
                    if str(sections[row.source_order - 1]["section_id"])  # type: ignore[index]
                    != row.section_id_text
                    or content_hash(str(sections[row.source_order - 1]["text"]))  # type: ignore[index]
                    != row.source_hash
                ),
                None,
            )
            if mismatch is not None:
                skipped.append(
                    f"{label}: stored section at position {mismatch.source_order} "
                    f"({mismatch.section_id_text}) no longer matches the page — "
                    f"needs a re-ingest, not a repair"
                )
                continue

            article_lookup: dict[str, dict] = {}
            for article in parsed["articles"]:  # type: ignore[union-attr]
                for article_section in article.get("sections", []):
                    article_lookup[str(article_section["section_id"])] = article

            missing = [
                (position, sections[position - 1])  # type: ignore[index]
                for position in range(1, len(sections) + 1)  # type: ignore[arg-type]
                if position not in by_position
            ]
            for position, section in missing:
                article = article_lookup.get(str(section["section_id"]), {})
                session.add(
                    BillVersionSection(
                        bill_version_id=target.version_id,
                        section_id_text=str(section["section_id"]),
                        source_order=position,
                        article_id_text=str(article.get("article_id") or "") or None,
                        article_number=str(article.get("article_number") or "") or None,
                        article_heading=str(article.get("article_heading") or "")
                        or None,
                        section_heading=str(section.get("heading") or "") or None,
                        statute_heading=str(section.get("statute_heading") or "")
                        or None,
                        cite_heading=str(section.get("cite_heading") or "") or None,
                        effective_date_heading=str(
                            section.get("effective_date_heading") or ""
                        )
                        or None,
                        raw_text=str(section["text"]),
                        source_hash=content_hash(str(section["text"])),
                        body_blocks=section.get("blocks") or None,
                    )
                )
            inserted_total += len(missing)
            repaired.append(
                f"{label}: page {len(sections)} sections, "  # type: ignore[arg-type]
                f"stored {target.stored} -> {target.stored + len(missing)} "
                f"(+{len(missing)} at positions "
                f"{', '.join(str(p) for p, _ in missing)})"
            )
            if args.apply:
                from alethical.pipeline.bill_summary_requests import (
                    register_official_text_change,
                )
                from alethical.pipeline.rag_ingest import (
                    build_rag_rows_for_bill_keys,
                )

                session.flush()
                replace_bill_version_prompt_context(session, version, parsed)
                session.flush()
                summary_request = register_official_text_change(session, locked_bill)
                if summary_request is not None:
                    ready_summary_request_ids.append(str(summary_request.id))
                rag_stats = build_rag_rows_for_bill_keys(
                    session,
                    [target.bill_key],
                    dry_run=False,
                    database_target=os.environ.get("ALETHICAL_DATABASE_TARGET"),
                )
                ready_summary_request_ids.extend(
                    rag_stats.get("ready_summary_request_ids", [])
                )
                session.commit()
            else:
                session.rollback()

        verb = "inserted" if args.apply else "would insert"
        print(f"\n{verb} {inserted_total} sections across {len(repaired)} versions.")
        for line in repaired:
            print(f"    {line}")
        if skipped:
            print(f"\nskipped {len(skipped)} versions:")
            for line in skipped:
                print(f"    {line}")
        if not args.apply:
            print("\ndry run — no changes written. Re-run with --apply to write.")
        elif inserted_total:
            print(
                "\nThe repaired official text and matching search rows were saved together."
            )

    if ready_summary_request_ids:
        from alethical.pipeline.bill_summary_requests import enqueue_ready_requests

        asyncio.run(
            enqueue_ready_requests(
                ready_summary_request_ids,
                database_target=os.environ.get("ALETHICAL_DATABASE_TARGET") or "local",
                database_url=database_url if args.database_url else None,
            )
        )


if __name__ == "__main__":
    main()
