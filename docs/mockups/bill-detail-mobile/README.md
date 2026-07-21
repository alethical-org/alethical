<!-- REPO CONTEXT (added at intake, not part of the original handoff) -->
<!--
- Design source of truth: `bill-detail-mobile.dc.html` (literal hex/px/copy + state logic) — NOT markup to port; re-express as RN components. `support.js` intentionally dropped (prototype runtime).
- Tokens/primitives live in `apps/frontend/src/theme/tokens.ts` + `theme/primitives.tsx`; reuse them, add any missing token from the values below.
- DATA CONSTRAINT: member-level roll-call votes + per-member party are NOT in production yet (issue #83, still open/deferred; the votes name-match coverage spike is the gate). The mock hardcodes party rosters and fabricates per-member votes. The build must therefore treat the expanded per-member roll grid as an interim: render the tally/result/proportion bar + official-record link (data we DO have), and only render the expanded member grid + crossover dots + party splits where real per-member data exists — otherwise degrade gracefully (see grounded-answers rule 4: never fabricate record data in-app).
- Companion-bill relationship (#293), current_status_code (#305), and several date columns (#343) are in-flight backend gaps — wire defensively.
- v1 milestone priority #1 is the Bill detail page.
-->

# Handoff: Bill Detail (Mobile) — Alethical

## Before you build (read first)
Please review this prompt and the design files and **propose improvements before you
implement**. If you see a better approach, a technical/data constraint, or a risk (routing,
real roll-call data shape, party roster source, scroll-spy behavior, etc.), flag it so we
refine together — don't execute blindly. Once we're aligned, build it in the live app's
existing framework, component library, and design tokens.

## Overview
The **mobile** Bill Detail screen for **Alethical**, a Minnesota legislative-transparency
product. It's the phone counterpart to `NEXT Bill Profile web` — **one continuously scrolling
page** (no tabs), designed so a non-political reader can understand a bill fast: plain-language
key points first, official record deeper down.

Top → bottom: **Top bar** → **Bill header** (title + status + Share) → **sticky jump chips**
(Summary · Actions · Votes · Versions, with scroll-spy) → **Summary** (key points + citations +
facts card + Ask) → **Actions** (timeline + plain-language key) → **Votes** (roll-call
accordion + "your legislators") → **Versions**. Two bottom sheets (Sign in, Share) and an
in-canvas preview-state band round it out.

## About the design files
`LIVE Bill Profile mobile.dc.html` is a **design reference authored in HTML** (a working
prototype of the intended look + behavior) — **not production code to copy verbatim**. Treat its
markup and inline styles as the source of truth for exact values (colors, sizes, spacing,
shadows, copy, and the `class Component` logic), but **re-express it as real components** in the
app's environment. `support.js` is the prototype runtime only — **do not port it**.

`NEXT-bill-detail-spec.md` is the **design-side source of intent** — the decisions and explicit
rules behind every section (dot taxonomy, crossover logic, share behavior, mobile refinement
passes, copy conventions). Where the spec and the HTML differ, the spec explains *why*; follow
it for production data logic.

## Fidelity
**High-fidelity.** Final colors, type, spacing, copy, and interactions. Recreate accurately with
the codebase's libraries/tokens; exact hex/px values are literal in the source file and
summarized below.

## Canvas & layout
- Shown inside a **430px phone shell** (dark bezel, radius 52, 12px padding); inner screen is
  **radius 42, 884px tall, `overflow:hidden`** with an internal vertical scroll on the
  `scrollRef` container. **The bezel is presentation chrome — build the scrolling screen, not the
  device frame.** Target a standard mobile viewport (~390–430px wide).
- **Single column**, vertical scroll. **Horizontal padding: 20px** on every section.
- Screen background: top→bottom gradient
  `#edf0f4 0% → #f7f9fb 8% → #ffffff 24% → #ffffff 72% → #f5f8fa 100%`.
- The bill header carries a subtle masked **dotted texture** (radial dots, 30px grid).
- **Section order (confirmed): Summary → Actions → Votes → Versions.** Votes is 3rd (roll call
  "toward the bottom") so the page doesn't end on a long expandable roll; Versions (short,
  archival) closes it.

## Regions

### Top bar
- Canonical **two-peaks mark** (20px, ink `#11150f`) + wordmark **"ALETHICAL"** (weight 600,
  21px, letter-spacing 0.16em). Right: **Sign in** (green `#2ed47e`/`#06231a`, radius 10) when
  signed out, OR an account chip (green presence dot + "Jordan") when signed in; then a 38×38
  **menu** button (`aria-label="Menu"`, 3-line glyph).

### Bill header
- **H1 bill title** (32px/1.1/800/−0.02em). Title is the hero — no status word in the title row.
- Status row: a **stage pill** — green dot + label (Signed into Law) / neutral grey dot (In
  Committee) / red dot (Vetoed) — an optional **OMNIBUS** tag (ghosted amber, see tokens), and a
  right-aligned **Share** button (opens the share sheet). Below: **session line**
  `{CHAMBER} · 2025–2026 LEGISLATIVE SESSION` (grey `#6f756f`). Keep "LEGISLATIVE" before
  "session" — educational for non-political readers (see Copy conventions).

### Jump chips (sticky, scroll-spy)
- Sticky bar (`position:sticky; top:0`, blurred white, bottom hairline), horizontally
  scrollable: **Summary · Actions · Votes · Versions**. Active chip = solid ink fill
  (`#11150f`, white text, `aria-current`); inactive = white + border, purple glow on
  hover/press.
- **Scroll-spy:** an IntersectionObserver (root = the phone scroll container,
  `rootMargin: -88px 0px -55% 0px`) highlights the chip for the section nearest the top; clicking
  a chip also sets it active optimistically. Anchors + `scroll-margin-top:64px` drive the jump.

### Summary
- **H2 "Key points"** + a one-line **lede** (`b.lede`, per-bill "what this bill does").
- **Key-point bullets**: round **ink `#11150f`** bullets; text at **19px/500** (the shared
  "primary content" size — leads by order + treatment, not an oversized font).
- **"CITED SECTIONS" strip** below the bullets: a mono grey label with the **green circle-check
  (✓, `#149d5b`)** — keep the check on any cited-sections label — then non-interactive purple
  chips, one per point, showing `§section name` (e.g. "§ 342.10 Licenses"; the "·" is dropped to
  fit more per row). Purple family `#5b30d6` / `#f0ebfc` / `#d8c9f7`.
- **Facts card** (white, radius 16, ambient shadow): **status date** (EFFECTIVE for signed /
  LATEST ACTION otherwise — no progress bar on mobile), **THIS BILL** (chamber label
  "SENATE BILL"/"HOUSE BILL" + filled-amber **code badge** + "Bill overview →" +
  state-aware "Read the full law →" / "Read the bill text →" + Companion), **CHIEF AUTHOR**
  (labeled Party / District; "+N co-authors" top-right), **ISSUES** (grey chips).
- **Ask about this bill** (optional; `showAskModule`): white card, white field (`data-glow-field`,
  full-width) with a **full-width purple Ask button BELOW** (mobile field-stacking rule), plus
  suggested-question chips. Routes to Ask, pre-scoped to the bill.

### Actions
- **H2 "Actions"** + one-line intro. **Dot legend** row, then a vertical **timeline** (newest
  first). **Dot taxonomy (implement by what the action does, not by example):** green = legal
  state-change (Signed, effective); black = recorded roll-call vote (has tally); hollow =
  procedural (introduced, referral, committee report, *Presented to the Governor*); red = failed
  vote / not-adopted amendment. Amendment outcome rides a separate **ADOPTED / NOT ADOPTED**
  pill. **Future-dated actions render as SCHEDULED** (dashed green-ring dot, SCHEDULED badge,
  muted title; `upcoming = actionDate > today`). Vote rows carry a tally chip + "View votes →"
  that deep-opens that roll in Votes.
- **Plain-language key** (tap a term → inline definition; separated by whitespace, not a
  hairline). In production, **generate the key dynamically** from the terms actually present in
  each bill's rows against a maintained MN-legislature dictionary (all-or-nothing: lint any
  rendered term missing a definition). It's superseded by inline tap tooltips once those ship —
  never maintain both.

