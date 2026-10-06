#!/usr/bin/env python3
"""Manually collect bounded PR history and retain reviewed prevention evidence.

Only collection uses GitHub (read-only through gh). Reports never infer a bug from
its title. Local checks retain references; they do not prove prevention works.
GitHub pagination is not a transactional snapshot. A first-page reread catches
visible movement during collection but cannot detect every concurrent edit.
"""

from __future__ import annotations

import argparse
import html
import json
import os
import re
import subprocess
import sys
import tempfile
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from urllib.parse import quote, urlsplit


class ReviewError(ValueError):
    """Invalid or incomplete evidence, safe to show without API output."""


def require(condition, message):
    if not condition:
        raise ReviewError(message)


def repository(value):
    require(
        isinstance(value, str)
        and re.fullmatch(r"[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+", value)
        and all(part not in {".", ".."} for part in value.split("/")),
        "Repository must be owner/repo",
    )
    return value


def day(value):
    require(
        isinstance(value, str) and re.fullmatch(r"\d{4}-\d{2}-\d{2}", value),
        "Dates must use YYYY-MM-DD",
    )
    try:
        return date.fromisoformat(value)
    except ValueError as exc:
        raise ReviewError("Invalid date") from exc


def window(since, until):
    start, end = day(since), day(until)
    require(start <= end, "Start date must not be after end date")
    try:
        return (
            datetime.combine(start, datetime.min.time(), timezone.utc),
            datetime.combine(
                end + timedelta(days=1), datetime.min.time(), timezone.utc
            ),
        )
    except OverflowError as exc:
        raise ReviewError("End date is too large") from exc


def timestamp(value):
    require(isinstance(value, str), "Missing timestamp")
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
        require(parsed.tzinfo is not None, "Timestamp must include a timezone")
        return parsed.astimezone(timezone.utc)
    except ValueError as exc:
        raise ReviewError("Invalid timestamp") from exc


def text_field(value, name):
    require(
        isinstance(value, str) and bool(value.strip()), f"{name} must be nonempty text"
    )


def github_link(value, repo):
    parsed = urlsplit(value)
    require(
        parsed.scheme == "https"
        and parsed.netloc == "github.com"
        and re.fullmatch(
            rf"/{re.escape(repo)}/(?:pull/\d+|issues/\d+|commit/[a-fA-F0-9]{{7,64}}|blob/.+)",
            parsed.path,
            re.IGNORECASE,
        )
        and not parsed.query
        and not any(part in {".", ".."} for part in parsed.path.split("/")),
        "GitHub reference must belong to the intended repository",
    )


def links(value):
    return re.findall(r"https?://[^\s<>\"\])]+", value)


def header(value):
    require(isinstance(value, dict), "Input must be a JSON object")
    require(
        type(value.get("schema_version")) is int and value["schema_version"] == 1,
        "Unsupported schema version",
    )
    repository(value.get("repository"))


def api_page(repo, page):
    result = subprocess.run(
        [
            "gh",
            "api",
            "--method",
            "GET",
            f"repos/{repo}/pulls",
            "-f",
            "state=closed",
            "-f",
            "sort=updated",
            "-f",
            "direction=desc",
            "-f",
            "per_page=100",
            "-f",
            f"page={page}",
        ],
        capture_output=True,
        text=True,
        timeout=120,
        check=False,
    )
    require(
        result.returncode == 0, "GitHub collection failed; previous output was kept"
    )
    try:
        payload = json.loads(result.stdout)
    except json.JSONDecodeError as exc:
        raise ReviewError("GitHub returned invalid JSON") from exc
    require(isinstance(payload, list) and len(payload) <= 100, "Invalid GitHub page")
    return payload


