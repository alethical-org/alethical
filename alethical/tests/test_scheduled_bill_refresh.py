from copy import deepcopy
from dataclasses import asdict
from datetime import UTC, datetime, timedelta
from unittest.mock import Mock

import pytest

from alethical.pipeline.minnesota import BillSearchResult
from scripts import run_scheduled_bill_refresh as scheduled


def item(number: int) -> BillSearchResult:
    return BillSearchResult(
        chamber="House",
        file_type="HF",
        file_number=number,
        description="Official bill",
        status_xml_uri="",
        latest_text_html_uri="",
        session_code="0942025",
    )


def setup(monkeypatch, count=3):
    state = {}
    monkeypatch.setattr(scheduled, "stored_bill_keys", lambda *_: set())
    writes = []
    monkeypatch.setattr(scheduled, "load_progress", lambda *_: deepcopy(state))

    def save(_engine, _name, _token, value):
        state.clear()
        state.update(deepcopy(value))
        writes.append(deepcopy(value))

    monkeypatch.setattr(scheduled, "save_progress", save)
    monkeypatch.setattr(
        scheduled, "rate_limited_source_session", lambda *_args, **_kw: Mock()
    )
    monkeypatch.setattr(
        scheduled,
        "discover_complete_session_bills",
        lambda *_args, **_kw: [item(n) for n in range(1, count + 1)],
    )
    monkeypatch.setattr(scheduled, "check_pending_votes", lambda *_args, **_kw: [])
    monkeypatch.setattr(scheduled, "CHUNK_SIZE", 2)
    return state, writes


def run():
    return scheduled.run_chunk(
        Mock(), name="bills", token="owned", target="local", session_code="0942025"
    )


def test_chunks_pin_inventory_and_queue_votes_before_source_writes(monkeypatch):
    state, writes = setup(monkeypatch)
    seen = []

    def refresh(*_args, **kwargs):
        keys = [row.bill_key for row in kwargs["inventory"]]
        assert state["pending_votes"] == keys
        seen.extend(keys)
        return {"failed": []}

    monkeypatch.setattr(scheduled, "refresh_bills", refresh)
    assert run() == 75
    assert run() == 75  # vote work
    # The pinned manifest survives an unavailable or changed discovery source.
    monkeypatch.setattr(
        scheduled,
        "discover_complete_session_bills",
        Mock(side_effect=AssertionError("must reuse pinned inventory")),
    )
    assert run() == 75
    assert run() == 75  # vote work
    assert run() == 0
    assert len(seen) == 3
    assert "inventory" not in state
    assert len(state["previous_inventory_keys"]) == 3


def test_failed_bills_retry_without_restarting_good_inventory(monkeypatch):
    state, _ = setup(monkeypatch, count=2)
    calls = []

    def refresh(*_args, **kwargs):
        keys = [row.bill_key for row in kwargs["inventory"]]
        calls.append(keys)
        return {"failed": [{"bill_key": item(2).bill_key}]}

    monkeypatch.setattr(scheduled, "refresh_bills", refresh)
    assert run() == 75
    assert run() == 75
    assert run() == 1
    assert calls == [[item(1).bill_key, item(2).bill_key], [item(2).bill_key]]
    assert state["failures"] == [item(2).bill_key]


def test_crash_after_commit_keeps_vote_work_and_retries_same_chunk(monkeypatch):
    state, _ = setup(monkeypatch, count=2)
    monkeypatch.setattr(
        scheduled,
        "refresh_bills",
        Mock(side_effect=RuntimeError("interrupted after commit")),
    )
    with pytest.raises(RuntimeError):
        run()
    assert state["pending_votes"] == [item(1).bill_key, item(2).bill_key]
    assert state["cursor"] is None
    assert run() == 75
    assert state["pending_votes"] == []


def test_lost_lease_stops_before_source_writes(monkeypatch):
    state, _ = setup(monkeypatch)
    monkeypatch.setattr(
        scheduled, "save_progress", Mock(side_effect=RuntimeError("lost lease"))
    )
    refresh = Mock()
    monkeypatch.setattr(scheduled, "refresh_bills", refresh)
    with pytest.raises(RuntimeError, match="lost lease"):
        run()
    refresh.assert_not_called()


def test_shrinking_inventory_never_claims_complete_refresh(monkeypatch):
    state, _ = setup(monkeypatch, count=2)
    state["previous_inventory_keys"] = [
        item(1).bill_key,
        item(2).bill_key,
        item(3).bill_key,
    ]
    with pytest.raises(RuntimeError, match="omitted 1"):
        run()


