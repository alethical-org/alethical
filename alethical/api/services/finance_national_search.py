"""Finance Media buys search over every indexed FCC filing, read from local disk.

The active release names one verified SQLite file in private R2. The API copies it
to local disk once, checks its SHA-256 and then answers every search there, so the
filing rows never cross Supabase. Until the copy is ready, reads answer 503 and the
page offers a retry.
"""

from __future__ import annotations

import gzip
import hashlib
import json
import logging
import os
import re
import shutil
import sqlite3
import tempfile
import threading
from dataclasses import dataclass
from pathlib import Path

from sqlalchemy import select
from sqlalchemy.orm import Session

from alethical.api.problems import problem_exception
from alethical.db.models import NationalFCCSearchRelease as Release

log = logging.getLogger(__name__)
PAGE_SIZE = 25
PREVIEW_SIZE = 5
MAX_PAGE = 100_000
SERVICE_LABEL = {
    "TV": "TV",
    "FM": "FM radio",
    "AM": "AM radio",
    "CABLE": "Cable",
    "DBS": "Satellite TV",
    "SDARS": "Satellite radio",
}
WORD = re.compile(r"[0-9A-Za-zÀ-￿]+")
OBJECT_KEY = re.compile(
    r"fcc-national/v1/search/sha256/([a-f0-9]{2})/([a-f0-9]{64})\.sqlite\.gz"
)


@dataclass(frozen=True)
class Ready:
    release_id: str
    path: Path
    meta: dict


class SearchFiles:
    """One verified local copy per release; the previous copy serves until a new one is ready."""

    def __init__(self, root: Path):
        self.root = root
        self.lock = threading.Lock()
        self.ready: Ready | None = None
        self.loading: str | None = None
        self.failed: str | None = None

    def current(self, db: Session) -> Ready:
        release = db.execute(
            select(
                Release.release_id,
                Release.object_key,
                Release.sqlite_sha256,
                Release.stored_sha256,
            ).where(Release.active)
        ).one_or_none()
        if release is None:
            raise LookupError("No search release")
        with self.lock:
            ready = self.ready
            if ready is not None and ready.release_id == release.release_id:
                return ready
            if self.loading != release.release_id:
                self.loading = release.release_id
                self.failed = None
                store = _member_store(db)
                threading.Thread(
                    target=self._load, args=(release, store), daemon=True
                ).start()
        if ready is not None:
            return ready
        raise problem_exception(
            503,
            "Search is starting",
            "Filings are loading. Try again in a moment.",
            type_slug="search-loading",
        )

    def _load(self, release, store) -> None:
        try:
            match = OBJECT_KEY.fullmatch(release.object_key)
            if not match or not re.fullmatch(r"[a-f0-9]{64}", release.sqlite_sha256):
                raise ValueError("The search release names an unexpected object")
            self.root.mkdir(parents=True, exist_ok=True)
            target = self.root / f"{release.sqlite_sha256}.sqlite"
            if not target.exists() or _digest(target) != release.sqlite_sha256:
                _download(store, release, target)
            meta = _meta(target)
            with self.lock:
                previous = self.ready
                self.ready = Ready(release.release_id, target, meta)
                self.loading = None
            if previous and previous.path != target:
                previous.path.unlink(missing_ok=True)
        except Exception as error:  # noqa: BLE001 - reported, the old copy keeps serving
            log.warning(
                "National FCC search file did not load: %s", type(error).__name__
            )
            with self.lock:
                self.loading = None
                self.failed = type(error).__name__


def _member_store(db):
    from alethical.pipeline.national_fcc_read_grant import member_file_store

    try:
        return member_file_store(db)
    except Exception:  # noqa: BLE001
        raise problem_exception(
            503, "Search unavailable", "Filings could not be loaded. Try again."
        ) from None


def _digest(path: Path) -> str:
    with path.open("rb") as stream:
        return hashlib.file_digest(stream, "sha256").hexdigest()