### Votes
- **H2 "Votes"** + one-line intro + a collapsible **"How to read a roll call"** (holds the
  roll-call definition + the authoring-party narrative) and an always-visible
  **"• crossed party lines"** legend.
- **Roll cards = accessible accordion.** Header is a real `<button aria-expanded>`; the expanded
  panel (segmented **All · Yes · No · Didn't vote** filter with live counts, search-by-name, and
  **party-grouped** member chips) is a **sibling** of the button, not nested. **One roll open at a
  time on mobile.** Collapsed bar uses the full-chamber denominator (Yes green / No red / neutral
  remainder for non-voters); absent count stated inline. Member chips: green ✓ Yes / red ✕ No /
  grey – didn't vote; **crossover** (against the member's own party majority) carries a small
  amber dot; each chip links to the legislator profile.
- **"Your legislators voted…"** sits **below** the roll cards: signed-in with a saved district →
  their Yes/No on final passage; signed out → blurred teaser + "Continue with Google" (the
  conversion hook). Toggle with `showYourLegislators`.
- **No-votes empty state** (in-committee bills) → an **Ask** CTA (no tracking).

### Versions
- **H2 "Versions"** + intro, then rows (Session Law / engrossments / As introduced), each
  linking to the official source. Session Law row carries a ghosted-amber **CHAPTER** chip. Ends
  with the single page-level **source line** (mono grey).

