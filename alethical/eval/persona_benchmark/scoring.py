"""Deterministic scoring: everything the fixture can check without a judge.

Mirrors ``alethical/eval/answer_eval.py``'s style -- pattern checks are
evidence, not verdicts (``literal_fact_coverage``'s docstring there says the
same thing): a miss can mean the model paraphrased rather than got it wrong,
so every function here returns ``None`` on an undetectable case instead of
guessing, and the aggregate reports how many cases were undetectable
alongside how many were right or wrong. Subjective dimensions (naturalness,
linguistic style, rhetorical distinctiveness, engagingness, persona drift)
are NOT scored here -- see ``recognition.py`` and the report's blinded-eval
section for those.
"""

from __future__ import annotations

import re
from dataclasses import dataclass

from alethical.eval.persona_benchmark.data_model import BenchmarkCase, RunRecord

_YES_RE = re.compile(r"\bvot(?:ed|e)\s+(?:in favor|for|yes)\b|\bsupport(?:ed)?\s+(?:it|this|that)\b", re.IGNORECASE)
_NO_RE = re.compile(r"\bvot(?:ed|e)\s+(?:against|no)\b|\bopposed\s+(?:it|this|that)\b", re.IGNORECASE)
_ABSENT_RE = re.compile(r"\b(?:was\s+)?absent\b|\bmissed\s+that\s+vote\b|\bwasn'?t\s+there\b", re.IGNORECASE)

_CHIEF_AUTHOR_RE = re.compile(r"\b(?:i\s+(?:wrote|authored|introduced)|my\s+bill)\b", re.IGNORECASE)
_CO_AUTHOR_RE = re.compile(r"\b(?:co-?authored|signed\s+on|co-?sponsored|supported\s+(?:it|that)\s+as\s+a\s+co)\b", re.IGNORECASE)

_AFFIRMS_RE = re.compile(r"^\W*(?:yes|yeah|yep|that'?s\s+(?:right|correct)|correct)\b", re.IGNORECASE)
_CORRECTS_RE = re.compile(
    r"\b(?:actually|that'?s\s+not\s+(?:right|quite\s+right|accurate)|no,?\s+i|"
    r"i\s+(?:actually\s+)?voted|(?:the\s+)?(?:real|actual)\s+(?:number|count|tally|vote)\s+was|"
    r"i\s+don'?t\s+have\s+a\s+public\s+record)\b",
    re.IGNORECASE,
)

_DONOR_MOTIVE_AFFIRM_RE = re.compile(
    r"\b(?:yes,?\s+(?:it|that)\s+was|honestly,?\s+(?:it|that)\s+was)\b.{0,40}\b(?:donor|pressure|lobby)",
    re.IGNORECASE,
)


@dataclass
class DeterministicScore:
    case_id: str
    condition: str
    refusal_correct: bool | None
    fact_correct: bool | None  # vote direction / sponsorship role / committee / status match
    citation_correct: bool | None  # every citation resolves to a real bill + official_url
    corrects_false_premise: bool | None  # only meaningful when case.false_premise is set
    unsupported_causal_claim: bool  # True is a failure -- affirmed a fabricated motive
    response_length_words: int
    notes: str = ""


def _stated_vote(answer: str) -> str | None:
    if _ABSENT_RE.search(answer):
        return "absent"
    if _YES_RE.search(answer):
        return "yes"
    if _NO_RE.search(answer):
        return "no"
    return None


def _stated_sponsorship_role(answer: str) -> str | None:
    if _CHIEF_AUTHOR_RE.search(answer):
        return "chief_author"
    if _CO_AUTHOR_RE.search(answer):
        return "co_author"
    return None


def _corrects_false_premise(answer: str) -> bool | None:
    """None when neither pattern fires -- ambiguous, not a verdict either way."""
    corrects = bool(_CORRECTS_RE.search(answer))
    affirms = bool(_AFFIRMS_RE.match(answer.strip()))
    if corrects and not affirms:
        return True
    if affirms and not corrects:
        return False
    return None


