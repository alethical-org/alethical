"""Published external finance evidence, mounted inside Finance's access boundary."""

from fastapi import APIRouter, Depends, Path, Query, Response
from sqlalchemy.orm import Session

from alethical.api.problems import problem_exception
from alethical.api.schemas import DetailResponse
from alethical.api.services import election_external_finance_reads as reads
from alethical.db.session import get_db
from alethical.pipeline.election_comparison import ComparisonImportError
from alethical.pipeline.election_external_adapters import register_external_adapters

router = APIRouter(prefix="/elections/{election_key}/external-finance")
HASH = r"^[a-f0-9]{64}$"
ELECTION = r"^mn-\d{4}-\d{2}-\d{2}-(general|primary|special)$"
CANDIDATE = r"^[^\x00]+$"


def _prepare():
    # Endpoint execution follows the parent router's access check and validation.
    try:
        register_external_adapters()
    except ComparisonImportError:
        raise problem_exception(
            503,
            "Service Unavailable",
            "External finance records are temporarily unavailable.",
        ) from None


@router.get("", response_model=DetailResponse)
def context(
    election_key: str = Path(pattern=ELECTION),
    generation_id: str | None = Query(None, pattern=HASH),
    version: str | None = Query(None, pattern=HASH),
    db: Session = Depends(get_db),
):
    _prepare()
    return DetailResponse(
        data=reads.context(
            db,
            election_key=election_key,
            generation_id=generation_id,
            version=version,
        )
    )


@router.get("/races/{race_id}/candidates/{candidate_id}", response_model=DetailResponse)
def candidate_finance(
    election_key: str = Path(pattern=ELECTION),
    race_id: str = Path(pattern=HASH),
    candidate_id: str = Path(min_length=1, max_length=64, pattern=CANDIDATE),
    generation_id: str | None = Query(None, pattern=HASH),
    version: str | None = Query(None, pattern=HASH),
    db: Session = Depends(get_db),
):
    _prepare()
    return DetailResponse(
        data=reads.candidate_finance(
            db,
            election_key=election_key,
            race_id=race_id,
            candidate_id=candidate_id,
            generation_id=generation_id,
            version=version,
        )
    )


@router.get(
    "/races/{race_id}/candidates/{candidate_id}/payments", response_model=DetailResponse
)
def payments(
    election_key: str = Path(pattern=ELECTION),
    race_id: str = Path(pattern=HASH),
    candidate_id: str = Path(min_length=1, max_length=64, pattern=CANDIDATE),
    generation_id: str = Query(pattern=HASH),
    version: str = Query(pattern=HASH),
    effective_only: bool = Query(True),
    limit: int = Query(100, ge=1, le=200),
    offset: int = Query(0, ge=0, le=2147483647),
    db: Session = Depends(get_db),
):
    _prepare()
    return DetailResponse(
        data=reads.payment_records(
            db,
            election_key=election_key,
            race_id=race_id,
            candidate_id=candidate_id,
            generation_id=generation_id,
            version=version,
            effective_only=effective_only,
            limit=limit,
            offset=offset,
        )
    )


@router.get("/sources/{source_hash}")
def source_download(
    election_key: str = Path(pattern=ELECTION),
    source_hash: str = Path(pattern=HASH),
    generation_id: str = Query(pattern=HASH),
    db: Session = Depends(get_db),
):
    _prepare()
    body, _, headers = reads.source_body(
        db,
        election_key=election_key,
        generation_id=generation_id,
        source_hash=source_hash,
    )
    return Response(content=body, headers=headers)
