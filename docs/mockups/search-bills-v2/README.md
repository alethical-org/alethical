# Handoff: Search Bills (LIVE)

<!-- REPO CONTEXT (added on intake, not part of the original handoff) -->
<!--
This is the **v2** iteration of the Search Bills screen. The v1 handoff lives in
`docs/mockups/search-bills/` and is already SHIPPED at `/bills`
(`apps/frontend/src/screens/redesign/SearchBillsScreen.tsx` +
`components/search/`). Most of this v2 spec — the whole bill card, search field,
filters, issue pills, count, pagination, empty state — was built in v1 and is
live; do not rebuild it. The genuine v2 deltas are: the FILTERS chip row, issue
**multi-select** (OR), the interactive sort control, the plain-English filter
description, the helper line, and the "ISSUES" eyebrow.

Pre-build findings (2026-07-23), confirmed against production:
- **Issue multi-select** needs a backend change (the endpoint took a single
  `policy_area`); done additively — `policy_area` is now repeatable and the
  alias sets union (OR across issues). Live-verified: Health 1,571 + Education
  1,508 → union 2,883.
- **"Passed both chambers" (8th status) is NOT shipped.** Status is classified
  from `Bill.current_status` text, which mis-attributes chamber (production:
  `passed_senate` is structurally 0, `passed_house` is a catch-all). "Passed
  both" is only reliably detectable via action-history chamber signals, which
  needs a status-classifier overhaul (high blast radius) — filed and staffed as
  its own backend issue. This screen ships the **7** statuses the data backs.
- Tokens live in `apps/frontend/src/theme/tokens.ts`; primitives in
  `theme/primitives.tsx`. Amber = code/omnibus identity only (never status).
- The Track button is a roadmap placeholder (inert dashed on web, omitted on
  mobile) — do NOT build the auth-gated tracking flow or the dead sign-in modal.
-->

## Before you build
Read this whole spec first and **tell us if anything should change** — a better approach, a
data/infra constraint, or a risk — BEFORE implementing. We'll refine together. The included
mockup is authoritative for anything the words don't cover (layout, spacing, exact color).

## Working approach
This is a **multi-issue** handoff (search · filters · issue browser · chip row · results header/sort ·
bill card · pagination). You — the primary session we're handing this to — decide how to run it, but:
- **Delegate when it makes sense.** If these split into separable issues, consider prompting/spinning
  up OTHER sessions to take them in parallel rather than doing everything yourself. Evaluate that
  prompting/prioritization explicitly before starting.
- **Lead & coordinate.** You own the whole: coordinate those sessions, sequence and resolve anything
  you depend on from them, have them report back, and integrate their output.
- **Optimize cost without sacrificing quality.** For yourself AND any session you spin up, weigh
  whether the job can be done more cheaply at an appropriate MODEL TIER (cheaper for mechanical /
  low-risk work, stronger where rework risk is real) — factoring in the cost of rework.
Not a mandate — do it all in one session if that's genuinely best.

## Getting the files
This bundle reaches you as a ZIP the user downloads — named after the **project** with a number
the browser appends (e.g. `Alethical UX (7).zip`), NOT the folder name. Grab the **most recently
downloaded** `Alethical UX (N).zip` in Downloads, unzip it, and open the folder
`design_handoff_search_bills/` inside. The mockup is `LIVE Bill Search v2.dc.html`.

## Design file & fidelity
`LIVE Bill Search v2.dc.html` is a **design reference authored in HTML** (a Design Component
rendered by the bundled `support.js`) — not production code. Recreate it in the Alethical
codebase (React Native / Expo + `theme/tokens.ts` + primitives), matching the values below with
existing components/tokens. **High-fidelity** — hexes and measurements are authoritative. In the
file, `<sc-for>`/`<sc-if>` = loop/conditional and `{{ … }}` = data binding. Nav/footer are shared
components — reuse the app's. **All bill DATA in the mockup — titles, summaries, dates, authors,
counts, the ~10,000 result count — is ILLUSTRATIVE placeholder.** Render results from the live data
source; do NOT reconcile, verify, or reproduce the sample values. Only the design (layout, states,
tokens, behavioral rules) is authoritative.

