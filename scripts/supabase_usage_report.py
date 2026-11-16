#!/usr/bin/env python3
"""Forecast organization egress from a dated Supabase usage reading.

The offline forecast uses supplied meter readings, never query-row estimates.
The optional database probe reads bounded metadata with existing credentials.
Neither route writes records, invokes AI, or changes billing. Dates use the dashboard's daily boundaries;
cycle_end and measured_through are exclusive. GB means 1,000,000,000 bytes.
"""

from __future__ import annotations

import argparse
from datetime import date, datetime, timedelta, timezone
import json
from pathlib import Path
import sys
import time

GB = 1_000_000_000
MAX_INPUT_BYTES = 1_000_000


def _date(value: object) -> date:
    if not isinstance(value, str):
        raise ValueError("Dates must use YYYY-MM-DD")
    result = date.fromisoformat(value)
    if result.isoformat() != value:
        raise ValueError("Dates must use YYYY-MM-DD")
    return result


def _bytes(value: object) -> int:
    if isinstance(value, bool) or not isinstance(value, int) or value < 0:
        raise ValueError("Usage must be a nonnegative integer number of bytes")
    return value


def forecast(reading: dict, *, today: date) -> dict:
    """Use recent complete days when supplied, otherwise cycle-to-date pace."""
    if reading.get("schema_version") != 1:
        raise ValueError("Unsupported reading schema")
    for field in ("organization", "source"):
        if not isinstance(reading.get(field), str) or not reading[field].strip():
            raise ValueError(f"Missing {field}")
    start = _date(reading.get("cycle_start"))
    end = _date(reading.get("cycle_end"))
    through = _date(reading.get("measured_through"))
    if not start < through <= end or through > today:
        raise ValueError(
            "Require cycle_start < measured_through <= cycle_end and today"
        )
    used = _bytes(reading.get("uncached_egress_bytes"))
    cached = reading.get("cached_egress_bytes")
    if cached is not None:
        cached = _bytes(cached)
    daily = reading.get("daily", [])
    if not isinstance(daily, list):
        raise ValueError("daily must be a list of complete day readings")
    days: dict[date, int] = {}
    for row in daily:
        if not isinstance(row, dict):
            raise ValueError("Invalid daily reading")
        day = _date(row.get("date"))
        if not start <= day < through or day in days:
            raise ValueError("Duplicate or out-of-range daily reading")
        days[day] = _bytes(row.get("uncached_egress_bytes"))
    if sum(days.values()) > used:
        raise ValueError("Daily readings exceed the cycle meter")
    # Missing dates are unknown, never zero. Use a complete trailing window only.
    trailing: list[int] = []
    day = through - timedelta(days=1)
    while day in days and len(trailing) < 7:
        trailing.append(days[day])
        day -= timedelta(days=1)
    elapsed = (through - start).days
    remaining = (end - through).days
    pace = sum(trailing) / len(trailing) if trailing else used / elapsed
    projected = used + pace * remaining
    stale = through < min(today, end)
    over = (
        used > 250 * GB
        or projected > 250 * GB
        or pace > 7 * GB
        or (cached is not None and cached > 250 * GB)
    )
    status = "stale" if stale else "over_budget" if over else "within_budget"
    return {
        "schema_version": 1,
        "organization": reading["organization"],
        "source": reading["source"],
        "cycle_start": start.isoformat(),
        "cycle_end_exclusive": end.isoformat(),
        "measured_through_exclusive": through.isoformat(),
        "status": status,
        "units": "decimal GB (1,000,000,000 bytes)",
        "uncached_used_gb": used / GB,
        "cached_used_gb": None if cached is None else cached / GB,
        "cached_over_allowance": None if cached is None else cached > 250 * GB,
        "uncached_allowance_gb": 250,
        "daily_target_gb": 7,
        "pace_gb_per_day": pace / GB,
        "pace_basis": "trailing_complete_days" if trailing else "cycle_to_date",
        "pace_days": len(trailing) if trailing else elapsed,
        "remaining_days": remaining,
        "uncached_projected_gb": projected / GB,
        "uncached_remaining_gb": max(0, 250 * GB - used) / GB,
        "uncached_remaining_daily_budget_gb": (
            max(0, 250 * GB - used) / remaining / GB if remaining else None
        ),
        "forecast_is_estimate": True,
        "actual_meter_feed": "provided_reading_only",
        "missing_daily_readings": elapsed - len(days),
        "invoice_estimate": None,
    }


