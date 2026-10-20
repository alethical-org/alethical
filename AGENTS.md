# AGENTS.md — start here

Minnesota publishes everything its legislature does, in a format almost no one can
read. **Alethical** turns that record — bills, votes, legislators, campaign money —
into plain language, so anyone can see what their government is doing and check
every word against the official source.

This file orients every coding agent working in this repository. **It is the canonical
copy; `CLAUDE.md` is a symlink to it**, so every tool reads the same words. It is a
**map, not a copy**: everything below points at the document that owns the subject.

**Read [`docs/philosophy.md`](docs/philosophy.md) before you build anything.** It is
the *why* beneath Alethical: the problem the product solves (legibility, not secrecy),
who we assume is reading, and the ten principles every screen and sentence answers to.
The rules below are *how* we work; that file is *what we are working toward*, and it is
the tie-breaker when a tactic and an intent disagree.

## Read before you change anything

- [`.claude/rules/grounded-answers.md`](.claude/rules/grounded-answers.md) — the
  product invariants for anything that generates, displays, or advertises an answer.
  **Cite or refuse** is the one that governs everything else.
- [`.claude/rules/workflow.md`](.claude/rules/workflow.md) — the single home of how
  work moves: a ten-bullet shape up top, then the numbered rules — branch and PR
  conventions, where decisions get recorded, the checks a change must clear, the git
  commands that destroy other agents' work (rule 10), and how to write a change with
  discipline (rule 14).
