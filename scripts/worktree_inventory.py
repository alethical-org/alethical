#!/usr/bin/env python3
"""Read-only inventory of every registered working folder and its saved decisions.

This report is evidence for a review, never permission to remove a folder. Saved
ownership is not live chat activity. Git failures remain unknown, never clean.
"""

from __future__ import annotations

import hashlib
import json
import os
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path

try:
    from scripts import worktree_cleanup as cleanup
except ModuleNotFoundError:
    import worktree_cleanup as cleanup


IDENTITY_FIELDS = ("path", "common", "gitdir", "head", "branch")


def _identity_state(note: dict, current: dict | None) -> str:
    if (
        current is None
        or any(not note.get(key) for key in IDENTITY_FIELDS if key != "branch")
        or not isinstance(note.get("branch"), str)
    ):
        return "unknown"
    return (
        "current"
        if all(note[key] == current[key] for key in IDENTITY_FIELDS)
        else "stale"
    )


def _notes(state: Path) -> tuple[list[dict], list[dict]]:
    notes, errors = [], []
    for category in ("owners", "released"):
        directory = state / category
        try:
            if directory.is_symlink():
                raise OSError("saved-note directory is a link")
            files = sorted(directory.glob("*.json"))
        except OSError:
            errors.append({"file": str(directory), "error": "cannot list saved notes"})
            continue
        for file in files:
            try:
                # Notes are small JSON records. Never follow a link to another file.
                if file.is_symlink() or file.stat().st_size > 1024 * 1024:
                    raise ValueError("invalid note file")
                data = json.loads(file.read_text())
                if not isinstance(data, dict):
                    raise ValueError("invalid note shape")
                if category == "owners" and (
                    not isinstance(data.get("owners"), dict)
                    or any(
                        not isinstance(value, dict) for value in data["owners"].values()
                    )
                ):
                    raise ValueError("invalid ownership entries")
                notes.append({"file": str(file), "category": category, "data": data})
            except (OSError, ValueError, UnicodeError):
                errors.append(
                    {
                        "file": str(file),
                        "error": "saved note is unreadable or malformed",
                    }
                )
    return notes, errors


def _kind(path: Path, common: Path | None) -> tuple[str, str]:
    if cleanup.is_native(path):
        return "codex", "Use the owning Codex chat's supported archive action"
    if common is not None and path == common.parent:
        return "main", "Keep the shared checkout"
    return "external", "Cleanup coverage is unknown until installation scope is read"


def _installation(state: Path, common: Path | None) -> tuple[dict, list[dict]]:
    target = state / "installation.json"
    empty = {
        "status": "missing",
        "project": None,
        "repository": None,
        "admitted_paths": [],
        "protected_paths": [],
        "activated": None,
    }
    try:
        if target.is_symlink():
            raise ValueError("installation is a link")
        if not target.exists():
            return empty, []
        if target.stat().st_size > 1024 * 1024:
            raise ValueError("installation is too large")
        data = json.loads(target.read_text())
        if not isinstance(data, dict):
            raise ValueError("invalid installation")
        project = data.get("project", "alethical")
        if project not in cleanup.PROJECTS or not isinstance(
            data.get("repository"), str
        ):
            raise ValueError("invalid project")
        if common is None or Path(data["repository"]) != common.parent:
            raise ValueError("installation belongs to a different repository")
        paths = {}
        for key in ("admitted_paths", "protected_paths"):
            values = data.get(key, [])
            if not isinstance(values, list) or any(
                not isinstance(value, str) or not Path(value).is_absolute()
                for value in values
            ):
                raise ValueError("invalid path list")
            paths[key] = values
        if "activated" in data and not isinstance(data["activated"], bool):
            raise ValueError("invalid activation state")
        return {
            "status": "current",
            "project": project,
            "repository": data["repository"],
            **paths,
            "activated": data.get("activated"),
        }, []
    except (OSError, ValueError, UnicodeError):
        return {**empty, "status": "unknown"}, [
            {
                "file": str(target),
                "error": "Installation scope is unreadable, malformed, or belongs to a different repository",
            }
        ]


