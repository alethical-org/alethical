#!/usr/bin/env python3
"""Stage a national FCC transfer, then copy immutable objects to private R2.

The local stage takes the Drive ZIPs, the transaction-recovered inventory and the
transfer's download/OCR ledgers. Only successfully collected PDFs and their page
text enter the member manifest. All other source material stays in research.
"""

from __future__ import annotations

import argparse
import base64
import gzip
import hashlib
import io
import json
import re
import os
import shutil
import sqlite3
import sys
import zipfile
import zlib
from concurrent.futures import ThreadPoolExecutor
from contextlib import closing
from itertools import batched
from pathlib import Path, PurePosixPath

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

PREFIX = "fcc-national/v1"
CHUNK = 2**20


def digest(path):
    with path.open("rb") as stream:
        return hashlib.file_digest(stream, "sha256").hexdigest()


def encode(value):
    return json.dumps(value, ensure_ascii=False, separators=(",", ":")).encode()


def object_key(group, sha, suffix):
    return f"{PREFIX}/{group}/sha256/{sha[:2]}/{sha}.{suffix}"


def page_text(document):
    pages = []
    for page in document["page_text"]:
        embedded = (page.get("text") or "").strip()
        ocr = (page.get("ocr_text") or "").strip()
        # Prefer the whole-page transcription on scanned/mixed pages. Preserve
        # both source readings privately in the transfer's research bundle.
        value = ocr or embedded
        pages.append(
            {
                "page": page["page"],
                "text": value,
                "method": "ocr" if ocr else "embedded" if embedded else "unreadable",
            }
        )
    if not any(p["text"] for p in pages):
        return None
    payload = encode({"pages": pages})
    if len(payload) > 4 * 1024**2:
        raise ValueError("Text exceeds the Finance reader limit")
    return payload


def staged_bytes(root, group, content, suffix):
    sha = hashlib.sha256(content).hexdigest()
    key = object_key(group, sha, suffix)
    target = root / key
    if not target.exists():
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(content)
    return key, sha


def staged_file(root, tmp, suffix):
    sha = digest(tmp)
    key = object_key("research", sha, suffix)
    target = root / key
    target.parent.mkdir(parents=True, exist_ok=True)
    tmp.replace(target)
    return key, sha, target.stat().st_size


def open_db(path):
    return sqlite3.connect(path.resolve().as_uri() + "?mode=ro", uri=True)


def write_support(archive, key, stream):
    p = PurePosixPath(key)
    if p.is_absolute() or ".." in p.parts:
        raise ValueError("Unsafe support member path")
    if key not in archive.NameToInfo:
        with archive.open(key, "w", force_zip64=True) as dst:
            shutil.copyfileobj(stream, dst, CHUNK)


