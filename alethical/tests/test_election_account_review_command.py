"""Review command validates offline, then records one atomic local decision."""

# ruff: noqa: F811, F401
from copy import deepcopy
from datetime import date
import importlib.util
import json
from pathlib import Path

import pytest
from sqlalchemy import event, func, select
from sqlalchemy.exc import OperationalError, SQLAlchemyError
from sqlalchemy.orm import Session

from alethical.db import models as m
from alethical.pipeline.election_comparison import ComparisonImportError
from alethical.pipeline import campaign_finance_filings as filings
from alethical.tests.test_election_account_reviews import review_context
from alethical.tests.test_election_comparison_storage import (
    db,
    prepared,
    source_set,
)

ROOT = Path(__file__).resolve().parents[2]
SPEC = importlib.util.spec_from_file_location(
    "election_account_review_command", ROOT / "scripts/review_election_account.py"
)
assert SPEC and SPEC.loader
command = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(command)


def request_value():
    return dict(
        snapshot_id="a" * 64,
        race_id="b" * 64,
        candidate_id="03350401",
        registration_number="19399",
        decision="confirmed",
        identity=dict(
            candidate_source_id="03350401",
            name="Example Candidate",
            party="TEST",
            office_id="0335",
            office_name="Attorney General",
            district=None,
            jurisdiction="88",
        ),
        period_start="2026-01-01",
        period_end="2026-10-19",
        evidence=[
            {"kind": "ballot", "sha256": "c" * 64},
            {
                "kind": "committee_register",
                "sha256": "d" * 64,
                "collection_id": "e" * 64,
            },
            {"kind": "report_cover", "sha256": "f" * 64, "page": 1},
        ],
        reason="Exact source review",
        reviewed_by="private reviewer",
        expected_previous_id=None,
    )


def write_request(tmp_path, value):
    path = tmp_path / "review.json"
    path.write_text(json.dumps(value, default=str), encoding="utf-8")
    return path


def test_dry_run_is_offline_even_for_production_target(tmp_path, monkeypatch, capsys):
    path = write_request(tmp_path, request_value())
    monkeypatch.setattr(
        command,
        "create_engine",
        lambda *a, **k: pytest.fail("Dry run attempted database access"),
    )
    monkeypatch.setattr(command, "record_decision", command.record_decision)
    assert command.main(["--request", str(path), "--target", "production"]) == 0
    receipt = json.loads(capsys.readouterr().out)
    assert receipt["executed"] is False
    assert receipt["source_validation"] == "not_run"
    assert "decision_id" not in receipt
    assert "reviewed_by" not in receipt


@pytest.mark.parametrize(
    "change",
    [
        {"snapshot_id": "short"},
        {"race_id": 42},
        {"candidate_id": None},
        {"registration_number": 19399},
        {"registration_number": " 19399"},
        {"decision": "proposal"},
        {"decision": []},
        {"authority": "other"},
        {"reason": " "},
        {"reviewed_by": False},
        {"expected_previous_id": True},
        {"expected_previous_id": -1},
        {"expected_previous_id": "12"},
        {"decision": "withdrawn"},
        {"identity": []},
        {"identity": {}},
        {"period_start": None},
        {"period_start": "20260101"},
        {"period_start": "2026-02-30"},
        {"period_end": "2025-12-31"},
        {"period_end": "2027-01-01"},
        {"compatible_decision_ids": "12"},
        {"compatible_decision_ids": [True]},
        {"compatible_decision_ids": [0]},
        {"evidence": {}},
        {"evidence": []},
        {"evidence": [None]},
        {"evidence": [{"kind": "ballot", "sha256": "short"}]},
        {"evidence": [{"kind": "report_cover", "sha256": "a" * 64, "page": True}]},
        {"evidence": [{"kind": "committee_register", "sha256": "a" * 64}]},
        {"evidence": [{"kind": "candidate_identity", "sha256": "a" * 64}]},
        {"evidence": [{"kind": "same_person", "sha256": "a" * 64, "decision_ids": {}}]},
        {"unknown_field": "not part of request"},
    ],
)
def test_bad_shape_is_a_plain_error_before_execution(
    tmp_path, monkeypatch, capsys, change
):
    path = write_request(tmp_path, request_value() | change)
    monkeypatch.setattr(
        command, "execute_request", lambda *a: pytest.fail("Malformed request executed")
    )
    assert command.main(["--request", str(path), "--execute"]) == 2
    captured = capsys.readouterr()
    assert captured.out == ""
    assert captured.err.startswith("Review not recorded:")
    assert "Traceback" not in captured.err


@pytest.mark.parametrize(
    "body",
    [
        b"{broken",
        b"[]",
        b"null",
        b'"text"',
        b"{}",
        b'{"decision":"confirmed","decision":"rejected"}',
        b'{"x":NaN}',
        b"\xff",
    ],
)
def test_invalid_json_and_text_have_no_traceback(tmp_path, capsys, body):
    path = tmp_path / "bad.json"
    path.write_bytes(body)
    assert command.main(["--request", str(path)]) == 2
    captured = capsys.readouterr()
    assert captured.out == ""
    assert "Traceback" not in captured.err


