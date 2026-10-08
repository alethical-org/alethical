"""Private address requests and public, address-free candidate profiles."""

from __future__ import annotations

from zoneinfo import ZoneInfo

from fastapi import APIRouter, Depends, Response
from pydantic import BaseModel, ConfigDict, Field, field_validator
from sqlalchemy.orm import Session

from alethical.api.problems import problem_exception
from alethical.api.rate_limit import rate_limit, trusted_client_ip
from alethical.api.services.address_format import normalize_address_format
from alethical.api.services.candidate_lookup import (
    PRIVATE_HEADERS,
    CandidateLookupService,
    CandidateLookupUnavailable,
    get_candidate_lookup_service,
    load_profile,
    persist_catalogue,
)
from alethical.db.session import get_db
from alethical.api.services.person_records import (
    PublicRecordConflict,
    enrich_lookup_results,
)

router = APIRouter(prefix="/candidates", tags=["candidates"])


class AddressChoice(BaseModel):
    model_config = ConfigDict(extra="forbid")
    id: str = Field(min_length=1, max_length=64)
    label: str = Field(min_length=1, max_length=300)
    address: str = Field(min_length=1, max_length=300)


class AddressRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    address: str = Field(min_length=3, max_length=300)

    @field_validator("address")
    @classmethod
    def safe_address(cls, value: str) -> str:
        value = normalize_address_format(value)
        if any(ord(char) < 32 or ord(char) == 127 for char in value):
            raise ValueError("Enter a street address without control characters")
        return value.strip()


class LookupRequest(AddressRequest):
    electionId: str = Field(pattern=r"^[0-9]{1,20}$")
    confirmedChoice: AddressChoice | None = None


def _unavailable():
    return problem_exception(
        503,
        "Candidate records unavailable",
        "Minnesota's official candidate service could not complete this search. Try again.",
        type_slug="candidate-source-unavailable",
        headers=PRIVATE_HEADERS,
    )


@router.get("/elections")
def elections(service: CandidateLookupService = Depends(get_candidate_lookup_service)):
    return service.elections()


@router.post(
    "/suggest",
    dependencies=[
        Depends(
            rate_limit(
                "address_suggestion_limiter", "candidate-suggestion", trusted_client_ip
            )
        )
    ],
)
def suggest(
    request: AddressRequest,
    response: Response,
    service: CandidateLookupService = Depends(get_candidate_lookup_service),
):
    response.headers.update(PRIVATE_HEADERS)
    try:
        return service.suggest(request.address)
    except CandidateLookupUnavailable:
        raise _unavailable() from None


@router.post(
    "/lookup",
    dependencies=[
        Depends(rate_limit("lookup_limiter", "candidate-lookup", trusted_client_ip))
    ],
)
def lookup(
    request: LookupRequest,
    response: Response,
    service: CandidateLookupService = Depends(get_candidate_lookup_service),
    db: Session = Depends(get_db),
):
    response.headers.update(PRIVATE_HEADERS)
    try:
        result, catalogue = service.lookup(
            request.address,
            request.electionId,
            request.confirmedChoice.model_dump() if request.confirmedChoice else None,
        )
    except CandidateLookupUnavailable:
        raise _unavailable() from None
    if catalogue is not None:
        # A successful result's links must work in a separate browser. Database
        # failure therefore fails the lookup instead of returning broken links.
        try:
            persist_catalogue(db, catalogue)
        except PublicRecordConflict:
            db.rollback()
            raise _unavailable() from None
    return enrich_lookup_results(
        db, result, today=service.now().astimezone(ZoneInfo("America/Chicago")).date()
    )


@router.get("/{candidate_id}")
def profile(candidate_id: str, response: Response, db: Session = Depends(get_db)):
    response.headers["Cache-Control"] = "no-store"
    result = load_profile(db, candidate_id)
    if result is None:
        raise problem_exception(
            404,
            "Candidate not found",
            "This candidate record is not available on Alethical.",
            type_slug="candidate-not-found",
        )
    return result
