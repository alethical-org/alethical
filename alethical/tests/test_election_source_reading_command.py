"""The reading command never turns preparation/dry JSON into a decision."""

from copy import deepcopy
import json

import pytest

from scripts import review_election_source_reading as command
from alethical.tests.test_election_source_readings import reading


def request():
    return dict(
        receipt=reading()[1],
        decision="checked",
        reviewed_by="private",
        reason="Explicit synthetic review",
        expected_previous_id=None,
    )


def test_dry_review_does_not_connect_install_or_approve(tmp_path, monkeypatch, capsys):
    path = tmp_path / "request.json"
    path.write_text(json.dumps(request()))
    monkeypatch.setattr(
        command, "execute_request", lambda *args: pytest.fail("dry review executed")
    )
    monkeypatch.setattr(
        command,
        "create_engine",
        lambda *args, **kwargs: pytest.fail("dry review connected"),
    )
    assert (
        command.main(["review", "--request", str(path), "--target", "production"]) == 0
    )
    receipt = json.loads(capsys.readouterr().out)
    assert (
        receipt["executed"] is False
        and receipt["source_validation"] == "request_shape_only"
    )
    assert (
        receipt["candidate_review"] == "not_recorded"
        and receipt["publication"] == "not_changed"
    )
    assert "reviewed_by" not in receipt and "decision_id" not in receipt


@pytest.mark.parametrize(
    "body",
    [
        '{"decision":"checked","decision":"withdrawn"}',
        '{"value":NaN}',
        "[]",
        '{"figures_accepted":true}',
    ],
)
def test_invalid_review_json_has_no_execution(tmp_path, body, monkeypatch, capsys):
    path = tmp_path / "request.json"
    path.write_text(body)
    monkeypatch.setattr(
        command,
        "execute_request",
        lambda *args: pytest.fail("invalid request executed"),
    )
    assert command.main(["review", "--request", str(path), "--execute"]) == 2
    assert capsys.readouterr().out == ""


def test_prepare_preserves_original_and_never_clobbers_existing_output(
    tmp_path, capsys
):
    body, receipt = reading()
    pdf = tmp_path / "source.pdf"
    pdf.write_bytes(body)
    observations = tmp_path / "fields.json"
    observations.write_text(
        json.dumps(
            {
                k: deepcopy(receipt[k])
                for k in ["fields", "document_kind", "dependencies", "source_context"]
            }
        )
    )
    output = tmp_path / "receipt.json"
    args = [
        "prepare",
        "--pdf",
        str(pdf),
        "--observations",
        str(observations),
        "--output",
        str(output),
    ]
    assert command.main(args) == 0
    assert json.loads(output.read_text()) == receipt
    assert json.loads(capsys.readouterr().out)["source_validation"] == "not_approved"
    output.write_text("keep existing")
    assert command.main(args) == 2 and output.read_text() == "keep existing"
    assert pdf.read_bytes() == body
