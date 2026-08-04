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
    -> ai_enrichment -> bill_version_section -> bill_version

Safe by construction (three gates, each reported):
  * Candidates are enumerated by shape, never "anything absent from a fetch".
  * Gate 1: ABORT if ANY candidate is is_current (would blank live retrieval).
  * Gate 2: EXCLUDE any candidate whose AI summary is the one on display, or
    whose bill has no live summary to fall back on (see below).
  * Gate 3: EXCLUDE any "current" row lacking a date-matched coded sibling — it
    may be the sole copy of that text rather than a safe duplicate.
  * The final bill_version delete carries a redundant is_current=false guard.
  * Writes a JSON snapshot of every deleted id + its counts BEFORE deleting.
  * All deletes for a run happen in one transaction.

Gate 2 used to exclude any candidate carrying an ``ai_enrichment`` row at all,
which left **15** rows behind on the production run and is what
`#547 <https://github.com/alethical-org/alethical/issues/547>`_ was filed for.
Blanket exclusion was the right call before anyone had looked; having looked, the
question is not *does this row carry a summary* but *is that summary the one a
reader sees*. So the gate now asks two things of a candidate carrying enrichment,
and both must hold:

  1. none of its own enrichment rows is ``is_current`` — it is a superseded copy;
  2. the bill's ``is_current`` version carries its **own** current enrichment —
     so the bill keeps a summary after this row goes.

Measured against production Aug 4 2026, all 15 held rows pass both: each carries
exactly 1 superseded enrichment, each bill's live version carries its own current
one, and all 15 bills read ``has_current_summary = true``. A bill with no summary
is hidden from every list on the site, so failing (2) is the failure this gate
exists to prevent.

Usage, in the order a production run should go:

    # 1. dry run (default) — enumerate candidates + counts, write nothing
    ALETHICAL_DATABASE_TARGET=production uv run python scripts/clean_stale_bill_versions.py

    # 2. prove the backup restores: back up, delete, restore, compare, ROLL BACK
    ALETHICAL_DATABASE_TARGET=production uv run python scripts/clean_stale_bill_versions.py \
        --prove-restore

    # 3. scoped live check — clean a single bill first, read back, then the rest
    ALETHICAL_DATABASE_TARGET=production uv run python scripts/clean_stale_bill_versions.py \
        --apply --bill-key 94-2025-HF100 --backup-dir /tmp/hf100-backup

    # 4. apply to all candidates
    ALETHICAL_DATABASE_TARGET=production uv run python scripts/clean_stale_bill_versions.py \
        --apply --backup-dir ~/.alethical-backups/stale-versions-547

    # the undo
    ALETHICAL_DATABASE_TARGET=production uv run python scripts/clean_stale_bill_versions.py \
        --restore-from ~/.alethical-backups/stale-versions-547

