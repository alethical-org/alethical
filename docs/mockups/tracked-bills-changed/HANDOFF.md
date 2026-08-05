# Handoff — Tracked bills: "what changed since you last looked" (round 2)

**Round 2** — Claude Code's review is applied, plus two label cases that weren't in round 1
(omnibus, hot issue). The page keeps everything it has (eyebrow, "N bills" count, card stack with
status, 5-step progress bar, latest action + date). **Web + phone.**

## What's in this bundle
- `NEXT Tracked bills.dc.html` — the reference design. Web page on top, phone below, four states in
  the preview band: **Bills moved · Nothing moved · First visit · Nothing tracked**. The
  DECISIONS / DECLINED cards beside the phone are notes for you, not product UI.

Bills, dates, statuses, and change sentences are **illustrative placeholder** — do not reconcile or
reproduce them. Only the design is authoritative.

## The design

**1 · Per-bill change block (not a badge).** Soft green panel inside the existing card —
bg `#f2fbf6`, border `#cdeedd`, radius `12` — with a mono eyebrow **"MOVED MAR 19"** (`#149d5b`) and
one plain sentence naming what happened. Calm dated reporting, not an alert. **No vote tallies** —
the data carries actions and dates, not counts; numbers live on the bill's votes.

**2 · Anti-redundancy rule.** When a bill has moved, the card's separate **"Latest action:" row is
removed** — the change block states the same fact. Unmoved cards keep that row as today.

**3 · Earlier-steps line.** Several changes since a last visit is the normal case, so under the
sentence sits a quiet green text link — *"2 earlier steps since your last visit →"* (singular
*"1 earlier step"*) — opening the bill's full history. **Count only, no date range**: "since your
last visit" already states the range, a meaningful share of actions carry no date, and the
destination shows every date anyway. No badge, no count chip.

**4 · Page summary.** One dated caption under the count (no terminal period):
*"2 of the 4 bills you're tracking moved since your last visit on Mar 12"*. Trend glyph when
something moved, clock glyph when nothing did.

**5 · Ordering: grouped, moved first, one divider only.** The moved group carries **no header** — the
summary already says how many moved and since when, and each card states its own "MOVED <date>". The
only header is the grey mono **`NO CHANGE`** (no count) marking where unchanged bills begin. Most
recent change first within the moved group. Chosen over a sort control: nothing to discover,
self-explanatory, collapses to one plain list when nothing has moved.

**6 · Nothing moved** (the common case): no headers, no empty-state framing — *"Nothing has moved
since your last visit on Mar 20 — the most recent change was Mar 3"*.

**7 · First visit:** *"This is your first look at your tracked list, so there is no "since" yet —
from now on, anything that moves shows up here"*.

**8 · Track control — BLACK, both surfaces.** The shared `✓ Tracked` button: `#11150f` fill, white
text, `min-height:44px`, in the desktop card's right group and the phone card's top row. Black is
reserved for Track. **One button flips `+ Track` ↔ `✓ Tracked`; pressing again untracks** — no
separate untrack treatment.

## Omnibus + hot issue on the tracked card (new this round)
- **OMNIBUS** — *ghosted* amber chip: transparent bg, border `#e3c17f`, text `#a76a1a`, **interface
  typeface** (Libre Franklin) 11px/700, **radius 8** — matched to the shipped chip so all three
  surfaces stay identical. Sits immediately right of the **filled** amber code badge; ghosted is the
  rule whenever a filled code badge shares the context.
- **🔥 Hot issue** — *neutral* pill: bg `#f1f1f4`, border `rgba(17,21,15,0.08)`, text `#4f5651`,
  radius 999, nowrap. **Never amber** — an editorial flag, not a code. Gated on the same flag driving
  the homepage / search / bill profile, companions included.
- **Placement** — web: OMNIBUS in the left group by the code badge; hot issue on the right,
  immediately left of the Track button with a **16px** gap. **Phone: BOTH labels live in the left
  group** beside the code badge and the row wraps to a second line — the Track control keeps the
  right edge (it is the only interactive element there and needs a dependable position and a 44px
  target). The label group is `flex:1; min-width:0` and wraps internally; the button is `flex:none;
  margin-left:auto`, so its position never moves with the number of labels.
- **Both at once** is handled — SF 1832 carries both; neither competes with the green change block.

## Declined / out of scope
- **No filter control.** A watchlist is self-curated and short; the moved/no-change grouping answers
  the page's only question. Search is the right instrument if a list grows long.
- **No vote tallies** in the change block (data doesn't carry them).
- **Subhead drops the add-and-remove instruction** on purpose: `✓ Tracked` is now on every card on
  both surfaces, so the instruction labels a visible affordance. The empty state still explains how
  to add a first bill.

## Deviation
Deviate with good reason (data reality, a11y, a better in-repo pattern, a place this spec is
silent) — but **list every deviation** (what the spec said, what you did, why) in your final
response.
