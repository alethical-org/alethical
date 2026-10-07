from copy import deepcopy
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
        "discover_session_bills",
        lambda *_args, **_kw: [item(n) for n in range(1, count + 1)],
    )
    monkeypatch.setattr(scheduled, "check_pending_votes", lambda *_args, **_kw: True)
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
        "discover_session_bills",
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
