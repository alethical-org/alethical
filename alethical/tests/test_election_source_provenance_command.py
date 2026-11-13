"""Dry-by-default provenance review command; execute records only provenance."""
# ruff: noqa: F811

from __future__ import annotations

import json

import pytest

from alethical.pipeline import election_source_provenance as p
from alethical.tests.test_election_source_provenance import (  # noqa: F401
    engine,
    session,
    world,
)
from scripts import review_election_source_provenance as command


def run(capsys, *argv):
    code = command.main([str(a) for a in argv])
    out = capsys.readouterr()
    return code, out.out, out.err


def request(receipt, **changes):
    value = {
        "receipt": receipt,
        "decision": "checked",
        "reviewed_by": "synthetic reviewer",
        "reason": "command test",
        "expected_previous_id": None,
    }
    value.update(changes)
    return value


def _synthetic():
    record = {
        "requested_url": "https://example.test/x",
        "fetched_at": "2026-11-12T00:00:00+00:00",
        "state": "captured",
        "redirects": [],
        "final_url": "https://example.test/x",
        "sha256": "a" * 64,
        "bytes": 10,
    }
    evidence = json.dumps(record).encode() + b"\n"
    return evidence, p.prepare_acquisition(evidence)


def test_prepare_writes_a_proposal_once(tmp_path, capsys):
    evidence, receipt = _synthetic()
    (tmp_path / "e.jsonl").write_bytes(evidence)
    out = tmp_path / "proposal.json"
    code, stdout, _ = run(
        capsys, "prepare", "--evidence", tmp_path / "e.jsonl", "--output", out
    )
    assert code == 0 and json.loads(stdout)["source_validation"] == "not_approved"
    assert json.loads(out.read_text()) == receipt
    code, _, err = run(
        capsys, "prepare", "--evidence", tmp_path / "e.jsonl", "--output", out
    )
    assert code == 2 and "not recorded" in err


@pytest.mark.parametrize(
    "body",
    [
        b'{"receipt": {}, "receipt": {}}',
        b'{"receipt": NaN}',
        b'{"x": Infinity}',
        b"[1]",
    ],
)
def test_review_rejects_duplicate_nonfinite_and_unknown_json(tmp_path, capsys, body):
    (tmp_path / "r.json").write_bytes(body)
    code, _, err = run(capsys, "review", "--request", tmp_path / "r.json")
    assert code == 2 and "not recorded" in err


def test_review_dry_run_checks_shape_and_exact_evidence_only(tmp_path, capsys):
    evidence, receipt = _synthetic()
    (tmp_path / "e.jsonl").write_bytes(evidence)
    (tmp_path / "other.jsonl").write_bytes(evidence.replace(b"/x", b"/y"))
    (tmp_path / "r.json").write_text(json.dumps(request(receipt)))
    code, stdout, _ = run(
        capsys,
        "review",
        "--request",
        tmp_path / "r.json",
        "--evidence",
        tmp_path / "e.jsonl",
    )
    result = json.loads(stdout)
    assert code == 0 and result["executed"] is False
    assert result["receipt_sha256"] == p.receipt_id(receipt)
    for argv in (
        ("--evidence", tmp_path / "other.jsonl"),
        (),
    ):
        code, _, err = run(capsys, "review", "--request", tmp_path / "r.json", *argv)
        assert code == 2, argv
    extra = request(receipt) | {"approve_identity": True}
    (tmp_path / "x.json").write_text(json.dumps(extra))
    assert run(capsys, "review", "--request", tmp_path / "x.json")[0] == 2


def test_capacity_is_reported_as_temporary(tmp_path, capsys, monkeypatch):
    evidence, receipt = _synthetic()
    (tmp_path / "e.jsonl").write_bytes(evidence)
    (tmp_path / "r.json").write_text(json.dumps(request(receipt)))

    def busy(*_args, **_kwargs):
        raise command.SourceFileLimitError("busy")

    monkeypatch.setattr(command, "execute_request", busy)
    code, _, err = run(
        capsys,
        "review",
        "--request",
        tmp_path / "r.json",
        "--evidence",
        tmp_path / "e.jsonl",
        "--execute",
    )
    assert code == 75 and "retry" in err


def test_execute_records_only_a_provenance_decision(
    engine, tmp_path, capsys, monkeypatch
):  # noqa: F811
    w = world(engine, "command")
    receipt, evidence = w["directory"]
    (tmp_path / "e.json").write_bytes(evidence)
    (tmp_path / "r.json").write_text(json.dumps(request(receipt)))
    monkeypatch.setattr(command, "database_url_for_target", lambda target: engine.url)
    monkeypatch.setattr(command, "raw_file_store_from_env", lambda: w["store"])
    with session(engine) as db:
        before = {
            t: db.execute(p.text(f"SELECT count(*) FROM {t}")).scalar()
            for t in ("election_result_source", "election_source_provenance_decision")
        }
    argv = (
        "review",
        "--request",
        tmp_path / "r.json",
        "--evidence",
        tmp_path / "e.json",
        "--execute",
    )
    code, stdout, err = run(capsys, *argv)
    assert code == 0, err
    first = json.loads(stdout)
    assert first["created"] is True and first["history_status"] == "current"
    assert first["sources"] == "not_changed" and first["publication"] == "not_changed"
    code, stdout, _ = run(capsys, *argv)
    assert code == 0 and json.loads(stdout)["created"] is False
    withdraw = request(
        receipt, decision="withdrawn", expected_previous_id=first["decision_id"]
    )
    (tmp_path / "w.json").write_text(json.dumps(withdraw))
    code, stdout, err = run(
        capsys, "review", "--request", tmp_path / "w.json", "--execute"
    )
    assert code == 0, err
    assert json.loads(stdout)["decision"] == "withdrawn"
    with session(engine) as db:
        after = {
            t: db.execute(p.text(f"SELECT count(*) FROM {t}")).scalar()
            for t in ("election_result_source", "election_source_provenance_decision")
        }
    assert after["election_result_source"] == before["election_result_source"]
    assert (
        after["election_source_provenance_decision"]
        == before["election_source_provenance_decision"] + 2
    )
