"""The collector's per-file indexes migrate both ways and serve its reads."""

import os
from pathlib import Path
import subprocess
import sys

from sqlalchemy import inspect, select, text
from sqlalchemy.orm import Session

from alethical.db import models as m
from alethical.pipeline import fcc_archive as archive
from scripts.check_schema_drift import ScratchDatabase, _local_base_url

ROOT = Path(__file__).resolve().parents[2]
HEAD = "0086_fcc_observation_file_reads"
PARENT = "0085_finance_graph_position"
ATTEMPT = "ix_fcc_observation_file_attempt"
HISTORY = "ix_fcc_observation_file_history"
# Each collector read (alethical/pipeline/fcc_archive.py) and the index it uses.
READS = {
    archive.LATEST_ATTEMPT: ATTEMPT,
    archive.LATEST_BASELINE: HISTORY,
    archive.FIRST_LISTED: HISTORY,
}


def test_file_read_indexes_upgrade_downgrade_upgrade():
    with ScratchDatabase(_local_base_url(), "fcc_observation_file_reads") as scratch:
        engine = scratch.engine()
        try:

            def migrate(direction, revision):
                result = subprocess.run(
                    [
                        sys.executable,
                        "-m",
                        "alembic",
                        "-c",
                        "alembic.ini",
                        direction,
                        revision,
                    ],
                    cwd=ROOT,
                    env={
                        **os.environ,
                        "DATABASE_URL": scratch.url.render_as_string(
                            hide_password=False
                        ),
                        "ALETHICAL_DATABASE_TARGET": "local",
                    },
                    capture_output=True,
                    text=True,
                    check=False,
                )
                assert result.returncode == 0, result.stdout + result.stderr

            migrate("upgrade", PARENT)
            with Session(engine) as db:
                # Like production: each scan lists every file again, and most
                # observations are unchanged listings.
                for run in range(8):
                    scan = m.FCCScan(status="complete", stations=["68883"])
                    db.add(scan)
                    db.flush()
                    for n in range(40):
                        db.add(
                            m.FCCObservation(
                                scan_id=scan.id,
                                url=f"https://example.test/file/{n}",
                                facility_id="68883",
                                kind="file",
                                status="deferred"
                                if n % 10 == 0
                                else "failed"
                                if run == 0 and n % 2
                                else "unchanged",
                                details={"file_id": f"f{n}"},
                            )
                        )
                db.commit()

            def held():
                with engine.connect() as db:
                    return db.execute(
                        select(
                            m.FCCObservation.scan_id,
                            m.FCCObservation.url,
                            m.FCCObservation.status,
                        ).order_by(m.FCCObservation.scan_id, m.FCCObservation.url)
                    ).all()

            before = held()
            for direction, revision in (
                ("upgrade", HEAD),
                ("downgrade", PARENT),
                ("upgrade", HEAD),
            ):
                migrate(direction, revision)
                names = {
                    i["name"] for i in inspect(engine).get_indexes("fcc_observation")
                }
                assert (
                    {ATTEMPT, HISTORY} <= names
                    if revision == HEAD
                    else not ({ATTEMPT, HISTORY} & names)
                )
                assert held() == before
            with engine.connect() as db:
                for name in (ATTEMPT, HISTORY):
                    assert db.scalar(
                        text(
                            "SELECT indisvalid FROM pg_index WHERE indexrelid = to_regclass(:name)"
                        ),
                        {"name": name},
                    )
                # Small tables favour a table scan, so rule that out; each read
                # must then reach its own index.
                db.execute(text("ANALYZE fcc_observation"))
                db.execute(text("SET enable_seqscan = off"))
                listed = {
                    "facilities": ["68883", "68883"],
                    "file_ids": ["f1", "f2"],
                }
                for read, name in READS.items():
                    plan = "\n".join(
                        db.scalars(
                            text(
                                "EXPLAIN " + archive.FOR_LISTED_FILES.format(read=read)
                            ),
                            listed,
                        )
                    )
                    assert name in plan, plan
        finally:
            engine.dispose()
