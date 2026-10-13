"""Private TV record delivery and review; authorization precedes every response."""

from __future__ import annotations

from uuid import UUID
import re

from fastapi import APIRouter, Depends, Header, HTTPException, Query, Request, Response
from sqlalchemy import func, or_, select
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

from alethical.api import tv_ad_schemas as response
from alethical.api.auth import (
    get_auth_service,
    get_current_user,
    get_optional_current_user,
)
from alethical.api.problems import problem_exception
from alethical.api.routers.admin import administrator_access
from alethical.api.services import tv_ads as reader
from alethical.api.services import tv_ad_review as review
from alethical.db import models as m
from alethical.db.session import get_db
from alethical.pipeline.fcc_document_text import EXTRACTOR_VERSION


def tv_administrator(
    request: Request,
    authorization: str | None = Header(default=None),
    auth_service=Depends(get_auth_service),
    db: Session = Depends(get_db),
):
    try:
        allowed = administrator_access(authorization, auth_service, db)
    except HTTPException:
        raise problem_exception(404, "Not Found", "Not found.") from None
    if not allowed:
        raise problem_exception(404, "Not Found", "Not found.")
    # The access check authenticates and confirms this subject against fresh account records.
    assert authorization is not None
    principal = auth_service.authenticate(authorization[7:])
    if request.method not in {"GET", "HEAD", "OPTIONS"}:
        # Use the normal account provisioning path so every saved reviewer has
        # a deletion mapping. Lock it until the review transaction commits:
        # deletion either follows this write and anonymizes it, or wins first.
        user = get_current_user(
            request,
            get_optional_current_user(request, authorization, db, auth_service),
        )
        identity = db.scalar(
            select(m.AuthIdentity)
            .join(m.UserAccount, m.UserAccount.id == m.AuthIdentity.user_id)
            .where(
                m.AuthIdentity.provider == "supabase",
                m.AuthIdentity.provider_subject == principal.provider_subject,
                m.UserAccount.id == user.id,
                m.UserAccount.is_active.is_(True),
            )
            .with_for_update(read=True, key_share=True)
        )
        if identity is None:
            raise problem_exception(404, "Not Found", "Not found.")
    return principal.provider_subject


def tv_database(db: Session = Depends(get_db)):
    try:
        yield db
    except LookupError:
        db.rollback()
        raise problem_exception(404, "Not Found", "Not found.") from None
    except ValueError:
        db.rollback()
        raise problem_exception(
            422,
            "Review unavailable",
            "The record could not be saved. Check the evidence and reload the prepared copy.",
        ) from None
    except SQLAlchemyError:
        db.rollback()
        raise problem_exception(
            503,
            "Records unavailable",
            "Records are temporarily unavailable. Try again.",
        ) from None


router = APIRouter(dependencies=[Depends(tv_administrator)])


@router.get(
    "/ads/access", response_model=response.Access, response_model_exclude_unset=True
)
def access():
    return {"allowed": True}


@router.get(
    "/ads/counts", response_model=response.Counts, response_model_exclude_unset=True
)
def counts(station: str | None = None, db: Session = Depends(tv_database)):
    facility = next(
        (
            s.facility_id
            for s in reader.DEFAULT_STATIONS
            if station in (s.call_sign, s.slug, s.facility_id)
        ),
        None,
    )
    if station and facility is None:
        raise LookupError()
    return reader.counts(db, facility)


@router.get(
    "/ads/sources", response_model=response.Sources, response_model_exclude_unset=True
)
def sources(
    station: str | None = None,
    stations: str | None = Query(None, max_length=100),
    db: Session = Depends(tv_database),
):
    result = reader.sources(db, station)
    if stations is not None:
        requested = set(stations.split(","))
        if requested - {s.call_sign for s in reader.DEFAULT_STATIONS}:
            raise ValueError()
        result["stations"] = [
            s for s in result["stations"] if s["call_sign"] in requested
        ]
    return result


@router.get(
    "/ads/recent", response_model=response.Recent, response_model_exclude_unset=True
)
def recent(db: Session = Depends(tv_database)):
    return reader.recent(db, include_archive=True)


