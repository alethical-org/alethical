"""Typed Board candidate records, never principal campaign committee accounts.

Capture, literal reading and manual same-person judgment are separate proofs.
No function in this module fetches a source or locks a collection parent.
"""

from __future__ import annotations

from copy import deepcopy
from dataclasses import dataclass
from datetime import date, datetime
from decimal import Decimal
import hashlib
from html.parser import HTMLParser
from functools import wraps
import re
from urllib.parse import parse_qsl, urljoin, urlsplit
from typing import Any

from alethical.db import models as m
from alethical.pipeline.election_comparison import ComparisonImportError, digest
from alethical.pipeline import election_source_provenance as p
from alethical.pipeline.election_source_files import (
    SourceFileError,
    SourceFileLimitError,
)

SECTION_SCHEMA = "mn-cfb-candidate-records:v1"
CONTEXT = "mn-cfb-candidate-context:v1"
READING_SCHEMA = "mn-cfb-personal-expenditures:v1"
RELATIONSHIP = "board_candidate_relationship:v1"
CAPTURE_SCHEMA = "retained-board-capture:v1"
API_URL = "https://cfb.mn.gov/reports-and-data/viewers/campaign-finance/candidates/api"
PDF_URL = "https://cfb.mn.gov/rptViewer/Main.php?do=viewPDF"
VIEWER_PREFIX = (
    "https://cfb.mn.gov/reports-and-data/viewers/campaign-finance/candidates/"
)
MAX_RECORDS = 600
MAX_REPORTS = 100
MAX_BYTES = 20_000_000
REF_KEYS = {"source_sha256", "acquisition_receipt_id"}
_TOTALS = ("cash", "unpaid", "in_kind", "total")
_TITLE = "Report of Personal Expenditures by a Candidate Without a Principal Campaign Committee"
_INFO_FIELDS = (
    "RegisteredEntityID",
    "RegisteredEntityType",
    "CandidateFullName",
    "OfficeSought",
    "District",
    "ElectionYear",
)


def require(ok, message):
    p.require(ok, message)


def _shape(function):
    @wraps(function)
    def checked(*args, **kwargs):
        try:
            return function(*args, **kwargs)
        except (KeyError, IndexError, TypeError, ValueError, OverflowError) as exc:
            if isinstance(exc, ComparisonImportError):
                raise
            raise ComparisonImportError("Invalid Board source/receipt shape") from exc

    return checked


def _id(value):
    return (
        isinstance(value, str) and re.fullmatch(r"[1-9][0-9]{0,11}", value) is not None
    )


def _year(value):
    return type(value) is int and 2000 <= value <= 2099


def _ref(value):
    p.exact(value, REF_KEYS, "Board source needs an exact original and acquisition")
    require(
        all(p.fingerprint(value[k]) for k in REF_KEYS), "Invalid Board source reference"
    )


def _body(files, sha, limit=MAX_BYTES):
    value = files.get(sha)
    if isinstance(value, bytes):
        require(
            0 < len(value) <= limit and hashlib.sha256(value).hexdigest() == sha,
            "Board original differs",
        )
        return value
    return p.read_original(files, sha, limit=limit)


def _json(files, sha):
    return p.parse_json(_body(files, sha))


def _capture(record):
    """Fixed completed normal-client collector profile, including its wire body."""
    require(isinstance(record, dict), "Board capture needs a collector object")
    method = record.get("method")
    req = record.get("prepared_request")
    require(
        isinstance(req, dict) and method in {"GET", "POST"},
        "Unsupported Board capture method",
    )
    requested = record.get("requested_url")
    require(
        p.url(requested) == req.get("url") == record.get("response_url")
        and req.get("method") == method,
        "Board capture request/response differs",
    )
    require(
        urlsplit(requested).scheme == "https"
        and urlsplit(requested).netloc == "cfb.mn.gov",
        "Board capture is outside its publisher",
    )
    require(
        record.get("status") == 200
        and type(record.get("status")) is int
        and record.get("body_complete") is True
        and record.get("capture_outcome") in {None, "successful_200_capture"}
        and record.get("error_class") is None
        and record.get("charged_dispatches") == 1
        and type(record.get("charged_dispatches")) is int
        and record.get("dispatch_status") == "dispatched_or_possible",
        "Board capture is incomplete or unsuccessful",
    )
    require(
        req.get("TLS_verify") is True
        and req.get("ambient_credentials_disabled") is True
        and req.get("allow_redirects") is False
        and type(req.get("adapter_retry_total")) is int
        and req["adapter_retry_total"] == 0
        and record.get("javascript_executed") is False,
        "Unsupported Board capture transport",
    )
    headers = req.get("headers")
    require(
        isinstance(headers, dict)
        and all(isinstance(k, str) and isinstance(v, str) for k, v in headers.items()),
        "Board capture headers are malformed",
    )
    folded = {k.lower(): v for k, v in headers.items()}
    require(
        len(folded) == len(headers)
        and not {"authorization", "proxy-authorization"} & folded.keys()
        and folded.get("cookie") in (None, "PHPSESSID="),
        "Board capture contains duplicate or authenticated request state",
    )
    headers = folded
    size = record.get("retained_body_bytes")
    require(
        type(size) is int
        and 0 < size <= MAX_BYTES
        and p.fingerprint(record.get("body_sha256")),
        "Board capture body identity differs",
    )
    cap = req.get("decoded_response_cap_bytes")
    require(
        type(cap) is int and size <= cap <= MAX_BYTES, "Board capture exceeds its bound"
    )
    times = {
        k: record.get(k)
        for k in (
            "started_at",
            "send_started_at",
            "response_received_at",
            "finished_at",
        )
    }
    for value in times.values():
        p.timestamp(value)
    parsed = [datetime.fromisoformat(v.replace("Z", "+00:00")) for v in times.values()]
    require(parsed == sorted(parsed), "Board capture times are out of order")
    form, body = None, None
    if method == "POST":
        form, body = record.get("request_form"), req.get("body_utf8")
        require(
            isinstance(form, dict)
            and form == req.get("form")
            and all(isinstance(k, str) and isinstance(v, str) for k, v in form.items())
            and p.text_value(body, limit=32000),
            "Board POST form differs",
        )
        try:
            pairs = parse_qsl(body, keep_blank_values=True, strict_parsing=True)
        except ValueError as exc:
            raise ComparisonImportError("Invalid Board POST serialization") from exc
        require(
            len(pairs) == len(form) and dict(pairs) == form,
            "Board POST serialization differs",
        )
        require(
            headers.get("content-type") == "application/x-www-form-urlencoded"
            and headers.get("content-length") == str(len(body.encode())),
            "Board POST headers differ",
        )
        require(requested in {API_URL, PDF_URL}, "Unsupported Board POST endpoint")
    else:
        require(
            req.get("body") is None and "request_form" not in record,
            "Board GET cannot carry a form",
        )
        require(
            re.fullmatch(
                re.escape(VIEWER_PREFIX) + r"[1-9][0-9]*/20[0-9]{2}/", requested
            )
            is not None
            or re.fullmatch(
                r"https://cfb\.mn\.gov/cache/default\.[a-f0-9]{32}\.js", requested
            )
            is not None,
            "Unsupported Board viewer/definition capture",
        )
    response_headers = record.get("response_headers")
    require(
        isinstance(response_headers, dict)
        and all(
            isinstance(k, str) and isinstance(v, str)
            for k, v in response_headers.items()
        ),
        "Board capture response headers absent",
    )
    response_folded = {k.lower(): v for k, v in response_headers.items()}
    require(
        len(response_folded) == len(response_headers),
        "Duplicate Board response headers",
    )
    media = response_folded.get("content-type")
    require(p.text_value(media, limit=256), "Board capture media type absent")
    return {
        "requested": {
            "method": method,
            "url": requested,
            "wire_url": p.wire_url(requested),
            "form": form,
            "body_utf8": body,
        },
        "final": {
            "url": requested,
            "wire_url": p.wire_url(requested),
            "source_sha256": record["body_sha256"],
            "byte_size": size,
            "media_type": media,
            "copied_at": times["finished_at"],
        },
        "response_status": 200,
        "capture_times": times,
    }


