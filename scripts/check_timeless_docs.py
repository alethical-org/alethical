"""Fail a PR whose ADDED doc lines narrate decision history (workflow rule 16).

`.claude/rules/workflow.md` rule 16 requires docs to state what is true now:
no "used to work the other way", no "as of February 2", no story of how we
changed our minds. This is the enforcement half, and it reads only the lines a
branch ADDS relative to its merge base, so the existing corpus and every
legitimate kept use (runtime behaviour like "an anchor whose position no
longer matches", kept decision evidence) never trip it.

Exempt from history narration checks, but not internal attribution checks: dated snapshots. The
published-writing corrections log (whose format is
before/after by design), measurement and audit records, research findings,
and the posted pieces' source files.

A legitimate history-narration use on an added line carries an inline escape on that line:
    <!-- timeless-check-ignore: <why this is evidence, not narration> -->

Run locally:  python scripts/check_timeless_docs.py   (base: origin/main,
override with TIMELESS_BASE_REF).
"""

from __future__ import annotations

import os
import re
import subprocess
import sys

HISTORY_PREFIXES = ("docs/", ".claude/rules/", "AGENTS.md")

EXEMPT = (
    "docs/published-writing/",  # posted pieces' source of record (grounded-answers rule 13)
    "docs/published-writing-corrections.md",  # before/after per correction is its purpose
    "docs/research/",  # dated research findings
    "docs/operations/production-database-schema-drift.md",  # dated audit record
    "docs/operations/keeping-docs-current-decisions.md",  # measurement log
    "docs/operations/android-prototype-handoff.md",  # dated handoff
)

IGNORE = "timeless-check-ignore:"
SOURCE_QUOTE = re.compile(r"<!-- doc-voice-source: https://[^\s<>]+ -->")

# These checks also apply to dated records. They target decision attribution,
# not names in biographies, source citations, commands or public records.
MONTH = r"(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*"
PERSON = r"(?:Eugene(?: Lopin)?|Angel(?: Zierden)?)"
ATTRIBUTION_PATTERNS = [
    (
        re.compile(
            rf"\b{PERSON}(?:['’]s)?\s+(?:requested|instructed|asked|said|wants?|"
            r"wanted|approved|authorized|directed|ruled|decided|confirmed|review|"
            r"decision|instruction|call)\b",
            re.IGNORECASE,
        ),
        "internal personal attribution",
    ),
    (
        re.compile(
            rf"\b(?:requested|instructed|asked|approved|authorized|directed|ruled|"
            rf"decided|confirmed)\s+by\s+{PERSON}\b",
            re.IGNORECASE,
        ),
        "internal personal attribution",
    ),
    (
        re.compile(
            rf"\({PERSON},?\s+\d*\s*{MONTH}\b",
            re.IGNORECASE,
        ),
        "named decision note",
    ),
    (
        re.compile(
            rf"\b(?:{PERSON}|the (?:user|maintainer|team)|Alethical|then)\s+"
            r"(?:instructed|requested|asked|said|directed|wrote)(?:\s+us)?"
            r"(?:\s+(?:to|that))?\s*:?\s*[\"“‘`]",
            re.IGNORECASE,
        ),
        "quoted instruction; summarize the outcome and limits",
    ),
    (
        re.compile(
            r"\b(?:user authorization|approval|explicit instruction|user request)"
            r"\s*:\s*[\"“‘`]",
            re.IGNORECASE,
        ),
        "quoted instruction label; summarize the outcome and limits",
    ),
]


def line_findings(path: str, text: str) -> list[str]:
    findings = (
        []
        if SOURCE_QUOTE.search(text)
        else [label for pattern, label in ATTRIBUTION_PATTERNS if pattern.search(text)]
    )
    if (
        path.startswith(HISTORY_PREFIXES)
        and not path.startswith(EXEMPT)
        and IGNORE not in text
    ):
        findings.extend(label for pattern, label in PATTERNS if pattern.search(text))
    return findings


PATTERNS = [
    (
        re.compile(rf"\bas of {MONTH}\b", re.IGNORECASE),
        'dated status ("as of <month>")',
    ),
    (
        re.compile(
            r"\bused to (?:be|say|sit|read|store|work|do|carry|show|call|serve|have|mean|require|live)\b"
        ),
        'history narration ("used to ...")',
    ),
    (
        re.compile(
            r"\b(?:this|that) (?:replaces|reverses|supersedes) (?:an|the) earlier\b",
            re.IGNORECASE,
        ),
        "change narration",
    ),
    (re.compile(r"\ban earlier version of this\b", re.IGNORECASE), "change narration"),
    (
        re.compile(r"\bwe (?:used to|previously|originally) \b", re.IGNORECASE),
        'history narration ("we used to ...")',
    ),
    (
        re.compile(r"\bnow (?:that we|we no longer)\b", re.IGNORECASE),
        "change narration",
    ),
]


def added_doc_lines(base: str) -> list[tuple[str, int, str]]:
    """(path, new-file line number, text) for every added line under the checked paths."""
    merge_base = subprocess.run(
        ["git", "merge-base", "HEAD", base], capture_output=True, text=True
    )
    if merge_base.returncode != 0:
        print(
            f"check_timeless_docs: no merge base with {base!r}. Fetch the base "
            "branch first (see ci.yml).",
            file=sys.stderr,
        )
        raise SystemExit(2)
    diff = subprocess.run(
        [
            "git",
            "diff",
            "--unified=0",
            f"{merge_base.stdout.strip()}...HEAD",
            "--",
            "*.md",
        ],
        capture_output=True,
        text=True,
        check=True,
    ).stdout

    out: list[tuple[str, int, str]] = []
    path = ""
    lineno = 0
    checked = False
    for raw in diff.splitlines():
        if raw.startswith("+++ b/"):
            path = raw[6:]
            checked = True
            continue
        if raw.startswith("@@"):
            m = re.search(r"\+(\d+)", raw)
            lineno = int(m.group(1)) if m else 0
            continue
        if raw.startswith("+") and not raw.startswith("+++"):
            if checked:
                out.append((path, lineno, raw[1:]))
            lineno += 1
    return out


def main() -> int:
    base = os.environ.get("TIMELESS_BASE_REF", "origin/main")
    failures = []
    previous: tuple[str, int, str] | None = None
    for path, lineno, text in added_doc_lines(base):
        labels = line_findings(path, text)
        if (
            previous is not None
            and previous[:2] == (path, lineno - 1)
            and not SOURCE_QUOTE.search(text)
        ):
            # A wrapped attribution remains attribution. Do not join separate hunks.
            joined = previous[2] + " " + text
            labels.extend(
                label
                for pattern, label in ATTRIBUTION_PATTERNS
                if pattern.search(joined) and not pattern.search(previous[2])
            )
        for label in dict.fromkeys(labels):
            failures.append(f"{path}:{lineno}: {label}: {text.strip()[:120]}")
        previous = (path, lineno, text)
    if failures:
        print(
            "New documentation contains decision narration or internal attribution. Rule 16 "
            "(.claude/rules/workflow.md): state what is true now; git holds the "
            "history. Summarize internal instructions without personal attribution. "
            "Rewrite as a present-tense rule with the old behaviour "
            "banned, not narrated -- or, for history narration only, when the line is evidence under "
            f"a rule, append `<!-- {IGNORE} <why> -->` on that line.\n",
            file=sys.stderr,
        )
        for f in failures:
            print(f"  {f}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
