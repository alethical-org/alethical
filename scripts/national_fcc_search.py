#!/usr/bin/env python3
"""Build, publish and activate the Finance search file for every indexed FCC filing.

The search file is one read-only SQLite database. Finance downloads it from private
R2 and answers Media buys searches from local disk, so the filing rows never enter
Supabase. Each filing carries one PDF state:

* ``saved``: a verified original is held (archive release, census or the Minnesota
  collection) and opens in Finance.
* ``unavailable``: a completed check found no saved copy and none from the FCC.
* ``unchecked``: no completed check yet. Finance must never show such a row as
  Not available.

The filing list comes from the compact inventory in R2 (``current.json``) when one
exists, else from the active archive release's recovered index.

Commands: ``inputs`` prints what the next file would be built from and whether the
active release already covers it; ``build`` writes the database locally; ``publish``
stores it once under its SHA-256 and records an inactive release; ``activate``
switches Finance to it; ``release`` does all of that only when the inputs changed.
"""

from __future__ import annotations

import argparse
import base64
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

FORMAT = 2
ROOT = "fcc-national/v1"
PREFIX = f"{ROOT}/search"
INVENTORY = f"{ROOT}/inventory"
MINNESOTA_STATIONS = ("28010", "23079", "68883")
YEAR = re.compile(r"^Political Files/(\d{4})(?:/|$)")
UUID = re.compile(r"[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}")
# Filenames are not evidence of a document type. The Finance page says so beside
# every result; this only powers the drawn "Orders and contracts" filter.
ORDERISH = re.compile(r"order|contract", re.IGNORECASE)
PDF_CODE = {"unchecked": 0, "saved": 1, "unavailable": 2}

# Filing ids follow (year, upload date newest first, source order) and name_rank
# follows (year, name, source order), so each year is 1 contiguous id range and 1
# contiguous name_rank range (table ``years``). The newest page or the Name A-Z
# page of a year is a direct range read, and no index repeats the name or date.
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
CREATE TABLE years (
  year INTEGER PRIMARY KEY, first_id INTEGER NOT NULL, last_id INTEGER NOT NULL
);
CREATE TABLE filings (
  id INTEGER PRIMARY KEY, name_rank INTEGER NOT NULL, outlet_id INTEGER NOT NULL,
  folder_id INTEGER NOT NULL, file_id NOT NULL, name TEXT NOT NULL,
  uploaded INTEGER, orderish INTEGER NOT NULL, pdf INTEGER NOT NULL,
  sha256 BLOB, bytes INTEGER, pages INTEGER, saved_on TEXT, checked_on TEXT,
  text_key TEXT, mn_key TEXT, manager, key_rank INTEGER
);
"""
# file_id and manager hold 16 bytes for a lowercase UUID, else the FCC's own text.
# pdf: 0 unchecked, 1 saved, 2 unavailable. uploaded: YYYYMMDD. key_rank orders
# saved originals with a SHA-256 by record key, for the national originals list.

INDEXES = """
CREATE INDEX filings_name ON filings (name_rank, orderish, pdf);
CREATE INDEX filings_key ON filings (outlet_id, file_id);
CREATE INDEX filings_saved ON filings (pdf) WHERE pdf = 1;
CREATE INDEX filings_orders ON filings (orderish) WHERE orderish = 1;
CREATE INDEX filings_originals ON filings (key_rank) WHERE key_rank IS NOT NULL;
CREATE INDEX folders_year ON folders (year, label, id);
CREATE INDEX outlets_name ON outlets (name, id);
CREATE VIRTUAL TABLE folders_fts USING fts5(
  label, station, content='', detail=none, columnsize=0, tokenize='unicode61'
);
CREATE VIRTUAL TABLE outlets_fts USING fts5(
  name, ident, service, place, content='', detail=none, columnsize=0,
  tokenize='unicode61'
);
"""

# 1 word index per file year, so a search reads only its year's words, and 1 over
# the saved originals for the national originals list. Each keeps the 1- and
# 2-character prefixes, so a 1- or 2-letter word reads 1 list.
FILING_WORDS = """
CREATE VIRTUAL TABLE {table} USING fts5(
  name, folder, station, ident, file_id,
  content='', detail=none, columnsize=0, tokenize='unicode61', prefix='1 2'
)
"""
# Every path starts "Political Files/<year>" (20 characters). Those 3 words match
# every filing of the year, so the API answers them without the index.
FILL_WORDS = """
INSERT INTO {table} (rowid, name, folder, station, ident, file_id)
SELECT f.id, f.name, replace(substr(d.path, 21), '/', ' '), o.name, o.ident,
  expand(f.file_id)
