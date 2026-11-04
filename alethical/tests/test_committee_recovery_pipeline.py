"""Local Postgres wire proof; the proxy only accepts disposable test connections."""

import select as sockets
import socket
import threading
import time
from contextlib import contextmanager

import pytest

from sqlalchemy import create_engine, text
from sqlalchemy.orm import Session

from alethical.db.session import NO_PREPARED_STATEMENTS
from alethical.pipeline import bill_action_committee_backfill as recovery
from alethical.pipeline import committee_recovery_batch as batch
from alethical.tests import test_committee_recovery_batch as batch_tests

setup = batch_tests.setup


@contextmanager
def protocol_proxy(engine, *, delay=0):
    """Count server ReadyForQuery boundaries; optional synthetic RTT, never production."""
    assert engine.url.host == "127.0.0.1"
    assert engine.url.database == "alethical"
    listener = socket.socket()
    listener.bind(("127.0.0.1", 0))
    listener.listen()
    listener.settimeout(0.1)
    stopped = threading.Event()
    workers = []
    state = {"ready": 0}
    lock = threading.Lock()

    def serve(client):
        upstream = socket.create_connection((engine.url.host, engine.url.port))
        client.setsockopt(socket.IPPROTO_TCP, socket.TCP_NODELAY, 1)
        upstream.setsockopt(socket.IPPROTO_TCP, socket.TCP_NODELAY, 1)
        pending = bytearray()
        try:
            while not stopped.is_set():
                readable, _, _ = sockets.select([client, upstream], [], [], 0.1)
                for incoming in readable:
                    chunk = incoming.recv(65536)
                    if not chunk:
                        return
                    if incoming is client:
                        upstream.sendall(chunk)
                    else:
                        # sslmode=disable guarantees framed server messages.
                        pending.extend(chunk)
                        while len(pending) >= 5:
                            size = int.from_bytes(pending[1:5], "big") + 1
                            if len(pending) < size:
                                break
                            if pending[0] == ord("Z"):
                                with lock:
                                    state["ready"] += 1
                                if delay:
                                    time.sleep(delay)
                            client.sendall(pending[:size])
                            del pending[:size]
        finally:
            upstream.close()
            client.close()

    def accept():
        while not stopped.is_set():
            try:
                client, _ = listener.accept()
            except socket.timeout:
                continue
            worker = threading.Thread(target=serve, args=(client,), daemon=True)
            workers.append(worker)
            worker.start()

    thread = threading.Thread(target=accept, daemon=True)
    thread.start()
    proxied = create_engine(
        engine.url.set(port=listener.getsockname()[1]),
        connect_args={**NO_PREPARED_STATEMENTS, "sslmode": "disable"},
    )
    try:
        yield proxied, state
    finally:
        proxied.dispose()
        stopped.set()
        thread.join(2)
        listener.close()
        for worker in workers:
            worker.join(2)
        assert not thread.is_alive() and all(
            not worker.is_alive() for worker in workers
        )


def test_paired_timeout_query_synchronizes_once(setup):
    engine, _, _, _ = setup
    with protocol_proxy(engine) as (proxied, state), Session(proxied) as db:
        db.execute(text("SELECT 1"))  # Start transaction before measuring one pair.
        before = state["ready"]
        with batch.sql_deadline(proxied, time.monotonic() + 10):
            row = (
                recovery.execute(
                    db,
                    text(
                        "SELECT 42 AS answer, current_setting('statement_timeout') AS timeout"
                    ),
                    deadline=time.monotonic() + 3,
                )
                .mappings()
                .one()
            )
        assert row["answer"] == 42
        assert state["ready"] - before == 1


@pytest.mark.parametrize("delay", [0, 0.0325])
def test_measure_turn_protocol_stages(setup, monkeypatch, delay):
    import json

    engine, root, _, client = setup
    original = batch.stage
    measured = {}
    with protocol_proxy(engine, delay=delay) as (proxied, state):

        @contextmanager
        def counted(seconds, name):
            before = state["ready"]
            start = time.monotonic()
            try:
                with original(seconds, name):
                    yield
            finally:
                measured[name] = {
                    "ready_boundaries": state["ready"] - before,
                    "seconds": time.monotonic() - start,
                }

        monkeypatch.setattr(batch, "stage", counted)
        answer = batch.run_turn(proxied, root, "local", apply=True, client=client)
    print(
        "PROTOCOL_MEASURE",
        json.dumps({"synthetic_delay": delay, "stages": measured}, sort_keys=True),
    )
    assert answer["status"] == "pass_finished"
    assert measured["apply"]["ready_boundaries"] == 24


