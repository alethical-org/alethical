from __future__ import annotations

import gzip
import hashlib
import io
import json
import sqlite3
from contextlib import closing
from datetime import UTC, datetime
from pathlib import Path
from types import SimpleNamespace

import pytest
from botocore.exceptions import ClientError

from alethical.api.services import finance_national_search as search
from scripts import national_fcc_search as builder

MANAGER = "0e069b78-34f1-2c57-5a3f-340160a7ea{:02d}"


def inventory(path: Path, rows) -> Path:
    db = sqlite3.connect(path)
    db.execute(
        "CREATE TABLE files (record_key TEXT PRIMARY KEY, file_id TEXT, service TEXT,"
        " entity_id TEXT, callsign TEXT, state TEXT, folder_path TEXT, file_name TEXT,"
        " history_status TEXT, source_bytes INTEGER, file_manager_id TEXT, source_json TEXT)"
    )
    for n, (service, entity, folder, name, created, extra) in enumerate(rows):
        file_id = f"file-{n}"
        source = {
            "file_id": file_id,
            "file_extension": "pdf",
            "create_ts": created,
            "callsign": extra.get("callsign"),
            "city": extra.get("city"),
            "state": extra.get("state"),
            "licensee": extra.get("licensee"),
            "legalname": extra.get("legalname"),
            "file_manager_id": MANAGER.format(n),
        }
        db.execute(
            "INSERT INTO files VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
            (
                f"{service}|{entity}|{file_id}",
                file_id,
                service,
                entity,
                extra.get("callsign"),
                extra.get("state"),
                folder,
                name,
                "new",
                1000,
                MANAGER.format(n),
                json.dumps(source),
            ),
        )
    db.commit()
    db.close()
    return path


ROWS = [
    # 0: held in the archive release
    (
        "TV",
        "64611",
        "Political Files/2026/State/Adams for Senate",
        "Adams order 1",
        "2026-10-01T10:00:00-04:00",
        {"callsign": "WRAZ", "city": "RALEIGH", "state": "NC"},
    ),
    # 1: saved by the census
    (
        "CABLE",
        "007255",
        "Political Files/2026/Federal/Citizens Fund",
        "11749175_Invoice",
        "2026-11-16T10:03:40-05:00",
        {"legalname": "SPECTRUM SOUTHEAST, LLC"},
    ),
    # 2: confirmed unavailable
    (
        "FM",
        "30191",
        "Political Files/2026/Federal/US Senate",
        "WBVX contract",
        "2026-11-12T12:15:23-05:00",
        {"callsign": "WBVX", "city": "Lexington", "state": "KY"},
    ),
    # 3: never checked
    (
        "AM",
        "1914",
        "Political Files/2024/State",
        "Bucki for Supreme Court",
        "2024-11-11T10:20:13-05:00",
        {"callsign": "WECK", "city": "Buffalo", "state": "NY"},
    ),
    # 4: a Minnesota station copy
    (
        "TV",
        "23079",
        "Political Files/2026/Federal/US Senate/Klobuchar",
        "Klobuchar invoice",
        "2026-10-08T22:13:17-04:00",
        {"callsign": "KARE", "city": "Minneapolis", "state": "MN"},
    ),
]


SHA_A, SHA_B = "a" * 64, "b" * 64
RELEASE = SimpleNamespace(
    snapshot_id="fcc-national-20261116",
    created_at=datetime(2026, 11, 17, 21, 0, tzinfo=UTC),
)
ORIGINALS = {
    "TV|64611|file-0": SimpleNamespace(
        content_hash=SHA_A,
        byte_size=10,
        page_count=2,
        text_object_key=f"fcc-national/v1/text/sha256/cc/{'c' * 64}.json",
    )
}
MINNESOTA = {
    "TV|23079|file-4": SimpleNamespace(saved_at=datetime(2026, 10, 9, 12, tzinfo=UTC))
}
CENSUS = {
    "CABLE|007255|file-1": {
        "state": "saved",
        "sha": SHA_B,
        "b": 20,
        "p": 3,
        "t": int(datetime(2026, 11, 20, tzinfo=UTC).timestamp()),
    },
    "FM|30191|file-2": {
        "state": "unavailable",
        "why": "missing",
        "t": int(datetime(2026, 11, 20, tzinfo=UTC).timestamp()),
    },
    "AM|1914|file-3": {"state": "pending"},
}