@router.get(
    "/ads/browse", response_model=response.Browse, response_model_exclude_unset=True
)
def browse(
    tab: str = "folders",
    q: str = Query("", max_length=200),
    station: str = "",
    year: int | None = Query(None, ge=1900, le=2200),
    category: str = Query("", max_length=200),
    page: int = Query(1, ge=1, le=42),
    db: Session = Depends(tv_database),
):
    return reader.browse(
        db,
        tab=tab,
        q=q,
        station=station,
        year=year,
        category=category,
        page=page,
        include_archive=True,
    )


@router.get(
    "/ads/connections",
    response_model=response.Connected,
    response_model_exclude_unset=True,
)
def connections(
    kind: str, target: str = Query(max_length=200), db: Session = Depends(tv_database)
):
    if kind not in {"committee", "candidate", "principal", "election", "race", "name"}:
        raise ValueError()
    return reader.connected(db, kind, target)


@router.get(
    "/ads/files/{key}",
    response_model=response.FileDetail | response.WithdrawnFile,
    response_model_exclude_unset=True,
)
def file_detail(
    key: str,
    version: str | None = Query(None, pattern=r"^[a-f0-9]{64}$"),
    copy: UUID | None = None,
    db: Session = Depends(tv_database),
):
    return reader.file_detail(db, key, version, copy, include_archive=True)


@router.get("/ads/files/{key}/source-pages/{page}")
def source_image(
    key: str,
    page: int,
    version: str = Query(pattern=r"^[a-f0-9]{64}$"),
    db: Session = Depends(tv_database),
):
    facility, file_id = reader.identity(key)
    return Response(
        review.render_original_page(db, facility, file_id, version, page),
        media_type="image/png",
        headers={"Cache-Control": "private, no-store"},
    )


@router.get("/ads/files/{key}/pages/{page}")
def image(
    key: str,
    page: int,
    version: str = Query(pattern=r"^[a-f0-9]{64}$"),
    copy: UUID = Query(),
    db: Session = Depends(tv_database),
):
    publication = reader.approved_media(db, key, version, copy)
    if publication.status == "withdrawn":
        raise problem_exception(410, "Gone", "This copy is no longer available.")
    return Response(
        review.read_artifact(publication, None, page=page),
        media_type="image/png",
        headers={"Cache-Control": "private, no-store"},
    )


@router.get(
    "/ads/folders/{key}",
    response_model=response.Folder,
    response_model_exclude_unset=True,
)
def folder(key: str, db: Session = Depends(tv_database)):
    return reader.folder_detail(db, key, include_archive=True)


@router.get(
    "/ads/agencies/{key}",
    response_model=response.Agency,
    response_model_exclude_unset=True,
)
def agency(key: str, db: Session = Depends(tv_database)):
    return reader.agency_detail(db, key, include_archive=True)


@router.get(
    "/ads/stations/{key}",
    response_model=response.Station,
    response_model_exclude_unset=True,
)
def station(key: str, db: Session = Depends(tv_database)):
    return reader.station_detail(db, key, include_archive=True)


ADMIN = "/admin/political-ads"


def _version(db, facility_id, file_id, content_hash):
    if facility_id not in reader.STATIONS:
        raise LookupError()
    doc = db.get(m.FCCDocument, (facility_id, file_id, content_hash))
    if doc is None:
        raise LookupError()
    return doc


def _private_doc(doc):
    return {
        key: reader.iso(getattr(doc, key))
        for key in (
            "facility_id",
            "file_id",
            "content_hash",
            "name",
            "call_sign",
            "folder_id",
            "folder_path",
            "uploaded_at",
        )
    } | {"first_saved_at": reader.iso(doc.first_seen_at)}


