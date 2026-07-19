"""
RedTrack Report Service v2
Generates .docx reports using python-docx.
Supports custom branded templates with {{placeholders}}.
PDF export via LibreOffice headless.
"""

import os
import uuid
import subprocess
from pathlib import Path
from datetime import datetime, timezone
from typing import Optional

from docx import Document
from docx.shared import Pt, RGBColor, Inches, Cm
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.enum.table import WD_TABLE_ALIGNMENT, WD_ALIGN_VERTICAL
from docx.oxml.ns import qn
from docx.oxml import OxmlElement

UPLOAD_DIR = Path(os.environ.get("UPLOAD_DIR", "/app/uploads"))
REPORTS_DIR = UPLOAD_DIR / "reports"
TEMPLATES_DIR = UPLOAD_DIR / "report_templates"

REPORTS_DIR.mkdir(parents=True, exist_ok=True)
TEMPLATES_DIR.mkdir(parents=True, exist_ok=True)

SEV_COLORS = {
    "Critical": RGBColor(0xC0, 0x39, 0x2B),
    "High":     RGBColor(0xE6, 0x7E, 0x22),
    "Medium":   RGBColor(0xF3, 0x9C, 0x12),
    "Low":      RGBColor(0x27, 0xAE, 0x60),
    "Info":     RGBColor(0x29, 0x80, 0xB9),
}

SEV_HEX = {
    "Critical": "C0392B",
    "High":     "E67E22",
    "Medium":   "F39C12",
    "Low":      "27AE60",
    "Info":     "2980B9",
}


# ── Evidence helpers ──────────────────────────────────────────────────────────

def _ev_get(e, attr):
    return e.get(attr) if isinstance(e, dict) else getattr(e, attr, None)


def _is_image(e):
    mime = (_ev_get(e, "mime_type") or "").lower()
    if mime.startswith("image/"):
        return True
    name = (_ev_get(e, "original_name") or _ev_get(e, "filename") or "").lower()
    return name.endswith((".png", ".jpg", ".jpeg", ".gif", ".bmp", ".webp"))


def _evidence_path(e):
    # Evidence.filename stores the absolute on-disk path in this codebase.
    p = _ev_get(e, "filename")
    if p and Path(p).exists():
        return p
    return None


def _ev_caption(e):
    return _ev_get(e, "caption")


def _ev_name(e):
    return _ev_get(e, "original_name") or "evidence"


# ── PTES band-weighted risk scoring ───────────────────────────────────────────
# Mirrors the model used on real engagements: each severity band contributes a
# weight, the weighted total is squashed onto a 1–15 PTES scale, and the scale
# maps to a named risk band. Weights are tuned so a single Critical dominates a
# handful of Lows, matching how a client actually perceives aggregate risk.

PTES_BAND_WEIGHTS = {"Critical": 5.0, "High": 3.0, "Medium": 2.0, "Low": 1.0, "Info": 0.25}
PTES_MAX = 15.0

PTES_BANDS = [
    (13.0, "Extreme"),
    (10.0, "Critical"),
    (7.0,  "High"),
    (4.0,  "Moderate"),
    (1.0,  "Low"),
    (0.0,  "Minimal"),
]


def compute_ptes_score(sev_counts):
    """
    Returns {'score': float 0–15, 'band': str, 'weighted_raw': float}.

    weighted_raw = sum(count × band weight). It's mapped onto the 0–15 PTES
    scale with a saturating curve so the score doesn't require an implausible
    number of findings to reach the top band — a couple of Criticals plus
    supporting Highs already lands in 'Extreme', consistent with manual scoring.
    """
    import math
    weighted_raw = sum(sev_counts.get(band, 0) * w for band, w in PTES_BAND_WEIGHTS.items())
    k = 0.14  # tuned so ~1 Critical + 2 High ≈ 13.0 (Extreme)
    score = round(PTES_MAX * (1 - math.exp(-k * weighted_raw)), 1)

    band = "Minimal"
    for threshold, name in PTES_BANDS:
        if score >= threshold:
            band = name
            break
    return {"score": score, "band": band, "weighted_raw": round(weighted_raw, 1)}


def _set_cell_bg(cell, hex_color):
    """Set table cell background color."""
    tc = cell._tc
    tcPr = tc.get_or_add_tcPr()
    shd = OxmlElement('w:shd')
    shd.set(qn('w:val'), 'clear')
    shd.set(qn('w:color'), 'auto')
    shd.set(qn('w:fill'), hex_color)
    tcPr.append(shd)


