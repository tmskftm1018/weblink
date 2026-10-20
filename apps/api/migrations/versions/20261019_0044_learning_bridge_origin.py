"""Preserve a bridge's origin separately from work completed inside the bridge."""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "20261019_0044"
down_revision: str | None = "20261019_0043"
branch_labels: str | Sequence[str] | None = None
depends_on: str | None = None


def upgrade() -> None:
    op.add_column("learning_enrollments", sa.Column("last_file_path", sa.String(240), nullable=True))
    op.add_column("learning_enrollments", sa.Column("last_cursor_line", sa.Integer(), nullable=True))
    op.add_column("learning_enrollments", sa.Column("return_revision_id", sa.Uuid(), nullable=True))
    op.add_column("learning_enrollments", sa.Column("return_revision_hash", sa.String(64), nullable=True))
    op.add_column("learning_enrollments", sa.Column("return_file_path", sa.String(240), nullable=True))
    op.add_column("learning_enrollments", sa.Column("return_cursor_line", sa.Integer(), nullable=True))
    op.create_foreign_key(
        "fk_learning_enrollments_return_revision", "learning_enrollments", "project_revisions",
        ["return_revision_id"], ["id"], ondelete="SET NULL",
    )


def downgrade() -> None:
    op.drop_constraint("fk_learning_enrollments_return_revision", "learning_enrollments", type_="foreignkey")
    for column in (
        "return_cursor_line", "return_file_path", "return_revision_hash", "return_revision_id",
        "last_cursor_line", "last_file_path",
    ):
        op.drop_column("learning_enrollments", column)
