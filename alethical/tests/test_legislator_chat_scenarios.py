"""Acceptance suite for the legislator persona-chat grounding contract.

Companion to ``test_ask_scenarios.py`` — the same *invariant* style, applied to
the legislator persona chat (``alethical/api/routers/legislator_chat.py``). These
assert the grounded-answer contract (``.claude/rules/grounded-answers.md``) that
any generated-answer surface must honor, so a careless prompt edit can't silently
ship an ungrounded persona-chat claim:

* rule 1, cite-or-refuse: every non-refusal assistant answer resolves at least
  one citation to a real official source URL (``Bill.official_url``); a
  non-refusal with zero resolvable citations FAILS. When the record can't support
  the question the answer is exactly ``LEGISLATOR_CHAT_REFUSAL`` with
  ``was_refusal`` True and no citations.
* refusal-string integrity: the ``LEGISLATOR_CHAT_REFUSAL`` constant and the
  system prompt's refusal instruction can't drift out of sync (a drift would make
  ``was_refusal`` silently go False on a genuine refusal).
* no inline-key leak: bill keys the model writes inline never survive into the
  displayed answer prose (``parse_answer`` strips them).

The OpenAI call is stubbed exactly like ``test_ask_scenarios.py`` /
``test_signed_in_chat_session_and_message_flow`` handle model output — no real
network/LLM calls. DB rows created here are torn down in ``finally`` blocks,
following the isolation pattern the rest of the suite uses against the shared
Postgres instance.
"""

from __future__ import annotations

import re

import pytest
from sqlalchemy import select
from sqlalchemy.orm import Session

from alethical.api.routers.legislator_chat import (
    INLINE_BILL_KEY_PATTERN,
    LEGISLATOR_CHAT_REFUSAL,
    SYSTEM_PROMPT_TEMPLATE,
    parse_answer,
)
from alethical.db.schema import load_schema
from alethical.db.session import get_engine

schema = load_schema()


def _fake_openai(text: str):
    """A minimal OpenAI Responses payload carrying one raw assistant answer,
    shaped like the stubs in test_ask_scenarios.py / the chat contract test."""

    class FakeResponse:
        def raise_for_status(self):
            return None

        def json(self):
            return {"output_text": text}

    return lambda *args, **kwargs: FakeResponse()


def _mock_synthesis(monkeypatch, text: str) -> None:
    monkeypatch.setenv("OPENAI_API_KEY", "test-openai-key")
    monkeypatch.setattr(
        "alethical.api.routers.legislator_chat.requests.post",
        _fake_openai(text),
    )


def _assert_cite_or_refuse(message: dict) -> None:
    """Rule 1 for a persisted persona-chat assistant message: either it is the
    exact refusal (``was_refusal`` True, no citations), or every rendered
    citation resolves to an official source URL and at least one exists."""
    if message["was_refusal"]:
        assert message["content"].strip() == LEGISLATOR_CHAT_REFUSAL
        assert message["citations"] == []
        return
    assert message["citations"], (
        "a non-refusal answer must cite at least one bill (cite-or-refuse)"
    )
    for citation in message["citations"]:
        assert citation["official_url"], (
            "every citation must resolve to an official URL"
        )
        assert citation["bill_key"], "every citation must be addressable by bill key"


@pytest.fixture()
def record_session(client):
    """A legislator-chat session for a legislator who actually has a record
    (>=1 sponsorship), created directly in the DB so the tests don't depend on
    the router's hardcoded demo legislator. Yields the session id plus the real
    bill keys / official URLs in that legislator's record, so a stubbed answer
    can cite keys that genuinely resolve. Torn down afterward."""
    Sponsorship = schema.Sponsorship
    LegislatorChatSession = schema.LegislatorChatSession
    LegislatorChatMessage = schema.LegislatorChatMessage
    Bill = schema.Bill

    with Session(get_engine()) as db:
        # Pick a legislator who has >=1 sponsored bill that actually resolves to
        # an official URL, so cite-or-refuse has something real to resolve to.
        legislator_id = db.scalar(
            select(Sponsorship.legislator_id)
            .join(Bill, Bill.id == Sponsorship.bill_id)
            .where(Bill.official_url.is_not(None))
            .limit(1)
        )
        assert legislator_id is not None, (
            "sample data must seed >=1 sponsorship with a resolvable bill"
        )
        bill_rows = db.execute(
            select(Bill.bill_key, Bill.official_url)
            .join(Sponsorship, Sponsorship.bill_id == Bill.id)
            .where(
                Sponsorship.legislator_id == legislator_id,
                Bill.official_url.is_not(None),
            )
        ).all()
        record = {key: url for key, url in bill_rows}
        assert record, "the chosen legislator must have >=1 resolvable bill"
        session_row = LegislatorChatSession(legislator_id=legislator_id)
        db.add(session_row)
        db.commit()
        session_id = str(session_row.id)

    try:
        yield {"session_id": session_id, "record": record}
    finally:
        with Session(get_engine()) as db:
            db.query(LegislatorChatMessage).filter(
                LegislatorChatMessage.session_id == session_id
            ).delete(synchronize_session=False)
            db.query(LegislatorChatSession).filter(
                LegislatorChatSession.id == session_id
            ).delete(synchronize_session=False)
            db.commit()


