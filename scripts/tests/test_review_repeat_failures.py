"""Bounded history, honest counts, and retained prevention evidence."""

import copy
import importlib.util
import json
import subprocess
import tempfile
import unittest
from pathlib import Path
from unittest.mock import Mock, patch

SCRIPT = Path(__file__).resolve().parents[1] / "review_repeat_failures.py"
SPEC = importlib.util.spec_from_file_location("review_repeat_failures", SCRIPT)
CHECKS = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(CHECKS)
REPO = "alethical-org/alethical"
SINCE, UNTIL = "2026-07-01", "2026-07-31"


def pull(number=1, merged="2026-07-01T00:00:00Z", updated="2026-08-01T00:00:00Z"):
    return {
        "number": number,
        "title": f"Change {number}",
        "body": "Description",
        "html_url": f"https://github.com/{REPO}/pull/{number}",
        "merged_at": merged,
        "updated_at": updated,
        "labels": [{"name": "backend"}],
        "merge_commit_sha": "a" * 40,
    }


def occurrence(number, role="failure"):
    return {
        "pr": number,
        "role": role,
        "evidence": f"Source: https://github.com/{REPO}/pull/{number}",
    }


def review():
    return {
        "schema_version": 1,
        "repository": REPO,
        "cases": [
            {
                "id": "stale-record",
                "summary": "Stale records",
                "cause": "Source dates drifted",
                "occurrences": [
                    occurrence(1),
                    occurrence(2),
                    occurrence(3, "prevention"),
                    occurrence(4, "design"),
                    occurrence(99),
                ],
                "prevention": {
                    "status": "covered",
                    "description": "Date comparison rejects old copies",
                    "checks": [
                        {
                            "path": "tests/test_dates.py",
                            "anchor": "def test_old_copy():",
                        }
                    ],
                },
            }
        ],
    }


