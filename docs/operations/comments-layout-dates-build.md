# Comments layout and article source dates

## Authorized outcome

Eugene instructed “build the pending build” after accepting the comment order in
`Alethical UX (35).zip`, identifying incorrect button typography and requesting
that repeated download dates leave article headings. Delivery includes the live
release and the existing review address, `http://localhost:8782/read`.

Scope: comments before the form, responsive rules placement, empty-state spacing,
shared bold button typography, hover/focus/busy checks, source-date placement and
saved prevention guidance. Preserve article claims, source evidence, publication
dates, authentication and email behavior. Unrelated wording changes bundled in
the design download are outside this release.

## Build and acceptance

- [x] Inspect the approved comment drawing and written behavior.
- [x] Keep source-copy dates in source material while shortening article metadata.
- [x] Record the layout and typography requirements and browser acceptance checks.
- [x] Finish comments implementation and review the helper's changes.
- [x] Run focused tests, the full frontend checks and a production build.
- [x] Exercise comment states against fictional accounts with delivery disabled.
- [x] Inspect desktop, tablet and phone in a browser, including Share placement.
- [x] Obtain a fresh reader's browser review and resolve material findings.
- Release checks, merge and live acceptance are recorded on
  [pull request 2416](https://github.com/alethical-org/alethical/pull/2416).

## Evidence

The source-date change leaves original editorial approval fingerprints and
calculation inputs intact. Initial HTML and the interactive article use the same
coverage formatter. Tests retain publication and reporting dates, retain the saved
source date, and confirm that publication checks still accept the article.

Comment browser checks must measure the font the browser actually selected,
including weight and size on portal dialogs. Local comments use only fictional
accounts and disabled email, following
[editorial-comments-guide.md](../product-onboarding/editorial-comments-guide.md).

## Continuation

Task-owned checkout: `/Users/eug/.codex/worktrees/comments-layout-dates/Alethical`.
Branch: `codex/comments-layout-dates`. The comments helper owns comment components
and their tests; the parent owns article rendering, documentation and release.
The preview on port 8782 reads the clean checkout at
`/Users/eug/.codex/worktrees/7c04/Alethical`; preserve its running process.

Browser acceptance passed at desktop, tablet and phone sizes. The full frontend
suite passed 3,774 tests in 300 files. Type, format, document references and build
tool checks passed. The existing generic sign-in explanation is tracked separately
in [issue 2415](https://github.com/alethical-org/alethical/issues/2415).

All 7 disposable Chromium comment browser tests passed, including sign-in entry,
post/reply/edit/name/delete flows and font, color, hover, busy and spacing checks.
Focused component tests passed 27 checks. The final production build passed.
