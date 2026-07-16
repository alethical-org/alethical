> **Repo context** (added on landing, 2026-07-15). Tracked design reference for the
> **signed-out home** page on **mobile web** — the v3 mobile mock, phone counterpart to the
> desktop `home-signed-out-v2` bundle. Plan: `docs/mvp-redesign-plan.md`; the signed-out home
> ships in `apps/frontend/src/screens/redesign/HomeSignedOutScreen.tsx` (already responsive —
> mobile was previously *derived*, PRs #163/#203; this bundle reconciles that mobile layout to
> an explicit hifi mock). Tokens live in `apps/frontend/src/theme/tokens.ts` +
> `theme/primitives.tsx`. This bundle is the *values + state + copy* reference, **not code to
> port** — `support.js` was dropped on landing (see "About the Design Files"). **Feature
> naming:** "Grounded Ask" (badge) / "✦ Ask" (nav), never "Ask AI" (`docs/ui-copy-guide.md`).
> **Held static (marketing sample content):** the In-the-News and Bill-Activity cards render
> real bill IDs but their live data-wiring follows the `NEXT-home-spec.md` selection rules —
> match whatever the desktop home already does; do not newly wire or "fix" static sample
> content for `.claude/rules/grounded-answers.md` unless the plan says so.

# Handoff: Home (Mobile, Signed-Out) — Alethical

## Overview
The **mobile** signed-out home for **Alethical**, a Minnesota legislative-transparency product.
A compact, single-column, vertically-scrolling screen. From top to bottom the visitor: reads the
value prop (hero copy), scans editorially-featured bills (**In the News**), sees what's moving in
the legislature (**Legislative Bill Activity**), asks a grounded question (**Ask** — the purple AI
entry point), finds who represents them (**Find My Legislator**), and is invited to create a free
account (**Be in the Know**). Fully usable signed-out; an account adds tracking/history/chat.

This is the phone counterpart to the desktop `design_handoff_home_signed_out` bundle. Same brand,
same content model, re-composed for a narrow single column.

## About the Design Files
The files in this bundle are **design references authored in HTML** (a prototype showing the
intended look and behavior) — **not production code to copy verbatim**. The task is to **recreate
this design in the live app's existing environment** (its framework, component library, and design
tokens), following established patterns there. `LIVE Home mobile v3.dc.html` is a prototype-runtime
file; treat its markup/inline-styles as the source of truth for exact values (colors, sizes,
shadows, copy, refs/logic), but re-express it as real components. `support.js` is only the prototype
runtime — **ignore it for production**.

## Fidelity
**High-fidelity (hifi).** Final colors, typography, spacing, copy, and interactions. Recreate
pixel-accurately using the codebase's existing libraries/tokens. Exact hex/px values are given below
and are also literal in the source file.

## Canvas & Layout
- The design is shown inside a **430px phone shell** (dark bezel, radius 52px, 12px padding); the
  inner screen is **radius 42px, 884px tall, `overflow:hidden`** with an internal vertical scroll.
  **The bezel is presentation chrome — build the screen (the scrolling column), not the device
  frame.** Target a standard mobile viewport (~390–430px wide).
- **Single column**, vertical scroll. **Horizontal padding: 20px** on every section.
- Screen background is a top→bottom gradient:
  `#edf0f4 0% → #f7f9fb 8% → #ffffff 24% → #ffffff 72% → #f5f8fa 100%`.
- Several sections carry a **subtle dotted texture** (radial-gradient dots on a 30px grid), each
  masked to fade in/out so it never hard-edges — a quiet separator, not a solid fill.
- Section order (top→bottom):
  1. **Top bar** (logo + Sign in + hamburger) — sits over the hero
  2. **Hero copy** (no ask bar) + hero dot texture
  3. **In the News** (editorially curated cards)
  4. **Legislative Bill Activity** (data-driven: Recently Passed + Recently Introduced)
  5. **Ask** (purple AI entry point) + dot texture
  6. **Find My Legislator** (green band) + green dot texture
  7. **Be in the Know** (account card)
  8. **Footer** (dark)

## Screens / Views
Single scrolling screen. Regions:

### Top bar
- Logo: inline-SVG **3-bar mark** (26px) + wordmark **"ALETHICAL"** (weight 600, 16px,
  letter-spacing 0.16em, `#11150f`).
- **Sign in** button: bg `#2ed47e`, text `#06231a`, padding 9/16, radius 10, 14px/700.
- **Hamburger**: 38×38 rounded-square (border `rgba(17,21,15,0.14)`, radius 10) with a 3-line SVG.

