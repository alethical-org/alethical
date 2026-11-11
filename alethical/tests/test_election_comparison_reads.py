"""Published result versions, literal search and retained source evidence over HTTP."""

# ruff: noqa: F811
from __future__ import annotations

import gzip
import hashlib
from datetime import UTC, date, datetime
from pathlib import Path

import pytest

from alethical.api.services import election_comparison_reads as reads
from alethical.db import models as m
from alethical.tests.finance_fixtures import finance_api, finance_db  # noqa: F401

KEY = "mn-2026-11-03-general"
BASE = f"/api/v1/finance/elections/{KEY}"
SNAPSHOT = "a" * 64
RACE = "b" * 64
ORIGINAL_RACE = "election:201:jurisdiction:88:office:0335"
WHEN = datetime(2026, 11, 11, tzinfo=UTC)
BODY = "MN;José;7\r\nMN;Other;0\r\n".encode("windows-1252")
SOURCE = hashlib.sha256(BODY).hexdigest()


def _snapshot(
    db, snapshot_id=SNAPSHOT, *, published=True, body=BODY, filename="returns.txt"
):
    source_hash = hashlib.sha256(body).hexdigest()
    compressed = gzip.compress(body, mtime=0)
    if db.get(m.ElectionResultSource, source_hash) is None:
        db.add(
            m.ElectionResultSource(
                content_hash=source_hash,
                object_key=f"elections/returns/{source_hash}.gz",
                byte_size=len(body),
                compressed_hash=hashlib.sha256(compressed).hexdigest(),
                compressed_byte_size=len(compressed),
                compression="gzip",
            )
        )
    row = m.ElectionComparisonSnapshot(
        id=snapshot_id,
        election_key=KEY,
        election_date=date(2026, 11, 3),
        stage="general",
        fetched_at=WHEN,
        first_published_at=WHEN if published else None,
        sources=[
            {
                "file": filename,
                "url": "https://electionresultsfiles.sos.mn.gov/20261103/returns.txt",
                "sha256": source_hash,
                "bytes": len(body),
                "fetched_at": WHEN.isoformat(),
                "private_path": "/not-for-reader",
            }
        ],
        coverage={
            "races": 2,
            "reconciled_races": 2,
            "county_names": {"01": "Aitkin", "02": "Anoka"},
            "excluded_rows": [{"raw_row": "question source row"}],
            "excluded_summary_rows": [],
            "comparison_checks": {
                "precinct_voter_bound": {
                    "status": "discrepancies",
                    "discrepancy_count": 2,
                    "unchecked_race_ids": [],
                    "discrepancies": [
                        {
                            "race_id": ORIGINAL_RACE,
                            "office_id": "0335",
                            "county_id": "01",
                            "precinct_id": "0001",
                            "office_votes": 7,
                            "total_voted": 6,
                        },
                        {
                            "race_id": "another-race",
                            "office_id": "9999",
                            "county_id": "02",
                            "precinct_id": "0002",
                            "office_votes": 12,
                            "total_voted": 10,
                        },
                    ],
                },
                "independent_canvass_validation": {"status": "not_performed"},
            },
        },
    )
    db.add(row)
    db.flush()
    return row


def _race(db, snapshot_id=SNAPSHOT, *, race_id=RACE, label="Attorney General", vote=7):
    row = m.ElectionComparisonRace(
        snapshot_id=snapshot_id,
        id=race_id,
        label=label,
        office_id="0335",
        jurisdiction="88",
        result_status="unofficial",
        payload={
            "race_id": ORIGINAL_RACE,
            "district": "",
            "source_sha256": SOURCE,
            "coverage": {"reconciled": True, "errors": []},
            "candidates": [
                {
                    "name": "José Example",
                    "candidate_id": "a",
                    "votes": vote,
                    "outcome": None,
                    "is_write_in_aggregate": False,
                },
                {
                    "name": "Another Candidate",
                    "candidate_id": "b",
                    "votes": None,
                    "outcome": None,
                    "is_write_in_aggregate": False,
                },
                {
                    "name": "WRITE-IN",
                    "candidate_id": "w",
                    "votes": 0,
                    "outcome": None,
                    "is_write_in_aggregate": True,
                },
            ],
        },
    )
    db.add(row)
    db.flush()
    return row


def _current(db, snapshot_id=SNAPSHOT):
    current = db.get(m.ElectionComparisonCurrent, KEY)
    if current is None:
        db.add(m.ElectionComparisonCurrent(election_key=KEY, snapshot_id=snapshot_id))
    else:
        current.snapshot_id = snapshot_id
    db.flush()


def _precinct(db, *, key="01:0001", name="Precinct 100%", snapshot_id=SNAPSHOT, vote=7):
    db.add(
        m.ElectionComparisonPrecinct(
            snapshot_id=snapshot_id,
            race_id=RACE,
            key=key,
            name=name,
            county=key.split(":")[0],
            payload={
                "source_sha256": SOURCE,
                "rows": [
                    {"row_number": 1, "votes": vote, "candidate_name": "José Example"}
                ],
            },
        )
    )
    db.flush()


