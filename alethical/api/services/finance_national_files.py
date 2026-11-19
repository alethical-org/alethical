"""Finance reads only the originals in the active national FCC archive release."""

from __future__ import annotations

import hashlib
import json
import re
from types import SimpleNamespace
from urllib.parse import urlsplit

from botocore.exceptions import BotoCoreError, ClientError
from fastapi import HTTPException
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from alethical.api.problems import problem_exception
from alethical.api.services import finance_national_search as search
from alethical.api.services import finance_versions
from alethical.api.services.campaign_finance_register import name_words_contain
from alethical.db.models import NationalFCCOriginal as Original
from alethical.db.models import NationalFCCSnapshot as Snapshot
from alethical.pipeline.national_fcc_read_grant import member_file_store
from alethical.pipeline.raw_file_store import RawFileStore

PAGE_SIZE = 25
MAX_TEXT_BYTES = 4 * 1024 * 1024


def browse(
    db: Session, query: str, page: int, version: str | None, preview: bool = False
) -> dict:
    """Saved national originals: the search file's, else the archive release's.

    While a new search file is still copying, the archive release keeps the list
    readable instead of answering an error.
    """
    try:
        ready = search.FILES.current(db)
    except (LookupError, HTTPException):
        ready = None
    if ready is not None:
        token = hashlib.sha256(ready.release_id.encode()).hexdigest()[:16]
        if version is not None and version != token:
            raise problem_exception(
                409,
                "Conflict",
                "These records changed. Reload the list.",
                type_slug="records-changed",
            )
        answer = search.saved_national(ready, query.strip(), page, preview)
        return dict(
            version=token,
            tab="national",
            q=query.strip(),
            page=page,
            page_size=PAGE_SIZE,
            total=answer["total"],
            capped=False,
            years=[],
            categories=[],
            station="",
            year=None,
            category="",
            rows=[
                dict(
                    key="national-" + r["record_key"],
                    name=r["name"],
                    label=r["name"],
                    station=r["station"],
                    folder_label=r["folder"],
                    year=r["year"],
                    category=r["service"],
                    kind=None,
                    uploaded_at=None,
                    version_id=r["sha256"],
                    airing_periods=[],
                    version_count=1,
                    source_changed=False,
                )
                for r in answer["rows"]
            ],
        )
    return _archive_browse(db, query, page, version, preview)


def _archive_browse(
    db: Session, query: str, page: int, version: str | None, preview: bool
) -> dict:
    finance_versions.pin(db)
    release = db.execute(
        select(Snapshot.snapshot_id, Snapshot.original_count).where(Snapshot.active)
    ).one_or_none()
    snapshot = release.snapshot_id if release else None
    token = hashlib.sha256((snapshot or "").encode()).hexdigest()[:16]
    if version is not None and version != token:
        raise problem_exception(
            409,
            "Conflict",
            "These records changed. Reload the list.",
            type_slug="records-changed",
        )
    query = query.strip()
    criteria = [Original.snapshot_id == snapshot]
    if query:
        labels = func.concat_ws(
            " ",
            Original.title,
            Original.station_name,
            Original.folder_path,
            Original.record_key,
            Original.state,
            Original.service,
        )
        criteria.append(name_words_contain(labels, query))
    fields = (
        Original.record_key,
        Original.title,
        Original.station_name,
        Original.service,
        Original.folder_path,
        Original.file_year,
        Original.content_hash,
    )
    matches = select(*fields).where(*criteria)
    if query:
        matches = matches.add_columns(func.count().over().label("match_count"))
    rows = db.execute(
        matches.order_by(Original.record_key)
        .limit(5 if preview else PAGE_SIZE)
        .offset((page - 1) * PAGE_SIZE)
    ).all()
    total = release.original_count if release else 0
    if query:
        # The window counts every match while reading the requested page.
        # An empty later page has no row to carry its total. Only that recovery
        # needs a second query so the directory can return to the last page.
        total = rows[0].match_count if rows else 0
        if not rows and page > 1 and release:
            total = (
                db.scalar(select(func.count()).select_from(Original).where(*criteria))
                or 0
            )
    return dict(
        version=token,
        tab="national",
        q=query,
        page=page,
        page_size=PAGE_SIZE,
        total=total,
        capped=False,
        years=[],
        categories=[],
        station="",
        year=None,
        category="",
        rows=[
            dict(
                key="national-" + r.record_key,
                name=r.title,
                label=r.title,
                station=r.station_name,
                folder_label=r.folder_path,
                year=r.file_year,
                category=r.service,
                kind=None,
                uploaded_at=None,
                version_id=r.content_hash,
                airing_periods=[],
                version_count=1,
                source_changed=False,
            )
            for r in rows
        ],
    )


