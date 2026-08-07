# Handoff — Sign-in experience (Google SSO only)

**New work.** One reusable, intent-aware sign-in component: centered **modal overlay** on web, a
**bottom sheet** on mobile. **Google SSO only** — no email/password, no separate sign-up step
(the account is created implicitly on first sign-in). Sign-in is a **full-page redirect** to
Google: on success the user returns silently to where they were headed; on failure they return
with the modal reopened in an error state.

## What's in this bundle
- `Sign in.dc.html` — the reference design. Shows BOTH surfaces (web overlay + mobile sheet) and
  every state via the preview bands (INTENT × STATE), plus the **signed-in account control** (web
  nav dropdown, mobile nav bottom sheet, mobile drawer footer) under its own ACCOUNT band.
  Authoritative for the **design**; the bands and the faux pages behind the modals are mock
  scaffolding, not product UI.

## Intents (icon + headline + subcopy adapt per intent)
- **Nav (generic, Alethical mark)** — "Sign in to Alethical"; return to the same page (or tracked-bills list).
- **Track a bill (bell)** — "Sign in to track this bill" (names the bill); on success, auto-complete the
  track and return to the bill — no second click.
There is no third intent. Account cards use the generic nav intent. Vote records are not gated.
Any future gated action must get its own specified glyph before it is added.

## States
Idle · Connecting (BOTH surfaces: the Google button disabled with a spinner replacing the label —
mobile web uses the same full-page redirect as desktop; the sheet's "Waiting for Google…" panel is
kept in the reference as a NATIVE-APP-ONLY future variant, not shipped) · Error · network/auth
("Try again") · Error · cancelled/closed ("Sign-in didn't finish…") · Already signed in (skip
Google → Continue + "Use a different account"; ideally just proceed without showing the modal).

## Behavior
- **Silent return** — no confirmation screen; resolve the pending Track action
  then navigate to the return target.
- **One Terms of Use / Privacy Policy line** under the button — **no terminal period** ("By
  continuing you agree to our Terms of Use and Privacy Policy"): it's a one-line caption bound to
  the button, so it follows our no-period caption rule. The separate "we only save what you track"
  trust line was REMOVED — the headline/subcopy already state what sign-in does, and two grey
  reassurance lines under one button was one too many; the Privacy Policy link carries the
  commitment.

## Accessibility (required)
Focus trap; focus into dialog on open, restore to trigger on close; Esc closes; `role="dialog"` +
`aria-labelledby` the headline; error banner `role="alert"`; real labelled buttons; visible focus
ring `#7c5cff`; honor `prefers-reduced-motion` for the sheet slide + spinner.

## Locked decisions (agreed with Claude Code, Aug 5 2026)
- **Gate scope: BILL TRACKING ONLY.** Vote records remain public and there is no votes sign-in
  intent. The icon tile is neutral; the generic intent uses the Alethical mark and Track uses a bell.
- **No "Account" row in the account menus.** The built Account page is pre-redesign, fixture-wired,
  and its URL redirects home — a row would point at a broken surface. Menus are header + divider +
  Sign out only. Follow-on (when a rebuilt Account page ships): one "Account" row above Sign out in
  the web dropdown + mobile account sheet, and the drawer footer row becomes tappable.
- **Connecting is the button spinner on both surfaces** (mobile = phone web browser, same
  redirect). The sheet waiting panel is retained for a future native app only.

## Deviation
You may deviate with good reason (component reality, a Google Identity constraint, a11y, a better
in-repo pattern, a place the spec is silent) — but **list every deviation** (what the spec said,
what you did, why) in your final response.
