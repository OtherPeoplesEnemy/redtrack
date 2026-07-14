"""baseline schema (pre-SSO)

This is the baseline revision for introducing Alembic to RedTrack.

IMPORTANT — how this behaves in the two possible situations:

1. Brand-new database (no tables yet): `alembic upgrade head` runs this, which
   builds the ENTIRE current schema from Base.metadata, then runs 0002 on top.
   Because metadata is the single source of truth, the baseline can never drift
   from the models.

2. Existing database (already has RedTrack tables from before Alembic): you do
   NOT run this. Instead you STAMP the database at this revision
   (`alembic stamp 0001`), which records "you're already here" WITHOUT executing
   any DDL. Then `alembic upgrade head` applies only 0002 (the SSO change).

The create_all/drop_all here is intentionally metadata-driven rather than a
hand-written table list, so this file stays correct no matter what the models
looked like at baseline time. checkfirst=True makes create_all a no-op for any
table that already exists, so even an accidental run against a populated DB
won't error on existing tables.

Revision ID: 0001
Revises:
Create Date: 2026-07-14
"""
from typing import Sequence, Union

from alembic import op

# Import the app's metadata so the baseline == the models, always.
from database import Base
import models  # noqa: F401  (registers all tables on Base.metadata)

revision: str = "0001"
down_revision: Union[str, None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    bind = op.get_bind()
    # checkfirst=True → skips any table that already exists. Safe even if this
    # somehow runs against a partially-populated database.
    Base.metadata.create_all(bind=bind, checkfirst=True)


def downgrade() -> None:
    bind = op.get_bind()
    Base.metadata.drop_all(bind=bind)
