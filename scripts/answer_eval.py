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

  run        Generate an answer per (model, question) from the snapshot, have the
             judges score them blind, and print the scorecards. Results cache to
             the run directory per model and per judge, so re-running is cheap and
             a new candidate can be added without re-paying for the old ones.

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
import json
import os
import random
import threading
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

import requests
from sqlalchemy import create_engine, select, text
from sqlalchemy.orm import Session

from alethical.api.routers.me import RAG_CHAT_SYSTEM_PROMPT, build_query_embedding
from alethical.db.schema import load_schema
from alethical.db.session import NO_PREPARED_STATEMENTS, database_url_for_target
from alethical.eval.answer_eval import (
    GRADED_DIMENSIONS,
    AnswerQuery,
    AnswerResult,
    JudgeVerdict,
    aggregate,
    cost_per_answer,
    declines,
    judge_disagreement,
    literal_fact_coverage,
    load_fixture,
    meets_bar,
    opens_with_bill_code,
    statute_citations,
)
from alethical.pipeline.rag_ingest import DEFAULT_RAG_MODEL, effective_embedding_model

REPO = Path(__file__).resolve().parents[1]
FIXTURE = REPO / "alethical/eval/fixtures/answer_questions.json"
CONTEXTS = REPO / "alethical/eval/fixtures/answer_contexts.json"

# Mirrors ask.py: _BILL_TEXT_CHUNK_LIMIT (the passages the writer is given) and
# the HNSW beam width the request sets. Keep these in step with ask.py or the
# eval stops measuring production's writer.
CHUNK_LIMIT = 4
EF_SEARCH = 100

# Latency budget, argued in the quality-bar doc. The reader is waiting, and the
# API does not stream, so total generation time is what they experience.
P50_SECONDS = 5.0
P95_SECONDS = 9.0

# Judges run concurrently (see judge_all). Kept modest so a run does not trip
# either provider's rate limits, which would cost more time than it saves.
JUDGE_CONCURRENCY = 8

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


# --- snapshot: freeze production's retrieval so every model sees one context ---


def snapshot(args) -> None:
    schema = load_schema()
    Bill = schema.Bill
    engine = create_engine(
        database_url_for_target(os.environ.get("ALETHICAL_DATABASE_TARGET")),
        connect_args=NO_PREPARED_STATEMENTS,
    )
    queries = load_fixture(FIXTURE)
    model = effective_embedding_model(DEFAULT_RAG_MODEL)
    out: dict[str, dict] = {}

    with Session(engine) as db:
        db.execute(text(f"SET LOCAL hnsw.ef_search = {EF_SEARCH}"))
        for q in queries:
            bill = db.scalar(select(Bill).where(Bill.bill_key == q.bill_key))
            if bill is None:
                raise SystemExit(f"{q.bill_key} is not in this database")
            chunks = db.scalars(
                schema.semantic_rag_chunk_stmt(
                    build_query_embedding(q.question),
                    bill_id=bill.id,
                    embedding_model=model,
                    limit=CHUNK_LIMIT,
                )
            ).all()
            if not chunks:
                raise SystemExit(f"{q.bill_key} has no retrievable passages")
            out[q.key] = {
                "question": q.question,
                "bill_key": q.bill_key,
                "bill_title": bill.title,
                "chunks": [
                    {"citation_label": c.citation_label, "chunk_text": c.chunk_text}
                    for c in chunks
                ],
            }
            print(
                f"  {q.bill_key}  {len(out[q.key]['chunks'])} passages  {q.question[:60]}"
            )

    CONTEXTS.write_text(
        json.dumps(
            {
                "description": (
                    "Frozen retrieval contexts for the answer-quality eval (#865). "
                    "Produced by `scripts/answer_eval.py snapshot` read-only against "
                    "production, replicating ask.py's per-bill passage retrieval "
                    f"(limit {CHUNK_LIMIT}, hnsw.ef_search {EF_SEARCH}). Committed so "
                    "every model is written from identical passages and the eval runs "
                    "without a database."
                ),
                "contexts": out,
            },
            indent=2,
        )
        + "\n"
    )
    print(f"\nwrote {len(out)} contexts to {CONTEXTS.relative_to(REPO)}")


def load_contexts() -> dict[str, dict]:
    return json.loads(CONTEXTS.read_text())["contexts"]


# --- generation: production's exact prompt, one provider adapter per family ---

