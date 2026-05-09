from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import or_, select
from sqlalchemy.orm import Session, selectinload

from alethical.api.auth import get_optional_current_user
from alethical.api.schemas import CollectionResponse, DetailResponse, MetaPayload, RepresentativeLookupRequest
from alethical.api.serializers import (
    bill_list_item,
    current_service_payload,
    district_payload,
    legislator_list_item,
    sponsor_payloads,
    tracking_payload,
)
from alethical.db.schema import load_schema
from alethical.db.session import get_db

schema = load_schema()
AIEnrichment = schema.AIEnrichment
Bill = schema.Bill
BillAction = schema.BillAction
BillVersion = schema.BillVersion
BillVersionSection = schema.BillVersionSection
ChamberType = schema.ChamberType
District = schema.District
Jurisdiction = schema.Jurisdiction
LegislativeSession = schema.LegislativeSession
Legislator = schema.Legislator
Sponsorship = schema.Sponsorship
bill_detail_stmt = schema.bill_detail_stmt
bill_list_stmt = schema.bill_list_stmt
find_my_legislator_stmt = schema.find_my_legislator_stmt
legislator_directory_stmt = schema.legislator_directory_stmt
legislator_profile_stmt = schema.legislator_profile_stmt
legislator_sponsored_bills_stmt = schema.legislator_sponsored_bills_stmt

router = APIRouter()


def get_session_by_slug(db: Session, slug: str | None):
    if slug:
        session_row = db.scalar(select(LegislativeSession).where(LegislativeSession.slug == slug))
    else:
        session_row = db.scalar(select(LegislativeSession).where(LegislativeSession.is_current.is_(True)))
    if session_row is None:
        raise HTTPException(status_code=404, detail="session not found")
    return session_row


def get_bill_by_key(db: Session, bill_key: str):
    bill = db.scalar(select(Bill).where(Bill.bill_key == bill_key))
    if bill is None:
        raise HTTPException(status_code=404, detail="bill not found")
    return bill


def get_legislator_by_id(db: Session, legislator_id: str):
    legislator = db.scalar(select(Legislator).where(Legislator.id == legislator_id))
    if legislator is None:
        raise HTTPException(status_code=404, detail="legislator not found")
    return legislator


@router.get("/meta", response_model=DetailResponse)
def meta(db: Session = Depends(get_db)):
    jurisdiction = db.scalar(select(Jurisdiction).where(Jurisdiction.slug == "minnesota"))
    current_session = db.scalar(select(LegislativeSession).where(LegislativeSession.is_current.is_(True)))
    payload = MetaPayload(
        api_version="v1",
        jurisdiction={"slug": jurisdiction.slug, "name": jurisdiction.name},
        current_session={
            "slug": current_session.slug,
            "name": current_session.name,
            "is_current": current_session.is_current,
        },
    )
    return DetailResponse(data=payload, links={"self": "/api/v1/meta"})


@router.get("/sessions", response_model=CollectionResponse)
def sessions(db: Session = Depends(get_db)):
    rows = db.scalars(select(LegislativeSession).order_by(LegislativeSession.year_start.desc())).all()
    data = [{"slug": row.slug, "name": row.name, "is_current": row.is_current} for row in rows]
    return CollectionResponse(data=data, page={"limit": len(data), "next_cursor": None, "has_more": False})


@router.get("/sessions/current", response_model=DetailResponse)
def current_session(db: Session = Depends(get_db)):
    row = db.scalar(select(LegislativeSession).where(LegislativeSession.is_current.is_(True)))
    return DetailResponse(data={"slug": row.slug, "name": row.name, "is_current": row.is_current})


