# Working-folder cleanup and recovery

<!-- describes: scripts/worktree_cleanup.py, scripts/worktree_inventory.py, scripts/install_worktree_maintenance.py, scripts/worktree_backup.py -->

Alethical removes a working folder only after its owners finish delivery and
acceptance and explicitly release it. A merged change, an old folder, or an idle
process is not a completion signal. [Issue 2485](https://github.com/alethical-org/alethical/issues/2485)
tracks this maintenance work.

## Install and inspect

On the Mac, run from an Alethical working copy:

```sh
just maintenance-install
just maintenance-status
```

Installation needs Python 3 outside a temporary worktree, Git, the GitHub command
line tool with access to Alethical, and the Mac's open-file inspection tool
(`lsof`). It saves versioned programs under
`~/Library/Application Support/alethical-worktree-maintenance/runtime/`.
The scheduled programs do not depend on the branch or working folder used to
install them. Existing scheduled-job settings are saved before replacement.

The free Mac helpers run at login, when the release queue changes, and once a day
to retry held removals and remove empty external container folders. The empty-folder
check runs even when no working folders await cleanup. Private source backups run
every 5 minutes. These are ordinary local programs; no AI, paid API, email, or
recurring coding task runs.
The existing `just install-wip-backup` command installs this complete setup too.
`just stop-wip-backup` stops only the backup schedule and keeps saved copies.

Installation also creates a separate Claude plugin at
`~/.claude/skills/alethical-worktree-maintenance/`. New Claude sessions register
ownership at session start and on each new user message. Resumed work cancels a
pending release. Before a final reply, every registered working folder needs either a release
or a specific hold explaining unfinished work, review, preview, or app protection.
This includes unsaved and unpublished work; stopping is not completion. Existing sessions that have not loaded
the plugin use the explicit commands below. Other global hooks are unchanged.

## Finish or retain a working folder

The task that owns delivery also owns cleanup. Finish the requested release,
live checks and acceptance first. A review, preview, or unfinished user request
keeps the folder. Every registered owner must release a shared working folder.
Use the owner ID supplied by the Claude hook; a terminal-only task supplies its
own stable task ID.

```sh
python3 scripts/worktree_cleanup.py register --worktree '/absolute/path/to/alethical-wt-example' --owner 'owner-id'
just worktree-rm 'codex/example' 'owner-id' 'Release is live, requested checks passed, and review is complete'
just worktree-release '/absolute/path/to/alethical-wt-example' 'owner-id' 'Release is live, requested checks passed, and review is complete'
just worktree-hold '/absolute/path/to/alethical-wt-example' 'owner-id' 'Private preview still awaits user review'
```

The removal command requires the matching Mac cleanup helper to be running, then queues a release. It does not delete a branch or force
removal. Change the example evidence to the actual delivered result and checks;
never claim acceptance while a requested review remains open. Leave the released
folder and stop its task-owned preview normally. The background helper waits
while a program still holds the folder open.

Before resuming released terminal work, revoke the release:

```sh
python3 scripts/worktree_cleanup.py resume --worktree '/absolute/path/to/alethical-wt-example'
```

This registers the terminal owner as `terminal`; that owner must release the
folder when finished. The same path cannot be released on behalf of another
registered owner. A changed saved version invalidates earlier owners' finish
decisions. Recorded ownership does not establish whether a chat is running.

## Removal safeguards

The helper handles registered folders beside the shared checkout whose names
start with `alethical-wt-`, their nested working folders, and folders inside
`/Users/eug/Code/Alethical/.claude/worktrees/`. It preserves the shared checkout.

Removal requires matching folder identity, saved version and branch; every
owner's release; clean source files; evidence that the exact work reached main;
and no open change that still needs the folder. GitHub or process-inspection
failures hold the folder. Hidden Git change flags, duplicate or broken
registrations, embedded repositories and nested working folders also hold it.

Before removal, the helper saves source history in an independent private Git
store and needed ignored files in a private archive. It tests recovery data,
then repeats ownership, source, process and private-file checks. Git removes the
folder without force. Local branches remain. Replaceable dependency downloads,
build output and caches are not retained. Private settings such as `.env` are
retained; links to private setting files recover as local copies without
writing into their original targets. Unsupported private links hold removal.

A failed backup leaves the folder in place. Interrupted cleanup keeps its recovery
record and can finish on a later run. Age never makes an unsafe folder eligible.
The helper does not close chats, merge unfinished changes, or publish private work.

### Empty external container folders

After each sweep, the helper also examines immediate sibling folders of the
shared checkout named `alethical-wt-*`. A folder is removable only when it is
empty or contains just a regular Finder metadata file (`.DS_Store`). A link,
source file, private setting, child folder, exact or nested Git registration,
or program holding the folder open keeps it in place. Failed process inspection
also keeps it. Removal uses ordinary file removal and a nonrecursive directory
removal, so a newly arrived source file makes directory removal fail safely.

This check does not search other projects or delete the contents of working
folders. A report-only sweep (`python3 scripts/worktree_cleanup.py sweep`) keeps
the folders, does not fetch remote changes, and writes no lock or status files.
It uses the locally available main-branch information for its release checks.
Git inspection also disables configured filesystem-monitor hooks, which can
otherwise run programs even while listing unchanged files.

## Recover a removed folder

`just maintenance-history` lists each release's ID, original path and state.
Recover into a new, empty destination:

```sh
just worktree-restore '<64-character-id>' '/absolute/path/to/new-recovery-folder'
```

The result contains the saved source and private files. It has no publishing
remote and does not overwrite an existing folder. Reinstall dependencies before
running the recovered project.

Cleanup records and private archives live under
`~/Library/Application Support/alethical-worktree-maintenance/`. Source recovery
uses `recovery.git`; private archives use `archives/<folder-id>/<recovery-id>/`. Each removal keeps its own recovery ID, including when a folder name and saved version are reused.
`last-cleanup.json` records completed and held attempts. Logs live in
`~/Library/Logs/com.alethical.worktree-cleanup.log` and
`~/Library/Logs/com.alethical.worktree-cleanup.errors.log`. Keep this storage
private; it can contain credentials and unpublished work. No archive-expiry job
silently deletes recovery copies.

## Recover unfinished source work

`just back-up-wip` saves an immediate source backup. Each working folder gets an
ID derived from its actual Git storage locations, so multiple folders named
`Alethical` cannot overwrite one another. Its private manifest lives at
`~/Library/Application Support/alethical-wip-backups/<id>/manifest.json`.
Existing older backups remain untouched.

The manifest names the original HEAD, the separately saved staging version
(`index_commit`), the on-disk snapshot, and its bundle. Recovery starts in a
separate clone of origin/main. Fetch the manifest's bundle and private ref, check
out its original HEAD, restore disk files from its snapshot, then restore staging:

```sh
git fetch '/absolute/path/to/snapshot.bundle' 'refs/wip-backup/<id>'
git checkout --detach '<head-from-manifest>'
git restore --source '<snapshot-from-manifest>' --worktree .
git read-tree '<index-commit-from-manifest>'
```

These commands belong in the recovery clone, never in another task's working
folder. Backups include staged, unstaged and untracked source files. Ordinary
ignored files need separate protection, and a clean folder with unpublished
commits does not trigger this periodic source backup. Cleanup's independent
recovery copy covers a released folder before removal. A periodic snapshot does
not prove that a live folder is safe to delete.

Only origin/main history may be omitted from a bundle; feature-branch history
stays recoverable even when a remote feature branch is deleted. If origin/main
is unavailable, the bundle includes all needed history. A failed or damaged
bundle retries without replacing the last successful copy. Neither backups nor
cleanup push private recovery refs to GitHub.

## Codex-managed folders

Folders under `~/.codex/worktrees/` belong to the Codex app. This helper refuses
to remove them or edit the app's saved state. After delivery and acceptance,
the owning Codex task lists its attachments and archives its own working folder
through the supported app tool, preserving needed ignored files separately.
If its own managed checkout is not attached, the task attaches that exact
checkout first. Another chat's checkout must never be attached for cleanup.
Archiving a working
folder and closing its chat are separate decisions.

[Codex's worktree guide](https://learn.chatgpt.com/docs/environments/git-worktrees)
explains its own recoverable cleanup and retention controls. This installation
does not establish the app's current retention setting. Optional hook installation
and the required native trust step are described below.
A denied native tool does not authorize editing private app storage or bypassing
trust controls. Native cleanup needs a supported app action before it can be
reported as active.

## Complete inventory and finish checks

`just maintenance-status` reports every Git-registered folder, including the shared
checkout, native Codex folders, missing or broken registrations, folders without
owners, and saved hold reasons. Source-inspection failures are unknown, never clean.
Decisions tied to a different folder identity or saved version are marked stale.
The report does not fetch, call GitHub, change Git state, or infer that a chat is
running. It omits private file contents and source diffs. Use the host's live task
list to resolve current chat activity during a review.

The existing daily cleanup run saves the inventory privately in
`folder-inventory.json`, with its observation time. No recurring AI, messages or
paid service runs. A missing owner is a review finding, never deletion permission.
Retained work stays until its owner completes the requested outcome. The existing
shared `worktree-triage` skill guides the judgment part of that review.

Claude's installed plugin registers owners when work starts or resumes and asks
for a release or specific hold before a final reply. It does not decide that work
is finished from a merged change or from the wording of a reply. Start/finish hooks
only affect sessions that load them; terminal work uses the explicit commands.

Codex supports the same lifecycle events through its documented hooks. Prepare
the definitions with the maintenance installer, or add `--install-codex-hooks` to
merge them into the user's `~/.codex/hooks.json`. Unrelated hooks are preserved and
previous configuration is saved privately. Installation does not grant trust.
Codex requires the user to review and trust each new or changed definition through
its supported `/hooks` control before execution. Never edit trust storage, use a
trust-bypass option, or claim a prepared definition is running. See
[Codex hooks and trust](https://learn.chatgpt.com/docs/hooks).

For native Codex folders, these hooks record ownership and holds and direct the
owner to the app's archive tool. The script cannot archive or delete a native
folder. If Codex protects a primary checkout, record that exact reason as a hold.

## CommercialDeals coverage

The same versioned programs support an explicitly installed CommercialDeals
profile. It has separate jobs (`com.commercialdeals.worktree-cleanup` and
`com.commercialdeals.wip-backup`), private maintenance storage under
`~/Library/Application Support/commercialdeals-worktree-maintenance/`, and backups
under `~/Library/Application Support/commercialdeals-wip-backups/`.

From the checkout containing these programs, install with
`python3 scripts/install_worktree_maintenance.py --project commercialdeals --repo /Users/eug/Code/CommercialDeals`.
Add `--admit-external <absolute-path>` for each existing external folder explicitly
admitted to the release workflow. Admission is not release and requires a matching
Git registration in that exact repository. Newly created folders under the sibling
`CommercialDeals-worktrees/` container and that repository's `.claude/worktrees/`
are in scope; other sibling names are not automatically adopted. No CommercialDeals
empty-container sweep runs, because similarly named folders can contain saved designs.

Use `--protect <absolute-path>` for a persistent preview hold. The installed
`CommercialDeals-mvp-screens` protection remains even when the preview server is
stopped, and an ordinary owner release cannot override it. Reinstallation preserves
existing admissions and protections, including records of already removed folders.
Repository-bound installation records prevent one project's setup from reusing
another project's recovery state. Installation and cleanup share a lock; protections
are saved before new cleanup programs start. The shared checkout and native app
folders remain excluded from scripted removal.

CommercialDeals owns its command wrapper and setup instructions in its own
repository. The safety implementation remains here; each installer copies the exact
programs to durable private storage so removing the build checkout cannot break them.

## Impact, prevention and completion

- **Cause:** release-only reports hide unclaimed folders, unfinished turns lack hold records, and single-project installation leaves CommercialDeals uncovered; basename-only backup names collide across identically named folders.
- **Affected uses:** terminal and Claude working folders need explicit delivery ownership, while Codex-managed folders retain their separate app-owned lifecycle.
- **Correction:** owner releases drive guarded removal, every registered owner records a finish decision, and full inventories expose missing decisions; resumed work revokes releases; separate project profiles retain stable identities and independently recoverable contents.
- **Prevention checks:** disposable-folder tests cover unsaved work, multiple owners, active programs, failed archives, interrupted removal, recovery, backup collisions, deleted feature branches and installer isolation.
- **Remaining limits:** existing sessions may lack loaded hooks, Codex requires native trust, live chat activity remains a host lookup, and simultaneous unmanaged file writes still require the owner to finish using the folder before release.
- **Owner and authorization:** the implementing task owns the user-authorized cleanup and free local prevention setup; other task owners retain control of unfinished work and previews.
- **Completion:** eligible cleanup has private recovery proof, the installed helpers run from durable storage, and remaining holds identify the reason a folder must stay; native Codex coverage is reported separately.
