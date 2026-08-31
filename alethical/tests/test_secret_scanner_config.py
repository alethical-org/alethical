"""Keep the secret scanner narrow enough to trust and broad enough to protect us."""

from pathlib import Path


WORKFLOW = Path(__file__).resolve().parents[2] / ".github/workflows/ci.yml"


def test_scanner_allows_regular_python_names() -> None:
    workflow = WORKFLOW.read_text(encoding="utf-8")

    assert workflow.count("--exclude-detectors=lob") == 1
    assert workflow.count("--exclude-detectors=") == 1
    assert "--results=verified,unknown" in workflow
    assert "--fail-on-scan-errors" in workflow
    assert "Alethical has no Lob" in workflow
    assert "ordinary pytest names" in workflow
