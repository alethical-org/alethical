# Alethical Docs

Project documentation lives here so the repository root stays focused on runnable
code and configuration.

**How to read these.** Specs describe the system we intend and the decisions behind
it; **GitHub issues and the Roadmap board carry sequencing.** So a doc may tell you
something is _shipped_, _not built yet and waiting on X_, or _a permanent non-goal_ —
but never that work is off-limits because of which milestone it sits in. If you find
a doc gating work by version, that is a bug in the doc (`.claude/rules/workflow.md`
rule 13). Milestone claims in particular go stale: check the tracker, not the prose.

## Start Here

- [Philosophy](philosophy.md) — the _why_ beneath Alethical: the beliefs the product, design, and copy all answer to. Read this before the specs.

## Product & Onboarding

What we're building and what we deliberately aren't, plus the guides for learning how it
works. The specs come first; the last three are the "how does this actually work / how is it
paid for" references, and are the place to start if you're new.

- [Scope](product-onboarding/product-scope.md) — what the product is, its core principles, and what it deliberately does not do
- [Grounded Ask build spec](product-onboarding/grounded-ask-spec.md) — the Ask surface: answer paths, the cite-or-refuse contract, answer-page states
- [MVP redesign plan](product-onboarding/mvp-redesign-plan.md) — IA + green-aesthetic redesign tracker; locked decisions and the route registry
- [Bill search screen spec](product-onboarding/bill-search-screen-spec.md) — the bill search screen (`/bills`)
- [Data ingestion onboarding guide](product-onboarding/data-ingestion-onboarding.md) — sources, URLs, and pipeline-flow diagram for new engineers
- [AI models & billing](product-onboarding/ai-models-and-billing.md) — how Alethical uses AI (generation vs embeddings), the two billing rails (subscription vs API), and which jobs need which
- [How Search works (plain English)](product-onboarding/search-bills-guide.md) — what each filter and result field means, written for non-engineers

## Design

- [Design principles](design/design-principles.md) — green system's design intent + visual/interaction/accessibility rules; brief for Claude Design
- [UI copy guide](design/ui-copy-guide.md) — voice and tone; note its own header on what is still unreconciled

## Architecture

- [Backend API system design](architecture/backend-api-system-design.md) — REST conventions, namespace layout, and the endpoint inventory
- [Database schema system design](architecture/db-schema-system-design.md) — table groups, modeling decisions, and the query rubric
- [Frontend screen system design](architecture/frontend-screen-system-design.md) — the original 16-screen plan; content rules and empty/error states still apply
- [Ingestion layer 1 — source ingestion](architecture/layer-1-source-ingestion-system-design.md) — official sources → canonical records: the seven pipeline stages and enrichment status
- [Ingestion layer 2 — RAG ingestion](architecture/layer-2-rag-ingestion-system-design.md) — canonical records → retrieval chunks: cleaning, chunking, and the retrieval index
- [Canonical legislator membership spec](architecture/legislator-roster-canonical-membership-spec.md) — reconciling the roster PDF into current-member state
- [Research](research/) — retrieval-strategy and persona findings behind deferred RAG upgrades

## Operations

- [Deployment](operations/deployment.md) — the six GitHub Actions workflows, Railway (backend), Vercel (frontend), Supabase auth URLs
- [Repo and service settings](operations/repo-and-service-settings.md) — every setting that controls the project but doesn't live in the repo, and its intended value
- [API CDN setup](operations/api-cdn-setup.md) — Cloudflare in front of the API, plus email authentication records
- [iOS release workflow](operations/ios-release.md) — simulator QA, TestFlight, and ad hoc builds
- [Android prototype handoff](operations/android-prototype-handoff.md) — the Expo/RN Android build path
- [Windows local development notes](operations/local-dev-windows.md)

## About this folder

- [How `docs/` is organized](folder-structure.md) — the folder layout and where a new doc goes
