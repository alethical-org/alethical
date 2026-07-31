from __future__ import annotations

import os
import re
from dataclasses import dataclass

import requests
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import case, select, text
from sqlalchemy.orm import Session

from alethical.api.auth import get_current_user
from alethical.api.schemas import (
    ChatMessageCreateRequest,
    ChatSessionCreateRequest,
    CollectionResponse,
    DetailResponse,
    NotificationPreferenceWriteRequest,
    SavedPlacePatchRequest,
    SavedPlaceWriteRequest,
    TrackedBillPatchRequest,
    TrackedBillWriteRequest,
)
from alethical.api.serializers import (
    bill_list_item,
    chat_message_payload,
    chat_session_payload,
)
from alethical.db.schema import load_schema
from alethical.db.session import get_db
from alethical.pipeline.rag_ingest import (
    DEFAULT_RAG_MODEL,
    _build_embeddings,
    effective_embedding_model,
)

schema = load_schema()
Bill = schema.Bill
ChatMessage = schema.ChatMessage
ChatRole = schema.ChatRole
ChatSession = schema.ChatSession
NotificationChannel = schema.NotificationChannel
NotificationPreference = schema.NotificationPreference
SavedPlace = schema.SavedPlace
TrackedBill = schema.TrackedBill
TrackedBillModel = schema.TrackedBill
bill_list_stmt = schema.bill_list_stmt
semantic_rag_chunk_stmt = schema.semantic_rag_chunk_stmt
tracked_bills_stmt = schema.tracked_bills_stmt

router = APIRouter()
RAG_CHAT_FALLBACK = "I could not find retrieval-ready bill text for this bill yet, so I cannot give a grounded answer."

# The instruction that governs every generated answer a reader sees — both the Ask
# answer page and the signed-in bill-scoped chat run through
# synthesize_grounded_answer below. Named rather than inlined so the
# answer-quality eval (`scripts/answer_eval.py`, #865) can import the exact
# production wording instead of keeping a copy that silently drifts out of step.
#
# SINCE #868 THIS IS ONLY THE FIRST HALF. Production appends a coverage rule that
# depends on how much of the bill went in. Call `rag_chat_system_prompt(coverage)`
# below for what is actually sent; this constant alone is no longer that.
RAG_CHAT_SYSTEM_PROMPT = (
    "Answer only from the provided bill text, but do answer when the text supports a "
    "plain-language conclusion even if the wording is indirect. If the context partially "
    "answers the question, answer the supported part and say what is not covered. Only say "
    "the bill text does not answer the question when none of the provided context is relevant."
)


def get_bill_by_key(db: Session, bill_key: str):
    bill = db.scalar(select(Bill).where(Bill.bill_key == bill_key))
    if bill is None:
        raise HTTPException(status_code=404, detail="bill not found")
    return bill


def build_query_embedding(text: str) -> list[float]:
    """Embed a user query using the same model as RAG ingestion.

    Delegates to _build_embeddings so the query path and ingest path share one
    OpenAI call site. Falls back to the deterministic hash embedding when
    OPENAI_API_KEY is not set (tests, local dev).
    """
    return _build_embeddings([text], model=DEFAULT_RAG_MODEL, batch_size=1)[0]


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


@dataclass(frozen=True)
class BillTextCoverage:
    """How much of one bill's retrievable text the answer writer was handed.

    ``searched`` and ``total`` count retrieval passages (``RagChunk`` rows for the
    bill's current version). ``is_complete`` is the *only* thing that licenses an
    answer to make a claim about **the bill**; short of it an answer may speak
    only about the passages it actually read.

    Why this exists (#868): production told a reader "the bill does not specify
    any counties" about HF 719, which names twenty of them, because the four
    passages it was given mentioned none. Absence from a sample was presented as
    absence from the bill — the confident-wrong answer
    `.claude/rules/grounded-answers.md` rule 1 exists to prevent.
    """

    searched: int
    total: int

    @property
    def is_complete(self) -> bool:
        """True only when every passage of the bill went into the answer.

        ``total`` of 0 means the count is unknown or the bill has no retrievable
        text, and an unknown denominator can never prove completeness — so it
        reads as partial, which is the safe direction.
        """
        return self.total > 0 and self.searched >= self.total

    @property
    def is_partial(self) -> bool:
        """True only when the shortfall is *known* — some passages went unread and
        we can say how many.

        Distinct from ``not is_complete``, which is also true when ``total`` is 0
        and nothing is known. Prompting treats unknown as partial, because that is
        the safe direction; telling a reader we searched "0 of 0 passages" is not
        safe, it is nonsense, so the reader-facing note keys on this instead.
        """
        return self.total > self.searched


