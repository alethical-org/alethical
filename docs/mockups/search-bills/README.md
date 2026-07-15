# Handoff: Search Bills (LIVE)

## Overview
Bill-discovery screen for Alethical: keyword / bill-number search over the current
legislative session, with chamber / status / session / omnibus filters, policy pills, a
results list ordered by most-recent legislative activity, and per-bill tracking (auth-gated).
Signed-out and signed-in states supported.

## About the design file & fidelity
`LIVE Search Bills.dc.html` is a **design reference authored in HTML** (a Design Component
rendered by the bundled `support.js`) — not production code. Recreate it in the Alethical
codebase's environment (React Native / Expo + `theme/tokens.ts` and `theme/primitives.tsx`),
matching the values below with existing components/tokens. **High-fidelity** — hex values and
measurements are authoritative. In the prototype, `<sc-for>` / `<sc-if>` = loop / conditional
and `{{ … }}` = data binding.

## Screen
- **Background:** light vertical gradient `linear-gradient(180deg,#f4f5f7,#f7f8fa 55%,#fdfdfe
  90%,#ffffff)` + a dot texture (`rgba(17,21,15,0.07)` dots, 30px grid) masked to fade in by
  110px / out 180px before the end — **no accent glow near the nav** (matches the home page).
- **Nav (shared):** bars logo + "ALETHICAL"; "Search" (active green `#149d5b`) / "Track" /
  "About"; right = green "Sign in" button (signed out) OR account chip with green presence
  dot + "Jordan Reyes" (signed in).
- **Hero:** H1 "Search bills" (Libre Franklin 800, 58px) + inline "Looking for a legislator?
  **Search legislators →**". Search bar (`data-glow-field`, white, radius 14, shadow
  `0 12px 34px rgba(17,21,15,0.07)`): search icon, placeholder "Search by keyword or bill
  number (e.g. HF 2904, SF 1832)", green "Search" button. **Focus:** purple `#5b30d6` ring
  on `:focus-within`. Filter row: chamber segmented (**All · House · Senate**), "All statuses"
  dropdown, **"94th Legislature (2025–2026) Regular Session"** dropdown, "Omnibus only" toggle
  (off white / on green). Policy pills (active green, inactive white; mono counts): All
  policies 312 · Education 214 · Infrastructure 168 · Public Safety 132 · Health 140 ·
  Taxation 96 · Transportation 88 · Capital Investment 74.
- **Results header:** count (24px/800) + "bills"; right = "**Sorted by latest action**" (sort
  icon) + "AS OF MAR 21, 2026" (mono `#9aa39e`).
- **Bill card** (white, 1px `rgba(17,21,15,0.08)`, radius 18, pad 26/30, shadow `0 8px 24px
  rgba(17,21,15,0.05)`; hover border `rgba(45,212,126,0.55)` + shadow `0 14px 34px
  rgba(17,21,15,0.10)`). **Whole card is a link** to the bill detail (absolute anchor z-index
  1); interactive children (Track, author, roll-calls) at z-index 2.
  - Top row: mono **code badge** (green-tint `#e4f8ee`/`#bfeacf`/`#149d5b`) + **status label**
    (tone: green `#149d5b` signed / red `#d64545` vetoed / neutral `#4f5651` else) + **5-step
    progress bar** (30×7 segments: on `#2ed47e`, off `#e2e5e4`, vetoed-final `#e5484d`) +
    **Track button** (black "+ Track" / green "Tracking").
  - **Title** 25/800; **AI SUMMARY** eyebrow (JetBrains Mono 11, purple `#5b30d6`) + summary
    (16, `#4f5651`).
  - **Meta** (top border): "Author: {link} · +{n} co-authors"; "Latest action: {action} ·
    {date}"; policy chips (`#f1f1f4`); optional **roll-calls** pill (green-tint); optional
    **OMNIBUS** badge (amber `#a76a1a`/`#fbf1e2`/`#f0d6a8`). **No companion link.**
- **Pagination** (Previous disabled · Page 1 of 12 · Next). **No-results:** dashed card, active
  filter chips, black "Clear filters".
- **Overlay — intent-preserving sign-in** (Track while signed out): dim backdrop, white 470px
  card, lock icon, "Sign in to track {code}", body copy, "Continue with Google", ×. On
  complete → bill tracked + toast "Now tracking {code}." (dark pill, bottom-left, ~3.6s).

## Behavioral rules (bake in)
1. **Tracking requires an account** — signed-out Track opens the sign-in and returns to the
   same search with the bill tracked + a toast; signed-in Track toggles inline.
2. **Default sort = most-recent legislative activity** (latest action date, descending).
3. **Status → tone + progress:** proposed/committee/house/senate = neutral, green fill to
   stage; signed = green, all 5 green; vetoed = red label, 4 green + final red.
4. **Session label** always full: "94th Legislature (2025–2026) Regular Session".

## Design tokens
Ink `#11150f`; text `#4f5651`/`#6b716b`/`#9aa39e`. Green `#149d5b`/`#2ed47e`/`#28bf71`, on-green
`#06231a`, tint `#e4f8ee`/`#bfeacf`. Purple (AI/focus) `#5b30d6`/`#f0ebfc`. Red `#d64545`/
`#e5484d`. Omnibus amber `#a76a1a`/`#fbf1e2`/`#f0d6a8`. Neutral `#f1f1f4`/`#eef0f1`/`#e2e5e4`.
Dark `#0a0e0c`. Fonts Libre Franklin (400–900) + JetBrains Mono (400/500/700). Cards radius 18,
buttons 11–12, badges 6–8. Gutter 56px.

## Assets & files
- `assets/google-g.png` — Google logo in the sign-in modal (included). Other icons inline SVG.
- `LIVE Search Bills.dc.html` — the design reference. `support.js` — DC runtime (not product).
- Nav/footer are shared components — reuse the app's. Matched pair with **Search Legislators**.
