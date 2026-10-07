"""Private, bill-scoped evidence experiments; never a public answer service.

All controlled arms see the same snapshot. Labels are used only after retrieval.
A retrieved record is not an answer and does not establish motive or causation.
"""

from __future__ import annotations

import copy
import hashlib
import json
import math
import re
from collections import Counter

import numpy as np

from alethical.eval.retrieval_eval import (
    EvidenceLabel,
    EvidenceQueryResult,
    aggregate_evidence,
    reciprocal_rank_fusion,
)

CHARACTER_BUDGET = 6000
CONTROLLED_ARMS = (
    "lexical_text",
    "vector_exact_text",
    "hybrid_text",
    "lexical_all",
    "hybrid_all",
    "graph",
)
STOPWORDS = frozenset(
    "a an and are as at be bill by do does for from how in is it of on or that the their this to what when which who with would".split()
)
WORD_FORMS = {
    "voted": "vote",
    "votes": "vote",
    "authors": "author",
    "authored": "author",
    "legislators": "legislator",
}


def digest(value: object) -> str:
    return hashlib.sha256(
        json.dumps(
            value,
            sort_keys=True,
            separators=(",", ":"),
            ensure_ascii=False,
            allow_nan=False,
        ).encode()
    ).hexdigest()


def verify_snapshot(snapshot: dict) -> None:
    value = copy.deepcopy(snapshot)
    expected = value["manifest"].pop("content_digest")
    if digest(value) != expected:
        raise ValueError("Snapshot digest mismatch; do not score changed evidence")
    if snapshot["manifest"]["embedding_model"] == "deterministic-sha256":
        raise ValueError("Hash fallback vectors are not semantic search")
    for row in snapshot["evidence"].values():
        if row["kind"] == "text" and (
            row.get("is_current_version") is not True
            or row.get("bill_version_id") != row.get("current_version_id")
            or row.get("bill_version_id")
            != snapshot["bills"][row["bill_key"]]["current_version_id"]
        ):
            raise ValueError("Snapshot contains a non-current text version")


def validate_cases(manifest: dict, snapshot: dict) -> None:
    """Reject incomplete labels rather than making missing labels look like misses."""
    if manifest.get("screening_gate", {}).get("complete_evidence_gain_pp") != 10:
        raise ValueError(
            "The pre-registered screening gain must remain 10 percentage points"
        )
    if manifest["snapshot_digest"] != snapshot["manifest"]["content_digest"]:
        raise ValueError("Manifest belongs to a different snapshot")
    seen, questions, splits = set(), set(), {}
    for case in manifest["cases"]:
        if case["id"] in seen or (case["bill_key"], case["question"]) in questions:
            raise ValueError("Duplicate case or bill/question")
        seen.add(case["id"])
        questions.add((case["bill_key"], case["question"]))
        if case["split"] not in {"development", "held_out"}:
            raise ValueError("Unknown split")
        if splits.setdefault(case["bill_key"], case["split"]) != case["split"]:
            raise ValueError("A bill cannot occur in both splits")
        if case["label_status"] != "reviewed":
            raise ValueError("Evidence labels still require source review")
        expected = case["expected_evidence_ids"]
        if len(set(expected)) != len(expected):
            raise ValueError("Duplicate expected evidence")
        for eid in expected:
            row = snapshot["evidence"].get(eid)
            if not row or row["bill_key"] != case["bill_key"] or not row["eligible"]:
                raise ValueError(
                    "Expected evidence is absent, ineligible, or from another bill"
                )
        groups = case["required_evidence_groups"]
        if case.get("required_facts") and len(groups) != len(case["required_facts"]):
            raise ValueError("Every required prose fact needs an evidence group")
        if bool(expected) != bool(groups):
            raise ValueError("Answerable cases need required evidence groups")
        if any(not group or not set(group) <= set(expected) for group in groups):
            raise ValueError("Required evidence group is empty or unlabelled")
        if not expected and case.get("required_facts"):
            raise ValueError("Refusal cases cannot require unsupported prose facts")
    if not seen:
        raise ValueError("Empty evaluation")


def serialized_evidence(row: dict) -> str:
    """Exactly the same representation for graph and ordinary-search budgets."""
    return f"{row['citation_label']}\n{row['text']}\nSource: {row['official_url']}"


def _terms(text: str) -> list[str]:
    return [
        WORD_FORMS.get(t, t)
        for t in re.findall(r"\w+", text.casefold())
        if t not in STOPWORDS
    ]


