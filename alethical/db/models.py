"""SQLAlchemy models and query helpers for Alethical."""

from __future__ import annotations

import enum
import uuid
from datetime import date, datetime
from decimal import Decimal
from collections.abc import Sequence
from typing import Optional

from sqlalchemy import (
    and_,
    BigInteger,
    Boolean,
    CheckConstraint,
    Computed,
    Date,
    DateTime,
    Enum as SQLEnum,
    ForeignKey,
    ForeignKeyConstraint,
    Index,
    Integer,
    MetaData,
    Numeric,
    SmallInteger,
    String,
    Text,
    UniqueConstraint,
    case,
    exists,
    func,
    or_,
    select,
    text,
)
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import (
    DeclarativeBase,
    Mapped,
    joinedload,
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
    # valid_from/valid_to are intentionally unpopulated (#343): no official
    # source supplies redistricting validity dates and nothing reads them. Kept
    # nullable for a future redistricting-history model; do not backfill session
    # or ingest dates here, which are not district validity dates.
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
    election_history: Mapped[list["LegislatorElectionHistory"]] = relationship(
        back_populates="legislator",
        order_by="LegislatorElectionHistory.period_sequence",
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
    elected: Mapped[Optional[str]] = mapped_column(Text)
    # Text, not a short varchar: some members carry an annotation, e.g.
    # "3rd (non-consecutive)", which overflows a tight width.
    term: Mapped[Optional[str]] = mapped_column(Text)
    # The member's current city of residence ("Bloomington"), ingested from the
    # official LRL legislator record (#551). Powers the Bill Profile author card's
    # "{City} (SD 51)" line; stays null when the source states no residence.
    represented_city: Mapped[Optional[str]] = mapped_column(String(120))
    # start_date/end_date are intentionally unpopulated (#343): the roster/profile
    # source carries no per-member service dates, and a period's session start/end
    # must not be copied here as person-level dates (members can join or leave
    # mid-session). Tenure is served from the election-history table (#486), so
    # these are unneeded; kept nullable for a future multi-period model.
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
        # At most one CURRENT period per member per session (#928). The code has
        # always assumed this -- upsert_service_period looks a row up by
        # (legislator_id, session_id, is_current) and inserts when it finds none
        # -- but nothing enforced it, so two concurrent runs could both find none
        # and both insert. The index that names all three columns below is not
        # unique and only looked like protection. Same shape as
        # uq_bill_version_one_current_per_bill. 0 violations in production.
        Index(
            "uq_legislator_service_period_one_current",
            "legislator_id",
            "session_id",
            unique=True,
            postgresql_where=text("is_current"),
        ),
        Index(
            "ix_legislator_service_period_current",
            "session_id",
            "is_current",
            "chamber_id",
            "district_id",
        ),
    )


class LegislatorElectionHistory(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    """A member's Legislative Service history, scraped from the official bio
    pages (issue #486). One row per chamber tenure, ordered chronologically by
    ``period_sequence`` (earliest first): a member who served in the House then
    moved to the Senate gets two rows. This is distinct from
    ``legislator_service_period`` (one per ingested session, keyed on
    session/chamber/district) — historical prior-chamber tenures have no
    ingested session or district, so they live here instead.

    ``initial_year`` is the first election to that chamber; ``reelection_years``
    is the ordered list of subsequent election years for the same tenure (the
    Senate bio lists them; the House bio does not, so House rows carry only the
    initial year). ``term_number`` counts the CURRENT chamber only and is set
    solely on the ``is_current_chamber`` row — never summed across chambers."""

    __tablename__ = "legislator_election_history"

    legislator_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("legislator.id"), nullable=False, index=True
    )
    chamber_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("chamber.id"), nullable=False
    )
    period_sequence: Mapped[int] = mapped_column(Integer, nullable=False)
    initial_year: Mapped[int] = mapped_column(Integer, nullable=False)
    reelection_years: Mapped[list] = mapped_column(
        JSONB, nullable=False, default=list, server_default="[]"
    )
    is_current_chamber: Mapped[bool] = mapped_column(
        # server_default matches production, which has had it since 0008 created
        # the table there; a database built by create_all never got one, because
        # the model only carried the Python-side `default`. Audit finding D8.
        Boolean,
        nullable=False,
        default=False,
        server_default=text("false"),
    )
    term_number: Mapped[Optional[int]] = mapped_column(Integer)

    legislator: Mapped["Legislator"] = relationship(back_populates="election_history")
    chamber: Mapped["Chamber"] = relationship()

    # Named explicitly to match production. 0008 named this constraint by hand;
    # the naming convention generates the much longer
    # uq_legislator_election_history_legislator_id_period_sequence, which is what
    # create_all built on every fresh database. Same two columns either way, so
    # nothing behaved differently -- until a future op.drop_constraint() names one
    # of the two and fails against the other. Audit finding D7.
    __table_args__ = (
        UniqueConstraint(
            "legislator_id",
            "period_sequence",
            name="uq_legislator_election_history_leg_seq",
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
    # start_date/end_date are intentionally unpopulated (#343): the committee
    # source carries only name/role/code (no join or leave dates), and the
    # dedicated committee refresh rebuilds the current snapshot wholesale, so
    # membership dates cannot be established either way. No reader today; kept
    # nullable for a future membership-history model.
    start_date: Mapped[Optional[date]] = mapped_column(Date)
    end_date: Mapped[Optional[date]] = mapped_column(Date)
    is_current: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)

    committee: Mapped["Committee"] = relationship(back_populates="memberships")
    legislator: Mapped["Legislator"] = relationship(
        back_populates="committee_memberships"
    )

    # NULLS NOT DISTINCT (#928): role is empty on an ordinary membership, and
    # Postgres does not consider two empty values equal, so this key blocked
    # nothing for exactly the rows it was written to protect. The only thing
    # preventing a duplicate was that both writers happen to look before they
    # insert. 0 violations in production.
    __table_args__ = (
        UniqueConstraint(
            "committee_id",
            "legislator_id",
            "role",
            postgresql_nulls_not_distinct=True,
        ),
    )


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
    # Denormalized per-request signals (#505), maintained by DB triggers so they
    # can never drift from their source data:
    #   * has_current_summary — true iff a current non-empty bill_summary
    #     enrichment exists; equals ``current_bill_summary_enrichment_bill_ids``.
    #     Lets the list gate read a cheap bill column instead of seq-scanning and
    #     detoasting the whole ai_enrichment table every request (alembic 0007).
    #   * status_key / status_rank — the list-card status classification and its
    #     progress rank, precomputed via the exact cascade in
    #     ``bill_status_key_expr`` / ``bill_progress_rank`` (the Python source of
    #     truth). Passage (House/Senate/both chambers) and enactment are read from
    #     the chamber-stamped ``bill_action`` history, so triggers on both ``bill``
    #     and ``bill_action`` maintain the columns (alembic 0014, #607). Lets
    #     sort=progress and the status filter read a plain indexed column instead
    #     of a live join + CASE cascade.
    #   * short_title — the plain-language headline every card, bill page and Ask
    #     answer displays instead of the official legal ``title``. Copied from the
    #     current bill_summary enrichment's ``short_title`` by a trigger on
    #     ``ai_enrichment`` (alembic 0033), because the source lives inside a
    #     TOASTed JSONB column that keyword search cannot afford to read per
    #     request. Search matches it alongside title/description, so the words a
    #     reader can actually see resolve to the bill they are looking at.
    has_current_summary: Mapped[bool] = mapped_column(
        Boolean, default=False, server_default=text("false"), nullable=False
    )
    status_key: Mapped[Optional[str]] = mapped_column(String(50))
    status_rank: Mapped[Optional[int]] = mapped_column(SmallInteger)
    short_title: Mapped[Optional[str]] = mapped_column(Text)
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
    actions: Mapped[list["BillAction"]] = relationship(
        back_populates="bill",
        # Deterministic source order: grouped by chamber, ascending action_number
        # within each chamber (action_number is per-chamber). Consumers rely on
        # this to place dateless actions next to their sequence neighbors on the
        # timeline; without it Postgres returns an undefined physical order.
        order_by=lambda: (BillAction.chamber_id, BillAction.action_number),
    )
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
        # Serves the introduced-date sort (sort=introduced) used by the Search
        # Bills list and the mobile home Bill Activity feed. Without it the list
        # query sorts every bill in the session on disk to take the top rows
        # (~70ms on the production corpus); the index turns that into a 2ms index
        # scan. Column directions match the query's ORDER BY exactly
        # (introduced_at DESC NULLS LAST, file_number DESC) so the planner can
        # walk the index instead of sorting.
        Index(
            "ix_bill_session_introduced",
            "session_id",
            text("introduced_at DESC NULLS LAST"),
            text("file_number DESC"),
        ),
        # Serves sort=progress on the Search Bills list (#505): the default screen
        # sort orders the summary-having bills of a session by legislative-stage
        # rank, tie-broken by most-recent activity. Column directions match that
        # ORDER BY exactly and the partial predicate matches the list gate, so the
        # planner walks this index instead of recomputing a lower()/ILIKE CASE
        # cascade over every row and quicksorting ~10k results (~250ms → index
        # scan on the production corpus).
        Index(
            "ix_bill_session_progress",
            "session_id",
            "status_rank",
            text("latest_action_at DESC NULLS LAST"),
            "file_number",
            "id",
            postgresql_where=text("has_current_summary"),
        ),
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
    # The same body as `raw_text`, plus the three things flattening it to one
    # string destroys: the subdivision numbers ("Subd. 2."), the marks saying
    # which words the bill ADDS, and the row/column shape of appropriation
    # tables (#741, #752). An ordered list of {"kind": heading|para|table} blocks
    # — see `parse_section_blocks` in alethical/pipeline/minnesota.py for the
    # shape. Null on any section written before that parser existed, so a reader
    # must fall back to `raw_text`.
    #
    # Deliberately a SEPARATE column rather than a rewrite of `raw_text`: two
    # paid caches hash `raw_text` — every section's embedding (rag_ingest) and
    # every bill's AI summary (ai_enrichment's source_version_hash) — so
    # rewriting it would re-run both corpus-wide jobs. Nothing hashes this
    # column, so filling it costs nothing.
    body_blocks: Mapped[Optional[list]] = mapped_column(JSONB)
    source_hash: Mapped[Optional[str]] = mapped_column(String(64))

    bill_version: Mapped["BillVersion"] = relationship(back_populates="sections")
    rag_sections: Mapped[list["RagSectionDocument"]] = relationship(
        back_populates="bill_version_section"
    )

    __table_args__ = (
        # Keyed on the section's POSITION, not its id, because a bill page may give
        # two sections the same id: `laws.0.1.0` is what the Revisor hands every
        # section that sits outside an article, so a bill with several of those
        # repeats it. Keying on the id made the second such section overwrite the
        # first, and 24 current versions lost 57 sections that way (#763).
        # `section_id_text` stays the DISPLAY value but is no longer unique, so it is
        # not an anchor either: the Bill Text tab keys each section's HTML id and
        # share link on `ft-<section_id_text>-<source_order>`, and a citation chip
        # carries the same pair (#854). An id-only `#ft-` link still resolves, to the
        # first section carrying that id.
        # The trade-off: a row now follows its position rather than its content, so
        # if a version's page ever gained a section in the middle, every later row
        # would be rewritten with its neighbour's text and re-embedded. That costs
        # nothing in practice — a version's page is a fixed document at a fixed
        # `bill_version.html_url`, and a new engrossment gets its own version row.
        UniqueConstraint("bill_version_id", "source_order"),
        Index("ix_bill_version_section_order", "bill_version_id", "source_order"),
        Index("ix_bill_version_section_text", "bill_version_id", "section_id_text"),
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
        # NULLS NOT DISTINCT, and source_chamber is part of the key (#928).
        #
        # Without NULLS NOT DISTINCT this key blocked nothing for an ordinary
        # legislator authorship, because committee_id is empty on those rows and
        # Postgres does not consider two empty values equal. Without
        # source_chamber it would now be too strict in the other direction: one
        # person can author the same bill on both chambers' lists, and the
        # official record shows it (SF 1943 — Hemmingsen-Jaeger is House author 14
        # and Senate author 5). Measured across production before adding it: 0
        # rows violate this key.
        # Named by hand: the convention generates a 69-character name, past
        # Postgres's 63-character limit, so it would arrive truncated with a hash
        # on the end and the migration would have to hard-code that hash. A short
        # explicit name is the same fix the audit applied for finding D7 -- both
        # sides say the same thing, and a human can read it.
        UniqueConstraint(
            "bill_id",
            "legislator_id",
            "committee_id",
            "role",
            "source_chamber",
            name="uq_sponsorship_bill_author_role_chamber",
            postgresql_nulls_not_distinct=True,
        ),
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
    # Committee named by the source on a referral/re-refer action (the raw
    # <COMMITTEE_NAME>, e.g. "Ways and Means"). Distinct from committee_id, which
    # is our FK to the committee table; the source's COMMITTEE_ID is an opaque
    # string, so we keep only the display name here (#599).
    committee_name: Mapped[Optional[str]] = mapped_column(Text)
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
    # The latest time a new AuthIdentity row was attached to this account. This
    # is not login-event tracking and ordinary sign-ins do not change it (#1045).
    last_identity_linked_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True)
    )
    # When this user last opened the tracked-bills page — the comparison point the
    # page's "what moved since you last looked" block is measured against (#1009).
    # NULL means no recorded visit yet, which the page renders as its first-visit
    # state rather than as "everything moved".
    #
    # Deliberately NOT ``last_identity_linked_at``: adding a sign-in method and
    # looking at the tracked list are separate events. Only
    # ``POST /me/tracked-bills/viewed`` writes this column.
    tracked_bills_last_viewed_at: Mapped[Optional[datetime]] = mapped_column(
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
    # When this identity was attached to the account. It is not updated on use.
    linked_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True))

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


