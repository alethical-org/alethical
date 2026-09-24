# Reviewing a failed campaign-money collection — decisions

<!-- describes: .github/workflows/collection-failure-review.yml, alethical/pipeline/collection_failure_review.py, alethical/pipeline/collection_run_summary.py -->

**Net:** when the daily campaign-money refresh or the notices collection fails and stays
failed, `.github/workflows/collection-failure-review.yml` opens 1 GitHub issue for the
problem, keeps it current, and closes it only when a later run's own record says every
step finished. A restricted AI reviewer can add a plain-language diagnosis, but that part
is switched off and costs nothing until Eugene approves its limits. Nothing in this
workflow re-runs a collection, changes data, or approves an exception.

Issue: [#2350](https://github.com/alethical-org/alethical/issues/2350). What runs, when,
what it costs, and how to switch the paid part on:
[What runs, when, and what it costs](../operations/jobs-and-scripts.md). The code is
`alethical/pipeline/collection_failure_review.py`; its tests are
`alethical/tests/test_collection_failure_review.py`.

## 1. What starts a review

A review starts when 1 of the 2 watched workflows finishes on `main`, and only for runs
started by its schedule or by a person: the daily refresh
(`.github/workflows/campaign-money-refresh.yml`, named "Refresh campaign money from the
Board") and the notices collection (`.github/workflows/campaign-money-notices.yml`,
"Collect large-contribution notices and disclosure statements"). GitHub starts it with a
`workflow_run` event. Neither watched workflow files a failure issue of its own, so a
failure never produces 2, and neither holds any issue access for that purpose.

- **Never from an issue, a comment, a pull request or a push.** Anything that can be
  started by writing text can be started by anyone who can write text, and a public
  repository lets anyone comment.
- **The watched names are copied from the workflows on `main`**, and a test fails if a
  watched name has no workflow file of that name. A renamed workflow would otherwise stop
  being watched in silence, because GitHub simply never fires the event.
- **A cancelled run counts only when nobody chose to cancel it.** A job that ran past its
  time limit, or a runner GitHub lost, opens an incident. A run a person cancelled, or a
  queued run a newer one replaced, does not. When GitHub records no cause either way the
  run counts, because a cancellation nobody can explain is not one to stay silent about.
  GitHub says who cancelled only in the job's notes, so the reading job holds `checks:
  read` to see them.
- **A person can start a review by hand** for a named run, and must name which workflow
  it belongs to; a run from any other workflow is refused. It is a dry run unless they
  untick that: it reads the real run and the real issues, uses a canned reviewer reply,
  and prints what it would write instead of writing it.
- **A drill is not an incident.** The refresh's hand-started `prove_alerting` run fails
  on purpose and touches nothing. Its review opens an issue titled `Drill:`, spends
  nothing, and closes it at once, which proves the alert reaches GitHub.

## 2. One issue per problem

Every issue carries the label `collection-incident`, opens with a `Net:` line, mentions
`@euglopi`, and keeps its own state in a hidden block at the end of its body. Only issues
the Actions bot itself wrote are read, and only their bodies: anyone can comment, but only
collaborators can edit a bot's issue.

Three hashes decide what a completion does:

| Hash | Made from | What it decides |
| --- | --- | --- |
| Incident key | The workflow, the failed stage, the sorted failed check names, the sorted content hashes of the source files | Whether this exact failure is already on an open issue |
| Failure shape | The same, without the source hashes | Whether a new key joins an open issue as new evidence |
| Evidence hash | The shape plus the failure's own words, with times, dates, durations, counts, run numbers and long hex strings removed | Whether anything has changed since the last comment |

**Why the shape exists, and why evidence leaves the source hashes out.** The Board's
files change almost daily in filing season, so a key that includes source hashes changes
almost daily too. Keyed on that alone, 1 unchanged problem would open a new issue every
night; treated as new evidence, it would add a comment and buy a review every night. So an
open issue with the same shape absorbs the new key quietly, and only new words in the
failure itself count as new evidence. Counts and dates are removed from those words for
the same reason: "281 rows" becoming "305 rows" is the same problem.

What each completion does:

- **First failure:** opens the issue with the plain facts: what failed, what readers are
  missing, what was published first, the error lines, the last good run.
- **The same failure again:** updates the count in the body and adds no comment.
- **Changed evidence:** adds 1 comment with the new facts and, within the limits, 1 new
  diagnosis.
- **A different stage or a different failed check:** a different problem, so a separate
  issue.
- **The same stage, once without the run's own summary and once with it:** 1 problem. A
  run that dies before writing its summary is keyed on the step that failed, and the next
  run describes the same failure by stage, so its key and shape differ. When either side
  lacks a summary and both name the same stage, the failure joins the open issue, and the
  issue takes the summary's shape from then on. The 24 Sep 2026 notices failure opened 2
  issues this way before the rule existed.
- **A later success:** closes an open issue only when that run's own summary says the
  stages that failed have finished, and the run started after the failure (section 5).

2 completions of the same workflow never run the review at once, whether GitHub or a
person started them: the concurrency group is keyed on the workflow name. GitHub lets at
most 1 run wait behind the one running, and a third arrival replaces the waiting one. The
collections run daily or weekly and a review takes about a minute, so that needs 3
completions of 1 workflow inside a minute.

## 3. What the reviewer is shown, and what it cannot do

### 3.1 The evidence packet

The reading job builds a packet from the run: the failed stage and checks, source hashes,
what the run published, affected years and committees, the failed job's error lines and
last 300 log lines, and the last successful run. Every string in it passes through
`redact()` before the packet is stored or sent anywhere. That removes:

- database addresses, passwords in addresses, and any `NAME=value` whose name says
  password, secret, token, key, cookie or credentials;
- Anthropic, OpenAI, GitHub, AWS and Supabase key shapes, signed web tokens and private
  keys;
- whatever follows `Authorization:`, signatures and keys in web addresses (`sig=`,
  `token=`, `key=` and the like), Google keys, and lone private-key lines and key text;
- every email address except those at `cfb.mn.gov` and `alethical.com`, including one
  written with `%40` for the at sign;
- phone numbers, recognised only with their separators, so a date, an amount or a
  registration number is never taken for one.

The packet is uploaded as a workflow artifact, which on a public repository anyone signed
in to GitHub can download. That is why redaction runs first and not only before the AI
call.

### 3.2 Evidence is data, never instructions

Logs, downloaded files, the Board's own text and issue comments can all carry words
written by someone outside Alethical. So:

- The reviewer's standing instructions are fixed text in code. Everything from the run
  goes in 1 escaped JSON document inside `<evidence>` tags, with every `<` and `>` in the
  data escaped, so nothing in a log can close the tag and speak outside it.
- The instructions say that text inside the evidence is data, and that text which looks
  like an instruction is itself a finding to report.
- Issue comments are never put in the packet, and the state block is read only from the
  bot's own issue body, from its last block, so a line copied from a log cannot pose as
  state.
- The reviewer's reply is printed only as quoted advice after cleaning: anything shaped
  like a record hash is removed, because the reviewer may not name a waiver; comment
  markers and HTML are removed, so it cannot forge state; mentions and issue references
  stop linking, so it cannot notify anyone; addresses print as text, not links. Run text
  in the plain facts gets the same treatment except that hashes stay, because they are
  the run's own evidence.

### 3.3 Access, job by job

| Job | Holds | Cannot |
| --- | --- | --- |
| `packet` | Read the run, its logs, its artifacts and its job notes | Touch issues or any secret |
| `record` | Write issues: the alert, and the reservation of any review | See any secret |
| `review` | Read this repository's code, and the AI key from the `collection-ai-review` environment | Read or write issues, read other runs, see any other secret, or run before `record` reserved it |
| `post` | Write issues: print the saved review | See any secret |
| `fallback` | Write issues | Run any of the review's own code |

The workflow grants nothing by default (`permissions: {}`). Every checkout skips storing
the token. Job logs and artifact archives download from a storage address GitHub
redirects to, and that redirect is followed without the token. The AI call follows no
redirect at all, so the key goes only to Anthropic's own address.

**The key lives in an environment only `main` may use.** Anyone with write access can
start a workflow on another branch, running that branch's copy of this code with its
limits edited out. A repository secret would reach that run; a secret in the
`collection-ai-review` environment, limited to the `main` branch, does not.

**Nothing is installed in any job.** The review code uses the Python standard library
only, and a test checks every import. The job that holds the AI key therefore runs no
third-party package that could read it. That is also why this one call is made with a
hand-built request rather than Anthropic's official library, a named exception in
[How Alethical calls OpenAI and Anthropic](ai-provider-calls-and-retries.md) §1.1.

### 3.4 What version 1 does

It diagnoses and recommends. No code path lets the reviewer's words run a command, re-run
a job, change data, name a waiver hash, approve an exception, merge or publish. A person
reads the diagnosis and decides.

## 4. The paid reviewer and its limits

### 4.1 Model and effort

The reviewer is `claude-opus-5-5` with adaptive thinking at effort `high`, read against
Anthropic's model overview, pricing and effort pages on 23 Sep 2026.

- **Why Opus 5.5.** Anthropic's guidance is to start with Opus 5.5 for most work and to
  use Fable 5.1 for long-horizon agentic work, or where Opus at a higher effort still falls
  short. This is 1 bounded call over a fixed packet, with no tools.
- **Why not Fable 5.1.** It costs 2.5 times as much per token ($10 and $50 per million
  against $4 and $20), and there is no evidence yet that Opus falls short on this task.
- **Why not Sonnet 5.** It costs half as much, but a diagnosis of a failed data check is
  judgement-heavy, a wrong one costs a person's time, and the whole difference is about
  $0.22 a review at the caps.
- **Why `high`.** Anthropic lists `high` for complex reasoning and `xhigh` for agentic
  work running over 30 minutes. Opus 5.5 defaults to `medium`, so the level is set
  explicitly.

The reply must match a fixed schema: what failed, what readers are missing, the likely
cause and its evidence, what is still unknown, the recommended fix, who must act, and a
confidence level. Anything else counts as a malformed reply.

### 4.2 The limits, enforced in code

| Limit | Value |
| --- | --- |
| Switch | Repository variable `COLLECTION_AI_REVIEW` must equal `enabled`, and the `ANTHROPIC_API_KEY` secret must exist |
| Calls per incident per new evidence hash | 1 |
| Reviews per incident | 3 |
| Reviews per calendar month (UTC) | 20 |
| Input | 50,000 tokens, counted with Anthropic's free counting call before any paid call, with 2,000 of them left for the output schema the count does not include; the packet is cut, largest logs first, until it fits |
| Output (thinking plus reply) | 12,000 tokens (`max_tokens`) |
| Time | 300 seconds for the call; the whole step is stopped at 420 seconds |
| Worst case per review | $0.44 (50,000 input tokens at $4 per million, 12,000 output tokens at $20 per million) |
| Worst case per month | $8.80 |

Over any limit means no call, and the issue carries the plain facts with a line saying
why there is no diagnosis. A missing key, an exhausted budget, a provider error, a
timeout and a malformed reply all end the same way. A failed call is never retried.

**Every review is counted before it is bought, at its worst case.** The `record` job saves
the reservation ($0.44, the month, the run) in the incident's own state and adds the
evidence hash, in the same write as the alert. Only then may the `review` job run. So a
posting step that fails, a GitHub outage, a lost runner or a re-run cannot make the same
evidence pay twice, and a reply that was paid for but unusable still counts against the
3 per incident and the 20 per month. Counting at the worst case can only overcount. A
review may only be bought in the same attempt of the run that reserved it, so re-running
just the review job buys nothing; re-running the whole run makes a fresh decision.

**The monthly count lives in the incidents, not in a repository variable.** The
workflow's own token has no permission to write repository variables, and a token that
could would also be able to switch the paid reviewer on. So the `record` job adds up this
month's reservations from the state blocks of the bot's own incident issues, every page
of them. Anything written by anyone else is ignored.

**The one known way to exceed a limit.** Each watched workflow has its own queue, so if 2
different workflows fail within the same minute, both can pass the monthly check before
either writes its reservation: at most 1 review over the limit. The outer wall is a
monthly spending limit on the API key's workspace in Anthropic's console, which
[What runs, when, and what it costs](../operations/jobs-and-scripts.md) asks for before
the switch goes on.

## 5. Recovery, and what "published" means

A collection run writes 1 line per stage into `collection-run-summary.jsonl` through
`alethical/pipeline/collection_run_summary.py`, and uploads it as the
`collection-run-summary` artifact on every run, failed or not. Each line says whether the
stage `published`, finished with nothing new (`unchanged`), `failed`, or was `skipped`. A
script that crashes or refuses before recording still leaves a `failed` line.

Each incident remembers which stages must finish before it counts as fixed: the stages
its run's summary said failed, or, when the run died before writing a summary, the stages
its failed steps run (a map in `WATCHED`). A step every run passes before any stage, such
as the secrets check, needs no stage: any later run that did real work passed it.

- **Recovered:** a successful run, started after the last failure, whose summary names no
  failed stage and says every remembered stage published or finished with nothing new.
  The review comments and closes the issue.
- **Not run again:** a successful run in which a remembered stage did not run at all, as
  when the notices job skips its weekly statements step. The issue stays open and says so
  once.
- **Older:** a successful run that started before the failure. It cannot show the problem
  is fixed, so the issue stays open and says so once.
- **Partial:** a run whose summary names a stage that published and 1 that did not. The
  issue says readers now see a mix of new and old records, and stays open.
- **Unconfirmed:** a successful run with no readable summary. The issue stays open and
  says so once.
- **No work done:** a successful run whose stages were all skipped or dry runs, such as a
  refresh that found another refresh already running. It changes nothing.

A green tick alone never closes an issue, because a run can succeed at the job level and
still have skipped the step that publishes.

**The issue says what each stage did, from the run's own record.** It prints 1 line per
stage: published, finished with nothing new, skipped, or failed. A stage can record how
many things it stored or handled (`counts`), and it records them on failure too. A failed
stage can store records before it stops, and readers can already see those, so "nothing
from this run was written" is printed only when every failed stage's own counts are 0. A
failed stage that recorded no counts reads as "did not record what it stored", never as
nothing. The `Net:` line names the failed stage and says only what that stage's readers go
without. The notices incident of 24 Sep 2026 had said nothing was published and that a
notice was missing, when the statements stage had stored 1,307 entries and 738 PDFs and the
notices stage had finished.

## 6. Retries belong to the collection, not the review

A passing outage should never become an issue, so the collections retry their own
requests and the review never re-runs anything. Both Board download helpers share
`pause_before_retry()` in `alethical/pipeline/campaign_finance_filings.py`:

- A request that never reached the Board is retried up to 6 times over about 2 minutes.
- A server error or a rate limit is retried up to 3 times, waiting 5 seconds, or what the
  Board's `Retry-After` header asks for when it sends one, up to 2 minutes. This covers
  every request to the Board: the filings route, the notices downloads, the payments
  landing page and the payment files.
- An answer asking for a longer wait is final for that run: honouring it means not asking
  again sooner, and the next day's run tries again.
- A refused request (403) is never retried, because asking again cannot fix it.

## 7. When the review itself breaks

If the `packet` or `record` job fails before the alert is written, the `fallback` job
files or updates a plain issue, using only GitHub's command-line tool and no review code,
so the safety net does not depend on its own code working. It finds its own earlier issue
by exact title from a plain listing rather than a search, because search can lag by
minutes, and it does not fire when a person cancels the review run. That issue does not
close itself: a person reads the failed review run.

Every text the workflow writes is cut to stay inside GitHub's limit of 65,536 characters
on an issue or comment, with the state block added after cutting. The notices job's own
alert once died on that limit, on 24 Sep 2026, and so told nobody about a real failure.

Every run that writes or keeps an incident open ends red, like
`.github/workflows/production-release-failed.yml`, so the Actions tab never reads as
quiet while an issue is open.

## 8. Who hears about it

Eugene's GitHub account (`euglopi`) watches the repository (`subscribed: true`, read
23 Sep 2026), so a new issue reaches his GitHub notifications, and each issue mentions
him, which notifies him as a participant as well. Whether a notification reaches his
email or phone depends on his own GitHub notification settings, which this repository
cannot read.