FROM filings f JOIN folders d ON d.id = f.folder_id JOIN outlets o ON o.id = f.outlet_id
WHERE {where} ORDER BY f.id
"""

STAGE = """
CREATE TEMP TABLE census (
  k TEXT PRIMARY KEY, state INTEGER NOT NULL, sha BLOB, b INTEGER, p INTEGER,
  day TEXT, mg
) WITHOUT ROWID;
CREATE TEMP TABLE stage (
  ord INTEGER PRIMARY KEY, k TEXT NOT NULL, outlet_id INTEGER NOT NULL,
  folder_id INTEGER NOT NULL, year INTEGER NOT NULL, file_id NOT NULL,
  name TEXT NOT NULL, uploaded INTEGER, orderish INTEGER NOT NULL, pdf INTEGER,
  sha BLOB, b INTEGER, p INTEGER, saved_on TEXT, text_key TEXT, mn_key TEXT, mg
);
"""

# One statement settles each filing's PDF state (archive release, then Minnesota,
# then the census) and writes the rows in id order.
FILL = """
WITH resolved AS (
  SELECT s.*, c.state AS c_state, c.sha AS c_sha, c.b AS c_b, c.p AS c_p,
    c.day AS c_day, coalesce(c.mg, s.mg) AS manager,
    coalesce(s.pdf, c.state, 0) AS final_pdf
  FROM stage s LEFT JOIN census c ON c.k = s.k
), ranked AS (
  SELECT *,
    row_number() OVER (ORDER BY year, uploaded DESC, ord) AS new_id,
    row_number() OVER (ORDER BY year, name, ord) AS new_name_rank,
    final_pdf = 1 AND coalesce(sha, c_sha) IS NOT NULL AS keyed
  FROM resolved
)
INSERT INTO filings
SELECT new_id, new_name_rank, outlet_id, folder_id, file_id, name, uploaded,
  orderish, final_pdf,
  CASE WHEN pdf IS NOT NULL THEN sha WHEN c_state = 1 THEN c_sha END,
  CASE WHEN pdf IS NOT NULL THEN b WHEN c_state = 1 THEN c_b END,
  CASE WHEN pdf IS NOT NULL THEN p WHEN c_state = 1 THEN c_p END,
  CASE WHEN pdf IS NOT NULL THEN saved_on WHEN c_state = 1 THEN c_day END,
  CASE WHEN pdf IS NULL AND c_state = 2 THEN c_day END,
  text_key, mn_key, manager,
  CASE WHEN keyed THEN row_number() OVER (PARTITION BY keyed ORDER BY k) END
FROM ranked ORDER BY new_id
"""


def day(value):
    """The FCC timestamp's own calendar date, as the source wrote it."""
    if not value:
        return None
    match = re.match(r"^(\d{4}-\d{2}-\d{2})", str(value))
    return match[1] if match else None


def compact(value):
    """16 bytes for a lowercase UUID; anything else is kept as written."""
    if isinstance(value, str) and UUID.fullmatch(value):
        return bytes.fromhex(value.replace("-", ""))
    return value or None


def expand(value):
    if isinstance(value, bytes) and len(value) == 16:
        h = value.hex()
        return f"{h[:8]}-{h[8:12]}-{h[12:16]}-{h[16:20]}-{h[20:]}"
    return value


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


# ------------------------------------------------------------------ sources


