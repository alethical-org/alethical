---
name: when-to-act-without-approval
description: Use when deciding whether a change is yours to ship or needs Eugene's approval first, and to look up what to verify before shipping it — the per-domain carve-out details behind `.claude/rules/workflow.md` rule 10 (front-end, backend, migrations, paid production runs, dead-code removal, concurrent-session safety) plus the catalogue of handbacks that produced each grant. Invoke before opening a PR, when tempted to ask "want me to ship this?", and before committing or merging while other sessions are running.
---

# When to act without approval — the carve-out details

`.claude/rules/workflow.md` rule 10 carries the **principle, the hard line, the reserved stops, and the standing grants** — that is all resident, and it is enough to decide *whether* you may act. This skill carries what it does **not** need to be resident: **what to verify per domain before you ship**, and the incident history behind each grant.

**Read the split correctly.** If you never invoke this skill, the resident rule still answers the permission question correctly — act, then report. What you'd lack is the verification checklist, not the authority. So never read "the skill isn't loaded" as "better ask first"; load it, or verify by the principle (blast radius + reversibility + verifiability) and say in the PR what you checked.

---

## Front-end changes

Safe, reversible front-end production changes are auto-eligible — **not only presentational ones**. This includes **implementing a design handoff** (building or reworking a screen or component from a mockup, spec, or design instructions — the `design-build` case), styling, spacing, hover/focus/tap/active states, transitions and animations, responsive reflow, shared style-helper extraction, **accessibility / WCAG-2.x-AA fixes to already-shipped UI** (contrast, accessible names/labels, heading & landmark semantics, visible focus, keyboard operability, `prefers-reduced-motion`, role/`aria` mappings), and **self-contained client-side interaction logic** (auto-growing/expanding/collapsing inputs, local or transient UI state, keyboard handling, client-side sort/filter of already-loaded data).

**Qualifies only when** the change is self-contained to its screen/component and touches **no** data-fetching/API/backend contract, auth, persisted or shared state, or schema, and makes **no** new user-facing claim or capability.

