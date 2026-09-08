from __future__ import annotations

import os

from fastapi import FastAPI, HTTPException, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from starlette.exceptions import HTTPException as StarletteHTTPException
from starlette.responses import JSONResponse

from alethical.api.problems import (
    http_exception_handler,
    unexpected_exception_handler,
    validation_exception_handler,
)
from alethical.api.rate_limit import (
    DEFAULT_ADDRESS_SUGGESTIONS_PER_MINUTE,
    DEFAULT_ASK_PER_MINUTE,
    DEFAULT_CONTACT_PER_MINUTE,
    DEFAULT_LOOKUP_PER_MINUTE,
    DEFAULT_PENDING_ACTION_PER_MINUTE,
    limiter_from_env,
)
from alethical.api.routers.admin import router as admin_router
from alethical.api.routers.ask import router as ask_router
from alethical.api.routers.contact import router as contact_router
from alethical.api.routers.internal import router as internal_router
from alethical.api.routers.me import router as me_router
from alethical.api.routers.pending_actions import router as pending_actions_router
from alethical.api.routers.public import public_cache_control_for_path
from alethical.api.routers.public import router as public_router
from alethical.api.routers.site_metrics import router as site_metrics_router
from alethical.api.readiness import database_schema_is_ready
from alethical.api.services.contact import log_contact_delivery_readiness
from alethical.logging import configure_logging


def create_app() -> FastAPI:
    configure_logging()
    log_contact_delivery_readiness()
    app = FastAPI(title="Alethical API", version="1.0.0")
    cors_origins = os.environ.get(
        "ALETHICAL_CORS_ORIGINS",
        "http://localhost:19006,http://127.0.0.1:19006,http://localhost:8081,http://127.0.0.1:8081",
    )
    allowed_origins = [
        origin.strip() for origin in cors_origins.split(",") if origin.strip()
    ]
    app.add_middleware(
        CORSMiddleware,
        allow_origins=allowed_origins,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
        # `Age` so the app can learn what the shared caches added to an answer.
        # Every hop between us and a reader raises it by the time it held the
        # response, and it is the only signal that reports that: a body field
        # cannot, because a cache replays a body unchanged. Without this the
        # browser is refused the header and has to assume the worst the window
        # allows, which is safe and needlessly pessimistic
        # (`apps/frontend/src/lib/currentClaimFreshness.ts`, issue 2023).
        expose_headers=["Age"],
    )

    @app.middleware("http")
    async def let_our_own_pages_read_their_request_timings(request: Request, call_next):
        """Let a page on our own site see what a request to this service spent its
        time on, rather than only how long it took in total.

        A browser hides a cross-origin request's connection, server wait and
        download from the page that made it, and reports its size as 0, unless the
        answering service says otherwise with this header. The site and this
        service are different addresses, so every measurement of a page load
        stopped at 1 number for the data request and could not say which part of it
        was slow (#2039). On `/bills` that was a 490 ms figure nobody could split.

        The header names an exact origin, so it echoes the asking origin only when
        that origin is already on the list this service accepts requests from, and
        says nothing to anybody else. It exposes timings of our own answers and no
        reader data: a page can already time its own requests end to end, and this
        only breaks that total into its parts.
        """
        response = await call_next(request)
        origin = request.headers.get("origin")
        if origin and origin in allowed_origins:
            response.headers["Timing-Allow-Origin"] = origin
        return response

    @app.middleware("http")
    async def default_public_cache(request: Request, call_next):
        """Stamp a shared-cacheable Cache-Control on anonymous public GET reads
        that don't set their own, so the whole /api/v1 read surface is
        explicitly cacheable for the CDN (docs/operations/api-cdn-setup.md) rather than
        relying on the edge's default guess. Endpoints that vary by user
        (bills/bill_detail with tracking) set their own header first and win; a
        request carrying Authorization (any /me route, authed tracking) is never
        stamped, so no per-user response can be edge-cached.

        Which window a read gets is decided from a named list of paths, never
        from the shape of the address: a route not on the list gets the short
        window, including a brand-new one nobody has classified yet. The list,
        the 2 windows, and the test that separates a dated record from a claim
        about who holds office right now all live in
        alethical/api/routers/public.py."""
        response = await call_next(request)
        if request.url.path.startswith("/api/v1/admin/"):
            response.headers["Cache-Control"] = "private, no-store"
            response.headers["Vary"] = ", ".join(
                filter(None, [response.headers.get("Vary"), "Authorization"])
            )
            response.headers["X-Robots-Tag"] = "noindex, nofollow"
            return response
        if (
            request.method == "GET"
            and response.status_code == 200
            and request.url.path.startswith("/api/v1/")
            and "authorization" not in request.headers
            and "cache-control" not in response.headers
        ):
            response.headers["Cache-Control"] = public_cache_control_for_path(
                request.url.path
            )
        return response

    app.add_exception_handler(HTTPException, http_exception_handler)
    app.add_exception_handler(StarletteHTTPException, http_exception_handler)
    app.add_exception_handler(RequestValidationError, validation_exception_handler)
    app.add_exception_handler(Exception, unexpected_exception_handler)

    # Per-endpoint rate limiters for the paid/third-party call paths (#98).
    # Held on app.state so each app (and each test) gets isolated state.
    app.state.ask_limiter = limiter_from_env(
        "ALETHICAL_ASK_RATE_PER_MIN", DEFAULT_ASK_PER_MINUTE
    )
    app.state.lookup_limiter = limiter_from_env(
        "ALETHICAL_LOOKUP_RATE_PER_MIN", DEFAULT_LOOKUP_PER_MINUTE
    )
    app.state.address_suggestion_limiter = limiter_from_env(
        "ALETHICAL_ADDRESS_SUGGESTION_RATE_PER_MIN",
        DEFAULT_ADDRESS_SUGGESTIONS_PER_MINUTE,
    )
    app.state.contact_limiter = limiter_from_env(
        "ALETHICAL_CONTACT_RATE_PER_MIN", DEFAULT_CONTACT_PER_MINUTE
    )
    app.state.pending_action_limiter = limiter_from_env(
        "ALETHICAL_PENDING_ACTION_RATE_PER_MIN",
        DEFAULT_PENDING_ACTION_PER_MINUTE,
    )

    @app.get("/healthz")
    def healthz():
        return {"status": "ok"}

    @app.get("/readyz", response_model=None)
    def readyz() -> JSONResponse:
        if not database_schema_is_ready():
            return JSONResponse(status_code=503, content={"status": "not_ready"})
        return JSONResponse(content={"status": "ready"})

    app.include_router(admin_router, prefix="/api/v1", tags=["admin"])
    app.include_router(public_router, prefix="/api/v1", tags=["public"])
    app.include_router(site_metrics_router, prefix="/api/v1", tags=["site-metrics"])
    app.include_router(ask_router, prefix="/api/v1", tags=["ask"])
    app.include_router(contact_router, prefix="/api/v1", tags=["contact"])
    app.include_router(me_router, prefix="/api/v1", tags=["me"])
    app.include_router(
        pending_actions_router, prefix="/api/v1", tags=["pending-actions"]
    )
    app.include_router(internal_router, prefix="/internal/v1", tags=["internal"])
    return app
