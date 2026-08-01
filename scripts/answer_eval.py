"""CLI for the answer-quality eval harness (#865).

Scores the prose an LLM writes from already-retrieved bill passages, so several
models can be compared on one metric path. The bar and its reasoning live in
``docs/product-onboarding/answer-quality-bar.md``; the primitives live in
``alethical/eval/answer_eval.py``.

Stages
------
  snapshot   Read-only against production: for each fixture question, resolve the
             named bill, retrieve the same passages ``ask.py`` would, and write
             them to ``alethical/eval/fixtures/answer_contexts.json``. Run once.
             Needs a DB and OPENAI_API_KEY (for the ~20 query embeddings).
             Every later stage reads the snapshot, so retrieval is held constant
             and no candidate model can be advantaged by a luckier search.

  run        Generate answers per (model, question) from the snapshot — three of
             them on the long questions, one on the short ones (``samples_wanted``)
             — have the judges score the first of each blind, and print the
             scorecards. Results cache to the run directory per model and per judge,
             so re-running is cheap and a new candidate can be added without
             re-paying for the old ones.

**Re-snapshotting throws away every arm's cached answers.** That is the digest check
working as designed (``prompt_fingerprint``) and not a fault, but the bill lands on
whoever runs the eval next: a fresh snapshot means the next ``run`` pays full price
for every arm, with no warning beyond a line saying it is regenerating. Raising the
sample count is deliberately *not* the same thing — the cache is topped up, and only
the new samples are paid for.

Examples
--------
  ALETHICAL_DATABASE_TARGET=production uv run python scripts/answer_eval.py snapshot
  uv run python scripts/answer_eval.py run \
      --models openai:gpt-4o-mini,openai:gpt-5-mini,anthropic:claude-haiku-4-5 \
      --judges anthropic:claude-sonnet-5,openai:gpt-5.1 \
      --run-dir /tmp/answer-eval
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import random
import re
import threading
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

import requests
from sqlalchemy import create_engine, select, text
from sqlalchemy.orm import Session

from alethical.api.routers import ask as ask_router
from alethical.api.routers import me as me_router
from alethical.api.routers.me import (
    RAG_CHAT_SYSTEM_PROMPT,
    BillTextCoverage,
    build_query_embedding,
    narrow_bill_absence_claims,
    strip_list_completeness_claims,
)
from alethical.db.schema import load_schema
from alethical.db.session import NO_PREPARED_STATEMENTS, database_url_for_target
from alethical.eval.answer_eval import (
    GRADED_DIMENSIONS,
    AnswerQuery,
    AnswerResult,
    EnumerationScore,
    JudgeVerdict,
    aggregate,
    cost_per_answer,
    judge_disagreement,
    literal_fact_coverage,
    load_fixture,
    meets_bar,
    mentions_missing_coverage,
    opens_with_bill_code,
    statute_citations,
    unrendered_markdown,
)
from alethical.eval.ground_truth import enumeration_cases_for
from alethical.pipeline.rag_ingest import DEFAULT_RAG_MODEL, effective_embedding_model

REPO = Path(__file__).resolve().parents[1]
FIXTURE = REPO / "alethical/eval/fixtures/answer_questions.json"
CONTEXTS = REPO / "alethical/eval/fixtures/answer_contexts.json"


# Production's fixed budget for a *specific* question, imported rather than copied
# so the eval cannot drift from it. Since #868 this is only half of what production
# does: an enumerate-everything question takes a different branch entirely (see
# `snapshot`), so this constant no longer describes the whole retrieval — it names
# the one knob a `@N` candidate moves.
CHUNK_LIMIT = ask_router._BILL_TEXT_CHUNK_LIMIT  # noqa: SLF001
EF_SEARCH = 100

# Latency budget, argued in the quality-bar doc. The reader is waiting, and the
# API does not stream, so total generation time is what they experience.
P50_SECONDS = 5.0
P95_SECONDS = 9.0
# The tail budget, alongside the two percentiles rather than replacing them (#895).
# Argued in §3 of the bar doc: #865 names 12 seconds as already worse than a duller
# answer in 3, and the tail gets three seconds more because it is a genuinely bigger
# job — 20,000 words of bill instead of 900. It splits the field rather than passing
# or failing everything: of §12's seven arms, three sit under it and four do not.
WORST_SECONDS = 15.0

# How much of a bill's list an answer has to carry, on its **worst** draw (#895).
# Argued in §3 of the bar doc.
MIN_ENUMERATION_RECALL = 0.80

# Long questions are sampled more than once, because the same model on byte-identical
# input reported 19, 26, 34 and 35 of HF 719's 98 cities, and took 10.0 to 23.2
# seconds doing it. Three is the smallest number that shows a spread rather than a
# pair of points, and repeats are confined to the questions that have one — the short
# questions are stable, so paying for repeats there buys nothing.
REPEAT_SAMPLES = 3

# Judges run concurrently (see judge_all). Kept modest so a run does not trip
# either provider's rate limits, which would cost more time than it saves.
JUDGE_CONCURRENCY = 8

# The candidate set and the graders, named once so `run` and `calibrate` cannot
# drift apart — a calibration measured on a different sample than the run it is
# meant to license is worth nothing.
DEFAULT_MODELS = (
    "openai:gpt-4o-mini,openai:gpt-5-mini,openai:gpt-5.1,"
    "anthropic:claude-haiku-4-5,anthropic:claude-sonnet-5"
)
DEFAULT_JUDGES = "anthropic:claude-sonnet-5,openai:gpt-5.1"


def contexts_path(passages: int) -> Path:
    """Where one passage budget's frozen contexts live.

    The default budget keeps the plain filename so the committed snapshot and every
    existing reference stay valid; a wider budget gets its own file, because
    widening the window is a different experiment and must not overwrite the
    baseline it is being compared against.
    """
    if passages == CHUNK_LIMIT:
        return CONTEXTS
    return CONTEXTS.with_name(f"answer_contexts_{passages}.json")


# List prices, US dollars per million tokens, as of Jul 31 2026.
# OpenAI: developers.openai.com/api/docs/pricing. Anthropic: the `claude-api`
# skill's model table. Sonnet 5 carries an introductory rate through
# 2026-08-31 ($2/$10); the standing rate is used here so the recommendation
# does not rest on a discount that expires.
PRICES = {
    "openai:gpt-4o-mini": (0.15, 0.60),
    "openai:gpt-5-nano": (0.05, 0.40),
    "openai:gpt-5-mini": (0.25, 2.00),
    "openai:gpt-5.1": (1.25, 10.00),
    "openai:gpt-4o": (2.50, 10.00),
    "anthropic:claude-haiku-4-5": (1.00, 5.00),
    "anthropic:claude-sonnet-5": (3.00, 15.00),
}


def price_of(spec: str) -> tuple[float, float] | None:
    """A candidate's per-million-token prices, looked up by the model it runs.

    Keyed on the base model rather than the whole spec, because neither part of a
    candidate's identity beyond the model changes what a token costs: ``+deep``
    buys more reasoning tokens at the same rate, and ``@16`` buys more input
    tokens at the same rate. Looking up the whole spec is why three of the nine
    rows in §10 of the bar doc printed no cost at all — precisely the rows whose
    whole point was that they consume more tokens.
    """
    provider, model, _, _ = parse_spec(spec)
    return PRICES.get(f"{provider}:{model}")


# --- snapshot: freeze production's retrieval so every model sees one context ---


def snapshot(args) -> None:
    """Freeze production's retrieval — both of its branches (#868).

    This used to take one flat passage budget for every question, and after #868
    that is no longer what production does. ``ask.py`` now reads the question
    first: an **enumerate-everything** question ("which cities…", "how many…")
    gets as much of the bill as ``_LIST_QUESTION_WORD_BUDGET`` allows, up to
    20,000 words, while a **specific** question keeps the fixed four passages. A
    flat snapshot measures neither shape, so it would have scored every candidate
    on an input production stopped sending.

    Rather than restate the rule, this calls production's own
    ``_retrieve_bill_text``. The eval already guards the *prompt* by importing it
    rather than copying it; retrieval now gets the same guard, which is the one
    that #868 proved was needed.
    """
    passages = args.passages
    schema = load_schema()
    Bill = schema.Bill
    engine = create_engine(
        database_url_for_target(os.environ.get("ALETHICAL_DATABASE_TARGET")),
        connect_args=NO_PREPARED_STATEMENTS,
    )
    queries = load_fixture(FIXTURE)
    model = effective_embedding_model(DEFAULT_RAG_MODEL)
    out: dict[str, dict] = {}

    # A `@N` candidate moves production's fixed budget for specific questions and
    # nothing else — the list branch is governed by a word budget, not a row count.
    # Set on the module so `_retrieve_bill_text` reads it, because the point of
    # calling production's function is that the eval does not re-implement it.
    if passages != ask_router._BILL_TEXT_CHUNK_LIMIT:  # noqa: SLF001
        ask_router._BILL_TEXT_CHUNK_LIMIT = passages  # noqa: SLF001

    with Session(engine) as db:
        db.execute(text(f"SET LOCAL hnsw.ef_search = {EF_SEARCH}"))
        for q in queries:
            bill = db.scalar(select(Bill).where(Bill.bill_key == q.bill_key))
            if bill is None:
                raise SystemExit(f"{q.bill_key} is not in this database")
            enumerating = bool(ask_router._LIST_QUESTION_RE.search(q.question))  # noqa: SLF001
            chunks, coverage = ask_router._retrieve_bill_text(  # noqa: SLF001
                db,
                bill,
                model,
                build_query_embedding(q.question),
                enumerating=enumerating,
            )
            if not chunks:
                raise SystemExit(f"{q.bill_key} has no retrievable passages")
            out[q.key] = {
                "question": q.question,
                "bill_key": q.bill_key,
                "bill_title": bill.title,
                # Whether production reads this question as an enumeration, which
                # decides both how much it retrieves and which coverage rule it
                # sends. Recorded so the run can compose the same prompt without a
                # database.
                "enumerating": enumerating,
                # How many passages this bill HAS, against how many the writer is
                # given. The gap is what makes an answer's completeness claim a
                # guess, and it is derived here rather than hand-labeled so it
                # cannot go stale when the passage budget changes (#868).
                "passages_total": int(coverage.total or 0),
                "chunks": [
                    {"citation_label": c.citation_label, "chunk_text": c.chunk_text}
                    for c in chunks
                ],
            }
            words = sum(len(c["chunk_text"].split()) for c in out[q.key]["chunks"])
            print(
                f"  {q.bill_key:16s} {'LIST' if enumerating else '    '} "
                f"{len(out[q.key]['chunks']):4d}/{out[q.key]['passages_total']:<4d} passages "
                f"{words:6d} words  {q.question[:50]}"
            )

    destination = contexts_path(passages)
    destination.write_text(
        json.dumps(
            {
                "description": (
                    "Frozen retrieval contexts for the answer-quality eval (#865). "
                    "Produced by `scripts/answer_eval.py snapshot` read-only against "
                    "production, calling ask.py's own `_retrieve_bill_text` so both "
                    "of its branches are reproduced: an enumerate-everything question "
                    "reads up to _LIST_QUESTION_WORD_BUDGET words of the bill, a "
                    f"specific question the fixed {passages} passages "
                    f"(hnsw.ef_search {EF_SEARCH}). Committed so every model is "
                    "written from identical passages and the eval runs without a "
                    "database."
                ),
                "contexts": out,
            },
            indent=2,
        )
        + "\n"
    )
    print(f"\nwrote {len(out)} contexts to {destination.relative_to(REPO)}")


def load_contexts(passages: int = CHUNK_LIMIT) -> dict[str, dict]:
    path = contexts_path(passages)
    if not path.exists():
        raise SystemExit(
            f"no snapshot for a {passages}-passage budget; run "
            f"`snapshot --passages {passages}` first"
        )
    return json.loads(path.read_text())["contexts"]


# --- generation: production's exact prompt, one provider adapter per family ---


def context_coverage(context: dict) -> BillTextCoverage:
    """How much of the bill this frozen context is, in production's own type."""
    return BillTextCoverage(
        searched=len(context["chunks"]),
        total=int(context.get("passages_total") or 0),
    )


