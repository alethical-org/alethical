"""Repeat visits to public, bill-suggested Ask questions reuse one answer."""

from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor
import json
import time

import pytest
from sqlalchemy import delete, func, select

from alethical.api.services.ask_router import AskClassification, AskIntent
from alethical.db.schema import load_schema
from alethical.db.session import get_session_factory

schema = load_schema()
AskSuggestedAnswerCache = schema.AskSuggestedAnswerCache


@pytest.fixture(autouse=True)
def empty_suggested_answer_cache(seed_database):
    """Each case starts with no saved answer and leaves none for another case."""
    with get_session_factory()() as db:
        db.execute(delete(AskSuggestedAnswerCache))
        db.commit()
    yield
    with get_session_factory()() as db:
        db.execute(delete(AskSuggestedAnswerCache))
        db.commit()


def test_predefined_bill_question_generates_once(client, monkeypatch):
    question = "SF 2483: How is student financial aid changing?"
    generated: list[str] = []

    def fake_synthesis(*args, **kwargs):
        generated.append(question)
        return f"Generated answer {len(generated)}."

    monkeypatch.setattr(
        "alethical.api.routers.ask.synthesize_grounded_answer", fake_synthesis
    )
    monkeypatch.setattr(
        "alethical.api.routers.ask.classify_query",
        lambda *args, **kwargs: (_ for _ in ()).throw(
            AssertionError("a proven public suggestion must skip classification")
        ),
    )

    first = client.post("/api/v1/ask", json={"content": question})
    second = client.post("/api/v1/ask", json={"content": question})

    assert first.status_code == 200
    assert second.status_code == 200
    assert first.json()["data"]["answer"] == second.json()["data"]["answer"]
    assert len(generated) == 1

    with get_session_factory()() as db:
        row = db.scalar(select(AskSuggestedAnswerCache))
        assert row is not None
        assert question not in json.dumps(row.answer_payload)


def test_reader_written_question_is_never_saved(client, monkeypatch):
    questions = (
        "SF 2483: What would this change for a student?",
        "Please explain SF 2483: How is student financial aid changing?",
    )
    generated: list[str] = []

    monkeypatch.setattr(
        "alethical.api.routers.ask.classify_query",
        lambda *args, **kwargs: AskClassification(
            intent=AskIntent.BILL_TEXT,
            auth_required=False,
            source="test",
            confidence=1.0,
        ),
    )

    def fake_synthesis(*args, **kwargs):
        generated.append(args[0])
        return f"Reader answer {len(generated)}."

    monkeypatch.setattr(
        "alethical.api.routers.ask.synthesize_grounded_answer", fake_synthesis
    )

    first = client.post("/api/v1/ask", json={"content": questions[0]})
    second = client.post("/api/v1/ask", json={"content": questions[0]})
    altered_prefix = client.post("/api/v1/ask", json={"content": questions[1]})

    assert first.status_code == second.status_code == altered_prefix.status_code == 200
    assert len(generated) == 3
    assert first.json()["data"]["answer"] != second.json()["data"]["answer"]
    with get_session_factory()() as db:
        assert db.scalar(select(func.count()).select_from(AskSuggestedAnswerCache)) == 0


def test_prompt_or_answer_model_change_generates_a_fresh_answer(client, monkeypatch):
    question = "SF 2483: How is student financial aid changing?"
    generated: list[str] = []
    prompt_fingerprint = "prompt-a"

    monkeypatch.setenv("OPENAI_RAG_CHAT_MODEL", "model-a")
    monkeypatch.setattr(
        "alethical.api.routers.ask.rag_chat_prompt_fingerprint",
        lambda: prompt_fingerprint,
    )

    def fake_synthesis(*args, **kwargs):
        generated.append(question)
        return f"Versioned answer {len(generated)}."

    monkeypatch.setattr(
        "alethical.api.routers.ask.synthesize_grounded_answer", fake_synthesis
    )

    assert client.post("/api/v1/ask", json={"content": question}).status_code == 200
    monkeypatch.setenv("OPENAI_RAG_CHAT_MODEL", "model-b")
    assert client.post("/api/v1/ask", json={"content": question}).status_code == 200
    prompt_fingerprint = "prompt-b"
    assert client.post("/api/v1/ask", json={"content": question}).status_code == 200

    assert len(generated) == 3


@pytest.mark.parametrize(
    "prompt_part", ("RAG_CHAT_SYSTEM_PROMPT", "RAG_CHAT_USER_PROMPT_TEMPLATE")
)
def test_prompt_fingerprint_tracks_every_prompt_part(monkeypatch, prompt_part):
    import alethical.api.routers.me as me

    before = me.rag_chat_prompt_fingerprint()
    monkeypatch.setattr(me, prompt_part, getattr(me, prompt_part) + " changed")
    assert me.rag_chat_prompt_fingerprint() != before


def test_simultaneous_first_visits_generate_once(client, monkeypatch):
    question = "SF 2483: How is student financial aid changing?"
    generated: list[str] = []

    def slow_synthesis(*args, **kwargs):
        generated.append(question)
        time.sleep(0.2)
        return "One shared answer."

    monkeypatch.setattr(
        "alethical.api.routers.ask.synthesize_grounded_answer", slow_synthesis
    )

    def request_answer(_):
        return client.post("/api/v1/ask", json={"content": question})

    with ThreadPoolExecutor(max_workers=2) as pool:
        responses = list(pool.map(request_answer, range(2)))

    assert [response.status_code for response in responses] == [200, 200]
    assert (
        responses[0].json()["data"]["answer"] == responses[1].json()["data"]["answer"]
    )
    assert len(generated) == 1
