from __future__ import annotations

from datetime import datetime
from typing import Any

from pydantic import BaseModel, ConfigDict, Field, model_validator


class PageInfo(BaseModel):
    limit: int
    offset: int | None = None
    next_cursor: str | None = None
    has_more: bool = False
    total: int | None = None


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
    data_as_of: datetime | None = None


class TrackingState(BaseModel):
    is_tracked: bool
    note: str | None = None
    alerts_enabled: bool | None = None


class SponsorSummary(BaseModel):
    name: str
    role: str
    legislator_id: str | None = None
    # Readable profile-URL segment (e.g. "melissa-hortman"); the frontend links
    # to /legislators/{slug}, falling back to legislator_id for old rows.
    slug: str | None = None
    source_order: int | None = None
    source_chamber: str | None = None
    chamber: str | None = None
    party: str | None = None
    district: str | None = None
    represented_city: str | None = None


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
    # Which session this bill is from, served ONLY when it is not the Legislature's
    # regular session (#810). A special session numbers its files from 1 again, so
    # "HF 5" alone is not an identifier; without this a card for the special
    # session's HF 5 would sit under the biennium's name and read as a bill it is
    # not. Omitted for regular-session bills, which is every card today.
    session: "AskSessionRef | None" = None
    current_status: str | None = None
    status_key: str | None = None
    latest_action_at: datetime | None = None
    official_url: str | None = None
    is_omnibus: bool = False
    # The enacted bill's verified statutory effective date (Tier A/B — same source
    # as the bill-detail page) or "various dates" for an omnibus whose provisions
    # don't resolve to one shared date. Set only for signed laws with a groundable
    # value; absent otherwise, so the result card shows no Effective line rather
    # than a guessed date (grounded-answers rule 9). See public.bill_effective_dates.
    effective_date: str | None = None
    chief_sponsors: list[SponsorSummary]
    co_author_count: int = 0
    companion: CompanionBillPayload | None = None
    stats: BillStatsPayload | None = None
    tracked: TrackingState | None = None
    ai_analysis: AIAnalysisPayload | None = None
    # The bill's action feed, so a result card can render the same curated
    # plain-language latest action as the Bill Detail Actions tab (the card runs
    # buildActionTimeline over it). Cheap: ~2.9 actions/bill on average.
    actions: list["BillActionPayload"] | None = None


class ActionCrossReferencePayload(BaseModel):
    """A bill a "See also" action points at. ``code`` is what the timeline row
    displays ("HF 2446"); ``id`` is the target's bill_key, for /bills/{id} (#745).

    ``title`` and ``status_key`` are what we already store ABOUT that target — its
    plain-language short title and its status classification — so the row can say
    what the other bill is and where it got to, instead of showing a bare code with
    no reason to follow it (#757). Both describe the target only; neither asserts
    anything about how the two bills relate, which the source record never states.
    Absent when we hold no short title / no status for that bill.
    """

    code: str
    id: str
    title: str | None = None
    status_key: str | None = None


class BillActionPayload(BaseModel):
    action_number: int
    action_text: str
    action_group: str | None = None
    action_description: str | None = None
    committee_name: str | None = None
    action_at: datetime | None = None
    journal_page: str | None = None
    roll_call_text: str | None = None
    # Served by the bill DETAIL route only, where the Actions timeline renders these
    # as links. The list routes deliberately skip the resolving query — their card
    # shows one latest-action line, which never carries a link (#745).
    cross_references: list[ActionCrossReferencePayload] | None = None


class BillVersionPayload(BaseModel):
    version_code: str
    version_name: str | None = None
    document_date: datetime | None = None
    html_url: str | None = None
    pdf_url: str | None = None
    is_current: bool


class TopicPayload(BaseModel):
    slug: str
    name: str


