"""Reviewed outcome evidence, never a winner calculated from returns.

A decision is a complete replacement for one saved race. Original source bytes
and every superseded decision remain retained. Source quotes prove what was read;
the accountable review, rather than this adapter, judges what the source means.
"""

from __future__ import annotations

from datetime import UTC, datetime
from io import BytesIO
import ipaddress
import math
import socket
import re
from urllib.parse import parse_qsl, urljoin, urlsplit

import httpx
from pypdf import PdfReader
from sqlalchemy import select, text
from sqlalchemy.orm import Session

from alethical.db import models as m
from alethical.pipeline.election_account_reviews import candidate_identity
from alethical.pipeline.election_comparison import (
    ComparisonImportError,
    archive_source,
    digest,
    read_source,
)
from alethical.pipeline import election_source_readings as readings
from alethical.pipeline.election_source_files import SourceFileLimitError
from alethical.pipeline.raw_file_store import raw_file_store_from_env

STATUSES = {"pending", "unofficial", "certified", "recount", "tie", "unavailable"}
OUTCOMES = {"elected", "not_elected"}
SOURCE_FIELDS = {
    "capture_id",
    "url",
    "sha256",
    "media_type",
    "fetched_at",
    "authority",
    "publisher_url",
    "publisher_sha256",
    "final_url",
}
EVIDENCE_FIELDS = SOURCE_FIELDS | {
    "kind",
    "locator",
    "quote",
    "context",
    "identity",
    "candidate_id",
    "outcome",
    "status",
    "final",
}


def capture_metadata(source: m.ElectionOutcomeSource) -> dict:
    return {
        "capture_id": source.id,
        "url": source.url,
        "final_url": source.final_url,
        "publisher_url": source.publisher_url,
        "publisher_sha256": source.publisher_hash,
        "sha256": source.content_hash,
        "media_type": source.media_type,
        "authority": source.authority,
        "fetched_at": source.fetched_at.isoformat(),
    }


def _public_url(url: str, hosts: list[str]) -> None:
    parsed = urlsplit(url)
    sensitive = {
        "token",
        "access_token",
        "api_key",
        "key",
        "password",
        "signature",
        "authorization",
        "auth",
    }
    _require(
        not any(key.casefold() in sensitive for key, _ in parse_qsl(parsed.query)),
        "Capture URL cannot contain access credentials",
    )
    _require(
        parsed.scheme == "https"
        and parsed.hostname in hosts
        and parsed.port in {None, 443}
        and not parsed.username
        and not parsed.password
        and not parsed.fragment,
        "Capture URL must be credential-free HTTPS on explicitly approved publisher hosts",
    )
    try:
        addresses = socket.getaddrinfo(parsed.hostname, 443, type=socket.SOCK_STREAM)
        _require(
            bool(addresses)
            and all(ipaddress.ip_address(a[4][0]).is_global for a in addresses),
            "Capture cannot reach a private or local network address",
        )
    except OSError as error:
        raise ComparisonImportError(
            "Could not resolve public publisher host"
        ) from error


def _download(url: str, hosts: list[str]) -> tuple[bytes, str, str]:
    """Bounded public-host acquisition. Redirects cannot add another host."""
    try:
        with httpx.Client(timeout=20, follow_redirects=False) as client:
            for _ in range(4):
                _public_url(url, hosts)
                with client.stream("GET", url) as response:
                    if response.status_code in {301, 302, 303, 307, 308}:
                        _require(
                            bool(response.headers.get("location")),
                            "Publisher redirect is missing its destination",
                        )
                        url = urljoin(url, response.headers["location"])
                        continue
                    response.raise_for_status()
                    body = bytearray()
                    for chunk in response.iter_bytes():
                        body.extend(chunk)
                        _require(
                            len(body) <= 25_000_000,
                            "Outcome source exceeds capture size limit",
                        )
                    return (
                        bytes(body),
                        str(response.url),
                        response.headers.get("content-type", "")
                        .split(";")[0]
                        .strip()
                        .lower(),
                    )
    except httpx.HTTPError as error:
        raise ComparisonImportError(
            "Could not acquire the public outcome source"
        ) from error
    raise ComparisonImportError("Publisher redirect limit exceeded")


