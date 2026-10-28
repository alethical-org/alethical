"""Alethical Finance's Media buys: TV station files, read by every Finance account.

Behind the Finance access check, through the same readers alethical.com's
administrators use, in their Finance reading
(``alethical/api/services/finance_media_buys.py``). Each answer passes through its
response model in ``alethical/api/finance_media_buys_schemas.py``, so only the
fields named there reach Finance: never alethical.com's public-copy steps, links
or account identifiers.
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, Query, Response
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

from alethical.api import finance_media_buys_schemas as schema
from alethical.api.finance_access import require_finance_access
from alethical.api.problems import problem_exception
from alethical.api.services import finance_media_buys as media
from alethical.api.services import tv_ad_review as review
from alethical.api.services import tv_ads as reader
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
