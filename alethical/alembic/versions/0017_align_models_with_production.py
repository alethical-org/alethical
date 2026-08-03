"""Carry three production-only schema details to every other database (#100).

Net: production has three things a database built from ``models.py`` did not, and
in all three production is the one that is right. The audit
(``docs/operations/production-database-schema-drift.md``, findings D6, D7 and D8)
found them by comparing the two. ``models.py`` now declares all three; this
revision is what puts them into a database that already exists.

Against production every step is a no-op -- production is where all three came
from -- so ``migrate.yml`` applies this on merge and changes nothing there. That
is checked by each step, not assumed: every statement is conditional on the object
not already being right, which is also what makes the revision safe to run twice.

D6 -- ``ix_ai_enrichment_bill_summary_current_unique``
    The only thing enforcing "one current summary per bill". It existed in
    production, was declared nowhere, and so quietly disappeared from any database
    rebuilt from the models. Production has 0 rows violating it (measured Aug 3
    2026), so creating it cannot fail on data. It is a partial unique index rather
    than a constraint, which is why it is created as an index.

D7 -- the ``legislator_election_history`` unique key's name
    ``uq_legislator_election_history_leg_seq`` in production, because ``0008``
    named it by hand; the long generated name everywhere else. Same two columns
    either way, so nothing has ever behaved differently -- the cost is latent, and
    lands the day a migration writes ``op.drop_constraint()`` with one of the two
    names and meets the database holding the other. Renamed rather than dropped
    and recreated, so the index behind it is never absent.

D8 -- ``legislator_election_history.is_current_chamber`` server default
    ``false`` in production, none on a fresh database. 224 rows, 0 nulls, so the
    default has never had to do anything; matching it is cheaper than arguing
    about removing it.

Additive and reversible: the downgrade puts all three back the way a database
built by the old ``create_all`` baseline had them, which is exactly the shape
``0001`` still creates.

Every condition is evaluated by Postgres inside the statement rather than by
Python around it, so this revision renders correctly under ``alembic upgrade
--sql`` as well as online. The first draft read ``pg_catalog`` through
``op.get_bind()``, which returns nothing in offline mode and made the whole
revision unrenderable -- the production-path proof for #100 is generated that way,
so a revision that cannot be rendered cannot be checked before it runs.
"""

from __future__ import annotations

from alembic import op

# revision identifiers, used by Alembic.
revision = "0017_align_models_with_prod"
down_revision = "0016_section_keyed_on_pos"
branch_labels = None
depends_on = None

SUMMARY_INDEX = "ix_ai_enrichment_bill_summary_current_unique"
SUMMARY_INDEX_WHERE = (
    "bill_id IS NOT NULL AND enrichment_type = 'bill_summary' AND is_current = true"
)
ELECTION_TABLE = "legislator_election_history"
PRODUCTION_UQ = "uq_legislator_election_history_leg_seq"
GENERATED_UQ = "uq_legislator_election_history_legislator_id_period_sequence"


def _rename_constraint(table: str, old: str, new: str) -> str:
    """SQL that renames a constraint only where the old name is the one present.

    ``ALTER TABLE ... RENAME CONSTRAINT`` has no ``IF EXISTS`` form, so the
    existence test has to sit inside a ``DO`` block to stay a single statement
    that Postgres itself evaluates.
    """
    exists = (
        "SELECT 1 FROM pg_constraint c "
        "JOIN pg_class t ON t.oid = c.conrelid "
        "JOIN pg_namespace n ON n.oid = t.relnamespace "
        f"WHERE n.nspname = 'public' AND t.relname = '{table}' AND c.conname = "
    )
    return f"""
        DO $$
        BEGIN
            IF EXISTS ({exists}'{old}')
               AND NOT EXISTS ({exists}'{new}') THEN
                ALTER TABLE {table} RENAME CONSTRAINT {old} TO {new};
            END IF;
        END
        $$
    """


def upgrade() -> None:
    op.execute(
        f"CREATE UNIQUE INDEX IF NOT EXISTS {SUMMARY_INDEX} "
        f"ON ai_enrichment (bill_id, enrichment_type) WHERE ({SUMMARY_INDEX_WHERE})"
    )
    op.execute(_rename_constraint(ELECTION_TABLE, GENERATED_UQ, PRODUCTION_UQ))
    op.execute(
        f"ALTER TABLE {ELECTION_TABLE} "
        "ALTER COLUMN is_current_chamber SET DEFAULT false"
    )


def downgrade() -> None:
    op.execute(
        f"ALTER TABLE {ELECTION_TABLE} ALTER COLUMN is_current_chamber DROP DEFAULT"
    )
    op.execute(_rename_constraint(ELECTION_TABLE, PRODUCTION_UQ, GENERATED_UQ))
    op.execute(f"DROP INDEX IF EXISTS {SUMMARY_INDEX}")
