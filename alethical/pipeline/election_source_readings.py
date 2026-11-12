"""Explicit checked source readings, separate from identity and publication.

Preparation and OCR never approve facts. Only an internal review appends a checked
reading after retained-byte and render verification. Ordinary reads check current
review heads and originals again; there is no process-wide availability cache.
"""

from __future__ import annotations

from collections import OrderedDict
from copy import deepcopy
from datetime import UTC, date, datetime
from decimal import Decimal
import hashlib
import json
import math
import re

from sqlalchemy import select, text

from alethical.db import models as m
from alethical.pipeline.election_comparison import (
    ComparisonImportError,
    digest,
    read_source,
)
from alethical.pipeline.election_fec_paper_identity import _run_native_reader

SCHEMA = "mn-local-source-reading:v1"
RENDER_PROFILE = "pdftoppm:png:200dpi:max2600:v1"
MAX_ORIGINAL_BYTES = 16 * 1024 * 1024
MAX_CLOSURE_BYTES = 64 * 1024 * 1024
MAX_RECEIPT_BYTES = 4 * 1024 * 1024
MAX_PAGES = 32
MAX_FIELDS = 2000
MAX_DEPENDENCIES = 32
RECEIPT_FIELDS = {
    "schema",
    "original_sha256",
    "document_kind",
    "pages",
    "fields",
    "dependencies",
    "source_context",
    "verification_basis",
}
_FIELD_KEYS = {
    "field_id",
    "page",
    "bounds",
    "label",
    "literal",
    "state",
    "value_type",
    "normalized",
    "currency",
    "record_type",
    "row",
}
_PAGE_KEYS = {"page", "width", "height", "image_sha256", "render_profile", "transcript"}
_STATES = {"value", "blank", "ambiguous", "unreadable", "not_checked", "redacted"}
_KINDS = {"financial_report", "supplement", "certification", "bank_attachment"}
_RECORDS = {
    "cover",
    "disbursement",
    "bank_transaction",
    "donation",
    "certification",
    "other",
}
_CONTEXT_SEAL = object()


def require(ok, message):
    if not ok:
        raise ComparisonImportError(message)


def _hash(value):
    return isinstance(value, str) and re.fullmatch(r"[a-f0-9]{64}", value) is not None


def _string(value, *, limit=4000, blank=False):
    return (
        isinstance(value, str)
        and len(value) <= limit
        and (blank or bool(value.strip()))
        and not any(ord(c) < 32 and c not in "\t\r\n" for c in value)
    )


def normalize_field(literal, value_type, state):
    if state != "value":
        return None
    if value_type == "text":
        return literal
    if value_type == "mark":
        # A checked mark stays literal, never a certification/zero inference.
        require(
            literal in {"X", "x", "✓", "✔", "☒"},
            "Mark needs an explicitly checked source mark",
        )
        return "marked"
    if value_type == "money":
        require(
            re.fullmatch(
                r"\$?-?(?:0|[1-9][0-9]*|[1-9][0-9]{0,2}(?:,[0-9]{3})+)?(?:\.[0-9]{1,2})?",
                literal,
            )
            is not None
            and bool(re.search(r"[0-9]", literal)),
            "Money reading is not an unambiguous scalar",
        )
        value = Decimal(literal.removeprefix("$").replace(",", ""))
        # Decimal formatting, not arithmetic affected by the global precision.
        whole, _, fraction = format(value, "f").partition(".")
        return whole + "." + fraction.ljust(2, "0")
    require(value_type == "date", "Unsupported reading value type")
    match = re.fullmatch(r"([0-9]{1,2})/([0-9]{1,2})/([0-9]{2}|[0-9]{4})", literal)
    try:
        if match:
            month, day, year = map(int, match.groups())
            if len(match[3]) == 2:
                year += 2000
            return date(year, month, day).isoformat()
        value = date.fromisoformat(literal)
        require(value.isoformat() == literal, "Reading needs an exact calendar date")
        return literal
    except ValueError as exc:
        raise ComparisonImportError("Reading has an invalid calendar date") from exc


def field_proposal(
    field_id,
    *,
    page,
    bounds,
    label,
    literal,
    value_type="text",
    state="value",
    currency=None,
    record_type="cover",
    row=None,
):
    """Prepare one observation; the returned dictionary is never approval."""
    return dict(
        field_id=field_id,
        page=page,
        bounds=bounds,
        label=label,
        literal=literal,
        state=state,
        value_type=value_type,
        normalized=normalize_field(literal, value_type, state),
        currency=currency,
        record_type=record_type,
        row=row,
    )