def test_vote_failure_does_not_hold_up_remaining_bill_inventory(monkeypatch):
    state, _ = setup(monkeypatch, count=3)
    seen = []

    def refresh(*_args, **kwargs):
        seen.extend(item.bill_key for item in kwargs["inventory"])
        return {"failed": []}

    monkeypatch.setattr(scheduled, "refresh_bills", refresh)
    monkeypatch.setattr(
        scheduled,
        "check_pending_votes",
        lambda *_args, **kwargs: (
            [item(1).bill_key] if item(1).bill_key in kwargs["bill_keys"] else []
        ),
    )
    assert run() == 75
    assert run() == 75
    assert run() == 75
    assert run() == 75
    assert len(seen) == 3
    assert run() == 1
    assert state["failed_votes"] == [item(1).bill_key]

    monkeypatch.setattr(scheduled, "check_pending_votes", lambda *_args, **_kw: [])
    assert run() == 75
    assert run() == 0
    assert "failed_votes" not in state


def test_first_scheduled_inventory_must_cover_existing_saved_bills(monkeypatch):
    setup(monkeypatch, count=2)
    monkeypatch.setattr(scheduled, "stored_bill_keys", lambda *_: {item(3).bill_key})
    with pytest.raises(RuntimeError, match="omitted 1"):
        run()


@pytest.mark.parametrize("failure_kind", ["bill", "vote"])
@pytest.mark.parametrize(
    "started,interval",
    [
        (datetime(2026, 3, 1, tzinfo=UTC), timedelta(hours=4)),
        (datetime(2026, 10, 7, tzinfo=UTC), timedelta(days=7)),
    ],
)
def test_persistent_failure_cannot_freeze_new_bills_or_later_corrections(
    monkeypatch, failure_kind, started, interval
):
    state, _ = setup(monkeypatch, count=3)
    state.update(
        inventory=[asdict(item(1)), asdict(item(2))],
        inventory_sha256="previous-pass",
        pass_complete=True,
        pass_started_at=started.isoformat(),
        failures=[item(2).bill_key] if failure_kind == "bill" else [],
        failed_votes=[item(2).bill_key] if failure_kind == "vote" else [],
    )
    discovery = Mock(return_value=[item(1), item(2), item(3)])
    monkeypatch.setattr(scheduled, "discover_complete_session_bills", discovery)
    refreshed = []

    def refresh(*_args, **kwargs):
        keys = [row.bill_key for row in kwargs["inventory"]]
        refreshed.append(keys)
        return {
            "failed": [{"bill_key": item(2).bill_key}]
            if failure_kind == "bill" and item(2).bill_key in keys
            else []
        }

    monkeypatch.setattr(scheduled, "refresh_bills", refresh)
    monkeypatch.setattr(
        scheduled,
        "check_pending_votes",
        lambda *_args, **kw: (
            [item(2).bill_key]
            if failure_kind == "vote" and item(2).bill_key in kw["bill_keys"]
            else []
        ),
    )

    def at(now):
        return scheduled.run_chunk(
            Mock(),
            name="bills",
            token="owned",
            target="local",
            session_code="0942025",
            now=now,
        )

    before = started + interval - timedelta(seconds=1)
    assert at(before) == 1
    if state.get("pending_votes"):
        assert at(before) == 75
    discovery.assert_not_called()
    refreshed.clear()
    due = started + interval
    assert [at(due) for _ in range(4)] == [75, 75, 75, 75]
    discovery.assert_called_once()
    assert refreshed == [[item(1).bill_key, item(2).bill_key], [item(3).bill_key]]
    # The existing healthy bill was rechecked for corrections, the newly filed
    # bill was collected, and the unresolved record still prevents full success.
    assert state["failures" if failure_kind == "bill" else "failed_votes"] == [
        item(2).bill_key
    ]
    assert at(due) == 1
    discovery.assert_called_once()


def test_due_discovery_rejection_preserves_failed_pass_and_vote_evidence(monkeypatch):
    state, _ = setup(monkeypatch, count=1)
    state.update(
        inventory=[asdict(item(1)), asdict(item(2))],
        inventory_sha256="previous-pass",
        pass_complete=True,
        pass_started_at="2026-03-01T00:00:00+00:00",
        failures=[],
        failed_votes=[item(2).bill_key],
    )
    held = deepcopy(state)
    with pytest.raises(RuntimeError, match="omitted 1"):
        scheduled.run_chunk(
            Mock(),
            name="bills",
            token="owned",
            target="local",
            session_code="0942025",
            now=datetime(2026, 3, 1, 4, tzinfo=UTC),
        )
    assert state == held
