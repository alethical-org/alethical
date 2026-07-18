from __future__ import annotations

import html
import logging
import math
import os
import re
import uuid

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import HTMLResponse
import requests
from sqlalchemy import select
from sqlalchemy.orm import Session

from alethical.api.schemas import CollectionResponse, DetailResponse
from alethical.db.schema import load_schema
from alethical.db.session import get_db
from alethical.pipeline.rag_ingest import (
    DEFAULT_RAG_MODEL,
    _build_embeddings,
    effective_embedding_model,
)

logger = logging.getLogger(__name__)

schema = load_schema()
Chamber = schema.Chamber
District = schema.District
Legislator = schema.Legislator
LegislatorChatMessage = schema.LegislatorChatMessage
LegislatorChatRole = schema.LegislatorChatRole
LegislatorChatSession = schema.LegislatorChatSession
LegislatorServicePeriod = schema.LegislatorServicePeriod
legislator_chat_record_stmt = schema.legislator_chat_record_stmt

router = APIRouter()

# Internal proof-of-concept demo: single hardcoded legislator (richest data of the 119
# in the DB - 50 sponsorships, 51 votes). Not for real users; see plan doc for scope.
ISAAC_SCHULTZ_ID = uuid.UUID("da8ee5cc-0f9d-4854-b5bc-1b0fd8307f78")

LEGISLATOR_CHAT_REFUSAL = "I don't have a public record on that."

SOURCES_LINE_PATTERN = re.compile(
    r"\n?\s*SOURCES:\s*(.*)\s*$", re.IGNORECASE | re.DOTALL
)
INLINE_BILL_KEY_PATTERN = re.compile(r"\[?\b\d{2}-\d{4}-[A-Za-z]+\d+\b\]?")

SYSTEM_PROMPT_TEMPLATE = """You are {legislator_name}, a Minnesota state legislator, speaking directly and
conversationally with a constituent — as if this were a real conversation with you.
This is an internal research demo simulating him, not the real person, but you should
respond the way he would: warm, direct, in plain first-person language, not like a
database readout.

Ground everything you say in the record below (his bill sponsorships, votes, and bill
summaries/policy areas). You do not need an exact keyword match to the question — connect
it to any bill in the record that is topically or thematically related (for example, a
bill about firearm permitting is relevant to a question about "gun rights"; a bill about
workforce training is relevant to a question about "jobs"). Use the record to state his
likely position based on what he sponsored, co-sponsored, or how he voted, and briefly
explain the reasoning in his voice.

Hard limits on what you may infer:
- Do NOT invent personal facts, biography, excuses, or explanations that are not derivable
  from the record (e.g. never make up a reason for an absence, a personal anecdote, a family
  detail, or a scheduling conflict — if the record only shows "absent" with no reason, say
  only that, do not fabricate why).
- Do NOT assume or invoke a political party's general platform, talking points, or
  stereotypes to fill gaps. Only state positions actually traceable to a specific bill,
  sponsorship, or vote in the record below.
- Do not invent facts, events, or positions that have no connection at all to anything in
  the record.

Style:
- Answer the actual question directly in the first sentence — do not dodge, hedge
  excessively, or ask the constituent clarifying questions before answering.
- Write like a real person talking, not a press release: contractions, plain words, punchy
  sentences. Vary your phrasing — do not open every answer the same way (e.g. don't always
  start with "I've co-authored legislation...").
- Do not end your answer with a canned invitation like "let me know if you have more
  questions!" or "I'd love to hear your thoughts!" — just answer and stop.

Never mention bill numbers, bill keys, or citations anywhere in your answer text — speak
naturally, the way a person would in conversation. Bill references are shown to the reader
separately as clickable sources, so never write them inline.

Only refuse if there is truly nothing in the record that relates to the topic in any way —
no related bill, no related policy area, nothing. In that case, respond with exactly:
"{refusal}" — nothing else, no sources line.

After your answer, on its own new line, write exactly:
SOURCES: <comma-separated bill keys you drew on, e.g. 94-2025-HF17, 94-2025-HF9>
(or "SOURCES: NONE" if you did not draw on any specific bill)

His record:
{record_context}"""


