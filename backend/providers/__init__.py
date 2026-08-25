"""Jump box VM provisioning providers.

Usage from main.py:

    from providers import get_provider, ProviderError

    provider = get_provider()          # None if provisioning is disabled
    if provider:
        instance = await provider.provision(spec)

Config lives in backend/config.py (see settings block below). Set
`vm_provider` to "proxmox", "kubevirt", or "" to disable provisioning
entirely — in which case jump boxes behave exactly as they do today.
"""

from __future__ import annotations

from functools import lru_cache

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


def _parse_templates(raw: str) -> list[Template]:
    """RT_VM_TEMPLATES format, comma-separated:

        name:provider_ref:licence_slot

    e.g. "kali-burp-1:9001:burp-pro-1,kali-burp-2:9002:burp-pro-2"
    """
    templates: list[Template] = []
    for chunk in filter(None, (c.strip() for c in raw.split(","))):
        parts = chunk.split(":")
        if len(parts) < 2:
            raise ProviderError(f"bad template spec: {chunk!r}")
        name, ref = parts[0], parts[1]
        slot = parts[2] if len(parts) > 2 and parts[2] else None
        templates.append(Template(name=name, provider_ref=ref, licence_slot=slot))
    return templates


@lru_cache
def get_provider() -> JumpBoxProvider | None:
    s = get_settings()
    kind = (getattr(s, "vm_provider", "") or "").strip().lower()

    if not kind:
        return None

    templates = _parse_templates(getattr(s, "vm_templates", ""))

    if kind == "proxmox":
        from .proxmox import ProxmoxProvider

        return ProxmoxProvider(
            base_url=s.proxmox_url,
            token_id=s.proxmox_token_id,
            token_secret=s.proxmox_token_secret,
            node=s.proxmox_node,
            templates=templates,
            storage=s.proxmox_storage,
            bridge=s.proxmox_bridge,
            verify_tls=s.proxmox_verify_tls,
            full_clone=s.proxmox_full_clone,
        )

    if kind == "kubevirt":
        from .kubevirt import KubeVirtProvider  # not written yet

        return KubeVirtProvider(
            namespace=s.kubevirt_namespace,
            templates=templates,
        )

    raise ProviderError(f"unknown vm_provider: {kind!r}")