## Overview
Bill-discovery screen: keyword / bill-number search across the current legislative session, with
chamber / status / session / omnibus filters and a 26-issue taxonomy; a persistent, individually
removable filter-chip row; a live-updating result count with a plain-English description of the
exact filter intersection; sortable results; and bill cards. Web + mobile.

---

## A) Search
- **Field:** placeholder `Search by keyword or bill number`. Helper line below:
  "Results update as you type. Bills match **every** word — try a keyword or a bill number."
  ("every" bold `#4f5651`; helper `#6f756f`, 14px.)
- **Behavior:** results update **as you type** (no submit needed; Enter also works). The query
  splits on whitespace and **EVERY word must match** (AND, order-independent) — no phrase match.
- **Bill-number lookup:** a query shaped like a bill number (e.g. `HF 2904`) is an exclusive
  lookup for that one bill.
- The field is for **typed words / bill numbers only** — meaning & full questions are Ask's job.
- **Focus (calm):** `:focus-within` → border `#5b30d6` + ring `0 0 0 4px rgba(91,48,214,0.14)`
  (`data-glow-field`). No bloom, no text-color change.

## B) Filters (fixed order; each an AND facet)
1. **Chamber** — segmented **All · House · Senate**. Default All reads neutral; a non-default
   selection fills **black**.
2. **Status** — dropdown: All statuses (default) · Signed into Law · Passed both chambers ·
   Passed Senate · Passed House · In Committee · Introduced · Vetoed.
3. **Session** — dropdown, default **"2025–2026 Legislative Session"** (always written WITH
   "Legislative" + the years). **NON-CLEARABLE:** "Clear all" resets every other facet but keeps
   the session.
4. **Omnibus only** — toggle (off white / on black).
- Non-default (actively narrowing) controls read **black**; defaults read neutral/light.

## C) Issues — browse by issue
- Row label **"ISSUES"** (JetBrains Mono eyebrow, parallel to the FILTERS label).
- Full **26-issue** taxonomy; each pill = label + mono bill-count. **Collapsed to the first 12**
  + a dashed green **"+14 more"**; expanded shows all + **"Show fewer"**.
- Counts: Government Finance 2,292 · Health 1,571 · Education 1,508 · Infrastructure 1,358 ·
  Public Safety 1,289 · State Government 1,244 · Taxation 1,166 · Environment & Natural Resources
  1,079 · Transportation 1,060 · Capital Investment 1,003 · Human Services 895 · Economic
  Development 849 · Consumer Protection 792 · Local Government 740 · Labor & Employment 700 ·
  Justice & Courts 641 · Housing 449 · Agriculture 429 · Arts & Culture 405 · Energy & Utilities
  295 · Elections 292 · Veterans & Military 185 · Cannabis 80 · Civil Rights 73 · Immigration 53 ·
  Tribal Affairs 39.
- Multi-select is **OR within the issue facet** (a bill in ANY selected issue), AND-intersected
  with the other facets. Selected pill = black fill; unselected = white. **No "All issues" pill** —
  the resting state IS all issues, and removing the last issue chip returns to all.

## D) Filter-chip row ("FILTERS")
- Persistent row of removable chips, one per active **non-default** selection, fixed order:
  keyword(s) · chamber · status · session (only if non-default) · omnibus · issues.
