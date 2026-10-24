"""Preview or explicitly install private, versioned Alethical activity hooks.

Settings only describe configured hooks. Host review, reload and observed events
are required before relying on them. This installer never changes trust settings.
Rollback removes matching installed entries and restores replaced Alethical
entries, preserving unrelated settings added since installation.
"""

from __future__ import annotations

import argparse
import copy
import hashlib
import json
import os
import re
import shlex
import shutil
import subprocess
import sys
import tempfile
import uuid
from collections import Counter
from dataclasses import dataclass
from pathlib import Path

SOURCE_FILES = (
    "agent_job_events.py",
    "agent_job_outcomes.py",
    "check_agent_job_completion.py",
)
SHARED_EVENTS = (
    "SessionStart",
    "UserPromptSubmit",
    "PostToolUse",
    "SubagentStart",
    "SubagentStop",
    "Stop",
    "SessionEnd",
)
EVENTS = {
    "claude": SHARED_EVENTS + ("PostToolUseFailure", "StopFailure"),
    "codex": SHARED_EVENTS + ("Interrupt",),
}
SETTINGS = {"claude": ".claude/settings.json", "codex": ".codex/hooks.json"}


def encoded(value: object) -> bytes:
    return (json.dumps(value, indent=2, sort_keys=True) + "\n").encode()


def sha(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def private_dir(path: Path) -> None:
    if path.is_symlink():
        raise ValueError("private installation location is a symbolic link")
    path.mkdir(parents=True, mode=0o700, exist_ok=True)
    os.chmod(path, 0o700)


def private_runtime_tree(home: Path) -> None:
    """Do not follow a redirected parent into someone else's storage."""
    base = runtime_base(home)
    for path in (home / ".local", home / ".local/share", base):
        if path.is_symlink():
            raise ValueError("private runtime storage has a symbolic link parent")
    private_dir(base)


def atomic_write(path: Path, data: bytes, mode: int = 0o600) -> None:
    descriptor, name = tempfile.mkstemp(prefix=".alethical-jobs-", dir=path.parent)
    temporary = Path(name)
    try:
        with os.fdopen(descriptor, "wb") as handle:
            os.fchmod(handle.fileno(), mode)
            handle.write(data)
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temporary, path)
    finally:
        temporary.unlink(missing_ok=True)


def validate_config(value: object) -> dict:
    if not isinstance(value, dict) or not isinstance(value.get("hooks", {}), dict):
        raise ValueError("settings must contain a JSON object with an object of hooks")
    for groups in value.get("hooks", {}).values():
        if not isinstance(groups, list):
            raise ValueError("hook events must contain lists")
        for group in groups:
            if not isinstance(group, dict) or not isinstance(group.get("hooks"), list):
                raise ValueError("hook groups must contain lists of hooks")
            if any(not isinstance(hook, dict) for hook in group["hooks"]):
                raise ValueError("hook entries must be objects")
    return value


@dataclass
class Snapshot:
    logical: Path
    target: Path
    before: bytes | None
    value: dict
    identity: tuple | None

    @classmethod
    def read(cls, logical: Path) -> Snapshot:
        target = logical.resolve()
        if logical.is_symlink() and not target.is_file():
            raise ValueError("settings symbolic link has no regular file target")
        if target.exists() and not target.is_file():
            raise ValueError("settings path is not a regular file")
        before = target.read_bytes() if target.exists() else None
        try:
            value = validate_config(json.loads(before)) if before is not None else {}
        except (json.JSONDecodeError, UnicodeDecodeError) as error:
            raise ValueError("settings contain malformed JSON") from error
        stat = target.stat() if before is not None else None
        identity = (stat.st_ino, stat.st_mtime_ns, stat.st_size) if stat else None
        return cls(logical, target, before, value, identity)

    def unchanged(self) -> None:
        current = Snapshot.read(self.logical)
        if (current.target, current.before, current.identity) != (
            self.target,
            self.before,
            self.identity,
        ):
            raise ValueError("settings changed during preparation; preview again")


