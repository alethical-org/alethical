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
- **The danger is any write into the shared checkout, not just a git command.** Every
  rule below names a git command, and that framing has a hole: `cd /Users/eug/Code/Alethical`
  followed by `cat >> file`, `> file`, `sed -i`, `rm`, or a formatter is a write into
  everyone's shared tree, and nothing anywhere guards it. A session hit this on
  Aug 3 2026 — several of its commands `cd`'d to the shared checkout and one appended a
  file there. It got away with it only because the write was **append-only and therefore
  provably its own**; a `sed -i` or a `>` would have overwritten work it could not prove
  was not somebody else's. **So check where you are before any write, not just before a
  git command**, and prefer absolute paths into your own worktree over a `cd`. If you
  find you have written there, do not blanket-reset: prove the diff is entirely yours
  first (`git diff --stat`, and confirm it is purely additive), move the content to your
  worktree, then restore with a path-scoped `git checkout HEAD -- <path>`.
- **Never run destructive git in a shared checkout** (`git reset --hard`,
  `git clean -fd`, `git checkout .`, switching branches). Several agents work in this
  repo at once, in separate worktrees, and these commands silently destroy work that
  is not yours. Scan open PRs and issues before starting so you do not duplicate work
  already in flight.
- **Four more git commands destroy other agents' work without looking destructive**,
  so a rule that says "no destructive git" does not cover them, and neither does a
  reviewer or classifier scanning for dangerous-looking commands. The first and last
  caused real incidents here; the middle two were found by testing what a shared
  checkout actually permits:
  - `git stash` — scoops up every other agent's in-flight edits, and popping it moves
    merged code backwards.
  - `git update-ref` pointed at someone else's branch. `git update-ref refs/heads/<b>
    <commit>` moves a branch another worktree has checked out, silently, with no output
    at all; `git update-ref -d refs/heads/<b>` deletes one, where `git branch -D`
    refuses. No git version guards this — plumbing carries no safety checks — so this
    one is a rule, not a mechanism. `git checkout -B <branch>` used to do the same, and
    git 2.44.0 closed it; `git` on this Mac's `PATH` is Homebrew's 2.55.0, where
    `checkout`, `switch`, `rebase`, `branch -f` and `branch -D` all refuse a branch
    another worktree holds. **Two holes remain in that guard, both verified:**
    `git checkout --ignore-other-worktrees -B <branch>` moves the branch anyway, and
    `/usr/bin/git` is still Apple's unguarded 2.39.5, so anything calling git by that
    absolute path gets the old behaviour. Treat a refusal as git telling you the branch
    is someone else's, not as an obstacle to route around, and never reach for the
    override flag to get past one.
  - `git worktree remove --force <path>` — deletes a worktree *and* its uncommitted
    work. No git version guards this either. A tracked hook
    (`.githooks/post-checkout`) locks every new worktree as it is created, whichever
    tool ran `git worktree add`, so the command refuses and prints the lock reason.
    `just worktree-rm` unlocks first, so the intended cleanup path still works.
    **The hook is broad but not total:** it only covers worktrees created after it is
    installed, `--force --force` still overrides it, `git worktree unlock` clears it,
    and it does nothing at all until someone runs `just install-hooks` in that clone
    (git cannot ship `core.hooksPath` inside a repository). Treat it as a guard
    against an accident, not a boundary you can rely on.
  - Creating a branch in the shared checkout at all — it yanks the checkout off `main`
    while others are using it.

  To compare against another revision, read it out of git's object store —
  `git show origin/main:<path>` — and never touch the working tree. To write, make your
  own worktree: `just worktree <branch>`.
- **`.claude/worktrees/` holds other agents' live branches, and it is gitignored** —
  so it is invisible to `git status` and to any check that only looks at tracked files.
  It is inside this folder, but it is not scratch space and it is not yours: treat every
  path under it as another agent's working tree. Do not edit, delete, reformat, or run a
  project-wide replace across it, and exclude it from any sweep of ignored or
  "temporary" files. `.cursorignore` fences this path off for Cursor specifically, since
  a prose rule is not a mechanism; if your tool has an equivalent, use it too.

## Cursor Cloud specific instructions

The VM snapshot preinstalls `uv`, `just`, Docker (rootful, `fuse-overlayfs` +
`iptables-legacy`, already configured in `/etc/docker/daemon.json`), Node 22 with
pnpm 10.33.0, and GCC set as the default `c++`/`cc` (the astral Python's clang can't
find `libstdc++`, which breaks the `erlpack` C++ build — leave GCC as default). The
startup update script refreshes dependencies only (`uv sync` + `pnpm install
--frozen-lockfile`). Everything below is a run-time caveat setup can't bake in.

- **Install the worktree-protection hook in every fresh clone.** Run
  `just install-hooks` as the first setup command, before any `git worktree add`.
  Git cannot carry `core.hooksPath` in a clone, so worktrees are not locked until this
  command registers the tracked `.githooks/post-checkout` hook.
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

## Workflow exclusions

- **Do not use linked-intent development (LID) in Alethical.** Do not invoke the
  `linked-intent-dev` or `update-lid` skills, create LID planning files, or add LID
  instructions here. Those workflows belong to CommercialDeals, not this project.
- This project rule overrides a general skill that says it applies to every code
  change. Alethical uses its existing design documents, focused tests, and the rules
  in `.claude/rules/` instead.
