"""The identity name summary tables migrate both ways without touching payment rows."""

import os
import subprocess
import sys
from pathlib import Path

from sqlalchemy import inspect, select
from sqlalchemy.orm import Session

from alethical.db import models as m
from alethical.pipeline import campaign_finance_name_summary as name_summary
from scripts.check_schema_drift import ScratchDatabase, _local_base_url

ROOT = Path(__file__).resolve().parents[2]
HEAD = "0087_identity_name_summary"
PARENT = "0086_fcc_observation_file_reads"
TABLES = ("cf_identity_name_summary", "cf_identity_name_summary_build")


def test_identity_name_summary_upgrade_downgrade_upgrade():
    with ScratchDatabase(_local_base_url(), "identity_name_summary") as scratch:
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
                    download_id="name-summary-test",
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
                for table in TABLES:
                    assert inspector.has_table(table) == (revision == HEAD)
                with Session(engine) as db:
                    # The payment rows are never touched by either direction.
                    assert db.scalars(
                        select(m.CampaignFinanceContributionRow.contributor)
                    ).all() == ["Example, Jordan A"]
            # The summary builds on the migrated tables, and its sort amount is
            # generated from the same rule the queue applies.
            with Session(engine) as db:
                assert (
                    name_summary.rebuild(
                        db, m.CampaignFinanceDataset.contributions, snapshot_id
                    )
                    == 1
                )
                db.commit()
                row = db.scalars(
                    select(m.CampaignFinanceIdentityNameSummary).where(
                        m.CampaignFinanceIdentityNameSummary.record_kind == "donor_name"
                    )
                ).one()
                assert (row.records, row.amount, row.missing_amounts) == (1, None, 1)
                assert row.sort_amount is None
                assert name_summary.held(
                    db, m.CampaignFinanceDataset.contributions, [snapshot_id]
                ) == {snapshot_id}
        finally:
            engine.dispose()
