#!/usr/bin/env python3
"""Check current PR explanations without restarting or rewriting code checks.

Only read-only GitHub APIs are used. PR text and git blobs are data, never shell
commands. A changed head/body/base or an incomplete API result fails closed.
"""

from __future__ import annotations

import fnmatch
import json
import os
import re
import subprocess
import sys
import urllib.error
import urllib.request
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from scripts.check_doc_sync import DESCRIBES, FENCE, ROOT, acknowledged


class CheckFailure(Exception):
    """The check cannot establish an up-to-date acknowledgment."""


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        raise urllib.error.URLError(
            "Redirects are not accepted for authenticated API reads."
        )


def request(path: str, payload: dict | None = None):
    # Fixed origin: untrusted event values never choose where the token is sent.
    token = os.environ.get("GH_TOKEN")
    if not token:
        raise CheckFailure("A read-only GitHub token is required.")
    req = urllib.request.Request(
        "https://api.github.com/" + path,
        data=json.dumps(payload).encode() if payload is not None else None,
        headers={
            "Authorization": f"Bearer {token}",
            "Accept": "application/vnd.github+json",
            "X-GitHub-Api-Version": "2022-11-28",
        },
    )
    try:
        with urllib.request.build_opener(NoRedirect).open(req, timeout=30) as response:
            result = json.load(response)
    except (urllib.error.URLError, TimeoutError, ValueError) as exc:
        # Do not echo response bodies, headers, PR prose, or token-bearing errors.
        raise CheckFailure("GitHub did not return a complete readable result.") from exc
    if isinstance(result, dict) and result.get("errors"):
        raise CheckFailure("GitHub could not read the merge queue.")
    return result


def git(*args: str) -> str:
    result = subprocess.run(
        ["git", *args], cwd=ROOT, capture_output=True, text=True, check=False
    )
    if result.returncode:
        raise CheckFailure("Required git history is unavailable; fetch full history.")
    return result.stdout


def sha(value: str) -> str:
    if not isinstance(value, str) or not re.fullmatch(r"[0-9a-f]{40}", value):
        raise CheckFailure("GitHub did not identify the exact code revision.")
    return value


def couplings(base: str) -> dict[str, list[str]]:
    """Read both snapshots, so deleting a declaration cannot evade its review."""
    result: dict[str, list[str]] = {}
    for ref in (sha(base), "HEAD"):
        for path in git("ls-tree", "-r", "--name-only", "-z", ref, "--", "docs/").split(
            "\0"
        ):
            if not path.endswith(".md"):
                continue
            content = git("show", f"{ref}:{path}")
            globs = [
                glob.strip()
                for match in DESCRIBES.findall(FENCE.sub("", content))
                for glob in match.split(",")
                if glob.strip()
            ]
            result.setdefault(path, []).extend(globs)
    return result


def identity(pr: dict) -> tuple:
    return (
        pr["state"],
        pr["head"]["sha"],
        pr["base"]["sha"],
        pr.get("body") or "",
        pr["changed_files"],
    )


