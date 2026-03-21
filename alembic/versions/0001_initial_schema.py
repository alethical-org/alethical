"""Initial Alethical schema."""

from __future__ import annotations

import importlib.util
import sys
from pathlib import Path

from alembic import op

# revision identifiers, used by Alembic.
revision = "0001_initial_schema"
down_revision = None
branch_labels = None
depends_on = None

ROOT = Path(__file__).resolve().parents[2]
SCHEMA_PATH = ROOT / "prototypes" / "alethical_schema_sqlalchemy.py"


def load_schema_module():
    spec = importlib.util.spec_from_file_location("alethical_schema_sqlalchemy", SCHEMA_PATH)
    module = importlib.util.module_from_spec(spec)
    assert spec and spec.loader
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


def upgrade() -> None:
    schema = load_schema_module()
    bind = op.get_bind()
    op.execute("CREATE EXTENSION IF NOT EXISTS vector")
    schema.Base.metadata.create_all(bind=bind)


def downgrade() -> None:
    schema = load_schema_module()
    bind = op.get_bind()
    schema.Base.metadata.drop_all(bind=bind)
