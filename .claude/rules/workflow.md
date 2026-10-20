# Session workflow rules

How work moves in this repository, for every coding agent and every person. This file is
the single home of the working conventions. `CONTRIBUTING.md` covers setup, commands and the
CI reference; `.claude/rules/grounded-answers.md` carries the product-behavior rules.

## How we work — the shape

1. **Everything ships through a pull request, and you carry it to live.** Fetch
   `origin/main`, branch in your own worktree, build, verify, open the PR, merge it
   yourself once the named checks pass on the current head, let the merge deploy, then
   check the live result. (Rules 1, 10.)
2. **One worktree per simultaneously active piece of work**: create it the moment the
   work starts, do every write inside it, keep it for follow-up after delivery. (Rule 1.)
3. **Scan before you build**: open PRs, open issues, and what just merged on your target
   files; with parallel sessions, someone may already own the work. (Rule 1.)
4. **Act, then report.** Safe, reversible, verifiable work is pre-approved end to end,
   including merge, deploy and verified data runs. The one hard stop is an unverified
   irreversible external effect: make it safe by engineering, never by asking. (Rule 10.)
5. **Route knowledge at birth**: decisions into `docs/`, tasks into categorized GitHub
   issues at the moment of discovery, product invariants into `.claude/rules/`. Chat is
   never a system of record. (Rule 4.)
6. **Keep every written claim current**: when a change alters what a user sees or can do,
   find and fix every sentence that still describes the old behaviour, in the same PR.
   (Rule 6.)
7. **Verify before you assert**: repo facts by checking the repo, user-facing facts from
   the primary source. (Rules 5, 9.)
8. **Write for a newcomer**: literal names, plain-language "Net:" lines on issues and
   PRs, spec references spelled out. (Rules 7, 8, 11.)
9. **Treat the shared checkout and every ref in it as someone else's live state**: read
   other revisions from git's object store, write only inside your own worktree. (Rule
   10's git rules.)
10. **Every goal-supporting issue has an active owner**: you, a running session, or a
    session you start; every delegation brief ends with "message me back when done".
    (Rules 12, 13.)

## Page-return handoffs and acceptance

