"""Private reviewed acquisition facts, separate from public originals and identity.

A hash proves bytes, not their origin. The supported trust act is an explicit,
privileged review of a retained collector record ("reviewed collector
observation"): a fixed parser reproduces every claimed fact from the exact
private evidence bytes and a named reviewer records the decision. Generation
JSON, a hostname or a caller-built object can never mint the sealed proof.

Three acquisition variants stay separate and are never normalized into each
other: a direct capture, actual GET response hops, and a legacy collector
from/to association without status or Location. Absent HTTP status, Location,
Content-Type, method or times stay absent.

Lock order (shared with root's reading review): gather immutable dependency
receipts first, then take sorted ``source-provenance:`` advisory keys before any
``source-reading`` key. Locking reviews and publication run in READ COMMITTED,
because a waited advisory lock cannot refresh a REPEATABLE READ snapshot.
"""

from __future__ import annotations

from collections.abc import Mapping
from contextlib import contextmanager
from copy import deepcopy
from dataclasses import dataclass
from datetime import UTC, datetime
import hashlib
import json
import re
from types import MappingProxyType
from urllib.parse import urljoin, urlsplit
import weakref

from sqlalchemy import Text, cast, func, insert, select, text

from alethical.db import models as m
from alethical.pipeline.election_comparison import ComparisonImportError, digest
from alethical.pipeline.election_source_files import (
    SourceFileError,
    SourceFileLimitError,
    VerifiedSourceFile,
    verified_source_files,
)

ACQUISITION = "retained-acquisition:v1"
RECIPIENT = "local-recipient-root:v1"
SCHEMAS = (ACQUISITION, RECIPIENT)
CAPTURE_KINDS = (
    "direct_capture",
    "response_hops",
    "historical_collector_association",
    "manifest_record",
)
ORIGIN_BASIS = "reviewed_retained_collector_record"
MAX_EVIDENCE = 1024 * 1024
MAX_RECEIPT = 4 * 1024 * 1024
MAX_DIRECT_DEPENDENCIES = 32
MAX_NODES = 256
MAX_PRIVATE_CLOSURE = 16 * 1024 * 1024
MAX_HOPS = 16
MAX_ORIGINAL = 64 * 1024 * 1024
REDIRECT_STATUSES = frozenset({301, 302, 303, 307, 308})
LOCK_PREFIX = "source-provenance:"
_SEAL = object()
_ISSUED: weakref.WeakSet = weakref.WeakSet()


def require(ok, message):
    if not ok:
        raise ComparisonImportError(message)


def fingerprint(value):
    return isinstance(value, str) and re.fullmatch(r"[a-f0-9]{64}", value) is not None


def exact(value, keys, message="Unsupported provenance fields"):
    require(isinstance(value, dict) and set(value) == set(keys), message)


def text_value(value, *, limit=2000, blank=False):
    return (
        isinstance(value, str)
        and len(value) <= limit
        and (blank or bool(value.strip()))
        and "\x00" not in value
    )


def url(value):
    """An exact absolute http(s) URL; literal bytes are kept, never normalized.

    A literal space (U+0020) observed inside the path or query is kept as
    retained; ``wire_url`` gives its deterministic request form. Every other
    control character, a space in scheme or host, and a fragment stay refused.
    """
    require(
        isinstance(value, str)
        and 0 < len(value) <= 2000
        and not any(ord(c) < 32 or ord(c) == 127 for c in value)
        and value == value.strip(" "),
        "Invalid provenance URL",
    )
    raw = urlsplit(value)
    require(" " not in raw.scheme and " " not in raw.netloc, "Invalid provenance URL")
    parsed = urlsplit(value.replace(" ", "%20"))
    try:
        parsed.port
    except ValueError as exc:
        raise ComparisonImportError("Invalid provenance URL") from exc
    require(
        parsed.scheme in {"http", "https"}
        and bool(parsed.hostname)
        and parsed.username is None
        and parsed.password is None
        and not parsed.fragment
        and "#" not in value,
        "Invalid provenance URL",
    )
    return value


def wire_url(value):
    """Deterministic request identity: only a literal space becomes %20."""
    return None if value is None else url(value).replace(" ", "%20")


def timestamp(value):
    require(isinstance(value, str) and len(value) <= 64, "Provenance time is absent")
    try:
        parsed = datetime.fromisoformat(value)
    except ValueError as exc:
        raise ComparisonImportError("Invalid provenance time") from exc
    require(parsed.tzinfo is not None, "Provenance time needs timezone")
    return value


def _object(pairs):
    result = {}
    for key, value in pairs:
        require(key not in result, "Duplicate provenance JSON field")
        result[key] = value
    return result


def _constant(_):
    raise ComparisonImportError("Provenance JSON requires finite values")


def parse_json(body, *, limit=MAX_EVIDENCE):
    """Strict bounded JSON: duplicate fields and non-finite numbers are refused."""
    require(
        isinstance(body, bytes) and 0 < len(body) <= limit,
        "Provenance JSON is absent or exceeds its bound",
    )
    try:
        return json.loads(
            body.decode("utf-8"),
            object_pairs_hook=_object,
            parse_constant=_constant,
        )
    except (UnicodeError, ValueError, RecursionError) as exc:
        if isinstance(exc, ComparisonImportError):
            raise
        raise ComparisonImportError("Invalid bounded provenance JSON") from exc


def _pointer_text(pointer):
    require(
        isinstance(pointer, str)
        and len(pointer) <= 200
        and (not pointer or pointer.startswith("/"))
        and not re.search(r"~(?![01])", pointer),
        "Invalid evidence pointer",
    )
    return pointer