def legacy_rows(path: Path):
    """The recovered index of an archive release (table ``files``), in its order."""
    with closing(
        sqlite3.connect(path.resolve().as_uri() + "?mode=ro", uri=True)
    ) as source:
        for key, file_id, service, entity, folder, name, raw in source.execute(
            "SELECT record_key, file_id, service, entity_id, folder_path, file_name,"
            " source_json FROM files ORDER BY rowid"
        ):
            row = json.loads(raw)
            yield (
                key,
                file_id,
                service,
                entity,
                folder,
                name,
                row.get("create_ts"),
                (row.get("file_manager_id") or "").lower(),
                row,
            )


def inventory_rows(path: Path, expected_rows: int | None = None):
    """The compact inventory (see docs/operations/national-fcc-archive.md), by key."""
    count, previous = 0, None
    with gzip.open(path, "rt") as stream:
        for line in stream:
            r = json.loads(line)
            if previous is not None and r["k"] <= previous:
                raise ValueError("The inventory is not in record key order")
            previous = r["k"]
            count += 1
            yield (
                r["k"],
                r["f"],
                r["s"],
                r["e"],
                r.get("p"),
                r.get("n"),
                r.get("c"),
                (r.get("m") or "").lower(),
                {
                    "callsign": r.get("cs"),
                    "city": r.get("ci"),
                    "state": r.get("st"),
                    "licensee": r.get("li"),
                    "legalname": r.get("lg"),
                },
            )
    if expected_rows is not None and count != expected_rows:
        raise ValueError(f"The inventory holds {count} rows, not {expected_rows}")


def census_entries(census):
    """Saved and confirmed-unavailable outcomes from a census export or mapping."""
    if isinstance(census, Path):
        with gzip.open(census, "rt") as stream:
            items = (json.loads(line) for line in stream)
            yield from _census_values(items)
    else:
        yield from _census_values({"k": k} | v for k, v in census.items())


def _census_values(items):
    for row in items:
        state = row.get("state")
        when = (
            datetime.fromtimestamp(row["t"], UTC).date().isoformat()
            if state in ("saved", "unavailable")
            else None
        )
        if state == "saved":
            yield (
                row["k"],
                1,
                bytes.fromhex(row["sha"]),
                row["b"],
                row["p"],
                when,
                compact(row.get("mg") or None),
            )
        elif state == "unavailable":
            yield row["k"], 2, None, None, None, when, None


# ------------------------------------------------------------------ build


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
        minnesota = {
            f"TV|{r.facility_id}|{r.file_id}": r for r in _minnesota(conn, text)
        }
    engine.dispose()
    return release, originals, minnesota


def _minnesota(conn, text):
    from sqlalchemy import bindparam

    return conn.execute(
        text(
            "SELECT facility_id, file_id, min(first_seen_at) AS saved_at FROM fcc_document"
            " WHERE facility_id IN :ids GROUP BY 1, 2 ORDER BY 1, 2"
        ).bindparams(bindparam("ids", expanding=True)),
        {"ids": list(MINNESOTA_STATIONS)},
    )


