"""SQLAlchemy models and query helpers for Alethical."""

from __future__ import annotations

import enum
import uuid
from datetime import date, datetime
from typing import Optional

from sqlalchemy import (
    and_,
    Boolean,
    CheckConstraint,
    Date,
    DateTime,
    Enum as SQLEnum,
    ForeignKey,
    Index,
    Integer,
    MetaData,
    Numeric,
    String,
    Text,
    UniqueConstraint,
    case,
    func,
    select,
    text,
)
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import (
    DeclarativeBase,
    Mapped,
    mapped_column,
    relationship,
    selectinload,
)
from sqlalchemy.types import TypeDecorator

try:
    from pgvector.sqlalchemy import Vector
except Exception:  # noqa: BLE001

    class Vector(TypeDecorator):  # type: ignore[no-redef]
        impl = JSONB
        cache_ok = True


naming_convention = {
    "ix": "ix_%(column_0_label)s",
    "uq": "uq_%(table_name)s_%(column_0_N_name)s",
    "ck": "ck_%(table_name)s_%(constraint_name)s",
    "fk": "fk_%(table_name)s_%(column_0_name)s_%(referred_table_name)s",
    "pk": "pk_%(table_name)s",
}


class Base(DeclarativeBase):
    metadata = MetaData(naming_convention=naming_convention)


class TimestampMixin:
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
        nullable=False,
    )


class UUIDPrimaryKeyMixin:
    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )


class ChamberType(enum.Enum):
    house = "house"
    senate = "senate"
    joint = "joint"


class SessionType(enum.Enum):
    regular = "regular"
    special = "special"


class SponsorshipRole(enum.Enum):
    chief_author = "chief_author"
    co_author = "co_author"
    sponsor = "sponsor"


class VoteValue(enum.Enum):
    yes = "yes"
    no = "no"
    absent = "absent"
    excused = "excused"
    present = "present"
    abstain = "abstain"


class IngestionStatus(enum.Enum):
    queued = "queued"
    running = "running"
    succeeded = "succeeded"
    failed = "failed"
    cancelled = "cancelled"


class ArtifactType(enum.Enum):
    xml = "xml"
    html = "html"
    pdf = "pdf"
    json = "json"
    image = "image"
    other = "other"


class EnrichmentType(enum.Enum):
    bill_summary = "bill_summary"
    talking_points = "talking_points"
    benefits_concerns = "benefits_concerns"
    topic_classification = "topic_classification"
    stakeholder_extraction = "stakeholder_extraction"


class ChatRole(enum.Enum):
    system = "system"
    user = "user"
    assistant = "assistant"
    tool = "tool"


class NotificationChannel(enum.Enum):
    email = "email"
    push = "push"


class NotificationFrequency(enum.Enum):
    realtime = "realtime"
    daily_digest = "daily_digest"
    weekly_digest = "weekly_digest"
    disabled = "disabled"


class Jurisdiction(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "jurisdiction"

    slug: Mapped[str] = mapped_column(String(50), unique=True, nullable=False)
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    country_code: Mapped[str] = mapped_column(String(2), nullable=False, default="US")
    subdivision_code: Mapped[Optional[str]] = mapped_column(String(10))
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)

    chambers: Mapped[list["Chamber"]] = relationship(back_populates="jurisdiction")
    sessions: Mapped[list["LegislativeSession"]] = relationship(
        back_populates="jurisdiction"
    )
    districts: Mapped[list["District"]] = relationship(back_populates="jurisdiction")
    legislators: Mapped[list["Legislator"]] = relationship(
        back_populates="jurisdiction"
    )


class Chamber(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "chamber"

    jurisdiction_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("jurisdiction.id"), nullable=False
    )
    chamber_type: Mapped[ChamberType] = mapped_column(
        SQLEnum(ChamberType, name="chamber_type"), nullable=False
    )
    slug: Mapped[str] = mapped_column(String(50), nullable=False)
    name: Mapped[str] = mapped_column(String(100), nullable=False)
    short_name: Mapped[str] = mapped_column(String(20), nullable=False)
    display_order: Mapped[int] = mapped_column(Integer, nullable=False, default=0)

    jurisdiction: Mapped["Jurisdiction"] = relationship(back_populates="chambers")
    districts: Mapped[list["District"]] = relationship(back_populates="chamber")
    service_periods: Mapped[list["LegislatorServicePeriod"]] = relationship(
        back_populates="chamber"
    )
    committees: Mapped[list["Committee"]] = relationship(back_populates="chamber")
    bills: Mapped[list["Bill"]] = relationship(back_populates="chamber")

    __table_args__ = (
        UniqueConstraint("jurisdiction_id", "slug"),
        UniqueConstraint("jurisdiction_id", "chamber_type"),
    )


class LegislativeSession(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "legislative_session"

    jurisdiction_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("jurisdiction.id"), nullable=False
    )
    slug: Mapped[str] = mapped_column(String(50), nullable=False)
    session_number: Mapped[int] = mapped_column(Integer, nullable=False)
    session_type: Mapped[SessionType] = mapped_column(
        SQLEnum(SessionType, name="session_type"), nullable=False
    )
    year_start: Mapped[int] = mapped_column(Integer, nullable=False)
    year_end: Mapped[int] = mapped_column(Integer, nullable=False)
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    start_date: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True))
    end_date: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True))
    is_current: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)

    jurisdiction: Mapped["Jurisdiction"] = relationship(back_populates="sessions")
    service_periods: Mapped[list["LegislatorServicePeriod"]] = relationship(
        back_populates="session"
    )
    committees: Mapped[list["Committee"]] = relationship(back_populates="session")
    bills: Mapped[list["Bill"]] = relationship(back_populates="session")

    __table_args__ = (
        UniqueConstraint("jurisdiction_id", "slug"),
        UniqueConstraint(
            "jurisdiction_id", "session_number", "year_start", "session_type"
        ),
    )


