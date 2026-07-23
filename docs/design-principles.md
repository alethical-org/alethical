# Alethical design principles — the green system

> **What this is.** The written design intent behind Alethical's green visual system: what
> the product should feel like, and the visual/interaction rules that get it there. It is the
> green design-system doc that `docs/aesthetics.md` (retired Newsprint) was holding a place for.
>
> **Two jobs.** (1) A **brief to hand to Claude Design** at the start of any mockup so its output
> starts on-brand instead of drifting to a generic default. (2) A **reference for building and
> reviewing** screens in the RN/Expo codebase.
>
> **Scope — visual & interaction only.** Voice and copy are owned by `docs/ui-copy-guide.md`;
> what a screen may *claim* is owned by `.claude/rules/grounded-answers.md` (a line must be true
> before it can be on-brand). Exact token values are owned by `apps/frontend/src/theme/tokens.ts`
> — this doc describes *character and intent*, never a parallel value sheet (it would drift; per
> `docs/mvp-redesign-plan.md`, generate a value sheet from the file if one is ever needed).
>
> **Sources of truth:** `apps/frontend/src/theme/tokens.ts` + `theme/primitives.tsx` (implemented
> system) · `docs/mockups/home-signed-out-v2/README.md` (first shipped page's values/states/copy) ·
> `docs/mvp-redesign-plan.md` (redesign decisions). MVP is **responsive web** (desktop + mobile
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

- **Color intent.** A light, warm-neutral page with a soft green radial wash; green is the single
  brand accent, used with intent (brand fills, CTAs, links, focus), not sprinkled. Text is a
  near-black **green-tinted ink**, not pure black, so the page reads warm and calm. A purple accent
  is reserved specifically for the "Grounded Ask" / AI affordance and focus — it is a *meaning*, not
  decoration. A red ramp is reserved for genuine danger/veto status. Green fills carry **dark ink
  text, never white** (a deliberate contrast choice — see §3).
- **Type.** One humanist sans (**Libre Franklin**) does titles, body, and UI; a monospace
  (**JetBrains Mono**) is reserved for data, metadata, dates, and labels — the "record" texture.
  Hierarchy comes from weight and size, not from decorative fonts. (No serifs — that was the retired
  Newsprint identity.)
- **Shape.** Softly rounded, never sharp and never pill-everything: cards and inputs ~12px radius,
  small chips/badges smaller, full pills only for genuinely pill-shaped controls. Rounded = approachable
  and modern; restrained radius = still serious.
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
On web, `react-native-web` maps RN accessibility props (`accessibilityLabel`, `accessibilityRole`,
`accessibilityState`) to real ARIA — so these are checkable on the rendered site and fixable in RN.

- **Everything actionable is reachable and labeled.** Every control is keyboard-reachable in a
  sensible order; icon-only controls carry an accessibility label.
- **Focus is always visible.** A clear focus ring on every interactive element (we already have a
  green focus token). Never remove focus styling without an equivalent replacement.
- **Contrast holds — and accessibility overrides the spec.** Body text and essential UI meet WCAG AA
  against their background (4.5:1 for normal text, 3:1 for large/bold ≥18.66px and for essential UI).
  The dark-ink-on-green-fill rule exists for this reason — bright green with white text fails contrast.
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
`docs/mvp-redesign-plan.md` (redesign decisions) · `docs/ui-copy-guide.md` (voice/copy) ·
`.claude/rules/grounded-answers.md` (what a surface may claim) · `docs/grounded-ask-spec.md`
(Ask surfaces) · `docs/mockups/home-signed-out-v2/README.md` (first shipped page) ·
`docs/aesthetics.md` (retired Newsprint identity, historical).

---

*§3's interaction/accessibility rules are adapted from Vercel's
[Web Interface Guidelines](https://github.com/vercel-labs/web-interface-guidelines) (MIT License),
reduced to the platform-agnostic subset and reconciled to Alethical's React Native / Expo, web-first
stack.*