def lexical_rank(question: str, pool: dict[str, dict]) -> list[str]:
    """Deterministic BM25 over this bill's allowed evidence, not Postgres FTS."""
    query = set(_terms(question))
    counts = {
        eid: Counter(_terms(serialized_evidence(row))) for eid, row in pool.items()
    }
    lengths = {eid: sum(count.values()) for eid, count in counts.items()}
    avg = sum(lengths.values()) / len(lengths) if lengths else 1.0
    scores = {}
    for term in query:
        df = sum(term in count for count in counts.values())
        if not df:
            continue
        idf = math.log(1 + (len(pool) - df + 0.5) / (df + 0.5))
        for eid, count in counts.items():
            tf = count[term]
            if tf:
                scores[eid] = scores.get(eid, 0) + idf * tf * 2.2 / (
                    tf + 1.2 * (0.25 + 0.75 * lengths[eid] / (avg or 1))
                )
    return sorted(scores, key=lambda eid: (-scores[eid], eid))


def vector_rank(
    question: str, pool: dict[str, dict], snapshot: dict, queries: dict | None
) -> list[str] | None:
    if queries is None or question not in queries["vectors"]:
        return None
    if any(eid not in snapshot["vectors"] for eid in pool):
        return None
    model = snapshot["manifest"]["embedding_model"]
    if queries["model"] != model:
        raise ValueError("Query and source embedding models differ")
    q = np.asarray(queries["vectors"][question], dtype=np.float64)
    if q.ndim != 1 or not np.isfinite(q).all() or not np.linalg.norm(q):
        raise ValueError("Invalid query vector")
    scored = []
    for eid in sorted(pool):
        vector = snapshot["vectors"].get(eid)
        if vector is None:
            continue
        if vector["model"] != model:
            raise ValueError("Mixed source embedding models")
        v = np.asarray(vector["values"], dtype=np.float64)
        if v.shape != q.shape or not np.isfinite(v).all() or not np.linalg.norm(v):
            raise ValueError("Invalid source vector")
        scored.append((float(v @ q / (np.linalg.norm(v) * np.linalg.norm(q))), eid))
    return [eid for _, eid in sorted(scored, key=lambda value: (-value[0], value[1]))]


def graph_rank(question: str, seeds: list[str], pool: dict[str, dict]) -> list[str]:
    """Fixed within-bill traversals; receives no labels, case kind, or answer key."""
    lower = question.casefold()
    # A relationship cannot establish motive. This is experiment routing, not a
    # claim that a short keyword rule solves public intent classification.
    causal = bool(re.search(r"\b(caus\w*|brib\w*|corrupt\w*|motive\w*)\b", lower))
    kind = None
    terms = set(_terms(question))
    if not causal:
        if "author" in terms:
            kind = "authorship"
        elif "vote" in terms:
            kind = "vote"
    related = [
        eid
        for eid, row in sorted(pool.items())
        if row["kind"] == kind
        and row.get("relation", {}).get("from_id")
        and row.get("relation", {}).get("to_id")
    ]
    related.sort(
        key=lambda eid: (
            pool[eid].get("source_occurred_at") or "",
            pool[eid].get("event_id") or "",
            pool[eid].get("legislator_name") or "",
            eid,
        )
    )
    if related:
        return list(dict.fromkeys(related + seeds))
    expanded = []
    for eid in seeds:
        expanded.append(eid)
        row = pool[eid]
        section = row.get("section_id")
        if not section or row["kind"] != "text":
            continue
        neighbors = [
            other
            for other, r in pool.items()
            if other != eid
            and r["kind"] == "text"
            and r.get("section_id") == section
            and r.get("bill_version_id") == row.get("bill_version_id")
            and abs(r.get("chunk_index", -999) - row.get("chunk_index", 999)) == 1
        ]
        expanded.extend(sorted(neighbors))
    return list(dict.fromkeys(expanded))


def within_budget(ranking: list[str], pool: dict[str, dict], budget: int) -> list[str]:
    if budget <= 0:
        raise ValueError("Evidence character budget must be positive")
    selected, used = [], 0
    for eid in dict.fromkeys(ranking):
        if eid not in pool:
            raise ValueError("Retriever returned evidence outside its allowed pool")
        size = len(serialized_evidence(pool[eid]))
        if used + size <= budget:
            selected.append(eid)
            used += size
    return selected


