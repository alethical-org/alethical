"""Finance Media buys search over every indexed FCC filing, read from local disk.

The active release names one verified SQLite file in private R2. The API copies it
to local disk once, checks its SHA-256 and then answers every search there, so the
filing rows never cross Supabase. The active release itself is read from Supabase at
most once per 30 seconds per process, so an activation takes effect within 30
seconds. Until the copy is ready, reads answer 503 and the page offers a retry.
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
import time
import unicodedata
from dataclasses import dataclass
from pathlib import Path

from sqlalchemy import select
from sqlalchemy.orm import Session

from alethical.api.problems import problem_exception
from alethical.db.models import NationalFCCSearchRelease as Release

log = logging.getLogger(__name__)
FORMAT = 2
PAGE_SIZE = 25
PREVIEW_SIZE = 5
MAX_PAGE = 100_000
RELEASE_TTL_SECONDS = 30.0
SERVICE_LABEL = {
    "TV": "TV",
    "FM": "FM radio",
    "AM": "AM radio",
    "CABLE": "Cable",
    "DBS": "Satellite TV",
    "SDARS": "Satellite radio",
}
PDF_STATE = {0: "unchecked", 1: "saved", 2: "unavailable"}
WORD = re.compile(r"[0-9A-Za-zÀ-￿]+")
# The search file's tokenizer splits on every character that is not a letter or a
# number, so each typed word is matched as those pieces.
TOKEN = re.compile(r"[^\W_]+")
UUID = re.compile(r"[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}")
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

    def __init__(self, root: Path, clock=time.monotonic):
        self.root = root
        self.clock = clock
        self.lock = threading.Lock()
        self.ready: Ready | None = None
        self.loading: str | None = None
        self.failed: str | None = None
        self.release = None
        self.release_read_at: float | None = None

    def _active(self, db: Session):
        """The active release, read from the database at most once per 30 seconds."""
        now = self.clock()
        with self.lock:
            if (
                self.release_read_at is not None
                and now - self.release_read_at < RELEASE_TTL_SECONDS
            ):
                return self.release
        release = db.execute(
            select(
                Release.release_id,
                Release.object_key,
                Release.sqlite_sha256,
                Release.stored_sha256,
            ).where(Release.active)
        ).one_or_none()
        with self.lock:
            self.release, self.release_read_at = release, now
        return release

    def current(self, db: Session) -> Ready:
        release = self._active(db)
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
            if meta.get("format") != FORMAT:
                raise ValueError("The search file has a format this server cannot read")
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


def _words(query: str) -> list[str]:
    return [t for w in WORD.findall(query) for t in TOKEN.findall(w)][:12]


def _expression(words) -> str | None:
    return " AND ".join(f'"{w}"*' for w in words) or None


def match_expression(query: str) -> str | None:
    """Every typed word must start a word in the labels."""
    return _expression(_words(query))


def _fold(word: str) -> str:
    """The tokenizer's own case and accent folding."""
    return "".join(
        c
        for c in unicodedata.normalize("NFD", word.lower())
        if not unicodedata.combining(c)
    )


def filing_terms(query: str) -> tuple[list[str], list[str]]:
    """Split the typed words for the filing index.

    Every folder path starts "Political Files/<year>", so the index leaves out those
    3 words: a word that starts "political" or "files" matches every filing, and a
    word that starts the year matches every filing of that year. Returns the words
    the index must match and the words that can only start a year.
    """
    indexed, year_words = [], []
    for word in _words(query):
        folded = _fold(word)
        if "political".startswith(folded) or "files".startswith(folded):
            continue
        (year_words if folded.isdigit() and len(folded) <= 4 else indexed).append(word)
    return indexed, year_words


def filing_expression(query: str, year: int) -> str | None:
    indexed, year_words = filing_terms(query)
    words = [*indexed, *(w for w in year_words if not str(year).startswith(_fold(w)))]
    return _expression(words)


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
    return [r[0] for r in db.execute("SELECT year FROM years ORDER BY year DESC")]


def _text(value):
    """A file or download ID as the FCC writes it."""
    if isinstance(value, bytes) and len(value) == 16:
        h = value.hex()
        return f"{h[:8]}-{h[8:12]}-{h[12:16]}-{h[16:20]}-{h[20:]}"
    return value


def _compact(value: str):
    return bytes.fromhex(value.replace("-", "")) if UUID.fullmatch(value) else value


def _day(value) -> str | None:
    if value is None:
        return None
    text = f"{value:08d}"
    return f"{text[:4]}-{text[4:6]}-{text[6:]}"