- [`CONTRIBUTING.md`](CONTRIBUTING.md) — setup, the commands, and the CI reference.
- [`docs/design/design-principles.md`](docs/design/design-principles.md) governs UI work
  and every Design handoff, including the **Type** rule: use Libre Franklin with equal-width
  digits for numbers even when a drawing specifies dotted or slashed zeros, without another approval.
  Its [contextual page-return links](docs/design/design-principles.md#contextual-page-return-links)
  requirement also takes precedence over conflicting Design or peer handoffs; apply settled
  corrections during authorized builds and keep Design's record aligned.
- [Eugene's shared working rules](https://github.com/euglopi/tool-settings/blob/main/shared/PERSONAL_RULES.md)
  — how to write replies to the maintainer and how work is delegated and approved. Read
  it first. The file lives in the private `tool-settings` repository; an agent that cannot
  open it says so in its first reply, and a cloud brief pastes the rules it needs.
- [`docs/README.md`](docs/README.md) — index of every spec. Specs describe intent;
  **GitHub issues and the Roadmap board carry sequencing**, so never read a milestone
  in prose as a reason work is off-limits.
- For article, event, recording, caption, transcript or YouTube work, including media production, use
  [`docs/operations/blog-publishing.md`](docs/operations/blog-publishing.md) for the
  upfront brief, media handoff and acceptance matrix; its links lead to owning product decisions.

Tool note: Claude Code loads this file and everything in `.claude/rules/` into every
session automatically; every other agent must open them itself.

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

Frontend tests are Vitest, run from `apps/frontend`. Backend tests are pytest and
start their own temporary Postgres. Docker and its cached test image must be ready;
see [manual server tests](CONTRIBUTING.md#manual-server-tests-use-a-temporary-postgres).

## Hard lines

- **Never invent a fact about a bill, vote, or legislator.** If it is not in the
  database or an official source, the honest answer is that we do not have it. See
  [`.claude/rules/grounded-answers.md`](.claude/rules/grounded-answers.md) rule 1.
- **Never fire an irreversible action to prove a change works** — a real send to real
  users, a paid run, or a destructive production data or schema change. Keep the live
  trigger behind config and verify with a dry run.
- **Never complete OAuth only to prove that a return address is allowed.** Check the
  saved redirect list instead, or stop at the provider page before choosing an account.
  A real sign-in check may continue only after proving the browser is a fresh isolated
  profile with no signed-in account, or that Google is using the saved Alethical test
  account (`alethicaldev@gmail.com`). Never ask a browser tool for the full address after
  sign-in. No task output, tool output, log, file, issue, or pull request may contain a
  real authentication callback query or fragment; clearly fake callback values may exist
  only inside the focused tests that prove this protection. Code-driven browser checks
  must inspect the address in memory with
  [`safe-auth-callback-report.mjs`](apps/frontend/scripts/safe-auth-callback-report.mjs)
  and report only the origin, path, and the 2 booleans saying whether private fields were
  present. Interactive browser checks must compute that same report inside the page; if a
  tool can only return the full address, stop before the callback. Never retrieve the full
  address first and clean it afterward.
  [Issue 1600](https://github.com/alethical-org/alethical/issues/1600) holds the record
  behind this rule without storing a credential.
- **Any write into the shared checkout is the danger, not only a git command.** Several
  agents work in this repository at once, in separate worktrees under `.claude/worktrees/`
  and elsewhere. `cd` into the shared checkout (`/Users/eug/Code/Alethical`, the main
  worktree that `git worktree list` prints first) followed by `cat >> file`, `> file`,
  `sed -i`, `rm` or a formatter writes into everyone's tree, and nothing guards it. Check
  where you are before any write, prefer absolute paths into your own worktree, and never
  run destructive or branch-switching git on a shared checkout (`git reset --hard`,
  `git clean -fd`, `git checkout .`, switching branches). Five more commands silently
  destroy other agents' work without looking destructive: `git stash`, `git update-ref` on
  a branch you do not own, `git checkout --ignore-other-worktrees -B <branch>`,
  `git worktree remove --force <path>`, and creating a branch in the shared checkout;
  `/usr/bin/git` is Apple's older git without the guard the newer one has. The mechanics,
  the hook that locks worktrees, and the recovery steps live in
  [`.claude/rules/workflow.md`](.claude/rules/workflow.md) rule 10. To compare
  against another revision, read it from git's object store (`git show origin/main:<path>`);
  to write, make your own worktree (`just worktree <branch>`). Scan open PRs and issues
  before starting so you do not duplicate work already in flight.
- **`.claude/worktrees/` holds other agents' live branches, and it is gitignored**, so
  it is invisible to `git status` and to any check that looks only at tracked files. It
  is inside this folder, but it is not scratch space and it is not yours: treat every
  path under it as another agent's working tree. Do not edit, delete, reformat, or run a
  project-wide replace across it, and exclude it from any sweep of ignored or
  "temporary" files. A prose rule is not a mechanism: if your tool can exclude a path from
  its file access, exclude this one.

## Keep working folders available for follow-up

The chat, working folder and local branch stay after delivery, live checks and
acceptance, with no automatic expiry; the full policy, holds and cleanup route are
[`.claude/rules/workflow.md`](.claude/rules/workflow.md) rule 1 and
[working-folder cleanup and recovery](docs/operations/worktree-lifecycle.md). At work
start, inspect the current folder report (`just maintenance-status`) and register the
task through the installed lifecycle hook or the explicit owner command; recorded owners
do not establish live chat activity, so use the host's live task list for that. Record
a hold when its reason changes, not after every reply. Never infer completion from age,
silence, clean files or a merged change. Native Codex hooks require the user's supported
trust review before they run; a prepared hook is not an active hook.

- External terminal and Claude folders: when cleanup is requested, use the owner
  release command in the lifecycle doc above. The free Mac helper preserves recovery,
  waits for programs to release the folder, and removes it without force. New Claude
  work revokes prior releases.
- Codex-managed folders: when cleanup is requested, preserve needed ignored files
  privately outside the folder, attach this task's own managed checkout with
  `attach_worktree` if it is not attached, then use `list_artifacts` and
  `archive_worktree`. Never attach or archive another chat's checkout. Archive the folder
  while keeping the chat open. Keep routine recovery results and holds in the local
  record; report them when cleanup is the requested task or a problem needs the user.
  If the app protects the folder or a requested review remains, retain it with that
  specific reason. Never delete native app folders with Git or rewrite the app's saved
  state.

## Fresh environment facts

Setup and readiness checks (`just doctor`, `just install-hooks`, the pinned `ruff` and
`ty` versions) are in [first-time setup](CONTRIBUTING.md#first-time-setup) and
[everyday commands](CONTRIBUTING.md#everyday-commands). What a fresh machine or cloud
VM also needs to know:

- **Install the 3 local Git hooks before any `git worktree add`.** `just install-hooks`
  registers the tracked `.githooks/post-checkout` hook that locks new worktrees; git
  cannot carry `core.hooksPath` in a clone, so until it runs worktrees are unprotected.
- **Docker may not be running at session start.** On a VM, start it once before
  `just up` or `just migrate`: `sudo bash -c 'nohup dockerd >/var/log/dockerd.log 2>&1 &'`,
  then `sudo chmod 666 /var/run/docker.sock` if the socket is not group-accessible. The
  first `just up` builds the image and installs dependencies inside the containers; watch
  `docker compose ps` for `healthy`. Health check:
  `curl http://localhost:8000/healthz` → `{"status":"ok"}`. `just up` applies pending
  Alembic migrations to the dev database (port 54329) as the backend starts, unless
  `ALETHICAL_SKIP_MIGRATIONS=1`.
- **On Linux, `uv sync` compiles `erlpack` from source.** It has no wheel (it comes in
  through `oban`). If its C++ build fails because the uv-managed Python's compiler cannot
  find `libstdc++`, make GCC the default `c++` and `cc` and leave it that way.
- **On a VM with rootful Docker, host `uv run pytest` needs its own log dir.** The
  Dockerized backend runs as root and
  writes the bind-mounted `logs/alethical-backend.log` as root, so host pytest cannot
  open it: run `ALETHICAL_LOG_DIR=/tmp/alethical-logs uv run pytest`. Pytest seeds
  `scripts/load_sample_data.py` into its own temporary Postgres, not the running app's
  database.
- **Keep `OPENAI_API_KEY` unset in `.env` for keyless local dev.** The `.env.example`
  placeholder `sk-xxx` makes the code hit the real OpenAI API, so a RAG test fails with
  401 and AI features fail at run time; unset, it falls back to hash embeddings (matches
  CI). The AI summaries and Ask surface need a real key;
  browsing and search do not.
- **The app database starts empty; full ingestion is not required to see content.** With
  `DATABASE_URL` unset, `uv run python scripts/load_sample_data.py` loads the sample
  records (e.g. bill `SF 1832`) into the dev database on port 54329, which is what the
  web app renders for a quick end-to-end check.

## Workflow exclusions

- **Do not use linked-intent development (LID) in Alethical.** Do not invoke the
  `linked-intent-dev` or `update-lid` skills, create LID planning files, or add LID
  instructions here. Those workflows belong to CommercialDeals, not this project.
- This project rule overrides a general skill that says it applies to every code
  change. Alethical uses its existing design documents, focused tests, and the rules
  in `.claude/rules/` instead.
