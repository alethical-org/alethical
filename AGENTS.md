# AGENTS.md — start here

Alethical turns Minnesota's public bills, votes, legislators and campaign money
into plain language, with every claim checkable against its official source.
`AGENTS.md` is canonical; `CLAUDE.md` is its symlink. Keep one owner per rule.

## Read before you change anything

- Read [shared personal rules](https://github.com/euglopi/tool-settings/blob/main/shared/PERSONAL_RULES.md)
  first. The local owner is `~/Code/tool-settings/shared/PERSONAL_RULES.md`.
  If inaccessible, say so in the first reply; cloud briefs include the rules they need.
- Read [workflow](.claude/rules/workflow.md), [grounded answers](.claude/rules/grounded-answers.md)
  and [CONTRIBUTING.md](CONTRIBUTING.md). These compact rule maps route to full owners:
  read the sections their task triggers name before dependent work, not every guide.
  If a required guide cannot be read, hold that action and continue independent work.
- Before building, read [philosophy](docs/philosophy.md), the purpose beneath tactics.
  Use [docs/README.md](docs/README.md) to find intent. Issues and the Roadmap board own
  sequencing; a milestone in prose never makes work off-limits.
- At work start, run `just maintenance-status` and register the task through the
  installed lifecycle hook or [owner command](docs/operations/worktree-lifecycle.md).
  Check the host's live task list too: a saved owner is not proof of current activity.
  Record a hold when its reason changes, not after every reply. Native Codex hooks
  run only after supported user trust review; prepared does not mean active.

Claude Code loads this file and the unscoped `.claude/rules/` maps automatically.
Other agents must open those maps themselves. Detailed owners are read when their
triggers apply; a link is not evidence that its contents were loaded.

## Read for the task

| Task | Required owner and skill |
| --- | --- |
| UI or any Design handoff | [Design principles](docs/design/design-principles.md), including Type and its Finance exception: the approved face with equal-width digits needs no new approval. [Contextual page-return links](docs/design/design-principles.md#contextual-page-return-links) override contrary handoffs; apply settled corrections in authorized builds and align Design's record. |
| Direct Design delivery or vendor-account access/setup | Read the private project note at `~/Code/tool-settings/claude/projects/-Users-eug-code-Alethical/agent-operations.md` for the approved destination, account and setup limits. If unavailable, hold only the dependent action; do not substitute a personal account or another Design project. |
| Outside-reader documents | Shared `document-presentation` skill and [project guide](docs/design/document-presentation.md); reports also use `report-layout` and [report guide](docs/design/report-layout.md). [Brand assets](docs/design/brand-identity.md) belong here. |
| UI audit | Shared `design-audit` and [web-interface audit guide](docs/design/web-interface-audit.md). |
| Production refresh | Shared `production-data-refresh` and [operating guide](docs/operations/production-ingestion-refresh.md); historical recovery examples are not current commands. |
| Article, event, recording, caption, transcript or YouTube, including media production | [Blog publishing](docs/operations/blog-publishing.md): upfront brief, media handoff, acceptance and linked product decisions. |
| Social writing or account work | [Social publishing](docs/operations/social-publishing.md) and its linked universal guides. |
| Video editing | [Video operations](docs/operations/video/README.md). |
| Local/cloud setup or tests | [CONTRIBUTING.md](CONTRIBUTING.md#local-and-cloud-startup-details), including Docker, Linux compilation, log permissions, keyless development and sample data. |

Keep universal methods in tool settings and project choices, assets and production
records here. Save new approved lessons in the owning guide during the task; update
both repos when both scopes change and link instead of copying. Project records may
be public: never include credentials or private access data. Documentation does not
approve publishing unfinished media.

## Hard lines

- **Never invent a fact about a bill, vote or legislator.** Use the database or an
  official source, or say the fact is unavailable. Generated answers cite or refuse;
  [grounded answers](.claude/rules/grounded-answers.md) defines the product contract.
- **Keep live verification scoped and authorized.** Unapproved sends, spending and
  destructive production changes remain barred. Controlled test emails may use a
  verified authorized maintainer/test mailbox under [workflow rule 10](docs/operations/development-workflow.md#rule-10).
- **Check your directory before every write.** `/Users/eug/Code/Alethical`, the shared
  checkout, is other tasks' live state. Do not edit, format, delete or switch its branch.
  Never `git reset --hard`, `git clean -fd`, `git checkout .`, `git stash`, `git update-ref`
  on a branch you do not own, `git checkout --ignore-other-worktrees -B <branch>`,
  `git worktree remove --force <path>`, or create a branch in the shared checkout.
  `/usr/bin/git` lacks the newer Git branch guard. Read other revisions with
  `git show origin/main:<path>`; write with absolute paths into your own worktree.
  Scan open PRs/issues before starting; follow [workflow](.claude/rules/workflow.md).
- **`.claude/worktrees/` is ignored but holds other agents' live branches.** Never
  treat it as scratch, edit/delete/reformat it, or include it in replacements or sweeps
  of ignored/temporary files. Exclude it through file-access controls when supported.
- **Install all 3 local Git hooks before any `git worktree add`: `just install-hooks`.**
  A clone does not inherit `core.hooksPath`; hooks protect new working folders only
  after installation. See [setup](CONTRIBUTING.md#first-time-setup) for limits.
- **No linked-intent development (LID) in Alethical.** Do not invoke `linked-intent-dev`
  or `update-lid`, create LID plans or add its instructions. This project exclusion
  overrides a global skill description; use existing design docs, focused tests and rules.

## Keep working folders available for follow-up

Keep the chat, folder and local branch after delivery with no expiry. Age, silence,
clean files and merged changes never establish completion or authorize cleanup.
[Workflow rule 1](docs/operations/development-workflow.md#rule-1) and
[working-folder lifecycle](docs/operations/worktree-lifecycle.md) own retention and cleanup.
When the user requests cleanup:

- External terminal/Claude folders use the owner's release command. The free Mac
  helper preserves recovery, waits for programs to release the folder and never forces
  removal. New Claude work revokes a prior release.
- Codex-managed folders preserve needed ignored files privately outside the folder;
  attach only this task's checkout with `attach_worktree` if needed, then use
  `list_artifacts` and `archive_worktree`. Archive the folder while keeping the chat
  open. Never attach/archive another chat's folder, delete a native folder through Git
  or rewrite app state. An app protection or pending review retains it with that reason.
  Keep routine recovery/hold results in the local record; report them for requested
  cleanup or a problem needing the user.

## Layout and commands

`alethical/` holds the Python backend, API, models, migrations, ingestion and tests;
`apps/frontend/` is Expo React Native, shipped on the web; `scripts/` holds utilities;
`docs/` holds intent and operating guides.

Use `just up` (Postgres, backend `:8000`, frontend `:19006`), `just format`, `just lint`
and `just migrate`; [CONTRIBUTING.md](CONTRIBUTING.md) owns the full commands and setup.
Frontend tests use Vitest from `apps/frontend`; backend pytest starts its own temporary
Postgres and needs Docker plus its cached image. Follow
[manual server tests](CONTRIBUTING.md#manual-server-tests-use-a-temporary-postgres).
