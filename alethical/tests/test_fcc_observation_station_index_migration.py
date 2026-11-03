"""The station observation indexes migrate both ways and serve the station reads."""

import os
from pathlib import Path
import subprocess
import sys

from sqlalchemy import inspect, select, text
from sqlalchemy.orm import Session

from alethical.db import models as m
from scripts.check_schema_drift import ScratchDatabase, _local_base_url

ROOT = Path(__file__).resolve().parents[2]
HEAD = "0083_fcc_observation_station"
PARENT = "0082_identity_source_reference"
FOLDER = "ix_fcc_observation_station_folder"
OUTCOME = "ix_fcc_observation_station_file_outcome"

# The 3 reads that scanned every observation (alethical/api/services/tv_ads.py:
# counts' download outcomes, station_detail's folder failures, sources' last
# folder listing), each for 1 station.
READS = {
    OUTCOME: """SELECT DISTINCT ON (facility_id,details->>'file_id')
      facility_id,details->>'file_id' file_id,status
      FROM fcc_observation WHERE kind='file' AND status IN ('stored','failed','unavailable')
      AND details->>'file_id' IS NOT NULL AND facility_id IN ('28010','23079','68883')
      AND facility_id='68883'
      ORDER BY facility_id,details->>'file_id',observed_at DESC,scan_id DESC""",
    FOLDER: """SELECT DISTINCT ON (url) status FROM fcc_observation
      WHERE facility_id='68883' AND kind='folder' ORDER BY url,observed_at DESC,scan_id DESC""",
}


def test_station_observation_indexes_upgrade_downgrade_upgrade():
    with ScratchDatabase(_local_base_url(), "fcc_observation_station") as scratch:
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
                            status="failed" if n % 2 else "stored",
                            details={"file_id": f"f{n}"},
                        )
                    )
                    db.add(
                        m.FCCObservation(
                            scan_id=scan.id,
                            url=f"https://example.test/folder/{n}",
                            facility_id="68883",
                            kind="folder",
                            status="stored",
                        )
                    )
                db.commit()

            def held():
                with engine.connect() as db:
                    return db.execute(
                        select(m.FCCObservation.url, m.FCCObservation.status).order_by(
                            m.FCCObservation.url
                        )
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
                    {FOLDER, OUTCOME} <= names
                    if revision == HEAD
                    else not ({FOLDER, OUTCOME} & names)
                )
                assert held() == before
            with engine.connect() as db:
                for name in (FOLDER, OUTCOME):
                    assert db.scalar(
                        text(
                            "SELECT indisvalid FROM pg_index WHERE indexrelid = to_regclass(:name)"
                        ),
                        {"name": name},
                    )
                # Small tables favour a table scan, so rule that out; the read must
                # then reach its own index, not the scan-first status index.
                db.execute(text("ANALYZE fcc_observation"))
                db.execute(text("SET enable_seqscan = off"))
                for name, read in READS.items():
                    plan = "\n".join(db.scalars(text("EXPLAIN " + read)))
                    assert name in plan, plan
        finally:
            engine.dispose()
