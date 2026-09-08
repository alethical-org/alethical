"""Private aggregate report; source failures never turn into plausible zeroes."""

import logging
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, Query
from fastapi.responses import JSONResponse
from sqlalchemy.orm import Session

from alethical.api.routers.admin import require_admin
from alethical.api.services.account_signup_metrics import aggregate_account_signups
from alethical.api.services.leadership_metrics import leadership_metrics
from alethical.db.session import get_db

router = APIRouter()
logger = logging.getLogger(__name__)


@router.get("/admin/site-metrics", dependencies=[Depends(require_admin)])
def private_site_metrics(
    version: int = Query(default=1, ge=1, le=2), db: Session = Depends(get_db)
) -> JSONResponse:
    # Import only when called, avoiding router registration cycles.
    from alethical.api.routers.site_metrics import site_metric_data

    now = datetime.now(timezone.utc)
    result: dict = {"asOf": now.isoformat(), "errors": {}}
    sources = {
        "operations": leadership_metrics,
        "activity": site_metric_data,
        "accounts": aggregate_account_signups,
    }
    for name, source in sources.items():
        try:
            # A failed SELECT must not poison another source's transaction.
            # These sessions do not inherit pending changes from the access check.
            with Session(db.get_bind(), autoflush=False) as read:
                result[name] = source(read, now=now)
            result["errors"][name] = None
        except Exception as exc:
            logger.warning(
                "Leadership measurement %s unavailable: %s", name, type(exc).__name__
            )
            result[name] = None
            result["errors"][name] = "This measurement is temporarily unavailable."
    # Older open browser bundles validate exact keys. Keep their report readable
    # while the new screen explicitly requests the additional current-seat count.
    if version == 1 and result["operations"] is not None:
        result["operations"]["corpus"].pop("current_legislators", None)
    return JSONResponse(result, headers={"Cache-Control": "private, no-store"})
