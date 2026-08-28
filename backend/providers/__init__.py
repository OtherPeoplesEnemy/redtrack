"""Jump box VM provisioning providers.

Usage from main.py:

    from providers import get_provider, ProviderError

    provider = await get_provider(db)   # None if provisioning is disabled
    if provider:
        instance = await provider.provision(spec)

Config resolution, highest priority first:

  1. The `vm_provisioning` row in the `integrations` table, editable live in
     Settings -> Jump Boxes. This is the normal path.
  2. `backend/config.py` / `.env` (VM_PROVIDER, VM_TEMPLATES, PROXMOX_*).
     Useful for bootstrapping or deployments that manage config as code.

With no provider set, jump boxes behave as static inventory rows.
"""

from __future__ import annotations

from config import get_settings

from .base import (  # re-exported for convenience
    ConsoleTicket,
    Instance,
    InstanceSpec,
    InstanceState,
    JumpBoxProvider,
    LicenceSlotUnavailable,
    ProviderError,
    SSHAccess,
    Template,
)

__all__ = [
    "get_provider",
    "build_provider",
    "load_config",
    "parse_templates",
    "INTEGRATION_NAME",
    "SECRET_FIELDS",
    "JumpBoxProvider",
    "InstanceSpec",
    "Instance",
    "InstanceState",
    "Template",
    "ConsoleTicket",
    "SSHAccess",
    "ProviderError",
    "LicenceSlotUnavailable",
]

INTEGRATION_NAME = "vm_provisioning"

# Never sent back to the browser; blank on save means "keep existing".
SECRET_FIELDS = {"proxmox_token_secret"}


def parse_templates(raw) -> list[Template]:
    """Accept either the env string form or the JSON list the UI sends.

    Env form, comma-separated:  name:provider_ref:licence_slot
    UI form: [{"name":..., "provider_ref":..., "licence_slot":...}, ...]
    """
    if not raw:
        return []

    if isinstance(raw, list):
        templates = []
        for t in raw:
            name = (t.get("name") or "").strip()
            ref = str(t.get("provider_ref") or "").strip()
            if not name or not ref:
                raise ProviderError("each template needs a name and a template ID")
            templates.append(Template(
                name=name,
                provider_ref=ref,
                licence_slot=(t.get("licence_slot") or "").strip() or None,
                default_cores=int(t.get("cores") or 4),
                default_memory_mb=int(t.get("memory_mb") or 8192),
            ))
        return templates

    templates = []
    for chunk in filter(None, (c.strip() for c in str(raw).split(","))):
        parts = chunk.split(":")
        if len(parts) < 2:
            raise ProviderError("bad template spec: %r" % chunk)
        slot = parts[2] if len(parts) > 2 and parts[2] else None
        templates.append(Template(name=parts[0], provider_ref=parts[1], licence_slot=slot))
    return templates


def _env_config() -> dict:
    """Provider config from .env, used when the integration row is absent."""
    s = get_settings()
    return {
        "provider": (getattr(s, "vm_provider", "") or "").strip().lower(),
        "templates": getattr(s, "vm_templates", ""),
        "proxmox_url": s.proxmox_url,
        "proxmox_token_id": s.proxmox_token_id,
        "proxmox_token_secret": s.proxmox_token_secret,
        "proxmox_node": s.proxmox_node,
        "proxmox_storage": s.proxmox_storage,
        "proxmox_bridge": s.proxmox_bridge,
        "proxmox_verify_tls": s.proxmox_verify_tls,
        "proxmox_full_clone": s.proxmox_full_clone,
        "kubevirt_namespace": s.kubevirt_namespace,
    }


def build_provider(config: dict) -> JumpBoxProvider | None:
    """Construct a provider from a plain config dict. Raises ProviderError."""
    kind = (config.get("provider") or "").strip().lower()
    if not kind:
        return None

    templates = parse_templates(config.get("templates"))

    if kind == "proxmox":
        from .proxmox import ProxmoxProvider

        if not config.get("proxmox_url"):
            raise ProviderError("Proxmox URL is not set")

        return ProxmoxProvider(
            base_url=config["proxmox_url"],
            token_id=config.get("proxmox_token_id", ""),
            token_secret=config.get("proxmox_token_secret", ""),
            node=config.get("proxmox_node") or "pve",
            templates=templates,
            storage=config.get("proxmox_storage") or "local-lvm",
            bridge=config.get("proxmox_bridge") or "vmbr0",
            verify_tls=bool(config.get("proxmox_verify_tls", True)),
            full_clone=bool(config.get("proxmox_full_clone", True)),
        )

    if kind == "kubevirt":
        from .kubevirt import KubeVirtProvider  # not written yet

        return KubeVirtProvider(
            namespace=config.get("kubevirt_namespace") or "redtrack-jumpboxes",
            templates=templates,
        )

    raise ProviderError("unknown provider: %r" % kind)


async def load_config(db) -> dict:
    """Merge the stored integration config over the env defaults.

    A stored secret left blank falls back to env rather than clobbering it, so
    saving the form without retyping the token doesn't wipe it.
    """
    from sqlalchemy import select
    from models import Integration

    config = _env_config()

    row = (await db.execute(
        select(Integration).where(Integration.name == INTEGRATION_NAME)
    )).scalar_one_or_none()

    if not row:
        return config

    if not row.enabled:
        return {**config, "provider": ""}

    for k, v in (row.config or {}).items():
        if k in SECRET_FIELDS and not v:
            continue  # keep whatever env supplied
        config[k] = v
    return config


async def get_provider(db) -> JumpBoxProvider | None:
    """Provider for the current config, or None when provisioning is off.

    Built per call rather than cached: config is editable at runtime, and a
    stale client pointed at an old hypervisor is worse than the cost of
    constructing one.
    """
    return build_provider(await load_config(db))