def production_system_prompt(context: dict | None = None) -> str:
    """The whole instruction production sends for this question's coverage.

    Importing the constant by identity was the original guard, and it was too
    narrow. It catches a *copy* that drifted; it cannot catch a **layer production
    adds on top** — which is exactly what [#868](https://github.com/alethical-org/alethical/issues/868)
    did, composing that constant with a coverage rule that forbids the very
    overclaiming §9 of the bar doc measures. The eval kept sending half the prompt
    and every guard stayed green.

    **And the coverage is per question, not per run.** A first pass at this sent
    ``rag_chat_system_prompt(None)`` — the partial rule — for everything, which was
    right when every frozen context was four passages of a long bill and wrong the
    moment #868 started reading some bills whole. On a complete read production
    sends a *different* rule, one that positively licenses "the bill names none of
    these" and asks the model to enumerate everything rather than a handful. Sending
    the partial rule there would score a model on an instruction it never receives.

    ``None`` keeps the old behaviour for callers with no context in hand, and is
    still the right answer for the signed-in bill-scoped chat, which retrieves a
    fixed three passages and never counts the bill.
    """
    composer = getattr(me_router, "rag_chat_system_prompt", None)
    if composer is None:  # pre-#868 checkout
        return RAG_CHAT_SYSTEM_PROMPT
    return composer(context_coverage(context) if context else None)


def prompt_fingerprint(contexts: dict) -> str:
    """Short stable digest of everything an arm's answers were generated from.

    Recorded in every answers cache and checked before reuse. Without it, the
    prompt changing under a cached arm is invisible: the run reuses old answers,
    scores them beside new ones, and publishes a comparison across two different
    prompts. The digest turns that into a visible regeneration instead.

    Digests **all** the system-prompt variants in play rather than one, because since
    #868 a run sends two — complete-coverage and partial-coverage — and a change to
    either one has to invalidate the cache. Hashing only the partial rule would have
    let a complete-coverage edit ship silently.

    **And it digests the contexts themselves, which for a while it did not** (#895).
    Re-snapshotting was believed to invalidate every cached arm; it did not, and the
    reason is worth keeping because it is the shape of near-miss that reads as safe.
    Neither coverage rule quotes a passage count — both are fixed prose — so a
    re-snapshot that keeps the same mix of complete and partial reads produces a
    *byte-identical* set of system prompts and therefore the same digest, however
    much the bill text underneath moved. The cache would then be reused, and answers
    written from the old passages would be scored and judged against the new ones.
    That is the same failure the digest exists to stop, one level over: not two
    prompts compared side by side, but an answer compared against a context it was
    never written from. Hashing the user prompts closes it, because those carry the
    passages, the question and the bill.
    """
    variants = sorted({production_system_prompt(c) for c in contexts.values()})
    user_prompts = sorted(build_user_prompt(c) for c in contexts.values())
    return hashlib.sha256("\x00".join(variants + user_prompts).encode()).hexdigest()[
        :12
    ]


def build_user_prompt(context: dict) -> str:
    body = "\n\n".join(
        f"[{i}] {c['citation_label']}\n{c['chunk_text'].strip()}"
        for i, c in enumerate(context["chunks"], start=1)
    )
    return f"Bill: {context['bill_key']}\nQuestion: {context['question']}\n\nContext:\n{body}"


# The floor of the reasoning ladder is NOT the same value across the gpt-5 family,
# and sending the wrong one is a hard 400 rather than a graceful fallback. Both rows
# were confirmed against the live API on Jul 31 2026:
#   gpt-5-mini accepts minimal / low / medium / high — 'none' is rejected
#   gpt-5.1    accepts none / low / medium / high    — 'minimal' is rejected
# A model absent from this map is sent no reasoning parameter at all, which is
# correct for the pre-reasoning models (gpt-4o-mini, gpt-4o).
_LOWEST_REASONING_EFFORT = {
    "gpt-5-mini": "minimal",
    "gpt-5-nano": "minimal",
    "gpt-5.1": "none",
}


def _lowest_reasoning_effort(model: str) -> str | None:
    return _LOWEST_REASONING_EFFORT.get(model)


