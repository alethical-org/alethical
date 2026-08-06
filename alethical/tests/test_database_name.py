"""One test database per worktree, so parallel sessions cannot corrupt each other.

Everything here is pure string work on purpose: the naming is what has to be
right, and it can be checked without a Postgres server. The creating, seeding
and pruning live in ``conftest.py``, where they run for real on every suite.

Why this exists ([#898](https://github.com/alethical-org/alethical/issues/898),
[#840](https://github.com/alethical-org/alethical/issues/840) -- one cause, two
symptoms): ``conftest`` used to point every worktree at the same database, and
the session-scoped autouse fixture migrates and re-seeds it at the start of every
run. Two sessions running at once wiped each other's tables mid-run; two sessions
on branches with different migration heads left an ``alembic_version`` stamp the
other branch could not resolve. The shared name was the whole defect.
"""

from __future__ import annotations

from sqlalchemy.engine import make_url

from alethical.tests.database_name import (
    SHARED_LOCAL_DEV_PORT,
    TEST_DATABASE_PREFIX,
    abandoned_test_databases,
    worktree_database_name,
    worktree_database_url,
)

LOCAL = f"postgresql+psycopg://alethical:alethical@localhost:{SHARED_LOCAL_DEV_PORT}/alethical"
CI = "postgresql+psycopg://alethical:alethical@localhost:5432/alethical"


class TestTheNameItself:
    def test_two_worktrees_never_get_the_same_database(self) -> None:
        a = worktree_database_name(
            "/Users/eug/Code/Alethical/.claude/worktrees/happy-turing-1234"
        )
        b = worktree_database_name(
            "/Users/eug/Code/Alethical/.claude/worktrees/sad-turing-5678"
        )
        assert a != b

    def test_the_same_worktree_gets_the_same_database_every_run(self) -> None:
        """Otherwise every run migrates from empty and re-seeds, which is slow."""
        path = "/Users/eug/Code/Alethical/.claude/worktrees/happy-turing-1234"
        assert worktree_database_name(path) == worktree_database_name(path)

    def test_two_worktrees_sharing_a_basename_still_differ(self) -> None:
        """The readable half is the directory name, so it is not unique on its own.

        ``/a/main`` and ``/b/main`` are both plausible checkouts, and colliding
        here would recreate the exact bug in a form that looks fixed.
        """
        assert worktree_database_name("/one/checkout/main") != worktree_database_name(
            "/two/checkout/main"
        )

    def test_the_name_stays_inside_postgres_identifier_limits(self) -> None:
        """Postgres truncates past 63 bytes, which would silently re-collide."""
        long_path = "/Users/eug/Code/Alethical/.claude/worktrees/" + "x" * 200
        name = worktree_database_name(long_path)
        assert len(name.encode()) <= 63

    def test_the_name_is_safe_to_put_in_a_create_database_statement(self) -> None:
        """Worktree names come from branch names, which carry / and - freely."""
        name = worktree_database_name(
            "/Code/Alethical/.claude/worktrees/feat/Fix-Thing_v2!"
        )
        assert name.startswith(TEST_DATABASE_PREFIX)
        assert all(character.isalnum() or character == "_" for character in name)

    def test_the_name_says_what_it_belongs_to(self) -> None:
        """A stray database nobody can trace is how the current mess accumulated."""
        assert "happy_turing" in worktree_database_name("/wt/happy-turing-1234")