@pytest.mark.parametrize(
    "change",
    [
        {"page": None},
        {"page": True},
        {"collection_id": None},
        {"collection_id": "short"},
    ],
)
def test_report_excerpt_dry_run_requires_exact_page_and_collection(
    tmp_path, monkeypatch, change
):
    value = request_value()
    value["evidence"].append(
        {
            "kind": "report_excerpt",
            "sha256": "d" * 64,
            "page": 6,
            "collection_id": "e" * 64,
            "locator": {"type": "native_pdf_lines"},
            "literal_fields": {
                "lines": [{"line_number": 1, "text": "Synthetic expense"}]
            },
            **change,
        }
    )
    monkeypatch.setattr(
        command, "execute_request", lambda *a: pytest.fail("Malformed excerpt executed")
    )
    assert (
        command.main(["--request", str(write_request(tmp_path, value)), "--execute"])
        == 2
    )


def test_missing_request_file_is_a_plain_error(tmp_path, capsys):
    assert command.main(["--request", str(tmp_path / "absent.json")]) == 2
    assert "Could not read" in capsys.readouterr().err


def test_dates_and_negative_registration_remain_exact(tmp_path):
    value = request_value() | {
        "registration_number": "-101",
        "compatible_decision_ids": None,
    }
    parsed = command.read_request(write_request(tmp_path, value))
    assert parsed["period_start"] == date(2026, 1, 1)
    assert parsed["registration_number"] == "-101"
    assert parsed["identity"]["district"] is None


@pytest.fixture()
def local_execution(db, review_context, monkeypatch):
    # The command opens a real savepoint transaction on this test's temporary
    # database connection. No configured local or production URL is contacted.
    connection = db.connection()
    sessions = []
    engines = []

    class Engine:
        disposed = False

        def dispose(self):
            self.disposed = True

    def target_url(target):
        assert target == "local", "Production execution is forbidden in tests"
        return "postgresql://temporary-test-only"

    def engine_for(url, **kwargs):
        assert url == "postgresql://temporary-test-only"
        engine = Engine()
        engines.append(engine)
        return engine

    def session_for(engine):
        assert engine in engines
        session = Session(bind=connection, join_transaction_mode="create_savepoint")
        sessions.append(session)
        return session

    monkeypatch.setattr(command, "database_url_for_target", target_url)
    monkeypatch.setattr(command, "create_engine", engine_for)
    monkeypatch.setattr(command, "Session", session_for)
    return dict(args=review_context[3], sessions=sessions, engines=engines)


def count_decisions(db):
    return db.scalar(
        select(func.count()).select_from(m.ElectionCampaignAccountDecision)
    )


def test_execute_checks_sources_and_retry_keeps_original_receipt(
    db, local_execution, tmp_path, capsys
):
    args = local_execution["args"]
    original = write_request(tmp_path, args)
    argv = ["--request", str(original), "--execute"]
    assert command.main(argv) == 0
    first = json.loads(capsys.readouterr().out)
    assert first["executed"] is True
    assert (
        first["source_validation"]
        == "retained_source_references_and_supplied_quotes_checked"
    )
    assert first["history_status"] == "current"
    assert first["previous_decision_id"] is None
    assert count_decisions(db) == 1
    assert command.main(argv) == 0
    assert json.loads(capsys.readouterr().out) == first
    assert count_decisions(db) == 1

    # A stale, different review cannot silently replace the first decision.
    write_request(tmp_path, args | {"reason": "Different review, stale head"})
    assert command.main(argv) == 2
    assert "changed" in capsys.readouterr().err
    assert count_decisions(db) == 1

    # Withdrawal is explicit; retrying the original request reports an old
    # receipt without claiming that it became the current confirmation again.
    write_request(
        tmp_path,
        args
        | {
            "decision": "withdrawn",
            "reason": "Withdraw checked account",
            "expected_previous_id": first["decision_id"],
        },
    )
    assert command.main(argv) == 0
    withdrawn = json.loads(capsys.readouterr().out)
    assert withdrawn["previous_decision_id"] == first["decision_id"]
    write_request(tmp_path, args)
    assert command.main(argv) == 0
    repeated = json.loads(capsys.readouterr().out)
    assert repeated["decision_id"] == first["decision_id"]
    assert repeated["current_decision_id"] == withdrawn["decision_id"]
    assert repeated["history_status"] == "superseded"
    assert count_decisions(db) == 2
    assert all(engine.disposed for engine in local_execution["engines"])


