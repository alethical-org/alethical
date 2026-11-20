from __future__ import annotations

import contextlib
import gzip
import io
import json
import zipfile
from datetime import UTC, datetime
from pathlib import Path

import httpx
import pytest

from scripts import national_fcc_history as history

# 2024-11-05 in Eastern time, so 2024-11-04 is the newest finished FCC day.
NOW = datetime(2024, 11, 5, 17, 0, tzinfo=UTC)
POLITICAL = "Political Files/2024/Federal/US Senate/Smith for Senate"


def event(file_id, status="new", updated="2024-11-01T10:00:00-04:00", **extra):
    return {
        "file_id": file_id,
        "file_name": extra.pop("name", "Order 1"),
        "file_extension": "pdf",
        "file_size": 1200,
        "history_status": status,
        "file_manager_id": extra.pop("manager", "ABCDEF00-0000-4000-8000-000000000001"),
        "entity_id": "035097",
        "source_service_code": "TV",
        "create_ts": "2024-11-01T09:00:00-04:00",
        "last_update_ts": updated,
        "file_folder_path": extra.pop("path", POLITICAL),
        "callsign": "KVCW",
        "city": None,
        "state": "NV",
        **extra,
    }


def answer(rows, status_code=200):
    return {
        "status": "success",
        "statusCode": status_code,
        "statusMessage": "File History Found",
        "history": rows,
    }


class FakeTime:
    def __init__(self):
        self.now = 1000.0
        self.slept = []

    def clock(self):
        return self.now

    def sleep(self, seconds):
        self.slept.append(seconds)
        self.now += seconds


def fcc(days: dict):
    """A fake FCC history API answering from per-day queues of responses."""
    calls = []

    def handler(request: httpx.Request) -> httpx.Response:
        start = request.url.params["startDate"]
        end = request.url.params["endDate"]
        assert request.url.params["offset"] == "0"
        assert "count" not in request.url.params
        assert request.headers["User-Agent"] == history.USER_AGENT
        name = start if end == start else f"{start}..{end}"
        calls.append(name)
        queue = days.get(name, [answer([])])
        item = queue.pop(0) if len(queue) > 1 else queue[0]
        if isinstance(item, httpx.Response):
            return item
        return httpx.Response(200, json=item)

    client = httpx.Client(
        transport=httpx.MockTransport(handler),
        headers={"User-Agent": history.USER_AGENT},
    )
    return client, calls


def fetch(store, http, timer, *argv, now=NOW):
    args = history.cli().parse_args(["fetch", *argv])
    return history.cmd_fetch(
        args, store, http=http, sleep=timer.sleep, clock=timer.clock, now=now
    )


def compact(store, tmp_path, now=NOW):
    args = history.cli().parse_args(["compact", "--work-dir", str(tmp_path)])
    return history.cmd_compact(args, store, now=now)


def inventory(store):
    current = json.loads(store.get(history.CURRENT))
    manifest = json.loads(store.get(current["manifest_key"]))
    rows = [
        json.loads(line)
        for line in gzip.decompress(store.get(manifest["object_key"])).splitlines()
    ]
    return manifest, {row["k"]: row for row in rows}


def store_at(tmp_path: Path, name="r2"):
    return history.LocalStore(tmp_path / name)


def test_a_whole_day_is_stored_and_duplicate_rows_count_once(tmp_path):
    store = store_at(tmp_path)
    rows = [event("a"), event("a"), event("b"), event("c", path="Public Inspection")]
    http, calls = fcc({"2024-11-01": [answer(rows)]})
    assert (
        fetch(store, http, FakeTime(), "--from", "2024-11-01", "--to", "2024-11-01")
        == 0
    )
    record = history.load_ledger(store)["days"]["2024-11-01"]
    assert record["status"] == "complete"
    assert (record["rows"], record["political"], record["filings"]) == (4, 3, 2)
    raw = gzip.decompress(store.get(record["key"]))
    assert history.parse_day(raw)["history"] == rows
    assert compact(store, tmp_path) == 0
    manifest, rows_by_key = inventory(store)
    assert manifest["rows"] == 2
    assert manifest["through"] is None  # 2012 onwards is not yet held
    assert rows_by_key["TV|035097|a"]["ev"] == 1
    assert rows_by_key["TV|035097|a"]["m"] == "abcdef00-0000-4000-8000-000000000001"


def test_the_newest_event_sets_the_latest_state_whatever_the_source_order(tmp_path):
    store = store_at(tmp_path)
    created = event("f", "new", "2024-11-01T09:00:00-04:00")
    renamed = event("f", "rename", "2024-11-02T09:00:00-04:00", name="Order 1 final")
    # Eastern standard time: 08:30-05:00 is later than 09:00-04:00 the day before.
    deleted = event("f", "delete", "2024-11-03T08:30:00-05:00", name="Order 1 final")
    http, _ = fcc(
        {
            "2024-11-01": [answer([deleted])],
            "2024-11-02": [answer([created, renamed])],
            "2024-11-03": [answer([renamed])],
        }
    )
    fetch(store, http, FakeTime(), "--from", "2024-11-01", "--to", "2024-11-03")
    compact(store, tmp_path)
    _, rows = inventory(store)
    row = rows["TV|035097|f"]
    assert row["h"] == "delete"
    assert row["n"] == "Order 1 final"
    assert row["ev"] == 3
    assert row["fs"] == "2024-11-01T13:00:00Z"
    assert row["ls"] == "2024-11-03T13:30:00Z"


