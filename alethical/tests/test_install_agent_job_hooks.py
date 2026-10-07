"""Installation and rollback use synthetic Git repositories and private homes."""

from __future__ import annotations

import json
import os
import shlex
import subprocess
from pathlib import Path

import pytest

from scripts import install_agent_job_hooks as installer


def git(root: Path, *args: str) -> str:
    return subprocess.run(
        ["git", "-C", str(root), *args], capture_output=True, text=True, check=True
    ).stdout.strip()


@pytest.fixture
def installation(tmp_path):
    root = tmp_path / "source"
    (root / "scripts").mkdir(parents=True)
    for name in installer.SOURCE_FILES:
        (root / "scripts" / name).write_text("# Synthetic committed runtime\n")
    git(root, "init", "-q")
    git(root, "add", "scripts")
    git(
        root,
        "-c",
        "user.name=Synthetic",
        "-c",
        "user.email=synthetic@example.invalid",
        "commit",
        "-qm",
        "Synthetic runtime",
    )
    home = tmp_path / "home"
    home.mkdir()
    return home, root, home / "private-state"


def config(home: Path, platform: str, value: dict) -> Path:
    path = home / installer.SETTINGS[platform]
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value))
    return path


def read(path: Path) -> dict:
    return json.loads(path.read_text())


def test_default_preview_never_writes_or_prints_existing_private_settings(
    installation, capsys
):
    home, root, _ = installation
    path = config(home, "claude", {"private-token": "synthetic-secret", "hooks": {}})
    before = path.read_bytes()
    assert installer.main(["--home", str(home), "--source-root", str(root)]) == 0
    output = capsys.readouterr().out
    assert "synthetic-secret" not in output
    assert "dry-run" in output
    assert path.read_bytes() == before
    assert not installer.runtime_base(home).exists()
    assert not (home / installer.SETTINGS["codex"]).exists()


def test_preserves_unknown_settings_permissions_groups_and_platform_event_differences(
    installation,
):
    home, root, state = installation
    foreign = {
        "matcher": "Bash",
        "unknown": {"keep": True},
        "hooks": [{"type": "command", "command": "echo synthetic"}],
    }
    original = {
        "permissions": {"deny": ["keep-this"]},
        "unknown": [1, 2],
        "hooks": {"PostToolUse": [foreign], "PreToolUse": [foreign]},
    }
    path = config(home, "claude", original)
    plan = installer.prepare(home, root, state, apply=True)
    record = installer.apply_plan(plan)
    current = read(path)
    assert current["permissions"] == original["permissions"]
    assert current["unknown"] == original["unknown"]
    assert current["hooks"]["PostToolUse"][0] == foreign
    assert current["hooks"]["PreToolUse"] == [foreign]
    assert "Interrupt" not in current["hooks"]
    codex = read(home / installer.SETTINGS["codex"])
    assert "Interrupt" in codex["hooks"]
    assert "PostToolUseFailure" not in codex["hooks"]
    assert "StopFailure" not in codex["hooks"]
    assert "trusted" not in json.dumps(codex)
    assert record.stat().st_mode & 0o777 == 0o600
    assert (record.parent / "claude.before.json").stat().st_mode & 0o777 == 0o600
    assert record.parent.stat().st_mode & 0o777 == 0o700
    for platform, events in installer.EVENTS.items():
        value = read(home / installer.SETTINGS[platform])
        for event in events:
            hook = value["hooks"][event][-1]["hooks"][0]
            args = shlex.split(hook["command"])
            assert Path(args[0]).is_absolute()
            assert args[1] == "-I"
            assert Path(args[2]).parent == plan.version
            assert args[3:] == [
                "--state-dir",
                str(state),
                "hook",
                "--platform",
                platform,
                "--installed-version",
                "1",
            ]
            assert installer.own_hook(hook, platform, home)


def test_installed_runtime_is_versioned_private_readonly_and_idempotent(installation):
    home, root, state = installation
    plan = installer.prepare(home, root, state, apply=True)
    installer.apply_plan(plan)
    assert plan.version.name == git(root, "rev-parse", "HEAD")
    assert plan.version.stat().st_mode & 0o777 == 0o500
    manifest = read(plan.version / "manifest.json")
    assert manifest == plan.manifest
    for name in (*installer.SOURCE_FILES, "manifest.json"):
        assert (plan.version / name).stat().st_mode & 0o777 == 0o400
    paths = [home / relative for relative in installer.SETTINGS.values()]
    before = [path.read_bytes() for path in paths]
    repeat = installer.prepare(home, root, state, apply=True)
    assert not any(repeat.changes.values())
    assert installer.apply_plan(repeat) is None
    assert [path.read_bytes() for path in paths] == before


