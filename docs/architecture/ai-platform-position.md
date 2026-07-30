# AI Platform Position — What Alethical Buys, Builds, and Refuses to Adopt

> **Net:** Alethical buys models straight from the companies that make them, and
> builds the trust layer itself. No routing middleman, no own-model hosting, no
> compliance suite. The next platform investment is not a vendor at all: it is the
> record that proves which official text an answer came from, and a rule that stops
> Ask answering confidently from stale data.
>
> Decided July 2026, after evaluating 17 inference / routing / hosting platforms
> against this repository and pressure-testing the conclusion with two independent
> outside model reviews. This is a standing position, not a one-time survey: it
> states what would reverse each decision, so a future session can check the
> trigger rather than re-run the survey.

## 1. Durable constraints

These are facts about Alethical, not preferences. Every decision below follows from
them.

1. **Every model call is server-side Python.** There is no JavaScript server — the
   frontend is a static Expo web export on Vercel, the API is FastAPI on Railway. A
   platform whose value is its JS runtime or SDK cannot reach our call sites.
2. **Two classes of AI work with opposite economics.** Calls a reader waits on
   (correctness critical, seconds of patience) and bulk corpus jobs (hours,
   unattended, resumable, priced by batch discounts).
3. **Production retrieval is pinned to one embedding vector space.** Not permanently
   frozen: `rag_chunk_embedding.embedding_model` already versions every stored
   vector and retrieval filters on it, so a dual-index comparison is available
   whenever a named retrieval problem justifies the work. What it *is* is pinned
   *today* — a mismatched vector space corrupts search silently rather than erroring.
4. **The product promise is cite-or-refuse.** Any change to model behaviour is a
   correctness event requiring measurement, never a configuration change
   (`.claude/rules/grounded-answers.md` rule 1).
5. **One maintainer.** Operational surface competes directly with product work, so
   it carries a real and high cost.
6. **The corpus is public record; our readers' data is not.** This distinction is
   load-bearing and was the sharpest correction from outside review. It justifies
   skipping vendor governance platforms. It does **not** make privacy irrelevant:
   we store chat messages, saved places (address text), notification preferences,
   tracked bills and auth records.
7. **The competitive asset is the corpus and the grounding contract, not model
   weights.** There is no fine-tuning requirement.

## 2. Adopt — permanent posture

**A. Buy models directly from their providers.** Choose per job by measured quality
and cost, and record the benchmark that justified it. Precedent: enrichment runs on
Claude Sonnet because #377 measured ~95% citation coverage at ~40% of Opus's cost;
the embedding model stayed OpenAI `text-embedding-3-small` because #400 measured no
accuracy gain worth a migration.

**B. One internal choke point, with per-job retry budgets.** Every provider call
runs through one place that retries briefly and then degrades to an honest refusal
rather than surfacing an error. **Retry policy is per job and per failure phase, not
one universal rule** — a correction from outside review, which rightly rejected a
blanket "never retry a timeout":

| Job | Policy |
|---|---|
| Intent classification | Short attempt, one retry, then the deterministic offline fallback |
| Query embedding | Short retries of the identical request — idempotent and cheap |
| Ask generation | Retry only if latency budget remains and no output began; never expose partial unsupported text |
| Batch summaries | Resubmit only incomplete item IDs from a durable checkpoint |

The deadline matters more than the retry count: a 30-second per-attempt timeout is
already past a reader's patience, so per-attempt deadlines come down *before* any
retry policy is meaningful. We call providers over plain HTTP rather than their
SDKs, so there is no hidden SDK retry to multiply — if that changes, the choke point
must own the total attempt budget explicitly.

