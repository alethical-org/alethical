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

Run `just lint`, `just format`, and `uv run pytest` before opening a PR — CI runs the same checks, **plus a repo-wide `prettier --check .` that `just lint` does not cover** (so `just lint` passing is not enough — run `just format` too).

**Format the frontend only with `just format`** (Prettier from the lockfile-pinned toolchain — `3.4.2`, config in `apps/frontend/.prettierrc.json`; run `pnpm install --frozen-lockfile` first if deps look stale). The workspace Prettier is **safe**: if it produces a large diff, the file was genuinely non-conformant — **keep** the formatting, don't reset it. Only a **global or ad-hoc `prettier`** binary (a different version, or run where it can't find the config) reflows spuriously — never use that. CI's format step is `prettier --check .`, which is **repo-wide**: a frontend PR fails if *any* frontend file is non-conformant, even files you didn't touch. If `just format` reformats files unrelated to your change, that's pre-existing debt — format it in a separate `chore/format-*` PR first, then rebase your change on top so its diff stays surgical. A dev-server "expected versions of the packages" warning means your `node_modules` drifted from the lockfile; reinstall before formatting.

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

On every PR (`.github/workflows/ci.yml`), path-filtered to what changed:

- **Backend:** `ruff check`, `ty check`, and `pytest` against a real Postgres
- **Frontend:** `tsc --noEmit` and a production build

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
- **Triage monthly.** Once a month, skim the open issues and ask of each: is this
  still true? Close anything already shipped (add a one-line note pointing at the
  PR), and re-scope anything half-done to just the remaining work. A scheduled
  agent posts a "candidates to close" report to help — but a human decides.

### Categorizing an issue

Each question about a piece of work has exactly one home — nothing is tracked in
two places:

- **Which release/phase?** → the **milestone** (`v0 hardening`, `v1`, `v1.1`,
  `v2`, `Elections`). We group work with milestones rather than title prefixes, so
  the Milestones tab shows real progress bars. The milestone is the single source
  of truth for phase — there is no separate scope label.
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
"`docs/grounded-ask-spec.md` §9 (Answer page UI — v1 states)", not "the spec §9".
Someone new reading the sentence in isolation should know exactly what's being
referred to without opening anything. Once the full form has appeared, later
mentions in the same document can shorten. Likewise, link issues and PRs with
their titles or a short gloss rather than dropping a bare number.
