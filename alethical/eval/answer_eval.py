"""Answer-quality eval primitives (#865).

Measures whether the prose an LLM writes from already-retrieved bill passages is
good enough to show a reader. Sibling to ``retrieval_eval.py``, and deliberately
its complement: retrieval decides *which* passages; this decides *what is written
from them*. Retrieval is held constant — every model scores against one snapshot
of the same passages — so a score difference is the writer's, not the index's
(#400's embedding decision stands untouched).

The unit under test is ``synthesize_grounded_answer`` (``alethical/api/routers/me.py``),
which writes the prose for both the Ask answer page and the signed-in bill-scoped
chat. One metric path, so every model is directly comparable.

Scoring (the bar is argued in ``docs/product-onboarding/answer-quality-bar.md``)
--------------------------------------------------------------------------------
Two **gates**, pass/fail. A gate failure zeroes the answer — it is never averaged
against good writing, because a fluent answer that leaves the cited passages is a
worse product than a dull one that doesn't (``.claude/rules/grounded-answers.md``
rules 1 and 3):

* ``grounded``        — every claim traceable to the provided passages.
* ``honest_about_partial_reading`` — when the passages are a *sample* of a longer
  bill, the answer must not present a list or count as complete, and must not deny
  that something exists. Both are absence of evidence sold as evidence of absence
  (#868).
* ``refusal_correct`` — declines on a fixture item labeled unanswerable, and does
  not decline on one labeled answerable. Both directions fail. Whether an answer
  declines is the judges' call, not a pattern's: see ``mentions_missing_coverage``.

Four **graded** dimensions, 0/1/2 each (8 points), scored only on answers that
clear both gates:

* ``covers``      — carries the human-labeled required facts.
* ``addresses``   — answers the question asked, rather than summarizing the bill.
* ``framing``     — stage-correct verbs: an enacted law *requires*, a pending bill
  *would require* (rule 7's status-aware framing).
* ``plain``       — a non-specialist follows it; no bill-code preamble, no dumped
  statute citations (rule 9).

The third gate exists because the other two cannot see the worst failure this
product has shipped. Asked which cities and counties get grants in HF 719,
production named 19 cities and said no counties were named; the bill names ~98 and
~17. The citations were real, the passages did say what the answer said, and
cite-or-refuse was satisfied — the answer was simply written from 4 of 102 passages
with nothing telling it so. A model cannot know what it was not shown, but it *can*
decline to claim completeness it has no basis for, and that is what is scored here.
Ground truth for the case: ``alethical/eval/ground_truth.py``.

Labels come from ``fixtures/answer_questions.json`` — written by human reading of
the snapshotted passages, never by asking a model — so the fixture is an
independent answer key. Judges score *against those labels*, not against taste.
"""

from __future__ import annotations

import json
import re
from dataclasses import dataclass, field
from pathlib import Path

GRADED_DIMENSIONS = ("covers", "addresses", "framing", "plain")
MAX_GRADED = 2 * len(GRADED_DIMENSIONS)  # 8

# An answer ships if it clears both gates and loses at most one point per
# dimension on average. 6/8 admits "partly" everywhere or two outright misses;
# 5/8 would admit an answer that is weak on half its dimensions at once.
SHIP_WORTHY_GRADED = 6

# On a fixture this size, one bad answer in ten is the most we can call good
# enough. Demanding 20/20 on subjective readability would fit the fixture rather
# than the product; 18/20 leaves room for two mediocre answers and no more.
SHIP_WORTHY_RATE_BAR = 0.90


# --- Fixture ---


@dataclass(frozen=True)
class RequiredFact:
    """One fact a correct answer must carry, with the wordings that count.

    ``any_of`` exists because a model may say "the city of Duluth" or "Duluth".
    A literal hit on any alias is machine-checkable proof; a miss is not proof of
    absence (the model may have paraphrased), which is why the judge sees the
    label too and has the final say on ``covers``.
    """

    label: str
    any_of: tuple[str, ...]

    def literal_hit(self, answer: str) -> bool:
        lowered = answer.lower()
        return any(alias.lower() in lowered for alias in self.any_of)


