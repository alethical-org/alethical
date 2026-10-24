"""Small, synthetic source copies test private comparison integrity and fairness."""

from copy import deepcopy

import pytest

from alethical.eval.graph_eval import (
    CONTROLLED_ARMS,
    compare,
    digest,
    graph_rank,
    screen,
    serialized_evidence,
    validate_cases,
    verify_snapshot,
    within_budget,
)


def row(eid, *, bill="HF1", kind="text", text="School funding", **fields):
    return {
        "id": eid,
        "bill_key": bill,
        "kind": kind,
        "eligible": True,
        "citation_label": f"{bill} {eid}",
        "official_url": "https://www.revisor.mn.gov/synthetic-source",
        "text": text,
        "bill_version_id": "current-v1",
        "current_version_id": "current-v1",
        "is_current_version": True,
        "section_id": "section-1",
        "chunk_index": 0,
        **fields,
    }


def seal(snapshot):
    snapshot["manifest"].pop("content_digest", None)
    snapshot["manifest"]["content_digest"] = digest(snapshot)
    return snapshot


@pytest.fixture
def experiment():
    evidence = {
        "chunk:a": row("chunk:a", text="School funding for students"),
        "chunk:b": row("chunk:b", text="School grant rules", chunk_index=1),
        "authorship:a": row(
            "authorship:a",
            kind="authorship",
            text="Example person is chief author",
            relation={"from_id": "person-1", "to_id": "bill-1"},
        ),
        "chunk:unavailable": row("chunk:unavailable", eligible=False, text="School"),
        "chunk:other": row("chunk:other", bill="SF2", text="School funding"),
    }
    snapshot = seal(
        {
            "manifest": {"embedding_model": "synthetic-semantic-model"},
            "bills": {
                "HF1": {"current_version_id": "current-v1"},
                "SF2": {"current_version_id": "current-v1"},
            },
            "evidence": evidence,
            "vectors": {
                eid: {"model": "synthetic-semantic-model", "values": [1.0, 0.0]}
                for eid, value in evidence.items()
                if value["kind"] == "text"
            },
            "production_rankings": {
                "question-1": {"evidence_ids": ["chunk:a", "chunk:b"]}
            },
        }
    )
    manifest = {
        "snapshot_digest": snapshot["manifest"]["content_digest"],
        "screening_gate": {"complete_evidence_gain_pp": 10},
        "cases": [
            {
                "id": "question-1",
                "bill_key": "HF1",
                "question": "What school funding is provided?",
                "split": "held_out",
                "label_status": "reviewed",
                "expected_evidence_ids": ["chunk:a", "chunk:b"],
                "required_evidence_groups": [["chunk:a", "chunk:b"]],
            }
        ],
    }
    queries = {
        "model": "synthetic-semantic-model",
        "vectors": {manifest["cases"][0]["question"]: [1.0, 0.0]},
    }
    return snapshot, manifest, queries


@pytest.mark.parametrize("target", ["text", "vector", "production"])
def test_snapshot_tampering_fails_before_scoring(experiment, target):
    snapshot, manifest, queries = experiment
    if target == "text":
        snapshot["evidence"]["chunk:a"]["text"] = "Changed source text"
    elif target == "vector":
        snapshot["vectors"]["chunk:a"]["values"] = [0.0, 1.0]
    else:
        snapshot["production_rankings"]["question-1"]["evidence_ids"] = []
    with pytest.raises(ValueError, match="digest mismatch"):
        compare(snapshot, manifest, queries)


def test_hash_fallback_is_not_accepted_as_semantic_search(experiment):
    snapshot, _, _ = experiment
    snapshot["manifest"]["embedding_model"] = "deterministic-sha256"
    seal(snapshot)
    with pytest.raises(ValueError, match="not semantic search"):
        verify_snapshot(snapshot)


def test_every_arm_stays_inside_the_resolved_bill_and_eligible_version(experiment):
    snapshot, manifest, queries = experiment
    result = compare(snapshot, manifest, queries)
    for records in result["arms"].values():
        assert records[0]["status"] == "ok"
        assert "chunk:other" not in records[0]["evidence_ids"]
        assert "chunk:unavailable" not in records[0]["evidence_ids"]
    for arm in ("lexical_text", "vector_exact_text", "hybrid_text"):
        assert "authorship:a" not in result["arms"][arm][0]["evidence_ids"]
    assert result["answer_quality"]["status"] == "not_run"