class District(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "district"

    jurisdiction_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("jurisdiction.id"), nullable=False
    )
    chamber_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("chamber.id"), nullable=False
    )
    code: Mapped[str] = mapped_column(String(20), nullable=False)
    label: Mapped[str] = mapped_column(String(100), nullable=False)
    gis_identifier: Mapped[Optional[str]] = mapped_column(String(100))
    valid_from: Mapped[Optional[date]] = mapped_column(Date)
    valid_to: Mapped[Optional[date]] = mapped_column(Date)

    jurisdiction: Mapped["Jurisdiction"] = relationship(back_populates="districts")
    chamber: Mapped["Chamber"] = relationship(back_populates="districts")
    service_periods: Mapped[list["LegislatorServicePeriod"]] = relationship(
        back_populates="district"
    )

    __table_args__ = (UniqueConstraint("jurisdiction_id", "chamber_id", "code"),)


class Legislator(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "legislator"

    jurisdiction_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("jurisdiction.id"), nullable=False
    )
    slug: Mapped[str] = mapped_column(String(120), nullable=False)
    external_key: Mapped[Optional[str]] = mapped_column(String(100))
    full_name: Mapped[str] = mapped_column(String(200), nullable=False)
    sort_name: Mapped[str] = mapped_column(String(200), nullable=False)
    first_name: Mapped[Optional[str]] = mapped_column(String(100))
    last_name: Mapped[Optional[str]] = mapped_column(String(100))
    preferred_name: Mapped[Optional[str]] = mapped_column(String(100))
    biography: Mapped[Optional[str]] = mapped_column(Text)

    jurisdiction: Mapped["Jurisdiction"] = relationship(back_populates="legislators")
    service_periods: Mapped[list["LegislatorServicePeriod"]] = relationship(
        back_populates="legislator"
    )
    committee_memberships: Mapped[list["CommitteeMembership"]] = relationship(
        back_populates="legislator"
    )
    sponsorships: Mapped[list["Sponsorship"]] = relationship(
        back_populates="legislator"
    )
    vote_records: Mapped[list["VoteRecord"]] = relationship(back_populates="legislator")
    stats: Mapped[list["LegislatorStats"]] = relationship(back_populates="legislator")

    __table_args__ = (
        UniqueConstraint("jurisdiction_id", "slug"),
        UniqueConstraint("jurisdiction_id", "external_key"),
    )


class LegislatorServicePeriod(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "legislator_service_period"

    legislator_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("legislator.id"), nullable=False
    )
    session_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("legislative_session.id"), nullable=False
    )
    chamber_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("chamber.id"), nullable=False
    )
    district_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("district.id"), nullable=False
    )
    period_sequence: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    party: Mapped[Optional[str]] = mapped_column(String(50))
    caucus_name: Mapped[Optional[str]] = mapped_column(String(100))
    title: Mapped[Optional[str]] = mapped_column(String(100))
    email: Mapped[Optional[str]] = mapped_column(String(255))
    phone: Mapped[Optional[str]] = mapped_column(String(50))
    photo_url: Mapped[Optional[str]] = mapped_column(Text)
    profile_url: Mapped[Optional[str]] = mapped_column(Text)
    office_address: Mapped[Optional[str]] = mapped_column(Text)
    start_date: Mapped[Optional[date]] = mapped_column(Date)
    end_date: Mapped[Optional[date]] = mapped_column(Date)
    is_current: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)

    legislator: Mapped["Legislator"] = relationship(back_populates="service_periods")
    session: Mapped["LegislativeSession"] = relationship(
        back_populates="service_periods"
    )
    chamber: Mapped["Chamber"] = relationship(back_populates="service_periods")
    district: Mapped["District"] = relationship(back_populates="service_periods")

    __table_args__ = (
        UniqueConstraint("legislator_id", "session_id", "period_sequence"),
        Index(
            "ix_legislator_service_period_current",
            "session_id",
            "is_current",
            "chamber_id",
            "district_id",
        ),
    )


class Committee(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "committee"

    chamber_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("chamber.id"), nullable=False
    )
    session_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("legislative_session.id"), nullable=False
    )
    external_key: Mapped[Optional[str]] = mapped_column(String(100))
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    code: Mapped[Optional[str]] = mapped_column(String(50))
    profile_url: Mapped[Optional[str]] = mapped_column(Text)

    chamber: Mapped["Chamber"] = relationship(back_populates="committees")
    session: Mapped["LegislativeSession"] = relationship(back_populates="committees")
    memberships: Mapped[list["CommitteeMembership"]] = relationship(
        back_populates="committee"
    )

    __table_args__ = (UniqueConstraint("session_id", "chamber_id", "name"),)


class CommitteeMembership(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "committee_membership"

    committee_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("committee.id"), nullable=False
    )
    legislator_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("legislator.id"), nullable=False
    )
    role: Mapped[Optional[str]] = mapped_column(String(50))
    start_date: Mapped[Optional[date]] = mapped_column(Date)
    end_date: Mapped[Optional[date]] = mapped_column(Date)
    is_current: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)

    committee: Mapped["Committee"] = relationship(back_populates="memberships")
    legislator: Mapped["Legislator"] = relationship(
        back_populates="committee_memberships"
    )

    __table_args__ = (UniqueConstraint("committee_id", "legislator_id", "role"),)


