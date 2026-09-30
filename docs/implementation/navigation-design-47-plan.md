# Navigation design 47 delivery

User authorization: “bd and things you missed in the first build”, 30 September 2026.

Pinned input: Alethical UX (47).zip, downloaded 30 September 2026 18:17 EDT.
SHA-256: dde3d5f86ae471b5b6034f160827a621c0c34a7ee8eff309a816a2e42d791bf5.
The bundle is retained outside the repository as the temporary visual reference.

## Scope and precedence

- Preserve the explicitly restored right-aligned desktop navigation.
- Apply the revised About label/icon/content width, dropdown states, drawer geometry, and bar/drawer Sign in treatments.
- Account menu icons.dc.html explicitly preserves existing menu geometry and identity while setting uniform action labels and icons; it takes precedence over older account details in LIVE Nav.dc.html.
- Preserve Tracked's combined bill/committee count, actual password-method wording, administrator permission checks and routes, and established error/retry/focus behavior.
- Updated authorization: Eugene corrected candidate lookup to a public page and said go in the candidate lookup task. Add the active /candidates row and NEW badge, remove its roadmap pill, and wait for the candidate owner's public-route release before merging. Real record availability and claims remain separate holds.
- Tablet remains the existing 366px right panel with bar account access, per build-facts-nav.md.
- Email preferences is a linked reference, not a new page redesign in this navigation build.
- The separately owned Services header release is outside shared TopNav scope.

## Delivery sequence

1. Complete: compared every pictured navigation/account state and implemented the settled differences.
2. Complete: types, formatting and focused checks pass. Browser comparisons cover desktop 1100+, tablet 820/900, phone 390/375 and short phone 320; hover/focus, scroll, sign-in dismissal, account permissions/count/password states, and stable sign-out failure/retry/success. Full upload checks passed 3,893 frontend tests and 3,519 backend tests. The independent account review then caught tablet sheet labels using the phone size; the tablet-only correction passes 41 focused account tests and retains existing sheet geometry. The final upload repeats required checks.
3. Complete: independent browser acceptance reports matching desktop/dropdown/drawer geometry and working navigation, including 320px short screens. No material defect remains.
4. In progress: [pull request 2451](https://github.com/alethical-org/alethical/pull/2451) holds the release and full comparison record. Required current-head checks, the candidate public-route merge in [pull request 2450](https://github.com/alethical-org/alethical/pull/2450), merge queue, deployment, live reader checks and release report remain. Final release evidence will be attached to the pull request.

Public candidate release correction: the temporary destination supplies official ballot
information and no address form. Its Search description therefore says “Find official
ballot information for your area”. The candidate owner accepted this correction on
30 September; address-entry wording remains contingent on working source-backed lookup.

Do not call the work finished before step 4. Preserve the candidate-route release dependency and real-data/claim holds through release.

## Acceptance evidence

- About drawing and build both measure 267.0703 × 218 CSS pixels; rows are 64px high and labels 17px.
- Search opens with grey wording and green up-arrow. Mouse clicks add no keyboard outline; Tab shows the purple 2px outline and Escape returns it to Search.
- Phone header has a 22px inset and 44px Close control. Short screens scroll all roadmap items above the fixed footer.
- Account action labels are 16px on desktop/tablet and 18px on phone. Combined tracked count 12 is 7 bills + 5 committees; unknown/zero suppress the number.
- Sign-out button positions remain unchanged during failure and retry on desktop and phone; busy blocks repeat submission; success removes the fake signed-in controls.
- Browser account checks use actual components with fake providers, without real authentication or service writes.
