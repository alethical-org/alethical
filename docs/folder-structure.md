# How `docs/` is organized

[README.md](README.md) is the starting point for every retained document. Pick a
folder by the question the document answers. Keep one current home for a decision;
link to it from related guides instead of copying it.

## Where things belong

| Folder | What belongs here |
| --- | --- |
| `product-onboarding/` | What each feature does, how to use it, and its limits |
| `architecture/` | How the system works and why its lasting technical choices were made |
| `design/` | Shared visual rules and approved wording that still governs the product |
| `operations/` | How to run, release, monitor, and recover the service |
| `published-writing/` | The manuscripts of published Guides and Research, kept for word-for-word checks |
| `implementation/` | Unfinished delivery plans, including dependencies and explicit holds |
| `plans/` | Existing delivery plans; complete them in place and use `implementation/` for new plans |
| `research/` | Dated investigations and the evidence behind their conclusions |
| `evidence/` | Source facts supporting product decisions, such as official filing calendars |
| `verification/` | Reproducible checks and supporting screenshots or source comparisons |
| `validation/` | Existing dated measurement records; use `verification/` for new verification records |

The root contains [README.md](README.md), [philosophy.md](philosophy.md), this
[folder guide](folder-structure.md), and
[published-writing-corrections.md](published-writing-corrections.md). The correction
record keeps its short, stable address so readers can cite changes to published work.

## Current guidance and dated evidence

Feature guides and operating instructions describe the current system. A dated
investigation or verification record describes the conditions when it was made.
Give dated evidence its date, scope, sources, and limits; do not present an old
measurement as today's state. Preserve evidence that explains a decision, supports
a published claim, or records an unresolved problem.

Delivery plans describe work still to do. Link each plan to its issue or pull
request, name its dependencies and holds, and keep its next step current. On
completion, put any lasting decisions into the appropriate guide and leave release
evidence with the issue or pull request. Remove the completed plan after updating
its incoming links. Never delete an unfinished plan or a data-replacement hold as
part of routine cleanup.

Published manuscripts remain after publication. The checks in
[`research.test.ts`](../apps/frontend/src/lib/__tests__/research.test.ts) compare
their words with the rendered pieces. Both Guides and Research belong in
`published-writing/`; the publishing rules in
[grounded-answers.md](../.claude/rules/grounded-answers.md) govern changes to them.

## Temporary design files

Design previews, exported HTML, copied assets, and conversation handoffs stay with
the active task, pull request attachments, or temporary storage. Do not commit
design-export packages anywhere in the repository, including its root. A temporary
package is a build aid, not a second description of the product.

Before removing a package, compare it with the current code and guides. Preserve
any still-valid behavior in the feature guide, shared visual rules in
[design-principles.md](design/design-principles.md), and exact implementation values
in code. Replace incoming references with those lasting homes. Superseded drawings
remain available in Git history. Actual verification screenshots and useful HTML
explanations are evidence and documentation, not design exports.

## Adding or moving a document

- Link every retained Markdown document from [README.md](README.md), directly or
  through a linked folder index. A folder link alone does not index all its files.
- Give each notable product feature its own plain-language guide in
  `product-onboarding/`, with the code declaration described in
  [CONTRIBUTING.md](../CONTRIBUTING.md#keeping-docs-current).
- Prefer extending the existing home of a decision to adding another document.
- Update incoming references in the same change as a move or deletion. Preserve
  published words and the checks that protect them when renaming a manuscript.
- Run `python scripts/check_doc_references.py` for broken paths and
  `python scripts/check_doc_structure.py` for missing index entries and committed
  design exports. Both run on every pull request.
