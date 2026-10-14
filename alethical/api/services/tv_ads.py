"""Private administrator archive access and separate approved-copy projections."""

from __future__ import annotations

import hashlib
import json
import re
from collections import defaultdict
from functools import partial, wraps
from datetime import date, datetime
from decimal import Decimal, InvalidOperation
from uuid import UUID
from types import SimpleNamespace
from urllib.parse import quote

from sqlalchemy import func, select, text
from sqlalchemy.orm import Session

from alethical.db import models as m
from alethical.api.services.tv_ad_review import (
    _folder_observations,
    original_page_count,
)
from alethical.pipeline.fcc_document_text import EXTRACTOR_VERSION
from alethical.pipeline import fcc_expense_links
from alethical.pipeline.fcc_public_files import DEFAULT_STATIONS

STATIONS = {s.facility_id: s for s in DEFAULT_STATIONS}


def projection(function=None, *, scope=None):
    if function is None:
        return partial(projection, scope=scope)

    @wraps(function)
    def read(db, *args, **kwargs):
        include_archive = kwargs.pop("include_archive", False)
        previous = db.info.get("tv_projection")
        if previous is not None:
            return function(db, *args, **kwargs)
        document_query = _documents(db)
        if scope:
            key = args[0] if args else kwargs["key"]
            if scope == "station":
                station = next(
                    (s for s in DEFAULT_STATIONS if key in (s.slug, s.call_sign)), None
                )
                if station is None:
                    raise LookupError("Not found")
                document_query = document_query.where(
                    m.FCCDocument.facility_id == station.facility_id
                )
            else:
                facility, identifier = identity(key)
                # Include every version of files ever in the relevant folders. A
                # source can move folders, and an older approved copy can still
                # refer to its original folder. Current selection happens below.
                folder_ids = (
                    select(m.FCCDocument.folder_id).where(
                        m.FCCDocument.facility_id == facility,
                        m.FCCDocument.file_id == identifier,
                    )
                    if scope == "file"
                    else [identifier]
                )
                file_ids = select(m.FCCDocument.file_id).where(
                    m.FCCDocument.facility_id == facility,
                    m.FCCDocument.folder_id.in_(folder_ids),
                )
                document_query = document_query.where(
                    m.FCCDocument.facility_id == facility,
                    m.FCCDocument.file_id.in_(file_ids),
                )
        documents = list(db.scalars(document_query))
        versions = defaultdict(int)
        current = {}
        for d in documents:
            file_identity = (d.facility_id, d.file_id)
            versions[file_identity] += 1
            prior = current.get(file_identity)
            if prior is None or (
                d.last_downloaded_at,
                d.last_seen_at,
                d.content_hash,
            ) > (prior.last_downloaded_at, prior.last_seen_at, prior.content_hash):
                current[file_identity] = d
        facts = defaultdict(list)
        for f in db.scalars(
            select(m.TVAdFact)
            .join(m.TVAdPublication, m.TVAdFact.publication_id == m.TVAdPublication.id)
            .where(
                m.TVAdPublication.status == "approved",
                m.TVAdPublication.facility_id.in_(STATIONS),
            )
            .order_by(m.TVAdFact.checked_at, m.TVAdFact.id)
        ):
            facts[f.publication_id].append(f)
        db.info["tv_projection"] = {
            "documents": {
                (d.facility_id, d.file_id, d.content_hash): d for d in documents
            },
            "versions": versions,
            "current": current,
            "facts": facts,
            "include_archive": include_archive,
            "document_query": document_query,
            "scoped": bool(scope),
        }
        try:
            return function(db, *args, **kwargs)
        finally:
            db.info.pop("tv_projection", None)

    return read


def iso(value):
    return value.isoformat() if isinstance(value, (date, datetime)) else value


def identity(key: str) -> tuple[str, str]:
    for station in DEFAULT_STATIONS:
        prefix = station.slug + "-"
        if key.startswith(prefix) and key[len(prefix) :] and len(key) <= 220:
            return station.facility_id, key[len(prefix) :]
    raise LookupError("Not found")


def file_key(facility_id: str, file_id: str) -> str:
    return STATIONS[facility_id].slug + "-" + file_id


def _documents(db, facility_id=None):
    query = select(m.FCCDocument).where(m.FCCDocument.facility_id.in_(STATIONS))
    if facility_id:
        query = query.where(m.FCCDocument.facility_id == facility_id)
    return query


def counts(db: Session, facility_id: str | None = None) -> dict:
    """Different denominators deliberately remain separate; never sum these."""
    params = {"station": facility_id, "reader": EXTRACTOR_VERSION}
    row = (
        db.execute(
            text("""
    WITH docs AS (
      SELECT * FROM fcc_document WHERE facility_id IN ('28010','23079','68883')
      AND (CAST(:station AS text) IS NULL OR facility_id=:station)
    ), latest AS (
      SELECT DISTINCT ON (facility_id,file_id) * FROM docs
      ORDER BY facility_id,file_id,last_downloaded_at DESC,last_seen_at DESC,content_hash
    ), outcomes AS (
      SELECT DISTINCT ON (facility_id,details->>'file_id') facility_id,details->>'file_id' file_id,status
      FROM fcc_observation WHERE kind='file' AND status IN ('stored','failed','unavailable')
      AND details->>'file_id' IS NOT NULL AND facility_id IN ('28010','23079','68883')
      AND (CAST(:station AS text) IS NULL OR facility_id=:station)
      ORDER BY facility_id,details->>'file_id',observed_at DESC,scan_id DESC
    ) SELECT
      (SELECT count(*) FROM latest) station_files_held,
      (SELECT count(DISTINCT content_hash) FROM docs) unique_file_contents,
      (SELECT count(*) FROM latest d JOIN fcc_extraction e ON e.content_hash=d.content_hash
        AND e.version=:reader WHERE e.status IN ('partial','failed','unreadable','needs_ocr')
        OR EXISTS (SELECT 1 FROM fcc_page p WHERE p.content_hash=e.content_hash
          AND p.version=e.version AND p.status IN ('partial','failed','unreadable','needs_ocr'))) text_read_failures,
      (SELECT count(*) FROM outcomes WHERE status IN ('failed','unavailable')) download_failures
    """),
            params,
        )
        .mappings()
        .one()
    )
    approved = _approved(db, facility_id)
    ids = [p.id for p in approved]
    checked = set()
    if ids:
        by_id = {p.id: (p.facility_id, p.file_id) for p in approved}
        for c in db.scalars(
            select(m.TVAdConnection).where(
                m.TVAdConnection.publication_id.in_(ids),
                m.TVAdConnection.scope == "file",
                m.TVAdConnection.status == "checked",
                m.TVAdConnection.publication_approved.is_(True),
            )
        ):
            checked.add(by_id[c.publication_id])
    return {
        **dict(row),
        "files_with_approved_copy": len({(p.facility_id, p.file_id) for p in approved}),
        "checked_connection_files": len(checked),
    }


