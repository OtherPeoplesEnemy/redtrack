"""
Seeds the database on first startup.
- Admin user (uses .com domain to pass email validation)
- Vuln template library
"""

from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func
from database import AsyncSessionLocal
from models import User, VulnTemplate, UserRole, Severity
from auth import hash_password

TEMPLATES = [
    {"title": "SQL Injection", "severity": Severity.critical, "cvss_score": 9.1, "cwe": "CWE-89", "category": "OWASP Top 10",
     "description": "Unsanitized user input is passed directly into SQL queries, allowing an attacker to manipulate query logic, extract data, or execute OS commands.",
     "impact": "Full database read/write access, potential OS command execution, authentication bypass.",
     "remediation": "Use parameterized queries or prepared statements. Apply input validation. Deploy a WAF.",
     "references": "OWASP A03:2021, CWE-89"},
    {"title": "Cross-Site Scripting (Reflected)", "severity": Severity.medium, "cvss_score": 6.1, "cwe": "CWE-79", "category": "OWASP Top 10",
     "description": "User-controlled input is reflected in the HTTP response without proper encoding, allowing script injection in victims' browsers.",
     "impact": "Session hijacking, credential theft, defacement, phishing.",
     "remediation": "Apply context-aware output encoding. Implement Content-Security-Policy. Use HTTPOnly cookies.",
     "references": "OWASP A03:2021, CWE-79"},
    {"title": "Cross-Site Scripting (Stored)", "severity": Severity.high, "cvss_score": 8.0, "cwe": "CWE-79", "category": "OWASP Top 10",
     "description": "Malicious scripts are stored on the server and executed in every user's browser who views the affected content.",
     "impact": "Mass session hijacking, persistent malware delivery, full account compromise.",
     "remediation": "Sanitize and validate all stored input. Use a strict Content-Security-Policy.",
     "references": "OWASP A03:2021, CWE-79"},
    {"title": "Broken Authentication", "severity": Severity.high, "cvss_score": 8.0, "cwe": "CWE-287", "category": "OWASP Top 10",
     "description": "Authentication mechanisms can be bypassed through credential stuffing, brute force, or session fixation attacks.",
     "impact": "Account takeover, unauthorized data access.",
     "remediation": "Implement MFA. Enforce account lockout. Use secure session management. Rotate tokens on login.",
     "references": "OWASP A07:2021, CWE-287"},
    {"title": "Insecure Direct Object Reference (IDOR)", "severity": Severity.high, "cvss_score": 7.5, "cwe": "CWE-639", "category": "OWASP Top 10",
     "description": "Object references are exposed to users and not validated server-side, allowing attackers to access other users' data.",
     "impact": "Horizontal privilege escalation, mass data exposure.",
     "remediation": "Validate all object-level authorization server-side. Use indirect references (UUIDs over sequential IDs).",
     "references": "OWASP A01:2021, CWE-639"},
    {"title": "Security Misconfiguration", "severity": Severity.medium, "cvss_score": 5.3, "cwe": "CWE-1008", "category": "OWASP Top 10",
     "description": "Default credentials, unnecessary features enabled, verbose error messages, or missing security hardening.",
     "impact": "Varies — from info disclosure to full compromise.",
     "remediation": "Follow CIS benchmarks. Disable unused features. Automate configuration auditing.",
     "references": "OWASP A05:2021"},
    {"title": "Command Injection", "severity": Severity.critical, "cvss_score": 9.8, "cwe": "CWE-78", "category": "Injection",
     "description": "User input is passed to OS shell commands without sanitization, allowing execution of arbitrary commands.",
     "impact": "Full server compromise, data exfiltration, lateral movement.",
     "remediation": "Avoid shell calls. Use language APIs. Apply strict input allowlisting.",
     "references": "CWE-78, OWASP A03:2021"},
    {"title": "Path Traversal", "severity": Severity.high, "cvss_score": 7.5, "cwe": "CWE-22", "category": "Injection",
     "description": "File paths constructed from user input allow traversal outside the intended directory.",
     "impact": "Arbitrary file read including sensitive config/credentials, potential file write.",
     "remediation": "Resolve and canonicalize paths. Validate against an allowlist of permitted directories.",
     "references": "CWE-22"},
    {"title": "Server-Side Request Forgery (SSRF)", "severity": Severity.high, "cvss_score": 8.6, "cwe": "CWE-918", "category": "Injection",
     "description": "The server fetches user-supplied URLs without restriction, enabling access to internal services and cloud metadata.",
     "impact": "Internal network reconnaissance, cloud credential theft, RCE via internal services.",
     "remediation": "Allowlist permitted URL schemes and destinations. Block cloud metadata IPs. Use network-level egress filter.",
     "references": "OWASP A10:2021, CWE-918"},
    {"title": "Missing Rate Limiting", "severity": Severity.medium, "cvss_score": 5.3, "cwe": "CWE-770", "category": "API Security",
     "description": "No throttling on authentication, password reset, or sensitive endpoints enables brute force and enumeration attacks.",
     "impact": "Account brute force, resource exhaustion, user enumeration.",
     "remediation": "Implement per-IP and per-account rate limiting. Add CAPTCHA on sensitive flows.",
     "references": "OWASP API4:2023"},
    {"title": "Default Credentials", "severity": Severity.critical, "cvss_score": 9.8, "cwe": "CWE-1188", "category": "Authentication",
     "description": "Device, application, or service using manufacturer/vendor default credentials that have not been changed.",
     "impact": "Immediate administrative access, full compromise.",
     "remediation": "Change all default credentials immediately. Enforce credential rotation policy.",
     "references": "CWE-1188"},
    {"title": "S3 Bucket Publicly Accessible", "severity": Severity.high, "cvss_score": 8.6, "cwe": "CWE-732", "category": "Cloud Security",
     "description": "Cloud storage bucket is publicly readable or writable, exposing sensitive files without authentication.",
     "impact": "Data exposure, potential malware hosting, compliance violation.",
     "remediation": "Enable S3 Block Public Access at account level. Audit bucket policies. Enable CloudTrail logging.",
     "references": "CWE-732, AWS Security Best Practices"},
    {"title": "Missing HSTS Header", "severity": Severity.low, "cvss_score": 3.7, "cwe": "CWE-319", "category": "Transport Security",
     "description": "The application does not send a Strict-Transport-Security header, allowing potential downgrade attacks.",
     "impact": "SSL stripping attacks, credential interception on hostile networks.",
     "remediation": "Add: Strict-Transport-Security: max-age=31536000; includeSubDomains; preload",
     "references": "RFC 6797"},
    # AI Red Team specific templates
    {"title": "LLM01 - Prompt Injection", "severity": Severity.critical, "cvss_score": 9.0, "cwe": "CWE-77", "category": "AI Red Team / OWASP LLM",
     "description": "Attacker crafts input that overrides the LLM's system prompt or intended behavior, causing it to perform unauthorized actions.",
     "impact": "Complete bypass of safety filters, unauthorized data access, model hijacking.",
     "remediation": "Implement strict input validation. Use prompt hardening. Apply privilege separation between system and user prompts.",
     "references": "OWASP LLM01:2025, MITRE ATLAS AML.TA0003"},
    {"title": "LLM02 - Insecure Output Handling", "severity": Severity.high, "cvss_score": 8.2, "cwe": "CWE-116", "category": "AI Red Team / OWASP LLM",
     "description": "LLM output is passed to downstream systems without validation, enabling XSS, SSRF, or code execution via AI-generated content.",
     "impact": "Cross-site scripting, server-side request forgery, remote code execution.",
     "remediation": "Treat all LLM output as untrusted. Apply output encoding. Validate before passing to interpreters.",
     "references": "OWASP LLM02:2025, MITRE ATLAS AML.T0096"},
    {"title": "LLM06 - Sensitive Information Disclosure", "severity": Severity.high, "cvss_score": 7.5, "cwe": "CWE-200", "category": "AI Red Team / OWASP LLM",
     "description": "LLM reveals sensitive data including training data, system prompts, PII, or proprietary information through adversarial questioning.",
     "impact": "Training data exposure, system prompt leakage, PII disclosure, competitive intelligence theft.",
     "remediation": "Implement data minimization in training. Apply output filters for sensitive patterns. Use differential privacy.",
     "references": "OWASP LLM06:2025, MITRE ATLAS AML.TA0000"},
    {"title": "LLM08 - Excessive Agency", "severity": Severity.high, "cvss_score": 8.8, "cwe": "CWE-284", "category": "AI Red Team / OWASP LLM",
     "description": "LLM-based agent is granted excessive permissions or autonomy, allowing attacker-controlled prompts to trigger destructive actions.",
     "impact": "Unauthorized file system access, API abuse, lateral movement through connected systems.",
     "remediation": "Apply least privilege to all agent tools. Require human confirmation for destructive actions. Limit plugin permissions.",
     "references": "OWASP LLM08:2025, MITRE ATLAS AML.TA0002"},
    {"title": "Training Data Poisoning", "severity": Severity.high, "cvss_score": 8.0, "cwe": "CWE-345", "category": "AI Red Team / MITRE ATLAS",
     "description": "Attacker tampers with training data or RAG data sources to introduce backdoors, biases, or malicious behaviors into the model.",
     "impact": "Persistent model compromise, backdoored outputs, biased decision making.",
     "remediation": "Implement data provenance and integrity checks. Monitor training pipelines. Use anomaly detection on training data.",
     "references": "MITRE ATLAS AML.TA0003, OWASP LLM03:2025"},
]


