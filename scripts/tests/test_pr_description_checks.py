"""Network-free checks for fresh pull-request descriptions and queue identity."""

import sys
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import check_doc_sync
import check_pr_descriptions as subject


class DescriptionChecks(unittest.TestCase):
    def test_missing_acknowledgment_fails_even_for_a_bot(self):
        pr = {**self.pr(), "body": "", "user": {"type": "Bot"}}
        with (
            patch.object(
                subject, "request", side_effect=[pr, [{"filename": "source.py"}], pr]
            ),
            patch.object(subject, "couplings", return_value={"guide": ["source.py"]}),
        ):
            with self.assertRaisesRegex(
                subject.CheckFailure, "Edit the PR description"
            ):
                subject.check_pull_request("owner/repo", 1, "a" * 40, "b" * 40)

    def test_renaming_a_declared_file_still_requires_an_explanation(self):
        pr = {**self.pr(), "body": ""}
        files = [{"filename": "renamed.py", "previous_filename": "source.py"}]
        with (
            patch.object(subject, "request", side_effect=[pr, files, pr]),
            patch.object(subject, "couplings", return_value={"guide": ["source.py"]}),
        ):
            with self.assertRaises(subject.CheckFailure):
                subject.check_pull_request("owner/repo", 1, "a" * 40, "b" * 40)

    def test_unrelated_changes_do_not_need_acknowledgment(self):
        pr = {**self.pr(), "body": ""}
        with (
            patch.object(
                subject, "request", side_effect=[pr, [{"filename": "other.py"}], pr]
            ),
            patch.object(subject, "couplings", return_value={"guide": ["source.py"]}),
        ):
            subject.check_pull_request("owner/repo", 1, "a" * 40, "b" * 40)

    def test_partial_file_list_fails(self):
        with patch.object(subject, "request", side_effect=[self.pr(), []]):
            with self.assertRaisesRegex(subject.CheckFailure, "incomplete"):
                subject.check_pull_request("owner/repo", 1, "a" * 40, "b" * 40)

    def test_api_file_limit_fails(self):
        with patch.object(
            subject, "request", return_value={**self.pr(), "changed_files": 3001}
        ):
            with self.assertRaisesRegex(subject.CheckFailure, "complete changed-file"):
                subject.check_pull_request("owner/repo", 1, "a" * 40, "b" * 40)

    def test_base_change_fails(self):
        with patch.object(subject, "request", return_value=self.pr()):
            with self.assertRaisesRegex(subject.CheckFailure, "changed"):
                subject.check_pull_request("owner/repo", 1, "a" * 40, "c" * 40)

    def test_api_failure_does_not_echo_private_response(self):
        with (
            patch.dict(subject.os.environ, {"GH_TOKEN": "fake-test-token"}),
            patch.object(
                subject.urllib.request.OpenerDirector,
                "open",
                side_effect=subject.urllib.error.URLError("private text"),
            ),
        ):
            with self.assertRaises(subject.CheckFailure) as caught:
                subject.request("repos/owner/repo/pulls/1")
            self.assertNotIn("private text", str(caught.exception))

    def test_removed_declaration_is_read_from_base_as_data(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)

            def git(*args):
                import subprocess

                return subprocess.run(
                    ["git", *args], cwd=root, check=True, capture_output=True, text=True
                ).stdout

            git("init", "-q")
            git("config", "user.name", "Fixture")
            git("config", "user.email", "fixture@example.invalid")
            folder = root / "docs"
            folder.mkdir()
            guide = folder / "fixture.md"
            guide.write_text("<!-- describes: source.py -->\n")
            git("add", ".")
            git("commit", "-qm", "fixture")
            base = git("rev-parse", "HEAD").strip()
            guide.write_text("No declaration.\n")
            git("add", ".")
            git("commit", "-qm", "remove declaration")
            with patch.object(subject, "ROOT", root):
                self.assertIn(["source.py"], subject.couplings(base).values())

    def test_workflow_cannot_write_checks_or_run_application_suites(self):
        workflow = (
            Path(__file__).resolve().parents[2] / ".github/workflows/pr-description.yml"
        )
        text = workflow.read_text()
        self.assertIn(
            "types: [opened, synchronize, reopened, edited, ready_for_review]", text
        )
        self.assertIn("merge_group:", text)
        self.assertIn("persist-credentials: false", text)
        for forbidden in (
            "pull_request_target:",
            "write",
            "secrets.",
            "uv run pytest",
            "test-frontend",
            "uses: ./.github/workflows/ci.yml",
        ):
            # Comments can explain why a write token is forbidden.
            lines = "\n".join(
                line for line in text.splitlines() if not line.lstrip().startswith("#")
            )
            self.assertNotIn(forbidden, lines)

    def test_redirect_cannot_forward_api_token(self):
        with self.assertRaises(subject.urllib.error.URLError):
            subject.NoRedirect().redirect_request(
                None, None, 302, "", {}, "https://example.invalid/"
            )

    def test_queue_main_checks_each_member_and_rechecks_all_descriptions(self):
        event = {"merge_group": {"base_ref": "refs/heads/main", "head_sha": "f" * 40}}
        with tempfile.TemporaryDirectory() as directory:
            event_path = Path(directory) / "event.json"
            event_path.write_text(json.dumps(event))
            members = [(1, "a" * 40), (2, "a" * 40)]
            with (
                patch.dict(
                    subject.os.environ,
                    {
                        "GITHUB_REPOSITORY": "owner/repo",
                        "GITHUB_EVENT_PATH": str(event_path),
                        "GITHUB_EVENT_NAME": "merge_group",
                    },
                ),
                patch.object(subject, "queue_members", return_value=members) as queue,
                patch.object(
                    subject, "check_pull_request", return_value=self.pr()
                ) as check,
                patch.object(subject, "request", return_value=self.pr()) as read,
            ):
                self.assertEqual(subject.main(), 0)
                self.assertEqual(check.call_count, 2)
                self.assertEqual(queue.call_count, 2)
                self.assertEqual(read.call_count, 2)

    def test_queue_change_cannot_report_success(self):
        event = {"merge_group": {"base_ref": "refs/heads/main", "head_sha": "f" * 40}}
        with tempfile.TemporaryDirectory() as directory:
            event_path = Path(directory) / "event.json"
            event_path.write_text(json.dumps(event))
            with (
                patch.dict(
                    subject.os.environ,
                    {
                        "GITHUB_REPOSITORY": "owner/repo",
                        "GITHUB_EVENT_PATH": str(event_path),
                        "GITHUB_EVENT_NAME": "merge_group",
                    },
                ),
                patch.object(
                    subject, "queue_members", side_effect=[[(1, "a" * 40)], []]
                ),
                patch.object(subject, "check_pull_request", return_value=self.pr()),
            ):
                self.assertEqual(subject.main(), 1)

    def test_empty_or_example_acknowledgments_do_not_pass(self):
        for body in (
            "Docs check:",
            "Docs check:  \nNext section",
            "````\nDocs check: ok\n````",
            "<!-- Docs check: ok -->",
        ):
            with self.subTest(body=body):
                self.assertFalse(check_doc_sync.acknowledged(body))

    def test_real_acknowledgments_pass(self):
        for body in (
            "Docs check: none needed",
            "- Docs check: updated guide",
            "**Docs check:** read the whole guide",
        ):
            self.assertTrue(check_doc_sync.acknowledged(body))

    def test_description_edit_uses_fresh_body(self):
        pr = self.pr()
        with (
            patch.object(
                subject, "request", side_effect=[pr, [{"filename": "source.py"}], pr]
            ),
            patch.object(subject, "couplings", return_value={"guide": ["source.py"]}),
        ):
            subject.check_pull_request("owner/repo", 1, "a" * 40, "b" * 40)

    def test_head_change_does_not_pass_for_old_code(self):
        pr = self.pr()
        pr["head"]["sha"] = "c" * 40
        with patch.object(subject, "request", return_value=pr):
            with self.assertRaisesRegex(subject.CheckFailure, "changed"):
                subject.check_pull_request("owner/repo", 1, "a" * 40, "b" * 40)

    def test_body_change_during_check_fails_closed(self):
        pr = self.pr()
        later = {**pr, "body": ""}
        with (
            patch.object(
                subject, "request", side_effect=[pr, [{"filename": "source.py"}], later]
            ),
            patch.object(subject, "couplings", return_value={"guide": ["source.py"]}),
        ):
            with self.assertRaisesRegex(subject.CheckFailure, "changed"):
                subject.check_pull_request("owner/repo", 1, "a" * 40, "b" * 40)

    def test_queue_checks_every_predecessor_and_ignores_later_entries(self):
        entries = [self.entry(1, "a"), self.entry(2, "b"), self.entry(3, "c")]
        with patch.object(
            subject,
            "request",
            return_value={
                "data": {
                    "repository": {
                        "mergeQueue": {
                            "entries": {
                                "nodes": entries,
                                "pageInfo": {"hasNextPage": False},
                            }
                        }
                    }
                }
            },
        ):
            self.assertEqual(
                [p[0] for p in subject.queue_members("owner/repo", "main", "b" * 40)],
                [1, 2],
            )

    def test_unidentified_or_truncated_queue_fails_closed(self):
        for nodes, more in (([], False), ([self.entry(1, "a")], True)):
            with patch.object(
                subject,
                "request",
                return_value={
                    "data": {
                        "repository": {
                            "mergeQueue": {
                                "entries": {
                                    "nodes": nodes,
                                    "pageInfo": {"hasNextPage": more},
                                }
                            }
                        }
                    }
                },
            ):
                with self.assertRaises(subject.CheckFailure):
                    subject.queue_members("owner/repo", "main", "a" * 40)

    @staticmethod
    def pr():
        return {
            "state": "open",
            "body": "Docs check: read guide; none needed",
            "head": {"sha": "a" * 40},
            "base": {"sha": "b" * 40},
            "changed_files": 1,
        }

    @staticmethod
    def entry(number, letter):
        return {
            "position": number,
            "headCommit": {"oid": letter * 40},
            "pullRequest": {"number": number, "headRefOid": str(number) * 40},
        }


if __name__ == "__main__":
    unittest.main()
