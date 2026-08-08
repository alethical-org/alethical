# Alethical Docs

Project documentation lives here so the repository root stays focused on runnable
code and configuration.

**How to read these.** Specs describe the system we intend and the decisions behind
it; **GitHub issues and the Roadmap board carry sequencing.** So a doc may tell you
something is *shipped*, *not built yet and waiting on X*, or *a permanent non-goal* —
but never that work is off-limits because of which milestone it sits in. If you find
a doc gating work by version, that is a bug in the doc (`.claude/rules/workflow.md`
rule 13). Milestone claims in particular go stale: check the tracker, not the prose.

## Start Here

- [Philosophy](philosophy.md) — the *why* beneath Alethical: what the product is, the problem it solves (legibility, not secrecy), who we assume is reading, and the principles the product, design, and copy all answer to. Read this before the specs.

## Product & Onboarding

What we're building and what we deliberately aren't, plus the guides for learning how it
works. The specs come first; the guides and operating references near the end explain how
things work in practice and are the place to start if you're new.

- [Scope](product-onboarding/product-scope.md) — what the product is, its core principles, and what it deliberately does not do
- [What we keep about readers](product-onboarding/user-data-retention-policy.md) — every piece of reader data we store, why it exists, how long we keep it, what deletion should mean, and the gaps that are not closed yet
- [Grounded Ask build spec](product-onboarding/grounded-ask-spec.md) — the Ask surface: answer paths, the cite-or-refuse contract, answer-page states
- [MVP redesign plan](product-onboarding/mvp-redesign-plan.md) — IA + green-aesthetic redesign tracker; locked decisions and the route registry
- [Bill search screen spec](product-onboarding/bill-search-screen-spec.md) — the bill search screen (`/bills`)
- [Bill tracking interaction spec](product-onboarding/bill-tracking-spec.md) — how Track behaves on every page, through sign-in, and inside full-card links
- [Bill Text tab spec](product-onboarding/bill-text-tab-spec.md) — how a bill's official text is parsed, marked up, and rendered, plus the section-index rail and citation anchors
- [Answer quality bar](product-onboarding/answer-quality-bar.md) — what a good generated answer is, how the eval measures it, and the judge calibration behind the scores
- [Tracked-bill notifications](product-onboarding/tracked-bill-notifications-spec.md) — the plan for telling people their bill moved: what an email would say, how often, what it costs, and how a live send stays gated until it is proven. Nothing built yet
- [Data ingestion onboarding guide](product-onboarding/data-ingestion-onboarding.md) — sources, URLs, and pipeline-flow diagram for new engineers
- [AI models & billing](product-onboarding/ai-models-and-billing.md) — how Alethical uses AI (generation vs embeddings), the two billing rails (subscription vs API), and which jobs need which
- [How Search works (plain English)](product-onboarding/search-bills-guide.md) — what each filter and result field means, written for non-engineers
- [How Find My Legislator works (plain English)](product-onboarding/find-my-legislator-guide.md) — how to search by address, browser location, or map; what a match shows; and what location data leaves Alethical
- [How sharing works](product-onboarding/sharing-guide.md) — what each page and destination receives, why Instagram has no direct button, and how link previews are built
- [How Contact us works](product-onboarding/contact-us-guide.md) — the page, its 5 states, message delivery, and what reader data leaves Alethical

## Design

- [Design principles](design/design-principles.md) — green system's design intent + visual/interaction/accessibility rules; brief for Claude Design
- [UI copy guide](design/ui-copy-guide.md) — voice and tone

## Architecture

- [AI platform position](architecture/ai-platform-position.md) — what we buy direct, what we build ourselves, what we skip, and the trigger that would reverse each call
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
- [Page-load performance decisions](operations/page-load-performance-decisions.md): measured safe speed work, remaining tradeoffs, and the proof required before release
- [iOS release workflow](operations/ios-release.md) — simulator QA, TestFlight, and ad hoc builds
- [Android prototype handoff](operations/android-prototype-handoff.md) — the Expo/RN Android build path
- [Windows local development notes](operations/local-dev-windows.md)
- [Keeping docs current — decisions](operations/keeping-docs-current-decisions.md) — why the stale-docs check relies on declarations a human writes, and the four automated alternatives we measured and rejected
- [Production database schema drift](operations/production-database-schema-drift.md) — the eleven ways production and the code disagreed, which side was right in each, and the CI check that now catches the next one

## About this folder

- [How `docs/` is organized](folder-structure.md) — the folder layout and where a new doc goes
- **How these are kept current** — see "Keeping docs current" in [`CONTRIBUTING.md`](../CONTRIBUTING.md). Short version: a doc that describes behaviour names the code it describes in a `<!-- describes: -->` comment, and CI then fails any PR that changes that code without one `Docs check:` line saying what the author concluded. If you write a doc that describes how something behaves, give it that comment; frozen records deliberately don't have one.
