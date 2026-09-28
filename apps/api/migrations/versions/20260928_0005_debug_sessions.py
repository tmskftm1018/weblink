"""Add learner debug sessions.

Revision ID: 20260928_0005
Revises: 20260928_0004
Create Date: 2026-09-28
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "20260928_0005"
down_revision: str | None = "20260928_0004"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "debug_sessions",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("project_id", sa.Uuid(), nullable=False),
        sa.Column("run_id", sa.Uuid(), nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("hypothesis", sa.Text(), nullable=False),
        sa.Column("expected_output", sa.Text(), nullable=False),
        sa.Column("actual_output", sa.Text(), nullable=False),
        sa.Column("error_text", sa.Text(), nullable=False),
        sa.Column("logs", sa.Text(), nullable=False),
        sa.Column("status", sa.String(length=24), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(["project_id"], ["projects.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["run_id"], ["runs.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("run_id", "user_id", name="uq_debug_session_run_user"),
    )
    op.create_index("ix_debug_sessions_project_id", "debug_sessions", ["project_id"])
    op.create_index("ix_debug_sessions_run_id", "debug_sessions", ["run_id"])
    op.create_index("ix_debug_sessions_user_id", "debug_sessions", ["user_id"])


def downgrade() -> None:
    op.drop_index("ix_debug_sessions_user_id", table_name="debug_sessions")
    op.drop_index("ix_debug_sessions_run_id", table_name="debug_sessions")
    op.drop_index("ix_debug_sessions_project_id", table_name="debug_sessions")
    op.drop_table("debug_sessions")