@pytest.fixture()
def published(finance_db):
    _snapshot(finance_db)
    _race(finance_db)
    _current(finance_db)
    _precinct(finance_db)
    _precinct(finance_db, key="02:0002", name="Another precinct")
    finance_db.commit()


def test_reader_sees_every_candidate_and_source_status(finance_api, published):
    response = finance_api.get(f"{BASE}/races/{RACE}")
    assert response.status_code == 200
    assert "private" in response.headers["cache-control"]
    data = response.json()["data"]
    assert data["snapshot_id"] == SNAPSHOT
    assert data["race"]["result_status"] == "unofficial"
    assert [c["votes"] for c in data["race"]["candidates"]] == [7, None, 0]
    assert all(c["outcome"] is None for c in data["race"]["candidates"])
    assert data["race"]["candidates"][2]["is_write_in_aggregate"]
    assert "private_path" not in data["sources"][0]
    assert "excluded_rows" not in data["coverage"]
    assert data["coverage"]["excluded_rows_count"] == 1
    assert (
        "discrepancies"
        not in data["coverage"]["comparison_checks"]["precinct_voter_bound"]
    )
    assert len(data["race"]["diagnostics"]) == 1


def test_staged_snapshot_is_not_visible_even_if_its_id_is_known(
    finance_api, finance_db
):
    draft = "c" * 64
    _snapshot(finance_db, draft, published=False)
    _race(finance_db, draft)
    # A bad pointer does not turn staging into publication.
    _current(finance_db, draft)
    finance_db.commit()
    assert (
        finance_api.get("/api/v1/finance/elections").json()["data"]["elections"] == []
    )
    for path in (f"{BASE}/races", f"{BASE}/races/{RACE}", f"{BASE}/sources/{SOURCE}"):
        response = finance_api.get(path, params={"snapshot_id": draft})
        assert response.status_code == 404
    assert finance_api.get(f"{BASE}/races").status_code == 404


def test_prior_published_snapshot_keeps_pages_and_votes_after_refresh(
    finance_api, finance_db, published
):
    first = finance_api.get(f"{BASE}/races", params={"limit": 1}).json()["data"]
    newer = "d" * 64
    _snapshot(finance_db, newer)
    _race(finance_db, newer, vote=9)
    _precinct(finance_db, snapshot_id=newer, vote=9)
    _current(finance_db, newer)
    finance_db.commit()
    assert (
        finance_api.get(f"{BASE}/races/{RACE}").json()["data"]["race"]["candidates"][0][
            "votes"
        ]
        == 9
    )
    old = finance_api.get(
        f"{BASE}/races/{RACE}/precincts",
        params={"snapshot_id": first["snapshot_id"], "limit": 1, "offset": 1},
    )
    assert old.status_code == 200
    data = old.json()["data"]
    assert data["snapshot_id"] == SNAPSHOT and data["page"]["total"] == 2
    assert data["precincts"][0]["key"] == "02:0002"
    assert data["precincts"][0]["rows"][0]["votes"] == 7
    assert finance_api.get(f"{BASE}/races/{RACE}/precincts").status_code == 422


def test_search_is_literal_and_candidate_search_preserves_race(
    finance_api, finance_db, published
):
    _race(finance_db, race_id="e" * 64, label="District 50%")
    finance_db.commit()
    result = finance_api.get(f"{BASE}/races", params={"q": "%"}).json()["data"]
    assert result["page"]["total"] == 1
    assert result["races"][0]["label"] == "District 50%"
    assert (
        finance_api.get(f"{BASE}/races", params={"q": "missing"}).json()["data"][
            "races"
        ]
        == []
    )
    assert (
        finance_api.get(f"{BASE}/races", params={"q": "José"}).json()["data"]["page"][
            "total"
        ]
        == 2
    )
    assert (
        finance_api.get(f"{BASE}/races", params={"q": "_"}).json()["data"]["races"]
        == []
    )


def test_precinct_filters_and_notes_stay_scoped(finance_api, published):
    response = finance_api.get(
        f"{BASE}/races/{RACE}/precincts",
        params={"snapshot_id": SNAPSHOT, "q": "%", "county": "01"},
    )
    data = response.json()["data"]
    assert data["page"]["total"] == 1
    assert data["precincts"][0]["county_name"] == "Aitkin"
    assert len(data["precincts"][0]["diagnostics"]) == 1
    other = finance_api.get(
        f"{BASE}/races/{RACE}/precincts",
        params={"snapshot_id": SNAPSHOT, "county": "02"},
    ).json()["data"]
    assert other["precincts"][0]["diagnostics"] == []


def test_name_search_never_matches_json_punctuation(finance_api, published):
    for query in ('"', "[", "]"):
        data = finance_api.get(f"{BASE}/races", params={"q": query}).json()["data"]
        assert data["races"] == []


