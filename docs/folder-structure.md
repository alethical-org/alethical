# How `docs/` is organized

Every document lives in a folder named for the question it answers, so you can guess where
something is without a map. Only `README.md` (the index) and this file sit at the root.

## Layout

```
docs/
├── README.md              the index
├── folder-structure.md    this doc
│
├── product-onboarding/    What we're building (and won't), plus how to learn how it works
│   ├── product-scope.md
│   ├── grounded-ask-spec.md
│   ├── bill-search-screen-spec.md
│   ├── mvp-redesign-plan.md
│   ├── ai-models-and-billing.md
│   ├── data-ingestion-onboarding.md
│   └── search-bills-guide.md
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
├── operations/            Running and shipping it
│   ├── deployment.md
│   ├── api-cdn-setup.md
│   ├── ios-release.md
│   ├── android-prototype-handoff.md
│   ├── local-dev-windows.md
│   └── repo-and-service-settings.md
│
├── mockups/               Design bundles
└── research/              Research findings
```

## Why the folders are what they are

Each folder answers a question, and that is what lets someone find a doc by guessing:
*what are we building and how do I learn it* (product-onboarding) · *how is it built*
(architecture) · *how should it look* (design) · *how do I run it* (operations). The
remaining two hold non-prose material: `mockups/` and `research/`.

Four placements aren't obvious, so they're stated:

- **`frontend-screen-system-design.md` is architecture, not design** — it is a system design
  for the screen layer; the visual rules live in `design/design-principles.md`. Its one
  product-content section (Bill Detail Content Rules) is a candidate to move to
  `product-onboarding/` on its own.
- **`bill-search-screen-spec.md` is product, not design** — a screen spec defines behavior
  and acceptance; the visual is the mockup bundle in `mockups/`.
- **`legislator-roster-canonical-membership-spec.md` is architecture** — it specifies a
  pipeline module (`roster_pdf.py`) and its reconciliation.
- **`mockups/` stays at the root** rather than under `design/` — the `design-build` and
  `design-intake` skills reference its path, and moving it would churn those for no real gain.

## Adding a doc

Pick the folder by the question the doc answers. If it answers two, put it where a newcomer
would look first and cross-link from the other. If it answers none, that is a sign the
content belongs in an issue or an existing spec section, not a new file — `docs/` fills up
fastest with files nobody quite needed.

Two things keep the folder honest:

- **Add it to `docs/README.md`'s index in the same change** — an unindexed doc is one nobody
  finds.
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
