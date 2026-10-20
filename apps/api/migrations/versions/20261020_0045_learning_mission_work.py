"""Store editable learning artifacts without changing legacy progress."""

import sqlalchemy as sa
from alembic import op

revision = "20261020_0045"
down_revision = "20261019_0044"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "learning_mission_work",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("enrollment_id", sa.Uuid(), sa.ForeignKey("learning_enrollments.id", ondelete="CASCADE"), nullable=False),
        sa.Column("node_id", sa.String(40), nullable=False),
        sa.Column("version", sa.Integer(), nullable=False),
        sa.Column("retrieved_version", sa.Integer(), nullable=False),
        sa.Column("answers", sa.JSON(), nullable=False),
        sa.Column("source_hash", sa.String(64), nullable=False),
        sa.Column("submitted_hash", sa.String(64)),
        sa.Column("feedback", sa.JSON()),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.UniqueConstraint("enrollment_id", "node_id", name="uq_learning_work_node"),
    )
    op.create_index("ix_learning_mission_work_enrollment_id", "learning_mission_work", ["enrollment_id"])


def downgrade() -> None:
    op.drop_table("learning_mission_work")