@_shape
def prepare_post_acquisition(evidence_body, *, pointer=""):
    require(
        isinstance(evidence_body, bytes) and 0 < len(evidence_body) <= p.MAX_EVIDENCE,
        "Bounded retained collector bytes required",
    )
    record = p.select_record(p.parse_json(evidence_body), pointer)
    value = {
        "schema": CAPTURE_SCHEMA,
        "origin_basis": p.ORIGIN_BASIS,
        "evidence_sha256": hashlib.sha256(evidence_body).hexdigest(),
        "evidence_locator": {"kind": "json_record", "pointer": pointer},
        **_capture(record),
    }
    return validate_capture(value)


@_shape
def validate_capture(value):
    p.exact(
        value,
        {
            "schema",
            "origin_basis",
            "evidence_sha256",
            "evidence_locator",
            "requested",
            "final",
            "response_status",
            "capture_times",
        },
    )
    require(
        value["schema"] == CAPTURE_SCHEMA
        and value["origin_basis"] == p.ORIGIN_BASIS
        and p.fingerprint(value["evidence_sha256"]),
        "Unsupported Board capture receipt",
    )
    p.exact(value["evidence_locator"], {"kind", "pointer"})
    require(
        value["evidence_locator"]["kind"] == "json_record", "Invalid capture locator"
    )
    p._pointer_text(value["evidence_locator"]["pointer"])
    p.exact(value["requested"], {"method", "url", "wire_url", "form", "body_utf8"})
    p.exact(
        value["final"],
        {"url", "wire_url", "source_sha256", "byte_size", "media_type", "copied_at"},
    )
    p.exact(
        value["capture_times"],
        {"started_at", "send_started_at", "response_received_at", "finished_at"},
    )
    require(
        value["response_status"] == 200
        and type(value["response_status"]) is int
        and value["requested"]["method"] in {"GET", "POST"},
        "Invalid Board capture status/method",
    )
    for part in (value["requested"], value["final"]):
        require(part["wire_url"] == p.wire_url(part["url"]), "Board wire URL differs")
    final = value["final"]
    require(
        final["url"] == value["requested"]["url"]
        and p.fingerprint(final["source_sha256"])
        and type(final["byte_size"]) is int
        and 0 < final["byte_size"] <= MAX_BYTES
        and p.text_value(final["media_type"], limit=256),
        "Invalid Board final body",
    )
    for value_ in value["capture_times"].values():
        p.timestamp(value_)
    require(
        final["copied_at"] == value["capture_times"]["finished_at"],
        "Board capture copy time differs",
    )
    return deepcopy(value)


def replay_capture(receipt, evidence, files):
    require(
        prepare_post_acquisition(
            evidence, pointer=receipt["evidence_locator"]["pointer"]
        )
        == receipt,
        "Board capture differs from retained observation",
    )
    source = p._source(files, receipt["final"]["source_sha256"])
    require(
        source.byte_size == receipt["final"]["byte_size"],
        "Board capture retained size differs",
    )
    return receipt


def _origin(proof, ref, *, method=None, url=None, form=None, media=None):
    p.issued(proof)
    value = proof.board_acquisition(ref["acquisition_receipt_id"])
    require(
        value["final"]["source_sha256"] == ref["source_sha256"],
        "Board source acquisition differs",
    )
    if method is not None:
        require(value["requested"]["method"] == method, "Board source method differs")
    if url is not None:
        require(
            value["requested"]["url"] == url and value["final"]["url"] == url,
            "Board source URL differs",
        )
    if form is not None:
        require(
            value["schema"] == CAPTURE_SCHEMA and value["requested"]["form"] == form,
            "Board source form differs",
        )
    if media is not None:
        require(
            value["final"]["media_type"] is not None
            and value["final"]["media_type"].split(";", 1)[0].strip().lower() == media,
            "Board source media differs",
        )
    return value


def public_source(ref, proof):
    if ref is None:
        return None
    origin = _origin(proof, ref)
    return {
        **deepcopy(ref),
        "url": origin["final"]["url"],
        "copied_at": origin["final"]["copied_at"],
        "media_type": origin["final"]["media_type"],
    }


@_shape
def viewer_config(files, ref, record_id, year, proof):
    origin = _origin(
        proof, ref, url=f"{VIEWER_PREFIX}{record_id}/{year}/", media="text/html"
    )
    require(
        origin["requested"]["method"] in {None, "GET"},
        "Board viewer is not a GET capture",
    )
    html = _body(files, ref["source_sha256"]).decode("utf-8")
    document = _HTML(html)
    require(
        all(
            _executable_script(script) and not script["attrs"].get("src")
            for script in document.scripts
            if "candidate_tabs" in script["body"]
        ),
        "Board configuration is not an executable inline script",
    )
    tokens = [
        token
        for script in document.scripts
        if "candidate_tabs" in script["body"]
        for token in _js_tokens(script["body"])
    ]
    positions = [i for i, token in enumerate(tokens) if token == "candidate_tabs"]
    require(len(positions) == 1, "Board viewer configuration is ambiguous")
    at = positions[0]
    require(
        at > 0
        and tokens[at - 1 : at + 10]
        == [
            "var",
            "candidate_tabs",
            "=",
            "new",
            "tab_content",
            "(",
            ")",
            ".",
            "init",
            "(",
            "{",
        ],
        "Board viewer configuration is not a literal initializer",
    )
    config, end = _js_object(tokens, at + 9)
    require(tokens[end : end + 2] == [")", ";"], "Board viewer initializer differs")
    require(
        set(config)
        <= {
            "api",
            "data_name",
            "extra_data",
            "store_name",
            "area_element",
            "active_class_on",
        }
        and config.get("api") == urlsplit(API_URL).path
        and config.get("data_name") == "candidtab"
        and config.get("store_name", "candidate_viewer-tabs") == "candidate_viewer-tabs"
        and config.get("area_element", "#candidtab") == "#candidtab"
        and config.get("active_class_on", "li") == "li",
        "Board viewer configuration differs",
    )
    extra = config.get("extra_data")
    p.exact(extra, {"id", "year", "year_data"})
    require(
        extra["id"] == record_id and extra["year"] == str(year),
        "Board viewer ID/year differs",
    )
    segment = extra["year_data"]
    p.exact(segment, {"ElectionSegmentStartDate", "ElectionSegmentEndDate"})
    require(
        all(_year(v) for v in segment.values())
        and segment["ElectionSegmentStartDate"]
        <= year
        <= segment["ElectionSegmentEndDate"],
        "Invalid Board viewer segment",
    )
    return html, segment


