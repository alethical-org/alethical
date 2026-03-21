#!/usr/bin/env python3
"""Rough Minnesota legislative ingestion prototypes.

This script validates that the official sources are parseable into a
structured, legible shape before we commit to a full pipeline design.
"""

from __future__ import annotations

import argparse
import html
import json
import re
import time
from pathlib import Path
from typing import Dict, List, Optional
from urllib.parse import urljoin
import xml.etree.ElementTree as ET

import requests


USER_AGENT = "Alethical Prototype Ingest/0.1"
TIMEOUT = 30
MAX_RETRIES = 3
DIV_TAG_RE = re.compile(r"</?div\b[^>]*>", re.I)


class PrototypeError(RuntimeError):
    pass


def session() -> requests.Session:
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


def extract(pattern: str, text: str, *, flags: int = 0, default: str = "") -> str:
    match = re.search(pattern, text, flags)
    return normalize_space(match.group(1)) if match else default


def extract_all(pattern: str, text: str, *, flags: int = 0) -> List[str]:
    return [normalize_space(match) for match in re.findall(pattern, text, flags)]


def extract_attr(tag_html: str, attr: str) -> str:
    match = re.search(rf"""{attr}\s*=\s*["']([^"']+)["']""", tag_html, flags=re.I)
    return match.group(1).strip() if match else ""


def extract_balanced_div(html_text: str, start_index: int) -> str:
    first_tag = DIV_TAG_RE.match(html_text, start_index)
    if first_tag is None or first_tag.group(0).startswith("</"):
        raise PrototypeError(f"Expected opening div at index {start_index}")

    depth = 1
    for tag_match in DIV_TAG_RE.finditer(html_text, first_tag.end()):
        tag = tag_match.group(0)
        if tag.startswith("</"):
            depth -= 1
            if depth == 0:
                return html_text[start_index:tag_match.end()]
        else:
            depth += 1

    raise PrototypeError(f"Unbalanced div structure starting at index {start_index}")


def locate_div_blocks(html_text: str, class_name: str) -> List[Dict[str, object]]:
    pattern = re.compile(
        rf"""<div\b[^>]*class=["'][^"']*\b{re.escape(class_name)}\b[^"']*["'][^>]*>""",
        flags=re.I,
    )
    blocks: List[Dict[str, object]] = []
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


def parse_bill_section(section_html: str, section_id: str) -> Dict[str, str]:
    heading = extract(r"""<h2 class=["']section_number["']>(.*?)</h2>""", section_html, flags=re.S)
    statute_heading = extract(r"""<h2 class=["']statute_section_number["']>(.*?)</h2>""", section_html, flags=re.S)
    cite_heading = extract(r"""<h1 class=["']shn["']>(.*?)</h1>""", section_html, flags=re.S)
    effective_date = extract(r"""<h2 class=["']effective_date["']>(.*?)</h2>""", section_html, flags=re.S)

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


def fetch_text(sess: requests.Session, url: str) -> str:
    last_error: Optional[Exception] = None
    for attempt in range(1, MAX_RETRIES + 1):
        try:
            response = sess.get(url, timeout=TIMEOUT)
            if response.status_code in {429, 500, 502, 503, 504} and attempt < MAX_RETRIES:
                time.sleep(0.5 * attempt)
                continue
            response.raise_for_status()
            return response.text
        except requests.RequestException as exc:
            last_error = exc
            if attempt == MAX_RETRIES:
                break
            time.sleep(0.5 * attempt)
    raise PrototypeError(f"Failed to fetch {url}: {last_error}")


