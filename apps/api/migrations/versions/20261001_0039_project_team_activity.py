"""Record project team and invitation changes separately from task activity."""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "20261001_0039"
down_revision: str | None = "20261001_0038"
branch_labels: str | Sequence[str] | None = None
depends_on: str | None = None


def upgrade() -> None:
    op.create_table(
        "project_team_activities",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("project_id", sa.Uuid(), nullable=False),
        sa.Column("actor_id", sa.Uuid(), nullable=True),
        sa.Column("actor_name", sa.String(length=120), nullable=False),
        sa.Column("message", sa.String(length=240), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(["project_id"], ["projects.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["actor_id"], ["users.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_project_team_activities_project_id", "project_team_activities", ["project_id"])
    op.create_index("ix_project_team_activities_actor_id", "project_team_activities", ["actor_id"])
    op.create_index("ix_project_team_activities_created_at", "project_team_activities", ["created_at"])


def downgrade() -> None:
    op.drop_index("ix_project_team_activities_created_at", table_name="project_team_activities")
    op.drop_index("ix_project_team_activities_actor_id", table_name="project_team_activities")
    op.drop_index("ix_project_team_activities_project_id", table_name="project_team_activities")
    op.drop_table("project_team_activities")
