"""Classify a free-form Ask query into the view/intent that should handle it.

Owns only the classification step; downstream rendering/retrieval is out of
scope. Mirrors the OpenAI conventions in ``api/routers/me.py``
(``synthesize_grounded_answer``): the Responses API, ``output_text``/``output``
extraction, ``OPENAI_API_KEY`` gating, 502 handling, and a deterministic
offline fallback like ``pipeline.rag_ingest._build_embeddings``.
"""

from __future__ import annotations

import json
import os
import re
from dataclasses import dataclass
from enum import Enum

import requests

from fastapi import HTTPException


class AskIntent(str, Enum):
    """The answer path that should handle an Ask query.

    The five intents mirror the answer scenarios in
    ``docs/grounded-ask-spec.md`` §4.1 (Question router) 1:1.
    """

    BILL_TEXT = "bill_text"  # scenario 1 — single-bill RAG answer with citations
    TOPIC_BILLS = "topic_bills"  # scenario 2 — cited list of bills on a topic
    TOPIC_LEGISLATORS = "topic_legislators"  # scenario 3 — legislators by authorship
    LEGISLATOR_VOTE = "legislator_vote"  # scenario 4 — vote question (v1: deflection)
    REFUSE = "refuse"  # scenario 5 — out of scope; refuse naming what we cover


# Whether acting on an intent requires auth. Classification itself is
# anonymous; this lets the caller gate the next step without re-deriving policy.
# All five v1 answer paths are anonymous — auth gates only the follow-up
# composer on the answer page (docs/grounded-ask-spec.md §9.1).
INTENT_AUTH_REQUIRED: dict[AskIntent, bool] = {
    AskIntent.BILL_TEXT: False,
    AskIntent.TOPIC_BILLS: False,
    AskIntent.TOPIC_LEGISLATORS: False,
    AskIntent.LEGISLATOR_VOTE: False,
    AskIntent.REFUSE: False,
}


ROUTER_SYSTEM_PROMPT = (
    "You route questions for a Minnesota state legislature assistant into exactly "
    "one intent. Always choose the single closest match — never hedge, never "
    "explain, never return more than one.\n\n"
    "Intents:\n"
    "- bill_text: a question about what one specific bill or law says or does, "
    "answerable from that bill's text "
    '(e.g. "What\'s in the cannabis legalization bill?", an HF/SF number, or a '
    "recognizable bill title).\n"
    "- topic_bills: a request to list or survey bills or laws on a topic, "
    'including broad "what has been done about X" questions that span multiple '
    'bills (e.g. "What bills affect healthcare?").\n'
    "- topic_legislators: a question about which legislators work on, author, or "
    'support a topic (e.g. "Which legislators support affordable housing?").\n'
    "- legislator_vote: a question about how a legislator, chamber, or body voted "
    '(e.g. "How did my legislator vote on cannabis?").\n'
    "- refuse: anything Alethical does not cover — federal legislation, Minnesota "
    'Statutes lookups, opinion or prediction ("is this bill good?"), or anything '
    "not about Minnesota legislation, politics, or civic process.\n"
)


# (question, intent) pairs steering the boundary cases. Broad cross-bill
# questions route to topic_bills, never a prose answer (docs/grounded-ask-spec.md
# §2 scenario 1; cross-bill synthesis is #87).
FEW_SHOT_EXAMPLES: list[tuple[str, AskIntent]] = [
    ("What's in the cannabis legalization bill?", AskIntent.BILL_TEXT),
    ("What's in the new social media law for kids?", AskIntent.BILL_TEXT),
    ("And what about the Senate version?", AskIntent.BILL_TEXT),
    ("What has Minnesota done to make housing more affordable?", AskIntent.TOPIC_BILLS),
    ("What bills have impacted housing?", AskIntent.TOPIC_BILLS),
    ("What bills affect healthcare?", AskIntent.TOPIC_BILLS),
    ("List the laws passed on paid leave.", AskIntent.TOPIC_BILLS),
    ("Which legislators support affordable housing?", AskIntent.TOPIC_LEGISLATORS),
    ("How did my legislator vote on cannabis?", AskIntent.LEGISLATOR_VOTE),
    ("Write me a poem about my cat.", AskIntent.REFUSE),
    ("What does federal law say about student loans?", AskIntent.REFUSE),
]


