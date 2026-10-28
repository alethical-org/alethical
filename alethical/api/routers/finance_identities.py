"""Alethical Finance's identity confirmations: read, confirm, withdraw, merge, split.

Every route depends on the Finance access check, and every account has the same
tools. A change records whether a team account made it, which only decides what
alethical.com may print; no answer names who made a change.
"""

from __future__ import annotations

from uuid import UUID

from fastapi import APIRouter, Depends, Query
from sqlalchemy.exc import IntegrityError, SQLAlchemyError
from sqlalchemy.orm import Session

from alethical.api.finance_access import require_finance_access
from alethical.api.problems import problem_exception
from alethical.api.services import identity_confirmations as identities
from alethical.api.services.finance_access import FinanceAccount
from alethical.db.session import get_db

router = APIRouter(
    prefix="/finance/identities", dependencies=[Depends(require_finance_access)]
)


def _answer(db: Session, work):
    try:
        result = work()
        db.commit()
        return result
    except identities.NotFound:
        db.rollback()
        raise problem_exception(404, "Not Found", "Not found.") from None
    except identities.IdentityError as exc:
        db.rollback()
        raise problem_exception(
            422, "Unprocessable Entity", str(exc), type_slug="identity-not-saved"
        ) from None
    except IntegrityError:
        db.rollback()
        raise problem_exception(
            409,
            "Conflict",
            "This record was confirmed for an identity a moment ago. Reload and check.",
        ) from None
    except SQLAlchemyError:
        db.rollback()
        raise problem_exception(
            503,
            "Service Unavailable",
            "Identities are temporarily unavailable. Try again.",
            type_slug="service-unavailable",
        ) from None


@router.get("/lookup")
def lookup(
    record_kind: str = Query(max_length=40),
    record_key: str = Query(max_length=500),
    db: Session = Depends(get_db),
) -> dict:
    """The identity a record is confirmed for, or null: never an inferred match."""
    return {"data": _answer(db, lambda: identities.lookup(db, record_kind, record_key))}


@router.get("/{entity_id}")
def read(entity_id: UUID, db: Session = Depends(get_db)) -> dict:
    return {"data": _answer(db, lambda: identities.read(db, entity_id))}


@router.post("", status_code=201)
def create(
    payload: dict,
    account: FinanceAccount = Depends(require_finance_access),
    db: Session = Depends(get_db),
) -> dict:
    team = account.is_alethical_team

    def work():
        entity = identities.create(db, payload, team=team)
        return identities.read(db, entity.id)

    return {"data": _answer(db, work)}


@router.post("/{entity_id}/links", status_code=201)
def add_link(
    entity_id: UUID,
    payload: dict,
    account: FinanceAccount = Depends(require_finance_access),
    db: Session = Depends(get_db),
) -> dict:
    team = account.is_alethical_team

    def work():
        identities.add_link(db, entity_id, payload, team=team)
        return identities.read(db, entity_id)

    return {"data": _answer(db, work)}


@router.post("/links/{link_id}/withdraw")
def withdraw_link(
    link_id: UUID,
    payload: dict,
    account: FinanceAccount = Depends(require_finance_access),
    db: Session = Depends(get_db),
) -> dict:
    team = account.is_alethical_team

    def work():
        link = identities.withdraw_link(db, link_id, payload, team=team)
        return identities.read(db, link.entity_id)

    return {"data": _answer(db, work)}


@router.post("/{entity_id}/merge")
def merge(
    entity_id: UUID,
    payload: dict,
    account: FinanceAccount = Depends(require_finance_access),
    db: Session = Depends(get_db),
) -> dict:
    team = account.is_alethical_team

    def work():
        target = identities.merge(db, entity_id, payload, team=team)
        return identities.read(db, target.id)

    return {"data": _answer(db, work)}


@router.post("/{entity_id}/split")
def split(
    entity_id: UUID,
    payload: dict,
    account: FinanceAccount = Depends(require_finance_access),
    db: Session = Depends(get_db),
) -> dict:
    team = account.is_alethical_team

    def work():
        identities.split(db, entity_id, payload, team=team)
        return identities.read(db, entity_id)

    return {"data": _answer(db, work)}