class CollectionTests(unittest.TestCase):
    def test_inclusive_dates_are_utc_and_keep_metadata(self):
        page = [
            pull(1),
            pull(2, "2026-07-31T23:59:59Z"),
            pull(3, "2026-08-01T00:00:00Z"),
            pull(4, "2026-06-30T23:59:59Z"),
            pull(5, None),
        ]
        result = CHECKS.collect(REPO, SINCE, UNTIL, lambda *_: page)
        self.assertEqual([item["number"] for item in result["prs"]], [1, 2])
        self.assertTrue(result["complete"])
        self.assertEqual(
            result["window"], {"since": SINCE, "until": UNTIL, "timezone": "UTC"}
        )
        self.assertEqual(result["prs"][0]["labels"], ["backend"])
        self.assertEqual(result["prs"][0]["body"], "Description")
        self.assertEqual(result["prs"][0]["merge_commit_sha"], "a" * 40)

    def test_old_merges_edited_recently_do_not_end_pagination(self):
        first = [pull(i, "2026-06-01T00:00:00Z") for i in range(1, 101)]
        fetch = Mock(side_effect=[first, [pull(101)], first])
        result = CHECKS.collect(REPO, SINCE, UNTIL, fetch)
        self.assertEqual([item["number"] for item in result["prs"]], [101])
        self.assertEqual(fetch.call_count, 3)

    def test_stops_only_when_whole_page_updated_before_start(self):
        first = [
            pull(i, "2026-06-01T00:00:00Z", "2026-06-30T23:59:59Z")
            for i in range(1, 101)
        ]
        fetch = Mock(return_value=first)
        self.assertEqual(CHECKS.collect(REPO, SINCE, UNTIL, fetch)["prs"], [])
        self.assertEqual(fetch.call_count, 2)
        self.assertTrue(all(call.args == (REPO, 1) for call in fetch.call_args_list))

    def test_one_recent_update_keeps_scan_open(self):
        first = [
            pull(i, "2026-06-01T00:00:00Z", "2026-06-30T23:59:59Z")
            for i in range(1, 101)
        ]
        first[0]["updated_at"] = "2026-07-01T00:00:00Z"
        fetch = Mock(side_effect=[first, [], first])
        CHECKS.collect(REPO, SINCE, UNTIL, fetch)
        self.assertEqual(fetch.call_count, 3)

    def test_pagination_goes_beyond_search_limit(self):
        pages = [
            [pull(i) for i in range(start, start + 100)]
            for start in range(1, 1101, 100)
        ]
        fetch = Mock(side_effect=[*pages, [], pages[0]])
        result = CHECKS.collect(REPO, SINCE, UNTIL, fetch)
        self.assertEqual(len(result["prs"]), 1100)
        self.assertEqual(fetch.call_count, 13)

    def test_duplicates_are_counted_once_and_conflicts_fail(self):
        first = [pull(i) for i in range(1, 101)]
        fetch = Mock(side_effect=[first, [pull(100), pull(101)], first])
        self.assertEqual(len(CHECKS.collect(REPO, SINCE, UNTIL, fetch)["prs"]), 101)
        changed = pull(100)
        changed["title"] = "Edited during collection"
        with self.assertRaisesRegex(CHECKS.ReviewError, "changed during pagination"):
            CHECKS.collect(REPO, SINCE, UNTIL, Mock(side_effect=[first, [changed]]))

    def test_limit_fails_explicitly(self):
        with self.assertRaisesRegex(CHECKS.ReviewError, "incomplete"):
            CHECKS.collect(
                REPO,
                SINCE,
                UNTIL,
                lambda *_: [pull(i) for i in range(1, 101)],
                max_pages=1,
            )

    def test_first_page_reread_rejects_identity_order_and_update_changes(self):
        first = [pull(i) for i in range(1, 101)]
        variants = [
            first[1:] + [pull(101)],
            list(reversed(first)),
            copy.deepcopy(first),
        ]
        variants[-1][0]["updated_at"] = "2026-08-02T00:00:00Z"
        for changed in variants:
            with self.subTest(changed=changed[0]["number"]):
                fetch = Mock(side_effect=[first, [], changed])
                with self.assertRaisesRegex(CHECKS.ReviewError, "pages moved"):
                    CHECKS.collect(REPO, SINCE, UNTIL, fetch)
        result = CHECKS.collect(REPO, SINCE, UNTIL, lambda *_: [pull()])
        self.assertEqual(
            result["collection"],
            {
                "first_page_stable": True,
                "transactional_snapshot": False,
            },
        )

    def test_first_page_change_and_reread_error_preserve_existing_output(self):
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory) / "history.json"
            output.write_text("previous complete output")
            for last in [
                Mock(returncode=0, stdout=json.dumps([pull(2)])),
                Mock(returncode=1, stdout="private data"),
            ]:
                results = [Mock(returncode=0, stdout=json.dumps([pull(1)])), last]
                with patch.object(CHECKS.subprocess, "run", side_effect=results):
                    self.assertEqual(
                        CHECKS.main(
                            [
                                "collect",
                                "--repo",
                                REPO,
                                "--since",
                                SINCE,
                                "--until",
                                UNTIL,
                                "--output",
                                str(output),
                            ]
                        ),
                        1,
                    )
                self.assertEqual(output.read_text(), "previous complete output")

    def test_invalid_inputs_never_make_api_calls(self):
        fetch = Mock()
        for repo, since, until in [
            ("a/b/c", SINCE, UNTIL),
            ("../b", SINCE, UNTIL),
            (REPO, "2026-02-30", UNTIL),
            (REPO, "2026-7-01", UNTIL),
            (REPO, UNTIL, SINCE),
            (REPO, SINCE, "9999-12-31"),
        ]:
            with self.subTest(repo=repo, since=since, until=until):
                with self.assertRaises(CHECKS.ReviewError):
                    CHECKS.collect(repo, since, until, fetch)
        fetch.assert_not_called()

    def test_mismatched_repository_rejected(self):
        item = pull()
        item["html_url"] = "https://github.com/somebody/else/pull/1"
        with self.assertRaisesRegex(CHECKS.ReviewError, "different repository"):
            CHECKS.collect(REPO, SINCE, UNTIL, lambda *_: [item])

    def test_invalid_page_timestamp_and_merge_record_fail(self):
        for payload in [{"message": "API error"}, [None], [pull() for _ in range(101)]]:
            with (
                self.subTest(payload_type=type(payload)),
                self.assertRaises(CHECKS.ReviewError),
            ):
                CHECKS.collect(REPO, SINCE, UNTIL, lambda *_: payload)
        for field, value in [
            ("updated_at", "2026-07-01"),
            ("merged_at", "bad timestamp"),
            ("html_url", None),
            ("number", True),
            ("title", ""),
            ("labels", {}),
            ("merge_commit_sha", None),
        ]:
            item = pull()
            item[field] = value
            with self.subTest(field=field), self.assertRaises(CHECKS.ReviewError):
                CHECKS.collect(REPO, SINCE, UNTIL, lambda *_: [item])

    def test_api_get_parameters_and_private_errors(self):
        with patch.object(
            CHECKS.subprocess, "run", return_value=Mock(returncode=0, stdout="[]")
        ) as run:
            self.assertEqual(CHECKS.api_page(REPO, 2), [])
            command = run.call_args.args[0]
            self.assertIn("GET", command)
            self.assertIn("sort=updated", command)
            self.assertIn("page=2", command)
            self.assertNotIn("search", " ".join(command))
        with patch.object(
            CHECKS.subprocess,
            "run",
            return_value=Mock(
                returncode=1, stdout="private output", stderr="private token"
            ),
        ):
            with self.assertRaises(CHECKS.ReviewError) as error:
                CHECKS.api_page(REPO, 1)
            self.assertNotIn("private", str(error.exception))

    def test_late_failure_keeps_existing_output(self):
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory) / "history.json"
            output.write_text("previous complete output")
            results = [
                Mock(returncode=0, stdout=json.dumps([pull(i) for i in range(1, 101)])),
                Mock(
                    returncode=1,
                    stdout="partial private output",
                    stderr="private token",
                ),
            ]
            with patch.object(CHECKS.subprocess, "run", side_effect=results):
                self.assertEqual(
                    CHECKS.main(
                        [
                            "collect",
                            "--repo",
                            REPO,
                            "--since",
                            SINCE,
                            "--until",
                            UNTIL,
                            "--output",
                            str(output),
                        ]
                    ),
                    1,
                )
            self.assertEqual(output.read_text(), "previous complete output")
            with patch.object(
                CHECKS.os, "replace", side_effect=OSError("disk unavailable")
            ):
                with self.assertRaises(OSError):
                    CHECKS.atomic_write(output, "new result")
            self.assertEqual(output.read_text(), "previous complete output")
            self.assertEqual(list(Path(directory).iterdir()), [output])


