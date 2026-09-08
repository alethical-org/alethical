"""Public counts from signup records, independent of product-action collection."""

import logging

from fastapi import APIRouter, Depends
from fastapi.responses import JSONResponse
from sqlalchemy.orm import Session

from alethical.api.services.account_signup_metrics import aggregate_account_signups
from alethical.db.session import get_db

router = APIRouter()
logger = logging.getLogger(__name__)


@router.get("/site-metrics/accounts")
def account_signup_totals(db: Session = Depends(get_db)) -> JSONResponse:
    try:
        result = aggregate_account_signups(db)
    except Exception as exc:
        # Never log SQL, account records, tokens, or provider response bodies.
        logger.warning("Signup measurement unavailable: %s", type(exc).__name__)
        return JSONResponse(
            {"error": "Account creation totals are temporarily unavailable."},
            status_code=503,
            headers={"Cache-Control": "no-store"},
        )
    return JSONResponse(
        result,
        headers={
            "Cache-Control": "public, max-age=0, s-maxage=300, stale-while-revalidate=60"
        },
    )