class SiteMetricEvent(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    """One fixed action name, with no words, page, person, or account attached."""

    __tablename__ = "site_metric_event"

    event_kind: Mapped[str] = mapped_column(String(60), nullable=False)

    __table_args__ = (
        CheckConstraint(
            "event_kind IN ("
            "'bill_search_with_results', "
            "'legislator_search_with_results', "
            "'find_my_legislator_with_results', "
            "'official_source_opened'"
            ")",
            name="event_kind_allowed",
        ),
        Index("ix_site_metric_event_kind_created", "event_kind", "created_at"),
    )


class PendingAction(Base):
    """One signed-out product action waiting for a completed sign-in.

    The browser receives the random reference. Only its digest reaches this
    table, and there is deliberately no user foreign key: the action cannot
    belong to an account until authentication has established that account.
    """

    __tablename__ = "pending_action"

    reference_digest: Mapped[str] = mapped_column(String(64), primary_key=True)
    action_kind: Mapped[str] = mapped_column(String(50), nullable=False)
    bill_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("bill.id"), nullable=False)
    return_path: Mapped[str] = mapped_column(String(500), nullable=False)
    expires_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False
    )

    bill: Mapped["Bill"] = relationship()

    __table_args__ = (
        CheckConstraint(
            "action_kind = 'track_bill'", name="pending_action_kind_track_bill"
        ),
        Index("ix_pending_action_expires_at", "expires_at"),
    )


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


class EmailQuotaWarningState(TimestampMixin, Base):
    """Whether a free-plan usage threshold is currently crossed.

    This stores operational counts only. It never stores an email address,
    subject, or message body.
    """

    __tablename__ = "email_quota_warning_state"

    scope: Mapped[str] = mapped_column(String(10), primary_key=True)
    threshold: Mapped[int] = mapped_column(SmallInteger, primary_key=True)
    is_above: Mapped[bool] = mapped_column(
        Boolean, default=False, server_default=text("false"), nullable=False
    )
    last_used: Mapped[int] = mapped_column(
        Integer, default=0, server_default=text("0"), nullable=False
    )


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


class LegislatorChatRole(enum.Enum):
    user = "user"
    assistant = "assistant"


class LegislatorChatSession(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "legislator_chat_session"

    legislator_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("legislator.id"), nullable=False)
    last_message_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True))

    legislator: Mapped["Legislator"] = relationship()
    messages: Mapped[list["LegislatorChatMessage"]] = relationship(back_populates="session")

    __table_args__ = (Index("ix_legislator_chat_session_legislator", "legislator_id"),)


class LegislatorChatMessage(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "legislator_chat_message"

    session_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("legislator_chat_session.id"), nullable=False)
    role: Mapped[LegislatorChatRole] = mapped_column(
        SQLEnum(LegislatorChatRole, name="legislator_chat_role"), nullable=False
    )
    content: Mapped[str] = mapped_column(Text, nullable=False)
    was_refusal: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    citations: Mapped[list] = mapped_column(JSONB, nullable=False, default=list)

    session: Mapped["LegislatorChatSession"] = relationship(back_populates="messages")

    __table_args__ = (Index("ix_legislator_chat_message_session_created", "session_id", "created_at"),)


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

    # The only thing enforcing "one current summary per bill". It exists in
    # production and was declared nowhere, so rebuilding the database from this
    # file used to drop the protection silently. Declared here so it survives.
    # Audit finding D6; the predicate is transcribed from production's own
    # pg_get_indexdef, including the bill_id IS NOT NULL leg (rows for a
    # legislator carry a null bill_id and must not collide with each other).
    #
    # It covers two of the five columns the write path in
    # alethical/pipeline/ai_enrichment.py looks a row up on, and only rows that
    # are current. The key below covers the other gap (#927).
    __table_args__ = (
        Index(
            "ix_ai_enrichment_bill_summary_current_unique",
            "bill_id",
            "enrichment_type",
            unique=True,
            postgresql_where=text(
                "bill_id IS NOT NULL "
                "AND enrichment_type = 'bill_summary' "
                "AND is_current = true"
            ),
        ),
        # What identifies one enrichment row, per the write path's own lookup
        # (#927). `apply_output` SELECTs on exactly these five columns and inserts
        # when it finds none -- a check-then-insert, so two workers in one parallel
        # batch both find nothing and both insert. Production carried 2,219 such
        # pairs, and because that SELECT has no ordering it would then pick one of
        # the two arbitrarily and mark it current: 2,217 bills each one coin flip
        # away from a different summary.
        #
        # NULLS NOT DISTINCT is load-bearing, not decoration. 9,161 of 23,703
        # production rows have no bill_version_id, and a plain UNIQUE lets every
        # one of them duplicate freely, because Postgres does not consider one
        # NULL equal to another -- the same hole audit finding #928 found in
        # three other keys. Measured before adding it: the null rows create no
        # collisions among themselves, so this spelling costs nothing.
        #
        # Named by hand: the convention generates 87 characters for these five
        # columns, past Postgres's 63-character limit, so it would arrive
        # truncated with a hash on the end and the migration would have to
        # hard-code that hash.
        UniqueConstraint(
            "bill_id",
            "bill_version_id",
            "enrichment_type",
            "model_name",
            "source_version_hash",
            name="uq_ai_enrichment_bill_version_type_model_hash",
            postgresql_nulls_not_distinct=True,
        ),
    )


class AskSuggestedAnswerCache(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    """Reusable answers for public questions Alethical itself suggested.

    This table deliberately has no question-text column. A request reaches it only
    after matching a current ``question_prompts`` entry exactly, and only that
    public prompt's fingerprint is retained. Reader-written questions never reach
    this table (docs/product-onboarding/user-data-retention-policy.md).

    ``answer_pipeline_fingerprint`` maps to the table's original
    ``prompt_fingerprint`` column. That compatibility name avoids a database change
    and its release-order risk (#1124). Rows written before #1140 contain the old
    prompt-only hash, so the stronger fingerprint misses them safely.
    """

    __tablename__ = "ask_suggested_answer_cache"

    bill_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("bill.id", ondelete="CASCADE"), nullable=False
    )
    bill_version_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("bill_version.id", ondelete="CASCADE"), nullable=False
    )
    bill_summary_enrichment_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("ai_enrichment.id", ondelete="CASCADE"), nullable=False
    )
    suggestion_index: Mapped[int] = mapped_column(SmallInteger, nullable=False)
    suggestion_fingerprint: Mapped[str] = mapped_column(String(64), nullable=False)
    bill_text_fingerprint: Mapped[str] = mapped_column(String(128), nullable=False)
    answer_pipeline_fingerprint: Mapped[str] = mapped_column(
        "prompt_fingerprint", String(64), nullable=False
    )
    answer_model: Mapped[str] = mapped_column(String(100), nullable=False)
    embedding_model: Mapped[str] = mapped_column(String(100), nullable=False)
    answer_payload: Mapped[dict] = mapped_column(JSONB, nullable=False)

    __table_args__ = (
        UniqueConstraint(
            "bill_id",
            "bill_version_id",
            "bill_summary_enrichment_id",
            "suggestion_index",
            "suggestion_fingerprint",
            "bill_text_fingerprint",
            "prompt_fingerprint",
            "answer_model",
            "embedding_model",
            name="uq_ask_suggested_answer_cache_identity",
        ),
    )