@dataclass(frozen=True)
class AnswerQuery:
    question: str
    bill_key: str
    answerable: bool
    framing: str  # "law" | "proposal" — what stage the answer must speak in
    why_labeled: str
    required_facts: tuple[RequiredFact, ...] = ()
    must_not_claim: tuple[str, ...] = ()

    @property
    def key(self) -> str:
        return f"{self.bill_key}::{self.question}"


def load_fixture(path: str | Path) -> list[AnswerQuery]:
    payload = json.loads(Path(path).read_text())
    return [
        AnswerQuery(
            question=q["question"],
            bill_key=q["bill_key"],
            answerable=q["answerable"],
            framing=q["framing"],
            why_labeled=q["why_labeled"],
            required_facts=tuple(
                RequiredFact(label=f["label"], any_of=tuple(f["any_of"]))
                for f in q.get("required_facts", [])
            ),
            must_not_claim=tuple(q.get("must_not_claim", [])),
        )
        for q in payload["queries"]
    ]


# --- Mechanical checks (no judge involved, so nothing to flatter) ---

# Refusal wordings the production prompt actually elicits, plus the hard-coded
# fallback in me.py. Matching on "does not"/"doesn't" + a source noun keeps this
# from firing on an answer that merely mentions what a bill does not do.
_REFUSAL_RE = re.compile(
    r"(?:"
    r"(?:do(?:es)?\s+not|don'?t|doesn'?t|cannot|can'?t|unable to)\s+"
    r"(?:\w+\s+){0,4}?(?:answer|address|cover|say|specify|indicate|find|provide)"
    r"|not\s+(?:addressed|covered|specified|mentioned|stated)\s+in\s+"
    r"(?:the\s+)?(?:provided\s+)?(?:bill|text|context|passages|excerpt)"
    r"|no\s+information\s+(?:in|about)"
    r"|could not find retrieval-ready bill text"
    r")",
    re.IGNORECASE,
)

# Rule 9: a summary must not open by restating the bill number — the amber code
# badge already shows it. Anchored to the opening clause; a bill number cited
# mid-sentence ("HF 719 appropriates $6,000,000 to Duluth") is fine and common.
_BILL_CODE_PREAMBLE_RE = re.compile(
    r"^\W{0,3}(?:the\s+)?(?:bill\s+|file\s+)?(?:HF|SF|H\.F\.|S\.F\.)\s?\d+\b",
    re.IGNORECASE,
)

# Rule 9: raw Minnesota Statutes citations read as legalese in reader-facing
# prose. "Section 8" (a housing program) and "section 179" (a federal tax
# provision) are names, not citations, so the pattern requires either the
# statutes preamble or a dotted chapter.section number.
_STATUTE_CITATION_RE = re.compile(
    r"(?:Minnesota\s+Statutes[^.;]{0,40}"
    r"|\bsections?\s+\d+[A-Z]?\.\d+"
    r"|\bchapter\s+\d+[A-Z]?\b"
    r"|\bsubdivision\s+\d+)",
    re.IGNORECASE,
)


def mentions_missing_coverage(answer: str) -> bool:
    """True when the answer says somewhere that the text does not cover something.

    **A hint, never the refusal verdict.** This started life as the refusal gate and
    was wrong: the production prompt asks a model to "answer the supported part and
    say what is not covered", so a *good* answer routinely ends with "the bill does
    not specify how often the training must be repeated". A pattern cannot tell that
    closing caveat apart from a whole answer that declines — it fired on four of
    gpt-4o-mini's best answers and recorded them as refusals.

    Whether an answer *as a whole* declines is a judgment, so the judges make it
    (``JudgeVerdict.declines``) and this function is reported alongside as an
    independent signal.
    """
    return bool(_REFUSAL_RE.search(answer))


# Markdown the answer page cannot render. `AskAnswerScreen.tsx` strips `**bold**`
# and `__bold__` and prints the rest as plain text — there is no markdown renderer
# — so a heading, a table row or a block quote reaches the reader as its literal
# characters. Inline emphasis and ordinary "1." / "- " lines are deliberately not
# counted: the emphasis is stripped, and a numbered or bulleted line reads fine as
# plain text.
_UNRENDERED_MARKDOWN_RE = re.compile(r"^(?:#{1,6}\s|>\s|\|.*\|\s*$)", re.MULTILINE)