def build(
    inventory: Path,
    out: Path,
    *,
    release,
    originals: dict,
    minnesota: dict,
    census,
    index_through: str,
    saved_updated: str | None = None,
    census_run: str = "",
    inputs: dict | None = None,
    expected_rows: int | None = None,
) -> dict:
    """Write the search file. ``inventory`` is a recovered index (``.sqlite``) or a
    compact inventory (``.jsonl.gz``); ``census`` is an export path or a mapping."""
    from alethical.api.services.tv_ads import file_key

    archive_day = release.created_at.astimezone(UTC).date().isoformat()
    rows = (
        inventory_rows(inventory, expected_rows)
        if inventory.name.endswith(".jsonl.gz")
        else legacy_rows(inventory)
    )
    out.unlink(missing_ok=True)
    db = sqlite3.connect(out)
    db.executescript(
        "PRAGMA journal_mode=OFF; PRAGMA synchronous=OFF; PRAGMA cache_size=-524288;"
        + SCHEMA
        + STAGE
    )
    db.create_function("expand", 1, expand, deterministic=True)
    for chunk in _chunks(census_entries(census)):
        db.executemany("INSERT OR REPLACE INTO census VALUES (?,?,?,?,?,?,?)", chunk)
    outlets = {}
    folders = {}
    batch = []
    for ord_, (
        key,
        file_id,
        service,
        entity,
        folder,
        name,
        created,
        mg,
        src,
    ) in enumerate(rows, start=1):
        year_match = YEAR.match(folder or "")
        if not year_match:
            raise ValueError(f"Filing without a folder year: {key}")
        year = int(year_match[1])
        outlet_key = (service, entity)
        if outlet_key not in outlets:
            label, ident, place = outlet_fields(src, service, entity)
            mn = entity if service == "TV" and entity in MINNESOTA_STATIONS else None
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
        folder_key = (outlet_id, year, folder)
        if folder_key not in folders:
            folders[folder_key] = len(folders) + 1
        pdf = sha = size = pages = saved_on = text_key = mn_key = None
        archived = originals.get(key)
        if archived is not None:
            pdf, sha = 1, bytes.fromhex(archived.content_hash)
            size, pages = archived.byte_size, archived.page_count
            saved_on, text_key = archive_day, archived.text_object_key
        elif key in minnesota:
            pdf, mn_key = 1, file_key(entity, file_id)
            saved_on = minnesota[key].saved_at.astimezone(UTC).date().isoformat()
        title = name or file_id
        uploaded = day(created)
        batch.append(
            (
                ord_,
                key,
                outlet_id,
                folders[folder_key],
                year,
                compact(file_id),
                title,
                int(uploaded.replace("-", "")) if uploaded else None,
                int(bool(ORDERISH.search(title))),
                pdf,
                sha,
                size,
                pages,
                saved_on,
                text_key,
                mn_key,
                compact(mg),
            )
        )
        if len(batch) >= 50000:
            db.executemany(
                "INSERT INTO stage VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)", batch
            )
            batch.clear()
    db.executemany(
        "INSERT INTO stage VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)", batch
    )
    db.execute(FILL)
    year_counts = db.execute(
        "SELECT year, count(*) FROM stage GROUP BY year ORDER BY year"
    ).fetchall()
    db.executescript("DROP TABLE temp.stage; DROP TABLE temp.census;")
    first = 1
    year_ranges = []
    for year, n in year_counts:
        year_ranges.append((year, first, first + n - 1))
        first += n
    db.executemany("INSERT INTO years VALUES (?,?,?)", year_ranges)

    counts = {
        folder_id: (n, saved)
        for folder_id, n, saved in db.execute(
            "SELECT folder_id, count(*), sum(pdf = 1) FROM filings GROUP BY folder_id"
        )
    }
    outlet_years = defaultdict(lambda: [0, 0])
    years_by_outlet = defaultdict(set)
    folder_rows = []
    for (outlet_id, year, path), folder_id in folders.items():
        n, saved = counts[folder_id]
        totals = outlet_years[(outlet_id, year)]
        totals[0] += n
        totals[1] += saved
        years_by_outlet[outlet_id].add(year)
        label = path.rstrip("/").rsplit("/", 1)[-1].strip()
        folder_rows.append((folder_id, outlet_id, year, path, label, n, saved))
    db.executemany("INSERT INTO folders VALUES (?,?,?,?,?,?,?)", folder_rows)
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
    db.executescript(INDEXES)
    for year, first_id, last_id in year_ranges:
        table = f"filings_fts_{int(year)}"
        db.execute(FILING_WORDS.format(table=table))
        db.execute(
            FILL_WORDS.format(table=table, where="f.id BETWEEN ? AND ?"),
            (first_id, last_id),
        )
    db.execute(FILING_WORDS.format(table="originals_fts"))
    db.execute(FILL_WORDS.format(table="originals_fts", where="f.key_rank IS NOT NULL"))
    db.execute(
        "INSERT INTO folders_fts (rowid, label, station)"
        " SELECT d.id, d.label, o.name FROM folders d JOIN outlets o ON o.id = d.outlet_id"
    )
    db.execute(
        "INSERT INTO outlets_fts (rowid, name, ident, service, place)"
        " SELECT id, name, ident, service, coalesce(place, '') FROM outlets"
    )
    states = Counter(
        dict(db.execute("SELECT pdf, count(*) FROM filings GROUP BY pdf").fetchall())
    )
    latest_saved = db.execute(
        "SELECT max(saved_on) FROM filings WHERE pdf = 1 AND saved_on IS NOT NULL"
    ).fetchone()[0]
    meta = {
        "format": FORMAT,
        "snapshot_id": release.snapshot_id,
        "index_through": index_through,
        "filings": sum(states.values()),
        "saved": states[1],
        "unavailable": states[2],
        "unchecked": states[0],
        "saved_updated": saved_updated or latest_saved,
        "census_run": census_run,
        "built_at": datetime.now(UTC).isoformat(timespec="seconds"),
    }
    if inputs is not None:
        meta["inputs_sha256"] = inputs["digest"]
        meta["inputs"] = inputs
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