def capture_source(
    db: Session,
    *,
    url: str,
    publisher_url: str,
    publisher_hosts: list[str],
    authority: str,
    store=None,
) -> m.ElectionOutcomeSource:
    """Capture provenance only. Acquisition does not certify a race or a person.

    The operator must establish the official publisher and explicitly enumerate
    its hosts. Cross-host documents also need their literal source URL linked by
    the retained publisher page. Originals never come from user-typed quote text.
    """
    _require(
        _text(authority)
        and isinstance(publisher_hosts, list)
        and bool(publisher_hosts)
        and all(
            _text(h) and h == h.lower() and re.fullmatch(r"[a-z0-9.-]+", h)
            for h in publisher_hosts
        ),
        "Capture needs an explicit authority and publisher host list",
    )
    hosts = sorted(set(publisher_hosts))
    publisher_body, publisher_final, _ = _download(publisher_url, hosts)
    body, final_url, media_type = _download(url, hosts)
    _require(
        media_type
        in {"text/plain", "text/html", "application/json", "application/pdf"},
        "Publisher did not return a supported evidence document",
    )
    if urlsplit(url).hostname != urlsplit(publisher_final).hostname:
        _require(
            url.encode() in publisher_body,
            "Cross-host source needs an exact link from its retained publisher page",
        )
    store = raw_file_store_from_env() if store is None else store
    fingerprint = archive_source(db, store, body)
    publisher_hash = archive_source(db, store, publisher_body)
    descriptor = dict(
        content_hash=fingerprint,
        publisher_hash=publisher_hash,
        url=url,
        final_url=final_url,
        publisher_url=publisher_url,
        publisher_hosts=hosts,
        authority=authority.strip(),
        media_type=media_type,
    )
    identifier = digest(descriptor)
    db.execute(
        text("SELECT pg_advisory_xact_lock(hashtext(:key))"),
        {"key": f"election-outcome-source:{identifier}"},
    )
    existing = db.get(m.ElectionOutcomeSource, identifier)
    if existing is not None:
        return existing
    row = m.ElectionOutcomeSource(
        id=identifier, fetched_at=datetime.now(UTC), **descriptor
    )
    db.add(row)
    db.flush()
    return row


def race_identity(
    snapshot: m.ElectionComparisonSnapshot, race: m.ElectionComparisonRace
) -> dict:
    return {
        "election_key": snapshot.election_key,
        "source_race_id": race.payload.get("race_id"),
        "office_id": race.office_id,
        "label": race.label,
        "district": race.payload.get("district"),
        "jurisdiction": race.jurisdiction,
    }


def _require(condition: bool, message: str) -> None:
    if not condition:
        raise ComparisonImportError(message)


def _text(value) -> bool:
    return isinstance(value, str) and bool(value.strip()) and "\x00" not in value


