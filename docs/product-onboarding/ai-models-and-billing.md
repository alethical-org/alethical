# AI Models & Billing — How Alethical Uses AI, and How It's Paid

<!-- describes: alethical/pipeline/anthropic_enrichment.py, alethical/pipeline/ai_enrichment.py -->

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
| **Display-time text cleaner** — interim masking of legalese in the app | (nothing — plain client code) | Not AI | ✅ N/A |
| **Semantic search / retrieval** — finding the right bill for a typed question | Embedding vectors | **Embedding** | ❌ **No — API-only** |
| **Corpus status freshness** — keeping each bill's current status up to date | Re-scraped status/actions | Not AI (web scraping) | ✅ N/A (free HTTP) |

**Key insight:** the enrichment cluster (first four rows) is text generation, so it
can ride the subscription. **Retrieval is the outlier** — it's embeddings, so it can
*never* use the subscription and always needs a paid embedding-API call.

## 4. Anatomy of an enrichment run (where the cost actually is)

The batch runner ([`anthropic_enrichment.py`](../../alethical/pipeline/anthropic_enrichment.py),
built on the shared prompt/schema in [`ai_enrichment.py`](../../alethical/pipeline/ai_enrichment.py))
has three steps. Only one costs model money.

| Step | What it does | Uses a model? | Billing |
|---|---|---|---|
| `prepare` | Builds each bill's prompt from text already in our database | No | Free (database) |
| `generate` | The model writes the JSON (summary, key points, questions, citations, tags) | **Yes** | Subscription (`--provider claude-cli`) **or** API credits (`--provider api`) |
| `apply` | Writes the results into the database (dry-run first) | No | Free (database) |

**Analogy:** `prepare` = write the assignment, `generate` = the writer does it,
`apply` = file it in the cabinet. Only the writer step is where "which billing rail"
matters.

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

**"Many bills at once" is not the discounted bulk lane — the API path pays full
list price.** It fires ordinary real-time calls (`POST /v1/messages`) from a pool of
concurrent workers, which is what buys the ~1 hour. Anthropic's **Message Batches
API** *would* bill the same work at **50% off**, but it is best-effort with an SLA of
up to 24 hours, so taking the discount gives back the entire speed advantage that is
the reason to use the API path at all. The OpenAI path
([`ai_enrichment.py`](../../alethical/pipeline/ai_enrichment.py)) *does* use its
provider's discounted batch queue, which is why that one is cheap and slow. Don't read
"batch" as "discount" when comparing the two — the mode/tier tradeoff is worked through
in [#457](https://github.com/alethical-org/alethical/issues/457).

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

**The one real promotion is a different thing, and it has a deadline.** Claude Sonnet 5
is on introductory pricing of **$2 in / $10 out per million tokens** through
**August 31, 2026**, after which it returns to **$3 / $15**
([pricing](https://platform.claude.com/docs/en/about-claude/pricing#claude-sonnet-5-introductory-pricing)).
That is a 50% increase on every enrichment run from September 1.

Both discounts apply to the same measured job, so the
[#723](https://github.com/alethical-org/alethical/issues/723) re-enrichment of 3,222
bills (26.7M tokens in, 12.3M out) prices four ways:

| | Live calls (~1 hour) | Bulk lane (up to 24 hours) |
|---|---|---|
| **Through Aug 31, 2026** | ~$176 | **~$88** |
| **From Sep 1, 2026** | ~$265 | ~$132 |

**Net (plain language): the bulk lane saves more than the deadline costs.** Missing
August is a ~$89 mistake only if we stay on live calls; on the bulk lane it is ~$44.
Doing both — bulk lane, before September — is the cheapest this job will ever be.

**A third saving exists and stacks, and it is worth taking on the fast lane only.**
[Prompt caching](https://platform.claude.com/docs/en/about-claude/pricing#prompt-caching)
lets you pay once to keep a repeated block of instructions on hand, then pay about 10% of
the normal rate every time a later call reuses it. Our enrichment prompt is a perfect
candidate: ~3,240 tokens of identical instructions on every call, about 39% of the input.

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

**Effective-date extraction is a *deterministic parse*, not an AI job (#598, #561/#572,
#706).** Worth noting here because it's easy to assume "hard text problem = needs a
model": it doesn't. Minnesota bills set effective dates **per section**, so there's no
single field to read. We resolve them in tiers — ~8% carry one explicit date (Tier A),
~14% say "the day following final enactment" (Tier B, resolved from the enactment
action), ~30% state no date at all so the whole act falls to the Minn. Stat. 645.02
default (Tier C, Aug 1 or July 1 after signing), and the remaining ~49% genuinely take
effect on different dates section by section and fall back to the latest action date.
This costs **no model money** — it reads bill text already in our database.

## 6. Takeaways for scaling

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

- [Data ingestion onboarding guide](data-ingestion-onboarding.md) — where the bill
  text (that enrichment reads) and the embeddings (that retrieval uses) come from.
- [RAG ingestion system design](../architecture/layer-2-rag-ingestion-system-design.md) — the embedding /
  retrieval pipeline in depth.
