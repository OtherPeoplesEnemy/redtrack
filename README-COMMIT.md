# RedTrack — jump box VM provisioning

Unzip `redtrack-vm-provisioning.zip` over your local repo root. The
`backend/` paths inside match the repo, so files land where they belong.

## Files

Modified (built against current `main`):

- `backend/config.py` — provisioning settings block
- `backend/models.py` — 8 columns on `JumpBox`, `ssh_public_key` on `User`
- `backend/main.py` — checkout/checkin wiring, helpers, 3 new endpoints

New:

- `backend/providers/{__init__,base,proxmox}.py`
- `backend/alembic/versions/0006_jumpbox_provisioning.py`

`httpx` is already in `requirements.txt` — no dependency change.

## Commit as ONE commit

`models.py` and `0006_...py` must land together. Separating them is what
emptied the engagements tab twice before.

    git add backend/config.py backend/models.py backend/main.py \
            backend/providers backend/alembic/versions/0006_jumpbox_provisioning.py
    git commit -m "Add jump box VM provisioning (Proxmox + provider abstraction)"
    git push

## Deploy

    git pull
    docker compose up -d --build backend
    docker compose logs -f backend        # watch 0006 apply

Verify:

    docker compose exec db psql -U redtrack -d redtrack \
      -c "SELECT version_num FROM alembic_version;"

Should read `0006`.

## Nothing changes until you enable it

`vm_provider` defaults to `""`, so `get_provider()` returns `None` and
every jump box behaves exactly as it does today. Deploy safely, flip it
on when your home Proxmox is ready.

## Enabling Proxmox

In `.env`:

    VM_PROVIDER=proxmox
    VM_TEMPLATES=kali-burp-1:9001:burp-pro-1,kali-burp-2:9002:burp-pro-2
    PROXMOX_URL=https://192.168.0.x:8006
    PROXMOX_TOKEN_ID=redtrack@pve!provisioner
    PROXMOX_TOKEN_SECRET=...
    PROXMOX_NODE=pve
    PROXMOX_STORAGE=local-lvm
    PROXMOX_BRIDGE=vmbr0
    PROXMOX_VERIFY_TLS=false      # self-signed PVE cert at home

The `provider_ref` in `VM_TEMPLATES` is the Proxmox VMID of the golden
template. Then create five jump box rows with `ephemeral=true` and
`template_name` set to each template name.

## Before it works end to end

- **`qemu-guest-agent` must be in the golden image.** Without it
  `status()` never returns an IP and the box never shows as ready.
- **Populate `users.ssh_public_key`.** The column exists now but nothing
  writes to it — needs a profile field in the frontend. Until then the
  browser console is the only way in.
- **Proxmox API token** needs `VM.Allocate`, `VM.Clone`, `VM.Config.*`,
  `VM.PowerMgmt`, `VM.Console`, and `Datastore.AllocateSpace`.
- **`auto_release_hours` still isn't enforced.** It was harmless with
  physical boxes; with VMs it means a forgotten checkout holds a licence
  slot and a running VM indefinitely. Worth a periodic task.

## Not done yet

- `backend/providers/kubevirt.py` — the factory references it, but
  setting `VM_PROVIDER=kubevirt` will `ImportError` until it's written.
- Frontend: console viewer, poll-until-ready, and a reset button on the
  Resources page.
