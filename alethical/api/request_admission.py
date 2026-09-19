"""Keep database callers from occupying the workers needed to finish responses."""

from starlette.responses import JSONResponse
from starlette.types import ASGIApp, Receive, Scope, Send

from alethical.api.problems import problem_payload

# The shared engine allows 5 pooled connections plus 10 overflow connections.
# Keep ordinary requests below that capacity and well below AnyIO's 40 workers:
# synchronous response validation needs a worker before get_db can close a
# request's connection. Letting waiting database calls take every worker creates
# a cycle even when the database has already finished every query:
# https://github.com/alethical-org/alethical/issues/2309
# The remaining 3 connections also leave room for a request's separate admin read.
MAX_IN_FLIGHT_REQUESTS = 12


class RequestAdmissionMiddleware:
    """Reject excess work before it enters the shared synchronous worker pool.

    This must wrap the whole ASGI invocation, including dependency cleanup and
    streamed bodies. Releasing after call_next returns response headers would
    admit another database caller while the previous connection is still held.
    """

    def __init__(self, app: ASGIApp, max_in_flight: int) -> None:
        self.app = app
        self.max_in_flight = max_in_flight
        self.in_flight = 0

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if (
            scope["type"] != "http"
            or scope["method"] == "OPTIONS"
            or not (
                scope["path"] == "/readyz"
                or scope["path"] == "/api/v1"
                or scope["path"].startswith("/api/v1/")
                or scope["path"] == "/internal"
                or scope["path"].startswith("/internal/")
            )
        ):
            await self.app(scope, receive, send)
            return

        if self.in_flight >= self.max_in_flight:
            response = JSONResponse(
                status_code=503,
                content=problem_payload(
                    type_slug="service-busy",
                    title="Service busy",
                    status=503,
                    detail="The service is busy. Please try again in a moment.",
                    instance=scope["path"],
                ),
                headers={"Cache-Control": "no-store", "Retry-After": "1"},
            )
            await response(scope, receive, send)
            return

        # ASGI requests in this process share an event loop. No await separates
        # checking and taking a place, so another request cannot take it first.
        self.in_flight += 1
        try:
            await self.app(scope, receive, send)
        finally:
            self.in_flight -= 1