def stage(args):
    root = args.stage
    root.mkdir(parents=True, exist_ok=True, mode=0o700)
    records = {}
    with closing(open_db(args.download_log)) as db:
        for key, meta in db.execute(
            "SELECT record_key,metadata_json FROM documents WHERE status='downloaded'"
        ):
            records[key] = json.loads(meta)
    with closing(open_db(args.ocr_log)) as db:
        ocr = {
            key: json.loads(zlib.decompress(data))
            for key, data in db.execute(
                "SELECT record_key,document_json_zlib FROM ocr_documents"
            )
        }
    members = {}
    texts = {}
    support_file = root / "support.partial"
    with zipfile.ZipFile(
        support_file, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=1
    ) as support:

        def visit(z, name, prefix, leaf):
            # Drive emits Finder metadata alongside the files it archives.
            if any(p.startswith("._") for p in PurePosixPath(name).parts):
                return
            if len(leaf.split("/")) != 3:
                raise ValueError("Unexpected FCC document path")
            service, entity, filename = leaf.split("/")
            key = "|".join((service, entity, filename.split(".")[0]))
            if key not in records or ".partial" in filename:
                with z.open(name) as stream:
                    write_support(support, f"source-exceptions/{prefix}/{leaf}", stream)
            elif prefix == "document-text":
                payload = z.read(name)
                document = json.loads(payload)
                if document["record_key"] != key:
                    raise ValueError("Text record identity mismatch")
                text_bytes = page_text(ocr.get(key, document))
                text_key = (
                    staged_bytes(root, "text", text_bytes, "json")[0]
                    if text_bytes
                    else None
                )
                if key in texts and texts[key] != text_key:
                    raise ValueError("Conflicting text for one record")
                texts[key] = text_key
                write_support(support, f"document-text/{leaf}", io.BytesIO(payload))
            else:
                from pypdf import PdfReader

                pdf = z.read(name)
                obj, sha = staged_bytes(root, "originals", pdf, "pdf")
                if key in members and sha != members[key]["sha256"]:
                    raise ValueError(
                        "Distinct downloaded bodies under one FCC identity"
                    )
                if key not in members:
                    reader = PdfReader(io.BytesIO(pdf))
                    if reader.is_encrypted:
                        reader.decrypt("")
                    if len(reader.pages) < 1:
                        raise ValueError("Document has no readable pages")
                members[key] = dict(
                    record_key=key, object_key=obj, sha256=sha, byte_size=len(pdf)
                )

        for archive in sorted(args.archives):
            with zipfile.ZipFile(archive) as z:
                for name in z.namelist():
                    if name.endswith("/") or any(
                        p.startswith("._") for p in name.split("/")
                    ):
                        continue
                    short = name.partition("/")[2]
                    if "/source-archives/" in short:
                        with zipfile.ZipFile(io.BytesIO(z.read(name))) as inner:
                            for leaf in inner.namelist():
                                if not leaf.endswith("/"):
                                    visit(
                                        inner,
                                        leaf,
                                        "document-text"
                                        if leaf.endswith(".json")
                                        else "source-documents",
                                        leaf,
                                    )
                    elif "/source-documents/" in short or "/document-text/" in short:
                        prefix = (
                            "source-documents"
                            if "/source-documents/" in short
                            else "document-text"
                        )
                        visit(z, name, prefix, short.split(f"/{prefix}/")[1])
                    else:
                        with z.open(name) as stream:
                            write_support(support, short, stream)
    if members.keys() != records.keys() or texts.keys() != records.keys():
        raise ValueError("Missing document or page-text records")
    for key, rec in members.items():
        rec["text_object_key"] = texts[key]
    support_key, _, _ = staged_file(root, support_file, "zip")
    with closing(open_db(args.index)) as db:
        if db.execute("PRAGMA quick_check").fetchone() != ("ok",):
            raise ValueError("Unhealthy research index")
        count = db.execute("SELECT count(*) FROM files").fetchone()[0]
    compressed = root / "inventory.partial"
    with args.index.open("rb") as src, compressed.open("wb") as dst:
        with gzip.GzipFile(
            filename="", fileobj=dst, mode="wb", compresslevel=2, mtime=0
        ) as out:
            shutil.copyfileobj(src, out, CHUNK)
    index_key, sha, size = staged_file(root, compressed, "sqlite.gz")
    manifest = dict(
        snapshot_id=args.snapshot,
        index_rows=count,
        index_bytes=args.index.stat().st_size,
        index_sha256=digest(args.index),
        index_object_key=index_key,
        index_stored_bytes=size,
        index_stored_sha256=sha,
        support_object_key=support_key,
        originals=sorted(members.values(), key=lambda x: x["record_key"]),
    )
    manifest_key, _ = staged_bytes(root, "research", encode(manifest), "json")
    manifest["source_manifest_object_key"] = manifest_key
    (root / "manifest.json").write_bytes(encode(manifest))
    print(
        f"Staged {len(members):,} original identities and {count:,} index entries",
        flush=True,
    )