def probe_database(*, interval_seconds: int = 60) -> dict:
    """Small read-only metadata samples; query counts are never billed bytes."""
    from sqlalchemy import create_engine, text

    from alethical.db.session import NO_PREPARED_STATEMENTS, database_url_for_target

    if not 1 <= interval_seconds <= 120:
        raise ValueError("Probe interval must be 1 to 120 seconds")
    engine = create_engine(
        database_url_for_target("production"),
        connect_args={**NO_PREPARED_STATEMENTS, "connect_timeout": 15},
        pool_pre_ping=True,
    )

    def sample() -> dict:
        with engine.connect() as conn, conn.begin():
            conn.exec_driver_sql("SET TRANSACTION READ ONLY")
            conn.exec_driver_sql("SET LOCAL statement_timeout = '15s'")
            if conn.exec_driver_sql("SHOW transaction_read_only").scalar_one() != "on":
                raise RuntimeError("Read-only transaction not confirmed")
            reset = conn.exec_driver_sql(
                "SELECT stats_reset FROM pg_stat_statements_info"
            ).scalar_one()
            rows = conn.execute(
                text(
                    "SELECT queryid::text, sum(calls)::bigint, sum(rows)::bigint "
                    "FROM pg_stat_statements WHERE dbid = "
                    "(SELECT oid FROM pg_database WHERE datname = current_database()) "
                    "AND queryid IS NOT NULL GROUP BY queryid"
                )
            ).all()
            progress = conn.exec_driver_sql(
                "SELECT count(*), coalesce(sum(octet_length(progress::text)),0), "
                "coalesce(max(octet_length(progress::text)),0) FROM source_refresh_state"
            ).one()
            return {
                "reset": str(reset),
                "queries": {str(q): (int(c), int(r)) for q, c, r in rows},
                "progress": {
                    "state_rows": int(progress[0]),
                    "stored_progress_text_bytes": int(progress[1]),
                    "largest_progress_text_bytes": int(progress[2]),
                },
            }

    try:
        first = sample()
        started = time.monotonic()
        time.sleep(interval_seconds)
        second = sample()
        elapsed = time.monotonic() - started
    finally:
        engine.dispose()
    return summarize_probe(first, second, elapsed)


def summarize_probe(first: dict, second: dict, elapsed: float) -> dict:
    valid = first["reset"] == second["reset"]
    deltas = []
    omitted = 0
    if valid:
        for query_id, (calls, rows) in second["queries"].items():
            previous = first["queries"].get(query_id)
            if previous is None or calls < previous[0] or rows < previous[1]:
                omitted += 1
                continue
            if calls > previous[0]:
                deltas.append(
                    {
                        "query_id": query_id,
                        "calls": calls - previous[0],
                        "rows": rows - previous[1],
                    }
                )
    return {
        "schema_version": 1,
        "observed_at_utc": datetime.now(timezone.utc).isoformat(),
        "measurement": "read_only_database_counters_not_metered_egress",
        "billed_egress_bytes": None,
        "billing_forecast": None,
        "billing_input_status": "missing_actual_usage_reading",
        "interval_seconds": elapsed,
        "counter_interval_valid": valid,
        "omitted_new_or_reset_queries": omitted,
        "top_queries_by_returned_rows": sorted(
            deltas, key=lambda d: d["rows"], reverse=True
        )[:25],
        **second["progress"],
        "limits": "Rows are not bytes. Evicted and newly seen queries have no trustworthy interval delta. No raw query text or record contents are retained.",
    }


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("reading", type=Path, nargs="?")
    parser.add_argument("--database-probe", action="store_true")
    parser.add_argument("--interval-seconds", type=int, default=60)
    parser.add_argument(
        "--today", type=date.fromisoformat, default=datetime.now(timezone.utc).date()
    )
    args = parser.parse_args(argv)
    if args.database_probe:
        if args.reading is not None:
            parser.error("Choose a usage reading or --database-probe")
        try:
            report = probe_database(interval_seconds=args.interval_seconds)
        except Exception:
            print(
                "Database efficiency probe unavailable; no billing measurement was made",
                file=sys.stderr,
            )
            return 2
        print(json.dumps(report, indent=2, allow_nan=False))
        return 0 if report["counter_interval_valid"] else 3
    if args.reading is None:
        parser.error("Provide a usage reading or --database-probe")
    try:
        with args.reading.open("rb") as handle:
            raw = handle.read(MAX_INPUT_BYTES + 1)
        if len(raw) > MAX_INPUT_BYTES:
            raise ValueError("Reading exceeds 1 MB limit")
        reading = json.loads(raw)
        if not isinstance(reading, dict):
            raise ValueError("Reading must be an object")
        report = forecast(reading, today=args.today)
    except (OSError, ValueError, TypeError, OverflowError, RecursionError):
        # Do not echo arbitrary input, file contents, paths or private exception text.
        print(
            "Invalid usage reading; see docs/operations/supabase-usage.md",
            file=sys.stderr,
        )
        return 2
    print(json.dumps(report, indent=2, allow_nan=False))
    if report["status"] == "stale":
        return 3
    return (
        1 if report["status"] == "over_budget" or report["cached_over_allowance"] else 0
    )


if __name__ == "__main__":
    raise SystemExit(main())
