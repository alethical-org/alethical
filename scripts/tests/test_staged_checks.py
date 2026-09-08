"""Real staged-file and hook-install checks in disposable Git repositories.

Uses the already installed Node dependencies. Never installs packages, touches a
database, or pushes a ref. Only the fixture's node_modules links outside its tree.
"""

from __future__ import annotations

import os
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

PROJECT = Path(__file__).resolve().parents[2]


class GitFixture(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory(prefix="alethical-staged-fixture-")
        self.addCleanup(self.directory.cleanup)
        self.root = Path(self.directory.name)
        self.env = {
            key: value
            for key, value in os.environ.items()
            if not key.startswith("GIT_") and key != "CI"
        }
        self.env.update({"GIT_CONFIG_NOSYSTEM": "1", "GIT_CONFIG_GLOBAL": os.devnull})
        self.git("init", "-q")
        self.git("config", "user.name", "Staging fixture")
        self.git("config", "user.email", "staging@example.invalid")
        self.git("config", "commit.gpgsign", "false")
        self.git("config", "core.hooksPath", os.devnull)
        for name in (
            "scripts/local_checks.py",
            "scripts/format_frontend.mjs",
            "scripts/install_git_hooks.py",
            "lint-staged.config.mjs",
            "package.json",
            "apps/frontend/package.json",
            "apps/frontend/.prettierrc.json",
            "apps/frontend/.prettierignore",
            ".githooks/post-checkout",
            ".githooks/pre-commit",
            ".githooks/pre-push",
        ):
            target = self.root / name
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(PROJECT / name, target)
        (self.root / ".gitignore").write_text("node_modules\n")
        self.frontend = self.root / "apps/frontend"
        self.file = self.frontend / "selected file.ts"
        self.baseline = "export const selected = 0;\n\n" + "// unchanged context\n" * 12
        self.baseline += "export const unfinished = 0;\n"
        self.file.write_text(self.baseline)
        self.other = self.frontend / "other.ts"
        self.other.write_text("export const other = 0;\n")
        self.git("add", ".")
        self.git("commit", "-qm", "Initial fixture")

    def command(self, *args, check=True):
        result = subprocess.run(
            list(args),
            cwd=self.root,
            env=self.env,
            text=True,
            capture_output=True,
            check=False,
        )
        if check:
            self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        return result

    def git(self, *args, check=True):
        return self.command("git", *args, check=check)

    def show(self, revision, path):
        return self.git(
            "show", f"{revision}:{path.relative_to(self.root).as_posix()}"
        ).stdout

    def install(self, check=True):
        return self.command(sys.executable, "scripts/install_git_hooks.py", check=check)


class StagedChecks(GitFixture):
    @classmethod
    def setUpClass(cls):
        if shutil.which("node") is None:
            raise unittest.SkipTest(
                "Node is missing; real staged-file integration needs Node."
            )
        required = (
            PROJECT / "node_modules/lint-staged/bin/lint-staged.js",
            PROJECT / "node_modules/lint-staged/package.json",
        )
        prettier = any(
            (PROJECT / folder / "prettier/bin/prettier.cjs").is_file()
            for folder in ("node_modules", "apps/frontend/node_modules")
        )
        if not all(path.is_file() for path in required) or not prettier:
            raise unittest.SkipTest(
                "Installed lint-staged/Prettier dependencies are missing; run pnpm install --frozen-lockfile first."
            )

    def setUp(self):
        super().setUp()
        (self.root / "node_modules").symlink_to(
            PROJECT / "node_modules", target_is_directory=True
        )
        if (PROJECT / "apps/frontend/node_modules").is_dir():
            (self.frontend / "node_modules").symlink_to(
                PROJECT / "apps/frontend/node_modules", target_is_directory=True
            )
        self.git("config", "core.hooksPath", str(self.root / ".githooks"))
        self.install()

    def test_partial_staging_preserves_unfinished_edits_in_same_file(self):
        staged = self.baseline.replace("selected = 0;", "selected=1")
        self.file.write_text(staged)
        self.git("add", "--", str(self.file))
        self.file.write_text(staged.replace("unfinished = 0;", "unfinished=99"))
        self.git("commit", "-qm", "Format selected lines")
        self.assertEqual(
            self.show("HEAD", self.file),
            self.baseline.replace("selected = 0;", "selected = 1;"),
        )
        self.assertEqual(
            self.file.read_text(),
            self.baseline.replace("selected = 0;", "selected = 1;").replace(
                "unfinished = 0;", "unfinished=99"
            ),
        )
        self.assertEqual(self.git("diff", "--cached").stdout, "")
        self.assertEqual(self.git("stash", "list").stdout, "")

    def test_formatter_failure_restores_index_and_all_working_bytes(self):
        self.file.write_text(self.baseline.replace("selected = 0;", "selected=1"))
        self.other.write_text("export const broken = ;\n")
        self.git("add", "--", str(self.file), str(self.other))
        self.file.write_text(self.file.read_text() + "// unfinished note\n")
        before_tree = self.git("write-tree").stdout
        before_head = self.git("rev-parse", "HEAD").stdout
        before_files = {path: path.read_bytes() for path in (self.file, self.other)}
        result = self.git("commit", "-qm", "Must reject invalid syntax", check=False)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("SyntaxError", result.stdout + result.stderr)
        self.assertEqual(self.git("write-tree").stdout, before_tree)
        self.assertEqual(self.git("rev-parse", "HEAD").stdout, before_head)
        self.assertEqual(
            {path: path.read_bytes() for path in before_files}, before_files
        )
        self.assertEqual(self.git("stash", "list").stdout, "")

    def test_filename_with_spaces_is_formatted_and_committed(self):
        self.file.write_text("export const spaced={value:1}\n")
        self.git("add", "--", str(self.file))
        self.git("commit", "-qm", "Filename with spaces")
        self.assertEqual(
            self.show("HEAD", self.file), "export const spaced = { value: 1 };\n"
        )
        self.assertEqual(self.git("status", "--porcelain").stdout, "")

    def test_rename_is_formatted_without_adding_an_untracked_file(self):
        renamed = self.frontend / "renamed file.ts"
        self.git("mv", "--", str(self.file), str(renamed))
        renamed.write_text("export const renamed=1\n")
        self.git("add", "--", str(renamed))
        private = self.frontend / "unfinished.ts"
        private.write_text("unfinished syntax {\n")
        self.git("commit", "-qm", "Format renamed selection")
        self.assertEqual(self.show("HEAD", renamed), "export const renamed = 1;\n")
        self.assertEqual(private.read_text(), "unfinished syntax {\n")
        self.assertNotEqual(
            self.git(
                "ls-files", "--error-unmatch", str(private), check=False
            ).returncode,
            0,
        )

    def test_deletion_only_needs_no_formatter(self):
        self.git("rm", "--", str(self.file))
        (self.root / "node_modules").unlink()
        self.git("commit", "-qm", "Delete selected file")
        self.assertFalse(self.file.exists())

    def cached_ruff(self):
        if shutil.which("uvx") is None:
            self.skipTest(
                "Python hook integration needs an already installed uvx and cached Ruff."
            )
        self.env["UV_OFFLINE"] = "true"
        result = self.command("uvx", "ruff@0.15.0", "--version", check=False)
        if result.returncode:
            self.skipTest(
                "Pinned Ruff is not available offline; this fixture never installs packages."
            )

    def test_python_selection_is_formatted_before_commit(self):
        self.cached_ruff()
        selected = self.root / "scripts/selected file.py"
        selected.write_text('answer={"value":1}\n')
        self.git("add", "--", str(selected))
        self.git("commit", "-qm", "Format Python selection")
        self.assertEqual(self.show("HEAD", selected), 'answer = {"value": 1}\n')

    def test_python_lint_failure_preserves_index_and_work(self):
        self.cached_ruff()
        selected = self.root / "scripts/selected file.py"
        selected.write_text("import os\nanswer=1\n")
        self.git("add", "--", str(selected))
        before = self.git("write-tree").stdout
        result = self.git("commit", "-qm", "Reject unused Python import", check=False)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("F401", result.stdout + result.stderr)
        self.assertEqual(self.git("write-tree").stdout, before)
        self.assertEqual(selected.read_text(), "import os\nanswer=1\n")

    def test_commit_only_preserves_other_staged_file(self):
        self.other.write_text("export const other=2\n")
        self.git("add", "--", str(self.other))
        self.file.write_text("export const selected=3\n")
        self.git("commit", "--only", "-qm", "Alternate Git index", "--", str(self.file))
        self.assertEqual(self.show("HEAD", self.file), "export const selected = 3;\n")
        self.assertEqual(self.show("HEAD", self.other), "export const other = 0;\n")
        self.assertEqual(self.show("", self.other), "export const other=2\n")
        self.assertEqual(self.other.read_text(), "export const other=2\n")
        self.assertEqual(self.file.read_text(), "export const selected = 3;\n")
        self.assertEqual(self.git("stash", "list").stdout, "")


class HookInstallerChecks(GitFixture):
    def setUp(self):
        super().setUp()
        self.git("config", "--unset", "core.hooksPath")

    def installed_path(self):
        return Path(self.git("config", "--get", "core.hooksPath").stdout.strip())

    def test_migration_preserves_original_post_checkout_bytes(self):
        original = self.root / ".githooks/post-checkout"
        before = original.read_bytes()
        self.git("config", "core.hooksPath", str(self.root / ".githooks"))
        self.install()
        self.assertEqual(original.read_bytes(), before)
        self.assertEqual((self.installed_path() / "post-checkout").read_bytes(), before)
        self.assertNotEqual(self.installed_path(), original.parent)

    def test_versioned_activation_and_reinstall_preserve_previous_version(self):
        self.install()
        first = self.installed_path()
        before = {path.name: path.read_bytes() for path in first.iterdir()}
        self.install()
        self.assertEqual(self.installed_path(), first)
        source = self.root / ".githooks/pre-commit"
        source.write_bytes(source.read_bytes() + b"\n# fixture version 2\n")
        self.install()
        second = self.installed_path()
        self.assertNotEqual(first, second)
        self.assertEqual(
            {path.name: path.read_bytes() for path in first.iterdir()}, before
        )
        for name in ("post-checkout", "pre-commit", "pre-push"):
            self.assertEqual(
                (second / name).read_bytes(),
                (self.root / ".githooks" / name).read_bytes(),
            )
            self.assertTrue(os.access(second / name, os.X_OK))
        self.assertEqual(
            second.parent.resolve(), (self.root / ".git/alethical-hooks").resolve()
        )

    def test_unknown_custom_hooks_are_refused_without_changes(self):
        custom = self.root / "custom-hooks"
        custom.mkdir()
        hook = custom / "pre-commit"
        hook.write_text("#!/bin/sh\nexit 0\n")
        self.git("config", "core.hooksPath", str(custom))
        result = self.install(check=False)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("Custom Git hooks", result.stderr)
        self.assertEqual(self.installed_path(), custom)
        self.assertEqual(hook.read_text(), "#!/bin/sh\nexit 0\n")
        self.assertFalse((self.root / ".git/alethical-hooks").exists())

    def test_custom_default_hook_is_preserved_and_refused(self):
        hook = self.root / ".git/hooks/pre-commit"
        hook.write_text("#!/bin/sh\nexit 0\n")
        result = self.install(check=False)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("Custom default Git hooks", result.stderr)
        self.assertEqual(hook.read_text(), "#!/bin/sh\nexit 0\n")
        self.assertNotEqual(
            self.git("config", "--get", "core.hooksPath", check=False).returncode, 0
        )
        self.assertFalse((self.root / ".git/alethical-hooks").exists())


if __name__ == "__main__":
    unittest.main()
