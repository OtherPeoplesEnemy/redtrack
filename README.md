# RedTrack v2 — Pentest Management Platform

Open-source collaborative penetration testing management platform with AI assistance, scanner imports, MITRE ATT&CK integration, and report generation.

---

## Features

### Core
- **Engagements** — full lifecycle management (Planning → Active → Completed → Archived)
- **Kanban Board** — drag-and-drop engagement pipeline
- **Findings** — severity-sorted with CVSS, CWE, CVE tracking
- **VulnDB** — local template library + live NVD, MITRE ATT&CK, and AI generation
- **Reports** — DOCX generation with custom branded template support + PDF via LibreOffice
- **Dark/Light mode** toggle

### Recon & Scanner Imports
- **Nmap XML** — host/port population via UI upload or redtrack-cli
- **Nessus / Tenable** — hosts + findings auto-import
- **OpenVAS / Greenbone** — hosts + findings auto-import
- **Qualys** — hosts + findings auto-import
- **Rapid7 InsightVM** — hosts + findings auto-import
- **PingCastle** — Active Directory findings import
- **Burp Suite** — web findings import

### MITRE ATT&CK
- Import Navigator layer JSON
- Kanban-style technique board per engagement
- Assign techniques to team members
- Track status: Not Started → In Progress → Tested → Successful → Failed → N/A
- Export back to Navigator JSON
- Auto-links techniques to findings

### Tasks
- Per-engagement task board (To Do → In Progress → Review → Done → Blocked)
- Assign to team members, set priority and due dates
- Progress tracking with % complete bar

### AI Assistant
- Powered by Gemini or Anthropic (switchable via .env)
- Finding analysis, CVSS suggestions, remediation generation
- Steps to reproduce generation
- Executive summary generation for reports
- AI Red Team kill chain guidance (NVIDIA + MITRE ATLAS + OWASP LLM)
- AI-powered VulnDB template generation

### CLI Connector (redtrack-cli)
- Send findings from Kali/Windows to RedTrack
- Import Nmap XML to recon
- Quick-add findings from terminal
- API key authentication

