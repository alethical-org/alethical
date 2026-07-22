"""pg_trgm extension + trigram GIN indexes for fuzzy search (#573).

Keyword search (`/bills`, `/legislators`, `/search`) matches query words against
bill title/description and legislator full_name. Exact + root-word matching
(#571) misses typos ("plumbign") and near-words, and can't rank by closeness.
This adds the trigram infrastructure those queries need: the `pg_trgm` extension
plus GIN trigram indexes so the `%>` word-similarity operator (typo tolerance)
and `word_similarity()` ordering (relevance ranking) run index-accelerated.

Additive and reversible: creating an extension and indexes adds no columns and
removes no data; downgrade drops them. Indexes are built non-concurrently — on
this corpus (~10k bills, ~200 legislators) the build is sub-second, so the brief
lock during the deploy migration is acceptable (ingestion is human-triggered and
infrequent).
"""

from alembic import op

revision = "0011_search_trigram_idx"
down_revision = "0010_legislator_repr_city"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("CREATE EXTENSION IF NOT EXISTS pg_trgm")
    op.create_index(
        "ix_bill_title_trgm",
        "bill",
        ["title"],
        postgresql_using="gin",
        postgresql_ops={"title": "gin_trgm_ops"},
    )
    op.create_index(
        "ix_bill_description_trgm",
        "bill",
        ["description"],
        postgresql_using="gin",
        postgresql_ops={"description": "gin_trgm_ops"},
    )
    op.create_index(
        "ix_legislator_full_name_trgm",
        "legislator",
        ["full_name"],
        postgresql_using="gin",
        postgresql_ops={"full_name": "gin_trgm_ops"},
    )


def downgrade() -> None:
    op.drop_index("ix_legislator_full_name_trgm", table_name="legislator")
    op.drop_index("ix_bill_description_trgm", table_name="bill")
    op.drop_index("ix_bill_title_trgm", table_name="bill")
    op.execute("DROP EXTENSION IF EXISTS pg_trgm")
