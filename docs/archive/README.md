# Archived docs

Documents that no longer describe how the product works. They are kept because
they record a decision, a measurement, or a design that something later replaced —
history worth having, not guidance worth following.

**Nothing in here is a source of truth.** Every file opens with a status header
saying what superseded it and where the live answer lives now. If you arrive here
from a search result, read that header before acting on anything below it.

Docs live here rather than being deleted because `git` history is a poor archive
in practice — nobody thinks to look in it. But a retired doc left in `docs/`
proper is worse: it keeps turning up in greps alongside live specs and gets acted
on. This directory is the compromise, and the status header is what makes it work.

| Doc | What it was | Superseded by |
|---|---|---|
| [`aesthetics.md`](aesthetics.md) | The **Newsprint** visual identity — sharp corners, serif type, ink/paper/editorial-red palette | `docs/design-principles.md` (green system intent) + `apps/frontend/src/theme/tokens.ts` (implemented values) |
| [`schema-query-validation.md`](schema-query-validation.md) | A point-in-time report that the schema passed its query rubric on 2026-03-21 | `docs/db-schema-system-design.md` (the rubric) + `scripts/validate_query_rubric.py` (whether it passes today) |

Adding to this directory: move the file with `git mv`, add a status header naming
what replaced it, fix its relative links (one directory deeper now), repoint
inbound references, drop it from `docs/README.md`'s index, and add a row above.
