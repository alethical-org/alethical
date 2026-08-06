<!-- LANDED COPY — received Jul 31 2026, kept as the artifact as received. -->

> **Correction received Jul 31 2026 (Eugene), after this bundle was written — web and mobile.**
> The meta line under the question in this bundle reads `2025–2026 LEGISLATIVE SESSION · AS OF
> JUL 30, 2026`, and the foot of the page repeats that date as "Updated Jul 30, 2026". That
> prints one date twice, and dating the *answer* overclaims: an answer can never be fresher
> than the bill record it came from. **Build it as: meta line = the session alone, no date; the
> page's only date is the standard source line at the foot, carrying the answering bill's own
> record date (the same value the bill's page shows), never a generation timestamp.** Same on
> mobile — the header's separate date line beside Share goes, the session text stays.
> Everything else in this bundle stands. Full reasoning and the other build decisions:
> `docs/product-onboarding/grounded-ask-spec.md` §9.5 (The chip-reached answer page — decided
> web design), and the general rule in `docs/design/ui-copy-guide.md` § Dates on a page.

# Handoff: Answer screen (Web) — Alethical

## Before you build (read first)
Please review this bundle and **propose improvements before you implement**. If you see a
better approach, a technical or data constraint, or a risk (routing from the bill page,
how sample questions are generated, how cited sections are resolved to a passage anchor,
sticky-rail behavior), flag it so we refine together — don't execute blindly. Once we're
aligned, build it in the live app's existing framework, component library, and design
tokens.

## Working approach
If this breaks into separable issues, consider prompting other Claude Code sessions to
take them rather than doing everything in this one — you lead and coordinate: sequence the
work, have them report back, and integrate their output. Also weigh, for yourself and for
any session you spin up, whether the job can be done more cheaply without hurting quality
— match each agent to an appropriate model tier (cheaper tiers for mechanical/low-risk
work, stronger where rework risk is real), factoring in the cost of rework. It is an
evaluation, not a mandate; one session is fine if that is genuinely best.

## Overview
The **desktop/web Answer screen** for **Alethical**, a Minnesota legislative-transparency
product. It is the page a reader lands on after tapping a **sample question chip** in the
"Ask about this bill" card on Bill Detail.

Structure: **Nav** → **answer header** (back link + the question as H1 + session/freshness
line + Share, closed by a hairline) → **two columns** (the answer, the bill card, and
"Ask another question" on the left; a sticky **"From the bill"** cited-sections rail on the
right) → source line → footer.

## Scope — read this before anything else
**In scope:** the answer reached from a sample question chip; **signed-out only**; chips as
the only way to ask.

**Out of scope — do not build:**
- **Freeform ask on this page.** No input, no Ask button, no composer. The live answer
  page's full-width query field at the top is removed.
- **Sign-in / accounts.** No gate, no "Continue with Google", no signed-in variant. The nav
  **Sign in** button stays — it is global chrome, not part of this flow.
- Follow-up threads and saved history.

`exports/NEXT-Ask-answer-spec.md` (not in this bundle) describes an auth-gated follow-up
model. That is the **future** state and is explicitly not this build.

## About the design files
`LIVE Answer web.dc.html` is a **design reference authored in HTML** (a working prototype of
the intended look and behavior) — **not production code to copy verbatim**. Treat its markup
and inline styles as the source of truth for exact values (colors, sizes, spacing, shadows,
copy, and the `class Component` logic), but **re-express it as real components** in the
app's environment. `support.js` is the prototype runtime only — **do not port it**; it is
here so the HTML opens locally.

`LIVE-answer-spec.md` is the **design-side source of intent** — the rules behind every
region, the live→design deltas, and what is deferred. Where the spec and the HTML differ,
the spec explains *why*; follow it.

## Sample data is illustrative
The bill (HF 719), the question, the nineteen city names, the four cited sections, the
dates, the author, and the issue chips are **placeholder taken from a real live answer to
show the layout**. Results render from the live source at runtime — **do not reconcile,
verify, or reproduce these values.** Only the DESIGN (layout, states, tokens, behavioral
rules) is authoritative.

## Fidelity
**High-fidelity.** Final colors, type, spacing, copy, and interactions. Exact hex/px values
are literal in the source file and summarized in the spec.

## Canvas & layout
- Canvas **1352px** wide; content max-width **1240px**; section padding **56px** horizontal.
  Build responsive to the app's normal desktop breakpoints; the rail collapses under the
  main column on narrow widths.
- Top gradient wrapper behind Nav + header:
  `#f4f5f7 0% → #f7f8fa 55% → #fdfdfe 90% → #ffffff 100%`, with a masked dotted texture
  (radial dots, 30px grid). The answer body is white.
- Body grid: **`1.4fr / 1fr`, gap 56px, `align-items:start`**; the rail is
  **`position:sticky; top:24px`**.
- The header closes with a **1px `rgba(17,21,15,0.1)` rule** across the content width —
  the same rule Bill Detail's tab row sits on. **Content begins 40px below it.** Do not let
  panel padding and a first-child margin stack into a 70–90px gap (that bug is live on Bill
  Detail today).

## Regions
Full rules in `LIVE-answer-spec.md`. The short version:

- **Header** — "← Back to {CODE}" (the chip is the only entry point, so the way back is
  required); the **question verbatim as H1** (42px/800), no code prefix; meta line
  `2025–2026 LEGISLATIVE SESSION · AS OF {date}`; **Share** at the right, bottom-aligned
  to the rule.
- **The answer** — plain statements in Bill Detail's Key-points treatment (8px round ink
  bullet, 19px/500). **No heading** (the question is the heading) and **no inline citation
  chips**. When the answer is an enumeration of names, render a **3-column alphabetised
  index**, unnumbered, with the count in the lead sentence.