def select_record(value, pointer):
    """JSON Pointer (RFC 6901) to one retained collector record object."""
    current = value
    for token in _pointer_text(pointer).split("/")[1:] if pointer else []:
        token = token.replace("~1", "/").replace("~0", "~")
        if isinstance(current, list):
            require(
                re.fullmatch(r"0|[1-9][0-9]{0,5}", token) is not None
                and int(token) < len(current),
                "Evidence pointer is outside retained record",
            )
            current = current[int(token)]
        else:
            require(
                isinstance(current, dict) and token in current,
                "Evidence pointer is outside retained record",
            )
            current = current[token]
    require(
        isinstance(current, dict), "Evidence locator must select a collector record"
    )
    return current


# --- Fixed collector record parsers -------------------------------------------------


def _header(headers, name):
    require(
        isinstance(headers, dict)
        and len(headers) <= 200
        and all(
            isinstance(k, str) and text_value(v, limit=8000, blank=True)
            for k, v in headers.items()
        ),
        "Invalid retained response headers",
    )
    found = [v for k, v in headers.items() if k.lower() == name.lower()]
    require(len(found) <= 1, "Retained headers repeat " + name)
    return found[0] if found else None


def _int(value, *, low=0, high=MAX_ORIGINAL):
    return type(value) is int and low <= value <= high


def _hop_record(record):
    require(
        record.get("method") == "GET" and "url" not in record,
        "Response-hop record needs its literal GET request",
    )
    requested = url(record.get("requested_url"))
    raw = record["response_hops"]
    require(
        isinstance(raw, list) and 0 < len(raw) <= 2 * MAX_HOPS,
        "Response-hop record needs bounded hops",
    )
    hops = []
    for hop in raw:
        require(isinstance(hop, dict), "Invalid retained response hop")
        keys = [k for k in ("url", "requested_url") if k in hop]
        require(len(keys) == 1, "Response hop needs one literal request URL")
        location = _header(hop.get("headers"), "Location")
        require(
            "prepared_request_url" not in hop
            or hop["prepared_request_url"] == wire_url(hop[keys[0]]),
            "Collector request serialization differs from its literal URL",
        )
        item = {
            "url": url(hop[keys[0]]),
            "method": hop.get("method"),
            "status": hop.get("http_status"),
            "location": location,
            "at": timestamp(hop.get("at")),
            "media": _header(hop["headers"], "Content-Type"),
            "raw": hop,
        }
        require(
            item["method"] in {"GET", "HEAD"}
            and _int(item["status"], low=100, high=599),
            "Response hop lacks an exact method or status",
        )
        if "literal_Location" in hop:
            require(hop["literal_Location"] == location, "Literal Location differs")
        if location is not None:
            require(text_value(location), "Invalid literal Location")
            target = url(urljoin(item["url"], location))
            if "target" in hop:
                require(hop["target"] == target, "Hop target differs from Location")
            item["target"] = target
        else:
            require("target" not in hop, "Hop target lacks a literal Location")
        hops.append(item)
    methods = [h["method"] for h in hops]
    first_get = methods.index("GET") if "GET" in methods else None
    require(
        first_get is not None and "HEAD" not in methods[first_get:],
        "HEAD probes cannot interleave with or replace GET acquisition",
    )
    gets = hops[first_get:]
    require(len(gets) <= MAX_HOPS, "Too many retained GET hops")
    require(gets[0]["url"] == requested, "First GET differs from requested URL")
    observed = []
    for index, hop in enumerate(gets):
        last = index == len(gets) - 1
        if hop["status"] in REDIRECT_STATUSES:
            require(hop["location"] is not None, "Redirect lacks literal Location")
            require(
                last or gets[index + 1]["url"] == hop["target"],
                "Retained GET hops do not form an exact chain",
            )
            observed.append(
                {
                    "from": hop["url"],
                    "to": hop["target"],
                    "method": "GET",
                    "status": hop["status"],
                    "location": hop["location"],
                    "observed_at": hop["at"],
                }
            )
        else:
            require(
                last and hop["status"] == 200,
                "Only a final GET 200 can carry the acquired body",
            )
    final = gets[-1]
    body = None
    if final["status"] == 200:
        require(
            record.get("state") == "captured",
            "Final GET response has no retained captured body",
        )
        size, sha = record.get("bytes"), record.get("sha256")
        require(
            fingerprint(sha)
            and _int(size, low=1)
            and record.get("final_url") == final["url"],
            "Captured body identity is incomplete",
        )
        for key, value in (("sha256", sha), ("bytes", size)):
            require(
                key not in final["raw"] or final["raw"][key] == value,
                "Final hop body identity differs",
            )
        body = {
            "url": final["url"],
            "wire_url": wire_url(final["url"]),
            "source_sha256": sha,
            "byte_size": size,
            "media_type": final["media"],
            "copied_at": timestamp(record.get("finished_at")),
        }
        end = final["url"]
    else:
        require(
            record.get("state") != "captured"
            and record.get("sha256") is None
            and record.get("bytes") is None,
            "A redirect-only record cannot claim a body",
        )
        end = final["target"]
    if "http_status" in record:
        require(record["http_status"] == final["status"], "Record status differs")
    if "final_url" in record:
        require(record["final_url"] == final["url"], "Record final URL differs")
    if "redirects" in record:
        listed = record["redirects"]
        require(
            isinstance(listed, list) and len(listed) == len(observed),
            "Record redirect summary differs from GET hops",
        )
        for summary, hop in zip(listed, observed, strict=True):
            require(
                isinstance(summary, dict)
                and set(summary)
                <= {
                    "from",
                    "to",
                    "http_status",
                    "method",
                    "literal_Location",
                    "headers",
                    "decision",
                }
                and summary.get("from") == hop["from"]
                and summary.get("to") == hop["to"]
                and summary.get("http_status", hop["status"]) == hop["status"]
                and summary.get("method", "GET") == "GET"
                and summary.get("literal_Location", hop["location"]) == hop["location"],
                "Record redirect summary differs from GET hops",
            )
    return {
        "format": "response_hops",
        "requested_url": requested,
        "method": "GET",
        "hops": observed,
        "body": body,
        "end_url": end,
    }


