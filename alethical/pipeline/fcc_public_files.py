"""Read FCC political-file listings and copy their public documents.

The HTML table is the catalogue, including every year and folder kind. A failed
page or changed table is never an empty catalogue. Names do not filter discovery.

FCC's file-record UUID and the UUID of its served document differ. Keep both: the
record UUID is ``file_id``; the source link keeps the served-document UUID. FCC's
HTML sizes are rounded and its API sizes describe the original upload, which can
differ from the converted PDF served to the public. Neither is an integrity check.
"""

from __future__ import annotations

import re
import time
from dataclasses import dataclass, field
from html.parser import HTMLParser
from urllib.parse import unquote, urljoin, urlsplit

import httpx

FCC_ORIGIN = "https://publicfiles.fcc.gov"
DISTRIBUTION_ORIGIN = "https://files.fcc.gov"
_UUID = r"[0-9a-fA-F]{8}(?:-[0-9a-fA-F]{4}){3}-[0-9a-fA-F]{12}"
_DOWNLOAD = re.compile(rf"/api/manager/download/({_UUID})/({_UUID})(\.[A-Za-z0-9]+)?$")


@dataclass(frozen=True)
class Station:
    facility_id: str
    call_sign: str
    slug: str

    @property
    def root_url(self) -> str:
        return f"{FCC_ORIGIN}/tv-profile/{self.slug}/political-files"


DEFAULT_STATIONS = (
    Station("28010", "KSTP-TV", "kstp-tv"),
    Station("23079", "KARE", "kare"),
    Station("68883", "KMSP-TV", "kmsp-tv"),
)


@dataclass(frozen=True)
class FileListing:
    file_id: str
    folder_id: str
    folder_path: str
    name: str
    url: str
    uploaded_at: str | None = None
    size_bytes: int | None = None
    size_label: str | None = None


@dataclass(frozen=True)
class FolderListing:
    url: str
    path: str
    body: bytes
    files: list[FileListing]
    children: list[tuple[str, str]]
    expected_count: int | None = None


class FCCSourceError(ValueError):
    """The source is unsafe, unavailable, or no longer has a known structure."""


class FCCFetchError(FCCSourceError):
    def __init__(self, url: str, reason: str, status_code: int | None = None):
        self.url = url
        self.status_code = status_code
        self.reason = reason
        super().__init__(f"FCC could not serve {url}: {reason}")


def _safe_url(url: str, *, download: bool = False) -> str:
    parsed = urlsplit(url)
    allowed = (
        {"publicfiles.fcc.gov", "files.fcc.gov"}
        if download
        else {"publicfiles.fcc.gov"}
    )
    try:
        port = parsed.port
    except ValueError as error:
        raise FCCSourceError("Invalid FCC address port") from error
    if (
        parsed.scheme != "https"
        or parsed.hostname not in allowed
        or port not in (None, 443)
        or parsed.username is not None
        or parsed.password is not None
        or parsed.query
        or parsed.fragment
        or "\\" in url
        or any(ord(char) < 32 for char in url)
    ):
        raise FCCSourceError(f"Refusing non-public FCC address: {url}")
    decoded = unquote(parsed.path)
    if any(part in (".", "..") for part in decoded.split("/")) or decoded.startswith(
        "//"
    ):
        raise FCCSourceError(f"Refusing ambiguous FCC path: {url}")
    if download:
        valid = (
            _DOWNLOAD.fullmatch(parsed.path)
            if parsed.hostname == "publicfiles.fcc.gov"
            else re.fullmatch(rf"/download/{_UUID}\.pdf", parsed.path, re.I)
        )
        if not valid:
            raise FCCSourceError(f"Unrecognized FCC download address: {url}")
    elif not re.fullmatch(
        r"/tv-profile/[a-z0-9-]+/political-files(?:/[^/]+)*/?", parsed.path
    ):
        raise FCCSourceError(f"Unrecognized FCC political folder address: {url}")
    return url


@dataclass
class _Link:
    attrs: dict[str, str]
    text: list[str] = field(default_factory=list)


@dataclass
class _Cell:
    attrs: dict[str, str]
    text: list[str] = field(default_factory=list)
    links: list[_Link] = field(default_factory=list)


