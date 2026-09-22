"""Which commit the running API was built from.

**Net: until this existed, nothing could ask the live API what version it was
running, so a merge that never rebuilt it was invisible.** On 8 Sep 2026 commit
``eb16615b`` merged at 02:33:33Z, Railway created no deployment for it, and 17
minutes later the API still answered with the pre-merge code. There was no red
check, no alert and no failed deployment record, and it surfaced only because
somebody read the live answer instead of trusting the green merge
(`issue 2046 <https://github.com/alethical-org/alethical/issues/2046>`_).

The website already answers this question about itself: every deploying build
writes its commit into the served page
(``apps/frontend/scripts/stamp-release-commit.mjs``), and
``scripts/check_production_release_reached_readers.py`` reads it after every
merge. The API had no equivalent, so its half of the same question could not be
asked at all. ``GET /version`` is that equivalent.

WHERE THE COMMIT COMES FROM, AND WHY THERE ARE 3 SOURCES.

- ``RAILWAY_GIT_COMMIT_SHA`` is what Railway sets, and only for a deploy that
  came from the GitHub connection, which is the normal release.
- ``alethical/release_commit.txt`` carries it for the hand-run repair.
  ``.github/workflows/railway-deploy.yml`` uploads a source archive rather than
  being driven by the Git connection, so Railway sets no git variables on that
  path and the commit has to travel in the files themselves. Without it the
  repair for a missed release would produce an API that cannot say which commit
  it is, and the watch would keep reporting an outage that was already over.
- ``ALETHICAL_RELEASE_COMMIT`` overrides both, for a release put up some other
  way.

A plain local run matches none of them and reports ``None``. That is correct and
must never fail: what a laptop runs reaches no reader. A DEPLOYED API reporting
``None`` is a different matter, and the watch treats it as its own alarm rather
than going quiet, because an instrument nobody can read is how the 8 Sep
incident happened in the first place.
"""

from __future__ import annotations

import os
import re
from pathlib import Path

#: A commit and nothing else. Anything shorter, longer or abbreviated is refused
#: rather than reported, because a half-answer here reads as a real one.
COMMIT = re.compile(r"^[0-9a-f]{40}$")

#: Written by the hand-run deploy, read here. Tracked in git holding the word
#: ``unknown``, so a checkout that was never deployed says nothing rather than
#: claiming a commit it cannot know.
RELEASE_COMMIT_FILE = Path(__file__).resolve().parent / "release_commit.txt"

#: Checked in this order. The environment wins, because on the normal release
#: path the file in the uploaded tree is the tracked placeholder.
ENVIRONMENT_NAMES = ("ALETHICAL_RELEASE_COMMIT", "RAILWAY_GIT_COMMIT_SHA")


def release_commit(
    environment: dict[str, str] | None = None,
    commit_file: Path | None = None,
) -> str | None:
    """The commit this API was built from, or ``None`` when it cannot know."""
    environment = os.environ if environment is None else environment
    for name in ENVIRONMENT_NAMES:
        value = environment.get(name, "").strip()
        if COMMIT.match(value):
            return value
    path = RELEASE_COMMIT_FILE if commit_file is None else commit_file
    try:
        value = path.read_text(encoding="utf-8").strip()
    except OSError:
        return None
    return value if COMMIT.match(value) else None
