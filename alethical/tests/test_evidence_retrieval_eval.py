"""Evidence retrieval checks: no database, network, or answer-generation calls."""

from math import log2

import pytest

from alethical.eval.retrieval_eval import (
    EvidenceLabel,
    EvidenceQueryResult,
    aggregate_evidence,
    evidence_retrieval_metrics,
)


def test_mixed_relevance_uses_all_expected_records_and_graded_order():
    labels = [
        EvidenceLabel("strong", 3),
        EvidenceLabel("medium", 2),
        EvidenceLabel("weak", 1),
        EvidenceLabel("irrelevant", 0),
    ]
    scores = evidence_retrieval_metrics(
        ["irrelevant", "weak", "strong"], labels, ks=(1, 2, 3, 10)
    )
    assert scores["answerable"] is True
    assert scores["expected_relevant_count"] == 3
    assert scores["recall"] == {1: 0.0, 2: 1 / 3, 3: 2 / 3, 10: 2 / 3}
    assert scores["mrr"] == 0.5
    assert scores["ndcg"][1] == 0.0
    assert scores["ndcg"][2] == pytest.approx((1 / log2(3)) / (7 + 3 / log2(3)))
    expected_ndcg = (1 / log2(3) + 7 / log2(4)) / (7 + 3 / log2(3) + 1 / log2(4))
    assert scores["ndcg"][3] == pytest.approx(expected_ndcg)
    assert scores["ndcg"][10] == pytest.approx(expected_ndcg)


def test_ideal_order_scores_one_without_counting_zero_grade():
    scores = evidence_retrieval_metrics(
        ["a", "b", "c", "irrelevant"],
        [EvidenceLabel("b", 2), EvidenceLabel("a", 3), EvidenceLabel("c", 1)],
        ks=(1, 3, 10),
    )
    assert scores["recall"] == {1: 1 / 3, 3: 1.0, 10: 1.0}
    assert scores["mrr"] == 1.0
    assert scores["ndcg"] == {1: 1.0, 3: 1.0, 10: 1.0}


def test_duplicate_ranked_ids_keep_first_seen_order_and_cannot_inflate_scores():
    labels = [EvidenceLabel("a", 3), EvidenceLabel("b", 1)]
    scores = evidence_retrieval_metrics(
        ["miss", "miss", "a", "a", "b", "b"], labels, ks=(1, 2, 3)
    )
    assert scores == evidence_retrieval_metrics(
        ["miss", "a", "b"], labels, ks=(1, 2, 3)
    )
    assert scores["retrieved_count"] == 3
    assert scores["recall"][2] == 0.5
    assert scores["mrr"] == 0.5
    assert 0 < scores["ndcg"][3] < 1


@pytest.mark.parametrize("ranked", [[], ["miss"], ["miss", "another-miss"]])
def test_answerable_cases_with_no_relevant_results_score_zero(ranked):
    scores = evidence_retrieval_metrics(ranked, [EvidenceLabel("expected", 3)])
    assert scores["answerable"] is True
    assert all(value == 0.0 for value in scores["recall"].values())
    assert scores["mrr"] == 0.0
    assert all(value == 0.0 for value in scores["ndcg"].values())
    assert scores["unexpected_evidence_returned"] is bool(ranked)


@pytest.mark.parametrize("labels", [[], [EvidenceLabel("irrelevant", 0)]])
@pytest.mark.parametrize("ranked", [[], ["irrelevant"], ["unknown", "unknown"]])
def test_empty_expected_evidence_is_not_a_perfect_retrieval(labels, ranked):
    scores = evidence_retrieval_metrics(ranked, labels, ks=(1, 3))
    assert scores["answerable"] is False
    assert scores["expected_relevant_count"] == 0
    assert scores["recall"] == {1: None, 3: None}
    assert scores["mrr"] is None
    assert scores["ndcg"] == {1: None, 3: None}
    assert scores["unexpected_evidence_returned"] is bool(ranked)


