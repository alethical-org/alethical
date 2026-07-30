"""Unit coverage for the docs-drift guard (``scripts/check_doc_sync.py``).

A guard that silently stops guarding is worse than no guard, because it reports
success. These tests pin the outcomes that matter, using the real change that
motivated the script: PR #345 removed the "AI SUMMARY" eyebrow from
``BillResultCard.tsx`` and left both the search spec and the plain-English guide
claiming AI summaries are labelled.

They also pin the Jul 30 2026 tightening: editing a doc is no longer an exemption,
because two PRs an hour apart each edited one subsection of the billing guide,
each passed on the strength of that edit, and each left the section above it
false. See the script's own docstring for the incident.
"""

from __future__ import annotations

import fnmatch
import importlib.util
from pathlib import Path

SCRIPT = Path(__file__).resolve().parents[2] / "scripts" / "check_doc_sync.py"
_spec = importlib.util.spec_from_file_location("check_doc_sync", SCRIPT)
check_doc_sync = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(check_doc_sync)


def _run(monkeypatch, changed, body):
    monkeypatch.setattr(check_doc_sync, "changed_files", lambda base: changed)
    monkeypatch.setenv("DOC_SYNC_PR_BODY", body)
    return check_doc_sync.main()


def test_card_change_without_an_acknowledgement_fails(monkeypatch):
    # The #345 shape: card code changes, neither describing doc changes, and the
    # body never mentions the docs. This is the case that shipped stale docs.
    assert (
        _run(
            monkeypatch,
            ["apps/frontend/src/components/search/BillResultCard.tsx"],
            "Removes the eyebrow row for a cleaner card.",
        )
        == 1
    )


def test_acknowledgement_in_the_body_passes(monkeypatch):
    # "None needed" is a first-class answer: the goal is a considered look, not a
    # doc edit on every commit.
    assert (
        _run(
            monkeypatch,
            ["apps/frontend/src/components/search/BillResultCard.tsx"],
            "Docs check: none needed — no user-visible change.",
        )
        == 0
    )


def test_editing_the_doc_is_not_a_free_pass(monkeypatch):
    # This used to pass, on the reasoning that someone who already fixed the guide
    # shouldn't also write a line saying so. That assumed an edit implies a read.
    # #784 and #785 each edited one subsection of the billing guide, each passed on
    # the strength of that edit, and each left the section above it describing a
    # runner that took neither discount — so the page contradicted itself, twice.
    assert (
        _run(
            monkeypatch,
            [
                "apps/frontend/src/components/search/BillResultCard.tsx",
                "docs/product-onboarding/search-bills-guide.md",
                "docs/product-onboarding/bill-search-screen-spec.md",
            ],
            "Puts a quiet AI label back on the card.",
        )
        == 1
    )


def test_editing_the_doc_and_saying_so_passes(monkeypatch):
    # The fix for the above is one sentence, not a doc rewrite. Naming what was
    # reread is what makes a partial edit visible to a reviewer.
    assert (
        _run(
            monkeypatch,
            [
                "apps/frontend/src/components/search/BillResultCard.tsx",
                "docs/product-onboarding/search-bills-guide.md",
            ],
            "Docs check: reread search-bills-guide.md end to end; updated the card "
            "section only, the rest still holds.",
        )
        == 0
    )


def test_code_no_doc_describes_is_ignored(monkeypatch):
    # The check must stay quiet on unrelated work, or it becomes noise people
    # learn to click past.
    #
    # The path is derived, not hardcoded: this test named `alethical/pipeline/votes.py`
    # until a doc declared `alethical/pipeline/*.py`, at which point it failed on main
    # for a reason that had nothing to do with the behaviour it pins. Pick something
    # genuinely undeclared at run time, and say so when nothing is.
    couplings = check_doc_sync.declared_couplings()
    candidates = [
        "justfile",
        "alethical/tests/conftest.py",
        "scripts/load_sample_data.py",
        ".gitignore",
    ]
    undeclared = [
        path
        for path in candidates
        if not any(
            fnmatch.fnmatch(path, glob)
            for globs in couplings.values()
            for glob in globs
        )
    ]
    assert undeclared, (
        "every candidate path is now declared by some doc — pick one that is not, "
        f"or this test cannot check what it claims to. Couplings: {couplings}"
    )
    assert _run(monkeypatch, undeclared, "") == 0


def test_the_search_docs_actually_declare_the_card(monkeypatch):
    # Guards the declarations themselves: if a doc's `describes:` comment is
    # dropped or its path typo'd, the couplings above would pass for the wrong
    # reason — matching nothing rather than matching correctly.
    couplings = check_doc_sync.declared_couplings()
    for doc in (
        "docs/product-onboarding/search-bills-guide.md",
        "docs/product-onboarding/bill-search-screen-spec.md",
    ):
        assert doc in couplings, f"{doc} no longer declares what it describes"
        assert any("BillResultCard" in glob for glob in couplings[doc]), (
            f"{doc} no longer declares the bill card it describes"
        )
