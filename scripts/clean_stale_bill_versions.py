#!/usr/bin/env python3
"""One-time cleanup of stale/orphan bill_version rows that coexist with real versions (#531).

Why this exists: two shapes of leftover bill_version row sit alongside a bill's
real versions and surface as a phantom entry on the Versions tab.

  Flavor 1 — version_code='current' rows. The ingest fallback (minnesota.py
  upsert_versions_and_sections) synthesizes a version_code="current" row when the
  Revisor hasn't posted text yet; later, real text got attached to that row and
  then a properly-coded engrossment row superseded it, leaving the "current" row
  as an is_current=False DUPLICATE of the current engrossment (same document_date,
  same text/RAG). (#539 closed that leak at the source going forward.)

  Flavor 2 — bare-code twins from the #467 namespacing (2 known: HF1141 `a`,
  HF3379 `2`). #467 namespaced non-official tracks to `ue-<n>` / `ccr-<x>` and
  re-ingested, but where a pre-fix ue/ccr row sat on a bare code with no official
  sibling to reclaim it, the bare row lingers next to its namespaced twin.

IMPORTANT — the original #531 audit's premise ("~6942 current rows, all
text-empty placeholders, none is_current") did NOT hold against production, which
is why the gates below are load-bearing, not decorative:
  * ~6466 version_code='current' rows are themselves is_current — the bill's LIVE
    text-bearing version (its real sections/RAG were attached to the "current" row
    rather than to a separate code). Deleting one would blank live retrieval for
    that bill. These are excluded by the is_current filter and never touched.
  * The genuinely stale set is the is_current=False "current" rows that coexist
    with a real version (~476). They are NOT text-empty — they carry the same
    engrossment text + RAG as their properly-coded is_current sibling, so removing
    them (RAG subtree included) is a no-op for live answers (retrieval filters
    is_current — confirmed with the #377 RAG session) and removes a latent
    version-mixing risk.

Deleting a bill_version requires clearing its dependents first — all ON DELETE
NO ACTION. Per the #377 RAG session, the RAG side is a 3-level subtree
(rag_chunk_embedding -> rag_chunk -> rag_section_document). Full delete order per
orphan version, bottom-up:
    rag_chunk_embedding -> rag_chunk -> rag_section_document
    -> bill_version_section -> bill_version

Safe by construction (three gates, each reported):
  * Candidates are enumerated by shape, never "anything absent from a fetch".
  * Gate 1: ABORT if ANY candidate is is_current (would blank live retrieval).
  * Gate 2: EXCLUDE any candidate carrying ai_enrichment rows — its AI summary
    lives on the "current" row, so deleting it needs separate coordination.
  * Gate 3: EXCLUDE any "current" row lacking a date-matched coded sibling — it
    may be the sole copy of that text rather than a safe duplicate.
  * The final bill_version delete carries a redundant is_current=false guard.
  * Writes a JSON snapshot of every deleted id + its counts BEFORE deleting.
  * All deletes for a run happen in one transaction.

Usage:
    # dry run (default) — enumerate candidates + counts, write nothing
    ALETHICAL_DATABASE_TARGET=production uv run python scripts/clean_stale_bill_versions.py

    # write a snapshot of the enumerated candidates without deleting
    ALETHICAL_DATABASE_TARGET=production uv run python scripts/clean_stale_bill_versions.py \
        --snapshot-file /tmp/stale-versions-531.json

    # scoped live check — clean a single bill first, read back, then run the rest
    ALETHICAL_DATABASE_TARGET=production uv run python scripts/clean_stale_bill_versions.py \
        --apply --bill-key 94-2026-HF3379 --snapshot-file /tmp/hf3379.json

    # apply to all candidates
    ALETHICAL_DATABASE_TARGET=production uv run python scripts/clean_stale_bill_versions.py \
        --apply --snapshot-file /tmp/stale-versions-531.json
"""

from __future__ import annotations

import argparse
import json
import os
import re

from sqlalchemy import create_engine, delete, func, select
from sqlalchemy.orm import Session, aliased

from alethical.db.models import (
    AIEnrichment,
    Bill,
    BillVersion,
    BillVersionSection,
    RagChunk,
    RagChunkEmbedding,
    RagSectionDocument,
)
from alethical.db.session import (
    NO_PREPARED_STATEMENTS,
    database_url_for_target,
    normalize_database_url,
)