def pr_record(raw, repo):
    require(isinstance(raw, dict), "Invalid pull request")
    number = raw.get("number")
    require(type(number) is int and number > 0, "Invalid pull request number")
    require(
        isinstance(raw.get("html_url"), str)
        and raw["html_url"].lower()
        == f"https://github.com/{repo}/pull/{number}".lower(),
        "Pull request belongs to a different repository",
    )
    text_field(raw.get("title"), "Pull request title")
    require(raw.get("body") is None or isinstance(raw.get("body"), str), "Invalid body")
    labels = raw.get("labels")
    require(
        isinstance(labels, list)
        and all(
            isinstance(label, dict) and isinstance(label.get("name"), str)
            for label in labels
        ),
        "Invalid labels",
    )
    sha = raw.get("merge_commit_sha")
    require(
        isinstance(sha, str) and re.fullmatch(r"[a-fA-F0-9]{40,64}", sha),
        "Missing merge commit",
    )
    timestamp(raw.get("merged_at"))
    return {
        "number": number,
        "title": raw["title"],
        "body": raw.get("body") or "",
        "url": raw["html_url"],
        "merged_at": raw["merged_at"],
        "labels": [label["name"] for label in labels],
        "merge_commit_sha": sha,
    }


def collect(repo, since, until, fetch=api_page, max_pages=1000):
    repo = repository(repo)
    start, end = window(since, until)
    require(type(max_pages) is int and max_pages > 0, "Page limit must be positive")
    inventory = {}
    first_page = None
    for page_number in range(1, max_pages + 1):
        page = fetch(repo, page_number)
        identity = page_identity(page)
        if first_page is None:
            first_page = identity
        updated = []
        for raw in page:
            require(isinstance(raw, dict), "Invalid pull request")
            updated.append(timestamp(raw.get("updated_at")))
            if raw.get("merged_at") is None:
                continue
            merged = timestamp(raw["merged_at"])
            if start <= merged < end:
                record = pr_record(raw, repo)
                previous = inventory.get(record["number"])
                require(
                    previous is None or previous == record,
                    "Pull request changed during pagination; retry collection",
                )
                inventory[record["number"]] = record
        # Updated order, not merge order: old PRs may be edited long after merging.
        if len(page) < 100 or all(value < start for value in updated):
            require(
                first_page == page_identity(fetch(repo, 1)),
                "GitHub pages moved during collection; retry; previous output was kept",
            )
            return {
                "schema_version": 1,
                "repository": repo,
                "complete": True,
                "window": {"since": since, "until": until, "timezone": "UTC"},
                "collected_at": datetime.now(timezone.utc).isoformat(),
                "collection": {
                    "first_page_stable": True,
                    "transactional_snapshot": False,
                },
                "prs": sorted(inventory.values(), key=lambda item: item["number"]),
            }
    raise ReviewError(
        "Page limit reached; collection is incomplete and output was kept"
    )


def page_identity(page):
    require(isinstance(page, list) and len(page) <= 100, "Invalid GitHub page")
    result = []
    for item in page:
        require(isinstance(item, dict), "Invalid pull request")
        require(
            type(item.get("number")) is int and item["number"] > 0,
            "Invalid pull request number",
        )
        timestamp(item.get("updated_at"))
        result.append((item["number"], item["updated_at"]))
    return result


def atomic_write(path, content):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = None
    try:
        with tempfile.NamedTemporaryFile(
            mode="w",
            encoding="utf-8",
            dir=path.parent,
            prefix=f".{path.name}.",
            delete=False,
        ) as handle:
            temporary = Path(handle.name)
            handle.write(content)
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temporary, path)
    finally:
        if temporary is not None:
            temporary.unlink(missing_ok=True)


def load(path):
    try:
        result = json.loads(Path(path).read_text(encoding="utf-8"))
    except (OSError, UnicodeError, json.JSONDecodeError) as exc:
        raise ReviewError("Cannot read valid JSON input") from exc
    header(result)
    return result


def validate_history(history):
    header(history)
    require(history.get("complete") is True, "History must be a complete collection")
    bounds = history.get("window")
    require(
        isinstance(bounds, dict) and bounds.get("timezone") == "UTC", "Invalid window"
    )
    start, end = window(bounds.get("since"), bounds.get("until"))
    timestamp(history.get("collected_at"))
    require(isinstance(history.get("prs"), list), "Missing PR inventory")
    numbers = set()
    for item in history["prs"]:
        require(isinstance(item, dict), "Invalid PR inventory record")
        require(
            isinstance(item.get("labels"), list)
            and all(isinstance(label, str) for label in item["labels"]),
            "Invalid labels",
        )
        pr_record(
            {
                **item,
                "html_url": item.get("url"),
                "labels": [{"name": label} for label in item.get("labels", [])],
            },
            history["repository"],
        )
        require(item["number"] not in numbers, "Duplicate PR in history")
        require(
            start <= timestamp(item["merged_at"]) < end, "PR outside history window"
        )
        numbers.add(item["number"])


