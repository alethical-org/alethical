"""Extraction workers must never reload caller-session state after a commit."""

from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor
from threading import Event, get_ident

import pytest
from sqlalchemy import delete, event, func, select
from sqlalchemy.exc import InvalidRequestError

from alethical.db import models as m
from alethical.db.session import get_session_factory
from alethical.pipeline import fcc_archive as archive
from alethical.pipeline import fcc_document_text as text_reader
from alethical.pipeline.fcc_document_text import Extraction, PageText
from alethical.tests.test_raw_file_mirror import MemoryStore


@pytest.fixture()
def db(seed_database):
    session = get_session_factory()()

    def clear():
        session.rollback()
        for model in (
            m.FCCExpenseLink,
            m.FCCPage,
            m.FCCExtraction,
            m.FCCDocument,
            m.FCCObservation,
            m.FCCScan,
            m.FCCSourceBody,
        ):
            session.execute(delete(model))
        session.commit()

    clear()
    try:
        yield session
    finally:
        clear()
        session.close()


def _documents(db, store, count=8):
    digests = []
    for index in range(count):
        body = f"%PDF-1.3\nSynthetic worker document {index}".encode()
        digest = archive.archive_body(db, store, body)
        db.add(
            m.FCCDocument(
                facility_id="test-station",
                file_id=f"test-file-{index}",
                content_hash=digest,
                call_sign="TEST-TV",
                folder_id="test-folder",
                folder_path="political-files/2026/test",
                name=f"Synthetic document {index}",
                url=f"https://publicfiles.fcc.gov/test-file-{index}.pdf",
                year=2026,
            )
        )
        digests.append(digest)
    db.commit()
    return sorted(digests)


def _first_commit_gate(monkeypatch, completed):
    class GatedPool:
        def __init__(self, max_workers):
            self.pool = ThreadPoolExecutor(max_workers=max_workers)

        def __enter__(self):
            self.pool.__enter__()
            return self

        def __exit__(self, *arguments):
            return self.pool.__exit__(*arguments)

        def map(self, function, inputs):
            def run(indexed):
                index, payload = indexed
                if index:
                    assert completed.wait(5), "coordinator did not commit first result"
                return function(payload)

            return self.pool.map(run, enumerate(inputs))

    monkeypatch.setattr(archive, "ThreadPoolExecutor", GatedPool)


def _reading(body, name):
    assert body.startswith(b"%PDF-1.3\nSynthetic worker document ")
    assert name.startswith("Synthetic document ")
    return Extraction(
        pages=[PageText(1, "Synthetic searchable document", "test", "extracted")],
        document_kind="unknown",
        facts=[],
        status="pending_review",
    )


@pytest.mark.parametrize("expire_on_commit", [True, False])
def test_workers_do_not_touch_session_after_results_commit(
    db, monkeypatch, expire_on_commit
):
    """Later jobs start only after a real commit expired every loaded ORM row.

    Denying worker SQL deterministically exposes the unsafe lazy load instead of
    depending on the timing of an actual shared-connection provisioning race.
    The false setting is the control: the old implementation only fails when
    commit expires the shared ORM objects, which is the production default.
    """
    db.expire_on_commit = expire_on_commit
    store = MemoryStore()
    digests = _documents(db, store)
    first_commit = Event()
    _first_commit_gate(monkeypatch, first_commit)
    monkeypatch.setattr(text_reader, "extract_document", _reading)
    owner = get_ident()
    worker_queries = []

    def deny_worker_database_access(state):
        if get_ident() != owner:
            worker_queries.append({"column_reload": state.is_column_load})
            raise InvalidRequestError("extraction worker accessed coordinator session")

    event.listen(db, "do_orm_execute", deny_worker_database_access)
    logs = []

    def log(row):
        # extract_pending logs only after committing the corresponding result.
        logs.append(row)
        first_commit.set()

    try:
        result = archive.extract_pending(db, store, limit=8, workers=4, log=log)
    finally:
        first_commit.set()
        event.remove(db, "do_orm_execute", deny_worker_database_access)
    assert worker_queries == []
    assert result == {"pending_review": 8}
    assert [row["content_hash"] for row in logs] == digests
    assert db.scalar(select(func.count()).select_from(m.FCCExtraction)) == 8
    assert db.scalar(select(func.count()).select_from(m.FCCPage)) == 8
    assert archive.extract_pending(db, store, limit=8, workers=4) == {}


def test_failed_reads_keep_plain_digest_after_prior_result_commit(db, monkeypatch):
    """A later failed read must not reload an expired digest even in its handler."""
    store = MemoryStore()
    digests = _documents(db, store, count=3)
    damaged = db.get(m.FCCSourceBody, digests[1])
    del store.objects[damaged.object_key]
    first_commit = Event()
    _first_commit_gate(monkeypatch, first_commit)
    monkeypatch.setattr(text_reader, "extract_document", _reading)
    logs = []

    def log(row):
        logs.append(row)
        first_commit.set()

    result = archive.extract_pending(db, store, limit=3, workers=2, log=log)
    assert result == {"pending_review": 2, "failed": 1}
    assert logs[1] == {"content_hash": digests[1], "status": "KeyError"}
    assert db.get(m.FCCExtraction, (digests[1], text_reader.EXTRACTOR_VERSION)) is None
    assert db.scalar(select(func.count()).select_from(m.FCCSourceBody)) == 3