async def seed_data():
    async with AsyncSessionLocal() as db:
        # Admin user — use .com to pass strict email validation
        result = await db.execute(select(User).where(User.email == "admin@redtrack.com"))
        if not result.scalar_one_or_none():
            admin = User(
                email="admin@redtrack.com",
                username="admin",
                full_name="Platform Admin",
                hashed_password=hash_password("RedTrack2026!"),
                role=UserRole.admin,
                is_active=True,
            )
            db.add(admin)
            print("[seed] Created admin user: admin@redtrack.com / RedTrack2026!")

        # Vuln templates
        count_result = await db.execute(select(VulnTemplate))
        if not count_result.scalars().all():
            for t in TEMPLATES:
                template = VulnTemplate(**t, tags=[t["category"]])
                db.add(template)
            print(f"[seed] Seeded {len(TEMPLATES)} vulnerability templates")

        await seed_task_templates(db)
        await db.commit()

TASK_TEMPLATES = [
    # ── Recon & OSINT ──────────────────────────────────────────────────────────
    {"title": "Nmap TCP Port Scan", "category": "Recon & OSINT", "priority": "High",
     "description": "Full TCP port scan to identify open services on target hosts.",
     "tools": "nmap -sV -sC -p- --open -oX scan.xml <target>",
     "tags": ["recon", "nmap", "network"], "engagement_types": ["Network", "Web App", "Red Team"]},

    {"title": "Nmap UDP Port Scan", "category": "Recon & OSINT", "priority": "Medium",
     "description": "UDP port scan for services like DNS, SNMP, NTP that may be overlooked.",
     "tools": "nmap -sU --top-ports 200 -oX udp_scan.xml <target>",
     "tags": ["recon", "nmap", "udp"], "engagement_types": ["Network", "Red Team"]},

    {"title": "RustScan Fast Port Discovery", "category": "Recon & OSINT", "priority": "High",
     "description": "Ultra-fast port discovery then pass to Nmap for service detection.",
     "tools": "rustscan -a <target> -- -sV -sC -oX scan.xml",
     "tags": ["recon", "rustscan", "network"], "engagement_types": ["Network", "Web App", "Red Team"]},

    {"title": "Shodan Passive Recon", "category": "Recon & OSINT", "priority": "High",
     "description": "Passive reconnaissance using Shodan to identify internet-facing assets, open ports, and exposed services without touching the target.",
     "tools": "shodan search org:<target> | shodan host <ip>",
     "references": "https://shodan.io", "tags": ["recon", "osint", "shodan"], "engagement_types": ["Network", "Web App", "Red Team", "Cloud"]},

    {"title": "Censys Asset Discovery", "category": "Recon & OSINT", "priority": "Medium",
     "description": "Enumerate internet-facing assets using Censys search engine.",
     "tools": "censys search <target-domain>", "references": "https://censys.io",
     "tags": ["recon", "osint", "censys"], "engagement_types": ["Network", "Web App", "Red Team"]},

    {"title": "DNS Enumeration & Subdomain Discovery", "category": "Recon & OSINT", "priority": "High",
     "description": "Enumerate DNS records and discover subdomains using multiple techniques.",
     "tools": "amass enum -d <domain>
subfinder -d <domain>
dnsx -d <domain>",
     "tags": ["recon", "dns", "subdomains"], "engagement_types": ["Web App", "Red Team", "Network"]},

    {"title": "Certificate Transparency Log Search", "category": "Recon & OSINT", "priority": "Medium",
     "description": "Search certificate transparency logs to discover subdomains and hosts.",
     "tools": "curl https://crt.sh/?q=<domain>&output=json | jq",
     "references": "https://crt.sh", "tags": ["recon", "osint", "certificates"], "engagement_types": ["Web App", "Red Team"]},

    {"title": "Google Dorks", "category": "Recon & OSINT", "priority": "Medium",
     "description": "Use Google dorking to find exposed files, login pages, and sensitive information.",
     "tools": 'site:<target> filetype:pdf
site:<target> inurl:admin
site:<target> ext:sql OR ext:env',
     "tags": ["recon", "osint", "google"], "engagement_types": ["Web App", "Red Team"]},

    {"title": "GitHub Secret Scanning", "category": "Recon & OSINT", "priority": "High",
     "description": "Search GitHub for accidentally committed secrets, API keys, and credentials.",
     "tools": "trufflehog github --org=<orgname>
gitdorks_go -q <target>",
     "tags": ["recon", "osint", "github", "secrets"], "engagement_types": ["Web App", "Red Team", "Cloud"]},

    {"title": "Wayback Machine Recon", "category": "Recon & OSINT", "priority": "Low",
     "description": "Check archived versions of target website for old endpoints, files, and credentials.",
     "tools": "waybackurls <domain> | sort -u
gau <domain>",
     "references": "https://web.archive.org", "tags": ["recon", "osint", "wayback"], "engagement_types": ["Web App"]},

    {"title": "WHOIS & ASN Lookup", "category": "Recon & OSINT", "priority": "Low",
     "description": "Gather ownership information, ASN ranges, and IP blocks for the target org.",
     "tools": "whois <domain>
whois <ip>
amass intel -org <orgname>",
     "tags": ["recon", "osint", "whois"], "engagement_types": ["Network", "Web App", "Red Team"]},

    {"title": "LinkedIn & Social OSINT", "category": "Recon & OSINT", "priority": "Medium",
     "description": "Gather employee names, roles, email formats, and technology stack from LinkedIn and social media.",
     "tools": "linkedin2username
theHarvester -d <domain> -b linkedin",
     "tags": ["recon", "osint", "social"], "engagement_types": ["Red Team", "Social Engineering"]},

    # ── Web Application ────────────────────────────────────────────────────────
    {"title": "Directory & File Bruteforce", "category": "Web Application", "priority": "High",
     "description": "Enumerate hidden directories and files on the web server.",
     "tools": "ffuf -w /usr/share/wordlists/dirbuster/directory-list-2.3-medium.txt -u https://<target>/FUZZ
feroxbuster -u https://<target>",
     "tags": ["web", "enumeration", "ffuf"], "engagement_types": ["Web App", "Red Team"]},

    {"title": "Burp Suite Spider & Active Scan", "category": "Web Application", "priority": "High",
     "description": "Spider the application to map all endpoints then run active scanner.",
     "tools": "Burp Suite Pro — Spider + Active Scan
Burp Suite Community — Manual crawl",
     "tags": ["web", "burp", "scanning"], "engagement_types": ["Web App"]},

    {"title": "Authentication Testing", "category": "Web Application", "priority": "High",
     "description": "Test authentication mechanisms for weaknesses including brute force, default creds, password reset flaws, and MFA bypass.",
     "tools": "hydra -L users.txt -P passwords.txt <target> http-post-form
Burp Suite Intruder",
     "tags": ["web", "authentication"], "engagement_types": ["Web App", "Red Team"]},

    {"title": "SQL Injection Testing", "category": "Web Application", "priority": "High",
     "description": "Test all input fields for SQL injection vulnerabilities.",
     "tools": "sqlmap -u <url> --forms --crawl=3
Manual testing with Burp Suite",
     "tags": ["web", "sqli", "injection"], "engagement_types": ["Web App"]},

    {"title": "XSS Testing", "category": "Web Application", "priority": "Medium",
     "description": "Test for reflected, stored, and DOM-based cross-site scripting.",
     "tools": "dalfox url <url>
Burp Suite Scanner
Manual payload testing",
     "tags": ["web", "xss"], "engagement_types": ["Web App"]},

    {"title": "API Endpoint Enumeration", "category": "Web Application", "priority": "High",
     "description": "Discover and test API endpoints for authentication issues, IDOR, and injection.",
     "tools": "kiterunner scan <target>
ffuf -w api_wordlist.txt -u <target>/api/FUZZ",
     "tags": ["web", "api"], "engagement_types": ["Web App"]},

    {"title": "CORS Misconfiguration Testing", "category": "Web Application", "priority": "Medium",
     "description": "Test for CORS misconfigurations that allow unauthorized cross-origin requests.",
     "tools": "corsy -u <url>
Manual Origin header manipulation in Burp",
     "tags": ["web", "cors"], "engagement_types": ["Web App"]},

    {"title": "File Upload Testing", "category": "Web Application", "priority": "High",
     "description": "Test file upload functionality for unrestricted file upload leading to RCE.",
     "tools": "Upload webshell variants
Test MIME type bypass
Test extension bypass",
     "tags": ["web", "upload", "rce"], "engagement_types": ["Web App"]},

    {"title": "SSRF Testing", "category": "Web Application", "priority": "High",
     "description": "Test for Server-Side Request Forgery in URL parameters and file import features.",
     "tools": "Burp Collaborator
SSRFire
Manual testing with internal IP payloads",
     "tags": ["web", "ssrf"], "engagement_types": ["Web App", "Cloud"]},

    # ── Network & Internal ─────────────────────────────────────────────────────
    {"title": "SMB Enumeration", "category": "Network & Internal", "priority": "High",
     "description": "Enumerate SMB shares, sessions, users, and check for signing disabled.",
     "tools": "crackmapexec smb <target> --shares
nmap --script smb-enum-shares <target>
smbclient -L //<target>",
     "tags": ["network", "smb", "crackmapexec"], "engagement_types": ["Network", "Red Team"]},

    {"title": "LDAP Enumeration", "category": "Network & Internal", "priority": "High",
     "description": "Enumerate Active Directory users, groups, and attributes via LDAP.",
     "tools": "ldapdomaindump -u <domain>\<user> -p <pass> <dc>
bloodhound-python -d <domain> -u <user> -p <pass> -c all",
     "tags": ["network", "ldap", "ad"], "engagement_types": ["Network", "Red Team"]},

    {"title": "BloodHound AD Collection", "category": "Network & Internal", "priority": "High",
     "description": "Collect Active Directory data for BloodHound attack path analysis.",
     "tools": "bloodhound-python -d <domain> -u <user> -p <pass> -c all --zip
SharpHound.exe -c all",
     "tags": ["network", "ad", "bloodhound"], "engagement_types": ["Network", "Red Team"]},

    {"title": "Kerberoasting", "category": "Network & Internal", "priority": "High",
     "description": "Request service tickets for SPNs and crack offline to obtain service account passwords.",
     "tools": "impacket-GetUserSPNs <domain>/<user>:<pass> -dc-ip <dc> -request
hashcat -m 13100 hashes.txt wordlist.txt",
     "tags": ["network", "kerberos", "ad"], "engagement_types": ["Network", "Red Team"]},

    {"title": "AS-REP Roasting", "category": "Network & Internal", "priority": "Medium",
     "description": "Target accounts with Kerberos pre-authentication disabled.",
     "tools": "impacket-GetNPUsers <domain>/ -usersfile users.txt -dc-ip <dc>
hashcat -m 18200 hashes.txt wordlist.txt",
     "tags": ["network", "kerberos", "ad"], "engagement_types": ["Network", "Red Team"]},

    {"title": "Password Spraying", "category": "Network & Internal", "priority": "High",
     "description": "Spray common passwords against all domain accounts to avoid lockout.",
     "tools": "crackmapexec smb <dc> -u users.txt -p 'Password123' --continue-on-success
kerbrute passwordspray users.txt Password123",
     "tags": ["network", "ad", "passwords"], "engagement_types": ["Network", "Red Team"]},

    {"title": "Pass-the-Hash", "category": "Network & Internal", "priority": "High",
     "description": "Use captured NTLM hashes to authenticate without cracking.",
     "tools": "crackmapexec smb <target> -u <user> -H <hash>
impacket-psexec <domain>/<user>@<target> -hashes :<hash>",
     "tags": ["network", "pth", "ad"], "engagement_types": ["Network", "Red Team"]},

    {"title": "SNMP Enumeration", "category": "Network & Internal", "priority": "Medium",
     "description": "Enumerate SNMP community strings and gather system information.",
     "tools": "onesixtyone -c community.txt <target>
snmpwalk -c public -v1 <target>",
     "tags": ["network", "snmp"], "engagement_types": ["Network"]},

    # ── Cloud ──────────────────────────────────────────────────────────────────
    {"title": "S3 Bucket Enumeration", "category": "Cloud Security", "priority": "High",
     "description": "Discover and test S3 buckets for public access and misconfiguration.",
     "tools": "aws s3 ls s3://<bucket>
s3scanner scan --buckets-file buckets.txt
GrayhatWarfare",
     "tags": ["cloud", "aws", "s3"], "engagement_types": ["Cloud", "Red Team"]},

    {"title": "AWS IAM Privilege Escalation", "category": "Cloud Security", "priority": "High",
     "description": "Enumerate IAM permissions and identify privilege escalation paths.",
     "tools": "pacu
aws-escalate
enumerate-iam",
     "tags": ["cloud", "aws", "iam"], "engagement_types": ["Cloud"]},

    {"title": "Azure AD Enumeration", "category": "Cloud Security", "priority": "High",
     "description": "Enumerate Azure AD users, groups, applications, and service principals.",
     "tools": "roadrecon gather
aad-internals
stormspotter",
     "tags": ["cloud", "azure", "aad"], "engagement_types": ["Cloud", "Red Team"]},

    # ── AI Red Team ────────────────────────────────────────────────────────────
    {"title": "Prompt Injection Testing", "category": "AI Red Team", "priority": "Critical",
     "description": "Test LLM endpoints for prompt injection — attempt to override system prompt and extract instructions.",
     "tools": "Manual crafted prompts
GPTFuzz
PromptBench",
     "tags": ["ai", "llm", "prompt-injection"], "engagement_types": ["AI Red Team"]},

    {"title": "System Prompt Extraction", "category": "AI Red Team", "priority": "High",
     "description": "Attempt to extract the hidden system prompt using various jailbreak and extraction techniques.",
     "tools": "Manual prompting: 'Repeat everything above'
Indirect extraction via reflection",
     "tags": ["ai", "llm", "system-prompt"], "engagement_types": ["AI Red Team"]},

    {"title": "Jailbreak Testing", "category": "AI Red Team", "priority": "High",
     "description": "Test safety filter bypass using DAN, roleplay, encoding, and other jailbreak techniques.",
     "tools": "Manual jailbreak prompts
JailbreakBench dataset
Base64/ROT13 encoding bypass",
     "tags": ["ai", "llm", "jailbreak"], "engagement_types": ["AI Red Team"]},

    {"title": "Training Data Extraction", "category": "AI Red Team", "priority": "High",
     "description": "Attempt to extract memorized training data including PII, credentials, and proprietary content.",
     "tools": "Membership inference attacks
Model inversion techniques
Repeat token attack",
     "tags": ["ai", "llm", "training-data"], "engagement_types": ["AI Red Team"]},

    {"title": "Indirect Prompt Injection via RAG", "category": "AI Red Team", "priority": "Critical",
     "description": "Inject malicious instructions into RAG data sources that the model will retrieve and execute.",
     "tools": "Poison vector database entries
Malicious document injection
Web content poisoning",
     "tags": ["ai", "llm", "rag", "indirect-injection"], "engagement_types": ["AI Red Team"]},

    {"title": "LLM Agent Tool Abuse", "category": "AI Red Team", "priority": "Critical",
     "description": "Test LLM agents for excessive agency — attempt to trigger unauthorized tool calls and actions.",
     "tools": "Manual adversarial prompts targeting tool descriptions
Test permission boundaries",
     "tags": ["ai", "llm", "agent", "tool-abuse"], "engagement_types": ["AI Red Team"]},

    # ── Reporting & Wrap-up ────────────────────────────────────────────────────
    {"title": "Screenshot Evidence Collection", "category": "Reporting", "priority": "High",
     "description": "Collect and organize screenshots, PoC output, and evidence for all findings.",
     "tools": "Flameshot / Greenshot for screenshots
Terminal output capture
Video PoC for complex findings",
     "tags": ["reporting"], "engagement_types": ["Web App", "Network", "Red Team", "Cloud", "AI Red Team"]},

    {"title": "Draft Executive Summary", "category": "Reporting", "priority": "High",
     "description": "Write executive summary covering overall risk posture, key findings, and business impact.",
     "tools": "RedTrack AI → Reports → AI Generate Executive Summary",
     "tags": ["reporting"], "engagement_types": ["Web App", "Network", "Red Team", "Cloud", "AI Red Team"]},

    {"title": "Verify Remediation", "category": "Reporting", "priority": "Medium",
     "description": "Re-test all remediated findings to confirm fixes are effective.",
     "tools": "Repeat original PoC steps
Update finding status in RedTrack",
     "tags": ["reporting", "remediation"], "engagement_types": ["Web App", "Network", "Red Team", "Cloud"]},
]


async def seed_task_templates(db):
    from models import TaskTemplate
    from sqlalchemy import select
    count = await db.scalar(select(func.count(TaskTemplate.id)))
    if not count:
        for t in TASK_TEMPLATES:
            template = TaskTemplate(**t)
            db.add(template)
        print(f"[seed] Seeded {len(TASK_TEMPLATES)} task templates")
