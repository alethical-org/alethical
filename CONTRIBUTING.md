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
- Web frontend: http://localhost:19006

Only Supabase auth, OpenAI (AI summaries + chat), and district lookup read
secrets. The government data ingestion (Revisor bills, legislator roster, votes)
needs no configuration. See `.env.example` for what each variable does.

## Everyday commands

| Command | What it does |
|---|---|
| `just up` / `just down` | Start / stop the local stack |
| `just format` | Auto-format Python (`ruff format`) |
| `just lint` | Lint + type-check: `ruff check`, `ty check`, and frontend `tsc --noEmit` |
| `just migrate` | Apply database migrations (`alembic upgrade head`) |
| `uv run pytest` | Run the backend test suite |

Run `just lint` and `uv run pytest` before opening a PR — CI runs the same checks.

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
   `chore/`, `refactor/`. Example: `docs/env-onboarding`.

2. **Commit** small, focused changes with a clear imperative subject line
   (e.g. `Add .env.example and fix README env setup`).

3. **Push and open a PR into `main`:**
   ```bash
   git push -u origin <branch>
   gh pr create --base main --fill
   ```
   CI runs automatically on the PR.

4. **Merge** once CI is green (squash-merge keeps `main` to one commit per topic),
   then delete the branch.

Keeping one topic per branch makes PRs small and reviewable, keeps `main`'s
history readable, and lets any single change be reverted cleanly.

## What CI checks

On every PR (`.github/workflows/ci.yml`), path-filtered to what changed:

- **Backend:** `ruff check`, `ty check`, and `pytest` against a real Postgres
- **Frontend:** `tsc --noEmit` and a production build

## Deployment — why PRs matter

Pushes to `main` auto-deploy: the backend (Railway) and web frontend (Vercel),
and database migrations can run against production. Treat `main` as production
and land everything through reviewed PRs.
