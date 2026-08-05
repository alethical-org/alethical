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
import re

import pytest

from alethical.api.routers.ask import (
    _BILL_TEXT_CHUNK_LIMIT,
    _LIST_QUESTION_RE,
    _SERVED_CITATION_LIMIT,
    _citation_excerpt,
)
from alethical.api.routers.me import (
    BillTextCoverage,
    _coverage_rule,
    narrow_bill_absence_claims,
    strip_list_completeness_claims,
)
from alethical.eval.ground_truth import (
    HF719_ANSWER_CITY_COUNT_BUG,
    HF719_GRANT_CITIES,
    HF719_GRANT_COUNTIES,
    HF719_MIN_GRANT_CITIES,
    HF719_MIN_GRANT_COUNTIES,
)

# The header lines rag chunking prepends to a chunk. No served excerpt may start
# with one (#835).
_CHUNK_HEADER_RE = re.compile(
    r"^(?:Bill|Bill title|Article|Section|Statute heading|Citation heading):\s",
)

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
    with _mock_llm_intent(..., "bill_text") to drive the whole bill_text path.

    The classifier and the synthesizer both call ``requests.post`` on the *same*
    ``requests`` module, so this can't just overwrite it — it would clobber the
    router mock and drop classification to the heuristic. Instead it dispatches:
    a synthesis request (identified by its system prompt) returns the fake
    answer; anything else delegates to the already-installed classifier mock."""
    import alethical.api.routers.me as me_module
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

    classifier_post = me_module.requests.post

    def _dispatch_post(url, **kwargs):
        messages = kwargs.get("json", {}).get("input", [])
        system = str(messages[0].get("content", "")) if messages else ""
        if "Answer only from the provided bill text" in system:
            return _FakeSynthesis()
        return classifier_post(url, **kwargs)

    monkeypatch.setattr("alethical.api.routers.me.requests.post", _dispatch_post)
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
        # Per docs/product-onboarding/grounded-ask-spec.md §4.2 (topic_legislators), the citation
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
            # #835: the excerpt shows bill text, not the retrieval header that
            # rag chunking prepends, and marks its own cut with an ellipsis.
            assert not _CHUNK_HEADER_RE.match(citation["excerpt"]), (
                f"excerpt leads with a retrieval header: {citation['excerpt'][:60]!r}"
            )
            assert not citation["excerpt"].rstrip().endswith((",", ";", ":")), (
                f"excerpt ends mid-clause without an ellipsis: {citation['excerpt'][-40:]!r}"
            )
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
    """Scenario 1 (docs/product-onboarding/grounded-ask-spec.md §4.1 / §9.4, bill_text): a question
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


def test_bill_text_citations_carry_their_statute_section(client, monkeypatch):
    """§9.5 decision 4: each citation names the statute section its passage came
    from, AND that section's position, so the answer page's "From the bill" card can
    link to the passage inside our own Bill Text tab
    (`?tab=text#ft-<section_id>-<section_order>`, the #854 anchor scheme) instead of
    only out to revisor.mn.gov (.claude/rules/grounded-answers.md rule 5).

    The position is what makes the link land right: `section_id_text` is not unique
    within a version, so an id-only anchor resolves to the FIRST section carrying it.

    The seeded bill's four retrieved passages come from three sections, two of them
    sharing "laws.2.5.0" — the case the answer page's rail draws as one card holding
    both quotes."""
    _mock_llm_intent(monkeypatch, "bill_text")
    _mock_rag(monkeypatch)
    data = client.post("/api/v1/ask", json={"content": "What's in SF 1832?"}).json()[
        "data"
    ]
    citations = data["answer"]["citations"]
    assert all(c["section_id"] for c in citations), (
        "every citation must name the section it quotes"
    )
    # The ids are the sections' own stored ids, and two passages share one.
    assert sorted(c["section_id"] for c in citations) == [
        "laws.2.2.0",
        "laws.2.5.0",
        "laws.2.5.0",
        "laws.3.2.0",
    ]
    # Every citation also carries the section's POSITION, which is what disambiguates
    # a repeated id. It comes from the chunk's own section row, so it is exact: the
    # two passages sharing an id share a position too, because they are one section.
    assert all(isinstance(c["section_order"], int) for c in citations), (
        "an id without a position cannot address one section"
    )
    by_id = {}
    for citation in citations:
        by_id.setdefault(citation["section_id"], set()).add(citation["section_order"])
    assert all(len(orders) == 1 for orders in by_id.values()), (
        "one section id from one version resolves to one position"
    )
    # section_topic is a separate field, always present as a string (empty when the
    # section's heading carries no topic worth showing — these fixtures' headings
    # are a bare "Sec. 5.").
    assert all(isinstance(c["section_topic"], str) for c in citations)


