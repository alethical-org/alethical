"""Alethical Finance's endpoints. Every route depends on the Finance access check.

The router-level dependency means no Finance route can be added that forgets it,
and ``default_public_cache`` in ``alethical/api/main.py`` marks every response
under ``/api/v1/finance/`` private, so 1 account's answer never reaches another.
"""

from __future__ import annotations

from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from alethical.api.finance_access import require_finance_access
from alethical.api.routers.public import campaign_finance_search
from alethical.api.services.campaign_finance_search import MIN_QUERY_LENGTH
from alethical.api.routers.public import same_legislature_session_ids
from alethical.api.routers.public import search as legislature_search
from alethical.api.routers.finance_money_reads import router as money_router
from alethical.api.problems import problem_exception
from alethical.api.serializers import companion_payload, sponsor_payloads
from alethical.api.services import finance_records
from alethical.db.models import Bill, Legislator, LegislatorServicePeriod, Sponsorship
from alethical.db.session import get_db

router = APIRouter(prefix="/finance", dependencies=[Depends(require_finance_access)])
router.include_router(money_router)


@router.get("/access")
def access() -> dict:
    """200 for a listed account; the access check answers 401 or 403 otherwise."""
    return {"data": {"allowed": True}}


@router.get("/suggestions")
def suggestions(
    q: str = Query(min_length=1, max_length=200),
    request_id: str = Query(min_length=1, max_length=64, pattern=r"^[A-Za-z0-9_-]+$"),
    limit: int = Query(default=3, ge=1, le=10),
    db: Session = Depends(get_db),
) -> dict:
    """Grouped suggestions for 1 typed query, in 1 request.

    The groups are alethical.com's own answers, not a copy: the money search
    (``/campaign-finance/search``: legislators, committees, the 3 printed-name
    groups, lobbyists and principals, exactly as typed and from 3 characters) and
    the bill search (``/search``). ``request_id`` comes back unchanged, so the app
    drops a reply that arrives after a newer one.
    """
    typed = q.strip()
    money = campaign_finance_search(q=typed, limit=limit, db=db).data
    # The bill search answers even an empty query with whatever it holds, so
    # Finance asks it only from the money search's own minimum length: a stray
    # space never suggests unrelated bills.
    bills = (
        legislature_search(
            q=typed, types="bills", session=None, limit=limit, db=db
        ).data["bills"]
        if len(typed) >= MIN_QUERY_LENGTH
        else []
    )
    return {"data": {"request_id": request_id, "q": q, "money": money, "bills": bills}}


@router.get("/legislative-committees")
def legislative_committees(db: Session = Depends(get_db)) -> dict:
    """The sitting Legislature's committees."""
    return {"data": finance_records.legislative_committees(db)}


@router.get("/legislative-committees/{committee_id}/members")
def committee_members(committee_id: UUID, db: Session = Depends(get_db)) -> dict:
    """1 committee's members, each with whether their campaign accounts are confirmed.

    Records only. Each member's figures for a year come from
    ``/legislators/{legislator_id}/campaign-finance``, 1 member at a time, so no
    figure is ever combined across members.
    """
    try:
        return {"data": finance_records.committee_members(db, committee_id)}
    except LookupError:
        raise problem_exception(404, "Not Found", "Not found.") from None


def _bill_with_authors(db: Session, bill_key: str) -> Bill:
    """The bill with its authors' service and its companion loaded together, so
    the read takes the same few database trips however many authors it has."""
    service = (
        selectinload(Bill.sponsorships)
        .selectinload(Sponsorship.legislator)
        .selectinload(Legislator.service_periods)
    )
    bill = db.scalar(
        select(Bill)
        .where(Bill.bill_key == bill_key)
        .options(
            service.selectinload(LegislatorServicePeriod.chamber),
            service.selectinload(LegislatorServicePeriod.district),
            selectinload(Bill.companion_bill),
        )
    )
    if bill is None:
        raise HTTPException(status_code=404, detail="bill not found")
    return bill


@router.get("/bills/{bill_id}/authors")
def bill_authors(bill_id: str, db: Session = Depends(get_db)) -> dict:
    """A bill's authors as its page lists them, each with their campaign accounts.

    The rows come from the bill page's own formatter (``sponsor_payloads``), so
    each carries ``source_chamber``: a companion bill's authors stay marked as
    the other chamber's. Records only: who authored the bill and which committees
    are confirmed as theirs, never money and never a claim that one caused the
    other.
    """
    bill = _bill_with_authors(db, bill_id)
    authors = [
        item.model_dump()
        for item in sponsor_payloads(
            bill.sponsorships,
            session_id=bill.session_id,
            biennium_session_ids=same_legislature_session_ids(db, bill.session_id),
        )
    ]
    companion = companion_payload(bill)
    return {
        "data": {
            "bill": {
                "id": bill.bill_key,
                # With no plain-language title the bill page heads the bill with
                # its number, never its legal title; these are its inputs.
                "short_title": bill.short_title,
                "file_type": bill.file_type,
                "file_number": bill.file_number,
                "current_status": bill.current_status,
                "status_key": bill.status_key,
                "companion": companion.model_dump() if companion else None,
            },
            "authors": finance_records.bill_authors(authors, db),
        }
    }
