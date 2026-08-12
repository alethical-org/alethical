# Home screen — spec notes (design-side source of intent)

Applies to both the web home (`LIVE Home Signed Out v2 (web).dc.html`) and mobile home
(`LIVE Home mobile v3.dc.html`). The bills shown in the design are **illustrative placeholders** — the
rules below define how the real ones are chosen from ingested data.

## Hero entry point — two search buttons, NOT a free-form Ask field
The hero's left column ends in **two entry buttons**, side by side (wrap to stacked in a narrow
column), replacing the earlier free-form Ask input + prompt-suggestion chips. Rationale: free-form
Ask is roadmap, not shipped; the input duplicated Bill Search below the fold and promised answers
we don't yet serve on-demand.
- **"Search Bills"** (magnifier icon) → the default Search Bills page (`/bills`, unfiltered
  landing state).
- **"Search Legislators"** (person icon) → the Search Legislators page.
- Each button: white surface, 1px border `rgba(17,21,15,0.12)`, radius 14px; leading icon + bold
  label (`#11150f`) + a trailing **"→" glyph** (U+2192, weight 400, green `#149d5b`) — the text
  glyph, never an SVG stub. **No description line.** Hover: border `rgba(45,212,126,0.55)` + soft
  shadow.
- **Coupled copy:** the subhead's final clause is **"with every claim linked to the official
  record"** — NOT "every answer linked to official sources". Once the Ask field is gone, "answer"
  copy promises an on-demand capability that no longer exists on the page.

## Hero answer card (demo/teaser) — anatomy + rules
The card on the right of the hero is an **illustrative demo** of grounded-answer output. Its bill
content (HF 4138, dates, votes, excerpts) is **placeholder** — do not reconcile or reproduce it;
only the design is authoritative.

The built card's facts are **literals, watched by a scheduled check** (2026-08-12,
[#1467](https://github.com/alethical-org/alethical/issues/1467)). Every value it shows was
verified against the ingested record, and `scripts/check_home_hero_card_literals.py` re-verifies
all of them monthly and on any PR touching the card, filing an issue when one drifts. One
correction to the mock's copy: the bolded act name "Stop Harms from Addictive Social Media Act"
is not HF 4138's title — the enacted text carries no "may be cited as" clause — so the built card
reads "Minnesota's **new law on minors' social media accounts**".

Anatomy, top → bottom:
1. Question headline.
2. Labeled **"BILL"** divider (mono eyebrow + hairline). This is the card's ONLY divider.
3. Bill row: **amber code badge** (links to our bill profile) + **two balanced meta columns** —
   left = Signed / Effective, right = Chief author / **House–Senate vote counts**.
4. Plain-language summary paragraph (heavier/darker type — reads as a new section on its own).
5. **"CITED SECTIONS"** header + green circle-check (✓). No statute number in the label.
6. Up to **3 cited-section cards**: **plain-language title only** + flush-left italic excerpt.
   No numbered chips and no decorative rule.

Rules:
- **No companion-bill line.** Votes live in the right meta column (keeps two balanced columns).
- **One divider only** — the labeled "BILL". No plain hairline between the bill facts and the
  summary; ~22px of space carries that shift instead.
- **Header** is "CITED SECTIONS" + green ✓ — the statute number is NOT in the label.
- **Section titles** are plain-language only — no "3(b) —" subsection-number prefixes (that detail
  is bill-profile territory).
- **Excerpts** are flush-left italic with **no surrounding quotation marks** (matches the bill
  profile's "From the bill").
- **Footer:** a single internal **"View bill profile →"** (green text link) to our bill profile.
  The external source-text link ("Read the full law" / "Read the bill text") lives on the bill
  profile, NOT here.
- **Color roles:** amber = bill-code identity; green = actions/links and the cited/verified ✓;
  purple = citation chips + focus.

## Bill Activity — data-driven (most recent), NOT curated
The cards under **Bill Activity** are selected automatically from the ingested bill data. The
designed bills (SF 1832, SF 2210, HF 88, …) are placeholders; do not hardcode them.

### Recently Passed
- **Population:** bills that have reached passage in the current legislative session — i.e. status
  is *Passed both chambers* **or** *Signed into Law* (enacted). Bills that only passed one chamber
  do NOT qualify.
- **Order:** by the date of the passage milestone, **descending** (most recent first). Use the
  signing date for signed/enacted bills; otherwise the date both chambers had passed it.
- **Count:** web shows the top **2**; mobile shows the top **1**. "See more" → Search Bills.

### Recently Introduced
- **Population:** bills in the current legislative session, ordered by **introduction date,
  descending** (most recently introduced first).
- **Count:** web shows the top **3**; mobile shows the top **1**. "See more" → Search Bills.

### Card meta line (both groups) — freshness vs. latest action
- If the most recent action text would merely **restate the status label** (e.g. status
  "Passed both chambers" + action "Passed both chambers"), show **"Updated {date}"** (freshness
  stamp) instead of a latest-action line. Date is grey, not bold.
- Otherwise show **"Latest action: {action} · {date}"** — the action bold/dark, the date grey.
  (This is why SF 1832 "Signed into Law" shows *Latest action: Signed by the Governor · {date}*,
  while SF 2210 "Passed both chambers" shows *Updated {date}*.)

## In the News — editorially curated (exactly what the editor defines)
The **In the News** cards are a **hand-picked, pinned list** set by an editor — NOT derived from
data or recency. Claude Code must treat this as a manually configured list of bill IDs (e.g. a
`inTheNews` / `featured` config), rendered in the order given.
- Current selection: **SF 3933** (Stop Harms from Addictive Feeds Act) and **SF 856**
  (Office of the Inspector General).
- Each card's status/meta line still reflects that bill's real data (status, dates), but the
  *inclusion and order* are editorial, not algorithmic.

## Navigation — "See more" / "See all"
Both home **"See more"** buttons (mobile: *In the News* and *Bill Activity*) link to the
**default Search Bills page** — the unfiltered landing state, with no pre-applied query, filter,
or scroll target. The web home's equivalent **"See all"** links behave the same.
