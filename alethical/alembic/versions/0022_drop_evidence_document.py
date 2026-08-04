"""Drop evidence_document — 34,033 rows in production that nothing reads (#855).

The table came from a "representative evidence" feature applied to production
out-of-band from the unmerged branch ``codex/representative-lookup-followups``
(#288). It has never existed in ``models.py`` or in any migration, so no database
built from this repository has ever had it. Its columns (``authority_tier``,
``verified_identity``, ``retrieval_ready``, ``publisher``, ``speaker``) describe a
sourcing design the product did not keep.

**Nothing reads it**, established against live production Aug 4 2026 rather than by
grep: no inbound foreign key, no view, no rule, no trigger, no stored function, no
row-level-security policy (checked directly in ``pg_constraint``, ``pg_depend``,
``pg_rewrite``, ``pg_trigger``, ``pg_proc`` and ``pg_policies``); over ten minutes of
live traffic it took **1** index scan, from this session's own metadata queries,
while ``bill`` took 725. ``pg_stat_statements`` holds only ingestion-shaped
statements first seen 2026-06-13/14 plus the legislator-merge ``UPDATE``. The last
row was written 2026-06-14.

Its content is also regenerable rather than recorded: ``content`` reads "Dahms is
listed as co author. Grain indemnity account usage modification", assembled from
``bill`` and ``sponsorship`` rows we still hold.

**What makes this reversible.** ``downgrade`` rebuilds the table, its two indexes,
its check constraint and its two foreign keys, transcribed from the live table --
but a table shape is not the rows. The rows live in a dump taken before this ran,
and ``scripts/dump_evidence_document.py`` is what took it and what puts it back.
That dump was proven restorable, not merely taken: all 34,033 rows were loaded into
a scratch Postgres database and compared back against the dump, and every row
matched on all 17 columns, including the 62 rows carrying wrong-charset damage.

The upgrade re-checks the row count itself and aborts if the table has grown past
what the dump covers, because a backup that predates a late write is not a backup.
That guard is deliberately narrow: it catches growth, not an equal-sized churn, so
the operator still runs ``dump_evidence_document.py verify`` against production
immediately before merging. Two checks, and the migration owns the one that can
still be true at the moment it runs.

62 rows carried text stored after a wrong-charset decode (#849), which the repair in
that issue deliberately skipped because it could not fix them: 4 of them mix correct
UTF-8 with mangled UTF-8 in one string, which a whole-string re-decode cannot
recover. This removes those rows. It does not repair them.

Revision ID: 0022_drop_evidence_document
Revises: 0021_drop_legislator_is_active
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "0022_drop_evidence_document"
down_revision = "0021_drop_legislator_is_active"
branch_labels = None
depends_on = None

# The count at the moment the dump was taken, against live production Aug 4 2026.
DUMPED_ROWS = 34033


def upgrade() -> None:
    bind = op.get_bind()
    if not sa.inspect(bind).has_table("evidence_document"):
        # Every database built from this repository, including CI and every local
        # one. The table only exists where it was applied out of band.
        return

    rows = bind.execute(sa.text("SELECT count(*) FROM evidence_document")).scalar()
    if rows > DUMPED_ROWS:
        raise RuntimeError(
            f"evidence_document holds {rows} rows; the dump this revision relies on "
            f"covers {DUMPED_ROWS} (taken Aug 4 2026). Something has written to the "
            "table since. Re-dump with scripts/dump_evidence_document.py, prove the "
            "new dump restorable, then re-run."
        )

    # No CASCADE on purpose: an unexpected dependency should stop this migration
    # rather than be swept away by it.
    op.drop_index("ix_evidence_document_search", table_name="evidence_document")
    op.drop_index(
        "ix_evidence_document_legislator_type", table_name="evidence_document"
    )
    op.drop_table("evidence_document")


def downgrade() -> None:
    """Rebuild the table exactly as production held it, empty.

    Honest about its limit: this restores the shape, not the 34,033 rows. Those come
    back with ``scripts/dump_evidence_document.py restore``, which is why the dump
    had to be proven restorable before the upgrade ran.

    The constraint names are PostgreSQL's own defaults (``*_fkey``) rather than this
    repository's ``fk_<table>_<column>_<target>`` convention, because that is what the
    out-of-band feature actually created. A downgrade has to rebuild what was there.
    """
    op.create_table(
        "evidence_document",
        sa.Column("legislator_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("source_artifact_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("source_type", sa.String(length=50), nullable=False),
        sa.Column("authority_tier", sa.Integer(), nullable=False),
        sa.Column("title", sa.Text(), nullable=False),
        sa.Column("publisher", sa.String(length=255), nullable=False),
        sa.Column("speaker", sa.String(length=255), nullable=True),
        sa.Column("source_url", sa.Text(), nullable=False),
        sa.Column("published_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("content", sa.Text(), nullable=False),
        sa.Column("search_text", sa.Text(), nullable=False),
        sa.Column(
            "verified_identity",
            sa.Boolean(),
            server_default=sa.text("false"),
            nullable=False,
        ),
        sa.Column(
            "retrieval_ready",
            sa.Boolean(),
            server_default=sa.text("false"),
            nullable=False,
        ),
        sa.Column(
            "metadata_json",
            postgresql.JSONB(),
            server_default=sa.text("'{}'::jsonb"),
            nullable=False,
        ),
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        # Named bare, not "ck_evidence_document_authority_tier": the metadata
        # naming convention is "ck_%(table_name)s_%(constraint_name)s", so the
        # full name here would come out doubled up.
        sa.CheckConstraint(
            "authority_tier >= 1 AND authority_tier <= 5", name="authority_tier"
        ),
        sa.ForeignKeyConstraint(
            ["legislator_id"],
            ["legislator.id"],
            name="evidence_document_legislator_id_fkey",
        ),
        sa.ForeignKeyConstraint(
            ["source_artifact_id"],
            ["source_artifact.id"],
            name="evidence_document_source_artifact_id_fkey",
        ),
        sa.PrimaryKeyConstraint("id", name="pk_evidence_document"),
        sa.UniqueConstraint(
            "legislator_id",
            "source_url",
            name="uq_evidence_document_legislator_id_source_url",
        ),
    )
    op.create_index(
        "ix_evidence_document_legislator_type",
        "evidence_document",
        ["legislator_id", "source_type"],
    )
    op.execute(
        "CREATE INDEX ix_evidence_document_search ON evidence_document "
        "USING gin (to_tsvector('english', search_text))"
    )