class PolicyAreaCount(Base):
    """Precomputed distinct-bill count per canonical issue, per session (#501).

    A derived cache for GET /policy-areas: the endpoint's ~278ms live rollup of
    ~7,600 free-text ``ai_enrichment`` policy areas up to curated canonical issues
    (``alethical/api/issue_taxonomy.py``) is precomputed here and refreshed at the
    end of the enrichment pipeline (``alethical/pipeline/policy_area_counts.py``).
    The stored counts are byte-identical to that live rollup; the endpoint falls
    back to recomputing live for any session with no rows, so a missing precompute
    degrades safely. No timestamps -- it is a pure count cache, wholly rederivable.
    """

    __tablename__ = "policy_area_count"

    session_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("legislative_session.id"), primary_key=True
    )
    canonical_name: Mapped[str] = mapped_column(String(100), primary_key=True)
    bill_count: Mapped[int] = mapped_column(Integer, nullable=False)

    __table_args__ = (
        # The endpoint reads ORDER BY bill_count DESC, canonical_name ASC per
        # session, so index the session's rows in exactly that order.
        Index(
            "ix_policy_area_count_session_count",
            "session_id",
            text("bill_count DESC"),
            "canonical_name",
        ),
    )


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
    # No search_text here, deliberately (#715, migration 0024): sections carry only
    # their cleaned text. The lexical arm of hybrid retrieval (#380) ranks *chunks*
    # so it can fuse with the chunk-level vector arm, so it indexes
    # RagChunk.search_text below -- a section-level copy had no reader. Reasoning:
    # docs/product-onboarding/grounded-ask-spec.md section 7 (Out of scope).
    clean_text: Mapped[str] = mapped_column(Text, nullable=False)
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


class CommitteeLinkReviewDecision(enum.Enum):
    """What a reviewer decided about one proposed committee.

    ``rejected`` is stored rather than discarded so the proposer stops re-suggesting a
    committee a person has already ruled out, and so "we looked and it is not theirs" is
    distinguishable from "nobody has looked yet".
    """

    confirmed = "confirmed"
    rejected = "rejected"


class LegislatorCampaignCommittee(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    """A person-checked link from an Alethical legislator to a Minnesota committee (#1354).

    **Why this table exists at all, and why it is here rather than on an imported row.**
    Minnesota gives every registered filer a registration number but never links it to a
    person, and `docs/architecture/campaign-finance-system-design.md` §5 (Identity) is
    explicit that a candidate joins a legislator only through a link a person has checked.
    §4.4 (What survives replacement) then decides *where* that link may live: the imported
    payment set is thrown away and rebuilt on every load, so a link stored against an
    imported row would be destroyed silently on the next download. Both sides of this
    table are durable identifiers that outlive any snapshot — our own legislator id, and
    the state's registration number — which is exactly the first of the three kinds §4.4
    sorts human decisions into.

    Nothing writes here without a person confirming. There is no upsert-from-proposal path
    and deliberately no default for ``reviewed_by``: a row with no reviewer is a row that
    cannot be written.
    """

    __tablename__ = "legislator_campaign_committee"

    # No ON DELETE rule, matching every other legislator_id foreign key here. A cascade
    # would let `cleanup_orphan_legislators` silently destroy a decision a person made;
    # with no rule the delete raises instead, which is the outcome we want if a machine
    # cleanup is ever about to throw away checked human work.
    legislator_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("legislator.id"), nullable=False
    )
    # Text, not an integer. Every number in the 11 Aug 2026 download is 5 digits with no
    # leading zero, so an integer would work today -- but this is an external identifier
    # nothing ever does arithmetic on, and storing it as text means a future 6-digit or
    # zero-padded number cannot silently change value.
    registration_number: Mapped[str] = mapped_column(String(20), nullable=False)
    decision: Mapped[CommitteeLinkReviewDecision] = mapped_column(
        SQLEnum(CommitteeLinkReviewDecision, name="committee_link_review_decision"),
        nullable=False,
    )
    # What the reviewer actually read, kept as a note about this decision rather than as
    # data about the committee. The Board publishes a committee's *current* name against
    # all of its history, so the name here can legitimately differ from the name the next
    # download shows for the same number, and that difference is a thing to notice rather
    # than a contradiction to resolve.
    committee_name_as_reviewed: Mapped[str] = mapped_column(Text, nullable=False)
    # The office and period §7 (Display rules) requires each link to carry: "a confirmed
    # link is one-to-many and carries each committee's office and period, a figure says
    # which committee it belongs to rather than only which year". The office is what lets a
    # surface keep a race for a different office off a legislator's profile, and the years
    # are what let a figure name its committee's period instead of a bare year.
    office_as_reviewed: Mapped[Optional[str]] = mapped_column(String(40))
    first_year_as_reviewed: Mapped[Optional[str]] = mapped_column(String(4))
    last_year_as_reviewed: Mapped[Optional[str]] = mapped_column(String(4))
    reviewed_by: Mapped[str] = mapped_column(String(120), nullable=False)
    reviewed_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    # What the reviewer checked, in their own words. Free text on purpose: the cases that
    # need a person are the ones no field anticipated.
    evidence: Mapped[Optional[str]] = mapped_column(Text)

    legislator: Mapped["Legislator"] = relationship()

    __table_args__ = (
        # Named explicitly: the metadata convention would generate a 66-character
        # identifier, and Postgres truncates at 63.
        UniqueConstraint(
            "legislator_id",
            "registration_number",
            name="uq_legislator_campaign_committee_legislator_registration",
        ),
        # One committee belongs to one candidate, so a confirmed number may appear once
        # across the whole table. This is the index that makes publishing one person's
        # money under two legislators' names impossible rather than merely unlikely.
        # Partial, because the same number may be *rejected* for several legislators --
        # that is what ruling out a shared surname looks like.
        Index(
            "uq_legislator_campaign_committee_confirmed_registration",
            "registration_number",
            unique=True,
            postgresql_where=text("decision = 'confirmed'"),
        ),
    )


# --- Campaign finance -------------------------------------------------------
#
# The one place ingestion departs from every other source here: bills,
# legislators and votes are fetched per record and upserted, while campaign
# finance downloads whole files and replaces whole sets. Minnesota publishes no
# per-transaction identifier and two payments can be legitimately identical, so
# no key built from a row's contents can separate a genuine repeat payment from a
# re-import. Full reasoning:
# docs/architecture/campaign-finance-system-design.md §4 (Ingestion: snapshot and
# replace). File retention and its stores: §4.5.


class CampaignFinanceDataset(enum.Enum):
    contributions = "contributions"
    expenditures = "expenditures"
    independent_expenditures = "independent_expenditures"


class CampaignFinanceFilerKind(enum.Enum):
    """Which of Minnesota's 3 registered-filer kinds a registration number is.

    Not cosmetic, and not derivable from the number: it decides which viewer the
    Board's own services answer for, and **asking the wrong one returns HTTP 200
    with no figures at all** rather than an error (#1408). It also decides which set
    of labels a filer's figures carry — a candidate committee reports 17 lines and
    breaks its money in down by contributor type, while a party unit and a committee
    or fund report 16 and carry one combined contributions line.
    """

    candidate_committee = "candidate_committee"
    party_unit = "party_unit"
    political_committee_or_fund = "political_committee_or_fund"


class CampaignFinanceReconcileOutcome(enum.Enum):
    """Whether one filer-year's official total can be shown beside our payments.

    This is the value a display surface reads before printing a split, because
    `docs/architecture/campaign-finance-system-design.md` §7 is explicit that until a
    filer-year passes its check, its split is not published. Every value that is not
    ``reconciled`` means "print the named payments alone, with no whole to divide".
    """

    # Our itemized rows fit inside the filer's own reported contributions total, so
    # the remainder is money the state never named and the two-number card is honest.
    reconciled = "reconciled"
    # Our rows exceed the official total. A negative remainder is a failed
    # reconciliation, never a figure to clamp (§9.5).
    rows_exceed_reported_total = "rows_exceed_reported_total"
    # A special-election filer files a second report series that the totals route does
    # not return, so its regular figures are a part of the year rather than the year.
    # Known, measured, and not a fault: 10 of 407 committee-years.
    special_election_series_missing = "special_election_series_missing"
    # The Board returned no figures for this filer-year at all. Consistent with a
    # filer that filed nothing, and indistinguishable from it in the response alone,
    # which is why it is corroborated against the filer's report catalogue.
    no_reported_figures = "no_reported_figures"
    # We hold a reported total and no itemized payment rows to compare it against.
    # Left as its own value rather than folded into ``reconciled``, because "the state
    # named nobody" and "we hold nobody" look identical on a card and are not the
    # same claim.
    no_itemized_rows = "no_itemized_rows"


class CampaignFinanceSnapshotStatus(enum.Enum):
    # Bytes fetched and stored; not yet checked.
    fetched = "fetched"
    # Failed §4.3's checks. Body kept for diagnosis, never published, rows never
    # written. Also the state a first import lands in until an operator names the
    # exact hashes they reviewed.
    quarantined = "quarantined"
    # Passed, rows written.
    loaded = "loaded"
    # Rows deleted because no published release referenced them. MUST NOT be
    # reused as an "unchanged" snapshot: the Board can republish identical bytes,
    # and reusing this would publish a dataset with no rows. Reload from the
    # retained body instead.
    pruned = "pruned"


class CampaignFinanceReleaseStatus(enum.Enum):
    building = "building"
    published = "published"
    superseded = "superseded"


