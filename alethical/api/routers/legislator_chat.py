from __future__ import annotations

import logging
import math
import os
import re
import uuid

from fastapi import APIRouter, Depends, HTTPException
import requests
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from alethical.api.schemas import CollectionResponse, DetailResponse
from alethical.db.schema import load_schema
from alethical.db.session import get_db
from alethical.pipeline.rag_ingest import (
    DEFAULT_RAG_BATCH_SIZE,
    DEFAULT_RAG_MODEL,
    _build_embeddings,
    effective_embedding_model,
)

logger = logging.getLogger(__name__)

schema = load_schema()
Legislator = schema.Legislator
LegislatorChatMessage = schema.LegislatorChatMessage
LegislatorChatRole = schema.LegislatorChatRole
LegislatorChatSession = schema.LegislatorChatSession
Sponsorship = schema.Sponsorship
VoteRecord = schema.VoteRecord
legislator_chat_record_stmt = schema.legislator_chat_record_stmt

router = APIRouter()

# Internal proof-of-concept demo. Isaac Schultz has the richest record in the corpus
# (50 sponsorships, 51 votes) and is the default legislator when a session is created
# without an explicit legislator_id, so the demo works out of the box. A session can be
# created for any legislator with a meaningful record (see list_legislators). Not for
# real users; see plan doc for scope.
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
summaries/policy areas). Only state a position when a specific bill, sponsorship, or vote
in the record DIRECTLY addresses the topic the constituent asked about. A close match does
not require the exact same words — a firearm-permitting bill directly addresses a question
about gun permits — but the bill must genuinely be about that subject, not merely adjacent
to it. Do NOT stretch a loosely- or thematically-related bill to cover a topic it is not
actually about (for example, do not treat a general workforce-training bill as a stance on
a specific unrelated industry, or a broad budget bill as a position on every program it
might touch). When the closest thing in the record only shares a theme with the question
but is really about a different subject, treat that as no record and refuse. When a
specific record entry does directly support it, state his position based on what he
sponsored, co-sponsored, or how he voted, and briefly explain the reasoning in his voice.
You must be able to cite at least one directly-supporting bill for any position you state;
if you cannot, refuse instead of answering.

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

Refuse whenever the record does not directly address the topic. If the closest bill, vote,
or policy area is only tenuously or thematically related — a different subject that merely
shares a theme — do not answer from it and do not guess a position. It is better to refuse
than to attach a bill that does not really support the answer. In that case, respond with
exactly: "{refusal}" — nothing else, no sources line.

After your answer, on its own new line, write exactly:
SOURCES: <comma-separated bill keys you drew on, e.g. 94-2025-HF17, 94-2025-HF9>
(or "SOURCES: NONE" if you did not draw on any specific bill)

