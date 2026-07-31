from __future__ import annotations

import json
from pathlib import Path

from alethical.pipeline import codex_enrichment as ce


def _valid_content(key_point_count: int) -> dict:
    """A schema-shaped enrichment reply carrying `key_point_count` key points."""
    content: dict = {}
    for key, spec in ce.SUMMARY_SCHEMA["properties"].items():
        kind = spec.get("type")
        if kind == "string":
            content[key] = "x"
        elif kind == "array":
            content[key] = []
        elif kind == "boolean":
            content[key] = False
        elif kind == "integer":
            content[key] = 0
        elif kind == "object":
            content[key] = {
                k: ([] if v.get("type") == "array" else 0)
                for k, v in spec.get("properties", {}).items()
            }
    content["confidence"] = "medium"
    content["key_points"] = [f"point {i}" for i in range(key_point_count)]
    return content


def _run_dir(tmp_path: Path, counts: dict[str, int]) -> Path:
    """Build a run directory holding one output file per bill in `counts`."""
    run_dir = tmp_path / "run"
    (run_dir / "outputs").mkdir(parents=True)
    items = [
        {
            "custom_id": custom_id,
            "bill_id": "00000000-0000-0000-0000-000000000000",
            "bill_key": custom_id.split(":")[1],
            "bill_version_id": "00000000-0000-0000-0000-000000000000",
            "model": "claude:claude-sonnet-5",
            "source_version_hash": "hash",
        }
        for custom_id in counts
    ]
    manifest = run_dir / "batch.codex.manifest.json"
    manifest.write_text(json.dumps({"items": items}), encoding="utf-8")
    for custom_id, count in counts.items():
        row = ce.output_row(custom_id, _valid_content(count))
        safe = ce.safe_custom_id(custom_id)
        (run_dir / "outputs" / f"{safe}.jsonl").write_text(
            json.dumps(row, ensure_ascii=False) + "\n", encoding="utf-8"
        )
    return run_dir


def test_key_points_ceiling_reads_the_schema() -> None:
    """The reported ceiling comes from the schema, so the two cannot drift."""
    assert (
        ce.key_points_ceiling()
        == ce.SUMMARY_SCHEMA["properties"]["key_points"]["maxItems"]
    )


def test_over_ceiling_reply_is_reported_but_still_combined(tmp_path) -> None:
    """A reply above the schema's runaway guard is FLAGGED, never dropped (#836).

    The guard binds only on OpenAI strict Structured Outputs; the Claude path pastes
    the schema in as prose, so a long reply reaches us and must still be applied — a
    bill with no summary is invisible in every list on the site (#836), which is
    worse than one that runs long."""
    ceiling = ce.key_points_ceiling()
    # SF4555 sorts LAST by output filename, so an unsorted sample would list the
    # milder HF1 first -- the sample has to lead with the worst offender.
    run_dir = _run_dir(
        tmp_path,
        {
            "bill_summary:94-2026-SF4555:aaaa": ceiling + 3,
            "bill_summary:94-2025-HF1:bbbb": ceiling + 1,
            "bill_summary:94-2025-HF9:cccc": 6,
        },
    )

    result = ce.combine_output_files(run_dir=run_dir)

    # Flagged, worst first, with each offending bill named and counted.
    assert result["key_points_ceiling"] == ceiling
    assert result["over_ceiling"] == 2
    assert result["over_ceiling_sample"] == [
        {"custom_id": "bill_summary:94-2026-SF4555:aaaa", "key_points": ceiling + 3},
        {"custom_id": "bill_summary:94-2025-HF1:bbbb", "key_points": ceiling + 1},
    ]

    # Not rejected: every bill combined, nothing failed.
    assert result["combined"] == 3
    assert result["failed"] == 0
    assert result["missing"] == 0
    combined_ids = {
        json.loads(line)["custom_id"]
        for line in (run_dir / "combined.output.jsonl")
        .read_text(encoding="utf-8")
        .splitlines()
        if line.strip()
    }
    assert "bill_summary:94-2026-SF4555:aaaa" in combined_ids


def test_replies_within_the_ceiling_flag_nothing(tmp_path) -> None:
    ceiling = ce.key_points_ceiling()
    run_dir = _run_dir(
        tmp_path,
        {
            "bill_summary:94-2025-HF1:aaaa": 6,
            "bill_summary:94-2025-HF2:bbbb": ceiling,
        },
    )

    result = ce.combine_output_files(run_dir=run_dir)

    assert result["over_ceiling"] == 0
    assert result["over_ceiling_sample"] == []
    assert result["combined"] == 2
    assert result["failed"] == 0