class CampaignFinanceSnapshot(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    """One distinct set of records for one dataset, and the bytes it came in.

    Two hashes, because they answer different questions and only one of them can
    answer "did the data change":

    * ``content_hash`` is the sha256 of the **response bytes** we kept, never of
      decoded text — the ``content_hash`` helper in
      alethical/pipeline/minnesota.py takes a ``str`` and must never be reused for
      file identity. It identifies the retained object.
    * ``record_set_hash`` is a hash over the file's records, sorted, so row order
      cannot change it. **This is the change detector**, because the Board's export
      is byte-unstable: 3 downloads of the independent-expenditures file seconds
      apart on 11 Aug 2026 returned 3 different byte hashes at an identical size,
      with an identical multiset of 41,130 records and 35,905 of the 41,130
      positions differing. Keyed on the bytes alone, every single run would look
      like a new file, publish a new release, renumber every row, and prune the set
      it just replaced.

    Null ``record_set_hash`` means the download could not be parsed. Those are
    retained too, so the column is nullable and its unique index is partial.
    """

    __tablename__ = "cf_snapshot"

    dataset: Mapped[CampaignFinanceDataset] = mapped_column(
        SQLEnum(CampaignFinanceDataset, name="cf_dataset"), nullable=False
    )
    # Signed integer, as text. All 3 "All" files are NEGATIVE, so a `\d+` pattern
    # silently resolves a different address (§2.1).
    download_id: Mapped[str] = mapped_column(String(32), nullable=False)
    source_url: Mapped[str] = mapped_column(Text, nullable=False)
    # The Board names the file in Content-Disposition ("All - Itemized
    # Contributions Received Of Over $200 - Campaign Finance.csv"). Checked on
    # fetch, because a stale download number returns HTTP 200 with an HTML error
    # page rather than failing.
    content_disposition_filename: Mapped[Optional[str]] = mapped_column(Text)
    content_hash: Mapped[str] = mapped_column(String(64), nullable=False)
    record_set_hash: Mapped[Optional[str]] = mapped_column(String(64))
    byte_size: Mapped[int] = mapped_column(BigInteger, nullable=False)
    row_count: Mapped[Optional[int]] = mapped_column(Integer)
    column_names: Mapped[Optional[list]] = mapped_column(JSONB)
    status: Mapped[CampaignFinanceSnapshotStatus] = mapped_column(
        SQLEnum(CampaignFinanceSnapshotStatus, name="cf_snapshot_status"),
        nullable=False,
    )

    # The measurements §4.3's checks compare a candidate against. Kept on the
    # snapshot rather than recomputed from rows, so a superseded set's rows can be
    # pruned without losing the ability to validate the next download.
    amount_sum: Mapped[Optional[Decimal]] = mapped_column(Numeric(20, 4))
    negative_amount_sum: Mapped[Optional[Decimal]] = mapped_column(Numeric(20, 4))
    blank_date_count: Mapped[Optional[int]] = mapped_column(Integer)
    distinct_row_count: Mapped[Optional[int]] = mapped_column(Integer)
    distinct_filer_count: Mapped[Optional[int]] = mapped_column(Integer)
    rows_by_year: Mapped[Optional[dict]] = mapped_column(JSONB)
    blank_counts_by_column: Mapped[Optional[dict]] = mapped_column(JSONB)
    # Records carrying the source's non-RFC-4180 backslash-escaped quote
    # (`"Amazon.com, 1.5\" Micro Rod"`). Tracked as a number so a change in the
    # Board's export surfaces instead of becoming silent corruption. Never
    # repaired at ingestion: no mechanical rule fixes these without damaging
    # other rows (§2.1).
    malformed_quote_record_count: Mapped[Optional[int]] = mapped_column(Integer)

    validation_json: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict)
    error_text: Mapped[Optional[str]] = mapped_column(Text)

    __table_args__ = (
        UniqueConstraint("dataset", "content_hash"),
        # The real identity of a dataset's data. Partial, because an unparseable
        # download has no record set and more than one of those can be retained.
        Index(
            "uq_cf_snapshot_dataset_record_set_hash",
            "dataset",
            "record_set_hash",
            unique=True,
            postgresql_where=text("record_set_hash IS NOT NULL"),
        ),
        # Lets cf_release's per-dataset columns carry a composite foreign key, so
        # the contributions slot physically cannot hold an expenditures snapshot.
        UniqueConstraint("id", "dataset", name="uq_cf_snapshot_id_dataset"),
        Index("ix_cf_snapshot_dataset_status", "dataset", "status"),
    )


class CampaignFinanceSnapshotBody(TimestampMixin, Base):
    """Where a snapshot's bytes live, and proof they arrived intact.

    A separate table from ``cf_snapshot`` so an 18 MB object reference never rides
    along on a metadata query, and because the bytes themselves are not in
    Postgres at all: they sit in a private Supabase Storage bucket, mirrored to
    Cloudflare R2 (§4.5). Written only after the upload is read back and verified,
    because a row pointing at a missing object destroys the evidence it claims.
    """

    __tablename__ = "cf_snapshot_body"

    snapshot_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("cf_snapshot.id", ondelete="CASCADE"), primary_key=True
    )
    object_key: Mapped[str] = mapped_column(Text, nullable=False, unique=True)
    # Hash of the compressed object as stored, so the store can be audited
    # without decompressing. The raw hash is cf_snapshot.content_hash.
    compressed_hash: Mapped[str] = mapped_column(String(64), nullable=False)
    compressed_byte_size: Mapped[int] = mapped_column(BigInteger, nullable=False)
    # gzip is written with mtime=0 so identical input always yields identical
    # bytes; without that the same file compresses differently each day and an
    # unchanged download looks new.
    compression: Mapped[str] = mapped_column(String(20), nullable=False, default="gzip")
    mirrored_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True))


class CampaignFinanceFetchObservation(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    """One row per dataset per run, append-only, whether or not anything changed.

    This is what makes "all 3 files were confirmed current in the same run" a
    recorded fact rather than an assumption, and it is why re-running the import
    on unchanged files changes no *published* data while still leaving a trace. A
    mutable "last seen" column could only ever say the latest sighting, never
    every sighting.
    """

    __tablename__ = "cf_fetch_observation"

    snapshot_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("cf_snapshot.id"), nullable=False
    )
    dataset: Mapped[CampaignFinanceDataset] = mapped_column(
        SQLEnum(CampaignFinanceDataset, name="cf_dataset"), nullable=False
    )
    ingestion_run_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        ForeignKey("ingestion_run.id")
    )
    download_id: Mapped[str] = mapped_column(String(32), nullable=False)
    requested_url: Mapped[str] = mapped_column(Text, nullable=False)
    final_url: Mapped[Optional[str]] = mapped_column(Text)
    started_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False
    )
    completed_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False
    )
    byte_size: Mapped[int] = mapped_column(BigInteger, nullable=False)
    content_hash: Mapped[str] = mapped_column(String(64), nullable=False)
    response_headers: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict)
    # True when this run found the bytes unchanged and reused the loaded rows.
    reused_existing_snapshot: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=False
    )

    __table_args__ = (
        Index("ix_cf_fetch_observation_dataset_started", "dataset", "started_at"),
    )


class CampaignFinanceRelease(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    """The set of 3 files published together.

    Three named non-null columns rather than a membership table, because
    ``UNIQUE (release_id, dataset)`` on a membership table happily permits a
    release with 2 members: an importer bug that skipped independent expenditures
    could replace a complete set with an incomplete one. Three columns make that
    unstorable, and each carries a composite foreign key so a slot cannot hold
    another dataset's snapshot.
    """

    __tablename__ = "cf_release"

    contributions_snapshot_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), nullable=False
    )
    expenditures_snapshot_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), nullable=False
    )
    independent_expenditures_snapshot_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), nullable=False
    )
    status: Mapped[CampaignFinanceReleaseStatus] = mapped_column(
        SQLEnum(CampaignFinanceReleaseStatus, name="cf_release_status"), nullable=False
    )
    # The run's fetch window. `fetch_completed_at` is the page's freshness date
    # (#861), NOT a snapshot's first fetch: an unchanged file re-confirmed today
    # is current data, and the 3 downloads take ~93 seconds so the window is
    # recorded rather than collapsed to an instant.
    fetch_started_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False
    )
    fetch_completed_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False
    )
    published_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True))
    superseded_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True))
    ingestion_run_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        ForeignKey("ingestion_run.id")
    )
    notes: Mapped[Optional[str]] = mapped_column(Text)
    # Which set of Minnesota's own reported figures these rows were reconciled against
    # (#1408). Recorded so the pair is auditable rather than only guarded: the 2
    # pipelines take different locks by design, so "these rows were checked against
    # those figures" is a fact about a moment, and a page showing a total beside its
    # itemized payments is showing that pair. Nullable, because every release published
    # before the figures existed has no answer, and inventing one would be worse than
    # saying so.
    filing_snapshot_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        ForeignKey("cf_filing_snapshot.id")
    )

    __table_args__ = (
        # Composite keys: the snapshot in each slot must be of that dataset.
        ForeignKeyConstraint(
            ["contributions_snapshot_id", "contributions_dataset"],
            ["cf_snapshot.id", "cf_snapshot.dataset"],
            name="fk_cf_release_contributions_snapshot",
        ),
        ForeignKeyConstraint(
            ["expenditures_snapshot_id", "expenditures_dataset"],
            ["cf_snapshot.id", "cf_snapshot.dataset"],
            name="fk_cf_release_expenditures_snapshot",
        ),
        ForeignKeyConstraint(
            ["independent_expenditures_snapshot_id", "independent_dataset"],
            ["cf_snapshot.id", "cf_snapshot.dataset"],
            name="fk_cf_release_independent_snapshot",
        ),
        Index("ix_cf_release_status", "status"),
    )

    # Generated columns exist only to give the composite foreign keys above their
    # second column. Never read them; read `dataset` on the snapshot.
    contributions_dataset: Mapped[str] = mapped_column(
        SQLEnum(CampaignFinanceDataset, name="cf_dataset"),
        Computed("'contributions'", persisted=True),
        nullable=False,
    )
    expenditures_dataset: Mapped[str] = mapped_column(
        SQLEnum(CampaignFinanceDataset, name="cf_dataset"),
        Computed("'expenditures'", persisted=True),
        nullable=False,
    )
    independent_dataset: Mapped[str] = mapped_column(
        SQLEnum(CampaignFinanceDataset, name="cf_dataset"),
        Computed("'independent_expenditures'", persisted=True),
        nullable=False,
    )


class CampaignFinanceCurrentRelease(TimestampMixin, Base):
    """A single row naming the live release. One row, forever.

    A pointer row rather than a status string, so publishing can take
    ``SELECT ... FOR UPDATE`` on it, re-read the candidate's hashes and fetch
    window, and refuse a candidate older than what is already published. Without
    that, two overlapping imports let the one that *started* first finish last
    and replace newer data with older data — a "one published release" rule
    limits quantity, not age.
    """

    __tablename__ = "cf_current_release"

    id: Mapped[bool] = mapped_column(
        Boolean, primary_key=True, default=True, server_default=text("true")
    )
    release_id: Mapped[Optional[uuid.UUID]] = mapped_column(ForeignKey("cf_release.id"))

    __table_args__ = (CheckConstraint("id", name="single_row"),)


# The 3 row tables below mirror their download's columns one for one, and carry
# nothing else. Rules that apply to all 3, each for a measured reason:
#
# * ``(snapshot_id, row_number)`` is the primary key. ``row_number`` is the
#   1-based CSV *record* number, not a physical line: 720 newlines sit inside
#   quoted fields, so a line count is not a row count. The pair traces a
#   displayed figure back to a line in one specific dated download and is
#   explicitly NOT an identity across downloads (§4.2). Making it the primary key
#   also means a second loader copying the same snapshot's rows fails loudly on a
#   duplicate key rather than doubling every figure.
# * Money is ``numeric(18,4)``. Amounts print 4 decimal places and 4 expenditure
#   rows are finer than a cent, so 2 decimals would round real money.
# * Zips, registration numbers, codes and flags are text exactly as printed.
#   9,007 zips are shorter than 5 characters, so a numeric zip loses a leading
#   zero. ``in_kind`` reads "Yes"/"No" and stays those words rather than becoming
#   a boolean, because a boolean invents a mapping the file does not state.
# * The date column is ``transaction_date`` on the 2 files whose header calls it
#   plainly "Date", and ``receipt_date`` on the contributions file, whose header
#   says "Receipt date". Not ``date``: a column of that name shadows the ``date``
#   type inside its own annotation, which SQLAlchemy resolves at runtime and a
#   static type checker does not. Not ``payment_date`` either — the expenditures
#   file's ``Amount`` is the filing's *total* column and a row may be unpaid, so
#   calling it a payment date would assert something the file does not.
# * ``year`` is the file's own ``Year`` column, which is a separate claim from the
#   row's date and disagrees with it on 702 rows across the 3 files. Both are
#   stored and neither is derived from the other.
# * Blank becomes NULL, never an invented value.
# * No timestamps. The snapshot owns the time, and a per-row timestamp invites
#   someone to read it as data. Nothing human may live here either: the published
#   set is rebuilt on every load, so anything stored here is silently destroyed
#   (§4.4). ``test_campaign_finance_load.py`` asserts these tables carry only the
#   source's columns plus those two.


