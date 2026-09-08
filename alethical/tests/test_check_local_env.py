"""Tests for the advisory local setup check."""

from __future__ import annotations

import importlib.util
import json
import subprocess
import sys
from pathlib import Path
from unittest.mock import patch


SCRIPT = Path(__file__).parents[2] / "scripts" / "check_local_env.py"
SPEC = importlib.util.spec_from_file_location("check_local_env", SCRIPT)
assert SPEC and SPEC.loader
check_local_env = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = check_local_env
SPEC.loader.exec_module(check_local_env)


def write_project(tmp_path: Path) -> Path:
    (tmp_path / ".python-version").write_text("3.12.13\n")
    (tmp_path / "package.json").write_text(
        json.dumps({"packageManager": "pnpm@10.33.0"})
    )
    (tmp_path / "docker-compose.yml").write_text(
        "services:\n  frontend:\n    image: node:22-bookworm-slim\n"
    )
    source = tmp_path / ".githooks"
    active = tmp_path / "active-hooks"
    source.mkdir()
    active.mkdir()
    for name in check_local_env.UPLOAD_HOOKS:
        contents = f"#!/bin/sh\n# {name} fixture\n"
        (source / name).write_text(contents)
        (active / name).write_text(contents)
        (active / name).chmod(0o755)
    return active


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


def healthy_responses(repo: Path) -> dict[tuple[str, ...], tuple[int, str]]:
    python = "/managed/python"
    active = repo / "active-hooks"
    host = "unix:///fixture/docker.sock"
    return {
        ("docker", "--version"): (0, "Docker version 28.0.0"),
        ("docker", "compose", "version"): (0, "Docker Compose version v2.36.0"),
        ("uv", "--version"): (0, "uv 0.10.0"),
        ("just", "--version"): (0, "just 1.42.0"),
        ("node", "--version"): (0, "v22.16.0"),
        ("pnpm", "--version"): (0, "10.33.0"),
        ("uv", "python", "find"): (0, python),
        (python, "--version"): (0, "Python 3.12.13"),
        **{
            (
                "git",
                "rev-parse",
                "--path-format=absolute",
                "--git-path",
                f"hooks/{name}",
            ): (0, str(active / name))
            for name in check_local_env.UPLOAD_HOOKS
        },
        ("docker", "context", "inspect"): (
            0,
            json.dumps([{"Endpoints": {"docker": {"Host": host}}}]),
        ),
        ("docker", "--host", host, "info", "--format", "{{json .ServerVersion}}"): (
            0,
            '"28.0.0"',
        ),
        (
            "docker",
            "--host",
            host,
            "image",
            "inspect",
            check_local_env.UPLOAD_DATABASE_IMAGE,
        ): (0, "[]"),
    }


def test_reads_versions_from_the_project_files(tmp_path: Path) -> None:
    write_project(tmp_path)

    assert check_local_env.project_requirements(tmp_path) == (
        "3.12.13",
        "22",
        "10.33.0",
    )


def test_docker_queries_use_the_same_safe_environment_as_upload_tests() -> None:
    completed = subprocess.CompletedProcess(
        ("docker", "context", "inspect"), 0, "[]", ""
    )
    with (
        patch.dict(
            check_local_env.os.environ,
            {
                "PATH": "/fixture/bin",
                "LANG": "en_US.UTF-8",
                "DOCKER_HOST": "ssh://remote.invalid",
                "DOCKER_CONTEXT": "remote",
                "DOCKER_CONFIG": "/private/docker-config",
                "DOCKER_TLS_VERIFY": "1",
                "DOCKER_CERT_PATH": "/private/docker-certs",
            },
            clear=True,
        ),
        patch.object(check_local_env.subprocess, "run", return_value=completed) as run,
    ):
        check_local_env.run(("docker", "context", "inspect"))

    env = run.call_args.kwargs["env"]
    assert "DOCKER_HOST" not in env
    assert "DOCKER_CONTEXT" not in env
    assert "DOCKER_CONFIG" not in env
    assert "DOCKER_TLS_VERIFY" not in env
    assert "DOCKER_CERT_PATH" not in env
    assert env == {"PATH": "/fixture/bin", "LANG": "en_US.UTF-8"}


def test_healthy_web_setup_reports_no_gaps_and_skips_phone_tools(
    tmp_path: Path,
) -> None:
    write_project(tmp_path)
    runner, calls = runner_with(healthy_responses(tmp_path))

    lines = check_local_env.doctor(tmp_path, runner=runner)

    report = "\n".join(lines)
    assert "[GAP]" not in report
    assert "Node 22.16.0" in report
    assert "Project Python 3.12.13 (selected by uv)" in report
    assert "Git pre-commit protection is active here" in report
    assert "Git pre-push protection is active here" in report
    assert "Local Docker service is ready for upload tests" in report
    assert "Saved upload-test image pgvector/pgvector:pg17 is ready" in report
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
    responses = healthy_responses(tmp_path)
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
    ios = healthy_responses(tmp_path) | {("xcodebuild", "-version"): (0, "Xcode 17.0")}
    android = healthy_responses(tmp_path) | {
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


def test_missing_or_outdated_hooks_are_reported_for_this_worktree(
    tmp_path: Path,
) -> None:
    active = write_project(tmp_path)
    (active / "pre-commit").unlink()
    (active / "pre-push").write_text("#!/bin/sh\n# old hook\n")
    runner, _ = runner_with(healthy_responses(tmp_path))

    report = "\n".join(check_local_env.doctor(tmp_path, runner=runner))

    assert "active pre-commit hook is missing, outdated, or not executable" in report
    assert "active pre-push hook is missing, outdated, or not executable" in report
    assert report.count("Run `just install-hooks` here.") == 2


def test_stopped_local_docker_service_is_reported_before_image_check(
    tmp_path: Path,
) -> None:
    write_project(tmp_path)
    responses = healthy_responses(tmp_path)
    host = "unix:///fixture/docker.sock"
    responses[
        ("docker", "--host", host, "info", "--format", "{{json .ServerVersion}}")
    ] = (
        1,
        "cannot connect",
    )
    runner, calls = runner_with(responses)

    report = "\n".join(check_local_env.doctor(tmp_path, runner=runner))

    assert "The local Docker service could not be reached." in report
    assert not any(command[-3:-1] == ("image", "inspect") for command in calls)


def test_remote_docker_connection_is_rejected_before_daemon_check(
    tmp_path: Path,
) -> None:
    write_project(tmp_path)
    responses = healthy_responses(tmp_path)
    responses[("docker", "context", "inspect")] = (
        0,
        json.dumps([{"Endpoints": {"docker": {"Host": "ssh://remote.invalid"}}}]),
    )
    runner, calls = runner_with(responses)

    report = "\n".join(check_local_env.doctor(tmp_path, runner=runner))

    assert "Docker points at another computer." in report
    assert not any("--host" in command for command in calls)


def test_missing_saved_database_image_is_reported_without_a_pull(
    tmp_path: Path,
) -> None:
    write_project(tmp_path)
    responses = healthy_responses(tmp_path)
    host = "unix:///fixture/docker.sock"
    responses[
        (
            "docker",
            "--host",
            host,
            "image",
            "inspect",
            check_local_env.UPLOAD_DATABASE_IMAGE,
        )
    ] = (1, "No such image")
    runner, calls = runner_with(responses)

    report = "\n".join(check_local_env.doctor(tmp_path, runner=runner))

    assert "saved pgvector/pgvector:pg17 database image is unavailable" in report
    assert "Run `docker compose pull db` to save it" in report
    assert "or fix local Docker access" in report
    assert not any("pull" in command for command in calls)
