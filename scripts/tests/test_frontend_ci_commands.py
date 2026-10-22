"""Every frontend CI command still runs, exactly once, after the job split.

The frontend checks run in 2 side-by-side jobs (`frontend-checks` and
`frontend-browser`) behind the required `frontend` gate. Splitting a job is where a
command quietly goes missing, so this test lists every command, browser spec and
money-failure assertion the frontend job ran before the split and requires each to
appear the stated number of times across the `frontend-*` jobs. Adding a command
needs no change here; removing one does, deliberately. A step condition other than
the evidence upload's `if: always()` would let a command skip, so none is allowed.
Standard library only: the `changes` job runs this without installing packages.
"""

from __future__ import annotations

import re
import unittest
from pathlib import Path

CI = Path(__file__).resolve().parents[2] / ".github" / "workflows" / "ci.yml"

# Each entry: text that must appear in the frontend-* jobs, and how many times.
REQUIRED = {
    "python3 -m unittest discover -s scripts/tests -p 'test_staged_checks.py'": 1,
    "pnpm run check:expo-packages": 1,
    "pnpm run check:build-tool-security": 1,
    "pnpm run brand:check": 1,
    "pnpm exec tsc --noEmit": 1,
    "node scripts/format_frontend.mjs --check": 1,
    "node --test scripts/test-return-links.mjs && node scripts/check-return-links.mjs": 1,
    "pnpm run test\n": 1,
    "pnpm run build\n": 1,
    "node --test scripts/test-reader-completion-policy.mjs scripts/test-reader-completion-money.mjs": 1,
    "uses: ./.github/actions/prepare-browser-install": 1,
    "pnpm exec playwright install --with-deps chromium": 1,
    "node scripts/serve-reader-check-build.mjs &": 1,
    "node scripts/reader-completion-checks.mjs": 2,
    '--fixture-money-failure "$money_failure"': 1,
    "for money_failure in unavailable wrong-amount missing-as-zero; do": 1,
    "echo 'A deliberately broken money response passed the reader checks'": 1,
    'assert report["passed"] is False and report["blocked_requests"] == 0': 1,
    'assert report["phase"] == "premerge-fixtures" and report["release_match"] == "exact"': 1,
    'assert len(failures) == 1 and failures[0]["name"] == expected': 1,
    'assert failures[0]["failure"] == "reader-expectation-not-met"': 1,
    'and check["passed"] is True for check in report["checks"])': 1,
    "node scripts/check-address-suggestion-layering.mjs": 1,
    "node scripts/check-address-recovery.mjs --skip-recovery --only 'address controls'": 1,
    "node scripts/check-candidate-return.mjs": 1,
    "node scripts/check-contextual-return.mjs": 1,
    "node scripts/check-candidate-location.mjs": 1,
    "e2e/services-print.spec.ts": 1,
    "e2e/candidate-record-status.spec.ts": 1,
    "e2e/tv-ad-records.spec.ts": 1,
    "e2e/event-cards.spec.ts": 1,
    "e2e/event-share.spec.ts": 1,
    "e2e/footer.spec.ts": 1,
    "e2e/contact-side-alignment.spec.ts": 1,
    "e2e/home-hero-social.spec.ts": 1,
    "e2e/home-hero-still.spec.ts": 1,
    "pnpm exec playwright test --config playwright.replay-startup.config.ts": 1,
    "apps/frontend/reader-completion-results.json": 1,
    "apps/frontend/reader-money-negative-*.json": 1,
}


def frontend_jobs(text: str) -> dict[str, str]:
    """The text of each job under `jobs:` whose name starts with `frontend-`."""
    jobs: dict[str, str] = {}
    current = None
    for line in text[text.index("\njobs:\n") :].splitlines(keepends=True)[2:]:
        match = re.match(r"^  ([A-Za-z0-9_-]+):\s*$", line)
        if match:
            current = match.group(1) if match.group(1).startswith("frontend-") else None
            if current:
                jobs[current] = ""
            continue
        if current:
            jobs[current] += line
    return jobs


def problems(text: str) -> list[str]:
    jobs = frontend_jobs(text)
    combined = "".join(jobs.values())
    found = [
        f"{command!r} appears {combined.count(command)} times, expected {count}"
        for command, count in REQUIRED.items()
        if combined.count(command) != count
    ]
    for job, body in jobs.items():
        conditions = re.findall(r"(?m)^        if: (.*)$", body)
        allowed = ["always()"] if job == "frontend-browser" else []
        if conditions != allowed:
            found.append(f"{job} step conditions {conditions}, expected {allowed}")
    return found


class FrontendCommandTests(unittest.TestCase):
    def test_every_frontend_command_runs_exactly_as_often_as_before_the_split(self):
        text = CI.read_text(encoding="utf-8")
        self.assertEqual(
            sorted(frontend_jobs(text)), ["frontend-browser", "frontend-checks"]
        )
        self.assertEqual(problems(text), [])

    def test_a_dropped_doubled_or_conditional_command_is_caught(self):
        text = CI.read_text(encoding="utf-8")
        dropped = text.replace("e2e/footer.spec.ts ", "", 1)
        self.assertIn(
            "'e2e/footer.spec.ts' appears 0 times, expected 1", problems(dropped)
        )
        doubled = text.replace(
            "pnpm exec tsc --noEmit",
            "pnpm exec tsc --noEmit && pnpm exec tsc --noEmit",
            1,
        )
        self.assertTrue(any("tsc --noEmit" in item for item in problems(doubled)))
        conditional = text.replace(
            "      - name: Test frontend\n",
            "      - name: Test frontend\n        if: github.event_name == 'push'\n",
            1,
        )
        self.assertTrue(
            any(
                "frontend-checks step conditions" in item
                for item in problems(conditional)
            )
        )


if __name__ == "__main__":
    unittest.main()