def test_no_pipeline_support_keeps_serial_deadline(setup, monkeypatch):
    import psycopg

    engine, _, _, _ = setup
    monkeypatch.setattr(psycopg.Pipeline, "is_supported", staticmethod(lambda: False))
    with protocol_proxy(engine) as (proxied, state), Session(proxied) as db:
        db.execute(text("SELECT 1"))
        before = state["ready"]
        with batch.sql_deadline(proxied, time.monotonic() + 10):
            answer = recovery.execute(
                db,
                text("SELECT current_setting('statement_timeout')"),
                deadline=time.monotonic() + 0.3,
            ).scalar()
        assert 0 < int(answer.removesuffix("ms")) <= 300
        assert state["ready"] - before == 2


def test_query_error_rolls_back_and_returns_usable_connection(setup):
    import psycopg
    from sqlalchemy.exc import DBAPIError
    from alethical.db import models as m

    engine, _, ids, _ = setup
    with pytest.raises(DBAPIError, match="division by zero"):
        with (
            batch.sql_deadline(engine, time.monotonic() + 5),
            Session(engine) as db,
            db.begin(),
        ):
            driver = db.connection().connection.driver_connection
            db.execute(
                text("UPDATE bill_action SET committee_id=:committee WHERE id=:id"),
                {"committee": ids[2], "id": ids[1]},
            )
            db.execute(text("SELECT 1/0"))
    assert driver.pgconn.pipeline_status == psycopg.pq.PipelineStatus.OFF
    with Session(engine) as db:
        assert db.get(m.BillAction, ids[1]).committee_id is None
        assert db.scalar(text("SELECT 1")) == 1


def test_receipt_and_commit_are_outside_query_pipeline(setup, monkeypatch):
    import psycopg
    from sqlalchemy import event
    from alethical.tests.test_committee_recovery_batch import COMMITTEE_BILL_XML, URL

    engine, root, _, _ = setup
    with Session(engine) as db:
        saved = recovery.plan(
            db,
            "94-2025-HF6666",
            COMMITTEE_BILL_XML,
            URL,
            source_generation=recovery.generation(db, "94-2025-HF6666"),
        )
    original = recovery.write_evidence
    observed = []
    with batch.sql_deadline(engine, time.monotonic() + 5), Session(engine) as db:
        driver = db.connection().connection.driver_connection

        def persist(path, value):
            assert driver.pgconn.pipeline_status == psycopg.pq.PipelineStatus.OFF
            observed.append("receipt")
            return original(path, value)

        def commit(connection):
            assert driver.pgconn.pipeline_status == psycopg.pq.PipelineStatus.OFF
            observed.append("commit")

        monkeypatch.setattr(recovery, "write_evidence", persist)
        event.listen(engine, "commit", commit)
        try:
            recovery.apply(
                db,
                saved,
                COMMITTEE_BILL_XML,
                root / "receipt.json",
                deadline=time.monotonic() + 3,
            )
            db.commit()
        finally:
            event.remove(engine, "commit", commit)
    assert observed == ["receipt", "commit"]


def test_no_params_and_many_keep_results_and_bounds(setup):
    engine, _, _, _ = setup
    with batch.sql_deadline(engine, time.monotonic() + 5), Session(engine) as db:
        assert (
            db.execute(text("SELECT 7").execution_options(no_parameters=True)).scalar()
            == 7
        )
        db.execute(
            text("CREATE TEMP TABLE pipeline_many_test(value integer) ON COMMIT DROP")
        )
        db.execute(
            text("INSERT INTO pipeline_many_test VALUES (:value)"),
            [{"value": 1}, {"value": 2}],
        )
        assert db.execute(
            text("SELECT value FROM pipeline_many_test ORDER BY value")
        ).scalars().all() == [1, 2]


def test_related_engine_does_not_inherit_another_recovery_deadline(setup):
    engine, _, _, _ = setup
    other = engine.execution_options()
    with batch.sql_deadline(engine, time.monotonic() - 1), Session(other) as db:
        assert (
            recovery.execute(
                db, text("SELECT 1"), deadline=time.monotonic() + 1
            ).scalar()
            == 1
        )
        db.commit()


def test_many_slow_statement_keeps_server_timeout(setup):
    from sqlalchemy.exc import DBAPIError

    engine, _, _, _ = setup
    with pytest.raises(DBAPIError, match="statement timeout"):
        with batch.sql_deadline(engine, time.monotonic() + 0.2), Session(engine) as db:
            db.execute(text("SELECT pg_sleep(:delay)"), [{"delay": 1}, {"delay": 1}])
    with Session(engine) as db:
        assert db.scalar(text("SELECT 1")) == 1
