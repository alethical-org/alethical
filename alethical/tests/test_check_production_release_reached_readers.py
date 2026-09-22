"""Prove the release watch fires on the shape that happened, and stays quiet otherwise.

The shape that happened, 8 Sep 2026: the merge queue advanced ``main`` by 2
commits in 1 push, a website change and then a docs-only change. Vercel built the
push's head, its ignore step compared that head against its parent, found only
documents, and skipped. The website change was never built and readers kept the
old page for 29 minutes with nothing failing
(`issue 2075 <https://github.com/alethical-org/alethical/issues/2075>`_).

The tests below build that history for real, in a temporary repository, so they
exercise the same git commands the check runs against ``main``. They deliberately
do not read commits out of this repository's own history: the ``backend`` job
checks out shallow, so a test keyed on a real old commit would pass on a laptop
and fail in CI.

The second shape, 18 Sep 2026: 3 production builds failed in a row, then no build
at all was created for ``main``'s head, and readers kept the 16:51 release for 76
minutes. The check answered correctly every time and its workflow opened
`issue 2288 <https://github.com/alethical-org/alethical/issues/2288>`_ at 17:28:40,
4 minutes after the first failure, commenting on it until readers caught up. That
run finished in 13 seconds because the oldest waiting change was already past its
grace, which is the answer arriving rather than the grace being skipped, and
``TestTheShapeOf18September2026`` pins it so a future edit cannot turn the clock
back onto the newest merge and lose the alarm
(`issue 2291 <https://github.com/alethical-org/alethical/issues/2291>`_).

Nothing here touches the network. What production serves is handed in, because an
alarm that depends on a live page is an alarm that changes its mind.
"""

from __future__ import annotations

import datetime as dt
import importlib.util
import json
import subprocess
import urllib.error
import urllib.request
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[2]
# Loaded by path rather than by a `sys.path` insert, matching
# `test_check_published_piece_links.py`. An ordinary import of a `scripts/`
# module reads to `scripts/check_declared_dependencies.py` as an undeclared
# outside package, and it fails the backend job.
_spec = importlib.util.spec_from_file_location(
    "check_production_release_reached_readers",
    ROOT / "scripts" / "check_production_release_reached_readers.py",
)
check = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(check)

SERVED = "a" * 40
NOW = dt.datetime(2026, 9, 8, 14, 20, tzinfo=dt.UTC)
WEBSITE_PATHS = ["api", "apps/frontend", "vercel.json"]
# What Railway builds the API from: everything except what `.railwayignore`
# leaves out. Spelled here so the tests do not depend on that file's current
# contents; `TestWhatTheApiIsBuiltFrom` pins the 2 together.
API_PATHS = [".", ":(exclude)apps/frontend", ":(exclude)docs", ":(exclude)*.md"]


def run(repo: Path, *args: str) -> str:
    return subprocess.run(
        ["git", *args], cwd=repo, capture_output=True, text=True, check=True
    ).stdout.strip()


def commit(repo: Path, path: str, message: str, when: dt.datetime) -> str:
    target = repo / path
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(f"{message}\n")
    run(repo, "add", "-A")
    stamp = when.strftime("%Y-%m-%dT%H:%M:%S+0000")
    subprocess.run(
        ["git", "commit", "-q", "-m", message],
        cwd=repo,
        check=True,
        capture_output=True,
        env={
            "PATH": "/usr/bin:/bin:/usr/local/bin:/opt/homebrew/bin",
            "HOME": str(repo),
            "GIT_AUTHOR_NAME": "t",
            "GIT_AUTHOR_EMAIL": "t@example.com",
            "GIT_COMMITTER_NAME": "t",
            "GIT_COMMITTER_EMAIL": "t@example.com",
            "GIT_AUTHOR_DATE": stamp,
            "GIT_COMMITTER_DATE": stamp,
        },
    )
    return run(repo, "rev-parse", "HEAD")


