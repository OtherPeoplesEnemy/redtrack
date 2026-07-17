"""add api_tokens (named per-user API keys)

Adds the api_tokens table backing multiple named, individually-revocable API
keys per user. The legacy users.api_key column is intentionally left in place —
get_current_user still falls back to it so existing RedNote / redtrack-cli
installs keep working until they're moved onto named tokens.

Idempotent, same as 0002: safe on a fresh database (where the baseline already
created the table from metadata) and on an existing one (where it won't exist).

Revision ID: 0003
Revises: 0002
Create Date: 2026-07-17
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision: str = "0003"
down_revision: Union[str, None] = "0002"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _table_exists(bind, table: str) -> bool:
    return table in sa.inspect(bind).get_table_names()


def _index_exists(bind, table: str, index: str) -> bool:
    return index in {i["name"] for i in sa.inspect(bind).get_indexes(table)}


def upgrade() -> None:
    bind = op.get_bind()

    if not _table_exists(bind, "api_tokens"):
        op.create_table(
            "api_tokens",
            sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
            sa.Column("user_id", postgresql.UUID(as_uuid=True),
                      sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
            sa.Column("name", sa.String(length=100), nullable=False),
            sa.Column("token_hash", sa.String(length=64), nullable=False),
            sa.Column("prefix", sa.String(length=16), nullable=False),
            sa.Column("last_used_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("revoked_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("created_at", sa.DateTime(timezone=True),
                      server_default=sa.func.now(), nullable=False),
        )

    if not _index_exists(bind, "api_tokens", "ix_api_tokens_token_hash"):
        op.create_index("ix_api_tokens_token_hash", "api_tokens", ["token_hash"], unique=True)
    if not _index_exists(bind, "api_tokens", "ix_api_tokens_user_id"):
        op.create_index("ix_api_tokens_user_id", "api_tokens", ["user_id"])


def downgrade() -> None:
    bind = op.get_bind()
    if _table_exists(bind, "api_tokens"):
        op.drop_table("api_tokens")
