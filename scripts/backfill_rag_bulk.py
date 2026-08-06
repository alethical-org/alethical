"""Embed the bills whose text is stored but not searchable (#844).

Net: a bill becomes answerable in two stages -- ingestion stores its text, then
this turns each section into an embedding so search can find it. When stage two
has not run, the bill sits on the site looking normal and Grounded Ask cannot
find or cite a word of it. This is stage two.

**It spends money**, on OpenAI's embedding API, so it is a dry run by default::

    ALETHICAL_DATABASE_TARGET=production PYTHONPATH=. \\
        uv run python scripts/backfill_rag_bulk.py --source-target production

That prints every bill it would embed, its section count and its cost, and makes
no API call. Then, in order::

    ... --source-target production --apply --bill-key 94-2025-HF1058   # one bill
    ... --source-target production --apply                             # the rest

It picks its own targets from the pipeline's staleness query
(``STALE_RAG_BILL_KEYS_SQL`` in ``alethical/pipeline/rag.py``), so it needs no
bill list. Every write is an ``on_conflict_do_update`` upsert into
``rag_section_document``, ``rag_chunk`` and ``rag_chunk_embedding`` -- there is no
``DELETE`` anywhere in this file -- so it is additive and idempotent, and a second
run is a no-op that costs nothing.

**Which paths leave work for this script, verified by reading them rather than
assumed.** The job-queue path already embeds: ``BillSyncChunkWorker``
(``alethical/pipeline/oban_workers.py``) calls ``build_rag_rows_for_bill_keys``
whenever ``include_rag`` is true, which is the default. Two paths do not, and
between them they produced all 69 bills #844 found:

  * ``scripts/load_minnesota_data.py`` -- ingests text and never embeds.
  * ``scripts/repair_missing_bill_sections.py`` -- inserts sections and prints an
    instruction telling a person to run this script afterwards.

So the durable guard is not "wire embedding into ingestion" -- one ingestion path
already has it. It is that the two script paths depend on somebody reading a
printed line, which is what ``.github/workflows/rag-coverage-gaps.yml`` now
notices when nobody did.
"""

from __future__ import annotations

import argparse
import threading
import time
import uuid
from datetime import datetime, timezone
from typing import Any

from sqlalchemy import create_engine, select, text
from sqlalchemy.engine import make_url
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.orm import Session

from alethical.db import models as schema
from alethical.db.session import (
    NO_PREPARED_STATEMENTS,
    database_url_for_target,
    local_database_url,
)
from alethical.pipeline import rag as rag_text
from alethical.pipeline.rag_ingest import _build_embeddings, _chunk_payloads

MODEL = "text-embedding-3-small"


MISSING_SQL = text(rag_text.STALE_RAG_BILL_KEYS_SQL)


PROD_SECTION_MAP_SQL = text(
    """
    with current_versions as (
      select distinct on (b.id) b.id as bill_id, b.bill_key, bv.id as bill_version_id
      from bill b
      join bill_version bv on bv.bill_id = b.id
      where bv.is_current = true
      order by b.id, bv.sequence_number desc
    )
    select cv.bill_key, cv.bill_id, cv.bill_version_id, bvs.id as section_id, bvs.source_order
    from current_versions cv
    join bill_version_section bvs on bvs.bill_version_id = cv.bill_version_id
    where cv.bill_key = any(:keys)
    order by cv.bill_key, bvs.source_order
    """
)


TOTALS_SQL = text(
    """
    select
      (select count(*) from rag_section_document where cleaning_version = :cleaning_version) as sections,
      (select count(*) from rag_chunk where chunking_version = :chunking_version) as chunks,
      (select count(*) from rag_chunk_embedding where embedding_model = :model) as embeddings
    """
)


def params() -> dict[str, str]:
    return {
        "cleaning_version": rag_text.CLEANING_VERSION,
        "chunking_version": rag_text.CHUNKING_VERSION,
        "model": MODEL,
    }


