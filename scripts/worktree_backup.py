#!/usr/bin/env python3
"""Private snapshots with collision-free names and verified external bundles.

The manifest records HEAD and separate staged and on-disk versions. Restore disk
files from snapshot, then `git read-tree <index_commit>` to restore staging.
Bundles can require origin/main history: clone origin/main, then fetch the bundle ref.
Never push these refs. Ignored files need a separate private archive. A periodic
backup is not proof that a live worktree can safely be deleted.
"""

from __future__ import annotations

import fcntl
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
from datetime import datetime, timezone


class BackupError(Exception):
    """Backup failed; do not expose Git's potentially private output."""


def git(root: Path, *args: str, index: Path | None = None, check: bool = True) -> bytes:
    env = {k: v for k, v in os.environ.items() if not k.startswith("GIT_")}
    env["GIT_OPTIONAL_LOCKS"] = "0"
    env["GIT_AUTHOR_NAME"] = env["GIT_COMMITTER_NAME"] = "Local work backup"
    env["GIT_AUTHOR_EMAIL"] = env["GIT_COMMITTER_EMAIL"] = "backup@localhost.invalid"
    if index is not None:
        env["GIT_INDEX_FILE"] = str(index)
    # Reads and temporary-index staging must not invoke a filesystem monitor hook.
    result = subprocess.run(
        ["git", "-c", "core.fsmonitor=false", "-C", str(root), *args],
        env=env,
        capture_output=True,
        check=False,
    )
    if result.returncode and check:
        raise BackupError(f"Git {args[0]} failed")
    return result.stdout if result.returncode == 0 else b""


def value(root: Path, *args: str, **kwargs) -> str:
    return git(root, *args, **kwargs).decode().strip()


def identity(root: Path) -> tuple[str, Path, Path]:
    actual = Path(value(root, "rev-parse", "--show-toplevel")).resolve()
    if actual != root.resolve():
        raise BackupError("registration resolves to a different worktree")
    git_dir = Path(value(root, "rev-parse", "--absolute-git-dir")).resolve()
    common = (root / value(root, "rev-parse", "--git-common-dir")).resolve()
    key = hashlib.sha256(os.fsencode(common) + b"\0" + os.fsencode(git_dir)).hexdigest()
    return key, git_dir, common


def atomic_json(path: Path, data: dict) -> None:
    with tempfile.NamedTemporaryFile(mode="w", dir=path.parent, delete=False) as file:
        temporary = Path(file.name)
        try:
            json.dump(data, file, indent=2)
            file.write("\n")
            file.flush()
            os.fsync(file.fileno())
        except BaseException:
            temporary.unlink(missing_ok=True)
            raise
    try:
        os.replace(temporary, path)
    finally:
        temporary.unlink(missing_ok=True)


