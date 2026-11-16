"""add auth_policy (enforce SSO / disable local login)

Adds a single-row auth_policy table holding the deployment-wide
"Enforce SSO" switch. Defaults to off, so existing deployments behave
exactly as before until an admin turns it on.

Idempotent, consistent with the earlier migrations: safe on a fresh database
(where the baseline already created the table from metadata) and on an
existing one (where it won't exist yet).

Revision ID: 0007
Revises: 0006
Create Date: 2026-10-14
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision: str = "0007"
down_revision: Union[str, None] = "0006"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _table_exists(bind, table: str) -> bool:
    return table in sa.inspect(bind).get_table_names()


def upgrade() -> None:
    bind = op.get_bind()

    if not _table_exists(bind, "auth_policy"):
        op.create_table(
            "auth_policy",
            sa.Column("id", sa.Integer(), primary_key=True),
            sa.Column("enforce_sso", sa.Boolean(), nullable=False, server_default=sa.false()),
            sa.Column("updated_by", postgresql.UUID(as_uuid=True), nullable=True),
            sa.Column("updated_at", sa.DateTime(timezone=True),
                      server_default=sa.func.now(), nullable=False),
        )


def downgrade() -> None:
    bind = op.get_bind()
    if _table_exists(bind, "auth_policy"):
        op.drop_table("auth_policy")