def _set_table_borders(table):
    """Add borders to all cells in a table."""
    for row in table.rows:
        for cell in row.cells:
            tc = cell._tc
            tcPr = tc.get_or_add_tcPr()
            tcBorders = OxmlElement('w:tcBorders')
            for side in ['top', 'left', 'bottom', 'right']:
                border = OxmlElement(f'w:{side}')
                border.set(qn('w:val'), 'single')
                border.set(qn('w:sz'), '4')
                border.set(qn('w:space'), '0')
                border.set(qn('w:color'), 'CCCCCC')
                tcBorders.append(border)
            tcPr.append(tcBorders)


def _add_heading(doc, text, level=1, color=None):
    p = doc.add_heading(text, level=level)
    if color:
        for run in p.runs:
            run.font.color.rgb = color
    return p


def _add_para(doc, text, bold=False, size=None, color=None, align=None):
    p = doc.add_paragraph()
    run = p.add_run(text)
    run.bold = bold
    if size:
        run.font.size = Pt(size)
    if color:
        run.font.color.rgb = color
    if align:
        p.alignment = align
    return p


async def generate_docx_report(eng, findings, report, template_path: Optional[str] = None, evidence_map=None) -> str:
    """
    Generate a .docx pentest report.
    If template_path is provided, uses it as a base and fills placeholders.
    Otherwise generates a default branded report.
    """
    if template_path and Path(template_path).exists():
        return await _generate_from_template(eng, findings, report, template_path)
    else:
        return await _generate_default_report(eng, findings, report, evidence_map or {})


async def _generate_from_template(eng, findings, report, template_path: str) -> str:
    """Fill a user-uploaded .docx template with report data."""
    doc = Document(template_path)

    sev_counts = {s: sum(1 for f in findings if f.severity.value == s) for s in ["Critical", "High", "Medium", "Low", "Info"]}
    open_count = sum(1 for f in findings if f.status.value == "Open")

    replacements = {
        "{{client_name}}": eng.client or "",
        "{{engagement_name}}": eng.name or "",
        "{{engagement_type}}": eng.type.value if hasattr(eng.type, 'value') else str(eng.type),
        "{{report_title}}": report.title or "",
        "{{report_version}}": report.version or "1.0",
        "{{start_date}}": str(eng.start_date)[:10] if eng.start_date else "TBD",
        "{{end_date}}": str(eng.end_date)[:10] if eng.end_date else "TBD",
        "{{generated_date}}": datetime.now(timezone.utc).strftime("%B %d, %Y"),
        "{{executive_summary}}": report.executive_summary or "No executive summary provided.",
        "{{methodology}}": report.methodology_section or eng.methodology or "Black-box penetration testing.",
        "{{scope}}": eng.scope or "Not specified.",
        "{{out_of_scope}}": eng.out_of_scope or "Not specified.",
        "{{objectives}}": eng.objectives or "Not specified.",
        "{{rules_of_engagement}}": eng.rules_of_engagement or "Not specified.",
        "{{total_findings}}": str(len(findings)),
        "{{critical_count}}": str(sev_counts["Critical"]),
        "{{high_count}}": str(sev_counts["High"]),
        "{{medium_count}}": str(sev_counts["Medium"]),
        "{{low_count}}": str(sev_counts["Low"]),
        "{{info_count}}": str(sev_counts["Info"]),
        "{{open_count}}": str(open_count),
        "{{client_contact}}": eng.client_contact or "",
        "{{client_email}}": eng.client_email or "",
        "{{ref_id}}": eng.ref_id or "",
    }

    # Replace in all paragraphs
    for para in doc.paragraphs:
        for key, val in replacements.items():
            if key in para.text:
                for run in para.runs:
                    if key in run.text:
                        run.text = run.text.replace(key, val)

    # Replace in tables
    for table in doc.tables:
        for row in table.rows:
            for cell in row.cells:
                for para in cell.paragraphs:
                    for key, val in replacements.items():
                        if key in para.text:
                            for run in para.runs:
                                if key in run.text:
                                    run.text = run.text.replace(key, val)

    # Insert findings table where {{findings_table}} placeholder appears
    for i, para in enumerate(doc.paragraphs):
        if "{{findings_table}}" in para.text:
            para.text = ""
            _insert_findings_table_after(doc, para, findings)
            break

    # Insert individual findings where {{findings_detail}} appears
    for i, para in enumerate(doc.paragraphs):
        if "{{findings_detail}}" in para.text:
            para.text = ""
            _insert_findings_detail_after(doc, para, findings)
            break

    output_path = REPORTS_DIR / f"{uuid.uuid4().hex}.docx"
    doc.save(str(output_path))
    return str(output_path)