def _openai_answer(
    model: str, system: str, user: str, *, deep: bool
) -> tuple[str, float, float, int, int]:
    """Call OpenAI's Responses API — the same endpoint me.py uses today.

    ``deep=False`` pins the gpt-5 family to ``reasoning.effort: "minimal"``, the
    counterpart of disabling Claude's thinking: a reader is waiting, and writing
    three sentences from four passages already in front of the model is not a
    reasoning task. Left at the provider default, these models reason first and
    the reader waits through tokens they never see. ``deep=True`` sends no
    reasoning parameter, which measures exactly that default.
    """
    body: dict = {
        "model": model,
        "input": [
            {"role": "system", "content": system},
            {"role": "user", "content": user},
        ],
    }
    effort = None if deep else _lowest_reasoning_effort(model)
    if effort:
        body["reasoning"] = {"effort": effort}
    started = time.monotonic()
    response = requests.post(
        "https://api.openai.com/v1/responses",
        headers={
            "Authorization": f"Bearer {os.environ['OPENAI_API_KEY']}",
            "Content-Type": "application/json",
        },
        json=body,
        timeout=120,
    )
    response.raise_for_status()
    total = time.monotonic() - started
    payload = response.json()
    usage = payload.get("usage") or {}
    return (
        _openai_text(payload),
        total,  # non-streaming: nothing arrives before the whole answer does
        total,
        usage.get("input_tokens", 0),
        usage.get("output_tokens", 0),
    )


def _openai_text(payload: dict) -> str:
    value = payload.get("output_text")
    if isinstance(value, str) and value.strip():
        return value.strip()
    parts = []
    for item in payload.get("output") or []:
        for block in (item or {}).get("content") or []:
            if isinstance(block, dict) and isinstance(block.get("text"), str):
                parts.append(block["text"].strip())
    return "\n".join(p for p in parts if p)


def _anthropic_answer(
    model: str, system: str, user: str, *, deep: bool
) -> tuple[str, float, float, int, int]:
    """Call Anthropic's Messages API.

    On Claude Sonnet 5 adaptive thinking is ON whenever the ``thinking`` parameter
    is omitted, so ``deep=False`` disables it explicitly and pins effort to `low`
    (disabling is allowed at effort `high` or below). Same reasoning as the OpenAI
    adapter: the reader is waiting. ``deep=True`` leaves adaptive thinking on,
    which measures the naive call.
    """
    body: dict = {
        "model": model,
        "max_tokens": 1024,
        "system": system,
        "messages": [{"role": "user", "content": user}],
    }
    if model.startswith(("claude-sonnet-5", "claude-opus-5")):
        if deep:
            body["thinking"] = {"type": "adaptive"}
        else:
            body["thinking"] = {"type": "disabled"}
            body["output_config"] = {"effort": "low"}

    started = time.monotonic()
    response = requests.post(
        "https://api.anthropic.com/v1/messages",
        headers={
            "x-api-key": os.environ["ANTHROPIC_API_KEY"],
            "anthropic-version": "2023-06-01",
            "content-type": "application/json",
        },
        json=body,
        timeout=120,
    )
    response.raise_for_status()
    total = time.monotonic() - started
    payload = response.json()
    parts = [
        b.get("text", "")
        for b in payload.get("content", [])
        if isinstance(b, dict) and b.get("type") == "text"
    ]
    usage = payload.get("usage") or {}
    return (
        "\n".join(p for p in parts if p).strip(),
        total,
        total,
        usage.get("input_tokens", 0),
        usage.get("output_tokens", 0),
    )


def parse_spec(spec: str) -> tuple[str, str, bool, int]:
    """``provider:model[+deep][@passages]`` → (provider, model, deep, passages).

    Two things beyond the model name belong to a candidate's identity rather than
    sitting in a default somewhere:

    * ``+deep`` — reasoning left at the provider's default. The same model reasoning
      or not is two different products to a waiting reader.
    * ``@N`` — how many bill passages the writer is given. ``gpt-4o-mini@16`` is a
      genuinely different candidate from ``gpt-4o-mini``, and comparing them is what
      separates "the writer is weak" from "the writer was under-informed" (#868).

    Both default to what production does today, so a bare spec means the incumbent
    configuration.
    """
    base, _, budget = spec.partition("@")
    passages = CHUNK_LIMIT
    if budget:
        if not budget.isdigit() or int(budget) < 1:
            raise SystemExit(f"passage budget in {spec!r} must be a positive integer")
        passages = int(budget)
    base, _, suffix = base.partition("+")
    if suffix not in ("", "deep"):
        raise SystemExit(f"unknown suffix {suffix!r} in {spec!r} (only '+deep')")
    provider, _, model = base.partition(":")
    if provider not in ("openai", "anthropic"):
        raise SystemExit(
            f"unknown provider in {spec!r} (expected openai: or anthropic:)"
        )
    return provider, model, suffix == "deep", passages


def call_model(spec: str, system: str, user: str) -> tuple[str, float, float, int, int]:
    provider, model, deep, _ = parse_spec(spec)
    if provider == "openai":
        return _openai_answer(model, system, user, deep=deep)
    return _anthropic_answer(model, system, user, deep=deep)


def guard_changed_content(raw: str, served: str) -> bool:
    """Did production's guards change the answer's WORDS, or only its whitespace?

    The distinction is not pedantic; measuring it wrong invented a finding. A first
    pass counted any difference and reported that ``gpt-5.1`` needed the backstop on
    11 of 20 answers, which would have been the loudest number in the comparison.
    31 of the 34 differences across all seven arms turned out to be whitespace:
    ``strip_list_completeness_claims`` splits into sentences and rejoins them, and
    the rejoin drops a Markdown hard line break (two spaces before a newline). It
    removed nothing and flagged everything.

    So the comparison ignores whitespace entirely. What is left is the thing worth
    counting: a sentence the guard actually deleted, or an absence claim it
    actually re-scoped.
    """
    return re.sub(r"\s+", "", raw) != re.sub(r"\s+", "", served)


def served_answer(raw: str, coverage: BillTextCoverage) -> str:
    """What ``synthesize_grounded_answer`` actually returns to a reader.

    The unit under test is that whole function, not the HTTP call inside it, and
    since #868 it does not hand the model's words straight through: it re-scopes
    absence claims on a partial read and drops any sentence vouching for its own
    list. Scoring the raw completion measures a product we do not ship, and would
    have counted overclaims against a model that a reader never sees.

    The raw text is kept alongside (``guard_rewrote``) so the two questions stay
    separable: *did the prompt work* is the model's business and #868's, while
    *what did the reader get* is what the model decision turns on.
    """
    text_value = raw
    if not coverage.is_complete:
        text_value = narrow_bill_absence_claims(text_value)
    return strip_list_completeness_claims(text_value)


def samples_wanted(context: dict) -> int:
    """How many times to answer this question (#895).

    Repeats go where the variance is, and the variance is on the long bills. The
    test is **derived, not listed**: a question is long when #868's whole-bill branch
    gave it more passages than production's fixed budget, which is exactly the six
    questions of 13 or more passages in this fixture. Deriving it means the set stays
    right when the fixture or the budget changes, the same reason ``passages_total``
    is read off the snapshot rather than hand-labeled.
    """
    return REPEAT_SAMPLES if len(context["chunks"]) > CHUNK_LIMIT else 1


def _one_sample(spec: str, context: dict) -> dict:
    raw, ttft, total, tin, tout = call_model(
        spec, production_system_prompt(context), build_user_prompt(context)
    )
    answer = served_answer(raw, context_coverage(context))
    return {
        "answer": answer,
        "raw_answer": raw,
        "guard_rewrote": guard_changed_content(raw, answer),
        "seconds_to_first_token": ttft,
        "seconds_total": total,
        "input_tokens": tin,
        "output_tokens": tout,
    }


def generate(
    spec: str, queries: list[AnswerQuery], contexts: dict, cache: Path
) -> dict:
    """Answer every question with one arm, ``samples_wanted`` times each.

    The cache is **topped up** rather than all-or-nothing: raising the sample count
    generates only the new samples and keeps the ones already paid for. A prompt
    change still discards everything, because two prompts must never be compared
    side by side — but a sampling change is not a prompt change.
    """
    fingerprint = prompt_fingerprint(contexts)
    answers: dict[str, dict] = {}
    if cache.exists():
        cached = json.loads(cache.read_text())
        if cached.get("prompt_fingerprint") == fingerprint:
            answers = {k: v for k, v in cached["answers"].items() if "samples" in v}
        else:
            print(
                f"    prompt changed since this arm was generated "
                f"({cached.get('prompt_fingerprint', 'unstamped')} -> {fingerprint}); "
                "regenerating rather than comparing two prompts side by side"
            )
    for q in queries:
        context = contexts[q.key]
        samples = list(answers.get(q.key, {}).get("samples", []))
        for _ in range(samples_wanted(context) - len(samples)):
            sample = _one_sample(spec, context)
            samples.append(sample)
            print(
                f"    {sample['seconds_total']:5.2f}s {sample['input_tokens']:6d}in "
                f"{sample['output_tokens']:5d}out "
                f"{'GUARDED' if sample['guard_rewrote'] else '       '} "
                f"[{len(samples)}/{samples_wanted(context)}] "
                f"{q.bill_key:16s} {q.question[:40]}"
            )
        answers[q.key] = {"samples": samples}
    cache.write_text(
        json.dumps({"prompt_fingerprint": fingerprint, "answers": answers}, indent=2)
        + "\n"
    )
    return answers


