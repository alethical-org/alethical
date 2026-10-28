"""Alethical Finance's endpoints. Every route depends on the Finance access check.

The router-level dependency means no Finance route can be added that forgets it,
and ``default_public_cache`` in ``alethical/api/main.py`` marks every response
under ``/api/v1/finance/`` private, so 1 account's answer never reaches another.
"""

from __future__ import annotations

from uuid import UUID

from fastapi import APIRouter, Depends, Response
from sqlalchemy.orm import Session

from alethical.api.finance_access import require_finance_access
from alethical.api.problems import problem_exception
from alethical.api.routers.public import bill_detail
from alethical.api.services import finance_records
from alethical.db.session import get_db

router = APIRouter(prefix="/finance", dependencies=[Depends(require_finance_access)])


@router.get("/access")
def access() -> dict:
    """200 for a listed account; the access check answers 401 or 403 otherwise."""
    return {"data": {"allowed": True}}


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


@router.get("/bills/{bill_id}/authors")
def bill_authors(bill_id: str, db: Session = Depends(get_db)) -> dict:
    """The bill page's own author list, each author with their campaign accounts.

    Records only: who authored the bill and which committees are confirmed as
    theirs, never money and never a claim that one caused the other.
    """
    page = bill_detail(
        bill_id=bill_id,
        include="all_sponsors",
        db=db,
        current_user=None,
        response=Response(),
    ).data
    return {
        "data": {
            "bill": {"id": page["id"], "title": page["title"]},
            "authors": finance_records.bill_authors(page["all_sponsors"], db),
        }
    }
