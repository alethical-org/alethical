<!-- describes: apps/frontend/src/screens/redesign/MoneyLandingScreen.tsx, apps/frontend/src/screens/redesign/ReadScreen.tsx, apps/frontend/src/screens/redesign/ResearchScreen.tsx, apps/frontend/src/screens/redesign/CommitteeMoneyScreen.tsx, apps/frontend/src/screens/redesign/CommitteePaymentsScreen.tsx, apps/frontend/src/screens/redesign/CommitteeListScreen.tsx, apps/frontend/src/screens/redesign/MoneySearchScreen.tsx, apps/frontend/src/screens/redesign/PaymentsUnderNameScreen.tsx, apps/frontend/src/components/campaignMoney/MoneyNameSearchField.tsx, apps/frontend/src/lib/moneyLanding.ts, apps/frontend/src/lib/research.ts, apps/frontend/src/lib/researchPieces/whoHasToReportTheirMoney.ts, apps/frontend/src/lib/researchPieces/whatTheRecordsName.ts, apps/frontend/src/components/read/SetBox.tsx, apps/frontend/src/lib/committeeMoney.ts, apps/frontend/src/lib/committeeList.ts, apps/frontend/src/lib/moneyNameSearch.ts, apps/frontend/src/lib/paymentsUnderName.ts, apps/frontend/src/navigation/ia.ts, apps/frontend/src/navigation/webRoutes.ts -->

# How the Campaign money section works