# Applies whatever the coverage, because it is a claim about the model's own
# enumeration rather than about the bill, and nothing downstream can check it.
_NO_COMPLETENESS_CLAIM_RULE = (
    "NEVER tell the reader your list is complete, exhaustive, or that there is nothing "
    "beyond what you listed — you have no way to know that, and a reader who believes it "
    "stops looking."
)

_COMPLETE_COVERAGE_RULE = (
    "The context below is the COMPLETE text of this bill — every passage of it. You may "
    "therefore describe the bill as a whole, and if the bill genuinely names nothing of the "
    "kind asked about, you may say so. "
    # Added after measuring the fix live (#868): given all 102 passages of HF 719 the
    # model listed ~26 of the 98 cities it names and simply stopped, so a complete
    # read still produced a list a reader would take for the whole set. Reading
    # everything is not reporting everything, and this is the half of that gap a
    # prompt can address.
    "When the question asks for every instance of something, work through the whole context "
    "and list every one you find — do not stop at a representative handful. If you do shorten "
    "the list, you MUST say plainly in the answer that you have shortened it and roughly how "
    "many more there are. " + _NO_COMPLETENESS_CLAIM_RULE
)

# The instruction that was missing, and the reason production could deny a whole
# category of the bill's contents (#868). Applied whenever coverage is anything
# short of provably complete, including when the caller does not know (bill-scoped
# chat retrieves a fixed 3 passages and does not count the bill).
_PARTIAL_COVERAGE_RULE = (
    "The context below is only SOME of this bill's text — the passages that best match the "
    "question, not the whole bill. You are reading a sample. Therefore: "
    "(1) NEVER state or imply that the bill omits, excludes, lacks, or contains none of "
    "something; say only that the passages you were given do not mention it. "
    "(2) NEVER give a total, a count, or a list you call complete — you cannot see the whole "
    "bill, so you cannot count it. "
    "(3) When you list items, say the list comes from the passages searched and may be "
    "missing others. "
    "(4) " + _NO_COMPLETENESS_CLAIM_RULE
)


def _coverage_rule(coverage: BillTextCoverage | None) -> str:
    return (
        _COMPLETE_COVERAGE_RULE
        if coverage is not None and coverage.is_complete
        else _PARTIAL_COVERAGE_RULE
    )


def rag_chat_system_prompt(coverage: BillTextCoverage | None = None) -> str:
    """The complete system prompt production sends, for the given coverage.

    ``RAG_CHAT_SYSTEM_PROMPT`` is only the first half now (#868): the second half
    depends on how much of the bill went in, and the two are composed here so there
    is exactly one place that knows the whole thing.

    **The answer-quality eval should call this, not the constant.** The eval imports
    `RAG_CHAT_SYSTEM_PROMPT` by identity so it can never score a copy that drifted
    (`test_the_eval_scores_productions_own_prompt_rather_than_a_copy`) — a good guard
    that this change slipped past, because the drift is no longer a copy but a layer
    production adds on top. The eval's frozen contexts are partial reads, so
    ``rag_chat_system_prompt(None)`` is the prompt matching what it measures. Left as
    the eval's call to make rather than changed here, since #865's published §9
    numbers were produced without it and moving the baseline mid-decision is worse
    than a documented gap; `docs/product-onboarding/answer-quality-bar.md` records it.
    """
    return f"{RAG_CHAT_SYSTEM_PROMPT}\n\n{_coverage_rule(coverage)}"


# Subject phrases that make a claim about the whole bill, and the non-existence
# predicates that turn such a claim into an absence claim. Kept as two halves so
# the pattern fires only on "<the bill> <asserts nothing of a kind>" and never on
# an ordinary positive sentence about the bill.
_BILL_SUBJECT = r"(?:[Tt]he|[Tt]his)\s+bill(?:'s)?(?:\s+text)?|(?:HF|SF)\s?\d{1,5}"

