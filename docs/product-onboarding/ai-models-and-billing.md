# AI Models & Billing — How Alethical Uses AI, and How It's Paid

<!-- describes: alethical/pipeline/anthropic_enrichment.py, alethical/pipeline/ai_enrichment.py, alethical/pipeline/codex_enrichment.py -->

> A plain-language reference for how Alethical uses AI models — the two kinds of
> AI output we depend on, the two separate billing rails that pay for them, and
> which of our jobs need which. Written for anyone new to the project; **keep it
> updated as we add AI use cases and scale** (add a row to the jobs table and note
> its output type — that one column tells you the billing rail).

## 1. The two billing rails

Alethical's AI spend runs on **two separate accounts that do not share a balance.**
Topping up one never funds the other.

| | Claude subscription (Team plan + overage) | Anthropic API account |
|---|---|---|
| Powers | Interactive Claude — the app, Claude Code, and any subagents / CLI it spawns | Standalone programs (our batch runners) |
| Paid by | The monthly plan; extra usage bills as overage | Prepaid credits / a card on the API organization |
| Shares a balance with the other? | **No** — separate meter | **No** — separate meter |

**Analogy:** the subscription is a **monthly gym membership** — walk in and use it.
The API account is a **metered utility bill** for machines that run on their own.
Two separate bills, two separate meters.

## 2. Two kinds of AI output

Not all "AI" is the same. Alethical relies on two fundamentally different outputs,
and the difference decides which billing rail is even *possible*.

| | Generation (writing) | Embeddings (measuring) |
|---|---|---|
| Produces | Words — a written summary, questions, an answer | A fixed list of numbers (a "vector") that locates text in meaning-space |
| Made by | A chat/generation model (Claude) | A separate *embedding model* |
| Reachable through the subscription? | ✅ Yes | ❌ No — different model, different endpoint, not exposed to chat |
| Can you substitute the other? | — | ❌ No — invented numbers don't line up with the search index; it must be the real embedding model |

**Analogy:** generation is **hiring a writer** to explain a bill. An embedding is a
**librarian stamping each bill with precise coordinates** so a question can find the
nearest bills. The writer can't produce the librarian's coordinates — different
specialist, different tool.

## 3. Alethical's AI jobs — what each is, and what it needs

The first four jobs below are produced **together in one enrichment call per bill**
(one model call emits the summary, key points, suggested questions, citations, and
topic tags at once), so they're funded together and can all use either billing rail.

| AI job (its nature) | What it produces | Output type | Runs on team plan? |
|---|---|---|---|
| **Bill enrichment** — plain-language summary + key points per bill | Rewritten bill-text fields | Generation | ✅ Yes |
| **Bill-specific Ask suggestions** — the starter questions on a bill's Ask card | 3–4 tailored questions per bill | Generation | ✅ Yes *(same enrichment call)* |
| **Per-point citations** — a source anchor + quote behind each key point | Citation markers | Generation | ✅ Yes *(same enrichment call)* |
| **Topic/issue tagging** — classifies each bill for browse-by-issue & follow-an-issue | Policy-area tags | Generation | ✅ Yes *(same enrichment call)* |
| **Grounded Ask answers** — the prose a reader reads on the answer page and in bill chat | A cited, plain-language answer, written per question | Generation | ❌ **No — API-only in practice** (see below) |
| **Question sorting** — deciding what kind of question was asked | One label from a fixed set | Generation | ❌ No — same reason |
| **Short-title rewrite** — a scannable headline for a bill whose official title is a statutory run-on | One short neutral title per bill | Generation | ❌ **No — pinned to `gpt-4o-mini`** regardless of the run's main model (`TITLE_MODEL`, `alethical/pipeline/ai_enrichment.py`) |
| **Display-time text cleaner** — interim masking of legalese in the app | (nothing — plain client code) | Not AI | ✅ N/A |
| **Semantic search / retrieval** — finding the right bill for a typed question | Embedding vectors | **Embedding** | ❌ **No — API-only** |
| **Corpus status freshness** — keeping each bill's current status up to date | Re-scraped status/actions | Not AI (web scraping) | ✅ N/A (free HTTP) |

### 3.1 The official provider library is plumbing, not a billing rail

An official software development kit (SDK) is OpenAI's or Anthropic's maintained
Python library for making requests. It prepares the provider's request shape, adds
the key, reuses connections, names common errors, and reads normal replies.

Using the official library does **not** change which account pays, which model runs,
whether a call gets the 50% batch price, or what Alethical asks the model to write.
It changes the plumbing between Alethical and the same provider endpoint.

