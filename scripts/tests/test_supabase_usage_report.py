from datetime import date
import importlib.util
import json
from pathlib import Path

import pytest

SPEC = importlib.util.spec_from_file_location(
    "supabase_usage_report", Path(__file__).parents[1] / "supabase_usage_report.py"
)
assert SPEC and SPEC.loader
usage = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(usage)
GB = usage.GB


def reading(**changes):
    return {
        "schema_version": 1,
        "organization": "example",
        "source": "Supabase usage dashboard, complete daily reading",
        "cycle_start": "2026-10-29",
        "cycle_end": "2026-11-29",
        "measured_through": "2026-11-16",
        "uncached_egress_bytes": 108 * GB,
        **changes,
    }


def test_cycle_forecast_and_separate_cached_meter():
    result = usage.forecast(
        reading(cached_egress_bytes=200 * GB), today=date(2026, 11, 16)
    )
    assert result["pace_gb_per_day"] == 6
    assert result["uncached_projected_gb"] == 186
    assert result["uncached_remaining_gb"] == 142
    assert result["remaining_days"] == 13
    assert result["cached_used_gb"] == 200
    assert result["status"] == "within_budget"


def test_recent_improvement_does_not_erase_consumed_usage():
    daily = [{"date": "2026-11-15", "uncached_egress_bytes": 5 * GB}]
    result = usage.forecast(
        reading(uncached_egress_bytes=459 * GB, daily=daily), today=date(2026, 11, 16)
    )
    assert result["uncached_projected_gb"] == 524
    assert result["pace_gb_per_day"] == 5
    assert result["status"] == "over_budget"
    assert result["uncached_remaining_gb"] == 0


def test_missing_days_are_not_zero_and_old_reading_is_stale():
    result = usage.forecast(
        reading(daily=[{"date": "2026-11-14", "uncached_egress_bytes": GB}]),
        today=date(2026, 11, 18),
    )
    assert result["pace_basis"] == "cycle_to_date"
    assert result["pace_gb_per_day"] == 6
    assert result["missing_daily_readings"] == 17
    assert result["status"] == "stale"


def test_closed_cycle_never_forecasts_extra_days():
    result = usage.forecast(
        reading(measured_through="2026-11-29"), today=date(2026, 12, 1)
    )
    assert result["remaining_days"] == 0
    assert result["uncached_projected_gb"] == 108
    assert result["uncached_remaining_daily_budget_gb"] is None
    assert result["status"] == "within_budget"


@pytest.mark.parametrize(
    "changes",
    [
        {"uncached_egress_bytes": -1},
        {"uncached_egress_bytes": True},
        {"uncached_egress_bytes": 1.2},
        {"uncached_egress_bytes": float("nan")},
        {"measured_through": "2026-12-01"},
        {"cycle_end": "2026-10-01"},
        {"schema_version": 2},
        {"source": ""},
        {"daily": [{"date": "2026-11-15", "uncached_egress_bytes": GB}] * 2},
        {"daily": [{"date": "2026-11-16", "uncached_egress_bytes": GB}]},
        {"daily": [{"date": "2026-11-15", "uncached_egress_bytes": 200 * GB}]},
    ],
)
def test_rejects_inconsistent_or_invalid_readings(changes):
    with pytest.raises(ValueError):
        usage.forecast(reading(**changes), today=date(2026, 11, 16))


def test_cli_exit_statuses(tmp_path, capsys):
    path = tmp_path / "reading.json"
    for data, day, expected in [
        (reading(), "2026-11-16", 0),
        (reading(uncached_egress_bytes=459 * GB), "2026-11-16", 1),
        (reading(cached_egress_bytes=251 * GB), "2026-11-16", 1),
        (reading(), "2026-11-18", 3),
    ]:
        path.write_text(json.dumps(data))
        assert usage.main([str(path), "--today", day]) == expected
        json.loads(capsys.readouterr().out)
    path.write_text("private invalid content")
    assert usage.main([str(path)]) == 2
    captured = capsys.readouterr()
    assert "private" not in captured.err
    assert captured.out == ""


def test_probe_deltas_omit_unknown_resets_and_never_claim_bytes():
    first = {"reset": "same", "queries": {"1": (20, 100), "2": (10, 20)}}
    second = {
        "reset": "same",
        "queries": {"1": (23, 190), "2": (2, 5), "3": (7, 8)},
        "progress": {"state_rows": 71, "stored_progress_text_bytes": 3900000},
    }
    report = usage.summarize_probe(first, second, 60)
    assert report["top_queries_by_returned_rows"] == [
        {"query_id": "1", "calls": 3, "rows": 90}
    ]
    assert report["omitted_new_or_reset_queries"] == 2
    assert report["billed_egress_bytes"] is None
    assert report["billing_forecast"] is None
    second["reset"] = "different"
    report = usage.summarize_probe(first, second, 60)
    assert not report["counter_interval_valid"]
    assert report["top_queries_by_returned_rows"] == []


def test_deeply_nested_input_is_rejected_without_traceback(tmp_path, capsys):
    path = tmp_path / "reading.json"
    path.write_text("[" * 100000 + "0" + "]" * 100000)
    assert usage.main([str(path)]) == 2
    captured = capsys.readouterr()
    assert captured.out == ""
    assert "Invalid usage reading" in captured.err
    assert "Traceback" not in captured.err


def test_database_probe_refuses_unconfirmed_read_only_before_metadata(monkeypatch):
    from contextlib import nullcontext
    import sys
    from types import ModuleType, SimpleNamespace
    from unittest.mock import Mock

    import sqlalchemy

    statements = []

    def execute(statement):
        statements.append(statement)
        if statement == "SHOW transaction_read_only":
            return SimpleNamespace(scalar_one=lambda: "off")
        assert statement.startswith("SET "), "Metadata read preceded read-only proof"
        return None

    connection = SimpleNamespace(
        begin=lambda: nullcontext(),
        exec_driver_sql=execute,
        execute=Mock(side_effect=AssertionError("Unexpected metadata read")),
    )
    engine = SimpleNamespace(connect=lambda: nullcontext(connection), dispose=Mock())
    database = ModuleType("alethical.db.session")
    database.NO_PREPARED_STATEMENTS = {"prepare_threshold": None}
    database.database_url_for_target = lambda target: "not-a-real-database"
    monkeypatch.setitem(sys.modules, "alethical.db.session", database)
    monkeypatch.setattr(sqlalchemy, "create_engine", lambda *args, **kwargs: engine)

    with pytest.raises(RuntimeError, match="Read-only transaction not confirmed"):
        usage.probe_database(interval_seconds=1)

    assert statements == [
        "SET TRANSACTION READ ONLY",
        "SET LOCAL statement_timeout = '15s'",
        "SHOW transaction_read_only",
    ]
    connection.execute.assert_not_called()
    engine.dispose.assert_called_once_with()


def test_probe_cli_failure_hides_connection_details(monkeypatch, capsys):
    def unavailable(**kwargs):
        raise RuntimeError("private connection detail: secret-token")

    monkeypatch.setattr(usage, "probe_database", unavailable)
    assert usage.main(["--database-probe"]) == 2
    captured = capsys.readouterr()
    assert captured.out == ""
    assert captured.err == (
        "Database efficiency probe unavailable; no billing measurement was made\n"
    )
    assert "Traceback" not in captured.err
    assert "secret-token" not in captured.err
