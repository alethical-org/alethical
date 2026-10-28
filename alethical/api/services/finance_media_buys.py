"""Alethical Finance's view of the TV station files it calls Media buys.

The same readers alethical.com's administrators use (``alethical/api/services/
tv_ads.py``), in their Finance reading (``originals=True``), as
docs/architecture/alethical-finance-architecture.md requires:

- **Every file, list row and search result is the station's original** (§4, §6):
  its own title, folder, category, pages and machine-read text, never an approved
  public copy's. Finance has no public pages, so it never uses the public-copy
  steps.
- **Every check made on that exact version is shown**, from any non-draft copy of
  it, published or not, and no check names who made it (§5).
- **No answer links to alethical.com** (§7). Each connection carries
  ``target: {kind, id}`` when Finance can open its other side, and the Finance app
  builds its own link. Which fields reach Finance at all is the allow list in
  ``alethical/api/finance_media_buys_schemas.py``.
"""

from __future__ import annotations

from urllib.parse import quote
from uuid import UUID

from sqlalchemy.orm import Session

from alethical.api.services import tv_ads as reader
from alethical.db import models as m

DATES = {"Invoice date", "Scheduled airing", "Start date", "End date"}

# Connection kinds Finance opens itself, through /connections?kind=&target=.
OPENS = frozenset({"committee", "candidate", "principal", "election"})


def target(c: m.TVAdConnection) -> dict | None:
    """Where Finance opens a connection's other side: a station file, or the
    files connected to the same record. None when nothing in Finance opens it: a
    withdrawn check, printed issue text (not a record) or a reported expense,
    whose id is a private review record; its amount, date and source row are
    already on the connection."""
    if c.status != "checked":
        return None
    if c.kind in OPENS:
        return {"kind": c.kind, "id": c.target_id}
    snapshot = c.target_snapshot or {}
    if (
        c.kind == "related_document"
        and snapshot.get("facility_id") in reader.STATIONS
        and snapshot.get("file_id")
    ):
        return {
            "kind": "file",
            "id": reader.file_key(snapshot["facility_id"], snapshot["file_id"]),
        }
    return None


def _connection(db: Session, c: m.TVAdConnection, version: str, key: str) -> dict:
    item = {**reader._connection_payload(db, c, version, key), "target": target(c)}
    snapshot = c.target_snapshot or {}
    if c.kind == "related_document" and c.status == "checked":
        # The related file by its original's own name, never its copy's title.
        identity = tuple(
            snapshot.get(field) for field in ("facility_id", "file_id", "content_hash")
        )
        document = db.get(m.FCCDocument, identity) if all(identity) else None
        item["label"] = document.name if document else None
    return item


def page_image_path(key: str, version: str, page: int) -> str:
    return f"/finance/media-buys/files/{quote(key)}/pages/{page}?version={version}"


@reader.projection(scope="file")
def _original(db: Session, key: str, version: str | None = None) -> dict:
    facility, file_id = reader.identity(key)
    docs = list(
        db.scalars(
            reader._documents(db, facility)
            .where(m.FCCDocument.file_id == file_id)
            .order_by(m.FCCDocument.first_seen_at.desc(), m.FCCDocument.content_hash)
        )
    )
    if not docs:
        raise LookupError("Not found")
    newest = max(
        docs, key=lambda d: (d.last_downloaded_at, d.last_seen_at, d.content_hash)
    )
    requested = (
        next((d for d in docs if d.content_hash == version), None)
        if version
        else newest
    )
    if requested is None:
        raise LookupError("Not found")
    detail = reader._archive_detail(db, key, requested, docs, newest, [])
    checks = reader._original_checks(db)
    exact = (facility, file_id, requested.content_hash)
    facts = [
        reader._fact_payload(db, fact, requested.content_hash)
        for fact in checks["facts"].get(exact, [])
    ]
    detail["facts"] = [f for f in facts if f["kind"] not in DATES]
    detail["dates"] = [f for f in facts if f["kind"] in DATES]
    detail["connections"] = [
        _connection(db, c, requested.content_hash, key)
        for c in checks["connections"].get(exact, [])
    ]
    for page in detail["pages"]:
        page["image"] = page_image_path(key, requested.content_hash, page["number"])
    return detail


def file_detail(db: Session, key: str, version: str | None = None) -> dict:
    return _original(db, key, version, originals=True)


def counts(db: Session) -> dict:
    return reader.counts(db, originals=True)


def sources(db: Session) -> dict:
    return reader.sources(db)


def recent(db: Session) -> dict:
    return reader.recent(db, originals=True)


def browse(db: Session, **filters) -> dict:
    return reader.browse(db, originals=True, **filters)


def folder(db: Session, key: str) -> dict:
    detail = reader.folder_detail(db, key, originals=True)
    if detail["relationship"]:
        row = db.get(m.TVAdConnection, UUID(detail["relationship"]["id"]))
        detail["relationship"]["target"] = target(row) if row else None
    return detail


def agency(db: Session, key: str) -> dict:
    return reader.agency_detail(db, key, originals=True)


def station(db: Session, key: str) -> dict:
    return reader.station_detail(db, key, originals=True)


def connected(db: Session, kind: str, record: str) -> dict:
    return reader.connected(db, kind, record, originals=True)