def _approved(db, facility_id=None):
    query = select(m.TVAdPublication).where(
        m.TVAdPublication.status == "approved",
        m.TVAdPublication.facility_id.in_(STATIONS),
    )
    if facility_id:
        query = query.where(m.TVAdPublication.facility_id == facility_id)
    return list(
        db.scalars(
            query.order_by(m.TVAdPublication.created_at.desc(), m.TVAdPublication.id)
        )
    )


def _document(db, p):
    key = (p.facility_id, p.file_id, p.content_hash)
    cache = db.info.get("tv_projection")
    return (
        cache["documents"][key]
        if cache and key in cache["documents"]
        else db.get(m.FCCDocument, key)
    )


def _facts(db, publication_id):
    if not isinstance(publication_id, UUID):
        return []
    cache = db.info.get("tv_projection")
    if cache is not None:
        return cache["facts"].get(publication_id, [])
    return list(
        db.scalars(
            select(m.TVAdFact)
            .where(m.TVAdFact.publication_id == publication_id)
            .order_by(m.TVAdFact.checked_at, m.TVAdFact.id)
        )
    )


# Printed form labels where the field name is not the words on the document.
FACT_LABELS = {"billing_recipient": "Bill to", "requested_by": "Requested by"}


def _fact_kind(field):
    return FACT_LABELS.get(field) or field.replace("_", " ").capitalize()


def _fact_payload(db, fact, version_id):
    if fact.status == "withdrawn":
        return {
            "id": str(fact.id),
            "kind": _fact_kind(fact.field),
            "status": "withdrawn",
            "withdrawn_at": iso(fact.withdrawn_at),
            "version_id": version_id,
        }
    return {
        "id": str(fact.id),
        "kind": _fact_kind(fact.field),
        "value": _money(fact.value) if fact.field.endswith("_amount") else fact.value,
        "qualifier": getattr(fact, "qualifier", None),
        "role": getattr(fact, "role", None),
        "quote": fact.quote,
        "page": fact.page,
        "version_id": version_id,
        "checked_at": iso(fact.checked_at),
        "status": "checked",
        "history": _fact_history(db, fact),
    }


def _row(db, p):
    doc = _document(db, p)
    facts = _facts(db, p.id) if p.status == "approved" else []
    kind = next(
        (
            f.value
            for f in facts
            if f.field == "document_kind"
            and f.status == "checked"
            and f.publication_approved
        ),
        None,
    )
    current = (
        db.info["tv_projection"]["current"].get((p.facility_id, p.file_id))
        if (p.facility_id, p.file_id)
        in db.info.get("tv_projection", {}).get("current", {})
        else db.scalar(
            _documents(db, p.facility_id)
            .where(m.FCCDocument.file_id == p.file_id)
            .order_by(
                m.FCCDocument.last_downloaded_at.desc(),
                m.FCCDocument.last_seen_at.desc(),
                m.FCCDocument.content_hash.desc(),
            )
            .limit(1)
        )
    )
    return {
        "source_changed": current is not None
        and current.content_hash != p.content_hash,
        "key": file_key(p.facility_id, p.file_id),
        "name": p.safe_title,
        "label": p.safe_title,
        "station": STATIONS[p.facility_id].call_sign,
        "year": doc.year,
        "category": p.category,
        "kind": kind,
        "uploaded_at": doc.uploaded_at,
        "version_id": p.content_hash,
        "copy_id": None if p.status == "archive" else str(p.id),
        "airing_periods": [
            f.value
            for f in facts
            if f.status == "checked"
            and f.publication_approved
            and f.field == "scheduled_airing"
        ],
        "version_count": db.info["tv_projection"]["versions"][
            (p.facility_id, p.file_id)
        ]
        if (p.facility_id, p.file_id)
        in db.info.get("tv_projection", {}).get("versions", {})
        else db.scalar(
            select(func.count())
            .select_from(m.FCCDocument)
            .where(
                m.FCCDocument.facility_id == p.facility_id,
                m.FCCDocument.file_id == p.file_id,
            )
        ),
    }


