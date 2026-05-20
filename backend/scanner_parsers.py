"""
RedTrack Scanner Import Parsers
Supports: Nessus, OpenVAS/Greenbone, Qualys, Rapid7 InsightVM, PingCastle, Burp Suite
Each parser returns: { hosts: [...], findings: [...] }
"""

import xml.etree.ElementTree as ET
from typing import Optional


def _severity_from_cvss(score: Optional[float]) -> str:
    if score is None:
        return "Info"
    if score >= 9.0:
        return "Critical"
    if score >= 7.0:
        return "High"
    if score >= 4.0:
        return "Medium"
    if score > 0:
        return "Low"
    return "Info"


def _nessus_severity(level: int) -> str:
    return {0: "Info", 1: "Low", 2: "Medium", 3: "High", 4: "Critical"}.get(level, "Info")


def _openvas_severity(score: float) -> str:
    if score >= 9.0:
        return "Critical"
    if score >= 7.0:
        return "High"
    if score >= 4.0:
        return "Medium"
    if score > 0:
        return "Low"
    return "Info"


# ─── Nessus ──────────────────────────────────────────────────────────────────

def parse_nessus(xml_content: str) -> dict:
    root = ET.fromstring(xml_content)
    hosts = []
    findings = []

    for report_host in root.findall(".//ReportHost"):
        ip = report_host.get("name", "")
        hostname = None
        os_name = None
        ports = []

        # Host properties
        host_props = report_host.find("HostProperties")
        if host_props:
            for tag in host_props.findall("tag"):
                name = tag.get("name", "")
                val = tag.text or ""
                if name == "host-fqdn":
                    hostname = val
                elif name in ("operating-system", "os"):
                    os_name = val

        # Report items (findings)
        for item in report_host.findall("ReportItem"):
            port = int(item.get("port", 0))
            protocol = item.get("protocol", "tcp")
            svc_name = item.get("svc_name", "")
            severity_level = int(item.get("severity", 0))
            plugin_name = item.get("pluginName", "")
            plugin_id = item.get("pluginID", "")

            if port > 0 and port not in ports:
                ports.append(port)

            # Skip info-level unless it's a useful service detection
            if severity_level == 0:
                continue

            severity = _nessus_severity(severity_level)
            description = item.findtext("description") or ""
            synopsis = item.findtext("synopsis") or ""
            solution = item.findtext("solution") or ""
            cvss_score = None
            cvss_text = item.findtext("cvss3_base_score") or item.findtext("cvss_base_score")
            if cvss_text:
                try:
                    cvss_score = float(cvss_text)
                except ValueError:
                    pass
            cve = item.findtext("cve") or None
            cwe = None

            findings.append({
                "title": plugin_name or f"Nessus Plugin {plugin_id}",
                "severity": severity,
                "cvss_score": cvss_score,
                "cve": cve,
                "cwe": cwe,
                "affected_component": f"{ip}:{port}/{protocol}" if port else ip,
                "description": f"{synopsis}\n\n{description}".strip(),
                "remediation": solution,
                "source": "nessus",
                "tags": ["nessus", f"plugin:{plugin_id}"],
            })

        if ip:
            hosts.append({
                "ip_address": ip,
                "hostname": hostname,
                "os": os_name,
                "ports": ports,
                "services": [],
                "source": "nessus",
            })

    return {"hosts": hosts, "findings": findings}


# ─── OpenVAS / Greenbone ─────────────────────────────────────────────────────

def parse_openvas(xml_content: str) -> dict:
    root = ET.fromstring(xml_content)
    hosts = {}
    findings = []

    for result in root.findall(".//result"):
        host_el = result.find("host")
        ip = host_el.text.strip() if host_el is not None and host_el.text else ""
        if not ip:
            continue

        port_el = result.find("port")
        port_str = port_el.text if port_el is not None else ""
        port = 0
        protocol = "tcp"
        if port_str and "/" in port_str:
            try:
                parts = port_str.split("/")
                port = int(parts[0])
                protocol = parts[1].strip()
            except (ValueError, IndexError):
                pass

        # Build host
        if ip not in hosts:
            hosts[ip] = {"ip_address": ip, "hostname": None, "os": None, "ports": [], "services": [], "source": "openvas"}
        if port > 0 and port not in hosts[ip]["ports"]:
            hosts[ip]["ports"].append(port)

        # Severity
        severity_el = result.find("severity")
        score = None
        if severity_el is not None and severity_el.text:
            try:
                score = float(severity_el.text)
            except ValueError:
                pass

        severity = _openvas_severity(score or 0)
        if severity == "Info":
            continue

        name_el = result.find("name")
        title = name_el.text if name_el is not None else "OpenVAS Finding"

        desc_el = result.find("description")
        description = desc_el.text if desc_el is not None else ""

        nvt = result.find("nvt")
        cve = None
        solution = ""
        if nvt is not None:
            refs = nvt.find("refs")
            if refs is not None:
                for ref in refs.findall("ref"):
                    if ref.get("type") == "cve":
                        cve = ref.get("id")
                        break
            sol_el = nvt.find("solution")
            if sol_el is not None:
                solution = sol_el.text or ""

        findings.append({
            "title": title,
            "severity": severity,
            "cvss_score": score,
            "cve": cve,
            "affected_component": f"{ip}:{port}/{protocol}" if port else ip,
            "description": description,
            "remediation": solution,
            "source": "openvas",
            "tags": ["openvas"],
        })

    return {"hosts": list(hosts.values()), "findings": findings}


