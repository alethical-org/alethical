#!/usr/bin/env python3
"""Check that the shared-checkout git prohibitions are named in BOTH rule files.

Why two copies exist, and why that is deliberate rather than sloppy: Claude Code
auto-loads ``AGENTS.md`` *and* everything in ``.claude/rules/`` into every
session, but ``AGENTS.md`` says in its own Tool note that "every other agent must
open them itself". So for Codex, Cursor, and any future tool, the ``AGENTS.md``
copy of the git prohibitions is the only one reliably in context. Trimming it as
duplication would silently leave every non-Claude agent unprotected against the
commands that destroy other sessions' uncommitted work.

That makes the duplication load-bearing, which makes drift the real risk: a
prohibition added to one file and not the other, or a well-meant "dedupe" pass
that deletes one copy. Nothing checked for that until this script existed. A
context audit on 2026-08-31 measured the two copies and found them in sync on all
nine operations below, so this pins that state rather than repairing a break.

Honest limit, stated so nobody reads more assurance into a green run than it
earns: this checks a fixed list. It catches a copy being trimmed, reworded past
recognition, or one side losing an operation. It does NOT notice a brand-new
tenth prohibition added to only one file, because the list would not know to look
for it. Add the operation here in the same change that adds the prohibition.

Exit status is non-zero if either file stops naming any of them, so CI can gate.
"""

from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]

RULES = ROOT / ".claude" / "rules" / "workflow.md"
AGENTS = ROOT / "AGENTS.md"

# Each entry is (substring that must appear in both files, plain-language name).
# The substring is the literal git syntax rather than surrounding prose, so a
# rewrite of the explanation does not trip the check but deleting the operation
# does. Verified present in both files on 2026-08-31.
REQUIRED = [
    ("reset --hard", "discarding every uncommitted change in the tree"),
    ("clean -fd", "deleting untracked files"),
    ("checkout .", "throwing away edits in the working tree"),
    ("git stash", "scooping up other sessions' in-flight edits"),
    ("update-ref", "moving or deleting a branch another worktree holds"),
    ("worktree remove --force", "deleting a worktree and its uncommitted work"),
    ("ignore-other-worktrees", "overriding git's own refusal to touch someone else's branch"),
    ("/usr/bin/git", "Apple's older git, which lacks the guard the newer one has"),
    ("git show origin/main", "the safe way to read another revision without touching the tree"),
]


def main() -> int:
    missing: list[str] = []

    for path in (RULES, AGENTS):
        if not path.exists():
            print(f"MISSING FILE {path.relative_to(ROOT)}", file=sys.stderr)
            return 1

    rules_text = RULES.read_text(encoding="utf-8")
    agents_text = AGENTS.read_text(encoding="utf-8")

    for needle, plain in REQUIRED:
        for path, text in ((RULES, rules_text), (AGENTS, agents_text)):
            if needle not in text:
                missing.append(
                    f"{path.relative_to(ROOT)} no longer names `{needle}` ({plain})"
                )

    if missing:
        print(
            "The shared-checkout git prohibitions have drifted apart.\n"
            "\n"
            "Both .claude/rules/workflow.md and AGENTS.md must name every one of\n"
            "them. AGENTS.md is the only copy that non-Claude agents load, so a\n"
            "prohibition missing there is a prohibition those agents never see.\n",
            file=sys.stderr,
        )
        for line in missing:
            print(f"  - {line}", file=sys.stderr)
        print(
            "\nIf an operation was deliberately retired, remove it from REQUIRED in\n"
            "scripts/check_shared_checkout_rules_in_sync.py in the same change.",
            file=sys.stderr,
        )
        return 1

    print(f"Shared-checkout git prohibitions in sync ({len(REQUIRED)} operations).")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
