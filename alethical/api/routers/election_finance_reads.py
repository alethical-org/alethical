"""Dated, reviewed candidate finance comparisons inside Finance access."""

from typing import Literal

from fastapi import APIRouter, Depends, Path, Query, Response
from sqlalchemy.orm import Session

from alethical.api.schemas import DetailResponse
from alethical.api.services import election_finance_reads as reads
from alethical.db.session import get_db

router = APIRouter()
HASH = r"^[a-f0-9]{64}$"
ELECTION = r"^mn-\d{4}-\d{2}-\d{2}-(general|primary|special)$"
VERSION = r"^[a-f0-9]{16}$"


@router.get(
    "/elections/{election_key}/races/{race_id}/finance", response_model=DetailResponse
)
def comparison(
    election_key: str = Path(pattern=ELECTION),
    race_id: str = Path(pattern=HASH),
    snapshot_id: str | None = Query(None, pattern=HASH),
    version: str | None = Query(None, pattern=VERSION),
    db: Session = Depends(get_db),
):
    return DetailResponse(
        data=reads.comparison(
            db,
            election_key=election_key,
            race_id=race_id,
            snapshot_id=snapshot_id,
            version=version,
        )
    )


@router.get(
    "/elections/{election_key}/races/{race_id}/finance/candidates/{candidate_id}/outside-spending",
    response_model=DetailResponse,
)
def outside_records(
    election_key: str = Path(pattern=ELECTION),
    race_id: str = Path(pattern=HASH),
    candidate_id: str = Path(min_length=1, max_length=64, pattern=r"^[^\x00]+$"),
    snapshot_id: str = Query(pattern=HASH),
    version: str = Query(pattern=VERSION),
    spender_type: Literal["PCF", "PTU", "other"] | None = None,
    direction: Literal["For", "Against", "unknown"] | None = None,
    limit: int = Query(50, ge=1, le=100),
    offset: int = Query(0, ge=0, le=2147483647),
    db: Session = Depends(get_db),
):
    return DetailResponse(
        data=reads.outside_records(
            db,
            election_key=election_key,
            race_id=race_id,
            candidate_id=candidate_id,
            snapshot_id=snapshot_id,
            version=version,
            spender_type=spender_type,
            direction=direction,
            limit=limit,
            offset=offset,
        )
    )


@router.get("/elections/{election_key}/finance/sources/{document_hash}")
def source_pdf(
    election_key: str = Path(pattern=ELECTION),
    document_hash: str = Path(pattern=HASH),
    collection_id: str = Query(pattern=HASH),
    db: Session = Depends(get_db),
):
    body = reads.source_pdf(
        db,
        election_key=election_key,
        collection_id=collection_id,
        document_hash=document_hash,
    )
    return Response(
        content=body,
        media_type="application/octet-stream",
        headers={
            "Content-Disposition": f'attachment; filename="report-{document_hash}.pdf"',
            "X-Content-Type-Options": "nosniff",
        },
    )


@router.get("/elections/{election_key}/finance/sources/{source_hash}/raw")
def source_body(
    election_key: str = Path(pattern=ELECTION),
    source_hash: str = Path(pattern=HASH),
    collection_id: str = Query(pattern=HASH),
    db: Session = Depends(get_db),
):
    body, _ = reads.source_body(
        db,
        election_key=election_key,
        collection_id=collection_id,
        source_hash=source_hash,
    )
    return Response(
        content=body,
        media_type="application/octet-stream",
        headers={
            "Content-Disposition": f'attachment; filename="source-{source_hash}.bin"',
            "X-Content-Type-Options": "nosniff",
        },
    )


@router.get(
    "/elections/{election_key}/finance/sources/{source_hash}/lines",
    response_model=DetailResponse,
)
def source_lines(
    election_key: str = Path(pattern=ELECTION),
    source_hash: str = Path(pattern=HASH),
    collection_id: str = Query(pattern=HASH),
    start: int = Query(1, ge=1, le=2147483647),
    limit: int = Query(50, ge=1, le=100),
    db: Session = Depends(get_db),
):
    return DetailResponse(
        data=reads.source_lines(
            db,
            election_key=election_key,
            collection_id=collection_id,
            source_hash=source_hash,
            start=start,
            limit=limit,
        )
    )
