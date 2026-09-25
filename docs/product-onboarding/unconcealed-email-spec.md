<!-- describes: alethical/api/services/email_subscriptions.py, alethical/api/services/unconcealed_email.py, alethical/api/routers/email_subscriptions.py, scripts/send_unconcealed.py, apps/frontend/src/components/email/**, apps/frontend/src/screens/redesign/EmailPreferencesScreen.tsx, apps/frontend/src/screens/redesign/UnsubscribeScreen.tsx, apps/frontend/src/data/emailSubscriptions.ts, apps/frontend/src/lib/emailSubscriptionIntent.ts -->

# Unconcealed email signup

Net: Readers register through the existing Alethical account flow, then explicitly choose research emails delivered to their account address.

Approved by Eugene on 25 September 2026: build after review of Alethical UX (9).zip. The v9 drawings own visual direction; v6 build facts supply the full behavior, with the corrections below. The Design update prompt was supplied while implementation proceeded. [Issue 2375](https://github.com/alethical-org/alethical/issues/2375) tracks delivery.

## Reader flow

The dark invitation is the first item in Research at `/money`, above the article. Existing search, 6 record cards and public information stay available. Existing responsive bands switch at 768 and 1100 pixels. Invitation-to-article gaps are 28px on tablet/desktop and 24px on phone.

Print these words verbatim. Copy improvements can be proposed separately with a reason; do not substitute them silently.

- Heading: **Unconcealed**
- Descriptor: **Minnesota campaign money and lobbying research**
- Body: **We’ll email you about new research. Every piece is free to read on Alethical.**
- Invitation: **Get Unconcealed by email**
- Signed-out helper: **Create a free account or sign in**
- Subscribed: **You’re subscribed to Unconcealed** followed by **Email preferences**, 20px below.
- Sign-in helper from this invitation: **Sign in or create an account to get Unconcealed by email**
- Create helper from this invitation: **Create your free account, then subscribe to Unconcealed**

The existing sign-in controls and heading opening focus remain. The green review highlight around helper text is not product styling. The return from Google is fixed to `/money`; no caller-supplied return URL. A browser-bound, server-held intent lasts 30 minutes and survives account creation. It only opens confirmation and cannot grant consent.

Confirmation is a 460px dialog at 768px and above, a bottom sheet below. It shows **Get Unconcealed by email**, **SEND TO**, the read-only wrapping account address, **Also email me about new Alethical features and services**, **Subscribe to Unconcealed**, and **Unsubscribe at any time**. Retain a saved features choice; a never-set choice displays unchecked. Reserve at least 66px for the optional row while **Loading email preferences…**. Failed loads show **We couldn’t load your email preferences** and **Try again**, without a guessed checkbox or enabled Subscribe.

Signing in, account creation, viewing, and closing before submitting never subscribe. Closing after submission does not cancel a request. Saving says **Saving…** and retains focus with aria-disabled. An uncertain result says **You’re signed in, but we couldn’t confirm your email choices were saved**; **Try again** repeats the exact values and request key. Success comes only from a server-returned record, focuses **You’re subscribed to Unconcealed**, and offers **Back to Money in politics** and **Email preferences**. An already subscribed reader sees success without a write.

## Preferences and unsubscribe

`/email-preferences` requires sign-in and uses a 680px maximum content width. The account menu entry follows the existing dynamic Set password / Change password entry. Users and Metrics remain administrator-only links. Darken the small Admin label to at least 4.5:1 contrast.

- **Email preferences**, **SEND TO**, read-only account email.
- **Unconcealed research** with **About Minnesota campaign money and lobbying** inside its clickable label.
- **New features and services**, no redundant explanation.
- **Save email preferences**; changed rows **Not saved yet**; uncertain rows **Not confirmed**.
- A load failure offers **Try again** and no editable choices. Account changes discard old addresses, choices and pending callbacks.

Each purpose is nullable (never chosen), true or false, with last-change time and source. Save only purpose fields the reader explicitly changed. An account-row lock serializes writes. Each save carries the version, account ID and email address read, plus a unique request key. The server compares identity and email under the account lock and rejects a changed account or address. New positive choices require a verified sign-in identity matching the current account email; stopping emails remains available without that check. Stale writes fail and require reloading followed by a fresh explicit choice. A retry of an already-applied write returns current truth and never replays consent over a later unsubscribe.

`/unsubscribe` is public. Tokens are random, stored as hashes, revocable and not time-expiring. Opening the page changes nothing, reveals no address, and requires no sign-in. **Unsubscribe from Unconcealed** stops research; **Stop all research and feature emails** stops both. Repeat stops succeed. Security and password emails remain independent and accounts remain open.

Invalid links: **We couldn’t open your unsubscribe request**. An uncertain submitted stop: **We couldn’t confirm whether you were unsubscribed** with **Try again** repeating the same action. Failure includes Contact us and printed **ask@alethical.com**. Busy status is **Unsubscribing…**. Reserve enough height for the tallest state, preserving padding and wrapped text rather than imposing the inaccurate 330px annotation. Email one-click headers use a separate research-only POST accepting URL-encoded and multipart forms; a GET never unsubscribes. Footer links use `/unsubscribe#unsubscribe=<token>`; the browser removes the fragment after capture. Never use `#token=`, which the existing sign-in flow reserves for authentication.

## Interaction

Apply the v9 hover treatments only to pointer hover; busy/disabled buttons cannot suggest availability. Purple #7c5cff 2px focus ring remains independent. Touch does not retain hover. Preserve shared account/sign-in hover scope. Research card gains border/shadow, no lift; record cards retain 3px lift except with reduced motion. Match all v9 colours and padding; no new aesthetic choices.

Close, Escape and outside press dismiss confirmation, with focus returned to invitation or heading after Google. Status messages are polite; errors are alerts. Touch targets are at least 44px; sheet buttons 54px. Long addresses wrap. Loading/ready/saving should hold space; uncertain-result text may add space.

## Research email and administration

Research is publicly readable and indexable. The email provides convenience, with no promised schedule. Publishing never sends automatically. A person selects an approved published research article and reviews a dry run before invoking a live send. Email contains the exact published title, publication date, records-through date, and public URL, no summaries, figures, quotations or images. HTML matches the supplied 600px layout with a readable plain-text alternative. Narrow screens use a full-width button and 44px stacked footer links. Footer: Unsubscribe, Email preferences, Contact us (mailto:ask@alethical.com); no repeated printed contact address.

Use existing Resend service capabilities, with open/click tracking disabled and verified sender domain. Research recipients must have explicit active consent, an active account and a verified current account email. Recheck consent before each delivery. Durable unique article/account delivery records prevent duplicate sends; uncertain sends stop for reconciliation rather than automatic replay. Honour provider suppression. A confirmed suppression skips that recipient; an unavailable suppression check stops the campaign. Pace provider requests at least 600ms apart, leaving room for account emails. No automated import/post trigger and no analytics pixels or redirect tracking.

**Real delivery stays off during implementation and release checks.** Sender name/address and verified postal address are required before the first send and must not be invented. These activation details do not block signup and preference release. Test with mocks and generated previews, never by sending to readers.

## Completion checks

Backend: anonymous denial on preferences; independent account records; new account choices unset; browser-bound intent expiry/replay isolation; version conflict; repeated-key payload conflict; applied retry after unsubscribe; concurrent save/stop ordering; invalid/revoked link; GET read-only; repeated and one-click stops; no cache of private/error responses; migration upgrade/downgrade/upgrade in disposable PostgreSQL.

Frontend: signed-out and signed-in invitation; account creation/password/Google continuation; close before/after submission; optional-choice retention; loading failure; uncertain-save retry; stale-write reload; account switch; public unsubscribe; keyboard focus/Escape; phone/tablet/desktop wrapping; pointer/touch/disabled hover; reduced motion. Existing auth callbacks must never be exposed in test output.

Email: escaped HTML and plain text; exact publication fields; no tracking/images; live switch/sender/address/domain/suppression guards; public publication verification; duplicate/uncertain delivery behavior. Browser email preview cannot establish exact rendering in every mail app.

## Manual operator preparation

Run `uv run python scripts/send_unconcealed.py <published-research-slug> --target production` to check the public title, canonical address, publication date and records-through date and count eligible readers. This command sends nothing. With the approved sender and postal address supplied, add `--preview-dir <directory>` to produce HTML/text previews and a content hash.

Review both previews before using `--send --confirm-slug <same-slug> --reviewed-content-hash <hash>`. Live delivery also requires `ALETHICAL_UNCONCEALED_SEND_ENABLED=true`, the existing Resend transport/key, `ALETHICAL_UNCONCEALED_FROM`, `ALETHICAL_UNCONCEALED_POSTAL_ADDRESS`, and `ALETHICAL_UNCONCEALED_RESEND_DOMAIN_ID`. These settings remain unset/disabled for this release. Publishing an article never invokes this command.

Before activation, confirm the actual sender/postal address, Resend domain verification and disabled open/click tracking, receipt of both unsubscribe headers inside the DKIM-signed header set, and public access to the exact one-click API address. Test provider suppression lookup with known suppressed and clean test addresses. Do not send to readers to prove setup. The API follows [Resend suppression lookup](https://resend.com/docs/api-reference/suppressions/get-suppression), [domain settings](https://resend.com/docs/api-reference/domains/get-domain), and [usage limits](https://resend.com/docs/api-reference/rate-limit).

A sending/unknown/blocked delivery stops reruns for that article. Reconcile the saved delivery ID and provider logs before changing its state. Never delete the delivery record or rerun under a new article key to escape an uncertain outcome. Accepted means Resend accepted the request, not proof of inbox delivery. The sender does not retry uncertain requests and does not rely on provider idempotency beyond its retention window.