PARTY_NAMES = {
    "R": "Republican",
    "D": "Democrat",
    "DFL": "Democrat",
    "I": "Independent",
}


def load_legislator_bills(db: Session, legislator_id: uuid.UUID) -> list:
    """Every bill this legislator sponsored or voted on, with current summary enrichment."""
    return db.scalars(legislator_chat_record_stmt(legislator_id)).unique().all()


def load_legislator_profile(db: Session, legislator_id: uuid.UUID) -> dict:
    """Current service-period facts (party, title, district, chamber, official profile link)."""
    row = db.execute(
        select(LegislatorServicePeriod, Chamber, District)
        .join(Chamber, Chamber.id == LegislatorServicePeriod.chamber_id)
        .join(District, District.id == LegislatorServicePeriod.district_id)
        .where(
            LegislatorServicePeriod.legislator_id == legislator_id,
            LegislatorServicePeriod.is_current.is_(True),
        )
    ).first()
    if row is None:
        return {}
    service_period, chamber, district = row
    return {
        "party": PARTY_NAMES.get(service_period.party, service_period.party),
        "title": service_period.title,
        "chamber_name": chamber.name,
        "district_code": district.code,
        "profile_url": service_period.profile_url,
    }


def summarize_record_stats(bills: list) -> dict:
    """Aggregate counts + topic tags for the profile card, computed from the same record the chat uses."""
    sponsorship_count = sum(len(bill.sponsorships) for bill in bills)
    vote_count = sum(
        len(vote_event.records) for bill in bills for vote_event in bill.vote_events
    )
    bills_with_summary = sum(1 for bill in bills if bill.enrichments)
    topics: list[str] = []
    for bill in bills:
        for enrichment in bill.enrichments:
            for topic in (enrichment.content_json or {}).get("policy_areas") or []:
                if topic not in topics:
                    topics.append(topic)
    return {
        "sponsorship_count": sponsorship_count,
        "vote_count": vote_count,
        "bills_with_summary": bills_with_summary,
        "topics": topics[:10],
    }


def format_record_context(bills: list) -> str:
    """Flatten a legislator's bills into a text block for the system prompt."""
    entries = []
    for bill in bills:
        lines = [f"[{bill.bill_key}] {bill.title.strip()}"]
        for sponsorship in bill.sponsorships:
            lines.append(f"Role: {sponsorship.role.value}")
        for vote_event in bill.vote_events:
            for record in vote_event.records:
                when = (
                    vote_event.occurred_at.date().isoformat()
                    if vote_event.occurred_at
                    else "unknown date"
                )
                lines.append(
                    f"Vote: {record.vote_value.value} ({when}, motion: {vote_event.motion_text or 'n/a'})"
                )
        for enrichment in bill.enrichments:
            content = enrichment.content_json or {}
            summary = content.get("summary")
            if summary:
                lines.append(f"Summary: {summary}")
            key_points = content.get("key_points")
            if key_points:
                lines.append(f"Key points: {'; '.join(key_points)}")
            policy_areas = content.get("policy_areas")
            if policy_areas:
                lines.append(f"Policy areas: {', '.join(policy_areas)}")
        entries.append("\n".join(lines))
    return "\n\n".join(entries)


