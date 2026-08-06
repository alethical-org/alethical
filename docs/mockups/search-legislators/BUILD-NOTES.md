# Search Legislators — build notes (repo context)

Companion to `README.md` (the per-page design spec) and `search-legislators.dc.html`
(the literal-values reference — NOT markup to port). Matched pair with `../search-bills/`
— build them consistently (shared nav, hero, filter, results patterns).

## Provenance

LIVE handoff from Claude Design (2026-07-15), incorporating the design-review change
requests recorded in `docs/product-onboarding/mvp-redesign-plan.md` → "Search Bills / Search Legislators —
design-review decisions (2026-07-15)".

## Grounding decisions already baked into this spec

- **No Follow / track action** on this screen — no button, no sign-in modal, no toast.
  Follow-a-legislator is [#151](https://github.com/alethical-org/alethical/issues/151)
  (v2, depends on notifications #36).
- **No focus-area filter pills** — no legislator topic/focus data exists. Keep the
  Chamber + Party filters (both backed).
- **Activity line = "{n} bills authored or co-authored across available sessions"** — the count
  is neither limited to the selected session nor presented as a career total.
- **Role line = chamber-derived title** ("State Senator" / "State Representative"),
  never a committee chairship (committee `role` isn't ingested).
- **Session label = "94th Legislature (2025–2026) Regular Session"** (spelled out).
- **Find by address stays visible as a peer search method** — at the filter row's right edge on web
  and directly below the name field on phones. The nav menu alone does not make it discoverable to
  someone who does not know a legislator's name.

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
- ~~Legislator avatars use **initials**, not photos.~~ **Superseded (2026-08-05).** The
  card now shows the member's official portrait in a 64×74px rounded rectangle. The list
  API already serves one (`current_service.photo_url`) for all 200 sitting members. The
  mockup and `search-legislators.dc.html` still show initials — they predate the change
  and were authored with no image assets, so they are not the reference for this element.
  The portrait is cropped from the center top so the head-and-shoulders framing survives
  at card size. Initials remain the fallback, used when a member has no portrait **or**
  when the stored one fails to load (the files are hosted on lrl.mn.gov, so one can 404
  without our record changing).
