"""Tests for ``scripts/check_jobs_and_scripts_inventory.py``.

The check exists because ``docs/operations/jobs-and-scripts.md`` went stale twice in a
week: `#1869 <https://github.com/alethical-org/alethical/issues/1869>`_ (48 stated
against 55 real scripts, 5 scripts and 2 workflows named nowhere), then 1 Sep 2026 (55
stated against 57 real). So these tests are written to fail on the **attempt**: each one
reproduces a drift shape from those 2 incidents against a copy of the real page and the
real workflows, and asserts the check catches it.

The fixture copies the repository's own page and its ``.github/workflows/`` directory
rather than inventing small examples, because the workflow-count checks read real ``on:``
blocks and a hand-written stand-in would prove nothing about the files CI runs.
"""

from __future__ import annotations

import importlib.util
import shutil
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parents[2]
SCRIPT = REPO_ROOT / "scripts" / "check_jobs_and_scripts_inventory.py"
_spec = importlib.util.spec_from_file_location(
    "check_jobs_and_scripts_inventory", SCRIPT
)
check_inventory = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(check_inventory)

DOC = check_inventory.DOC


@pytest.fixture
def fake_repo(tmp_path: Path) -> Path:
    """A copy of the real page, the real workflows, and the real script filenames.

    Script bodies are not needed -- the check only reads their names -- so they are
    created empty, which keeps the fixture fast while the names stay real.
    """
    (tmp_path / DOC.parent).mkdir(parents=True)
    shutil.copy(REPO_ROOT / DOC, tmp_path / DOC)
    shutil.copytree(REPO_ROOT / ".github/workflows", tmp_path / ".github/workflows")
    scripts = tmp_path / "scripts"
    scripts.mkdir()
    (scripts / "tests").mkdir()
    for name in check_inventory.runnable_scripts(REPO_ROOT):
        (scripts / name).touch()
    return tmp_path


def edit_doc(root: Path, old: str, new: str) -> None:
    """Replace exactly one occurrence in the page copy, so a typo cannot pass silently."""
    text = (root / DOC).read_text(encoding="utf-8")
    assert text.count(old) == 1, f"expected 1 occurrence of {old!r}"
    (root / DOC).write_text(text.replace(old, new), encoding="utf-8")


def problems(root: Path) -> list[str]:
    return check_inventory.find_problems(root=root)


def test_the_real_page_matches_the_real_repository():
    assert check_inventory.find_problems() == []


def test_the_fixture_copy_matches_before_it_is_broken(fake_repo: Path):
    # Every test below asserts a failure. Without this one, a fixture that failed for
    # its own reasons would make all of them pass for the wrong reason.
    assert problems(fake_repo) == []


def test_a_script_on_disk_and_in_no_table_fails(fake_repo: Path):
    # The 1 Sep 2026 shape: a script landed in scripts/ and no table named it.
    (fake_repo / "scripts" / "backfill_a_new_thing.py").touch()

    found = problems(fake_repo)

    assert any("backfill_a_new_thing.py" in message for message in found)
    assert any("in no table" in message for message in found)


def test_a_table_name_with_no_file_fails(fake_repo: Path):
    # A rename leaves the old name behind. Nothing else in the repo checks a
    # scripts/ path in prose: check_doc_references.py only follows docs/ paths.
    edit_doc(fake_repo, "`check_rag_coverage.py`", "`check_rag_covrage.py`")

    found = problems(fake_repo)

    assert any("check_rag_covrage.py" in message for message in found)
    assert any("no such file" in message for message in found)


def test_a_wrong_runnable_file_count_fails(fake_repo: Path):
    # #1869's headline: the stated total trailed the real one by 7.
    real = len(check_inventory.runnable_scripts(REPO_ROOT))
    edit_doc(
        fake_repo,
        f"has {real} runnable files",
        f"has {real - 7} runnable files",
    )

    found = problems(fake_repo)

    assert any(
        f"says {real - 7} for the runnable files in scripts/" in message
        and f"repository has {real}" in message
        for message in found
    )


def test_a_workflow_named_nowhere_fails(fake_repo: Path):
    # #1869 missed 2 whole workflows.
    (fake_repo / ".github/workflows/new-nightly-check.yml").write_text(
        "on:\n  workflow_dispatch:\n", encoding="utf-8"
    )

    found = problems(fake_repo)

    assert any("new-nightly-check.yml" in message for message in found)
    assert any("named nowhere" in message for message in found)


def test_a_doc_named_workflow_that_does_not_exist_fails(fake_repo: Path):
    (fake_repo / ".github/workflows/migrate.yml").unlink()

    found = problems(fake_repo)

    assert any(
        "migrate.yml" in message and "no such workflow exists" in message
        for message in found
    )


@pytest.mark.parametrize(
    ("meaning", "sentence"),
    (
        ("workflows in total", "The repository has {n} GitHub Actions workflows"),
        ("workflows that can start on their own", "{n} can start automatically"),
        (
            "workflows only a person can start",
            "{n} run only when a person starts them",
        ),
        ("clock-based workflows", "The {n} clock-based GitHub jobs use UTC"),
        ("scripts a GitHub job runs", "GitHub jobs call {n} of them"),
    ),
)
def test_each_wrong_workflow_or_caller_count_fails(
    fake_repo: Path, meaning: str, sentence: str
):
    # Every one of these was wrong in #1869 or is derived the same way. The page wraps
    # its lines, so the stated number is found by rereading the page's own words.
    # Read the stated number off the page rather than hardcoding it, so the test does
    # not go stale the next time a workflow lands.
    text = (fake_repo / DOC).read_text(encoding="utf-8")
    counts, count_problems = check_inventory.prose_counts(text)
    assert count_problems == []
    stated = counts[meaning]

    edit_doc(
        fake_repo,
        sentence.format(n=stated),
        sentence.format(n=stated + 3),
    )

    found = problems(fake_repo)

    assert any(
        f"says {stated + 3} for the {meaning}" in message
        and f"repository has {stated}" in message
        for message in found
    )


def test_rewording_a_counted_sentence_fails_instead_of_switching_it_off(
    fake_repo: Path,
):
    # The guard's own weak point: a rewrite that no longer matches would leave the
    # count unchecked and everything still green.
    edit_doc(
        fake_repo,
        "The `scripts/` folder has",
        "The `scripts/` directory holds",
    )

    found = problems(fake_repo)

    assert any(
        "the runnable files in scripts/ matched 0 times" in message
        and "no longer being checked" in message
        for message in found
    )


def test_a_workflow_with_no_readable_on_block_is_reported_not_miscounted(
    fake_repo: Path,
):
    # A flow-style or quoted `on:` cannot be read without a YAML parser, and this check
    # has none. Saying so beats counting it as by-hand-only.
    (fake_repo / ".github/workflows/migrate.yml").write_text(
        '"on": [workflow_dispatch]\njobs: {}\n', encoding="utf-8"
    )

    found = problems(fake_repo)

    assert any(
        "migrate.yml" in message and "no readable `on:` block" in message
        for message in found
    )


def test_scripts_tests_directory_is_not_counted_as_a_runnable_file():
    names = check_inventory.runnable_scripts(REPO_ROOT)

    assert "tests" not in names
    assert not any(name.startswith(".") for name in names)


def test_a_similarly_named_script_in_another_folder_is_not_counted_as_ours():
    # apps/frontend/scripts/traffic-token-expiry.mjs is run by a workflow and the page
    # says in so many words that it is not part of this list or its totals.
    called = check_inventory.scripts_run_by_workflows(REPO_ROOT)

    assert "traffic-token-expiry.mjs" not in called