def _pdf_info(body):
    require(
        isinstance(body, bytes)
        and 0 < len(body) <= MAX_ORIGINAL_BYTES
        and body.startswith(b"%PDF-"),
        "Reading needs bounded original PDF bytes",
    )
    try:
        output = _run_native_reader(
            body, command=["pdfinfo", "-"], max_stdout=64 * 1024
        ).decode("utf-8")
    except Exception as exc:
        raise ComparisonImportError("Cannot inspect bounded original PDF") from exc
    match = re.search(r"^Pages:\s+([0-9]+)$", output, re.M)
    if match is None:
        raise ComparisonImportError("Unsupported PDF page count")
    require(0 < int(match[1]) <= 256, "Unsupported PDF page count")
    return int(match[1])


def render_page(body, page):
    """Fixed bounded render; input cannot choose a command or renderer options."""
    count = _pdf_info(body)
    require(
        type(page) is int and 1 <= page <= count, "Reading page is outside original PDF"
    )
    try:
        info = _run_native_reader(
            body,
            command=["pdfinfo", "-f", str(page), "-l", str(page), "-"],
            max_stdout=64 * 1024,
        ).decode("utf-8")
        size = re.search(
            r"^Page(?:\s+[0-9]+)? size:\s+([0-9.]+) x ([0-9.]+) pts", info, re.M
        )
        if size is None:
            raise ComparisonImportError("PDF page size is unavailable")
        image = _run_native_reader(
            body,
            command=[
                "pdftoppm",
                "-f",
                str(page),
                "-l",
                str(page),
                "-singlefile",
                "-r",
                "200",
                "-scale-to",
                "2600",
                "-png",
                "-",
            ],
            max_stdout=16 * 1024 * 1024,
        )
        require(
            image.startswith(b"\x89PNG\r\n\x1a\n"), "PDF renderer did not return PNG"
        )
    except Exception as exc:
        raise ComparisonImportError("Cannot render bounded original PDF page") from exc
    return {
        "page": page,
        "width": float(size[1]),
        "height": float(size[2]),
        "image_sha256": hashlib.sha256(image).hexdigest(),
        "render_profile": RENDER_PROFILE,
    }, image


def prepare_receipt(
    body, *, fields, document_kind, dependencies=None, source_context=None
):
    """Render listed pages for checking, with no database or approval side effect."""
    fields = deepcopy(fields)
    require(
        isinstance(fields, list) and 0 < len(fields) <= MAX_FIELDS,
        "Reading needs bounded listed fields",
    )
    page_numbers = sorted({f["page"] for f in fields})
    require(len(page_numbers) <= MAX_PAGES, "Too many checked reading pages")
    pages = []
    for page in page_numbers:
        metadata, _ = render_page(body, page)
        metadata["transcript"] = "\n".join(
            f"{f['field_id']} | {f['label']} | {f['literal']} | {f['state']}"
            for f in fields
            if f["page"] == page
        )
        pages.append(metadata)
    receipt = dict(
        schema=SCHEMA,
        verification_basis="visual_source_check",
        original_sha256=hashlib.sha256(body).hexdigest(),
        document_kind=document_kind,
        pages=pages,
        fields=fields,
        dependencies=deepcopy(dependencies or []),
        source_context=deepcopy(source_context),
    )
    return validate_receipt(receipt)