def validate_review(review, repo=None):
    header(review)
    if repo is not None:
        require(
            review["repository"].lower() == repo.lower(), "Review repository mismatch"
        )
    require(isinstance(review.get("cases"), list), "Missing reviewed cases")
    ids, failure_owners = set(), {}
    for case in review["cases"]:
        require(isinstance(case, dict), "Invalid case")
        for field in ("id", "summary", "cause"):
            text_field(case.get(field), field)
        require(case["id"] not in ids, "Duplicate case ID")
        ids.add(case["id"])
        occurrences = case.get("occurrences")
        require(isinstance(occurrences, list) and occurrences, "Case needs occurrences")
        numbers = set()
        for occurrence in occurrences:
            require(isinstance(occurrence, dict), "Invalid occurrence")
            number = occurrence.get("pr")
            require(type(number) is int and number > 0, "Invalid occurrence PR")
            require(
                number not in numbers, "PR has duplicate or conflicting roles in a case"
            )
            numbers.add(number)
            require(
                occurrence.get("role") in {"failure", "prevention", "design"},
                "Invalid occurrence role",
            )
            text_field(occurrence.get("evidence"), "Occurrence evidence")
            evidence_links = links(occurrence["evidence"])
            require(evidence_links, "Occurrence needs a same-repository evidence URL")
            for link in evidence_links:
                github_link(link, review["repository"])
            if occurrence["role"] == "failure":
                require(
                    number not in failure_owners,
                    "Failure PR assigned to multiple cases",
                )
                failure_owners[number] = case["id"]
        prevention = case.get("prevention")
        require(
            isinstance(prevention, dict)
            and prevention.get("status") in {"covered", "partial", "open"},
            "Invalid prevention status",
        )
        text_field(prevention.get("description"), "Prevention description")
        require(isinstance(prevention.get("checks"), list), "Missing prevention checks")
        require(
            prevention["status"] != "covered" or prevention["checks"],
            "Covered prevention needs a retained check",
        )
        for check in prevention["checks"]:
            require(isinstance(check, dict), "Invalid check reference")
            text_field(check.get("path"), "Check path")
            text_field(check.get("anchor"), "Check anchor")

    # Check GitHub links in all prose fields as well as occurrence evidence.
    def check_links(value):
        if isinstance(value, str):
            for link in links(value):
                if (urlsplit(link).hostname or "").lower() == "github.com":
                    github_link(link, review["repository"])
        elif isinstance(value, dict):
            for child in value.values():
                check_links(child)
        elif isinstance(value, list):
            for child in value:
                check_links(child)

    check_links(review)


def check_review(review, root):
    validate_review(review)
    root = Path(root).resolve(strict=True)
    require(root.is_dir(), "Root must be a directory")
    for case in review["cases"]:
        for check in case["prevention"]["checks"]:
            relative = Path(check["path"])
            require(
                not relative.is_absolute() and ".." not in relative.parts,
                "Check path must stay beneath root",
            )
            path = (root / relative).resolve()
            require(
                path.is_relative_to(root) and path.is_file(),
                "Missing or escaped check path",
            )
            require(
                check["anchor"] in path.read_text(encoding="utf-8"),
                "Check anchor is missing",
            )


def one_line(value):
    # Text is untrusted; links and Markdown structure are constructed separately.
    return escaped_text(" ".join(value.split()))


def escaped_text(value):
    plain = html.escape(value, quote=False)
    return re.sub(r"([\\`*_{}\[\]()#+.!|\-])", r"\\\1", plain)


def source_url(value):
    # Validation runs before rendering; encode delimiters that can end Markdown links.
    return quote(value, safe=":/#%")


def evidence_line(value):
    parts = re.split(r'(https?://[^\s<>"\])]+)', " ".join(value.split()))
    return "".join(
        f"[Source]({source_url(part)})" if index % 2 else escaped_text(part)
        for index, part in enumerate(parts)
    )