# JSON schema forcing one known label. ``confidence`` is logging-only.
_RESPONSE_SCHEMA = {
    "type": "object",
    "properties": {
        "intent": {"type": "string", "enum": [intent.value for intent in AskIntent]},
        "confidence": {"type": "number", "minimum": 0, "maximum": 1},
    },
    "required": ["intent"],
    "additionalProperties": False,
}


@dataclass(frozen=True)
class AskClassification:
    intent: AskIntent
    auth_required: bool
    source: str  # "llm" | "fallback"
    confidence: float | None = None


def _classification(
    intent: AskIntent, *, source: str, confidence: float | None = None
) -> AskClassification:
    return AskClassification(
        intent=intent,
        auth_required=INTENT_AUTH_REQUIRED[intent],
        source=source,
        confidence=confidence,
    )


# Fallback bill-list signals, scoped to bills/laws. The fallback only emits
# BILL_TEXT or TOPIC_BILLS — a regex should never refuse a user or promise the
# vote/legislator paths; those need the LLM.
_TOPIC_BILLS_PATTERNS = [
    re.compile(r"^\s*(what|which)\b.*\b(bills?|laws?|statutes?)\b", re.IGNORECASE),
    re.compile(
        r"\b(list|show me|show all|all of the|which ones)\b.*\b(bills?|laws?)\b",
        re.IGNORECASE,
    ),
]


def _heuristic_fallback(question: str) -> AskClassification:
    """Offline classification for tests / missing API key."""
    for pattern in _TOPIC_BILLS_PATTERNS:
        if pattern.search(question):
            return _classification(AskIntent.TOPIC_BILLS, source="fallback")
    return _classification(AskIntent.BILL_TEXT, source="fallback")


def _extract_response_json(payload: dict) -> dict | None:
    """Pull the model's JSON object out of a Responses API payload."""
    text_value = payload.get("output_text")
    candidates: list[str] = []
    if isinstance(text_value, str) and text_value.strip():
        candidates.append(text_value.strip())

    output = payload.get("output")
    if isinstance(output, list):
        for item in output:
            if not isinstance(item, dict):
                continue
            content = item.get("content")
            if not isinstance(content, list):
                continue
            for content_item in content:
                if not isinstance(content_item, dict):
                    continue
                text = content_item.get("text")
                if isinstance(text, str) and text.strip():
                    candidates.append(text.strip())

    for candidate in candidates:
        try:
            parsed = json.loads(candidate)
        except (ValueError, TypeError):
            continue
        if isinstance(parsed, dict):
            return parsed
    return None


def classify_query(question: str) -> AskClassification:
    """Classify a free-form Ask query into a single :class:`AskIntent`."""
    api_key = os.environ.get("OPENAI_API_KEY")
    if not api_key:
        return _heuristic_fallback(question)

    model = os.environ.get("OPENAI_ASK_ROUTER_MODEL", "gpt-4o-mini")
    example_lines = "\n".join(
        f"- {text!r} -> {intent.value}" for text, intent in FEW_SHOT_EXAMPLES
    )
    try:
        response = requests.post(
            "https://api.openai.com/v1/responses",
            headers={
                "Authorization": f"Bearer {api_key}",
                "Content-Type": "application/json",
            },
            json={
                "model": model,
                "input": [
                    {
                        "role": "system",
                        "content": f"{ROUTER_SYSTEM_PROMPT}\nExamples:\n{example_lines}",
                    },
                    {"role": "user", "content": question},
                ],
                "text": {
                    "format": {
                        "type": "json_schema",
                        "name": "ask_intent",
                        "strict": True,
                        "schema": _RESPONSE_SCHEMA,
                    }
                },
            },
            timeout=30,
        )
        response.raise_for_status()
        parsed = _extract_response_json(response.json())
    except requests.RequestException as exc:
        raise HTTPException(
            status_code=502, detail="OpenAI ask-router classification failed"
        ) from exc

    if not parsed:
        raise HTTPException(
            status_code=502,
            detail="OpenAI ask-router classification returned no usable result",
        )

    try:
        intent = AskIntent(parsed.get("intent"))
    except ValueError as exc:
        raise HTTPException(
            status_code=502,
            detail="OpenAI ask-router classification returned an unknown intent",
        ) from exc

    confidence = parsed.get("confidence")
    if not isinstance(confidence, (int, float)):
        confidence = None

    return _classification(
        intent,
        source="llm",
        confidence=float(confidence) if confidence is not None else None,
    )
