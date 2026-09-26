# Editorial comments build and release

Owner: the Codex task `blog comments`. User authorization: after the full comments
build recommendation at `gpt-6-astra` `xhigh`, Eugene said `go` on 26 September 2026.
This covers implementation, tests, browser review, pull request, merge, deployment
and safe live verification. There is no new product or Design request in this build.

Issue: [2399](https://github.com/alethical-org/alethical/issues/2399).
Release: [pull request 2401](https://github.com/alethical-org/alethical/pull/2401).
Approved behavior: [editorial-comments-guide.md](../product-onboarding/editorial-comments-guide.md).
Accepted source: `Alethical UX (26).zip`, SHA-256
`4a693c8bad526b329df4ebea0f58f2feef01bae97a817040642cefe5ba3cce9b`.
The temporary input is `/tmp/comments-design-sept26-accepted-copy/exports/design_review_comments`.
No prototype or other unrelated punctuation drawings are production artifacts.

## Work order and ownership

1. Root: published article identities, generated server registry and drift check;
   durable approved behavior and navigation/integration. Complete; acceptance corrections applied.
2. Backend helper `comments_backend_map`: schema, migration, permissions, mutations,
   pagination, stop tokens and database tests. Complete; acceptance corrections applied.
3. Frontend helper `comments_frontend`: comments, dialogs, recovery, account/article
   state and stop screen, client contract and focused tests. Complete; acceptance corrections applied.
4. Email helper under `comments_backend_map`: exact templates, outbox drain and tests.
   Complete; durable retries and final privacy checks covered.
5. Root: review returned implementations, integrate, resolve API differences, run
   migration round trip, backend/frontend checks and real browser flows at the
   desktop/tablet/phone bands. Requires 1–4.
6. Root plus an independent review: permission, concurrency, recipient selection,
   privacy, retry and deletion behavior. Fix findings and rerun affected checks.
7. Root: commit, PR, current-head checks, merge queue, deployment, safe live reads,
   approved admin activation, release evidence and issue closure. Requires 5–6.

All helpers share the task worktree but have separate file ownership. Root commits
coherent milestones; helpers do not stage or commit another writer's work.

## Completion checks

- Only published individual editorial addresses render or request discussion data.
- Sign-in returns to the correct comment/reply and first name starts empty.
- Public name changes update past contributions without using an email-derived name.
- Posting/editing/retrying publishes once; late responses cannot clear newer drafts.
- Oldest-first pagination, deep links and reply-to-reply targeting remain correct.
- Owner/admin rights are enforced by the server. Cross-account/article writes fail.
- Parent and intermediate deletion preserve others and remove unused placeholders.
- Posted and edited dates remain visible, dates only, including same-day edits.
- Reader recipient self-exclusion, overlap, edits, stops and reenable races match intent.
- All email headers, 9 templates, direct links and admin-only destination match copy.
- Durable delivery handles restarts, transient failures and uncertain provider outcomes.
- Stop-link inspection is read-only; private settings/tokens never enter cache or metrics.
- Keyboard, pointer, touch, 200%/400% zoom, slow writes, failures and retries work.
- Busy controls retain size; dialogs keep actions reachable above the phone keyboard.
- Additive migration passes upgrade/downgrade/upgrade on owned disposable PostgreSQL.
- Required checks pass on the exact PR head, then the deployed release is reachable.

## Current checkpoint

Branch `codex/editorial-comments`, isolated checkout
`/Users/eug/.codex/worktrees/938a/Alethical`. Backend API contract is temporarily
`/tmp/comments-api-contract.md`. Frontend dependencies and Python environment are
installed; Docker is available. No real comments or emails have been sent.
Production confirmed accounts and configured administrator IDs match for
alethicaldev@gmail.com, angel@alethical.com, angelzierden@gmail.com and
eug@alethical.com. ask@alethical.com has no confirmed account yet. Eugene has been
asked to create and confirm it; its later activation is the only user-owned step.
All admin email alerts still go to ask@alethical.com.

Acceptance evidence: the full pre-push suites pass on the initial feature commit,
with 3,441 backend tests and 3,670 frontend tests. The independent security review
reproduced and accepted fixes for concurrent follower posts and an erased
reply-target name in prepared email. The 22 comment database tests pass.
The independent reader review passed desktop, tablet, 320-wide phones, keyboard,
long text, nested replies and actual Chrome 200%/400% zoom. Root's 4 browser stories passed in Chromium, Firefox and WebKit against disposable
PostgreSQL with external requests disabled. The private stop screen was exercised
through both independent choices with a fictional local account. The release build
passes the unchanged startup limit locally at 295,772 compressed bytes after
moving the discussion hook into the article download. The first hosted preview
exceeded the unchanged limit by 15 bytes; the corrected hosted build must pass
before merge.

The final browser run passes all 12 checks, including cross-article drafts and
returning focus only to the visible discussion.

Remaining: required checks on final head,
PR/queue/release, exact deployed table privacy checks,
email gate activation, safe live reads, and ask@ account activation when available.
Production has an enabled ensure_rls CREATE TABLE trigger; inspect the 6 resulting
tables and zero policies after migration. No outbound test mail or public test
comments are allowed. Do not wait for ask@ account creation to release the feature.

Production Resend reports alethical.com verified. The comment-mail gate is staged
false in Railway, without starting a deployment; enable only after release checks.