**Verify before shipping:** `tsc --noEmit`, `prettier --check .`, and the production build pass; **manually verified on the dev server across the affected viewports and states** (no front-end test runner yet — [#173](https://github.com/alethical-org/alethical/issues/173) — so manual QA is the gate); a clean `git revert` fully undoes it. Say in the PR what you verified.

**Accessibility fixes verify by their standard, not by eye, and are not held for approval:** file the issue at discovery, fix, then gate on `tsc`/`prettier`/CI/build green **plus** a WCAG check (screen-reader name/heading, reduced-motion toggle, a measured contrast ratio). For an already-shipped public surface, live confirmation may follow the merge. When an AA fix darkens a shared token or carries another visual tradeoff, still merge, but name the tradeoff in the after-report so it can be eyeballed and reverted if disliked.

**Local routing wiring** qualifies only if you've confirmed every affected route — and any shareable/deep-link URL (`.claude/rules/grounded-answers.md` rule 5, Anything linked to must be URL-addressable) — still resolves.

**Still needs care:** anything you cannot visually verify (e.g. an auth-gated surface) — verify it another way or say plainly what went unverified.

## Backend changes

A backend / pipeline / API change is auto-eligible when **all** of these hold:

- behavior-preserving by default, **or** its new behavior is fully exercised by tests (e.g. a parameterization whose defaults keep current behavior, a bug fix with a regression test);
- the full backend suite passes **locally against real Postgres** *and* the **backend CI job is green** on the PR;
- a clean `git revert` undoes it — no schema/data migration, no destructive or irreversible state change;
- it spends no money and touches no production *data* (writing code that will later run against production is fine — *running* it against production is not).

Reference precedents: [#219](https://github.com/alethical-org/alethical/pull/219) (session parameterization, defaults unchanged) and [#222](https://github.com/alethical-org/alethical/pull/222) (fallback-embedding labeling fix with regression test + real-data proof). Say in the PR what was verified and how.

**Higher scrutiny, but still not an automatic pause:** *destructive/irreversible* schema/data migrations, anything auth/security-sensitive, destructive or hard-to-reverse data operations, *unverified* production data runs, new externally-visible API contracts or user-facing claims, and changes whose correctness you cannot demonstrate by test or local execution. "It's backend code" alone is never a reason to hand the merge back.

## Migrations

An **additive and reversible** migration — `CREATE TABLE`, add a nullable column, add an index, a new enum value — that you have **verified** (an upgrade→downgrade→upgrade round-trip against real Postgres, plus CI green) is in the **auto-merge** lane: build it, verify it, squash-merge it. It is **not** the destructive/irreversible schema change the hard line reserves — that is `DROP COLUMN`/`DROP TABLE`, a data-losing type narrowing, a destructive `ALTER`, where `git revert` + downgrade would not cleanly restore state.

Three traps, each of which has cost a needless handback ([#489](https://github.com/alethical-org/alethical/pull/489)/[#486](https://github.com/alethical-org/alethical/pull/486) — an additive `CREATE TABLE` plus an additive, idempotent, dry-run-proven backfill, built CI-green and then *asked about instead of merged*):

- **`migrate.yml` auto-running `alembic upgrade head` against production on merge is the deploy pipeline, not a reason to gate.** Merging *is* how a verified migration reaches prod. What makes it safe is the verification you already did (the reversible round-trip + CI green), not a human nod. For an additive/reversible/verified migration, merging fires a *verified, reversible* change — not an unverified irreversible blast.
- **An additive, idempotent production backfill is likewise not the hard line.** Its irreversible-harm guard is honored by engineering: dry-run default, then a scoped single-record live check read back. Once those pass, run the full backfill and merge.
- **Two deploy-time traps that make a green merge lie.** An Alembic revision id longer than **32 characters** overflows `alembic_version.version_num` (`varchar(32)`) and fails only at `upgrade` time — the migration parses fine, lint and types pass, and it surfaces as a CI database error (`StringDataRightTruncation`); the repo convention `NNNN_short_slug` already fits, so don't append long descriptors. And **a merged PR containing a migration does not mean the migration ran**: when `migrate.yml` was failing on a stale `DATABASE_URL` secret, prod sat unmigrated *and* stamped with a revision that wasn't even in `main` ([#288](https://github.com/alethical-org/alethical/issues/288)). After merging any migration, query prod for the object or check `alembic_version` — verify the landing, not the merge. If the pipeline is down, applying a guarded (`IF NOT EXISTS`) reversible DDL directly is a safe interim, and the migration no-ops later.
- **A task-embedded "propose-first" phrasing does NOT reinstate a gate the standing grant lifted.** A line like "any migration is propose-first via Alembic" inside a task prompt is subordinate to the standing grant — read it as *"verify this migration especially carefully,"* not *"stop and ask."* Only a genuinely destructive/irreversible migration, or Eugene restating the gate as a live instruction in the current session, actually pauses you. When unsure whether a migration is reversible, that doubt is answered by **testing the downgrade**, not by asking.

## Paid production runs

Cost alone never gates. The order of operations is:

1. **Prefer a zero-cost / near-zero path and prove it doesn't exist or won't do the job** before spending — can the outcome be reached without paid API/LLM calls or a paid data run? (Re-deriving from data already present, re-fetching a *free* public source, a surgical column-only backfill instead of a full paid re-ingest.)
2. If a zero-cost path suffices, take it.
3. If it genuinely can't, **run the paid production job on your own recommendation, funding it from the budget** — don't stop merely because it costs money.

Before a run that spends real money **or** mutates/destroys real production data **or** hits real users: verify by engineering first — a **dry run plus a small scoped live check** (one record end-to-end, read back, confirmed correct) — then let the full run proceed. Verify before you fire; prefer cheap over paid; a correct, verified, budgeted paid run needs no pause.

*(Origin: [#328](https://github.com/alethical-org/alethical/issues/328)'s action-date backfill — a zero-cost path existed, re-fetching the free MN Revisor XML and updating only the date columns, so no paid re-ingest was needed. Had it not, this authorizes the paid re-ingest against the budget.)*

Note this interacts with `~/.claude/CLAUDE.md`'s cheaper-and-faster-frontier rule, which stops for a **comparative** gap — a materially cheaper/faster *equivalent path that exists*. When no cheaper path exists, this section governs and cost does not gate.

## Removing unreachable code

Dead code (an unmounted screen, an unrouted component, an unreferenced export/asset/style) is safe to delete: `git revert` restores it and nothing user-facing changes. **The gate is proof of unreachability, not permission** — establish it by *knowing*, not inferring (nothing routes/links/deep-links to it, or its navigator/entry is itself unrendered; grep the wiring and cite the evidence), then remove it with the imports/registration your deletion orphans, verify (`tsc`/`prettier`/build green, and the live app still routes everything that *is* reachable), and merge. If reachability stays genuinely uncertain *after* real investigation, that uncertainty is the signal to leave it (or trim rather than delete) — not to hand it back unexamined.

## Scope: sweep the pattern, and solve the broader problem

**Sweep the pattern — don't fix only the reported instance.** When a request exposes a *class* of problem — a redundancy, a bug shape, a stale reference, an inconsistency, an accessibility miss, a naming drift — search the whole codebase for every instance in the same pass, fix every clear-cut one, and ship them together. Present back only genuine judgment calls, and lead those with a recommendation, never a bare menu. *(Origin: asked to drop one redundant empty-state line, I fixed it but handed back the follow-up sweep and the dead-screen removal.)*

**Solve the broader problem when you're already there — don't narrow-and-defer.** Where sweeping covers every *instance*, this covers the more complete *solution*: build it when the work you're already doing exposes it, it addresses the same root problem the task named, and it is itself in-lane. Do **not** ship the easy half, file the hard half as a follow-up issue, and stop — filing an issue does not discharge it. Trigger to build-now: you're in the exact context, the broader fix clears the same test as the narrow one, and it makes the feature actually deliver what the task was reaching for. Filing is correct only for work genuinely *out* of lane — a real toss-up on approach or a dependency you don't control — and even then you file it *and keep going* on what you can do. When a broader fix needs one empirical input (e.g. tuning a threshold against production data), that input is something you **go measure**, not a reason to defer; ship behind the superset/safety guarantee that makes a wrong tuning harmless, then refine. Milestone is irrelevant: "the broader fix is v2" is never a reason to defer it when you're positioned to build it now. *(Origin: shipping [#571](https://github.com/alethical-org/alethical/issues/571)'s root-word search fix, I scoped down to inflectional matching, filed the broader fuzzy/typo fix as [#573](https://github.com/alethical-org/alethical/issues/573), and stopped — when #573 was an additive-migration + backend change in the auto-merge lane and I was already in the search code with a QA environment running. The narrow fix left the user's own reported goal half-delivered.)*

## Concurrent sessions: committing and merging safely

This repo runs many sessions and worktrees at once — origin, and sometimes your own working directory, move under you. The resident rule carries the destructive-git prohibition; these are the mechanics.

- **Default to your own worktree.** Before writing code you'll commit, create one off `origin/main`: `just worktree <branch>` (creates `../alethical-wt-<branch>`, installs deps, links `.env` so build/verify works immediately). `just worktree-rm <branch>` cleans up after the PR merges. This is the *starting move*, not a reaction to noticing a collision. (Bare `git worktree add -b <branch> <path> origin/main` still works for a custom path.)
- **A dirty tree you didn't create means a live session is in your checkout — isolate, don't tidy.** Rule 1 and `design-intake` scan open PRs and branches, which catches *committed* overlap; a concurrent session editing the same file with **uncommitted** work is invisible to `gh pr list` and to any ref scan. The tells: a `git diff` showing changes you never made, HEAD-reflog `checkout` entries you never ran, or a branch pointer that moves between two reads. What makes it dangerous is that the obvious recovery moves — `checkout -b`, `stash`, `reset`, `checkout <branch>` — all risk destroying work that exists nowhere else, and `git checkout -b` will *carry* their uncommitted changes onto your new branch. So: restore their tree exactly as found (revert only your own hunks by exact string; put HEAD back on the branch they were on), then start over in your own worktree off `origin/main` on a dedicated dev-server port. Tell Eugene — he may not know two sessions are open.
- **A push is the real safety net for uncommitted work.** If you must build in a shared checkout, commit only *your* files (`git add <paths>`, never `git add .` when foreign changes are present) and **push immediately** — a pushed commit survives any other session's destructive clean; uncommitted or unpushed work does not.
- **Re-verify freshness at merge, against the fresh tip.** Right before committing and again before merging: `git fetch origin main`, then `git diff origin/main -- <file>`. Trust that, not your in-memory read — a file can mutate between your read and your edit when a PR merges mid-session (Jul 2026: #200 rewrote a skill that was open; #203 landed mid-work). Confirm the diff is *only* your hunks — a tangled or duplicated diff means another session already shipped part of it (rule 1's #121/#122 trap, caught at merge instead of after).
- **"Skipped" is not "verified."** A CLEAN merge state with the relevant CI job SKIPPED (path-filtered — e.g. the front-end job on a docs-only PR, so repo-wide `prettier --check .` never ran) means that gate didn't fire. You are the last gate: run the skipped check locally, or consciously accept its absence and say so in the PR.
- **Finish cleanup by hand when a worktree holds `main`.** `gh pr merge --delete-branch` can't check out `main` or delete your local branch when another worktree holds them — its `failed to run git` prints *after* the remote squash lands, not instead of it. Confirm the squash is on the `origin/main` tip, then clean up by hand (`git branch -D <branch>`, `git worktree remove <path>`); don't read the error as a failed merge.

## The handback catalogue — what each grant was bought with

Every grant in the resident rule exists because a specific handback happened. Kept here so the resident rule doesn't have to carry them:

| Grant | The handback that produced it |
|---|---|
| Merge your own low-risk PRs | Repeated "want me to merge?" on CI-green, revertable PRs (Jul 14 2026). |
| Act on your recommendation, don't propose first | Every propose-first category — migrations, auth, outbound comms, production runs, outward content, capability copy — was collapsed into act-then-report (Jul 14 2026). |
| Never offer a safe deliverable and wait | Closed with "say the word and I'll propose that table" for a table I should have just produced (Jul 15 2026). |
| Recommended tweaks are build-and-ship | After fixing [#513](https://github.com/alethical-org/alethical/issues/513) I closed with "want me to add the hardening? Say the word" — should have built the CI migration-collision guard ([#523](https://github.com/alethical-org/alethical/issues/523)) autonomously, which is exactly what I then did once told to. That *I* proposed the tweak is never a reason to gate it (Jul 21 2026). |
| Own the sequencing | Asked "which item should I start with?" when given a goal without a step list (Jul 14 2026). |
| Continuous progress, no next-step nod | After merging the eval harness I closed with "Want me to proceed to #89?" instead of just starting #89. |
| A change you recommend is as authorized as one the user typed | [#206](https://github.com/alethical-org/alethical/pull/206) shortened the capability cards' press-glow to 300ms, leaving the chips at 650ms — inconsistent with [#204](https://github.com/alethical-org/alethical/pull/204), so aligning them ([#208](https://github.com/alethical-org/alethical/pull/208)) was mine to ship, not to hand back. "It wasn't explicitly requested" is a void reason. |
| Unattended work is checkpoint-and-continue | After shipping the web Bill Detail overnight I filed the version-label polish ([#433](https://github.com/alethical-org/alethical/issues/433)) and the per-member-votes backend ([#83](https://github.com/alethical-org/alethical/issues/83)) and stopped — treating "low context / big change / fresh session" as stops when they were checkpoint-and-continue signals (Jul 21 2026). |
| Take the product lead | Eugene put this session in the lead on product management and engineering: identify, prioritize, and sequence the roadmap rather than asking what's next (Jul 16 2026). |
| Applying audit verdicts is in-lane | The Jul 13 workflow-overhead audit flagged rule 10 for trim, then withheld the rewrite for approval; Eugene approved it and directed that future audit verdicts be applied autonomously. |

**Reading the catalogue:** the pattern across all of them is that the reason for pausing was never a safety concern — it was "it wasn't explicitly requested," "it's a big change," "it's late," "it's their code," or "it's a later milestone." All void. The resident rule's *not-valid-reasons* list is the compressed form of this table.

## Stale-copy warning

Before concluding this lane doesn't cover your change, confirm you're reading the current `origin/main` version of `.claude/rules/workflow.md` (rule 1) — a worktree branch or CLAUDE.md snapshot cut before a carve-out merged still shows an older, narrower rule. Reading a stale copy is the one thing that reliably defeats the grant.