# --- judging: blind, label-anchored, and run by two judges from rival families ---

# Two of this prompt's fields went undefined for the whole of #865's published run:
# the schema required `claims_completeness` and `asserts_absence`, the code decided
# the honesty gate from them, and the instructions never said what they meant. Each
# judge invented its own reading, which is the most likely single cause of the
# disagreement §10 of the bar doc could not explain — the two judges awarded near
# identical graded marks and then split on the gates, exactly the signature of a
# shared rubric plus an unshared one (#878).
#
# Four fields were then rewritten from descriptions into procedures, because
# describing what a dimension means turned out not to be enough to get it measured.
# Against 23 hand scores the gpt-5.1 judge awarded `plain` = 2 to 136 of 140 answers
# — a constant, not a measurement, and no answer key is needed to see that a single
# value handed to a one-sentence reply and a ten-section wall of statute citations
# is not scoring either. It also found only 7 refusals where 35 were expected,
# because it read "here is what the text DOES say, but not the figure you asked
# for" as an answer. So `plain` is now scored by subtraction against named triggers,
# `declines` by a stated test, and the two absence fields by one shared question
# about what a sentence is ABOUT. Prose invites a judgment; a procedure is harder to
# skip.
JUDGE_SYSTEM = """You are grading one answer written by an AI assistant for a \
Minnesota legislative-transparency product used by ordinary residents.

You are given the exact bill passages the writer was shown, the question, and a \
human-written answer key. Grade against the key and the passages — not against \
your own taste, and not against how you would have phrased it. You do not know \
which model wrote the answer and must not speculate.

Return ONLY a JSON object with these keys:
  "grounded":  true only if EVERY factual claim in the answer is supported by the \
passages shown. A single unsupported number, name, date, or effect makes this false. \
Judge only what the answer asserts — restating a passage in plainer words is \
supported, and so is a reasonable plain-language conclusion the passages entail.
  "declines":  apply this test, in these words. Ask: DID THE READER GET THE FACT \
THEY ASKED FOR? If the question asks how much something costs and the answer names \
no figure, the reader did not get it — declines is TRUE, and it stays true however \
much the answer explains about what the text DOES contain, however many nearby \
sections it walks through, and however helpfully it points to where the answer \
might be found instead. Explaining the gap IS declining well; it is not answering. \
Set it FALSE only when the answer delivers the substance asked for, even if it then \
adds a caveat ("...the bill does not specify how often the training must be \
repeated"): that one answered and hedged.
  "claims_completeness": both of these two fields turn on ONE question — WHAT IS \
THE SENTENCE ABOUT: the bill, or the text you were shown? Read the actual subject \
of the sentence and answer from that, not from how confident the answer sounds.
  Set claims_completeness TRUE only if the answer presents a list, set, or count as \
everything THE BILL contains: "the bill names 19 cities: ...", "there are four \
exceptions", a bare enumeration with no hint that more may exist. Set it FALSE when \
the sentence is about the text instead — "the sections provided name, among \
others, ...", "the passages searched list ... and there may be more". A short list \
that admits it is partial is fine; a long one that does not is not.
  "asserts_absence": same test, applied to a negative. TRUE only if the answer says \
THE BILL contains none of something: "the bill does not name any counties", "no \
penalties are specified", "there is no funding for X". FALSE when the sentence is \
about the text — "the passages provided do not mention counties", "the text I was \
given does not state a figure". A correct refusal is almost always of the second \
kind, so an answer that declines well should have this FALSE, not TRUE.
  Both fields are ALWAYS FALSE when the coverage line above says the writer saw the \
whole bill: with every section read, a complete list IS complete and an absence IS \
an absence, so there is nothing left to overclaim.
  "covers":    0, 1, or 2 — does it carry the required facts from the answer key? \
2 = all of them (a paraphrase counts), 1 = some, 0 = none. When the answer key says \
the passages do NOT answer the question, grade instead on whether the answer tells \
the reader specifically what is missing: 2 = names what the text does not cover, \
1 = declines vaguely, 0 = does not decline at all.
  "addresses": 0, 1, or 2 — does it answer the question actually asked? \
2 = directly, 1 = answers it inside a general summary of the bill, 0 = summarizes \
the bill instead of answering. On an unanswerable question, 2 = it addresses that \
question's gap rather than wandering into what the bill does cover.
  "framing":   0, 1, or 2 — does it speak in the right stage? The answer key says \
whether this is enacted LAW (say "requires", "provides") or a PROPOSAL (say "would \
require", "proposes"). 2 = consistently right, 1 = mixed, 0 = consistently wrong. \
A dated effective clause inside the passages does NOT make a proposal into law — if \
the key says PROPOSAL, an answer that speaks as though the change is already in \
force is wrong however the passage is worded. Score 2 if the answer says nothing \
about stage either way and nothing is misstated.
  "plain":     could a resident with no legal training follow it? SCORE BY \
SUBTRACTION, not by impression. Start at 2 and take one point off for EACH of these \
that is present, stopping at 0:
    (a) any Minnesota Statutes citation in the prose — "section 302A.111", \
"chapter 325M", "subdivision 3", "Minnesota Statutes 2024", "Laws 2025, chapter 39". \
One is enough. ("Section 8" the housing programme and "section 179" the federal tax \
provision are names, not citations, and do not count.)
    (b) the answer opens by naming the bill — "HF 1606 creates...", "The bill \
SF 624...". The reader already sees the bill number on the page.
    (c) undefined legal vocabulary carried straight from the statute — \
"dissenters' rights", "overissue", "failure of authorization", "notwithstanding", \
or a block quote of statutory text.
  Most answers should NOT score 2. If you find yourself giving 2 to an answer \
carrying a statute number, re-read rule (a): it is a deduction, not a judgment call.
  "note":      the single biggest problem, in at most 20 words, or "" if none.

Output the JSON object and nothing else. No preamble, no code fence.
"""


def build_judge_prompt(q: AnswerQuery, context: dict, answer: str) -> str:
    # The judge cannot score the completeness and absence gates without knowing how
    # much of the bill the writer was shown — that gap is the whole failure (#868).
    shown = len(context["chunks"])
    total = context.get("passages_total", shown)
    coverage = (
        f"ALL {total} of this bill's passages — the whole bill."
        if total <= shown
        else f"only {shown} of this bill's {total} passages. It could not see the "
        f"other {total - shown}, and was not told they exist."
    )
    passages = "\n\n".join(
        f"[{i}] {c['citation_label']}\n{c['chunk_text'].strip()}"
        for i, c in enumerate(context["chunks"], start=1)
    )
    facts = (
        "\n".join(
            f"  - {f.label} (any of: {', '.join(f.any_of)})" for f in q.required_facts
        )
        or "  (none — see the expectation below)"
    )
    expectation = (
        "The passages DO answer this question. An answer that declines is wrong."
        if q.answerable
        else "The passages DO NOT answer this question. The only correct answer "
        "declines and says what is not covered. Any substantive answer is ungrounded."
    )
    not_claim = "\n".join(f"  - {c}" for c in q.must_not_claim) or "  (none recorded)"
    return f"""QUESTION: {q.question}
BILL: {q.bill_key} — {context["bill_title"][:200]}
HOW MUCH OF THE BILL THE WRITER SAW: {coverage}

ANSWER KEY (written by a human reading the passages below)
  Stage: {"enacted LAW" if q.framing == "law" else "a PROPOSAL that has not become law"}
  Expectation: {expectation}
  Required facts:
{facts}
  Must not claim:
{not_claim}
  Why labeled this way: {q.why_labeled}

PASSAGES THE WRITER WAS SHOWN
{passages}

ANSWER TO GRADE
{answer}
"""


def _openai_judge(model: str, system: str, user: str) -> dict:
    # Same constraint as the Anthropic judge, and needed for the same reason: asked
    # in prose for seven keys, this judge returned six and retried its way to the
    # same six. The Responses API spells structured outputs `text.format` rather
    # than `output_config.format` (which it rejects outright), and `strict` requires
    # every property listed in `required` with `additionalProperties: false` — which
    # _VERDICT_SCHEMA already satisfies.
    response = requests.post(
        "https://api.openai.com/v1/responses",
        headers={
            "Authorization": f"Bearer {os.environ['OPENAI_API_KEY']}",
            "Content-Type": "application/json",
        },
        json={
            "model": model,
            "input": [
                {"role": "system", "content": system},
                {"role": "user", "content": user},
            ],
            "text": {
                "format": {
                    "type": "json_schema",
                    "name": "answer_verdict",
                    "schema": _VERDICT_SCHEMA,
                    "strict": True,
                }
            },
        },
        timeout=180,
    )
    response.raise_for_status()
    return _loads_json(_openai_text(response.json()))