def _download(store, release, target: Path) -> None:
    with tempfile.TemporaryDirectory(dir=target.parent) as temp:
        packed = Path(temp) / "search.sqlite.gz"
        body = store._client.get_object(Bucket=store.bucket, Key=release.object_key)[
            "Body"
        ]
        packed_hash = hashlib.sha256()
        with packed.open("wb") as out:
            try:
                while block := body.read(1 << 20):
                    packed_hash.update(block)
                    out.write(block)
            finally:
                body.close()
        if packed_hash.hexdigest() != release.stored_sha256:
            raise ValueError("Stored search file failed verification")
        unpacked = Path(temp) / "search.sqlite"
        with gzip.open(packed, "rb") as src, unpacked.open("wb") as dst:
            shutil.copyfileobj(src, dst, 1 << 20)
        if _digest(unpacked) != release.sqlite_sha256:
            raise ValueError("Unpacked search file failed verification")
        os.replace(unpacked, target)


def _meta(path: Path) -> dict:
    with _open(path) as db:
        return {k: json.loads(v) for k, v in db.execute("SELECT key, value FROM meta")}


def _open(path: Path) -> sqlite3.Connection:
    db = sqlite3.connect(path.resolve().as_uri() + "?mode=ro&immutable=1", uri=True)
    db.row_factory = sqlite3.Row
    return db


FILES = SearchFiles(
    Path(os.environ.get("ALETHICAL_FCC_SEARCH_DIR") or tempfile.gettempdir())
    / "alethical-fcc-search"
)


def warm() -> None:
    """Start copying the active search file when the server starts."""
    from alethical.db.session import get_session_factory

    def run():
        try:
            with get_session_factory()() as db:
                FILES.current(db)
        except Exception:  # noqa: BLE001 - a search request retries the load
            pass

    threading.Thread(target=run, daemon=True).start()


# ------------------------------------------------------------------ queries


def match_expression(query: str) -> str | None:
    """Every typed word must start a word in the filing's labels."""
    words = WORD.findall(query)[:12]
    if not words:
        return None
    return " AND ".join(f'"{w}"*' for w in words)


def _page(page: int) -> int:
    return min(MAX_PAGE, max(1, page))


def about(meta: dict) -> dict:
    return {
        "filings": meta["filings"],
        "index_through": meta["index_through"],
        "saved": meta["saved"],
        "saved_updated": meta["saved_updated"],
        "complete": meta["unchecked"] == 0,
    }


def _years(db) -> list[int]:
    return [
        r[0]
        for r in db.execute("SELECT DISTINCT year FROM outlet_years ORDER BY year DESC")
    ]


def _filing_row(r) -> dict:
    return {
        "key": r["record_key"],
        "name": r["name"],
        "folder": r["folder"],
        "station": r["station"],
        "service": SERVICE_LABEL.get(r["service"], r["service"]),
        "uploaded": r["uploaded"],
        "file_id": r["file_id"],
        "pdf": r["pdf"],
        "minnesota_key": r["mn_key"],
    }


FILING_FIELDS = (
    "f.record_key, f.name, f.folder, f.uploaded, f.file_id, f.pdf, f.mn_key,"
    " o.name AS station, o.service"
)


