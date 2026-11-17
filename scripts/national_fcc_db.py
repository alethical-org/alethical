"""Register a verified national FCC transfer and restore its private research index.

Run from the repo root with python -m scripts.national_fcc_db. The import
defaults to validation only. Stage and activate are separate, retryable steps;
the former cannot change the member view. Rolling back activation keeps every
snapshot, file version and object.
"""

from __future__ import annotations

import argparse
import gzip
import hashlib
import itertools
import json
import os
import re
import sqlite3
import tempfile
from contextlib import closing
from pathlib import Path
from uuid import UUID

from sqlalchemy import create_engine, func, insert, select, text, update
from sqlalchemy.engine import make_url

from alethical.db.models import Base, NationalFCCOriginal, NationalFCCSnapshot
from alethical.db.session import NO_PREPARED_STATEMENTS, database_url_for_target
from alethical.pipeline.raw_file_store import mirror_file_store_from_env

SNAPSHOT = Base.metadata.tables[NationalFCCSnapshot.__tablename__]
ORIGINAL = Base.metadata.tables[NationalFCCOriginal.__tablename__]
PREFIX = "fcc-national/v1/"
SHA = r"[0-9a-f]{64}"
YEAR = re.compile(r"^Political Files/(\d{4})(?:/|$)", re.IGNORECASE)
DIGEST_FIELDS = (
    "snapshot_id",
    "index_object_key",
    "index_sha256",
    "index_bytes",
    "index_rows",
    "index_stored_sha256",
    "index_stored_bytes",
    "source_manifest_object_key",
)


def file_hash(path: Path) -> str:
    with path.open("rb") as handle:
        return hashlib.file_digest(handle, "sha256").hexdigest()


def content_key(kind: str, digest: str, suffix: str) -> str:
    if not re.fullmatch(SHA, digest):
        raise ValueError("Invalid content hash in the storage receipt")
    return f"{PREFIX}{kind}/sha256/{digest[:2]}/{digest}.{suffix}"


def validate_object_key(value: str, kind: str, suffix: str) -> None:
    digest = value.rsplit("/", 1)[-1].partition(".")[0]
    if value != content_key(kind, digest, suffix):
        raise ValueError(f"Invalid {kind} object key in the storage receipt")


def manifest_key(receipt: dict) -> str:
    body = {
        k: v
        for k, v in receipt.items()
        if k not in {"source_manifest_object_key", "storage_verified"}
    }
    encoded = json.dumps(body, ensure_ascii=False, separators=(",", ":")).encode()
    return content_key("research", hashlib.sha256(encoded).hexdigest(), "json")


