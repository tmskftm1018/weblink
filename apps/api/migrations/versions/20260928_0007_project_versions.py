"""Add named project versions linked to immutable revisions.

Revision ID: 20260928_0007
Revises: 20260928_0006
Create Date: 2026-09-28
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "20260928_0007"
down_revision: str | None = "20260928_0006"
branch_labels: str | Sequence[str] | None = None
depends_on: str | None = None


def upgrade() -> None:
    op.create_table(
        "project_versions",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("project_id", sa.Uuid(), nullable=False),
        sa.Column("version_number", sa.Integer(), nullable=False),
        sa.Column("source_revision_id", sa.Uuid(), nullable=False),
        sa.Column("name", sa.String(length=120), nullable=False),
        sa.Column("description", sa.Text(), nullable=False),
        sa.Column("runtime_spec", sa.JSON(), nullable=False),
        sa.Column("created_by", sa.Uuid(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(["created_by"], ["users.id"], ondelete="RESTRICT"),
        sa.ForeignKeyConstraint(["project_id"], ["projects.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["source_revision_id"], ["project_revisions.id"], ondelete="RESTRICT"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("project_id", "version_number", name="uq_project_version_number"),
    )
    op.create_index("ix_project_versions_project_id", "project_versions", ["project_id"])
    op.create_index("ix_project_versions_source_revision_id", "project_versions", ["source_revision_id"])


def downgrade() -> None:
    op.drop_index("ix_project_versions_source_revision_id", table_name="project_versions")
    op.drop_index("ix_project_versions_project_id", table_name="project_versions")
    op.drop_table("project_versions")
