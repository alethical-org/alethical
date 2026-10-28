"""Alethical Finance's endpoints. Every route depends on the Finance access check.

The router-level dependency means no Finance route can be added that forgets it,
and ``default_public_cache`` in ``alethical/api/main.py`` marks every response
under ``/api/v1/finance/`` private, so 1 account's answer never reaches another.
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from alethical.api.finance_access import require_finance_access
from alethical.api.routers.public import campaign_finance_search
from alethical.api.services.campaign_finance_search import MIN_QUERY_LENGTH
from alethical.api.routers.public import search as legislature_search
from alethical.db.session import get_db

router = APIRouter(prefix="/finance", dependencies=[Depends(require_finance_access)])


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