def test_config_changed_between_prepare_and_apply_is_not_overwritten(installation):
    home, root, state = installation
    path = config(home, "codex", {"hooks": {}, "keep": "old"})
    plan = installer.prepare(home, root, state, apply=True)
    changed = {"hooks": {}, "keep": "changed-by-another-task"}
    path.write_text(json.dumps(changed))
    with pytest.raises(ValueError, match="changed during preparation"):
        installer.apply_plan(plan)
    assert read(path) == changed
    assert not installer.runtime_base(home).exists()


def test_config_changed_while_preparing_backups_is_not_overwritten(
    installation, monkeypatch
):
    home, root, state = installation
    path = config(home, "codex", {"hooks": {}})
    plan = installer.prepare(home, root, state, apply=True)
    real_write = installer.atomic_write

    def changed_during_backup(target, data, mode=0o600):
        real_write(target, data, mode)
        if target.name == "rollback.json":
            path.write_text('{"hooks":{},"another_task":true}')

    monkeypatch.setattr(installer, "atomic_write", changed_during_backup)
    with pytest.raises(ValueError, match="changed during preparation"):
        installer.apply_plan(plan)
    assert read(path)["another_task"] is True
    assert not (home / installer.SETTINGS["claude"]).exists()


def test_symlink_settings_write_resolved_target_and_keep_link(installation):
    home, root, state = installation
    target = home / "shared-settings.json"
    target.write_text('{"unknown": true}')
    link = home / installer.SETTINGS["claude"]
    link.parent.mkdir()
    link.symlink_to(target)
    record = installer.apply_plan(installer.prepare(home, root, state, apply=True))
    assert link.is_symlink()
    assert read(target)["unknown"] is True
    installer.rollback(home, record)
    assert link.is_symlink()
    assert read(target)["unknown"] is True
    assert not read(target)["hooks"]


@pytest.mark.parametrize(
    "value", ["{", "[]", '{"hooks": []}', '{"hooks":{"Stop":[{"hooks":"bad"}]}}']
)
def test_malformed_settings_fail_before_any_write(installation, value):
    home, root, state = installation
    path = config(home, "claude", {})
    path.write_text(value)
    with pytest.raises(ValueError):
        installer.prepare(home, root, state, apply=True)
    assert path.read_text() == value
    assert not installer.runtime_base(home).exists()


@pytest.mark.parametrize("staged", [False, True])
def test_dirty_runtime_sources_cannot_be_installed(installation, staged):
    home, root, state = installation
    path = root / "scripts" / installer.SOURCE_FILES[0]
    path.write_text("# Uncommitted replacement\n")
    if staged:
        git(root, "add", str(path))
    installer.prepare(home, root, state)  # Preview is allowed.
    with pytest.raises(ValueError, match="dirty"):
        installer.prepare(home, root, state, apply=True)
    assert not installer.runtime_base(home).exists()


def test_runtime_byte_mismatch_is_refused_without_repairing_it(installation):
    home, root, state = installation
    plan = installer.prepare(home, root, state, apply=True)
    installer.apply_plan(plan)
    source = plan.version / installer.SOURCE_FILES[0]
    os.chmod(source, 0o600)
    source.write_text("# Different runtime\n")
    os.chmod(source, 0o400)
    with pytest.raises(ValueError, match="different bytes"):
        installer.apply_plan(installer.prepare(home, root, state, apply=True))
    assert source.read_text() == "# Different runtime\n"


def test_rollback_preserves_later_foreign_settings_groups_and_same_group_hooks(
    installation,
):
    home, root, state = installation
    plan = installer.prepare(home, root, state, apply=True)
    record = installer.apply_plan(plan)
    path = home / installer.SETTINGS["claude"]
    later = read(path)
    foreign = {"type": "command", "command": "echo later"}
    later["permissions"] = {"allow": ["another-task"]}
    later["hooks"]["Stop"][0]["hooks"].append(foreign)
    later["hooks"]["Stop"].append({"matcher": "new", "hooks": [foreign]})
    later["hooks"]["UnrelatedEvent"] = [{"hooks": [foreign]}]
    path.write_text(json.dumps(later))
    installer.rollback(home, record)
    current = read(path)
    assert current["permissions"] == later["permissions"]
    assert current["hooks"]["Stop"] == [
        {"hooks": [foreign]},
        {"matcher": "new", "hooks": [foreign]},
    ]
    assert current["hooks"]["UnrelatedEvent"] == later["hooks"]["UnrelatedEvent"]
    assert not plan.version.exists()
    installer.rollback(
        home, record
    )  # Repeating rollback does not duplicate prior entries.
    assert read(path) == current