def test_aggregate_reports_denominators_and_retains_unanswerable_cases():
    scores = aggregate_evidence(
        [
            EvidenceQueryResult("hit", [EvidenceLabel("a", 3)], ["miss", "a"]),
            EvidenceQueryResult("miss", [EvidenceLabel("a", 3)], []),
            EvidenceQueryResult("unsupported", [], ["unknown"]),
            EvidenceQueryResult("empty", [], []),
        ],
        ks=(1, 3),
    )
    assert scores["n"] == 4
    assert scores["answerable_count"] == 2
    assert scores["unanswerable_count"] == 2
    assert scores["denominators"] == {
        "recall": {1: 2, 3: 2},
        "mrr": 2,
        "ndcg": {1: 2, 3: 2},
        "unexpected_evidence_rate": 2,
    }
    assert scores["recall"] == {1: 0.0, 3: 0.5}
    assert scores["mrr"] == 0.25
    assert scores["ndcg"][3] == pytest.approx(1 / log2(3) / 2)
    assert scores["unanswerable_with_evidence_count"] == 1
    assert scores["unexpected_evidence_rate"] == 0.5
    assert [case["case_id"] for case in scores["cases"]] == [
        "hit",
        "miss",
        "unsupported",
        "empty",
    ]
    assert scores["cases"][2]["mrr"] is None
    assert scores["cases"][3]["unexpected_evidence_returned"] is False


@pytest.mark.parametrize(
    "results", [[], [EvidenceQueryResult("unanswerable", [], ["unknown"])]]
)
def test_no_answerable_cases_have_null_aggregate_scores(results):
    scores = aggregate_evidence(results, ks=(1,))
    assert scores["n"] == len(results)
    assert scores["answerable_count"] == 0
    assert scores["denominators"]["mrr"] == 0
    assert scores["recall"] == {1: None}
    assert scores["mrr"] is None
    assert scores["ndcg"] == {1: None}
    assert scores["unexpected_evidence_rate"] == (1.0 if results else None)


def test_no_unanswerable_cases_have_no_unexpected_evidence_rate():
    scores = aggregate_evidence(
        [EvidenceQueryResult("answerable", [EvidenceLabel("a", 1)], ["miss"])]
    )
    assert scores["denominators"]["unexpected_evidence_rate"] == 0
    assert scores["unexpected_evidence_rate"] is None
    assert scores["cases"][0]["unexpected_evidence_returned"] is True


@pytest.mark.parametrize("grade", [-1, 4, True, False, 1.0, "3", None])
def test_reject_invalid_relevance_grades(grade):
    with pytest.raises(ValueError, match="integer from 0 to 3"):
        EvidenceLabel("a", grade)


@pytest.mark.parametrize("evidence_id", ["", " ", None, 1])
def test_reject_invalid_label_and_ranked_ids(evidence_id):
    with pytest.raises(ValueError, match="nonempty strings"):
        EvidenceLabel(evidence_id, 1)
    with pytest.raises(ValueError, match="nonempty strings"):
        evidence_retrieval_metrics([evidence_id], [])


def test_duplicate_labels_fail_instead_of_overwriting_relevance():
    with pytest.raises(ValueError, match="Duplicate evidence label"):
        evidence_retrieval_metrics(
            ["a"], [EvidenceLabel("a", 0), EvidenceLabel("a", 3)]
        )


@pytest.mark.parametrize("ks", [(), (0,), (-1,), (True,), (1.0,), ("1",), (1, 1)])
def test_reject_invalid_cutoffs_even_without_cases(ks):
    with pytest.raises(ValueError, match="Evidence cutoffs"):
        evidence_retrieval_metrics([], [], ks=ks)
    with pytest.raises(ValueError, match="Evidence cutoffs"):
        aggregate_evidence([], ks=ks)


def test_duplicate_case_ids_fail_instead_of_biasing_averages():
    with pytest.raises(ValueError, match="Duplicate evidence case"):
        aggregate_evidence(
            [EvidenceQueryResult("same", [], []), EvidenceQueryResult("same", [], [])]
        )