class Bill(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "bill"

    session_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("legislative_session.id"), nullable=False
    )
    chamber_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("chamber.id"), nullable=False
    )
    bill_key: Mapped[str] = mapped_column(String(100), unique=True, nullable=False)
    file_type: Mapped[str] = mapped_column(String(20), nullable=False)
    file_number: Mapped[int] = mapped_column(Integer, nullable=False)
    revisor_number: Mapped[Optional[str]] = mapped_column(String(50))
    title: Mapped[str] = mapped_column(Text, nullable=False)
    description: Mapped[Optional[str]] = mapped_column(Text)
    current_status: Mapped[Optional[str]] = mapped_column(String(200))
    current_status_code: Mapped[Optional[str]] = mapped_column(String(50))
    latest_action_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True)
    )
    introduced_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True))
    official_url: Mapped[Optional[str]] = mapped_column(Text)
    is_omnibus: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    companion_bill_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        ForeignKey("bill.id")
    )
    ingestion_run_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        ForeignKey("ingestion_run.id")
    )

    session: Mapped["LegislativeSession"] = relationship(back_populates="bills")
    chamber: Mapped["Chamber"] = relationship(back_populates="bills")
    companion_bill: Mapped[Optional["Bill"]] = relationship(remote_side="Bill.id")
    versions: Mapped[list["BillVersion"]] = relationship(back_populates="bill")
    actions: Mapped[list["BillAction"]] = relationship(back_populates="bill")
    sponsorships: Mapped[list["Sponsorship"]] = relationship(back_populates="bill")
    chief_sponsorships: Mapped[list["Sponsorship"]] = relationship(
        primaryjoin=lambda: and_(
            Sponsorship.bill_id == Bill.id,
            Sponsorship.role == SponsorshipRole.chief_author,
        ),
        order_by=lambda: Sponsorship.source_order.asc(),
        viewonly=True,
    )
    vote_events: Mapped[list["VoteEvent"]] = relationship(back_populates="bill")
    stats: Mapped[Optional["BillStats"]] = relationship(
        back_populates="bill", uselist=False
    )
    tracked_by: Mapped[list["TrackedBill"]] = relationship(back_populates="bill")
    enrichments: Mapped[list["AIEnrichment"]] = relationship(back_populates="bill")

    __table_args__ = (
        UniqueConstraint("session_id", "file_type", "file_number"),
        Index("ix_bill_session_status", "session_id", "current_status_code"),
        Index("ix_bill_latest_action", "latest_action_at"),
    )


class BillVersion(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "bill_version"

    bill_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("bill.id"), nullable=False)
    version_code: Mapped[str] = mapped_column(String(50), nullable=False)
    version_name: Mapped[Optional[str]] = mapped_column(String(200))
    sequence_number: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    document_date: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True))
    html_url: Mapped[Optional[str]] = mapped_column(Text)
    pdf_url: Mapped[Optional[str]] = mapped_column(Text)
    source_artifact_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        ForeignKey("source_artifact.id")
    )
    is_current: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)

    bill: Mapped["Bill"] = relationship(back_populates="versions")
    sections: Mapped[list["BillVersionSection"]] = relationship(
        back_populates="bill_version"
    )
    rag_sections: Mapped[list["RagSectionDocument"]] = relationship(
        back_populates="bill_version"
    )

    __table_args__ = (
        UniqueConstraint("bill_id", "version_code"),
        Index("ix_bill_version_bill_sequence", "bill_id", "sequence_number"),
        # At most one current version per bill. A canonical refresh that adds a
        # new version must clear is_current on the others (see
        # MinnesotaIngestionPipeline.upsert_versions_and_sections); this partial
        # unique index makes the invariant impossible to violate (#285).
        Index(
            "uq_bill_version_one_current_per_bill",
            "bill_id",
            unique=True,
            postgresql_where=text("is_current"),
        ),
    )


class BillVersionSection(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "bill_version_section"

    bill_version_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("bill_version.id"), nullable=False
    )
    section_id_text: Mapped[str] = mapped_column(String(100), nullable=False)
    source_order: Mapped[int] = mapped_column(Integer, nullable=False)
    article_id_text: Mapped[Optional[str]] = mapped_column(String(100))
    article_number: Mapped[Optional[str]] = mapped_column(String(50))
    article_heading: Mapped[Optional[str]] = mapped_column(Text)
    section_heading: Mapped[Optional[str]] = mapped_column(Text)
    statute_heading: Mapped[Optional[str]] = mapped_column(Text)
    cite_heading: Mapped[Optional[str]] = mapped_column(Text)
    effective_date_heading: Mapped[Optional[str]] = mapped_column(Text)
    raw_text: Mapped[str] = mapped_column(Text, nullable=False)
    source_hash: Mapped[Optional[str]] = mapped_column(String(64))

    bill_version: Mapped["BillVersion"] = relationship(back_populates="sections")
    rag_sections: Mapped[list["RagSectionDocument"]] = relationship(
        back_populates="bill_version_section"
    )

    __table_args__ = (
        UniqueConstraint("bill_version_id", "section_id_text"),
        Index("ix_bill_version_section_order", "bill_version_id", "source_order"),
    )


