# Workflow-overhead audit — the SessionStart hooks (layer 2) — 2026-07-26

**Net:** the two scripts that run automatically when a session opens were checked for the first time. One of them prints a heading — "Deferred-scope issues" — over a list that has been empty since the day it was written, because it searches for a label that does not exist on the repo. That heading is gone. The other looked useless (silent in 130 of 131 sessions) but is kept: it costs nothing when it finds nothing, and the one time it fired it deleted a genuinely stale file and flagged its stale twin.

Layer: **2 (repo-local, untracked)** — `.claude/settings.local.json`, **audited for the first time**; it was the last of the five layers with no record. Diff base: the four same-day records (`workflow-rules`, `global-claude-md`, `memory-system`, `docs-layer`), which between them covered every other layer.

**Scope, as instructed:** the **SessionStart hooks only**. The 62 `permissions.allow` entries in the same file were **explicitly excluded by Eugene** and are untouched — verified still 62 before and after.

**Run justified:** these two scripts execute on every session open, and one of them **deletes files**. Neither had ever been examined, and layer 2 is the one layer whose contents are untracked — so a defect here is both unreviewed and unrevertable by `git`.

## Cost — step 2, measured not assumed

Both timeouts are caps and were treated as such; the figures below are measured typicals from a live run.

| Hook | Purpose | Typical | Cap | Output per session | Verdict |
|---|---|---|---|---|---|
| 1 — roadmap snapshot | branch behind-count, milestone list, deferred-scope list | **1.4s** | 20s | **1,028 chars ≈ 257 est. tok, every session** | **Trim — applied** |
| 2 — stale-duplicate guard | finds untracked files that also exist in `origin/main`; deletes byte-identical ones, reports differing ones | **0.4s** | 30s | **0 chars unless it fires** | **Keep** |

The caps are 14× and 75× the measured typicals. Left alone: a cap protects against a hung `gh`/network call, and the cost of a generous cap is zero when the call returns in a second.

## Hook 1 — trim applied

`gh issue list --label post-v0` returns `[]` because **no label containing "post" exists on the repo** (checked against all 200 labels). `gh` does not error on an unknown label, and stderr was suppressed anyway, so the block has printed its heading over nothing since it was written.

The token cost is trivial (~35 chars). **The real defect is that it asserts something false.** A heading reading "Deferred-scope issues (post-v0):" followed by nothing states *there are no deferred-scope issues*. The truth is *nobody has ever used that label* — deferred scope is tracked by milestone (`v2`, `v8 candidates`, `v9 tbd`), which the milestone block directly above already lists with counts. A session reading the empty list could reasonably conclude the backlog was clear.

Removed the block; the rest of hook 1 stands. Command 777 → 604 chars.

**Everything else in hook 1 is a strong keep**, and it earned that today: the behind-count reported "7 commit(s) behind origin/main" at the start of this session, and the skill being audited had received **seven commits from parallel sessions** in those 7. Without the snapshot the audit record would have been written against a stale copy of its own method. That is the gate catching a real incident on the day it was audited.

## Hook 2 — keep, and the reasoning generalises

It looks like a trim candidate: **silent in 130 of 131 sessions.** It is not, for two reasons.

**It has a named incident.** In session `7dbcee48` it printed two real paths (verified as genuine output, not the hook's own source text appearing in a settings dump — the distinction that nearly produced a wrong verdict here):

- `Auto-removed stale duplicate (byte-identical to origin/main): docs/data-ingestion-pipeline.svg`
- `Untracked file DIFFERS from tracked origin/main version: docs/data-ingestion-pipeline.png (local NEWER than main's — possibly WIP)`

That is `workflow.md` rule 3 ("share branches, not file copies") enforced mechanically, and the `.png` it flagged is the same asset that produced Observation 9 about needing `qlmanage` to keep an SVG and its rendered PNG in step.

**It is silent by design, so its silence costs nothing.** This is the distinction worth keeping: a gate that prints unconditionally (hook 1: 257 tok × 131 sessions) is paid for whether or not it has anything to say, so it must justify itself continuously. A gate that prints only on a hit costs one measured `0.4s` and **zero context** when it finds nothing. Its evidence bar is therefore *one real catch*, not *regular output* — and it has one.

*Deliberately recorded here rather than added to the skill's method.* The skill already gained three clauses today, its own anti-patterns warn against it bloating, and one instance is not a pattern — the same "don't codify from a single observation" discipline the observation log exists to enforce. Promote it if a second audit hits the same question.

## The duplicate `git fetch` — a keep that looks like a trim

Both hooks open with `git fetch -q --no-tags origin main`, so every session fetches twice. The obvious optimisation is to drop the second.

**Rejected.** Hook 2 is the one that *deletes files*, and its safety rests entirely on comparing against a current `origin/main`: an untracked file byte-identical to a **stale** tip could be deleted when it is not in fact redundant. Removing its fetch would make that correctness depend on hook 1 having run and succeeded first. The second fetch is a no-op costing ~0.4s and is the insurance premium on the only destructive thing that runs automatically here. **Optimising a destructive path's freshness check to save a fraction of a second is the wrong trade** — noted so a future audit doesn't "clean it up."

## Verification

- **JSON re-parsed** after the edit; `permissions.allow` confirmed **62 before and 62 after** (out of scope, untouched); both hooks still present; hook 2's command byte-identical.
- **Trimmed hook 1 dry-run executed** — emits the behind-count and all five milestones, with no trailing empty section.
- **Backed up first.** `.claude/settings.local.json` is untracked, so `git revert` does not cover it; a copy was taken to the session scratchpad before editing. This is the layer-2 analogue of the unversioned-memory rule in the Scope section.
- **Evidence method corrected mid-audit.** The first grep for hook-2 firings matched the hook's own source text (`… : $f`) inside settings dumps and would have over- or under-counted; re-run against real paths only. **When a gate's evidence is its own output text, searching transcripts for that text will match the gate's definition too** — filter for the interpolated form.

## Headline

**A gate can be simultaneously worthless and expensive, or valuable and free, and size tells you neither.** Hook 1 is the one that prints every session, and the part of it that was pure noise was also the part asserting a falsehood. Hook 2 is the one that almost never prints, and it is the one that has actually deleted a stale file and caught its twin. The measure that separated them was **cost when idle** — a gate that is quiet by design is nearly free and needs only one real catch; a gate that speaks every session must earn its words each time.

Layer 2 is now audited, completing all five layers. Next audit: watch items — (1) whether hook 1's milestone block stays accurate as milestones are renamed, since it prints their descriptions verbatim; (2) whether hook 2 ever fires a second time — a single catch in 131 sessions is a keep, but a second would justify promoting the silent-by-design reasoning into the method; (3) the 62 permission grants in the same file, still never reviewed and deliberately out of scope here.