def build_ready(source: Path, out: Path, **kw) -> search.Ready:
    meta = builder.build(
        source,
        out,
        release=RELEASE,
        originals=ORIGINALS,
        minnesota=MINNESOTA,
        census=CENSUS,
        index_through="2026-11-16",
        **kw,
    )
    assert (meta["filings"], meta["saved"], meta["unavailable"], meta["unchecked"]) == (
        5,
        3,
        1,
        1,
    )
    return search.Ready("r1", out, search._meta(out))


@pytest.fixture
def ready(tmp_path: Path) -> search.Ready:
    source = inventory(tmp_path / "inventory.sqlite", ROWS)
    return build_ready(source, tmp_path / "search.sqlite")


def by_key(answer):
    return {row["key"]: row for row in answer["rows"]}


def test_every_filing_is_listed_with_its_own_pdf_state(ready):
    answer = search.filings(
        ready, q="", year=2026, doctype="all", pdf_only=False, sort="date", page=1
    )
    rows = by_key(answer)
    assert answer["total"] == 4
    assert [r["key"] for r in answer["rows"]][:2] == [
        "CABLE|007255|file-1",
        "FM|30191|file-2",
    ]
    assert rows["TV|64611|file-0"]["pdf"] == "saved"
    assert rows["CABLE|007255|file-1"]["pdf"] == "saved"
    assert rows["FM|30191|file-2"]["pdf"] == "unavailable"
    assert rows["TV|23079|file-4"]["minnesota_key"] == "kare-file-4"
    assert answer["about"] == {
        "filings": 5,
        "index_through": "2026-11-16",
        "saved": 3,
        "saved_updated": "2026-11-20",
        "complete": False,
    }
    older = search.filings(
        ready, q="", year=2024, doctype="all", pdf_only=False, sort="date", page=1
    )
    # A pending check is never reported as unavailable.
    assert [(r["key"], r["pdf"]) for r in older["rows"]] == [
        ("AM|1914|file-3", "unchecked")
    ]


def test_search_filters_and_sort_combine(ready):
    def keys(**kw):
        base = dict(q="", year=2026, doctype="all", pdf_only=False, sort="date", page=1)
        return [r["key"] for r in search.filings(ready, **(base | kw))["rows"]]

    assert keys(q="spectrum") == ["CABLE|007255|file-1"]
    assert keys(q="sen") == ["FM|30191|file-2", "TV|23079|file-4", "TV|64611|file-0"]
    assert keys(q="file-4") == ["TV|23079|file-4"]
    assert keys(doctype="orders") == ["FM|30191|file-2", "TV|64611|file-0"]
    assert keys(pdf_only=True, q="senate") == ["TV|23079|file-4", "TV|64611|file-0"]
    assert keys(sort="name")[0] == "CABLE|007255|file-1"
    assert keys(q="!!!") == keys()


def test_stations_and_folders_count_filings_and_saved_pdfs(ready):
    outlets = by_key(search.outlets(ready, q="", year=2026, page=1))
    cable = next(r for r in outlets.values() if r["service"] == "Cable")
    assert (cable["name"], cable["ident"], cable["filings"], cable["with_pdf"]) == (
        "SPECTRUM SOUTHEAST, LLC",
        "Cable system ID 007255",
        1,
        1,
    )
    wraz = next(r for r in outlets.values() if r["name"] == "WRAZ")
    assert wraz["place"] == "Raleigh, NC"
    kare = next(r for r in outlets.values() if r["name"] == "KARE")
    assert kare["minnesota_station"] == "23079"
    folders = search.advertisers(ready, q="klobuchar", year=2026, page=1)
    assert [(r["label"], r["filings"], r["with_pdf"]) for r in folders["rows"]] == [
        ("Klobuchar", 1, 1)
    ]


