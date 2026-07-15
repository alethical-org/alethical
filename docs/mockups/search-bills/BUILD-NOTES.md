# Search Bills — build notes (repo context)

Companion to `README.md` (the per-page design spec) and `search-bills.dc.html` (the
literal-values reference — NOT markup to port; RN can't render HTML/CSS). Matched pair
with `../search-legislators/`.

## Provenance
LIVE handoff from Claude Design (2026-07-15), incorporating the design-review change
requests recorded in `docs/mvp-redesign-plan.md` → "Search Bills / Search Legislators —
design-review decisions (2026-07-15)".

## Grounding decisions already baked into this spec
- **Session label = "94th Legislature (2025–2026) Regular Session"** (from the DB; the
  earlier draft's "89th" was wrong). Always spelled out in full.
- **Sort = "Sorted by latest action"** — the only order the API serves today. Progress
  sort is a fast-follow ([#292](https://github.com/alethical-org/alethical/issues/292) /
  PR #297).
- **No companion link** on cards — not exposed by the API yet
  ([#293](https://github.com/alethical-org/alethical/issues/293)).

## Held / interim behavior at build time
- **5-step progress bar + "+N co-authors"** are not on the list API yet
  ([#295](https://github.com/alethical-org/alethical/issues/295)). Until #295 lands, the
  card renders the real `status_key` label + the existing default progress; co-author
  count is derivable (`sponsor_count − chief_count`) — use it if available, else omit.
- **Roll-calls pill** links to the bill's votes tab (`/bills/:id?tab=votes`), not a
  standalone roll-call page (deferred, #38).

## Deviations from the mockup
- **OMNIBUS indicator moved to the top row.** The mockup places the amber OMNIBUS badge
  last in the meta row; the build shows a single prominent OMNIBUS pill in the card's top
  row, immediately after the bill pill and before the status word (one indicator only, no
  meta-row duplicate). Requires `is_omnibus` on the `/bills` list item. See
  `docs/bill-search-screen-spec.md` (Bill result card → Primary → Omnibus pill).

## Invariants
- User-facing copy verbatim from the spec; "issue" not "topic".
- Tokens + primitives: `apps/frontend/src/theme/tokens.ts` + `theme/primitives.tsx`
  (green design system, already on `main`). Add missing tokens from this spec's hex/px.
- Grounded-answers rules (`.claude/rules/grounded-answers.md`): AI summary is genuine
  (`AIEnrichment`); records vs. generated stay distinct; linked states URL-addressable.
- Shared nav/footer = reuse the app's components (`TopNav`), don't reimplement.
