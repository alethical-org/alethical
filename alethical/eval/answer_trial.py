"""Prepare private bill-text answer review inputs without generating answers.

The packet is a worksheet, not an answer-quality result or a runnable answer
fixture. Source labels describe the full frozen source; reviewers must separately
decide what the selected passages support and whether the bill is enacted.
"""

from __future__ import annotations

from copy import deepcopy

from alethical.eval.evidence_diagnostics import validate_inputs
from alethical.eval.graph_eval import digest


def _coverage(groups: list[list[str]], available: set[str]) -> dict:
    found = [
        index for index, group in enumerate(groups) if available.intersection(group)
    ]
    return {
        "required_groups_total": len(groups),
        "required_groups_found": len(found),
        "found_group_indexes": found,
        "missing_group_indexes": [i for i in range(len(groups)) if i not in found],
        "complete_labelled_support": len(found) == len(groups) if groups else None,
    }


def prepare_answer_trial(
    snapshot: dict, manifest: dict, report: dict, *, arm: str = "production_reference"
) -> dict:
    """Bind exact source records and prompts to pending private review worksheets.

    No provider, database or writer is called. Even an empty answer key does not
    automatically set the answer evaluator's ``answerable`` field: that field governs
    the writer's refusal against its supplied context, not corpus retrieval success.
    """
    validate_inputs(snapshot, manifest, report)
    if arm not in report["arms"]:
        raise ValueError("Unknown answer-trial retrieval arm")
    indexed = {row["case_id"]: row for row in report["arms"][arm]}
    evidence = snapshot["evidence"]
    cases = []
    for case in manifest["cases"]:
        retrieved = indexed[case["id"]]
        groups = case["required_evidence_groups"]
        bill_key = case["bill_key"]
        source_ids = {
            eid
            for eid, row in evidence.items()
            if row["bill_key"] == bill_key and row["eligible"]
        }
        selected = retrieved["evidence_ids"]
        entry = {
            "case_id": case["id"],
            "question": case["question"],
            "bill_key": bill_key,
            "source_labels": deepcopy(case),
            "corpus_labelled_support": _coverage(groups, source_ids),
            "selected_labelled_support": _coverage(groups, set(selected))
            if retrieved["status"] == "ok"
            else None,
            "retrieval_status": retrieved["status"],
            "selected_evidence_ids": list(selected),
        }
        cases.append(entry)
        # The explicit source-reviewed kind and required records establish scope;
        # a question with no required records must not slip through as bill text.
        if case.get("kind") != "text" or any(
            evidence[eid]["kind"] != "text" for eid in case["expected_evidence_ids"]
        ):
            entry.update(
                disposition="excluded",
                reason="Only explicitly labelled bill-text questions belong in this answer trial",
            )
            continue
        if retrieved["status"] == "not_run":
            entry.update(disposition="skipped", reason="Retrieval was not run")
            continue
        if any(evidence[eid]["kind"] != "text" for eid in selected):
            raise ValueError("Bill-text answer context contains structured evidence")
        if not selected:
            entry.update(
                disposition="skipped", reason="No passages to send to a writer"
            )
            continue

        # Count every current text record, including records that cannot be cited.
        # Missing source links must never make an incomplete reading look complete.
        text_ids = {
            eid
            for eid, row in evidence.items()
            if row["bill_key"] == bill_key and row["kind"] == "text"
        }
        captured = snapshot.get("production_rankings", {}).get(case["id"])
        if arm == "production_reference":
            if captured is None or captured["evidence_ids"] != selected:
                raise ValueError(
                    "Production reference differs from captured evidence order"
                )
            for key, expected in (
                ("passages_total", len(text_ids)),
                ("searched", len(selected)),
                ("passages_searched", len(selected)),
            ):
                if key in captured and (
                    type(captured[key]) is not int or captured[key] != expected
                ):
                    raise ValueError(
                        "Captured passage coverage differs from frozen source"
                    )

        # Import helpers only after validation and without invoking their runner.
        from scripts.answer_eval import build_user_prompt, production_system_prompt

        context = {
            "question": case["question"],
            "bill_key": bill_key,
            "bill_title": snapshot["bills"][bill_key].get("title", ""),
            "passages_total": len(text_ids),
            "chunks": [
                {
                    "citation_label": evidence[eid]["citation_label"],
                    "chunk_text": evidence[eid]["text"],
                }
                for eid in selected
            ],
        }
        if arm == "production_reference" and captured is not None:
            if "enumerating" in captured:
                context["enumerating"] = captured["enumerating"]
        entry.update(
            disposition="pending_review",
            evidence=[deepcopy(evidence[eid]) for eid in selected],
            context=context,
            context_digest=digest(context),
            prompts={
                "system": production_system_prompt(context),
                "user": build_user_prompt(context),
            },
            label_review={
                "status": "pending",
                "framing": None,
                "answerable_from_context": None,
                "required_facts": None,
                "must_not_claim": None,
                "reviewer": None,
                "source_notes": None,
                "instructions": (
                    "Review the actual source and supplied passages. Set legal framing "
                    "from source evidence, not a status label. Preserve missing facts "
                    "as retrieval misses; do not relabel an incomplete selection as an "
                    "unsupported source question. Selected examples do not establish "
                    "a complete list. Decide whether a useful, honest partial answer "
                    "is possible before setting refusal expectations."
                ),
            },
        )
    return {
        "schema_version": 1,
        "snapshot_digest": snapshot["manifest"]["content_digest"],
        "manifest_digest": digest(manifest),
        "report_digest": digest(report),
        "arm": arm,
        "scope": "Private bill-text answer preparation; no generation or public changes",
        "validation_note": (
            "These already-seen questions are regression cases, not fresh held-out "
            "validation. This worksheet is not a reviewed answer fixture."
        ),
        "label_completion_meaning": manifest.get("label_completion_meaning"),
        "counts": {
            disposition: sum(c["disposition"] == disposition for c in cases)
            for disposition in ("pending_review", "excluded", "skipped")
        },
        "cases": cases,
        "answer_quality": {
            "status": "not_run",
            "groundedness": "not_run",
            "refusal_correctness": "not_run",
            "citation_correctness": "not_run",
            "fast_path_serve_rate": None,
        },
    }
