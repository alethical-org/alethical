"""Repeat visits to public, bill-suggested Ask questions reuse one answer."""

from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor
from dataclasses import replace
import json
import time

import pytest
from sqlalchemy import delete, func, select

from alethical.api.routers import ask
from alethical.api.services.ask_router import AskClassification, AskIntent
from alethical.db.schema import load_schema
from alethical.db.session import get_session_factory
from alethical.pipeline import rag as rag_text

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


def test_saved_suggestion_get_is_self_contained_and_publicly_cacheable(
    client, monkeypatch
):
    question = "SF 2483: How is student financial aid changing?"
    monkeypatch.setattr(
        "alethical.api.routers.ask.synthesize_grounded_answer",
        lambda *args, **kwargs: "One saved answer.",
    )
    generated = client.post("/api/v1/ask", json={"content": question})
    assert generated.status_code == 200

    monkeypatch.setattr(
        "alethical.api.routers.ask.synthesize_grounded_answer",
        lambda *args, **kwargs: (_ for _ in ()).throw(
            AssertionError("a saved-answer GET must never generate")
        ),
    )
    monkeypatch.setattr(
        "alethical.api.routers.ask.classify_query",
        lambda *args, **kwargs: (_ for _ in ()).throw(
            AssertionError("a saved-answer GET must never classify")
        ),
    )

    response = client.get("/api/v1/ask/suggestions/94-2025-SF2483/0")

    assert response.status_code == 200
    assert "public" in response.headers["cache-control"]
    payload = response.json()["data"]
    answer = payload["answer"]
    assert payload["intent"] == "bill_text"
    assert payload["source"] == "predefined"
    assert answer["question"] == question
    assert answer["bill"]["id"] == "94-2025-SF2483"
    assert answer["bill"]["ai_analysis"]["question_prompts"]
    assert isinstance(answer["bill"]["stats"]["vote_event_count"], int)
    assert answer["bill_last_pulled_at"] is not None
    assert answer["citations"]
    assert all(
        isinstance(citation["section_available"], bool)
        for citation in answer["citations"]
    )


def test_saved_suggestion_get_miss_never_generates_or_saves(client, monkeypatch):
    monkeypatch.setattr(
        "alethical.api.routers.ask.synthesize_grounded_answer",
        lambda *args, **kwargs: (_ for _ in ()).throw(
            AssertionError("a saved-answer miss must never generate")
        ),
    )
    monkeypatch.setattr(
        "alethical.api.routers.ask.classify_query",
        lambda *args, **kwargs: (_ for _ in ()).throw(
            AssertionError("a saved-answer miss must never classify")
        ),
    )

    response = client.get("/api/v1/ask/suggestions/94-2025-SF2483/0")

    assert response.status_code == 404
    assert response.headers["cache-control"] == "no-store"
    with get_session_factory()() as db:
        assert db.scalar(select(func.count()).select_from(AskSuggestedAnswerCache)) == 0


def test_saved_suggestion_get_rejects_reader_text(client, monkeypatch):
    monkeypatch.setattr(
        "alethical.api.routers.ask.synthesize_grounded_answer",
        lambda *args, **kwargs: (_ for _ in ()).throw(
            AssertionError("reader text must not enter the saved-answer GET")
        ),
    )

    response = client.get(
        "/api/v1/ask/suggestions/94-2025-SF2483/0",
        params={"q": "private reader question"},
    )

    assert response.status_code == 400
    assert response.headers["cache-control"] == "no-store"
    assert "private reader question" not in response.text
    with get_session_factory()() as db:
        assert db.scalar(select(func.count()).select_from(AskSuggestedAnswerCache)) == 0


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


def test_chunking_version_change_generates_a_fresh_answer(client, monkeypatch):
    question = "SF 2483: How is student financial aid changing?"
    generated: list[str] = []

    def fake_synthesis(*args, **kwargs):
        generated.append(question)
        return f"Chunked answer {len(generated)}."

    monkeypatch.setattr(
        "alethical.api.routers.ask.synthesize_grounded_answer", fake_synthesis
    )

    assert client.post("/api/v1/ask", json={"content": question}).status_code == 200
    monkeypatch.setattr(rag_text, "CHUNKING_VERSION", "changed-for-test")
    assert client.post("/api/v1/ask", json={"content": question}).status_code == 200

    assert len(generated) == 2


def test_answer_pipeline_fingerprint_tracks_retrieval_code_version(monkeypatch):
    before = ask._suggested_answer_pipeline_fingerprint()
    monkeypatch.setattr(ask, "SUGGESTED_ANSWER_PIPELINE_VERSION", "changed-for-test")
    assert ask._suggested_answer_pipeline_fingerprint() != before


def test_legacy_prompt_only_row_is_not_reused(client, monkeypatch):
    question = "SF 2483: How is student financial aid changing?"
    generated: list[str] = []
    pipeline_fingerprint = ask._suggested_answer_pipeline_fingerprint

    def fake_synthesis(*args, **kwargs):
        generated.append(question)
        return f"Pipeline answer {len(generated)}."

    monkeypatch.setattr(ask, "synthesize_grounded_answer", fake_synthesis)
    monkeypatch.setattr(
        ask, "_suggested_answer_pipeline_fingerprint", ask.rag_chat_prompt_fingerprint
    )
    assert client.post("/api/v1/ask", json={"content": question}).status_code == 200

    monkeypatch.setattr(
        ask, "_suggested_answer_pipeline_fingerprint", pipeline_fingerprint
    )
    assert client.post("/api/v1/ask", json={"content": question}).status_code == 200

    assert len(generated) == 2


def test_cache_identity_tracks_text_suggestion_and_embedding_model(
    seed_database, monkeypatch
):
    question = "SF 2483: How is student financial aid changing?"
    with get_session_factory()() as db:
        match = ask._suggested_question_match(db, question)
        assert match is not None

        monkeypatch.setattr(ask, "effective_embedding_model", lambda _model: "embed-a")
        original = ask._suggested_cache_identity(match)
        changed_text = ask._suggested_cache_identity(
            replace(match, bill_text_fingerprint="different-bill-text")
        )
        changed_suggestion = ask._suggested_cache_identity(
            replace(match, suggestion_fingerprint="different-suggestion")
        )
        monkeypatch.setattr(ask, "effective_embedding_model", lambda _model: "embed-b")
        changed_embedding = ask._suggested_cache_identity(match)

    assert changed_text != original
    assert changed_suggestion != original
    assert changed_embedding != original


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
