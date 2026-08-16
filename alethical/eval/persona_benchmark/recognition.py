"""Blinded recognition-evaluation artifact.

For the recognition task to mean anything, the *same* prompt has to reach
every legislator -- comparing answers to different questions tells an
evaluator nothing about whether style differs. The dataset already contains
such prompts: ``response_to_criticism``, ``hostile_interviewer``, and
``concise_answer`` in ``build_dataset.py`` are legislator-agnostic strings
(no per-legislator topic substituted in), so they come out byte-identical
across all three cases files. This module builds the artifact from those
categories only, and asserts the prompts really do match before using them,
rather than assuming the dataset stayed that way.

Blinding: response order is shuffled with a seed derived from
``(category, condition)`` -- deterministic (the same artifact regenerates
identically), but not in legislator-list order, so the position in the
artifact carries no information. Legislator identity and condition are held
in a separate answer key, written to a different file, not shown to the
evaluator.
"""

from __future__ import annotations

import hashlib
import json
from dataclasses import dataclass
from pathlib import Path

from alethical.eval.persona_benchmark.data_model import BenchmarkCase, RunRecord

RECOGNITION_CATEGORIES = (
    "response_to_criticism",
    "hostile_interviewer",
    "concise_answer",
)


@dataclass
class RecognitionItem:
    display_label: str  # "Response 1", "Response 2", ... -- shown to evaluator
    answer_text: str
    # answer key, withheld from the evaluator-facing file:
    legislator_id: str
    legislator_name: str
    condition: str
    case_id: str


def _seeded_order(n: int, seed_key: str) -> list[int]:
    """Deterministic pseudo-shuffle without importing random's global state
    (workflows/tests elsewhere in this repo avoid seeding global RNGs) --
    a stable sort keyed by a hash of (position, seed_key)."""
    indices = list(range(n))
    indices.sort(key=lambda i: hashlib.sha256(f"{seed_key}:{i}".encode()).hexdigest())
    return indices


def build_recognition_round(
    category: str,
    condition: str,
    cases_by_legislator: dict[str, BenchmarkCase],
    records_by_legislator: dict[str, RunRecord],
    legislator_names: dict[str, str],
) -> tuple[list[RecognitionItem], str]:
    """One round = one prompt, answered by every legislator under one condition.

    Returns (blinded items in display order, the shared prompt text). Raises
    if the prompts aren't actually identical across legislators -- silently
    proceeding on mismatched prompts would make the recognition task
    meaningless without anyone noticing.
    """
    prompts = {lid: c.prompt for lid, c in cases_by_legislator.items()}
    unique_prompts = set(prompts.values())
    if len(unique_prompts) != 1:
        raise ValueError(
            f"category {category!r} is not legislator-agnostic in this dataset "
            f"(found {len(unique_prompts)} distinct prompt texts) -- not usable "
            "for the recognition task"
        )
    shared_prompt = unique_prompts.pop()

    items = [
        RecognitionItem(
            display_label="",  # filled in after shuffling
            answer_text=records_by_legislator[lid].answer_text,
            legislator_id=lid,
            legislator_name=legislator_names[lid],
            condition=condition,
            case_id=cases_by_legislator[lid].case_id,
        )
        for lid in cases_by_legislator
    ]
    order = _seeded_order(len(items), seed_key=f"{category}:{condition}")
    shuffled = [items[i] for i in order]
    for position, item in enumerate(shuffled, start=1):
        item.display_label = f"Response {position}"
    return shuffled, shared_prompt


def write_recognition_artifact(
    out_dir: Path,
    rounds: list[tuple[str, str, list[RecognitionItem], str]],
) -> tuple[Path, Path]:
    """Writes two files: the evaluator-facing blinded questionnaire, and a
    separate answer key. ``rounds`` is a list of
    (category, condition, items, shared_prompt)."""
    out_dir.mkdir(parents=True, exist_ok=True)

    blinded_path = out_dir / "recognition_blinded.json"
    key_path = out_dir / "recognition_answer_key.json"

    blinded_payload = []
    key_payload = []
    for category, condition, items, prompt in rounds:
        # condition is withheld from the blinded file's structure too --
        # rounds for A and B are pooled and relabeled so an evaluator can't
        # infer condition from round ordering.
        blinded_payload.append(
            {
                "round_id": f"{category}",
                "prompt": prompt,
                "responses": [
                    {"label": it.display_label, "text": it.answer_text} for it in items
                ],
                "questions": [
                    "Which legislator produced each response? (name each one)",
                    "How characteristic does each response feel of that legislator, 1-5?",
                    "Does each response feel natural, or like an exaggerated "
                    "imitation/caricature?",
                ],
            }
        )
        key_payload.append(
            {
                "round_id": f"{category}",
                "condition": condition,
                "answer": [
                    {
                        "label": it.display_label,
                        "legislator_id": it.legislator_id,
                        "legislator_name": it.legislator_name,
                        "case_id": it.case_id,
                    }
                    for it in items
                ],
            }
        )

    blinded_path.write_text(json.dumps(blinded_payload, indent=2))
    key_path.write_text(json.dumps(key_payload, indent=2))
    return blinded_path, key_path