def discover_bill(sess: requests.Session, chamber: str, session_code: str, bill_number: str) -> Dict[str, str]:
    params = {
        "body": chamber,
        "search": "basic",
        "session": session_code,
        "location": chamber,
        "bill": bill_number,
        "bill_type": "bill",
        "rev_number": "",
        "submit_bill": "GO",
        "keyword_type": "all",
        "keyword": "",
        "keyword_field_text": "1",
        "titleword": "",
        "format": "xml",
    }
    search_url = "https://www.revisor.mn.gov/bills/status_result.php"
    xml_text = fetch_text(sess, requests.Request("GET", search_url, params=params).prepare().url)
    root = ET.fromstring(xml_text)
    result = root.find(".//BILL_RESULT")
    if result is None:
        raise PrototypeError(f"Bill search returned no results for {chamber} {bill_number}")
    status_xml_uri = result.findtext("STATUS_XML_URI", "").strip()
    return {
        "file_type": result.findtext("FILE_TYPE", "").strip(),
        "file_number": result.findtext("FILE_NUMBER", "").strip(),
        "description": result.findtext("DESCRIPTION", "").strip(),
        "status_xml_uri": f"https://{status_xml_uri}" if status_xml_uri and not status_xml_uri.startswith("http") else status_xml_uri,
        "latest_text_html_uri": f"https://{result.findtext('LATEST_TEXT_HTML_URI', '').strip()}",
    }


def parse_bill_xml(xml_text: str) -> Dict[str, object]:
    root = ET.fromstring(xml_text)

    def text(path: str) -> str:
        return (root.findtext(path) or "").strip()

    authors: Dict[str, List[Dict[str, str]]] = {}
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

    actions: Dict[str, List[Dict[str, str]]] = {}
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
                    "action_description": (action.findtext("ACTION_DESCRIPTION") or "").strip(),
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
                "date_insert": (doc.findtext("DATE_INSERT") or "").strip(),
                "document_name": (doc.findtext("DOCUMENT_NAME") or "").strip(),
                "document_type": (doc.findtext("DOCUMENT_TYPE") or "").strip(),
                "document_engrossment": (doc.findtext("DOCUMENT_ENGROSSMENT") or "").strip(),
            }
        )

    return {
        "bill_key": f"{text('SESSION_NUMBER')}-{text('SESSION_YEAR')}-{text('FILE_TYPE')}{text('FILE_NUMBER')}",
        "file_type": text("FILE_TYPE"),
        "file_number": text("FILE_NUMBER"),
        "revisor_number": text("REVISOR_NUMBER"),
        "companion_type": text("COMPANION_TYPE"),
        "companion_number": text("COMPANION_NUMBER"),
        "description": text("DESCRIPTION"),
        "session_year": text("SESSION_YEAR"),
        "session_type": text("SESSION_TYPE"),
        "session_number": text("SESSION_NUMBER"),
        "session_text": text("SESSION_TEXT"),
        "session_year_start": text("SESSION_YEAR_START"),
        "session_year_close": text("SESSION_YEAR_CLOSE"),
        "authors": authors,
        "actions": actions,
        "text_versions": versions,
    }


def parse_bill_text_html(html_text: str, source_url: str) -> Dict[str, object]:
    title = extract(r"<title>\s*(.*?)\s*</title>", html_text, flags=re.S)
    bill_title = extract(r"<div class=\"bill_title\">(.*?)</div>", html_text, flags=re.S)

    article_blocks = locate_div_blocks(html_text, "article")
    article_ranges = [(block["start"], block["end"]) for block in article_blocks]

    articles = []
    sections = []
    for article_block in article_blocks:
        article_html = article_block["html"]  # type: ignore[assignment]
        article_number = extract(r"""<h1 class=["']article_no["']>(.*?)</h1>""", article_html, flags=re.S)
        article_heading = extract(r"""<h1 class=["']article_header["']>(.*?)</h1>""", article_html, flags=re.S)
        article_sections = []
        for section_block in locate_div_blocks(article_html, "bill_section"):
            parsed = parse_bill_section(
                section_block["html"],  # type: ignore[arg-type]
                str(section_block["id"]),
            )
            article_sections.append(parsed)
            sections.append(parsed)

        articles.append(
            {
                "article_id": article_block["id"],
                "article_number": article_number,
                "article_heading": article_heading,
                "section_count": len(article_sections),
                "sections": article_sections,
            }
        )

    appendix_sections = []
    if article_ranges:
        for section_block in locate_div_blocks(html_text, "bill_section"):
            start = int(section_block["start"])
            end = int(section_block["end"])
            if any(start >= article_start and end <= article_end for article_start, article_end in article_ranges):
                continue
            parsed = parse_bill_section(
                section_block["html"],  # type: ignore[arg-type]
                str(section_block["id"]),
            )
            appendix_sections.append(parsed)
            sections.append(parsed)
    elif not sections:
        for section_block in locate_div_blocks(html_text, "bill_section"):
            sections.append(
                parse_bill_section(
                    section_block["html"],  # type: ignore[arg-type]
                    str(section_block["id"]),
                )
            )

    return {
        "source_url": source_url,
        "page_title": title,
        "bill_title_text": bill_title,
        "article_count": len(articles),
        "appendix_section_count": len(appendix_sections),
        "articles": articles,
        "sections": sections,
    }