def test_graph_neighbors_never_cross_version_even_with_the_same_section():
    pool = {
        "a": row("a"),
        "neighbor": row("neighbor", chunk_index=1),
        "old": row("old", chunk_index=1, bill_version_id="old-v0"),
        "other-section": row("other-section", chunk_index=1, section_id="section-2"),
    }
    assert graph_rank("What school funding is provided?", ["a"], pool) == [
        "a",
        "neighbor",
    ]


@pytest.mark.parametrize(
    ("field", "value"),
    [
        ("bill_version_id", "old-v0"),
        ("current_version_id", "old-v0"),
        ("is_current_version", False),
    ],
)
def test_inconsistent_source_version_is_rejected_before_ranking(
    experiment, field, value
):
    snapshot, manifest, queries = experiment
    snapshot["evidence"]["chunk:a"][field] = value
    seal(snapshot)
    manifest["snapshot_digest"] = snapshot["manifest"]["content_digest"]
    with pytest.raises(ValueError, match="non-current text version"):
        compare(snapshot, manifest, queries)


def test_bill_current_version_must_match_the_text_version(experiment):
    snapshot, _, _ = experiment
    snapshot["bills"]["HF1"]["current_version_id"] = "different-current-version"
    seal(snapshot)
    with pytest.raises(ValueError, match="non-current text version"):
        verify_snapshot(snapshot)


@pytest.mark.parametrize("shortfall", [0, 1])
def test_all_controlled_arms_count_the_same_full_serialized_evidence(
    experiment, shortfall
):
    snapshot, manifest, queries = experiment
    snapshot["evidence"] = {"chunk:a": snapshot["evidence"]["chunk:a"]}
    snapshot["production_rankings"] = {}
    seal(snapshot)
    manifest["snapshot_digest"] = snapshot["manifest"]["content_digest"]
    manifest["cases"][0]["expected_evidence_ids"] = ["chunk:a"]
    manifest["cases"][0]["required_evidence_groups"] = [["chunk:a"]]
    source = snapshot["evidence"]["chunk:a"]
    expected_text = (
        f"HF1 chunk:a\nSchool funding for students\nSource: {source['official_url']}"
    )
    assert serialized_evidence(source) == expected_text
    budget = len(expected_text) - shortfall
    manifest["character_budget"] = budget
    result = compare(snapshot, manifest, queries, budget=budget)
    for arm in CONTROLLED_ARMS:
        record = result["arms"][arm][0]
        assert record["evidence_ids"] == ([] if shortfall else ["chunk:a"])
        assert record["characters"] == (0 if shortfall else len(expected_text))
        assert record["characters"] <= budget


def test_budget_deduplicates_and_keeps_later_records_that_fit():
    pool = {"large": row("large", text="x" * 500), "small": row("small")}
    budget = len(serialized_evidence(pool["small"]))
    assert within_budget(["large", "small", "small"], pool, budget) == ["small"]
    with pytest.raises(ValueError, match="outside its allowed pool"):
        within_budget(["outside"], pool, budget)


def test_production_reference_retains_its_separate_budget(experiment):
    snapshot, manifest, queries = experiment
    budget = len(serialized_evidence(snapshot["evidence"]["chunk:a"]))
    manifest["character_budget"] = budget
    result = compare(snapshot, manifest, queries, budget=budget)
    reference = result["arms"]["production_reference"][0]
    assert reference["evidence_ids"] == ["chunk:a", "chunk:b"]
    assert reference["characters"] > budget
    assert all(
        result["arms"][arm][0]["characters"] <= budget for arm in CONTROLLED_ARMS
    )
    assert result["screen"]["best_comparable_arm"] != "production_reference"


