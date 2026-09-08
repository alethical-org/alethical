#!/usr/bin/env python3
"""Activate checks here, keeping existing sibling worktrees unchanged.

Git copies worktree-specific configuration when making a new worktree. New
worktrees therefore inherit their parent's activation; existing ones do not.
"""

from __future__ import annotations

import hashlib
import os
import subprocess
from pathlib import Path

HOOKS = ("post-checkout", "pre-commit", "pre-push")


def install(root: Path) -> Path:
    def git(*args: str) -> str:
        return subprocess.check_output(["git", *args], cwd=root, text=True).strip()

    def setting(name: str, *options: str) -> str | None:
        result = subprocess.run(
            ["git", "config", *options, "--get", name],
            cwd=root,
            capture_output=True,
            text=True,
            check=False,
        )
        if result.returncode == 1:
            return None
        if result.returncode:
            raise RuntimeError(f"Could not read Git setting {name}.")
        return result.stdout.strip()

    common = Path(git("rev-parse", "--path-format=absolute", "--git-common-dir"))
    if (
        setting("core.worktree", "--local") is not None
        or setting("core.bare", "--local", "--type=bool") == "true"
    ):
        raise RuntimeError(
            "Common core.worktree or bare=true needs an explicit Git configuration migration."
        )
    worktree_config = (
        setting("extensions.worktreeConfig", "--local", "--type=bool") == "true"
    )
    if not worktree_config and any(
        path.is_file() and path.stat().st_size
        for path in [
            common / "config.worktree",
            *(common / "worktrees").glob("*/config.worktree"),
        ]
    ):
        raise RuntimeError(
            "Inactive worktree configuration exists. Review it before enabling worktree-specific hooks."
        )
    current = setting("core.hooksPath")
    common_hooks = setting("core.hooksPath", "--local")
    store = common / "alethical-hooks"
    legacy = common.parent / ".githooks"
    if current:
        configured = Path(current)
        if not configured.is_absolute():
            configured = root / configured
        if (
            configured.resolve() != legacy.resolve()
            and store.resolve() not in configured.resolve().parents
        ):
            raise RuntimeError(
                "Custom Git hooks are configured. Keep them and arrange an explicit hook migration first."
            )
        if configured.resolve() == legacy.resolve():
            for old in configured.iterdir():
                if old.is_file() and not old.name.endswith(".sample"):
                    source = root / ".githooks" / old.name
                    if (
                        old.name not in HOOKS
                        or not source.is_file()
                        or old.read_bytes() != source.read_bytes()
                    ):
                        raise RuntimeError(
                            "An existing hook has custom contents. Preserve it before migrating hooks."
                        )
    else:
        # Do not silently replace hand-written default hooks.
        if any(
            path.is_file() and not path.name.endswith(".sample")
            for path in (common / "hooks").glob("*")
        ):
            raise RuntimeError(
                "Custom default Git hooks exist. Preserve them before installing Alethical's hooks."
            )
    contents = {name: (root / ".githooks" / name).read_bytes() for name in HOOKS}

    def profile(selected: dict[str, bytes]) -> Path:
        digest = hashlib.sha256(
            b"".join(name.encode() + data for name, data in selected.items())
        ).hexdigest()[:16]
        destination = store / digest
        destination.mkdir(parents=True, exist_ok=True)
        for name, data in selected.items():
            target = destination / name
            if target.exists():
                if target.is_symlink() or target.read_bytes() != data:
                    raise RuntimeError(f"Hook installation conflict: {target}")
            else:
                with target.open("xb") as stream:
                    stream.write(data)
            target.chmod(0o755)
        return destination

    destination = profile(contents)
    fallback = (
        profile({"post-checkout": contents["post-checkout"]})
        if common_hooks is None
        else None
    )
    # Keep existing shared hooks untouched. A fresh clone gets only the
    # checkout-protection helper as its shared default. Worktrees created from
    # an activated parent inherit the full profile through Git's own copying.
    # Earlier profiles remain available for rollback and already-running hooks.
    if not worktree_config:
        git("config", "--local", "extensions.worktreeConfig", "true")
    if fallback is not None:
        git("config", "--local", "core.hooksPath", str(fallback))
    git("config", "--worktree", "core.hooksPath", str(destination))
    return destination


if __name__ == "__main__":
    if os.environ.get("CI"):
        print("CI uses its own required checks; local hook installation skipped.")
    else:
        root = Path(
            subprocess.check_output(
                ["git", "rev-parse", "--show-toplevel"], text=True
            ).strip()
        )
        print(f"Alethical checks activated for this worktree: {install(root)}")
