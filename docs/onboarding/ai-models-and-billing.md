# AI Models & Billing — How Alethical Uses AI, and How It's Paid

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

## 5. Takeaways for scaling

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
- [RAG ingestion system design](../rag-ingestion-system-design.md) — the embedding /
  retrieval pipeline in depth.
