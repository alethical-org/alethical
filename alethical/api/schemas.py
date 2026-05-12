from __future__ import annotations

from datetime import datetime
from typing import Any

from pydantic import BaseModel, ConfigDict


class PageInfo(BaseModel):
    limit: int
    next_cursor: str | None = None
    has_more: bool = False


class CollectionResponse(BaseModel):
    data: list[Any]
    page: PageInfo | None = None
    links: dict[str, str | None] | None = None


class DetailResponse(BaseModel):
    data: Any
    links: dict[str, str | None] | None = None


class HealthResponse(BaseModel):
    status: str


class JurisdictionSummary(BaseModel):
    slug: str
    name: str


class SessionSummary(BaseModel):
    slug: str
    name: str
    is_current: bool


class MetaPayload(BaseModel):
    api_version: str
    jurisdiction: JurisdictionSummary
    current_session: SessionSummary


class TrackingState(BaseModel):
    is_tracked: bool
    note: str | None = None
    alerts_enabled: bool | None = None


class SponsorSummary(BaseModel):
    name: str
    role: str
    legislator_id: str | None = None
    source_order: int | None = None
    source_chamber: str | None = None
    chamber: str | None = None
    party: str | None = None
    district: str | None = None


class BillProgressStep(BaseModel):
    key: str
    label: str
    reached: bool
    current: bool = False


class BillStatsPayload(BaseModel):
    sponsor_count: int
    action_count: int
    version_count: int
    vote_event_count: int


class BillListItem(BaseModel):
    id: str
    file_type: str
    file_number: int
    title: str
    current_status: str | None = None
    status_key: str | None = None
    latest_action_at: datetime | None = None
    official_url: str | None = None
    chief_sponsors: list[SponsorSummary]
    stats: BillStatsPayload | None = None
    tracked: TrackingState | None = None
    ai_analysis: AIAnalysisPayload | None = None


class BillActionPayload(BaseModel):
    action_number: int
    action_text: str
    action_group: str | None = None
    action_description: str | None = None
    action_at: datetime | None = None
    journal_page: str | None = None
    roll_call_text: str | None = None


class BillVersionPayload(BaseModel):
    version_code: str
    version_name: str | None = None
    html_url: str | None = None
    pdf_url: str | None = None
    is_current: bool


class TopicPayload(BaseModel):
    slug: str
    name: str


class AIAnalysisPayload(BaseModel):
    summary: str | None = None
    key_points: list[str]
    policy_areas: list[str]


class BillDetailPayload(BaseModel):
    id: str
    title: str
    description: str | None = None
    current_status: str | None = None
    status_key: str | None = None
    latest_action_at: datetime | None = None
    official_url: str | None = None
    chief_sponsors: list[SponsorSummary]
    all_sponsors: list[SponsorSummary] | None = None
    progress: list[BillProgressStep] | None = None
    actions: list[BillActionPayload] | None = None
    versions: list[BillVersionPayload] | None = None
    topics: list[TopicPayload] | None = None
    tracking: TrackingState | None = None
    ai_summary: dict[str, Any] | None = None
    ai_analysis: AIAnalysisPayload | None = None


class DistrictPayload(BaseModel):
    id: str
    code: str
    label: str


class LegislatorStatsPayload(BaseModel):
    chief_bill_count: int
    total_bill_count: int
    vote_record_count: int
    committee_count: int


class CurrentServicePayload(BaseModel):
    chamber: str
    party: str | None = None
    district: DistrictPayload
    email: str | None = None
    phone: str | None = None
    office_address: str | None = None
    profile_url: str | None = None


class LegislatorListItem(BaseModel):
    id: str
    slug: str
    full_name: str
    current_service: CurrentServicePayload | None = None
    stats: LegislatorStatsPayload | None = None


class CommitteePayload(BaseModel):
    name: str
    role: str | None = None


class LegislatorDetailPayload(BaseModel):
    id: str
    slug: str
    full_name: str
    biography: str | None = None
    current_service: CurrentServicePayload | None = None
    committees: list[CommitteePayload] | None = None
    stats: LegislatorStatsPayload | None = None


class SearchResultsPayload(BaseModel):
    bills: list[BillListItem]
    legislators: list[LegislatorListItem]


class RepresentativeLookupRequest(BaseModel):
    address_text: str


class RepresentativeLookupPayload(BaseModel):
    resolved_place: dict[str, Any]
    house_legislator: LegislatorListItem | None = None
    senate_legislator: LegislatorListItem | None = None


class MePayload(BaseModel):
    id: str
    display_name: str | None = None
    primary_email: str | None = None
    features: list[str]


class TrackedBillWriteRequest(BaseModel):
    alerts_enabled: bool = True
    note: str | None = None


class TrackedBillPatchRequest(BaseModel):
    alerts_enabled: bool | None = None
    note: str | None = None


class TrackedBillPayload(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    bill_id: str
    alerts_enabled: bool
    note: str | None = None
    bill: BillListItem | None = None


class NotificationPreferenceWriteRequest(BaseModel):
    frequency: str
    is_enabled: bool


class NotificationPreferencePayload(BaseModel):
    channel: str
    frequency: str
    is_enabled: bool


class SavedPlaceWriteRequest(BaseModel):
    label: str
    address_text: str | None = None
    city: str | None = None
    state_code: str | None = None
    is_default: bool = False


class SavedPlacePatchRequest(BaseModel):
    label: str | None = None
    address_text: str | None = None
    city: str | None = None
    state_code: str | None = None
    is_default: bool | None = None


class ChatSessionCreateRequest(BaseModel):
    title: str | None = None
    subject_bill_id: str | None = None


class ChatMessageCreateRequest(BaseModel):
    content: str
    stream: bool = False


class ChatMessagePayload(BaseModel):
    id: str
    role: str
    content: str
    citations: list[dict[str, Any]] = []
    created_at: datetime


class ChatSessionPayload(BaseModel):
    id: str
    title: str | None = None
    subject_bill_id: str | None = None
    last_message_at: datetime | None = None


class ChatTurnPayload(BaseModel):
    assistant_message: ChatMessagePayload
