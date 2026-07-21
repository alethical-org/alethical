from __future__ import annotations

import re

from datetime import datetime, timezone
from typing import Any, Literal
from uuid import UUID

import requests

from fastapi import APIRouter, Depends, HTTPException, Query, Response
from sqlalchemy import and_, case, func, or_, select, text
from sqlalchemy.orm import Session

from alethical.api.auth import get_optional_current_user
from alethical.api.issue_taxonomy import alias_canonical_arrays, aliases_for
from alethical.api.problems import problem_exception
from alethical.api.rate_limit import rate_limit
from alethical.api.schemas import (
    CollectionResponse,
    DetailResponse,
    MetaPayload,
    RepresentativeLookupRequest,
)
from alethical.api.services.representative_lookup import (
    DistrictMatch,
    RepresentativeLookupNotFound,
    RepresentativeLookupService,
    RepresentativeLookupUpstreamError,
    get_representative_lookup_service,
)
from alethical.api.serializers import (
    ai_analysis_payload_for_enrichment,
    bill_list_item,
    bill_progress_payload,
    bill_status_key,
    companion_payload,
    current_bill_summary_enrichment,
    current_service_payload,
    district_payload,
    legislator_list_item,
    sponsor_payloads,
    tracking_payload,
)
from alethical.db.schema import load_schema
from alethical.db.session import get_db

schema = load_schema()
Bill = schema.Bill
BillAction = schema.BillAction
AIEnrichment = schema.AIEnrichment
BillVersion = schema.BillVersion
BillVersionSection = schema.BillVersionSection
Chamber = schema.Chamber
ChamberType = schema.ChamberType
Committee = schema.Committee
CommitteeMembership = schema.CommitteeMembership
District = schema.District
EnrichmentType = schema.EnrichmentType
IngestionRun = schema.IngestionRun
IngestionStatus = schema.IngestionStatus
Jurisdiction = schema.Jurisdiction
LegislativeSession = schema.LegislativeSession
Legislator = schema.Legislator
LegislatorServicePeriod = schema.LegislatorServicePeriod
Sponsorship = schema.Sponsorship
SponsorshipRole = schema.SponsorshipRole
bill_detail_stmt = schema.bill_detail_stmt
bill_list_stmt = schema.bill_list_stmt
bill_status_key_expr = schema.bill_status_key_expr
find_my_legislator_stmt = schema.find_my_legislator_stmt
legislator_directory_stmt = schema.legislator_directory_stmt
legislator_profile_stmt = schema.legislator_profile_stmt
legislator_sponsored_bills_stmt = schema.legislator_sponsored_bills_stmt

router = APIRouter()

# Public record reads (bills/legislators lists and detail) change only when
# ingestion runs — human-triggered and infrequent — so they carry a short
# shared-cache TTL with a longer stale-while-revalidate window. This lets the
# browser serve repeat loads instantly and lets a CDN, once in front of the API,
# absorb the first hit for everyone (the ~1s cost today is the DB query, not the
# network). Responses that vary by user (tracking state) are never cached.
PUBLIC_CACHE_CONTROL = "public, max-age=60, stale-while-revalidate=300"
PRIVATE_CACHE_CONTROL = "private, no-store"


def paginated_scalars(db: Session, stmt, *, limit: int, offset: int):
    if limit == 0:
        return [], False
    rows = db.scalars(stmt.offset(offset).limit(limit + 1)).all()
    return rows[:limit], len(rows) > limit


def authored_bill_counts(db: Session, legislator_ids) -> dict[str, tuple[int, int]]:
    """Live authored-bill counts (total, chief) for the given rows, counted
    directly from Sponsorship in one grouped query -- no per-row N+1. Returns
    {legislator_id: (total_bill_count, chief_bill_count)}.

    Since #302 merged the duplicate bill-author rows into their roster row, every
    member's sponsorships live on the single canonical row, so this counts
    Sponsorship on each requested id directly (no more suffix self-join to a
    separate placeholder row)."""
    ids = list(legislator_ids)
    if not ids:
        return {}
    rows = db.execute(
        select(
            Sponsorship.legislator_id,
            func.count(func.distinct(Sponsorship.bill_id)).label("total"),
            func.count(
                func.distinct(
                    case(
                        (
                            Sponsorship.role == SponsorshipRole.chief_author,
                            Sponsorship.bill_id,
                        )
                    )
                )
            ).label("chief"),
        )
        .where(Sponsorship.legislator_id.in_(ids))
        .group_by(Sponsorship.legislator_id)
    ).all()
    return {str(row.legislator_id): (row.total, row.chief) for row in rows}


def bill_co_author_counts(db: Session, bill_ids) -> dict[str, int]:
    """Co-author count per bill -- distinct legislators with a co_author-role
    sponsorship, excluding the chief author and the distinct 'sponsor' role
    (grounded-answers rule 3, MN author/co-author terminology). Computed set-wise
    in one grouped query for the whole page (no per-row N+1). Feeds the Search
    Bills card's "+N co-authors" line (#295). Returns {bill_id: count}."""
    ids = list(bill_ids)
    if not ids:
        return {}
    rows = db.execute(
        select(
            Sponsorship.bill_id,
            func.count(func.distinct(Sponsorship.legislator_id)),
        )
        .where(
            Sponsorship.bill_id.in_(ids),
            Sponsorship.role == SponsorshipRole.co_author,
        )
        .group_by(Sponsorship.bill_id)
    ).all()
    return {str(bill_id): count for bill_id, count in rows}


