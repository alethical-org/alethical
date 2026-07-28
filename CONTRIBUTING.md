# Contributing to Alethical

This guide covers how to set up the project and how we make changes. If anything
here is out of date, fixing it is a great first PR.

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
cp .env.example .env        # then fill in the secrets marked "SET THIS"
just up                     # starts Postgres + backend + web frontend
```

Verify it's healthy:

```bash
curl http://localhost:8000/healthz     # -> {"status":"ok"}
```

- Backend API: http://localhost:8000
- Web frontend: http://localhost:8081

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

Run `just lint`, `just format`, and `uv run pytest` before opening a PR — CI runs the same checks, **plus a `prettier --check` over `apps/frontend` that `just lint` does not cover** (so `just lint` passing is not enough — run `just format` too).

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
- **Frontend** (when frontend paths change): `tsc --noEmit`, `prettier --check`, and a production build
- **Doc references** (always, no path filter): `scripts/check_doc_references.py` confirms every `docs/...` path and every relative link inside `docs/` points at a real file. This one runs on every PR on purpose — a broken doc pointer is usually introduced by a docs-only or rules-only change, which the two jobs above skip. You can run it locally any time with `python scripts/check_doc_references.py`.

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
  nothing here runs on a timer.
- **Automatic security fixes are off**, deliberately. Left on, they opened nine
  separate unreviewed PRs in four minutes, one of them a major version bump under
  the API. The prerequisite for turning them back on is a `groups` entry with
  `applies-to: security-updates` so a batch arrives as one reviewable PR.
- One caveat: GitHub only raises alerts for actions referenced by version number,
  not by commit hash. All six of ours use version numbers.

## Deployment — why PRs matter

Pushes to `main` auto-deploy: the backend (Railway) and web frontend (Vercel),
and database migrations can run against production. Treat `main` as production
and land everything through reviewed PRs.

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

Docs carry screenshots and diagrams, and those go stale silently — `grep`
can't see inside an image, so a review won't catch it. When you change
something a doc's visual depicts (UI copy, layout, the states a mock shows),
refresh that image in the **same PR**, so the doc's picture and its words never
disagree. This covers any doc with embedded visuals — build specs, onboarding
guides, READMEs — not just files named `*-spec.md`.

## Writing cross-references

When you cite a spec section anywhere — a doc, an issue, a PR body or comment —
give the full file name and say what the section covers:
"`docs/product-onboarding/grounded-ask-spec.md` §9 (Answer page UI — v1 states)", not "the spec §9".
Someone new reading the sentence in isolation should know exactly what's being
referred to without opening anything. Once the full form has appeared, later
mentions in the same document can shorten. Likewise, link issues and PRs with
their titles or a short gloss rather than dropping a bare number.