@router.get("/bills", response_model=CollectionResponse)
def bills(
    session: str | None = None,
    q: str | None = None,
    include: str | None = None,
    limit: int = Query(default=20, le=100),
    db: Session = Depends(get_db),
    current_user=Depends(get_optional_current_user),
):
    session_row = get_session_by_slug(db, session)
    include_set = {item.strip() for item in include.split(",")} if include else set()
    stmt = bill_list_stmt(
        session_row.id,
        user_id=current_user.id if current_user and "tracking" in include_set else None,
    )
    if q:
        stmt = stmt.where(or_(Bill.title.ilike(f"%{q}%"), Bill.description.ilike(f"%{q}%")))
    rows = db.scalars(stmt.limit(limit)).all()
    data = [bill_list_item(row, include_tracking="tracking" in include_set and current_user is not None) for row in rows]
    return CollectionResponse(
        data=[item.model_dump(exclude_none=True) for item in data],
        page={"limit": limit, "next_cursor": None, "has_more": False},
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
            user_id=current_user.id if current_user and "tracking" in include_set else None,
        )
    )
    ai_summary = None
    if "ai_summary" in include_set:
        enrichment = next((item for item in row.enrichments if item.enrichment_type.value == "bill_summary"), None)
        ai_summary = enrichment.content_json if enrichment else None
    payload = {
        "id": row.bill_key,
        "title": row.title,
        "description": row.description,
        "current_status": row.current_status,
        "latest_action_at": row.latest_action_at,
        "official_url": row.official_url,
        "chief_sponsors": [item.model_dump() for item in sponsor_payloads(row.chief_sponsorships)],
        "tracking": tracking_payload(row.tracked_by).model_dump() if "tracking" in include_set and current_user else None,
        "ai_summary": ai_summary,
    }
    if "all_sponsors" in include_set:
        payload["all_sponsors"] = [item.model_dump() for item in sponsor_payloads(row.sponsorships)]
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
    return DetailResponse(data={key: value for key, value in payload.items() if value is not None})


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
    return CollectionResponse(data=data, page={"limit": len(data), "next_cursor": None, "has_more": False})


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
    return CollectionResponse(data=data, page={"limit": len(data), "next_cursor": None, "has_more": False})


