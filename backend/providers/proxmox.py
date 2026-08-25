"""Proxmox VE backend for jump box provisioning.

Uses the PVE REST API with an API token (never root@pam password auth).
Clones are linked clones off the golden templates — fast, and each
template carries its own pre-activated Burp licence.
"""

from __future__ import annotations

import asyncio
import uuid
from datetime import datetime, timedelta, timezone

import httpx

from .base import (
    ConsoleTicket,
    Instance,
    InstanceSpec,
    InstanceState,
    JumpBoxProvider,
    ProviderError,
    SSHAccess,
    Template,
)

CONSOLE_TICKET_TTL = timedelta(seconds=30)
_STATE_MAP = {
    "running": InstanceState.RUNNING,
    "stopped": InstanceState.STOPPED,
    "paused": InstanceState.STOPPED,
}


class ProxmoxProvider(JumpBoxProvider):
    name = "proxmox"

    def __init__(
        self,
        base_url: str,
        token_id: str,
        token_secret: str,
        node: str,
        templates: list[Template],
        *,
        storage: str = "local-lvm",
        bridge: str = "vmbr0",
        verify_tls: bool = True,
        full_clone: bool = True,
    ) -> None:
        self._node = node
        self._storage = storage
        self._bridge = bridge
        self._full_clone = full_clone
        self._templates = {t.name: t for t in templates}
        self._client = httpx.AsyncClient(
            base_url=base_url.rstrip("/") + "/api2/json",
            headers={"Authorization": f"PVEAPIToken={token_id}={token_secret}"},
            verify=verify_tls,
            timeout=30.0,
        )

    # ---- plumbing -----------------------------------------------------

    async def _request(self, method: str, path: str, **kwargs) -> dict:
        resp = await self._client.request(method, path, **kwargs)
        if resp.status_code >= 400:
            raise ProviderError(f"proxmox {method} {path}: {resp.text}")
        return resp.json().get("data") or {}

    async def _next_vmid(self) -> int:
        return int(await self._request("GET", "/cluster/nextid"))

    async def _await_task(self, upid: str, timeout: float = 300.0) -> None:
        """PVE returns a UPID for async work; poll until it settles."""
        deadline = asyncio.get_event_loop().time() + timeout
        while asyncio.get_event_loop().time() < deadline:
            data = await self._request(
                "GET", f"/nodes/{self._node}/tasks/{upid}/status"
            )
            if data.get("status") == "stopped":
                if data.get("exitstatus") != "OK":
                    raise ProviderError(f"task {upid} failed: {data.get('exitstatus')}")
                return
            await asyncio.sleep(2)
        raise ProviderError(f"task {upid} timed out")

    # ---- interface ----------------------------------------------------

    async def list_templates(self) -> list[Template]:
        return list(self._templates.values())

    async def provision(self, spec: InstanceSpec) -> Instance:
        tpl = spec.template
        vmid = await self._next_vmid()
        instance_id = str(uuid.uuid4())
        hostname = f"jb-{spec.engagement_id[:8]}-{vmid}"

        upid = await self._request(
            "POST",
            f"/nodes/{self._node}/qemu/{tpl.provider_ref}/clone",
            data={
                "newid": vmid,
                "name": hostname,
                "full": 1 if self._full_clone else 0,
                "storage": self._storage,
                "target": self._node,
            },
        )
        await self._await_task(upid)

        # cloud-init: keys injected at boot, never baked into the template
        await self._request(
            "PUT",
            f"/nodes/{self._node}/qemu/{vmid}/config",
            data={
                "cores": spec.cores or tpl.default_cores,
                "memory": spec.memory_mb or tpl.default_memory_mb,
                "sshkeys": _urlencode_keys(spec.ssh_public_keys),
                "ipconfig0": "ip=dhcp",
                "net0": f"virtio,bridge={self._bridge}",
                "description": (
                    f"RedTrack engagement {spec.engagement_id}\n"
                    f"owner={spec.owner}\nlicence={tpl.licence_slot}"
                ),
            },
        )

        upid = await self._request("POST", f"/nodes/{self._node}/qemu/{vmid}/status/start")
        await self._await_task(upid)

        return Instance(
            id=instance_id,
            provider=self.name,
            provider_id=str(vmid),
            engagement_id=spec.engagement_id,
            owner=spec.owner,
            licence_slot=tpl.licence_slot,
            state=InstanceState.PROVISIONING,
            created_at=datetime.now(timezone.utc),
            expires_at=spec.expires_at,
        )

    async def status(self, instance: Instance) -> Instance:
        vmid = instance.provider_id
        data = await self._request(
            "GET", f"/nodes/{self._node}/qemu/{vmid}/status/current"
        )
        instance.state = _STATE_MAP.get(data.get("status"), InstanceState.ERROR)

        if instance.state is InstanceState.RUNNING:
            instance.ip_address = await self._guest_ip(vmid)
        return instance

    async def _guest_ip(self, vmid: str) -> str | None:
        """Needs qemu-guest-agent in the template. Worth baking in."""
        try:
            data = await self._request(
                "GET",
                f"/nodes/{self._node}/qemu/{vmid}/agent/network-get-interfaces",
            )
        except ProviderError:
            return None
        for iface in data.get("result", []):
            if iface.get("name") in ("lo", "docker0"):
                continue
            for addr in iface.get("ip-addresses", []):
                if addr.get("ip-address-type") == "ipv4":
                    return addr["ip-address"]
        return None

    async def connect(
        self, instance: Instance, *, mode: str = "console"
    ) -> ConsoleTicket | SSHAccess:
        if mode == "ssh":
            if not instance.ip_address:
                raise ProviderError("no IP yet — call status() first")
            return SSHAccess(host=instance.ip_address)

        data = await self._request(
            "POST", f"/nodes/{self._node}/qemu/{instance.provider_id}/vncproxy",
            data={"websocket": 1},
        )
        return ConsoleTicket(
            url=(
                f"/nodes/{self._node}/qemu/{instance.provider_id}"
                f"/vncwebsocket?port={data['port']}&vncticket={data['ticket']}"
            ),
            ticket=data["ticket"],
            expires_at=datetime.now(timezone.utc) + CONSOLE_TICKET_TTL,
        )

    async def snapshot(self, instance: Instance, label: str) -> str:
        upid = await self._request(
            "POST", f"/nodes/{self._node}/qemu/{instance.provider_id}/snapshot",
            data={"snapname": label, "vmstate": 0},
        )
        await self._await_task(upid)
        return label

    async def restore(self, instance: Instance, snapshot_ref: str) -> Instance:
        upid = await self._request(
            "POST",
            f"/nodes/{self._node}/qemu/{instance.provider_id}"
            f"/snapshot/{snapshot_ref}/rollback",
        )
        await self._await_task(upid)
        return await self.status(instance)

    async def destroy(self, instance: Instance) -> None:
        vmid = instance.provider_id
        try:
            upid = await self._request(
                "POST", f"/nodes/{self._node}/qemu/{vmid}/status/stop"
            )
            await self._await_task(upid)
        except ProviderError:
            pass  # already stopped

        upid = await self._request(
            "DELETE",
            f"/nodes/{self._node}/qemu/{vmid}",
            params={"purge": 1, "destroy-unreferenced-disks": 1},
        )
        await self._await_task(upid)
        instance.state = InstanceState.DESTROYED
        instance.ip_address = None


def _urlencode_keys(keys: list[str]) -> str:
    from urllib.parse import quote

    return quote("\n".join(keys), safe="")
