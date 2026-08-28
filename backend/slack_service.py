"""
RedTrack Slack Integration Service
Handles outbound webhook notifications and inbound slash commands.
"""

import httpx
import json
from typing import Optional
from datetime import datetime, timezone


SEV_EMOJI = {
    "Critical": "🚨",
    "High": "🔴",
    "Medium": "🟡",
    "Low": "🔵",
    "Info": "⚪",
}

STATUS_EMOJI = {
    "Planning": "📋",
    "Active": "⚡",
    "Completed": "✅",
    "Archived": "📦",
}


async def send_slack_message(webhook_url: str, payload: dict) -> bool:
    """Send a message to Slack via webhook."""
    try:
        async with httpx.AsyncClient() as client:
            response = await client.post(
                webhook_url,
                json=payload,
                timeout=10,
            )
            return response.status_code == 200
    except Exception as e:
        print(f"[Slack] Failed to send message: {e}")
        return False


async def notify_new_engagement(webhook_url: str, base_url: str, engagement) -> bool:
    """Notify Slack when a new engagement is created."""
    if not webhook_url:
        return False

    eng_type = engagement.type.value if hasattr(engagement.type, 'value') else str(engagement.type)
    eng_status = engagement.status.value if hasattr(engagement.status, 'value') else str(engagement.status)
    url = f"{base_url}/engagements/{engagement.id}"

    payload = {
        "blocks": [
            {
                "type": "header",
                "text": {"type": "plain_text", "text": "📋 New Engagement Created", "emoji": True}
            },
            {
                "type": "section",
                "fields": [
                    {"type": "mrkdwn", "text": f"*Client:*\n{engagement.client}"},
                    {"type": "mrkdwn", "text": f"*Type:*\n{eng_type}"},
                    {"type": "mrkdwn", "text": f"*Reference:*\n{engagement.ref_id}"},
                    {"type": "mrkdwn", "text": f"*Status:*\n{STATUS_EMOJI.get(eng_status, '📋')} {eng_status}"},
                ]
            },
            {
                "type": "section",
                "text": {"type": "mrkdwn", "text": f"*{engagement.name}*"}
            },
            {
                "type": "actions",
                "elements": [
                    {
                        "type": "button",
                        "text": {"type": "plain_text", "text": "View Engagement →"},
                        "url": url,
                        "style": "primary"
                    }
                ]
            },
            {"type": "divider"}
        ]
    }
    return await send_slack_message(webhook_url, payload)


async def notify_new_finding(webhook_url: str, base_url: str, finding, engagement) -> bool:
    """Notify Slack when a new finding is added."""
    if not webhook_url:
        return False

    sev = finding.severity.value if hasattr(finding.severity, 'value') else str(finding.severity)
    # Only notify for High and Critical by default
    if sev not in ("Critical", "High"):
        return False

    emoji = SEV_EMOJI.get(sev, "🔴")
    url = f"{base_url}/findings/{finding.id}"
    eng_url = f"{base_url}/engagements/{finding.engagement_id}"

    payload = {
        "blocks": [
            {
                "type": "header",
                "text": {"type": "plain_text", "text": f"{emoji} {sev} Finding Discovered", "emoji": True}
            },
            {
                "type": "section",
                "text": {"type": "mrkdwn", "text": f"*{finding.title}*"}
            },
            {
                "type": "section",
                "fields": [
                    {"type": "mrkdwn", "text": f"*Client:*\n{engagement.client}"},
                    {"type": "mrkdwn", "text": f"*Engagement:*\n{engagement.ref_id}"},
                    {"type": "mrkdwn", "text": f"*CVSS:*\n{finding.cvss_score or 'Not scored'}"},
                    {"type": "mrkdwn", "text": f"*CWE:*\n{finding.cwe or 'N/A'}"},
                ]
            },
            {
                "type": "section",
                "fields": [
                    {"type": "mrkdwn", "text": f"*Affected:*\n{finding.affected_component or 'Not specified'}"},
                    {"type": "mrkdwn", "text": f"*Reference:*\n{finding.ref_id}"},
                ]
            },
            {
                "type": "actions",
                "elements": [
                    {
                        "type": "button",
                        "text": {"type": "plain_text", "text": "View Finding →"},
                        "url": url,
                        "style": "danger"
                    },
                    {
                        "type": "button",
                        "text": {"type": "plain_text", "text": "View Engagement →"},
                        "url": eng_url,
                    }
                ]
            },
            {"type": "divider"}
        ]
    }
    return await send_slack_message(webhook_url, payload)


