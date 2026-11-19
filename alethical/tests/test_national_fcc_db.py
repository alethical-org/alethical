import gzip
import hashlib
import json
import sqlite3
from contextlib import closing
from uuid import uuid4

import pytest
from sqlalchemy import func, select, text

from alethical.db.session import get_engine
from scripts import national_fcc_db as importer
from scripts.national_fcc_db_renew import renewal_sample


def transfer(root):
    uid, manager = str(uuid4()), str(uuid4())
    key = "CABLE|001|" + uid
    source = dict(
        source_service_code="CABLE",
        entity_id="001",
        file_id=uid,
        file_manager_id=manager,
        legalname="Cable Co",
        file_name="Order",
        file_folder_path="Political Files/2024/State",
    )
    meta = dict(
        record_key=key,
        source=source,
        download_url=f"https://files.fcc.gov/download/{manager}.pdf",
        status="downloaded",
        pages=1,
    )
    index = root / "index.sqlite"
    with closing(sqlite3.connect(index)) as db:
        db.execute("create table files(record_key text primary key)")
        db.executemany("insert into files values (?)", [(key,), ("only in archive",)])
        db.commit()
    catalog = root / "catalog.sqlite"
    with closing(sqlite3.connect(catalog)) as db:
        db.execute(
            "create table documents(record_key text primary key,status text,metadata_json text)"
        )
        db.executemany(
            "insert into documents values (?,?,?)",
            [(key, "downloaded", json.dumps(meta)), ("only in archive", "error", "{}")],
        )
        db.commit()
    packed = gzip.compress(index.read_bytes())
    ih = hashlib.sha256(packed).hexdigest()
    receipt = dict(
        snapshot_id="test-archive",
        index_rows=2,
        index_bytes=index.stat().st_size,
        index_sha256=importer.file_hash(index),
        index_stored_sha256=ih,
        index_stored_bytes=len(packed),
        index_object_key=importer.content_key("research", ih, "sqlite.gz"),
        support_object_key=importer.content_key("research", "b" * 64, "zip"),
        originals=[
            dict(
                record_key=key,
                object_key=importer.content_key("originals", "c" * 64, "pdf"),
                sha256="c" * 64,
                byte_size=42,
            )
        ],
    )
    receipt["source_manifest_object_key"] = importer.manifest_key(receipt)
    return receipt, catalog, index, packed


def test_only_successful_originals_activate_atomically_and_retry_without_writes(
    tmp_path,
):
    receipt, catalog, index, _ = transfer(tmp_path)
    snapshot, rows = importer.prepare(receipt, catalog, index)
    (row,) = rows
    assert (row["entity_id"], row["station_name"], row["file_year"]) == (
        "001",
        "Cable Co",
        2024,
    )
    with get_engine().connect() as db, db.begin() as tx:
        importer.stage(db, snapshot, rows)
        importer.stage(db, snapshot, rows)
        assert db.scalar(select(func.count()).select_from(importer.ORIGINAL)) == 1
        assert db.scalar(select(importer.SNAPSHOT.c.active)) is False
        with pytest.raises(ValueError, match="different transfer"):
            importer.stage(db, dict(snapshot, import_sha256="d" * 64), rows)
        with pytest.raises(ValueError, match="changed"):
            importer.activate(db, snapshot["snapshot_id"], "stale")
        importer.activate(db, snapshot["snapshot_id"], None)
        importer.activate(db, snapshot["snapshot_id"], None)
        assert db.scalar(select(importer.SNAPSHOT.c.active)) is True
        importer.activate(db, None, snapshot["snapshot_id"])
        assert db.scalar(select(importer.SNAPSHOT.c.active)) is False
        assert (
            db.scalar(
                text(
                    "select count(*) from pg_class where relname in ('national_fcc_snapshot','national_fcc_original') and relrowsecurity"
                )
            )
            == 2
        )
        tx.rollback()


def test_renewal_reads_only_active_files_unless_bootstrapping(tmp_path):
    receipt, catalog, index, _ = transfer(tmp_path)
    original = receipt["originals"][0]
    original["text_object_key"] = importer.content_key("text", "d" * 64, "json")
    receipt["source_manifest_object_key"] = importer.manifest_key(receipt)
    snapshot, rows = importer.prepare(receipt, catalog, index)
    expected = (
        original["object_key"],
        original["text_object_key"],
        receipt["index_object_key"],
        None,  # no active search release to probe
    )
    with get_engine().connect() as db, db.begin() as tx:
        assert renewal_sample(db, False) is None
        with pytest.raises(ValueError, match="No verified snapshot staged"):
            renewal_sample(db, True)
        importer.stage(db, snapshot, rows)
        assert renewal_sample(db, False) is None
        assert renewal_sample(db, True) == expected
        importer.activate(db, snapshot["snapshot_id"], None)
        assert renewal_sample(db, False) == expected
        importer.activate(db, None, snapshot["snapshot_id"])
        assert renewal_sample(db, False) is None
        tx.rollback()


def test_missing_or_misdirected_receipt_rejected(tmp_path):
    receipt, catalog, index, _ = transfer(tmp_path)
    with pytest.raises(ValueError, match="final receipt"):
        importer.prepare(receipt, catalog, index, require_verified=True)
    receipt["originals"][0]["record_key"] = "wrong"
    with pytest.raises(ValueError, match="source manifest"):
        importer.prepare(receipt, catalog, index)
    receipt["source_manifest_object_key"] = importer.manifest_key(receipt)
    with pytest.raises(ValueError, match="Missing storage"):
        importer.prepare(receipt, catalog, index)
    receipt["index_object_key"] = "private/unrelated"
    with pytest.raises(ValueError, match="object key"):
        importer.prepare(receipt, catalog, index)


def test_restore_verifies_bytes_before_exposing_sqlite(tmp_path):
    receipt, _, index, packed = transfer(tmp_path)
    destination = tmp_path / "research.sqlite"

    class Store:
        def get(self, key, path, *, max_bytes):
            from pathlib import Path

            assert key == receipt["index_object_key"] and max_bytes == len(packed)
            Path(path).write_bytes(packed)

    with pytest.raises(ValueError, match="Restored index"):
        importer.restore_index(
            dict(receipt, index_sha256="0" * 64), destination, Store()
        )
    assert not destination.exists()
    importer.restore_index(receipt, destination, Store())
    assert importer.file_hash(destination) == importer.file_hash(index)
    with pytest.raises(FileExistsError):
        importer.restore_index(receipt, destination, Store())
