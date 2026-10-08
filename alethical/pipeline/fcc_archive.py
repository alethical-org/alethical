"""Private, restartable FCC evidence archive. No public figures are published."""

from __future__ import annotations

import gzip
import hashlib
import io
import re
import tempfile
import uuid
from collections import Counter, deque
from concurrent.futures import ThreadPoolExecutor
from dataclasses import asdict
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Callable

from sqlalchemy import delete, func, or_, select, update
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.orm import Session

from alethical.db import models as m
from alethical.pipeline.fcc_public_files import (
    DEFAULT_STATIONS,
    FCCClient,
    FCCFetchError,
)
from alethical.pipeline.raw_file_store import sha256_of_file


def now() -> datetime:
    return datetime.now(timezone.utc)


def source_error(error: Exception) -> str:
    # Only source-client errors have known safe, public messages. Storage and DB
    # errors can contain credentials or private connection strings.
    if isinstance(error, FCCFetchError):
        return f"FCCFetchError: {error.reason}"[:2000]
    return type(error).__name__


def archive_body(db: Session, store: Any, body: bytes) -> str:
    """Verify immutable storage before registering evidence. Commit is the caller's."""
    digest = hashlib.sha256(body).hexdigest()
    buffer = io.BytesIO()
    with gzip.GzipFile(fileobj=buffer, mode="wb", mtime=0, filename="") as handle:
        handle.write(body)
    compressed = buffer.getvalue()
    compressed_hash = hashlib.sha256(compressed).hexdigest()
    key = f"fcc/political-files/{digest}.gz"
    with tempfile.TemporaryDirectory(prefix="fcc-body-") as directory:
        path = str(Path(directory) / "body.gz")
        Path(path).write_bytes(compressed)
        store.put_and_verify(key, path, compressed_hash)
    db.execute(
        insert(m.FCCSourceBody)
        .values(
            content_hash=digest,
            object_key=key,
            byte_size=len(body),
            compressed_hash=compressed_hash,
            compressed_byte_size=len(compressed),
            compression="gzip",
        )
        .on_conflict_do_nothing()
    )
    return digest


def read_body(store: Any, row: m.FCCSourceBody) -> bytes:
    with tempfile.TemporaryDirectory(prefix="fcc-read-") as directory:
        path = str(Path(directory) / "body.gz")
        store.get(row.object_key, path, max_bytes=row.compressed_byte_size)
        if sha256_of_file(path) != row.compressed_hash:
            raise ValueError("Stored FCC object failed its fingerprint check")
        with gzip.open(path, "rb") as handle:
            body = handle.read(row.byte_size + 1)
        if (
            len(body) != row.byte_size
            or hashlib.sha256(body).hexdigest() != row.content_hash
        ):
            raise ValueError("Restored FCC source failed its fingerprint check")
        return body


def observe(
    db: Session,
    scan_id: uuid.UUID,
    url: str,
    facility_id: str,
    kind: str,
    status: str,
    *,
    content_hash: str | None = None,
    details: dict | None = None,
    error: str | None = None,
) -> None:
    db.execute(
        insert(m.FCCObservation)
        .values(
            scan_id=scan_id,
            url=url,
            facility_id=facility_id,
            kind=kind,
            status=status,
            content_hash=content_hash,
            details=details or {},
            error=error,
        )
        .on_conflict_do_nothing()
    )