def test_bill_text_answer_says_how_much_of_the_bill_it_read(client, monkeypatch):
    """§9.5 decision 11 / #883: the answer carries how many of the bill's passages
    it was written from, against how many the bill has, so the page can say above a
    long-bill answer that it covers only part of it.

    Served as a FACT, never as a verdict — the caveat is fixed UI copy the layout
    owns, so nothing the model writes can soften or drop it
    (.claude/rules/grounded-answers.md rule 3).

    `total` counts the CURRENT version's passages only, the same scoping retrieval
    uses (#285); counting every engrossment would inflate it and make the ratio a
    different number."""
    _mock_llm_intent(monkeypatch, "bill_text")
    _mock_rag(monkeypatch)
    answer = client.post("/api/v1/ask", json={"content": "What's in SF 1832?"}).json()[
        "data"
    ]["answer"]
    coverage = answer["coverage"]
    assert coverage is not None, "a bill_text answer must say how much it read"
    # `used` is what retrieval actually handed the writer — the same passages the
    # citations quote, so the two can never disagree.
    assert coverage["used"] == len(answer["citations"])
    # The seeded bill has more passages than the answer read, which is the whole
    # condition the note exists for.
    assert coverage["total"] > coverage["used"], (
        "the fixture bill must be partially covered, or this asserts nothing"
    )


def test_bill_text_resolves_a_bill_by_fuzzy_title(client, monkeypatch):
    """Scenario 1 (docs/product-onboarding/grounded-ask-spec.md §4.1, bill_text): a question with no
    HF/SF number resolves via a single confident title match ("higher education"
    → SF 2483) and answers with citations — proving you don't need the number."""
    _mock_llm_intent(monkeypatch, "bill_text")
    _mock_rag(monkeypatch)
    data = client.post(
        "/api/v1/ask", json={"content": "What's in the higher education bill?"}
    ).json()["data"]
    assert data["intent"] == "bill_text"
    answer = data["answer"]
    assert answer is not None
    assert answer["bill"]["id"] == "94-2025-SF2483"
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


def test_bill_text_degrades_to_topic_bills_when_ambiguous(client, monkeypatch):
    """§4.1 fallback: a bill_text question that names no *single* bill (the phrase
    is ambiguous, matching more than one) degrades to the cited topic_bills list
    rather than refusing. "appropriations" matches 2 seeded bills by title, so it
    resolves to no single bill but still names a topic with matches."""
    _mock_llm_intent(monkeypatch, "bill_text")
    _mock_rag(monkeypatch)
    data = client.post(
        "/api/v1/ask", json={"content": "What's in the appropriations bill?"}
    ).json()["data"]
    assert data["intent"] == "bill_text"
    answer = data["answer"]
    assert answer is not None
    assert "bills" in answer, "an ambiguous bill_text degrades to the topic_bills list"
    assert answer["total_matches"] >= 2
    _assert_cite_or_refuse(answer, "topic_bills")


def test_vote_deflection_resolves_named_bill_and_degrades_otherwise(
    client, monkeypatch
):
    """Scenario 4 v1 (docs/product-onboarding/grounded-ask-spec.md §4.5 / §9.4, Vote deflection): a
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


# ---------------------------------------------------------------------------
# Citation excerpts (#835). The chunk text a citation is built from carries a
# retrieval header and can run far longer than the card shows, so the display
# excerpt is derived. These pin both halves of that derivation: the header never
# reaches the reader, and a cut lands on a word boundary marked with an ellipsis.
# Rule 1 side: only the header is removed and only the tail is dropped — every
# surviving character is the bill's own.
# ---------------------------------------------------------------------------

# The real production chunk behind the reported bug, verbatim (HF 719, the answer
# for "Which cities and counties get named infrastructure grants?").
_REAL_CHUNK = (
    "Bill: HF 719\n"
    "Article: ARTICLE 1 APPROPRIATIONS\n"
    "Section: Sec. 24. PUBLIC FACILITIES AUTHORITY\n"
    "\n"
    "For a grant to the city of Silver Lake to predesign, design, engineer, "
    "construct, and equip stormwater, wastewater, and drinking water "
    "infrastructure serving the city and surrounding township properties, "
    "including replacement of the existing water treatment facility."
)


def test_citation_excerpt_drops_the_retrieval_header():
    """The purple chip already states Art. 1, Sec. 24 — reprinting it as prose
    filled the card and pushed the quote out of view."""
    out = _citation_excerpt(_REAL_CHUNK)
    assert out.startswith("For a grant to the city of Silver Lake")
    assert "Bill: HF 719" not in out
    assert "ARTICLE 1" not in out
    assert "PUBLIC FACILITIES AUTHORITY" not in out


def test_citation_excerpt_cuts_on_a_word_boundary():
    """The live cut landed mid-word ("and drinki") because it was a hard 220-char
    slice. Every truncated excerpt now ends on a whole word plus an ellipsis."""
    out = _citation_excerpt(_REAL_CHUNK)
    assert out.endswith("…")
    assert not out.endswith(" …")
    # The last word is whole: it appears in the source followed by a boundary.
    last_word = out[:-1].rstrip().rsplit(" ", 1)[-1]
    assert re.search(rf"\b{re.escape(last_word)}\b[\s.,;:]", _REAL_CHUNK)
    assert "drinki…" not in out


def test_citation_excerpt_leaves_a_short_quote_alone():
    """No ellipsis when nothing was cut — a closing "…" on a complete sentence
    claims the bill said more than it did."""
    body = "For a grant to the city of Cook for a new water tower."
    assert _citation_excerpt(f"Bill: HF 719\nSection: Sec. 24. TEST\n\n{body}") == body


def test_citation_excerpt_keeps_a_body_that_has_no_header():
    """A chunk stored without the prefix keeps every word of its body — the
    header strip stops at the first line that isn't a header."""
    body = "Sec. 24. For a grant to the city of Jordan."
    assert _citation_excerpt(body) == body