class _ListingParser(HTMLParser):
    """Parse only the known FCC table, rather than the navigation around it."""

    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.tables = 0
        self.invalid = False
        self.in_table = False
        self.closed_table = False
        self.in_body = False
        self.saw_body = False
        self.headers: list[str] = []
        self.rows: list[list[_Cell]] = []
        self.row: list[_Cell] | None = None
        self.cell: _Cell | None = None
        self.link: _Link | None = None
        self.hidden_depth = 0

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        attributes = {key: value or "" for key, value in attrs}
        if tag == "table" and attributes.get("id") == "fileBrowsingTable":
            self.tables += 1
            self.in_table = True
        elif not self.in_table:
            return
        if tag == "tbody":
            if self.saw_body:
                self.invalid = True
            self.saw_body = self.in_body = True
        elif tag == "tr":
            if self.row is not None:
                self.invalid = True
            self.row = []
        elif tag in ("td", "th"):
            if self.row is None or (tag == "td" and not self.in_body):
                self.invalid = True
            self.cell = _Cell(attributes)
            if self.row is not None:
                self.row.append(self.cell)
        elif tag == "a" and self.cell is not None:
            self.link = _Link(attributes)
            self.cell.links.append(self.link)
        if self.hidden_depth:
            self.hidden_depth += 1
        elif "sr-only" in attributes.get("class", "").split():
            self.hidden_depth = 1

    def handle_endtag(self, tag: str) -> None:
        if not self.in_table:
            return
        if self.hidden_depth:
            self.hidden_depth -= 1
        if tag == "a":
            self.link = None
        elif tag in ("td", "th"):
            if tag == "th" and self.cell is not None:
                self.headers.append(_text(self.cell.text))
            self.cell = None
        elif tag == "tr" and self.row is not None:
            if self.in_body:
                self.rows.append(self.row)
            self.row = None
        elif tag == "tbody":
            if self.row is not None or self.cell is not None:
                self.invalid = True
            self.in_body = False
        elif tag == "table":
            if self.in_body or self.row is not None or self.cell is not None:
                self.invalid = True
            self.in_table = False
            self.closed_table = True

    def handle_data(self, data: str) -> None:
        if self.in_table and not self.hidden_depth:
            if self.cell is not None:
                self.cell.text.append(data)
            if self.link is not None:
                self.link.text.append(data)


def _text(parts: list[str]) -> str:
    return " ".join("".join(parts).split())


def parse_folder(body: bytes, url: str, path: str) -> FolderListing:
    """Keep each catalogue row; recursive folder counts are not unique totals."""
    _safe_url(url)
    if (path != "political-files" and not path.startswith("political-files/")) or any(
        part in ("", ".", "..") for part in path.split("/")
    ):
        raise FCCSourceError(f"Invalid logical FCC folder path: {path}")
    parser = _ListingParser()
    try:
        parser.feed(body.decode("utf-8"))
        parser.close()
    except UnicodeDecodeError as error:
        raise FCCSourceError("FCC folder is not UTF-8 HTML") from error
    if (
        parser.invalid
        or parser.tables != 1
        or not parser.closed_table
        or not parser.saw_body
        or parser.headers != ["Name", "Size", "Date Uploaded"]
    ):
        raise FCCSourceError(
            f"FCC listing structure changed or returned an error page: {url}"
        )
    files: list[FileListing] = []
    children: list[tuple[str, str]] = []
    station_prefix = urlsplit(url).path.split("/political-files", 1)[0] + "/"
    for row in parser.rows:
        if len(row) != 3 or len(row[0].links) != 1:
            raise FCCSourceError(f"Unrecognized FCC listing row in {url}")
        cell, size_cell, date_cell = row
        link = cell.links[0]
        href = urljoin(url, link.attrs.get("href", ""))
        classes = set(link.attrs.get("class", "").split())
        name = _text(link.text)
        if not name:
            raise FCCSourceError(f"Unnamed FCC listing row in {url}")
        if "nav2folder" in classes:
            _safe_url(href)
            child_path = link.attrs.get("data-path", "")
            if (
                not child_path.startswith(path.rstrip("/") + "/")
                or any(part in ("", ".", "..") for part in child_path.split("/"))
                or not urlsplit(href).path.startswith(station_prefix + child_path + "/")
            ):
                raise FCCSourceError(f"FCC child folder leaves its parent: {href}")
            children.append((href, child_path))
        elif "nav2file" in classes:
            _safe_url(href, download=True)
            match = _DOWNLOAD.fullmatch(urlsplit(href).path)
            record_id = cell.attrs.get("id", "").removeprefix("file")
            if match is None or re.fullmatch(_UUID, record_id) is None:
                raise FCCSourceError(f"Unrecognized FCC file identity in {url}")
            size_label = _text(size_cell.text)
            exact_bytes = re.fullmatch(r"([0-9,]+) (?:B|bytes)", size_label, re.I)
            uploaded_at = _text(date_cell.text)
            files.append(
                FileListing(
                    file_id=record_id,
                    folder_id=match[1],
                    folder_path=path,
                    name=name,
                    url=href,
                    uploaded_at=None if uploaded_at in ("", "--") else uploaded_at,
                    size_bytes=int(exact_bytes[1].replace(",", ""))
                    if exact_bytes
                    else None,
                    size_label=size_label or None,
                )
            )
        else:
            raise FCCSourceError(f"Unrecognized FCC row link in {url}")
    return FolderListing(url, path, body, files, children)