def collect(
    db: Session,
    store: Any,
    *,
    stations=DEFAULT_STATIONS,
    workers: int = 3,
    max_files: int | None = None,
    refresh_existing: bool = False,
    client_factory: Callable = FCCClient,
    log: Callable[[dict], None] = lambda row: None,
) -> dict:
    """Traverse every political folder and account for every listed file.

    Recent unchanged listings can reuse a verified body for up to 7 days. Weekly
    full downloads detect replacements even when the source keeps its old label.
    Full historical versions are retained, including files later removed by FCC.
    """
    if not 1 <= workers <= 4 or (max_files is not None and max_files < 1):
        raise ValueError("Use 1 to 4 workers and a positive file limit")
    scan = m.FCCScan(
        status="running", stations=[asdict(s) for s in stations], counts={}
    )
    db.add(scan)
    db.commit()
    scan_id = scan.id
    engine = db.get_bind()
    counts: Counter = Counter()
    work: list[tuple[Any, Any]] = []
    seen_files: set[tuple[str, str]] = set()
    client = client_factory()
    try:
        for station in stations:
            pending = deque([(station.root_url, "political-files")])
            seen_folders: set[str] = set()
            while pending:
                url, path = pending.popleft()
                if url in seen_folders:
                    continue
                if len(seen_folders) >= 20000:
                    raise ValueError("FCC folder safety limit reached; scan incomplete")
                seen_folders.add(url)
                try:
                    listing = client.read_folder(url, path)
                    digest = archive_body(db, store, listing.body)
                    observe(
                        db,
                        scan_id,
                        url,
                        station.facility_id,
                        "folder",
                        "stored",
                        content_hash=digest,
                        details={
                            "path": path,
                            "files": len(listing.files),
                            "children": len(listing.children),
                            "expected_count": listing.expected_count,
                        },
                    )
                    for file in listing.files:
                        counts["listed_rows"] += 1
                        identity = (station.facility_id, file.file_id)
                        if identity not in seen_files:
                            seen_files.add(identity)
                            work.append((station, file))
                    pending.extend(listing.children)
                    counts["folders_stored"] += 1
                    db.commit()
                except Exception as error:
                    db.rollback()
                    observe(
                        db,
                        scan_id,
                        url,
                        station.facility_id,
                        "folder",
                        "failed",
                        details={"path": path},
                        error=source_error(error),
                    )
                    db.commit()
                    counts["folders_failed"] += 1
                if len(seen_folders) % 25 == 0:
                    log(
                        {
                            "scan_id": str(scan_id),
                            "station": station.call_sign,
                            **dict(counts),
                        }
                    )
        counts["listed_files"] = len(work)
        limited = max_files is not None and len(work) > max_files
        if max_files is not None:
            # Prioritize never-attempted records, then changed/due records,
            # and use attempt time for fair retries of permanently unavailable files.
            previous_rows = db.scalars(
                select(m.FCCDocument).order_by(m.FCCDocument.last_seen_at)
            ).all()
            previous_by_id = {
                (row.facility_id, row.file_id): row for row in previous_rows
            }
            observed_file_id = m.FCCObservation.details["file_id"].astext
            attempts = {
                (facility, file_id): saved_at
                for facility, file_id, saved_at in db.execute(
                    select(
                        m.FCCObservation.facility_id,
                        observed_file_id,
                        func.max(m.FCCObservation.observed_at),
                    )
                    .where(m.FCCObservation.kind == "file")
                    .group_by(
                        m.FCCObservation.facility_id,
                        observed_file_id,
                    )
                )
            }
            earliest = datetime.min.replace(tzinfo=timezone.utc)
            cutoff = now() - timedelta(days=7)

            def priority(item):
                station, file = item
                identity = (station.facility_id, file.file_id)
                previous = previous_by_id.get(identity)
                attempted = attempts.get(identity)
                changed = previous is not None and (
                    previous.uploaded_at != file.uploaded_at
                    or previous.name != file.name
                    or previous.url != file.url
                )
                due = (
                    previous is None
                    or previous.last_downloaded_at < cutoff
                    or refresh_existing
                )
                rank = 0 if attempted is None else 1 if changed else 2 if due else 3
                return rank, attempted or earliest

            work.sort(key=priority)
            work = work[:max_files]
        db.execute(
            update(m.FCCScan).where(m.FCCScan.id == scan_id).values(counts=dict(counts))
        )
        db.commit()

        def process(item):
            station, file = item
            # Source URLs can be identical for separate FCC file records. Keep both.
            source_url = file.url or file.source_folder_url
            if not source_url:
                raise ValueError("FCC file has no source listing address")
            observation_url = source_url + "#fcc-file=" + file.file_id
            details = asdict(file)
            with Session(engine) as session:
                if file.url is None:
                    observe(
                        session,
                        scan_id,
                        observation_url,
                        station.facility_id,
                        "file",
                        "unavailable",
                        details=details,
                        error=file.unavailable_reason,
                    )
                    session.commit()
                    return "unavailable"
                previous = session.scalar(
                    select(m.FCCDocument)
                    .where(
                        m.FCCDocument.facility_id == station.facility_id,
                        m.FCCDocument.file_id == file.file_id,
                    )
                    .order_by(m.FCCDocument.last_seen_at.desc())
                    .limit(1)
                )
                cutoff = now() - timedelta(days=7)
                recent = (
                    previous is not None
                    and previous.last_downloaded_at >= cutoff
                    and previous.uploaded_at == file.uploaded_at
                    and previous.name == file.name
                    and previous.url == file.url
                )
                try:
                    if recent and not refresh_existing:
                        digest = previous.content_hash
                        body_row = session.get(m.FCCSourceBody, digest)
                        if body_row is None:
                            raise ValueError("Archived source record is missing")
                        read_body(store, body_row)
                        status = "reused"
                    else:
                        source_client = client_factory()
                        try:
                            body = source_client.download(file)
                            details["effective_url"] = getattr(
                                source_client, "last_download_url", None
                            )
                        finally:
                            source_client.close()
                        digest = archive_body(session, store, body)
                        status = "stored"
                    year_match = re.search(
                        r"(?:^|/)(20\d{2}|19\d{2})(?:/|$)", file.folder_path
                    )
                    values = dict(
                        facility_id=station.facility_id,
                        file_id=file.file_id,
                        content_hash=digest,
                        call_sign=station.call_sign,
                        folder_id=file.folder_id,
                        folder_path=file.folder_path,
                        name=file.name,
                        url=file.url,
                        year=int(year_match[1]) if year_match else None,
                        uploaded_at=file.uploaded_at,
                        last_seen_at=now(),
                    )
                    if status == "stored":
                        values["last_downloaded_at"] = now()
                    session.execute(
                        insert(m.FCCDocument)
                        .values(**values)
                        .on_conflict_do_update(
                            index_elements=["facility_id", "file_id", "content_hash"],
                            set_={
                                k: v
                                for k, v in values.items()
                                if k not in {"facility_id", "file_id", "content_hash"}
                            },
                        )
                    )
                    observe(
                        session,
                        scan_id,
                        observation_url,
                        station.facility_id,
                        "file",
                        status,
                        content_hash=digest,
                        details=details,
                    )
                    session.commit()
                    return status
                except Exception as error:
                    session.rollback()
                    observe(
                        session,
                        scan_id,
                        observation_url,
                        station.facility_id,
                        "file",
                        "failed",
                        details=details,
                        error=source_error(error),
                    )
                    session.commit()
                    return "failed"

        with ThreadPoolExecutor(max_workers=workers) as executor:
            for index, result in enumerate(executor.map(process, work), 1):
                counts["files_" + result] += 1
                if index % 25 == 0:
                    log({"scan_id": str(scan_id), **dict(counts)})
                    db.execute(
                        update(m.FCCScan)
                        .where(m.FCCScan.id == scan_id)
                        .values(counts=dict(counts))
                    )
                    db.commit()
        status = "limited" if limited else "complete"
        if (
            counts["folders_failed"]
            or counts["files_failed"]
            or counts["files_unavailable"]
        ):
            status = "incomplete"
    except BaseException:
        db.rollback()
        db.execute(
            update(m.FCCScan)
            .where(m.FCCScan.id == scan_id)
            .values(status="interrupted", finished_at=now(), counts=dict(counts))
        )
        db.commit()
        raise
    finally:
        client.close()
    db.execute(
        update(m.FCCScan)
        .where(m.FCCScan.id == scan_id)
        .values(status=status, finished_at=now(), counts=dict(counts))
    )
    db.commit()
    return {"scan_id": str(scan_id), "status": status, **dict(counts)}


