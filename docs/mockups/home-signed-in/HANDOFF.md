# Handoff — Signed-in homepage (web)

**New work**, plus five corrections to the signed-out homepage. Read the prompt card in
`Prompts.dc.html` ("Signed-in homepage — same page, personalized hero") for the full rationale.

## What's in this bundle
- `LIVE Home web signed in.dc.html` — the signed-in reference. Four states in the preview band:
  **Tracking nothing · Bills moved · Nothing moved · Not asked yet · First visit**.
- `LIVE Home web signed out.dc.html` — the signed-out reference, now matching live.

Bills, dates, change sentences, and the name/email are **illustrative placeholder** — do not
reconcile or reproduce them. Only the design is authoritative.

## The framing decision: ONE homepage, not two
Everything below the hero is identical to the signed-out page — Bills Moving, Find My Legislator,
footer, nav. Only the **hero slot** changes: the marketing pitch + example answer card are replaced
by a personalized hero in the same two-column grid.

- **Not a separate page** — our only personal input is a list of tracked bills; a dashboard built
  from it would remove search, bill activity, and the finder to show less, and create a second
  homepage to keep in sync.
- **Not a band above the existing hero** — that leaves a signed-in person scrolling past a pitch
  that already worked, and stacks two heroes.

Build it as one homepage template whose hero region branches on auth. No `/home-signed-in` route.

## The signed-in hero
**Left — the STATE LINE is the headline, the greeting is a small eyebrow.** The state-dependent line
(what moved / checking / nothing moved / first look / not tracking) is the page's largest type — the
38px/800 `<h1>`, with its glyph (green trend arrow when something moved, grey clock when quiet, a
spinner while checking). Above it, **"Welcome back, {name}"** is a SMALL 18px/600 grey eyebrow — NOT
52–60px. Reasoning: the news is why someone returns, not being recognised, so the state line owns the
top slot; the greeting STAYS (not absent) because it carries return-warmth and a secondary account
confirmation in the reading flow (the corner account control isn't read as a greeting, and on a
shared device confirming which account you're in has real value) at negligible cost, and it gives a
stable anchor above a state line whose length swings a lot across the five states. Then the **same
two buttons** as signed out (Search Bills →, Search Legislators →) — no third button; the card and
nav already reach the tracked list.

**Right — "Session watch" card** (same footprint/radius/shadow as the answer card it replaces):
header = title + `All tracked bills →` (hidden when nothing is tracked), then up to **two** bill rows,
moved first — amber code badge (+ ghosted OMNIBUS chip), status label, title, then either the green
change block (identical to the tracked-bills page: `MOVED <DATE>` mono green + one plain sentence +
`N earlier steps since your last visit →`) or a plain `Latest action: … · date` line.

## States
1. **Tracking nothing** (most common first case, first-class frame): green bookmark tile,
   "Track your first bill", the mechanic in plain words, green **Search bills** button, and
   "Or start from what's moving now →" anchoring to the Bills Moving section. Never says we will
   notify or email — coming back *is* the mechanism.
2. **Bills moved:** e.g. "6 of the 12 bills you're tracking moved since you last opened your tracked
   bills on Mar 12." When the moved count exceeds the two rows shown, the card states the cap — see
   "When more moved than the card shows" below.
3. **Nothing moved:** dates the last change rather than reading as empty; the card still lists
   tracked bills with their latest action.
4. **First visit:** states plainly there is no "since" yet.
5. **Not asked yet (pending):** on a fresh load the homepage has not yet asked our records for the
   last-looked mark, so "no answer" means **not asked**, NOT *nothing moved*. Built the obvious way
   it would report *nothing moved* to someone whose bills all moved — false and reassuring. This
   frame shows **neither a change nor a reassurance**: a calm neutral spinner + "Checking for
   anything new since you last looked" over two shimmer skeleton rows (`aria-busy`); the hero line
   is "Checking your tracked bills for anything that's moved since you last looked" — no count, no
   date (the date is the unknown being fetched). Transient and **self-resolving** into state 2 or 3.
   - Distinct from **first visit** (which truthfully says nothing can have moved yet) and from the
     Track button's **"couldn't check" failure** (which means we *asked and it failed* — terminal,
     offers retry). Pending means we *never asked* — no retry, no error strip. Shares the calm
     "checking" visual language (neutral spinner = working, never an error colour) but is a separate
     state; honour `prefers-reduced-motion` (static caption + plain skeletons).

## When more moved than the card shows
The card shows **up to two** bills. Beside two rows, "2 of the 4 moved" is honest — the reader sees
everything the sentence counts. "6 of the 12 moved" (or "11 of the 14") beside two rows is NOT — the
two rows read as the whole set, and a reader walks away believing they've seen what moved while the
rest are invisible. So whenever the moved count exceeds the rows shown, the card states the cap
explicitly, right above the rows: **"Showing the 2 most recent of {N} that moved"** — the two rows are
labelled the most-recent subset, so nothing implies they are all of them. The header **"All tracked
bills →"** is the path to the rest.
- **Rows do NOT scale** — a card that grows to eleven rows overruns the hero and re-creates a second
  tracked-list. Two rows is the cap; the caption carries the truth about what's not shown.
- **One sentence shape at every count** — it reads correctly at "2 of 4" and "11 of 14" alike, so no
  threshold that could be got wrong. The reference draws the hard case: "11 of the 14 …".

## Limits designed to
Name, email, tracked bills — nothing more. No recommendations, inferred interests, ranked feed, or
district. No email/alert/bell/notification entry point. No vote counts in a change block. No
"close to passing", prediction, or importance ranking. Dateless variant
`MOVED · DATE NOT RECORDED` applies. The nav account control is inherited as built, not redesigned.

**Cut as requested:** resumed-answer card, Ask Chat, free-form question box, Find My Legislator city
buttons.

## Five corrections to the signed-out homepage
1. **City chip row deleted** (city can't determine a district); placeholder now "Enter your street
   address, city, and ZIP"; nav description now "See who represents you — **by street address**"
   (was "by address, city, or area" — a live string that promises precision we can't deliver).
2. **"Be in the Know" account card removed** — not on live, and its copy promised "keep chat history".
3. Hero subhead: "how **legislators** voted" (was "how everyone voted").
4. Answer card's **"BILL" divider label removed**; hairline stays.
5. Session eyebrow now **"2025–26 LEGISLATIVE SESSION"** to match live. **Live's short form is now our
   universal convention** — more concise wins — so every active screen has been swept from
   "2025–2026" to "2025–26" (and "2023–24" / "2021–22" for other ranges, "94th Legislature (2025–26)"
   where the Legislature is named). Nothing on live needs changing for this; it was already right.

## Accessibility
Focus ring `#7c5cff` on every control; account menu is a real button with `aria-haspopup`/
`aria-expanded`, Escape closes and restores focus to the trigger; glyphs are decorative beside real
text; honour `prefers-reduced-motion`.

## Deviation
Deviate with good reason (data reality, a11y, a better in-repo pattern, a place this spec is
silent) — but **list every deviation** (what the spec said, what you did, why) in your final response.