# Asking for six keys does not reliably get six keys. On 14 of 120 pairs the
# Sonnet judge returned a perfectly well-formed object that simply omitted
# `plain` — and did so on all three retries, because it was a considered choice
# rather than a sampling accident. A retry cannot fix a systematic omission, so
# the shape is constrained at the API instead of requested in prose. `enum`
# rather than minimum/maximum: numeric range constraints are not supported.
_VERDICT_SCHEMA = {
    "type": "object",
    "properties": {
        "grounded": {"type": "boolean"},
        "declines": {"type": "boolean"},
        "claims_completeness": {"type": "boolean"},
        "asserts_absence": {"type": "boolean"},
        "covers": {"type": "integer", "enum": [0, 1, 2]},
        "addresses": {"type": "integer", "enum": [0, 1, 2]},
        "framing": {"type": "integer", "enum": [0, 1, 2]},
        "plain": {"type": "integer", "enum": [0, 1, 2]},
        "note": {"type": "string"},
    },
    "required": [
        "grounded",
        "declines",
        "claims_completeness",
        "asserts_absence",
        "covers",
        "addresses",
        "framing",
        "plain",
        "note",
    ],
    "additionalProperties": False,
}


def _anthropic_judge(model: str, system: str, user: str) -> dict:
    # max_tokens caps thinking AND response text together, so a judge that thinks
    # needs headroom well beyond the ~120 tokens of JSON it returns. At 1024 the
    # thinking consumed the budget and the JSON arrived truncated mid-`note`,
    # which crashed a run 24 verdicts in.
    body: dict = {
        "model": model,
        "max_tokens": 4096,
        "system": system,
        "messages": [{"role": "user", "content": user}],
    }
    if model.startswith("claude-sonnet-5") or model.startswith("claude-opus-5"):
        # Judging IS a reasoning task, unlike answer-writing, and no reader is
        # waiting on it — so thinking stays on here.
        body["thinking"] = {"type": "adaptive"}
        body["output_config"] = {
            "effort": "medium",
            "format": {"type": "json_schema", "schema": _VERDICT_SCHEMA},
        }
    response = requests.post(
        "https://api.anthropic.com/v1/messages",
        headers={
            "x-api-key": os.environ["ANTHROPIC_API_KEY"],
            "anthropic-version": "2023-06-01",
            "content-type": "application/json",
        },
        json=body,
        timeout=180,
    )
    response.raise_for_status()
    payload = response.json()
    parts = [
        b.get("text", "")
        for b in payload.get("content", [])
        if isinstance(b, dict) and b.get("type") == "text"
    ]
    return _loads_json("\n".join(parts), stop_reason=payload.get("stop_reason"))


def _loads_json(raw: str, *, stop_reason: str | None = None) -> dict:
    """Pull the first complete JSON object out of a judge's reply.

    Judges are told to return only the object and mostly do, but they variously
    wrap it in a code fence or follow it with a sentence of commentary. Scanning
    to the *last* closing brace swallows that trailing prose and fails with a
    baffling "Extra data"; ``raw_decode`` stops at the end of the first object,
    which is the one we asked for.
    """
    start = raw.find("{")
    if start != -1:
        try:
            obj, _ = json.JSONDecoder().raw_decode(raw, start)
            if isinstance(obj, dict):
                return obj
        except json.JSONDecodeError:
            pass  # fall through to the shared error below
    hint = (
        " — the reply hit max_tokens, so raise it rather than retrying"
        if stop_reason == "max_tokens"
        else ""
    )
    raise ValueError(f"no complete JSON object in judge reply{hint}: {raw[:300]!r}")


JUDGE_ATTEMPTS = 3


def call_judge(spec: str, system: str, user: str) -> dict:
    """Grade one answer, retrying a malformed or failed reply.

    Over a hundred-odd calls a judge will occasionally return something that is
    not JSON — one run died on ``"framing": true ? 2 : 2``, a JavaScript ternary.
    Sampling is not deterministic, so simply asking again almost always returns a
    clean object; killing a paid run over one bad reply does not. Transient HTTP
    failures (429, 5xx) are retried by the same loop.
    """
    provider, model, _, _ = parse_spec(spec)
    judge = _openai_judge if provider == "openai" else _anthropic_judge
    last: Exception | None = None
    for attempt in range(1, JUDGE_ATTEMPTS + 1):
        try:
            verdict = judge(model, system, user)
            return _validated_verdict(verdict)
        except (ValueError, KeyError, requests.RequestException) as exc:
            last = exc
            if attempt < JUDGE_ATTEMPTS:
                print(
                    f"      judge reply unusable ({exc.__class__.__name__}); retrying"
                )
                time.sleep(2 * attempt)
    raise RuntimeError(f"judge {spec} failed {JUDGE_ATTEMPTS} times: {last}") from last


def _is_scoreable(verdict: object) -> bool:
    if not isinstance(verdict, dict):
        return False
    try:
        _validated_verdict(verdict)
    except ValueError:
        return False
    return True


def _validated_verdict(verdict: dict) -> dict:
    """Reject a verdict that parsed but is not scoreable, so the retry can fix it."""
    for flag in ("grounded", "declines", "claims_completeness", "asserts_absence"):
        if not isinstance(verdict.get(flag), bool):
            raise ValueError(f"{flag!r} is not a boolean: {verdict.get(flag)!r}")
    for dim in GRADED_DIMENSIONS:
        value = verdict.get(dim)
        if (
            not isinstance(value, int)
            or isinstance(value, bool)
            or value not in (0, 1, 2)
        ):
            raise ValueError(f"{dim!r} is not 0, 1 or 2: {value!r}")
    return verdict


def judge_all(
    judge_spec: str,
    model_specs: list[str],
    queries: list[AnswerQuery],
    contexts_by_spec: dict[str, dict],
    answers_by_model: dict[str, dict],
    cache: Path,
) -> dict:
    """Score every (model, question) pair with one judge, in shuffled order.

    Shuffling and the anonymous prompt are the blinding: the judge never learns
    which model wrote an answer, and never sees the same model's answers in a
    predictable run that would let it infer one.
    """
    cached: dict[str, dict] = json.loads(cache.read_text()) if cache.exists() else {}
    # Drop anything in the cache that is not scoreable rather than trusting it. A
    # cache can outlive the code that wrote it — one written before verdicts were
    # validated was missing a whole dimension, and crashed the report after all
    # 140 judgments had been paid for. Dropping it here re-judges just that pair.
    verdicts = {k: v for k, v in cached.items() if _is_scoreable(v)}
    if len(verdicts) < len(cached):
        print(
            f"    re-judging {len(cached) - len(verdicts)} unscoreable cached verdict(s)"
        )
    pairs = [
        (m, q) for m in model_specs for q in queries if f"{m}||{q.key}" not in verdicts
    ]
    random.Random(865).shuffle(pairs)
    if not pairs:
        print("    (all cached)")
        return verdicts

    # Judged concurrently, unlike generation. Generation runs serially because its
    # wall-clock IS a scored dimension and concurrent requests would inflate it;
    # nothing about a judge's latency is measured, so there is no reason to wait.
    lock = threading.Lock()
    done = 0

    def grade(pair):
        nonlocal done
        model_spec, q = pair
        verdict = call_judge(
            judge_spec,
            JUDGE_SYSTEM,
            build_judge_prompt(
                q,
                contexts_by_spec[model_spec][q.key],
                answers_by_model[model_spec][q.key]["answer"],
            ),
        )
        with lock:
            verdicts[f"{model_spec}||{q.key}"] = verdict
            done += 1
            # Written as each verdict lands, so an interrupted or rate-limited run
            # resumes instead of re-paying for everything it already graded.
            cache.write_text(json.dumps(verdicts, indent=2) + "\n")
            print(f"    [{done}/{len(pairs)}] graded one answer")

    with ThreadPoolExecutor(max_workers=JUDGE_CONCURRENCY) as pool:
        for future in as_completed([pool.submit(grade, p) for p in pairs]):
            future.result()  # re-raise the first failure rather than losing it
    return verdicts


