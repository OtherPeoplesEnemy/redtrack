"""add SSO (SAML2 + OIDC) support

Adds the schema needed by the SSO feature:
  - users.sso_provider, users.sso_subject
  - users.hashed_password made nullable (SSO-only accounts have no password)
  - sso_config table

Written to be fully idempotent so it is correct in BOTH situations:

  * Fresh database: the baseline (0001) already created these from current
    metadata, so the guards below detect they exist and skip — no error.
  * Existing database stamped at 0001: these don't exist yet, so they get
    created here.

All checks are done against the live information_schema rather than assuming
state, which is what makes the same file safe on both paths.

Revision ID: 0002
Revises: 0001
Create Date: 2026-07-14
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "0002"
down_revision: Union[str, None] = "0001"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _column_exists(bind, table: str, column: str) -> bool:
    insp = sa.inspect(bind)
    return column in {c["name"] for c in insp.get_columns(table)}


def _table_exists(bind, table: str) -> bool:
    insp = sa.inspect(bind)
    return table in insp.get_table_names()


def _index_exists(bind, table: str, index: str) -> bool:
    insp = sa.inspect(bind)
    return index in {i["name"] for i in insp.get_indexes(table)}


def upgrade() -> None:
    bind = op.get_bind()

    # 1. users.sso_provider / users.sso_subject
    if not _column_exists(bind, "users", "sso_provider"):
        op.add_column("users", sa.Column("sso_provider", sa.String(length=20), nullable=True))
    if not _column_exists(bind, "users", "sso_subject"):
        op.add_column("users", sa.Column("sso_subject", sa.String(length=255), nullable=True))

    # 2. sso_subject index
    if not _index_exists(bind, "users", "ix_users_sso_subject"):
        op.create_index("ix_users_sso_subject", "users", ["sso_subject"])

    # 3. hashed_password → nullable
    op.alter_column("users", "hashed_password",
                    existing_type=sa.String(length=255),
                    nullable=True)

    # 4. sso_config table
    if not _table_exists(bind, "sso_config"):
        op.create_table(
            "sso_config",
            sa.Column("id", sa.dialects.postgresql.UUID(as_uuid=True), primary_key=True),
            sa.Column("provider", sa.String(length=20), nullable=False),
            sa.Column("enabled", sa.Boolean(), nullable=False, server_default=sa.false()),
            sa.Column("saml_metadata_url", sa.String(length=500), nullable=True),
            sa.Column("saml_idp_entity_id", sa.String(length=500), nullable=True),
            sa.Column("saml_idp_sso_url", sa.String(length=500), nullable=True),
            sa.Column("saml_idp_x509_cert", sa.Text(), nullable=True),
            sa.Column("oidc_issuer", sa.String(length=500), nullable=True),
            sa.Column("oidc_client_id", sa.String(length=255), nullable=True),
            sa.Column("oidc_client_secret", sa.String(length=500), nullable=True),
            sa.Column("auto_provision", sa.Boolean(), nullable=False, server_default=sa.true()),
            sa.Column("default_role", sa.String(length=20), nullable=False, server_default="tester"),
            sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        )
        op.create_unique_constraint("uq_sso_config_provider", "sso_config", ["provider"])
        op.create_index("ix_sso_config_provider", "sso_config", ["provider"])


def downgrade() -> None:
    bind = op.get_bind()
    if _table_exists(bind, "sso_config"):
        op.drop_table("sso_config")
    if _index_exists(bind, "users", "ix_users_sso_subject"):
        op.drop_index("ix_users_sso_subject", table_name="users")
    if _column_exists(bind, "users", "sso_subject"):
        op.drop_column("users", "sso_subject")
    if _column_exists(bind, "users", "sso_provider"):
        op.drop_column("users", "sso_provider")
    # hashed_password left nullable on downgrade — reverting could fail if
    # SSO-only users (null passwords) exist, so we intentionally leave it.
