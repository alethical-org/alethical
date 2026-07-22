"""Re-anchor RAG index onto each bill's is_current BillVersion (#542).

Some bills' embeddings sit on a superseded/legacy ``bill_version`` while the
bill's ``is_current`` version (a re-ingested raw-code row) carries the same
section text but **no** RAG documents. Grounded-Ask retrieval
(``semantic_rag_chunk_stmt(current_version_only=True)``) joins
``rag_section_document.bill_version_id -> bill_version`` and filters
``is_current = true``, so those bills return nothing (dead retrieval).

When the is_current version's section text is byte-identical to the embedded
version's, this is a **zero-cost** fix: re-point the existing
``rag_section_document`` rows (and, transitively, their chunks/embeddings, which
hang off ``rag_section_document_id`` and are untouched) onto the is_current
version's matching sections. No OpenAI spend, fully reversible.

Safety model (production mutation, verify by engineering — not by asking):
- **Dry-run by default.** ``--apply`` is required to write.
- **Strict per-bill validation.** A source version is used only if it is an
  *exact, bijective* match to the target: same ``section_id_text`` set, one RAG
  doc per section (no dup/extra/missing), and identical ``raw_text`` for every
  section. Any bill that fails is skipped and reported (candidate for a paid
  re-embed via ``scripts/backfill_rag_bulk.py`` instead).
- **Snapshot before write.** Every re-pointed row's prior
  (bill_version_id, bill_version_section_id) is written to a JSON file so the
  change is trivially reversible (``--revert <snapshot.json>``).
- **``--bill-key`` scopes to one bill** for a live check before the full run.

Run: ``PYTHONPATH=/path/to/repo uv run python scripts/reanchor_rag_to_current_version.py [--apply] [--bill-key 94-2025-SF1832]``
"""

from __future__ import annotations

import argparse
import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from sqlalchemy import create_engine, text
from sqlalchemy.orm import Session

from alethical.db.session import NO_PREPARED_STATEMENTS, database_url_for_target

# Dead-retrieval discovery: bills whose is_current version has source sections
# but zero rag_section_document rows.
DEAD_BILLS_SQL = text(
    """
    with cur as (
      select distinct on (b.id) b.id as bill_id, b.bill_key, bv.id as cur_ver
      from bill b join bill_version bv on bv.bill_id = b.id
      where bv.is_current
      order by b.id, bv.sequence_number desc
    )
    select cur.bill_key
    from cur
    join bill_version_section bvs on bvs.bill_version_id = cur.cur_ver
    left join rag_section_document rsd on rsd.bill_version_id = cur.cur_ver
    group by cur.bill_key
    having count(distinct bvs.id) > 0 and count(rsd.id) = 0
    order by cur.bill_key
    """
)


def target_version(db: Session, bill_key: str) -> tuple[Any, dict[str, tuple]] | None:
    """Return (target_version_id, {section_id_text: (section_id, md5)}) for the
    is_current version, or None if the bill is not dead-retrieval."""
    row = db.execute(
        text(
            """
            select distinct on (b.id) bv.id
            from bill b join bill_version bv on bv.bill_id = b.id
            where b.bill_key = :k and bv.is_current
            order by b.id, bv.sequence_number desc
            """
        ),
        {"k": bill_key},
    ).first()
    if row is None:
        return None
    tgt_id = row[0]
    nrag = db.execute(
        text("select count(*) from rag_section_document where bill_version_id = :v"),
        {"v": tgt_id},
    ).scalar()
    secs = db.execute(
        text(
            "select section_id_text, id, md5(raw_text) "
            "from bill_version_section where bill_version_id = :v"
        ),
        {"v": tgt_id},
    ).all()
    if not secs or nrag != 0:
        return None  # not dead-retrieval (already has RAG, or no sections)
    return tgt_id, {r[0]: (r[1], r[2]) for r in secs}


