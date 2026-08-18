from __future__ import annotations

from fastapi import HTTPException, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse

from alethical.monitoring import capture_operational_error, error_was_reported


class OperationalHTTPError(RuntimeError):
    """A safe stand-in for a handled server error that has no exception cause."""


def _route_template(request: Request) -> str:
    route = request.scope.get("route")
    path = getattr(route, "path", None)
    return path if isinstance(path, str) else "unmatched"


def _failure_area(request: Request) -> str:
    named = getattr(request.state, "failure_area", None)
    if isinstance(named, str):
        return named
    return "chat" if "/chat" in _route_template(request) else "server"


def _report_server_error(request: Request, error: Exception, status: int) -> None:
    cause = error.__cause__ if isinstance(error.__cause__, Exception) else None
    if cause is not None and error_was_reported(cause):
        return
    if cause is not None:
        reportable = cause
    elif isinstance(error, HTTPException):
        reportable = OperationalHTTPError(f"HTTP {status}")
    else:
        reportable = error
    capture_operational_error(
        reportable,
        area=_failure_area(request),
        operation=f"http-{status}",
        tags={
            "http.method": request.method,
            "http.route": _route_template(request),
            "http.status_code": str(status),
        },
    )


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
    status: int,
    title: str,
    detail: str,
    *,
    type_slug: str | None = None,
    headers: dict[str, str] | None = None,
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
        headers=headers,
    )


async def http_exception_handler(request: Request, exc: HTTPException):
    if exc.status_code >= 500:
        _report_server_error(request, exc, exc.status_code)
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
    return JSONResponse(
        status_code=exc.status_code, content=payload, headers=exc.headers
    )


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


async def unexpected_exception_handler(request: Request, exc: Exception):
    _report_server_error(request, exc, 500)
    payload = problem_payload(
        type_slug="unexpected-error",
        title="Unexpected Error",
        status=500,
        detail="The service hit an unexpected error.",
        instance=str(request.url.path),
    )
    return JSONResponse(status_code=500, content=payload)