def test_details_and_saved_originals_name_only_verified_bytes(ready):
    detail = search.filing(ready, "CABLE|007255|file-1")
    assert detail["saved_on"] == "2026-11-20"
    assert (
        detail["source_url"]
        == f"https://files.fcc.gov/download/{MANAGER.format(1)}.pdf"
    )
    unavailable = search.filing(ready, "FM|30191|file-2")
    assert (
        unavailable["pdf"],
        unavailable["saved_on"],
        unavailable["content_hash"],
    ) == ("unavailable", None, None)
    record = search.original_record(ready, "TV|64611|file-0")
    assert record["object_key"].endswith("/" + "a" * 64 + ".pdf")
    assert record["text_object_key"]
    for key in ("FM|30191|file-2", "AM|1914|file-3", "TV|23079|file-4", "missing"):
        with pytest.raises(LookupError):
            search.original_record(ready, key)
    with pytest.raises(LookupError):
        search.filing(ready, "missing")
    saved = search.saved_national(ready, "", 1, False)
    assert [r["record_key"] for r in saved["rows"]] == [
        "CABLE|007255|file-1",
        "TV|64611|file-0",
    ]


def test_search_words_cannot_inject_query_syntax():
    assert search.match_expression('NEAR(" a) OR *') == '"NEAR"* AND "a"* AND "OR"*'
    assert search.match_expression("  ") is None


def test_national_list_stays_readable_while_a_search_file_loads(monkeypatch):
    from sqlalchemy.orm import Session

    from alethical.api.problems import problem_exception
    from alethical.api.services import finance_national_files as national
    from alethical.db.session import get_engine

    def loading(db):
        raise problem_exception(503, "Search is starting", "Filings are loading.")

    monkeypatch.setattr(search.FILES, "current", loading)
    with Session(get_engine()) as db:
        answer = national.browse(db, "", 1, None)
    assert answer["tab"] == "national"
    assert answer["total"] == 0


def test_packed_search_file_is_reproducible_and_unpacks_exactly(tmp_path):
    import gzip as gz

    database = tmp_path / "search.sqlite"
    database.write_bytes(b"SQLite format 3\x00" + bytes(range(256)) * 50)
    first = builder.pack(database).read_bytes()
    second = builder.pack(database).read_bytes()
    assert first == second
    assert gz.decompress(first) == database.read_bytes()


FORMAT1_ANSWERS = (
    Path(__file__).parent / "fixtures" / ("national_fcc_search_format1_answers.json")
)


def call(ready, fn, args):
    try:
        if fn == "saved_national":
            return search.saved_national(
                ready, args["q"], args["page"], args["preview"]
            )
        if fn in ("filing", "original_record"):
            return getattr(search, fn)(ready, args["key"])
        return getattr(search, fn)(ready, **args)
    except LookupError as error:
        return {"lookup_error": str(error)}


def test_format_2_answers_match_the_format_1_file_exactly(ready):
    # Recorded from the format 1 builder and reader for the same fixture: every
    # key, field, order, total and record key string must stay the same.
    expected = json.loads(FORMAT1_ANSWERS.read_text())
    assert len(expected) > 150
    for case in expected:
        answer = json.loads(json.dumps(call(ready, case["call"], case["args"])))
        assert answer == case["answer"], (case["call"], case["args"])


def test_typed_words_that_start_the_folder_prefix_match_every_filing_of_the_year():
    assert search.filing_terms("Political FILES 2026 sen") == (["sen"], ["2026"])
    assert search.filing_expression("pol 20 sen", 2026) == '"sen"*'
    assert (
        search.filing_expression("2024 o’brien", 2026)
        == '"o"* AND "brien"* AND "2024"*'
    )
    assert search.filing_expression("files", 2026) is None


def test_file_and_download_ids_are_stored_as_16_bytes_and_read_back_as_written():
    uuid = "c0373c3d-3e5d-0c8e-6bf5-0c627e333ca8"
    assert builder.compact(uuid) == bytes.fromhex(uuid.replace("-", ""))
    assert search._text(builder.compact(uuid)) == uuid
    assert builder.compact("File-ABC") == "File-ABC"
    upper = uuid.upper()
    assert builder.compact(upper) == upper


# ------------------------------------------------------------------ inventory


