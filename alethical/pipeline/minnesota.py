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
from sqlalchemy import delete, select, text, update
from sqlalchemy.orm import Session

from alethical.db.schema import load_schema
from alethical.pipeline.sessions import (
    CURRENT_SESSION_SLUG,
    DEFAULT_SESSION_CODE,
    parse_session_code,
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
IngestionRun = schema.IngestionRun
IngestionStatus = schema.IngestionStatus
Jurisdiction = schema.Jurisdiction
LegislativeSession = schema.LegislativeSession
Legislator = schema.Legislator
LegislatorServicePeriod = schema.LegislatorServicePeriod
LegislatorStats = schema.LegislatorStats
SessionType = schema.SessionType
SourceArtifact = schema.SourceArtifact
Sponsorship = schema.Sponsorship
SponsorshipRole = schema.SponsorshipRole


class MinnesotaIngestionError(RuntimeError):
    pass


@dataclass(frozen=True)
class BillTarget:
    chamber: str
    bill_number: str
    session_code: str = DEFAULT_SESSION_CODE


# Session number + year embedded in a bill's status XML URI, e.g.
# https://api.revisor.mn.gov/bills/v1/94/2025/0/HF/2136/
STATUS_URI_SESSION_RE = re.compile(r"/bills/v1/(\d+)/(\d{4})/")


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
        else:
            session_number, year = parse_session_code(self.session_code)
        return f"{session_number}-{year}-{self.file_type}{self.file_number}"

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


def normalize_space(value: str) -> str:
    value = html.unescape(value)
    value = value.replace("\xa0", " ")
    value = re.sub(r"<br\s*/?>", "\n", value, flags=re.I)
    value = re.sub(r"</(p|div|h\d|li|tr|blockquote)>", "\n", value, flags=re.I)
    value = re.sub(r"<[^>]+>", "", value)
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
    for fmt in ("%m/%d/%Y", "%Y-%m-%d", "%m/%d/%y"):
        try:
            return datetime.strptime(value, fmt).replace(tzinfo=UTC)
        except ValueError:
            continue
    return None


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
            return response.text
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
        "bill_key": f"{text('SESSION_NUMBER')}-{text('SESSION_YEAR')}-{text('FILE_TYPE')}{text('FILE_NUMBER')}",
        "file_type": text("FILE_TYPE"),
        "file_number": text("FILE_NUMBER"),
        "revisor_number": text("REVISOR_NUMBER"),
        "description": text("DESCRIPTION"),
        "session_year": text("SESSION_YEAR"),
        "session_number": text("SESSION_NUMBER"),
        "authors": authors,
        "actions": actions,
        "text_versions": versions,
    }


def parse_bill_section(section_html: str, section_id: str) -> dict[str, str]:
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