### Notebook & RedNote Sync
- **Per-engagement notebook** — CherryTree-style tree of folders and rich-text nodes
- **RedNote integration** — push a local [RedNote](https://github.com/OtherPeoplesEnemy/rednote) project into an engagement over the API
- Each tester's push lands under its own subtree, so several people can sync the same engagement without collision
- Synced nodes are **read-only in RedTrack** — RedNote stays the source of truth; edit there and push again
- Deleting a node in RedNote removes it on the next push
- Authenticates with a per-user API token, so ownership follows whoever pushed

### Jump Boxes
- Shared jump box inventory with checkout / check-in and engagement attribution
- Session recording — commands logged per session with duration and status
- Slack notification on checkout and check-in
- Auto-release window per box (`auto_release_hours`)
- **VM provisioning** (optional) — checkout clones a golden template, check-in destroys it
  - Backends: Proxmox VE, and OpenShift/KubeVirt (planned)
  - One jump box row per licensed template, so the existing checkout guard caps concurrency
  - Short-lived browser console tickets proxied through RedTrack; SSH keys injected at boot via cloud-init
  - Disabled by default — see [Jump Box VM Provisioning](#jump-box-vm-provisioning)

### Authentication & Integrations
- Local accounts with role-based access (admin / lead / tester / client)
- **SSO** — SAML 2.0 and OIDC, with IdP-provisioned accounts
- **API tokens** — per-user, scoped, for redtrack-cli and RedNote
- **Slack** — engagement and finding notifications, jump box activity
- **ServiceNow** — finding export

---

## Quick Start

### 1. Generate SSL certificate
```bash
chmod +x nginx/generate-cert.sh
./nginx/generate-cert.sh
```

### 2. Configure
```bash
cp .env.example .env
nano .env
```

Set:
```env
SECRET_KEY=<run: openssl rand -hex 32>
AI_PROVIDER=gemini
GEMINI_API_KEY=<from aistudio.google.com — free tier>
```

### 3. Build and start
```bash
docker compose up --build -d
```

### 4. Browse to
```
https://<your-server-ip>
```

Click through the self-signed cert warning. Login: `admin@redtrack.com` / `RedTrack2026!`

---

## redtrack-cli

```bash
cd cli
pip install -r requirements.txt
chmod +x redtrack-cli
sudo cp redtrack-cli /usr/local/bin/redtrack-cli
redtrack-cli config
```

Commands:
```bash
redtrack-cli status                          # Test connection
redtrack-cli engagements                     # List engagements
redtrack-cli finding quick                   # Quick add finding
redtrack-cli finding add <engagement_id>     # Full finding form
redtrack-cli nmap scan.xml <engagement_id>   # Import Nmap XML
redtrack-cli hosts list <engagement_id>      # View recon hosts
```

---

## AI Setup

**Gemini (free tier):**
1. https://aistudio.google.com → Get API Key
2. Set `GEMINI_API_KEY=` in .env
3. Set `AI_PROVIDER=gemini`

**Anthropic:**
1. https://console.anthropic.com → API Keys
2. Set `ANTHROPIC_API_KEY=` in .env
3. Set `AI_PROVIDER=anthropic`

---

## Custom Report Templates

1. Create a .docx file with your branding
2. Add placeholders: `{{client_name}}`, `{{executive_summary}}`, `{{findings_table}}`, `{{findings_detail}}`, `{{total_findings}}`, `{{critical_count}}`, `{{start_date}}`, `{{end_date}}`
3. Upload in Reports → Templates tab
4. Select when generating a report

---

## Scanner Import

In any engagement → Recon tab → Import Scan:
- Select scanner type (Nessus, OpenVAS, Qualys, Rapid7, PingCastle, Burp, Nmap)
- Set minimum severity to import
- Choose whether to auto-create findings
- Upload the XML file

---

## RedNote Sync

[RedNote](https://github.com/OtherPeoplesEnemy/rednote) is the offline notes app
(Tauri + SQLite) that pairs with RedTrack. It works with no network; pushing to
RedTrack is an explicit action.

**Setup:**

1. In RedTrack: Settings → API Tokens → create a token
2. In RedNote: Settings → RedTrack, paste the token and your server URL
3. Map the RedNote project to a RedTrack engagement, then push

**Endpoint:**

```
POST /engagements/{engagement_id}/notes/sync
Authorization: Bearer <api-token>

{
  "project_id":   "<stable RedNote project uuid>",
  "project_name": "Acme Internal",
  "nodes": [
    {
      "id":        "<RedNote node id>",
      "parent_id": "<RedNote parent id or null>",
      "title":     "Domain Admin path",
      "node_type": "note",
      "content":   "<html>",
      "icon":      "🔑",
      "sort_order": 0
    }
  ]
}
```

The push is a **full-state bulk upsert**, not a delta: send every node in the
project each time. Anything previously synced but absent from the payload is
treated as deleted in RedNote and removed. `project_id` must be stable across
pushes — it's what pins the subtree.

Notes created directly in RedTrack (`source="redtrack"`) are unaffected by sync
and remain editable by anyone on the engagement.

---

## Jump Box VM Provisioning

Optional. With `VM_PROVIDER` unset, jump boxes behave as static inventory rows
and nothing below applies.

When enabled, checking out an *ephemeral* jump box clones a golden template into
a fresh VM; checking in destroys it. Each template is pre-activated with one
licensed toolset (e.g. a Burp Pro seat), so the number of templates is the
concurrency cap — the existing `status == "checked_out"` guard enforces it, with
no separate licence pool.

**Configure in `.env`:**

```env
VM_PROVIDER=proxmox
# name:template_vmid:licence_slot, comma separated
VM_TEMPLATES=kali-burp-1:9001:burp-pro-1,kali-burp-2:9002:burp-pro-2

PROXMOX_URL=https://pve.example:8006
PROXMOX_TOKEN_ID=redtrack@pve!provisioner
PROXMOX_TOKEN_SECRET=
PROXMOX_NODE=pve
PROXMOX_STORAGE=local-lvm
PROXMOX_BRIDGE=vmbr0
PROXMOX_VERIFY_TLS=true
PROXMOX_FULL_CLONE=true
```

Then create one jump box per template with `ephemeral=true` and `template_name`
set to the matching entry.

**Golden template requirements:**

- `qemu-guest-agent` installed and enabled — without it the VM never reports an
  IP and never shows as ready
- `cloud-init` enabled, with **no** baked-in SSH keys or credentials
- Licensed tooling pre-activated, so a reset returns to a fully configured box

**Proxmox API token** needs `VM.Allocate`, `VM.Clone`, `VM.Config.*`,
`VM.PowerMgmt`, `VM.Console`, and `Datastore.AllocateSpace`.

**Endpoints:**

```
GET  /jumpboxes/{id}/instance   # poll after checkout until ready
POST /jumpboxes/{id}/console    # short-lived console ticket (~30s)
POST /jumpboxes/{id}/reset      # destroy + reprovision, same licence slot
```

Failure handling is deliberately asymmetric: a failed **provision** rolls the
checkout back so the slot isn't stranded, while a failed **destroy** does not
block check-in — the box is flagged `provision_state="error"` with the details
in `provision_error` so an orphaned VM is visible rather than forgotten.

**Adding a backend:** implement `JumpBoxProvider` in `backend/providers/base.py`
and register it in the factory in `backend/providers/__init__.py`. Nothing in
the checkout path is backend-specific.

---

## Let's Encrypt (when ready)

```bash
sudo certbot certonly --standalone -d yourdomain.com
sudo cp /etc/letsencrypt/live/yourdomain.com/fullchain.pem nginx/certs/redtrack.crt
sudo cp /etc/letsencrypt/live/yourdomain.com/privkey.pem nginx/certs/redtrack.key
docker compose restart nginx
```

---

## Architecture

```
Browser (HTTPS:443)
       │
     Nginx — SSL + reverse proxy
       │
       ├── /        → React frontend (Vite)
       ├── /api/    → FastAPI backend
       └── /ws/     → WebSocket (real-time)
              │
         PostgreSQL + Redis
              │
       Provider interface
              │
       ├── Proxmox VE API
       └── KubeVirt (planned)
```

---

## Default Credentials

```
Email:    admin@redtrack.com
Password: RedTrack2026!
```

Change immediately after first login in Settings → My Profile.

---

## Stack

- **Frontend:** React 18, Vite, react-query, recharts, @hello-pangea/dnd
- **Backend:** FastAPI, SQLAlchemy async, PostgreSQL, Redis
- **AI:** Google Gemini / Anthropic Claude (switchable)
- **Reports:** python-docx + LibreOffice PDF
- **Notes:** RedNote (Tauri + SQLite) sync over API token
- **Provisioning:** Proxmox VE (KubeVirt planned) via pluggable provider interface
- **Infrastructure:** Docker Compose, Nginx, self-signed SSL

---

## Roadmap

- [x] Burp Suite real-time extension (Jython)
- [x] Slack notifications
- [x] RedNote sync
- [x] Jump box VM provisioning — Proxmox
- [ ] Jump box VM provisioning — OpenShift / KubeVirt
- [ ] Frontend for provisioned boxes (console viewer, reset, poll-until-ready)
- [ ] Enforce `auto_release_hours` (matters once a stale checkout holds a live VM)
- [ ] Chrome extension (floating note-taking panel)
- [ ] CrackMapExec / Nuclei CLI parsers
- [ ] Full MITRE ATLAS matrix for AI red team
- [ ] Client portal (read-only scoped access)
- [ ] Email notifications
- [ ] Full interactive MITRE ATT&CK matrix (without Navigator dependency)
- [ ] Risk auto-calculation for findings