def parse_answer(raw_text: str, bill_by_key: dict) -> tuple[str, list[dict]]:
    """Split the model's raw output into display text and a resolved citations list."""
    match = SOURCES_LINE_PATTERN.search(raw_text)
    if match:
        content = raw_text[: match.start()].strip()
        keys_raw = match.group(1).strip()
    else:
        content = raw_text.strip()
        keys_raw = ""

    # Defensive cleanup: strip any inline bill-key citations that slipped through despite
    # the system prompt instructing the model never to write them in the prose.
    content = INLINE_BILL_KEY_PATTERN.sub("", content)
    content = re.sub(r"[ \t]{2,}", " ", content).strip()

    citations = []
    if keys_raw and keys_raw.upper() != "NONE":
        for raw_key in keys_raw.split(","):
            key = raw_key.strip().strip("[]")
            bill = bill_by_key.get(key)
            if bill is not None:
                citations.append(
                    {
                        "bill_key": bill.bill_key,
                        "title": bill.title,
                        "official_url": bill.official_url,
                    }
                )
    return content, citations


# Post-hoc citation verification (plan doc item 4; docs/persona-rag-chatbot-research.md
# §5, "Citation accuracy is a structural problem"). The model self-reports a SOURCES line,
# but citation-prose alignment is unreliable at the claim level — models cite the right
# document yet not the right span. So we don't trust the linkage: for each cited bill we
# embed its own summary/key_points and the answer text and drop citations whose cosine
# similarity falls below the threshold, rather than render a bill the record doesn't
# actually support as a green source pill (cite-or-refuse, .claude/rules/grounded-answers.md
# rule 1).
#
# Threshold: with text-embedding-3-small, cosine similarity between an answer and a
# genuinely supporting bill's summary typically runs ~0.3-0.6 while an off-topic bill sits
# ~0.05-0.15, so 0.25 is a conservative floor that separates them. Set as a default here
# rather than empirically tuned live; revisit once a working key allows a live sweep.
# Override with LEGISLATOR_CHAT_CITATION_MIN_SIMILARITY.
CITATION_SIMILARITY_THRESHOLD = float(
    os.environ.get("LEGISLATOR_CHAT_CITATION_MIN_SIMILARITY", "0.25")
)


def _bill_support_text(bill) -> str:
    """The bill's own words a citation must semantically back — title + summary + key points."""
    parts = [bill.title.strip() if bill.title else ""]
    for enrichment in bill.enrichments:
        content = enrichment.content_json or {}
        if content.get("summary"):
            parts.append(content["summary"])
        key_points = content.get("key_points")
        if key_points:
            parts.append("; ".join(key_points))
    return "\n".join(part for part in parts if part).strip()


def _cosine_similarity(a: list[float], b: list[float]) -> float:
    dot = sum(x * y for x, y in zip(a, b))
    norm_a = math.sqrt(sum(x * x for x in a))
    norm_b = math.sqrt(sum(y * y for y in b))
    if norm_a == 0.0 or norm_b == 0.0:
        return 0.0
    return dot / (norm_a * norm_b)


def _default_citation_embedder():
    """Batch embedder for verification, or None when no real embedding model is available.

    Verification is semantic, so the deterministic hash fallback (no OPENAI_API_KEY) is
    meaningless here — verification is real-model-only and skipped otherwise (degrade
    safe, not drop-everything)."""
    if effective_embedding_model(DEFAULT_RAG_MODEL) != DEFAULT_RAG_MODEL:
        return None
    return lambda texts: _build_embeddings(
        texts, model=DEFAULT_RAG_MODEL, batch_size=max(1, len(texts))
    )


def verify_citations(
    answer_text: str,
    citations: list[dict],
    bill_by_key: dict,
    *,
    threshold: float = CITATION_SIMILARITY_THRESHOLD,
    embed=None,
) -> tuple[list[dict], list[dict]]:
    """Drop self-reported citations whose bill doesn't semantically back the answer.

    Returns (kept, dropped). Degrades safely: with no real embedding model or on any
    embedding failure it returns citations unchanged rather than 500ing the request or
    wrongly dropping everything — a verification outage must not silently refuse.
    """
    if not citations:
        return citations, []
    if embed is None:
        embed = _default_citation_embedder()
    if embed is None:
        return citations, []

    support_texts = [
        _bill_support_text(bill_by_key[c["bill_key"]])
        if c["bill_key"] in bill_by_key
        else ""
        for c in citations
    ]
    try:
        vectors = embed([answer_text, *support_texts])
    except Exception:
        logger.warning(
            "legislator-chat citation verification skipped: embedding failed",
            exc_info=True,
        )
        return citations, []

    answer_vec = vectors[0]
    kept: list[dict] = []
    dropped: list[dict] = []
    for citation, support_text, vector in zip(citations, support_texts, vectors[1:]):
        score = _cosine_similarity(answer_vec, vector) if support_text else 0.0
        if score >= threshold:
            kept.append(citation)
        else:
            dropped.append({**citation, "similarity": round(score, 4)})
    return kept, dropped


