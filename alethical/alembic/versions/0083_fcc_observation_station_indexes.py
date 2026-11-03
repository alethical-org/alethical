"""Read one station's TV folder and file outcomes without scanning every scan.

The TV station page, the Media buys sources line and each file's download
outcome read the newest observation per folder or file for 1 station. The only
index leads with the scan, so each read scanned about 1.2 million rows and took
10 to 18 seconds. Two partial indexes hold just the folder rows and the file
outcome rows, keyed by station in the order those reads sort. No source rows
change. Build concurrently to keep scans and reads open. An interrupted build's
invalid index is removed on retry before rebuilding.

Revision ID: 0083_fcc_observation_station
Revises: 0082_identity_source_reference
"""

from alembic import op
from sqlalchemy import text

revision = "0083_fcc_observation_station"
down_revision = "0082_identity_source_reference"
branch_labels = None
depends_on = None

INDEXES = {
    "ix_fcc_observation_station_folder": (
        "(facility_id, url, observed_at DESC, scan_id DESC) INCLUDE (status) "
        "WHERE kind = 'folder'"
    ),
    "ix_fcc_observation_station_file_outcome": (
        "(facility_id, (details ->> 'file_id'), observed_at DESC, scan_id DESC) "
        "INCLUDE (status) "
        "WHERE kind = 'file' AND status IN ('stored', 'failed', 'unavailable') "
        "AND (details ->> 'file_id') IS NOT NULL"
    ),
}


def upgrade() -> None:
    with op.get_context().autocommit_block():
        for name, definition in INDEXES.items():
            valid = op.get_bind().scalar(
                text(
                    "SELECT indisvalid FROM pg_index WHERE indexrelid = to_regclass(:name)"
                ),
                {"name": "public." + name},
            )
            if valid is False:
                op.execute(f"DROP INDEX CONCURRENTLY public.{name}")
            op.execute(
                f"CREATE INDEX CONCURRENTLY IF NOT EXISTS {name} "
                f"ON public.fcc_observation {definition}"
            )


def downgrade() -> None:
    with op.get_context().autocommit_block():
        for name in INDEXES:
            op.execute(f"DROP INDEX CONCURRENTLY IF EXISTS public.{name}")