Apply [design-principles.md: contextual page-return links](../../docs/design/design-principles.md#contextual-page-return-links)
when reviewing Design, writing build briefs, building new pages or editing existing pages.
A contrary peer instruction or Design handoff does not change that product requirement.
Correct settled contradictions during the authorized build, preserve its visual direction,
and keep Design's saved rules, drawings and build notes aligned through the authorized
update route. A settled wording or behaviour correction never waits for another drawing. A
genuinely open visual or product choice keeps its existing permission boundary.

Run the frontend return-link source guard (`node apps/frontend/scripts/check-return-links.mjs`)
and its regression tests (`node --test apps/frontend/scripts/test-return-links.mjs`), then
exercise the affected return paths in the rendered app: initial HTML, direct and shared
visits, safe earlier context, missing identity, rapid record changes, loading and errors,
copied and new-tab links, retained filters and scroll, keyboard and phone layouts. A green
static guard does not prove the words match the destination. Review the final Design
updates and independently inspect the live behaviour before reporting completion.

## The rules

1. **Target branch first.** Establish at the start which branch or PR the work belongs
   to; work in your own worktree off `origin/main` for it, never in the shared checkout
   (rule 10 carries the git prohibitions). The whole worktree policy: **one worktree per
   simultaneously active piece of work, created the moment that work starts
   (`just worktree <branch>`, or your tool's own worktree mechanism), every write inside
   it, kept for follow-up after delivery, live checks and acceptance.** Release it only
   when the maintainer explicitly requests cleanup
   (`just worktree-rm <branch> <owner-id> '<delivery and cleanup authorization evidence>'`);
   removal requires both that request and an explicit owner release after delivery and
   acceptance. Completion, merging and age never authorize cleanup; completed work carries a
   retention hold with no expiry; related follow-up stays in the same chat and folder,
   with a fresh branch from current main when needed. Every owner finishes or records a
   hold for remaining review or previews. New work revokes prior releases; holds survive
   ordinary questions; a missing finish decision keeps the folder, including unfinished,
   unsaved or unpublished work. Routine lifecycle hooks never interrupt replies or add
   chat messages (concurrent-session mechanics: skill `when-to-act-without-approval`). Cleanup saves recovery copies, retains branches
   and refuses unsafe removal; Codex-managed folders use the app's own archive control.
   See [working-folder cleanup and recovery](../../docs/operations/worktree-lifecycle.md).
   **Never release another task's folder on the basis of age or a merged change alone.**

   Before writing code, check that the work is not already owned or landed:

   ```bash
   git fetch origin main
   gh pr list                                    # open PRs on your files or topic
   gh issue list --search "<file/topic>"         # decisions live in issues, invisible to a PR scan
   git log --oneline HEAD..origin/main -- <target file>
   gh pr list --state merged --search "<file/topic>"
   ```

   If origin moved or a merged PR already touched the file, rebase and re-scope as an
   extension before you build. Duplicated in-flight work merges twice and conflicts once;
   an open issue can carry a decision no PR scan sees; a session-start "N commits behind"
   snapshot goes stale the moment another session merges.

2. **Commit and push at milestones, not at session end.** Uncommitted work is invisible:
   not in the PR, not reviewable, not recoverable by anyone outside the conversation. When
   a coherent chunk lands, commit it. Register each authorized job before substantive
   work and bind resumed conversations and helpers to that same job using
   [agent-job-outcomes.md](../../docs/operations/agent-job-outcomes.md). Local Claude Code
   and Codex hooks record activity after installation and host review; a stopped reply
   never completes a job. Use the shared source-reading completion checker for the finish.
   Keep unfinished jobs, independent acceptance evidence and unknown measurements honest;
   never claim success from an invented record. During the prospective trial, mark only
   newly starting, ordinary approved low-risk jobs eligible; do not invent work to fill it.
   Keep private help and retry notes during work, including helper coverage and gaps,
   using [agent-job-outcomes.md, Record help and retries while working](../../docs/operations/agent-job-outcomes.md#record-help-and-retries-while-working);
   do not reconstruct whole-job counts from host event totals.

3. **Share branches, not file copies.** A loose copy of a repo file (Downloads, an
   attachment) is diffed against the branches before anything is built on it. Land
   durable content on a branch promptly, point people at branches and PRs rather than
   exporting files, and delete the
   loose copy in the same session it lands: a kept copy trails the branch and resurfaces
   as a stale shadow of main.

4. **Route knowledge at birth.** Decisions go to the relevant spec in `docs/`. Tasks and
   deferred work go to GitHub issues, filed at the moment of discovery with what it is,
   what exists today, why deferred, what unblocks it, **a milestone, an issue type, a topic
   label, and its board fields (Epic, Priority, LOE, Status)**, then cross-linked back into
   the doc that spawned it. Product invariants go to `.claude/rules/`; working-process
   norms to this file. Chat is a scratchpad, never a system of record.

   **A decision reached in conversation, with no file changed, still ships a doc edit in
   the same session.** Nothing automated fires on it. If a chat reply just taught the
   maintainer something durable, that content (the fact, the decision and the reason)
   goes into `docs/` before the turn ends, written for the next builder. Two categories slip past every code-shaped check:

   - **How an external source behaves**: archive vs overwrite-in-place, link stability,
     format violations, what its error page looks like. These shape every importer and
     are learnable only by measurement.
   - **How we handle its data**: where a file lives, what is kept, pruned, backed up,
     which credential reaches it and why, what is lost if the store is lost.

   **Only what is settled goes in, and settled is 3 different things:** a measured fact
   about the world goes in at once, agreement or not; a settled decision goes in the
   moment it settles
   (yours under rule 10 and made, or agreed by the maintainer, whose silence on something
   you flagged as his call is not agreement); an option still on the table does not go in
   at all, and once one wins the doc records why the winner won. The test: **could you write the sentence as a flat assertion with no hedge?**
   "Bodies live in a private Supabase bucket" is a doc sentence; "we are weighing a bucket
   against the database" is not; "bodies will *likely* live in a bucket" is the failure,
   because a future reader drops the hedge.

   **The tell: reasoning that ends up inside a GitHub issue body.** An issue holds the
   task; a doc holds why the alternative lost. A rejection rationale, a ranked-tradeoff
   list or a "reconsider only if X" condition in an issue is a decision wearing a task's
   clothing: put it in the doc and have the issue link to it.

   Existing issues get the same care: when shipped work or a recorded decision changes
   one (done, half-done, re-scoped, obsolete), update or close it in the same session. A
   periodic triage pass is the backstop, not the mechanism.

   **Categorize every issue at creation; the Roadmap board (org `alethical-org` Project #1
   "Alethical Roadmap") is the source of truth.** The 8-axis scheme, the
   create-then-set-board-fields sequence, the uncategorized-item sweep and the board
   lifecycle live in skill **`file-github-issue`**: invoke it before `gh issue create` and
   when moving an item's Status.

   **Only ever set item field *values* and board membership; never restructure the
   project's fields, options or views.** The maintainer's saved Epic, Milestone and Board
   views group and sort by each option's identity and order. The 4 authorized mutations,
   plus the `gh` label and milestone flags: `updateProjectV2ItemFieldValue`,
   `addProjectV2ItemById`, `addSubIssue`, `unarchiveProjectV2Item`. Off-limits without an
   explicit in-session go-ahead: `createProjectV2Field`, `deleteProjectV2Field`,
   `updateProjectV2Field` (which renames a field or adds, renames, reorders or deletes a
   single-select option). When work seems to need a new Epic, option or renamed field,
   propose it and let the maintainer make the structural edit, then fill in item values.
   To defer or recategorize, change the item's field value or move it to a
   higher-numbered milestone, never the option itself.

5. **Verify cheap repo facts before deciding on them.** A claim one `diff`, `git log` or
   `grep` away from certain (which version is newer, does the model have that field, is
   the file gitignored) is checked before building work or advice on it. Scope and timing
   claims are the flagship case: never assign MVP, post-MVP or milestone timing from
   memory; check `gh issue list`, the milestones and
   `docs/product-onboarding/product-scope.md`, and cite the issue, milestone or spec
   section that grounds the claim.

   **One verified instance is not a count.** Confirming a case and then writing a sentence
   about the population verifies the case, not the sentence, and it passes every review
   because the checkable part is true. **The tell is a plural or general subject on
   singular evidence**: "the numbers are accurate", "the download lags amendments", "the
   sessions collided", "gifts of $200 or less are never named". Before writing one, ask
   how many you looked at and how many there are, then count them or narrow the sentence
   to what you counted; "on the committee I checked" is 5 words and true. A money page
   sentence once named a direction false on 33 of 76 disagreeing committee-years after 1
   committee was read; a download was found to both lag amendments and double-count a
   filing; a "3 sessions collided" claim was 5 pull requests in an hour, countable in 1
   command. The product-facing form is `.claude/rules/grounded-answers.md` rule 11; this
   rule applies it to our own writing: issues, PR bodies, docs and messages to each other.

   **The mirror, which feels like rigour and is not: a flawed route to a claim does not
   make the claim false.** When your evidence for something turns out unsound, re-test the
   claim before withdrawing it; retracting a correct finding reads as honesty while it
   happens. A flagged rule-number collision was retracted when its diff-hunk evidence went
   stale, while the collision itself was true and another session was acting on it.

   **A carefully verified cause does not verify its consequences.** Measuring a defect to
   the cent says nothing about who saw it. **Reach is its own question, usually a 1-line
   query**: did this render, to whom, how many times? A wrong-direction money defect was
   written up in a PR body, 2 code comments, a guide and 4 issue comments as having
   printed on 33 real pages under named people; nobody saw any of them, because the
   section only draws once a person confirms a committee and the confirmation table held
   0 rows. The second session to repeat it had measured that disproof hours earlier, so
   check your own earlier measurements too: a consequence feels like part of the finding
   rather than a separate claim. "My
   reason was wrong" and "the thing is wrong" are different sentences, and only the second
   retracts; "the code was wrong" and "a reader was misled" are different sentences, and
   only the second is a harm.

6. **After changing what a user sees or can do, search for everything that still
   describes the old behaviour.** Rule 4 covers artifacts you already know are affected;
   this covers the ones you do not.

   **The trigger is any change to observable behaviour, not only a scope change.** Ask
   "could a sentence someone wrote about this screen now be wrong?" It fires on ordinary
   implementation work: a removed label, a removed description, a shipped serialisation,
   1 added dropdown option have each produced a false guide sentence.

   **Plain-English guides drift worse than specs; check them first.** "Docs" includes the
   user-facing guide. Every notable
   feature with its own page or named navigation position (a destination where a reader
   completes a product task; legal and passive status pages do not count) has its own
   plain-English guide in `docs/product-onboarding/`, listed in `docs/README.md`, carrying
   a `<!-- describes: -->` declaration, explaining at minimum the feature's purpose, every
   way in, its
   controls and results, all visible empty, loading and error states, important limits,
   data sources and what happens to reader data. A system design, build spec, mockup or
   code comment is not the guide. The guide exists before the feature counts as shipped,
   and a later behaviour change updates it in the same PR.

   **Enforcement:** behaviour-describing docs declare the code they describe
   (`<!-- describes: <globs> -->`), and `scripts/check_doc_sync.py` fails any PR that
   changes declared code without 1 `Docs check:` line in the body. "None needed" is a valid
   answer; the check forces the look, not an edit. Frozen records (dated audits and
   research) declare nothing.

   **Editing the doc does not satisfy the `Docs check:` line.** An edit is not a read: 2
   PRs an hour apart each updated 1 subsection of the same guide and it shipped
   contradicting itself twice. Read the whole doc and say what you concluded: "Docs
   check: reread ai-models-and-billing.md §4 and §4.1; fixed §4".

   **Grep for the claim your change falsified, not for the name of the thing you
   changed.** False sentences assert a status ("pays full list price") that no
   feature-name search finds; only reading the section does.

   Whenever a decision re-scopes, re-phases, renames or draws a boundary, search for
   artifacts that still describe the old state (`gh issue list --search "<feature
   keywords>"`, `grep` across `docs/` and `.claude/rules/`), update what the search finds
   in the same session, unprompted, and record the result in the PR body ("Stale-reference check:
   #79 rescoped" or "Stale-reference check: nothing affected").

   `grep` cannot see inside binary assets: when a change alters what a doc's image
   depicts, refresh the image in the same change. A chat-attached image is not a file on
   disk; locate the source (screenshots land in `~/Desktop/Screenshot/` as `.jpg`),
   verify the frame, convert to the tracked format (`sips -s format png`). The usual
   converters are not installed; a diagram shipped as both `.svg` and `.png` renders
   faithfully with `qlmanage -t -s <px> -o <outdir> file.svg`, so never defer the refresh
   to a follow-up.

7. **Name things so a newcomer can guess what they are.** Branch names, PR titles,
   filenames, headings and rule names describe the thing literally, in plain words:
   `docs/update-issues-on-scope-change`, not `docs/ripple-sweep-habit`. No metaphors,
   coined terms or conversation-only shorthand. Name for what the change does or decides,
   not where it lands. A coined term that earns its keep is defined in plain words at
   first use in the doc that owns it.

8. **Spell out spec references: file name plus section topic.** In any artifact (docs,
   issues, PR bodies and comments, chat), write the full spec file name and what the
   section is about: "`docs/product-onboarding/grounded-ask-spec.md` §9 (Answer page UI —
   v1 states)", never "the spec §9". A reader of the sentence in isolation knows what is
   referred to without opening anything. Once the full form has appeared in an artifact,
   later mentions there may shorten. The same principle applies to every pointer: issues
   and PRs get markdown links with their titles or a gloss, never a bare number.

9. **Resolve factual claims from the primary source, yourself.** When a fact shown to
   users or baked into product content can be confirmed from a primary source (a bill's
   enacted text, a statute section, an official roll-call record), fetch and read it and
   confirm the exact value (effective dates, verbatim quotes, section numbers, vote
   tallies) before asserting it. Never relay a secondary summary or hand over an
   unverified value with "please confirm". When sources conflict, the authoritative
   primary text wins; state the discrepancy and which source you trusted. A
   confident-but-wrong cited fact is the worst failure
   (`.claude/rules/grounded-answers.md`).

10. **Just do safe, reversible work: act, then report; never propose-and-offer.** The test
    is **blast radius, reversibility and verifiability**, never who thought of it, how big
    it is, which lane it sits in or how late in the session it is. If a change is safe,
    reversible and verifiable: build it, verify it, ship the whole loop (branch, commit,
    PR, squash-merge, deployment, acceptance, worktree and branch retained for follow-up;
    guarded cleanup only when the maintainer requests it) and report. This covers docs, specs, `.claude/`
    rules and config, issues, **and app, front-end, backend and production code**. Rules
    1 and 2 still apply. Zero-behaviour cleanup (a stale comment, a typo, a broken
    cross-link, a reference your own change orphaned) is always in-lane, in any file,
    including code another session just shipped. Rule 14's "surface real ambiguity"
    sharpens this; it never reverses it.

    **Standing autonomy grant.** Schema and data migrations, auth and security, outbound
    communications, production-data runs, outward-facing content and capability copy are
    all act-then-report; "it is propose-first" is never a reason to pause, and where any
    other clause seems to say otherwise, this grant governs. Four grants, each standing on
    its own:

    - **Merge your own low-risk PRs yourself, then summarize**: CI-green, cleanly
      `git revert`-able, behaviour verified (tests plus dev-server QA as applicable),
      degrading safely.

      **Standing explicit authorization to merge and deploy your own PRs.** Every coding
      agent owns the full release loop for every PR it authors: run the relevant local
      tests, open the PR, wait for the current head commit's required checks, mark a
      draft ready, merge it, let the merge trigger the normal production deployment,
      verify production, repair or revert a bad release. This is advance approval for
      `gh pr merge`, enabling auto-merge while checks are pending, deleting the merged
      remote branch, and the deployment triggered by merging to `main`. Never ask for a
      fresh "ready/approve/publish/merge/deploy" confirmation and never stop at an
      approval prompt: request the needed tool permission yourself and continue. GitHub
      does not let an author approve their own PR, so a missing self-approval is not a
      blocker when the required checks are green. This covers the release workflow, not
      wider product scope or an unverified irreversible side effect.

    - **A GitHub outage, cancelled check, stuck queue, failed deployment hand-off or
      unavailable auto-merge is a retry condition, never a stopping point.** Keep the
      owning session alive and drive the same change through: rerun what the service
      cancelled, merge once the current head is green, follow the deployment, spot-check
      live. The task is done only when the merge and the live verification are done,
      never at "PR open", "checks queued" or "GitHub is down".

    - **An additive, reversible, verified migration is auto-merge** (`CREATE TABLE`, a
      nullable column, an index, a new enum value), proven by an
      upgrade→downgrade→upgrade round-trip against real Postgres plus CI green. Railway
      applying it before the new API starts (`railway.json` `preDeployCommand`) **is** the
      deploy path, not a gate. A dry-run-proven, idempotent backfill is likewise
      auto-merge.

    - **Paid production runs are authorized** once you have established that no
      zero-cost path suffices. **Cost alone never gates**: wherever any clause lists money
      as a reason to pause, this grant governs. Applying `workflow-overhead-audit`
      verdicts is in this lane,
      including meaning-preserving rewrites of a rule or skill file.

    **How to verify a merge, in order:**

    - **Every PR merges through the merge queue**, which tests each PR against the
      queue's projected result rather than a `main` that may have moved. Add a PR with
      "Merge when ready" or `gh pr merge --auto`. The queue requires `changes`, `backend`,
      `frontend` and `description-checks` against its up-to-date combined commit.
      Dependabot PRs and auto-merge go through the same queue. A green PR view alone is
      not enough.

    - **"CI-green" means green against the *current* `main`.** That is the queue's job;
      re-run the checks by hand if you ever merge outside the queue or the queue is
      unavailable. A stale green describes a base that no longer exists: 2 PRs green alone
      have been red together with no text conflict, and `main` broke for 30 minutes. As a
      fallback, compare the check run's timestamp to `git log -1 --format=%cI origin/main`;
      if `main` moved, re-run after a rebase. The queue protects against `main` moving
      between a PR's last green run and its merge; it does not replace human review, and a
      PR still needs its required checks to pass on the queue's speculative commit.

    - **Verify against the head SHA, not the PR view, and wait on the required checks by
      name.** `gh pr checks` can lag a force-push and report the previous commit's green.
      Missing checks are not passing checks. The required names are `changes`, `backend`,
      `frontend` and `description-checks`, all from GitHub Actions. The `changes` job
      checks document references, quoted claims, secrets and invalid bytes; the separate
      `description-checks` job reads the latest explanation, including after a
      description edit. Choose the newest run for each required name so an older success
      cannot hide a newer failure or make duplicate runs look unfinished forever:

      ```bash
      set -o pipefail
      check_sha=$(git rev-parse HEAD)
      # For queue verification, use the actual merge-group SHA instead.
      while :; do
        check_state=$(gh api \
          "repos/alethical-org/alethical/commits/$check_sha/check-runs?per_page=100&filter=all" \
          --paginate --slurp | jq -c '
            ["changes","backend","frontend","description-checks"] as $names
            | [.[].check_runs[] | select(.app.id == 15368)] as $runs
            | [$names[] as $name
              | ([$runs[] | select(.name == $name)] | max_by(.id)) as $run
              | {name: $name, status: ($run.status // "missing"),
                 conclusion: $run.conclusion}]
          ') || exit 1
        if printf '%s' "$check_state" |
          jq -e 'all(.[]; .status == "completed")' >/dev/null; then
          break
        fi
        sleep 10
      done
      printf '%s\n' "$check_state" | jq .
      printf '%s' "$check_state" | jq -e '
        all(.[]; .conclusion == "success" or
          ((.name == "backend" or .name == "frontend") and .conclusion == "skipped"))
      '
      ```

      Then read each `conclusion`: a path-filtered `skipped` is normal (backend-only PRs
      merge with `frontend` skipped routinely), but `skipped` is never evidence of passing,
      and neither is a missing check. **The convenient view is the stale one.** `gh pr
      view`'s mergeable flag, `gh pr checks`' summary and a session-start "N commits
      behind" snapshot are caches; git refs and the commit's own check-runs are the facts.

    - **Green checks are not the only merge gate: 1 unresolved review thread blocks the
      merge** (`required_conversation_resolution` is on), with `mergeStateStatus: BLOCKED`
      while every check is green, 0 approvals required and the branch up to date. Confirm
      the real reason:

      ```bash
      gh api graphql -f query='{repository(owner:"alethical-org",name:"alethical"){pullRequest(number:NNN){reviewThreads(first:20){nodes{isResolved path line comments(first:1){nodes{author{login} body}}}}}}}' --jq '.data.repository.pullRequest.reviewThreads.nodes[]|select(.isResolved==false)|"UNRESOLVED \(.path):\(.line)"'
      ```

      **If a PR review finds an issue that unambiguously needs addressing, address it**:
      fix and push, never resolve the thread to unblock the merge or debate it in
      comments. The reviewer can be wrong (check the claim against the code and measure
      whether it is reachable), but "the PR is blocked" is a reason to read the finding,
      never to clear it; a resolve-and-merge once nearly shipped a reviewer-caught
      violation of the missing-versus-zero rule.

    **You are in the lead on this platform's product management and engineering.**
    Identify, prioritize and sequence the work yourself and carry it to done. When a task
    names a goal or an area but not a step list, enumerate the items, order them
    unblocked-and-highest-value first, and work through all of them.

    **THE HARD LINE, the one thing that stops a build.** Never let a build fire an
    irreversible external side effect unverified: a real send to real users, real money
    on an unverified run, a destructive or irreversible production data, schema or access
    change. Honor it by **engineering, not by asking**: build the capability fully, keep
    the live trigger behind config (env or flag, dry-run default off), verify with tests
    plus a dry run and a scoped single-record live check read back. An additive,
    reversible, verified migration or backfill is not this.

    **Reserved stops, exactly 2, alongside the hard line.** (1) A genuine **toss-up**: no
    basis to prefer an option, so surface it briefly and lead with a recommendation, never
    a bare menu. (2) A genuine **correctness or verification gate you cannot establish**,
    which means *investigate* the gate (measure it, read the source, sample the data) and
    act on what you find; never "stop because a gate might exist".

    **Not valid reasons to stop**: it was not explicitly requested; you recommended it
    rather than the user; it is a big build; it is polish rather than critical path; it is
    backend, app or production code; it is late in the session or your context is
    filling; "this is better as a fresh session"; it is another session's code; it sits in
    a later milestone; a task prompt said "propose-first" (read that as *verify especially
    carefully*); a fancier gated option exists beside your safe one (ship the safe one,
    flag the gated one separately). Ending a turn with "want me to…?" for something safe
    and reversible **is** the handback this forbids; your recommendation is the go. On a
    real blocker, say so in 1 line and switch to the next-best unblocked work.

    **External account identity and routine setup choices are implementation details.**
    Create and use Alethical developer and vendor accounts through Google sign-in with
    `alethicaldev@gmail.com`; never a maintainer's personal Google or GitHub account. Use
    `Alethical` as the organization name, decline optional marketing and data sharing,
    choose the lowest-cost plan that meets the established need, and the data region that
    matches Alethical's operating location (United States). A setting being permanent does
    not make an obvious fact-based choice a toss-up. Stop only when established facts
    point to competing legal or operating needs, or when the hard line applies.

    **The danger category is writes into a shared checkout, not git commands.** `cd` into
    the shared checkout followed by `cat >> file`, `> file`, `sed -i`, `rm` or a formatter
    writes into everyone's shared tree, and no hook, lock, sandbox or rule guards any of
    them. **Check your working directory before any write, not only before a git
    command**, and prefer absolute paths into your own worktree over a `cd`. Recovery, if
    you write there: prove the diff is purely additive and entirely yours before touching
    anything, move the content into your worktree, then `git checkout HEAD -- <path>`
    scoped to that path, never a blanket reset.

    **Never run destructive or branch-switching git on a shared checkout.** `git reset
    --hard`, `git checkout .`, `git clean -fd`, discarding a stash and `git checkout
    <other-branch>` on a checkout other sessions may be using silently wipe their
    uncommitted work. Inside your own worktree these are safe. If you must touch a shared
    checkout, only ever add, never discard. Five more operations read as harmless and are
    not:

    - **`git stash`, creating one, not just dropping one**, scoops up every other
      session's in-flight edits, and popping re-applies an older snapshot on top, silently
      moving merged code backwards (it has un-merged a just-shipped production fix). To
      compare against another revision, never touch the working tree:
      **`git show origin/main:<path>`** reads it from the object store.
    - **`git update-ref` pointed at a branch you do not own.** `git update-ref
      refs/heads/<b> <commit>` moves a branch another worktree holds, silently, with no
      output; `-d` deletes one where `git branch -D` refuses. No git version guards
      plumbing; this is a rule, not a mechanism.
    - **`git checkout --ignore-other-worktrees -B <branch>`** defeats the guard git 2.44+
      added (plain `checkout`, `switch`, `rebase`, `branch -f` and `branch -D` all refuse a
      branch another worktree holds; the `git` on `PATH` is Homebrew's 2.55.0). Treat a
      refusal as git telling you the branch is someone else's, never as an obstacle to
      route around. When reporting git behaviour, say which git, invoked how:
      `/usr/bin/git` is Apple's unguarded 2.39.5, which cannot be removed, so anything
      calling that absolute path gets the old silent behaviour.
    - **`git worktree remove --force <path>`** deletes a worktree and its uncommitted work
      in 1 command, in every git version. The tracked hook `.githooks/post-checkout` locks
      every new worktree at creation, whichever tool ran `git worktree add`, so the command
      refuses and prints the lock reason; `just worktree-rm <branch> <owner-id>
      '<delivery evidence>'` queues guarded cleanup, which preserves recovery and rechecks
      ownership before unlocking. The hook's limits: it covers only worktrees created
      after `just install-hooks` registers it in that clone (a fresh clone is
      unprotected), `--force --force` overrides it, `git worktree unlock` clears it, and
      the hook file must stay executable (mode `100755`).
    - **Creating a branch in the shared checkout at all** yanks that checkout off `main`
      while another session is using it. Branch in your own worktree (`just worktree
      <branch>`).

    **A blank-message jump in `main`'s reflog is our own desktop tooling, not a rogue
    `update-ref`.** Claude Code's desktop app fast-forwards local `main` every time it
    creates a worktree: `git merge --ff-only` when the base checkout holds `main` and its
    HEAD is where the app expects, otherwise `git update-ref refs/heads/main <origin/main>
    <old-sha>`, logging and continuing when either is refused. `update-ref` without `-m`
    writes an empty reflog message, so `git reflog show main` carries entries with no text
    at all. Read one of those as routine before suspecting the `update-ref` bullet above.

    **Orca's "Keep Local Main Up to Date" stays off** (`refreshLocalBaseRefOnWorktreeCreate`
    in `~/Library/Application Support/orca/profiles/local-default/orca-data.json`; Orca's
    workspaces are worktrees of this same clone). When `main` is checked out nowhere its
    refresh is a safe compare-and-swap `update-ref`; when `main` *is* checked out it runs
    **`git reset --hard origin/main`** in that worktree, gated only by an earlier `git
    status --porcelain --untracked-files=no` with nothing re-checked between the two. That
    reset loses a tracked edit saved in the window and silently overwrites an untracked
    file whose path the incoming commit tracks. Claude Code already keeps local `main`
    current the safer way. To refresh local `main` by hand, `git fetch origin main:main`
    is fast-forward-only and touches no working tree.

    **Treat all of that as bounded loss, not prevention.** When tested against a live
    agent, every lock and deny rule surfaced as an approval prompt, not a wall, and each
    destructive command succeeded after approval. What bounds the loss is **`just install-wip-backup`**:
    every 5 minutes, each worktree's uncommitted work is captured into a
    `refs/wip-backup/<unique-id>` ref plus a verified bundle outside the repo
    ([working-folder cleanup and recovery](../../docs/operations/worktree-lifecycle.md)).
    It stages into a temporary index so no worktree's own state is touched, pushes nothing
    (the repo is public; uncommitted work is unreviewed), survives worktree deletion and
    `git gc`, and costs nothing per run.

    **In a shared checkout, treat the working tree and every ref as someone else's live
    state.** Read from git's object store, write only in your own worktree. When you do
    disturb one, verify before repairing: prove the tree matches a known commit before
    restoring anything, then use `git restore <path>` or `git checkout <commit> -- <path>`,
    never a blanket reset.

    **Per-domain verification checklists** (front-end, backend, migrations, paid runs,
    unreachable-code removal, sweep-the-pattern scope, concurrent-session commit and merge
    mechanics) and the incident history behind each grant: skill
    **`when-to-act-without-approval`**. The skill carries what to verify; the authority is
    resident here, so a change is never held for approval merely because the skill was
    not loaded.

11. **Lead issues, PRs and substantive comments with a plain-language "Net:" line.**
    Every GitHub issue, PR body and substantive comment opens with a 1 to 2 sentence
    **Net:**: the bottom line in plain words a non-specialist maintainer can act on (what
    it means, what to do, why it matters), not the mechanism. The technical detail follows
    in the body. A reader who reads only the Net line still comes away knowing the point
    and the ask.

    **Two levels, not one.** Beyond the overview Net at the top, **every
    acceptance-criteria or checklist item carries its own inline `— Net:` gloss**: the
    plain-language what-this-means and why-it-is-checked for that item, in a short clause,
    with the technical criterion kept. When editing an existing issue or PR that lacks
    this, retrofit both levels. This applies to the issues and PRs you author or own; do
    not rewrite another session's merged artifact; add a Net comment there instead.

    **A clear instruction to proceed is approval for every routine review checkpoint in
    that task.** When the maintainer says to start, continue, finish or do a task, do not
    pause at design, specification, test or similar review gates. Record the decisions,
    run the checks, report the completed result. Pause only for a hard safety gate (rule
    10's hard line), a genuine ambiguity about intent, or an explicit request to review a
    checkpoint.

12. **Expensive background research is checkpoint-and-resume; never let it run into paid
    overage.** Multi-agent research runs are the costliest thing a session does, and any
    usage meter can run out mid-run. Checkpoint at launch, stop the run before a meter hits
    its limit rather than burning into overage, and resume from the journal cache. **Never
    promise a threshold stop without arming a mechanism**: the agent cannot see the meters
    and does not run between turns. Full mechanics: skill **`resume-research-workflow`**.

13. **Staff every goal-supporting issue; delegate the ones you are not doing yourself;
    milestone never gates this.** When a goal touches more than 1 outstanding issue,
    *every* issue that supports reaching that goal has an **active owner**: this session,
    a running session you have confirmed, or a fresh session you prompt with a
    self-contained, direct-address brief; never unstaffed in the backlog. As you work a
    goal, enumerate the issues it depends on or spins off (including the durable fixes
    behind any interim patch you shipped and the honest fix behind any design item you
    declined), give each an owner, and tell delegated sessions to coordinate through the
    issue's comments. After delegating, **monitor** the sessions and **finish any dependent
    integration** yourself.

    **Every delegation brief ends with an explicit report-back instruction:** *"when you're
    done — PR merged or work blocked — `send_message` this session (name + id) with the
    outcome (PR #, merged/blocked, anything I need to integrate)."* Never rely on the
    background task-completion notification: it fires only when the session's process
    ends, which can lag a merged PR by hours or never arrive within your turn. Include your
    own session identity in the brief.

    **A blocker only a fresh session can clear is a staffing job, not a status report.**
    When the way past a blocker is "a new session has to do this" (a setting that only
    takes effect on restart, a permission gate this process cannot clear, auth or a tool
    this session lacks, a context window too full to finish), **starting that session is
    the work**: file the self-contained brief at once, unprompted, then carry on with
    everything the blocker does not touch. Ending a turn with "start a fresh session and
    run this" is the handback this forbids.

    **Milestone is irrelevant to staffing.** Milestones group and report work; they are not
    a defer signal. If an issue supports the goal at hand, staff it now regardless of its
    bucket, and re-milestone it if the bucket no longer reflects reality. Catching
    yourself parking a supporting issue as "it's v2" is the trigger to give it an owner.

14. **Write the change with discipline: think, minimum, surgical, goal-driven.** (Bias
    toward caution over raw speed; for trivial changes, use judgment.)

    Every authorized menu build also follows [design-principles.md, Build acceptance for
    controls](../../docs/design/design-principles.md#build-acceptance-for-controls),
    including open-menu display order and pointer movement checks even when the drawings
    omit them. Apply settled functional corrections during the build.

    - **Think before coding.** State assumptions; surface real ambiguity and tradeoffs
      rather than picking quietly; push back when a simpler approach exists. When a
      request spans independent subsystems, say so up front, name the pieces and the
      order, then take them one at a time: a scoping statement, not an approval gate.
      Surfacing ambiguity never gates routine, reversible work; rule 10's autonomy norms
      stand.
    - **Simplicity first.** Ship the minimum code that solves the problem: no features
      beyond what was asked, no abstractions for single-use code, no speculative
      flexibility, no error handling for impossible cases. If 200 lines could be 50,
      rewrite it. The test: would a senior engineer call this overcomplicated?
    - **Surgical changes.** Touch only what the task requires. Do not improve adjacent
      code, refactor what is not broken or restyle to taste; match the surrounding code
      even where you would do it differently. Remove only what your own change orphaned;
      flag pre-existing dead code rather than deleting it unasked. Every changed line
      traces to the request.
    - **Goal-driven execution.** Turn the task into a verifiable goal before starting:
      "fix the bug" becomes "write a failing test that reproduces it, then make it pass";
      "refactor X" becomes "tests pass before and after". For multi-step work, state a
      brief plan with a verification check per step.
    - **Record shared impact and prevention.** Apply the shared
      [PERSONAL_RULES.md guidance on considering the whole system while keeping execution scoped](https://github.com/euglopi/tool-settings/blob/main/shared/PERSONAL_RULES.md#decisions-act-on-my-recommendation-report-after)
      to all substantive work. Keep its concise impact-and-prevention record in the
      existing issue, task plan or review, not a new chat template. Revisit it when
      material findings change the scope and before completion; reconcile it with the
      delivered result. Give independent reviewers the affected uses and approved
      differences, and ask what the change or prevention checks missed. Preserve explicit
      holds and obtain approval for new product scope; a shared cause is not permission to
      change every exposed surface.
    - **Accept the complete rendered design, including reused sections.** UI releases
      complete the design comparison record and independent review in
      [design-principles.md §Build acceptance for controls](../../docs/design/design-principles.md#build-acceptance-for-controls).
      The approved design defines what to check; the code changes do not limit it.
      Preserve a focused browser regression check for a shared visual failure, and run it
      before release.

15. **Two independent reviews of the same artifact end with a side-by-side merge, not a
    verdict pick.** When 2 reviewers (human, Claude, Codex, Design, any mix) produce
    overlapping lists (blocking criteria, findings, checklists, harm categories), lay the
    lists side by side and take the **union** before arbitrating any conflict. A
    disagreement between 2 plausible versions usually means **both are incomplete**: each
    author defends their own additions and silently drops the other's, and neither can see
    that from inside their own list. In 1 design review, 2 independently written blocking
    bars each carried a harm category the other missed, and the union surfaced only when a
    third reading put them side by side. — Net: when 2 reviews disagree, combine them
    first; picking a winner throws away the loser's catch.

    - **A claim about what code contains names the commit it was checked at.** Reviewers
      at different commits may be describing different behaviour.
    - **A citation must contain its claim.** Cite file, function and pinned commit, never
      a bare commit hash: the pin makes it durable, the file and function make it
      checkable. A right conclusion under a wrong citation is record drift waiting to be
      believed.

16. **State each rule once, in the present tense, in one place.** A doc says what is true
    now. It does not narrate how we changed our minds, and it does not restate a rule
    another file owns. Git holds the history, and a GitHub issue holds the long version
    of any incident. This extends the delete-a-stale-doc rule in `docs/folder-structure.md`
    (retired docs are deleted, not kept) from whole files down to sentences. — Net: an
    agent loading these files must receive 1 unambiguous instruction per subject, never an
    average of past and present guidance.

    **The test on any sentence about the past: is this an instruction, or evidence for
    one?** Two instructions is the bug. One instruction and its evidence is the design.

    **Cut:** a superseded design still described in a spec; the same rule written out in
    its own words in more than 1 file; a rule stated twice in 1 file, once live and once
    dead; dated decision narration, such as a sentence saying a step replaces an earlier
    one or that a rule once worked the other way, or a fact pinned to "as of" a month.
    Where old behaviour must stay gone, ban it in the present: "never write X", not the
    story of X. Added doc lines carrying such narration
    fail CI (`scripts/check_timeless_docs.py`, added lines only; a genuine evidence line
    escapes with `<!-- timeless-check-ignore: <why> -->`).

    **Keep:** the dated measurement or incident sitting under a rule, compressed, because
    a rule whose cost is invisible gets reasoned around; the approval status and any
    decision date needed to distinguish approved scope from a proposal; dates a published
    page is required to print. Evidence follows its rule, never leads it, and never reads
    as a second instruction.

    **Write decisions in Alethical's voice, without internal personal attribution.** In
    repository documentation, rules, comments and GitHub descriptions, state the goal,
    requirement or approved decision directly. Name Alethical when the organization
    matters; otherwise omit the actor. Do not name internal individuals as the person who
    requested, decided, approved or wanted something. Use the responsible role only when
    an outstanding approval or action needs an owner. Preserve the exact approval status,
    scope, date when material, evidence, uncertainty and holds. This does not remove
    factual team biographies, event roles, source attribution, required credits,
    public-record identities or functional account identifiers.

    **Summarize instructions; never reproduce the conversation.** Replace verbatim
    internal requests, chat shorthand and instruction quotations with clear,
    self-contained explanations of the intended outcome, relevant context and limits.
    Improve clarity without inventing requirements, turning a proposal into approval or
    broadening a scoped exception. Do not replace a person's name with Alethical while
    leaving a transcript-shaped sentence. Exact source quotations, fixed interface
    wording, commands and test inputs remain exact when their bytes or attribution
    matter. Apply both requirements to existing writing when updating it, including dated
    records; their exemption from the history-narration check is not an exemption from
    these writing requirements. The added-line checks in `scripts/check_timeless_docs.py`
    catch common attribution and quoted-direction patterns; review must also catch
    meaning that pattern matching cannot establish. A genuine attributed public-source
    quotation that triggers the check may carry
    `<!-- doc-voice-source: https://source.example/record -->` on that line, with its
    actual source address; this is not an escape for internal conversation or approval
    records.

    **One owner per subject.** A doc either owns a subject or links to the owner. Where
    reader-facing prose must state a rule in reader words, every copy carries the owner's
    sentence word for word; nothing enforces that automatically, so a change to the
    owner's sentence greps for its copies in the same PR.

    **A rule and the check that enforces it ship as 1 change.** When 2 copies of a rule
    disagree, the enforcing copy wins in practice, because an agent obeys the specific
    message it is handed over a general rule sitting in a file.

    **Strictest in the files loaded into every session** (`.claude/rules/`, `AGENTS.md`);
    normal in specs and guides; not applied to dated snapshots: measurement logs, dated
    research findings, and the source files of posted pieces (`docs/published-writing/`),
    which `.claude/rules/grounded-answers.md` rule 13 (signed research publishing order)
    already governs.