def current_committee_names(db: Session, legislator_ids) -> dict[str, list[str]]:
    """Current committee names per directory row, in one grouped query (no N+1).

    Unlike sponsorships (which live on the bill-author row, see
    authored_bill_counts), committee memberships are scraped onto the roster row
    shown in the directory, so we read them directly off the requested ids.
    Returns {legislator_id: [committee_name, ...]} ordered by name."""
    ids = list(legislator_ids)
    if not ids:
        return {}
    rows = db.execute(
        select(CommitteeMembership.legislator_id, Committee.name)
        .join(Committee, Committee.id == CommitteeMembership.committee_id)
        .where(
            CommitteeMembership.legislator_id.in_(ids),
            CommitteeMembership.is_current.is_(True),
        )
        .order_by(Committee.name.asc())
    ).all()
    result: dict[str, list[str]] = {}
    for legislator_id, name in rows:
        result.setdefault(str(legislator_id), []).append(name)
    return result


_BILL_NUMBER_QUERY_RE = re.compile(r"^\s*([A-Za-z]{2})\s*0*(\d+)\s*$")


def bill_number_clause(q: str):
    """Match a chamber-prefix + number query ("HF 2904", "HF2904", "SF 1832")
    against file_type + file_number so bill-number searches resolve (#134).
    Returns None when the query isn't a bill number, leaving keyword search
    untouched."""
    match = _BILL_NUMBER_QUERY_RE.match(q)
    if match is None:
        return None
    file_type, file_number = match.group(1), int(match.group(2))
    return and_(
        func.lower(Bill.file_type) == file_type.lower(),
        Bill.file_number == file_number,
    )


def latest_ingested_at(db: Session):
    """Newest succeeded-ingestion finish time — the "Data as of" provenance
    timestamp shown on the bill search screen and Ask answer pages (#134)."""
    return db.scalar(
        select(func.max(IngestionRun.finished_at)).where(
            IngestionRun.status == IngestionStatus.succeeded
        )
    )


def get_session_by_slug(db: Session, slug: str | None):
    if slug:
        session_row = db.scalar(
            select(LegislativeSession).where(LegislativeSession.slug == slug)
        )
    else:
        session_row = db.scalar(
            select(LegislativeSession).where(LegislativeSession.is_current.is_(True))
        )
    if session_row is None:
        raise HTTPException(status_code=404, detail="session not found")
    return session_row


def get_bill_by_key(db: Session, bill_key: str):
    bill = db.scalar(select(Bill).where(Bill.bill_key == bill_key))
    if bill is None:
        raise HTTPException(status_code=404, detail="bill not found")
    return bill


def get_legislator_by_id(db: Session, legislator_id: str):
    try:
        parsed_id = UUID(legislator_id)
    except ValueError:
        raise HTTPException(status_code=404, detail="legislator not found") from None
    legislator = db.scalar(select(Legislator).where(Legislator.id == parsed_id))
    if legislator is None:
        raise HTTPException(status_code=404, detail="legislator not found")
    return legislator


def member_name_by_legislator(db: Session, legislator_ids) -> dict[str, str]:
    """Full name per legislator id, batched in one query for a whole roll call
    (no per-member N+1). Feeds the /votes per-member records (#83)."""
    ids = list(legislator_ids)
    if not ids:
        return {}
    rows = db.execute(
        select(Legislator.id, Legislator.full_name).where(Legislator.id.in_(ids))
    ).all()
    return {str(legislator_id): full_name for legislator_id, full_name in rows}


def member_party_by_legislator(db: Session, legislator_ids) -> dict[str, str | None]:
    """Current/latest party per legislator id, batched in one query for a whole
    roll call (no per-member N+1). Picks each legislator's current period, else
    the most recent one (ORDER BY is_current DESC, start_date DESC NULLS LAST),
    via DISTINCT ON. Party is served raw (prod has 'DFL', 'R', and a stray
    'Republican'). Feeds the /votes per-member records (#83)."""
    ids = list(legislator_ids)
    if not ids:
        return {}
    rows = db.execute(
        select(
            LegislatorServicePeriod.legislator_id,
            LegislatorServicePeriod.party,
        )
        .where(LegislatorServicePeriod.legislator_id.in_(ids))
        .distinct(LegislatorServicePeriod.legislator_id)
        .order_by(
            LegislatorServicePeriod.legislator_id,
            LegislatorServicePeriod.is_current.desc(),
            LegislatorServicePeriod.start_date.desc().nullslast(),
        )
    ).all()
    return {str(legislator_id): party for legislator_id, party in rows}


def tracking_user_id(include_set: set[str], current_user):
    if "tracking" not in include_set:
        return None
    if current_user is None:
        raise problem_exception(
            401, "Unauthorized", "Authentication required to include tracking state"
        )
    return current_user.id


