from __future__ import annotations

import os
import re
import uuid

from fastapi import APIRouter, Depends, HTTPException
import requests
from sqlalchemy import select
from sqlalchemy.orm import Session

from alethical.api.schemas import CollectionResponse, DetailResponse
from alethical.db.schema import load_schema
from alethical.db.session import get_db

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
