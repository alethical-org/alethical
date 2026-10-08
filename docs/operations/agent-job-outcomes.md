# Measure agent jobs by working results

<!-- describes: scripts/agent_job_outcomes.py, scripts/agent_job_events.py, scripts/install_agent_job_hooks.py, scripts/check_agent_job_completion.py -->

Net: Record each authorized job from its start through its working result. Count
failed, blocked, paused and unfinished jobs too. Unknown help, repeats and AI
spending stay unknown.

## Approved scope and intent

On 6 October 2026, Eugene approved measuring completed jobs, time to a working
result, human interventions, repeats and AI spending. On 7 October he authorized
the next build: “when done build the earlier recs, astra is set”. That covers shared
local Claude Code and Codex activity recording, source-reading completion checks,
and setup of a prospective 10-job trial. It does not authorize new paid recurring
agents, broader account access or 10 artificial tasks to fill the trial.

[workflow.md rule 10 (safe work through live release)](https://github.com/alethical-org/alethical/blob/main/.claude/rules/workflow.md)
already requires current checks and a working result for releases.
[philosophy.md principle 1 (truth before voice)](https://github.com/alethical-org/alethical/blob/main/docs/philosophy.md)
requires honest limits. [jobs-and-scripts.md (what starts and what costs money)](https://github.com/alethical-org/alethical/blob/main/docs/operations/jobs-and-scripts.md)
owns existing scheduled work and spending boundaries. Recording does not change
release permissions or automatically resume an agent.

## Install and establish host coverage

The same Python runtime handles both local hosts. The adapters subscribe to each
host's supported events; identical reasoning, tool use and full event coverage
across vendors are not promised. Claude web/cloud sessions are not covered by a
local Claude Code installation. Codex cloud orchestration does not run these
local command hooks.

Preview from the reviewed checkout, then install its committed runtime:

```bash
python3 scripts/install_agent_job_hooks.py
python3 scripts/install_agent_job_hooks.py --apply
python3 scripts/install_agent_job_hooks.py --health
```

Use a merged commit for installation. The installer rejects dirty runtime files,
copies committed bytes into a read-only version directory under
`~/.local/share/alethical-agent-jobs/<commit>/`, and saves file hashes. Hook commands
use absolute paths and isolated Python so a checkout cannot replace an imported
helper. No worktree needs to stay open for installed hooks to run.

Existing Claude Code and Codex hook entries, permissions and other settings remain
in place. A Claude settings symlink remains a symlink. Private backups and an exact
rollback record are saved before changing settings. Rollback restores only this
installation's entries and preserves later unrelated edits:

```bash
python3 scripts/install_agent_job_hooks.py --rollback /absolute/private/rollback.json
```

Use the actual rollback path returned by installation. A concurrent settings change
requires a new preview. Do not copy settings backups into Git or task output.

Settings presence is not activation. Reload each host through its supported controls,
review the exact new Codex hooks through `/hooks`, and observe real events in the
registered job. Never bypass hook trust or edit a private trust database. Consult the
[official Codex hooks instructions](https://learn.chatgpt.com/docs/hooks) and
[official Claude Code hooks instructions](https://code.claude.com/docs/en/hooks)
when the installed host changes. Health output separates configured hooks from
observed events. Events may be missing when a host is disabled, has not reloaded,
requires review, crashes or cannot write its private state.

## Register, start and finish a job

Use 1 job ID for the authorized user outcome, including resumes and helpers.
Before substantive work, explicitly register the job with the host's real session
identifier and the repository checkout:

```bash
python3 scripts/agent_job_events.py begin \
  --job-id example-job --title 'Example authorized job' \
  --platform codex --session-id ACTUAL_SESSION_ID --repo-root "$PWD" \
  --trial-eligible
```

The registration reminder supplies the platform and a hashed session identifier.
Use `--session-hash HASH_FROM_REMINDER` instead of `--session-id` when the host does
not expose its raw identifier to the coding agent. Never substitute a made-up ID.
Registration is the owning agent's explicit step; the hook cannot infer permission
from a prompt.

Use `claude` for Claude Code. Add `--ui` when browser acceptance is needed and
`--deployable` when the finish includes a website or API deployment. Use
`--trial-eligible` only for an ordinary already-approved low-risk job. Omit that
flag for high-risk work, setup smoke tests and jobs already underway when enrolled.
The helper records the current time. A late registration is a partial observation,
not a full-task duration; do not backdate it or put it in the prospective trial.

At registration, start the private measurement note described under
[Record help and retries while working](#record-help-and-retries-while-working).
Carry that note through resumes and helper handoffs; activity events alone cannot
establish how much human help or repeated work the job needed.

Resumed conversations and helpers join the same job explicitly:

```bash
python3 scripts/agent_job_events.py bind \
  --job-id example-job --platform claude --session-id ACTUAL_HELPER_SESSION_ID \
  --repo-root "$PWD"
python3 scripts/agent_job_events.py status --job-id example-job
```

`resume` is an alias for `bind`. A conversation can move to its next explicit job
after its prior job is completed or failed. An unfinished job cannot be silently
replaced. Old events remain attached to their original job.

Private state lives in `~/.local/state/alethical-agent-jobs` by default; use
`--state-dir` consistently to choose another private location. `jobs.jsonl` stores
numbered outcome snapshots; `events.sqlite3` stores bindings, event metadata and
trial membership. Keep titles and evidence free of prompts, secrets, callback
addresses, private reader data and raw logs. Directories and files are owner-only.

Automatic event recording stores recognized event names, receipt times, protocol
version and hashes of session/turn/tool/helper identifiers. It does not store
prompts, tool arguments, tool results, transcript content, callback addresses or
raw working directories. Bound conversations remain attached when their working
directory changes. In registered repositories, missing registration produces a
start/prompt reminder with only the platform and hashed session identifier instead
of silently inventing a job. After a completed or failed job, the next start/prompt
reminds the agent to register the next authorized outcome.

Claude prompt identifiers supply the turn identity where available.
A tool event uses its tool-use identifier for duplicate detection; a turn identifier
alone cannot identify several tool calls. Stop and helper events remain separate observations, since the same turn or helper
can stop more than once. Events without an invocation identifier remain
separate observations and are reported as such. A finished reply (`Stop`), an error
or an interruption never completes the job and never starts another agent turn.
Failures to record produce fixed warnings, not copied exception or payload text.

The original outcome helper remains available for truthful state and measurement
updates. Print its template, fill the current values, then update the existing ID:

```bash
python3 scripts/agent_job_outcomes.py template \
  --job-id example-job --title 'Example authorized job' --agent SAVED_AGENT_ID
python3 scripts/agent_job_outcomes.py update \
  --ledger "$HOME/.local/state/alethical-agent-jobs/jobs.jsonl" \
  --input /absolute/private/job.json
```

Copy `agent`, `title` and `started_at` from that job's latest snapshot in
`<state-dir>/jobs.jsonl`; these supply `SAVED_AGENT_ID` and the unchanged job details.
Each update adds a revision;
reports use the latest revision. Unknown measures remain `null`. Use `blocked`,
`paused` or `failed` when that is what happened. A failed job has a finish time;
paused and blocked jobs remain unfinished. A planned job has no start time.
Reopening uses the same job and original start. Started UI and release obligations
cannot be removed to avoid evidence. Newly discovered obligations may be added.



## Evidence needed for completion

Set `state` to `completed` only after the promised result works. Record the full
40-character result commit. For deployable work, also record the exact release
commit actually reached by readers. Completion evidence must refer to that
release commit, or to the result commit for work without a deployment.

Each evidence entry has these exact fields. This example is synthetic and must
never be used as evidence of real work:

```json
{
  "kind": "checks",
  "commit": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  "checked_at": "2026-01-01T10:09:00+00:00",
  "outcome": "passed",
  "reference": "synthetic-test-only/checks.json",
  "observer": "synthetic-observer"
}
```

| Kind | Actual record to retain |
| --- | --- |
| `checks` | Current-commit test and required-check results, with names, outcomes and the exact checked commit |
| `review` | A different reviewer’s identity, acceptance result and review of the final change, including affected uses and missing prevention |
| `browser` | For UI work, actual browser steps and results for the changed reader actions, including the relevant narrow-screen and keyboard paths |
| `live` | For deployable work, the deployed commit identity and the changed behavior exercised at its live address |

All applicable kinds are required. Each kind appears once. Use a safe summary
artifact when 1 kind covers several checks. A failed check, an older commit’s
success, a self-review or an evidence time outside the job’s working time cannot
support completion. Record the finish time after the last required check.

For a release, read GitHub’s check runs on the exact release commit rather than
the pull request’s cached summary. Retain the required names and outcomes.
Missing checks are not passing checks; a skipped suite is not proof its tests
ran. The required-check and merge-queue procedure remains owned by
[workflow.md rule 10 (current checks and release verification)](https://github.com/alethical-org/alethical/blob/main/.claude/rules/workflow.md).
Do not copy private command output into this repository.

## Read sources before saving completion

Use the completion checker for the normal finish. It reads the existing job and a
completed candidate with the same fields as the outcome template:

```bash
python3 scripts/check_agent_job_completion.py \
  --state-dir "$HOME/.local/state/alethical-agent-jobs" \
  --input /absolute/private/completion.json
python3 scripts/check_agent_job_completion.py \
  --state-dir "$HOME/.local/state/alethical-agent-jobs" \
  --input /absolute/private/completion.json --write
```

Without `--write`, the checker does not complete the job. It fetches the required
checks from Alethical's GitHub protection settings, then fetches their results on
the exact final commit, including all result pages and the required GitHub app.
Missing, pending, failed, malformed or stale results cannot complete work. An
allowed skipped suite is identified as skipped, never as tests that ran.

Keep review, browser and live-behavior observations as bounded JSON files beneath
`<state-dir>/evidence/`. Their candidate `reference` is relative to that evidence
directory. Each observation file contains `kind`, `commit`, `checked_at`, `outcome`,
`observer` and a nonempty `observations` list describing what was exercised and what
happened. A live file also names `service` as `website` or `api`. Its timestamp,
identity, kind and commit must agree with the candidate entry. Preserve the actual
independent review and browser evidence; do not invent a passing observation.

The checker reads only the fixed public website or API address for live commit
identity. It refuses redirects and does not execute commands or fetch arbitrary
addresses from evidence. A matching release stamp does not prove the changed
behavior works or that every intended change is included. The independent release
review and retained live-behavior observations must establish those facts. Separate
machine-fetched results from attested review/browser observations in the receipt.
The receipt retains observation hashes without copying observation text. Saving
completion refuses to overwrite a newer job revision, including a pause made
while remote checks ran. The actual finish time follows the final checks.

**Review identities and observed behavior remain attestations.** Reading a file
and checking its hash cannot authenticate a reviewer or prove its sentences true.
The original manual ledger helper still accepts consistent attestations and is
not a security boundary. Its reports explicitly identify that evidence basis.
The owning agent must retain independent acceptance and judge whether the promised
result works. Neither a schema nor 2 agents agreeing is proof of correctness.

## Measurements and report

### Record help and retries while working

The first 2 trial jobs reached working results but could not support complete
help or retry totals across their lead agents and helpers. Counting messages or
tool events cannot repair that gap: a message may be a status question, and a
repeated command may be an intended check. Preserve unknown historical totals.
[Issue 2513](https://github.com/alethical-org/alethical/issues/2513) tracks the
trial; the following procedure applies to future measurements in both local hosts.

1. At the job's start, keep a short private note outside Git with its job ID,
   observation start, responsible agent, and any known coverage gaps. Use the
   definitions below. A note started late cannot establish a whole-job total.
2. Record human help and repeated attempts as they happen. Retain only a safe
   category, count, and enough non-sensitive context to avoid counting the same
   event twice. Do not copy prompts, transcripts, tool payloads, credentials or
   private reader data. Record gaps when observation is interrupted.
3. Give each helper the same job ID and measurement definitions. Ask it to return
   its counts, the period and work it covered, and anything it could not observe.
   The lead owns the combined note; helpers do not write concurrently into it.
   Reconcile overlapping observations rather than adding the same human action
   or retry twice. Retain the note's location and gaps when handing work off.
4. At an outcome update, reconcile the lead and helper notes for each measure.
   Save a whole-job count only when its full coverage is supported; otherwise
   keep that measure `null` and retain known observations privately. `0` requires
   complete coverage with no qualifying events. Missing helper reports and
   unobserved intervals are gaps, not zero. Keep actual times and trial membership.

This is ordinary recordkeeping by the agents already doing approved work. It
does not schedule another agent, guarantee compliance, or infer costs from event
counts. No extra user confirmation is needed just to complete a measurement.

### Measurement definitions

Fill measurements from the actual job record, or leave them `null`:

- `human_interventions`: the count of human actions needed after the original job authorization, including corrections, rescue actions, supplied access and extra decisions; exclude the original assignment and routine reading of progress.
- `repeats`: the count of repeated work attempts after an earlier attempt failed or had to be redone; include repeated failed checks and retries, using the same definition throughout a trial.
- `ai_cost_usd`: the actual AI spending attributable to this job in US dollars, including its helpers and reviews; do not invent a per-job share of a subscription charge.

Counts must be whole numbers at least `0`. Spending must be finite and at least
`0`. Enter `0` only when a complete record supports zero. If a count or cost is
partly unknown, use `null` rather than a known subtotal presented as the whole.
Elapsed time runs from the original start through the recorded working result,
including waiting, pauses, reviews and retries. Unknown start times are not
estimated; an unregistered historical job cannot support a timed completion.

```bash
python scripts/agent_job_outcomes.py report \
  --ledger "$HOME/.local/state/alethical-agent-jobs/jobs.jsonl"
```

The report includes all registered states. Completion rates divide by every
started job, including failed, blocked, paused and unfinished work. Planned jobs
are counted separately. Time to a working result has a median, a maximum and
its completed-job count; unfinished jobs have no invented completion time.
Human-help, repeats and cost totals cover all started jobs. Each total names
how many jobs have known measurements and how many remain unknown; an entirely
unknown total is `null`, not `0`.

The “completed without human intervention” count includes only completed jobs
with a known count of `0`. Its rate uses all started jobs. The report also names
the number of completed jobs with known and unknown intervention counts, plus
measurement coverage. A small subset with known counts cannot silently stand
in for the whole group.

## Trial and impact record

After installation and acceptance, start the prospective trial once:

```bash
python3 scripts/agent_job_events.py trial-start --target 10
python3 scripts/agent_job_events.py trial-report
```

Membership is fixed at successful registration for the first 10 new jobs explicitly
marked eligible. It includes failed, blocked, paused and unfinished jobs rather
than selecting only successes. Existing jobs and installation smoke tests do not
count. Setup does not launch work; the next ordinary user-approved jobs fill the
trial. Do not start new agents or paid schedules to manufacture observations.

After each member job's outcome is saved, its owning coding agent reads
`trial-report`. Once 10 jobs are enrolled, that agent reviews the whole group,
including any unfinished work, before recommending broader powers. This is part
of the ordinary authorized job, not a scheduled AI run.

Review failures, waits, repeat work, human help, unknown measures and retained
evidence before proposing wider unattended work. Ten jobs are a small operational
sample, not proof of mastery or a vendor/model comparison. Explicit eligibility
is an operator judgment, so missed registration and misclassification remain risks.
If a crash interrupts registration between the outcome write and binding, repair
with `bind`; failed enrollment is not silently reconstructed or backdated. Record
that coverage gap when interpreting the trial.

- **Cause and evidence:** manual records missed host activity; a reply ending and green checks alone did not establish a working user outcome.
- **Affected uses:** local Claude Code and Codex, resumed conversations, helpers, non-UI work and website/API releases. Other hosts and unobserved events remain outside coverage.
- **Shared correction:** 1 private job ledger, metadata-only event adapters, a pinned isolated runtime, source-reading completion receipts and fixed prospective membership.
- **Prevention:** tests cover payload privacy, concurrent writers, sequential jobs, duplicate IDs, interruption, missing checks, stale releases, independent review requirements, unsafe evidence paths, protected settings and rollback.
- **Remaining uncertainty:** host coverage can be incomplete; reviewer identity and behavior observations are attested; cost/help/repeat measures may be unknown; failed enrollment is a coverage gap.
- **Owner and completion:** the current coding agent owns explicit registration, source inspection, independent acceptance, installation health and truthful completion. Only naturally occurring trial results support its later assessment.
- **Scope:** no historical mining, vendor ranking, raw transcript collection, paid recurring agents, automatic continuation, wider permissions or policy requiring Eugene to approve each ordinary change.

Tests use synthetic records and mocked source responses; they make no paid AI calls.