def save_extraction(
    db: Session, digest: str, extraction: Any, *, retry_failed: bool = False
) -> bool:
    values = dict(
        content_hash=digest,
        version=extraction.version,
        document_kind=extraction.document_kind,
        status=extraction.status,
        facts=[asdict(f) for f in extraction.facts],
        errors=list(extraction.errors),
        attempts=[],
    )
    inserted = db.scalar(
        insert(m.FCCExtraction)
        .values(**values)
        .on_conflict_do_nothing()
        .returning(m.FCCExtraction.content_hash)
    )
    if not inserted:
        row = db.scalar(
            select(m.FCCExtraction)
            .where(
                m.FCCExtraction.content_hash == digest,
                m.FCCExtraction.version == extraction.version,
            )
            .with_for_update()
        )
        linked = db.scalar(
            select(m.FCCExpenseLink.id)
            .where(
                m.FCCExpenseLink.content_hash == digest,
                m.FCCExpenseLink.extraction_version == extraction.version,
            )
            .limit(1)
        )
        if row is None or not retry_failed or row.status == "pending_review" or linked:
            return False
        old_pages = db.scalars(
            select(m.FCCPage).where(
                m.FCCPage.content_hash == digest,
                m.FCCPage.version == extraction.version,
            )
        ).all()
        row.attempts = [
            *row.attempts,
            dict(
                saved_at=now().isoformat(),
                status=row.status,
                document_kind=row.document_kind,
                facts=row.facts,
                errors=row.errors,
                pages=[
                    dict(
                        page=p.page,
                        text=p.text,
                        method=p.method,
                        status=p.status,
                        error=p.error,
                    )
                    for p in old_pages
                ],
            ),
        ]
        row.status = extraction.status
        row.document_kind = extraction.document_kind
        row.facts = [asdict(f) for f in extraction.facts]
        row.errors = list(extraction.errors)
        db.execute(
            delete(m.FCCPage).where(
                m.FCCPage.content_hash == digest,
                m.FCCPage.version == extraction.version,
            )
        )
        db.flush()
    for page in extraction.pages:
        db.add(
            m.FCCPage(content_hash=digest, version=extraction.version, **asdict(page))
        )
    return True


