"""Standalone current-proof writers cannot overlap a collection/check lease."""

import importlib.util
from pathlib import Path

import pytest


@pytest.mark.parametrize("kind", ["split", "spending"])
def test_standalone_checker_takes_writer_lease_before_opening_store_or_reading_documents(
    kind, monkeypatch
):
    path = (
        Path(__file__).resolve().parents[2]
        / "scripts"
        / f"check_campaign_finance_stated_{kind}.py"
    )
    spec = importlib.util.spec_from_file_location(f"standalone_{kind}", path)
    script = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(script)
    events = []
    monkeypatch.setattr(script, "create_engine", lambda *a, **k: object())
    monkeypatch.setattr(
        script, "normalize_database_url", lambda value: "postgresql://fake"
    )
    monkeypatch.setattr(
        script, "database_url_for_target", lambda value: "postgresql://fake"
    )
    monkeypatch.setattr(
        script,
        "hold_full_run_lease_until_exit",
        lambda *a, **k: events.append("lease") or False,
    )

    def forbidden(*args, **kwargs):
        raise AssertionError("busy checker must not open storage or start a check")

    monkeypatch.setattr(script, "raw_file_store_from_env", forbidden)
    monkeypatch.setattr(script, "Session", forbidden)
    monkeypatch.setattr("sys.argv", [str(path)])
    assert script.main() == 1
    assert events == ["lease"]


@pytest.mark.parametrize("kind", ["split", "spending"])
def test_standalone_dry_check_never_takes_the_writer_lease(kind, monkeypatch):
    path = (
        Path(__file__).resolve().parents[2]
        / "scripts"
        / f"check_campaign_finance_stated_{kind}.py"
    )
    spec = importlib.util.spec_from_file_location(f"dry_{kind}", path)
    script = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(script)
    monkeypatch.setattr(script, "create_engine", lambda *a, **k: object())
    monkeypatch.setattr(
        script, "normalize_database_url", lambda value: "postgresql://fake"
    )
    monkeypatch.setattr(
        script, "database_url_for_target", lambda value: "postgresql://fake"
    )

    def forbidden(*args, **kwargs):
        raise AssertionError("dry checks cannot acquire a writer lease")

    monkeypatch.setattr(script, "hold_full_run_lease_until_exit", forbidden)

    class Context:
        def __enter__(self):
            return object()

        def __exit__(self, *args):
            return False

    monkeypatch.setattr(script, "Session", lambda engine: Context())
    monkeypatch.setattr(script, "raw_file_store_from_env", lambda: object())

    def check(*args, **kwargs):
        assert kwargs["write"] is False
        return object()

    monkeypatch.setattr(script, f"run_stated_{kind}_check", check)
    monkeypatch.setattr(script, "summary", lambda run: "dry test")
    monkeypatch.setattr("sys.argv", [str(path), "--dry-run"])
    assert script.main() == 0