# Production's own instruction, imported rather than copied. The eval must move
# the model and nothing else, so a change to the live prompt reaches the eval
# automatically instead of leaving it scoring a prompt we no longer ship.
SYSTEM_PROMPT = RAG_CHAT_SYSTEM_PROMPT


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


def parse_spec(spec: str) -> tuple[str, str, bool]:
    """``provider:model`` → (provider, model, deep=False); a ``+deep`` suffix flips it.

    Reasoning depth is part of the candidate's identity, not a hidden default: the
    same model reasoning or not is two different products to a waiting reader, and
    both deserve their own row in the report.
    """
    base, _, suffix = spec.partition("+")
    if suffix not in ("", "deep"):
        raise SystemExit(f"unknown suffix {suffix!r} in {spec!r} (only '+deep')")
    provider, _, model = base.partition(":")
    if provider not in ("openai", "anthropic"):
        raise SystemExit(
            f"unknown provider in {spec!r} (expected openai: or anthropic:)"
        )
    return provider, model, suffix == "deep"


def call_model(spec: str, system: str, user: str) -> tuple[str, float, float, int, int]:
    provider, model, deep = parse_spec(spec)
    if provider == "openai":
        return _openai_answer(model, system, user, deep=deep)
    return _anthropic_answer(model, system, user, deep=deep)


def generate(
    spec: str, queries: list[AnswerQuery], contexts: dict, cache: Path
) -> dict:
    if cache.exists():
        return json.loads(cache.read_text())
    answers = {}
    for q in queries:
        context = contexts[q.key]
        answer, ttft, total, tin, tout = call_model(
            spec, SYSTEM_PROMPT, build_user_prompt(context)
        )
        answers[q.key] = {
            "answer": answer,
            "seconds_to_first_token": ttft,
            "seconds_total": total,
            "input_tokens": tin,
            "output_tokens": tout,
        }
        print(f"    {total:5.2f}s  {q.bill_key:16s} {q.question[:52]}")
    cache.write_text(json.dumps(answers, indent=2) + "\n")
    return answers


# --- judging: blind, label-anchored, and run by two judges from rival families ---

JUDGE_SYSTEM = """You are grading one answer written by an AI assistant for a \
Minnesota legislative-transparency product used by ordinary residents.

You are given the exact bill passages the writer was shown, the question, and a \
human-written answer key. Grade against the key and the passages — not against \
your own taste, and not against how you would have phrased it. You do not know \
which model wrote the answer and must not speculate.

Return ONLY a JSON object with these keys:
  "grounded":  true only if EVERY factual claim in the answer is supported by the \
passages shown. A single unsupported number, name, date, or effect makes this false.
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
  "plain":     0, 1, or 2 — could a resident with no legal training follow it? \
Deduct for statute citations, legalese, a bill-number preamble, and for a bare \
list where a sentence was needed. Do not reward length.
  "note":      the single biggest problem, in at most 20 words, or "" if none.

Output the JSON object and nothing else. No preamble, no code fence.
"""


def build_judge_prompt(q: AnswerQuery, context: dict, answer: str) -> str:
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
        "covers": {"type": "integer", "enum": [0, 1, 2]},
        "addresses": {"type": "integer", "enum": [0, 1, 2]},
        "framing": {"type": "integer", "enum": [0, 1, 2]},
        "plain": {"type": "integer", "enum": [0, 1, 2]},
        "note": {"type": "string"},
    },
    "required": ["grounded", "covers", "addresses", "framing", "plain", "note"],
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
    provider, model, _ = parse_spec(spec)
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
    if not isinstance(verdict.get("grounded"), bool):
        raise ValueError(f"'grounded' is not a boolean: {verdict.get('grounded')!r}")
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
    contexts: dict,
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
                q, contexts[q.key], answers_by_model[model_spec][q.key]["answer"]
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