def extract_pending(
    db: Session,
    store: Any,
    *,
    limit: int = 100,
    workers: int = 2,
    retry_failed: bool = False,
    log: Callable[[dict], None] = lambda row: None,
) -> dict:
    from alethical.pipeline.fcc_document_text import EXTRACTOR_VERSION, extract_document

    if not 1 <= workers <= 4 or limit < 1:
        raise ValueError("Use 1 to 4 workers and a positive extraction limit")
    existing = (
        select(m.FCCExtraction.content_hash)
        .where(
            m.FCCExtraction.content_hash == m.FCCDocument.content_hash,
            m.FCCExtraction.version == EXTRACTOR_VERSION,
        )
        .exists()
    )
    eligible = ~existing
    if retry_failed:
        failed = (
            select(m.FCCExtraction.content_hash)
            .where(
                m.FCCExtraction.content_hash == m.FCCDocument.content_hash,
                m.FCCExtraction.version == EXTRACTOR_VERSION,
                m.FCCExtraction.status != "pending_review",
            )
            .exists()
        )
        linked = (
            select(m.FCCExpenseLink.id)
            .where(
                m.FCCExpenseLink.content_hash == m.FCCDocument.content_hash,
                m.FCCExpenseLink.extraction_version == EXTRACTOR_VERSION,
            )
            .exists()
        )
        eligible = or_(eligible, failed & ~linked)
    rows = db.execute(
        select(m.FCCDocument.content_hash, func.min(m.FCCDocument.name))
        .where(eligible)
        .group_by(m.FCCDocument.content_hash)
        .order_by(m.FCCDocument.content_hash)
        .limit(limit)
    ).all()
    inputs = [(db.get(m.FCCSourceBody, digest), name) for digest, name in rows]
    counts: Counter = Counter()

    def process(item):
        row, name = item
        try:
            return row.content_hash, extract_document(read_body(store, row), name), None
        except Exception as error:
            return row.content_hash, None, type(error).__name__

    with ThreadPoolExecutor(max_workers=workers) as executor:
        for digest, result, error in executor.map(process, inputs):
            if error:
                counts["failed"] += 1
            else:
                saved = save_extraction(db, digest, result, retry_failed=retry_failed)
                db.commit()
                counts[result.status if saved else "already_read"] += 1
            log({"content_hash": digest, "status": error or result.status})
    return dict(counts)


