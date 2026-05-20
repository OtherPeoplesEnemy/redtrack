"""
AI Service v2 — Gemini / Anthropic switcher.

Set AI_PROVIDER=gemini or AI_PROVIDER=anthropic in .env.
All functions are provider-agnostic — swap the key and provider, same results.
"""

from config import get_settings
from typing import Optional

settings = get_settings()

SYSTEM_PENTEST = """You are an expert penetration tester and security consultant with 15+ years of experience.
You specialize in: web app security, network pentesting, red teaming, cloud security, AI red teaming, and writing clear actionable security reports.
Your responses are always technically precise, actionable, and professional.
Use markdown formatting where appropriate."""

AI_REDTEAM_CONTEXT = """You also have deep expertise in AI red teaming using a unified framework that combines:
- NVIDIA AI Kill Chain (attack progression narrative)
- MITRE ATLAS (technical TTPs: AML.TA0000 through AML.TA0005)
- OWASP Top 10 for LLMs (LLM01 through LLM10)

The 7 phases are: Preparation → Reconnaissance → Weaponization → Delivery → Persistence → Impact → Reporting
When discussing AI red teaming always map findings to the relevant phase, ATLAS TTP, and OWASP risk."""


def _get_ai_response(prompt: str, system: str = SYSTEM_PENTEST, max_tokens: int = 1500) -> str:
    """Route to the configured AI provider."""
    provider = settings.ai_provider

    if provider == "anthropic":
        return _anthropic(prompt, system, max_tokens)
    elif provider == "gemini":
        return _gemini(prompt, system, max_tokens)
    else:
        raise ValueError(f"Unknown AI provider: {provider}. Set AI_PROVIDER=anthropic or AI_PROVIDER=gemini in .env")


def _anthropic(prompt: str, system: str, max_tokens: int) -> str:
    if not settings.anthropic_api_key:
        raise ValueError("ANTHROPIC_API_KEY not set in .env")
    import anthropic
    client = anthropic.Anthropic(api_key=settings.anthropic_api_key)
    message = client.messages.create(
        model="claude-sonnet-4-20250514",
        max_tokens=max_tokens,
        system=system,
        messages=[{"role": "user", "content": prompt}],
    )
    return message.content[0].text


def _gemini(prompt: str, system: str, max_tokens: int) -> str:
    if not settings.gemini_api_key:
        raise ValueError("GEMINI_API_KEY not set in .env")
    import google.generativeai as genai
    genai.configure(api_key=settings.gemini_api_key)
    model = genai.GenerativeModel(
        model_name="gemini-2.5-flash",
        system_instruction=system,
    )
    response = model.generate_content(
        prompt,
        generation_config={"max_output_tokens": max_tokens},
    )
    return response.text


def _chat_anthropic(messages: list[dict], system: str) -> str:
    if not settings.anthropic_api_key:
        raise ValueError("ANTHROPIC_API_KEY not set in .env")
    import anthropic
    client = anthropic.Anthropic(api_key=settings.anthropic_api_key)
    message = client.messages.create(
        model="claude-sonnet-4-20250514",
        max_tokens=1000,
        system=system,
        messages=messages,
    )
    return message.content[0].text


def _chat_gemini(messages: list[dict], system: str) -> str:
    if not settings.gemini_api_key:
        raise ValueError("GEMINI_API_KEY not set in .env")
    import google.generativeai as genai
    genai.configure(api_key=settings.gemini_api_key)
    model = genai.GenerativeModel(
        model_name="gemini-2.5-flash",
        system_instruction=system,
    )
    # Convert messages to Gemini format
    history = []
    for m in messages[:-1]:
        history.append({
            "role": "user" if m["role"] == "user" else "model",
            "parts": [m["content"]],
        })
    chat = model.start_chat(history=history)
    response = chat.send_message(messages[-1]["content"])
    return response.text


# ─── Public API ───────────────────────────────────────────────────────────────

async def analyze_finding(finding) -> str:
    prompt = f"""Analyze this security finding and provide a structured technical analysis.

**Finding:** {finding.title}
**Severity:** {finding.severity.value}
**CVSS Score:** {finding.cvss_score or 'Not scored'}
**CWE:** {finding.cwe or 'Not specified'}
**Affected Component:** {finding.affected_component or 'Not specified'}
**Description:** {finding.description or 'Not provided'}

Provide:
1. **Technical Analysis** — root cause, attack vectors, exploitation complexity
2. **Business Impact** — what an attacker could realistically achieve
3. **CVSS Justification** — validate or suggest a score with reasoning
4. **Similar CVEs** — reference any well-known CVEs with the same pattern
5. **Detection** — how to detect if this has been exploited"""
    return _get_ai_response(prompt)