class Sponsorship(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "sponsorship"

    bill_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("bill.id"), nullable=False)
    legislator_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        ForeignKey("legislator.id")
    )
    committee_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        ForeignKey("committee.id")
    )
    role: Mapped[SponsorshipRole] = mapped_column(
        SQLEnum(SponsorshipRole, name="sponsorship_role"), nullable=False
    )
    source_order: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    source_chamber: Mapped[Optional[str]] = mapped_column(String(20))

    bill: Mapped["Bill"] = relationship(back_populates="sponsorships")
    legislator: Mapped[Optional["Legislator"]] = relationship(
        back_populates="sponsorships"
    )
    committee: Mapped[Optional["Committee"]] = relationship()

    __table_args__ = (
        UniqueConstraint("bill_id", "legislator_id", "committee_id", "role"),
        CheckConstraint(
            "(legislator_id IS NOT NULL) OR (committee_id IS NOT NULL)",
            name="sponsorship_has_target",
        ),
    )


class BillAction(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "bill_action"

    bill_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("bill.id"), nullable=False)
    chamber_id: Mapped[Optional[uuid.UUID]] = mapped_column(ForeignKey("chamber.id"))
    committee_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        ForeignKey("committee.id")
    )
    source_artifact_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        ForeignKey("source_artifact.id")
    )
    action_number: Mapped[int] = mapped_column(Integer, nullable=False)
    action_group: Mapped[Optional[str]] = mapped_column(String(100))
    action_text: Mapped[str] = mapped_column(Text, nullable=False)
    action_description: Mapped[Optional[str]] = mapped_column(Text)
    action_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True))
    journal_page: Mapped[Optional[str]] = mapped_column(String(50))
    roll_call_text: Mapped[Optional[str]] = mapped_column(String(50))

    bill: Mapped["Bill"] = relationship(back_populates="actions")

    __table_args__ = (
        UniqueConstraint("bill_id", "action_number", "chamber_id"),
        Index("ix_bill_action_bill_order", "bill_id", "action_number"),
    )


class VoteEvent(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "vote_event"

    bill_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("bill.id"), nullable=False)
    bill_action_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        ForeignKey("bill_action.id")
    )
    chamber_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("chamber.id"), nullable=False
    )
    motion_text: Mapped[Optional[str]] = mapped_column(Text)
    result_text: Mapped[Optional[str]] = mapped_column(String(100))
    occurred_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True))
    official_url: Mapped[Optional[str]] = mapped_column(Text)
    source_artifact_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        ForeignKey("source_artifact.id")
    )
    yes_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    no_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    absent_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    excused_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    present_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)

    bill: Mapped["Bill"] = relationship(back_populates="vote_events")
    records: Mapped[list["VoteRecord"]] = relationship(back_populates="vote_event")

    __table_args__ = (Index("ix_vote_event_bill_occurred", "bill_id", "occurred_at"),)


class VoteRecord(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "vote_record"

    vote_event_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("vote_event.id"), nullable=False
    )
    legislator_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("legislator.id"), nullable=False
    )
    vote_value: Mapped[VoteValue] = mapped_column(
        SQLEnum(VoteValue, name="vote_value"), nullable=False
    )
    sort_order: Mapped[int] = mapped_column(Integer, nullable=False, default=0)

    vote_event: Mapped["VoteEvent"] = relationship(back_populates="records")
    legislator: Mapped["Legislator"] = relationship(back_populates="vote_records")

    __table_args__ = (UniqueConstraint("vote_event_id", "legislator_id"),)


class IngestionRun(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "ingestion_run"

    adapter: Mapped[str] = mapped_column(String(100), nullable=False)
    target_type: Mapped[str] = mapped_column(String(100), nullable=False)
    target_key: Mapped[Optional[str]] = mapped_column(String(200))
    status: Mapped[IngestionStatus] = mapped_column(
        SQLEnum(IngestionStatus, name="ingestion_run_status"), nullable=False
    )
    started_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    finished_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True))
    stats: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict)
    error_text: Mapped[Optional[str]] = mapped_column(Text)

    artifacts: Mapped[list["SourceArtifact"]] = relationship(back_populates="run")


class SourceArtifact(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "source_artifact"

    run_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("ingestion_run.id"), nullable=False
    )
    adapter: Mapped[str] = mapped_column(String(100), nullable=False)
    artifact_type: Mapped[ArtifactType] = mapped_column(
        SQLEnum(ArtifactType, name="artifact_type"), nullable=False
    )
    source_key: Mapped[Optional[str]] = mapped_column(String(200))
    source_url: Mapped[str] = mapped_column(Text, nullable=False)
    storage_path: Mapped[str] = mapped_column(Text, nullable=False)
    content_hash: Mapped[str] = mapped_column(String(128), nullable=False)
    http_status: Mapped[Optional[int]] = mapped_column(Integer)
    content_type: Mapped[Optional[str]] = mapped_column(String(255))
    fetched_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    is_current: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    metadata_json: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict)

    run: Mapped["IngestionRun"] = relationship(back_populates="artifacts")

    __table_args__ = (
        UniqueConstraint("adapter", "source_url", "content_hash"),
        Index("ix_source_artifact_source_key", "adapter", "source_key"),
    )


class UserAccount(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "user_account"

    display_name: Mapped[Optional[str]] = mapped_column(String(200))
    primary_email: Mapped[Optional[str]] = mapped_column(String(255), unique=True)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    last_signed_in_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True)
    )

    auth_identities: Mapped[list["AuthIdentity"]] = relationship(back_populates="user")
    tracked_bills: Mapped[list["TrackedBill"]] = relationship(back_populates="user")
    saved_places: Mapped[list["SavedPlace"]] = relationship(back_populates="user")
    notification_preferences: Mapped[list["NotificationPreference"]] = relationship(
        back_populates="user"
    )
    notification_events: Mapped[list["NotificationEvent"]] = relationship(
        back_populates="user"
    )
    chat_sessions: Mapped[list["ChatSession"]] = relationship(back_populates="user")