def search(
    db: Session,
    query: str,
    *,
    station: str | None = None,
    year: int | None = None,
    kind: str | None = None,
    field: str | None = None,
    value: str | None = None,
    limit: int = 50,
) -> list[dict]:
    """Private source-page search; results explicitly identify draft readings."""
    if (not query.strip() and not (field and value)) or not 1 <= limit <= 250:
        raise ValueError("Supply text or a field/value and a limit from 1 to 250")
    if bool(field) != bool(value):
        raise ValueError("A field and exact value must be supplied together")
    from alethical.pipeline.fcc_document_text import EXTRACTOR_VERSION

    pattern = (
        "%" + query.replace("\\", "\\\\").replace("%", r"\%").replace("_", r"\_") + "%"
    )
    stmt = (
        select(m.FCCDocument, m.FCCPage, m.FCCExtraction)
        .join(m.FCCPage, m.FCCPage.content_hash == m.FCCDocument.content_hash)
        .join(
            m.FCCExtraction,
            (m.FCCExtraction.content_hash == m.FCCPage.content_hash)
            & (m.FCCExtraction.version == m.FCCPage.version),
        )
        .where(
            m.FCCPage.version == EXTRACTOR_VERSION,
            m.FCCPage.text.ilike(pattern, escape="\\"),
        )
    )
    if station:
        stmt = stmt.where(m.FCCDocument.call_sign == station)
    if year:
        stmt = stmt.where(m.FCCDocument.year == year)
    if kind:
        stmt = stmt.where(m.FCCExtraction.document_kind == kind)
    if field and value:
        stmt = stmt.where(
            m.FCCExtraction.facts.contains([{"field": field, "value": value}])
        )
    rows = db.execute(
        stmt.order_by(
            m.FCCDocument.last_seen_at.desc(), m.FCCDocument.file_id, m.FCCPage.page
        ).limit(limit)
    ).all()
    return [
        dict(
            station=doc.call_sign,
            year=doc.year,
            file_id=doc.file_id,
            name=doc.name,
            folder=doc.folder_path,
            url=doc.url,
            content_hash=doc.content_hash,
            page=page.page,
            text=page.text,
            method=page.method,
            reading_status=reading.status,
            document_kind=reading.document_kind,
            draft_facts=reading.facts,
            extraction_version=reading.version,
            first_seen_at=doc.first_seen_at.isoformat(),
            last_seen_at=doc.last_seen_at.isoformat(),
            last_downloaded_at=doc.last_downloaded_at.isoformat(),
            version_scope="Retained source version; may have been replaced or removed at FCC",
        )
        for doc, page, reading in rows
    ]