### Hero copy
- Behind it: dotted texture (`rgba(17,21,15,0.07)`, 30px grid), masked to fade at top and bottom.
- Eyebrow **"TRUTH, UNCONCEALED"**: 12px/500, letter-spacing 0.18em, `#149d5b`.
- **H1**: 36px / line-height 1.05 / weight 800 / letter-spacing −0.025em / `#11150f`. Two lines:
  "Grounded answers" then **"on Minnesota law"** in `#149d5b`, `white-space:nowrap`.
- Subhead: 14px / 1.5 / `#6b716b`. Copy: "We read every bill so you don't have to — what it says,
  where it stands, and how everyone voted. Plain language, every answer linked to official sources."

### In the News (editorially curated)
- Eyebrow **"IN THE NEWS"**: 12px/700, letter-spacing 0.2em, `#149d5b`.
- **2 cards**, vertical stack gap 14. Card: white, border `rgba(17,21,15,0.1)`, radius 16,
  padding 18, shadow `0 6px 18px rgba(17,21,15,0.05)`. Whole card links → **Bill detail** (mock:
  `Bill Votes.dc.html`).
  - Top row (space-between): mono **bill badge** (bg `#e4f8ee`, border `#bfeacf`, `#149d5b`, radius
    6, 12px/700) + **"🔥 Hot issue"** pill (bg `#fbf1e2`, border `#f0d6a8`, `#a76a1a`, radius 999,
    11px/800, letter-spacing 0.06em).
  - Title: 18px/800/−0.01em, line-height 1.3.
  - Summary: 14px/1.55, `#6b716b`.
  - Meta line (top hairline `rgba(17,21,15,0.08)`, 13px): **"Signed into Law"** (`#4f5651`) +
    **"Effective {date}"** (`#9aa39e`, margin-left 10).
  - Cards: **SF 3933** — "Stop Harms from Addictive Feeds Act", Effective July 1, 2027;
    **SF 856** — "Office of the Inspector General", Effective Aug 1, 2026.
- **"See more"** button (full-width, white, border `rgba(17,21,15,0.2)`, radius 13, 14px/700, arrow
  icon; hover → border `#2ed47e`, text `#149d5b`) → **Search Bills**.

### Legislative Bill Activity (data-driven)
- Eyebrow **"2025–2026 SESSION"** (12px/700/0.2em, `#149d5b`) + **H2 "Legislative Bill Activity"**
  (26px/800/−0.02em, `#11150f`).
- Sub-label **"RECENTLY PASSED"** (12px/700, letter-spacing 0.12em, `#6b716b`), then **1 bill card**.
- Sub-label **"RECENTLY INTRODUCED"**, then **1 bill card**.
- **Bill card**: white, border `rgba(17,21,15,0.08)`, radius 16, padding 18, shadow
  `0 6px 18px rgba(17,21,15,0.05)`. Whole card links → Bill detail. Anatomy:
  - Header row: mono **bill badge** (green tint, as above) + **status** text (13px/700, `#4f5651`).
  - **5-step progress bar**: five 26×6 pills, radius 4; filled `#2ed47e`, empty `#e2e5e4`.
  - Title: 17px/800/−0.01em, line-height 1.25.
  - Meta line (top hairline, 13px): either **"Latest action: {action}"** (action bold `#11150f`) +
    **"· {date}"** (`#9aa39e`), or **"Updated {date}"** (date grey) — see freshness rule below.
  - Cards (placeholders): **SF 1832** "Paid Family and Medical Leave Amendments" — Signed into Law,
    5/5 filled, "Latest action: Signed by the Governor · Feb 28, 2026". **HF 88** "Prohibiting
    Foreign Ownership of Agricultural Land" — Introduced, 1/5 filled, "Updated Mar 20, 2026".
- **"See more"** → Search Bills.

### Ask (purple AI entry point)
- Behind it: dotted texture (`rgba(17,21,15,0.09)`), masked.
- Eyebrow **"HAVE A QUESTION?"** (12px/700/0.2em, `#149d5b`) + subcopy "Plain language answers
  linked to official sources." (14px/1.5, `#6b716b`).
