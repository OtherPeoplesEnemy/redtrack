"""add report_dashboard to engagements

Adds the report_dashboard JSON column that stores the bespoke report dashboard
data per engagement: KPI callouts, risk matrix counts, attack chain, remediation
timeline, and defensive controls. Nullable with a default of {} so existing
engagements are unaffected.

Idempotent, consistent with the earlier migrations.

Revision ID: 0005
Revises: 0004
Create Date: 2026-07-19
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision: str = "0005"
down_revision: Union[str, None] = "0004"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _column_exists(bind, table: str, column: str) -> bool:
    return column in {c["name"] for c in sa.inspect(bind).get_columns(table)}


def upgrade() -> None:
    bind = op.get_bind()
    if not _column_exists(bind, "engagements", "report_dashboard"):
        op.add_column(
            "engagements",
            sa.Column("report_dashboard", postgresql.JSONB(astext_type=sa.Text()),
                      nullable=True, server_default="{}"),
        )


def downgrade() -> None:
    bind = op.get_bind()
    if _column_exists(bind, "engagements", "report_dashboard"):
        op.drop_column("engagements", "report_dashboard")