def _latest_copies(db, facility_id=None, *, metadata=True):
    """Most recently downloaded source, then newest approved derivative of that body."""
    query = select(m.TVAdPublication).where(
        m.TVAdPublication.facility_id.in_(STATIONS),
        m.TVAdPublication.status != "withdrawn",
    )
    query = query.where(
        m.TVAdPublication.metadata_approved.is_(True)
        if metadata
        else m.TVAdPublication.status == "approved"
    )
    if facility_id:
        query = query.where(m.TVAdPublication.facility_id == facility_id)
    cache = db.info.get("tv_projection", {})
    if cache.get("scoped"):
        # The scope query includes complete file histories, never just one body.
        scope_docs = cache["document_query"].subquery()
        query = query.where(
            select(scope_docs.c.file_id)
            .where(
                scope_docs.c.facility_id == m.TVAdPublication.facility_id,
                scope_docs.c.file_id == m.TVAdPublication.file_id,
            )
            .exists()
        )
    copies = list(db.scalars(query))
    copies.sort(
        key=lambda p: (_document(db, p).last_downloaded_at, p.created_at, str(p.id)),
        reverse=True,
    )
    found = {}
    for p in copies:
        found.setdefault((p.facility_id, p.file_id), p)
    if metadata and _archive_access(db):
        # Access to a source is not an approval. Use current held bytes even when
        # an older version has a publishable derivative.
        for key, doc in db.info["tv_projection"]["current"].items():
            if facility_id and doc.facility_id != facility_id:
                continue
            copy = found.get(key)
            if (
                copy is None
                or copy.content_hash != doc.content_hash
                or copy.status != "approved"
            ):
                found[key] = _archive_copy(doc)
    return sorted(
        found.values(),
        key=lambda p: (p.safe_title.casefold(), file_key(p.facility_id, p.file_id)),
    )


def _representative(copies, document):
    """The file a folder row describes itself by: an approved copy before a held
    original, then the most recently downloaded, never whichever sorts first."""

    def rank(p):
        downloaded = document(p).last_downloaded_at
        return (
            p.status == "approved",
            downloaded.timestamp() if downloaded else float("-inf"),
        )

    return max(copies, key=rank)


def _archive_access(db):
    return db.info.get("tv_projection", {}).get("include_archive", False)


def _archive_copy(doc):
    parts = doc.folder_path.split("/")
    category = next(
        (
            part
            for part in parts[1:]
            if part.casefold()
            in {"federal", "state", "local", "non-candidate issue ads", "terms"}
        ),
        "",
    )
    return SimpleNamespace(
        id=(doc.facility_id, doc.file_id, doc.content_hash),
        facility_id=doc.facility_id,
        file_id=doc.file_id,
        content_hash=doc.content_hash,
        status="archive",
        safe_title=doc.name,
        safe_folder=parts[-1],
        category=category.capitalize(),
        safe_pages=[],
    )


def _source_pages(db, content_hash):
    cache = db.info.get("tv_projection", {})
    if "source_pages" in cache:
        return cache["source_pages"].get(content_hash, [])
    return list(
        db.scalars(
            select(m.FCCPage)
            .where(
                m.FCCPage.content_hash == content_hash,
                m.FCCPage.version == EXTRACTOR_VERSION,
            )
            .order_by(m.FCCPage.page)
        )
    )


def _agency_names(db, copy):
    checked = {
        f.value
        for f in _facts(db, copy.id)
        if f.field == "agency_name" and f.status == "checked" and f.publication_approved
    }
    result = {name: False for name in checked}
    if _archive_access(db):
        cache = db.info["tv_projection"]
        if "extractions" not in cache:
            cache["extractions"] = {
                row.content_hash: row.facts
                for row in db.execute(
                    select(m.FCCExtraction.content_hash, m.FCCExtraction.facts).where(
                        m.FCCExtraction.version == EXTRACTOR_VERSION,
                        m.FCCExtraction.facts.contains([{"field": "agency_name"}]),
                    )
                )
            }
        for f in cache["extractions"].get(copy.content_hash, []):
            if (
                f.get("field") == "agency_name"
                and isinstance(f.get("value"), str)
                and f["value"].strip()
            ):
                result.setdefault(f["value"], True)
    return result


def _upload_date(raw):
    for fmt in ("%m/%d/%Y", "%Y-%m-%d", "%m/%d/%Y %I:%M %p"):
        try:
            return datetime.strptime((raw or "").strip(), fmt)
        except ValueError:
            pass
    return datetime.min


def sources(db: Session, station: str | None = None):
    stations = [
        s for s in DEFAULT_STATIONS if not station or station in (s.call_sign, s.slug)
    ]
    facilities = [s.facility_id for s in stations]
    copies, uploads = {}, defaultdict(list)
    for facility, raw, latest in db.execute(
        select(
            m.FCCDocument.facility_id,
            m.FCCDocument.uploaded_at,
            func.max(m.FCCDocument.last_downloaded_at),
        )
        .where(m.FCCDocument.facility_id.in_(facilities))
        .group_by(m.FCCDocument.facility_id, m.FCCDocument.uploaded_at)
    ):
        copies[facility] = max(latest, copies.get(facility, latest))
        parsed = _upload_date(raw)
        if parsed != datetime.min:
            uploads[facility].append(parsed.date())
    listed = dict(
        db.execute(
            select(m.FCCObservation.facility_id, func.max(m.FCCObservation.observed_at))
            .where(
                m.FCCObservation.facility_id.in_(facilities),
                m.FCCObservation.kind == "folder",
                m.FCCObservation.status == "stored",
            )
            .group_by(m.FCCObservation.facility_id)
        ).all()
    )
    return {
        "stations": [
            {
                "call_sign": s.call_sign,
                "facility_id": s.facility_id,
                "fcc_url": s.root_url,
                "newest_upload": iso(max(uploads[s.facility_id]))
                if uploads[s.facility_id]
                else None,
                "last_list_check": iso(listed.get(s.facility_id)),
                "last_file_copy": iso(copies.get(s.facility_id)),
            }
            for s in stations
        ],
        "text_reader_version": EXTRACTOR_VERSION,
    }


@projection
def recent(db):
    copies = _latest_copies(db)
    groups = []
    for station in DEFAULT_STATIONS:
        group = [p for p in copies if p.facility_id == station.facility_id]
        group.sort(
            key=lambda p: (
                _upload_date(_document(db, p).uploaded_at),
                file_key(p.facility_id, p.file_id),
            ),
            reverse=True,
        )
        groups.append(
            {"call_sign": station.call_sign, "files": [_row(db, p) for p in group[:3]]}
        )
    return {"stations": groups}


