"""Dry-by-default provenance review command; execute records only provenance."""
# ruff: noqa: F811

from __future__ import annotations

import json
import copy

import pytest

from alethical.pipeline import election_source_provenance as p
from alethical.pipeline import election_board_candidate_records as board
from alethical.pipeline.election_comparison import archive_source
from alethical.tests.test_election_board_candidate_records import (
    captured,
    world as board_world,
)
from alethical.tests.test_election_comparison_storage import MemoryStore
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


def board_capture():
    body = b'{"data":["synthetic command capture"]}'
    record = captured(body)
    evidence = json.dumps({"capture": record}).encode()
    receipt = board.prepare_post_acquisition(evidence, pointer="/capture")
    return body, record, evidence, receipt


def test_board_capture_prepare_preserves_exact_pointer_and_refuses_overwrite(
    tmp_path, capsys
):
    _, _, evidence, receipt = board_capture()
    path, output = tmp_path / "e.json", tmp_path / "proposal.json"
    path.write_bytes(evidence)
    argv = (
        "prepare",
        "--kind",
        "board-capture",
        "--evidence",
        path,
        "--pointer",
        "/capture",
        "--output",
        output,
    )
    code, stdout, err = run(capsys, *argv)
    assert code == 0, err
    assert json.loads(output.read_text()) == receipt
    result = json.loads(stdout)
    assert result["operation"] == "prepared_board_capture_proposal"
    assert result["source_validation"] == "not_approved"
    assert run(capsys, *argv)[0] == 2


def test_board_capture_dry_review_checks_exact_evidence(tmp_path, capsys):
    _, _, evidence, receipt = board_capture()
    path, req = tmp_path / "e.json", tmp_path / "request.json"
    path.write_bytes(evidence)
    req.write_text(json.dumps(request(receipt)))
    code, stdout, err = run(capsys, "review", "--request", req, "--evidence", path)
    assert code == 0, err
    result = json.loads(stdout)
    assert result["executed"] is False
    assert result["identity_review"] == "not_recorded"
    assert result["receipt_sha256"] == p.receipt_id(receipt)


@pytest.mark.parametrize(
    "change", ["form", "time", "media", "body", "missing", "oversize"]
)
def test_board_capture_review_refuses_changed_or_missing_evidence(
    tmp_path, capsys, change
):
    _, record, evidence, receipt = board_capture()
    altered = copy.deepcopy(record)
    if change == "form":
        altered["request_form"]["id"] = "1"
    elif change == "time":
        altered["finished_at"] = "2026-11-13T21:00:04+00:00"
    elif change == "media":
        altered["response_headers"]["Content-Type"] = "text/html"
    elif change == "body":
        altered["body_sha256"] = "0" * 64
    path, req = tmp_path / "e.json", tmp_path / "request.json"
    path.write_bytes(
        b" " * (p.MAX_EVIDENCE + 1)
        if change == "oversize"
        else json.dumps({"capture": altered}).encode()
    )
    req.write_text(json.dumps(request(receipt)))
    args = () if change == "missing" else ("--evidence", path)
    code, _, err = run(capsys, "review", "--request", req, *args)
    assert code == 2 and "not recorded" in err
    assert evidence != path.read_bytes() or change in {"missing", "oversize"}


@pytest.mark.parametrize("kind", ["board-capture", "unsupported"])
def test_board_capture_prepare_refuses_body_capture_or_invalid_kind(
    tmp_path, capsys, kind
):
    _, _, evidence, _ = board_capture()
    path, output = tmp_path / "e.json", tmp_path / "absent.json"
    path.write_bytes(evidence)
    argv = ("prepare", "--kind", kind, "--evidence", path, "--output", output)
    if kind == "unsupported":
        with pytest.raises(SystemExit) as error:
            command.main([str(a) for a in argv])
        assert error.value.code == 2
    else:
        assert run(capsys, *argv, "--body-capture", path)[0] == 2
    assert not output.exists()


def test_board_capture_execute_is_idempotent_and_can_withdraw_without_evidence(
    engine, tmp_path, capsys, monkeypatch
):
    body, _, evidence, receipt = board_capture()
    store = MemoryStore()
    with session(engine) as db:
        archive_source(db, store, body)
    monkeypatch.setattr(command, "database_url_for_target", lambda target: engine.url)
    monkeypatch.setattr(command, "raw_file_store_from_env", lambda: store)
    path, req = tmp_path / "e.json", tmp_path / "request.json"
    path.write_bytes(evidence)
    req.write_text(json.dumps(request(receipt)))
    argv = ("review", "--request", req, "--evidence", path, "--execute")
    code, stdout, err = run(capsys, *argv)
    assert code == 0, err
    first = json.loads(stdout)
    assert first["created"] is True and first["identity_review"] == "not_recorded"
    code, stdout, err = run(capsys, *argv)
    assert code == 0, err
    assert json.loads(stdout)["created"] is False
    req.write_text(
        json.dumps(
            request(
                receipt, decision="withdrawn", expected_previous_id=first["decision_id"]
            )
        )
    )
    code, stdout, err = run(capsys, "review", "--request", req, "--execute")
    assert code == 0, err
    assert json.loads(stdout)["decision"] == "withdrawn"


def test_board_relationship_output_distinguishes_identity_from_PCC_review(
    engine, tmp_path, capsys, monkeypatch
):
    w = board_world(engine, "command-relationship-output")
    monkeypatch.setattr(command, "database_url_for_target", lambda target: engine.url)
    monkeypatch.setattr(command, "raw_file_store_from_env", lambda: w["store"])
    req, evidence = tmp_path / "request.json", tmp_path / "extra.json"
    evidence.write_text("{}")
    req.write_text(json.dumps(request(w["relation"])))
    code, stdout, err = run(capsys, "review", "--request", req)
    assert code == 0, err
    assert json.loads(stdout)["identity_review"] == "not_recorded"
    assert run(capsys, "review", "--request", req, "--evidence", evidence)[0] == 2
    with session(engine) as db:
        before = db.execute(
            p.text("SELECT count(*) FROM election_campaign_account_decision")
        ).scalar()
    previous = w["relation_row"]
    for decision in ("checked", "withdrawn"):
        req.write_text(
            json.dumps(
                request(w["relation"], decision=decision, expected_previous_id=previous)
            )
        )
        code, stdout, err = run(capsys, "review", "--request", req, "--execute")
        assert code == 0, err
        result = json.loads(stdout)
        assert result["identity_review"] == "candidate_record_relationship_" + decision
        assert result["account_review"] == "not_recorded"
        assert result["publication"] == "not_changed"
        previous = result["decision_id"]
    with session(engine) as db:
        assert (
            db.execute(
                p.text("SELECT count(*) FROM election_campaign_account_decision")
            ).scalar()
            == before
        )


def test_recipient_root_review_refuses_capture_evidence(engine, tmp_path, capsys):
    w = world(engine, "command-extra-root-evidence")
    req, evidence = tmp_path / "request.json", tmp_path / "extra.json"
    req.write_text(json.dumps(request(w["root"])))
    evidence.write_text("{}")
    assert run(capsys, "review", "--request", req)[0] == 0
    assert run(capsys, "review", "--request", req, "--evidence", evidence)[0] == 2
