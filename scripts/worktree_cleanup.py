#!/usr/bin/env python3
"""Remove explicitly released external worktrees, with private recovery copies.

Merging, age, silence and an absent process are never release signals. The owning
task calls release after delivery/acceptance and after giving up every preview.
The scheduler retries those receipts and removes empty external container shells.
Codex-managed trees stay with Codex.
"""

from __future__ import annotations

import argparse
import fcntl
import hashlib
import json
import os
import shlex
import shutil
import stat
import subprocess
import sys
import tarfile
import tempfile
import uuid
from contextlib import contextmanager, nullcontext
from datetime import datetime, timezone
from pathlib import Path

# Preserve the repository package layout in the durable installed runtime too.
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

DEFAULT_STATE = (
    Path.home() / "Library/Application Support/alethical-worktree-maintenance"
)
PROJECT = "alethical"
ADMITTED_PATHS: set[Path] = set()
PROTECTED_PATHS: set[Path] = set()
PROJECTS = ("alethical", "commercialdeals")


def default_state(project: str) -> Path:
    return Path.home() / f"Library/Application Support/{project}-worktree-maintenance"


def configure_project(project: str, repo: Path, state: Path) -> None:
    """Load explicit installation scope; never discover deletion rights from names."""
    global PROJECT, ADMITTED_PATHS, PROTECTED_PATHS
    if project not in PROJECTS:
        raise CleanupError("unknown maintenance project")
    PROJECT = project
    ADMITTED_PATHS, PROTECTED_PATHS = set(), set()
    installed = state / "installation.json"
    if installed.exists():
        config = json.loads(installed.read_text())
        shared = (
            Path(git(repo, "rev-parse", "--path-format=absolute", "--git-common-dir"))
            .resolve()
            .parent
        )
        if (
            config.get("project", "alethical") != project
            or Path(config["repository"]) != shared
        ):
            raise CleanupError("maintenance storage belongs to a different project")
        ADMITTED_PATHS = {Path(p) for p in config.get("admitted_paths", [])}
        PROTECTED_PATHS = {Path(p) for p in config.get("protected_paths", [])}


def is_native(path: Path) -> bool:
    homes = {
        Path.home() / ".codex",
        Path(os.environ.get("CODEX_HOME", str(Path.home() / ".codex"))),
    }
    return any(home.resolve() / "worktrees" in path.parents for home in homes)


REPLACEABLE = {
    "node_modules",
    ".venv",
    "__pycache__",
    ".pytest_cache",
    ".ruff_cache",
    ".expo",
}


class CleanupError(Exception):
    """A failed safety check keeps the working folder intact."""


def run(args: list[str], root: Path | None = None, check: bool = True) -> str:
    env = {k: v for k, v in os.environ.items() if not k.startswith("GIT_")}
    env["GIT_OPTIONAL_LOCKS"] = "0"
    # Even status/ls-files can execute a user-configured filesystem monitor.
    # Disable it centrally, including raw -z reads that must preserve whitespace.
    command = (
        [args[0], "-c", "core.fsmonitor=false", *args[1:]]
        if Path(args[0]).name == "git"
        else args
    )
    result = subprocess.run(command, cwd=root, env=env, capture_output=True, text=True)
    if check and result.returncode:
        # Git can print private filenames/settings. Keep command output local.
        raise CleanupError(f"{args[0]} {args[1]} failed ({result.returncode})")
    return result.stdout if result.returncode == 0 else ""


def git(root: Path, *args: str) -> str:
    return run(["git", *args], root).strip()


def now() -> str:
    return datetime.now(timezone.utc).isoformat()


