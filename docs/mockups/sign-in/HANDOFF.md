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
- **Nav (generic, Alethical mark)** — "Sign in to Alethical"; used only by plain Sign in controls in
  the navigation and generic account cards.
- **Track a bill (bell)** — "Sign in to track this bill"; used by every signed-out Track control and
  by the signed-out prompt on the tracked-bills page. Name the bill when the caller knows it.
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

## Track control — the third form (new)
The button has two honest forms (`+ Track`, `✓ Tracked`); the third covers the window after the
sign-in redirect when the app hasn't yet retrieved what this person tracks.

- **Same black pill, no words.** A small white spinner centred in the same black box at **62%
  opacity**, `disabled`, `aria-busy="true"`, `aria-label="Checking your tracked bills"`. Any label
  would assert a state, so the label is what goes.
- **Footprint fixed for ALL three forms** — min-width set **above** each size's widest shipped form
  ("✓ Tracked"), content centred: **128 × 46** desktop bill page (widest 127.31; explicit `height`,
  not min-height — a 16px/600 label makes a taller line box than an 18px spinner, so a min-height
  binds on the spinner form only and the box shrinks 1.5px on resolve), **112 × 44** phone bill page
  (107.48), **124 × 44** compact/cards (116.28). Measure all three forms after building and confirm
  identical. **Radius: 12** desktop bill page, **10** phone bill page, **10** compact.
- **The label swap moves the box 16–18px in every size** (compact 100.13 → 116.28px), so the lock
  isn't only a post-sign-in fix: it removes a sideways shove on every ordinary track and untrack, on
  every row of every list.
- **Threshold — on the spinner, not the state.** The state is unconditional: never claim `+ Track`
  before it knows, so the dimmed box shows from the first frame. The spinner waits **~300ms** —
  motion that appears and vanishes faster reads as a flicker, ten times over on a ten-card list. If
  the measured window is consistently under ~150ms, keep the spinner behind the threshold and let the
  number decide.
- Preview band **TRACK FORM**: `+ Track · ✓ Tracked · Unknown (checking)`, all three sizes side by
  side with each locked box labelled.

## When the check fails outright — the fourth form
The tracked-list request does not retry, so one network blip means the button would sit in the
checking form forever. The answer is a **composite**: the page carries the sentence once, the button
carries the way out.

- **The button is the OUTLINE of the same box** — white fill, border `rgba(17,21,15,0.32)`, ink
  refresh glyph, **no label**, same 128×46 / 112×44 / 124×44. The control becomes a three-way system:
  filled black = we know · filled + dimmed = we're asking · **outlined = we don't know**. Nothing is
  asserted, it's a live control, and the footprint never moves.
- **One press refetches the whole list**, so every unknown button on the page resolves at once. Not
  per-row retries.
- **Page-level notice, once, neutral** (grey `#f7f8fa`, not red, `role="status"`): "We couldn't check
  which bills you're tracking. Everything about the bills themselves loaded normally — only your
  saved list is missing. [Check again]" — says the bill data is fine, never implies notification.
- **Not a "+ Track" fallback:** that asserts a state we haven't earned, and pressing it on an
  already-tracked bill would re-save instead of remove.
- **aria-label:** "Couldn't check whether you track this bill. Press to check again." Focusable, keeps
  the `#7c5cff` ring.
- **Signed-out is NOT unknown** — they track nothing, so `+ Track` is correct. Both the checking and
  failed forms are for a signed-in reader whose list hasn't arrived, and must not be generalised into
  a loading/error state.

## Deviation
You may deviate with good reason (component reality, a Google Identity constraint, a11y, a better
in-repo pattern, a place the spec is silent) — but **list every deviation** (what the spec said,
what you did, why) in your final response.