def validate_receipt(value):
    try:
        require(
            isinstance(value, dict)
            and set(value) == RECEIPT_FIELDS
            and value["schema"] == SCHEMA
            and value["verification_basis"] == "visual_source_check"
            and _hash(value["original_sha256"])
            and value["document_kind"] in _KINDS,
            "Unsupported source reading receipt",
        )
        require(
            len(json.dumps(value, ensure_ascii=False, allow_nan=False).encode())
            <= MAX_RECEIPT_BYTES,
            "Source reading receipt is too large",
        )
        pages = value["pages"]
        require(
            isinstance(pages, list) and 0 < len(pages) <= MAX_PAGES,
            "Reading needs bounded pages",
        )
        indexed = {}
        for p in pages:
            require(
                isinstance(p, dict)
                and set(p) == _PAGE_KEYS
                and type(p["page"]) is int
                and 0 < p["page"] <= 256
                and p["page"] not in indexed,
                "Invalid or duplicate reading page",
            )
            require(
                p["render_profile"] == RENDER_PROFILE
                and _hash(p["image_sha256"])
                and _string(p["transcript"], limit=128 * 1024),
                "Reading page lacks exact render/transcript",
            )
            require(
                all(
                    type(p[k]) in {int, float}
                    and math.isfinite(p[k])
                    and 0 < p[k] <= 20000
                    for k in ("width", "height")
                ),
                "Invalid reading page dimensions",
            )
            indexed[p["page"]] = p
        fields = value["fields"]
        require(
            isinstance(fields, list) and 0 < len(fields) <= MAX_FIELDS,
            "Reading needs bounded fields",
        )
        seen, physical = set(), set()
        for f in fields:
            require(
                isinstance(f, dict)
                and set(f) == _FIELD_KEYS
                and isinstance(f["field_id"], str)
                and re.fullmatch(r"[a-z][a-z0-9_.-]{0,119}", f["field_id"]) is not None
                and f["field_id"] not in seen,
                "Invalid or duplicate reading field",
            )
            seen.add(f["field_id"])
            require(
                type(f["page"]) is int
                and f["page"] in indexed
                and f["state"] in _STATES
                and f["value_type"] in {"money", "date", "text", "mark"}
                and f["record_type"] in _RECORDS,
                "Invalid field scope/state/type",
            )
            require(
                _string(f["label"], limit=500) and _string(f["literal"], blank=True),
                "Reading field needs its exact label/literal",
            )
            require(
                f["state"] not in {"blank", "not_checked", "redacted", "unreadable"}
                or f["literal"] == "",
                "Blank/unchecked field cannot carry a value",
            )
            require(
                f["state"] != "value" or bool(f["literal"].strip()),
                "A value reading cannot be blank",
            )
            require(
                f["normalized"]
                == normalize_field(f["literal"], f["value_type"], f["state"]),
                "Reading normalized value differs from literal/state",
            )
            require(
                f["normalized"] is None or isinstance(f["normalized"], str),
                "Reading value must retain exact text",
            )
            require(
                f["currency"] is None
                or (
                    f["value_type"] == "money"
                    and isinstance(f["currency"], str)
                    and re.fullmatch(r"[A-Z]{3}", f["currency"])
                ),
                "Invalid reading currency",
            )
            require(
                f["row"] is None
                or type(f["row"]) is int
                and 1 <= f["row"] <= MAX_FIELDS,
                "Invalid printed row ordinal",
            )
            bounds = f["bounds"]
            require(
                isinstance(bounds, list)
                and len(bounds) == 4
                and all(type(n) in {int, float} and math.isfinite(n) for n in bounds),
                "Invalid reading field bounds",
            )
            require(
                0 <= bounds[0] < bounds[2] <= indexed[f["page"]]["width"]
                and 0 <= bounds[1] < bounds[3] <= indexed[f["page"]]["height"],
                "Reading field crosses its page bounds",
            )
            key = (f["page"], tuple(bounds))
            require(key not in physical, "Reading duplicates a physical source cell")
            physical.add(key)
        for page in pages:
            require(
                page["transcript"]
                == "\n".join(
                    f"{f['field_id']} | {f['label']} | {f['literal']} | {f['state']}"
                    for f in fields
                    if f["page"] == page["page"]
                ),
                "Reading transcript differs from its listed field quotations",
            )
        deps = value["dependencies"]
        require(
            isinstance(deps, list)
            and len(deps) <= MAX_DEPENDENCIES
            and len({d["sha256"] for d in deps}) == len(deps),
            "Invalid reading dependencies",
        )
        for d in deps:
            require(
                isinstance(d, dict)
                and set(d) == {"sha256", "literal"}
                and _hash(d["sha256"])
                and _string(d["literal"], limit=16000, blank=True),
                "Invalid reading dependency",
            )
        if value["source_context"] is not None:
            from alethical.pipeline.election_local_sources import validate_context_shape

            validate_context_shape(value["source_context"], value)
    except (TypeError, KeyError, ValueError, OverflowError) as exc:
        if isinstance(exc, ComparisonImportError):
            raise
        raise ComparisonImportError("Invalid source reading receipt") from exc
    return deepcopy(value)


def receipt_digest(receipt):
    return digest(validate_receipt(receipt))


def subject_key(receipt):
    return digest([receipt["schema"], receipt["original_sha256"]])


