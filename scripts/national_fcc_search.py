#!/usr/bin/env python3
"""Build, publish and activate the Finance search file for every indexed FCC filing.

The search file is one read-only SQLite database. Finance downloads it from private
R2 and answers Media buys searches from local disk, so the 2.7 million filing rows
never enter Supabase. Each filing carries one PDF state:

* ``saved``: a verified original is held (archive release, census or the Minnesota
  collection) and opens in Finance.
* ``unavailable``: a completed check found no saved copy and none from the FCC.
* ``unchecked``: no completed check yet. Finance must never show such a row as
  Not available.

Commands: ``build`` writes the database locally; ``publish`` stores it once under
its SHA-256 and records an inactive release; ``activate`` switches Finance to it.
"""

from __future__ import annotations

import argparse
import gzip
import hashlib
import json
import re
import shutil
import sqlite3
import sys
from collections import Counter, defaultdict
from contextlib import closing
from datetime import UTC, datetime
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

FORMAT = 1
PREFIX = "fcc-national/v1/search"
SERVICE_LABEL = {
    "TV": "TV",
    "FM": "FM radio",
    "AM": "AM radio",
    "CABLE": "Cable",
    "DBS": "Satellite TV",
    "SDARS": "Satellite radio",
}
YEAR = re.compile(r"^Political Files/(\d{4})(?:/|$)")
# Filenames are not evidence of a document type. The Finance page says so beside
# every result; this only powers the drawn "Orders and contracts" filter.
ORDERISH = re.compile(r"order|contract", re.IGNORECASE)

SCHEMA = """
CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE outlets (
  id INTEGER PRIMARY KEY, service TEXT NOT NULL, entity_id TEXT NOT NULL,
  name TEXT NOT NULL, ident TEXT NOT NULL, place TEXT, mn_station TEXT,
  years TEXT NOT NULL, UNIQUE (service, entity_id)
);
CREATE TABLE outlet_years (
  outlet_id INTEGER NOT NULL, year INTEGER NOT NULL, filings INTEGER NOT NULL,
  with_pdf INTEGER NOT NULL, PRIMARY KEY (outlet_id, year)
) WITHOUT ROWID;
CREATE TABLE folders (
  id INTEGER PRIMARY KEY, outlet_id INTEGER NOT NULL, year INTEGER NOT NULL,
  path TEXT NOT NULL, label TEXT NOT NULL, filings INTEGER NOT NULL,
  with_pdf INTEGER NOT NULL
);
CREATE TABLE filings (
  id INTEGER PRIMARY KEY, record_key TEXT NOT NULL UNIQUE, outlet_id INTEGER NOT NULL,
  file_id TEXT NOT NULL, folder TEXT NOT NULL, year INTEGER NOT NULL,
  name TEXT NOT NULL, ext TEXT, uploaded TEXT, orderish INTEGER NOT NULL,
  pdf TEXT NOT NULL CHECK (pdf IN ('saved', 'unavailable', 'unchecked')),
  sha256 TEXT, bytes INTEGER, pages INTEGER, saved_on TEXT, checked_on TEXT,
  text_key TEXT, mn_key TEXT, manager TEXT
);
"""

INDEXES = """
CREATE INDEX filings_year_date ON filings (year, uploaded DESC, id);
CREATE INDEX filings_year_name ON filings (year, name, id);
CREATE INDEX filings_year_pdf_date ON filings (year, pdf, uploaded DESC, id);
CREATE INDEX filings_year_order_date ON filings (year, orderish, uploaded DESC, id);
CREATE INDEX filings_outlet ON filings (outlet_id, year);
CREATE INDEX folders_year ON folders (year, label, id);
CREATE INDEX outlets_name ON outlets (name, id);
CREATE VIRTUAL TABLE filings_fts USING fts5(
  name, folder, station, ident, file_id, content='', tokenize='unicode61'
);
CREATE VIRTUAL TABLE folders_fts USING fts5(label, station, content='', tokenize='unicode61');
CREATE VIRTUAL TABLE outlets_fts USING fts5(
  name, ident, service, place, content='', tokenize='unicode61'
);
"""