def choose_source(
    db: Session, bill_key: str, tgt_id, tmap: dict[str, tuple]
) -> tuple[Any, list[dict]] | None:
    """Pick the exact-bijective source version and build the re-point plan.

    Returns (source_version_id, [{rsd_id, old_section_id, new_section_id}]) or
    None if no clean source exists (bill needs a paid re-embed instead)."""
    cands = db.execute(
        text(
            """
            select bv.id, bv.version_code
            from bill b join bill_version bv on bv.bill_id = b.id
            where b.bill_key = :k and bv.is_current = false
              and exists (select 1 from rag_section_document r where r.bill_version_id = bv.id)
            order by bv.version_code
            """
        ),
        {"k": bill_key},
    ).all()
    tgt_texts = {sid_text: md5 for sid_text, (_sid, md5) in tmap.items()}
    for src_id, _code in cands:
        # Every rag doc on the source, joined to its section's id_text + md5.
        rows = db.execute(
            text(
                """
                select rsd.id, s.section_id_text, md5(s.raw_text) as md5, s.id as old_section_id
                from rag_section_document rsd
                join bill_version_section s on s.id = rsd.bill_version_section_id
                where rsd.bill_version_id = :v
                """
            ),
            {"v": src_id},
        ).all()
        # Total rag docs on the source (incl. any with NULL/unjoinable section).
        total_rsd = db.execute(
            text(
                "select count(*) from rag_section_document where bill_version_id = :v"
            ),
            {"v": src_id},
        ).scalar()
        covered = {r[1]: r[2] for r in rows}
        # Bijection: one joinable rag doc per section, no dup, no extras, exact set.
        if len(rows) != total_rsd:
            continue  # some rag docs don't join to a section
        if len(covered) != len(rows):
            continue  # duplicate section_id_text among rag docs
        if set(covered.keys()) != set(tgt_texts.keys()):
            continue  # section set differs
        if any(covered[k] != tgt_texts[k] for k in covered):
            continue  # raw_text differs for some section
        # Clean bijective exact-text match — build the plan.
        plan = [
            {
                "rsd_id": str(r[0]),
                "old_bill_version_id": str(src_id),
                "old_section_id": str(r[3]),
                "new_bill_version_id": str(tgt_id),
                "new_section_id": str(tmap[r[1]][0]),
                "section_id_text": r[1],
            }
            for r in rows
        ]
        return src_id, plan
    return None


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--apply", action="store_true", help="write (default: dry-run)")
    parser.add_argument("--bill-key", help="scope to a single bill_key")
    parser.add_argument(
        "--snapshot-dir",
        default=".",
        help="directory for the pre-write snapshot JSON (default: cwd)",
    )
    parser.add_argument(
        "--revert", help="revert from a snapshot JSON produced by --apply"
    )
    args = parser.parse_args()

    engine = create_engine(
        database_url_for_target("production", None),
        pool_pre_ping=True,
        connect_args=NO_PREPARED_STATEMENTS,
    )

    if args.revert:
        _revert(engine, Path(args.revert), apply=args.apply)
        return

    with Session(engine) as db:
        if args.bill_key:
            keys = [args.bill_key]
        else:
            keys = list(db.scalars(DEAD_BILLS_SQL).all())
        print(f"dead-retrieval bills to consider: {len(keys)}", flush=True)

        ops_by_bill: dict[str, list[dict]] = {}
        all_ops: list[dict] = []
        reembed_needed: list[str] = []
        for key in keys:
            tv = target_version(db, key)
            if tv is None:
                print(
                    f"  SKIP {key}: not dead-retrieval (has RAG or no sections)",
                    flush=True,
                )
                continue
            tgt_id, tmap = tv
            chosen = choose_source(db, key, tgt_id, tmap)
            if chosen is None:
                reembed_needed.append(key)
                print(
                    f"  RE-EMBED {key}: no clean bijective source — needs paid re-embed",
                    flush=True,
                )
                continue
            src_id, plan = chosen
            ops_by_bill[key] = plan
            all_ops.extend(plan)
            src_code = db.execute(
                text("select version_code from bill_version where id = :v"),
                {"v": src_id},
            ).scalar()
            print(
                f"  RE-POINT {key}: {len(plan)} rag docs  src={src_code} -> is_current  (sections={len(tmap)})",
                flush=True,
            )

    print(
        f"\nPLAN: {len(all_ops)} rag_section_document rows across "
        f"{len(keys) - len(reembed_needed)} bills; re-embed-needed={len(reembed_needed)}",
        flush=True,
    )
    if reembed_needed:
        print(f"  re-embed bills: {reembed_needed}", flush=True)

    if not args.apply:
        print("\nDRY-RUN — no writes. Re-run with --apply to execute.", flush=True)
        return

    if not all_ops:
        print("nothing to apply.", flush=True)
        return

    # Snapshot the prior state BEFORE writing (reversible) — built directly from
    # the plan, which already carries the old (bill_version_id, section_id).
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    snap_path = Path(args.snapshot_dir) / f"reanchor_542_snapshot_{stamp}.json"
    snapshot = [
        {
            "rsd_id": op["rsd_id"],
            "old_bill_version_id": op["old_bill_version_id"],
            "old_bill_version_section_id": op["old_section_id"],
            "new_bill_version_id": op["new_bill_version_id"],
            "new_bill_version_section_id": op["new_section_id"],
        }
        for op in all_ops
    ]
    snap_path.write_text(json.dumps(snapshot, indent=2))
    print(f"snapshot written: {snap_path} ({len(snapshot)} rows)", flush=True)

    # Apply per-bill with executemany + commit-per-bill: each bill's rows land in
    # one short transaction, releasing locks promptly (transaction-pooler safe).
    stmt = text(
        "update rag_section_document "
        "set bill_version_id = :bv, bill_version_section_id = :bvs "
        "where id = :id"
    )
    applied = 0
    for key, plan in ops_by_bill.items():
        params = [
            {
                "bv": op["new_bill_version_id"],
                "bvs": op["new_section_id"],
                "id": op["rsd_id"],
            }
            for op in plan
        ]
        with Session(engine) as db:
            db.execute(stmt, params)
            db.commit()
        applied += len(params)
        print(
            f"  applied {key}: {len(params)} rows ({applied}/{len(all_ops)})",
            flush=True,
        )
    print(f"APPLIED: re-pointed {applied} rag_section_document rows.", flush=True)


def _revert(engine, snap_path: Path, *, apply: bool) -> None:
    snapshot = json.loads(snap_path.read_text())
    print(f"revert: {len(snapshot)} rows from {snap_path}", flush=True)
    if not apply:
        print("DRY-RUN revert — re-run with --apply to execute.", flush=True)
        return
    stmt = text(
        "update rag_section_document "
        "set bill_version_id = :bv, bill_version_section_id = :bvs "
        "where id = :id"
    )
    params = [
        {
            "bv": row["old_bill_version_id"],
            "bvs": row["old_bill_version_section_id"],
            "id": row["rsd_id"],
        }
        for row in snapshot
    ]
    with Session(engine) as db:
        db.execute(stmt, params)
        db.commit()
    print(f"REVERTED {len(snapshot)} rows.", flush=True)


if __name__ == "__main__":
    main()