class TestWhichUrlsGetSplit:
    def test_the_shared_local_dev_postgres_is_split_per_worktree(self) -> None:
        url = make_url(worktree_database_url(LOCAL, "/wt/happy-turing-1234"))
        assert url.database == worktree_database_name("/wt/happy-turing-1234")
        assert url.host == "localhost"
        assert url.port == SHARED_LOCAL_DEV_PORT
        assert url.username == "alethical"

    def test_ci_is_left_exactly_as_it_is(self) -> None:
        """`.github/workflows/ci.yml` pins DATABASE_URL to port 5432.

        CI has one checkout and one database, so it has neither symptom, and a
        split that reached it would risk every PR in the repo for no gain. Keyed
        on the port rather than on a CI environment variable, so it cannot rot
        into a special case nobody re-checks.
        """
        assert worktree_database_url(CI, "/wt/happy-turing-1234") == CI

    def test_a_deliberate_override_wins(self) -> None:
        override = (
            "postgresql+psycopg://alethical:alethical@localhost:54329/something_else"
        )
        assert worktree_database_url(LOCAL, "/wt/x", override=override) == override

    def test_a_url_that_is_already_a_per_worktree_database_is_not_split_twice(
        self,
    ) -> None:
        once = worktree_database_url(LOCAL, "/wt/happy-turing-1234")
        assert worktree_database_url(once, "/wt/happy-turing-1234") == once


class TestPruning:
    """Only ever drop a database whose worktree is gone.

    A worktree that still exists might have a suite running against its database
    right now, and dropping it would be this very bug, committed by its own fix.
    """

    def test_a_database_for_a_live_worktree_is_kept(self) -> None:
        live = ["/wt/alpha", "/wt/beta"]
        existing = [worktree_database_name(path) for path in live]
        assert abandoned_test_databases(existing, live) == []

    def test_a_database_whose_worktree_is_gone_is_dropped(self) -> None:
        gone = worktree_database_name("/wt/removed")
        existing = [worktree_database_name("/wt/alpha"), gone]
        assert abandoned_test_databases(existing, ["/wt/alpha"]) == [gone]

    def test_databases_this_mechanism_did_not_create_are_never_touched(self) -> None:
        """The local Postgres holds hand-made ones from before this existed.

        ``alethical`` is the shared dev database the app itself uses; dropping it
        would be a genuinely destructive accident. ``alethical_batchtest`` and
        ``ask_retry_780_889bbcd`` are other sessions' artifacts and not ours to
        remove.
        """
        others = [
            "alethical",
            "alethical_batchtest",
            "alethical_ci_check",
            "ask_retry_780_889bbcd",
            "postgres",
            "template1",
        ]
        assert abandoned_test_databases(others, []) == []

    def test_it_does_drop_the_stray_left_by_the_bug_itself(self) -> None:
        """``alethical_test_wt780`` is real, and its worktree is long gone.

        A session hand-made it working around this exact problem (#840). It
        matches the prefix this mechanism owns, so cleaning it up is correct.
        """
        assert abandoned_test_databases(["alethical_test_wt780"], ["/wt/alpha"]) == [
            "alethical_test_wt780"
        ]


class TestPathsThatLookDifferentButAreTheSame:
    """The same worktree must hash the same however it is spelled.

    `git worktree list` reports the path as registered; `Path(__file__).resolve()`
    reports it with symlinks followed. On macOS `/tmp` is a symlink to
    `/private/tmp`, so those two disagree for any worktree under /tmp. When they
    disagreed, one run's prune classified another run's *live* database as
    abandoned and dropped it mid-suite. Found by running two suites at once, not
    by reading the code.
    """

    def test_a_symlinked_path_and_its_real_path_agree(self, tmp_path) -> None:
        real = tmp_path / "real-worktree"
        real.mkdir()
        link = tmp_path / "link-to-worktree"
        link.symlink_to(real)

        assert worktree_database_name(link) == worktree_database_name(real)

    def test_a_relative_path_and_its_absolute_form_agree(
        self, tmp_path, monkeypatch
    ) -> None:
        target = tmp_path / "some-worktree"
        target.mkdir()
        monkeypatch.chdir(tmp_path)

        assert worktree_database_name("some-worktree") == worktree_database_name(target)

    def test_a_live_worktree_named_the_other_way_is_never_pruned(
        self, tmp_path
    ) -> None:
        """The prune half of the same bug, stated as the consequence."""
        real = tmp_path / "real-worktree"
        real.mkdir()
        link = tmp_path / "link-to-worktree"
        link.symlink_to(real)

        # The database was created under one spelling, git reports the other.
        existing = [worktree_database_name(real)]
        assert abandoned_test_databases(existing, [link]) == []