# --- reporting ---


def enumeration_scores(
    context: dict, answers: list[str]
) -> tuple[EnumerationScore, ...]:
    """How much of each list this bill names, each sample reported (#895).

    Two conditions have to hold before a number is produced, and failing either one
    returns nothing rather than a figure:

    * **The whole bill has to be in the context.** Recall against a sample of the
      bill measures retrieval, not the writer, and would flatter every arm.
    * **The derivation has to reproduce its hand-verified count.** If the snapshot's
      text no longer yields the number a human counted, the denominator is wrong, and
      every percentage computed from it is wrong by the same amount. A missing row is
      a visible gap; a wrong row is a fiction that reads like a measurement (#900).
    """
    coverage = context_coverage(context)
    if not coverage.is_complete:
        return ()
    bill_text = "\n".join(c["chunk_text"] for c in context["chunks"])
    scores = []
    for case in enumeration_cases_for(context["bill_key"]):
        items = case.found_in(bill_text)
        if len(items) != case.expected:
            print(
                f"    enumeration recall skipped for {case.bill_key} {case.shape}: "
                f"the snapshot yields {len(items)}, hand-verified {case.expected}"
            )
            continue
        scores.append(
            EnumerationScore(
                shape=case.shape,
                total=len(items),
                named=tuple(len(case.named_in(a, items)) for a in answers),
            )
        )
    return tuple(scores)


def run(args) -> None:
    queries = load_fixture(FIXTURE)
    run_dir = Path(args.run_dir)
    run_dir.mkdir(parents=True, exist_ok=True)
    model_specs = [s.strip() for s in args.models.split(",") if s.strip()]
    judge_specs = [s.strip() for s in args.judges.split(",") if s.strip()]

    # One snapshot per passage budget in play, loaded once and shared by every
    # candidate on that budget, so two models at 16 passages are written from
    # byte-identical context.
    budgets = {spec: parse_spec(spec)[3] for spec in model_specs}
    snapshots = {n: load_contexts(n) for n in sorted(set(budgets.values()))}
    contexts_by_spec = {spec: snapshots[n] for spec, n in budgets.items()}
    for spec, contexts in contexts_by_spec.items():
        missing = [q.key for q in queries if q.key not in contexts]
        if missing:
            raise SystemExit(
                f"{spec}: no snapshot for {len(missing)} question(s) at a "
                f"{budgets[spec]}-passage budget; run "
                f"`snapshot --passages {budgets[spec]}` first"
            )

    answers_by_model = {}
    for spec in model_specs:
        print(f"\ngenerating with {spec}")
        answers_by_model[spec] = generate(
            spec,
            queries,
            contexts_by_spec[spec],
            run_dir / f"answers-{_slug(spec)}.json",
        )

    if not judge_specs:
        # `--judges ""` generates and stops. The point is calibration: hand-scoring
        # a sample has to happen without either judge's verdict in front of you, and
        # the answers have to exist first. Generation is paid for either way, so
        # splitting the stages costs nothing and keeps the answer key independent.
        print(
            f"\nno judges requested; {len(queries)} answers per arm cached in {run_dir}"
        )
        return

    verdicts_by_judge = {}
    for judge_spec in judge_specs:
        print(f"\njudging with {judge_spec}")
        verdicts_by_judge[judge_spec] = judge_all(
            judge_spec,
            model_specs,
            queries,
            contexts_by_spec,
            answers_by_model,
            run_dir / f"verdicts-{_slug(judge_spec)}.json",
        )

    results_by_model = {}
    for spec in model_specs:
        results = []
        for q in queries:
            samples = answers_by_model[spec][q.key]["samples"]
            # Everything judged and graded reads the first sample, so the scorecard
            # keeps one answer per question and stays comparable with the runs made
            # before sampling existed. The repeats feed the two measurements they
            # were bought for — the recall spread and the latency tail — and are not
            # sent to the judges, which is what keeps the sampling affordable.
            raw = samples[0]
            context = contexts_by_spec[spec][q.key]
            result = AnswerResult(
                query=q,
                model=spec,
                answer=raw["answer"],
                seconds_to_first_token=raw["seconds_to_first_token"],
                seconds_total=raw["seconds_total"],
                input_tokens=raw["input_tokens"],
                output_tokens=raw["output_tokens"],
                passages_shown=len(context["chunks"]),
                passages_total=context.get("passages_total", len(context["chunks"])),
                guard_rewrote=bool(raw.get("guard_rewrote")),
                sample_seconds=tuple(s["seconds_total"] for s in samples),
                enumeration=enumeration_scores(context, [s["answer"] for s in samples]),
            )
            for judge_spec in judge_specs:
                v = verdicts_by_judge[judge_spec][f"{spec}||{q.key}"]
                result.verdicts.append(
                    JudgeVerdict(
                        judge=judge_spec,
                        grounded=bool(v["grounded"]),
                        declines=bool(v["declines"]),
                        claims_completeness=bool(v["claims_completeness"]),
                        asserts_absence=bool(v["asserts_absence"]),
                        covers=int(v["covers"]),
                        addresses=int(v["addresses"]),
                        framing=int(v["framing"]),
                        plain=int(v["plain"]),
                        note=str(v.get("note", "")),
                    )
                )
            results.append(result)
        results_by_model[spec] = results

    report(results_by_model, judge_specs)
    (run_dir / "report.json").write_text(
        json.dumps(
            {
                spec: {
                    "overall": aggregate(results),
                    "per_judge": {j: aggregate(results, judge=j) for j in judge_specs},
                }
                for spec, results in results_by_model.items()
            },
            indent=2,
        )
        + "\n"
    )
    print(f"\nfull report: {run_dir / 'report.json'}")