def _coverage(row: dict, installation: dict, common: Path | None) -> None:
    row.update(
        project=installation["project"],
        coverage="unknown",
        admitted=None,
        protected_by=[],
    )
    if not row["path"]:
        return
    path = Path(row["path"])
    if installation["status"] == "current":
        row["protected_by"] = [
            value
            for value in installation["protected_paths"]
            if path == Path(value)
            or Path(value) in path.parents
            or path in Path(value).parents
        ]
    if row.get("kind") in ("main", "codex"):
        row["coverage"] = (
            "shared checkout" if row["kind"] == "main" else "native app archive"
        )
        row["admitted"] = False
        if row["kind"] == "codex" and row["protected_by"]:
            row["coverage"] = "installation hold"
            row["route"] = (
                "Keep this folder while its installation hold remains; any later removal uses the owning Codex chat's supported archive action"
            )
        return
    if installation["status"] != "current" or common is None:
        return
    shared = common.parent
    project = installation["project"]
    prefix = "alethical-wt-" if project == "alethical" else "CommercialDeals-worktrees"
    admitted = (
        (
            project == "alethical"
            and path.parent == shared.parent
            and path.name.startswith(prefix)
        )
        or shared / ".claude/worktrees" in path.parents
        or any(
            (
                parent.name.startswith(prefix)
                if project == "alethical"
                else parent.name == prefix
            )
            and parent.parent == shared.parent
            for parent in path.parents
        )
        or str(path) in installation["admitted_paths"]
    )
    row["admitted"] = admitted
    if row["protected_by"]:
        row["coverage"] = "installation hold"
        row["route"] = (
            "Keep this folder; installation records a persistent preview or work hold"
        )
    elif admitted:
        row["coverage"] = "admitted external cleanup"
        row["route"] = (
            "Owning task must record a hold or release through supported cleanup; admission alone does not authorize removal"
        )
    else:
        row["coverage"] = "outside removal scope"
        row["route"] = (
            "Keep this folder; the installed cleanup helper does not admit this path"
        )


def _inspect(repo: Path, registration: dict, common: Path | None, count: int) -> dict:
    raw_path = registration.get("worktree")
    row = {
        "path": raw_path,
        "head": registration.get("HEAD"),
        "branch": registration.get("branch", ""),
        "registration_count": count,
        "dirty_source": None,
        "identity": None,
        "owners": [],
        "notes": [],
        "finish_decision": "absent",
        "chat_activity": "unknown",
        "issues": [],
    }
    if not isinstance(raw_path, str) or not raw_path:
        row["issues"].append("Git registration has no working folder path")
        return row
    path = Path(raw_path)
    row["kind"], row["route"] = _kind(path, common)
    if count != 1:
        row["issues"].append("Working folder has duplicate Git registrations")
    if "prunable" in registration:
        row["issues"].append("Git marks this registration as needing repair")
    if "bare" in registration:
        row["issues"].append("Bare Git storage has no working source folder")
        return row
    try:
        if not path.is_dir() or path.is_symlink() or path != path.resolve():
            row["issues"].append(
                "Working folder is missing or has a different real path"
            )
            return row
        actual_common = Path(
            cleanup.git(path, "rev-parse", "--path-format=absolute", "--git-common-dir")
        ).resolve()
        if common is None or actual_common != common:
            row["issues"].append(
                "Working folder belongs to a different or unknown repository"
            )
            return row
        top = Path(cleanup.git(path, "rev-parse", "--show-toplevel")).resolve()
        if top != path:
            row["issues"].append("Git identifies a different working folder")
            return row
        gitdir = Path(cleanup.git(path, "rev-parse", "--absolute-git-dir")).resolve()
        if gitdir != common:
            backlink = gitdir / "gitdir"
            if (
                not backlink.is_file()
                or Path(backlink.read_text().strip()).resolve() != path / ".git"
            ):
                row["issues"].append(
                    "Git registration points back to a different working folder"
                )
                return row
        head = cleanup.git(path, "rev-parse", "HEAD")
        branch = cleanup.git(path, "rev-parse", "--symbolic-full-name", "HEAD")
        branch = "" if branch == "HEAD" else branch
        if head != row["head"] or branch != row["branch"]:
            row["issues"].append("Git registration differs from the working folder")
        row["head"], row["branch"] = head, branch
        key = hashlib.sha256(
            os.fsencode(common)
            + b"\0"
            + os.fsencode(gitdir)
            + b"\0"
            + os.fsencode(path)
        ).hexdigest()
        row["identity"] = {
            "id": key,
            "path": str(path),
            "common": str(common),
            "gitdir": str(gitdir),
            "head": head,
            "branch": branch,
        }
        # Keep filenames and diffs private. Ignored private files are not source edits.
        row["dirty_source"] = bool(
            cleanup.run(
                ["git", "status", "--porcelain=v1", "-z", "--untracked-files=normal"],
                path,
            )
        )
    except (OSError, ValueError, cleanup.CleanupError):
        row["issues"].append("Cannot read Git identity or source-change status")
    return row


