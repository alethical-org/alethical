"""A read-only queue and machine fact drafts from the held station originals."""

from collections import defaultdict
from types import SimpleNamespace

from sqlalchemy import select

from alethical.api.services import tv_ad_review as review
from alethical.api.services import tv_ads as reader
from alethical.db import models as m
from alethical.pipeline.fcc_document_text import EXTRACTOR_VERSION


def _drafts(extraction, facts, pages=()):
    checked = {(f.field, f.value) for f in facts if f.status == "checked"}
    source = SimpleNamespace(
        safe_pages=[
            {"page": p.page, "text": p.text, "text_status": p.status} for p in pages
        ]
    )
    drafts = []
    for item in extraction.facts if extraction else []:
        if not isinstance(item, dict):
            continue
        name, value, page, quote = (
            item.get(k) for k in ("field", "value", "page", "quote")
        )
        if not isinstance(name, str):
            continue
        field = review.SUGGESTED_FIELDS.get(name, name)
        if (
            field not in review.FACT_FIELDS
            or not isinstance(value, str)
            or not value.strip()
            or not isinstance(quote, str)
            or not quote.strip()
            or isinstance(page, bool)
            or not isinstance(page, int)
            or page < 1
        ):
            continue
        drafts.append(
            {
                "field": field,
                "machine_field": name,
                "value": value,
                "page": page,
                "quote": quote,
                "in_safe_text": review._in_safe_text(source, page, quote),
                "already_checked": (field, value) in checked,
            }
        )
    return [
        {
            **{key: value for key, value in draft.items() if key != "in_safe_text"},
            "in_source_text": draft["in_safe_text"],
        }
        for draft in review._one_per_value(drafts, lambda d: (d["field"], d["value"]))
    ]


@reader.projection(scope="file")
def _suggestions(db, key, version):
    facility, file_id = reader.identity(key)
    identity = (facility, file_id, version)
    if identity not in db.info["tv_projection"]["documents"]:
        raise LookupError("Not found")
    extraction = db.get(m.FCCExtraction, (version, EXTRACTOR_VERSION))
    facts = reader._original_checks(db)["facts"].get(identity, [])
    return {
        "key": key,
        "version_id": version,
        "extraction_version": EXTRACTOR_VERSION,
        "facts": _drafts(extraction, facts, reader._source_pages(db, version)),
    }


def suggestions(db, key, version):
    return _suggestions(db, key, version, originals=True)


@reader.projection
def _queue(db, *, q, station, sort, limit, offset):
    """One current version per file, independently of any public-copy status.

    Reuse the original projection so corrections and withdrawals affect queue
    counts and priorities exactly as they affect an opened file. Reads of facts
    and extraction results are batched, never one query per file.
    """
    current = db.info["tv_projection"]["current"]
    facts = reader._original_checks(db)["facts"]
    extractions = (
        {
            e.content_hash: e
            for e in db.scalars(
                select(m.FCCExtraction).where(
                    m.FCCExtraction.version == EXTRACTOR_VERSION,
                    m.FCCExtraction.content_hash.in_(
                        {d.content_hash for d in current.values()}
                    ),
                )
            )
        }
        if current
        else {}
    )
    agency_files = defaultdict(set)
    for identity, checks in facts.items():
        for fact in checks:
            if fact.status == "checked" and fact.field == "agency_name":
                agency_files[fact.value].add(identity[:2])
    folder_links = {}
    for link in db.scalars(
        select(m.TVAdConnection)
        .where(
            m.TVAdConnection.scope == "folder",
            m.TVAdConnection.facility_id.in_(reader.STATIONS),
            m.TVAdConnection.status == "checked",
            m.TVAdConnection.kind == "committee",
            ~select(m.FinanceTVCopyWithdrawal.id)
            .where(m.FinanceTVCopyWithdrawal.connection_id == m.TVAdConnection.id)
            .exists(),
        )
        .order_by(m.TVAdConnection.checked_at.desc(), m.TVAdConnection.id)
    ):
        folder_links.setdefault((link.facility_id, link.folder_id), link)
    items = []
    for pair, document in current.items():
        station_info = reader.STATIONS[document.facility_id]
        if station and station not in (
            station_info.slug,
            station_info.call_sign,
            document.facility_id,
        ):
            continue
        if q.casefold() not in (document.name + " " + document.folder_path).casefold():
            continue
        identity = (*pair, document.content_hash)
        drafts = _drafts(
            extractions.get(document.content_hash), facts.get(identity, [])
        )
        reasons = []
        for name in sorted({d["value"] for d in drafts if d["field"] == "agency_name"}):
            if agency_files[name] - {pair}:
                reasons.append({"kind": "agency_checked_elsewhere", "label": name})
        folder = folder_links.get((document.facility_id, document.folder_id))
        if folder:
            reasons.append(
                {
                    "kind": "folder_committee_checked",
                    "label": str(
                        (folder.target_snapshot or {}).get("label") or folder.target_id
                    ),
                }
            )
        items.append((document, reasons, sum(not d["already_checked"] for d in drafts)))
    items.sort(
        key=lambda item: (
            -(
                2
                if any(r["kind"] == "agency_checked_elsewhere" for r in item[1])
                else bool(item[1])
            )
            if sort == "suggested"
            else 0,
            -item[2] if sort == "suggested" else 0,
            -item[0].first_seen_at.timestamp(),
            item[0].facility_id,
            item[0].file_id,
        )
    )
    return {
        "rows": [
            {
                **reader._row(db, reader._archive_copy(document)),
                "saved_at": reader.iso(document.first_seen_at),
                "suggestion_count": count,
                "reasons": reasons,
            }
            for document, reasons, count in items[offset : offset + limit]
        ],
        "total": len(items),
        "has_more": offset + limit < len(items),
        "limit": limit,
        "offset": offset,
        "q": q,
        "station": station,
        "sort": sort,
    }


def queue(db, *, q="", station="", sort="suggested", limit=50, offset=0):
    return _queue(
        db, q=q, station=station, sort=sort, limit=limit, offset=offset, originals=True
    )