def filings(
    ready: Ready,
    *,
    q: str,
    year: int,
    doctype: str,
    pdf_only: bool,
    sort: str,
    page: int,
    preview: bool = False,
) -> dict:
    page = _page(page)
    where = ["f.year = ?"]
    args: list = [year]
    if doctype == "orders":
        where.append("f.orderish = 1")
    if pdf_only:
        where.append("f.pdf = 'saved'")
    expression = match_expression(q)
    if expression:
        where.append(
            "f.id IN (SELECT rowid FROM filings_fts WHERE filings_fts MATCH ?)"
        )
        args.append(expression)
    order = "f.name, f.id" if sort == "name" else "f.uploaded DESC, f.id"
    size = PREVIEW_SIZE if preview else PAGE_SIZE
    with _open(ready.path) as db:
        clause = " AND ".join(where)
        rows = db.execute(
            f"SELECT {FILING_FIELDS} FROM filings f JOIN outlets o ON o.id = f.outlet_id"
            f" WHERE {clause} ORDER BY {order} LIMIT ? OFFSET ?",
            (*args, size, (page - 1) * PAGE_SIZE),
        ).fetchall()
        total = db.execute(
            f"SELECT count(*) FROM filings f WHERE {clause}", args
        ).fetchone()[0]
        years = _years(db)
    return {
        "tab": "all-filings",
        "q": q,
        "year": year,
        "years": years,
        "page": page,
        "page_size": PAGE_SIZE,
        "total": total,
        "rows": [_filing_row(r) for r in rows],
        "about": about(ready.meta),
    }


def advertisers(ready: Ready, *, q: str, year: int, page: int) -> dict:
    page = _page(page)
    where, args = ["d.year = ?"], [year]
    expression = match_expression(q)
    if expression:
        where.append(
            "d.id IN (SELECT rowid FROM folders_fts WHERE folders_fts MATCH ?)"
        )
        args.append(expression)
    clause = " AND ".join(where)
    with _open(ready.path) as db:
        rows = db.execute(
            "SELECT d.id, d.label, d.path, d.filings, d.with_pdf, o.name AS station,"
            f" o.service FROM folders d JOIN outlets o ON o.id = d.outlet_id WHERE {clause}"
            " ORDER BY d.label COLLATE NOCASE, d.id LIMIT ? OFFSET ?",
            (*args, PAGE_SIZE, (page - 1) * PAGE_SIZE),
        ).fetchall()
        total = db.execute(
            f"SELECT count(*) FROM folders d WHERE {clause}", args
        ).fetchone()[0]
        years = _years(db)
    return {
        "tab": "advertisers",
        "q": q,
        "year": year,
        "years": years,
        "page": page,
        "page_size": PAGE_SIZE,
        "total": total,
        "rows": [
            {
                "key": f"folder-{r['id']}",
                "label": r["label"],
                "folder": r["path"],
                "station": r["station"],
                "service": SERVICE_LABEL.get(r["service"], r["service"]),
                "filings": r["filings"],
                "with_pdf": r["with_pdf"],
            }
            for r in rows
        ],
    }


def outlets(ready: Ready, *, q: str, year: int, page: int) -> dict:
    page = _page(page)
    where, args = [], []
    expression = match_expression(q)
    if expression:
        where.append(
            "o.id IN (SELECT rowid FROM outlets_fts WHERE outlets_fts MATCH ?)"
        )
        args.append(expression)
    clause = ("WHERE " + " AND ".join(where)) if where else ""
    with _open(ready.path) as db:
        rows = db.execute(
            "SELECT o.id, o.name, o.service, o.ident, o.place, o.years, o.mn_station,"
            " y.filings, y.with_pdf FROM outlets o"
            f" LEFT JOIN outlet_years y ON y.outlet_id = o.id AND y.year = ? {clause}"
            " ORDER BY o.name COLLATE NOCASE, o.id LIMIT ? OFFSET ?",
            (year, *args, PAGE_SIZE, (page - 1) * PAGE_SIZE),
        ).fetchall()
        total = db.execute(f"SELECT count(*) FROM outlets o {clause}", args).fetchone()[
            0
        ]
        years = _years(db)
    return {
        "tab": "stations-and-providers",
        "q": q,
        "year": year,
        "years": years,
        "page": page,
        "page_size": PAGE_SIZE,
        "total": total,
        "rows": [
            {
                "key": f"outlet-{r['id']}",
                "name": r["name"],
                "service": SERVICE_LABEL.get(r["service"], r["service"]),
                "ident": r["ident"],
                "place": r["place"],
                "years": [int(y) for y in r["years"].split(",") if y],
                "filings": r["filings"] or 0,
                "with_pdf": r["with_pdf"] or 0,
                "minnesota_station": r["mn_station"],
            }
            for r in rows
        ],
    }


