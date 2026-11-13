"""Source-wide independent-spending reads inside the Finance access boundary."""

from typing import Literal
from uuid import UUID

from fastapi import APIRouter, Depends, Path, Query, Response
from sqlalchemy.orm import Session

from alethical.api.schemas import DetailResponse
from alethical.api.services import election_outside_spending as reads
from alethical.db.session import get_db

router = APIRouter()
ELECTION = r"^mn-\d{4}-\d{2}-\d{2}-(general|primary|special)$"
HASH = r"^[a-f0-9]{64}$"
VERSION = r"^[a-f0-9]{16}$"
TEXT = r"^[^\x00]*$"


@router.get("/elections/{election_key}/outside-spending/source")
def source_body(
    election_key: str = Path(pattern=ELECTION),
    election_snapshot_id: str = Query(pattern=HASH),
    version: str = Query(pattern=VERSION),
    release_id: UUID = Query(),
    source_hash: str | None = Query(None, pattern=HASH),
    db: Session = Depends(get_db),
):
    body = reads.source_body(
        db,
        election_key=election_key,
        election_snapshot_id=election_snapshot_id,
        version=version,
        release_id=release_id,
        source_hash=source_hash,
    )
    return Response(
        content=body,
        media_type="application/octet-stream",
        headers={
            "Content-Disposition": 'attachment; filename="independent-spending.csv"',
            "X-Content-Type-Options": "nosniff",
        },
    )


@router.get("/elections/{election_key}/outside-spending", response_model=DetailResponse)
def summary(
    election_key: str = Path(pattern=ELECTION),
    election_snapshot_id: str | None = Query(None, pattern=HASH),
    version: str | None = Query(None, pattern=VERSION),
    release_id: UUID | None = None,
    spender_type: Literal["PCF", "PTU", "other"] | None = None,
    direction: Literal["For", "Against", "unknown"] | None = None,
    spender_registration: str | None = Query(None, max_length=64, pattern=TEXT),
    target_registration: str | None = Query(None, max_length=64, pattern=TEXT),
    db: Session = Depends(get_db),
):
    return DetailResponse(
        data=reads.summary(
            db,
            election_key=election_key,
            election_snapshot_id=election_snapshot_id,
            version=version,
            release_id=release_id,
            spender_type=spender_type,
            direction=direction,
            spender_registration=spender_registration,
            target_registration=target_registration,
        )
    )


@router.get(
    "/elections/{election_key}/outside-spending/records", response_model=DetailResponse
)
def records(
    election_key: str = Path(pattern=ELECTION),
    election_snapshot_id: str | None = Query(None, pattern=HASH),
    version: str = Query(pattern=VERSION),
    release_id: UUID = Query(),
    scope: Literal["year", "missing_year"] = "year",
    spender_type: Literal["PCF", "PTU", "other"] | None = None,
    direction: Literal["For", "Against", "unknown"] | None = None,
    spender_registration: str | None = Query(None, max_length=64, pattern=TEXT),
    target_registration: str | None = Query(None, max_length=64, pattern=TEXT),
    limit: int = Query(50, ge=1, le=100),
    offset: int = Query(0, ge=0, le=2147483647),
    db: Session = Depends(get_db),
):
    return DetailResponse(
        data=reads.records(
            db,
            election_key=election_key,
            election_snapshot_id=election_snapshot_id,
            version=version,
            release_id=release_id,
            scope=scope,
            spender_type=spender_type,
            direction=direction,
            spender_registration=spender_registration,
            target_registration=target_registration,
            limit=limit,
            offset=offset,
        )
    )