def test_a_busy_answer_is_retried_and_the_day_then_completes(tmp_path):
    store = store_at(tmp_path)
    busy = httpx.Response(503, headers={"Retry-After": "30"})
    http, calls = fcc({"2024-11-01": [busy, answer([event("a")])]})
    timer = FakeTime()
    assert fetch(store, http, timer, "--from", "2024-11-01", "--to", "2024-11-01") == 0
    assert calls == ["2024-11-01", "2024-11-01"]
    assert 30 in timer.slept
    assert history.load_ledger(store)["days"]["2024-11-01"]["status"] == "complete"


def test_an_error_body_or_a_truncated_answer_never_counts_as_a_complete_day(tmp_path):
    store = store_at(tmp_path)
    truncated = {"status": "success", "statusCode": 200, "statusMessage": "x"}
    http, calls = fcc(
        {
            "2024-11-01": [answer([], status_code=500)],
            "2024-11-02": [truncated],
            "2024-11-03": [httpx.Response(200, content=b'{"statusCode":200,"hist')],
        }
    )
    timer = FakeTime()
    assert fetch(store, http, timer, "--from", "2024-11-01", "--to", "2024-11-03") == 1
    assert history.load_ledger(store)["days"] == {}
    assert len(calls) == 3 * history.ATTEMPTS
    # Requests are never closer than 1 second apart.
    assert all(gap >= 1 for gap in timer.slept)


def test_a_round_capped_looking_day_is_kept_unverified_and_fetched_again(tmp_path):
    store = store_at(tmp_path)
    rows = [event(f"id{i}") for i in range(10_000)]
    http, calls = fcc({"2024-10-01": [answer(rows)]})
    fetch(store, http, FakeTime(), "--from", "2024-10-01", "--to", "2024-10-01")
    assert history.load_ledger(store)["days"]["2024-10-01"]["status"] == "unverified"
    fetch(store, http, FakeTime(), "--from", "2024-10-01", "--to", "2024-10-01")
    assert [c for c in calls if c == "2024-10-01"] == ["2024-10-01", "2024-10-01"]
    status = io.StringIO()

    with contextlib.redirect_stdout(status):
        history.cmd_status(history.cli().parse_args(["status"]), store, now=NOW)
    assert json.loads(status.getvalue())["days"]["unverified"] == ["2024-10-01"]


def test_complete_days_are_skipped_except_the_newest_three(tmp_path):
    store = store_at(tmp_path)
    http, calls = fcc({})
    fetch(store, http, FakeTime(), "--from", "2024-10-30", "--to", "2024-11-04")
    assert calls[:3] == ["2024-11-04", "2024-11-03", "2024-11-02"]
    calls.clear()
    fetch(store, http, FakeTime(), "--from", "2024-10-30", "--to", "2024-11-04")
    assert calls == ["2024-11-04", "2024-11-03", "2024-11-02"]


def test_a_time_limit_stops_between_days_and_the_next_run_continues(tmp_path):
    store = store_at(tmp_path)
    http, calls = fcc({})
    timer = FakeTime()
    fetch(
        store,
        http,
        timer,
        "--from",
        "2024-10-01",
        "--to",
        "2024-10-10",
        "--max-seconds",
        "3",
    )
    first_run = len(calls)
    assert 0 < first_run < 10
    fetch(store, http, FakeTime(), "--from", "2024-10-01", "--to", "2024-10-10")
    assert len(calls) == 10
    assert sorted(history.load_ledger(store)["days"]) == [
        f"2024-10-{d:02d}" for d in range(1, 11)
    ]


def test_an_unfinished_day_is_refused(tmp_path):

    store = store_at(tmp_path)
    http, _ = fcc({})
    with pytest.raises(SystemExit):
        fetch(store, http, FakeTime(), "--from", "2024-11-05", "--to", "2024-11-05")


def test_compacting_the_same_sources_twice_writes_nothing_new(tmp_path):
    store = store_at(tmp_path)
    http, _ = fcc({"2024-11-01": [answer([event("a"), event("b")])]})
    fetch(store, http, FakeTime(), "--from", "2024-11-01", "--to", "2024-11-01")
    compact(store, tmp_path)
    before = sorted(p.name for p in (tmp_path / "r2").rglob("*"))
    out = io.StringIO()

    with contextlib.redirect_stdout(out):
        compact(store, tmp_path, now=datetime(2024, 11, 6, tzinfo=UTC))
    assert "unchanged" in json.loads(out.getvalue())
    assert sorted(p.name for p in (tmp_path / "r2").rglob("*")) == before