def validate_request(request: dict) -> None:
    """Offline shape validation only; no source existence or review is implied."""
    required = {
        "snapshot_id",
        "race_id",
        "decision",
        "result_status",
        "identity",
        "candidate_outcomes",
        "evidence",
        "reason",
        "reviewed_by",
        "expected_previous_id",
    }
    _require(
        isinstance(request, dict) and set(request) == required,
        "Request fields differ from the outcome review contract",
    )
    for field in ("snapshot_id", "race_id"):
        _require(
            isinstance(request[field], str)
            and re.fullmatch(r"[a-f0-9]{64}", request[field]) is not None,
            "Review needs complete snapshot and race hashes",
        )
    _require(
        _text(request["decision"]) and request["decision"] in {"recorded", "withdrawn"},
        "Decision must be recorded or withdrawn",
    )
    _require(
        _text(request["result_status"]) and request["result_status"] in STATUSES,
        "Unknown result status",
    )
    _require(
        isinstance(request["identity"], dict), "An exact race identity is required"
    )
    _require(
        _text(request["reason"]) and _text(request["reviewed_by"]),
        "Record the private reason and accountable reviewer",
    )
    previous = request["expected_previous_id"]
    _require(
        previous is None or type(previous) is int and previous > 0,
        "Expected predecessor must be a positive ID or null",
    )
    outcomes = request["candidate_outcomes"]
    _require(isinstance(outcomes, list), "Candidate outcomes must be a list")
    ids = []
    for item in outcomes:
        _require(
            isinstance(item, dict)
            and set(item) == {"candidate_id", "identity", "outcome"},
            "Candidate outcomes need exact IDs, identity and outcome",
        )
        _require(
            _text(item["candidate_id"])
            and len(item["candidate_id"]) <= 64
            and isinstance(item["identity"], dict)
            and _text(item["outcome"])
            and item["outcome"] in OUTCOMES,
            "Invalid candidate outcome",
        )
        ids.append(item["candidate_id"])
    _require(
        len(ids) == len(set(ids)), "Candidate outcomes contain a duplicate candidacy"
    )
    evidence = request["evidence"]
    _require(
        isinstance(evidence, list) and bool(evidence),
        "Retained source evidence is required",
    )
    for item in evidence:
        _require(
            isinstance(item, dict) and not set(item) - EVIDENCE_FIELDS,
            "Unknown evidence fields",
        )
        _require(
            all(_text(item.get(k)) for k in SOURCE_FIELDS),
            "Evidence needs source URL, hash, date, media type and authority",
        )
        _require(
            all(
                re.fullmatch(r"[a-f0-9]{64}", item[key]) is not None
                for key in ("capture_id", "sha256", "publisher_sha256")
            ),
            "Evidence needs a complete source hash",
        )
        url = urlsplit(item["url"])
        _require(
            url.scheme == "https"
            and bool(url.hostname)
            and not url.username
            and not url.password
            and not url.fragment,
            "Evidence needs an HTTPS source URL without credentials or fragment",
        )
        try:
            _require(
                datetime.fromisoformat(item["fetched_at"]).tzinfo is not None,
                "Source copy date needs a timezone",
            )
        except ValueError as error:
            raise ComparisonImportError("Source copy date is invalid") from error
        _require(
            _text(item.get("kind"))
            and item.get("kind")
            in {
                "race_status",
                "final_certification",
                "candidate_outcome",
                "withdrawal",
            },
            "Unknown outcome evidence kind",
        )
        _require(
            _text(item.get("quote"))
            and isinstance(item.get("locator"), dict)
            and isinstance(item.get("context"), dict)
            and isinstance(item.get("identity"), dict),
            "Evidence needs a literal quote, locator and race context",
        )
        bindings = item["context"].get("bindings")
        _require(
            set(item["context"]) == {"bindings"} and isinstance(bindings, list),
            "Source context needs literal identity bindings",
        )
        for binding in bindings:
            _require(
                isinstance(binding, dict)
                and set(binding)
                == {"field", "value", "literal", "quote", "locator", "reason"},
                "Binding needs target, literal quote, locator and private explanation",
            )
            _require(
                all(
                    _text(binding.get(key))
                    for key in ("field", "literal", "quote", "reason")
                )
                and isinstance(binding["locator"], dict),
                "Identity bindings need literal text and a locator",
            )
    _require(
        request["decision"] != "withdrawn" or previous is not None and not outcomes,
        "Withdrawal needs a predecessor and no candidate claims",
    )
    _require(
        not outcomes or request["result_status"] == "certified",
        "Only a final certified race can carry candidate outcomes",
    )


def _checked_locator(locator):
    if "reading_sha256" not in locator:
        return False
    bounds = locator.get("bounds")
    _require(
        set(locator) == {"page", "reading_sha256", "field_id", "bounds"}
        and type(locator["page"]) is int
        and locator["page"] > 0
        and isinstance(locator["reading_sha256"], str)
        and re.fullmatch(r"[a-f0-9]{64}", locator["reading_sha256"]) is not None
        and _text(locator["field_id"])
        and isinstance(bounds, list)
        and len(bounds) == 4
        and all(type(v) in {int, float} and math.isfinite(v) for v in bounds)
        and 0 <= bounds[0] < bounds[2]
        and 0 <= bounds[1] < bounds[3],
        "Checked PDF evidence needs an exact closed field locator",
    )
    return True


def _reading_ids(evidence):
    return {
        loc["reading_sha256"]
        for item in evidence
        for loc in [
            item["locator"],
            *[b["locator"] for b in item["context"]["bindings"]],
        ]
        if _checked_locator(loc)
    }


def _reading_context(db, store, evidence, *, lock=False, partial=False):
    ids = _reading_ids(evidence)
    if not ids:
        return None
    return readings.load_verified_reading_context(
        db,
        store,
        sorted(ids),
        lock=lock,
        partial=partial,
        allowed_source_hashes={
            item[key] for item in evidence for key in ("sha256", "publisher_sha256")
        },
    )


