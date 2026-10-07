"""Run only the bounded dispatcher beside the API, never source collectors."""

from __future__ import annotations
import asyncio
from contextlib import asynccontextmanager
import logging
import threading

from alethical.api.services.comment_email import comment_email_lifespan
from alethical.api.services.source_refresh_dispatch import dispatch_due
from alethical.db.session import get_session_factory

logger = logging.getLogger(__name__)


@asynccontextmanager
async def application_lifespan(app):
    stop = threading.Event()
    wake = asyncio.Event()

    async def worker():
        while not stop.is_set():
            try:
                await asyncio.to_thread(
                    dispatch_due, get_session_factory(), stop_event=stop
                )
            except Exception:
                logger.error(
                    "Public-record dispatch failed; saved deadlines remain due"
                )
            try:
                await asyncio.wait_for(wake.wait(), timeout=60)
            except TimeoutError:
                pass

    async with comment_email_lifespan(app):
        task = asyncio.create_task(worker())
        try:
            yield
        finally:
            stop.set()
            wake.set()
            await task
