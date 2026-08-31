#!/usr/bin/env python3
"""Make a PR explain affected docs and edits to the temporary sign-in record.

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

**Editing the doc used to be a free pass. It no longer is (Jul 30 2026).** The
original rule skipped a doc entirely if the PR touched it, on the reasoning that
someone who already fixed the guide shouldn't have to also write a line saying
so. That reasoning assumed an edit implies a read, and two PRs an hour apart
proved it doesn't. #784 added a half-price batch queue to the enrichment runner
and updated §4.1 of ``docs/product-onboarding/ai-models-and-billing.md``; #785
added prompt caching and rewrote the same §4.1. Both passed this check on the
strength of that edit. Neither looked at §4, one screen above, which still
described a runner that took **neither** discount — so the guide contradicted
itself within a page, and shipped that way twice.

The instructive part is *why* a partial edit was so easy to mistake for a whole
one. Of the four sentences left false in §4, only two carried a hedging word a
grep could find ("*would* bill the same work at 50% off"). The most damaging one
was a flat assertion with no tell at all: "the API path pays full list price."
No pattern match finds that. Only reading the section does. So this check does
not try to guess which sentences went stale — it makes the author state a
conclusion about the doc as a whole, which is the cheapest checkable proxy for
having read it.

The cost of closing the hole is one sentence on a PR that both changes described
code and edits its doc. That is a real cost and it is worth paying: the hole cost
two PRs and a self-contradicting page in a public repo.

A separate ``Design change:`` acknowledgement used to gate edits to the one
temporary design bundle under ``docs/`` (``docs/mockups/sign-in/``, #1469). The
rev 17 sign-in build (#1533) reconciled that bundle into the feature guides and
removed the folder, so the gate went with it — design working files no longer
land under ``docs/`` at all (#1534).
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
# A fenced code block is an *example*, not a declaration. Stripped before the scan
# above runs, because this is a raw-text regex and not a Markdown parser, so it
# cannot otherwise tell the two apart. #919 wrote a decision record that showed the
# comment's syntax inside a fence; the guard read the example as real and spent an
# hour telling every PR that touched SearchBillsScreen.tsx to re-read a document
# about docs policy. Found by the #918 pass (PR #921), which worked around it by
# rewriting the example with placeholder paths -- a workaround that leaves the trap
# armed for the next person who documents this file.
FENCE = re.compile(r"^[ \t]*(`{3,}|~{3,}).*?(?:^[ \t]*\1[ \t]*$|\Z)", re.S | re.M)
# The acknowledgement line a PR body needs. Matched case-insensitively and
# anywhere in the body, so it can sit under a heading or in a checklist item.
ACK = re.compile(r"docs\s*check\s*:", re.IGNORECASE)


def declared_couplings() -> dict[str, list[str]]:
    """Map each declaring doc to the code globs it says it describes."""
    couplings: dict[str, list[str]] = {}
    for path in sorted((ROOT / "docs").rglob("*.md")):
        globs = [
            glob.strip()
            for match in DESCRIBES.findall(
                FENCE.sub("", path.read_text(encoding="utf-8"))
            )
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
    # Which declared docs describe something this PR touched. Editing the doc is
    # deliberately NOT an exemption — see the module docstring: a partial edit
    # passed this check twice while leaving the same file contradicting itself.
    stale: dict[str, list[str]] = {}
    for doc, globs in couplings.items():
        hits = [
            path
            for path in changed
            if any(fnmatch.fnmatch(path, glob) for glob in globs)
        ]
        if hits:
            stale[doc] = hits

    failed = False
    if stale and ACK.search(body):
        print("Docs check acknowledged in the PR body. Docs possibly affected:")
        for doc, hits in sorted(stale.items()):
            print(f"  {doc} — describes {', '.join(sorted(hits))}")
    elif stale:
        failed = True
        print("This PR changes code that a doc describes, and the PR body has no")
        print("'Docs check:' line saying what happened about it.\n")
        for doc, hits in sorted(stale.items()):
            edited = " (this PR edits it)" if doc in changed else ""
            print(f"  {doc}{edited}")
            print(f"    describes: {', '.join(sorted(hits))}")
        print()
        print("Read each doc above — the WHOLE doc, not just the part you edited — and")
        print("confirm it is still true of your change. Then add one line to the PR")
        print("body, e.g.:\n")
        print("  Docs check: none needed — internal refactor, no user-visible change")
        print("  Docs check: updated search-bills-guide.md for the new sort labels")
        print("  Docs check: reread ai-models-and-billing.md §4 and §4.1; fixed §4\n")
        print("Any of those passes. The point is that the doc got looked at, and that")
        print("you say what you concluded. Editing part of a doc is not the same as")
        print("having read it: a partial edit passed this check twice and shipped a")
        print("page that contradicted itself.\n")
        print("Two things that look like they should work and do not:")
        print(
            "  - The colon is part of what is matched. A '## Docs check' heading with"
        )
        print("    no colon does not count; write 'Docs check:' somewhere in the body.")
        print("  - Editing the PR body does NOT fix an already-failed run. This job")
        print("    reads the body from the event that started it, and re-running a job")
        print("    replays that same event. Push a commit, or close and reopen the PR,")
        print("    to get a run that sees the new body.\n")

    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