def _chunks(rows, size: int = 50000):
    chunk = []
    for row in rows:
        chunk.append(row)
        if len(chunk) >= size:
            yield chunk
            chunk = []
    if chunk:
        yield chunk


# ------------------------------------------------------------------ storage


def store():
    from alethical.db.session import load_dotenv_if_present
    from alethical.pipeline.raw_file_store import mirror_file_store_from_env

    load_dotenv_if_present()
    return mirror_file_store_from_env()


def _missing(error) -> bool:
    return error.response.get("Error", {}).get("Code") in ("NoSuchKey", "404")


JSON_LIMIT = 64 * 1024**2


def read_json(files, key: str):
    """A small JSON object, or None when it does not exist."""
    from botocore.exceptions import ClientError

    try:
        body = files._client.get_object(Bucket=files.bucket, Key=key)["Body"]
    except ClientError as error:
        if _missing(error):
            return None
        raise
    try:
        # Inventory manifests carry a per-day ledger and exceed 1 MiB; refuse only
        # an object far beyond any manifest so a bad key cannot exhaust memory.
        data = body.read(JSON_LIMIT + 1)
    finally:
        body.close()
    if len(data) > JSON_LIMIT:
        raise ValueError(f"{key} is larger than {JSON_LIMIT} bytes")
    return json.loads(data)


def inventory_manifest(files) -> dict | None:
    """The manifest ``current.json`` names, checked against the shared contract."""
    pointer = read_json(files, f"{INVENTORY}/current.json")
    if pointer is None:
        return None
    inventory_id = pointer["inventory_id"]
    if not re.fullmatch(r"inv-\d{12}", inventory_id) or pointer["manifest_key"] != (
        f"{INVENTORY}/manifests/{inventory_id}.json"
    ):
        raise ValueError("The inventory pointer names an unexpected manifest")
    manifest = read_json(files, pointer["manifest_key"])
    if manifest is None:
        raise ValueError("The inventory pointer names a missing manifest")
    sha = manifest["sha256"]
    if (
        manifest.get("format") != 1
        or manifest["inventory_id"] != inventory_id
        or not re.fullmatch(r"[a-f0-9]{64}", sha)
        or manifest["object_key"] != f"{INVENTORY}/sha256/{sha[:2]}/{sha}.jsonl.gz"
    ):
        raise ValueError("The inventory manifest does not match its pointer")
    return manifest | {"manifest_key": pointer["manifest_key"]}


# The archive index covers political files through this day; the compact inventory
# replaces it only once every FCC day up to it has been fetched.
ARCHIVE_THROUGH = "2026-11-16"


def inventory_complete(manifest: dict) -> bool:
    through = manifest.get("through")
    return (
        bool(through)
        and through >= ARCHIVE_THROUGH
        and not manifest.get("unverified_days")
    )