def agency_key(name):
    return hashlib.sha256(name.encode()).hexdigest()


@projection
def browse(
    db,
    *,
    tab="folders",
    q="",
    station="",
    year=None,
    category="",
    page=1,
    default_year=False,
):
    # These controls exist only in folder browsing; hidden constraints must not filter other tabs.
    if tab != "folders":
        station, year, category = "", None, ""
    copies = _latest_copies(db)
    docs = {p.id: _document(db, p) for p in copies}
    folders = _folders(db)
    years = sorted(
        {d.year for d in docs.values() if d.year}
        | {y for y, c in map(_folder_date_parts, folders) if y},
        reverse=True,
    )
    if default_year and tab == "folders" and not q and year is None and years:
        year = years[0]
    categories = sorted(
        {p.category for p in copies if p.category}
        | {c for y, c in map(_folder_date_parts, folders) if c}
    )
    selected = [
        p
        for p in copies
        if (not station or STATIONS[p.facility_id].call_sign == station)
        and (not year or docs[p.id].year == year)
        and (not category or p.category == category)
    ]
    # Count the same safe folder identities available through folder browsing,
    # including reviewed empty folders, once per station and year.
    folder_years = {
        (f.facility_id, f.folder_id): _folder_date_parts(f)[0] for f in folders
    }
    folder_years.update(
        {(p.facility_id, docs[p.id].folder_id): docs[p.id].year for p in copies}
    )
    rows = []
    if q:
        if _archive_access(db):
            page_cache = defaultdict(list)
            hashes = {p.content_hash for p in selected if p.status == "archive"}
            if hashes:
                page_query = select(
                    m.FCCPage.content_hash, m.FCCPage.page, m.FCCPage.text
                ).where(
                    m.FCCPage.content_hash.in_(hashes),
                    m.FCCPage.version == EXTRACTOR_VERSION,
                )
                if q.isascii():
                    # A conservative indexed candidate search; Python below still
                    # owns exact Unicode casefold matching and excerpt selection.
                    # These letters can be produced by non-ASCII casefold
                    # expansions (e.g. ß -> ss, ﬂ -> fl). Search the longest
                    # unaffected run so those matches cannot be discarded.
                    needle = max(re.split("[afhijklnstwy]", q.casefold()), key=len)
                    if needle:
                        escaped = (
                            needle.replace("\\", "\\\\")
                            .replace("%", "\\%")
                            .replace("_", "\\_")
                        )
                        page_query = page_query.where(
                            m.FCCPage.text.ilike("%" + escaped + "%", escape="\\")
                        )
                for part in db.execute(page_query.order_by(m.FCCPage.page)):
                    page_cache[part.content_hash].append(part)
            db.info["tv_projection"]["source_pages"] = page_cache
        query = q.casefold()
        for p in selected:
            row = _row(db, p)
            match = None
            for label, value in [
                ("File name", p.safe_title),
                ("Folder label", p.safe_folder),
            ]:
                if query in value.casefold():
                    match = (label, value, False)
                    break
            if match is None:
                for fact in _facts(db, p.id):
                    if (
                        fact.status == "checked"
                        and fact.publication_approved
                        and query in fact.value.casefold()
                    ):
                        match = ("Checked fact", fact.value, False)
                        break
            if match is None:
                parts = p.safe_pages if p.status == "approved" else []
                if p.status == "archive":
                    parts = [
                        {"page": part.page, "text": part.text}
                        for part in _source_pages(db, p.content_hash)
                    ]
                for part in parts:
                    value = part.get("text", "")
                    idx = value.casefold().find(query)
                    if idx >= 0:
                        match = (
                            f"Machine-read text · page {part['page']}",
                            value[max(0, idx - 80) : idx + len(q) + 160],
                            True,
                        )
                        break
            if match:
                rows.append(
                    {
                        **row,
                        "match_label": match[0],
                        "excerpt": match[1],
                        "text_match": match[2],
                    }
                )
    elif tab == "folders":
        groups = defaultdict(list)
        for p in selected:
            groups[(p.facility_id, docs[p.id].folder_id)].append(p)
        for (facility, folder), group in groups.items():
            p = _representative(group, lambda c: docs[c.id])
            rows.append(
                {
                    "key": file_key(facility, folder),
                    "label": p.safe_folder,
                    "station": STATIONS[facility].call_sign,
                    "year": docs[p.id].year,
                    "category": p.category,
                    "file_count": len(group),
                }
            )
        represented = {row["key"] for row in rows}
        for f in folders:
            y, c = _folder_date_parts(f)
            key = file_key(f.facility_id, f.folder_id)
            if (
                key in represented
                or (station and STATIONS[f.facility_id].call_sign != station)
                or (year and y != year)
                or (category and c != category)
            ):
                continue
            rows.append(
                {
                    "key": key,
                    "label": f.safe_label,
                    "station": STATIONS[f.facility_id].call_sign,
                    "year": y,
                    "category": c,
                    "file_count": 0,
                }
            )
    elif tab == "agencies":
        groups = defaultdict(set)
        unchecked = defaultdict(bool)
        for p in selected:
            for name, pending in _agency_names(db, p).items():
                groups[name].add((p.facility_id, p.file_id))
                unchecked[name] |= pending
        rows = [
            {
                "key": agency_key(name),
                "label": name,
                "file_count": len(ids),
                "unchecked": unchecked[name],
                "stations": sorted(
                    {STATIONS[facility].call_sign for facility, _ in ids}
                ),
            }
            for name, ids in groups.items()
        ]
    elif tab == "stations":
        rows = [
            {
                "key": s.slug,
                "label": s.call_sign,
                "station": s.call_sign,
                "folder_count": sum(
                    facility == s.facility_id for facility, _ in folder_years
                ),
                "file_count": len(
                    [p for p in selected if p.facility_id == s.facility_id]
                ),
            }
            for s in DEFAULT_STATIONS
        ]
    elif tab == "years":
        rows = [
            {
                "key": str(y),
                "label": str(y),
                "year": y,
                "folder_count": sum(
                    folder_year == y for folder_year in folder_years.values()
                ),
                "file_count": len([p for p in selected if docs[p.id].year == y]),
            }
            for y in years
        ]
    else:
        raise ValueError("Unknown browse view")
    rows.sort(key=lambda r: (r["label"].casefold(), r["key"]))
    total = len(rows)
    rows = rows[:500]
    return {
        "tab": tab,
        "q": q,
        "station": station,
        "year": year,
        "category": category,
        "page": page,
        "page_size": 12,
        "total": min(total, 500),
        "capped": total > 500,
        "rows": rows[(page - 1) * 12 : page * 12],
        "years": years,
        "categories": categories,
    }


