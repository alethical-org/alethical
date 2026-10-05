#!/usr/bin/env python3
"""Install free Mac cleanup retries and repaired backups outside removable trees."""

from __future__ import annotations

import argparse
import hashlib
import os
import plistlib
import shlex
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from scripts import worktree_cleanup as cleanup  # noqa: E402

LABELS = ("com.alethical.worktree-cleanup", "com.alethical.wip-backup")


def durable_python(repo: Path) -> str:
    roots = [Path(row["worktree"]) for row in cleanup.registrations(repo)]
    choices = [
        shutil.which("python3"),
        "/opt/homebrew/bin/python3",
        "/usr/local/bin/python3",
        "/usr/bin/python3",
        sys.executable,
    ]
    for candidate in dict.fromkeys(c for c in choices if c):
        executable = Path(candidate).absolute()
        if any(
            root == executable
            or root in executable.parents
            or root in executable.resolve().parents
            for root in roots
        ):
            continue
        if not executable.is_file():
            continue
        result = subprocess.run(
            [
                str(executable),
                "-c",
                "import sys; raise SystemExit(sys.version_info < (3, 10))",
            ],
            capture_output=True,
            check=False,
        )
        if result.returncode == 0:
            return str(executable)
    raise cleanup.CleanupError(
        "no supported Python exists outside removable working folders"
    )


def install(
    repo: Path, state: Path, home: Path = Path.home(), activate: bool = True
) -> dict:
    if activate and sys.platform != "darwin":
        raise cleanup.CleanupError("automatic installation is supported on macOS")
    storage = state.resolve()
    if state.is_symlink() or any(
        storage == Path(row["worktree"]).resolve()
        or Path(row["worktree"]).resolve() in storage.parents
        for row in cleanup.registrations(repo)
    ):
        raise cleanup.CleanupError(
            "maintenance storage must be outside every working folder"
        )
    plugin = home / ".claude/skills/alethical-worktree-maintenance"
    if plugin.exists():
        marker = plugin / ".claude-plugin/plugin.json"
        if (
            not marker.is_file()
            or json_plugin_name(marker) != "alethical-worktree-maintenance"
        ):
            raise cleanup.CleanupError(
                "the maintenance plugin path belongs to other contents"
            )
    sources = Path(__file__).parent
    interpreter = durable_python(repo)
    names = ("worktree_cleanup.py", "worktree_backup.py")
    data = {name: (sources / name).read_bytes() for name in names}
    digest = hashlib.sha256(
        b"".join(name.encode() + content for name, content in data.items())
    ).hexdigest()[:20]
    runtime = state / "runtime" / digest
    runtime.mkdir(parents=True, exist_ok=True, mode=0o700)
    for name, content in data.items():
        target = runtime / name
        if target.exists() and (target.is_symlink() or target.read_bytes() != content):
            raise cleanup.CleanupError("installed runtime has unexpected contents")
        if not target.exists():
            target.write_bytes(content)
        target.chmod(0o700)
    queue = state / "released"
    queue.mkdir(parents=True, exist_ok=True, mode=0o700)
    logs = home / "Library/Logs"
    logs.mkdir(parents=True, exist_ok=True)
    agents = home / "Library/LaunchAgents"
    agents.mkdir(parents=True, exist_ok=True)
    # Homebrew Git and GitHub CLI are needed when launchd starts without shell setup.
    executable_paths = [
        str(Path(shutil.which(tool) or tool).absolute().parent)
        for tool in ("git", "gh")
    ]
    search = ":".join(
        dict.fromkeys(
            [
                *executable_paths,
                "/opt/homebrew/bin",
                "/usr/local/bin",
                "/usr/bin",
                "/bin",
                "/usr/sbin",
                "/sbin",
            ]
        )
    )
    common = Path(
        cleanup.git(repo, "rev-parse", "--path-format=absolute", "--git-common-dir")
    ).resolve()
    shared = common.parent
    for label in LABELS:
        backup = label == "com.alethical.wip-backup"
        program = [
            interpreter,
            str(runtime / ("worktree_backup.py" if backup else "worktree_cleanup.py")),
        ]
        if not backup:
            program += [
                "--repo",
                str(shared),
                "--state",
                str(state.resolve()),
                "sweep",
                "--apply",
            ]
        payload = {
            "Label": label,
            "ProgramArguments": program,
            "EnvironmentVariables": {"PATH": search, "ALETHICAL_REPO": str(shared)},
            "StartInterval": 300 if backup else 86400,
            "RunAtLoad": True,
            "StandardOutPath": str(logs / (label + ".log")),
            "StandardErrorPath": str(logs / (label + ".errors.log")),
        }
        if not backup:
            payload["WatchPaths"] = [str(queue.resolve())]
        plist = agents / (label + ".plist")
        if plist.exists():
            previous = (
                state
                / "previous-installations"
                / (
                    label
                    + "-"
                    + hashlib.sha256(plist.read_bytes()).hexdigest()[:16]
                    + ".plist"
                )
            )
            previous.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
            if not previous.exists():
                previous.write_bytes(plist.read_bytes())
                previous.chmod(0o600)
        with tempfile.NamedTemporaryFile("wb", dir=agents, delete=False) as stream:
            temporary = Path(stream.name)
            plistlib.dump(payload, stream)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary, plist)
        if activate:
            domain = f"gui/{os.getuid()}"
            subprocess.run(
                ["launchctl", "bootout", f"{domain}/{label}"],
                capture_output=True,
                check=False,
            )
            cleanup.run(["launchctl", "bootstrap", domain, str(plist)])
            cleanup.run(["launchctl", "print", f"{domain}/{label}"])
    # Claude's installed skills-directory plugins load in future sessions. Keep
    # our own plugin separate instead of rewriting any existing global hooks.
    command = " ".join(
        shlex.quote(arg)
        for arg in [
            interpreter,
            str(runtime / "worktree_cleanup.py"),
            "--repo",
            str(shared),
            "--state",
            str(state.resolve()),
            "hook",
        ]
    )
    hooks = {
        event: [{"hooks": [{"type": "command", "command": command, "timeout": 30}]}]
        for event in ("SessionStart", "UserPromptSubmit", "Stop")
    }
    cleanup.write_json(
        plugin / ".claude-plugin/plugin.json",
        {
            "name": "alethical-worktree-maintenance",
            "version": "1.0.0",
            "description": "Keep finished Alethical external working folders from accumulating",
        },
    )
    cleanup.write_json(plugin / "hooks/hooks.json", {"hooks": hooks})
    result = {
        "runtime": str(runtime),
        "python": interpreter,
        "repository": str(shared),
        "labels": list(LABELS),
        "claude_plugin": str(plugin),
        "activated": activate,
    }
    cleanup.write_json(state / "installation.json", result)
    return result


def json_plugin_name(path: Path) -> str:
    import json

    return json.loads(path.read_text()).get("name", "")


if __name__ == "__main__":
    os.umask(0o077)
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--repo", type=Path, default=Path.cwd())
    parser.add_argument("--state", type=Path, default=cleanup.DEFAULT_STATE)
    args = parser.parse_args()
    try:
        print(install(args.repo, args.state))
    except (OSError, cleanup.CleanupError) as error:
        print(f"Installation held: {error}", file=sys.stderr)
        sys.exit(1)
