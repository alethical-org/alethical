"""Aggregate scored runs into machine-readable results plus a human-readable
report -- five dimensions kept apart, never collapsed into one score
(Grounding, Persona fidelity, Human-likeness, Interactive consistency, Style
leakage), and the report explicitly refuses to claim a persona/style
improvement, since that call requires the blinded human evaluation this
harness sets up but cannot itself perform (see ``recognition.py``).
"""

from __future__ import annotations

import json
from pathlib import Path

from alethical.eval.persona_benchmark.scoring import DeterministicScore, StyleLeakageFinding


def _rate(values: list[bool | None]) -> dict:
    known = [v for v in values if v is not None]
    if not known:
        return {"n": 0, "rate": None}
    return {"n": len(known), "rate": round(sum(known) / len(known), 3), "undetectable": len(values) - len(known)}


def aggregate_grounding(scores: list[DeterministicScore]) -> dict:
    return {
        "refusal_correct": _rate([s.refusal_correct for s in scores]),
        "fact_correct": _rate([s.fact_correct for s in scores]),
        "citation_correct": _rate([s.citation_correct for s in scores]),
        "corrects_false_premise": _rate([s.corrects_false_premise for s in scores]),
        "unsupported_causal_claim_count": sum(1 for s in scores if s.unsupported_causal_claim),
        "run_errors": sum(1 for s in scores if s.notes.startswith("run error")),
        "n_cases": len(scores),
    }


def aggregate_human_likeness(scores_by_legislator: dict[str, list[DeterministicScore]]) -> dict:
    """The only fully-automatic human-likeness signals: repetition and
    response length. Naturalness, engagingness, and everything else in this
    family need a human/LLM judge -- see the report's "still requires
    blinded evaluation" section."""
    out = {}
    for lid, scores in scores_by_legislator.items():
        lengths = [s.response_length_words for s in scores if s.response_length_words]
        out[lid] = {
            "mean_response_length_words": round(sum(lengths) / len(lengths), 1) if lengths else None,
            "n": len(scores),
        }
    return out


def aggregate_style_leakage(findings: list[StyleLeakageFinding]) -> dict:
    n = len(findings)
    if not n:
        return {"n": 0}
    return {
        "n": n,
        "fact_leak_rate": round(sum(f.fact_leak for f in findings) / n, 3),
        "motivation_leak_rate": round(sum(f.motivation_leak for f in findings) / n, 3),
        "anecdote_leak_rate": round(sum(f.anecdote_leak for f in findings) / n, 3),
        "position_leak_rate": round(sum(f.position_leak for f in findings) / n, 3),
        "flagged_cases": [f.case_id for f in findings if f.fact_leak or f.motivation_leak],
    }


def write_machine_readable(path: Path, payload: dict) -> None:
    path.write_text(json.dumps(payload, indent=2, default=str))


def render_human_readable(
    payload: dict,
    *,
    mode: str,
) -> str:
    lines = []
    lines.append("# Persona benchmark pilot -- A/B report")
    lines.append("")
    if mode != "live":
        lines.append(
            f"**Mode: `{mode}`.** No `OPENAI_API_KEY` was available when this ran, so every "
            "answer below came from the harness's deterministic mock responder, not a real "
            "model. This report demonstrates the pipeline works end to end -- dataset loading, "
            "retrieval, prompt composition (A vs B), citation verification, scoring, and "
            "leakage detection. **None of the numbers below say anything about the real "
            "persona's quality.** Re-run with a real key to get results that do."
        )
        lines.append("")

    lines.append("## 1. Grounding")
    for cond in ("A", "B"):
        g = payload["grounding"][cond]
        lines.append(f"- Condition {cond}: refusal-correct {g['refusal_correct']}, "
                      f"fact-correct {g['fact_correct']}, citation-correct {g['citation_correct']}, "
                      f"false-premise-corrected {g['corrects_false_premise']}, "
                      f"unsupported-causal-claims {g['unsupported_causal_claim_count']}, "
                      f"run errors {g['run_errors']} / {g['n_cases']}")
    lines.append("")

    lines.append("## 2. Persona fidelity")
    lines.append(
        "Not scored here -- linguistic/style fidelity and political-position fidelity both "
        "require comparing against held-out real quotes and human judgment. See "
        "`cases/recognition_blinded.json` for the blinded artifact; this report does not "
        "pre-judge its outcome."
    )
    lines.append("")

    lines.append("## 3. Human-likeness")
    lines.append("Automatic signals only (repetition, response length); naturalness and "
                  "engagingness require human/LLM-judge evaluation, not run here.")
    for cond in ("A", "B"):
        lines.append(f"- Condition {cond} repetition rate: {payload['repetition'][cond]}")
        for lid, stats in payload["human_likeness"][cond].items():
            lines.append(f"  - {lid}: mean response length {stats['mean_response_length_words']} words (n={stats['n']})")
    lines.append("")

    lines.append("## 4. Interactive consistency")
    lines.append(
        f"{payload['conversations']['n_conversations']} six-turn conversations run per "
        "condition. Position/factual/persona drift across turns requires the same "
        "human/LLM-judge pass as persona fidelity above (PICon/MREval-style adversarial "
        "interrogation) -- not scored automatically here beyond refusal/citation checks per turn."
    )
    lines.append("")

    lines.append("## 5. Style leakage (Variant B only)")
    sl = payload["style_leakage"]
    lines.append(f"- n={sl.get('n', 0)}, fact-leak rate={sl.get('fact_leak_rate')}, "
                  f"motivation-leak rate={sl.get('motivation_leak_rate')}")
    if sl.get("flagged_cases"):
        lines.append(f"- Flagged: {', '.join(sl['flagged_cases'])}")
    lines.append("")

    lines.append("## Decision rule reminder")
    lines.append(
        "Variant B is worth expanding only if a completed blinded evaluation shows a "
        "meaningful recognizability/naturalness improvement **without** degrading grounding, "
        "citation correctness, or refusal accuracy above, and without the style-leakage rates "
        "above rising. This report does not itself render that verdict."
    )
    return "\n".join(lines)