class AICitationPayload(BaseModel):
    id: str
    label: str
    url: str
    excerpt: str
    section_id: str
    # WHICH section that id names: its 1-based position in the version. `section_id`
    # cannot identify a section on its own — 66 current versions repeat one id across
    # several sections (#854) — so the client needs the position to jump to the cited
    # section and to badge it. None when the stored citation does not establish which
    # of the repeats it was grounded against; the client then lands on the first and
    # badges none (grounded-answers rule 1).
    section_order: int | None = None
    # Short topic from the cited section's own heading ("License classes"), served
    # separately from `label` so the client composes the chip once. The stored
    # label's shape varies by when the bill was enriched, so concatenating here
    # would double up a topic it already carries; the client normalizes the label
    # and appends this only when the result has none. Empty when the section has no
    # heading worth showing, which renders the number alone.
    section_topic: str = ""


class AIAnalysisPayload(BaseModel):
    short_title: str | None = None
    summary: str | None = None
    key_points: list[str]
    policy_areas: list[str]
    # Per-key-point source anchors resolved from the enrichment (#377). Empty
    # for pre-re-enrichment summaries or bills without a resolvable official URL.
    citations: list[AICitationPayload] = []
    # System-suggested Ask chips for the bill page (#550): short questions
    # answerable purely from this bill's text (grounded-answers rule 2). Empty
    # until the corpus is re-enriched; the frontend falls back to generic chips.
    question_prompts: list[str] = []


class CompanionBillPayload(BaseModel):
    """The House/Senate companion of a bill. `id` is the companion's bill_key,
    so the frontend links to its detail page at /bills/{id} (#293)."""

    id: str
    code: str
    status: str | None = None
    status_key: str | None = None


class BillDetailPayload(BaseModel):
    id: str
    title: str
    # The session this bill belongs to. Served per bill rather than assumed to be
    # the current one, because a special session is its own session and its bills
    # would otherwise be labelled with the biennium's years (#746).
    session: SessionSummary | None = None
    description: str | None = None
    current_status: str | None = None
    status_key: str | None = None
    latest_action_at: datetime | None = None
    # When we last pulled this bill from the Legislature (#861). Distinct from
    # latest_action_at, which is when the Legislature last acted on it; the page's
    # source line shows this one, because "Updated" is a claim about our copy.
    last_pulled_at: datetime | None = None
    official_url: str | None = None
    is_omnibus: bool = False
    companion: CompanionBillPayload | None = None
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
    photo_url: str | None = None
    elected: str | None = None
    term: str | None = None


class ElectionPeriodPayload(BaseModel):
    """One chamber tenure from a member's Legislative Service history: the
    chamber elected to, the first election year, and any re-election years for
    that tenure (Senate bios list them; House bios carry only the initial
    year)."""

    chamber: str
    initial_year: int
    reelection_years: list[int] = []


class ServiceHistoryPayload(BaseModel):
    """Ordered per-chamber election history plus the current-chamber term.
    ``periods`` is chronological (earliest first); ``term`` counts the current
    chamber only."""

    term: int | None = None
    periods: list[ElectionPeriodPayload]


class CommitteePayload(BaseModel):
    name: str
    role: str | None = None


class LegislatorListItem(BaseModel):
    id: str
    slug: str
    full_name: str
    current_service: CurrentServicePayload | None = None
    committees: list[CommitteePayload] | None = None
    stats: LegislatorStatsPayload | None = None


class LegislatorDetailPayload(BaseModel):
    id: str
    slug: str
    full_name: str
    biography: str | None = None
    current_service: CurrentServicePayload | None = None
    committees: list[CommitteePayload] | None = None
    stats: LegislatorStatsPayload | None = None
    service_history: ServiceHistoryPayload | None = None


class SearchResultsPayload(BaseModel):
    bills: list[BillListItem]
    legislators: list[LegislatorListItem]