class AuthIdentity(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "auth_identity"

    user_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("user_account.id"), nullable=False
    )
    provider: Mapped[str] = mapped_column(String(100), nullable=False)
    provider_subject: Mapped[str] = mapped_column(String(255), nullable=False)
    email: Mapped[Optional[str]] = mapped_column(String(255))
    email_verified_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True)
    )
    last_used_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True))

    user: Mapped["UserAccount"] = relationship(back_populates="auth_identities")

    __table_args__ = (
        UniqueConstraint("provider", "provider_subject"),
        UniqueConstraint("user_id", "provider", "provider_subject"),
    )


class SavedPlace(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "saved_place"

    user_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("user_account.id"), nullable=False
    )
    label: Mapped[str] = mapped_column(String(100), nullable=False)
    address_text: Mapped[Optional[str]] = mapped_column(Text)
    city: Mapped[Optional[str]] = mapped_column(String(100))
    state_code: Mapped[Optional[str]] = mapped_column(String(10))
    postal_code: Mapped[Optional[str]] = mapped_column(String(20))
    latitude: Mapped[Optional[float]] = mapped_column(Numeric(9, 6))
    longitude: Mapped[Optional[float]] = mapped_column(Numeric(9, 6))
    house_district_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        ForeignKey("district.id")
    )
    senate_district_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        ForeignKey("district.id")
    )
    is_default: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)

    user: Mapped["UserAccount"] = relationship(back_populates="saved_places")


class NotificationPreference(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "notification_preference"

    user_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("user_account.id"), nullable=False
    )
    channel: Mapped[NotificationChannel] = mapped_column(
        SQLEnum(NotificationChannel, name="notification_channel"), nullable=False
    )
    frequency: Mapped[NotificationFrequency] = mapped_column(
        SQLEnum(NotificationFrequency, name="notification_frequency"), nullable=False
    )
    is_enabled: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)

    user: Mapped["UserAccount"] = relationship(
        back_populates="notification_preferences"
    )

    __table_args__ = (UniqueConstraint("user_id", "channel"),)


class TrackedBill(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "tracked_bill"

    user_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("user_account.id"), nullable=False
    )
    bill_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("bill.id"), nullable=False)
    note: Mapped[Optional[str]] = mapped_column(Text)
    alerts_enabled: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)

    user: Mapped["UserAccount"] = relationship(back_populates="tracked_bills")
    bill: Mapped["Bill"] = relationship(back_populates="tracked_by")

    __table_args__ = (UniqueConstraint("user_id", "bill_id"),)


class NotificationEvent(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    """A pending (or delivered) notification for a user about a tracked bill.

    Recorded when a tracked bill's status changes; a later digest job reads the
    unsent rows (``sent_at IS NULL``), emails them, and stamps ``sent_at``. That
    delivery slice and the email transport are deferred and gated
    (`.claude/rules/workflow.md`; tracked in #36) — recording an event here
    sends nothing on its own. ``event_type`` is a plain string rather than a PG
    enum so new event kinds don't need an enum migration; known values live in
    ``alethical.api.services.notifications``.
    """

    __tablename__ = "notification_event"

    user_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("user_account.id"), nullable=False
    )
    bill_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("bill.id"), nullable=False)
    event_type: Mapped[str] = mapped_column(String(50), nullable=False)
    old_status_code: Mapped[Optional[str]] = mapped_column(String(50))
    new_status_code: Mapped[Optional[str]] = mapped_column(String(50))
    old_status: Mapped[Optional[str]] = mapped_column(String(200))
    new_status: Mapped[Optional[str]] = mapped_column(String(200))
    sent_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True))

    user: Mapped["UserAccount"] = relationship(back_populates="notification_events")
    bill: Mapped["Bill"] = relationship()

    __table_args__ = (Index("ix_notification_event_user_unsent", "user_id", "sent_at"),)


class ChatSession(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "chat_session"

    user_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("user_account.id"), nullable=False
    )
    title: Mapped[Optional[str]] = mapped_column(String(255))
    subject_bill_id: Mapped[Optional[uuid.UUID]] = mapped_column(ForeignKey("bill.id"))
    retrieval_profile: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict)
    last_message_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True))

    user: Mapped["UserAccount"] = relationship(back_populates="chat_sessions")
    messages: Mapped[list["ChatMessage"]] = relationship(back_populates="session")


class ChatMessage(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "chat_message"

    session_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("chat_session.id"), nullable=False
    )
    role: Mapped[ChatRole] = mapped_column(
        SQLEnum(ChatRole, name="chat_role"), nullable=False
    )
    content: Mapped[str] = mapped_column(Text, nullable=False)
    model_name: Mapped[Optional[str]] = mapped_column(String(100))
    input_tokens: Mapped[Optional[int]] = mapped_column(Integer)
    output_tokens: Mapped[Optional[int]] = mapped_column(Integer)
    citation_payload: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict)

    session: Mapped["ChatSession"] = relationship(back_populates="messages")

    __table_args__ = (
        Index("ix_chat_message_session_created", "session_id", "created_at"),
    )


