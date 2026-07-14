"""End-to-end acceptance suite for the Grounded Ask answer paths.

These are *invariant* tests, not implementation tests: they assert the
grounded-answer contract (`.claude/rules/grounded-answers.md`) that every Ask
answer must honor regardless of how the router's internal states are shaped —

* rule 1, cite-or-refuse: an answered scenario cites a resolvable official URL
  for everything it renders, or it is the honest NO MATCHES state;
* rule 3, grounded neutrality: legislators are described by authored /
  co-authored counts backed by bill citations, never an inferred "supports";
* rule 4, no ungrounded leak: an intent whose cited answer path has not shipped
  returns no answer body rather than a stretch.

`test_api_contract.py` covers classification routing and the topic_bills answer;
this file adds the topic_legislators answer end-to-end, a uniform cite-or-refuse
check across answer types, and the degraded-path guard for #241.
"""

from __future__ import annotations

import json

import pytest

# The offline heuristic only reaches topic_bills / bill_text, so scenarios that
# need another intent drive it through a mocked LLM response (#241 tracks the
# heuristic's coverage gap).
_ECON_TOPIC = "economic development"


def _fake_router_response(intent: str, *, topic: str | None = None, confidence=None):
    """A minimal OpenAI Responses payload carrying one classified intent.

    Mirrors the strict schema the router parses (intent/confidence/topic), so
    topic answer paths receive the topic they key off of.
    """
    body: dict[str, object] = {
        "intent": intent,
        "confidence": confidence,
        "topic": topic,
    }

    class FakeResponse:
        def raise_for_status(self):
            return None

        def json(self):
            return {"output_text": json.dumps(body)}

    return FakeResponse()


def _mock_llm_intent(monkeypatch, intent: str, *, topic: str | None = None):
    monkeypatch.setenv("OPENAI_API_KEY", "test-openai-key")
    monkeypatch.setattr(
        "alethical.api.services.ask_router.requests.post",
        lambda *a, **k: _fake_router_response(intent, topic=topic, confidence=0.9),
    )


def _mock_rag(
    monkeypatch, *, answer_text: str = "Synthesized bill-text answer."
) -> None:
    """Set up the RAG synthesis path like the bill-scoped chat test: a (fake)
    OpenAI synthesis key, a deterministic hash query embedding, and the model
    filter pinned to the seeded chunks' FALLBACK label so retrieval runs. Pair
    with _mock_llm_intent(..., "bill_text") to drive the whole bill_text path."""
    from alethical.pipeline.rag_ingest import (
        FALLBACK_EMBEDDING_MODEL,
        VECTOR_DIMENSIONS,
        _deterministic_embedding,
    )

    class _FakeSynthesis:
        def raise_for_status(self):
            return None

        def json(self):
            return {"output_text": answer_text}

    monkeypatch.setattr(
        "alethical.api.routers.me.requests.post", lambda *a, **k: _FakeSynthesis()
    )
    monkeypatch.setattr(
        "alethical.api.routers.me._build_embeddings",
        lambda texts, **kw: [
            _deterministic_embedding(t, dimensions=VECTOR_DIMENSIONS) for t in texts
        ],
    )
    monkeypatch.setattr(
        "alethical.api.routers.ask.effective_embedding_model",
        lambda _model: FALLBACK_EMBEDDING_MODEL,
    )


def _assert_cite_or_refuse(answer: dict, kind: str) -> None:
    """Rule 1: either the NO MATCHES state, or every rendered item is cited."""
    if kind == "topic_bills":
        items = answer["bills"]
        if answer["total_matches"] == 0:
            assert items == []
            return
        assert items, "a non-zero match count must render at least one citation"
        for bill in items:
            assert bill["official_url"], "every bill card must cite its official URL"
    elif kind == "topic_legislators":
        items = answer["legislators"]
        if answer["total_matches"] == 0:
            assert items == []
            return
        assert items, "a non-zero match count must render at least one citation"
        # Per docs/grounded-ask-spec.md §4.2 (topic_legislators), the citation
        # backing an authorship count *is the bill itself* — the profile URL is a
        # supplementary link. So every rendered row must carry at least one bill
        # reference that resolves by bill key.
        for row in items:
            assert row["bills"], "each row must cite the bills backing its counts"
            assert all(ref["id"] for ref in row["bills"]), "bill cites resolve by key"
    elif kind == "vote_deflection":
        # §4.5 / §9.4: the honest vote deflection carries no generated answer —
        # either a resolved bill (cited by its official URL; the frontend
        # deep-links its Votes tab, §9.3) or a degrade to the topic_bills list,
        # which itself must satisfy cite-or-refuse.
        resolved = answer.get("resolved_bill")
        if resolved is not None:
            assert resolved["official_url"], "resolved bill must cite its official URL"
            assert resolved["id"], "resolved bill must be URL-addressable by key"
        else:
            assert answer.get("topic_bills") is not None, "unresolved → topic_bills"
            _assert_cite_or_refuse(answer["topic_bills"], "topic_bills")
    elif kind == "bill_text":
        # §9.4 bill_text: prose scoped to one resolved bill, with ≥1 citation
        # resolving to an official URL. A weak/empty retrieval is a refuse
        # (answer is None) and never reaches here.
        assert answer["answer"], "a bill_text answer must carry prose"
        assert answer["bill"]["official_url"], "the answering bill must be citable"
        assert answer["citations"], "a bill_text answer must cite its passages"
        for citation in answer["citations"]:
            assert citation["url"], "every citation resolves to an official URL"
    else:  # pragma: no cover - guards against a mistyped kind
        raise AssertionError(f"unknown answer kind: {kind}")


