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

(The #1469 ``Design change:`` rule and its cases were removed with the temporary
sign-in design folder itself, #1533 — design working files no longer land under
``docs/`` at all.)
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
    # The files below have to actually be undeclared for this test to mean
    # anything, and "undeclared" is not a fixed property — a doc can adopt a file
    # at any time, which silently turns this into a test of the opposite
    # behaviour. That already happened once: this case used
    # ``alethical/pipeline/votes.py`` until #791 gave the data-ingestion guide a
    # ``alethical/pipeline/*.py`` glob, at which point the file WAS described and
    # the check was right to fail. It went unnoticed because the four commits
    # merged after #791 were all docs-only, so CI skipped the backend job every
    # time. So assert the premise first: if a doc adopts these files too, this
    # fails with the reason rather than with a bare exit-code mismatch.
    # #921 declared alethical/db/models.py (the previous pick) on
    # data-ingestion-onboarding.md, which broke this test on main: a docs-only PR
    # skips the backend job, so nothing caught it. The premise assertion below is
    # what turns that into a readable failure instead of a mystery exit code.
    # #1233 declared RootNavigator.tsx, so use a different frontend helper that
    # no documentation currently owns.
    undescribed = ["apps/frontend/src/lib/motionNormalize.ts", "justfile"]
    couplings = check_doc_sync.declared_couplings()
    for path in undescribed:
        owners = [
            doc
            for doc, globs in couplings.items()
            if any(fnmatch.fnmatch(path, glob) for glob in globs)
        ]
        assert not owners, (
            f"{path} is now declared by {owners}, so it no longer exercises the "
            "no-doc-describes-it case — pick a different file for this test"
        )
    assert _run(monkeypatch, undescribed, "") == 0


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


def test_a_fenced_example_is_not_a_declaration(tmp_path, monkeypatch):
    # A doc that *documents* this guard has to show the comment's syntax, and the
    # scanner is a raw-text regex rather than a Markdown parser, so nothing but an
    # explicit fence strip tells an example from a declaration. #919 shipped a
    # decision record whose fenced example named SearchBillsScreen.tsx; for about
    # an hour every PR touching that screen was told to re-read a document about
    # docs policy. PR #921 defused it by rewriting the example with placeholder
    # paths, which fixes that one doc and leaves the trap armed for the next.
    docs = tmp_path / "docs"
    docs.mkdir()
    (docs / "guide.md").write_text(
        "<!-- describes: real/declared.py -->\n"
        "\n"
        "# How the guard works\n"
        "\n"
        "Declare the coupling in the doc itself:\n"
        "\n"
        "```\n"
        "<!-- describes: example/only.py -->\n"
        "```\n"
        "\n"
        "Tilde fences and indented fences count too:\n"
        "\n"
        "  ~~~markdown\n"
        "  <!-- describes: also/example.py -->\n"
        "  ~~~\n",
        encoding="utf-8",
    )
    monkeypatch.setattr(check_doc_sync, "ROOT", tmp_path)

    # Unpack rather than naming the path: check_doc_references.py requires every
    # docs/ path written anywhere in the repo to resolve to a real file, and this
    # doc only exists inside tmp_path.
    (globs,) = check_doc_sync.declared_couplings().values()
    assert globs == ["real/declared.py"], (
        "a fenced example was read as a real declaration, so documenting this "
        f"guard arms it against an unrelated file: {globs}"
    )


def test_the_decision_record_does_not_declare_the_search_screen():
    # The live instance of the bug above, pinned against reintroduction: this doc
    # exists to explain the guard, so it will always contain the syntax.
    couplings = check_doc_sync.declared_couplings()
    declared = couplings.get("docs/operations/keeping-docs-current-decisions.md", [])
    assert not any("SearchBillsScreen" in glob for glob in declared), (
        "the decision record declares the search screen again — its example is "
        "being read as a declaration"
    )