def _attempt_record(record):
    require("url" not in record, "Collector record has two request URLs")
    requested = url(record.get("requested_url"))
    method = record.get("method")
    require(method in {None, "GET"}, "Only retained GET acquisitions are supported")
    require(
        record.get("state") == "captured"
        and fingerprint(record.get("sha256"))
        and _int(record.get("bytes"), low=1)
        and record.get("http_status", 200) == 200,
        "Collector record has no exact captured body",
    )
    final_url = url(record.get("final_url"))
    redirects = record.get("redirects")
    require(
        isinstance(redirects, list) and len(redirects) <= MAX_HOPS,
        "Collector record needs its explicit redirect list",
    )
    hops, position = [], requested
    for hop in redirects:
        require(
            isinstance(hop, dict) and set(hop) == {"from", "to"},
            "Unsupported legacy redirect observation",
        )
        require(url(hop["from"]) == position, "Legacy redirects do not form a chain")
        position = url(hop["to"])
        hops.append({"from": hop["from"], "to": hop["to"]})
    require(position == final_url, "Final URL is outside the observed chain")
    media = record.get("content_type")
    require(
        media is None or text_value(media, limit=256), "Invalid captured media type"
    )
    return {
        "format": "collector_attempt",
        "requested_url": requested,
        "method": method,
        "hops": hops,
        "body": {
            "url": final_url,
            "wire_url": wire_url(final_url),
            "source_sha256": record["sha256"],
            "byte_size": record["bytes"],
            "media_type": media,
            "copied_at": timestamp(record.get("fetched_at")),
        },
        "end_url": final_url,
    }


def _route_record(record):
    requested = url(record.get("url"))
    require(
        record.get("status") == 200
        and record.get("hit_safety_byte_limit") is False
        and fingerprint(record.get("sha256"))
        and _int(record.get("bytes"), low=1)
        and record.get("final_url") == requested
        and "redirects" not in record
        and "method" not in record,
        "Route check record has no exact unredirected captured body",
    )
    return {
        "format": "route_check",
        "requested_url": requested,
        "method": None,
        "hops": [],
        "body": {
            "url": requested,
            "wire_url": wire_url(requested),
            "source_sha256": record["sha256"],
            "byte_size": record["bytes"],
            "media_type": None,
            "copied_at": timestamp(record.get("checked_at")),
        },
        "end_url": requested,
    }


MANIFEST_KEYS = frozenset(
    {"url", "bytes", "sha256", "fetched_at", "last_modified", "content_type"}
)


def _manifest_record(record):
    """A file manifest row: request URL, bytes, hash and time only.

    It records no final URL, redirects, status or method, so those stay
    unknown (final URL null) rather than being assumed equal to the request.
    """
    require(
        {"url", "bytes", "sha256", "fetched_at"} <= set(record) <= MANIFEST_KEYS,
        "Unsupported manifest record fields",
    )
    requested = url(record["url"])
    media = record.get("content_type")
    require(
        fingerprint(record["sha256"])
        and _int(record["bytes"], low=1)
        and (media is None or text_value(media, limit=256))
        and (
            record.get("last_modified") is None
            or text_value(record["last_modified"], limit=200)
        ),
        "Manifest record has no exact retained body identity",
    )
    return {
        "format": "manifest_record",
        "requested_url": requested,
        "method": None,
        "hops": [],
        "body": {
            "url": None,
            "wire_url": None,
            "source_sha256": record["sha256"],
            "byte_size": record["bytes"],
            "media_type": media,
            "copied_at": timestamp(record["fetched_at"]),
        },
        "end_url": None,
    }


def observe_record(record):
    """Return only facts one of the four fixed collector formats actually holds."""
    require(isinstance(record, dict), "Collector record must be an object")
    if "response_hops" in record:
        return _hop_record(record)
    if "requested_url" in record and "fetched_at" in record:
        return _attempt_record(record)
    if "url" in record and "checked_at" in record:
        return _route_record(record)
    if "url" in record and "fetched_at" in record:
        return _manifest_record(record)
    raise ComparisonImportError("Unsupported retained collector record format")


def _capture_kind(observed):
    if observed["format"] == "manifest_record":
        return "manifest_record"
    if not observed["hops"]:
        return "direct_capture"
    if observed["format"] == "response_hops":
        return "response_hops"
    return "historical_collector_association"


def prepare_acquisition(evidence_body, pointer="", *, body_capture=None):
    """Propose a receipt from exact evidence; a proposal is never approval.

    ``body_capture`` is the separately captured direct receipt for a redirect-only
    record. Only facts the fixed parser reads are copied; nothing is filled in.
    """
    require(
        isinstance(evidence_body, bytes) and 0 < len(evidence_body) <= MAX_EVIDENCE,
        "Acquisition evidence is absent or exceeds its bound",
    )
    observed = observe_record(select_record(parse_json(evidence_body), pointer))
    kind = _capture_kind(observed)
    if observed["body"] is None:
        require(body_capture is not None, "Redirect-only record needs a body capture")
        body = validate_receipt(body_capture)
        require(body["schema"] == ACQUISITION, "Body capture must be an acquisition")
        final, ref = deepcopy(body["final"]), digest(body)
    else:
        require(body_capture is None, "Captured record cannot cite another body")
        final, ref = observed["body"], None
    return validate_receipt(
        {
            "schema": ACQUISITION,
            "capture_kind": kind,
            "evidence_sha256": hashlib.sha256(evidence_body).hexdigest(),
            "evidence_locator": {"kind": "json_record", "pointer": pointer},
            "requested": {
                "method": observed["method"],
                "url": observed["requested_url"],
                "wire_url": wire_url(observed["requested_url"]),
            },
            "final": final,
            "observed_hops": observed["hops"],
            "origin_basis": ORIGIN_BASIS,
            "body_capture_receipt_id": ref,
        }
    )


