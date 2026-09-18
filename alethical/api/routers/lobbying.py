"""Public reads for the Board's paired lobbying sources."""

from fastapi import APIRouter, Depends, HTTPException, Path, Query
from sqlalchemy.orm import Session

from alethical.api.schemas import DetailResponse
from alethical.api.services import lobbying
from alethical.api.services.committee_finance import pin_to_one_view
from alethical.db.session import get_db

router = APIRouter(prefix="/lobbying")


def _pair(db: Session):
    pin_to_one_view(db)
    return lobbying.published_pair(db)


@router.get("/summary", response_model=DetailResponse)
def summary(db: Session = Depends(get_db)):
    return DetailResponse(data=lobbying.summary(db, _pair(db)))


@router.get("/sitemap", response_model=DetailResponse)
def sitemap(db: Session = Depends(get_db)):
    """Every principal and lobbyist page worth listing, for the site's sitemap.

    One request instead of paging both directories 50 rows at a time (about 70
    round trips for the principals alone). Only the identity an address needs:
    the caller builds each address with the one slug function the app's router
    accepts, so this can never advertise an address that answers 404.
    """
    return DetailResponse(data=lobbying.sitemap_records(db, _pair(db)))


@router.get("/principals", response_model=DetailResponse)
def principals(
    limit: int = Query(default=50, ge=1, le=lobbying.MAX_LIST_ROWS),
    offset: int = Query(default=0, ge=0),
    q: str = Query(default="", max_length=200),
    db: Session = Depends(get_db),
):
    return DetailResponse(
        data=lobbying.principals_page(
            db, _pair(db), limit=limit, offset=offset, query=q
        )
    )


@router.get("/lobbyists", response_model=DetailResponse)
def lobbyists(
    limit: int = Query(default=50, ge=1, le=lobbying.MAX_LIST_ROWS),
    offset: int = Query(default=0, ge=0),
    q: str = Query(default="", max_length=200),
    db: Session = Depends(get_db),
):
    return DetailResponse(
        data=lobbying.lobbyists_page(db, _pair(db), limit=limit, offset=offset, query=q)
    )


@router.get("/principals/{entity_id}", response_model=DetailResponse)
def principal(entity_id: int, db: Session = Depends(get_db)):
    return DetailResponse(data=lobbying.principal(db, _pair(db), entity_id))


@router.get("/lobbyists/{registration_number}", response_model=DetailResponse)
def lobbyist(
    registration_number: str = Path(min_length=1, max_length=20, pattern=r"^[0-9]+$"),
    db: Session = Depends(get_db),
):
    if int(registration_number) == 0:
        raise HTTPException(
            status_code=422, detail="Registration number must identify a lobbyist."
        )
    return DetailResponse(data=lobbying.lobbyist(db, _pair(db), registration_number))
