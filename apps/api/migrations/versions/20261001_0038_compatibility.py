"""Keep the previously shared local revision identifier in the chain.

An earlier draft used 20261001_0038 for deferred curriculum data. This
compatibility revision intentionally performs no schema or data changes.
"""

from collections.abc import Sequence

revision: str = "20261001_0038"
down_revision: str | None = "20261001_0037"
branch_labels: str | Sequence[str] | None = None
depends_on: str | None = None


def upgrade() -> None:
    pass


def downgrade() -> None:
    pass
