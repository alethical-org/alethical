"""Exporter safety and provenance using a fixed-query connection spy."""

from __future__ import annotations

import copy
import json
import re
from datetime import datetime, timezone
from types import SimpleNamespace
from uuid import UUID

import pytest
from sqlalchemy.dialects import postgresql
from sqlalchemy.sql import Select

from alethical.db.models import SponsorshipRole, VoteValue
from alethical.eval import graph_snapshot as snapshot

BILL_ID = UUID(int=1)
CHUNK_ID = UUID(int=2)
VERSION_ID = UUID(int=3)
AUTHOR_ID = UUID(int=4)
PERSON_ID = UUID(int=5)
VOTE_ID = UUID(int=6)
EVENT_ID = UUID(int=7)
ARTIFACT_ID = UUID(int=8)
IMPORTED = datetime(2026, 10, 7, tzinfo=timezone.utc)
OCCURRED = datetime(2025, 2, 14, tzinfo=timezone.utc)


class QuerySpy:
    def __init__(self, datasets):
        self.datasets = iter(datasets)
        self.statements = []
        self.in_transaction = False
        self.transaction_count = 0
        self.closed = False
        self.rolled_back = False
        self.dialect = SimpleNamespace(name="postgresql")

    def connect(self):
        return self

    def begin(self):
        self.in_transaction = True
        self.transaction_count += 1
        return self

    def __enter__(self):
        return self

    def __exit__(self, error_type, *_args):
        self.rolled_back |= error_type is not None
        self.closed = True
        return False

    def execute(self, statement):
        assert self.in_transaction
        self.statements.append(statement)
        if isinstance(statement, Select):
            return SimpleNamespace(mappings=lambda: next(self.datasets))
        assert str(statement).startswith("SET ")
        return None


def source_rows():
    provenance = {
        "source_artifact_id": ARTIFACT_ID,
        "source_hash": "stored-source-hash",
        "source_fetched_at": IMPORTED,
        "source_url": "https://www.revisor.mn.gov/bills/text.php?number=HF1",
    }
    bill = {
        "id": BILL_ID,
        "bill_key": "MN:2025:HF1",
        "title": "An act concerning schools",
        "current_status": "Introduced",
        "official_url": "https://www.revisor.mn.gov/bills/bill.php?b=House&f=HF1",
        "current_version_id": VERSION_ID,
        "current_version_code": "0",
        "current_version_document_date": OCCURRED,
    }
    chunk = {
        **provenance,
        "id": CHUNK_ID,
        "bill_id": BILL_ID,
        "bill_key": bill["bill_key"],
        "text": "School funding is appropriated.",
        "citation_label": "HF 1 section 1",
        "chunk_index": 0,
        "rag_section_document_id": UUID(int=10),
        "html_url": provenance["source_url"],
        "pdf_url": None,
        "bill_version_id": VERSION_ID,
        "version_code": "0",
        "source_occurred_at": OCCURRED,
        "section_id": UUID(int=11),
        "section_id_text": "laws.0.1.0",
        "section_source_order": 1,
        "section_source_hash": "section-source-hash",
        "clean_text_source_hash": "clean-text-hash",
        "imported_at": IMPORTED,
        "observed_at": IMPORTED,
        "embedding_model": "text-embedding-3-small",
        "embedding": [0.5, 0.25],
    }
    author = {
        "id": AUTHOR_ID,
        "bill_id": BILL_ID,
        "bill_key": bill["bill_key"],
        "official_url": bill["official_url"],
        "role": SponsorshipRole.co_author,
        "source_chamber": "house",
        "source_order": 2,
        "legislator_id": PERSON_ID,
        "committee_id": None,
        "full_name": "Alex Example",
        "imported_at": IMPORTED,
        "observed_at": IMPORTED,
    }
    vote = {
        **provenance,
        "id": VOTE_ID,
        "bill_id": BILL_ID,
        "bill_key": bill["bill_key"],
        "legislator_id": PERSON_ID,
        "full_name": "Alex Example",
        "vote_value": VoteValue.no,
        "event_id": EVENT_ID,
        "motion": "Adopt amendment A1",
        "result_text": "Motion adopted",
        "chamber_id": UUID(int=12),
        "chamber": "house",
        "source_occurred_at": OCCURRED,
        "official_url": "https://www.house.mn.gov/votes/1",
        "imported_at": IMPORTED,
        "observed_at": IMPORTED,
    }
    return [[bill], [chunk], [author], [vote]]