def district_for_match(db: Session, match: DistrictMatch | None):
    if match is None:
        return None
    if match.chamber == "house":
        chamber_type = ChamberType.house
    elif match.chamber == "senate":
        chamber_type = ChamberType.senate
    else:
        return None
    return db.scalar(
        select(District)
        .join(Chamber, Chamber.id == District.chamber_id)
        .where(
            District.code == match.district_code.upper(),
            Chamber.chamber_type == chamber_type,
        )
    )


def status_filter_clause(status: str):
    """Filter bills to a single status, matching the list-card badge exactly.

    Classifies each bill with ``bill_status_key_expr`` — the same cascade the
    displayed badge uses — and keeps only the bills whose derived key equals the
    selected status. Because every bill maps to exactly one status, the six
    filters are mutually exclusive and their counts sum to the session total
    (the prior per-status OR-substring match double-counted any bill whose
    latest-action text hit two stages, e.g. "Introduction and first reading,
    referred to committee" landed in both "proposed" and "in_committee"). An
    unrecognized status matches nothing, which is correct — it has no bills.
    """
    normalized = status.strip().lower().replace(" ", "_")
    return bill_status_key_expr() == normalized


@router.get("/meta", response_model=DetailResponse)
def meta(db: Session = Depends(get_db)):
    jurisdiction = db.scalar(
        select(Jurisdiction).where(Jurisdiction.slug == "minnesota")
    )
    current_session = db.scalar(
        select(LegislativeSession).where(LegislativeSession.is_current.is_(True))
    )
    payload = MetaPayload(
        api_version="v1",
        jurisdiction={"slug": jurisdiction.slug, "name": jurisdiction.name},
        current_session={
            "slug": current_session.slug,
            "name": current_session.name,
            "is_current": current_session.is_current,
        },
        data_as_of=latest_ingested_at(db),
    )
    return DetailResponse(data=payload, links={"self": "/api/v1/meta"})


@router.get("/sessions", response_model=CollectionResponse)
def sessions(db: Session = Depends(get_db)):
    rows = db.scalars(
        select(LegislativeSession).order_by(LegislativeSession.year_start.desc())
    ).all()
    data = [
        {"slug": row.slug, "name": row.name, "is_current": row.is_current}
        for row in rows
    ]
    return CollectionResponse(
        data=data, page={"limit": len(data), "next_cursor": None, "has_more": False}
    )


@router.get("/sessions/current", response_model=DetailResponse)
def current_session(db: Session = Depends(get_db)):
    row = db.scalar(
        select(LegislativeSession).where(LegislativeSession.is_current.is_(True))
    )
    return DetailResponse(
        data={"slug": row.slug, "name": row.name, "is_current": row.is_current}
    )


@router.get("/policy-areas", response_model=CollectionResponse)
def policy_areas(
    session: str | None = None,
    limit: int = Query(default=50, le=100),
    db: Session = Depends(get_db),
):
    session_row = get_session_by_slug(db, session)
    # The AI enrichment emits ~7,600 distinct free-text policy areas with heavy
    # casing/synonym fragmentation, so roll each raw value up to a curated
    # canonical issue (alethical/api/issue_taxonomy.py) and count distinct bills
    # per canonical. The canonical display name is what the frontend shows and
    # sends back as the /bills policy_area filter, so the chip count and the
    # filtered total agree. Grouping/display only — stored data is untouched.
    aliases, canonicals = alias_canonical_arrays()
    rows = db.execute(
        text(
            """
            WITH m(alias, canonical) AS (
                SELECT * FROM unnest(:aliases ::text[], :canonicals ::text[])
            ),
            bill_area AS (
                SELECT b.id AS bill_id, lower(btrim(e)) AS area
                FROM ai_enrichment ae
                JOIN bill b ON b.id = ae.bill_id,
                     LATERAL jsonb_array_elements_text(
                         ae.content_json -> 'policy_areas'
                     ) AS e
                WHERE b.session_id = :sid ::uuid
                  AND ae.enrichment_type = 'bill_summary'
                  AND ae.is_current IS true
                  AND btrim(e) <> ''
            )
            SELECT m.canonical AS name, count(DISTINCT ba.bill_id) AS bill_count
            FROM bill_area ba
            JOIN m ON m.alias = ba.area
            GROUP BY m.canonical
            ORDER BY bill_count DESC, name ASC
            LIMIT :limit
            """
        ),
        {
            "aliases": aliases,
            "canonicals": canonicals,
            "sid": str(session_row.id),
            "limit": limit,
        },
    ).all()
    data = [{"name": name, "bill_count": count} for name, count in rows]
    return CollectionResponse(
        data=data,
        page={"limit": limit, "next_cursor": None, "has_more": False},
        links={"self": "/api/v1/policy-areas"},
    )


