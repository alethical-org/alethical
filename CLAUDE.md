# CLAUDE.md — start here

**Read [`docs/philosophy.md`](docs/philosophy.md) before you build anything.** It is the
*why* beneath Alethical: what the product is, the problem it actually solves (legibility,
not secrecy), who we assume is reading, and the ten principles every screen and sentence
answers to. This file and the rules below are *how* we work; that file is *what we are
working toward*, and it is the tie-breaker when a tactic and an intent disagree.

## What this repo is

Alethical is a Minnesota legislative data and analysis product: ingest the official
record, make it legible, and never assert anything it can't point back to a source for.

- `alethical/` — Python backend (FastAPI), database models, migrations, and the
  ingestion pipeline
- `apps/frontend/` — Expo / React Native app; the web target is what ships today
- `docs/` — product, design, architecture, and operations docs ([index](docs/README.md))
- `scripts/` — repo-level Python utilities

## The standing rules

These three load into every Claude session automatically. They are the tactical layer —
short, checkable, and enforced — where `docs/philosophy.md` is the intent layer.

- [`.claude/rules/grounded-answers.md`](.claude/rules/grounded-answers.md) — product
  invariants for anything that generates, displays, or advertises an answer: cite or
  refuse, grounded neutrality, plain-language summaries. Philosophy principles 1, 2, 4
  and 5 made checkable.
- [`.claude/rules/workflow.md`](.claude/rules/workflow.md) — how work moves: target
  branch and worktree first, route knowledge at birth, act-then-report autonomy, the hard
  line on irreversible side effects.
- [`.claude/rules/coding-discipline.md`](.claude/rules/coding-discipline.md) — think
  before coding, simplicity first, surgical changes, goal-driven execution.

## For humans

[`CONTRIBUTING.md`](CONTRIBUTING.md) carries the same conventions written for people.
Where the two seem to conflict, `CONTRIBUTING.md` wins.