def test_citation_excerpt_drops_a_comma_left_at_the_cut():
    """The ellipsis is the only terminal mark the quote carries, so a comma the
    source left exactly at the cut goes with it ("until June 30,…")."""
    body = " ".join(["appropriation"] * 20) + ", and the remainder is cancelled."
    out = _citation_excerpt(f"Bill: HF 719\n\n{body}")
    assert out.endswith("…")
    assert not out.endswith(",…")


# --- #868: an answer may not state a count or deny a category the bill contradicts ---

# The real question from production, verbatim. Reachable in one click from HF 719.
_HF719_QUESTION = "HF 719: Which cities and counties get named infrastructure grants?"

# What production actually returned on 2026-07-31, trimmed in the middle. The last
# sentence is the whole reason #868 was filed at Urgent: it denies a category of the
# bill's contents on the strength of four passages that happened not to mention it.
_HF719_PRODUCTION_ANSWER = (
    "The cities named in HF 719 that are receiving infrastructure grants include: "
    "1. Silver Lake 2. South Haven 3. Spicer 4. Dayton\n\n"
    "The bill does not specify any counties receiving named infrastructure grants."
)

# GROUND TRUTH lives in exactly ONE place — alethical/eval/ground_truth.py, counted
# from the bill's own text and shared deliberately between the #865 answer-quality
# eval and this regression test. Two sessions counted it independently and agreed on
# both figures. Import it; restating the numbers here is how the two drift apart.
#
# The bounds are lower bounds with named exemplars, never exact totals, because an
# exact total depends on definitions the bill does not settle (is the Moorhead-Clay
# County Joint Powers Authority a county? is "grants to Dakota County, the city of
# Lakeville, or both" a city grant?). A test pinned to an exact number fails on a
# definitional argument rather than on a regression. That module's docstring carries
# the counting method and the edge cases.


def test_hf719_ground_truth_contradicts_the_answer_production_gave():
    """The premise every other test here rests on, stated as an assertion.

    Production said nineteen cities and no counties. The bill names at least ninety
    cities and at least fifteen counties. If a future reader doubts the numbers, the
    provenance is in the comment above; this pins that the answer and the bill
    genuinely disagree, so nobody re-litigates whether #868 was real.
    """
    assert HF719_MIN_GRANT_CITIES > HF719_ANSWER_CITY_COUNT_BUG
    assert HF719_MIN_GRANT_COUNTIES > 0
    assert "does not specify any counties" in _HF719_PRODUCTION_ANSWER
    for county in HF719_GRANT_COUNTIES:
        assert county not in _HF719_PRODUCTION_ANSWER
    for city in HF719_GRANT_CITIES:
        assert city not in _HF719_PRODUCTION_ANSWER


def test_the_hf719_question_is_recognized_as_an_enumerate_everything_question():
    """The routing gate: a question asking for *all* of a kind must take the
    read-more path, or the fixed four-passage sample puts the bug straight back."""
    assert _LIST_QUESTION_RE.search(_HF719_QUESTION)
    for question in (
        "Which counties get grants?",
        "List the cities named in HF 719.",
        "How many cities get infrastructure grants?",
        "Name the agencies that receive appropriations.",
        "What are the effective dates for all the articles?",
    ):
        assert _LIST_QUESTION_RE.search(question), question
    # A specific question keeps the cheap fixed sample: widening every answer would
    # cost money and waiting time on questions four passages already answer.
    for question in (
        "When does HF 719 take effect?",
        "What's in SF 1832?",
        "How does the bill fund the fish hatchery?",
        "Who is the chief author?",
    ):
        assert not _LIST_QUESTION_RE.search(question), question


def test_a_partial_read_may_not_deny_what_the_bill_contains():
    """The false negative, killed at the contract level rather than only asked for.

    Feeds the guard the exact sentence production served and asserts it can no
    longer tell a reader the bill omits counties. A prompt is a request; this is
    what makes the invariant hold when the model ignores it.
    """
    out = narrow_bill_absence_claims(_HF719_PRODUCTION_ANSWER)
    assert "The bill does not specify any counties" not in out
    assert "The bill text we searched does not specify any counties" in out
    # The claim is re-scoped, not deleted: the reader still learns that the search
    # turned up no counties, which is true and useful.
    assert "counties" in out
    # Everything the answer got right survives verbatim.
    assert "1. Silver Lake 2. South Haven 3. Spicer 4. Dayton" in out


