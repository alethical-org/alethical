"""Retrieval-quality eval runner (#399/#400/#380/#255).

Measures whether semantic bill resolution finds the human-labeled correct bill,
on a fixture of real MN-bill questions. Three retrieval variants share one metric
path so their scores are directly comparable:

* ``vector``   — cosine k-NN over one embedding model's vectors (the incumbent
  behavior; also the per-model arm of the OpenAI-vs-Voyage head-to-head, #400).
* ``fts``      — Postgres full-text (``websearch_to_tsquery``) keyword ranking.
* ``hybrid``   — ``vector`` fused with ``fts`` via Reciprocal Rank Fusion (#380).

Metrics: recall@{1,3,5,10}, MRR, and the cosine-distance distribution of the
correct bill's best chunk (the input to the #255 threshold tuning).

Labels come from ``fixtures/retrieval_queries.json`` — assigned by human reading,
never by vector search — so the eval is an independent answer key.
"""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from pathlib import Path

import numpy as np

RECALL_KS = (1, 3, 5, 10)
RRF_K = 60  # Reciprocal Rank Fusion constant (Supabase hybrid-search default).


@dataclass(frozen=True)
class Query:
    question: str
    expected_bill_key: str
    phrasing_type: str
    accept_companion: bool = False
    companion_bill_key: str | None = None
    why_this_bill: str = ""

    def correct_keys(self) -> set[str]:
        keys = {self.expected_bill_key}
        if self.accept_companion and self.companion_bill_key:
            keys.add(self.companion_bill_key)
        return keys


def load_fixture(path: str | Path) -> list[Query]:
    payload = json.loads(Path(path).read_text())
    return [
        Query(
            question=q["question"],
            expected_bill_key=q["expected_bill_key"],
            phrasing_type=q.get("phrasing_type", "unknown"),
            accept_companion=q.get("accept_companion", False),
            companion_bill_key=q.get("companion_bill_key"),
            why_this_bill=q.get("why_this_bill", ""),
        )
        for q in payload["queries"]
    ]


def bills_in_rank_order(chunk_bill_keys: list[str]) -> list[str]:
    """Collapse a rank-ordered chunk list to distinct bills, keeping first-seen order.

    Mirrors ``_semantic_candidate_bills`` in ask.py: a bill's rank is the rank of
    its best-matching chunk.
    """
    seen: set[str] = set()
    ordered: list[str] = []
    for key in chunk_bill_keys:
        if key not in seen:
            seen.add(key)
            ordered.append(key)
    return ordered


def rank_of_correct(candidate_bills: list[str], correct: set[str]) -> int | None:
    """1-indexed rank of the first correct bill in the candidate list, or None."""
    for i, key in enumerate(candidate_bills, start=1):
        if key in correct:
            return i
    return None


@dataclass
class QueryResult:
    query: Query
    rank: int | None
    best_correct_distance: float | None = (
        None  # cosine distance of correct bill's top chunk
    )
    top_bills: list[str] = field(default_factory=list)


def aggregate(results: list[QueryResult]) -> dict:
    n = len(results)
    recall = {
        k: sum(1 for r in results if r.rank is not None and r.rank <= k) / n
        for k in RECALL_KS
    }
    mrr = sum((1.0 / r.rank) for r in results if r.rank is not None) / n
    resolved = [r for r in results if r.rank is not None]
    dists = [
        r.best_correct_distance for r in resolved if r.best_correct_distance is not None
    ]
    by_type: dict[str, dict] = {}
    for r in results:
        t = r.query.phrasing_type
        bucket = by_type.setdefault(t, {"n": 0, "hit@5": 0})
        bucket["n"] += 1
        if r.rank is not None and r.rank <= 5:
            bucket["hit@5"] += 1
    return {
        "n": n,
        "recall": recall,
        "mrr": round(mrr, 4),
        "misses@10": [
            r.query.question for r in results if r.rank is None or r.rank > 10
        ],
        "correct_distance": {
            "count": len(dists),
            "min": round(min(dists), 4) if dists else None,
            "max": round(max(dists), 4) if dists else None,
            "mean": round(float(np.mean(dists)), 4) if dists else None,
            "p90": round(float(np.percentile(dists, 90)), 4) if dists else None,
            "p95": round(float(np.percentile(dists, 95)), 4) if dists else None,
        },
        "by_phrasing_type": by_type,
    }