# "no" meaning *none of*, not "no" opening a comparative. Legislative prose is
# full of "no later than", "no more than", "no fewer than" — none of which claim
# the bill lacks anything, so they must not trigger a rewrite.
_NONE_OF = r"no(?!\s+(?:fewer|less|more|later|longer|earlier|sooner)\b)"
_NO_SUCH_THING = (
    r"does\s+not|do\s+not|doesn't|did\s+not|didn't|is\s+not|isn't|was\s+not|wasn't|"
    rf"contains?\s+{_NONE_OF}|includes?\s+{_NONE_OF}|has\s+{_NONE_OF}|have\s+{_NONE_OF}|"
    rf"lists?\s+{_NONE_OF}|names?\s+{_NONE_OF}|mentions?\s+{_NONE_OF}|"
    rf"specifies\s+{_NONE_OF}|specify\s+{_NONE_OF}|identifies\s+{_NONE_OF}|"
    rf"makes?\s+{_NONE_OF}|is\s+silent"
)
_BILL_ABSENCE_CLAIM_RE = re.compile(
    rf"\b(?:{_BILL_SUBJECT})\s+(?={_NO_SUCH_THING})",
)

# What replaces the over-broad subject. Deliberately SINGULAR ("the bill text we
# searched", not "the passages we searched") so the verb that follows never needs
# rewriting: "The bill does not specify any counties" becomes "The bill text we
# searched does not specify any counties" with the predicate untouched. That is
# what makes this transform safe — it swaps one singular subject noun phrase for
# another and stops. `.claude/rules/grounded-answers.md` rule 9's display cleaners
# are the precedent, and its hard limit applies here too: a cleaner may only edit
# displayed model text where the edit cannot break the sentence.
_SEARCHED_SUBJECT = "the bill text we searched"


def _searched_subject_for(match: re.Match[str]) -> str:
    """The replacement subject, capitalized when it opens the sentence.

    The pattern matches the subject with its own leading capital, so mirroring
    that capital is what keeps a rewritten sentence looking written rather than
    patched.
    """
    replacement = _SEARCHED_SUBJECT
    if match.group(0)[:1].isupper():
        replacement = replacement[:1].upper() + replacement[1:]
    return f"{replacement} "


def narrow_bill_absence_claims(prose: str) -> str:
    """Re-scope an answer's absence claims from the bill to the text we read.

    The backstop under ``_PARTIAL_COVERAGE_RULE``: a prompt is a request, and a
    model that ignores it must still not be able to tell a reader that a bill
    contains none of something when only part of the bill was searched (#868).
    Runs only when coverage is short of complete — when the whole bill went in,
    "the bill does not specify any counties" is a true and useful sentence and
    passes through untouched.
    """
    return _BILL_ABSENCE_CLAIM_RE.sub(_searched_subject_for, prose)


# Sentences whose whole content is "and there are no more of these than the ones I
# just listed". Found by measuring the #868 fix live on 2026-07-31: handed the
# complete text of HF 719, the model listed 37 of its 98 cities and closed with "The
# bill does not indicate any additional cities or counties beyond those listed."
#
# This is a DIFFERENT claim from an absence claim, and the distinction is why it
# needs its own guard. "The bill names no counties" is about the bill, and reading
# the whole bill makes it checkable and true. "There are none beyond the ones I
# listed" is about the model's own enumeration, which nothing here verifies and
# complete coverage does not license — so this guard runs on every answer, however
# much of the bill went in.
#
# Patterns are deliberately narrow, and each requires the sentence to point back at
# the answer's own list. "The complete list of appropriations appears in Article 1"
# is a useful pointer, not a completeness claim, and must survive.
#
# The shape is two-part: something pointing at the answer's own list, and a
# quantifier claiming it is all of them. Requiring BOTH is what keeps ordinary
# sentences safe — "All appropriations are onetime appropriations" has the quantifier
# and no referent, "The complete list of appropriations appears in Article 1" points
# somewhere else, and "The list above is shortened; roughly 60 more are named" is the
# honest hedge this must never remove. Each was checked against the pattern, not
# assumed. Two shapes got through earlier drafts and are now covered by name:
# "This summarizes all the named cities" and "This list includes all named instances".
_LIST_REFERENT = (
    r"(?:this|that|these|those|the|my)\s+(?:list|answer|summary|table|above)?\s*"
)
_CLAIMS_ALL = (
    r"(?:includes?|contains?|covers?|shows?|lists?|represents?|summariz(?:es|ing)|"
    r"reflects?|is|are)\s+(?:all|every|each\s+of|the\s+(?:complete|full|entire))\b"
)
_LIST_COMPLETENESS_CLAIM_RE = re.compile(
    r"[^.!?\n]*?(?:"
    # "…and there are no others beyond the ones I listed."
    r"\bno\s+(?:additional|other|further|more)\b[^.!?\n]*?\b(?:beyond|besides|other\s+than)\b"
    r"|\bbeyond\s+(?:those|the\s+ones|what(?:'s|\s+is))\s+(?:listed|named|mentioned|shown|above)\b"
    # "This list includes all…" / "These are all the…" / "That represents all of…"
    rf"|\b{_LIST_REFERENT}{_CLAIMS_ALL}"
    # "…all named instances of…" wherever it sits in the sentence.
    r"|\ball\s+(?:the\s+)?(?:named|listed|mentioned|identified)\s+"
    r"(?:instances?|items?|entries|ones|examples?)\b"
    # "The above are the complete list of…"
    r"|\b(?:is|are)\s+the\s+(?:complete|full|exhaustive)\s+list\b"
    r")[^.!?\n]*[.!?]\s*",
    # These sentences usually OPEN a paragraph ("This summarizes all…", "These are
    # all…"), so a case-sensitive pattern misses the common form entirely — which is
    # how the live HF 719 claim survived the first version of this guard.
    re.IGNORECASE,
)