def opens_with_bill_code(answer: str) -> bool:
    return bool(_BILL_CODE_PREAMBLE_RE.match(answer.strip()))


def unrendered_markdown(answer: str) -> list[str]:
    """Markdown constructs that reach the reader as literal characters.

    Not a rule-9 judgment call but a rendering fact, and the reason it is worth a
    column of its own: a model can score well on every judged dimension and still
    put "### Eligibility" on the page, which a resident reads as a typo rather
    than a heading. Only one candidate does this, so it would be invisible in an
    average and decisive in a choice.
    """
    return [m.group(0).strip() for m in _UNRENDERED_MARKDOWN_RE.finditer(answer)]


def statute_citations(answer: str) -> list[str]:
    return [m.group(0).strip() for m in _STATUTE_CITATION_RE.finditer(answer)]


def literal_fact_coverage(query: AnswerQuery, answer: str) -> tuple[int, int]:
    """(facts whose wording appears verbatim, facts labeled). Evidence, not verdict."""
    if not query.required_facts:
        return (0, 0)
    hits = sum(1 for f in query.required_facts if f.literal_hit(answer))
    return (hits, len(query.required_facts))


# --- Scoring ---


@dataclass(frozen=True)
class JudgeVerdict:
    """One judge's read of one answer. ``grounded`` is the judge's gate call."""

    judge: str
    grounded: bool
    declines: bool
    # Only meaningful when the answer was written from part of a bill; see
    # AnswerResult.honest_about_partial_reading.
    claims_completeness: bool
    asserts_absence: bool
    covers: int
    addresses: int
    framing: int
    plain: int
    note: str = ""

    def graded_total(self) -> int:
        return self.covers + self.addresses + self.framing + self.plain