def verify_or_upload(client, bucket, path, key, existing):
    """Condition every write on absence. Verify even previously stored keys."""
    from botocore.exceptions import ClientError

    sha = path.name.split(".")[0]
    if digest(path) != sha:
        raise ValueError("Staged data does not match its object key")
    if key not in existing:
        md5 = hashlib.md5(usedforsecurity=False)
        with path.open("rb") as body:
            while chunk := body.read(CHUNK):
                md5.update(chunk)
            body.seek(0)
            try:
                client.put_object(
                    Bucket=bucket,
                    Key=key,
                    Body=body,
                    IfNoneMatch="*",
                    ContentMD5=base64.b64encode(md5.digest()).decode(),
                    ContentType={
                        "pdf": "application/pdf",
                        "json": "application/json",
                        "gz": "application/gzip",
                        "zip": "application/zip",
                    }[key.rsplit(".", 1)[1]],
                    Metadata={"sha256": sha},
                )
            except ClientError as exc:
                if exc.response["ResponseMetadata"]["HTTPStatusCode"] != 412:
                    raise
    response = client.get_object(Bucket=bucket, Key=key)
    with closing(response["Body"]) as stored:
        actual = hashlib.sha256()
        while block := stored.read(CHUNK):
            actual.update(block)
    if actual.hexdigest() != sha:
        raise ValueError(f"Stored bytes failed verification: {key}")


def upload(args):
    from alethical.db.session import load_dotenv_if_present
    from alethical.pipeline.raw_file_store import mirror_file_store_from_env

    load_dotenv_if_present()
    store = mirror_file_store_from_env()
    manifest = json.loads((args.stage / "manifest.json").read_bytes())
    keys = {
        manifest[k]
        for k in (
            "index_object_key",
            "source_manifest_object_key",
            "support_object_key",
        )
    }
    for rec in manifest["originals"]:
        keys.add(rec["object_key"])
        if rec["text_object_key"]:
            keys.add(rec["text_object_key"])
    source_manifest = dict(manifest)
    manifest_key = source_manifest.pop("source_manifest_object_key")
    if manifest_key != object_key(
        "research", hashlib.sha256(encode(source_manifest)).hexdigest(), "json"
    ):
        raise ValueError("The staged manifest differs from its content address")
    for key in keys:
        if not re.fullmatch(
            r"fcc-national/v1/(?:research|originals|text)/sha256/[0-9a-f]{2}/[0-9a-f]{64}\.(?:pdf|json|zip|sqlite\.gz)",
            key,
        ):
            raise ValueError("Unexpected object key")
    existing = {
        obj["Key"]
        for page in store._client.get_paginator("list_objects_v2").paginate(
            Bucket=store.bucket, Prefix=PREFIX + "/"
        )
        for obj in page.get("Contents", [])
    }

    def put(key):
        verify_or_upload(store._client, store.bucket, args.stage / key, key, existing)

    # Verify one small upload through the complete path before moving the
    # archive. A failed wave leaves only immutable, unreferenced objects.
    probe = min(keys, key=lambda k: (args.stage / k).stat().st_size)
    put(probe)
    done = 1
    with ThreadPoolExecutor(max_workers=args.workers) as pool:
        for batch in batched(sorted(keys - {probe}), 256):
            list(pool.map(put, batch))
            done += len(batch)
            print(f"Verified {done:,} / {len(keys):,} objects", flush=True)
    manifest["storage_verified"] = True
    tmp = args.receipt.with_suffix(".partial")
    tmp.write_bytes(encode(manifest))
    tmp.replace(args.receipt)
    print(f"Verified {len(keys):,} stored objects", flush=True)


def main():
    os.umask(0o077)
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)
    p = commands.add_parser("stage")
    for flag in ("stage", "index", "download-log", "ocr-log"):
        p.add_argument("--" + flag, required=True, type=Path)
    p.add_argument("--snapshot", required=True)
    p.add_argument("archives", nargs="+", type=Path)
    u = commands.add_parser("upload")
    u.add_argument("--stage", required=True, type=Path)
    u.add_argument("--receipt", required=True, type=Path)
    u.add_argument("--workers", type=int, choices=range(1, 33), default=12)
    u.add_argument("--target", required=True, choices=["private-r2"])
    args = parser.parse_args()
    (stage if args.command == "stage" else upload)(args)


if __name__ == "__main__":
    main()
