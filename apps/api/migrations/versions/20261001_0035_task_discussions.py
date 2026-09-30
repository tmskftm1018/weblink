"""Add comments and activity history to project tasks."""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "20261001_0035"
down_revision: str | None = "20261001_0034"
branch_labels: str | Sequence[str] | None = None
depends_on: str | None = None


def upgrade() -> None:
    op.create_table(
        "project_task_comments",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("task_id", sa.Uuid(), nullable=False),
        sa.Column("author_id", sa.Uuid(), nullable=True),
        sa.Column("body", sa.Text(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(["task_id"], ["project_tasks.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["author_id"], ["users.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_project_task_comments_task_id", "project_task_comments", ["task_id"])
    op.create_index("ix_project_task_comments_author_id", "project_task_comments", ["author_id"])
    op.create_table(
        "project_task_activities",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("task_id", sa.Uuid(), nullable=False),
        sa.Column("actor_id", sa.Uuid(), nullable=True),
        sa.Column("message", sa.String(length=240), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(["task_id"], ["project_tasks.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["actor_id"], ["users.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_project_task_activities_task_id", "project_task_activities", ["task_id"])
    op.create_index("ix_project_task_activities_actor_id", "project_task_activities", ["actor_id"])


def downgrade() -> None:
    op.drop_index("ix_project_task_activities_actor_id", table_name="project_task_activities")
    op.drop_index("ix_project_task_activities_task_id", table_name="project_task_activities")
    op.drop_table("project_task_activities")
    op.drop_index("ix_project_task_comments_author_id", table_name="project_task_comments")
    op.drop_index("ix_project_task_comments_task_id", table_name="project_task_comments")
    op.drop_table("project_task_comments")