# Matches the #467 namespaced codes; the capture group is the bare-code twin.
NAMESPACED_CODE = re.compile(r"^(?:ue|ccr)-(.+)$")


def _counts_batch(session: Session, version_ids: list) -> dict[str, dict[str, int]]:
    """Dependent-row counts for every candidate, as 5 GROUP BY queries (not 5*N).

    Returns {version_id_str: {sections, rag_section_documents, rag_chunks,
    rag_chunk_embeddings, ai_enrichment}}; versions with no dependents simply
    don't appear in the grouped results and default to 0 in the caller.
    """
    out: dict[str, dict[str, int]] = {}

    def _tally(key: str, rows) -> None:
        for version_id, count in rows:
            out.setdefault(str(version_id), {})[key] = count

    _tally(
        "sections",
        session.execute(
            select(BillVersionSection.bill_version_id, func.count())
            .where(BillVersionSection.bill_version_id.in_(version_ids))
            .group_by(BillVersionSection.bill_version_id)
        ).all(),
    )
    _tally(
        "rag_section_documents",
        session.execute(
            select(RagSectionDocument.bill_version_id, func.count())
            .where(RagSectionDocument.bill_version_id.in_(version_ids))
            .group_by(RagSectionDocument.bill_version_id)
        ).all(),
    )
    _tally(
        "rag_chunks",
        session.execute(
            select(RagSectionDocument.bill_version_id, func.count())
            .join(RagChunk, RagChunk.rag_section_document_id == RagSectionDocument.id)
            .where(RagSectionDocument.bill_version_id.in_(version_ids))
            .group_by(RagSectionDocument.bill_version_id)
        ).all(),
    )
    _tally(
        "rag_chunk_embeddings",
        session.execute(
            select(RagSectionDocument.bill_version_id, func.count())
            .join(RagChunk, RagChunk.rag_section_document_id == RagSectionDocument.id)
            .join(RagChunkEmbedding, RagChunkEmbedding.rag_chunk_id == RagChunk.id)
            .where(RagSectionDocument.bill_version_id.in_(version_ids))
            .group_by(RagSectionDocument.bill_version_id)
        ).all(),
    )
    _tally(
        "ai_enrichment",
        session.execute(
            select(AIEnrichment.bill_version_id, func.count())
            .where(AIEnrichment.bill_version_id.in_(version_ids))
            .group_by(AIEnrichment.bill_version_id)
        ).all(),
    )
    return out