def prepare(
    receipt: dict, catalog: Path, index: Path, *, require_verified=False
) -> tuple[dict, list[dict]]:
    if require_verified and receipt.get("storage_verified") is not True:
        raise ValueError(
            "Stage requires the final receipt from completed storage verification"
        )
    snapshot = {field: receipt[field] for field in DIGEST_FIELDS}
    if not re.fullmatch(r"[a-z0-9][a-z0-9-]{0,99}", snapshot["snapshot_id"]):
        raise ValueError("Invalid snapshot ID")
    if (
        index.stat().st_size != snapshot["index_bytes"]
        or file_hash(index) != snapshot["index_sha256"]
    ):
        raise ValueError("The recovered private index differs from the storage receipt")
    if snapshot["index_rows"] <= 0 or snapshot["index_stored_bytes"] <= 0:
        raise ValueError("The private research index must be nonempty")
    if snapshot["index_object_key"] != content_key(
        "research", snapshot["index_stored_sha256"], "sqlite.gz"
    ):
        raise ValueError("The private index object key differs from the receipt hash")
    if snapshot["source_manifest_object_key"] != manifest_key(receipt):
        raise ValueError("Storage receipt does not match its source manifest")
    validate_object_key(receipt["support_object_key"], "research", "zip")
    proofs = {entry["record_key"]: entry for entry in receipt["originals"]}
    if not proofs or len(proofs) != len(receipt["originals"]):
        raise ValueError("Missing or duplicate file identities in the storage receipt")
    rows = []
    with closing(
        sqlite3.connect(catalog.resolve().as_uri() + "?mode=ro", uri=True)
    ) as db:
        db.execute(
            "ATTACH DATABASE ? AS inventory", (index.resolve().as_uri() + "?mode=ro",)
        )
        if (
            db.execute("SELECT count(*) FROM inventory.files").fetchone()[0]
            != snapshot["index_rows"]
        ):
            raise ValueError(
                "The registered index row count differs from the recovered index"
            )
        records = db.execute("""
            SELECT d.record_key, d.metadata_json, f.record_key
            FROM documents d LEFT JOIN inventory.files f ON f.record_key = d.record_key
            WHERE d.status = 'downloaded' ORDER BY d.record_key
        """)
        for key, metadata, inventory_key in records:
            proof = proofs.pop(key, None)
            if not proof or not inventory_key:
                raise ValueError(
                    f"Missing storage receipt or inventory record for {key}"
                )
            meta = json.loads(metadata)
            source = meta["source"]
            service, entity, fid = (
                source["source_service_code"],
                source["entity_id"],
                source["file_id"],
            )
            if (
                key != f"{service}|{entity}|{fid}"
                or meta["record_key"] != key
                or meta["status"] != "downloaded"
            ):
                raise ValueError(f"Source identity or status mismatch for {key}")
            if (
                proof["object_key"] != content_key("originals", proof["sha256"], "pdf")
                or proof["byte_size"] <= 0
            ):
                raise ValueError(f"Invalid original reference for {key}")
            if proof.get("text_object_key"):
                validate_object_key(proof["text_object_key"], "text", "json")
            source_url = meta["download_url"]
            manager_id = str(UUID(source["file_manager_id"]))
            if source_url != f"https://files.fcc.gov/download/{manager_id}.pdf":
                raise ValueError(f"Unexpected FCC original address for {key}")
            folder = source["file_folder_path"]
            file_year = YEAR.match(folder)
            rows.append(
                dict(
                    snapshot_id=snapshot["snapshot_id"],
                    record_key=key,
                    service=service,
                    entity_id=entity,
                    file_id=fid,
                    call_sign=source.get("callsign"),
                    station_name=source.get("callsign")
                    or source.get("legalname")
                    or source.get("licensee")
                    or f"{service} {entity}",
                    state=source.get("state"),
                    title=source["file_name"],
                    folder_path=folder,
                    file_year=int(file_year[1]) if file_year else None,
                    source_url=source_url,
                    content_hash=proof["sha256"],
                    byte_size=proof["byte_size"],
                    object_key=proof["object_key"],
                    text_object_key=proof.get("text_object_key"),
                    page_count=meta.get("pages"),
                )
            )
    if proofs:
        raise ValueError(
            "Storage receipt contains files outside the successful downloads"
        )
    digest = hashlib.sha256()
    for obj in (snapshot, *rows):
        digest.update(
            json.dumps(obj, sort_keys=True, separators=(",", ":")).encode() + b"\n"
        )
    snapshot.update(import_sha256=digest.hexdigest(), original_count=len(rows))
    return snapshot, rows


def lock(db) -> None:
    # The empty first release has no pointer row to lock yet.
    db.execute(text("SELECT pg_advisory_xact_lock(1497468900, 48210934)"))


def stage(db, snapshot, rows) -> None:
    lock(db)
    existing = db.scalar(
        select(SNAPSHOT.c.import_sha256).where(
            SNAPSHOT.c.snapshot_id == snapshot["snapshot_id"]
        )
    )
    if existing is None:
        db.execute(insert(SNAPSHOT).values(**snapshot))
        for batch in itertools.batched(rows, 500):
            db.execute(insert(ORIGINAL).values(list(batch)))
    elif existing != snapshot["import_sha256"]:
        raise ValueError("This snapshot identity already names a different transfer")
    check_count(db, snapshot["snapshot_id"], snapshot["original_count"])


def check_count(db, key, expected):
    actual = db.scalar(
        select(func.count()).select_from(ORIGINAL).where(ORIGINAL.c.snapshot_id == key)
    )
    if actual != expected or not actual:
        raise ValueError("Import is incomplete")