@dataclass
class AnswerResult:
    query: AnswerQuery
    model: str
    answer: str
    verdicts: list[JudgeVerdict] = field(default_factory=list)
    seconds_to_first_token: float | None = None
    seconds_total: float | None = None
    input_tokens: int = 0
    output_tokens: int = 0
    # How much of the bill the writer was shown. Derived from the snapshot, not
    # hand-labeled, so it cannot go stale when the passage budget changes.
    passages_shown: int = 0
    passages_total: int = 0
    # True when production's own output guards had to edit this answer before
    # serving it — ``narrow_bill_absence_claims`` re-scoped an absence claim, or
    # ``strip_list_completeness_claims`` dropped a sentence vouching for the list.
    #
    # ``answer`` above is the served text, because that is what a reader gets and
    # what the model decision is about. This flag is how the other question stays
    # answerable: a guard edit is a case where the #868 prompt rule did *not* work
    # and the backstop caught it, so a model with many edits is one the prompt is
    # not reaching, even though its score looks clean.
    guard_rewrote: bool = False

    @property
    def context_is_partial(self) -> bool:
        return self.passages_total > self.passages_shown

    # --- gates ---

    def declines(self, judge: str | None = None) -> bool:
        """Did the answer, as a whole, decline? Judged, not pattern-matched.

        A single judge saying so is enough. Declining is a visible, whole-answer
        property that judges agree on far more readily than grounding, and the
        conservative reading of a split is that the answer did not answer.
        """
        verdicts = self._for(judge)
        return any(v.declines for v in verdicts)

    def refusal_correct(self, judge: str | None = None) -> bool:
        return self.declines(judge) is not self.query.answerable

    def grounded(self, judge: str | None = None) -> bool:
        """Ungrounded only when the judges *agree* it is.

        The first rule here was "any judge can fail it", on the reasoning that a
        disputed answer is not a safe answer. Measurement killed that: the two
        judges split on grounding for 3–8 of 20 answers per model, so the union of
        their objections measured the stricter judge rather than the model, and
        every candidate failed. An objection that survives an independent second
        judge is evidence; one that does not is a disagreement between graders.

        Disputed calls are not swept away — ``grounding_disputed()`` counts them and
        the report prints them, so a model with many disputes is visibly less
        certain rather than silently forgiven.
        """
        verdicts = self._for(judge)
        return not verdicts or not all(not v.grounded for v in verdicts)

    def grounding_disputed(self) -> bool:
        """True when the judges disagree about whether every claim is supported."""
        calls = {v.grounded for v in self.verdicts}
        return len(calls) > 1

    def honest_about_partial_reading(self, judge: str | None = None) -> bool:
        """When only part of the bill was in context, did the answer avoid
        overclaiming?

        Passes trivially when the whole bill was in context — a complete list *is*
        complete, and "the bill names no counties" is a fair statement when every
        section was read. It only bites where it must: on the long bills where four
        passages are a sample, and where a confident list or a flat denial is
        exactly the failure #868 records.

        A single judge is enough to fail it, as with declining: both behaviours are
        visible on the face of the answer, and the cautious reading of a split is
        that the answer overclaimed.
        """
        if not self.context_is_partial:
            return True
        verdicts = self._for(judge)
        return not any(v.claims_completeness or v.asserts_absence for v in verdicts)

    def gates_passed(self, judge: str | None = None) -> bool:
        return (
            self.refusal_correct(judge)
            and self.grounded(judge)
            and self.honest_about_partial_reading(judge)
        )

    def gate_failures(self, judge: str | None = None) -> list[str]:
        failures = []
        if not self.refusal_correct(judge):
            failures.append(
                "declined an answerable question"
                if self.query.answerable
                else "answered a question the passages do not cover"
            )
        if not self.grounded(judge):
            failures.append("made a claim the passages do not support")
        if not self.honest_about_partial_reading(judge):
            for verdict in self._for(judge):
                if verdict.claims_completeness:
                    failures.append(
                        "presented a partial list or count as the complete set, "
                        f"having been shown {self.passages_shown} of "
                        f"{self.passages_total} passages"
                    )
                    break
            for verdict in self._for(judge):
                if verdict.asserts_absence:
                    failures.append(
                        "denied something exists, on a partial reading of the bill"
                    )
                    break
        return failures

    # --- graded ---

    def graded_total(self, judge: str | None = None) -> int:
        """Mean graded score across the judges in scope, floored to a whole point.

        Flooring, not rounding: a half point sits between "partly" and "fully",
        and the conservative read of a split judgment is the lower one.
        """
        verdicts = self._for(judge)
        if not verdicts:
            return 0
        return int(sum(v.graded_total() for v in verdicts) / len(verdicts))

    def score(self, judge: str | None = None) -> int:
        """0–8. A gate failure zeroes the answer rather than docking it."""
        return self.graded_total(judge) if self.gates_passed(judge) else 0

    def ship_worthy(self, judge: str | None = None) -> bool:
        return (
            self.gates_passed(judge) and self.graded_total(judge) >= SHIP_WORTHY_GRADED
        )

    def _for(self, judge: str | None) -> list[JudgeVerdict]:
        if judge is None:
            return self.verdicts
        return [v for v in self.verdicts if v.judge == judge]


