---
name: implementing-design-handoffs
description: Use when a finalized Claude Design mockup or handoff bundle (README + .dc.html + screenshots, or raw screenshots + a live preview URL) needs to be built as a real page on Alethical's React Native / Expo frontend and shipped to the live site.
---

# Implementing design handoffs

## Overview

A finalized design is **rebuilt in the live React Native codebase from its tokens + spec + screenshots.** There is **no HTML-to-RN conversion**: the `.dc.html` is a *literal-values reference* (exact hex/px, shadows, state logic, copy), never markup to port — RN can't render HTML/CSS, and web CSS misleads. The job is not done when the screen file exists; it is done when the page is **routed and rendering to real users**, verified, and merged to `main`.

Why this skill: the process spans several repo docs. A fresh agent typically works off the loose `~/Downloads` copy, forgets to route the screen, misses the copy/naming invariants, and is unsure how the redesign reaches production. This sequences it and names the invariants.

## When to use

- A design bundle / mockup / screenshots for a page arrive and need to become a live page.
- Continuing or shipping a redesign screen (home, search, legislators, etc.).

Not for: pure backend/data work, or design *decisions* still in flux (those go to `docs/mvp-redesign-plan.md` first).

## Procedure

1. **Land the bundle in-repo first.** Copy the handoff bundle to `docs/mockups/<page>/` (drop `support.js` — prototype runtime — and `.DS_Store`; rename any spaced filename). Build from that tracked path, never from a `~/Downloads` copy that goes stale (`.claude/rules/workflow.md` rule 3). Prepend a repo-context note (naming, held items, tokens location). The bundle's `README.md` is the per-page spec; the `.dc.html` is the literal-values reference; `screenshots/` are visual QA targets.
2. **Target branch = the one with the green design system.** Currently `redesign/design-system` (PR #67): it holds `apps/frontend/src/theme/tokens.ts` + `theme/primitives.tsx`. Sync it with `main` first. Do **not** branch off `main` yet — you'd get the old theme and no primitives. (Once the foundation has merged to `main` with the first page, later pages branch per-page off `main`.)
3. **Build in RN from the spec.** Reuse the tokens + primitives; add any token the design needs that's missing, pulling exact values from the README / `.dc.html`. Match the screenshots. Ignore `support.js`.
4. **Route it — this is the crux.** A screen nothing renders ships nothing. Wire it into `apps/frontend/src/navigation/webRoutes.ts` + `RootNavigator.tsx` at its `ia.ts` route so real users reach it. This is the step most often forgotten. Do the *minimal* routing for this page — not a full IA migration — unless the task is the migration.
5. **Copy + naming invariants.** User-facing strings come **verbatim** from the spec (`docs/grounded-ask-spec.md` for Ask surfaces). The AI-answer feature is **"Grounded Ask"** (badge) / **"✦ Ask"** (action / nav), **never "Ask AI"** (`docs/ui-copy-guide.md`). Obey `.claude/rules/grounded-answers.md`: suggested chips must not lead to a refusal; no coverage claims the data can't back; records vs. generated answers stay visually distinct; linked states are URL-addressable.
6. **Interim behavior for not-yet-shipped backends.** If a surface depends on unbuilt backend (e.g. Ask on a stub embedding), build the interim the plan specifies (e.g. Ask → sign-in) — never a faked live answer.
7. **Static sample content stays static.** Marketing sample content (hero answer cards, sample bills) is built as designed from the design's values — not wired to data and not "fixed" for grounded-answers — unless the plan says otherwise. If it *looks* like a generated answer but isn't, confirm whether grounding reconciliation is required now or deferred (it is often deliberately held).
8. **QA against the live preview.** If a Claude Design preview URL exists, it is drivable for interaction spot-checks (hover glows, click states, transitions) — open it in a **logged-in Chrome** (the `claude-in-chrome` tools), **not** the in-app browser; the URL is auth-gated. Compare states to your build.
9. **Verify, then ship.** Run it (`just up` → `http://localhost:19006`), compare every state to the screenshots (desktop + mobile), `just lint`. Ship path is **per-page to `main`** (auto-deploys): the design-system foundation recoloring older screens green is accepted. Verify the Vercel preview, then merge. Commit at milestones; the PR closes the tracking issue and carries a stale-reference check (`.claude/rules/workflow.md` rule 6).

## Responsive & touch

The mock is almost always a fixed-width **desktop** canvas (~1600px) with **no mobile breakpoints** — MVP is responsive *web* (desktop + mobile web; native deferred, #91), so mobile web must work. Unless mobile mocks are provided, **derive** the mobile layout from the site's own responsive rules (`useResponsive`, existing screens' patterns): reflow multi-column sections to one column, turn nav dropdowns into the mobile drawer, keep touch targets ~44px. **No hover on touch** — hover-only glows/affordances never fire on mobile, so resting states must stand alone and interactive elements need a tap/`:active` state. Web-only CSS (backdrop-filter, box-shadow glows, gradients) is guarded with `isWeb` today; it needs RN-native equivalents only when native ships.

## Interaction & stacking (RN-Web)

Dropdowns, menus, and popovers are where RN-Web bites. Two rules, learned the hard way from the nav-dropdown hover bug ([#171](https://github.com/alethical-org/alethical/pull/171)):

- **Never close an open menu with a full-screen "click-away" overlay `Pressable`.** On web it competes on `z-index` with the panel and usually *wins*: an absolutely-positioned panel that hangs below the nav is trapped in its section's stacking context, so a later full-screen overlay (even a lower `z-index`) paints *above* it and silently swallows the panel's hover **and** clicks — the rows look dead, and a click closes the menu instead of navigating. Close instead via a **web `document` pointerdown listener** that ignores clicks inside the trigger+panel ref, or an RN **`Modal`** (which escapes stacking contexts — the mobile drawer already does this). `TopNav` is the reference.
- **When something "renders but won't interact," suspect stacking, not styles.** `document.elementFromPoint(cx, cy)` on the dead element reveals what's actually on top; walk `getComputedStyle` up its ancestry for the `position` / `z-index` / `transform` that formed the trapping context. Reach for this before touching CSS.

### Verifying interactive states
Drive states through the DOM, not pixels. Interact by **element ref** (`read_page` → `ref_N`), never screenshot coordinates — screenshot-pixel space ≠ CSS-pixel space, and the mismatch makes you "miss" the element and misread a working feature as broken (this ate real time in #171). Assert the state with **`getComputedStyle`** (e.g. a hovered row's bg is `rgba(17,21,15,0.06)`) and use **`elementFromPoint`** to prove nothing covers the target. Screenshots confirm looks; the DOM confirms behavior. No frontend test runner exists yet, so these checks are manual — automated interaction regressions are tracked in [#173](https://github.com/alethical-org/alethical/issues/173).

## Surface, don't guess (`.claude/rules/coding-discipline.md` rule 1)

Ask when: a filter/data the design shows isn't backed by today's API; a mockup's copy conflicts with `docs/ui-copy-guide.md`; a page's nav/behavior diverges from the `ia.ts` registry; sample content's grounding is ambiguous.

## Common mistakes

| Mistake | Do instead |
|---|---|
| Building from the `~/Downloads` bundle | Land it in `docs/mockups/<page>/` and build from there |
| Branching off `main` | Branch off the foundation branch (green tokens + primitives) |
| Screen built but never routed | Wire `webRoutes.ts` + `RootNavigator.tsx`; verify it renders at its URL |
| Porting HTML/CSS or `support.js` | Re-express in RN from the literal values; ignore the runtime |
| "Ask AI" in the UI | "Grounded Ask" / "✦ Ask" |
| Wiring/​"fixing" held marketing content | Build it static as designed; confirm before grounding it |
| Assuming a PR into the draft redesign branch is live | Confirm the per-page-to-`main` ship path |
| Building only to the desktop mock; hover-carried affordances | Derive the mobile reflow from the site's rules; ensure nothing critical needs hover |
| Closing a menu with a full-screen click-away overlay | Outside-click `document` listener (web) or `Modal`; overlays lose the z-index fight and eat the panel's hover/clicks |
| Verifying hover/click by screenshot pixel coordinates | Interact by element ref; assert with `getComputedStyle` + `elementFromPoint` |
| `prettier --write` with a mismatched local version | Format via `just format` after `pnpm install --frozen-lockfile`; an ad-hoc/global prettier reflows unrelated lines |

## References

`docs/mvp-redesign-plan.md` (decisions, build sequence, IA/O-items) · `docs/mockups/<page>/README.md` (per-page spec) · `.claude/rules/grounded-answers.md` · `.claude/rules/workflow.md` · `docs/ui-copy-guide.md` · `docs/grounded-ask-spec.md`. First reference implementation: the signed-out home (`docs/mockups/home-signed-out-v2/`, issue #143).
