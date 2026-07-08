from __future__ import annotations

import os

from fastapi import FastAPI, HTTPException
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from starlette.exceptions import HTTPException as StarletteHTTPException

from alethical.api.problems import http_exception_handler, validation_exception_handler
from alethical.api.routers.internal import router as internal_router
from alethical.api.routers.me import router as me_router
from alethical.api.routers.public import router as public_router
from alethical.logging import configure_logging


def create_app() -> FastAPI:
    configure_logging()
    app = FastAPI(title="Alethical API", version="1.0.0")
    cors_origins = os.environ.get(
        "ALETHICAL_CORS_ORIGINS",
        "http://localhost:19006,http://127.0.0.1:19006,http://localhost:8081,http://127.0.0.1:8081",
    )
    app.add_middleware(
        CORSMiddleware,
        allow_origins=[
            origin.strip() for origin in cors_origins.split(",") if origin.strip()
        ],
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )
    app.add_exception_handler(HTTPException, http_exception_handler)
    app.add_exception_handler(StarletteHTTPException, http_exception_handler)
    app.add_exception_handler(RequestValidationError, validation_exception_handler)

    @app.get("/healthz")
    def healthz():
        return {"status": "ok"}

    @app.get("/readyz")
    def readyz():
        return {"status": "ready"}

    app.include_router(public_router, prefix="/api/v1", tags=["public"])
    app.include_router(me_router, prefix="/api/v1", tags=["me"])
    app.include_router(internal_router, prefix="/internal/v1", tags=["internal"])
    return app
