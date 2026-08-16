# How Alethical Calls OpenAI and Anthropic, and When It Retries

> **Net:** Use the official OpenAI and Anthropic Python libraries for model calls,
> but keep Alethical in charge of time limits, total tries, answer checks, honest
> failure messages, checkpoints, and spending limits.
>
> **Status:** This is an accepted decision and implementation plan. It does not
> claim the library change has shipped. The work is split across the linked GitHub
> issues below.

## 1. The beginner version

Alethical currently writes many OpenAI and Anthropic web requests by hand. That is
like writing the address, postage, and delivery form on every package ourselves.
It works, but we must keep up with every small provider rule.

An official software development kit (SDK) is the provider's maintained Python
library. It prepares the request, adds the key in the required way, reuses network
connections, names common provider errors, and turns the reply into known Python
objects.

The official library is a good default for Alethical. It is not a complete
reliability policy. Both providers can retry automatically, and that hidden retry
can multiply Alethical's own retries. A plan for 2 total tries can quietly become
6 paid calls.

The durable answer is:

1. Use the official OpenAI and Anthropic Python libraries for ordinary provider
   calls.
2. Turn each library's automatic retries off (`max_retries=0`).
3. Put a small Alethical-owned helper around each provider.
4. Give every job 1 tested total-try limit and 1 tested time limit.
5. Keep answer truth checks, saved progress, and reader-facing failure behavior in
   Alethical.

This is “use the SDK by default,” not “let the SDK decide everything.”

### 1.1 The named exceptions

The default does not erase the few paths that need a different tool:

- Claude Code and Codex command-line summary paths use subscription logins, not
  provider API keys. They remain separate.
- The answer comparison runner (`scripts/answer_eval.py`) needs a raw-web-request
  control arm while it compares today's route with the official-library route. It
  must import the full production prompt and request settings so the control stays
  honest. Keeping a measured control is not permission for product code to add new
  hand-built requests.
- Anthropic's documented `max_tokens=0` cache warm may remain 1 named raw request
  only if the official library rejects 0 before sending the call.

Any new raw OpenAI or Anthropic product call must name the provider feature the
official library cannot express and include a test for that claim.

## 2. What is wrong today

### 2.1 A reader can wait for several minutes

A single Ask request can use 4 outside AI steps. Each step has its own clock, but
there is no clock around the whole reader request.

| Step | Protection today | What a lasting failure can look like |
| --- | --- | --- |
| Sort the question | 1 try with a 30-second limit | Alethical uses its key-free word-matching fallback |
| Turn the question into search numbers | Up to 4 tries, each with a 60-second limit, plus 1-, 2-, and 4-second waits | The website can receive a server error |
| Choose 1 bill from likely matches | 1 try with a 30-second limit | A provider failure can look like “no bill matched” |
| Write the cited answer | 1 try with a 30-second limit | The website can receive a provider error |

The longest path allowed by those separate limits is about 337 seconds:

`30 + (4 × 60 + 1 + 2 + 4) + 30 + 30 = 337 seconds`

The search-number step already retries dropped connections and timeouts. The old
claim that none of these calls retries was wrong. The real problem is that the live
reader path shares the 4-try, 60-second rule built for an offline corpus job.

### 2.2 A provider outage can be reported as a reader mistake

The bill chooser returns the same empty value when no bill matches and when OpenAI
fails. The website can therefore show “NO BILL MATCHED” even though Alethical never
finished checking.

An exact saved suggestion has another risk. If its initial provider path fails, the
request can continue into the ordinary full pipeline and pay for a 2nd attempt at
the same answer.