async def suggest_remediation(title: str, description: str, severity: str, cwe: Optional[str] = None, affected_component: Optional[str] = None) -> str:
    prompt = f"""Provide detailed remediation guidance for this vulnerability:

**Title:** {title}
**Severity:** {severity}
**CWE:** {cwe or 'Unknown'}
**Affected Component:** {affected_component or 'Not specified'}
**Description:** {description}

Provide:
1. **Immediate Mitigation** — quick wins to reduce risk NOW
2. **Long-term Fix** — proper remediation with code examples where applicable
3. **Verification Steps** — how to confirm the fix worked
4. **Prevention** — process/tooling changes to prevent recurrence
5. **Effort Estimate** — Low/Medium/High"""
    return _get_ai_response(prompt, max_tokens=1200)


async def generate_executive_summary(engagement, findings: list) -> str:
    severity_counts = {"Critical": 0, "High": 0, "Medium": 0, "Low": 0, "Info": 0}
    for f in findings:
        severity_counts[f.severity.value] += 1
    open_count = sum(1 for f in findings if f.status.value == "Open")
    critical_titles = "\n".join(f"- {f.title}" for f in findings if f.severity.value == "Critical")[:5] or "None"

    prompt = f"""Write a professional executive summary for a penetration test report.

**Client:** {engagement.client}
**Type:** {engagement.type.value}
**Scope:** {engagement.scope or 'Not specified'}
**Total Findings:** {len(findings)}
**Critical:** {severity_counts['Critical']} | High: {severity_counts['High']} | Medium: {severity_counts['Medium']} | Low: {severity_counts['Low']}
**Open:** {open_count}
**Critical Findings:** {critical_titles}

Write a 3-4 paragraph executive summary for a C-suite audience.
- Para 1: Engagement overview
- Para 2: Overall security posture
- Para 3: Key risks and business impact
- Para 4: Recommended priorities
Do NOT use markdown headers — write as flowing professional prose."""
    return _get_ai_response(prompt, max_tokens=800)


async def generate_steps_to_reproduce(title: str, description: str, affected_component: Optional[str] = None) -> str:
    prompt = f"""Draft clear numbered steps to reproduce this vulnerability for a pentest report.

**Finding:** {title}
**Description:** {description}
**Affected Component:** {affected_component or 'Not specified'}

Write 5-8 clear numbered steps. Include tool names, payloads, and request examples where applicable."""
    return _get_ai_response(prompt, max_tokens=600)


async def suggest_cvss(title: str, description: str) -> dict:
    import json
    prompt = f"""Suggest a CVSS 3.1 score for this vulnerability.

**Title:** {title}
**Description:** {description}

Respond ONLY with a JSON object, no markdown:
{{"score": <float>, "severity": "<Critical|High|Medium|Low|Info>", "vector": "<CVSS:3.1/...>", "reasoning": "<1-2 sentences>"}}"""
    try:
        result = _get_ai_response(prompt, max_tokens=300)
        clean = result.replace("```json", "").replace("```", "").strip()
        return json.loads(clean)
    except Exception:
        return {"score": None, "severity": "Medium", "vector": None, "reasoning": "Could not parse AI response"}


async def analyze_ai_redteam_phase(phase: str, context: str) -> str:
    """AI Red Team specific analysis using the unified framework."""
    system = SYSTEM_PENTEST + "\n\n" + AI_REDTEAM_CONTEXT
    prompt = f"""Provide guidance for this AI Red Team phase:

**Phase:** {phase}
**Context:** {context}

Map your response to:
1. Relevant NVIDIA Kill Chain stage
2. Applicable MITRE ATLAS TTPs (AML.TA00XX)
3. Related OWASP LLM risks (LLM0X)
4. Specific techniques to try
5. What success looks like and how to document it"""
    return _get_ai_response(prompt, system=system, max_tokens=1200)


async def chat(messages: list[dict], engagement=None, finding=None, is_ai_redteam: bool = False) -> str:
    system = SYSTEM_PENTEST
    if is_ai_redteam:
        system += "\n\n" + AI_REDTEAM_CONTEXT
    if engagement:
        system += f"\n\nEngagement: {engagement.client} — {engagement.type.value}\nScope: {engagement.scope or 'Not specified'}"
    if finding:
        system += f"\n\nFinding: {finding.title} ({finding.severity.value})\nCWE: {finding.cwe or 'N/A'}"

    if settings.ai_provider == "anthropic":
        return _chat_anthropic(messages, system)
    else:
        return _chat_gemini(messages, system)