def test_missing_query_vectors_are_not_misses_or_a_passing_screen(experiment):
    snapshot, manifest, _ = experiment
    result = compare(snapshot, manifest, None)
    for arm in ("vector_exact_text", "hybrid_text", "hybrid_all", "graph"):
        assert result["arms"][arm][0]["status"] == "not_run"
        assert result["summaries"][arm]["held_out"]["not_run_count"] == 1
        assert result["summaries"][arm]["held_out"]["status"] == "not_run"
        summary = result["summaries"][arm]["held_out"]
        assert summary["total_case_count"] == 1
        assert summary["metrics"]["denominators"]["mrr"] == 0
        assert summary["metrics"]["mrr"] is None
    assert result["arms"]["lexical_text"][0]["status"] == "ok"
    assert result["screen"]["passed"] is False
    assert "incomplete" in result["screen"]["reason"]


def test_missing_source_vectors_block_the_controlled_comparison(experiment):
    snapshot, manifest, queries = experiment
    del snapshot["vectors"]["chunk:b"]
    seal(snapshot)
    manifest["snapshot_digest"] = snapshot["manifest"]["content_digest"]
    result = compare(snapshot, manifest, queries)
    assert result["arms"]["vector_exact_text"][0]["status"] == "not_run"
    assert result["screen"]["passed"] is False
    assert "incomplete" in result["screen"]["reason"]


@pytest.mark.parametrize(
    ("field", "value", "message"),
    [
        ("label_status", "unreviewed", "source review"),
        ("split", "training", "Unknown split"),
        ("expected_evidence_ids", ["chunk:a", "chunk:a"], "Duplicate expected"),
        ("expected_evidence_ids", ["missing"], "absent"),
        ("expected_evidence_ids", ["chunk:other"], "another bill"),
        ("expected_evidence_ids", ["chunk:unavailable"], "ineligible"),
        ("required_evidence_groups", [], "required evidence groups"),
        ("required_evidence_groups", [[]], "empty or unlabelled"),
        ("required_evidence_groups", [["missing"]], "empty or unlabelled"),
    ],
)
def test_reject_bad_source_labels(experiment, field, value, message):
    snapshot, manifest, _ = experiment
    manifest["cases"][0][field] = value
    with pytest.raises(ValueError, match=message):
        validate_cases(manifest, snapshot)


def test_manifest_digest_mismatch_duplicate_cases_and_bill_split_overlap(experiment):
    snapshot, manifest, _ = experiment
    changed = deepcopy(manifest)
    changed["snapshot_digest"] = "different-copy"
    with pytest.raises(ValueError, match="different snapshot"):
        validate_cases(changed, snapshot)
    changed = deepcopy(manifest)
    changed["cases"].append(deepcopy(changed["cases"][0]))
    with pytest.raises(ValueError, match="Duplicate case"):
        validate_cases(changed, snapshot)
    changed["cases"][1].update(
        id="question-2", question="Another question", split="development"
    )
    with pytest.raises(ValueError, match="both splits"):
        validate_cases(changed, snapshot)


def test_every_required_fact_needs_one_of_its_alternative_passages(experiment):
    snapshot, manifest, queries = experiment
    case = manifest["cases"][0]
    case["expected_evidence_ids"].append("authorship:a")
    case["required_evidence_groups"] = [["chunk:a", "chunk:b"], ["authorship:a"]]
    result = compare(snapshot, manifest, queries)
    text = result["arms"]["hybrid_text"][0]
    assert text["required_groups_total"] == 2
    assert text["required_groups_found"] == 1
    assert text["complete_required"] is False
    alternative_only = deepcopy(manifest)
    alternative_only["cases"][0]["expected_evidence_ids"] = ["chunk:a", "chunk:b"]
    alternative_only["cases"][0]["required_evidence_groups"] = [["chunk:a", "chunk:b"]]
    budget = len(serialized_evidence(snapshot["evidence"]["chunk:a"]))
    alternative_only["character_budget"] = budget
    result = compare(snapshot, alternative_only, queries, budget=budget)
    assert result["arms"]["hybrid_text"][0]["complete_required"] is True
    assert result["arms"]["hybrid_text"][0]["required_groups_found"] == 1


