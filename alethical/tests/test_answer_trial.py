"""Private answer preparation must not turn retrieval scores into answer claims."""

from copy import deepcopy

import pytest

from alethical.eval.answer_trial import prepare_answer_trial
from alethical.eval.graph_eval import compare, digest


def _seal(snapshot):
    snapshot["manifest"].pop("content_digest", None)
    snapshot["manifest"]["content_digest"] = digest(snapshot)


@pytest.fixture
def trial():
    def passage(eid, text, *, kind="text", bill="HF1"):
        return {
            "id": eid,
            "bill_key": bill,
            "kind": kind,
            "eligible": True,
            "citation_label": f"{bill} {eid}",
            "official_url": "https://www.revisor.mn.gov/synthetic-source",
            "text": text,
            "bill_version_id": "v1",
            "current_version_id": "v1",
            "is_current_version": True,
            "source_artifact_id": "source-1",
            "source_hash": "source-hash",
        }

    snapshot = {
        "manifest": {"embedding_model": "synthetic-semantic-model"},
        "bills": {
            "HF1": {"current_version_id": "v1", "title": "Synthetic school bill"},
            "SF2": {"current_version_id": "v1"},
        },
        "evidence": {
            "chunk:a": passage("chunk:a", "School grants for Alpha"),
            "chunk:b": passage("chunk:b", "School grants for Beta"),
            "chunk:other": passage("chunk:other", "Different bill", bill="SF2"),
            "vote:a": passage("vote:a", "A recorded individual vote", kind="vote"),
        },
        "vectors": {
            eid: {"model": "synthetic-semantic-model", "values": [1.0, 0.0]}
            for eid in ("chunk:a", "chunk:b", "chunk:other")
        },
        "production_rankings": {
            "text": {
                "evidence_ids": ["chunk:b"],
                "passages_total": 2,
                "enumerating": True,
            },
            "unsupported": {"evidence_ids": ["chunk:a"], "passages_total": 2},
            "vote": {"evidence_ids": [], "passages_total": 2},
        },
    }
    _seal(snapshot)
    cases = []
    for cid, kind, question, expected, groups in (
        (
            "text",
            "text",
            "Which schools get grants?",
            ["chunk:a", "chunk:b"],
            [["chunk:a"], ["chunk:b"]],
        ),
        ("unsupported", "text", "How much tax was collected?", [], []),
        ("vote", "vote", "Who voted yes?", ["vote:a"], [["vote:a"]]),
    ):
        cases.append(
            {
                "id": cid,
                "kind": kind,
                "question": question,
                "bill_key": "HF1",
                "split": "held_out",
                "label_status": "reviewed",
                "label_provenance": "synthetic",
                "expected_evidence_ids": expected,
                "required_evidence_groups": groups,
            }
        )
    manifest = {
        "snapshot_digest": snapshot["manifest"]["content_digest"],
        "screening_gate": {"complete_evidence_gain_pp": 10},
        "label_completion_meaning": "Selected examples, not complete inventories",
        "cases": cases,
    }
    queries = {
        "model": "synthetic-semantic-model",
        "vectors": {case["question"]: [1.0, 0.0] for case in cases},
    }
    return snapshot, manifest, compare(snapshot, manifest, queries)


def test_packet_keeps_source_and_context_support_separate_without_mutation(trial):
    originals = deepcopy(trial)
    packet = prepare_answer_trial(*trial)
    case = packet["cases"][0]
    assert case["corpus_labelled_support"]["complete_labelled_support"] is True
    assert case["selected_labelled_support"]["missing_group_indexes"] == [0]
    assert case["label_review"]["answerable_from_context"] is None
    assert case["label_review"]["framing"] is None
    assert case["source_labels"] == trial[1]["cases"][0]
    assert case["evidence"] == [trial[0]["evidence"]["chunk:b"]]
    assert case["context"]["passages_total"] == 2
    assert case["context"]["chunks"][0]["chunk_text"] == "School grants for Beta"
    assert packet["counts"] == {"pending_review": 2, "excluded": 1, "skipped": 0}
    assert packet["answer_quality"]["fast_path_serve_rate"] is None
    assert packet["answer_quality"]["status"] == "not_run"
    assert trial == originals


