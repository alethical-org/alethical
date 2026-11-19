"""Alethical Finance's Media buys answers: an allow list of every field it sends.

A field reaches Finance only when a model here names it; every other key the
shared readers return (``alethical/api/services/tv_ads.py``) is dropped, including
any added there later. None of these models has a field for an alethical.com
link or address, a public copy's id, status or approval, or an account
identifier (docs/architecture/alethical-finance-architecture.md §4, §5, §7).
"""

from __future__ import annotations

from typing import Generic, Literal, TypeVar

from pydantic import BaseModel, ConfigDict, Field

T = TypeVar("T")


class Model(BaseModel):
    model_config = ConfigDict(extra="ignore")


class FinanceAnswer(Model, Generic[T]):
    data: T


class FinanceCounts(Model):
    station_files_held: int
    unique_file_contents: int
    text_read_failures: int
    download_failures: int
    checked_connection_files: int


class FinanceSource(Model):
    call_sign: str
    facility_id: str
    fcc_url: str
    newest_upload: str | None
    last_list_check: str | None
    last_file_copy: str | None


class FinanceSources(Model):
    stations: list[FinanceSource]
    text_reader_version: str


class FinanceFileRow(Model):
    agency_unchecked: bool = False
    # When the shown agency-name check on this exact version was made.
    agency_checked_at: str | None = None
    key: str
    name: str
    label: str
    folder_label: str | None = None
    station: str
    year: int | None
    category: str
    kind: str | None
    uploaded_at: str | None
    first_saved_at: str | None = None
    page: int | None = None
    version_id: str
    airing_periods: list[str]
    version_count: int
    source_changed: bool
    role: str | None = None
    election: str | None = None
    match_label: str | None = None
    excerpt: str | None = None
    text_match: bool | None = None


class FinanceRecentStation(Model):
    call_sign: str
    files: list[FinanceFileRow]


class FinanceRecent(Model):
    stations: list[FinanceRecentStation]


class FinanceQueueReason(Model):
    kind: Literal["agency_checked_elsewhere", "folder_committee_checked"]
    label: str


class FinanceQueueRow(FinanceFileRow):
    saved_at: str
    suggestion_count: int
    reasons: list[FinanceQueueReason]


class FinanceQueue(Model):
    #: Names the sources this page read; send it back to refuse a changed state.
    version: str | None = None
    rows: list[FinanceQueueRow]
    total: int
    has_more: bool
    limit: int
    offset: int
    q: str
    station: str
    sort: Literal["suggested", "newest"]


class FinanceFactSuggestion(Model):
    field: str
    machine_field: str
    value: str
    page: int
    pages: list[int]
    quote: str
    in_source_text: bool
    already_checked: bool


class FinanceSuggestions(Model):
    key: str
    version_id: str
    extraction_version: str
    facts: list[FinanceFactSuggestion]


class FinanceBrowseGroup(Model):
    unchecked: bool = False
    folder_count: int | None = None
    stations: list[str] | None = None
    key: str
    label: str
    file_count: int
    station: str | None = None
    year: int | None = None
    category: str | None = None
    years: list[int] | None = None


class FinanceBrowse(Model):
    #: Names the sources this page read; send it back to refuse a changed state.
    version: str | None = None
    tab: str
    q: str
    station: str
    year: int | None
    category: str
    page: int
    page_size: int
    total: int
    capped: bool
    rows: list[FinanceFileRow | FinanceBrowseGroup]
    years: list[int]
    categories: list[str]
    tab_counts: dict[str, int] = Field(default_factory=dict)


class FinanceCorrection(Model):
    value: str
    corrected_at: str


class FinanceFact(Model):
    id: str
    kind: str
    status: Literal["checked", "withdrawn"]
    version_id: str
    value: str | None = None
    qualifier: str | None = None
    role: str | None = None
    quote: str | None = None
    page: int | None = None
    checked_at: str | None = None
    withdrawn_at: str | None = None
    history: list[FinanceCorrection] = Field(default_factory=list)


class FinanceTarget(Model):
    """The record a connection names, for the Finance app to open itself: a
    station file at ``/files/{id}?version={version}``, the exact version the check
    named, anything else at ``/connections?kind={kind}&target={id}``."""

    kind: Literal["committee", "candidate", "principal", "election", "file"]
    id: str
    version: str | None = None


class FinanceConnection(Model):
    id: str
    kind: str
    status: Literal["checked", "withdrawn"]
    version_id: str
    target: FinanceTarget | None = None
    label: str | None = None
    role: str | None = None
    quote: str | None = None
    page: int | None = None
    checked_at: str | None = None
    withdrawn_at: str | None = None
    reported_amount: str | None = None
    reported_date: str | None = None
    source_changed: bool | None = None
    evidence_label: str | None = None


class FinanceVersion(Model):
    id: str
    first_saved_at: str
    uploaded_at: str | None


class FinancePage(Model):
    number: int
    text: str | None
    text_status: str
    image: str


class FinanceFolderLink(Model):
    key: str
    label: str


class FinanceAgencyName(Model):
    key: str
    name: str
    unchecked: bool


