from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlalchemy import String, cast, func, or_, select
from sqlalchemy.orm import Session

from alethical.api.auth import get_optional_current_user
from alethical.api.problems import problem_exception
from alethical.api.schemas import (
    AskAnswerPayload,
    AskClassificationPayload,
    AskClassifyRequest,
    AskSessionRef,
    AskTopicBillsAnswer,
    DetailResponse,
)
from alethical.api.serializers import bill_list_item, bill_status_key_from_summary
from alethical.api.services.ask_router import AskIntent, classify_query
from alethical.db.schema import load_schema
from alethical.db.session import get_db

schema = load_schema()
Bill = schema.Bill
AIEnrichment = schema.AIEnrichment
EnrichmentType = schema.EnrichmentType
IngestionRun = schema.IngestionRun
IngestionStatus = schema.IngestionStatus
LegislativeSession = schema.LegislativeSession
bill_list_stmt = schema.bill_list_stmt

router = APIRouter()

# Display order per docs/grounded-ask-spec.md §4.2 (topic_bills formatter):
# legislative progress first, then most recent action (tie-broken in
# _progress_sort_key so a shared ?q= link re-renders identically).
_PROGRESS_ORDER = {
    "signed_into_law": 0,
    "vetoed": 1,
    "passed_senate": 2,
    "passed_house": 3,
    "in_committee": 4,
    "proposed": 5,
}

# Cap the rendered list; overflow routes to Search pre-filtered to the topic.
_DISPLAY_LIMIT = 6

# ILIKE on one or two characters matches almost everything; below this the
# topic carries too little signal and the ask gets the NO MATCHES state.
_MIN_TOPIC_LENGTH = 3


def _progress_sort_key(bill):
    rank = _PROGRESS_ORDER.get(bill_status_key_from_summary(bill), len(_PROGRESS_ORDER))
    action_ts = (
        bill.latest_action_at.timestamp() if bill.latest_action_at else float("-inf")
    )
    return (rank, -action_ts, bill.file_number, bill.bill_key)


def _topic_bills_answer(db: Session, topic: str | None) -> AskTopicBillsAnswer:
    session_row = db.scalar(
        select(LegislativeSession).where(LegislativeSession.is_current.is_(True))
    )
    data_as_of = db.scalar(
        select(func.max(IngestionRun.finished_at)).where(
            IngestionRun.status == IngestionStatus.succeeded
        )
    )
    session_ref = AskSessionRef(slug=session_row.slug, name=session_row.name)

    topic_value = (topic or "").strip()
    if len(topic_value) < _MIN_TOPIC_LENGTH:
        return AskTopicBillsAnswer(
            topic=topic_value or None,
            session=session_ref,
            data_as_of=data_as_of,
            total_matches=0,
            bills=[],
        )

    pattern = f"%{topic_value}%"
    matching_policy_area_bills = select(AIEnrichment.bill_id).where(
        AIEnrichment.enrichment_type == EnrichmentType.bill_summary,
        AIEnrichment.is_current.is_(True),
        cast(AIEnrichment.content_json["policy_areas"], String).ilike(pattern),
    )
    stmt = bill_list_stmt(session_row.id).where(
        or_(
            Bill.id.in_(matching_policy_area_bills),
            Bill.title.ilike(pattern),
            Bill.description.ilike(pattern),
        )
    )
    rows = db.scalars(stmt).all()
    ranked = sorted(rows, key=_progress_sort_key)
    return AskTopicBillsAnswer(
        topic=topic_value,
        session=session_ref,
        data_as_of=data_as_of,
        total_matches=len(rows),
        bills=[bill_list_item(bill) for bill in ranked[:_DISPLAY_LIMIT]],
    )


@router.post("/ask/classify", response_model=DetailResponse, status_code=200)
def classify_ask_query(
    request: AskClassifyRequest,
    _current_user=Depends(get_optional_current_user),
):
    """Identify which Ask view/intent a free-form query should route to."""
    content = request.content.strip()
    if not content:
        raise problem_exception(400, "Bad Request", "content must not be empty")

    result = classify_query(content)
    return DetailResponse(
        data=AskClassificationPayload(
            intent=result.intent.value,
            auth_required=result.auth_required,
            source=result.source,
            confidence=result.confidence,
            topic=result.topic,
        ),
        links={"self": "/api/v1/ask/classify"},
    )


@router.post("/ask", response_model=DetailResponse, status_code=200)
def ask(request: AskClassifyRequest, db: Session = Depends(get_db)):
    """Classify an Ask and, for topic_bills, resolve the cited bill list.

    Anonymous by design — every v1 answer path is signed-out-accessible
    (docs/grounded-ask-spec.md §9.1). Other intents return no answer body
    until their slices of #79 land; the frontend keeps its interim behavior
    for them.
    """
    content = request.content.strip()
    if not content:
        raise problem_exception(400, "Bad Request", "content must not be empty")

    result = classify_query(content)
    answer = None
    if result.intent is AskIntent.TOPIC_BILLS:
        answer = _topic_bills_answer(db, result.topic)

    return DetailResponse(
        data=AskAnswerPayload(
            intent=result.intent.value,
            source=result.source,
            confidence=result.confidence,
            answer=answer,
        ),
        links={"self": "/api/v1/ask"},
    )
