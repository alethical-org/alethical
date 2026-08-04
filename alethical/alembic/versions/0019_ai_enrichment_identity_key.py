"""Give an AI-enrichment row a unique identity, so two writers cannot both insert (#927).

Net: the step that saves a bill's AI summary looks the existing row up on five
details, and the database was never told those five had to be unique. So two
workers in one batch could both look, both find nothing, and both write -- and
production ended up holding **2,219 pairs** where there should be one row. This
adds the missing rule.

The five columns are the write path's own lookup in
``alethical/pipeline/ai_enrichment.py``::

    (bill_id, bill_version_id, enrichment_type, model_name, source_version_hash)

**Why it mattered.** That lookup has no ordering, so with two rows matching it
returned an arbitrary one and then marked it current. Nothing a reader saw was
ambiguous -- measured Aug 4 2026, **0** of the 2,219 groups contained a current
row -- but 2,217 of them held two *different* summaries, so the next
re-enrichment at the same model and hash would have flipped each of those bills
to whichever row Postgres happened to hand back. A coin flip, not a wrong
constant, and no citation can catch it.

**Why NULLS NOT DISTINCT.** 9,161 of 23,703 production rows have no
``bill_version_id``. A plain ``UNIQUE`` naming a nullable column protects every
row except those, because Postgres does not consider one NULL equal to another --
the same hole migration ``0018`` closed in three other keys. Verified before
choosing this spelling: with NULLs treated as equal the table still has exactly
2,219 duplicate groups, so the null-version rows collide with nothing and this
costs no legitimate row.

**This migration requires the duplicates to be gone already.** ``ADD CONSTRAINT``
cannot succeed while they exist, so ``scripts/dedupe_ai_enrichment.py`` runs
against production *before* this merges -- the issue's note that "the cleanup can
follow" is not achievable; Postgres will not allow it. The guard below turns the
failure that would otherwise happen mid-deploy into one that names the fix.

Reversible: the downgrade drops the constraint and nothing else. No row is
touched either way.
"""

from __future__ import annotations

from alembic import op

# revision identifiers, used by Alembic.
revision = "0019_ai_enrichment_identity"
down_revision = "0018_enforce_ingestion_uniq"
branch_labels = None
depends_on = None

# Short and hand-written, matching models.py. The naming convention would
# generate 87 characters for these five columns; Postgres truncates identifiers
# at 63 and SQLAlchemy appends a hash instead, so a generated name would force
# this file to hard-code that hash.
ENRICHMENT_UQ = "uq_ai_enrichment_bill_version_type_model_hash"
KEY = "bill_id, bill_version_id, enrichment_type, model_name, source_version_hash"


def upgrade() -> None:
    # Fail with the fix in the message rather than with a bare constraint
    # violation. A deploy that stops here has changed nothing.
    op.execute(
        f"""
        DO $$
        DECLARE dupes bigint;
        BEGIN
            SELECT count(*) INTO dupes FROM (
                SELECT 1 FROM ai_enrichment GROUP BY {KEY} HAVING count(*) > 1
            ) g;
            IF dupes > 0 THEN
                RAISE EXCEPTION
                    'ai_enrichment holds % duplicate group(s) on the identity key. '
                    'Run scripts/dedupe_ai_enrichment.py --apply first (#927).',
                    dupes;
            END IF;
        END $$;
        """
    )
    op.execute(
        f"ALTER TABLE ai_enrichment ADD CONSTRAINT {ENRICHMENT_UQ} "
        f"UNIQUE NULLS NOT DISTINCT ({KEY})"
    )


def downgrade() -> None:
    op.execute(f"ALTER TABLE ai_enrichment DROP CONSTRAINT IF EXISTS {ENRICHMENT_UQ}")
