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

    def at(self, path, *args, check=True, env=None):
        result = subprocess.run(
            list(args),
            cwd=path,
            env=self.env if env is None else env,
            text=True,
            capture_output=True,
            check=False,
        )
        if check:
            self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        return result

    def test_old_sibling_keeps_shared_hooks_dirty_work_and_commit_ability(self):
        legacy = self.root / ".githooks"
        before = (legacy / "post-checkout").read_bytes()
        # Model the deployed clone, whose common profile has only protection.
        (legacy / "pre-commit").unlink()
        (legacy / "pre-push").unlink()
        self.git("config", "core.hooksPath", str(legacy))
        old = self.root / "old-sibling"
        current = self.root / "current-sibling"
        self.git("worktree", "add", "-q", "-b", "fixture-old", str(old), "HEAD")
        self.git("worktree", "add", "-q", "-b", "fixture-current", str(current), "HEAD")
        self.at(old, "git", "rm", "scripts/local_checks.py")
        self.at(old, "git", "commit", "-qm", "Model old branch without helper")
        dirty = old / "apps/frontend/other.ts"
        dirty.write_text("unfinished old branch bytes {\n")
        before_config = self.at(old, "git", "config", "--get", "core.hooksPath").stdout
        self.at(current, sys.executable, "scripts/install_git_hooks.py")
        self.assertEqual(
            self.at(old, "git", "config", "--get", "core.hooksPath").stdout,
            before_config,
        )
        self.assertEqual(
            self.git("config", "--local", "--get", "core.hooksPath").stdout.strip(),
            str(legacy),
        )
        self.assertEqual((legacy / "post-checkout").read_bytes(), before)
        self.assertFalse((legacy / "pre-commit").exists())
        self.assertEqual(dirty.read_text(), "unfinished old branch bytes {\n")
        self.at(
            old, "git", "commit", "--allow-empty", "-qm", "Old branch still commits"
        )
        self.assertEqual(dirty.read_text(), "unfinished old branch bytes {\n")
        self.assertFalse((old / "scripts/local_checks.py").exists())
        full = Path(
            self.at(
                current, "git", "config", "--worktree", "--get", "core.hooksPath"
            ).stdout.strip()
        )
        self.assertEqual(
            {path.name for path in full.iterdir()},
            {"post-checkout", "pre-commit", "pre-push"},
        )
        self.assertNotEqual(full, legacy)

    def test_new_worktree_inherits_activated_parents_profile(self):
        self.install()
        full = self.installed_path()
        fallback = Path(
            self.git("config", "--local", "--get", "core.hooksPath").stdout.strip()
        )
        self.assertEqual({path.name for path in fallback.iterdir()}, {"post-checkout"})
        self.assertNotEqual(full, fallback)
        self.assertEqual(
            self.git(
                "config", "--local", "--get", "extensions.worktreeConfig"
            ).stdout.strip(),
            "true",
        )
        self.assertEqual(
            self.git("config", "--worktree", "--get", "core.hooksPath").stdout.strip(),
            str(full),
        )
        future = self.root / "future-sibling"
        self.git("worktree", "add", "-q", "-b", "fixture-future", str(future), "HEAD")
        self.assertEqual(
            self.at(future, "git", "config", "--get", "core.hooksPath").stdout.strip(),
            str(full),
        )
        blocks = self.git("worktree", "list", "--porcelain").stdout.split("\n\n")
        block = next(
            block
            for block in blocks
            if block.startswith(f"worktree {future.resolve()}\n")
        )
        self.assertIn("\nlocked", block)
        selected = future / "apps/frontend/other.ts"
        selected.write_text("unfinished but intentionally saved {\n")
        self.at(future, "git", "add", "apps/frontend/other.ts")
        result = self.at(
            future,
            "git",
            "commit",
            "-qm",
            "Inherited checks require dependencies",
            check=False,
        )
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("pnpm install --frozen-lockfile", result.stdout + result.stderr)
        self.assertEqual(selected.read_text(), "unfinished but intentionally saved {\n")
        self.assertEqual(
            (full / "post-checkout").read_bytes(),
            (self.root / ".githooks/post-checkout").read_bytes(),
        )

    def test_new_worktree_from_unactivated_parent_uses_lock_only_fallback(self):
        old = self.root / "unactivated-sibling"
        future = self.root / "future-from-unactivated"
        self.git("worktree", "add", "-q", "-b", "fixture-unactivated", str(old), "HEAD")
        self.install()
        fallback = self.git(
            "config", "--local", "--get", "core.hooksPath"
        ).stdout.strip()
        self.at(
            old,
            "git",
            "worktree",
            "add",
            "-q",
            "-b",
            "fixture-lock-only",
            str(future),
            "HEAD",
        )
        self.assertEqual(
            self.at(future, "git", "config", "--get", "core.hooksPath").stdout.strip(),
            fallback,
        )
        self.assertEqual(
            {path.name for path in Path(fallback).iterdir()}, {"post-checkout"}
        )
        blocks = self.git("worktree", "list", "--porcelain").stdout.split("\n\n")
        block = next(
            block
            for block in blocks
            if block.startswith(f"worktree {future.resolve()}\n")
        )
        self.assertIn("\nlocked", block)
        selected = future / "apps/frontend/other.ts"
        selected.write_text("unfinished but intentionally saved {\n")
        self.at(future, "git", "add", "apps/frontend/other.ts")
        self.at(
            future, "git", "commit", "-qm", "Unactivated parent keeps lock-only hooks"
        )
        self.assertEqual(selected.read_text(), "unfinished but intentionally saved {\n")

    def test_ci_without_git_metadata_skips_before_any_git_command(self):
        outside = self.root / "deployment-without-git"
        outside.mkdir()
        result = self.at(
            outside,
            sys.executable,
            str(self.root / "scripts/install_git_hooks.py"),
            env={**self.env, "CI": "true", "PATH": str(outside)},
        )
        self.assertIn("installation skipped", result.stdout)
        self.assertEqual(result.stderr, "")

    def test_common_worktree_setting_is_refused_without_activation(self):
        self.git("config", "--local", "core.worktree", str(self.root))
        result = self.install(check=False)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("explicit Git configuration migration", result.stderr)
        self.assertFalse((self.root / ".git/alethical-hooks").exists())
        self.assertNotEqual(
            self.git(
                "config", "--local", "--get", "extensions.worktreeConfig", check=False
            ).returncode,
            0,
        )

    def test_common_bare_setting_is_refused_without_activation(self):
        self.git("config", "--local", "core.bare", "true")
        # Call install directly: a bare repository has no CLI toplevel by design.
        result = self.command(
            sys.executable,
            "-c",
            "import sys; from pathlib import Path; sys.path.insert(0, 'scripts'); "
            "from install_git_hooks import install; install(Path.cwd())",
            check=False,
        )
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("explicit Git configuration migration", result.stderr)
        self.assertFalse((self.root / ".git/alethical-hooks").exists())

    def test_inactive_worktree_config_is_not_silently_enabled(self):
        inactive = self.root / ".git/config.worktree"
        inactive.write_text("[core]\n\thooksPath = /private/unknown-hooks\n")
        result = self.install(check=False)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("Inactive worktree configuration", result.stderr)
        self.assertEqual(
            inactive.read_text(), "[core]\n\thooksPath = /private/unknown-hooks\n"
        )
        self.assertFalse((self.root / ".git/alethical-hooks").exists())

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