# --- Receipt shapes -----------------------------------------------------------------


def _validate_hops(kind, hops, requested, final_url):
    require(
        isinstance(hops, list) and len(hops) <= MAX_HOPS,
        "Acquisition hops need a bounded list",
    )
    position = requested
    for hop in hops:
        if kind == "response_hops":
            exact(
                hop,
                {"from", "to", "method", "status", "location", "observed_at"},
                "Response hops need their exact observed fields",
            )
            require(
                hop["method"] == "GET"
                and type(hop["status"]) is int
                and hop["status"] in REDIRECT_STATUSES
                and text_value(hop["location"]),
                "Invalid observed response hop",
            )
            timestamp(hop["observed_at"])
            require(
                urljoin(hop["from"], hop["location"]) == hop["to"],
                "Literal Location differs from target",
            )
        else:
            exact(
                hop,
                {"from", "to"},
                "A collector association cannot invent status or Location",
            )
        require(url(hop["from"]) == position, "Acquisition hops do not form a chain")
        position = url(hop["to"])
    require(
        (kind in {"direct_capture", "manifest_record"}) == (not hops),
        "Acquisition variant conflicts with observed hops",
    )
    if kind == "manifest_record":
        require(final_url is None, "A manifest record cannot assert a final URL")
    else:
        require(position == final_url, "Final URL is outside the observed chain")


def _validate_acquisition(receipt):
    exact(
        receipt,
        {
            "schema",
            "capture_kind",
            "evidence_sha256",
            "evidence_locator",
            "requested",
            "final",
            "observed_hops",
            "origin_basis",
            "body_capture_receipt_id",
        },
    )
    require(receipt["capture_kind"] in CAPTURE_KINDS, "Unsupported acquisition variant")
    require(
        receipt["origin_basis"] == ORIGIN_BASIS
        and fingerprint(receipt["evidence_sha256"]),
        "Acquisition requires explicit reviewed collector evidence",
    )
    exact(receipt["evidence_locator"], {"kind", "pointer"})
    require(
        receipt["evidence_locator"]["kind"] == "json_record",
        "Unsupported evidence locator",
    )
    _pointer_text(receipt["evidence_locator"]["pointer"])
    exact(receipt["requested"], {"method", "url", "wire_url"})
    require(
        receipt["requested"]["method"] in {"GET", None},
        "Only retained GET acquisitions are supported",
    )
    require(
        receipt["capture_kind"] != "response_hops"
        or receipt["requested"]["method"] == "GET",
        "Response hops need a literal GET request",
    )
    require(
        receipt["requested"]["wire_url"] == wire_url(receipt["requested"]["url"]),
        "Request wire identity differs from its literal URL",
    )
    exact(
        receipt["final"],
        {"url", "wire_url", "source_sha256", "byte_size", "media_type", "copied_at"},
    )
    final = receipt["final"]
    manifest = receipt["capture_kind"] == "manifest_record"
    require(
        (final["url"] is None) == manifest
        and final["wire_url"] == wire_url(final["url"])
        and (not manifest or receipt["requested"]["method"] is None),
        "Final URL identity differs from its capture variant",
    )
    timestamp(final["copied_at"])
    require(
        fingerprint(final["source_sha256"]) and _int(final["byte_size"], low=1),
        "Invalid captured original identity",
    )
    require(
        final["media_type"] is None or text_value(final["media_type"], limit=256),
        "Invalid captured media type",
    )
    _validate_hops(
        receipt["capture_kind"],
        receipt["observed_hops"],
        receipt["requested"]["url"],
        final["url"],
    )
    ref = receipt["body_capture_receipt_id"]
    require(
        ref is None
        or (fingerprint(ref) and receipt["capture_kind"] == "response_hops"),
        "Only a redirect-only response record may cite a separate body capture",
    )


def validate_receipt(receipt):
    """Closed provenance schemas; returns a private deep copy."""
    require(isinstance(receipt, dict), "Provenance receipt must be an object")
    try:
        size = len(
            json.dumps(receipt, ensure_ascii=False, allow_nan=False).encode("utf-8")
        )
    except (TypeError, ValueError, RecursionError) as exc:
        raise ComparisonImportError("Invalid provenance receipt values") from exc
    require(size <= MAX_RECEIPT, "Provenance receipt exceeds bound")
    if receipt.get("schema") == ACQUISITION:
        _validate_acquisition(receipt)
    elif receipt.get("schema") == RECIPIENT:
        from alethical.pipeline.election_local_context import validate_root_receipt

        validate_root_receipt(receipt)
    else:
        raise ComparisonImportError("Unsupported provenance schema")
    return deepcopy(receipt)


def receipt_id(receipt):
    return digest(validate_receipt(receipt))


def primary_source(receipt):
    if receipt["schema"] == ACQUISITION:
        return receipt["final"]["source_sha256"]
    return receipt["directory"]["source_sha256"]


def dependencies(receipt):
    """Direct immutable provenance receipts this receipt cites."""
    if receipt["schema"] == ACQUISITION:
        ref = receipt["body_capture_receipt_id"]
        return frozenset({ref} if ref else set())
    return frozenset(
        {
            receipt["directory"]["acquisition_receipt_id"],
            *(row["acquisition_receipt_id"] for row in receipt["sos_rows"]),
        }
    )


def source_hashes(receipt):
    """Public retained originals a receipt's replay reads."""
    if receipt["schema"] == ACQUISITION:
        return frozenset({primary_source(receipt)})
    return frozenset(
        {primary_source(receipt), *(r["source_sha256"] for r in receipt["sos_rows"])}
    )


