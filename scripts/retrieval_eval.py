"""CLI for the retrieval-quality eval harness (#399/#400/#380/#255).

Runs the labeled MN-bill question fixture against a database (default: the DB
selected by ALETHICAL_DATABASE_TARGET) and reports retrieval metrics.

Stages
------
  baseline   Production behavior: OpenAI vector k-NN via pgvector (ivfflat), plus
             a Postgres full-text arm and their RRF hybrid. Cheap; needs
             OPENAI_API_KEY for the ~20 query embeddings only. Gives the #255
             distance distribution and the #380 vector-vs-hybrid comparison.
  head2head  OpenAI vs Voyage models on identical exact-kNN retrieval (#400).
             Re-embeds the retrievable corpus with each model (cached to disk),
             then compares recall. Needs OPENAI_API_KEY and VOYAGE_API_KEY.

Examples
--------
  ALETHICAL_DATABASE_TARGET=production uv run python scripts/retrieval_eval.py baseline
  ALETHICAL_DATABASE_TARGET=production uv run python scripts/retrieval_eval.py \
      head2head --models text-embedding-3-small,voyage-law-2,voyage-3-large
"""

from __future__ import annotations

import argparse
import json
import os
from pathlib import Path

import numpy as np
from sqlalchemy import create_engine, text
from sqlalchemy.orm import Session

from alethical.db.session import NO_PREPARED_STATEMENTS, database_url_for_target
from alethical.eval import embeddings as emb
from alethical.eval.retrieval_eval import (
    InMemoryIndex,
    Query,
    QueryResult,
    aggregate,
    bills_in_rank_order,
    evaluate_hybrid,
    evaluate_vector,
    load_fixture,
    rank_of_correct,
)

FIXTURE = (
    Path(__file__).resolve().parents[1]
    / "alethical/eval/fixtures/retrieval_queries.json"
)
RESOLVE_TOP_CHUNKS = 25  # matches ask.py _BILL_TEXT_RESOLVE_CHUNK_LIMIT

# The retrievable pool: chunks on current versions of current-session, citable,
# AI-summarized bills — the exact set _semantic_candidate_bills can return.
POOL_JOIN = """
  from rag_chunk rc
  join rag_section_document rsd on rsd.id = rc.rag_section_document_id
  join bill_version bv on bv.id = rsd.bill_version_id and bv.is_current
  join bill b on b.id = rsd.bill_id
  join legislative_session ls on ls.id = b.session_id and ls.is_current
  where b.official_url is not null and b.has_current_summary is true
"""


def make_engine():
    url = database_url_for_target(os.environ.get("ALETHICAL_DATABASE_TARGET"))
    return create_engine(url, connect_args=NO_PREPARED_STATEMENTS)


# --- baseline: prod pgvector k-NN, FTS, hybrid ---


# Vector arm needs the embedding table joined; POOL_JOIN's WHERE is reused by
# inserting the rce join before it.
_VECTOR_JOIN = POOL_JOIN.replace(
    "where b.official_url",
    "join rag_chunk_embedding rce on rce.rag_chunk_id = rc.id\n"
    "  where rce.embedding_model = 'text-embedding-3-small'\n"
    "    and b.official_url",
)


def baseline_vector_candidates(
    db: Session, query_vec: list[float]
) -> tuple[list[str], list[float]]:
    """Top chunks by cosine distance over stored OpenAI vectors (prod ivfflat)."""
    db.execute(text("SET LOCAL ivfflat.probes = 10"))
    rows = db.execute(
        text(
            "select b.bill_key, rce.embedding <=> cast(:vec as vector) as distance"
            + _VECTOR_JOIN
            + " order by distance limit :lim"
        ).bindparams(vec=str(query_vec), lim=RESOLVE_TOP_CHUNKS)
    ).all()
    return [r.bill_key for r in rows], [float(r.distance) for r in rows]


