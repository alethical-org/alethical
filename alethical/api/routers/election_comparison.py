"""Election evidence reads, mounted inside Finance's access boundary."""

from fastapi import APIRouter, Depends, Path, Query
from fastapi.responses import Response
from sqlalchemy.orm import Session

from alethical.api.schemas import DetailResponse
from alethical.api.services import election_comparison_reads as reads
from alethical.db.session import get_db

router = APIRouter()
HASH = r"^[0-9a-f]{64}$"
ELECTION = r"^mn-\d{4}-\d{2}-\d{2}-(general|primary|special)$"
TEXT = r"^[^\x00]*$"


@router.get("/elections", response_model=DetailResponse)
def elections(db: Session = Depends(get_db)):
    return DetailResponse(data=reads.elections(db))


@router.get("/elections/{election_key}/races", response_model=DetailResponse)
def races(
    election_key: str = Path(pattern=ELECTION),
    snapshot_id: str | None = Query(None, pattern=HASH),
    q: str = Query("", max_length=200, pattern=TEXT),
    limit: int = Query(50, ge=1, le=100),
    offset: int = Query(0, ge=0, le=2147483647),
    db: Session = Depends(get_db),
):
    return DetailResponse(
        data=reads.races(
            db,
            election_key=election_key,
            snapshot_id=snapshot_id,
            q=q,
            limit=limit,
            offset=offset,
        )
    )


@router.get("/elections/{election_key}/races/{race_id}", response_model=DetailResponse)
def race_detail(
    election_key: str = Path(pattern=ELECTION),
    race_id: str = Path(pattern=HASH),
    snapshot_id: str | None = Query(None, pattern=HASH),
    db: Session = Depends(get_db),
):
    return DetailResponse(
        data=reads.race_detail(
            db, election_key=election_key, race_id=race_id, snapshot_id=snapshot_id
        )
    )


@router.get(
    "/elections/{election_key}/races/{race_id}/precincts", response_model=DetailResponse
)
def precincts(
    election_key: str = Path(pattern=ELECTION),
    race_id: str = Path(pattern=HASH),
    snapshot_id: str = Query(pattern=HASH),
    q: str = Query("", max_length=200, pattern=TEXT),
    county: str | None = Query(None, pattern=r"^\d{2}$"),
    limit: int = Query(50, ge=1, le=100),
    offset: int = Query(0, ge=0, le=2147483647),
    db: Session = Depends(get_db),
):
    return DetailResponse(
        data=reads.precincts(
            db,
            election_key=election_key,
            race_id=race_id,
            snapshot_id=snapshot_id,
            q=q,
            county=county,
            limit=limit,
            offset=offset,
        )
    )


@router.get("/elections/{election_key}/sources/{source_hash}")
def source_download(
    election_key: str = Path(pattern=ELECTION),
    source_hash: str = Path(pattern=HASH),
    snapshot_id: str = Query(pattern=HASH),
    db: Session = Depends(get_db),
):
    body, _ = reads.source_body(
        db, election_key=election_key, snapshot_id=snapshot_id, source_hash=source_hash
    )
    return Response(
        body,
        media_type="application/octet-stream",
        headers={
            "Content-Disposition": f'attachment; filename="election-source-{source_hash}.txt"',
            "X-Content-Type-Options": "nosniff",
        },
    )


@router.get(
    "/elections/{election_key}/sources/{source_hash}/lines",
    response_model=DetailResponse,
)
def source_lines(
    election_key: str = Path(pattern=ELECTION),
    source_hash: str = Path(pattern=HASH),
    snapshot_id: str = Query(pattern=HASH),
    start: int = Query(1, ge=1, le=2147483647),
    limit: int = Query(50, ge=1, le=100),
    db: Session = Depends(get_db),
):
    return DetailResponse(
        data=reads.source_lines(
            db,
            election_key=election_key,
            snapshot_id=snapshot_id,
            source_hash=source_hash,
            start=start,
            limit=limit,
        )
    )
