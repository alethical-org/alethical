"""Machine writes have no read permission; people read through the existing admin guard."""

import os
import secrets

from fastapi import APIRouter, Depends, Header, Request
from fastapi.responses import JSONResponse
from sqlalchemy.orm import Session

from alethical.api.problems import problem_exception
from alethical.api.routers.admin import require_admin
from alethical.api.services import search_measurements as service
from alethical.db.session import get_db

router = APIRouter()
PRIVATE_HEADERS = {
    "Cache-Control": "private, no-store",
    "X-Robots-Tag": "noindex, nofollow",
    "Referrer-Policy": "no-referrer",
    "Vary": "Authorization, X-Search-Measurement-Token",
}


def require_measurement_writer(
    x_search_measurement_token: str | None = Header(default=None),
):
    expected = os.environ.get("SEARCH_MEASUREMENT_WRITE_TOKEN", "")
    if (
        len(expected) < 32
        or not x_search_measurement_token
        or len(x_search_measurement_token) > 512
        or not secrets.compare_digest(
            x_search_measurement_token.encode(), expected.encode()
        )
    ):
        raise problem_exception(
            401,
            "Unauthorized",
            "Measurement writer access required.",
            headers=PRIVATE_HEADERS,
        )


@router.post(
    "/internal/v1/search-measurements",
    dependencies=[Depends(require_measurement_writer)],
)
async def write_measurement(request: Request, db: Session = Depends(get_db)):
    body = bytearray()
    async for chunk in request.stream():
        body.extend(chunk)
        if len(body) > service.MAX_PAYLOAD_BYTES + 2048:
            return JSONResponse(
                {"error": "Measurement is too large."},
                status_code=413,
                headers=PRIVATE_HEADERS,
            )
    try:
        item = service.MeasurementInput.model_validate_json(body)
        service.store(db, item)
        db.commit()
    except ValueError:
        db.rollback()
        # Pydantic's normal error detail can echo a private row. Return only fixed wording.
        return JSONResponse(
            {"error": "Invalid measurement."}, status_code=400, headers=PRIVATE_HEADERS
        )
    except Exception:
        db.rollback()
        return JSONResponse(
            {"error": "Measurement storage is unavailable."},
            status_code=503,
            headers=PRIVATE_HEADERS,
        )
    return JSONResponse({"stored": True}, headers=PRIVATE_HEADERS)


@router.get("/api/v1/admin/search-measurements", dependencies=[Depends(require_admin)])
def private_report(db: Session = Depends(get_db)):
    return JSONResponse(service.report(db), headers=PRIVATE_HEADERS)


@router.get(
    "/api/v1/admin/search-measurements/{provider}/{view}",
    dependencies=[Depends(require_admin)],
)
def private_export(
    provider: service.Provider, view: service.View, db: Session = Depends(get_db)
):
    result = service.latest_private_export(db, provider, view)
    if result is None:
        return JSONResponse(
            {"error": "No retained successful export is available."},
            status_code=404,
            headers=PRIVATE_HEADERS,
        )
    return JSONResponse(result, headers=PRIVATE_HEADERS)
