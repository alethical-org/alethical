"""Alethical Finance's identity confirmations: read, list, confirm, withdraw, merge, split.

Every route depends on the Finance access check, and every account has the same
tools. A change records whether a team account made it, which only decides what
alethical.com may print; no answer names who made a change. Every word a person
types here (names, relations, bases, reasons) is readable by every Finance account.
"""

from __future__ import annotations

from uuid import UUID

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel, ConfigDict, Field, StrictInt
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

SHARED = "Every Finance account can read this, so never write anything confidential."


class _Request(BaseModel):
    model_config = ConfigDict(extra="forbid")


class ConfirmationRequest(_Request):
    record_kind: str = Field(
        description="A printed name: donor_name, employer_name, payee_name or"
        " independent_payee_name. An identifier: committee, lobbyist, principal,"
        " legislator or public_person."
    )
    record_key: str = Field(
        description="The name exactly as printed, or the registration number,"
        " principal id or held id exactly as held."
    )
    relation: str = Field(description=f"What the record is to the identity. {SHARED}")
    evidence_source: str = Field(
        description="cf_contribution_row, cf_expenditure_row,"
        " cf_independent_expenditure_row, cf_filer, lobbyist_row,"
        " lobbying_expenditure_row or official_page."
    )
    evidence_snapshot_id: str | None = Field(
        None, description="The saved source copy holding the evidence row."
    )
    evidence_locator: StrictInt | None = Field(
        None, description="The evidence row's number in that copy, for a row source."
    )
    evidence_url: str | None = Field(
        None,
        description="For a legislator or public person: an https page on an"
        " official Minnesota site.",
    )
    evidence_quote: str = Field(
        description="Words copied from 1 printed value of the evidence, at least 3"
        " characters."
    )
    basis: str = Field(
        description="Why the evidence shows the record belongs to this identity."
        f" {SHARED}"
    )
    fingerprints: list[str] | None = Field(
        None,
        description="For a printed name only: the records confirmed, by the"
        " fingerprints the records listing serves, at most 5,000. 'All records' and"
        " '{year} records' choose from that listing; nothing about the choice is"
        " stored, and a record added later is never covered.",
    )


class CreateRequest(_Request):
    kind: str = Field(description="person or organization.")
    name: str = Field(description=f"The identity's name. {SHARED}")
    confirmation: ConfirmationRequest


class WithdrawRequest(_Request):
    reason: str = Field(description=f"Why it is withdrawn. {SHARED}")


class MergeRequest(_Request):
    into: str = Field(description="The identity this one joins.")
    reason: str = Field(description=f"Why they are 1 identity. {SHARED}")


class SplitPart(_Request):
    name: str = Field(description=f"The new identity's name. {SHARED}")
    confirmations: list[str] = Field(
        description="The active confirmations this part takes, by id."
    )


class SplitRequest(_Request):
    reason: str = Field(description=f"Why it is more than 1 identity. {SHARED}")
    parts: list[SplitPart] = Field(description="At least 2 parts.")


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
    except (identities.Unavailable, SQLAlchemyError):
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
    """The identity a registration number or held id stands for today, or null."""
    return {"data": _answer(db, lambda: identities.lookup(db, record_kind, record_key))}


@router.get("/records")
def records(
    record_kind: str = Query(max_length=40),
    record_key: str = Query(max_length=500),
    db: Session = Depends(get_db),
) -> dict:
    """Every record in the Board's current file printing a name, with its claim."""
    return {
        "data": _answer(db, lambda: identities.records(db, record_kind, record_key))
    }


@router.get("/{entity_id}")
def read(entity_id: UUID, db: Session = Depends(get_db)) -> dict:
    return {"data": _answer(db, lambda: identities.read(db, entity_id))}


@router.post("", status_code=201)
def create(
    payload: CreateRequest,
    account: FinanceAccount = Depends(require_finance_access),
    db: Session = Depends(get_db),
) -> dict:
    team = account.is_alethical_team

    def work():
        entity = identities.create(db, payload.model_dump(), team=team)
        return identities.read(db, entity.id)

    return {"data": _answer(db, work)}


@router.post("/{entity_id}/confirmations", status_code=201)
def add_confirmation(
    entity_id: UUID,
    payload: ConfirmationRequest,
    account: FinanceAccount = Depends(require_finance_access),
    db: Session = Depends(get_db),
) -> dict:
    team = account.is_alethical_team

    def work():
        identities.add_confirmation(db, entity_id, payload.model_dump(), team=team)
        return identities.read(db, entity_id)

    return {"data": _answer(db, work)}


@router.post("/confirmations/{confirmation_id}/withdraw")
def withdraw(
    confirmation_id: UUID,
    payload: WithdrawRequest,
    account: FinanceAccount = Depends(require_finance_access),
    db: Session = Depends(get_db),
) -> dict:
    team = account.is_alethical_team

    def work():
        confirmation = identities.withdraw(
            db, confirmation_id, payload.model_dump(), team=team
        )
        return identities.read(db, confirmation.entity_id)

    return {"data": _answer(db, work)}


@router.post("/{entity_id}/merge")
def merge(
    entity_id: UUID,
    payload: MergeRequest,
    account: FinanceAccount = Depends(require_finance_access),
    db: Session = Depends(get_db),
) -> dict:
    team = account.is_alethical_team

    def work():
        target = identities.merge(db, entity_id, payload.model_dump(), team=team)
        return identities.read(db, target.id)

    return {"data": _answer(db, work)}


@router.post("/{entity_id}/split")
def split(
    entity_id: UUID,
    payload: SplitRequest,
    account: FinanceAccount = Depends(require_finance_access),
    db: Session = Depends(get_db),
) -> dict:
    team = account.is_alethical_team

    def work():
        identities.split(db, entity_id, payload.model_dump(), team=team)
        return identities.read(db, entity_id)

    return {"data": _answer(db, work)}