@router.get("/bills", response_model=CollectionResponse)
def bills(
    session: str | None = None,
    q: str | None = None,
    chamber: str | None = None,
    status: str | None = None,
    policy_area: str | None = None,
    omnibus: bool | None = None,
    include: str | None = None,
    sort: Literal["latest_action", "progress", "introduced"] = "latest_action",
    limit: int = Query(default=20, ge=0, le=100),
    offset: int = Query(default=0, ge=0),
    db: Session = Depends(get_db),
    current_user=Depends(get_optional_current_user),
    response: Response = None,  # type: ignore[assignment]
):
    session_row = get_session_by_slug(db, session)
    include_set = {item.strip() for item in include.split(",")} if include else set()
    # Cacheable only when the response carries no per-user data: anonymous and
    # no tracking include. (Anonymous + tracking already 401s upstream.)
    response.headers["Cache-Control"] = (
        PUBLIC_CACHE_CONTROL
        if current_user is None and "tracking" not in include_set
        else PRIVATE_CACHE_CONTROL
    )
    stmt = bill_list_stmt(
        session_row.id,
        user_id=tracking_user_id(include_set, current_user),
        sort=sort,
    )
    if q:
        keyword_clauses = [Bill.title.ilike(f"%{q}%"), Bill.description.ilike(f"%{q}%")]
        number_clause = bill_number_clause(q)
        if number_clause is not None:
            keyword_clauses.append(number_clause)
        stmt = stmt.where(or_(*keyword_clauses))
    if chamber:
        stmt = stmt.where(Bill.chamber.has(Chamber.slug == chamber.strip().lower()))
    if status:
        stmt = stmt.where(status_filter_clause(status))
    if policy_area:
        # Match any raw policy area that rolls up to the selected canonical issue
        # (alethical/api/issue_taxonomy.py) — so "Health" catches "healthcare",
        # "public health", etc. Case-folded whole-element match via unnest (a
        # whole-array cast + ILIKE would over-match and, with sort=progress, time
        # out to a 502). aliases_for falls back to the value itself for an
        # unmapped issue. Measured ~270ms on the production corpus.
        policy_area_aliases = aliases_for(policy_area)
        element = func.jsonb_array_elements_text(
            AIEnrichment.content_json["policy_areas"]
        ).table_valued("value")
        element_matches = (
            select(1)
            .select_from(element)
            .where(func.lower(func.btrim(element.c.value)).in_(policy_area_aliases))
            .exists()
        )
        matching_policy_area_bills = select(AIEnrichment.bill_id).where(
            AIEnrichment.enrichment_type == EnrichmentType.bill_summary,
            AIEnrichment.is_current.is_(True),
            element_matches,
        )
        stmt = stmt.where(Bill.id.in_(matching_policy_area_bills))
    if omnibus is not None:
        stmt = stmt.where(Bill.is_omnibus.is_(omnibus))
    total = db.scalar(select(func.count()).select_from(stmt.order_by(None).subquery()))
    rows, has_more = paginated_scalars(db, stmt, limit=limit, offset=offset)
    co_author_counts = bill_co_author_counts(db, [row.id for row in rows])
    data = [
        bill_list_item(
            row,
            include_tracking="tracking" in include_set and current_user is not None,
            co_author_count=co_author_counts.get(str(row.id), 0),
        )
        for row in rows
    ]
    return CollectionResponse(
        data=[item.model_dump(exclude_none=True) for item in data],
        page={
            "limit": limit,
            "offset": offset,
            "next_cursor": None,
            "has_more": has_more,
            "total": total,
        },
        links={"self": "/api/v1/bills"},
    )


# A signed Minnesota bill's Laws-of-Minnesota chapter lives in its actions, not
# in any text version: Revisor's text_versions stop at the highest engrossment
# and carry no session-law entry. Two actions hold what we need — a
# "Chapter number" action whose description is the chapter (e.g. "45"), and a
# "Secretary of State" action carrying the filing date ("Chapter 45 03/01/26").
_CHAPTER_ACTION_TEXT = "chapter number"
_SECRETARY_ACTION_TEXTS = ("secretary of state, filed", "secretary of state")
# Extracts MM/DD/YY or MM/DD/YYYY from a Secretary-of-State action description.
_FILING_DATE_RE = re.compile(r"(\d{1,2})/(\d{1,2})/(\d{2,4})")
# The bill's Revisor URL encodes /bills/{session_number}/{year}/{session_type}/…;
# the session_type segment (0 = regular) also indexes the Laws volume.
_BILL_SESSION_TYPE_RE = re.compile(r"/bills/\d+/\d+/(\d+)/")


