"""Offline A/B runner.

Calls the real production functions in
``alethical.api.routers.legislator_chat`` directly -- retrieval
(``retrieve_relevant_bills``), prompt formatting (``format_record_context``,
``SYSTEM_PROMPT_TEMPLATE``), citation verification (``verify_citations``),
and answer parsing (``parse_answer``) are all the actual, unmodified
production code, imported and called, not reimplemented. The only thing this
module adds is the HTTP-call wrapper itself (mirroring
``synthesize_legislator_answer``'s ~15 lines) so it can inject the Condition
B style addendum into the system prompt before the call -- production's
``synthesize_legislator_answer`` builds its system prompt internally and has
no seam for that, and the task explicitly said not to touch the production
prompt, so rather than add one, this module composes the same prompt string
outside it and posts it itself.

Two run modes:

* ``mode="live"`` -- a real call to the OpenAI Responses API. Requires
  ``OPENAI_API_KEY``. This is what the pilot needs to produce results that
  say anything about the actual persona.
* ``mode="mock"`` -- a deterministic, condition-aware stub responder (no
  network call), for exercising the harness end to end when no key is
  available. Every mock run is labeled as such in ``RunRecord`` and in the
  report; nothing here presents a mock response as real model behavior.

A run that raises records the error on that ``RunRecord`` (``error`` field)
and moves on to the next case -- it never retries by silently falling back
to the other condition or reusing a cached result, per the task's explicit
"do not silently retry into a different experimental condition."
"""

from __future__ import annotations

import hashlib
import os
import time
import uuid
from dataclasses import dataclass

import requests

from alethical.api.routers.legislator_chat import (
    LEGISLATOR_CHAT_REFUSAL,
    SYSTEM_PROMPT_TEMPLATE,
    extract_openai_response_text,
    format_record_context,
    load_legislator_bills,
    parse_answer,
    retrieve_relevant_bills,
    verify_citations,
)
from alethical.eval.persona_benchmark.data_model import (
    BenchmarkCase,
    ConversationCase,
    GroundTruth,
    RunRecord,
)
from alethical.eval.persona_benchmark.prompts import style_addendum
from alethical.eval.persona_benchmark.style_exemplars import corpus_for

PROMPT_VERSION = hashlib.sha256(SYSTEM_PROMPT_TEMPLATE.encode()).hexdigest()[:12]


@dataclass
class ModelConfig:
    model: str = "gpt-4o-mini"
    temperature: float | None = None  # OpenAI Responses API default when unset

    def params(self) -> dict:
        d = {"model": self.model}
        if self.temperature is not None:
            d["temperature"] = self.temperature
        return d


def _build_system_prompt(
    legislator_name: str, record_context: str, *, condition: str
) -> tuple[str, tuple[str, ...]]:
    """The real production prompt, plus Condition B's addendum. Returns
    (system_prompt, exemplar_texts_used) so the caller can log exactly what
    was injected."""
    base = SYSTEM_PROMPT_TEMPLATE.format(
        legislator_name=legislator_name,
        refusal=LEGISLATOR_CHAT_REFUSAL,
        record_context=record_context,
    )
    if condition == "A":
        return base, ()
    corpus = corpus_for(str(_current_legislator_id[0]))
    addendum = style_addendum(legislator_name, corpus)
    if not addendum:
        return base, ()
    exemplars_used = tuple(q.text for q in corpus.exemplars) if corpus else ()
    return base + addendum, exemplars_used


# Thread-unsafe by design (single-process offline batch runner, matching the
# rest of this package) -- a one-slot holder so _build_system_prompt can look
# up the style corpus without threading legislator_id through every call site.
_current_legislator_id: list = [None]


def _call_openai_live(system_prompt: str, history_messages: list[dict], question: str, cfg: ModelConfig) -> tuple[str, dict]:
    api_key = os.environ["OPENAI_API_KEY"]
    input_messages = [{"role": "system", "content": system_prompt}, *history_messages, {"role": "user", "content": question}]
    response = requests.post(
        "https://api.openai.com/v1/responses",
        headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
        json={**cfg.params(), "input": input_messages},
        timeout=30,
    )
    response.raise_for_status()
    payload = response.json()
    text_value = extract_openai_response_text(payload)
    if not text_value:
        raise RuntimeError("OpenAI returned no answer text")
    usage = payload.get("usage") or {}
    return text_value, {
        "input_tokens": usage.get("input_tokens"),
        "output_tokens": usage.get("output_tokens"),
    }


