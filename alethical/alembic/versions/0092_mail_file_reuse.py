"""Allow separate private submission references to share exact original files.

Revision ID: 0092_mail_file_reuse
Revises: 0091_mail_analysis

Existing image fields, objects, and quotas stay intact. Roll back the application while
keeping this compatible schema; downgrade refuses once shared references exist.
"""

from alembic import op
import sqlalchemy as sa

revision = "0092_mail_file_reuse"
down_revision = "0091_mail_analysis"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column(
        "mail_upload_image",
        sa.Column(
            "verification_generation", sa.Integer(), server_default="0", nullable=False
        ),
    )
    op.drop_constraint(
        "uq_mail_upload_image_object_key", "mail_upload_image", type_="unique"
    )
    op.create_index("ix_mail_upload_image_sha256", "mail_upload_image", ["sha256"])


def downgrade():
    # No deletion, renaming, or remote duplication to force a rollback. The old
    # application remains compatible with the relaxed uniqueness constraint.
    op.execute("LOCK TABLE mail_upload_image IN ACCESS EXCLUSIVE MODE")
    shared = op.get_bind().scalar(
        sa.text(
            "SELECT EXISTS (SELECT 1 FROM mail_upload_image "
            "GROUP BY object_key HAVING count(*) > 1)"
        )
    )
    if shared:
        raise RuntimeError(
            "Shared mail originals exist; retain this schema and roll back the application"
        )
    op.create_unique_constraint(
        "uq_mail_upload_image_object_key", "mail_upload_image", ["object_key"]
    )
    op.drop_index("ix_mail_upload_image_sha256", table_name="mail_upload_image")
    op.drop_column("mail_upload_image", "verification_generation")
