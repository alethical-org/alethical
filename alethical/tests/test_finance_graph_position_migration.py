"""Position metadata migrates without rebuilding summaries or changing source rows."""

import os
import subprocess
import sys
from pathlib import Path

from sqlalchemy import inspect, text
from sqlalchemy.orm import Session

from alethical.db import models as m
from scripts.check_schema_drift import ScratchDatabase, _local_base_url

ROOT = Path(__file__).resolve().parents[2]
PARENT = "0084_finance_employer_similarity"
HEAD = "0085_finance_graph_position"


def test_graph_position_migration_keeps_old_summary_unknown_and_source_unchanged():
    with ScratchDatabase(_local_base_url(), "finance_graph_position") as scratch:
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
                snapshot = m.CampaignFinanceSnapshot(
                    dataset=m.CampaignFinanceDataset.independent_expenditures,
                    download_id="position-migration-test",
                    source_url="https://example.test/independent.csv",
                    content_hash="a" * 64,
                    record_set_hash="b" * 64,
                    byte_size=100,
                    row_count=1,
                    status=m.CampaignFinanceSnapshotStatus.loaded,
                )
                db.add(snapshot)
                db.flush()
                db.add(
                    m.CampaignFinanceIndependentExpenditureRow(
                        snapshot_id=snapshot.id,
                        row_number=1,
                        spender_reg_num="40100",
                        vendor_name="Example vendor",
                        for_against=" For Example, Jordan ",
                        year=2026,
                    )
                )
                db.execute(
                    m.CampaignFinanceGraphMoneySummary.__table__.insert().values(
                        snapshot_id=snapshot.id,
                        dataset=m.CampaignFinanceDataset.independent_expenditures,
                        account_number="40100",
                        printed_name="Example vendor",
                        year=2026,
                        record_count=1,
                        missing_amount_count=1,
                        undated_count=1,
                    )
                )
                db.commit()
            for direction, revision in (
                ("upgrade", HEAD),
                ("downgrade", PARENT),
                ("upgrade", HEAD),
            ):
                migrate(direction, revision)
                columns = {
                    column["name"]
                    for column in inspect(engine).get_columns("cf_graph_money_summary")
                }
                assert ("position" in columns) == (revision == HEAD)
                with engine.connect() as conn:
                    assert conn.execute(
                        text("SELECT for_against FROM cf_independent_expenditure_row")
                    ).scalars().all() == [" For Example, Jordan "]
                    assert conn.execute(
                        text(
                            "SELECT record_count, missing_amount_count, undated_count FROM cf_graph_money_summary"
                        )
                    ).all() == [(1, 1, 1)]
                    if revision == HEAD:
                        assert conn.execute(
                            text("SELECT position FROM cf_graph_money_summary")
                        ).scalars().all() == [None]
        finally:
            engine.dispose()