def _tab_form(record_id, year, segment, tab):
    return {
        "id": record_id,
        "year": str(year),
        "year_data[ElectionSegmentStartDate]": str(segment["ElectionSegmentStartDate"]),
        "year_data[ElectionSegmentEndDate]": str(segment["ElectionSegmentEndDate"]),
        "tabname": tab,
    }


def _tab(files, ref, record_id, year, segment, tab, html, proof):
    require(
        tab in _HTML(html).tabs,
        "Board tab is not offered by held viewer",
    )
    _origin(
        proof,
        ref,
        method="POST",
        url=API_URL,
        form=_tab_form(record_id, year, segment, tab),
        media="application/json",
    )
    value = _json(files, ref["source_sha256"])
    require(
        isinstance(value, dict) and isinstance(value.get("tabcontent"), str),
        "Board tab response is unsupported",
    )
    return value


@_shape
def information(files, ref, record_id, year, segment, html, proof):
    value = _tab(files, ref, record_id, year, segment, "information", html, proof)
    rows = value.get("data")
    require(
        isinstance(rows, list) and len(rows) == 1 and isinstance(rows[0], dict),
        "Board information record is ambiguous",
    )
    row = rows[0]
    require(
        row.get("RegisteredEntityID") == record_id
        and row.get("RegisteredEntityType") == "AOC"
        and row.get("ElectionYear") == str(year)
        and all(p.text_value(row.get(k)) for k in _INFO_FIELDS),
        "Board information role/identity/year differs",
    )
    return {k: row[k] for k in _INFO_FIELDS}


@_shape
def catalogue(files, ref, record_id, year, segment, html, proof):
    value = _tab(files, ref, record_id, year, segment, "reports_data", html, proof)
    if value.get("data") == []:
        require(
            re.fullmatch(
                r"\s*<p>No information found for Reports and Data</p>\s*",
                value["tabcontent"],
            )
            is not None,
            "Board empty catalogue response differs",
        )
        return {"state": "no_report_information_returned", "reports": []}
    data = value.get("data")
    require(
        isinstance(data, dict)
        and isinstance(data.get("pdfs"), dict)
        and len(data["pdfs"]) <= MAX_REPORTS,
        "Unsupported Board catalogue",
    )
    require(
        set(data) == {"pdfs", "notices", "disclosure", "notices_candidate"}
        and all(data[k] == [] for k in ("notices", "disclosure", "notices_candidate")),
        "Board catalogue contains unsupported offered records",
    )
    rows: list[dict[str, Any]] = []
    markup = _HTML(value["tabcontent"])
    require(
        not markup.scripts and not markup.other_actions,
        "Board catalogue contains dynamic or unsupported controls",
    )
    offered_controls = markup.pdf_controls
    for locator, row in data["pdfs"].items():
        require(
            isinstance(row, dict)
            and row.get("RegisteredEntityID") == record_id
            and row.get("RegisteredEntityType") == "AOC"
            and row.get("FilingYear") == str(year)
            and row.get("as_2DigitYear") == str(year)[2:]
            and row.get("ReportType") in {"C", "E", "Y"}
            and row.get("SpecialElectionindicator") == "0",
            "Board catalogue role/record/version differs",
        )
        cutoff = row.get("CutOffDate")
        require(
            isinstance(cutoff, str)
            and re.fullmatch(r"20[0-9]{2}-[0-9]{2}-[0-9]{2} 00:00:00", cutoff)
            is not None
            and cutoff[:4] == str(year),
            "Board catalogue cutoff is unknown",
        )
        try:
            date.fromisoformat(cutoff[:10])
        except ValueError as exc:
            raise ComparisonImportError("Board catalogue cutoff is invalid") from exc
        require(p.text_value(row.get("ReportName")), "Board report label is missing")
        amendments = row.get("amendments")
        require(
            isinstance(amendments, list)
            and 0 < len(amendments) <= 20
            and len(set(amendments)) == len(amendments)
            and all(
                isinstance(a, str) and re.fullmatch(r"0|[1-9][0-9]?", a)
                for a in amendments
            ),
            "Board amendment list is unknown",
        )
        for amendment in amendments:
            control = f"viewPDF('{str(year)[2:]}','aoc','{row['ReportType']}','0','{record_id}',{amendment})"
            require(
                offered_controls.count("javascript:" + control) == 1,
                "Board catalogue control differs",
            )
            rows.append(
                {
                    "locator": "/data/pdfs/" + locator,
                    "report_type": row["ReportType"],
                    "amendment": int(amendment),
                    "control": control,
                    "cutoff_date": row.get("CutOffDate"),
                    "name": row.get("ReportName"),
                }
            )
    require(
        sorted(offered_controls) == sorted("javascript:" + r["control"] for r in rows),
        "Board live catalogue controls differ from metadata",
    )
    require(
        len({(r["report_type"], r["amendment"]) for r in rows}) == len(rows),
        "Duplicate Board report version",
    )
    return {
        "state": "reports_offered",
        "reports": sorted(rows, key=lambda r: (r["report_type"], r["amendment"])),
    }


@_shape
def validate_context_shape(context, receipt=None):
    p.exact(
        context,
        {
            "kind",
            "record_id",
            "year",
            "role",
            "viewer",
            "information",
            "catalogue",
            "definition",
            "pdf",
            "report_type",
            "amendment",
        },
    )
    require(
        context["kind"] == CONTEXT
        and _id(context["record_id"])
        and _year(context["year"])
        and context["role"] == "AOC"
        and context["report_type"] in {"C", "E", "Y"}
        and type(context["amendment"]) is int
        and 0 <= context["amendment"] < 100,
        "Unsupported Board report context",
    )
    for key in ("viewer", "information", "catalogue", "definition", "pdf"):
        _ref(context[key])
    if receipt is not None:
        require(
            receipt["schema"] == READING_SCHEMA
            and receipt["original_sha256"] == context["pdf"]["source_sha256"]
            and receipt["document_kind"] == "financial_report",
            "Board context belongs to another reading",
        )
    return deepcopy(context)


def context_dependencies(context):
    validate_context_shape(context)
    refs = [
        context[k] for k in ("viewer", "information", "catalogue", "definition", "pdf")
    ]
    return {
        "public_original_hashes": sorted({r["source_sha256"] for r in refs}),
        "provenance_receipt_ids": sorted({r["acquisition_receipt_id"] for r in refs}),
    }