def parse_senate_profile(html_text: str, source_url: str) -> dict[str, object]:
    heading = extract(r"<h1 class='mb-0'>(.*?)</h1>", html_text, flags=re.S)
    email_form = extract(
        r"<span><b>E-mail:</b>\s*<a href='([^']+)'", html_text, flags=re.S
    )
    return {
        "source_url": source_url,
        "chamber": "senate",
        "name": extract(r"^(.*?)\s*\(", heading, flags=re.S),
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

    def _existing_reference_data(self) -> dict[str, Any] | None:
        """Return the reference dict if jurisdiction, all chambers, and the
        current session already exist; else None. Lets seed_reference_data skip
        the advisory lock on the common (refresh) path so concurrent chunks do
        not serialize on it."""
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
                LegislativeSession.slug == CURRENT_SESSION_SLUG,
            )
        )
        if session is None:
            return None
        return {"jurisdiction": minnesota, "chambers": chambers, "session": session}

    def seed_reference_data(self) -> dict[str, Any]:
        existing = self._existing_reference_data()
        if existing is not None:
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

        current_session = self.db.scalar(
            select(LegislativeSession).where(
                LegislativeSession.jurisdiction_id == minnesota.id,
                LegislativeSession.slug == CURRENT_SESSION_SLUG,
            )
        )
        if current_session is None:
            current_session = LegislativeSession(
                jurisdiction_id=minnesota.id,
                slug=CURRENT_SESSION_SLUG,
                session_number=94,
                session_type=SessionType.regular,
                year_start=2025,
                year_end=2026,
                name="94th Legislature (2025 - 2026) Regular Session",
                is_current=True,
            )
            self.db.add(current_session)
            self.db.flush()
        return {
            "jurisdiction": minnesota,
            "chambers": chambers,
            "session": current_session,
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
            legislator.full_name = name
            legislator.sort_name = name
        return legislator

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
        if service_period is None:
            service_period = LegislatorServicePeriod(
                legislator_id=legislator.id,
                session_id=refs["session"].id,
                chamber_id=chamber.id,
                district_id=district.id,
                period_sequence=1,
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
        legislator = self.upsert_legislator(refs, name, external_key=external_key)
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

    def ingest_bill_target(self, refs: dict[str, Any], target: BillTarget) -> Any:
        run = self.start_run(
            "bill", f"{target.session_code}:{target.chamber}:{target.bill_number}"
        )
        discovery = discover_bill(self.http, target)
        xml_text = fetch_text(self.http, discovery["status_xml_uri"])
        xml_artifact = self.record_artifact(
            run, ArtifactType.xml, discovery["status_xml_uri"], xml_text
        )
        canonical = parse_bill_xml(xml_text)

        text_versions = list(canonical.get("text_versions", []))
        latest_version_payload = text_versions[-1] if text_versions else {}
        latest_html_url = str(
            latest_version_payload.get("html_uri") or discovery["latest_text_html_uri"]
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

        bill = self.upsert_bill(
            refs, canonical, bill_text, run, xml_artifact, html_artifact
        )
        self.finish_run(
            run,
            {
                "bill_key": bill.bill_key,
                "action_count": sum(
                    len(items) for items in canonical.get("actions", {}).values()
                ),
                "sponsor_count": sum(
                    len(items) for items in canonical.get("authors", {}).values()
                ),
                "version_count": max(1, len(text_versions)),
                "section_count": len(bill_text.get("sections", [])),
            },
        )
        return bill

    def upsert_bill(
        self,
        refs: dict[str, Any],
        canonical: dict[str, Any],
        bill_text: dict[str, Any],
        run: Any,
        xml_artifact: Any,
        html_artifact: Any,
    ) -> Any:
        file_type = str(canonical["file_type"])
        chamber = refs["chambers"]["house" if file_type.upper() == "HF" else "senate"]
        all_actions = [
            action
            for actions in canonical.get("actions", {}).values()
            for action in actions
        ]
        latest_action = max(
            all_actions,
            key=lambda action: int(action.get("action_number") or 0),
            default=None,
        )
        latest_action_at = (
            parse_datetime(latest_action.get("action_date")) if latest_action else None
        )

        bill = self.db.scalar(
            select(Bill).where(Bill.bill_key == canonical["bill_key"])
        )
        if bill is None:
            bill = Bill(
                session_id=refs["session"].id,
                chamber_id=chamber.id,
                bill_key=str(canonical["bill_key"]),
                file_type=file_type,
                file_number=int(str(canonical["file_number"])),
                title=str(
                    bill_text.get("bill_title_text")
                    or canonical.get("description")
                    or canonical["bill_key"]
                ),
            )
            self.db.add(bill)
            self.db.flush()
        bill.session_id = refs["session"].id
        bill.chamber_id = chamber.id
        bill.revisor_number = str(canonical.get("revisor_number") or "") or None
        bill.description = str(canonical.get("description") or "") or None
        bill.current_status = (
            latest_action.get("action_text") if latest_action else None
        )
        bill.latest_action_at = latest_action_at
        bill.official_url = str(bill_text.get("source_url") or "") or None
        bill.is_omnibus = len(bill_text.get("articles", [])) > 1
        bill.ingestion_run_id = run.id

        self.upsert_versions_and_sections(bill, canonical, bill_text, html_artifact)
        self.replace_actions(refs, bill, canonical, xml_artifact)
        self.replace_sponsorships(refs, bill, canonical)
        self.upsert_bill_stats(bill, canonical)
        return bill

    def upsert_versions_and_sections(
        self,
        bill: Any,
        canonical: dict[str, Any],
        bill_text: dict[str, Any],
        html_artifact: Any,
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
            version_code = str(
                version_payload.get("document_engrossment")
                or version_payload.get("document_type")
                or index
            ).lower()
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

        if latest_version is None:
            latest_version = self.db.scalar(
                select(BillVersion)
                .where(BillVersion.bill_id == bill.id)
                .order_by(BillVersion.sequence_number.desc())
            )
        if latest_version is None:
            return

        article_lookup = {}
        for article in bill_text.get("articles", []):
            for section in article.get("sections", []):
                article_lookup[section["section_id"]] = article
        for source_order, section in enumerate(bill_text.get("sections", []), start=1):
            article = article_lookup.get(section["section_id"], {})
            section_row = self.db.scalar(
                select(BillVersionSection).where(
                    BillVersionSection.bill_version_id == latest_version.id,
                    BillVersionSection.section_id_text == str(section["section_id"]),
                )
            )
            if section_row is None:
                section_row = BillVersionSection(
                    bill_version_id=latest_version.id,
                    section_id_text=str(section["section_id"]),
                )
                self.db.add(section_row)
            section_row.source_order = source_order
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
                legislator = self.upsert_legislator(
                    refs, member_name, external_key=legislator_key
                )
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
        refs = self.seed_reference_data()
        bills = [self.ingest_bill_target(refs, target) for target in targets]
        self.refresh_legislator_stats(refs)
        return {
            "bills_ingested": len(bills),
            "bill_keys": [bill.bill_key for bill in bills],
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

    def refresh_legislator_stats(self, refs: dict[str, Any]) -> None:
        legislators = self.db.scalars(select(Legislator)).all()
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
