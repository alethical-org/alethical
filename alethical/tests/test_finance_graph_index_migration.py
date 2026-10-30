"""The graph metadata index migrates both ways without changing payments."""

import os
from pathlib import Path
import subprocess
import sys

import pytest
from sqlalchemy import inspect, select, text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from alethical.db import models as m
from scripts.check_schema_drift import ScratchDatabase, _local_base_url

ROOT = Path(__file__).resolve().parents[2]
HEAD = "0080_cf_graph_metadata_index"
PARENT = "0079_finance_copy_withdrawal"
INDEX = "ix_cf_expenditure_row_snapshot_year_metadata"


def test_graph_metadata_index_upgrade_downgrade_upgrade():
    with ScratchDatabase(_local_base_url(), "finance_graph_index") as scratch:
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
                    dataset=m.CampaignFinanceDataset.expenditures,
                    download_id="graph-index-test",
                    source_url="https://example.test/payments.csv",
                    content_hash="a" * 64,
                    record_set_hash="b" * 64,
                    byte_size=100,
                    row_count=2,
                    status=m.CampaignFinanceSnapshotStatus.loaded,
                )
                db.add(source)
                db.flush()
                db.add(
                    m.CampaignFinanceExpenditureRow(
                        snapshot_id=source.id,
                        row_number=1,
                        year=2026,
                        type="Contribution",
                        affected_committee_reg_num="123",
                    )
                )
                db.add(
                    m.CampaignFinanceExpenditureRow(
                        snapshot_id=source.id,
                        row_number=2,
                        year=2026,
                        type="Payment",
                        affected_committee_reg_num="456",
                    )
                )
                db.commit()
            for direction, revision in (
                ("upgrade", HEAD),
                ("downgrade", PARENT),
                ("upgrade", HEAD),
            ):
                migrate(direction, revision)
                indexes = {
                    i["name"]: i
                    for i in inspect(engine).get_indexes("cf_expenditure_row")
                }
                assert (INDEX in indexes) == (revision == HEAD)
                with engine.connect() as db:
                    assert db.execute(
                        select(
                            m.CampaignFinanceExpenditureRow.year,
                            m.CampaignFinanceExpenditureRow.affected_committee_reg_num,
                        ).order_by(m.CampaignFinanceExpenditureRow.row_number)
                    ).all() == [(2026, "123"), (2026, "456")]
                    if revision == HEAD:
                        assert db.scalar(
                            text(
                                "SELECT indisvalid FROM pg_index WHERE indexrelid = to_regclass(:name)"
                            ),
                            {"name": INDEX},
                        )
                        assert indexes[INDEX]["column_names"] == ["snapshot_id", "year"]
                        assert indexes[INDEX]["include_columns"] == [
                            "type",
                            "affected_committee_reg_num",
                        ]
                if revision == PARENT:
                    # A failed concurrent build leaves an invalid named index.
                    # The next upgrade must replace it, not skip IF NOT EXISTS.
                    with engine.connect().execution_options(
                        isolation_level="AUTOCOMMIT"
                    ) as db:
                        with pytest.raises(IntegrityError):
                            db.execute(
                                text(
                                    f"CREATE UNIQUE INDEX CONCURRENTLY {INDEX} "
                                    "ON public.cf_expenditure_row (year)"
                                )
                            )
                        db.rollback()
                        assert (
                            db.scalar(
                                text(
                                    "SELECT indisvalid FROM pg_index WHERE indexrelid = to_regclass(:name)"
                                ),
                                {"name": INDEX},
                            )
                            is False
                        )
        finally:
            engine.dispose()
