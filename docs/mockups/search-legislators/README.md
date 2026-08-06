# Handoff: Search Legislators (LIVE)

## Overview

Legislator-directory screen for Alethical: name search over the current
legislative session, with chamber / party / session filters and a browsable 2-column card
grid. Each card links to that legislator's profile. There is **no follow/track action** on
this screen. Signed-out and signed-in states supported (differ only in the nav auth slot).

## About the design file & fidelity

`LIVE Search Legislators.dc.html` is a **design reference authored in HTML** (a Design
Component rendered by `support.js`) — not production code. Recreate it in the Alethical
codebase's environment (React Native / Expo + `theme/tokens.ts` and `theme/primitives.tsx`).
**High-fidelity.** It is a **matched pair with Search Bills** — shared nav, hero, filter, and
results patterns; build them consistently. `<sc-for>`/`<sc-if>`/`{{ }}` = loop/if/binding.

## Screen

- **Background:** identical to Search Bills / home — light gradient + dot texture, no accent
  glow near the nav.
- **Nav (shared):** logo + "ALETHICAL"; "Search" (active) / "Track" / "About"; green "Sign in"
  button (signed out) OR account chip (signed in).
- **Hero:** H1 "Search legislators" (Libre Franklin 800, 58px) + inline "Looking for a bill?
  **Search bills →**". Search bar (`data-glow-field`, purple focus ring): search icon,
  visible and spoken label "Search by name", and a 44×44 **"Clear search"** control only when
  text is present. Enter submits. Filter row: chamber segmented
  (**All · House · Senate**), "All parties" dropdown, **"94th Legislature (2025–2026) Regular
  Session"** dropdown. **No focus-area pill row.**
- **Results header:** the officeholder count from the returned roster (24px/800), followed by
  the newest successful Alethical data-update date in the same 17px muted text. The selected
  chamber's count and chamber buttons come from that same roster response. Below a complete,
  current, unfiltered roster, a quiet linked note says Minnesota has 201 seats and that vacant
  seats are not listed. Any search, filter, past session, partial load, or no-results state hides
  the note.
- **Layout: 2-column card grid** (`grid-template-columns:1fr 1fr; gap:18px`) — a people
  directory is more scannable as a grid.
- **Legislator card** (white, 1px `rgba(17,21,15,0.08)`, radius 18, pad 24/26, shadow
  `0 8px 24px rgba(17,21,15,0.05)`; hover border `rgba(45,212,126,0.55)` + shadow `0 14px 34px
rgba(17,21,15,0.10)`). **Whole card is a link** to the legislator profile (absolute anchor).
  - Top row: **initials avatar** (54px circle, green-tint `#e4f8ee`/`#bfeacf`/`#149d5b`,
    18px/800) + name (20px/800) + **party chip** + chamber · district (`#6b716b`, 14px) +
    **role line**.
  - **Party chip:** NEUTRAL — `#f1f1f4` bg, `#4f5651` text, 11px/700, pill. Shows
    "Democratic-Farmer-Labor" / "Republican". Deliberately non-partisan (no red/blue); do
    not color by party. The identity row may wrap the longer label on narrow cards.
  - **Role line:** the legislator's **chamber-derived title only** — "State Senator" (Senate)
    or "State Representative" (House) — green `#149d5b`, 13px/700, with a green dot. **Do not
    show a committee chairship.**
  - Divider, then **committee chips** (`#f1f1f4`, up to 2) + "+N more" (`#9aa39e`).
  - **Activity line:** "**{n} bills authored or co-authored across available sessions**" (number
    bold `#11150f`). Singular uses "1 bill".
  - **No Follow button.**
- **Pagination** (Previous disabled · Page 1 of 26 · Next) appears only above 12 full matches.
  **No-results:** dashed card and person-search icon. Search only says "No legislators match
  “{query}”" with **Clear search**; filters only says "No legislators match these filters" with
  **Clear filters**; both says "No legislators match “{query}” with these filters" with **Clear
  all**. A session with no roster data is not treated as any of these states.

## Behavioral rules (bake in)

1. **Whole card links to the legislator's profile.** No follow/track on this screen; no
   sign-in modal or toast.
2. **Party is displayed neutrally** (no partisan color).
3. **Default sort = name (A–Z).**
4. **Role = chamber title** ("State Senator" / "State Representative"), never a committee role.
5. **Session label** always full: "94th Legislature (2025–2026) Regular Session".
6. **Person counts come only from the roster response.** The seat total appears only in the
   linked note and is never used as a person count or to calculate a vacancy count.
7. **Text search is name-only.** District and party stay in their separate card and filter
   roles. Clearing text keeps chamber, party, and session selections, then returns to page 1.
8. **Every search or narrowing-filter change returns to page 1.** Only Previous and Next change
   pages. The 3 empty-state actions keep the selected session.

## Design tokens

Same Alethical system as Search Bills (see that bundle for the full palette). Screen-specific:
initials avatar `#e4f8ee`/`#bfeacf`/`#149d5b`; neutral party chip `#f1f1f4`/`#4f5651`; cards
radius 18, shadow `0 8px 24px rgba(17,21,15,0.05)`. Fonts Libre Franklin + JetBrains Mono.
Gutter 56px.

## Assets & files

- Icons are inline SVG; legislator avatars use **initials**, not photos. (No image assets.)
  **No longer what ships (2026-08-05).** The built card shows the member's official portrait
  in a 64×74px rounded rectangle, with initials kept as the fallback. This bundle was authored
  with no image assets and still shows initials, so it is not the reference for that element.
  See `BUILD-NOTES.md` for what shipped.
- `LIVE Search Legislators.dc.html` — the design reference. `support.js` — DC runtime (not
  product). Nav/footer shared. Matched pair with **Search Bills**.
