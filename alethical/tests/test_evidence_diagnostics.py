"""Synthetic labels prove bounds without changing any retrieval results."""

from copy import deepcopy

import pytest

from alethical.eval.evidence_diagnostics import diagnose
from alethical.eval.graph_eval import compare, digest, serialized_evidence


def experiment(groups, lengths=None, *, budget=6000, kinds=None, extra_cases=None):
    lengths, kinds = lengths or {}, kinds or {}
    ids = sorted({eid for group in groups for eid in group})
    evidence = {
        eid: {
            "id": eid,
            "bill_key": "HF1",
            "kind": kinds.get(eid, "text"),
            "eligible": True,
            "citation_label": eid,
            "official_url": "https://www.revisor.mn.gov/synthetic",
            "text": "school " + "x" * lengths.get(eid, 1),
            "bill_version_id": "v1",
            "current_version_id": "v1",
            "is_current_version": True,
        }
        for eid in ids
    }
    snapshot = {
        "manifest": {"embedding_model": "synthetic-semantic-model"},
        "bills": {"HF1": {"current_version_id": "v1"}},
        "evidence": evidence,
        "vectors": {},
        "production_rankings": {},
    }
    snapshot["manifest"]["content_digest"] = digest(snapshot)
    manifest = {
        "snapshot_digest": snapshot["manifest"]["content_digest"],
        "character_budget": budget,
        "screening_gate": {"complete_evidence_gain_pp": 10},
        "cases": [
            {
                "id": "q1",
                "bill_key": "HF1",
                "question": "What school funding exists?",
                "kind": "text",
                "split": "held_out",
                "label_status": "reviewed",
                "label_provenance": "synthetic_source_review",
                "expected_evidence_ids": ids,
                "required_evidence_groups": groups,
            },
            *(extra_cases or []),
        ],
    }
    return snapshot, manifest, compare(snapshot, manifest, None, budget=budget)


def feasibility(inputs, arm="lexical_all"):
    return diagnose(*inputs)["arms"][arm][0]["budget_feasibility"]


def test_witness_counts_serialized_sources_once_for_shared_groups():
    inputs = experiment([["a"], ["a", "b"]])
    result = feasibility(inputs)
    assert result["status"] == "fits"
    assert result["witness_evidence_ids"] == ["a"]
    assert result["witness_characters"] == len(
        serialized_evidence(inputs[0]["evidence"]["a"])
    )
    assert result["lower_bound_characters"] == result["witness_characters"]


def test_shared_alternative_can_fit_when_separate_cheapest_records_do_not():
    inputs = experiment([["a", "shared"], ["b", "shared"]], {"shared": 20})
    shared_size = len(serialized_evidence(inputs[0]["evidence"]["shared"]))
    inputs = experiment(
        [["a", "shared"], ["b", "shared"]], {"shared": 20}, budget=shared_size
    )
    result = feasibility(inputs)
    assert result["status"] == "fits"
    assert result["witness_evidence_ids"] == ["shared"]
    assert result["witness_characters"] == shared_size


def test_distinct_mandatory_records_prove_exceeds_even_when_each_fits():
    inputs = experiment([["a"], ["b"], ["a", "b"]], budget=100)
    sizes = [len(serialized_evidence(row)) for row in inputs[0]["evidence"].values()]
    assert max(sizes) <= 100 < sum(sizes)
    result = feasibility(inputs)
    assert result["status"] == "exceeds"
    assert result["lower_bound_characters"] == sum(sizes)
    assert result["witness_evidence_ids"] == []


def test_cheapest_record_lower_bound_can_prove_exceeds_without_singletons():
    inputs = experiment([["a", "b"]], {"a": 100, "b": 120}, budget=100)
    result = feasibility(inputs)
    assert result["status"] == "exceeds"
    assert result["lower_bound_characters"] == min(
        len(serialized_evidence(row)) for row in inputs[0]["evidence"].values()
    )