@router.get("/bills/{bill_id}/versions/{version_code}", response_model=DetailResponse)
def bill_version_detail(bill_id: str, version_code: str, db: Session = Depends(get_db)):
    bill_row = get_bill_by_key(db, bill_id)
    version = db.scalar(
        select(BillVersion).where(BillVersion.bill_id == bill_row.id, BillVersion.version_code == version_code)
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


@router.get("/bills/{bill_id}/versions/{version_code}/text", response_model=DetailResponse)
def bill_version_text(
    bill_id: str,
    version_code: str,
    format: str = "structured",
    db: Session = Depends(get_db),
):
    bill_row = get_bill_by_key(db, bill_id)
    version = db.scalar(
        select(BillVersion).where(BillVersion.bill_id == bill_row.id, BillVersion.version_code == version_code)
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
    return CollectionResponse(data=data, page={"limit": len(data), "next_cursor": None, "has_more": False})


@router.get("/legislators", response_model=CollectionResponse)
def legislators(
    session: str | None = None,
    q: str | None = None,
    limit: int = Query(default=20, le=100),
    db: Session = Depends(get_db),
):
    session_row = get_session_by_slug(db, session)
    stmt = legislator_directory_stmt(session_row.id)
    if q:
        stmt = stmt.where(Legislator.full_name.ilike(f"%{q}%"))
    rows = db.scalars(stmt.limit(limit)).all()
    data = [legislator_list_item(row).model_dump(exclude_none=True) for row in rows]
    return CollectionResponse(
        data=data,
        page={"limit": limit, "next_cursor": None, "has_more": False},
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
        payload["current_service"] = current_service_payload(current_service).model_dump() if current_service else None
    if "stats" in include_set:
        stats = row.stats[0] if row.stats else None
        if stats:
            payload["stats"] = {
                "chief_bill_count": stats.chief_bill_count,
                "total_bill_count": stats.total_bill_count,
                "vote_record_count": stats.vote_record_count,
                "committee_count": stats.committee_count,
            }
    if "committees" in include_set:
        payload["committees"] = [
            {"name": membership.committee.name, "role": membership.role}
            for membership in row.committee_memberships
        ]
    return DetailResponse(data={key: value for key, value in payload.items() if value is not None})


@router.get("/legislators/{legislator_id}/bills", response_model=CollectionResponse)
def legislator_bills(
    legislator_id: str,
    session: str | None = None,
    limit: int = Query(default=20, le=100),
    db: Session = Depends(get_db),
):
    session_row = get_session_by_slug(db, session)
    legislator = get_legislator_by_id(db, legislator_id)
    rows = db.scalars(legislator_sponsored_bills_stmt(legislator.id, session_row.id).limit(limit)).all()
    data = [bill_list_item(row).model_dump(exclude_none=True) for row in rows]
    return CollectionResponse(data=data, page={"limit": limit, "next_cursor": None, "has_more": False})


@router.get("/legislators/{legislator_id}/votes", response_model=CollectionResponse)
def legislator_votes(
    legislator_id: str,
    session: str | None = None,
    limit: int = Query(default=20, le=100),
    db: Session = Depends(get_db),
):
    session_row = get_session_by_slug(db, session)
    rows = db.scalars(schema.legislator_vote_history_stmt(legislator_id, session_row.id).limit(limit)).all()
    data = [
        {
            "id": str(row.id),
            "vote_value": row.vote_value.value,
            "vote_event_id": str(row.vote_event_id),
        }
        for row in rows
    ]
    return CollectionResponse(data=data, page={"limit": limit, "next_cursor": None, "has_more": False})


@router.get("/districts", response_model=CollectionResponse)
def districts(limit: int = Query(default=50, le=200), db: Session = Depends(get_db)):
    rows = db.scalars(select(District).order_by(District.code.asc()).limit(limit)).all()
    data = [district_payload(row).model_dump() for row in rows]
    return CollectionResponse(data=data, page={"limit": limit, "next_cursor": None, "has_more": False})


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
    data = [legislator_list_item(row.legislator).model_dump(exclude_none=True) for row in rows]
    return CollectionResponse(data=data, page={"limit": len(data), "next_cursor": None, "has_more": False})


@router.post("/representative-lookups", response_model=DetailResponse)
def representative_lookup(request: RepresentativeLookupRequest, db: Session = Depends(get_db)):
    current_session = get_session_by_slug(db, None)
    normalized = request.address_text.lower()
    house_district = db.scalar(select(District).where(District.code == "64B"))
    senate_district = db.scalar(select(District).where(District.code == "64"))
    district_ids = [
        district.id
        for district in [house_district, senate_district]
        if district is not None
    ]
    if "saint paul" not in normalized or not district_ids:
        district_ids = db.scalars(
            select(District.id).limit(2)
        ).all()
    periods = db.scalars(find_my_legislator_stmt(current_session.id, district_ids)).all()
    house_period = next((period for period in periods if period.chamber.chamber_type == ChamberType.house), None)
    senate_period = next((period for period in periods if period.chamber.chamber_type == ChamberType.senate), None)
    payload = {
        "resolved_place": {
            "address_text": request.address_text,
            "state_code": "MN",
        },
        "house_legislator": legislator_list_item(house_period.legislator).model_dump(exclude_none=True) if house_period else None,
        "senate_legislator": legislator_list_item(senate_period.legislator).model_dump(exclude_none=True) if senate_period else None,
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
        legislators_stmt = legislator_directory_stmt(session_row.id).where(Legislator.full_name.ilike(f"%{q}%"))
        payload["legislators"] = [
            legislator_list_item(row).model_dump(exclude_none=True)
            for row in db.scalars(legislators_stmt.limit(limit)).all()
        ]
    return DetailResponse(data=payload)
