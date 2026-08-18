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

- [Philosophy](philosophy.md) — the _why_ beneath Alethical: what the product is, the problem it solves (legibility, not secrecy), who we assume is reading, and the principles the product, design, and copy all answer to. Read this before the specs.

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
- [How sign-in works](product-onboarding/sign-in-guide.md) — Google and password sign-in, email links, account matching, password rules, and release settings
- [How Home works](product-onboarding/home-screen-guide.md) — the signed-out and signed-in opening sections, bill activity, editorial news picks, and phone layout
- [How Bill Detail works](product-onboarding/bill-detail-guide.md) — the summary, actions, votes, versions, Bill Text, source line, and phone order
- [How legislator profiles work](product-onboarding/legislator-profile-guide.md) — identity, committees, bills, service history, public money records, and planned features
- [Bill Text tab spec](product-onboarding/bill-text-tab-spec.md) — how a bill's official text is parsed, marked up, and rendered, plus the section-index rail and citation anchors
- [Answer quality bar](product-onboarding/answer-quality-bar.md) — what a good generated answer is, how the eval measures it, and the judge calibration behind the scores
- [Campaign finance roadmap](product-onboarding/campaign-finance-roadmap.md) — plain-language plan for putting Minnesota campaign money on the site: what we are building, in what order, and the one rule that shapes it
- [When a committee's next money report is due](product-onboarding/campaign-finance-filing-calendar-guide.md) — why a legislator's money page can honestly show nothing for a whole year, which of the state's 4 filing calendars applies to whom, and what we refuse to claim
- [Tracked-bill notifications](product-onboarding/tracked-bill-notifications-spec.md) — the plan for telling people their bill moved: what an email would say, how often, what it costs, and how a live send stays gated until it is proven. Nothing built yet
- [Data ingestion onboarding guide](product-onboarding/data-ingestion-onboarding.md) — sources, URLs, and pipeline-flow diagram for new engineers
- [AI models & billing](product-onboarding/ai-models-and-billing.md) — how Alethical uses AI (generation vs embeddings), the two billing rails (subscription vs API), and which jobs need which
- [How Search works (plain English)](product-onboarding/search-bills-guide.md) — what each filter and result field means, written for non-engineers
- [How Find My Legislator works (plain English)](product-onboarding/find-my-legislator-guide.md) — how to search by address, browser location, or map; what a match shows; and what location data leaves Alethical
- [How the Campaign money tab works (plain English)](product-onboarding/legislator-campaign-money-guide.md) — what a legislator's campaign raised and spent, why roughly 4 dollars in 10 have no donor's name, and when the page shows two figures rather than working out the difference
- [How sharing works](product-onboarding/sharing-guide.md) — what each page and destination receives, why Instagram has no direct button, and how link previews are built
- [How Contact us works](product-onboarding/contact-us-guide.md) — the page, its 5 states, message delivery, and what reader data leaves Alethical
- [How the Site metrics page works](product-onboarding/traffic-guide.md) — the 4 public totals, Vercel source, privacy boundary, team-account exclusion, and page states
- [About Us page](product-onboarding/about-us-page-spec.md) — the public statement of Alethical’s name, beliefs, current features, roadmap, and correction policy

## Design

- [Design principles](design/design-principles.md) — green system's design intent + visual/interaction/accessibility rules; brief for Claude Design
- [UI copy guide](design/ui-copy-guide.md) — voice and tone
- [Committee money page design prompt](design/committee-money-page-design-prompt.md) — frozen Claude Design request for #1442's committee money screen (dated 18 Aug 2026)

## Architecture

- [Backend stack](architecture/backend-stack.md) — **start here for the backend:** every piece of the running system in one page (language, web service, database, sign-in, job queue, AI providers, email, hosting, tests), what we deliberately don't run, and which doc covers each part in depth
- [Bill refresh cadence decisions](architecture/bill-refresh-cadence-decisions.md) — how often to re-fetch bills and why: the measured activity data behind each interval, the four safety fixes that must land before anything is scheduled, and the alternatives that lost
- [AI platform position](architecture/ai-platform-position.md) — what we buy direct, what we build ourselves, what we skip, and the trigger that would reverse each call
- [How Alethical calls OpenAI and Anthropic, and when it retries](architecture/ai-provider-calls-and-retries.md): the accepted official-library plan, current failure risks, retry and deadline rules, honest reader states, work order, effort, and open questions
- [Page metadata for search and sharing — decisions](architecture/page-metadata-for-search-and-sharing-decisions.md) — why every address serves search engines the same title today (link previews already work), the wording rule for each page type, robots/sitemap/structured-data calls, and the four ways to fix it with the recommended two-release plan (proposal, not built)
- [Backend API system design](architecture/backend-api-system-design.md) — REST conventions, namespace layout, and the endpoint inventory
- [Database schema system design](architecture/db-schema-system-design.md) — table groups, modeling decisions, and the query rubric
- [Frontend screen system design](architecture/frontend-screen-system-design.md) — the original 16-screen plan; content rules and empty/error states still apply
- [Ingestion layer 1 — source ingestion](architecture/layer-1-source-ingestion-system-design.md) — official sources → canonical records: the seven pipeline stages and enrichment status
- [Ingestion layer 2 — RAG ingestion](architecture/layer-2-rag-ingestion-system-design.md) — canonical records → retrieval chunks: cleaning, chunking, and the retrieval index
- [Canonical legislator membership spec](architecture/legislator-roster-canonical-membership-spec.md) — reconciling the roster PDF into current-member state
- [Campaign finance system design](architecture/campaign-finance-system-design.md) — Minnesota campaign-finance sources, whole-set snapshot ingestion, amendments, identity, and the display rules
- [Research](research/) — retrieval-strategy and persona findings, what the retired Base44 campaign-finance build got wrong and why the replacement is designed differently, and a plain-language reference to every entity in Minnesota campaign-finance and lobbying data ([minnesota-campaign-finance-entities.md](research/minnesota-campaign-finance-entities.md))

## Operations

- [Branching, drawn](operations/git-branching-guide.html) — visual companion to `CONTRIBUTING.md` "Branch & PR workflow", for onboarding: 2 commit graphs, one measuring this repo's real branch shape and one showing the dev/staging/production reference flow, plus the habits and commands behind each
- [Production setup and recovery](operations/deployment.md) — rebuild order, setting owners, Railway and Vercel releases, and Supabase callbacks
- [What runs, when, and what it costs](operations/jobs-and-scripts.md) — all 13 GitHub workflows, every command-line tool, and every job-driven AI cost
- [Error monitoring](operations/error-monitoring.md) — which server failures alert through Sentry, the privacy limits, setup, incident checks, and why Alethical buys this instead of building it
- [Repo and service settings](operations/repo-and-service-settings.md) — every setting that controls the project but doesn't live in the repo, and its intended value
- [Keeping every tool supported and useful](operations/technology-health.md) — the free monthly checks, 3-month major-tool review, support dates, and recorded exceptions
- [Private repository cost outlook](operations/private-repository-cost-outlook.md) — the 2026-08-11 cost, security, access, job-limit, and Vercel-seat decision for making Alethical private
- [API CDN setup](operations/api-cdn-setup.md) — Cloudflare in front of the API, plus email authentication records
- [Page-load performance decisions](operations/page-load-performance-decisions.md): measured safe speed work, remaining tradeoffs, and the proof required before release
- [iOS release workflow](operations/ios-release.md) — simulator QA, TestFlight, and ad hoc builds
- [Android prototype handoff](operations/android-prototype-handoff.md) — the Expo/RN Android build path
- [Windows local development notes](operations/local-dev-windows.md)
- [Keeping docs current — decisions](operations/keeping-docs-current-decisions.md) — why the stale-docs check relies on declarations a human writes, and the four automated alternatives we measured and rejected
- [Production database schema drift](operations/production-database-schema-drift.md) — the eleven ways production and the code disagreed, which side was right in each, and the CI check that now catches the next one

## About this folder

- [How `docs/` is organized](folder-structure.md) — the folder layout and where a new doc goes
- **How these are kept current** — see "Keeping docs current" in [`CONTRIBUTING.md`](../CONTRIBUTING.md). Short version: a doc that describes behaviour names the code it describes in a `<!-- describes: -->` comment, and CI then fails any PR that changes that code without one `Docs check:` line saying what the author concluded. Selected guides also opt into a free check that exact quoted labels, colours, and settings still appear in that code. If you write a doc that describes how something behaves, give it that comment. Design working files stay outside `docs/`.
