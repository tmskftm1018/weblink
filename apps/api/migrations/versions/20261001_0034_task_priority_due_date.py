"""Add task priority and due date."""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "20261001_0034"
down_revision: str | None = "20261001_0033"
branch_labels: str | Sequence[str] | None = None
depends_on: str | None = None


def upgrade() -> None:
    op.add_column("project_tasks", sa.Column("priority", sa.String(length=20), server_default="NORMAL", nullable=False))
    op.add_column("project_tasks", sa.Column("due_date", sa.Date(), nullable=True))
    op.create_check_constraint(
        "ck_project_task_priority",
        "project_tasks",
        "priority IN ('LOW', 'NORMAL', 'HIGH', 'URGENT')",
    )


def downgrade() -> None:
    op.drop_constraint("ck_project_task_priority", "project_tasks", type_="check")
    op.drop_column("project_tasks", "due_date")
    op.drop_column("project_tasks", "priority")