def _evidence_text(item, locator, bodies, reading_context):
    if not _checked_locator(locator):
        return _quoted_text(bodies[item["sha256"]], item["media_type"], locator)
    _require(
        item["media_type"] == "application/pdf" and reading_context is not None,
        "Checked quote needs retained PDF reading proof",
    )
    receipt = reading_context.receipt(locator["reading_sha256"])
    _require(
        receipt["document_kind"] == "outcome_certification"
        and receipt["source_context"] is None,
        "Reading purpose does not support outcome certification",
    )
    _require(
        receipt["original_sha256"] == item["sha256"],
        "Reading belongs to another original",
    )
    fields = [f for f in receipt["fields"] if f["field_id"] == locator["field_id"]]
    _require(len(fields) == 1, "Checked outcome field is missing")
    field = fields[0]
    _require(
        field["page"] == locator["page"]
        and field["bounds"] == locator["bounds"]
        and field["record_type"] == "certification"
        and field["value_type"] == "text"
        and field["state"] == "value"
        and field["normalized"] == field["literal"],
        "Checked outcome field differs or is unresolved",
    )
    return field["literal"]


def _public_locator(locator):
    keys = (
        {"page", "bounds"}
        if "reading_sha256" in locator
        else {"page", "line_start", "line_end", "encoding"}
    )
    return {key: locator[key] for key in keys if key in locator}


def _quoted_text(body: bytes, media_type: str, locator: dict) -> str:
    if media_type == "application/pdf":
        _require(
            set(locator) == {"page"}
            and type(locator["page"]) is int
            and locator["page"] > 0,
            "PDF evidence needs an exact page",
        )
        pages = PdfReader(BytesIO(body)).pages
        _require(
            locator["page"] <= len(pages), "Evidence page is outside retained source"
        )
        return pages[locator["page"] - 1].extract_text() or ""
    _require(
        media_type in {"text/plain", "text/html", "application/json"},
        "Unsupported evidence media type",
    )
    _require(
        set(locator) == {"line_start", "line_end", "encoding"},
        "Text evidence needs exact lines and encoding",
    )
    start, end, encoding = (
        locator["line_start"],
        locator["line_end"],
        locator["encoding"],
    )
    _require(
        type(start) is int and type(end) is int and 1 <= start <= end,
        "Invalid evidence lines",
    )
    _require(
        encoding in {"utf-8", "utf-8-sig", "windows-1252"},
        "Unsupported evidence encoding",
    )
    lines = body.decode(encoding).splitlines()
    _require(end <= len(lines), "Evidence lines are outside retained source")
    return "\n".join(lines[start - 1 : end])


