"""Tests for the advisory local setup check."""

from __future__ import annotations

import importlib.util
import json
import sys
from pathlib import Path


SCRIPT = Path(__file__).parents[2] / "scripts" / "check_local_env.py"
SPEC = importlib.util.spec_from_file_location("check_local_env", SCRIPT)
assert SPEC and SPEC.loader
check_local_env = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = check_local_env
SPEC.loader.exec_module(check_local_env)


def write_project(tmp_path: Path) -> None:
    (tmp_path / ".python-version").write_text("3.12.13\n")
    (tmp_path / "package.json").write_text(
        json.dumps({"packageManager": "pnpm@10.33.0"})
    )
    (tmp_path / "docker-compose.yml").write_text(
        "services:\n  frontend:\n    image: node:22-bookworm-slim\n"
    )


def runner_with(responses: dict[tuple[str, ...], tuple[int, str]]):
    calls: list[tuple[str, ...]] = []

    def runner(command: tuple[str, ...]):
        key = tuple(command)
        calls.append(key)
        response = responses.get(key)
        if response is None:
            return None
        return check_local_env.CommandResult(*response)

    return runner, calls


def healthy_responses() -> dict[tuple[str, ...], tuple[int, str]]:
    python = "/managed/python"
    return {
        ("docker", "--version"): (0, "Docker version 28.0.0"),
        ("docker", "compose", "version"): (0, "Docker Compose version v2.36.0"),
        ("uv", "--version"): (0, "uv 0.10.0"),
        ("just", "--version"): (0, "just 1.42.0"),
        ("node", "--version"): (0, "v22.16.0"),
        ("pnpm", "--version"): (0, "10.33.0"),
        ("uv", "python", "find"): (0, python),
        (python, "--version"): (0, "Python 3.12.13"),
    }


def test_reads_versions_from_the_project_files(tmp_path: Path) -> None:
    write_project(tmp_path)

    assert check_local_env.project_requirements(tmp_path) == (
        "3.12.13",
        "22",
        "10.33.0",
    )


def test_healthy_web_setup_reports_no_gaps_and_skips_phone_tools(
    tmp_path: Path,
) -> None:
    write_project(tmp_path)
    runner, calls = runner_with(healthy_responses())

    lines = check_local_env.doctor(tmp_path, runner=runner)

    report = "\n".join(lines)
    assert "[GAP]" not in report
    assert "Node 22.16.0" in report
    assert "Project Python 3.12.13 (selected by uv)" in report
    assert "Xcode is only needed for iPhone work." in report
    assert "Java is only needed for Android work." in report
    assert all(
        "install" not in command and "sync" not in command and "up" not in command
        for command in calls
    )


def test_broken_setup_reports_missing_and_wrong_versions_without_stopping(
    tmp_path: Path,
) -> None:
    write_project(tmp_path)
    responses = healthy_responses()
    responses.pop(("docker", "--version"))
    responses[("node", "--version")] = (0, "v21.9.0")
    responses[("pnpm", "--version")] = (0, "10.32.0")
    responses[("/managed/python", "--version")] = (0, "Python 3.12.12")
    runner, _ = runner_with(responses)

    report = "\n".join(check_local_env.doctor(tmp_path, runner=runner))

    assert "Docker is not installed." in report
    assert "Node is 21.9.0; this project needs 22." in report
    assert "pnpm is 10.32.0; this project needs 10.33.0." in report
    assert "Project Python is 3.12.12; this project needs 3.12.13." in report
    assert "This check only reports and always exits 0." in report


def test_ios_and_android_only_check_their_own_optional_tool(tmp_path: Path) -> None:
    write_project(tmp_path)
    ios = healthy_responses() | {("xcodebuild", "-version"): (0, "Xcode 17.0")}
    android = healthy_responses() | {
        ("java", "-version"): (0, "openjdk version 21.0.7")
    }

    ios_runner, ios_calls = runner_with(ios)
    android_runner, android_calls = runner_with(android)

    assert "[ok] Xcode 17.0" in "\n".join(
        check_local_env.doctor(tmp_path, "ios", ios_runner)
    )
    assert ("java", "-version") not in ios_calls
    assert "[ok] Java 21.0.7" in "\n".join(
        check_local_env.doctor(tmp_path, "android", android_runner)
    )
    assert ("xcodebuild", "-version") not in android_calls