def _connection_payload(db, c, version_id, key):
    if c.status == "withdrawn":
        return {
            "id": str(c.id),
            "kind": c.kind,
            "status": "withdrawn",
            "withdrawn_at": iso(c.withdrawn_at),
            "version_id": version_id,
        }
    snapshot = c.target_snapshot or {}
    item = {
        "id": str(c.id),
        "kind": c.kind,
        "label": snapshot.get("label", c.target_id),
        "href": snapshot.get("href", ""),
        "role": snapshot.get("role", ""),
        "quote": c.quote,
        "page": c.page,
        "version_id": version_id,
        "checked_at": iso(c.checked_at),
        "status": "checked",
    }
    if c.kind == "expense":
        item.update(
            reported_amount=_money(snapshot.get("source_row", {}).get("amount"))
            if snapshot.get("source_row", {}).get("amount") is not None
            else None,
            reported_date=snapshot.get("source_row", {}).get("transaction_date"),
            source_changed=_expense_changed(db, c),
            href=f"/money/ads/files/{quote(key)}?version={version_id}&copy={c.publication_id}&expense={c.id}",
            evidence_label=f"Row {snapshot.get('source_row_number')} in Alethical’s saved copy of the Campaign Finance Board records",
        )
    return item


@projection(scope="file")
def file_detail(db, key, version=None, copy_id=None):
    facility, file_id = identity(key)
    docs = list(
        db.scalars(
            _documents(db, facility)
            .where(m.FCCDocument.file_id == file_id)
            .order_by(m.FCCDocument.first_seen_at.desc(), m.FCCDocument.content_hash)
        )
    )
    if not docs:
        raise LookupError("Not found")
    pubs = list(
        db.scalars(
            select(m.TVAdPublication)
            .where(
                m.TVAdPublication.facility_id == facility,
                m.TVAdPublication.file_id == file_id,
            )
            .order_by(m.TVAdPublication.created_at.desc())
        )
    )
    by_hash: dict[str, m.TVAdPublication] = {}
    for p in pubs:
        if p.status != "withdrawn" and p.metadata_approved:
            by_hash.setdefault(p.content_hash, p)
    current_docs = sorted(
        docs,
        key=lambda d: (d.last_downloaded_at, d.last_seen_at, d.content_hash),
        reverse=True,
    )
    selected = (
        by_hash.get(version)
        if version
        else next(
            (
                by_hash[d.content_hash]
                for d in current_docs
                if d.content_hash in by_hash
            ),
            None,
        )
    )
    if copy_id is not None:
        exact = next(
            (
                p
                for p in pubs
                if p.id == copy_id and (not version or p.content_hash == version)
            ),
            None,
        )
        if exact is None:
            raise LookupError("Not found")
        if exact.status == "withdrawn":
            return {
                "key": key,
                "copy_status": "withdrawn",
                "withdrawn_at": iso(exact.withdrawn_at),
                "versions": [],
            }
        selected = exact if exact.metadata_approved else None
    if _archive_access(db) and copy_id is None:
        requested = (
            next((d for d in docs if d.content_hash == version), None)
            if version
            else current_docs[0]
        )
        if requested is None:
            raise LookupError("Not found")
        if (
            selected is None
            or selected.content_hash != requested.content_hash
            or selected.status != "approved"
        ):
            return _archive_detail(db, key, requested, docs, current_docs[0], pubs)
    versions = [
        {
            "id": d.content_hash,
            "first_saved_at": iso(d.first_seen_at),
            "uploaded_at": d.uploaded_at,
            "status": _version_status(d.content_hash, pubs)
            if _archive_access(db)
            else (
                by_hash[d.content_hash].status
                if d.content_hash in by_hash
                else "withdrawn"
                if any(
                    p.content_hash == d.content_hash and p.status == "withdrawn"
                    for p in pubs
                )
                else "pending"
            ),
        }
        for d in docs
    ]
    if not selected:
        withdrawn = next(
            (
                p
                for p in pubs
                if p.status == "withdrawn"
                and (not version or p.content_hash == version)
            ),
            None,
        )
        if withdrawn:
            return {
                "key": key,
                "copy_status": "withdrawn",
                "withdrawn_at": iso(withdrawn.withdrawn_at),
                "versions": versions,
            }
        # Unapproved listing names/labels are not a safe title or metadata fallback.
        raise LookupError("Not found")
    doc = _document(db, selected)
    approved = selected.status == "approved"
    facts = [
        _fact_payload(db, f, selected.content_hash)
        for f in _facts(db, selected.id)
        if approved and (f.publication_approved or f.status == "withdrawn")
    ]
    date_fields = {"Invoice date", "Scheduled airing", "Start date", "End date"}
    connections = [
        _connection_payload(db, c, selected.content_hash, key)
        for c in db.scalars(
            select(m.TVAdConnection)
            .where(
                m.TVAdConnection.publication_id == selected.id,
                m.TVAdConnection.scope == "file",
            )
            .order_by(m.TVAdConnection.checked_at, m.TVAdConnection.id)
        )
        if approved and (c.publication_approved or c.status == "withdrawn")
    ]
    artifacts = {part["page"]: part for part in selected.artifacts.get("pages", [])}
    pages = (
        [
            {
                "number": part["page"],
                "text": part.get("text"),
                "text_status": {
                    "readable": "ready",
                    "unreadable": "failed",
                    "not_read": "pending",
                }.get(part.get("text_status"), part.get("text_status", "ready")),
                "image_path": f"/ads/files/{quote(key)}/pages/{part['page']}?version={selected.content_hash}&copy={selected.id}"
                if part["page"] in artifacts
                else None,
            }
            for part in selected.safe_pages
        ]
        if approved
        else []
    )
    other = [
        _row(db, p)
        for p in _latest_copies(db, facility)
        if p.file_id != file_id and _document(db, p).folder_id == doc.folder_id
    ][:12]
    return {
        **_row(db, selected),
        "folder": {
            "key": file_key(facility, doc.folder_id),
            "label": selected.safe_folder,
        },
        "fcc_url": doc.url,
        "fcc_available": _fcc_available(db, facility, file_id),
        "versions": versions,
        "version_id": selected.content_hash,
        "copy_id": str(selected.id),
        "copy_status": "approved" if approved else "not_ready",
        "page_count": len(pages),
        "pages": pages,
        "facts": [f for f in facts if f["kind"] not in date_fields],
        "dates": [f for f in facts if f["kind"] in date_fields],
        "connections": [c for c in connections if c["kind"] != "related_document"],
        "related": _related(db, selected),
        "other_files": other,
        "source_changed": current_docs[0].content_hash != selected.content_hash,
        "current_source_version": current_docs[0].content_hash,
        "newest_approved_version": next(
            (
                d.content_hash
                for d in current_docs
                if d.content_hash in by_hash
                and by_hash[d.content_hash].status == "approved"
            ),
            None,
        ),
    }


