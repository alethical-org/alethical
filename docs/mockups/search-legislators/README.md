# Handoff: Search Legislators (LIVE)

## Overview
Legislator-directory screen for Alethical: name / district / party search over the current
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
  placeholder "Search by name, district, or party", a secondary **"Find by address"** link
  (pin icon → Find My Legislator), green "Search" button. Filter row: chamber segmented
  (**All · House · Senate**), "All parties" dropdown, **"94th Legislature (2025–2026) Regular
  Session"** dropdown. **No focus-area pill row.**
- **Results header:** "**201 legislators**" (24px/800) + "**Sorted by name (A–Z)**" (sort
  icon) + "AS OF MAR 21, 2026". (201 = Minnesota's 134 House + 67 Senate seats.)
- **Layout: 2-column card grid** (`grid-template-columns:1fr 1fr; gap:18px`) — a people
  directory is more scannable as a grid.
- **Legislator card** (white, 1px `rgba(17,21,15,0.08)`, radius 18, pad 24/26, shadow
  `0 8px 24px rgba(17,21,15,0.05)`; hover border `rgba(45,212,126,0.55)` + shadow `0 14px 34px
  rgba(17,21,15,0.10)`). **Whole card is a link** to the legislator profile (absolute anchor).
  - Top row: **initials avatar** (54px circle, green-tint `#e4f8ee`/`#bfeacf`/`#149d5b`,
    18px/800) + name (20px/800) + **party chip** + chamber · district (`#6b716b`, 14px) +
    **role line**.
  - **Party chip:** NEUTRAL — `#f1f1f4` bg, `#4f5651` text, 11px/700, pill. Shows "DFL" / "R".
    Deliberately non-partisan (no red/blue); do not color by party.
  - **Role line:** the legislator's **chamber-derived title only** — "State Senator" (Senate)
    or "State Representative" (House) — green `#149d5b`, 13px/700, with a green dot. **Do not
    show a committee chairship.**
  - Divider, then **committee chips** (`#f1f1f4`, up to 2) + "+N more" (`#9aa39e`).
  - **Activity line:** "**{n} bills authored**" (number bold `#11150f`). Nothing else.
  - **No Follow button.**
- **Pagination** (Previous disabled · Page 1 of 26 · Next). **No-results:** dashed card,
  person-search icon, "No legislators match your search", black "Clear filters".

## Behavioral rules (bake in)
1. **Whole card links to the legislator's profile.** No follow/track on this screen; no
   sign-in modal or toast.
2. **Party is displayed neutrally** (no partisan color).
3. **Default sort = name (A–Z).**
4. **Role = chamber title** ("State Senator" / "State Representative"), never a committee role.
5. **Session label** always full: "94th Legislature (2025–2026) Regular Session".

## Design tokens
Same Alethical system as Search Bills (see that bundle for the full palette). Screen-specific:
initials avatar `#e4f8ee`/`#bfeacf`/`#149d5b`; neutral party chip `#f1f1f4`/`#4f5651`; cards
radius 18, shadow `0 8px 24px rgba(17,21,15,0.05)`. Fonts Libre Franklin + JetBrains Mono.
Gutter 56px.

## Assets & files
- Icons are inline SVG; legislator avatars use **initials**, not photos. (No image assets.)
- `LIVE Search Legislators.dc.html` — the design reference. `support.js` — DC runtime (not
  product). Nav/footer shared. Matched pair with **Search Bills**.