class AIEnrichment(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "ai_enrichment"

    bill_id: Mapped[Optional[uuid.UUID]] = mapped_column(ForeignKey("bill.id"))
    legislator_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        ForeignKey("legislator.id")
    )
    bill_version_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        ForeignKey("bill_version.id")
    )
    enrichment_type: Mapped[EnrichmentType] = mapped_column(
        SQLEnum(EnrichmentType, name="enrichment_type"), nullable=False
    )
    model_name: Mapped[str] = mapped_column(String(100), nullable=False)
    content_json: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict)
    source_version_hash: Mapped[Optional[str]] = mapped_column(String(64))
    is_current: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)

    bill: Mapped[Optional["Bill"]] = relationship(back_populates="enrichments")


class RagSectionDocument(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "rag_section_document"

    bill_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("bill.id"), nullable=False)
    bill_version_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("bill_version.id"), nullable=False
    )
    bill_version_section_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        ForeignKey("bill_version_section.id")
    )
    citation_label: Mapped[str] = mapped_column(Text, nullable=False)
    clean_text: Mapped[str] = mapped_column(Text, nullable=False)
    search_text: Mapped[str] = mapped_column(Text, nullable=False)
    cleaning_version: Mapped[str] = mapped_column(String(50), nullable=False)
    source_hash: Mapped[str] = mapped_column(String(64), nullable=False)
    word_count: Mapped[int] = mapped_column(Integer, nullable=False)

    bill_version: Mapped["BillVersion"] = relationship(back_populates="rag_sections")
    bill_version_section: Mapped[Optional["BillVersionSection"]] = relationship(
        back_populates="rag_sections"
    )
    chunks: Mapped[list["RagChunk"]] = relationship(
        back_populates="rag_section_document"
    )

    __table_args__ = (
        UniqueConstraint(
            "bill_version_id", "bill_version_section_id", "cleaning_version"
        ),
        Index("ix_rag_section_bill_version", "bill_id", "bill_version_id"),
    )


class RagChunk(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "rag_chunk"

    rag_section_document_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("rag_section_document.id"), nullable=False
    )
    chunk_index: Mapped[int] = mapped_column(Integer, nullable=False)
    citation_label: Mapped[str] = mapped_column(Text, nullable=False)
    chunk_text: Mapped[str] = mapped_column(Text, nullable=False)
    search_text: Mapped[str] = mapped_column(Text, nullable=False)
    chunking_version: Mapped[str] = mapped_column(String(50), nullable=False)
    word_count: Mapped[int] = mapped_column(Integer, nullable=False)
    token_estimate: Mapped[Optional[int]] = mapped_column(Integer)

    rag_section_document: Mapped["RagSectionDocument"] = relationship(
        back_populates="chunks"
    )
    embedding: Mapped[Optional["RagChunkEmbedding"]] = relationship(
        back_populates="rag_chunk", uselist=False
    )

    __table_args__ = (
        UniqueConstraint("rag_section_document_id", "chunk_index", "chunking_version"),
        Index("ix_rag_chunk_section_order", "rag_section_document_id", "chunk_index"),
    )


class RagChunkEmbedding(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "rag_chunk_embedding"

    rag_chunk_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("rag_chunk.id"), nullable=False, unique=True
    )
    embedding_model: Mapped[str] = mapped_column(String(100), nullable=False)
    embedding: Mapped[object] = mapped_column(Vector(1536), nullable=False)

    rag_chunk: Mapped["RagChunk"] = relationship(back_populates="embedding")


class BillStats(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "bill_stats"

    bill_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("bill.id"), nullable=False, unique=True
    )
    sponsor_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    action_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    version_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    vote_event_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    tracked_user_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)

    bill: Mapped["Bill"] = relationship(back_populates="stats")


class LegislatorStats(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "legislator_stats"

    legislator_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("legislator.id"), nullable=False
    )
    session_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("legislative_session.id"), nullable=False
    )
    chief_bill_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    total_bill_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    vote_record_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    committee_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)

    legislator: Mapped["Legislator"] = relationship(back_populates="stats")

    __table_args__ = (UniqueConstraint("legislator_id", "session_id"),)


def bill_detail_stmt(bill_id: uuid.UUID, user_id: Optional[uuid.UUID] = None):
    """Load one bill detail page without per-row lazy loads."""
    options = [
        selectinload(Bill.versions),
        selectinload(Bill.sponsorships)
        .selectinload(Sponsorship.legislator)
        .selectinload(Legislator.service_periods)
        .selectinload(LegislatorServicePeriod.chamber),
        selectinload(Bill.sponsorships)
        .selectinload(Sponsorship.legislator)
        .selectinload(Legislator.service_periods)
        .selectinload(LegislatorServicePeriod.district),
        selectinload(Bill.chief_sponsorships)
        .selectinload(Sponsorship.legislator)
        .selectinload(Legislator.service_periods)
        .selectinload(LegislatorServicePeriod.chamber),
        selectinload(Bill.chief_sponsorships)
        .selectinload(Sponsorship.legislator)
        .selectinload(Legislator.service_periods)
        .selectinload(LegislatorServicePeriod.district),
        selectinload(Bill.actions),
        selectinload(Bill.vote_events)
        .selectinload(VoteEvent.records)
        .selectinload(VoteRecord.legislator),
        selectinload(Bill.enrichments),
    ]
    if user_id is not None:
        options.append(
            selectinload(Bill.tracked_by.and_(TrackedBill.user_id == user_id))
        )
    return select(Bill).where(Bill.id == bill_id).options(*options)