@pytest.fixture()
def no_record_session(client):
    """A legislator-chat session for a throwaway legislator with no record at
    all, so the structural refusal path (empty ``record_context``) is exercised
    without an OpenAI call. Torn down afterward."""
    Legislator = schema.Legislator
    LegislatorChatSession = schema.LegislatorChatSession
    LegislatorChatMessage = schema.LegislatorChatMessage

    slug = "test-persona-chat-no-record"
    with Session(get_engine()) as db:
        jurisdiction_id = db.scalar(select(Legislator.jurisdiction_id).limit(1))
        assert jurisdiction_id is not None
        # Defensive: clear any row a crashed prior run may have left, so the
        # unique (jurisdiction_id, slug/external_key) insert below can't collide.
        db.query(Legislator).filter(Legislator.slug == slug).delete(
            synchronize_session=False
        )
        db.commit()
        legislator = Legislator(
            jurisdiction_id=jurisdiction_id,
            slug="test-persona-chat-no-record",
            external_key="test-persona-chat-no-record",
            full_name="Test NoRecord Persona",
            sort_name="Test NoRecord Persona",
        )
        db.add(legislator)
        db.flush()
        session_row = LegislatorChatSession(legislator_id=legislator.id)
        db.add(session_row)
        db.commit()
        session_id = str(session_row.id)
        legislator_id = legislator.id

    try:
        yield {"session_id": session_id}
    finally:
        with Session(get_engine()) as db:
            db.query(LegislatorChatMessage).filter(
                LegislatorChatMessage.session_id == session_id
            ).delete(synchronize_session=False)
            db.query(LegislatorChatSession).filter(
                LegislatorChatSession.id == session_id
            ).delete(synchronize_session=False)
            db.query(Legislator).filter(Legislator.id == legislator_id).delete(
                synchronize_session=False
            )
            db.commit()


def test_non_refusal_answer_resolves_a_citation_to_official_url(
    client, monkeypatch, record_session
):
    """Rule 1: a grounded persona-chat answer resolves >=1 citation to a real
    ``Bill.official_url``. The stub cites a bill key that genuinely appears in
    the legislator's record, so a break in ``parse_answer``'s key->official_url
    resolution fails this test."""
    bill_key, official_url = next(iter(record_session["record"].items()))
    _mock_synthesis(
        monkeypatch,
        f"I've worked on this in the legislature.\nSOURCES: {bill_key}",
    )

    response = client.post(
        f"/legislator-chat/sessions/{record_session['session_id']}/messages",
        json={"content": "What's your record on the budget?"},
    )
    assert response.status_code == 201
    message = response.json()["data"]

    assert message["was_refusal"] is False
    _assert_cite_or_refuse(message)
    resolved = {c["bill_key"]: c["official_url"] for c in message["citations"]}
    assert bill_key in resolved
    assert resolved[bill_key] == official_url


def test_unresolvable_source_is_refused_in_code_and_check_still_bites(
    client, monkeypatch, record_session
):
    """A non-refusal answer whose only cited key does NOT resolve to a real bill
    is now enforced in code: it leaves zero resolved citations, and the grounding
    guard (plan item 3) converts a zero-citation answer into the refusal — so the
    router refuses rather than shipping an ungrounded position. Separately,
    ``_assert_cite_or_refuse`` must still bite on that ungrounded shape directly,
    proving the acceptance check would catch one if a regression ever let it
    through."""
    _mock_synthesis(
        monkeypatch,
        "Here's my totally unsupported position.\nSOURCES: 99-9999-ZZ9999",
    )

    response = client.post(
        f"/legislator-chat/sessions/{record_session['session_id']}/messages",
        json={"content": "What's your stance on something you never touched?"},
    )
    assert response.status_code == 201
    message = response.json()["data"]

    # Integrated behavior: the code enforces cite-or-refuse. An unresolvable
    # citation resolves to zero citations, and the grounding guard refuses.
    assert message["was_refusal"] is True
    assert message["content"].strip() == LEGISLATOR_CHAT_REFUSAL
    assert message["citations"] == []
    _assert_cite_or_refuse(message)

    # The acceptance check itself must still reject an ungrounded (non-refusal,
    # no-citation) shape, so a future regression that lets one through is caught.
    ungrounded = {"was_refusal": False, "content": "Ungrounded.", "citations": []}
    with pytest.raises(AssertionError):
        _assert_cite_or_refuse(ungrounded)


