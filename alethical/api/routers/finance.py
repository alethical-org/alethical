"""Alethical Finance's endpoints. Every route depends on the Finance access check.

The router-level dependency means no Finance route can be added that forgets it,
and ``default_public_cache`` in ``alethical/api/main.py`` marks every response
under ``/api/v1/finance/`` private, so 1 account's answer never reaches another.
"""

from __future__ import annotations

from uuid import UUID
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import JSONResponse
from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from alethical.api.finance_access import require_finance_access
from alethical.api.routers.public import _payment_page_payload, campaign_finance_search
from alethical.api.services.campaign_finance_search import MIN_QUERY_LENGTH
from alethical.api.routers.public import same_legislature_session_ids
from alethical.api.routers.public import search as legislature_search
from alethical.api.routers.finance_money_reads import router as money_router
from alethical.api.problems import problem_exception, problem_payload
from alethical.api.serializers import companion_payload, sponsor_payloads
from alethical.api.services import (
    finance_records,
    finance_payees,
    finance_people,
    finance_connections,
    finance_payments_under_name as under_name,
    finance_versions,
)
from alethical.db.models import Bill, Legislator, LegislatorServicePeriod, Sponsorship
from alethical.db.session import get_db

router = APIRouter(prefix="/finance", dependencies=[Depends(require_finance_access)])
router.include_router(money_router)


@router.get("/connections", response_model=dict)
def money_connections(
    q: str = Query("", max_length=200, pattern=r"^[^\x00]*$"),
    year: int | None = Query(None, ge=1900, le=2200),
    relationship: finance_connections.Relationship = "all",
    focus: str | None = Query(None, max_length=2000, pattern=r"^[^\x00]*$"),
    limit: int = Query(100, ge=1, le=200),
    offset: int = Query(0, ge=0, le=2147483647),
    version: str | None = Query(
        default=None,
        pattern=r"^[0-9a-f]{16}$",
        description="The version an earlier page returned; 409 when its sources changed.",
    ),
    db: Session = Depends(get_db),
) -> dict | JSONResponse:
    token = finance_versions.check(
        db, version, "money", "identity", "accounts", "lobbying", "station"
    )
    try:
        data = finance_connections.connections(
            db,
            query=q.strip(),
            year=year,
            relationship=relationship,
            focus=focus,
            limit=limit,
            offset=offset,
        )
    except finance_connections.BroadGraphBusy:
        # Expected admission, not an operational failure. A short retry would
        # exhaust the client's retries while the admitted graph is still running.
        return JSONResponse(
            status_code=503,
            content=problem_payload(
                type_slug="service-busy",
                title="Service busy",
                status=503,
                detail="The service is busy. Please try again in a moment.",
                instance="/api/v1/finance/connections",
            ),
            headers={"Cache-Control": "private, no-store", "Retry-After": "10"},
        )
    return {"data": {**data, "version": token}}


@router.get("/payments-under-name")
def payments_under_name(
    name: str = Query(min_length=1, max_length=200, pattern=r"^[^\x00]*$"),
    role: under_name.Role = Query(),
    year: int | None = Query(default=None, ge=2015, le=2100),
    filer: str | None = Query(
        default=None, min_length=1, max_length=20, pattern=r"^[^\x00]*$"
    ),
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0, le=2147483647),
    release_id: UUID | None = None,
    db: Session = Depends(get_db),
) -> dict:
    """alethical.com's payments under 1 exact printed name, with Finance's facts per row.

    The rows, states and paging are ``/campaign-finance/payments-under-name``'s own.
    Each payment adds its ``fingerprint``, the ``identity`` it is confirmed to (or
    null), its ``evidence`` locator and ``excerpt``; ``identities`` counts the records
    each identity holds in this scope. ``filer`` limits rows and counts to 1 filer's
    filings. ``release_id`` pins the Board's file: a changed file answers 409.
    """
    try:
        result = under_name.read(
            db,
            name=name,
            role=role,
            year=year,
            filer=filer,
            limit=limit,
            offset=offset,
            release_id=release_id,
        )
    except under_name.ReleaseChanged:
        raise HTTPException(409, "The Board's file changed. Reload the records.")
    except under_name.NothingPublished:
        # Missing records are a state, not a failure (grounded-answers rule 12).
        return {
            "data": {
                "name": name,
                "role": role,
                "year": year,
                "filer": filer,
                "record_kind": under_name.ROLES[role][2],
                "identities": [],
                "state": "unavailable",
                "payments": [],
                "page": {
                    "limit": limit,
                    "offset": offset,
                    "has_more": False,
                    "total_payments": None,
                },
                "linkable_registration_numbers": [],
                "dataset": under_name.dataset_for(role).value,
                "source_url": None,
                "release_id": None,
                "fetched_at": None,
            }
        }
    payload = _payment_page_payload(result["page"])
    payload["payments"] = [
        {**payment, **extra}
        for payment, extra in zip(payload["payments"], result["rows"], strict=True)
    ]
    return {
        "data": {
            "name": name,
            "role": role,
            "year": year,
            "filer": filer,
            "record_kind": result["record_kind"],
            "identities": result["identities"],
            **payload,
        }
    }


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


@router.get("/payees")
def payees(
    q: str = Query(default="", max_length=200, pattern=r"^[^\x00]*$"),
    year: int | None = Query(default=None, ge=2015, le=2100),
    payment_type: str | None = Query(
        default=None, max_length=200, pattern=r"^[^\x00]*$"
    ),
    tab: finance_payees.PayeeTab = "all",
    sort: finance_payees.PayeeSort = "name",
    limit: int = Query(default=50, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
    version: str | None = Query(
        default=None,
        pattern=r"^[0-9a-f]{16}$",
        description="The version an earlier page returned; 409 when its sources changed.",
    ),
    db: Session = Depends(get_db),
) -> dict:
    """Itemized payee rows, keeping source files and confirmation coverage separate."""
    token = finance_versions.check(db, version, "money", "identity")
    return {
        "data": {
            "version": token,
            **finance_payees.directory(
                db,
                query=q,
                year=year,
                payment_type=payment_type,
                tab=tab,
                sort=sort,
                limit=limit,
                offset=offset,
            ),
        }
    }


@router.get("/people")
def people(
    q: str = Query(default="", max_length=200, pattern=r"^[^\x00]*$"),
    type: finance_people.PeopleType = "all",
    scope: finance_people.PeopleScope = "all",
    year: int | None = Query(default=None, ge=1900, le=2200),
    service: finance_people.Service | None = None,
    party: str | None = Query(
        default=None, min_length=1, max_length=100, pattern=r"^[^\x00]*$"
    ),
    office: str | None = Query(
        default=None, min_length=1, max_length=200, pattern=r"^[^\x00]*$"
    ),
    chamber: finance_people.Chamber | None = None,
    sort: finance_people.PeopleSort = "name",
    limit: int = Query(default=50, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
    version: str | None = Query(
        default=None,
        pattern=r"^[0-9a-f]{16}$",
        description="The version an earlier page returned; 409 when its sources changed.",
    ),
    db: Session = Depends(get_db),
) -> dict:
    now = finance_people.read_time()
    token = finance_versions.check(
        db,
        version,
        "people",
        on_date=now.astimezone(ZoneInfo("America/Chicago")).date(),
    )
    return {
        "data": {
            "version": token,
            **finance_people.directory(
                db,
                now=now,
                query=q,
                type=type,
                scope=scope,
                year=year,
                service=service,
                party=party,
                office=office,
                chamber=chamber,
                sort=sort,
                limit=limit,
                offset=offset,
            ),
        }
    }