def current_bill_summary_enrichment_bill_ids():
    return select(AIEnrichment.bill_id).where(
        AIEnrichment.enrichment_type == EnrichmentType.bill_summary,
        AIEnrichment.is_current.is_(True),
        func.nullif(func.btrim(AIEnrichment.content_json["summary"].astext), "").is_not(
            None
        ),
    )


# Progress rank per status key: lower rank = further along the legislative
# process. Used to order sort=progress; derived from ``bill_status_key_expr``
# so the sort and the displayed badge classify from one shared cascade.
_STATUS_KEY_RANK = {
    "signed_into_law": 0,
    "vetoed": 1,
    "passed_senate": 2,
    "passed_house": 3,
    "in_committee": 4,
    "proposed": 5,
}


def bill_status_key_expr():
    """SQL expression yielding a bill's list-card status key from
    ``Bill.current_status`` alone.

    The single SQL-side source of truth for status classification, mirroring
    ``bill_status_key_from_summary`` (alethical/api/serializers.py) — the
    heuristic the list card's status badge displays. Because the status *filter*
    (``status_filter_clause``) and the displayed *badge* now derive from the
    same priority cascade (veto wins over governor), selecting a status returns
    exactly the bills whose badge matches it: each bill maps to exactly one
    status, so the six filters are mutually exclusive and their counts sum to
    the session total. Classifies from ``current_status`` alone, so it needs no
    join to ``bill_action`` and adds no N+1. Keep this and the serializer twin
    in sync.
    """
    status = func.lower(func.coalesce(Bill.current_status, ""))
    return case(
        (status.contains("veto"), "vetoed"),
        (
            status.contains("governor")
            | status.contains("chapter number")
            | status.contains("secretary of state")
            | status.contains("effective date"),
            "signed_into_law",
        ),
        (status.contains("senate") & status.contains("pass"), "passed_senate"),
        (status.contains("pass"), "passed_house"),
        (
            status.contains("referred")
            | status.contains("committee")
            | status.contains("second reading"),
            "in_committee",
        ),
        else_="proposed",
    )


def bill_progress_rank():
    """Stage rank for legislative-progress sort: lower rank = further along.

    Derived from ``bill_status_key_expr`` so the sort order and the displayed
    badge never disagree — both read one shared classification cascade.
    """
    key = bill_status_key_expr()
    return case(
        *[(key == status, rank) for status, rank in _STATUS_KEY_RANK.items()],
        else_=_STATUS_KEY_RANK["proposed"],
    )


def bill_list_stmt(
    session_id: uuid.UUID,
    user_id: Optional[uuid.UUID] = None,
    sort: str = "latest_action",
):
    """Load a bill list page with stats, chief-sponsor preview, and optional tracked state.

    ``sort`` selects the ordering: ``"latest_action"`` (default) keeps the
    most-recent-activity order; ``"progress"`` orders by legislative stage
    (signed → vetoed → passed senate → passed house → in committee → proposed),
    tie-broken by most-recent activity; ``"introduced"`` orders by introduction
    date descending (most recently introduced first), tie-broken by file number.
    """
    options = [
        selectinload(Bill.stats),
        selectinload(Bill.chief_sponsorships).selectinload(Sponsorship.legislator),
        selectinload(Bill.enrichments),
    ]
    if user_id is not None:
        options.append(
            selectinload(Bill.tracked_by.and_(TrackedBill.user_id == user_id))
        )
    recency_order = (
        Bill.latest_action_at.desc().nullslast(),
        Bill.file_number.asc(),
        Bill.id.asc(),
    )
    if sort == "progress":
        order_by = (bill_progress_rank().asc(), *recency_order)
    elif sort == "introduced":
        order_by = (
            Bill.introduced_at.desc().nullslast(),
            Bill.file_number.desc(),
            Bill.id.asc(),
        )
    else:
        order_by = recency_order
    return (
        select(Bill)
        .where(
            Bill.session_id == session_id,
            Bill.id.in_(current_bill_summary_enrichment_bill_ids()),
        )
        .options(*options)
        .order_by(*order_by)
    )


def legislator_directory_stmt(session_id: uuid.UUID):
    """Load a legislator directory page from current terms and derived stats."""
    return (
        select(Legislator)
        .join(
            LegislatorServicePeriod,
            LegislatorServicePeriod.legislator_id == Legislator.id,
        )
        .join(District, District.id == LegislatorServicePeriod.district_id)
        .where(
            LegislatorServicePeriod.session_id == session_id,
            LegislatorServicePeriod.is_current.is_(True),
            District.code.not_like("%-unknown"),
        )
        .options(
            selectinload(
                Legislator.service_periods.and_(
                    LegislatorServicePeriod.session_id == session_id,
                    LegislatorServicePeriod.is_current.is_(True),
                )
            ).selectinload(LegislatorServicePeriod.chamber),
            selectinload(
                Legislator.service_periods.and_(
                    LegislatorServicePeriod.session_id == session_id,
                    LegislatorServicePeriod.is_current.is_(True),
                )
            ).selectinload(LegislatorServicePeriod.district),
            selectinload(
                Legislator.stats.and_(LegislatorStats.session_id == session_id)
            ),
        )
        .order_by(Legislator.sort_name.asc())
    )