def compact_inventory(rows) -> bytes:
    """The fixture rows in the shared compact inventory format, sorted by key."""
    lines = []
    for n, (service, entity, folder, name, created, extra) in enumerate(rows):
        file_id = f"file-{n}"
        row = {
            "k": f"{service}|{entity}|{file_id}",
            "s": service,
            "e": entity,
            "f": file_id,
            "m": MANAGER.format(n),
            "n": name,
            "x": "pdf",
            "p": folder,
            "c": created,
            "h": "new",
            "cs": extra.get("callsign"),
            "ci": extra.get("city"),
            "st": extra.get("state"),
            "li": extra.get("licensee"),
            "lg": extra.get("legalname"),
        }
        lines.append(json.dumps({k: v for k, v in row.items() if v is not None}))
    lines.sort(key=lambda line: json.loads(line)["k"])
    return gzip.compress(("\n".join(lines) + "\n").encode(), mtime=0)


class FakeStore:
    """Enough of the R2 client for the inventory, census listing and sidecars."""

    bucket = "test"

    def __init__(self, objects: dict[str, bytes]):
        self.objects = dict(objects)
        self.etags: dict[str, str] = {}
        self.puts: list[str] = []
        self._client = self

    def get_object(self, Bucket, Key):
        if Key not in self.objects:
            raise ClientError({"Error": {"Code": "NoSuchKey"}}, "GetObject")
        return {"Body": io.BytesIO(self.objects[Key])}

    def put_object(self, Bucket, Key, Body, **kw):
        self.puts.append(Key)
        self.objects[Key] = Body if isinstance(Body, bytes) else Body.read()

    def list_objects_v2(self, Bucket, Prefix, **kw):
        return {
            "Contents": [
                {
                    "Key": k,
                    "Size": len(v),
                    "ETag": self.etags.get(k, hashlib.md5(v).hexdigest()),
                }
                for k, v in sorted(self.objects.items())
                if k.startswith(Prefix)
            ],
            "IsTruncated": False,
        }


def published_inventory(data: bytes, rows: int = len(ROWS)) -> dict[str, bytes]:
    sha = hashlib.sha256(data).hexdigest()
    root = "fcc-national/v1/inventory"
    manifest = {
        "format": 1,
        "inventory_id": "inv-202611191200",
        "object_key": f"{root}/sha256/{sha[:2]}/{sha}.jsonl.gz",
        "sha256": sha,
        "bytes": len(data),
        "rows": rows,
        "through": "2026-11-18",
        "windows": {},
        "sources": [],
        "parent": None,
        "built_at": "2026-11-19T12:00:00+00:00",
    }
    return {
        f"{root}/current.json": json.dumps(
            {
                "inventory_id": "inv-202611191200",
                "manifest_key": f"{root}/manifests/inv-202611191200.json",
            }
        ).encode(),
        f"{root}/manifests/inv-202611191200.json": json.dumps(manifest).encode(),
        manifest["object_key"]: data,
    }


def test_compact_inventory_maps_to_the_same_filings_as_the_recovered_index(
    ready, tmp_path
):
    files = FakeStore(published_inventory(compact_inventory(ROWS)))
    manifest = builder.inventory_manifest(files)
    assert (manifest["rows"], manifest["through"]) == (5, "2026-11-18")
    data = builder.fetch_inventory(files, manifest, tmp_path / "inventory.jsonl.gz")
    other = build_ready(
        data, tmp_path / "from-inventory.sqlite", expected_rows=manifest["rows"]
    )

    def unkeyed(answer):
        # Station and folder numbers follow source order, which differs.
        return [r | {"key": None} for r in answer["rows"]], answer["total"]

    for case in json.loads(FORMAT1_ANSWERS.read_text()):
        mine = call(other, case["call"], case["args"])
        theirs = call(ready, case["call"], case["args"])
        if case["call"] in ("outlets", "advertisers"):
            assert unkeyed(mine) == unkeyed(theirs)
        else:
            assert mine == theirs, (case["call"], case["args"])


