# Workflow-overhead audit — the skill layer (14 skills, layers 1 + 3) — 2026-07-26

> **Addendum, 2026-07-26 (later the same day): the scheduling recommendation below is countermanded.**
> This record twice proposes a scheduled runner as the structural fix for the observation backlog —
> in "Found, not fixed" item 1 and watch item 2. Eugene decided the opposite: **all scheduled tasks
> and routines were removed and every process run is manual, on request**, until the right frequency
> is understood. `monthly-issue-triage`, `workflow-overhead-audit-monthly` and the
> `weekly-observation-review` this audit armed are all gone; `~/.claude/scheduled-tasks/` is
> deliberately empty. Read those two items as *findings about the backlog*, which stand, and ignore
> their remedy — the reasoning was sound: two of those jobs had silently never fired while a memory
> claimed they ran monthly, which is worse than having none. Do not offer to re-arm them.
>
> **The rule is about clocks, not autonomy** (clarified the same day, after a first reading of it here
> was too broad): running a review or an audit **ad hoc, because a session's work called for it, is
> not gated** — only arming something that fires on its own later is. So the backlog is not "accepted";
> it gets drained whenever a session is in the area. Watch item 2 should be read as *does the backlog
> get drained when someone is in there*, not *does it acquire a runner*.
>
> **Outcome of the first such drain, same day:** all 15 OPEN entries were triaged against the actual
> files. **Only 4 were real work** — five had already been implemented and never marked (three said
> "applied in this session" in their own text while still reading OPEN), three were superseded, three
> were partial. The log was overstating its debt roughly threefold because the apply step and the
> mark-done step were separate actions, and the second kept getting skipped. Both are now one step.

**Net:** the fourteen reusable instruction packs turned out to be in good shape — twelve are kept exactly as they are. One was genuinely broken: a borrowed 73,000-character document, written for a different tool, whose instructions actively contradicted how this setup works. It is now a 5,900-character working skill with the original preserved intact beside it. Three other things that *looked* like duplication were investigated and proved to be deliberate, well-built design; they were left alone, and finding that out was most of the work.

Layer: **1 + 3 together** — the skill population spans both (7 repo skills, 7 personal), and auditing either half alone would miss the global-vs-repo placement question that only appears when you look at both. Diff base: `2026-07-26-memory-system.md` (same day, layer 4).

