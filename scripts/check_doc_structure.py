#!/usr/bin/env python3
"""Keep tracked design exports out and Markdown documents reachable from an index.

Only README.md and index.md are indexes. A link to a directory reaches its index,
not every document inside it. Links in ordinary guides do not replace an index
entry. Deleted working files are omitted so the check also works before staging.
"""

from __future__ import annotations

import posixpath
import re
import subprocess
import sys
from pathlib import Path, PurePosixPath
from urllib.parse import unquote, urlsplit

ROOT = Path(__file__).resolve().parents[1]
ENTRY = "docs/README.md"
INDEX_NAMES = {"readme.md", "index.md"}
INLINE_LINK = re.compile(r"\[[^\]\n]*\]\(\s*(?:<([^>\n]+)>|([^\n]*?))\s*\)")
REFERENCE_LINK = re.compile(r"\[([^\]\n]+)\](?:\[([^\]\n]*)\])?")
DEFINITION = re.compile(r"^ {0,3}\[([^\]\n]+)\]:\s*(<[^>\n]+>|\S+)", re.MULTILINE)


def tracked_files(root: Path) -> set[str]:
    output = subprocess.run(
        ["git", "ls-files", "-z"],
        cwd=root,
        check=True,
        capture_output=True,
        text=True,
    ).stdout
    return {name for name in output.split("\0") if name and (root / name).is_file()}


def link_targets(text: str) -> list[str]:
    # Examples and hidden notes are not navigable entries for a reader.
    text = re.sub(r"<!--.*?-->", "", text, flags=re.DOTALL)
    text = re.sub(
        r"^ {0,3}(`{3,}|~{3,}).*?^ {0,3}\1[^\n]*$",
        "",
        text,
        flags=re.MULTILINE | re.DOTALL,
    )
    text = re.sub(r"`[^`\n]*`", "", text)
    definitions = {
        " ".join(label.lower().split()): target.strip("<>")
        for label, target in DEFINITION.findall(text)
    }
    text = DEFINITION.sub("", text)
    targets = []
    for angle_target, plain_target in INLINE_LINK.findall(text):
        # Retain spaces in paths, but remove an optional Markdown link title.
        target = angle_target or re.sub(r'\s+["\'].*["\']\s*$', "", plain_target)
        targets.append(target.strip())
    for label, reference in REFERENCE_LINK.findall(text):
        target = definitions.get(" ".join((reference or label).lower().split()))
        if target:
            targets.append(target)
    return targets


def local_target(source: str, target: str) -> str | None:
    parsed = urlsplit(target)
    if parsed.scheme or parsed.netloc or not parsed.path:
        return None
    path = unquote(parsed.path)
    if path.startswith("/"):
        return None
    return posixpath.normpath(posixpath.join(posixpath.dirname(source), path))


def is_design_export(name: str) -> bool:
    path = PurePosixPath(name)
    directories = path.parts[:-1]
    return (
        name.lower().endswith(".dc.html")
        or any(
            part.startswith(("design_handoff_", "design-handoff-"))
            for part in directories
        )
        or (
            directories[:2] == ("docs", "design")
            and any(
                part.startswith("handoff-") or part == "mockups"
                for part in directories[2:]
            )
        )
        or directories[:2] == ("docs", "mockups")
    )


def find_problems(root: Path = ROOT) -> list[str]:
    files = tracked_files(root)
    problems = [
        f"{name}: design working files belong with their task, not in Git"
        for name in files
        if is_design_export(name)
    ]
    documents = {
        name
        for name in files
        if name.startswith("docs/") and name.lower().endswith(".md")
    }
    if ENTRY not in documents:
        return sorted([*problems, f"{ENTRY}: documentation index is missing"])

    reached = {ENTRY}
    pending = [ENTRY]
    while pending:
        source = pending.pop()
        text = (root / source).read_text(encoding="utf-8")
        for raw in link_targets(text):
            target = local_target(source, raw)
            if target is None:
                continue
            # A directory link reaches its named index, but never all children.
            targets = (
                [target]
                if target in documents
                else [f"{target}/README.md", f"{target}/index.md"]
            )
            for linked in targets:
                if linked not in documents or linked in reached:
                    continue
                reached.add(linked)
                if PurePosixPath(linked).name.lower() in INDEX_NAMES:
                    pending.append(linked)

    problems.extend(
        f"{name}: add a link from {ENTRY} or a reachable nested index"
        for name in documents - reached
    )
    return sorted(problems)


def main() -> int:
    problems = find_problems()
    if problems:
        print(f"Document structure problems: {len(problems)}")
        for problem in problems:
            print(f"  {problem}")
        return 1
    print("All Markdown documents are indexed; no design exports are tracked.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