def checksum(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as file:
        for block in iter(lambda: file.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def verify_pack(bundle: Path, common: Path) -> None:
    # `bundle verify` checks the header/prerequisites, not the pack checksum.
    # Import the actual pack into a disposable object store before replacement.
    with tempfile.TemporaryDirectory(prefix="backup-verify-") as temp:
        recovery = Path(temp)
        git(recovery, "init", "--bare", "-q")
        (recovery / "objects/info/alternates").write_text(
            str(common / "objects") + "\n"
        )
        git(recovery, "bundle", "unbundle", str(bundle))


def backup(root: Path, destination: Path, common: Path) -> bool:
    key, git_dir, actual_common = identity(root)
    if actual_common != common:
        raise BackupError("registration belongs to a different repository")
    status = git(root, "status", "--porcelain=v1", "-z", "--untracked-files=all")
    if not status:
        return False
    head = value(root, "rev-parse", "--verify", "HEAD")
    index_path = git_dir / "index"
    original_index = index_path.read_bytes()
    ref = f"refs/wip-backup/{key}"
    previous = value(root, "rev-parse", "--verify", ref, check=False)
    folder = destination / key
    if folder.is_symlink():
        raise BackupError("backup destination is a symbolic link")
    folder.mkdir(mode=0o700, exist_ok=True)
    folder.chmod(0o700)
    manifest_path = folder / "manifest.json"
    bundle = folder / "snapshot.bundle"
    with tempfile.TemporaryDirectory(prefix="worktree-backup-") as temp:
        index = Path(temp) / "index"
        index.write_bytes(original_index)
        staged_tree = value(root, "write-tree", index=index)
        index.unlink()
        git(root, "read-tree", staged_tree, index=index)
        git(root, "add", "--all", index=index)
        disk_tree = value(root, "write-tree", index=index)
    if (
        index_path.read_bytes() != original_index
        or value(root, "rev-parse", "HEAD") != head
        or git(root, "status", "--porcelain=v1", "-z", "--untracked-files=all")
        != status
    ):
        raise BackupError("worktree changed during backup; retry on the next run")
    manifest = {}
    if manifest_path.exists():
        manifest = json.loads(manifest_path.read_text())
    same = all(
        manifest.get(field) == expected
        for field, expected in {
            "version": 2,
            "head": head,
            "index_tree": staged_tree,
            "disk_tree": disk_tree,
            "snapshot": previous,
        }.items()
    )
    if same and bundle.is_file():
        try:
            git(root, "bundle", "verify", str(bundle))
            if value(
                root, "bundle", "list-heads", str(bundle), ref
            ) == f"{previous} {ref}" and checksum(bundle) == manifest.get(
                "bundle_sha256"
            ):
                return False
        except BackupError:
            pass
    if same:
        staged = manifest["index_commit"]
        snapshot = previous
    else:
        staged = value(
            root,
            "commit-tree",
            staged_tree,
            "-p",
            head,
            "-m",
            "Private staged work snapshot",
        )
        parents = ["-p", staged]
        if previous and previous != staged:
            parents.extend(["-p", previous])
        snapshot = value(
            root,
            "commit-tree",
            disk_tree,
            *parents,
            "-m",
            "Private on-disk work snapshot",
        )
        git(root, "update-ref", ref, snapshot, previous or "0" * len(snapshot))
    with tempfile.TemporaryDirectory(prefix=".bundle-", dir=folder) as temp:
        pending = Path(temp) / "snapshot.bundle"
        try:
            main = value(
                root,
                "rev-parse",
                "--verify",
                "refs/remotes/origin/main^{commit}",
                check=False,
            )
            # Feature refs can disappear after a squash merge. Only main is a
            # durable recovery prerequisite; keep feature history in the bundle.
            exclusions = ["--not", main] if main else []
            git(root, "bundle", "create", str(pending), ref, *exclusions)
        except BackupError:
            pending.unlink(missing_ok=True)
            git(root, "bundle", "create", str(pending), ref)
        pending.chmod(0o600)
        git(root, "bundle", "verify", str(pending))
        if (
            value(root, "bundle", "list-heads", str(pending), ref)
            != f"{snapshot} {ref}"
        ):
            raise BackupError("bundle does not contain the saved snapshot")
        verify_pack(pending, common)
        bundle_sha256 = checksum(pending)
        with pending.open("rb") as file:
            os.fsync(file.fileno())
        os.replace(pending, bundle)
    atomic_json(
        manifest_path,
        {
            "version": 2,
            "id": key,
            "worktree": str(root.resolve()),
            "git_dir": str(git_dir),
            "common_dir": str(common),
            "head": head,
            "index_tree": staged_tree,
            "disk_tree": disk_tree,
            "index_commit": staged,
            "snapshot": snapshot,
            "ref": ref,
            "bundle": str(bundle),
            "bundle_sha256": bundle_sha256,
            "saved_at": datetime.now(timezone.utc).isoformat(),
            "ignored_files_included": False,
        },
    )
    directory_fd = os.open(folder, os.O_RDONLY)
    try:
        os.fsync(directory_fd)
    finally:
        os.close(directory_fd)
    return True


def run(repo: Path, destination: Path) -> int:
    os.umask(0o077)
    if destination.is_symlink():
        raise BackupError("backup destination is a symbolic link")
    destination.mkdir(mode=0o700, parents=True, exist_ok=True)
    destination.chmod(0o700)
    with (destination / ".backup.lock").open("a") as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            return 0
        _, _, common = identity(repo)
        registrations = git(repo, "worktree", "list", "--porcelain", "-z")
        failures = 0
        seen = set()
        for field in registrations.split(b"\0"):
            if not field.startswith(b"worktree "):
                continue
            root = Path(os.fsdecode(field[9:]))
            if not root.is_dir() or root.resolve() in seen:
                continue
            seen.add(root.resolve())
            try:
                backup(root, destination, common)
            except (BackupError, OSError, ValueError, KeyError) as error:
                failures += 1
                print(
                    f"backup: {root}: {type(error).__name__}; backup incomplete",
                    file=sys.stderr,
                )
        return 1 if failures else 0


def main() -> int:
    repo = Path(os.environ.get("ALETHICAL_REPO", "/Users/eug/Code/Alethical"))
    destination = Path(
        os.environ.get(
            "ALETHICAL_WIP_BACKUP_DIR",
            str(Path.home() / "Library/Application Support/alethical-wip-backups"),
        )
    )
    try:
        return run(repo, destination)
    except (BackupError, OSError, ValueError) as error:
        print(f"backup: {type(error).__name__}; backup incomplete", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
