import uuid
from datetime import datetime, timezone
from typing import Optional
from sqlalchemy import String, Text, Float, Integer, ForeignKey, DateTime, Enum, Boolean, JSON
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.dialects.postgresql import UUID
from database import Base
import enum


def utcnow():
    return datetime.now(timezone.utc)


# ─── Enums ────────────────────────────────────────────────────────────────────

class UserRole(str, enum.Enum):
    admin = "admin"
    lead = "lead"
    tester = "tester"
    client = "client"


class EngagementType(str, enum.Enum):
    web_app = "Web App"
    network = "Network"
    red_team = "Red Team"
    cloud = "Cloud"
    social_engineering = "Social Engineering"
    mobile = "Mobile"
    physical = "Physical"
    ai_red_team = "AI Red Team"


class EngagementStatus(str, enum.Enum):
    planning = "Planning"
    active = "Active"
    completed = "Completed"
    archived = "Archived"


class Severity(str, enum.Enum):
    critical = "Critical"
    high = "High"
    medium = "Medium"
    low = "Low"
    info = "Info"


class FindingStatus(str, enum.Enum):
    open = "Open"
    in_review = "In Review"
    remediated = "Remediated"
    accepted = "Accepted"
    false_positive = "False Positive"


class MitrePhaseStatus(str, enum.Enum):
    not_started = "Not Started"
    in_progress = "In Progress"
    completed = "Completed"
    not_applicable = "N/A"


# ─── Models ───────────────────────────────────────────────────────────────────

class User(Base):
    __tablename__ = "users"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    email: Mapped[str] = mapped_column(String(255), unique=True, nullable=False, index=True)
    username: Mapped[str] = mapped_column(String(100), unique=True, nullable=False)
    full_name: Mapped[str] = mapped_column(String(255), nullable=False)
    hashed_password: Mapped[str] = mapped_column(String(255), nullable=False)
    role: Mapped[UserRole] = mapped_column(Enum(UserRole), default=UserRole.tester)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    avatar_url: Mapped[Optional[str]] = mapped_column(String(500), nullable=True)
    api_key: Mapped[Optional[str]] = mapped_column(String(64), nullable=True, unique=True, index=True)
    theme: Mapped[str] = mapped_column(String(10), default="dark")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    last_login: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)

    findings: Mapped[list["Finding"]] = relationship("Finding", back_populates="tester_user", foreign_keys="Finding.tester_id")
    engagements: Mapped[list["EngagementMember"]] = relationship("EngagementMember", back_populates="user")


class Engagement(Base):
    __tablename__ = "engagements"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    ref_id: Mapped[str] = mapped_column(String(20), unique=True, nullable=False)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    client: Mapped[str] = mapped_column(String(255), nullable=False)
    type: Mapped[EngagementType] = mapped_column(Enum(EngagementType), nullable=False)
    status: Mapped[EngagementStatus] = mapped_column(Enum(EngagementStatus), default=EngagementStatus.planning)

    # Scope & objectives
    scope: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    out_of_scope: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    objectives: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    rules_of_engagement: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    methodology: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)

    # Recon data (stored as JSON)
    recon_hosts: Mapped[Optional[list]] = mapped_column(JSON, nullable=True, default=list)
    recon_notes: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

    # Notes & timeline
    notes: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

    # Client info
    client_contact: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    client_email: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)

    # Dates
    start_date: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    end_date: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, onupdate=utcnow)

    findings: Mapped[list["Finding"]] = relationship("Finding", back_populates="engagement", cascade="all, delete-orphan")
    members: Mapped[list["EngagementMember"]] = relationship("EngagementMember", back_populates="engagement", cascade="all, delete-orphan")
    reports: Mapped[list["Report"]] = relationship("Report", back_populates="engagement", cascade="all, delete-orphan")
    mitre_phases: Mapped[list["MitrePhase"]] = relationship("MitrePhase", back_populates="engagement", cascade="all, delete-orphan")


class EngagementMember(Base):
    __tablename__ = "engagement_members"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    engagement_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("engagements.id", ondelete="CASCADE"))
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    role: Mapped[str] = mapped_column(String(50), default="tester")
    joined_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)

    engagement: Mapped["Engagement"] = relationship("Engagement", back_populates="members")
    user: Mapped["User"] = relationship("User", back_populates="engagements")