def inspect_folders(repo: Path, state: Path) -> dict:
    """Inspect local registrations and saved notes without writing or fetching."""
    report = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "repo": str(repo),
        "common": None,
        "folders": [],
        "state_errors": [],
        "errors": [],
        "activity_notice": "Saved owners describe recorded ownership, not whether a chat is running; live chat activity is unknown",
    }
    common = None
    try:
        common = Path(
            cleanup.git(repo, "rev-parse", "--path-format=absolute", "--git-common-dir")
        ).resolve()
        report["common"] = str(common)
    except (OSError, ValueError, cleanup.CleanupError):
        report["errors"].append("Cannot identify this repository's Git storage")
    report["installation"], installation_errors = _installation(state, common)
    report["project"] = report["installation"]["project"]
    report["state_errors"].extend(installation_errors)
    try:
        registrations = cleanup.registrations(repo)
    except (OSError, ValueError, cleanup.CleanupError):
        report["errors"].append("Cannot read Git working-folder registrations")
        return report
    counts = Counter(row.get("worktree") for row in registrations)
    notes, note_errors = _notes(state)
    report["state_errors"].extend(note_errors)
    for registration in registrations:
        row = _inspect(repo, registration, common, counts[registration.get("worktree")])
        _coverage(row, report["installation"], common)
        identity = row["identity"]
        matching = [
            note
            for note in notes
            if note["data"].get("path") == row["path"]
            or (identity and note["data"].get("id") == identity["id"])
        ]
        for note in matching:
            data = note["data"]
            current = _identity_state(data, identity)
            row["notes"].append(
                {
                    "file": note["file"],
                    "category": note["category"],
                    "identity": current,
                    "status": data.get("status"),
                    "has_release_evidence": bool(
                        isinstance(data.get("evidence"), str)
                        and data["evidence"].strip()
                        and isinstance(data.get("owner"), str)
                        and data["owner"].strip()
                    ),
                }
            )
            if current != "current":
                row["issues"].append("Saved decision identity is " + current)
            if note["category"] == "owners":
                for owner, value in data["owners"].items():
                    row["owners"].append(
                        {
                            "owner": owner,
                            "status": value.get("status"),
                            "reason": value.get("reason"),
                            "note_identity": current,
                            "source": "owners",
                        }
                    )
            elif isinstance(data.get("owner"), str) and data["owner"].strip():
                if not any(owner["owner"] == data["owner"] for owner in row["owners"]):
                    row["owners"].append(
                        {
                            "owner": data["owner"],
                            "status": data.get("status"),
                            "reason": None,
                            "note_identity": current,
                            "source": "release",
                        }
                    )
        if identity:
            for error in report["state_errors"]:
                if Path(error["file"]).stem == identity["id"]:
                    row["issues"].append(error["error"])
        owners = row["owners"]
        current_owners = [
            owner for owner in owners if owner["note_identity"] == "current"
        ]
        release_notes = [
            note
            for note in row["notes"]
            if note["category"] == "released"
            and note["identity"] == "current"
            and note["status"] in ("released", "removing")
            and note["has_release_evidence"]
        ]
        if (
            current_owners
            and all(
                owner["status"] in ("released", "removing")
                or (
                    owner["status"] == "held"
                    and isinstance(owner["reason"], str)
                    and owner["reason"].strip()
                )
                for owner in current_owners
            )
            and len(current_owners) == len(owners)
        ):
            row["finish_decision"] = (
                "held"
                if any(owner["status"] == "held" for owner in current_owners)
                else "released"
                if release_notes
                else "release receipt missing"
            )
        elif not owners and release_notes:
            row["finish_decision"] = "released"
        if not owners:
            row["issues"].append("No recorded owning task")
        if row["finish_decision"] == "absent":
            row["issues"].append("No current finish decision for every recorded owner")
        report["folders"].append(row)
    return report
