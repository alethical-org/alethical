# How `docs/` is organized

> **Status: proposed, 2026-07-26 — not yet executed.** No files have moved. This doc
> describes the target layout and what it costs; once the moves land, the "Proposed" note
> goes away and what remains is the durable answer to *"where does a new doc go?"*

**Net:** `docs/` has 19 loose Markdown files at its top level plus five folders, so finding
anything means scanning a wall of filenames. The fix is to group them into six purpose
folders and leave only `README.md` at the root. The grouping is not invented for this
change — it is the five sections `docs/README.md` already uses, with its combined "Product
And Design" split in two (each half has enough in it to stand alone). So the mental model is
already in place and only the filesystem is out of step with it.

**The one real cost:** 38 files in the repo carry references to these docs, including both
`.claude/rules/` files and two design skills. Every move breaks a path. That is mechanical to fix and
verifiable (a script rewrites the paths, a link check proves none dangle), but it is one
large diff, and a stale pointer in an always-loaded rule is worse than a stale doc link — so
the verification below is the part that matters, not the moves.

## Proposed layout

```
docs/
├── README.md                    ← the index; the only file left at the root
├── folder-structure.md          ← this doc
│
├── product/                     What we're building, and what we deliberately aren't
│   ├── product-scope.md
│   ├── grounded-ask-spec.md
│   ├── bill-search-screen-spec.md
│   └── mvp-redesign-plan.md
│
├── architecture/                How the system is built
│   ├── backend-api-system-design.md
│   ├── db-schema-system-design.md
│   ├── ingestion-pipeline-system-design.md
│   ├── rag-ingestion-system-design.md
│   ├── frontend-screen-system-design.md
│   └── legislator-roster-canonical-membership-spec.md
│
├── design/                      How it should look, feel, and read
│   ├── design-principles.md
│   └── ui-copy-guide.md
│
├── operations/                  Running and shipping it
│   ├── deployment.md
│   ├── api-cdn-setup.md
│   ├── ios-release.md
│   ├── android-prototype-handoff.md
│   └── local-dev-windows.md
│
├── onboarding/                  Learning how it works (existing folder, +1 file)
│   ├── ai-models-and-billing.md
│   ├── data-ingestion-onboarding.md
│   └── search-bills-guide.md                 ← moved in
│
├── assets/                      Images and diagrams (existing folder, +3 files)
│   ├── grounded-ask-hero.png
│   ├── data-ingestion-pipeline.png           ← moved in from docs/ root
│   ├── data-ingestion-pipeline.svg           ← moved in from docs/ root
│   └── data-model-relationships.html         ← moved in from docs/ root
│
├── mockups/                     Design bundles (unchanged)
├── research/                    Research findings (unchanged)
└── archive/                     Superseded docs (unchanged)
```

Root goes from **19 loose files + 5 folders** to **2 files + 9 folders**.

## Why these six, and where the judgment calls are

The folders answer a different question each, which is what makes a newcomer able to guess:
*what are we building* (product) · *how is it built* (architecture) · *how should it look*
(design) · *how do I run it* (operations) · *how do I learn it* (onboarding) · *what did we
used to think* (archive).

Four placements are worth stating rather than assuming:

- **`frontend-screen-system-design.md` → architecture, not design.** It is a system design
  for the screen layer, not a visual guide; the visual rules live in `design-principles.md`.
  Its one uniquely-live section (Bill Detail Content Rules) is product-content policy, which
  is an argument for eventually moving *that section* to `product/` — not for filing the
  whole doc under design.
- **`bill-search-screen-spec.md` → product, not design.** A screen spec defines behavior and
  acceptance, which is product; the mockup bundle beside it in `mockups/` is the visual.
- **`legislator-roster-canonical-membership-spec.md` → architecture.** It specifies a
  pipeline module (`roster_pdf.py`) and its reconciliation, so it sits with the ingestion
  designs. If `architecture/` later grows a `data/` subfolder, this moves there first.
