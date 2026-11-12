"""Two-connection regressions for checked source history and section scope."""

from concurrent.futures import ThreadPoolExecutor
from copy import deepcopy
from datetime import UTC, datetime
import hashlib
import importlib
import time
from pathlib import Path
import os
import subprocess
import sys

import pytest
from sqlalchemy import create_engine
from scripts.local_checks import disposable_postgres
from threading import Event
from sqlalchemy import inspect, select, text
from sqlalchemy.orm import Session
from alembic.migration import MigrationContext
from alembic.operations import Operations
from alethical.db import models as m
from alethical.pipeline import election_source_readings as r
from alethical.pipeline.election_comparison import archive_source
from alethical.tests.test_election_comparison_storage import MemoryStore
from alethical.tests.test_election_source_reading_sections import section


@pytest.fixture(scope="module")
def isolated_engine():
    root = Path(__file__).resolve().parents[2]
    with disposable_postgres(root) as url:
        result = subprocess.run(
            [sys.executable, "-m", "alembic", "-c", "alembic.ini", "upgrade", "head"],
            cwd=root,
            env={**os.environ, "DATABASE_URL": url},
            capture_output=True,
            text=True,
        )
        assert result.returncode == 0, result.stderr
        engine = create_engine(url)
        try:
            yield engine
        finally:
            engine.dispose()


@pytest.mark.parametrize(
    "isolation", ["READ COMMITTED", "REPEATABLE READ", "SERIALIZABLE"]
)
def test_waiting_writer_cannot_admit_overlapping_section(isolated_engine, isolation):
    engine = isolated_engine
    body, first = section()
    body += ("\n% section concurrency probe " + isolation + "\n").encode()
    first["original_sha256"] = hashlib.sha256(body).hexdigest()
    second = deepcopy(first)
    second["reading_scope"]["cover"]["bounds"] = [1, 1, 611, 389]
    store = MemoryStore()
    with Session(engine) as setup, setup.begin():
        archive_source(setup, store, body)
    ready = Event()
    worker_pid = []
    evidence = {}

    def writer():
        with engine.connect().execution_options(
            isolation_level=isolation
        ) as connection:
            with Session(connection) as db, db.begin():
                db.scalar(text("SELECT count(*) FROM election_source_reading_decision"))
                worker_pid.append(db.scalar(text("SELECT pg_backend_pid()")))
                ready.set()
                try:
                    row = r.record_reading(
                        db,
                        store,
                        receipt=second,
                        decision="checked",
                        reviewed_by="independent synthetic",
                        reason="overlapping RR probe",
                        expected_previous_id=None,
                    )
                    return {"accepted": True, "subject": row.subject_key}
                except Exception as error:
                    evidence["error_type"] = type(error).__name__
                    return {"accepted": False}

    with Session(engine) as db:
        r.record_reading(
            db,
            store,
            receipt=first,
            decision="checked",
            reviewed_by="independent synthetic",
            reason="first held section",
            expected_previous_id=None,
        )
        first_pid = db.scalar(text("SELECT pg_backend_pid()"))
        with ThreadPoolExecutor(max_workers=1) as pool:
            future = pool.submit(writer)
            assert ready.wait(3)
            with engine.connect() as monitor:
                deadline = time.monotonic() + 3
                blocked = False
                while time.monotonic() < deadline and not future.done():
                    if first_pid in monitor.scalar(
                        text("SELECT pg_blocking_pids(:pid)"), {"pid": worker_pid[0]}
                    ):
                        blocked = True
                        break
                    time.sleep(0.01)
            assert blocked or (future.done() and not future.result()["accepted"]), (
                "Second writer neither waited nor rejected its isolation"
            )
            db.commit()
            result = future.result(timeout=5)
    with Session(engine) as check:
        count = check.scalar(
            select(__import__("sqlalchemy").func.count())
            .select_from(m.ElectionSourceReadingDecision)
            .where(
                m.ElectionSourceReadingDecision.original_sha256
                == first["original_sha256"],
                m.ElectionSourceReadingDecision.decision == "checked",
            )
        )
    evidence.update(
        original_sha256=first["original_sha256"],
        original_lock_wait_observed=blocked,
        second_writer_isolation=isolation,
        second_writer=result,
        current_checked_overlapping_subjects=count,
    )
    assert not result["accepted"], evidence
    assert count == 1, evidence