def load_local_payloads(
    local_engine: Any, bill_keys: list[str]
) -> dict[str, tuple[Any, list[dict[str, Any]]]]:
    loaded: dict[str, tuple[Any, list[dict[str, Any]]]] = {}
    with Session(local_engine) as db:
        for bill_key in bill_keys:
            bill = db.scalar(
                select(schema.Bill).where(schema.Bill.bill_key == bill_key)
            )
            if bill is None:
                continue
            version = db.scalar(
                select(schema.BillVersion)
                .where(
                    schema.BillVersion.bill_id == bill.id,
                    schema.BillVersion.is_current.is_(True),
                )
                .order_by(schema.BillVersion.sequence_number.desc())
                .limit(1)
            )
            if version is None:
                continue
            sections = db.scalars(
                select(schema.BillVersionSection)
                .where(schema.BillVersionSection.bill_version_id == version.id)
                .order_by(schema.BillVersionSection.source_order.asc())
            ).all()
            loaded[bill_key] = (
                bill,
                [
                    # source_order rides along so the target section can be
                    # matched on the column the database actually keys on. See
                    # load_prod_section_map for why that matters.
                    _chunk_payloads(str(bill.file_type), bill.file_number, section)
                    | {"source_order": section.source_order}
                    for section in sections
                ],
            )
    return loaded


def load_prod_section_map(
    prod_db: Session, bill_keys: list[str]
) -> dict[str, dict[str, Any]]:
    """Map each bill's sections to their ids in the target database.

    **Keyed on ``source_order``, never on ``section_id_text``.** This used to key
    on ``section_id_text``, and a bill's page is allowed to repeat one: 66 stored
    versions do, and among the 69 bills #844 found, **27** did. Repeats collapsed
    into a single map entry, so several sections resolved to the SAME target id
    and one INSERT arrived carrying two rows with the same conflict key --
    Postgres refuses that outright (``ON CONFLICT DO UPDATE command cannot affect
    row a second time``), which is how the first full run died after embedding
    nothing.

    ``source_order`` is the right key and the database says so: measured across
    production it repeats on **0** versions and is never null, and
    ``uq_bill_version_section_bill_version_id_source_order`` declares it. Same
    trap as [#763](https://github.com/alethical-org/alethical/issues/763), which
    lost real bill sections by keying rows on the section id a page may repeat.
    """
    mapped: dict[str, dict[str, Any]] = {}
    for row in prod_db.execute(PROD_SECTION_MAP_SQL, {"keys": bill_keys}):
        entry = mapped.setdefault(
            row.bill_key,
            {
                "bill_id": row.bill_id,
                "bill_version_id": row.bill_version_id,
                "sections": {},
            },
        )
        entry["sections"][row.source_order] = row.section_id
    return mapped