def test_unresolved_overlap_stays_undetermined_rather_than_adding_group_costs():
    inputs = experiment([["a", "b"], ["b", "c"], ["a", "c"]], budget=100)
    result = feasibility(inputs)
    size = len(serialized_evidence(inputs[0]["evidence"]["a"]))
    assert size <= 100 < 2 * size
    assert result["status"] == "undetermined"
    assert result["reason"] == "bounds_do_not_decide"
    assert result["lower_bound_characters"] == size


def test_feasibility_is_independent_of_retrieval_and_not_run_is_not_a_miss():
    inputs = experiment([["a"]])
    result = diagnose(*inputs)
    ran = result["arms"]["lexical_all"][0]
    not_run = result["arms"]["graph"][0]
    assert ran["outcome"] == "complete"
    assert not_run["outcome"] == "not_run"
    assert not_run["required_groups_found"] is None
    assert not_run["missing_group_indices"] is None
    assert not_run["budget_feasibility"] == ran["budget_feasibility"]
    summary = result["summaries"]["graph"]["overall"]
    assert summary["complete_rate"] is None
    assert summary["denominators"]["complete_rate"] == 0
    assert summary["answerable_count"] == summary["not_run_count"] == 1


def test_text_only_and_structured_arms_have_different_permitted_groups():
    inputs = experiment([["a"], ["author"]], kinds={"author": "authorship"})
    result = diagnose(*inputs)
    text = result["arms"]["lexical_text"][0]
    structured = result["arms"]["lexical_all"][0]
    assert text["outcome"] == "partial"
    assert text["found_group_indices"] == [0]
    assert text["missing_group_indices"] == [1]
    assert text["budget_feasibility"]["status"] == "undetermined"
    assert text["budget_feasibility"]["unavailable_group_indices"] == [1]
    assert structured["outcome"] == "complete"
    assert structured["budget_feasibility"]["status"] == "fits"
    summary = result["summaries"]["lexical_text"]["by_label_provenance"]
    assert summary["synthetic_source_review"]["partial_count"] == 1


def test_production_character_cap_is_not_borrowed_from_controlled_arms():
    inputs = experiment([["a"]])
    result = feasibility(inputs, "production_reference")
    assert result["status"] == "undetermined"
    assert result["character_budget"] is None
    assert result["reason"] == "unrecorded_production_character_budget"


def test_unsupported_cases_are_kept_separate_from_answerable_denominators():
    inputs = experiment([["a"]])
    snapshot, manifest, _ = inputs
    unsupported = deepcopy(manifest["cases"][0])
    unsupported.update(
        id="unsupported",
        question="Did money cause the vote?",
        kind="unsupported",
        expected_evidence_ids=[],
        required_evidence_groups=[],
    )
    manifest["cases"].append(unsupported)
    result = diagnose(snapshot, manifest, compare(snapshot, manifest, None))
    row = result["arms"]["lexical_all"][1]
    assert row["outcome"] == "not_applicable"
    assert row["budget_feasibility"]["status"] == "not_applicable"
    summary = result["summaries"]["lexical_all"]["by_split"]["held_out"]
    assert summary["total_case_count"] == 2
    assert summary["unsupported_count"] == 1
    assert summary["complete_count"] == 1
    assert summary["denominators"]["complete_rate"] == 1


def test_partial_run_summary_does_not_look_like_full_run():
    inputs = experiment([["a"]])
    snapshot, manifest, _ = inputs
    another = deepcopy(manifest["cases"][0])
    another.update(id="q2", question="What school rules exist?")
    manifest["cases"].append(another)
    report = compare(snapshot, manifest, None)
    report["arms"]["lexical_all"][1] = {
        "case_id": "q2",
        "status": "not_run",
        "evidence_ids": [],
    }
    summary = diagnose(snapshot, manifest, report)["summaries"]["lexical_all"][
        "overall"
    ]
    assert summary["status"] == "partial"
    assert summary["not_run_count"] == 1
    assert summary["complete_count"] == 1
    assert summary["denominators"] == {
        "complete_rate": 1,
        "all_answerable_cases": 2,
        "all_unsupported_cases": 0,
    }