def _validate_evidence(
    db,
    snapshot,
    race,
    evidence,
    *,
    bodies=None,
    store=None,
    captures=None,
    reading_context=None,
) -> None:
    bodies = {} if bodies is None else bodies
    if reading_context is None and _reading_ids(evidence):
        store = raw_file_store_from_env() if store is None else store
        reading_context = _reading_context(db, store, evidence)
    identity = race_identity(snapshot, race)
    expected_bindings = {
        "election_date": snapshot.election_date.isoformat(),
        "office": race.label,
        "jurisdiction": race.jurisdiction,
    }
    for item in evidence:
        _require(
            item["identity"] == identity,
            "Evidence is scoped to a different race identity",
        )
        capture = (
            db.get(m.ElectionOutcomeSource, item["capture_id"])
            if captures is None
            else captures.get(item["capture_id"])
        )
        _require(
            capture is not None
            and capture_metadata(capture) == {key: item[key] for key in SOURCE_FIELDS},
            "Evidence URL, hash or authority differs from retained capture",
        )
        fingerprint = item["sha256"]
        for source_hash in (fingerprint, item["publisher_sha256"]):
            if source_hash not in bodies:
                source = db.get(m.ElectionResultSource, source_hash)
                _require(source is not None, "Outcome source is not retained")
                try:
                    bodies[source_hash] = read_source(
                        store if store is not None else raw_file_store_from_env(),
                        source,
                    )
                except SourceFileLimitError:
                    raise
                except Exception as error:
                    raise ComparisonImportError(
                        "Outcome source bytes are unavailable or corrupt"
                    ) from error
        try:
            actual = _evidence_text(item, item["locator"], bodies, reading_context)
            _require(
                (
                    item["quote"] == actual
                    if _checked_locator(item["locator"])
                    else item["quote"] in actual
                ),
                "Outcome quote differs from retained source",
            )
            expected = dict(expected_bindings)
            candidate_id = item.get("candidate_id")
            if candidate_id is not None:
                candidates = [
                    c
                    for c in race.payload["candidates"]
                    if c["candidate_id"] == candidate_id
                    and not c["is_write_in_aggregate"]
                ]
                _require(
                    len(candidates) == 1,
                    "Candidate evidence must identify an exact named candidacy",
                )
                expected["candidate_name"] = candidates[0]["name"]
            bindings = item["context"]["bindings"]
            _require(
                len(bindings) == len(expected)
                and {b["field"] for b in bindings} == set(expected),
                "Source context needs exact election, office, jurisdiction and candidate bindings",
            )
            for binding in bindings:
                _require(
                    binding["value"] == expected[binding["field"]],
                    "Binding target differs from exact source identity",
                )
                literal_context = _evidence_text(
                    item, binding["locator"], bodies, reading_context
                )
                _require(
                    (
                        binding["quote"] == literal_context
                        if _checked_locator(binding["locator"])
                        else binding["quote"] in literal_context
                    )
                    and binding["literal"] in binding["quote"],
                    "Identity binding differs from retained source",
                )
        except (ComparisonImportError, SourceFileLimitError):
            raise
        except Exception as error:
            raise ComparisonImportError(
                "Could not validate retained outcome quotes"
            ) from error


def record_decision(
    db: Session,
    *,
    snapshot_id: str,
    race_id: str,
    decision: str,
    result_status: str,
    identity: dict,
    candidate_outcomes: list[dict],
    evidence: list[dict],
    reason: str,
    reviewed_by: str,
    expected_previous_id: int | None,
) -> m.ElectionOutcomeDecision:
    request = dict(
        snapshot_id=snapshot_id,
        race_id=race_id,
        decision=decision,
        result_status=result_status,
        identity=identity,
        candidate_outcomes=candidate_outcomes,
        evidence=evidence,
        reason=reason,
        reviewed_by=reviewed_by,
        expected_previous_id=expected_previous_id,
    )
    validate_request(request)
    request["reason"] = reason.strip()
    request["reviewed_by"] = reviewed_by.strip()
    snapshot = db.get(m.ElectionComparisonSnapshot, snapshot_id)
    race = db.get(m.ElectionComparisonRace, (snapshot_id, race_id))
    _require(
        snapshot is not None and race is not None,
        "Review needs a retained snapshot and race",
    )
    _require(
        identity == race_identity(snapshot, race),
        "Review identity differs from the exact source race",
    )
    store = raw_file_store_from_env()
    proof = _reading_context(db, store, evidence, lock=True)
    _validate_evidence(db, snapshot, race, evidence, store=store, reading_context=proof)
    if decision == "recorded":
        _require(
            any(
                e["kind"] == "race_status" and e.get("status") == result_status
                for e in evidence
            ),
            "A race status needs explicit status evidence",
        )
        if result_status == "certified":
            _require(
                any(
                    e["kind"] == "final_certification"
                    and e.get("final") is True
                    and e.get("candidate_id") is None
                    for e in evidence
                ),
                "Certification requires explicit final race certification",
            )
        for outcome in candidate_outcomes:
            candidates = [
                c
                for c in race.payload["candidates"]
                if c["candidate_id"] == outcome["candidate_id"]
                and not c["is_write_in_aggregate"]
            ]
            _require(
                len(candidates) == 1
                and candidate_identity(race, candidates[0]) == outcome["identity"],
                "Outcome identity differs from exact named candidacy",
            )
            _require(
                any(
                    e["kind"] == "candidate_outcome"
                    and e.get("final") is True
                    and e.get("candidate_id") == outcome["candidate_id"]
                    and e.get("outcome") == outcome["outcome"]
                    for e in evidence
                ),
                "Candidate outcome requires its own exact final certification evidence",
            )
    else:
        _require(
            any(e["kind"] == "withdrawal" for e in evidence),
            "Withdrawal requires retained correction evidence",
        )
    db.execute(
        text("SELECT pg_advisory_xact_lock(hashtext(:key))"),
        {"key": f"election-outcome:{snapshot_id}:{race_id}"},
    )
    request_key = digest(request)
    repeated = db.scalar(
        select(m.ElectionOutcomeDecision).where(
            m.ElectionOutcomeDecision.request_key == request_key
        )
    )
    if repeated is not None:
        return repeated
    previous = db.scalar(
        select(m.ElectionOutcomeDecision)
        .where(
            m.ElectionOutcomeDecision.snapshot_id == snapshot_id,
            m.ElectionOutcomeDecision.race_id == race_id,
        )
        .order_by(m.ElectionOutcomeDecision.id.desc())
        .limit(1)
    )
    _require(
        (previous.id if previous else None) == expected_previous_id,
        "Outcome review changed; read the latest decision",
    )
    _require(
        decision != "withdrawn"
        or previous is not None
        and previous.decision == "recorded",
        "Only a recorded decision can be withdrawn",
    )
    row = m.ElectionOutcomeDecision(
        request_key=request_key,
        previous_decision_id=expected_previous_id,
        snapshot_id=snapshot_id,
        race_id=race_id,
        decision=decision,
        result_status=result_status,
        identity=identity,
        candidate_outcomes=candidate_outcomes,
        evidence=evidence,
        reason=reason.strip(),
        reviewed_by=reviewed_by.strip(),
        reviewed_at=datetime.now(UTC),
    )
    db.add(row)
    db.flush()
    return row


