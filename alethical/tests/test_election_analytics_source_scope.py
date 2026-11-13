"""A busy proof never changes coverage; each composition owns fresh source bytes."""

from datetime import date
from pathlib import Path
import tempfile
from types import SimpleNamespace

from fastapi import HTTPException
import pytest

from alethical.api.services import election_analytics as analytics
from alethical.api.services import election_source_io as source_io
from alethical.pipeline import election_outcomes
from alethical.pipeline.election_source_files import SourceFileLimitError


class _DB:
    def get(self, *_):
        return SimpleNamespace(generation_id="external", release_id="board")

    def scalars(self, _):
        return []

    def execute(self, _):
        return SimpleNamespace(tuples=lambda: [])


def _external(*_, **__):
    return {
        "snapshot_id": "snapshot",
        "generation_id": "external",
        "version": "external-checked",
        "authorities": [],
        "coverage": [],
        "candidates": [{"accounts": ["account"]}],
        "sources": [],
    }


def _board(*_, **__):
    return (
        {
            "release_id": "board",
            "version": "board-checked",
            "sources": {"contributions": {"retained_original_state": "available"}},
        },
        "board",
        [],
        {},
        {},
    )


def _providers(monkeypatch):
    monkeypatch.setattr(
        analytics.results,
        "snapshot",
        lambda *_: SimpleNamespace(
            id="snapshot", stage="general", election_date=date(2026, 11, 3)
        ),
    )
    monkeypatch.setattr(analytics.finance_versions, "current", lambda *_: "money")
    monkeypatch.setattr(analytics.external_reads, "bulk_finance", _external)
    monkeypatch.setattr(analytics, "_board_context", _board)


@pytest.mark.parametrize("lane", ["external", "board"])
@pytest.mark.parametrize("pinned", [False, True])
def test_busy_outcome_check_never_becomes_missing_authority(monkeypatch, lane, pinned):
    _providers(monkeypatch)
    healthy = analytics._context(_DB(), "election")[0]

    def capacity(*_, **__):
        raise SourceFileLimitError("occupied")

    monkeypatch.setattr(election_outcomes, "applicable_outcomes", lambda *_, **__: {})

    def busy(*_, **__):
        with pytest.MonkeyPatch.context() as limited:
            limited.setattr(election_outcomes, "applicable_outcomes", capacity)
            return source_io.outcome_map(None, snapshot_id="snapshot")

    if lane == "external":
        monkeypatch.setattr(analytics.external_reads, "bulk_finance", busy)
    else:
        monkeypatch.setattr(analytics, "_board_context", busy)
    with pytest.raises(HTTPException) as caught:
        analytics._context(
            _DB(), "election", version=healthy["version"] if pinned else None
        )
    assert caught.value.status_code == 503
    assert caught.value.headers == {"Retry-After": "1"}


@pytest.mark.parametrize("lane", ["external", "board"])
def test_missing_authority_keeps_available_other_authority(monkeypatch, lane):
    _providers(monkeypatch)
    monkeypatch.setattr(analytics, "_outcomes", lambda *_, **__: {})

    def missing(*_, **__):
        raise HTTPException(503, "Original unavailable")

    if lane == "external":
        monkeypatch.setattr(analytics.external_reads, "bulk_finance", missing)
    else:
        monkeypatch.setattr(analytics, "_board_context", missing)
    data = analytics._context(_DB(), "election")[0]
    missing_key, available_key = (
        ("external", "mn_cfb") if lane == "external" else ("mn_cfb", "external")
    )
    assert data["source_scopes"][missing_key]["status"] == "unavailable"
    assert data["source_scopes"][available_key]["status"] == "available"


@pytest.mark.parametrize("board_missing", [False, True])
def test_composed_outcomes_share_bytes_but_new_request_rechecks(
    monkeypatch, board_missing
):
    _providers(monkeypatch)

    class Store:
        calls = 0
        body = b"first"

        def get(self, key, path, *, max_bytes=None):
            self.calls += 1
            Path(path).write_bytes(self.body)

    backing = Store()
    scopes = []

    def central(db, *, snapshot_id, race_ids, store):
        scopes.append(store)
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / "original"
            store.get("shared-original", path, max_bytes=100)
            return {"race": {"outcome_review": {"version": path.read_text()}}}

    monkeypatch.setattr(election_outcomes, "applicable_outcomes", central)
    monkeypatch.setattr(source_io, "reader_store_from_env", lambda: backing)
    monkeypatch.setattr(
        analytics.external_reads, "raw_file_store_from_env", lambda: backing
    )

    def external(*args, **kwargs):
        store = source_io.request_store(kwargs.get("store") or backing)
        source_io.outcome_map(
            None, snapshot_id="snapshot", race_ids=["race"], store=store
        )
        return _external()

    def board(*args, **kwargs):
        if board_missing:
            raise HTTPException(503, "Original unavailable")
        # Exercise the real outcome adapter with the composition's optional scope.
        extra = {"store": kwargs["outcome_store"]} if "outcome_store" in kwargs else {}
        outcomes = analytics._outcomes(
            None, "snapshot", [SimpleNamespace(id="race")], **extra
        )
        return (*_board()[:-1], outcomes)

    monkeypatch.setattr(analytics.external_reads, "bulk_finance", external)
    monkeypatch.setattr(analytics, "_board_context", board)
    before = analytics._context(_DB(), "election")[4]
    assert backing.calls == 1
    assert len(scopes) == 2 and scopes[0] is scopes[1]
    backing.body = b"changed"
    after = analytics._context(_DB(), "election")[4]
    assert backing.calls == 2
    assert scopes[2] is scopes[3] and scopes[0] is not scopes[2]
    assert before["race"]["outcome_review"]["version"] == "first"
    assert after["race"]["outcome_review"]["version"] == "changed"
