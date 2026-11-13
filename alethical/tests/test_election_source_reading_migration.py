"""Real migration and two-connection publication/review lock boundaries."""

from concurrent.futures import ThreadPoolExecutor
import os
from pathlib import Path
import subprocess
import sys
import threading
import time

from sqlalchemy import create_engine, inspect, select, text
from sqlalchemy.orm import Session

from alethical.db import models as m
from alethical.pipeline import election_source_readings as r
from alethical.pipeline.election_comparison import archive_source
from alethical.tests.test_election_comparison_storage import MemoryStore
from alethical.tests.test_election_source_readings import reading
from scripts.local_checks import disposable_postgres


def test_reading_migration_roundtrip_and_publication_lock_serializes_withdrawal():
    root = Path(__file__).resolve().parents[2]
    with disposable_postgres(root) as url:
        engine = create_engine(url)
        try:
            for target, present in [
                ("head", True),
                ("0096_board_finance_seals", False),
                ("head", True),
            ]:
                direction = "downgrade" if not present else "upgrade"
                result = subprocess.run(
                    [
                        sys.executable,
                        "-m",
                        "alembic",
                        "-c",
                        "alembic.ini",
                        direction,
                        target,
                    ],
                    cwd=root,
                    env={**os.environ, "DATABASE_URL": url},
                    capture_output=True,
                    text=True,
                )
                assert result.returncode == 0, result.stderr
                assert (
                    inspect(engine).has_table("election_source_reading_decision")
                    is present
                )
            body, receipt = reading()
            store = MemoryStore()
            with Session(engine) as setup, setup.begin():
                archive_source(setup, store, body)
                first = r.record_reading(
                    setup,
                    store,
                    receipt=receipt,
                    decision="checked",
                    reviewed_by="private",
                    reason="Synthetic first check",
                    expected_previous_id=None,
                )
                receipt_hash, first_id = first.receipt_sha256, first.id
            ready = threading.Event()
            pid = []

            def withdraw():
                with Session(engine) as writer, writer.begin():
                    pid.append(writer.scalar(text("SELECT pg_backend_pid()")))
                    ready.set()
                    row = r.record_reading(
                        writer,
                        store,
                        receipt=receipt,
                        decision="withdrawn",
                        reviewed_by="private",
                        reason="Concurrent withdrawal",
                        expected_previous_id=first_id,
                    )
                    return row.id

            with ThreadPoolExecutor(max_workers=1) as pool:
                with Session(engine) as owner:
                    owner_pid = owner.scalar(text("SELECT pg_backend_pid()"))
                    r.load_verified_reading_context(
                        owner,
                        store,
                        [receipt_hash],
                        lock=True,
                        allowed_source_hashes={receipt["original_sha256"]},
                    )
                    future = pool.submit(withdraw)
                    assert ready.wait(2)
                    deadline = time.monotonic() + 5
                    blocked = False
                    while time.monotonic() < deadline and not future.done():
                        blocked = owner_pid in owner.scalar(
                            text("SELECT pg_blocking_pids(:pid)"), {"pid": pid[0]}
                        )
                        if blocked:
                            break
                        time.sleep(0.02)
                    assert blocked, (
                        "withdrawal did not wait for the publication proof lock"
                    )
                    assert not future.done()
                    owner.rollback()
                assert future.result(timeout=10) > first_id
            with Session(engine) as check:
                heads = r.reading_heads(check, [receipt_hash])
                assert heads[receipt_hash]["decision"] == "withdrawn"
                assert (
                    check.scalar(
                        select(m.ElectionSourceReadingDecision.id).where(
                            m.ElectionSourceReadingDecision.id == first_id
                        )
                    )
                    == first_id
                )
        finally:
            engine.dispose()