class RepresentativeLookupRequest(BaseModel):
    address_text: str | None = None
    latitude: float | None = Field(default=None, ge=-90, le=90)
    longitude: float | None = Field(default=None, ge=-180, le=180)

    @model_validator(mode="after")
    def validate_lookup_input(self):
        has_address = bool(self.address_text and self.address_text.strip())
        has_latitude = self.latitude is not None
        has_longitude = self.longitude is not None
        if has_address and (has_latitude or has_longitude):
            raise ValueError(
                "provide either address_text or latitude/longitude, not both"
            )
        if has_latitude != has_longitude:
            raise ValueError("latitude and longitude must be provided together")
        if not has_address and not (has_latitude and has_longitude):
            raise ValueError("address_text or latitude/longitude is required")
        if self.address_text is not None:
            self.address_text = self.address_text.strip()
        return self


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


class AskClassifyRequest(BaseModel):
    content: str


class AskClassificationPayload(BaseModel):
    intent: str
    auth_required: bool
    source: str
    confidence: float | None = None
    topic: str | None = None


class AskSessionRef(BaseModel):
    slug: str
    name: str


class AskTopicBillsAnswer(BaseModel):
    """Cited topic → bills answer (docs/product-onboarding/grounded-ask-spec.md §4.2, topic_bills).

    ``total_matches == 0`` is the NO MATCHES state — in scope, just empty —
    never rendered as a normal answer (§4.5).
    """

    topic: str | None
    session: AskSessionRef
    data_as_of: datetime | None
    total_matches: int
    bills: list[BillListItem]
    # Set when this list is not a topic result at all, but the answer to a bill
    # number that names more than one bill ("HF 5" exists in both the regular and
    # the first special session, and they are different laws). Carries the number
    # asked about so the page can say why it is showing two bills instead of
    # answering — the page must not present a collision as a topic match (#810).
    ambiguous_reference: str | None = None


class AskLegislatorBillRef(BaseModel):
    """A matched bill a legislator is on the record for — the citation backing
    an authorship count (docs/product-onboarding/grounded-ask-spec.md §4.2, topic_legislators)."""

    id: str
    file_type: str
    file_number: int
    title: str
    # Which session the bill is from, served only when it is not the Legislature's
    # regular session — the same rule as BillListItem.session, for the same reason:
    # a special session reuses file numbers, so "HF 5" alone names two bills (#810).
    session: "AskSessionRef | None" = None


class AskLegislatorRow(BaseModel):
    id: str
    # Readable profile-URL segment; the frontend links to /legislators/{slug}.
    slug: str | None = None
    full_name: str
    party: str | None
    district: str | None
    chamber: str | None
    profile_url: str | None
    authored_count: int
    coauthored_count: int
    bills: list[AskLegislatorBillRef]


class AskTopicLegislatorsAnswer(BaseModel):
    """Authorship-framed legislator list (docs/product-onboarding/grounded-ask-spec.md §4.2/§4.3).

    ``total_matches`` counts legislators; ``total_bills`` counts the underlying
    topic bills (the "See all N bills in Search" overflow, §9.1). Zero matches
    is the NO MATCHES state (§4.5).
    """

    topic: str | None
    session: AskSessionRef
    data_as_of: datetime | None
    total_matches: int
    total_bills: int
    legislators: list[AskLegislatorRow]


class AskVoteDeflectionAnswer(BaseModel):
    """v1 honest vote deflection (docs/product-onboarding/grounded-ask-spec.md §4.5 / §9.4, Vote
    deflection). Never a generated vote answer.

    No tallies or vote positions live here — those are records on the bill's
    Votes tab. When the question names a resolvable bill, ``resolved_bill``
    carries the resolved-bill card and the frontend deep-links its Votes tab
    (``?tab=votes``, §9.3); otherwise the ask degrades to the ``topic_bills``
    list (§4.5), each card linking to its own Votes tab.
    """

    session: AskSessionRef
    data_as_of: datetime | None
    resolved_bill: BillListItem | None = None
    topic_bills: AskTopicBillsAnswer | None = None