class FinanceFileDetail(FinanceFileRow):
    agencies: list[FinanceAgencyName]
    folder: FinanceFolderLink
    fcc_url: str
    fcc_available: bool
    versions: list[FinanceVersion]
    page_count: int
    pages: list[FinancePage]
    facts: list[FinanceFact]
    dates: list[FinanceFact]
    connections: list[FinanceConnection]
    other_files: list[FinanceFileRow]
    current_source_version: str


class FinanceFolder(Model):
    key: str
    label: str
    station: str
    year: int | None
    category: str
    fcc_url: str
    relationship: FinanceConnection | None
    files: list[FinanceFileRow]


class FinanceAddressEvidence(Model):
    file_key: str
    file_name: str
    version_id: str
    page: int
    uploaded_at: str | None
    checked_at: str
    quote: str | None = None
    role: str | None = None


class FinanceAddress(Model):
    address: str
    role: str | None = None
    evidence: list[FinanceAddressEvidence]


class FinanceAgencyGroup(Model):
    station: str
    year: int | None
    files: list[FinanceFileRow]


class FinanceAgency(Model):
    version: str | None = None
    unchecked: bool = False
    key: str
    name: str
    groups: list[FinanceAgencyGroup]
    addresses: list[FinanceAddress]


class FinanceCategory(Model):
    name: str
    count: int


class FinanceStationYear(Model):
    year: int | None
    categories: list[FinanceCategory]
    file_count: int
    counts: dict[str, int] = Field(default_factory=dict)
    latest_check_at: str | None = None


class FinanceStation(FinanceSource):
    counts: FinanceCounts
    folder_count: int
    folder_failures: int
    years: list[FinanceStationYear]
    latest_check_at: str | None = None


class FinanceConnectionGroup(Model):
    label: str
    kind: Literal["committee", "named"] | None = None
    files: list[FinanceFileRow]


class FinanceCommitteeIdentity(Model):
    name: str
    office: str | None
    district: str | None


class FinanceConnected(Model):
    committee: FinanceCommitteeIdentity | None = None
    agency_key: str | None
    exact_name_count: int
    files: list[FinanceFileRow]
    total: int
    groups: list[FinanceConnectionGroup]


class FinanceCheckSaved(Model):
    """A Finance check just recorded or withdrawn: its id and standing, nothing
    about the account that made it."""

    id: str
    status: Literal["checked", "withdrawn"]


class FinancePreviewField(Model):
    label: str
    value: str


class FinanceTargetPreview(Model):
    """The exact record a connection would name, and the fingerprint its save
    repeats. Never an alethical.com address."""

    kind: str
    target_id: str
    label: str
    target_fingerprint: str
    fields: list[FinancePreviewField]
    source_dataset: str | None = None
    source_snapshot_id: str | None = None
    source_content_hash: str | None = None
    source_row_number: int | None = None
    source_date: str | None = None


class FinanceNationalFile(Model):
    source_url: str | None
    title: str
    station_name: str
    service: str
    state: str | None
    folder_path: str
    file_year: int | None
    file_id: str
    content_hash: str
    page_count: int | None
    has_text: bool


class FinanceOriginalTextPage(Model):
    page: int
    text: str
    method: Literal["embedded", "ocr", "unreadable"]


class FinanceOriginalText(Model):
    pages: list[FinanceOriginalTextPage]


class FinanceFilingAbout(Model):
    filings: int
    index_through: str
    saved: int
    saved_updated: str
    complete: bool


class FinanceFilingRow(Model):
    key: str
    name: str
    folder: str
    station: str
    service: str
    uploaded: str | None
    file_id: str
    pdf: Literal["saved", "unavailable", "unchecked"]
    minnesota_key: str | None


class FinanceFilings(Model):
    tab: Literal["all-filings"]
    q: str
    year: int
    years: list[int]
    page: int
    page_size: int
    total: int
    rows: list[FinanceFilingRow]
    about: FinanceFilingAbout


class FinanceFilingFolder(Model):
    key: str
    label: str
    folder: str
    station: str
    service: str
    filings: int
    with_pdf: int


class FinanceFilingFolders(Model):
    tab: Literal["advertisers"]
    q: str
    year: int
    years: list[int]
    page: int
    page_size: int
    total: int
    rows: list[FinanceFilingFolder]


class FinanceFilingOutlet(Model):
    key: str
    name: str
    service: str
    ident: str
    place: str | None
    years: list[int]
    filings: int
    with_pdf: int
    minnesota_station: str | None


class FinanceFilingOutlets(Model):
    tab: Literal["stations-and-providers"]
    q: str
    year: int
    years: list[int]
    page: int
    page_size: int
    total: int
    rows: list[FinanceFilingOutlet]


class FinanceFilingDetail(Model):
    key: str
    name: str
    folder: str
    year: int
    station: str
    service: str
    ident: str
    place: str | None
    file_id: str
    uploaded: str | None
    pdf: Literal["saved", "unavailable", "unchecked"]
    saved_on: str | None
    pages: int | None
    content_hash: str | None
    has_text: bool
    minnesota_key: str | None
    source_url: str | None