def public_evidence(item: dict) -> dict:
    """Deliberate allowlist: never expose typed reviewer notes or storage keys."""
    public = {
        key: item[key]
        for key in (
            SOURCE_FIELDS
            | {"kind", "locator", "quote", "candidate_id", "outcome", "status", "final"}
        )
        if key in item
    }
    public["locator"] = _public_locator(item["locator"])
    public["context"] = {
        "bindings": [
            {
                **{key: b[key] for key in ("field", "value", "literal", "quote")},
                "locator": _public_locator(b["locator"]),
            }
            for b in item["context"]["bindings"]
        ]
    }
    return public


def source_metadata(db: Session, snapshot_id: str) -> list[dict]:
    """Historical evidence remains reachable after correction or withdrawal."""
    rows = db.scalars(
        select(m.ElectionOutcomeDecision)
        .where(m.ElectionOutcomeDecision.snapshot_id == snapshot_id)
        .order_by(m.ElectionOutcomeDecision.id)
    )
    found = {}
    for row in rows:
        for item in row.evidence:
            metadata = {key: item[key] for key in SOURCE_FIELDS}
            if "encoding" in item["locator"]:
                metadata["encoding"] = item["locator"]["encoding"]
            found.setdefault(item["sha256"], metadata)
            found.setdefault(
                item["publisher_sha256"],
                {
                    "sha256": item["publisher_sha256"],
                    "url": item["publisher_url"],
                    "capture_id": item["capture_id"],
                    "media_type": "text/html",
                    "fetched_at": item["fetched_at"],
                    "authority": item["authority"],
                    "encoding": "utf-8",
                },
            )
    return list(found.values())