def runtime_base(home: Path) -> Path:
    return home / ".local/share/alethical-agent-jobs"


def stable_python(source_root: Path) -> Path:
    candidates = [Path("/opt/homebrew/bin/python3"), Path("/usr/local/bin/python3")]
    found = shutil.which("python3")
    if found:
        candidates.append(Path(found))
    candidates.append(Path("/usr/bin/python3"))
    for candidate in candidates:
        resolved = candidate.resolve()
        parts = resolved.parts
        if any(part in {".venv", ".cache", "tmp", "uv", "uv-python"} for part in parts):
            continue
        if resolved.is_relative_to(source_root) or not os.access(resolved, os.X_OK):
            continue
        # Keep the stable host entry point through a Homebrew Python upgrade.
        # The resolved target is used only to reject temporary interpreters.
        return candidate.absolute()
    raise ValueError("no stable host python3 found")


def source_version(root: Path, *, apply: bool) -> tuple[str, dict[str, bytes]]:
    def git(*args: str) -> bytes:
        result = subprocess.run(
            ["git", "-C", str(root), *args],
            capture_output=True,
            timeout=10,
            check=False,
        )
        if result.returncode:
            raise ValueError(
                "source must be a Git checkout with committed runtime files"
            )
        return result.stdout

    commit = git("rev-parse", "HEAD").decode().strip()
    if not re.fullmatch(r"[0-9a-f]{40,64}", commit):
        raise ValueError("invalid source commit")
    files = {}
    for name in SOURCE_FILES:
        path = root / "scripts" / name
        if path.is_symlink() or not path.is_file():
            raise ValueError("runtime source file is missing or a symbolic link")
        data = path.read_bytes()
        if apply:
            committed = git("show", f"{commit}:scripts/{name}")
            if data != committed or git(
                "status", "--porcelain", "--", f"scripts/{name}"
            ):
                raise ValueError(
                    "runtime source files are dirty; commit and merge before installing"
                )
            data = committed
        files[name] = data
    return commit, files


def own_hook(hook: dict, platform: str, home: Path) -> bool:
    if hook.get("type") != "command" or not isinstance(hook.get("command"), str):
        return False
    try:
        args = shlex.split(hook["command"])
    except ValueError:
        return False
    if len(args) != 10 or args[1] != "-I" or args[3] != "--state-dir":
        return False
    script = Path(args[2])
    return (
        Path(args[0]).is_absolute()
        and script.name == "agent_job_events.py"
        and script.parent.parent == runtime_base(home)
        and bool(re.fullmatch(r"[0-9a-f]{40,64}", script.parent.name))
        and Path(args[4]).is_absolute()
        and args[5:] == ["hook", "--platform", platform, "--installed-version", "1"]
    )


def strip_owned(groups: list, platform: str, home: Path) -> tuple[list, list]:
    kept, removed = [], []
    for group in groups:
        ours = [hook for hook in group["hooks"] if own_hook(hook, platform, home)]
        foreign = [
            hook for hook in group["hooks"] if not own_hook(hook, platform, home)
        ]
        if ours:
            removed.append(group | {"hooks": ours})
        if foreign or not ours:
            kept.append(group | {"hooks": foreign})
    return kept, removed


@dataclass
class Plan:
    home: Path
    state_dir: Path
    commit: str
    files: dict[str, bytes]
    python: Path
    snapshots: dict[str, Snapshot]
    after: dict[str, dict]
    changes: dict[str, dict]

    @property
    def version(self) -> Path:
        return runtime_base(self.home) / self.commit

    @property
    def manifest(self) -> dict:
        return {
            "protocol_version": 1,
            "source_commit": self.commit,
            "files": {name: sha(data) for name, data in self.files.items()},
        }