def report(history, review=None):
    validate_history(history)
    if review is not None:
        validate_review(review, history["repository"])
    cases = review["cases"] if review else []
    inventory = {item["number"]: item for item in history["prs"]}
    reviewed = {
        occ["pr"] for case in cases for occ in case["occurrences"]
    } & inventory.keys()
    lines = [
        f"Net: {len(reviewed)} of {len(inventory)} merged changes have reviewed evidence; "
        f"{len(inventory) - len(reviewed)} remain unreviewed.",
        "",
        f"Repository: {one_line(history['repository'])}",
        f"Window: {history['window']['since']} through {history['window']['until']} (UTC)",
        "",
        "Counts cover this inventory and the cases someone reviewed, not all bugs or fixes.",
        "Failure-related change counts do not establish recurrence; that requires "
        "reviewing whether the same cause returned.",
        "History is a best-effort paginated read, not a snapshot at a single instant.",
        "Prevention status is a reviewed claim. Reference checks retain evidence; "
        "they do not prove behavior works.",
        "",
        "## Reviewed cases",
        "",
    ]
    if not cases:
        lines += [
            "No cases have been reviewed. No repeat-bug or fix ratio is inferred.",
            "",
        ]
    for case in cases:
        failures = [
            o
            for o in case["occurrences"]
            if o["role"] == "failure" and o["pr"] in inventory
        ]
        lines += [
            f"### {one_line(case['id'])}: {one_line(case['summary'])}",
            "",
            f"Cause: {one_line(case['cause'])}",
            "",
            f"Reviewed failure-related changes in this window: {len(failures)}",
            "",
            f"Prevention: {case['prevention']['status']}. "
            f"{one_line(case['prevention']['description'])}",
            "",
        ]
        for occurrence in case["occurrences"]:
            number = occurrence["pr"]
            outside = (
                (
                    " (outside this collected window inventory; merge date unestablished; "
                    "excluded from totals)"
                )
                if number not in inventory
                else ""
            )
            lines.append(
                f"- [{occurrence['role']} PR {number}]"
                f"(https://github.com/{history['repository']}/pull/{number}){outside}: "
                f"{evidence_line(occurrence['evidence'])}"
            )
        for check in case["prevention"]["checks"]:
            lines.append(
                f"- Retained check: [{one_line(check['path'])}]"
                f"(https://github.com/{history['repository']}/blob/main/"
                f"{quote(check['path'], safe='/')}); "
                f"exact anchor: {one_line(check['anchor'])}"
            )
        lines.append("")
    lines += ["## Unreviewed queue", ""]
    lines += [
        f"- [PR {item['number']}]({item['url']}): {one_line(item['title'])}"
        for item in history["prs"]
        if item["number"] not in reviewed
    ]
    if len(reviewed) == len(inventory):
        lines.append("No unreviewed changes in this inventory.")
    return "\n".join(lines) + "\n"


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)
    collect_parser = commands.add_parser("collect")
    for name in ("repo", "since", "until", "output"):
        collect_parser.add_argument(f"--{name}", required=True)
    collect_parser.add_argument("--max-pages", type=int, default=1000)
    report_parser = commands.add_parser("report")
    report_parser.add_argument("--history", required=True)
    report_parser.add_argument("--review")
    report_parser.add_argument("--output", required=True)
    check_parser = commands.add_parser("check")
    check_parser.add_argument("--review", required=True)
    check_parser.add_argument("--root", required=True)
    args = parser.parse_args(argv)
    try:
        if args.command == "collect":
            payload = collect(
                args.repo, args.since, args.until, max_pages=args.max_pages
            )
            atomic_write(args.output, json.dumps(payload, indent=2) + "\n")
        elif args.command == "report":
            payload = report(
                load(args.history), load(args.review) if args.review else None
            )
            atomic_write(args.output, payload)
        else:
            check_review(load(args.review), args.root)
            print(
                "Retained references exist. This does not prove prevention behavior works."
            )
    except (ReviewError, OSError, UnicodeError, subprocess.SubprocessError) as exc:
        # API stderr and environment contents can contain private data; never echo them.
        print(
            f"Repeat-failure review failed: {exc}"
            if isinstance(exc, ReviewError)
            else "Repeat-failure review failed: input, output, or collection unavailable",
            file=sys.stderr,
        )
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