def extract_openai_response_text(payload: dict) -> str | None:
    text_value = payload.get("output_text")
    if isinstance(text_value, str) and text_value.strip():
        return text_value.strip()

    output = payload.get("output")
    if not isinstance(output, list):
        return None
    parts: list[str] = []
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
                parts.append(text.strip())
    return "\n".join(parts) if parts else None


def synthesize_legislator_answer(
    question: str,
    record_context: str,
    history: list[LegislatorChatMessage],
    *,
    legislator_name: str,
) -> str:
    if not record_context.strip():
        return LEGISLATOR_CHAT_REFUSAL

    api_key = os.environ.get("OPENAI_API_KEY")
    if not api_key:
        raise HTTPException(
            status_code=503,
            detail="OPENAI_API_KEY is required for legislator chat synthesis",
        )

    model = os.environ.get("OPENAI_RAG_CHAT_MODEL", "gpt-4o-mini")
    system_prompt = SYSTEM_PROMPT_TEMPLATE.format(
        legislator_name=legislator_name,
        refusal=LEGISLATOR_CHAT_REFUSAL,
        record_context=record_context,
    )
    input_messages = [{"role": "system", "content": system_prompt}]
    for message in history:
        role = "user" if message.role == LegislatorChatRole.user else "assistant"
        input_messages.append({"role": role, "content": message.content})
    input_messages.append({"role": "user", "content": question})

    try:
        response = requests.post(
            "https://api.openai.com/v1/responses",
            headers={
                "Authorization": f"Bearer {api_key}",
                "Content-Type": "application/json",
            },
            json={"model": model, "input": input_messages},
            timeout=30,
        )
        response.raise_for_status()
        payload = response.json()
        text_value = extract_openai_response_text(payload)
        if text_value:
            return text_value
    except requests.RequestException as exc:
        raise HTTPException(
            status_code=502, detail="OpenAI legislator chat synthesis failed"
        ) from exc

    raise HTTPException(
        status_code=502, detail="OpenAI legislator chat synthesis returned no answer"
    )


def session_payload(row: LegislatorChatSession) -> dict:
    return {
        "id": str(row.id),
        "legislator_id": str(row.legislator_id),
        "last_message_at": row.last_message_at,
        "created_at": row.created_at,
    }


def message_payload(row: LegislatorChatMessage) -> dict:
    return {
        "id": str(row.id),
        "role": row.role.value,
        "content": row.content,
        "was_refusal": row.was_refusal,
        "citations": row.citations or [],
        "created_at": row.created_at,
    }


@router.post("/sessions", response_model=DetailResponse, status_code=201)
def create_session(db: Session = Depends(get_db)):
    legislator = db.scalar(select(Legislator).where(Legislator.id == ISAAC_SCHULTZ_ID))
    if legislator is None:
        raise HTTPException(status_code=404, detail="legislator not found")
    row = LegislatorChatSession(legislator_id=legislator.id)
    db.add(row)
    db.commit()
    db.refresh(row)
    return DetailResponse(data=session_payload(row))