def prepare(
    home: Path, source_root: Path, state_dir: Path, *, apply: bool = False
) -> Plan:
    home, source_root, state_dir = (
        home.resolve(),
        source_root.resolve(),
        state_dir.resolve(),
    )
    commit, files = source_version(source_root, apply=apply)
    python = stable_python(source_root)
    snapshots, after, changes = {}, {}, {}
    for platform, relative in SETTINGS.items():
        snapshot = Snapshot.read(home / relative)
        snapshots[platform] = snapshot
        value = copy.deepcopy(snapshot.value)
        hooks = value.setdefault("hooks", {})
        changed = {}
        command = shlex.join(
            [
                str(python),
                "-I",
                str(runtime_base(home) / commit / SOURCE_FILES[0]),
                "--state-dir",
                str(state_dir),
                "hook",
                "--platform",
                platform,
                "--installed-version",
                "1",
            ]
        )
        for event in EVENTS[platform]:
            timeout = (
                3 if platform == "codex" and event in {"SessionEnd", "Interrupt"} else 5
            )
            entry = {"type": "command", "command": command, "timeout": timeout}
            groups = hooks.get(event, [])
            kept, previous = strip_owned(groups, platform, home)
            proposed = kept + [{"hooks": [entry]}]
            if groups != proposed:
                changed[event] = {
                    "installed": entry,
                    "previous": previous,
                    "event_existed": event in hooks,
                }
                hooks[event] = proposed
        after[platform], changes[platform] = value, changed
    return Plan(home, state_dir, commit, files, python, snapshots, after, changes)


def validate_runtime(version: Path, manifest: dict) -> None:
    if version.is_symlink() or not version.is_dir():
        raise ValueError("unsafe installed runtime directory")
    if set(item.name for item in version.iterdir()) != set(SOURCE_FILES) | {
        "manifest.json"
    }:
        raise ValueError("installed runtime contains unexpected files")
    expected = {
        **{name: None for name in SOURCE_FILES},
        "manifest.json": encoded(manifest),
    }
    for name, data in expected.items():
        path = version / name
        if path.is_symlink() or not path.is_file():
            raise ValueError("unsafe installed runtime file")
        actual = path.read_bytes()
        if (data is not None and actual != data) or (
            data is None and sha(actual) != manifest["files"][name]
        ):
            raise ValueError(
                "installed version has different bytes; refusing to replace it"
            )
        if path.stat().st_mode & 0o277:
            raise ValueError("installed runtime files must be private and read-only")
    if version.stat().st_mode & 0o277:
        raise ValueError("installed runtime directory must be private and read-only")


def install_runtime(plan: Plan) -> bool:
    base = runtime_base(plan.home)
    private_runtime_tree(plan.home)
    if plan.version.exists() or plan.version.is_symlink():
        validate_runtime(plan.version, plan.manifest)
        return False
    stage = Path(tempfile.mkdtemp(prefix=".stage-", dir=base))
    try:
        for name, data in plan.files.items():
            atomic_write(stage / name, data, 0o400)
        atomic_write(stage / "manifest.json", encoded(plan.manifest), 0o400)
        os.chmod(stage, 0o500)
        os.rename(stage, plan.version)
    finally:
        if stage.exists():
            os.chmod(stage, 0o700)
            shutil.rmtree(stage)
    return True


def apply_plan(plan: Plan) -> Path | None:
    for snapshot in plan.snapshots.values():
        snapshot.unchanged()
    created = install_runtime(plan)
    if not any(plan.changes.values()):
        return None
    records = runtime_base(plan.home) / "installation-records"
    private_dir(records)
    record_dir = records / uuid.uuid4().hex
    private_dir(record_dir)
    record = {
        "protocol_version": 1,
        "home": str(plan.home),
        "source_commit": plan.commit,
        "runtime_created": created,
        "manifest": plan.manifest,
        "hosts": {},
    }
    for platform, events in plan.changes.items():
        if not events:
            continue
        snapshot = plan.snapshots[platform]
        if snapshot.before is not None:
            atomic_write(record_dir / f"{platform}.before.json", snapshot.before)
        record["hosts"][platform] = {"target": str(snapshot.target), "events": events}
    record_path = record_dir / "rollback.json"
    atomic_write(record_path, encoded(record))
    # Recheck both hosts after preparing backups, before changing either host.
    for snapshot in plan.snapshots.values():
        snapshot.unchanged()
    written = []
    try:
        for platform, events in plan.changes.items():
            if not events:
                continue
            snapshot = plan.snapshots[platform]
            snapshot.unchanged()
            snapshot.target.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
            atomic_write(snapshot.target, encoded(plan.after[platform]))
            written.append(platform)
    except (OSError, ValueError):
        if written:
            rollback(plan.home, record_path, platforms=written, clean_runtime=False)
        raise
    return record_path


