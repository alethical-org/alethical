# The Track button's "couldn't check" form — verification shot for #1021

Frozen record. One screenshot from verifying
[#1021](https://github.com/alethical-org/alethical/issues/1021), kept because the state it
shows **cannot be reached by using the site**: `GET /me/tracked-bills` answers in about
144ms in production and does not retry, so the only way to see this is to make the request
fail. Here it was failed outright over the Chrome DevTools protocol.

`couldnt-check-desktop-1280px.png` — Search Bills at 1280px for a signed-in reader whose
watchlist request failed. Two halves of one treatment: the grey notice above the results
saying the bills themselves loaded fine and only the saved list is missing, with a **Check
again** action; and on the card, the Track button as the **outline** of the same box with a
refresh glyph and no words, at the same 124 × 44 it occupies in every other form.

Measured in the same run: background `rgb(255,255,255)`, border `rgba(17,21,15,0.32)`,
`tabindex="0"` and focusable (unlike the checking form, which is deliberately not), one
`svg` and no text, `aria-label="Couldn't check whether you track this bill. Press to check
again."` The notice is `role="status"` with `aria-live="polite"` on `rgb(247,248,250)` —
never red and never `role="alert"`, because nothing is broken and one thing is missing.

A dated record of one run, not a description of current behaviour, so it carries no
`describes:` comment. Which form shows is pinned by
`apps/frontend/src/lib/__tests__/trackedState.test.ts`, whose first three cases are the
signed-out ones.
