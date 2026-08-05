# The Track button's "checking" form — verification shot for #1013

Frozen record. One screenshot from verifying
[#1013](https://github.com/alethical-org/alethical/issues/1013), kept because the form it
shows **cannot be reached in ordinary use** and so cannot be re-found by browsing.

`GET /me/tracked-bills` answers in about 144ms while the bill's own request takes about
2,462ms, so the watchlist is normally known before the Track button paints. This form
appears only when that request is slow or failing. To photograph it, the request was held
back 2,500ms by intercepting it over the Chrome DevTools protocol.

`checking-form-desktop-1280px.png` — a search-results card at 1280px for a signed-in
reader, while the watchlist is held back. The Track button is the same ink box at the same
120×44 it occupies in both label states, dimmed to 62%, with no words and a white spinner.
The account control at the top right ("Ada") shows the reader is signed in, which is the
condition this form requires: a signed-out visitor tracks nothing, so they get "+ Track"
immediately and never see this.

Measured in the same run, at each of the three sizes, across all three forms:

| size | "+ Track" | "✓ Tracked" | checking |
| --- | --- | --- | --- |
| `web` (bill page desktop) | 128 × 46 | 128 × 46 | 128 × 46 |
| `mobile` (bill page phone, phone card) | 112 × 44 | 112 × 44 | 112 × 44 |
| `card` (search / home / Ask / tracked) | 120 × 44 | 120 × 44 | 120 × 44 |

Before the change the same buttons measured 108.86 → 127.31, 90.19 → 107.48 and
100.13 → 116.28, so each one grew 16 to 18px when its label flipped.

This is a dated record of one verification run, not a description of current behaviour, so
it carries no `describes:` comment and is not kept in step with the code. The logic behind
which form shows is pinned by `apps/frontend/src/lib/__tests__/trackedState.test.ts`,
whose first case is the signed-out one.
