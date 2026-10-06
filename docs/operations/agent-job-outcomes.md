# Measure agent jobs by working results

<!-- describes: scripts/agent_job_outcomes.py -->

Net: Record each authorized job from its start through its working result. Count
failed, blocked, paused and unfinished jobs too. Unknown help, repeats and AI
spending stay unknown.

## Approved scope and intent

On 6 October 2026, Eugene approved the recommendation to measure completed jobs,
time to a working result, human interventions, repeats and AI spending:
“approved begin all rec work and then lmk what else we should do to continue
working toward mastering advanced steps correctly and safely”. This approval
covers this hand-run record and report, alongside the other approved work. It
does not approve new paid recurring agents or larger autonomous powers.

[workflow.md rule 10 (safe work through live release)](https://github.com/alethical-org/alethical/blob/main/.claude/rules/workflow.md)
already requires current checks and a working live result for releases.
[philosophy.md principle 1 (truth before voice)](https://github.com/alethical-org/alethical/blob/main/docs/philosophy.md)
requires honest limits. [jobs-and-scripts.md (what starts and what costs money)](https://github.com/alethical-org/alethical/blob/main/docs/operations/jobs-and-scripts.md)
owns existing scheduled work and spending boundaries. The new change is a
private record of job outcomes; it adds no release gate or automatic AI run.

## Register, start and finish a job

Use a private directory outside Git. Set its permissions so only its owner can
read it. Keep prompts, credentials, callback addresses, private reader data and
raw logs out of the record. Use short job titles and safe evidence references.
The helper itself makes saved record files readable only by their owner.

```bash
mkdir -p "$HOME/.local/state/alethical-agent-jobs"
chmod 700 "$HOME/.local/state/alethical-agent-jobs"
python scripts/agent_job_outcomes.py template \
  --job-id example-job --title 'Example authorized job' --agent 'Codex task identifier' \
  > "$HOME/.local/state/alethical-agent-jobs/job.json"
python scripts/agent_job_outcomes.py record \
  --ledger "$HOME/.local/state/alethical-agent-jobs/jobs.jsonl" \
  --input "$HOME/.local/state/alethical-agent-jobs/job.json"
```

`template` prints a planned job with measurements set to `null`, meaning unknown.
Set `ui` and `deployable` to match the actual work. Before the work starts, set
`state` to `in_progress` and `started_at` to the actual time, including its
timezone, for example `2026-10-06T09:00:00-04:00`. Save the change:

```bash
python scripts/agent_job_outcomes.py update \
  --ledger "$HOME/.local/state/alethical-agent-jobs/jobs.jsonl" \
  --input "$HOME/.local/state/alethical-agent-jobs/job.json"
```

Keep the same job ID. Each update adds a numbered snapshot. Reports use the
latest snapshot for each job, so finishing 1 job never counts as 2 jobs.
Simultaneous writers take turns, duplicate registrations fail, and a new
snapshot becomes visible as a whole. Invalid input leaves saved history intact.
An existing start time cannot move forward to make the job look faster.
UI or release obligations already set on a started job cannot be removed to
avoid completion evidence; newly discovered obligations may be added.

Use `blocked`, `paused` or `failed` when that is what happened. A failed job has
a finish time. A paused or blocked job remains unfinished. A planned job has no
start time and is reported separately from attempted work. Reopening a job uses
the same ID and original start time; it removes that job from the completion
count until a new working result is recorded.

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

**Evidence records are attestations, meaning somebody recorded what happened.**
The helper checks the fields and their agreement; it does not fetch GitHub,
open a browser, read the linked artifact, establish a reviewer’s identity or
prove what runs at a live address. A supplied string or a `passed` value is not
independently measured proof. Reports explicitly say `attested`. Source checking
and independent acceptance remain the owning agent’s work. A made-up record can
pass these consistency checks, so the ledger is not a security boundary.

## Measurements and report

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

Proposed next evaluation: record 10 ordinary, low-risk authorized jobs with
their full finish conditions. Examine failures, waits, repeat work, human help,
unknown measurements and retained evidence before proposing broader powers.
This trial target is a proposal, not authorization to launch 10 new jobs. Setup
alone does not establish mastery or justify removing safety boundaries.

- **Cause and evidence:** completion statements and green checks alone do not measure whether the promised result reached readers; the existing release rule requires that distinction.
- **Affected uses:** authorized jobs with and without UI or deployment; UI and live evidence are required only where applicable.
- **Shared correction:** register starts, retain numbered snapshots and count only the latest job record with consistent finish evidence.
- **Prevention:** focused tests reject incomplete and contradictory finishes, duplicate jobs, bad timestamps, negative or nonfinite measures, and false zero claims caused by unknown input.
- **Remaining uncertainty:** supplied sources are not independently fetched; missing registrations, false identities, false zeroes and unavailable per-job costs remain possible.
- **Owner and completion:** the current coding agent owns source inspection and acceptance; a job is counted as a recorded completion only when its applicable evidence, exact commit and finish time agree.
- **Scope:** no historical defect mining, vendor ranking, automatic external calls, recurring paid AI, or policy requiring Eugene to approve every change.

The tests use clearly synthetic records and make no network or paid AI calls.
