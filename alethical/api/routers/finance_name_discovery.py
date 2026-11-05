"""Private Finance name discovery; public exact-name reads keep their contract."""

from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from alethical.api.finance_access import require_finance_access
from alethical.api.routers.public import (
    _committee_payload,
    _search_result_payload,
    current_claim_validated_at,
)
from alethical.api.services import (
    campaign_finance_register as register,
    campaign_finance_search as search,
    committee_finance,
    lobbying,
)
from alethical.api.services.finance_name_matching import (
    configure_discovery,
    indexed_discovery_match,
)
from alethical.api.services.lobbying_donations import last_completed_year
from alethical.db.session import get_db
from alethical.pipeline.campaign_finance_reader import ReleaseNoLongerHeld

router = APIRouter(dependencies=[Depends(require_finance_access)])


def _release(db):
    committee_finance.pin_to_one_view(db)
    configure_discovery(db)
    try:
        return committee_finance.current_release(db)
    except ReleaseNoLongerHeld:
        return None


def search_data(db, q: str, limit: int):
    answer = search.search(
        db, _release(db), query=q, limit=limit, name_match=indexed_discovery_match
    )
    return {
        "current_claim_validated_at": current_claim_validated_at(),
        "state": answer.state,
        "q": answer.query,
        "matched_on": answer.matched_on,
        "min_query_length": answer.min_query_length,
        "counted_up_to": answer.counted_up_to,
        "groups": [
            {
                "kind": group.kind,
                "fetched_at": group.fetched_at,
                "state": group.state,
                "results": [_search_result_payload(row) for row in group.results],
                "total": group.total,
                "at_least": group.at_least,
                "has_more": group.has_more,
                "reason": group.reason,
            }
            for group in answer.groups
        ],
        "lobbying_release_id": str(answer.lobbying_release_id)
        if answer.lobbying_release_id
        else None,
        "lobbying_copied_at": answer.lobbying_copied_at,
        "as_of": answer.as_of,
        "snapshot_id": str(answer.snapshot_id) if answer.snapshot_id else None,
        "release_id": str(answer.release_id) if answer.release_id else None,
        "fetched_at": answer.fetched_at,
        "reason": answer.reason,
    }


@router.get("/name-search")
def name_search(
    q: str = Query(min_length=1, max_length=200, pattern=r"^[^\x00]*$"),
    limit: int = Query(5, ge=1, le=search.MAX_PER_GROUP),
    db: Session = Depends(get_db),
):
    return {"data": search_data(db, q, limit)}


@router.get("/committees")
def committees(
    kind: Literal["candidate_committee", "party_unit", "political_committee_or_fund"]
    | None = None,
    q: str | None = Query(None, min_length=1, max_length=200, pattern=r"^[^\x00]*$"),
    limit: int = Query(25, ge=1, le=register.MAX_COMMITTEES),
    offset: int = Query(0, ge=0),
    sort: register.CommitteeSort = "name",
    status: register.RegistrationStatus | None = None,
    party: str | None = Query(
        None, min_length=1, max_length=200, pattern=r"^[^\x00]*$"
    ),
    db: Session = Depends(get_db),
):
    release = _release(db)
    party = party if kind == "candidate_committee" else None
    page = register.committees(
        db,
        limit=limit,
        offset=offset,
        kind=kind,
        query=q,
        release=release,
        sort=sort,
        status=status,
        search_registration=True,
        party=party,
        name_match=indexed_discovery_match,
    )
    return {
        "data": {
            "state": page.state,
            "ordered_by": page.ordered_by,
            "status": status,
            "party": party,
            "candidate_parties": page.candidate_parties,
            "held_by_kind": page.held_by_kind,
            "held_register_total": page.held_register_total,
            "kind": kind,
            "q": q,
            "committees": [_committee_payload(row) for row in page.committees],
            "page": {
                "limit": page.limit,
                "offset": page.offset,
                "has_more": page.has_more,
                "total": page.total,
            },
            "register_total": page.register_total,
            "by_kind": page.by_kind,
            "as_of": page.as_of,
            "snapshot_id": str(page.snapshot_id) if page.snapshot_id else None,
            "release_id": str(page.release_id) if page.release_id else None,
            "reason": page.reason,
        }
    }


@router.get("/lobbying/principals")
def principals(
    limit: int = Query(50, ge=1, le=lobbying.MAX_LIST_ROWS),
    offset: int = Query(0, ge=0),
    q: str = Query("", max_length=200, pattern=r"^[^\x00]*$"),
    year: int | None = Query(None, ge=2009, le=2100),
    sort: Literal["name", "spending_desc", "spending_asc"] = "name",
    db: Session = Depends(get_db),
):
    committee_finance.pin_to_one_view(db)
    configure_discovery(db)
    return {
        "data": lobbying.principals_page(
            db,
            lobbying.published_pair(db),
            limit=limit,
            offset=offset,
            query=q,
            year=year,
            sort=sort,
            name_match=indexed_discovery_match,
        )
    }


@router.get("/lobbying/lobbyists")
def lobbyists(
    limit: int = Query(50, ge=1, le=lobbying.MAX_LIST_ROWS),
    offset: int = Query(0, ge=0),
    q: str = Query("", max_length=200, pattern=r"^[^\x00]*$"),
    year: int | None = Query(None, ge=2015),
    sort: Literal["name", "donations_desc", "donations_asc"] = "donations_desc",
    db: Session = Depends(get_db),
):
    if year is not None and year > last_completed_year():
        raise HTTPException(status_code=422, detail="Choose a completed calendar year.")
    committee_finance.pin_to_one_view(db)
    configure_discovery(db)
    return {
        "data": lobbying.lobbyists_page(
            db,
            lobbying.published_pair(db),
            limit=limit,
            offset=offset,
            query=q,
            year=year,
            sort=sort,
            name_match=indexed_discovery_match,
        )
    }