def day(value):
    """The FCC timestamp's own calendar date, as the source wrote it."""
    if not value:
        return None
    match = re.match(r"^(\d{4}-\d{2}-\d{2})", str(value))
    return match[1] if match else None


def outlet_fields(source: dict, service: str, entity: str):
    callsign = (source.get("callsign") or "").strip()
    owner = (source.get("legalname") or source.get("licensee") or "").strip()
    city, state = (
        (source.get("city") or "").strip(),
        (source.get("state") or "").strip(),
    )
    place = ", ".join(p for p in (city.title() if city.isupper() else city, state) if p)
    if service == "CABLE":
        return owner or f"Cable system {entity}", f"Cable system ID {entity}", place
    if service == "DBS":
        return owner or entity, "Satellite TV provider", place
    if service == "SDARS":
        return owner or entity, "Satellite radio provider", place
    return callsign or owner or entity, callsign or f"Facility ID {entity}", place


def archive_rows(target: str):
    """The active archive release's verified originals, read only."""
    from sqlalchemy import create_engine, text

    from alethical.db.session import NO_PREPARED_STATEMENTS, database_url_for_target

    engine = create_engine(
        database_url_for_target(target), connect_args=NO_PREPARED_STATEMENTS
    )
    with engine.connect() as conn:
        conn.execute(text("SET TRANSACTION READ ONLY"))
        release = conn.execute(
            text(
                "SELECT snapshot_id, created_at FROM national_fcc_snapshot WHERE active"
            )
        ).one()
        originals = {
            r.record_key: r
            for r in conn.execute(
                text(
                    "SELECT record_key, content_hash, byte_size, page_count, text_object_key"
                    " FROM national_fcc_original WHERE snapshot_id = :s"
                ),
                {"s": release.snapshot_id},
            )
        }
        minnesota = {}
        for r in conn.execute(
            text(
                "SELECT facility_id, file_id, min(first_seen_at) AS saved_at FROM fcc_document"
                " WHERE facility_id IN ('28010', '23079', '68883') GROUP BY 1, 2"
            )
        ):
            minnesota[f"TV|{r.facility_id}|{r.file_id}"] = r
    engine.dispose()
    return release, originals, minnesota


def census_rows(path: Path):
    with gzip.open(path, "rt") as stream:
        for line in stream:
            row = json.loads(line)
            yield row["k"], row


def cmd_build(args):
    release, originals, minnesota = archive_rows(args.target)
    census = dict(census_rows(args.census_export)) if args.census_export else {}
    meta = build(
        args.inventory,
        args.out,
        release=release,
        originals=originals,
        minnesota=minnesota,
        census=census,
        index_through=args.index_through,
        saved_updated=args.saved_updated,
        census_run=args.census_run,
    )
    print(json.dumps(meta))