def prototype_bill(sess: requests.Session, chamber: str, session_code: str, bill_number: str) -> Dict[str, object]:
    discovery = discover_bill(sess, chamber, session_code, bill_number)
    bill_xml = fetch_text(sess, discovery["status_xml_uri"])
    canonical = parse_bill_xml(bill_xml)

    latest_html_url = discovery["latest_text_html_uri"]
    if canonical["text_versions"]:
        latest_html_url = canonical["text_versions"][-1]["html_uri"]  # type: ignore[index]
    bill_text_html = fetch_text(sess, latest_html_url)
    text_payload = parse_bill_text_html(bill_text_html, latest_html_url)

    return {
        "prototype": "bill_ingest",
        "source_discovery": discovery,
        "canonical_bill": canonical,
        "bill_text": text_payload,
    }


def parse_roster_entries(section_html: str, chamber: str) -> List[Dict[str, str]]:
    entries = []
    pattern = re.compile(
        r"<div class='media my-3'>.*?<img[^>]+src='([^']+)'[^>]+alt='([^']+)'.*?"
        r"<h5 class='mt-0 mb-0'><a href='([^']+)'><b>([^<]+)</b></a></h5>\s*District:\s*([0-9A-Z]+)",
        re.S,
    )
    for image_url, alt_text, profile_url, display_name, district in pattern.findall(section_html):
        entries.append(
            {
                "chamber": chamber,
                "display_name": normalize_space(display_name),
                "district": district.strip(),
                "profile_url": urljoin("https://www.leg.mn.gov/leg/legislators", profile_url),
                "image_url": image_url.strip(),
                "alt_text": alt_text.strip(),
            }
        )
    return entries


def prototype_roster(sess: requests.Session) -> Dict[str, object]:
    url = "https://www.leg.mn.gov/leg/legislators"
    html_text = fetch_text(sess, url)
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
    house_html = house_match.group(1) if house_match else ""
    senate_html = senate_match.group(1) if senate_match else ""

    house = parse_roster_entries(house_html, "house")
    senate = parse_roster_entries(senate_html, "senate")

    return {
        "prototype": "legislator_roster",
        "source_url": url,
        "house_count": len(house),
        "senate_count": len(senate),
        "house_sample": house[:5],
        "senate_sample": senate[:5],
    }


def parse_house_profile(html_text: str, source_url: str) -> Dict[str, object]:
    heading = extract(r"<h5 class=\"mt-0\">(.*?)</h5>", html_text, flags=re.S)
    name = extract(r"<h5 class=\"mt-0\">\s*([^<]+?)\s*<span", html_text, flags=re.S) or normalize_space(heading)
    party = extract(r"\(([^)]+)\)\s*District:", heading, flags=re.S)
    district = extract(r"District:\s*([0-9A-Z]+)", heading, flags=re.S)
    email = extract(r"mailto:([^\"'>\s]+@house\.mn\.gov)", html_text, flags=re.I)
    office_phone = extract(r"<span>(651-[0-9-]+)</span>\s*<br", html_text, flags=re.I)
    assistant_name = extract(r"<strong>Name:</strong>\s*([^<]+)", html_text, flags=re.S)
    assistant_phone = extract(r"<strong>Phone:</strong>\s*([^<]+)", html_text, flags=re.S)
    committees = extract_all(r"<a href=\"https://www.house\.mn\.gov/cmte/Home/\?comm=\d+\">([^<]+)</a>", html_text)

    office_block = extract(
        r"<h5 class=\"mt-0\">.*?</h5>\s*(.*?)<span><a href=\"photo/",
        html_text,
        flags=re.S,
    )

    return {
        "source_url": source_url,
        "chamber": "house",
        "name": name,
        "party": party,
        "district": district,
        "office_block": office_block,
        "email": email,
        "office_phone": office_phone,
        "assistant": {
            "name": assistant_name,
            "phone": assistant_phone,
        },
        "committees": committees,
    }


