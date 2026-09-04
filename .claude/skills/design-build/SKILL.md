---
name: design-build
description: Use when a finalized Claude Design mockup or handoff bundle (README + .dc.html + screenshots, or raw screenshots + a live preview URL) needs to be built as a real page on Alethical's React Native / Expo frontend and shipped to the live site. Part of the design- skill set: design-review (evaluate a draft mockup) → design-intake (proof the request) → design-build → design-audit (verify the live build).
---

# Implementing design handoffs

## Overview

A finalized design is **rebuilt in the live React Native codebase from its tokens + spec + screenshots.** There is **no HTML-to-RN conversion**: the `.dc.html` is a *literal-values reference* (exact hex/px, shadows, state logic, copy), never markup to port — RN can't render HTML/CSS, and web CSS misleads. The job is not done when the screen file exists; it is done when the page is **routed and rendering to real users**, verified, and merged to `main`.

Why this skill: the process spans several repo docs. A fresh agent typically works off the loose `~/Downloads` copy, forgets to route the screen, misses the copy/naming invariants, and is unsure how the redesign reaches production. This sequences it and names the invariants.

## When to use

- A design bundle / mockup / screenshots for a page arrive and need to become a live page.
- Continuing or shipping a redesign screen (home, search, legislators, etc.).

Not for: pure backend/data work, or design *decisions* still in flux (those go to the page's guide under `docs/product-onboarding/` first, or `docs/design/design-principles.md` for a shared visual rule).

## Procedure

**Resolving which bundle to build.** If the invocation names a bundle path or page, use it. Otherwise — including a bare `/design-build` with no other arguments — default to the **most recently downloaded bundle in `~/Downloads`**, so the skill can be invoked with nothing else and still know what to build. Find the newest candidate with `ls -td ~/Downloads/*/ ~/Downloads/*.zip 2>/dev/null | head` (a Claude Design bundle is a folder — or a `.zip` of one — holding `README.md` + a `.dc.html` + `screenshots/`); unzip a `.zip` into a task-owned temporary folder first. If the newest item isn't a design bundle, fall back to the newest one that is. Confirm in one line which exact bundle you picked and what page it's for, then pin that input in step 1.

**Tier the build, then STOP and wait for the go.** When the build request arrives as a pasted prompt or bundle, the first reply names the model, the tool's exact reasoning label and the mechanism for this build (a `Tier:` line, per `~/.claude/CLAUDE.md`) and does nothing else: no pinning the bundle, no file reading, no code. A build is mixed work — bundle reading, file sweeps and test updates separate cleanly from layout and copy judgment — so the mechanism half is a real call here, not a silent default. Then wait for Eugene's go (`g`) and start at step 0.

0. **Intake first if the prompt is terse or ambiguous.** Run `design-intake` to proof the prompt for missing high-value context and confirm which assets are actually needed before building. Skip only when the task is already fully specified. (If the design itself is still a draft — not finalized — it belongs in `design-review` first, not here.)
1. **Pin the accepted input without turning it into permanent documentation.** Work from 1 exact task-owned folder, not a moving `~/Downloads` copy: unzip once into `/tmp`, note the original filename and SHA-256 checksum in the issue or pull request, and do not replace that folder during the build. The bundle's `README.md` and `.dc.html` are temporary build references; screenshots are temporary visual review targets. Do **not** copy the bundle, HTML, screenshots, or sample assets into `docs/`. Before code lands, move lasting screen behavior and copy into the feature guide under `docs/product-onboarding/`, move shared visual rules into `docs/design/design-principles.md`, and put exact values in the theme or component code.
2. **Branch per-page off `main`.** The design-system foundation — `apps/frontend/src/theme/tokens.ts` + `theme/primitives.tsx` — merged to `main` with the first page ([#67, Design-system foundation + redesigned signed-out home](https://github.com/alethical-org/alethical/pull/67), 2026-07-12), and the old `redesign/design-system` branch is deleted. Start each page from `origin/main` per CONTRIBUTING's branch workflow; the green tokens and primitives are already there.
3. **Build in RN from the accepted preview and permanent feature guide.** Reuse the tokens + primitives; add any token the design needs that's missing, pulling exact values from the temporary README / `.dc.html`. Match the screenshots. Ignore `support.js`.
4. **Route it — this is the crux.** A screen nothing renders ships nothing. Wire it into `apps/frontend/src/navigation/webRoutes.ts` + `RootNavigator.tsx` at its `ia.ts` route so real users reach it. This is the step most often forgotten. Do the *minimal* routing for this page — not a full IA migration — unless the task is the migration.
5. **Copy + naming invariants.** User-facing strings come **verbatim** from the spec (`docs/product-onboarding/grounded-ask-spec.md` for Ask surfaces). The AI-answer feature is **"Grounded Ask"** (badge) / **"✦ Ask"** (action / nav), **never "Ask AI"** (`docs/design/ui-copy-guide.md`). Obey `.claude/rules/grounded-answers.md`: suggested chips must not lead to a refusal; no coverage claims the data can't back; records vs. generated answers stay visually distinct; linked states are URL-addressable.
6. **Interim behavior for not-yet-shipped backends.** If a surface depends on unbuilt backend (e.g. Ask on a stub embedding), build the interim the plan specifies (e.g. Ask → sign-in) — never a faked live answer.
7. **Static sample content stays static.** Marketing sample content (hero answer cards, sample bills) is built as designed from the design's values — not wired to data and not "fixed" for grounded-answers — unless the plan says otherwise. If it *looks* like a generated answer but isn't, confirm whether grounding reconciliation is required now or deferred (it is often deliberately held).
8. **QA against the live preview.** If a Claude Design preview URL exists, it is drivable for interaction spot-checks (hover glows, click states, transitions) — open it in a **logged-in Chrome** (the `claude-in-chrome` tools), **not** the in-app browser; the URL is auth-gated. Compare states to your build.
9. **Verify, then ship.** Run it (`just up` → `http://localhost:19006`), compare every state to the screenshots (desktop + mobile), run `design-audit` for the live-only accessibility/interaction checks (keyboard, real focus order/visibility, coded contrast, `prefers-reduced-motion`, RN-Web stacking) that a static mockup couldn't prove, then `just lint` **and** `just format` — CI's `prettier --check .` is repo-wide and `just lint` does not cover formatting, so lint passing alone is not enough. Ship path is **per-page to `main`** (auto-deploys): the design-system foundation recoloring older screens green is accepted. Verify the Vercel preview, then merge. Commit at milestones; the PR closes the tracking issue and carries a stale-reference check (`.claude/rules/workflow.md` rule 6).

## Responsive & touch

The mock is almost always a fixed-width **desktop** canvas (~1600px) with **no mobile breakpoints** — MVP is responsive *web* (desktop + mobile web; native deferred, #91), so mobile web must work. Unless mobile mocks are provided, **derive** the mobile layout from the site's own responsive rules (`useResponsive`, existing screens' patterns): reflow multi-column sections to one column, turn nav dropdowns into the mobile drawer, keep touch targets ~44px. **No hover on touch** — hover-only glows/affordances never fire on mobile, so resting states must stand alone and interactive elements need a tap/`:active` state. Web-only CSS (backdrop-filter, box-shadow glows, gradients) is guarded with `isWeb` today; it needs RN-native equivalents only when native ships.

## Interaction & stacking (RN-Web)

Dropdowns, menus, and popovers are where RN-Web bites. Two rules, learned the hard way from the nav-dropdown hover bug ([#171](https://github.com/alethical-org/alethical/pull/171)):

- **Never close an open menu with a full-screen "click-away" overlay `Pressable`.** On web it competes on `z-index` with the panel and usually *wins*: an absolutely-positioned panel that hangs below the nav is trapped in its section's stacking context, so a later full-screen overlay (even a lower `z-index`) paints *above* it and silently swallows the panel's hover **and** clicks — the rows look dead, and a click closes the menu instead of navigating. Close instead via a **web `document` pointerdown listener** that ignores clicks inside the trigger+panel ref, or an RN **`Modal`** (which escapes stacking contexts — the mobile drawer already does this). `TopNav` is the reference.
- **Press feedback on an element that also navigates is fighting the transition.** A tap-confirmation pulse is only visible while its screen stays mounted, so a pattern copied from a stay-on-page control (a chip that fills an input) is near-invisible on a card that calls `navigation.navigate()` — the route changes first. Say so at intake rather than shipping feedback nobody sees. The proven remedy: glow on **`onPressIn`**, and settle both the glow-drop and the navigation no sooner than a pulse-minimum after press-in — `onPressOut` fades the glow only (so a press dragged off with no `onPress` still cleans up), `onPress` navigates. That gives a quick tap a full pulse before it leaves, and press-and-hold stays lit until release.
- **When something "renders but won't interact," suspect stacking, not styles.** `document.elementFromPoint(cx, cy)` on the dead element reveals what's actually on top; walk `getComputedStyle` up its ancestry for the `position` / `z-index` / `transform` that formed the trapping context. Reach for this before touching CSS.

### Verifying interactive states
Drive states through the DOM, not pixels. Interact by **element ref** (`read_page` → `ref_N`), never screenshot coordinates — screenshot-pixel space ≠ CSS-pixel space, and the mismatch makes you "miss" the element and misread a working feature as broken (this ate real time in #171). Assert the state with **`getComputedStyle`** (e.g. a hovered row's bg is `rgba(17,21,15,0.06)`) and use **`elementFromPoint`** to prove nothing covers the target. Screenshots confirm looks; the DOM confirms behavior. No frontend test runner exists yet, so these checks are manual — automated interaction regressions are tracked in [#173](https://github.com/alethical-org/alethical/issues/173).

**A press-only state needs the drag-off test.** RN-Web won't accept a synthetic `pointerdown` from `javascript_tool` (its press responder only reacts to trusted events), and the browser's one press gesture, `left_click`, always co-fires hover — so reading the element mid-press can't prove the *press* lit it rather than the hover. Use **`left_click_drag`** from the element's centre to empty space just outside it: that fires a real press-in and releases off-element. While the design's pulse-minimum keeps the glow lit after release, read `getComputedStyle` **and** assert `element.contains(document.elementFromPoint(releaseX, releaseY)) === false` in the same breath — glow lit *plus* pointer not over it proves the press caused it. Generally: to prove state X comes from trigger A and not co-trigger B, engineer an end position where B is false but A's effect persists, then assert the effect and the isolation together. Don't downgrade to "the code mirrors the shipped component, trust it." A navigating element can't be screenshotted mid-glow at all — dispatch press-in without release to freeze it, or screenshot after a paint.

## Surface, don't guess (`.claude/rules/workflow.md` rule 14, think before coding)

Ask when: a filter/data the design shows isn't backed by today's API; a mockup's copy conflicts with `docs/design/ui-copy-guide.md`; a page's nav/behavior diverges from the `ia.ts` registry; sample content's grounding is ambiguous.

## Common mistakes

| Mistake | Do instead |
|---|---|
| Building from a `~/Downloads` folder that may change | Unpack 1 accepted copy into a task-owned `/tmp` folder, record its checksum, and build from that pinned copy |
| Committing preview HTML, screenshots, or copied sample assets under `docs/` | Put lasting behavior in the feature guide, shared rules in `design-principles.md`, and exact values in code; keep preview artifacts with the task or pull request |
| Hunting for the old `redesign/design-system` foundation branch | It merged in #67; branch per-page off `main` (green tokens + primitives live there) |
| Screen built but never routed | Wire `webRoutes.ts` + `RootNavigator.tsx`; verify it renders at its URL |
| Porting HTML/CSS or `support.js` | Re-express in RN from the literal values; ignore the runtime |
| "Ask AI" in the UI | "Grounded Ask" / "✦ Ask" |
| Wiring/​"fixing" held marketing content | Build it static as designed; confirm before grounding it |
| Building only to the desktop mock; hover-carried affordances | Derive the mobile reflow from the site's rules; ensure nothing critical needs hover |
| Closing a menu with a full-screen click-away overlay | Outside-click `document` listener (web) or `Modal`; overlays lose the z-index fight and eat the panel's hover/clicks |
| Verifying hover/click by screenshot pixel coordinates | Interact by element ref; assert with `getComputedStyle` + `elementFromPoint` |
| Skipping Prettier, or resetting a large `just format` diff, to avoid a "reflow" | The workspace Prettier (`just format` / `pnpm exec prettier`, pinned 3.4.2 + `apps/frontend/.prettierrc.json`) is safe — a large diff means the file was genuinely dirty; **keep** it, or format pre-existing debt in a separate `chore/format-*` PR then rebase. Only a *global/npx* prettier reflows spuriously. CI runs `prettier --check .` **repo-wide** (not just changed files) and `just lint` does *not* cover it — run `just format` before pushing |

## References

`docs/product-onboarding/site-navigation-guide.md` (the top bar and every address) · the page's guide under `docs/product-onboarding/` · `.claude/rules/grounded-answers.md` · `.claude/rules/workflow.md` · `docs/design/ui-copy-guide.md` · `docs/product-onboarding/grounded-ask-spec.md`. First reference implementation: the signed-out home (`docs/product-onboarding/home-screen-guide.md`, issue #143). Sibling skills: `design-review` (pre-build preview evaluation), `design-intake` (proof the request), `design-audit` (verify the live build against the Web Interface Guidelines + WCAG).