class CampaignFinanceContributionRow(Base):
    """One record of the "Itemized contributions received of over $200" download.

    15 source columns. ``receipt_type`` carries 4 values and only
    ``Contribution`` belongs in a contribution total — 1.2% of rows are
    ``Miscellaneous``, ``Miscellaneous Income`` or ``Loan Payable``, which the
    filing reports on separate schedules (§2.1). Filter on it before comparing
    anything against a reported contribution figure.
    """

    __tablename__ = "cf_contribution_row"

    snapshot_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("cf_snapshot.id", ondelete="CASCADE"), primary_key=True
    )
    row_number: Mapped[int] = mapped_column(Integer, primary_key=True)

    recipient_reg_num: Mapped[Optional[str]] = mapped_column(Text)  # Recipient reg num
    recipient: Mapped[Optional[str]] = mapped_column(Text)  # Recipient
    recipient_type: Mapped[Optional[str]] = mapped_column(Text)  # Recipient type
    recipient_subtype: Mapped[Optional[str]] = mapped_column(Text)  # Recipient subtype
    amount: Mapped[Optional[Decimal]] = mapped_column(Numeric(18, 4))  # Amount
    receipt_date: Mapped[Optional[date]] = mapped_column(Date)  # Receipt date
    year: Mapped[Optional[int]] = mapped_column(Integer)  # Year
    contributor: Mapped[Optional[str]] = mapped_column(Text)  # Contributor
    contrib_reg_num: Mapped[Optional[str]] = mapped_column(Text)  # Contrib Reg Num
    contrib_type: Mapped[Optional[str]] = mapped_column(Text)  # Contrib type
    receipt_type: Mapped[Optional[str]] = mapped_column(Text)  # Receipt type
    in_kind: Mapped[Optional[str]] = mapped_column(Text)  # In kind?
    in_kind_descr: Mapped[Optional[str]] = mapped_column(Text)  # In-kind descr
    contrib_zip: Mapped[Optional[str]] = mapped_column(Text)  # Contrib zip
    contrib_employer_name: Mapped[Optional[str]] = mapped_column(
        Text
    )  # Contrib Employer name

    __table_args__ = (
        Index("ix_cf_contribution_row_recipient", "recipient_reg_num", "year"),
    )


class CampaignFinanceExpenditureRow(Base):
    """One record of the "Itemized general expenditures and contributions made of
    over $200" download.

    18 source columns. Two things about this file change what a comparison means
    (§2.1): ``amount`` is the filing's *total* column, not its paid column, and
    ``type`` has 6 values where a candidate committee and a party unit use
    different labels for the same thing — so filtering on one label alone
    silently drops a whole kind of filer.
    """

    __tablename__ = "cf_expenditure_row"

    snapshot_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("cf_snapshot.id", ondelete="CASCADE"), primary_key=True
    )
    row_number: Mapped[int] = mapped_column(Integer, primary_key=True)

    committee_reg_num: Mapped[Optional[str]] = mapped_column(Text)  # Committee reg num
    committee_name: Mapped[Optional[str]] = mapped_column(Text)  # Committee name
    entity_type: Mapped[Optional[str]] = mapped_column(Text)  # Entity type
    entity_sub_type: Mapped[Optional[str]] = mapped_column(Text)  # Entity sub-type
    vendor_name: Mapped[Optional[str]] = mapped_column(Text)  # Vendor name
    vendor_city: Mapped[Optional[str]] = mapped_column(Text)  # Vendor city
    vendor_state: Mapped[Optional[str]] = mapped_column(Text)  # Vendor state
    vendor_zip: Mapped[Optional[str]] = mapped_column(Text)  # Vendor zip
    amount: Mapped[Optional[Decimal]] = mapped_column(Numeric(18, 4))  # Amount
    unpaid_amount: Mapped[Optional[Decimal]] = mapped_column(
        Numeric(18, 4)
    )  # Unpaid amount
    transaction_date: Mapped[Optional[date]] = mapped_column(Date)  # Date
    purpose: Mapped[Optional[str]] = mapped_column(Text)  # Purpose
    year: Mapped[Optional[int]] = mapped_column(Integer)  # Year
    type: Mapped[Optional[str]] = mapped_column(Text)  # Type
    in_kind_descr: Mapped[Optional[str]] = mapped_column(Text)  # In-kind descr
    in_kind: Mapped[Optional[str]] = mapped_column(Text)  # In-kind?
    affected_committee_name: Mapped[Optional[str]] = mapped_column(
        Text
    )  # Affected committee name
    affected_committee_reg_num: Mapped[Optional[str]] = mapped_column(
        Text
    )  # Affected committee reg num

    __table_args__ = (
        Index("ix_cf_expenditure_row_committee", "committee_reg_num", "year"),
    )


class CampaignFinanceIndependentExpenditureRow(Base):
    """One record of the "Itemized independent expenditures of over $200" download.

    19 source columns. Every row names an affected *committee* and none names a
    person, so no surface may promise "money spent about this legislator" before
    that committee's link to a legislator is confirmed (§7). Two column names are
    spelled out here where the file abbreviates them ("Affected Comte Name",
    "Affected Cmte Reg Num"), so the same fact reads the same way as on the
    expenditures table; the exact source header each one maps from is pinned in
    ``alethical/pipeline/campaign_finance.py``.
    """

    __tablename__ = "cf_independent_expenditure_row"

    snapshot_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("cf_snapshot.id", ondelete="CASCADE"), primary_key=True
    )
    row_number: Mapped[int] = mapped_column(Integer, primary_key=True)

    spender: Mapped[Optional[str]] = mapped_column(Text)  # Spender
    spender_reg_num: Mapped[Optional[str]] = mapped_column(Text)  # Spender Reg Num
    spender_type: Mapped[Optional[str]] = mapped_column(Text)  # Spender type
    spender_sub_type: Mapped[Optional[str]] = mapped_column(Text)  # Spender sub-type
    affected_committee_name: Mapped[Optional[str]] = mapped_column(
        Text
    )  # Affected Comte Name
    affected_committee_reg_num: Mapped[Optional[str]] = mapped_column(
        Text
    )  # Affected Cmte Reg Num
    for_against: Mapped[Optional[str]] = mapped_column(Text)  # For /Against
    year: Mapped[Optional[int]] = mapped_column(Integer)  # Year
    transaction_date: Mapped[Optional[date]] = mapped_column(Date)  # Date
    type: Mapped[Optional[str]] = mapped_column(Text)  # Type
    amount: Mapped[Optional[Decimal]] = mapped_column(Numeric(18, 4))  # Amount
    unpaid_amount: Mapped[Optional[Decimal]] = mapped_column(
        Numeric(18, 4)
    )  # Unpaid amount
    in_kind: Mapped[Optional[str]] = mapped_column(Text)  # In kind?
    in_kind_descr: Mapped[Optional[str]] = mapped_column(Text)  # In kind descr
    purpose: Mapped[Optional[str]] = mapped_column(Text)  # Purpose
    vendor_name: Mapped[Optional[str]] = mapped_column(Text)  # Vendor name
    vendor_city: Mapped[Optional[str]] = mapped_column(Text)  # Vendor city
    vendor_state: Mapped[Optional[str]] = mapped_column(Text)  # Vendor State
    vendor_zip: Mapped[Optional[str]] = mapped_column(Text)  # Vendor zip

    __table_args__ = (
        Index("ix_cf_independent_expenditure_row_spender", "spender_reg_num", "year"),
        Index(
            "ix_cf_independent_expenditure_row_affected",
            "affected_committee_reg_num",
            "year",
        ),
    )


# --- Campaign finance: what each filer itself reported -----------------------
#
# The 3 tables above hold the payments Minnesota itemized. These hold what each
# committee said it raised and spent in total, which is a different and larger
# number: roughly 4 dollars in 10 that a sitting member raised has no name attached,
# because the state only names a donor once their giving passes $200 for the year.
# `.claude/rules/grounded-answers.md` rule 12 requires both numbers on the page, so
# without these tables no surface may print a total at all.
#
# Same promise as the tables above and for the same reasons -- a dated set, checked
# before anything is published, published by replacing the previous set entirely, and
# traceable to the exact bytes the Board served. What differs is the source's shape:
# these come from 3 undocumented per-filer services rather than from whole-file
# downloads, and all 3 answer HTTP 200 to several kinds of failure, which is why the
# checks in `alethical/pipeline/campaign_finance_filings.py` are the design rather
# than a safety net. Full reasoning:
# docs/architecture/campaign-finance-system-design.md §9 (Filed reports: where the
# official totals come from).


class CampaignFinanceFilingSnapshot(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    """One run of the Board's per-filer services, and the responses it kept.

    Unlike the 3 downloads, whose bytes are one file each, a run here makes about
    4,800 requests. Their bodies are kept as **one gzipped JSON Lines object per
    run**, each line carrying one response's own sha256 and its base64-encoded bytes,
    so a published figure traces to a line and that line's bytes can be proved to be
    the ones it was read from. One object rather than 4,800 because 4,800 tiny objects
    would cost more to store and to audit than the evidence is worth, and the
    per-response hash keeps the tracing exact either way.

    ``record_set_hash`` is the change detector, hashed over the parsed figures sorted,
    so a run that finds every filer unchanged publishes nothing. The archive's own
    hash cannot do that job: response bodies carry no ordering guarantee and the
    request timings differ every run.
    """

    __tablename__ = "cf_filing_snapshot"

    # The run's fetch window, not an instant. A run takes about 48 minutes, and an
    # amendment can land inside it, so the window is recorded rather than collapsed --
    # the same hazard §4.1 rules on for the downloads, with the same answer.
    fetch_started_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False
    )
    fetch_completed_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False
    )
    status: Mapped[CampaignFinanceSnapshotStatus] = mapped_column(
        SQLEnum(CampaignFinanceSnapshotStatus, name="cf_snapshot_status"),
        nullable=False,
    )
    record_set_hash: Mapped[Optional[str]] = mapped_column(String(64))
    # The calendar years asked for, and the 2-year election segments they resolve to.
    # Both are stored because they are not the same thing and the difference is a
    # trap: the route ignores its own `year` field, so the segment alone decides which
    # 2 years come back.
    years: Mapped[Optional[list]] = mapped_column(JSONB)
    segments: Mapped[Optional[list]] = mapped_column(JSONB)

    filer_count: Mapped[Optional[int]] = mapped_column(Integer)
    report_count: Mapped[Optional[int]] = mapped_column(Integer)
    filing_count: Mapped[Optional[int]] = mapped_column(Integer)
    figure_count: Mapped[Optional[int]] = mapped_column(Integer)
    # Filer-years we asked for and the Board returned no figures for. Consistent with
    # a filer that filed nothing, and **indistinguishable from asking the wrong
    # viewer**, which answers 200 with no table at all -- so this is a measured share
    # rather than a per-filer judgement, and a jump in it stops a release.
    filer_years_without_figures: Mapped[Optional[int]] = mapped_column(Integer)
    reported_contributions_sum: Mapped[Optional[Decimal]] = mapped_column(
        Numeric(20, 4)
    )
    measurements: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict)
    validation_json: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict)
    error_text: Mapped[Optional[str]] = mapped_column(Text)
    ingestion_run_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        ForeignKey("ingestion_run.id")
    )

    # The archive. Folded onto this row rather than given its own table, because there
    # is exactly one archive per run -- unlike the downloads, where one body serves
    # many reshuffled fetches of the same records and the split earns itself.
    object_key: Mapped[Optional[str]] = mapped_column(Text)
    compressed_hash: Mapped[Optional[str]] = mapped_column(String(64))
    compressed_byte_size: Mapped[Optional[int]] = mapped_column(BigInteger)
    compression: Mapped[str] = mapped_column(String(20), nullable=False, default="gzip")
    response_count: Mapped[Optional[int]] = mapped_column(Integer)
    mirrored_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True))

    __table_args__ = (
        Index(
            "uq_cf_filing_snapshot_record_set_hash",
            "record_set_hash",
            unique=True,
            postgresql_where=text("record_set_hash IS NOT NULL"),
        ),
        Index("ix_cf_filing_snapshot_status", "status"),
    )