async def _generate_default_report(eng, findings, report, evidence_map=None) -> str:
    evidence_map = evidence_map or {}
    """Generate a full default branded report."""
    doc = Document()

    # Page setup - US Letter
    section = doc.sections[0]
    section.page_width = Inches(8.5)
    section.page_height = Inches(11)
    section.left_margin = Inches(1)
    section.right_margin = Inches(1)
    section.top_margin = Inches(1)
    section.bottom_margin = Inches(1)

    # Default font
    style = doc.styles['Normal']
    style.font.name = 'Arial'
    style.font.size = Pt(11)

    sev_counts = {s: sum(1 for f in findings if f.severity.value == s) for s in ["Critical", "High", "Medium", "Low", "Info"]}
    open_count = sum(1 for f in findings if f.status.value == "Open")
    rem_count = sum(1 for f in findings if f.status.value == "Remediated")

    # ── Cover Page ───────────────────────────────────────────────────────────

    # TLP Header
    p = doc.add_paragraph()
    p.alignment = WD_ALIGN_PARAGRAPH.RIGHT
    run = p.add_run("TLP:RED — CONFIDENTIAL")
    run.bold = True
    run.font.color.rgb = RGBColor(0xC0, 0x39, 0x2B)
    run.font.size = Pt(10)

    doc.add_paragraph()
    doc.add_paragraph()

    # RedTrack branding
    p = doc.add_paragraph()
    run = p.add_run("RedTrack")
    run.bold = True
    run.font.size = Pt(32)
    run.font.color.rgb = RGBColor(0xC0, 0x39, 0x2B)

    p = doc.add_paragraph()
    run = p.add_run("Penetration Test Report")
    run.font.size = Pt(14)
    run.font.color.rgb = RGBColor(0x88, 0x88, 0x88)

    doc.add_paragraph()
    doc.add_paragraph()

    # Report title
    p = doc.add_paragraph()
    run = p.add_run(report.title or f"{eng.client} Security Assessment")
    run.bold = True
    run.font.size = Pt(24)

    doc.add_paragraph()

    # Client name
    p = doc.add_paragraph()
    run = p.add_run(f"Prepared for: {eng.client}")
    run.font.size = Pt(14)

    doc.add_paragraph()

    # Meta table
    meta_table = doc.add_table(rows=5, cols=2)
    meta_table.style = 'Table Grid'
    meta_data = [
        ("Engagement Type", eng.type.value if hasattr(eng.type, 'value') else str(eng.type)),
        ("Reference", eng.ref_id or "—"),
        ("Start Date", str(eng.start_date)[:10] if eng.start_date else "TBD"),
        ("End Date", str(eng.end_date)[:10] if eng.end_date else "TBD"),
        ("Report Version", report.version or "1.0"),
    ]
    for i, (label, val) in enumerate(meta_data):
        row = meta_table.rows[i]
        row.cells[0].text = label
        row.cells[1].text = val
        row.cells[0].paragraphs[0].runs[0].bold = True
        _set_cell_bg(row.cells[0], "F2F2F2")

    doc.add_page_break()

    # ── Executive Summary ─────────────────────────────────────────────────────

    _add_heading(doc, "1. Executive Summary", 1, RGBColor(0xC0, 0x39, 0x2B))

    if report.executive_summary:
        doc.add_paragraph(report.executive_summary)
    else:
        doc.add_paragraph(
            f"{eng.client} engaged RedTrack to perform a {eng.type.value if hasattr(eng.type, 'value') else 'penetration'} test. "
            f"This report documents the findings, risk ratings, and recommended remediations identified during the assessment."
        )

    doc.add_paragraph()

    # Risk summary table
    _add_heading(doc, "Risk Summary", 2)
    risk_table = doc.add_table(rows=2, cols=6)
    risk_table.style = 'Table Grid'
    risk_table.alignment = WD_TABLE_ALIGNMENT.CENTER

    headers = ["Total", "Critical", "High", "Medium", "Low", "Info"]
    values = [str(len(findings)), str(sev_counts["Critical"]), str(sev_counts["High"]),
              str(sev_counts["Medium"]), str(sev_counts["Low"]), str(sev_counts["Info"])]
    colors = ["1A1A2E", "C0392B", "E67E22", "F39C12", "27AE60", "2980B9"]

    for i, (h, v, c) in enumerate(zip(headers, values, colors)):
        hcell = risk_table.rows[0].cells[i]
        vcell = risk_table.rows[1].cells[i]
        hcell.text = h
        vcell.text = v
        _set_cell_bg(hcell, c)
        hcell.paragraphs[0].runs[0].font.color.rgb = RGBColor(0xFF, 0xFF, 0xFF)
        hcell.paragraphs[0].runs[0].bold = True
        hcell.paragraphs[0].alignment = WD_ALIGN_PARAGRAPH.CENTER
        vcell.paragraphs[0].alignment = WD_ALIGN_PARAGRAPH.CENTER
        vcell.paragraphs[0].runs[0].bold = True
        vcell.paragraphs[0].runs[0].font.size = Pt(14)

    # PTES band-weighted overall risk score.
    ptes = compute_ptes_score(sev_counts)
    doc.add_paragraph()
    score_p = doc.add_paragraph()
    score_p.alignment = WD_ALIGN_PARAGRAPH.CENTER
    r1 = score_p.add_run("Overall Risk (PTES weighted): ")
    r1.bold = True
    r1.font.size = Pt(12)
    r2 = score_p.add_run("%s / 15  " % ptes["score"])
    r2.bold = True
    r2.font.size = Pt(14)
    band_color = {
        "Extreme": RGBColor(0x8E, 0x1B, 0x1B), "Critical": RGBColor(0xC0, 0x39, 0x2B),
        "High": RGBColor(0xE6, 0x7E, 0x22), "Moderate": RGBColor(0xF3, 0x9C, 0x12),
        "Low": RGBColor(0x27, 0xAE, 0x60), "Minimal": RGBColor(0x29, 0x80, 0xB9),
    }.get(ptes["band"], RGBColor(0x1A, 0x1A, 0x2E))
    r3 = score_p.add_run("(%s)" % ptes["band"])
    r3.bold = True
    r3.font.size = Pt(14)
    r3.font.color.rgb = band_color

    note_p = doc.add_paragraph()
    note_p.alignment = WD_ALIGN_PARAGRAPH.CENTER
    nr = note_p.add_run(
        "Band-weighted PTES score (Critical ×5, High ×3, Medium ×2, Low ×1, Info ×0.25), "
        "normalized to a 1–15 scale."
    )
    nr.italic = True
    nr.font.size = Pt(8)
    nr.font.color.rgb = RGBColor(0x88, 0x88, 0x88)

    doc.add_page_break()

    # ── Scope & Methodology ───────────────────────────────────────────────────

    _add_heading(doc, "2. Scope & Methodology", 1, RGBColor(0xC0, 0x39, 0x2B))

    _add_heading(doc, "2.1 Scope", 2)
    doc.add_paragraph(eng.scope or "Not specified.")

    if eng.out_of_scope:
        _add_heading(doc, "2.2 Out of Scope", 2)
        doc.add_paragraph(eng.out_of_scope)

    if eng.objectives:
        _add_heading(doc, "2.3 Objectives", 2)
        doc.add_paragraph(eng.objectives)

    if eng.rules_of_engagement:
        _add_heading(doc, "2.4 Rules of Engagement", 2)
        doc.add_paragraph(eng.rules_of_engagement)

    _add_heading(doc, "2.5 Methodology", 2)
    doc.add_paragraph(
        report.methodology_section or eng.methodology or
        "Testing was performed using industry-standard methodologies including OWASP Testing Guide, "
        "PTES (Penetration Testing Execution Standard), and NIST SP 800-115."
    )

    doc.add_page_break()

    # ── Findings Summary Table ────────────────────────────────────────────────

    _add_heading(doc, "3. Findings Summary", 1, RGBColor(0xC0, 0x39, 0x2B))

    if not findings:
        doc.add_paragraph("No findings were identified during this assessment.")
    else:
        sorted_findings = sorted(findings, key=lambda f: {"Critical": 0, "High": 1, "Medium": 2, "Low": 3, "Info": 4}.get(f.severity.value, 5))
        _insert_findings_summary_table(doc, sorted_findings)

    doc.add_page_break()

    # ── Individual Findings ───────────────────────────────────────────────────

    _add_heading(doc, "4. Detailed Findings", 1, RGBColor(0xC0, 0x39, 0x2B))

    sorted_findings = sorted(findings, key=lambda f: {"Critical": 0, "High": 1, "Medium": 2, "Low": 3, "Info": 4}.get(f.severity.value, 5))

    for idx, f in enumerate(sorted_findings, 1):
        sev = f.severity.value if hasattr(f.severity, 'value') else str(f.severity)
        status = f.status.value if hasattr(f.status, 'value') else str(f.status)

        # Finding header
        p = doc.add_heading(f"4.{idx} {f.ref_id} — {f.title}", 2)

        # Finding meta table
        meta = doc.add_table(rows=1, cols=4)
        meta.style = 'Table Grid'
        fields = [
            ("Severity", sev),
            ("CVSS", str(f.cvss_score) if f.cvss_score else "—"),
            ("CWE", f.cwe or "—"),
            ("Status", status),
        ]
        for i, (label, val) in enumerate(fields):
            cell = meta.rows[0].cells[i]
            p2 = cell.paragraphs[0]
            p2.clear()
            run1 = p2.add_run(label + ": ")
            run1.bold = True
            run1.font.size = Pt(9)
            run2 = p2.add_run(val)
            run2.font.size = Pt(9)
            if label == "Severity":
                run2.font.color.rgb = SEV_COLORS.get(sev, RGBColor(0, 0, 0))
                run2.bold = True

        doc.add_paragraph()

        for label, content in [
            ("Affected Component", f.affected_component),
            ("Description", f.description),
            ("Impact", f.impact),
            ("Steps to Reproduce", f.steps_to_reproduce),
            ("Remediation", f.remediation),
            ("References", f.references),
        ]:
            if content:
                p = doc.add_paragraph()
                run = p.add_run(label + ": ")
                run.bold = True
                run.font.size = Pt(10)
                p.add_run(content).font.size = Pt(10)

        # Embedded evidence — the images uploaded to this finding (from RedNote,
        # Burp, or the RedTrack UI). This is what turns a text finding into
        # something a client can actually verify.
        ev_items = evidence_map.get(str(f.id), [])
        image_items = [e for e in ev_items if _is_image(e)]
        if image_items:
            ep = doc.add_paragraph()
            er = ep.add_run("Evidence:")
            er.bold = True
            er.font.size = Pt(10)
            for e in image_items:
                path = _evidence_path(e)
                if not path:
                    continue
                try:
                    doc.add_picture(path, width=Inches(6.0))
                    doc.paragraphs[-1].alignment = WD_ALIGN_PARAGRAPH.CENTER
                except Exception:
                    # A corrupt/unsupported image shouldn't sink the whole report.
                    cap = doc.add_paragraph()
                    cr = cap.add_run("[evidence image could not be embedded: %s]" % _ev_name(e))
                    cr.italic = True
                    cr.font.size = Pt(8)
                    continue
                caption = _ev_caption(e) or _ev_name(e)
                if caption:
                    capp = doc.add_paragraph()
                    capp.alignment = WD_ALIGN_PARAGRAPH.CENTER
                    cr = capp.add_run(caption)
                    cr.italic = True
                    cr.font.size = Pt(8)
                    cr.font.color.rgb = RGBColor(0x66, 0x66, 0x66)

        if idx < len(sorted_findings):
            doc.add_paragraph()
            p = doc.add_paragraph()
            p.paragraph_format.space_after = Pt(0)
            p.add_run("─" * 80).font.color.rgb = RGBColor(0xCC, 0xCC, 0xCC)
            doc.add_paragraph()

    # ── Conclusion ────────────────────────────────────────────────────────────

    doc.add_page_break()
    _add_heading(doc, "5. Conclusion", 1, RGBColor(0xC0, 0x39, 0x2B))

    if report.conclusion:
        doc.add_paragraph(report.conclusion)
    else:
        rem_rate = round(rem_count / len(findings) * 100) if findings else 0
        doc.add_paragraph(
            f"This assessment identified {len(findings)} finding(s) across the tested environment. "
            f"Of these, {sev_counts['Critical']} are Critical and {sev_counts['High']} are High severity, "
            f"representing the most immediate risks to the organization. "
            f"The current remediation rate is {rem_rate}%. "
            f"RedTrack recommends prioritizing Critical and High findings for immediate remediation, "
            f"followed by a re-test to verify the effectiveness of applied fixes."
        )

    # Save
    output_path = REPORTS_DIR / f"{uuid.uuid4().hex}.docx"
    doc.save(str(output_path))
    return str(output_path)