class _Store:
    def __init__(self, body=BODY):
        self.body = gzip.compress(body, mtime=0)

    def get(self, key, destination, *, max_bytes):
        assert key.startswith("elections/returns/")
        assert len(self.body) <= max_bytes
        Path(destination).write_bytes(self.body)


def test_original_bytes_and_line_numbers_are_exact(finance_api, published, monkeypatch):
    monkeypatch.setattr(reads, "raw_file_store_from_env", lambda: _Store())
    response = finance_api.get(
        f"{BASE}/sources/{SOURCE}", params={"snapshot_id": SNAPSHOT}
    )
    assert response.status_code == 200 and response.content == BODY
    assert response.headers["content-type"] == "application/octet-stream"
    assert response.headers["content-disposition"].startswith("attachment;")
    assert response.headers["x-content-type-options"] == "nosniff"
    lines = finance_api.get(
        f"{BASE}/sources/{SOURCE}/lines",
        params={"snapshot_id": SNAPSHOT, "start": 2, "limit": 1},
    ).json()["data"]
    assert lines["lines"] == [{"number": 2, "text": "MN;Other;0"}]
    assert lines["page"]["total"] == 2
    assert (
        finance_api.get(
            f"{BASE}/sources/{SOURCE}/lines", params={"snapshot_id": SNAPSHOT}
        ).json()["data"]["lines"][0]["text"]
        == "MN;José;7"
    )


def test_unrelated_source_and_wrong_election_never_reach_store(
    finance_api, published, monkeypatch
):
    def forbidden():
        raise AssertionError("Unrelated source must not reach storage")

    monkeypatch.setattr(reads, "raw_file_store_from_env", forbidden)
    assert (
        finance_api.get(
            f"{BASE}/sources/{'f' * 64}", params={"snapshot_id": SNAPSHOT}
        ).status_code
        == 404
    )
    assert (
        finance_api.get(
            f"{BASE.replace('2026-11-03', '2024-11-05')}/sources/{SOURCE}",
            params={"snapshot_id": SNAPSHOT},
        ).status_code
        == 404
    )


def test_corruption_and_store_failure_return_no_bytes(
    finance_api, published, monkeypatch
):
    class BrokenStore:
        def get(self, key, destination, *, max_bytes):
            Path(destination).write_bytes(b"corrupt")

    monkeypatch.setattr(reads, "raw_file_store_from_env", BrokenStore)
    response = finance_api.get(
        f"{BASE}/sources/{SOURCE}", params={"snapshot_id": SNAPSHOT}
    )
    assert response.status_code == 503 and b"corrupt" not in response.content

    def unavailable():
        raise RuntimeError("secret provider credential")

    monkeypatch.setattr(reads, "raw_file_store_from_env", unavailable)
    response = finance_api.get(
        f"{BASE}/sources/{SOURCE}/lines", params={"snapshot_id": SNAPSHOT}
    )
    assert response.status_code == 503 and b"credential" not in response.content


def test_html_is_downloaded_or_returned_as_json_never_rendered(
    finance_api, finance_db, monkeypatch
):
    body = '<script>alert("x")</script>\n<p>Official source</p>'.encode()
    source_hash = hashlib.sha256(body).hexdigest()
    _snapshot(finance_db, body=body, filename="home.html")
    _current(finance_db)
    finance_db.commit()
    monkeypatch.setattr(reads, "raw_file_store_from_env", lambda: _Store(body))
    response = finance_api.get(
        f"{BASE}/sources/{source_hash}", params={"snapshot_id": SNAPSHOT}
    )
    assert response.headers["content-type"] == "application/octet-stream"
    response = finance_api.get(
        f"{BASE}/sources/{source_hash}/lines", params={"snapshot_id": SNAPSHOT}
    )
    assert response.headers["content-type"] == "application/json"
    assert response.json()["data"]["lines"][0]["text"] == '<script>alert("x")</script>'


@pytest.mark.parametrize(
    "suffix",
    [
        "",
        f"/{KEY}/races",
        f"/{KEY}/races/{RACE}",
        f"/{KEY}/races/{RACE}/precincts",
        f"/{KEY}/sources/{SOURCE}",
        f"/{KEY}/sources/{SOURCE}/lines",
    ],
)
def test_every_route_requires_finance_access(finance_api, published, suffix):
    finance_api.headers.pop("Authorization")
    response = finance_api.get(
        f"/api/v1/finance/elections{suffix}", params={"snapshot_id": SNAPSHOT}
    )
    assert response.status_code in {401, 403}
    assert "private" in response.headers["cache-control"]


@pytest.mark.parametrize(
    "params",
    [{"limit": 101}, {"offset": -1}, {"q": "\x00"}, {"snapshot_id": "not-a-hash"}],
)
def test_invalid_list_inputs_are_rejected(finance_api, published, params):
    assert finance_api.get(f"{BASE}/races", params=params).status_code == 422
