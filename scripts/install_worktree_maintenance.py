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
    repo: Path,
    state: Path,
    home: Path = Path.home(),
    activate: bool = True,
    project: str = "alethical",
    admitted_paths: tuple[Path, ...] = (),
    protected_paths: tuple[Path, ...] = (),
    install_codex_hooks: bool = False,
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
    with cleanup.locked(state, wait=True):
        return install_locked(
            repo,
            state,
            home,
            activate,
            project,
            admitted_paths,
            protected_paths,
            install_codex_hooks,
        )


def install_locked(
    repo: Path,
    state: Path,
    home: Path,
    activate: bool,
    project: str,
    admitted_paths: tuple[Path, ...],
    protected_paths: tuple[Path, ...],
    install_codex_hooks: bool,
) -> dict:
    cleanup.configure_project(project, repo, state)
    labels = tuple(
        f"com.{project}.{suffix}" for suffix in ("worktree-cleanup", "wip-backup")
    )
    plugin_name = f"{project}-worktree-maintenance"
    plugin = home / ".claude/skills" / plugin_name
    if plugin.exists():
        marker = plugin / ".claude-plugin/plugin.json"
        if not marker.is_file() or json_plugin_name(marker) != plugin_name:
            raise cleanup.CleanupError(
                "the maintenance plugin path belongs to other contents"
            )
    sources = Path(__file__).parent
    interpreter = durable_python(repo)
    names = ("worktree_cleanup.py", "worktree_backup.py", "worktree_inventory.py")
    data = {name: (sources / name).read_bytes() for name in names}
    digest = hashlib.sha256(
        b"".join(name.encode() + content for name, content in data.items())
    ).hexdigest()[:20]
    runtime = state / "runtime" / digest / "scripts"
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
    admitted = cleanup.ADMITTED_PATHS | {p.absolute() for p in admitted_paths}
    protected = cleanup.PROTECTED_PATHS | {p.absolute() for p in protected_paths}
    cleanup.ADMITTED_PATHS = admitted
    # Already removed historical admissions must not prevent runtime updates.
    # Every removal still rechecks exact Git identity before touching a folder.
    for path in {p.absolute() for p in (*admitted_paths, *protected_paths)}:
        record = cleanup.identity(repo, path, allow_retained=True)
        if cleanup.is_native(path) or Path(record["common"]) != common:
            raise cleanup.CleanupError(
                "external admission must belong to this repository outside Codex"
            )
    cleanup.PROTECTED_PATHS = protected
    backup_dir = home / f"Library/Application Support/{project}-wip-backups"
    result = {
        "runtime": str(runtime),
        "python": interpreter,
        "repository": str(shared),
        "project": project,
        "admitted_paths": sorted(str(p) for p in admitted),
        "protected_paths": sorted(str(p) for p in protected),
        "backup_directory": str(backup_dir),
        "labels": list(labels),
        "claude_plugin": str(plugin),
        "activated": False,
        "codex_hooks": "prepared; not installed",
    }
    # Persist protections under the same lock held by removal BEFORE RunAtLoad.
    # A failed/retried installation keeps these holds, never restores a looser scope.
    cleanup.write_json(state / "installation.json", result)
    for label in labels:
        backup = label.endswith(".wip-backup")
        program = [
            interpreter,
            str(runtime / ("worktree_backup.py" if backup else "worktree_cleanup.py")),
        ]
        if not backup:
            program += [
                "--project",
                project,
                "--repo",
                str(shared),
                "--state",
                str(state.resolve()),
                "sweep",
                "--apply",
            ]
        else:
            program += ["--repo", str(shared), "--destination", str(backup_dir)]
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
            "--project",
            project,
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
            "name": plugin_name,
            "version": "1.1.0",
            "description": f"Record {project} folder ownership and finish decisions",
        },
    )
    cleanup.write_json(plugin / "hooks/hooks.json", {"hooks": hooks})
    codex_hooks = {"hooks": hooks}
    cleanup.write_json(state / "codex-hooks.json", codex_hooks)
    if install_codex_hooks:
        # Only configuration is installed. Codex's native trust review stays required.
        merge_codex_hooks(home / ".codex/hooks.json", codex_hooks, project, state)
    result["activated"] = activate
    result["codex_hooks"] = (
        "installed; native trust review required"
        if install_codex_hooks
        else "prepared; not installed"
    )
    cleanup.write_json(state / "installation.json", result)
    return result


def merge_codex_hooks(path: Path, new: dict, project: str, state: Path) -> None:
    """Preserve unrelated hooks and keep rollback bytes; never set trust state."""
    import json

    target = path.resolve() if path.is_symlink() else path
    original = target.read_bytes() if target.exists() else None
    data = json.loads(original) if original is not None else {}
    if not isinstance(data, dict) or not isinstance(data.get("hooks", {}), dict):
        raise cleanup.CleanupError("Codex hooks have an unexpected shape")
    if original is not None:
        backup = (
            state
            / "previous-installations"
            / ("codex-hooks-" + hashlib.sha256(original).hexdigest()[:16] + ".json")
        )
        if not backup.exists():
            backup.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
            backup.write_bytes(original)
            backup.chmod(0o600)
    events = data.setdefault("hooks", {})
    marker = f"Working-folder ownership ({project})"
    for event, groups in new["hooks"].items():
        existing = events.get(event, [])
        if not isinstance(existing, list):
            raise cleanup.CleanupError("Codex hook event has an unexpected shape")
        kept = []
        for group in existing:
            handlers = [h for h in group["hooks"] if h.get("statusMessage") != marker]
            if handlers:
                kept.append({**group, "hooks": handlers})
        for group in groups:
            kept.append(
                {
                    **group,
                    "hooks": [{**h, "statusMessage": marker} for h in group["hooks"]],
                }
            )
        events[event] = kept
    if target.exists() and target.read_bytes() != original:
        raise cleanup.CleanupError("Codex hooks changed during installation; retry")
    cleanup.write_json(target, data)


def json_plugin_name(path: Path) -> str:
    import json

    return json.loads(path.read_text()).get("name", "")


if __name__ == "__main__":
    os.umask(0o077)
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--repo", type=Path, default=Path.cwd())
    parser.add_argument("--project", choices=cleanup.PROJECTS, default="alethical")
    parser.add_argument("--state", type=Path)
    parser.add_argument("--admit-external", type=Path, action="append", default=[])
    parser.add_argument("--protect", type=Path, action="append", default=[])
    parser.add_argument("--install-codex-hooks", action="store_true")
    args = parser.parse_args()
    try:
        print(
            install(
                args.repo,
                args.state or cleanup.default_state(args.project),
                project=args.project,
                admitted_paths=tuple(args.admit_external),
                protected_paths=tuple(args.protect),
                install_codex_hooks=args.install_codex_hooks,
            )
        )
    except (OSError, cleanup.CleanupError) as error:
        print(f"Installation held: {error}", file=sys.stderr)
        sys.exit(1)
