# Alethical design principles — the green system

<!-- describes: apps/frontend/src/components/VoteCountLinkChip.tsx, apps/frontend/src/components/GoBackLink.tsx, apps/frontend/src/components/LinkArrow.tsx, apps/frontend/src/components/ChangeBlock.tsx, apps/frontend/src/components/auth/LoadingButton.tsx, apps/frontend/src/components/auth/SignInDialog.tsx, apps/frontend/src/components/billDetail/BillTrackButton.tsx, apps/frontend/src/components/billDetail/SourceLine.tsx, apps/frontend/src/components/billDetail/billTrackButtonAppearance.ts, apps/frontend/src/components/search/BillResultCard.tsx, apps/frontend/src/hooks/useHistoryScrollRestoration.ts, apps/frontend/src/hooks/useResponsive.ts, apps/frontend/src/navigation/links.ts, apps/frontend/src/navigation/webHistory.ts, apps/frontend/src/screens/redesign/HomeSignedOutScreen.tsx, apps/frontend/src/theme/tokens.ts, apps/frontend/src/theme/primitives.tsx, apps/frontend/src/theme/pageBackground.ts -->

> **What this is.** The written design intent behind Alethical's green visual system: what
> the product should feel like, and the visual/interaction rules that get it there. It is the
> single source of truth for the green system, which replaced the earlier Newsprint identity.
>
> **2 jobs.** (1) A **brief to hand to the design tool** at the start of any preview so its output
> starts on-brand instead of drifting to a generic default. (2) A **reference for building and
> reviewing** screens in the RN/Expo codebase.
>
> **Scope — visual & interaction only.** Voice and copy are owned by `docs/design/ui-copy-guide.md`;
> what a screen may *claim* is owned by `.claude/rules/grounded-answers.md` (a line must be true
> before it can be on-brand). Exact token values are owned by `apps/frontend/src/theme/tokens.ts`
> — this doc describes *character and intent*, never a parallel value sheet (it would drift; per
> `docs/product-onboarding/mvp-redesign-plan.md`, generate a value sheet from the file if one is ever needed).
>
> **Sources of truth:** `apps/frontend/src/theme/tokens.ts` + `theme/primitives.tsx` (implemented
> system) · this guide (shared visual and interaction rules) · the feature guides under
> `docs/product-onboarding/` (screen behavior and copy). MVP is **responsive web** (desktop + mobile
> web); native is deferred ([#91](https://github.com/alethical-org/alethical/issues/91)).
>
> **Build-truth pin for the rules added 14 Aug 2026:** code and the rendered production site were
> checked at commit [`67db903a`](https://github.com/alethical-org/alethical/commit/67db903a9300340c8b8a35cc53a8db55b4435a05).

## 1. What Alethical should feel like

Alethical shows people the public record of their own government. The design has one job: make
that record feel **trustworthy, legible, and unmistakably neutral**. Every visual choice serves
credibility first.

- **Records-first, not app-flashy.** This reads like a trustworthy public institution presenting
  facts, not a consumer app selling excitement. When a choice trades credibility for flash,
  credibility wins.
- **Calm chrome, confident content.** The interface is quiet so the information is loud. The
  product's voice can be bold in *words* (`ui-copy-guide.md`), but the *surfaces* those words sit
  on stay calm — bold headline, restrained page. The chrome never competes with the content.
- **Clarity over density, but honest about volume.** Legislative data is dense; we make it
  scannable through hierarchy and whitespace, never by hiding how much there is.
- **Neutral by construction.** Layout, color, and emphasis describe records; they never editorialize.
  We don't use visual weight to imply a position (see `grounded-answers.md` rule 3, grounded
  neutrality). Green is the brand, not a partisan signal.
- **Accessible because it's public.** This serves everyone, so accessibility is a baseline
  requirement, not a finishing polish (see §3).

## 2. The green visual system

Character summary. **Exact values live in `tokens.ts`** — read it for hex, scale, and spacing.

- **Color intent.** A light, warm-neutral page with a soft green radial wash on wider screens and a
  plain warm-neutral background on phone widths; green is the single brand accent, used with intent
  (brand fills, CTAs, links, focus), not sprinkled. Text is a
  near-black **green-tinted ink**, not pure black, so the page reads warm and calm. A purple accent
  is reserved specifically for the "Grounded Ask" / AI affordance and focus — it is a *meaning*, not
  decoration. A red ramp is reserved for genuine danger/veto status. Green fills carry **dark ink
  text, never white** (a deliberate contrast choice — see §3).
- **Green roles on light surfaces.** UI-sized green text, including links such as
  `revisor.mn.gov →`, uses `text.greenOnLight` (`#0f7a45`). SVG strokes/fills use
  `brand.graphics` (`#149d5b`), and large bold display text may use
  `brand.display` (`#149d5b`). The values intentionally differ: small letterforms lose apparent
  color at their anti-aliased edges, so the darker token makes them read like the brighter display
  and graphic green. Green text on dark surfaces and green button fills are separate roles.
- **Track is one black-to-mint toggle, not a separate Untrack treatment.** Its known off state is
  the `#11150f` active-control fill with white type and a plus; pressing the same button changes it
  to the mint “Tracked” state with a check. Pressing that state again removes the bill. There is no
  separate “Untrack” button or danger treatment. Black is **not** reserved to Track: the built
  filter system uses the same active-control fill, while Track's black treatment still keeps this
  action distinct from green primary buttons. The size ladder is deliberate: bill page desktop is
  16px type / 12px radius, bill page phone is 15px / 10px, and compact cards are 14px / 10px.
  The 3 variants differ in type, spacing, and weight without dropping below a 44px target. Source:
  [`billTrackButtonAppearance.ts`, `trackButtonAppearance` and `trackButtonSize`, pinned at `67db903a`](https://github.com/alethical-org/alethical/blob/67db903a9300340c8b8a35cc53a8db55b4435a05/apps/frontend/src/components/billDetail/billTrackButtonAppearance.ts#L3-L81)
  and [`BillTrackButton.tsx`, `BillTrackButton`, pinned at `67db903a`](https://github.com/alethical-org/alethical/blob/67db903a9300340c8b8a35cc53a8db55b4435a05/apps/frontend/src/components/billDetail/BillTrackButton.tsx#L57-L185).
  The shared black filter role is visible in
  [`searchPieces.tsx`, `ClearAllButton`, pinned at `67db903a`](https://github.com/alethical-org/alethical/blob/67db903a9300340c8b8a35cc53a8db55b4435a05/apps/frontend/src/components/search/searchPieces.tsx#L1001-L1025)
  ([applied styles](https://github.com/alethical-org/alethical/blob/67db903a9300340c8b8a35cc53a8db55b4435a05/apps/frontend/src/components/search/searchPieces.tsx#L1835-L1849)).
  Measured on the rendered site at that commit: 16px / 12px on desktop, 15px / 10px on a 375px
  phone viewport, 14px / 10px on the same viewport's result cards, and one control announced as the
  same pressed toggle in both label states ([#1013](https://github.com/alethical-org/alethical/issues/1013)).
- **OMNIBUS is a ghost qualifier, not a second bill-code badge.** It has transparent fill, the
  `omnibus.ghostBorder` amber outline, and `omnibus.text` label, with the small balance glyph and
  uppercase word set in the interface face (Libre Franklin). Its 8px radius deliberately steps
  outside both the monospace record-label texture and the chip-radius family: it must read as a
  plain-language qualifier attached to the bill, while the solid amber monospace badge remains the
  bill's recorded identity. The ghost treatment keeps the qualifier visibly quieter than that code
  badge. Source: [`BillResultCard.tsx`, `OmnibusPill` and its styles, pinned at `67db903a`](https://github.com/alethical-org/alethical/blob/67db903a9300340c8b8a35cc53a8db55b4435a05/apps/frontend/src/components/search/BillResultCard.tsx#L129-L145)
  ([applied styles](https://github.com/alethical-org/alethical/blob/67db903a9300340c8b8a35cc53a8db55b4435a05/apps/frontend/src/components/search/BillResultCard.tsx#L603-L620)).
  Measured on the rendered bill-search cards at that commit; the accessible name is “Omnibus bill”
  and the visible label is “OMNIBUS” ([#592](https://github.com/alethical-org/alethical/pull/592)).
- **Party is neutral identity, never a color role.** Every party badge spells out the party name
  ("Republican" / "Democratic-Farmer-Labor") and uses a neutral `#f1f1f4` fill with no border and
  `#4f5651` text. The badge is fully rounded, uses Libre Franklin at weight 700 with `0.06em`
  letter spacing, and never wraps. Large-screen padding is 6px × 14px at 14px type; phone padding
  is 5px × 12px at 12px type. Never use party-specific red/blue or Alethical's green action color
  for party identity. Committee leadership badges are a separate role and keep their mint fill,
  green border, and green text.
- **Type.** One humanist sans (**Libre Franklin**) does titles, body, and UI; a monospace
  (**JetBrains Mono**) is reserved for data, metadata, dates, and labels — the "record" texture.
  Hierarchy comes from weight and size, not from decorative fonts. (No serifs — that was the retired
  Newsprint identity.)
- **Shape.** Softly rounded, never sharp and never pill-everything: cards and inputs ~12px radius,
  small chips/badges smaller, full pills only for genuinely pill-shaped controls. Rounded = approachable
  and modern; restrained radius = still serious.
  **On a filtering surface, radius carries meaning and is not a taste call.** A **full pill (999px)**
  belongs to the *applied-filter* layer — the active-filter chips and any "Clear all" that acts on
  them. A **rounded rect (11–12px)** belongs to the controls you use to *build* a query — segmented
  chamber control, status and session dropdowns, the Omnibus toggle, the ISSUES chips, sort. One
  action also gets one label, one fill, and one shape wherever it appears: the Search Bills empty
  state repeats the chip row's "Clear all" verbatim, as a black pill, because both are on screen at
  once and two names for one action make the user wonder whether one of them spares their search text
  ([#720](https://github.com/alethical-org/alethical/pull/720)).
- **Text below rounded cards.** A footnote, gloss, caveat, or trailing action row placed underneath a
  rounded card or card group starts 17px inside the group's left edge (`spacing.underCardText`). The
  inset keeps the line visually attached to the rounded shape. It applies on web and mobile. It does
  not apply to headings above cards, text inside cards, or full-width page furniture such as source
  lines.
- **Roll-call reference chips.** A vote shortcut in card metadata is one outlined white link with a
  tally glyph, monospace type, and the uppercase recorded count ("1 VOTE" / "3 VOTES"). It is absent
  when the count is zero. Never use the old green fill or the instruction "VIEW VOTES": the count
  tells the reader what is there, while the outline, type, and glyph distinguish the link from an
  issue label without relying on color alone. On phones, its 44px target comes from a minimum height,
  not inflated vertical padding. The shared implementation is `VoteCountLinkChip`; the action
  timeline's per-action "View votes →" text link is a different element and stays unchanged.
- **Trailing arrows on links.** Use the shared `LinkArrow` drawing beside the label on every new
  arrow-bearing link or button that can appear at a phone width. Never type the `→` character into
  new interactive UI. Libre Franklin does not contain that character, so desktop and Android
  browsers choose different fallback fonts: desktop gets a long, centered arrow while Android gets
  a short, low one. `LinkArrow` fixes the length and alignment in one place. The
  `mobileLinkArrows.test.ts` check rejects new text arrows and caps the older exceptions until each
  is replaced.
- **Optical centering for icon + label buttons.** Our icons are drawn on a 24-unit viewBox with the
  marks inset to roughly the middle 50% (the ✕ runs 6,6 → 18,18; chevrons 6 → 18; the plus 5 → 19), so
  at our 13–17px sizes an icon carries ~3px of empty box on its outer side. Symmetric padding then
  renders the content ~3px off-centre, because the eye reads that empty box as extra padding while the
  text label sits flush against its own box. Correct the **container, never the glyph** — tightening
  the viewBox (e.g. to `5 5 14 14`) fixes the geometry but renders the mark ~40% larger, so it reads
  heavier than the label. The rule, by icon position:
  - **Leading icon + label** → trim 3px off the **left** (`padding: 8px 14px 8px 11px`).
  - **Label + trailing icon** → trim 3px off the **right** (`padding: 11px 15px 11px 18px`).
  - **Both a leading and a trailing icon** (icon + label + chevron) → **no change**; the insets cancel.
  - **Icon-only controls** (close ✕, hamburger, social glyphs, bare chevrons) → **no change**;
    symmetric padding is correct with no label.

  Three cases the rule deliberately does **not** reach, found while sweeping:
  - **A button with no horizontal padding at all** (breadcrumbs, bare text+chevron rows) — there is
    nothing to trim, and adding a negative margin would pull the glyph outside the content column.
  - **A full-width button that centres its content** (`justifyContent: 'center'`, no side padding) —
    the group is centred as a block, so the error is half as large (~1.5px) and the correction would
    be padding on the side *away* from the icon rather than a trim. Left alone until it's measured.
  - **An icon inside its own tile** (the mega-menu rows' 40×40 icon square, the capability cards'
    48×48 tile, the version rows' 38×38 box) — the tile already centres the glyph, so the inset
    never reaches the button's edge.

  A control whose icon appears in **only one state** (the share popover's Copy → Copied) trims in
  that state only, via a sibling style, so the text-only state stays centred.

  Build new buttons this way. It applies to auth-gated controls (account nav, Sign out,
  Track/Tracking, Continue with Google) as soon as sign-in ships; they were skipped on the first
  sweep only because they are not on the live signed-out site
  ([#720](https://github.com/alethical-org/alethical/pull/720)).
- **Elevation.** Soft, low-spread shadows for gentle lift — the page feels like paper with light
  depth, not a stack of floating glass. Reserve the heavy multi-layer shadow for true overlays
  (nav dropdown, modals).
- **Motion.** Subtle and functional: quiet hover/focus transitions and gentle entrance, never
  attention-grabbing. Motion clarifies state; it is not a feature. Respect reduced-motion (§3).
- **Layout has 3 cases, not 2.** Phone is below 768px, tablet is 768px through 1099px, and desktop
  begins at 1100px. Tablet is designed as its own case, never a stretched phone: the same content
  may move from stacked phone actions to side-by-side tablet actions before the desktop composition
  takes over. The shared `Container` owns horizontal gutters only, switching from 24px to 56px at
  768px; it does not impose one site-wide maximum width or centering rule. Page-owned inner wrappers
  decide their own reading measure. Source:
  [`useResponsive.ts`, `useResponsive`, pinned at `67db903a`](https://github.com/alethical-org/alethical/blob/67db903a9300340c8b8a35cc53a8db55b4435a05/apps/frontend/src/hooks/useResponsive.ts#L3-L11),
  [`primitives.tsx`, `Container`, pinned at `67db903a`](https://github.com/alethical-org/alethical/blob/67db903a9300340c8b8a35cc53a8db55b4435a05/apps/frontend/src/theme/primitives.tsx#L106-L117)
  ([applied gutter styles](https://github.com/alethical-org/alethical/blob/67db903a9300340c8b8a35cc53a8db55b4435a05/apps/frontend/src/theme/primitives.tsx#L1051-L1054)), and
  [`HomeSignedOutScreen.tsx`, `HomeSignedOutMobile`, pinned at `67db903a`](https://github.com/alethical-org/alethical/blob/67db903a9300340c8b8a35cc53a8db55b4435a05/apps/frontend/src/screens/redesign/HomeSignedOutScreen.tsx#L1190-L1198).
  Measured on the rendered site at 375px, 900px, and 1280px: phone and tablet share content but not
  composition, and the desktop navigation arrives only at the third case
  ([#1034](https://github.com/alethical-org/alethical/issues/1034)).
- **In a wrapping label + control row, the labels yield and the control holds the right edge.** The
  label group takes the remaining width, permits shrinking, and wraps inside itself (`flex: 1`,
  `min-width: 0`); the one interactive control does not shrink and uses an automatic left margin.
  Never let that control wrap onto a line of its own. The result-card identity row proves the rule:
  at 375px it has 265px of content width, too little for the 166px progress unit and 107px Track
  control to share a row, yet 2 labels still wrap without moving Track. Source:
  [`BillResultCard.tsx`, `BillResultCard`, pinned at `67db903a`](https://github.com/alethical-org/alethical/blob/67db903a9300340c8b8a35cc53a8db55b4435a05/apps/frontend/src/components/search/BillResultCard.tsx#L297-L320)
  ([#596](https://github.com/alethical-org/alethical/pull/596)).

## 3. Interaction & accessibility baseline

Non-negotiable for every screen. These are platform-agnostic principles adapted from Vercel's
**Web Interface Guidelines** (MIT — see attribution) and reconciled to our RN/Expo, web-first stack.
On web, `react-native-web` maps *most* RN accessibility props to real ARIA — so these are checkable
on the rendered site and fixable in RN. **`accessibilityState` is the exception, and it is a silent
one: see the box below before writing one.**

> **Marking a control disabled, busy, expanded or selected — read this first.**
>
> **`accessibilityState={{ disabled, busy, expanded, selected }}` renders nothing on web.** No
> attribute, no error, no warning, no type complaint: react-native-web 0.21 does not carry that prop
> to the DOM at all. So a control marked this way tells a screen reader nothing, while
> `accessibilityRole="button"` separately makes it a keyboard tab stop — a "disabled" control that
> is reachable by Tab and announces as an ordinary working button. It survived in four places
> because nothing anywhere fails
> ([#1013](https://github.com/alethical-org/alethical/issues/1013),
> [#1025](https://github.com/alethical-org/alethical/issues/1025)).
>
> **The plain ARIA prop works, and it is what to write for `expanded` and `selected`.**
> `aria-expanded`, `aria-selected`, `aria-disabled` and `aria-busy` are ordinary props on any
> View/Pressable, typed by React Native itself and honoured on both platforms. Measured:
> `aria-expanded={open}` on the Search Bills sort trigger renders `aria-expanded="true"`, where the
> `accessibilityState` it replaced rendered nothing.
>
> **`selected` almost never becomes `aria-selected`, though — pick per control
> ([#1036](https://github.com/alethical-org/alethical/issues/1036)).** `aria-selected` is only
> meaningful inside a `listbox`, `tablist`, `grid` or `tree`, and this app has none of those. What
> the fifteen sites actually needed:
>
> | The control | Write | Why |
> | --- | --- | --- |
> | Marks where you are — nav rail, mobile tab bar, bill tabs, section rail, jump chips, the chosen row in a filter or sort dropdown | `aria-current` (`"page"` for a URL, `"location"` for a spot in the page, `"true"` in a plain set) | Says which one is current, promises no keyboard behaviour |
> | A toggle that stays on — Track, roll-call and chamber filters, Omnibus only, issue pills, chat citations | `aria-pressed` | It is a toggle button, and that is the attribute for one |
> | Anything else | nothing | Silence beats a state claim that is not true |
>
> **Two of those three are unchecked by TypeScript, so a typo ships.** `aria-current` and
> `aria-pressed` are not in React Native's `ViewAccessibility.d.ts`; they compile with any value at
> all. Measured: `aria-expanded={12345}` is a compile error, `aria-current={12345}` is not. The
> guard is `apps/frontend/src/lib/__tests__/ariaStateProps.test.ts` plus opening the page.
>
> **`accessibilityLabel` REPLACES the visible text for a screen reader; it does not add to it.**
> This is how the Search Bills filters hid their own state: the button read "All statuses" on screen
> and its computed accessible name was "Filter by status", so the current filter was announced
> nowhere. If the visible text carries a value, the label has to carry it too
> ("Filter by status: All statuses"). The reverse also applies — where the visible text is already a
> complete, natural name, adding a label only makes it worse, which is why the sort trigger has none
> and reads "Sorted by legislative progress" rather than "Sort results, sorted by …".
>
> **A decorative glyph inside a control lands in its accessible name.** Measured: a "✓" marking the
> chosen dropdown row produced the computed name "All statuses ✓", which a screen reader reads out
> as "check mark" on top of the `aria-current` that already said it. Put `aria-hidden` on any text
> node that is a picture rather than a word.
>
> **Read the computed accessible NAME, not the attributes** — CDP's
> `Accessibility.getPartialAXTree`, or the Accessibility pane in devtools. Both traps above are
> invisible in an attribute dump, and the second review of this work caught the first one precisely
> because it stopped reading `aria-label` and started reading `name`.
>
> **For "this control is unavailable", use the one helper instead: `useUnavailableControl`**
> (`apps/frontend/src/components/billDetail/interactions.ts`). Spread its ref onto the node. It
> sets `aria-disabled`, optionally `aria-busy`, and `tabindex="-1"`, and — the part a plain prop
> cannot do — **clears them again when the control becomes usable**, which matters for a button
> that recovers in place rather than unmounting. One mechanism for all four sites beats a rule with
> an exception in it. Used by the Track button's "checking" form, the sign-in dialog's "Connecting"
> state, and the two dropdown rows that name something not built yet.
>
> **Why not just `aria-disabled` as a prop there too?** Measured: react-native-web turns it into a
> real native `disabled` attribute, which makes the browser *drop focus* off the element. That is
> right for a row nobody ever focuses and wrong for a button someone just pressed — the reader gets
> thrown out of the very control whose new state they need to hear. Verified with the helper: focus
> stays on the sign-in button while it connects.
>
> **`accessibilityRole` is fine, including the roles you would not expect.** Measured: `menuitem`
> renders `role="menuitem"`, and `tab` renders `role="tab"`. Whether either *should* be used is a
> separate question, and the answer for both is no: our dropdowns are deliberately disclosures
> containing a labelled group of buttons, not ARIA menus, and the three `tab` sites were dropped in
> [#1036](https://github.com/alethical-org/alethical/issues/1036) — they rendered a real `role="tab"`
> with no `tablist` parent anywhere, and an ARIA tab promises arrow-key navigation and a roving
> tabindex we have not built either. Both roles are a promise of keyboard behaviour, so do not reach
> for one until that behaviour exists.
>
> **Never conclude any of this from the source.** Every claim above was wrong at least once when
> reasoned from the code: the same sweep that found the trap named the wrong component for it, and
> the `menuitem` finding started life as the opposite claim. Open the page and read the rendered
> attributes.

- **A heading without a level is an `<h1>`, so always write the level.** Measured in
  react-native-web 0.21 (`AccessibilityUtil/propsToAccessibilityComponent.js`): role `heading` with
  no `aria-level` returns `'h1'`. Nothing warns, so `accessibilityRole="header"` on a section label
  silently claims to be the most important heading on the page. Every heading therefore carries
  `aria-level={n}` — **the page's subject is the only 1, section labels are 2, anything nested under
  one is 3** — and the level follows the page's *structure*, never the type size, so a small-type
  section label in a sidebar is still a 2. Measured on production 11 Aug 2026 before the fix
  ([#1355](https://github.com/alethical-org/alethical/issues/1355)): a bill page carried **52**
  `<h1>` at phone width and a legislator profile **9**, with the person's own name not a heading at
  all — so heading navigation, which is how a screen-reader user skims, never reached the subject of
  the page. The guard is `apps/frontend/src/lib/__tests__/headingLevels.test.ts`.
  - **A screen kept in the back stack still ships its markup, so its `<h1>` lands in every other
    page.** React Navigation keeps Home mounted beneath a deep-linked bill or profile with
    `display: none`, which hides it from the accessibility tree (verified: it is absent from
    `Accessibility.getFullAXTree`) but not from a crawler that renders the page. So Home's hero
    headline takes its header role from `useIsFocused()` and is a heading only while Home is the
    visible screen.
- **Everything actionable is reachable and labeled.** Every control is keyboard-reachable in a
  sensible order; icon-only controls carry an accessibility label.
- **Focus is always visible.** A clear focus ring appears on every interactive element. Every
  editable text field, including search, find, Ask, address, and chat fields, uses the shared
  light-purple border and glow
  (`theme/fieldFocus.ts`) while the cursor is in them. Text fields never receive focus on page load
  or navigation; the visitor must tap one or reach it with the keyboard. Never remove focus styling
  without an equivalent replacement.
- **Contrast holds — and accessibility overrides the spec.** Body text and essential UI meet WCAG AA
  against their background (4.5:1 for normal text, 3:1 for large/bold ≥18.66px and for essential UI).
  The dark-ink-on-green-fill rule exists for this reason — bright green with white text fails contrast.
  `#149d5b` is legal only for SVG strokes/fills and large bold display text on light surfaces; it is
  about 3.5:1 on white and is not UI text. `#0f7a45` is the light-surface UI-text token and meets
  the 4.5:1 rule. Do not replace both with one value: the split preserves the same perceived green
  at small and display sizes.
  **When a prompt, mockup, or explicit instruction specifies a color that fails AA, nudge it to the
  nearest acceptable value rather than shipping the failing one — regardless of the original
  instruction.** Prefer converging on an existing AA-safe token so the fix stays **consistent
  site-wide** (one treatment per role, not a new near-duplicate). Ship the accessible value and name
  the deviation in the PR; don't hold it for approval. (Origin: the OMNIBUS tag's `#a76a1a` on the
  card was 4.45:1 — a hair under AA — so it converges on the AA-safe `#8f5a12` the other OMNIBUS tags
  already use, [#592](https://github.com/alethical-org/alethical/pull/592) → follow-up.)
  **Tinted surfaces get their own measured pair.** On the pale-green change panel, the eyebrow uses
  `brand.forest` (the current alias of `text.greenOnLight`) and its qualifier uses `text.muted`:
  both measure 5.05:1, so the date qualifier stays quieter by role and wording rather than by weaker
  contrast. `text.faint` measures 4.61:1 on white but 4.31:1 on this tint, so any faint-grey text
  moved onto a tinted surface darkens to the surface-safe token. Source:
  [`ChangeBlock.tsx`, `ChangeBlock` and its styles, pinned at `67db903a`](https://github.com/alethical-org/alethical/blob/67db903a9300340c8b8a35cc53a8db55b4435a05/apps/frontend/src/components/ChangeBlock.tsx#L38-L133)
  ([#193](https://github.com/alethical-org/alethical/issues/193)).
- **Touch targets ~44px** on the mobile web layout; interactive rows and chips get real hit area.
- **No affordance lives only in hover.** There is no hover on touch, so resting states must stand
  on their own; hover/focus glows are enhancements, never the only signal (learned the hard way in
  the nav-dropdown work, [#171](https://github.com/alethical-org/alethical/pull/171)).
- **A field never crops its placeholder or value.** Every input/textarea (search, Ask, finder,
  forms) shows its placeholder and typed text in full — never visually clipped or ellipsized.
  Prefer a placeholder concise enough to fit one line at the field's width; when the text genuinely
  needs more than one line, the field wraps and grows vertically to show all of it rather than
  holding a fixed single-line height that crops line 2. The action button (Ask/Search/Find) stays
  vertically centered as the field grows, or sits full-width below on mobile per the stacked-field
  rule (learned on the home hero Ask field, [#468](https://github.com/alethical-org/alethical/pull/468)).
- **State lives in the URL.** Filters, tabs, pagination, and expanded panels are URL-addressable, not
  buried in component state — this is also `grounded-answers.md` rule 5 (anything linked-to must be
  URL-addressable). Same principle, restated for design.
- **Every detail-page back link says “Go back” and tells the truth.** It stays a real link whose
  address is the safe list or parent page. A normal click returns to the earlier Alethical page in
  that browser tab when one exists, including its filters, page number, and scroll position; a fresh
  or shared visit follows the fallback address instead. Modified clicks stay native browser actions.
  Top-level pages do not show this control.
- **Loading and empty and error are designed states,** not afterthoughts. A refusal / "no matches" is
  a first-class, dignified state (`grounded-answers.md` rule 1), never a broken-looking blank.
- **Source and freshness are page furniture, not hover help.** Bill and Ask answer surfaces close
  with one always-visible, quiet monospace source line. It names the Minnesota Legislature and the
  official domain; when a real bill-specific pull date exists, the same line adds “Updated …”. When
  that date is absent or cannot be parsed, the freshness segment is dropped rather than replaced by
  a nearby action date or a corpus-wide guess. Source: [`SourceLine.tsx`, `SourceLine` and
  `billSourceText`, pinned at `67db903a`](https://github.com/alethical-org/alethical/blob/67db903a9300340c8b8a35cc53a8db55b4435a05/apps/frontend/src/components/billDetail/SourceLine.tsx#L9-L64)
  and [`billDetail.ts`, `pulledLabel`, pinned at `67db903a`](https://github.com/alethical-org/alethical/blob/67db903a9300340c8b8a35cc53a8db55b4435a05/apps/frontend/src/lib/billDetail.ts#L1707-L1727).
  Its built use on both page types is pinned in
  [`SummaryTab.tsx`, `SummaryTab`, at `67db903a`](https://github.com/alethical-org/alethical/blob/67db903a9300340c8b8a35cc53a8db55b4435a05/apps/frontend/src/components/billDetail/SummaryTab.tsx#L24-L164)
  and [`AskAnswerScreen.tsx`, `AskAnswerScreen`, at `67db903a`](https://github.com/alethical-org/alethical/blob/67db903a9300340c8b8a35cc53a8db55b4435a05/apps/frontend/src/screens/redesign/AskAnswerScreen.tsx#L861-L881).
  Measured on the rendered HF 4138 page at that commit: “Source: Minnesota Legislature ·
  revisor.mn.gov · Updated Jul 22, 2026” is visible in the page flow
  ([#861](https://github.com/alethical-org/alethical/issues/861)).
- **Destructive actions confirm** (confirmation or undo window) — never fire immediately.
- **Respect reduced-motion:** honor the OS "reduce motion" setting; entrances and transitions
  degrade to instant.
- **Every screen carries a control that works for everyone who can reach it.** A control that is
  inert for some of the people who land on a screen is a broken promise, and instructing anyone
  to wait for an event that cannot occur is a dead end. Where the screen cannot tell which case
  the reader is in, breadth substitutes: a route shown to everyone reveals nothing about anyone.
  (From the rev 17 sign-in audit, [#1533](https://github.com/alethical-org/alethical/issues/1533).)
- **Dialogs always close** — a visible Close control (≥44×44 on touch), the Escape key, and a
  scrim/outside click all work, and focus returns to the control that opened them.
- **Loading states keep visible words.** A busy control shows its words ("Saving…",
  "Continuing with Google…") beside any spinner, the accessible name is those same visible
  words, and under reduced motion the spinner disappears while the words carry the state alone.
  Source: [`LoadingButton.tsx`, `LoadingButton`, pinned at `67db903a`](https://github.com/alethical-org/alethical/blob/67db903a9300340c8b8a35cc53a8db55b4435a05/apps/frontend/src/components/auth/LoadingButton.tsx#L19-L145)
  and [`SignInDialog.tsx`, `SignInDialog`, pinned at `67db903a`](https://github.com/alethical-org/alethical/blob/67db903a9300340c8b8a35cc53a8db55b4435a05/apps/frontend/src/components/auth/SignInDialog.tsx#L486-L493)
  ([#1533](https://github.com/alethical-org/alethical/issues/1533)).

## 4. What to avoid (directionally wrong for Alethical)

The generic "make it striking" instinct pulls the wrong way for a civic-records product:

- **No decoration for its own sake** — no gratuitous gradients, glows, or motion that doesn't clarify.
- **Page backgrounds stay neutral site-wide.** Do not add colored corner washes, green glows, or
  decorative color flows to the shared page background or to an individual screen, even when a
  design handoff includes one. Treat that part of the handoff as accidental and keep the neutral
  page ground.
- **No luxury / editorial-flash styling** — premium-brand aesthetics read as untrustworthy here.
- **No manipulative patterns** — no urgency, no dark patterns, no visual nudging toward a position.
- **No color as opinion** — never use red/green weighting to imply a bill or legislator is bad/good.
- **No maximal density** — resist cramming; if a screen feels busy, cut, don't shrink.

## 5. Using this with a design tool

- **At preview time (generation):** paste §1–§4 into the design tool prompt as the standing brief,
  then describe the specific page. This gives the design tool the editorial direction it otherwise
  averages away. Keep prompts definitive (state the design, don't ask it to decide scope).
- **Structural option:** the same intent can be pushed to a claude.ai/design *design-system project*
  (via the `DesignSync` tool) so Claude Design generates against our real tokens + primitives rather
  than a prose description. Prose brief is the lightweight path; the synced system is the durable one.
- **At build time (implementation):** this guide plus `tokens.ts`/`primitives.tsx` is the shared
  reference; the feature guide under `docs/product-onboarding/` owns the lasting screen behavior.
  Use the accepted preview only as a temporary visual reference. See the `design-build` skill for
  the build, route, and review sequence.
- **At review time:** §3 is the checklist. Audit the rendered web output against it before shipping.

## References

`apps/frontend/src/theme/tokens.ts` · `apps/frontend/src/theme/primitives.tsx` ·
`docs/product-onboarding/mvp-redesign-plan.md` (redesign decisions) · `docs/design/ui-copy-guide.md` (voice/copy) ·
`.claude/rules/grounded-answers.md` (what a surface may claim) · `docs/product-onboarding/grounded-ask-spec.md`
(Ask surfaces) · `docs/product-onboarding/home-screen-guide.md` (Home behavior).

---

*§3's interaction/accessibility rules are adapted from Vercel's
[Web Interface Guidelines](https://github.com/vercel-labs/web-interface-guidelines) (MIT License),
reduced to the platform-agnostic subset and reconciled to Alethical's React Native / Expo, web-first
stack.*