The accepted default is to use the official OpenAI and Anthropic libraries behind
small Alethical-owned helpers. Library retries stay off (`max_retries=0`). Alethical
still owns the reader's time limit, total tries, spending guard, schema and citation
checks, saved progress, and honest failure message.

That move has not shipped across every call yet:

- [Issue 780](https://github.com/alethical-org/alethical/issues/780) owns live Ask
  calls and OpenAI search embeddings.
- [Issue 1520](https://github.com/alethical-org/alethical/issues/1520) owns offline
  Anthropic summaries and Message Batches.
- [Issue 998](https://github.com/alethical-org/alethical/issues/998) owns the dormant
  OpenAI summary-batch fallback.
- The Claude Code subscription path remains a separate command-line route because
  it uses a personal subscription login rather than an API key.

[How Alethical Calls OpenAI and Anthropic, and When It Retries](../architecture/ai-provider-calls-and-retries.md)
owns the full boundary, failure rules, work order, and tradeoffs.

**Key insight:** the enrichment cluster (first four rows) is text generation, so it
can ride the subscription. **Retrieval is the outlier** — it's embeddings, so it can
*never* use the subscription and always needs a paid embedding-API call.

**The two live rows are a second kind of outlier, for a different reason.** Answering
a reader's question and sorting that question are both generation, so the "generation
can ride the subscription" rule *should* apply — but it doesn't, because these run
**inside a web request while a person waits**. The subscription path is a Claude CLI
subprocess authenticated with a personal OAuth token (§4); a production API server
can neither spawn a subprocess per request nor hold one person's login. So the rule to
remember is not "generation → subscription" but **"generation *in a batch job* →
subscription; generation *in a request* → API."** These two are also the only AI jobs
whose cost **recurs with traffic** rather than being paid once per bill, which is why
a per-answer price rise multiplies in a way an enrichment re-run never does.

## 4. Anatomy of an enrichment run (where the cost actually is)

The batch runner ([`anthropic_enrichment.py`](../../alethical/pipeline/anthropic_enrichment.py),
built on the shared prompt/schema in [`ai_enrichment.py`](../../alethical/pipeline/ai_enrichment.py))
has three stages: build the prompts, have the model write, then file the results. Only
the middle stage costs model money, and it is the only one with a choice to make —
either wait-and-watch (`generate`) or hand-over-and-come-back (`batch-submit` then
`batch-collect`).

| Step | What it does | Uses a model? | Billing |
|---|---|---|---|
| `prepare` | Builds each bill's prompt from text already in our database | No | Free (database) |
| `generate` | The model writes the JSON (summary, key points, questions, citations, tags), one bill at a time or many at once, while you wait | **Yes** | Subscription (`--provider claude-cli`) **or** API credits (`--provider api`) |
| `batch-submit` + `batch-collect` | The same writing job, handed over as one big file and picked up later at half price | **Yes** | API credits only |
| `apply` | Writes the results into the database (dry-run first) | No | Free (database) |

**Analogy:** `prepare` = write the assignment, `generate` = the writer does it,
`apply` = file it in the cabinet. Only the writer step is where "which billing rail"
matters.

`apply` is also the free freshness gate. Before it files a summary, it checks that the bill's
current version and official section text still match what `prepare` recorded. Both valid text-hash
lengths are accepted, so building the search index after preparation does not waste unchanged paid
output. If the bill changed while the model was writing, `apply` reports the result as `outdated`
and does not display it. That manual apply does not create replacement work or spend more money.
The earlier saved official-text change already recorded 1 exact durable request after its proposal
roles and APPENDIX references were complete. The request becomes ready when current search rows
match, but an actual automatic job is queued only when the switch and every spending and failure
limit are open. Apply and refresh also take the same bill-row lock, so a refresh cannot commit
between this check and the summary write ([#1321](https://github.com/alethical-org/alethical/issues/1321)).

**Same output, very different wall-clock — this is the real tradeoff.** The two
`generate` rails produce identical text, but not at identical speed. The subscription
CLI path (`--provider claude-cli --model sonnet`) runs bills **one at a time**, so a
full-corpus regeneration (~10,500 bills) takes **~22 hours**. The API path
(`--provider api`) runs **many bills at once** and finishes the same work in **~1 hour**
for roughly the **same total dollar cost**. So the choice is *not* about money — it's
**already-paid subscription hours (slow, runs unattended overnight) vs. paid API credits
(fast)**. Rule of thumb: CLI path when there's no deadline and you'd rather not spend
API credits; the parallel API path when speed matters. Either way it's checkpointed and
resumable — it skips bills already done, so a paused run costs nothing to restart.

**"Many bills at once" is not the same thing as the half-price lane, and we now have
both.** `generate` fires ordinary real-time calls (`POST /v1/messages`) from a pool of
workers all running together, which is what buys the ~1 hour — but running them
together is not what earns a discount, so `generate` pays **full list price** for the
words it sends and receives. The discount is earned by *waiting*: `batch-submit` hands
the whole job over as one file and `batch-collect` picks it up whenever the provider
has got to it, up to 24 hours later, for **half price**. So the two are not rival
readings of one command — they are two commands, and §4.1 below says which discount
each one takes.

The OpenAI path ([`ai_enrichment.py`](../../alethical/pipeline/ai_enrichment.py)) has
always used its provider's half-price queue, which is why that one is cheap and slow.
**The lesson to carry away is that "batch" in a command name never means "discount" by
itself** — read whether the command *waits*. The full mode-and-tier comparison is
explained below; [issue 457](https://github.com/alethical-org/alethical/issues/457)
adds the default-off automatic handoff for newly saved or changed official bill text.

### 4.1 Where the 50% bulk discount comes from, and who can reach it

**It is not a promotion and it has nothing to do with Claude Code.** The bulk lane is a
permanent line on the provider's own price list: hand over a large file of requests,
let the provider run them whenever it has spare capacity within 24 hours, and pay half
on both the text sent in and the text written out. Anthropic calls it the
[Message Batches API](https://platform.claude.com/docs/en/about-claude/pricing#batch-processing);
OpenAI calls it the Batch API. No subscription, plan, or tier unlocks it, and nothing
about it expires. **Net (plain language): the discount is the price of being willing to
wait, not a deal anyone negotiated for us.**

**Any route that reaches the provider's bulk lane gets the same 50%; a route that only
forwards live one-at-a-time calls cannot.** That single rule decides the whole
comparison:

| Route | Reaches the bulk lane? |
|---|---|
| Anthropic API direct (what `anthropic_enrichment.py` uses) | ✅ Yes |
| OpenAI API direct (what `ai_enrichment.py` already uses) | ✅ Yes |
| Claude on Google Cloud / Amazon Bedrock | ✅ Yes |
| Self-hosted LiteLLM proxy | ✅ Yes — it forwards the batch endpoint |
| [OpenRouter](https://openrouter.ai/docs/batch-quickstart) | ✅ Yes — 24-hour batch, **beta** |
| Vercel AI Gateway · Concentrate | ❌ No — live calls only |

So a model-routing service in front of us is not a way to *get* a better rate; the best
any of them can do is pass the provider's own price through, and some cannot reach the
bulk lane at all. Evaluated in full at
[#457](https://github.com/alethical-org/alethical/issues/457#issuecomment-5133755600).

**OpenRouter is the exception worth naming, because it changed.** It now runs a beta
24-hour batch service across chat, responses, Anthropic Messages **and embeddings**, and
lists `anthropic/claude-sonnet-5:batch` at the same **$1 in / $5 out** Anthropic charges.
So it *can* reach the discount, and it *can* handle the embedding half of our workload.
We still go direct to Anthropic, for reasons that are about risk and overhead rather than
the token price:

- OpenRouter charges **5.5%** when you top up credits, so the same $88 of tokens costs
  about **$93**.
- Its batch service is **beta**, and this is a production write over 3,222 live bills.
- It adds a second company that has to be up, and a second place our bill text is stored.
- It saves us no work: we would still write the same batch client either way.

**Net (plain language): OpenRouter can now get the half price, but going straight to
Anthropic is a few dollars cheaper and has fewer things that can go wrong.**

**Claude Sonnet 5's launch price is now permanent.** Anthropic made the
**$2 input / $10 output per million tokens** price permanent on August 10, 2026
([announcement](https://www.anthropic.com/research/claude-sonnet-5),
[pricing](https://platform.claude.com/docs/en/about-claude/pricing)). There is no
August 31 deadline and no planned return to $3 / $15.

Both discounts apply to the same job, so the
[#723](https://github.com/alethical-org/alethical/issues/723) re-enrichment of 3,222
bills prices four ways. **These are the measured figures, not the pre-run estimate**
(26.7M in / 12.3M out → ~$176 live, ~$88 bulk). Output ran 41% over that estimate, so an
estimate labelled as the measured job puts two prices on one job in one doc — the failure
[#786](https://github.com/alethical-org/alethical/pull/786) fixed once already.

Measured: 26.7M tokens in, ~17.4M out (3,222 bills × ~5,400 output tokens each).

| | Live calls (~1 hour) | Bulk lane (up to 24 hours) |
|---|---|---|
| **Permanent Sonnet 5 price** | **~$224** (actually paid) | **~$112** |

The bulk-lane column is the live column halved, per the 50% bulk discount above.
Only the ~$224 live run was actually paid.

**Net (plain language): the bulk lane cuts the measured provider price in half;
there is no model-price deadline to race.**

**Those output figures are now high, because the job itself got smaller.** The prices
above are the measured cost of the #723 job *as it was billed*, and they stay accurate
as a record of what was spent. But [#773](https://github.com/alethical-org/alethical/issues/773)
then removed 9 fields the summariser was generating that nothing displayed — four of
them opinions about a bill we are forbidden to show at all
(`.claude/rules/grounded-answers.md` rule 3). Measured across all 10,517 current
production enrichments, that is **37.8% of every generated payload, ~1,799 output
tokens a bill**. So any future run's *output* half is roughly 38% cheaper than these
numbers, and a full 10,471-bill run saves about **$188** of output at $10/MTok. The
input half is unchanged.

8 more unread fields are deliberately still generated, because they are produced
*before* the summary and key points and may be scaffolding the model reasons through
on the way there. #773 carries that as a separate stage, worth about $81, gated on a
side-by-side comparison rather than assumed.

**A third saving exists and stacks, and it is worth taking on the fast lane only.**
[Prompt caching](https://platform.claude.com/docs/en/about-claude/pricing#prompt-caching)
lets you pay once to keep a repeated block of instructions on hand, then pay about 10% of
the normal rate every time a later call reuses it. Our enrichment prompt is a perfect
candidate: ~3,240 tokens of identical instructions on every call, about 39% of the input.
For Sonnet 5's 1-hour cache, writes cost **$4 per million tokens** and reads cost
**$0.20 per million tokens** at the permanent base price.

**Both lanes are now wired up, and each takes exactly the saving that suits it:**

| Lane | Command | Discount it takes | Caching? |
|---|---|---|---|
| Fast (~1 hour) | `generate` | none — full list price | ✅ **Yes** — ~$18 off a 3,222-bill run |
| Bulk (up to 24 hours) | `batch-submit` + `batch-collect` | **50%** off input and output | ❌ No — deliberately |

The bulk lane arrived in [#784](https://github.com/alethical-org/alethical/pull/784) and
caching in [#779](https://github.com/alethical-org/alethical/issues/779). Both modes send
the same prompt and write the same output rows, so `apply` cannot tell them apart. Rule of
thumb: `generate` when someone is waiting, `batch-submit` when nobody is.

**Why caching is on for one lane and off for the other, when it stacks in theory.** On the
fast lane the calls are spread out enough that nearly every one reuses the kept copy, so
it reliably saves about **$18**. Inside the bulk queue, reuse is best-effort — and a call
that does *not* reuse the copy pays a small premium for keeping it instead. Across a
3,222-bill bulk run that swing is somewhere between **saving ~$9 and costing ~$10**, on a
job whose whole margin is $88. **Net (plain language): on the fast lane caching is a sure
$18; in the bulk queue it is a coin toss on a production write, so we take the certain
saving and skip the gamble.**

Two limits worth knowing about the caching that is on: the subscription path
(`--provider claude-cli`) gets nothing from it, because the Claude Code CLI takes a plain
block of text and does its own caching; and any edit to the enrichment prompt or its
schema — the trim proposed in
[#773](https://github.com/alethical-org/alethical/issues/773), for example — makes the
next run pay once to keep the new wording, which costs a fraction of a cent. Every
`generate` run ends by printing a `token_usage` block saying how many instruction tokens
were reused rather than re-billed, so the saving is read off a real run instead of
projected.

**Which model does the writing:** enrichment runs on **Claude Sonnet with extended
thinking turned off**. The summary / key-points / suggested-questions task is
reasoning-light, so thinking would add latency and cost without improving the output —
Sonnet-no-thinking is the cheapest tier that holds the quality bar for this job.

### 4.2 What a run actually costs, measured — and how to size the next one

Everything below is measured, not projected: from the 3,222-bill re-enrichment of
[#723](https://github.com/alethical-org/alethical/issues/723) (applied Jul 30 2026,
3,177 bills written, 0 failures) and its 1,264 clean calls.

| Measure | Value |
|---|---|
| Cost per bill, end to end | **$0.064–0.072** |
| Output tokens per bill | **~5,400** (up to 10,922 on a long omnibus) |
| Stored characters per output token | 2.153 |
| Request characters per input token | 3.039 |
| Actual generation time, 3,222 bills | ~80 minutes |

**To size a run:** multiply bills by ~$0.07. For the full 10,471-bill corpus that is
roughly **$730 at list price**, or about **$365** through the half-price bulk lane
(§4.1). Do not re-derive it from a small sample.

**Why that last sentence is a rule and not advice.** #723 was estimated at **$176** and
cost **~$224**. The estimate assumed 3,818 output tokens per bill; the real figure is
~5,400, **41% higher**. The error came from sizing off a 12-bill sample that happened to
write shorter answers than the real batch. A dozen bills cannot tell you the shape of ten
thousand, so use the measured per-bill rate above, or sample at least a few hundred.

**Instruction caching is confirmed working in production, not just merged.** The 388-bill
pass read **1,367,312 of 2,705,191 input tokens from cache — 51%**, saving $2.46 on that
pass alone. Extrapolated across the full corpus that is roughly **$66 a run**. This was
[#785](https://github.com/alethical-org/alethical/pull/785)'s first real exercise, and the
`token_usage` block above is where the number comes from.

**Guard the output ceiling, because a cut-off answer is billed and then thrown away.**
The ceiling was 8,192 tokens against a ~5,400-token average, so roughly **1 bill in 5**
was truncated mid-JSON, discarded, and retried at a larger ceiling — with every discarded
attempt paid for. Raised to 16,000 in
[#813](https://github.com/alethical-org/alethical/pull/813), worth ~$25 on a 3,222-bill
batch and more on a full corpus. The tell that the ceiling was the cause rather than the
model: the same bill produced 4,413 vs 4,425 tokens at both ceilings, so the extra room
changed nothing except whether the answer survived.

**A prepaid balance can refuse a request it could afford.** Any provider or gateway that
*reserves* funds equal to the requested output ceiling before running the call will reject
a 16,000-token request on a nearly-empty balance while accepting a 1,000-token one, with a
payment error rather than a quota message. Worth knowing before diagnosing a mid-run stall
as an outage — raising the ceiling raises the balance a run needs up front.

### 4.3 When a shorter summary is worse, and why paying to re-ask stops working

**Net (plain language): shortening a bill's key points is the right job for most bills
and the wrong job for a bill whose whole point is a list of amounts. Asking the model
again fixes some of those; past a point it stops working, and pushing harder in the
instructions makes it invent totals. Leave the wordy list.**

[#723](https://github.com/alethical-org/alethical/issues/723) shortened the key points on
3,222 wordy bills. 45 were held back because the shorter version had dropped every dollar
figure the longer one carried, and
[#814](https://github.com/alethical-org/alethical/issues/814) worked through those 45.
Three things came out of it that are expensive to rediscover:

- **"Every dollar figure disappeared" is too blunt a test for whether a summary got
  worse.** Of the 45, only 5 were bills that spend money and lost the amount they spend.
  The rest lost a fine attached to one offence, a licence fee, an income cut-off that
  decides who a rule covers, or a figure the bill itself leaves blank. Dropping those is
  the shortening working, not failing. 15 of the 45 were safe to publish once each one was
  read; 30 were not.
- **Re-asking has a floor.** The same request, unchanged, cleared 76 bills, then 59, then
  45, then 38 — and the last pass fixed only 7 of 45 for **$3.79**. The bills that survive
  four rounds are not unlucky; the model keeps making the same call about them, so a fifth
  round buys almost nothing.
- **Telling the model harder to keep the amounts made one bill wrong.** A 5-bill test with
  a sharper instruction fixed 1, left 3 unchanged, and on the fifth produced a total
  ("roughly $850,000 per year") that appears nowhere in the bill or in the old summary —
  the model had added the appropriations up itself. A missing figure is a worse summary; an
  invented one is a false statement about a law, which
  [`.claude/rules/grounded-answers.md`](../../.claude/rules/grounded-answers.md) rule 1
  forbids outright. **So the instruction was not shipped**, and the 98.6% of bills that
  already comply were never put at risk.

**The rule to carry away: a bill whose substance IS a table of numbers — an
appropriations bill, a payment-rate schedule, a tax-bracket table, a fee schedule — is
allowed to keep a long list of key points.** The six-bullet target exists to stop a
summary reading like the bill; it was never a reason to delete the numbers a reader came
for. For those 30 bills the wordy list is the correct answer, so they keep it.

### 4.4 The 12-point cap is a hard limit on one writer and only advice on the other

**Net (plain language): the schema tells the model to write at most 12 key points. On the
writer we actually use, nothing checks that number — it is advice the model can ignore, and
one bill came back with 15. We now count the bills that go over and print the list at the
end of a run, instead of throwing those bills away.**

The number lives in one place, `SUMMARY_SCHEMA` in
[`ai_enrichment.py`](../../alethical/pipeline/ai_enrichment.py) (`"maxItems": 12`). It is a
runaway guard set well above the six-bullet target of §4.3, not a target itself. What
happens when a reply exceeds it depends entirely on which writer produced the reply:

| Writer | Does the 12 bind? | Why |
| --- | --- | --- |
| OpenAI ([`ai_enrichment.py`](../../alethical/pipeline/ai_enrichment.py)) | **Yes** | Strict Structured Outputs makes the provider enforce the schema before we ever see the reply. |
| Claude ([`anthropic_enrichment.py`](../../alethical/pipeline/anthropic_enrichment.py), the one every production summary comes from) | **No** | The schema is pasted into the prompt as text, and the reply is checked by `validate_summary_shape` in [`codex_enrichment.py`](../../alethical/pipeline/codex_enrichment.py), which checks the field types and never looks at the count. |

**Turning it into a hard limit on the Claude path would be worse than leaving it advisory.**
A failed check makes `_call_anthropic` ask again, four times, and then give up on the bill —
so a genuine omnibus that honestly needs 13 points would cost four paid attempts and end
with no summary at all. A bill with no summary is **hidden from every list a reader
browses** — search, the session browse, the issue-chip counts, Ask's topic results, all of
which gate on `Bill.has_current_summary` — which is far worse for a reader than a summary
that runs long. **One list is deliberately not gated: the reader's own Tracked page**
([#1007](https://github.com/alethical-org/alethical/issues/1007)). There they picked the
bill personally, so dropping it would delete something they saved from the one page whose
job is showing what they saved; it appears with its number, title and status, and no
summary line. That exception does not soften the case above — it is a smaller audience (one
person's watchlist) seeing a plainly incomplete row, not the whole corpus losing a bill.

**So over-ceiling replies are counted and reported, never rejected**
([#836](https://github.com/alethical-org/alethical/issues/836)). The end-of-run output from
`generate` (and from `batch-collect`) carries three extra fields — `key_points_ceiling`,
`over_ceiling`, and `over_ceiling_sample`, the last naming the worst offenders — so a real
runaway is visible the day it happens rather than in a spot check months later. The
pathological case this guard exists for is real: one bill once came back with 59 key points.

**Measured against production 2026-07-30, after the
[#723](https://github.com/alethical-org/alethical/issues/723) run: 4 bills sit above 12,
and reading them says the count is doing its job.** The worst, SF 4555 at 15, is a flagged
omnibus bill whose official title enumerates roughly 20 separate subjects; its 15 points are
15 distinct subjects with no repetition, and the model had already merged three ceremonial
designations into one bullet. **A long list on an omnibus bill is the summary working, not
failing** — the same conclusion §4.3 reached about fee schedules, arrived at from a different
direction.

## 5. The decisions behind retrieval (embedding model + index)

Retrieval is the embedding rail (§2–3). Two decisions, both backed by measured
evaluation (the gate is [`scripts/retrieval_eval.py`](../../scripts/retrieval_eval.py)),
make it fast and accurate:

- **Embedding model — kept OpenAI `text-embedding-3-small`, did not switch to Voyage.**
  We evaluated **Voyage** as an alternative embedding provider. Its free tier caps at
  **3 requests/minute** — unusable for embedding a ~10k-bill corpus (it would take days
  and stall), and the paid tier showed no accuracy gain worth a migration.
  **Net (plain language): the tool that turns bills into searchable "meaning
  coordinates" stays as-is — OpenAI's small embedding model — because it's cheap, fast,
  already indexed, and the alternative was slower with no quality win.**

- **Index type — switched pgvector from `ivfflat` to HNSW (#584), a large measured win.**
  Rebuilding the vector index as **HNSW** cut a semantic-search query from **~8.9 seconds
  to ~0.19 seconds** (≈47× faster) while *improving* accuracy (**Recall@5 0.90 → 0.95**).
  **Net (plain language): search now returns almost instantly *and* finds the right bill
  more often.** Building this index on production needs a specific recipe (concurrent
  build, session pooler, statement-timeout off) — see
  [`scripts/build_rag_hnsw_index.py`](../../scripts/build_rag_hnsw_index.py).

### 5.1 What embedding actually costs, measured

**Net (plain language): embedding is the cheap half of our AI spend by a wide margin.
Making 69 whole bills searchable cost about **7 cents**. Sizing an embedding job off the
enrichment numbers in §4.2 would overstate it by roughly a thousand times.**

Measured on the [#844](https://github.com/alethical-org/alethical/issues/844) run,
Aug 4 2026 — 69 bills that had been ingested but never embedded, including the whole
2025 special session:

| Measure | Value |
| --- | --- |
| Bills | 69 |
| Sections | 6,199 |
| Characters | 13,392,532 |
| Tokens (~4 chars/token) | ~3,348,000 |
| **Cost at $0.02/1M for `text-embedding-3-small`** | **~$0.067** |
| Wall clock | ~20 minutes |
| Cost per bill | **~$0.001** |

**To size an embedding job:** multiply bills by ~$0.001, or characters by
$0.02/4,000,000. A full 10,500-bill corpus re-embed is roughly **$10**, which is why
"re-embed everything" is a decision about *time*, not money — and why the embedding
half of a `raw_text` rewrite (§ "Never fix raw_text" in
[data-ingestion-onboarding.md](data-ingestion-onboarding.md)) is the cheap half. The
expensive half of that rewrite is the ~$365–730 enrichment re-run.

**Compare the two rails on the same corpus and the gap is the point:** enriching 10,471
bills costs ~$730 at list price (§4.2); embedding the same corpus costs ~$10. Writing
words is ~70× more expensive than measuring them.

**Two things that cost more than the tokens did, both worth building against:**

- **A dropped connection used to lose a whole batch.** Two runs died on
  `SSLV3_ALERT_BAD_RECORD_MAC` from api.openai.com, each throwing away paid work
  already done in that batch. `_openai_embeddings`
  ([`rag_ingest.py`](../../alethical/pipeline/rag_ingest.py)) now retries a dropped
  connection four times with a growing pause — scoped to transport errors only,
  because an HTTP status means the server answered and a 429 is the caller's decision.
- **Smaller batches lose less to a blip.** `--batch-size 5` rather than the default 25
  bounded each failure to five bills' work instead of twenty-five.

**Effective-date extraction is a *deterministic parse*, not an AI job (#598, #561/#572,
#706).** Worth noting here because it's easy to assume "hard text problem = needs a
model": it doesn't. Minnesota bills set effective dates **per section**, so there's no
single field to read. We resolve them in tiers — ~8% carry one explicit date (Tier A),
~14% say "the day following final enactment" (Tier B, resolved from the enactment
action), ~30% state no date at all so the whole act falls to the Minn. Stat. 645.02
default (Tier C, Aug 1 or July 1 after signing), and the remaining ~49% genuinely take
effect on different dates section by section and fall back to the latest action date.
This costs **no model money** — it reads bill text already in our database.

## 6. What we measure, and what we deliberately don't

Three kinds of AI quality, three different answers. Knowing which box a question falls in
saves re-litigating the tooling every time.

| What | Covered? | By what |
|---|---|---|
| Does search find the right bill? | ✅ Yes | [`scripts/retrieval_eval.py`](../../scripts/retrieval_eval.py) against 20 real questions ([`retrieval_queries.json`](../../alethical/eval/fixtures/retrieval_queries.json)). Grades recall@1/3/5/10 and MRR, and its `head2head` mode compares embedding models (OpenAI vs Voyage) head to head. **This is the gate — don't replace or wrap it.** |
| Do generated answers always cite a source? | ✅ Yes | 12 deterministic pass/fail checks in [`test_ask_scenarios.py`](../../alethical/tests/test_ask_scenarios.py), enforcing `.claude/rules/grounded-answers.md` rule 1. Runs in CI. |
| Does one model *write* better **Ask answers** than another? | ✅ Yes | [`scripts/answer_eval.py`](../../scripts/answer_eval.py) against 20 human-labeled questions ([`answer_questions.json`](../../alethical/eval/fixtures/answer_questions.json)), scoring two pass/fail gates and four graded dimensions with two blind judges from rival providers. The bar it enforces is argued in [answer-quality-bar.md](answer-quality-bar.md) ([#865](https://github.com/alethical-org/alethical/issues/865)). |
| Does one model *write* better **bill summaries** than another? | ❌ No | Still nothing — the answer eval above deliberately does not cover this. Summaries are written once per bill in a batch job, so they are judged on different terms (no latency budget, cost paid once). The #377 choice of Claude Sonnet 5 remains a one-off nobody can re-run. Tracked as [#787](https://github.com/alethical-org/alethical/issues/787). |

**The plan for the gap is a ~200-line script in this repo, not an evaluation framework.**
Inspect AI was evaluated in full and rejected. It genuinely supports the providers' bulk
lanes and has a results viewer — and it still loses, for one reason that outranks all of
that: it would not call `ai_enrichment.py prepare`, so we would rebuild bill-text-to-prompt
inside its dataset layer. That step tags each excerpt (`[S1]`, `[S2]`) so the model's quoted
proof can be traced back to a real `BillVersionSection`. Rebuild it and the evaluation grades
a prompt that is not provably the production one, which is the whole purpose. Its remaining
infrastructure — bulk submission, resume-after-interruption — is what
[#784](https://github.com/alethical-org/alethical/pull/784) and
[#785](https://github.com/alethical-org/alethical/pull/785) already shipped, and the scorers
would be Alethical-specific either way.

**Reconsider a framework only if running the comparisons by hand becomes the burden** — never
to reach a model we lack an account for. That is a *gateway's* job, not a framework's, and
the two are easy to confuse. We hold OpenAI, Anthropic and Voyage keys, which covers every
current candidate.

Two traps recorded because both are easy to fall into:

- **The automatic citation check is a traceability check, not fact-checking.** It proves a
  quote exists in the bill. A quote can be perfectly real and still not support the sentence
  next to it. A high score here must never be read as "the summary is true."
- **A single "writing quality" number hides the failures that matter.** A summary can read
  beautifully and be wrong. So the automatic checks are a *gate* (fail them and you are out),
  and the human pass is a blinded side-by-side with "tie" and "both fail" allowed. Full method
  in [#787](https://github.com/alethical-org/alethical/issues/787).

## 7. How we choose AI infrastructure — the factors, in priority order

Every AI-infrastructure decision recorded in this file resolved against the same six
factors, and they only settle anything because they are *ordered*. Correctness outranks
money, and money only counts when the amount is real.

1. **Don't rebuild how a bill becomes a prompt.** Highest, because it is about being right
   rather than cheap. This alone rejected Inspect AI (§6).
2. **Don't give up the bulk lane's 50%.** The largest real money in play. This rejected
   Vercel AI Gateway outright (§4.1).
3. **Don't add a company that has to be up.** Applies whenever a job overwrites live pages.
4. **Don't rebuild what we already have.** Search grading, citation checks, the bulk lane,
   resume-after-interruption and the citation counter all exist.
5. **Don't pay a fee for something we already hold.** OpenRouter's 5.5% top-up charge, on
   accounts we already have.
6. **Don't take on risk for small money.** Lowest, and it is the tie-break.

**The ordering earns its keep when factors collide, which they did twice:**

- Factor 6 beat factor 2 on [#723](https://github.com/alethical-org/alethical/issues/723).
  The bulk lane was correct at 3,222 bills (saving $88); once only 388 remained the saving
  fell to ~$13 against a full day of waiting, and the same rule flipped. **Item count is not
  the rule — urgency and the dollar gap are.**
- Factor 6 also kept prompt caching out of the bulk lane (§4, "Both lanes are now wired up"):
  ~$5 expected, on a swing that could cost money, during a production write.

**Factor 4 is why "we might want it later" is never an argument.** Building for a need we do
not have is the same mistake as rebuilding something that already works.

## 8. Takeaways for scaling

- **Any new _text_ feature** (better summaries, new answer types, new suggested-question
  styles) is generation → can use the subscription **or** the API.
- **Any new _search / similarity_ feature** (better retrieval, "bills like this one,"
  dedup by meaning) is embeddings → **API-only**; budget for it separately.
- **Non-AI data jobs** (scraping, status refresh, cleanups) don't touch either AI
  meter — don't conflate them with model cost.
- When a new use case appears, **add a row to the jobs table (§3)** and note its output
  type. That single column — generation vs embedding vs not-AI — tells you the billing
  rail and whether the team-plan path applies.

## Related

- [How Alethical calls OpenAI and Anthropic, and when it retries](../architecture/ai-provider-calls-and-retries.md):
  why official libraries are the default plumbing, what Alethical keeps under its
  control, and which changes are only planned.
- [Data ingestion onboarding guide](data-ingestion-onboarding.md) — where the bill
  text (that enrichment reads) and the embeddings (that retrieval uses) come from.
- [RAG ingestion system design](../architecture/layer-2-rag-ingestion-system-design.md) — the embedding /
  retrieval pipeline in depth.
- [AI platform position](../architecture/ai-platform-position.md) — why we buy from
  these providers directly, what we refuse to adopt, and what would change it.