@pytest.mark.parametrize(
    "claim,expected",
    [
        (
            "The bill does not specify any counties.",
            "The bill text we searched does not specify any counties.",
        ),
        (
            "This bill contains no appropriation for transit.",
            "The bill text we searched contains no appropriation for transit.",
        ),
        (
            "HF 719 does not name any counties.",
            "The bill text we searched does not name any counties.",
        ),
        (
            "SF1832 makes no mention of Ramsey County.",
            "The bill text we searched makes no mention of Ramsey County.",
        ),
        (
            "The bill is silent on effective dates.",
            "The bill text we searched is silent on effective dates.",
        ),
        (
            "The bill has no provision for oversight.",
            "The bill text we searched has no provision for oversight.",
        ),
        (
            "Nineteen cities are listed. The bill does not mention counties.",
            "Nineteen cities are listed. The bill text we searched does not mention counties.",
        ),
    ],
)
def test_every_shape_of_bill_absence_claim_is_re_scoped(claim, expected):
    """One case per phrasing the guard has to catch. Capitalization is part of the
    assertion: a rewrite that reads as a patch undermines the answer it corrects."""
    assert narrow_bill_absence_claims(claim) == expected


@pytest.mark.parametrize(
    "sentence",
    [
        # Positive claims about the bill: the guard must not touch them, or every
        # answer turns into hedged mush.
        "The bill appropriates $6,000,000 from the bond proceeds fund.",
        "This bill names 19 cities.",
        "The bill does provide grants to cities.",
        "HF 719 funds flood mitigation in the city of Moorhead.",
        # "no" opening a comparative is ordinary legislative wording, not an absence
        # claim. Rewriting these would weaken true statements.
        "The bill lists no fewer than 19 cities.",
        "The commissioner must report no later than January 15.",
        "The bill requires no more than two hearings.",
        "Grants may last no longer than four years.",
        # An absence claim about something that is not the bill stands as written.
        "The city of Anoka does not appear in article 2.",
        "Ramsey County is not the fiscal agent.",
    ],
)
def test_the_guard_leaves_everything_that_is_not_an_absence_claim_alone(sentence):
    assert narrow_bill_absence_claims(sentence) == sentence


@pytest.mark.parametrize(
    "searched,total,complete,partial",
    [
        (4, 102, False, True),  # the HF 719 failure: a sample presented as the whole
        (102, 102, True, False),  # the whole bill went in
        (103, 102, True, False),  # never under-report completeness on an off-by-one
        (2, 2, True, False),  # the median bill: 2 passages IS the whole bill
        (4, 0, False, False),  # unknown denominator: not complete, and not countable
        (0, 0, False, False),
    ],
)
def test_coverage_only_claims_completeness_when_it_can_prove_it(
    searched, total, complete, partial
):
    """``is_complete`` licenses claims about the bill, so an unknown denominator
    must read as *not* complete — the safe direction. ``is_partial`` is narrower: it
    gates the reader-facing note, which cannot honestly say "0 of 0 passages"."""
    coverage = BillTextCoverage(searched=searched, total=total)
    assert coverage.is_complete is complete
    assert coverage.is_partial is partial


def test_the_prompt_forbids_absence_claims_unless_the_whole_bill_went_in():
    """The instruction #868 says was the bug. A partial read must be told it is a
    sample; only a complete read may speak for the bill."""
    partial = _coverage_rule(BillTextCoverage(searched=4, total=102))
    assert "only SOME of this bill's text" in partial
    assert "NEVER state or imply that the bill omits" in partial
    assert "NEVER give a total, a count, or a list you call complete" in partial

    complete = _coverage_rule(BillTextCoverage(searched=102, total=102))
    assert "COMPLETE text of this bill" in complete
    assert "NEVER state or imply that the bill omits" not in complete
    # A complete read may speak for the bill, but it still may not pass off a
    # shortened list as the whole set — the gap the live measurement exposed.
    assert "list every one you find" in complete
    # And the never-claim-completeness rule is on BOTH, because it is a claim about
    # the model's own enumeration, which reading the whole bill does not license.
    for rule in (partial, complete):
        assert "NEVER tell the reader your list is complete" in rule

    # Bill-scoped chat passes no coverage at all (it retrieves a fixed 3 passages
    # and never counts the bill). Unknown must land on the cautious rule.
    assert _coverage_rule(None) == partial


# SF 1832 is the seeded bill with retrievable text: 156 passages / 27,061 words, so
# it overflows the real `_LIST_QUESTION_WORD_BUDGET` and gives the PARTIAL case for
# free. There is no seeded bill small enough to give the COMPLETE case the same way,
# so the tests that need it raise the budget instead of inventing a bill — the
# behaviour under test is what happens when every passage went in, not any particular
# bill's size, and the partial test above still exercises the shipped constant.
#
# An earlier draft used HF 4138 for the complete case. It passed locally and failed
# in CI, because that bill's passages exist only in a developer database and not in
# what `load_sample_data.py` builds. Depend on the seeded corpus, or create the rows.
_PARTIAL_BILL_PASSAGES = 156
_BUDGET_ABOVE_EVERY_SEEDED_BILL = 100_000
_ABSENCE_CLAIM_ANSWER = (
    "Grants go to Silver Lake and South Haven. "
    "The bill does not specify any counties receiving grants."
)
# The label the seeded chunks are embedded under, and the vector width the column
# is declared with — both needed to query retrieval directly rather than through
# the API (#221 explains why the label matters: a query vector and a chunk vector
# from different models have no meaningful distance between them).
_TEST_EMBEDDING_MODEL = "deterministic-sha256"
_VECTOR_DIMENSIONS = 1536