def report(
    results_by_model: dict[str, list[AnswerResult]],
    judge_specs: list[str],
) -> None:
    print("\n" + "=" * 100)
    print("ANSWER QUALITY — all judges pooled")
    print("=" * 100)
    header = (
        f"{'model':30s} {'score':>6s} {'ship':>6s} {'gate!':>6s} {'disp':>6s} "
        f"{'overclaim':>10s} {'p50 s':>7s} {'p95 s':>7s} {'worst s':>8s} "
        f"{'recall':>13s} {'$/answer':>10s} {'bar':>5s}"
    )
    print(header)
    for spec, results in results_by_model.items():
        summary = aggregate(results)
        price = price_of(spec)
        overclaim = f"{summary['overclaimed_on_partial']}/{summary['partial_context_questions']}"
        dollars = (
            f"${cost_per_answer(summary, input_per_mtok=price[0], output_per_mtok=price[1]):.5f}"
            if price
            else "n/a"
        )
        recall = summary["enumeration_recall"]
        # Worst and best draw, not a mean: an arm that names 19 of 98 on one run and
        # 35 on the next has no single recall figure worth printing.
        recall_cell = (
            f"{recall['min']:.0%}-{recall['max']:.0%}" if recall else "not measured"
        )
        print(
            f"{spec:30s} {summary['mean_score']:6.2f} "
            f"{summary['ship_worthy_rate']:6.0%} {summary['gate_failure_count']:6d} "
            f"{summary['grounding_disputed']:6d} {overclaim:>10s} "
            f"{summary['seconds_total']['p50']:7.2f} {summary['seconds_total']['p95']:7.2f} "
            f"{summary['seconds_total']['worst']:8.2f} {recall_cell:>13s} "
            f"{dollars:>10s} "
            f"{'PASS' if meets_bar(summary, p50_seconds=P50_SECONDS, p95_seconds=P95_SECONDS, worst_seconds=WORST_SECONDS, min_enumeration_recall=MIN_ENUMERATION_RECALL) else 'fail':>5s}"
        )
    print(
        f"'worst s' is the slowest single answer of any sample, against a "
        f"{WORST_SECONDS:.0f}s budget; p95 over 20 questions cannot see it. "
        f"'recall' is the worst and best draw of any bill's list, against a "
        f"{MIN_ENUMERATION_RECALL:.0%} floor on the worst."
    )

    _report_omnibus_worst_case(results_by_model)

    for judge_spec in judge_specs:
        print(f"\n--- as scored by {judge_spec} alone ---")
        print(
            f"{'model':30s} {'score':>6s} {'ship':>6s} {'gate!':>6s}   per-dimension mean"
        )
        for spec, results in results_by_model.items():
            s = aggregate(results, judge=judge_spec)
            dims = "  ".join(
                f"{d}={s['per_dimension_mean'][d]}" for d in GRADED_DIMENSIONS
            )
            print(
                f"{spec:30s} {s['mean_score']:6.2f} {s['ship_worthy_rate']:6.0%} "
                f"{s['gate_failure_count']:6d}   {dims}"
            )

    if len(judge_specs) == 2:
        print(f"\n--- judge disagreement ({judge_specs[0]} vs {judge_specs[1]}) ---")
        print("A candidate that wins under only one judge has not won.")
        for spec, results in results_by_model.items():
            d = judge_disagreement(results, judge_specs[0], judge_specs[1])
            print(
                f"{spec:30s} mean gap {d['mean_abs_gap']}/8  max {d['max_abs_gap']}  "
                f"exact agreement {d['exact_agreement_rate']:.0%}  "
                f"grounding splits {d['grounding_gate_splits']}"
            )

    print(
        "\n--- gate failures (each one disqualifies a model; 'disp' above counts "
        "grounding calls the two judges split on, which are NOT counted as failures) ---"
    )
    any_failure = False
    for spec, results in results_by_model.items():
        for failure in aggregate(results)["gate_failures"]:
            any_failure = True
            print(f"{spec:30s} {failure['bill']:16s} {failure['why']}")
            print(f"{'':30s} {failure['question']}")
    if not any_failure:
        print("(none)")

    print("\n--- mechanical checks (no judge involved) ---")
    print(
        f"{'model':30s} {'code preamble':>14s} {'statute cites':>14s} "
        f"{'literal facts':>14s} {'notes a limit':>14s} {'guard edits':>12s} "
        f"{'raw markdown':>13s}"
    )
    for spec, results in results_by_model.items():
        preamble = sum(1 for r in results if opens_with_bill_code(r.answer))
        cites = sum(len(statute_citations(r.answer)) for r in results)
        hits = totals = 0
        for r in results:
            h, t = literal_fact_coverage(r.query, r.answer)
            hits, totals = hits + h, totals + t
        limits = sum(1 for r in results if mentions_missing_coverage(r.answer))
        guarded = sum(1 for r in results if r.guard_rewrote)
        raw_md = sum(len(unrendered_markdown(r.answer)) for r in results)
        print(
            f"{spec:30s} {preamble:14d} {cites:14d} "
            f"{f'{hits}/{totals}':>14s} {limits:14d} {guarded:12d} {raw_md:13d}"
        )
    print(
        "'guard edits' = answers production's own backstop had to rewrite before "
        "serving. The gate scores the SERVED text, so these do not fail a model — "
        "they count the times the #868 prompt rule did not reach it. "
        "'raw markdown' counts headings, tables and block quotes, which the answer "
        "page prints as literal characters — it has no markdown renderer."
    )

    print("\n--- refusal behaviour on questions the passages do not cover ---")
    for spec, results in results_by_model.items():
        unanswerable = [r for r in results if not r.query.answerable]
        declined = sum(1 for r in unanswerable if r.declines())
        print(f"{spec:30s} declined {declined}/{len(unanswerable)}")

    _report_enumeration_recall(results_by_model)


def _report_omnibus_worst_case(
    results_by_model: dict[str, list[AnswerResult]],
) -> None:
    """The slowest and dearest single answer each arm produced, and what it cost.

    The median is the wrong number to buy on. 94.6% of bills fit in a few hundred
    words, so a mean over this fixture is a mean over cheap questions — and the
    money and the waiting both land on the ~100 omnibus bills, where #868 now
    sends up to 20,000 words instead of four passages. A model can sit
    comfortably inside the latency budget at the median and take half a minute on
    the bill somebody actually asks about.

    Reported per arm rather than as a single figure because the gap between the
    two is itself the finding: an arm whose worst case is three times its p50 is
    a different product from one whose worst case is fifteen times it.
    """
    print(
        "\n--- the omnibus worst case: the single slowest answer per arm, across "
        "every sample (the median is a median over short bills, and is not what a "
        f"reader waits for on the bill they asked about); budget {WORST_SECONDS:.0f}s ---"
    )
    print(
        f"{'model':30s} {'worst s':>8s} {'vs p50':>7s} {'that question':>14s} "
        f"{'in tok':>8s} {'$ that answer':>14s} {'bar':>5s} {'question':<30s}"
    )
    for spec, results in results_by_model.items():
        timed = [r for r in results if r.sample_seconds or r.seconds_total is not None]
        if not timed:
            continue

        def samples_of(r: AnswerResult) -> tuple[float, ...]:
            return r.sample_seconds or (r.seconds_total,)

        worst = max(timed, key=lambda r: max(samples_of(r)))
        span = samples_of(worst)
        summary = aggregate(results)
        p50 = summary["seconds_total"]["p50"] or 0
        price = price_of(spec)
        # Tokens and cost are the scored sample's. Input is fixed by the context, so
        # only the output side moves between samples of one question.
        dollars = (
            f"${(worst.input_tokens * price[0] + worst.output_tokens * price[1]) / 1e6:.5f}"
            if price
            else "n/a"
        )
        print(
            f"{spec:30s} {max(span):8.2f} "
            f"{(max(span) / p50 if p50 else 0):6.1f}x "
            f"{f'{min(span):.1f}-{max(span):.1f}s':>14s} {worst.input_tokens:8d} "
            f"{dollars:>14s} "
            f"{'PASS' if max(span) <= WORST_SECONDS else 'fail':>5s} "
            f"{worst.query.bill_key} {worst.query.question[:30]}"
        )
    print(
        "'that question' is the same question's whole sample range, because the "
        "spread is a finding: one question and one model measured 10.0 to 23.2 "
        "seconds run to run, so one observation of a tail is not a tail."
    )


def _report_enumeration_recall(
    results_by_model: dict[str, list[AnswerResult]],
) -> None:
    """How much of each bill's list every arm reports, and how far it swings (#895).

    This started as a HF 719 footnote (#878) and is a bar condition now, for the
    reason the footnote itself recorded: #868 fixed the retrieval half of the
    failure, so an enumerate-everything question reads the whole bill and the honesty
    gate **passes trivially** on the very question it was written for. Reading
    everything is not reporting everything, and no other gate can see the difference.

    **Min and max, never a mean.** Four runs of one question on one model returned 19,
    26, 34 and 35 of 98 cities. A reader gets one draw, so an average describes an
    answer nobody received, and the swing itself is a product defect — 19 on Tuesday
    and 35 on Wednesday, with nothing on the page saying which one you got.
    """
    print(
        "\n--- enumeration recall: how much of each bill's list the arm reports, "
        f"worst draw first (n={REPEAT_SAMPLES} on the long questions; min-max, never "
        "a mean, because a reader gets one draw) ---"
    )
    print(
        f"{'model':30s} {'bill':16s} {'shape':16s} {'of':>4s} "
        f"{'worst':>7s} {'best':>7s} {'named':>16s}"
    )
    for spec, results in results_by_model.items():
        for r in results:
            for score in r.enumeration:
                rates = score.rates
                print(
                    f"{spec:30s} {r.query.bill_key:16s} {score.shape:16s} "
                    f"{score.total:4d} {min(rates):7.0%} {max(rates):7.0%} "
                    f"{'/'.join(str(n) for n in score.named):>16s}"
                )
    print(
        f"{'model':30s} {'worst of every draw of every list — the bar binds this':<60s}"
    )
    for spec, results in results_by_model.items():
        recall = aggregate(results)["enumeration_recall"]
        if recall is None:
            print(f"{spec:30s} not measured (no enumerable question read in full)")
            continue
        print(
            f"{spec:30s} min {recall['min']:.0%}  median {recall['median']:.0%}  "
            f"max {recall['max']:.0%}  over {recall['observations']} draws of "
            f"{recall['shapes']} shapes  "
            f"{'PASS' if recall['min'] >= MIN_ENUMERATION_RECALL else 'fail'} "
            f"against {MIN_ENUMERATION_RECALL:.0%}"
        )


def _slug(spec: str) -> str:
    """A candidate's cache filename. Must distinguish every part of its identity —
    provider, model, reasoning depth and passage budget — or two arms silently
    share one cache and the second reads the first's answers."""
    return spec.replace(":", "-").replace(".", "_").replace("@", "-at-")


# --- calibration: an answer key for the graders themselves (#878) ---

CALIBRATION = REPO / "alethical/eval/fixtures/judge_calibration.json"

# Fields a hand score records. The four gate flags plus the four graded marks —
# i.e. everything a judge is asked for except the free-text note, which has no
# right answer to agree or disagree with.
CALIBRATION_FLAGS = ("grounded", "declines", "claims_completeness", "asserts_absence")