def source_dependencies(receipt):
    result = {
        receipt["original_sha256"],
        *(d["sha256"] for d in receipt["dependencies"]),
    }
    context = receipt["source_context"]
    if context is not None:
        result.update(
            context[k]
            for k in (
                "county_source_sha256",
                "publisher_source_sha256",
                "catalogue_source_sha256",
            )
        )
    return result


def _fresh_bodies(db, store, hashes):
    rows = {
        r.content_hash: r
        for r in db.scalars(
            select(m.ElectionResultSource).where(
                m.ElectionResultSource.content_hash.in_(hashes)
            )
        )
    }
    require(set(rows) == set(hashes), "Reading original is not retained")
    require(
        all(
            0 < r.byte_size <= MAX_ORIGINAL_BYTES
            and 0 < r.compressed_byte_size <= MAX_ORIGINAL_BYTES * 2
            for r in rows.values()
        )
        and sum(r.byte_size for r in rows.values()) <= MAX_CLOSURE_BYTES,
        "Reading original proof exceeds bounded closure",
    )
    bodies = {}
    for h in sorted(hashes):
        try:
            bodies[h] = read_source(store, rows[h])
        except Exception as exc:
            raise ComparisonImportError(
                "Reading original is unavailable or changed"
            ) from exc
    return bodies


def verify_receipt_sources(receipt, bodies, *, render=False):
    require(
        source_dependencies(receipt) <= set(bodies),
        "Reading original dependency is absent",
    )
    for h in source_dependencies(receipt):
        require(
            hashlib.sha256(bodies[h]).hexdigest() == h, "Reading original hash differs"
        )
    require(
        bodies[receipt["original_sha256"]].startswith(b"%PDF-"),
        "Reading original is not PDF",
    )
    for d in receipt["dependencies"]:
        if d["literal"]:
            require(
                d["literal"].encode() in bodies[d["sha256"]],
                "Reading dependency quotation differs from original",
            )
    if receipt["source_context"] is not None:
        from alethical.pipeline.election_local_sources import replay_source_context

        replay_source_context(receipt, bodies)
    if render:
        for p in receipt["pages"]:
            actual, _ = render_page(bodies[receipt["original_sha256"]], p["page"])
            require(
                all(actual[k] == p[k] for k in actual),
                "Reading render differs from exact original",
            )


def _batches(values, size=500):
    values = list(values)
    for start in range(0, len(values), size):
        yield values[start : start + size]


def reading_heads(db, receipt_ids):
    require(
        isinstance(receipt_ids, (list, tuple, set, frozenset))
        and all(_hash(h) for h in receipt_ids),
        "Reading lookup needs exact receipt hashes",
    )
    ids = set(receipt_ids)
    model = m.ElectionSourceReadingDecision
    known = {}
    for batch in _batches(ids):
        for receipt_id, subject in db.execute(
            select(model.receipt_sha256, model.subject_key)
            .where(model.receipt_sha256.in_(batch))
            .distinct()
        ):
            known[receipt_id] = subject
    heads = {}
    for batch in _batches(set(known.values())):
        for row in db.execute(
            select(
                model.subject_key,
                model.id,
                model.request_key,
                model.decision,
                model.receipt_sha256,
            )
            .where(model.subject_key.in_(batch))
            .distinct(model.subject_key)
            .order_by(model.subject_key, model.id.desc())
        ):
            heads[row.subject_key] = row
    return {
        h: None
        if h not in known
        else {
            "subject_key": known[h],
            "decision_id": heads[known[h]].id,
            "request_key": heads[known[h]].request_key,
            "decision": heads[known[h]].decision,
            "receipt_sha256": heads[known[h]].receipt_sha256,
        }
        for h in sorted(ids)
    }


def _receipt_rows(db, receipt_ids):
    model = m.ElectionSourceReadingDecision
    result = []
    for batch in _batches(set(receipt_ids)):
        result.extend(
            db.scalars(
                select(model)
                .where(model.receipt_sha256.in_(batch))
                .distinct(model.receipt_sha256)
                .order_by(model.receipt_sha256, model.id.desc())
            )
        )
    return result


