from __future__ import annotations

import re

from typing import Literal
from uuid import UUID

import requests

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import and_, case, func, or_, select
from sqlalchemy.orm import Session, aliased, selectinload

from alethical.api.auth import get_optional_current_user
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


def paginated_scalars(db: Session, stmt, *, limit: int, offset: int):
    if limit == 0:
        return [], False
    rows = db.scalars(stmt.offset(offset).limit(limit + 1)).all()
    return rows[:limit], len(rows) > limit


def authored_bill_counts(db: Session, legislator_ids) -> dict[str, tuple[int, int]]:
    """Live authored-bill counts (total, chief) for the given directory rows,
    computed set-wise from Sponsorship in one grouped query.

    Production keeps two Legislator rows per member: the roster row shown in the
    directory (external_key = the member profile URL, a real district) carries no
    sponsorships, while a separate bill-author row (external_key = the numeric
    member key, a "*-unknown" placeholder district excluded from the directory)
    carries every Sponsorship. The two are linked by the roster key *ending
    with* the author key -- the same relationship canonical_legislator_for_
    placeholder() resolves in the opposite direction. So reading Sponsorship on a
    directory row's own id (equivalently, its stored LegislatorStats) is always 0
    (#291). We instead join each requested row to its author row(s) via that
    suffix match and count their sponsorships; the self-match (author == roster)
    also covers any row that carries sponsorships on its own id. One grouped query
    for the whole page -- no per-row N+1. Returns
    {legislator_id: (total_bill_count, chief_bill_count)}."""
    ids = list(legislator_ids)
    if not ids:
        return {}
    author = aliased(Legislator)
    rows = db.execute(
        select(
            Legislator.id,
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
        .select_from(Legislator)
        .join(
            author,
            and_(
                author.jurisdiction_id == Legislator.jurisdiction_id,
                author.external_key.isnot(None),
                Legislator.external_key.ilike(func.concat("%", author.external_key)),
            ),
        )
        .join(Sponsorship, Sponsorship.legislator_id == author.id)
        .where(Legislator.id.in_(ids))
        .group_by(Legislator.id)
    ).all()
    return {str(row.id): (row.total, row.chief) for row in rows}


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


def canonical_legislator_for_placeholder(db: Session, legislator, session_id):
    current_service = next(iter(legislator.service_periods), None)
    if (
        current_service is None
        or not current_service.district.code.endswith("-unknown")
        or not legislator.external_key
    ):
        return legislator
    return (
        db.scalar(
            select(Legislator)
            .join(
                LegislatorServicePeriod,
                LegislatorServicePeriod.legislator_id == Legislator.id,
            )
            .join(District, District.id == LegislatorServicePeriod.district_id)
            .where(
                Legislator.id != legislator.id,
                Legislator.jurisdiction_id == legislator.jurisdiction_id,
                Legislator.external_key.ilike(f"%{legislator.external_key}"),
                LegislatorServicePeriod.session_id == session_id,
                LegislatorServicePeriod.is_current.is_(True),
                District.code.not_like("%-unknown"),
            )
            .options(
                selectinload(
                    Legislator.service_periods.and_(
                        LegislatorServicePeriod.session_id == session_id,
                        LegislatorServicePeriod.is_current.is_(True),
                    )
                ).selectinload(LegislatorServicePeriod.chamber),
                selectinload(
                    Legislator.service_periods.and_(
                        LegislatorServicePeriod.session_id == session_id,
                        LegislatorServicePeriod.is_current.is_(True),
                    )
                ).selectinload(LegislatorServicePeriod.district),
                selectinload(
                    Legislator.committee_memberships.and_(
                        schema.CommitteeMembership.is_current.is_(True)
                    )
                ).selectinload(schema.CommitteeMembership.committee),
                selectinload(
                    Legislator.stats.and_(
                        schema.LegislatorStats.session_id == session_id
                    )
                ),
            )
        )
        or legislator
    )


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
    area_rows = (
        select(
            func.jsonb_array_elements_text(
                AIEnrichment.content_json["policy_areas"]
            ).label("name")
        )
        .join(Bill, Bill.id == AIEnrichment.bill_id)
        .where(
            Bill.session_id == session_row.id,
            AIEnrichment.enrichment_type == EnrichmentType.bill_summary,
            AIEnrichment.is_current.is_(True),
        )
        .subquery()
    )
    rows = db.execute(
        select(area_rows.c.name, func.count().label("bill_count"))
        .where(func.btrim(area_rows.c.name) != "")
        .group_by(area_rows.c.name)
        .order_by(func.count().desc(), area_rows.c.name.asc())
        .limit(limit)
    ).all()
    data = [{"name": name, "bill_count": bill_count} for name, bill_count in rows]
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
    sort: Literal["latest_action", "progress"] = "latest_action",
    limit: int = Query(default=20, ge=0, le=100),
    offset: int = Query(default=0, ge=0),
    db: Session = Depends(get_db),
    current_user=Depends(get_optional_current_user),
):
    session_row = get_session_by_slug(db, session)
    include_set = {item.strip() for item in include.split(",")} if include else set()
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
        policy_area_value = policy_area.strip()
        # Exact array-element membership via the JSONB `?` operator (has_key), not
        # a substring match on the array cast to text. The prior
        # cast(...)::text ILIKE '%value%' scan was unindexable and took ~90s on
        # the production corpus — combined with sort=progress it exceeded the
        # gateway timeout (502) so the pill click never narrowed the list. `?`
        # runs in ~200ms and matches whole elements, so the filtered total now
        # agrees with the /policy-areas pill count (both key off exact elements).
        matching_policy_area_bills = select(AIEnrichment.bill_id).where(
            AIEnrichment.enrichment_type == EnrichmentType.bill_summary,
            AIEnrichment.is_current.is_(True),
            AIEnrichment.content_json["policy_areas"].has_key(policy_area_value),
        )
        stmt = stmt.where(Bill.id.in_(matching_policy_area_bills))
    if omnibus is not None:
        stmt = stmt.where(Bill.is_omnibus.is_(omnibus))
    total = db.scalar(select(func.count()).select_from(stmt.order_by(None).subquery()))
    rows, has_more = paginated_scalars(db, stmt, limit=limit, offset=offset)
    data = [
        bill_list_item(
            row, include_tracking="tracking" in include_set and current_user is not None
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


@router.get("/bills/{bill_id}", response_model=DetailResponse)
def bill_detail(
    bill_id: str,
    include: str | None = None,
    db: Session = Depends(get_db),
    current_user=Depends(get_optional_current_user),
):
    bill_row = get_bill_by_key(db, bill_id)
    include_set = {item.strip() for item in include.split(",")} if include else set()
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
        "chief_sponsors": [
            item.model_dump()
            for item in sponsor_payloads(
                row.chief_sponsorships, session_id=row.session_id
            )
        ],
        "tracking": tracking_payload(row.tracked_by).model_dump()
        if "tracking" in include_set and current_user
        else None,
        "ai_analysis": ai_analysis_payload_for_enrichment(ai_enrichment),
        "ai_summary": ai_enrichment.content_json if ai_enrichment else None,
    }
    if "all_sponsors" in include_set:
        payload["all_sponsors"] = [
            item.model_dump()
            for item in sponsor_payloads(row.sponsorships, session_id=row.session_id)
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
        payload["versions"] = [
            {
                "version_code": version.version_code,
                "version_name": version.version_name,
                "html_url": version.html_url,
                "pdf_url": version.pdf_url,
                "is_current": version.is_current,
            }
            for version in row.versions
        ]
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
    data = [
        {
            "version_code": version.version_code,
            "version_name": version.version_name,
            "html_url": version.html_url,
            "pdf_url": version.pdf_url,
            "is_current": version.is_current,
        }
        for version in row.versions
    ]
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
def bill_votes(bill_id: str, db: Session = Depends(get_db)):
    bill_row = get_bill_by_key(db, bill_id)
    row = db.scalar(bill_detail_stmt(bill_row.id))
    data = [
        {
            "id": str(vote_event.id),
            "motion_text": vote_event.motion_text,
            "result_text": vote_event.result_text,
            "yes_count": vote_event.yes_count,
            "no_count": vote_event.no_count,
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
    counts = authored_bill_counts(db, [row.id for row in rows])
    data = [
        legislator_list_item(
            row,
            total_bill_count=counts.get(str(row.id), (0, 0))[0],
            chief_bill_count=counts.get(str(row.id), (0, 0))[1],
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
    row = canonical_legislator_for_placeholder(db, row, session_row.id)
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