His record:
{record_context}"""


def load_legislator_bills(db: Session, legislator_id: uuid.UUID) -> list:
    """Every bill this legislator sponsored or voted on, with current summary enrichment."""
    return db.scalars(legislator_chat_record_stmt(legislator_id)).unique().all()


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


# How many of a legislator's bills to retrieve into the prompt per question,
# instead of stuffing the whole record. A single legislator's corpus is tens to
# low-hundreds of bills; this focuses the prompt on the question while leaving
# enough headroom for the persona to connect thematically related bills (the
# grounding style the system prompt asks for). See
# docs/persona-rag-chatbot-research.md Addendum (2026-07-16, Hybrid retrieval / RRF).
LEGISLATOR_RETRIEVAL_TOP_K = 8


def bill_embedding_text(bill, *, include_policy_areas: bool = False) -> str:
    """Bill text embedded for semantic comparison — title plus the AI summary /
    key points, and policy areas when ``include_policy_areas`` is set.

    Shared by per-question retrieval ranking (``include_policy_areas=True`` — the
    same material the persona actually grounds in, so retrieval selects on the
    content that ends up in the prompt) and post-hoc citation verification
    (``include_policy_areas=False`` — the bill's own words a citation must back)."""
    parts = [bill.title.strip() if bill.title else ""]
    for enrichment in bill.enrichments:
        content = enrichment.content_json or {}
        if content.get("summary"):
            parts.append(content["summary"])
        if content.get("key_points"):
            parts.append("; ".join(content["key_points"]))
        if include_policy_areas and content.get("policy_areas"):
            parts.append(", ".join(content["policy_areas"]))
    return "\n".join(part for part in parts if part).strip()


def cosine_similarity(left: list[float], right: list[float]) -> float:
    dot = sum(a * b for a, b in zip(left, right))
    left_norm = math.sqrt(sum(a * a for a in left))
    right_norm = math.sqrt(sum(b * b for b in right))
    if left_norm == 0 or right_norm == 0:
        return 0.0
    return dot / (left_norm * right_norm)


def retrieve_relevant_bills(
    question: str, bills: list, *, top_k: int = LEGISLATOR_RETRIEVAL_TOP_K
) -> list:
    """Rank a legislator's bills by semantic similarity to the question and return
    the top ``top_k`` — retrieval in place of dumping the whole record.

    Vector-only, code-only v1 (no schema change, deferred RRF): embeds each bill's
    summary doc (``bill_embedding_text``) and the question at request time and
    ranks by cosine similarity. The corpus is small enough that per-request
    embedding is acceptable — see docs/persona-rag-chatbot-research.md Addendum
    (2026-07-16, Hybrid retrieval / RRF). Vector search alone can miss a pure
    lexical match (a bare bill number the summary text doesn't mention); that
    miss is the documented signal for whether the deferred keyword+RRF layer is
    later justified.

    Degrades to the full bill list (the previous corpus-stuffing behavior) when
    ranking would be meaningless or unavailable — no OpenAI key (embeddings are
    the deterministic hash fallback, so cosine is noise; tests/offline dev), the
    record already fits within ``top_k``, no bill has embeddable text, or the
    embedding call fails — so grounding stays available rather than crashing."""
    if len(bills) <= top_k:
        return bills
    # Without a real key, _build_embeddings returns deterministic hashes whose
    # cosine ordering is meaningless — fall back to the full record.
    if not os.environ.get("OPENAI_API_KEY"):
        return bills

    docs = [
        (bill, bill_embedding_text(bill, include_policy_areas=True)) for bill in bills
    ]
    docs = [(bill, doc) for bill, doc in docs if doc.strip()]
    if not docs:
        return bills

    # One batched call embeds the question and every bill doc together.
    texts = [question] + [doc for _, doc in docs]
    try:
        vectors = _build_embeddings(
            texts, model=DEFAULT_RAG_MODEL, batch_size=DEFAULT_RAG_BATCH_SIZE
        )
    except (requests.RequestException, RuntimeError):
        return bills

    question_vec = vectors[0]
    scored = sorted(
        zip((bill for bill, _ in docs), vectors[1:]),
        key=lambda pair: cosine_similarity(question_vec, pair[1]),
        reverse=True,
    )
    return [bill for bill, _ in scored[:top_k]]


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
        bill_embedding_text(bill_by_key[c["bill_key"]])
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
        score = cosine_similarity(answer_vec, vector) if support_text else 0.0
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


def legislator_record_counts(legislator_id: uuid.UUID):
    """Scalar subqueries for a legislator's sponsorship and vote-record counts."""
    sponsorship_count = (
        select(func.count())
        .select_from(Sponsorship)
        .where(Sponsorship.legislator_id == legislator_id)
        .scalar_subquery()
    )
    vote_count = (
        select(func.count())
        .select_from(VoteRecord)
        .where(VoteRecord.legislator_id == legislator_id)
        .scalar_subquery()
    )
    return sponsorship_count, vote_count


@router.get("/legislators", response_model=CollectionResponse)
def list_legislators(db: Session = Depends(get_db)):
    """Legislators with enough public record to ground answers (has sponsorships and/or votes)."""
    sponsorship_count, vote_count = legislator_record_counts(Legislator.id)
    rows = db.execute(
        select(
            Legislator.id,
            Legislator.full_name,
            sponsorship_count.label("sponsorship_count"),
            vote_count.label("vote_count"),
        )
        .where((sponsorship_count > 0) | (vote_count > 0))
        .order_by((sponsorship_count + vote_count).desc(), Legislator.sort_name.asc())
    ).all()
    data = [
        {
            "id": str(row.id),
            "full_name": row.full_name,
            "sponsorship_count": row.sponsorship_count,
            "vote_count": row.vote_count,
        }
        for row in rows
    ]
    return CollectionResponse(
        data=data, page={"limit": len(data), "next_cursor": None, "has_more": False}
    )


@router.post("/sessions", response_model=DetailResponse, status_code=201)
def create_session(request: dict | None = None, db: Session = Depends(get_db)):
    raw_id = (request or {}).get("legislator_id")
    if raw_id:
        try:
            legislator_id = uuid.UUID(str(raw_id))
        except ValueError as exc:
            raise HTTPException(
                status_code=400, detail="legislator_id is not a valid UUID"
            ) from exc
    else:
        legislator_id = ISAAC_SCHULTZ_ID

    legislator = db.scalar(select(Legislator).where(Legislator.id == legislator_id))
    if legislator is None:
        raise HTTPException(status_code=404, detail="legislator not found")

    # A legislator with no sponsorships and no votes has nothing to ground answers in and
    # would only ever refuse, so reject the session rather than create a dead chat.
    sponsorship_count, vote_count = legislator_record_counts(legislator.id)
    has_record = db.scalar(select((sponsorship_count > 0) | (vote_count > 0)))
    if not has_record:
        raise HTTPException(
            status_code=400, detail="legislator has no public record to ground answers"
        )

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
    # Resolve citations against the full record; ground the answer only on the
    # bills retrieved for this question (retrieval, not corpus-stuffing).
    bill_by_key = {bill.bill_key: bill for bill in bills}
    retrieved_bills = retrieve_relevant_bills(content, bills)
    record_context = format_record_context(retrieved_bills)
    raw_answer = synthesize_legislator_answer(
        content,
        record_context,
        history,
        legislator_name=legislator.full_name,
    )
    answer_text, citations = parse_answer(raw_answer, bill_by_key)
    was_refusal = answer_text.strip() == LEGISLATOR_CHAT_REFUSAL
    # Weak-grounding guard (structural, not prompt-only per persona-rag-chatbot-research.md
    # §5): a non-refusal answer that resolved no citation is ungrounded under cite-or-refuse
    # (.claude/rules/grounded-answers.md rule 1) — the model stated a position without a bill
    # in the record actually backing it (or cited a key that doesn't resolve). Fall back to
    # the refusal rather than surface an unsupported position. This is a floor on grounding,
    # distinct from post-hoc per-citation span verification (a separate build item).
    if not was_refusal and not citations:
        answer_text = LEGISLATOR_CHAT_REFUSAL
        was_refusal = True
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