class CampaignFinanceFilingCurrentSnapshot(TimestampMixin, Base):
    """A single row naming the live filings snapshot. One row, forever.

    Exists for the same reason ``cf_current_release`` does: publishing takes
    ``SELECT ... FOR UPDATE`` on it and refuses a candidate whose fetch window opened
    before the live one's, because a rule limiting how many snapshots are published
    limits quantity and says nothing about age.
    """

    __tablename__ = "cf_filing_current"

    id: Mapped[bool] = mapped_column(
        Boolean, primary_key=True, default=True, server_default=text("true")
    )
    snapshot_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        ForeignKey("cf_filing_snapshot.id")
    )

    __table_args__ = (CheckConstraint("id", name="single_row"),)


class CampaignFinanceFiler(Base):
    """One registered filer, as the Board's nightly directory lists them.

    **The 3 lists are not the same width.** A candidate row carries 11 columns
    including party, office sought and district; a party-unit row and a
    committee-or-fund row carry 4 -- name, registration number, registration date and
    termination date. So ``party``, ``office`` and ``district`` are legitimately empty
    for two of the three kinds rather than missing, and nothing may read their absence
    as a gap to fill.

    No timestamps, and nothing human may live here, for the same reason as the row
    tables above: the set is rebuilt on every run, so anything stored here is
    destroyed silently. A person's checked link to a legislator lives in
    ``legislator_campaign_committee``, keyed on the registration number, which is
    durable across every snapshot.
    """

    __tablename__ = "cf_filer"

    snapshot_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("cf_filing_snapshot.id", ondelete="CASCADE"), primary_key=True
    )
    registration_number: Mapped[str] = mapped_column(String(20), primary_key=True)
    kind: Mapped[CampaignFinanceFilerKind] = mapped_column(
        SQLEnum(CampaignFinanceFilerKind, name="cf_filer_kind"), nullable=False
    )
    name: Mapped[str] = mapped_column(Text, nullable=False)
    candidate_name: Mapped[Optional[str]] = mapped_column(Text)
    party: Mapped[Optional[str]] = mapped_column(String(20))
    office: Mapped[Optional[str]] = mapped_column(String(60))
    district: Mapped[Optional[str]] = mapped_column(String(20))
    registration_date: Mapped[Optional[date]] = mapped_column(Date)
    # Registration-level, and the reason a year can be empty for a reason none of the
    # other display states describes (§7's fifth state, a closed committee).
    termination_date: Mapped[Optional[date]] = mapped_column(Date)
    # The Board's own flag. **Not a synonym for "sitting legislator"** -- only 198 of
    # 209 flagged rows are legislative seats and 5 sitting members have no flagged
    # live filer in their own seat -- so it is stored as the Board's claim and never
    # read as ours (§9.7).
    is_incumbent: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)


class CampaignFinanceFilingReport(Base):
    """One report as the Board's own catalogue lists it.

    Keyed ``(snapshot_id, row_number)`` rather than on the report's apparent natural
    key, because nothing establishes that a filer cannot list two reports of the same
    type in the same year, and a unique constraint asserting otherwise would stop a
    release over a claim we never measured. Nothing here needs uniqueness: every read
    asks whether a filer-year has *any* report, or whether *any* of them is a
    special-election one.

    ``TerminationDate`` is deliberately absent. The catalogue copies it onto every
    report row, including reports filed years earlier -- read as "this report
    terminated the committee" it is wrong on 15 of one filer's 16 rows -- so it is
    stored once per filer on ``cf_filer`` and never per report.
    """

    __tablename__ = "cf_filing_report"

    snapshot_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("cf_filing_snapshot.id", ondelete="CASCADE"), primary_key=True
    )
    row_number: Mapped[int] = mapped_column(Integer, primary_key=True)
    registration_number: Mapped[str] = mapped_column(String(20), nullable=False)
    filing_year: Mapped[int] = mapped_column(Integer, nullable=False)
    report_type: Mapped[str] = mapped_column(String(8), nullable=False)
    report_name: Mapped[Optional[str]] = mapped_column(Text)
    # The period's end, served as a clean value. Nothing needs a date parsed out of a
    # label to know when a period ended. No period *start* is served anywhere, which
    # is why §7 forbids hardcoding 1 January.
    cut_off_date: Mapped[Optional[date]] = mapped_column(Date)
    # A candidate in a special election files a whole second report series, and the
    # totals service returns only the regular one. This flag is what tells a
    # reconciliation that came out negative apart from a new fault.
    special_election: Mapped[bool] = mapped_column(Boolean, nullable=False)
    # The highest amendment index after deduplicating, which is the effective version
    # (§9.6). Deduplicating matters: one report's list reads ['1','0','1','0'].
    # Nullable, and NULL means "the catalogue carries no amendment record for this
    # report" rather than "this report was never amended". Ordinary on old reports: 5
    # of filer 20008's 64 reports serve no list, all from 2004, 2006 and 2007. Storing
    # 0 would assert the original version is effective, and §9.4 is explicit that a
    # missing marker in an older year means the document is unavailable.
    effective_amendment_index: Mapped[Optional[int]] = mapped_column(Integer)
    amendment_count: Mapped[Optional[int]] = mapped_column(Integer)

    __table_args__ = (
        Index(
            "ix_cf_filing_report_filer_year",
            "snapshot_id",
            "registration_number",
            "filing_year",
        ),
    )


class CampaignFinanceFiling(UUIDPrimaryKeyMixin, Base):
    """One filer's own reported figures for one calendar year.

    Called a filing because that is what it is: every report in a Minnesota calendar
    year restates everything since 1 January, so the year's most recent report *is*
    the year, and these are that report's figures with its amendments already
    resolved by the Board.

    ``reported_through`` is the figure's coverage end and it is load-bearing rather
    than decorative: members sit on two different filing calendars, so on any day in
    2026 one member's part-year total sits beside another member's blank, and §7
    forbids ranking or totalling members for the current year because of it. This
    column is what makes that enforceable per figure instead of per page.
    """

    __tablename__ = "cf_filing"

    snapshot_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("cf_filing_snapshot.id", ondelete="CASCADE"), nullable=False
    )
    registration_number: Mapped[str] = mapped_column(String(20), nullable=False)
    filer_kind: Mapped[CampaignFinanceFilerKind] = mapped_column(
        SQLEnum(CampaignFinanceFilerKind, name="cf_filer_kind"), nullable=False
    )
    filing_year: Mapped[int] = mapped_column(Integer, nullable=False)
    # The 2-year window that was asked for. Kept because the route ignores its own
    # `year` field and answers from the segment alone, so the segment is the only
    # record of what was actually requested.
    segment_start: Mapped[int] = mapped_column(Integer, nullable=False)
    segment_end: Mapped[int] = mapped_column(Integer, nullable=False)
    # The block's heading exactly as served ("2025 - Election year", and for a
    # committee or fund in an odd year simply "2025"). Kept verbatim rather than
    # normalised, because the suffix differs by viewer and a parser that required it
    # would work on candidates and break on funds.
    block_heading: Mapped[str] = mapped_column(Text, nullable=False)
    reported_through: Mapped[Optional[date]] = mapped_column(Date)
    # Which response this year's figures were read from, and where that response sits
    # in the run's archive. Together they are the trace from a published number back
    # to the bytes behind it.
    response_hash: Mapped[str] = mapped_column(String(64), nullable=False)
    archive_line: Mapped[int] = mapped_column(Integer, nullable=False)

    figures: Mapped[list["CampaignFinanceFilingFigure"]] = relationship(
        cascade="all, delete-orphan"
    )

    __table_args__ = (
        UniqueConstraint(
            "snapshot_id",
            "registration_number",
            "filing_year",
            name="uq_cf_filing_snapshot_filer_year",
        ),
    )


class CampaignFinanceFilingFigure(Base):
    """One labelled money line of one filing.

    A row per line rather than a column per line, because the two filer kinds report
    different lines under different names -- a candidate committee 17 and a party unit
    or fund 16 -- and columns would be a mostly-empty union of both. ``line_key`` is
    ours and stable; ``label_as_served`` is the Board's own wording, kept because 3 of
    the labels carry a date inside them and that date is a fact about the figure.
    """

    __tablename__ = "cf_filing_figure"

    filing_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("cf_filing.id", ondelete="CASCADE"), primary_key=True
    )
    line_key: Mapped[str] = mapped_column(String(48), primary_key=True)
    label_as_served: Mapped[str] = mapped_column(Text, nullable=False)
    amount: Mapped[Decimal] = mapped_column(Numeric(18, 4), nullable=False)


class CampaignFinanceStatedSplitStatus(enum.Enum):
    """Whether one committee-year's own filing agrees with the payments we hold.

    Four values, and the last two are both "no verdict" for reasons that must never be
    collapsed: one is Minnesota's gap and one is ours. A page that renders them the same
    would let a broken reader of ours silently withhold a working committee's figures,
    or accuse a named politician's filing of contradicting itself when the fault is
    entirely on our side (#1433).
    """

    # The filing's own stated itemized figure equals the payment rows we hold, so the
    # derived "money with no donor named" figure is honest and a split may be drawn.
    agrees = "agrees"
    # They differ. Money we are missing would otherwise land inside the derived figure
    # and become a positive claim that money had no donor, which is the one thing
    # `.claude/rules/grounded-answers.md` rule 12 exists to prevent. Eugene ruled on 12
    # Aug 2026 that where 2 official sources disagree we show both and say so.
    disagrees = "disagrees"
    # The comparison could not be made. The Board serves no report document before
    # 2023, serves none for several report kinds even inside the years it covers, and
    # answers HTTP 200 to every one of those refusals. Recorded as not checked rather
    # than as passed, which is what §9.9 exists to enforce.
    not_checked = "not_checked"
    # A document was served and read, and our own reader disagreed with figures we
    # already trust. The reader is wrong, so no claim is made about the data at all.
    reader_unproven = "reader_unproven"