@pytest.fixture
def history(tmp_path: Path) -> dict[str, object]:
    """The 8 Sep push: a released commit, a website change, then a docs change."""
    repo = tmp_path / "repo"
    repo.mkdir()
    run(repo, "init", "-q", "-b", "main")
    run(repo, "config", "user.email", "t@example.com")
    run(repo, "config", "user.name", "t")
    released = commit(
        repo,
        "notes/start.md",
        "Released and live",
        dt.datetime(2026, 9, 8, 13, 31, tzinfo=dt.UTC),
    )
    website = commit(
        repo,
        "apps/frontend/src/screens/CommitteeMoneyScreen.tsx",
        "Reuse a committee's records in the browser",
        dt.datetime(2026, 9, 8, 13, 49, tzinfo=dt.UTC),
    )
    docs = commit(
        repo,
        "notes/page-load.md",
        "Record what the bill list's origin read costs",
        dt.datetime(2026, 9, 8, 13, 50, tzinfo=dt.UTC),
    )
    return {"repo": repo, "released": released, "website": website, "docs": docs}


def verdict(history: dict[str, object], served: str | None, head: str, **kwargs):
    stamp = (served, None) if served else (None, kwargs.pop("problem", "no-stamp"))
    return check.report(
        head=head,
        url="https://www.alethical.com/",
        grace_minutes=kwargs.pop("grace_minutes", 10),
        now=kwargs.pop("now", NOW),
        repo=history["repo"],
        read_stamp=lambda _url: stamp,
        paths=WEBSITE_PATHS,
    )


class TestTheShapeThatHappened:
    def test_a_website_change_left_unbuilt_behind_a_docs_only_head_is_reported(
        self, history
    ):
        code, words = verdict(history, history["released"], history["docs"])
        assert code == check.NOT_REACHED
        assert "not reaching readers" in words
        assert history["website"][:8] in words
        # The repair has to be in the alarm: this was found by a person an hour in
        # last time, and a person who has to go and look up the repair is the
        # failure repeating in slower motion.
        assert "vercel-deploy.yml" in words

    def test_it_names_every_waiting_change_not_only_the_oldest(self, history):
        second = commit(
            history["repo"],
            "api/page.ts",
            "A second website change",
            dt.datetime(2026, 9, 8, 13, 55, tzinfo=dt.UTC),
        )
        code, words = verdict(history, history["released"], second)
        assert code == check.NOT_REACHED
        assert history["website"][:8] in words and second[:8] in words

    def test_the_clock_runs_from_the_oldest_waiting_change_not_the_newest_merge(
        self, history
    ):
        """A run of merges must not keep resetting the alarm.

        On 8 Sep 2026 merges landed at 13:51, 13:56, 14:08, 14:13 and 14:29. A
        grace measured from each new merge would have been restarted 5 times and
        never fired at all.
        """
        latest = commit(
            history["repo"],
            "apps/frontend/src/screens/Another.tsx",
            "Another website change, merged 1 minute ago",
            NOW - dt.timedelta(minutes=1),
        )
        code, words = verdict(history, history["released"], latest)
        assert code == check.NOT_REACHED
        # The reported wait is the OLDEST change's, 31 minutes, not the newest
        # change's 1 minute, which would sit inside the grace and say nothing.
        assert "31 minutes ago" in words


class TestWhatMustStayQuiet:
    def test_a_docs_only_merge_needs_no_build_and_says_nothing(self, history):
        code, words = verdict(history, history["website"], history["docs"])
        assert code == check.REACHED
        assert "Correctly unbuilt" in words

    def test_production_already_on_mains_head_says_nothing(self, history):
        code, _ = verdict(history, history["docs"], history["docs"])
        assert code == check.REACHED

    def test_a_change_still_inside_the_grace_is_not_an_alarm(self, history):
        code, words = verdict(
            history,
            history["released"],
            history["docs"],
            now=dt.datetime(2026, 9, 8, 13, 54, tzinfo=dt.UTC),
        )
        assert code == check.NO_VERDICT_YET
        assert "inside the" in words

    def test_a_page_that_cannot_be_read_is_not_evidence(self, history):
        code, words = verdict(
            history,
            None,
            history["docs"],
            problem="https://www.alethical.com/ answered HTTP 403",
        )
        assert code == check.NO_VERDICT_YET
        assert "not evidence" in words

    def test_a_commit_this_checkout_does_not_have_asks_again_rather_than_alarming(
        self, history
    ):
        code, words = verdict(history, SERVED, history["docs"])
        assert code == check.NO_VERDICT_YET
        assert "does not have" in words