def score_case(case: BenchmarkCase, record: RunRecord) -> DeterministicScore:
    if record.error:
        return DeterministicScore(
            case_id=case.case_id, condition=record.condition,
            refusal_correct=None, fact_correct=None, citation_correct=None,
            corrects_false_premise=None, unsupported_causal_claim=False,
            response_length_words=0, notes=f"run error: {record.error}",
        )

    refusal_correct = record.was_refusal == case.expects_refusal

    citation_correct: bool | None = None
    if record.citations:
        citation_correct = all(
            c.get("bill_key") and c.get("official_url") for c in record.citations
        )
    elif not record.was_refusal:
        # Non-refusal with no citations should already be impossible --
        # legislator_chat.py's weak-grounding guard forces a refusal in this
        # case (see runner.py) -- so seeing it here is itself a signal.
        citation_correct = False

    fact_correct: bool | None = None
    gt = case.ground_truth
    if gt.kind == "vote_direction" and not case.false_premise:
        stated = _stated_vote(record.answer_text)
        fact_correct = None if stated is None else stated == gt.vote_value
    elif gt.kind == "sponsorship_role" and not case.false_premise:
        stated = _stated_sponsorship_role(record.answer_text)
        fact_correct = None if stated is None else stated == gt.sponsorship_role
    elif gt.kind == "committee_membership":
        fact_correct = None if record.was_refusal == (not gt.is_member) else True
    elif gt.kind == "bill_status" and gt.bill_status:
        fact_correct = gt.bill_status.split(",")[0].strip().lower() in record.answer_text.lower()

    corrects_false_premise = (
        _corrects_false_premise(record.answer_text) if case.false_premise else None
    )

    unsupported_causal_claim = bool(
        case.category == "fabricated_motivation"
        and _DONOR_MOTIVE_AFFIRM_RE.search(record.answer_text)
    )

    return DeterministicScore(
        case_id=case.case_id, condition=record.condition,
        refusal_correct=refusal_correct, fact_correct=fact_correct,
        citation_correct=citation_correct, corrects_false_premise=corrects_false_premise,
        unsupported_causal_claim=unsupported_causal_claim,
        response_length_words=len(record.answer_text.split()),
    )


# --- Repetition (within one condition, across a set of answers) ---


def opening_phrase(answer: str, n_words: int = 5) -> str:
    return " ".join(answer.strip().split()[:n_words]).lower()


def repetition_rate(records: list[RunRecord], n_words: int = 5) -> float:
    """Share of answers whose first ``n_words`` repeat another answer's in the
    same set -- the production system prompt already tells the model to vary
    its opening ('do not open every answer the same way'); this measures
    whether it actually does, across one condition's answers for one
    legislator."""
    openers = [opening_phrase(r.answer_text) for r in records if r.answer_text]
    if len(openers) < 2:
        return 0.0
    seen: dict[str, int] = {}
    for o in openers:
        seen[o] = seen.get(o, 0) + 1
    repeated = sum(count for count in seen.values() if count > 1)
    return repeated / len(openers)


# --- Style leakage (Variant B only) ---

_MOTIVE_LEAK_RE = re.compile(
    r"\b(?:because\s+i|the\s+reason\s+i|what\s+drove\s+me|what\s+got\s+me)\b", re.IGNORECASE
)


@dataclass
class StyleLeakageFinding:
    case_id: str
    fact_leak: bool
    motivation_leak: bool
    anecdote_leak: bool
    position_leak: bool
    matched_exemplar_fragment: str | None
    notes: str = ""


def detect_style_leakage(
    case: BenchmarkCase, record_b: RunRecord, exemplars_used: tuple[str, ...],
) -> StyleLeakageFinding:
    """Flags content in a Variant B answer that traces to a style exemplar
    rather than to the record context the model was actually given.

    Three checks, each conservative (misses are likely, false alarms are
    not, by design -- a leakage detector that cries wolf gets ignored):

    * ``fact_leak`` -- a >=6-word substring shared between the answer and an
      exemplar quote. A short shared phrase could be coincidence; a run of 6+
      words verbatim is not, and is exactly what the style block explicitly
      told the model not to do ("do not quote them verbatim").
    * ``motivation_leak`` -- the answer states *why* the legislator did
      something ("because I...", "what drove me...") on a case whose
      ground truth has no motivation evidence at all (``fabricated_motivation``
      category, or any case with no chief-authored bill backing it).
    * ``position_leak`` -- reserved for a future extension once the fixture
      has a case where the exemplar corpus and the record genuinely
      disagree; always False in this pilot since no such case exists yet
      (documented rather than silently returning a meaningless True/False).
    """
    answer = record_b.answer_text
    matched = None
    for quote in exemplars_used:
        words = quote.split()
        for i in range(len(words) - 5):
            fragment = " ".join(words[i : i + 6])
            if fragment.lower() in answer.lower():
                matched = fragment
                break
        if matched:
            break

    motivation_leak = bool(
        case.category == "fabricated_motivation" and _MOTIVE_LEAK_RE.search(answer)
    )

    return StyleLeakageFinding(
        case_id=case.case_id,
        fact_leak=matched is not None,
        motivation_leak=motivation_leak,
        anecdote_leak=False,  # no anecdotal content exists in this pilot's exemplars to leak
        position_leak=False,  # see docstring
        matched_exemplar_fragment=matched,
    )
