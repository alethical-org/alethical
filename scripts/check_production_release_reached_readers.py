#!/usr/bin/env python3
"""Say whether what production serves is what ``main`` has merged.

**Net: a merge that never gets built reaches no reader, and until this existed
nothing anywhere said so.** On 8 Sep 2026 commit ``04005cfd`` merged to ``main``,
changed ``api/page.ts`` and ``apps/frontend``, and got no production build at all.
Readers kept the previous page for 29 minutes. Every check was green, no build
failed, and it reached readers only because an unrelated frontend change merged 20
minutes later and happened to trigger a build
(`issue 2075 <https://github.com/alethical-org/alethical/issues/2075>`_).

**The cause, from the records rather than from reasoning.** GitHub's merge queue
merged `pull request 2066 <https://github.com/alethical-org/alethical/pull/2066>`_
and the docs-only `pull request 2071
<https://github.com/alethical-org/alethical/pull/2071>`_ as 1 batch, on stacked
queue branches (``gh-readonly-queue/main/pr-2066-a5a42091`` with head
``04005cfd``, then ``gh-readonly-queue/main/pr-2071-04005cfd`` with head
``c8ad2698``). The whole stack fast-forwarded onto ``main`` in **1 push**: GitHub
fires 1 workflow run per push and there is a push-triggered run for ``c8ad2698``
and none for ``04005cfd``, and Railway, which has no ignore step, likewise has a
deployment for ``c8ad2698`` and none for ``04005cfd``. Vercel builds a push's head
only, and ``vercel.json``'s ignore step then ran ``git diff --quiet HEAD^ HEAD``
against ``04005cfd`` and correctly found nothing but documents. So the ignore step
answered honestly about the wrong pair of commits: its window is 1 commit wide and
a push can be several commits long.

The hypothesis this replaces was that Vercel does not build the same commit twice
and had already built ``04005cfd`` as the queue branch. That is false: commit
``a74fe6e2`` has both a Preview deployment (14:04, its queue branch) and a
Production deployment (14:10, the push head) for the same commit.

**What this checks, and why it is the page rather than a build outcome.** Every
deploying build stamps its own commit into the served page
(``apps/frontend/scripts/stamp-release-commit.mjs``). So 1 read of 1 address says
exactly what is live, and the rule is:

    the changes between the commit production was built from and ``main``'s head
    must not touch a path the website is built from.

A docs-only merge satisfies it with no build, which is why the ignore step skipping
those many times a day stays silent here. A missing build, a failed build, a
release rolled back and a stalled edge cache all break it the same way, because it
asks what a reader gets rather than what a deployment did.

**A build's own filenames could not answer it.** Measured on commit ``c9c9035b``,
8 Sep 2026: this repository's build produced ``index-fa1ab8a5...`` where
production served ``index-c9122423...`` for that same commit. A deploying build
inlines the 6 public ``EXPO_PUBLIC_*`` settings and a checkout has none, so that
content hash differs by construction and a check keyed on it would fire on every
merge (``apps/frontend/scripts/check-first-load-budget.mjs``'s
``HOSTED_BUILD_EXCESS_BYTES`` is the same measurement from the size side).

Reads 1 public page and the local git history. No database, no credentials, no
Vercel token, no paid call.
"""

from __future__ import annotations

import argparse
import datetime as dt
import json
import re
import subprocess
import sys
import urllib.error
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]

PAGE_URL = "https://www.alethical.com/"

# The stamp's name, spelled once in apps/frontend/scripts/stamp-release-commit.mjs
# and read back here. A test pins the 2 spellings together.
RELEASE_COMMIT_META_NAME = "alethical-release-commit"

# A browser User-Agent. Vercel's bot protection answers a run of unnamed
# command-line requests with a challenge page, and naming Alethical keeps the
# request honest in the logs.
USER_AGENT = (
    "Mozilla/5.0 (compatible; AlethicalReleaseCheck/1.0; "
    "+https://www.alethical.com) Chrome/124.0 Safari/537.36"
)

# How long a merged change may be waiting before this says so. Measured across
# 264 production releases up to 8 Sep 2026: a push reaches readers in 48 to 91
# seconds, median 71. So 10 minutes is about 7 times the slowest release ever
# observed here, and the 29-minute gap that produced this check would have been
# reported at minute 10.
GRACE_MINUTES = 10

# Verdicts. Three, because the caller does 3 different things: stop quiet, open
# the issue, or wait and ask again.
REACHED = 0
NOT_REACHED = 1
NO_VERDICT_YET = 2