# ─── Qualys ───────────────────────────────────────────────────────────────────

def parse_qualys(xml_content: str) -> dict:
    root = ET.fromstring(xml_content)
    hosts = {}
    findings = []

    for host_el in root.findall(".//HOST"):
        ip = host_el.findtext("IP") or host_el.findtext("ADDRESS") or ""
        if not ip:
            continue
        hostname = host_el.findtext("DNS") or host_el.findtext("HOSTNAME")
        os_name = host_el.findtext("OS")

        if ip not in hosts:
            hosts[ip] = {"ip_address": ip, "hostname": hostname, "os": os_name, "ports": [], "services": [], "source": "qualys"}

    for vuln in root.findall(".//VULN") + root.findall(".//DETECTION"):
        ip = vuln.findtext("IP") or vuln.findtext("ADDRESS") or ""
        title = vuln.findtext("TITLE") or vuln.findtext("QID") or "Qualys Finding"
        severity_num = int(vuln.findtext("SEVERITY") or "0")

        sev_map = {1: "Info", 2: "Low", 3: "Medium", 4: "High", 5: "Critical"}
        severity = sev_map.get(severity_num, "Info")
        if severity == "Info":
            continue

        cvss_text = vuln.findtext("CVSS_BASE") or vuln.findtext("CVSS3_BASE")
        cvss_score = None
        if cvss_text:
            try:
                cvss_score = float(cvss_text)
            except ValueError:
                pass

        cve = vuln.findtext("CVE_ID")
        description = vuln.findtext("DIAGNOSIS") or vuln.findtext("CONSEQUENCE") or ""
        solution = vuln.findtext("SOLUTION") or ""
        port = vuln.findtext("PORT")
        affected = f"{ip}:{port}" if port else ip

        findings.append({
            "title": title,
            "severity": severity,
            "cvss_score": cvss_score,
            "cve": cve,
            "affected_component": affected,
            "description": description,
            "remediation": solution,
            "source": "qualys",
            "tags": ["qualys"],
        })

    return {"hosts": list(hosts.values()), "findings": findings}


# ─── Rapid7 InsightVM ────────────────────────────────────────────────────────

def parse_rapid7(xml_content: str) -> dict:
    root = ET.fromstring(xml_content)
    hosts = []
    findings = []

    for node in root.findall(".//node"):
        ip = node.get("address", "")
        if not ip:
            continue
        hostname = None
        names_el = node.find("names")
        if names_el is not None:
            name_el = names_el.find("name")
            if name_el is not None:
                hostname = name_el.text

        os_name = None
        fingerprints = node.find("fingerprints")
        if fingerprints is not None:
            os_el = fingerprints.find("os")
            if os_el is not None:
                os_name = os_el.get("product")

        ports = []
        for endpoint in node.findall(".//endpoint"):
            port_num = int(endpoint.get("port", 0))
            if port_num > 0:
                ports.append(port_num)

        hosts.append({"ip_address": ip, "hostname": hostname, "os": os_name, "ports": ports, "services": [], "source": "rapid7"})

        for test in node.findall(".//test"):
            status = test.get("status", "")
            if status != "vulnerable":
                continue
            vuln_id = test.get("id", "")
            for vulnerability in root.findall(f".//vulnerability[@id='{vuln_id}']"):
                title = vulnerability.get("title", vuln_id)
                cvss_text = vulnerability.get("cvssScore") or vulnerability.get("cvss-score")
                cvss_score = float(cvss_text) if cvss_text else None
                severity = _severity_from_cvss(cvss_score)
                if severity == "Info":
                    continue
                desc_el = vulnerability.find(".//description/ContainerBlockElement")
                description = desc_el.text if desc_el is not None else ""
                sol_el = vulnerability.find(".//solution/ContainerBlockElement")
                solution = sol_el.text if sol_el is not None else ""
                cves = [ref.get("source") for ref in vulnerability.findall(".//reference") if ref.get("source", "").startswith("CVE")]
                findings.append({
                    "title": title,
                    "severity": severity,
                    "cvss_score": cvss_score,
                    "cve": cves[0] if cves else None,
                    "affected_component": ip,
                    "description": description,
                    "remediation": solution,
                    "source": "rapid7",
                    "tags": ["rapid7"],
                })

    return {"hosts": hosts, "findings": findings}