class Finding(Base):
    __tablename__ = "findings"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    ref_id: Mapped[str] = mapped_column(String(20), nullable=False)
    engagement_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("engagements.id", ondelete="CASCADE"))
    tester_id: Mapped[Optional[uuid.UUID]] = mapped_column(ForeignKey("users.id"), nullable=True)

    title: Mapped[str] = mapped_column(String(500), nullable=False)
    severity: Mapped[Severity] = mapped_column(Enum(Severity), nullable=False)
    status: Mapped[FindingStatus] = mapped_column(Enum(FindingStatus), default=FindingStatus.open)

    cvss_score: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    cvss_vector: Mapped[Optional[str]] = mapped_column(String(200), nullable=True)
    cwe: Mapped[Optional[str]] = mapped_column(String(50), nullable=True)
    cve: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)
    affected_component: Mapped[Optional[str]] = mapped_column(String(500), nullable=True)

    description: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    impact: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    steps_to_reproduce: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    remediation: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    references: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    ai_analysis: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

    # AI Red Team specific
    mitre_atlas_ttp: Mapped[Optional[str]] = mapped_column(String(50), nullable=True)
    ai_phase: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)
    owasp_llm_risk: Mapped[Optional[str]] = mapped_column(String(20), nullable=True)

    tags: Mapped[Optional[list]] = mapped_column(JSON, nullable=True, default=list)
    source: Mapped[str] = mapped_column(String(50), default="manual")  # manual, cli, burp, nmap
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, onupdate=utcnow)

    engagement: Mapped["Engagement"] = relationship("Engagement", back_populates="findings")
    tester_user: Mapped[Optional["User"]] = relationship("User", back_populates="findings", foreign_keys=[tester_id])
    evidence: Mapped[list["Evidence"]] = relationship("Evidence", back_populates="finding", cascade="all, delete-orphan")
    comments: Mapped[list["Comment"]] = relationship("Comment", back_populates="finding", cascade="all, delete-orphan")


class MitrePhase(Base):
    """Tracks progress through MITRE ATT&CK / ATLAS phases per engagement."""
    __tablename__ = "mitre_phases"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    engagement_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("engagements.id", ondelete="CASCADE"))
    phase_id: Mapped[str] = mapped_column(String(50), nullable=False)  # e.g. "AML.TA0000" or "TA0001"
    phase_name: Mapped[str] = mapped_column(String(100), nullable=False)
    framework: Mapped[str] = mapped_column(String(20), nullable=False)  # "atlas" or "attck"
    status: Mapped[MitrePhaseStatus] = mapped_column(Enum(MitrePhaseStatus), default=MitrePhaseStatus.not_started)
    notes: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, onupdate=utcnow)

    engagement: Mapped["Engagement"] = relationship("Engagement", back_populates="mitre_phases")


class ReconHost(Base):
    """Hosts discovered during recon — populated by CLI/Nmap integration."""
    __tablename__ = "recon_hosts"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    engagement_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("engagements.id", ondelete="CASCADE"))
    ip_address: Mapped[str] = mapped_column(String(45), nullable=False)
    hostname: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    os: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    ports: Mapped[Optional[list]] = mapped_column(JSON, nullable=True, default=list)
    services: Mapped[Optional[list]] = mapped_column(JSON, nullable=True, default=list)
    status: Mapped[str] = mapped_column(String(20), default="up")
    notes: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    source: Mapped[str] = mapped_column(String(20), default="manual")  # manual, nmap, cli
    discovered_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class Evidence(Base):
    __tablename__ = "evidence"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    finding_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("findings.id", ondelete="CASCADE"))
    filename: Mapped[str] = mapped_column(String(500), nullable=False)
    original_name: Mapped[str] = mapped_column(String(500), nullable=False)
    mime_type: Mapped[str] = mapped_column(String(100), nullable=False)
    size_bytes: Mapped[int] = mapped_column(Integer, nullable=False)
    caption: Mapped[Optional[str]] = mapped_column(String(500), nullable=True)
    uploaded_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    uploader_id: Mapped[Optional[uuid.UUID]] = mapped_column(ForeignKey("users.id"), nullable=True)

    finding: Mapped["Finding"] = relationship("Finding", back_populates="evidence")


class Comment(Base):
    __tablename__ = "comments"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    finding_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("findings.id", ondelete="CASCADE"))
    author_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id"))
    body: Mapped[str] = mapped_column(Text, nullable=False)
    is_internal: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)

    finding: Mapped["Finding"] = relationship("Finding", back_populates="comments")


class Report(Base):
    __tablename__ = "reports"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    engagement_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("engagements.id", ondelete="CASCADE"))
    title: Mapped[str] = mapped_column(String(500), nullable=False)
    version: Mapped[str] = mapped_column(String(20), default="1.0")
    executive_summary: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    methodology_section: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    conclusion: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    file_path: Mapped[Optional[str]] = mapped_column(String(500), nullable=True)
    generated_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    created_by_id: Mapped[Optional[uuid.UUID]] = mapped_column(ForeignKey("users.id"), nullable=True)

    engagement: Mapped["Engagement"] = relationship("Engagement", back_populates="reports")



