"""Exact, narrow identity quotes from retained Board responses and native PDFs.

These checks establish what the cited source says, not a same-person judgment.
They never fetch, perform OCR, search other pages, or normalize names.
"""

from __future__ import annotations

import hashlib
from html.parser import HTMLParser
import io
import json
import tempfile

from pypdf import PdfReader
from sqlalchemy import select

from alethical.db import models as m
from alethical.pipeline.campaign_finance_report_document_store import read_document
from alethical.pipeline.election_comparison import ComparisonImportError, read_source

QUOTE_KINDS = {"candidate_identity", "report_excerpt"}
BOARD_URL = (
    "https://cfb.mn.gov/reports-and-data/viewers/campaign-finance/candidates/api"
)


def require(condition, message):
    if not condition:
        raise ComparisonImportError(message)


def _text(value):
    return isinstance(value, str) and bool(value.strip()) and "\x00" not in value


def _object(pairs):
    result = {}
    for key, value in pairs:
        require(key not in result, "Identity JSON has duplicate fields")
        result[key] = value
    return result


class _HTMLClaims(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.titles: list[str] = []
        self.links: list[str] = []
        self.in_title = False

    def handle_starttag(self, tag, attrs):
        if tag == "title":
            require(not self.in_title, "Identity title markup is ambiguous")
            self.in_title = True
            self.titles.append("")
        if tag == "a":
            hrefs = [value for key, value in attrs if key == "href"]
            require(len(hrefs) <= 1, "Identity link has duplicate href fields")
            if hrefs and hrefs[0] is not None:
                self.links.append(hrefs[0])

    def handle_endtag(self, tag):
        if tag == "title":
            require(self.in_title, "Identity title markup is ambiguous")
            self.in_title = False

    def handle_data(self, data):
        if self.in_title:
            self.titles[-1] += data


def _html(content):
    parser = _HTMLClaims()
    parser.feed(content)
    parser.close()
    require(not parser.in_title, "Identity title is not closed")
    return parser


def _member(collection, fingerprint, registration_number):
    matches = [
        source
        for source in collection.sources
        if source.get("sha256") == fingerprint
        and source.get("kind") == "candidate_identity"
        and source.get("registration_number") == registration_number
    ]
    require(len(matches) == 1, "Identity source needs exact account membership")
    return matches[0]


def _original(db, store, fingerprint):
    source = db.get(m.ElectionResultSource, fingerprint, populate_existing=True)
    require(source is not None, "Identity original is not retained")
    # read_source checks compressed and original hashes and exact byte lengths.
    return read_source(store, source)


def _officers(db, store, source, registration_number):
    form = source.get("request_form")
    require(
        source.get("url") == BOARD_URL
        and source.get("request_method") == "POST"
        and isinstance(form, dict)
        and form.get("id") == registration_number
        and form.get("tabname") == "officers",
        "Identity quote needs the exact account's Board officers response",
    )
    payload = json.loads(
        _original(db, store, source["sha256"]).decode("utf-8-sig"),
        object_pairs_hook=_object,
    )
    require(
        isinstance(payload, dict) and _text(payload.get("tabcontent")),
        "Identity response has no literal tabcontent field",
    )
    return payload["tabcontent"]


def _identity(db, store, item, registration_number):
    require(
        _text(item.get("collection_id")), "Identity quote needs its retained collection"
    )
    collection = db.get(
        m.ElectionFinanceCollection, item.get("collection_id"), populate_existing=True
    )
    require(collection is not None, "Identity quote needs its retained collection")
    source = _member(collection, item.get("sha256"), registration_number)
    fields, locator = item.get("literal_fields"), item.get("locator")
    require(isinstance(fields, dict), "Identity quote needs typed literal fields")
    if locator == {"type": "json_html_excerpts", "pointer": "/tabcontent"}:
        require(set(fields) == {"excerpts"}, "Identity quote has unsupported fields")
        excerpts = fields["excerpts"]
        require(
            isinstance(excerpts, list)
            and bool(excerpts)
            and all(_text(quote) for quote in excerpts)
            and len(set(excerpts)) == len(excerpts),
            "Identity excerpts must be distinct literal strings",
        )
        content = _officers(db, store, source, registration_number)
        require(
            all(quote in content for quote in excerpts),
            "Identity quote differs from retained JSON tabcontent",
        )
    elif locator == {"type": "html_title"}:
        require(
            set(fields) == {"title"} and _text(fields["title"]),
            "Identity title needs exactly one literal title",
        )
        require(
            source.get("subtype") == "registered_site"
            and source.get("request_method") == "GET"
            and source.get("parent_locator") == "/tabcontent"
            and _text(source.get("requested_url")),
            "Identity site needs the retained registered-link chain",
        )
        parent = _member(collection, source.get("parent_sha256"), registration_number)
        content = _officers(db, store, parent, registration_number)
        require(
            source["requested_url"] in _html(content).links,
            "Identity site URL is absent from retained Board parent",
        )
        body = _original(db, store, source["sha256"]).decode("utf-8-sig")
        require(
            _html(body).titles == [fields["title"]],
            "Identity title differs from retained registered site",
        )
    else:
        raise ComparisonImportError("Identity quote needs a supported typed locator")


def _report(db, store, item, registration_number):
    require(
        item.get("locator") == {"type": "native_pdf_lines"},
        "Report excerpt needs a native PDF line locator",
    )
    page, fields = item.get("page"), item.get("literal_fields")
    require(type(page) is int and page > 0, "Report excerpt needs an exact PDF page")
    require(
        isinstance(fields, dict) and set(fields) == {"lines"},
        "Report excerpt needs typed literal lines",
    )
    quotes = fields["lines"]
    require(
        isinstance(quotes, list)
        and bool(quotes)
        and all(
            isinstance(row, dict)
            and set(row) == {"line_number", "text"}
            and type(row["line_number"]) is int
            and row["line_number"] > 0
            and _text(row["text"])
            for row in quotes
        ),
        "Report quotes need exact page-local line numbers and text",
    )
    require(
        len({row["line_number"] for row in quotes}) == len(quotes),
        "Report excerpt repeats a line locator",
    )
    require(
        _text(item.get("collection_id")), "Report excerpt needs its retained collection"
    )
    collection = db.get(
        m.ElectionFinanceCollection, item.get("collection_id"), populate_existing=True
    )
    require(collection is not None, "Report excerpt needs its retained collection")
    member = db.scalar(
        select(m.ElectionFinanceReport.report_key)
        .where(
            m.ElectionFinanceReport.collection_id == collection.id,
            m.ElectionFinanceReport.registration_number == registration_number,
            m.ElectionFinanceReport.document_hash == item.get("sha256"),
        )
        .limit(1)
    )
    require(
        member is not None, "Report excerpt is absent from this account's collection"
    )
    document = db.get(
        m.CampaignFinanceReportDocument, item.get("sha256"), populate_existing=True
    )
    require(
        document is not None and document.registration_number == registration_number,
        "Report excerpt is not retained for this account",
    )
    with tempfile.TemporaryDirectory(prefix="account-quote-") as directory:
        body = read_document(store, document, directory)
    require(
        len(body) == document.byte_size
        and hashlib.sha256(body).hexdigest() == item["sha256"]
        and body.startswith(b"%PDF"),
        "Report excerpt original fingerprint changed",
    )
    reader = PdfReader(io.BytesIO(body))
    # Official PDFs can have owner restrictions but readable native text. An
    # unreadable page raises; no password guessing or fallback is attempted.
    require(page <= len(reader.pages), "PDF page unavailable")
    # Exactly the requested page, native text only. No OCR or alternate page search.
    lines = (reader.pages[page - 1].extract_text() or "").splitlines()
    require(
        all(
            row["line_number"] <= len(lines)
            and lines[row["line_number"] - 1] == row["text"]
            for row in quotes
        ),
        "Report excerpt differs from the exact retained PDF page",
    )


def validate_quote(db, store, item, registration_number):
    """Fail closed on absent claims, unsupported locators or unreadable originals."""
    try:
        require(store is not None, "Quoted original store is unavailable")
        require("literal_row" not in item, "Typed quotes cannot carry an unchecked row")
        if item.get("kind") == "candidate_identity":
            _identity(db, store, item, registration_number)
        elif item.get("kind") == "report_excerpt":
            _report(db, store, item, registration_number)
        else:
            raise ComparisonImportError("Unsupported account quote kind")
    except ComparisonImportError:
        raise
    except Exception as error:
        # Object-store, decoder and PDF-library failures all leave the quote unproved.
        raise ComparisonImportError(
            "Could not read the exact retained quote"
        ) from error
