# 2026-08-31 — cross-layer duplication between the personal rules and this repo's rules

Net: **3 duplication hypotheses were tested and all 3 were killed, and the pass's
real finding was the opposite of what it went looking for** — the largest
"duplicate" is load-bearing, nothing was checking it for drift, and now a CI step
does. No text was trimmed. Total always-loaded instruction budget measured at
**63,297 est. tok** before any work begins.

Triggered by a `/context-audit` run the same day, which mapped and measured the
load surface and routed the keep/trim/drop judgment here, per that skill's own
split of labour. Not a scheduled run; none exists.

## Gate check — did anything move since the last record?

Required before running, per this skill's "never run it blind" rule.

| Layer | Since `2026-07-26` | Verdict |
|---|---|---|
| Repo process (`.claude/`, `.github/workflows/`, `CONTRIBUTING.md`) | 155 commits | moved |
| Personal + memory layers (`tool-settings`) | 253 commits | moved |

Gate passes. This is not a restatement.

## Diff against 2026-07-26

| Gate | Then | Now | Why it moved |
|---|---|---|---|
| `workflow.md` rule 10 share | 67% of the file, flagged as regrowth after a trim | **41.9%** (18,711 of 44,619 chars) | The #631 restructure held. Still the largest rule by 2.9× over rule 5, but it has not regrown to the level that triggered the last restructure. Keep and watch. |
| Personal-rules "Coding-discipline rules" | Keep, 2,242 chars | **Keep, 2,190 chars** | Re-tested on new grounds (below) and the verdict survives unchanged. |
| Sync between `AGENTS.md` and rule 10 | not audited | **guarded by CI** | Newly identified as load-bearing duplication with nothing protecting it. |

## The 3 hypotheses, and why each died

Each was put through this skill's `comm -12` identical-line kill-test after
name-normalising both bodies. **All 3 returned 0 identical lines.** Because all 3
came from reading content rather than descriptions, a byte test alone was not
enough to dismiss them, so each also got a concept-level test.

### 1. `AGENTS.md` "Hard lines" (6,459 chars) vs `workflow.md` rule 10's git prohibitions

**Concept test: genuine, total overlap.** All 9 dangerous operations are named in
both files — `reset --hard`, `clean -fd`, `checkout .`, `git stash`,
`update-ref`, `worktree remove --force`, `ignore-other-worktrees`, Apple's
`/usr/bin/git`, and creating a branch in the shared checkout. Different prose,
identical coverage. `AGENTS.md` opens by calling itself "a map, not a copy",
which is what made this the strongest of the 3 hypotheses.

**Verdict: Keep, and the duplication is deliberate.** `AGENTS.md` line 35 carries
its own answer: "Claude Code loads this file and everything in `.claude/rules/`
into every session automatically; **every other agent must open them itself**."
So for Codex, Cursor, and anything added later, the `AGENTS.md` copy is the only
one reliably in context. Trimming it would have left every non-Claude agent
without the prohibitions that stop it destroying other sessions' uncommitted
work. This is the same "only copy where it matters" ground the 2026-07-26 record
used to defend the autonomy section, arriving one layer down and from a direction
that looked nothing like it.

### 2. Personal rules "Coding-discipline rules" (2,190 chars) vs `workflow.md` rule 14 (1,562 chars)

**Concept test: all 4 concepts in both** — think before coding, simplicity first,
surgical changes, goal-driven execution.

**Verdict: Keep.** The personal-rules copy self-labels as the fallback for repos
without their own, and that fallback is live: of the projects under `~/Code`,
only Alethical has a `.claude/rules/`. CommercialDeals, CommercialDeals-pricing-page,
aiscaledev and tool-settings have none, so trimming here would silently strip the
discipline rules from 4 real projects to save ~550 tok in the 1 project that
already has its own copy. Re-confirms the 2026-07-26 verdict on new evidence.

### 3. Personal rules "How a change ships (any project)" (1,374 chars) vs `workflow.md` "How we work — the shape"

**Verdict: Keep**, on identical grounds to hypothesis 2. The section's own title
says "any project", and it is the only release loop those 4 other projects have.

## The finding that came out of it: nothing guarded the deliberate copy

Once hypothesis 1 resolved to "deliberate, and load-bearing for every non-Claude
agent", the risk inverted. The danger is no longer that a copy exists; it is that
the 2 copies drift, or that some future pass makes exactly the trim this one
nearly made. Measured on the day: **in sync on all 9 operations, 0 drift.**

Shipped `scripts/check_shared_checkout_rules_in_sync.py`, wired into the
`changes` CI job beside the other document checks. It fails the build if either
file stops naming any of the 9. Mutation-checked before commit: removing 1
operation from `AGENTS.md` fails it with a message naming the operation and the
file, and the check passes again once restored.

Free per run, and per the standing preference for prevention over a reminder
somebody has to read, it removes the cause rather than reporting it.

**Its honest limit, written into the script's own docstring:** it checks a fixed
list, so it catches a copy being trimmed or reworded past recognition, and does
**not** notice a brand-new 10th prohibition added to only one file. Adding an
operation to the list is part of adding the prohibition.

## Measured load — what a session pays before any work

| Layer | Chars | Est. tok |
|---|---|---|
| Personal rules (all 3 tools) | 117,907 | 29,476 |
| `.claude/rules/workflow.md` | 47,218 | 11,804 |
| `.claude/rules/grounded-answers.md` | 40,712 | 10,178 |
| `MEMORY.md` index | 14,769 | 3,692 |
| Skill listings (28 personal + 8 repo) | 18,819 | 4,704 |
| `AGENTS.md` | 12,513 | 3,128 |
| SessionStart roadmap message | ~1,250 | 312 |
| **Total** | **253,188** | **63,297** |

Denominator includes the skill listings, per this skill's instruction to say so.

**Ceiling check:** `workflow.md` at 47,218 chars is **over** the ~40,000-char
line that trips Claude Code's own oversized-file warning; `grounded-answers.md`
at 40,712 is just over it too. Both are flagged here rather than acted on: rule
10 is at 41.9% and falling relative to its last audit, and the exempt safety
rails inside both files are a large share of what would have to move. Re-test at
the next pass, and prefer restructure over trim if either grows again.

## Layer-4 note

`MEMORY.md` is 136 lines / 106 files, under this skill's ~150 trigger for a
content pass, so none was run. The same-day context audit corrected 8 stale
paths, 1 retired milestone and 1 retired label set across 6 memory files; those
were factual repairs to existing files, not merges or deletions, so the
proposal-only limit on retiring a memory was not engaged.

## Anti-patterns avoided

- **No gate was trimmed that can name its incident.** All 3 candidates could.
- **No verdict from vibes.** Each hypothesis got the kill-test and a concept
  test, and the 2 that survived the byte test died on measured evidence about
  which projects load which file.
- **The pass did not end at "nothing to do."** The correct result of killing 3
  hypotheses was finding the unguarded assumption underneath the biggest one.