# --- In-memory exact cosine k-NN (fair, method-controlled model comparison) ---


class InMemoryIndex:
    """Exact cosine k-NN over a normalized vector matrix aligned with bill keys.

    Rows are chunks; ``bill_keys[i]`` is the bill each row belongs to. Vectors are
    L2-normalized at load so cosine similarity is a single dot product.
    """

    def __init__(self, bill_keys: list[str], matrix: np.ndarray):
        assert matrix.ndim == 2 and matrix.shape[0] == len(bill_keys)
        norms = np.linalg.norm(matrix, axis=1, keepdims=True)
        norms[norms == 0] = 1.0
        self.matrix = (matrix / norms).astype(np.float32)
        self.bill_keys = np.asarray(bill_keys)

    def search(
        self, query_vec: np.ndarray, top_chunks: int
    ) -> tuple[list[str], np.ndarray]:
        """Return (bill_keys_of_top_chunks, cosine_distances) for the top chunks."""
        q = query_vec.astype(np.float32)
        q = q / (np.linalg.norm(q) or 1.0)
        sims = self.matrix @ q
        top = np.argpartition(-sims, min(top_chunks, len(sims) - 1))[:top_chunks]
        top = top[np.argsort(-sims[top])]
        distances = 1.0 - sims[top]
        return list(self.bill_keys[top]), distances


def evaluate_vector(
    queries: list[Query],
    index: InMemoryIndex,
    query_vectors: dict[str, np.ndarray],
    *,
    top_chunks: int = 25,
) -> list[QueryResult]:
    """Score each query against an in-memory vector index. ``query_vectors`` maps
    question -> embedding (same model/space as the index)."""
    results: list[QueryResult] = []
    for q in queries:
        chunk_bills, distances = index.search(query_vectors[q.question], top_chunks)
        candidates = bills_in_rank_order(chunk_bills)
        rank = rank_of_correct(candidates, q.correct_keys())
        best_correct = _best_distance_for(chunk_bills, distances, q.correct_keys())
        results.append(
            QueryResult(
                query=q,
                rank=rank,
                best_correct_distance=best_correct,
                top_bills=candidates[:10],
            )
        )
    return results


def _best_distance_for(
    chunk_bills: list[str], distances: np.ndarray, correct: set[str]
) -> float | None:
    for key, dist in zip(chunk_bills, distances):
        if key in correct:
            return float(dist)
    return None


# --- Reciprocal Rank Fusion (hybrid vector + FTS, #380) ---


def reciprocal_rank_fusion(
    rankings: list[list[str]], *, k: int = RRF_K, weights: list[float] | None = None
) -> list[str]:
    """Fuse several ranked bill lists into one by RRF: score = sum w/(k+rank).

    ``rankings`` is a list of bill-key lists, each already in descending relevance
    for one retrieval arm. ``weights`` scales each arm's contribution (default all
    1.0). Up-weighting a stronger arm keeps its confident top hits from being
    dragged down by a weaker arm. Returns bills sorted by fused score (highest
    first).
    """
    if weights is None:
        weights = [1.0] * len(rankings)
    scores: dict[str, float] = {}
    for ranking, weight in zip(rankings, weights):
        for rank, key in enumerate(ranking, start=1):
            scores[key] = scores.get(key, 0.0) + weight / (k + rank)
    return sorted(scores, key=lambda key: scores[key], reverse=True)


def evaluate_hybrid(
    queries: list[Query],
    vector_candidates: dict[str, list[str]],
    fts_candidates: dict[str, list[str]],
    *,
    vector_weight: float = 1.0,
    fts_weight: float = 1.0,
) -> list[QueryResult]:
    """Score queries with RRF fusion of a vector arm and an FTS arm (both are
    per-question bill lists in rank order). ``vector_weight``/``fts_weight`` tune
    the fusion — vector-weighted fusion preserves vector's strong rank-1s while
    still letting FTS rescue exact-term misses (#380)."""
    results: list[QueryResult] = []
    for q in queries:
        fused = reciprocal_rank_fusion(
            [vector_candidates.get(q.question, []), fts_candidates.get(q.question, [])],
            weights=[vector_weight, fts_weight],
        )
        rank = rank_of_correct(fused, q.correct_keys())
        results.append(QueryResult(query=q, rank=rank, top_bills=fused[:10]))
    return results