def test_a_list_question_that_outgrew_the_budget_reports_it_and_denies_nothing(
    client, monkeypatch
):
    """The #868 fix end to end on a bill too long to read in full.

    Three things have to hold at once for the answer to be honest: the served fact
    says the read was partial, it says the question was an enumerating one (so the
    page knows to caveat), and the model's denial of a whole category has been
    re-scoped to the text actually searched.

    The wording lives on the page (§9.5 decision 11) — the note goes ABOVE the
    answer, where a reader who skims two lines still sees it, which is why the
    backend serves the fact rather than a sentence.
    """
    _mock_llm_intent(monkeypatch, "bill_text")
    _mock_rag(monkeypatch, answer_text=_ABSENCE_CLAIM_ANSWER)
    answer = client.post(
        "/api/v1/ask",
        json={"content": "Which cities and counties get grants in SF 1832?"},
    ).json()["data"]["answer"]

    assert answer is not None
    coverage = answer["coverage"]
    assert coverage["total"] == _PARTIAL_BILL_PASSAGES
    assert coverage["enumerating"] is True
    # It read far more than the old fixed sample, and still not all of it.
    assert _BILL_TEXT_CHUNK_LIMIT < coverage["used"] < coverage["total"]

    # And the false negative is gone.
    assert "The bill does not specify any counties" not in answer["answer"]
    assert "The bill text we searched does not specify any counties" in answer["answer"]
    _assert_cite_or_refuse(answer, "bill_text")


def test_a_list_question_that_read_the_whole_bill_still_flags_itself(
    client, monkeypatch
):
    """The correction that measuring forced.

    Reading every passage is not reporting every item: given all 102 passages of HF
    719 the model listed 26-35 of its 98 cities and stopped. So `used == total` alone
    would have taken the page's caveat away on exactly the answer that most needs
    one, which is why `enumerating` is served alongside the two numbers.

    The absence claim IS allowed to stand here, and that distinction is the point:
    "the bill does not specify any counties" is a claim about the bill, and a
    complete read is what makes it checkable and true.
    """
    monkeypatch.setattr(
        "alethical.api.routers.ask._LIST_QUESTION_WORD_BUDGET",
        _BUDGET_ABOVE_EVERY_SEEDED_BILL,
    )
    _mock_llm_intent(monkeypatch, "bill_text")
    _mock_rag(monkeypatch, answer_text=_ABSENCE_CLAIM_ANSWER)
    answer = client.post(
        "/api/v1/ask",
        json={"content": "Which cities and counties get grants in SF 1832?"},
    ).json()["data"]["answer"]

    assert answer is not None
    coverage = answer["coverage"]
    assert coverage["used"] == coverage["total"] == _PARTIAL_BILL_PASSAGES
    # The flag the page needs to caveat a complete-but-possibly-short list.
    assert coverage["enumerating"] is True
    # Untouched, because a complete read can support it.
    assert answer["answer"] == _ABSENCE_CLAIM_ANSWER
    assert "bill text we searched" not in answer["answer"]
    _assert_cite_or_refuse(answer, "bill_text")


def test_a_long_bill_does_not_serve_a_citation_card_per_passage(client, monkeypatch):
    """Reading and showing are different jobs.

    The first live run of this fix fed the synthesizer all 102 passages of HF 719 and
    served all 102 back as citations, which the answer page draws as excerpt cards —
    and since §9.5 decision 1 keeps EVERY passage of a cited section, not one per
    section, nothing downstream would have trimmed them. A citation is something a
    person checks the answer against; a hundred is checked by nobody. Coverage
    carries the "how much did you read" fact instead, and cite-or-refuse (rule 1) is
    satisfied by citations that resolve, not by their number.
    """
    _mock_llm_intent(monkeypatch, "bill_text")
    _mock_rag(monkeypatch)
    answer = client.post(
        "/api/v1/ask",
        json={"content": "Which cities get grants in SF 1832?"},
    ).json()["data"]["answer"]

    assert answer is not None
    assert answer["coverage"]["used"] > _SERVED_CITATION_LIMIT
    assert len(answer["citations"]) == _SERVED_CITATION_LIMIT
    _assert_cite_or_refuse(answer, "bill_text")


def test_a_specific_question_keeps_the_cheap_sample(client, monkeypatch):
    """Cost control: widening every answer would spend money and make every reader
    wait for questions four passages already answer. A specific question keeps the
    fixed sample, and says so by serving `enumerating: false` — which is what lets
    the page stay silent on a fully-read short bill, where there is no list to
    caveat and a warning that appears where it does not apply teaches readers to
    skip the one that does.

    What it does NOT drop is the absence-claim guard: 4 of 156 passages proves
    nothing about what the bill omits, whatever shape the question was.
    """
    _mock_llm_intent(monkeypatch, "bill_text")
    _mock_rag(monkeypatch, answer_text=_ABSENCE_CLAIM_ANSWER)
    answer = client.post(
        "/api/v1/ask", json={"content": "When does SF 1832 take effect?"}
    ).json()["data"]["answer"]

    assert answer is not None
    coverage = answer["coverage"]
    assert coverage["used"] == _BILL_TEXT_CHUNK_LIMIT
    assert coverage["total"] == _PARTIAL_BILL_PASSAGES
    assert coverage["enumerating"] is False
    assert "The bill does not specify any counties" not in answer["answer"]
    assert "The bill text we searched does not specify any counties" in answer["answer"]
    _assert_cite_or_refuse(answer, "bill_text")


