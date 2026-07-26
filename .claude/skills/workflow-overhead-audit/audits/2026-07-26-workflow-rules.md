# Workflow-overhead audit — `workflow.md` rules 4 / 10 / 13 — 2026-07-26

**Net:** the rulebook Claude reads at the start of every session had grown to 47,782 characters — past the size where Claude Code itself warns a file is too large — with **one rule taking 68% of it**. That rule also *opened* by stating the opposite of what its own later clauses grant, so a quick read got the wrong answer. Restructured: the permission and the safety lines stay always-loaded, the per-domain verification checklists moved into a skill that loads on demand. **File is now 21,253 chars — 56% smaller, nothing lost.**

Task type: **rule-file overhead** (not the design pipeline — first audit of this type). Diff base: `2026-07-13-design-pipeline-recheck.md`.

**Run justified, not blind:** 67 commits touched gate files since the Jul 13 record; 41 touched `workflow.md` alone. First audit run with the char-based costing, the ~40,000-char ceiling, and the `restructure` verdict added earlier today ([#630](https://github.com/alethical-org/alethical/pull/630)).

## Deltas since the Jul 13 re-check

| Gate | Jul 13 verdict | Now | Why it moved |
|---|---|---|---|
| `workflow.md` rule 10 | **Trim — consolidate** (applied same day, 807 → 718 words) | **Restructure — applied** | The trim did not hold. Rule 10 regrew to **32,121 chars (4,969 words) — 67.7% of the file, 9.3× the next-largest rule** in 13 days, across 21 commits. Trim was the wrong instrument: compression fails when every new directive still has nowhere else to land. |
| `workflow.md` (whole file) | Keep, "~1.2k words injected per session" | **Over the hard ceiling → restructure** | 47,782 chars vs the ~40,000-char oversized-memory-file line (`getMaxMemoryCharacterCount`). The Jul 13 audit had no absolute threshold and so could not see this; the ceiling was added to the skill today. |
| Rule 10's **opening paragraph** | Not separately assessed | **Negative-value — fixed** | It read *"if it touches app/backend/production code … propose first and get an explicit yes"* — **contradicting the 14 clauses below it**, all of which grant the opposite. A hurried read of the rule's own lead produced exactly the handbacks the later clauses were added to prevent. This is the skill's "stale instruction = negative-value gate" case, found in the rule's most-read sentence. |
| `workflow.md` rules 4, 12 | Keep | **Restructured earlier today** ([#630](https://github.com/alethical-org/alethical/pull/630)) | Board-categorization mechanics → skill `file-github-issue`; research checkpoint/resume mechanics → skill `resume-research-workflow`. Prohibitions kept resident. |
| Unused plugins `linked-intent-dev`, `arrow-maintenance` | `linked-intent-dev` dropped (local scope) | **Both dropped at user scope** | A `/doctor` pass found both still enabled in `~/.claude/settings.json` — so off in Alethical but on in every other project. 1 lifetime use and 0 respectively. |

## Decision table — this audit's scope

| Gate | Chars (before → after) | % of file | Evidence it can name | Verdict |
|---|---|---|---|---|
| **Rule 10** — autonomy lane | 32,121 → **5,950** | 67.7% → 28.0% | Every clause traces to a real handback (the catalogue is now in the skill). Value intact; **form** was the problem. | **Restructure** |
| **Rule 4** — route knowledge / board | 3,472 (unchanged) | 7.3% → 16.3% | #416 (uncategorized issue slipped in), #629 (board views rearranged by an option restructure). | **Keep** — restructured hours earlier in #630; churn predates that. |
| **Rule 13** — staff every goal-supporting issue | 3,114 (unchanged) | 6.6% → 14.7% | #483, #520, #550, #551 (delegations); the Jul 22 #520 late-discovery that produced the "message back when finished" clause. | **Keep** — names four incidents, and 14.7% is proportionate. Trimming a gate that can name its incident is an anti-pattern. |
| **File total** | 47,782 → **21,253** | ⚠ over ceiling → **under** | — | — |

Est. resident context: **~11,945 → ~5,313 tokens/session** (−6,632, a 56% cut on this file).

## The restructure: what moved, what stayed

The 26 directives in rule 10 all answered one question — *may I act without asking?* — and all resolved via one test. They differed only in **which domain** they answered it for. So the split is **authority stays resident, verification detail goes lazy**:

**Resident in rule 10 (5,950 chars):** the principle (blast radius + reversibility + verifiability); the standing autonomy grant; the four named grants the audit skill's step 6 requires be preserved (low-risk-PR merge, additive/reversible/verified migration auto-merge, paid-run authorization with "cost alone never gates", audit-verdict apply); the product-lead mandate; **the hard line** (exempt); the two reserved stops; the *not-valid-reasons-to-stop* list — the operative anti-handback teeth; and the **destructive-git prohibition** for shared checkouts.

**Moved to skill `when-to-act-without-approval` (~19,000 chars, ~150 tokens resident):** the front-end carve-out and its QA gate; the backend carve-out and its test/CI bar; the three migration traps; the paid-run order of operations; unreachable-code removal; sweep-the-pattern and solve-the-broader-problem scope; the concurrent-session commit/merge mechanics (worktree recipe, push-as-safety-net, merge-freshness re-check, "skipped is not verified", manual cleanup); and the handback catalogue behind every grant.

**Why this is safe where a trim wasn't:** if the skill is never loaded, the resident text still answers the *permission* question correctly — act, then report. What's missing is the checklist, not the authority. The skill says this explicitly so the reasoning survives. No prohibition was moved into a lazily-loaded file.

## Verification

- **Coverage audit:** all **28** original directives programmatically confirmed present — resident, in the skill, or both. Zero lost.
- **Step-6 preserve-list:** all four named grants confirmed resident and unambiguous after the rewrite.
- **Exempt rails intact:** rule 10's hard line (verbatim in meaning, incl. "honored by engineering, not by asking") and rule 4's board-restructure prohibition both untouched.
- **Numbering integrity:** rules 1–13 contiguous.
- **Stale-reference sweep:** fixed rule 1's `just worktree` pointer (it referenced "rule 10, concurrent-session isolation"; the recipe moved, the prohibition didn't). Historical audit records left as-is — they are dated snapshots. The audit skill's own rule-10 references remain valid: rule 10 still carries the apply mandate.

## Layer 3 (machine-global) — proposals, not applied

Per the skill's scope rule, these describe one contributor's machine and this repo is public.

1. **`~/.claude/CLAUDE.md` is 29,657 chars (~7,414 tokens) and loads in all 37 projects.** It restates rule 10's autonomy grant, rule 11's Net convention, and rule 13's session-directing at length. Since it must stay generic (Alethical's rules only load here), the candidate is compression, not migration. Not costed this pass — a follow-up audit of that file specifically.
2. **Memory `autonomous-small-prs`** describes the propose-first exception list; it should now point at skill `when-to-act-without-approval` for the per-domain detail.
3. **~28 unused desktop-app plugins** (~1,500 est. tokens of skill listing) remain enabled — not reachable from the CLI settings cascade; needs the desktop plugin panel.

## Headline

The repo layer stayed lean everywhere except the one gate that had already been flagged for it. **Rule 10 was re-trimmed once and grew back 6.9× in 13 days** — which is the finding: on a repeat offender, compression is the wrong instrument, and the `restructure` verdict added this morning is what actually fixed it. The sharper lesson is the *lead-paragraph contradiction*: 21 commits appended grants to the bottom of a rule while its opening sentence kept asserting the pre-grant policy, so the most-read part of the most-read rule was the most wrong part of it. **Check a growing rule's first sentence against its last clause** — that check is now cheap and worth making every audit.

Next audit: diff against this table. Watch items — (1) whether rule 10 stays near 6k chars or starts re-accreting clauses that belong in the skill; (2) whether rules 4 and 13 hold at ~3k; (3) whether `~/.claude/CLAUDE.md` gets its own pass; (4) whether any Keep gate reaches a full quarter without catching anything.