def upsert_batch(
    *,
    local_engine: Any,
    prod_engine: Any,
    bill_keys: list[str],
    embedding_insert_size: int,
) -> dict[str, int]:
    local_payloads = load_local_payloads(local_engine, bill_keys)
    with Session(prod_engine) as db:
        prod_map = load_prod_section_map(db, bill_keys)
        prepared_sections: list[dict[str, Any]] = []
        section_rows: list[dict[str, Any]] = []
        skipped = 0

        for bill_key in bill_keys:
            local_bill_payload = local_payloads.get(bill_key)
            prod_bill = prod_map.get(bill_key)
            if local_bill_payload is None or prod_bill is None:
                skipped += 1
                continue
            _bill, local_sections = local_bill_payload
            for section in local_sections:
                prod_section_id = prod_bill["sections"].get(section["source_order"])
                if prod_section_id is None:
                    continue
                payload = dict(section)
                payload["bill_key"] = bill_key
                payload["bill_id"] = prod_bill["bill_id"]
                payload["bill_version_id"] = prod_bill["bill_version_id"]
                payload["bill_version_section_id"] = prod_section_id
                prepared_sections.append(payload)
                section_rows.append(
                    {
                        "id": uuid.uuid4(),
                        "bill_id": prod_bill["bill_id"],
                        "bill_version_id": prod_bill["bill_version_id"],
                        "bill_version_section_id": prod_section_id,
                        "citation_label": payload["citation_label"],
                        "clean_text": payload["clean_text"],
                        "cleaning_version": rag_text.CLEANING_VERSION,
                        "source_hash": payload["source_hash"],
                        "word_count": payload["word_count"],
                    }
                )

        if not section_rows:
            db.commit()
            return {
                "bills": len(bill_keys),
                "skipped": skipped,
                "sections": 0,
                "chunks": 0,
                "embeddings": 0,
            }

        # Catch a repeated target section here, where the message can name the
        # bill, rather than as Postgres's "ON CONFLICT DO UPDATE command cannot
        # affect row a second time" ten frames down a traceback. Two rows in one
        # statement sharing a conflict key is always a mapping bug upstream, and
        # this is the shape it takes -- see load_prod_section_map.
        targets = [row["bill_version_section_id"] for row in section_rows]
        if len(set(targets)) != len(targets):
            repeated = {str(target) for target in targets if targets.count(target) > 1}
            raise SystemExit(
                f"Two sections map to the same target row, so the upsert would "
                f"carry a duplicate key. Bills in this batch: {sorted(bill_keys)}. "
                f"Repeated target section ids: {sorted(repeated)}"
            )

        excluded_section = insert(schema.RagSectionDocument).excluded
        section_stmt = (
            insert(schema.RagSectionDocument)
            .values(section_rows)
            .on_conflict_do_update(
                index_elements=[
                    schema.RagSectionDocument.bill_version_id,
                    schema.RagSectionDocument.bill_version_section_id,
                    schema.RagSectionDocument.cleaning_version,
                ],
                set_={
                    "bill_id": excluded_section.bill_id,
                    "citation_label": excluded_section.citation_label,
                    "clean_text": excluded_section.clean_text,
                    "source_hash": excluded_section.source_hash,
                    "word_count": excluded_section.word_count,
                },
            )
        )
        db.execute(section_stmt)
        db.flush()

        prod_section_ids = [row["bill_version_section_id"] for row in section_rows]
        section_id_rows = db.execute(
            select(
                schema.RagSectionDocument.id,
                schema.RagSectionDocument.bill_version_section_id,
            ).where(
                schema.RagSectionDocument.bill_version_section_id.in_(prod_section_ids),
                schema.RagSectionDocument.cleaning_version == rag_text.CLEANING_VERSION,
            )
        ).all()
        rag_section_id_by_prod_section = {
            row.bill_version_section_id: row.id for row in section_id_rows
        }

        chunk_rows: list[dict[str, Any]] = []
        chunk_texts: list[tuple[uuid.UUID, str]] = []
        for section in prepared_sections:
            rag_section_id = rag_section_id_by_prod_section[
                section["bill_version_section_id"]
            ]
            for chunk in section["chunks"]:
                temp_chunk_id = uuid.uuid4()
                chunk_texts.append((temp_chunk_id, chunk["chunk_text"]))
                chunk_rows.append(
                    {
                        "id": temp_chunk_id,
                        "rag_section_document_id": rag_section_id,
                        "chunk_index": chunk["chunk_index"],
                        "citation_label": chunk["citation_label"],
                        "chunk_text": chunk["chunk_text"],
                        "search_text": chunk["search_text"],
                        "chunking_version": rag_text.CHUNKING_VERSION,
                        "word_count": chunk["word_count"],
                        "token_estimate": chunk["word_count"],
                    }
                )

        if not chunk_rows:
            db.commit()
            return {
                "bills": len(bill_keys),
                "skipped": skipped,
                "sections": len(section_rows),
                "chunks": 0,
                "embeddings": 0,
            }

        excluded_chunk = insert(schema.RagChunk).excluded
        chunk_stmt = (
            insert(schema.RagChunk)
            .values(chunk_rows)
            .on_conflict_do_update(
                index_elements=[
                    schema.RagChunk.rag_section_document_id,
                    schema.RagChunk.chunk_index,
                    schema.RagChunk.chunking_version,
                ],
                set_={
                    "citation_label": excluded_chunk.citation_label,
                    "chunk_text": excluded_chunk.chunk_text,
                    "search_text": excluded_chunk.search_text,
                    "word_count": excluded_chunk.word_count,
                    "token_estimate": excluded_chunk.token_estimate,
                },
            )
        )
        db.execute(chunk_stmt)
        db.flush()

        chunk_id_rows = db.execute(
            select(
                schema.RagChunk.id,
                schema.RagChunk.rag_section_document_id,
                schema.RagChunk.chunk_index,
            ).where(
                schema.RagChunk.rag_section_document_id.in_(
                    list(rag_section_id_by_prod_section.values())
                ),
                schema.RagChunk.chunking_version == rag_text.CHUNKING_VERSION,
            )
        ).all()
        real_chunk_id_by_key = {
            (row.rag_section_document_id, row.chunk_index): row.id
            for row in chunk_id_rows
        }
        temp_chunk_key = {
            row["id"]: (row["rag_section_document_id"], row["chunk_index"])
            for row in chunk_rows
        }

        embeddings = _build_embeddings(
            [text for _temp_id, text in chunk_texts], model=MODEL, batch_size=64
        )
        embedding_rows: list[dict[str, Any]] = []
        for (temp_chunk_id, _chunk_text), embedding in zip(chunk_texts, embeddings):
            real_chunk_id = real_chunk_id_by_key[temp_chunk_key[temp_chunk_id]]
            embedding_rows.append(
                {
                    "id": uuid.uuid4(),
                    "rag_chunk_id": real_chunk_id,
                    "embedding_model": MODEL,
                    "embedding": embedding,
                }
            )

        excluded_embedding = insert(schema.RagChunkEmbedding).excluded
        for start in range(0, len(embedding_rows), embedding_insert_size):
            embedding_stmt = (
                insert(schema.RagChunkEmbedding)
                .values(embedding_rows[start : start + embedding_insert_size])
                .on_conflict_do_update(
                    index_elements=[schema.RagChunkEmbedding.rag_chunk_id],
                    set_={
                        "embedding_model": excluded_embedding.embedding_model,
                        "embedding": excluded_embedding.embedding,
                    },
                )
            )
            db.execute(embedding_stmt)

        db.commit()
        return {
            "bills": len(bill_keys),
            "skipped": skipped,
            "sections": len(section_rows),
            "chunks": len(chunk_rows),
            "embeddings": len(embedding_rows),
        }


