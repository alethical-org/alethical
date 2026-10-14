"""Explicit reader response allowlists for private, approved TV records.

Unknown fields are discarded at every structured boundary. Archive rows, audit
actors, private drafts and storage keys have no representation in these models.
"""

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field


class ReaderModel(BaseModel):
    model_config = ConfigDict(extra="ignore")


class Access(ReaderModel):
    allowed: bool


class Counts(ReaderModel):
    station_files_held: int
    unique_file_contents: int
    text_read_failures: int
    download_failures: int
    files_with_approved_copy: int
    checked_connection_files: int


class Source(ReaderModel):
    call_sign: str
    facility_id: str
    fcc_url: str
    newest_upload: str | None
    last_list_check: str | None
    last_file_copy: str | None


class Sources(ReaderModel):
    stations: list[Source]
    text_reader_version: str


class FileRow(ReaderModel):
    agency_unchecked: bool = False
    key: str
    name: str
    label: str
    station: str
    year: int | None
    category: str
    kind: str | None
    uploaded_at: str | None
    version_id: str
    copy_id: str | None
    airing_periods: list[str]
    version_count: int
    source_changed: bool
    role: str | None = None
    election: str | None = None
    reference: str | None = None
    checked_at: str | None = None
    match_label: str | None = None
    excerpt: str | None = None
    text_match: bool | None = None


class RecentStation(ReaderModel):
    call_sign: str
    files: list[FileRow]


class Recent(ReaderModel):
    stations: list[RecentStation]


class BrowseGroup(ReaderModel):
    unchecked: bool = False
    folder_count: int | None = None
    stations: list[str] | None = None
    key: str
    label: str
    file_count: int
    station: str | None = None
    year: int | None = None
    category: str | None = None


class Browse(ReaderModel):
    tab: str
    q: str
    station: str
    year: int | None
    category: str
    page: int
    page_size: int
    total: int
    capped: bool
    rows: list[FileRow | BrowseGroup]
    years: list[int]
    categories: list[str]


class Correction(ReaderModel):
    value: str
    corrected_at: str


class Fact(ReaderModel):
    id: str
    kind: str
    status: Literal["checked", "withdrawn"]
    version_id: str
    value: str | None = None
    qualifier: str | None = None
    quote: str | None = None
    page: int | None = None
    checked_at: str | None = None
    withdrawn_at: str | None = None
    history: list[Correction] = Field(default_factory=list)


class Connection(ReaderModel):
    id: str
    kind: str
    status: Literal["checked", "withdrawn"]
    version_id: str
    label: str | None = None
    href: str | None = None
    role: str | None = None
    quote: str | None = None
    page: int | None = None
    checked_at: str | None = None
    withdrawn_at: str | None = None
    reported_amount: str | None = None
    reported_date: str | None = None
    source_changed: bool | None = None
    evidence_label: str | None = None


class Version(ReaderModel):
    id: str
    first_saved_at: str
    uploaded_at: str | None
    status: str


class Page(ReaderModel):
    number: int
    text: str | None
    text_status: str
    image_path: str | None


class FolderLink(ReaderModel):
    key: str
    label: str


class WithdrawnFile(ReaderModel):
    key: str
    copy_status: Literal["withdrawn"]
    withdrawn_at: str
    versions: list[Version]


class AgencyName(ReaderModel):
    key: str
    name: str
    unchecked: bool


class FileDetail(FileRow):
    agencies: list[AgencyName] = Field(default_factory=list)
    folder: FolderLink
    fcc_url: str
    fcc_available: bool
    versions: list[Version]
    copy_status: Literal["approved", "not_ready", "archive"]
    page_count: int
    pages: list[Page]
    facts: list[Fact]
    dates: list[Fact]
    connections: list[Connection]
    related: list[FileRow]
    other_files: list[FileRow]
    current_source_version: str
    newest_approved_version: str | None


class Folder(ReaderModel):
    key: str
    label: str
    station: str
    year: int | None
    category: str
    fcc_url: str
    relationship: Connection | None
    files: list[FileRow]


class AddressEvidence(ReaderModel):
    file_key: str
    file_name: str
    version_id: str
    copy_id: str
    page: int
    uploaded_at: str | None
    checked_at: str
    role: str | None = None


class Address(ReaderModel):
    address: str
    role: str | None = None
    evidence: list[AddressEvidence]


class AgencyGroup(ReaderModel):
    station: str
    year: int | None
    files: list[FileRow]


class Agency(ReaderModel):
    unchecked: bool = False
    key: str
    name: str
    payments_href: str
    independent_payments_href: str
    groups: list[AgencyGroup]
    addresses: list[Address]


class Category(ReaderModel):
    name: str
    count: int


class StationYear(ReaderModel):
    year: int | None
    categories: list[Category]
    file_count: int


class Station(Source):
    counts: Counts
    folder_count: int
    folder_failures: int
    years: list[StationYear]


class ConnectionGroup(ReaderModel):
    label: str
    files: list[FileRow]


class CommitteeIdentity(ReaderModel):
    name: str
    office: str | None
    district: str | None


class Connected(ReaderModel):
    committee: CommitteeIdentity | None = None
    agency_key: str | None
    exact_name_count: int
    files: list[FileRow]
    total: int
    groups: list[ConnectionGroup]


class ExpenseField(ReaderModel):
    label: str
    value: str


class ExpenseEvidence(ReaderModel):
    page: int
    quote: str
    version_id: str


class ExpenseFile(ReaderModel):
    key: str
    name: str
    copy_id: str
    version_id: str


class Expense(ReaderModel):
    id: str
    label: str
    dataset: str
    source_date: str | None
    source_url: str | None
    source_changed: bool
    fields: list[ExpenseField]
    checked_at: str
    evidence: ExpenseEvidence
    file: ExpenseFile
