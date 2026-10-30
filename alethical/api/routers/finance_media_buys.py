"""Alethical Finance's Media buys: TV station files, read and checked by every
Finance account.

Behind the Finance access check, through the same readers alethical.com's
administrators use, in their Finance reading
(``alethical/api/services/finance_media_buys.py``), and Finance's own checks on
original versions (``alethical/api/services/finance_station_checks.py``). Each
answer passes through its response model in
``alethical/api/finance_media_buys_schemas.py``, so only the fields named there
reach Finance: never alethical.com's public-copy steps, links or account
identifiers, nor whether a team account made a check.
"""

from __future__ import annotations

from typing import Literal
from uuid import UUID

from fastapi import APIRouter, Body, Depends, Path, Query, Response
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

from alethical.api import finance_media_buys_schemas as schema
from alethical.api.finance_access import require_finance_access
from alethical.api.problems import problem_exception
from alethical.api.services import finance_media_buys as media
from alethical.api.services import finance_station_checks as checks
from alethical.api.services import finance_station_queue as station_queue
from alethical.api.services import tv_ad_review as review
from alethical.api.services import tv_ads as reader
from alethical.api.services.finance_access import FinanceAccount
from alethical.db import models as m
from alethical.db.session import get_db

router = APIRouter(
    prefix="/finance/media-buys", dependencies=[Depends(require_finance_access)]
)

CONNECTION_KINDS = {"committee", "candidate", "principal", "election", "race", "name"}


def records(db: Session = Depends(get_db)):
    try:
        yield db
    except LookupError:
        db.rollback()
        raise problem_exception(404, "Not Found", "Not found.") from None
    except ValueError:
        db.rollback()
        raise problem_exception(
            422, "Unprocessable Entity", "That request does not name a held record."
        ) from None
    except SQLAlchemyError:
        db.rollback()
        raise problem_exception(
            503,
            "Records unavailable",
            "Records are temporarily unavailable. Try again.",
            type_slug="service-unavailable",
        ) from None


def checking(db: Session = Depends(get_db)):
    """A check's database session: a check that breaks a rule is refused whole,
    with that rule's fixed sentence as the detail, so a person can fix it."""
    try:
        yield db
    except LookupError:
        db.rollback()
        raise problem_exception(404, "Not Found", "Not found.") from None
    except checks.CorrectionRace:
        db.rollback()
        raise problem_exception(
            409,
            "Conflict",
            "This fact was corrected a moment ago. Reload and check.",
        ) from None
    except ValueError as refusal:
        db.rollback()
        raise problem_exception(422, "Check not saved", str(refusal)) from None
    except SQLAlchemyError:
        db.rollback()
        raise problem_exception(
            503,
            "Records unavailable",
            "Records are temporarily unavailable. Try again.",
            type_slug="service-unavailable",
        ) from None


VERSION = Path(pattern=r"^[a-f0-9]{64}$")


def saved(row) -> dict:
    return {
        "data": {
            "id": str(row.id),
            "status": "withdrawn" if row.withdrawn_at else "checked",
        }
    }


def answer(model):
    """The route's answer, with only the fields its model names."""
    return {
        "response_model": schema.FinanceAnswer[model],
        "response_model_exclude_unset": True,
    }


@router.get("/counts", **answer(schema.FinanceCounts))
def counts(db: Session = Depends(records)) -> dict:
    return {"data": media.counts(db)}


@router.get("/sources", **answer(schema.FinanceSources))
def sources(db: Session = Depends(records)) -> dict:
    return {"data": media.sources(db)}


@router.get("/recent", **answer(schema.FinanceRecent))
def recent(db: Session = Depends(records)) -> dict:
    return {"data": media.recent(db)}


@router.get("/browse", **answer(schema.FinanceBrowse))
def browse(
    tab: str = "folders",
    q: str = Query("", max_length=200),
    station: str = "",
    year: int | None = Query(None, ge=1900, le=2200),
    category: str = Query("", max_length=200),
    page: int = Query(1, ge=1, le=42),
    default_year: bool = False,
    db: Session = Depends(records),
) -> dict:
    return {
        "data": media.browse(
            db,
            tab=tab,
            q=q,
            station=station,
            year=year,
            category=category,
            page=page,
            default_year=default_year,
        )
    }


@router.get("/connections", **answer(schema.FinanceConnected))
def connections(
    kind: str, target: str = Query(max_length=200), db: Session = Depends(records)
) -> dict:
    if kind not in CONNECTION_KINDS:
        raise ValueError("Unsupported connection kind")
    return {"data": media.connected(db, kind, target)}


