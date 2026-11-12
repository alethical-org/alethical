"""Dated campaign expense reports behind Finance's shared access check."""

from typing import Annotated, Literal

from fastapi import APIRouter, Depends, Path, Query, Response
from sqlalchemy.orm import Session

from alethical.api.problems import problem_exception
from alethical.api.routers.election_finance_reads import ELECTION, HASH, VERSION
from alethical.api.services import election_expense_analytics as reads
from alethical.db.session import get_db

router = APIRouter()
PayeeId = Annotated[str, Query(pattern=HASH)]


def _filters(
    election_key: str = Path(pattern=ELECTION),
    snapshot_id: str | None = Query(None, pattern=HASH),
    version: str | None = Query(None, pattern=VERSION),
    race_id: str | None = Query(None, pattern=HASH),
    candidate_id: str | None = Query(
        None, min_length=1, max_length=64, pattern=r"^[^\x00]+$"
    ),
    party: Literal["R", "DFL", "NP", "other", "unknown"] | None = None,
    geography: Literal["MN", "out_of_state", "unknown"] | None = None,
    payee_query: str = Query("", max_length=200, pattern=r"^[^\x00]*$"),
    candidate_query: str = Query("", max_length=200, pattern=r"^[^\x00]*$"),
    report_keys: list[PayeeId] = Query(default=[], max_length=500),
    excluded_payee_ids: list[PayeeId] = Query(default=[], max_length=200),
):
    if candidate_id is not None and race_id is None:
        raise problem_exception(
            422, "Race Required", "Select an exact race with this candidate"
        )
    return dict(
        election_key=election_key,
        snapshot_id=snapshot_id,
        version=version,
        race_id=race_id,
        candidate_id=candidate_id,
        party=party,
        geography=geography,
        payee_query=payee_query,
        candidate_query=candidate_query,
        report_keys=report_keys,
        excluded_payee_ids=excluded_payee_ids,
    )


def _require_pinned(filters):
    if filters["version"] is None or filters["snapshot_id"] is None:
        raise problem_exception(
            422,
            "Version Required",
            "Use the snapshot and version returned by the first page",
        )


@router.get("/elections/{election_key}/analytics/expenses")
def report(
    filters: dict = Depends(_filters),
    limit: int = Query(50, ge=1, le=500),
    offset: int = Query(0, ge=0, le=2147483647),
    db: Session = Depends(get_db),
):
    if offset:
        _require_pinned(filters)
    return {"data": reads.report(db, **filters, limit=limit, offset=offset)}


@router.get("/elections/{election_key}/analytics/expenses/payees")
def payees(
    filters: dict = Depends(_filters),
    limit: int = Query(50, ge=1, le=500),
    offset: int = Query(0, ge=0, le=2147483647),
    db: Session = Depends(get_db),
):
    _require_pinned(filters)
    return {"data": reads.payees(db, **filters, limit=limit, offset=offset)}


@router.get("/elections/{election_key}/analytics/expenses/payments")
def payments(
    filters: dict = Depends(_filters),
    payee_id: str | None = Query(None, pattern=HASH),
    unnamed_report_key: str | None = Query(None, pattern=HASH),
    report_key: str | None = Query(None, pattern=HASH),
    authority: str | None = Query(
        None, min_length=1, max_length=160, pattern=r"^[^\x00-\x1f]+$"
    ),
    measure: str | None = Query(
        None, min_length=1, max_length=200, pattern=r"^[^\x00-\x1f]+$"
    ),
    limit: int = Query(50, ge=1, le=500),
    offset: int = Query(0, ge=0, le=2147483647),
    db: Session = Depends(get_db),
):
    _require_pinned(filters)
    return {
        "data": reads.payments(
            db,
            **filters,
            payee_id=payee_id,
            **{
                k: v
                for k, v in {
                    "unnamed_report_key": unnamed_report_key,
                    "report_key": report_key,
                    "authority": authority,
                    "measure": measure,
                }.items()
                if v is not None
            },
            limit=limit,
            offset=offset,
        )
    }


@router.get("/elections/{election_key}/analytics/expenses/export")
def export(
    filters: dict = Depends(_filters),
    format: Literal["json", "csv"] = "json",
    db: Session = Depends(get_db),
):
    """Export the complete filtered report, including source and coverage context.

    CSV uses plain columns with separate account, payee and payment amount
    families. Baseline and excluded payees remain explicit; source report totals
    and subsidy stay separate from itemized detail.
    """
    _require_pinned(filters)
    body, filename = reads.export(db, **filters, format=format)
    return Response(
        content=body,
        media_type="application/json" if format == "json" else "text/csv",
        headers={
            "Content-Disposition": f'attachment; filename="{filename}"',
            "X-Content-Type-Options": "nosniff",
        },
    )
