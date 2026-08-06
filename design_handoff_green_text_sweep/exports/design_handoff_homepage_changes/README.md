# Handoff — Homepage changes (excluding the Find My Legislator band)

Everything changed on the homepage since its last handoff, **except the Find My Legislator band**,
which is a separate thread (`design_handoff_home_finder`) — don't reconcile the two here.
Prompt in `Prompts.dc.html` ("Homepage — everything except the finder band").

## Files
`LIVE Home web signed in.dc.html` · `LIVE Home web signed out.dc.html` ·
`LIVE Home mobile signed in.dc.html` · `LIVE Home mobile signed out.dc.html`

Bills, names, counts and dates are illustrative placeholder — do not reconcile or reproduce.

## Raising a disagreement
Items marked **[EUGENE]** were requested or required by Eugene directly — **raise disagreements with
Eugene, not back through us.** Items marked **[US]** are ours; pushback on those belongs in your reply.

---

## 1 · [EUGENE] A "See more" link ends each bill group *(web only)*
The hero's "Or start from what's moving now →" delivers the reader into the section; they read the
five bills and the trail ends. Each group now offers its own continuation.

| After the last card in | Label |
|---|---|
| RECENTLY PASSED | **See more recently passed →** |
| RECENTLY INTRODUCED | **See more recently introduced →** |

**Treatment:** quiet text link, **not a button** — Libre Franklin 15px/700, `#0f7a45`, underline on
hover, 18px above, **right-aligned** to the card column's right edge (wrapper `div`,
`display:flex; justify-content:flex-end`). The "→" is the **text glyph** at weight 400,
`aria-hidden` — never a fixed-size SVG. Buttons were rejected: Track is this section's action and a
third button weight would compete with it.

Right rather than left: it matches the Session watch card's "All tracked bills →", so one pattern
means "more of this elsewhere"; a left-aligned link sits in the last card's own content column and
reads as that card's action rather than the group's continuation.

Both links are **named** — a bare "See more →" twice gives a screen-reader user two identical entries
in the link list with no way to tell them apart.

**Destinations — Bill Search pre-filtered, never an unfiltered list:**
- recently passed → status **Signed into Law**, sorted by most recent action
- recently introduced → sorted by **introduction date** (newest first)

### ⚠ Open question — blocks the second link
**Can Bill Search sort by introduction date (or filter by introduced-on)?** Filtering to Signed into
Law we're confident about. If neither exists the second link has no honest destination, and we'd
rather change the label than point it somewhere that isn't what it promises.

### [US] Mobile deliberately has no per-group links
Mobile renders **one card per group**, so two continuations would extend two cards, and the section
already ends with a full-width "Search Bills" button matching the section above it. Flagged because
web and mobile normally stay in sync — we believe this difference is genuinely layout-specific.

---

## 2 · [US] Contrast sweep — 56 green text values were failing AA *(all four files)*
Green **text** on light must be `#0f7a45` (green700). `#149d5b` measures ~3.5:1 on white and fails AA
below 18.66px bold — it is valid only as an **SVG stroke/fill**, where the bar is 3:1.

Swept every `color:#149d5b` → `#0f7a45`: **19** web signed-in, **19** web signed-out, **10** mobile
signed-in, **8** mobile signed-out. **55 SVG strokes deliberately left** at `#149d5b`.

Previously-shipped failures this fixes: Session watch "All tracked bills →" (14px), hero "Or start
from what's moving now →" (15px), every "Chief author:" line (13px), bill code badges SF 334 / HF 719
(13px), issue chips (12px), "2025–26 LEGISLATIVE SESSION" eyebrows. Token substitution only — expect a
colour-only diff, no layout movement.

---

## 3 · [EUGENE] Session watch state line — one possessive instead of two *(signed-in web + mobile)*
Before: *11 of the 14 bills you're tracking moved since you last opened your tracked bills on Mar 12*
After: **11 of your 14 tracked bills moved since you last opened the list on Mar 12**

"bills you're tracking" and "your tracked bills" are one fact stated twice. `your` can't simply be
deleted — "since you last opened tracked bills" is ungrammatical — so the first clause absorbs it and
the second refers back with **the list**. 91 → 74 characters, meaning unchanged.

Nothing-moved line follows the same rule: *Nothing has moved since you last opened the list on Mar 20 —
the most recent change was Mar 3*.

---

## Not changed
Hero structure, Session watch card layout, bill cards, Track buttons, section headings, eyebrows,
ordering, footer — and the **Find My Legislator band**, handled in its own handoff.