class ReviewTests(unittest.TestCase):
    def setUp(self):
        self.history = CHECKS.collect(
            REPO, SINCE, UNTIL, lambda *_: [pull(i) for i in range(1, 6)]
        )
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name)
        (self.root / "tests").mkdir()
        (self.root / "tests/test_dates.py").write_text(
            "def test_old_copy():\n    pass\n"
        )

    def test_report_counts_roles_and_window_separately(self):
        result = CHECKS.report(self.history, review())
        self.assertTrue(result.startswith("Net: 4 of 5"))
        self.assertIn("1 remain unreviewed", result)
        self.assertIn("Reviewed failure-related changes in this window: 2", result)
        self.assertNotIn("repeats after", result)
        self.assertIn(
            "outside this collected window inventory; merge date unestablished", result
        )
        self.assertIn("PR 5", result)
        self.assertIn("do not prove behavior works", result)

    def test_no_review_is_useful_without_guessed_ratio(self):
        self.history["prs"][0]["title"] = "Fix recurring bug again"
        result = CHECKS.report(self.history)
        self.assertTrue(result.startswith("Net: 0 of 5"))
        self.assertIn("No repeat-bug or fix ratio is inferred", result)
        self.assertIn("Fix recurring bug again", result)

    def test_untrusted_markdown_and_html_are_plain_text(self):
        self.history["prs"][-1]["title"] = (
            "# Fake heading\n[click](https://evil.invalid) <script>x</script> **bold**"
        )
        changed = review()
        changed["cases"][0]["summary"] = "[fake](https://evil.invalid) **bold**"
        changed["cases"][0]["cause"] = "<script>alert(1)</script>"
        changed["cases"][0]["occurrences"][0]["evidence"] = (
            f"**proof** https://github.com/{REPO}/issues/1#note"
        )
        result = CHECKS.report(self.history, changed)
        self.assertIn(r"\# Fake heading", result)
        self.assertIn(r"\[click\]\(https://evil\.invalid\)", result)
        self.assertIn(r"\*\*bold\*\*", result)
        self.assertNotIn("<script>", result)
        self.assertIn("&lt;script&gt;", result)
        self.assertIn(f"[Source](https://github.com/{REPO}/issues/1#note)", result)
        self.assertIn("not a snapshot at a single instant", result)

    def test_forged_history_and_review_repositories_fail(self):
        changed = review()
        changed["repository"] = "another/repo"
        with self.assertRaisesRegex(CHECKS.ReviewError, "repository mismatch"):
            CHECKS.report(self.history, changed)
        for field, value in [
            ("complete", False),
            ("schema_version", True),
            ("prs", {}),
        ]:
            history = copy.deepcopy(self.history)
            history[field] = value
            with self.assertRaises(CHECKS.ReviewError):
                CHECKS.report(history)
        history = copy.deepcopy(self.history)
        history["prs"][0]["merged_at"] = "2026-08-01T00:00:00Z"
        with self.assertRaisesRegex(CHECKS.ReviewError, "outside history"):
            CHECKS.report(history)

    def test_duplicate_and_ambiguous_occurrences_fail(self):
        for extra in [occurrence(1), occurrence(1, "prevention")]:
            changed = review()
            changed["cases"][0]["occurrences"].append(extra)
            with self.assertRaisesRegex(CHECKS.ReviewError, "duplicate or conflicting"):
                CHECKS.validate_review(changed)
        changed = review()
        other = copy.deepcopy(changed["cases"][0])
        other["id"] = "other"
        changed["cases"].append(other)
        with self.assertRaisesRegex(CHECKS.ReviewError, "multiple cases"):
            CHECKS.validate_review(changed)
        other["occurrences"] = [occurrence(3, "prevention")]
        CHECKS.validate_review(changed)

    def test_evidence_requires_actual_same_repository_source(self):
        for evidence in [
            "I think it failed",
            "https://github.com/another/repo/pull/1",
            f"https://github.com/{REPO}-fork/pull/1",
            f"https://github.com/{REPO}/pull/not-a-number",
            f"https://github.com/{REPO}/../else/pull/1",
            "https://example.com/evidence",
        ]:
            changed = review()
            changed["cases"][0]["occurrences"][0]["evidence"] = evidence
            with self.subTest(evidence=evidence), self.assertRaises(CHECKS.ReviewError):
                CHECKS.validate_review(changed)
        for suffix in [
            "issues/24",
            "pull/24#discussion_r123",
            "commit/abcdef123",
            "blob/main/scripts/test_dates.py#L10",
        ]:
            changed = review()
            changed["cases"][0]["occurrences"][0]["evidence"] = (
                f"Source https://github.com/{REPO}/{suffix}"
            )
            CHECKS.validate_review(changed)

    def test_source_link_in_description_cannot_point_to_other_repository(self):
        changed = review()
        changed["cases"][0]["cause"] = "See https://github.com/another/repo/issues/1"
        with self.assertRaises(CHECKS.ReviewError):
            CHECKS.validate_review(changed)

    def test_retained_check_and_removed_anchor(self):
        CHECKS.check_review(review(), self.root)
        (self.root / "tests/test_dates.py").write_text("def unrelated():\n    pass\n")
        with self.assertRaisesRegex(CHECKS.ReviewError, "anchor is missing"):
            CHECKS.check_review(review(), self.root)

    def test_missing_path_blank_anchor_and_path_escape_fail(self):
        for path, anchor in [
            ("missing.py", "test"),
            ("tests/test_dates.py", " "),
            ("../outside.py", "test"),
            ("/etc/passwd", "root"),
        ]:
            changed = review()
            changed["cases"][0]["prevention"]["checks"] = [
                {"path": path, "anchor": anchor}
            ]
            with (
                self.subTest(path=path, anchor=anchor),
                self.assertRaises(CHECKS.ReviewError),
            ):
                CHECKS.check_review(changed, self.root)
        with tempfile.TemporaryDirectory() as outside:
            destination = Path(outside) / "outside.py"
            destination.write_text("def test_old_copy():")
            (self.root / "tests/test_dates.py").unlink()
            (self.root / "tests/test_dates.py").symlink_to(destination)
            with self.assertRaisesRegex(CHECKS.ReviewError, "escaped"):
                CHECKS.check_review(review(), self.root)

    def test_covered_claim_requires_retained_checks(self):
        changed = review()
        changed["cases"][0]["prevention"]["checks"] = []
        with self.assertRaisesRegex(CHECKS.ReviewError, "Covered prevention"):
            CHECKS.validate_review(changed)
        changed["cases"][0]["prevention"]["status"] = "open"
        CHECKS.validate_review(changed)

    def test_cli_report_and_check(self):
        history_path, review_path = (
            self.root / "history.json",
            self.root / "review.json",
        )
        history_path.write_text(json.dumps(self.history))
        review_path.write_text(json.dumps(review()))
        output = self.root / "report.md"
        result = subprocess.run(
            [
                "python3",
                str(SCRIPT),
                "report",
                "--history",
                str(history_path),
                "--review",
                str(review_path),
                "--output",
                str(output),
            ],
            capture_output=True,
            text=True,
        )
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertTrue(output.read_text().startswith("Net:"))
        self.assertEqual(
            CHECKS.main(
                ["check", "--review", str(review_path), "--root", str(self.root)]
            ),
            0,
        )

    def test_bad_report_input_does_not_replace_previous_report(self):
        history_path = self.root / "history.json"
        output = self.root / "report.md"
        output.write_text("previous report")
        for invalid in ["not JSON", "[]", json.dumps({"schema_version": 2})]:
            history_path.write_text(invalid)
            with self.subTest(invalid=invalid):
                self.assertEqual(
                    CHECKS.main(
                        [
                            "report",
                            "--history",
                            str(history_path),
                            "--output",
                            str(output),
                        ]
                    ),
                    1,
                )
                self.assertEqual(output.read_text(), "previous report")


if __name__ == "__main__":
    unittest.main()
