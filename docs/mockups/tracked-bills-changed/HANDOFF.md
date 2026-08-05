# Handoff — Tracked bills change-block eyebrow (colour reconcile + card decision)

**Reference reconciliation, no new design.** Answers Claude Code's three corrections to
`LIVE Tracked bills.dc.html`. Full prompt in `Prompts.dc.html` ("Tracked bills — change-block eyebrow
colour reconcile…").

## What's in this bundle
- `LIVE Tracked bills.dc.html` — the corrected reference.

Sample bills/dates are illustrative placeholder — do not reconcile or reproduce. Only the design and
the colour values below are authoritative.

## The change-block eyebrow sits on the pale-green panel `#f2fbf6`
Colours measure lower there than on white, so the eyebrow uses darker values than the general tokens.

1. **"MOVED" green = `#0f7a45`** (green700 / brand.forest, ~5.0 on the panel). The spec's `#149d5b` measures ~3.3 there and
   fails AA at 11px — **already correct in the reference**, no change.
2. **"· DATE NOT RECORDED" grey = `#656c66`** (ink300 / text.muted, ~5.05 on the panel). Chosen to
   equal the green's contrast so neither half of the eyebrow dominates. The spec's `#6f756f` measures
   ~4.42 there (just under AA at 11px). **Confirmed by Claude Code** as the shipped token; the
   reference was one digit off (`#666c66`) and is now synced. Panel-specific: `#6f756f` stays correct
   for faint grey on white.

## No-summary + undated + OMNIBUS card — decision: keep as built
When those three conditions land together, the green change block sits high (identity row → title →
straight into the block) and reads more prominently than on a summarised card. **That is correct, not
a defect** — the change is why the card is on the page, and an unsummarised bill has less to say above
it. Do not add filler to push the block down. Toning it would be a deliberate new tier applied to
every no-summary card, designed explicitly — not an inherited side effect.