def test_prompts_reuse_existing_answer_helpers_without_provider_calls(
    trial, monkeypatch
):
    from scripts import answer_eval

    def forbidden(*args, **kwargs):
        pytest.fail("Answer preparation must not call a provider")

    monkeypatch.setattr(answer_eval, "build_query_embedding", forbidden)
    monkeypatch.setattr(answer_eval, "_one_sample", forbidden)
    monkeypatch.setattr(answer_eval.requests, "request", forbidden)
    packet = prepare_answer_trial(*trial)
    case = packet["cases"][0]
    assert case["prompts"]["system"] == answer_eval.production_system_prompt(
        case["context"]
    )
    assert case["prompts"]["user"] == answer_eval.build_user_prompt(case["context"])
    assert prepare_answer_trial(*trial) == packet


def test_unsupported_source_label_does_not_become_automatic_refusal_label(trial):
    case = prepare_answer_trial(*trial)["cases"][1]
    assert case["corpus_labelled_support"]["complete_labelled_support"] is None
    assert case["label_review"]["answerable_from_context"] is None
    assert case["source_labels"]["required_evidence_groups"] == []


def test_empty_selection_does_not_admit_structured_question(trial):
    case = prepare_answer_trial(*trial)["cases"][2]
    assert case["selected_evidence_ids"] == []
    assert case["disposition"] == "excluded"
    assert "prompts" not in case


def test_structured_labels_override_text_kind(trial):
    snapshot, manifest, _ = trial
    manifest["cases"][2]["kind"] = "text"
    packet = prepare_answer_trial(snapshot, manifest, compare(snapshot, manifest, None))
    assert packet["cases"][2]["disposition"] == "excluded"


def test_selected_order_and_full_reading_are_preserved(trial):
    snapshot, manifest, _ = trial
    snapshot["production_rankings"]["text"]["evidence_ids"] = ["chunk:b", "chunk:a"]
    _seal(snapshot)
    manifest["snapshot_digest"] = snapshot["manifest"]["content_digest"]
    packet = prepare_answer_trial(snapshot, manifest, compare(snapshot, manifest, None))
    case = packet["cases"][0]
    assert [r["id"] for r in case["evidence"]] == ["chunk:b", "chunk:a"]
    assert [r["chunk_text"] for r in case["context"]["chunks"]] == [
        "School grants for Beta",
        "School grants for Alpha",
    ]
    assert case["selected_labelled_support"]["complete_labelled_support"] is True
    assert case["context"]["passages_total"] == len(case["context"]["chunks"])


@pytest.mark.parametrize("target", ["snapshot", "manifest", "report"])
def test_mismatched_inputs_fail(trial, target):
    snapshot, manifest, report = trial
    if target == "snapshot":
        snapshot["evidence"]["chunk:a"]["text"] = "Altered"
    elif target == "manifest":
        manifest["cases"][0]["question"] = "Altered"
    else:
        report["snapshot_digest"] = "wrong"
    with pytest.raises(ValueError):
        prepare_answer_trial(snapshot, manifest, report)


@pytest.mark.parametrize(
    "ids", [["chunk:b", "chunk:b"], ["absent"], ["chunk:other"], ["vote:a"]]
)
def test_invalid_selected_records_fail(trial, ids):
    trial[2]["arms"]["production_reference"][0]["evidence_ids"] = ids
    with pytest.raises(ValueError):
        prepare_answer_trial(*trial)


@pytest.mark.parametrize(
    "field,value", [("passages_total", 1), ("searched", 2), ("passages_searched", True)]
)
def test_inconsistent_captured_coverage_fails(trial, field, value):
    snapshot, manifest, report = trial
    snapshot["production_rankings"]["text"][field] = value
    _seal(snapshot)
    manifest["snapshot_digest"] = snapshot["manifest"]["content_digest"]
    report["snapshot_digest"] = manifest["snapshot_digest"]
    report["manifest_digest"] = digest(manifest)
    with pytest.raises(ValueError, match="coverage"):
        prepare_answer_trial(*trial)


def test_missing_reference_is_skipped(trial):
    snapshot, manifest, _ = trial
    del snapshot["production_rankings"]["text"]
    _seal(snapshot)
    manifest["snapshot_digest"] = snapshot["manifest"]["content_digest"]
    report = compare(snapshot, manifest, None)
    case = prepare_answer_trial(snapshot, manifest, report)["cases"][0]
    assert case["disposition"] == "skipped"
    assert case["selected_labelled_support"] is None
    assert "context" not in case


def test_empty_text_context_is_skipped(trial):
    snapshot, manifest, _ = trial
    snapshot["production_rankings"]["text"]["evidence_ids"] = []
    _seal(snapshot)
    manifest["snapshot_digest"] = snapshot["manifest"]["content_digest"]
    case = prepare_answer_trial(snapshot, manifest, compare(snapshot, manifest, None))[
        "cases"
    ][0]
    assert case["disposition"] == "skipped"
    assert "prompts" not in case