def _version_status(content_hash, pubs):
    return (
        "approved"
        if any(p.content_hash == content_hash and p.status == "approved" for p in pubs)
        else "archive"
    )


def _archive_detail(db, key, doc, docs, current, pubs):
    pages = _source_pages(db, doc.content_hash)
    # Text extraction is optional; source pages remain usable before extraction.
    count = max((p.page for p in pages), default=0) or original_page_count(
        db, doc.facility_id, doc.file_id, doc.content_hash
    )
    numbers = range(1, count + 1)
    text_by_page = {p.page: p for p in pages}
    copy = _archive_copy(doc)
    return {
        **_row(db, copy),
        "folder": {
            "key": file_key(doc.facility_id, doc.folder_id),
            "label": copy.safe_folder,
        },
        "fcc_url": doc.url,
        "fcc_available": _fcc_available(db, doc.facility_id, doc.file_id),
        "versions": [
            {
                "id": d.content_hash,
                "first_saved_at": iso(d.first_seen_at),
                "uploaded_at": d.uploaded_at,
                "status": _version_status(d.content_hash, pubs),
            }
            for d in docs
        ],
        "copy_status": "archive",
        "page_count": len(numbers),
        "pages": [
            {
                "number": n,
                "text": text_by_page[n].text if n in text_by_page else None,
                "text_status": "ready"
                if n in text_by_page and text_by_page[n].status == "readable"
                else "partial"
                if n in text_by_page and text_by_page[n].text
                else "pending",
                "image_path": f"/ads/files/{quote(key)}/source-pages/{n}?version={doc.content_hash}",
            }
            for n in numbers
        ],
        "facts": [],
        "dates": [],
        "connections": [],
        "related": [],
        "other_files": [
            _row(db, p)
            for p in _latest_copies(db, doc.facility_id)
            if p.file_id != doc.file_id and _document(db, p).folder_id == doc.folder_id
        ][:12],
        "current_source_version": current.content_hash,
        "newest_approved_version": next(
            (p.content_hash for p in pubs if p.status == "approved"), None
        ),
    }


def approved_media(db, key, version, copy_id):
    facility, file_id = identity(key)
    p = db.get(m.TVAdPublication, copy_id, populate_existing=True)
    if (
        p is None
        or p.status not in ("approved", "withdrawn")
        or (p.facility_id, p.file_id, p.content_hash) != (facility, file_id, version)
    ):
        raise LookupError("Not found")
    return p


def _folders(db, facility_id=None):
    query = select(m.TVAdFolderApproval).where(
        m.TVAdFolderApproval.status == "approved",
        m.TVAdFolderApproval.facility_id.in_(STATIONS),
    )
    if facility_id:
        query = query.where(m.TVAdFolderApproval.facility_id == facility_id)
    result = {}
    for row in db.scalars(
        query.order_by(m.TVAdFolderApproval.created_at.desc(), m.TVAdFolderApproval.id)
    ):
        result.setdefault((row.facility_id, row.folder_id), row)
    return list(result.values())


def _folder_date_parts(folder):
    return folder.year, folder.category


@projection(scope="folder")
def folder_detail(db, key):
    facility, folder_id = identity(key)
    copies = [
        p
        for p in _latest_copies(db, facility)
        if _document(db, p).folder_id == folder_id
    ]
    folder = next((f for f in _folders(db, facility) if f.folder_id == folder_id), None)
    if not copies and folder is None:
        raise LookupError("Not found")
    first = _representative(copies, lambda c: _document(db, c)) if copies else None
    doc = _document(db, first) if first else None
    if folder:
        year, category = _folder_date_parts(folder)
        label = folder.safe_label
    else:
        assert doc is not None and first is not None
        year, category = doc.year, first.category
        label = first.safe_folder
    relationship = None
    if folder:
        relationship = db.scalar(
            select(m.TVAdConnection)
            .where(
                m.TVAdConnection.facility_id == facility,
                m.TVAdConnection.folder_id == folder_id,
                m.TVAdConnection.folder_content_hash == folder.content_hash,
                m.TVAdConnection.scope == "folder",
                m.TVAdConnection.status == "checked",
                m.TVAdConnection.publication_approved.is_(True),
            )
            .order_by(m.TVAdConnection.checked_at.desc())
            .limit(1)
        )
    source = (
        sorted(
            _folder_observations(db, facility, folder_id, folder.content_hash),
            key=lambda row: (row.observed_at, str(row.scan_id)),
            reverse=True,
        )[0].url
        if folder
        else STATIONS[facility].root_url
    )
    return {
        "key": key,
        "label": label,
        "station": STATIONS[facility].call_sign,
        "year": year,
        "category": category,
        "fcc_url": source,
        "relationship": _connection_payload(
            db, relationship, relationship.folder_content_hash, key
        )
        if relationship
        else None,
        "files": [_row(db, p) for p in copies],
    }


