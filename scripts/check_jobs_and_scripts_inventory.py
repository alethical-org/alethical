#!/usr/bin/env python3
"""Fail the build when ``docs/operations/jobs-and-scripts.md`` disagrees with the repo.

That page is the inventory of every automated job and every command-line tool here,
and it states its own purpose: the complete list is grouped there "so a new file
cannot hide inside a total". A total a person has to remember to update is exactly
how a file hides inside one, and it failed twice inside a week:

* `#1869 <https://github.com/alethical-org/alethical/issues/1869>`_ — the page said 48
  runnable scripts against 55 real ones, named 5 scripts nowhere, and named 2 whole
  workflows nowhere.
* 1 Sep 2026 — 57 runnable scripts on disk against 55 stated, with
  ``backfill_campaign_finance_filed_dates.py`` and
  ``check_campaign_finance_stated_spending.py`` in no table. Corrected in
  `PR #1890 <https://github.com/alethical-org/alethical/pull/1890>`_.

**What it checks.**

1. Every runnable file directly inside ``scripts/`` appears in the page's
   command-line-tools table. The ``scripts/tests/`` directory is excluded, matching the
   page's own scope.
2. Every script the table names exists on disk, so a rename or deletion cannot leave a
   dangling name.
3. The runnable-file count in the page's prose equals what is on disk.
4. Every workflow file in ``.github/workflows/`` is named somewhere on the page, and
   every workflow the page names exists.
5. The 4 workflow counts in the prose: the total, how many can start on their own, how
   many only a person can start, and how many are clock-based. Each is read off the
   ``on:`` block of every workflow file.
6. The count of scripts a GitHub job runs, read off the ``run:`` steps of every
   workflow file.

**Deliberately not checked.**

* *"the Mac backup above calls 1"*. That caller is a launchd job installed on one Mac
  (``com.alethical.wip-backup``), not anything in this repository, so there is nothing
  here to count it from.
* Which purpose group a script belongs in, and every cost, trigger-time, and
  description cell. Those are judgments, not counts; a check that guessed them would
  fire on correct edits.
* Scripts a workflow reaches indirectly, through a ``just`` recipe or another script.
  Check 6 counts a script as run when its ``scripts/<name>`` path appears in a
  workflow's ``run:`` step. Nothing in the repo does that today. If something ever
  does, the page's sentence and this check both need the indirection spelled out, and
  the failure message says so.

A prose sentence that has been reworded so a pattern below no longer matches it exactly
once is itself a failure, with its own message. Otherwise a rewrite would silently
switch the count off, which is the failure this whole check exists to stop.

Pure stdlib, so the ``changes`` job can run it on every event.
"""

from __future__ import annotations

import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DOC = Path("docs/operations/jobs-and-scripts.md")
SCRIPTS = Path("scripts")
WORKFLOWS = Path(".github/workflows")

#: Directory inside ``scripts/`` the page deliberately leaves out of its list and
#: totals: those files are tests for the scripts, not tools anyone runs.
SCRIPTS_SKIP_DIRS = ("tests",)
#: Names inside ``scripts/`` that are not runnable files.
SCRIPTS_SKIP_PREFIXES = (".", "__")

#: The page's heading for the section that lists the command-line tools. Its tables are
#: the inventory; the sections after it name pipeline modules and script paths that are
#: not part of the list, so the search is bounded to this one section.
INVENTORY_HEADING = "## Command-line tools"

#: A script filename in backticks, as the inventory table writes them.
TABLE_NAME = re.compile(r"`([^`/\s]+\.[A-Za-z0-9]+)`")
#: A workflow path anywhere on the page.
WORKFLOW_PATH = re.compile(r"\.github/workflows/([\w.\-]+\.ya?ml)")
#: A ``scripts/<name>`` path, not preceded by another path segment, so
#: ``apps/frontend/scripts/traffic-token-expiry.mjs`` is not read as one of ours.
WORKFLOW_SCRIPT_CALL = re.compile(r"(?<![\w./-])scripts/([\w.\-]+\.[A-Za-z0-9]+)")

