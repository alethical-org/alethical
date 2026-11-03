"""The graph money summary table migrates both ways without touching payment rows."""

import os
import subprocess
import sys
from pathlib import Path

from sqlalchemy import inspect, select
from sqlalchemy.orm import Session

from alethical.db import models as m
from scripts.check_schema_drift import ScratchDatabase, _local_base_url

ROOT = Path(__file__).resolve().parents[2]
HEAD = "0081_cf_graph_money_summary"
PARENT = "0080_cf_graph_metadata_index"
TABLE = "cf_graph_money_summary"
INDEX = "ix_cf_graph_money_summary_snapshot_year"
ACCOUNT_INDEX = "ix_cf_graph_money_summary_snapshot_account"


def test_graph_money_summary_upgrade_downgrade_upgrade():
    with ScratchDatabase(_local_base_url(), "finance_graph_summary") as scratch:
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
                source = m.CampaignFinanceSnapshot(
                    dataset=m.CampaignFinanceDataset.contributions,
                    download_id="graph-summary-test",
                    source_url="https://example.test/gifts.csv",
                    content_hash="a" * 64,
                    record_set_hash="b" * 64,
                    byte_size=100,
                    row_count=1,
                    status=m.CampaignFinanceSnapshotStatus.loaded,
                )
                db.add(source)
                db.flush()
                db.add(
                    m.CampaignFinanceContributionRow(
                        snapshot_id=source.id,
                        row_number=1,
                        recipient_reg_num="18135",
                        contributor="Example, Jordan A",
                        receipt_type="Contribution",
                        year=2026,
                    )
                )
                db.commit()
                snapshot_id = source.id
            for direction, revision in (
                ("upgrade", HEAD),
                ("downgrade", PARENT),
                ("upgrade", HEAD),
            ):
                migrate(direction, revision)
                inspector = inspect(engine)
                assert inspector.has_table(TABLE) == (revision == HEAD)
                with Session(engine) as db:
                    # The payment rows are never touched by either direction.
                    assert db.scalars(
                        select(m.CampaignFinanceContributionRow.contributor)
                    ).all() == ["Example, Jordan A"]
                    if revision == HEAD:
                        indexes = {i["name"]: i for i in inspector.get_indexes(TABLE)}
                        assert indexes[INDEX]["column_names"] == ["snapshot_id", "year"]
                        assert indexes[ACCOUNT_INDEX]["column_names"] == [
                            "snapshot_id",
                            "account_number",
                        ]
                        db.add(
                            m.CampaignFinanceGraphMoneySummary(
                                snapshot_id=snapshot_id,
                                dataset=m.CampaignFinanceDataset.contributions,
                                account_number="18135",
                                printed_name="Example, Jordan A",
                                year=2026,
                                record_count=1,
                                missing_amount_count=1,
                                undated_count=1,
                            )
                        )
                        db.commit()
                        assert (
                            db.scalar(
                                select(m.CampaignFinanceGraphMoneySummary.record_count)
                            )
                            == 1
                        )
        finally:
            engine.dispose()
