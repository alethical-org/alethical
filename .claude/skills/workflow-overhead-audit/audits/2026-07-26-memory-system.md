# Workflow-overhead audit — the memory system (layer 4) — 2026-07-26

**Net:** the file of one-line reminders that loads at the start of every Alethical session had quietly become a filing cabinet — most of its lines had grown into paragraphs, and three of them were the *only* place certain facts were written down at all. Rewriting it back into actual one-liners cut it in half (19,048 → 9,493 chars, ~2,389 fewer tokens every session) without dropping a single memory. Nothing was deleted except one note that says, in its own text, that its job is finished.

Layer: **4 (the memory system)**, audited for the first time — and added to this skill's scope by this audit. Diff base: `2026-07-26-global-claude-md.md` (same day, layer 3), whose closing watch-item #4 asked for exactly this and left the scope question open.

**Run justified:** `MEMORY.md` was **~4,762 of the ~19,355 always-loaded est. tokens in this repo — roughly a quarter — and the only always-loaded file never examined.** The three rules files and the global `CLAUDE.md` were all audited earlier the same day (#630, #631, #633).

## Deltas since the layer-3 audit (same day)

| Gate | Then | Now | Why it moved |
|---|---|---|---|
| `MEMORY.md` | 19,048 chars, **out of scope / undecided** | 9,493 chars, **layer 4, in scope for cost** | Watch item #4 resolved: audited jointly with `consolidate-memory` (below) |
| Largest always-loaded file | `~/.claude/CLAUDE.md`, 27,364 | unchanged, 27,364 | untouched here by design — audited same day |
| Always-loaded total (this repo) | 19,355 est. tok | **16,967 est. tok** | −2,388 tok/session, all from `MEMORY.md` |
| Layer-3 watch item: model/effort re-accretion | — | still a pointer, no regrowth | 0 days elapsed; re-check next audit |

## The scope question, settled

**Both methods apply, on different axes; neither alone was sufficient.** Recorded in this skill's Scope section so the next audit inherits the answer.

- **This audit owns cost.** `MEMORY.md` is always-loaded, so it belongs in the same per-session token budget as the rules cascade. That the memory system is a different *mechanism* — recall arriving in `<system-reminder>` blocks, frontmatter `type`s — is a reason to handle its content differently, not a reason to leave a quarter of the budget uncounted. Nobody was counting it, which is why it grew.
- **`consolidate-memory` owns content and format.** It carries what this method lacks: merge/retire rules, the durable-vs-dated split, absolute-date conversion, and a concrete index budget (≤200 lines, ~25 KB, **~150 chars per line**).

**The finding that settles it:** at 19,048 chars `MEMORY.md` was under this audit's ~40,000-char ceiling *and* under consolidate-memory's ~25 KB index budget. **Neither gate fired.** Yet 92% of its lines were over consolidate-memory's ~150-char line, and three memories' key detail existed *only* in the always-loaded index. Two thresholds each satisfied, with the defect sitting in the gap between them — so when one always-loaded file is governed by two methods, audit the **interaction**, not each threshold in isolation.

## Cost — step 2, characters not words

Word count would have said 2,662 for `MEMORY.md` and understated by **~40%** — the worst gap yet measured (previous: ~35% for `workflow.md`, ~13% for `CLAUDE.md`). Index lines are almost pure markdown scaffolding — `- [Title](file.md) — ` is ~76 chars of brackets, parens and a path per line, and `wc -w` sees barely any of it.

| Item | Bytes before | Bytes after | Est. tok saved | Verdict |
|---|---|---|---|---|
| `MEMORY.md` — 76 index lines (**99.9%** of the file) | 19,031 | 8,958 | **−2,518** | **Restructure — applied** |
| `MEMORY.md` — header + section scaffolding | 18 | 536 | +130 | Keep (8 new topic headings, + a two-line statement of what the index is for) |
| **`MEMORY.md` total (always loaded)** | **19,048** | **9,493** | **−2,389** | — |
| The memory files themselves (77 → 76; lazily recalled, 0 resident) | 226,883 | 227,320 | 0 resident | Keep — see below |

`MEMORY.md`'s share of this repo's always-loaded context: **24.6% → 14.0%** (77,423 → 67,868 bytes; 19,355 → 16,967 est. tok).

**Denominator caveat, worth stating because it changes the picture.** Those figures count always-loaded *files* only. Cross-checked against the same-day `/doctor` pass, which measured the resident **skill listing** too: the true always-resident total was ~21k est. tok, dropping to ~19.2k once that pass disabled two bundled plugins. So `MEMORY.md`'s real share was nearer 23% → 12%. Two lessons folded into step 2: **count the skill listing**, and prefer `claude plugin details <name>` over chars ÷ 4 for it — the tool reports `~715 tok` for `superpowers` where the chars-based estimate said 616, so this record's byte-based savings are a sound **floor** and the true saving is somewhat larger than 2,388.

**Ceiling:** 9,493 chars vs the ~40,000-char line — **far under, before and after.** As on layer 3, the automatic trigger never fired; every verdict here rests on evidence.

Corpus totals: 245,931 → 236,813 bytes across 78 → 77 files. (`du` reports 384 KB — that's disk blocks on 4 KB allocation, not content; use `wc -c`.)

## The restructure: the index had become the write surface

The memory format calls for *"a one-line pointer (`- [Title](file.md) — hook`)"* and states plainly that `MEMORY.md` must never hold memory content. Measured against that:

| Metric | Before | After |
|---|---|---|
| Index lines | 76 | 76 |
| Over ~150 chars | **70 (92%)** | **0** |
| Average line | 246 | 114 |
| Longest line | 520 | 126 |
| Memories on disk but missing from the index | 1 | 0 |
| Memories whose key detail existed **only** in the index | 3 | 0 |
| Index cross-links (`[[…]]`) absent from the file they point at | 3 | 0 |

The last three rows are the real finding, and they explain the first: **the index was being used as overflow storage.** The expensive always-resident layer was holding what the free lazily-loaded layer should hold — the mechanism exactly inverted. This is the same root cause as `workflow.md` rule 10's 6.9× regrowth (`2026-07-26-workflow-rules.md`): content accretes into whatever file the author had, and compression alone never fixes that. Hence **restructure, not trim** — per step 4, the correct treatment for a gate whose bloat has a *placement* cause.

Proof it was overflow and not duplication, resolved from primary sources:

1. **`effective-date-extractability`** — the index named `resolve_effective_date()`, `bill_effective_dates()` and PR #598; **none of the three appeared in the file.** All four helper names verified live in `alethical/api/routers/public.py` (lines 754/921/956/977), and #598 confirmed merged. So the *index was newer than the memory it indexed* — someone recorded a refactor in the pointer and never in the file. Fixed: the file now describes the current three-function shape (pure tier logic shared by the detail path and the list path, so a search card and the bill page cannot disagree).
2. **`alethical-frontend-load-perf`** — the index claimed "TRUE-instant needs region co-location (#364) + SSR (#502)". **#364 is closed** (2026-07-22) and the file itself records region co-location as done and deployed (#514). The always-loaded line contradicted its own lazily-loaded file. Fixed in the hook; the file was already correct.
3. **Three `Related [[…]]` cross-links** existed only in index lines, so the graph they describe was invisible to anything that opened the file. Pushed into the bodies of `optimize-models-for-quality-and-speed`, `advise-model-effort-and-self-optimize`, and `delegate-to-sessions-to-save-context`, each with a clause distinguishing the two memories rather than a bare link.

Every index line was machine-checked before rewriting: for each, the distinctive tokens in its hook (backticked identifiers, `#NNN` refs) were matched against the target file, and **only the 3 genuine gaps above were closed by writing the detail down first.** After the rewrite: all 76 pointers present, none lost, none added, no duplicates, no file unindexed, no pointer dangling.

## Per-item verdicts — the 77 memory files

| Item | Chars | Verdict | Evidence |
|---|---|---|---|
| `autonomous-small-prs` | 20,469 | **Keep** (watch) | Bigger than `MEMORY.md` was, 11 dated clauses — but **lazily loaded, so 0 resident cost**, and the step-3 skill-twin check *cleared* it: `when-to-act-without-approval` carries the handback catalogue as a compressed table, yet **10 of the 12 PR numbers that codified these grants appear nowhere in the skill** (#631/#525/#493/#346/#340/#207/#210/#198/#195/#186 — all 0 hits). This file is the sole record of which PR bought which grant. Trimming it would destroy provenance to save nothing resident — and the skill's own anti-pattern list forbids trimming a gate that can name its incident. Its newest clause already declares it *history*; that is the right role. |
| Model/cost trio — `advise-cheaper-faster-frontier-upfront`, `advise-model-effort-and-self-optimize`, `optimize-models-for-quality-and-speed` | 15,074 | **Keep separate** | Looks like the classic merge candidate — three `feedback` memories on one topic. It isn't: they are a chain, not a duplication. One is the *objective* (cheapest total cost that holds quality), one the *execution lever* (subagent delegation — the only mid-session tier change), one a hard **⛔ EMERGENCY STOP** gate on whether to launch at all. Layer 3's audit kept that stop resident in `CLAUDE.md` for the same reason. Merging would blur a stop into a preference. Cross-links added instead, so the chain is navigable. |
| Frontend-QA cluster (4 files) | 16,921 | **Keep separate** | Distinct procedures, not restatements: which deployed surface lies about its data · read-only API against prod · full web export with a same-origin proxy · the freeze-the-query trick for data-gated layouts. Each is a different task. |
| `karpathy-global-install-deferred` | 1,094 | **Drop — applied** | Retired. Fully resolved 2026-07-13; **absent from the index**, so zero resident saving — removed for correctness, not size. Its own body says the install is done and *"do NOT prompt Eugene about a global install again"*, and the global `CLAUDE.md` verifiably carries all four coding-discipline principles today. A recalled memory whose headline framing is a 2026-07-07 deferral is a live mis-action risk. Restorable from the backup; quoted here per the constraint that anything removed be recoverable. |
| `quad-means-claude-voice-typo` | 835 | **Keep, repaired** | Format defect: `name: ""` (empty) and **no `description:` at all** — and `description` is what recall matches on, so this memory was effectively unrecallable except through the index line. Also the only file missing `metadata.type`. Name, description, and `type: user` filled in. |
| Remaining 72 files | ~172,000 | **Keep** | Lazily loaded, 0 resident cost; each names a specific trap, incident, or prod-verified fact. No stale repo path found (below). |

## Verification

- **Loss check:** 76 pointers before → 76 after; set difference empty in both directions; no duplicate pointer; every file on disk indexed; every pointer resolving. All 3 index-only facts written into their target files **before** the index line was shortened.
- **Fact check (rule 5 / rule 9, primary sources):** every repo path cited across all 77 memory files was existence-tested — **zero stale paths**; the apparent misses were regex artifacts (`~/`-prefixed skill paths, GitHub URL fragments). All four effective-date helpers confirmed in `public.py`. Issue states confirmed via `gh`: #598 merged, #364 closed, #502 open. Every **rule-N citation** across the corpus (24× rule 10, plus rules 1–9 and 13) checked against the current 13-rule `workflow.md` and the 9-rule `grounded-answers.md` — all resolve correctly, including the three that cite `grounded-answers` rather than `workflow`. Today's rule-10 restructure (#631) is already recorded accurately in `autonomous-small-prs`.
- **Revertability:** a full directory copy was taken before any edit, verified byte-identical with `diff -rq`. **Superseded the same day by real version control** (below): the pre-audit state is committed as `tool-settings@6c46762` and this audit's changes as `e5c5672`, so the restore path is now `git revert e5c5672` and the loose backup folder has been deleted rather than left to rot as a stale shadow. No memory content is quoted in this record — this repo is public and memory files carry personal detail.
- **Not touched:** the three `.claude/rules/` files and `~/.claude/CLAUDE.md` (all audited earlier today, #630/#631/#633); the three live sibling worktrees and `redesign/design-system`'s unpushed work.

## Versioning — recommended, approved, and done the same day

Eugene approved it and asked how it would be kept current going forward. Both memory directories (Alethical, 77 files; CommercialDeals, 3) are now symlinks into `~/Code/tool-settings`, the private `euglopi/tool-settings` repo — the same arrangement as `~/.claude/CLAUDE.md`, so there is still exactly one copy of each file. **Layer 4's verdicts are therefore applied in-pass from now on, on the same grounds as layer 3.**

Three details worth recording, each established by test rather than assumption:

1. **Writing through a symlinked *directory* works.** The known restriction — Edit/Write refuse to write to a path that *is* a symlink, which is why `CLAUDE.md` must be edited at its real path — does not apply here: the symlink is the parent directory and the memory files themselves are ordinary files. Verified with both tools before the move; a created file lands as a regular file in the real directory. Had this failed, versioning would have broken memory writing outright, so it was the gating check.
2. **The pre-audit state was committed first, deliberately.** `6c46762` is the memory corpus as it stood before this audit; `e5c5672` is the audit itself as a reviewable 11-file diff. That ordering means git history now carries what the hand-rolled backup carried, so `git revert e5c5672` restores the pre-audit state and the loose backup folder could be deleted instead of becoming the stale shadow `workflow.md` rule 3 warns about.
3. **Session transcripts stayed put.** Only the `memory/` subdirectories moved, so the ~850 MB of `*.jsonl` beside them never enters git and no ignore rule is needed. The README's old "machine state, not settings" exclusion bundled transcripts with memory; that bundling was the actual error, and it is now corrected there.

### Keeping it current — two committers, disjoint paths

The reconciliation problem is real: memory files are written by the auto-memory system as a *side effect*, at unpredictable moments, from any of ~10 parallel sessions. No session owns the write, so without a mechanism the repo would look version-controlled while its history silently stopped covering reality — worse than not tracking it, because it invites confidence in a restore path that isn't there.

| Path | Committed by | When |
|---|---|---|
| `claude/CLAUDE.md` | the session that edited it, `git add` **path-scoped** | immediately, message says what changed and why |
| `claude/projects/**/memory/` | `bin/commit-memory.sh` via launchd (`com.eug.tool-settings-memory`) | every 15 min, only when something actually changed |

**This preserves Eugene's earlier decision rather than reversing it.** He had explicitly chosen per-edit commits over scheduled auto-commit for `CLAUDE.md`, so each commit ties to a real reason instead of producing "auto-commit" noise (recorded in the `commit-claude-md-edits-immediately` memory). That reasoning still holds where it applies — a `CLAUDE.md` edit is a decision, with an owner who can explain it — and it is left untouched. It simply cannot apply to memory files, where there is no owning session and often no moment worth narrating; the real choice there is auto-commit or no history at all. His objection is honoured in the two ways that were actually available: the job **makes no commit on a quiet day** (it is change-triggered, not a daily heartbeat), and each subject **names the memories touched** — `Memory: update effective-date-extractability, retire karpathy-global-install-deferred` — so the log reads without opening diffs.

Design points that came from testing it, not from sketching it:

- **Single writer, atomic lock.** macOS has no `flock`, so the guard is `mkdir` on `/tmp/tool-settings-memory.lock`, with a >10-minute staleness check to clear a lock orphaned by `kill -9`.
- **Detect before staging.** It checks `git status --porcelain` and only stages once it has decided to commit, so a concurrent session commit cannot sweep half-staged memory files into a message about something else.
- **One-minute quiet period.** If any memory file was written in the last minute a session may be mid-burst, so it defers to the next run rather than splitting one logical change across two commits.
- **Commit always, push best-effort.** History is safe locally the moment it commits, so a network or credential failure must not resemble data loss. A failed push retries once behind `pull --rebase --autostash` — which is exactly what losing a race with a session's `CLAUDE.md` push looks like — and otherwise logs `WARN … will retry next run`.
- **Verified paths:** clean tree → silent no-op; recent write → skip with nothing staged and the change intact; elapsed → commit with a generated subject, then push (all three confirmed, plus a clean `launchctl kickstart` run proving it executes under launchd with exit 0 and no stderr).

**`~/.claude/settings.json` joined the same arrangement later the same day**, prompted by the `/doctor` session: its `enabledPlugins` decides which skills exist at all, so it was the last always-loaded input with no history — a change there could alter behaviour with nothing to diff or revert. Two checks before moving it, both of which could have stopped it: its only secrets-scan match is the *deny rule* `Bash(gh secret:*)` (a permission pattern, not a credential), and an app write through the symlink **preserves** the symlink rather than replacing it with a regular file — the temp-file+rename behaviour that would have silently orphaned the repo copy while the live file drifted. It is job-owned rather than session-owned, because preference toggles and plugin commands write it without any session narrating the change.

Health check, and the off switch — turning it off loses nothing already committed and memory keeps working, it just stops gaining history:

```bash
tail ~/Library/Logs/tool-settings-memory.log
```

```bash
launchctl bootout gui/$UID ~/Library/LaunchAgents/com.eug.tool-settings-memory.plist
```

## Headline

`MEMORY.md` was **half the size of `workflow.md` and had the identical disease**: not verbosity, but *placement*. Every line that grew past its hook grew because the index was the only place its author had to write. Two independent budgets were watching the file — this audit's 40,000-char ceiling and `consolidate-memory`'s 25 KB index budget — and **both read green while 92% of lines breached a third rule neither was checking.** A size ceiling cannot catch a structural defect; only reading the thing against its own stated format can.

The most useful artifact is the pair of checks that found it, both now cheap to repeat: **(1)** match each index hook's distinctive tokens against the file it points at — an index-only fact means the resident layer is doing the lazy layer's job; **(2)** verify a big memory against its *skill* twin before trimming it, which this time argued for **keeping** a 20,469-char file, because the skill had the lessons but not the provenance.

Next audit: watch items — (1) whether index lines creep back over ~150 chars, the direct regrowth signal, and whether new detail again lands in the index instead of a file; (2) whether the launchd committer is still healthy — `tail ~/Library/Logs/tool-settings-memory.log` and confirm `git log` on `claude/projects/` is not weeks behind the files, since a silently-dead job leaves the repo looking versioned while the history stops; (3) `autonomous-small-prs` — whether it stays history or starts accreting operational detail that belongs in `when-to-act-without-approval`; (4) layer 3's own watch items, untested here (model/effort re-accretion, `CLAUDE.md` anecdote count past 4).
