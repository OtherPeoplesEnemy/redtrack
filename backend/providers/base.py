"""Jump box provisioning — provider abstraction.

RedTrack talks only to JumpBoxProvider. Backends (Proxmox, KubeVirt)
implement it. Nothing in the checkout logic knows which is in use.
"""

from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from datetime import datetime
from enum import Enum


class InstanceState(str, Enum):
    PROVISIONING = "provisioning"
    RUNNING = "running"
    STOPPED = "stopped"
    ERROR = "error"
    DESTROYED = "destroyed"


@dataclass(frozen=True)
class Template:
    """A golden image. Each Burp-licensed template occupies one slot."""

    name: str
    provider_ref: str          # Proxmox VMID, or KubeVirt DataVolume name
    licence_slot: str | None = None   # e.g. "burp-pro-3"; None = unlicensed
    default_cores: int = 4
    default_memory_mb: int = 8192
    default_disk_gb: int = 80


@dataclass
class InstanceSpec:
    engagement_id: str
    owner: str                 # RedTrack user
    template: Template
    cores: int | None = None
    memory_mb: int | None = None
    disk_gb: int | None = None
    ssh_public_keys: list[str] = field(default_factory=list)
    expires_at: datetime | None = None


@dataclass
class Instance:
    """Normalised record. Mirrors the jump_box_instance table."""

    id: str                    # RedTrack UUID — our source of truth
    provider: str              # "proxmox" | "kubevirt"
    provider_id: str           # VMID / VM object name
    engagement_id: str
    owner: str
    licence_slot: str | None
    state: InstanceState
    ip_address: str | None = None
    created_at: datetime | None = None
    expires_at: datetime | None = None


@dataclass
class ConsoleTicket:
    """Short-lived console access. Seconds, not hours."""

    url: str                   # websocket endpoint RedTrack proxies
    ticket: str
    expires_at: datetime


@dataclass
class SSHAccess:
    host: str
    port: int = 22
    username: str = "kali"
    certificate: str | None = None   # signed cert, expires with engagement


class ProviderError(RuntimeError):
    pass


class LicenceSlotUnavailable(ProviderError):
    """All five Burp templates are checked out."""


class JumpBoxProvider(ABC):
    """Six operations. Everything else is RedTrack's problem."""

    name: str

    @abstractmethod
    async def provision(self, spec: InstanceSpec) -> Instance:
        """Clone from the golden template. Returns before boot completes."""

    @abstractmethod
    async def status(self, instance: Instance) -> Instance:
        """Refresh state, IP, readiness. Idempotent."""

    @abstractmethod
    async def connect(
        self, instance: Instance, *, mode: str = "console"
    ) -> ConsoleTicket | SSHAccess:
        """mode: 'console' for browser noVNC, 'ssh' for a real terminal."""

    @abstractmethod
    async def snapshot(self, instance: Instance, label: str) -> str:
        """Roll-back point mid-engagement. Returns snapshot ref."""

    @abstractmethod
    async def restore(self, instance: Instance, snapshot_ref: str) -> Instance:
        """Back to a known-good state without losing the licence slot."""

    @abstractmethod
    async def destroy(self, instance: Instance) -> None:
        """Tear down and confirm the disk is actually gone."""

    @abstractmethod
    async def list_templates(self) -> list[Template]:
        """Discovery — lets RedTrack show which licence slots exist."""