def compare(
    snapshot: dict,
    manifest: dict,
    queries: dict | None,
    *,
    budget: int = CHARACTER_BUDGET,
) -> dict:
    verify_snapshot(snapshot)
    validate_cases(manifest, snapshot)
    if budget != manifest.get("character_budget", CHARACTER_BUDGET):
        raise ValueError("Character budget differs from the registered manifest")
    if queries is not None and manifest.get("query_vectors_digest") not in (
        None,
        digest(queries),
    ):
        raise ValueError("Query vectors differ from the registered manifest")
    arms: dict[str, list[dict]] = {
        name: [] for name in (*CONTROLLED_ARMS, "production_reference")
    }
    for case in manifest["cases"]:
        pool = {
            eid: row
            for eid, row in sorted(snapshot["evidence"].items())
            if row["bill_key"] == case["bill_key"] and row["eligible"]
        }
        text_pool = {eid: row for eid, row in pool.items() if row["kind"] == "text"}
        lexical = lexical_rank(case["question"], text_pool)
        all_lexical = lexical_rank(case["question"], pool)
        vector = vector_rank(case["question"], text_pool, snapshot, queries)
        hybrid = (
            reciprocal_rank_fusion([vector, lexical]) if vector is not None else None
        )
        all_hybrid = (
            reciprocal_rank_fusion([vector, all_lexical])
            if vector is not None
            else None
        )
        rankings = {
            "lexical_text": lexical,
            "vector_exact_text": vector,
            "hybrid_text": hybrid,
            "lexical_all": all_lexical,
            "hybrid_all": all_hybrid,
            "graph": graph_rank(case["question"], all_hybrid, pool)
            if all_hybrid is not None
            else None,
        }
        production = snapshot.get("production_rankings", {}).get(case["id"])
        rankings["production_reference"] = (
            production.get("evidence_ids", []) if production else None
        )
        for name, ranking in rankings.items():
            if ranking is None:
                arms[name].append(
                    {
                        "case_id": case["id"],
                        "status": "not_run",
                        "reason": "Matching query vectors or production snapshot unavailable",
                        "evidence_ids": [],
                    }
                )
                continue
            # Serving reference preserves its own budget; controlled arms share one.
            selected = (
                ranking
                if name == "production_reference"
                else within_budget(ranking, pool, budget)
            )
            if any(eid not in pool for eid in selected):
                raise ValueError(
                    "Production reference contains missing/ineligible evidence"
                )
            groups = case["required_evidence_groups"]
            arms[name].append(
                {
                    "case_id": case["id"],
                    "status": "ok",
                    "evidence_ids": selected,
                    "characters": sum(
                        len(serialized_evidence(pool[eid])) for eid in selected
                    ),
                    "complete_required": all(
                        set(group) & set(selected) for group in groups
                    )
                    if groups
                    else None,
                    "required_groups_found": sum(
                        bool(set(group) & set(selected)) for group in groups
                    ),
                    "required_groups_total": len(groups),
                    "unexpected_evidence": bool(selected) if not groups else False,
                    "unexpected_relation": any(
                        pool[eid]["kind"] != "text" for eid in selected
                    )
                    if not groups
                    else False,
                }
            )
    summaries = {}
    provenance_summaries = {}
    for name, rows in arms.items():
        summaries[name] = {}
        provenance_summaries[name] = {}
        for split in ("development", "held_out"):
            cases = {c["id"]: c for c in manifest["cases"] if c["split"] == split}
            subset = [r for r in rows if r["case_id"] in cases]
            scored = [
                EvidenceQueryResult(
                    r["case_id"],
                    [
                        EvidenceLabel(eid, 1)
                        for eid in cases[r["case_id"]]["expected_evidence_ids"]
                    ],
                    r["evidence_ids"],
                )
                for r in subset
                if r["status"] == "ok"
            ]
            summaries[name][split] = {
                "status": "ok"
                if all(r["status"] == "ok" for r in subset)
                else "not_run",
                "metrics": aggregate_evidence(scored),
                "total_case_count": len(subset),
                "complete_count": sum(
                    r.get("complete_required") is True for r in subset
                ),
                "answerable_count": sum(
                    bool(c["required_evidence_groups"]) for c in cases.values()
                ),
                "not_run_count": sum(r["status"] != "ok" for r in subset),
            }
            provenance_summaries[name][split] = {}
            for provenance in sorted(
                {c.get("label_provenance", "unspecified") for c in cases.values()}
            ):
                ids = {
                    cid
                    for cid, c in cases.items()
                    if c.get("label_provenance", "unspecified") == provenance
                }
                group = [r for r in subset if r["case_id"] in ids]
                provenance_summaries[name][split][provenance] = {
                    "total_case_count": len(group),
                    "answerable_count": sum(
                        bool(cases[cid]["required_evidence_groups"]) for cid in ids
                    ),
                    "complete_count": sum(
                        r.get("complete_required") is True for r in group
                    ),
                    "not_run_count": sum(r["status"] != "ok" for r in group),
                    "metrics": aggregate_evidence(
                        [r for r in scored if r.case_id in ids]
                    ),
                }
    gate = screen(arms, manifest)
    return {
        "schema_version": 1,
        "snapshot_digest": snapshot["manifest"]["content_digest"],
        "manifest_digest": digest(manifest),
        "query_vectors_digest": digest(queries) if queries else None,
        "character_budget": budget,
        "scope": "Evidence location only, resolved bills; no answer quality or public adoption claim",
        "production_reference_note": "Production retrieval function and settings over this snapshot; separate budget, not the full deployed routing/writing path",
        "summaries": summaries,
        "provenance_summaries": provenance_summaries,
        "arms": arms,
        "screen": gate,
        "answer_quality": {
            "status": "not_run",
            "reason": "Retrieval screen first; existing answer_eval gates required before any answer-quality claim",
        },
    }