**C. An automated correctness gate, tiered.** A fast suite on every pull request and
a broader suite nightly or pre-release, measuring retrieval recall and ranking,
citation existence and support, unsupported claims, correct refusals, classifier
accuracy, and schema validity. Vendors do sell evaluation machinery; what none of
them can supply is *Alethical's definition of truth* — which bills are relevant,
whether a claim follows from its cited source, when refusal is required. **We own
the dataset, the criteria and the release thresholds even if a vendor ever runs the
execution.** Tracked as [#399](https://github.com/alethical-org/alethical/issues/399).

**D. Provider-native batch for bulk corpus work.** Anthropic's batch discount is
real money on a 10,471-bill corpus, and the runner is already checkpointed and
resumable. The honest promise is that interruption *minimizes* duplicate spend, not
that it costs nothing: requests already accepted when a worker stops may still be
billed.

**E. Cost attribution from our own request records, reconciled against invoices.**
We own feature-level attribution; the provider invoice remains the financial source
of truth.

**F. A freshness contract that gates answers.** Staleness is enforced at the answer
path, not reported to a mailbox. Detail and acceptance:
[#800](https://github.com/alethical-org/alethical/issues/800).

**G. A per-answer evidence receipt.** Enough to replay any answer: bill and session
IDs, source revision or checksum, exact retrieved passages with scores and ordering,
embedding and corpus version, prompt version, the model alias requested *and* the
concrete model the provider reported, request ID and timestamp, citation-validation
result, and answer-or-refusal outcome. A public model alias is not a pinned version.
Detail: [#801](https://github.com/alethical-org/alethical/issues/801).

## 3. Hold — adopt only on a named trigger

**A multi-provider gateway.** Not an architecture decision; a future optimization
with measurable triggers. Reconsider when any one of these persists:

- Feature-level billing reconciliation costs more than ~2 maintainer hours a month,
  or the internal ledger diverges from invoices by more than 5% for two months.
- Request reconstruction is still inadequate *after* the evidence receipt exists.
- More than one model or provider comparison per month needs custom routing code.
- Rate limits become a persistent production problem a gateway could actually fix.
- A reversible pilot demonstrates lower total operational burden.

Constraints when a trigger fires: prefer a vendor already in the stack (Cloudflare
AI Gateway is a base-URL swap needing no Workers, and covers the Responses-shaped
generation calls); pilot on intent classification only, because it has a labeled
test set, a bounded output and a deterministic fallback; **never place a gateway in
front of the embedding call.**

**Managed evaluation or observability tooling.** Adopt when maintaining experiment
history, traces or datasets exceeds roughly 2–4 hours a month — not when correctness
*definition* becomes hard, which stays ours.

**An embedding-model migration.** Do not migrate speculatively. Keep the dual-index
path safe and reversible, and migrate only against a named retrieval problem, a
measured recall or ranking gain, or an impending deprecation.

## 4. Skip — with what would reverse it

| Skip | What flips it |
|---|---|
| Fine-tuning, custom weights, GPU hosting | A stable high-volume labeled extraction task, e.g. expansion to many states |
| Latency-specialist inference hardware | Profiling shows model generation dominates p95 latency (our measured wins have been index-shaped: HNSW cut search 8.9s → 0.19s) |
| Self-hosted gateways | A dedicated operator exists, or several products share the model layer |
| Enterprise governance / compliance platforms | Private, user-owned or customer-owned data enters the model workflow |
| Coding-assistant spend governance | Team growth makes it an engineering-finance decision, separate from product architecture |
| Automatic cross-model failover on answers | Nothing. Falling back to a different model changes answers, so it is a quality experiment, never a reliability mechanism |
| Semantic answer caching | Only with cache keys covering normalized query, corpus version, prompt version, model version, retrieval config and evidence IDs |

## 5. Two tests, not one, for any model or route change

Conflating these is how a legitimate improvement gets rejected and a silent
regression gets shipped.

- **Same model, different route** (e.g. via a gateway): require *parity*. Top-k
  overlap, rank correlation, recall of known-relevant bills, a cap on movement for
  critical results, and end-to-end answer and citation parity. Exact tie-order
  equality is a useful first check, not the pass condition — nearly-tied records may
  legitimately swap.
- **Different model**: require measured *improvement* on the labeled query set
  (`scripts/retrieval_eval.py`), plus no regression on critical query classes and a
  documented rollback.

## 6. Ranked roadmap

**The sequencing rule, so this order stops getting re-proposed.** Two outside
reviews have now suggested different orderings, both reasonable, neither grounded in
a stated rule. The rule is:

1. **A true dependency forces order.** One is known **among the items identified
   today**: the retention policy (#803) precedes evidence receipts (#801), because a
   receipt can contain a reader's own question, and building the store first means
   retrofitting it. This is a dependency *graph*, not a fixed count — implementation
   may surface others, and new evidence is exactly the right reason to revise it.
2. **Reader-visible failures outrank internal capability.** An error page a reader
   hits today beats a policy document that blocks nothing but item 5.
3. **Prevention outranks diagnosis.** Freshness gating (#800) stops a confidently
   stale answer reaching a reader; receipts (#801) help explain one after the fact.
   `.claude/rules/grounded-answers.md` rule 7 calls the stale answer the sneakier
   failure, so the gate goes first. **This ranks the work; it is not permission to
   ship a preventive fix you cannot confirm is working.** Every preventive item
   carries enough of its own telemetry to prove its behaviour — for #780 that means
   the normalized failure type, attempts used, elapsed time, and which degradation
   path was taken, so "retries are absorbing rate limits" is distinguishable from
   "every call burns three attempts and refuses." Shape of the failure only, never
   reader-supplied text, until #803 is written.
4. **Already-measured and bounded work runs in parallel**, not at the end of the
   queue.

Two reorderings were proposed and declined on that basis: moving the retention
policy ahead of the retry fix (no dependency justifies delaying a live error path),
and moving receipts ahead of freshness gating (diagnosis before prevention).
Reopening the order needs a new dependency or new evidence, not a new preference.

1. **Per-job retry budgets and honest degradation** —
   [#780](https://github.com/alethical-org/alethical/issues/780). Done when
   simulated timeouts, rate limits and provider failures never produce an unhandled
   error page.
2. **Automate the correctness gate** —
   [#399](https://github.com/alethical-org/alethical/issues/399). Cheapest item on
   the list: the scorer already exists. Done when a material regression cannot merge.
3. **User-data retention and redaction policy** —
   [#803](https://github.com/alethical-org/alethical/issues/803). Done when every
   stored field has a purpose, a retention period and a deletion path.
4. **Corpus freshness enforcement** —
   [#800](https://github.com/alethical-org/alethical/issues/800). Done when a missed
   refresh is detected automatically and stale-sensitive answers cannot present as
   current.
5. **Per-answer evidence receipts** —
   [#801](https://github.com/alethical-org/alethical/issues/801). Done when an
   answer ID reconstructs exactly what source text the model saw.
6. **Recovery drill and single-region decision** —
   [#802](https://github.com/alethical-org/alethical/issues/802). Done when RPO and
   RTO are measured from a real restore and the risk is accepted in writing.

**Already done, and the precedent for rule 4:** prompt caching for batch summaries
([#779](https://github.com/alethical-org/alethical/issues/779), closed Jul 30 2026
via [#785](https://github.com/alethical-org/alethical/pull/785)). It was measured
(2,698 identical tokens re-paid per summariser call), bounded, and blocked none of
the safety work, so it shipped alongside rather than queueing behind it.

## 7. The durable principle

> Alethical owns the evidence trail, the correctness definition, the freshness
> contract and the failure behaviour. Vendors supply models and infrastructure. No
> vendor becomes the only place we can determine what happened, or whether an
> answer was trustworthy.

Until the evidence trail exists, adding another platform increases the number of
components without resolving the question that actually matters: whether our answers
remain grounded, current and reproducible.

## Related

- [AI models & billing](../product-onboarding/ai-models-and-billing.md) — which jobs
  use which model, and the two billing rails that pay for them.
- [`.claude/rules/grounded-answers.md`](../../.claude/rules/grounded-answers.md) —
  the cite-or-refuse invariants this position exists to protect (rule 1 refusal,
  rule 7 freshness).
- [RAG ingestion system design](layer-2-rag-ingestion-system-design.md) — the
  embedding and retrieval pipeline the vector-space constraint applies to.