class FCCClient:
    """A serial, bounded public client. No credentials, challenges, or paid calls."""

    def __init__(
        self,
        *,
        timeout: float = 30,
        attempts: int = 3,
        max_listing_bytes: int = 10 * 1024 * 1024,
        max_file_bytes: int = 100 * 1024 * 1024,
        transport: httpx.BaseTransport | None = None,
    ) -> None:
        if (
            timeout <= 0
            or attempts not in range(1, 6)
            or min(max_listing_bytes, max_file_bytes) < 1
        ):
            raise ValueError(
                "FCC request limits must be positive; attempts must be 1 to 5"
            )
        self.attempts = attempts
        self.max_listing_bytes = max_listing_bytes
        self.max_file_bytes = max_file_bytes
        self.timeout = timeout
        self.last_download_url: str | None = None
        self.http = httpx.Client(
            timeout=timeout,
            follow_redirects=False,
            headers={
                "User-Agent": "Alethical public-record archive (+https://alethical.com)"
            },
            limits=httpx.Limits(max_connections=1, max_keepalive_connections=1),
            transport=transport,
        )

    def close(self) -> None:
        self.http.close()

    def _fetch(
        self, url: str, limit: int, *, download: bool = False
    ) -> tuple[bytes, str]:
        _safe_url(url, download=download)
        for attempt in range(self.attempts):
            current = url
            started = time.monotonic()
            try:
                for _ in range(5):
                    remaining = self.timeout - (time.monotonic() - started)
                    if remaining <= 0:
                        raise FCCFetchError(
                            current, "request exceeded total time limit"
                        )
                    with self.http.stream(
                        "GET", current, timeout=remaining
                    ) as response:
                        if response.is_redirect:
                            location = response.headers.get("location")
                            if location is None:
                                raise FCCFetchError(
                                    current, "redirect without an address"
                                )
                            current = _safe_url(
                                urljoin(current, location), download=download
                            )
                            continue
                        if response.status_code != 200:
                            raise FCCFetchError(
                                current,
                                f"HTTP {response.status_code}",
                                response.status_code,
                            )
                        data = bytearray()
                        for chunk in response.iter_bytes(chunk_size=64 * 1024):
                            data.extend(chunk)
                            if len(data) > limit:
                                raise FCCFetchError(
                                    current, f"response exceeds {limit} bytes"
                                )
                            if time.monotonic() - started > self.timeout:
                                raise FCCFetchError(
                                    current, "request exceeded total time limit"
                                )
                        return bytes(data), current
                raise FCCFetchError(current, "too many redirects")
            except httpx.RequestError as error:
                failure = FCCFetchError(current, type(error).__name__)
            except FCCFetchError as error:
                failure = error
                if error.status_code not in (408, 429, 500, 502, 503, 504):
                    raise
            if attempt + 1 < self.attempts:
                time.sleep(min(2**attempt, 4))
        raise failure

    def read_folder(self, url: str, path: str) -> FolderListing:
        body, effective = self._fetch(url, self.max_listing_bytes)
        return parse_folder(body, effective, path)

    def download(self, file: FileListing) -> bytes:
        self.last_download_url = None
        _safe_url(file.url, download=True)
        try:
            body, effective = self._fetch(file.url, self.max_file_bytes, download=True)
        except FCCFetchError as error:
            match = _DOWNLOAD.fullmatch(urlsplit(file.url).path)
            timed_out = error.reason in {
                "ReadTimeout",
                "ConnectTimeout",
                "WriteTimeout",
                "PoolTimeout",
                "request exceeded total time limit",
            }
            if (
                match is None
                or (match[3] or "").lower() != ".pdf"
                or not (error.status_code == 403 or timed_out)
            ):
                raise
            # This public route is the destination of FCC's ordinary browser PDF
            # links (observed 2026-10-08), not an access-control bypass. Retain the
            # original link and expose the effective origin for archive evidence.
            alternate = f"{DISTRIBUTION_ORIGIN}/download/{match[2]}.pdf"
            try:
                body, effective = self._fetch(
                    alternate, self.max_file_bytes, download=True
                )
            except FCCFetchError as alternate_error:
                raise FCCFetchError(
                    file.url,
                    f"original request failed ({error}); official PDF distribution failed ({alternate_error})",
                ) from alternate_error
        self.last_download_url = effective
        if not body:
            raise FCCFetchError(effective, "empty document")
        if file.url.lower().endswith(".pdf") and not body.startswith(b"%PDF-"):
            raise FCCFetchError(effective, "response is not a PDF")
        if body.lstrip().lower().startswith((b"<!doctype html", b"<html")):
            raise FCCFetchError(effective, "HTML error page instead of a document")
        return body