@router.get("/queue", **answer(schema.FinanceQueue))
def queue(
    q: str = Query("", max_length=200),
    station: str = Query("", max_length=40),
    sort: Literal["suggested", "newest"] = "suggested",
    limit: int = Query(50, ge=1, le=100),
    offset: int = Query(0, ge=0),
    db: Session = Depends(records),
) -> dict:
    return {
        "data": station_queue.queue(
            db, q=q, station=station, sort=sort, limit=limit, offset=offset
        )
    }


@router.get("/files/{key}/suggestions", **answer(schema.FinanceSuggestions))
def suggestions(
    key: str,
    version: str = Query(pattern=r"^[a-f0-9]{64}$"),
    db: Session = Depends(records),
) -> dict:
    return {"data": station_queue.suggestions(db, key, version)}


@router.get("/files/{key}", **answer(schema.FinanceFileDetail))
def file_detail(
    key: str,
    version: str | None = Query(None, pattern=r"^[a-f0-9]{64}$"),
    db: Session = Depends(records),
) -> dict:
    return {"data": media.file_detail(db, key, version)}


@router.get("/files/{key}/pages/{page}")
def page_image(
    key: str,
    page: int,
    version: str = Query(pattern=r"^[a-f0-9]{64}$"),
    db: Session = Depends(records),
) -> Response:
    """The original page as the station filed it, never a public copy."""
    facility, file_id = reader.identity(key)
    return Response(
        review.render_original_page(db, facility, file_id, version, page),
        media_type="image/png",
        headers={"Cache-Control": "private, no-store"},
    )


@router.get("/folders/{key}", **answer(schema.FinanceFolder))
def folder(key: str, db: Session = Depends(records)) -> dict:
    return {"data": media.folder(db, key)}


@router.get("/agencies/{key}", **answer(schema.FinanceAgency))
def agency(key: str, db: Session = Depends(records)) -> dict:
    return {"data": media.agency(db, key)}


@router.get("/stations/{key}", **answer(schema.FinanceStation))
def station(key: str, db: Session = Depends(records)) -> dict:
    return {"data": media.station(db, key)}


@router.get(
    "/files/{key}/versions/{version}/target-preview",
    **answer(schema.FinanceTargetPreview),
)
def target_preview(
    key: str,
    version: str = VERSION,
    kind: str = Query(max_length=40),
    target_id: str = Query(max_length=2000),
    election_stage: str | None = Query(None, max_length=40),
    money_office: str | None = Query(None, max_length=60),
    money_district: str | None = Query(None, max_length=60),
    role: str | None = Query(None, max_length=500),
    db: Session = Depends(checking),
) -> dict:
    return {
        "data": checks.target_preview(
            db,
            key,
            version,
            kind,
            target_id,
            election_stage=election_stage,
            money_office=money_office,
            money_district=money_district,
            role=role,
        )
    }


@router.post(
    "/files/{key}/versions/{version}/facts",
    status_code=201,
    **answer(schema.FinanceCheckSaved),
)
def add_fact(
    key: str,
    version: str = VERSION,
    payload: dict = Body(),
    account: FinanceAccount = Depends(require_finance_access),
    db: Session = Depends(checking),
) -> dict:
    row = checks.add_fact(db, account, key, version, payload)
    db.commit()
    return saved(row)


@router.post(
    "/files/{key}/versions/{version}/connections",
    status_code=201,
    **answer(schema.FinanceCheckSaved),
)
def add_connection(
    key: str,
    version: str = VERSION,
    payload: dict = Body(),
    account: FinanceAccount = Depends(require_finance_access),
    db: Session = Depends(checking),
) -> dict:
    row = checks.add_connection(db, account, key, version, payload)
    db.commit()
    return saved(row)


def _withdraw(db, model, check_id, payload):
    if not isinstance(payload, dict) or set(payload) != {"reason"}:
        raise ValueError("A withdrawal takes its reason and nothing else")
    row = checks.withdraw(db, model, check_id, payload["reason"])
    db.commit()
    return saved(row)


@router.post("/facts/{check_id}/withdraw", **answer(schema.FinanceCheckSaved))
def withdraw_fact(
    check_id: UUID, payload: dict = Body(), db: Session = Depends(checking)
) -> dict:
    return _withdraw(db, m.FinanceTVFact, check_id, payload)


@router.post("/connections/{check_id}/withdraw", **answer(schema.FinanceCheckSaved))
def withdraw_connection(
    check_id: UUID, payload: dict = Body(), db: Session = Depends(checking)
) -> dict:
    return _withdraw(db, m.FinanceTVConnection, check_id, payload)