@router.get("/sessions/{session_id}/messages", response_model=CollectionResponse)
def list_messages(session_id: str, db: Session = Depends(get_db)):
    session_row = db.scalar(
        select(LegislatorChatSession).where(LegislatorChatSession.id == session_id)
    )
    if session_row is None:
        raise HTTPException(status_code=404, detail="chat session not found")
    rows = db.scalars(
        select(LegislatorChatMessage)
        .where(LegislatorChatMessage.session_id == session_row.id)
        .order_by(
            LegislatorChatMessage.created_at.asc(), LegislatorChatMessage.id.asc()
        )
    ).all()
    data = [message_payload(row) for row in rows]
    return CollectionResponse(
        data=data, page={"limit": len(data), "next_cursor": None, "has_more": False}
    )


@router.post(
    "/sessions/{session_id}/messages", response_model=DetailResponse, status_code=201
)
def create_message(session_id: str, request: dict, db: Session = Depends(get_db)):
    content = (request or {}).get("content", "").strip()
    if not content:
        raise HTTPException(status_code=400, detail="content is required")

    session_row = db.scalar(
        select(LegislatorChatSession).where(LegislatorChatSession.id == session_id)
    )
    if session_row is None:
        raise HTTPException(status_code=404, detail="chat session not found")

    legislator = db.scalar(
        select(Legislator).where(Legislator.id == session_row.legislator_id)
    )
    if legislator is None:
        raise HTTPException(status_code=404, detail="legislator not found")

    history = db.scalars(
        select(LegislatorChatMessage)
        .where(LegislatorChatMessage.session_id == session_row.id)
        .order_by(LegislatorChatMessage.created_at.desc())
        .limit(10)
    ).all()
    history = list(reversed(history))

    user_message = LegislatorChatMessage(
        session_id=session_row.id, role=LegislatorChatRole.user, content=content
    )
    db.add(user_message)
    # Commit (not just flush) before the LLM call: func.now() freezes to transaction start,
    # so leaving this in the same transaction as the assistant message gives both rows an
    # identical created_at (breaks ordering). Committing now also ensures the user's message
    # survives if the LLM call below fails/times out, instead of being rolled back with it.
    db.commit()
    db.refresh(user_message)

    bills = load_legislator_bills(db, legislator.id)
    bill_by_key = {bill.bill_key: bill for bill in bills}
    record_context = format_record_context(bills)
    raw_answer = synthesize_legislator_answer(
        content,
        record_context,
        history,
        legislator_name=legislator.full_name,
    )
    answer_text, citations = parse_answer(raw_answer, bill_by_key)
    was_refusal = answer_text.strip() == LEGISLATOR_CHAT_REFUSAL
    if was_refusal:
        citations = []
    else:
        # Don't trust the model's self-reported SOURCES: verify each cited bill actually
        # backs the answer, and drop those that don't (research §5; rule 1 cite-or-refuse).
        had_citations = bool(citations)
        citations, dropped = verify_citations(answer_text, citations, bill_by_key)
        if dropped:
            logger.info(
                "legislator-chat dropped %d unsupported citation(s): %s",
                len(dropped),
                ", ".join(f"{d['bill_key']}={d['similarity']}" for d in dropped),
            )
        if had_citations and not citations:
            # Every self-reported source failed verification — the answer is ungrounded
            # (post-hoc citation). Refuse rather than ship an answer with no valid source.
            answer_text = LEGISLATOR_CHAT_REFUSAL
            was_refusal = True

    assistant_message = LegislatorChatMessage(
        session_id=session_row.id,
        role=LegislatorChatRole.assistant,
        content=answer_text,
        was_refusal=was_refusal,
        citations=citations,
    )
    db.add(assistant_message)
    session_row.last_message_at = assistant_message.created_at
    db.commit()
    db.refresh(assistant_message)

    return DetailResponse(data=message_payload(assistant_message))