def test_the_coverage_denominator_counts_exactly_what_retrieval_can_return():
    """The fraction invariant, proved by making it possible to get wrong.

    ``coverage`` is ``searched / total``, and the two halves come from two different
    statements. If ``total`` counts rows retrieval can never return, an answer reads
    as incomplete forever; if it counts fewer, an answer claims it read the whole
    bill when it did not. The second failure is the one that puts #868 back, so this
    test seeds exactly the rows that would break each half.

    Neither filter is visible in the seeded corpus as it ships — one current version
    per bill, one embedding model — so a dropped filter passed every other test in
    this file. That is why the rows are created here rather than assumed.
    """
    from sqlalchemy import select
    from sqlalchemy.orm import Session

    from alethical.db.schema import load_schema
    from alethical.db.session import get_engine

    schema = load_schema()
    stale_version_id = None
    extra_chunk_ids: list = []

    def _counts(db, bill):
        """The denominator, and what retrieval actually returns with no limit."""
        total = db.scalar(
            schema.retrievable_chunk_count_stmt(
                bill.id, embedding_model=_TEST_EMBEDDING_MODEL
            )
        )
        retrievable = db.scalars(
            schema.semantic_rag_chunk_stmt(
                [0.0] * _VECTOR_DIMENSIONS,
                bill_id=bill.id,
                embedding_model=_TEST_EMBEDDING_MODEL,
                limit=10_000,
            )
        ).all()
        return total, len(retrievable)

    def _add_chunk(db, *, version_id, embedding_model):
        document = schema.RagSectionDocument(
            bill_id=db.scalar(
                select(schema.BillVersion.bill_id).where(
                    schema.BillVersion.id == version_id
                )
            ),
            bill_version_id=version_id,
            citation_label="Coverage fixture",
            clean_text="For a grant to the city of Coverage Fixture.",
            cleaning_version="coverage-fixture",
            source_hash="0" * 64,
            word_count=8,
        )
        db.add(document)
        db.flush()
        chunk = schema.RagChunk(
            rag_section_document_id=document.id,
            chunk_index=0,
            citation_label="Coverage fixture",
            chunk_text="For a grant to the city of Coverage Fixture.",
            search_text="For a grant to the city of Coverage Fixture.",
            chunking_version="coverage-fixture",
            word_count=8,
        )
        db.add(chunk)
        db.flush()
        db.add(
            schema.RagChunkEmbedding(
                rag_chunk_id=chunk.id,
                embedding_model=embedding_model,
                embedding=[0.0] * _VECTOR_DIMENSIONS,
            )
        )
        db.flush()
        return document, chunk

    try:
        with Session(get_engine()) as db:
            bill = db.scalar(
                select(schema.Bill).where(schema.Bill.bill_key == "94-2025-SF1832")
            )
            baseline_total, baseline_retrievable = _counts(db, bill)
            assert baseline_total == baseline_retrievable == _PARTIAL_BILL_PASSAGES

            # A superseded version with its own passage. Retrieval skips it (#285),
            # so the denominator must skip it too — otherwise a bill whose text was
            # re-engrossed could never report a complete read.
            stale = schema.BillVersion(
                bill_id=bill.id,
                version_code="coverage-fixture-stale",
                version_name="Superseded",
                sequence_number=99,
                is_current=False,
            )
            db.add(stale)
            db.flush()
            stale_version_id = stale.id
            document, chunk = _add_chunk(
                db, version_id=stale.id, embedding_model=_TEST_EMBEDDING_MODEL
            )
            extra_chunk_ids.append((document.id, chunk.id))

            # A passage on the CURRENT version embedded under a different model.
            # Retrieval filters it out (its distance would be meaningless against a
            # query vector from another model), so the denominator must too. The
            # version is selected explicitly rather than taken from
            # ``bill.versions[0]`` — that relationship has no declared order, and it
            # now also contains the stale row created just above, so indexing into it
            # silently attached this passage to the wrong version and let a dropped
            # model filter go unnoticed.
            current_version_id = db.scalar(
                select(schema.BillVersion.id).where(
                    schema.BillVersion.bill_id == bill.id,
                    schema.BillVersion.is_current.is_(True),
                )
            )
            document, chunk = _add_chunk(
                db, version_id=current_version_id, embedding_model="some-other-model"
            )
            extra_chunk_ids.append((document.id, chunk.id))
            db.commit()

        with Session(get_engine()) as db:
            bill = db.scalar(
                select(schema.Bill).where(schema.Bill.bill_key == "94-2025-SF1832")
            )
            total, retrievable = _counts(db, bill)
            assert total == retrievable == baseline_total, (
                "the denominator drifted from what retrieval returns: "
                f"{total} counted vs {retrievable} retrievable"
            )

            # And the SERVED denominator, through the function the answer path calls.
            # Testing the statement alone is not enough: the statement takes the
            # embedding model as an argument, so a call site that forgets to pass it
            # is a separate, silent way to inflate the total — and the inflated total
            # makes a COMPLETE read report itself as a sample, which is the direction
            # that quietly removes the page's caveat.
            from alethical.api.routers.ask import _bill_passage_total

            served = _bill_passage_total(db, bill.id, _TEST_EMBEDDING_MODEL)
            assert served == baseline_total, (
                "the served denominator counted passages retrieval cannot return: "
                f"{served} served vs {baseline_total} retrievable"
            )
    finally:
        with Session(get_engine()) as db:
            for document_id, chunk_id in extra_chunk_ids:
                db.execute(
                    schema.RagChunkEmbedding.__table__.delete().where(
                        schema.RagChunkEmbedding.rag_chunk_id == chunk_id
                    )
                )
                db.execute(
                    schema.RagChunk.__table__.delete().where(
                        schema.RagChunk.id == chunk_id
                    )
                )
                db.execute(
                    schema.RagSectionDocument.__table__.delete().where(
                        schema.RagSectionDocument.id == document_id
                    )
                )
            if stale_version_id is not None:
                db.execute(
                    schema.BillVersion.__table__.delete().where(
                        schema.BillVersion.id == stale_version_id
                    )
                )
            db.commit()