def test_topic_legislators_answer_is_cited_and_grounded_by_authorship(
    client, monkeypatch
):
    """Scenario 3 end-to-end: the /ask body groups legislators by authorship —
    the answer carries a resolving citation (rule 1) and every row states
    authored / co-authored counts backed by bill citations (rule 3), never an
    inferred position."""
    _mock_llm_intent(monkeypatch, "topic_legislators", topic=_ECON_TOPIC)

    response = client.post(
        "/api/v1/ask",
        json={"content": "Which legislators have authored economic development bills?"},
    )
    assert response.status_code == 200
    data = response.json()["data"]
    assert data["intent"] == "topic_legislators"
    assert data["source"] == "llm"

    answer = data["answer"]
    assert answer["topic"] == _ECON_TOPIC
    assert answer["session"]["slug"] == "94-2025-regular"
    assert "data_as_of" in answer
    assert answer["total_matches"] >= 1
    assert answer["total_bills"] >= 1
    assert 1 <= len(answer["legislators"]) <= 6

    for row in answer["legislators"]:
        # Rule 3: counts + backing bill citations (§4.2), never an inferred
        # position. The bill reference is the citation, per the spec.
        assert row["authored_count"] + row["coauthored_count"] >= 1
        assert row["bills"], "authorship counts must be backed by bill citations"
        for bill_ref in row["bills"]:
            assert bill_ref["id"]
            assert bill_ref["file_type"]
            assert bill_ref["file_number"]
            assert bill_ref["title"]

    # The shareable ?q= link must re-render identically.
    again = client.post(
        "/api/v1/ask",
        json={"content": "Which legislators have authored economic development bills?"},
    )
    assert again.json()["data"] == data


@pytest.mark.parametrize(
    "kind, question, setup",
    [
        (
            "topic_bills",
            "What bills affect economic development?",
            lambda mp: mp.delenv("OPENAI_API_KEY", raising=False),
        ),
        (
            "topic_legislators",
            "Which legislators have authored economic development bills?",
            lambda mp: _mock_llm_intent(mp, "topic_legislators", topic=_ECON_TOPIC),
        ),
    ],
)
def test_answered_scenarios_satisfy_cite_or_refuse(
    client, monkeypatch, kind, question, setup
):
    """Every answered Ask scenario obeys cite-or-refuse uniformly (rule 1)."""
    setup(monkeypatch)
    response = client.post("/api/v1/ask", json={"content": question})
    assert response.status_code == 200
    data = response.json()["data"]
    assert data["intent"] == kind
    _assert_cite_or_refuse(data["answer"], kind)


@pytest.mark.parametrize("intent", ["refuse"])
def test_interim_intents_return_no_ungrounded_answer(client, monkeypatch, intent):
    """Rule 4: an intent whose cited answer path has not shipped returns no
    answer body — never an ungrounded stretch. Updates as #79 slices land.

    ``legislator_vote`` (§4.5 / §9.4) and ``bill_text`` (§9.4) have both left
    this list — their answer bodies now ship, covered by the dedicated
    vote-deflection and bill-text contract tests below."""
    _mock_llm_intent(monkeypatch, intent)
    response = client.post(
        "/api/v1/ask", json={"content": "What does this bill do about housing?"}
    )
    assert response.status_code == 200
    data = response.json()["data"]
    assert data["intent"] == intent
    assert data["answer"] is None


def test_bill_text_answer_cites_the_resolved_bill(client, monkeypatch):
    """Scenario 1 (docs/grounded-ask-spec.md §4.1 / §9.4, bill_text): a question
    naming a bill resolves it, retrieves its passages, and answers in prose with
    citations that each resolve to an official URL (grounded rule 1)."""
    _mock_llm_intent(monkeypatch, "bill_text")
    _mock_rag(monkeypatch)
    data = client.post("/api/v1/ask", json={"content": "What's in SF 1832?"}).json()[
        "data"
    ]
    assert data["intent"] == "bill_text"
    answer = data["answer"]
    assert answer is not None
    assert answer["answer"] == "Synthesized bill-text answer."
    assert answer["bill"]["id"] == "94-2025-SF1832"
    assert {c["bill_id"] for c in answer["citations"]} == {"94-2025-SF1832"}
    _assert_cite_or_refuse(answer, "bill_text")


