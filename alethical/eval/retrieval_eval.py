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
from collections.abc import Sequence
from dataclasses import dataclass, field
from math import log2
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


# --- Evidence retrieval only; these scores do not evaluate generated answers. ---


def _validate_evidence_id(evidence_id: str) -> None:
    if not isinstance(evidence_id, str) or not evidence_id.strip():
        raise ValueError("Evidence IDs must be nonempty strings")


@dataclass(frozen=True)
class EvidenceLabel:
    """Human-assigned relevance: 0 is irrelevant, 1..3 are increasingly useful.

    IDs identify source records or passages, not a generated answer's claims.
    """

    evidence_id: str
    relevance: int

    def __post_init__(self) -> None:
        _validate_evidence_id(self.evidence_id)
        if type(self.relevance) is not int or not 0 <= self.relevance <= 3:
            raise ValueError("Evidence relevance must be an integer from 0 to 3")


@dataclass(frozen=True)
class EvidenceQueryResult:
    case_id: str
    labels: Sequence[EvidenceLabel]
    ranked_evidence_ids: Sequence[str]


def _evidence_cutoffs(ks: Sequence[int]) -> tuple[int, ...]:
    cutoffs = tuple(ks)
    if not cutoffs or any(type(k) is not int or k <= 0 for k in cutoffs):
        raise ValueError("Evidence cutoffs must be nonempty positive integers")
    if len(set(cutoffs)) != len(cutoffs):
        raise ValueError("Evidence cutoffs must be unique")
    return cutoffs


def evidence_retrieval_metrics(
    ranked_evidence_ids: Sequence[str],
    labels: Sequence[EvidenceLabel],
    *,
    ks: Sequence[int] = RECALL_KS,
) -> dict:
    """Score distinct evidence in first-seen order against independent labels.

    Recall is the fraction of ALL positively labelled evidence found in the top
    k, not a bill-level hit rate. MRR uses the first positive label anywhere in
    the supplied ranking. nDCG@k uses gain ``2**relevance - 1`` with logarithmic
    rank discounts, normalized against the best ordering of ALL labels.

    Unlabelled IDs have relevance 0. Cases with no positive labels have null
    metrics, even when retrieval is empty; returning evidence for those cases
    is reported separately. None of these metrics establishes answer accuracy,
    citation validity, coverage of a source, or a correct refusal.
    """
    cutoffs = _evidence_cutoffs(ks)
    grades: dict[str, int] = {}
    for label in labels:
        if label.evidence_id in grades:
            raise ValueError(f"Duplicate evidence label: {label.evidence_id}")
        grades[label.evidence_id] = label.relevance

    ranked: list[str] = []
    seen: set[str] = set()
    for evidence_id in ranked_evidence_ids:
        _validate_evidence_id(evidence_id)
        if evidence_id not in seen:
            seen.add(evidence_id)
            ranked.append(evidence_id)

    relevant = {evidence_id for evidence_id, grade in grades.items() if grade > 0}
    answerable = bool(relevant)
    first_rank = next(
        (rank for rank, key in enumerate(ranked, 1) if key in relevant), None
    )
    ideal_grades = sorted(grades.values(), reverse=True)
    recall: dict[int, float | None] = {}
    ndcg: dict[int, float | None] = {}
    for k in cutoffs:
        if not answerable:
            recall[k] = None
            ndcg[k] = None
            continue
        recall[k] = len(set(ranked[:k]) & relevant) / len(relevant)
        dcg = sum(
            (2 ** grades.get(key, 0) - 1) / log2(rank + 1)
            for rank, key in enumerate(ranked[:k], 1)
        )
        ideal_dcg = sum(
            (2**grade - 1) / log2(rank + 1)
            for rank, grade in enumerate(ideal_grades[:k], 1)
        )
        ndcg[k] = dcg / ideal_dcg

    return {
        "answerable": answerable,
        "expected_relevant_count": len(relevant),
        "retrieved_count": len(ranked),
        "unexpected_evidence_returned": any(key not in relevant for key in ranked),
        "recall": recall,
        "mrr": (1 / first_rank if first_rank else 0.0) if answerable else None,
        "ndcg": ndcg,
    }


def aggregate_evidence(
    results: Sequence[EvidenceQueryResult], *, ks: Sequence[int] = RECALL_KS
) -> dict:
    """Macro-average retrieval scores over answerable cases, retaining every case.

    The unexpected-evidence rate uses ONLY unanswerable cases as its denominator.
    Empty denominators yield null, rather than a perfect score or a zero rate.
    Case IDs must be unique so an accidental repeated case cannot bias averages.
    """
    cutoffs = _evidence_cutoffs(ks)
    cases: list[dict] = []
    case_ids: set[str] = set()
    for result in results:
        if not isinstance(result.case_id, str) or not result.case_id.strip():
            raise ValueError("Evidence case IDs must be nonempty strings")
        if result.case_id in case_ids:
            raise ValueError(f"Duplicate evidence case: {result.case_id}")
        case_ids.add(result.case_id)
        cases.append(
            {
                "case_id": result.case_id,
                **evidence_retrieval_metrics(
                    result.ranked_evidence_ids, result.labels, ks=cutoffs
                ),
            }
        )
    answerable = [case for case in cases if case["answerable"]]
    unanswerable = [case for case in cases if not case["answerable"]]
    metric_n = len(answerable)
    unexpected_n = sum(case["unexpected_evidence_returned"] for case in unanswerable)
    return {
        "n": len(cases),
        "answerable_count": metric_n,
        "unanswerable_count": len(unanswerable),
        "denominators": {
            "recall": dict.fromkeys(cutoffs, metric_n),
            "mrr": metric_n,
            "ndcg": dict.fromkeys(cutoffs, metric_n),
            "unexpected_evidence_rate": len(unanswerable),
        },
        "recall": {
            k: sum(case["recall"][k] for case in answerable) / metric_n
            if metric_n
            else None
            for k in cutoffs
        },
        "mrr": sum(case["mrr"] for case in answerable) / metric_n if metric_n else None,
        "ndcg": {
            k: sum(case["ndcg"][k] for case in answerable) / metric_n
            if metric_n
            else None
            for k in cutoffs
        },
        "unanswerable_with_evidence_count": unexpected_n,
        "unexpected_evidence_rate": unexpected_n / len(unanswerable)
        if unanswerable
        else None,
        "cases": cases,
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