def build_fts_temp_table(db: Session) -> None:
    """Materialize a session-temp table of (bill_key, tsvector) over the pool, with
    a GIN index — so the 20 FTS queries are index lookups, not 20 seq-scans that
    recompute to_tsvector over 89k rows. TEMP is session-local and auto-dropped;
    no production schema change. This mirrors the persisted GIN index that #380
    would add for production hybrid retrieval.
    """
    db.execute(
        text(
            "create temp table eval_fts on commit drop as "
            "select b.bill_key, to_tsvector('english', rc.chunk_text) as tsv "
            + POOL_JOIN
        )
    )
    db.execute(text("create index on eval_fts using gin (tsv)"))
    db.execute(text("analyze eval_fts"))


# Question words that carry no keyword signal — dropped when building the FTS
# OR-query so ranking keys on the bill's actual content terms.
_FTS_STOPWORDS = {
    "a",
    "an",
    "the",
    "is",
    "are",
    "was",
    "were",
    "be",
    "been",
    "of",
    "to",
    "in",
    "on",
    "for",
    "and",
    "or",
    "which",
    "what",
    "whats",
    "who",
    "how",
    "did",
    "do",
    "does",
    "there",
    "this",
    "that",
    "bill",
    "bills",
    "proposal",
    "law",
    "act",
    "someone",
    "would",
    "make",
    "makes",
    "put",
    "about",
    "have",
    "has",
    "with",
    "wut",
    "ther",
    "whats",
    "money",
}


def _fts_query_terms(question: str) -> str:
    """Build an OR tsquery of content lexemes from a natural-language question.

    A keyword arm must not AND every word (websearch/plainto do), or a full
    question like "which bill increases penalties for swatting" matches nothing.
    OR-ing content terms lets ts_rank surface chunks that hit the rare, specific
    words (statute numbers, program names) — the exact-term case #380 targets.
    """
    import re

    terms = [
        t
        for t in re.findall(r"[a-z0-9.]+", question.lower())
        if len(t) > 2 and t not in _FTS_STOPWORDS
    ]
    # Quote each term so statute cites like 504b.245 are valid tsquery lexemes.
    return " | ".join(f"'{t}'" for t in terms)


def fts_candidates(db: Session, question: str) -> list[str]:
    """Keyword-ranked bills via Postgres full-text over chunk_text (#380 arm)."""
    query_terms = _fts_query_terms(question)
    if not query_terms:
        return []
    rows = db.execute(
        text(
            "select bill_key, ts_rank(tsv, to_tsquery('english', :q)) as rank "
            "from eval_fts "
            "where tsv @@ to_tsquery('english', :q) "
            "order by rank desc limit :lim"
        ).bindparams(q=query_terms, lim=RESOLVE_TOP_CHUNKS)
    ).all()
    return bills_in_rank_order([r.bill_key for r in rows])


def run_baseline(db: Session, queries: list[Query]) -> dict:
    vec_results: list[QueryResult] = []
    vec_candidates: dict[str, list[str]] = {}
    fts_cands: dict[str, list[str]] = {}

    print("materializing FTS temp table ...", flush=True)
    build_fts_temp_table(db)
    q_vecs = emb.embed_openai([q.question for q in queries])
    for q, qv in zip(queries, q_vecs):
        chunk_bills, distances = baseline_vector_candidates(db, qv)
        candidates = bills_in_rank_order(chunk_bills)
        vec_candidates[q.question] = candidates
        rank = rank_of_correct(candidates, q.correct_keys())
        best_correct = None
        for key, dist in zip(chunk_bills, distances):
            if key in q.correct_keys():
                best_correct = dist
                break
        vec_results.append(
            QueryResult(
                q, rank, best_correct_distance=best_correct, top_bills=candidates[:10]
            )
        )
        fts_cands[q.question] = fts_candidates(db, q.question)

    fts_results = [
        QueryResult(q, rank_of_correct(fts_cands[q.question], q.correct_keys()))
        for q in queries
    ]
    hybrid_results = evaluate_hybrid(queries, vec_candidates, fts_cands)
    # Vector-weighted fusion: keep vector's confident rank-1s, let FTS rescue
    # exact-term misses without reordering vector's strong hits (#380).
    hybrid_w2 = evaluate_hybrid(
        queries, vec_candidates, fts_cands, vector_weight=2.0, fts_weight=1.0
    )
    hybrid_w3 = evaluate_hybrid(
        queries, vec_candidates, fts_cands, vector_weight=3.0, fts_weight=1.0
    )

    return {
        "vector": aggregate(vec_results),
        "fts": aggregate(fts_results),
        "hybrid_equal": aggregate(hybrid_results),
        "hybrid_vec2x": aggregate(hybrid_w2),
        "hybrid_vec3x": aggregate(hybrid_w3),
        "per_query": [
            {
                "q": q.question,
                "type": q.phrasing_type,
                "expected": q.expected_bill_key,
                "vector_rank": vr.rank,
                "fts_rank": fr.rank,
                "hybrid_equal_rank": hr.rank,
                "hybrid_vec2x_rank": h2.rank,
                "best_correct_distance": vr.best_correct_distance,
            }
            for q, vr, fr, hr, h2 in zip(
                queries, vec_results, fts_results, hybrid_results, hybrid_w2
            )
        ],
    }