def _find_candidates(session: Session, bill_key: str | None) -> list[dict]:
    """Enumerate stale rows by shape (flavor 1 + flavor 2)."""
    bill_filter = []
    if bill_key:
        bill_filter.append(Bill.bill_key == bill_key)

    candidate_ids: set = set()

    # Flavor 1: version_code='current' on a bill that ALSO has a real version.
    # The exists() correlates on the outer BillVersion's bill_id via an alias.
    real = aliased(BillVersion)
    real_exists = (
        select(1)
        .where(
            real.bill_id == BillVersion.bill_id,
            real.version_code != "current",
        )
        .correlate(BillVersion)
        .exists()
    )
    # Only a NON-current "current" row is a stale extra. A "current" row that is
    # itself is_current is the bill's live text-bearing version (thousands of bills
    # in prod attached their real sections/RAG to the "current" row rather than to a
    # separate code) — deleting it would blank retrieval, so it is never a candidate.
    flavor1_stmt = select(BillVersion.id).where(
        BillVersion.version_code == "current",
        BillVersion.is_current.is_(False),
        real_exists,
    )
    if bill_key:
        flavor1_stmt = flavor1_stmt.join(Bill, Bill.id == BillVersion.bill_id).where(
            Bill.bill_key == bill_key
        )
    candidate_ids.update(session.execute(flavor1_stmt).scalars())

    # Flavor 2: a bare-code row whose namespaced twin (`ue-*`/`ccr-*`) exists on the
    # same bill with the same version_name. The bare row is the un-reclaimed orphan.
    namespaced = session.execute(
        select(
            BillVersion.id,
            BillVersion.bill_id,
            BillVersion.version_code,
            BillVersion.version_name,
        )
        .join(Bill, Bill.id == BillVersion.bill_id)
        .where(
            (BillVersion.version_code.like("ue-%"))
            | (BillVersion.version_code.like("ccr-%")),
            *bill_filter,
        )
    ).all()
    for _ns_id, ns_bill_id, ns_code, ns_name in namespaced:
        m = NAMESPACED_CODE.match(ns_code or "")
        if not m:
            continue
        bare_code = m.group(1)
        twin = session.scalar(
            select(BillVersion.id).where(
                BillVersion.bill_id == ns_bill_id,
                BillVersion.version_code == bare_code,
                BillVersion.version_name == ns_name,
            )
        )
        if twin is not None:
            candidate_ids.add(twin)

    if not candidate_ids:
        return []

    ids = list(candidate_ids)
    counts = _counts_batch(session, ids)
    # Bulk-load the candidate versions + their bills in two queries.
    versions = session.execute(
        select(BillVersion).where(BillVersion.id.in_(ids))
    ).scalars()
    versions = list(versions)
    bill_ids = {v.bill_id for v in versions}
    bills = {
        b.id: b
        for b in session.execute(select(Bill).where(Bill.id.in_(bill_ids))).scalars()
    }
    # For every candidate bill, the set of document_dates carried by its
    # NON-"current" versions. A stale "current" row is only a safe delete if the
    # identical posting survives under a properly-coded sibling — proven by a
    # sibling sharing its exact document_date (verified on samples: the "current"
    # duplicate's date equals the is_current engrossment's, e.g. HF1 "4th
    # Engrossment" == code "4"). A "current" row with no date-matched coded sibling
    # may be the sole copy of that text, so it is held back, not deleted.
    coded_dates: dict = {}
    for bid, dt in session.execute(
        select(BillVersion.bill_id, BillVersion.document_date).where(
            BillVersion.bill_id.in_(bill_ids),
            BillVersion.version_code != "current",
        )
    ).all():
        coded_dates.setdefault(bid, set()).add(dt)

    zero = {
        "sections": 0,
        "rag_section_documents": 0,
        "rag_chunks": 0,
        "rag_chunk_embeddings": 0,
        "ai_enrichment": 0,
    }
    rows = []
    for version in versions:
        # Flavor-2 twins are name-matched to a namespaced sibling already; flavor-1
        # "current" rows must have a date-matched coded sibling to be deletable.
        has_dupe = version.version_code != "current" or (
            version.document_date in coded_dates.get(version.bill_id, set())
        )
        rows.append(
            {
                "bill_version_id": str(version.id),
                "bill_key": bills[version.bill_id].bill_key,
                "version_code": version.version_code,
                "version_name": version.version_name,
                "is_current": version.is_current,
                "document_date": (
                    version.document_date.isoformat() if version.document_date else None
                ),
                "has_coded_duplicate": has_dupe,
                **{**zero, **counts.get(str(version.id), {})},
            }
        )
    rows.sort(key=lambda r: (r["bill_key"], r["version_code"]))
    return rows


