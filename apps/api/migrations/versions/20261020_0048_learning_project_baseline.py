"""Keep the imported learning baseline separate from later project edits."""

import sqlalchemy as sa
from alembic import op

revision = "20261020_0048"
down_revision = "20261020_0047"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("learning_project_exports", sa.Column("baseline_files", sa.JSON(), nullable=True))


def downgrade() -> None:
    op.drop_column("learning_project_exports", "baseline_files")
