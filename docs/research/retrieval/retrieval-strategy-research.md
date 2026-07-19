# Research: Modern retrieval strategies for grounded legislative Q&A

**Date:** 2026-07-19
**Context:** Research to decide what retrieval Alethical's Grounded Ask should use beyond today's single-stage vector search, ranked **quality → speed → cost** (the team's stated priority), for a strict cite-or-refuse product over Minnesota legislative text.
**Provenance:** Produced via a multi-agent deep-research workflow — 46 sources fetched, **170 claims extracted, 106 adversarially verified** (independent agents actively trying to refute each claim). The workflow's automated synthesis step failed repeatedly, so this report was **hand-synthesized from the verified journal**; ~64 extracted claims never reached verification and are treated as lower-confidence throughout. Every figure below is flagged **[independent]** (peer-reviewed / academic / non-interested party) or **[vendor]** (company blog / benchmark authored by the party whose product wins it), and **[verified]** vs. **[unverified]**. In this dataset, adversarial verification systematically *downgraded* vendor/blog claims — so treat unflagged-as-independent numbers as optimistic.

> This is a point-in-time snapshot (see `docs/research/README.md`). The living, actionable layer is issues [#380](https://github.com/alethical-org/alethical/issues/380), [#399](https://github.com/alethical-org/alethical/issues/399), [#400](https://github.com/alethical-org/alethical/issues/400), cross-linked from `docs/grounded-ask-spec.md` §10 (Roadmap notes — deferred upgrades).

---

## What we use today

Single-stage **vector search**: OpenAI `text-embedding-3-small` (1536d) → cosine k-NN in Postgres/pgvector (IVFFlat, `lists=50`, `probes=10`), over ~220-word section-aware chunks (no overlap), top 3–4 chunks fed to `gpt-4o-mini` for synthesis. Two retrieval paths: **(a)** corpus-wide "which bill is this about?" resolution, **(b)** bill-scoped top-3/4 chunk retrieval. No keyword search, no hybrid, no reranker, no contextual retrieval. A `search_text` column exists on chunks but is unused — the lexical half is scaffolded, not wired.

## Bottom line

1. **Don't treat reranking as a free win.** The evidence for reranking on legal text is mixed and workload-specific — eval it, don't default to it or to any one vendor.
2. **The biggest *measured* lever is domain fine-tuning of embeddings** (independent: MRR@5 0.579→0.805), not an off-the-shelf vendor-model swap — but it's a larger, later investment.
3. **Contextual retrieval is cheap to test but its marginal value here is uncertain** — our chunks already carry a citation prefix, a cheap partial substitute for what it buys.
4. **Long-context bill-stuffing is likely a net loss for our stack** — the "long-context beats RAG" result specifically does *not* hold for weak models like `gpt-4o-mini`.
5. **The right 80/20 architecture is "escalate on retrieval failure," not "classify difficulty upfront."**
6. **GraphRAG is a "no" now, a scoped "yes" later** — it wins on multi-hop/cross-reference queries; gate it on cross-bill synthesis ([#87](https://github.com/alethical-org/alethical/issues/87)) actually shipping, not on corpus scale.
7. **Measure first.** No clean open benchmark exists for US legislative retrieval; the highest-value first move is an in-house eval ([#399](https://github.com/alethical-org/alethical/issues/399)), then eval-gated spikes.

---

## Strategy assessment (ranked by expected quality lift for this workload)

### Better / legal-domain embeddings — highest ceiling, but the big win is fine-tuning (later)
- **[independent, verified]** Fine-tuning BGE-M3 on in-domain legal data: MRR@5 **0.579 → 0.805** (~39% relative) — the single largest measured gain in the whole research base (NitiBench, EMNLP 2025). Larger than any off-the-shelf model swap reported anywhere here.
- **[vendor, unverified]** `voyage-law-2` beats OpenAI `text-embedding-3-large` by ~6% avg NDCG@10 on legal retrieval (>10% on 3/8 datasets). Same vendor also claims its *general* `voyage-3-large` beats its *own* legal model — an internal inconsistency to verify before trusting either.
- **[vendor, verified-as-vendor]** Isaacus Kanon 2 shows a ~17–34pt gap vs. `text-embedding-3-large` — but the benchmark author *is* Kanon 2's vendor, and on their own broader MLEB benchmark Kanon 2 essentially **ties** Voyage 3 Large (86.03 vs 85.71). The "dramatic" gap is comparison-specific. Kanon 2 does stand out in MLEB's "Regulatory" category (91.48), the closest analog to legislative text.
- No benchmark compares directly against our current `text-embedding-3-small` — deltas from our baseline are inferred, not measured.
- **Verdict:** eval-gated spike — swap to `voyage-3-large` as the cheap hosted upgrade; defer fine-tuning our own on MN legislative text as the higher-ceiling later investment.

### Reranking — real but workload-dependent; do NOT default-adopt
- **[independent, verified]** Cohere `rerank-english-v3.0` **reduced** retrieval vs. no reranker on LegalBench-RAG, worst on the hardest subset (MAUD). (Tested v3.0, *not* the newer Rerank 3.5.)
- **[unverified, vendor-adjacent blog, no legal data]** A 12-reranker ELO benchmark ranked **Zerank 2** and **Cohere Rerank 4 Pro** top, **Voyage rerank-2.5** best quality/latency balance, and **Cohere Rerank 3.5** (the model originally proposed) **10th of 12**.
- **Two different Cohere models:** the legal-text negative result (v3.0) and the low ELO ranking (3.5) are *separate* models on *separate* tests — neither is a verified indictment of Rerank 3.5 *on legislative text specifically*.
- **[vendor, verified]** In Anthropic's own contextual-retrieval numbers, the reranker's *own* increment (2.9%→1.9%) was **smaller** than contextual embeddings' own increment (5.7%→2.9%) — reranking is a second-order lever there, not the headline.
- **[independent, verified]** Reranker quality degrades once candidate pools grow to hundreds/thousands of docs; gains concentrate at small top-k — which matches our usage.
- **Verdict:** eval-gated spike, A/B **2–3 rerankers on our own legal data** (Voyage rerank-2.5, Cohere Rerank 4, a legal-tuned option). Do not default to any vendor's pick. Cost: one hosted API round-trip (~tens of ms) + per-query fee; cheap to abandon.

### Contextual retrieval (Anthropic-style) — cheap to test, uncertain marginal lift
- **[vendor, verified]** Contextual embeddings alone: −35% failure rate (5.7%→3.7%); + contextual BM25: −49% (→2.9%); + reranker: −67% total (→1.9%). Untested on legal/legislative text (codebases, fiction, research papers only) — domain transfer unproven.
- **[independent critique, verified]** Cheap structural context (headings/titles) captures much of the benefit vs. expensive LLM-generated context — **directly relevant: our chunks already carry a citation prefix serving that role**, so our marginal lift may be small.
- **[vendor, verified — cost figure stale]** Anthropic's $1.02/M-token ingest cost was priced on Claude 3 Haiku (retired Apr 2026); re-derived on Haiku 4.5 it's **~$3.80–4.10/M** — still cheap in absolute terms even at full-corpus scale.
- **Verdict:** eval-gated spike (ingest cost trivial), but lower priority than reranker/embedding given the existing citation prefix.

### Query-side (rewriting, multi-query, HyDE) — evidence warns against blanket use
- **[independent, verified]** "Coverage illusion": synthetic benchmarks implied >90% of queries need LLM augmentation; real production traffic needed it only **27.8%** of the time. Augmentation gains largely evaporate on real (short, keyword-like) queries.
- **[independent, verified]** Query expansion/HyDE helps *weak* retrievers and can *hurt* strong ones (~5.4% degradation in one study); multi-query fusion scored *below* the naive baseline in one general-domain benchmark.
- **Verdict:** do not add always-on query expansion. If built, gate it behind an observed retrieval-failure signal (see 80/20 below); never trust a synthetic eval's estimate of how often it fires.

### Structural / hierarchical (parent-document, GraphRAG) — current design validated; don't over-build
- **[independent, verified]** Section-aware / hierarchy-aware chunking beats naive chunking on legal text (corroborated across Thai and German legal corpora) — this **validates what `chunk_paragraphs` already does**; not a reason to change it.
- **[independent, verified]** Automatic cross-reference *following* gave no significant end-to-end gain in the one study that tested it.
- **[independent, verified, replicated twice]** Plain RAG wins single-hop/detail lookups (most current traffic); GraphRAG wins **multi-hop** reasoning — the shape of statutory cross-reference questions. Community-based GraphRAG has a documented citation-attribution weakness (a real risk for cite-or-refuse). A specialized system (LegalGraphRAG) beats both plain and generic GraphRAG on legal multi-hop by 6.3–19.1%.
- **Verdict:** don't build a general graph layer now. Scope it **when cross-bill synthesis ([#87](https://github.com/alethical-org/alethical/issues/87)) ships**, not before.

### Late-interaction / learned-sparse (ColBERT/PLAID, SPLADE) — skip
- **[independent, verified]** ColBERTv2-as-reranker over BM25 beats a dedicated PLAID engine at low latency but hits a lexical recall ceiling; PLAID needs careful tuning of 3 pruning params (operational burden); a newer engine (WARP, 2025) already makes the comparison stale. No SPLADE evidence survived (a gap, not a refutation). Multi-vector storage balloons to TB-scale at multi-state scale.
- **Verdict:** skip. No evidence it beats hybrid+rerank at our scale; adds real infra/tuning burden.

### Long-context stuffing vs. chunk RAG — skip for our stack
- **[independent, verified]** General-domain long-context beats chunk RAG on average (56.3% vs 49.0%) — **but** a newer peer-reviewed study found well-tuned chunk baselines match/beat it once token budgets are matched fairly; and **chunk RAG beats long-context on weak/small models by 6.5–38% (LaRA, ICML 2025)** — our `gpt-4o-mini` is weak-tier.
- **[independent, verified]** The one legal test (Thai statutes) found long-context *losing* to RAG even with the whole corpus in a 2M window; one costed study found long-context winning on quality but at **~26x token cost**.
- **[vendor, verified as unbenchmarked]** Anthropic's "<200k tokens, skip RAG" is a rule of thumb — no comparison test backs it.
- **Verdict:** skip. The evidence most specific to our config (weak model, cost-conscious) argues against it.

---

## Curated evidence table

| Finding | Metric | Source type | Verified? |
|---|---|---|---|
| BGE-M3 domain fine-tuning | MRR@5 0.579 → 0.805 | independent (NitiBench, EMNLP 2025) | verified |
| Cohere v3.0 reranker on legal text | reduced retrieval vs. none | independent (LegalBench-RAG) | verified |
| Cohere Rerank 3.5 quality rank | 10th of 12 (ELO) | vendor-adjacent blog, no legal data | unverified |
| Voyage rerank-2.5 | best quality/latency balance | vendor-adjacent blog | unverified |
| Contextual retrieval failure-rate | 5.7%→3.7%→2.9%→1.9% (35/49/67%) | vendor (Anthropic), non-legal | verified |
| Contextual retrieval ingest cost | ~$3.80–4.10/M tokens (Haiku 4.5; $1.02 figure stale) | vendor arithmetic | verified |
| voyage-law-2 vs 3-large | ~6% avg NDCG@10 on legal | vendor | unverified |
| Kanon 2 vs text-embedding-3-large | +17–34 pts; ties Voyage on MLEB (86.03/85.71) | vendor (author = model maker) | verified-as-vendor |
| Query augmentation real vs synthetic need | 27.8% real vs >90% synthetic | independent | verified |
| Long-context on weak models | chunk RAG beats LC 6.5–38% (LaRA) | independent (ICML 2025) | verified |
| Long-context token cost | ~26x for ~7.7pt gain | independent case study | verified |
| RAG vs GraphRAG | RAG wins single-hop; GraphRAG wins multi-hop | independent, replicated twice | verified |
| Post-retrieval failure share | ~64.5% of RAG failures occur after successful retrieval | independent (error taxonomy) | verified |

---

## The 80/20 fast-path / slow-path split

**What doesn't work:** predicting upfront (before searching) how hard a question is and routing on that guess. A production study found a synthetic-trained classifier didn't transfer to real traffic.

**What works:** route on what actually happens when you search. Run the cheap path first (current retrieval); escalate to something slower (rerank, hybrid keyword search, query expansion, or refusal) only when the fast path **actually returns nothing usable**. In the one real-world case study, this served **72.2%** of traffic from the fast path alone, improved answer quality, and cut latency 32%. (Caveats: general-knowledge domain, "zero results" trigger not a confidence score — directional, not a recipe. A peer-reviewed counterexample, Adaptive-RAG, shows upfront classification *can* work when trained on the right signal.)

**What to evaluate to draw the line:** exactly the eval in [#399](https://github.com/alethical-org/alethical/issues/399). Run real questions through today's retrieval; the fraction that get a confident, correctly-cited answer **is** your fast-path serve rate. The genuine misses are your slow-path population.

---

## Decision factors beyond quality / speed / cost

- **Groundedness / citation fidelity** — given cite-or-refuse, arguably belongs *above* generic retrieval accuracy. Note: the much-repeated "retrieval sets the ceiling" claim traces to a single vendor source; independent error-taxonomy work finds **~64.5% of RAG failures happen after successful retrieval**, so don't neglect generation-side refusal calibration while chasing retrieval gains.
- **Maintainability / deprecation risk** — demonstrated concretely: Anthropic's own cost example broke when its model was retired 18 months later. Any vendor pipeline needs a model-pinning/rotation plan.
- **Vendor lock-in / benchmark conflicts of interest** — adopt as standing discipline: weight independent, peer-reviewed evidence above vendor blog benchmarks by default.
- **Scalability headroom** — not urgent now; a real gate for the multi-state phase (multi-vector storage, GraphRAG ingest token cost).
- **Determinism / testability** — already a tiebreaker in [#380](https://github.com/alethical-org/alethical/issues/380) (the lexical FTS arm is deterministic in tests, unlike hash-fallback embeddings).

---

## Adoption roadmap (eval-gated per step, phased to corpus scale)

**Phase 0 (in flight):** Hybrid FTS+RRF for bill resolution — [#380](https://github.com/alethical-org/alethical/issues/380).

**Phase 1 — recent-session MN bills (current):**
1. Extend the eval into a general retrieval-quality harness — [#399](https://github.com/alethical-org/alethical/issues/399).
2. Reranker spike (Voyage rerank-2.5 / Cohere Rerank 4 / legal-tuned; not Cohere by default) — [#400](https://github.com/alethical-org/alethical/issues/400).
3. Embedding spike (`voyage-3-large` vs `text-embedding-3-small`) — [#400](https://github.com/alethical-org/alethical/issues/400).
4. Contextual-retrieval spike (vs. existing citation prefix) — [#400](https://github.com/alethical-org/alethical/issues/400).
5. Build the escalate-on-failure cascade using the eval's fast-path serve rate.

**Phase 2 — full MN history (hundreds of thousands of chunks):** re-run the eval at scale before assuming Phase 1 holds; revisit IVFFlat tuning.

**Phase 3 — multi-state (millions):** only now reconsider late-interaction / dedicated search infra if hybrid+rerank breaks down; re-evaluate embedding storage (matryoshka/quantization).

**Gated on a feature shipping, not scale:** no graph/cross-reference layer until cross-bill synthesis ([#87](https://github.com/alethical-org/alethical/issues/87)) is a shipped feature that needs it.

---

## Caveats & gaps

- Legal-domain evidence specific to **US legislative/statutory bill text** is thin — most "legal" findings are cross-jurisdictional analogs (contracts, Thai/German/Belgian statutes, Australian criminal law).
- ~64 of 170 extracted claims never got adversarial verification; they informed which spikes to *test*, not what to adopt.
- **No usable evidence survived on semantic caching or RAGAS specifically** — genuine coverage gaps (search-side, not verification casualties). A narrower follow-up research query would be needed to cover them.