- Each chip is a soft **FILLED** tint, color-coded by facet:
  - keyword = slate `#eef0f2` / `#d5dade` / `#3f4650`
  - chamber = blue `#e9f0fb` / `#cadcf3` / `#345880`
  - status = teal `#e7f3f1` / `#c3e3dd` / `#2c6f66`
  - session = indigo `#eeecfb` / `#d7d0f4` / `#4b3fa8`
  - **omnibus = FILLED soft amber `#fbf1e2` / `#f0d6a8` / `#a76a1a`** (filled here — no code badge
    in this row to disambiguate from; see the amber rule)
  - issue = cyan `#e6f2f6` / `#c2e0ea` / `#2b6377`
- Each chip has an **×** to remove just that facet. **"Clear all"** (black) resets everything
  EXCEPT the session.

## E) Results header
- Big **count** (24px/800) + "bills". The count simulates a live ~10,000-bill catalog: it narrows
  as facets are added and widens on a multi-issue union.
- **Plain-English description** of the exact intersection, e.g. *"Matching "healthcare", tagged
  either Health, Infrastructure, or State Government, in the House, signed into law, in the
  2025–2026 Legislative Session."* — **AND across facets, OR ("either") within issues**; per-status
  natural phrasing (signed into law / passed by the House / in committee / vetoed …). The
  **session ALWAYS closes the sentence** (it always scopes results). No filters →
  "In the 2025–2026 Legislative Session."
- Right side: **"AS OF MAR 21, 2026"** (JetBrains Mono, AA-safe grey `#6f756f`) + the **sort
  control**.
- **Sort:** "Sorted by legislative progress" (default) — Signed → Vetoed → Passed Senate →
  Passed House → In Committee → Introduced; plus **Latest action**. When a keyword query is
  present, best-match relevance leads.

## F) Bill card
- **Row 1 (web):** amber **FILLED code badge** (`#fbf1e2`/`#f0d6a8`/`#a76a1a`) + **ghosted-amber
  OMNIBUS tag** (transparent / `#e3c17f` / `#a76a1a`, scale icon) + **status label** + **5-step
  progress bar**.
  - **MOBILE:** a **stable two-row header on EVERY card** — row 1 = code badge (+ omnibus tag);
    row 2 = status label + progress bar. Never let the bar's position depend on whether omnibus
    is present.
- **Status tone:** green `#149d5b` (Signed into Law) / red `#d64545` (Vetoed) / neutral `#4f5651`
  (else). **Progress:** 30×7 segments — on `#2ed47e`, off `#e2e5e4`, vetoed-final `#e5484d`.
- **Title** 25/800 `#11150f`. **Summary** 16 / `#4f5651` — plain-language, one sentence, **no
  bill-number prefix, no raw statute citation** (lead with what the bill does).
- **Meta** (top hairline), tiered muted labels (`#6f756f`):
  - **"Chief author:"** (muted) → honorific **"Senator"/"Representative"** `#4f5651` (spelled out,
    OUTSIDE the link) → green **name link** `#149d5b` (hover `#0f7a45`) + " →" (U+2192, weight
    400, aria-hidden). **THIS file's chief only** (per-file authorship — no companion author, no
    co-author count on the card; validate Senate ≤ 5 authors / House ≤ 35 on ingest).
  - **"Latest action:"** (muted) → action value `#11150f`/600 → date `#6f756f`, ~8px gap, **NO
    dot**. Build the line as a **flex-wrap row with `column-gap:8px`** so a long-action date wraps
    **flush-left** on mobile (never indented). The action = the most recent **already-occurred,
    meaningful** timeline entry, phrased to **complement** the status (Signed → "Signed by the
    Governor"; Vetoed → "Vetoed by the Governor"; In Committee → "Referred to {committee}"; Passed
    → "Passed the {chamber}"; Introduced → "Introduced") — skip future-scheduled and minor
    procedural rows (e.g. "Co-author added"); humanize dates to "Mon D, YYYY" (never raw ISO). The
    "· Chapter {n}" citation stays on the bill-detail Actions tab, NOT the card.
  - **Signed laws add an "Effective: {date}" line** below latest action ("various dates" for
    omnibus). Non-signed / vetoed bills show no Effective line.
  - **Issue tags** (`#f1f1f4` pills). Optional **votes pill** (green-tint `#e4f8ee`/`#bfeacf`/
    `#149d5b`) linking to the bill's Votes tab.