**Net.** `/money` is the public front door to Minnesota's campaign-money records, open to
everyone with no sign-in. Typing a name in the box on it now works, the register of
committees has its own browsable list, every committee page is reachable by browsing rather
than only by pasting an address, and a name that got paid opens every payment filed under
that exact spelling
([#1780](https://github.com/alethical-org/alethical/issues/1780)). Our own signed research
lives one level up, on the `/read` page, which the money landing points at. One piece is
published there.

The section is still marked under development on every page, because 2 things a reader
might expect are genuinely missing: **lobbying** is published by Minnesota and not loaded by
us, and **no sitting member's committee has been confirmed by a person yet**, so no
legislator profile shows money.

**"Report" means one thing on this site: the document a campaign files with the state.** Our
own writing is **Research**, and a short piece explaining 1 term is a **Guide** (settled
27 Aug 2026, [`docs/architecture/published-writing-decisions.md`](../architecture/published-writing-decisions.md)
§2.6). The `/read` page and its pieces were addressed `/money/reports`, then `/reports`, then
`/read` before landing on `/read` on 27 Aug 2026, and every one of those old addresses forwards
permanently and straight to the `/read` address it belongs to, never through the one in between.

## Ways in

- Choose **Search**, then **Money in politics** (marked with a green NEW chip) in the shared
  top menu, on a computer or in the phone menu.
- Open `/money` directly.
- Type a name into the box on `/money` and press Enter or the Search button, which opens
  the results page at `/money/search?q=…`.
- Open `/money/committees` directly for the whole register, or `/money/search?q=…` for a
  search somebody shared with you.
- Open a name that gave or got paid from a search result, which opens
  `/money/payments?name=…&role=…` — a link somebody can share, showing the same list.
- The retired address `/track/campaign-finance` (an old greyed "Campaign Finance" tracking
  row pointed there) shows the `/money` landing instead of an error.

The `/read` page has its own way in, separate from this section: choose **Read** in the same top
menu. It is one item with no menu behind it, on a computer and in the phone menu both, so it takes
one click or one tap. In the phone menu it is a taller row than the ones under SEARCH and ABOUT,
with a thin line above and below it and a small arrow at the right, which is how the menu says it is
one of the 3 things the site does rather than a fifth Search row (settled 27 Aug 2026,
[`docs/architecture/published-writing-decisions.md`](../architecture/published-writing-decisions.md)
§2.13).

**And search engines have their own way in, which is new.** Since 27 Aug 2026 every page in
this section arrives from the server with its words and its links already in it, rather than
as an empty frame the browser fills in afterwards. That matters because a search engine will
not press a button and does not always wait for a page's programs to run: before this, the
register served no link at all and none of the 1,603 committee pages was listed anywhere.
There is now a list of committee addresses handed to search engines
(`/sitemaps/committees.xml`), holding every committee whose page has a filed record on it.
A committee with nothing filed keeps its page and stays reachable through the register's own
numbered pages; it is just not advertised, because a page with nothing on it is not worth
sending anyone to. What a person sees is unchanged.

## The landing page (`/money`)

Top to bottom:

1. **Title and one sentence** saying what the record is: every contribution and expenditure
   Minnesota publishes for state campaigns.
2. **A working search box.** Type a name and press Enter or the Search button, and it opens
   the results page. It commits on Enter rather than as you type, because every search has
   its own address and a search that ran per keystroke would leave a browser history entry
   for every letter. Under it, one line saying what the matching does: the name exactly as
   it was filed, and no nearest-match guess — names in these records differ from each other
   by a single character often enough that a guess would put a reader on the wrong
   organisation. A query shorter than the search's own floor is not blocked here; the
   results page says "type at least 3 characters" instead, which is the true answer rather
   than a box that silently refuses.
3. **What we found** — the research lane, first in prominence. It links to the `/read`
   page, showing the newest piece's title, standfirst and dates. With nothing published it
   says "Nothing is published yet" and counts "0 RESEARCH PIECES PUBLISHED" honestly.
4. **Three lane cards, and all 3 open something**: Legislators (links to the legislator
   directory — a member's money is a tab on the profile they already have), Committees
   (links to the register's own list at `/money/committees`), and Who got paid, which opens
   the name search. **That last lane is a search rather than a list, and its card says so.**
   There is no browse-all-payees list and there deliberately never will be one: a payee
   carries no identifier in Minnesota's data, so such a list could only be ordered 4 ways
   and 3 of them are forbidden while the 4th is useless. By amount, by how many records
   carry the name, or by most recent payment are all rankings across committees on
   different filing calendars, which sets one period against another
   ([`.claude/rules/grounded-answers.md`](../../.claude/rules/grounded-answers.md) rule 12);
   alphabetical is honest and useless across hundreds of thousands of spellings. Ruled
   27 Aug 2026 on [#1780](https://github.com/alethical-org/alethical/issues/1780). Every
   lane being visible is a deliberate decision (Eugene, 18 Aug 2026), so a reader sees the
   whole shape of the section.
5. **What this record does not cover**: nothing before 2015; unions do not report to this
   board; and the exact sentence "Donors who gave $200 or less in total for the year need
   not be named" (the $200 test is on a donor's yearly total, never on one gift's size, and
   it is the point at which a name becomes required rather than a line below which nobody is
   named — [#1755](https://github.com/alethical-org/alethical/issues/1755)).
   A fourth line names **lobbying**, and it is deliberately not one of the three above:
   those are permanent gaps in the record, while lobbying is published by Minnesota and
   simply not loaded by us yet, so it says "not here yet" rather than "not covered".
   It earns its place because the homepage promises "campaign and lobbying records"
   twice and this is where a reader arrives looking for the second half. Every other
   absence in this section is stated out loud; before this line, lobbying was the one a
   reader could only find by hunting and giving up (found by an end-to-end browser test,
   20 Aug 2026).

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

## The search results page (`/money/search?q=…`)

One typed name, matched across the 5 kinds of record Minnesota's files hold, grouped by
what each match **is**. The typed name is in the address, so a results page is a link
somebody can send, and the browser's Back button returns to it.

Matching is containment of exactly what was typed, and there is no did-you-mean anywhere.
That is not caution: 178 registered filer names sit a single character apart from another
registered name, and every one of those pairs is a different organisation — the Green Party
and the Republican Party of the same district among them. A correction on this data does
not fix a typo, it hands a reader one organisation's money under another's name with
nothing on screen to reveal it.

**What the record does not cover sits above the results, not under them.** Somebody who
types a name, gets nothing, and is told nothing concludes that the person gave nothing,
rather than that we do not hold the record.

The 5 groups, always all 5, always in this order, and each drawn even when it holds
nothing — a group missing from the page would read as "nothing is filed" when it meant "we
did not look":

- **People** — the 200 sitting legislators, and only them. A person is a result only where
  we hold a record of them beyond these filings; everybody else on a filing resolves to
  what they filed. These rows open the person's profile.
- **Committees** — the register. The only rows that open a page, because a committee
  carries a registration number and so keeps its address through a change of name. Where
  more rows exist than the group shows, one link opens the committees list already narrowed
  to the same name.
- **Names that gave** — distinct donor names from the contributions file. A donor's name is
  searchable and is deliberately not a profile: we never join 2 spellings into one person,
  and the records hold "Messinger, Alida", "Messinger, Alida R" and "Messinger, Alida
  Rockefelle" as 3 separate strings.
- **Names that got paid** — distinct supplier names from the expenditures file.
- **Names paid by independent spending** — the same from the independent-expenditures file.
  A separate group on purpose, and **the two are never added**: 491 rows of the independent
  file share a spender, name, amount and date with an ordinary expenditure row, and whether
  that is one payment filed twice or 2 that coincide is not established.

**Each group carries its own count and the page never totals them**, and says so out loud.
The drawn design had one summary line adding the groups up; with the 2 overlapping vendor
groups, any single number on this page would be a figure nobody can stand behind.

**A count that hit the search's own ceiling reads "more than 200 matches", never "200".**
A common name genuinely matches thousands; the server counts distinct names up to 200 and
then stops, and printing that ceiling as a total would be a made-up figure in the largest
type on the page. When any group reads that way, a line says where the counting stopped.

**Every row opens something now, and the 2 kinds of destination are different on purpose.**
A person or a committee opens a page **about them**, because both carry an identifier that
survives a change of name. A name from one of the 3 payment groups carries no identifier at
all, so it opens **the payments filed under that exact spelling** and nothing else. Each
group says which of the 2 its rows are, because rows that looked alike would promise a
profile of a business that these records cannot support.

Its own states, each with its own words: nothing typed yet ("Type a name to search", with a
link to the committees list); a query under the search's floor ("Type at least 3
characters", and that this is a limit of ours rather than a fact about the records); no
match at all ("Nothing is filed under '…'", the spelling advice, no nearest-match guess,
and a link to browse all committees); one group our copy could not read (a gap on our side,
while the other groups still answer); and loading placeholders that announce themselves to
screen readers.

## Payments filed under one name (`/money/payments?name=…&role=…`)

Every payment Minnesota's filings record under **one printed name, exactly as it was
spelled**. Reached by opening a name from one of the 3 payment groups on the search results
page. Built by [#1780](https://github.com/alethical-org/alethical/issues/1780).

**This page is a spelling, not an organisation, and everything about it follows from that.**
A donor, an employer and a business that got paid carry no identifier anywhere in
Minnesota's data, so the printed string is the whole of the key. The records hold
"Messinger, Alida", "Messinger, Alida R" and "Messinger, Alida Rockefelle" as 3 separate
strings, and the same file holds "Messinger, William Frye" beside "Messinger, Wiiiam Frey" —
so any rule loose enough to join the first 3 joins those 2 as well, and we join none of
them. The heading therefore quotes the spelling with words in front of it ("Money paid under
the name 'Facebook'") rather than standing the bare name up as a title, and the sentence
under it says out loud that spellings vary, that this may not be everything, and that a name
is all this is.

**There is no total, and that is the single most important thing about the page.** Every row
carries its own amount and nothing adds them up: the rows come from committees on different
filing calendars, so any combined figure would set one period against another
([`.claude/rules/grounded-answers.md`](../../.claude/rules/grounded-answers.md) rule 12).
A test fails the build if a total, subtotal, average or any other cross-row figure appears
in either the page or the library behind it.

**Three separate addresses, never one.** The `role` in the address says which of Minnesota's
3 downloads is being read, and the 3 are never combined:

- `role=contributor` — money **given** under that name. Each row names the committee that
  received it.
- `role=vendor` — money **paid** to that name by a committee, from the expenditures file.
- `role=independent_vendor` — money paid to that name out of **independent spending**, from
  a separate file. Its page carries an extra sentence saying the 2 are never added: 491 rows
  of the independent file share a spender, name, amount and date with an ordinary
  expenditure row, and whether that is one payment filed twice or 2 that coincide is not
  established.

A 4th role exists on the server, reading the box a donor types their employer into. Nothing
links to it and this page does not accept it: that box is free text whose commonest entries
are "Not Employed" and "Retired", so it is never a company's giving and it would need
wording of its own.

**Why both halves of the state are in the query string rather than the path.** Filed names
really do carry the characters that break an address: "AT&T", "Heat & Frost Insulators Local
#34" and "EveryAction Inc d/b/a NGP VAN" are all in the live release. An ampersand would
split the address into 2, a hash would cut everything after it off, and a slash inside a
path segment has to be encoded as `%2F`, which hosts and proxies are free to rewrite before
we ever see it. A query parameter survives all 3 intact, and it matches the section's other
filtered views. An address with no name, or a role we do not serve, is a page that does not
exist rather than a page about something else.

**Search engines are not sent here, deliberately.** The page carries a "do not index"
instruction: there is one address per spelling out of hundreds of thousands, and a page
listed under a name would read as a profile of whoever carries it — the one thing this page
may never be
([`docs/architecture/page-metadata-for-search-and-sharing-decisions.md`](../architecture/page-metadata-for-search-and-sharing-decisions.md)
§22). It stays crawlable, so the committee pages its rows link to are still reachable.

Each row names **the committee whose filing carries it**, with the filing's own words
underneath (the kind of committee that received a donation, or an expenditure's own stated
purpose, or which candidate independent spending was for or against), its own date and its
own amount. A row opens that committee's page wherever our records hold that number as a
filer; where they do not, the name stays plain text rather than offering a link that dies.

Above the rows, one line says what is on the page, and it never says more than that. When
nothing is held back it reads "9 payments, from 7 committees" — both counted from the rows
themselves. When more are filed than we loaded it reads "Showing the first 250 payments,
newest first" and drops the committee count entirely: the server serves no count on a
name-keyed lookup, so "of 1,284" would be a number we invented, and a committee count over a
partial list would read as how many committees filed in all.

Rows arrive **newest first**, which the page states, and 250 at a time. The design drew this
list largest-first; the server serves only date order for a name, so the page prints the
order it actually has. The cap card says the cap is ours rather than the filings', and its
button asks for the next batch without claiming how many are left.

Its own states: nothing filed under that spelling ("Nothing is filed under '…' as spelled",
the same spelling advice the search gives, no nearest-match guess, and a button back to the
search); our copy of that download not answering, which says it is a gap on our side and
never that nothing is filed; a load failure; and loading placeholders that announce
themselves to screen readers. At the bottom, the same "what this record does not cover"
block the landing and the search carry.

## The committees list (`/money/committees`)

The whole register of everyone allowed to raise or spend money in Minnesota state politics,
ordered by the name as filed, A to Z. The address forwarded to `/money` until this shipped.

The line above the rows says which of them this page holds: "Showing 551–600 of 1,603
registered filers".

**No row carries a dollar figure and nothing on the page sorts by one, ever.** These filers
file to different calendars, so 2 amounts side by side would set one period against
another, and a list ordered by amount would rank who is on the ballot rather than who raised
more. The page says both things under the list: money is on each committee's own page, where
the period it belongs to is stated, and the order is printed beside the count so a reader
never has to infer it.

Top to bottom:

1. **The register's own size**, counted live from the register with the date it was copied —
   1,603 filers today. A count of what we hold, never pasted: a pasted count is how the
   landing once said 1,336 on a day the register held 1,603.
2. **A find-a-committee-by-name box**, which narrows the list as you pause typing. The
   typed name is in the address, so a narrowed list can be shared.
3. **Four filter chips**, each with its own count: All kinds, Candidate committees, Party
   units, and Committees and funds. Those are the register's own 3 kinds and the page offers
   nothing finer — the finer kind is blank for 33 registered filers, so a "ballot question"
   or "caucus" chip would quietly present "we cannot tell" as "not one of these". Each
   chip's count is of the whole register rather than of the current filter, so a count never
   looks like the filter found fewer of a kind than exist.
4. **The rows.** Each shows the filed name, the register's own kind, and the registration
   number. A candidate committee also shows the seat it registered for. A party unit shows
   its kind and no geography: Minnesota publishes no layer for 289 of the 299 party units,
   and reading one out of the printed name is already wrong about 3 named organisations —
   21 filers are named exactly "Nth Congressional District <party>" and 3 of those are
   political committees or funds, not party units. Where the Board publishes a finer word
   itself, the row uses it: a legislative caucus, a state party committee, a ballot question
   committee or fund. A closed committee carries a CLOSED chip with the register's own
   termination date.
5. **Numbered pages**, 50 filers each, so the whole register is 33 addresses rather than one
   endless list. Previous, Next and jumps of 10 and 100 pages are ordinary links, and the
   page number is in the address, so the list a reader is looking at is one they can send and
   the Back button returns to it. This replaced a "Show the next 50" button on 27 Aug 2026:
   Google says plainly that it does not press buttons, so every filer past the first 50 had
   no link anywhere on the site and 1,553 of the 1,603 committee pages were unreachable to
   it. Asking for a page past the last real one shows the page-not-found screen rather than
   quietly snapping back to the last page that exists.

Every row opens its committee **by registration number**, not by name, so a committee that
changes its name keeps its address.

Its own states: nothing matches the typed name (with the spelling advice, no nearest-match
guess, and a way to drop the filter); our copy of the register could not be read at all
(said as our gap, and never as a claim that Minnesota registers nobody); and loading
placeholders that announce themselves to screen readers.

## A committee's page (`/money/committees/{name}-{number}`)

One committee's money for one year, from Minnesota's own filings. The number at the end
of the address is the committee's registration number with the state, and it is the only
part that has to be right: committee names collide and numbers do not, so an old or
misspelled name part still lands on the right page, and the address then quietly corrects
itself to the current spelling. The chosen year and tab ride in the address, so a shared
link shows the receiver exactly what the sender saw.

Top to bottom:

1. **The header, from the state's register of filers.** The kind line above the name is
   the register's own vocabulary — Candidate committee, Party unit, or Political committee
   or fund — never a finer kind we invented. Where the Board's own codes name a finer kind,
   the line says that instead, because the finer word is the register's too. All 6 of the
   Board's finer codes are spelled out: Political committee, Political fund,
   Independent-expenditure committee, Independent-expenditure fund, Ballot question
   committee and Ballot question fund. Three more codes the Board documents nowhere stay
   unexpanded rather than being guessed at. A party unit carrying one of the 2 layer codes
   Minnesota publishes is headed Legislative caucus or State party committee, and a layer
   code is read only off a party unit, because no filer of another kind carries one.
   Wherever the finer kind and the register's broad kind differ, the broad one follows it
   on the same line, so a reader sees both. A candidate committee shows the office and
   district it registered for; a closed committee carries a CLOSED chip with the register's
   own termination date, on every year's view.
2. **Whose committee it is.** Until a person at Alethical has checked, the page attaches
   the money to nobody and says why: the filed name is the filer's own wording, not a
   confirmation by anyone. A party unit, caucus, fund, or ballot-question committee gets
   its own sentence, because for those there is no person to attach at all.

   Once someone here has read Minnesota's own records and written down whose committee
   it is, the card says so, names the member, and carries a link straight to that
   member's campaign money. The sentence says a person decided it rather than only that
   it is "confirmed", because nothing about this comes from software matching names: no
   score, threshold, or agreement between rules ever creates one of these links, and if a
   name match were wrong nothing later in the system would notice. It also never claims
   to be the member's only committee — a candidate can register more than one, 20
   currently do, and adding two of them together would count the same money twice
   ([#1663](https://github.com/alethical-org/alethical/issues/1663)) — so it says the
   Under that sentence sit up to 3 short lines saying what the person actually read: the
   day they decided, how the account's filed name related to the member's, what
   Minnesota's register of registered candidates said about it, and what the party money
   said. They are read off that decision's own stored record rather than recomputed, so a
   later download renaming a committee does not rewrite the basis of a decision already
   made, and the weak cases say they are weak: where the register has no row, the line
   says so rather than anything a reader could mistake for the state agreeing.

   A committee somebody looked at and
   ruled out reads exactly like one nobody has looked at yet: that decision is about our
   own proposal, and it is not a claim about the committee.
3. **A year switch** (this calendar year and the one before), each year its own address.
4. **The period panel**: what the committee's own report covers. The end is read off the
   filing; the start appears only when the Board's own published filing calendar prints
   one against that end (so "Figures for 1 Jan 2026 – 20 Jul 2026"), and otherwise the
   panel says "through" alone — a start is never assumed, because a special-election
   filer's period does not open on 1 January. Beside it, the one freshness date (the day
   we copied the Board's files, printed as its Minnesota day). A party unit's panel says
   its calendar is its own. If our own data service stops answering, the page keeps the
   figures it already had and says they are held until it answers — never expiring on a
   timer.
5. **Money in — two numbers, both correct.** The total the committee itself reported to
   the state, and the donations we can list with a donor's name. The split into named and
   unnamed money is decided by the server before the page ever sees it, and the page never
   subtracts. When the split is safe, a bar shows it and the unnamed figure appears with
   the sentence explaining it (a committee only has to name a donor once that donor has
   given more than $200 in total for the year, and may name a smaller one but does not have
   to). In each case where a split would state something false — the two figures cover
   different periods, the sources disagree, our copy of the donation list is missing
   named money the filing carries, the committee corrected its report after we copied the
   official total, the two figures simply will not line up, there are no named payments,
   or there is no reported total — the page shows the figures it has and a plain sentence
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

   **That check itself was wrong about 37 committee-years until 28 August 2026, and 20 of
   them are now fixed.** Minnesota names only the donors who had passed $200 by a report's
   own cut-off date, while its separate donation spreadsheet carries the whole year's
   naming decision, so on a part-year report the two figures count different sets of
   donors for a reason that is nobody's mistake. All 37 pages carried the disagreement
   sentence, in the HTML the server sends before any JavaScript runs, and all 37 were in
   the sitemap for search engines — the committees of Amy Klobuchar, Lisa Demuth, Keith
   Ellison and Steve Simon among them
   ([#1647](https://github.com/alethical-org/alethical/issues/1647)). Nothing we hold can
   say whether a reader loaded one. The other 17 keep the sentence, because a difference
   the threshold does not explain is a real finding.
6. **Money out — two numbers too, and never called "spending."** The filing's own
   reported money-out total ("Payments out this committee reported to the state", with
   the period it covers) sits above "Payments we can list", and the two are never added
   or subtracted — they are separate claims by separate sources, exactly like money in.
   What stays banned is calling the listed payments "spent": broken down by the filing's
   own kinds, money given to other campaigns gets its own plainly-labelled line —
   statewide, a large share of money out is transfers to other committees, and for a
   caucus that is the point. A year our copy holds no reported total for says so as our
   copy's gap.
7. **Three tabs. The first two — Who gave and Where it went** — the six largest payments,
   ranked largest first (honest inside one committee; never across committees), each
   naming the filing's own type. **Every count is a count of payments, never of donors**:
   the filings carry printed names with no identifier, and one person appears under
   several spellings ("Messinger, Alida" / "Messinger, Alida R" / "Messinger, Alida
   Rockefelle" are 3 strings in the live files), so "N donors" would be a claim the data
   cannot back — the same failure as vouching for a list's completeness. Donated goods
   and services carry a marker and stay inside the totals, because that is how the state
   counts them. A name opens a page only when it carries a registration number we hold as
   a filer; a private donor or a business stays plain text.
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
offers the next 250, and links to the filing itself on the Board's site. The version that
arrives from the server carries the first 250 rows of the Who gave list, which is the one
the page opens on; the Where it went list and any other year arrive when the page's programs
run, exactly as a bill page serves its Summary whichever tab the address names. "Showing X of Y"
is a measured count served with the rows, never a guess. The same naming rules apply: a
loan is labelled as reported on its own schedule rather than reading as a gift, transfers
read "Money given to another campaign", and only registered filers' names open pages.

## The `/read` page (`/read`)

Reached from the top menu's **Read** item, and from the money landing's "What we found"
card. It has moved 3 times: it sat at `/money/reports` until 20 Aug 2026, when the nav gained
its own group and it left the money section
([#1698](https://github.com/alethical-org/alethical/issues/1698)), at `/reports` until the
morning of 27 Aug 2026, when "report" went back to meaning only the document a campaign files
with the state, and at `/read` until that evening, when the menu item became the single word
**Read** and the addresses followed it. All 7 old addresses forward permanently and directly, so a
link shared before any of the moves still opens the right page in one hop. Nothing about either page's contents changed with
either move.

This is the page listing everything Alethical publishes in its own name
([`.claude/rules/grounded-answers.md` rule 13](../../.claude/rules/grounded-answers.md)).
With nothing posted the page says "Nothing is published yet" and the money landing counts 0.

**The page shows no title.** The top bar says the word and so does the address, so a visible
heading saying it a third time is what the naming rule bans. What sits where a title would is
one grey line saying what the page holds: "What we found in Minnesota's public records, plus
guides to how state government works". The page's name still exists for a screen reader and
in the browser tab, on a heading that is there but not drawn; it is taken from the top bar's
own label, so the 2 cannot end up saying different words.

**Two kinds of writing, in 2 groups: RESEARCH first, then GUIDES** (Eugene, 27 Aug 2026,
overruling the drawn order). Research is Alethical's own digging through these records, signed
and dated. A guide explains 1 term in plain language, concludes nothing, and adds nothing up
across members, so it needs no part of rule 13's exception. Research leads because it is the
original work and guides exist because that work needs vocabulary.

The order is the order the page is written in, not a styling trick, so what a person sees,
what a screen reader reads out and what the keyboard reaches are the same order. Both headings
are ordinary level-2 headings, so someone skipping through the page by heading meets RESEARCH
first.

**A group with nothing in it shows no heading and no list.** A heading over nothing reads as
broken. The spacing belongs to the position rather than to the group, so whichever group comes
first sits closer to the rule above it, and if one is empty the other simply takes that place.

One card per piece, newest first inside each group. **Every card is the same shape,
whichever kind it holds**, because a column that changes shape from one card to the next
reads as 2 columns. A card carries, in this order:

- A short line in the typewriter face: how long the piece takes to read, then its date. A
  research piece gives the day it was published; a guide gives the month it was written, and
  the same slot reads "checked" from the day somebody re-checks it, so a guide that is kept
  accurate reads as current instead of old. This replaces the 26 Aug 2026 decision to leave a
  guide's card dateless: that decision was about a date going stale on a listing row, and the
  one-word swap is the answer to it.
- The piece's title.
- One smaller line: a research piece's standfirst, or the set a guide belongs to. A guide in
  no set has neither, and the line is simply not drawn.
- No kind word. The heading above already says Research or Guide, and printing it again on
  the card says it twice in one glance
  ([`docs/architecture/published-writing-decisions.md`](../architecture/published-writing-decisions.md)
  §2.10). A screen reader still hears "Research:" or "Guide:" at the start of the card,
  because a card read out on its own has no heading above it.
- Nothing else. There is no "Read the research" line: the whole card is the link, and the
  border turning green under the pointer is what says so.

**A set of pieces written to be read together gets a box instead of a card each**, drawn
above the loose cards under GUIDES. "How the Money Works" now has 2 published pieces, so its
box shows. A box carries the set's name, a line reading "2 GUIDES · 10 MIN", and a row per
published piece with its title and its reading time. A row carries no date, no kind word and
no number: where a piece sits in its set is internal talk and reaches no reader (§2.12).

The set's name is a control: clicking it folds the rows away and clicking again brings them
back, and a small arrow at the right turns over to show which way it is. Folding hides the
rows and keeps the count and the total, because those are how a reader decides whether to
open it. The box itself is not a link and does not lift under the pointer, because it has
nowhere to go: a set's own page at `/read/sets/<name>` is still unbuilt, and that address
shows the ordinary "page not found" screen.

**A set only lists what is published**, never a title a reader cannot open and never a count
of how many the set is eventually meant to hold (§2.3). A set with nothing published shows no
box at all (§2.4). A set with 1 published piece shows the whole box holding 1 row, because
opening a box is a statement that the next piece is coming shortly (§2.5).

**Not built yet:** a set's own page, and the "All of <set name>" link Design gives a box once
a set reaches 6 published pieces. Sorting the page by subject rather than by our own 2 kinds
is an open question, deferred until there are 4 sets or a dozen research pieces (§2.11).

Posting a piece puts it on the site straight away, before any of its figures have been
checked: its own address, this page, and the money landing's count, all on the day it
posts. **Search engines see it the same day too (Eugene, 25 Aug 2026):** it goes into the
site map search engines read (`/sitemap.xml`) and its page carries no instruction to skip
it. Nothing about a piece waits any more.

That used to work the other way, and the change has a cost worth knowing: a figure nobody
has recomputed can now reach a search result on the day it posts. What stands in the way is
the checking itself happening promptly, and a correction replacing a wrong figure the moment
it is agreed. Holding a particular piece back stays possible, for a reason Eugene names,
rather than being a step every piece waits behind.

The `/read` page and every piece's page hand their words over in the **very first response
from the server**, before any of the app's own code runs: the listing its cards and a plain
link to every posted piece, a piece its entire text. Our own writing used to be the one thing
on the site that a search engine could read only after running the app, while every bill page
handed its text over straight away
([#1760](https://github.com/alethical-org/alethical/issues/1760)). This is separate from
whether a search engine may *list* a piece, which is still Eugene's per-piece decision
above: a piece marked to be skipped is served in full and still asks to be skipped.

Three pieces are posted: the research piece "The Money Only Goes One Way", at
`/read/research/the-money-only-goes-one-way`, and 2 guides, "Who has to report their
money" at `/read/guides/who-has-to-report-their-money` and "What the records name, and
what they leave out" at `/read/guides/what-the-records-name`. The 2 guides are the set
"How the Money Works", in that reading order.

## One research piece's page (`/read/research/{name}`)

Every posted research piece has a page here; an address with no piece behind it shows the
ordinary "page not found" screen. **So does a real piece asked for under the wrong folder** —
the guide's name under `/read/research/` is a missing page, not a second way in, because a
piece has exactly 1 address and a reader must not be able to share one we do not name as the
real one. A piece carrying both the research trait and the guide trait is addressed here too,
and its label reads Research, because rule 13 binds it in full
([`docs/architecture/published-writing-decisions.md`](../architecture/published-writing-decisions.md)
§2.6). A piece's page carries:

- The word **RESEARCH** above the title, saying which of our two kinds of writing this is.

- A masthead carrying 2 dates and nothing else: the publication date and the
  records-through date. A piece published in Alethical's own name carries no byline,
  because the site is the author, and the "where these numbers come from" block names every
  filing body used. Where a figure comes from records Alethical does not hold, that block
  names those records and the years they cover; the records-through date speaks only for
  Alethical's own loaded data (Eugene, 20 Aug 2026).
- The publication date is the day the piece posts, in Minnesota time, and it never moves
  afterwards. The records-through date is separate and stays pinned to the records the
  figures were computed from, so a piece read late never looks fresher than its data.
- Tables, where the piece's own text uses one. A table is marked up as a real table, so a
  screen reader announces each figure with its column heading, and it scrolls on its own
  rather than pushing the page sideways on a phone.
- A contents list — a side rail on a computer, a jump list on a phone. Every entry is
  an ordinary link to its section, listed in the order the article reads, so it can be
  opened in a new tab, copied, or reached by keyboard. Choosing one puts that section's
  name in the address bar
  (`/read/research/the-money-only-goes-one-way#the-one-way-valve`), so
  a reader can share a link straight to a section and Back returns them to where they
  were reading. Opening an address that already names a section starts there. Each
  section's name is built from the words of its own heading, never its position in the
  page, so a link someone shared still lands on the right section after a new section is
  added above it. On a computer the rail marks the section being read, and exactly one
  entry is marked at a time.
- The reading column, with the short version boxed on top, and a "how we scored this" inset
  printed beside the first use of any term we defined.
- A "where these numbers come from" block naming every source.
- **Share**, whose link previews carry the piece's title and its two dates only — no
  claims, no figures.
- Two dated states, both built and tested: a **newer-filings notice** (the Board has
  accepted filings since the records-through date; figures stay as published, with any
  moved figure noted where it appears) and a **correction** (the text is updated to the
  corrected figure and the wrong one is gone, and a dated note at the top of the piece
  says what changed unless the team directs that the correction carries none, so no wrong
  number is ever left on the page).

Links run one way: a piece links out to record pages and official sources; no record page
links back to a piece.

## One guide's page (`/read/guides/{name}`)

A guide is a short piece explaining 1 term in the words a person actually uses. It concludes
nothing, adds no figures up across members and defines no labels of our own, so it lives under
[`.claude/rules/grounded-answers.md`](../../.claude/rules/grounded-answers.md) rules 1 to 12
like every other page on the site, and needs no part of rule 13's exception for signed
research.

A guide's page is the same document shape as a research piece's, drawn by the same screen. What
differs:

- **One line under the title instead of a research masthead**, reading
  `GUIDE · 5 MIN · WRITTEN AUGUST 2026`. The kind, how long it takes to read, and one date.
  There is no second date on it.
- **The word GUIDE is in that line and nowhere else on the page.** A research piece prints
  RESEARCH above its title because its own masthead is 2 dates and nothing else; a guide's line
  already says it, and saying it twice is what §2.10 narrows away.
- **The reading time is worked out from the guide's own words**, at 200 words a minute, rounded
  to whole minutes. Never typed, because a typed number is wrong the first time a sentence
  changes.
- **The date says which event it is.** "Written August 2026" until somebody re-checks the
  guide against the records, and "Checked March 2027" from then on: the same slot, one word
  swapped. A guide describes rules that can change, so a reader needs to know when we last
  looked; and because re-checking moves the date forward, staying accurate makes a guide look
  current rather than old.
- **The set it belongs to is named under the title, and only named.** "How the Money Works" is
  the whole of what a reader is told: no number, not "piece 1", not "piece 1 of 5", nowhere on
  the site (§2.12). The set's own page does not exist, so the name is not a link — we link only
  to what is there.
- **No short-version box**, because a guide states rules rather than findings and there is
  nothing to summarise above it. It opens with plain prose instead.
- **A closing "where this comes from" block**, in the guide's own words, with every source
  linked at the body that published it.

One guide is posted: **"Who has to report their money"**, which explains Minnesota's 3 kinds of
political account — a candidate's own campaign committee, a party unit, and a political
committee or fund — and why the kind decides what the records will tell you. Its prose was
written and settled in
[`docs/reader-guides/who-has-to-report-their-money.md`](../reader-guides/who-has-to-report-their-money.md)
before the page existed, and a test compares the shipped page against that file word for word,
so neither can drift from the other. It cites 11 sources: 8 at the Campaign Finance Board and 3
at Minnesota's own statutes.

It carries no links out of its own body yet. The 2 forward links it will gain, on the $200
donor-naming rule and on running your own ads about a race, go in the day those guides post and
not before, and a person decides every such link rather than software proposing one (§2.6, and
[issue 1752](https://github.com/alethical-org/alethical/issues/1752)).

## Limits, sources, and reader data

- Every figure the section will ever show comes from official filings (Minnesota Campaign
  Finance Board; a signed research piece may also name other bodies, such as the FEC, in its
  sources block). No page here shows a figure it cannot back.
- No page sums money across members or filers, ranks committees by amount, or shows a
  dollar figure on a list of many committees. Signed research pieces are the one conditioned
  exception, under rule 13.
- The section collects nothing from readers. There is no sign-in gate and no form that
  stores anything. The search box sends the name typed into it to our own server to be
  matched against the filings, and to nobody else; the typed name appears in the page's own
  web address, which is what makes a search shareable, and nothing about it is stored
  against a reader.