- **"From the bill" rail** — heading + **"Cited Sections"** with the green circle-check.
  Cards are Bill Detail's excerpt cards: `#f7f9f8`, radius 14, no shadow, whole card links
  to the passage, **hover lifts to white** with a purple border and a 3px purple ring. One
  purple mono chip per card (`Art. 1, Sec. N · Title →`), italic quote under a 3px
  light-purple `#bda6ee` rule, **no quotation marks**. The chip sits 8px above the first quote;
  later quotes in the same section are 15px apart.
- **Bill card** — the Search Bills result-card structure: amber code badge, ghosted amber
  OMNIBUS, stage label + 5-step bar, **dashed** Track (roadmap) right-aligned; plain title
  (never the full official title); plain-language summary; meta rows; issue chips + the
  green "{N} votes" chip.
- **"Ask another question"** — a real 22px heading (not a mono eyebrow) over suggested
  question chips. **No field.** Chips hover **purple**, and must wrap and grow (labels are
  generated and run long).
- **Share** — Bill Detail's button and popover exactly, in the header rather than at the
  foot of the page. Copy link lives inside the sheet.

## Overlay layering — REQUIRED
The Share popover must paint **above** the answer body that follows it in the DOM:
- Share wrapper: `position:relative; z-index:60`
- Popover: `position:absolute; z-index:1` within that wrapper
- Backdrop: `position:fixed; inset:0; z-index:0`
- Siblings below must **not** create a competing stacking context — no gratuitous
  `position:relative;z-index`, `transform`, or `opacity` layers on the answer body.
This class of bug has shipped twice (Legislator Profile session filter; Bill Search
"Sorted by" menu) because the layer order was not specced. Spec it, build it, verify it.

## Design tokens
**Colors**
- Text: primary `#11150f`; secondary `#4f5651` / `#6b716b`; muted grey `#6f756f`
  (AA-safe — never `#9aa39e` or `#7c847f` as text on light).
- Green: action `#2ed47e` (hover `#28bf71`), on-green ink `#06231a`; accent/links `#149d5b`
  (hover `#11832b`, `data-tlink` hover `#0f7a45`); circle-check `#149d5b`; stage label
  `#149d5b`; progress bars `#2ed47e` on / `#e2e5e4` off.