class _HTML(HTMLParser):
    """Only active markup can supply controls; script text is a separate source."""

    def __init__(self, body):
        super().__init__(convert_charrefs=True)
        self.forms: list[dict[str, Any]] = []
        self.current: dict[str, Any] | None = None
        self.words: list[str] = []
        self.tabs: list[str] = []
        self.pdf_controls: list[str] = []
        self.other_actions: list[str] = []
        self.scripts: list[dict[str, Any]] = []
        self._script: dict[str, Any] | None = None
        self._inert: list[str] = []
        self.feed(body)
        self.close()
        require(
            not self._inert and self._script is None and self.current is None,
            "Unclosed Board markup",
        )

    def handle_starttag(self, tag, attrs):
        require(
            len(attrs) == len({k for k, _ in attrs}), "Duplicate Board HTML attributes"
        )
        attrs = dict(attrs)
        if tag in {"template", "noscript", "style", "textarea", "title"}:
            self._inert.append(tag)
            return
        if self._inert:
            return
        if tag == "script":
            require(self._script is None, "Nested Board script")
            self._script = {"attrs": attrs, "body": ""}
            self.scripts.append(self._script)
            return
        if self._script is not None:
            return
        if "data-candidtab" in attrs:
            require(
                tag in {"a", "li", "button"}
                and isinstance(attrs["data-candidtab"], str),
                "Unsupported Board tab control",
            )
            self.tabs.append(attrs["data-candidtab"])
        for key, value in attrs.items():
            if key.startswith("on") or (
                isinstance(value, str)
                and value.lower().startswith("javascript:")
                and not value.startswith("javascript:viewPDF(")
            ):
                self.other_actions.append(key)
            if isinstance(value, str) and ("viewPDF" in value):
                require(
                    tag == "a"
                    and key == "href"
                    and value.startswith("javascript:viewPDF("),
                    "Unsupported Board PDF control",
                )
                self.pdf_controls.append(value)
        if tag == "form":
            require(self.current is None, "Nested Board form")
            self.current = {"attrs": attrs, "inputs": []}
            self.forms.append(self.current)
        elif tag == "input" and self.current is not None:
            self.current["inputs"].append(attrs)

    def handle_endtag(self, tag):
        if self._inert:
            if tag == self._inert[-1]:
                self._inert.pop()
            return
        if tag == "script":
            self._script = None
        elif tag == "form":
            self.current = None

    def handle_data(self, data):
        if self._inert:
            return
        if self._script is not None:
            self._script["body"] += data
        elif data.strip():
            self.words.append(data.strip())


def _executable_script(script):
    return script["attrs"].get("type", "").lower() in {
        "",
        "text/javascript",
        "application/javascript",
    }


def _js_named(token, name):
    if token == name:
        return True
    if not token.startswith(('"', "'")):
        return False

    # Property-name strings may use JS escapes; they cannot hide a reassignment.
    def unescape(match):
        part = match.group(1)
        if part.startswith("u"):
            require(
                re.fullmatch(r"u[0-9a-fA-F]{4}", part) is not None,
                "Unsupported Board Unicode escape",
            )
            return chr(int(part[1:], 16))
        if part.startswith("x"):
            require(
                re.fullmatch(r"x[0-9a-fA-F]{2}", part) is not None,
                "Unsupported Board hex escape",
            )
            return chr(int(part[1:], 16))
        return part

    literal = re.sub(r"\\(u[0-9a-fA-F]{4}|x[0-9a-fA-F]{2}|.)", unescape, token[1:-1])
    return literal == name


def _js_tokens(source):
    """Bounded lexical subset, never evaluation or whitespace removal in strings.

    Comments and quoted strings are distinct tokens. Unsupported template literals,
    escapes in identifiers and ambiguous slash syntax refuse. The one regex literal
    in the retained publisher script is recognized only in expression position.
    """
    require(
        isinstance(source, str) and len(source) <= MAX_BYTES,
        "Board script exceeds its bound",
    )
    tokens = []
    at = 0
    while at < len(source):
        char = source[at]
        if char.isspace():
            at += 1
        elif source.startswith("//", at):
            end = re.compile(r"[\r\n\u2028\u2029]").search(source, at + 2)
            at = len(source) if end is None else end.start()
        elif source.startswith("/*", at):
            end = source.find("*/", at + 2)
            require(end >= 0, "Unclosed Board script comment")
            at = end + 2
        elif char in {'"', "'"}:
            start, quote = at, char
            at += 1
            while at < len(source) and source[at] != quote:
                require(
                    source[at] not in "\r\n\u2028\u2029", "Invalid Board script string"
                )
                if source[at] == "\\":
                    at += 1
                    require(
                        at < len(source) and source[at] not in "\r\n\u2028\u2029",
                        "Invalid Board script escape",
                    )
                at += 1
            require(at < len(source), "Unclosed Board script string")
            at += 1
            tokens.append(source[start:at])
        elif char == "/":
            require(
                source.startswith(r"/\+/g", at)
                and tokens
                and tokens[-1] in {"(", "=", ",", ":"},
                "Unsupported Board script slash syntax",
            )
            tokens.append(r"/\+/g")
            at += len(r"/\+/g")
        elif char.isascii() and (char.isalpha() or char in "_$"):
            end = at + 1
            while (
                end < len(source)
                and source[end].isascii()
                and (source[end].isalnum() or source[end] in "_$")
            ):
                end += 1
            tokens.append(source[at:end])
            at = end
        elif char in "0123456789":
            end = at + 1
            while end < len(source) and source[end] in "0123456789":
                end += 1
            tokens.append(source[at:end])
            at = end
        else:
            require(char in "{}()[];:,.=+-*!?<>%&|~", "Unsupported Board script token")
            tokens.append(char)
            at += 1
    stack = []
    for token in tokens:
        if token in {"{", "(", "["}:
            stack.append(token)
        elif token in {"}", ")", "]"}:
            require(
                bool(stack) and stack.pop() == {"}": "{", ")": "(", "]": "["}[token],
                "Unbalanced Board script",
            )
    require(not stack, "Unbalanced Board script")
    return tokens


def _js_object(tokens, at, depth=0):
    require(depth < 4 and tokens[at] == "{", "Unsupported Board configuration object")
    result = {}
    at += 1
    while tokens[at] != "}":
        token = tokens[at]
        key = token[1:-1] if token.startswith('"') else token
        require(
            re.fullmatch(r"[A-Za-z_][A-Za-z0-9_]*", key) is not None
            and key not in result
            and tokens[at + 1] == ":",
            "Ambiguous Board configuration key",
        )
        at += 2
        token = tokens[at]
        if token == "{":
            value, at = _js_object(tokens, at, depth + 1)
        elif token.startswith('"') and "\\" not in token:
            value, at = token[1:-1], at + 1
        else:
            require(
                re.fullmatch(r"0|[1-9][0-9]*", token) is not None,
                "Board configuration is not literal",
            )
            value, at = int(token), at + 1
        result[key] = value
        require(tokens[at] in {",", "}"}, "Board configuration separator differs")
        if tokens[at] == ",":
            at += 1
    return result, at + 1


def _js_declarations(tokens):
    """The retained asset has only named top-level declarations, no execution.

    Validate every declaration boundary, including helper functions, so a computed
    global assignment, call, initializer or conditional cannot override the mapping.
    Function bodies remain tokenized data; the PDF body gets its own closed check.
    """
    declarations = {}
    at = 0
    while at < len(tokens):
        require(
            at + 3 < len(tokens)
            and tokens[at] == "function"
            and re.fullmatch(r"[A-Za-z_$][A-Za-z0-9_$]*", tokens[at + 1]) is not None
            and tokens[at + 1] not in declarations
            and tokens[at + 2] == "(",
            "Board script contains unsupported top-level execution or declaration",
        )
        name = tokens[at + 1]
        at += 3
        parameters = []
        while tokens[at] != ")":
            require(
                re.fullmatch(r"[A-Za-z_$][A-Za-z0-9_$]*", tokens[at]) is not None
                and tokens[at] not in parameters,
                "Unsupported Board function parameter",
            )
            parameters.append(tokens[at])
            at += 1
            require(tokens[at] in {",", ")"}, "Unsupported Board parameter separator")
            if tokens[at] == ",":
                at += 1
                require(tokens[at] != ")", "Unsupported Board trailing parameter")
        at += 1
        require(tokens[at] == "{", "Board function body absent")
        start, depth = at + 1, 1
        at += 1
        while depth:
            depth += tokens[at] == "{"
            depth -= tokens[at] == "}"
            at += 1
        declarations[name] = (parameters, tokens[start : at - 1])
    return declarations


