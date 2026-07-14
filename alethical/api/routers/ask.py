from __future__ import annotations

import re

from fastapi import APIRouter, Depends
from sqlalchemy import String, and_, cast, func, or_, select
from sqlalchemy.orm import Session

from alethical.api.auth import get_optional_current_user
from alethical.api.problems import problem_exception
from alethical.api.schemas import (
    AskAnswerPayload,
    AskClassificationPayload,
    AskClassifyRequest,
    AskLegislatorBillRef,
    AskLegislatorRow,
    AskSessionRef,
    AskTopicBillsAnswer,
    AskTopicLegislatorsAnswer,
    AskVoteDeflectionAnswer,
    DetailResponse,
)
from alethical.api.rate_limit import rate_limit
from alethical.api.serializers import bill_list_item, bill_status_key_from_summary
from alethical.api.services.ask_router import AskIntent, classify_query
from alethical.db.schema import load_schema
from alethical.db.session import get_db

schema = load_schema()
Bill = schema.Bill
AIEnrichment = schema.AIEnrichment
Chamber = schema.Chamber
District = schema.District
EnrichmentType = schema.EnrichmentType
IngestionRun = schema.IngestionRun
IngestionStatus = schema.IngestionStatus
LegislativeSession = schema.LegislativeSession
Legislator = schema.Legislator
LegislatorServicePeriod = schema.LegislatorServicePeriod
Sponsorship = schema.Sponsorship
SponsorshipRole = schema.SponsorshipRole
bill_list_stmt = schema.bill_list_stmt
current_bill_summary_enrichment_bill_ids = (
    schema.current_bill_summary_enrichment_bill_ids
)

router = APIRouter()

# Both Ask endpoints make an OpenAI classify call, so they share one budget (#98).
_ask_rate_limit = rate_limit("ask_limiter", "ask")

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

# Only chief/co-authorship counts toward the authored/co-authored numbers.
# The `sponsor` role and committee-target rows are held out until the §5.3
# spike confirms their semantics (docs/grounded-ask-spec.md §4.2).
_AUTHORSHIP_ROLES = (SponsorshipRole.chief_author, SponsorshipRole.co_author)

# A House/Senate file citation in free text: "HF 2136", "H.F. 2136", "SF1832",
# "S. F. 1832". The high-precision half of §4.6 bill resolution (HF/SF-number
# regex + fuzzy title); fuzzy title match lands with the bill_text path, where
# a titled bill is the realistic input. Leading zeros are tolerated and dropped.
_BILL_REFERENCE_RE = re.compile(r"\b([HS])\.?\s*F\.?\s*0*(\d{1,5})\b", re.IGNORECASE)


def _progress_sort_key(bill):
    rank = _PROGRESS_ORDER.get(bill_status_key_from_summary(bill), len(_PROGRESS_ORDER))
    action_ts = (
        bill.latest_action_at.timestamp() if bill.latest_action_at else float("-inf")
    )
    return (rank, -action_ts, bill.file_number, bill.bill_key)