def test_execute_rejects_missing_retained_source(db, local_execution, tmp_path, capsys):
    args = deepcopy(local_execution["args"])
    args["evidence"][0]["sha256"] = "0" * 64
    path = write_request(tmp_path, args)
    assert command.main(["--request", str(path), "--execute"]) == 2
    assert "not retained" in capsys.readouterr().err
    assert count_decisions(db) == 0
    assert local_execution["engines"][0].disposed


def test_failure_after_insert_rolls_back_without_success_receipt(
    db, local_execution, tmp_path, monkeypatch, capsys
):
    original = command.record_decision

    def fail_after_write(*args, **kwargs):
        original(*args, **kwargs)
        raise ComparisonImportError("Test failure after insert")

    # Preserve the public request signature used by offline validation.
    import functools

    monkeypatch.setattr(
        command, "record_decision", functools.wraps(original)(fail_after_write)
    )
    path = write_request(tmp_path, local_execution["args"])
    assert command.main(["--request", str(path), "--execute"]) == 2
    captured = capsys.readouterr()
    assert captured.out == ""
    assert "after insert" in captured.err
    assert count_decisions(db) == 0
    assert local_execution["engines"][0].disposed


def test_database_errors_do_not_expose_query_or_credentials(
    tmp_path, monkeypatch, capsys
):
    path = write_request(tmp_path, request_value())
    monkeypatch.setattr(command, "database_url_for_target", lambda target: "test-only")

    def failed_engine(*args, **kwargs):
        raise OperationalError(
            "private SQL", {"password": "private-password"}, Exception("private-host")
        )

    monkeypatch.setattr(command, "create_engine", failed_engine)
    assert command.main(["--request", str(path), "--execute"]) == 2
    captured = capsys.readouterr()
    assert captured.out == ""
    assert "Database operation failed" in captured.err
    assert "private" not in captured.err
    assert "Traceback" not in captured.err


def test_commit_failure_issues_no_success_receipt_and_rolls_back(
    db, local_execution, tmp_path, monkeypatch, capsys
):
    factory = command.Session

    def fail_commit(session):
        raise SQLAlchemyError("private driver failure")

    def failing_session(engine):
        session = factory(engine)
        event.listen(session, "before_commit", fail_commit)
        return session

    monkeypatch.setattr(command, "Session", failing_session)
    path = write_request(tmp_path, local_execution["args"])
    assert command.main(["--request", str(path), "--execute"]) == 2
    captured = capsys.readouterr()
    assert captured.out == ""
    assert "private driver" not in captured.err
    assert count_decisions(db) == 0
    assert local_execution["engines"][0].disposed


def test_offline_candidate_identity_citation_does_not_replace_register(
    tmp_path, capsys
):
    value = request_value()
    value["evidence"].append(
        {"kind": "candidate_identity", "sha256": "9" * 64, "collection_id": "e" * 64}
    )
    path = write_request(tmp_path, value)
    assert command.main(["--request", str(path)]) == 0
    assert json.loads(capsys.readouterr().out)["source_validation"] == "not_run"
    value["evidence"] = [
        item for item in value["evidence"] if item["kind"] != "committee_register"
    ]
    write_request(tmp_path, value)
    assert command.main(["--request", str(path)]) == 2
    assert "committee-register" in capsys.readouterr().err


@pytest.mark.parametrize(
    "source_registration,expected,review_context",
    [
        (
            registration,
            expected,
            {
                "body": b'{"synthetic":"candidate identity"}',
                "metadata": {
                    "kind": "candidate_identity",
                    "registration_number": registration,
                    "url": filings.viewer_url(filings.FilerKind.candidate_committee),
                    "request_method": "POST",
                    "request_form": {"id": registration, "tabname": "information"},
                },
            },
        )
        for registration, expected in [("19399", 2), ("99999", 2)]
    ],
    indirect=["review_context"],
    ids=["19399-unquoted", "99999-wrong-account"],
)
def test_execute_candidate_identity_citation_checks_exact_retained_account(
    db, local_execution, tmp_path, capsys, monkeypatch, source_registration, expected
):
    from alethical.pipeline import election_account_reviews as reviews
    from alethical.tests.test_election_comparison_storage import MemoryStore

    monkeypatch.setattr(reviews, "raw_file_store_from_env", MemoryStore)
    args = deepcopy(local_execution["args"])
    collection_id = args["evidence"][1]["collection_id"]
    collection = db.get(m.ElectionFinanceCollection, collection_id)
    source = next(s for s in collection.sources if s["kind"] == "candidate_identity")
    assert source["registration_number"] == source_registration
    source_hash = source["sha256"]
    args["evidence"].append(
        {
            "kind": "candidate_identity",
            "sha256": source_hash,
            "collection_id": collection_id,
        }
    )
    path = write_request(tmp_path, args)
    assert command.main(["--request", str(path), "--execute"]) == expected
    captured = capsys.readouterr()
    assert captured.out == ""
    assert (
        "typed literal fields"
        if source_registration == "19399"
        else "Candidate identity evidence"
    ) in captured.err
    assert count_decisions(db) == 0