def _pdf_function_tokens(js):
    tokens = _js_tokens(js)
    require(
        sum(_js_named(token, "viewPDF") for token in tokens) == 1,
        "Board PDF function is ambiguous",
    )
    declarations = _js_declarations(tokens)
    require("viewPDF" in declarations, "Board PDF declaration absent")
    parameters, body = declarations["viewPDF"]
    require(
        parameters == ["year", "type", "period", "se", "regnum", "amend"],
        "Unsupported Board PDF declaration",
    )
    return body


def _pdf_mapping(files, context, html, proof):
    definition = _origin(proof, context["definition"])
    script_url = definition["final"]["url"]
    require(
        isinstance(script_url, str)
        and urlsplit(script_url).netloc == "cfb.mn.gov"
        and urlsplit(script_url).path.startswith("/cache/default."),
        "Board PDF mapping source differs",
    )
    scripts = [
        script["attrs"].get("src")
        for script in _HTML(html).scripts
        if _executable_script(script)
    ]
    require(
        sum(
            isinstance(src, str) and urljoin(VIEWER_PREFIX, src) == script_url
            for src in scripts
        )
        == 1,
        "Board viewer does not load retained PDF definition",
    )
    js = _body(files, context["definition"]["source_sha256"]).decode("utf-8")
    body = _pdf_function_tokens(js)
    expected = (
        'var theForm=$("#theForm")[0];theForm.action="https://cfb.mn.gov/rptViewer/Main.php?do=viewPDF";$("input[name=\'downloadpdf\']").val("false");'
        + "".join(
            f"$(\"input[name='{k}']\").val({k});"
            for k in ("year", "type", "period", "se", "regnum", "amend")
        )
        + "submitToPopup(theForm);"
    )
    require(body == _js_tokens(expected), "Unsupported Board PDF form mapping")
    value = _json(files, context["catalogue"]["source_sha256"])
    forms = [
        f for f in _HTML(value["tabcontent"]).forms if f["attrs"].get("id") == "theForm"
    ]
    require(
        len(forms) == 1 and forms[0]["attrs"].get("method", "").lower() == "post",
        "Board PDF form absent",
    )
    inputs = forms[0]["inputs"]
    names = [n.get("name") for n in inputs]
    require(
        len(names) == len(set(names))
        and set(names)
        == {
            "searchType",
            "downloadpdf",
            "year",
            "type",
            "period",
            "se",
            "regnum",
            "amend",
            "disc",
            "date",
            "show",
        }
        and all(n.get("type") == "hidden" for n in inputs),
        "Board PDF form fields differ",
    )
    result = {n["name"]: n.get("value", "") for n in inputs}
    require(
        result["searchType"] == "Candidate"
        and result["show"] == "0"
        and result["disc"] == result["date"] == "",
        "Board PDF form defaults differ",
    )
    result.update(
        downloadpdf="false",
        year=str(context["year"])[2:],
        type="aoc",
        period=context["report_type"],
        se="0",
        regnum=context["record_id"],
        amend=str(context["amendment"]),
    )
    _origin(
        proof,
        context["pdf"],
        method="POST",
        url=PDF_URL,
        form=result,
        media="application/pdf",
    )


@_shape
def replay_context(context, receipt, originals, provenance):
    validate_context_shape(context, receipt)
    html, segment = viewer_config(
        originals, context["viewer"], context["record_id"], context["year"], provenance
    )
    info = information(
        originals,
        context["information"],
        context["record_id"],
        context["year"],
        segment,
        html,
        provenance,
    )
    offered = catalogue(
        originals,
        context["catalogue"],
        context["record_id"],
        context["year"],
        segment,
        html,
        provenance,
    )
    selected = [
        r
        for r in offered["reports"]
        if (r["report_type"], r["amendment"])
        == (context["report_type"], context["amendment"])
    ]
    require(len(selected) == 1, "Board report version is not offered")
    _pdf_mapping(originals, context, html, provenance)
    values = extract_reading(receipt)
    require(
        values["period"]["start"][:4] == str(context["year"])
        and values["period"]["end"][:4] == str(context["year"])
        and selected[0]["cutoff_date"] == values["period"]["end"] + " 00:00:00",
        "Board cover period differs from catalogue",
    )
    require(
        re.fullmatch(
            r"MN\s+"
            + re.escape(info["OfficeSought"])
            + r"\s+DISTRICT\s*"
            + re.escape(info["District"]),
            values["office"],
            re.I,
        )
        is not None,
        "Board cover office differs from information",
    )
    return {
        **values,
        "record_id": context["record_id"],
        "year": context["year"],
        "catalogue": selected[0],
        "source": public_source(context["pdf"], provenance),
        "report_key": digest(context),
        "latest_amendment": max(
            r["amendment"]
            for r in offered["reports"]
            if r["report_type"] == context["report_type"]
        ),
    }