def subject_key(receipt):
    if receipt["schema"] == ACQUISITION:
        return digest(
            [ACQUISITION, receipt["evidence_sha256"], receipt["evidence_locator"]]
        )
    return digest(
        [
            RECIPIENT,
            receipt["recipient"],
            receipt["publisher_namespace"],
            receipt["claim_scope"],
        ]
    )


# --- Sealed runtime proof -----------------------------------------------------------


def _source(files, h):
    require(isinstance(files, Mapping), "Source resolver must return verified files")
    value = files.get(h)
    require(
        type(value) is VerifiedSourceFile and value.content_hash == h,
        "Provenance needs fresh sealed source files",
    )
    return value


def read_original(files, h, *, limit):
    """Bounded exact bytes of one freshly verified original, rehashed after read."""
    original = _source(files, h)
    require(original.byte_size <= limit, "Original exceeds this bounded parser")
    with original.open() as handle:
        body = handle.read(limit + 1)
    require(
        len(body) == original.byte_size and hashlib.sha256(body).hexdigest() == h,
        "Verified original bytes changed",
    )
    return body


def replay_acquisition(receipt, evidence_body, files, proofs):
    """Reproduce every claimed acquisition fact from the exact private record."""
    issued(proofs)
    receipt = validate_receipt(receipt)
    require(receipt["schema"] == ACQUISITION, "Acquisition schema required")
    require(
        isinstance(evidence_body, bytes)
        and 0 < len(evidence_body) <= MAX_EVIDENCE
        and hashlib.sha256(evidence_body).hexdigest() == receipt["evidence_sha256"],
        "Private acquisition evidence changed",
    )
    record = select_record(
        parse_json(evidence_body), receipt["evidence_locator"]["pointer"]
    )
    observed = observe_record(record)
    require(
        observed["requested_url"] == receipt["requested"]["url"]
        and observed["method"] == receipt["requested"]["method"],
        "Acquisition request differs from retained observation",
    )
    require(
        observed["hops"] == receipt["observed_hops"],
        "Redirect claim differs from retained observation",
    )
    require(
        receipt["capture_kind"] == _capture_kind(observed),
        "Acquisition variant differs from retained observation",
    )
    final, ref = receipt["final"], receipt["body_capture_receipt_id"]
    if observed["body"] is not None:
        require(ref is None, "Captured record cannot cite another body capture")
        require(observed["body"] == final, "Body identity differs from capture")
    else:
        require(ref is not None, "Redirect-only record needs a checked body capture")
        body = proofs.acquisition(ref)
        require(
            body["capture_kind"] == "direct_capture"
            and body["requested"]["url"] == observed["end_url"]
            and body["final"] == final,
            "Separate body capture is not the exact observed target",
        )
    require(final["url"] == observed["end_url"], "Final URL differs from observation")
    source = _source(files, final["source_sha256"])
    require(
        source.byte_size == final["byte_size"],
        "Captured body size differs from retained original",
    )
    return receipt


def issued(value):
    require(
        type(value) is VerifiedProvenanceContext and value in _ISSUED,
        "Provenance needs a context issued by the verifier",
    )
    return value


class VerifiedProvenanceContext:
    """Private scoped proof. Never serialized; never holds evidence or reviewers."""

    __slots__ = (
        "_receipts",
        "_heads",
        "_outcomes",
        "_reasons",
        "public_original_hashes",
        "version",
        "__weakref__",
    )

    def __init__(self, receipts, heads, outcomes, reasons, originals, *, _seal=None):
        require(_seal is _SEAL, "Provenance proof requires internal verification")
        self._receipts = MappingProxyType(
            {k: MappingProxyType({"value": deepcopy(v)}) for k, v in receipts.items()}
        )
        self._heads = MappingProxyType(deepcopy(heads))
        self._outcomes = MappingProxyType(dict(outcomes))
        self._reasons = MappingProxyType(dict(reasons))
        self.public_original_hashes = frozenset(originals)
        self.version = digest(
            {
                "heads": {
                    k: None
                    if v is None
                    else {
                        "decision_id": v["decision_id"],
                        "receipt_sha256": v["receipt_sha256"],
                        "decision": v["decision"],
                    }
                    for k, v in sorted(heads.items())
                },
                "proof_outcomes": dict(sorted(outcomes.items())),
            }
        )
        _ISSUED.add(self)

    def __reduce__(self):
        raise TypeError("Provenance proof cannot be serialized")

    def __copy__(self):
        raise TypeError("Provenance proof cannot be copied")

    def __deepcopy__(self, memo):
        raise TypeError("Provenance proof cannot be copied")

    def __repr__(self):
        return f"<VerifiedProvenanceContext {len(self._outcomes)} receipts>"

    @property
    def heads(self):
        return deepcopy(dict(self._heads))

    @property
    def proof_outcomes(self):
        return self._outcomes

    @property
    def failure_reasons(self):
        return self._reasons

    def receipt(self, receipt_id_):
        require(
            self._outcomes.get(receipt_id_) is True and receipt_id_ in self._receipts,
            "Provenance is outside this checked scope",
        )
        return deepcopy(self._receipts[receipt_id_]["value"])

    def acquisition(self, receipt_id_):
        value = self.receipt(receipt_id_)
        require(value["schema"] == ACQUISITION, "Acquisition proof required")
        return value

    def recipient(self, receipt_id_):
        value = self.receipt(receipt_id_)
        require(value["schema"] == RECIPIENT, "Recipient-root proof required")
        return value


def _context(receipts, heads, outcomes, reasons, originals):
    return VerifiedProvenanceContext(
        receipts, heads, outcomes, reasons, originals, _seal=_SEAL
    )