class VerifiedReadingContext:
    """Server-created proof for one request, retaining no original PDF bodies."""

    def __init__(
        self,
        receipts,
        heads,
        original_hashes,
        local_values=None,
        *,
        generation_bound=False,
        outcomes=None,
        failed_sources=(),
        _seal=None,
    ):
        require(
            _seal is _CONTEXT_SEAL,
            "Reading context must be verified from retained originals",
        )
        self._receipts = deepcopy(receipts)
        self._local_values = deepcopy(local_values or {})
        self._original_hashes = frozenset(original_hashes)
        self.generation_bound = generation_bound
        self.proof_outcomes = dict(outcomes or {key: True for key in receipts})
        self.failed_sources = frozenset(failed_sources)
        self.version = digest({"heads": heads, "proof_outcomes": self.proof_outcomes})

    def receipt(self, receipt_id):
        require(receipt_id in self._receipts, "Receipt is outside this verified scope")
        return deepcopy(self._receipts[receipt_id])

    @property
    def original_hashes(self):
        return self._original_hashes

    def local_values(self, receipt_id):
        require(
            receipt_id in self._local_values,
            "Reading has no verified local source context",
        )
        return deepcopy(self._local_values[receipt_id])


def load_verified_reading_context(
    db, store, receipt_ids, *, lock=False, allowed_source_hashes=None, partial=False
):
    """Fresh batched proof; partial mode is only for scoped ordinary reads.

    Stage/publication use the strict default and shared head locks. Each ordinary
    receipt has its own result; one lost proof cannot invalidate unrelated ones.
    """
    require(not (partial and lock), "Publication cannot use partial reading proof")
    heads = reading_heads(db, receipt_ids)
    if lock:
        subjects = sorted({h["subject_key"] for h in heads.values() if h})
        for batch in _batches(subjects):
            db.execute(
                text(
                    "SELECT pg_advisory_xact_lock_shared(hashtext(ordered.key)) FROM (SELECT unnest(CAST(:keys AS TEXT[])) AS key ORDER BY key) AS ordered"
                ),
                {"keys": ["source-reading:" + key for key in batch]},
            )
        heads = reading_heads(db, receipt_ids)
    eligible = {
        rid
        for rid, head in heads.items()
        if head is not None
        and head["decision"] == "checked"
        and head["receipt_sha256"] == rid
    }
    require(
        partial or eligible == set(heads), "Reading is not the current checked receipt"
    )
    outcomes = {rid: False for rid in heads}
    receipts, hashes = {}, set()
    for row in _receipt_rows(db, eligible):
        try:
            receipt = validate_receipt(row.receipt)
            require(
                receipt_digest(receipt) == row.receipt_sha256
                and subject_key(receipt) == row.subject_key
                and receipt["original_sha256"] == row.original_sha256,
                "Stored reading receipt integrity differs",
            )
            if allowed_source_hashes is not None:
                require(
                    isinstance(allowed_source_hashes, (list, tuple, set, frozenset))
                    and all(_hash(h) for h in allowed_source_hashes)
                    and source_dependencies(receipt) <= set(allowed_source_hashes),
                    "Reading dependency is outside this exact generation",
                )
            receipts[row.receipt_sha256] = receipt
            hashes.update(source_dependencies(receipt))
        except ComparisonImportError:
            if not partial:
                raise
    rows = {}
    for batch in _batches(hashes):
        rows.update(
            (row.content_hash, row)
            for row in db.scalars(
                select(m.ElectionResultSource).where(
                    m.ElectionResultSource.content_hash.in_(batch)
                )
            )
        )
    require(partial or set(rows) == hashes, "Reading original is not retained")
    cache, size, local_values = OrderedDict(), 0, {}
    bodies, body, verified, proven, failed_sources = {}, None, {}, set(), set()
    for receipt_id, receipt in receipts.items():
        bodies.clear()
        body = None
        required = source_dependencies(receipt)
        try:
            require(required <= set(rows), "Reading original is not retained")
            require(
                all(
                    0 < rows[h].byte_size <= MAX_ORIGINAL_BYTES
                    and 0 < rows[h].compressed_byte_size <= MAX_ORIGINAL_BYTES * 2
                    for h in required
                )
                and sum(rows[h].byte_size for h in required) <= MAX_CLOSURE_BYTES,
                "Reading original proof exceeds bounded per-receipt closure",
            )
            for h in sorted(required):
                require(
                    h not in failed_sources,
                    "Reading original is unavailable or changed",
                )
                if h in cache:
                    body = cache.pop(h)
                    size -= len(body)
                else:
                    try:
                        body = read_source(store, rows[h])
                    except Exception as exc:
                        failed_sources.add(h)
                        raise ComparisonImportError(
                            "Reading original is unavailable or changed"
                        ) from exc
                while cache and size + len(body) > MAX_CLOSURE_BYTES:
                    _, old = cache.popitem(last=False)
                    size -= len(old)
                    del old
                cache[h] = body
                size += len(body)
                bodies[h] = body
            verify_receipt_sources(receipt, bodies)
            if receipt["source_context"] is not None:
                from alethical.pipeline.election_local_sources import (
                    replay_source_context,
                )

                local_values[receipt_id] = replay_source_context(receipt, bodies)
            outcomes[receipt_id] = True
            verified[receipt_id] = receipt
            proven.update(required)
        except ComparisonImportError:
            if not partial:
                raise
    return VerifiedReadingContext(
        verified,
        heads,
        proven,
        local_values,
        generation_bound=allowed_source_hashes is not None,
        outcomes=outcomes,
        failed_sources=failed_sources,
        _seal=_CONTEXT_SEAL,
    )