@pytest.mark.parametrize("field", ["snapshot_digest", "manifest_digest"])
def test_wrong_report_input_digest_is_rejected(field):
    snapshot, manifest, report = experiment([["a"]])
    report[field] = "different-input"
    with pytest.raises(ValueError, match="digest mismatch"):
        diagnose(snapshot, manifest, report)


def test_registered_query_vector_digest_must_match_report():
    snapshot, manifest, _ = experiment([["a"]])
    manifest["query_vectors_digest"] = "registered-query-copy"
    report = compare(snapshot, manifest, None)
    report["query_vectors_digest"] = "changed-query-copy"
    with pytest.raises(ValueError, match="query vectors digest mismatch"):
        diagnose(snapshot, manifest, report)


@pytest.mark.parametrize("change", ["order", "not_run", "missing_snapshot_ranking"])
def test_report_cannot_change_frozen_production_reference(change):
    snapshot, manifest, _ = experiment([["a"], ["b"]])
    snapshot["production_rankings"]["q1"] = {"evidence_ids": ["a", "b"]}
    snapshot["manifest"].pop("content_digest")
    snapshot["manifest"]["content_digest"] = digest(snapshot)
    manifest["snapshot_digest"] = snapshot["manifest"]["content_digest"]
    report = compare(snapshot, manifest, None)
    if change == "order":
        report["arms"]["production_reference"][0]["evidence_ids"] = ["b", "a"]
    elif change == "not_run":
        report["arms"]["production_reference"][0] = {
            "case_id": "q1",
            "status": "not_run",
            "evidence_ids": [],
        }
    else:
        snapshot["production_rankings"] = {}
        snapshot["manifest"].pop("content_digest")
        snapshot["manifest"]["content_digest"] = digest(snapshot)
        manifest["snapshot_digest"] = snapshot["manifest"]["content_digest"]
        report["snapshot_digest"] = manifest["snapshot_digest"]
        report["manifest_digest"] = digest(manifest)
    with pytest.raises(ValueError, match="production reference differs"):
        diagnose(snapshot, manifest, report)


@pytest.mark.parametrize(
    "change", ["duplicate", "missing", "unknown", "arm", "coverage", "characters"]
)
def test_invalid_report_rows_are_rejected(change):
    snapshot, manifest, report = experiment([["a"]])
    rows = report["arms"]["lexical_all"]
    if change == "duplicate":
        rows.append(deepcopy(rows[0]))
    elif change == "missing":
        rows.clear()
    elif change == "unknown":
        rows[0]["case_id"] = "absent"
    elif change == "arm":
        del report["arms"]["graph"]
    elif change == "coverage":
        rows[0]["complete_required"] = False
    else:
        rows[0]["characters"] = 0
    with pytest.raises(ValueError):
        diagnose(snapshot, manifest, report)


@pytest.mark.parametrize("change", ["other_bill", "ineligible", "structured_text_arm"])
def test_report_evidence_cannot_escape_the_permitted_pool(change):
    snapshot, manifest, report = experiment([["a"], ["b"]])
    evidence = snapshot["evidence"]["b"]
    if change == "other_bill":
        evidence["bill_key"] = "SF2"
        snapshot["bills"]["SF2"] = {"current_version_id": "v1"}
    elif change == "ineligible":
        evidence["eligible"] = False
    else:
        evidence["kind"] = "authorship"
    manifest["cases"][0]["expected_evidence_ids"] = ["a"]
    manifest["cases"][0]["required_evidence_groups"] = [["a"]]
    snapshot["manifest"].pop("content_digest")
    snapshot["manifest"]["content_digest"] = digest(snapshot)
    manifest["snapshot_digest"] = snapshot["manifest"]["content_digest"]
    report["snapshot_digest"] = manifest["snapshot_digest"]
    report["manifest_digest"] = digest(manifest)
    with pytest.raises(ValueError, match="permitted pool"):
        diagnose(snapshot, manifest, report)


def test_diagnosis_does_not_mutate_snapshot_labels_comparison_or_gate():
    inputs = experiment([["a", "b"], ["b"]])
    before = deepcopy(inputs)
    result = diagnose(*inputs)
    assert inputs == before
    assert result["comparison_digest"] == digest(inputs[2])
    assert "screen" not in result