_PAGE_STYLES = """
      :root {
        color-scheme: light;
        font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        background: #f6f7f9;
        color: #1f2933;
      }
      body { margin: 0; }
      header.topbar {
        display: flex; align-items: center; justify-content: space-between;
        padding: 14px 24px; background: #fff; border-bottom: 1px solid #e4e7ec;
      }
      .wordmark { font-weight: 800; letter-spacing: 0.04em; font-size: 15px; }
      .topbar .tag { color: #667085; font-size: 12px; }
      main { max-width: 760px; margin: 0 auto; padding: 24px 20px 48px; display: flex; flex-direction: column; gap: 16px; }

      .card { background: #fff; border: 1px solid #e4e7ec; border-radius: 10px; }
      .profile-card { padding: 20px; }
      .profile-head { display: flex; gap: 14px; align-items: flex-start; }
      .avatar {
        width: 52px; height: 52px; border-radius: 50%; background: #101828; color: #fff;
        display: flex; align-items: center; justify-content: center; font-weight: 700; font-size: 16px; flex-shrink: 0;
      }
      .profile-head h1 { font-size: 19px; margin: 0 0 2px; }
      .profile-head .subtitle { color: #667085; font-size: 13px; margin: 0; }
      .profile-head a.profile-link { font-size: 12px; color: #067647; text-decoration: none; font-weight: 600; }
      .profile-head a.profile-link:hover { text-decoration: underline; }
      .section-label {
        font-size: 11px; font-weight: 700; letter-spacing: 0.06em; text-transform: uppercase;
        color: #667085; margin: 18px 0 8px;
      }
      .topics { display: flex; flex-wrap: wrap; gap: 6px; }
      .topic-chip {
        font-size: 12px; padding: 4px 10px; border-radius: 999px; background: #f2f4f7; color: #344054;
      }
      .stats { display: flex; gap: 10px; flex-wrap: wrap; }
      .stat-tile {
        flex: 1; min-width: 140px; border: 1px solid #e4e7ec; border-radius: 8px; padding: 10px 12px;
      }
      .stat-tile strong { display: block; font-size: 18px; }
      .stat-tile span { font-size: 12px; color: #667085; }

      .chat-card { display: flex; flex-direction: column; overflow: hidden; }
      .chat-head {
        display: flex; align-items: center; justify-content: space-between;
        padding: 14px 18px; border-bottom: 1px solid #e4e7ec;
      }
      .chat-head h2 { font-size: 15px; margin: 0; }
      .ai-badge {
        font-size: 11px; font-weight: 700; letter-spacing: 0.03em; color: #fff; background: #101828;
        padding: 4px 10px; border-radius: 999px; white-space: nowrap;
      }
      .chat-disclosure { padding: 8px 18px; font-size: 12px; color: #667085; border-bottom: 1px solid #eaecf0; }
      #log { padding: 16px 18px; display: flex; flex-direction: column; gap: 12px; max-height: 50vh; overflow-y: auto; }
      .msg { max-width: 85%; padding: 10px 14px; border-radius: 10px; font-size: 14px; line-height: 1.4; white-space: pre-wrap; }
      .msg.user { align-self: flex-end; background: #eafaf1; color: #067647; }
      .msg.assistant { align-self: flex-start; background: #f2f4f7; color: #1f2933; }
      .msg.assistant.refusal { border: 1px dashed #98a2b3; }
      .citations { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 8px; }
      .citation-pill {
        font-size: 12px; padding: 4px 10px; border-radius: 999px; background: #fff;
        border: 1px solid #d0d5dd; color: #067647; text-decoration: none; white-space: nowrap;
      }
      .citation-pill:hover { background: #eafaf1; }
      .typing-dots { display: inline-flex; gap: 4px; align-items: center; padding: 4px 0; }
      .typing-dots span {
        width: 6px; height: 6px; border-radius: 50%; background: #98a2b3;
        animation: typing-bounce 1.2s infinite ease-in-out;
      }
      .typing-dots span:nth-child(2) { animation-delay: 0.2s; }
      .typing-dots span:nth-child(3) { animation-delay: 0.4s; }
      @keyframes typing-bounce {
        0%, 60%, 100% { transform: translateY(0); opacity: 0.5; }
        30% { transform: translateY(-4px); opacity: 1; }
      }
      .suggestions { display: flex; flex-wrap: wrap; gap: 8px; padding: 0 18px 14px; }
      .suggestion-pill {
        font-size: 12px; padding: 6px 12px; border-radius: 999px; background: #fff;
        border: 1px solid #d0d5dd; color: #344054; cursor: pointer;
      }
      .suggestion-pill:hover { background: #f2f4f7; }
      form { display: flex; gap: 8px; padding: 14px 18px; border-top: 1px solid #e4e7ec; }
      input[type=text] { flex: 1; padding: 12px; border: 1px solid #d0d5dd; border-radius: 8px; font-size: 14px; }
      button.send-btn {
        padding: 12px 18px; border: none; border-radius: 8px; background: #12b76a; color: #fff;
        font-size: 14px; font-weight: 600; cursor: pointer;
      }
      button.send-btn:disabled { opacity: 0.6; cursor: default; }
"""

