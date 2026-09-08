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
- **Node 22** + **corepack** — for the frontend (`corepack enable` activates pnpm 10.33.0). The project records its exact Node version for [Volta](https://volta.sh/), a free tool that switches Node versions by project without removing the versions other projects use.
- **Python 3.12** — pinned in `.python-version`

## First-time setup

```bash
git clone https://github.com/alethical-org/alethical.git
cd alethical
just setup                  # installs saved dependencies and all 3 local Git hooks
cp .env.example .env        # then fill in the secrets marked "SET THIS"
just doctor                 # reports missing or wrong local tools before setup fails
just up                     # starts Postgres + backend + web frontend
```

`just doctor` is a fast, read-only check that tells
you whether Docker, uv, just, Node, pnpm, and the Python this project will use
are ready. It reads the versions from the project itself: `.python-version`,
`docker-compose.yml`, and `package.json`. It only reports problems, so it never
stops your work. Use `just doctor ios` before iPhone work or `just doctor
android` before Android work to also check Xcode or Java; web work does not need
either one.

### Keeping Node 22 beside other Node versions

Alethical records Node 22.23.2 in `package.json`. If your computer also uses a
different Node version for other projects, install Volta once and it will choose
Alethical's Node 22 only while you work here:

```bash
brew install volta
volta setup
volta install node@22.23.2
# Optional: keep Node 25 as the default outside Alethical.
volta install node@25
```

Close and reopen your terminal after `volta setup`. Then `node --version` and
`just doctor` run from this folder use Node 22, while other folders keep Volta's
default Node version. You can use another version manager instead; activate Node
22 before running Alethical commands.

**Run `just setup` in every working copy before committing.** It installs
the saved Python and frontend dependencies, then runs `just install-hooks`.
The installer keeps 3 helpers: lock new worktrees (`post-checkout`), format the
files selected for a commit (`pre-commit`), and test saved code before uploading
it (`pre-push`). Cursor, Codex, Claude Code, and a terminal use the same helpers.
Git does not copy this local setting when cloning, so fetching the code alone
does not activate them.

Installation writes a complete, versioned copy into Git's shared storage, then
activates it only for the current worktree through Git's per-worktree settings.
Other tasks keep their own settings and unfinished work. A normal
`pnpm install --frozen-lockfile` also activates the checks in the current worktree;
GitHub and isolated upload tests skip this installation. Fresh clones also receive
the existing shared lock-only hook, so future worktrees keep that protection.
Git can copy the full profile into a new worktree created from an activated one;
install that new worktree's saved dependencies before committing.
An activated worktree switched to an older branch missing the helper stops
instead of silently skipping checks; update that branch before using the checks.
Custom hooks stop installation for an explicit migration; they are not overwritten.
[Local code checks](docs/operations/local-code-checks.md) owns setup, safety limits,
and the separate GitHub activation checklist.

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
| `just setup` | Install saved dependencies and activate the 3 local Git hooks |
| `just format-staged` | Format the files selected for the next commit, preserving unfinished edits |
| `just format` | Auto-format Python (`ruff format`) **and the frontend (Prettier)** |
| `just lint` | Check Python and frontend formatting, code rules, and types: Ruff, Prettier, ty, and TypeScript |
| `just migrate` | Apply database migrations (`alembic upgrade head`) |
| `uv run pytest` | Run the backend test suite |
| `just test-frontend` | Run the frontend test suite (Vitest) |

The commit hook formats the selected files and includes those results in the
commit. The push hook runs the full app or server suite when that area changes,
using an isolated copy of the exact commit Git intends to upload. Both suites
run together when both areas change. Upload tests start a disposable Postgres
server of their own, not the shared development server on port 54329. Docker must
be running and its `pgvector/pgvector:pg17` image must already be cached. The normal
Docker Compose setup downloads that image; the push hook never downloads it and
does not need the shared database running. A read-only identity comparison proves
the connection reaches that disposable server before tests write anything.
`just lint` includes Prettier's frontend formatting check; `just format` deliberately
formats whole code areas, not just selected files.
GitHub remains the required check before merging. See
[Local code checks](docs/operations/local-code-checks.md) for the shared file rules
and why local checks do not replace GitHub's production build.

Changes made directly through GitHub do not run local Git hooks. That is a supported
editing route, not a local hook-skip setting. They still need the 4 required GitHub
checks (`changes`, `backend`, `frontend`, `description-checks`) on current code and
the merge queue's combined code before merging.

**`just lint` and `just format` pin the same tool versions CI runs** (`ruff@0.15.0`,
`ty@0.0.72` — see the justfile and `.github/workflows/ci.yml`). If you ever call
`uvx ruff` or `uvx ty` by hand, pin those same versions: an unpinned run pulls whatever
is newest and can format a file differently from CI or report errors CI never sees —
2 PRs failed that way in one night before the pins landed.

### Manual server tests use the shared local Postgres

This section describes manually running `uv run pytest`, not the upload hook.
The upload hook uses a completely separate, disposable database server as described
in [Local code checks](docs/operations/local-code-checks.md#testing-the-exact-upload).

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
and **CI could not reproduce it** because CI always starts from an empty database. You never
have to drop your database by hand: the guarantee is covered by
`alethical/tests/test_empty_data_tables.py`, so removing it fails a named test.

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

Separate database names prevent those collisions between active worktrees that share
the same worktree list. They do not isolate the database server. The setup in
[`conftest.py`](alethical/tests/conftest.py) also drops test databases it considers
abandoned, based on that list. A different clone or a forwarded local port can make
that assumption unsafe. Before a manual run, establish which server the address
reaches and coordinate with its other users. Do not treat `localhost` as proof of
ownership. A database stamped with a migration the current branch cannot locate is
dropped and rebuilt by test setup.

**What manual runs still share.** The Postgres server, role and
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

The runner is **Vitest** (`apps/frontend`, pinned exact). It runs the frontend
test suite through `just test-frontend`. Its running time depends on the suite
and computer. Use
`pnpm --dir apps/frontend run test:watch` to rerun tests on save.

**Pure logic gets a test.** Functions that clean, parse, classify, label, or calculate
data are expected to ship with tests in `src/lib/__tests__/`. A change adding one
without tests should explain why. The suite also covers rendered components and
page snapshots, including
[`AdminUsersScreen.test.tsx`](apps/frontend/src/screens/__tests__/AdminUsersScreen.test.tsx)
and [`pageSnapshot.test.tsx`](apps/frontend/src/lib/__tests__/pageSnapshot.test.tsx).
These are not a substitute for checking the site in a real browser. Browser automation
remains separate: agent-driven user stories and Playwright checks in
`apps/frontend/e2e/` (`just e2e`, Chrome, Firefox, and Safari), owned by the
[`browser-user-test` skill](.claude/skills/browser-user-test/SKILL.md).
Those browser checks run on demand, not in CI, pending the cost and flakiness policy.

Prefer a fixture of **real** data over invented strings: `src/lib/__tests__/fixtures/` holds real bill sections pulled from the production API, and its `README.md` explains what each one is there to catch and how to add more. Two of the bugs these tests pin were found by measuring against real text and would not have been caught by an example someone made up.

Use `just format-staged` for the next commit, or `just format` for an intentional
whole-code formatting pass. Both use the installed Prettier version required by
[`apps/frontend/package.json`](apps/frontend/package.json), currently `3.9.6`,
with the explicit frontend settings and ignore list. Missing or mismatched
dependencies stop the helper; run `pnpm install --frozen-lockfile` to restore them.
Do not use a global formatter or let an editor's personal defaults choose the rules.

GitHub checks all supported files inside `apps/frontend`, including unchanged
files, through [`scripts/format_frontend.mjs`](scripts/format_frontend.mjs).
It does not check the repository root as if it were the frontend. A large formatting
diff is not proof that every edit belongs: check the installed version, settings,
and actual changes before accepting it. Preserve other tasks' edits and separate
unrelated formatting repairs from the feature change.

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
- **Docs drift** (on pull requests and merge groups): [`scripts/check_pr_descriptions.py`](scripts/check_pr_descriptions.py) requires a visible, nonempty `Docs check:` explanation when declared code changes. The independent `description-checks` job reads the latest description on edits without rerunning app or server tests. Description validation does not live inside `changes`. [Local code checks](docs/operations/local-code-checks.md#github-description-check-activation) owns the release proof and required-check activation checklist.

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
ecosystem — the workflow steps (labeled `ci`), Python dependencies (`backend`),
JavaScript dependencies (`frontend`), and container images (`dependencies`). Small updates
are grouped; major updates arrive separately so one large compatibility change
cannot block safer updates. It only opens PRs — normal CI still gates them. When
one arrives:

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

The free monthly whole-system check (`.github/workflows/technology-health.yml`) is
the backstop outside ordinary package files. It checks duplicated tool versions,
unversioned commands, Python and JavaScript security reports, support deadlines,
and whether the 3-month major-tool review is overdue. Its current support dates,
exceptions, and review checklist live in
[`docs/operations/technology-health.md`](docs/operations/technology-health.md).

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
  ([`scripts/check_pr_descriptions.py`](scripts/check_pr_descriptions.py)). "Docs check: none needed, internal refactor" passes:
  the check forces a *look*, never an edit. Editing the doc does not exempt you — read
  the whole doc, then say what you concluded, and search for the claim your change made
  false, not for the name of the thing you changed.
- A blank line, hidden comment, or fenced example does not count as the explanation.
  [Local code checks](docs/operations/local-code-checks.md#github-description-check-activation)
  explains how description edits refresh their own result without uploading the
  code again or restarting app and server tests.
- **Design previews do not land under `docs/`.** Keep HTML previews, screenshots, copied
  assets, and handoff notes with the active task or pull request. Before merging, move
  lasting behavior and copy into the feature guide under `docs/product-onboarding/`,
  shared visual rules into `docs/design/design-principles.md`, and exact values into code.
- Selected live guides carry `<!-- check-quoted-code: true -->`: exact labels, colours,
  and settings they quote must still appear in their declared code
  (`scripts/check_doc_quotes.py`), or carry a narrow explained exception
  (`<!-- quote-check-ignore: exact wording | reason -->`) beside them. Add guides one
  at a time, classifying every warning first.

If you write or inherit a doc that describes how something behaves, give it a
`describes:` comment — joining the check is one line. Dated research and audits that
do not claim current behavior deliberately declare nothing.

## Writing cross-references

Cite a spec section with its full file name plus what the section covers —
"`docs/product-onboarding/grounded-ask-spec.md` §9 (Answer page UI — v1 states)", never
"the spec §9" — and link issues and PRs with their titles or a short gloss, never a
bare number. Full rule: [`.claude/rules/workflow.md`](.claude/rules/workflow.md) rule 8.