def check_pull_request(
    repo: str, number: int, head: str, base: str | None = None
) -> dict:
    route = f"repos/{repo}/pulls/{number}"
    pr = request(route)
    if (
        pr["state"] != "open"
        or pr["head"]["sha"] != sha(head)
        or (base is not None and pr["base"]["sha"] != sha(base))
    ):
        raise CheckFailure(
            f"PR {number} changed since this check started; use its newest run."
        )
    count = pr["changed_files"]
    if not isinstance(count, int) or not 0 <= count <= 3000:
        raise CheckFailure("GitHub cannot provide the complete changed-file list.")
    files = []
    for page in range(1, (count + 99) // 100 + 1):
        batch = request(f"{route}/files?per_page=100&page={page}")
        if not isinstance(batch, list):
            raise CheckFailure("GitHub did not return a changed-file list.")
        files.extend(batch)
    if len(files) != count or len({file["filename"] for file in files}) != count:
        raise CheckFailure("GitHub returned an incomplete or changing file list.")
    paths = {file["filename"] for file in files} | {
        file["previous_filename"] for file in files if "previous_filename" in file
    }
    affected = sorted(
        doc
        for doc, globs in couplings(pr["base"]["sha"]).items()
        if any(fnmatch.fnmatch(path, glob) for path in paths for glob in globs)
    )
    if identity(request(route)) != identity(pr):
        raise CheckFailure(
            f"PR {number} changed while its explanation was being checked."
        )
    if affected and not acknowledged(pr.get("body") or ""):
        print(
            f"PR {number}: read these guides and add a nonempty Docs check: explanation:"
        )
        for doc in affected:
            print(f"  {doc!r}")
        raise CheckFailure(
            "Edit the PR description; code does not need another upload."
        )
    print(f"PR {number}: current description passes ({len(affected)} affected guides).")
    return pr


def queue_members(repo: str, branch: str, head: str) -> list[tuple[int, str]]:
    owner, name = repo.split("/")
    result = request(
        "graphql",
        {
            "query": """query($owner:String!,$name:String!,$branch:String!) {
          repository(owner:$owner,name:$name) { mergeQueue(branch:$branch) {
            entries(first:100) { pageInfo { hasNextPage } nodes {
              position headCommit { oid } pullRequest { number headRefOid }
            } }
          } }
        }""",
            "variables": {"owner": owner, "name": name, "branch": branch},
        },
    )
    queue = result["data"]["repository"]["mergeQueue"]
    if not queue or queue["entries"]["pageInfo"]["hasNextPage"]:
        raise CheckFailure("The complete merge queue is unavailable.")
    entries = queue["entries"]["nodes"]
    matches = [
        entry
        for entry in entries
        if entry.get("headCommit") and entry["headCommit"]["oid"] == sha(head)
    ]
    if len(matches) != 1:
        raise CheckFailure("The merge group changed or no longer exists in the queue.")
    included = sorted(
        (entry for entry in entries if entry["position"] <= matches[0]["position"]),
        key=lambda entry: entry["position"],
    )
    if not included or any(not entry.get("pullRequest") for entry in included):
        raise CheckFailure("The merge queue did not identify every included PR.")
    return [
        (entry["pullRequest"]["number"], sha(entry["pullRequest"]["headRefOid"]))
        for entry in included
    ]


def main() -> int:
    try:
        repo = os.environ["GITHUB_REPOSITORY"]
        if not re.fullmatch(r"[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+", repo):
            raise CheckFailure("Unexpected GitHub repository identity.")
        event = json.loads(Path(os.environ["GITHUB_EVENT_PATH"]).read_text())
        if os.environ["GITHUB_EVENT_NAME"] == "pull_request":
            pr = event["pull_request"]
            check_pull_request(
                repo, int(event["number"]), pr["head"]["sha"], pr["base"]["sha"]
            )
        elif os.environ["GITHUB_EVENT_NAME"] == "merge_group":
            group = event["merge_group"]
            branch = group["base_ref"].removeprefix("refs/heads/")
            members = queue_members(repo, branch, group["head_sha"])
            snapshots = [
                check_pull_request(repo, number, head) for number, head in members
            ]
            if queue_members(repo, branch, group["head_sha"]) != members:
                raise CheckFailure("The merge queue changed during this check.")
            for (number, _), snapshot in zip(members, snapshots):
                if identity(request(f"repos/{repo}/pulls/{number}")) != identity(
                    snapshot
                ):
                    raise CheckFailure("A queued PR changed during this check.")
        else:
            raise CheckFailure("Unsupported event; no description check was performed.")
    except (CheckFailure, KeyError, TypeError, ValueError) as exc:
        print(
            f"Description check failed: {exc if isinstance(exc, CheckFailure) else 'Incomplete GitHub input.'}"
        )
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
