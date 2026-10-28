"""Alethical Finance's view of the TV station files it calls Media buys.

The same readers alethical.com's administrators use (``alethical/api/services/
tv_ads.py``), with 2 differences required by
docs/architecture/alethical-finance-architecture.md:

- **Every file opens as its original.** Finance has no public pages, so it never
  shows alethical.com's public-copy steps: no copy ids, copy statuses or approved
  copies, only the station's own file, its pages and machine-read text (§4, §6).
- **No answer carries a link.** alethical.com's readers build addresses of
  alethical.com pages; Finance never links there (§7), so every ``href`` is
  removed and the Finance app builds its own from each record's kind and key.

Every check on a version is shown, and no check names who made it (§5).
"""

from __future__ import annotations

from typing import Any
from urllib.parse import quote

from sqlalchemy import select
from sqlalchemy.orm import Session

from alethical.api.services import tv_ads as reader
from alethical.db import models as m

# Fields that describe alethical.com's public copies or link to its pages.
_DROPPED = frozenset(
    {
        "copy_id",
        "copy_status",
        "newest_approved_version",
        "files_with_approved_copy",
        "href",
        "image_path",
    }
)


def finance_view(value: Any) -> Any:
    """The payload with every public-copy field and every link removed."""
    if isinstance(value, dict):
        return {
            key: finance_view(item)
            for key, item in value.items()
            if key not in _DROPPED
        }
    if isinstance(value, list):
        return [finance_view(item) for item in value]
    return value


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
    newest = sorted(
        docs,
        key=lambda d: (d.last_downloaded_at, d.last_seen_at, d.content_hash),
        reverse=True,
    )
    requested = (
        next((d for d in docs if d.content_hash == version), None)
        if version
        else newest[0]
    )
    if requested is None:
        raise LookupError("Not found")
    pubs = list(
        db.scalars(
            select(m.TVAdPublication).where(
                m.TVAdPublication.facility_id == facility,
                m.TVAdPublication.file_id == file_id,
            )
        )
    )
    detail = reader._archive_detail(db, key, requested, docs, newest[0], pubs)
    # Checks made on alethical.com's copies of this exact version are checks of
    # this file too; Finance shows every one, published or not.
    copies = [
        p.id
        for p in pubs
        if p.content_hash == requested.content_hash and p.status != "draft"
    ]
    facts = [
        reader._fact_payload(db, fact, requested.content_hash)
        for fact in db.scalars(
            select(m.TVAdFact)
            .where(m.TVAdFact.publication_id.in_(copies))
            .order_by(m.TVAdFact.checked_at, m.TVAdFact.id)
        )
    ]
    connections = [
        {
            **reader._connection_payload(db, c, requested.content_hash, key),
            "target": {"kind": c.kind, "id": c.target_id},
        }
        for c in db.scalars(
            select(m.TVAdConnection)
            .where(
                m.TVAdConnection.publication_id.in_(copies),
                m.TVAdConnection.scope == "file",
                m.TVAdConnection.kind != "related_document",
            )
            .order_by(m.TVAdConnection.checked_at, m.TVAdConnection.id)
        )
    ]
    dates = {"Invoice date", "Scheduled airing", "Start date", "End date"}
    detail["facts"] = [f for f in facts if f["kind"] not in dates]
    detail["dates"] = [f for f in facts if f["kind"] in dates]
    detail["connections"] = connections
    detail["versions"] = [
        {key_: value for key_, value in v.items() if key_ != "status"}
        for v in detail["versions"]
    ]
    for page in detail["pages"]:
        page["image"] = page_image_path(key, requested.content_hash, page["number"])
    return detail


def file_detail(db: Session, key: str, version: str | None = None) -> dict:
    return finance_view(_original(db, key, version, include_archive=True))


def counts(db: Session) -> dict:
    return finance_view(reader.counts(db))


def sources(db: Session) -> dict:
    return finance_view(reader.sources(db))


def recent(db: Session) -> dict:
    return finance_view(reader.recent(db, include_archive=True))


def browse(db: Session, **filters) -> dict:
    return finance_view(reader.browse(db, include_archive=True, **filters))


def folder(db: Session, key: str) -> dict:
    return finance_view(reader.folder_detail(db, key, include_archive=True))


def agency(db: Session, key: str) -> dict:
    return finance_view(reader.agency_detail(db, key, include_archive=True))


def station(db: Session, key: str) -> dict:
    return finance_view(reader.station_detail(db, key, include_archive=True))


def connected(db: Session, kind: str, target: str) -> dict:
    return finance_view(reader.connected(db, kind, target, include_archive=True))
