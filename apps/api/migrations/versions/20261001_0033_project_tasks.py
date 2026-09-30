"""Add collaborative project tasks."""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "20261001_0033"
down_revision: str | None = "20260929_0032"
branch_labels: str | Sequence[str] | None = None
depends_on: str | None = None


def upgrade() -> None:
    op.create_table(
        "project_tasks",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("project_id", sa.Uuid(), nullable=False),
        sa.Column("title", sa.String(length=160), nullable=False),
        sa.Column("description", sa.Text(), nullable=False),
        sa.Column("status", sa.String(length=20), nullable=False),
        sa.Column("assignee_id", sa.Uuid(), nullable=True),
        sa.Column("created_by", sa.Uuid(), nullable=False),
        sa.Column("updated_by", sa.Uuid(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.CheckConstraint("status IN ('TODO', 'IN_PROGRESS', 'DONE')", name="ck_project_task_status"),
        sa.ForeignKeyConstraint(["project_id"], ["projects.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["assignee_id"], ["users.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["created_by"], ["users.id"], ondelete="RESTRICT"),
        sa.ForeignKeyConstraint(["updated_by"], ["users.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_project_tasks_project_id", "project_tasks", ["project_id"])
    op.create_index("ix_project_tasks_assignee_id", "project_tasks", ["assignee_id"])
    op.create_index("ix_project_tasks_project_status", "project_tasks", ["project_id", "status"])


def downgrade() -> None:
    op.drop_index("ix_project_tasks_project_status", table_name="project_tasks")
    op.drop_index("ix_project_tasks_assignee_id", table_name="project_tasks")
    op.drop_index("ix_project_tasks_project_id", table_name="project_tasks")
    op.drop_table("project_tasks")