def rollback(
    home: Path,
    record_path: Path,
    *,
    platforms: list[str] | None = None,
    clean_runtime: bool = True,
) -> dict:
    home = home.resolve()
    records = runtime_base(home) / "installation-records"
    record_path = record_path.absolute()
    if (
        record_path.is_symlink()
        or record_path.resolve() != record_path
        or record_path.parent.parent != records
        or record_path.name != "rollback.json"
        or record_path.stat().st_mode & 0o077
    ):
        raise ValueError("rollback requires a private installation record")
    record = json.loads(record_path.read_bytes())
    if (
        record.get("home") != str(home)
        or record.get("protocol_version") != 1
        or not re.fullmatch(r"[0-9a-f]{40,64}", record.get("source_commit", ""))
    ):
        raise ValueError("rollback record does not match this home")
    for platform, details in record["hosts"].items():
        if platform not in SETTINGS:
            raise ValueError("rollback record contains an unknown host")
        for event, change in details["events"].items():
            validate_config({"hooks": {event: change["previous"]}})
            if (
                event not in EVENTS[platform]
                or not own_hook(change["installed"], platform, home)
                or any(
                    not own_hook(hook, platform, home)
                    for group in change["previous"]
                    for hook in group["hooks"]
                )
            ):
                raise ValueError("rollback record contains unrelated hook entries")
    snapshots, updates, changed = {}, {}, {}
    for platform, details in record["hosts"].items():
        if platforms is not None and platform not in platforms:
            continue
        snapshot = Snapshot.read(home / SETTINGS[platform])
        if str(snapshot.target) != details["target"]:
            raise ValueError("settings target changed since installation")
        value = copy.deepcopy(snapshot.value)
        hooks = value.get("hooks", {})
        restored = []
        for event, change in details["events"].items():
            groups, found = [], False
            for group in hooks.get(event, []):
                remaining = [
                    hook for hook in group["hooks"] if hook != change["installed"]
                ]
                if remaining != group["hooks"]:
                    found = True
                    if remaining:
                        groups.append(group | {"hooks": remaining})
                else:
                    groups.append(group)
            if found:
                groups.extend(change["previous"])
                if groups or change["event_existed"]:
                    hooks[event] = groups
                else:
                    hooks.pop(event, None)
                restored.append(event)
        if restored:
            snapshots[platform], updates[platform], changed[platform] = (
                snapshot,
                value,
                restored,
            )
    for snapshot in snapshots.values():
        snapshot.unchanged()
    for platform, value in updates.items():
        snapshots[platform].unchanged()
        atomic_write(snapshots[platform].target, encoded(value))
    if clean_runtime and record.get("runtime_created"):
        version = runtime_base(home) / record["source_commit"]
        # Remove only this exact, intact version, and only if neither host references it.
        referenced = any(
            str(version) in json.dumps(Snapshot.read(home / path).value)
            for path in SETTINGS.values()
        )
        # A newer installation's rollback may need this older runtime again.
        for other in records.glob("*/rollback.json"):
            if other == record_path:
                continue
            if other.is_symlink():
                referenced = True
                break
            try:
                previous = json.loads(other.read_bytes())
                prior_entries = [
                    change["previous"]
                    for host in previous["hosts"].values()
                    for change in host["events"].values()
                ]
                if str(version) in json.dumps(prior_entries):
                    referenced = True
            except (OSError, ValueError, KeyError, TypeError):
                referenced = True
        if version.exists() and not referenced:
            validate_runtime(version, record["manifest"])
            os.chmod(version, 0o700)
            shutil.rmtree(version)
    return {"restored_events": changed, "activity": "not established by settings"}


