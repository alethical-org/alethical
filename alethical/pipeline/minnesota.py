from __future__ import annotations

import hashlib
import html
import re
import time
import xml.etree.ElementTree as ET
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any
from urllib.parse import urljoin

import requests
from sqlalchemy import delete, func, select, text, update
from sqlalchemy.orm import Session

from alethical.pipeline.http_text import response_text
from alethical.db.schema import load_schema
from alethical.monitoring import capture_operational_error
from alethical.pipeline.roster_pdf import (
    ReconcileReport,
    RosterMember,
    fetch_roster_pdf_text,
    name_matches,
    parse_roster_pdf,
)
from alethical.pipeline.sessions import (
    CURRENT_SESSION_SLUG,
    DEFAULT_SESSION_CODE,
    build_bill_key,
    parse_session_code,
    session_definition,
    special_session_number,
)

USER_AGENT = "Alethical Minnesota Ingest/0.1"
TIMEOUT = 30
MAX_RETRIES = 3
DIV_TAG_RE = re.compile(r"</?div\b[^>]*>", re.I)
REFERENCE_DATA_LOCK_KEY = 610312263001
DISTRICT_LOCK_KEY = 610312263002
LEGISLATOR_LOCK_KEY = 610312263003

schema = load_schema()
ArtifactType = schema.ArtifactType
AIEnrichment = schema.AIEnrichment
Bill = schema.Bill
BillAction = schema.BillAction
BillStats = schema.BillStats
BillVersion = schema.BillVersion
BillVersionSection = schema.BillVersionSection
Chamber = schema.Chamber
ChamberType = schema.ChamberType
Committee = schema.Committee
CommitteeMembership = schema.CommitteeMembership
District = schema.District
EnrichmentType = schema.EnrichmentType
IngestionRun = schema.IngestionRun
IngestionStatus = schema.IngestionStatus
Jurisdiction = schema.Jurisdiction
LegislativeSession = schema.LegislativeSession
Legislator = schema.Legislator
LegislatorServicePeriod = schema.LegislatorServicePeriod
LegislatorStats = schema.LegislatorStats
RagChunk = schema.RagChunk
RagChunkEmbedding = schema.RagChunkEmbedding
RagSectionDocument = schema.RagSectionDocument
SessionType = schema.SessionType
SourceArtifact = schema.SourceArtifact
Sponsorship = schema.Sponsorship
SponsorshipRole = schema.SponsorshipRole


class MinnesotaIngestionError(RuntimeError):
    pass


class BillRefreshRejected(MinnesotaIngestionError):
    """A source response that would shrink already-stored bill facts.

    ``needs_issue`` stays false for the first thin response because callers may
    retry it. It turns true only when that second fetch also fails the guard.
    The scheduled refresh in #1323 can therefore open one issue from the batch
    result without reporting a one-off source glitch.
    """

    def __init__(
        self,
        bill_key: str,
        drops: dict[str, dict[str, int]],
        *,
        needs_issue: bool = False,
        reason: str = "one fetch was thinner than the stored bill",
    ) -> None:
        self.bill_key = bill_key
        self.drops = drops
        self.needs_issue = needs_issue
        self.reason = reason
        fields = ", ".join(sorted(drops))
        super().__init__(
            f"Refused refresh for {bill_key}: fetched fewer {fields}; {self.reason}"
        )

    def report(self) -> dict[str, Any]:
        return {
            "bill_key": self.bill_key,
            "drops": self.drops,
            "needs_issue": self.needs_issue,
            "reason": self.reason,
        }


@dataclass(frozen=True)
class BillTarget:
    chamber: str
    bill_number: str
    session_code: str = DEFAULT_SESSION_CODE


@dataclass(frozen=True)
class BillSourcePayload:
    canonical: dict[str, Any]
    bill_text: dict[str, Any]
    xml_artifact: Any
    html_artifact: Any


@dataclass(frozen=True)
class BillIngestionResult:
    bill: Any
    public_text_changed: bool


@dataclass
class MergeReport:
    """Outcome of merging duplicate bill-author rows into their roster row.

    Every member historically had two Legislator rows: the roster row shown in
    the directory (external_key = profile URL, real district) and a bill-author
    row (external_key = the bare numeric member key, a "*-unknown" placeholder
    district) carrying every Sponsorship. This merges each author row into its
    roster row (#302); ``orphans`` are author rows with no roster match (former
    or non-current members), left untouched.
    """

    merged_pairs: int
    sponsorships_moved: int
    # (external_key, full_name) author rows with no roster match — left as-is
    orphans: list[tuple[str, str]]
    dry_run: bool

    def summary(self) -> str:
        verb = "would merge" if self.dry_run else "merged"
        lines = [
            f"Legislator merge: {verb} {self.merged_pairs} author row(s) into "
            f"their roster row, moving {self.sponsorships_moved} sponsorship(s); "
            f"{len(self.orphans)} author row(s) had no roster match (left as-is)."
        ]
        for external_key, name in self.orphans:
            lines.append(f"  ! orphan (no roster match): {name} [{external_key}]")
        return "\n".join(lines)


# Session number, year and special-session number embedded in a bill's status XML
# URI, e.g. https://api.revisor.mn.gov/bills/v1/94/2025/0/HF/2136/ — the third
# segment is 0 for a regular session and N for the Nth special session, matching
# the SESSION_TYPE the canonical XML reports (#746).
STATUS_URI_SESSION_RE = re.compile(r"/bills/v1/(\d+)/(\d{4})/(\d+)/")


@dataclass(frozen=True)
class BillSearchResult:
    chamber: str
    file_type: str
    file_number: int
    description: str
    status_xml_uri: str
    latest_text_html_uri: str
    session_code: str = DEFAULT_SESSION_CODE

    @property
    def bill_key(self) -> str:
        # The Revisor search returns the whole biennium regardless of the year in
        # the search session code (verified Jul 2026: a 0942026 search still lists
        # carried-over 2025 bills, and 0942025 lists 2026 introductions), so the
        # search code cannot identify a bill's session year. The bill's own status
        # URI can — and it matches the SESSION_NUMBER/SESSION_YEAR the canonical
        # XML parse keys the bill with, keeping only-missing dedup accurate.
        match = STATUS_URI_SESSION_RE.search(self.status_xml_uri)
        if match:
            session_number, year = int(match.group(1)), int(match.group(2))
            special = int(match.group(3))
        else:
            session_number, year = parse_session_code(self.session_code)
            special = special_session_number(self.session_code)
        return build_bill_key(
            session_number, year, self.file_type, self.file_number, special
        )

    @property
    def target(self) -> BillTarget:
        return BillTarget(
            chamber=self.chamber,
            bill_number=str(self.file_number),
            session_code=self.session_code,
        )


def http_session() -> requests.Session:
    sess = requests.Session()
    sess.headers.update({"User-Agent": USER_AGENT})
    return sess


def normalize_space(value: str, *, keep_change_markers: bool = False) -> str:
    value = html.unescape(value)
    value = value.replace("\xa0", " ")
    value = re.sub(r"<br\s*/?>", "\n", value, flags=re.I)
    value = re.sub(r"</(p|div|h\d|li|tr|blockquote)>", "\n", value, flags=re.I)
    value = re.sub(r"<[^>]+>", "", value)
    if not keep_change_markers:
        # The Revisor marks an amendment's added run with screen-reader-only
        # "new text begin/end" words and its removed run with "deleted text
        # begin/end". Dropping the added pair while keeping the removed one is
        # what `BillVersionSection.raw_text` has always stored, and two paid
        # caches key off that exact text: every section's embedding
        # (`rag_ingest.py` hashes raw_text) and every bill's AI summary
        # (`ai_enrichment.source_version_hash` does too). Changing it here would
        # invalidate both and re-run two corpus-wide paid jobs. So the added
        # marks are recovered on the structured path instead — see
        # `parse_section_blocks` and #741 — and this default is left alone.
        value = value.replace("new text begin", "").replace("new text end", "")
    value = re.sub(r"[ \t]+", " ", value)
    value = re.sub(r"\n{2,}", "\n\n", value)
    return value.strip()


def slugify(value: str) -> str:
    return "-".join(
        "".join(ch.lower() if ch.isalnum() else " " for ch in value).split()
    )


