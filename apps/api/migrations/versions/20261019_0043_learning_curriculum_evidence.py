"""Add versioned curriculum enrollment and assessment evidence."""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "20261019_0043"
down_revision: str | None = "20261001_0042"
branch_labels: str | Sequence[str] | None = None
depends_on: str | None = None


def upgrade() -> None:
    op.create_table(
        "learning_enrollments",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("course_key", sa.String(length=80), nullable=False),
        sa.Column("content_version", sa.String(length=40), nullable=False),
        sa.Column("rubric_version", sa.String(length=40), nullable=False),
        sa.Column("project_id", sa.Uuid(), nullable=True),
        sa.Column("status", sa.String(length=16), server_default="ACTIVE", nullable=False),
        sa.Column("current_node_id", sa.String(length=40), nullable=True),
        sa.Column("active_bridge_id", sa.String(length=40), nullable=True),
        sa.Column("return_mission_id", sa.String(length=40), nullable=True),
        sa.Column("last_revision_id", sa.Uuid(), nullable=True),
        sa.Column("last_revision_hash", sa.String(length=64), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.CheckConstraint("status IN ('ACTIVE', 'COMPLETED', 'PAUSED')", name="ck_learning_enrollment_status"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["project_id"], ["projects.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["last_revision_id"], ["project_revisions.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("user_id", "course_key", "content_version", name="uq_learning_enrollment_version"),
    )
    op.create_index("ix_learning_enrollments_user_id", "learning_enrollments", ["user_id"])
    op.create_index("ix_learning_enrollments_project_id", "learning_enrollments", ["project_id"])
    op.create_index("ix_learning_enrollments_last_revision_id", "learning_enrollments", ["last_revision_id"])

    op.create_table(
        "learning_assessment_evidence",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("enrollment_id", sa.Uuid(), nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("mission_id", sa.String(length=40), nullable=False),
        sa.Column("assessment_id", sa.String(length=100), nullable=False),
        sa.Column("assessment_type", sa.String(length=20), nullable=False),
        sa.Column("content_version", sa.String(length=40), nullable=False),
        sa.Column("rubric_version", sa.String(length=40), nullable=False),
        sa.Column("revision_id", sa.Uuid(), nullable=True),
        sa.Column("revision_hash", sa.String(length=64), nullable=True),
        sa.Column("status", sa.String(length=16), nullable=False),
        sa.Column("payload", sa.JSON(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.CheckConstraint(
            "assessment_type IN ('FUNCTIONAL', 'CONCEPT', 'OBSERVATION', 'TRANSFER')",
            name="ck_learning_assessment_type",
        ),
        sa.CheckConstraint(
            "status IN ('PASSED', 'FAILED', 'UNAVAILABLE', 'STALE', 'RECORDED')",
            name="ck_learning_assessment_status",
        ),
        sa.ForeignKeyConstraint(["enrollment_id"], ["learning_enrollments.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["revision_id"], ["project_revisions.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_learning_assessment_evidence_enrollment_id", "learning_assessment_evidence", ["enrollment_id"])
    op.create_index("ix_learning_assessment_evidence_user_id", "learning_assessment_evidence", ["user_id"])
    op.create_index("ix_learning_assessment_evidence_revision_id", "learning_assessment_evidence", ["revision_id"])


def downgrade() -> None:
    op.drop_index("ix_learning_assessment_evidence_revision_id", table_name="learning_assessment_evidence")
    op.drop_index("ix_learning_assessment_evidence_user_id", table_name="learning_assessment_evidence")
    op.drop_index("ix_learning_assessment_evidence_enrollment_id", table_name="learning_assessment_evidence")
    op.drop_table("learning_assessment_evidence")
    op.drop_index("ix_learning_enrollments_last_revision_id", table_name="learning_enrollments")
    op.drop_index("ix_learning_enrollments_project_id", table_name="learning_enrollments")
    op.drop_index("ix_learning_enrollments_user_id", table_name="learning_enrollments")
    op.drop_table("learning_enrollments")