def original(db: Session, key: str, version: str | None):
    """A saved original from the active search file, else the archive release."""
    loading = None
    try:
        ready = search.FILES.current(db)
    except LookupError:
        ready = None
    except HTTPException as error:
        ready, loading = None, error
    if ready is not None:
        row = SimpleNamespace(**search.original_record(ready, key))
        if version is not None and row.content_hash != version:
            raise LookupError("File not held")
        return row
    try:
        return _archive_original(db, key, version)
    except LookupError:
        if loading is not None:
            raise loading from None
        raise


def _archive_original(db: Session, key: str, version: str | None) -> Original:
    query = (
        select(Original)
        .join(Snapshot, Original.snapshot_id == Snapshot.snapshot_id)
        .where(Snapshot.active, Original.record_key == key)
    )
    if version is not None:
        query = query.where(Original.content_hash == version)
    row = db.scalar(query)
    if row is None:
        raise LookupError("File not held")
    return row


def detail(row: Original) -> dict:
    source = urlsplit(row.source_url)
    source_url = (
        row.source_url
        if source.scheme == "https" and source.netloc == "files.fcc.gov"
        else None
    )
    return dict(
        source_url=source_url,
        title=row.title,
        station_name=row.station_name,
        service=row.service,
        state=row.state,
        folder_path=row.folder_path,
        file_year=row.file_year,
        file_id=row.file_id,
        content_hash=row.content_hash,
        page_count=row.page_count,
        has_text=bool(row.text_object_key),
    )


def _unavailable():
    return problem_exception(
        503, "File unavailable", "The file could not be opened. Try again."
    )


def open_original(row: Original, store: RawFileStore):
    # A source record cannot name an unrelated private object in the bucket.
    digest = row.content_hash
    if not re.fullmatch(r"[a-f0-9]{64}", digest) or row.object_key != (
        f"fcc-national/v1/originals/sha256/{digest[:2]}/{digest}.pdf"
    ):
        raise _unavailable()
    try:
        result = store._client.get_object(Bucket=store.bucket, Key=row.object_key)
        body = result["Body"]
        if result["ContentLength"] != row.byte_size:
            body.close()
            raise _unavailable()
        return body
    except (BotoCoreError, ClientError, RuntimeError):
        raise _unavailable() from None


def document_text(row: Original, store: RawFileStore) -> dict:
    key = row.text_object_key
    if not key:
        raise LookupError("Text not held")
    digest = key.rsplit("/", 1)[-1].removesuffix(".json")
    if not re.fullmatch(r"[a-f0-9]{64}", digest) or key != (
        f"fcc-national/v1/text/sha256/{digest[:2]}/{digest}.json"
    ):
        raise _unavailable()
    try:
        body = store._client.get_object(Bucket=store.bucket, Key=key)["Body"]
        try:
            content = body.read(MAX_TEXT_BYTES + 1)
        finally:
            body.close()
        if (
            len(content) > MAX_TEXT_BYTES
            or hashlib.sha256(content).hexdigest() != digest
        ):
            raise _unavailable()
        return json.loads(content)
    except (BotoCoreError, ClientError, RuntimeError, ValueError, OSError):
        raise _unavailable() from None


def held_source(db: Session, key: str, version: str):
    row = original(db, key, version)
    try:
        store = member_file_store(db)
    except (BotoCoreError, ClientError, RuntimeError, ValueError):
        raise _unavailable() from None
    # The row and the storage grant are both loaded. Return the connection to
    # the pool before starting network I/O; the file may take minutes to read.
    db.close()
    return row, store
