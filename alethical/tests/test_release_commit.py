"""Prove the API can say which commit it is running, and never guesses.

**Net: a merge that never rebuilt the API was invisible because nothing could ask
the live API what version it was running.** On 8 Sep 2026 commit ``eb16615b``
merged at 02:33:33Z, Railway created no deployment, and 17 minutes later the API
still answered with the pre-merge code, with no red check, no alert and no failed
deployment record
(`issue 2046 <https://github.com/alethical-org/alethical/issues/2046>`_).
``GET /version`` is what ends that, and
``.github/workflows/api-release-missing.yml`` reads it after every merge.

The rule these tests hold to is that a half-answer is worse than none: an
abbreviated or malformed value must come back as ``None`` rather than as a
commit, because the watch treats any commit it is given as what the API is
actually running.
"""

from __future__ import annotations

from pathlib import Path

from fastapi.testclient import TestClient

from alethical.api.main import create_app
from alethical.release import RELEASE_COMMIT_FILE, release_commit

SHA = "eb16615b416963260daea9d2d86b6d5b06da8330"
OTHER = "91b6054ad6875f0de6b976b90321c4ef3cc42793"


def test_railways_own_variable_is_the_normal_answer(tmp_path: Path) -> None:
    """The normal release comes from Railway's GitHub connection, which sets it."""
    assert release_commit({"RAILWAY_GIT_COMMIT_SHA": SHA}, tmp_path / "absent") == SHA


def test_the_uploaded_file_answers_for_the_hand_run_repair(tmp_path: Path) -> None:
    """Railway sets no git variables on a source-archive upload.

    `.github/workflows/railway-deploy.yml` writes the commit into this file
    before uploading, so the repair for a missed release puts up an API that can
    still say which commit it is. Without that, the watch would keep reporting an
    outage that was already over.
    """
    written = tmp_path / "release_commit.txt"
    written.write_text(f"{SHA}\n")
    assert release_commit({}, written) == SHA


def test_the_environment_wins_over_the_file(tmp_path: Path) -> None:
    """On the normal path the uploaded file is the tracked placeholder."""
    written = tmp_path / "release_commit.txt"
    written.write_text(f"{OTHER}\n")
    assert release_commit({"RAILWAY_GIT_COMMIT_SHA": SHA}, written) == SHA
    assert release_commit({"ALETHICAL_RELEASE_COMMIT": SHA}, written) == SHA


def test_anything_that_is_not_a_whole_commit_is_no_answer(tmp_path: Path) -> None:
    """A half-answer here reads as a real one, so it is refused."""
    written = tmp_path / "release_commit.txt"
    for value in ("unknown", "", SHA[:8], SHA.upper(), f"{SHA}x", "HEAD"):
        written.write_text(f"{value}\n")
        assert release_commit({"RAILWAY_GIT_COMMIT_SHA": value}, written) is None


def test_a_laptop_that_knows_no_commit_says_so_rather_than_failing(
    tmp_path: Path,
) -> None:
    """What a laptop runs reaches no reader, so this must never be an error."""
    assert release_commit({}, tmp_path / "not-there") is None


def test_the_tracked_placeholder_is_not_a_commit() -> None:
    """The file in git must never claim a version a checkout cannot know."""
    assert RELEASE_COMMIT_FILE.read_text().strip() == "unknown"
    assert release_commit({}, RELEASE_COMMIT_FILE) is None


def test_version_answers_the_commit_and_is_never_cached() -> None:
    """A cached answer here would report a version that is no longer running."""
    with TestClient(create_app()) as client:
        response = client.get("/version")
    assert response.status_code == 200
    assert set(response.json()) == {"commit"}
    assert response.headers["cache-control"] == "no-store"


def test_healthz_still_answers_exactly_what_every_monitor_expects() -> None:
    """`/version` is a separate route so `/healthz`'s contract does not move.

    Docker's container check, `CONTRIBUTING.md` and `AGENTS.md` all state that
    `/healthz` answers `{"status":"ok"}`.
    """
    with TestClient(create_app()) as client:
        response = client.get("/healthz")
    assert response.json() == {"status": "ok"}
