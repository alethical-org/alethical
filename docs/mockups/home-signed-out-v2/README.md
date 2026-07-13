> **Repo context** (added on landing, 2026-07-12). Tracked design reference for the
> **signed-out home** page — the v2 final design. Tracking issue: [#143](https://github.com/alethical-org/alethical/issues/143);
> plan: `docs/mvp-redesign-plan.md`. Implementation is in React Native, merged to
> `main` via PR #67 (design-system foundation + this page); tokens live in
> `apps/frontend/src/theme/tokens.ts` + `theme/primitives.tsx`. This bundle is the
> *values + state + copy* reference, **not code to port** — `support.js` was dropped on
> landing (see "About the Design Files"). **Feature naming:** "Grounded Ask" (badge) /
> "✦ Ask" (nav), never "Ask AI" (`docs/ui-copy-guide.md`). **Held pending Grounded Ask
> ingestion work (decision 2026-07-12):** the hero answer card is a static *marketing
> illustration built from real researched data — not ingestion, not a generated answer*;
> its chip answerability and vote-tally framing are deliberately **not** yet reconciled
> with `.claude/rules/grounded-answers.md`. A drivable live version exists as a Claude
> Design preview (auth-gated to Eugene's claude.ai account) — ask Eugene for the URL and
> open it in a logged-in Chrome for QA spot-checks.

# Handoff: Home (Signed-Out) — Alethical

## Overview
The signed-out marketing/landing home for **Alethical**, a Minnesota legislative-transparency
product. A visitor lands here, asks a grounded question about a bill or legislator (hero "Ask"
box + example answer card), browses what the product can do, finds their own legislators by
address/city, scans bills currently moving through the legislature, and is invited to create a
free account. Fully usable signed-out; an account adds tracking/history.

## About the Design Files
The files in this bundle are **design references authored in HTML** (a prototype showing the
intended look and behavior) — **not production code to copy verbatim**. The task is to
**recreate this design in the live site's existing environment** (its framework, component
library, and design tokens), following established patterns there. `home-signed-out-v2.dc.html`
is a prototype-runtime file; treat its markup/inline-styles as the source of truth for exact
values (colors, sizes, shadows, copy, state logic), but re-express it as real components.
`support.js` is only the prototype runtime — **ignore it for production**.

## Fidelity
**High-fidelity (hifi).** Final colors, typography, spacing, copy, and interactions. Recreate
pixel-accurately using the codebase's existing libraries/tokens. Exact hex/px values are given
below and are also literal in the source file.

## Canvas & Layout
- Root is a fixed **1600px** wide canvas (desktop design), full content height ≈ **4576px**.
  This is a desktop reference; apply the site's own responsive rules — no mobile breakpoints are
  specified in the mock.
- Horizontal padding on all full-width sections: **56px**. Hero body top padding **80px**.
- Section order (top→bottom):
  1. **Nav** (logo left; Search / Track / About dropdowns + Sign in right)
  2. **Hero** — 2-col grid `1fr 1fr`, gap 40px: left = eyebrow + H1 + subhead + Ask field + example chips; right = example answer card
  3. **Capability directory** ("THE RECORD IS YOURS") — 3-col grid, gap 20px *(gated by `showCapabilities`)*
  4. **Find My Legislator** band — 2-col grid `1.15fr 0.85fr`, green-tinted bg *(gated by `showLegislatorFinder`)*
  5. **Bills Moving Through the Legislature** — "Recently Decided" + "Moving Now" groups of bill cards
  6. **Start Knowing** account card *(gated by `showAccountCard`)*
  7. **Footer** — dark

## Screens / Views
This is a single page. Key regions:

### Nav
- Logo: inline-SVG 3-bar mark + wordmark "ALETHICAL" (weight 600, 25px, letter-spacing 0.16em).
- Three dropdown triggers: **Search**, **Track**, **About** (18px, weight 500, color `#4b524b`,
  hover `#11150f`); each has a caret that flips up + turns green when open.
- **Sign in** button: bg `#2ed47e`, text `#06231a`, 13/26px padding, radius 12px, hover bg `#28bf71`.

### Hero — left
- Eyebrow "TRUTH, UNCONCEALED": 15px, weight 500, letter-spacing 0.18em, color `#149d5b`.
- **H1**: 72px / line-height 1.0 / weight 800 / letter-spacing -0.02em / color `#11150f`; second
  line "on Minnesota law" is `#149d5b`, nowrap.
- Subhead: 23px / 1.5 / `#6b716b`. Copy: "We read every bill so you don't have to — what it says,
  where it stands, and how everyone voted. Plain language, every answer linked to official sources."
- **Ask field** (`#ask-hero`): white, 1px border `rgba(17,21,15,0.14)`, radius 14px, search icon +
  input ("Ask about bills or legislators by issue or name…") + green **Ask** button. See focus state.
- **Example chips** (3): pill (radius 999px), 14px, white, border `rgba(17,21,15,0.12)`. Text:
  "What's in the new social media law for kids?", "What bills affect healthcare?",
  "Which legislators support affordable housing?". See hover state + behavior.

### Hero — right (example answer card)
White card, radius 20px, shadow `0 18px 44px rgba(17,21,15,0.08)`, width 600px. Contents:
- "ASKED" eyebrow (mono, purple `#5b30d6`, sparkle icon) + question text.
- "BILL" divider; green bill badge **HF 4138**; Signed/Effective dates; Chief author (Rep. Peggy
  Scott →) + Companion (SF 4696 →); vote line "House 132–2 · Senate 66–0".
- Summary paragraph (bold act name "Stop Harms from Addictive Social Media Act").
- "Cited ✓ Section 325M.40"; three quoted section cards (numbered purple chips, green left-rule,
  italic quotes).
- "View bill text →" + `revisor.mn.gov`.

### Capability directory
Eyebrow "THE RECORD IS YOURS". Three link-cards (icon tile `#e4f8ee` + title + one-liner):
**Search Bills** (`href="#"`), **Track Bills** (`href="#account"`), **Search Legislators**
(`href="LIVE Search Legislators.dc.html"`). See card hover state.

### Find My Legislator band
Green-tint gradient bg + dotted texture. H2 52px/800. Finder field (`#finder-field`, same pattern
as Ask field) with **Find** button + placeholder "Enter an address, city, or area". Row of city
chips (uppercase, 13px/700, radius 12px): MINNEAPOLIS, SAINT PAUL, ROCHESTER, BLOOMINGTON, DULUTH,
BROOKLYN PARK, PLYMOUTH, WOODBURY, MAPLE GROVE, BLAINE, ST. CLOUD, EAGAN, EDINA, MANKATO, MOORHEAD.
Right side: inline-SVG Minnesota outline with a location pin.

### Bills section
Eyebrow "2025–26 LEGISLATIVE SESSION" + H2 44px/800 + "VIEW ALL" button. Two subgroups
("RECENTLY DECIDED", "MOVING NOW") each a vertical stack (gap 18px) of **bill cards**:
- White, border `rgba(17,21,15,0.08)`, radius 16px, padding 26/32px, shadow `0 8px 24px rgba(17,21,15,0.06)`.
- Header row: mono **bill ID** badge (green tint), **status** text, and a **5-step progress bar**
  (each step 30×7px, radius 4px; filled `#149d5b`, empty `#e2e5e4`; vetoed final step `#e5484d`).
- Dark **Track** button (bg `#11150f`, hover `#000`, "+" icon), shadow `0 2px 8px rgba(17,21,15,0.16)`.
- Body: summary; "Chief author:" link; "Latest action:" + date; vote tallies (mono bold); optional
  threshold/next-step note in amber `#9a7b1f`; topic tag chips (`#f1f1f4`); a mono "COMPANION …" link
  (→ `Bill Votes.dc.html`).
- Cards present: SF 1832 (Signed into Law), SF 940 (Vetoed), SF 2210 (Passed both chambers),
  HF 615 (Passed House), SF 1847 (In Committee), HF 1 (Proposed). Exact copy/dates/votes in source.

### Start Knowing (account)
Gradient card, border `#cbeed6`, radius 20px, 2-col. Left: H3 "Start Knowing" + paragraph. Right:
full-width **Continue with Google** button (white, border `rgba(17,21,15,0.16)`, Google "G" image,
hover bg `#f7f8fa`).

### Footer
Dark bg `#0a0e0c`, white text. Tagline "We hold these truths to be self-evident. / Alethical makes
them accessible." (accent `#3de08a`). Privacy Policy + Terms of Use (→ alethical.com). Bottom rule:
"© 2026 ALETHICAL · BUILT IN MINNESOTA" and "TRUTH, UNCONCEALED".

## Interactions & Behavior

### Nav dropdowns — the primary interactive states (see screenshots/)
- A single state variable **`openMenu`** ∈ `null | 'search' | 'track' | 'about'` — **only one panel
  open at a time**.
- Clicking a trigger toggles it (click the open one to close; click another to switch).
- **Active** trigger: label + caret turn green `#149d5b`; caret flips from ▼ to ▲.
- Panel: absolutely positioned, `top: calc(100% + 30px)`, horizontally centered on the trigger,
  with a 15px rotated-square "arrow" notch at top. White, radius 16px, 10px padding.
  **Shadow:** `0 1px 2px rgba(17,21,15,0.10), 0 12px 26px rgba(17,21,15,0.16), 0 40px 80px rgba(17,21,15,0.32)`.
  Widths: **Search 452px, Track 452px, About 320px**.
- Panel rows: 40px rounded icon tile + title (+ optional description); row hover bg `rgba(17,21,15,0.05)`.
  "ON THE ROADMAP" rows are disabled/greyed (`#9aa39e`/`#b3b9b4`, no hover).
  - Search rows: **Bills** (with purple "Grounded Ask" pill), **Search Legislators**, **Find My
    Legislator**; roadmap: Issues, Candidates.
  - Track rows: **Bills**; roadmap: Legislators, Issues, Candidates.
  - About rows: **About Us**, **Trust & Integrity**, **Contact Us**.
- **While any menu is open**, the hero answer card is covered by an overlay:
  `position:absolute; inset:0; background:rgba(255,255,255,0.6); backdrop-filter:blur(5px) saturate(0.9)`
  (transition opacity 0.2s) — a "focus the menu, de-emphasize the card" effect.
- A full-viewport click-away layer (`position:absolute; inset:0; z-index:50`) closes the menu on
  outside click. Nav trigger wrappers sit at `z-index:60`.

### Hover / focus micro-states (transitions `.18s ease`)
- **Example chips (hero) & city chips (finder):** hover → border `#5b30d6`, text `#5b30d6`, and a
  purple glow `box-shadow: 0 0 0 3px rgba(91,48,214,0.14), 0 0 16px rgba(91,48,214,0.4)`.
- **Capability cards** (`a[data-capcard]`): hover → border `#2ed47e` + green glow
  `box-shadow: 0 0 0 3px rgba(46,212,126,0.12), 0 0 14px rgba(46,212,126,0.32)`.
- **Ask & Finder fields** (`:focus-within`): border `#5b30d6` + `box-shadow: 0 0 0 4px rgba(91,48,214,0.14)`.
- **Bill Track buttons:** hover bg `#000`. **VIEW ALL / companion links:** hover border `#2ed47e`.
- **Inline links** (`a[data-tlink]`): hover color `#0f7a45` + underline. Bill badge: hover underline.

### Chip fill behaviors (JS)
- Clicking an **example chip** sets the hero Ask input's value to that question and focuses it.
- Clicking a **city chip** sets the finder input to the Title-Cased city name and focuses it.

### Navigation targets (mockup hrefs — remap to live routes)
- Capability "Search Legislators" → Search-Legislators page.
- Bill "Chief author" links → Legislator Profile; "COMPANION …" → Bill Votes page.
- Answer-card links → external `revisor.mn.gov` / `house.mn.gov` (new tab).
- Footer Privacy/Terms → `alethical.com/privacy`, `/terms` (new tab).
- Sign in / account CTAs → account/`#account`; "Continue with Google" = Google OAuth.

## State Management
- **`openMenu`**: `null | 'search' | 'track' | 'about'` — nav dropdown (single-open); drives active
  styling, panel visibility, the answer-card blur overlay, and the click-away layer.
- **Section flags (build options, default true):** `showCapabilities`, `showLegislatorFinder`,
  `showAccountCard` — show/hide sections 3, 4, 6. In the live site these are likely always-on;
  expose as props/flags only if you need the same modularity.
- Hero Ask input value + Finder input value (refs) — set by chip clicks; otherwise free text.
- No data fetching in the mock; bill/answer content is static sample data. On the live site these
  regions are backed by real bill/legislator/vote data.

## Design Tokens
**Colors**
- Text: primary `#11150f`; secondary `#4f5651` / `#6b716b`; muted `#7c847f` / `#9aa39e`; nav link `#4b524b`.
- Brand green: action `#2ed47e` (hover `#28bf71`), on-green text `#06231a`; accent (icons/text/links) `#149d5b`; link hover `#0f7a45`; footer accent `#3de08a`; green tint bg `#e4f8ee`, border `#bfeacf`.
- Purple (AI / "Grounded Ask" / focus + chip hover): `#5b30d6`; light bg `#f0ebfc`, border `#d8c9f7`.
- Status: vetoed red `#d64545` / `#e5484d`; threshold amber `#9a7b1f`.
- Surfaces/borders: page `#fbfcfd`; card subtle `#f7f9f8`; tag chip `#f1f1f4`; footer `#0a0e0c`;
  hairlines `rgba(17,21,15,0.08–0.20)`.
- Gradients: hero `#f4f5f7→#ffffff`; finder `#eaf6ef→#f2f9f5→#ffffff`; account `#f2f9f5→#ffffff` (border `#cbeed6`).

**Typography** (Google Fonts)
- **Libre Franklin** (300–900) — primary UI/body. **JetBrains Mono** (400/500/700) — eyebrows, bill
  IDs, vote tallies, mono labels. **Sora** (500–700) — the "Grounded Ask" pill. *(Space Grotesk is
  linked but effectively unused — safe to drop.)*
- Scale: H1 72/1.0/800/-0.02em · section H2 44–52/800/-0.02em · H3 28/800 · hero sub 23/1.5 · body
  17–20/1.4–1.5 · row titles 18–19/700 · eyebrow 13–15/700/0.18–0.2em · mono labels 11–12/700/0.06–0.11em.

**Radii:** fields 14 · buttons/menu-rows 12 · cards 16 · big cards/panels/answer 20/16 · badges 7–8 ·
hero chips 999 · finder chips 12 · icon tiles 10–12.

**Shadows:** menu panel `0 1px 2px rgba(17,21,15,0.10), 0 12px 26px rgba(17,21,15,0.16), 0 40px 80px rgba(17,21,15,0.32)` ·
answer card `0 18px 44px rgba(17,21,15,0.08)` · bill card `0 8px 24px rgba(17,21,15,0.06)` ·
Track button `0 2px 8px rgba(17,21,15,0.16)`.
**Glows:** purple (chips/fields hover) `0 0 0 3px rgba(91,48,214,0.14), 0 0 16px rgba(91,48,214,0.4)` ·
field focus ring `0 0 0 4px rgba(91,48,214,0.14)` · card green glow `0 0 0 3px rgba(46,212,126,0.12), 0 0 14px rgba(46,212,126,0.32)`.
**Transitions:** `.18s ease` (borders/color/shadow), overlay `0.2s`.

## Content / Copy conventions
- **Always spell out "legislative session" in full with its years** — e.g. "2025–26 Legislative
  Session" or "89th Legislative Session (2025–26)". Never terse forms like "Session 2025–26" or
  "89th session". (Applies to any copy you add/edit on the live site.)

## Assets
- `assets/google-g.png` — Google "G" logo used in the "Continue with Google" button (rendered 22×22).
  Included in this bundle. Replace with the live site's existing Google mark if it has one.
- **All other icons are inline SVG** (nav caret, search/pin/bill/person/shield/mail glyphs, progress
  ticks, the logo bars, the Minnesota outline). No icon font. Reuse the codebase's icon set where
  equivalents exist; the Minnesota-outline + pin is bespoke inline SVG.
- Fonts load from Google Fonts CDN in the prototype; use the site's font pipeline in production.

## Files
- `home-signed-out-v2.dc.html` — the design source of truth (markup + inline styles + the
  `openMenu` / chip-fill logic near the bottom in a `class Component` block). Read exact values here.
- `support.js` — prototype runtime only; **do not port**. (Needed only to open the HTML locally.)
- `screenshots/` — visual acceptance references (see below). Use as "should look like this," not as
  the implementation source.

## Screenshots (visual QA references)
- `screenshots/full-page.png` — entire page (1600×4576), resting state.
- `screenshots/nav-search-menu.png` — Search dropdown open + answer-card blur.
- `screenshots/nav-track-menu.png` — Track dropdown open + answer-card blur.
- `screenshots/nav-about-menu.png` — About dropdown open + answer-card blur.
