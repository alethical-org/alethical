"""Manual collectors share the scheduled campaign writer lease."""

from contextlib import contextmanager
import importlib

import pytest


@pytest.mark.parametrize("kind", ["notices", "statements"])
@pytest.mark.parametrize("held", [False, True])
def test_collector_defers_without_reading_or_writing(monkeypatch, kind, held):
    module = importlib.import_module(f"scripts.collect_campaign_finance_{kind}")
    monkeypatch.setattr(
        "sys.argv", ["collector", "--database-url", "postgresql://unused"]
    )
    monkeypatch.setattr(module, "create_engine", lambda *a, **k: object())
    events = []

    @contextmanager
    def lease(*a, **k):
        events.append("acquire")
        try:
            yield held
        finally:
            events.append("release")

    monkeypatch.setattr(module, "hold_full_run_lease", lease)
    monkeypatch.setattr(module, "_collect", lambda *a: events.append("collect") or 0)
    monkeypatch.setattr(module, "record_stage", lambda *a, **k: events.append(a))
    assert module.main() == (0 if held else 76)
    assert events == (
        ["acquire", "collect", "release"]
        if held
        else ["acquire", (kind, "skipped"), "release"]
    )


@pytest.mark.parametrize("kind", ["notices", "statements"])
def test_readonly_collector_needs_no_writer_lease(monkeypatch, kind):
    module = importlib.import_module(f"scripts.collect_campaign_finance_{kind}")
    monkeypatch.setattr(
        "sys.argv", ["collector", "--database-url", "postgresql://unused", "--dry-run"]
    )
    monkeypatch.setattr(module, "create_engine", lambda *a, **k: object())
    monkeypatch.setattr(
        module,
        "hold_full_run_lease",
        lambda *a, **k: pytest.fail("dry run acquired writer lease"),
    )
    monkeypatch.setattr(
        module, "_collect", lambda args, engine: 0 if args.dry_run else 1
    )
    assert module.main() == 0
