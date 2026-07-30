"""Unit coverage for the docs-drift guard (``scripts/check_doc_sync.py``).

A guard that silently stops guarding is worse than no guard, because it reports
success. These tests pin the two outcomes that matter, using the real change
that motivated the script: PR #345 removed the "AI SUMMARY" eyebrow from
``BillResultCard.tsx`` and left both the search spec and the plain-English guide
claiming AI summaries are labelled.
"""

from __future__ import annotations

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


def test_updating_the_doc_itself_passes_without_a_body_line(monkeypatch):
    # Someone who already fixed the guide shouldn't also have to write a line
    # about having fixed it.
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
        == 0
    )


def test_code_no_doc_describes_is_ignored(monkeypatch):
    # The check must stay quiet on unrelated work, or it becomes noise people
    # learn to click past.
    assert _run(monkeypatch, ["alethical/pipeline/votes.py", "justfile"], "") == 0


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