def status(db: Session) -> dict:
    last = db.scalar(select(m.FCCScan).order_by(m.FCCScan.started_at.desc()).limit(1))
    return {
        "latest_scan": None
        if last is None
        else dict(
            id=str(last.id),
            status=last.status,
            counts=last.counts,
            started_at=last.started_at.isoformat(),
            finished_at=last.finished_at.isoformat() if last.finished_at else None,
        ),
        "document_versions": db.scalar(select(func.count()).select_from(m.FCCDocument)),
        "distinct_document_bodies": db.scalar(
            select(func.count(func.distinct(m.FCCDocument.content_hash)))
        ),
        "readings": {
            state: count
            for state, count in db.execute(
                select(m.FCCExtraction.status, func.count()).group_by(
                    m.FCCExtraction.status
                )
            ).all()
        },
        "bodies_without_second_copy": db.scalar(
            select(func.count())
            .select_from(m.FCCSourceBody)
            .where(m.FCCSourceBody.mirrored_at.is_(None))
        ),
        "by_station_year": [
            {
                "station": station,
                "year": year,
                "file_records": records,
                "versions": versions,
            }
            for station, year, records, versions in db.execute(
                select(
                    m.FCCDocument.call_sign,
                    m.FCCDocument.year,
                    func.count(func.distinct(m.FCCDocument.file_id)),
                    func.count(),
                )
                .group_by(m.FCCDocument.call_sign, m.FCCDocument.year)
                .order_by(m.FCCDocument.call_sign, m.FCCDocument.year)
            )
        ],
    }


def gaps(db: Session, *, limit: int = 100) -> dict:
    """Distinguish source gaps from unreadable copies and missing field evidence."""
    if not 1 <= limit <= 1000:
        raise ValueError("Use a gap limit from 1 to 1000")
    last = db.scalar(select(m.FCCScan).order_by(m.FCCScan.started_at.desc()).limit(1))
    failures = (
        []
        if last is None
        else db.scalars(
            select(m.FCCObservation)
            .where(
                m.FCCObservation.scan_id == last.id,
                m.FCCObservation.status.in_(("failed", "unavailable")),
            )
            .order_by(m.FCCObservation.url)
            .limit(limit)
        ).all()
    )
    from alethical.pipeline.fcc_document_text import EXTRACTOR_VERSION

    unreadable = db.execute(
        select(
            m.FCCExtraction.content_hash, m.FCCExtraction.status, m.FCCExtraction.errors
        )
        .where(
            m.FCCExtraction.version == EXTRACTOR_VERSION,
            m.FCCExtraction.status != "pending_review",
        )
        .order_by(m.FCCExtraction.content_hash)
        .limit(limit)
    ).all()
    pending = db.scalar(
        select(func.count(func.distinct(m.FCCDocument.content_hash))).where(
            ~select(m.FCCExtraction.content_hash)
            .where(
                m.FCCExtraction.content_hash == m.FCCDocument.content_hash,
                m.FCCExtraction.version == EXTRACTOR_VERSION,
            )
            .exists()
        )
    )
    return {
        "latest_scan_id": str(last.id) if last else None,
        "unread_documents": pending,
        "limit_per_list": limit,
        "source_failures": [
            dict(
                url=row.url,
                facility_id=row.facility_id,
                kind=row.kind,
                status=row.status,
                error=row.error,
                details=row.details,
            )
            for row in failures
        ],
        "reading_gaps": [
            dict(content_hash=digest, status=state, errors=errors)
            for digest, state, errors in unreadable
        ],
    }


def mirror_bodies(db: Session, store: Any, mirror: Any, *, limit: int = 1000) -> dict:
    """Copy and read back this archive; the shared daily mirror also covers it."""
    rows = db.scalars(
        select(m.FCCSourceBody)
        .where(m.FCCSourceBody.mirrored_at.is_(None))
        .order_by(m.FCCSourceBody.created_at)
        .limit(limit)
    ).all()
    counts: Counter = Counter()
    for row in rows:
        try:
            with tempfile.TemporaryDirectory(prefix="fcc-mirror-") as directory:
                path = str(Path(directory) / "body.gz")
                store.get(row.object_key, path, max_bytes=row.compressed_byte_size)
                if sha256_of_file(path) != row.compressed_hash:
                    raise ValueError("Primary FCC source failed its fingerprint check")
                mirror.put_and_verify(row.object_key, path, row.compressed_hash)
                # This also proves decompression and original-byte identity from R2.
                read_body(mirror, row)
            row.mirrored_at = now()
            db.commit()
            counts["copied"] += 1
        except Exception:
            db.rollback()
            counts["failed"] += 1
    return dict(counts)