def _percentile(values: list[float], pct: float) -> float | None:
    """Nearest-rank percentile. Avoids a numpy import for a handful of latencies."""
    if not values:
        return None
    ordered = sorted(values)
    rank = max(1, min(len(ordered), int(-(-pct * len(ordered) // 100))))
    return ordered[rank - 1]


def aggregate(results: list[AnswerResult], *, judge: str | None = None) -> dict:
    """One model's scorecard over the fixture, under one judge (or all judges)."""
    n = len(results)
    if not n:
        raise ValueError("aggregate() needs at least one result")

    gate_failures = [
        {"question": r.query.question, "bill": r.query.bill_key, "why": why}
        for r in results
        for why in r.gate_failures(judge)
    ]
    scores = [r.score(judge) for r in results]
    ship_worthy = sum(1 for r in results if r.ship_worthy(judge))
    passing = [r for r in results if r.gates_passed(judge)]

    per_dimension = {}
    for dim in GRADED_DIMENSIONS:
        marks = [
            getattr(v, dim)
            for r in passing
            for v in r._for(judge)  # noqa: SLF001
        ]
        per_dimension[dim] = round(sum(marks) / len(marks), 2) if marks else None

    totals = [r.seconds_total for r in results if r.seconds_total is not None]
    ttfts = [
        r.seconds_to_first_token
        for r in results
        if r.seconds_to_first_token is not None
    ]
    return {
        "n": n,
        "judge": judge or "all",
        "gate_failures": gate_failures,
        "gate_failure_count": len(gate_failures),
        # Grounding calls the judges split on. Not failures, but not clean either —
        # a model with many disputes is less certainly grounded than one with none.
        "grounding_disputed": sum(1 for r in results if r.grounding_disputed()),
        # Of the questions where the writer saw only part of the bill, how many
        # answers overclaimed. The #868 failure, counted.
        "partial_context_questions": sum(1 for r in results if r.context_is_partial),
        "overclaimed_on_partial": sum(
            1
            for r in results
            if r.context_is_partial and not r.honest_about_partial_reading(judge)
        ),
        # Answers production's output guards had to edit before serving. Counted
        # separately from the gate because these are the cases the guard caught:
        # the served answer is clean, so no gate fires, but the model still wrote
        # the overclaim. Prompt failures = this, plus whatever the gate still finds.
        "guard_rewrote": sum(1 for r in results if r.guard_rewrote),
        "mean_score": round(sum(scores) / n, 3),
        "ship_worthy": ship_worthy,
        "ship_worthy_rate": round(ship_worthy / n, 3),
        "per_dimension_mean": per_dimension,
        "seconds_total": {
            "p50": _percentile(totals, 50),
            "p95": _percentile(totals, 95),
        },
        "seconds_to_first_token": {
            "p50": _percentile(ttfts, 50),
            "p95": _percentile(ttfts, 95),
        },
        "input_tokens": sum(r.input_tokens for r in results),
        "output_tokens": sum(r.output_tokens for r in results),
    }


def meets_bar(summary: dict, *, p50_seconds: float, p95_seconds: float) -> bool:
    """Whether a model's scorecard clears the shipping bar.

    Latency is part of the bar, not a footnote: this prose is written while a
    reader waits, so a slower model is a worse product at equal quality.
    """
    p50 = summary["seconds_total"]["p50"]
    p95 = summary["seconds_total"]["p95"]
    return (
        summary["gate_failure_count"] == 0
        and summary["ship_worthy_rate"] >= SHIP_WORTHY_RATE_BAR
        and p50 is not None
        and p50 <= p50_seconds
        and p95 is not None
        and p95 <= p95_seconds
    )


def cost_per_answer(
    summary: dict, *, input_per_mtok: float, output_per_mtok: float
) -> float:
    """Mean US dollars per answer over the fixture, at the model's list price."""
    n = summary["n"]
    dollars = (
        summary["input_tokens"] * input_per_mtok
        + summary["output_tokens"] * output_per_mtok
    ) / 1_000_000
    return dollars / n


def judge_disagreement(results: list[AnswerResult], judge_a: str, judge_b: str) -> dict:
    """How far apart two judges sit — the guard against a judge flattering its own family.

    A candidate that wins under one judge and loses under the other has not won.
    Reporting the gap makes self-preference measurable instead of assumed away.
    """
    gaps, gate_splits = [], 0
    for r in results:
        a, b = r._for(judge_a), r._for(judge_b)  # noqa: SLF001
        if not a or not b:
            continue
        gaps.append(abs(a[0].graded_total() - b[0].graded_total()))
        if a[0].grounded != b[0].grounded:
            gate_splits += 1
    if not gaps:
        return {"n": 0}
    return {
        "n": len(gaps),
        "mean_abs_gap": round(sum(gaps) / len(gaps), 2),
        "max_abs_gap": max(gaps),
        "exact_agreement_rate": round(sum(1 for g in gaps if g == 0) / len(gaps), 3),
        "grounding_gate_splits": gate_splits,
    }
