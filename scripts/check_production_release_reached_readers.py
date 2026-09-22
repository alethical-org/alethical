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
merge. The same build-setting difference is recorded in
``docs/operations/page-load-performance-decisions.md``.

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

# The API's own answer to the same question, added because a merge that never
# rebuilt the API left no record anywhere that anything had gone wrong
# ([issue 2046](https://github.com/alethical-org/alethical/issues/2046)).
API_VERSION_URL = "https://api.alethical.com/version"

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
WEBSITE_GRACE_MINUTES = 10

# The same question for the API, measured its own way: across 246 releases
# between 4 and 22 Sep 2026 a push reaches a running API in 56 to 296 seconds,
# median 92. So 15 minutes is about 3 times the slowest release seen here, and
# still reports the 8 Sep 2026 skip sooner than the person who found it at
# minute 17.
API_GRACE_MINUTES = 15

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


def api_paths() -> list[str]:
    """The paths the API is built from, derived from ``.railwayignore``.

    Written as "everything except what Railway is told to leave out", because
    that file is the only declaration this repository has of what the backend
    build contains, and a second hand-kept list here would slowly stop
    describing it. A commit that changes only excluded paths cannot change a
    single answer the API gives, so it needs no release and this check says
    nothing about it.

    That is not a detail. Of the 4 pushes to ``main`` that got no Railway
    deployment between 8 Aug and 22 Sep 2026, 3 changed nothing but the website,
    so a check comparing against ``main``'s tip would have cried wolf 3 times out
    of 4 and been muted before the one that mattered arrived.
    """
    excluded = [
        line.strip()
        for line in (ROOT / ".railwayignore").read_text().splitlines()
        if line.strip() and not line.startswith("#")
    ]
    if not excluded:
        raise SystemExit(
            ".railwayignore lists nothing, so this check cannot tell which changes need an "
            "API release. Read the file and update api_paths() in "
            "scripts/check_production_release_reached_readers.py."
        )
    return [".", *(f":(exclude){path}" for path in excluded)]


def read_api_release_commit(
    url: str, timeout: float = 20.0
) -> tuple[str | None, str | None]:
    """The commit the live API says it was built from, and why it could not be read.

    Same 2-value shape as :func:`read_release_stamp`, and for the same reason: an
    unreachable API is not evidence that a merge failed to ship.
    """
    request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            answer = json.loads(response.read().decode("utf-8", "replace"))
    except urllib.error.HTTPError as error:
        # 404 is an answer, not a failure to get one: the API is up and has no
        # `/version`, which means either the release carrying it has not shipped
        # or a later release removed it. Both leave nobody able to tell whether
        # merges are reaching the API, so both are reported rather than waited
        # out. Every other code is a read that did not happen.
        if error.code == 404:
            return None, "no-stamp"
        return None, f"{url} answered HTTP {error.code}"
    except Exception as error:  # noqa: BLE001 - any read failure is the same answer
        return None, f"{url} could not be read: {error}"
    commit = answer.get("commit") if isinstance(answer, dict) else None
    if not isinstance(commit, str) or not re.fullmatch(r"[0-9a-f]{40}", commit):
        return None, "no-stamp"
    return commit, None


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


class Service:
    """One deployed thing, and the few words that differ when it falls behind.

    Everything hard here is shared: which commits are waiting, how long the
    oldest has waited, whether the served commit is even in ``main``. Only the
    address, the reader of the commit, the paths that matter and the repair
    differ between the website and the API, so only those are per-service. Two
    copies of the rest would drift, and the half that drifted would be the half
    nobody was watching.
    """

    # A plain class rather than a dataclass on purpose: this file is also loaded
    # by path from the test suite, where the module is not in `sys.modules`, and
    # `dataclasses` resolves annotations through there and fails.

    def __init__(
        self,
        key: str,
        what: str,
        url: str,
        read,
        paths,
        grace_minutes: float,
        no_commit: str,
        no_stamp: str,
        repair: str,
    ) -> None:
        self.key = key
        self.what = what
        self.url = url
        self.read = read
        self.paths = paths
        self.grace_minutes = grace_minutes
        self.no_commit = no_commit
        self.no_stamp = no_stamp
        self.repair = repair


