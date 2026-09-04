# Research reports

Point-in-time research investigations, grouped by topic. These are **dated snapshots** of what we learned from a research pass — distinct from the specs and system-design docs in `docs/`, which are *living* documents describing what we build and decide.

**Convention:**
- A research report is a snapshot; it carries a date and a provenance note (how it was produced, how many sources/claims, what was verified). It is not updated as the world changes — a new pass gets a new report.
- The *decisions* a report drives live in the relevant spec/design doc and as GitHub issues (the living, actionable layer), cross-linked back to the report.
- Group by topic once a topic has more than one report; don't nest deeper than `topic/` without cause.

**Ungrouped reports:**
- `real-visitor-page-speed-sources.md` — what Cloudflare Web Analytics and Vercel Analytics, both already loaded on every page, record about how fast real visits are; whether we can read it without paying; and the first per-address figures (4 Sep 2026).
- `base44-campaign-finance-findings.md` — what the retired Base44 campaign-finance build got wrong.
- `359-prior-biennium-public-readiness.md` — whether the prior biennium's records were ready to publish.

**Topics:**
- `persona/` — real-human persona / agent-persona chatbots (identity grounding, role-vs-persona, citation fidelity).
- `retrieval/` — retrieval strategy for grounded Q&A (embeddings, reranking, hybrid search, contextual retrieval, routing, evaluation).