def test_refusal_path_sets_flag_and_empties_citations(
    client, monkeypatch, record_session
):
    """When the model refuses, the persisted answer is exactly
    ``LEGISLATOR_CHAT_REFUSAL``, ``was_refusal`` is True, and citations are
    empty — even if the model appended a stray SOURCES line."""
    _mock_synthesis(
        monkeypatch,
        f"{LEGISLATOR_CHAT_REFUSAL}\nSOURCES: NONE",
    )

    response = client.post(
        f"/legislator-chat/sessions/{record_session['session_id']}/messages",
        json={"content": "What's your favorite color?"},
    )
    assert response.status_code == 201
    message = response.json()["data"]

    assert message["content"].strip() == LEGISLATOR_CHAT_REFUSAL
    assert message["was_refusal"] is True
    assert message["citations"] == []
    _assert_cite_or_refuse(message)


def test_empty_record_refuses_without_calling_openai(
    client, monkeypatch, no_record_session
):
    """A legislator with no record refuses structurally in code
    (``synthesize_legislator_answer`` short-circuits on empty context) — no
    OpenAI call, exact refusal string, no citations."""

    def fail_post(*args, **kwargs):
        raise AssertionError("OpenAI must not be called when the record is empty")

    monkeypatch.setenv("OPENAI_API_KEY", "test-openai-key")
    monkeypatch.setattr(
        "alethical.api.routers.legislator_chat.requests.post", fail_post
    )

    response = client.post(
        f"/legislator-chat/sessions/{no_record_session['session_id']}/messages",
        json={"content": "What have you done on transportation?"},
    )
    assert response.status_code == 201
    message = response.json()["data"]

    assert message["content"].strip() == LEGISLATOR_CHAT_REFUSAL
    assert message["was_refusal"] is True
    assert message["citations"] == []


def test_refusal_string_cannot_drift_from_system_prompt():
    """Refusal-string integrity: the system prompt is rendered from the
    ``{refusal}`` placeholder, so the instruction and the ``was_refusal``
    comparison constant can't diverge. If someone hardcodes a different refusal
    string in the template (breaking the ``was_refusal`` equality check), one of
    these assertions fails."""
    # The template must interpolate the constant, never carry a hardcoded copy.
    assert "{refusal}" in SYSTEM_PROMPT_TEMPLATE
    assert LEGISLATOR_CHAT_REFUSAL not in SYSTEM_PROMPT_TEMPLATE

    rendered = SYSTEM_PROMPT_TEMPLATE.format(
        legislator_name="Test Legislator",
        refusal=LEGISLATOR_CHAT_REFUSAL,
        record_context="[94-2025-HF1] Some bill",
    )
    # The rendered instruction must tell the model to reply with exactly the same
    # string the router compares against, verbatim.
    assert f'"{LEGISLATOR_CHAT_REFUSAL}"' in rendered


def test_parse_answer_strips_inline_bill_keys_from_prose():
    """No inline-key leak (unit): ``parse_answer`` removes any bill key the model
    writes inline in the prose while still resolving the SOURCES line."""
    bill = type(
        "FakeBill",
        (),
        {
            "bill_key": "94-2025-HF17",
            "title": "A bill",
            "official_url": "https://example.gov/hf17",
        },
    )()
    raw = (
        "I authored the permitting bill [94-2025-HF17] and voted for 94-2025-SF9 too.\n"
        "SOURCES: 94-2025-HF17"
    )
    content, citations = parse_answer(raw, {"94-2025-HF17": bill})

    assert not INLINE_BILL_KEY_PATTERN.search(content), (
        "no bill key may remain in displayed prose"
    )
    assert "94-2025-HF17" not in content
    assert "94-2025-SF9" not in content
    # The SOURCES line still resolves to the citation pill.
    assert [c["bill_key"] for c in citations] == ["94-2025-HF17"]
    assert citations[0]["official_url"] == "https://example.gov/hf17"


def test_end_to_end_answer_prose_carries_no_inline_bill_key(
    client, monkeypatch, record_session
):
    """No inline-key leak (end-to-end): even when the model writes a key inline,
    the persisted answer content is clean of bill keys while the SOURCES line
    still yields a resolved citation."""
    bill_key, _ = next(iter(record_session["record"].items()))
    _mock_synthesis(
        monkeypatch,
        f"I led the effort here [{bill_key}] and I'm proud of it.\nSOURCES: {bill_key}",
    )

    response = client.post(
        f"/legislator-chat/sessions/{record_session['session_id']}/messages",
        json={"content": "Tell me about the bill you led."},
    )
    assert response.status_code == 201
    message = response.json()["data"]

    assert not re.search(INLINE_BILL_KEY_PATTERN, message["content"])
    assert bill_key not in message["content"]
    _assert_cite_or_refuse(message)
    assert bill_key in {c["bill_key"] for c in message["citations"]}
