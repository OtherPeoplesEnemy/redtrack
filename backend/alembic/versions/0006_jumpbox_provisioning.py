"""add jump box VM provisioning columns

Adds the columns that let a jumpboxes row represent an ephemeral,
provisioned VM rather than a static inventory entry:

  ephemeral             — False keeps the existing static behaviour
  template_name         — golden template this slot clones from
  licence_slot          — which owned Burp Pro licence the template carries
  provider              — "proxmox" | "kubevirt"
  provider_instance_id  — VMID / VM object name
  provision_state       — provisioning | running | stopped | error | destroyed
  provisioned_at
  provision_error       — kept visible so a failed destroy isn't forgotten

Also adds users.ssh_public_key, injected into provisioned VMs at boot via
cloud-init so keys are never baked into a golden template.

All nullable (ephemeral defaults false), so existing jump boxes and users
are unaffected and provisioning stays dormant until vm_provider is set.

Idempotent, consistent with the earlier migrations.

Revision ID: 0006
Revises: 0005
Create Date: 2026-08-24
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "0006"
down_revision: Union[str, None] = "0005"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


_JUMPBOX_COLUMNS = [
    ("ephemeral", sa.Column("ephemeral", sa.Boolean(), nullable=False, server_default=sa.false())),
    ("template_name", sa.Column("template_name", sa.String(100), nullable=True)),
    ("licence_slot", sa.Column("licence_slot", sa.String(50), nullable=True)),
    ("provider", sa.Column("provider", sa.String(20), nullable=True)),
    ("provider_instance_id", sa.Column("provider_instance_id", sa.String(100), nullable=True)),
    ("provision_state", sa.Column("provision_state", sa.String(20), nullable=True)),
    ("provisioned_at", sa.Column("provisioned_at", sa.DateTime(timezone=True), nullable=True)),
    ("provision_error", sa.Column("provision_error", sa.Text(), nullable=True)),
]


def _column_exists(bind, table: str, column: str) -> bool:
    return column in {c["name"] for c in sa.inspect(bind).get_columns(table)}


def upgrade() -> None:
    bind = op.get_bind()

    for name, column in _JUMPBOX_COLUMNS:
        if not _column_exists(bind, "jumpboxes", name):
            op.add_column("jumpboxes", column)

    if not _column_exists(bind, "users", "ssh_public_key"):
        op.add_column("users", sa.Column("ssh_public_key", sa.Text(), nullable=True))


def downgrade() -> None:
    bind = op.get_bind()

    if _column_exists(bind, "users", "ssh_public_key"):
        op.drop_column("users", "ssh_public_key")

    for name, _ in reversed(_JUMPBOX_COLUMNS):
        if _column_exists(bind, "jumpboxes", name):
            op.drop_column("jumpboxes", name)