def _matched_bill_ids_select(session_id, topic_value: str):
    """Bill ids matching a topic in the current session — the single predicate
    both topic answer paths share so their result sets stay in lockstep.

    A bill matches on a policy-area tag OR a title/description keyword hit,
    restricted to current-session bills that carry an AI summary."""
    pattern = f"%{topic_value}%"
    matching_policy_area_bills = select(AIEnrichment.bill_id).where(
        AIEnrichment.enrichment_type == EnrichmentType.bill_summary,
        AIEnrichment.is_current.is_(True),
        cast(AIEnrichment.content_json["policy_areas"], String).ilike(pattern),
    )
    return select(Bill.id).where(
        Bill.session_id == session_id,
        Bill.id.in_(current_bill_summary_enrichment_bill_ids()),
        or_(
            Bill.id.in_(matching_policy_area_bills),
            Bill.title.ilike(pattern),
            Bill.description.ilike(pattern),
        ),
    )


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

    stmt = bill_list_stmt(session_row.id).where(
        Bill.id.in_(_matched_bill_ids_select(session_row.id, topic_value))
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


def _topic_legislators_answer(
    db: Session, topic: str | None
) -> AskTopicLegislatorsAnswer:
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
    empty = AskTopicLegislatorsAnswer(
        topic=topic_value or None,
        session=session_ref,
        data_as_of=data_as_of,
        total_matches=0,
        total_bills=0,
        legislators=[],
    )
    if len(topic_value) < _MIN_TOPIC_LENGTH:
        return empty

    matched_bill_ids = _matched_bill_ids_select(session_row.id, topic_value)
    total_bills = db.scalar(
        select(func.count()).select_from(matched_bill_ids.subquery())
    )
    if not total_bills:
        return empty

    # Matched bills → authorship rows → legislators, joined to their current
    # service period so we can group by chamber. The inner join to the current
    # period drops non-current members (who have no chamber to group under) and
    # the legislator_id join drops committee-target sponsorship rows.
    rows = db.execute(
        select(
            Legislator.id,
            Legislator.full_name,
            Legislator.sort_name,
            LegislatorServicePeriod.party,
            LegislatorServicePeriod.profile_url,
            Chamber.slug.label("chamber"),
            District.code.label("district"),
            Sponsorship.role,
            Bill.id.label("bill_id"),
            Bill.bill_key,
            Bill.file_type,
            Bill.file_number,
            Bill.title,
        )
        .select_from(Sponsorship)
        .join(Bill, Bill.id == Sponsorship.bill_id)
        .join(Legislator, Legislator.id == Sponsorship.legislator_id)
        .join(
            LegislatorServicePeriod,
            and_(
                LegislatorServicePeriod.legislator_id == Legislator.id,
                LegislatorServicePeriod.session_id == session_row.id,
                LegislatorServicePeriod.is_current.is_(True),
            ),
        )
        .join(Chamber, Chamber.id == LegislatorServicePeriod.chamber_id)
        .join(District, District.id == LegislatorServicePeriod.district_id)
        .where(
            Bill.id.in_(matched_bill_ids),
            Sponsorship.role.in_(_AUTHORSHIP_ROLES),
        )
    ).all()

    legislators: dict[str, dict] = {}
    for row in rows:
        key = str(row.id)
        entry = legislators.get(key)
        if entry is None:
            entry = {
                "id": key,
                "full_name": row.full_name,
                "sort_name": row.sort_name,
                "party": row.party,
                "district": row.district,
                "chamber": row.chamber,
                "profile_url": row.profile_url,
                "authored": set(),
                "coauthored": set(),
                "bills": {},
            }
            legislators[key] = entry
        if row.role is SponsorshipRole.chief_author:
            entry["authored"].add(row.bill_id)
        else:
            entry["coauthored"].add(row.bill_id)
        entry["bills"][row.bill_id] = AskLegislatorBillRef(
            id=row.bill_key,
            file_type=row.file_type,
            file_number=row.file_number,
            title=row.title,
        )

    # Deterministic order for the shareable ?q= link: most bills first, then
    # name, then id. Cap the rendered list; the overflow points to Search.
    ordered = sorted(
        legislators.values(),
        key=lambda e: (
            -(len(e["authored"]) + len(e["coauthored"])),
            e["sort_name"],
            e["id"],
        ),
    )
    displayed = [
        AskLegislatorRow(
            id=e["id"],
            full_name=e["full_name"],
            party=e["party"],
            district=e["district"],
            chamber=e["chamber"],
            profile_url=e["profile_url"],
            authored_count=len(e["authored"]),
            coauthored_count=len(e["coauthored"]),
            bills=sorted(e["bills"].values(), key=lambda b: b.file_number),
        )
        for e in ordered[:_DISPLAY_LIMIT]
    ]
    return AskTopicLegislatorsAnswer(
        topic=topic_value,
        session=session_ref,
        data_as_of=data_as_of,
        total_matches=len(legislators),
        total_bills=total_bills,
        legislators=displayed,
    )


def _parse_bill_reference(content: str) -> tuple[str, int] | None:
    """Extract an ``(file_type, file_number)`` HF/SF citation from free text, or
    ``None``. First match wins — a vote question names at most one bill."""
    match = _BILL_REFERENCE_RE.search(content)
    if match is None:
        return None
    return f"{match.group(1).upper()}F", int(match.group(2))


def _resolve_bill(db: Session, session_id, content: str):
    """Resolve a free-text ask to a single current-session bill by its HF/SF
    number, or ``None`` when no number is named or none matches (§4.6). The
    caller degrades an unresolved ask to the topic_bills list (§4.5).

    Unlike ``bill_list_stmt`` this does not require a bill-summary enrichment —
    the resolved-bill card (§9.4) is records, not a generated summary. It does
    require ``official_url`` so a resolved card always carries its citation
    (grounded rule 1, cite-or-refuse); a bill without one degrades instead."""
    reference = _parse_bill_reference(content)
    if reference is None:
        return None
    file_type, file_number = reference
    stmt = select(Bill).where(
        Bill.session_id == session_id,
        Bill.file_type == file_type,
        Bill.file_number == file_number,
        Bill.official_url.isnot(None),
    )
    return db.scalars(stmt).first()


def _vote_deflection_answer(
    db: Session, content: str, topic: str | None
) -> AskVoteDeflectionAnswer:
    """Scenario 4 v1 honest deflection (docs/grounded-ask-spec.md §4.5 / §9.4).

    Never a vote answer. If the ask names a resolvable bill, carry its card so
    the frontend can deep-link the Votes tab (§9.3); otherwise degrade to the
    cited topic_bills list. No tallies or vote positions in either shape — those
    are records on the Votes tab, not a generated answer (grounded rule 4)."""
    session_row = db.scalar(
        select(LegislativeSession).where(LegislativeSession.is_current.is_(True))
    )
    data_as_of = db.scalar(
        select(func.max(IngestionRun.finished_at)).where(
            IngestionRun.status == IngestionStatus.succeeded
        )
    )
    session_ref = AskSessionRef(slug=session_row.slug, name=session_row.name)

    resolved = _resolve_bill(db, session_row.id, content)
    if resolved is not None:
        return AskVoteDeflectionAnswer(
            session=session_ref,
            data_as_of=data_as_of,
            resolved_bill=bill_list_item(resolved),
            topic_bills=None,
        )
    return AskVoteDeflectionAnswer(
        session=session_ref,
        data_as_of=data_as_of,
        resolved_bill=None,
        topic_bills=_topic_bills_answer(db, topic),
    )


@router.post("/ask/classify", response_model=DetailResponse, status_code=200)
def classify_ask_query(
    request: AskClassifyRequest,
    _current_user=Depends(get_optional_current_user),
    _rate_limited: None = Depends(_ask_rate_limit),
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
def ask(
    request: AskClassifyRequest,
    db: Session = Depends(get_db),
    _rate_limited: None = Depends(_ask_rate_limit),
):
    """Classify an Ask and build its answer body.

    Answered intents: topic_bills / topic_legislators (cited lists) and
    legislator_vote (the §4.5 honest deflection — a resolved-bill card or a
    topic_bills degrade, never a vote answer). Anonymous by design — every v1
    answer path is signed-out-accessible (docs/grounded-ask-spec.md §9.1). The
    remaining intents (bill_text, refuse) return no answer body until their
    slices of #79 land; the frontend keeps its interim behavior for them.
    """
    content = request.content.strip()
    if not content:
        raise problem_exception(400, "Bad Request", "content must not be empty")

    result = classify_query(content)
    answer = None
    if result.intent is AskIntent.TOPIC_BILLS:
        answer = _topic_bills_answer(db, result.topic)
    elif result.intent is AskIntent.TOPIC_LEGISLATORS:
        answer = _topic_legislators_answer(db, result.topic)
    elif result.intent is AskIntent.LEGISLATOR_VOTE:
        answer = _vote_deflection_answer(db, content, result.topic)

    return DetailResponse(
        data=AskAnswerPayload(
            intent=result.intent.value,
            source=result.source,
            confidence=result.confidence,
            answer=answer,
        ),
        links={"self": "/api/v1/ask"},
    )