@projection
def agency_detail(db, key):
    groups = defaultdict(list)
    name = None
    addresses = []
    unchecked = False
    for p in _latest_copies(db):
        facts = [
            f
            for f in _facts(db, p.id)
            if f.status == "checked" and f.publication_approved
        ]
        candidates = _agency_names(db, p)
        candidate = next((name for name in candidates if agency_key(name) == key), None)
        if candidate is None:
            continue
        name = candidate
        pending = candidates[name]
        unchecked |= pending
        row = {**_row(db, p), "agency_unchecked": pending}
        groups[(row["station"], row["year"])].append(row)
        for f in facts:
            if (
                f.field == "organization_address"
                and getattr(f, "agency_address_reviewed", False)
                and getattr(f, "organization_name", None) == name
            ):
                addresses.append(
                    {
                        "address": f.value,
                        "role": f.role,
                        "evidence": [
                            {
                                "file_key": row["key"],
                                "file_name": row["name"],
                                "version_id": p.content_hash,
                                "copy_id": str(p.id),
                                "page": f.page,
                                "uploaded_at": row["uploaded_at"],
                                "checked_at": iso(f.checked_at),
                            }
                        ],
                    }
                )
    if name is None:
        raise LookupError("Not found")
    return {
        "key": key,
        "name": name,
        "unchecked": unchecked,
        "payments_href": f"/money/payments?name={quote(name)}&role=vendor",
        "groups": [
            {"station": station, "year": year, "files": files}
            for (station, year), files in groups.items()
        ],
        "addresses": addresses,
    }


@projection(scope="station")
def station_detail(db, key):
    station = next((s for s in DEFAULT_STATIONS if key in (s.slug, s.call_sign)), None)
    if station is None:
        raise LookupError("Not found")
    # Only approved folder labels/categories are grouped; catalogue totals stay separately labelled.
    copies = _latest_copies(db, station.facility_id)
    grouped = defaultdict(lambda: defaultdict(set))
    files = defaultdict(set)
    for p in copies:
        d = _document(db, p)
        grouped[d.year][p.category].add(d.folder_id)
        files[d.year].add(d.file_id)
    for f in _folders(db, station.facility_id):
        y, c = _folder_date_parts(f)
        grouped[y][c].add(f.folder_id)
    observations = (
        db.execute(
            text("""SELECT DISTINCT ON (url) status FROM fcc_observation
        WHERE facility_id=:id AND kind='folder' ORDER BY url,observed_at DESC,scan_id DESC"""),
            {"id": station.facility_id},
        )
        .scalars()
        .all()
    )
    dates = sources(db, station.call_sign)["stations"][0]
    return {
        **dates,
        "counts": counts(db, station.facility_id),
        # Folders holding saved records, the same unit as the Stations tab and this
        # page's year table; FCC folder pages we listed (including empty, year and
        # office folders) only feed "Folders we couldn't list".
        "folder_count": len(
            {
                folder
                for cats in grouped.values()
                for ids in cats.values()
                for folder in ids
            }
        ),
        "folder_failures": sum(s == "failed" for s in observations),
        "years": [
            {
                "year": year,
                "categories": [
                    {"name": name, "count": len(ids)}
                    for name, ids in sorted(
                        cats.items(), key=lambda item: item[0] or ""
                    )
                ],
                "file_count": len(files[year]),
            }
            for year, cats in sorted(
                grouped.items(), key=lambda x: x[0] or 0, reverse=True
            )
        ],
    }


@projection
def connected(db, kind, target):
    rows = []
    groups = defaultdict(list)
    race_context = None
    if kind == "race":
        try:
            race_context = json.loads(target)
        except (ValueError, TypeError):
            raise ValueError("Invalid race context") from None
        if not isinstance(race_context, dict) or set(race_context) != {
            "office",
            "district",
            "year",
        }:
            raise ValueError("Invalid race context")
        if not isinstance(race_context["office"], str) or not isinstance(
            race_context["year"], int
        ):
            raise ValueError("Invalid race context")
    for p in _latest_copies(db, metadata=False):
        query = select(m.TVAdConnection).where(
            m.TVAdConnection.publication_id == p.id,
            m.TVAdConnection.scope == "file",
            m.TVAdConnection.status == "checked",
            m.TVAdConnection.publication_approved.is_(True),
        )
        if kind == "race":
            matches = [
                c
                for c in db.scalars(query.where(m.TVAdConnection.kind == "election"))
                if c.target_snapshot.get("money_context") == race_context
            ]
        else:
            matches = list(
                db.scalars(
                    query.where(
                        m.TVAdConnection.kind == kind,
                        m.TVAdConnection.target_id == target,
                    )
                )
            )
        if kind == "name":
            matches = [
                f
                for f in _facts(db, p.id)
                if f.field == "agency_name"
                and f.value == target
                and f.status == "checked"
                and f.publication_approved
            ]
        if not matches:
            continue
        row = _row(db, p)
        roles = set()
        for match in matches:
            snapshot = getattr(match, "target_snapshot", {}) or {}
            role = snapshot.get("role", "")
            label = (
                (
                    "Advertiser or payer"
                    if role in ("advertiser", "payer")
                    else "Named on the document"
                )
                if kind == "candidate"
                else (
                    str(snapshot.get("election_stage", "")).capitalize() + " election"
                    if kind == "race"
                    else role
                )
            )
            roles.add(label)
        for label in sorted(roles):
            groups[label].append({**row, "role": label})
        rows.append(row)
    return {
        "agency_key": agency_key(target) if kind == "name" and rows else None,
        "exact_name_count": len(rows),
        "files": rows,
        "total": len(rows),
        "groups": [{"label": label, "files": items} for label, items in groups.items()],
    }


