"""Add checklists to project tasks."""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "20261001_0036"
down_revision: str | None = "20261001_0035"
branch_labels: str | Sequence[str] | None = None
depends_on: str | None = None


def upgrade() -> None:
    op.create_table(
        "project_task_checklist_items",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("task_id", sa.Uuid(), nullable=False),
        sa.Column("text", sa.String(length=240), nullable=False),
        sa.Column("position", sa.Integer(), nullable=False),
        sa.Column("completed", sa.Boolean(), nullable=False),
        sa.Column("completed_by", sa.Uuid(), nullable=True),
        sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_by", sa.Uuid(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(["task_id"], ["project_tasks.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["completed_by"], ["users.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["created_by"], ["users.id"], ondelete="RESTRICT"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_project_task_checklist_items_task_id", "project_task_checklist_items", ["task_id"])
    op.create_index(
        "ix_project_task_checklist_task_position",
        "project_task_checklist_items",
        ["task_id", "position"],
    )


def downgrade() -> None:
    op.drop_index("ix_project_task_checklist_task_position", table_name="project_task_checklist_items")
    op.drop_index("ix_project_task_checklist_items_task_id", table_name="project_task_checklist_items")
    op.drop_table("project_task_checklist_items")