def test_a_replay_after_an_interrupted_fetch_gives_the_same_inventory(tmp_path):
    days = {
        "2024-11-01": [answer([event("a"), event("b", "new")])],
        "2024-11-02": [answer([event("b", "delete", "2024-11-02T12:00:00-04:00")])],
        "2024-11-03": [answer([event("c"), event("a", "rename", name="Renamed")])],
    }
    whole = store_at(tmp_path, "whole")
    http, _ = fcc(json.loads(json.dumps(days)))
    fetch(whole, http, FakeTime(), "--from", "2024-11-01", "--to", "2024-11-03")
    compact(whole, tmp_path)

    interrupted = store_at(tmp_path, "interrupted")
    failing = dict(json.loads(json.dumps(days)))
    failing["2024-11-03"] = [httpx.Response(503)]
    http, _ = fcc(failing)
    assert (
        fetch(
            interrupted, http, FakeTime(), "--from", "2024-11-01", "--to", "2024-11-03"
        )
        == 1
    )
    compact(interrupted, tmp_path)
    http, _ = fcc(json.loads(json.dumps(days)))
    fetch(interrupted, http, FakeTime(), "--from", "2024-11-01", "--to", "2024-11-03")
    compact(interrupted, tmp_path, now=datetime(2024, 11, 6, tzinfo=UTC))

    assert inventory(whole)[0]["sha256"] == inventory(interrupted)[0]["sha256"]


def transfer_zip(path: Path) -> Path:
    def page(rows):
        return gzip.compress(json.dumps(answer(rows)).encode())

    with zipfile.ZipFile(path, "w") as archive:
        archive.writestr(
            "national-fcc/raw-file-history/2024-10-01/0000000000.json.gz",
            page([event("a"), event("x", path="Public Inspection")]),
        )
        archive.writestr(
            "national-fcc/raw-file-history/2024-10-01/._0000000000.json.gz",
            b"\x00\x05\x16\x07 Finder metadata",
        )
        archive.writestr(
            "national-fcc/raw-file-history/2024-11-01/0000000000.json.gz",
            page(
                [event("only-held"), event("a", "rename", "2024-10-01T00:00:00-04:00")]
            ),
        )
        archive.writestr("national-fcc/opif/other.json", b"{}")
    return path


def test_transfer_events_reconcile_and_filings_only_it_holds_are_reported(tmp_path):
    store = store_at(tmp_path)
    args = history.cli().parse_args(
        ["transfer", "--zip", str(transfer_zip(tmp_path / "t.zip"))]
    )
    assert history.cmd_transfer(args, store, now=NOW) == 0
    held = json.loads(store.get(history.TRANSFER_MANIFEST))
    assert held["pages"] == 2
    assert held["windows"] == {
        "2024-10-01": {"rows": 2, "political": 1},
        "2024-11-01": {"rows": 2, "political": 2},
    }
    http, _ = fcc({"2024-11-01": [answer([event("a")])]})
    fetch(store, http, FakeTime(), "--from", "2024-11-01", "--to", "2024-11-01")
    compact(store, tmp_path)
    manifest, rows = inventory(store)
    assert set(rows) == {"TV|035097|a", "TV|035097|only-held"}
    assert manifest["transfer_only"] == {"2024-11-01": 1}
    assert manifest["windows"] == held["windows"]
    assert (
        rows["TV|035097|a"]["ev"] == 2
    )  # the same event from both sources counts once
    assert rows["TV|035097|a"]["h"] == "new"


def test_a_round_day_is_complete_when_the_two_day_window_adds_exactly_the_next_day(
    tmp_path,
):
    store = store_at(tmp_path)
    round_day = [event(f"id{i}") for i in range(10_000)]
    next_day = [event(f"nx{i}") for i in range(37)]
    http, calls = fcc(
        {
            "2024-10-01": [answer(round_day)],
            "2024-10-02": [answer(next_day)],
            "2024-10-01..2024-10-02": [answer(round_day + next_day)],
        }
    )
    fetch(store, http, FakeTime(), "--from", "2024-10-01", "--to", "2024-10-01")
    day = history.load_ledger(store)["days"]["2024-10-01"]
    assert day["status"] == "complete"
    assert day["confirmed_by"] == "2024-10-01..2024-10-02: 10037 = 10000 + 37"


def test_a_capped_two_day_window_keeps_the_round_day_unverified(tmp_path):
    store = store_at(tmp_path)
    round_day = [event(f"id{i}") for i in range(10_000)]
    http, _ = fcc(
        {
            "2024-10-01": [answer(round_day)],
            "2024-10-02": [answer([event("nx1")])],
            # A server cap answers the larger window with the same round count.
            "2024-10-01..2024-10-02": [answer(round_day)],
        }
    )
    fetch(store, http, FakeTime(), "--from", "2024-10-01", "--to", "2024-10-01")
    day = history.load_ledger(store)["days"]["2024-10-01"]
    assert day["status"] == "unverified" and "confirmed_by" not in day
