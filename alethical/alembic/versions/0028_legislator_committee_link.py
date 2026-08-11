"""Hold the person-checked link from a legislator to a Minnesota campaign committee.

Minnesota gives every registered filer a registration number but never links it to a
person, and campaign-finance-system-design.md §5 (Identity) forbids linking one
automatically. This table is where a link a person has checked lives, and §4.4 (What
survives replacement) decides that it has to be its own table: the imported payment set is
thrown away and rebuilt on every load, so a link stored against an imported row would be
destroyed silently.

Additive and reversible. One new table and one new enum type, no change to any existing
table, so the downgrade drops both and leaves the schema as it was.

Revision ID: 0028_legislator_committee_link
Revises: 0027_email_quota_warning_state
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "0028_legislator_committee_link"
down_revision = "0027_email_quota_warning_state"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "legislator_campaign_committee",
        sa.Column("legislator_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("registration_number", sa.String(length=20), nullable=False),
        sa.Column(
            "decision",
            sa.Enum(
                "confirmed",
                "rejected",
                name="committee_link_review_decision",
            ),
            nullable=False,
        ),
        sa.Column("committee_name_as_reviewed", sa.Text(), nullable=False),
        sa.Column("office_as_reviewed", sa.String(length=40), nullable=True),
        sa.Column("first_year_as_reviewed", sa.String(length=4), nullable=True),
        sa.Column("last_year_as_reviewed", sa.String(length=4), nullable=True),
        # No server default and not nullable: a link with no reviewer is not a checked
        # link, so the database refuses to hold one.
        sa.Column("reviewed_by", sa.String(length=120), nullable=False),
        sa.Column(
            "reviewed_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column("evidence", sa.Text(), nullable=True),
        sa.Column(
            "id", postgresql.UUID(as_uuid=True), nullable=False, primary_key=True
        ),
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
        # No ON DELETE rule, which matches every other legislator_id foreign key in this
        # schema and is the safer failure here. `cleanup_orphan_legislators`
        # (alethical/pipeline/committee_memberships.py) deletes a legislator who has no
        # sponsorships, votes or committee memberships, and it clears the child tables it
        # knows about by hand. A cascade would let that pass silently destroy a decision a
        # person made; with no rule, the delete raises instead, which is what we want to
        # happen if a machine cleanup is ever about to throw away checked human work.
        sa.ForeignKeyConstraint(
            ["legislator_id"],
            ["legislator.id"],
            name="fk_legislator_campaign_committee_legislator_id_legislator",
        ),
        # Named explicitly rather than left to the metadata convention, which would
        # generate a 66-character identifier and fail: Postgres truncates at 63.
        sa.UniqueConstraint(
            "legislator_id",
            "registration_number",
            name="uq_legislator_campaign_committee_legislator_registration",
        ),
    )
    # One committee belongs to one candidate, so a *confirmed* number appears once across
    # the whole table. This is what makes publishing one person's money under two
    # legislators' names impossible rather than merely unlikely. Partial, because the same
    # number may be rejected for several legislators -- that is what ruling out a shared
    # surname looks like.
    op.create_index(
        "uq_legislator_campaign_committee_confirmed_registration",
        "legislator_campaign_committee",
        ["registration_number"],
        unique=True,
        postgresql_where=sa.text("decision = 'confirmed'"),
    )


def downgrade() -> None:
    op.drop_index(
        "uq_legislator_campaign_committee_confirmed_registration",
        table_name="legislator_campaign_committee",
    )
    op.drop_table("legislator_campaign_committee")
    sa.Enum(name="committee_link_review_decision").drop(op.get_bind(), checkfirst=True)
