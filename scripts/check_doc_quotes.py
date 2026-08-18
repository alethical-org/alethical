#!/usr/bin/env python3
"""Fail when an opted-in guide quotes text absent from its declared code.

This is deliberately narrow. A guide opts in with::

    <!-- check-quoted-code: true -->

Only exact-looking values are checked: hex colours, constant or call names,
key/value examples, and short UI copy carrying distinctive punctuation. Ordinary
prose and example search terms stay out because treating every quoted phrase as a
code claim produced too many false alarms in the audit that led to #943.
"""

from __future__ import annotations

import difflib
import glob
import re
import sys
from pathlib import Path
from typing import NamedTuple

ROOT = Path(__file__).resolve().parents[1]

DESCRIBES = re.compile(r"<!--\s*describes:\s*(.+?)\s*-->", re.I | re.S)
OPT_IN = re.compile(r"<!--\s*check-quoted-code\s*:\s*true\s*-->", re.I)
FENCE = re.compile(r"^[ \t]*(`{3,}|~{3,}).*?(?:^[ \t]*\1[ \t]*$|\Z)", re.S | re.M)
BACKTICK = re.compile(r"(?<!`)`([^`\n]+)`(?!`)")
DOUBLE_QUOTED = re.compile(r'"([^"\n]+)"')
IGNORE_COMMENT = re.compile(r"<!--\s*quote-check-ignore\s*:(.*?)-->", re.I)
REASONED_IGNORE = re.compile(
    r"<!--\s*quote-check-ignore\s*:\s*([^|\n]+?)\s*\|\s*(\S[^\n]*?)\s*-->",
    re.I,
)
HEX_COLOUR = re.compile(r"#[0-9a-fA-F]{6}(?:[0-9a-fA-F]{2})?")
KEY_VALUE = re.compile(r"[a-z_][a-z0-9_]*\s*:\s*[\"'][^\"']+[\"']")
CALL_NAME = re.compile(r"[A-Za-z_][A-Za-z0-9_.]*\(\)")
CODE_STRING = re.compile(r'"([^"\n]{2,})"|\'([^\'\n]{2,})\'')
CODE_TOKEN = re.compile(r"#[0-9a-fA-F]{6,8}|[A-Za-z_][A-Za-z0-9_.]*(?:\(\))?")
DISTINCTIVE_UI_MARKS = ("→", "…", "...", "·", "{", "}")


class Candidate(NamedTuple):
    value: str
    line: int


def _without_fences(text: str) -> str:
    """Remove examples while keeping their newline count for useful line numbers."""
    return FENCE.sub(lambda match: "\n" * match.group(0).count("\n"), text)


def _looks_checkable(value: str) -> bool:
    if HEX_COLOUR.fullmatch(value) or KEY_VALUE.fullmatch(value):
        return True
    if CALL_NAME.fullmatch(value):
        return True
    letters = [character for character in value if character.isalpha()]
    if (
        len(letters) >= 4
        and not any(character.isdigit() for character in value)
        and all(character.isupper() for character in letters)
    ):
        return True
    return any(mark in value for mark in DISTINCTIVE_UI_MARKS)


def extract_candidates(text: str) -> list[Candidate]:
    """Return exact-looking quoted claims, with their original line numbers."""
    searchable = _without_fences(text)
    found: list[Candidate] = []
    seen: set[tuple[str, int]] = set()
    for pattern in (BACKTICK, DOUBLE_QUOTED):
        for match in pattern.finditer(searchable):
            value = match.group(1).strip()
            line = searchable.count("\n", 0, match.start()) + 1
            key = (value, line)
            if value and _looks_checkable(value) and key not in seen:
                found.append(Candidate(value=value, line=line))
                seen.add(key)
    return sorted(found, key=lambda candidate: (candidate.line, candidate.value))


def _declared_globs(text: str) -> list[str]:
    return [
        item.strip()
        for match in DESCRIBES.findall(_without_fences(text))
        for item in match.split(",")
        if item.strip()
    ]


def _declared_files(root: Path, patterns: list[str]) -> list[Path]:
    files: set[Path] = set()
    for pattern in patterns:
        for raw in glob.glob(str(root / pattern), recursive=True):
            path = Path(raw)
            if path.is_file():
                files.add(path)
    return sorted(files)


def _ignores(text: str, relative_doc: str) -> tuple[set[str], list[str]]:
    ignored = {match.group(1).strip() for match in REASONED_IGNORE.finditer(text)}
    problems: list[str] = []
    for match in IGNORE_COMMENT.finditer(text):
        if REASONED_IGNORE.fullmatch(match.group(0)) is None:
            line = text.count("\n", 0, match.start()) + 1
            problems.append(
                f"{relative_doc}:{line}: quote-check-ignore needs a reason after '|'"
            )
    return ignored, problems


def _nearest(value: str, code_text: str) -> str | None:
    choices = {
        next(part for part in match.groups() if part is not None)
        for match in CODE_STRING.finditer(code_text)
    }
    choices.update(match.group(0) for match in CODE_TOKEN.finditer(code_text))
    matches = difflib.get_close_matches(value, sorted(choices), n=1, cutoff=0.35)
    return matches[0] if matches else None


def find_problems(
    root: Path = ROOT, *, include_all_declared: bool = False
) -> list[str]:
    problems: list[str] = []
    for doc in sorted((root / "docs").rglob("*.md")):
        text = doc.read_text(encoding="utf-8")
        stripped = _without_fences(text)
        opted_in = OPT_IN.search(stripped) is not None
        if not include_all_declared and not opted_in:
            continue

        relative_doc = str(doc.relative_to(root))
        patterns = _declared_globs(text)
        if not patterns:
            if include_all_declared and not opted_in:
                continue
            problems.append(
                f"{relative_doc}: quote check is enabled but no describes declaration exists"
            )
            continue
        code_files = _declared_files(root, patterns)
        if not code_files:
            problems.append(
                f"{relative_doc}: its describes declaration matches no code files"
            )
            continue

        ignored, ignore_problems = _ignores(text, relative_doc)
        problems.extend(ignore_problems)
        code_text = "\n".join(
            path.read_text(encoding="utf-8", errors="replace") for path in code_files
        )
        for candidate in extract_candidates(text):
            if candidate.value in ignored or candidate.value in code_text:
                continue
            nearest = _nearest(candidate.value, code_text)
            suffix = (
                f"; nearest code text: {nearest!r}"
                if nearest is not None
                else "; no similar code text found"
            )
            problems.append(
                f"{relative_doc}:{candidate.line}: quoted {candidate.value!r} does not "
                f"appear in its declared code{suffix}"
            )
    return problems


def main() -> int:
    problems = find_problems()
    if problems:
        print(f"Quoted doc claims missing from code: {len(problems)}\n")
        for problem in problems:
            print(f"  {problem}")
        print(
            "\nFix the guide or the code. If the old wording is deliberately kept as "
            "history, add '<!-- quote-check-ignore: exact wording | reason -->'."
        )
        return 1
    print("Checked doc quotes still appear in their declared code.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
