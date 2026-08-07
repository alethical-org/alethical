# Alethical design principles — the green system

> **What this is.** The written design intent behind Alethical's green visual system: what
> the product should feel like, and the visual/interaction rules that get it there. It is the
> single source of truth for the green system, which replaced the earlier Newsprint identity.
>
> **Two jobs.** (1) A **brief to hand to Claude Design** at the start of any mockup so its output
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
> system) · `docs/mockups/home-signed-out-v2/README.md` (first shipped page's values/states/copy) ·
> `docs/product-onboarding/mvp-redesign-plan.md` (redesign decisions). MVP is **responsive web** (desktop + mobile
> web); native is deferred ([#91](https://github.com/alethical-org/alethical/issues/91)).

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
- **Layout.** Centered column, generous gutters, one clear reading path per screen. Content maxes
  at a comfortable measure rather than filling ultrawide screens.

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
- **Loading and empty and error are designed states,** not afterthoughts. A refusal / "no matches" is
  a first-class, dignified state (`grounded-answers.md` rule 1), never a broken-looking blank.
- **Destructive actions confirm** (confirmation or undo window) — never fire immediately.
- **Respect reduced-motion:** honor the OS "reduce motion" setting; entrances and transitions
  degrade to instant.

## 4. What to avoid (directionally wrong for Alethical)

The generic "make it striking" instinct pulls the wrong way for a civic-records product:

- **No decoration for its own sake** — no gratuitous gradients, glows, or motion that doesn't clarify.
- **No luxury / editorial-flash styling** — premium-brand aesthetics read as untrustworthy here.
- **No manipulative patterns** — no urgency, no dark patterns, no visual nudging toward a position.
- **No color as opinion** — never use red/green weighting to imply a bill or legislator is bad/good.
- **No maximal density** — resist cramming; if a screen feels busy, cut, don't shrink.

## 5. Using this with Claude Design

- **At mockup time (generation):** paste §1–§4 into the Claude Design prompt as the standing brief,
  then describe the specific page. This gives Claude Design the editorial direction it otherwise
  averages away. Keep prompts definitive (state the design, don't ask it to decide scope).
- **Structural option:** the same intent can be pushed to a claude.ai/design *design-system project*
  (via the `DesignSync` tool) so Claude Design generates against our real tokens + primitives rather
  than a prose description. Prose brief is the lightweight path; the synced system is the durable one.
- **At build time (implementation):** this doc plus `tokens.ts`/`primitives.tsx` is the reference;
  the per-page `README.md` under `docs/mockups/<page>/` is the literal spec. See the
  `design-build` skill for the build/route/QA sequence.
- **At review time:** §3 is the checklist. Audit the rendered web output against it before shipping.

## References

`apps/frontend/src/theme/tokens.ts` · `apps/frontend/src/theme/primitives.tsx` ·
`docs/product-onboarding/mvp-redesign-plan.md` (redesign decisions) · `docs/design/ui-copy-guide.md` (voice/copy) ·
`.claude/rules/grounded-answers.md` (what a surface may claim) · `docs/product-onboarding/grounded-ask-spec.md`
(Ask surfaces) · `docs/mockups/home-signed-out-v2/README.md` (first shipped page).

---

*§3's interaction/accessibility rules are adapted from Vercel's
[Web Interface Guidelines](https://github.com/vercel-labs/web-interface-guidelines) (MIT License),
reduced to the platform-agnostic subset and reconciled to Alethical's React Native / Expo, web-first
stack.*