def health(home: Path, state_dir: Path) -> dict:
    home = home.resolve()
    result = {
        "hosts": {},
        "observed_host_events": {},
        "activity": "Configuration does not establish active or trusted hooks",
    }
    commands = {}
    for platform, relative in SETTINGS.items():
        snapshot = Snapshot.read(home / relative)
        events, versions = [], set()
        for event, groups in snapshot.value.get("hooks", {}).items():
            for group in groups:
                for hook in group["hooks"]:
                    if own_hook(hook, platform, home):
                        args = shlex.split(hook["command"])
                        version = Path(args[2]).parent
                        try:
                            manifest = json.loads(
                                (version / "manifest.json").read_bytes()
                            )
                            if manifest["source_commit"] != version.name:
                                raise ValueError("runtime manifest mismatch")
                            validate_runtime(version, manifest)
                            versions.add(version.name)
                            commands[version.name] = [
                                str(stable_python(home)),
                                "-I",
                                args[2],
                                "--state-dir",
                                str(state_dir.resolve()),
                                "status",
                            ]
                            events.append(event)
                        except (OSError, ValueError, KeyError):
                            versions.add("unsafe or missing runtime")
        result["hosts"][platform] = {
            "configured_events": sorted(set(events)),
            "versions": sorted(versions),
        }
    if commands:
        response = subprocess.run(
            commands[sorted(commands)[-1]], capture_output=True, timeout=5, check=False
        )
        try:
            status = json.loads(response.stdout) if not response.returncode else {}
            counts = {platform: Counter() for platform in SETTINGS}
            for job in status.get("jobs", []):
                for platform, events in job.get("host_events_by_platform", {}).items():
                    if platform in counts and isinstance(events, dict):
                        counts[platform].update(
                            {
                                event: count
                                for event, count in events.items()
                                if event in EVENTS[platform]
                                and type(count) is int
                                and count >= 0
                            }
                        )
            result["observed_host_events"] = {
                platform: dict(sorted(events.items()))
                for platform, events in counts.items()
            }
        except (ValueError, TypeError):
            pass
    return result


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--home", type=Path, default=Path.home())
    parser.add_argument(
        "--source-root", type=Path, default=Path(__file__).resolve().parents[1]
    )
    parser.add_argument("--state-dir", type=Path)
    action = parser.add_mutually_exclusive_group()
    action.add_argument("--apply", action="store_true")
    action.add_argument("--health", action="store_true")
    action.add_argument("--rollback", type=Path)
    args = parser.parse_args(argv)
    state_dir = args.state_dir or args.home / ".local/state/alethical-agent-jobs"
    try:
        if args.health:
            report = health(args.home, state_dir)
        elif args.rollback:
            report = rollback(args.home, args.rollback)
        else:
            plan = prepare(args.home, args.source_root, state_dir, apply=args.apply)
            record = apply_plan(plan) if args.apply else None
            report = {
                "mode": "configured, not established as active"
                if args.apply
                else "dry-run",
                "runtime_path": str(plan.version),
                "source_commit": plan.commit,
                "changes": {
                    platform: {
                        "path": str(plan.snapshots[platform].target),
                        "events": sorted(events),
                    }
                    for platform, events in plan.changes.items()
                    if events
                },
            }
            if record:
                report["rollback_record"] = str(record)
        print(json.dumps(report, indent=2, sort_keys=True))
        return 0
    except (OSError, ValueError, KeyError, subprocess.SubprocessError):
        print(
            "Installation operation refused; source, settings or private runtime need repair",
            file=sys.stderr,
        )
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