def test_an_inventory_that_fails_its_digest_is_refused(tmp_path):
    objects = published_inventory(compact_inventory(ROWS))
    manifest_key = next(k for k in objects if "/manifests/" in k)
    data_key = json.loads(objects[manifest_key])["object_key"]
    data = objects[data_key]
    objects[data_key] = data[:20] + bytes([data[20] ^ 1]) + data[21:]
    files = FakeStore(objects)
    with pytest.raises(ValueError, match="digest"):
        builder.fetch_inventory(
            files, builder.inventory_manifest(files), tmp_path / "inventory.jsonl.gz"
        )
    assert list(tmp_path.iterdir()) == []

    # A row count that disagrees with the manifest is refused too.
    short = tmp_path / "short.jsonl.gz"
    short.write_bytes(compact_inventory(ROWS[:4]))
    with pytest.raises(ValueError, match="rows"):
        list(builder.inventory_rows(short, expected_rows=5))


def test_no_inventory_pointer_means_the_recovered_index():
    assert builder.inventory_manifest(FakeStore({})) is None


# ------------------------------------------------------------------ releases


def inputs_for(files, **changes):
    record = dict(
        inventory={"kind": "snapshot", "snapshot_id": "s1", "sha256": "0" * 64},
        census_run="census-20261119",
        census=builder.census_listing(files, "census-20261119"),
        archive_release="s1",
        minnesota=[("23079", "file-4", "2026-10-09")],
        index_through="2026-11-16",
    )
    return builder.inputs_record(**(record | changes))


def test_inputs_digest_changes_with_any_census_object_even_at_equal_counts():
    results = "fcc-national/v1/recovery/census-20261119/results/"
    files = FakeStore({results + "a-00001.jsonl.gz": b"one"})
    first = inputs_for(files)["digest"]
    assert inputs_for(files)["digest"] == first
    # A corrected outcome file of the same size changes only its ETag.
    files.etags[results + "a-00001.jsonl.gz"] = "corrected"
    assert inputs_for(files)["digest"] != first
    files.etags.clear()
    files.objects[results + "a-00002.jsonl.gz"] = b"two"
    assert inputs_for(files)["digest"] != first
    del files.objects[results + "a-00002.jsonl.gz"]
    assert inputs_for(files, archive_release="s2")["digest"] != first
    assert inputs_for(files, minnesota=[])["digest"] != first
    assert inputs_for(files, index_through="2026-11-17")["digest"] != first


def release_harness(monkeypatch, files, inputs, active, released):
    calls = []
    monkeypatch.setattr(builder, "store", lambda: files)
    monkeypatch.setattr(builder, "gather_inputs", lambda *a, **kw: inputs)
    monkeypatch.setattr(builder, "active_release", lambda t: active)
    monkeypatch.setattr(builder, "released_digest", lambda f, r: released)
    monkeypatch.setattr(
        builder,
        "prepare_release",
        lambda *a: calls.append(("build", a)) or Path("search.sqlite"),
    )
    monkeypatch.setattr(builder, "cmd_publish", lambda a: calls.append(("publish", a)))
    monkeypatch.setattr(
        builder, "cmd_activate", lambda a: calls.append(("activate", a))
    )
    return calls


def release_args(tmp_path):
    import argparse

    return argparse.Namespace(
        target="production",
        census_run="census-20261119",
        index_through="2026-11-16",
        work=tmp_path / "work",
    )


def test_release_skips_restore_build_and_upload_when_inputs_are_unchanged(
    monkeypatch, tmp_path, capsys
):
    files = FakeStore({})
    inputs = inputs_for(files)
    calls = release_harness(
        monkeypatch, files, inputs, ("r1", 3, 1, 1), inputs["digest"]
    )
    builder.cmd_release(release_args(tmp_path))
    assert calls == [] and files.puts == []
    assert "inputs unchanged" in capsys.readouterr().out
    assert not (tmp_path / "work").exists()


def test_release_publishes_changed_inputs_even_when_the_counts_are_equal(
    monkeypatch, tmp_path
):
    files = FakeStore({})
    inputs = inputs_for(files)
    # Same saved, unavailable and unchecked totals as the active release.
    calls = release_harness(monkeypatch, files, inputs, ("r1", 3, 1, 1), "older")
    builder.cmd_release(release_args(tmp_path))
    (_, built), (_, published), (_, activated) = calls
    assert built[2] is inputs
    assert published.inputs is inputs
    assert published.release_id == activated.release
    assert published.release_id.startswith("fcc-search-")
    assert activated.from_release == "r1"


