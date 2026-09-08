"""Prove the deploy decision builds when it is unsure, and skips only when it is certain.

Exit 0 skips a build and any other code builds, which is Vercel's convention for
an Ignored Build Step and what this repository's own records show: every
documents-only commit on ``main`` carries the Vercel status "Canceled by Ignored
Build Step".

The case that matters is the one that happened on 8 Sep 2026: a documents-only
commit landing in the same push as a website change, where comparing the newest
commit against its parent skips the build that was carrying the website change
underneath it (`issue 2075 <https://github.com/alethical-org/alethical/issues/2075>`_).
"""

from __future__ import annotations

import subprocess
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[2]
SCRIPT = ROOT / "scripts/vercel-ignore-build.sh"
PATHS = ["api", "apps/frontend", "vercel.json"]

SKIP = 0
BUILD = 1


def run(repo: Path, *args: str) -> str:
    return subprocess.run(
        ["git", *args], cwd=repo, capture_output=True, text=True, check=True
    ).stdout.strip()


def commit(repo: Path, path: str, message: str) -> str:
    target = repo / path
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(f"{message}\n")
    run(repo, "add", "-A")
    run(
        repo,
        "-c",
        "user.email=t@e.com",
        "-c",
        "user.name=t",
        "commit",
        "-q",
        "-m",
        message,
    )
    return run(repo, "rev-parse", "HEAD")


def decide(repo: Path, previous: str | None) -> tuple[int, str]:
    environment = {
        "PATH": "/usr/bin:/bin:/usr/local/bin:/opt/homebrew/bin",
        "HOME": str(repo),
    }
    if previous is not None:
        environment["VERCEL_GIT_PREVIOUS_SHA"] = previous
    done = subprocess.run(
        ["bash", str(SCRIPT), "--", *PATHS],
        cwd=repo,
        capture_output=True,
        text=True,
        env=environment,
    )
    return done.returncode, done.stdout + done.stderr


@pytest.fixture
def history(tmp_path: Path) -> dict[str, object]:
    """The 8 Sep push: a released commit, a website change, then a documents change."""
    repo = tmp_path / "repo"
    repo.mkdir()
    run(repo, "init", "-q", "-b", "main")
    released = commit(repo, "notes/start.md", "Released and live")
    website = commit(repo, "apps/frontend/src/Committee.tsx", "A website change")
    documents = commit(repo, "notes/costs.md", "A documents-only change")
    return {
        "repo": repo,
        "released": released,
        "website": website,
        "documents": documents,
    }


class TestTheShapeThatHappened:
    def test_it_builds_a_documents_only_head_that_carries_a_website_change(
        self, history
    ):
        code, words = decide(history["repo"], history["released"])
        assert code == BUILD
        assert "changed between" in words

    def test_the_old_1_commit_comparison_would_have_skipped_that_very_case(
        self, history
    ):
        """The defect, reproduced, so nobody reintroduces the old comparison."""
        code, _ = decide(history["repo"], history["website"])
        assert code == SKIP


class TestWhatItStillSkips:
    def test_a_documents_only_change_since_the_last_release_needs_no_build(
        self, history
    ):
        code, words = decide(history["repo"], history["website"])
        assert code == SKIP
        assert "nothing under" in words

    def test_the_commit_already_released_needs_no_build(self, history):
        code, _ = decide(history["repo"], history["documents"])
        assert code == SKIP


class TestItBuildsWheneverItCannotTell:
    def test_an_empty_previous_commit_builds(self, history):
        code, words = decide(history["repo"], "")
        assert code == BUILD
        assert "VERCEL_GIT_PREVIOUS_SHA is empty" in words

    def test_a_missing_previous_commit_builds(self, history):
        code, words = decide(history["repo"], None)
        assert code == BUILD
        assert "VERCEL_GIT_PREVIOUS_SHA is empty" in words

    def test_a_commit_this_clone_does_not_hold_builds(self, history):
        code, words = decide(history["repo"], "a" * 40)
        assert code == BUILD
        assert "does not hold" in words

    def test_no_paths_after_the_separator_builds(self, history, tmp_path):
        done = subprocess.run(
            ["bash", str(SCRIPT), "--"],
            cwd=history["repo"],
            capture_output=True,
            text=True,
            env={
                "PATH": "/usr/bin:/bin",
                "VERCEL_GIT_PREVIOUS_SHA": str(history["released"]),
            },
        )
        assert done.returncode == BUILD
        assert "no paths were given" in done.stdout


class TestItReadsTheSameListVercelDoes:
    def test_vercel_json_hands_the_paths_over_after_a_separator(self):
        """`check_production_release_reached_readers.py` parses the same `--`."""
        import json

        command = json.loads((ROOT / "vercel.json").read_text())["ignoreCommand"]
        assert command.startswith("bash scripts/vercel-ignore-build.sh --")
        assert "apps/frontend" in command.split(" -- ", 1)[1].split()