WEBSITE = Service(
    key="website",
    what="the website",
    url=PAGE_URL,
    read=read_release_stamp,
    paths=website_paths,
    grace_minutes=WEBSITE_GRACE_MINUTES,
    no_commit=(
        "the page at {url} does not say which commit built it, so nothing can "
        "tell whether a merge is reaching readers."
    ),
    no_stamp=(
        "Every deploying build writes that commit into the page "
        "(`apps/frontend/scripts/stamp-release-commit.mjs`). A page without one means "
        "either production is still serving a build from before stamping shipped, or a "
        "deploying build has stopped setting `VERCEL_GIT_COMMIT_SHA`."
    ),
    repair=(
        "### What to do\n\n"
        "1. Run the **Deploy to Vercel (manual fallback)** workflow "
        "(`.github/workflows/vercel-deploy.yml`) on `main`. That builds and releases "
        "`main`'s head and is the whole repair.\n"
        "2. Then re-run **Production release missing** "
        "(`.github/workflows/production-release-missing.yml`) to close this issue, or leave "
        "it and the next merge closes it.\n"
        "3. Check the live page yourself: "
        f"`curl -sL {PAGE_URL} | grep {RELEASE_COMMIT_META_NAME}` says which commit readers "
        "have.\n\n"
        "### The usual cause\n\n"
        "`vercel.json`'s `ignoreCommand` compares a commit against its immediate parent, and "
        "the merge queue can advance `main` by several commits in 1 push. Vercel builds the "
        "push's head only, and when that head happens to touch none of those paths every "
        "earlier commit in the same push goes unbuilt, however much website code it changed. "
        "Documents, scripts and tests all do it "
        "([issue 2075](https://github.com/alethical-org/alethical/issues/2075))."
    ),
)

API = Service(
    key="api",
    what="the API",
    url=API_VERSION_URL,
    read=read_api_release_commit,
    paths=api_paths,
    grace_minutes=API_GRACE_MINUTES,
    no_commit=(
        "{url} does not say which commit the API was built from, so nothing can "
        "tell whether a merge is reaching readers."
    ),
    no_stamp=(
        "A deployed release reads its commit from Railway's own "
        "`RAILWAY_GIT_COMMIT_SHA`, or for the hand-run repair from "
        "`alethical/release_commit.txt` (`alethical/release.py`). A missing `/version`, "
        "or a `null` commit in it, means either the API is still running a release from "
        "before `/version` shipped, or a deploy path has stopped carrying the commit."
    ),
    repair=(
        "### What to do\n\n"
        "1. In Railway, choose **Deploy Latest Commit** for service `alethical-api` in "
        "`production`. That is the whole repair, and it keeps Railway's own release "
        "history readable.\n"
        "2. If GitHub Actions is healthy, the hand-run **Deploy to Railway** workflow "
        "(`.github/workflows/railway-deploy.yml`) on `main` is the second path.\n"
        "3. Check the live API yourself: "
        f"`curl -s {API_VERSION_URL}` says which commit it is running.\n"
        "4. Then re-run **API release missing** "
        "(`.github/workflows/api-release-missing.yml`) to close this issue, or leave it "
        "and the next merge closes it.\n\n"
        "### What this is, and what it is not\n\n"
        "Railway redeploys `alethical-api` on every push to `main`, and between 8 Aug and "
        "22 Sep 2026 it did so for 697 of 701 pushes, normally starting within 2 seconds. "
        "So this is a dropped release rather than a disconnected watcher, which is what "
        "makes it worth an alarm: it works often enough that nobody develops the habit of "
        "checking ([issue 2046](https://github.com/alethical-org/alethical/issues/2046))."
    ),
)

SERVICES = {service.key: service for service in (WEBSITE, API)}


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
    read_stamp=None,
    paths: list[str] | None = None,
    service: Service = WEBSITE,
) -> tuple[int, str]:
    """The verdict, and the words to put in front of a person."""
    paths = paths if paths is not None else service.paths()
    read_stamp = read_stamp if read_stamp is not None else service.read
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
                f"{url} does not say its commit yet, {waited:.0f} "
                f"{plural(waited, 'minute', 'minutes')} after the merge.",
            )
        return NOT_REACHED, (
            f"**Net:** {service.no_commit.format(url=url)}\n\n"
            f"{service.no_stamp} `main` is at "
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
            f"them changes what {service.what} is built from. Correctly unbuilt."
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
        f"**Net:** {len(waiting)} merged {plural(len(waiting), 'change', 'changes')} to "
        f"{service.what} {plural(len(waiting), 'is', 'are')} not reaching readers. "
        f"Production is built from `{served[:8]}` and the oldest waiting change, `{oldest[:8]}`, "
        f"merged {waited:.0f} {plural(waited, 'minute', 'minutes')} ago. Nothing failed: a "
        f"release for it never started.\n\n"
        f"`main` is at `{head[:8]}`. Merged and not live:\n\n{listed}\n\n"
        f"{service.repair}"
    )


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--service",
        default=WEBSITE.key,
        choices=sorted(SERVICES),
        help="which deployed thing to ask (default: website)",
    )
    parser.add_argument(
        "--page-url",
        default=None,
        help="the address to read (default: the service's own)",
    )
    parser.add_argument(
        "--head", default=None, help="the commit main is at (default: HEAD)"
    )
    parser.add_argument("--grace-minutes", type=float, default=None)
    arguments = parser.parse_args()
    service = SERVICES[arguments.service]
    head = arguments.head or git(ROOT, "rev-parse", "HEAD")
    grace = (
        arguments.grace_minutes
        if arguments.grace_minutes is not None
        else service.grace_minutes
    )
    verdict, words = report(
        head,
        arguments.page_url or service.url,
        grace,
        dt.datetime.now(dt.UTC),
        service=service,
    )
    print(words)
    return verdict


if __name__ == "__main__":
    sys.exit(main())
