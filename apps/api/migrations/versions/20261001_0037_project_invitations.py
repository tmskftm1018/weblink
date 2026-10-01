"""Add expiring project invitation links."""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "20261001_0037"
down_revision: str | None = "20261001_0036"
branch_labels: str | Sequence[str] | None = None
depends_on: str | None = None


def upgrade() -> None:
    op.create_table(
        "project_invitations",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("project_id", sa.Uuid(), nullable=False),
        sa.Column("email", sa.String(length=320), nullable=False),
        sa.Column("role", sa.String(length=24), nullable=False),
        sa.Column("token_hash", sa.String(length=64), nullable=False),
        sa.Column("invited_by", sa.Uuid(), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(["project_id"], ["projects.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["invited_by"], ["users.id"], ondelete="RESTRICT"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("token_hash"),
    )
    op.create_index("ix_project_invitations_project_id", "project_invitations", ["project_id"])
    op.create_index("ix_project_invitations_email", "project_invitations", ["email"])
    op.create_index("ix_project_invitations_token_hash", "project_invitations", ["token_hash"])
    op.create_index("ix_project_invitations_expires_at", "project_invitations", ["expires_at"])


def downgrade() -> None:
    op.drop_index("ix_project_invitations_expires_at", table_name="project_invitations")
    op.drop_index("ix_project_invitations_token_hash", table_name="project_invitations")
    op.drop_index("ix_project_invitations_email", table_name="project_invitations")
    op.drop_index("ix_project_invitations_project_id", table_name="project_invitations")
    op.drop_table("project_invitations")