def test_no_expected_evidence_keeps_case_and_reports_unexpected_relationship(
    experiment,
):
    snapshot, manifest, queries = experiment
    case = manifest["cases"][0]
    case["question"] = "Who authored this bill?"
    case["expected_evidence_ids"] = []
    case["required_evidence_groups"] = []
    queries["vectors"] = {case["question"]: [1.0, 0.0]}
    result = compare(snapshot, manifest, queries)
    graph = result["arms"]["graph"][0]
    assert graph["unexpected_evidence"] is True
    assert graph["unexpected_relation"] is True
    assert graph["complete_required"] is None
    metrics = result["summaries"]["graph"]["held_out"]["metrics"]
    assert metrics["n"] == 1
    assert metrics["unanswerable_count"] == 1
    assert metrics["mrr"] is None
    assert metrics["unexpected_evidence_rate"] == 1.0
    assert result["screen"]["passed"] is False


def test_labels_change_scores_without_changing_any_retrieved_records(experiment):
    snapshot, manifest, queries = experiment
    before = compare(snapshot, manifest, queries)
    manifest["cases"][0]["expected_evidence_ids"] = ["authorship:a"]
    manifest["cases"][0]["required_evidence_groups"] = [["authorship:a"]]
    after = compare(snapshot, manifest, queries)
    for arm in before["arms"]:
        assert (
            before["arms"][arm][0]["evidence_ids"]
            == after["arms"][arm][0]["evidence_ids"]
        )
    assert before["arms"]["hybrid_text"][0]["complete_required"] is True
    assert after["arms"]["hybrid_text"][0]["complete_required"] is False


def test_causal_question_does_not_promote_authorship_or_vote_relationships(experiment):
    snapshot, _, _ = experiment
    pool = {
        eid: value
        for eid, value in snapshot["evidence"].items()
        if value["bill_key"] == "HF1"
    }
    question = "Did the author cause the recorded vote through a bribe?"
    ranked = graph_rank(question, ["chunk:a"], pool)
    assert "authorship:a" not in ranked
    assert ranked[0] == "chunk:a"


def paired_cases(graph_complete, *, regression=None):
    cases = [
        {"id": f"q{i}", "split": "held_out", "required_evidence_groups": [["a"]]}
        for i in range(10)
    ] + [{"id": "refusal", "split": "held_out", "required_evidence_groups": []}]
    manifest = {"cases": cases, "screening_gate": {"complete_evidence_gain_pp": 10}}
    arms = {}
    for name in CONTROLLED_ARMS:
        complete = graph_complete if name == "graph" else set(range(4))
        if name == "hybrid_all":
            complete = set(range(5))
        arms[name] = [
            {
                "case_id": case["id"],
                "status": "ok",
                "complete_required": int(case["id"][1:]) in complete
                if case["id"] != "refusal"
                else None,
                "unexpected_evidence": name == "graph"
                and regression == "evidence"
                and case["id"] == "refusal",
                "unexpected_relation": name == "graph"
                and regression == "relation"
                and case["id"] == "refusal",
            }
            for case in cases
        ]
    return arms, manifest


def test_paired_screen_passes_only_with_the_required_gain_against_strongest_arm():
    arms, manifest = paired_cases(set(range(6)))
    result = screen(arms, manifest)
    assert result["best_comparable_arm"] == "hybrid_all"
    assert result["held_out_answerable_count"] == 10
    assert result["required_net_wins"] == 1
    assert result["wins"] == ["q5"]
    assert result["losses"] == []
    assert result["passed"] is True
    arms, manifest = paired_cases(set(range(5)))
    assert screen(arms, manifest)["passed"] is False


def test_a_paired_loss_blocks_even_when_net_gain_meets_threshold():
    arms, manifest = paired_cases({0, 1, 2, 3, 5, 6})
    result = screen(arms, manifest)
    assert result["wins"] == ["q5", "q6"]
    assert result["losses"] == ["q4"]
    assert result["passed"] is False


@pytest.mark.parametrize("regression", ["evidence", "relation"])
def test_added_evidence_or_relationship_on_refusal_blocks_passing(regression):
    arms, manifest = paired_cases(set(range(6)), regression=regression)
    result = screen(arms, manifest)
    assert result["safety_regressions"] == ["refusal"]
    assert result["passed"] is False