def _key(r) -> str:
    return f"{r['service']}|{r['entity_id']}|{_text(r['file_id'])}"


ROW_SOURCE = "filings f JOIN folders d ON d.id = f.folder_id JOIN outlets o ON o.id = f.outlet_id"
FILING_FIELDS = (
    "f.id, f.file_id, f.name, f.uploaded, f.pdf, f.mn_key, d.path AS folder,"
    " o.name AS station, o.service, o.entity_id"
)


def _filing_row(r) -> dict:
    return {
        "key": _key(r),
        "name": r["name"],
        "folder": r["folder"],
        "station": r["station"],
        "service": SERVICE_LABEL.get(r["service"], r["service"]),
        "uploaded": _day(r["uploaded"]),
        "file_id": _text(r["file_id"]),
        "pdf": PDF_STATE[r["pdf"]],
        "minnesota_key": r["mn_key"],
    }


def _rows_by_id(db, ids: list[int], fields: str) -> list:
    if not ids:
        return []
    found = {
        r["id"]: r
        for r in db.execute(
            f"SELECT {fields} FROM {ROW_SOURCE} WHERE f.id IN"
            f" ({','.join('?' * len(ids))})",
            ids,
        )
    }
    return [found[i] for i in ids]


SORT_IN_MEMORY = 20_000


def _filtered(db, words, order, filters, expression, first, last, size, offset):
    """A filtered page and its total. Word matches of a Name A-Z page are sorted in
    memory when few, else found by walking the year's name order."""
    where = [f"f.{order} BETWEEN ? AND ?", *filters]
    args: list = [first, last]
    hint = ""
    if expression:
        fts = f"(SELECT rowid FROM {words} WHERE {words} MATCH ?)"
        count_clause = " AND ".join([*where, f"f.id IN {fts}"])
        count_args = [*args, expression]
        total = db.execute(
            f"SELECT count(*) FROM filings f WHERE {count_clause}", count_args
        ).fetchone()[0]
        if order == "name_rank" and total > SORT_IN_MEMORY:
            hint, where = " INDEXED BY filings_name", [*where, f"+f.id IN {fts}"]
        else:
            where = [*where, f"f.id IN {fts}"]
        args = count_args
    clause = " AND ".join(where)
    if not expression:
        total = db.execute(
            f"SELECT count(*) FROM filings f WHERE {clause}", args
        ).fetchone()[0]
    ids = [
        r[0]
        for r in db.execute(
            f"SELECT f.id FROM filings f{hint} WHERE {clause}"
            f" ORDER BY f.{order} LIMIT ? OFFSET ?",
            (*args, size, offset),
        )
    ]
    return ids, total


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
    size = PREVIEW_SIZE if preview else PAGE_SIZE
    offset = (page - 1) * PAGE_SIZE
    # Within a year, id follows upload date (newest first) and name_rank follows
    # name; both break ties by source order.
    order = "name_rank" if sort == "name" else "id"
    filters = []
    if doctype == "orders":
        filters.append("f.orderish = 1")
    if pdf_only:
        filters.append("f.pdf = 1")
    expression = filing_expression(q, year)
    with _open(ready.path) as db:
        years = _years(db)
        span = db.execute(
            "SELECT first_id, last_id FROM years WHERE year = ?", (year,)
        ).fetchone()
        ids: list[int] = []
        total = 0
        if span is not None:
            first, last = span
            # The year's own word index (the year comes from the years table).
            words = f"filings_fts_{int(year)}"
            if not filters and not expression:
                total = last - first + 1
                low = first + offset
                ids = [
                    r[0]
                    for r in db.execute(
                        f"SELECT id FROM filings WHERE {order} BETWEEN ? AND ?"
                        f" ORDER BY {order}",
                        (low, min(last, low + size - 1)),
                    )
                ]
            elif not filters and order == "id":
                # FTS returns ids in order, so the words alone answer the page.
                match = f"FROM {words} WHERE {words} MATCH ?"
                args = (expression,)
                ids = [
                    r[0]
                    for r in db.execute(
                        f"SELECT rowid {match} ORDER BY rowid LIMIT ? OFFSET ?",
                        (*args, size, offset),
                    )
                ]
                total = db.execute(f"SELECT count(*) {match}", args).fetchone()[0]
            else:
                ids, total = _filtered(
                    db, words, order, filters, expression, first, last, size, offset
                )
        rows = _rows_by_id(db, ids, FILING_FIELDS)
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


