from __future__ import annotations

from fastapi import APIRouter, Depends

from alethical.api.auth import get_optional_current_user
from alethical.api.problems import problem_exception
from alethical.api.schemas import (
    AskClassificationPayload,
    AskClassifyRequest,
    DetailResponse,
)
from alethical.api.services.ask_router import classify_query

router = APIRouter()


@router.post("/ask/classify", response_model=DetailResponse, status_code=200)
def classify_ask_query(
    request: AskClassifyRequest,
    _current_user=Depends(get_optional_current_user),
):
    """Identify which Ask view/intent a free-form query should route to."""
    content = request.content.strip()
    if not content:
        raise problem_exception(400, "Bad Request", "content must not be empty")

    result = classify_query(content)
    return DetailResponse(
        data=AskClassificationPayload(
            intent=result.intent.value,
            auth_required=result.auth_required,
            source=result.source,
            confidence=result.confidence,
        ),
        links={"self": "/api/v1/ask/classify"},
    )