#: Each prose count, as a pattern that must match the page exactly once. The key names
#: what the number means; the value's ``count`` group holds the digits.
PROSE_COUNTS = {
    "workflows in total": r"The repository has (?P<count>\d+) GitHub Actions workflows",
    "workflows that can start on their own": (
        r"(?P<count>\d+) can start automatically"
    ),
    "workflows only a person can start": (
        r"(?P<count>\d+) run only when a person starts them"
    ),
    "workflows only a person can start, restated in the second table": (
        r"These (?P<count>\d+) workflows complete the total of \d+"
    ),
    "workflows in total, restated in the second table": (
        r"These \d+ workflows complete the total of (?P<count>\d+)"
    ),
    "clock-based workflows": r"The (?P<count>\d+) clock-based GitHub jobs use UTC",
    "runnable files in scripts/": (
        r"The `scripts/` folder has (?P<count>\d+) runnable files"
    ),
    "scripts a GitHub job runs": r"GitHub jobs call (?P<count>\d+) of them",
}

FIX = (
    f"Correct {DOC} in the same change: its name lists and every count in its prose "
    "have to describe what the repository now holds."
)


def runnable_scripts(root: Path) -> set[str]:
    """Every runnable file directly inside ``scripts/``, by filename."""
    found = set()
    for path in (root / SCRIPTS).iterdir():
        if path.name.startswith(SCRIPTS_SKIP_PREFIXES):
            continue
        if path.is_dir():
            continue
        found.add(path.name)
    return found


def inventory_names(doc_text: str) -> set[str]:
    """Every filename the page's command-line-tools table names."""
    after = doc_text.split(INVENTORY_HEADING, 1)[1]
    section = after.split("\n## ", 1)[0]
    rows = [line for line in section.splitlines() if line.lstrip().startswith("|")]
    return {name for row in rows for name in TABLE_NAME.findall(row)}


def workflow_triggers(text: str) -> set[str] | None:
    """The top-level keys of a workflow's ``on:`` block, or ``None`` if unreadable.

    Read line by line rather than with a YAML parser, because this check has to stay
    dependency-free to run in the ``changes`` job. Every workflow here writes ``on:``
    as a block with its keys indented under it; anything else returns ``None`` so the
    caller reports it instead of counting it wrong.
    """
    lines = text.splitlines()
    start = next((i for i, line in enumerate(lines) if line.rstrip() == "on:"), None)
    if start is None:
        return None
    keys: set[str] = set()
    indent = None
    for line in lines[start + 1 :]:
        if not line.strip() or line.lstrip().startswith("#"):
            continue
        depth = len(line) - len(line.lstrip())
        if depth == 0:
            break
        if indent is None:
            indent = depth
        if depth != indent:
            continue
        key = line.strip().split(":", 1)[0].strip()
        if key:
            keys.add(key)
    return keys or None


def scripts_run_by_workflows(root: Path) -> set[str]:
    """Every ``scripts/`` file named inside a workflow's ``run:`` step."""
    called: set[str] = set()
    for path in sorted((root / WORKFLOWS).glob("*.y*ml")):
        in_run = False
        run_indent = 0
        for line in path.read_text(encoding="utf-8").splitlines():
            opens_run = re.match(r"^(\s*)(?:-\s+)?run:\s*(.*)$", line)
            if opens_run:
                in_run = True
                run_indent = len(opens_run.group(1))
                called.update(WORKFLOW_SCRIPT_CALL.findall(line))
                continue
            if not in_run:
                continue
            if line.strip() and len(line) - len(line.lstrip()) <= run_indent:
                in_run = False
                continue
            called.update(WORKFLOW_SCRIPT_CALL.findall(line))
    return called