# --- head2head: OpenAI vs Voyage on exact k-NN ---


def load_pool(
    db: Session, *, scope: str, target_bills: set[str], sample_bills: int
) -> tuple[list[str], list[str]]:
    """Return (bill_keys, chunk_texts) for the head-to-head corpus, aligned by row.

    scope='full'  — every retrievable chunk (89k; only viable off the Voyage free
                    tier's rate limit).
    scope='hard'  — a rate-limit-feasible pool that still poses realistic
                    competition: ALL chunks of the labeled/target+companion bills,
                    UNION a random sample of ``sample_bills`` other current-session
                    bills' chunks as distractors. Recall on this pool measures
                    whether a model ranks the correct bill above real competitors;
                    the random distractors keep it from being trivially easy. The
                    sample size is logged so coverage is never silently capped.
    """
    if scope == "full":
        rows = db.execute(
            text("select b.bill_key, rc.chunk_text " + POOL_JOIN + " order by rc.id")
        ).all()
        return [r.bill_key for r in rows], [r.chunk_text for r in rows]

    # hard scope: targets (all their chunks) + a random sample of other bills.
    target_rows = db.execute(
        text(
            "select b.bill_key, rc.chunk_text "
            + POOL_JOIN
            + " and b.bill_key = any(:keys) order by rc.id"
        ).bindparams(keys=list(target_bills))
    ).all()
    # Sample distractor BILLS at the bill level (deterministic md5 order — stable
    # across runs so cached embeddings stay valid) that are eligible AND have at
    # least one embeddable chunk on their current version.
    sampled_keys = [
        r[0]
        for r in db.execute(
            text(
                """
                select b.bill_key
                from bill b
                join legislative_session ls on ls.id = b.session_id and ls.is_current
                where b.official_url is not null and b.has_current_summary is true
                  and b.bill_key <> all(:keys)
                  and exists (
                    select 1 from rag_section_document rsd
                    join bill_version bv on bv.id = rsd.bill_version_id and bv.is_current
                    join rag_chunk rc on rc.rag_section_document_id = rsd.id
                    where rsd.bill_id = b.id
                  )
                order by md5(b.bill_key)
                limit :n
                """
            ).bindparams(keys=list(target_bills), n=sample_bills)
        ).all()
    ]
    distractor_rows = db.execute(
        text(
            "select b.bill_key, rc.chunk_text "
            + POOL_JOIN
            + " and b.bill_key = any(:keys) order by rc.id"
        ).bindparams(keys=sampled_keys)
    ).all()
    rows = list(target_rows) + list(distractor_rows)
    print(
        f"hard pool: {len(target_bills)} target bills + {len(sampled_keys)} random "
        f"distractor bills = {len(rows)} chunks",
        flush=True,
    )
    return [r.bill_key for r in rows], [r.chunk_text for r in rows]