def test_rollback_restores_prior_owned_hooks_but_keeps_newer_installation(installation):
    home, root, state = installation
    first = installer.prepare(home, root, state, apply=True)
    first_record = installer.apply_plan(first)
    source = root / "scripts" / installer.SOURCE_FILES[0]
    source.write_text("# Second committed version\n")
    git(root, "add", str(source))
    git(
        root,
        "-c",
        "user.name=Synthetic",
        "-c",
        "user.email=synthetic@example.invalid",
        "commit",
        "-qm",
        "Second synthetic runtime",
    )
    second = installer.prepare(home, root, state, apply=True)
    second_record = installer.apply_plan(second)
    path = home / installer.SETTINGS["claude"]
    new_bytes = path.read_bytes()
    installer.rollback(home, first_record)
    assert path.read_bytes() == new_bytes
    assert first.version.exists()  # The newer rollback can still restore this runtime.
    installer.rollback(home, second_record)
    command = read(path)["hooks"]["Stop"][0]["hooks"][0]["command"]
    assert str(first.version) in command


def test_health_does_not_claim_configured_hooks_are_active(installation):
    home, root, state = installation
    installer.apply_plan(installer.prepare(home, root, state, apply=True))
    report = installer.health(home, state)
    assert "does not establish active or trusted" in report["activity"]
    assert report["observed_host_events"] == {}
    assert report["hosts"]["claude"]["configured_events"]


def test_rollback_refuses_external_record(installation, tmp_path):
    home, _, _ = installation
    path = tmp_path / "outside.json"
    path.write_text("{}")
    with pytest.raises(ValueError, match="private installation record"):
        installer.rollback(home, path)


def test_real_installed_runtime_ignores_hostile_worktree_and_pythonpath(
    installation, tmp_path
):
    home, root, state = installation
    actual_scripts = Path(installer.__file__).parent
    for name in ("agent_job_events.py", "agent_job_outcomes.py"):
        (root / "scripts" / name).write_bytes((actual_scripts / name).read_bytes())
    git(root, "add", "scripts")
    git(
        root,
        "-c",
        "user.name=Synthetic",
        "-c",
        "user.email=synthetic@example.invalid",
        "commit",
        "-qm",
        "Actual runtime in synthetic repository",
    )
    plan = installer.prepare(home, root, state, apply=True)
    installer.apply_plan(plan)
    hostile = tmp_path / "hostile-worktree"
    (hostile / "scripts").mkdir(parents=True)
    marker = hostile / "wrong-code-ran"
    trap = f"from pathlib import Path\nPath({str(marker)!r}).touch()\nraise RuntimeError('hostile code')\n"
    for relative in ("scripts/__init__.py", "agent_job_outcomes.py", "hashlib.py"):
        (hostile / relative).write_text(trap)
    env = os.environ | {"PYTHONPATH": str(hostile)}
    prefix = [
        str(plan.python),
        "-I",
        str(plan.version / "agent_job_events.py"),
        "--state-dir",
        str(state),
    ]
    begin = subprocess.run(
        prefix
        + [
            "begin",
            "--job-id",
            "synthetic-isolation",
            "--title",
            "Synthetic isolation",
            "--platform",
            "codex",
            "--session-id",
            "synthetic-session",
            "--repo-root",
            str(root),
        ],
        cwd=hostile,
        env=env,
        capture_output=True,
        text=True,
    )
    assert begin.returncode == 0, begin.stderr
    configured = read(home / installer.SETTINGS["codex"])["hooks"]["Stop"][0]["hooks"][
        0
    ]
    event = subprocess.run(
        shlex.split(configured["command"]),
        cwd=hostile,
        env=env,
        input=json.dumps(
            {"hook_event_name": "Stop", "session_id": "synthetic-session"}
        ),
        capture_output=True,
        text=True,
    )
    assert event.returncode == 0, event.stderr
    assert not marker.exists()
    report = installer.health(home, state)
    assert report["observed_host_events"] == {"claude": {}, "codex": {"Stop": 1}}
    assert "does not establish active or trusted" in report["activity"]


def test_runtime_storage_rejects_symlink_parents(installation, tmp_path):
    home, root, state = installation
    outside = tmp_path / "outside-runtime"
    outside.mkdir()
    (home / ".local").symlink_to(outside, target_is_directory=True)
    plan = installer.prepare(home, root, state, apply=True)
    with pytest.raises(ValueError, match="symbolic link parent"):
        installer.apply_plan(plan)
    assert not list(outside.iterdir())


def test_rollback_rejects_unrelated_entries_even_in_private_record(installation):
    home, root, state = installation
    record_path = installer.apply_plan(installer.prepare(home, root, state, apply=True))
    record = read(record_path)
    record["hosts"]["claude"]["events"]["Stop"]["previous"] = [
        {"hooks": [{"type": "command", "command": "echo should-not-be-restored"}]}
    ]
    record_path.write_text(json.dumps(record))
    with pytest.raises(ValueError, match="unrelated hook entries"):
        installer.rollback(home, record_path)


def test_codex_exit_hooks_use_supported_short_timeout(installation):
    home, root, state = installation
    plan = installer.prepare(home, root, state)
    for event in ("SessionEnd", "Interrupt"):
        assert plan.after["codex"]["hooks"][event][-1]["hooks"][0]["timeout"] == 3
    assert plan.after["codex"]["hooks"]["Stop"][-1]["hooks"][0]["timeout"] == 5