def _by_key(db, key: str, extra: str = ""):
    """One filing by its record key, through the (outlet, file ID) index."""
    parts = key.split("|", 2)
    if len(parts) != 3:
        return None
    service, entity, file_id = parts
    return db.execute(
        "SELECT f.*, d.path AS folder, d.year, o.name AS station, o.service,"
        f" o.entity_id, o.ident, o.place, o.mn_station FROM {ROW_SOURCE}"
        f" WHERE o.service = ? AND o.entity_id = ? AND f.file_id = ? {extra}",
        (service, entity, _compact(file_id)),
    ).fetchone()


def filing(ready: Ready, key: str) -> dict:
    with _open(ready.path) as db:
        r = _by_key(db, key)
    if r is None:
        raise LookupError("Filing not indexed")
    manager = _text(r["manager"])
    return {
        "key": _key(r),
        "name": r["name"],
        "folder": r["folder"],
        "year": r["year"],
        "station": r["station"],
        "service": SERVICE_LABEL.get(r["service"], r["service"]),
        "ident": r["ident"],
        "place": r["place"],
        "file_id": _text(r["file_id"]),
        "uploaded": _day(r["uploaded"]),
        "pdf": PDF_STATE[r["pdf"]],
        "saved_on": r["saved_on"],
        "pages": r["pages"],
        "content_hash": r["sha256"].hex() if r["sha256"] is not None else None,
        "has_text": bool(r["text_key"]),
        "minnesota_key": r["mn_key"],
        "source_url": (
            f"https://files.fcc.gov/download/{manager}.pdf"
            if UUID.fullmatch(manager or "")
            else None
        ),
    }


def saved_national(ready: Ready, q: str, page: int, preview: bool) -> dict:
    """Saved national originals that open in the national file reader."""
    # key_rank orders exactly the saved filings with a SHA-256 by record key.
    where = ["f.key_rank IS NOT NULL"]
    args: list = []
    indexed, year_words = filing_terms(q)
    fts = "(SELECT rowid FROM originals_fts WHERE originals_fts MATCH ?)"
    # Walk the saved originals in key order and check each against the words.
    if indexed:
        where.append(f"+f.id IN {fts}")
        args.append(_expression(indexed))
    for word in year_words:
        where.append(
            f"(+f.id IN {fts} OR f.folder_id IN"
            " (SELECT id FROM folders WHERE substr(year, 1, ?) = ?))"
        )
        args += [_expression([word]), len(word), _fold(word)]
    clause = " AND ".join(where)
    page = _page(page)
    with _open(ready.path) as db:
        ids = [
            r[0]
            for r in db.execute(
                f"SELECT f.id FROM filings f INDEXED BY filings_originals WHERE {clause}"
                " ORDER BY f.key_rank LIMIT ? OFFSET ?",
                (*args, PREVIEW_SIZE if preview else PAGE_SIZE, (page - 1) * PAGE_SIZE),
            )
        ]
        rows = _rows_by_id(
            db,
            ids,
            "f.id, f.file_id, f.name, f.sha256, d.path AS folder, d.year,"
            " o.name AS station, o.service, o.entity_id",
        )
        total = db.execute(
            f"SELECT count(*) FROM filings f INDEXED BY filings_originals WHERE {clause}",
            args,
        ).fetchone()[0]
    return {
        "total": total,
        "rows": [
            {
                "record_key": _key(r),
                "name": r["name"],
                "folder": r["folder"],
                "year": r["year"],
                "sha256": r["sha256"].hex(),
                "station": r["station"],
                "service": r["service"],
            }
            for r in rows
        ],
    }


def original_record(ready: Ready, key: str) -> dict:
    """A saved national original in the same shape as an archive release row."""
    with _open(ready.path) as db:
        r = _by_key(db, key, "AND f.pdf = 1 AND f.sha256 IS NOT NULL")
    if r is None:
        raise LookupError("No saved original")
    sha = r["sha256"].hex()
    manager = _text(r["manager"])
    return {
        "record_key": _key(r),
        "title": r["name"],
        "station_name": r["station"],
        "service": r["service"],
        "state": (r["place"] or "").rsplit(", ", 1)[-1] or None,
        "folder_path": r["folder"],
        "file_year": r["year"],
        "file_id": _text(r["file_id"]),
        "content_hash": sha,
        "byte_size": r["bytes"],
        "page_count": r["pages"],
        "object_key": f"fcc-national/v1/originals/sha256/{sha[:2]}/{sha}.pdf",
        "text_object_key": r["text_key"],
        "source_url": f"https://files.fcc.gov/download/{manager}.pdf"
        if manager
        else "",
    }