def fetch_inventory(files, inventory: dict, target: Path) -> Path:
    """Download the inventory data and refuse it unless its digest and size match."""
    body = files._client.get_object(Bucket=files.bucket, Key=inventory["object_key"])[
        "Body"
    ]
    digest, size = hashlib.sha256(), 0
    partial = target.with_name(target.name + ".part")
    with partial.open("wb") as out:
        try:
            while block := body.read(1 << 20):
                digest.update(block)
                size += len(block)
                out.write(block)
        finally:
            body.close()
    if digest.hexdigest() != inventory["sha256"] or size != inventory["bytes"]:
        partial.unlink()
        raise ValueError("The inventory failed its digest check")
    partial.replace(target)
    return target


def census_listing(files, census_run: str) -> list:
    """Key, size and ETag of every census object; any new outcome file changes it."""
    prefix, token, listing = f"{ROOT}/recovery/{census_run}/", None, []
    while True:
        kwargs = {"Bucket": files.bucket, "Prefix": prefix}
        if token:
            kwargs["ContinuationToken"] = token
        page = files._client.list_objects_v2(**kwargs)
        listing.extend(
            [o["Key"], o["Size"], o["ETag"].strip('"')]
            for o in page.get("Contents", [])
        )
        if not page.get("IsTruncated"):
            return sorted(listing)
        token = page["NextContinuationToken"]


def archive_identity(target: str):
    """The active archive release and the Minnesota document identities, read only."""
    from sqlalchemy import create_engine, text

    from alethical.db.session import NO_PREPARED_STATEMENTS, database_url_for_target

    engine = create_engine(
        database_url_for_target(target), connect_args=NO_PREPARED_STATEMENTS
    )
    with engine.connect() as conn:
        conn.execute(text("SET TRANSACTION READ ONLY"))
        snapshot = (
            conn.execute(
                text(
                    "SELECT snapshot_id, index_sha256, index_bytes, index_object_key,"
                    " index_stored_bytes, index_stored_sha256, created_at"
                    " FROM national_fcc_snapshot WHERE active"
                )
            )
            .mappings()
            .one()
        )
        minnesota = [
            (r.facility_id, r.file_id, r.saved_at.astimezone(UTC).date().isoformat())
            for r in _minnesota(conn, text)
        ]
    engine.dispose()
    return dict(snapshot), minnesota


def inputs_record(
    *,
    inventory: dict,
    census_run: str,
    census: list,
    archive_release: str,
    minnesota: list,
    index_through: str,
) -> dict:
    """Everything that determines the search file, and its SHA-256."""
    record = {
        "format": FORMAT,
        "inventory": inventory,
        "census": {
            "run": census_run,
            "objects": len(census),
            "listing_sha256": _sha(census),
        },
        "archive_release": archive_release,
        "minnesota_sha256": _sha(sorted(minnesota)),
        "index_through": index_through,
    }
    return record | {"digest": _sha(record)}


def _sha(value) -> str:
    return hashlib.sha256(
        json.dumps(value, sort_keys=True, separators=(",", ":")).encode()
    ).hexdigest()


def gather_inputs(
    target: str,
    files,
    *,
    census_run: str,
    index_through: str,
    source: str = "auto",
) -> dict:
    """Read the inputs' identities (small reads only) before restoring or building."""
    snapshot, minnesota = archive_identity(target)
    manifest = inventory_manifest(files) if source != "snapshot" else None
    if source == "inventory" and manifest is None:
        raise ValueError("No compact inventory is published")
    if source == "auto" and manifest is not None and not inventory_complete(manifest):
        # A backfill still in progress would drop filings the archive index holds.
        manifest = None
    if manifest is not None:
        inventory = {
            "kind": "inventory",
            "inventory_id": manifest["inventory_id"],
            "manifest_key": manifest["manifest_key"],
            "object_key": manifest["object_key"],
            "sha256": manifest["sha256"],
            "bytes": manifest["bytes"],
            "rows": manifest["rows"],
        }
        index_through = manifest["through"]
    else:
        inventory = {
            "kind": "snapshot",
            "snapshot_id": snapshot["snapshot_id"],
            "sha256": snapshot["index_sha256"],
            "bytes": snapshot["index_bytes"],
        }
    return inputs_record(
        inventory=inventory,
        census_run=census_run,
        census=census_listing(files, census_run),
        archive_release=snapshot["snapshot_id"],
        minnesota=minnesota,
        index_through=index_through,
    )


