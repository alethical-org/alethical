"""Document discovery checks in temporary Git repositories, without dependencies."""

from __future__ import annotations

import importlib.util
import subprocess
import tempfile
import unittest
from pathlib import Path

DOCS = "docs/"
SCRIPT = Path(__file__).resolve().parents[1] / "check_doc_structure.py"
SPEC = importlib.util.spec_from_file_location("check_doc_structure", SCRIPT)
CHECKS = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(CHECKS)


class DocStructureTest(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory(prefix="alethical-docs-")
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name)
        self.git("init", "-q")
        self.write(DOCS + "README.md", "# Documents\n")

    def git(self, *args):
        subprocess.run(["git", *args], cwd=self.root, check=True, capture_output=True)

    def write(self, name, content=""):
        path = self.root / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(content, encoding="utf-8")
        self.git("add", "--", name)

    def problems(self):
        return CHECKS.find_problems(self.root)

    def test_missing_index_entry_is_reported(self):
        self.write(DOCS + "guide.md")
        self.assertEqual(
            self.problems(),
            [
                DOCS
                + "guide.md: add a link from docs/README.md or a reachable nested index"
            ],
        )

    def test_nested_indexes_reach_their_listed_documents(self):
        self.write(DOCS + "README.md", "[Research](research/README.md)\n")
        self.write(DOCS + "research/README.md", "[Findings](findings/index.md)\n")
        self.write(DOCS + "research/findings/index.md", "[Study](study.md)\n")
        self.write(DOCS + "research/findings/study.md")
        self.assertEqual(self.problems(), [])

    def test_directory_link_does_not_cover_every_child(self):
        self.write(DOCS + "README.md", "[Research](research/)\n")
        self.write(DOCS + "research/README.md", "[Study](study.md)\n")
        self.write(DOCS + "research/study.md")
        self.write(DOCS + "research/hidden.md")
        self.assertEqual(len(self.problems()), 1)
        self.assertTrue(self.problems()[0].startswith(DOCS + "research/hidden.md:"))

    def test_orphan_index_and_its_children_are_reported(self):
        self.write(DOCS + "research/README.md", "[Study](study.md)\n")
        self.write(DOCS + "research/study.md")
        self.assertEqual(len(self.problems()), 2)

    def test_links_in_ordinary_documents_do_not_replace_index_entries(self):
        self.write(DOCS + "README.md", "[Guide](guide.md)\n")
        self.write(DOCS + "guide.md", "[Other](other.md)\n")
        self.write(DOCS + "other.md")
        self.assertTrue(self.problems()[0].startswith(DOCS + "other.md:"))

    def test_deleted_working_file_is_omitted(self):
        self.write(DOCS + "old.md")
        (self.root / (DOCS + "old.md")).unlink()
        self.assertEqual(self.problems(), [])

    def test_untracked_and_ignored_worktrees_are_not_scanned(self):
        self.write(".gitignore", ".claude/worktrees/\n")
        for name in [
            DOCS + "unfinished.md",
            ".claude/worktrees/other/design_handoff_test/export.dc.html",
        ]:
            path = self.root / name
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text("not tracked")
        self.assertEqual(self.problems(), [])

    def test_design_exports_are_forbidden(self):
        names = [
            "design_handoff_find_my_legislator/support.js",
            "design-handoff-test/screen.html",
            DOCS + "design/handoff-money/screen.html",
            DOCS + "design/mockups/screen.html",
            DOCS + "mockups/screen.html",
            "temporary/screen.dc.html",
        ]
        for name in names:
            self.write(name)
        self.assertEqual(len(self.problems()), len(names))
        self.assertTrue(
            all("design working files" in problem for problem in self.problems())
        )

    def test_ordinary_html_and_operational_handoff_are_allowed(self):
        self.write(
            DOCS + "README.md", "[Android](operations/android-prototype-handoff.md)\n"
        )
        self.write(DOCS + "operations/android-prototype-handoff.md")
        self.write(DOCS + "operations/git-branching-guide.html")
        self.write(DOCS + "evidence/screenshot.png")
        self.assertEqual(self.problems(), [])

    def test_spaces_anchors_titles_and_reference_links(self):
        self.write(
            DOCS + "README.md",
            '[A](<research/with spaces.md#section>)\n[B](research/encoded%20space.md#title "Title")\n[C][third]\n[third]: research/third.md\n',
        )
        self.write(DOCS + "research/with spaces.md")
        self.write(DOCS + "research/encoded space.md")
        self.write(DOCS + "research/third.md")
        self.assertEqual(self.problems(), [])

    def test_examples_and_external_links_are_not_index_entries(self):
        self.write(
            DOCS + "README.md",
            "[Outside](https://example.invalid/docs/guide.md)\n```md\n[Example](guide.md)\n```\n<!-- [Hidden](guide.md) -->\n`[Example](guide.md)`\n",
        )
        self.write(DOCS + "guide.md")
        self.assertEqual(len(self.problems()), 1)

    def test_missing_root_index_is_reported(self):
        (self.root / (DOCS + "README.md")).unlink()
        self.assertEqual(
            self.problems(), [DOCS + "README.md: documentation index is missing"]
        )


if __name__ == "__main__":
    unittest.main()
