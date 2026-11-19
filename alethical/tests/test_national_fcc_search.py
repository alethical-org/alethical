from __future__ import annotations

import json
import sqlite3
from datetime import UTC, datetime
from pathlib import Path
from types import SimpleNamespace

import pytest

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


@pytest.fixture
def ready(tmp_path: Path) -> search.Ready:
    source = inventory(tmp_path / "inventory.sqlite", ROWS)
    sha_a, sha_b = "a" * 64, "b" * 64
    meta = builder.build(
        source,
        tmp_path / "search.sqlite",
        release=SimpleNamespace(
            snapshot_id="fcc-national-20261116",
            created_at=datetime(2026, 11, 17, 21, 0, tzinfo=UTC),
        ),
        originals={
            "TV|64611|file-0": SimpleNamespace(
                content_hash=sha_a,
                byte_size=10,
                page_count=2,
                text_object_key=f"fcc-national/v1/text/sha256/cc/{'c' * 64}.json",
            )
        },
        minnesota={
            "TV|23079|file-4": SimpleNamespace(
                saved_at=datetime(2026, 10, 9, 12, tzinfo=UTC)
            )
        },
        census={
            "CABLE|007255|file-1": {
                "state": "saved",
                "sha": sha_b,
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
        },
        index_through="2026-11-16",
    )
    assert (meta["filings"], meta["saved"], meta["unavailable"], meta["unchecked"]) == (
        5,
        3,
        1,
        1,
    )
    path = tmp_path / "search.sqlite"
    return search.Ready("r1", path, search._meta(path))


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
