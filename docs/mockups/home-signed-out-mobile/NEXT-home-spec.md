# Home screen — spec notes (design-side source of intent)

Applies to both the web home (`LIVE Home Signed Out v2 (web).dc.html`) and mobile home
(`LIVE Home mobile v3.dc.html`). The bills shown in the design are **illustrative placeholders** — the
rules below define how the real ones are chosen from ingested data.

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
