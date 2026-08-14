# Contributing to Alethical

This guide covers how to set up the project and how we make changes. If anything
here is out of date, fixing it is a great first PR.

Before your first change, read [`docs/philosophy.md`](docs/philosophy.md) — what the
product is, the problem it solves, who we assume is reading, and the principles the
specs and rules answer to. It takes five minutes and it explains why a lot of what
follows is the way it is.

## Prerequisites

Install these once:

- **Docker** + Docker Compose — runs Postgres, the backend, and the web frontend
- **[uv](https://docs.astral.sh/uv/)** — Python dependency manager
- **[just](https://github.com/casey/just)** — command runner (the recipes below)
- **Node 22** + **corepack** — for the frontend (`corepack enable` activates pnpm 10.33.0)
- **Python 3.12** — pinned in `.python-version`

## First-time setup

```bash
git clone https://github.com/alethical-org/alethical.git
cd alethical
just install-hooks          # one time, per clone — see the note below
cp .env.example .env        # then fill in the secrets marked "SET THIS"
just up                     # starts Postgres + backend + web frontend
```

**`just install-hooks` is not optional if anyone else works in this clone.** It
points git at this repo's tracked hooks (`.githooks`), and the one hook there locks
each new worktree as it is created. Without it, `git worktree remove --force` will
delete somebody's worktree along with their uncommitted work, in one command, with
no confirmation. Git cannot ship this setting inside a repository — `core.hooksPath`
is local config — so **a fresh clone is unprotected until you run it.**

What the lock does and does not do: it makes a single `--force` fail and print why.
`--force --force` still removes the worktree, and `git worktree unlock <path>` clears
the lock, both on purpose. It is a guard against an accident, not a security
boundary, and it only covers worktrees created after the hook is installed.

**Because the lock is not a wall, also run `just install-wip-backup`.** Tested against a
live agent on Aug 3 2026, the lock and every command-blocking rule turned out to be an
*approval prompt* rather than a denial: once approved, deleting a locked worktree
succeeded. With an agent that can ask for approval, no setting is a boundary, so the
realistic goal is bounded loss rather than no damage.

That recipe snapshots every worktree's uncommitted work every 5 minutes, into a
`refs/wip-backup/<worktree>` ref plus a small bundle under
`~/Library/Application Support/alethical-wip-backups/`. It costs nothing to run, pushes
nothing (this repo is public and uncommitted work has not been reviewed for publication),
and cannot disturb you: it stages into a temporary index, so your own staged and unstaged
state is never touched. Snapshots survive deleting the worktree and survive `git gc`. Stop
it with `just stop-wip-backup`; take one on demand with `just back-up-wip`.

To get work back: `git show refs/wip-backup/<worktree>:<path>`, or
`git restore --source refs/wip-backup/<worktree> -- <path>`. Recovery from a bundle after
losing the whole repo is in the script's header comment.

This exists because on Aug 3 2026 a 132-line production-schema audit was found existing as
one uncommitted file, in one worktree, on one Mac, referenced by nothing. One command
would have destroyed it.

Verify it's healthy:

```bash
curl http://localhost:8000/healthz     # -> {"status":"ok"}
```

- Backend API: http://localhost:8000
- Web frontend: http://localhost:19006

Only Supabase auth, OpenAI (AI summaries + chat), and district lookup read
secrets. The government data ingestion (Revisor bills, legislator roster, votes)
needs no configuration. See `.env.example` for what each variable does.

## Everyday commands

| Command | What it does |
|---|---|
| `just up` / `just down` | Start / stop the local stack |
| `just format` | Auto-format Python (`ruff format`) **and the frontend (Prettier)** |
| `just lint` | Lint + type-check: `ruff check`, `ty check`, and frontend `tsc --noEmit` |
| `just migrate` | Apply database migrations (`alembic upgrade head`) |
| `uv run pytest` | Run the backend test suite |
| `just test-frontend` | Run the frontend test suite (Vitest) |

Run `just lint`, `just format`, `uv run pytest`, and `just test-frontend` before opening a PR — CI runs the same checks, **plus a `prettier --check` over `apps/frontend` that `just lint` does not cover** (so `just lint` passing is not enough — run `just format` too).

**`just lint` and `just format` pin the same tool versions CI runs** (`ruff@0.15.0`,
`ty@0.0.63` — see the justfile and `.github/workflows/ci.yml`). If you ever call
`uvx ruff` or `uvx ty` by hand, pin those same versions: an unpinned run pulls whatever
is newest and can format a file differently from CI or report errors CI never sees —
2 PRs failed that way in one night before the pins landed.

### One local Postgres, one database per worktree

Every worktree shares the same local Postgres server on `:54329`, but since
[#898](https://github.com/alethical-org/alethical/issues/898) each gets its **own
database** on it, named after the worktree. Nothing to set up and nothing to remember:
`uv run pytest` in a fresh worktree creates it, migrates it, seeds it, and reuses it on
later runs — **emptying every table before it re-seeds**, so run two starts from exactly
the data run one started from. Databases whose worktree has been deleted are dropped
automatically at the start of the next run, so they do not pile up.

**Why the emptying is there** —
[#1490, backend tests fail on the second local run](https://github.com/alethical-org/alethical/issues/1490)
and [#1491, a service-history test fails for good past 20 legislators](https://github.com/alethical-org/alethical/issues/1491).
`scripts/load_sample_data.py`
inserts what is missing and updates what it finds, so it is idempotent per row but cannot
remove rows it did not create. Tests commit legislators, bills and sessions into the seeded
data and leave them there, so the database used to grow every run — 7 legislators after a
seed, 54 after one full run, 140 after three. Nothing asserted a row count, so that stayed
invisible until a test read a paginated endpoint and found the sample rows pushed off the
page it read. It then failed on every later run, in a file the session had not touched,
and **CI could not reproduce it** because CI always starts from an empty database. Dropping
your database by hand used to be the only way out; it is no longer needed. The guarantee is
covered by `alethical/tests/test_empty_data_tables.py`, so removing it fails a named test.

**What that fixed.** The suite runs `alembic upgrade head` and re-seeds at setup, against
whatever database it is pointed at. One shared database therefore produced two failures
regularly, and neither error message pointed at the cause:

- **Two sessions testing at once wiped each other's tables**, and the loser's whole suite
  errored during setup — which reads exactly like "your branch broke 459 tests". The tell
  was the runtime: ~20s run alone, dead in ~5s when it collided.
- **`Can't locate revision identified by '00xx_…'`, every test erroring at setup.** One
  worktree's migration stamped the shared database with a revision no other branch
  contained. A dependency bump was once blamed for 502 failing tests that were entirely
  this.

Both are now impossible between worktrees. The second is also self-healing *within* one:
if the database is left stamped with a revision your tree cannot locate — after a rebase,
or switching branches in place — the suite drops and rebuilds it rather than dying.

**What is still shared, and the one case not covered.** The Postgres server, role and
port are shared; only the database name splits. Two `pytest` processes started in the
*same* worktree at once still share a database and can still collide. Each session gets
its own worktree, so that is not the failure anyone has hit, and splitting per process
would mean a full migrate-and-seed on every run.

**Escape hatch.** `ALETHICAL_TEST_DATABASE_URL` overrides the whole thing if you need a
specific database. CI is untouched: it pins `DATABASE_URL` to port 5432, and only 54329
is split.

A worktree created with plain `git worktree add` has **no `.env`**. Use
`just worktree <branch>`, which links it.

### Frontend tests

The runner is **Vitest** (`apps/frontend`, pinned exact). It runs plain TypeScript modules directly, so there is no Babel or React Native transform chain to keep working, no config file, and the whole suite finishes in well under a second. `jest-expo` was not chosen: it needs the React Native preset and a Babel transform chain to test what are ordinary pure functions. Node's own `node --test` was not chosen either: running TypeScript through it depends on type-stripping whose behaviour varies by Node patch version, and unpinned tooling has turned this repo's CI red before. `pnpm --dir apps/frontend run test:watch` re-runs on save.

**Pure logic gets a test.** Any function that maps input to output with no React, no network and no device — text cleaning, parsing, classifying, labelling, date and vote maths — is expected to ship with tests in `src/lib/__tests__/`. That is the rule; a PR adding one without tests should say why. Component rendering, browser automation and visual regression are deliberately **not** covered (see [#751](https://github.com/alethical-org/alethical/issues/751)) — they need real decisions about tooling and cost, and the pure-logic floor pays for itself without them.

Prefer a fixture of **real** data over invented strings: `src/lib/__tests__/fixtures/` holds real bill sections pulled from the production API, and its `README.md` explains what each one is there to catch and how to add more. Two of the bugs these tests pin were found by measuring against real text and would not have been caught by an example someone made up.

**Format the frontend only with `just format`** (Prettier from the lockfile-pinned toolchain — `3.4.2`, config in `apps/frontend/.prettierrc.json`; run `pnpm install --frozen-lockfile` first if deps look stale). The workspace Prettier is **safe**: if it produces a large diff, the file was genuinely non-conformant — **keep** the formatting, don't reset it. Only a **global or ad-hoc `prettier`** binary (a different version, or run where it can't find the config) reflows spuriously — never use that. CI's format step is `prettier --check .` run **with `working-directory: apps/frontend`** (`.github/workflows/ci.yml`), so its `.` is the frontend package, **not the repo root**: a frontend PR fails if *any* file under `apps/frontend` is non-conformant, even ones you didn't touch — but Markdown and other files outside that directory are not gated. Don't run `prettier --check .` from the repo root and conclude CI is failing: as of Jul 2026 that reports ~74 non-conformant files across `docs/`, `pnpm-lock.yaml` and the mockup HTML, none of which CI checks. If `just format` reformats files unrelated to your change, that's pre-existing debt — format it in a separate `chore/format-*` PR first, then rebase your change on top so its diff stays surgical. A dev-server "expected versions of the packages" warning means your `node_modules` drifted from the lockfile; reinstall before formatting.

## Branch & PR workflow

**Never commit directly to `main`.** Pushing to `main` triggers a production
deploy (see below), so all changes go through pull requests.

The workflow's single home is [`.claude/rules/workflow.md`](.claude/rules/workflow.md) —
ten bullets of shape at the top, then the numbered rules. The short version:

1. **Branch off `origin/main` in your own worktree** (`just worktree <branch>`), one
   topic per branch, named literally with a topic prefix (`feat/`, `fix/`, `docs/`,
   `chore/`, `refactor/` — `docs/env-onboarding`, not `docs/ripple-sweep-habit`).
   Before you branch, skim the open PRs and issues for overlapping work — with
   parallel agent sessions, the same idea can be in flight twice.
2. **Commit** small, focused changes with a clear imperative subject line.
3. **Push and open a PR into `main`** (`gh pr create --base main`). CI runs
   automatically; fill in the template's **`Closes #<issue>`** line so the issue
   closes on merge (no issue? delete the line and say why in "What").
4. **Merge** once the checks pass on the current head (squash-merge keeps `main` to
   one commit per topic), then delete the branch and remove the worktree
   (`just worktree-rm <branch>`).

Hand work between people and tools as branches or PRs, never as file copies —
a copy outside git has no history, so nobody can cheaply tell whether it still
matches the branch (workflow.md rule 3).

New to branching? [The visual branching guide](docs/operations/git-branching-guide.html)
draws this workflow as commit graphs, with the habits and commands behind each step.

## What CI checks

On every PR (`.github/workflows/ci.yml`):

- **Backend** (when backend paths change): `ruff check`, `ty check`, and `pytest` against a real Postgres
- **Frontend** (when frontend paths change): `tsc --noEmit`, `prettier --check`, the Vitest suite, and a production build
- **Doc references** (always, no path filter): `scripts/check_doc_references.py` confirms every `docs/...` path and every relative link inside `docs/` points at a real file. This one runs on every PR on purpose — a broken doc pointer is usually introduced by a docs-only or rules-only change, which the two jobs above skip. You can run it locally any time with `python scripts/check_doc_references.py`.
- **Docs drift** (on pull requests): `scripts/check_doc_sync.py` fails your PR if it changes code that a doc says it describes and your PR body has no `Docs check:` line. See "Keeping docs current" below for what to write — one sentence clears it, and "none needed" is a valid sentence.

### Keeping the workflow actions current

Our workflows are assembled from reusable steps borrowed from other repos — the
`uses:` lines in `.github/workflows/`. Each borrowed step declares which Node.js
version it runs on, and GitHub retires those on a rolling basis: Node 12, then
16, then 20, and Node 24 will follow. When a retirement lands, every workflow
asking for the dead version fails at the same time. Two of ours (`migrate.yml`,
`railway-deploy.yml`) only run on pushes to `main`, so that failure surfaces
during a real deploy rather than on a PR check.

This already happened once. Every workflow was still asking for Node 20 months
after GitHub switched it off ([#674](https://github.com/alethical-org/alethical/issues/674));
nothing broke only because GitHub was temporarily forcing the steps onto Node 24,
and it was caught by someone reading a warning in a run log.

`.github/dependabot.yml` now checks monthly and opens one grouped PR per
ecosystem — the workflow steps (labeled `ci`), the Python dependencies
(`backend`), and the JavaScript dependencies (`frontend`). It only opens PRs —
normal CI still gates them. When one arrives:

- **Read the release notes for every major bump before merging.** A major version
  can change a default without failing. Two of ours did: `astral-sh/setup-uv` v9
  stopped trimming its saved cache, and `actions/setup-node` v5 started caching
  automatically. [#677](https://github.com/alethical-org/alethical/pull/677) is
  the worked example of what that review looks like.
- **`astral-sh/setup-uv` is pinned to an exact release on purpose** (`@v9.0.0`,
  not `@v9`). Upstream stopped publishing floating major tags as supply-chain
  hardening, so `@v9` does not resolve. The `prune-cache: true` beside it is also
  deliberate, holding the pre-v9 cache size. Don't "simplify" either.
- **The tell that a retirement is underway** is a run-log line reading
  `Node.js NN is deprecated. The following actions target Node.js NN but are being
  forced to run on Node.js NN+4`. If you see it, the grace period has already started.

Monthly is deliberate. Dependabot has two independent mechanisms: *version
updates*, which follow the schedule in `.github/dependabot.yml`, and *security
updates*, which are triggered by a Dependabot alert as soon as an advisory lands
and ignore that schedule entirely.

- **Alerts are on.** Turning them on for the first time in July 2026 returned 70
  open alerts ([#691](https://github.com/alethical-org/alethical/issues/691)) —
  nothing had ever been watching. Check
  [the alerts page](https://github.com/alethical-org/alethical/security/dependabot)
  when you're in a bump PR anyway; that is the only cadence this repo has, since
  nothing here runs on a timer. While you're there, glance over
  `docs/operations/repo-and-service-settings.md` — the settings it lists can't be
  checked by CI, and this PR is the one recurring moment anyone looks at them.
- **Automatic security fixes are on.** They were switched off in July 2026 after
  opening nine separate unreviewed PRs in four minutes, one of them a major version
  bump under the API, and switched back on the same month once the cause was fixed.
  The cause was not the bot: a `groups` block covers *version* updates only unless
  it says `applies-to: security-updates`, so grouped monthly sweeps still produced
  one PR per advisory. Each ecosystem now carries both groups, so a batch of alerts
  arrives as a single reviewable PR. Nothing self-merges — CI still has to pass and
  a person still clicks merge.
- One caveat: GitHub only raises alerts for actions referenced by version number,
  not by commit hash. All six of ours use version numbers.

## Deployment — why PRs matter

Pushes to `main` auto-deploy: the backend (Railway) and web frontend (Vercel),
and database migrations can run against production. Treat `main` as production
and land everything through reviewed PRs.

Since 2026-07-28 this is enforced, not just a convention: `main` requires a PR,
the 3 `ci.yml` checks, and a branch tested with the current `main`; it also
rejects unresolved review comments, force pushes, deletion, and owner bypasses.
Approvals are set to **zero**, so you can still merge your own work. Changes to
sensitive files ask both owners for review through `.github/CODEOWNERS`, but that
review is not a hard gate until a second owner is ready to review releases.
Details and the reason behind each value:
`docs/operations/repo-and-service-settings.md` § "Branch protection on `main`".

## Issue tracker hygiene

An open issue should mean "still needs doing." Three habits keep that true:

- **Link every PR to its issue** with `Closes #<n>` (see the PR workflow above).
  Merging then closes the issue for you, and the closed issue keeps a link back
  to the PR that did the work.
- **File issues at the moment of discovery.** When work surfaces something worth
  doing later — a deferred upgrade, a scope cut, a follow-up — file the issue in
  the same session, with enough context to act on without the original
  conversation: what it is, what exists today instead, why it's deferred, and
  what unblocks it. A title alone isn't an issue; it's a mystery for whoever
  opens it next. Categorize every issue at filing — a **milestone** (its
  release/phase), an **issue type** (`Bug`/`Feature`/`Task`), a **topic label**
  (its area), and an **effort label** (its size); see the categorization guide
  below — not as a later triage step; an uncategorized issue is invisible to
  planning. The same discipline runs in reverse:
  when a change re-scopes or re-phases work, *search* the open issues for ones
  still describing the old scope and update them in the same change — don't let
  the tracker promise a plan that no longer exists.
- **Triage periodically.** Every so often, skim the open issues and ask of each: is
  this still true? Close anything already shipped (add a one-line note pointing at
  the PR), and re-scope anything half-done to just the remaining work. This is a
  manual pass — there is deliberately no scheduled agent doing it (all recurring
  process tasks were removed in July 2026 until we understand how often they're
  genuinely needed), so it happens when someone runs it.

### Categorizing an issue

Each question about a piece of work has exactly one home — nothing is tracked in
two places:

- **Which release/phase?** → the **milestone**. Current milestones are
  `v0 hardening`, `v1`, `v2`, `v8 candidates`, and `v9 tbd` — check the
  Milestones tab rather than trusting this list, which goes stale. We group work
  with milestones rather than title prefixes, so the tab shows real progress
  bars, and there is no separate scope label.

  **A milestone groups and reports work — it does not decide whether the work
  gets done now.** A higher number is not a "later" instruction: if an issue
  supports what we're building today, it gets picked up today regardless of its
  bucket, and re-milestoned if the bucket no longer reflects reality. (The
  machine-facing form of this is `.claude/rules/workflow.md` rule 13.) Docs and
  issues should say what a piece of work is *blocked on*, never that it's
  off-limits because of its milestone — a blocker can be checked, a bucket
  can't.
- **What kind of work?** → the native **Type** (`Bug` / `Feature` / `Task`). A
  documentation task is a `Task` in the `documentation` area, not its own type.
- **Which area?** → a **topic label** (`frontend`, `backend`, `data`, `ops`,
  `auth`, `chat`, `documentation`) — also applied to PRs.
- **How big?** → an **effort label** (below) — also applied to PRs.
- **Where in flight?** → the **Status** field on the Kanban project board
  (Backlog → In progress → In review → Done), maintained on the board.

We size issues with **effort labels**, never in the title:

- `effort: small` — half a day or less; one file or area, no unknowns — you can
  picture the diff before starting.
- `effort: medium` — half a day to ~2 days; touches a few areas, or has one
  real unknown to figure out.
- `effort: large` — multiple days, or an unresolved design question.

Two rules make the sizes useful. **Effort is not priority** — the milestone
says *when*, the label says *how big*; a small issue can be launch-critical and
a medium one can wait. And **large is a smell, not a size**: before starting an
`effort: large` issue, split it into smaller issues or file a spike to resolve
the unknown. Re-sizing as you learn more is normal — edit the label, not the
title.

## Keeping docs current

The problem: **a code change quietly makes a sentence in a doc false.** The full rules —
the trigger, the every-notable-feature-gets-a-guide requirement, screenshots and
diagrams — live in [`.claude/rules/workflow.md`](.claude/rules/workflow.md) rule 6, the
single home. What CI enforces on your PR:

- A doc that describes behaviour names the code it describes in a hidden comment near
  its top: `<!-- describes: <paths> -->`. **If your PR changes a file some doc
  declares, the PR body needs one `Docs check:` line saying what you concluded**
  (`scripts/check_doc_sync.py`). "Docs check: none needed — internal refactor" passes:
  the check forces a *look*, never an edit. Editing the doc does not exempt you — read
  the whole doc, then say what you concluded, and search for the claim your change made
  false, not for the name of the thing you changed.
- **If your PR changes any file under `docs/mockups/`, its body also needs a nonempty
  `Design change:` line** naming the requirement that changed and why. The two lines do
  not replace each other; a PR that triggers both checks needs both. To remove a
  designed element because its data seems unavailable, first prove that fact exists
  nowhere in Alethical's API — Eugene decides whether to remove the requirement;
  editing the design bundle does not make that decision.
- Selected live guides carry `<!-- check-quoted-code: true -->`: exact labels, colours,
  and settings they quote must still appear in their declared code
  (`scripts/check_doc_quotes.py`), or carry a narrow explained exception
  (`<!-- quote-check-ignore: exact wording | reason -->`) beside them. Add guides one
  at a time, classifying every warning first.

If you write or inherit a doc that describes how something behaves, give it a
`describes:` comment — joining the check is one line. Frozen records (mockup handoffs,
dated audits, design intent) deliberately declare nothing.

## Writing cross-references

Cite a spec section with its full file name plus what the section covers —
"`docs/product-onboarding/grounded-ask-spec.md` §9 (Answer page UI — v1 states)", never
"the spec §9" — and link issues and PRs with their titles or a short gloss, never a
bare number. Full rule: [`.claude/rules/workflow.md`](.claude/rules/workflow.md) rule 8.
