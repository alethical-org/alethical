"""Source adapters retain incomplete coverage and never expose arbitrary logs."""

from copy import deepcopy

import pytest

from scripts.refresh_fcc_records import outcome


BASE = {
    "collection": {
        "status": "complete",
        "listed_files": 20,
        "files_failed": 0,
        "folders_failed": 0,
    },
    "backlog": {"downloads": 0, "second_copies": 0, "readings": 0},
    "source_gaps": 0,
    "reading_gaps": 0,
    "reading_operational_failures": 0,
    "needs_attention": False,
    "errors": {},
}


def test_fcc_complete_is_complete_only_with_full_counts():
    code, finding = outcome(BASE, 0)
    assert code == 0 and finding["status"] == "complete"
    with pytest.raises(ValueError):
        outcome({"needs_attention": False}, 0)


def test_bounded_fcc_backlog_is_continuation_not_source_success():
    report = deepcopy(BASE)
    report["backlog"]["downloads"] = 10
    report["needs_attention"] = True
    report["collection"]["provider_error"] = "private provider response"
    code, finding = outcome(report, 1)
    assert code == 75 and finding["status"] == "continuing"
    assert "provider_error" not in finding["collection"]


@pytest.mark.parametrize(
    "change", ["source_gaps", "reading_gaps", "reading_operational_failures", "phase"]
)
def test_fcc_gaps_or_failed_phases_cannot_be_hidden_by_backlog(change):
    report = deepcopy(BASE)
    report["backlog"]["downloads"] = 10
    report["needs_attention"] = True
    if change == "phase":
        report["errors"] = {"mirror": "ExceptionName"}
    else:
        report[change] = 1
    assert outcome(report, 1)[0] == 1


def test_workflow_rollout_preserves_fallback_clocks_and_one_fcc_queue():
    from pathlib import Path

    root = Path(__file__).resolve().parents[2]
    for file, family in (
        ("campaign-money-refresh.yml", "campaign"),
        ("campaign-money-notices.yml", "notices"),
        ("vote-backfill.yml", "legislative"),
        ("fcc-political-files.yml", "fcc"),
    ):
        body = (root / ".github/workflows" / file).read_text()
        assert "  schedule:" in body
        assert (
            f"!contains(fromJSON(vars.SOURCE_REFRESH_FAMILIES || '[]'), '{family}')"
            in body
        )
    shared = (root / ".github/workflows/source-record-refresh.yml").read_text()
    assert (
        "ALETHICAL_SOURCE_REFRESH_FAMILIES: ${{ vars.SOURCE_REFRESH_FAMILIES || '[]' }}"
        in shared
    )
    assert "'production-fcc-political-files'" in shared
    assert "SOURCE_REFRESH_BILL_EMBEDDINGS_APPROVED == 'true'" in shared
    assert "poppler-utils tesseract-ocr" in shared