- **Ask field** (`[data-glow-field]`): white, border `rgba(17,21,15,0.14)`, radius 13, padding
  14/16; search icon + **auto-growing `<textarea>`** (16px, placeholder "Ask about bills or
  legislators by issue or name"). Focus-within → border `#5b30d6` + ring
  `0 0 0 4px rgba(91,48,214,0.14)`.
- **Ask button**: full-width, bg `#5b30d6`, white, radius 13, padding 15, 16px/700; hover `#4a26b0`.

### Find My Legislator (green band)
- Bg gradient `#eaf6ef → #f2f9f5 → #ffffff` + **green** dotted texture (`rgba(20,157,91,0.09)`),
  masked.
- **H2 "Find My Legislator"** 30px/800/−0.02em. Subcopy 14px/1.5, `#4f5651`: "Find who represents
  you — their profile, committees, and the bills they've authored."
- **Finder field** (`#finder-field`, `[data-glow-field]`): white, border `rgba(17,21,15,0.14)`,
  radius 14; pin icon + input (placeholder "Enter an address, city, or area") + green **Find**
  button (bg `#2ed47e`, `#06231a`, radius 12, hover `#28bf71`).
- **City chips** (uppercase, 12px/700, letter-spacing 0.08em, white, border `rgba(17,21,15,0.16)`,
  radius 12): MINNEAPOLIS, SAINT PAUL, ROCHESTER, DULUTH, ST. CLOUD, MANKATO. Hover → border/text
  `#5b30d6` + purple glow. **Tap fills the finder field** (see behavior).

### Be in the Know (account)
- Card: gradient `#f2f9f5 → #ffffff`, border `#cbeed6`, radius 20, padding 28/24.
- **H3 "Be in the Know"** 24px/800/−0.01em. Paragraph 15px/1.55, `#4f5651`: "Search bills and
  legislators, find who represents you, and get cited answers — no account needed. An account makes
  it yours: track bills, keep chat history, and pick up where you left off."
- **Continue with Google** button: full-width white, border `rgba(17,21,15,0.16)`, radius 13,
  padding 16/22, 16px/600, Google "G" image (20×20), shadow `0 1px 3px rgba(17,21,15,0.06)`; hover
  bg `#f7f8fa`. → Google OAuth.

### Footer
- Dark bg `#0a0e0c`, white text. Tagline: "We hold these truths to be self-evident. / Alethical
  makes them accessible." (accent line `#3de08a`). **Privacy Policy** + **Terms of Use** →
  `alethical.com/privacy`, `/terms` (new tab). Bottom rule (`rgba(255,255,255,0.12)`):
  "© 2026 ALETHICAL" + "TRUTH, UNCONCEALED" (`#3de08a`).

## Interactions & Behavior
- **Ask textarea auto-grows** with input: height resets to `auto` then to `scrollHeight` capped at
  **150px**, switching to internal scroll past the cap. (Prototype logic in `askRef`/`onAskInput`.)
- **City chips** (`fillFinderFromChip`): clicking a chip sets the finder input's value to the
  **Title-Cased** city name (e.g. "SAINT PAUL" → "Saint Paul") and focuses it.
- **Focus states:** every `[data-glow-field]` shows a purple border + ring on `:focus-within`; all
  interactive elements get a **`:focus-visible` outline** `2px solid #5b30d6` (offset 2px) for
  keyboard nav. Text **`::selection`** is purple-tinted.
- **Hover micro-states** (`.18s ease`): chips → purple border/text + glow
  `0 0 0 3px rgba(91,48,214,0.14), 0 0 16px rgba(91,48,214,0.4)`; "See more" → green border/text;
  green/purple buttons darken.
- **Navigation targets** (mock hrefs — remap to live routes): In-the-News & Bill-Activity cards →
  Bill detail; both "See more" → **default unfiltered Search Bills**; Sign in / Continue with
  Google → auth; footer Privacy/Terms → alethical.com (new tab).

## Data logic (design-side source of intent)
The bills shown are **illustrative placeholders** — the real ones are chosen by these rules (also in
`NEXT-home-spec.md`, which applies to both web and mobile home):

- **In the News = editorially curated.** A hand-picked, **pinned list of bill IDs** set by an editor
  (NOT recency-derived), rendered in the given order. Current selection: **SF 3933**, **SF 856**.
  Each card's status/meta still reflects that bill's real data; only inclusion & order are editorial.
- **Bill Activity = data-driven (most recent), not curated.**
  - **Recently Passed:** bills that reached passage this session — status *Passed both chambers* or
    *Signed into Law*. Ordered by the passage-milestone date, **descending** (signing date for
    signed/enacted; else the date both chambers passed). **Mobile shows the top 1** (web shows 2).
  - **Recently Introduced:** bills this session ordered by **introduction date, descending**.
    **Mobile shows the top 1** (web shows 3).
- **Card meta line — freshness vs. latest action:** if the most recent action would merely restate
  the status label (e.g. status "Passed both chambers" + action "Passed both chambers"), show
  **"Updated {date}"** (grey). Otherwise show **"Latest action: {action} · {date}"** (action
  bold/dark, date grey). This is why SF 1832 (Signed) shows *Latest action: Signed by the Governor ·
  {date}* while an introduced/passed-only bill shows *Updated {date}*.
- **"See more"** (both groups) → the **default Search Bills** page (no pre-applied query/filter/scroll).

## State Management
- **Refs only** in the prototype: `askRef` (textarea auto-grow), `finderRef` (city-chip fill). No
  `openMenu`/dropdown state (unlike the desktop home — mobile has no nav dropdowns).
- **No data fetching** in the mock; bill content is static sample data. On the live app, In-the-News
  is backed by the editorial pin list and Bill Activity by real bill/action data per the rules above.

## Design Tokens
**Colors**
- Text: primary `#11150f`; secondary `#4f5651` / `#6b716b`; muted `#7c847f` / `#9aa39e`.
- Brand green: action `#2ed47e` (hover `#28bf71` / `#11832b`), on-green text `#06231a`; accent
  (eyebrows/links/icons) `#149d5b`; link hover `#11832b`; footer accent `#3de08a`; green tint bg
  `#e4f8ee`, border `#bfeacf`; band gradient `#eaf6ef→#f2f9f5→#ffffff`.
- Purple (AI / Ask / focus + chip hover): `#5b30d6` (Ask button hover `#4a26b0`); focus ring
  `rgba(91,48,214,0.14)`; selection `rgba(91,48,214,0.20)`.
- Amber (Hot issue pill): bg `#fbf1e2`, border `#f0d6a8`, text `#a76a1a`.
- Progress bar: filled `#2ed47e`, empty `#e2e5e4`.
- Surfaces/borders: page gradient `#edf0f4→#ffffff→#f5f8fa`; card white; hairlines
  `rgba(17,21,15,0.08–0.20)`; footer `#0a0e0c`; account card gradient `#f2f9f5→#ffffff` (border
  `#cbeed6`).

**Typography** (Google Fonts)
- **Libre Franklin** (300–900) — primary UI/body. **JetBrains Mono** (400/500/700) — bill IDs.
- Scale: H1 36/1.05/800/−0.025em · H2 26–30/800/−0.02em · H3 24/800 · card title 17–18/800 ·
  body/subhead 14–15/1.5–1.55 · eyebrow 12/500–700/0.12–0.2em · bill badge 12/700 mono.

**Radii:** fields/buttons 13–14 · cards 16 · account card 20 · phone screen 42 · bezel 52 · bill
badge 6 · chips 12 · Hot-issue pill 999 · icon tiles 10.

**Shadows:** card `0 6px 18px rgba(17,21,15,0.05)` · account button `0 1px 3px rgba(17,21,15,0.06)`
· phone bezel `0 40px 90px rgba(17,21,15,0.30)`.
**Glows:** chip/field hover `0 0 0 3px rgba(91,48,214,0.14), 0 0 16px rgba(91,48,214,0.4)` · field
focus ring `0 0 0 4px rgba(91,48,214,0.14)`.
**Textures:** radial-gradient dots on a 30px grid, masked with a `linear-gradient` fade so edges are
soft (see the three textured sections for exact mask stops).
**Transitions:** `.18s ease` (border/color/shadow).

## Accessibility
- **Focus-visible** ring (`2px solid #5b30d6`, offset 2px) is defined globally for keyboard nav —
  preserve it on every interactive element in the live build.
- Dark ink on green fills (`#06231a` on `#2ed47e`) — never white-on-green — for WCAG-AA contrast.
- Touch targets ≈44px (Sign in, See more, Ask, Find, Continue with Google, chips). Keep the finder
  Find button and Ask button at their padded sizes.
- City chips carry a non-hover cue via `:focus-visible` (tap/keyboard parity) — don't make the only
  affordance hover-only.
- Icon-only controls (hamburger, search/pin glyphs) need text alternatives (`aria-label`) in
  production; the Google "G" image has `alt="Google"`.
- Real heading structure (H1 → H2 → H3) and body text ≥14px.

## Copy conventions
- **Spell out "legislative session" in full with its years** — e.g. "2025–2026 Legislative
  Session" / "94th Legislature (2025–2026) Regular Session". Never terse forms like "Session
  2025–26" or "94th session". (Minnesota's 2025–2026 biennium is the **94th** Legislature.)

## Assets
- `assets/google-g.png` — Google "G" logo in the "Continue with Google" button (rendered 20×20).
  Included. Replace with the live app's existing Google mark if it has one.
- **All other icons are inline SVG** (logo bars, hamburger, search, pin, arrows). No icon font.
- Fonts load from Google Fonts CDN in the prototype; use the app's font pipeline in production.

## Files
- `LIVE Home mobile v3.dc.html` — the design source of truth (markup + inline styles + the
  `askRef`/`finderRef` logic in the `class Component` block at the bottom). Read exact values here.
- `NEXT-home-spec.md` — the data-selection rules for In the News / Bill Activity (applies to web and
  mobile home). Authoritative for how real bills are chosen.
- `support.js` — prototype runtime only; **do not port** (needed only to open the HTML locally).
