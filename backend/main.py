"""
RedTrack v2 — Main API Entry Point
"""

from contextlib import asynccontextmanager
from fastapi import FastAPI, WebSocket, WebSocketDisconnect, Depends, HTTPException, UploadFile, File, Query, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func, and_
from pathlib import Path
from typing import Optional
from datetime import datetime, timezone
import uuid
import aiofiles
import hashlib
import hmac

from config import get_settings
from database import create_tables, get_db
from models import (
    JumpBox,
    User, Engagement, Finding, Evidence, Comment, Report,
    VulnTemplate, EngagementMember, ReconHost, MitreTechnique, EngagementTask, Integration, TaskTemplate,
    Severity, FindingStatus, EngagementStatus, UserRole
)
from auth import (
    hash_password, verify_password, create_access_token, create_refresh_token,
    decode_token, get_current_user, require_tester_or_above, require_lead_or_admin
)
import ai_service
from seed import seed_data

settings = get_settings()


@asynccontextmanager
async def lifespan(app: FastAPI):
    await create_tables()
    await seed_data()
    yield


app = FastAPI(title="RedTrack API v2", version="2.0.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

uploads_path = Path(settings.upload_dir)
uploads_path.mkdir(parents=True, exist_ok=True)
app.mount("/uploads", StaticFiles(directory=str(uploads_path)), name="uploads")


# ─── User Management ──────────────────────────────────────────────────────────

@app.get("/users/")
async def list_users(db: AsyncSession = Depends(get_db), current_user: User = Depends(require_lead_or_admin)):
    result = await db.execute(select(User).order_by(User.created_at))
    return [_user_out(u) for u in result.scalars().all()]


@app.post("/users/", status_code=201)
async def create_user(body: dict, db: AsyncSession = Depends(get_db), current_user: User = Depends(require_lead_or_admin)):
    existing = await db.execute(select(User).where(User.email == body["email"]))
    if existing.scalar_one_or_none():
        raise HTTPException(409, "Email already registered")
    user = User(
        email=body["email"],
        username=body["username"],
        full_name=body["full_name"],
        hashed_password=hash_password(body["password"]),
        role=body.get("role", "tester"),
    )
    db.add(user)
    await db.flush()
    return _user_out(user)


@app.patch("/users/{user_id}")
async def update_user(user_id: uuid.UUID, body: dict, db: AsyncSession = Depends(get_db), current_user: User = Depends(require_lead_or_admin)):
    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalar_one_or_none()
    if not user:
        raise HTTPException(404, "User not found")
    allowed = ["full_name", "role", "is_active", "email"]
    for k, v in body.items():
        if k in allowed and hasattr(user, k):
            setattr(user, k, v)
    return _user_out(user)


@app.delete("/users/{user_id}", status_code=204)
async def delete_user(user_id: uuid.UUID, db: AsyncSession = Depends(get_db), current_user: User = Depends(require_lead_or_admin)):
    if str(user_id) == str(current_user.id):
        raise HTTPException(400, "Cannot delete your own account")
    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalar_one_or_none()
    if not user:
        raise HTTPException(404, "User not found")
    await db.delete(user)


# ─── Health ───────────────────────────────────────────────────────────────────

@app.get("/health")
async def health():
    return {"status": "ok", "service": "RedTrack API", "version": "2.0.0"}


# ─── Auth ─────────────────────────────────────────────────────────────────────

@app.post("/auth/register", status_code=201)
async def register(body: dict, db: AsyncSession = Depends(get_db)):
    existing = await db.execute(select(User).where(User.email == body["email"]))
    if existing.scalar_one_or_none():
        raise HTTPException(409, "Email already registered")
    user = User(
        email=body["email"], username=body["username"],
        full_name=body["full_name"], hashed_password=hash_password(body["password"]),
        role=body.get("role", "tester"),
    )
    db.add(user)
    await db.flush()
    return _user_out(user)


@app.post("/auth/login")
async def login(body: dict, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(User).where(User.email == body["email"]))
    user = result.scalar_one_or_none()
    if not user or not verify_password(body["password"], user.hashed_password):
        raise HTTPException(401, "Invalid credentials")
    user.last_login = datetime.now(timezone.utc)
    return {
        "access_token": create_access_token(str(user.id)),
        "refresh_token": create_refresh_token(str(user.id)),
        "token_type": "bearer",
        "user": _user_out(user),
    }


@app.post("/auth/refresh")
async def refresh(body: dict, db: AsyncSession = Depends(get_db)):
    payload = decode_token(body["refresh_token"])
    result = await db.execute(select(User).where(User.id == payload["sub"]))
    user = result.scalar_one_or_none()
    if not user:
        raise HTTPException(401, "User not found")
    return {
        "access_token": create_access_token(str(user.id)),
        "refresh_token": create_refresh_token(str(user.id)),
        "token_type": "bearer",
        "user": _user_out(user),
    }


@app.get("/auth/me")
async def me(current_user: User = Depends(get_current_user)):
    return _user_out(current_user)


@app.post("/auth/api-key")
async def generate_api_key(current_user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    import secrets
    key = secrets.token_hex(32)
    current_user.api_key = key
    return {"api_key": key}


def _user_out(user):
    return {
        "id": str(user.id), "email": user.email, "username": user.username,
        "full_name": user.full_name, "role": user.role.value if hasattr(user.role, 'value') else user.role,
        "is_active": user.is_active, "avatar_url": user.avatar_url,
        "created_at": str(user.created_at), "last_login": str(user.last_login) if user.last_login else None,
    }


# ─── Dashboard ────────────────────────────────────────────────────────────────

@app.get("/dashboard/stats")
async def dashboard_stats(db: AsyncSession = Depends(get_db), current_user: User = Depends(get_current_user)):
    total_eng = await db.scalar(select(func.count(Engagement.id))) or 0
    active_eng = await db.scalar(select(func.count(Engagement.id)).where(Engagement.status == EngagementStatus.active)) or 0
    total_findings = await db.scalar(select(func.count(Finding.id))) or 0
    open_findings = await db.scalar(select(func.count(Finding.id)).where(Finding.status == FindingStatus.open)) or 0
    critical_open = await db.scalar(select(func.count(Finding.id)).where(and_(Finding.status == FindingStatus.open, Finding.severity == Severity.critical))) or 0
    remediated = await db.scalar(select(func.count(Finding.id)).where(Finding.status == FindingStatus.remediated)) or 0

    sev_breakdown = {}
    for sev in Severity:
        count = await db.scalar(select(func.count(Finding.id)).where(Finding.severity == sev))
        sev_breakdown[sev.value] = count or 0

    recent_result = await db.execute(select(Finding).order_by(Finding.created_at.desc()).limit(5))
    recent = recent_result.scalars().all()

    return {
        "total_engagements": total_eng,
        "active_engagements": active_eng,
        "total_findings": total_findings,
        "open_findings": open_findings,
        "critical_open": critical_open,
        "remediation_rate": round((remediated / total_findings * 100) if total_findings else 0, 1),
        "severity_breakdown": sev_breakdown,
        "recent_findings": [_finding_out(f) for f in recent],
    }


# ─── Engagements ──────────────────────────────────────────────────────────────

@app.get("/engagements/")
async def list_engagements(search: Optional[str] = None, status: Optional[str] = None, db: AsyncSession = Depends(get_db), current_user: User = Depends(get_current_user)):
    q = select(Engagement).order_by(Engagement.created_at.desc())
    if status:
        q = q.where(Engagement.status == status)
    if search:
        q = q.where(Engagement.name.ilike(f"%{search}%") | Engagement.client.ilike(f"%{search}%"))
    result = await db.execute(q)
    engs = result.scalars().all()
    return [await _eng_out(e, db) for e in engs]


@app.post("/engagements/", status_code=201)
async def create_engagement(body: dict, db: AsyncSession = Depends(get_db), current_user: User = Depends(require_tester_or_above)):
    count = await db.scalar(select(func.count(Engagement.id))) or 0
    ref_id = f"ENG-{str(count + 1).zfill(3)}"
    allowed = ["name", "client", "type", "status", "scope", "out_of_scope", "objectives", "rules_of_engagement", "methodology", "client_contact", "client_email", "start_date", "end_date", "notes"]
    data = {k: v for k, v in body.items() if k in allowed}
    for date_field in ["start_date", "end_date"]:
        val = data.get(date_field)
        if not val or val == '':
            data[date_field] = None
        elif isinstance(val, str):
            try:
                data[date_field] = datetime.fromisoformat(val)
            except ValueError:
                data[date_field] = None
    eng = Engagement(**data, ref_id=ref_id)
    db.add(eng)
    await db.flush()
    member = EngagementMember(engagement_id=eng.id, user_id=current_user.id, role="lead")
    db.add(member)
    await db.flush()
    # Slack notification
    try:
        from slack_service import notify_new_engagement
        webhook_url, base_url = await _get_slack_config(db)
        if webhook_url:
            import asyncio
            asyncio.create_task(notify_new_engagement(webhook_url, base_url, eng))
    except Exception:
        pass
    return await _eng_out(eng, db)


@app.get("/engagements/{eng_id}")
async def get_engagement(eng_id: uuid.UUID, db: AsyncSession = Depends(get_db), current_user: User = Depends(get_current_user)):
    result = await db.execute(select(Engagement).where(Engagement.id == eng_id))
    eng = result.scalar_one_or_none()
    if not eng:
        raise HTTPException(404, "Not found")
    return await _eng_out(eng, db)


@app.patch("/engagements/{eng_id}")
async def update_engagement(eng_id: uuid.UUID, body: dict, db: AsyncSession = Depends(get_db), current_user: User = Depends(require_tester_or_above)):
    result = await db.execute(select(Engagement).where(Engagement.id == eng_id))
    eng = result.scalar_one_or_none()
    if not eng:
        raise HTTPException(404, "Not found")
    for k, v in body.items():
        if hasattr(eng, k):
            setattr(eng, k, v)
    return await _eng_out(eng, db)


@app.delete("/engagements/{eng_id}", status_code=204)
async def delete_engagement(eng_id: uuid.UUID, db: AsyncSession = Depends(get_db), current_user: User = Depends(require_lead_or_admin)):
    result = await db.execute(select(Engagement).where(Engagement.id == eng_id))
    eng = result.scalar_one_or_none()
    if not eng:
        raise HTTPException(404, "Not found")
    await db.delete(eng)


async def _eng_out(eng, db):
    total = await db.scalar(select(func.count(Finding.id)).where(Finding.engagement_id == eng.id)) or 0
    crit = await db.scalar(select(func.count(Finding.id)).where(and_(Finding.engagement_id == eng.id, Finding.severity == Severity.critical))) or 0
    open_ = await db.scalar(select(func.count(Finding.id)).where(and_(Finding.engagement_id == eng.id, Finding.status == FindingStatus.open))) or 0
    rem = await db.scalar(select(func.count(Finding.id)).where(and_(Finding.engagement_id == eng.id, Finding.status == FindingStatus.remediated))) or 0
    return {
        "id": str(eng.id), "ref_id": eng.ref_id, "name": eng.name, "client": eng.client,
        "type": eng.type.value if hasattr(eng.type, 'value') else eng.type,
        "status": eng.status.value if hasattr(eng.status, 'value') else eng.status,
        "scope": eng.scope, "out_of_scope": eng.out_of_scope, "objectives": eng.objectives,
        "rules_of_engagement": eng.rules_of_engagement, "methodology": eng.methodology,
        "client_contact": eng.client_contact, "client_email": eng.client_email,
        "notes": eng.notes, "recon_notes": eng.recon_notes,
        "start_date": str(eng.start_date) if eng.start_date else None,
        "end_date": str(eng.end_date) if eng.end_date else None,
        "created_at": str(eng.created_at), "updated_at": str(eng.updated_at),
        "finding_count": total, "critical_count": crit, "open_count": open_, "remediated_count": rem,
    }


# ─── Findings ─────────────────────────────────────────────────────────────────

@app.get("/findings/")
async def list_findings(engagement_id: Optional[uuid.UUID] = None, severity: Optional[str] = None, status: Optional[str] = None, search: Optional[str] = None, db: AsyncSession = Depends(get_db), current_user: User = Depends(get_current_user)):
    q = select(Finding).order_by(Finding.created_at.desc())
    if engagement_id:
        q = q.where(Finding.engagement_id == engagement_id)
    if severity:
        q = q.where(Finding.severity == severity)
    if status:
        q = q.where(Finding.status == status)
    if search:
        q = q.where(Finding.title.ilike(f"%{search}%"))
    result = await db.execute(q)
    return [_finding_out(f) for f in result.scalars().all()]


@app.post("/findings/{engagement_id}", status_code=201)
async def create_finding(engagement_id: uuid.UUID, body: dict, db: AsyncSession = Depends(get_db), current_user: User = Depends(require_tester_or_above)):
    count = await db.scalar(select(func.count(Finding.id))) or 0
    ref_id = f"F-{str(count + 1).zfill(3)}"
    allowed = ["title", "severity", "status", "cvss_score", "cvss_vector", "cwe", "cve", "affected_component", "description", "impact", "steps_to_reproduce", "remediation", "references", "tags", "source", "mitre_atlas_ttp", "ai_phase", "owasp_llm_risk"]
    data = {k: v for k, v in body.items() if k in allowed}
    finding = Finding(**data, engagement_id=engagement_id, tester_id=current_user.id, ref_id=ref_id)
    db.add(finding)
    await db.flush()
    # Slack notification for high/critical
    try:
        from slack_service import notify_new_finding
        webhook_url, base_url = await _get_slack_config(db)
        if webhook_url:
            eng = (await db.execute(select(Engagement).where(Engagement.id == engagement_id))).scalar_one_or_none()
            if eng:
                import asyncio
                asyncio.create_task(notify_new_finding(webhook_url, base_url, finding, eng))
    except Exception:
        pass
    return _finding_out(finding)


@app.get("/findings/{finding_id}")
async def get_finding(finding_id: uuid.UUID, db: AsyncSession = Depends(get_db), current_user: User = Depends(get_current_user)):
    result = await db.execute(select(Finding).where(Finding.id == finding_id))
    f = result.scalar_one_or_none()
    if not f:
        raise HTTPException(404, "Not found")
    return _finding_out(f)


@app.patch("/findings/{finding_id}")
async def update_finding(finding_id: uuid.UUID, body: dict, db: AsyncSession = Depends(get_db), current_user: User = Depends(require_tester_or_above)):
    result = await db.execute(select(Finding).where(Finding.id == finding_id))
    f = result.scalar_one_or_none()
    if not f:
        raise HTTPException(404, "Not found")
    for k, v in body.items():
        if hasattr(f, k):
            setattr(f, k, v)
    return _finding_out(f)


@app.delete("/findings/{finding_id}", status_code=204)
async def delete_finding(finding_id: uuid.UUID, db: AsyncSession = Depends(get_db), current_user: User = Depends(require_tester_or_above)):
    result = await db.execute(select(Finding).where(Finding.id == finding_id))
    f = result.scalar_one_or_none()
    if not f:
        raise HTTPException(404, "Not found")
    await db.delete(f)


@app.post("/findings/{finding_id}/comments", status_code=201)
async def add_comment(finding_id: uuid.UUID, body: dict, db: AsyncSession = Depends(get_db), current_user: User = Depends(get_current_user)):
    comment = Comment(finding_id=finding_id, author_id=current_user.id, body=body["body"], is_internal=body.get("is_internal", True))
    db.add(comment)
    await db.flush()
    return {"id": str(comment.id), "finding_id": str(comment.finding_id), "body": comment.body, "is_internal": comment.is_internal, "created_at": str(comment.created_at)}


@app.get("/findings/{finding_id}/comments")
async def list_comments(finding_id: uuid.UUID, db: AsyncSession = Depends(get_db), current_user: User = Depends(get_current_user)):
    result = await db.execute(select(Comment).where(Comment.finding_id == finding_id).order_by(Comment.created_at))
    return [{"id": str(c.id), "finding_id": str(c.finding_id), "author_id": str(c.author_id), "body": c.body, "is_internal": c.is_internal, "created_at": str(c.created_at)} for c in result.scalars().all()]


@app.post("/findings/{finding_id}/evidence", status_code=201)
async def upload_evidence(finding_id: uuid.UUID, file: UploadFile = File(...), db: AsyncSession = Depends(get_db), current_user: User = Depends(require_tester_or_above)):
    upload_dir = Path(settings.upload_dir) / "evidence" / str(finding_id)
    upload_dir.mkdir(parents=True, exist_ok=True)
    content = await file.read()
    stored_name = f"{uuid.uuid4().hex}{Path(file.filename).suffix}"
    async with aiofiles.open(upload_dir / stored_name, "wb") as f:
        await f.write(content)
    ev = Evidence(finding_id=finding_id, filename=str(upload_dir / stored_name), original_name=file.filename, mime_type=file.content_type, size_bytes=len(content), uploader_id=current_user.id)
    db.add(ev)
    await db.flush()
    return {"id": str(ev.id), "finding_id": str(ev.finding_id), "original_name": ev.original_name, "size_bytes": ev.size_bytes, "uploaded_at": str(ev.uploaded_at)}


@app.get("/findings/evidence/{evidence_id}/file")
async def serve_evidence(evidence_id: uuid.UUID, token: str = None, db: AsyncSession = Depends(get_db)):
    # Token optional — evidence UUIDs are unguessable
    result = await db.execute(select(Evidence).where(Evidence.id == evidence_id))
    ev = result.scalar_one_or_none()
    if not ev:
        raise HTTPException(404, "Evidence not found")
    from pathlib import Path
    file_path = Path(ev.filename)
    if not file_path.exists():
        raise HTTPException(404, "File not found on disk")
    return FileResponse(str(file_path), media_type=ev.mime_type, filename=ev.original_name)


@app.delete("/findings/evidence/{evidence_id}", status_code=204)
async def delete_evidence(evidence_id: uuid.UUID, db: AsyncSession = Depends(get_db), current_user: User = Depends(require_tester_or_above)):
    result = await db.execute(select(Evidence).where(Evidence.id == evidence_id))
    ev = result.scalar_one_or_none()
    if ev:
        import os
        if ev.filename and os.path.exists(ev.filename):
            os.remove(ev.filename)
        await db.delete(ev)


@app.get("/findings/{finding_id}/evidence")
async def list_evidence(finding_id: uuid.UUID, db: AsyncSession = Depends(get_db), current_user: User = Depends(get_current_user)):
    result = await db.execute(select(Evidence).where(Evidence.finding_id == finding_id))
    return [{"id": str(e.id), "finding_id": str(e.finding_id), "original_name": e.original_name, "mime_type": e.mime_type, "size_bytes": e.size_bytes, "caption": e.caption, "uploaded_at": str(e.uploaded_at)} for e in result.scalars().all()]


def _finding_out(f):
    return {
        "id": str(f.id), "ref_id": f.ref_id, "engagement_id": str(f.engagement_id),
        "title": f.title,
        "severity": f.severity.value if hasattr(f.severity, 'value') else f.severity,
        "status": f.status.value if hasattr(f.status, 'value') else f.status,
        "cvss_score": f.cvss_score, "cvss_vector": f.cvss_vector,
        "cwe": f.cwe, "cve": f.cve, "affected_component": f.affected_component,
        "description": f.description, "impact": f.impact,
        "steps_to_reproduce": f.steps_to_reproduce, "remediation": f.remediation,
        "references": f.references, "ai_analysis": f.ai_analysis,
        "tags": f.tags, "source": f.source,
        "mitre_atlas_ttp": f.mitre_atlas_ttp, "ai_phase": f.ai_phase, "owasp_llm_risk": f.owasp_llm_risk,
        "tester_id": str(f.tester_id) if f.tester_id else None,
        "created_at": str(f.created_at), "updated_at": str(f.updated_at),
    }


# ─── Recon Hosts ──────────────────────────────────────────────────────────────

@app.get("/recon/{engagement_id}/hosts")
async def list_hosts(engagement_id: uuid.UUID, db: AsyncSession = Depends(get_db), current_user: User = Depends(get_current_user)):
    result = await db.execute(select(ReconHost).where(ReconHost.engagement_id == engagement_id).order_by(ReconHost.discovered_at.desc()))
    return [_host_out(h) for h in result.scalars().all()]


@app.post("/recon/{engagement_id}/hosts", status_code=201)
async def add_host(engagement_id: uuid.UUID, body: dict, db: AsyncSession = Depends(get_db), current_user: User = Depends(require_tester_or_above)):
    host = ReconHost(
        engagement_id=engagement_id,
        ip_address=body["ip_address"],
        hostname=body.get("hostname"),
        os=body.get("os"),
        ports=body.get("ports", []),
        services=body.get("services", []),
        notes=body.get("notes"),
        source=body.get("source", "manual"),
    )
    db.add(host)
    await db.flush()
    return _host_out(host)


@app.patch("/recon/hosts/{host_id}")
async def update_host(host_id: uuid.UUID, body: dict, db: AsyncSession = Depends(get_db), current_user: User = Depends(require_tester_or_above)):
    result = await db.execute(select(ReconHost).where(ReconHost.id == host_id))
    host = result.scalar_one_or_none()
    if not host:
        raise HTTPException(404, "Host not found")
    for k, v in body.items():
        if hasattr(host, k):
            setattr(host, k, v)
    return _host_out(host)


@app.delete("/recon/hosts/{host_id}", status_code=204)
async def delete_host(host_id: uuid.UUID, db: AsyncSession = Depends(get_db), current_user: User = Depends(require_tester_or_above)):
    result = await db.execute(select(ReconHost).where(ReconHost.id == host_id))
    host = result.scalar_one_or_none()
    if host:
        await db.delete(host)


def _host_out(h):
    return {
        "id": str(h.id), "engagement_id": str(h.engagement_id),
        "ip_address": h.ip_address, "hostname": h.hostname, "os": h.os,
        "ports": h.ports, "services": h.services, "status": h.status,
        "notes": h.notes, "source": h.source, "discovered_at": str(h.discovered_at),
    }


# ─── Reports ──────────────────────────────────────────────────────────────────

@app.post("/reports/{engagement_id}", status_code=201)
async def create_report(engagement_id: uuid.UUID, body: dict, db: AsyncSession = Depends(get_db), current_user: User = Depends(require_tester_or_above)):
    report = Report(engagement_id=engagement_id, created_by_id=current_user.id, title=body["title"], version=body.get("version", "1.0"), executive_summary=body.get("executive_summary"), methodology_section=body.get("methodology_section"), conclusion=body.get("conclusion"))
    db.add(report)
    await db.flush()
    return _report_out(report)


@app.get("/reports/engagement/{engagement_id}")
async def list_reports(engagement_id: uuid.UUID, db: AsyncSession = Depends(get_db), current_user: User = Depends(get_current_user)):
    result = await db.execute(select(Report).where(Report.engagement_id == engagement_id).order_by(Report.created_at.desc()))
    return [_report_out(r) for r in result.scalars().all()]


@app.post("/reports/{report_id}/generate")
async def generate_report(report_id: uuid.UUID, template_id: Optional[str] = None, db: AsyncSession = Depends(get_db), current_user: User = Depends(require_tester_or_above)):
    r = (await db.execute(select(Report).where(Report.id == report_id))).scalar_one_or_none()
    if not r:
        raise HTTPException(404, "Not found")
    eng = (await db.execute(select(Engagement).where(Engagement.id == r.engagement_id))).scalar_one_or_none()
    findings = (await db.execute(select(Finding).where(Finding.engagement_id == eng.id))).scalars().all()
    try:
        from report_service import generate_docx_report
        template_path = None
        if template_id:
            from pathlib import Path
            tp = Path(settings.upload_dir) / "report_templates" / template_id
            if tp.exists():
                template_path = str(tp)
        path = await generate_docx_report(eng, findings, r, template_path)
        r.file_path = path
        r.generated_at = datetime.now(timezone.utc)
        return {"message": "Report generated", "report_id": str(report_id), "file_path": path}
    except Exception as e:
        import traceback
        traceback.print_exc()
        raise HTTPException(500, str(e))


@app.get("/reports/{report_id}/download")
async def download_report(report_id: uuid.UUID, fmt: str = "docx", db: AsyncSession = Depends(get_db), current_user: User = Depends(get_current_user)):
    r = (await db.execute(select(Report).where(Report.id == report_id))).scalar_one_or_none()
    if not r or not r.file_path:
        raise HTTPException(404, "Report file not found")
    if fmt == "pdf":
        from report_service import convert_to_pdf
        pdf_path = await convert_to_pdf(r.file_path)
        if pdf_path:
            return FileResponse(pdf_path, media_type="application/pdf", filename="pentest_report.pdf")
        raise HTTPException(500, "PDF conversion failed — LibreOffice may not be installed")
    return FileResponse(r.file_path, media_type="application/vnd.openxmlformats-officedocument.wordprocessingml.document", filename="pentest_report.docx")


@app.post("/reports/templates/upload", status_code=201)
async def upload_report_template(file: UploadFile = File(...), name: str = "", db: AsyncSession = Depends(get_db), current_user: User = Depends(require_lead_or_admin)):
    if not file.filename.endswith('.docx'):
        raise HTTPException(400, "Only .docx templates are supported")
    from pathlib import Path
    templates_dir = Path(settings.upload_dir) / "report_templates"
    templates_dir.mkdir(parents=True, exist_ok=True)
    stored_name = f"{uuid.uuid4().hex}.docx"
    content = await file.read()
    async with aiofiles.open(templates_dir / stored_name, "wb") as f:
        await f.write(content)
    return {"id": stored_name, "name": name or file.filename, "filename": stored_name, "size_bytes": len(content)}


@app.get("/reports/templates/list")
async def list_report_templates(current_user: User = Depends(get_current_user)):
    from pathlib import Path
    templates_dir = Path(settings.upload_dir) / "report_templates"
    templates_dir.mkdir(parents=True, exist_ok=True)
    templates = []
    for f in templates_dir.glob("*.docx"):
        templates.append({"id": f.name, "filename": f.name, "size_bytes": f.stat().st_size, "created_at": str(datetime.fromtimestamp(f.stat().st_ctime, tz=timezone.utc))})
    return templates


@app.delete("/reports/templates/{template_id}", status_code=204)
async def delete_report_template(template_id: str, current_user: User = Depends(require_lead_or_admin)):
    from pathlib import Path
    template_path = Path(settings.upload_dir) / "report_templates" / template_id
    if template_path.exists():
        template_path.unlink()


def _report_out(r):
    return {"id": str(r.id), "engagement_id": str(r.engagement_id), "title": r.title, "version": r.version, "executive_summary": r.executive_summary, "file_path": r.file_path, "generated_at": str(r.generated_at) if r.generated_at else None, "created_at": str(r.created_at)}


# ─── AI ───────────────────────────────────────────────────────────────────────

@app.get("/ai/provider")
async def get_provider(current_user: User = Depends(get_current_user)):
    return {"provider": settings.ai_provider}


@app.post("/ai/analyze")
async def ai_analyze(body: dict, db: AsyncSession = Depends(get_db), current_user: User = Depends(require_tester_or_above)):
    f = (await db.execute(select(Finding).where(Finding.id == body["finding_id"]))).scalar_one_or_none()
    if not f:
        raise HTTPException(404, "Finding not found")
    content = await ai_service.analyze_finding(f)
    f.ai_analysis = content
    return {"content": content}


@app.post("/ai/remediation")
async def ai_remediation(body: dict, current_user: User = Depends(require_tester_or_above)):
    content = await ai_service.suggest_remediation(body["title"], body["description"], body["severity"], body.get("cwe"), body.get("affected_component"))
    return {"content": content}


@app.post("/ai/executive-summary")
async def ai_summary(body: dict, db: AsyncSession = Depends(get_db), current_user: User = Depends(require_tester_or_above)):
    eng = (await db.execute(select(Engagement).where(Engagement.id == body["engagement_id"]))).scalar_one_or_none()
    if not eng:
        raise HTTPException(404, "Not found")
    findings = (await db.execute(select(Finding).where(Finding.engagement_id == body["engagement_id"]))).scalars().all()
    content = await ai_service.generate_executive_summary(eng, findings)
    return {"content": content}


@app.post("/ai/steps")
async def ai_steps(title: str, description: str, affected_component: Optional[str] = None, current_user: User = Depends(require_tester_or_above)):
    content = await ai_service.generate_steps_to_reproduce(title, description, affected_component)
    return {"content": content}


@app.post("/ai/cvss")
async def ai_cvss(title: str, description: str, current_user: User = Depends(require_tester_or_above)):
    return await ai_service.suggest_cvss(title, description)


@app.post("/ai/redteam-phase")
async def ai_redteam_phase(body: dict, current_user: User = Depends(require_tester_or_above)):
    content = await ai_service.analyze_ai_redteam_phase(body["phase"], body["context"])
    return {"content": content}


@app.post("/ai/chat")
async def ai_chat(body: dict, db: AsyncSession = Depends(get_db), current_user: User = Depends(get_current_user)):
    engagement = None
    finding = None
    if body.get("engagement_id"):
        engagement = (await db.execute(select(Engagement).where(Engagement.id == body["engagement_id"]))).scalar_one_or_none()
    if body.get("finding_id"):
        finding = (await db.execute(select(Finding).where(Finding.id == body["finding_id"]))).scalar_one_or_none()
    messages = [{"role": m["role"], "content": m["content"]} for m in body["messages"]]
    content = await ai_service.chat(messages, engagement=engagement, finding=finding, is_ai_redteam=body.get("is_ai_redteam", False))
    return {"content": content}


# ─── Vuln Templates ───────────────────────────────────────────────────────────

@app.get("/vulns/")
async def list_templates(search: Optional[str] = None, severity: Optional[str] = None, db: AsyncSession = Depends(get_db), current_user: User = Depends(get_current_user)):
    q = select(VulnTemplate).order_by(VulnTemplate.title)
    if search:
        q = q.where(VulnTemplate.title.ilike(f"%{search}%"))
    if severity:
        q = q.where(VulnTemplate.severity == severity)
    result = await db.execute(q)
    return [_tmpl_out(t) for t in result.scalars().all()]


@app.post("/vulns/{template_id}/import/{engagement_id}", status_code=201)
async def import_template(template_id: uuid.UUID, engagement_id: uuid.UUID, db: AsyncSession = Depends(get_db), current_user: User = Depends(require_tester_or_above)):
    t = (await db.execute(select(VulnTemplate).where(VulnTemplate.id == template_id))).scalar_one_or_none()
    if not t:
        raise HTTPException(404, "Template not found")
    count = await db.scalar(select(func.count(Finding.id))) or 0
    f = Finding(ref_id=f"F-{str(count + 1).zfill(3)}", engagement_id=engagement_id, tester_id=current_user.id, title=t.title, severity=t.severity, cvss_score=t.cvss_score, cwe=t.cwe, description=t.description, impact=t.impact, remediation=t.remediation, references=t.references, tags=t.tags)
    db.add(f)
    await db.flush()
    return _finding_out(f)


def _tmpl_out(t):
    return {"id": str(t.id), "title": t.title, "severity": t.severity.value if hasattr(t.severity, 'value') else t.severity, "cvss_score": t.cvss_score, "cwe": t.cwe, "category": t.category, "description": t.description, "impact": t.impact, "remediation": t.remediation, "references": t.references, "tags": t.tags}



@app.post("/findings-direct/{engagement_id}", status_code=201)
async def create_finding_direct(engagement_id: uuid.UUID, body: dict, db: AsyncSession = Depends(get_db), current_user: User = Depends(require_tester_or_above)):
    """Import a finding directly from NVD/MITRE/AI without a local template."""
    count = await db.scalar(select(func.count(Finding.id))) or 0
    ref_id = f"F-{str(count + 1).zfill(3)}"
    allowed = ["title", "severity", "cvss_score", "cvss_vector", "cwe", "cve", "affected_component", "description", "impact", "remediation", "references", "source", "tags"]
    data = {k: v for k, v in body.items() if k in allowed}
    if isinstance(data.get("references"), list):
        data["references"] = "\n".join(data["references"])
    if isinstance(data.get("tags"), str):
        data["tags"] = [data["tags"]]
    if data.get("cwe") and len(data["cwe"]) > 50:
        data["cwe"] = data["cwe"][:50]
    if data.get("cvss_vector") and len(data["cvss_vector"]) > 200:
        data["cvss_vector"] = data["cvss_vector"][:200]
    finding = Finding(**data, engagement_id=engagement_id, tester_id=current_user.id, ref_id=ref_id)
    db.add(finding)
    await db.flush()
    return _finding_out(finding)


@app.post("/vulns/save", status_code=201)
async def save_vuln_template(body: dict, db: AsyncSession = Depends(get_db), current_user: User = Depends(require_tester_or_above)):
    """Save an external (NVD/MITRE/AI) result as a local template."""
    allowed = ["title", "severity", "cvss_score", "cwe", "category", "description", "impact", "remediation", "references", "tags"]
    data = {k: v for k, v in body.items() if k in allowed}
    template = VulnTemplate(**data)
    db.add(template)
    await db.flush()
    return _tmpl_out(template)


# ─── MITRE ATT&CK Techniques ─────────────────────────────────────────────────


TECHNIQUE_NAMES = {
    "T1566": "Phishing", "T1190": "Exploit Public-Facing Application",
    "T1133": "External Remote Services", "T1078": "Valid Accounts",
    "T1091": "Replication Through Removable Media", "T1195": "Supply Chain Compromise",
    "T1199": "Trusted Relationship", "T1200": "Hardware Additions",
    "T1059": "Command and Scripting Interpreter", "T1203": "Exploitation for Client Execution",
    "T1106": "Native API", "T1053": "Scheduled Task/Job", "T1129": "Shared Modules",
    "T1072": "Software Deployment Tools", "T1569": "System Services",
    "T1204": "User Execution", "T1047": "Windows Management Instrumentation",
    "T1098": "Account Manipulation", "T1197": "BITS Jobs", "T1547": "Boot or Logon Autostart Execution",
    "T1037": "Boot or Logon Initialization Scripts", "T1176": "Browser Extensions",
    "T1554": "Compromise Client Software Binary", "T1136": "Create Account",
    "T1543": "Create or Modify System Process", "T1546": "Event Triggered Execution",
    "T1133": "External Remote Services", "T1574": "Hijack Execution Flow",
    "T1525": "Implant Internal Image", "T1556": "Modify Authentication Process",
    "T1137": "Office Application Startup", "T1542": "Pre-OS Boot",
    "T1505": "Server Software Component", "T1205": "Traffic Signaling",
    "T1078": "Valid Accounts", "T1548": "Abuse Elevation Control Mechanism",
    "T1134": "Access Token Manipulation", "T1531": "Account Access Removal",
    "T1087": "Account Discovery", "T1010": "Application Window Discovery",
    "T1217": "Browser Information Discovery", "T1580": "Cloud Infrastructure Discovery",
    "T1538": "Cloud Service Dashboard", "T1526": "Cloud Service Discovery",
    "T1619": "Cloud Storage Object Discovery", "T1613": "Container and Resource Discovery",
    "T1482": "Domain Trust Discovery", "T1083": "File and Directory Discovery",
    "T1615": "Group Policy Discovery", "T1654": "Log Enumeration",
    "T1046": "Network Service Discovery", "T1135": "Network Share Discovery",
    "T1040": "Network Sniffing", "T1201": "Password Policy Discovery",
    "T1120": "Peripheral Device Discovery", "T1069": "Permission Groups Discovery",
    "T1057": "Process Discovery", "T1012": "Query Registry",
    "T1018": "Remote System Discovery", "T1518": "Software Discovery",
    "T1082": "System Information Discovery", "T1614": "System Location Discovery",
    "T1016": "System Network Configuration Discovery", "T1049": "System Network Connections Discovery",
    "T1033": "System Owner/User Discovery", "T1007": "System Service Discovery",
    "T1124": "System Time Discovery", "T1497": "Virtualization/Sandbox Evasion",
    "T1557": "Adversary-in-the-Middle", "T1110": "Brute Force",
    "T1555": "Credentials from Password Stores", "T1212": "Exploitation for Credential Access",
    "T1187": "Forced Authentication", "T1606": "Forge Web Credentials",
    "T1056": "Input Capture", "T1556": "Modify Authentication Process",
    "T1111": "Multi-Factor Authentication Interception", "T1621": "Multi-Factor Authentication Request Generation",
    "T1040": "Network Sniffing", "T1003": "OS Credential Dumping",
    "T1528": "Steal Application Access Token", "T1539": "Steal Web Session Cookie",
    "T1558": "Steal or Forge Kerberos Tickets", "T1552": "Unsecured Credentials",
    "T1071": "Application Layer Protocol", "T1092": "Communication Through Removable Media",
    "T1132": "Data Encoding", "T1001": "Data Obfuscation",
    "T1568": "Dynamic Resolution", "T1573": "Encrypted Channel",
    "T1008": "Fallback Channels", "T1105": "Ingress Tool Transfer",
    "T1104": "Multi-Stage Channels", "T1095": "Non-Application Layer Protocol",
    "T1571": "Non-Standard Port", "T1572": "Protocol Tunneling",
    "T1090": "Proxy", "T1219": "Remote Access Software",
    "T1205": "Traffic Signaling", "T1102": "Web Service",
    "T1020": "Automated Exfiltration", "T1030": "Data Transfer Size Limits",
    "T1048": "Exfiltration Over Alternative Protocol", "T1041": "Exfiltration Over C2 Channel",
    "T1011": "Exfiltration Over Other Network Medium", "T1052": "Exfiltration Over Physical Medium",
    "T1567": "Exfiltration Over Web Service", "T1029": "Scheduled Transfer",
    "T1537": "Transfer Data to Cloud Account",
    "T1531": "Account Access Removal", "T1485": "Data Destruction",
    "T1486": "Data Encrypted for Impact", "T1565": "Data Manipulation",
    "T1491": "Defacement", "T1561": "Disk Wipe",
    "T1499": "Endpoint Denial of Service", "T1495": "Firmware Corruption",
    "T1490": "Inhibit System Recovery", "T1498": "Network Denial of Service",
    "T1496": "Resource Hijacking", "T1489": "Service Stop",
    "T1529": "System Shutdown/Reboot",
    "T1583": "Acquire Infrastructure", "T1586": "Compromise Accounts",
    "T1584": "Compromise Infrastructure", "T1587": "Develop Capabilities",
    "T1585": "Establish Accounts", "T1588": "Obtain Capabilities",
    "T1591": "Gather Victim Org Information", "T1589": "Gather Victim Identity Information",
    "T1590": "Gather Victim Network Information", "T1592": "Gather Victim Host Information",
    "T1593": "Search Open Websites/Domains", "T1594": "Search Victim-Owned Websites",
    "T1596": "Search Open Technical Databases", "T1597": "Search Closed Sources",
    "T1598": "Phishing for Information",
}

TACTIC_MAP = {
    "reconnaissance": "Reconnaissance",
    "resource-development": "Resource Development",
    "initial-access": "Initial Access",
    "execution": "Execution",
    "persistence": "Persistence",
    "privilege-escalation": "Privilege Escalation",
    "defense-evasion": "Defense Evasion",
    "credential-access": "Credential Access",
    "discovery": "Discovery",
    "lateral-movement": "Lateral Movement",
    "collection": "Collection",
    "command-and-control": "Command and Control",
    "exfiltration": "Exfiltration",
    "impact": "Impact",
}


@app.get("/mitre/{engagement_id}/techniques")
async def list_techniques(engagement_id: uuid.UUID, db: AsyncSession = Depends(get_db), current_user: User = Depends(get_current_user)):
    result = await db.execute(select(MitreTechnique).where(MitreTechnique.engagement_id == engagement_id).order_by(MitreTechnique.tactic, MitreTechnique.technique_id))
    return [_tech_out(t) for t in result.scalars().all()]


@app.post("/mitre/{engagement_id}/import")
async def import_navigator_layer(engagement_id: uuid.UUID, body: dict, db: AsyncSession = Depends(get_db), current_user: User = Depends(require_tester_or_above)):
    """Import a MITRE ATT&CK Navigator layer JSON."""
    techniques = body.get("techniques", [])
    if not techniques:
        raise HTTPException(400, "No techniques found in layer. Make sure you exported a valid Navigator layer.")

    # Delete existing techniques for this engagement
    existing = await db.execute(select(MitreTechnique).where(MitreTechnique.engagement_id == engagement_id))
    for t in existing.scalars().all():
        await db.delete(t)

    count = 0
    for tech in techniques:
        tech_id = tech.get("techniqueID", "")
        if not tech_id:
            continue

        # Get tactic
        tactic_slug = tech.get("tactic", "")
        tactic = TACTIC_MAP.get(tactic_slug, tactic_slug.replace("-", " ").title() if tactic_slug else "Unknown")

        # Navigator doesn't include names — use a lookup table or fall back to ID
        name = tech.get("name") or TECHNIQUE_NAMES.get(tech_id, tech_id)

        # Get status from metadata
        status = "Not Started"
        assignee = None
        for meta in tech.get("metadata", []):
            if meta.get("name") == "status":
                status = meta.get("value", "Not Started")
            if meta.get("name") == "assignee":
                assignee = meta.get("value")

        t = MitreTechnique(
            engagement_id=engagement_id,
            technique_id=tech_id,
            name=name,
            tactic=tactic,
            status=status,
            assignee=assignee,
            notes=tech.get("comment", ""),
            color=tech.get("color", ""),
            navigator_data=tech,
        )
        db.add(t)
        count += 1

    await db.flush()
    return {"count": count, "message": f"Imported {count} techniques"}


@app.patch("/mitre/techniques/{technique_id}")
async def update_technique(technique_id: uuid.UUID, body: dict, db: AsyncSession = Depends(get_db), current_user: User = Depends(require_tester_or_above)):
    result = await db.execute(select(MitreTechnique).where(MitreTechnique.id == technique_id))
    tech = result.scalar_one_or_none()
    if not tech:
        raise HTTPException(404, "Technique not found")
    for k, v in body.items():
        if hasattr(tech, k):
            setattr(tech, k, v)
    return _tech_out(tech)


@app.delete("/mitre/{engagement_id}/techniques", status_code=204)
async def clear_techniques(engagement_id: uuid.UUID, db: AsyncSession = Depends(get_db), current_user: User = Depends(require_tester_or_above)):
    result = await db.execute(select(MitreTechnique).where(MitreTechnique.engagement_id == engagement_id))
    for t in result.scalars().all():
        await db.delete(t)


def _tech_out(t):
    return {
        "id": str(t.id),
        "engagement_id": str(t.engagement_id),
        "technique_id": t.technique_id,
        "name": t.name,
        "tactic": t.tactic,
        "status": t.status,
        "assignee": t.assignee,
        "notes": t.notes,
        "color": t.color,
        "created_at": str(t.created_at),
        "updated_at": str(t.updated_at),
    }


# ─── Tasks ───────────────────────────────────────────────────────────────────

@app.get("/tasks/{engagement_id}")
async def list_tasks(engagement_id: uuid.UUID, db: AsyncSession = Depends(get_db), current_user: User = Depends(get_current_user)):
    result = await db.execute(select(EngagementTask).where(EngagementTask.engagement_id == engagement_id).order_by(EngagementTask.created_at))
    return [_task_out(t) for t in result.scalars().all()]


@app.post("/tasks/{engagement_id}", status_code=201)
async def create_task(engagement_id: uuid.UUID, body: dict, db: AsyncSession = Depends(get_db), current_user: User = Depends(require_tester_or_above)):
    due = None
    if body.get("due_date"):
        try:
            due = datetime.fromisoformat(body["due_date"])
        except ValueError:
            pass
    task = EngagementTask(
        engagement_id=engagement_id,
        title=body["title"],
        description=body.get("description"),
        notes=body.get("notes"),
        status=body.get("status", "Todo"),
        priority=body.get("priority", "Medium"),
        assignee=body.get("assignee"),
        due_date=due,
        created_by_id=current_user.id,
    )
    db.add(task)
    await db.flush()
    return _task_out(task)


@app.patch("/tasks/task/{task_id}")
async def update_task(task_id: uuid.UUID, body: dict, db: AsyncSession = Depends(get_db), current_user: User = Depends(require_tester_or_above)):
    result = await db.execute(select(EngagementTask).where(EngagementTask.id == task_id))
    task = result.scalar_one_or_none()
    if not task:
        raise HTTPException(404, "Task not found")
    for k, v in body.items():
        if k == "due_date":
            if v:
                try:
                    task.due_date = datetime.fromisoformat(v)
                except ValueError:
                    pass
            else:
                task.due_date = None
        elif hasattr(task, k):
            setattr(task, k, v)
    return _task_out(task)


@app.delete("/tasks/task/{task_id}", status_code=204)
async def delete_task(task_id: uuid.UUID, db: AsyncSession = Depends(get_db), current_user: User = Depends(require_tester_or_above)):
    result = await db.execute(select(EngagementTask).where(EngagementTask.id == task_id))
    task = result.scalar_one_or_none()
    if task:
        await db.delete(task)


def _task_out(t):
    return {
        "id": str(t.id),
        "engagement_id": str(t.engagement_id),
        "title": t.title,
        "description": t.description,
        "notes": t.notes,
        "status": t.status,
        "priority": t.priority,
        "assignee": t.assignee,
        "due_date": str(t.due_date) if t.due_date else None,
        "created_at": str(t.created_at),
        "updated_at": str(t.updated_at),
    }


# ─── Nmap XML Upload ─────────────────────────────────────────────────────────

@app.post("/recon/{engagement_id}/nmap-upload", status_code=201)
async def upload_nmap_xml(engagement_id: uuid.UUID, file: UploadFile = File(...), db: AsyncSession = Depends(get_db), current_user: User = Depends(require_tester_or_above)):
    """Parse and import an Nmap XML scan file into recon hosts."""
    import xml.etree.ElementTree as ET

    content_bytes = await file.read()
    try:
        root = ET.fromstring(content_bytes.decode("utf-8", errors="ignore"))
    except ET.ParseError as e:
        raise HTTPException(400, f"Invalid XML: {e}")

    added = 0
    skipped = 0

    for host_el in root.findall("host"):
        # Only up hosts
        status_el = host_el.find("status")
        if status_el is None or status_el.get("state") != "up":
            skipped += 1
            continue

        # IP address
        ip = None
        for addr_el in host_el.findall("address"):
            if addr_el.get("addrtype") == "ipv4":
                ip = addr_el.get("addr")
                break
        if not ip:
            skipped += 1
            continue

        # Hostname
        hostname = None
        hostnames_el = host_el.find("hostnames")
        if hostnames_el is not None:
            hn = hostnames_el.find("hostname")
            if hn is not None:
                hostname = hn.get("name")

        # OS
        os_name = None
        os_el = host_el.find("os")
        if os_el is not None:
            matches = os_el.findall("osmatch")
            if matches:
                os_name = matches[0].get("name")

        # Ports and services
        ports = []
        services = []
        ports_el = host_el.find("ports")
        if ports_el is not None:
            for port_el in ports_el.findall("port"):
                state_el = port_el.find("state")
                if state_el is None or state_el.get("state") != "open":
                    continue
                port_num = int(port_el.get("portid", 0))
                protocol = port_el.get("protocol", "tcp")
                ports.append(port_num)
                svc = {"port": port_num, "protocol": protocol, "state": "open", "service": "", "banner": ""}
                svc_el = port_el.find("service")
                if svc_el is not None:
                    svc["service"] = svc_el.get("name", "")
                    product = svc_el.get("product", "")
                    version = svc_el.get("version", "")
                    svc["banner"] = f"{product} {version}".strip()
                services.append(svc)

        # Check if host already exists
        existing = await db.execute(
            select(ReconHost).where(
                ReconHost.engagement_id == engagement_id,
                ReconHost.ip_address == ip
            )
        )
        existing_host = existing.scalar_one_or_none()

        if existing_host:
            # Update existing host with new port data
            existing_host.ports = ports
            existing_host.services = services
            if hostname and not existing_host.hostname:
                existing_host.hostname = hostname
            if os_name and not existing_host.os:
                existing_host.os = os_name
        else:
            host = ReconHost(
                engagement_id=engagement_id,
                ip_address=ip,
                hostname=hostname,
                os=os_name,
                ports=ports,
                services=services,
                status="up",
                source="nmap",
            )
            db.add(host)
            added += 1

    await db.flush()
    return {"added": added, "skipped": skipped, "message": f"Imported {added} new hosts, updated {len(root.findall('host')) - added - skipped} existing"}


# ─── Scanner Import ───────────────────────────────────────────────────────────

@app.post("/recon/{engagement_id}/scan-import", status_code=201)
async def import_scan(
    engagement_id: uuid.UUID,
    scanner: str,
    file: UploadFile = File(...),
    import_findings: bool = True,
    min_severity: str = "Medium",
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_tester_or_above)
):
    """Import scan results from Nessus, OpenVAS, Qualys, Rapid7, PingCastle, or Burp."""
    from scanner_parsers import parse_scan

    content_bytes = await file.read()
    try:
        xml_content = content_bytes.decode("utf-8", errors="ignore")
        if scanner.lower() == "nmap":
            # Use existing nmap parser
            import xml.etree.ElementTree as ET
            root = ET.fromstring(xml_content)
            hosts_list = []
            for host_el in root.findall("host"):
                status_el = host_el.find("status")
                if status_el is None or status_el.get("state") != "up":
                    continue
                ip = None
                for addr_el in host_el.findall("address"):
                    if addr_el.get("addrtype") == "ipv4":
                        ip = addr_el.get("addr")
                        break
                if not ip:
                    continue
                hostname = None
                hostnames_el = host_el.find("hostnames")
                if hostnames_el is not None:
                    hn = hostnames_el.find("hostname")
                    if hn is not None:
                        hostname = hn.get("name")
                os_name = None
                os_el = host_el.find("os")
                if os_el is not None:
                    matches = os_el.findall("osmatch")
                    if matches:
                        os_name = matches[0].get("name")
                ports = []
                services = []
                ports_el = host_el.find("ports")
                if ports_el is not None:
                    for port_el in ports_el.findall("port"):
                        state_el = port_el.find("state")
                        if state_el is None or state_el.get("state") != "open":
                            continue
                        port_num = int(port_el.get("portid", 0))
                        protocol = port_el.get("protocol", "tcp")
                        ports.append(port_num)
                        svc = {"port": port_num, "protocol": protocol, "state": "open", "service": "", "banner": ""}
                        svc_el = port_el.find("service")
                        if svc_el is not None:
                            svc["service"] = svc_el.get("name", "")
                            product = svc_el.get("product", "")
                            version = svc_el.get("version", "")
                            svc["banner"] = f"{product} {version}".strip()
                        services.append(svc)
                hosts_list.append({"ip_address": ip, "hostname": hostname, "os": os_name, "ports": ports, "services": services, "source": "nmap"})
            result = {"hosts": hosts_list, "findings": []}
        else:
            result = parse_scan(scanner, xml_content)
    except ValueError as e:
        raise HTTPException(400, str(e))
    except Exception as e:
        raise HTTPException(400, f"Failed to parse {scanner} file: {e}")

    hosts_added = 0
    hosts_updated = 0
    findings_added = 0

    sev_order = {"Critical": 0, "High": 1, "Medium": 2, "Low": 3, "Info": 4}
    min_sev_idx = sev_order.get(min_severity, 2)

    # Import hosts
    for h in result.get("hosts", []):
        ip = h.get("ip_address")
        if not ip:
            continue
        existing = (await db.execute(
            select(ReconHost).where(ReconHost.engagement_id == engagement_id, ReconHost.ip_address == ip)
        )).scalar_one_or_none()

        if existing:
            if h.get("ports"):
                existing.ports = list(set((existing.ports or []) + h["ports"]))
            if h.get("hostname") and not existing.hostname:
                existing.hostname = h["hostname"]
            if h.get("os") and not existing.os:
                existing.os = h["os"]
            hosts_updated += 1
        else:
            host = ReconHost(
                engagement_id=engagement_id,
                ip_address=ip,
                hostname=h.get("hostname"),
                os=h.get("os"),
                ports=h.get("ports", []),
                services=h.get("services", []),
                status="up",
                source=h.get("source", scanner),
            )
            db.add(host)
            hosts_added += 1

    # Import findings
    if import_findings:
        finding_count = await db.scalar(select(func.count(Finding.id))) or 0
        for f in result.get("findings", []):
            sev = f.get("severity", "Info")
            if sev_order.get(sev, 4) > min_sev_idx:
                continue
            finding_count += 1
            finding = Finding(
                ref_id=f"F-{str(finding_count).zfill(3)}",
                engagement_id=engagement_id,
                tester_id=current_user.id,
                title=f.get("title", "Untitled"),
                severity=sev,
                cvss_score=f.get("cvss_score"),
                cve=f.get("cve"),
                cwe=f.get("cwe"),
                affected_component=f.get("affected_component"),
                description=f.get("description"),
                remediation=f.get("remediation"),
                source=f.get("source", scanner),
                tags=f.get("tags", [scanner]),
            )
            db.add(finding)
            findings_added += 1

    await db.flush()
    return {
        "hosts_added": hosts_added,
        "hosts_updated": hosts_updated,
        "findings_added": findings_added,
        "message": f"{scanner.title()} import complete: {hosts_added} new hosts, {hosts_updated} updated, {findings_added} findings created"
    }


# ─── Integrations ─────────────────────────────────────────────────────────────

async def _get_integration(name: str, db: AsyncSession) -> Optional[Integration]:
    result = await db.execute(select(Integration).where(Integration.name == name))
    return result.scalar_one_or_none()


async def _get_slack_config(db: AsyncSession) -> tuple[str, str]:
    """Returns (webhook_url, base_url)"""
    integ = await _get_integration("slack", db)
    if not integ or not integ.enabled or not integ.config:
        return "", ""
    return integ.config.get("webhook_url", ""), integ.config.get("base_url", "")


@app.get("/integrations/")
async def list_integrations(db: AsyncSession = Depends(get_db), current_user: User = Depends(require_lead_or_admin)):
    result = await db.execute(select(Integration))
    integrations = result.scalars().all()
    return [{"id": str(i.id), "name": i.name, "enabled": i.enabled, "config": i.config, "updated_at": str(i.updated_at)} for i in integrations]


@app.put("/integrations/{name}")
async def save_integration(name: str, body: dict, db: AsyncSession = Depends(get_db), current_user: User = Depends(require_lead_or_admin)):
    integ = await _get_integration(name, db)
    if integ:
        integ.enabled = body.get("enabled", integ.enabled)
        integ.config = body.get("config", integ.config)
    else:
        integ = Integration(name=name, enabled=body.get("enabled", False), config=body.get("config", {}))
        db.add(integ)
    await db.flush()
    return {"name": integ.name, "enabled": integ.enabled, "config": integ.config}


@app.post("/integrations/slack/test")
async def test_slack(db: AsyncSession = Depends(get_db), current_user: User = Depends(require_lead_or_admin)):
    from slack_service import send_slack_message
    webhook_url, base_url = await _get_slack_config(db)
    if not webhook_url:
        raise HTTPException(400, "Slack webhook URL not configured")
    success = await send_slack_message(webhook_url, {
        "text": f"✅ RedTrack Slack integration is working! Connected from {base_url or 'RedTrack'}"
    })
    if success:
        return {"message": "Test message sent successfully"}
    raise HTTPException(500, "Failed to send test message — check your webhook URL")


@app.post("/integrations/slack/digest")
async def send_digest(db: AsyncSession = Depends(get_db), current_user: User = Depends(require_lead_or_admin)):
    from slack_service import send_daily_digest
    webhook_url, base_url = await _get_slack_config(db)
    if not webhook_url:
        raise HTTPException(400, "Slack not configured")
    engs = (await db.execute(select(Engagement))).scalars().all()
    findings = (await db.execute(select(Finding))).scalars().all()
    success = await send_daily_digest(webhook_url, base_url, engs, findings)
    if success:
        return {"message": "Daily digest sent"}
    raise HTTPException(500, "Failed to send digest")


@app.post("/integrations/slack/commands")
async def slack_slash_command(request: Request, db: AsyncSession = Depends(get_db)):
    """Handle Slack slash commands."""
    from slack_service import handle_slash_command
    from fastapi import Request

    # Parse form data from Slack
    form = await request.form()
    command = form.get("command", "/redtrack")
    text = form.get("text", "")
    token = form.get("token", "")

    # Verify Slack signing secret
    integ = await _get_integration("slack", db)
    if integ and integ.config:
        signing_secret = integ.config.get("signing_secret", "")
        if signing_secret:
            timestamp = request.headers.get("X-Slack-Request-Timestamp", "")
            slack_signature = request.headers.get("X-Slack-Signature", "")
            body = await request.body()
            sig_basestring = f"v0:{timestamp}:{body.decode()}"
            my_signature = "v0=" + hmac.new(
                signing_secret.encode(), sig_basestring.encode(), hashlib.sha256
            ).hexdigest()
            if not hmac.compare_digest(my_signature, slack_signature):
                raise HTTPException(401, "Invalid Slack signature")

    _, base_url = await _get_slack_config(db)
    engs = (await db.execute(select(Engagement))).scalars().all()
    findings = (await db.execute(select(Finding))).scalars().all()

    response = await handle_slash_command(command, text, engs, findings, base_url)
    return response


# ─── Task Library ─────────────────────────────────────────────────────────────

@app.get("/task-library/")
async def list_task_templates(
    search: Optional[str] = None,
    category: Optional[str] = None,
    engagement_type: Optional[str] = None,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    q = select(TaskTemplate).order_by(TaskTemplate.category, TaskTemplate.title)
    if search:
        q = q.where(TaskTemplate.title.ilike(f"%{search}%") | TaskTemplate.description.ilike(f"%{search}%"))
    if category:
        q = q.where(TaskTemplate.category == category)
    result = await db.execute(q)
    templates = result.scalars().all()
    if engagement_type:
        templates = [t for t in templates if not t.engagement_types or engagement_type in (t.engagement_types or [])]
    return [_task_template_out(t) for t in templates]


@app.post("/task-library/", status_code=201)
async def create_task_template(body: dict, db: AsyncSession = Depends(get_db), current_user: User = Depends(require_tester_or_above)):
    template = TaskTemplate(
        title=body["title"],
        description=body.get("description"),
        category=body.get("category", "Custom"),
        priority=body.get("priority", "Medium"),
        tools=body.get("tools"),
        references=body.get("references"),
        engagement_types=body.get("engagement_types", []),
        tags=body.get("tags", []),
    )
    db.add(template)
    await db.flush()
    return _task_template_out(template)


@app.post("/task-library/{template_id}/import/{engagement_id}", status_code=201)
async def import_task_template(
    template_id: uuid.UUID,
    engagement_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_tester_or_above)
):
    t = (await db.execute(select(TaskTemplate).where(TaskTemplate.id == template_id))).scalar_one_or_none()
    if not t:
        raise HTTPException(404, "Template not found")
    task = EngagementTask(
        engagement_id=engagement_id,
        title=t.title,
        description=f"{t.description or ''}\n\n**Tools:**\n{t.tools or ''}".strip(),
        status="Todo",
        priority=t.priority,
        created_by_id=current_user.id,
    )
    db.add(task)
    await db.flush()
    return _task_out(task)


@app.delete("/task-library/{template_id}", status_code=204)
async def delete_task_template(template_id: uuid.UUID, db: AsyncSession = Depends(get_db), current_user: User = Depends(require_lead_or_admin)):
    t = (await db.execute(select(TaskTemplate).where(TaskTemplate.id == template_id))).scalar_one_or_none()
    if t:
        await db.delete(t)


@app.post("/task-library/ai-generate", status_code=201)
async def ai_generate_task(body: dict, db: AsyncSession = Depends(get_db), current_user: User = Depends(require_tester_or_above)):
    """Use AI to generate a task template."""
    import json
    prompt = f"""Generate a penetration testing task template for: "{body.get('prompt', '')}"

Respond ONLY with a JSON object (no markdown):
{{
  "title": "task name",
  "category": "one of: Recon & OSINT, Web Application, Network & Internal, Cloud Security, AI Red Team, Reporting, Custom",
  "priority": "Critical|High|Medium|Low",
  "description": "what needs to be done and why",
  "tools": "specific commands and tools to use",
  "references": "relevant links or standards",
  "tags": ["tag1", "tag2"],
  "engagement_types": ["Web App", "Network", etc]
}}"""

    try:
        import ai_service
        content = ai_service._get_ai_response(prompt, max_tokens=600)
        clean = content.replace("```json", "").replace("```", "").strip()
        parsed = json.loads(clean)
        template = TaskTemplate(**{k: v for k, v in parsed.items() if hasattr(TaskTemplate, k)})
        db.add(template)
        await db.flush()
        return _task_template_out(template)
    except Exception as e:
        raise HTTPException(500, f"AI generation failed: {e}")


def _task_template_out(t):
    return {
        "id": str(t.id), "title": t.title, "description": t.description,
        "category": t.category, "priority": t.priority, "tools": t.tools,
        "references": t.references, "engagement_types": t.engagement_types,
        "tags": t.tags, "created_at": str(t.created_at),
    }

# ─── WebSocket ────────────────────────────────────────────────────────────────

class ConnectionManager:
    def __init__(self):
        self.rooms: dict[str, list[WebSocket]] = {}

    async def connect(self, ws: WebSocket, room: str):
        await ws.accept()
        self.rooms.setdefault(room, []).append(ws)

    def disconnect(self, ws: WebSocket, room: str):
        if room in self.rooms:
            try:
                self.rooms[room].remove(ws)
            except ValueError:
                pass

    async def broadcast(self, message: dict, room: str, sender: WebSocket = None):
        for ws in self.rooms.get(room, []):
            if ws != sender:
                try:
                    await ws.send_json(message)
                except Exception:
                    pass


manager = ConnectionManager()


@app.websocket("/ws/{engagement_id}")
async def websocket_endpoint(websocket: WebSocket, engagement_id: str):
    await manager.connect(websocket, engagement_id)
    await websocket.send_json({"type": "connected", "payload": {"engagement_id": engagement_id}})
    try:
        while True:
            data = await websocket.receive_json()
            await manager.broadcast(data, engagement_id, sender=websocket)
    except WebSocketDisconnect:
        manager.disconnect(websocket, engagement_id)
# Add these routes to main.py — Team Management

@app.get("/engagements/{engagement_id}/members")
async def list_members(engagement_id: uuid.UUID, db: AsyncSession = Depends(get_db), current_user: User = Depends(get_current_user)):
    result = await db.execute(
        select(EngagementMember, User)
        .join(User, EngagementMember.user_id == User.id)
        .where(EngagementMember.engagement_id == engagement_id)
    )
    rows = result.all()
    members = []
    for member, user in rows:
        # Count findings by this user in this engagement
        finding_count = await db.scalar(
            select(func.count(Finding.id)).where(
                Finding.engagement_id == engagement_id,
                Finding.tester_id == user.id
            )
        ) or 0
        members.append({
            "user_id": str(user.id),
            "username": user.username,
            "full_name": user.full_name,
            "email": user.email,
            "role": member.role,
            "finding_count": finding_count,
            "joined_at": str(member.joined_at) if hasattr(member, 'joined_at') and member.joined_at else None,
        })
    return members


@app.post("/engagements/{engagement_id}/members", status_code=201)
async def add_member(engagement_id: uuid.UUID, body: dict, db: AsyncSession = Depends(get_db), current_user: User = Depends(require_lead_or_admin)):
    user_id = uuid.UUID(body["user_id"])
    # Check not already a member
    existing = await db.execute(
        select(EngagementMember).where(
            EngagementMember.engagement_id == engagement_id,
            EngagementMember.user_id == user_id
        )
    )
    if existing.scalar_one_or_none():
        raise HTTPException(400, "User is already a member of this engagement")
    member = EngagementMember(
        engagement_id=engagement_id,
        user_id=user_id,
        role=body.get("role", "tester")
    )
    db.add(member)
    await db.flush()
    return {"message": "Member added"}


@app.patch("/engagements/{engagement_id}/members/{user_id}")
async def update_member_role(engagement_id: uuid.UUID, user_id: uuid.UUID, body: dict, db: AsyncSession = Depends(get_db), current_user: User = Depends(require_lead_or_admin)):
    result = await db.execute(
        select(EngagementMember).where(
            EngagementMember.engagement_id == engagement_id,
            EngagementMember.user_id == user_id
        )
    )
    member = result.scalar_one_or_none()
    if not member:
        raise HTTPException(404, "Member not found")
    member.role = body.get("role", member.role)
    return {"message": "Role updated"}


@app.delete("/engagements/{engagement_id}/members/{user_id}", status_code=204)
async def remove_member(engagement_id: uuid.UUID, user_id: uuid.UUID, db: AsyncSession = Depends(get_db), current_user: User = Depends(require_lead_or_admin)):
    result = await db.execute(
        select(EngagementMember).where(
            EngagementMember.engagement_id == engagement_id,
            EngagementMember.user_id == user_id
        )
    )
    member = result.scalar_one_or_none()
    if member:
        await db.delete(member)
# ─── Jump Box Routes (add to main.py) ────────────────────────────────────────

@app.get("/jumpboxes/")
async def list_jumpboxes(db: AsyncSession = Depends(get_db), current_user: User = Depends(get_current_user)):
    result = await db.execute(select(JumpBox).order_by(JumpBox.name))
    boxes = result.scalars().all()
    return [await _jumpbox_out(box, db) for box in boxes]


@app.post("/jumpboxes/", status_code=201)
async def create_jumpbox(body: dict, db: AsyncSession = Depends(get_db), current_user: User = Depends(require_lead_or_admin)):
    box = JumpBox(
        name=body["name"],
        hostname=body.get("hostname"),
        ip_address=body.get("ip_address"),
        os=body.get("os", "Kali Linux"),
        location=body.get("location", "Internal"),
        purpose=body.get("purpose"),
        notes=body.get("notes"),
        auto_release_hours=body.get("auto_release_hours", 8),
    )
    db.add(box)
    await db.flush()
    return await _jumpbox_out(box, db)


@app.patch("/jumpboxes/{box_id}")
async def update_jumpbox(box_id: uuid.UUID, body: dict, db: AsyncSession = Depends(get_db), current_user: User = Depends(require_lead_or_admin)):
    result = await db.execute(select(JumpBox).where(JumpBox.id == box_id))
    box = result.scalar_one_or_none()
    if not box:
        raise HTTPException(404, "Jump box not found")
    for k, v in body.items():
        if hasattr(box, k) and k not in ['id', 'created_at']:
            setattr(box, k, v)
    return await _jumpbox_out(box, db)


@app.delete("/jumpboxes/{box_id}", status_code=204)
async def delete_jumpbox(box_id: uuid.UUID, db: AsyncSession = Depends(get_db), current_user: User = Depends(require_lead_or_admin)):
    result = await db.execute(select(JumpBox).where(JumpBox.id == box_id))
    box = result.scalar_one_or_none()
    if box:
        await db.delete(box)


@app.post("/jumpboxes/{box_id}/checkout")
async def checkout_jumpbox(box_id: uuid.UUID, body: dict, db: AsyncSession = Depends(get_db), current_user: User = Depends(require_tester_or_above)):
    result = await db.execute(select(JumpBox).where(JumpBox.id == box_id))
    box = result.scalar_one_or_none()
    if not box:
        raise HTTPException(404, "Jump box not found")
    if box.status == "checked_out":
        raise HTTPException(400, f"Jump box is already checked out")
    box.status = "checked_out"
    box.checked_out_by_id = current_user.id
    box.checked_out_at = datetime.now(timezone.utc)
    box.checkout_notes = body.get("notes")
    if body.get("engagement_id"):
        box.checked_out_engagement_id = uuid.UUID(body["engagement_id"])
    # Slack notification
    try:
        from slack_service import send_slack_message
        integ = await _get_integration("slack", db)
        if integ and integ.enabled and integ.config.get("webhook_url"):
            base_url = integ.config.get("base_url", "")
            await send_slack_message(integ.config["webhook_url"], {
                "text": f"🖥 *{box.name}* checked out by @{current_user.username}" + (f" for engagement" if body.get("engagement_id") else "")
            })
    except Exception:
        pass
    return await _jumpbox_out(box, db)


@app.post("/jumpboxes/{box_id}/checkin")
async def checkin_jumpbox(box_id: uuid.UUID, db: AsyncSession = Depends(get_db), current_user: User = Depends(require_tester_or_above)):
    result = await db.execute(select(JumpBox).where(JumpBox.id == box_id))
    box = result.scalar_one_or_none()
    if not box:
        raise HTTPException(404, "Jump box not found")
    box.status = "available"
    box.checked_out_by_id = None
    box.checked_out_at = None
    box.checkout_notes = None
    box.checked_out_engagement_id = None
    # Slack notification
    try:
        from slack_service import send_slack_message
        integ = await _get_integration("slack", db)
        if integ and integ.enabled and integ.config.get("webhook_url"):
            await send_slack_message(integ.config["webhook_url"], {
                "text": f"🖥 *{box.name}* checked in by @{current_user.username} — now available"
            })
    except Exception:
        pass
    return await _jumpbox_out(box, db)


async def _jumpbox_out(box, db):
    checked_out_by_username = None
    if box.checked_out_by_id:
        user = (await db.execute(select(User).where(User.id == box.checked_out_by_id))).scalar_one_or_none()
        if user:
            checked_out_by_username = user.username
    checked_out_engagement = None
    if box.checked_out_engagement_id:
        eng = (await db.execute(select(Engagement).where(Engagement.id == box.checked_out_engagement_id))).scalar_one_or_none()
        if eng:
            checked_out_engagement = f"{eng.ref_id} — {eng.client}"
    return {
        "id": str(box.id),
        "name": box.name,
        "hostname": box.hostname,
        "ip_address": box.ip_address,
        "os": box.os,
        "location": box.location,
        "purpose": box.purpose,
        "notes": box.notes,
        "status": box.status,
        "checked_out_by_username": checked_out_by_username,
        "checked_out_engagement_id": str(box.checked_out_engagement_id) if box.checked_out_engagement_id else None,
        "checked_out_engagement": checked_out_engagement,
        "checked_out_at": str(box.checked_out_at) if box.checked_out_at else None,
        "checkout_notes": box.checkout_notes,
        "auto_release_hours": box.auto_release_hours,
    }
