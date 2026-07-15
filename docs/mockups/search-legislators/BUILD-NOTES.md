# Search Legislators — build notes (repo context)

Companion to `README.md` (the per-page design spec) and `search-legislators.dc.html`
(the literal-values reference — NOT markup to port). Matched pair with `../search-bills/`
— build them consistently (shared nav, hero, filter, results patterns).

## Provenance
LIVE handoff from Claude Design (2026-07-15), incorporating the design-review change
requests recorded in `docs/mvp-redesign-plan.md` → "Search Bills / Search Legislators —
design-review decisions (2026-07-15)".

## Grounding decisions already baked into this spec
- **No Follow / track action** on this screen — no button, no sign-in modal, no toast.
  Follow-a-legislator is [#151](https://github.com/alethical-org/alethical/issues/151)
  (v2, depends on notifications #36).
- **No focus-area filter pills** — no legislator topic/focus data exists. Keep the
  Chamber + Party filters (both backed).
- **Activity line = "{n} bills authored" only** — "signed into law this session" isn't
  computed and was dropped.
- **Role line = chamber-derived title** ("State Senator" / "State Representative"),
  never a committee chairship (committee `role` isn't ingested).
- **Session label = "94th Legislature (2025–2026) Regular Session"** (spelled out).

## Held / interim behavior at build time
- **Authored count** was 0 for everyone (attribution bug); fixed by
  [#291](https://github.com/alethical-org/alethical/issues/291) / PR #299 — the activity
  line depends on that landing to show real numbers.
- **Committee-name chips + "DFL" party label** need the list API additions in
  [#296](https://github.com/alethical-org/alethical/issues/296) (sequenced after #291).
  Until #296, show what the list serves today (committee count; party via existing
  mapping) and swap to named chips + "DFL" when #296 lands.

## Invariants
- Party displayed **neutrally** (no partisan color) — grounded-answers rule 3;
  MN terminology (author/co-author, DFL).
- Tokens + primitives: `apps/frontend/src/theme/tokens.ts` + `theme/primitives.tsx`.
- Shared nav/footer = reuse the app's components (`TopNav`).
- Legislator avatars use **initials**, not photos.
