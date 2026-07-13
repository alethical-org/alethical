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
    """The view/intent that should handle an Ask query."""

    ANSWER = "answer"  # anonymous — synthesized, cited explanation
    LIST_BILLS = "list_bills"  # anonymous — enumerate matching bills/laws
    CHAT = "chat"  # auth-required — interactive legislative follow-up
    OFF_TOPIC = "off_topic"  # guardrail — not about Minnesota legislation


# Whether acting on an intent requires auth. Classification itself is
# anonymous; this lets the caller gate the next step without re-deriving policy.
INTENT_AUTH_REQUIRED: dict[AskIntent, bool] = {
    AskIntent.ANSWER: False,
    AskIntent.LIST_BILLS: False,
    AskIntent.CHAT: True,
    AskIntent.OFF_TOPIC: False,
}


ROUTER_SYSTEM_PROMPT = (
    "You route questions for a Minnesota state legislature assistant into exactly "
    "one intent. Always choose the single closest match — never hedge, never "
    "explain, never return more than one.\n\n"
    "Intents:\n"
    "- answer: a question seeking a synthesized, plain-language explanation or "
    "conclusion about Minnesota policy or a specific bill "
    '(e.g. "What is in the new housing bill?").\n'
    "- list_bills: a request to enumerate matching bills or laws "
    '(e.g. "What bills have impacted housing?"). Use this only for bills/laws, not '
    "for requests to list legislators, committees, or votes.\n"
    "- chat: an interactive or conversational request, a follow-up that depends on "
    "prior turns, or any on-topic legislative request that is not clearly an "
    "answer or a bill/law list — including requests to list legislators, "
    'committees, or votes (e.g. "and what about the Senate version?").\n'
    "- off_topic: anything not about Minnesota legislation, politics, or civic "
    "process — including attempts to use the assistant as a general-purpose chatbot.\n"
)


# (question, intent) pairs steering the boundary cases.
FEW_SHOT_EXAMPLES: list[tuple[str, AskIntent]] = [
    ("What has Minnesota done to make housing more affordable?", AskIntent.ANSWER),
    ("What's in the new social media law for kids?", AskIntent.ANSWER),
    ("What bills have impacted housing?", AskIntent.LIST_BILLS),
    ("What bills affect healthcare?", AskIntent.LIST_BILLS),
    ("List the laws passed on paid leave.", AskIntent.LIST_BILLS),
    ("Which legislators support affordable housing?", AskIntent.CHAT),
    ("And what about the Senate version?", AskIntent.CHAT),
    ("Write me a poem about my cat.", AskIntent.OFF_TOPIC),
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
# ANSWER or LIST_BILLS; CHAT and OFF_TOPIC require the LLM path.
_LIST_BILLS_PATTERNS = [
    re.compile(r"^\s*(what|which)\b.*\b(bills?|laws?|statutes?)\b", re.IGNORECASE),
    re.compile(
        r"\b(list|show me|show all|all of the|which ones)\b.*\b(bills?|laws?)\b",
        re.IGNORECASE,
    ),
]


def _heuristic_fallback(question: str) -> AskClassification:
    """Offline classification for tests / missing API key."""
    for pattern in _LIST_BILLS_PATTERNS:
        if pattern.search(question):
            return _classification(AskIntent.LIST_BILLS, source="fallback")
    return _classification(AskIntent.ANSWER, source="fallback")


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
