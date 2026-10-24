"""Public, source-backed person overviews; private campaign access stays separate."""

from __future__ import annotations

from uuid import UUID

from fastapi import APIRouter, Depends, Query, Response
from sqlalchemy.orm import Session

from alethical.api.problems import problem_exception
from alethical.api.services.person_records import (
    load_person,
    person_for_legislator,
    research_records,
)
from alethical.db.models import PublicPerson
from alethical.db.session import get_db

router = APIRouter(prefix="/people", tags=["people"])


def _missing():
    return problem_exception(
        404,
        "Public record not found",
        "This public record is not available on Alethical.",
        type_slug="person-not-found",
    )


@router.get("/for-legislator/{slug}")
def for_legislator(slug: str, response: Response, db: Session = Depends(get_db)):
    response.headers["Cache-Control"] = "no-store"
    person = person_for_legislator(db, slug)
    if person is None:
        raise _missing()
    return person


@router.get("/{person_id}/research")
def research(
    person_id: str,
    response: Response,
    type: str | None = Query(default=None),
    cursor: str | None = Query(default=None, max_length=64),
    limit: int = Query(default=20, ge=1, le=50),
    db: Session = Depends(get_db),
):
    response.headers["Cache-Control"] = "no-store"
    try:
        pid = UUID(person_id)
    except ValueError:
        raise _missing() from None
    if db.get(PublicPerson, pid) is None:
        raise _missing()
    try:
        return research_records(db, pid, kind=type, cursor=cursor, limit=limit)
    except ValueError:
        raise problem_exception(
            400,
            "Research selection unavailable",
            "Choose a supported research selection.",
            type_slug="invalid-research-selection",
        ) from None


@router.get("/{person_id}")
def person(person_id: str, response: Response, db: Session = Depends(get_db)):
    response.headers["Cache-Control"] = "no-store"
    record = load_person(db, person_id)
    if record is None:
        raise _missing()
    return record