# What the model actually wrote when handed the complete text of HF 719, on the first
# live run of this fix (2026-07-31). It listed 37 of the bill's 98 cities and then
# closed the door on the other 61.
_LIVE_COMPLETENESS_CLAIM = (
    "The cities named in HF 719 receiving infrastructure grants include: "
    "Silver Lake, South Haven, Spicer. "
    "This summarizes all the named cities and counties in HF 719. "
    "The bill does not indicate any additional cities or counties beyond those listed."
)


def test_an_answer_may_not_claim_its_own_list_is_the_whole_set():
    """A different claim from an absence claim, and the one complete coverage does
    not license.

    "The bill names no counties" is about the bill: read the whole bill and it is
    checkable and true. "There are none beyond the ones I listed" is about the
    model's own enumeration, which nothing verifies — so it goes whatever the
    coverage, and the layout-owned note carries the honest version.
    """
    out = strip_list_completeness_claims(_LIVE_COMPLETENESS_CLAIM)
    assert "beyond those listed" not in out
    assert "summarizes all the named cities" not in out
    # The list itself, and the sentence introducing it, survive untouched.
    assert "Silver Lake, South Haven, Spicer." in out
    assert out.startswith("The cities named in HF 719 receiving infrastructure grants")


@pytest.mark.parametrize(
    "claim",
    [
        "The bill does not indicate any additional cities beyond those listed.",
        "There are no other counties besides those named above.",
        "No further agencies are listed beyond the ones shown.",
        "This summarizes all the appropriations in the bill.",
        "That represents all of the named recipients.",
        "These are all the cities receiving grants.",
        "The above are the complete list of grant recipients.",
        # Both of these got through an earlier draft of the guard on a live run and
        # are here by name. The second is the worse one: it contradicted the coverage
        # note printed directly beneath it, so the page told the reader two opposite
        # things about the same list.
        "This is every city named in the bill.",
        (
            "This list includes all named instances of cities and counties receiving "
            "infrastructure grants as per the provided text."
        ),
        "The list contains all the counties.",
    ],
)
def test_every_shape_of_completeness_claim_is_removed(claim):
    """Each of these tells a reader to stop looking. None of them is knowable."""
    body = f"Grants go to Silver Lake and Spicer. {claim}"
    out = strip_list_completeness_claims(body)
    assert out == "Grants go to Silver Lake and Spicer."


@pytest.mark.parametrize(
    "sentence",
    [
        # An honest hedge is the behaviour we want — removing it would make the
        # answer sound MORE certain than the model was, the exact inversion.
        "These are the main agencies identified in the provided text.",
        "Other cities may also receive grants.",
        "The list above is shortened; roughly 60 more cities are named.",
        # A pointer to where the full set lives is useful, not a claim about our list.
        "The complete list of appropriations appears in Article 1.",
        # Ordinary substantive sentences that happen to contain "all" or "complete".
        "All appropriations are onetime appropriations.",
        "The project must be complete before the grant is paid.",
        "Grants go to all 19 cities named in Article 1.",
        # A claim about what the BILL does, not about what the answer listed. The
        # guard requires a pointer back at the answer's own list, and these have none.
        "This bill covers all school districts in the metro area.",
        "The bill lists every county board that must report.",
        "The above grants are onetime.",
    ],
)
def test_the_completeness_guard_leaves_honest_and_substantive_sentences_alone(sentence):
    body = f"Grants go to Silver Lake and Spicer. {sentence}"
    assert strip_list_completeness_claims(body) == body


def test_the_completeness_guard_never_empties_an_answer():
    """An answer that is nothing but a completeness claim keeps its original text.

    Serving an empty answer body would break cite-or-refuse in the worst direction:
    citations rendered against no claim at all. The coverage note is what caveats
    this case.
    """
    only_a_claim = "These are all the cities named in the bill."
    assert strip_list_completeness_claims(only_a_claim) == only_a_claim