# --- Database reads -----------------------------------------------------------------


def _ids(values):
    require(
        isinstance(values, (list, tuple, set, frozenset))
        and len(values) <= MAX_NODES
        and all(fingerprint(x) for x in values),
        "Provenance lookup needs bounded exact receipt hashes",
    )
    return set(values)


def _batches(values, size=200):
    values = sorted(values)
    for start in range(0, len(values), size):
        yield values[start : start + size]


def require_read_committed(db):
    """A waited advisory lock cannot refresh a Repeatable Read snapshot."""
    require(
        db.connection().get_isolation_level() == "READ COMMITTED",
        "Provenance review and locked proof require READ COMMITTED isolation",
    )


def provenance_heads(db, receipt_ids):
    """Current head per receipt's subject, from selected columns only."""
    ids = _ids(receipt_ids)
    model = m.ElectionSourceProvenanceDecision
    known = {}
    for batch in _batches(ids):
        for receipt_sha, subject in db.execute(
            select(model.receipt_sha256, model.subject_key)
            .where(model.receipt_sha256.in_(batch))
            .distinct()
        ):
            require(
                known.get(receipt_sha, subject) == subject,
                "Stored provenance receipt has two subjects",
            )
            known[receipt_sha] = subject
    latest = {}
    for batch in _batches(set(known.values())):
        for row in db.execute(
            select(model.id, model.subject_key, model.receipt_sha256, model.decision)
            .where(model.subject_key.in_(batch))
            .distinct(model.subject_key)
            .order_by(model.subject_key, model.id.desc())
        ):
            latest[row.subject_key] = row
    return {
        h: (
            {
                "subject_key": known[h],
                "decision_id": latest[known[h]].id,
                "receipt_sha256": latest[known[h]].receipt_sha256,
                "decision": latest[known[h]].decision,
            }
            if h in known
            else None
        )
        for h in ids
    }


def _metadata(db, pending):
    model = m.ElectionSourceProvenanceDecision
    rows = {}
    for batch in _batches(pending):
        for row in db.execute(
            select(
                model.id,
                model.receipt_sha256,
                func.octet_length(cast(model.receipt, Text)).label("receipt_bytes"),
                func.coalesce(func.octet_length(model.evidence_body), 0).label(
                    "evidence_bytes"
                ),
            )
            .where(model.receipt_sha256.in_(batch))
            .distinct(model.receipt_sha256)
            .order_by(model.receipt_sha256, model.id)
        ):
            rows[row.receipt_sha256] = row
    return rows


def _closure(db, receipt_ids, *, partial, evidence):
    """Bounded immutable dependency closure, earliest occurrence per receipt.

    Metadata and sizes are read before any receipt or private evidence body.
    Selected columns avoid an older ORM identity map. Never scans all history.
    """
    model = m.ElectionSourceProvenanceDecision
    rows, invalid, reasons = {}, set(), {}
    pending = _ids(receipt_ids)
    total = 0
    while pending:
        require(
            len(rows) + len(invalid) + len(pending) <= MAX_NODES,
            "Provenance closure exceeds bounds",
        )
        metadata = _metadata(db, pending)
        for missing in pending - set(metadata):
            require(partial, "Provenance receipt is not retained")
            invalid.add(missing)
            reasons[missing] = "missing"
        for meta in metadata.values():
            require(
                meta.receipt_bytes <= 2 * MAX_RECEIPT
                and meta.evidence_bytes <= MAX_EVIDENCE,
                "Stored provenance exceeds bounds",
            )
            total += meta.receipt_bytes + (meta.evidence_bytes if evidence else 0)
        require(total <= MAX_PRIVATE_CLOSURE, "Provenance closure exceeds bounds")
        columns = [
            model.id,
            model.subject_key,
            model.schema_id,
            model.receipt_sha256,
            model.primary_source_sha256,
            model.receipt,
            model.evidence_sha256,
        ]
        if evidence:
            columns.append(model.evidence_body)
        fetched = []
        for batch in _batches([r.id for r in metadata.values()]):
            fetched.extend(db.execute(select(*columns).where(model.id.in_(batch))))
        for row in fetched:
            try:
                receipt = validate_receipt(row.receipt)
                require(
                    digest(receipt) == row.receipt_sha256
                    and subject_key(receipt) == row.subject_key
                    and primary_source(receipt) == row.primary_source_sha256
                    and receipt["schema"] == row.schema_id
                    and len(dependencies(receipt)) <= MAX_DIRECT_DEPENDENCIES,
                    "Stored provenance integrity differs",
                )
                if receipt["schema"] == ACQUISITION:
                    require(
                        row.evidence_sha256 == receipt["evidence_sha256"],
                        "Stored private provenance evidence differs",
                    )
                    if evidence:
                        require(
                            isinstance(row.evidence_body, bytes)
                            and hashlib.sha256(row.evidence_body).hexdigest()
                            == row.evidence_sha256,
                            "Stored private provenance evidence differs",
                        )
                else:
                    require(
                        row.evidence_sha256 is None
                        and (not evidence or row.evidence_body is None),
                        "Recipient root cannot hold capture bytes",
                    )
                rows[row.receipt_sha256] = {
                    "id": row.id,
                    "subject_key": row.subject_key,
                    "receipt": receipt,
                    "evidence": bytes(row.evidence_body)
                    if evidence and row.evidence_body is not None
                    else None,
                }
            except ComparisonImportError:
                if not partial:
                    raise
                invalid.add(row.receipt_sha256)
                reasons[row.receipt_sha256] = "invalid"
        pending = (
            {d for row in rows.values() for d in dependencies(row["receipt"])}
            - set(rows)
            - invalid
        )
    return rows, invalid, reasons