def inputs_key(release_id: str) -> str:
    return f"{PREFIX}/inputs/{release_id}.json"


def released_digest(files, release_id: str) -> str | None:
    record = read_json(files, inputs_key(release_id))
    return record and record.get("digest")


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


# ------------------------------------------------------------------ commands


def _built_inputs(args, files) -> dict:
    if args.inputs:
        return json.loads(args.inputs.read_text())
    return gather_inputs(
        args.target,
        files,
        census_run=args.census_run,
        index_through=args.index_through,
        source="inventory" if args.inventory_current else "snapshot",
    )


def cmd_build(args):
    files = store()
    inputs = _built_inputs(args, files)
    inventory = args.inventory
    if inputs["inventory"]["kind"] == "inventory":
        inventory = args.out.with_name(
            f"inventory-{inputs['inventory']['sha256']}.jsonl.gz"
        )
        if not inventory.exists():
            fetch_inventory(files, inputs["inventory"], inventory)
    elif inventory is None:
        raise ValueError("A snapshot build needs --inventory RECOVERED_INDEX")
    elif digest(inventory) != inputs["inventory"]["sha256"]:
        raise ValueError("That recovered index is not the active snapshot's")
    meta = build_with_inputs(
        args.target,
        inventory,
        args.census_export,
        args.out,
        inputs,
        saved_updated=args.saved_updated,
    )
    print(json.dumps(meta))


def build_with_inputs(
    target: str,
    inventory: Path,
    census: Path | None,
    out: Path,
    inputs: dict,
    saved_updated: str | None = None,
) -> dict:
    release, originals, minnesota = archive_rows(target)
    if release.snapshot_id != inputs["archive_release"]:
        raise ValueError("The active archive release changed; gather inputs again")
    return build(
        inventory,
        out,
        release=release,
        originals=originals,
        minnesota=minnesota,
        census=census or {},
        index_through=inputs["index_through"],
        saved_updated=saved_updated,
        census_run=inputs["census"]["run"],
        inputs=inputs,
        expected_rows=inputs["inventory"].get("rows"),
    )


def cmd_inputs(args):
    files = store()
    inputs = gather_inputs(
        args.target,
        files,
        census_run=args.census_run,
        index_through=args.index_through,
    )
    current = active_release(args.target)
    released = released_digest(files, current[0]) if current else None
    if args.out:
        args.out.write_text(json.dumps(inputs, indent=2))
    print(json.dumps(inputs | {"unchanged": released == inputs["digest"]}))


def cmd_publish(args):
    from botocore.exceptions import ClientError
    from sqlalchemy import create_engine, text

    from alethical.db.session import NO_PREPARED_STATEMENTS, database_url_for_target

    with closing(
        sqlite3.connect(args.database.resolve().as_uri() + "?mode=ro", uri=True)
    ) as db:
        meta = {k: json.loads(v) for k, v in db.execute("SELECT key, value FROM meta")}
        if db.execute("PRAGMA quick_check").fetchone()[0] != "ok":
            raise ValueError("The search file failed SQLite's quick check")
    # The inputs record becomes the release's sidecar, so a later scheduled release
    # can tell whether anything changed.
    inputs = getattr(args, "inputs", None) or meta.get("inputs")
    if inputs is not None and meta.get("inputs_sha256") != inputs["digest"]:
        raise ValueError("The search file was built from different inputs")
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
    if inputs is not None:
        record = json.dumps(inputs, sort_keys=True).encode()
        files._client.put_object(
            Bucket=files.bucket,
            Key=inputs_key(args.release_id),
            Body=record,
            ContentType="application/json",
            ChecksumSHA256=base64.b64encode(hashlib.sha256(record).digest()).decode(),
        )
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