def session_law_version(bill_row) -> dict[str, Any] | None:
    """Synthesize a "Session Law" version for an enacted bill from its already-
    ingested actions, or None if the bill never became law (grounded-answers
    rule 7 — only enacted bills carry this).

    Derived at serialization time rather than stored, so the ``bill_version``
    table, the one-current-version invariant (#285/#287), and RAG retrieval are
    all untouched. The Laws-of-Minnesota chapter is genuine primary-source data
    (rule 9): the number comes from the "Chapter number" action, and the Laws
    volume year from the "Secretary of State" filing date — which can differ
    from the bill's session year (a 2025-session bill signed in 2026 is Laws
    2026), so we never take the year from the session.
    """
    actions = list(bill_row.actions or [])

    chapter = next(
        (
            desc
            for action in actions
            if (action.action_text or "").strip().lower() == _CHAPTER_ACTION_TEXT
            and (desc := (action.action_description or "").strip()).isdigit()
        ),
        None,
    )
    if chapter is None:
        return None

    filing_date: datetime | None = None
    for action in actions:
        if (action.action_text or "").strip().lower() in _SECRETARY_ACTION_TEXTS:
            match = _FILING_DATE_RE.search(action.action_description or "")
            if match:
                month, day, year = (int(part) for part in match.groups())
                if year < 100:
                    year += 2000
                filing_date = datetime(year, month, day, tzinfo=timezone.utc)
                break

    # "Read the full law" links straight to the official Laws chapter page. We
    # emit it only when the filing year is known; a chapter number alone can't
    # locate the right yearly volume, and a wrong citation is worse than none
    # (rule 1). The session-type segment comes from the bill's own Revisor URL.
    html_url = None
    if filing_date is not None:
        type_match = _BILL_SESSION_TYPE_RE.search(bill_row.official_url or "")
        session_type = type_match.group(1) if type_match else "0"
        html_url = (
            f"https://www.revisor.mn.gov/laws/{filing_date.year}/{session_type}"
            f"/Session+Law/Chapter/{chapter}/"
        )

    return {
        "version_code": "session-law",
        "version_name": f"Session Law — Chapter {chapter}",
        "document_date": filing_date,
        "html_url": html_url,
        "pdf_url": None,
        "is_current": False,
    }


def bill_version_payloads(bill_row) -> list[dict[str, Any]]:
    """Serialize a bill's versions, appending a synthesized "Session Law"
    version (the final "this is now law" entry) for enacted bills (#438)."""
    payloads = [
        {
            "version_code": version.version_code,
            "version_name": version.version_name,
            "document_date": version.document_date,
            "html_url": version.html_url,
            "pdf_url": version.pdf_url,
            "is_current": version.is_current,
        }
        for version in bill_row.versions
    ]
    session_law = session_law_version(bill_row)
    if session_law is not None:
        payloads.append(session_law)
    return payloads


@router.get("/bills/{bill_id}", response_model=DetailResponse)
def bill_detail(
    bill_id: str,
    include: str | None = None,
    db: Session = Depends(get_db),
    current_user=Depends(get_optional_current_user),
    response: Response = None,  # type: ignore[assignment]
):
    bill_row = get_bill_by_key(db, bill_id)
    include_set = {item.strip() for item in include.split(",")} if include else set()
    # Cacheable unless the response carries per-user tracking state (see /bills).
    response.headers["Cache-Control"] = (
        PUBLIC_CACHE_CONTROL
        if current_user is None and "tracking" not in include_set
        else PRIVATE_CACHE_CONTROL
    )
    row = db.scalar(
        bill_detail_stmt(
            bill_row.id,
            user_id=tracking_user_id(include_set, current_user),
        )
    )
    ai_enrichment = None
    if {"ai_summary", "ai_analysis"} & include_set:
        ai_enrichment = current_bill_summary_enrichment(row.enrichments)
    if "ai_analysis" in include_set and ai_enrichment is None:
        raise HTTPException(status_code=404, detail="bill enrichment not found")
    payload = {
        "id": row.bill_key,
        "title": row.title,
        "description": row.description,
        "current_status": row.current_status,
        "status_key": bill_status_key(row),
        "latest_action_at": row.latest_action_at,
        "official_url": row.official_url,
        "is_omnibus": row.is_omnibus,
        "companion": (
            payload_model.model_dump()
            if (payload_model := companion_payload(row)) is not None
            else None
        ),
        "chief_sponsors": [
            item.model_dump()
            for item in sponsor_payloads(
                row.chief_sponsorships,
                session_id=row.session_id,
            )
        ],
        "tracking": tracking_payload(row.tracked_by).model_dump()
        if "tracking" in include_set and current_user
        else None,
        "ai_analysis": ai_analysis_payload_for_enrichment(
            ai_enrichment, row.official_url
        ),
        "ai_summary": ai_enrichment.content_json if ai_enrichment else None,
    }
    if "all_sponsors" in include_set:
        payload["all_sponsors"] = [
            item.model_dump()
            for item in sponsor_payloads(
                row.sponsorships,
                session_id=row.session_id,
            )
        ]
    if "progress" in include_set:
        payload["progress"] = [item.model_dump() for item in bill_progress_payload(row)]
    if "actions" in include_set:
        payload["actions"] = [
            {
                "action_number": action.action_number,
                "action_text": action.action_text,
                "action_group": action.action_group,
                "action_description": action.action_description,
                "action_at": action.action_at,
                "journal_page": action.journal_page,
                "roll_call_text": action.roll_call_text,
            }
            for action in row.actions
        ]
    if "versions" in include_set:
        payload["versions"] = bill_version_payloads(row)
    return DetailResponse(
        data={key: value for key, value in payload.items() if value is not None}
    )


@router.get("/bills/{bill_id}/actions", response_model=CollectionResponse)
def bill_actions(bill_id: str, db: Session = Depends(get_db)):
    bill_row = get_bill_by_key(db, bill_id)
    row = db.scalar(bill_detail_stmt(bill_row.id))
    data = [
        {
            "action_number": action.action_number,
            "action_text": action.action_text,
            "action_group": action.action_group,
            "action_description": action.action_description,
            "action_at": action.action_at,
            "journal_page": action.journal_page,
            "roll_call_text": action.roll_call_text,
        }
        for action in row.actions
    ]
    return CollectionResponse(
        data=data, page={"limit": len(data), "next_cursor": None, "has_more": False}
    )


