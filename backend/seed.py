"""
Seeds the database on first startup.
- Admin user (uses .com domain to pass email validation)
- Vuln template library
"""

from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
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

        await db.commit()
