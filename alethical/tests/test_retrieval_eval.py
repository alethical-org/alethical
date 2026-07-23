"""Unit tests for the retrieval-eval metric/fusion primitives (#399/#380).

Pure functions only — no DB, no network — so they run in CI. The end-to-end
runner (scripts/retrieval_eval.py) needs prod embeddings and is exercised
manually against production.
"""

from __future__ import annotations

from alethical.eval.retrieval_eval import (
    Query,
    QueryResult,
    aggregate,
    bills_in_rank_order,
    load_fixture,
    rank_of_correct,
    reciprocal_rank_fusion,
)


def test_bills_in_rank_order_dedupes_keeping_first_seen():
    chunks = ["B", "B", "A", "C", "A"]
    assert bills_in_rank_order(chunks) == ["B", "A", "C"]


def test_rank_of_correct_first_match_and_companion():
    assert rank_of_correct(["A", "B", "C"], {"B"}) == 2
    # companion acceptance: either key counts, earliest wins
    assert rank_of_correct(["A", "B", "C"], {"C", "A"}) == 1
    assert rank_of_correct(["A", "B"], {"Z"}) is None


def test_reciprocal_rank_fusion_weights_favor_stronger_arm():
    vector = ["A", "B", "C"]  # A is vector's #1
    fts = ["C", "B", "A"]  # A is fts's last
    # Equal weights: C and A are symmetric; B stays middle. Tie broken by insertion.
    equal = reciprocal_rank_fusion([vector, fts])
    assert set(equal) == {"A", "B", "C"}
    # Vector-weighted: A (vector #1) must beat C (vector #3) despite fts.
    weighted = reciprocal_rank_fusion([vector, fts], weights=[3.0, 1.0])
    assert weighted.index("A") < weighted.index("C")


def test_reciprocal_rank_fusion_unions_candidates():
    # A candidate found by only one arm still appears in the fused list.
    fused = reciprocal_rank_fusion([["A"], ["B"]])
    assert set(fused) == {"A", "B"}


def test_aggregate_recall_mrr_and_distance():
    q = Query("q", "HF1", "colloquial")
    results = [
        QueryResult(q, rank=1, best_correct_distance=0.2),
        QueryResult(q, rank=3, best_correct_distance=0.4),
        QueryResult(q, rank=None),  # miss
    ]
    agg = aggregate(results)
    assert agg["n"] == 3
    assert agg["recall"][1] == 1 / 3  # only the rank-1 hit
    assert agg["recall"][3] == 2 / 3  # rank-1 and rank-3
    assert round(agg["mrr"], 4) == round((1.0 + 1 / 3 + 0) / 3, 4)
    assert agg["correct_distance"]["count"] == 2
    assert agg["correct_distance"]["max"] == 0.4


def test_fixture_loads_and_is_well_formed():
    import pathlib

    fixture = (
        pathlib.Path(__file__).resolve().parents[1]
        / "eval/fixtures/retrieval_queries.json"
    )
    queries = load_fixture(fixture)
    assert len(queries) >= 15
    assert all(q.question and q.expected_bill_key and q.why_this_bill for q in queries)
    # every companion-accepting query names its companion
    for q in queries:
        if q.accept_companion:
            assert q.companion_bill_key