@_shape
def extract_reading(receipt):
    """Deterministic literal projection; caller must supply verified context to publish."""
    fields = {f["field_id"]: f for f in receipt["fields"]}

    def field(key, kind, *, required=False):
        f = fields.get(key)
        if f is None:
            raise ComparisonImportError("Board reading field absent: " + key)
        require(
            f is not None and f["value_type"] == kind,
            "Board reading field absent or wrong type: " + key,
        )
        if required:
            require(
                f["state"] == "value", "Board required cover field is unknown: " + key
            )
        return f

    require(
        re.sub(r"\s+", " ", field("cover.title", "text", required=True)["normalized"])
        == _TITLE,
        "Board personal-expenditure title differs",
    )
    name = field("cover.name", "text", required=True)["normalized"]
    office = field("cover.office", "text", required=True)["normalized"]
    start = field("cover.period_start", "date", required=True)["normalized"]
    end = field("cover.period_end", "date", required=True)["normalized"]
    require(start <= end, "Board cover period is reversed")

    def public(f):
        return {
            k: deepcopy(f[k])
            for k in (
                "field_id",
                "page",
                "bounds",
                "label",
                "literal",
                "state",
                "value_type",
                "normalized",
                "currency",
            )
        }

    measures = {k: public(field("total." + k, "money")) for k in _TOTALS}
    nonitemized = {k: public(field("nonitemized." + k, "money")) for k in _TOTALS}
    rows = []
    row_numbers = sorted(
        {
            f["row"]
            for f in fields.values()
            if f["record_type"] == "disbursement" and f["row"] is not None
        }
    )
    for n in row_numbers:
        optional = {"street", "city", "state", "postal_code"}
        row: dict[str, Any] = {
            k: (
                None
                if k in optional and f"item.{n}.{k}" not in fields
                else public(field(f"item.{n}.{k}", kind))
            )
            for k, kind in (
                ("date", "date"),
                ("payee", "text"),
                ("street", "text"),
                ("city", "text"),
                ("state", "text"),
                ("postal_code", "text"),
                ("purpose", "text"),
                *((k, "money") for k in _TOTALS),
            )
        }
        require(
            all(
                fields[f"item.{n}.{k}"]["row"] == n
                and fields[f"item.{n}.{k}"]["record_type"] == "disbursement"
                for k in row
                if row[k] is not None
            ),
            "Board item row binding differs",
        )
        if row["date"]["state"] == "value":
            require(
                start <= row["date"]["normalized"] <= end,
                "Board item date is outside cover period",
            )
        rows.append({"row": n, "fields": row})
    expected = {
        "cover.title",
        "cover.name",
        "cover.office",
        "cover.period_start",
        "cover.period_end",
        "cover.received_date",
        "cover.certification_date",
        *("total." + k for k in _TOTALS),
        *("nonitemized." + k for k in _TOTALS),
        *(
            f"item.{row['row']}.{k}"
            for row in rows
            for k, value in row["fields"].items()
            if value is not None
        ),
    }
    require(set(fields) == expected, "Board reading has unaccounted or missing fields")
    for key in ("cover.received_date", "cover.certification_date"):
        field(key, "date")
    for f in fields.values():
        if f["value_type"] == "money" and f["state"] == "value":
            require(
                f["currency"] == "USD" and Decimal(f["normalized"]) >= 0,
                "Board reported money is invalid",
            )
    rows = [
        row
        for row in rows
        if not all(f is None or f["state"] == "blank" for f in row["fields"].values())
    ]
    checks = []
    for label, cells in [
        ("total", measures),
        ("nonitemized", nonitemized),
        *((f"item.{r['row']}", r["fields"]) for r in rows),
    ]:
        # Blank is never a numeric zero, so an incomplete component sum is unknown.
        if all(cells[k]["state"] == "value" for k in _TOTALS):
            require(
                sum(Decimal(cells[k]["normalized"]) for k in _TOTALS[:3])
                == Decimal(cells["total"]["normalized"]),
                "Board complete component arithmetic differs",
            )
            checks.append(label)
    for k in _TOTALS:
        cells = [nonitemized[k], *(r["fields"][k] for r in rows)]
        if all(f["state"] == "value" for f in [measures[k], *cells]):
            require(
                sum(Decimal(f["normalized"]) for f in cells)
                == Decimal(measures[k]["normalized"]),
                "Board item/nonitemized total differs",
            )
            checks.append("itemized_plus_nonitemized." + k)
    return {
        "name": name,
        "office": office,
        "period": {"start": start, "end": end},
        "received_date": public(fields["cover.received_date"]),
        "certification_date": public(fields["cover.certification_date"]),
        "measures": measures,
        "nonitemized": nonitemized,
        "items": rows,
        "arithmetic_checks": checks,
        "source_sha256": receipt["original_sha256"],
    }


@_shape
def validate_relationship(receipt):
    p.exact(
        receipt,
        {
            "schema",
            "claim",
            "election_key",
            "snapshot_id",
            "race_id",
            "candidate_id",
            "identity",
            "record_id",
            "year",
            "role",
            "viewer",
            "information",
            "sos",
            "cover_reading_ids",
        },
    )
    require(
        receipt["schema"] == RELATIONSHIP
        and receipt["claim"] == "same_person_as_election_candidate"
        and p.text_value(receipt["election_key"], limit=80)
        and p.fingerprint(receipt["snapshot_id"])
        and p.fingerprint(receipt["race_id"])
        and p.text_value(receipt["candidate_id"], limit=80)
        and _id(receipt["record_id"])
        and _year(receipt["year"])
        and receipt["role"] == "AOC",
        "Unsupported Board relationship claim",
    )
    p.exact(
        receipt["identity"],
        {
            "candidate_source_id",
            "name",
            "party",
            "office_id",
            "office_name",
            "district",
            "jurisdiction",
        },
    )
    for key in ("viewer", "information"):
        _ref(receipt[key])
    p.exact(receipt["sos"], REF_KEYS | {"row", "literal"})
    _ref({k: receipt["sos"][k] for k in REF_KEYS})
    require(
        type(receipt["sos"]["row"]) is int
        and receipt["sos"]["row"] > 0
        and p.text_value(receipt["sos"]["literal"], limit=16000),
        "Board relationship needs the exact SOS row",
    )
    ids = receipt["cover_reading_ids"]
    require(
        isinstance(ids, list)
        and len(ids) <= MAX_REPORTS
        and ids == sorted(set(ids))
        and all(p.fingerprint(i) for i in ids),
        "Invalid Board cover readings",
    )
    return deepcopy(receipt)


def relationship_subject(receipt):
    return digest(
        [
            "board_candidate_relationship",
            receipt["election_key"],
            "mn_cfb:candidate_record",
            receipt["role"],
            receipt["record_id"],
            receipt["year"],
        ]
    )


def relationship_dependencies(receipt):
    return frozenset(
        receipt[k]["acquisition_receipt_id"] for k in ("viewer", "information", "sos")
    )


def relationship_sources(receipt):
    return frozenset(
        receipt[k]["source_sha256"] for k in ("viewer", "information", "sos")
    )


def _snapshot(db, snapshot_id, election_key):
    snapshot = db.get(m.ElectionComparisonSnapshot, snapshot_id)
    require(
        snapshot is not None and snapshot.election_key == election_key,
        "Board section needs its exact retained snapshot/election",
    )
    return snapshot