def embed_corpus(
    model: str, texts: list[str], cache_dir: Path, *, pace: float
) -> np.ndarray:
    cache = cache_dir / f"corpus_{model.replace('/', '_')}_{len(texts)}.npy"
    if cache.exists():
        return np.load(cache)
    if model.startswith("voyage"):
        vectors = emb.embed_voyage(
            texts, model=model, input_type="document", pace_seconds=pace
        )
    else:
        vectors = emb.embed_openai(texts, model=model)
    arr = np.asarray(vectors, dtype=np.float32)
    cache_dir.mkdir(parents=True, exist_ok=True)
    np.save(cache, arr)
    return arr


def embed_queries(model: str, questions: list[str]) -> dict[str, np.ndarray]:
    if model.startswith("voyage"):
        vectors = emb.embed_voyage(questions, model=model, input_type="query")
    else:
        vectors = emb.embed_openai(questions, model=model)
    return {q: np.asarray(v, dtype=np.float32) for q, v in zip(questions, vectors)}


def run_head2head(
    db: Session,
    queries: list[Query],
    models: list[str],
    cache_dir: Path,
    *,
    scope: str,
    sample_bills: int,
    pace: float,
) -> dict:
    target_bills: set[str] = set()
    for q in queries:
        target_bills |= q.correct_keys()
    bill_keys, chunk_texts = load_pool(
        db, scope=scope, target_bills=target_bills, sample_bills=sample_bills
    )
    print(f"corpus pool ({scope}): {len(chunk_texts)} chunks", flush=True)
    out: dict = {"scope": scope, "pool_chunks": len(chunk_texts), "models": {}}
    for model in models:
        print(f"embedding corpus with {model} ...", flush=True)
        matrix = embed_corpus(model, chunk_texts, cache_dir, pace=pace)
        index = InMemoryIndex(bill_keys, matrix)
        q_vecs = embed_queries(model, [q.question for q in queries])
        results = evaluate_vector(queries, index, q_vecs, top_chunks=RESOLVE_TOP_CHUNKS)
        out["models"][model] = {
            "dim": int(matrix.shape[1]),
            **aggregate(results),
            "per_query": [
                {"q": r.query.question, "type": r.query.phrasing_type, "rank": r.rank}
                for r in results
            ],
        }
        print(
            f"  {model}: recall@5={out['models'][model]['recall'][5]:.2f} "
            f"MRR={out['models'][model]['mrr']}",
            flush=True,
        )
    return out


def main() -> None:
    common = argparse.ArgumentParser(add_help=False)
    common.add_argument("--fixture", default=str(FIXTURE))
    common.add_argument("--out", default=None, help="write full JSON report here")
    common.add_argument(
        "--cache-dir",
        default="/tmp/alethical-eval-cache",
        help="dir for cached corpus embeddings (head2head)",
    )

    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest="stage", required=True)
    sub.add_parser("baseline", parents=[common])
    h2h = sub.add_parser("head2head", parents=[common])
    h2h.add_argument(
        "--models",
        default="text-embedding-3-small,voyage-law-2,voyage-3-large",
        help="comma-separated embedding model ids",
    )
    h2h.add_argument(
        "--scope",
        choices=["full", "hard"],
        default="hard",
        help="'full' = all 89k chunks (needs high API rate limits); 'hard' = "
        "targets + random distractor sample (Voyage free-tier feasible)",
    )
    h2h.add_argument(
        "--sample-bills",
        type=int,
        default=400,
        help="hard scope: number of random distractor bills",
    )
    h2h.add_argument(
        "--pace",
        type=float,
        default=0.0,
        help="seconds to sleep between Voyage batches (rate-limit pacing)",
    )
    args = parser.parse_args()

    queries = load_fixture(args.fixture)
    engine = make_engine()
    with Session(engine) as db:
        if args.stage == "baseline":
            report = run_baseline(db, queries)
        else:
            report = run_head2head(
                db,
                queries,
                args.models.split(","),
                Path(args.cache_dir),
                scope=args.scope,
                sample_bills=args.sample_bills,
                pace=args.pace,
            )
        db.rollback()

    print(json.dumps(report, indent=2, default=str))
    if args.out:
        Path(args.out).write_text(json.dumps(report, indent=2, default=str))


if __name__ == "__main__":
    main()
