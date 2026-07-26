---
name: resume-research-workflow
description: Use when launching, stopping, or resuming an expensive multi-agent research run (deep-research or a Workflow fan-out) — how to checkpoint at launch, stop before a usage meter runs into paid overage, and resume from the journal cache byte-identically instead of re-paying. Invoke before firing a long Workflow, when Eugene names a usage threshold or reports a meter running hot, and before diagnosing an empty or failed run as lost work.
---

# Checkpoint and resume an expensive research workflow

Multi-agent research runs (deep-research and similar Workflow fan-outs) are the costliest thing a session does, and **any of Eugene's usage limits can run out mid-run — the 5-hour session window, the weekly all-models allowance, or the weekly per-model (e.g. Fable) allowance. This applies to all three meters equally.** A weekly meter can force a multi-day pause, so the checkpoint must be durable enough to survive it.

`.claude/rules/workflow.md` rule 12 owns the standing policy; this skill holds the mechanics.

## Standing practice

- **Checkpoint at launch.** When launching a long research workflow, immediately save a checkpoint file (scratchpad or session dir) with the run ID, script path, and the *exact* `args` string, so a later turn — possibly after context summarization — can resume without reconstructing anything.
- **Stop before the limit, not after.** If Eugene pauses for cost or any of the three meters is near its limit, stop the run (`TaskStop`) rather than letting it burn into overage. This is safe: every completed agent is journaled (`journal.jsonl` in the workflow transcript dir) and replays from cache at zero cost; a stop loses only in-flight agents.
- **Resume from cache, byte-identical.** Resume with `Workflow({scriptPath, resumeFromRunId, args})` where `args` is byte-identical to the original — *omitting* `args` aborts instantly without touching the cache (Jul 2026: a resume without args died with "No research question provided"), and *changed* args miss the cache and re-pay for everything. Same-session only.
- **Run the tail cheap.** The resumed remainder (final verifies, synthesis) inherits the session model — switch to the cheapest model adequate for those stages before resuming.
- **Never re-run whole when a journal exists.** Before diagnosing an empty or failed result as lost work, read the journal — the cached results are usually all there.
- **Never promise a threshold stop — pick a mechanism before ending the turn.** Claude cannot see any of the usage meters and does not run between turns, so "I'll stop it at N%" is unenforceable (Jul 18 2026: promised a 97% stop with no mechanism; Eugene had to stop the run manually at 98%). When Eugene names a threshold on any meter or reports one running hot, do one of two things before ending the turn — and say which one was done: `TaskStop` the run immediately (the journal cache makes stopping cheap), or arm a timed one-shot stop sized to the remaining tail (`send_later`, e.g. 15–20 minutes out: on fire, stop the run if it's still going and re-checkpoint). A stated intention with no armed mechanism is the failure mode, not a plan. Model choice is a lever here too: the weekly per-model meter drains only for that model's usage, so running research tails on a cheaper model spares the premium meter for judgment work.

## Related

Before committing to any expensive/slow/unattended run at all, `~/.claude/CLAUDE.md`'s cheaper-and-faster-frontier gate applies first: present the frontier options (speed + cost + quality + Net) up front, and treat a large asymmetry against an existing cheaper path as a hard stop.