def parse_senate_profile(html_text: str, source_url: str) -> Dict[str, object]:
    heading = extract(r"<h1 class='mb-0'>(.*?)</h1>", html_text, flags=re.S)
    name = extract(r"^(.*?)\s*\(", heading, flags=re.S)
    district = extract(r"\((\d+),", heading, flags=re.S)
    party = extract(r"\(\d+,\s*([A-Z]+)\)", heading, flags=re.S)
    phone = extract(r"<span>(651-[0-9-]+)</span>", html_text, flags=re.I)
    email_form = extract(r"<span><b>E-mail:</b>\s*<a href='([^']+)'", html_text, flags=re.S)
    committees = extract_all(r"<a href='/committees/committee_bio\.php\?cmte_id=\d+'>([^<]+)</a>", html_text)
    assistant_text = extract(r"<strong>Legislative Assistant:</strong>\s*([^<]+)</li>", html_text, flags=re.S)
    office_block = extract(
        r"<div class='media-body align-self-center'>(.*?)</div>\s*</div>\s*<div class=\"mt-3\">",
        html_text,
        flags=re.S,
    )

    return {
        "source_url": source_url,
        "chamber": "senate",
        "name": name,
        "party": party,
        "district": district,
        "office_block": office_block,
        "office_phone": phone,
        "email_form_url": urljoin(source_url, email_form) if email_form else "",
        "assistant_summary": assistant_text,
        "committees": committees,
    }


def prototype_member(sess: requests.Session, source_url: str) -> Dict[str, object]:
    html_text = fetch_text(sess, source_url)
    if "house.mn.gov" in source_url:
        return parse_house_profile(html_text, source_url)
    return parse_senate_profile(html_text, source_url)


DEFAULT_BILL_FIXTURES = [
    {"label": "HF2136", "chamber": "House", "session_code": "0942025", "bill_number": "2136"},
    {"label": "HF4", "chamber": "House", "session_code": "0942025", "bill_number": "4"},
    {"label": "HF1", "chamber": "House", "session_code": "0942025", "bill_number": "1"},
    {"label": "SF1832", "chamber": "Senate", "session_code": "0942025", "bill_number": "1832"},
    {"label": "SF2483", "chamber": "Senate", "session_code": "0942025", "bill_number": "2483"},
    {"label": "SF3095", "chamber": "Senate", "session_code": "0942025", "bill_number": "3095"},
    {"label": "SF1047", "chamber": "Senate", "session_code": "0942025", "bill_number": "1047"},
    {"label": "SF1097", "chamber": "Senate", "session_code": "0942025", "bill_number": "1097"},
]

DEFAULT_MEMBER_FIXTURES = [
    {"label": "house_15518", "url": "https://www.house.mn.gov/members/profile/15518"},
    {"label": "house_15602", "url": "https://www.house.mn.gov/members/profile/15602"},
    {"label": "house_15551", "url": "https://www.house.mn.gov/members/profile/15551"},
    {"label": "senate_10002", "url": "http://www.senate.leg.state.mn.us/members/member_bio.php?leg_id=10002"},
    {"label": "senate_15545", "url": "http://www.senate.leg.state.mn.us/members/member_bio.php?leg_id=15545"},
    {"label": "senate_15317", "url": "http://www.senate.leg.state.mn.us/members/member_bio.php?leg_id=15317"},
]


def validate_bill_fixture(sess: requests.Session, fixture: Dict[str, str]) -> Dict[str, object]:
    payload = prototype_bill(sess, fixture["chamber"], fixture["session_code"], fixture["bill_number"])
    canonical = payload["canonical_bill"]
    text_payload = payload["bill_text"]
    actions = sum(len(items) for items in canonical["actions"].values())  # type: ignore[union-attr]
    authors = sum(len(items) for items in canonical["authors"].values())  # type: ignore[union-attr]
    roll_calls = sum(
        1
        for items in canonical["actions"].values()  # type: ignore[union-attr]
        for item in items
        if item.get("roll_call")
    )
    return {
        "label": fixture["label"],
        "ok": True,
        "bill_key": canonical["bill_key"],
        "description_present": bool(canonical["description"]),
        "author_count": authors,
        "action_count": actions,
        "roll_call_count": roll_calls,
        "text_version_count": len(canonical["text_versions"]),
        "article_count": text_payload.get("article_count", 0),
        "section_count": len(text_payload["sections"]),
        "title_present": bool(text_payload["bill_title_text"]),
    }