def _call_mock(system_prompt: str, history_messages: list[dict], question: str, cfg: ModelConfig, *, condition: str, bill_by_key: dict) -> tuple[str, dict]:
    """Deterministic stand-in so the harness is fully exercisable with no
    OPENAI_API_KEY. Grounds its stub answer in whatever the real
    ``record_context``/retrieval already narrowed things to -- it echoes the
    first retrieved bill key as a SOURCES line so the parsing/verification
    path downstream (``parse_answer``, ``verify_citations``) has something
    real to operate on, exactly as it would with an actual model response.
    This is NOT a claim about what a real model would say -- every RunRecord
    produced this way is flagged and the report never treats it as a
    persona-quality result."""
    keys = list(bill_by_key.keys())
    if not keys or "no public record" in system_prompt.lower() and not keys:
        return LEGISLATOR_CHAT_REFUSAL, {}
    key = keys[0]
    style_hint = "STYLE" if "STYLE REFERENCE" in system_prompt else "PLAIN"
    text = (
        f"[MOCK-{condition}-{style_hint}] Here's my take on that, based on what I've worked "
        f"on: {question.strip().rstrip('?')}.\nSOURCES: {key}"
    )
    return text, {}


def run_case(
    db,
    case: BenchmarkCase,
    condition: str,
    legislator_name: str,
    *,
    mode: str = "mock",
    cfg: ModelConfig | None = None,
    history_messages: list[dict] | None = None,
) -> RunRecord:
    cfg = cfg or ModelConfig()
    history_messages = history_messages or []
    legislator_id = uuid.UUID(case.legislator_id)
    _current_legislator_id[0] = legislator_id

    bills = load_legislator_bills(db, legislator_id)
    bill_by_key = {b.bill_key: b for b in bills}
    retrieved = retrieve_relevant_bills(case.prompt, bills)
    record_context = format_record_context(retrieved)
    system_prompt, exemplars_used = _build_system_prompt(
        legislator_name, record_context, condition=condition
    )

    start = time.monotonic()
    error = None
    raw_answer = ""
    token_meta: dict = {}
    try:
        if mode == "live":
            raw_answer, token_meta = _call_openai_live(system_prompt, history_messages, case.prompt, cfg)
        elif mode == "mock":
            raw_answer, token_meta = _call_mock(
                system_prompt, history_messages, case.prompt, cfg,
                condition=condition, bill_by_key=bill_by_key,
            )
        else:
            raise ValueError(f"unknown mode {mode!r}")
    except Exception as exc:  # noqa: BLE001 -- recorded, never retried into another condition
        error = f"{type(exc).__name__}: {exc}"
    latency = time.monotonic() - start

    if error is not None:
        return RunRecord(
            condition=condition, case_id=case.case_id, legislator_id=case.legislator_id,
            model=cfg.model, model_params=cfg.params(), prompt_version=PROMPT_VERSION,
            style_exemplars_used=exemplars_used,
            retrieved_bill_keys=tuple(b.bill_key for b in retrieved),
            raw_response="", answer_text="", citations=(), dropped_citations=(),
            was_refusal=False, latency_seconds=latency, error=error,
        )

    answer_text, citations = parse_answer(raw_answer, bill_by_key)
    was_refusal = answer_text.strip() == LEGISLATOR_CHAT_REFUSAL
    if not was_refusal and not citations:
        answer_text = LEGISLATOR_CHAT_REFUSAL
        was_refusal = True
        citations = []
        dropped: list = []
    elif was_refusal:
        citations = []
        dropped = []
    else:
        had_citations = bool(citations)
        citations, dropped = verify_citations(answer_text, citations, bill_by_key)
        if had_citations and not citations:
            answer_text = LEGISLATOR_CHAT_REFUSAL
            was_refusal = True

    return RunRecord(
        condition=condition, case_id=case.case_id, legislator_id=case.legislator_id,
        model=cfg.model, model_params=cfg.params(), prompt_version=PROMPT_VERSION,
        style_exemplars_used=exemplars_used,
        retrieved_bill_keys=tuple(b.bill_key for b in retrieved),
        raw_response=raw_answer, answer_text=answer_text,
        citations=tuple(citations), dropped_citations=tuple(dropped),
        was_refusal=was_refusal, latency_seconds=latency,
        input_tokens=token_meta.get("input_tokens"), output_tokens=token_meta.get("output_tokens"),
    )


def run_conversation(
    db, conversation: ConversationCase, condition: str, legislator_name: str,
    *, mode: str = "mock", cfg: ModelConfig | None = None,
) -> list[RunRecord]:
    """Runs every turn in order, threading real prior turns into ``history_messages``
    exactly as ``create_message`` does (user then assistant per turn), so
    turn N actually sees turns 1..N-1 -- required for the paraphrase/challenge/
    false-premise/return-to-topic stress turns to mean anything."""
    records: list[RunRecord] = []
    history_messages: list[dict] = []
    for turn in conversation.turns:
        pseudo_case = BenchmarkCase(
            case_id=f"{conversation.conversation_id}-turn{turn.turn_id}",
            family="interactive_consistency",
            category=turn.stress_type,
            legislator_id=conversation.legislator_id,
            prompt=turn.prompt,
            ground_truth=GroundTruth(kind="none"),
            expects_refusal=False,
            false_premise=turn.false_premise,
        )
        record = run_case(
            db, pseudo_case, condition, legislator_name,
            mode=mode, cfg=cfg, history_messages=list(history_messages),
        )
        records.append(record)
        history_messages.append({"role": "user", "content": turn.prompt})
        history_messages.append({"role": "assistant", "content": record.answer_text or ""})
    return records
