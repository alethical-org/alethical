from __future__ import annotations

from fastapi import HTTPException, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse


def problem_payload(
    *,
    type_slug: str,
    title: str,
    status: int,
    detail: str,
    instance: str,
    errors: list[dict] | None = None,
) -> dict:
    payload = {
        "type": f"https://api.alethical.com/problems/{type_slug}",
        "title": title,
        "status": status,
        "detail": detail,
        "instance": instance,
    }
    if errors:
        payload["errors"] = errors
    return payload


def problem_exception(
    status: int, title: str, detail: str, *, type_slug: str | None = None
) -> HTTPException:
    return HTTPException(
        status_code=status,
        detail=problem_payload(
            type_slug=type_slug or title.lower().replace(" ", "-"),
            title=title,
            status=status,
            detail=detail,
            instance="",
        ),
    )


async def http_exception_handler(request: Request, exc: HTTPException):
    detail = exc.detail
    if isinstance(detail, dict) and {"type", "title", "status", "detail"}.issubset(
        detail.keys()
    ):
        payload = {**detail, "instance": str(request.url.path)}
    else:
        if exc.status_code == 401:
            title = "Unauthorized"
        elif exc.status_code == 404:
            title = "Not Found"
        else:
            title = "HTTP Error"
        payload = problem_payload(
            type_slug=title.lower().replace(" ", "-"),
            title=title,
            status=exc.status_code,
            detail=str(detail),
            instance=str(request.url.path),
        )
    return JSONResponse(status_code=exc.status_code, content=payload)


async def validation_exception_handler(request: Request, exc: RequestValidationError):
    errors = [
        {"field": ".".join(map(str, error["loc"])), "message": error["msg"]}
        for error in exc.errors()
    ]
    payload = problem_payload(
        type_slug="validation-error",
        title="Validation Error",
        status=422,
        detail="Request validation failed",
        instance=str(request.url.path),
        errors=errors,
    )
    return JSONResponse(status_code=422, content=payload)
