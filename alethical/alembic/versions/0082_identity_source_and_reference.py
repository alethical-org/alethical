"""Give each Finance identity a short reference, and each decision an optional source.

A reference is the label people use for an identity: ORG-0042 for an
organization, PER-0042 for a person, numbered by kind in creation order from its
own sequence. Existing identities are numbered once, oldest first. A source is
where the reviewer found the evidence, in their own words, kept apart from the
basis or reason: on a confirmation (``source``) and on its withdrawal
(``withdrawal_source``); merges and splits keep theirs in their history event.
Everything here is additive: downgrading drops the 3 columns and 2 sequences.

Revision ID: 0082_identity_source_reference
Revises: 0081_cf_graph_money_summary
"""

from alembic import op
import sqlalchemy as sa

revision = "0082_identity_source_reference"
down_revision = "0081_cf_graph_money_summary"
branch_labels = None
depends_on = None

REFERENCE_CHECK = (
    "(kind = 'organization' AND reference ~ '^ORG-[0-9]{4,}$')"
    " OR (kind = 'person' AND reference ~ '^PER-[0-9]{4,}$')"
)
SEQUENCES = {
    "organization": ("ORG", "identity_organization_reference_seq"),
    "person": ("PER", "identity_person_reference_seq"),
}


def upgrade() -> None:
    for _, sequence in SEQUENCES.values():
        op.execute(f"CREATE SEQUENCE {sequence}")
    op.add_column("identity_entity", sa.Column("reference", sa.Text()))
    for kind, (prefix, sequence) in SEQUENCES.items():
        # Numbered explicitly, oldest first: nextval inside an UPDATE follows the
        # order rows are visited, which no ORDER BY in a subquery controls. Parts of
        # 1 split share created_at, so their own first history event breaks the tie.
        op.execute(
            f"""
            UPDATE identity_entity AS e
               SET reference = '{prefix}-' || lpad(ordered.n::text, 4, '0')
              FROM (SELECT id, row_number() OVER (
                             ORDER BY created_at,
                                      (SELECT min(v.created_at) FROM identity_event v
                                        WHERE v.entity_id = identity_entity.id),
                                      id) AS n
                      FROM identity_entity WHERE kind = '{kind}') AS ordered
             WHERE e.id = ordered.id
            """
        )
        # The next new identity continues after the last number given here.
        op.execute(
            f"""
            SELECT setval('{sequence}', greatest(count(*), 1), count(*) > 0)
              FROM identity_entity WHERE kind = '{kind}'
            """
        )
    op.create_unique_constraint(
        op.f("uq_identity_entity_reference"), "identity_entity", ["reference"]
    )
    # The prefix names the kind. Null is allowed so an API still running the
    # previous release during a deploy can create an identity; the new release
    # always assigns one.
    op.create_check_constraint(
        op.f("ck_identity_entity_entity_reference"),
        "identity_entity",
        REFERENCE_CHECK,
    )
    op.add_column("identity_confirmation", sa.Column("source", sa.Text()))
    op.add_column("identity_confirmation", sa.Column("withdrawal_source", sa.Text()))


def downgrade() -> None:
    op.drop_column("identity_confirmation", "withdrawal_source")
    op.drop_column("identity_confirmation", "source")
    op.drop_constraint(
        op.f("ck_identity_entity_entity_reference"), "identity_entity", type_="check"
    )
    op.drop_constraint(
        op.f("uq_identity_entity_reference"), "identity_entity", type_="unique"
    )
    op.drop_column("identity_entity", "reference")
    for _, sequence in SEQUENCES.values():
        op.execute(f"DROP SEQUENCE {sequence}")
