"""Cheap official release signals queue checked collection and never publish."""

from datetime import timedelta
from types import SimpleNamespace

import pytest
from sqlalchemy import delete, text
from sqlalchemy.orm import Session

from alethical.db import models as schema
from alethical.db.session import get_engine
from alethical.pipeline import record_refresh as runner
from scripts import discover_reference_records as reference

JOB = runner.RefreshJob(
    "roster-discovery",
    timedelta(minutes=15),
    timedelta(minutes=3),
    ("unused",),
    "https://www.house.mn.gov/hinfo/leginfo/memroster.pdf",
    "test",
    lane="roster-discovery",
)


@pytest.fixture
def engine(seed_database):
    engine = get_engine()

    def empty():
        with Session(engine) as db:
            db.execute(delete(schema.SourceRefreshAttempt))
            db.execute(delete(schema.SourceRefreshState))
            db.commit()

    empty()
    yield engine
    empty()


def claim(engine):
    with Session(engine) as db:
        result = runner.claim_job(db, JOB, force=True)
    return str(result.token)


def finish(engine, token):
    with Session(engine) as db:
        db.execute(
            text(
                "UPDATE source_refresh_state SET token=NULL, lease_expires_at=NULL"
                " WHERE name IN (:name, :lane)"
            ),
            {"name": JOB.name, "lane": f"lane:{JOB.lane}"},
        )
        db.commit()


def signalled(engine):
    with Session(engine) as db:
        return db.get(schema.SourceRefreshState, "signal:roster") is not None


def clear_signal(engine):
    with Session(engine) as db:
        db.execute(
            delete(schema.SourceRefreshState).where(
                schema.SourceRefreshState.name.in_(["signal:roster", "roster"])
            )
        )
        db.commit()


def test_only_a_changed_release_queues_collection(engine, monkeypatch):
    observed = {"sha256": "a" * 64, "etag": '"1"', "last_modified": None}
    monkeypatch.setattr(reference, "fingerprint", lambda *a: dict(observed))

    token = claim(engine)
    first = reference.run(engine, source="roster", name=JOB.name, token=token)
    assert first["collection_requested"] and first["publication"] is False
    assert signalled(engine)
    finish(engine, token)
    clear_signal(engine)

    token = claim(engine)
    # A new validator on identical bytes is not a new roster.
    observed["etag"] = '"2"'
    same = reference.run(engine, source="roster", name=JOB.name, token=token)
    assert not same["collection_requested"] and not signalled(engine)
    finish(engine, token)

    token = claim(engine)
    observed["sha256"] = "b" * 64
    changed = reference.run(engine, source="roster", name=JOB.name, token=token)
    assert changed["collection_requested"] and signalled(engine)
    with Session(engine) as db:
        assert db.get(schema.SourceRefreshState, "roster") is not None


def test_failed_reading_keeps_the_previous_fingerprint_and_queues_nothing(
    engine, monkeypatch
):
    monkeypatch.setattr(reference, "fingerprint", lambda *a: {"sha256": "a" * 64})
    token = claim(engine)
    reference.run(engine, source="roster", name=JOB.name, token=token)
    finish(engine, token)
    clear_signal(engine)

    def unreadable(*args):
        raise ValueError("Official roster discovery did not return a PDF")

    monkeypatch.setattr(reference, "fingerprint", unreadable)
    token = claim(engine)
    with pytest.raises(ValueError):
        reference.run(engine, source="roster", name=JOB.name, token=token)
    assert not signalled(engine)
    saved = runner.load_progress(engine, JOB.name, token)
    assert saved["source_fingerprint"] == {"sha256": "a" * 64}


def test_a_turn_without_its_lease_reads_nothing(engine, monkeypatch):
    monkeypatch.setattr(
        reference, "fingerprint", lambda *a: pytest.fail("read without a lease")
    )
    token = claim(engine)
    finish(engine, token)
    with pytest.raises(RuntimeError, match="no longer owns"):
        reference.run(engine, source="roster", name=JOB.name, token=token)


class Response:
    def __init__(self, status=200, body=b"", headers=None):
        self.status_code = status
        self.body = body
        self.headers = headers or {}

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False

    def raise_for_status(self):
        if self.status_code >= 400:
            raise RuntimeError(self.status_code)

    def iter_content(self, size):
        for start in range(0, len(self.body), size):
            yield self.body[start : start + size]


def http_answering(response):
    return SimpleNamespace(
        get=lambda url, **kw: response, head=lambda url, **kw: response
    )


def test_roster_unchanged_validator_reuses_the_held_fingerprint():
    held = {"sha256": "a" * 64, "etag": '"1"', "last_modified": None}
    assert reference.fingerprint("roster", http_answering(Response(304)), held) == held
    with pytest.raises(ValueError, match="no held discovery fingerprint"):
        reference.fingerprint("roster", http_answering(Response(304)), {"etag": '"1"'})


@pytest.mark.parametrize(
    "body, message",
    [
        (b"<html>maintenance</html>", "did not return a PDF"),
        (b"", "was empty"),
        (b"%PDF-" + b"0" * 5_000_001, "byte budget"),
    ],
    ids=["html", "empty", "oversize"],
)
def test_roster_malformed_responses_are_refused(body, message):
    with pytest.raises(ValueError, match=message):
        reference.fingerprint("roster", http_answering(Response(200, body)), {})


def test_map_release_without_validators_leaves_full_reconciliation_due(monkeypatch):
    monkeypatch.setattr(
        reference, "current_map_links", lambda body: {"house": "https://x/h.pdf"}
    )
    http = SimpleNamespace(
        get=lambda url, **kw: Response(200, b"<html>index</html>"),
        head=lambda url, **kw: Response(200, headers={}),
    )
    with pytest.raises(ValueError, match="full byte reconciliation remains due"):
        reference.fingerprint("maps", http, {})
