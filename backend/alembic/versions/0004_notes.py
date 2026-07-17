"""add notes (engagement notebook tree)

Adds the notes table backing the Notebook tab: a per-engagement tree that holds
both RedNote-synced notebooks (source='rednote', one subtree per pusher,
read-only in RedTrack) and notes written natively in RedTrack
(source='redtrack', editable).

parent_id is a self-referencing FK — that's the tree. external_id +
source_project_id are what make re-pushing idempotent and keep two testers'
notebooks from merging into each other.

Idempotent, same as the earlier migrations: a no-op on a fresh database where
the baseline already built the table from metadata.

Revision ID: 0004
Revises: 0003
Create Date: 2026-07-17
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision: str = "0004"
down_revision: Union[str, None] = "0003"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _table_exists(bind, table: str) -> bool:
    return table in sa.inspect(bind).get_table_names()


def _index_exists(bind, table: str, index: str) -> bool:
    return index in {i["name"] for i in sa.inspect(bind).get_indexes(table)}


def upgrade() -> None:
    bind = op.get_bind()

    if not _table_exists(bind, "notes"):
        op.create_table(
            "notes",
            sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
            sa.Column("engagement_id", postgresql.UUID(as_uuid=True),
                      sa.ForeignKey("engagements.id", ondelete="CASCADE"), nullable=False),
            sa.Column("parent_id", postgresql.UUID(as_uuid=True),
                      sa.ForeignKey("notes.id", ondelete="CASCADE"), nullable=True),
            sa.Column("title", sa.String(length=255), nullable=False),
            sa.Column("node_type", sa.String(length=20), nullable=False, server_default="note"),
            sa.Column("content", sa.Text(), nullable=False, server_default=""),
            sa.Column("icon", sa.String(length=10), nullable=False, server_default=""),
            sa.Column("sort_order", sa.Integer(), nullable=False, server_default="0"),
            sa.Column("source", sa.String(length=20), nullable=False, server_default="redtrack"),
            sa.Column("owner_id", postgresql.UUID(as_uuid=True),
                      sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
            sa.Column("external_id", sa.String(length=64), nullable=True),
            sa.Column("source_project_id", sa.String(length=64), nullable=True),
            sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
            sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        )

    for idx, cols in [
        ("ix_notes_engagement_id", ["engagement_id"]),
        ("ix_notes_parent_id", ["parent_id"]),
        ("ix_notes_external_id", ["external_id"]),
        ("ix_notes_source_project_id", ["source_project_id"]),
    ]:
        if not _index_exists(bind, "notes", idx):
            op.create_index(idx, "notes", cols)


def downgrade() -> None:
    bind = op.get_bind()
    if _table_exists(bind, "notes"):
        op.drop_table("notes")