def _delete_subtree(session: Session, version_ids: list) -> None:
    """Delete the RAG subtree + sections for the given bill_version ids, bottom-up.

    Raw DELETE ... WHERE ... IN (subquery) to avoid loading rows; order matters
    because every FK is ON DELETE NO ACTION.
    """
    section_docs = (
        select(RagSectionDocument.id)
        .where(RagSectionDocument.bill_version_id.in_(version_ids))
        .scalar_subquery()
    )
    chunks = (
        select(RagChunk.id)
        .where(RagChunk.rag_section_document_id.in_(section_docs))
        .scalar_subquery()
    )
    session.execute(
        delete(RagChunkEmbedding).where(RagChunkEmbedding.rag_chunk_id.in_(chunks))
    )
    session.execute(
        delete(RagChunk).where(RagChunk.rag_section_document_id.in_(section_docs))
    )
    session.execute(
        delete(RagSectionDocument).where(
            RagSectionDocument.bill_version_id.in_(version_ids)
        )
    )
    session.execute(
        delete(BillVersionSection).where(
            BillVersionSection.bill_version_id.in_(version_ids)
        )
    )
    session.execute(
        delete(BillVersion).where(
            BillVersion.id.in_(version_ids),
            BillVersion.is_current.is_(False),  # belt-and-suspenders
        )
    )


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Remove stale/orphan bill_version rows coexisting with real versions (#531)."
    )
    parser.add_argument("--database-url", default=os.environ.get("DATABASE_URL"))
    parser.add_argument(
        "--apply",
        action="store_true",
        help="Delete the rows. Without this flag the script only reports (dry run).",
    )
    parser.add_argument(
        "--bill-key",
        default=None,
        help="Limit to a single bill (e.g. 94-2026-HF3379) for a scoped live check.",
    )
    parser.add_argument(
        "--snapshot-file",
        default=None,
        help="Write the enumerated candidates (ids + counts) to this JSON path "
        "before deleting. Strongly recommended with --apply.",
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
        candidates = _find_candidates(session, args.bill_key)
        print(f"stale bill_version candidates: {len(candidates)}")
        current_total = sum(1 for c in candidates if c["version_code"] == "current")
        twin_total = len(candidates) - current_total
        print(f"  flavor 1 (version_code='current'): {current_total}")
        print(f"  flavor 2 (bare-code #467 twins):   {twin_total}")
        for c in candidates:
            if c["version_code"] != "current" or c["rag_section_documents"]:
                print(
                    f"  {c['bill_key']} code={c['version_code']!r} "
                    f"name={c['version_name']!r} is_current={c['is_current']} "
                    f"sections={c['sections']} rag_docs={c['rag_section_documents']} "
                    f"chunks={c['rag_chunks']} embeddings={c['rag_chunk_embeddings']} "
                    f"ai={c['ai_enrichment']}"
                )

        # Safety gate 1: never touch a current version.
        live = [c for c in candidates if c["is_current"]]
        if live:
            raise SystemExit(
                f"ABORT: {len(live)} candidate(s) are is_current=True — refusing to "
                f"delete a live version. First: {live[0]}"
            )

        # Safety gate 2: leave any candidate with ai_enrichment for manual handling.
        with_ai = [c for c in candidates if c["ai_enrichment"]]
        # Safety gate 3: leave any "current" row lacking a date-matched coded
        # sibling — it may be the sole copy of that text, not a safe duplicate.
        no_dupe = [
            c
            for c in candidates
            if not c["ai_enrichment"] and not c["has_coded_duplicate"]
        ]
        deletable = [
            c for c in candidates if not c["ai_enrichment"] and c["has_coded_duplicate"]
        ]
        if with_ai:
            print(
                f"\nEXCLUDED {len(with_ai)} candidate(s) carrying ai_enrichment rows "
                f"(out of RAG sign-off scope — handle manually):"
            )
            for c in with_ai:
                print(
                    f"  {c['bill_key']} code={c['version_code']!r} ai={c['ai_enrichment']}"
                )
        if no_dupe:
            print(
                f"\nEXCLUDED {len(no_dupe)} 'current' candidate(s) with NO date-matched "
                f"coded sibling (possible sole copy — not a safe duplicate):"
            )
            for c in no_dupe:
                print(
                    f"  {c['bill_key']} code={c['version_code']!r} "
                    f"name={c['version_name']!r} date={c['document_date']}"
                )

        totals = {
            k: sum(c[k] for c in deletable)
            for k in (
                "sections",
                "rag_section_documents",
                "rag_chunks",
                "rag_chunk_embeddings",
            )
        }
        print(
            f"\nwould delete: {len(deletable)} bill_version + "
            f"{totals['sections']} sections + "
            f"{totals['rag_section_documents']} rag_section_documents + "
            f"{totals['rag_chunks']} rag_chunks + "
            f"{totals['rag_chunk_embeddings']} rag_chunk_embeddings"
        )

        if args.snapshot_file:
            with open(args.snapshot_file, "w") as fh:
                json.dump(
                    {
                        "deletable": deletable,
                        "excluded_with_ai": with_ai,
                        "excluded_no_coded_duplicate": no_dupe,
                    },
                    fh,
                    indent=2,
                )
            print(f"snapshot written: {args.snapshot_file}")

        if not args.apply:
            print("\ndry run — no changes written. Re-run with --apply to delete.")
            return

        if not deletable:
            print("\nnothing to delete.")
            return

        version_ids = [c["bill_version_id"] for c in deletable]
        _delete_subtree(session, version_ids)
        session.commit()
        print(
            f"\napplied: deleted {len(version_ids)} stale bill_version rows + subtree."
        )


if __name__ == "__main__":
    main()
