"""Keep the bytes of every report document we read, not just its hash.

Net: the check that finds money Minnesota named and our download omitted reads each
committee's own filed report, records that report's sha256, and throws the report away.
The Board publishes no archive, refuses most documents older than 2023, and answers HTTP
200 with an HTML page for the ones it will not serve -- so a figure published from a
document we did not keep can never be traced back to it. This table records where each
document's bytes now live (#1501).

Additive only: 1 new table, no enum, no existing row changed. The downgrade is a clean
drop, and it drops only the row that says where the object is -- the object itself stays,
because §4.5 retains every body indefinitely. Round-tripped upgrade -> downgrade ->
upgrade against real Postgres.

Design: docs/architecture/campaign-finance-system-design.md §4.5 (where the downloaded
files live, and for how long) and §9.4 (report PDFs are a fallback, not a route).

Revision ID: 0039_cf_report_document
Revises: 0038_site_metric_event
"""

import sqlalchemy as sa
from alembic import op

revision = "0039_cf_report_document"
down_revision = "0038_site_metric_event"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "cf_report_document",
        # The document's own sha256, which is what cf_stated_split.document_hash already
        # records -- so a verdict resolves to its body by equality and needs no new
        # foreign key. Keyed on the bytes rather than on the filing so a re-fetch of an
        # unchanged document writes nothing and an amendment is a new row.
        sa.Column("document_hash", sa.String(length=64), nullable=False),
        sa.Column("object_key", sa.Text(), nullable=False),
        sa.Column("byte_size", sa.BigInteger(), nullable=False),
        sa.Column("compressed_hash", sa.String(length=64), nullable=False),
        sa.Column("compressed_byte_size", sa.BigInteger(), nullable=False),
        # No server default, matching cf_snapshot_body and cf_filing_snapshot: the
        # model's ``default="gzip"`` is the one writer, so a second default in the
        # database would be a second answer nobody consults.
        sa.Column("compression", sa.String(length=20), nullable=False),
        # NULL until the object has been read back out of the second store and hashed.
        # The name of this column on this table is what makes the copy job cover it --
        # that job discovers its work from the schema (object_key + compressed_hash +
        # mirrored_at) rather than from a list of tables somebody maintains.
        sa.Column("mirrored_at", sa.DateTime(timezone=True), nullable=True),
        # What the object cannot say about itself. Duplicated from cf_stated_split on
        # purpose: a verdict dies with the payment rows it describes, and the body
        # outlives it.
        sa.Column("registration_number", sa.String(length=20), nullable=False),
        sa.Column("filing_year", sa.Integer(), nullable=False),
        sa.Column("report_type", sa.String(length=8), nullable=True),
        sa.Column("amendment_index", sa.Integer(), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.PrimaryKeyConstraint("document_hash"),
        sa.UniqueConstraint("object_key"),
    )
    # "Which documents do we hold for this committee-year" is the read a person makes
    # when a figure is questioned.
    op.create_index(
        "ix_cf_report_document_filer_year",
        "cf_report_document",
        ["registration_number", "filing_year"],
    )


def downgrade() -> None:
    op.drop_index("ix_cf_report_document_filer_year", table_name="cf_report_document")
    op.drop_table("cf_report_document")
