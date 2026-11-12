"""Election analytics retain Finance's authentication and private response policy."""

from datetime import date
from typing import Literal

from fastapi import APIRouter, Depends, Path, Query, Response
from sqlalchemy.orm import Session

from alethical.api.problems import problem_exception
from alethical.api.routers.election_finance_reads import ELECTION, HASH, VERSION
from alethical.api.services import election_analytics as reads
from alethical.db.session import get_db

router = APIRouter()
Metric = Literal[
    "direct_contributions",
    "other_receipts",
    "independent_For",
    "independent_Against",
    "independent_unknown",
]


def _filters(
    election_key: str = Path(pattern=ELECTION),
    snapshot_id: str | None = Query(None, pattern=HASH),
    version: str | None = Query(None, pattern=VERSION),
    start_date: date | None = None,
    end_date: date | None = None,
    race_id: str | None = Query(None, pattern=HASH),
    funder_id: str | None = Query(
        None, min_length=1, max_length=200, pattern=r"^[^\x00]+$"
    ),
    q: str = Query(
        "",
        max_length=200,
        pattern=r"^[^\x00]*$",
        description="Case-insensitive funder-name search; matching names never merge funder identities",
    ),
):
    return dict(
        election_key=election_key,
        snapshot_id=snapshot_id,
        version=version,
        start_date=start_date,
        end_date=end_date,
        race_id=race_id,
        funder_id=funder_id,
        q=q,
    )


def _require_pinned(filters):
    if filters["version"] is None or filters["snapshot_id"] is None:
        raise problem_exception(
            422,
            "Version Required",
            "Use the snapshot and version returned by the first page",
        )


@router.get("/elections/{election_key}/analytics/funders")
def funders(
    filters: dict = Depends(_filters),
    limit: int = Query(50, ge=1, le=100),
    offset: int = Query(0, ge=0, le=2147483647),
    db: Session = Depends(get_db),
):
    if offset:
        _require_pinned(filters)
    return {"data": reads.funders(db, **filters, limit=limit, offset=offset)}


@router.get("/elections/{election_key}/analytics/candidates")
def candidates(
    filters: dict = Depends(_filters),
    limit: int = Query(50, ge=1, le=100),
    offset: int = Query(0, ge=0, le=2147483647),
    db: Session = Depends(get_db),
):
    if offset:
        _require_pinned(filters)
    return {"data": reads.candidates(db, **filters, limit=limit, offset=offset)}


def _candidate_scope(filters, candidate_id):
    if candidate_id is not None and filters["race_id"] is None:
        raise problem_exception(
            422, "Race Required", "Select an exact race with this candidate"
        )


@router.get("/elections/{election_key}/analytics/records")
def records(
    filters: dict = Depends(_filters),
    candidate_id: str | None = Query(
        None, min_length=1, max_length=64, pattern=r"^[^\x00]+$"
    ),
    metric: Metric | None = None,
    resolution: str | None = Query(None, max_length=50, pattern=r"^[a-z_]+$"),
    limit: int = Query(50, ge=1, le=100),
    offset: int = Query(0, ge=0, le=2147483647),
    db: Session = Depends(get_db),
):
    _require_pinned(filters)
    _candidate_scope(filters, candidate_id)
    return {
        "data": reads.records(
            db,
            **filters,
            candidate_id=candidate_id,
            metric=metric,
            resolution=resolution,
            limit=limit,
            offset=offset,
        )
    }


@router.get("/elections/{election_key}/analytics/export")
def export(
    filters: dict = Depends(_filters),
    format: Literal["json", "csv"] = "json",
    candidate_id: str | None = Query(
        None, min_length=1, max_length=64, pattern=r"^[^\x00]+$"
    ),
    metric: Metric | None = None,
    resolution: str | None = Query(None, max_length=50, pattern=r"^[a-z_]+$"),
    db: Session = Depends(get_db),
):
    """Export selected evidence with complete filters and source versions.

    CSV uses labelled scalar cells and separate summary/payment amount columns.
    Every selected source row appears once as Payment, with source, candidate,
    account and outcome context in non-payment rows. JSON remains available for
    internal clients with its existing structured response.
    """
    _require_pinned(filters)
    _candidate_scope(filters, candidate_id)
    body, filename = reads.export(
        db,
        **filters,
        format=format,
        candidate_id=candidate_id,
        metric=metric,
        resolution=resolution,
    )
    return Response(
        content=body,
        media_type="application/json" if format == "json" else "text/csv",
        headers={
            "Content-Disposition": f'attachment; filename="{filename}"',
            "X-Content-Type-Options": "nosniff",
        },
    )


@router.get("/elections/{election_key}/analytics/sources/{dataset}")
def source_body(
    election_key: str = Path(pattern=ELECTION),
    dataset: Literal[
        "contributions", "expenditures", "independent_expenditures"
    ] = Path(),
    snapshot_id: str = Query(pattern=HASH),
    version: str = Query(pattern=VERSION),
    db: Session = Depends(get_db),
):
    body = reads.source_body(
        db,
        election_key=election_key,
        dataset=dataset,
        snapshot_id=snapshot_id,
        version=version,
    )
    return Response(
        content=body,
        media_type="application/octet-stream",
        headers={
            "Content-Disposition": f'attachment; filename="{dataset}-{version}.csv"',
            "X-Content-Type-Options": "nosniff",
        },
    )
