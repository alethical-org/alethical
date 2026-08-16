"""Shared dataclasses for the benchmark: cases, run records, scores.

Deliberately plain dataclasses with ``to_dict``/``from_dict``, matching the
JSON-fixture convention already used by ``alethical/eval/answer_eval.py`` and
``alethical/eval/ground_truth.py`` -- no ORM, no schema migration, nothing
that reaches into production tables at run time (dataset generation is the
only place that touches the database, and it runs once, offline, to produce
the checked-in JSON files under ``cases/``).
"""

from __future__ import annotations

import json
from dataclasses import asdict, dataclass, field
from pathlib import Path
from typing import Any, Literal

Family = Literal[
    "grounding", "persona_fidelity", "human_likeness", "interactive_consistency"
]
Condition = Literal["A", "B"]


@dataclass(frozen=True)
class GroundTruth:
    """What a correct answer must say, in a form a deterministic scorer can check.

    Exactly one of these fields is populated per case, matching ``kind``.
    Kept flat (not a union of dataclasses) so a case can round-trip through
    plain JSON without a custom decoder per kind.
    """

    kind: str  # "vote_direction" | "sponsorship_role" | "committee_membership"
    # | "bill_status" | "vote_tally" | "insufficient_evidence" | "none"
    bill_key: str | None = None
    vote_value: str | None = None  # yes/no/absent/excused/present/abstain
    sponsorship_role: str | None = None  # chief_author/co_author/sponsor
    committee_name: str | None = None
    is_member: bool | None = None
    bill_status: str | None = None
    yes_count: int | None = None
    no_count: int | None = None
    official_url: str | None = None


@dataclass(frozen=True)
class BenchmarkCase:
    case_id: str
    family: Family
    category: str
    legislator_id: str
    prompt: str
    ground_truth: GroundTruth
    expects_refusal: bool
    false_premise: str | None = None  # what the prompt wrongly asserts, if anything
    notes: str = ""

    def to_dict(self) -> dict[str, Any]:
        d = asdict(self)
        return d

    @staticmethod
    def from_dict(d: dict[str, Any]) -> "BenchmarkCase":
        gt = GroundTruth(**d["ground_truth"])
        return BenchmarkCase(
            case_id=d["case_id"],
            family=d["family"],
            category=d["category"],
            legislator_id=d["legislator_id"],
            prompt=d["prompt"],
            ground_truth=gt,
            expects_refusal=d["expects_refusal"],
            false_premise=d.get("false_premise"),
            notes=d.get("notes", ""),
        )


@dataclass(frozen=True)
class ConversationTurn:
    turn_id: int
    prompt: str
    stress_type: str
    references_turn: int | None = None
    false_premise: str | None = None


@dataclass(frozen=True)
class ConversationCase:
    conversation_id: str
    legislator_id: str
    turns: tuple[ConversationTurn, ...]
    notes: str = ""

    def to_dict(self) -> dict[str, Any]:
        return {
            "conversation_id": self.conversation_id,
            "legislator_id": self.legislator_id,
            "turns": [asdict(t) for t in self.turns],
            "notes": self.notes,
        }

    @staticmethod
    def from_dict(d: dict[str, Any]) -> "ConversationCase":
        return ConversationCase(
            conversation_id=d["conversation_id"],
            legislator_id=d["legislator_id"],
            turns=tuple(ConversationTurn(**t) for t in d["turns"]),
            notes=d.get("notes", ""),
        )


def load_cases(path: str | Path) -> list[BenchmarkCase]:
    payload = json.loads(Path(path).read_text())
    return [BenchmarkCase.from_dict(c) for c in payload["cases"]]


def load_conversations(path: str | Path) -> list[ConversationCase]:
    payload = json.loads(Path(path).read_text())
    return [ConversationCase.from_dict(c) for c in payload["conversations"]]


def save_cases(path: str | Path, cases: list[BenchmarkCase]) -> None:
    Path(path).write_text(
        json.dumps({"cases": [c.to_dict() for c in cases]}, indent=2, default=str)
    )


def save_conversations(path: str | Path, conversations: list[ConversationCase]) -> None:
    Path(path).write_text(
        json.dumps(
            {"conversations": [c.to_dict() for c in conversations]},
            indent=2,
            default=str,
        )
    )


# --- Run + scoring records (produced by runner.py / scoring.py) ---


@dataclass
class RunRecord:
    """Everything needed to reproduce one model call, and what came back.

    One record per (condition, case). Every field the task asked to capture
    is here; nothing about it is inferred after the fact.
    """

    condition: Condition
    case_id: str
    legislator_id: str
    model: str
    model_params: dict[str, Any]
    prompt_version: str  # hash-or-tag identifying SYSTEM_PROMPT_TEMPLATE content
    style_exemplars_used: tuple[str, ...]  # exact quote texts injected, empty for A
    retrieved_bill_keys: tuple[str, ...]
    raw_response: str
    answer_text: str
    citations: tuple[dict[str, Any], ...]
    dropped_citations: tuple[dict[str, Any], ...]
    was_refusal: bool
    latency_seconds: float
    input_tokens: int | None = None
    output_tokens: int | None = None
    error: str | None = None  # set instead of raising, so a run never retries
    # into a different condition silently -- see runner.py.

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


@dataclass
class ConversationRunRecord:
    condition: Condition
    conversation_id: str
    legislator_id: str
    turn_records: list[RunRecord] = field(default_factory=list)


def save_run_records(path: str | Path, records: list[RunRecord]) -> None:
    Path(path).write_text(
        json.dumps([r.to_dict() for r in records], indent=2, default=str)
    )