def test_the_first_release_has_no_active_release_to_compare(monkeypatch, tmp_path):
    files = FakeStore({})
    inputs = inputs_for(files)
    calls = release_harness(monkeypatch, files, inputs, None, None)
    builder.cmd_release(release_args(tmp_path))
    assert [c[0] for c in calls] == ["build", "publish", "activate"]
    assert calls[2][1].from_release == "none"


def test_a_release_sidecar_records_its_inputs_digest():
    files = FakeStore({})
    assert builder.released_digest(files, "fcc-search-1") is None
    files.objects[builder.inputs_key("fcc-search-1")] = json.dumps(
        {"digest": "abc"}
    ).encode()
    assert builder.released_digest(files, "fcc-search-1") == "abc"


def test_a_built_file_records_its_inputs_digest(tmp_path):
    source = inventory(tmp_path / "inventory.sqlite", ROWS)
    inputs = inputs_for(FakeStore({}))
    out = build_ready(source, tmp_path / "search.sqlite", inputs=inputs)
    assert out.meta["inputs_sha256"] == inputs["digest"]
    assert out.meta["format"] == search.FORMAT == builder.FORMAT


# ------------------------------------------------------------------ release cache


class FakeDatabase:
    def __init__(self, release_id):
        self.release_id = release_id
        self.reads = 0

    def release(self):
        return SimpleNamespace(
            release_id=self.release_id,
            object_key=f"fcc-national/v1/search/sha256/aa/{'a' * 64}.sqlite.gz",
            sqlite_sha256="a" * 64,
            stored_sha256="b" * 64,
        )

    def execute(self, statement):
        self.reads += 1
        row = self.release()
        return SimpleNamespace(one_or_none=lambda: row)


def no_threads(monkeypatch, started):
    monkeypatch.setattr(search, "_member_store", lambda db: "store")
    monkeypatch.setattr(
        search.threading,
        "Thread",
        lambda target, args, daemon: SimpleNamespace(
            start=lambda: started.append(args[0].release_id)
        ),
    )


def test_the_active_release_is_read_at_most_every_30_seconds(monkeypatch, tmp_path):
    now = [1000.0]
    files = search.SearchFiles(tmp_path, clock=lambda: now[0])
    files.ready = search.Ready("r1", tmp_path / "r1.sqlite", {})
    started = []
    no_threads(monkeypatch, started)
    db = FakeDatabase("r1")
    assert files.current(db).release_id == "r1"
    assert files.current(db).release_id == "r1"
    assert db.reads == 1

    db.release_id = "r2"  # activated elsewhere
    now[0] += 29
    assert files.current(db).release_id == "r1" and db.reads == 1
    now[0] += 2
    # After 30 seconds the new release is read and starts loading; the previous
    # copy keeps serving until the new one is ready.
    assert files.current(db).release_id == "r1"
    assert db.reads == 2 and started == ["r2"]


def test_a_new_server_answers_loading_until_the_copy_is_ready(monkeypatch, tmp_path):
    from fastapi import HTTPException

    files = search.SearchFiles(tmp_path, clock=lambda: 0.0)
    started = []
    no_threads(monkeypatch, started)
    with pytest.raises(HTTPException) as raised:
        files.current(FakeDatabase("r1"))
    assert raised.value.status_code == 503 and started == ["r1"]


def test_a_search_file_in_another_format_is_never_served(tmp_path):
    staged = tmp_path / "old.sqlite"
    with closing(sqlite3.connect(staged)) as db:
        db.execute("CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)")
        db.execute("INSERT INTO meta VALUES ('format', '1')")
        db.commit()
    release = FakeDatabase("r1").release()
    release.sqlite_sha256 = search._digest(staged)
    staged.rename(tmp_path / f"{release.sqlite_sha256}.sqlite")
    files = search.SearchFiles(tmp_path)
    files.loading = "r1"
    files._load(release, store=None)
    assert files.ready is None and files.failed == "ValueError"