- **`search-bills-guide.md` → onboarding.** Written for non-engineers, which
  is what that folder is for; `README.md` already lists it under Onboarding & Education.

**`mockups/` stays at the docs root** rather than nesting under `design/`. It is referenced
by the `design-build` and `design-intake` skills, so moving it adds churn to machine-facing
files for purely cosmetic gain. Worth revisiting only if `design/` grows.

## What this costs

| | Count |
|---|---|
| Files moved | 19 Markdown + 3 assets |
| Repo files carrying references that must be rewritten | 38 |
| Always-loaded / machine-facing files among them | `.claude/rules/workflow.md` (→ `grounded-ask-spec.md`, `product-scope.md`), `.claude/rules/grounded-answers.md` (→ `grounded-ask-spec.md`), and the `design-review` and `design-build` skills (4 and 3 doc paths each) |
| Highest-reference docs (most churn) | `grounded-ask-spec.md` (20), `mvp-redesign-plan.md` (15), `ui-copy-guide.md` (10), `product-scope.md` (10) |

Reference forms in the wild include `docs/<file>.md`, bare `<file>.md`, and relative links
inside `docs/` — which will need `../` prefixes once files sit one level deeper. All three
forms need handling; the relative-link case is the one a naive find-and-replace gets wrong.

**Dated audit records under `.claude/skills/workflow-overhead-audit/audits/` are left
alone**, by the same convention applied during the `v1-scope.md` rename: they name files as
they were called when audited, and rewriting them would falsify the record.

## Alternatives considered

- **Leave it flat.** Defensible at 19 files — flat directories are easy to grep and have no
  path churn. Rejected because the tree is already unscannable by eye (which is what
  prompted this), and it only grows.
- **Partial nesting** — move only the low-reference clusters (`operations/`,
  `architecture/`) and leave the five most-referenced docs at the root. Cheapest option, and
  it avoids touching machine-facing pointers. Rejected because the result is unpredictable:
  a newcomer cannot tell why `deployment.md` is in a folder and `grounded-ask-spec.md` is
  not, and "some things are nested" is harder to learn than either extreme.
- **Nest by audience** (`for-engineers/`, `for-product/`). Rejected — most docs serve both,
  so the split would force arbitrary calls and invite duplication.

## How to execute it safely

The moves are trivial; the reference rewrite is where this goes wrong. Order matters:

1. `git mv` every file so history follows (never delete-and-recreate).
2. Rewrite references by **path**, handling all three forms above, including adding `../`
   to intra-`docs/` relative links that now cross a directory boundary.
3. **Verify every relative link resolves** with a script that walks each Markdown link
   target and stats it — the same check used on the `v1-scope.md` → `product-scope.md`
   rename, which is what caught nothing being broken there.
4. **Grep for surviving bare filenames** (`grounded-ask-spec.md` without a path) — these
   appear in prose and are the form a path-based rewrite misses.
5. Update `docs/README.md`'s index to the new paths, and confirm no root-level `.md` remains
   except `README.md` and this file.
6. Check whether any moved path is referenced from **code** (`ia.ts` carried one such
   reference during the last rename) — a moved doc path in a comment is still a stale
   pointer, and a frontend file in the diff means CI runs the full frontend job.

Do it as **one commit**: a half-moved tree with some references updated is worse than either
end state, and a single mechanical commit is cleanly revertable.

## Adding a doc later

Pick the folder by the question it answers, per the six above. If a doc genuinely answers
two, put it where a newcomer would look first and cross-link from the other. If it answers
none, that is a signal it belongs in an issue or a spec section rather than a new file —
`docs/` accumulates most easily through files nobody quite needed.

Add it to `docs/README.md`'s index in the same change; an unindexed doc is one nobody finds.
When a doc stops describing how things work, move it to `archive/` with a status header
rather than deleting it (see `docs/archive/README.md`).