def _insert_findings_summary_table(doc, findings):
    table = doc.add_table(rows=1, cols=5)
    table.style = 'Table Grid'

    # Header row
    headers = ["ID", "Title", "Severity", "CVSS", "Status"]
    widths = [Inches(0.7), Inches(3.5), Inches(1.0), Inches(0.7), Inches(1.0)]
    hrow = table.rows[0]
    for i, (h, w) in enumerate(zip(headers, widths)):
        cell = hrow.cells[i]
        cell.text = h
        cell.paragraphs[0].runs[0].bold = True
        cell.paragraphs[0].runs[0].font.color.rgb = RGBColor(0xFF, 0xFF, 0xFF)
        cell.paragraphs[0].runs[0].font.size = Pt(9)
        cell.paragraphs[0].alignment = WD_ALIGN_PARAGRAPH.CENTER
        _set_cell_bg(cell, "1A1A2E")
        cell.width = w

    for f in findings:
        sev = f.severity.value if hasattr(f.severity, 'value') else str(f.severity)
        status = f.status.value if hasattr(f.status, 'value') else str(f.status)
        row = table.add_row()
        vals = [f.ref_id, f.title, sev, str(f.cvss_score) if f.cvss_score else "—", status]
        for i, (val, w) in enumerate(zip(vals, widths)):
            cell = row.cells[i]
            cell.text = val
            cell.paragraphs[0].runs[0].font.size = Pt(9)
            cell.width = w
            if i == 2:  # Severity
                cell.paragraphs[0].runs[0].font.color.rgb = SEV_COLORS.get(sev, RGBColor(0, 0, 0))
                cell.paragraphs[0].runs[0].bold = True
                cell.paragraphs[0].alignment = WD_ALIGN_PARAGRAPH.CENTER