def price(characters: int) -> float:
    """What this run costs, from the same arithmetic the issue used.

    ~4 characters a token is the working ratio for English prose, and
    ``text-embedding-3-small`` is $0.02 per million input tokens. Close enough to
    decide with; the run prints what it actually spent afterwards.
    """
    return characters / 4 / 1_000_000 * 0.02


def report_plan(prod_engine: Any, bill_keys: list[str]) -> None:
    """What the run would embed, bill by bill, and what it would cost.

    Every bill, never only a total: this is a PAID run, and the list is the last
    chance to notice it is about to embed something nobody meant to.
    """
    with Session(prod_engine) as db:
        rows = db.execute(
            text(
                "SELECT b.bill_key, count(*) AS sections, "
                "       coalesce(sum(length(s.raw_text)), 0) AS characters "
                "  FROM bill b "
                "  JOIN bill_version bv ON bv.bill_id = b.id AND bv.is_current "
                "  JOIN bill_version_section s ON s.bill_version_id = bv.id "
                " WHERE b.bill_key = ANY(CAST(:keys AS text[])) "
                " GROUP BY b.bill_key ORDER BY count(*) DESC"
            ),
            {"keys": bill_keys},
        ).all()
    characters = sum(int(row.characters) for row in rows)
    sections = sum(int(row.sections) for row in rows)
    for row in rows:
        print(
            f"  {row.bill_key:20} sections={int(row.sections):4} "
            f"characters={int(row.characters):9,} "
            f"~${price(int(row.characters)):.5f}"
        )
    print(
        f"\nwould embed: {len(rows)} bills, {sections:,} sections, "
        f"{characters:,} characters (~{characters // 4:,} tokens) "
        f"-> ~${price(characters):.4f} at $0.02/1M for {MODEL}"
    )


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--batch-size", type=int, default=25)
    parser.add_argument("--embedding-insert-size", type=int, default=100)
    parser.add_argument("--limit", type=int)
    parser.add_argument("--heartbeat-seconds", type=int, default=60)
    parser.add_argument(
        "--source-target", choices=["local", "production"], default="local"
    )
    # Dry run by default, like every other production script here. This one
    # SPENDS MONEY on an embedding API, so "run it and see" is the one default it
    # must not have: a script whose no-flag behaviour is to buy something is a
    # script that will eventually buy something nobody asked for.
    parser.add_argument(
        "--apply",
        action="store_true",
        help="Embed for real. Without this the script only reports (dry run).",
    )
    parser.add_argument(
        "--bill-key",
        action="append",
        help="Limit to these bills, repeatable. Use for the scoped live check "
        "before the full paid run.",
    )
    args = parser.parse_args()

    source_url = (
        # local_database_url(): --source-target local means local even when
        # ALETHICAL_DATABASE_TARGET=production is set, which it usually is here
        # because the destination is production (#1090).
        local_database_url()
        if args.source_target == "local"
        else database_url_for_target("production", None)
    )
    local_engine = create_engine(
        source_url, pool_pre_ping=True, connect_args=NO_PREPARED_STATEMENTS
    )
    prod_engine = create_engine(
        database_url_for_target("production", None),
        pool_pre_ping=True,
        connect_args=NO_PREPARED_STATEMENTS,
    )

    # Say which database, every run. Both engines point at production on the real
    # path, and a run that silently read somewhere else would report "nothing
    # stale" -- a false all-clear on a job whose whole point is finding gaps.
    print(
        f"Source: {make_url(source_url).host}/{make_url(source_url).database}\n"
        f"Target: {make_url(str(prod_engine.url)).host}/"
        f"{make_url(str(prod_engine.url)).database}\n"
    )

    with Session(prod_engine) as db:
        bill_keys = list(db.scalars(MISSING_SQL, params()).all())
        if args.bill_key:
            wanted = set(args.bill_key)
            unknown = wanted - set(bill_keys)
            if unknown:
                raise SystemExit(
                    f"Not in the stale set, so there is nothing to embed for: "
                    f"{sorted(unknown)}"
                )
            bill_keys = [key for key in bill_keys if key in wanted]
        if args.limit is not None:
            bill_keys = bill_keys[: args.limit]
        start_totals = db.execute(TOTALS_SQL, params()).one()._mapping

    if not bill_keys:
        print("Every bill's text is already searchable. Nothing to embed.")
        return

    report_plan(prod_engine, bill_keys)
    if not args.apply:
        print("\nDry run: nothing was written and no API call was made.")
        print("Next: --apply --bill-key <key> for one bill, then --apply.")
        return

    state = {
        "done": False,
        "processed": 0,
        "skipped": 0,
        "sections": 0,
        "chunks": 0,
        "embeddings": 0,
        "last_batch": None,
    }
    lock = threading.Lock()

    def snapshot(label: str) -> None:
        with Session(prod_engine) as db:
            totals = db.execute(TOTALS_SQL, params()).one()._mapping
            remaining = db.scalar(
                text(f"select count(*) from ({MISSING_SQL.text}) missing"), params()
            )
        with lock:
            current = dict(state)
        print(
            f"{label} utc={datetime.now(timezone.utc).isoformat(timespec='seconds')} "
            f"processed={current['processed']}/{len(bill_keys)} skipped={current['skipped']} "
            f"batch_rows sections={current['sections']} chunks={current['chunks']} embeddings={current['embeddings']} "
            f"db_rows_delta sections={int(totals['sections']) - int(start_totals['sections'])} "
            f"chunks={int(totals['chunks']) - int(start_totals['chunks'])} "
            f"embeddings={int(totals['embeddings']) - int(start_totals['embeddings'])} "
            f"remaining={remaining} last_batch={current['last_batch']}",
            flush=True,
        )

    def heartbeat() -> None:
        while True:
            time.sleep(args.heartbeat_seconds)
            with lock:
                if state["done"]:
                    return
            snapshot("heartbeat")

    print(
        f"start missing={len(bill_keys)} batch_size={args.batch_size} "
        f"embedding_insert_size={args.embedding_insert_size} model={MODEL} "
        f"cleaning_version={rag_text.CLEANING_VERSION} chunking_version={rag_text.CHUNKING_VERSION}",
        flush=True,
    )
    snapshot("initial")
    threading.Thread(target=heartbeat, daemon=True).start()

    try:
        for start in range(0, len(bill_keys), args.batch_size):
            batch = bill_keys[start : start + args.batch_size]
            with lock:
                state["last_batch"] = f"{start}-{start + len(batch) - 1}"
            result = upsert_batch(
                local_engine=local_engine,
                prod_engine=prod_engine,
                bill_keys=batch,
                embedding_insert_size=args.embedding_insert_size,
            )
            with lock:
                state["processed"] += len(batch)
                state["skipped"] += result["skipped"]
                state["sections"] += result["sections"]
                state["chunks"] += result["chunks"]
                state["embeddings"] += result["embeddings"]
            snapshot("batch")
    finally:
        with lock:
            state["done"] = True
    snapshot("done")


if __name__ == "__main__":
    main()