def test_export_reads_one_protected_transaction_and_only_public_tables():
    engine = QuerySpy(source_rows())
    result = snapshot.export_snapshot(engine, ["MN:2025:HF1", "missing"])
    assert engine.transaction_count == 1
    assert engine.closed
    assert (
        str(engine.statements[0])
        == "SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY"
    )
    assert str(engine.statements[1]) == "SET LOCAL statement_timeout = '30s'"
    allowed = {
        "bill",
        "bill_version",
        "bill_version_section",
        "rag_chunk",
        "rag_chunk_embedding",
        "rag_section_document",
        "source_artifact",
        "sponsorship",
        "legislator",
        "vote_record",
        "vote_event",
        "chamber",
    }
    for statement in engine.statements[2:]:
        sql = str(statement.compile(dialect=postgresql.dialect()))
        assert sql.startswith("SELECT ")
        assert "SELECT *" not in sql
        assert set(re.findall(r"(?:FROM|JOIN) (\w+)", sql)) <= allowed
        assert statement._limit_clause.value in {21, 10001, 20001}
    chunk_sql = str(engine.statements[3].compile(dialect=postgresql.dialect()))
    assert "bill_version.is_current IS true" in chunk_sql
    author_params = engine.statements[4].compile().params
    assert [
        SponsorshipRole.chief_author,
        SponsorshipRole.co_author,
    ] in author_params.values()
    assert result["manifest"]["missing_bill_keys"] == ["missing"]
    assert result["production_rankings"] == {}
    assert json.loads(json.dumps(result)) == result


def test_actual_provenance_and_vote_scope_survive_without_temporal_guesses():
    result = snapshot.export_snapshot(QuerySpy(source_rows()), ["MN:2025:HF1"])
    chunk = result["evidence"][f"chunk:{CHUNK_ID}"]
    author = result["evidence"][f"authorship:{AUTHOR_ID}"]
    vote = result["evidence"][f"vote:{VOTE_ID}"]
    assert chunk["source_hash"] == "stored-source-hash"
    assert chunk["source_artifact_id"] == str(ARTIFACT_ID)
    assert chunk["source_occurred_at"] == OCCURRED.isoformat()
    assert chunk["imported_at"] == IMPORTED.isoformat()
    assert chunk["source_order"] == 1 and chunk["chunk_index"] == 0
    assert author["source_artifact_id"] is None
    assert author["source_fetched_at"] is None
    assert author["source_artifact_status"] == "missing"
    assert author["source_occurred_at"] is None
    assert author["eligible"] is True  # Bill URL is the authorship citation contract.
    assert "co-author" in author["text"] and "house" in author["text"]
    assert author["relation"]["from_id"] == str(PERSON_ID)
    assert vote["event_id"] == str(EVENT_ID)
    assert vote["motion"] == "Adopt amendment A1"
    assert "final passage" not in vote["text"].lower()
    assert vote["vote_value"] == "no"
    assert result["vectors"][f"chunk:{CHUNK_ID}"] == {
        "model": "text-embedding-3-small",
        "values": [0.5, 0.25],
    }


def test_missing_urls_and_section_ids_remain_visible_and_uncitable():
    rows = source_rows()
    rows[1][0].update(html_url=None, pdf_url=None, source_url=None, section_id=None)
    rows[2][0]["official_url"] = None
    rows[3][0]["official_url"] = None
    result = snapshot.export_snapshot(QuerySpy(rows), ["MN:2025:HF1"])
    assert len(result["evidence"]) == 3
    for record in result["evidence"].values():
        assert record["official_url"] is None
        assert record["eligible"] is False
        assert record["ineligible_reason"] == "missing_official_url"
    assert result["evidence"][f"chunk:{CHUNK_ID}"]["section_id"] is None
    assert result["manifest"]["counts"]["missing_section_ids"] == 1


def test_unresolved_committee_preserves_endpoint_without_guessing_identity():
    rows = source_rows()
    rows[2][0].update(full_name=None, legislator_id=None, committee_id=UUID(int=99))
    result = snapshot.export_snapshot(QuerySpy(rows), ["MN:2025:HF1"])
    author = result["evidence"][f"authorship:{AUTHOR_ID}"]
    assert author["legislator_name"] is None
    assert author["relation"]["from_id"] == str(UUID(int=99))
    assert author["eligible"] is False
    assert author["ineligible_reason"] == "missing_author_identity"


