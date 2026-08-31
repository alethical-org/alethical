"""Keep our own copy of every source Alethical's published writing cites.

Net: every published research piece and guide ends in a sources block promising a
reader they can go and check the record themselves. Minnesota can take that away with
nothing looking wrong: on 27 August 2026 the Board replaced a handbook in place 4 hours
after a guide quoting it posted, and 2 quoted sentences vanished; the same day, the
lobbying page behind our largest published figure started answering HTTP 200 with a page
reading "This page is not available". This table records where our own copy of each
cited document lives, and when Minnesota's copy was last confirmed to match it (#1798,
#1802).

One row per version rather than per address: the primary key is the address plus the
sha256 of the bytes it served, so a replaced document becomes a second row beside the
first and the copy a figure was published from survives the replacement.

The 3 columns named object_key, compressed_hash and mirrored_at are what makes the
existing second-copy job cover this table from the day it ships -- that job reads which
tables hold a stored body out of the schema rather than from a list (#1501).

Additive only: 1 new table, no enum, no existing row changed. The downgrade is a clean
drop, and it drops only the rows saying where the objects are -- the objects themselves
stay, because docs/architecture/campaign-finance-system-design.md 4.5 retains every
stored body indefinitely. Round-tripped upgrade -> downgrade -> upgrade against real
Postgres.

Revision ID: 0044_published_source_copy
Revises: 0043_bill_updated_at_visible
"""

import sqlalchemy as sa
from alembic import op

revision = "0044_published_source_copy"
down_revision = "0043_bill_updated_at_visible"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "published_source_copy",
        # The address exactly as a published piece cites it. What we promise a reader is
        # that this link shows them the record, so a different address serving the same
        # document is a different citation.
        sa.Column("url", sa.Text(), nullable=False),
        # sha256 of the response bytes, never of decoded text.
        sa.Column("content_hash", sa.String(length=64), nullable=False),
        # Not unique, unlike cf_report_document's: 2 addresses may serve byte-identical
        # documents, and the key is a hash of the bytes, so they share one object.
        sa.Column("object_key", sa.Text(), nullable=False),
        sa.Column("byte_size", sa.BigInteger(), nullable=False),
        sa.Column("compressed_hash", sa.String(length=64), nullable=False),
        sa.Column("compressed_byte_size", sa.BigInteger(), nullable=False),
        # No server default, matching cf_snapshot_body, cf_filing_snapshot and
        # cf_report_document: the model's default="gzip" is the one writer, so a second
        # default in the database would be a second answer nobody consults.
        sa.Column("compression", sa.String(length=20), nullable=False),
        # NULL until the object has been read back out of the second store and hashed.
        # The name of this column on this table is what makes the copy job cover it.
        sa.Column("mirrored_at", sa.DateTime(timezone=True), nullable=True),
        # What the server called it. Recorded because it is informative, and never
        # trusted: the address that served an error page in place of a PDF called itself
        # text/html, and the bytes are what decide.
        sa.Column("media_type", sa.String(length=120), nullable=True),
        # Which published pieces cite this address, by file name, so a person told the
        # document changed knows which page is affected.
        sa.Column("cited_by", sa.Text(), nullable=False),
        # The last time Minnesota's own copy still hashed to this row.
        sa.Column("last_confirmed_at", sa.DateTime(timezone=True), nullable=True),
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
        sa.PrimaryKeyConstraint("url", "content_hash"),
    )
    # No index on url alone: it is the primary key's first column, so the primary key's
    # own index already answers "every version we hold of this address".


def downgrade() -> None:
    op.drop_table("published_source_copy")