def content_hash(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def extract(pattern: str, text: str, *, flags: int = 0, default: str = "") -> str:
    match = re.search(pattern, text, flags)
    return normalize_space(match.group(1)) if match else default


def extract_all(pattern: str, text: str, *, flags: int = 0) -> list[str]:
    return [normalize_space(match) for match in re.findall(pattern, text, flags)]


def extract_attr(tag_html: str, attr: str) -> str:
    match = re.search(rf"""{attr}\s*=\s*["']([^"']+)["']""", tag_html, flags=re.I)
    return match.group(1).strip() if match else ""


def parse_datetime(value: str | None) -> datetime | None:
    if not value:
        return None
    value = value.strip()
    # The MN source emits action/version dates as "YYYY-MM-DD HH:MM:SS"
    # (e.g. "2025-04-30 00:00:00"); the date-only forms cover roster/profile
    # dates. Without the datetime forms every action_date parsed to None, which
    # is why the production corpus previously had no temporal signal (#328,
    # fixed here + one-time backfilled Jul 2026).
    for fmt in (
        "%m/%d/%Y",
        "%Y-%m-%d",
        "%m/%d/%y",
        "%Y-%m-%d %H:%M:%S",
        "%Y-%m-%dT%H:%M:%S",
        "%m/%d/%Y %H:%M:%S",
    ):
        try:
            return datetime.strptime(value, fmt).replace(tzinfo=UTC)
        except ValueError:
            continue
    return None


@dataclass(frozen=True)
class _CurrentStatusCandidate:
    action: dict[str, Any]
    reached_at: datetime | None
    chamber_index: int
    terminal_priority: int


def _action_datetime(action: dict[str, Any]) -> datetime | None:
    value = action.get("action_at") or action.get("action_date")
    if isinstance(value, datetime):
        return value if value.tzinfo is not None else value.replace(tzinfo=UTC)
    return parse_datetime(str(value)) if value else None


def _candidate_order(candidate: _CurrentStatusCandidate) -> tuple[datetime, int]:
    return (
        candidate.reached_at or datetime.min.replace(tzinfo=UTC),
        candidate.chamber_index,
    )


def select_current_bill_action(
    actions_by_chamber: dict[str, list[dict[str, Any]]],
) -> dict[str, Any] | None:
    """Select the bill's latest display action without mixing chamber counters.

    Minnesota numbers House and Senate actions independently. Within a chamber,
    that number is the source order. Across chambers, the newest date reached by
    each chamber is the only shared clock. An undated tail therefore carries the
    newest real date that precedes it in its own chamber, while the stored action
    date remains empty. Same-day ties use the XML chamber-block order, never the
    unrelated local action numbers.

    Veto and enactment actions are cumulative final milestones. Once one exists,
    a routine action cannot replace it as the display status. Veto keeps the same
    priority over enactment used by the bill status badge.
    """
    chamber_tails: list[_CurrentStatusCandidate] = []
    terminal_by_chamber: dict[tuple[int, int], _CurrentStatusCandidate] = {}

    for chamber_index, actions in enumerate(actions_by_chamber.values()):
        reached_at: datetime | None = None
        tail: _CurrentStatusCandidate | None = None
        ordered_actions = sorted(
            enumerate(actions),
            key=lambda item: (int(item[1].get("action_number") or 0), item[0]),
        )
        for _, action in ordered_actions:
            action_at = _action_datetime(action)
            if action_at is not None and (reached_at is None or action_at > reached_at):
                reached_at = action_at
            terminal_priority = schema.bill_action_terminal_priority(
                str(action.get("action_text") or "")
            )
            candidate = _CurrentStatusCandidate(
                action=action,
                reached_at=reached_at,
                chamber_index=chamber_index,
                terminal_priority=terminal_priority,
            )
            tail = candidate
            if terminal_priority:
                terminal_by_chamber[(chamber_index, terminal_priority)] = candidate

        if tail is not None:
            chamber_tails.append(tail)

    if terminal_by_chamber:
        highest_priority = max(
            candidate.terminal_priority for candidate in terminal_by_chamber.values()
        )
        candidates = [
            candidate
            for candidate in terminal_by_chamber.values()
            if candidate.terminal_priority == highest_priority
        ]
    else:
        candidates = chamber_tails

    selected = max(candidates, key=_candidate_order, default=None)
    return selected.action if selected is not None else None


def extract_balanced_div(html_text: str, start_index: int) -> str:
    first_tag = DIV_TAG_RE.match(html_text, start_index)
    if first_tag is None or first_tag.group(0).startswith("</"):
        raise MinnesotaIngestionError(f"Expected opening div at index {start_index}")

    depth = 1
    for tag_match in DIV_TAG_RE.finditer(html_text, first_tag.end()):
        tag = tag_match.group(0)
        if tag.startswith("</"):
            depth -= 1
            if depth == 0:
                return html_text[start_index : tag_match.end()]
        else:
            depth += 1

    raise MinnesotaIngestionError(
        f"Unbalanced div structure starting at index {start_index}"
    )


def locate_div_blocks(html_text: str, class_name: str) -> list[dict[str, object]]:
    pattern = re.compile(
        rf"""<div\b[^>]*class=["'][^"']*\b{re.escape(class_name)}\b[^"']*["'][^>]*>""",
        flags=re.I,
    )
    blocks: list[dict[str, object]] = []
    for match in pattern.finditer(html_text):
        block_html = extract_balanced_div(html_text, match.start())
        blocks.append(
            {
                "start": match.start(),
                "end": match.start() + len(block_html),
                "open_tag": match.group(0),
                "html": block_html,
                "id": extract_attr(match.group(0), "id"),
            }
        )
    return blocks


def fetch_text(sess: requests.Session, url: str) -> str:
    last_error: Exception | None = None
    for attempt in range(1, MAX_RETRIES + 1):
        try:
            response = sess.get(url, timeout=TIMEOUT)
            if (
                response.status_code in {429, 500, 502, 503, 504}
                and attempt < MAX_RETRIES
            ):
                time.sleep(0.5 * attempt)
                continue
            response.raise_for_status()
            return response_text(response)
        except requests.RequestException as exc:
            last_error = exc
            if attempt == MAX_RETRIES:
                break
            time.sleep(0.5 * attempt)
    raise MinnesotaIngestionError(f"Failed to fetch {url}: {last_error}")


def discover_bill(sess: requests.Session, target: BillTarget) -> dict[str, str]:
    params = {
        "body": target.chamber,
        "search": "basic",
        "session": target.session_code,
        "location": target.chamber,
        "bill": target.bill_number,
        "bill_type": "bill",
        "rev_number": "",
        "submit_bill": "GO",
        "keyword_type": "all",
        "keyword": "",
        "keyword_field_text": "1",
        "titleword": "",
        "format": "xml",
    }
    request = requests.Request(
        "GET", "https://www.revisor.mn.gov/bills/status_result.php", params=params
    ).prepare()
    xml_text = fetch_text(sess, request.url or "")
    root = ET.fromstring(xml_text)
    result = root.find(".//BILL_RESULT")
    if result is None:
        raise MinnesotaIngestionError(
            f"Bill search returned no results for {target.chamber} {target.bill_number}"
        )
    status_xml_uri = result.findtext("STATUS_XML_URI", "").strip()
    latest_text_html_uri = result.findtext("LATEST_TEXT_HTML_URI", "").strip()
    return {
        "file_type": result.findtext("FILE_TYPE", "").strip(),
        "file_number": result.findtext("FILE_NUMBER", "").strip(),
        "description": result.findtext("DESCRIPTION", "").strip(),
        "status_xml_uri": status_xml_uri
        if status_xml_uri.startswith("http")
        else f"https://{status_xml_uri}",
        "latest_text_html_uri": latest_text_html_uri
        if latest_text_html_uri.startswith("http")
        else f"https://{latest_text_html_uri}",
    }


def discover_bill_range(
    sess: requests.Session,
    *,
    chamber: str,
    bill_range: str,
    session_code: str = DEFAULT_SESSION_CODE,
) -> list[BillSearchResult]:
    params = {
        "body": chamber,
        "search": "basic",
        "session": session_code,
        "location": chamber,
        "bill": bill_range,
        "bill_type": "bill",
        "rev_number": "",
        "submit_bill": "GO",
        "keyword_type": "all",
        "keyword": "",
        "keyword_field_text": "1",
        "titleword": "",
        "format": "xml",
    }
    request = requests.Request(
        "GET", "https://www.revisor.mn.gov/bills/status_result.php", params=params
    ).prepare()
    xml_text = fetch_text(sess, request.url or "")
    root = ET.fromstring(xml_text)
    results = []
    for result in root.findall(".//BILL_RESULT"):
        status_xml_uri = result.findtext("STATUS_XML_URI", "").strip()
        latest_text_html_uri = result.findtext("LATEST_TEXT_HTML_URI", "").strip()
        file_number = (result.findtext("FILE_NUMBER") or "").strip()
        if not file_number.isdigit():
            continue
        results.append(
            BillSearchResult(
                chamber=chamber,
                file_type=(result.findtext("FILE_TYPE") or "").strip(),
                file_number=int(file_number),
                description=(result.findtext("DESCRIPTION") or "").strip(),
                status_xml_uri=status_xml_uri
                if status_xml_uri.startswith("http")
                else f"https://{status_xml_uri}",
                latest_text_html_uri=latest_text_html_uri
                if latest_text_html_uri.startswith("http")
                else f"https://{latest_text_html_uri}",
                session_code=session_code,
            )
        )
    return results


def discover_session_bills(
    sess: requests.Session,
    *,
    session_code: str = DEFAULT_SESSION_CODE,
    max_bill_number: int = 6000,
    chunk_size: int = 500,
) -> list[BillSearchResult]:
    seen: dict[tuple[str, int], BillSearchResult] = {}
    for chamber in ("House", "Senate"):
        for start in range(1, max_bill_number + 1, chunk_size):
            end = min(start + chunk_size - 1, max_bill_number)
            for result in discover_bill_range(
                sess,
                chamber=chamber,
                bill_range=f"{start}-{end}",
                session_code=session_code,
            ):
                seen[(result.file_type, result.file_number)] = result
    return sorted(seen.values(), key=lambda item: (item.file_type, item.file_number))


def parse_bill_xml(xml_text: str) -> dict[str, object]:
    root = ET.fromstring(xml_text)

    def text(path: str) -> str:
        return (root.findtext(path) or "").strip()

    authors: dict[str, list[dict[str, str]]] = {}
    for chamber_node in root.findall("./AUTHORS/*"):
        chamber = chamber_node.tag.lower()
        authors[chamber] = []
        for author in chamber_node.findall("./AUTHOR"):
            authors[chamber].append(
                {
                    "legislator_key": (author.findtext("LEGISLATOR_KEY") or "").strip(),
                    "member_name": (author.findtext("MEMBER_NAME") or "").strip(),
                    "committee_id": (author.findtext("COMMITTEE_ID") or "").strip(),
                    "committee_name": (author.findtext("COMMITTEE_NAME") or "").strip(),
                }
            )

    actions: dict[str, list[dict[str, str]]] = {}
    for chamber_node in root.findall("./ACTIONS/*"):
        chamber = chamber_node.tag.lower()
        actions[chamber] = []
        for action in chamber_node.findall("./ACTION"):
            actions[chamber].append(
                {
                    "action_number": (action.findtext("ACTION_NUMBER") or "").strip(),
                    "action_group": (action.findtext("ACTION_GROUP") or "").strip(),
                    "action_text": (action.findtext("ACTION_TEXT") or "").strip(),
                    "action_date": (action.findtext("ACTION_DATE") or "").strip(),
                    "action_description": (
                        action.findtext("ACTION_DESCRIPTION") or ""
                    ).strip(),
                    "committee_id": (action.findtext("COMMITTEE_ID") or "").strip(),
                    "committee_name": (action.findtext("COMMITTEE_NAME") or "").strip(),
                    "journal_page": (action.findtext("JOURNAL_PAGE") or "").strip(),
                    "roll_call": (action.findtext("ROLL_CALL") or "").strip(),
                }
            )

    versions = []
    for doc in root.findall("./TEXT_VERSION_LIST/DOCUMENT"):
        versions.append(
            {
                "html_uri": (doc.findtext("HTML_URI") or "").strip(),
                "pdf_uri": (doc.findtext("PDF_URI") or "").strip(),
                "date_insert": (doc.findtext("DATE_INSERT") or "").strip(),
                "document_name": (doc.findtext("DOCUMENT_NAME") or "").strip(),
                "document_type": (doc.findtext("DOCUMENT_TYPE") or "").strip(),
                "document_engrossment": (
                    doc.findtext("DOCUMENT_ENGROSSMENT") or ""
                ).strip(),
            }
        )

    return {
        # SESSION_TYPE is the special-session number (0 = regular), so it must be
        # part of the key: the regular and special sessions of one Legislature both
        # number their files from 1, and HF 5 in each is a different bill (#746).
        "bill_key": build_bill_key(
            text("SESSION_NUMBER"),
            text("SESSION_YEAR"),
            text("FILE_TYPE"),
            text("FILE_NUMBER"),
            text("SESSION_TYPE") or 0,
        ),
        "file_type": text("FILE_TYPE"),
        "file_number": text("FILE_NUMBER"),
        "revisor_number": text("REVISOR_NUMBER"),
        "description": text("DESCRIPTION"),
        "session_year": text("SESSION_YEAR"),
        "session_number": text("SESSION_NUMBER"),
        # Carried through so link_companion can build the companion's key with
        # build_bill_key, the same way this bill's own key above is built. Without
        # it a special-session bill resolved its companion to the *regular*
        # session's file of that number (#928).
        "special_session": text("SESSION_TYPE") or 0,
        # MN bills come in House/Senate companion pairs; the detailed status XML
        # names the companion's file type + number (e.g. SF2483 -> HF2431). Used
        # to populate Bill.companion_bill_id in upsert_bill (#293).
        "companion_type": text("COMPANION_TYPE"),
        "companion_number": text("COMPANION_NUMBER"),
        "authors": authors,
        "actions": actions,
        "text_versions": versions,
    }


# --- Structured section body (#741, #752) -----------------------------------
#
# `parse_bill_section` flattens a section to one string, which loses three things
# the Revisor publishes: the subdivision numbers ("Subd. 2."), the marks saying
# which words a bill ADDS, and the row/column shape of appropriation tables.
#
# The flat string stays exactly as it was — see the comment in `normalize_space`
# for why — and the lost structure is recovered alongside it as an ordered list
# of blocks, stored in `BillVersionSection.body_blocks`:
#
#   {"kind": "heading", "number": "Subd. 4.", "text": "License fee."}
#   {"kind": "para",    "text": "(a) new text begin A program … new text end"}
#   {"kind": "table",   "rows": [[{"text": "General Fund"}, {"text": "$"}, …]]}
#
# Headings the section already stores in their own columns (`section_number`,
# `statute_section_number`, `shn`, `effective_date`, `title`) are left out, so a
# consumer can render every block without checking for duplicates.
STRUCTURAL_TAG_RE = re.compile(r"<\s*(h[123]|table|p)\b", flags=re.I)
TABLE_ROW_RE = re.compile(r"<\s*tr\b", flags=re.I)
TABLE_CELL_RE = re.compile(r"<\s*(td|th)\b", flags=re.I)
CELL_ALIGN_RE = re.compile(r"text-align\s*:\s*(left|right|center)", flags=re.I)
# Heading classes whose text is already captured as a column on the section row.
COLUMN_HEADING_CLASSES = {
    "section_number",
    "statute_section_number",
    "shn",
    "effective_date",
    "title",
}
# The same headings, for removal from a table cell's text. An appropriation
# section is one big layout table, so the section heading can sit in the same row
# as that row's figures; left in the cell it would print a second time under the
# card's own heading.
COLUMN_HEADING_RE = re.compile(
    r"<h[123]\b[^>]*\bclass=[\"'][^\"']*\b(?:"
    + "|".join(sorted(COLUMN_HEADING_CLASSES))
    + r")\b[^\"']*[\"'][^>]*>.*?</h[123]>",
    flags=re.S | re.I,
)


def balanced_element(html_text: str, start: int, tag: str) -> tuple[str, int]:
    """Return the ``tag`` element opening at ``start``, plus the index after it.

    The tag-name-agnostic sibling of `extract_balanced_div`. Handles the
    self-closing spacer cells the Revisor emits (``<td/>``) and tolerates an
    unclosed element by running to the end of the fragment rather than raising —
    one malformed section must never fail a whole bill's ingest.
    """
    pattern = re.compile(rf"<\s*(/?){re.escape(tag)}\b[^>]*?(/?)\s*>", flags=re.I)
    first = pattern.match(html_text, start)
    if first is None:
        return "", start
    if first.group(2) == "/":
        return html_text[start : first.end()], first.end()
    depth = 1
    for match in pattern.finditer(html_text, first.end()):
        if match.group(1) == "/":
            depth -= 1
            if depth == 0:
                return html_text[start : match.end()], match.end()
        elif match.group(2) != "/":
            depth += 1
    return html_text[start:], len(html_text)


def element_inner(element_html: str) -> str:
    """The content between an element's open and close tags."""
    open_end = element_html.find(">")
    if open_end == -1:
        return ""
    close_start = element_html.rfind("<")
    if close_start <= open_end:
        return ""
    return element_html[open_end + 1 : close_start]


def _one_line(text: str) -> str:
    """Fold a block's internal line breaks back into spaces.

    Every newline inside one paragraph, heading or cell came from the source
    HTML's own indentation between tags, not from the bill: the Revisor's
    in-paragraph breaks are `<br class="d-none d-md-inline-block">`, which carry
    no newline through `normalize_space`, and a bare `<br>` never appears inside
    a `<p>` or `<td>` (checked over both a plain amending bill and a 2 MB omnibus
    bill). Left in, they would render as line breaks mid-sentence.
    """
    return re.sub(r"\s*\n\s*", " ", text).strip()


def _append_paragraphs(fragment: str, blocks: list[dict[str, object]]) -> None:
    """Emit one paragraph block per blank-line-separated run of text."""
    text = normalize_space(fragment, keep_change_markers=True)
    for paragraph in re.split(r"\n\s*\n", text):
        paragraph = _one_line(paragraph)
        if paragraph:
            blocks.append({"kind": "para", "text": paragraph})


def _append_heading(element_html: str, blocks: list[dict[str, object]]) -> None:
    open_tag = element_html[: element_html.find(">") + 1]
    classes = set(extract_attr(open_tag, "class").split())
    if classes & COLUMN_HEADING_CLASSES:
        return
    text = _one_line(normalize_space(element_html, keep_change_markers=True))
    if not text:
        return
    role = "subdivision" if "subd_no" in classes else "headnote"
    blocks.append({"kind": "heading", "role": role, "text": text})


def _parse_table_cells(
    table_html: str,
) -> list[list[tuple[str, dict[str, object]]]]:
    """Each row's cells as (inner HTML, block payload) pairs, in source order."""
    rows: list[list[tuple[str, dict[str, object]]]] = []
    position = 0
    while True:
        row_match = TABLE_ROW_RE.search(table_html, position)
        if row_match is None:
            return rows
        row_html, position = balanced_element(table_html, row_match.start(), "tr")
        if not row_html:
            return rows
        cells: list[tuple[str, dict[str, object]]] = []
        cell_position = 0
        while True:
            cell_match = TABLE_CELL_RE.search(row_html, cell_position)
            if cell_match is None:
                break
            tag = cell_match.group(1).lower()
            cell_html, cell_position = balanced_element(
                row_html, cell_match.start(), tag
            )
            if not cell_html:
                break
            open_tag = cell_html[: cell_html.find(">") + 1]
            payload: dict[str, object] = {
                "text": _one_line(
                    normalize_space(
                        COLUMN_HEADING_RE.sub("", cell_html),
                        keep_change_markers=True,
                    )
                )
            }
            colspan = extract_attr(open_tag, "colspan")
            if colspan.isdigit() and int(colspan) > 1:
                payload["colspan"] = int(colspan)
            align = CELL_ALIGN_RE.search(extract_attr(open_tag, "style"))
            if align:
                payload["align"] = align.group(1).lower()
            if tag == "th":
                payload["header"] = True
            cells.append((element_inner(cell_html), payload))
        rows.append(cells)


def _append_table(table_html: str, blocks: list[dict[str, object]]) -> None:
    rows = _parse_table_cells(table_html)
    filled = [cell for row in rows for _inner, cell in row if cell["text"]]
    if len(filled) <= 1:
        # A one-cell table is layout, not data: appropriation sections wrap the
        # section heading in a full-width table row, and rendering that as a
        # table would print a heading in a one-cell grid. Read its cells for
        # blocks instead.
        for row in rows:
            for inner, _cell in row:
                _append_blocks(inner, blocks)
        return
    kept = [
        [cell for _inner, cell in row]
        for row in rows
        if any(cell["text"] for _inner, cell in row)
    ]
    if kept:
        blocks.append({"kind": "table", "rows": kept})


def _append_blocks(fragment: str, blocks: list[dict[str, object]]) -> None:
    position = 0
    while True:
        match = STRUCTURAL_TAG_RE.search(fragment, position)
        if match is None:
            _append_paragraphs(fragment[position:], blocks)
            return
        _append_paragraphs(fragment[position : match.start()], blocks)
        tag = match.group(1).lower()
        element_html, position = balanced_element(fragment, match.start(), tag)
        if not element_html:
            _append_paragraphs(fragment[match.start() :], blocks)
            return
        if tag == "table":
            _append_table(element_html, blocks)
        elif tag == "p":
            _append_paragraphs(element_html, blocks)
        else:
            _append_heading(element_html, blocks)


def _merge_subdivision_headings(
    blocks: list[dict[str, object]],
) -> list[dict[str, object]]:
    """Pair each "Subd. 4." with the headnote that titles it.

    The Revisor publishes the two as siblings — `<h2 class="subd_no">` then
    `<h3 class="headnote">` — and they occur 1:1 on 84% of sections, so one
    block carrying both is what a reader sees: "Subd. 4. License fee."
    """
    merged: list[dict[str, object]] = []
    index = 0
    while index < len(blocks):
        block = blocks[index]
        if block.get("kind") != "heading":
            merged.append(block)
            index += 1
            continue
        role = block.pop("role", "")
        if role == "subdivision":
            heading: dict[str, object] = {
                "kind": "heading",
                "number": block["text"],
                "text": "",
            }
            following = blocks[index + 1] if index + 1 < len(blocks) else None
            if following is not None and following.get("role") == "headnote":
                following.pop("role", None)
                heading["text"] = following["text"]
                index += 1
            merged.append(heading)
        else:
            merged.append({"kind": "heading", "number": "", "text": block["text"]})
        index += 1
    return merged


def parse_section_blocks(section_html: str) -> list[dict[str, object]]:
    """A section's body as ordered blocks, keeping what flattening destroys."""
    blocks: list[dict[str, object]] = []
    _append_blocks(section_html, blocks)
    return _merge_subdivision_headings(blocks)


def parse_bill_section(section_html: str, section_id: str) -> dict[str, object]:
    heading = extract(
        r"""<h2 class=["']section_number["']>(.*?)</h2>""", section_html, flags=re.S
    )
    statute_heading = extract(
        r"""<h2 class=["']statute_section_number["']>(.*?)</h2>""",
        section_html,
        flags=re.S,
    )
    cite_heading = extract(
        r"""<h1 class=["']shn["']>(.*?)</h1>""", section_html, flags=re.S
    )
    effective_date = extract(
        r"""<h2 class=["']effective_date["']>(.*?)</h2>""", section_html, flags=re.S
    )
    text = normalize_space(
        re.sub(
            r"""<h[12]\s+class=["'](?:section_number|statute_section_number|subd_no|effective_date|shn|title)["'][^>]*>.*?</h[12]>""",
            "",
            section_html,
            flags=re.S,
        )
    )
    return {
        "section_id": section_id,
        "heading": heading,
        "statute_heading": statute_heading,
        "cite_heading": cite_heading,
        "effective_date_heading": effective_date,
        "text": text,
        "blocks": parse_section_blocks(section_html),
    }


def parse_bill_text_html(html_text: str, source_url: str) -> dict[str, object]:
    title = extract(r"<title>\s*(.*?)\s*</title>", html_text, flags=re.S)
    bill_title = extract(
        r"<div class=\"bill_title\">(.*?)</div>", html_text, flags=re.S
    )
    article_blocks = locate_div_blocks(html_text, "article")
    article_ranges = [
        (int(block["start"]), int(block["end"])) for block in article_blocks
    ]
    articles = []
    sections = []

    for article_block in article_blocks:
        article_html = str(article_block["html"])
        article_number = extract(
            r"""<h1 class=["']article_no["']>(.*?)</h1>""", article_html, flags=re.S
        )
        article_heading = extract(
            r"""<h1 class=["']article_header["']>(.*?)</h1>""", article_html, flags=re.S
        )
        article_sections = []
        for section_block in locate_div_blocks(article_html, "bill_section"):
            parsed = parse_bill_section(
                str(section_block["html"]), str(section_block["id"])
            )
            article_sections.append(parsed)
            sections.append(parsed)
        articles.append(
            {
                "article_id": article_block["id"],
                "article_number": article_number,
                "article_heading": article_heading,
                "sections": article_sections,
            }
        )

    if article_ranges:
        for section_block in locate_div_blocks(html_text, "bill_section"):
            start = int(section_block["start"])
            end = int(section_block["end"])
            if any(
                start >= article_start and end <= article_end
                for article_start, article_end in article_ranges
            ):
                continue
            sections.append(
                parse_bill_section(str(section_block["html"]), str(section_block["id"]))
            )
    else:
        for section_block in locate_div_blocks(html_text, "bill_section"):
            sections.append(
                parse_bill_section(str(section_block["html"]), str(section_block["id"]))
            )

    return {
        "source_url": source_url,
        "page_title": title,
        "bill_title_text": bill_title,
        "articles": articles,
        "sections": sections,
    }


def parse_roster_entries(section_html: str, chamber: str) -> list[dict[str, str]]:
    entries = []
    pattern = re.compile(
        r"<div class='media my-3'>.*?<img[^>]+src='([^']+)'[^>]+alt='([^']+)'.*?"
        r"<h5 class='mt-0 mb-0'><a href='([^']+)'><b>([^<]+)</b></a></h5>\s*District:\s*([0-9A-Z]+)",
        re.S,
    )
    for image_url, alt_text, profile_url, display_name, district in pattern.findall(
        section_html
    ):
        entries.append(
            {
                "chamber": chamber,
                "display_name": normalize_space(display_name),
                "district": district.strip(),
                "profile_url": urljoin(
                    "https://www.leg.mn.gov/leg/legislators", profile_url
                ),
                "image_url": image_url.strip(),
                "alt_text": alt_text.strip(),
            }
        )
    return entries


def parse_roster(html_text: str) -> dict[str, object]:
    house_match = re.search(
        r"<h2 class=\"h1\">House of Representatives</h2>.*?<div\s+class=\"lrl_sort_name\"\s+data-body=\"house\">(.*?)<div\s+class=\"lrl_sort_district\"\s+data-body=\"house\"\s*>",
        html_text,
        flags=re.S,
    )
    senate_match = re.search(
        r"<h2 class=\"h1\">Senate</h2>.*?<div\s+class=\"lrl_sort_name\"\s+data-body=\"senate\">(.*?)<div\s+class=\"lrl_sort_district\"\s+data-body=\"senate\"\s*>",
        html_text,
        flags=re.S,
    )
    house = parse_roster_entries(house_match.group(1) if house_match else "", "house")
    senate = parse_roster_entries(
        senate_match.group(1) if senate_match else "", "senate"
    )
    return {
        "source_url": "https://www.leg.mn.gov/leg/legislators",
        "members": [*house, *senate],
    }


def parse_house_profile(html_text: str, source_url: str) -> dict[str, object]:
    heading = extract(r"<h5 class=\"mt-0\">(.*?)</h5>", html_text, flags=re.S)
    name = extract(
        r"<h5 class=\"mt-0\">\s*([^<]+?)\s*<span", html_text, flags=re.S
    ) or normalize_space(heading)
    party = extract(r"\(([^)]+)\)\s*District:", heading, flags=re.S)
    district = extract(r"District:\s*([0-9A-Z]+)", heading, flags=re.S)
    return {
        "source_url": source_url,
        "chamber": "house",
        "name": name,
        "party": party,
        "district": district,
        "office_block": extract(
            r"<h5 class=\"mt-0\">.*?</h5>\s*(.*?)<span><a href=\"photo/",
            html_text,
            flags=re.S,
        ),
        "email": extract(r"mailto:([^\"'>\s]+@house\.mn\.gov)", html_text, flags=re.I),
        "office_phone": extract(
            r"<span>(651-[0-9-]+)</span>\s*<br", html_text, flags=re.I
        ),
        "committees": extract_all(
            r"<a href=\"https://www.house\.mn\.gov/cmte/Home/\?comm=\d+\">([^<]+)</a>",
            html_text,
        ),
    }


def strip_legislative_title(name: str) -> str:
    """Remove a role accidentally included in an official display name."""
    return re.sub(
        r"^(?:Rep\.?|Representative|Sen\.?|Senator)\s+", "", name, flags=re.I
    ).strip()


def parse_senate_profile(html_text: str, source_url: str) -> dict[str, object]:
    heading = extract(r"<h1 class='mb-0'>(.*?)</h1>", html_text, flags=re.S)
    email_form = extract(
        r"<span><b>E-mail:</b>\s*<a href='([^']+)'", html_text, flags=re.S
    )
    return {
        "source_url": source_url,
        "chamber": "senate",
        "name": strip_legislative_title(extract(r"^(.*?)\s*\(", heading, flags=re.S)),
        "party": extract(r"\(\d+,\s*([A-Z]+)\)", heading, flags=re.S),
        "district": extract(r"\((\d+),", heading, flags=re.S),
        "office_block": extract(
            r"<div class='media-body align-self-center'>(.*?)</div>\s*</div>\s*<div class=\"mt-3\">",
            html_text,
            flags=re.S,
        ),
        "email": urljoin(source_url, email_form) if email_form else "",
        "office_phone": extract(r"<span>(651-[0-9-]+)</span>", html_text, flags=re.I),
        "committees": extract_all(
            r"<a href='/committees/committee_bio\.php\?cmte_id=\d+'>([^<]+)</a>",
            html_text,
        ),
    }


def parse_member_profile(html_text: str, source_url: str) -> dict[str, object]:
    if "house.mn.gov" in source_url:
        return parse_house_profile(html_text, source_url)
    return parse_senate_profile(html_text, source_url)


class MinnesotaIngestionPipeline:
    def __init__(self, db: Session, sess: requests.Session | None = None) -> None:
        self.db = db
        self.http = sess or http_session()

    def advisory_xact_lock(self, key: int) -> None:
        self.db.execute(text("select pg_advisory_xact_lock(:key)"), {"key": key})

    def _existing_reference_data(self, session_slug: str) -> dict[str, Any] | None:
        """Return the reference dict if jurisdiction, all chambers, and the
        session named by ``session_slug`` already exist; else None. Lets
        seed_reference_data skip the advisory lock on the common (refresh) path so
        concurrent chunks do not serialize on it."""
        minnesota = self.db.scalar(
            select(Jurisdiction).where(Jurisdiction.slug == "minnesota")
        )
        if minnesota is None:
            return None
        chambers: dict[str, Any] = {}
        for slug in ("house", "senate", "joint"):
            chamber = self.db.scalar(
                select(Chamber).where(
                    Chamber.jurisdiction_id == minnesota.id, Chamber.slug == slug
                )
            )
            if chamber is None:
                return None
            chambers[slug] = chamber
        session = self.db.scalar(
            select(LegislativeSession).where(
                LegislativeSession.jurisdiction_id == minnesota.id,
                LegislativeSession.slug == session_slug,
            )
        )
        if session is None:
            return None
        return {"jurisdiction": minnesota, "chambers": chambers, "session": session}

    def seed_reference_data(
        self, session_code: str = DEFAULT_SESSION_CODE
    ) -> dict[str, Any]:
        """Jurisdiction, chambers, and the ``LegislativeSession`` row that
        ``session_code``'s bills belong to, creating whatever is missing.

        The session row is created here rather than up front, so a session only
        appears in the picker once its bills are actually ingested (#746).
        """
        definition = session_definition(session_code)
        existing = self._existing_reference_data(definition.slug)
        if existing is not None:
            # The lock-free refresh path must heal old or damaged date rows too.
            existing["session"].start_date = definition.start_date
            existing["session"].end_date = definition.end_date
            return existing
        # A reference row is missing — seed under the lock. The body below
        # re-checks every row, so it stays race-safe while the lock is held.
        self.advisory_xact_lock(REFERENCE_DATA_LOCK_KEY)
        minnesota = self.db.scalar(
            select(Jurisdiction).where(Jurisdiction.slug == "minnesota")
        )
        if minnesota is None:
            minnesota = Jurisdiction(
                slug="minnesota",
                name="Minnesota",
                country_code="US",
                subdivision_code="MN",
            )
            self.db.add(minnesota)
            self.db.flush()

        chambers: dict[str, Any] = {}
        for chamber_type, slug, name, short_name, order in [
            (
                ChamberType.house,
                "house",
                "Minnesota House of Representatives",
                "House",
                1,
            ),
            (ChamberType.senate, "senate", "Minnesota Senate", "Senate", 2),
            (ChamberType.joint, "joint", "Joint", "Joint", 3),
        ]:
            chamber = self.db.scalar(
                select(Chamber).where(
                    Chamber.jurisdiction_id == minnesota.id, Chamber.slug == slug
                )
            )
            if chamber is None:
                chamber = Chamber(
                    jurisdiction_id=minnesota.id,
                    chamber_type=chamber_type,
                    slug=slug,
                    name=name,
                    short_name=short_name,
                    display_order=order,
                )
                self.db.add(chamber)
                self.db.flush()
            chambers[slug] = chamber

        session = self.db.scalar(
            select(LegislativeSession).where(
                LegislativeSession.jurisdiction_id == minnesota.id,
                LegislativeSession.slug == definition.slug,
            )
        )
        if session is None:
            session = LegislativeSession(
                jurisdiction_id=minnesota.id,
                slug=definition.slug,
                session_number=definition.session_number,
                session_type=SessionType(definition.session_type),
                year_start=definition.year_start,
                year_end=definition.year_end,
                name=definition.name,
                is_current=definition.is_current,
            )
            self.db.add(session)
            self.db.flush()

        # Idempotently ensure the session's date range (#343): heals a session row
        # ingested before these columns were populated, so a re-ingest never
        # leaves them silently null.
        session.start_date = definition.start_date
        session.end_date = definition.end_date
        return {
            "jurisdiction": minnesota,
            "chambers": chambers,
            "session": session,
        }

    def start_run(self, target_type: str, target_key: str | None = None) -> Any:
        run = IngestionRun(
            adapter="minnesota_live",
            target_type=target_type,
            target_key=target_key,
            status=IngestionStatus.running,
            stats={},
        )
        self.db.add(run)
        self.db.flush()
        return run

    def finish_run(self, run: Any, stats: dict[str, Any]) -> None:
        run.status = IngestionStatus.succeeded
        run.finished_at = datetime.now(UTC)
        run.stats = stats

    def fail_run(
        self, run: Any, error: Exception, stats: dict[str, Any] | None = None
    ) -> None:
        run.status = IngestionStatus.failed
        run.finished_at = datetime.now(UTC)
        run.stats = stats or {}
        run.error_text = str(error)
        capture_operational_error(
            error,
            area="ingestion",
            operation="run-failed",
            tags={
                "ingestion.adapter": str(run.adapter),
                "ingestion.target_key": str(run.target_key or "none"),
                "ingestion.target_type": str(run.target_type),
            },
        )

    def record_artifact(
        self,
        run: Any,
        artifact_type: Any,
        source_url: str,
        body: str,
        *,
        source_key: str | None = None,
    ) -> Any:
        digest = content_hash(body)
        artifact = self.db.scalar(
            select(SourceArtifact).where(
                SourceArtifact.adapter == "minnesota_live",
                SourceArtifact.source_url == source_url,
                SourceArtifact.content_hash == digest,
            )
        )
        if artifact is None:
            artifact = SourceArtifact(
                run_id=run.id,
                adapter="minnesota_live",
                artifact_type=artifact_type,
                source_key=source_key,
                source_url=source_url,
                storage_path=f"minnesota-live/{digest}",
                content_hash=digest,
                http_status=200,
                metadata_json={},
                is_current=True,
            )
            self.db.add(artifact)
            self.db.flush()
        else:
            artifact.run_id = run.id
            artifact.source_key = source_key
            artifact.is_current = True
        return artifact

    def upsert_district(self, refs: dict[str, Any], chamber: Any, code: str) -> Any:
        def _lookup() -> Any:
            return self.db.scalar(
                select(District).where(
                    District.jurisdiction_id == refs["jurisdiction"].id,
                    District.chamber_id == chamber.id,
                    District.code == code,
                )
            )

        district = _lookup()
        if district is not None:
            return district
        # Missing — lock, then re-check before inserting (race-safe under lock).
        self.advisory_xact_lock(DISTRICT_LOCK_KEY)
        district = _lookup()
        if district is None:
            district = District(
                jurisdiction_id=refs["jurisdiction"].id,
                chamber_id=chamber.id,
                code=code,
                label=f"District {code}",
            )
            self.db.add(district)
            self.db.flush()
        return district

    def upsert_legislator(
        self, refs: dict[str, Any], name: str, *, external_key: str | None = None
    ) -> Any:
        name = strip_legislative_title(name)
        key = external_key or name

        def _lookup() -> Any:
            return self.db.scalar(
                select(Legislator).where(
                    Legislator.jurisdiction_id == refs["jurisdiction"].id,
                    Legislator.external_key == key,
                )
            )

        legislator = _lookup()
        if legislator is None:
            # Take the lock and re-check before inserting (race-safe under lock).
            self.advisory_xact_lock(LEGISLATOR_LOCK_KEY)
            legislator = _lookup()
        if legislator is None:
            slug = slugify(name)
            existing_slug = self.db.scalar(
                select(Legislator).where(
                    Legislator.jurisdiction_id == refs["jurisdiction"].id,
                    Legislator.slug == slug,
                )
            )
            if existing_slug is not None:
                slug = f"{slug}-{hashlib.sha1(key.encode('utf-8')).hexdigest()[:8]}"
            legislator = Legislator(
                jurisdiction_id=refs["jurisdiction"].id,
                slug=slug,
                external_key=key,
                full_name=name,
                sort_name=name,
            )
            self.db.add(legislator)
            self.db.flush()
        else:
            old_full_name = legislator.full_name
            legislator.full_name = name
            # A bill's official author record can supply the exact sorted form
            # used by House roll calls (for example "Anderson, P. H."). Keep
            # that stronger identity when a later roster refresh supplies only
            # the friendly display name ("Paul Anderson").
            if not legislator.sort_name or legislator.sort_name == old_full_name:
                legislator.sort_name = name
        return legislator

    @staticmethod
    def _member_key(external_key: str | None) -> str | None:
        """The trailing numeric member id of a Legislator external_key.

        Roster rows key on the member profile URL (House
        ``.../members/profile/15640``, Senate ``...member_bio.php?leg_id=15541``);
        bill-author rows key on the bare numeric id (``15640``). Both end with the
        member id, so its trailing digits are the shared identity used to fold the
        author row into the roster row (#302)."""
        if not external_key:
            return None
        match = re.search(r"(\d+)\s*$", external_key)
        return match.group(1) if match else None

    def _find_canonical_roster(
        self, refs: dict[str, Any], member_key: str | None
    ) -> Any:
        """The roster Legislator whose external_key ends with ``member_key`` (its
        profile-URL id), if exactly one exists. Excludes the bare-numeric author
        row (external_key == member_key) so this returns the roster/profile row.
        Returns None when the match is absent or ambiguous — the caller then falls
        back to the numeric-keyed row (bills ingested before the roster, or a
        genuine non-roster author)."""
        if not member_key:
            return None
        candidates = self.db.scalars(
            select(Legislator).where(
                Legislator.jurisdiction_id == refs["jurisdiction"].id,
                Legislator.external_key.isnot(None),
                Legislator.external_key != member_key,
                Legislator.external_key.ilike(f"%{member_key}"),
            )
        ).all()
        # Anchor to trailing-digit equality so a short key can't suffix-match a
        # longer id (e.g. "5541" inside "15541").
        matches = [
            c for c in candidates if self._member_key(c.external_key) == member_key
        ]
        return matches[0] if len(matches) == 1 else None

    def _find_placeholder_author(
        self, refs: dict[str, Any], member_key: str | None, *, exclude_id: Any
    ) -> Any:
        """The bare-numeric bill-author placeholder row for ``member_key`` (its
        external_key is exactly the numeric id), if any — used at roster ingest to
        fold a placeholder created by an earlier bill ingest into the roster row."""
        if not member_key:
            return None
        return self.db.scalar(
            select(Legislator).where(
                Legislator.jurisdiction_id == refs["jurisdiction"].id,
                Legislator.external_key == member_key,
                Legislator.id != exclude_id,
            )
        )

    # Every table.column that references legislator.id, as (table, fk_column,
    # dedup_columns). Repointing a source row's data to the target must not
    # violate the referencing table's own unique key, so dedup_columns names the
    # rest of that key: a source row whose (target_id, *dedup) already exists on
    # the target is dropped instead of repointed. Kept in sync with the live
    # production FK set, which as of #855 is the same set the repo declares:
    # the two entries that existed only in production — evidence_document and
    # chat_session.subject_legislator_id, both from the representative-evidence
    # feature applied out-of-band (#288) — are gone, dropped by migrations 0022
    # and 0023. service_period + stats are dropped (the target keeps its own
    # real-district ones), so they are not listed here.
    _LEGISLATOR_FK_REPOINTS = (
        # (table, fk_column, dedup_columns)  -- dedup = the rest of the unique key
        # sponsorship names committee_id and source_chamber because both are in
        # the real key. Leaving source_chamber out made the merge treat one
        # person's House-list and Senate-list authorship of the same bill as one
        # row and delete one of them -- and the official record does show both
        # (SF 1943: Hemmingsen-Jaeger is House author 14 and Senate author 5).
        # See migration 0018 for the matching database constraint (#928).
        (
            "sponsorship",
            "legislator_id",
            ("bill_id", "committee_id", "role", "source_chamber"),
        ),
        ("vote_record", "legislator_id", ("vote_event_id",)),
        ("committee_membership", "legislator_id", ("committee_id", "role")),
        ("ai_enrichment", "legislator_id", ()),
    )

    def _merge_legislator(self, source: Any, target: Any) -> int:
        """Move ``source``'s data onto ``target`` and delete ``source``.

        Repoints every legislator-referencing row (sponsorships, votes, committee
        memberships, AI enrichments), dropping any that would duplicate an
        existing target row on the referencing table's unique key; drops
        ``source``'s own service periods and stats; then deletes ``source``.
        Returns the number of sponsorships moved. Idempotent."""
        moved = 0
        if "," in source.sort_name and "," not in target.sort_name:
            target.sort_name = source.sort_name
        for table, column, dedup in self._LEGISLATOR_FK_REPOINTS:
            if not self._column_exists(table, column):
                continue
            count = self._repoint(table, column, dedup, source.id, target.id)
            if table == "sponsorship":
                moved = count
        self.db.execute(
            delete(LegislatorServicePeriod).where(
                LegislatorServicePeriod.legislator_id == source.id
            )
        )
        self.db.execute(
            delete(LegislatorStats).where(LegislatorStats.legislator_id == source.id)
        )
        self.db.execute(delete(Legislator).where(Legislator.id == source.id))
        self.db.flush()
        return moved

    def _column_exists(self, table: str, column: str) -> bool:
        """Whether public.<table>.<column> exists.

        Every entry in ``_LEGISLATOR_FK_REPOINTS`` is now in the repo's own schema,
        so this always answers True today — it is kept as the guard for the *next*
        column that exists in only one of the two databases. That situation is not
        hypothetical: it is what the two out-of-band columns from #288 were, and
        this check is why the merge stayed correct against both schemas until #855
        dropped them."""
        return (
            self.db.scalar(
                text(
                    "SELECT 1 FROM information_schema.columns "
                    "WHERE table_schema='public' AND table_name=:t "
                    "AND column_name=:c"
                ),
                {"t": table, "c": column},
            )
            is not None
        )

    def _repoint(
        self,
        table: str,
        column: str,
        dedup: tuple[str, ...],
        source_id: Any,
        target_id: Any,
    ) -> int:
        """Repoint ``table.column`` rows from source to target. First drops any
        source row that would collide with an existing target row on the rest of
        that table's unique key (``dedup`` columns), then repoints the remainder.
        Table/column names are fixed literals (see _LEGISLATOR_FK_REPOINTS), never
        user input. Returns the number of rows repointed."""
        if dedup:
            # IS NOT DISTINCT FROM, not `=`: several dedup columns are nullable
            # (sponsorship.committee_id, committee_membership.role), and `=`
            # yields NULL rather than true when both sides are empty, so a
            # colliding row was never matched and never dropped. The repoint then
            # created the duplicate the drop existed to prevent. This is the same
            # null rule the matching constraints in 0018 spell NULLS NOT
            # DISTINCT, so the two now agree about what a collision is (#928).
            match = " AND ".join(
                f"t.{col} IS NOT DISTINCT FROM s.{col}" for col in dedup
            )
            self.db.execute(
                text(
                    f"DELETE FROM {table} AS s WHERE s.{column} = :src "
                    f"AND EXISTS (SELECT 1 FROM {table} AS t "
                    f"WHERE t.{column} = :tgt AND {match})"
                ),
                {"src": source_id, "tgt": target_id},
            )
        result = self.db.execute(
            text(f"UPDATE {table} SET {column} = :tgt WHERE {column} = :src"),
            {"src": source_id, "tgt": target_id},
        )
        return result.rowcount or 0

    def merge_duplicate_legislators(self, *, dry_run: bool = True) -> MergeReport:
        """One-time backfill: merge every bill-author placeholder row into its
        roster row and repoint sponsorships (#302). Author rows with no roster
        match (former/non-current members) are reported as orphans and left
        untouched. Recomputes stats for the merged roster rows. Idempotent."""
        refs = self.seed_reference_data()
        jurisdiction_id = refs["jurisdiction"].id
        real_current_sp = (
            select(LegislatorServicePeriod.id)
            .join(District, District.id == LegislatorServicePeriod.district_id)
            .where(
                LegislatorServicePeriod.legislator_id == Legislator.id,
                LegislatorServicePeriod.is_current.is_(True),
                District.code.not_like("%-unknown"),
            )
        )
        authors = self.db.scalars(
            select(Legislator).where(
                Legislator.jurisdiction_id == jurisdiction_id,
                Legislator.external_key.isnot(None),
                select(Sponsorship.id)
                .where(Sponsorship.legislator_id == Legislator.id)
                .exists(),
                ~real_current_sp.exists(),
            )
        ).all()
        merged_pairs = 0
        sponsorships_moved = 0
        orphans: list[tuple[str, str]] = []
        merged_roster_ids: set[Any] = set()
        for author in authors:
            roster = self._find_canonical_roster(
                refs, self._member_key(author.external_key)
            )
            if roster is None or roster.id == author.id:
                orphans.append((author.external_key, author.full_name))
                continue
            if dry_run:
                sponsorships_moved += self.db.scalar(
                    select(func.count(Sponsorship.id)).where(
                        Sponsorship.legislator_id == author.id
                    )
                )
            else:
                sponsorships_moved += self._merge_legislator(author, roster)
            merged_pairs += 1
            merged_roster_ids.add(roster.id)
        if not dry_run and merged_roster_ids:
            self.refresh_legislator_stats(refs, legislator_ids=merged_roster_ids)
        return MergeReport(merged_pairs, sponsorships_moved, orphans, dry_run)

    def upsert_service_period(
        self,
        refs: dict[str, Any],
        legislator: Any,
        chamber: Any,
        district: Any,
        profile: dict[str, Any],
    ) -> Any:
        service_period = self.db.scalar(
            select(LegislatorServicePeriod).where(
                LegislatorServicePeriod.legislator_id == legislator.id,
                LegislatorServicePeriod.session_id == refs["session"].id,
                LegislatorServicePeriod.is_current.is_(True),
            )
        )
        same_seat = (
            service_period is not None
            and service_period.chamber_id == chamber.id
            and service_period.district_id == district.id
        )
        if not same_seat:
            if service_period is not None:
                service_period.is_current = False
                self.db.flush()
            prior_period = self.db.scalar(
                select(LegislatorServicePeriod).where(
                    LegislatorServicePeriod.legislator_id == legislator.id,
                    LegislatorServicePeriod.session_id == refs["session"].id,
                    LegislatorServicePeriod.chamber_id == chamber.id,
                    LegislatorServicePeriod.district_id == district.id,
                )
            )
            if prior_period is not None:
                service_period = prior_period
                service_period.is_current = True
            else:
                next_sequence = (
                    self.db.scalar(
                        select(func.max(LegislatorServicePeriod.period_sequence)).where(
                            LegislatorServicePeriod.legislator_id == legislator.id,
                            LegislatorServicePeriod.session_id == refs["session"].id,
                        )
                    )
                    or 0
                ) + 1
                service_period = LegislatorServicePeriod(
                    legislator_id=legislator.id,
                    session_id=refs["session"].id,
                    chamber_id=chamber.id,
                    district_id=district.id,
                    period_sequence=next_sequence,
                    is_current=True,
                )
                self.db.add(service_period)
            self.db.flush()
        service_period.chamber_id = chamber.id
        service_period.district_id = district.id
        service_period.party = str(profile.get("party") or "") or None
        service_period.email = str(profile.get("email") or "") or None
        service_period.phone = str(profile.get("office_phone") or "") or None
        service_period.profile_url = (
            str(profile.get("source_url") or profile.get("profile_url") or "") or None
        )
        service_period.photo_url = str(profile.get("image_url") or "") or None
        service_period.office_address = str(profile.get("office_block") or "") or None
        return service_period

    def upsert_committees(
        self,
        refs: dict[str, Any],
        legislator: Any,
        chamber: Any,
        profile: dict[str, Any],
    ) -> None:
        seen: set[str] = set()
        for name in profile.get("committees", []) or []:
            committee_name = str(name).strip()
            if not committee_name or committee_name in seen:
                continue
            seen.add(committee_name)
            committee = self.db.scalar(
                select(Committee).where(
                    Committee.session_id == refs["session"].id,
                    Committee.chamber_id == chamber.id,
                    Committee.name == committee_name,
                )
            )
            if committee is None:
                committee = Committee(
                    session_id=refs["session"].id,
                    chamber_id=chamber.id,
                    name=committee_name,
                )
                self.db.add(committee)
                self.db.flush()
            membership = self.db.scalar(
                select(CommitteeMembership).where(
                    CommitteeMembership.committee_id == committee.id,
                    CommitteeMembership.legislator_id == legislator.id,
                    CommitteeMembership.role.is_(None),
                )
            )
            if membership is None:
                self.db.add(
                    CommitteeMembership(
                        committee_id=committee.id,
                        legislator_id=legislator.id,
                        is_current=True,
                    )
                )

    def ingest_member_profile(
        self, refs: dict[str, Any], profile: dict[str, Any]
    ) -> Any:
        chamber = refs["chambers"][str(profile["chamber"])]
        district = self.upsert_district(refs, chamber, str(profile["district"]))
        name = str(profile.get("name") or profile.get("display_name") or "").strip()
        if not name:
            raise ValueError("Legislator profile is missing a name")
        external_key = str(
            profile.get("source_url") or profile.get("profile_url") or name
        )
        member_key = self._member_key(external_key)
        legislator = self._find_canonical_roster(refs, member_key)
        if legislator is None:
            legislator = self.upsert_legislator(refs, name, external_key=external_key)
        else:
            clean_name = strip_legislative_title(name)
            old_full_name = legislator.full_name
            legislator.full_name = clean_name
            if not legislator.sort_name or legislator.sort_name == old_full_name:
                legislator.sort_name = clean_name
            # House and Senate use different profile URL shapes for the same
            # numeric member id. Follow the member to the current source without
            # creating a second person when they change chambers.
            legislator.external_key = external_key
        # Fold in any bill-author placeholder created before this roster row
        # existed (a bill ingested first), so there is one row per member (#302).
        placeholder = self._find_placeholder_author(
            refs, member_key, exclude_id=legislator.id
        )
        if placeholder is not None:
            self._merge_legislator(placeholder, legislator)
        self.upsert_service_period(refs, legislator, chamber, district, profile)
        self.upsert_committees(refs, legislator, chamber, profile)
        return legislator

    def ingest_roster(
        self, *, limit: int | None = None, fetch_profiles: bool = True
    ) -> dict[str, Any]:
        refs = self.seed_reference_data()
        run = self.start_run("legislator_roster", CURRENT_SESSION_SLUG)
        roster_url = "https://www.leg.mn.gov/leg/legislators"
        roster_html = fetch_text(self.http, roster_url)
        self.record_artifact(
            run,
            ArtifactType.html,
            roster_url,
            roster_html,
            source_key="legislator-roster",
        )
        roster = parse_roster(roster_html)
        members = list(roster["members"])[:limit]
        ingested = 0
        for member in members:
            profile = dict(member)
            if fetch_profiles:
                profile_url = str(member["profile_url"])
                profile_html = fetch_text(self.http, profile_url)
                self.record_artifact(
                    run,
                    ArtifactType.html,
                    profile_url,
                    profile_html,
                    source_key=profile_url,
                )
                profile.update(parse_member_profile(profile_html, profile_url))
                profile["image_url"] = member.get("image_url")
            self.ingest_member_profile(refs, profile)
            ingested += 1
        self.refresh_legislator_stats(refs)
        self.finish_run(
            run, {"members_seen": len(roster["members"]), "members_ingested": ingested}
        )
        return run.stats

    def reconcile_current_members(
        self,
        session_slug: str = CURRENT_SESSION_SLUG,
        *,
        roster_members: list[RosterMember] | None = None,
        dry_run: bool = False,
    ) -> ReconcileReport:
        """Make DB current-membership match the official roster PDF.

        The HTML roster scrape only ever adds/updates members present in the
        source, so a member who leaves mid-biennium lingers as ``is_current``.
        This reconciles against the canonical PDF: any current member whose seat
        the PDF no longer lists -- vacated, or now held by someone else -- is set
        ``is_current = False``. Rows are never deleted (identity, service
        history, and bill authorship are preserved); creating a brand-new member
        stays the HTML scrape's job and is surfaced here only as a ``missing``
        warning. Idempotent and safe to re-run.
        """
        if roster_members is None:
            roster_members = parse_roster_pdf(fetch_roster_pdf_text())

        session = self.db.scalar(
            select(LegislativeSession).where(LegislativeSession.slug == session_slug)
        )
        if session is None:
            raise ValueError(f"No legislative session found for slug {session_slug!r}")

        by_seat: dict[tuple[str, str], RosterMember] = {
            (m.chamber, m.district_code): m for m in roster_members
        }

        rows = self.db.execute(
            select(LegislatorServicePeriod, Legislator, District, Chamber)
            .join(Legislator, Legislator.id == LegislatorServicePeriod.legislator_id)
            .join(District, District.id == LegislatorServicePeriod.district_id)
            .join(Chamber, Chamber.id == LegislatorServicePeriod.chamber_id)
            .where(
                LegislatorServicePeriod.session_id == session.id,
                LegislatorServicePeriod.is_current.is_(True),
                District.code.not_like("%-unknown"),
            )
        ).all()

        kept = 0
        deactivated: list[tuple[str, str, str]] = []
        matched_seats: set[tuple[str, str]] = set()
        for service_period, legislator, district, chamber in rows:
            seat = (chamber.chamber_type.value, district.code)
            member = by_seat.get(seat)
            if member is not None and name_matches(
                member.last_name, legislator.full_name
            ):
                kept += 1
                matched_seats.add(seat)
                continue
            deactivated.append((seat[0], seat[1], legislator.full_name))
            if not dry_run:
                service_period.is_current = False

        missing = [
            (m.chamber, m.district_code, f"{m.last_name}, {m.first_name}")
            for seat, m in sorted(by_seat.items())
            if seat not in matched_seats
        ]

        if not dry_run:
            self.db.flush()

        return ReconcileReport(
            pdf_total=len(roster_members),
            kept=kept,
            deactivated=deactivated,
            missing=missing,
            dry_run=dry_run,
        )

    def _fetch_bill_source(self, target: BillTarget, run: Any) -> BillSourcePayload:
        """Fetch and parse all 3 official responses for one bill."""
        try:
            discovery = discover_bill(self.http, target)
            xml_text = fetch_text(self.http, discovery["status_xml_uri"])
            xml_artifact = self.record_artifact(
                run, ArtifactType.xml, discovery["status_xml_uri"], xml_text
            )
            canonical = parse_bill_xml(xml_text)

            text_versions = list(canonical.get("text_versions", []))
            latest_version_payload = text_versions[-1] if text_versions else {}
            latest_html_url = str(
                latest_version_payload.get("html_uri")
                or discovery["latest_text_html_uri"]
            )
            latest_html_text = fetch_text(self.http, latest_html_url)
            html_artifact = self.record_artifact(
                run,
                ArtifactType.html,
                latest_html_url,
                latest_html_text,
                source_key=str(canonical["bill_key"]),
            )
            bill_text = parse_bill_text_html(latest_html_text, latest_html_url)
        except (ET.ParseError, ValueError) as exc:
            raise MinnesotaIngestionError(
                f"Failed to parse {target.chamber} {target.bill_number}: {exc}"
            ) from exc
        return BillSourcePayload(canonical, bill_text, xml_artifact, html_artifact)

    @staticmethod
    def _fetched_bill_counts(
        canonical: dict[str, Any], bill_text: dict[str, Any]
    ) -> dict[str, int]:
        return {
            "actions": sum(
                len(items) for items in canonical.get("actions", {}).values()
            ),
            "authors": sum(
                len(items) for items in canonical.get("authors", {}).values()
            ),
            "versions": max(1, len(canonical.get("text_versions", []))),
            "sections": len(bill_text.get("sections", [])),
        }

    def _stored_bill_counts(self, bill: Any) -> dict[str, int]:
        """Counts from the last accepted response, with old-row fallbacks.

        Actions and versions are retained as history even if a later official
        response removes them. The last successful run therefore owns the
        comparison once it has all 4 counts; older rows fall back to canonical
        tables and ``bill_stats``.
        """
        count_keys = {
            "actions": "action_count",
            "authors": "sponsor_count",
            "versions": "version_count",
            "sections": "section_count",
        }
        counts: dict[str, int] = {}
        if bill.ingestion_run_id is not None:
            previous_run = self.db.get(IngestionRun, bill.ingestion_run_id)
            if (
                previous_run is not None
                and previous_run.status == IngestionStatus.succeeded
            ):
                for field, key in count_keys.items():
                    value = previous_run.stats.get(key)
                    if isinstance(value, int) and value >= 0:
                        counts[field] = value

        stats = bill.stats
        counts.setdefault(
            "actions", stats.action_count if stats is not None else len(bill.actions)
        )
        counts.setdefault(
            "authors",
            stats.sponsor_count if stats is not None else len(bill.sponsorships),
        )
        counts.setdefault(
            "versions", stats.version_count if stats is not None else len(bill.versions)
        )
        counts.setdefault(
            "sections",
            int(
                self.db.scalar(
                    select(func.count())
                    .select_from(BillVersionSection)
                    .join(
                        BillVersion,
                        BillVersion.id == BillVersionSection.bill_version_id,
                    )
                    .where(
                        BillVersion.bill_id == bill.id,
                        BillVersion.is_current.is_(True),
                    )
                )
                or 0
            ),
        )
        return counts

    def bill_refresh_drops(
        self,
        canonical: dict[str, Any],
        bill_text: dict[str, Any],
        *,
        bill: Any | None = None,
    ) -> dict[str, dict[str, int]]:
        bill = bill or self.db.scalar(
            select(Bill).where(Bill.bill_key == canonical["bill_key"])
        )
        if bill is None:
            return {}
        stored = self._stored_bill_counts(bill)
        fetched = self._fetched_bill_counts(canonical, bill_text)
        return {
            field: {"stored": stored[field], "fetched": fetched[field]}
            for field in ("actions", "authors", "versions", "sections")
            if fetched[field] < stored[field]
        }

    @staticmethod
    def _drop_facts(
        canonical: dict[str, Any],
        bill_text: dict[str, Any],
        fields: set[str],
    ) -> dict[str, Any]:
        source_fields: dict[str, Any] = {
            "actions": canonical.get("actions", {}),
            "authors": canonical.get("authors", {}),
            "versions": canonical.get("text_versions", []),
            "sections": bill_text.get("sections", []),
        }
        return {field: source_fields[field] for field in fields}

    @staticmethod
    def _run_stats(
        canonical: dict[str, Any],
        bill_text: dict[str, Any],
        *,
        retried: bool,
        corroborated_drop: bool,
    ) -> dict[str, Any]:
        counts = MinnesotaIngestionPipeline._fetched_bill_counts(canonical, bill_text)
        return {
            "bill_key": str(canonical["bill_key"]),
            "action_count": counts["actions"],
            "sponsor_count": counts["authors"],
            "version_count": counts["versions"],
            "section_count": counts["sections"],
            "completeness_retry_count": int(retried),
            "corroborated_source_contraction": corroborated_drop,
        }

    def _reject_bill_refresh(
        self,
        run: Any,
        bill_key: str,
        drops: dict[str, dict[str, int]],
        reason: str,
    ) -> BillRefreshRejected:
        rejection = BillRefreshRejected(
            bill_key, drops, needs_issue=True, reason=reason
        )
        self.fail_run(
            run,
            rejection,
            {
                "bill_key": bill_key,
                "refresh_rejected": True,
                "drops": drops,
                "needs_issue": True,
            },
        )
        return rejection

    def _public_text_signature(
        self, bill: Any | None
    ) -> tuple[Any, tuple[str, ...]] | None:
        """Identify the exact current text that search and summaries describe."""
        if bill is None:
            return None
        version = self.db.scalar(
            select(BillVersion)
            .where(BillVersion.bill_id == bill.id)
            .order_by(
                BillVersion.is_current.desc(),
                BillVersion.sequence_number.desc(),
            )
            .limit(1)
        )
        if version is None:
            return None
        section_hashes = tuple(
            content_hash(str(section.raw_text or ""))
            for section in self.db.scalars(
                select(BillVersionSection)
                .where(BillVersionSection.bill_version_id == version.id)
                .order_by(BillVersionSection.source_order.asc())
            ).all()
        )
        return version.id, section_hashes

    def ingest_bill_target(self, refs: dict[str, Any], target: BillTarget) -> Any:
        """Keep the established single-bill return while tracking batch changes."""
        return self._ingest_bill_target_result(refs, target).bill

    def _ingest_bill_target_result(
        self, refs: dict[str, Any], target: BillTarget
    ) -> BillIngestionResult:
        run = self.start_run(
            "bill", f"{target.session_code}:{target.chamber}:{target.bill_number}"
        )
        payload = self._fetch_bill_source(target, run)
        # Summary apply takes this same row lock before checking official text.
        # It prevents a prepared result from passing on old text and becoming
        # current just after this refresh commits its replacement text.
        existing_bill = self.db.scalar(
            select(Bill)
            .where(Bill.bill_key == payload.canonical["bill_key"])
            .with_for_update()
        )
        previous_text = self._public_text_signature(existing_bill)
        drops = self.bill_refresh_drops(payload.canonical, payload.bill_text)
        retried = bool(drops)
        corroborated_drop = False
        if drops:
            drop_fields = set(drops)
            first_drop_facts = self._drop_facts(
                payload.canonical, payload.bill_text, drop_fields
            )
            try:
                retry_payload = self._fetch_bill_source(target, run)
            except MinnesotaIngestionError as exc:
                rejection = self._reject_bill_refresh(
                    run,
                    str(payload.canonical["bill_key"]),
                    drops,
                    f"the second fetch failed: {exc}",
                )
                raise rejection from exc

            first_bill_key = str(payload.canonical["bill_key"])
            retry_bill_key = str(retry_payload.canonical["bill_key"])
            if retry_bill_key != first_bill_key:
                rejection = self._reject_bill_refresh(
                    run,
                    first_bill_key,
                    drops,
                    f"the second fetch returned a different bill ({retry_bill_key})",
                )
                raise rejection

            retry_drops = self.bill_refresh_drops(
                retry_payload.canonical, retry_payload.bill_text
            )
            if not retry_drops:
                payload = retry_payload
            else:
                second_drop_facts = self._drop_facts(
                    retry_payload.canonical,
                    retry_payload.bill_text,
                    set(retry_drops),
                )
                if (
                    set(retry_drops) == drop_fields
                    and second_drop_facts == first_drop_facts
                ):
                    payload = retry_payload
                    corroborated_drop = True
                else:
                    rejection = self._reject_bill_refresh(
                        run,
                        str(retry_payload.canonical["bill_key"]),
                        retry_drops,
                        "the second fetch was still thinner and did not match the first",
                    )
                    raise rejection

        bill = self.upsert_bill(
            refs,
            payload.canonical,
            payload.bill_text,
            run,
            payload.xml_artifact,
            payload.html_artifact,
            corroborated_drop=corroborated_drop,
        )
        self.db.flush()
        current_text = self._public_text_signature(bill)
        self.finish_run(
            run,
            self._run_stats(
                payload.canonical,
                payload.bill_text,
                retried=retried,
                corroborated_drop=corroborated_drop,
            ),
        )
        return BillIngestionResult(
            bill=bill,
            public_text_changed=previous_text != current_text,
        )

    def upsert_bill(
        self,
        refs: dict[str, Any],
        canonical: dict[str, Any],
        bill_text: dict[str, Any],
        run: Any,
        xml_artifact: Any,
        html_artifact: Any,
        *,
        corroborated_drop: bool = False,
    ) -> Any:
        file_type = str(canonical["file_type"])
        chamber = refs["chambers"]["house" if file_type.upper() == "HF" else "senate"]
        all_actions = [
            action
            for actions in canonical.get("actions", {}).values()
            for action in actions
        ]
        latest_action = select_current_bill_action(canonical.get("actions", {}))
        # latest_action_at is the newest *dated* action. The selected display
        # action is often undated (e.g. "Laid on table"), so using its date would
        # leave the timestamp null; take the max over actions that actually carry
        # a parseable date (#328).
        action_dates = [
            parsed
            for action in all_actions
            if (parsed := parse_datetime(action.get("action_date"))) is not None
        ]
        latest_action_at = max(action_dates) if action_dates else None
        # introduced_at comes from the "Introduction and first reading" action
        # in the bill's origin chamber (the only action carrying that text).
        introduced_action = next(
            (
                action
                for action in all_actions
                if "introduction and first reading"
                in (action.get("action_text") or "").lower()
            ),
            None,
        )
        introduced_at = (
            parse_datetime(introduced_action.get("action_date"))
            if introduced_action
            else None
        )

        # The title parsed from whichever version this run fetched — i.e. the
        # bill's current text.
        parsed_title = str(bill_text.get("bill_title_text") or "").strip()

        bill = self.db.scalar(
            select(Bill).where(Bill.bill_key == canonical["bill_key"])
        )
        if bill is not None and not corroborated_drop:
            drops = self.bill_refresh_drops(canonical, bill_text, bill=bill)
            if drops:
                raise BillRefreshRejected(
                    str(canonical["bill_key"]),
                    drops,
                )
        if bill is None:
            bill = Bill(
                session_id=refs["session"].id,
                chamber_id=chamber.id,
                bill_key=str(canonical["bill_key"]),
                file_type=file_type,
                file_number=int(str(canonical["file_number"])),
                title=str(
                    parsed_title
                    or canonical.get("description")
                    or canonical["bill_key"]
                ),
            )
            self.db.add(bill)
            self.db.flush()
        # title is refreshed on every run, not written once at creation: a bill
        # that is gutted and replaced mid-session takes on an entirely new
        # subject, and a create-only title kept showing the one it carried at
        # introduction forever — SF 334's page said "education" while the enacted
        # law was about human services (#708). On a parse miss keep whatever is
        # stored; falling back to the bill key or the short description here
        # would blank out a title that was already right.
        bill.title = parsed_title or bill.title
        bill.session_id = refs["session"].id
        bill.chamber_id = chamber.id
        bill.revisor_number = str(canonical.get("revisor_number") or "") or None
        description = str(canonical.get("description") or "").strip()
        bill.description = description or bill.description
        bill.current_status = (
            latest_action.get("action_text") if latest_action else None
        )
        bill.latest_action_at = latest_action_at
        bill.introduced_at = introduced_at
        bill.official_url = str(bill_text.get("source_url") or "") or None
        bill.is_omnibus = len(bill_text.get("articles", [])) > 1
        bill.ingestion_run_id = run.id
        self.link_companion(bill, canonical)

        self.upsert_versions_and_sections(
            bill,
            canonical,
            bill_text,
            html_artifact,
            corroborated_drop=corroborated_drop,
        )
        self.replace_actions(refs, bill, canonical, xml_artifact)
        self.replace_sponsorships(refs, bill, canonical)
        self.upsert_bill_stats(bill, canonical)
        return bill

    def link_companion(self, bill: Any, canonical: dict[str, Any]) -> None:
        """Link a bill to its House/Senate companion, symmetrically.

        The status XML names the companion's file type + number; resolve it to a
        Bill row (same session) and set companion_bill_id on *both* sides. Setting
        both directions makes the link order-independent: whichever member of the
        pair is ingested second connects the pair, so a full ingest links every
        pair regardless of processing order or which side was ingested first
        (#293). Absence of a companion in the source is left as-is rather than
        cleared, so a partial re-ingest never drops a valid link.
        """
        companion_type = str(canonical.get("companion_type") or "").strip().upper()
        companion_number = str(canonical.get("companion_number") or "").strip()
        if not companion_type or not companion_number:
            return
        # build_bill_key, not a hand-built string: it is the one place a bill_key
        # is composed, and it appends the `s<n>` special-session suffix. Building
        # the key here by hand omitted that suffix, so a special-session bill
        # looked up the *regular* session's file of the same number and found a
        # real, unrelated bill -- then linked both directions, giving that bill a
        # companion it does not have. 64 rows in production carried a wrong
        # pointer, on both sides labelled identically, so neither page could be
        # read as wrong (#928).
        companion_key = build_bill_key(
            canonical["session_number"],
            canonical["session_year"],
            companion_type,
            companion_number,
            canonical.get("special_session") or 0,
        )
        companion = self.db.scalar(select(Bill).where(Bill.bill_key == companion_key))
        if companion is None or companion.id == bill.id:
            return
        bill.companion_bill_id = companion.id
        companion.companion_bill_id = bill.id

    def upsert_versions_and_sections(
        self,
        bill: Any,
        canonical: dict[str, Any],
        bill_text: dict[str, Any],
        html_artifact: Any,
        *,
        corroborated_drop: bool = False,
    ) -> None:
        text_versions = list(canonical.get("text_versions", [])) or [
            {"document_name": "Current", "document_type": "current"}
        ]
        latest_index = len(text_versions)
        latest_version = None
        # Exactly one current version per bill (#285). Clear any existing current
        # flag up front, so the loop below re-marks only the latest. A prior ingest
        # may have made a version current under a version_code no longer in this
        # fetch (e.g. the "current" fallback used when text_versions was empty, vs.
        # a real engrossment code like "0"); without this it would stay current
        # forever, doubling the flag. Clearing *before* the loop also keeps the
        # partial unique index (one current per bill) satisfied at every flush.
        self.db.execute(
            update(BillVersion)
            .where(
                BillVersion.bill_id == bill.id,
                BillVersion.is_current.is_(True),
            )
            .values(is_current=False)
            .execution_options(synchronize_session="fetch")
        )
        for index, version_payload in enumerate(text_versions, start=1):
            document_type = (
                str(version_payload.get("document_type") or "").strip().lower()
            )
            engrossment = (
                str(version_payload.get("document_engrossment") or "").strip().lower()
            )
            # MN reuses DOCUMENT_ENGROSSMENT across document tracks: an official and
            # an unofficial engrossment both arrive as "1" (they differ only by
            # DOCUMENT_TYPE, e.g. "official" vs "ue"), and a conference committee
            # report commonly carries DOCUMENT_ENGROSSMENT="0" (no engrossment
            # letter) — the same "0" the introduced official version uses. Keying on
            # the engrossment alone collides on (bill_id, version_code) and the
            # second row silently overwrites the first (#467): the unofficial
            # clobbers the official 1st engrossment, and the CCR clobbers the
            # introduced text. Namespace every non-official track by its document
            # type so each stays distinct ("ue-1", "ccr-0", or a bare "ccr" when the
            # CCR has no engrossment) and a CCR never lands on a bare engrossment
            # number. Official stays bare (the common case — keeps existing version
            # URLs stable). Kept URL-safe (lowercase, no spaces/slashes) for the
            # frontend version id and the /bills/{bill_id}/versions/{version_code}
            # route.
            if document_type in ("", "official"):
                version_code = engrossment or document_type or str(index)
            else:
                version_code = (
                    f"{document_type}-{engrossment}" if engrossment else document_type
                )
            if not version_code or version_code == "none":
                version_code = f"version-{index}"
            version = self.db.scalar(
                select(BillVersion).where(
                    BillVersion.bill_id == bill.id,
                    BillVersion.version_code == version_code,
                )
            )
            if version is None:
                version = BillVersion(
                    bill_id=bill.id, version_code=version_code, sequence_number=index
                )
                self.db.add(version)
                self.db.flush()
            version.version_name = str(
                version_payload.get("document_name") or version_code
            )
            version.sequence_number = index
            version.document_date = parse_datetime(
                str(version_payload.get("date_insert") or "")
            )
            version.html_url = (
                str(
                    version_payload.get("html_uri") or bill_text.get("source_url") or ""
                )
                or None
            )
            version.pdf_url = str(version_payload.get("pdf_uri") or "") or None
            version.is_current = index == latest_index
            if version.is_current:
                version.source_artifact_id = html_artifact.id
                latest_version = version

        # Drop the stale "current" placeholder once real text versions exist (#531).
        # The empty-fetch fallback below synthesizes a version_code="current" row
        # when the Revisor hasn't posted text yet; a later ingest adds the real rows
        # but previously never removed the placeholder, leaving a phantom version
        # alongside the real ones on the Versions tab. Scoped strictly to the
        # "current" code and only when *this* fetch carries real versions — never a
        # blanket "delete versions absent from the fetch", which would wipe real rows
        # on a transiently-incomplete fetch. The placeholder is text-empty by
        # construction (created precisely because text was absent), so it carries no
        # section/RAG/enrichment dependents; if it somehow does, leave it for the
        # coordinated one-time cleanup (#531) rather than cascade-deleting from here.
        if canonical.get("text_versions"):
            stale_current = self.db.scalar(
                select(BillVersion).where(
                    BillVersion.bill_id == bill.id,
                    BillVersion.version_code == "current",
                )
            )
            if stale_current is not None:
                dependent_sections = self.db.scalar(
                    select(func.count())
                    .select_from(BillVersionSection)
                    .where(BillVersionSection.bill_version_id == stale_current.id)
                )
                if not dependent_sections:
                    self.db.execute(
                        delete(BillVersion).where(BillVersion.id == stale_current.id)
                    )

        if latest_version is None:
            latest_version = self.db.scalar(
                select(BillVersion)
                .where(BillVersion.bill_id == bill.id)
                .order_by(BillVersion.sequence_number.desc())
            )
        if latest_version is None:
            return

        # A shorter section list is allowed only after the completeness guard has
        # fetched the same official response twice. Reconcile only the accepted
        # current version, and delete search dependents child-first because these
        # foreign keys deliberately do not cascade (#1423).
        if corroborated_drop:
            fetched_section_count = len(bill_text.get("sections", []))
            stale_section_ids = list(
                self.db.scalars(
                    select(BillVersionSection.id).where(
                        BillVersionSection.bill_version_id == latest_version.id,
                        BillVersionSection.source_order > fetched_section_count,
                    )
                ).all()
            )
            if stale_section_ids:
                rag_section_ids = list(
                    self.db.scalars(
                        select(RagSectionDocument.id).where(
                            RagSectionDocument.bill_version_section_id.in_(
                                stale_section_ids
                            )
                        )
                    ).all()
                )
                if rag_section_ids:
                    rag_chunk_ids = list(
                        self.db.scalars(
                            select(RagChunk.id).where(
                                RagChunk.rag_section_document_id.in_(rag_section_ids)
                            )
                        ).all()
                    )
                    if rag_chunk_ids:
                        self.db.execute(
                            delete(RagChunkEmbedding).where(
                                RagChunkEmbedding.rag_chunk_id.in_(rag_chunk_ids)
                            )
                        )
                        self.db.execute(
                            delete(RagChunk).where(RagChunk.id.in_(rag_chunk_ids))
                        )
                    self.db.execute(
                        delete(RagSectionDocument).where(
                            RagSectionDocument.id.in_(rag_section_ids)
                        )
                    )
                self.db.execute(
                    delete(BillVersionSection).where(
                        BillVersionSection.id.in_(stale_section_ids)
                    )
                )

        article_lookup = {}
        for article in bill_text.get("articles", []):
            for section in article.get("sections", []):
                article_lookup[section["section_id"]] = article
        for source_order, section in enumerate(bill_text.get("sections", []), start=1):
            article = article_lookup.get(section["section_id"], {})
            # Look the row up by its POSITION on the page, not by its id. A page may
            # give two sections the same id — `laws.0.1.0` is the id the Revisor
            # hands every section that sits outside an article, and 6 of the 12
            # biggest bills repeat it — so looking up by id made the second such
            # section overwrite the first and only the last one survived (#763).
            # Position is what actually identifies a section within a version, it is
            # unique by construction here (one row per index of this loop), and
            # keying on it keeps the re-ingest idempotent: a second run finds the
            # same row at the same position and rewrites it with the same values.
            section_row = self.db.scalar(
                select(BillVersionSection).where(
                    BillVersionSection.bill_version_id == latest_version.id,
                    BillVersionSection.source_order == source_order,
                )
            )
            if section_row is None:
                section_row = BillVersionSection(
                    bill_version_id=latest_version.id,
                    source_order=source_order,
                )
                self.db.add(section_row)
            section_row.section_id_text = str(section["section_id"])
            section_row.article_id_text = str(article.get("article_id") or "") or None
            section_row.article_number = (
                str(article.get("article_number") or "") or None
            )
            section_row.article_heading = (
                str(article.get("article_heading") or "") or None
            )
            section_row.section_heading = str(section.get("heading") or "") or None
            section_row.statute_heading = (
                str(section.get("statute_heading") or "") or None
            )
            section_row.cite_heading = str(section.get("cite_heading") or "") or None
            section_row.effective_date_heading = (
                str(section.get("effective_date_heading") or "") or None
            )
            section_row.raw_text = str(section["text"])
            section_row.source_hash = content_hash(str(section["text"]))
            # The structure the flat text loses (#741, #752). Written alongside,
            # never instead of, `raw_text` — see the column's comment in
            # alethical/db/models.py for why that separation is load-bearing.
            section_row.body_blocks = section.get("blocks") or None

    def replace_actions(
        self,
        refs: dict[str, Any],
        bill: Any,
        canonical: dict[str, Any],
        xml_artifact: Any,
    ) -> None:
        for chamber_name, actions in canonical.get("actions", {}).items():
            chamber = refs["chambers"].get(chamber_name)
            for action in actions:
                action_row = self.db.scalar(
                    select(BillAction).where(
                        BillAction.bill_id == bill.id,
                        BillAction.action_number == int(action["action_number"]),
                        BillAction.chamber_id == (chamber.id if chamber else None),
                    )
                )
                if action_row is None:
                    action_row = BillAction(
                        bill_id=bill.id,
                        chamber_id=chamber.id if chamber else None,
                        action_number=int(action["action_number"]),
                    )
                    self.db.add(action_row)
                action_row.source_artifact_id = xml_artifact.id
                action_row.action_group = action.get("action_group") or None
                action_row.action_text = action["action_text"]
                action_row.action_description = action.get("action_description") or None
                action_row.committee_name = action.get("committee_name") or None
                action_row.action_at = parse_datetime(action.get("action_date"))
                action_row.journal_page = action.get("journal_page") or None
                action_row.roll_call_text = action.get("roll_call") or None

    def replace_sponsorships(
        self, refs: dict[str, Any], bill: Any, canonical: dict[str, Any]
    ) -> None:
        self.db.execute(delete(Sponsorship).where(Sponsorship.bill_id == bill.id))
        for chamber_name, authors in canonical.get("authors", {}).items():
            chamber = refs["chambers"].get(chamber_name)
            if chamber is None:
                continue
            for index, author in enumerate(authors, start=1):
                member_name = author.get("member_name")
                if not member_name:
                    continue
                legislator_key = author.get("legislator_key") or member_name
                # Attach to the canonical roster row (real district + profile URL)
                # when it already exists, so we don't spawn a parallel numeric-keyed
                # author row (#302). Falls back to the numeric-keyed row when the
                # roster hasn't been ingested yet (a bill ingested before the
                # roster) — ingest_member_profile folds that placeholder in later.
                legislator = self._find_canonical_roster(
                    refs, self._member_key(legislator_key)
                ) or self.upsert_legislator(
                    refs, member_name, external_key=legislator_key
                )
                if "," in member_name:
                    # MEMBER_NAME is the same official short form the House
                    # voting system uses. It carries the disambiguating middle
                    # initial that the friendly roster name can omit.
                    legislator.sort_name = normalize_space(member_name)
                self.db.add(
                    Sponsorship(
                        bill_id=bill.id,
                        legislator_id=legislator.id,
                        role=SponsorshipRole.chief_author
                        if index == 1
                        else SponsorshipRole.co_author,
                        source_order=index,
                        source_chamber=chamber_name,
                    )
                )

    def upsert_bill_stats(self, bill: Any, canonical: dict[str, Any]) -> None:
        stats = self.db.scalar(select(BillStats).where(BillStats.bill_id == bill.id))
        if stats is None:
            stats = BillStats(bill_id=bill.id)
            self.db.add(stats)
        stats.sponsor_count = sum(
            len(authors) for authors in canonical.get("authors", {}).values()
        )
        stats.action_count = sum(
            len(actions) for actions in canonical.get("actions", {}).values()
        )
        stats.version_count = max(1, len(canonical.get("text_versions", [])))
        stats.vote_event_count = len(bill.vote_events)

    def ingest_bills(self, targets: list[BillTarget]) -> dict[str, Any]:
        # Reference data is resolved per session code, not once per batch: a special
        # session's bills belong to their own session row (#746). Cached so a batch
        # sharing one code still costs one lookup, as it always did.
        refs_by_code: dict[str, dict[str, Any]] = {}
        results: list[BillIngestionResult] = []
        refresh_rejections: list[dict[str, Any]] = []
        for target in targets:
            refs = refs_by_code.get(target.session_code)
            if refs is None:
                refs = refs_by_code[target.session_code] = self.seed_reference_data(
                    target.session_code
                )
            try:
                results.append(self._ingest_bill_target_result(refs, target))
            except BillRefreshRejected as exc:
                # The guard runs before any canonical bill row changes. Keep its
                # failed run and source artifacts as evidence, then move on so 1
                # thin response cannot roll back the other 24 bills in a chunk.
                refresh_rejections.append(exc.report())
        bills = [result.bill for result in results]
        text_changed_bills = [
            result.bill for result in results if result.public_text_changed
        ]
        if text_changed_bills:
            self.db.execute(
                update(AIEnrichment)
                .where(
                    AIEnrichment.bill_id.in_([bill.id for bill in text_changed_bills]),
                    AIEnrichment.enrichment_type == EnrichmentType.bill_summary,
                    AIEnrichment.is_current.is_(True),
                )
                .values(is_current=False)
            )
        # Refresh stats only for the legislators this batch actually touched (the
        # sponsors of its bills), not the whole jurisdiction — otherwise concurrent
        # chunk workers all contend on the same ~400 legislator_stats rows and hit
        # Postgres's statement timeout, crashing the drain (#257). A removed sponsor
        # (rare for MN bills) reconciles on the next full/roster refresh.
        bill_ids = [bill.id for bill in bills]
        affected_legislator_ids = (
            set(
                self.db.scalars(
                    select(Sponsorship.legislator_id)
                    .where(Sponsorship.bill_id.in_(bill_ids))
                    .distinct()
                ).all()
            )
            if bill_ids
            else set()
        )
        for refs in refs_by_code.values():
            self.refresh_legislator_stats(refs, legislator_ids=affected_legislator_ids)
        return {
            "bills_ingested": len(bills),
            "bill_keys": [bill.bill_key for bill in bills],
            "text_changed_bill_keys": [bill.bill_key for bill in text_changed_bills],
            "bill_refresh_rejections": refresh_rejections,
        }

    def discover_bill_targets(
        self,
        *,
        session_code: str = DEFAULT_SESSION_CODE,
        max_bill_number: int = 6000,
        only_missing: bool = True,
    ) -> list[BillTarget]:
        results = discover_session_bills(
            self.http, session_code=session_code, max_bill_number=max_bill_number
        )
        if not only_missing:
            return [result.target for result in results]
        existing_keys = set(self.db.scalars(select(Bill.bill_key)).all())
        return [
            result.target for result in results if result.bill_key not in existing_keys
        ]

    def refresh_legislator_stats(
        self, refs: dict[str, Any], legislator_ids: set[Any] | None = None
    ) -> None:
        # Scope to specific legislators when given (the ones a bill batch touched),
        # so concurrent chunk workers don't all rewrite every legislator_stats row
        # and deadlock to a statement timeout (#257). None = every legislator
        # (the roster sync path, where all members are touched anyway).
        query = select(Legislator)
        if legislator_ids is not None:
            query = query.where(Legislator.id.in_(legislator_ids))
        legislators = self.db.scalars(query).all()
        for legislator in legislators:
            stats = self.db.scalar(
                select(LegislatorStats).where(
                    LegislatorStats.legislator_id == legislator.id,
                    LegislatorStats.session_id == refs["session"].id,
                )
            )
            if stats is None:
                stats = LegislatorStats(
                    legislator_id=legislator.id, session_id=refs["session"].id
                )
                self.db.add(stats)
            sponsorships = self.db.scalars(
                select(Sponsorship).where(Sponsorship.legislator_id == legislator.id)
            ).all()
            stats.total_bill_count = len(sponsorships)
            stats.chief_bill_count = len(
                [
                    item
                    for item in sponsorships
                    if item.role == SponsorshipRole.chief_author
                ]
            )
            stats.vote_record_count = 0
            stats.committee_count = len(
                [item for item in legislator.committee_memberships if item.is_current]
            )
