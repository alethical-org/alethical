"""Employer similarity index upgrades and rolls back without rewriting records."""

import os
import subprocess
import sys
from pathlib import Path

import pytest

from sqlalchemy import text
from scripts.check_schema_drift import ScratchDatabase, _local_base_url

ROOT = Path(__file__).resolve().parents[2]
HEAD = "0084_finance_employer_similarity"
PARENT = "0083_fcc_observation_station"
INDEX = "ix_cf_contribution_row_employer_trgm"


@pytest.mark.parametrize(
    "table,column,index,dataset",
    [
        ("cf_contribution_row", "contrib_employer_name", INDEX, "contributions"),
        (
            "cf_independent_expenditure_row",
            "vendor_name",
            "ix_cf_independent_expenditure_row_vendor_trgm",
            "independent_expenditures",
        ),
    ],
)
def test_employer_similarity_index_round_trip(table, column, index, dataset):
    with ScratchDatabase(_local_base_url(), "employer_similarity") as scratch:
        engine = scratch.engine()

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
                    "DATABASE_URL": scratch.url.render_as_string(hide_password=False),
                    "ALETHICAL_DATABASE_TARGET": "local",
                },
                capture_output=True,
                text=True,
            )
            assert result.returncode == 0, result.stdout + result.stderr

        try:
            migrate("upgrade", PARENT)
            with engine.begin() as connection:
                connection.execute(
                    text(
                        f"""INSERT INTO cf_snapshot (id,dataset,download_id,source_url,content_hash,record_set_hash,byte_size,row_count,status,validation_json) VALUES ('11111111-1111-1111-1111-111111111111','{dataset}','test','https://example.test/file','a','b',1,1,'loaded','{{}}')"""
                    )
                )
                connection.execute(
                    text(
                        f"""INSERT INTO {table} (snapshot_id,row_number,{column}) VALUES ('11111111-1111-1111-1111-111111111111',1,' Exact Employer Assn. ')"""
                    )
                )
                connection.execute(
                    text(
                        f"INSERT INTO {table} (snapshot_id,row_number,{column}) SELECT '11111111-1111-1111-1111-111111111111', i, md5(i::text) FROM generate_series(2,5001) i"
                    )
                )
                connection.execute(text(f"ANALYZE {table}"))
            for direction, revision in [
                ("upgrade", HEAD),
                ("downgrade", PARENT),
                ("upgrade", HEAD),
            ]:
                migrate(direction, revision)
                with engine.connect() as connection:
                    valid = connection.scalar(
                        text(
                            "SELECT indisvalid FROM pg_index WHERE indexrelid=to_regclass(:name)"
                        ),
                        {"name": index},
                    )
                    assert valid is (True if revision == HEAD else None)
                    assert (
                        connection.scalar(
                            text(f"SELECT {column} FROM {table} WHERE row_number=1")
                        )
                        == " Exact Employer Assn. "
                    )
                    if revision == HEAD:
                        connection.execute(text("SET LOCAL enable_seqscan = off"))
                        plan = "\n".join(
                            connection.scalars(
                                text(
                                    f"EXPLAIN SELECT {column} FROM {table} WHERE {column} % 'Exact Employer Association'"
                                )
                            )
                        )
                        assert index in plan, plan
        finally:
            engine.dispose()
