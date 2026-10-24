"""Source dispatch composes with every existing application lifecycle."""

from contextlib import asynccontextmanager
from types import SimpleNamespace
import threading

import pytest

from alethical.api import main
from alethical.api.services import source_refresh_lifespan as source


@pytest.mark.asyncio
async def test_all_application_contexts_and_address_copy_survive_composition(
    monkeypatch,
):
    events = []

    def context(name):
        @asynccontextmanager
        async def run(app):
            events.append(name + ":start")
            try:
                yield
            finally:
                events.append(name + ":stop")

        return run

    monkeypatch.setattr(main, "comment_email_lifespan", context("comments"))
    monkeypatch.setattr(main, "candidate_claim_email_lifespan", context("claims"))
    monkeypatch.setattr(main, "source_refresh_lifespan", context("sources"))
    monkeypatch.setattr(main, "log_capacity", lambda *a: None)
    monkeypatch.setattr(
        main,
        "get_address_suggestion_index",
        lambda: SimpleNamespace(
            start=lambda: events.append("address:start"),
            stop=lambda: events.append("address:stop"),
        ),
    )
    async with main.email_lifespan(None):
        assert events == [
            "address:start",
            "comments:start",
            "claims:start",
            "sources:start",
        ]
    assert events[-4:] == [
        "sources:stop",
        "claims:stop",
        "comments:stop",
        "address:stop",
    ]


@pytest.mark.asyncio
async def test_dispatch_shutdown_waits_for_its_owned_thread(monkeypatch):
    import asyncio

    started = threading.Event()
    finished = threading.Event()

    def dispatch(factory, *, stop_event):
        started.set()
        assert stop_event.wait(timeout=5)
        finished.set()

    monkeypatch.setattr(source, "dispatch_due", dispatch)
    async with source.source_refresh_lifespan(None):
        assert await asyncio.to_thread(started.wait, 5)
    assert finished.is_set()