_PAGE_SCRIPT = """
      const log = document.getElementById('log');
      const form = document.getElementById('form');
      const input = document.getElementById('input');
      const send = document.getElementById('send');
      let sessionId = null;

      document.querySelectorAll('.suggestion-pill').forEach((pill) => {
        pill.addEventListener('click', () => {
          input.value = pill.dataset.question;
          form.requestSubmit();
        });
      });

      function addMessage(role, content, wasRefusal, citations) {
        const el = document.createElement('div');
        el.className = 'msg ' + role + (wasRefusal ? ' refusal' : '');
        el.textContent = content;
        if (citations && citations.length) {
          const list = document.createElement('div');
          list.className = 'citations';
          for (const citation of citations) {
            const pill = document.createElement('a');
            pill.className = 'citation-pill';
            pill.textContent = citation.bill_key;
            pill.title = citation.title;
            if (citation.official_url) {
              pill.href = citation.official_url;
              pill.target = '_blank';
              pill.rel = 'noopener noreferrer';
            } else {
              pill.href = '#';
              pill.addEventListener('click', (e) => e.preventDefault());
            }
            list.appendChild(pill);
          }
          el.appendChild(list);
        }
        log.appendChild(el);
        log.scrollTop = log.scrollHeight;
        return el;
      }

      function addTypingIndicator() {
        const el = document.createElement('div');
        el.className = 'msg assistant';
        el.innerHTML = '<div class="typing-dots"><span></span><span></span><span></span></div>';
        log.appendChild(el);
        log.scrollTop = log.scrollHeight;
        return el;
      }

      async function ensureSession() {
        if (sessionId) return sessionId;
        const res = await fetch('/legislator-chat/sessions', { method: 'POST' });
        const body = await res.json();
        sessionId = body.data.id;
        return sessionId;
      }

      form.addEventListener('submit', async (event) => {
        event.preventDefault();
        const content = input.value.trim();
        if (!content) return;
        input.value = '';
        send.disabled = true;
        addMessage('user', content, false, []);
        const typingEl = addTypingIndicator();
        try {
          const id = await ensureSession();
          const res = await fetch(`/legislator-chat/sessions/${id}/messages`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ content }),
          });
          typingEl.remove();
          if (!res.ok) {
            const err = await res.json().catch(() => ({}));
            addMessage('assistant', 'Error: ' + (err.detail || res.statusText), true, []);
            return;
          }
          const body = await res.json();
          addMessage('assistant', body.data.content, body.data.was_refusal, body.data.citations);
        } catch (err) {
          typingEl.remove();
          addMessage('assistant', 'Error: request failed', true, []);
        } finally {
          send.disabled = false;
        }
      });
"""