@router.get("/bills/{bill_id}/versions", response_model=CollectionResponse)
def bill_versions(bill_id: str, db: Session = Depends(get_db)):
    bill_row = get_bill_by_key(db, bill_id)
    row = db.scalar(bill_detail_stmt(bill_row.id))
    data = bill_version_payloads(row)
    return CollectionResponse(
        data=data, page={"limit": len(data), "next_cursor": None, "has_more": False}
    )


@router.get("/bills/{bill_id}/versions/{version_code}", response_model=DetailResponse)
def bill_version_detail(bill_id: str, version_code: str, db: Session = Depends(get_db)):
    bill_row = get_bill_by_key(db, bill_id)
    version = db.scalar(
        select(BillVersion).where(
            BillVersion.bill_id == bill_row.id, BillVersion.version_code == version_code
        )
    )
    if version is None:
        raise HTTPException(status_code=404, detail="bill version not found")
    return DetailResponse(
        data={
            "version_code": version.version_code,
            "version_name": version.version_name,
            "document_date": version.document_date,
            "html_url": version.html_url,
            "pdf_url": version.pdf_url,
            "is_current": version.is_current,
        }
    )


@router.get(
    "/bills/{bill_id}/versions/{version_code}/text", response_model=DetailResponse
)
def bill_version_text(
    bill_id: str,
    version_code: str,
    format: str = "structured",
    db: Session = Depends(get_db),
):
    bill_row = get_bill_by_key(db, bill_id)
    version = db.scalar(
        select(BillVersion).where(
            BillVersion.bill_id == bill_row.id, BillVersion.version_code == version_code
        )
    )
    if version is None:
        raise HTTPException(status_code=404, detail="bill version not found")
    sections = db.scalars(
        select(BillVersionSection)
        .where(BillVersionSection.bill_version_id == version.id)
        .order_by(BillVersionSection.source_order.asc())
    ).all()
    if format == "plain":
        return DetailResponse(
            data={
                "version_code": version.version_code,
                "text": "\n\n".join(section.raw_text for section in sections),
            }
        )
    return DetailResponse(
        data={
            "version_code": version.version_code,
            "sections": [
                {
                    "section_id": section.section_id_text,
                    "heading": section.section_heading,
                    "article_heading": section.article_heading,
                    "text": section.raw_text,
                }
                for section in sections
            ],
        }
    )


@router.get("/bills/{bill_id}/votes", response_model=CollectionResponse)
def bill_votes(
    bill_id: str,
    db: Session = Depends(get_db),
    response: Response = None,  # type: ignore[assignment]
):
    # Vote records carry no per-user data — always publicly cacheable.
    response.headers["Cache-Control"] = PUBLIC_CACHE_CONTROL
    bill_row = get_bill_by_key(db, bill_id)
    row = db.scalar(bill_detail_stmt(bill_row.id))
    # Resolve each voter's name + party once for the whole roll call, batched
    # across every vote event, so party-grouped attribution renders (#83).
    voter_ids = {
        record.legislator_id
        for vote_event in row.vote_events
        for record in vote_event.records
    }
    names = member_name_by_legislator(db, voter_ids)
    parties = member_party_by_legislator(db, voter_ids)
    data = [
        {
            "id": str(vote_event.id),
            "motion_text": vote_event.motion_text,
            "result_text": vote_event.result_text,
            "yes_count": vote_event.yes_count,
            "no_count": vote_event.no_count,
            "absent_count": vote_event.absent_count,
            "excused_count": vote_event.excused_count,
            "present_count": vote_event.present_count,
            "occurred_at": vote_event.occurred_at,
            "official_url": vote_event.official_url,
            # Per-member roll call (#83). Records are eager-loaded by
            # bill_detail_stmt; only yes/no records are ingested today, so a
            # "did-not-vote" state is deliberately not synthesized here.
            "records": [
                {
                    "legislator_id": str(record.legislator_id),
                    "legislator_name": names.get(str(record.legislator_id)),
                    "party": parties.get(str(record.legislator_id)),
                    "vote_value": record.vote_value.value,
                }
                for record in vote_event.records
            ],
        }
        for vote_event in row.vote_events
    ]
    return CollectionResponse(
        data=data, page={"limit": len(data), "next_cursor": None, "has_more": False}
    )


