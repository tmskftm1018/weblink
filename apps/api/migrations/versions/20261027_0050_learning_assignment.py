"""Pin the scope of new mission work without regrading existing answers."""

import sqlalchemy as sa
from alembic import op

revision = "20261027_0050"
down_revision = "20261021_0049"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("learning_mission_work", sa.Column("assignment", sa.JSON(), nullable=True))


def downgrade() -> None:
    op.drop_column("learning_mission_work", "assignment")