def run(args) -> None:
    queries = load_fixture(FIXTURE)
    contexts = load_contexts()
    missing = [q.key for q in queries if q.key not in contexts]
    if missing:
        raise SystemExit(
            f"no snapshot for {len(missing)} question(s); run `snapshot` first"
        )

    run_dir = Path(args.run_dir)
    run_dir.mkdir(parents=True, exist_ok=True)
    model_specs = [s.strip() for s in args.models.split(",") if s.strip()]
    judge_specs = [s.strip() for s in args.judges.split(",") if s.strip()]

    answers_by_model = {}
    for spec in model_specs:
        print(f"\ngenerating with {spec}")
        answers_by_model[spec] = generate(
            spec, queries, contexts, run_dir / f"answers-{_slug(spec)}.json"
        )

    verdicts_by_judge = {}
    for judge_spec in judge_specs:
        print(f"\njudging with {judge_spec}")
        verdicts_by_judge[judge_spec] = judge_all(
            judge_spec,
            model_specs,
            queries,
            contexts,
            answers_by_model,
            run_dir / f"verdicts-{_slug(judge_spec)}.json",
        )

    results_by_model = {}
    for spec in model_specs:
        results = []
        for q in queries:
            raw = answers_by_model[spec][q.key]
            result = AnswerResult(
                query=q,
                model=spec,
                answer=raw["answer"],
                seconds_to_first_token=raw["seconds_to_first_token"],
                seconds_total=raw["seconds_total"],
                input_tokens=raw["input_tokens"],
                output_tokens=raw["output_tokens"],
            )
            for judge_spec in judge_specs:
                v = verdicts_by_judge[judge_spec][f"{spec}||{q.key}"]
                result.verdicts.append(
                    JudgeVerdict(
                        judge=judge_spec,
                        grounded=bool(v["grounded"]),
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
    results_by_model: dict[str, list[AnswerResult]], judge_specs: list[str]
) -> None:
    print("\n" + "=" * 100)
    print("ANSWER QUALITY — all judges pooled")
    print("=" * 100)
    header = (
        f"{'model':30s} {'score':>6s} {'ship':>6s} {'gate!':>6s} "
        f"{'p50 s':>7s} {'p95 s':>7s} {'$/answer':>10s} {'bar':>5s}"
    )
    print(header)
    for spec, results in results_by_model.items():
        summary = aggregate(results)
        price = PRICES.get(spec)
        dollars = (
            f"${cost_per_answer(summary, input_per_mtok=price[0], output_per_mtok=price[1]):.5f}"
            if price
            else "n/a"
        )
        print(
            f"{spec:30s} {summary['mean_score']:6.2f} "
            f"{summary['ship_worthy_rate']:6.0%} {summary['gate_failure_count']:6d} "
            f"{summary['seconds_total']['p50']:7.2f} {summary['seconds_total']['p95']:7.2f} "
            f"{dollars:>10s} "
            f"{'PASS' if meets_bar(summary, p50_seconds=P50_SECONDS, p95_seconds=P95_SECONDS) else 'fail':>5s}"
        )

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

    print("\n--- gate failures (each one disqualifies a model) ---")
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
        f"{'model':30s} {'code preamble':>14s} {'statute cites':>14s} {'literal facts':>14s}"
    )
    for spec, results in results_by_model.items():
        preamble = sum(1 for r in results if opens_with_bill_code(r.answer))
        cites = sum(len(statute_citations(r.answer)) for r in results)
        hits = totals = 0
        for r in results:
            h, t = literal_fact_coverage(r.query, r.answer)
            hits, totals = hits + h, totals + t
        print(f"{spec:30s} {preamble:14d} {cites:14d} {f'{hits}/{totals}':>14s}")

    print("\n--- refusal behaviour on questions the passages do not cover ---")
    for spec, results in results_by_model.items():
        unanswerable = [r for r in results if not r.query.answerable]
        declined = sum(1 for r in unanswerable if declines(r.answer))
        print(f"{spec:30s} declined {declined}/{len(unanswerable)}")


def _slug(spec: str) -> str:
    return spec.replace(":", "-").replace(".", "_")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest="stage", required=True)

    sub.add_parser(
        "snapshot", help="freeze production's retrieval contexts"
    ).set_defaults(func=snapshot)

    run_parser = sub.add_parser("run", help="generate, judge, and report")
    run_parser.add_argument(
        "--models",
        default="openai:gpt-4o-mini,openai:gpt-5-mini,openai:gpt-5.1,"
        "anthropic:claude-haiku-4-5,anthropic:claude-sonnet-5",
    )
    run_parser.add_argument(
        "--judges", default="anthropic:claude-sonnet-5,openai:gpt-5.1"
    )
    run_parser.add_argument("--run-dir", default="/tmp/answer-eval")
    run_parser.set_defaults(func=run)

    args = parser.parse_args()
    args.func(args)


if __name__ == "__main__":
    main()