class AskCitation(BaseModel):
    """One retrieved passage backing a bill_text answer (docs/product-onboarding/grounded-ask-spec.md
    §9.4, citation card). ``url`` is the official source and is never absent —
    no citation without a resolvable URL (grounded rule 1)."""

    label: str
    bill_id: str
    excerpt: str
    url: str
    # The statute section the passage came from, so a citation card can link to it
    # inside our own Bill Text tab (`?tab=text#ft-<section_id>-<section_order>`)
    # rather than only out to revisor.mn.gov (grounded-answers rule 5;
    # docs/product-onboarding/grounded-ask-spec.md §9.5 decision 4). Empty when the
    # retrieved chunk's section document carries no section row — a whole-version
    # document — in which case the card falls back to `url`.
    section_id: str = ""
    # WHICH section that id names: its position in the version. Required, because
    # `section_id` is not unique within one — 66 current versions repeat an id across
    # several sections (#854), so an id-only anchor lands on the first of them. Unlike
    # the bill page's key-point citations, a retrieval chunk holds its section's own
    # foreign key, so this is exact rather than inferred. None only when `section_id`
    # is also absent.
    section_order: int | None = None
    # Short topic from that section's own heading ("Public facilities authority"),
    # served separately from `label` for the same reason as AICitationPayload: the
    # stored label's shape varies, so the client normalizes the label and appends
    # this only when the result carries no topic of its own.
    section_topic: str = ""


class AskPassageCoverage(BaseModel):
    """How much of the bill the answer was actually written from.

    ``used`` is the number of passages retrieval handed the answer writer;
    ``total`` is how many the bill's CURRENT version has. On a long bill these are
    far apart — HF 719 is 4 of 102 — and the answer reads as complete anyway, which
    is the failure the #865 eval measured (`docs/product-onboarding/answer-quality-bar.md`
    §9: the overclaim rate is FLAT at 80% / 89% / 80% across 4, 8 and 16 passages, so
    a wider window is not the fix).

    Served as a FACT, not as a verdict: the client decides what to say about it, so
    the caveat stays fixed UI copy the layout owns rather than anything the model can
    influence (docs/product-onboarding/grounded-ask-spec.md §9.5 decision 11).
    """

    used: int
    total: int
    # Whether the question asked for EVERY instance of something ("which cities…",
    # "list all…"). Added by #868, because the two numbers above stopped being
    # sufficient once a list question began reading the whole bill: `used == total`
    # says the read was complete, and a complete read is NOT a complete list. Given
    # every one of HF 719's 102 passages, the writer still listed 26-35 of the 98
    # cities the bill names. So a page keying its caveat on `used < total` alone would
    # drop it on exactly the answer that most needs one. Also served as a fact, not a
    # verdict: the client decides the wording.
    enumerating: bool = False


class AskBillTextAnswer(BaseModel):
    """Single-bill RAG prose answer with citations (docs/product-onboarding/grounded-ask-spec.md
    §4.1 / §9.4, bill_text). Always scoped to one resolved bill; a weak or empty
    retrieval refuses (no answer body) rather than stretches (§4.5)."""

    answer: str
    citations: list[AskCitation]
    bill: BillListItem
    session: AskSessionRef
    data_as_of: datetime | None
    # None only when the total cannot be established; the client then renders no
    # coverage note rather than guessing at one.
    coverage: AskPassageCoverage | None = None


class AskAnswerPayload(BaseModel):
    intent: str
    source: str
    confidence: float | None = None
    # Present for bill_text / topic_bills / topic_legislators / legislator_vote
    # (deflection); the remaining intent (refuse) returns no answer body.
    answer: (
        AskBillTextAnswer
        | AskTopicBillsAnswer
        | AskTopicLegislatorsAnswer
        | AskVoteDeflectionAnswer
        | None
    ) = None


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