def write_json(path: Path, value: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    with tempfile.NamedTemporaryFile("w", dir=path.parent, delete=False) as stream:
        temporary = Path(stream.name)
        try:
            json.dump(value, stream, indent=2)
            stream.write("\n")
            stream.flush()
            os.fsync(stream.fileno())
        except BaseException:
            temporary.unlink(missing_ok=True)
            raise
    os.replace(temporary, path)


@contextmanager
def locked(state: Path, wait: bool = False):
    state.mkdir(parents=True, exist_ok=True, mode=0o700)
    with (state / "cleanup.lock").open("a") as stream:
        fcntl.flock(stream, fcntl.LOCK_EX | (0 if wait else fcntl.LOCK_NB))
        yield


def registrations(repo: Path) -> list[dict]:
    # -z preserves whitespace/newlines in paths and lock reasons.
    raw = run(["git", "worktree", "list", "--porcelain", "-z"], repo)
    records = []
    for block in raw.split("\0\0"):
        record = {}
        for line in block.split("\0"):
            if line:
                key, _, value = line.partition(" ")
                record[key] = value
        if record:
            records.append(record)
    return records


def check_scope(repo: Path, path: Path, *, allow_retained: bool = False) -> Path:
    common = Path(
        git(repo, "rev-parse", "--path-format=absolute", "--git-common-dir")
    ).resolve()
    shared = common.parent
    if path == shared or path == common or common in path.parents:
        raise CleanupError("the shared checkout and its Git storage must stay")
    # Native managed state must be changed through the owning app, not Git.
    if is_native(path):
        if allow_retained:
            return common
        raise CleanupError("Codex owns this folder; use its supported archive action")
    if not allow_retained and any(
        path == p or p in path.parents or path in p.parents for p in PROTECTED_PATHS
    ):
        raise CleanupError("this folder has an installation-level preview or work hold")
    prefix = "alethical-wt-" if PROJECT == "alethical" else "CommercialDeals-worktrees"
    allowed = (
        (
            PROJECT == "alethical"
            and path.parent == shared.parent
            and path.name.startswith(prefix)
        )
        or shared / ".claude/worktrees" in path.parents
        or any(
            (
                parent.name.startswith(prefix)
                if PROJECT == "alethical"
                else parent.name == prefix
            )
            and parent.parent == shared.parent
            for parent in path.parents
        )
        or path in ADMITTED_PATHS
    )
    if not allowed:
        raise CleanupError(
            "working folder is outside this project's admitted cleanup scope"
        )
    if path.is_symlink() or path != path.resolve():
        raise CleanupError("working folder has a different real path")
    return common


def identity(repo: Path, path: Path, *, allow_retained: bool = False) -> dict:
    if path.is_symlink() or not path.is_dir() or path != path.resolve():
        raise CleanupError("working folder is missing or has a different real path")
    common = check_scope(repo, path, allow_retained=allow_retained)
    matches = [r for r in registrations(repo) if r.get("worktree") == str(path)]
    if len(matches) != 1:
        raise CleanupError("working folder has a missing or duplicate Git registration")
    row = matches[0]
    if Path(git(path, "rev-parse", "--show-toplevel")).resolve() != path:
        raise CleanupError("Git identifies a different working folder")
    if (
        Path(
            git(path, "rev-parse", "--path-format=absolute", "--git-common-dir")
        ).resolve()
        != common
    ):
        raise CleanupError("working folder belongs to a different repository")
    gitdir = Path(git(path, "rev-parse", "--absolute-git-dir")).resolve()
    backlink = gitdir / "gitdir"
    if (
        not backlink.is_file()
        or Path(backlink.read_text().strip()).resolve() != path / ".git"
    ):
        raise CleanupError("Git's registration points at a different folder")
    head = git(path, "rev-parse", "HEAD")
    branch = run(["git", "symbolic-ref", "-q", "HEAD"], path, check=False).strip()
    if head != row.get("HEAD") or branch != row.get("branch", ""):
        raise CleanupError("Git's registration differs from the live checkout")
    key = hashlib.sha256(
        os.fsencode(common) + b"\0" + os.fsencode(gitdir) + b"\0" + os.fsencode(path)
    ).hexdigest()
    return {
        "id": key,
        "path": str(path),
        "common": str(common),
        "gitdir": str(gitdir),
        "head": head,
        "branch": branch,
        "lock": row.get("locked"),
    }


def is_ancestor(repo: Path, head: str, target: str) -> bool:
    # Invalid or unavailable objects make rev-list fail closed.
    return git(repo, "rev-list", "--count", f"{target}..{head}") == "0"


def landing_proof(repo: Path, record: dict) -> dict:
    branch = record["branch"].removeprefix("refs/heads/")
    prs = []
    if branch:
        prs = json.loads(
            run(
                [
                    "gh",
                    "pr",
                    "list",
                    "--state",
                    "all",
                    "--head",
                    branch,
                    "--limit",
                    "100",
                    "--json",
                    "number,state,headRefOid,mergeCommit,url",
                ],
                repo,
            )
        )
        if any(pr["state"] == "OPEN" for pr in prs) or len(prs) == 100:
            raise CleanupError(
                "an open change or incomplete change list holds this folder"
            )
    if is_ancestor(repo, record["head"], "origin/main"):
        return {
            "kind": "reachable from main",
            "main": git(repo, "rev-parse", "origin/main"),
        }
    for pr in prs:
        if pr["state"] != "MERGED" or pr["headRefOid"] != record["head"]:
            continue
        merged = pr.get("mergeCommit") or {}
        if merged.get("oid") and is_ancestor(repo, merged["oid"], "origin/main"):
            return {
                "kind": "exact merged change",
                "url": pr["url"],
                "merge": merged["oid"],
            }
    raise CleanupError("this exact saved version is not proven merged")


def process_paths() -> list[str]:
    executable = shutil.which("lsof")
    if executable is None:
        raise CleanupError("cannot inspect folders held open by other programs")
    result = subprocess.run([executable, "-nP", "-Fpn"], capture_output=True, text=True)
    if result.returncode not in (0, 1):
        raise CleanupError("open-file inspection failed")
    paths = [
        os.path.realpath(line[1:].removesuffix(" (deleted)"))
        for line in result.stdout.splitlines()
        if line.startswith("n/")
    ]
    if not paths:
        raise CleanupError("open-file inspection returned no usable inventory")
    return paths


def disposable(relative: str) -> bool:
    return (
        bool(REPLACEABLE.intersection(Path(relative).parts))
        or relative == ".DS_Store"
        or relative.endswith("/.DS_Store")
        or relative == "apps/frontend/dist"
        or relative.startswith("apps/frontend/dist/")
    )


def checksum(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()


def private_files(path: Path) -> list[dict]:
    raw = run(
        [
            "git",
            "ls-files",
            "--others",
            "--ignored",
            "--exclude-standard",
            "--directory",
            "-z",
        ],
        path,
    )
    rows = []
    seen = set()

    def visit(relative: str):
        if relative in seen or disposable(relative):
            return
        seen.add(relative)
        file = path / relative
        if file.is_symlink():
            target = file.resolve()
            if target.is_dir() or (target.exists() and not target.is_file()):
                raise CleanupError("an ignored link needs separate preservation")
            rows.append(
                {
                    "path": relative,
                    "type": "link",
                    "target": os.readlink(file),
                    "target_hash": checksum(target) if target.is_file() else None,
                }
            )
        elif file.is_file():
            rows.append({"path": relative, "type": "file", "hash": checksum(file)})
        elif file.is_dir():
            rows.append({"path": relative, "type": "dir"})
            for child in sorted(file.iterdir()):
                visit(str(child.relative_to(path)))
        else:
            raise CleanupError("an ignored file has an unsupported type")

    for item in sorted(raw.split("\0")):
        if item:
            visit(item.rstrip("/"))
    return rows


def eligible(repo: Path, receipt: dict, open_paths: list[str]) -> dict:
    path = Path(receipt["path"])
    current = identity(repo, path)
    for key in ("id", "common", "gitdir", "head", "branch"):
        if current[key] != receipt[key]:
            raise CleanupError("working folder changed after its owner released it")
    if (
        receipt.get("status") not in ("released", "removing")
        or not receipt.get("evidence")
        or not receipt.get("owner")
    ):
        raise CleanupError("the owning task has not released this working folder")
    if run(["git", "status", "--porcelain=v1", "--untracked-files=all"], path):
        raise CleanupError("edited or untracked work holds this folder")
    flags = run(["git", "ls-files", "-v", "-z"], path)
    if any(
        item and (item[0] == "S" or item[0].islower()) for item in flags.split("\0")
    ):
        raise CleanupError("Git flags hide working files from ordinary change checks")
    if any(p == str(path) or p.startswith(str(path) + "/") for p in open_paths):
        raise CleanupError("a program or preview still holds this folder open")
    if any(path in Path(r["worktree"]).parents for r in registrations(repo)):
        raise CleanupError("this folder contains another working folder")
    for root, dirs, files in os.walk(path, followlinks=False):
        relative = Path(root).relative_to(path)
        if relative.parts and (".git" in dirs or ".git" in files):
            raise CleanupError("this folder contains another repository")
        dirs[:] = [d for d in dirs if d != ".git"]
    current["proof"] = landing_proof(repo, current)
    return current


def archive(repo: Path, state: Path, record: dict) -> dict:
    path = Path(record["path"])
    if state.resolve() == path or path in state.resolve().parents:
        raise CleanupError("recovery storage must be outside the folder being removed")
    recovery = state / "recovery.git"
    if not recovery.exists():
        run(["git", "init", "--bare", str(recovery)])
    ref = "refs/heads/recovery/" + record["id"] + "/" + record["head"]
    # A separate Git store deduplicates history while remaining independent of the live repo.
    run(
        [
            "git",
            "fetch",
            "--no-tags",
            "--no-write-fetch-head",
            str(repo),
            f"{record['head']}:{ref}",
        ],
        recovery,
    )
    if git(recovery, "rev-parse", ref) != record["head"]:
        raise CleanupError("saved recovery history does not match the released version")
    run(["git", "fsck", "--full", "--no-reflogs", ref], recovery)
    slot = state / "archives" / record["id"] / record["recovery_id"]
    slot.mkdir(parents=True, exist_ok=True, mode=0o700)
    payload = private_files(path)
    existing = slot / "manifest.json"
    if existing.exists():
        saved = json.loads(existing.read_text())
        if (
            saved["payload"] != payload
            or checksum(Path(saved["private"])) != saved["private_hash"]
        ):
            raise CleanupError(
                "private files changed after this recovery generation was saved; retain and release anew"
            )
        return saved
    with tempfile.NamedTemporaryFile(dir=slot, delete=False) as temporary:
        pending = Path(temporary.name)
    try:
        with tarfile.open(pending, "w:gz", dereference=False) as tar:
            for item in payload:
                tar.add(
                    path / item["path"],
                    arcname="payload/" + item["path"],
                    recursive=False,
                )
                if item["type"] == "link" and item["target_hash"]:
                    tar.add(
                        (path / item["path"]).resolve(),
                        arcname="targets/"
                        + hashlib.sha256(os.fsencode(item["path"])).hexdigest(),
                        recursive=False,
                    )
        with tarfile.open(pending, "r:gz") as tar:
            for item in payload:
                member = tar.getmember("payload/" + item["path"])
                if item["type"] == "file":
                    if (
                        hashlib.sha256(tar.extractfile(member).read()).hexdigest()
                        != item["hash"]
                    ):
                        raise CleanupError(
                            "saved private files do not match their originals"
                        )
                if item["type"] == "link":
                    if member.linkname != item["target"]:
                        raise CleanupError("saved private link changed")
                    if item["target_hash"]:
                        name = (
                            "targets/"
                            + hashlib.sha256(os.fsencode(item["path"])).hexdigest()
                        )
                        if (
                            hashlib.sha256(tar.extractfile(name).read()).hexdigest()
                            != item["target_hash"]
                        ):
                            raise CleanupError("saved private link target changed")
        target = slot / "private.tar.gz"
        os.replace(pending, target)
    finally:
        pending.unlink(missing_ok=True)
    saved = {
        **record,
        "recovery": str(recovery),
        "ref": ref,
        "private": str(target),
        "private_hash": checksum(target),
        "payload": payload,
        "archived_at": now(),
    }
    write_json(slot / "manifest.json", saved)
    return saved


def register(repo: Path, state: Path, path: Path, owner: str) -> dict:
    if not owner.strip():
        raise CleanupError("registration needs the owning task ID")
    record = identity(repo, path, allow_retained=True)
    target = state / "owners" / (record["id"] + ".json")
    previous = json.loads(target.read_text()) if target.exists() else {}
    owners = previous.get("owners", {})
    if any(
        previous.get(key) != record[key]
        for key in ("head", "branch", "gitdir", "common", "path")
    ):
        owners = {
            key: {
                "status": "active",
                "reason": "saved version changed; finish decision needs renewal",
            }
            for key in owners
        }
    owners[owner] = {"status": "active", "started_at": now()}
    record.update(owners=owners)
    write_json(target, record)
    released = state / "released" / (record["id"] + ".json")
    if released.exists():
        old = json.loads(released.read_text())
        if old.get("status") in ("released", "removing"):
            old.update(status="resumed", resumed_at=now())
            write_json(released, old)
    return record


def retain(repo: Path, state: Path, path: Path, owner: str, reason: str) -> None:
    if not reason.strip():
        raise CleanupError("retaining a completed version needs its remaining work")
    record = register(repo, state, path, owner)
    record["owners"][owner] = {"status": "held", "reason": reason, "time": now()}
    write_json(state / "owners" / (record["id"] + ".json"), record)


def owner_check(state: Path, receipt: dict) -> None:
    target = state / "owners" / (receipt["id"] + ".json")
    if not target.exists():
        return  # Explicit terminal releases do not require an AI host.
    owners = json.loads(target.read_text()).get("owners", {})
    if owners.get(receipt["owner"], {}).get("status") != "released" or any(
        entry.get("status") != "released" for entry in owners.values()
    ):
        raise CleanupError("an owning task retained or resumed this folder")


def release(repo: Path, state: Path, path: Path, owner: str, evidence: str) -> dict:
    record = identity(repo, path)
    if not owner.strip() or not evidence.strip():
        raise CleanupError("release needs the owning task and its delivery evidence")
    record.update(
        owner=owner,
        evidence=evidence,
        status="released",
        released_at=now(),
        recovery_id=hashlib.sha256(
            (record["id"] + uuid.uuid4().hex).encode()
        ).hexdigest(),
    )
    # Reject unpublished versions now as well as at removal time.
    record["proof"] = landing_proof(repo, record)
    ownership = state / "owners" / (record["id"] + ".json")
    if ownership.exists():
        registered = json.loads(ownership.read_text())
        if owner not in registered.get("owners", {}):
            raise CleanupError("release does not identify a registered owning task")
        registered["owners"][owner] = {"status": "released", "time": now()}
        write_json(ownership, registered)
    write_json(state / "released" / (record["id"] + ".json"), record)
    return record


def finish_remainder(
    repo: Path, state: Path, receipt: dict, receipt_file: Path, apply: bool = True
) -> None:
    """Finish interrupted ordinary Git removal, only for independently saved bytes."""
    path = Path(receipt["path"])
    check_scope(repo, path)
    if any(
        row["worktree"] == str(path) or path in Path(row["worktree"]).parents
        for row in registrations(repo)
    ):
        raise CleanupError("removal remainder still has a working-folder registration")
    saved = json.loads(Path(receipt["manifest"]).read_text())
    if any(
        saved[key] != receipt[key] for key in ("id", "path", "head", "common", "gitdir")
    ):
        raise CleanupError("removal remainder differs from its recovery record")
    recovery = Path(saved["recovery"])
    if (
        checksum(Path(saved["private"])) != saved["private_hash"]
        or git(recovery, "rev-parse", saved["ref"]) != receipt["head"]
    ):
        raise CleanupError("removal remainder's recovery copy is damaged")
    private = {row["path"]: row for row in saved["payload"]}
    tracked = {}
    for entry in run(["git", "ls-tree", "-r", "-z", saved["head"]], recovery).split(
        "\0"
    ):
        if entry:
            metadata, name = entry.split("\t", 1)
            tracked[name] = metadata.split()
    allowed = set(tracked) | set(private)
    folders = {
        str(parent)
        for name in allowed
        for parent in Path(name).parents
        if str(parent) != "."
    }

    def validate(root: Path):
        if root.is_symlink() or not root.is_dir():
            raise CleanupError("removal remainder has a different type")
        paths = process_paths()
        if any(
            p == str(root)
            or p.startswith(str(root) + "/")
            or p == str(path)
            or p.startswith(str(path) + "/")
            for p in paths
        ):
            raise CleanupError("a program resumed the removal remainder")
        for directory, dirs, files in os.walk(root, followlinks=False):
            relative = Path(directory).relative_to(root)
            if relative.parts and (".git" in dirs or ".git" in files):
                raise CleanupError("removal remainder contains another repository")
            for name in files + [d for d in dirs if (Path(directory) / d).is_symlink()]:
                file = Path(directory) / name
                name = str(file.relative_to(root))
                if name == ".git":
                    if (
                        file.is_symlink()
                        or not file.is_file()
                        or file.read_text().strip() != "gitdir: " + receipt["gitdir"]
                    ):
                        raise CleanupError(
                            "removal remainder has a different Git pointer"
                        )
                elif disposable(name):
                    continue
                elif name in private:
                    item = private[name]
                    if item["type"] == "file":
                        valid = (
                            not file.is_symlink()
                            and file.is_file()
                            and checksum(file) == item["hash"]
                        )
                    elif item["type"] == "link":
                        valid = (
                            file.is_symlink()
                            and os.readlink(file) == item["target"]
                            and (
                                checksum(file.resolve())
                                if file.resolve().is_file()
                                else None
                            )
                            == item["target_hash"]
                        )
                    else:
                        valid = False
                    if not valid:
                        raise CleanupError(
                            "private removal remainder changed after recovery"
                        )
                elif name in tracked:
                    mode, kind, oid = tracked[name]
                    if kind != "blob" or (mode == "120000") != file.is_symlink():
                        raise CleanupError(
                            "source removal remainder has a different type"
                        )
                    if file.is_symlink():
                        blob = subprocess.run(
                            [
                                "git",
                                "-c",
                                "core.fsmonitor=false",
                                "--git-dir",
                                str(recovery),
                                "cat-file",
                                "blob",
                                oid,
                            ],
                            env={
                                **{
                                    k: v
                                    for k, v in os.environ.items()
                                    if not k.startswith("GIT_")
                                },
                                "GIT_OPTIONAL_LOCKS": "0",
                            },
                            capture_output=True,
                            check=True,
                        ).stdout
                        valid = blob == os.fsencode(os.readlink(file))
                    else:
                        valid = (
                            file.is_file()
                            and git(recovery, "hash-object", "--no-filters", str(file))
                            == oid
                            and bool(file.stat().st_mode & 0o111) == (mode == "100755")
                        )
                    if not valid:
                        raise CleanupError(
                            "source removal remainder changed after recovery"
                        )
                else:
                    raise CleanupError(
                        "new unsaved work appeared in the removal remainder"
                    )
            for name in dirs:
                child = Path(directory) / name
                relative_name = str(child.relative_to(root))
                if (
                    not child.is_symlink()
                    and not disposable(relative_name)
                    and relative_name not in folders
                    and private.get(relative_name, {}).get("type") != "dir"
                ):
                    raise CleanupError(
                        "a new unsaved directory appeared in the removal remainder"
                    )

    quarantine = Path(
        receipt.get("quarantine", str(Path(receipt["manifest"]).parent / "remainder"))
    )
    if (
        quarantine != Path(receipt["manifest"]).parent / "remainder"
        or state.resolve() not in quarantine.resolve().parents
    ):
        raise CleanupError("invalid removal remainder location")
    if not apply:
        if path.exists():
            validate(path)
        if quarantine.exists():
            validate(quarantine)
        return
    if path.exists():
        if quarantine.exists():
            raise CleanupError("both original and quarantined removal remainders exist")
        validate(path)
        receipt["quarantine"] = str(quarantine)
        write_json(receipt_file, receipt)
        path.rename(quarantine)
    if quarantine.exists():
        validate(quarantine)
        # rmtree's fd-based implementation avoids following replaced directory links.
        if not shutil.rmtree.avoids_symlink_attacks:
            raise CleanupError(
                "this Python cannot safely remove a quarantined remainder"
            )
        shutil.rmtree(quarantine)
    if path.exists():
        raise CleanupError("a program recreated the original working folder")


def save_receipt(state: Path, path: Path, receipt: dict) -> None:
    # Keep every archived removal generation recoverable after the path is reused.
    write_json(state / "completed" / (receipt["recovery_id"] + ".json"), receipt)
    write_json(path, receipt)


def require_scheduler(repo: Path, state: Path) -> None:
    installation = json.loads((state / "installation.json").read_text())
    common = Path(
        git(repo, "rev-parse", "--path-format=absolute", "--git-common-dir")
    ).resolve()
    if (
        sys.platform != "darwin"
        or not installation.get("activated")
        or Path(installation["repository"]) != common.parent
    ):
        raise CleanupError(
            "install the free Mac maintenance helper before releasing a folder"
        )
    run(["launchctl", "print", f"gui/{os.getuid()}/com.{PROJECT}.worktree-cleanup"])


def empty_container_contents(path: Path) -> Path | None:
    """An empty shell may contain only a regular Finder metadata file."""
    if not stat.S_ISDIR(path.lstat().st_mode):
        raise CleanupError("container is not an ordinary directory")
    entries = list(path.iterdir())
    if not entries:
        return None
    if (
        len(entries) == 1
        and entries[0].name == ".DS_Store"
        and stat.S_ISREG(entries[0].lstat().st_mode)
    ):
        return entries[0]
    raise CleanupError("container has files or folders that must stay")


def tidy_empty_containers(repo: Path, state: Path, apply: bool) -> list[dict]:
    """Remove only empty immediate external shells, never their source contents."""
    if PROJECT != "alethical":
        return []  # CommercialDeals legacy names may be saved designs, not containers.
    common = Path(
        git(repo, "rev-parse", "--path-format=absolute", "--git-common-dir")
    ).resolve()
    shared = common.parent
    if Path(git(shared, "rev-parse", "--show-toplevel")).resolve() != shared:
        raise CleanupError("cannot identify the shared checkout for container cleanup")
    results = []
    for path in sorted(shared.parent.iterdir()):
        if not path.name.startswith("alethical-wt-"):
            continue
        if path == state.resolve() or path in state.resolve().parents:
            continue
        try:
            # Ordinary working folders, links and source files are not candidates.
            empty_container_contents(path)
            original = path.lstat()
        except (CleanupError, OSError):
            continue

        def validate() -> Path | None:
            current = path.lstat()
            if (current.st_dev, current.st_ino) != (original.st_dev, original.st_ino):
                raise CleanupError("container changed during cleanup")
            finder = empty_container_contents(path)
            for row in registrations(repo):
                registered = Path(row["worktree"]).resolve()
                if path == registered or path in registered.parents:
                    raise CleanupError("container still has a Git registration")
            if any(
                p == str(path) or p.startswith(str(path) + "/") for p in process_paths()
            ):
                raise CleanupError("a program still holds the container open")
            return finder

        try:
            validate()
            if apply:
                finder = validate()
                if finder is not None:
                    if not stat.S_ISREG(finder.lstat().st_mode):
                        raise CleanupError("Finder metadata changed its file type")
                    finder.unlink()
                # Never recurse: a new source/private file makes this refuse.
                path.rmdir()
            results.append(
                {
                    "path": str(path),
                    "kind": "empty container",
                    "state": "removed" if apply else "ready",
                }
            )
        except (CleanupError, OSError, ValueError, KeyError) as error:
            results.append(
                {
                    "path": str(path),
                    "kind": "empty container",
                    "state": "held",
                    "reason": str(error),
                }
            )
    return results


def sweep(repo: Path, state: Path, apply: bool) -> list[dict]:
    results = []
    # Empty-container cleanup needs local Git information, but never a fetch.
    queued = list((state / "released").glob("*.json"))
    if queued and apply:
        run(["git", "fetch", "origin", "main", "--quiet"], repo)
    for receipt_file in queued:
        try:
            receipt = json.loads(receipt_file.read_text())
            if receipt.get("status") not in ("released", "removing"):
                continue
            owner_check(state, receipt)
            # A crash after Git removed the directory must leave recovery usable.
            if receipt.get("status") == "removing" and not any(
                row["worktree"] == receipt["path"] for row in registrations(repo)
            ):
                finish_remainder(repo, state, receipt, receipt_file, apply=apply)
                if apply:
                    receipt.update(status="removed", removed_at=now())
                    save_receipt(state, receipt_file, receipt)
                results.append(
                    {
                        "id": receipt["id"],
                        "path": receipt["path"],
                        "state": "removed" if apply else "reconcile ready",
                    }
                )
                continue
            current = eligible(repo, receipt, process_paths())
            if not apply:
                results.append(
                    {"id": receipt["id"], "path": receipt["path"], "state": "ready"}
                )
                continue
            saved = archive(repo, state, receipt)
            receipt.update(
                status="removing",
                manifest=str(Path(saved["private"]).with_name("manifest.json")),
            )
            save_receipt(state, receipt_file, receipt)
            owner_check(state, receipt)
            current = eligible(repo, receipt, process_paths())
            if private_files(Path(receipt["path"])) != saved["payload"]:
                raise CleanupError("private files changed after recovery was saved")
            unlocked = False
            try:
                if current["lock"] is not None:
                    git(repo, "worktree", "unlock", receipt["path"])
                    unlocked = True
                # Never force: new source edits must make Git refuse removal.
                git(repo, "worktree", "remove", receipt["path"])
            except BaseException:
                if not any(
                    row["worktree"] == receipt["path"] for row in registrations(repo)
                ):
                    finish_remainder(repo, state, receipt, receipt_file)
                else:
                    if unlocked and Path(receipt["path"]).exists():
                        git(
                            repo,
                            "worktree",
                            "lock",
                            "--reason",
                            current["lock"] or "cleanup protection",
                            receipt["path"],
                        )
                    raise
            if Path(receipt["path"]).exists() or any(
                r["worktree"] == receipt["path"] for r in registrations(repo)
            ):
                raise CleanupError("Git removal left a folder or registration behind")
            receipt.update(
                status="removed",
                removed_at=now(),
                manifest=str(Path(saved["private"]).with_name("manifest.json")),
            )
            save_receipt(state, receipt_file, receipt)
            results.append(
                {"id": receipt["id"], "path": receipt["path"], "state": "removed"}
            )
        except (CleanupError, OSError, ValueError, KeyError, TypeError) as error:
            results.append(
                {"receipt": str(receipt_file), "state": "held", "reason": str(error)}
            )
    results.extend(tidy_empty_containers(repo, state, apply))
    if apply:
        write_json(
            state / "last-cleanup.json",
            {"time": now(), "apply": apply, "results": results},
        )
        from scripts.worktree_inventory import inspect_folders

        write_json(state / "folder-inventory.json", inspect_folders(repo, state))
    return results


def restore(state: Path, key: str, destination: Path) -> None:
    if len(key) != 64 or any(c not in "0123456789abcdef" for c in key):
        raise CleanupError("invalid recovery identifier")
    receipt_file = state / "completed" / (key + ".json")
    if not receipt_file.exists():
        receipt_file = state / "released" / (key + ".json")
    receipt = json.loads(receipt_file.read_text())
    saved = json.loads(Path(receipt["manifest"]).read_text())
    destination = destination.absolute()
    if destination.exists():
        raise CleanupError("restore destination already exists")
    if checksum(Path(saved["private"])) != saved["private_hash"]:
        raise CleanupError("private recovery archive is damaged")
    if git(Path(saved["recovery"]), "rev-parse", saved["ref"]) != saved["head"]:
        raise CleanupError("recovery history is damaged")
    run(
        [
            "git",
            "clone",
            "--no-hardlinks",
            "--no-checkout",
            saved["recovery"],
            str(destination),
        ]
    )
    git(destination, "checkout", "--detach", saved["head"])
    git(destination, "remote", "remove", "origin")
    # Recreate from our explicit manifest. Never use unbounded tar extraction.
    with tarfile.open(saved["private"], "r:gz") as tar:
        for item in saved["payload"]:
            relative = Path(item["path"])
            if (
                relative.is_absolute()
                or ".." in relative.parts
                or relative.parts[0] == ".git"
            ):
                raise CleanupError("unsafe recovery path")
            output = destination / relative
            output.parent.mkdir(parents=True, exist_ok=True)
            if item["type"] == "dir":
                output.mkdir(exist_ok=True)
            elif item["type"] == "file":
                output.write_bytes(tar.extractfile("payload/" + item["path"]).read())
                output.chmod(tar.getmember("payload/" + item["path"]).mode & 0o777)
                if checksum(output) != item["hash"]:
                    raise CleanupError("restored private file has different contents")
            elif item["target_hash"]:
                # Restore private settings as a local file, not by overwriting an external target.
                name = (
                    "targets/" + hashlib.sha256(os.fsencode(item["path"])).hexdigest()
                )
                output.write_bytes(tar.extractfile(name).read())
                output.chmod(0o600)
                if checksum(output) != item["target_hash"]:
                    raise CleanupError("restored private link contents differ")
            else:
                output.symlink_to(item["target"])


def hook(repo: Path, state: Path, payload: dict) -> dict | None:
    """Register/revoke on new work; require a hold or release before a final reply.

    Stop never authorizes removal. The gate does not interpret prose or transcripts.
    Unfinished turns need an explicit hold, not permission to remove the folder.
    """
    cwd = Path(payload.get("cwd", "")).absolute()
    owner = payload.get("session_id")
    if not owner or not payload.get("cwd"):
        return None
    try:
        path = Path(git(cwd, "rev-parse", "--show-toplevel")).resolve()
        record = identity(repo, path, allow_retained=True)
    except CleanupError:
        return (
            None  # Shared checkout, unadmitted paths and other projects stay untouched.
        )
    event = payload.get("hook_event_name")
    if event in ("SessionStart", "UserPromptSubmit"):
        register(repo, state, path, owner)
        command = f"{shlex.quote(sys.executable)} {shlex.quote(str(Path(__file__).resolve()))} --project {PROJECT} --repo {shlex.quote(str(repo))} --state {shlex.quote(str(state))}"
        context = (
            f"Worktree cleanup owner is {owner}. When delivery and acceptance are finished, "
            f"release this folder with: {command} release --worktree {shlex.quote(str(path))} "
            f"--owner {shlex.quote(owner)} --evidence 'describe the finished delivery'. "
            "If review or a preview remains, use the hold command with its reason. "
            "Never release merely because a change merged."
        )
        if is_native(path):
            context = (
                f"Working-folder owner is {owner}. Codex owns {path}; only its supported archive_worktree tool may remove it after delivery and acceptance. "
                "Preserve needed ignored files first. If the app protects the folder, or unfinished work/review/preview remains, record the exact hold with: "
                f"{command} hold --worktree {shlex.quote(str(path))} --owner {shlex.quote(owner)} --reason 'describe what remains or the native protection'. "
                "Never use Git removal or private app-state edits. Run inspect for the local folder report; recorded ownership does not establish live chat activity."
            )
        return {
            "hookSpecificOutput": {"hookEventName": event, "additionalContext": context}
        }
    if event != "Stop":
        return None
    target = state / "owners" / (record["id"] + ".json")
    if not target.exists():
        register(repo, state, path, owner)
    registered = json.loads(target.read_text())
    if registered.get("head") != record["head"] or owner not in registered.get(
        "owners", {}
    ):
        registered = register(repo, state, path, owner)
    disposition = registered.get("owners", {}).get(owner, {})
    if disposition.get("status") in ("released", "held"):
        return None
    return {
        "decision": "block",
        "reason": (
            "This working folder has no current finish decision. "
            "For unfinished work, a preview, or pending review, record hold with the concrete remaining work. "
            "For a Codex-managed folder use only the app's archive action after delivery/acceptance, or record its exact protection as a hold. "
            "If delivery and acceptance are complete, call the cleanup release command with this "
            f"worktree and owner {owner}. Otherwise call hold with the remaining review/preview work. "
            "The release queues recoverable cleanup; hold keeps the folder. Do not ask Eugene to clean it."
        ),
    }


def status_records(state: Path) -> list[dict]:
    records = {}
    for folder in ("completed", "released"):
        for path in (state / folder).glob("*.json"):
            row = json.loads(path.read_text())
            key = row.get("recovery_id", row["id"])
            records[key] = {"id": key, "path": row["path"], "status": row["status"]}
    return list(records.values())


def main() -> int:
    os.umask(0o077)
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--repo", type=Path, default=Path.cwd())
    parser.add_argument("--project", choices=PROJECTS, default="alethical")
    parser.add_argument("--state", type=Path)
    sub = parser.add_subparsers(dest="command", required=True)
    finish = sub.add_parser("release")
    location = finish.add_mutually_exclusive_group(required=True)
    location.add_argument("--worktree", type=Path)
    location.add_argument("--branch")
    finish.add_argument("--owner", required=True)
    finish.add_argument("--evidence", required=True)
    waiting = sub.add_parser("hold")
    waiting.add_argument("--worktree", type=Path, required=True)
    waiting.add_argument("--owner", required=True)
    waiting.add_argument("--reason", required=True)
    sub.add_parser("hook")
    scan = sub.add_parser("sweep")
    scan.add_argument("--apply", action="store_true")
    sub.add_parser("status")
    sub.add_parser("inspect")
    start = sub.add_parser("register")
    start.add_argument("--worktree", type=Path, required=True)
    start.add_argument("--owner", required=True)
    resume = sub.add_parser("resume")
    resume.add_argument("--worktree", type=Path, required=True)
    recover = sub.add_parser("restore")
    recover.add_argument("id")
    recover.add_argument("destination", type=Path)
    args = parser.parse_args()
    args.state = args.state or default_state(args.project)
    try:
        guard = (
            nullcontext()
            if args.command in ("inspect", "status")
            or (args.command == "sweep" and not args.apply)
            else locked(args.state, wait=args.command == "sweep")
        )
        with guard:
            configure_project(args.project, args.repo, args.state)
            if args.command == "release":
                require_scheduler(args.repo, args.state)
                run(["git", "fetch", "origin", "main", "--quiet"], args.repo)
                path = args.worktree
                if path is None:
                    matches = [
                        r["worktree"]
                        for r in registrations(args.repo)
                        if r.get("branch") == "refs/heads/" + args.branch
                    ]
                    if len(matches) != 1:
                        raise CleanupError(
                            "branch does not identify exactly 1 working folder"
                        )
                    path = Path(matches[0])
                record = release(
                    args.repo, args.state, path.absolute(), args.owner, args.evidence
                )
                print(
                    json.dumps(
                        {
                            "queued": record["id"],
                            "recovery_id": record["recovery_id"],
                            "path": record["path"],
                        }
                    )
                )
            elif args.command in ("resume", "register"):
                register(
                    args.repo,
                    args.state,
                    args.worktree.absolute(),
                    getattr(args, "owner", "terminal"),
                )
                print("This working folder is retained for resumed work.")
            elif args.command == "hold":
                retain(
                    args.repo,
                    args.state,
                    args.worktree.absolute(),
                    args.owner,
                    args.reason,
                )
                print("The owning task retained this folder with its remaining work.")
            elif args.command == "hook":
                result = hook(args.repo, args.state, json.load(sys.stdin))
                if result:
                    print(json.dumps(result))
            elif args.command == "sweep":
                print(json.dumps(sweep(args.repo, args.state, args.apply)))
            elif args.command == "restore":
                restore(args.state, args.id, args.destination)
                print(f"Recovered working files at {args.destination}")
            elif args.command == "inspect":
                from scripts.worktree_inventory import inspect_folders

                print(json.dumps(inspect_folders(args.repo, args.state)))
            else:
                print(json.dumps(status_records(args.state)))
        return 0
    except (CleanupError, OSError, ValueError) as error:
        if args.command == "hook":
            print(
                json.dumps(
                    {
                        "decision": "block",
                        "reason": f"Worktree cleanup could not record resumed work: {error}. Retry before changing this folder.",
                    }
                )
            )
            return 2
        print(f"Cleanup held: {error}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