def replay_relationship(db, receipt, files, proof, reading_context):
    validate_relationship(receipt)
    snapshot = _snapshot(db, receipt["snapshot_id"], receipt["election_key"])
    require(
        snapshot.election_date.year == receipt["year"],
        "Board relationship year differs from election",
    )
    race = db.get(m.ElectionComparisonRace, (snapshot.id, receipt["race_id"]))
    require(race is not None, "Board relationship race is absent")
    from alethical.pipeline.election_account_reviews import (
        _candidate,
        candidate_identity,
    )

    candidate = _candidate(race, receipt["candidate_id"])
    require(
        candidate_identity(race, candidate) == receipt["identity"],
        "Board relationship differs from source candidacy",
    )
    sos = receipt["sos"]
    require(
        race.payload["candidate_source_sha256"] == sos["source_sha256"]
        and any(s.get("sha256") == sos["source_sha256"] for s in snapshot.sources),
        "Board relationship SOS source differs from snapshot",
    )
    source_url = f"https://electionresultsfiles.sos.mn.gov/{snapshot.election_date:%Y%m%d}/cand.txt"
    origin = proof.acquisition(sos["acquisition_receipt_id"])
    require(
        origin["final"]["source_sha256"] == sos["source_sha256"]
        and origin["requested"]["url"] == source_url
        and origin["final"]["url"] in {None, source_url},
        "Board relationship SOS acquisition differs",
    )
    from alethical.pipeline.candidate_catalogue import (
        ElectionContext,
        parse_candidate_catalogue,
        CandidateCatalogueError,
    )

    try:
        parsed = parse_candidate_catalogue(
            _body(files, sos["source_sha256"]),
            election=ElectionContext(
                election_id=race.payload["election_id"],
                election_date=snapshot.election_date,
                election_type=snapshot.stage,
                source_url=source_url,
                source_stage="unverified",
            ),
            fetched_at=snapshot.fetched_at,
        )
    except (CandidateCatalogueError, KeyError) as exc:
        raise ComparisonImportError(
            "Board relationship SOS catalogue is invalid"
        ) from exc
    matches = [
        r
        for r in parsed.candidates
        if r.row_number == sos["row"]
        and r.raw_row == sos["literal"]
        and r.candidate_id == candidate["candidate_id"]
        and r.name == candidate["name"]
        and r.office_id == race.office_id
        and r.party_abbreviation == candidate["party"]
        and r.district_code == race.payload.get("district")
    ]
    require(len(matches) == 1, "Board relationship SOS row is not the bound candidacy")
    html, segment = viewer_config(
        files, receipt["viewer"], receipt["record_id"], receipt["year"], proof
    )
    info = information(
        files,
        receipt["information"],
        receipt["record_id"],
        receipt["year"],
        segment,
        html,
        proof,
    )
    require(
        matches[0].office_kind in {"senate", "house"}
        and info["OfficeSought"].lower() == matches[0].office_kind
        and info["District"].lstrip("0")
        == (matches[0].district_code or "").lstrip("0"),
        "Board record office/district differs from ballot",
    )
    for rid in receipt["cover_reading_ids"]:
        require(
            reading_context is not None
            and reading_context.proof_outcomes.get(rid) is True,
            "Board relationship cover reading is unavailable",
        )
        checked = reading_context.receipt(rid)
        context = checked["source_context"]
        require(
            checked["schema"] == READING_SCHEMA
            and (context["record_id"], context["role"], context["year"])
            == (receipt["record_id"], receipt["role"], receipt["year"])
            and context["information"] == receipt["information"]
            and context["viewer"] == receipt["viewer"],
            "Board relationship cover belongs to another record",
        )
    # The reviewer, not normalized-name equality, makes the explicit same-person claim.
    return receipt


def reading_plan(db, receipt_ids, *, partial=False):
    """Inventory Board readings and acquisition-only dependencies before locks."""
    from alethical.pipeline import election_source_readings as r

    ids = set(receipt_ids)
    require(
        len(ids) <= MAX_RECORDS * 2 and all(p.fingerprint(i) for i in ids),
        "Board reading closure exceeds bounds",
    )
    if not ids:
        return {
            "reading_receipt_ids": [],
            "source_hashes": [],
            "provenance_receipt_ids": [],
            "subject_keys": [],
        }
    hashes, provenance_ids = set(), set()
    found = set()
    for row in r._receipt_rows(db, ids):
        try:
            receipt = r.validate_receipt(row.receipt)
            require(
                receipt["schema"] == READING_SCHEMA
                and r.receipt_digest(receipt) == row.receipt_sha256
                and r.subject_key(receipt) == row.subject_key,
                "Board cover reading integrity differs",
            )
            found.add(row.receipt_sha256)
            hashes.update(r.source_dependencies(receipt))
            provenance_ids.update(r.provenance_ids(receipt))
        except ComparisonImportError:
            if not partial:
                raise
    require(partial or found == ids, "Board reading is not retained")
    plan = p.provenance_requirements(db, provenance_ids, partial=partial)
    # Closed DAG: no reading can cite a relationship, even indirectly.
    rows, _, _ = p._closure(db, provenance_ids, partial=partial, evidence=False)
    require(
        all(
            row["receipt"]["schema"] in {p.ACQUISITION, CAPTURE_SCHEMA}
            for row in rows.values()
        ),
        "Board reading provenance must contain acquisitions only",
    )
    hashes.update(plan["public_original_hashes"])
    return {
        "reading_receipt_ids": sorted(ids),
        "source_hashes": sorted(hashes),
        "provenance_receipt_ids": plan["receipt_ids"],
        "subject_keys": plan["subject_keys"],
    }


def relationship_reading_plan(db, receipts, *, partial=False):
    ids = {
        i
        for receipt in receipts
        if receipt["schema"] == RELATIONSHIP
        for i in receipt["cover_reading_ids"]
    }
    return reading_plan(db, ids, partial=partial)


def load_relationship_readings(db, store, plan, *, allowed, lock=False, partial=False):
    if not plan["reading_receipt_ids"]:
        return None
    require(store is not None, "Board relationship needs its retained reading store")
    from alethical.pipeline.election_source_readings import (
        load_verified_reading_context,
    )

    return load_verified_reading_context(
        db,
        store,
        plan["reading_receipt_ids"],
        allowed_source_hashes=allowed,
        lock=lock,
        partial=partial,
    )


def record_relationship(db, store, **kwargs):
    validate_relationship(kwargs["receipt"])
    return p.record_provenance(db, store, **kwargs)


@_shape
def validate_section(value, *, election_key=None, snapshot_id=None):
    p.exact(value, {"schema", "election_key", "snapshot_id", "records"})
    require(
        value["schema"] == SECTION_SCHEMA
        and p.text_value(value["election_key"], limit=80)
        and p.fingerprint(value["snapshot_id"])
        and (election_key is None or election_key == value["election_key"])
        and (snapshot_id is None or snapshot_id == value["snapshot_id"]),
        "Invalid Board section scope/version",
    )
    records = value["records"]
    require(
        isinstance(records, list) and len(records) <= MAX_RECORDS,
        "Board records exceed bound",
    )
    keys = []
    for record in records:
        p.exact(
            record,
            {
                "record_id",
                "year",
                "role",
                "viewer",
                "information",
                "catalogue",
                "financial",
                "relationship_receipt_id",
                "reports",
            },
        )
        require(
            _id(record["record_id"])
            and _year(record["year"])
            and record["role"] == "AOC",
            "Invalid Board candidate record",
        )
        keys.append((record["record_id"], record["year"]))
        for key in ("viewer", "information", "catalogue"):
            _ref(record[key])
        if record["financial"] is not None:
            _ref(record["financial"])
        require(
            record["relationship_receipt_id"] is None
            or p.fingerprint(record["relationship_receipt_id"]),
            "Invalid Board relationship reference",
        )
        reports = record["reports"]
        require(
            isinstance(reports, list) and len(reports) <= MAX_REPORTS,
            "Board reports exceed bound",
        )
        for report in reports:
            p.exact(report, {"report_key", "reading_receipt_id"})
            require(
                all(p.fingerprint(v) for v in report.values()),
                "Invalid Board report reference",
            )
        report_keys = [r["report_key"] for r in reports]
        require(
            report_keys == sorted(set(report_keys))
            and len({r["reading_receipt_id"] for r in reports}) == len(reports),
            "Duplicate or unordered Board reports",
        )
    require(keys == sorted(set(keys)), "Duplicate or unordered Board records")
    return deepcopy(value)