- **Track button = ROADMAP.** Bill tracking is not live. On **web** show a dashed, de-emphasized
  placeholder (white, 1px dashed `rgba(17,21,15,0.3)`, `#4f5651`, "+ Track") that is **inert**
  (clicking does nothing — no sign-in modal, no toggle). On **mobile, omit the Track button
  entirely** until tracking ships. Never a "coming soon" / "SOON" label. (The design file still
  contains a dead sign-in modal — do NOT build the auth-gated tracking flow.)
- **Whole card links** to the bill detail; interactive children (author link, votes pill) sit
  above the card link (z-index).

## G) Pagination & empty state
- **Pagination:** Previous / Page N of M / Next.
- **No results:** dashed card + the active filter chips + a "Clear all" affordance.

---

## Reusable conventions (bake in — these apply on every screen, not just here)
- **Overlay layering:** any dropdown/menu (Status, Session, Sort) must paint **above** the cards
  that follow it — trigger wrapper `position:relative; z-index:40`, menu `position:absolute;
  z-index:1`; don't give the results list a competing stacking context; portal to body if it must
  escape an `overflow` clip.
- **Trailing arrows = the "→" glyph (U+2192)** in the control's own font at its size, weight 400
  (aria-hidden when the label is bolder) — never a fixed-size SVG stub.
- **Faint grey text meets WCAG AA:** never `#9aa39e` (or any sub-4.5:1 grey) as text on light — use
  `#6f756f`.
- **Chip / filter hover glow:** border `#5b30d6` + text `#5b30d6` + a single tight ring
  `0 0 0 3px rgba(91,48,214,0.14)` — **no outer bloom**. **Selected chips do NOT glow.** Field
  focus is the calmer 4px ring (distinct radius).
- **A11y focus ring — REQUIRED** on every focusable control (`:focus-visible`): `2px solid
  #7c5cff; outline-offset:2px`. Glow-fields excluded (they have their own focus cue). Every control
  is a real `<button>`/`<a>`; icon-only controls get an `aria-label`.
- **Spelled-out honorifics** ("Senator"/"Representative") on prominent rails; "Sen."/"Rep." only in
  dense repeating lists (roll-call chips).
- **Session copy:** "2025–2026 Legislative Session" — keep "Legislative" and the years.
- **Amber = bill-code + omnibus identity** (never green/status). FILLED amber = the code badge;
  GHOSTED amber = the omnibus tag **on cards** (where a filled code badge shares the row); in the
  FILTERS chip row omnibus is **FILLED** (no code badge there to disambiguate from).

## Design tokens
Ink `#11150f`; text `#4f5651` / `#6b716b`; AA-safe muted `#6f756f`. Green `#149d5b` / `#2ed47e` /
`#28bf71`, on-green `#06231a`, tint `#e4f8ee` / `#bfeacf`. Purple (focus/citation) `#5b30d6`, focus
ring `#7c5cff`, tint `#f0ebfc`. Red `#d64545` / `#e5484d`. Amber `#a76a1a` / `#fbf1e2` / `#f0d6a8`
(ghost border `#e3c17f`). Chip tints per §D. Neutral `#f1f1f4` / `#e2e5e4`. Fonts: Libre Franklin
(400–900) UI/display, JetBrains Mono (400/500/700) eyebrows/badges/counts, Space Grotesk wordmark
only. Cards radius 16–18, buttons 11–12, badges 6–8.

## Assets & files
- `LIVE Bill Search v2.dc.html` — the design reference (mockup). `support.js` — DC runtime (not
  product).
- Matched pair with **Search Legislators**; reuse the shared nav/footer.