class TestTheInstrumentItself:
    def test_a_deploying_build_that_stopped_stamping_is_its_own_alarm(self, history):
        code, words = verdict(history, None, history["docs"])
        assert code == check.NOT_REACHED
        assert "does not say which commit built it" in words

    def test_a_missing_stamp_inside_the_grace_is_just_the_release_still_running(
        self, history
    ):
        code, _ = verdict(
            history,
            None,
            history["docs"],
            now=dt.datetime(2026, 9, 8, 13, 54, tzinfo=dt.UTC),
        )
        assert code == check.NO_VERDICT_YET

    def test_production_serving_something_outside_mains_history_is_reported(
        self, history
    ):
        run(history["repo"], "checkout", "-q", "-b", "side", history["released"])
        elsewhere = commit(
            history["repo"],
            "apps/frontend/src/other.ts",
            "Built from somewhere else",
            dt.datetime(2026, 9, 8, 13, 45, tzinfo=dt.UTC),
        )
        run(history["repo"], "checkout", "-q", "main")
        code, words = verdict(history, elsewhere, history["docs"])
        assert code == check.NOT_REACHED
        assert "not in `main`'s history" in words


class TestItWatchesWhatVercelActuallyBuildsFrom:
    def test_the_watched_paths_are_read_out_of_vercel_json(self):
        """Copying them here would let the 2 lists drift apart silently."""
        command = json.loads((ROOT / "vercel.json").read_text())["ignoreCommand"]
        assert check.website_paths() == command.split(" -- ", 1)[1].split()
        assert "apps/frontend" in check.website_paths()
        assert "patches" in check.website_paths()

    def test_the_stamps_name_matches_the_script_that_writes_it(self):
        writer = (ROOT / "apps/frontend/scripts/stamp-release-commit.mjs").read_text()
        assert f"'{check.RELEASE_COMMIT_META_NAME}'" in writer


class TestTheShapeOf18September2026:
    """3 failed releases, then no release at all, replayed against real history.

    The commits, times and served commit are 18 Sep 2026's own. Readers were on
    `3108bde2` from 16:51. `3f383074` merged at 17:18:55 and its production build
    failed; 2 more merges failed behind it; then `1f577dfa` merged at 18:25:54 and
    Vercel created no production deployment for it at all. The alarm ran at
    18:33:46 and had to name both website changes and neither of the 2 merges a
    release would not have carried.
    """

    @pytest.fixture
    def september_18(self, tmp_path: Path) -> dict[str, object]:
        repo = tmp_path / "repo"
        repo.mkdir()
        run(repo, "init", "-q", "-b", "main")
        run(repo, "config", "user.email", "t@example.com")
        run(repo, "config", "user.name", "t")
        released = commit(
            repo,
            "apps/frontend/src/screens/Home.tsx",
            "The release readers were still on at 16:51",
            dt.datetime(2026, 9, 18, 16, 44, tzinfo=dt.UTC),
        )
        first_website = commit(
            repo,
            "apps/frontend/src/screens/BillSearchScreen.tsx",
            "Give each bill its own search-result sentence (#2271)",
            dt.datetime(2026, 9, 18, 17, 18, 55, tzinfo=dt.UTC),
        )
        backend_only = commit(
            repo,
            "alethical/api/routers/money.py",
            "Answer a committee-year's money from the index (#2286)",
            dt.datetime(2026, 9, 18, 17, 31, tzinfo=dt.UTC),
        )
        docs_only = commit(
            repo,
            "docs/operations/page-load-performance-decisions.md",
            "Record what the new money index did on production (#2290)",
            dt.datetime(2026, 9, 18, 18, 4, tzinfo=dt.UTC),
        )
        head = commit(
            repo,
            "apps/frontend/src/lib/head.ts",
            "Take the head-building code out of the first download (#2289)",
            dt.datetime(2026, 9, 18, 18, 25, 54, tzinfo=dt.UTC),
        )
        return {
            "repo": repo,
            "released": released,
            "first_website": first_website,
            "backend_only": backend_only,
            "docs_only": docs_only,
            "head": head,
        }

    def verdict_at_18_33(self, september_18):
        return check.report(
            head=september_18["head"],
            url="https://www.alethical.com/",
            grace_minutes=10,
            now=dt.datetime(2026, 9, 18, 18, 33, 46, tzinfo=dt.UTC),
            repo=september_18["repo"],
            read_stamp=lambda _url: (september_18["released"], None),
            paths=WEBSITE_PATHS,
        )

    def test_readers_stuck_behind_3_failed_releases_and_a_missing_one_is_reported(
        self, september_18
    ):
        code, words = self.verdict_at_18_33(september_18)
        assert code == check.NOT_REACHED
        assert "not reaching readers" in words

    def test_the_alarm_names_both_website_changes_and_neither_of_the_other_2(
        self, september_18
    ):
        """A release carries the website changes, so those are what a person chases."""
        _, words = self.verdict_at_18_33(september_18)
        assert "2 merged changes" in words
        assert september_18["first_website"][:8] in words
        assert september_18["head"][:8] in words
        assert september_18["backend_only"][:8] not in words
        assert september_18["docs_only"][:8] not in words

    def test_a_grace_already_spent_answers_at_once_rather_than_waiting_again(
        self, september_18
    ):
        """The 13-second run was the answer arriving, not the grace being skipped.

        The clock runs from `3f383074` at 17:18:55, so by 18:33:46 it is 75 minutes
        spent and the alarm is due on the first read. A clock restarted by the
        newest merge would have read 8 minutes, sat inside the 10-minute grace, and
        said nothing at all while readers were 75 minutes behind.
        """
        _, words = self.verdict_at_18_33(september_18)
        assert "75 minutes ago" in words


