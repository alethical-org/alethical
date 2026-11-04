"""Private Finance spelling suggestions; every spelling keeps its own records."""

from fastapi import APIRouter, Depends, Query
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

from alethical.api.finance_access import require_finance_access
from alethical.api.problems import problem_exception
from alethical.api.services import finance_similar_names as similar
from alethical.api.services.identity_confirmations import IdentityError
from alethical.db.session import get_db
from alethical.pipeline.campaign_finance_reader import ReleaseNoLongerHeld

router = APIRouter(prefix="/finance", dependencies=[Depends(require_finance_access)])


@router.get("/similar-names")
def similar_names(
    name: str = Query(min_length=1, max_length=500),
    role: similar.Role = "payee",
    year: int | None = Query(default=None, ge=1900, le=2100),
    limit: int = Query(default=25, ge=1, le=50),
    offset: int = Query(default=0, ge=0),
    version: str | None = Query(default=None, pattern=r"^[0-9a-f]{16}$"),
    db: Session = Depends(get_db),
) -> dict:
    try:
        return {
            "data": similar.read(
                db,
                name=name,
                role=role,
                year=year,
                limit=limit,
                offset=offset,
                version=version,
            )
        }
    except IdentityError as exc:
        raise problem_exception(422, "Unprocessable Entity", str(exc)) from None
    except (ReleaseNoLongerHeld, SQLAlchemyError):
        db.rollback()
        raise problem_exception(
            503,
            "Service Unavailable",
            "Similar names are temporarily unavailable. Try again.",
            type_slug="service-unavailable",
        ) from None
