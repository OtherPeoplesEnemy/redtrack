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
- **Infrastructure:** Docker Compose, Nginx, self-signed SSL

---

## Roadmap

- [ ] Chrome extension (floating note-taking panel)
- [ ] CrackMapExec / Nuclei CLI parsers
- [ ] Full MITRE ATLAS matrix for AI red team
- [ ] Burp Suite real-time extension
- [ ] Client portal (read-only scoped access)
- [ ] Email/Slack notifications
- [ ] Full interactive MITRE ATT&CK matrix (without Navigator dependency)
