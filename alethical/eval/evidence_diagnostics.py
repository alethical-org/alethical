"""Offline explanations of frozen evidence comparisons, separate from their gates.

Labelled alternatives are used only here, after retrieval. A cheap witness can
prove that labels fit; failure to find one is not proof that fitting is impossible.
"""

from __future__ import annotations

from collections import Counter

from alethical.eval.graph_eval import (
    CHARACTER_BUDGET,
    CONTROLLED_ARMS,
    digest,
    serialized_evidence,
    validate_cases,
    verify_snapshot,
)

TEXT_ARMS = frozenset(
    ("lexical_text", "vector_exact_text", "hybrid_text", "production_reference")
)


def validate_inputs(snapshot: dict, manifest: dict, report: dict) -> None:
    """Reject mismatched or malformed comparisons before reading their outcomes."""
    verify_snapshot(snapshot)
    validate_cases(manifest, snapshot)
    if report.get("snapshot_digest") != snapshot["manifest"]["content_digest"]:
        raise ValueError("Report snapshot digest mismatch")
    if report.get("manifest_digest") != digest(manifest):
        raise ValueError("Report manifest digest mismatch")
    if (
        manifest.get("query_vectors_digest") is not None
        and report.get("query_vectors_digest") != manifest["query_vectors_digest"]
    ):
        raise ValueError("Report query vectors digest mismatch")
    budget = report.get("character_budget")
    if (
        type(budget) is not int
        or budget <= 0
        or budget != manifest.get("character_budget", CHARACTER_BUDGET)
    ):
        raise ValueError("Report character budget differs from the manifest")
    if set(report.get("arms", {})) != {*CONTROLLED_ARMS, "production_reference"}:
        raise ValueError("Report must contain exactly the comparison arms")
    cases = {case["id"]: case for case in manifest["cases"]}
    for arm, rows in report["arms"].items():
        ids = [row["case_id"] for row in rows]
        if len(ids) != len(set(ids)) or set(ids) != set(cases):
            raise ValueError("Report contains duplicate, unknown, or missing case IDs")
        for row in rows:
            case = cases[row["case_id"]]
            selected = row["evidence_ids"]
            if row["status"] not in {"ok", "not_run"}:
                raise ValueError("Unknown report row status")
            if arm == "production_reference":
                saved = snapshot.get("production_rankings", {}).get(case["id"])
                expected_status = "ok" if saved else "not_run"
                expected_ids = saved.get("evidence_ids", []) if saved else []
                if row["status"] != expected_status or selected != expected_ids:
                    raise ValueError(
                        "Report production reference differs from snapshot"
                    )
            if len(selected) != len(set(selected)):
                raise ValueError("Report contains duplicate evidence IDs")
            if row["status"] == "not_run" and selected:
                raise ValueError("Not-run report row contains evidence")
            for eid in selected:
                evidence = snapshot["evidence"].get(eid)
                if (
                    not evidence
                    or not evidence["eligible"]
                    or evidence["bill_key"] != case["bill_key"]
                    or (arm in TEXT_ARMS and evidence["kind"] != "text")
                ):
                    raise ValueError(
                        "Report contains evidence outside its permitted pool"
                    )
            if row["status"] == "not_run":
                continue
            characters = sum(
                len(serialized_evidence(snapshot["evidence"][eid])) for eid in selected
            )
            if row.get("characters") != characters or (
                arm in CONTROLLED_ARMS and characters > budget
            ):
                raise ValueError("Report contains invalid evidence character totals")
            groups = case["required_evidence_groups"]
            found = sum(bool(set(group) & set(selected)) for group in groups)
            complete = found == len(groups) if groups else None
            if (
                row.get("required_groups_found") != found
                or row.get("required_groups_total") != len(groups)
                or row.get("complete_required") is not complete
            ):
                raise ValueError(
                    "Report required-group coverage differs from its evidence"
                )


