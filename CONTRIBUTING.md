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

**Format with the pinned versions CI uses, not the unpinned ones `just lint` reaches for.**
`just lint` and `just format` call `uvx ruff` and `uvx ty` with no version, so they pull
whatever is newest and can format a file differently from CI or report errors CI never
sees. To reproduce CI exactly: `uvx ruff@0.15.0 check alethical scripts`,
`uvx ruff@0.15.0 format alethical scripts`, `uvx ty@0.0.63 check alethical/db`. Two PRs
failed on this in one night, each on a file `just format` had already formatted.

### One local Postgres, one database per worktree

Every worktree shares the same local Postgres server on `:54329`, but since
[#898](https://github.com/alethical-org/alethical/issues/898) each gets its **own
database** on it, named after the worktree. Nothing to set up and nothing to remember:
`uv run pytest` in a fresh worktree creates it, migrates it, seeds it, and reuses it on
later runs. Databases whose worktree has been deleted are dropped automatically at the
start of the next run, so they do not pile up.

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

1. **Start each change from `main`, one topic per branch:**
   ```bash
   git fetch origin
   git switch -c <type>/<short-name> origin/main
   ```
   Branch off `main` — not off another feature branch — so your PR contains only
   your change. Use a prefix that describes the topic: `feat/`, `fix/`, `docs/`,
   `chore/`, `refactor/`. Example: `docs/env-onboarding`. Name the rest
   literally, in words a newcomer could guess the meaning of
   (`docs/update-issues-on-scope-change`, not `docs/ripple-sweep-habit`) — and
   the same for PR titles, filenames, and headings. Metaphors and coined names
   make the repo harder to learn.

   Before you branch, skim the open PRs (`gh pr list`) for overlapping work —
   especially with parallel Claude sessions, the same idea can be in flight
   twice. If a PR already touches your files or topic, build on that branch
   (or wait for it) instead of duplicating it.

2. **Commit** small, focused changes with a clear imperative subject line
   (e.g. `Add .env.example and fix README env setup`).

3. **Push and open a PR into `main`:**
   ```bash
   git push -u origin <branch>
   gh pr create --base main
   ```
   CI runs automatically on the PR. The PR description is pre-filled from
   `.github/PULL_REQUEST_TEMPLATE.md` — fill in the **`Closes #<issue>`** line so
   the issue closes automatically on merge. If there's no issue, delete that line
   and say why in the "What" section.

4. **Merge** once CI is green (squash-merge keeps `main` to one commit per topic),
   then delete the branch.

Keeping one topic per branch makes PRs small and reviewable, keeps `main`'s
history readable, and lets any single change be reverted cleanly.

**Share branches, not file copies.** When handing work between tools, sessions,
or people, push the branch and point at it (or at the PR) rather than exporting
a file to Downloads or a desktop. A copy outside git has no history, so nobody
can cheaply tell whether it matches the branch or has silently drifted — and
reconciling that later costs more than the export ever saved.

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

The problem this section exists for: **a code change quietly makes a sentence in a
doc false.** Nobody is careless when it happens — the doc that described the old
behaviour simply isn't in front of the person changing the code. So one part of
this is automated, and the rest is on you.

### Every notable feature gets its own guide

A feature that has its own page or named place in navigation is not finished until it
has a dedicated plain-English guide in `docs/product-onboarding/`. This applies to a
destination where a reader completes a product task; legal pages and passive status
pages are not feature guides.

A system design, build spec, mockup, or code comment does not count. The guide must:

- explain what the feature is for and every way a reader can enter it;
- explain its controls, results, loading, empty, and error states;
- state its important limits, data sources, and what happens to reader data;
- include a `<!-- describes: -->` declaration and an entry in `docs/README.md`; and
- change in the same PR whenever the feature's visible behaviour changes.

### The part CI enforces

A doc that describes behaviour names the code it describes, in its own text, as a
hidden HTML comment near the top:

```
<!-- describes: apps/frontend/src/lib/billText.ts, apps/frontend/src/components/billDetail/FullTextTab.tsx -->
```

`scripts/check_doc_sync.py` reads those declarations. **If your PR changes a file
some doc declares, your PR body needs one `Docs check:` line saying what you
concluded.** Any of these pass:

```
Docs check: none needed — internal refactor, no user-visible change
Docs check: updated search-bills-guide.md for the new sort labels
Docs check: reread ai-models-and-billing.md §4 and §4.1; fixed §4
```

Three things worth knowing:

- **"None needed" is a first-class answer and always will be.** The check forces a
  *look*, never an edit. Requiring an edit would mean padding docs to please CI, and
  CI would deserve to be ignored.
- **Editing the doc does not exempt you from the line.** It used to. Two PRs an hour
  apart each edited one subsection of `docs/product-onboarding/ai-models-and-billing.md`,
  each passed on the strength of that edit, and each left the section above it
  describing a system that took neither of two discounts we had just added. The page
  contradicted itself for a day. Read the whole doc, then say what you concluded.
- **Search for the claim your change made false, not for the name of the thing you
  changed.** That is how the same incident slipped a manual sweep too: searching for
  "cache" found nothing stale, because the false sentences never mentioned caching —
  they asserted a price ("pays full list price"). No search finds that. Reading the
  section does.

**Adding a doc to the check is one line.** If you write or inherit a doc that
describes how something behaves, give it a `describes:` comment. Frozen records
(mockup handoffs, dated audits, design intent) deliberately declare nothing — they
describe a moment, not current behaviour, so they cannot go stale.

### The part CI cannot enforce

Docs carry screenshots and diagrams, and those go stale silently — `grep`
can't see inside an image, so a review won't catch it. When you change
something a doc's visual depicts (UI copy, layout, the states a mock shows),
refresh that image in the **same PR**, so the doc's picture and its words never
disagree. This covers any doc with embedded visuals — build specs, onboarding
guides, READMEs — not just files named `*-spec.md`.

The machine-facing form of everything above is `.claude/rules/workflow.md` rule 6,
and the reasoning behind the check lives in `scripts/check_doc_sync.py`'s own
docstring, including the incidents that shaped it.

## Writing cross-references

When you cite a spec section anywhere — a doc, an issue, a PR body or comment —
give the full file name and say what the section covers:
"`docs/product-onboarding/grounded-ask-spec.md` §9 (Answer page UI — v1 states)", not "the spec §9".
Someone new reading the sentence in isolation should know exactly what's being
referred to without opening anything. Once the full form has appeared, later
mentions in the same document can shorten. Likewise, link issues and PRs with
their titles or a short gloss rather than dropping a bare number.