@router.get(ADMIN + "/queue")
def queue(
    station: str = "",
    q: str = Query("", max_length=200),
    page: int = Query(1, ge=1, le=10000),
    db: Session = Depends(tv_database),
):
    query = reader._documents(db)
    if station:
        query = query.where(m.FCCDocument.call_sign == station)
    if q:
        query = query.where(
            or_(
                m.FCCDocument.name.icontains(q, autoescape=True),
                m.FCCDocument.file_id == q,
            )
        )
    total = db.scalar(select(func.count()).select_from(query.subquery()))
    docs = db.scalars(
        query.order_by(
            m.FCCDocument.first_seen_at.desc(),
            m.FCCDocument.facility_id,
            m.FCCDocument.file_id,
            m.FCCDocument.content_hash,
        )
        .offset((page - 1) * 25)
        .limit(25)
    )
    rows = []
    for doc in docs:
        copy = db.scalar(
            select(m.TVAdPublication)
            .where(
                m.TVAdPublication.facility_id == doc.facility_id,
                m.TVAdPublication.file_id == doc.file_id,
                m.TVAdPublication.content_hash == doc.content_hash,
            )
            .order_by(m.TVAdPublication.created_at.desc())
            .limit(1)
        )
        page_count = db.scalar(
            select(func.count())
            .select_from(m.FCCPage)
            .where(
                m.FCCPage.content_hash == doc.content_hash,
                m.FCCPage.version == EXTRACTOR_VERSION,
            )
        )
        rows.append(
            {
                **_private_doc(doc),
                "page_count": page_count,
                "status": copy.status if copy else "unprepared",
                "copy_id": str(copy.id) if copy else None,
            }
        )
    return {"rows": rows, "total": total, "page": page, "page_size": 25}


@router.get(ADMIN + "/files/{facility_id}/{file_id}/versions/{content_hash}")
def review_version(
    facility_id: str,
    file_id: str,
    content_hash: str,
    db: Session = Depends(tv_database),
):
    doc = _version(db, facility_id, file_id, content_hash)
    pages = list(
        db.scalars(
            select(m.FCCPage)
            .where(
                m.FCCPage.content_hash == content_hash,
                m.FCCPage.version == EXTRACTOR_VERSION,
            )
            .order_by(m.FCCPage.page)
        )
    )
    extraction = db.get(m.FCCExtraction, (content_hash, EXTRACTOR_VERSION))
    copies = list(
        db.scalars(
            select(m.TVAdPublication)
            .where(
                m.TVAdPublication.facility_id == facility_id,
                m.TVAdPublication.file_id == file_id,
                m.TVAdPublication.content_hash == content_hash,
            )
            .order_by(m.TVAdPublication.created_at.desc())
        )
    )
    return {
        "document": {
            **_private_doc(doc),
            "extraction_version": EXTRACTOR_VERSION,
            **_document_folder_evidence(db, doc),
        },
        "pages": [
            {"page": p.page, "text": p.text, "text_status": p.status} for p in pages
        ],
        "draft_facts": extraction.facts if extraction else [],
        "page_count": len(pages),
        "copies": [
            {
                "id": str(p.id),
                "status": p.status,
                "created_at": reader.iso(p.created_at),
            }
            for p in copies
        ],
    }


@router.get(
    ADMIN + "/files/{facility_id}/{file_id}/versions/{content_hash}/pages/{page}"
)
def original_page(
    facility_id: str,
    file_id: str,
    content_hash: str,
    page: int,
    db: Session = Depends(tv_database),
):
    _version(db, facility_id, file_id, content_hash)
    return Response(
        review.render_original_page(db, facility_id, file_id, content_hash, page),
        media_type="image/png",
    )


@router.post(ADMIN + "/copies")
def prepare(
    payload: dict, actor=Depends(tv_administrator), db: Session = Depends(tv_database)
):
    row = review.prepare_copy(db, actor, payload)
    db.commit()
    return review.review_payload(db, row.id)


@router.get(ADMIN + "/copies/{copy_id}/review")
def copy_review(copy_id: UUID, db: Session = Depends(tv_database)):
    return review.review_payload(db, copy_id)


@router.get(ADMIN + "/copies/{copy_id}/pages/{page}")
def prepared_page(copy_id: UUID, page: int, db: Session = Depends(tv_database)):
    publication = db.get(m.TVAdPublication, copy_id)
    if publication is None:
        raise LookupError()
    return Response(
        review.read_artifact(publication, None, page=page), media_type="image/png"
    )