def reading_requirements(db, receipt_ids):
    """Private scoped dependency/version metadata, never byte proof."""
    heads = reading_heads(db, receipt_ids)
    result = {h: None for h in heads}
    for row in _receipt_rows(db, receipt_ids):
        receipt = validate_receipt(row.receipt)
        require(
            receipt_digest(receipt) == row.receipt_sha256
            and subject_key(receipt) == row.subject_key,
            "Stored reading receipt integrity differs",
        )
        result[row.receipt_sha256] = {
            "head": heads[row.receipt_sha256],
            "original_hashes": sorted(source_dependencies(receipt)),
            "field_gaps": [
                {
                    "measure": field["field_id"].removeprefix("cover."),
                    "label": field["label"],
                    "state": field["state"]
                    if field["state"] != "value"
                    else "unit_not_in_source",
                    "literal": field["literal"],
                    "source_sha256": receipt["original_sha256"],
                    "page": field["page"],
                    "field": field["field_id"],
                }
                for field in receipt["fields"]
                if field["record_type"] == "cover"
                and field["field_id"]
                in {
                    "cover.monetary_contributions",
                    "cover.in_kind_contributions",
                    "cover.total_received",
                    "cover.amount_on_hand",
                    "cover.disbursements",
                }
                and field["value_type"] == "money"
                and (field["state"] != "value" or field["currency"] is None)
            ],
        }
    return result


def record_reading(
    db, store, *, receipt, decision, reviewed_by, reason, expected_previous_id
):
    receipt = validate_receipt(receipt)
    require(
        decision in {"checked", "withdrawn"}
        and _string(reviewed_by, limit=500)
        and _string(reason, limit=8000),
        "Reading needs an explicit decision and private review record",
    )
    require(
        expected_previous_id is None
        or type(expected_previous_id) is int
        and expected_previous_id > 0,
        "Invalid expected reading predecessor",
    )
    key, content = subject_key(receipt), receipt_digest(receipt)
    request_key = digest(
        dict(
            subject_key=key,
            receipt_sha256=content,
            decision=decision,
            reviewed_by=reviewed_by,
            reason=reason,
            expected_previous_id=expected_previous_id,
        )
    )
    db.execute(
        text("SELECT pg_advisory_xact_lock(hashtext(:key))"),
        {"key": "source-reading:" + key},
    )
    if decision == "checked":
        verify_receipt_sources(
            receipt, _fresh_bodies(db, store, source_dependencies(receipt)), render=True
        )
    retry = db.scalar(
        select(m.ElectionSourceReadingDecision).where(
            m.ElectionSourceReadingDecision.request_key == request_key
        )
    )
    if retry is not None:
        return retry
    previous = db.scalar(
        select(m.ElectionSourceReadingDecision)
        .where(m.ElectionSourceReadingDecision.subject_key == key)
        .order_by(m.ElectionSourceReadingDecision.id.desc())
        .limit(1)
        .with_for_update()
    )
    require(
        (previous.id if previous else None) == expected_previous_id,
        "Source reading review changed",
    )
    if decision == "withdrawn":
        require(
            previous is not None
            and previous.receipt_sha256 == content
            and previous.receipt == receipt,
            "Withdrawal needs the exact preceding reading",
        )
    row = m.ElectionSourceReadingDecision(
        subject_key=key,
        receipt_sha256=content,
        original_sha256=receipt["original_sha256"],
        schema_id=SCHEMA,
        request_key=request_key,
        previous_decision_id=expected_previous_id,
        decision=decision,
        receipt=receipt,
        reason=reason,
        reviewed_by=reviewed_by,
        reviewed_at=datetime.now(UTC),
    )
    db.add(row)
    db.flush()
    return row