class TestTheApiHalfOfTheSameWatch:
    """The 8 Sep 2026 API skip, replayed against a real git history.

    Commit ``eb16615b`` merged to ``main`` at 02:33:33Z and Railway created no
    deployment for it. 17 minutes later the API still answered with the pre-merge
    code, with no red check, no alert and no failed deployment record anywhere
    (`issue 2046 <https://github.com/alethical-org/alethical/issues/2046>`_).

    The website and the API share every hard part of this check and differ only
    in which address is asked, which paths matter and what the repair is. These
    tests pin the differences; the classes above pin the shared part.
    """

    @pytest.fixture
    def september_8_api(self, tmp_path: Path) -> dict[str, object]:
        repo = tmp_path / "repo"
        repo.mkdir()
        run(repo, "init", "-q", "-b", "main")
        run(repo, "config", "user.email", "t@example.com")
        run(repo, "config", "user.name", "t")
        running = commit(
            repo,
            "alethical/api/routers/public.py",
            "The release the API was still running",
            dt.datetime(2026, 9, 8, 2, 17, 48, tzinfo=dt.UTC),
        )
        api_change = commit(
            repo,
            "alethical/api/serializers.py",
            "Send the bill list what a card draws, not what a bill page needs (#2037)",
            dt.datetime(2026, 9, 8, 2, 33, 33, tzinfo=dt.UTC),
        )
        website_only = commit(
            repo,
            "apps/frontend/src/screens/BillListScreen.tsx",
            "A website change, which needs no API release",
            dt.datetime(2026, 9, 8, 2, 34, tzinfo=dt.UTC),
        )
        return {
            "repo": repo,
            "running": running,
            "api_change": api_change,
            "website_only": website_only,
        }

    def verdict(self, history, served, head, now=None, problem=None, grace=15):
        answer = (served, None) if served else (None, problem or "no-stamp")
        return check.report(
            head=head,
            url=check.API_VERSION_URL,
            grace_minutes=grace,
            now=now or dt.datetime(2026, 9, 8, 2, 50, 20, tzinfo=dt.UTC),
            repo=history["repo"],
            read_stamp=lambda _url: answer,
            paths=API_PATHS,
            service=check.API,
        )

    def test_an_api_change_that_never_rebuilt_the_api_is_reported(
        self, september_8_api
    ):
        code, words = self.verdict(
            september_8_api, september_8_api["running"], september_8_api["api_change"]
        )
        assert code == check.NOT_REACHED
        assert "not reaching readers" in words
        assert september_8_api["api_change"][:8] in words
        # The repair has to be in the alarm. This was found by a person reading a
        # live answer 17 minutes in, and a person who then has to go and look up
        # the repair is the same failure in slower motion.
        assert "Deploy Latest Commit" in words
        assert "railway-deploy.yml" in words

    def test_it_says_the_api_rather_than_the_website(self, september_8_api):
        _, words = self.verdict(
            september_8_api, september_8_api["running"], september_8_api["api_change"]
        )
        assert "changes to the API" in words or "change to the API" in words
        assert "vercel" not in words.lower()

    def test_a_website_only_merge_needs_no_api_release_and_says_nothing(
        self, september_8_api
    ):
        """3 of the 4 missed pushes in 45 days changed nothing but the website.

        A check comparing against `main`'s tip would have cried wolf on all 3
        before the one that mattered arrived, and a watch people have learned to
        ignore is the state this whole thing exists to leave.
        """
        code, words = self.verdict(
            september_8_api,
            september_8_api["api_change"],
            september_8_api["website_only"],
        )
        assert code == check.REACHED
        assert "Correctly unbuilt" in words

    def test_an_api_that_does_not_say_its_commit_is_its_own_alarm(
        self, september_8_api
    ):
        code, words = self.verdict(
            september_8_api, None, september_8_api["website_only"]
        )
        assert code == check.NOT_REACHED
        assert "does not say which commit the API was built from" in words

    def test_an_unreachable_api_is_not_evidence(self, september_8_api):
        code, words = self.verdict(
            september_8_api,
            None,
            september_8_api["api_change"],
            problem=f"{check.API_VERSION_URL} answered HTTP 502",
        )
        assert code == check.NO_VERDICT_YET
        assert "not evidence" in words

    def test_a_release_still_inside_the_grace_is_not_an_alarm(self, september_8_api):
        code, words = self.verdict(
            september_8_api,
            september_8_api["running"],
            september_8_api["api_change"],
            now=dt.datetime(2026, 9, 8, 2, 40, tzinfo=dt.UTC),
        )
        assert code == check.NO_VERDICT_YET
        assert "inside the" in words