# ─── PingCastle ──────────────────────────────────────────────────────────────

def parse_pingcastle(xml_content: str) -> dict:
    root = ET.fromstring(xml_content)
    findings = []
    hosts = []

    # Domain controller info
    domain_name = root.findtext(".//DomainName") or root.findtext(".//NetBIOSName") or "AD Domain"
    dc_ip = root.findtext(".//DCName") or ""
    if dc_ip:
        hosts.append({"ip_address": dc_ip, "hostname": domain_name, "os": "Windows Server (Domain Controller)", "ports": [389, 445, 636, 3268], "services": [], "source": "pingcastle"})

    # Risk rules / findings
    for rule in root.findall(".//RiskRule") + root.findall(".//HealthcheckRiskRule"):
        points = int(rule.findtext("Points") or rule.get("Points") or "0")
        title = rule.findtext("Title") or rule.findtext("RiskId") or "PingCastle Finding"
        description = rule.findtext("Description") or rule.findtext("Rationale") or ""
        solution = rule.findtext("Solution") or rule.findtext("Remediation") or ""
        category = rule.findtext("Category") or "Active Directory"

        if points >= 30:
            severity = "Critical"
        elif points >= 20:
            severity = "High"
        elif points >= 10:
            severity = "Medium"
        elif points > 0:
            severity = "Low"
        else:
            continue

        findings.append({
            "title": f"[AD] {title}",
            "severity": severity,
            "cvss_score": None,
            "affected_component": domain_name,
            "description": description,
            "remediation": solution,
            "source": "pingcastle",
            "tags": ["pingcastle", "active-directory", category],
        })

    return {"hosts": hosts, "findings": findings}


# ─── Burp Suite ──────────────────────────────────────────────────────────────

def parse_burp(xml_content: str) -> dict:
    root = ET.fromstring(xml_content)
    findings = []
    hosts = {}

    for issue in root.findall(".//issue"):
        host_el = issue.find("host")
        ip = host_el.get("ip", "") if host_el is not None else ""
        host_url = host_el.text if host_el is not None else ""

        name = issue.findtext("name") or "Burp Finding"
        severity_str = (issue.findtext("severity") or "Information").strip()
        confidence = issue.findtext("confidence") or "Certain"

        sev_map = {"High": "High", "Medium": "Medium", "Low": "Low", "Information": "Info", "Critical": "Critical"}
        severity = sev_map.get(severity_str, "Info")
        if severity == "Info":
            continue

        issueBackground = issue.findtext("issueBackground") or ""
        issueDetail = issue.findtext("issueDetail") or ""
        remediationBackground = issue.findtext("remediationBackground") or ""
        remediationDetail = issue.findtext("remediationDetail") or ""

        description = f"{issueDetail}\n\n{issueBackground}".strip()
        remediation = f"{remediationDetail}\n\n{remediationBackground}".strip()

        location = issue.findtext("location") or host_url or ""

        # Track host
        if ip and ip not in hosts:
            hosts[ip] = {"ip_address": ip, "hostname": host_url, "os": None, "ports": [443, 80], "services": [], "source": "burp"}

        findings.append({
            "title": name,
            "severity": severity,
            "cvss_score": None,
            "affected_component": location,
            "description": description,
            "remediation": remediation,
            "source": "burp",
            "tags": ["burp", f"confidence:{confidence}"],
        })

    return {"hosts": list(hosts.values()), "findings": findings}


# ─── Router ───────────────────────────────────────────────────────────────────

PARSERS = {
    "nessus": parse_nessus,
    "openvas": parse_openvas,
    "greenbone": parse_openvas,
    "qualys": parse_qualys,
    "rapid7": parse_rapid7,
    "pingcastle": parse_pingcastle,
    "burp": parse_burp,
    "nmap": None,  # handled separately
}


def parse_scan(scanner: str, xml_content: str) -> dict:
    parser = PARSERS.get(scanner.lower())
    if not parser:
        raise ValueError(f"Unknown scanner: {scanner}")
    return parser(xml_content)