@router.post(ADMIN + "/copies/{copy_id}/approve")
def approve(
    copy_id: UUID,
    payload: dict,
    actor=Depends(tv_administrator),
    db: Session = Depends(tv_database),
):
    review.approve_copy(db, copy_id, actor, payload)
    db.commit()
    return review.review_payload(db, copy_id)


@router.post(ADMIN + "/copies/{copy_id}/withdraw")
def withdraw(
    copy_id: UUID,
    payload: dict,
    actor=Depends(tv_administrator),
    db: Session = Depends(tv_database),
):
    review.withdraw_copy(db, copy_id, actor, payload.get("evidence", ""))
    db.commit()
    return review.review_payload(db, copy_id)


@router.post(ADMIN + "/copies/{copy_id}/facts")
def fact(
    copy_id: UUID,
    payload: dict,
    actor=Depends(tv_administrator),
    db: Session = Depends(tv_database),
):
    row = review.add_fact(db, copy_id, actor, payload)
    db.commit()
    return {"id": str(row.id), "status": row.status}


@router.post(ADMIN + "/copies/{copy_id}/connections")
def connection(
    copy_id: UUID,
    payload: dict,
    actor=Depends(tv_administrator),
    db: Session = Depends(tv_database),
):
    row = review.add_connection(db, actor, {**payload, "publication_id": str(copy_id)})
    db.commit()
    return {"id": str(row.id), "status": row.status}


@router.post(ADMIN + "/facts/{fact_id}/withdraw")
def withdraw_fact(
    fact_id: UUID,
    payload: dict,
    actor=Depends(tv_administrator),
    db: Session = Depends(tv_database),
):
    row = review.withdraw_fact(db, fact_id, actor, payload.get("evidence", ""))
    db.commit()
    return {"id": str(row.id), "status": row.status}


@router.post(ADMIN + "/connections/{connection_id}/withdraw")
def withdraw_connection(
    connection_id: UUID,
    payload: dict,
    actor=Depends(tv_administrator),
    db: Session = Depends(tv_database),
):
    row = review.withdraw_connection(
        db, connection_id, actor, payload.get("evidence", "")
    )
    db.commit()
    return {"id": str(row.id), "status": row.status}


@router.get(ADMIN + "/targets/{kind}/{target_id:path}")
def target_preview(
    kind: str,
    target_id: str,
    publication_id: UUID | None = None,
    election_stage: str | None = None,
    money_office: str | None = Query(None, max_length=60),
    money_district: str | None = Query(None, max_length=60),
    role: str | None = Query(None, max_length=500),
    db: Session = Depends(tv_database),
):
    return review.target_preview(
        db,
        kind,
        target_id,
        publication_id,
        election_stage=election_stage,
        money_office=money_office,
        money_district=money_district,
        role=role,
    )


@router.post(ADMIN + "/copies/{copy_id}/approve-metadata")
def approve_metadata(
    copy_id: UUID,
    payload: dict,
    actor=Depends(tv_administrator),
    db: Session = Depends(tv_database),
):
    review.approve_metadata(db, copy_id, actor, payload)
    db.commit()
    return review.review_payload(db, copy_id)


@router.get(
    "/ads/expenses/{connection_id}",
    response_model=response.Expense,
    response_model_exclude_unset=True,
)
def expense(connection_id: UUID, db: Session = Depends(tv_database)):
    return reader.expense_detail(db, connection_id)


def _folder_row(ob):
    path = ob.details.get("path", "")
    match = re.search(r"(?:^|/)(19\d{2}|20\d{2})(?:/|$)", path)
    return {
        "facility_id": ob.facility_id,
        "folder_id": ob.url.rstrip("/").rsplit("/", 1)[-1],
        "content_hash": ob.content_hash,
        "source_url": ob.url,
        "stored_at": reader.iso(ob.observed_at),
        "label": path.rsplit("/", 1)[-1] or "Political files",
        "path": path,
        "year": int(match[1]) if match else None,
        "category": None,
    }


