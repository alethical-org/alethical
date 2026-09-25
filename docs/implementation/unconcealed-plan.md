# Unconcealed implementation

Net: Authorized build owns signup, separate email consent, unsubscribe and a manual email template through release. Real reader email sends remain disabled.

Source: [Unconcealed email requirements](../product-onboarding/unconcealed-email-spec.md). Tracking: [issue 2375](https://github.com/alethical-org/alethical/issues/2375). User said “build” on 25 September 2026. Branch `codex/unconcealed-signup`, checkout `/Users/eug/.codex/worktrees/38d5/Alethical`.

## Sequence and ownership

1. Lead: additive database tables, explicit versioned preference API, browser-bound intent, public stop endpoints and concurrency tests.
2. Frontend helper: approved v9 screens, existing account flow continuation, routes/menu, responsive hover/focus tests. Owns `apps/frontend`.
3. Email helper: approved email renderer, guarded manual delivery command and focused tests. Owns `alethical/api/services/unconcealed_email.py`, `scripts/send_unconcealed.py`, `alethical/tests/test_unconcealed_email.py`.
4. Lead: integrate, test auth/account boundaries and browser flows, obtain independent review, fix findings.
5. Lead: commit, PR, current-head checks, merge, deployment, safe live checks. Keep send switch disabled. Record sender/address activation dependency precisely.

## Progress

- Reviewed v9 with v6 behavior and settled corrections; sent user the complete Design update prompt while building.
- Own clean branch started from current main. No competing subscription PR found. Existing account-menu focus PR may overlap; preserve its behavior.
- Database/API and manual email implementation complete. 33 focused server tests pass, including real PostgreSQL concurrency and migration round trip. Full server suite passes all 3,374 tests on the released commit.
- Browser acceptance corrections applied: web fonts, checkbox state and Space key, phone save width, heading focus, hover, private headers and analytics exclusion.
- Signed-out reader flows pass at 320/390/1440 widths. Real local API subscribe, separate feature consent, saved reload, read-only stop-link opening and research/all stop pass. Intent outage fallback reaches account settings. All 3,577 frontend tests, TypeScript, formatting and release build pass. Final browser check confirms heading focus and return to the invitation on close. Release checks and deployment passed; live acceptance is recorded below.
- Shared naming correction merged in https://github.com/euglopi/tool-settings/pull/38. Exact task title restored: Money email signup & newsletter.
- Real production read-only confirmed-email case mismatch count is 0. No subscription or send writes in production.

## API contract

All endpoints return `{data: ...}`. `GET /api/v1/me/email-preferences`: account_id, email, nullable research/features, version. `POST` same URL: changed research/features booleans, expected_version, expected_account_id, expected_email, UUID idempotency_key, source confirmation/preferences. 409 means reload and fresh explicit consent. Confirmation must explicitly set research true.

Anonymous `POST /api/v1/email-subscriptions/intent`: browser_key -> reference, fixed return_to /money. Signed-in `POST /api/v1/me/email-subscription-intent/complete`: reference, browser_key -> show_confirmation true, fixed return_to /money. No subscription writes.

Public `POST /api/v1/email-subscriptions/unsubscribe/inspect`: token -> valid true. `POST /api/v1/email-subscriptions/unsubscribe`: token, action research/all -> unsubscribed true, action. Invalid token 404. `POST /api/v1/email-subscriptions/one-click/{token}` accepts RFC8058 form body and stops research only. Footer token in fragment, no email address.

## Release checkpoint

- Signup [pull request 2376](https://github.com/alethical-org/alethical/pull/2376) is live. Website and API both reported merged commit `b3f01642`; readiness and private endpoint checks passed. Independent signed-out desktop/phone review passed the signup, account creation, preferences dismissal and unsubscribe recovery flows. Public research remains readable.
- A newly available image-size fix ended the old build-only exception. [Pull request 2378](https://github.com/alethical-org/alethical/pull/2378) upgrades Metro’s image reader and preserves file input with a tested buffer bridge. It merged first; the signup release includes the identical repair. Both release builds pass.
- One-click unsubscribe runs its potentially waiting database write off the event loop; all 21 subscription tests pass after this last correction. All required current-head and merge-queue checks passed before release.

- Final live review caught missing hover feedback on the shared sign-in Close button. The follow-up applies the v9 pale background and dark icon to all shared Close variants, preserving focus/press behavior and suppressing hover on touch devices. Browser checks cover desktop, narrow screens, leaving hover, keyboard dismissal and touch dismissal.


## Next build list, requested 25 September 2026

Status: settled corrections implemented and locally tested; release pending. Eugene authorized removing the email controls' mouse-click outlines, asked Design to draw the keyboard states, and asked that Design receive the full remaining build list. The settled wording and stable saving corrections proceed with the pointer correction; the returned keyboard drawing has been reviewed, and its checkbox-row spacing is included.

- [x] Change the sign-in helper from the Unconcealed invitation to **Sign in or create an account to get Unconcealed research by email**. Carry the exact wording into the owning requirements and relevant checks when building. This changes the helper sentence, not the title or button labels.
- [x] Remove the purple focus outline caused by mouse clicks or touch taps on Unconcealed email choices and action buttons. Keep a visible, fully contained keyboard-focus indicator. The supplied screenshot shows the optional features checkbox row with only its top and bottom purple outline visible; correct the clipping as well as when the outline appears. The unconditional local focus style was removed; the app’s input-aware keyboard marker remains. Explicitly include both rows on `/email-preferences`: **Unconcealed research** and **New features and services**, plus **Save email preferences**. Eugene’s additional screenshots show a purple rectangle around each clicked row. Remove this pointer-triggered outline in checked, unchecked and unsaved states while retaining visible keyboard focus and the **Not saved yet** feedback.
- [x] Reproduce and fix the reported brief purple-outlined element after pressing **Subscribe to Unconcealed**, through saving and the success screen. The screenshot cannot establish which element flashes. Inspect the actual transition before choosing the fix; keep the saving words, success announcement, and appropriate keyboard/screen-reader focus. Test locally with mocked responses or isolated test data, never by subscribing a real reader or sending email.

- [x] Apply the pointer-focus correction wherever the shared email controls appear: the `/money` invitation and Email preferences button, the subscription dialog’s choices/actions and success buttons, `/email-preferences` choices/save/reload/retry, and `/unsubscribe` stop/retry buttons. The shared component applies an outline on every focus event; this establishes the common cause, not a claim that every screen was reproduced in a browser. Preserve independent keyboard focus and leave unrelated text-field focus styling alone.
- [x] Keep **Save email preferences** at the same responsive width, height and position through **Saving…**, restored **Save email preferences**, and **Try again**. The screenshot shows the shorter saving label shrinking the desktop button; current code sizes desktop buttons from their label. Reserve the original button label’s space rather than hard-coding a desktop width onto phone layouts. Keep the existing full-width phone treatment, and block repeat submissions while saving.
- [x] Reserve space for **✓ Your email preferences are saved** before saving starts, so the confirmation does not shift the button, surrounding content or footer when it appears. Preserve the approved placement beside the button where it fits and below on narrow screens. Show and politely announce confirmation only after the server confirms the save. Do not force a minimum saving time or add a width animation to mask the jump. Recheck the already full-width invitation, subscribe and unsubscribe buttons for stable dimensions during their changing labels; do not report their shrinkage as observed without reproducing it.

Scope clarification, 25 September 2026: Eugene explicitly keeps the purple outline around the campaign-money contribution expand/collapse arrow shown at `/legislators/aaron-repinski?tab=money`. Do not change that control or generalize the email pointer-focus fix to all purple outlines. The email correction removes mouse/touch-triggered rings; keyboard navigation must still have a visible focus marker. No alternative keyboard-focus visual has been approved by this clarification.

Design update, 25 September 2026: the complete remaining list, already-shipped white research card and invitation wording, interaction distinctions, and shared review/build rules were sent to the existing Alethical UX Design project. Design was asked to update its saved project instructions and show the new keyboard drawings in the project, without generating another downloadable handoff. The current keyboard marker remains until a new treatment is reviewed. Preserve the separate, intentional contribution-arrow pointer outline. Do not expand this work into the account-menu redraw or unrelated sitewide hover work.

Acceptance: the approved helper reads exactly as specified; clicking or tapping does not add a purple outline or cause a purple flash during the saving/success transition; Tab navigation still shows an unclipped focus indicator; Space/Enter, success announcements, failure/retry and dismissal still work at phone and desktop widths. Preserve the approved colours, spacing and other screen content. Test immediate and delayed saves, failure/retry, wrapped status text and repeat edits; the save button and reserved confirmation area must not jump between states.


## Follow-up acceptance evidence

- 52 focused unit checks and TypeScript pass. Independent browser acceptance passes 20 Chromium checks at 1280px, 390px and 320px with isolated fake accounts and intercepted API calls. Checks cover mouse, touch, keyboard, immediate and delayed saves, failure/retry, repeat-submit prevention, announcements, close/back focus return, unsubscribe, stable button/footer positions and no narrow-screen scroll jump.
- Removing a wrapped unsaved badge also shortened the phone card. The build preserves its pre-save height until the width changes, lets content grow, and prevents browser scroll anchoring on changing card text.
- The completed direct follow-up corrected `Unconcealed keyboard states.dc.html`: locked controls remain keyboard-reachable, button/status space follows wrapped content, and proposed pressed colours and a spinner remain outside this build. Visual review accepts the 10px checkbox-row radius and 12px side padding with matching negative margins. Existing keyboard marker colour and thickness stay. Direct inspection of Design's saved eug-8/eug-9 confirms the hover, input-aware focus, steady action states, spacing and review-annotation requirements. Design generated an export despite the explicit no-download instruction, citing a conflicting saved rule.
- A failed save may add the approved error text above Save. Once shown, its naturally wrapping space stays through retry and success, preventing another button jump. The reserved notice is hidden from assistive technology. Browser checks compare retry, saving and success positions.
