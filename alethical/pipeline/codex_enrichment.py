from __future__ import annotations

import json
import re
from dataclasses import asdict
from pathlib import Path
from typing import Any

from alethical.pipeline.ai_enrichment import SUMMARY_SCHEMA, ManifestItem


def safe_custom_id(value: str) -> str:
    return re.sub(r"[^A-Za-z0-9_.-]+", "_", value)


def load_jsonl_requests(path: Path) -> dict[str, dict[str, Any]]:
    requests: dict[str, dict[str, Any]] = {}
    for line in path.read_text(encoding="utf-8").splitlines():
        if not line.strip():
            continue
        row = json.loads(line)
        custom_id = row.get("custom_id")
        if isinstance(custom_id, str):
            requests[custom_id] = row
    return requests


def load_manifest_items(path: Path, *, model_name: str | None = None) -> list[ManifestItem]:
    payload = json.loads(path.read_text(encoding="utf-8"))
    items = [ManifestItem(**item) for item in payload["items"]]
    if model_name is None:
        return items
    return [ManifestItem(**{**asdict(item), "model": model_name}) for item in items]


def write_codex_manifest(source_manifest_path: Path, output_path: Path, *, model_name: str) -> Path:
    payload = json.loads(source_manifest_path.read_text(encoding="utf-8"))
    payload["model"] = model_name
    payload["generator"] = "codex-headless"
    payload["items"] = [{**item, "model": model_name} for item in payload["items"]]
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(json.dumps(payload, indent=2), encoding="utf-8")
    return output_path


def prompt_from_request(row: dict[str, Any]) -> str:
    body = row.get("body") or {}
    inputs = body.get("input") or []
    system = str(inputs[0].get("content") or "") if len(inputs) > 0 else ""
    user = str(inputs[1].get("content") or "") if len(inputs) > 1 else ""
    return (
        system
        + "\n\nReturn only JSON matching the requested schema. Do not include markdown fences or explanatory text.\n\n"
        + user
    )


def write_schema(path: Path) -> Path:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(SUMMARY_SCHEMA, indent=2), encoding="utf-8")
    return path


def output_row(custom_id: str, content: dict[str, Any]) -> dict[str, Any]:
    return {
        "custom_id": custom_id,
        "response": {
            "status_code": 200,
            "body": {
                "output_text": json.dumps(content, ensure_ascii=False, separators=(",", ":")),
            },
        },
    }


def validate_summary_shape(content: dict[str, Any]) -> list[str]:
    errors: list[str] = []
    required = SUMMARY_SCHEMA["required"]
    properties = SUMMARY_SCHEMA["properties"]
    for key in required:
        if key not in content:
            errors.append(f"missing {key}")
    for key, spec in properties.items():
        if key not in content:
            continue
        expected_type = spec.get("type")
        if expected_type == "array" and not isinstance(content[key], list):
            errors.append(f"{key} must be an array")
        elif expected_type == "object" and not isinstance(content[key], dict):
            errors.append(f"{key} must be an object")
        elif expected_type == "string" and not isinstance(content[key], str):
            errors.append(f"{key} must be a string")
        elif expected_type == "boolean" and not isinstance(content[key], bool):
            errors.append(f"{key} must be a boolean")
        elif expected_type == "integer" and not isinstance(content[key], int):
            errors.append(f"{key} must be an integer")
    if content.get("confidence") not in {"low", "medium", "high"}:
        errors.append("confidence must be low, medium, or high")
    return errors


def combine_output_files(*, run_dir: Path, manifest_path: Path | None = None, output_path: Path | None = None) -> dict[str, Any]:
    manifest_path = manifest_path or next(run_dir.glob("*.codex.manifest.json"))
    output_path = output_path or run_dir / "combined.output.jsonl"
    expected = {item.custom_id for item in load_manifest_items(manifest_path)}
    seen: set[str] = set()
    failed: list[dict[str, Any]] = []

    with output_path.open("w", encoding="utf-8") as handle:
        for path in sorted((run_dir / "outputs").glob("*.jsonl")):
            try:
                row = json.loads(path.read_text(encoding="utf-8"))
                custom_id = row.get("custom_id")
                text = ((row.get("response") or {}).get("body") or {}).get("output_text")
                content = json.loads(text)
                errors = validate_summary_shape(content)
                if custom_id not in expected:
                    errors.append("custom_id not present in manifest")
                if errors:
                    failed.append({"path": str(path), "custom_id": custom_id, "errors": errors})
                    continue
                seen.add(custom_id)
                handle.write(json.dumps(row, ensure_ascii=False) + "\n")
            except Exception as exc:
                failed.append({"path": str(path), "error": type(exc).__name__, "message": str(exc)[:500]})

    missing = sorted(expected - seen)
    return {
        "run_dir": str(run_dir),
        "manifest_path": str(manifest_path),
        "output_path": str(output_path),
        "expected": len(expected),
        "combined": len(seen),
        "missing": len(missing),
        "failed": len(failed),
        "missing_sample": missing[:10],
        "failed_sample": failed[:10],
    }