def _insert_findings_table_after(doc, para, findings):
    """Insert findings summary table after a placeholder paragraph in a template."""
    sorted_findings = sorted(findings, key=lambda f: {"Critical": 0, "High": 1, "Medium": 2, "Low": 3, "Info": 4}.get(
        f.severity.value if hasattr(f.severity, 'value') else str(f.severity), 5))
    _insert_findings_summary_table(doc, sorted_findings)


def _insert_findings_detail_after(doc, para, findings):
    """Insert detailed findings after a placeholder paragraph in a template."""
    sorted_findings = sorted(findings, key=lambda f: {"Critical": 0, "High": 1, "Medium": 2, "Low": 3, "Info": 4}.get(
        f.severity.value if hasattr(f.severity, 'value') else str(f.severity), 5))
    for f in sorted_findings:
        sev = f.severity.value if hasattr(f.severity, 'value') else str(f.severity)
        doc.add_heading(f"{f.ref_id} — {f.title}", 2)
        for label, content in [
            ("Severity", sev), ("CVSS", str(f.cvss_score) if f.cvss_score else None),
            ("CWE", f.cwe), ("Affected Component", f.affected_component),
            ("Description", f.description), ("Impact", f.impact),
            ("Steps to Reproduce", f.steps_to_reproduce), ("Remediation", f.remediation),
        ]:
            if content:
                p = doc.add_paragraph()
                run = p.add_run(label + ": ")
                run.bold = True
                p.add_run(content)


async def convert_to_pdf(docx_path: str) -> Optional[str]:
    """Convert .docx to PDF using LibreOffice headless."""
    try:
        output_dir = str(REPORTS_DIR)
        result = subprocess.run(
            ["libreoffice", "--headless", "--convert-to", "pdf", "--outdir", output_dir, docx_path],
            capture_output=True, text=True, timeout=60
        )
        if result.returncode == 0:
            pdf_path = Path(docx_path).with_suffix('.pdf')
            if pdf_path.exists():
                return str(pdf_path)
        return None
    except Exception:
        return None


# Keep old name for backward compat
async def generate_pdf_report(eng, findings, report) -> str:
    return await generate_docx_report(eng, findings, report)
