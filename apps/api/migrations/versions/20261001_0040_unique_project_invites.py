"""Allow only one project invitation per normalized email address."""

from collections.abc import Sequence

from alembic import op

revision: str = "20261001_0040"
down_revision: str | None = "20261001_0039"
branch_labels: str | Sequence[str] | None = None
depends_on: str | None = None


def upgrade() -> None:
    # Preserve the newest link if an earlier concurrent request left duplicates.
    op.execute(
        """
        DELETE FROM project_invitations
        WHERE id IN (
            SELECT id FROM (
                SELECT id, ROW_NUMBER() OVER (
                    PARTITION BY project_id, email
                    ORDER BY created_at DESC, id DESC
                ) AS duplicate_rank
                FROM project_invitations
            ) AS ranked_invitations
            WHERE duplicate_rank > 1
        )
        """
    )
    op.create_unique_constraint(
        "uq_project_invitations_project_email",
        "project_invitations",
        ["project_id", "email"],
    )


def downgrade() -> None:
    op.drop_constraint(
        "uq_project_invitations_project_email",
        "project_invitations",
        type_="unique",
    )