def screen(arms: dict[str, list[dict]], manifest: dict) -> dict:
    cases = {c["id"]: c for c in manifest["cases"] if c["split"] == "held_out"}
    relevant = {cid for cid, c in cases.items() if c["required_evidence_groups"]}
    if not relevant:
        return {"passed": False, "reason": "No held-out answerable cases"}
    indexed = {name: {r["case_id"]: r for r in rows} for name, rows in arms.items()}
    candidates = [name for name in CONTROLLED_ARMS if name != "graph"]
    if any(
        indexed[name][cid]["status"] != "ok"
        for name in CONTROLLED_ARMS
        for cid in cases
    ):
        return {"passed": False, "reason": "Comparison incomplete; an arm did not run"}
    counts = {
        name: sum(indexed[name][cid]["complete_required"] is True for cid in relevant)
        for name in candidates
    }
    tied = sorted(name for name in candidates if counts[name] == max(counts.values()))
    losses_by_baseline = {
        name: sorted(
            cid
            for cid in relevant
            if indexed[name][cid]["complete_required"]
            and not indexed["graph"][cid]["complete_required"]
        )
        for name in tied
    }
    best = max(tied, key=lambda name: (len(losses_by_baseline[name]), name))
    wins = sorted(
        cid
        for cid in relevant
        if indexed["graph"][cid]["complete_required"]
        and not indexed[best][cid]["complete_required"]
    )
    losses = sorted({cid for ids in losses_by_baseline.values() for cid in ids})
    # Any additional evidence on a labelled no-evidence case is a strict regression;
    # unrelated passages are not called an answer or a correct refusal.
    safety_losses = sorted(
        cid
        for cid in set(cases) - relevant
        if (
            indexed["graph"][cid]["unexpected_evidence"]
            and any(not indexed[name][cid]["unexpected_evidence"] for name in tied)
        )
        or (
            indexed["graph"][cid]["unexpected_relation"]
            and any(not indexed[name][cid]["unexpected_relation"] for name in tied)
        )
    )
    needed = math.ceil(
        manifest["screening_gate"]["complete_evidence_gain_pp"] / 100 * len(relevant)
    )
    return {
        "passed": len(wins) - len(losses) >= needed
        and not losses
        and not safety_losses,
        "best_comparable_arm": best,
        "equally_strong_baselines": tied,
        "losses_by_baseline": losses_by_baseline,
        "held_out_answerable_count": len(relevant),
        "required_net_wins": needed,
        "wins": wins,
        "losses": losses,
        "ties": sorted(relevant - set(wins) - set(losses)),
        "safety_regressions": safety_losses,
        "wins_by_kind": {
            kind: [cid for cid in wins if cases[cid].get("kind", "unspecified") == kind]
            for kind in sorted({c.get("kind", "unspecified") for c in cases.values()})
        },
        "losses_by_kind": {
            kind: [
                cid for cid in losses if cases[cid].get("kind", "unspecified") == kind
            ]
            for kind in sorted({c.get("kind", "unspecified") for c in cases.values()})
        },
        "interpretation": "Pre-registered screening decision on designed questions, not statistical proof",
    }