def strip_list_completeness_claims(prose: str) -> str:
    """Drop any sentence claiming the answer's own list is the whole set.

    Removes the sentence rather than rewriting it, because such a sentence carries
    nothing except the false assurance — there is no true version of it to rewrite
    towards — and dropping a whole sentence cannot break the grammar of the ones
    around it, which editing inside one can (`.claude/rules/grounded-answers.md`
    rule 9's limit on display cleaners).

    What the reader gets instead is the layout-owned coverage note, which states how
    much of the bill was searched. That is the honest version of the same
    information, and it comes from the half of the system that actually knows.
    """
    cleaned = _LIST_COMPLETENESS_CLAIM_RE.sub("", prose)
    # Collapse the blank run a removed trailing sentence can leave behind, and never
    # return an empty body: if the whole answer was one completeness claim, the
    # original is still the honest thing to show, caveated by the coverage note.
    cleaned = re.sub(r"[ \t]+\n", "\n", cleaned).strip()
    cleaned = re.sub(r"\n{3,}", "\n\n", cleaned)
    return cleaned or prose.strip()


def synthesize_grounded_answer(
    question: str,
    chunks: list,
    *,
    bill_key: str,
    coverage: BillTextCoverage | None = None,
) -> str:
    """One bill's passages plus a question in, cited prose out.

    Shared by the Ask answer page (``alethical/api/routers/ask.py``) and the
    signed-in bill-scoped chat below, so every change here moves both surfaces.

    ``coverage`` states how much of the bill the ``chunks`` are. It defaults to
    ``None`` = unknown, which is treated as partial: an unproven denominator must
    never license a claim about the whole bill (#868). Bill-scoped chat passes
    nothing, because it retrieves a fixed 3 passages and never counts the bill.
    """
    if not chunks:
        return RAG_CHAT_FALLBACK

    context = "\n\n".join(
        f"[{index}] {chunk.citation_label}\n{chunk.chunk_text.strip()}"
        for index, chunk in enumerate(chunks, start=1)
    )
    api_key = os.environ.get("OPENAI_API_KEY")
    if not api_key:
        raise HTTPException(
            status_code=503, detail="OPENAI_API_KEY is required for RAG chat synthesis"
        )

    model = os.environ.get("OPENAI_RAG_CHAT_MODEL", "gpt-4o-mini")
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
                        "content": rag_chat_system_prompt(coverage),
                    },
                    {
                        "role": "user",
                        "content": f"Bill: {bill_key}\nQuestion: {question}\n\nContext:\n{context}",
                    },
                ],
            },
            timeout=30,
        )
        response.raise_for_status()
        payload = response.json()
        text_value = extract_openai_response_text(payload)
        if text_value:
            # Two guards, gated differently on purpose. An absence claim about the
            # bill becomes true once the whole bill has been read, so that one is
            # narrowed only on a partial read. A claim that the answer's own list is
            # exhaustive is never verifiable, so that one always goes.
            if coverage is None or not coverage.is_complete:
                text_value = narrow_bill_absence_claims(text_value)
            return strip_list_completeness_claims(text_value)
    except requests.RequestException as exc:
        raise HTTPException(
            status_code=502, detail="OpenAI RAG chat synthesis failed"
        ) from exc

    raise HTTPException(
        status_code=502, detail="OpenAI RAG chat synthesis returned no answer"
    )