def prose_counts(doc_text: str) -> tuple[dict[str, int], list[str]]:
    """Each prose count, plus a problem for every sentence that no longer matches once.

    The page wraps its lines, so whitespace is flattened before matching.
    """
    flat = " ".join(doc_text.split())
    counts: dict[str, int] = {}
    problems: list[str] = []
    for meaning, pattern in PROSE_COUNTS.items():
        matches = list(re.finditer(pattern, flat))
        if len(matches) != 1:
            problems.append(
                f"{DOC}: the sentence stating the {meaning} matched "
                f"{len(matches)} times, and it has to match exactly once. It was "
                f"reworded, so this count is no longer being checked. Restore the "
                f"wording, or update PROSE_COUNTS['{meaning}'] in "
                f"scripts/{Path(__file__).name} to the new wording."
            )
            continue
        counts[meaning] = int(matches[0].group("count"))
    return counts, problems


def find_problems(root: Path = ROOT, doc: Path = DOC) -> list[str]:
    problems: list[str] = []
    doc_text = (root / doc).read_text(encoding="utf-8")

    # 1 and 2 — the script list, both directions.
    on_disk = runnable_scripts(root)
    listed = inventory_names(doc_text)
    for name in sorted(on_disk - listed):
        problems.append(f"scripts/{name} is on disk and in no table on {doc}. {FIX}")
    for name in sorted(listed - on_disk):
        problems.append(
            f"{doc} names scripts/{name}, and no such file is in scripts/. "
            f"It was renamed or deleted. {FIX}"
        )

    # 4 — the workflow list, both directions.
    workflow_files = sorted(p.name for p in (root / WORKFLOWS).glob("*.y*ml"))
    named_workflows = set(WORKFLOW_PATH.findall(doc_text))
    for name in workflow_files:
        if name not in named_workflows:
            problems.append(
                f".github/workflows/{name} exists and is named nowhere on {doc}. "
                f"Add a row for it to the automatic or by-hand table, and correct "
                f"the workflow counts in the prose."
            )
    for name in sorted(named_workflows - set(workflow_files)):
        problems.append(
            f"{doc} names .github/workflows/{name}, and no such workflow exists. "
            f"It was renamed or deleted."
        )

    # 5 — the workflow counts, from each workflow's own triggers.
    automatic = 0
    clock_based = 0
    for path in sorted((root / WORKFLOWS).glob("*.y*ml")):
        triggers = workflow_triggers(path.read_text(encoding="utf-8"))
        if triggers is None:
            problems.append(
                f".github/workflows/{path.name} has no readable `on:` block, so its "
                f"triggers cannot be counted. Write `on:` at the start of a line with "
                f"its triggers indented under it, as the other workflows do."
            )
            continue
        if triggers - {"workflow_dispatch"}:
            automatic += 1
        if "schedule" in triggers:
            clock_based += 1
    by_hand = len(workflow_files) - automatic

    # 6 — the scripts a GitHub job runs.
    run_by_workflows = scripts_run_by_workflows(root) & on_disk

    counts, prose_problems = prose_counts(doc_text)
    problems.extend(prose_problems)

    measured = {
        "workflows in total": len(workflow_files),
        "workflows in total, restated in the second table": len(workflow_files),
        "workflows that can start on their own": automatic,
        "workflows only a person can start": by_hand,
        "workflows only a person can start, restated in the second table": by_hand,
        "clock-based workflows": clock_based,
        "runnable files in scripts/": len(on_disk),
        "scripts a GitHub job runs": len(run_by_workflows),
    }
    for meaning, real in measured.items():
        stated = counts.get(meaning)
        if stated is None or stated == real:
            continue
        problems.append(
            f"{doc} says {stated} for the {meaning}, and the repository has {real}. {FIX}"
        )
    return problems


def main() -> int:
    if not (ROOT / DOC).is_file():
        print(f"{DOC} not found; run this from the repository root")
        return 1
    problems = find_problems()
    if problems:
        print(f"{DOC} disagrees with the repository: {len(problems)} problem(s)\n")
        for problem in problems:
            print(f"  {problem}")
        print(
            "\nThat page is the one place a new job or script is listed, so a stale "
            "count there is a file hiding inside a total."
        )
        return 1
    print(f"{DOC} matches the jobs and scripts the repository holds.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