SUGGESTED_QUESTIONS = [
    "What's your stance on gun rights?",
    "Tell me about the construction codes bill you led",
    "What's your position on education policy?",
    "What have you done on energy issues?",
    "What's your record on public safety?",
    "Where do you stand on family policy?",
]


def render_chat_page(legislator, profile: dict, stats: dict) -> str:
    initials = "".join(part[0] for part in legislator.full_name.split()[:2]).upper()
    name = html.escape(legislator.full_name)
    role_bits = [b for b in [profile.get("title"), profile.get("chamber_name")] if b]
    if profile.get("district_code"):
        role_bits.append(f"District {profile['district_code']}")
    if profile.get("party"):
        role_bits.append(profile["party"])
    subtitle = (
        html.escape(" · ".join(role_bits)) if role_bits else "Minnesota Legislature"
    )

    profile_link = ""
    if profile.get("profile_url"):
        profile_link = (
            f'<a class="profile-link" href="{html.escape(profile["profile_url"])}" '
            f'target="_blank" rel="noopener noreferrer">View official profile ↗</a>'
        )

    topics_html = "".join(
        f'<span class="topic-chip">{html.escape(t)}</span>' for t in stats["topics"]
    )
    topics_section = (
        f'<div class="section-label">Topics in his record</div><div class="topics">{topics_html}</div>'
        if topics_html
        else ""
    )

    stats_html = f"""
      <div class="section-label">Data sources</div>
      <div class="stats">
        <div class="stat-tile"><strong>{stats["sponsorship_count"]}</strong><span>Sponsorships</span></div>
        <div class="stat-tile"><strong>{stats["vote_count"]}</strong><span>Vote records</span></div>
        <div class="stat-tile"><strong>{stats["bills_with_summary"]}</strong><span>Bill summaries</span></div>
      </div>
    """

    suggestions_html = "".join(
        f'<button type="button" class="suggestion-pill" data-question="{html.escape(q)}">{html.escape(q)}</button>'
        for q in SUGGESTED_QUESTIONS
    )

    return f"""<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>AI Simulation: {name}</title>
    <style>{_PAGE_STYLES}</style>
  </head>
  <body>
    <header class="topbar">
      <span class="wordmark">ALETHICAL</span>
      <span class="tag">Legislator AI · Internal Demo</span>
    </header>
    <main>
      <section class="card profile-card">
        <div class="profile-head">
          <div class="avatar">{initials}</div>
          <div style="flex:1">
            <h1>{name}</h1>
            <p class="subtitle">{subtitle}</p>
          </div>
          {profile_link}
        </div>
        {topics_section}
        {stats_html}
      </section>

      <section class="card chat-card">
        <div class="chat-head">
          <h2>Ask {name}</h2>
          <span class="ai-badge">AI SIMULATION</span>
        </div>
        <div class="chat-disclosure">
          Not the real person. Answers are grounded only in his public sponsorships, votes, and bill summaries.
        </div>
        <div id="log">
          <div class="msg assistant">I'm an AI simulation of {name}. Ask me anything — my answers are grounded in his public sponsorships, votes, and bill summaries.</div>
        </div>
        <div class="suggestions">{suggestions_html}</div>
        <form id="form">
          <input type="text" id="input" placeholder="Ask about a bill he sponsored or voted on..." autocomplete="off" />
          <button type="submit" id="send" class="send-btn">Send</button>
        </form>
      </section>
    </main>
    <script>{_PAGE_SCRIPT}</script>
  </body>
</html>
"""


@router.get("/", response_class=HTMLResponse)
def chat_page(db: Session = Depends(get_db)):
    legislator = db.scalar(select(Legislator).where(Legislator.id == ISAAC_SCHULTZ_ID))
    if legislator is None:
        raise HTTPException(status_code=404, detail="legislator not found")
    profile = load_legislator_profile(db, legislator.id)
    bills = load_legislator_bills(db, legislator.id)
    stats = summarize_record_stats(bills)
    return HTMLResponse(render_chat_page(legislator, profile, stats))