def _feasibility(
    groups: list[list[str]], sizes: dict[str, int], budget: int | None
) -> dict:
    permitted = [set(group) & sizes.keys() for group in groups]
    unavailable = [index for index, group in enumerate(permitted) if not group]
    result = {
        "status": "undetermined",
        "character_budget": budget,
        "unavailable_group_indices": unavailable,
        "lower_bound_characters": None,
        "witness_evidence_ids": [],
        "witness_characters": None,
    }
    if not groups:
        return {**result, "status": "not_applicable", "reason": "unsupported_case"}
    if unavailable:
        return {**result, "reason": "required_evidence_outside_permitted_pool"}
    mandatory = {next(iter(group)) for group in permitted if len(group) == 1}
    # Both quantities are lower bounds independently. Their maximum is safe;
    # adding cheapest alternatives double-counts records shared across groups.
    lower = max(
        sum(sizes[eid] for eid in mandatory),
        max(min(sizes[eid] for eid in group) for group in permitted),
    )
    result["lower_bound_characters"] = lower
    witness = {min(group, key=lambda eid: (sizes[eid], eid)) for group in permitted}
    # Also consider one record covering every group. This bounded construction
    # is not an exact set-cover solver or a retrieval ranking.
    common = set.intersection(*permitted)
    if common:
        shared = {min(common, key=lambda eid: (sizes[eid], eid))}
        if sum(sizes[eid] for eid in shared) < sum(sizes[eid] for eid in witness):
            witness = shared
    used = sum(sizes[eid] for eid in witness)
    if budget is None:
        return {**result, "reason": "unrecorded_production_character_budget"}
    if lower > budget:
        return {**result, "status": "exceeds", "reason": "proven_lower_bound"}
    if used <= budget:
        return {
            **result,
            "status": "fits",
            "reason": "labelled_witness",
            "witness_evidence_ids": sorted(witness),
            "witness_characters": used,
        }
    return {**result, "reason": "bounds_do_not_decide"}


def _summarize(rows: list[dict]) -> dict:
    counts = Counter(row["outcome"] for row in rows)
    answerable = [row for row in rows if row["required_groups_total"]]
    run = [row for row in answerable if row["retrieval_status"] == "ok"]
    not_run = sum(row["retrieval_status"] == "not_run" for row in rows)
    return {
        "status": "empty"
        if not rows
        else "not_run"
        if not_run == len(rows)
        else "partial"
        if not_run
        else "ok",
        "total_case_count": len(rows),
        "answerable_count": len(answerable),
        "unsupported_count": len(rows) - len(answerable),
        "not_run_count": not_run,
        "complete_count": counts["complete"],
        "partial_count": counts["partial"],
        "missing_count": counts["missing"],
        "unexpected_evidence_count": sum(row["unexpected_evidence"] for row in rows),
        "complete_rate": counts["complete"] / len(run) if run else None,
        "denominators": {
            "complete_rate": len(run),
            "all_answerable_cases": len(answerable),
            "all_unsupported_cases": len(rows) - len(answerable),
        },
        "feasibility_counts": dict(
            Counter(row["budget_feasibility"]["status"] for row in rows)
        ),
    }


def diagnose(snapshot: dict, manifest: dict, report: dict) -> dict:
    """Explain coverage and source-labelled budget feasibility without reranking."""
    validate_inputs(snapshot, manifest, report)
    cases = {case["id"]: case for case in manifest["cases"]}
    arms, summaries = {}, {}
    for arm, records in report["arms"].items():
        rows = []
        for record in records:
            case = cases[record["case_id"]]
            groups = case["required_evidence_groups"]
            selected = set(record["evidence_ids"])
            ran = record["status"] == "ok"
            found = [
                index for index, group in enumerate(groups) if set(group) & selected
            ]
            missing = [index for index in range(len(groups)) if index not in found]
            sizes = {
                eid: len(serialized_evidence(row))
                for eid, row in snapshot["evidence"].items()
                if row["bill_key"] == case["bill_key"]
                and row["eligible"]
                and (arm not in TEXT_ARMS or row["kind"] == "text")
            }
            rows.append(
                {
                    "case_id": case["id"],
                    "kind": case.get("kind", "unspecified"),
                    "split": case["split"],
                    "label_provenance": case.get("label_provenance", "unspecified"),
                    "retrieval_status": record["status"],
                    "outcome": "not_run"
                    if not ran
                    else "not_applicable"
                    if not groups
                    else "complete"
                    if not missing
                    else "partial"
                    if found
                    else "missing",
                    "required_groups_total": len(groups),
                    "required_groups_found": len(found) if ran else None,
                    "found_group_indices": found if ran else None,
                    "missing_group_indices": missing if ran else None,
                    "unexpected_evidence": ran and not groups and bool(selected),
                    "budget_feasibility": _feasibility(
                        groups,
                        sizes,
                        report["character_budget"] if arm in CONTROLLED_ARMS else None,
                    ),
                }
            )
        arms[arm] = rows
        summaries[arm] = {"overall": _summarize(rows)}
        for field in ("kind", "split", "label_provenance"):
            summaries[arm][f"by_{field}"] = {
                value: _summarize([row for row in rows if row[field] == value])
                for value in sorted({row[field] for row in rows})
            }
    return {
        "schema_version": 1,
        "snapshot_digest": report["snapshot_digest"],
        "manifest_digest": report["manifest_digest"],
        "comparison_digest": digest(report),
        "scope": "Offline label diagnostics only; comparison scores and screening gates are unchanged",
        "group_index_base": 0,
        "production_reference_note": "Text-only serving selection; its frozen snapshot records no serialized-character cap",
        "arms": arms,
        "summaries": summaries,
    }