def build(
    inventory: Path,
    out: Path,
    *,
    release,
    originals: dict,
    minnesota: dict,
    census: dict,
    index_through: str,
    saved_updated: str | None = None,
    census_run: str = "",
) -> dict:
    from alethical.api.services.tv_ads import file_key

    archive_day = release.created_at.astimezone(UTC).date().isoformat()
    out.unlink(missing_ok=True)
    db = sqlite3.connect(out)
    db.executescript("PRAGMA journal_mode=OFF; PRAGMA synchronous=OFF;" + SCHEMA)
    outlets = {}
    outlet_years = defaultdict(lambda: [0, 0])
    folders = {}
    states = Counter()
    batch = []
    source_db = sqlite3.connect(inventory.resolve().as_uri() + "?mode=ro", uri=True)

    def flush():
        db.executemany(
            "INSERT INTO filings VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)", batch
        )
        batch.clear()

    with closing(source_db):
        for rowid, (key, file_id, service, entity, folder, name, raw) in enumerate(
            source_db.execute(
                "SELECT record_key, file_id, service, entity_id, folder_path, file_name,"
                " source_json FROM files ORDER BY rowid"
            ),
            start=1,
        ):
            source = json.loads(raw)
            year_match = YEAR.match(folder or "")
            if not year_match:
                raise ValueError(f"Filing without a folder year: {key}")
            year = int(year_match[1])
            outlet_key = (service, entity)
            if outlet_key not in outlets:
                label, ident, place = outlet_fields(source, service, entity)
                mn = (
                    entity
                    if service == "TV" and entity in ("28010", "23079", "68883")
                    else None
                )
                outlets[outlet_key] = [
                    len(outlets) + 1,
                    service,
                    entity,
                    label,
                    ident,
                    place,
                    mn,
                ]
            outlet_id = outlets[outlet_key][0]
            pdf, sha, size, pages, saved_on, checked_on, text_key, mn_key = (
                "unchecked",
                None,
                None,
                None,
                None,
                None,
                None,
                None,
            )
            archived = originals.get(key)
            outcome = census.get(key, {})
            if archived is not None:
                pdf, sha, size, pages = (
                    "saved",
                    archived.content_hash,
                    archived.byte_size,
                    archived.page_count,
                )
                saved_on, text_key = archive_day, archived.text_object_key
            elif key in minnesota:
                pdf, mn_key = "saved", file_key(entity, file_id)
                saved_on = minnesota[key].saved_at.astimezone(UTC).date().isoformat()
            elif outcome.get("state") == "saved":
                pdf, sha, size, pages = (
                    "saved",
                    outcome["sha"],
                    outcome["b"],
                    outcome["p"],
                )
                saved_on = datetime.fromtimestamp(outcome["t"], UTC).date().isoformat()
            elif outcome.get("state") == "unavailable":
                pdf = "unavailable"
                checked_on = (
                    datetime.fromtimestamp(outcome["t"], UTC).date().isoformat()
                )
            states[pdf] += 1
            has_pdf = pdf == "saved"
            counts = outlet_years[(outlet_id, year)]
            counts[0] += 1
            counts[1] += has_pdf
            folder_key = (outlet_id, year, folder)
            if folder_key not in folders:
                folders[folder_key] = [len(folders) + 1, 0, 0]
            folders[folder_key][1] += 1
            folders[folder_key][2] += has_pdf
            title = name or file_id
            batch.append(
                (
                    rowid,
                    key,
                    outlet_id,
                    file_id,
                    folder,
                    year,
                    title,
                    source.get("file_extension"),
                    day(source.get("create_ts")),
                    int(bool(ORDERISH.search(title))),
                    pdf,
                    sha,
                    size,
                    pages,
                    saved_on,
                    checked_on,
                    text_key,
                    mn_key,
                    outcome.get("mg")
                    or (source.get("file_manager_id") or "").lower()
                    or None,
                )
            )
            if len(batch) >= 50000:
                flush()
        flush()
    years_by_outlet = defaultdict(set)
    for outlet_id, year in outlet_years:
        years_by_outlet[outlet_id].add(year)
    db.executemany(
        "INSERT INTO outlets VALUES (?,?,?,?,?,?,?,?)",
        [
            (
                *values,
                ",".join(
                    str(y) for y in sorted(years_by_outlet[values[0]], reverse=True)
                ),
            )
            for values in outlets.values()
        ],
    )
    db.executemany(
        "INSERT INTO outlet_years VALUES (?,?,?,?)",
        [(o, y, c[0], c[1]) for (o, y), c in outlet_years.items()],
    )
    db.executemany(
        "INSERT INTO folders VALUES (?,?,?,?,?,?,?)",
        [
            (fid, o, y, path, path.rstrip("/").rsplit("/", 1)[-1].strip(), n, p)
            for (o, y, path), (fid, n, p) in folders.items()
        ],
    )
    db.executescript(INDEXES)
    db.execute(
        "INSERT INTO filings_fts (rowid, name, folder, station, ident, file_id)"
        " SELECT f.id, f.name, replace(f.folder, '/', ' '), o.name, o.ident, f.file_id"
        " FROM filings f JOIN outlets o ON o.id = f.outlet_id"
    )
    db.execute(
        "INSERT INTO folders_fts (rowid, label, station)"
        " SELECT d.id, d.label, o.name FROM folders d JOIN outlets o ON o.id = d.outlet_id"
    )
    db.execute(
        "INSERT INTO outlets_fts (rowid, name, ident, service, place)"
        " SELECT id, name, ident, service, coalesce(place, '') FROM outlets"
    )
    saved_days = [
        r[0]
        for r in db.execute(
            "SELECT max(saved_on) FROM filings WHERE pdf = 'saved' AND saved_on IS NOT NULL"
        )
    ]
    meta = {
        "format": FORMAT,
        "snapshot_id": release.snapshot_id,
        "index_through": index_through,
        "filings": sum(states.values()),
        "saved": states["saved"],
        "unavailable": states["unavailable"],
        "unchecked": states["unchecked"],
        "saved_updated": saved_updated or saved_days[0],
        "census_run": census_run,
        "built_at": datetime.now(UTC).isoformat(timespec="seconds"),
    }
    db.executemany(
        "INSERT INTO meta VALUES (?,?)", [(k, json.dumps(v)) for k, v in meta.items()]
    )
    db.commit()
    db.execute("ANALYZE")
    db.execute("VACUUM")
    db.close()
    return meta | {
        "bytes": out.stat().st_size,
        "outlets": len(outlets),
        "folders": len(folders),
    }


