#!/usr/bin/env python3
"""Check that no tracked file carries an unresolved merge-conflict marker.

``docs/product-onboarding/campaign-money-section-guide.md`` reached main carrying a
whole conflict block -- ``<<<<<<< HEAD``, ``=======``, ``>>>>>>> origin/main`` -- in
[#1683](https://github.com/alethical-org/alethical/pull/1683), merged 20 Aug 2026,
and it sat there for 7 days. Every gate passed, because nothing checked: the markers
were in a Markdown file, so no compiler, formatter or test ever read them, and the
doc-sync check asks whether a doc was *looked at*, not whether it parses.

The damage is worse in a doc than in code. That guide loads into the reading of every
session working the campaign money section, and both sides of the conflict were
plausible prose describing the same screens -- one side had the money-out total and
the payments-not-donors rule, the other had the Filings tab and the longer list of
split-refusal states. So a reader got 2 contradicting accounts of the same page with
no signal which was current, and each side was missing something true. Resolved as
the union of both in [#1696](https://github.com/alethical-org/alethical/issues/1696),
checked against the code rather than by picking a side.

A marker is a line beginning with exactly 7 ``<``, ``=`` or ``>`` followed by a space
or the end of the line, which is what git writes and what prose does not. This file
is the one exception: it has to name the strings to look for them.

Exit status is non-zero if any file carries one, so CI can gate on it.
"""

from __future__ import annotations

import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]

# Exactly what `git merge` writes at the start of a line. A 7-character run is
# required, so a Markdown blockquote (`> `), a setext underline (`===`) or an HTML
# comparison in prose never matches.
MARKER = re.compile(r"^(<{7}|={7}|>{7})( |$)")

# This checker has to spell the markers out to search for them.
EXEMPT = {Path("scripts/check_no_merge_conflict_markers.py")}

# Binary by nature, so their bytes are not prose to be scanned.
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
    return [Path(rel.decode()) for rel in out if rel and b"node_modules" not in rel]


def find_problems() -> list[str]:
    problems = []
    for rel in tracked_files():
        if rel in EXEMPT or rel.suffix.lower() in BINARY_SUFFIXES:
            continue
        path = ROOT / rel
        if not path.is_file() or path.is_symlink():
            continue
        try:
            text = path.read_text(encoding="utf-8")
        except (UnicodeDecodeError, OSError):
            continue
        for number, line in enumerate(text.splitlines(), start=1):
            if MARKER.match(line):
                problems.append(f"{rel}:{number}: {line[:40]}")
    return problems


def main() -> int:
    problems = find_problems()
    if problems:
        print(f"Unresolved merge-conflict markers: {len(problems)}\n")
        for problem in problems:
            print(f"  {problem}")
        print(
            "\nA conflict block that reaches main leaves 2 contradicting versions of "
            "the same content with nothing saying which is current. Resolve it as the "
            "union of what is actually true, checked against the code, rather than by "
            "picking a side."
        )
        return 1
    print("No tracked file carries an unresolved merge-conflict marker.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