def validate_member_fixture(sess: requests.Session, fixture: Dict[str, str]) -> Dict[str, object]:
    payload = prototype_member(sess, fixture["url"])
    return {
        "label": fixture["label"],
        "ok": True,
        "chamber": payload["chamber"],
        "name_present": bool(payload.get("name")),
        "district_present": bool(payload.get("district")),
        "party_present": bool(payload.get("party")),
        "phone_present": bool(payload.get("office_phone")),
        "committee_count": len(payload.get("committees", [])),
    }


def validate_sources(sess: requests.Session) -> Dict[str, object]:
    report: Dict[str, object] = {
        "prototype": "batch_validation",
        "bill_results": [],
        "member_results": [],
        "roster_result": {},
        "summary": {},
    }

    bill_results = []
    for fixture in DEFAULT_BILL_FIXTURES:
        try:
            bill_results.append(validate_bill_fixture(sess, fixture))
        except Exception as exc:  # noqa: BLE001
            bill_results.append({"label": fixture["label"], "ok": False, "error": str(exc)})

    member_results = []
    for fixture in DEFAULT_MEMBER_FIXTURES:
        try:
            member_results.append(validate_member_fixture(sess, fixture))
        except Exception as exc:  # noqa: BLE001
            member_results.append({"label": fixture["label"], "ok": False, "error": str(exc)})

    try:
        roster = prototype_roster(sess)
        roster_result = {
            "ok": True,
            "house_count": roster["house_count"],
            "senate_count": roster["senate_count"],
            "house_sample_count": len(roster["house_sample"]),
            "senate_sample_count": len(roster["senate_sample"]),
        }
    except Exception as exc:  # noqa: BLE001
        roster_result = {"ok": False, "error": str(exc)}

    report["bill_results"] = bill_results
    report["member_results"] = member_results
    report["roster_result"] = roster_result
    report["summary"] = {
        "bill_successes": sum(1 for result in bill_results if result["ok"]),
        "bill_failures": sum(1 for result in bill_results if not result["ok"]),
        "member_successes": sum(1 for result in member_results if result["ok"]),
        "member_failures": sum(1 for result in member_results if not result["ok"]),
        "roster_ok": roster_result.get("ok", False),
    }
    return report


def write_json(path: Path, payload: Dict[str, object]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, indent=2, sort_keys=True) + "\n")


def main() -> None:
    parser = argparse.ArgumentParser()
    subparsers = parser.add_subparsers(dest="command", required=True)

    bill_parser = subparsers.add_parser("bill")
    bill_parser.add_argument("--chamber", default="House")
    bill_parser.add_argument("--session-code", default="0942025")
    bill_parser.add_argument("--bill-number", default="2136")
    bill_parser.add_argument("--out", type=Path, required=True)

    roster_parser = subparsers.add_parser("roster")
    roster_parser.add_argument("--out", type=Path, required=True)

    member_parser = subparsers.add_parser("member")
    member_parser.add_argument("--url", required=True)
    member_parser.add_argument("--out", type=Path, required=True)

    validate_parser = subparsers.add_parser("validate")
    validate_parser.add_argument("--out", type=Path, required=True)

    args = parser.parse_args()
    sess = session()

    if args.command == "bill":
        payload = prototype_bill(sess, args.chamber, args.session_code, args.bill_number)
        write_json(args.out, payload)
    elif args.command == "roster":
        payload = prototype_roster(sess)
        write_json(args.out, payload)
    elif args.command == "member":
        payload = prototype_member(sess, args.url)
        write_json(args.out, payload)
    elif args.command == "validate":
        payload = validate_sources(sess)
        write_json(args.out, payload)


if __name__ == "__main__":
    main()
