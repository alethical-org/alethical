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