## Interactions & behavior
- **Scroll-spy** jump chips (see above). Anchor jump + `scroll-margin-top:64px`.
- **Roll accordion:** independent state per roll (`openRolls` holds a single key on mobile;
  `rollFilters`, `rollSearches` per roll). Filter tabs show live counts; "Didn't vote" appears
  only when absent > 0. Search narrows both party blocks while preserving grouping.
- **Sign-in bottom sheet** (`ovFade` + `sheetUp`): ONE intent — `votes` ("see how your
  legislators voted"); "Continue with Google" returns signed-in with the district revealed.
- **Share bottom sheet:** copy-link is primary (→ green "Link copied", auto-reverts ~1.9s) +
  social row **LinkedIn · X · Facebook · Instagram · Email** (monochrome ink glyphs on `#f1f1f4`
  circles, real share-intent URLs). Shares the canonical bill URL
  `https://alethical.com/bills/{slug}` (the bill, not the current view). Instagram has no real
  link-share intent — in production copy the link + open the IG app.
- **Glossary** terms: tap-to-reveal (not hover) — hover is a desktop enhancement only.
- **Focus + press states:** every interactive element is a real `<button>`/`<a>` with the global
  `:focus-visible` ring; fields glow purple on `:focus-within`; interactive chips glow purple on
  hover AND tap-hold; **selected chips do NOT glow** (selection = solid ink fill or purple tint).

## Preview states (NOT props — an in-canvas band)
The dark **preview-state band** pinned below the phone toggles demo states via component
`state`, not Tweaks: **bill status** (Signed into law / In committee / Vetoed) and **auth**
(Signed out / Signed in). Reproduce these as internal demo state; they are not production
controls. The two genuine build flags ARE props: `showAskModule`, `showYourLegislators`.

## Data logic (design-side source of intent)
See `NEXT-bill-detail-spec.md` for the authoritative rules. Key ones:
- **Status → date label:** signed → **EFFECTIVE {date}**; not-yet-law (committee/vetoed) →
  **LATEST ACTION {…}**.
- **Dot taxonomy** and **SCHEDULED** future actions — explicit rules above / in spec.
- **Crossover = voting against your OWN party's majority on THAT vote** — derive per vote from
  real party + member data; the crossover dots and each block's Yes–No split MUST come from the
  same per-member data (single source of truth). **Validation guard:** each block's Yes+No+absent
  must equal its seat count, and Yes(DFL)+Yes(R) must equal the recorded Yea — flag impossible
  combinations rather than render silently.
- **Party roster:** the mock hardcodes party from a 2025–2026 Republican surname set per chamber
  (everyone else DFL) so seat counts are realistic; **production must wire real member party** from
  the roster/API.
- **State-aware official links:** "Bill overview →" (status page), "Read the full law →"
  (enacted / `isLaw`), "Read the bill text →" (in-progress). One component should own this
  wording.
- **Vetoed bills:** passage roll calls keep PASSED badges; the veto is carried by the status
  pill, LATEST ACTION, and a red terminal event in Actions — never relabel a passed roll.

## Design tokens
**Colors**
- Text: primary `#11150f`; secondary `#4f5651` / `#6b716b`; muted grey `#6f756f` (AA-safe — do
  NOT use `#9aa39e`/`#7c847f` as text on light).
- Green: action `#2ed47e` (hover `#28bf71`), on-green ink `#06231a`; accent/links `#149d5b`
  (hover `#11832b`, active `#0f7a45`); circle-check `#149d5b`.
- Purple (citations / focus / chip press): `#5b30d6`; tints `#f0ebfc` / `#d8c9f7`; focus ring
  `#7c5cff`; glow `rgba(91,48,214,0.16)` hover / `0.22` press / `0.14` field.
- Amber — **fill distinguishes meaning:** FILLED (bg `#fbe7bd`/`#fbf1e2`, border `#eccf86`/
  `#f0d6a8`, text `#875312`/`#a76a1a`) = bill **CODE** badge; GHOSTED (transparent, border
  `#e3c17f`, text `#a76a1a`) = **OMNIBUS** tag, **CHAPTER** law chip, and the amber crossover dot.
- Vote semantics: Yes/PASSED green `#149d5b` on `#e4f8ee`/`#e9faf1` (border `#bfeacf`); No/FAILED
  red `#c23c36` on `#fdecec` (border `#f5c6c4`); didn't-vote grey.
- Surfaces: card white; hairlines `rgba(17,21,15,0.08–0.16)`; preview band / account CTA on
  `#0a0e0c`.

**Type** (Google Fonts): **Libre Franklin** (UI/body), **JetBrains Mono** (bill codes, meta,
eyebrows). Scale: H1 32 · H2 26 · H3 22–24 · **primary content 19** (key points, action titles,
roll motions) · intros/lede 16 · mono meta 13.

**Radii:** fields/buttons 12–13 · cards 14–16 · facts card 16 · phone screen 42 · bezel 52 · code
badge 7 · pills/chips 999 · icon tiles 10–13.
**Shadows:** card `0 6px 18px rgba(17,21,15,0.04–0.05)`; facts/Ask card `0 8px 24px
rgba(17,21,15,0.05)`; sheet `0 -20px 60px rgba(10,14,12,0.4)`; bezel `0 40px 90px
rgba(17,21,15,0.30)`.
**Animations:** `ovFade` 0.16s (sheet backdrop), `sheetUp` 0.24s (sheet rise).

## Accessibility (shipping defaults — verify before done)
- Global **`:focus-visible` ring** `2px solid #7c5cff` (offset 2px), with `data-glow-field`
  inputs excluded (the field's own focus glow is its cue). Keep it on every interactive element.
- Every control is a real `<button>`/`<a>` (focusable, Enter/Space) — never a bare div/span with
  onClick. Roll header is a `<button aria-expanded>`; its panel is a sibling (interactive
  controls can't nest in a button). Icon-only controls (menu, close ×, share) have `aria-label`;
  the Google mark has `alt`.
- Dark ink on green fills — never white-on-green. Faint grey text ≥ AA (`#6f756f`).
- Touch targets ~44px+ (Sign in, Share, Ask, chips, social 52px). Non-hover cue on every chip
  (tap/selected/press) — no affordance lives only in hover.

## Copy conventions
- **Keep "legislative" before "session"** with its years: "2025–2026 LEGISLATIVE SESSION" — it
  teaches non-political readers what a session is. Where the Legislature itself is named, use
  "94th Legislature (2025–2026)" (MN's 2025–2026 biennium is the **94th**).
- Vote labels are **Yes / No** everywhere (never Yea/Nay). Status is **"Introduced"**, never
  "Proposed". Verb for document links is **"Read"** (never "View").

## Files
- `LIVE Bill Profile mobile.dc.html` — the design source of truth (markup + inline styles + the
  `class Component` logic block). Read exact values here.
- `NEXT-bill-detail-spec.md` — authoritative design-side rules/intent (data logic, dot taxonomy,
  crossover, share, mobile refinement passes). Read for *why* + production behavior.
- `support.js` — prototype runtime only; **do not port** (needed only to open the HTML locally).
- `assets/google-g.png` — Google "G" mark in the "Continue with Google" buttons (20×20). Replace
  with the app's existing mark if it has one. All other icons are inline SVG.

## Web counterpart
Keep in sync with **Bill Detail (web)** where behavior is shared (share sheet, data logic, link
naming, dot taxonomy). Divergences are intentional and noted in the spec: mobile is one scroll
(no tabs); mobile drops the rail progress bar and the verbatim "From the bill" excerpt cards
(citations shown as the CITED SECTIONS chip strip instead); web still shows excerpt cards —
revisit for parity per the spec.
