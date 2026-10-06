# Preventing repeated failures

<!-- describes: scripts/review_repeat_failures.py, scripts/tests/test_review_repeat_failures.py, apps/frontend/scripts/check-address-recovery.mjs, apps/frontend/scripts/check-address-recovery-local.mjs, alethical/tests/test_campaign_finance_load.py -->

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
CI check rejects missing files or anchors. It cannot prove that a test still catches
the cause; running the test against broken behavior supplies that evidence.
The same CI step runs the history-tool tests and the browser runner's small native
process-cleanup tests. Those tests launch local fixture programs, not browsers.

Reviews run when investigating a failure or deliberately reviewing a bounded
history window. There is no recurring AI job, vendor connection or paid schedule.
The task repairing a failure owns its cause record and prevention evidence through
delivery. The existing release checks run the money tests; the browser command
remains on demand under [CONTRIBUTING.md, Frontend tests](../../CONTRIBUTING.md#frontend-tests).

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
