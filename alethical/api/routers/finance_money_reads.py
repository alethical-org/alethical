"""Read-only money routes, mounted inside the Finance access boundary."""

from uuid import UUID
from typing import Literal
from fastapi import APIRouter, Depends, Path, Query
from sqlalchemy.orm import Session
from alethical.api.schemas import DetailResponse
from alethical.api.services import finance_money_reads as money
from alethical.db.session import get_db

router = APIRouter()
TEXT = r"^[^\x00]*$"


@router.get("/employers", response_model=DetailResponse)
def employers(
    q: str = Query(min_length=3, max_length=200, pattern=TEXT),
    limit: int = Query(50, ge=1, le=100),
    offset: int = Query(0, ge=0, le=2147483647),
    db: Session = Depends(get_db),
):
    return DetailResponse(data=money.employers(db, q=q, limit=limit, offset=offset))


@router.get("/employers/donors", response_model=DetailResponse)
def employer_donors(
    name: str = Query(min_length=1, max_length=200, pattern=TEXT),
    limit: int = Query(20, ge=1, le=100),
    offset: int = Query(0, ge=0, le=2147483647),
    release_id: UUID | None = None,
    db: Session = Depends(get_db),
):
    return DetailResponse(
        data=money.employer_donors(
            db, name=name, limit=limit, offset=offset, release_id=release_id
        )
    )


@router.get("/employers/donor-payments", response_model=DetailResponse)
def employer_donor_payments(
    name: str = Query(min_length=1, max_length=200, pattern=TEXT),
    donor: str | None = Query(None, min_length=1, max_length=200, pattern=TEXT),
    record_number: int | None = Query(None, ge=1, le=2147483647),
    limit: int = Query(50, ge=1, le=250),
    offset: int = Query(0, ge=0, le=2147483647),
    release_id: UUID | None = None,
    db: Session = Depends(get_db),
):
    return DetailResponse(
        data=money.employer_donor_payments(
            db,
            name=name,
            donor=donor,
            record_number=record_number,
            limit=limit,
            offset=offset,
            release_id=release_id,
        )
    )


@router.get("/committees/{registration}/payment-groups", response_model=DetailResponse)
def committee_groups(
    registration: str = Path(min_length=1, max_length=20, pattern=TEXT),
    year: int = Query(ge=2015, le=2100),
    direction: Literal["received", "made"] = "received",
    tab: Literal[
        "individuals", "lobbyists", "committees", "party", "other", "expenditures"
    ]
    | None = None,
    q: str = Query("", max_length=200, pattern=TEXT),
    sort: Literal["total", "name", "records"] = "total",
    limit: int = Query(20, ge=1, le=100),
    offset: int = Query(0, ge=0, le=2147483647),
    release_id: UUID | None = None,
    db: Session = Depends(get_db),
):
    return DetailResponse(
        data=money.committee_groups(
            db,
            registration=registration,
            year=year,
            direction=direction,
            tab=tab,
            q=q,
            sort=sort,
            limit=limit,
            offset=offset,
            release_id=release_id,
        )
    )


@router.get("/committees/{registration}/group-payments", response_model=DetailResponse)
def committee_group_payments(
    registration: str = Path(min_length=1, max_length=20, pattern=TEXT),
    year: int = Query(ge=2015, le=2100),
    direction: Literal["received", "made"] = "received",
    key: str = Query(min_length=1, max_length=2048, pattern=TEXT),
    limit: int = Query(50, ge=1, le=250),
    offset: int = Query(0, ge=0, le=2147483647),
    release_id: UUID | None = None,
    db: Session = Depends(get_db),
):
    return DetailResponse(
        data=money.committee_group_payments(
            db,
            registration=registration,
            year=year,
            direction=direction,
            key=key,
            limit=limit,
            offset=offset,
            release_id=release_id,
        )
    )


@router.get("/committees/{registration}/report-figures", response_model=DetailResponse)
def report_figures(
    registration: str = Path(min_length=1, max_length=20, pattern=TEXT),
    year: int = Query(ge=2015, le=2100),
    db: Session = Depends(get_db),
):
    return DetailResponse(
        data=money.report_figures(db, registration=registration, year=year)
    )


@router.get(
    "/candidates/{candidate_id}/campaign-finance", response_model=DetailResponse
)
def candidate_campaign_finance(
    candidate_id: str = Path(pattern=r"^[a-f0-9]{64}$"),
    year: int = Query(ge=2015, le=2100),
    db: Session = Depends(get_db),
):
    return DetailResponse(
        data=money.candidate_campaign_finance(db, candidate_id=candidate_id, year=year)
    )


@router.get(
    "/candidates/{candidate_id}/campaign-finance/years", response_model=DetailResponse
)
def candidate_campaign_finance_years(
    candidate_id: str = Path(pattern=r"^[a-f0-9]{64}$"),
    from_year: int = Query(alias="from", ge=2015, le=2100),
    to_year: int = Query(alias="to", ge=2015, le=2100),
    db: Session = Depends(get_db),
):
    return DetailResponse(
        data=money.candidate_campaign_finance_years(
            db, candidate_id=candidate_id, from_year=from_year, to_year=to_year
        )
    )