def section_requirements(db, section, *, partial=False):
    section = validate_section(section)
    provenance_ids, readings, hashes = set(), set(), set()
    for record in section["records"]:
        for key in ("viewer", "information", "catalogue", "financial"):
            if record[key] is not None:
                hashes.add(record[key]["source_sha256"])
                provenance_ids.add(record[key]["acquisition_receipt_id"])
        if record["relationship_receipt_id"]:
            provenance_ids.add(record["relationship_receipt_id"])
        readings.update(r["reading_receipt_id"] for r in record["reports"])
    rows, _, _ = p._closure(db, provenance_ids, partial=partial, evidence=False)
    readings.update(
        i
        for row in rows.values()
        if row["receipt"]["schema"] == RELATIONSHIP
        for i in row["receipt"]["cover_reading_ids"]
    )
    rp = reading_plan(db, readings, partial=partial)
    pp = p.provenance_requirements(
        db, provenance_ids | set(rp["provenance_receipt_ids"]), partial=partial
    )
    return {
        "source_hashes": sorted(
            hashes | set(rp["source_hashes"]) | set(pp["public_original_hashes"])
        ),
        "provenance_receipt_ids": pp["receipt_ids"],
        "reading_receipt_ids": rp["reading_receipt_ids"],
        "subject_keys": sorted(set(pp["subject_keys"]) | set(rp["subject_keys"])),
    }


_SECTION_SEAL = object()


@dataclass(frozen=True)
class VerifiedBoardSection:
    version: str
    records: list
    proof_outcomes: dict
    source_hashes: frozenset
    _seal: object

    def __post_init__(self):
        require(self._seal is _SECTION_SEAL, "Board section must be verified")


def load_verified_section(
    db, store, section, *, allowed_source_hashes, lock=False, partial=False
):
    section = validate_section(section)
    snapshot = _snapshot(db, section["snapshot_id"], section["election_key"])
    require(not (lock and partial), "Board publication cannot use partial proof")
    plan = section_requirements(db, section, partial=partial)
    require(
        set(plan["source_hashes"]) <= set(allowed_source_hashes),
        "Board section source is outside collection",
    )
    if lock:
        p.lock_provenance(db, plan["subject_keys"])
    readings = load_relationship_readings(
        db, store, plan, allowed=allowed_source_hashes, lock=lock, partial=partial
    )
    proof = p.load_verified_provenance(
        db,
        p.source_resolver_for(db, store),
        plan["provenance_receipt_ids"],
        allowed_source_hashes=allowed_source_hashes,
        partial=partial,
        store=store,
    )
    outcomes, records = {}, []
    resolver = p.source_resolver_for(db, store)
    for record in section["records"]:
        key = record["record_id"] + ":" + str(record["year"])
        outcomes[key] = False
        try:
            require(
                record["year"] == snapshot.election_date.year,
                "Board record year differs from snapshot",
            )
            needed = {
                record[k]["source_sha256"]
                for k in ("viewer", "information", "catalogue", "financial")
                if record[k] is not None
            }
            with resolver(needed) as files:
                html, segment = viewer_config(
                    files, record["viewer"], record["record_id"], record["year"], proof
                )
                info = information(
                    files,
                    record["information"],
                    record["record_id"],
                    record["year"],
                    segment,
                    html,
                    proof,
                )
                offered = catalogue(
                    files,
                    record["catalogue"],
                    record["record_id"],
                    record["year"],
                    segment,
                    html,
                    proof,
                )
                financial = None
                if record["financial"] is not None:
                    response = _tab(
                        files,
                        record["financial"],
                        record["record_id"],
                        record["year"],
                        segment,
                        "financial",
                        html,
                        proof,
                    )
                    observed = " ".join(_HTML(response["tabcontent"]).words)
                    expected = " ".join(
                        f"Data not available for {year}"
                        for year in range(
                            segment["ElectionSegmentEndDate"],
                            segment["ElectionSegmentStartDate"] - 1,
                            -1,
                        )
                    )
                    require(
                        set(response) == {"tabcontent"} and observed == expected,
                        "Unsupported Board financial observation",
                    )
                    financial = {
                        "state": "no_data_returned",
                        "literal": observed,
                        **public_source(record["financial"], proof),
                    }
            relationship = None
            if record["relationship_receipt_id"] is not None:
                relation = proof.relationship(record["relationship_receipt_id"])
                require(
                    (
                        relation["record_id"],
                        relation["year"],
                        relation["snapshot_id"],
                        relation["election_key"],
                    )
                    == (
                        record["record_id"],
                        record["year"],
                        section["snapshot_id"],
                        section["election_key"],
                    )
                    and relation["information"] == record["information"]
                    and relation["viewer"] == record["viewer"],
                    "Board relationship differs from section",
                )
                relationship = {
                    k: deepcopy(relation[k])
                    for k in ("race_id", "candidate_id", "identity")
                }
            reports = []
            for ref in record["reports"]:
                rid = ref["reading_receipt_id"]
                require(
                    readings is not None and readings.proof_outcomes.get(rid) is True,
                    "Board report reading is unavailable",
                )
                receipt = readings.receipt(rid)
                context = receipt["source_context"]
                require(
                    digest(context) == ref["report_key"]
                    and (context["record_id"], context["year"])
                    == (record["record_id"], record["year"])
                    and context["information"] == record["information"]
                    and context["viewer"] == record["viewer"]
                    and context["catalogue"] == record["catalogue"],
                    "Board report is outside candidate record",
                )
                values = readings.local_values(rid)
                if relationship is not None:
                    cover_names = {
                        readings.local_values(cover)["name"]
                        for cover in relation["cover_reading_ids"]
                    }
                    require(
                        values["name"] in cover_names,
                        "Board report cover name lacks the reviewed person binding",
                    )
                reports.append(
                    {
                        **values,
                        "reading_receipt_id": rid,
                        "source_context": deepcopy(context),
                    }
                )
            offered_end = max(
                (report["cutoff_date"][:10] for report in offered["reports"]),
                default=None,
            )
            require(
                len(
                    {
                        report["report_type"]
                        for report in offered["reports"]
                        if report["cutoff_date"][:10] == offered_end
                    }
                )
                <= 1,
                "Board latest offered period is ambiguous",
            )
            latest = [
                r
                for r in reports
                if r["catalogue"]["amendment"] == r["latest_amendment"]
                and r["period"]["end"] == offered_end
            ]
            selected = max(
                latest,
                key=lambda r: (
                    r["period"]["end"],
                    r["period"]["start"],
                    r["report_key"],
                ),
                default=None,
            )
            require(
                selected is None
                or sum(r["period"] == selected["period"] for r in latest) == 1,
                "Board effective report is ambiguous",
            )
            records.append(
                {
                    "record_id": record["record_id"],
                    "year": record["year"],
                    "role": "AOC",
                    "information": info,
                    "segment": segment,
                    "availability": offered,
                    "financial": financial,
                    "relationship": relationship,
                    "reports": reports,
                    "selected_report_key": selected["report_key"] if selected else None,
                    "sources": {
                        k: public_source(record[k], proof)
                        for k in ("viewer", "information", "catalogue", "financial")
                    },
                }
            )
            outcomes[key] = True
        except SourceFileLimitError:
            raise
        except (ComparisonImportError, SourceFileError, OSError):
            if not partial:
                raise
            records.append(
                {
                    "record_id": record["record_id"],
                    "year": record["year"],
                    "role": "AOC",
                    "state": "unavailable",
                }
            )
    version = digest(
        {
            "section": section,
            "provenance": proof.version,
            "readings": readings.version if readings else None,
            "outcomes": outcomes,
        }
    )
    return VerifiedBoardSection(
        version, records, outcomes, frozenset(plan["source_hashes"]), _SECTION_SEAL
    )
