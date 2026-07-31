#!/usr/bin/env python3
"""Check that no tracked file carries a NUL byte, which makes git and grep go blind.

A NUL reached ``apps/frontend/src/lib/billDetail.ts`` on main (#866, fixed in #870):
a template literal that should have joined two values with a space joined them with
``\\x00``. Every gate passed — Prettier reformatted around it, ``tsc`` type-checked
it, Vitest passed, the app behaved correctly — because a NUL is a legal (if
invisible) character inside a JavaScript string.

The damage was to the tools that read the file afterwards. **git and grep classify
any file containing a NUL as binary**, so:

- ``grep -rn citationsBySection apps/frontend/src`` reported the symbol as absent
  while it sat in the file, which reads as "that code was lost in the merge";
- ``git diff`` prints "Binary files a/… and b/… differ" instead of the change, so a
  reviewer sees no diff to review.

No repo file has a legitimate reason to hold one: real binary assets (images, fonts,
PDFs) are not the concern — this checks what git itself already recognises as text,
so a genuinely binary file is skipped rather than carved out by extension.

Exit status is non-zero if any file carries one, so CI can gate on it.
"""

from __future__ import annotations

import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]

# Extensions whose files are binary by nature, so a NUL is expected content.
BINARY_SUFFIXES = {
    ".png",
    ".jpg",
    ".jpeg",
    ".gif",
    ".webp",
    ".ico",
    ".pdf",
    ".ttf",
    ".otf",
    ".woff",
    ".woff2",
    ".zip",
    ".gz",
    ".mp4",
    ".keystore",
}


def tracked_files() -> list[Path]:
    """Every tracked path, minus vendored trees git may still be tracking."""
    out = subprocess.run(
        ["git", "ls-files", "-z"],
        cwd=ROOT,
        capture_output=True,
        check=True,
    ).stdout.split(b"\0")
    return [
        Path(rel.decode())
        for rel in out
        if rel and b"node_modules" not in rel
    ]


def find_problems() -> list[str]:
    problems = []
    for rel in tracked_files():
        path = ROOT / rel
        if not path.is_file() or path.is_symlink():
            continue
        data = path.read_bytes()
        offset = data.find(b"\0")
        if offset == -1:
            continue
        # A real binary asset is expected to hold NULs; only source is the concern.
        if rel.suffix.lower() in BINARY_SUFFIXES:
            continue
        line = data[:offset].count(b"\n") + 1
        problems.append(f"{rel}:{line}: NUL byte at offset {offset}")
    return problems


def main() -> int:
    problems = find_problems()
    if problems:
        print(f"Files carrying a NUL byte: {len(problems)}\n")
        for problem in sorted(problems):
            print(f"  {problem}")
        print(
            "\nA NUL byte makes git and grep treat the whole file as binary, so the "
            "code in it stops being searchable and its diffs stop being reviewable. "
            "Replace it with the character that was meant — usually a space."
        )
        return 1
    print("No tracked text file carries a NUL byte.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