[Issue 780](https://github.com/alethical-org/alethical/issues/780) owns the honest
try-again state, the whole-request clock, and the live retry limits.

### 2.3 A bill-selection path can send the wrong question

When Ask chooses among bills by meaning, a loop reuses the name that held the
reader's question. By the end of the loop, that name holds the final candidate
bill's entire saved AI record instead. OpenAI can choose a bill using that record
rather than the question the reader typed.

[Issue 1622](https://github.com/alethical-org/alethical/issues/1622) owns this
separate accuracy bug. It comes before retry work because a healthy provider can
still return a well-cited answer about the wrong bill.

### 2.4 The offline Anthropic job retries permanent mistakes

The Anthropic summary job catches nearly every failure and may try 4 times. A short
network break deserves another try. A bad key or rejected request does not.

The same job also:

- tries to raise a 16,000-token ceiling only as high as 16,000, so that recovery
  branch cannot change anything;
- reads a finished batch into 1 large string and then makes a 2nd list of all
  its lines, which can duplicate about 70 MB for the measured 3,222-bill result;
- can lose the accepted Anthropic batch ID if the connection drops at the wrong
  moment, making a blind repeat capable of buying the same batch twice.

[Issue 1520](https://github.com/alethical-org/alethical/issues/1520) owns the
Anthropic offline path.

### 2.5 The unused OpenAI batch path is not ready for production

Production summaries come from Anthropic. An older OpenAI fallback still exists.
It can cut a full summary off at 2,400 tokens, stores returned JSON without the same
local shape check as the Anthropic path, and hand-builds OpenAI file and batch
requests.

[Issue 998](https://github.com/alethical-org/alethical/issues/998) owns that dormant
fallback. Making it safe does not switch production away from Anthropic.

## 3. What the official libraries should own

The provider libraries and Alethical solve different problems.

| The official OpenAI or Anthropic library owns | Alethical owns |
| --- | --- |
| Provider request and reply types | The reader's whole-request time limit |
| Authentication headers | The total number of tries |
| Reused network connections | Which failures deserve another try |
| Named provider error types | What a missing key means for each job |
| Provider request IDs | Safe failure records that contain no reader text |
| Native batch create, status, and result readers | Whether a paid create is safe to repeat |
| Decoding normal provider replies | Schema checks, citation checks, and cite-or-refuse |
| Compatibility with the provider's supported API | Per-bill checkpoints and restart safety |
| | The fixed message a reader sees when a provider is unavailable |
| | Model quality, speed, and cost gates |

This boundary gives us the main benefit of the libraries without handing product
truth or spending control to a provider default.

## 4. The shared call rules

### 4.1 Count total tries, not “retries”

“2 retries” can mean 3 calls. Every Alethical policy must say “2 total tries” or
“4 total tries.” The number includes:

- the initial call;
- another call after a temporary provider failure;
- another call after malformed model output, when that job allows it;
- any call made inside an official library.

The official libraries start with automatic retries off (`max_retries=0`), so the
tested Alethical number is the real number.

### 4.2 Retry only failures that can get better quickly

The retryable group is:

- a dropped connection;
- a timeout;
- HTTP 408, 409, or 429;
- a temporary provider server failure (HTTP 500 through 599).

A bad request, bad key, forbidden request, or missing resource stops after 1 try.
Those include HTTP 400, 401, 403, and 404.

A missing API key never retries. Each job keeps its existing missing-key meaning:

- question sorting uses its local word-matching fallback, while bill picking keeps
  its existing no-key refusal;
- production search-number creation fails closed rather than inventing search
  coordinates;
- production answer writing keeps returning HTTP 503 so a broken server setting is
  loud;
- local tests can keep their deterministic fake search coordinates.

### 4.3 Reader calls and offline jobs need different limits

| Job | Planned total-try rule | Planned time rule |
| --- | --- | --- |
| Live Ask classification, bill choice, search numbers, and answer writing | At most 2 total tries for a quick temporary failure, and fewer when the shared clock is nearly used | 25 seconds for the whole Ask request |
| Offline OpenAI embedding backfill | Keep 4 total tries | Keep the separate 60-second per-try rule |
| Anthropic fast bill summaries | At most 4 total tries across provider failures and invalid output | Offline job, with its own bounded per-call setting |
| Anthropic batch create | Exactly 1 try | Stop on an uncertain result |
| Anthropic batch status and result reads | At most 4 total tries | Read-only checks can survive a short outage |
| Dormant OpenAI batch create | Exactly 1 try unless OpenAI documents and tests a safe repeated identity | Stop on an uncertain result |
| Dormant OpenAI batch status and result reads | At most 4 total tries | Read-only checks can survive a short outage |

The 25-second Ask limit is an emergency ceiling, not the speed goal. The existing
answer-quality bar still targets 5 seconds for the middle answer, 9 seconds for the
slow end, and 15 seconds for 1 generated answer. If a current model already misses
15 seconds on a very broad question, that becomes separate model-choice work.
[Issue 780](https://github.com/alethical-org/alethical/issues/780) must not hide the
problem by loosening the target or changing models during a reliability change.

### 4.4 A timeout can still cost money

A timeout means Alethical stopped waiting. It does not prove the provider stopped
working. The initial call may still finish and be billed after Alethical starts a
2nd call.

That is why:

- live retries stay inside 1 short whole-request clock;
- a 2nd live try starts only after a quick failure and only when answer writing
  still has enough time;
- a paid batch create never repeats blindly;
- saved per-bill results are checked before another offline call starts.

## 5. The reader-facing result

Ask needs 3 meanings instead of 2:

| Result | Meaning | Website copy |
| --- | --- | --- |
| `available` with an answer | Alethical completed the answer | Show the cited answer |
| `available` with no answer | Alethical completed the check and found no supported answer | Keep the real no-match or out-of-scope state |
| `unavailable` with no answer | OpenAI or Anthropic prevented Alethical from finishing | Show fixed try-again copy |

The unavailable result must move through ordinary Ask, exact saved suggestions,
and signed-in bill chat. A signed-in conversation may save a short try-again
assistant message with no citations. It must never save invented answer text.

The safe failure record contains only:

- the job name;
- a normalized failure kind;
- total tries used;
- elapsed time;
- the fallback or unavailable path taken.

It never contains the question, prompt, provider reply, reader account data,
exception message, or local variables.

## 6. Anthropic offline summary plan

[Issue 1520](https://github.com/alethical-org/alethical/issues/1520) is split into
2 pull requests so behavior becomes safe before the transport changes.

### Pull request 1: make today's path safe and measurable

- Read finished batch rows 1 at a time instead of making 2 full in-memory copies.
- Remove the dead 16,000-to-16,000 token increase.
- Stop permanent failures after 1 try.
- Keep a single 4-total-try budget for temporary failures and invalid output.
- Keep batch creation at exactly 1 try.
- Stop on uncertain batch creation so a person can compare Anthropic's batch list
  before any resubmit.
- Test permanent, temporary, malformed, cache, uncertain-create, mid-batch, and
  restart cases.

### Pull request 2: move the provider plumbing to Anthropic's library

- Add Anthropic's official Python package as a direct, locked dependency.
- Move fast messages, batch create, batch status, and streamed batch results to it.
- Keep library automatic retries at 0.
- Preserve the exact message body, shared instruction cache, token-usage proof,
  64-character batch IDs, full bill-ID map, per-bill save points, and output rows.
- Keep the Claude Code subscription path separate.

Anthropic documents `max_tokens=0` for warming a prompt cache. Use the official
library when its public typed call accepts 0. If that library rejects 0 before
sending anything, keep only this cache-warm call as a named raw-web-request
exception. Do not delete the measured cache saving or replace 0 with an
undocumented value.

## 7. Live Ask plan

[Issue 780](https://github.com/alethical-org/alethical/issues/780) is split into 3
pull requests.

### Pull request 1: fix behavior before changing libraries

- Add 1 whole-request clock.
- Put today's exact request bodies behind narrow, replaceable call helpers.
- Give live search numbers at most 2 total tries while keeping offline backfills at
  4.
- Add the explicit available, no-match, and unavailable meanings.
- Stop an unavailable saved suggestion instead of starting the full pipeline again.
- Add the website try-again state and signed-in chat fallback.
- Add the privacy-safe failure fields to Sentry's allowed labels.

### Pull request 2: move text calls to the official libraries

- Add the OpenAI and Anthropic Python packages as direct, locked dependencies.
- Move question sorting, bill choice, OpenAI answer writing, and Anthropic answer
  writing behind the tested helpers.
- Keep library automatic retries at 0.
- Keep shared prompts, source limits, citation checks, and final honesty guards
  outside the provider-specific code.
- Compare the same model through the old and new route. Do not change a model in
  this transport pull request.
- Make the answer comparison command use production settings, including
  Anthropic's 4,096-token answer ceiling and no forced reasoning setting for the
  plain OpenAI comparison arm.
- Keep a raw control arm long enough to measure the same model over the old and new
  routes. It is a comparison tool, not the production transport.

### Pull request 3: move search numbers to OpenAI's library

- Move the shared embedding call to OpenAI's official Python package.
- Prove the live caller gets no more than 2 total tries inside the shared clock.
- Prove the offline backfill keeps 4 total tries and its separate 60-second limit.

## 8. Structured JSON is separate on purpose

Anthropic can enforce a JSON shape before returning a summary. That could remove
brace-finding code and lower malformed-output retries. It can also delete real
content if the requested shape is too strict.

Alethical's shared summary schema warns at more than 12 key points. The production
Anthropic path treats that as a report, not a rejection. SF 4555 legitimately needs
15 distinct points. Sending the shared schema as a strict request could force 3
real subjects out of the summary.

[Issue 1623](https://github.com/alethical-org/alethical/issues/1623) therefore owns
a separate paid comparison:

1. Make a request-only schema that keeps required fields and types but removes the
   advisory 12-point maximum.
2. Compare today's prompt-and-local-check path with Anthropic's strict JSON on the
   same model, prompt, token limit, and interleaved bills.
3. Start with 60 paired bills, including SF 4555 and HF 719.
4. Treat 60 pairs only as a screen for obvious harm.
5. If clean, expand to at most 200 paired bills before release.

At the measured planning rate of about $0.07 per bill per arm, the 60-pair screen is
about $9. The 200-pair maximum is about $28 to $30. No trial starts without a later
spending approval.

## 9. Work order and effort

| Order | Issue | Why it is separate | Focused engineering time |
| --- | --- | --- | --- |
| 1 | [#1622](https://github.com/alethical-org/alethical/issues/1622) | Fix the healthy-provider path that can answer the wrong bill | 1 to 2 hours |
| 2 | [#780](https://github.com/alethical-org/alethical/issues/780) | Protect readers with a hard clock, honest state, and official libraries | 24 to 35 hours across 3 pull requests |
| 3 | [#1520](https://github.com/alethical-org/alethical/issues/1520) | Make Anthropic's offline summary and batch paths safe | 16 to 22 hours across 2 pull requests |
| 4 | [#998](https://github.com/alethical-org/alethical/issues/998) | Make the dormant OpenAI summary fallback safe without turning it on | 7 to 10 hours |
| Later | [#457](https://github.com/alethical-org/alethical/issues/457) | Automatically queue a missing Anthropic summary after new official text is ready | Estimate after its spending limit and stop switch are approved |
| Only when triggered | [#1623](https://github.com/alethical-org/alethical/issues/1623) | Prove strict Anthropic JSON preserves grounded facts | 6 to 9 hours for 60 pairs, plus 8 to 12 hours if it expands |

The 2 requested estimates break down as follows. “Focused engineering time” means
active building and checking time. Waiting for GitHub checks or a provider batch is
not counted unless a person must watch and respond.

- **Issue 780: 24 to 35 focused engineering hours total.**
  - Pull request 1, covering the reader clock, honest unavailable state, safe
    failure labels, website state, signed-in chat, and tests: 10 to 15 hours.
  - Pull request 2, covering both text-provider libraries and same-model parity:
    7 to 10 hours.
  - Pull request 3, covering OpenAI search embeddings and separate live versus
    offline policies: 4 to 6 hours.
  - Guide checks, current-main checks, release, live verification, and rollback
    proof: 3 to 4 hours.
- **Issue 1520: 16 to 22 focused engineering hours total.**
  - Pull request 1, covering failure sorting, streamed batch rows, uncertain-create
    handling, dead recovery removal, and tests: 6 to 8 hours.
  - Pull request 2, covering the Anthropic library, locked dependency, cache warm,
    native batch readers, and parity tests: 7 to 9 hours.
  - Guide checks, current-main checks, release, and rollback proof: 3 to 5 hours.

[Issue 457](https://github.com/alethical-org/alethical/issues/457) does not add a
paid timer. The existing fast, parallel, cached Anthropic path already works. The
remaining job is a single handoff for a new bill version, with a hard spending
limit, failure limit, and off switch approved before live automatic calls begin.

## 10. Options considered

### Keep every hand-built web request

This avoids new packages and preserves exact control. It also leaves Alethical
maintaining provider request details, error decoding, connection reuse, and batch
result handling that OpenAI and Anthropic already maintain. Reject as the default.

### Let the official libraries retry automatically

This is less code. It hides the true number of paid calls and makes a reader's
whole-request clock harder to prove. Reject. Keep `max_retries=0`.

### Use 1 general AI framework or provider gateway

This gives 1 common interface. It adds another place where request shapes, retries,
model names, and billing can change. Alethical currently has only 2 direct providers
and needs provider-native batch and cache features. Reject until a measured trigger
in [AI Platform Position](ai-platform-position.md) is reached.

### Switch models when the original provider fails

This can turn an outage into an answer, but a different model can produce a
different answer. That is a quality experiment, not a safe retry. Reject automatic
cross-model failover.

### Add streaming, a circuit breaker, or a large provider framework now

None is required to fix the measured failures. Streaming also creates a new partial
answer state. Reject from this work. Revisit only against a measured reader problem.

## 11. What is still unknown

- Alethical does not yet have production middle and slow-end timing for every Ask
  step. [Issue 780](https://github.com/alethical-org/alethical/issues/780) adds the
  safe timing labels before changing provider libraries.
- Some current models already appear capable of missing the 15-second generation
  target on very broad questions. Same-model checks will measure and file that as
  model-choice work rather than changing models inside issue 780.
- Anthropic does not document a create-request identity that proves a repeated
  Message Batch create is safe. Until that changes, creation gets 1 try.
- The Anthropic Python library may reject the documented 0-token cache warm before
  sending it. The implementation test decides whether that 1 named raw request must
  remain.
- A timeout does not reveal whether the provider completed and billed the request.
  The plan limits this risk but cannot remove it from live model calls.
- Strict Anthropic JSON may improve shape while harming summary coverage. Only the
  paid paired trial in issue 1623 can answer that.
- The exact locked OpenAI and Anthropic package versions must be chosen against the
  repository's Python version when implementation begins. Tests, not memory, decide
  compatibility.

## 12. Release and rollback rules

- Land behavior and tests before changing transport.
- Keep request bodies and models unchanged during same-model route comparisons.
- Test temporary, permanent, malformed, missing-key, timeout, unavailable, privacy,
  batch uncertainty, and restart cases.
- Check the new head against current `main` before each merge.
- Release each pull request separately.
- Roll back to the prior transport helper if same-model output, citations, speed,
  attempt totals, or billing proof moves outside its written allowance.
- Do not roll back the truthful unavailable response to the false no-match state.

## Official references

- [OpenAI Python library](https://developers.openai.com/api/docs/libraries)
- [Anthropic Python library](https://platform.claude.com/docs/en/cli-sdks-libraries/sdks/python)
- [Anthropic structured outputs](https://platform.claude.com/docs/en/build-with-claude/structured-outputs)
- [Anthropic Message Batch creation](https://platform.claude.com/docs/en/api/messages/batches/create)