class TestWhatTheApiIsBuiltFrom:
    def test_the_watched_paths_are_derived_from_railwayignore(self):
        """Copying them here would let the 2 lists drift apart silently."""
        excluded = [
            line.strip()
            for line in (ROOT / ".railwayignore").read_text().splitlines()
            if line.strip() and not line.startswith("#")
        ]
        assert check.api_paths() == [".", *(f":(exclude){p}" for p in excluded)]
        assert ":(exclude)apps/frontend" in check.api_paths()
        assert ":(exclude)docs" in check.api_paths()

    def test_the_route_the_check_reads_is_the_route_the_api_serves(self):
        """One spelling of `/version`, in the app and in the thing that asks it."""
        assert check.API_VERSION_URL.endswith("/version")
        served = (ROOT / "alethical/api/main.py").read_text()
        assert '@app.get("/version"' in served

    def test_a_missing_version_route_is_an_answer_rather_than_a_failed_read(
        self, monkeypatch
    ):
        """A 404 means the route is gone, which is the silence this watch is for.

        Every other code is a read that did not happen and says nothing about
        whether a merge shipped, so only 404 turns into an alarm.
        """

        def refuse(code):
            def urlopen(_request, timeout=None):  # noqa: ARG001
                raise urllib.error.HTTPError(
                    check.API_VERSION_URL, code, "no", {}, None
                )

            return urlopen

        monkeypatch.setattr(urllib.request, "urlopen", refuse(404))
        assert check.read_api_release_commit(check.API_VERSION_URL) == (
            None,
            "no-stamp",
        )
        monkeypatch.setattr(urllib.request, "urlopen", refuse(502))
        _, problem = check.read_api_release_commit(check.API_VERSION_URL)
        assert problem is not None and "502" in problem

    def test_an_answer_without_a_real_commit_is_treated_as_no_answer(self, monkeypatch):
        """`null`, a short hash and a missing key are all "it cannot say"."""

        class Answer:
            def __init__(self, body):
                self.body = body.encode()

            def read(self):
                return self.body

            def __enter__(self):
                return self

            def __exit__(self, *_):
                return False

        for body in ('{"commit": null}', '{"commit": "abc123"}', "{}", "[]"):
            monkeypatch.setattr(
                urllib.request, "urlopen", lambda _r, timeout=None, b=body: Answer(b)
            )
            assert check.read_api_release_commit(check.API_VERSION_URL) == (
                None,
                "no-stamp",
            )
        real = "b" * 40
        monkeypatch.setattr(
            urllib.request,
            "urlopen",
            lambda _r, timeout=None: Answer('{"commit": "%s"}' % real),
        )
        assert check.read_api_release_commit(check.API_VERSION_URL) == (real, None)