def filing(ready: Ready, key: str) -> dict:
    with _open(ready.path) as db:
        r = db.execute(
            "SELECT f.*, o.name AS station, o.service, o.ident, o.place, o.mn_station"
            " FROM filings f JOIN outlets o ON o.id = f.outlet_id WHERE f.record_key = ?",
            (key,),
        ).fetchone()
    if r is None:
        raise LookupError("Filing not indexed")
    return {
        "key": r["record_key"],
        "name": r["name"],
        "folder": r["folder"],
        "year": r["year"],
        "station": r["station"],
        "service": SERVICE_LABEL.get(r["service"], r["service"]),
        "ident": r["ident"],
        "place": r["place"],
        "file_id": r["file_id"],
        "uploaded": r["uploaded"],
        "pdf": r["pdf"],
        "saved_on": r["saved_on"],
        "pages": r["pages"],
        "content_hash": r["sha256"],
        "has_text": bool(r["text_key"]),
        "minnesota_key": r["mn_key"],
        "source_url": (
            f"https://files.fcc.gov/download/{r['manager']}.pdf"
            if re.fullmatch(
                r"[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}", r["manager"] or ""
            )
            else None
        ),
    }


def saved_national(ready: Ready, q: str, page: int, preview: bool) -> dict:
    """Saved national originals that open in the national file reader."""
    where = ["f.pdf = 'saved'", "f.sha256 IS NOT NULL"]
    args: list = []
    expression = match_expression(q)
    if expression:
        where.append(
            "f.id IN (SELECT rowid FROM filings_fts WHERE filings_fts MATCH ?)"
        )
        args.append(expression)
    clause = " AND ".join(where)
    page = _page(page)
    with _open(ready.path) as db:
        rows = db.execute(
            "SELECT f.record_key, f.name, f.folder, f.year, f.sha256, o.name AS station,"
            f" o.service FROM filings f JOIN outlets o ON o.id = f.outlet_id WHERE {clause}"
            " ORDER BY f.record_key LIMIT ? OFFSET ?",
            (*args, PREVIEW_SIZE if preview else PAGE_SIZE, (page - 1) * PAGE_SIZE),
        ).fetchall()
        total = db.execute(
            f"SELECT count(*) FROM filings f WHERE {clause}", args
        ).fetchone()[0]
    return {"total": total, "rows": [dict(r) for r in rows]}


def original_record(ready: Ready, key: str) -> dict:
    """A saved national original in the same shape as an archive release row."""
    with _open(ready.path) as db:
        r = db.execute(
            "SELECT f.record_key, f.name, f.folder, f.year, f.file_id, f.sha256, f.bytes,"
            " f.pages, f.text_key, f.manager, o.service, o.entity_id, o.name AS station,"
            " o.place FROM filings f JOIN outlets o ON o.id = f.outlet_id"
            " WHERE f.record_key = ? AND f.pdf = 'saved' AND f.sha256 IS NOT NULL",
            (key,),
        ).fetchone()
    if r is None:
        raise LookupError("No saved original")
    sha = r["sha256"]
    return {
        "record_key": r["record_key"],
        "title": r["name"],
        "station_name": r["station"],
        "service": r["service"],
        "state": (r["place"] or "").rsplit(", ", 1)[-1] or None,
        "folder_path": r["folder"],
        "file_year": r["year"],
        "file_id": r["file_id"],
        "content_hash": sha,
        "byte_size": r["bytes"],
        "page_count": r["pages"],
        "object_key": f"fcc-national/v1/originals/sha256/{sha[:2]}/{sha}.pdf",
        "text_object_key": r["text_key"],
        "source_url": f"https://files.fcc.gov/download/{r['manager']}.pdf"
        if r["manager"]
        else "",
    }