class CampaignFinanceStatedSplit(Base):
    """One committee-year's filing compared against the payment rows we hold.

    **This is the only half of the reconciliation that can see our rows being short.**
    The other half compares our rows against the committee's reported *total* and so
    catches them being too big; a shortfall still fits inside a total and publishes
    silently. Only the filing's own statement of how much it itemized can see it, and
    that statement exists nowhere but inside the report document (§9.4).

    Keyed on the contributions snapshot because the verdict is about *those* rows. A new
    download replaces the rows, so every verdict about the old ones is void and goes
    with them -- which is what the cascade does. Nothing here is a fact about the
    committee that outlives our copy of its payments.

    Nothing is rebuilt from the document (§2.3). Two subtotals are read per schedule and
    the payments themselves still come from the bulk download.
    """

    __tablename__ = "cf_stated_split"

    snapshot_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("cf_snapshot.id", ondelete="CASCADE"), primary_key=True
    )
    registration_number: Mapped[str] = mapped_column(String(20), primary_key=True)
    filing_year: Mapped[int] = mapped_column(Integer, primary_key=True)

    # Which run of the Board's totals service proved the reader for this document.
    # Nullable, and NULL means the reader could not be proved here rather than that it
    # failed -- see ``self_test``.
    filings_snapshot_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        ForeignKey("cf_filing_snapshot.id", ondelete="SET NULL")
    )
    status: Mapped[CampaignFinanceStatedSplitStatus] = mapped_column(
        SQLEnum(CampaignFinanceStatedSplitStatus, name="cf_stated_split_status"),
        nullable=False,
    )
    # Always populated, including on success, and written for a person to act on. The
    # reader-facing wording belongs to the page (`.claude/rules/grounded-answers.md`
    # rule 3); this is the developer-facing one.
    reason: Mapped[str] = mapped_column(Text, nullable=False)
    # ``passed``, ``failed`` or ``not_available``. The third is real and is not a weak
    # pass: the Board's totals route serves no 2025 block at all for filer 18488, whose
    # 2025 report itemizes $2,300.00, so that document has nothing already-trusted to
    # be proved against.
    self_test: Mapped[Optional[str]] = mapped_column(String(20))

    # Which document was read, so a figure traces to one filing rather than to a year.
    report_type: Mapped[Optional[str]] = mapped_column(String(8))
    amendment_index: Mapped[Optional[int]] = mapped_column(Integer)
    # The period the stated figure runs to, which is what our rows are bounded by. A
    # year-end report and the calendar year coincide; a mid-year report does not, and
    # comparing a whole year of rows against a part-year filing would invent a gap.
    cut_off_date: Mapped[Optional[date]] = mapped_column(Date)
    document_hash: Mapped[Optional[str]] = mapped_column(String(64))
    document_byte_size: Mapped[Optional[int]] = mapped_column(Integer)

    # The filing's own figures. ``stated_itemized`` is the total column, cash plus
    # in-kind, because that is what our payment rows sum to; the cash column is kept
    # beside it because the self-test can only prove cash and because the two can be
    # short by different amounts -- filer 17709's 2025 filing is short $3,640.15 of cash
    # and $492.21 of in-kind.
    stated_itemized: Mapped[Optional[Decimal]] = mapped_column(Numeric(18, 4))
    stated_itemized_cash: Mapped[Optional[Decimal]] = mapped_column(Numeric(18, 4))
    stated_non_itemized: Mapped[Optional[Decimal]] = mapped_column(Numeric(18, 4))
    # Ours, bounded by ``cut_off_date``. A committee we hold no rows for is stored as
    # ``0`` rather than left NULL, because "the filing named $2,300.00 and we hold
    # nothing" is the sharpest case this check exists for and an absent number would
    # read as a year nobody looked at.
    ours_itemized: Mapped[Optional[Decimal]] = mapped_column(Numeric(18, 4))
    ours_itemized_cash: Mapped[Optional[Decimal]] = mapped_column(Numeric(18, 4))

    checked_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False
    )

    __table_args__ = (Index("ix_cf_stated_split_status", "snapshot_id", "status"),)


def bill_detail_stmt(
    bill_id: uuid.UUID,
    user_id: Optional[uuid.UUID] = None,
    load_votes: bool = True,
):
    """Load one bill detail page without per-row lazy loads.

    ``load_votes`` controls whether the roll-call tree
    (``vote_events -> records -> legislator``) is eager-loaded. It defaults to
    ``True`` so the ``/votes`` endpoint (the only caller that reads that tree)
    keeps its behavior. The ``/bills/{id}`` detail payload never reads
    ``vote_events``, so it passes ``load_votes=False`` to drop three
    cross-region round trips it doesn't need.
    """
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
        # Companion bill (+ its actions) so the detail payload can serve the
        # companion's code/status without a lazy load; status_key derives from
        # the companion's actions (#293).
        selectinload(Bill.companion_bill).selectinload(Bill.actions),
        selectinload(Bill.enrichments),
        # The bill's own session, so the page can name the session it belongs to
        # instead of assuming the current one — a special-session bill belongs to a
        # different session than the biennium (#746). A joined FK read, so no extra
        # round trip.
        joinedload(Bill.session),
    ]
    if load_votes:
        options.append(
            selectinload(Bill.vote_events)
            .selectinload(VoteEvent.records)
            .selectinload(VoteRecord.legislator)
        )
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
    "passed_both_chambers": 2,
    "passed_senate": 3,
    "passed_house": 4,
    "in_committee": 5,
    "proposed": 6,
}

# Floor-passage action_text signals (a genuine chamber vote, not a committee
# "to pass" report and not a defeated "not passed" motion). Chamber comes from
# ``bill_action.chamber_id`` — the reliable House/Senate signal (#607).
_PASSAGE_PATTERNS = ("%bill was passed%", "%third reading passed%", "%repassed%")
# Enacted-into-law signals, cumulative once they appear in the action history
# (``current_status`` text alone is unreliable — a signed bill can carry a stale
# or truncated status string, so the milestone is read from the actions).
ENACTED_ACTION_TEXT_FRAGMENTS = (
    "governor approval",
    "governor's action approval",
    "chapter number",
    "secretary of state",
    "effective date",
)
_ENACTED_PATTERNS = tuple(f"%{fragment}%" for fragment in ENACTED_ACTION_TEXT_FRAGMENTS)


def bill_action_terminal_priority(action_text: str | None) -> int:
    """Return the final milestone class shared by ingestion and status badges."""
    normalized = (action_text or "").lower()
    if "veto" in normalized:
        return 2
    if any(fragment in normalized for fragment in ENACTED_ACTION_TEXT_FRAGMENTS):
        return 1
    return 0


def _bill_action_text_exists(patterns):
    """EXISTS(a bill_action of this bill whose action_text matches any pattern)."""
    action_text = func.lower(BillAction.action_text)
    return exists(
        select(1)
        .select_from(BillAction)
        .where(
            BillAction.bill_id == Bill.id,
            or_(*[action_text.like(pattern) for pattern in patterns]),
        )
    )


def _passed_chamber_exists(chamber_slug: str):
    """EXISTS(a floor-passage action of this bill stamped to ``chamber_slug``)."""
    action_text = func.lower(BillAction.action_text)
    return exists(
        select(1)
        .select_from(BillAction)
        .join(Chamber, Chamber.id == BillAction.chamber_id)
        .where(
            BillAction.bill_id == Bill.id,
            Chamber.slug == chamber_slug,
            or_(*[action_text.like(pattern) for pattern in _PASSAGE_PATTERNS]),
            ~action_text.like("%not passed%"),
        )
    )


