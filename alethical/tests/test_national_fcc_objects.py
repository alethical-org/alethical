from __future__ import annotations

import hashlib
import io
import json

import pytest
from botocore.exceptions import ClientError

from scripts.national_fcc_objects import page_text, verify_or_upload


def test_member_text_prefers_corrected_scan_and_only_exposes_pages():
    rendered = page_text(
        {
            "source": {"name": "Hidden transfer path"},
            "path": "/private/files",
            "page_text": [
                {"page": 1, "text": "", "ocr_text": "Read from scan", "internal": 1},
                {"page": 2, "text": "Embedded"},
                {"page": 3, "text": ""},
            ],
        }
    )
    assert json.loads(rendered) == {
        "pages": [
            {"page": 1, "text": "Read from scan", "method": "ocr"},
            {"page": 2, "text": "Embedded", "method": "embedded"},
            {"page": 3, "text": "", "method": "unreadable"},
        ]
    }
    assert page_text({"page_text": [{"page": 1, "text": ""}]}) is None


class OccupiedStorage:
    def __init__(self, body):
        self.body = body
        self.put_count = 0

    def put_object(self, **kwargs):
        self.put_count += 1
        assert kwargs["IfNoneMatch"] == "*"
        raise ClientError(
            {
                "ResponseMetadata": {"HTTPStatusCode": 412},
                "Error": {"Code": "PreconditionFailed"},
            },
            "PutObject",
        )

    def get_object(self, **kwargs):
        return {"Body": io.BytesIO(self.body)}


def test_concurrent_upload_cannot_replace_prior_object(tmp_path):
    body = b"original bytes"
    path = tmp_path / (hashlib.sha256(body).hexdigest() + ".pdf")
    path.write_bytes(body)
    occupied = OccupiedStorage(body)
    verify_or_upload(occupied, "private", path, path.name, set())
    assert occupied.put_count == 1
    occupied.body = b"other content!"
    with pytest.raises(ValueError, match="Stored bytes failed verification"):
        verify_or_upload(occupied, "private", path, path.name, {path.name})
    assert occupied.put_count == 1


def test_stage_keeps_source_history_private_and_deduplicates_originals(tmp_path):
    import sqlite3
    import zipfile
    from argparse import Namespace
    from contextlib import closing

    from pypdf import PdfWriter

    from scripts.national_fcc_objects import stage

    db_paths = {
        n: tmp_path / f"{n}.sqlite" for n in ("index", "download_log", "ocr_log")
    }
    with closing(sqlite3.connect(db_paths["index"])) as db:
        db.execute("CREATE TABLE files(record_key text)")
        db.executemany(
            "INSERT INTO files values (?)",
            [(x,) for x in ("TV|1|abc", "TV|2|def", "TV|3|ghi")],
        )
        db.commit()
    with closing(sqlite3.connect(db_paths["ocr_log"])) as db:
        db.execute(
            "CREATE TABLE ocr_documents(record_key text,document_json_zlib blob)"
        )
    with closing(sqlite3.connect(db_paths["download_log"])) as db:
        db.execute(
            "CREATE TABLE documents(record_key text,metadata_json text,status text)"
        )
        db.executemany(
            "INSERT INTO documents values (?, '{}', ?)",
            [
                ("TV|1|abc", "downloaded"),
                ("TV|2|def", "downloaded"),
                ("TV|3|ghi", "error"),
            ],
        )
        db.commit()
    original = io.BytesIO()
    writer = PdfWriter()
    writer.add_blank_page(width=40, height=40)
    writer.write(original)
    archive = tmp_path / "part.zip"
    with zipfile.ZipFile(archive, "w") as z:
        for station, name in [("1", "abc"), ("2", "def"), ("3", "ghi")]:
            key = f"TV|{station}|{name}"
            z.writestr(
                f"Archive/national-fcc/opif/source-documents/TV/{station}/{name}.pdf",
                original.getvalue(),
            )
            z.writestr(
                f"Archive/national-fcc/opif/document-text/TV/{station}/{name}.json",
                json.dumps(
                    {
                        "record_key": key,
                        "path": "/research/input",
                        "page_text": [{"page": 1, "text": "Read text"}],
                    }
                ),
            )
    out = tmp_path / "stage"
    stage(
        Namespace(**db_paths, stage=out, snapshot="test-snapshot", archives=[archive])
    )
    m = json.loads((out / "manifest.json").read_bytes())
    assert m["index_rows"] == 3
    assert {r["record_key"] for r in m["originals"]} == {"TV|1|abc", "TV|2|def"}
    assert len({r["object_key"] for r in m["originals"]}) == 1
    assert (out / m["originals"][0]["object_key"]).read_bytes() == original.getvalue()
    assert json.loads((out / m["originals"][0]["text_object_key"]).read_bytes()) == {
        "pages": [{"page": 1, "text": "Read text", "method": "embedded"}]
    }
    assert "storage_verified" not in m