@pytest.mark.parametrize(
    "keys", [[], [""], ["same", "same"], [str(i) for i in range(21)]]
)
def test_invalid_bill_sets_fail_before_connecting(keys):
    with pytest.raises(ValueError):
        snapshot.export_snapshot(None, keys)


def test_hash_fallback_refused_without_connecting():
    with pytest.raises(ValueError, match="Hash fallback"):
        snapshot.export_snapshot(None, ["bill"], "deterministic-sha256")


@pytest.mark.parametrize("kind", ["chunk", "authorship", "vote", "combined"])
def test_caps_fail_closed_instead_of_truncating(monkeypatch, kind):
    rows = source_rows()
    if kind == "chunk":
        monkeypatch.setattr(snapshot, "MAX_CHUNKS", 0)
    elif kind in {"authorship", "vote"}:
        monkeypatch.setattr(snapshot, "MAX_STRUCTURED_RECORDS", 0)
        if kind == "vote":
            rows[2] = []
    else:
        monkeypatch.setattr(snapshot, "MAX_STRUCTURED_RECORDS", 1)
    engine = QuerySpy(rows)
    with pytest.raises(snapshot.SnapshotLimitError):
        snapshot.export_snapshot(engine, ["MN:2025:HF1"])
    assert engine.rolled_back


def test_digest_covers_all_content_including_vectors_and_export_time():
    result = snapshot.export_snapshot(QuerySpy(source_rows()), ["MN:2025:HF1"])
    digest = result["manifest"]["content_digest"]
    assert digest == snapshot.snapshot_digest(result)
    changed = copy.deepcopy(result)
    changed["vectors"][f"chunk:{CHUNK_ID}"]["values"][0] += 0.1
    assert snapshot.snapshot_digest(changed) != digest
    changed = copy.deepcopy(result)
    changed["manifest"]["exported_at"] = "changed"
    assert snapshot.snapshot_digest(changed) != digest


def test_serving_rankings_use_same_transaction_and_actual_enumerating_regex(
    monkeypatch,
):
    from alethical.api.routers import ask

    engine = QuerySpy(source_rows())
    calls = []

    class BoundSession:
        def __init__(self, *, bind, autoflush):
            assert bind is engine and bind.in_transaction and not autoflush

        def __enter__(self):
            return self

        def __exit__(self, *_args):
            return False

    def retrieve(db, bill, model, vector, *, enumerating):
        calls.append((bill.id, model, vector, enumerating))
        assert str(engine.statements[-1]) == "SET LOCAL hnsw.ef_search = 100"
        return [SimpleNamespace(id=CHUNK_ID)], SimpleNamespace(total=4)

    monkeypatch.setattr(snapshot, "Session", BoundSession)
    monkeypatch.setattr(ask, "_retrieve_bill_text", retrieve)
    question = "List all provisions in this bill"
    vector = [0.1] * 1536
    result = snapshot.export_snapshot(
        engine,
        ["MN:2025:HF1", "missing"],
        query_vectors={question: vector},
        questions=[
            {"id": "q1", "bill_key": "MN:2025:HF1", "question": question},
            {"id": "q2", "bill_key": "missing", "question": question},
        ],
    )
    assert len(calls) == 1
    assert calls[0][0] == BILL_ID
    assert calls[0][3] == bool(ask._LIST_QUESTION_RE.search(question))
    assert result["production_rankings"]["q1"]["evidence_ids"] == [f"chunk:{CHUNK_ID}"]
    assert result["production_rankings"]["q1"]["passages_total"] == 4
    assert result["production_rankings"]["q2"]["reason"] == "missing_bill"


@pytest.mark.parametrize(
    "vectors", [None, {}, {"question": [0.1]}, {"question": [float("nan")] * 1536}]
)
def test_serving_rankings_require_complete_real_query_vectors_before_connection(
    vectors,
):
    with pytest.raises(ValueError, match="query vector"):
        snapshot.export_snapshot(
            QuerySpy([]),
            ["bill"],
            questions=[{"id": "q", "bill_key": "bill", "question": "question"}],
            query_vectors=vectors,
        )