- Purple (citations / focus): `#5b30d6`; tints `#f0ebfc` / `#d8c9f7`; focus ring `#7c5cff`;
  chip and card hover ring `rgba(91,48,214,0.14)`.
- Amber — **fill distinguishes meaning:** FILLED (`#fbf1e2` / `#f0d6a8` / `#a76a1a`) = bill
  **CODE** badge; GHOSTED (transparent / `#e3c17f` / `#a76a1a`) = **OMNIBUS** tag.
- Surfaces: page `#fbfcfd`; white cards; quiet card `#f7f9f8`; issue chip `#f1f1f4`; vote
  chip `#e4f8ee`; quote rule `#bda6ee`; hairlines `rgba(17,21,15,0.07–0.16)`.

**Type** (Google Fonts): **Libre Franklin** (UI/body), **JetBrains Mono** (bill codes, meta,
chips, eyebrows). Scale: H1 42 · H2 21–22 · answer 19 · body 14–16 · mono meta 11–13.

**Radii:** buttons/fields 8–12 · cards 14–16 · code badge 7 · pills/chips 999.
**Shadows:** bill card `0 8px 24px rgba(17,21,15,0.05)`; share popover
`0 24px 60px rgba(17,21,15,0.2)`. **Animation:** `cardPop` 0.16s (popover rise).

## Accessibility (shipping defaults — verify before done)
- Global `:focus-visible` ring `2px solid #7c5cff`, offset 2px, `!important`, on every
  interactive element.
- Every control is a real `<button>`/`<a>`; icon-only controls carry `aria-label`; the share
  popover is a labelled `role="dialog"`.
- Dark ink on green fills — never white-on-green. Faint grey text ≥ AA (`#6f756f`).
- No affordance lives only in hover: the cited-section cards are real links, reachable by
  keyboard and touch.

## Copy conventions
- `2025–2026 LEGISLATIVE SESSION` — keep "legislative", keep the years.
- One-line captions take no terminal period. Unit nouns after a number stay lowercase.
- Trailing directional arrows are the **"→" glyph** at weight 400 — never a fixed-size SVG.
- Bill summaries lead with what the bill does; never open with the bill number.

## Live → design deltas (diffed 2026-07-31)
Named so they are fixed up front, not discovered after deploy:
1. Remove the freeform query field + green Ask button at the top.
2. Remove the raw metadata prefix from source quotes (`Bill: HF 719 Article: … Section: …`).
3. Truncate quotes at a **word boundary** with "…" — live cuts mid-word ("and drinki").
4. Bill card uses the **plain title**, not the eleven-line official title.
5. "SOURCES" mono caps + numbered cards → **"From the bill" + "Cited Sections ✓"** with the
   purple chip anatomy.
6. "CONTINUE" mono caps + green arrow links → **"Ask another question"** heading + pill
   chips with purple hover.
7. Bottom "Copy link" → **Share in the header** (copy link moves inside the sheet).
8. Add the **back link** to the originating bill (live has none).
9. Add the **header hairline**; content starts **40px** below it (live has a large soft gap
   and no rule).

## Files
- `LIVE Answer web.dc.html` — the design source of truth (markup + inline styles + the
  `class Component` logic block). Read exact values here.
- `LIVE-answer-spec.md` — authoritative design-side rules and intent, the full live→design
  delta list, and what is deferred to roadmap.
- `support.js` — prototype runtime only; **do not port** (needed only to open the HTML
  locally).

## Related screens
- **Bill Detail (web + mobile)** — the entry point. Its "Ask about this bill" chips route
  here; both files now link to `LIVE Answer web.dc.html`.
- **Search Bills** — the bill card on this screen is that screen's result card, minus the
  summary when the answer already covers it. Keep the two in sync.
- **Mobile answer screen** — not yet designed. When it is, the presumption is that
  everything here applies unless it is genuinely layout-specific.
