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
    key: str
    name: str
    label: str
    folder_label: str | None = None
    station: str
    year: int | None
    category: str
    kind: str | None
    uploaded_at: str | None
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


class FinanceBrowse(Model):
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
    station file at ``/files/{id}``, anything else at
    ``/connections?kind={kind}&target={id}``."""

    kind: Literal["committee", "candidate", "principal", "election", "file"]
    id: str


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


class FinanceStation(FinanceSource):
    counts: FinanceCounts
    folder_count: int
    folder_failures: int
    years: list[FinanceStationYear]


class FinanceConnectionGroup(Model):
    label: str
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
