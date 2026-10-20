"""Store learning guidance separately from mission answers and completion."""

import sqlalchemy as sa
from alembic import op

revision = "20261021_0049"
down_revision = "20261020_0048"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("learning_enrollments", sa.Column("path_preferences", sa.JSON(), nullable=True))
    op.add_column("learning_enrollments", sa.Column("path_version", sa.Integer(), nullable=False, server_default="0"))


def downgrade() -> None:
    op.drop_column("learning_enrollments", "path_version")
    op.drop_column("learning_enrollments", "path_preferences")
