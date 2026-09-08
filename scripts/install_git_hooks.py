#!/usr/bin/env python3
"""Install the tracked hooks without writing into any working checkout."""

from __future__ import annotations

import hashlib
import os
import subprocess
from pathlib import Path

HOOKS = ("post-checkout", "pre-commit", "pre-push")


def install(root: Path) -> Path:
    def git(*args: str) -> str:
        return subprocess.check_output(["git", *args], cwd=root, text=True).strip()

    common = Path(git("rev-parse", "--path-format=absolute", "--git-common-dir"))
    current = subprocess.run(
        ["git", "config", "--get", "core.hooksPath"],
        cwd=root,
        capture_output=True,
        text=True,
        check=False,
    ).stdout.strip()
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
    digest = hashlib.sha256(
        b"".join(name.encode() + contents[name] for name in HOOKS)
    ).hexdigest()[:16]
    destination = store / digest
    destination.mkdir(parents=True, exist_ok=True)
    for name, data in contents.items():
        target = destination / name
        if target.exists():
            if target.is_symlink() or target.read_bytes() != data:
                raise RuntimeError(f"Hook installation conflict: {target}")
        else:
            with target.open("xb") as stream:
                stream.write(data)
        target.chmod(0o755)
    # Publish only after all 3 executable helpers are in place. Earlier versions
    # remain available for rollback and for a process already using one.
    git("config", "core.hooksPath", str(destination))
    return destination


if __name__ == "__main__":
    root = Path(
        subprocess.check_output(
            ["git", "rev-parse", "--show-toplevel"], text=True
        ).strip()
    )
    if os.environ.get("CI"):
        print("CI uses its own required checks; local hook installation skipped.")
    else:
        print(f"Alethical hooks installed: {install(root)}")