def _fcc_available(db, facility, file_id):
    status = db.scalar(
        select(m.FCCObservation.status)
        .where(
            m.FCCObservation.facility_id == facility,
            m.FCCObservation.kind == "file",
            m.FCCObservation.details["file_id"].astext == file_id,
            m.FCCObservation.status.in_(["stored", "failed", "unavailable"]),
        )
        .order_by(m.FCCObservation.observed_at.desc(), m.FCCObservation.scan_id.desc())
        .limit(1)
    )
    return status == "stored"


def _related(db, publication):
    rows = []
    for c in db.scalars(
        select(m.TVAdConnection).where(
            m.TVAdConnection.publication_id == publication.id,
            m.TVAdConnection.kind == "related_document",
            m.TVAdConnection.status == "checked",
            m.TVAdConnection.publication_approved.is_(True),
        )
    ):
        target = db.get(m.TVAdPublication, UUID(c.target_id), populate_existing=True)
        if target is None or target.status != "approved":
            continue
        row = _row(db, target)
        rows.append({**row, "reference": c.quote, "checked_at": iso(c.checked_at)})
    return rows


def _expense_link(db, c):
    snapshot = c.target_snapshot or {}
    raw = snapshot.get("expense_link_id")
    if not raw:
        return None
    try:
        link = db.get(m.FCCExpenseLink, UUID(raw), populate_existing=True)
    except ValueError:
        return None
    p = db.get(m.TVAdPublication, c.publication_id, populate_existing=True)
    if (
        link is None
        or p is None
        or link.status != "accepted"
        or link.content_hash != p.content_hash
        or any(
            str(snapshot.get(key)) != str(getattr(link, key))
            for key in (
                "source_dataset",
                "source_snapshot_id",
                "source_content_hash",
                "source_row_number",
                "extraction_version",
            )
        )
        or snapshot.get("source_row") != link.source_row
        or (
            snapshot.get("facility_id"),
            snapshot.get("file_id"),
            snapshot.get("content_hash"),
        )
        != (p.facility_id, p.file_id, p.content_hash)
    ):
        return None
    return link


def _expense_changed(db, c):
    link = _expense_link(db, c)
    return link is None or not fcc_expense_links.link_state(db, link)["current"]


def _money(value):
    try:
        number = Decimal(str(value).replace("$", "").replace(",", ""))
        if number.is_finite():
            whole = int(number)
            return f"−${abs(whole):,}" if whole < 0 else f"${whole:,}"
    except (ValueError, InvalidOperation):
        pass
    return str(value)


def expense_detail(db, connection_id):
    c = db.get(m.TVAdConnection, connection_id, populate_existing=True)
    if (
        c is None
        or c.kind != "expense"
        or c.status != "checked"
        or not c.publication_approved
    ):
        raise LookupError()
    p = db.get(m.TVAdPublication, c.publication_id, populate_existing=True)
    if p is None or p.status != "approved":
        raise LookupError()
    # Keep the exact reviewed row even when an archive match later changes.
    evidence = c.target_snapshot or {}
    try:
        snapshot_id = UUID(evidence["source_snapshot_id"])
    except (ValueError, KeyError):
        raise LookupError() from None
    snapshot = db.get(m.CampaignFinanceSnapshot, snapshot_id)
    body = db.get(m.CampaignFinanceSnapshotBody, snapshot_id)
    if (
        snapshot is None
        or body is None
        or snapshot.content_hash != evidence.get("source_content_hash")
    ):
        raise LookupError()
    row = evidence.get("source_row", {})
    labels = {
        "committee_name": "Committee",
        "spender": "Spender",
        "vendor_name": "Vendor",
        "payee": "Payee",
        "recipient": "Recipient",
        "amount": "Reported amount",
        "transaction_date": "Reported date",
        "date": "Reported date",
        "purpose": "Purpose",
        "description": "Description",
        "registration_number": "Registration number",
    }
    fields = [
        {
            "label": label,
            "value": _money(row[key]) if key == "amount" else str(row[key]),
        }
        for key, label in labels.items()
        if row.get(key) is not None
    ]
    return {
        "id": str(c.id),
        "label": "Reported campaign expense",
        "dataset": evidence["source_dataset"],
        "source_date": iso(snapshot.created_at) if snapshot else None,
        "source_url": snapshot.source_url if snapshot else None,
        "source_changed": _expense_changed(db, c),
        "fields": fields,
        "checked_at": iso(c.checked_at),
        "evidence": {"page": c.page, "quote": c.quote, "version_id": p.content_hash},
        "file": {
            "key": file_key(p.facility_id, p.file_id),
            "name": p.safe_title,
            "copy_id": str(p.id),
            "version_id": p.content_hash,
        },
    }


def _fact_history(db, fact):
    result = []
    seen = set()
    current = fact
    while current.supersedes_id and current.supersedes_id not in seen:
        seen.add(current.supersedes_id)
        old = db.get(m.TVAdFact, current.supersedes_id)
        if (
            old is None
            or old.publication_id != fact.publication_id
            or not old.history_publication_approved
        ):
            break
        result.append(
            {
                "value": _money(old.value)
                if old.field.endswith("_amount")
                else old.value,
                "corrected_at": iso(current.checked_at),
            }
        )
        current = old
    return result