def legislator_profile_stmt(legislator_id: uuid.UUID, session_id: uuid.UUID):
    """Load one legislator profile root plus bounded child collections."""
    return (
        select(Legislator)
        .where(Legislator.id == legislator_id)
        .options(
            selectinload(
                Legislator.service_periods.and_(
                    LegislatorServicePeriod.session_id == session_id,
                    LegislatorServicePeriod.is_current.is_(True),
                )
            ).selectinload(LegislatorServicePeriod.district),
            selectinload(
                Legislator.committee_memberships.and_(
                    CommitteeMembership.is_current.is_(True)
                )
            ).selectinload(CommitteeMembership.committee),
            selectinload(
                Legislator.stats.and_(LegislatorStats.session_id == session_id)
            ),
        )
    )


def legislator_sponsored_bills_stmt(legislator_id: uuid.UUID, session_id: uuid.UUID):
    """Load one legislator's sponsored bills for a session with list-card fields."""
    return (
        select(Bill)
        .join(Sponsorship, Sponsorship.bill_id == Bill.id)
        .where(
            Sponsorship.legislator_id == legislator_id,
            Bill.session_id == session_id,
            Bill.id.in_(current_bill_summary_enrichment_bill_ids()),
        )
        .options(
            selectinload(Bill.stats),
            selectinload(Bill.chief_sponsorships).selectinload(Sponsorship.legislator),
            selectinload(Bill.enrichments),
        )
        .order_by(Bill.file_number.asc(), Bill.id.asc())
    )


def legislator_vote_history_stmt(legislator_id: uuid.UUID, session_id: uuid.UUID):
    """Load one legislator's vote history within a session."""
    return (
        select(VoteRecord)
        .join(VoteEvent, VoteEvent.id == VoteRecord.vote_event_id)
        .join(Bill, Bill.id == VoteEvent.bill_id)
        .where(
            VoteRecord.legislator_id == legislator_id,
            Bill.session_id == session_id,
        )
        .order_by(
            VoteEvent.occurred_at.desc().nullslast(), VoteRecord.created_at.desc()
        )
    )


def find_my_legislator_stmt(session_id: uuid.UUID, district_ids: list[uuid.UUID]):
    """Load current legislators for resolved district identifiers."""
    return (
        select(LegislatorServicePeriod)
        .where(
            LegislatorServicePeriod.session_id == session_id,
            LegislatorServicePeriod.is_current.is_(True),
            LegislatorServicePeriod.district_id.in_(district_ids),
        )
        .options(
            selectinload(LegislatorServicePeriod.legislator),
            selectinload(LegislatorServicePeriod.district),
        )
    )


def tracked_bills_stmt(user_id: uuid.UUID):
    """Load tracked bills with bill cards and chief sponsors in bounded queries."""
    return (
        select(TrackedBill)
        .where(
            TrackedBill.user_id == user_id,
            TrackedBill.bill_id.in_(current_bill_summary_enrichment_bill_ids()),
        )
        .options(
            selectinload(TrackedBill.bill).selectinload(Bill.stats),
            selectinload(TrackedBill.bill).selectinload(Bill.enrichments),
            selectinload(TrackedBill.bill)
            .selectinload(Bill.chief_sponsorships)
            .selectinload(Sponsorship.legislator),
        )
    )


def rag_chunk_lookup_stmt(bill_id: Optional[uuid.UUID] = None):
    """Load retrieval-ready chunks with section provenance."""
    stmt = select(RagChunk).options(selectinload(RagChunk.rag_section_document))
    if bill_id is not None:
        stmt = stmt.join(
            RagSectionDocument,
            RagSectionDocument.id == RagChunk.rag_section_document_id,
        ).where(RagSectionDocument.bill_id == bill_id)
    return stmt.order_by(RagChunk.created_at.desc())


def semantic_rag_chunk_stmt(
    query_embedding: list[float],
    *,
    bill_id: Optional[uuid.UUID] = None,
    embedding_model: Optional[str] = None,
    limit: int = 10,
    max_distance: Optional[float] = None,
    current_version_only: bool = True,
):
    """Load retrieval-ready chunks ordered by vector similarity with canonical provenance.

    ``max_distance`` gates the retrieval-relevance threshold: when set, only
    chunks within that cosine distance of the query are returned, so a weak
    match yields nothing (the caller refuses rather than stretches — the Ask
    cite-or-refuse guardrail, docs/grounded-ask-spec.md §4.5). Left ``None`` for
    callers like bill-scoped chat that always want the nearest neighbours.

    ``current_version_only`` (default True) scopes retrieval to each bill's
    current ``BillVersion``, so RAG left on a superseded version can never surface
    in a grounded answer — the answer always reflects the bill as it stands now
    (#285). Retrieval keys on ``bill_id`` alone, not the version, so without this a
    stale/duplicate version's chunks would mix in."""
    distance = RagChunkEmbedding.embedding.cosine_distance(query_embedding)
    stmt = (
        select(RagChunk)
        .join(RagChunkEmbedding, RagChunkEmbedding.rag_chunk_id == RagChunk.id)
        .join(
            RagSectionDocument,
            RagSectionDocument.id == RagChunk.rag_section_document_id,
        )
        .options(selectinload(RagChunk.rag_section_document))
        .order_by(distance)
        .limit(limit)
    )
    if current_version_only:
        stmt = stmt.join(
            BillVersion, BillVersion.id == RagSectionDocument.bill_version_id
        ).where(BillVersion.is_current.is_(True))
    if bill_id is not None:
        stmt = stmt.where(RagSectionDocument.bill_id == bill_id)
    if embedding_model is not None:
        stmt = stmt.where(RagChunkEmbedding.embedding_model == embedding_model)
    if max_distance is not None:
        stmt = stmt.where(distance <= max_distance)
    return stmt
