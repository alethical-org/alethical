# AGENTS.md

Orientation for any coding agent working in this repository (Codex CLI, Cursor, and
anything else that reads `AGENTS.md`). Claude Code reads `.claude/rules/` directly and
does not need this file; it is here so every other agent starts from the same place
instead of guessing.

This file is a **map, not a copy**. Everything below points at the document that owns
the subject, so there is nothing here to keep in sync.

## What this is

Alethical makes Minnesota legislative records understandable: bills, votes, and
legislators, in plain language, with every claim traceable to an official source.
Read [`docs/philosophy.md`](docs/philosophy.md) first — it explains why most of the
rules below exist.

## Read before you change anything

- [`.claude/rules/coding-discipline.md`](.claude/rules/coding-discipline.md) — how to
  approach a change: think first, ship the minimum, keep the diff surgical, define a
  verifiable goal.
- [`.claude/rules/grounded-answers.md`](.claude/rules/grounded-answers.md) — the
  product invariants for anything that generates, displays, or advertises an answer.
  **Cite or refuse** is the one that governs everything else.
- [`.claude/rules/workflow.md`](.claude/rules/workflow.md) — branch and PR conventions,
  where decisions get recorded, and the checks a change has to clear.
- [`CONTRIBUTING.md`](CONTRIBUTING.md) — setup, the commands, and the human-facing
  version of the same conventions.
- [`docs/README.md`](docs/README.md) — index of every spec. Specs describe intent;
  **GitHub issues and the Roadmap board carry sequencing**, so never read a milestone
  in prose as a reason work is off-limits.

## Layout

- `alethical/` — Python backend: API, database models, migrations, ingestion, tests.
- `apps/frontend/` — Expo React Native app. The shipped target is **web**.
- `scripts/` — repo-level Python utilities.
- `docs/` — product, design, architecture, and validation notes.

## Commands

Setup and the full command list live in [`CONTRIBUTING.md`](CONTRIBUTING.md). The four
you will reach for:

```bash
just up        # Postgres + backend (:8000) + web frontend (:19006)
just format
just lint
just migrate
```

Frontend tests are Vitest, run from `apps/frontend`. Backend tests are pytest and need
the local Postgres that `just up` starts.

## Hard lines

- **Never invent a fact about a bill, vote, or legislator.** If it is not in the
  database or an official source, the honest answer is that we do not have it. See
  [`.claude/rules/grounded-answers.md`](.claude/rules/grounded-answers.md) rule 1.
- **Never fire an irreversible action to prove a change works** — a real send to real
  users, a paid run, or a destructive production data or schema change. Keep the live
  trigger behind config and verify with a dry run.
- **Never run destructive git in a shared checkout** (`git reset --hard`,
  `git clean -fd`, `git checkout .`, switching branches). Several agents work in this
  repo at once, in separate worktrees, and these commands silently destroy work that
  is not yours. Scan open PRs and issues before starting so you do not duplicate work
  already in flight.

## Cursor Cloud specific instructions

The VM snapshot preinstalls `uv`, `just`, Docker (rootful, `fuse-overlayfs` +
`iptables-legacy`, already configured in `/etc/docker/daemon.json`), Node 22 with
pnpm 10.33.0, and GCC set as the default `c++`/`cc` (the astral Python's clang can't
find `libstdc++`, which breaks the `erlpack` C++ build — leave GCC as default). The
startup update script refreshes dependencies only (`uv sync` + `pnpm install
--frozen-lockfile`). Everything below is a run-time caveat setup can't bake in.

- **Docker is not running at session start.** Start it once before `just up` /
  `just migrate`:
  `sudo bash -c 'nohup dockerd >/var/log/dockerd.log 2>&1 &'`, then, if the socket
  isn't group-accessible yet, `sudo chmod 666 /var/run/docker.sock`. Then `just up`
  brings up Postgres (`:54329`), the backend (`:8000`, Alembic migrations auto-run),
  and the Expo web app (`:19006`). The first `just up` builds the image and installs
  deps inside the containers, so give it a minute and watch `docker compose ps` for
  `healthy`. Health check: `curl http://localhost:8000/healthz` → `{"status":"ok"}`.
- **Host `uv run pytest` needs its own log dir.** The Dockerized backend runs as root
  and writes the bind-mounted `logs/alethical-backend.log` as root, so host pytest
  (which builds the app and configures logging) can't open it. Run it as
  `ALETHICAL_LOG_DIR=/tmp/alethical-logs uv run pytest`. Lint doesn't need this. Note
  pytest seeds `scripts/load_sample_data.py` into the *local* Postgres it points at.
- **`just lint` uses UNPINNED `uvx ruff`/`uvx ty`** and pulls newer versions than CI,
  reporting hundreds of false errors. Reproduce CI (`.github/workflows/ci.yml`) with
  the pinned versions: `uvx ruff@0.15.0 check alethical scripts`,
  `uvx ruff@0.15.0 format --check alethical scripts`, `uvx ty@0.0.63 check alethical/db`.
  Frontend lint (`pnpm --dir apps/frontend exec tsc --noEmit`, and
  `prettier --check .` run from `apps/frontend`) is unaffected.
- **Keep `OPENAI_API_KEY` unset in `.env` for keyless local dev.** The `.env.example`
  placeholder `sk-xxx` makes the code hit the real OpenAI API — one RAG test 401s and
  AI features fail at run time. Unset, it falls back to hash embeddings (matches CI).
  The AI summaries/Ask surface need a real key; browsing/search do not.
- **The DB starts empty; full ingestion is not required to see content.** The sample
  data seeded above (e.g. bill `SF 1832`) is what the web app renders for a quick
  end-to-end check.