def store():
    from alethical.db.session import load_dotenv_if_present
    from alethical.pipeline.raw_file_store import mirror_file_store_from_env

    load_dotenv_if_present()
    return mirror_file_store_from_env()


def digest(path: Path) -> str:
    with path.open("rb") as stream:
        return hashlib.file_digest(stream, "sha256").hexdigest()


def object_key(sha: str) -> str:
    return f"{PREFIX}/sha256/{sha[:2]}/{sha}.sqlite.gz"


def pack(database: Path) -> Path:
    """A reproducible gzip copy beside the database: no name or time inside."""
    packed = database.with_suffix(".sqlite.gz")
    with (
        database.open("rb") as src,
        packed.open("wb") as raw,
        gzip.GzipFile(
            filename="", mode="wb", fileobj=raw, compresslevel=6, mtime=0
        ) as dst,
    ):
        shutil.copyfileobj(src, dst, 1 << 20)
    return packed


def cmd_publish(args):
    import base64

    from botocore.exceptions import ClientError
    from sqlalchemy import create_engine, text

    from alethical.db.session import NO_PREPARED_STATEMENTS, database_url_for_target

    with closing(
        sqlite3.connect(args.database.resolve().as_uri() + "?mode=ro", uri=True)
    ) as db:
        meta = {k: json.loads(v) for k, v in db.execute("SELECT key, value FROM meta")}
        if db.execute("PRAGMA quick_check").fetchone()[0] != "ok":
            raise ValueError("The search file failed SQLite's quick check")
    sha = digest(args.database)
    size = args.database.stat().st_size
    packed = pack(args.database)
    packed_sha = digest(packed)
    key = object_key(sha)
    files = store()
    with packed.open("rb") as body:
        try:
            files._client.put_object(
                Bucket=files.bucket,
                Key=key,
                Body=body,
                IfNoneMatch="*",
                ContentType="application/gzip",
                ChecksumSHA256=base64.b64encode(bytes.fromhex(packed_sha)).decode(),
                Metadata={"sqlite-sha256": sha},
            )
        except ClientError as error:
            if error.response["ResponseMetadata"]["HTTPStatusCode"] != 412:
                raise
    head = files._client.head_object(
        Bucket=files.bucket, Key=key, ChecksumMode="ENABLED"
    )
    if (
        head.get("ChecksumSHA256")
        != base64.b64encode(bytes.fromhex(packed_sha)).decode()
    ):
        raise ValueError("Stored search file failed verification")
    engine = create_engine(
        database_url_for_target(args.target), connect_args=NO_PREPARED_STATEMENTS
    )
    with engine.begin() as conn:
        conn.execute(
            text(
                "INSERT INTO national_fcc_search_release (release_id, object_key,"
                " sqlite_sha256, sqlite_bytes, stored_sha256, stored_bytes, filings,"
                " saved, unavailable, unchecked, index_through, saved_updated)"
                " VALUES (:id, :key, :sha, :size, :psha, :psize, :filings, :saved,"
                " :unavailable, :unchecked, :through, :updated)"
                " ON CONFLICT (release_id) DO NOTHING"
            ),
            dict(
                id=args.release_id,
                key=key,
                sha=sha,
                size=size,
                psha=packed_sha,
                psize=packed.stat().st_size,
                filings=meta["filings"],
                saved=meta["saved"],
                unavailable=meta["unavailable"],
                unchecked=meta["unchecked"],
                through=meta["index_through"],
                updated=meta["saved_updated"],
            ),
        )
        stored = conn.execute(
            text(
                "SELECT sqlite_sha256 FROM national_fcc_search_release WHERE release_id = :id"
            ),
            {"id": args.release_id},
        ).scalar_one()
        if stored != sha:
            raise ValueError("That release ID already names a different search file")
    engine.dispose()
    packed.unlink()
    print(
        json.dumps(
            {
                "release_id": args.release_id,
                "object_key": key,
                "sqlite_sha256": sha,
                "sqlite_bytes": size,
                **meta,
            }
        )
    )


