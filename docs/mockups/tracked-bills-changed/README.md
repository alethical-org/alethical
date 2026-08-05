# Mockup: Tracked bills — "what changed since you last looked"

The design reference this page was built from ([#1009](https://github.com/alethical-org/alethical/issues/1009),
shipped in [#1010](https://github.com/alethical-org/alethical/pull/1010)). Kept here as the
record of what was asked for, so a later change can tell a deliberate difference from a drift.

## Files

- `tracked-bills-changed.dc.html` — the design reference: the web page, the phone layout
  beneath it, and four states in its preview band (**Bills moved · Nothing moved · First
  visit · Nothing tracked**). Authored in HTML as a Design Component; it is a reference, not
  production code. `<sc-for>` / `<sc-if>` are loop / conditional and `{{ … }}` is a data
  binding.
- `HANDOFF.md` — the designer's own notes: the decisions, the declined items, and the exact
  colours and sizes.

**The bills, dates, statuses and change sentences in the reference are placeholder.** They
were never reconciled against the real corpus and must not be. Only the layout, the states,
the treatment, the ordering rules and the copy are authoritative.

## What the built page does differently, and why

Every difference from the reference, so nobody has to guess whether one was intended.

- **An undated change shows the eyebrow `MOVED` with no date.** The reference has no state
  for this because it assumes every change carries a date. `bill_action.action_at` is
  nullable and the Legislature genuinely files undated entries, so the choice was between
  hiding a real change and printing a date we do not have. Neither is acceptable, so the
  block reports the change and states no date. Decided in the issue, not here.
- **The earlier-steps link counts every classified change, not only the big ones.** The
  issue asked for "meaningful milestones". Counting only milestones makes the link disappear
  on a busy day — the exact day it exists for — and understates what happened. It counts the
  entries the shared timeline produces after it collapses an author run, a floor-passage
  cluster and the repeated signing rows into one each, so a seven-row day reads as the four
  things that happened. Pointers to other bills ("See also HF 2446") are left out: they are
  not steps this bill took.
- **The mono eyebrow and the earlier-steps link are `#0f7a45`, not the reference's
  `#149d5b`.** At 11px and 14px on the panel's green, `#149d5b` measures 3.27:1 — short of
  WCAG AA's 4.5:1 for small text. `#0f7a45` measures 5.05:1. The same call, for the same
  reason, as the omnibus token's own note in `apps/frontend/src/theme/tokens.ts`.
- **The panel uses the existing green tokens** (`tint.t50` `#f2f9f5`, `tint.t300` `#cbeed6`)
  rather than the reference's `#f2fbf6` / `#cdeedd`. The pairs are visually identical, and a
  near-duplicate palette entry is a thing that later drifts.
- **The count row has no "in the 2025–2026 Legislative Session" sub-label.** A watchlist can
  hold bills from more than one session, so one session name under a mixed list would be
  false — and the tracked-bills route does not serve each bill's session, so it cannot be
  checked. Dropped rather than asserted.
- **Dates carry the year** ("Mar 12, 2026", not "Mar 12"). This is a page people return to
  months apart.
