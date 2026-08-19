<!-- describes: apps/frontend/src/screens/redesign/MoneyLandingScreen.tsx, apps/frontend/src/screens/redesign/MoneyReportsShelfScreen.tsx, apps/frontend/src/screens/redesign/MoneyReportScreen.tsx, apps/frontend/src/lib/moneyLanding.ts, apps/frontend/src/lib/moneyReports.ts, apps/frontend/src/navigation/ia.ts, apps/frontend/src/navigation/webRoutes.ts -->

# How the Campaign money section works

**Net.** `/money` is the public front door to Minnesota's campaign-money records, open to
everyone with no sign-in. In this first release it shows the shape of the whole section —
what exists, what is coming, and what the record does and does not cover — plus the shelf
where our own signed research reports appear once published. Nothing is published on that shelf
yet, and it says so.

## Ways in

- Choose **Search**, then **Campaign money** (marked with a green NEW chip) in the shared
  top menu, on a computer or in the phone menu.
- Open `/money` directly.
- The retired address `/track/campaign-finance` (an old greyed "Campaign Finance" tracking
  row pointed there) shows the `/money` landing instead of an error.

## The landing page (`/money`)

Top to bottom:

1. **Title and one sentence** saying what the record is: every contribution and expenditure
   Minnesota publishes for state campaigns.
2. **A search box that does not work yet**, and says so in plain words ("Search is not
   built yet."). It is drawn so a reader sees search is the plan; it cannot be typed into,
   because a working-looking box would be a promise.
3. **What we found** — the research lane, first in prominence. It links to the reports
   shelf. With nothing published it says "Nothing is published yet" and counts "0 REPORTS
   PUBLISHED" honestly.
4. **Three lane cards**: Legislators (links to the legislator directory — a member's money
   is a tab on the profile they already have), Committees, and Who got paid. The last two
   have no pages yet, so their cards are visibly not clickable, carry a "NOT BUILT YET"
   chip, and say "This page is not built yet." Every lane being visible — built or not —
   is a deliberate decision (Eugene, 18 Aug 2026), so a reader sees the whole shape of the
   section.
5. **What this record does not cover**: nothing before 2015; unions do not report to this
   board; and the exact sentence "Donors who gave $200 or less in total for the year are
   never named" (the $200 test is on a donor's yearly total, never on one gift's size).

Three more pieces bind to live data (two public endpoints:
`/api/v1/campaign-finance/summary` and `/api/v1/campaign-finance/filings`). Each data block
carries its own served state, so one gap never blanks the others, and a block that is not
served renders nothing rather than a number:

- The **files last copied** date — the page's one freshness date: when we last copied
  filings from the Board, not the period any money covers. Every served timestamp on these
  pages prints as its Minnesota (Central time) day, so an instant recorded just after
  midnight UTC reads as the evening it was in Minnesota.
- The **most recent completed filing period** — the newest filed reports, ordered by the
  period each report covers, never an amount and never a "filed on" date, because the
  Board's catalogue serves no filing date (storing a real one is
  [issue #1670](https://github.com/alethical-org/alethical/issues/1670)). More than a
  thousand filers can share one period end and the tie breaks alphabetically, so the module
  says plainly that its rows are the first by name, not the newest or the largest. The
  ordering sentence is derived from the feed's own ordering field through one mapping, so
  the words and the order cannot drift apart.
- The lanes' **live counts**: registered filers on the Committees lane, and sitting members
  on the Legislators lane, whose text also states how many members' committees a person has
  confirmed (0 of 200 today — a verified zero, shown as the number it is, because the
  confirmation log is ours and it is empty). A count that is not served does not appear; a
  null is our gap and never renders as 0.

While data loads, grey placeholder blocks pulse (the pulse stops for readers who asked
their device for reduced motion, and a hidden "Loading" note tells screen readers).

## The reports shelf (`/money/reports`)

The shelf for Alethical's own signed research on these records
([`.claude/rules/grounded-answers.md` rule 13](../../.claude/rules/grounded-answers.md)).
One entry per published report, newest first, each carrying its publication date and the
date its records run through. **Nothing is published yet**, and the shelf says exactly
that. Publishing a report is a separate, per-report decision made by Eugene; the first
report's text exists in this repository
([`docs/design/handoff-campaign-money/follow-the-money-report.md`](../design/handoff-campaign-money/follow-the-money-report.md))
and deliberately does not appear on the site.

## A report page (`/money/reports/{name}`)

No report address exists until its report is published — an unpublished address shows the
ordinary "page not found" screen. The page layout is fully built and waiting. When a report
publishes, its page carries:

- A masthead naming what it is (ALETHICAL RESEARCH), its author (until the signing name is
  decided, the line reads "AUTHOR NAMED AT PUBLISH" — never an invented name), its
  publication date, its records-through date, and every filing body it used.
- A contents list — a side rail on a computer, a jump list on a phone.
- The reading column, with the short version boxed on top, and a "how we scored this" inset
  printed beside the first use of any term we defined.
- A "where these numbers come from" block naming every source.
- **Share**, whose link previews carry the report's title and its two dates only — no
  claims, no figures.
- **Download as PDF**, which prints the current page: the PDF is this page, regenerated at
  each publish, never a second document maintained beside it.
- Two dated states, both built and tested: a **newer-filings notice** (the Board has
  accepted filings since the records-through date; figures stay as published, with any
  moved figure noted where it appears) and a **correction** (the earlier figure stays
  readable — struck through and dated — never silently swapped).

Links run one way: a report links out to record pages and official sources; no record page
links back to a report.

## Limits, sources, and reader data

- Every figure the section will ever show comes from official filings (Minnesota Campaign
  Finance Board; a signed report may also name other bodies, such as the FEC, in its
  masthead). No page here shows a figure it cannot back.
- No page sums money across members or filers, ranks committees by amount, or shows a
  dollar figure on a list of many committees. Signed reports are the one conditioned
  exception, under rule 13.
- The section collects nothing from readers. There is no sign-in gate, no form that stores
  anything, and the inert search box sends nothing anywhere.
