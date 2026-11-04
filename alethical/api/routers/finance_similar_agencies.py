"""Spelling suggestions on Finance's exact printed-agency page."""

from fastapi import APIRouter, Depends, Path, Query
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

from alethical.api.finance_access import require_finance_access
from alethical.api.problems import problem_exception
from alethical.api.services import finance_similar_agencies as similar
from alethical.db.session import get_db

router = APIRouter(
    prefix="/finance/media-buys", dependencies=[Depends(require_finance_access)]
)


@router.get("/agencies/{key}/similar-names")
def similar_agencies(
    key: str = Path(pattern=r"^[0-9a-f]{64}$"),
    limit: int = Query(default=25, ge=1, le=50),
    offset: int = Query(default=0, ge=0),
    version: str | None = Query(default=None, pattern=r"^[0-9a-f]{16}$"),
    db: Session = Depends(get_db),
) -> dict:
    try:
        return {
            "data": similar.read(
                db, key=key, limit=limit, offset=offset, version=version
            )
        }
    except LookupError:
        raise problem_exception(404, "Not Found", "Not found.") from None
    except (similar.Unavailable, SQLAlchemyError):
        db.rollback()
        raise problem_exception(
            503,
            "Service Unavailable",
            "Similar agency names are temporarily unavailable. Try again.",
            type_slug="service-unavailable",
        ) from None
