"""Add isolated course API execution jobs; preserve all existing learning work."""

import sqlalchemy as sa
from alembic import op

revision = "20261020_0046"
down_revision = "20261020_0045"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "learning_executions",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("enrollment_id", sa.Uuid(), sa.ForeignKey("learning_enrollments.id", ondelete="CASCADE"), nullable=False),
        sa.Column("user_id", sa.Uuid(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("node_id", sa.String(40), nullable=False),
        sa.Column("field", sa.String(24), nullable=False),
        sa.Column("artifact_hash", sa.String(64), nullable=False),
        sa.Column("work_version", sa.Integer(), nullable=False),
        sa.Column("source", sa.Text(), nullable=False),
        sa.Column("status", sa.String(24), nullable=False),
        sa.Column("result", sa.JSON()),
        sa.Column("lease_token", sa.String(40)),
        sa.Column("lease_until", sa.DateTime(timezone=True)),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.UniqueConstraint("enrollment_id", "node_id", "artifact_hash", "field", name="uq_learning_execution_input"),
    )
    op.create_index("ix_learning_executions_enrollment_id", "learning_executions", ["enrollment_id"])
    op.create_index("ix_learning_executions_user_id", "learning_executions", ["user_id"])
    op.create_index("ix_learning_execution_queue", "learning_executions", ["status", "created_at"])


def downgrade() -> None:
    op.drop_table("learning_executions")