def website_paths() -> list[str]:
    """The paths a website release is built from, read out of ``vercel.json``.

    Read rather than copied, so the 2 lists cannot drift. ``vercel.json``'s
    ``ignoreCommand`` is what actually decides whether Vercel builds, and a
    second hand-maintained copy of it here would be a check that slowly stops
    describing the thing it checks. ``scripts/vercel-ignore-build.sh`` takes the
    same list after the same ``--``, so the deploy decision and this check can
    never disagree about which paths matter.
    """
    command = json.loads((ROOT / "vercel.json").read_text())["ignoreCommand"]
    if " -- " not in command:
        raise SystemExit(
            "vercel.json's ignoreCommand no longer lists its paths after `--`, so this "
            "check cannot tell which changes need a build. Read the command and update "
            "website_paths() in scripts/check_production_release_reached_readers.py."
        )
    paths = command.split(" -- ", 1)[1].split()
    if not paths:
        raise SystemExit("vercel.json's ignoreCommand lists no paths after `--`.")
    return paths


def read_release_stamp(
    url: str, timeout: float = 20.0
) -> tuple[str | None, str | None]:
    """The commit production was built from, and why it could not be read.

    Exactly 1 of the 2 is set. An unreadable page is not evidence of anything: a
    timeout, a refused connection, a 5xx or one of Vercel's bot challenges says
    nothing about whether a merge shipped, so the caller waits and asks again
    rather than reporting an outage nobody has.
    """
    request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            html = response.read().decode("utf-8", "replace")
    except urllib.error.HTTPError as error:
        return None, f"{url} answered HTTP {error.code}"
    except Exception as error:  # noqa: BLE001 - any read failure is the same answer
        return None, f"{url} could not be read: {error}"
    found = re.search(
        rf'<meta name="{RELEASE_COMMIT_META_NAME}" content="([0-9a-f]{{40}})"', html
    )
    if not found:
        return None, "no-stamp"
    return found.group(1), None


def git(repo: Path, *args: str) -> str:
    return subprocess.run(
        ["git", *args], cwd=repo, capture_output=True, text=True, check=True
    ).stdout.strip()


def known_commit(repo: Path, sha: str) -> bool:
    return (
        subprocess.run(
            ["git", "cat-file", "-e", f"{sha}^{{commit}}"],
            cwd=repo,
            capture_output=True,
        ).returncode
        == 0
    )


def is_ancestor(repo: Path, older: str, newer: str) -> bool:
    return (
        subprocess.run(
            ["git", "merge-base", "--is-ancestor", older, newer],
            cwd=repo,
            capture_output=True,
        ).returncode
        == 0
    )


def waiting_commits(repo: Path, served: str, head: str, paths: list[str]) -> list[str]:
    """The commits between the 2 that change what the website is built from.

    Oldest first, so the first of them is the one that has been waiting longest,
    which is the clock this check runs on.
    """
    listed = git(repo, "rev-list", "--reverse", f"{served}..{head}").split()
    return [sha for sha in listed if changes_website(repo, f"{sha}^", sha, paths)]


def changes_website(repo: Path, before: str, after: str, paths: list[str]) -> bool:
    return (
        subprocess.run(
            ["git", "diff", "--quiet", before, after, "--", *paths],
            cwd=repo,
            capture_output=True,
        ).returncode
        != 0
    )


def minutes_since_commit(repo: Path, sha: str, now: dt.datetime) -> float:
    committed = dt.datetime.fromtimestamp(
        int(git(repo, "show", "-s", "--format=%ct", sha)), dt.UTC
    )
    return (now - committed).total_seconds() / 60


def plural(count: float, one: str, many: str) -> str:
    """Words a person reads, so "1 minutes" and "1 change(s)" never ship."""
    return one if round(count) == 1 else many