@router.get("/legislators", response_model=CollectionResponse)
def legislators(
    session: str | None = None,
    q: str | None = None,
    chamber: str | None = None,
    limit: int = Query(default=20, ge=0, le=100),
    offset: int = Query(default=0, ge=0),
    db: Session = Depends(get_db),
):
    session_row = get_session_by_slug(db, session)
    stmt = legislator_directory_stmt(session_row.id)
    if q:
        stmt = stmt.where(Legislator.full_name.ilike(f"%{q}%"))
    if chamber:
        stmt = stmt.where(
            LegislatorServicePeriod.chamber.has(Chamber.slug == chamber.strip().lower())
        )
    total = db.scalar(select(func.count()).select_from(stmt.order_by(None).subquery()))
    rows, has_more = paginated_scalars(db, stmt, limit=limit, offset=offset)
    row_ids = [row.id for row in rows]
    counts = authored_bill_counts(db, row_ids)
    committees = current_committee_names(db, row_ids)
    data = [
        legislator_list_item(
            row,
            total_bill_count=counts.get(str(row.id), (0, 0))[0],
            chief_bill_count=counts.get(str(row.id), (0, 0))[1],
            committee_names=committees.get(str(row.id), []),
        ).model_dump(exclude_none=True)
        for row in rows
    ]
    return CollectionResponse(
        data=data,
        page={
            "limit": limit,
            "offset": offset,
            "next_cursor": None,
            "has_more": has_more,
            "total": total,
        },
        links={"self": "/api/v1/legislators"},
    )


@router.get("/legislators/{legislator_id}", response_model=DetailResponse)
def legislator_detail(
    legislator_id: str,
    session: str | None = None,
    include: str | None = None,
    db: Session = Depends(get_db),
):
    include_set = {item.strip() for item in include.split(",")} if include else set()
    session_row = get_session_by_slug(db, session)
    legislator = get_legislator_by_id(db, legislator_id)
    row = db.scalar(legislator_profile_stmt(legislator.id, session_row.id))
    current_service = next(iter(row.service_periods), None)
    payload = {
        "id": str(row.id),
        "slug": row.slug,
        "full_name": row.full_name,
        "biography": row.biography,
    }
    if "current_service" in include_set:
        payload["current_service"] = (
            current_service_payload(current_service).model_dump()
            if current_service
            else None
        )
    if "stats" in include_set:
        stats = row.stats[0] if row.stats else None
        total_bill_count, chief_bill_count = authored_bill_counts(db, [row.id]).get(
            str(row.id), (0, 0)
        )
        if stats or total_bill_count or chief_bill_count:
            payload["stats"] = {
                "chief_bill_count": chief_bill_count,
                "total_bill_count": total_bill_count,
                "vote_record_count": stats.vote_record_count if stats else 0,
                "committee_count": stats.committee_count if stats else 0,
            }
    if "committees" in include_set:
        payload["committees"] = [
            {"name": membership.committee.name, "role": membership.role}
            for membership in row.committee_memberships
        ]
    return DetailResponse(
        data={key: value for key, value in payload.items() if value is not None}
    )


@router.get("/legislators/{legislator_id}/bills", response_model=CollectionResponse)
def legislator_bills(
    legislator_id: str,
    session: str | None = None,
    limit: int = Query(default=20, ge=0, le=100),
    offset: int = Query(default=0, ge=0),
    db: Session = Depends(get_db),
):
    session_row = get_session_by_slug(db, session)
    legislator = get_legislator_by_id(db, legislator_id)
    rows, has_more = paginated_scalars(
        db,
        legislator_sponsored_bills_stmt(legislator.id, session_row.id),
        limit=limit,
        offset=offset,
    )
    data = [bill_list_item(row).model_dump(exclude_none=True) for row in rows]
    return CollectionResponse(
        data=data,
        page={
            "limit": limit,
            "offset": offset,
            "next_cursor": None,
            "has_more": has_more,
        },
    )


@router.get("/legislators/{legislator_id}/votes", response_model=CollectionResponse)
def legislator_votes(
    legislator_id: str,
    session: str | None = None,
    limit: int = Query(default=20, le=100),
    db: Session = Depends(get_db),
):
    session_row = get_session_by_slug(db, session)
    rows = db.scalars(
        schema.legislator_vote_history_stmt(legislator_id, session_row.id).limit(limit)
    ).all()
    data = [
        {
            "id": str(row.id),
            "vote_value": row.vote_value.value,
            "vote_event_id": str(row.vote_event_id),
        }
        for row in rows
    ]
    return CollectionResponse(
        data=data, page={"limit": limit, "next_cursor": None, "has_more": False}
    )


@router.get("/districts", response_model=CollectionResponse)
def districts(limit: int = Query(default=50, le=200), db: Session = Depends(get_db)):
    rows = db.scalars(select(District).order_by(District.code.asc()).limit(limit)).all()
    data = [district_payload(row).model_dump() for row in rows]
    return CollectionResponse(
        data=data, page={"limit": limit, "next_cursor": None, "has_more": False}
    )


@router.get("/districts/{district_id}", response_model=DetailResponse)
def district_detail(district_id: str, db: Session = Depends(get_db)):
    row = db.scalar(select(District).where(District.id == district_id))
    if row is None:
        raise HTTPException(status_code=404, detail="district not found")
    return DetailResponse(data=district_payload(row).model_dump())


@router.get("/districts/{district_id}/legislators", response_model=CollectionResponse)
def district_legislators(
    district_id: str,
    session: str | None = None,
    db: Session = Depends(get_db),
):
    session_row = get_session_by_slug(db, session)
    rows = db.scalars(find_my_legislator_stmt(session_row.id, [district_id])).all()
    counts = authored_bill_counts(db, [row.legislator.id for row in rows])
    data = [
        legislator_list_item(
            row.legislator,
            total_bill_count=counts.get(str(row.legislator.id), (0, 0))[0],
            chief_bill_count=counts.get(str(row.legislator.id), (0, 0))[1],
        ).model_dump(exclude_none=True)
        for row in rows
    ]
    return CollectionResponse(
        data=data, page={"limit": len(data), "next_cursor": None, "has_more": False}
    )


