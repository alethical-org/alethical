# Signed-out homepage release

Eugene authorized the build on 30 September 2026 with “build”, following review
of `Alethical UX (39).zip`. The authorization covers implementation, checks,
release, and the live signed-out homepage. Signed-in Home retains its current
layout until its separate drawing is approved.

## Approved surface

- Lead with the public-record introduction and money card.
- Replace the general legislative lists and duplicate searches with Bills and votes.
- Remove the signed-out Find My Legislator body section; keep shared navigation.
- Put phone news immediately before the footer, using HF 4138 and SF 856 records.
- Keep the editorial answer example on desktop and tablet only.
- Keep the current Money, Search, Blog, About navigation and its tablet drawer.
- Make each invitation card 1 link, with visible keyboard focus and fine-pointer
  hover. Reduced-motion preferences disable its lift.
- Use the approved white outlined Sign in button on signed-out Home.

## Holds

Campaign services is implemented behind `HOME_SERVICES_READY = false` until
`/services` works. Candidate lookup is absent until its owner supplies working
public `/candidates` search and supported filing coverage. This build does not
create either destination or change candidate storage. A later Search menu copy
recommendation is advice, not part of this build.

Eugene subsequently approved “Find my candidates” for the homepage build.
That wording is recorded for the held candidate feature; the destination readiness
gate remains in place.

## Finish sequence

1. Implement and review the isolated signed-out component, shared card option,
   initial HTML text, and Home behavior guide. Complete.
2. Run focused and full frontend checks and production export. Complete.
3. Exercise desktop, tablet, and phone, card links, hover, keyboard focus,
   navigation drawer, and sign-in dialog. Complete.
4. Accept an independent review and fix justified findings. Complete.
5. Commit, push, open a pull request, wait for current-head checks and the merge
   queue, then inspect the live homepage. Pending.

Keep this sequence current through the live result. Do not start a signed-in
redesign or a new Design request as part of this authorization.

## Acceptance evidence

- Full frontend suite: 300 files, 3,790 tests passed. New rendering coverage adds
  18 passing tests for card semantics, news identity/order, unavailable counts,
  destination holds, and signed-in card preservation.
- Chromium and WebKit: 7 homepage browser checks passed in each engine. Card
  descendants fit inside their cards at 320, 375, 400, 900, 1100, and 1600px.
- An independent browser review accepted those 6 widths, real money/bill/news
  destinations, keyboard focus and Enter activation, hover and reduced motion,
  sign-in dialog focus recovery, and the tablet navigation drawer.
- The public-record check confirms every editorial example fact. Production
  export, type checks, formatting, and package compatibility checks pass.
- Local acceptance uses port 8947, serving this worktree's exported frontend.
  Production CORS excludes this local origin. Browser acceptance passes exact
  read-only public API responses through locally, without changing records or
  production settings. Live acceptance must use the deployed origin directly.
- The phone card initially collapsed to its padding height. Intrinsic sizing
  corrects it, and saved browser containment checks cover the regression.