def report(
    head: str,
    url: str,
    grace_minutes: float,
    now: dt.datetime,
    repo: Path = ROOT,
    read_stamp=read_release_stamp,
    paths: list[str] | None = None,
) -> tuple[int, str]:
    """The verdict, and the words to put in front of a person."""
    paths = paths if paths is not None else website_paths()
    served, problem = read_stamp(url)

    if problem == "no-stamp":
        # The instrument itself. Every deploying build stamps its commit into the
        # page, so a page without one means either the release that installed
        # stamping has not shipped yet, or a deploying build stopped setting the
        # commit. Both mean nothing can tell whether merges are reaching readers,
        # which is the whole defect this check exists to end, so it is reported
        # rather than passed over.
        waited = minutes_since_commit(repo, head, now)
        if waited < grace_minutes:
            return (
                NO_VERDICT_YET,
                f"{url} carries no release stamp yet, {waited:.0f} "
                f"{plural(waited, 'minute', 'minutes')} after the merge.",
            )
        return NOT_REACHED, (
            f"**Net:** the page at {url} does not say which commit built it, so nothing can "
            f"tell whether a merge is reaching readers.\n\n"
            f"Every deploying build writes that commit into the page "
            f"(`apps/frontend/scripts/stamp-release-commit.mjs`). A page without one means "
            f"either production is still serving a build from before stamping shipped, or a "
            f"deploying build has stopped setting `VERCEL_GIT_COMMIT_SHA`. `main` is at "
            f"`{head[:8]}`, merged {waited:.0f} {plural(waited, 'minute', 'minutes')} ago."
        )

    if problem:
        return (
            NO_VERDICT_YET,
            f"No verdict: {problem}. An unreadable page is not evidence.",
        )

    assert served is not None
    if served == head:
        return REACHED, f"Readers have `{head[:8]}`, which is `main`."

    if not known_commit(repo, served):
        return NO_VERDICT_YET, (
            f"No verdict: production serves `{served[:8]}` and this checkout does not have "
            f"that commit. Fetch the full history and ask again."
        )

    if not is_ancestor(repo, served, head):
        return NOT_REACHED, (
            f"**Net:** production is serving `{served[:8]}`, which is not in `main`'s history, "
            f"so what readers get is not a released version of this branch.\n\n"
            f"`main` is at `{head[:8]}`. A release rolled back by hand, or a production build "
            f"promoted from somewhere other than `main`, both look like this."
        )

    waiting = waiting_commits(repo, served, head, paths)
    if not waiting:
        return REACHED, (
            f"Readers have `{served[:8]}` and `main` is at `{head[:8]}`, and nothing between "
            f"them changes what the website is built from. Correctly unbuilt."
        )

    oldest = waiting[0]
    waited = minutes_since_commit(repo, oldest, now)
    listed = "\n".join(
        f"- `{sha[:8]}` {git(repo, 'show', '-s', '--format=%s', sha)}"
        for sha in waiting
    )
    if waited < grace_minutes:
        return NO_VERDICT_YET, (
            f"Waiting: {len(waiting)} merged "
            f"{plural(len(waiting), 'change', 'changes')} not yet live, the oldest "
            f"`{oldest[:8]}` merged {waited:.0f} "
            f"{plural(waited, 'minute', 'minutes')} ago, inside the "
            f"{grace_minutes:.0f}-minute grace."
        )
    return NOT_REACHED, (
        f"**Net:** {len(waiting)} merged {plural(len(waiting), 'change', 'changes')} to the "
        f"website {plural(len(waiting), 'is', 'are')} not reaching readers. "
        f"Production is built from `{served[:8]}` and the oldest waiting change, `{oldest[:8]}`, "
        f"merged {waited:.0f} {plural(waited, 'minute', 'minutes')} ago. Nothing failed: a "
        f"release for it never started.\n\n"
        f"`main` is at `{head[:8]}`. Merged and not live:\n\n{listed}\n\n"
        f"### What to do\n\n"
        f"1. Run the **Deploy to Vercel (manual fallback)** workflow "
        f"(`.github/workflows/vercel-deploy.yml`) on `main`. That builds and releases "
        f"`main`'s head and is the whole repair.\n"
        f"2. Then re-run **Production release missing** "
        f"(`.github/workflows/production-release-missing.yml`) to close this issue, or leave "
        f"it and the next merge closes it.\n"
        f"3. Check the live page yourself: "
        f"`curl -sL {url} | grep {RELEASE_COMMIT_META_NAME}` says which commit readers have.\n\n"
        f"### The usual cause\n\n"
        f"`vercel.json`'s `ignoreCommand` compares a commit against its immediate parent, and "
        f"the merge queue can advance `main` by several commits in 1 push. Vercel builds the "
        f"push's head only, so when that head is docs-only every earlier commit in the same "
        f"push goes unbuilt, however much website code it changed "
        f"([issue 2075](https://github.com/alethical-org/alethical/issues/2075))."
    )


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--page-url", default=PAGE_URL, help="the address to read")
    parser.add_argument(
        "--head", default=None, help="the commit main is at (default: HEAD)"
    )
    parser.add_argument("--grace-minutes", type=float, default=GRACE_MINUTES)
    arguments = parser.parse_args()
    head = arguments.head or git(ROOT, "rev-parse", "HEAD")
    verdict, words = report(
        head, arguments.page_url, arguments.grace_minutes, dt.datetime.now(dt.UTC)
    )
    print(words)
    return verdict


if __name__ == "__main__":
    sys.exit(main())