def test_downgrade_cannot_delete_concurrently_committed_history(isolated_engine):
    engine = isolated_engine
    migration = importlib.import_module(
        "alethical.alembic.versions.0098_election_source_provenance"
    )
    with Session(engine) as setup, setup.begin():
        source_hash = archive_source(
            setup, MemoryStore(), b"independent downgrade concurrency source"
        )
    checked, resume, writer_started = Event(), Event(), Event()
    writer_pid = []
    evidence = {}
    original_op = migration.op

    def downgrade():
        with engine.begin() as connection:
            operations = Operations(MigrationContext.configure(connection))

            class Paused:
                def execute(self, statement, *args, **kwargs):
                    result = operations.execute(statement, *args, **kwargs)
                    if "Retain source provenance history" in str(statement):
                        checked.set()
                        assert resume.wait(4)
                    return result

                def __getattr__(self, name):
                    return getattr(operations, name)

            migration.op = Paused()
            try:
                migration.downgrade()
            finally:
                migration.op = original_op

    def writer():
        try:
            with Session(engine) as db, db.begin():
                writer_pid.append(db.scalar(text("SELECT pg_backend_pid()")))
                writer_started.set()
                row = m.ElectionSourceProvenanceDecision(
                    subject_key="a" * 64,
                    schema_id="retained-acquisition:v1",
                    receipt_sha256="b" * 64,
                    request_key="c" * 64,
                    primary_source_sha256=source_hash,
                    decision="checked",
                    receipt={"schema": "retained-acquisition:v1"},
                    evidence_sha256=hashlib.sha256(b"{}").hexdigest(),
                    evidence_body=b"{}",
                    reviewed_by="independent synthetic",
                    reason="downgrade race probe",
                    reviewed_at=datetime.now(UTC),
                )
                db.add(row)
                db.flush()
            return True
        except Exception as error:
            evidence["writer_error_type"] = type(error).__name__
            return False

    try:
        with ThreadPoolExecutor(max_workers=2) as pool:
            dropping = pool.submit(downgrade)
            assert checked.wait(3)
            inserting = pool.submit(writer)
            assert writer_started.wait(3)
            with engine.connect() as monitor:
                deadline = time.monotonic() + 2
                blocked = False
                while time.monotonic() < deadline and not inserting.done():
                    if monitor.scalar(
                        text("SELECT cardinality(pg_blocking_pids(:pid))"),
                        {"pid": writer_pid[0]},
                    ):
                        blocked = True
                        break
                    time.sleep(0.01)
            committed_before_drop = inserting.done() and inserting.result(timeout=1)
            resume.set()
            dropping.result(timeout=5)
            writer_committed = inserting.result(timeout=5)
        table_exists = inspect(engine).has_table("election_source_provenance_decision")
        evidence.update(
            writer_blocked_at_guard=blocked,
            writer_committed_before_drop=committed_before_drop,
            writer_committed=writer_committed,
            table_exists_after_downgrade=table_exists,
            committed_history_removed=writer_committed and not table_exists,
        )
        assert not evidence["committed_history_removed"], evidence
        assert evidence["writer_blocked_at_guard"], evidence
    finally:
        resume.set()
        migration.op = original_op
        if not inspect(engine).has_table("election_source_provenance_decision"):
            with engine.begin() as connection:
                migration.op = Operations(MigrationContext.configure(connection))
                try:
                    migration.upgrade()
                finally:
                    migration.op = original_op


@pytest.mark.parametrize("isolation", ["REPEATABLE READ", "SERIALIZABLE"])
def test_locked_proof_and_rollback_refuse_stale_snapshot(isolated_engine, isolation):
    from alethical.pipeline.election_comparison import ComparisonImportError

    with isolated_engine.connect().execution_options(
        isolation_level=isolation
    ) as connection:
        with Session(connection) as db, db.begin():
            db.scalar(text("SELECT count(*) FROM election_source_reading_decision"))
            # Ordinary pinned reads are valid. Publication must see fresh heads.
            assert (
                r.load_verified_reading_context(db, MemoryStore(), []).proof_outcomes
                == {}
            )
            with pytest.raises(ComparisonImportError, match="READ COMMITTED"):
                r.load_verified_reading_context(db, MemoryStore(), [], lock=True)
            migration = importlib.import_module(
                "alethical.alembic.versions.0098_election_source_provenance"
            )
            with Operations.context(MigrationContext.configure(connection)):
                with pytest.raises(RuntimeError, match="READ COMMITTED"):
                    migration.downgrade()
            assert inspect(connection).has_table("election_source_provenance_decision")