def activate(db, destination: str | None, expected_active: str | None) -> None:
    lock(db)
    active = db.scalar(select(SNAPSHOT.c.snapshot_id).where(SNAPSHOT.c.active))
    if destination:
        count = db.scalar(
            select(SNAPSHOT.c.original_count).where(
                SNAPSHOT.c.snapshot_id == destination
            )
        )
        if count is None:
            raise ValueError("The requested snapshot has not been staged")
        check_count(db, destination, count)
    if active == destination:
        return
    if active != expected_active:
        raise ValueError(
            "The active snapshot changed; inspect status before switching it"
        )
    if active:
        db.execute(
            update(SNAPSHOT)
            .where(SNAPSHOT.c.snapshot_id == active)
            .values(active=False)
        )
    if destination:
        db.execute(
            update(SNAPSHOT)
            .where(SNAPSHOT.c.snapshot_id == destination)
            .values(active=True)
        )


def restore_index(snapshot, destination: Path, store) -> None:
    if destination.exists():
        raise FileExistsError(destination)
    with tempfile.TemporaryDirectory(dir=destination.parent) as temporary:
        packed = Path(temporary) / "index.gz"
        restored = Path(temporary) / "index.sqlite"
        store.get(
            snapshot["index_object_key"],
            str(packed),
            max_bytes=snapshot["index_stored_bytes"],
        )
        if (
            packed.stat().st_size != snapshot["index_stored_bytes"]
            or file_hash(packed) != snapshot["index_stored_sha256"]
        ):
            raise ValueError("Stored index failed verification")
        restored.touch(mode=0o600)
        with gzip.open(packed, "rb") as source, restored.open("wb") as target:
            while chunk := source.read(1024 * 1024):
                if target.tell() + len(chunk) > snapshot["index_bytes"]:
                    raise ValueError("Unpacked index exceeds its registered size")
                target.write(chunk)
        if (
            restored.stat().st_size != snapshot["index_bytes"]
            or file_hash(restored) != snapshot["index_sha256"]
        ):
            raise ValueError("Restored index failed verification")
        os.link(
            restored, destination
        )  # Publish only complete bytes; never overwrite another file.


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--target", choices=("local", "production"), default="local")
    subs = parser.add_subparsers(dest="command", required=True)
    for command in ("validate", "stage"):
        p = subs.add_parser(command)
        for name in ("receipt", "catalog", "index"):
            p.add_argument(f"--{name}", required=True, type=Path)
    p = subs.add_parser("activate")
    p.add_argument(
        "--snapshot", required=True, help="Snapshot ID, or 'none' to withdraw"
    )
    p.add_argument(
        "--from-snapshot",
        required=True,
        help="Expected current ID, or 'none' on first release",
    )
    p = subs.add_parser("restore-index")
    p.add_argument("--snapshot", required=True)
    p.add_argument("--destination", required=True, type=Path)
    subs.add_parser("status")
    args = parser.parse_args()
    prepared = None
    if args.command in {"validate", "stage"}:
        prepared = prepare(
            json.loads(args.receipt.read_text()),
            args.catalog,
            args.index,
            require_verified=args.command == "stage",
        )
        print(json.dumps(prepared[0]), flush=True)
        if args.command == "validate":
            return
    url = make_url(database_url_for_target(args.target, None))
    if args.target == "local" and url.host not in {
        "localhost",
        "127.0.0.1",
        "::1",
        "db",
    }:
        raise ValueError("A remote database requires --target production")
    engine = create_engine(url, connect_args=NO_PREPARED_STATEMENTS)
    with engine.begin() as db:
        if args.command == "stage" and prepared is not None:
            stage(db, *prepared)
        elif args.command == "activate":
            activate(
                db,
                None if args.snapshot == "none" else args.snapshot,
                None if args.from_snapshot == "none" else args.from_snapshot,
            )
        elif args.command == "status":
            print(
                json.dumps(
                    [dict(r) for r in db.execute(select(SNAPSHOT)).mappings()],
                    default=str,
                )
            )
        elif args.command == "restore-index":
            row = (
                db.execute(
                    select(SNAPSHOT).where(SNAPSHOT.c.snapshot_id == args.snapshot)
                )
                .mappings()
                .one()
            )
    if args.command == "restore-index":
        restore_index(row, args.destination, mirror_file_store_from_env())


if __name__ == "__main__":
    main()