async def notify_finding_remediated(webhook_url: str, base_url: str, finding, engagement) -> bool:
    """Notify Slack when a finding is remediated."""
    if not webhook_url:
        return False

    sev = finding.severity.value if hasattr(finding.severity, 'value') else str(finding.severity)
    url = f"{base_url}/findings/{finding.id}"

    payload = {
        "blocks": [
            {
                "type": "section",
                "text": {
                    "type": "mrkdwn",
                    "text": f"✅ *Finding Remediated*\n{finding.ref_id} — {finding.title}\n*Client:* {engagement.client} | *Severity:* {sev}"
                },
                "accessory": {
                    "type": "button",
                    "text": {"type": "plain_text", "text": "View →"},
                    "url": url
                }
            }
        ]
    }
    return await send_slack_message(webhook_url, payload)


async def notify_engagement_status_change(webhook_url: str, base_url: str, engagement, old_status: str) -> bool:
    """Notify Slack when engagement status changes."""
    if not webhook_url:
        return False

    new_status = engagement.status.value if hasattr(engagement.status, 'value') else str(engagement.status)
    url = f"{base_url}/engagements/{engagement.id}"
    emoji = STATUS_EMOJI.get(new_status, "📋")

    payload = {
        "blocks": [
            {
                "type": "section",
                "text": {
                    "type": "mrkdwn",
                    "text": f"{emoji} *Engagement Status Changed*\n*{engagement.name}* ({engagement.client})\n{old_status} → *{new_status}*"
                },
                "accessory": {
                    "type": "button",
                    "text": {"type": "plain_text", "text": "View →"},
                    "url": url
                }
            }
        ]
    }
    return await send_slack_message(webhook_url, payload)


async def send_daily_digest(webhook_url: str, base_url: str, engagements: list, findings: list) -> bool:
    """Send a daily digest of active engagements and open findings."""
    if not webhook_url:
        return False

    active = [e for e in engagements if (e.status.value if hasattr(e.status, 'value') else e.status) == 'Active']
    open_findings = [f for f in findings if (f.status.value if hasattr(f.status, 'value') else f.status) == 'Open']
    critical = [f for f in open_findings if (f.severity.value if hasattr(f.severity, 'value') else f.severity) == 'Critical']
    high = [f for f in open_findings if (f.severity.value if hasattr(f.severity, 'value') else f.severity) == 'High']

    eng_lines = ""
    for e in active[:5]:
        eng_url = f"{base_url}/engagements/{e.id}"
        eng_lines += f"• <{eng_url}|{e.ref_id}> — {e.client} ({e.name})\n"

    payload = {
        "blocks": [
            {
                "type": "header",
                "text": {"type": "plain_text", "text": f"📊 RedTrack Daily Digest — {datetime.now().strftime('%B %d, %Y')}", "emoji": True}
            },
            {
                "type": "section",
                "fields": [
                    {"type": "mrkdwn", "text": f"*Active Engagements:*\n{len(active)}"},
                    {"type": "mrkdwn", "text": f"*Open Findings:*\n{len(open_findings)}"},
                    {"type": "mrkdwn", "text": f"*🚨 Critical:*\n{len(critical)}"},
                    {"type": "mrkdwn", "text": f"*🔴 High:*\n{len(high)}"},
                ]
            },
        ]
    }

    if eng_lines:
        payload["blocks"].append({
            "type": "section",
            "text": {"type": "mrkdwn", "text": f"*Active Engagements:*\n{eng_lines}"}
        })

    payload["blocks"].append({
        "type": "actions",
        "elements": [
            {
                "type": "button",
                "text": {"type": "plain_text", "text": "Open RedTrack →"},
                "url": base_url,
                "style": "primary"
            }
        ]
    })

    return await send_slack_message(webhook_url, payload)


# ─── Slash Command Handler ────────────────────────────────────────────────────

