"""Give each worktree its own test database, so parallel sessions cannot collide.

The defect this removes ([#898](https://github.com/alethical-org/alethical/issues/898),
[#840](https://github.com/alethical-org/alethical/issues/840) -- one cause, two
symptoms): ``conftest.py`` resolved one database name for every checkout, and its
session-scoped autouse fixture migrates and re-seeds that database at the start
of every run. Two sessions running at once wiped each other's tables mid-run, and
the loser saw its whole suite error at setup, which reads exactly like "your
branch broke 459 tests". Two sessions on branches with different migration heads
left an ``alembic_version`` stamp the other branch could not resolve, which reads
like a broken migration chain in your own checkout.

Four sessions had already invented per-session databases by hand
(``alethical_test_wt780``, ``alethical_batchtest``, ``alethical_ci_check``,
``ask_retry_780_889bbcd``). A workaround four people invent independently is a
missing default, so this makes it the default -- ``uv run pytest`` in a fresh
worktree needs nothing set by hand.

Its own module rather than living in ``conftest.py`` so the naming can be tested
directly, for the same reason ``local_database_guard`` is separate: a naming bug
that re-collides leaves the suite green and only shows up as another session's
mystery failure.
"""

from __future__ import annotations

import hashlib
import re
from pathlib import Path

from sqlalchemy.engine import make_url

# The shared local dev Postgres every worktree points at, and the only thing
# split per worktree. CI pins DATABASE_URL to port 5432
# (`.github/workflows/ci.yml`), has one checkout and one database, and therefore
# has neither symptom -- so keying on the port leaves CI untouched by
# construction rather than by a special case that stops being re-checked.
SHARED_LOCAL_DEV_PORT = 54329

# The namespace this module owns. Pruning only ever considers names starting with
# this, so a hand-made database or the shared `alethical` one is never a
# candidate.
TEST_DATABASE_PREFIX = "alethical_test_"

# Postgres truncates identifiers past 63 bytes. Truncating two long worktree
# names to the same string would recreate the bug in a form that looks fixed, so
# the readable half is bounded and the hash carries uniqueness.
_MAX_IDENTIFIER_BYTES = 63
_HASH_LENGTH = 10
_MAX_READABLE = _MAX_IDENTIFIER_BYTES - len(TEST_DATABASE_PREFIX) - _HASH_LENGTH - 1


def worktree_database_name(worktree_path: str | Path) -> str:
    """A stable, unique, readable database name for one worktree.

    Readable half: the directory name, so a stray database can be traced back to
    what made it. Unique half: a hash of the full path, because two checkouts can
    share a basename (``/a/main`` and ``/b/main``) and colliding there would be
    this exact bug wearing a fix.
    """
    # resolve() before hashing, always. `git worktree list` reports the path as
    # it was registered and `Path(__file__).resolve()` reports it with every
    # symlink followed, and on macOS /tmp is a symlink to /private/tmp -- so the
    # same worktree hashed two ways. Measured, not imagined: with the two forms
    # disagreeing, one run's prune saw the other run's live database as abandoned
    # and dropped it mid-suite, failing 3 tests in one run and 5 in the other.
    # That is the exact collision this module exists to prevent, caused by the
    # fix for it, and only a genuinely concurrent test could surface it.
    path = Path(worktree_path).resolve()
    readable = re.sub(r"[^a-z0-9]+", "_", path.name.lower()).strip("_")[:_MAX_READABLE]
    digest = hashlib.sha256(str(path).encode()).hexdigest()[:_HASH_LENGTH]
    return (
        f"{TEST_DATABASE_PREFIX}{readable}_{digest}"
        if readable
        else (f"{TEST_DATABASE_PREFIX}{digest}")
    )


def worktree_database_url(
    resolved_url: str, worktree_path: str | Path, *, override: str | None = None
) -> str:
    """The URL this worktree's suite should use.

    ``override`` (``ALETHICAL_TEST_DATABASE_URL``) wins outright, for anyone who
    genuinely needs a specific database. Otherwise only the shared local dev
    Postgres is split; every other URL, CI's included, is returned untouched.
    """
    if override:
        return override
    url = make_url(resolved_url)
    if url.port != SHARED_LOCAL_DEV_PORT:
        return resolved_url
    name = worktree_database_name(worktree_path)
    if url.database == name:
        return resolved_url
    return url.set(database=name).render_as_string(hide_password=False)


def abandoned_test_databases(
    existing: list[str], live_worktree_paths: list[str | Path]
) -> list[str]:
    """Which of ``existing`` belong to worktrees that no longer exist.

    Two rules, and both matter. Only names in this module's own namespace are
    ever candidates, so the shared ``alethical`` database the app uses and other
    sessions' hand-made ones are untouchable. And a worktree that still exists is
    never a candidate, because a suite may be running against its database at
    this moment -- dropping that would be the collision this whole module exists
    to prevent, committed by the fix for it.
    """
    live = {worktree_database_name(path) for path in live_worktree_paths}
    return [
        name
        for name in existing
        if name.startswith(TEST_DATABASE_PREFIX) and name not in live
    ]