def applicable_outcomes(
    db: Session, *, snapshot_id: str, race_ids: list[str] | None = None, store=None
) -> dict[str, dict]:
    """Batch candidates/races/reviews; read each unique retained original once.

    Version covers every visible relevant decision and evidence availability,
    including superseded decisions. A late commit with a lower ID still changes it.
    No decision or evidence is carried to a new result snapshot.
    """
    snapshot = db.get(m.ElectionComparisonSnapshot, snapshot_id)
    _require(snapshot is not None, "Outcome read needs a retained snapshot")
    race_query = select(m.ElectionComparisonRace).where(
        m.ElectionComparisonRace.snapshot_id == snapshot_id
    )
    review_query = select(m.ElectionOutcomeDecision).where(
        m.ElectionOutcomeDecision.snapshot_id == snapshot_id
    )
    if race_ids is not None:
        race_query = race_query.where(m.ElectionComparisonRace.id.in_(race_ids))
        review_query = review_query.where(
            m.ElectionOutcomeDecision.race_id.in_(race_ids)
        )
    races = {r.id: r for r in db.scalars(race_query)}
    histories = {key: [] for key in races}
    for row in db.scalars(review_query.order_by(m.ElectionOutcomeDecision.id)):
        if row.race_id in histories:
            histories[row.race_id].append(row)
    bodies, available = {}, {}
    items = [
        item
        for history in histories.values()
        for row in history
        for item in row.evidence
    ]
    capture_ids = {item["capture_id"] for item in items}
    captures = (
        {
            c.id: c
            for c in db.scalars(
                select(m.ElectionOutcomeSource).where(
                    m.ElectionOutcomeSource.id.in_(capture_ids)
                )
            )
        }
        if capture_ids
        else {}
    )
    hashes = {item[key] for item in items for key in ("sha256", "publisher_sha256")}
    sources = (
        {
            s.content_hash: s
            for s in db.scalars(
                select(m.ElectionResultSource).where(
                    m.ElectionResultSource.content_hash.in_(hashes)
                )
            )
        }
        if hashes
        else {}
    )
    if hashes or _reading_ids(items):
        store = raw_file_store_from_env() if store is None else store
    proof = _reading_context(db, store, items, partial=True)
    # Historical evidence participates in versions; each unique original is read
    # once. Only active decision failures suppress the current outcome claims.
    for key in hashes:
        try:
            _require(key in sources, "Missing source")
            bodies[key] = read_source(store, sources[key])
            available[key] = True
        except SourceFileLimitError:
            raise
        except Exception:
            available[key] = False
    result = {}
    for race_id, race in races.items():
        history = histories[race_id]
        row = history[-1] if history else None
        state = "unreviewed"
        status = race.result_status
        claims, evidence = {}, []
        if row is not None:
            if row.decision == "withdrawn":
                state = "withdrawn"
            elif row.identity != race_identity(snapshot, race):
                state = "identity_changed"
            elif not all(
                available[e[key]]
                for e in row.evidence
                for key in ("sha256", "publisher_sha256")
            ):
                state = "sources_unavailable"
            else:
                try:
                    _validate_evidence(
                        db,
                        snapshot,
                        race,
                        row.evidence,
                        bodies=bodies,
                        captures=captures,
                        store=store,
                        reading_context=proof,
                    )
                    for item in row.candidate_outcomes:
                        candidate = next(
                            c
                            for c in race.payload["candidates"]
                            if c["candidate_id"] == item["candidate_id"]
                            and not c["is_write_in_aggregate"]
                        )
                        _require(
                            candidate_identity(race, candidate) == item["identity"],
                            "Changed candidacy",
                        )
                    state, status = "checked", row.result_status
                    claims = {
                        c["candidate_id"]: c["outcome"] for c in row.candidate_outcomes
                    }
                except SourceFileLimitError:
                    raise
                except Exception:
                    state = "sources_unavailable"
            evidence = [public_evidence(e) for e in row.evidence]
        candidates = {}
        for c in race.payload["candidates"]:
            claim = (
                claims.get(c["candidate_id"])
                if not c["is_write_in_aggregate"]
                else None
            )
            candidates[c["candidate_id"]] = {
                "outcome": claim,
                "outcome_status": "certified" if claim is not None else "pending",
                "evidence": [
                    e for e in evidence if e.get("candidate_id") == c["candidate_id"]
                ],
            }
        version = digest(
            {
                "snapshot_id": snapshot_id,
                "race_id": race_id,
                "decisions": [(r.id, r.request_key) for r in history],
                "sources": sorted(
                    (e[key], available[e[key]])
                    for r in history
                    for e in r.evidence
                    for key in ("sha256", "publisher_sha256")
                ),
                **(
                    {
                        "readings": [
                            (rid, proof.head(rid), proof.proof_outcomes[rid])
                            for rid in sorted(
                                _reading_ids([e for r in history for e in r.evidence])
                            )
                        ]
                    }
                    if proof is not None
                    and _reading_ids([e for r in history for e in r.evidence])
                    else {}
                ),
                "state": state,
            }
        )
        result[race_id] = {
            "result_status": status,
            "candidates": candidates,
            "outcome_review": {
                "state": state,
                "decision_id": row.id if row else None,
                "checked_on": row.reviewed_at.date().isoformat() if row else None,
                "evidence": evidence,
                "version": version,
            },
        }
    return result
