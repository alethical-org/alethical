# How `docs/` is organized

Every document lives in a folder named for the question it answers, so you can guess where
something is without a map. Only three files sit at the root: `README.md` (the index),
`philosophy.md` (the *why*, which sits above every folder rather than inside one), and
this file.

## Layout

```
docs/
├── README.md              the index
├── philosophy.md          the why beneath the product
├── folder-structure.md    this doc
│
├── product-onboarding/    What we're building (and won't), plus how to learn how it works
│   ├── product-scope.md
│   ├── user-data-retention-policy.md
│   ├── grounded-ask-spec.md
│   ├── bill-search-screen-spec.md
│   ├── home-screen-guide.md
│   ├── bill-detail-guide.md
│   ├── legislator-profile-guide.md
│   ├── bill-text-tab-spec.md
│   ├── mvp-redesign-plan.md
│   ├── tracked-bill-notifications-spec.md
│   ├── ai-models-and-billing.md
│   ├── data-ingestion-onboarding.md
│   ├── search-bills-guide.md
│   └── find-my-legislator-guide.md
│
├── architecture/          How the system is built
│   ├── backend-api-system-design.md
│   ├── db-schema-system-design.md
│   ├── data-model-relationships.html
│   ├── layer-1-source-ingestion-system-design.md
│   ├── layers-1-2-ingestion-pipeline.svg
│   ├── layer-2-rag-ingestion-system-design.md
│   ├── frontend-screen-system-design.md
│   └── legislator-roster-canonical-membership-spec.md
│
├── design/                How it should look, feel, and read
│   ├── design-principles.md
│   └── ui-copy-guide.md
│
├── reader-guides/         What we publish to teach readers how a system works
│   └── who-has-to-report-their-money.md
│
├── operations/            Running and shipping it
│   ├── deployment.md
│   ├── api-cdn-setup.md
│   ├── ios-release.md
│   ├── android-prototype-handoff.md
│   ├── local-dev-windows.md
│   ├── repo-and-service-settings.md
│   └── keeping-docs-current-decisions.md
│
└── research/              Research findings
```

## Why the folders are what they are

Each folder answers a question, and that is what lets someone find a doc by guessing:
*what are we building and how do I learn it* (product-onboarding) · *how is it built*
(architecture) · *how should it look* (design) · *how do I run it* (operations) ·
*what do we publish for readers* (reader-guides). The remaining folder holds research
material. Design working files stay with their task or
pull request instead of becoming permanent documentation.

Six placements aren't obvious, so they're stated:

- **`frontend-screen-system-design.md` is architecture, not design** — it is a system design
  for the screen layer; the visual rules live in `design/design-principles.md`. Its one
  product-content section (Bill Detail Content Rules) is a candidate to move to
  `product-onboarding/` on its own.
- **`bill-search-screen-spec.md` is product, not design** — a screen spec defines behavior
  and acceptance. A design preview is a temporary build aid, not a lasting product record.
- **`legislator-roster-canonical-membership-spec.md` is architecture** — it specifies a
  pipeline module (`roster_pdf.py`) and its reconciliation.
- **There is no `mockups/` folder anymore** — design previews are working files that stay
  with their task, pull request, or temporary storage, never under `docs/`. Its final
  temporary occupant, the sign-in bundle, was reconciled into
  `product-onboarding/sign-in-guide.md` and removed with the rev 17 sign-in build
  ([#1533](https://github.com/alethical-org/alethical/issues/1533)).
- **`reader-guides/` is published prose, not internal documentation and not design** — a
  `product-onboarding/` guide explains our product to whoever builds or supports it; a
  **Guide** in the published sense is a page a
  reader reads, teaching one part of how Minnesota's system works
  (`architecture/published-writing-decisions.md` §2.6, which settled that word on
  27 Aug 2026 and replaced "explainer"). The folder is named `reader-guides/` rather than
  `guides/` so the 2 senses of the word cannot be confused by their folder alone. It is kept
  under `docs/`
  only while the page that renders it does not exist
  ([#1752](https://github.com/alethical-org/alethical/issues/1752)); once a piece is a
  published surface, its words belong in code beside the research registry
  (`apps/frontend/src/lib/research.ts`) and this folder keeps only what has not shipped.
- **`user-data-retention-policy.md` is product, not operations** — it reads like an ops
  concern because it names tables and third-party services, but the question it answers is
  *what does the product keep about the people who read it, and what do we promise them*.
  Its readers are whoever builds account deletion and whoever next edits the public Privacy
  Policy, not someone running the service. The Supabase backup-retention setting it asks for
  is the one genuinely operational piece, and that belongs in
  `operations/repo-and-service-settings.md` instead.

## Adding a doc

Pick the folder by the question the doc answers. If it answers two, put it where a newcomer
would look first and cross-link from the other. If it answers none, that is a sign the
content belongs in an issue or an existing spec section, not a new file — `docs/` fills up
fastest with files nobody quite needed.

4 things keep the folder honest:

- **Add it to `docs/README.md`'s index in the same change** — an unindexed doc is one nobody
  finds.
- **Give each notable feature page or named navigation destination its own plain-English
  guide in `product-onboarding/`** — a system design, build spec, or design preview does not replace
  the reader's guide.
- **Keep design working files out of `docs/`.** Store previews, screenshots, copied assets,
  and handoff notes with the active task or pull request. Move lasting product behavior into
  the feature guide, shared visual rules into `design/design-principles.md`, and exact values
  into code before the change lands.
- **Keep references pointing at real files.** `scripts/check_doc_references.py` runs in CI and
  fails the build if any `docs/...` path or any relative link inside `docs/` points at a
  missing file. So when you move or rename a doc, rewrite the pointers to it in the same
  change — including the `../` depth on relative links, which changes when a file moves
  between folders. Run it locally with `python scripts/check_doc_references.py`.

When a doc stops describing how things work, delete it. `docs/` shows only what is
present and current; retired specs and point-in-time reports are not kept here. The
decision, measurement, or design a deleted doc recorded lives on in `git` history (and,
where it still matters, in whatever superseded it — the live spec, a `.claude/rules/`
invariant, or a GitHub issue). Before deleting, repoint or remove any inbound references
so `scripts/check_doc_references.py` stays green.
