#!/usr/bin/env python3
"""Check that every in-repo reference to a ``docs/`` file points at something real.

Two reference forms are validated:

1. Explicit ``docs/<path>.<ext>`` strings, wherever they appear — prose, code
   comments, YAML, or Markdown links. This is how the always-loaded rule files
   and the design skills point into ``docs/``; a wrong one silently misdirects
   every session, so it is checked across the whole tree.
2. Relative Markdown links inside ``docs/**`` — resolved against the linking
   file's own directory, so ``../`` depth is actually tested. This is the form
   the docs index uses, and the form a rename like #652 breaks.

Deliberately not checked:
- ``.claude/skills/workflow-overhead-audit/audits/`` — dated audit records name
  files as they were called when written; rewriting them would falsify history.
- Relative links outside ``docs/`` — e.g. a ``[Title](file.md)`` format template
  in a skill file is documentation-about-documentation, not a live link.

Exit status is non-zero if any reference dangles, so CI can gate on it.
"""

from __future__ import annotations

import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]

# Directory names whose contents are never scanned as reference sources.
SKIP_DIRS = ("node_modules", ".git")
# Path prefixes excluded as sources — dated, deliberately-stale records.
SKIP_PREFIXES = (".claude/skills/workflow-overhead-audit/audits/",)
# File types that can carry a docs reference.
SOURCE_SUFFIXES = (".md", ".py", ".ts", ".tsx", ".js", ".yml", ".yaml")

# ``docs/<path>.<ext>`` not preceded by a path or URL character, so a blob URL
# like ``github.com/.../docs/x.md`` is not mistaken for a repo path.
DOCS_PATH = re.compile(r"(?<![\w./-])docs/[\w./-]+\.\w+")
# A Markdown link target: ``[label](target)``.
MD_LINK = re.compile(r"\[[^\]]*\]\(([^)]+)\)")
# Targets that are not local files.
EXTERNAL = ("http://", "https://", "mailto:", "docs/")


def tracked_sources() -> list[Path]:
    out = subprocess.run(
        ["git", "ls-files"],
        cwd=ROOT,
        capture_output=True,
        text=True,
        check=True,
    ).stdout.split()
    files = []
    for rel in out:
        if any(part in SKIP_DIRS for part in rel.split("/")):
            continue
        if any(rel.startswith(prefix) for prefix in SKIP_PREFIXES):
            continue
        if rel.endswith(SOURCE_SUFFIXES):
            files.append(Path(rel))
    return files


def find_problems() -> list[str]:
    problems = []
    for rel in tracked_sources():
        text = (ROOT / rel).read_text(encoding="utf-8", errors="replace")

        # Form 1 — explicit docs/ paths, anywhere in the file.
        for match in DOCS_PATH.finditer(text):
            if not (ROOT / match.group()).exists():
                problems.append(f"{rel}: docs path -> {match.group()}")

        # Form 2 — relative Markdown links, only inside docs/.
        if rel.suffix == ".md" and rel.parts[0] == "docs":
            for raw in MD_LINK.findall(text):
                target = raw.split("#", 1)[0].strip()
                if not target or target.startswith(EXTERNAL):
                    continue
                if not ((ROOT / rel).parent / target).exists():
                    problems.append(f"{rel}: relative link -> {target}")
    return problems


def main() -> int:
    problems = find_problems()
    if problems:
        print(f"Broken doc references: {len(problems)}\n")
        for problem in sorted(problems):
            print(f"  {problem}")
        print(
            "\nEvery docs/ reference must point at a real file. "
            "Fix the path, or the target that moved."
        )
        return 1
    print("All doc references resolve.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