def provenance_requirements(db, receipt_ids, *, partial=False):
    """Private closure inventory before file proof and version construction.

    Returns closure receipt IDs, the public originals they read, and current
    heads. Never loads private evidence bytes or reviewer metadata.
    """
    rows, invalid, reasons = _closure(db, receipt_ids, partial=partial, evidence=False)
    closure = set(rows) | invalid
    return {
        "receipt_ids": sorted(closure),
        "subject_keys": sorted({r["subject_key"] for r in rows.values()}),
        "public_original_hashes": sorted(
            {h for r in rows.values() for h in source_hashes(r["receipt"])}
        ),
        "heads": provenance_heads(db, closure),
        "gaps": dict(sorted(reasons.items())),
    }


def lock_provenance(db, subject_keys, *, exclusive=None):
    """Take sorted transaction locks before any source-reading lock."""
    require_read_committed(db)
    keys = set(subject_keys)
    require(
        all(fingerprint(k) for k in keys)
        and (exclusive is None or fingerprint(exclusive))
        and len(keys) <= MAX_NODES,
        "Provenance lock keys must be exact subjects",
    )
    if exclusive:
        keys.add(exclusive)
    for key in sorted(keys):
        fn = (
            "pg_advisory_xact_lock"
            if key == exclusive
            else "pg_advisory_xact_lock_shared"
        )
        db.execute(text(f"SELECT {fn}(hashtext(:key))"), {"key": LOCK_PREFIX + key})


def source_resolver_for(db, store):
    """Request-scoped resolver: each call proves exact bytes afresh.

    The returned callable yields a context manager of VerifiedSourceFile objects
    for exactly the requested retained originals; nothing survives the call.
    """

    @contextmanager
    def resolve(hashes):
        hashes = set(hashes)
        require(
            0 < len(hashes) <= MAX_NODES and all(fingerprint(h) for h in hashes),
            "Source request needs exact original hashes",
        )
        model = m.ElectionResultSource
        rows = [
            dict(row._mapping, media_type=None)
            for row in db.execute(
                select(
                    model.content_hash,
                    model.object_key,
                    model.byte_size,
                    model.compressed_hash,
                    model.compressed_byte_size,
                    model.compression,
                ).where(model.content_hash.in_(sorted(hashes)))
            )
        ]
        require(
            {r["content_hash"] for r in rows} == hashes,
            "Provenance original is not retained",
        )
        with verified_source_files(store, rows) as files:
            yield files

    return resolve


def _prove(receipt_id_, row, heads, outcomes, rows, allowed, resolver, proof):
    receipt = row["receipt"]
    head = heads.get(receipt_id_)
    require(
        head is not None
        and head["decision"] == "checked"
        and head["receipt_sha256"] == receipt_id_,
        "Provenance is not the current checked receipt",
    )
    for dep in dependencies(receipt):
        require(
            outcomes.get(dep) is True and rows[dep]["id"] < row["id"],
            "Provenance dependency is unchecked or not earlier",
        )
    needed = source_hashes(receipt)
    require(needed <= allowed, "Provenance original is outside this generation")
    with resolver(needed) as files:
        for h in needed:
            _source(files, h)
        if receipt["schema"] == ACQUISITION:
            replay_acquisition(receipt, row["evidence"], files, proof)
        else:
            from alethical.pipeline.election_local_context import replay_root

            replay_root(receipt, files, proof)
    return needed


def _verify(db, resolver, wanted, *, allowed, partial, locked):
    rows, invalid, reasons = _closure(db, wanted, partial=partial, evidence=True)
    if locked:
        lock_provenance(db, {r["subject_key"] for r in rows.values()})
    # Heads are read after any lock so a committed correction is visible.
    heads = provenance_heads(db, set(rows) | invalid)
    outcomes = {h: False for h in invalid}
    receipts, originals = {}, set()
    unresolved = set(rows)
    while unresolved:
        ready = sorted(
            h for h in unresolved if not dependencies(rows[h]["receipt"]) & unresolved
        )
        if not ready:
            require(partial, "Cyclic provenance dependency")
            for h in unresolved:
                outcomes[h], reasons[h] = False, "cycle"
            break
        for h in ready:
            unresolved.remove(h)
            failed = [
                d for d in dependencies(rows[h]["receipt"]) if not outcomes.get(d)
            ]
            if failed:
                require(partial, "Provenance dependency failed")
                outcomes[h], reasons[h] = False, "dependency"
                continue
            proof = _context(receipts, heads, outcomes, {}, originals)
            try:
                needed = _prove(
                    h, rows[h], heads, outcomes, rows, allowed, resolver, proof
                )
            except SourceFileLimitError:
                # Temporary process capacity, never source loss or a proof result.
                raise
            except (ComparisonImportError, SourceFileError, OSError) as exc:
                if not partial:
                    raise ComparisonImportError(
                        "Provenance proof failed: " + str(exc)
                    ) from exc
                outcomes[h] = False
                reasons[h] = (
                    "source_unavailable"
                    if isinstance(exc, (SourceFileError, OSError))
                    else "not_current"
                    if heads.get(h) is None
                    or heads[h]["receipt_sha256"] != h
                    or heads[h]["decision"] != "checked"
                    else "replay_failed"
                )
                continue
            receipts[h] = rows[h]["receipt"]
            outcomes[h] = True
            originals.update(needed)
    require(partial or all(outcomes.values()), "Provenance proof failed")
    return _context(receipts, heads, outcomes, reasons, originals)


