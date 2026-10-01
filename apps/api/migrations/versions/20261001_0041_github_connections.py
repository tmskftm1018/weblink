"""Store encrypted per-user GitHub read tokens."""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "20261001_0041"
down_revision: str | None = "20261001_0040"
branch_labels: str | Sequence[str] | None = None
depends_on: str | None = None


def upgrade() -> None:
    op.create_table(
        "github_connections",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("account_name", sa.String(length=120), nullable=False),
        sa.Column("token_ciphertext", sa.Text(), nullable=False),
        sa.Column("connected_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("user_id", name="uq_github_connection_user"),
    )
    op.create_index("ix_github_connections_user_id", "github_connections", ["user_id"])


def downgrade() -> None:
    op.drop_index("ix_github_connections_user_id", table_name="github_connections")
    op.drop_table("github_connections")