def test_screen_requires_held_out_answerable_cases():
    assert screen({}, {"cases": []})["passed"] is False


@pytest.mark.parametrize("threshold", [0, -10, 5, 20])
def test_screen_threshold_cannot_change(experiment, threshold):
    snapshot, manifest, queries = experiment
    manifest["screening_gate"]["complete_evidence_gain_pp"] = threshold
    with pytest.raises(ValueError, match="remain 10"):
        compare(snapshot, manifest, queries)


def test_registered_budget_and_query_vectors_cannot_change(experiment):
    snapshot, manifest, queries = experiment
    manifest["character_budget"] = 6000
    with pytest.raises(ValueError, match="Character budget"):
        compare(snapshot, manifest, queries, budget=5000)
    manifest["query_vectors_digest"] = digest(queries)
    queries["vectors"][manifest["cases"][0]["question"]] = [0.0, 1.0]
    with pytest.raises(ValueError, match="Query vectors"):
        compare(snapshot, manifest, queries)


def test_provenance_groups_preserve_denominators(experiment):
    snapshot, manifest, queries = experiment
    manifest["cases"][0]["label_provenance"] = (
        "agent_reviewed_mapping_of_human_question"
    )
    result = compare(snapshot, manifest, queries)
    for arm in CONTROLLED_ARMS:
        group = result["provenance_summaries"][arm]["held_out"][
            "agent_reviewed_mapping_of_human_question"
        ]
        whole = result["summaries"][arm]["held_out"]
        for field in (
            "total_case_count",
            "complete_count",
            "answerable_count",
            "metrics",
        ):
            assert group[field] == whole[field]


def test_every_prose_fact_must_have_a_group(experiment):
    snapshot, manifest, _ = experiment
    manifest["cases"][0]["required_facts"] = ["funding", "eligibility"]
    with pytest.raises(ValueError, match="Every required prose fact"):
        validate_cases(manifest, snapshot)


def test_shared_word_forms_match_questions_and_evidence():
    from alethical.eval.graph_eval import lexical_rank

    pool = {
        "v": row(
            "v",
            kind="vote",
            text="A legislator vote",
            relation={"from_id": "p", "to_id": "e"},
        ),
        "a": row(
            "a",
            kind="authorship",
            text="A legislator author",
            relation={"from_id": "p", "to_id": "b"},
        ),
    }
    assert lexical_rank("Who voted?", pool) == ["v"]
    assert lexical_rank("Who authored?", pool) == ["a"]
    assert graph_rank("Who voted?", [], pool) == ["v"]
    assert graph_rank("Who authored?", [], pool) == ["a"]
    assert lexical_rank("vote", {"v": row("v", text="voted")}) == ["v"]


def test_tied_baselines_cannot_hide_a_paired_loss():
    arms, manifest = paired_cases(set(range(6)))
    # Each baseline completes 5 cases, but one covers q6 which the graph misses.
    for r in arms["lexical_all"]:
        r["complete_required"] = r["case_id"] in {"q0", "q1", "q2", "q3", "q6"}
    manifest["cases"][5]["kind"] = "authorship"
    manifest["cases"][6]["kind"] = "text"
    result = screen(arms, manifest)
    assert result["equally_strong_baselines"] == ["hybrid_all", "lexical_all"]
    assert result["losses"] == ["q6"]
    assert result["losses_by_kind"]["text"] == ["q6"]
    assert result["passed"] is False


def test_graph_vote_order_uses_date_event_and_name():
    pool = {
        "z": row(
            "z",
            kind="vote",
            source_occurred_at="2025-01-01",
            event_id="event1",
            legislator_name="Ada",
            relation={"from_id": "p1", "to_id": "e1"},
        ),
        "a": row(
            "a",
            kind="vote",
            source_occurred_at="2025-01-02",
            event_id="event2",
            legislator_name="Bea",
            relation={"from_id": "p2", "to_id": "e2"},
        ),
    }
    assert graph_rank("Who voted?", [], pool) == ["z", "a"]