def test_a_served_answer_carries_no_completeness_claim(client, monkeypatch):
    """The guard, proved to be wired in rather than merely to exist.

    Every other test of this guard calls it directly, so all of them still passed
    when the call site was removed. This one goes through the API, which is the only
    place that proves a reader is protected.

    It runs on a COMPLETE read on purpose: that is the case where the reader is most
    likely to believe an exhaustive-sounding list, and the case where the model's
    claim would have sat directly under the page's own note saying the opposite —
    two contradictory statements about the same list on one screen.
    """
    monkeypatch.setattr(
        "alethical.api.routers.ask._LIST_QUESTION_WORD_BUDGET",
        _BUDGET_ABOVE_EVERY_SEEDED_BILL,
    )
    _mock_llm_intent(monkeypatch, "bill_text")
    _mock_rag(monkeypatch, answer_text=_LIVE_COMPLETENESS_CLAIM)
    answer = client.post(
        "/api/v1/ask",
        json={"content": "Which cities and counties get grants in SF 1832?"},
    ).json()["data"]["answer"]

    assert answer is not None
    coverage = answer["coverage"]
    assert coverage["used"] == coverage["total"]
    assert coverage["enumerating"] is True
    prose = answer["answer"]
    assert "beyond those listed" not in prose
    assert "summarizes all the named cities" not in prose
    # The list itself survives, and so does the sentence introducing it.
    assert "Silver Lake, South Haven, Spicer." in prose
    assert prose.startswith(
        "The cities named in HF 719 receiving infrastructure grants"
    )
    _assert_cite_or_refuse(answer, "bill_text")


def test_the_two_guards_do_different_jobs_and_are_gated_differently():
    """Stated as a test because collapsing them is the tempting simplification, and
    it would cost one of the two behaviours.

    An absence claim survives a complete read (it is true, and useful). A
    completeness claim never survives. Neither guard can substitute for the other.
    """
    absence = "The bill does not specify any counties."
    completeness = "These are all the counties named."
    # The absence guard sees nothing to do in a completeness claim...
    assert narrow_bill_absence_claims(completeness) == completeness
    # ...and the completeness guard leaves an absence claim standing.
    assert strip_list_completeness_claims(absence) == absence


def test_the_prompt_production_sends_is_more_than_the_constant_the_eval_imports():
    """The drift the #865 eval's own guard cannot see, pinned so it stays visible.

    That eval asserts it scores `RAG_CHAT_SYSTEM_PROMPT` *by identity*, so it can
    never score a copy that fell out of step. #868 slipped past it, because the drift
    is not a copy — it is a layer production adds on top. This test makes the layer
    explicit: production sends strictly more than the constant, the constant is still
    the opening of it, and the added half is the coverage rule.

    It fails if someone reunifies them by dropping the coverage rule, which would
    silently take the prompt-level half of #868 back out.
    """
    from alethical.api.routers.me import RAG_CHAT_SYSTEM_PROMPT, rag_chat_system_prompt

    sent = rag_chat_system_prompt(None)
    assert sent.startswith(RAG_CHAT_SYSTEM_PROMPT)
    assert sent != RAG_CHAT_SYSTEM_PROMPT
    assert _coverage_rule(None) in sent
    # And the two coverage cases really do send different instructions.
    complete = rag_chat_system_prompt(BillTextCoverage(searched=102, total=102))
    assert complete != sent
    assert complete.startswith(RAG_CHAT_SYSTEM_PROMPT)


def test_the_completeness_guard_returns_untouched_text_byte_for_byte():
    """A cleaner with nothing to remove must return the input unchanged, not a
    re-serialized version of it.

    Found by #878's eval run, not by the must-not-change cases above: those compare
    single sentences, and the reformatting only shows on text carrying whitespace the
    tidying step normalizes. It stripped the two trailing spaces that end a Markdown
    hard line break, on 31 of 140 answers it removed nothing from, and cost that
    session a false reading of how often the guard fired.

    Harmless on today's answer page, which renders plain text. Pinned anyway, because
    "harmless" is a fact about the current renderer and this is a fact about the
    function: an untouched answer must be indistinguishable from one that never went
    through here.
    """
    # Two trailing spaces before the newline: a Markdown hard line break.
    body = "Grants go to Silver Lake.  \nOther cities may also receive grants.\n"
    assert strip_list_completeness_claims(body) == body

    # Leading and trailing blank lines survive too — .strip() used to eat them.
    padded = "\n\nGrants go to Spicer and Cook.\n\n"
    assert strip_list_completeness_claims(padded) == padded

    # And a run of blank lines inside an answer it does not touch.
    spaced = "Grants go to Cohasset.\n\n\n\nGrants also go to Crystal."
    assert strip_list_completeness_claims(spaced) == spaced

    # When it DOES remove something, tidying still runs — the gap gets closed.
    with_claim = "Grants go to Silver Lake.  \n\nThese are all the cities named.\n"
    out = strip_list_completeness_claims(with_claim)
    assert "These are all" not in out
    assert out == "Grants go to Silver Lake."