class MitreTechnique(Base):
    """Individual ATT&CK technique imported from Navigator layer."""
    __tablename__ = "mitre_techniques"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    engagement_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("engagements.id", ondelete="CASCADE"))
    technique_id: Mapped[str] = mapped_column(String(20), nullable=False)  # e.g. T1566
    name: Mapped[str] = mapped_column(String(500), nullable=False)
    tactic: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)
    status: Mapped[str] = mapped_column(String(20), default="Not Started")
    assignee: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)
    notes: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    color: Mapped[Optional[str]] = mapped_column(String(10), nullable=True)
    navigator_data: Mapped[Optional[dict]] = mapped_column(JSON, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, onupdate=utcnow)


class EngagementTask(Base):
    """Tasks assigned to team members per engagement."""
    __tablename__ = "engagement_tasks"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    engagement_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("engagements.id", ondelete="CASCADE"))
    title: Mapped[str] = mapped_column(String(500), nullable=False)
    description: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    notes: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    status: Mapped[str] = mapped_column(String(20), default="Todo")
    priority: Mapped[str] = mapped_column(String(20), default="Medium")
    assignee: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)
    due_date: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    created_by_id: Mapped[Optional[uuid.UUID]] = mapped_column(ForeignKey("users.id"), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, onupdate=utcnow)


class Integration(Base):
    """Platform integration settings (Slack, Jira, etc.)"""
    __tablename__ = "integrations"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    name: Mapped[str] = mapped_column(String(50), unique=True, nullable=False)  # slack, jira, email
    enabled: Mapped[bool] = mapped_column(Boolean, default=False)
    config: Mapped[Optional[dict]] = mapped_column(JSON, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, onupdate=utcnow)


class TaskTemplate(Base):
    """Reusable task templates for the Task Library."""
    __tablename__ = "task_templates"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    title: Mapped[str] = mapped_column(String(500), nullable=False, index=True)
    description: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    category: Mapped[str] = mapped_column(String(100), nullable=False)
    engagement_types: Mapped[Optional[list]] = mapped_column(JSON, nullable=True, default=list)
    priority: Mapped[str] = mapped_column(String(20), default="Medium")
    tools: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    references: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    tags: Mapped[Optional[list]] = mapped_column(JSON, nullable=True, default=list)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class JumpBox(Base):
    __tablename__ = "jumpboxes"
    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    hostname: Mapped[Optional[str]] = mapped_column(String(200), nullable=True)
    ip_address: Mapped[Optional[str]] = mapped_column(String(50), nullable=True)
    os: Mapped[str] = mapped_column(String(100), default="Kali Linux")
    location: Mapped[str] = mapped_column(String(100), default="Internal")
    purpose: Mapped[Optional[str]] = mapped_column(String(500), nullable=True)
    notes: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    status: Mapped[str] = mapped_column(String(20), default="available")
    checked_out_by_id: Mapped[Optional[uuid.UUID]] = mapped_column(ForeignKey("users.id"), nullable=True)
    checked_out_engagement_id: Mapped[Optional[uuid.UUID]] = mapped_column(ForeignKey("engagements.id"), nullable=True)
    checked_out_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    checkout_notes: Mapped[Optional[str]] = mapped_column(String(500), nullable=True)
    auto_release_hours: Mapped[int] = mapped_column(default=8)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)

class JumpBoxSession(Base):
    __tablename__ = "jumpbox_sessions"
    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    jumpbox_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("jumpboxes.id", ondelete="CASCADE"))
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id"))
    engagement_id: Mapped[Optional[uuid.UUID]] = mapped_column(ForeignKey("engagements.id"), nullable=True)
    started_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    ended_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    duration_seconds: Mapped[Optional[int]] = mapped_column(nullable=True)
    commands: Mapped[Optional[list]] = mapped_column(JSON, nullable=True, default=list)
    status: Mapped[str] = mapped_column(String(20), default="active")


class VulnTemplate(Base):
    __tablename__ = "vuln_templates"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    title: Mapped[str] = mapped_column(String(500), nullable=False, index=True)
    severity: Mapped[Severity] = mapped_column(Enum(Severity), nullable=False)
    cvss_score: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    cwe: Mapped[Optional[str]] = mapped_column(String(50), nullable=True)
    category: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)
    description: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    impact: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    remediation: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    references: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    tags: Mapped[Optional[list]] = mapped_column(JSON, nullable=True, default=list)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
