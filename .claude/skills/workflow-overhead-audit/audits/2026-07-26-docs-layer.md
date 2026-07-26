# Workflow-overhead audit — the `docs/` layer (24 docs + research, layer 5) — 2026-07-26

**Net:** the written specs are mostly healthy — 17 of 24 are kept as they are. The real finding is not bloat, it is **wrong facts in the docs sessions actually read**: the most-referenced spec in the repo tells every session that six pieces of work sit on a `v1.1` milestone, and **`v1.1` does not exist** — two of those issues have already shipped and the rest were re-filed to `v2`/`v8`/`v9`. That is the mechanism behind "sessions keep citing old version constraints we aren't following": they are reading it, in writing, from the spec. Fix is to stop docs from asserting *phase as permission* and let them state *status plus blocker* instead — same information, no stale gate.

Layer: **5 — the `docs/` tier**, plus the two layer-1 files today's rule audit did not cover (`CONTRIBUTING.md`, `coding-discipline.md`). First audit of this layer; scope added to the skill in this pass. Diff base: `2026-07-26-skill-layer.md` (same day, layers 1+3).

**Run justified:** four audits landed today (#630, #631, #633, #634, #642) covering rules, skills, memory and the global `CLAUDE.md` — every one of which *pushed content into* or *pointed at* docs, and `docs/` had never been audited. 341,094 chars of markdown with no prior pass is the largest unexamined surface in the repo. Triggered by Eugene asking directly whether docs carry redundancy, non-essential text, and stale version constraints.

## Deltas since the diff base

| Gate | Then | Now | Why it moved |
|---|---|---|---|
| `docs/` as a layer | Out of scope — skill listed 4 layers | **Layer 5, in scope** | Four same-day audits each pushed content toward docs or cited them as the destination; a tier that receives content and is never audited is where bloat and staleness hide next. |
| Largest unaudited file anywhere | `task-observer`, 72,674 chars (fixed) | **`frontend-screen-system-design.md`, 39,736 chars, 0 inbound refs** | Never measured. Not resident, so no ceiling fires — same blind spot the skill-layer audit found in lazily-loaded bodies. |
| Version-scope facts | Not checked by any audit | **6 of 7 claims in the top-referenced spec are wrong** | No audit had ever fact-checked a doc's milestone claims against the tracker. `workflow.md` rule 5 requires it; nothing enforced it. |
| Always-loaded denominator | ~5,313 tok (`workflow.md` alone) | **~7,753 tok (all three rule files)** | `coding-discipline.md` (2,217) and `grounded-answers.md` (7,275) were never counted. `CONTRIBUTING.md` was assumed resident and **is not** — see the correction below. |

## The headline finding: phantom milestones

`docs/grounded-ask-spec.md` §10 (Roadmap notes — deferred upgrades) states: *"#81–84, #87, and #137 are on the `v1.1` milestone."* Checked against the API:

| Issue | Doc says | Tracker says | Consequence |
|---|---|---|---|
| #81 passage-anchor deep links | `v1.1`, deferred | **`v1`**, open | Doc defers work that is in the current milestone |
| #82 answer snapshots | `v1.1` | `v2`, open | — |
| #83 member-level roll-call | `v1.1`, deferred; **gates copy** | **`v1`, CLOSED** | §9.4 forbids "every member, every vote" copy *unless* #83 ships. It shipped. A live copy constraint keyed to finished work. |
| #84 follow-up threading | `v1.1` | `v2`, open | — |
| #87 cross-bill synthesis | `v1.1` | `v2`, open | — |
| #137 thread on answer page | `v1.1` | `v2`, open | — |
| #155 corpus currency | open gap, cited in an **always-loaded rule** | **CLOSED** | `.claude/rules/grounded-answers.md` rule 7 points every session at a closed issue as a live gap. |

**There is no `v1.1` milestone.** Actual milestones: `v0 hardening` (23 open), `v1` (17), `v2` (49), `v8 candidates` (2), `v9 tbd` (1). Two further doc claims are also phantoms — `v1-scope.md` cites an **`Elections` milestone** for #147/#148 (they are on `v8 candidates`), and three docs describe #91 native mobile as **"post-MVP"** (it is on `v9 tbd`).

This is the evidenced core of Eugene's complaint. Sessions are not misremembering; they are correctly reading a doc that is wrong. Per the skill's step 3, **a stale instruction is a negative-value gate** — this is that, in the single most-referenced doc in the repo (18 inbound references).

## The instrument: state-plus-blocker, not phase-as-permission

The naive fix — delete every `v1` / `v1.1` / `post-MVP` mention — would destroy real reasoning. `grounded-ask-spec.md`'s phasing encodes a genuine risk argument ("the vote path stacks the three hardest problems: person resolution, roll-call coverage, signed-out location capture"). That is durable and must survive.

What must go is the **modality**, not the content. Every phase reference resolves to exactly one of three statements:

1. **Shipped** — state it as fact, drop the bucket.
2. **Not shipped, blocked on X** — cite the blocker and the issue, drop the bucket.
3. **Permanent non-goal** — we are never doing this; say so without a version.

Nothing may say *"you may not build this yet because of which bucket it is in."* That phrasing is what `workflow.md` rule 13 already forbids ("milestones only group and report work; they are **not** a defer signal") and what docs keep re-introducing. Rewriting to state-plus-blocker preserves 100% of the directional reasoning, removes the stale gate, and cannot go out of date the same way — a blocker is checkable, a bucket is not.

## Cost — step 2, characters not words

**Read-trigger tiers.** Docs cost nothing until read, so inbound reference count (from `.claude/`, code, CI, other docs) is the cost multiplier that matters, not file size.

| Doc | Chars | Inbound refs | Verdict |
|---|---|---|---|
| **Tier A — load-bearing (sessions read these)** | | | |
| `grounded-ask-spec.md` | 36,818 | **18** | **Trim + de-version** — 6 wrong milestone claims; #83/#155 closed |
| `mvp-redesign-plan.md` | 21,597 | **14** | **Restructure** — running tracker; to-do lists belong in issues |
| `v1-scope.md` | 19,640 | **10** | **Restructure + de-version** — split non-goals from not-yet |
| `ui-copy-guide.md` | 7,136 | 9 | **Trim** — 39-line status preamble exceeds the guide body; cites phantom v1 gates |
| `design-principles.md` | 10,450 | 4 | Keep |
| `bill-search-screen-spec.md` | 10,663 | 3 | Keep |
| **Tier B — on-demand reference (accurate, low-traffic)** | | | |
| `ingestion-pipeline-system-design.md` | 23,803 | 0 | Keep — de-version header only |
| `backend-api-system-design.md` | 17,717 | 0 | Keep — **spot-verified accurate** (see below) |
| `onboarding/data-ingestion-onboarding.md` | 16,256 | 0 | Keep — explicit human-onboarding purpose |
| `db-schema-system-design.md` | 11,225 | 1 | Keep |
| `api-cdn-setup.md` | 10,661 | 1 | Keep — runbook |
| `onboarding/ai-models-and-billing.md` | 9,086 | 0 | Keep |
| `legislator-roster-canonical-membership-spec.md` | 8,991 | 0 | Keep |
| `rag-ingestion-system-design.md` | 8,367 | 0 | Keep |
| `ios-release.md` | 4,510 | 1 | Keep — runbook, correctly labelled |
| `search-bills-plain-english-guide.md` | 4,181 | 0 | Keep — human guide |
| `android-prototype-handoff.md` | 3,405 | 0 | Keep — runbook, correctly labelled |
| `deployment.md` | 3,132 | 0 | Keep — runbook |
| `README.md` | 1,645 | 0 | **Trim** — index; drop archived entries |
| `local-dev-windows.md` | 487 | 0 | Keep |
| `research/*` (3 files) | 37,538 | 1 | Keep — cited by `grounded-ask-spec.md` §10 |
| **Tier C — historical** | | | |
| `frontend-screen-system-design.md` | 39,736 | **0** | **Restructure** — extract live rules, archive the plan |
| `aesthetics.md` | 17,892 | 2 | **Archive** — self-labelled retired |
| `product-notes.md` | 12,355 | 0 | **⚠ Flagged for Eugene** — see below |
| `schema-query-validation.md` | 3,803 | 0 | **Archive** — point-in-time validation report |
| **`docs/` markdown total** | **341,094** | — | ≈ 85,274 est. tok, none of it resident |

**Always-loaded tier (the only per-session cost):**

| File | Chars | Est. tok | Verdict |
|---|---|---|---|
| `.claude/rules/workflow.md` | 21,519 | 5,380 | Keep — restructured today (#631) |
| `.claude/rules/grounded-answers.md` | 7,275 | 1,819 | Keep — **exempt safety rail**; fix stale #155 pointer only |
| `.claude/rules/coding-discipline.md` | 2,217 | 554 | Keep — 4 rules, proportionate, never audited before |
| **Resident total** | **31,011** | **~7,753** | Under the ~40,000-char ceiling |

**Correction to a premise of this audit's own brief:** `CONTRIBUTING.md` (9,919 chars) was scoped as always-loaded. **It is not** — only `CLAUDE.md` and `.claude/rules/*` enter session context. So trimming it has **zero** token value; its only axes are human clarity and drift against the rules that mirror it. Stating this because the brief's success metric assumed otherwise, and a metric measuring the wrong denominator is worse than none.

## Two things evidence killed

Both were plausible headline findings. Neither survived checking, and recording that is the point.

1. **"93 version constraints in the backend design doc."** A grep for version tokens ranked `backend-api-system-design.md` first by a wide margin. Reading them: they are almost entirely **`/api/v1/…` URL paths** — the API namespace, which must not change. Real scope constraints there: ~8. **Grep-count ranking was actively misleading**, and had this audit prioritized by it, the top-ranked "fix" would have been renaming the production API surface.

2. **"Docs say mobile is out of scope while mobile ships."** Six commits since Jul 1 ship mobile UI, against docs that call mobile post-MVP. Checked: those commits are all mobile-**web** (responsive breakpoints), which `v1-scope.md` explicitly includes; **native** iOS/Android is #91, genuinely unstarted, and `ios-release.md` + `android-prototype-handoff.md` both label themselves post-MVP correctly in their opening lines. **The docs were right and the hypothesis was wrong.** The only defect is the label: "post-MVP" should read `v9 tbd`.

A third check confirmed a doc rather than faulting it: `backend-api-system-design.md`'s documented surfaces (`saved-places`, `notification-preferences`, `representative-lookups`, `internal/v1`) all exist in `alethical/api/routers/`. Only the `links` envelope key is absent from serializers — partial drift in one section, not a stale document. Zero inbound references does not mean wrong; it means low-traffic.

## Redundancy — where it is real

`CONTRIBUTING.md` is a deliberate human mirror of `workflow.md` (the rule file says so), so overlap there is by design, not defect. But three sections have **drifted**, and `workflow.md`'s own header says *"when they seem to conflict, CONTRIBUTING.md wins"* — so drift resolves against the machine rule:

| `CONTRIBUTING.md` section | Mirrors | Status |
|---|---|---|
| Categorizing an issue | rule 4 + skill `file-github-issue` | **Contradicts.** Lists milestones `v0 hardening/v1/v1.1/v2/Elections` — two of which don't exist, two real ones missing. Says *"the milestone is the single source of truth for phase"*; rule 13 says milestones are **not** a defer signal. By the precedence header, the stale doc wins — so a session reading it defers `v2` work. |
| Keeping docs current | rule 6 (screenshots) | Near-verbatim duplicate. Trim to a pointer. |
| Writing cross-references | rule 8 | Near-verbatim duplicate. Trim to a pointer. |
| Share branches, not file copies | rule 3 | Near-verbatim duplicate. Trim to a pointer. |
| Effort labels (`effort: small/medium/large`) | board `LOE` field | Two vocabularies for one axis; needs reconciling against the 8-axis scheme. |

## ⚠ Flagged for Eugene — not actioned

**`docs/product-notes.md` (12,355 chars, 0 inbound references)** is an unedited meeting-notes dump in a **public repository**. It contains a named third party's campaign for Lieutenant Governor, who is personally funding development, specific dollar figures discussed for contractor budgets, named individuals, and monetization plans. It also describes a product that no longer exists (Base44, App-Store-first MVP, promise-vs-vote scoring, multi-model adjudication — all now explicitly out of scope).

Archiving it in place does not address this: the repo is public either way, and `git` history retains it regardless. **This needs your decision, not a default** — the options differ in kind (leave · archive with a header · remove from the working tree · history rewrite), and only you can weigh what the named person would expect. It is the one item in this audit I have not moved.

> **Addendum, 2026-07-26 (same day).** Eugene's call: **remove.** The file is deleted from the working tree and dropped from the docs index ([#647](https://github.com/alethical-org/alethical/issues/647)). Not archived — archiving would have kept it discoverable in the tree, which was the concern. Note for the record that `git` history still contains it: removal changes discoverability, not the historical record, and a history rewrite was not requested.

## Verdicts to apply — staged

PR 1 (this record) changes no doc content. Then, in order:

1. **Stale-fact fixes** (zero-judgment, pure corrections): the six milestone claims in `grounded-ask-spec.md` §10; `#83`/`#155` marked closed; the `Elections` and "post-MVP" labels; `grounded-answers.md` rule 7's closed-issue pointer; `CONTRIBUTING.md`'s milestone list and the rule-13 contradiction.
2. **Archive moves**: `aesthetics.md`, `schema-query-validation.md` → `docs/archive/` with superseded headers; drop from `README.md`'s index.
3. **De-versioning**: apply state-plus-blocker across Tier A + the Tier B headers.
4. ~~**`CONTRIBUTING.md` de-duplication**: three mirrored sections → pointers.~~ **Withdrawn during the same pass.** The verdict optimized for de-duplication, an axis that does not apply here: the file is not resident, so collapsing prose to pointers saves **zero** tokens, and `workflow.md`'s own header establishes the mirror as deliberate ("machine-facing counterparts of the human conventions in `CONTRIBUTING.md`"). Replacing readable contributor guidance with "see rule 6" would degrade the human doc to satisfy a metric it was never costed against. The real defect was **drift, not duplication** — the milestone contradiction — and that is fixed in step 1. Recorded rather than silently dropped, because a dedup verdict that ignores whether the file is loaded is a mistake this skill's step 2 is supposed to prevent.
5. **`frontend-screen-system-design.md`** — **revised on inspection from "archive the plan" to "trim in place."** The three sections assumed to be homeless were checked individually, and only one is: **Bill Detail Content Rules** (which AI briefing blocks the bill page shows by default, which are chat-only, and the seeded prompts) is a real product decision with no other home. The other two do not justify a re-homing exercise — Global Empty/Loading/Error States is three ASCII sketches now covered as a principle in `docs/design-principles.md` and as copy review in the `design-review` skill, and Cross-Platform Interaction Rules is six bullets that are mostly shipped and partly **stale** (it says tracked toggles update optimistically; tracking is now an inert dashed roadmap preview). Archiving 39,736 chars to rescue one section would have been the larger, riskier edit. Trimmed instead: the completed "Validation Against V1 Scope" checklist, the three release-tier lists (the actual phase-as-permission), and a "Recommended Next Step" whose four items have all shipped — with a status header naming what the shipped IA superseded. Net −112 lines, the durable Implementation Guidance kept.
6. **`v1-scope.md` non-goal split** — **gated on Eugene's confirmation.** Separating permanent non-goals ("never doing promise-vs-vote scoring") from not-yet sequencing ("no native apps in the first release") is the one judgment in this audit where a wrong call silently deletes a real product boundary. The enumerated split goes to him before rewriting.

   > **Addendum, 2026-07-26 (same day).** Sorting confirmed by Eugene and applied ([#646](https://github.com/alethical-org/alethical/issues/646)). It went out as a **three**-way split, not two: inspecting the ~50 items surfaced a third category the original plan missed — **standing engineering defaults** ("Postgres FTS until measurement says otherwise"), which are neither permanent non-goals nor sequencing. Relabelling those as "not yet" would have *weakened* them, which is why the gate was worth keeping. Each now carries an explicit revisit trigger. The file was also renamed `v1-scope.md` → `product-scope.md`, since after de-versioning the filename was the last stale label on it; 11 inbound references updated, dated audit records left as-is.

## Verification

- **Milestone claims:** every version assertion in Tier A checked against the live API (`/milestones`, `/issues/{n}`), not memory — `workflow.md` rule 5.
- **Reference counts:** computed by grepping every `docs/<file>` path across `*.md`, `*.py`, `*.ts`, `*.tsx`, `*.yml`, excluding self-references and `node_modules`.
- **Resident-vs-not:** confirmed from the session's own loaded-context reminder — three rule files, no `CONTRIBUTING.md`.
- **Two hypotheses falsified** before they became findings (above). Neither reached a verdict.
- **Exempt rails untouched:** `grounded-answers.md`'s nine invariants are unchanged; only its pointer to a closed issue is queued for correction. No prohibition moved anywhere.

## Headline

Docs were not bloated — they were **stale in exactly the places sessions read**, and the correlation is the finding: the four most-referenced docs hold nearly every version constraint, while the eleven with zero inbound references are mostly accurate and cost nothing. Bloat metrics would have sent this audit at the 39,736-char file nobody reads; **reference count sent it at the 36,818-char file everyone reads, which was wrong six ways.** For a lazily-loaded layer, traffic is the cost multiplier — measure what gets read, not what is large. And the mechanism behind "old version constraints keep resurfacing" turned out to be mundane: the tracker moved five issues and closed two, and no doc followed, because nothing in the pipeline fact-checks a doc's milestone claim. State-plus-blocker phrasing removes that failure mode structurally — a blocker can be verified, a bucket cannot.

Next audit: diff against this table. Watch items — (1) whether `grounded-ask-spec.md` re-accretes phase labels after the de-versioning; (2) whether `mvp-redesign-plan.md`'s to-do checkboxes regrow after moving to issues (the rule-10 regrowth pattern: content returns when it has nowhere else to live); (3) whether `CONTRIBUTING.md` drifts from the rules again — the precedence header makes its drift authoritative, which is a trap worth re-testing; (4) whether any Tier B doc's spot-check starts failing, which would flip it from Keep to Archive.