def load_verified_provenance(
    db,
    source_resolver,
    receipt_ids,
    *,
    allowed_source_hashes,
    lock=False,
    partial=False,
):
    """Fresh proof of exact receipts and their closure.

    ``source_resolver(hashes)`` returns a context manager yielding a mapping of
    freshly verified files for exactly those hashes (see source_resolver_for).
    ``lock=True`` (stage/publication) needs READ COMMITTED and strict results;
    ordinary pinned reads may use REPEATABLE READ and ``partial=True``, where a
    bad dependency fails only its dependents. SourceFileLimitError always
    propagates as temporary capacity, never as a proof outcome.
    """
    require(not (lock and partial), "Publication cannot accept partial provenance")
    if lock:
        require_read_committed(db)
    wanted = _ids(receipt_ids)
    require(
        isinstance(allowed_source_hashes, (list, tuple, set, frozenset))
        and all(fingerprint(h) for h in allowed_source_hashes),
        "Invalid allowed original hashes",
    )
    require(callable(source_resolver), "Provenance needs a request source resolver")
    return _verify(
        db,
        source_resolver,
        wanted,
        allowed=frozenset(allowed_source_hashes),
        partial=partial,
        locked=lock,
    )


# --- Review writes ------------------------------------------------------------------


@dataclass(frozen=True)
class ProvenanceDecision:
    id: int
    subject_key: str
    receipt_sha256: str
    decision: str
    previous_decision_id: int | None
    created: bool


def _decision(row, created):
    return ProvenanceDecision(
        row.id,
        row.subject_key,
        row.receipt_sha256,
        row.decision,
        row.previous_decision_id,
        created,
    )


def record_provenance(
    db,
    store,
    *,
    receipt,
    evidence_body=None,
    decision,
    reviewed_by,
    reason,
    expected_previous_id,
):
    """Append one privileged reviewed provenance decision (checked/withdrawn).

    Checked decisions replay the exact private evidence and fresh public
    originals before any idempotent retry returns. Withdrawal preserves the
    exact preceding receipt and evidence and needs no readable source.
    """
    receipt = validate_receipt(receipt)
    require_read_committed(db)
    require(
        decision in {"checked", "withdrawn"}
        and text_value(reviewed_by, limit=500)
        and text_value(reason, limit=8000),
        "Provenance needs explicit private review",
    )
    require(
        expected_previous_id is None
        or (type(expected_previous_id) is int and expected_previous_id > 0),
        "Invalid provenance predecessor",
    )
    model = m.ElectionSourceProvenanceDecision
    key, content = subject_key(receipt), digest(receipt)
    require(content not in dependencies(receipt), "Provenance cannot cite itself")
    if receipt["schema"] == ACQUISITION:
        require(
            evidence_body is None
            or (
                isinstance(evidence_body, bytes)
                and 0 < len(evidence_body) <= MAX_EVIDENCE
                and hashlib.sha256(evidence_body).hexdigest()
                == receipt["evidence_sha256"]
            ),
            "Acquisition evidence is unavailable or changed",
        )
        require(
            decision == "withdrawn" or evidence_body is not None,
            "Checked acquisition needs its exact private evidence bytes",
        )
    else:
        require(evidence_body is None, "Recipient root cannot store capture bytes")
    request_key = digest(
        {
            "subject_key": key,
            "receipt_sha256": content,
            "decision": decision,
            "reviewed_by": reviewed_by,
            "reason": reason,
            "expected_previous_id": expected_previous_id,
        }
    )
    deps = dependencies(receipt)
    dep_rows = (
        _closure(db, deps, partial=False, evidence=False)[0]
        if deps and decision == "checked"
        else {}
    )
    lock_provenance(db, {r["subject_key"] for r in dep_rows.values()}, exclusive=key)
    columns = (
        model.id,
        model.subject_key,
        model.receipt_sha256,
        model.decision,
        model.previous_decision_id,
    )
    if decision == "checked":
        needed = set(source_hashes(receipt)) | {
            h for r in dep_rows.values() for h in source_hashes(r["receipt"])
        }
        resolver = source_resolver_for(db, store)
        proof = (
            _verify(
                db,
                resolver,
                deps,
                allowed=frozenset(needed),
                partial=False,
                locked=False,
            )
            if deps
            else _context({}, {}, {}, {}, set())
        )
        with resolver(source_hashes(receipt)) as files:
            if receipt["schema"] == ACQUISITION:
                replay_acquisition(receipt, evidence_body, files, proof)
            else:
                from alethical.pipeline.election_local_context import replay_root

                replay_root(receipt, files, proof)
    retry = db.execute(select(*columns).where(model.request_key == request_key)).first()
    if retry is not None:
        require(
            retry.subject_key == key
            and retry.receipt_sha256 == content
            and retry.decision == decision,
            "Provenance request key collision",
        )
        return _decision(retry, False)
    previous = db.execute(
        select(*columns, model.receipt, model.evidence_body)
        .where(model.subject_key == key)
        .order_by(model.id.desc())
        .limit(1)
    ).first()
    require(
        (previous.id if previous else None) == expected_previous_id,
        "Provenance review changed",
    )
    if decision == "withdrawn":
        require(
            previous is not None
            and previous.decision == "checked"
            and previous.receipt_sha256 == content
            and previous.receipt == receipt
            and (
                evidence_body is None or bytes(previous.evidence_body) == evidence_body
            ),
            "Withdrawal requires the exact current checked provenance",
        )
        evidence_body = (
            bytes(previous.evidence_body)
            if previous.evidence_body is not None
            else None
        )
    inserted = db.execute(
        insert(model)
        .values(
            subject_key=key,
            schema_id=receipt["schema"],
            receipt_sha256=content,
            request_key=request_key,
            previous_decision_id=expected_previous_id,
            primary_source_sha256=primary_source(receipt),
            decision=decision,
            receipt=receipt,
            evidence_sha256=receipt.get("evidence_sha256"),
            evidence_body=evidence_body,
            reviewed_by=reviewed_by,
            reason=reason,
            reviewed_at=datetime.now(UTC),
        )
        .returning(*columns)
    ).one()
    return _decision(inserted, True)
