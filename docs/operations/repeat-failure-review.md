# Preventing repeated failures

<!-- describes: scripts/review_repeat_failures.py, scripts/tests/test_review_repeat_failures.py, scripts/repeat_failure_runs.py, scripts/tests/test_repeat_failure_runs.py, scripts/tests/test_repeat_failure_runs_pytest.py, apps/frontend/scripts/check-address-recovery.mjs, apps/frontend/scripts/check-address-recovery-local.mjs, alethical/tests/test_campaign_finance_load.py -->

Alethical reviews the cause of a failure, finds the other places that share that
cause, and adds a check that fails when the broken behavior returns. A change
title containing “fix” is not evidence of a bug or a repeated cause.

The operating record is [repeat-failure-cases.json](repeat-failure-cases.json).
The [6 October 2026 review](../research/repeat-failure-review-2026-10-06.md)
records the initial sample, demonstrated prevention gaps and Paradigm comparison.
This implements [philosophy.md, principle 9](../philosophy.md#9-prevent-dont-just-fix) without changing
product intent or buying a second review service.

## Collect and review

Run from the repository root with Python 3.11 or later and an authenticated GitHub
command-line client (`gh`). Collection reads pull-request metadata through existing
repository access; it does not upload source to another service or call an AI model.
Dates are inclusive UTC dates. Keep generated history and reports in ignored `.tmp/`.

```sh
python3 scripts/review_repeat_failures.py collect \
  --repo alethical-org/alethical \
  --since 2026-07-09 --until 2026-10-06 \
  --output .tmp/repeat-failure-history.json
python3 scripts/review_repeat_failures.py report \
  --history .tmp/repeat-failure-history.json \
  --review docs/operations/repeat-failure-cases.json \
  --output .tmp/repeat-failure-report.md
python3 scripts/review_repeat_failures.py check \
  --review docs/operations/repeat-failure-cases.json --root .
```

Collection follows the closed-change list through every relevant page, including
more than 1,000 changes. Recently edited old changes do not determine the merge
window. The first page is read again to detect movement during collection. Failed
requests, conflicting records, a changed first page or a pagination limit preserve
the previous output. This is a best-effort read of a changing service, not a
transactional snapshot at 1 instant. `complete` means traversal reached its window
boundary, not that every change has been reviewed or every failure found.

The report prints examined and unexamined counts separately. It does not turn
change counts into incident counts, infer recurrence from a title, or publish a
fix-to-feature ratio. Design changes and prevention work remain distinct from
failure-related changes. References absent from the inventory do not enter totals;
their merge dates remain unestablished by that inventory.

For each suspected pattern, read the actual changes, governing requirements and
existing tests. Record:

1. The reader's difficulty and the demonstrated cause, with source links.
2. Confirmed shared uses and meaningful exceptions. Similar words are not a shared cause.
3. The smallest prevention change, its owner and its remaining limits.
4. A check that passes on correct behavior and fails on the relevant broken behavior.
5. Whether later failures have the same cause, rather than assuming each follow-up is a recurrence.

Each registry case has an ID, summary, cause, evidence-bearing occurrences and a
prevention status (`covered`, `partial`, or `open`). Occurrences use `failure`,
`prevention`, or `design`. Assign each failure-related change to at most 1 case so
totals cannot double-count it; describe multiple mechanisms inside its evidence.
Every retained check names a repository file and exact test-name anchor. The free
CI reference check rejects missing files or anchors. Finding a name, including a
name in a comment, does not establish that a test ran. The historical `covered`
status is a reviewed statement about the scoped invariant, not a pass on the code
being released. Running a test against deliberately broken behavior supplies a
separate kind of evidence: that the test can catch the known failure.
The same CI step runs the history-tool tests, the run-receipt checker tests, and
the browser runner's small native process-cleanup tests. These always-run checks
use Python's standard library and local fixture programs, not browsers or pytest.

Reviews run when investigating a failure or deliberately reviewing a bounded
history window. There is no recurring AI job, vendor connection or paid schedule.
The task repairing a failure owns its cause record and prevention evidence through
delivery. The existing release checks run the money tests; the browser command
remains on demand under [CONTRIBUTING.md, Frontend tests](../../CONTRIBUTING.md#frontend-tests).

## Named results on the code being released

[repeat_failure_runs.py](../../scripts/repeat_failure_runs.py) runs pytest once
and reads pytest's own machine-readable results (JUnit). The fixed `money`
selection runs the 2 registered loader tests, including both +$0.01 and -$0.01
parameters. The `backend` selection runs the existing complete backend suite and
checks the same 3 named results within it. The registry cannot supply commands.

Use a fresh ignored output folder for each run:

```sh
uv run --frozen python scripts/repeat_failure_runs.py run \
  --scope money --output .tmp/repeat-failure/money-1
# In backend CI, replace the existing pytest invocation with this single run:
uv run --frozen python scripts/repeat_failure_runs.py run \
  --scope backend --output .tmp/repeat-failure/backend-1
# After a run from clean committed files, compare with the exact checkout:
python3 scripts/repeat_failure_runs.py check \
  --output .tmp/repeat-failure/backend-1 --commit "$(git rev-parse HEAD)"
```

The runner saves `receipt.json` and `pytest.xml` in that folder. It records the
commit and content fingerprints of tracked files and nonignored new files before
and after pytest. Ignored output and caches do not enter the source snapshot.
Changed source, a failed process, missing results, skipped required tests, duplicate
test identities, changed parameter coverage and inconsistent or truncated JUnit
output prevent a successful receipt. A test name retained only in a comment cannot
supply a collected, passing testcase. Other skipped backend tests remain outside
this scoped prevention claim; failures anywhere in the backend run reject it.

Unfinished or interrupted runs leave an `incomplete` receipt, and a new run refuses
to overwrite an existing output folder. Normal exits and interruptions clean only
the runner's own process group. On interruption, pytest gets time to unwind its
existing disposable-database cleanup before remaining children are stopped.
The child receives a small allowlist of environment settings and the local test
database contract, never inherited service keys or pytest plugin overrides.
A working copy with nonempty `.env` settings is refused before importing the app.
The existing database guard still selects its own disposable local server, or
GitHub's fresh job-owned server; no production database is selected.

A successful run on unfinished edits is explicitly a working-tree result. The
`check` command rejects it as release evidence, even if the same edits are later
committed. Release evidence requires a fresh run with clean files, the same full
commit, unchanged fingerprints and the retained JUnit file matching its saved
hash. Run `check` in that same checkout; file modes and local paths make this a
local/CI run receipt, not a portable signed build certificate. A PR's test commit
and a later merge commit are different identities and require separate runs for
claims about those commits.

This is drift and completeness checking, not authentication. Someone controlling
the files or runner can forge both outputs and hashes. Before/after snapshots do
not detect a temporary edit restored before the second snapshot. Ignored runtime
files, installed dependencies, the Python executable and the host are not fully
attested. A passing named test also does not prove that its assertions remain
strong enough; review the assertions and retain the broken-behavior experiment.

Each receipt lists `reviewed-money-exception-identity` as the passed scoped case
and lists the 2 candidate cases as `not_run_cases`. This money result does not
supply current browser or frontend-test proof. Full address browser journeys
remain on demand under [CONTRIBUTING.md, Frontend tests](../../CONTRIBUTING.md#frontend-tests)
and [issue 1635](https://github.com/alethical-org/alethical/issues/1635).

The [money mutation recipe](../research/evidence/repeat-failures-2026-10-06/waiver-mutation.py.txt),
[money mutation outcome](../research/evidence/repeat-failures-2026-10-06/waiver-mutation-result.txt)
and [browser mutation recipe and outcome](../research/evidence/repeat-failures-2026-10-06/browser-mutation.txt)
remain the historical demonstration that deliberately broken behavior fails.
The run receipt does not claim those experiments were repeated for the current
release. Repeat a relevant experiment when changing its assertions or prevention
mechanism, keeping the broken copy separate from the release run.

The receipt checker's stdlib tests run with:

```sh
python3 -m unittest scripts.tests.test_repeat_failure_runs
```

Its separate integration test runs real pytest against a tiny temporary test and
then its comment-only replacement. It belongs in the backend environment after
`uv sync`, not the stdlib-only job:

```sh
uv run --frozen python -m unittest scripts.tests.test_repeat_failure_runs_pytest
```

## Address and result replacement checks

After `just setup`, install the project's matching browsers if they are absent:

```sh
pnpm --dir apps/frontend exec playwright install chromium webkit
pnpm --dir apps/frontend run check:address-recovery:local
```

The command builds a temporary release export, serves it on an unused loopback
port, and runs Chromium and WebKit against local fixture responses. The command
does not load `.env`, connect a backend, or send address searches to outside
services. Child settings exclude service credentials; unexpected outside requests,
API reads and writes are blocked. Temporary build output, cache and the owned
server are removed after success, failure or interruption.

The checks cover silent browser value changes, first-click and first-tap submission,
editing an earlier address, retained results and their address/election labels while
a replacement fails and retries, and the newest election surviving an older
cancelled request. Existing page-download recovery checks run in the same export.
The fixture addresses are public civic buildings and the candidates are illustrative.

The older-request browser check establishes the supported HTTP cancellation path.
[candidateFlow.test.ts](../../apps/frontend/src/components/candidates/__tests__/candidateFlow.test.ts)
also covers a service that returns an older answer despite cancellation. Neither
test proves physical phone keyboard autofill; that needs a real device. Assertions
preserve the behavior in [find-my-candidates-guide.md](../product-onboarding/find-my-candidates-guide.md).

## Profile campaign history retention

[Issue 2542](https://github.com/alethical-org/alethical/issues/2542) carries the
separate profile-history correction. Its rendered tests use the real query hook
and complete-history reader with controlled local API responses. Before the
correction, 3 failed rechecks hid accepted history while its complete data stayed
in memory; the delayed-retry test also failed because no retry control remained.
The retained behavior keeps the accepted committee and source copy, opened
percentages, and honest retry feedback together. First failure, explicit
unavailable answers, changed committee or source copy, and partial replacement
years cannot create a history. The shared selected-year completion flag and the
profile's committee-confirmation expiry remain intact. The history is a separate
all-years record, rather than a selected-year payment list.

The retained test names are in
[repeat-failure-cases.json](repeat-failure-cases.json). Their local passing result
is not browser or live-release evidence; the owning release still supplies those
checks. No sitewide refactor or new scheduled work is included.

## Scoped exceptions to money comparisons

A previously reviewed disagreement can carry forward only while both the payment
sum and the filer's reported amount stay unchanged to the cent. The
[campaign-finance design, section 4.3](../architecture/campaign-finance-system-design.md#43-validation-before-anything-is-published)
owns that rule; this review changes its test coverage, not the rule.

```sh
uv run --frozen pytest alethical/tests/test_campaign_finance_load.py \
  -k 'changed_itemized_amount or a_reconcile_committee_year'
```

The suite starts its own disposable local database and uses local source/storage
fixtures. The new cases change only the payment sum by +$0.01 or -$0.01, hold the
official figure fixed, and require the replacement to stop while the previously
published data stays available. The existing test covers the other amount,
unrecorded figures and new committee-years.

## Buying outside review

Paradigm's public tools and its paid experts are different things. Public code can
establish what the tested code finds; it cannot establish an expert's judgment,
private implementation method, delivery time, price or long-term results.

A proposed one-off comparison uses 10 past changes and 5 safe controls, with later
fixes and revealing descriptions withheld from both reviewers. Compare the same
inputs, retain both unedited answers, and measure human time spent checking and
correcting them. A useful result supplies either an additional material, supported
prevention finding or at least 50% less total checked human work without a material
loss of correctness. The 50% threshold is Alethical's proposed decision rule, not a
vendor claim. A returned report still needs executable prevention checks.

Price, permitted source access and deletion/retention terms precede any service
trial. Vendor contact, source transfer, purchase, recurring monitoring and new
product choices remain separately authorized. No such trial is active.
