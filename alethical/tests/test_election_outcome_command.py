"""Private review command rejects ambiguous JSON and keeps dry-run read only."""

import json
import pytest

from scripts import review_election_outcome as command
from alethical.pipeline.election_comparison import ComparisonImportError


def test_offline_capture_does_not_connect_or_promote(monkeypatch, capsys):
    monkeypatch.setattr(
        command, "create_engine", lambda *a, **k: pytest.fail("Dry run connected")
    )
    assert (
        command.main(
            [
                "--capture-url",
                "https://www.sos.mn.gov/source",
                "--publisher-url",
                "https://www.sos.mn.gov/",
                "--publisher-host",
                "www.sos.mn.gov",
                "--authority",
                "Minnesota Secretary of State",
            ]
        )
        == 0
    )
    result = json.loads(capsys.readouterr().out)
    assert result["executed"] is False and result["source_validation"] == "not_run"


@pytest.mark.parametrize(
    "body",
    [
        '{"snapshot_id":"a","snapshot_id":"b"}',
        '{"value":NaN}',
        "[]",
        '{"unknown":"value"}',
    ],
)
def test_invalid_review_json_is_rejected(tmp_path, body):
    path = tmp_path / "private-review.json"
    path.write_text(body)
    with pytest.raises(ComparisonImportError):
        command.read_request(path)