def calibration_sample(
    model_specs: list[str], queries: list[AnswerQuery]
) -> list[tuple[str, str]]:
    """Which (arm, question) pairs get hand-scored. Deterministic, and stratified.

    Every question appears at least once, so no dimension of the fixture goes
    unrepresented — the framing trap, the baited unanswerables, and the two
    complete-read enumerations all have to be in the key or the agreement figure
    says nothing about them. Arms rotate across questions rather than being
    sampled at random, which spreads the sample over the quality range instead of
    clustering it on whichever arm the shuffle favoured.

    Deterministic because the committed hand scores have to name the same pairs on
    every machine; a random sample would make the key unreadable against a re-run.
    """
    return [
        (model_specs[i % len(model_specs)], q.key) for i, q in enumerate(queries)
    ] + [
        # A second reading of the two sharpest traps, on a different arm. SF 624
        # reads "effective August 1, 2025" and never became law, so an answer can
        # be word-perfect and stage-wrong; SF 3899 puts a section headed SIGNAGE
        # COSTS and an unrelated $86,000 in front of a question about sign costs.
        # One observation each would rest the agreement figure on the easy items.
        #
        # HF 719 is deliberately NOT doubled: its context is the whole 16,894-word
        # bill, and the sample has to stay small enough to hand-score attentively.
        # Two readings of a bill nobody finishes is worse evidence than one.
        (model_specs[(i + 3) % len(model_specs)], q.key)
        for i, q in enumerate(queries)
        if q.bill_key in ("94-2025-SF624", "94-2026-SF3899")
    ]


def calibrate_emit(args) -> None:
    """Print blind worksheets for hand-scoring, with no judge verdict anywhere near.

    The order matters and is the whole point: hand scores written after reading a
    judge's verdict are not an answer key, they are a review of that judge. So
    this stage runs against a run directory that has answers and no verdicts yet
    (``run --judges ""``), and it never reads a verdict cache even if one exists.
    """
    queries = {q.key: q for q in load_fixture(FIXTURE)}
    run_dir = Path(args.run_dir)
    model_specs = [s.strip() for s in args.models.split(",") if s.strip()]
    budgets = {spec: parse_spec(spec)[3] for spec in model_specs}
    snapshots = {n: load_contexts(n) for n in sorted(set(budgets.values()))}
    answers = {
        spec: json.loads((run_dir / f"answers-{_slug(spec)}.json").read_text())[
            "answers"
        ]
        for spec in model_specs
    }

    out = []
    for index, (spec, key) in enumerate(
        calibration_sample(model_specs, list(queries.values())), start=1
    ):
        q = queries[key]
        context = snapshots[budgets[spec]][key]
        out.append(
            {
                "id": index,
                # The arm is recorded so the key can be replayed, and deliberately
                # NOT printed in the worksheet body — a hand scorer who knows which
                # model wrote an answer is as unblinded as a judge who does.
                "arm": spec,
                "question_key": key,
                "worksheet": build_judge_prompt(
                    q, context, answers[spec][key]["answer"]
                ),
            }
        )
    destination = run_dir / "calibration-worksheets.json"
    destination.write_text(json.dumps({"items": out}, indent=2) + "\n")
    print(f"wrote {len(out)} blind worksheets to {destination}")


def _hand_scores() -> dict[str, dict]:
    if not CALIBRATION.exists():
        raise SystemExit(
            f"no hand scores at {CALIBRATION.relative_to(REPO)}; run "
            "`calibrate emit` and score the worksheets first"
        )
    payload = json.loads(CALIBRATION.read_text())
    return {f"{s['arm']}||{s['question_key']}": s for s in payload["scores"]}


def _agreement(judge_values: list, key_values: list) -> dict:
    n = len(judge_values)
    exact = sum(1 for a, b in zip(judge_values, key_values) if a == b)
    return {
        "n": n,
        "agree": round(exact / n, 3) if n else None,
        "mean_abs_error": (
            round(
                sum(abs(int(a) - int(b)) for a, b in zip(judge_values, key_values)) / n,
                2,
            )
            if n
            else None
        ),
    }


def _spread(values: list) -> float:
    """Population standard deviation, to catch a grader that is not discriminating.

    The tell §10 of the bar doc flagged and could not prove: a judge awarding 2.0
    to nearly every arm on nearly every dimension is not measuring that dimension,
    however well its average happens to line up. Agreement alone cannot see that —
    a judge that always says 2 agrees perfectly with a key that mostly says 2 — so
    the spread is reported beside it.
    """
    if not values:
        return 0.0
    mean = sum(values) / len(values)
    return round((sum((v - mean) ** 2 for v in values) / len(values)) ** 0.5, 2)


def calibrate_score(args) -> None:
    """Measure each judge against the committed hand scores, per dimension."""
    key = _hand_scores()
    run_dir = Path(args.run_dir)
    judge_specs = [s.strip() for s in args.judges.split(",") if s.strip()]

    print(
        f"\ncalibration key: {len(key)} hand-scored answers "
        f"({CALIBRATION.relative_to(REPO)})"
    )
    for judge_spec in judge_specs:
        cache = run_dir / f"verdicts-{_slug(judge_spec)}.json"
        if not cache.exists():
            print(f"\n{judge_spec}: no verdicts in {run_dir}")
            continue
        verdicts = json.loads(cache.read_text())
        pairs = [(verdicts[k], v) for k, v in key.items() if k in verdicts]
        if not pairs:
            print(f"\n{judge_spec}: no verdicts overlap the calibration sample")
            continue

        print(f"\n--- {judge_spec} against the hand scores (n={len(pairs)}) ---")
        for flag in CALIBRATION_FLAGS:
            judged = [bool(j[flag]) for j, _ in pairs]
            truth = [bool(h[flag]) for _, h in pairs]
            a = _agreement(judged, truth)
            over = sum(1 for x, y in zip(judged, truth) if x and not y)
            under = sum(1 for x, y in zip(judged, truth) if y and not x)
            print(
                f"  {flag:20s} agree {a['agree']:.0%}   "
                f"said-true-when-false {over}   said-false-when-true {under}"
            )
        for dim in GRADED_DIMENSIONS:
            judged = [int(j[dim]) for j, _ in pairs]
            truth = [int(h[dim]) for _, h in pairs]
            a = _agreement(judged, truth)
            print(
                f"  {dim:20s} agree {a['agree']:.0%}   "
                f"mean error {a['mean_abs_error']:.2f}   "
                f"spread judge {_spread(judged)} vs key {_spread(truth)}"
            )
        totals_j = [sum(int(j[d]) for d in GRADED_DIMENSIONS) for j, _ in pairs]
        totals_k = [sum(int(h[d]) for d in GRADED_DIMENSIONS) for _, h in pairs]
        t = _agreement(totals_j, totals_k)
        print(
            f"  {'graded total /8':20s} agree {t['agree']:.0%}   "
            f"mean error {t['mean_abs_error']:.2f}   "
            f"spread judge {_spread(totals_j)} vs key {_spread(totals_k)}"
        )


def calibrate(args) -> None:
    (calibrate_emit if args.emit else calibrate_score)(args)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest="stage", required=True)

    snapshot_parser = sub.add_parser(
        "snapshot", help="freeze production's retrieval contexts"
    )
    snapshot_parser.add_argument(
        "--passages",
        type=int,
        default=CHUNK_LIMIT,
        help="how many passages to retrieve per question (production uses "
        f"{CHUNK_LIMIT}); a wider budget is written to its own snapshot file",
    )
    snapshot_parser.set_defaults(func=snapshot)

    run_parser = sub.add_parser("run", help="generate, judge, and report")
    run_parser.add_argument("--models", default=DEFAULT_MODELS)
    run_parser.add_argument("--judges", default=DEFAULT_JUDGES)
    run_parser.add_argument("--run-dir", default="/tmp/answer-eval")
    run_parser.set_defaults(func=run)

    cal_parser = sub.add_parser(
        "calibrate",
        help="hand-score a sample and measure each judge against it (#878)",
    )
    cal_parser.add_argument(
        "--emit",
        action="store_true",
        help="write blind worksheets to hand-score, instead of scoring the judges",
    )
    cal_parser.add_argument("--models", default=DEFAULT_MODELS)
    cal_parser.add_argument("--judges", default=DEFAULT_JUDGES)
    cal_parser.add_argument("--run-dir", default="/tmp/answer-eval")
    cal_parser.set_defaults(func=calibrate)

    args = parser.parse_args()
    args.func(args)


if __name__ == "__main__":
    main()
