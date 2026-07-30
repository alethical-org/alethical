"""Key bill_version_section on its position, not its section id (#763).

Net: a bill page may give two sections the same id, so the id cannot identify a
row. `laws.0.1.0` is the id the Revisor hands every section that sits outside an
article, and 6 of the 12 biggest bills repeat it. Keying the row on the id made
the second such section overwrite the first: 24 current versions lost 57 sections
that way, silently, while the Bill Text tab still called itself complete. This
moves the uniqueness onto `(bill_version_id, source_order)` — the section's
position on the page, already written on every row and already unique by
construction — and demotes `(bill_version_id, section_id_text)` to a plain,
non-unique index. `section_id_text` keeps its value and stays the display and
anchor key (`?tab=text#ft-<sectionId>`), so no existing link changes.

This is a *convergence*, not a redesign: production and the model have disagreed
here for months. `0001_initial_schema.py` builds the schema with
`Base.metadata.create_all`, so production froze an older shape of the model and
later edits to `__table_args__` never reached it. Production already has
`UNIQUE (bill_version_id, source_order)` plus the non-unique
`ix_bill_version_section_text`; a fresh or CI database, built from today's model,
has `UNIQUE (bill_version_id, section_id_text)` instead. Every step below is
guarded on what the database actually has, so this converges from either starting
point and is a no-op against production.

Not destructive: no data is read, written, or deleted, and no column changes.
Adding the unique constraint was checked against production first — all 67,237
stored sections are already distinct on `(bill_version_id, source_order)`, with no
nulls and no values below 1.

Downgrade caveat, stated because it is real: restoring
`UNIQUE (bill_version_id, section_id_text)` will fail against production, where 40
versions legitimately hold more than one row with the same section id (written by
the placeholder path, which never overwrote anything). That is the constraint
being wrong about the data, not the downgrade being broken — the same failure a
downgrade of any constraint-tightening migration hits once the data has moved on.
The upgrade→downgrade→upgrade round trip is proven against a clean Postgres.
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
# Keep the revision id <= 32 chars — alembic_version.version_num is varchar(32).
revision = "0016_section_keyed_on_pos"
down_revision = "0015_section_body_blocks"
branch_labels = None
depends_on = None

TABLE = "bill_version_section"
UQ_ON_ID = "uq_bill_version_section_bill_version_id_section_id_text"
UQ_ON_POSITION = "uq_bill_version_section_bill_version_id_source_order"
IX_ON_ID = "ix_bill_version_section_text"


def _names(inspector: sa.Inspector) -> tuple[set[str], set[str]]:
    uniques = {c["name"] for c in inspector.get_unique_constraints(TABLE) if c["name"]}
    indexes = {i["name"] for i in inspector.get_indexes(TABLE) if i["name"]}
    return uniques, indexes


def upgrade() -> None:
    inspector = sa.inspect(op.get_bind())
    uniques, indexes = _names(inspector)

    if UQ_ON_POSITION not in uniques:
        op.create_unique_constraint(
            UQ_ON_POSITION, TABLE, ["bill_version_id", "source_order"]
        )
    # The id keeps its own index because it is still looked up and displayed; it
    # just stops being unique. Create it before dropping the unique constraint the
    # queries were leaning on, so no window exists without an index on the column.
    if IX_ON_ID not in indexes:
        op.create_index(IX_ON_ID, TABLE, ["bill_version_id", "section_id_text"])
    if UQ_ON_ID in uniques:
        op.drop_constraint(UQ_ON_ID, TABLE, type_="unique")


def downgrade() -> None:
    inspector = sa.inspect(op.get_bind())
    uniques, indexes = _names(inspector)

    if UQ_ON_ID not in uniques:
        op.create_unique_constraint(
            UQ_ON_ID, TABLE, ["bill_version_id", "section_id_text"]
        )
    if IX_ON_ID in indexes:
        op.drop_index(IX_ON_ID, table_name=TABLE)
    if UQ_ON_POSITION in uniques:
        op.drop_constraint(UQ_ON_POSITION, TABLE, type_="unique")
