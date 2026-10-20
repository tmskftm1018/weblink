"""Record one project handoff per learning mission and exercise."""

import sqlalchemy as sa
from alembic import op

revision = "20261020_0047"
down_revision = "20261020_0046"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "learning_project_exports",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("enrollment_id", sa.Uuid(), sa.ForeignKey("learning_enrollments.id", ondelete="CASCADE"), nullable=False),
        sa.Column("node_id", sa.String(40), nullable=False),
        sa.Column("field", sa.String(24), nullable=False),
        sa.Column("artifact_hash", sa.String(64), nullable=False),
        sa.Column("work_version", sa.Integer(), nullable=False),
        sa.Column("project_id", sa.Uuid(), sa.ForeignKey("projects.id", ondelete="SET NULL")),
        sa.Column("revision_id", sa.Uuid(), sa.ForeignKey("project_revisions.id", ondelete="SET NULL")),
        sa.Column("revision_hash", sa.String(64), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.UniqueConstraint("enrollment_id", "node_id", "field", name="uq_learning_project_export"),
    )
    op.create_index("ix_learning_project_exports_enrollment_id", "learning_project_exports", ["enrollment_id"])


def downgrade() -> None:
    op.drop_table("learning_project_exports")