def test_bill_text_refuses_when_bill_has_no_retrievable_text(client, monkeypatch):
    """Cite-or-refuse (rule 1): a bill that resolves but has no retrieval-ready
    passages yields no answer body — an honest refuse, never an ungrounded
    stretch. HF 9901 is the seeded no-chunks bill."""
    _mock_llm_intent(monkeypatch, "bill_text")
    _mock_rag(monkeypatch)
    data = client.post("/api/v1/ask", json={"content": "What's in HF 9901?"}).json()[
        "data"
    ]
    assert data["intent"] == "bill_text"
    assert data["answer"] is None


def test_vote_deflection_resolves_named_bill_and_degrades_otherwise(
    client, monkeypatch
):
    """Scenario 4 v1 (docs/grounded-ask-spec.md §4.5 / §9.4, Vote deflection): a
    vote question is an honest deflection, never a vote answer. When it names a
    resolvable bill (HF/SF number) the body carries that bill's card so the
    frontend can deep-link its Votes tab (§9.3); when no bill resolves it
    degrades to the cited topic_bills list. No generated vote answer either way.
    """
    # Names HF 9901 → resolves to that bill's card, cited by official URL.
    _mock_llm_intent(monkeypatch, "legislator_vote", topic="children")
    data = client.post(
        "/api/v1/ask",
        json={"content": "How did the House vote on HF 9901?"},
    ).json()["data"]
    assert data["intent"] == "legislator_vote"
    answer = data["answer"]
    assert answer is not None
    assert answer["resolved_bill"]["id"] == "94-2025-HF9901"
    assert answer["topic_bills"] is None
    _assert_cite_or_refuse(answer, "vote_deflection")

    # No bill number → degrade to the cited topic_bills list (§4.5).
    _mock_llm_intent(monkeypatch, "legislator_vote", topic="jobs")
    degraded = client.post(
        "/api/v1/ask",
        json={"content": "How did my senator vote on workforce funding?"},
    ).json()["data"]["answer"]
    assert degraded["resolved_bill"] is None
    assert degraded["topic_bills"] is not None
    assert "94-2025-SF1832" in [b["id"] for b in degraded["topic_bills"]["bills"]]
    _assert_cite_or_refuse(degraded, "vote_deflection")


def test_degraded_offline_path_never_fabricates_answer(client, monkeypatch):
    """When the classifier degrades to the offline heuristic (#237), a vote or
    out-of-scope question must never yield a fabricated answer. Routing quality
    on the degraded path — reaching legislator_vote / refuse — is tracked in
    #241; this guards the invariant that holds regardless: no ungrounded body."""
    monkeypatch.delenv("OPENAI_API_KEY", raising=False)

    def fail_post(*args, **kwargs):
        raise AssertionError("OpenAI must not be called on the degraded path")

    monkeypatch.setattr("alethical.api.services.ask_router.requests.post", fail_post)

    for question in (
        "How did my legislator vote on cannabis?",
        "Write me a poem about my cat.",
    ):
        data = client.post("/api/v1/ask", json={"content": question}).json()["data"]
        answer = data["answer"]
        if answer is None:
            continue
        # If the heuristic did route to a topic answer, it still must cite.
        _assert_cite_or_refuse(answer, data["intent"])


def test_topic_bills_generalizes_to_a_second_topic(client, monkeypatch):
    """The cited-list path is not hardwired to one topic: a different in-scope
    topic ("student aid") resolves to its own matching bill, cited."""
    monkeypatch.delenv("OPENAI_API_KEY", raising=False)
    data = client.post(
        "/api/v1/ask", json={"content": "What bills affect student aid?"}
    ).json()["data"]
    assert data["intent"] == "topic_bills"
    answer = data["answer"]
    assert answer["topic"] == "student aid"
    assert answer["total_matches"] >= 1
    assert "94-2025-SF2483" in [bill["id"] for bill in answer["bills"]]
    _assert_cite_or_refuse(answer, "topic_bills")


def test_topic_below_minimum_length_returns_no_matches_state(client, monkeypatch):
    """Rule 2: a topic too short to carry signal yields the honest NO MATCHES
    empty state, never a rendered answer with nothing to cite."""
    monkeypatch.delenv("OPENAI_API_KEY", raising=False)
    data = client.post("/api/v1/ask", json={"content": "What bills affect AI?"}).json()[
        "data"
    ]
    assert data["intent"] == "topic_bills"
    answer = data["answer"]
    assert answer["total_matches"] == 0
    assert answer["bills"] == []


def test_topic_matches_by_bill_title_not_only_policy_area(client, monkeypatch):
    """A topic that appears in a bill's title but not its policy-area tags still
    matches — the title/description keyword branch of the match predicate."""
    monkeypatch.delenv("OPENAI_API_KEY", raising=False)
    data = client.post(
        "/api/v1/ask", json={"content": "What bills affect jobs?"}
    ).json()["data"]
    assert data["intent"] == "topic_bills"
    answer = data["answer"]
    assert answer["topic"] == "jobs"
    assert "94-2025-SF1832" in [bill["id"] for bill in answer["bills"]]
    _assert_cite_or_refuse(answer, "topic_bills")