The backup is Postgres's own binary ``COPY`` format, one file per table, because
this subtree includes 1,536-dimension embedding vectors that cost real money to
regenerate and hand-rolled serialisation is exactly where a restore quietly loses
precision. ``--prove-restore`` is what earns the delete: a backup nobody has
restored is a hope, not a backup.
"""

from __future__ import annotations

import argparse
import json
import os
import re
from pathlib import Path

from sqlalchemy import create_engine, func, select, text
from sqlalchemy.engine import make_url
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

# Every table a doomed bill_version owns rows in, in delete order (bottom-up),
# each with the WHERE that selects its rows from a list of version ids. One
# definition, used by the backup, the delete and the restore alike -- so the
# thing that gets backed up cannot drift from the thing that gets deleted, which
# is the only way a backup is worth taking.
DOOMED_ROWS = "bill_version_id = ANY(CAST(:version_ids AS uuid[]))"
DOOMED_DOCS = f"SELECT id FROM rag_section_document WHERE {DOOMED_ROWS}"
SUBTREE: tuple[tuple[str, str], ...] = (
    (
        "rag_chunk_embedding",
        f"rag_chunk_id IN (SELECT id FROM rag_chunk "
        f"WHERE rag_section_document_id IN ({DOOMED_DOCS}))",
    ),
    ("rag_chunk", f"rag_section_document_id IN ({DOOMED_DOCS})"),
    ("rag_section_document", DOOMED_ROWS),
    ("ai_enrichment", DOOMED_ROWS),
    ("bill_version_section", DOOMED_ROWS),
    # The redundant is_current guard: belt and suspenders on the last step.
    ("bill_version", "id = ANY(CAST(:version_ids AS uuid[])) AND is_current = false"),
)


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
    # Gate 2 needs to know which of those enrichments is the one on display, not
    # just how many there are. A candidate holding the live summary is never
    # deletable; a candidate holding a superseded copy is (#547).
    _tally(
        "ai_enrichment_current",
        session.execute(
            select(AIEnrichment.bill_version_id, func.count())
            .where(
                AIEnrichment.bill_version_id.in_(version_ids),
                AIEnrichment.is_current.is_(True),
            )
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

    # Which candidate bills keep a summary once this run is done: the bill's
    # is_current version carries its OWN current enrichment. Half of gate 2, and
    # the half that matters -- a bill left with no summary is hidden from every
    # list on the site, which is far worse than a leftover row.
    live = aliased(BillVersion)
    bills_keeping_a_summary = {
        bid
        for (bid,) in session.execute(
            select(live.bill_id)
            .join(AIEnrichment, AIEnrichment.bill_version_id == live.id)
            .where(
                live.bill_id.in_(bill_ids),
                live.is_current.is_(True),
                AIEnrichment.is_current.is_(True),
            )
            .distinct()
        ).all()
    }

    zero = {
        "sections": 0,
        "rag_section_documents": 0,
        "rag_chunks": 0,
        "rag_chunk_embeddings": 0,
        "ai_enrichment": 0,
        "ai_enrichment_current": 0,
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
                "bill_keeps_a_summary": version.bill_id in bills_keeping_a_summary,
                **{**zero, **counts.get(str(version.id), {})},
            }
        )
    rows.sort(key=lambda r: (r["bill_key"], r["version_code"]))
    return rows


def _summary_is_safe_to_drop(candidate: dict) -> bool:
    """Gate 2. True when deleting this row costs the bill nothing a reader sees.

    A candidate carrying no enrichment at all was always fine. One carrying an
    enrichment is fine only when that enrichment is a superseded copy AND the
    bill's live version holds its own current one (#547).
    """
    if not candidate["ai_enrichment"]:
        return True
    return not candidate["ai_enrichment_current"] and candidate["bill_keeps_a_summary"]


def _copy_out(session: Session, table: str, where: str, version_ids: list) -> bytes:
    """Every row this run would delete from one table, in Postgres's binary format.

    Binary ``COPY`` rather than JSON because ``rag_chunk_embedding.embedding`` is a
    1,536-dimension vector: Postgres's own round trip is exact by construction,
    where a hand-written encoder is where a restore silently loses precision.
    """
    raw = session.connection().connection.dbapi_connection
    buffer = bytearray()
    # ORDER BY id is load-bearing, not tidiness. A restored row lands at the end
    # of the heap, so an unordered re-export comes back in a different physical
    # order and the byte comparison in _differences would fail on rows that are
    # in fact identical. Every table in SUBTREE has an id.
    statement = (
        f"COPY (SELECT * FROM {table} WHERE {where.replace(':version_ids', '%(ids)s')}"
        " ORDER BY id) TO STDOUT (FORMAT binary)"
    )
    with raw.cursor() as cursor, cursor.copy(statement, {"ids": version_ids}) as copy:
        for chunk in copy:
            buffer += chunk
    return bytes(buffer)


def _copy_in(session: Session, table: str, payload: bytes) -> None:
    raw = session.connection().connection.dbapi_connection
    with raw.cursor() as cursor:
        with cursor.copy(f"COPY {table} FROM STDIN (FORMAT binary)") as copy:
            copy.write(payload)


def _back_up(session: Session, version_ids: list) -> dict[str, bytes]:
    return {
        table: _copy_out(session, table, where, version_ids) for table, where in SUBTREE
    }


def _restore(session: Session, backup: dict[str, bytes]) -> None:
    """Put the backed-up rows back, parents first -- the reverse of the delete."""
    for table, _where in reversed(SUBTREE):
        _copy_in(session, table, backup[table])


def _write_backup(directory: Path, backup: dict[str, bytes], rows: list[dict]) -> None:
    """One binary file per table, numbered in restore order, plus a readable index."""
    directory.mkdir(parents=True, exist_ok=True)
    for order, (table, _where) in enumerate(reversed(SUBTREE), start=1):
        (directory / f"{order:02d}-{table}.bin").write_bytes(backup[table])
    (directory / "manifest.json").write_text(
        json.dumps(
            {
                "restore_order": [table for table, _ in reversed(SUBTREE)],
                "bytes": {table: len(payload) for table, payload in backup.items()},
                "rows": rows,
            },
            indent=2,
        ),
        encoding="utf-8",
    )


def _read_backup(directory: Path) -> dict[str, bytes]:
    return {
        table: (directory / f"{order:02d}-{table}.bin").read_bytes()
        for order, (table, _where) in enumerate(reversed(SUBTREE), start=1)
    }


def _row_counts(session: Session, version_ids: list) -> dict[str, int]:
    return {
        table: session.execute(
            text(f"SELECT count(*) FROM {table} WHERE {where}"),
            {"version_ids": version_ids},
        ).scalar_one()
        for table, where in SUBTREE
    }


def _invariants(session: Session, bill_keys: list[str]) -> dict:
    """What the delete must leave exactly as it found it.

    ``has_current_summary`` and the live version's own rows are the reader-facing
    facts: a bill whose flag goes false disappears from every list on the site,
    and a bill whose live version loses its sections or embeddings stops being
    answerable. Compared before and after rather than reasoned about.
    """
    rows = session.execute(
        text(
            """
            SELECT b.bill_key,
                   b.has_current_summary,
                   (SELECT count(*) FROM ai_enrichment a
                     WHERE a.bill_id = b.id AND a.is_current) AS live_summaries,
                   (SELECT count(*) FROM bill_version_section s
                      JOIN bill_version v ON v.id = s.bill_version_id
                     WHERE v.bill_id = b.id AND v.is_current) AS live_sections,
                   (SELECT count(*) FROM rag_chunk_embedding e
                      JOIN rag_chunk c ON c.id = e.rag_chunk_id
                      JOIN rag_section_document d
                        ON d.id = c.rag_section_document_id
                      JOIN bill_version v ON v.id = d.bill_version_id
                     WHERE v.bill_id = b.id AND v.is_current) AS live_embeddings
              FROM bill b WHERE b.bill_key = ANY(CAST(:keys AS text[]))
             ORDER BY b.bill_key
            """
        ),
        {"keys": bill_keys},
    ).all()
    return {
        "per_bill": {r.bill_key: tuple(r)[1:] for r in rows},
        "bills_with_a_current_summary": session.execute(
            text("SELECT count(*) FROM bill WHERE has_current_summary")
        ).scalar_one(),
        "current_summaries": session.execute(
            text("SELECT count(*) FROM ai_enrichment WHERE is_current")
        ).scalar_one(),
    }


def _check(label: str, passed: bool) -> bool:
    print(f"  {'PASS' if passed else 'FAIL'}  {label}")
    return passed


def _prove_restore(session: Session, deletable: list[dict]) -> bool:
    """Delete everything, put it all back, check, then roll the whole thing back.

    Nothing is written either way: the transaction is abandoned at the end whether
    it passed or failed. What survives is knowing the backup goes back in.
    """
    version_ids = [c["bill_version_id"] for c in deletable]
    bill_keys = sorted({c["bill_key"] for c in deletable})
    ok = True
    try:
        before_counts = _row_counts(session, version_ids)
        before_invariants = _invariants(session, bill_keys)
        backup = _back_up(session, version_ids)
        print(
            "  backed up " + ", ".join(f"{len(v)}B {t}" for t, v in backup.items() if v)
        )

        _delete_subtree(session, version_ids)
        after_delete = _row_counts(session, version_ids)
        after_invariants = _invariants(session, bill_keys)
        ok &= _check(
            f"every doomed row is gone ({sum(before_counts.values())} -> "
            f"{sum(after_delete.values())})",
            all(count == 0 for count in after_delete.values()),
        )
        # The reader-facing half. A bill that loses its summary flag vanishes
        # from every list; a bill that loses its live embeddings stops being
        # answerable. Neither should move, and this is where that is proven.
        ok &= _check(
            "no bill lost its summary, its live text, or its live embeddings",
            after_invariants == before_invariants,
        )

        _restore(session, backup)
        restored = _row_counts(session, version_ids)
        ok &= _check("every backed-up row came back", restored == before_counts)
        ok &= _check(
            "every restored row is identical in every column",
            _differences(session, backup, version_ids) == 0,
        )
        ok &= _check(
            "the database is exactly where it started",
            _invariants(session, bill_keys) == before_invariants,
        )
    except Exception as error:  # noqa: BLE001 - a crash here is a failed proof
        ok = _check(f"the proof ran without error ({type(error).__name__})", False)
        print(f"        {error}")
    finally:
        session.rollback()
    return ok


def _differences(session: Session, backup: dict[str, bytes], version_ids: list) -> int:
    """How many restored rows differ from the backup, comparing every column.

    Re-exports each table and compares the bytes. Binary ``COPY`` writes columns
    in table order with no formatting choices, so identical bytes means identical
    rows -- including the embedding vectors, which is the comparison that would be
    easiest to fake with a looser check.
    """
    total = 0
    for table, where in SUBTREE:
        if _copy_out(session, table, where, version_ids) != backup[table]:
            total += 1
            print(f"        {table} does not match the backup")
    return total


def _delete_subtree(session: Session, version_ids: list) -> None:
    """Delete the whole subtree for the given bill_version ids, bottom-up.

    Driven by ``SUBTREE``, the same definition the backup and the restore read, so
    a table added to one is added to all three. Order matters because every FK is
    ON DELETE NO ACTION.
    """
    for table, where in SUBTREE:
        session.execute(
            text(f"DELETE FROM {table} WHERE {where}"), {"version_ids": version_ids}
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
    parser.add_argument(
        "--prove-restore",
        action="store_true",
        help="Delete, restore from the backup, compare, roll back. Writes nothing. "
        "Run this before --apply.",
    )
    parser.add_argument(
        "--backup-dir",
        default=None,
        help="Where --apply writes the restorable row backup (one binary file per "
        "table). Required with --apply. Keep it OUTSIDE this public repo.",
    )
    parser.add_argument(
        "--restore-from",
        default=None,
        help="Put the rows in this backup directory back. The undo for --apply.",
    )
    args = parser.parse_args()

    database_url = normalize_database_url(
        args.database_url
        or database_url_for_target(os.environ.get("ALETHICAL_DATABASE_TARGET"))
    )
    engine = create_engine(
        database_url, echo=False, connect_args=NO_PREPARED_STATEMENTS
    )
    # Say which database, every run. A sibling repair script took its target from
    # a flag and ignored ALETHICAL_DATABASE_TARGET, so a command that named
    # production read the local database and printed "nothing to repair" -- a
    # false all-clear, which is the worst thing a delete script can print (#928).
    url = make_url(database_url)
    print(f"Database: {url.host}/{url.database}\n")

    if args.restore_from:
        with Session(engine) as session:
            _restore(session, _read_backup(Path(args.restore_from)))
            session.commit()
        print(f"Restored every row from {args.restore_from}.")
        return

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

        # Safety gate 2: leave any candidate whose summary is the one on display,
        # or whose bill would be left with no summary at all (#547).
        with_ai = [c for c in candidates if not _summary_is_safe_to_drop(c)]
        # Safety gate 3: leave any "current" row lacking a date-matched coded
        # sibling — it may be the sole copy of that text, not a safe duplicate.
        no_dupe = [
            c
            for c in candidates
            if _summary_is_safe_to_drop(c) and not c["has_coded_duplicate"]
        ]
        deletable = [
            c
            for c in candidates
            if _summary_is_safe_to_drop(c) and c["has_coded_duplicate"]
        ]
        if with_ai:
            print(
                f"\nEXCLUDED {len(with_ai)} candidate(s) whose AI summary cannot be "
                f"dropped safely:"
            )
            for c in with_ai:
                reason = (
                    "holds the summary on display"
                    if c["ai_enrichment_current"]
                    else "the bill's live version has no summary of its own"
                )
                print(
                    f"  {c['bill_key']} code={c['version_code']!r} "
                    f"ai={c['ai_enrichment']} — {reason}"
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
                "ai_enrichment",
            )
        }
        print(
            f"\nwould delete: {len(deletable)} bill_version + "
            f"{totals['sections']} sections + "
            f"{totals['rag_section_documents']} rag_section_documents + "
            f"{totals['rag_chunks']} rag_chunks + "
            f"{totals['rag_chunk_embeddings']} rag_chunk_embeddings + "
            f"{totals['ai_enrichment']} ai_enrichment"
        )
        # Every row, one line each, never only a total. A sibling script's dry run
        # printed each row and that is what caught a wrong repair rule before it
        # wrote anything (#928).
        for c in deletable:
            print(
                f"  {c['bill_key']:18} code={c['version_code']!r} "
                f"name={c['version_name']!r} sections={c['sections']} "
                f"rag_docs={c['rag_section_documents']} "
                f"chunks={c['rag_chunks']} embeddings={c['rag_chunk_embeddings']} "
                f"ai={c['ai_enrichment']}(current={c['ai_enrichment_current']}) "
                f"bill_keeps_a_summary={c['bill_keeps_a_summary']}"
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

        if not deletable:
            print("\nnothing to delete.")
            return

        if args.prove_restore:
            print("\nProving the backup restores (one transaction, rolled back):")
            ok = _prove_restore(session, deletable)
            print(
                "\nProof passed. Nothing was written."
                if ok
                else "\nProof FAILED. Nothing was written. Do not run --apply."
            )
            raise SystemExit(0 if ok else 1)

        if not args.apply:
            print("\ndry run — no changes written.")
            print("Next: --prove-restore, then --apply --bill-key <key>, then --apply.")
            return

        if not args.backup_dir:
            raise SystemExit(
                "--apply needs --backup-dir. The delete is reversible only if the "
                "rows were written down first."
            )
        backup_dir = Path(args.backup_dir).expanduser()
        if backup_dir.exists() and any(backup_dir.iterdir()):
            raise SystemExit(f"Refusing to overwrite the backup at {backup_dir}.")

        version_ids = [c["bill_version_id"] for c in deletable]
        bill_keys = sorted({c["bill_key"] for c in deletable})
        before = _invariants(session, bill_keys)
        _write_backup(backup_dir, _back_up(session, version_ids), deletable)
        print(f"\nBackup: {backup_dir}")

        _delete_subtree(session, version_ids)
        session.commit()

        # Read back from the database, not from what the delete claimed.
        remaining = _row_counts(session, version_ids)
        after = _invariants(session, bill_keys)
        print(f"\nDeleted {len(version_ids)} bill_version rows + subtree. Read back:")
        ok = _check("every doomed row is gone", not any(remaining.values()))
        ok &= _check(
            "no bill lost its summary, its live text, or its live embeddings",
            after == before,
        )
        # Deletable, not "any candidate". Gate 2 and gate 3 hold rows back on
        # purpose, so counting every remaining candidate reports a failure for
        # doing exactly what it was asked to do.
        left = [
            c
            for c in _find_candidates(session, args.bill_key)
            if _summary_is_safe_to_drop(c) and c["has_coded_duplicate"]
        ]
        ok &= _check(f"no deletable candidate is left ({len(left)})", not left)
        if not ok:
            print(f"\nSomething is off. Undo with --restore-from {backup_dir}")
        raise SystemExit(0 if ok else 1)


if __name__ == "__main__":
    main()