**Run justified:** the skill *listing* is always-resident and was measured at ~1,820 est. tok, but no audit had ever examined the skill **bodies** — and the four same-day audits (#630, #631, #633, #634) had each pushed content *into* skills as the destination for restructured rules. A layer that keeps receiving content and has never been audited is the next place bloat hides. Triggered by Eugene asking directly whether any of the fourteen could be simplified or consolidated.

## Deltas since the diff base

| Gate | Then | Now | Why it moved |
|---|---|---|---|
| Largest lazily-loaded file anywhere | not measured | **`task-observer`, 72,674 chars → 5,887** | never audited; 1.8× the 40,000-char line that trips Claude Code's oversized-file warning for resident files (the ceiling does not *fire* on a lazily-loaded body, but the scale marker is the same) |
| Resident skill listing | ~950 tok cited for a 9-skill plugin bundle | **~1,820 est. tok for our own 14** | first count of *our* listing as a line item, per step 2's "count the listing, and state your denominator" |
| Layer-3 skill edits | `CLAUDE.md` proven in-pass (#633) | **`~/.claude/skills/` also in-pass** | same test, same result: `~/.claude/skills` is a symlink into `~/Code/tool-settings` (private) — verified by inode, single file, no copy drift |

## Cost — step 2, characters not words

Denominator note: the resident figure is **directory name + frontmatter description** for all 14, which is what the listing actually costs. 7,282 chars ≈ **1,820 est. tok — treat as a floor**, since step 2 records that chars ÷ 4 undercounts skill-listing text (`superpowers` measured 715 tok against a 616 estimate).

| Skill | Resident (name+desc) | Body (on invoke) | Verdict |
|---|---|---|---|
| **task-observer** (global) | 456 | **72,674 → 5,887** | **Restructure — applied** |
| when-to-act-without-approval | 539 | 17,510 | Keep — shipped today (#631) |
| alethical-production-ingestion-refresh | 319 | 15,765 | Keep |
| worktree-triage | 336 | 11,772 | Keep |
| design-build | 415 | 11,668 | Keep |
| workflow-overhead-audit | 574 | 9,939 | Keep |
| design-review | 580 | 8,306 | Keep |
| model-effort | 460 | 8,036 | Keep |
| file-github-issue | 503 | 6,968 | Keep |
| design-audit | 651 | 6,867 | Keep |
| design-intake | 655 | 5,121 | Keep |
| loop-run | 711 | 5,131 | Keep |
| loop-audit | 624 | 4,478 | Keep |
| resume-research-workflow | 460 | 3,669 | Keep |
| **Total** | **7,282 (~1,820 tok)** | **188,806 → 122,019** | −66,787 chars (~16,700 est. tok per `task-observer` invocation) |

The resident total is **unchanged** — deliberately. Two descriptions were trimmed earlier the same day (~229 tok/session recovered); the remaining twelve carry trigger phrases, not body content, which is what a description is for. **This audit's saving is not a per-session saving** and should not be reported as one: it lands only in sessions that invoke `task-observer` — which, per the next section, is exactly the sessions that were paying 18,000 tokens for instructions that were wrong.

## The one restructure: `task-observer`

A vendored third-party skill (Eoghan Henn / rebelytics.com, CC BY 4.0) written primarily for **Cowork**. Its size was the visible problem; the real one was that its instructions **described a different tool**:

| Claim in the skill | Reality here | Count |
|---|---|---|
| Present updated skills with `present_files` | no such tool in Claude Code | 6 |
| Skill files are a read-only mount; writes fail with `EROFS` | writable — a symlink into `tool-settings` | 3 + 1 |
| "Do not edit skill files in place" — stage under `skill-updates/` and have the user upload | contradicts `workflow.md` rule 10's standing grant to apply and ship directly | 5 + 3 |
| Hand off to `skill-creator` | not in this harness | 14 |
| `TodoWrite` checkpoints | now `TaskCreate` / `TaskUpdate` | 3 |
| Handoff-doc mode for environments with no filesystem | never applies | 14 |
| `[workspace folder]` indirection | always the project root here | 21 |

Per step 3, **a stale instruction is a negative-value gate**. This was ~18,000 tokens whose most-used path — the review — instructed the agent to use a nonexistent tool and to ask permission that rule 10 already grants. Two further defects: the numbering shell snippets used `grep -oP`, which **fails on macOS**, and the Quick Reference said "Four layers" of confidentiality where the body defines five.

**Structure now:** `SKILL.md` (5,887 chars) carries what changes behaviour — what to watch for, the numbering protocol with the collision pre-check *and* post-write verify, the log-don't-act gate, and an explicit statement of how this setup actually works. Three references load only when needed: `weekly-review.md` (the procedure, corrected for in-place editing), `publishing-a-skill.md` (taxonomy, licence, attribution, the five confidentiality layers), and `upstream-original.md` — **the unmodified original, verbatim**, which is both the licence-compliance anchor and the diff base for future upstream updates. A `LICENSE` file was added, matching the sibling vendored skill `design-audit`, which ships its upstream MIT licence; `task-observer` previously carried the statement but no file, in violation of its own guidance.

## Three consolidation hypotheses that evidence killed

The most useful output of this audit is what it *didn't* change. Each of these looked like clear duplication from the descriptions alone.

1. **"The two Alethical-specific skills are misfiled in the global directory."** Already investigated and settled hours earlier, recorded in the memory `personal-skills-go-global`: keeping them global is deliberate. Moving them to the repo re-breaks what #214 fixed — a skill invisible on a detached or pre-merge worktree, i.e. exactly when you reach for it — and project-scoped plugin enablement fails the same way because the flag lands in the working tree. Three options were measured and the description-trim was taken instead. **The cross-project waste is the priced cost of branch-independence.**
2. **"`design-review` duplicates `design-audit`'s rubric."** It does not. `design-review` carries a **division-of-labour table** naming, concern by concern, what moves up front and what can only be checked live; the rubric itself exists once, in `design-audit`'s pinned `rules-snapshot-2026-07-13.md`. Verified: **zero shared rule prose** between them. That is a handoff contract, and the description's "applied statically up front by design-review" describes it accurately.
3. **"`loop-run` and `loop-audit` are near-twins that should merge."** Name-normalised, they share **4 identical lines**. Both descriptions name the other and state when to use it instead; both bodies open with a mutual disambiguation section as their *first* content; both are slash-invoked, so selection is usually explicit rather than description-matched. Nothing to merge.

**The lesson generalises:** three of four hypotheses came from reading *descriptions* and inferring duplication behind them. A description is written to be a trigger, not a summary of internals — so description-level similarity is a signal to go read the bodies, never evidence of overlap. All three would have been destructive to "fix."

## Evidence — step 3, what each skill caught

Source: `skill-observations/log.md`, 18 observations (gitignored, not quoted here).

- **`workflow-overhead-audit`** — created *from* Observation 2; its churn-detection step came from Observation 5. Strongest evidence in the set.
- **`model-effort`** — the skill twin that justified removing 9,587 chars (32%) from `~/.claude/CLAUDE.md` in #633.
- **`design-build` / `design-intake` / `design-audit`** — 7 / 7 / 5 observation references.
- **`alethical-production-ingestion-refresh`** — Observations 11, 12, 15.
- **`worktree-triage`** — the #211 → #214 relocation is its own incident record.
- **Zero observations:** `loop-run`, `loop-audit`, `design-review`, `when-to-act-without-approval`, `file-github-issue`, `resume-research-workflow`. **This is not a trim signal for any of them** — four are days old or younger (three shipped today in #630/#631), and silence from a gate younger than the evidence window carries no information. The loop pair is user-invoked by name, which is its own usage evidence. Re-test at the next backstop, when they have history.

## Found, not fixed — flagged for Eugene

Three findings sit outside a skill-layer verdict:

1. **The observation review is 13 days overdue.** `last-review-date.txt` reads 2026-07-13 against a 7-day trigger, with **14 OPEN observations** unapplied. The skill's own preferred mode — a scheduled autonomous review — **was never set up**: `tool-settings/claude/scheduled-tasks/` holds only `monthly-issue-triage` and `workflow-overhead-audit-monthly`. So the only mechanism is CLAUDE.md's 7-day check, which fires only if a session happens to read it and then act. The structural fix is a third scheduled task, not a louder rule. *Not done here:* running the review means adjudicating 14 observations, which is its own job.
2. **`cross-cutting-principles.md` is empty** — "(none yet)" after 13+ days. The Principle Propagation machinery has never produced an entry. Retained in the adapted review procedure, but this is the next trim candidate if it is still empty at the backstop.
3. **Observation 14's `Skill:` field names `verify`, which is not a skill on this machine.** Left alone — the intent is ambiguous (possibly `superpowers:verification-before-completion`) and guessing would corrupt the record.

## Verification

- **Loss check:** every directive removed from `SKILL.md` confirmed present in a reference by literal string match *before* the cut — numbering protocol, renumber-on-collision, archival timing, the 4-item escalation list, lean-content, licence options, attribution template, the five confidentiality layers, built-in enforcement, log-don't-act.
- **Deliberate drops confirmed absent from the live path and intact upstream:** `present_files` (0 in the adaptation except as an explicit "does not exist here" correction / 6 upstream), `EROFS` (0/1), handoff-doc mode (0/14), `skill-updates` staging, `TodoWrite`, upload button.
- **Pointer check (step 3, "verify what your verdict points at is loaded"):** the new `SKILL.md` defers the entry format to `~/.claude/CLAUDE.md` — confirmed by literal grep that CLAUDE.md carries the eight-field format *and* the `skill-observations/log.md` path. The three `references/` files are plain files read on demand, not skills, so no plugin-enablement dependency was created.
- **Integrity of the one data edit:** 13 pre-rename skill names in the observation log (`implementing-design-handoffs`, `design-task-intake`, `web-design-guidelines` — renamed 2026-07-15) corrected to current names. The log is **gitignored, so `git revert` does not cover it**; it was copied to the session scratchpad first. After: 18 observations and 14 OPEN, both unchanged; 0 stale names remain.
- **Concurrency:** all 25 sessions confirmed `isRunning: false` before editing. An earlier stale-cache read reported `task-observer` at its pre-13:20 size; resolved by inode comparison — one file, no divergence.

## Headline

**The skill layer was healthier than the rules layer, and for a structural reason worth keeping: skills are lazily loaded, so they never competed for the resident budget that drove `workflow.md` and `MEMORY.md` to bloat.** Twelve of fourteen needed nothing. The single defect was not one this method would have caught by size or churn — it was **provenance**: a borrowed artifact whose instructions were correct for its origin and wrong here, silently, from the day it was installed. Neither the 40,000-char ceiling (it does not fire on lazy files) nor the churn check (a vendored file nobody edits has none) points at it. **The check that found it was reading a skill's environmental claims against the environment** — does this tool exist, is this path writable, does this contradict a standing rule. That check is now worth running on any vendored or plugin-sourced skill, and it is the third instance of this audit's recurring lesson: *two correct gates can leave a defect in the gap between them.*

Next audit: watch items — (1) whether `task-observer`'s `SKILL.md` stays thin or re-absorbs reference content; (2) whether the observation review gets a scheduled runner, or the 14-OPEN backlog keeps growing — if it does, the capture half is producing evidence nothing consumes; (3) whether `cross-cutting-principles.md` is still empty, the trim trigger for Principle Propagation; (4) the six zero-evidence skills, re-tested once they have history; (5) whether any *other* vendored or plugin-sourced skill makes environmental claims that were never true here — `design-audit`'s pinned snapshot is the one to check first.
