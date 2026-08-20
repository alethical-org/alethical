<!-- describes: apps/frontend/src/screens/redesign/MoneyLandingScreen.tsx, apps/frontend/src/screens/redesign/MoneyReportsShelfScreen.tsx, apps/frontend/src/screens/redesign/MoneyReportScreen.tsx, apps/frontend/src/screens/redesign/CommitteeMoneyScreen.tsx, apps/frontend/src/screens/redesign/CommitteePaymentsScreen.tsx, apps/frontend/src/lib/moneyLanding.ts, apps/frontend/src/lib/moneyReports.ts, apps/frontend/src/lib/committeeMoney.ts, apps/frontend/src/navigation/ia.ts, apps/frontend/src/navigation/webRoutes.ts -->

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
   lanes' cards are visibly not clickable, carry a "NOT BUILT YET" chip, and say "This
   page is not built yet.": each opens a *list* page that is not built yet (phase 3). Every
   committee does have its own page already (below) — reached by address, not by browsing
   — and the lane stays inert so it cannot promise a list that does not exist. Every lane
   being visible — built or not — is a deliberate decision (Eugene, 18 Aug 2026), so a
   reader sees the whole shape of the section.
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

## A committee's page (`/money/committees/{name}-{number}`)

One committee's money for one year, from Minnesota's own filings. The number at the end
of the address is the committee's registration number with the state, and it is the only
part that has to be right: committee names collide and numbers do not, so an old or
misspelled name part still lands on the right page, and the address then quietly corrects
itself to the current spelling. The chosen year and tab ride in the address, so a shared
link shows the receiver exactly what the sender saw.

**Until the committees list and search ship (phase 3), these pages are reached only by
typing or sharing an address** — the Committees lane on `/money` stays unclickable so it
cannot promise a list that does not exist.

Top to bottom:

1. **The header, from the state's register of filers.** The kind line above the name is
   the register's own vocabulary — Candidate committee, Party unit, or Political committee
   or fund — never a finer kind we invented. The one exception is grounded in the Board's
   own codes: a filer whose money rows carry the ballot-question code is headed Ballot
   question committee (or fund). A candidate committee shows the office and district it
   registered for; a closed committee carries a CLOSED chip with the register's own
   termination date, on every year's view.
2. **Whose committee it is — deliberately unanswered.** The filed name is the filer's own
   wording, not a confirmation by anyone, so the page says the money is the committee's
   own record and attaches it to no person. A party unit, caucus, fund, or ballot-question
   committee gets its own sentence, because for those there is no person to attach.
3. **A year switch** (this calendar year and the one before), each year its own address.
4. **The period panel**: what the committee's own report covers, its end read off the
   filing — no start is ever assumed — plus the one freshness date (the day we copied the
   Board's files, printed as its Minnesota day). A party unit's panel says its calendar is
   its own. If our own data service stops answering, the page keeps the figures it already
   had and says they are held until it answers — never expiring on a timer.
5. **Money in — two numbers, both correct.** The total the committee itself reported to
   the state, and the donations we can list with a donor's name. The split into named and
   unnamed money is decided by the server before the page ever sees it, and the page never
   subtracts. When the split is safe, a bar shows it and the unnamed figure appears with
   the sentence explaining it (donors at $200 or less in total for the year are never
   named). In each case where a split would state something false — the two figures cover
   different periods, the sources disagree, there are no named payments, our copy of the
   donation list is missing named money the filing carries, the committee corrected its
   report after we copied the official total, the two figures simply will not line up, or
   there is no reported total — the page shows the figures it has and a plain sentence
   saying why it will not divide them, never saying which figure is larger. A committee
   whose own report says zero shows $0.00 with a sentence saying that is the filing's
   zero, not our gap.

   **Only one of those sentences says Minnesota's two publications disagree, and until
   19 August 2026 three of them did.** A committee-year where the donation list holds no
   row at all, and one where a subtraction simply came out negative, both printed "for
   this committee and year they do not agree" — which blamed Minnesota for gaps on our
   side. Seven live committee pages carried it, Kristin Robbins's governor committee
   among them ([#1682](https://github.com/alethical-org/alethical/issues/1682),
   [#1648](https://github.com/alethical-org/alethical/issues/1648)). Each route now says
   only what its own evidence supports; the sentence about disagreement is left to the
   one check that actually compares the two publications. The full list of states and
   their counts is in
   [`legislator-campaign-money-guide.md`](legislator-campaign-money-guide.md), which
   owns the wording both surfaces share.
6. **Money out — never called "spending."** The figure is "Payments we can list" (there is
   no official total to compare it against), broken down by the filing's own kinds, with
   money given to other campaigns on its own plainly-labelled line — statewide, a large
   share of money out is transfers to other committees, and for a caucus that is the
   point.
7. **Three tabs. The first two — Who gave and Where it went** — the six largest payments,
   ranked largest first (honest inside one committee; never across committees), each
   naming the filing's own type. Donated goods and services carry a marker and stay
   inside the totals, because that is how the state counts them. A name opens a page only
   when it carries a registration number we hold as a filer; a private donor or a
   business stays plain text.
8. **The third tab — Filings**: every report the Board's catalogue records this committee
   as having filed, all years at once, with no amounts anywhere — it is a list of
   filings, not of money. Newest first by the period each report covers, and the tab says
   so in those words: we hold no date any report was filed (the Board's catalogue does
   not publish one), so no row says when it was filed. Each row shows the report's name
   and the period it covers — both ends only where the Board's own filing calendar prints
   the start, otherwise "covers through" its end date, never an assumed January 1. A
   report whose effective version is an amendment carries a neutral AMENDED marker with
   no date, because the catalogue records version numbers, not dates; the marker never
   depends on whether the older version's figures survived. A closed committee's final
   report appears even when its period runs past today, because a terminating committee
   files at termination. The Board also lists reports without saying whether they were
   filed — a report is listed from the moment its filing window opens, and for the oldest
   reports (mostly before 2008) the Board keeps no record either way — and the tab counts
   those out loud rather than showing them as filed or claiming the list is complete. It
   never says a report is late. One link under the list opens the Board's own report
   viewer; there are no per-report links, because the Board serves report documents
   through a form a link cannot reach, and not at all for most years before 2023 — a row
   of dead links would be worse than one honest step.
9. **What this record covers**: filed with the Board, nothing before 2015, unions don't
   report here — and the $200 donor sentence, except on a ballot-question committee's
   page, which prints **no** threshold figure anywhere: the statute says $500 for ballot
   questions, the Board's own handbook for those filers says $200, and we assert neither.

Empty and edge states, each its own honest sentence: a year no report covers ("Not
reported", never a zero, and never last year's money under this year's heading); a closed
committee's empty year (it closed, when, and that its final report exists and is public
even though our copy of the figures does not include it); a registration number in neither
our copy of the register nor the state's money files (a fact about our records, never
"this committee does not exist"); and loading placeholders that stop pulsing under reduced
motion and announce themselves to screen readers.

## Every payment (`/money/committees/{name}-{number}/payments`)

The full list behind a committee's figures — every named payment, largest first, with each
payment's own date. The Who gave / Where it went choice and the year are in the address.
The page loads 250 at a time; the capped-list card says the cap is ours, not the filing's,
offers the next 250, and links to the filing itself on the Board's site. "Showing X of Y"
is a measured count served with the rows, never a guess. The same naming rules apply: a
loan is labelled as reported on its own schedule rather than reading as a gift, transfers
read "Money given to another campaign", and only registered filers' names open pages.

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