def bill_status_key_expr():
    """SQL expression yielding a bill's list-card status key.

    The single SQL-side source of truth for status classification, mirroring
    ``bill_compute_status_key`` (alembic 0014) exactly — the equivalence is
    pinned by test_bill_denormalized_signals.py. Cumulative *milestone* signals
    (vetoed / signed into law / passed a chamber) are read from the bill's
    chamber-stamped action history, so House vs Senate passage is reliable and a
    ``passed_both_chambers`` cohort exists; the *current-position* signals
    (in committee vs proposed) still read the latest ``current_status`` text.

    The priority cascade (veto > signed > passed-both > passed-senate >
    passed-house > in-committee > proposed) makes each bill map to exactly one
    status, so the status *filter* (``status_filter_clause``), the displayed
    *badge*, and sort=progress agree, the filters are mutually exclusive, and
    their counts sum to the session total. The value is precomputed into
    ``Bill.status_key`` by DB triggers (on ``bill`` and ``bill_action``), so no
    query-time join is needed; this expression is used only for the backfill's
    equivalence check.
    """
    status = func.lower(func.coalesce(Bill.current_status, ""))
    has_veto = _bill_action_text_exists(("%veto%",)) | status.contains("veto")
    has_enacted = _bill_action_text_exists(_ENACTED_PATTERNS) | or_(
        *[status.like(pattern) for pattern in _ENACTED_PATTERNS]
    )
    passed_house = _passed_chamber_exists("house")
    passed_senate = _passed_chamber_exists("senate")
    return case(
        (has_veto, "vetoed"),
        (has_enacted, "signed_into_law"),
        (passed_house & passed_senate, "passed_both_chambers"),
        (passed_senate, "passed_senate"),
        (passed_house, "passed_house"),
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


def _session_scope_clause(session_id: uuid.UUID | Sequence[uuid.UUID]):
    """Match one session, or any of several.

    A question about "2025 law" spans every session of the Legislature that sat in
    2025 — the regular one and its special session — so the Ask paths pass the whole
    scope while every other caller keeps passing one id (#810). Kept as ``==`` for a
    single id so the existing index plans and query logs do not change shape.
    """
    if isinstance(session_id, (list, tuple, set, frozenset)):
        ids = tuple(session_id)
        if len(ids) == 1:
            return Bill.session_id == ids[0]
        return Bill.session_id.in_(ids)
    return Bill.session_id == session_id


def bill_list_stmt(
    session_id: uuid.UUID | Sequence[uuid.UUID],
    user_id: Optional[uuid.UUID] = None,
    sort: str = "latest_action",
    text_query: Optional[str] = None,
    directory: bool = False,
):
    """Load a bill list page with stats, chief-sponsor preview, and optional tracked state.

    ``sort`` selects the ordering: ``"latest_action"`` (default) keeps the
    most-recent-activity order; ``"progress"`` orders by legislative stage
    (signed → vetoed → passed senate → passed house → in committee → proposed),
    tie-broken by most-recent activity; ``"introduced"`` orders by introduction
    date descending (most recently introduced first), tie-broken by file number;
    ``"relevance"`` is the Search Bills "Best match" option — closest keyword
    match first (needs ``text_query``), tie-broken by legislative progress, and
    identical to ``"progress"`` when there is nothing to rank against.

    ``text_query`` (search only) ranks the closest keyword match first: when set,
    trigram word-similarity of the query against the bill's two titles (official
    ``title`` / displayed ``short_title``) and its description becomes the primary
    sort, with ``sort`` as the tie-break. Browsing (no query) is
    unaffected — the endpoints pass it only for a free-text search (#573).
    Because relevance is prepended to *whatever* ``sort`` is asked for, a caller
    that lets the user choose the sort must pass ``text_query`` only for the
    relevance option, or every option collapses into one identical ordering
    (``/bills``); a caller with one fixed ranking may pass it freely
    (``/search`` typeahead, always closest-match-first).
    """
    options = (
        []
        if directory
        else [
            selectinload(Bill.stats),
            selectinload(Bill.chief_sponsorships).selectinload(Sponsorship.legislator),
            selectinload(Bill.enrichments),
            # Action feed for the result card's curated latest-action line (one extra
            # round trip; ~2.9 actions/bill average, so a small payload).
            selectinload(Bill.actions),
        ]
    )
    if user_id is not None and not directory:
        options.append(
            selectinload(Bill.tracked_by.and_(TrackedBill.user_id == user_id))
        )
    recency_order = (
        Bill.latest_action_at.desc().nullslast(),
        Bill.file_number.asc(),
        Bill.id.asc(),
    )
    if sort in ("progress", "relevance"):
        # Read the precomputed rank column (#505) rather than recomputing the
        # lower()/ILIKE CASE cascade per row. ``Bill.status_rank`` is maintained
        # by the DB trigger from the exact ``bill_progress_rank`` cascade, so the
        # order is identical; ix_bill_session_progress serves it without a sort.
        order_by = (Bill.status_rank.asc(), *recency_order)
    elif sort == "introduced":
        order_by = (
            Bill.introduced_at.desc().nullslast(),
            Bill.file_number.desc(),
            Bill.id.asc(),
        )
    else:
        order_by = recency_order
    if text_query:
        # Relevance-first for a keyword search. A match in the *title* (the bill's
        # subject) outranks a match only in the description: e.g. a health-policy
        # bill titled "relating to health…" beats a capital-investment bill that
        # merely mentions "health care facility" in its description. Title
        # similarity leads, description similarity breaks title ties, then the
        # chosen ``sort`` breaks the rest (#573).
        #
        # "Title" means whichever of the two titles the query is closer to: the
        # official legal ``title`` or the plain-language ``short_title`` the card
        # actually displays. Someone who types the words on screen has typed the
        # bill's subject just as squarely as someone quoting its legal title, so
        # the closer of the two ranks the bill — GREATEST, not a second tie-break,
        # because either title matching is one signal, not two.
        title_relevance = func.greatest(
            func.word_similarity(text_query, Bill.title),
            func.word_similarity(text_query, func.coalesce(Bill.short_title, "")),
        )
        description_relevance = func.word_similarity(
            text_query, func.coalesce(Bill.description, "")
        )
        order_by = (title_relevance.desc(), description_relevance.desc(), *order_by)
    return (
        select(Bill)
        .where(
            _session_scope_clause(session_id),
            # Precomputed gate (#505): identical to the
            # ``current_bill_summary_enrichment_bill_ids`` semi-join (the trigger
            # maintains the column from that exact predicate), but reads a cheap
            # bill column instead of seq-scanning + detoasting ai_enrichment.
            Bill.has_current_summary.is_(True),
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
            selectinload(Legislator.election_history).selectinload(
                LegislatorElectionHistory.chamber
            ),
        )
    )


def legislator_sponsored_bills_stmt(
    legislator_id: uuid.UUID,
    session_id: uuid.UUID,
    role: "SponsorshipRole | None" = None,
):
    """Load one legislator's sponsored bills for a session with list-card fields.

    When ``role`` is given, restrict to sponsorships of that role (e.g.
    ``SponsorshipRole.chief_author`` for the chief-authored profile section).
    """
    conditions = [
        Sponsorship.legislator_id == legislator_id,
        Bill.session_id == session_id,
        # Precomputed gate (#505) — identical to the semi-join it replaces.
        Bill.has_current_summary.is_(True),
    ]
    if role is not None:
        conditions.append(Sponsorship.role == role)
    return (
        select(Bill)
        .join(Sponsorship, Sponsorship.bill_id == Bill.id)
        .where(*conditions)
        .options(
            selectinload(Bill.stats),
            selectinload(Bill.chief_sponsorships).selectinload(Sponsorship.legislator),
            selectinload(Bill.enrichments),
            selectinload(Bill.companion_bill).selectinload(Bill.actions),
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
        .options(
            selectinload(VoteRecord.vote_event).selectinload(VoteEvent.bill),
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
            selectinload(LegislatorServicePeriod.legislator)
            .selectinload(Legislator.election_history)
            .selectinload(LegislatorElectionHistory.chamber),
            selectinload(LegislatorServicePeriod.district),
            selectinload(LegislatorServicePeriod.chamber),
            selectinload(LegislatorServicePeriod.legislator).selectinload(
                Legislator.stats.and_(LegislatorStats.session_id == session_id)
            ),
        )
    )


def tracked_bills_stmt(user_id: uuid.UUID):
    """Load a user's tracked bills, newest-tracked first, in bounded queries.

    Deliberately NOT filtered on ``has_current_summary`` (#1007), unlike the
    browse and search statements above. There the gate is a precompute for a
    list the reader never asked for by name, so a bill still awaiting its AI
    summary is merely absent. Here the reader picked each row personally: gating
    it drops a bill they saved, from the one page whose whole job is showing
    what they saved, with nothing on screen to say a row is missing. Serving it
    unsummarized is honest (the record's number, title and status are all real);
    hiding it is not. The card renders no summary line rather than inventing one
    (``BillResultCard``).

    ``created_at`` descending is the order, so the list reads newest-saved-first
    and — because a tracked row's ``created_at`` never changes — looks identical
    on every visit. Ordering by the bill's latest action instead would be more
    useful but reshuffles as the Legislature acts. ``id`` breaks a same-timestamp
    tie so the order is total, not merely mostly stable.

    "What changed since you last looked" shipped as #1009 WITHOUT changing this
    order (the sentence here used to say it needed a design first, which is no
    longer true). The page groups the bills that moved above the ones that did
    not, client-side, and within each group this order is what it falls back to.
    So the base order still has to be stable per visit — a server order that
    reshuffled would move a bill between visits even inside its group.
    """
    return (
        select(TrackedBill)
        .where(TrackedBill.user_id == user_id)
        .options(
            selectinload(TrackedBill.bill).selectinload(Bill.stats),
            selectinload(TrackedBill.bill).selectinload(Bill.enrichments),
            selectinload(TrackedBill.bill).selectinload(Bill.actions),
            selectinload(TrackedBill.bill)
            .selectinload(Bill.chief_sponsorships)
            .selectinload(Sponsorship.legislator),
        )
        .order_by(TrackedBill.created_at.desc(), TrackedBill.id.desc())
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
    session_id: uuid.UUID | Sequence[uuid.UUID] | None = None,
    embedding_model: Optional[str] = None,
    limit: int = 10,
    max_distance: Optional[float] = None,
    current_version_only: bool = True,
):
    """Load retrieval-ready chunks ordered by vector similarity with canonical provenance.

    ``max_distance`` gates the retrieval-relevance threshold: when set, only
    chunks within that cosine distance of the query are returned, so a weak
    match yields nothing (the caller refuses rather than stretches — the Ask
    cite-or-refuse guardrail, docs/product-onboarding/grounded-ask-spec.md §4.5). Left ``None`` for
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
    if session_id is not None:
        # Applied HERE rather than by the caller, because the LIMIT above is what
        # makes the difference: filtering afterwards means the database picks the
        # nearest N chunks corpus-wide and the caller throws away the out-of-scope
        # ones, so a bill outside the scope silently costs an in-scope bill its slot
        # (#810).
        stmt = stmt.join(Bill, Bill.id == RagSectionDocument.bill_id).where(
            _session_scope_clause(session_id)
        )
    if embedding_model is not None:
        stmt = stmt.where(RagChunkEmbedding.embedding_model == embedding_model)
    if max_distance is not None:
        stmt = stmt.where(distance <= max_distance)
    return stmt


def retrievable_chunk_count_stmt(
    bill_id: uuid.UUID,
    *,
    embedding_model: Optional[str] = None,
    current_version_only: bool = True,
):
    """How many passages of one bill retrieval could return — the denominator an
    answer's coverage disclosure is measured against (#868).

    Deliberately joined and filtered exactly like ``semantic_rag_chunk_stmt`` above
    (same embedding join, same ``current_version_only`` scoping, same model
    filter), because the two numbers are a fraction: if this counted rows that
    statement can never return, an answer would report itself incomplete forever,
    and if it counted fewer, an answer would claim to have read the whole bill when
    it had not. The second failure is the dangerous one, so the joins stay in
    lockstep rather than being simplified to a bare count on ``rag_chunk``.
    """
    stmt = (
        select(func.count())
        .select_from(RagChunk)
        .join(RagChunkEmbedding, RagChunkEmbedding.rag_chunk_id == RagChunk.id)
        .join(
            RagSectionDocument,
            RagSectionDocument.id == RagChunk.rag_section_document_id,
        )
        .where(RagSectionDocument.bill_id == bill_id)
    )
    if current_version_only:
        stmt = stmt.join(
            BillVersion, BillVersion.id == RagSectionDocument.bill_version_id
        ).where(BillVersion.is_current.is_(True))
    if embedding_model is not None:
        stmt = stmt.where(RagChunkEmbedding.embedding_model == embedding_model)
    return stmt


def legislator_chat_record_stmt(legislator_id: uuid.UUID):
    """Every bill this legislator sponsored or voted on, with current summary enrichment."""
    return (
        select(Bill)
        .where(
            Bill.id.in_(select(Sponsorship.bill_id).where(Sponsorship.legislator_id == legislator_id))
            | Bill.id.in_(
                select(VoteEvent.bill_id)
                .join(VoteRecord, VoteRecord.vote_event_id == VoteEvent.id)
                .where(VoteRecord.legislator_id == legislator_id)
            )
        )
        .options(
            selectinload(Bill.sponsorships.and_(Sponsorship.legislator_id == legislator_id)),
            selectinload(Bill.vote_events).selectinload(
                VoteEvent.records.and_(VoteRecord.legislator_id == legislator_id)
            ),
            selectinload(
                Bill.enrichments.and_(
                    AIEnrichment.enrichment_type == EnrichmentType.bill_summary,
                    AIEnrichment.is_current.is_(True),
                )
            ),
        )
        .order_by(Bill.latest_action_at.desc().nullslast(), Bill.bill_key.asc())
    )
