#!/usr/bin/env python3
"""Make a PR say what it did about the docs that describe the code it changed.

The problem this exists for: a code change silently makes a doc sentence false.
Every instance found in the Jul 29 2026 audit of
``docs/product-onboarding/search-bills-guide.md`` had the same shape — someone
changed behaviour, the doc that described that behaviour was not in front of
them, and nothing connected the two:

- the active-filter description was removed (#709) — the spec was updated, the
  plain-English guide was not, and kept promising a sentence that no longer
  rendered
- the "AI SUMMARY" eyebrow was removed for a cleaner card (#345) — both the spec
  and the guide kept claiming AI summaries are labelled, which they are not
- URL filter serialisation shipped (#135) — the spec still read "not built yet"
- "Passed both chambers" was added to the status dropdown (#607) — the spec's
  list of options was left at six

None of those authors were careless, and none would have called their change a
"scope change" (the trigger `.claude/rules/workflow.md` rule 6 was written
around), so a rule that asks people to remember to search never fired. Four
drifts came from ordinary implementation work.

So this check does not try to judge whether a doc is *correct* — a machine
cannot tell that "takes you right to that one bill" is false. It guarantees the
weaker but sufficient thing: **nobody changes described behaviour without the
describing doc being named to them, by name, at review time.** The look is what
was missing; the look is what this forces.

How the coupling is declared. Each doc that describes behaviour names the code
it describes, in its own text::

    <!-- describes: apps/frontend/src/screens/redesign/SearchBillsScreen.tsx -->
    <!-- describes: apps/frontend/src/components/search/*.tsx -->

The map lives in the doc that cares, not in a central registry here. A central
list is one more thing to forget; a line in the doc is right where someone
editing that doc will see it, and a new doc joins the check by adding one line.

What a PR must then do. If it changes a file some doc declares, and does not
also change that doc, its body needs one line naming the outcome::

    Docs check: updated search-bills-guide.md for the new sort labels
    Docs check: none needed — internal refactor, no user-visible change

Either answer passes. "None needed" is a first-class answer and always will be:
the goal is a considered look, not a doc edit per commit. Requiring an edit
would mean padding docs to please CI, and CI would deserve to be ignored.

Exit status is non-zero only when the body has no such line, so the failure is
always fixable by writing one sentence.
"""

from __future__ import annotations

import fnmatch
import os
import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]

# ``<!-- describes: <comma-separated globs> -->`` anywhere in a doc.
DESCRIBES = re.compile(r"<!--\s*describes:\s*(.+?)\s*-->", re.IGNORECASE | re.DOTALL)
# The acknowledgement line a PR body needs. Matched case-insensitively and
# anywhere in the body, so it can sit under a heading or in a checklist item.
ACK = re.compile(r"docs\s*check\s*:", re.IGNORECASE)


def declared_couplings() -> dict[str, list[str]]:
    """Map each declaring doc to the code globs it says it describes."""
    couplings: dict[str, list[str]] = {}
    for path in sorted((ROOT / "docs").rglob("*.md")):
        globs = [
            glob.strip()
            for match in DESCRIBES.findall(path.read_text(encoding="utf-8"))
            for glob in match.split(",")
            if glob.strip()
        ]
        if globs:
            couplings[str(path.relative_to(ROOT))] = globs
    return couplings


def changed_files(base: str) -> list[str]:
    """Files this branch changes relative to the merge base with ``base``."""
    merge_base = subprocess.run(
        ["git", "merge-base", "HEAD", base],
        cwd=ROOT,
        capture_output=True,
        text=True,
    )
    if merge_base.returncode != 0:
        # No shared history — a shallow clone, or the base ref was never fetched.
        # This fails loudly rather than returning "nothing changed", because a
        # guard that cannot run must not report success; that silent pass is the
        # exact failure mode this whole check exists to prevent. CI checks out
        # with fetch-depth: 0 so this should only fire on a setup mistake.
        raise SystemExit(
            f"check_doc_sync: no merge base with {base!r}. Fetch the base branch "
            "(CI needs actions/checkout with fetch-depth: 0)."
        )
    diff = subprocess.run(
        ["git", "diff", "--name-only", f"{merge_base.stdout.strip()}...HEAD"],
        cwd=ROOT,
        capture_output=True,
        text=True,
        check=True,
    )
    return [line for line in diff.stdout.splitlines() if line]


def main() -> int:
    base = os.environ.get("DOC_SYNC_BASE_REF", "origin/main")
    body = os.environ.get("DOC_SYNC_PR_BODY", "")

    changed = changed_files(base)
    if not changed:
        return 0

    couplings = declared_couplings()
    # Which declared docs describe something this PR touched, and were themselves
    # left alone.
    stale: dict[str, list[str]] = {}
    for doc, globs in couplings.items():
        if doc in changed:
            continue
        hits = [
            path
            for path in changed
            if any(fnmatch.fnmatch(path, glob) for glob in globs)
        ]
        if hits:
            stale[doc] = hits

    if not stale:
        return 0

    if ACK.search(body):
        print("Docs check acknowledged in the PR body. Docs possibly affected:")
        for doc, hits in sorted(stale.items()):
            print(f"  {doc} — describes {', '.join(sorted(hits))}")
        return 0

    print("This PR changes code that a doc describes, and neither the doc nor a")
    print("'Docs check:' line in the PR body says what happened about it.\n")
    for doc, hits in sorted(stale.items()):
        print(f"  {doc}")
        print(f"    describes: {', '.join(sorted(hits))}")
    print()
    print("Read each doc above and confirm it is still true of your change. Then")
    print("either update it, or add one line to the PR body, e.g.:\n")
    print("  Docs check: none needed — internal refactor, no user-visible change")
    print("  Docs check: updated search-bills-guide.md for the new sort labels\n")
    print("Both answers pass. The point is that the doc got looked at.")
    return 1


if __name__ == "__main__":
    sys.exit(main())