def cmd_activate(args):
    from sqlalchemy import create_engine, text

    from alethical.db.session import NO_PREPARED_STATEMENTS, database_url_for_target

    engine = create_engine(
        database_url_for_target(args.target), connect_args=NO_PREPARED_STATEMENTS
    )
    with engine.begin() as conn:
        current = conn.execute(
            text("SELECT release_id FROM national_fcc_search_release WHERE active")
        ).scalar()
        if current != (None if args.from_release == "none" else args.from_release):
            raise ValueError(
                f"The active search release is {current}, not {args.from_release}"
            )
        conn.execute(
            text("UPDATE national_fcc_search_release SET active = false WHERE active")
        )
        changed = conn.execute(
            text(
                "UPDATE national_fcc_search_release SET active = true WHERE release_id = :id"
            ),
            {"id": args.release},
        ).rowcount
        if changed != 1:
            raise ValueError("No such search release")
    engine.dispose()
    print(json.dumps({"active": args.release, "previous": current}))


def cli():
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("--target", default="production")
    sub = parser.add_subparsers(dest="command", required=True)
    p = sub.add_parser("build")
    p.add_argument("--inventory", type=Path, required=True)
    p.add_argument("--census-export", type=Path)
    p.add_argument("--census-run", default="census-20261119")
    p.add_argument("--index-through", default="2026-11-16")
    p.add_argument("--saved-updated", help="Override the saved-PDF date (YYYY-MM-DD)")
    p.add_argument("--out", type=Path, required=True)
    p = sub.add_parser("publish")
    p.add_argument("--database", type=Path, required=True)
    p.add_argument("--release-id", required=True)
    p = sub.add_parser("activate")
    p.add_argument("--release", required=True)
    p.add_argument(
        "--from-release", required=True, help="The expected active release, or none"
    )
    return parser


def main():
    args = cli().parse_args()
    {"build": cmd_build, "publish": cmd_publish, "activate": cmd_activate}[
        args.command
    ](args)


if __name__ == "__main__":
    main()