def active_release(target: str):
    """The active release's ID and counts, or None."""
    from sqlalchemy import create_engine, text

    from alethical.db.session import NO_PREPARED_STATEMENTS, database_url_for_target

    engine = create_engine(
        database_url_for_target(target), connect_args=NO_PREPARED_STATEMENTS
    )
    with engine.connect() as conn:
        row = conn.execute(
            text(
                "SELECT release_id, saved, unavailable, unchecked"
                " FROM national_fcc_search_release WHERE active"
            )
        ).one_or_none()
    engine.dispose()
    return row


def prepare_release(target: str, files, inputs: dict, work: Path) -> Path:
    """Restore or download the inventory, export the census and build the file."""
    from scripts import national_fcc_collect, national_fcc_db

    work.mkdir(parents=True, exist_ok=True)
    if inputs["inventory"]["kind"] == "inventory":
        inventory = fetch_inventory(
            files, inputs["inventory"], work / "inventory.jsonl.gz"
        )
    else:
        inventory = work / "index.sqlite"
        if not inventory.exists():
            snapshot, _ = archive_identity(target)
            if snapshot["snapshot_id"] != inputs["inventory"]["snapshot_id"]:
                raise ValueError("The active archive release changed; try again")
            national_fcc_db.restore_index(snapshot, inventory, files)
    census = work / "census.jsonl.gz"
    national_fcc_collect.cmd_export(
        argparse.Namespace(run_id=inputs["census"]["run"], out=census)
    )
    database = work / "search.sqlite"
    print(
        json.dumps(build_with_inputs(target, inventory, census, database, inputs)),
        flush=True,
    )
    return database


def cmd_release(args):
    """Build, publish and activate a file only when its inputs changed."""
    files = store()
    inputs = gather_inputs(
        args.target,
        files,
        census_run=args.census_run,
        index_through=args.index_through,
    )
    current = active_release(args.target)
    if current is not None and released_digest(files, current[0]) == inputs["digest"]:
        print(json.dumps({"skipped": "inputs unchanged", "active": current[0]}))
        return
    database = prepare_release(args.target, files, inputs, args.work)
    release_id = "fcc-search-" + datetime.now(UTC).strftime("%Y%m%d%H%M")
    cmd_publish(
        argparse.Namespace(
            database=database,
            release_id=release_id,
            target=args.target,
            inputs=inputs,
        )
    )
    cmd_activate(
        argparse.Namespace(
            release=release_id,
            from_release=current[0] if current else "none",
            target=args.target,
        )
    )


def cli():
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("--target", default="production")
    sub = parser.add_subparsers(dest="command", required=True)

    def inputs_options(p):
        p.add_argument("--census-run", default="census-20261119")
        p.add_argument(
            "--index-through",
            default="2026-11-16",
            help="The recovered index's last day; a compact inventory states its own",
        )

    p = sub.add_parser("inputs", help="Show the next build's inputs and their digest")
    inputs_options(p)
    p.add_argument("--out", type=Path)
    p = sub.add_parser("build")
    source = p.add_mutually_exclusive_group(required=True)
    source.add_argument("--inventory", type=Path, help="A restored recovered index")
    source.add_argument(
        "--inventory-current",
        action="store_true",
        help="Read the compact inventory that current.json names",
    )
    inputs_options(p)
    p.add_argument("--inputs", type=Path, help="Inputs written by the inputs command")
    p.add_argument("--census-export", type=Path)
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
    p = sub.add_parser(
        "release", help="Build, publish and activate a file if its inputs changed"
    )
    inputs_options(p)
    p.add_argument("--work", type=Path, required=True, help="An empty work folder")
    return parser


def main():
    args = cli().parse_args()
    {
        "inputs": cmd_inputs,
        "build": cmd_build,
        "publish": cmd_publish,
        "activate": cmd_activate,
        "release": cmd_release,
    }[args.command](args)


if __name__ == "__main__":
    main()