async def handle_slash_command(command: str, text: str, engagements: list, findings: list, base_url: str) -> dict:
    """Handle incoming Slack slash commands."""
    text = (text or "").strip().lower()

    if command == "/redtrack" or text == "help":
        return {
            "response_type": "ephemeral",
            "text": "RedTrack Commands",
            "blocks": [
                {"type": "header", "text": {"type": "plain_text", "text": "🔴 RedTrack Commands"}},
                {"type": "section", "text": {"type": "mrkdwn", "text": (
                    "*`/redtrack status`* — List all active engagements\n"
                    "*`/redtrack critical`* — Show all open critical findings\n"
                    "*`/redtrack findings ENG-001`* — Findings for a specific engagement\n"
                    "*`/redtrack finding F-003`* — Details on a specific finding\n"
                    "*`/redtrack help`* — Show this help"
                )}}
            ]
        }

    elif text == "status":
        active = [e for e in engagements if (e.status.value if hasattr(e.status, 'value') else e.status) == 'Active']
        if not active:
            return {"response_type": "in_channel", "text": "No active engagements right now."}

        lines = []
        for e in active:
            url = f"{base_url}/engagements/{e.id}"
            open_count = sum(1 for f in findings
                           if str(f.engagement_id) == str(e.id)
                           and (f.status.value if hasattr(f.status, 'value') else f.status) == 'Open')
            crit_count = sum(1 for f in findings
                            if str(f.engagement_id) == str(e.id)
                            and (f.severity.value if hasattr(f.severity, 'value') else f.severity) == 'Critical'
                            and (f.status.value if hasattr(f.status, 'value') else f.status) == 'Open')
            crit_str = f" | 🚨 {crit_count} critical" if crit_count > 0 else ""
            lines.append(f"• <{url}|{e.ref_id}> *{e.client}* — {e.name} | {open_count} open findings{crit_str}")

        return {
            "response_type": "in_channel",
            "blocks": [
                {"type": "header", "text": {"type": "plain_text", "text": f"⚡ Active Engagements ({len(active)})"}},
                {"type": "section", "text": {"type": "mrkdwn", "text": "\n".join(lines)}}
            ]
        }

    elif text == "critical":
        critical = [f for f in findings
                   if (f.severity.value if hasattr(f.severity, 'value') else f.severity) == 'Critical'
                   and (f.status.value if hasattr(f.status, 'value') else f.status) == 'Open']
        if not critical:
            return {"response_type": "in_channel", "text": "🎉 No open critical findings!"}

        lines = []
        for f in critical[:10]:
            url = f"{base_url}/findings/{f.id}"
            lines.append(f"• <{url}|{f.ref_id}> {f.title}")

        return {
            "response_type": "in_channel",
            "blocks": [
                {"type": "header", "text": {"type": "plain_text", "text": f"🚨 Open Critical Findings ({len(critical)})"}},
                {"type": "section", "text": {"type": "mrkdwn", "text": "\n".join(lines)}}
            ]
        }

    elif text.startswith("findings "):
        ref = text.split(" ", 1)[1].upper()
        eng = next((e for e in engagements if e.ref_id == ref), None)
        if not eng:
            return {"response_type": "ephemeral", "text": f"Engagement {ref} not found."}

        eng_findings = [f for f in findings
                       if str(f.engagement_id) == str(eng.id)
                       and (f.status.value if hasattr(f.status, 'value') else f.status) == 'Open']

        if not eng_findings:
            return {"response_type": "in_channel", "text": f"No open findings for {ref}."}

        lines = []
        for f in sorted(eng_findings, key=lambda x: {"Critical": 0, "High": 1, "Medium": 2, "Low": 3}.get(
                x.severity.value if hasattr(x.severity, 'value') else x.severity, 4)):
            sev = f.severity.value if hasattr(f.severity, 'value') else f.severity
            url = f"{base_url}/findings/{f.id}"
            lines.append(f"• {SEV_EMOJI.get(sev, '⚪')} <{url}|{f.ref_id}> {f.title}")

        return {
            "response_type": "in_channel",
            "blocks": [
                {"type": "header", "text": {"type": "plain_text", "text": f"Open Findings — {eng.client} ({ref})"}},
                {"type": "section", "text": {"type": "mrkdwn", "text": "\n".join(lines)}}
            ]
        }

    elif text.startswith("finding "):
        ref = text.split(" ", 1)[1].upper()
        finding = next((f for f in findings if f.ref_id == ref), None)
        if not finding:
            return {"response_type": "ephemeral", "text": f"Finding {ref} not found."}

        sev = finding.severity.value if hasattr(finding.severity, 'value') else str(finding.severity)
        status = finding.status.value if hasattr(finding.status, 'value') else str(finding.status)
        url = f"{base_url}/findings/{finding.id}"

        return {
            "response_type": "in_channel",
            "blocks": [
                {"type": "header", "text": {"type": "plain_text", "text": f"{SEV_EMOJI.get(sev, '⚪')} {finding.ref_id} — {finding.title}"}},
                {"type": "section", "fields": [
                    {"type": "mrkdwn", "text": f"*Severity:*\n{sev}"},
                    {"type": "mrkdwn", "text": f"*Status:*\n{status}"},
                    {"type": "mrkdwn", "text": f"*CVSS:*\n{finding.cvss_score or 'N/A'}"},
                    {"type": "mrkdwn", "text": f"*CWE:*\n{finding.cwe or 'N/A'}"},
                ]},
                {"type": "actions", "elements": [
                    {"type": "button", "text": {"type": "plain_text", "text": "View Finding →"}, "url": url, "style": "primary"}
                ]}
            ]
        }

    else:
        return {
            "response_type": "ephemeral",
            "text": f"Unknown command. Try `/redtrack help`"
        }