def _document_folder_evidence(db, doc):
    observations = db.scalars(
        select(m.FCCObservation)
        .where(
            m.FCCObservation.facility_id == doc.facility_id,
            m.FCCObservation.kind == "folder",
            m.FCCObservation.status == "stored",
        )
        .order_by(m.FCCObservation.observed_at.desc())
    )
    ob = next(
        (
            ob
            for ob in observations
            if ob.url.rstrip("/").rsplit("/", 1)[-1] == doc.folder_id
        ),
        None,
    )
    if ob is None:
        return {"folder_content_hash": None, "folder_evidence": None}
    evidence = review.folder_evidence(
        db, doc.facility_id, doc.folder_id, ob.content_hash
    )
    return {
        "folder_content_hash": ob.content_hash,
        "folder_evidence": {"content_hash": ob.content_hash, **evidence},
    }


@router.get(ADMIN + "/folders")
def folder_queue(
    station: str = "",
    q: str = Query("", max_length=200),
    page: int = Query(1, ge=1, le=10000),
    db: Session = Depends(tv_database),
):
    query = select(m.FCCObservation).where(
        m.FCCObservation.facility_id.in_(reader.STATIONS),
        m.FCCObservation.kind == "folder",
        m.FCCObservation.status == "stored",
        m.FCCObservation.content_hash.is_not(None),
    )
    if station:
        facility = next(
            (
                s.facility_id
                for s in reader.DEFAULT_STATIONS
                if station in (s.facility_id, s.call_sign, s.slug)
            ),
            None,
        )
        if facility is None:
            raise ValueError()
        query = query.where(m.FCCObservation.facility_id == facility)
    if q:
        query = query.where(
            m.FCCObservation.details["path"].astext.icontains(q, autoescape=True)
        )
    observations = db.scalars(
        query.order_by(m.FCCObservation.observed_at.desc(), m.FCCObservation.url)
    )
    rows = {}
    for ob in observations:
        row = _folder_row(ob)
        rows.setdefault(
            (row["facility_id"], row["folder_id"], row["content_hash"]), row
        )
    values = list(rows.values())
    return {
        "rows": values[(page - 1) * 25 : page * 25],
        "total": len(values),
        "page": page,
        "page_size": 25,
    }


@router.get(ADMIN + "/folders/{facility_id}/{folder_id}/{content_hash}")
def folder_evidence(
    facility_id: str,
    folder_id: str,
    content_hash: str,
    db: Session = Depends(tv_database),
):
    observations = review._folder_observations(db, facility_id, folder_id, content_hash)
    approvals = db.scalars(
        select(m.TVAdFolderApproval.id)
        .where(
            m.TVAdFolderApproval.facility_id == facility_id,
            m.TVAdFolderApproval.folder_id == folder_id,
            m.TVAdFolderApproval.content_hash == content_hash,
        )
        .order_by(m.TVAdFolderApproval.created_at.desc())
    )
    return {
        **_folder_row(observations[0]),
        **review.folder_evidence(db, facility_id, folder_id, content_hash),
        "approvals": [review.folder_review_payload(db, id) for id in approvals],
    }


@router.post(ADMIN + "/folders")
def prepare_folder(
    payload: dict, actor=Depends(tv_administrator), db: Session = Depends(tv_database)
):
    row = review.prepare_folder(db, actor, payload)
    db.commit()
    return review.folder_review_payload(db, row.id)


@router.post(ADMIN + "/folders/{folder_id}/approve")
def approve_folder(
    folder_id: UUID,
    payload: dict,
    actor=Depends(tv_administrator),
    db: Session = Depends(tv_database),
):
    review.approve_folder(db, folder_id, actor, payload)
    db.commit()
    return review.folder_review_payload(db, folder_id)


@router.post(ADMIN + "/folders/{folder_id}/withdraw")
def withdraw_folder(
    folder_id: UUID,
    payload: dict,
    actor=Depends(tv_administrator),
    db: Session = Depends(tv_database),
):
    review.withdraw_folder(db, folder_id, actor, payload.get("evidence", ""))
    db.commit()
    return review.folder_review_payload(db, folder_id)


@router.post(ADMIN + "/connections")
def folder_connection(
    payload: dict, actor=Depends(tv_administrator), db: Session = Depends(tv_database)
):
    if payload.get("scope") != "folder":
        raise ValueError()
    row = review.add_connection(db, actor, payload)
    db.commit()
    return {"id": str(row.id), "status": row.status}
