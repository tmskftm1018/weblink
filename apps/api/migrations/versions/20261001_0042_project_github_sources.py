"""Track imported GitHub branches for safe manual updates."""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "20261001_0042"
down_revision: str | None = "20261001_0041"
branch_labels: str | Sequence[str] | None = None
depends_on: str | None = None


def upgrade() -> None:
    op.create_table(
        "project_github_sources",
        sa.Column("project_id", sa.Uuid(), nullable=False),
        sa.Column("owner", sa.String(length=100), nullable=False),
        sa.Column("repository", sa.String(length=100), nullable=False),
        sa.Column("branch", sa.String(length=300), nullable=False),
        sa.Column("is_private", sa.Boolean(), server_default=sa.false(), nullable=False),
        sa.Column("commit_sha", sa.String(length=40), nullable=False),
        sa.Column("linked_by", sa.Uuid(), nullable=False),
        sa.Column("linked_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(["project_id"], ["projects.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["linked_by"], ["users.id"], ondelete="RESTRICT"),
        sa.PrimaryKeyConstraint("project_id"),
    )


def downgrade() -> None:
    op.drop_table("project_github_sources")