@router.get("/me", response_model=DetailResponse)
def me(current_user=Depends(get_current_user)):
    return DetailResponse(
        data={
            "id": str(current_user.id),
            "display_name": current_user.display_name,
            "primary_email": current_user.primary_email,
            "features": ["tracked_bills", "notifications", "chat"],
        }
    )


@router.get("/me/tracked-bills", response_model=CollectionResponse)
def tracked_bills(
    db: Session = Depends(get_db), current_user=Depends(get_current_user)
):
    rows = db.scalars(tracked_bills_stmt(current_user.id)).all()
    data = []
    for row in rows:
        data.append(
            {
                "bill_id": row.bill.bill_key,
                "alerts_enabled": row.alerts_enabled,
                "note": row.note,
                "bill": bill_list_item(row.bill).model_dump(exclude_none=True),
            }
        )
    return CollectionResponse(
        data=data, page={"limit": len(data), "next_cursor": None, "has_more": False}
    )


@router.put("/me/tracked-bills/{bill_id}", response_model=DetailResponse)
def put_tracked_bill(
    bill_id: str,
    request: TrackedBillWriteRequest,
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    bill = get_bill_by_key(db, bill_id)
    tracked = db.scalar(
        select(TrackedBillModel).where(
            TrackedBillModel.user_id == current_user.id,
            TrackedBillModel.bill_id == bill.id,
        )
    )
    if tracked is None:
        tracked = TrackedBillModel(user_id=current_user.id, bill_id=bill.id)
        db.add(tracked)
    tracked.alerts_enabled = request.alerts_enabled
    tracked.note = request.note
    db.commit()
    db.refresh(tracked)
    return DetailResponse(
        data={
            "bill_id": bill.bill_key,
            "alerts_enabled": tracked.alerts_enabled,
            "note": tracked.note,
        }
    )


@router.patch("/me/tracked-bills/{bill_id}", response_model=DetailResponse)
def patch_tracked_bill(
    bill_id: str,
    request: TrackedBillPatchRequest,
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    bill = get_bill_by_key(db, bill_id)
    tracked = db.scalar(
        select(TrackedBillModel).where(
            TrackedBillModel.user_id == current_user.id,
            TrackedBillModel.bill_id == bill.id,
        )
    )
    if tracked is None:
        raise HTTPException(status_code=404, detail="tracked bill not found")
    if request.alerts_enabled is not None:
        tracked.alerts_enabled = request.alerts_enabled
    if request.note is not None:
        tracked.note = request.note
    db.commit()
    db.refresh(tracked)
    return DetailResponse(
        data={
            "bill_id": bill.bill_key,
            "alerts_enabled": tracked.alerts_enabled,
            "note": tracked.note,
        }
    )


@router.delete("/me/tracked-bills/{bill_id}", status_code=204)
def delete_tracked_bill(
    bill_id: str,
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    bill = get_bill_by_key(db, bill_id)
    tracked = db.scalar(
        select(TrackedBillModel).where(
            TrackedBillModel.user_id == current_user.id,
            TrackedBillModel.bill_id == bill.id,
        )
    )
    if tracked is not None:
        db.delete(tracked)
        db.commit()


@router.get("/me/notification-preferences", response_model=CollectionResponse)
def notification_preferences(
    db: Session = Depends(get_db), current_user=Depends(get_current_user)
):
    rows = db.scalars(
        select(NotificationPreference).where(
            NotificationPreference.user_id == current_user.id
        )
    ).all()
    data = [
        {
            "channel": row.channel.value,
            "frequency": row.frequency.value,
            "is_enabled": row.is_enabled,
        }
        for row in rows
    ]
    return CollectionResponse(
        data=data, page={"limit": len(data), "next_cursor": None, "has_more": False}
    )


@router.put("/me/notification-preferences/{channel}", response_model=DetailResponse)
def put_notification_preference(
    channel: str,
    request: NotificationPreferenceWriteRequest,
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    channel_enum = NotificationChannel(channel)
    row = db.scalar(
        select(NotificationPreference).where(
            NotificationPreference.user_id == current_user.id,
            NotificationPreference.channel == channel_enum,
        )
    )
    if row is None:
        row = NotificationPreference(user_id=current_user.id, channel=channel_enum)
        db.add(row)
    row.frequency = schema.NotificationFrequency(request.frequency)
    row.is_enabled = request.is_enabled
    db.commit()
    db.refresh(row)
    return DetailResponse(
        data={
            "channel": row.channel.value,
            "frequency": row.frequency.value,
            "is_enabled": row.is_enabled,
        }
    )


@router.get("/me/saved-places", response_model=CollectionResponse)
def saved_places(db: Session = Depends(get_db), current_user=Depends(get_current_user)):
    rows = db.scalars(
        select(SavedPlace).where(SavedPlace.user_id == current_user.id)
    ).all()
    data = [
        {
            "id": str(row.id),
            "label": row.label,
            "address_text": row.address_text,
            "city": row.city,
            "state_code": row.state_code,
            "is_default": row.is_default,
        }
        for row in rows
    ]
    return CollectionResponse(
        data=data, page={"limit": len(data), "next_cursor": None, "has_more": False}
    )


@router.post("/me/saved-places", response_model=DetailResponse, status_code=201)
def create_saved_place(
    request: SavedPlaceWriteRequest,
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    row = SavedPlace(
        user_id=current_user.id,
        label=request.label,
        address_text=request.address_text,
        city=request.city,
        state_code=request.state_code or "MN",
        is_default=request.is_default,
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return DetailResponse(
        data={
            "id": str(row.id),
            "label": row.label,
            "address_text": row.address_text,
            "city": row.city,
            "state_code": row.state_code,
            "is_default": row.is_default,
        }
    )


@router.patch("/me/saved-places/{place_id}", response_model=DetailResponse)
def patch_saved_place(
    place_id: str,
    request: SavedPlacePatchRequest,
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    row = db.scalar(
        select(SavedPlace).where(
            SavedPlace.id == place_id, SavedPlace.user_id == current_user.id
        )
    )
    if row is None:
        raise HTTPException(status_code=404, detail="saved place not found")
    if request.label is not None:
        row.label = request.label
    if request.address_text is not None:
        row.address_text = request.address_text
    if request.city is not None:
        row.city = request.city
    if request.state_code is not None:
        row.state_code = request.state_code
    if request.is_default is not None:
        row.is_default = request.is_default
    db.commit()
    db.refresh(row)
    return DetailResponse(
        data={
            "id": str(row.id),
            "label": row.label,
            "address_text": row.address_text,
            "city": row.city,
            "state_code": row.state_code,
            "is_default": row.is_default,
        }
    )


@router.delete("/me/saved-places/{place_id}", status_code=204)
def delete_saved_place(
    place_id: str,
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    row = db.scalar(
        select(SavedPlace).where(
            SavedPlace.id == place_id, SavedPlace.user_id == current_user.id
        )
    )
    if row is not None:
        db.delete(row)
        db.commit()


@router.get("/me/chat-sessions", response_model=CollectionResponse)
def chat_sessions(
    db: Session = Depends(get_db), current_user=Depends(get_current_user)
):
    rows = db.scalars(
        select(ChatSession)
        .where(ChatSession.user_id == current_user.id)
        .order_by(ChatSession.created_at.desc())
    ).all()
    bill_ids = [row.subject_bill_id for row in rows if row.subject_bill_id]
    bill_map = (
        {
            row.id: row.bill_key
            for row in db.scalars(select(Bill).where(Bill.id.in_(bill_ids))).all()
        }
        if bill_ids
        else {}
    )
    data = [
        chat_session_payload(
            row, subject_bill_id=bill_map.get(row.subject_bill_id)
        ).model_dump(exclude_none=True)
        for row in rows
    ]
    return CollectionResponse(
        data=data, page={"limit": len(data), "next_cursor": None, "has_more": False}
    )


@router.post("/me/chat-sessions", response_model=DetailResponse, status_code=201)
def create_chat_session(
    request: ChatSessionCreateRequest,
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    if not request.subject_bill_id:
        raise HTTPException(status_code=400, detail="subject_bill_id is required")
    bill = get_bill_by_key(db, request.subject_bill_id)
    row = ChatSession(
        user_id=current_user.id,
        title=request.title,
        subject_bill_id=bill.id,
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return DetailResponse(
        data=chat_session_payload(row, subject_bill_id=bill.bill_key).model_dump()
    )


@router.get("/me/chat-sessions/{chat_session_id}", response_model=DetailResponse)
def get_chat_session(
    chat_session_id: str,
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    row = db.scalar(
        select(ChatSession).where(
            ChatSession.id == chat_session_id, ChatSession.user_id == current_user.id
        )
    )
    if row is None:
        raise HTTPException(status_code=404, detail="chat session not found")
    bill = (
        db.scalar(select(Bill).where(Bill.id == row.subject_bill_id))
        if row.subject_bill_id
        else None
    )
    return DetailResponse(
        data=chat_session_payload(
            row, subject_bill_id=bill.bill_key if bill else None
        ).model_dump()
    )


@router.get(
    "/me/chat-sessions/{chat_session_id}/messages", response_model=CollectionResponse
)
def get_chat_messages(
    chat_session_id: str,
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    session_row = db.scalar(
        select(ChatSession).where(
            ChatSession.id == chat_session_id, ChatSession.user_id == current_user.id
        )
    )
    if session_row is None:
        raise HTTPException(status_code=404, detail="chat session not found")
    rows = db.scalars(
        select(ChatMessage)
        .where(ChatMessage.session_id == session_row.id)
        .order_by(
            ChatMessage.created_at.asc(),
            case(
                (ChatMessage.role == ChatRole.user, 0),
                (ChatMessage.role == ChatRole.assistant, 1),
                else_=2,
            ),
            ChatMessage.id.asc(),
        )
    ).all()
    data = [chat_message_payload(row).model_dump() for row in rows]
    return CollectionResponse(
        data=data, page={"limit": len(data), "next_cursor": None, "has_more": False}
    )


@router.post(
    "/me/chat-sessions/{chat_session_id}/messages",
    response_model=DetailResponse,
    status_code=201,
)
def create_chat_message(
    chat_session_id: str,
    request: ChatMessageCreateRequest,
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    session_row = db.scalar(
        select(ChatSession).where(
            ChatSession.id == chat_session_id, ChatSession.user_id == current_user.id
        )
    )
    if session_row is None:
        raise HTTPException(status_code=404, detail="chat session not found")
    if session_row.subject_bill_id is None:
        raise HTTPException(
            status_code=400, detail="chat session is not associated with a bill"
        )
    user_message = ChatMessage(
        session_id=session_row.id, role=ChatRole.user, content=request.content
    )
    db.add(user_message)
    db.flush()

    bill = db.scalar(select(Bill).where(Bill.id == session_row.subject_bill_id))
    if bill is None:
        raise HTTPException(status_code=404, detail="bill not found")

    embedding = build_query_embedding(request.content)
    # HNSW ANN search tuning (#584); replaces the ivfflat.probes setting after the
    # ivfflat index was swapped for HNSW. ef_search=100 exceeds the retrieval LIMIT
    # for good recall at negligible latency.
    db.execute(text("SET LOCAL hnsw.ef_search = 100"))
    # Filter retrieval to chunks embedded with the same model the query vector
    # was just built with (real model when keyed, hash fallback when not — #221),
    # so cosine distance is meaningful. Chunks stored under any other model are
    # excluded until re-embedded by the RAG backfill.
    chunks = db.scalars(
        semantic_rag_chunk_stmt(
            embedding,
            bill_id=session_row.subject_bill_id,
            embedding_model=effective_embedding_model(DEFAULT_RAG_MODEL),
            limit=3,
        )
    ).all()
    citations = [
        {
            "citation_label": chunk.citation_label,
            "bill_id": bill.bill_key,
            "excerpt": chunk.chunk_text.strip().replace("\n", " ")[:220],
            "full_text": chunk.rag_section_document.clean_text.strip(),
            "highlight_text": chunk.chunk_text.strip(),
            "url": bill.official_url,
        }
        for chunk in chunks
        if chunk.rag_section_document.bill_id == session_row.subject_bill_id
    ]
    assistant_text = synthesize_grounded_answer(
        request.content, chunks, bill_key=bill.bill_key
    )
    assistant_message = ChatMessage(
        session_id=session_row.id,
        role=ChatRole.assistant,
        content=assistant_text,
        citation_payload={"citations": citations},
    )
    db.add(assistant_message)
    session_row.last_message_at = assistant_message.created_at
    db.commit()
    db.refresh(assistant_message)
    return DetailResponse(
        data={"assistant_message": chat_message_payload(assistant_message).model_dump()}
    )