@router.post("/representative-lookups", response_model=DetailResponse)
def representative_lookup(
    request: RepresentativeLookupRequest,
    db: Session = Depends(get_db),
    lookup_service: RepresentativeLookupService = Depends(
        get_representative_lookup_service
    ),
    _rate_limited: None = Depends(rate_limit("lookup_limiter", "lookup")),
):
    current_session = get_session_by_slug(db, None)
    try:
        if request.address_text:
            lookup_result = lookup_service.lookup(request.address_text)
            input_mode = "address"
        else:
            assert request.latitude is not None
            assert request.longitude is not None
            lookup_result = lookup_service.lookup_coordinates(
                latitude=request.latitude,
                longitude=request.longitude,
            )
            input_mode = "coordinates"
    except RepresentativeLookupNotFound as exc:
        raise problem_exception(
            404, "Not Found", str(exc), type_slug="representative-lookup-not-found"
        ) from None
    except (RepresentativeLookupUpstreamError, requests.RequestException) as exc:
        raise problem_exception(
            502,
            "Bad Gateway",
            f"Representative lookup upstream failed: {exc}",
            type_slug="representative-lookup-upstream-error",
        ) from None

    house_district = district_for_match(db, lookup_result.house_district)
    senate_district = district_for_match(db, lookup_result.senate_district)
    district_ids = [
        district.id
        for district in [house_district, senate_district]
        if district is not None
    ]
    if not district_ids:
        raise problem_exception(
            404,
            "Not Found",
            "resolved districts are not available in the database",
            type_slug="representative-districts-not-found",
        )

    periods = db.scalars(
        find_my_legislator_stmt(current_session.id, district_ids)
    ).all()
    house_period = next(
        (
            period
            for period in periods
            if period.chamber.chamber_type == ChamberType.house
        ),
        None,
    )
    senate_period = next(
        (
            period
            for period in periods
            if period.chamber.chamber_type == ChamberType.senate
        ),
        None,
    )
    if house_period is None and senate_period is None:
        raise problem_exception(
            404,
            "Not Found",
            "no current legislators found for resolved districts",
            type_slug="representative-legislators-not-found",
        )

    rep_counts = authored_bill_counts(
        db,
        [
            period.legislator.id
            for period in (house_period, senate_period)
            if period is not None
        ],
    )
    geocoded = lookup_result.geocoded_address
    payload = {
        "resolved_place": {
            "input_mode": input_mode,
            "address_text": request.address_text,
            "matched_address": geocoded.matched_address,
            "latitude": geocoded.latitude,
            "longitude": geocoded.longitude,
            "state_code": geocoded.state_code,
            "house_district": house_district.code if house_district else None,
            "senate_district": senate_district.code if senate_district else None,
        },
        "house_legislator": legislator_list_item(
            house_period.legislator,
            total_bill_count=rep_counts.get(str(house_period.legislator.id), (0, 0))[0],
            chief_bill_count=rep_counts.get(str(house_period.legislator.id), (0, 0))[1],
        ).model_dump(exclude_none=True)
        if house_period
        else None,
        "senate_legislator": legislator_list_item(
            senate_period.legislator,
            total_bill_count=rep_counts.get(str(senate_period.legislator.id), (0, 0))[
                0
            ],
            chief_bill_count=rep_counts.get(str(senate_period.legislator.id), (0, 0))[
                1
            ],
        ).model_dump(exclude_none=True)
        if senate_period
        else None,
    }
    return DetailResponse(data=payload)


@router.get("/search", response_model=DetailResponse)
def search(
    q: str,
    types: str = "bills,legislators",
    session: str | None = None,
    limit: int = Query(default=5, le=20),
    db: Session = Depends(get_db),
):
    type_set = {item.strip() for item in types.split(",")}
    session_row = get_session_by_slug(db, session)
    payload: dict[str, list[dict]] = {"bills": [], "legislators": []}
    if "bills" in type_set:
        bills_stmt = bill_list_stmt(session_row.id).where(
            or_(Bill.title.ilike(f"%{q}%"), Bill.description.ilike(f"%{q}%"))
        )
        payload["bills"] = [
            bill_list_item(row).model_dump(exclude_none=True)
            for row in db.scalars(bills_stmt.limit(limit)).all()
        ]
    if "legislators" in type_set:
        legislators_stmt = legislator_directory_stmt(session_row.id).where(
            Legislator.full_name.ilike(f"%{q}%")
        )
        legislator_rows = db.scalars(legislators_stmt.limit(limit)).all()
        counts = authored_bill_counts(db, [row.id for row in legislator_rows])
        payload["legislators"] = [
            legislator_list_item(
                row,
                total_bill_count=counts.get(str(row.id), (0, 0))[0],
                chief_bill_count=counts.get(str(row.id), (0, 0))[1],
            ).model_dump(exclude_none=True)
            for row in legislator_rows
        ]
    return DetailResponse(data=payload)
