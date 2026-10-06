# Repeat-failure review and Paradigm comparison, 6 October 2026

Net: Alethical can retain failure evidence and strengthen prevention internally;
Paradigm's paid judgment and substantial engineering-time savings remain unmeasured.

This is a dated, limited evaluation for
[issue 2489](https://github.com/alethical-org/alethical/issues/2489), not a review of
every change or a claim that production defects increased. The operating procedure
is [repeat-failure-review.md](../operations/repeat-failure-review.md).

## History and prevention

The collection covers 9 July through 6 October 2026, inclusive UTC: 1,605 merged
changes, as collected at 13:45 UTC on 6 October. The first examined sample contains 5 changes; 1,600 remain unreviewed.
Selection follows recent address-search failures and the exact scope of reviewed
money disagreements, not a random sample. No whole-repository defect rate follows
from it. The retained inventory keeps the collected metadata except change bodies;
the selected change descriptions retain the evidence used for classification.
The inventory can regenerate the report without another GitHub collection.

Retained inputs: [inventory.json](evidence/repeat-failures-2026-10-06/inventory.json)
and [reviewed-changes.json](evidence/repeat-failures-2026-10-06/reviewed-changes.json).

| Examined behavior | Evidence | Prevention finding |
| --- | --- | --- |
| Address searches keep useful results through failures | [pull request 2474](https://github.com/alethical-org/alethical/pull/2474) | Existing logic tests do not establish the browser's rendered address, results, retry and election labels together |
| Editing and the first click/tap remain usable | [pull request 2477](https://github.com/alethical-org/alethical/pull/2477) | Existing browser checks cover exact prior-address editing and suggestions moving the button; keep them in the runnable local command |
| Waiting feedback follows approved design | [pull request 2479](https://github.com/alethical-org/alethical/pull/2479) | A design change, not an additional failure count |
| An exception remembers what was actually reviewed | [pull request 2358](https://github.com/alethical-org/alethical/pull/2358), [pull request 2368](https://github.com/alethical-org/alethical/pull/2368) | The existing regression changes the official total; separate +$0.01 and -$0.01 payment-sum changes close the other side of the rule |

These changes do not establish a single repeated root cause. Browser event order,
retained display state and the identity of a reviewed data exception are distinct
mechanisms. The shared process opportunity is testing each required transition or
dimension, with failure evidence, rather than relying on a passing count alone.

### Tests that distinguish correct from broken behavior

- The isolated browser command passes 18 journeys in Chromium and 18 in WebKit.
  15 per browser already exist; 3 per browser add the network boundary, failed
  replacement/retry and newest-election checks.
- In a disposable exported copy, clearing retained results when a replacement
  starts leaves all 15 old browser journeys passing. The added retention journey
  fails because the original candidate disappears. This is a deliberate mutation,
  not a claim that the current product has that defect.
- The money tests pass both new payment-sum cases and the existing exception case.
  A test-only replacement that compares only the official figure leaves the old
  case passing and makes both new cases fail at the publication-status assertion.
  No production loader or data is modified by that experiment.
- Current behavior already matches the approved
  [candidate search requirements](../product-onboarding/find-my-candidates-guide.md)
  and [money exception requirements](../architecture/campaign-finance-system-design.md).
  The delivered changes protect those decisions; they do not broaden exceptions
  or change the reader-facing design.

The browser result covers local release files and mocked data, not live backend
availability or native phone autofill. HTTP cancellation and the separate flow
tests establish different older-request paths. No reduction in future incidents
can be measured on the day prevention checks are added.

The [test-only comparison replacement](evidence/repeat-failures-2026-10-06/waiver-mutation.py.txt)
and [observed outcome](evidence/repeat-failures-2026-10-06/waiver-mutation-result.txt)
retain the money experiment. To repeat it, copy the replacement to ignored
`.tmp/waiver_mutation.py` and run the command recorded with the outcome. Expect
2 deliberate failures and 1 pass; run the same selected tests without the plugin
to establish that correct behavior passes.
The [browser mutation recipe and outcome](evidence/repeat-failures-2026-10-06/browser-mutation.txt)
retain the exact exported-code change and the old/new browser assertions used.

## What Paradigm offers

[Paradigm's website](https://www.useparadigm.app/#how-it-works) describes examining
change history, finding recurring patterns, expert recommendations, implementing
tests/checks and monitoring results. Its public example is not an observed result
for Alethical. The examined website supplies no service price or evidence that its
experts outperform Alethical's current method.

The local comparison uses pinned public releases:

- [blast-radius-cr at 30beabe](https://github.com/useparadigm/blast-radius-cr/tree/30beabe3397151546c4482912b76934d594b1f83): finds changed functions and packages nearby callers/callees for review.
- [code-governance at 6e80099](https://github.com/useparadigm/code-governance/tree/6e80099938d69815a10ce8deb11eb8cbfbd97094): builds import maps and enforces explicitly configured boundaries.
- [hosted graph setup at 93bae98](https://github.com/useparadigm/skill_a_thon/blob/93bae98699af33a2358481687491466cee54a8b6/docs/paradigm-setup.md): requires authentication and repository indexing; it is not run in this evaluation.

No AI analysis, hosted account, source upload, vendor message or purchase is part
of the comparison. Public source/package downloads precede local credential-free
analysis. The 2 runnable packages carry MIT licenses. Their code is not added as
an Alethical dependency.

[Portable comparison evidence](evidence/paradigm-2026-10-06/README.md) retains pinned
versions, small inputs, captured output, timings and a reproduction command.

## Measured strengths and limits

Historical inputs are the post-change source and parent-to-change patches for
[pull request 2477](https://github.com/alethical-org/alethical/pull/2477) and
[pull request 2368](https://github.com/alethical-org/alethical/pull/2368), plus small
alias, JSX and comment-only controls. This tests relevant context, not whether a
tool would predict a hidden bug before its fix. Source snapshots cover the changed
code and related Python/frontend directories, not the entire repository.

| Public tool | Useful result | Demonstrated limit |
| --- | --- | --- |
| blast-radius-cr | Packages the money loader's relevant calling function and function bodies | Misses JSX uses and imported aliases; identifies unrelated same-name functions as callers |
| code-governance | Resolves the candidate screen's form import; both Python and TSX forbidden-import controls fail, and their safe controls pass | Confuses the installed Alembic package with Alethical's migration folder, producing a false import cycle |

The function-context tool misses `CandidateSearchContent` drawing
`CandidateAddressForm`, resolves `useResponsive` to a test double, and treats a
comment-only edit as a modified function. Its no-AI `PASS` is an unconditional
starting value, not a safety judgment. Default body limits truncate 1 returned
body in the frontend case and 13 in the money case without a truncation warning.

The function-context runs take 7.472 and 2.846 seconds on this Mac. Matched-name
searches take 0.035 and 0.036 seconds, but provide less structured output. These
are different outputs and machine seconds, not engineer minutes or evidence of
equivalent quality. No human setup, interpretation or maintenance time is measured.
The import graph supplies a real additional structured view, but that is not proof
of better outside judgment or substantial engineering savings.

## Decision and remaining evidence

Use Alethical's small internal evidence record and executable prevention checks.
Do not add either public Paradigm tool as a required release gate on this evidence.
Import mapping can be useful as supporting evidence, with package identity checked
before trusting its conclusions. Building a general code-graph platform is outside
this prevention task and has no demonstrated need here.

The paid service could still add value through experienced reviewers, comparisons
across teams or faster implementation. None is observable without a returned
service sample and terms. The proposed blind, fixed-price comparison and acceptance
bar are in [repeat-failure-review.md, Buying outside review](../operations/repeat-failure-review.md#buying-outside-review).
This is a proposal, not approval to contact, buy, index source or start monitoring.
