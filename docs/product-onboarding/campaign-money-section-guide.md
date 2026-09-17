<!-- describes: apps/frontend/src/screens/redesign/MoneyLandingScreen.tsx, apps/frontend/src/screens/redesign/ReadScreen.tsx, apps/frontend/src/screens/redesign/ResearchScreen.tsx, apps/frontend/src/screens/redesign/CommitteeMoneyScreen.tsx, apps/frontend/src/screens/redesign/CommitteePaymentsScreen.tsx, apps/frontend/src/screens/redesign/CommitteeListScreen.tsx, apps/frontend/src/screens/redesign/MoneyByRaceScreen.tsx, apps/frontend/src/screens/redesign/MoneySearchScreen.tsx, apps/frontend/src/screens/redesign/PaymentsUnderNameScreen.tsx, apps/frontend/src/components/campaignMoney/MoneyNameSearchField.tsx, apps/frontend/src/components/campaignMoney/TrackCommitteeButton.tsx, apps/frontend/src/lib/trackCommitteeButton.ts, apps/frontend/src/lib/moneyLanding.ts, apps/frontend/src/lib/research.ts, apps/frontend/src/lib/researchPieces/whoHasToReportTheirMoney.ts, apps/frontend/src/lib/researchPieces/whatTheRecordsName.ts, apps/frontend/src/components/read/SetBox.tsx, apps/frontend/src/lib/committeeMoney.ts, apps/frontend/src/lib/committeeList.ts, apps/frontend/src/lib/moneyByRace.ts, apps/frontend/src/lib/moneyNameSearch.ts, apps/frontend/src/lib/paymentsUnderName.ts, apps/frontend/src/navigation/ia.ts, apps/frontend/src/navigation/webRoutes.ts, apps/frontend/src/screens/redesign/OutsideSpendingScreen.tsx, apps/frontend/src/lib/outsideSpending.ts, alethical/api/services/outside_spending.py, apps/frontend/src/lib/pageData.ts, apps/frontend/src/components/campaignMoney/CommitteeDonations.tsx, apps/frontend/src/components/campaignMoney/DonorBreakdown.tsx, apps/frontend/src/components/campaignMoney/DonorPaymentList.tsx, apps/frontend/src/components/campaignMoney/GroupedOutsideSpending.tsx, apps/frontend/src/lib/committeeConfirmation.ts, apps/frontend/src/lib/committeePaymentsPage.ts, apps/frontend/src/lib/committeeMoneyShared.ts -->

<!-- describes: apps/frontend/src/components/campaignMoney/MoneyDetailsBundle.ts, apps/frontend/src/components/campaignMoney/MoneyDetailsOnDemand.tsx, apps/frontend/src/hooks/useCampaignMoneyYearStates.ts, apps/frontend/src/lib/committeeMoneyPreferences.ts, apps/frontend/src/lib/campaignMoneyDetailsPageCopy.ts, apps/frontend/src/lib/campaignMoneyPreferences.ts, apps/frontend/src/lib/groupedOutsideSpendingCopy.ts, apps/frontend/src/lib/committeeOutsideSpending.ts -->

# How the Money in politics section works

<!-- describes: apps/frontend/src/lib/moneyLandingSources.ts -->

**Net.** `/money` is the public front door to Minnesota's campaign-money and lobbying records, open to
everyone with no sign-in. Typing a name in the box on it now works, the register of
committees has its own browsable list, every committee page is reachable by browsing rather
than only by pasting an address, and a name that got paid opens every payment filed under
that exact spelling
([#1780](https://github.com/alethical-org/alethical/issues/1780)). Our own signed research
lives one level up, on the `/read` page, which the money landing points at. One piece is
published there.

Lobbying is available at `/money/lobbying`, with the copied lobbyist list, represented
organisations and yearly spending. The earlier lobbying-under-development strip is removed
from every money surface in this release. The separate campaign and lobbying files keep
their own copy dates. Challengers remain at `/money/races`, and outside spending remains
at `/money/outside-spending`. See [lobbying-guide.md](lobbying-guide.md).

**"Report" means one thing on this site: the document a campaign files with the state.** Our
own writing is **Research**, and a short piece explaining 1 term is a **Guide** (settled
27 Aug 2026, [`docs/architecture/published-writing-decisions.md`](../architecture/published-writing-decisions.md)
§2.6). The `/read` page and its pieces were addressed `/money/reports`, then `/reports`, then
`/read` before landing on `/read` on 27 Aug 2026, and every one of those old addresses forwards
permanently and straight to the `/read` address it belongs to, never through the one in between.

## Ways in

Share is available on `/money/search`, `/money/payments`, committee payment lists,
`/money/races`, and both browse and subject results at `/money/outside-spending`.
The control sits beside the heading on wider screens and beneath it on phones.
It preserves the displayed year, section, search, filters, order, page, and valid
race anchor. Committee and legislator-money records keep their existing controls.
The landing and pure record-chooser directories do not gain Share buttons.
[How sharing works](sharing-guide.md) owns the contextual window headings and
non-repeating prepared messages.

- Choose **Search**, then **Money in politics** (marked with a green NEW chip) in the shared
  top menu, on a computer or in the phone menu.
- Choose **Money in politics** on the homepage card headed **Follow the money**.
- Open `/money` directly.
- Type a name into the box on `/money` and press Enter or the Search button, which opens
  the results page at `/money/search?q=…`.
- Open `/money/committees` directly for the whole register, or `/money/search?q=…` for a
  search somebody shared with you.
- Open a name that gave or got paid from a search result, which opens
  `/money/payments?name=…&role=…` — a link somebody can share, showing the same list.
- Open `/money/outside-spending` directly for the record of what outside groups spent
  supporting or opposing committees, or `/money/outside-spending?about=<registration
number>` and `?spender=<registration number>` for one committee's or one group's view of it.
- Open `/money/races` directly for every candidate committee grouped by the seat it runs for,
  or `/money/races#house-12a` for one contest.
- Open the **Money by race** or **Outside spending** card on `/money`, the 4th and 5th cards in
  the lane row, which lead to those 2 pages.
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
sending anyone to.

**A reader gains from it too.** Writing those words means reading the same records the page
itself needs, so the records travel in the same response and the page draws them at once.
Before, the page asked for the identical records a second time and a reader watched a loading
state for about half a second longer, or as long as 3 seconds when our own caches had gone
cold. No figure changes on the way: the records arrive exactly as the data service sent them,
the page reads them with the same code it uses for records it fetches itself, and each set
arrives whole, so a figure and the freshness date beside it always come from one reading of
the files. If any of it is missing or unreadable the page just asks for the records itself.

## The landing page (`/money`)

The heading, browser title and shared-link title name this destination **Money in
politics**. Every link or empty-state button returning to `/money` uses that same
name, including committee and lobbying pages. The homepage invitation and narrower
Campaign money tabs keep their separate wording, as defined in
[site-navigation-guide.md](site-navigation-guide.md#the-name-of-money).

Top to bottom:

1. **Money in politics**, followed by “Search Minnesota’s published campaign
   donations, payments, and lobbying records”.
2. **A working search box.** Its placeholder is “Search a name”. Enter or Search opens
   `/money/search?q=…`; typing alone does not add browser-history entries. The note
   reads “Try all or part of a name: a person, committee, payee, or lobbyist”.
   Clicking inside the drawn field focuses it; arrival never does. Matching accepts
   partial names without guessing spelling corrections. A short query reaches the
   results page, which explains its 3-character minimum.
3. **6 navigation cards**, in this order: Legislators, Committees, Who got paid,
   Money by race, Outside spending and Lobbying. Every card opens its named route.
   Who got paid opens name search and has no count, dash or placeholder.
   Counts come from their own successful data blocks, never pasted examples
   or a missing value turned into 0.
4. **Research**, immediately after the cards. A pale-green feature carries the newest
   research piece’s title, standfirst and publication date, with a white “Read the
   research” button opening the piece. The records-through date stays on the piece
   itself. Guides are not selected for this feature. With no research published,
   the same green feature reads “Nothing is published yet”, with no count or link.
5. **Sources and copy dates** and **Limits of the campaign records**, described below.
   They are separate white boxes, side by side at 1100px and wider and stacked below.
6. **Recently filed reports**, described below.

A thin divider appears above Research, above the 2 explanatory boxes and above
Recently filed reports. The boxes explain the records, not the Research feature.

### Navigation cards

The card descriptions are:

- **Legislators:** “Each legislator’s campaign donations and payments, with their
  committee match confirmed” when all sitting members have current confirmation.
  Partial confirmation retains the served counts and explains that unconfirmed
  profiles show no figures. Unavailable or expired confirmation makes no claim.
  The card’s count is sitting members.
- **Committees:** “Browse campaign committees, party units, and political funds”.
  The count is registered filers.
- **Who got paid:** “Every payment filed under a name, as spelled on the filing”.
  The card has no count.
- **Money by race:** “Candidate committees’ filed figures, grouped by the seat”.
  The count is contests, using the same office-and-district groups as `/money/races`.
- **Outside spending:** “Money spent for or against candidates, without their campaigns”.
  The count is rows in the independent-spending file, not the sum of their payments.
- **Lobbying:** “Who is registered to lobby, who they represent, and what is reported spent”.
  The count reads “{count} REGISTERED LOBBYISTS” and comes separately from
  `/api/v1/lobbying/summary`.

There is no browse-all-payees list. Minnesota supplies printed payee names rather
than stable identities. Ranking those spellings by money, activity or recency would
also mix committees with different filing periods, contrary to
[grounded-answers.md rule 12](../../.claude/rules/grounded-answers.md).
Who got paid therefore opens the name search.

Cards form 6 columns from 1440px, 3 from 1100px, 2 from 768px and 1 below 768px.
Arrows keep their own space and counts may wrap. The search button stays beside
the field on tablets and sits below it on phones. The Research button spans the
available width on phones. Numbers use Libre Franklin with equal-width digits,
including dates and counts; a drawing’s dotted or slashed zero never overrides
[design-principles.md Type](../design/design-principles.md).

### Sources and copy dates

The attribution reads “Records from the Minnesota Campaign Finance and Public
Disclosure Board”. The campaign payment copy date and lobbying copy date each
come from their own source. A missing date never borrows another source’s date or
a reporting-period date. Timestamps print as their Minnesota (Central time) day.
The note reads “Each report shows the dates its figures cover”.

“View source links” opens the source list inside this box and changes to “Hide
source links”. It starts closed on each visit. This supporting disclosure uses
local open state, not address or saved browser state; it does not choose a report.
The control works from the keyboard and exposes its expanded state. The first
HTML response uses a closed native disclosure so the sources work without
JavaScript. External source links open a new tab.

The expanded groups follow the navigation order:

1. **Legislators, Candidate committees and Money by race.**
   [Candidate reports](https://cfb.mn.gov/reports-and-data/viewers/campaign-finance/candidates/)
   provide candidates’ campaign figures and filings.
   Find [candidate committees](https://cfb.mn.gov/reports-and-data/viewers/campaign-finance/candidates/)
   included in our Committees section through the same Board search.
   These 2 descriptions deliberately link to the same destination.
2. **Committees and Party units.** Reports for
   [committees and funds](https://cfb.mn.gov/reports-and-data/viewers/campaign-finance/political-committee-fund/),
   and [party units](https://cfb.mn.gov/reports-and-data/viewers/campaign-finance/party-unit/).
3. **Donations, Who got paid and Outside spending.**
   [Campaign finance downloads](https://cfb.mn.gov/reports-and-data/self-help/data-downloads/campaign-finance/)
   provide the individual donation and payment records.
4. **Lobbying.**
   [Lobbying downloads](https://cfb.mn.gov/reports-and-data/self-help/data-downloads/lobbying/)
   provide registered lobbyists, who they represent, and organisations’ reported
   lobbying spending.

The generic campaign-finance viewer is not the source-list destination.

### Limits of the campaign records

The `/money` box has these 4 bullets, in this order:

- Payment records start in 2015
- Donors who gave $200 or less in total for the year need not be named
- There is no complete directory of payment recipients. Names are shown as filed, and different spellings may refer to the same person or business.
- These files cover union political funds, not a union’s wider finances

The $200 test is a donor’s yearly total, not 1 gift, and sets when a name becomes
required rather than forbidding committees from naming smaller donors. This box
describes campaign records. Lobbying’s copied-list and held-year limits belong
at `/money/lobbying`. Sibling campaign pages retain their shared 3-line coverage
block; the new heading and recipient explanation belong to `/money`.

### Recently filed reports

The count line reads “Latest completed period: {count} reports cover through
{date}”, with singular wording for 1 report. Count and cutoff come from the same
served block and appear only when both are available. They describe that completed
period independently of the mixed-period report list.

On wide screens, the count line stays on 1 line and sits centered against the 2 lines of the
ordering explanation. On narrow screens, the 2 blocks stack and keep their compact spacing.

The ordering explanation follows the feed’s own ordering field:

- “Latest reporting periods first, then by filer name”
- “Newest first by received date.”
  “If missing, we use the reporting period’s end.”

The 2 sentences occupy separate lines. On wide screens, both lines are right-aligned so their
ending periods share the filing dates’ right edge. On narrow screens, the explanation and filing
dates both move to the left edge.

An unknown ordering field prints no guessed explanation. There is no “Never by
amount” clause, although the records still must not be ranked by amount.

Each complete report row links to its committee when its registration number
supplies a destination. The row contains the filer name, report name, covered
period and, when the Board supplies it, “Filed {date}”. The filed date sits to the
right on wider screens and on its own third line on phones. A missing filed date
never borrows the reporting-period end date. A missing registration number leaves
the row readable without an invented link.

The campaign summary, filings feed and lobbying summary are independent reads.
One failure does not blank successful blocks. Missing counts stay absent rather
than becoming 0. While data loads, grey placeholders pulse unless reduced motion
is requested, and screen readers receive a loading label. Dated records may remain
visible after a failed refresh; an expired current-confirmation claim does not.

## The search results page (`/money/search?q=…`)

One typed name, matched across the campaign and lobbying records we hold, grouped by
what each match **is**. The typed name is in the address, so a results page is a link
somebody can send, and the browser's Back button returns to it.

Matching accepts all or part of a filed name, preserving the typed spelling rather than
guessing a correction. There is no did-you-mean anywhere.
That is not caution: 178 registered filer names sit a single character apart from another
registered name, and every one of those pairs is a different organisation — the Green Party
and the Republican Party of the same district among them. A correction on this data does
not fix a typo, it hands a reader one organisation's money under another's name with
nothing on screen to reveal it.

**What the record does not cover sits above the results, not under them.** Somebody who
types a name, gets nothing, and is told nothing concludes that the person gave nothing,
rather than that we do not hold the record.

The original 5 campaign groups stay in this order, and each is drawn even when it holds
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

**A failed check never takes a correct answer off the screen.** Coming back to a tab that
has sat for more than 5 minutes rechecks this read, because its person rows say which
chamber, district and party somebody currently sits for. Where that recheck fails and the
answer to the name in the heading is still in hand, the results stay and a line above them
says what they are: "We could not reach our own data service just now, so these are the
last results we accepted for this name — held until it answers rather than expiring on a
timer", the same promise a committee page's own figures carry. The "we couldn't search
these records just now" card is kept for the case where there is no answer at all, because
a reader handed it cannot tell it apart from "nothing is filed under this name", and
inventing that distinction for them is the confusion this whole section is built to avoid
([issue 2048](https://github.com/alethical-org/alethical/issues/2048)).

**Changing the name shows those loading placeholders, never the last name's answer.** The
heading, the counts, the rows and the "nothing is filed" card are all claims about the name
in the box, so the page holds none of them past the moment that name changes. The
placeholders sit in the space the results held, so nothing a reader can see moves while the
new answer arrives.

The server answers this address with the page's own explanation and the "what this record does
not cover" lines, so a reader is told what the box searches before anything has run. It never
answers with a result for anything typed, and the address stays out of search results, because
what is in it is whatever somebody put in the box.

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

**Years lead, newest first, then the filer that filed each payment.** The year comes
from the filing's own year column, not from the payment date. Within a year, each
registration number gets a group, ordered by its newest payment. The group heading
uses the name on that newest row. Repeated rows remain separate payments.

**Only one filer and one year can have a subtotal.** A group with at least 2 payments
shows their combined amount and the number of payments beneath it. A single payment
shows its amount once. A missing amount withholds the group's subtotal. An unidentified
filer or filing year gets no subtotal. There is no year or page total, and no sum across
filers or filing years. The closing explanation about different filing calendars stays
with the list ([issue 2141](https://github.com/alethical-org/alethical/issues/2141)).

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

The group header names **the filer whose record carries the payments**, with its kind
and `Registration {number}` on one line. Contributions use the recipient type printed
on the row. Ordinary and independent payments use the kind in our held register; a
missing kind stays blank, and an independent spender is never assumed to be a political
committee. The name is a real link to `/money/committees/{name}-{number}` only when the
returned linkable-number list includes it. Otherwise the name stays plain text.

Each payment shows its own date, its exact filed employer for contributions or exact
filed purpose for either payee role, and its amount. No employer is lifted into the
page header. Loans and other non-donation receipt types keep their existing schedule
label. Donated goods and services keep their marker. A missing date stays blank rather
than borrowing a day from another row.

The year count says "{n} payments to {m} committees" for contributions, "{n} payments
from {m} committees" for ordinary payments, or "{n} payments from {m} spenders" for
independent payments. Counts describe the loaded records, never an inferred person's
complete giving. If a year contains a payment without a filer registration number,
its count says only "{n} payments"; separate unnamed rows do not prove separate filers.

Above the rows, one line says what is on the page, and it never says more than that. When
nothing is held back it reads "9 payments, from 7 committees" — both counted from the rows
themselves. When more are filed than we loaded it reads "Showing the first 250 payments,
newest first" and drops the committee count entirely: the server serves no count on a
name-keyed lookup, so "of 1,284" would be a number we invented, and a committee count over a
partial list would read as how many committees filed in all.

Rows arrive **newest filing year first, then newest payment date**, 250 at a time.
Missing dates follow dated payments inside their filing year, and record numbers break
ties without removing repeated rows. This order applies to these name lists alone.
The cap card says the cap is ours rather than the filings', and its button asks for
the next batch without claiming how many are left. While capped, the top count already
says "newest first", so the separate order label is absent.

The oldest visible year says **"This year may continue below the cap"** beside its
heading and **"{n} payments so far"** beneath it. More payments join the existing year
and filer groups, whose subtotals update. The warning moves to the oldest visible year
and disappears when no more rows remain. Pages from different source releases are
never combined; a failed next read keeps the existing rows and the cap, shows the
existing loading-error explanation, and lets the reader retry the complete reading.

At 1,100 pixels and wider the page has the computer layout; from 768 to 1,099 it uses
the tablet spacing and type sizes. Below 768 a payment's date and amount share its first
line and the employer or purpose sits beneath. Group headings and subtotals wrap rather
than pushing the page sideways. All 3 layouts use Libre Franklin for reader text and
numbers, with aligned digits on date and count lines. Committee links and buttons have
at least a 44-pixel target and a visible keyboard focus mark.

Its own states: nothing filed under that spelling ("Nothing is filed under '…' as spelled",
the same spelling advice the search gives, no nearest-match guess, and a button back to the
search); our copy of that download not answering, which says it is a gap on our side and
never that nothing is filed; a load failure; and loading placeholders that announce
themselves to screen readers. At the bottom, the same "what this record does not cover"
block the landing and the search carry.

## The committees list (`/money/committees`)

The whole register of everyone allowed to raise or spend money in Minnesota state politics,
ordered by the name as filed, A to Z. The address forwarded to `/money` until this shipped.

Above the title, “Money in politics” has a left-pointing arrow and links to `/money`.
The arrow and label are one link, matching the return link on an individual committee’s page.

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
   endless list. Previous and Next are ordinary links, and the
   page number is in the address, so the list a reader is looking at is one they can send and
   the Back button returns to it. This replaced a "Show the next 50" button on 27 Aug 2026:
   Google says plainly that it does not press buttons, so every filer past the first 50 had
   no link anywhere on the site and 1,553 of the 1,603 committee pages were unreachable to
   it. Asking for a page past the last real one shows the page-not-found screen rather than
   quietly snapping back to the last page that exists.

Every row opens its committee **by registration number**, not by name, so a committee that
changes its name keeps its address.

**Two widths, one switch at 768 pixels, and the rows change shape across it.** On a computer
each row is its own card, with the registration number and an arrow at its right. On a phone
the list is hairline rows inside one card, and a row's fields stack under its name in the same
order: the kind, then the registration number as a third line. No field is dropped at phone
width, and nothing on the page stays pinned to the screen as you scroll. The search results
and a committee's all-payments view draw their rows the same way, from the same shared piece
(`apps/frontend/src/components/campaignMoney/MoneyListRows.tsx`); on those, a payment's date
and amount go under the name, left-aligned, on the phone. The `/money/payments` view uses
its own year and filer groups across 3 layout bands, described in its route section above.

Its own states: nothing matches the typed name (with the spelling advice, no nearest-match
guess, and a way to drop the filter); our copy of the register could not be read at all
(said as our gap, and never as a claim that Minnesota registers nobody); and loading
placeholders that announce themselves to screen readers.

## Money by race (`/money/races`)

Candidate committees in Minnesota’s register, grouped by office and district or court
seat. The introduction explains that a committee is the account used to raise and spend
campaign money. “Registration does not show who is on the ballot” stays visible above
the counts. This list reads the register directly; it does not use a person-checked
match to a legislator.

3 rules govern `/money/races`:

- **Count committees, never add their money.** Each group heading counts its committees.
  “We do not add committees’ money together. Transfers between committees could otherwise
  be counted twice.” appears below the list.
- **Keep the served order.** “Office, then district or seat, then name A–Z” describes
  the order above the groups. Districts follow their numeric order, and names follow the
  spelling on the register. The finder never sorts by amounts or changes committee order.
- **Keep each figure with its own dates.** “Total contributions” is the contribution
  total from the committee’s filed report. “Itemized contributions” is the sum of
  contributions with named givers in our payment records. Both labels and definitions
  appear at each group. The official figure says “Figures for Jan 1, 2026 to Jul 20,
  2026”, or “Figures through Jul 20, 2026” when no start is held. The named figure says
  “Payments dated Feb 3, 2026 to Jun 15, 2026”. These dates are examples, never fixed
  product values. A missing date is never filled from the other figure.

Top to bottom:

1. **Counts and register date.** The count line describes the groups currently shown,
   such as “1 contest · 28 candidate committees” after choosing Governor. “Register dated
   Aug 12, 2026” is a separate line, using the served register date. Office-button counts
   still describe the whole register. No example count or date is stored in the screen.
2. **All office buttons stay visible.** The register supplies the office names and their
   global counts, with “All offices” first. The buttons wrap rather than hiding choices
   inside a menu. The selected office is in the address (`?office=Senate`); a `year`
   already in the address is retained when the office changes.
3. **“Find a district or court seat”.** Typing shows matching groups from the selected
   office, or every office when All offices is selected. Each typed word must match the
   group’s office, district, or seat label; letter case and extra spaces do not matter.
   The finder searches groups, not committee names or registration numbers. It has no
   result cap and keeps served order. It is absent when the shown groups have no district
   or seat, such as Governor alone.
4. **Choosing a group jumps to its heading.** A suggestion, Enter, or “Go to district or
   seat” scrolls to the complete group and moves keyboard focus to its heading. Up and
   Down choose a suggestion; Escape closes the suggestions. The chosen group enters the
   address as an existing target, such as `#house-12a`, while office and year remain.
   Opening that address and using browser Back or Forward return to its group. Changing
   offices clears the old target and finder text; changing years resets the finder too.
   No committee rows disappear when the finder is used.
5. **Year and reading notes.** “Money figures are for 2026” uses the selected year. The
   warning stays visible: “The report and payment records can cover different dates. Read
   the dates beside each figure before comparing amounts.” The full shared donor-naming
   paragraph follows before the groups, including its spelling “party organisations”
   and the rule about a donor’s yearly total exceeding $200. It is not moved into a
   hidden explanation or the footer.
6. **Every group and every committee.** There is no folded group or “show more” limit.
   Each row has its complete filed name linked by registration number, “Registration
   {number}”, a closed date where the register supplies one, and both figure positions.
   Court headings distinguish districts and seats: “District Court · District 4 · Seat
   12”, “Appellate Court · Seat 7”, or “Supreme Court · Chief justice”. Unfamiliar seat
   wording stays as filed. A group whose official totals cover different periods says:
   “The reported totals in this group cover different periods. Each total shows its own
   dates.”
7. **“Payment files copied {date}”.** This is the copy date of the payment download used
   for the named figures. It does not claim when official totals or the register were
   copied, and it is absent when that date is not held.
8. **“What these records do not cover”.** The 2 lines are “No campaign payments held
   before 2015” and “Donors who gave $200 or less in total for the year need not be named”.
   The unrelated line about a union’s wider finances is absent from `/money/races`.

A missing official total reads “We do not hold a usable official total for this committee
for this year”. Missing named contributions retain “Not reported”, followed by “No named
contributions in our payment records for this committee for this year”. An unavailable
named figure reads “We couldn’t load this figure”. None of these states prints a date on
an absent amount or substitutes $0. A held, reported zero remains $0.

The finder’s no-match state says “No matching district or court seat in our records”,
followed by “This means we hold no group with that name. It does not mean the district has
no candidates.” An empty register and a failed read also describe our records, not who is
running. While an office or year change loads, old rows and top counts are withheld so
they cannot be read under the new choice. Office buttons remain available.

There are 3 layouts: below 768 pixels, from 768 through 1099, and 1100 or wider. On the
2 wider layouts the money columns are fixed at 200 and 250 pixels respectively, keeping
amounts and dates aligned across rows. Below 768 the name, registration, closed date and
2 labelled figures stack in order. Long names wrap without losing text. Reader text and
numbers use Libre Franklin, with equal-width digits on amounts, dates and counts. The
shared navigation and footer keep their existing appearance.

## A legislator's Campaign money tab (`/legislators/<name>?tab=money`)

The September 2026 profile redesign is tracked in
[issue 2140](https://github.com/alethical-org/alethical/issues/2140). The full profile behavior,
including the committee-confirmation deadline and every withheld-figure state, is in
[legislator-campaign-money-guide.md](https://github.com/alethical-org/alethical/blob/main/docs/product-onboarding/legislator-campaign-money-guide.md).

This route shows each confirmed legislative committee separately. Its year buttons run
from the current calendar year back through 2015, so 2026 offers 12 years, newest
first. They form 1 wrapping group with 1 normal-weight **Year** label. The label
and numerals use weight 400; buttons use 10px rounded corners and at least a 44px
target. The selected year has a black fill and white text on both the profile and
committee record. Dashed outlines use
the actual answers for those years to mark named-only coverage; they do not assume an
older year lacks an official report. These style answers never renew the 20-minute check
on whose committee is being shown. The 2022–2026 replacement of the held filing totals is
tracked in [issue 2142](https://github.com/alethical-org/alethical/issues/2142).
The replacement remains held because the new Board feed omits an existing 2026 record;
the year buttons do not mean its totals have been published.

The prominent donor chart shows shares of cash money by donor kind. A checked split uses
the official cash total and includes unnamed cash. With no official total it uses the
complete named cash list and says “named donations only”. Goods and services stay in the
named amounts and rows, with 1 explanation under the chart, but never enter cash shares.
There is no separate unnamed percentage under the profile's summary amount. Missing,
unsafe or incomplete figures retain their own explanation instead of a misleading circle.

The fixed tabs are Individuals, Lobbyists, Committees & Funds, Party Units and Expenditures.
An Other kinds tab appears immediately before Expenditures only where a contribution has another kind.
Contribution tabs keep chart order, with money out last, regardless of the figures. Candidate Committee rows
sit in Committees & Funds and retain their filed kind. Contribution tabs include only
`Contribution` receipts. Each group is 1 exact name within 1 committee, year and tab;
spelling variants are not joined. Counts distinguish printed names from payment rows,
not people. Missing-name rows stay readable and do not add to the name count.

Every page of received and made payments must load from one release before list totals
and counts appear. Showing 10 groups first is a display limit, not a partial-data total.
The search works within the loaded tab. Sorts are largest, smallest, name A to Z, newest
and oldest, with missing dates last. Search leaves whole-tab counts and totals unchanged.
Opening a group shows all its payments. Repeated-looking payments are kept. A committee
name with a known registration destination is a real link; private names stay plain
text on this profile. The exact-name lookup on `/money/payments` groups payments by year
and filing committee or spender. That lookup does not establish a donor's identity or
show donor overlap.

After each committee's payment browser, **More on this year’s contributions** groups
its report comparison, individual geography and exact-name comparison into independently
opening rows. History and refunds follow that panel for the same committee. The profile's
**Committee details and filings** link opens that committee's `tab=filings` view while
retaining the selected year for a return to Campaign money.

Outside spending follows the selected year and groups payments by spender within each
direction. Supporting and opposing totals remain separate, and never enter the
candidate's own figures. Before refunds and outside spending, each committee has its own
history of itemized cash shares from 2015 through the current year. The history loads after the selected lists
and appears only when every year is complete and from the same release. It never adds
committees together or turns missing rows into a reported zero.

The chart categories match the donor tabs, with other candidate committees included in
Committees & Funds. Original source kinds remain on payment rows. The existing
whole-dollar formatter stays, while arithmetic retains every decimal place. These
decisions were approved on 12 September 2026. The donut, its legend and the history bars
use the final shared solid colour map. The shared missing-official-total wording comes
from [pull request 2155](https://github.com/alethical-org/alethical/pull/2155).

## A committee's page (`/money/committees/{name}-{number}`)

One committee's money for one year, from Minnesota's own filings. The number at the end
of the address is the committee's registration number with the state, and it is the only
part that has to be right: committee names collide and numbers do not, so an old or
misspelled name part still lands on the right page, and the address then quietly corrects
itself to the current spelling. The chosen year, section (Campaign money, Filed reports or
Independent spending), donor category and sort ride in the address, so a shared link opens the
same view.

The identity card, reporting-period panel, section controls and record cards share
one outer left edge. The header uses a white background. The identity and
reporting-period panels use the same side insets as the shared contribution panel: 32px at 1100px and wider, 26px from 768px to
1099px, and 18px below 768px. Their top and bottom padding is 18px.

**Campaign money**, **Filed reports** and, where records exist, **Independent spending**
are selected directly below the identity and ownership information. An explicit
`tab=by` address retains Independent spending while its records load or fail. The
section controls precede the year choices. Filed reports and Independent spending
cover all years: neither shows the money-year controls, period panel, Money in,
Money out, donor threshold or campaign-money source footer. Returning to Campaign
money restores the selected year and donor choices.

Campaign money, top to bottom:

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
   own termination date, on every year's view. Other kinds use “Registered as:” before
   the register’s own category, without changing the category itself.

   Beside the Share control, a signed-in reader sees **Track**: one button that adds this
   committee to their Tracked page and, pressed again, removes it. Once followed it reads
   **Tracked** with a check, and a line under it says "On your tracked list", linking there.
   Following is a bookmark and nothing more: nobody is notified of anything, and the
   Tracked page lists the committee under its own heading rather than saying whether it
   changed. A visitor who is not signed in sees no Track control on this page at all;
   following a committee while signed out is deliberately not built
   ([#1943](https://github.com/alethical-org/alethical/issues/1943)).

2. **Whose committee it is.** The committee’s filed money and the claim about whose
   committee it is arrive independently. The money read follows the registration
   number and chosen year; the confirmation follows the registration number alone.
   Choosing a year or refreshing figures never renews a confirmation.

   While the first check is pending, the line reads “Checking whose committee this
   is…”. If that check fails, it reads “We could not check whose committee this is.
   The money shown here is the committee’s own filed record.” The figures remain
   readable. The first HTML response requests both answers together; a failed
   confirmation prevents that partial response being saved for later readers and
   leaves the browser to retry it.

   After a successful check returning no confirmed member, a candidate committee says:
   “These are this committee’s own figures. We have not linked them to a person; the
   committee’s name alone does not prove whose it is.” Party units, caucuses and ballot-question committees retain their separate
   explanations. A political committee or fund has no extra sentence repeating the
   registered kind already above its name. When that leaves no useful ownership
   content, the ownership container is absent too. Candidate ownership explanations
   and confirmation details remain.

   A confirmed candidate committee says: “A person at Alethical checked Minnesota’s
   records and confirmed this is {name}’s committee. These figures cover this committee;
   the candidate may have others.” No software name match creates that confirmation.
   A thin line separates this introduction from “Checked {date}” and
   the link to the member’s Campaign money tab. Alethical is named in the introduction
   rather than repeated beside the date. The profile’s own account boxes still name
   Alethical beside their dates, because they have no such introduction.

   Evidence is drawn only from the saved decision, never inferred from current records.
   It may contain fewer than 3 lines. Missing evidence stays absent. The link has a
   minimum 44px click or tap target and stays visible below the check date. The evidence
   follows it behind **How Alethical confirmed this**, initially closed. The member
   link retains `tab=money&year=<year>`. A failed or expired confirmation removes the
   unsupported person link and the evidence disclosure together.

   A committee somebody looked at and
   ruled out reads exactly like one nobody has looked at yet: that decision is about our
   own proposal, and it is not a claim about the committee.

   **And the naming has a shelf life.** A confirmation can be taken back, so the page
   only repeats one it has been able to check inside the last 20 minutes. Past that it
   asks our data service again; if that answer cannot be got, the card stops naming the
   member, removes the member link and the evidence of who checked the match, and
   keeps the existing explanation that the confirmation could not be rechecked.
   Every figure stays where it is with its own dates. It never falls back to the "nobody has confirmed one"
   sentence, because somebody has, and saying otherwise would be plainly false. In
   ordinary use the recheck runs behind the accepted figures. A reader whose
   connection or our service has failed gets the withheld version rather
   than a name nobody is standing behind. The deadline and the arithmetic behind the 20
   minutes are in
   [`docs/operations/page-load-performance-decisions.md`](../operations/page-load-performance-decisions.md)
   under "How old a current claim can be, end to end"
   ([issue 2023](https://github.com/alethical-org/alethical/issues/2023)).

3. **A year switch**, with every year from the current calendar year back through
   2015 in 1 group, newest first. Each year has its own address and stays visible,
   including a linked older year. There is 1 **Year** label, no earlier-year
   disclosure. The label and Libre Franklin numerals use normal weight 400, with
   equal-width digits. Buttons have 10px rounded corners and at least a 44px target.
   The selected year uses a black background and white text; other years use white
   with a dark border. The group wraps on smaller screens. The legislator profile
   uses the same treatment.
4. **The period panel**: what the committee's own report covers. The end is read off the
   filing; the start appears only when the Board's own published filing calendar prints
   one against that end (so "Figures for Jan 1, 2026 – Jul 20, 2026"), and otherwise the
   panel says "through" alone — a start is never assumed, because a special-election
   filer's period does not open on 1 January. Beside it is the link to the
   committee's filed reports on the Board's own site. The note at the foot names both
   source-copy dates: “Minnesota’s payment files copied Sep 1, 2026;
   report totals copied Aug 11, 2026. These are copy dates, not reporting periods.” The payment
   date comes from the stored bulk-file download time (`fetched_at`); the report date
   comes from the published filing source's own stored fetch completion time
   (`filings_copied_at`). Neither a report's receipt date nor a later publication
   of stored records replaces that source date. Neither says when the register was copied.
   Both dates print in Minnesota time. Without a report-copy date, it reads:
   “Minnesota’s payment files copied Sep 1, 2026. This is a copy date, not a reporting
   period. The report totals were copied separately.” The committee's footnote
   uses regular weight 400 and 15px text. The same date distinction appears on the
   committee's every-payment view and in the first response served for both addresses.
   The filing's period and link live here, once,
   above both money cards and never inside one: one filing produces both
   cards, so stating any of it per card would state one fact twice. A party unit's panel
   says its calendar is its own. If our own data service stops answering, the page keeps
   the figures it already had and says they are held until it answers — never expiring
   on a timer.
   The filing explanation uses the available width inside the card and wraps
   naturally on phones. Its standalone source helper and Board-record sentence
   omit their final periods, including when they wrap. Separate text units inside
   this panel do not become a paragraph merely because they share the panel.
   The source link inside the committee's period explanation uses dark green
   (`#0f7a45`) and gains an underline on hover or keyboard focus. The legislator
   profile's source link keeps its standing underline.
5. **Who gave**, above the summary cards. This is the same chart as the legislator tab,
   read for this registration number and selected year. A safe, checked split includes
   Non-itemized contributions as its own grey slice. Without an official total, the chart
   says “named donations only” and divides the complete named cash list. A withheld split,
   failed read or incomplete list gets its own explanation, never a partly drawn whole.
   Cash determines the slices; donated goods and services remain in the named amounts and
   payment rows, with their explanation under the chart. The solid colors, category order
   and legend are shared with the legislator tab.

   **Its opening paragraph is the one place both money-in labels are explained**
   ([#2182](https://github.com/alethical-org/alethical/issues/2182)), and a
   ballot-question committee's copy of it carries $500 rather than $200. **No legend row
   is a link, a button or a tab stop**: reaching a category's names is the job of the tab
   strip below, and the circle itself carries the text alternative naming every kind and
   its share.

   This view reads no legislator link to establish whose figures to show. The committee
   registration number is its scope, including when no member is confirmed or a previous
   confirmation expires. It does not load the profile's 12-year mix chart.

6. **Money in — two numbers, both correct.** "Total contributions", the total the committee
   itself reported to the state, drawn only when the filing's total exists, and "Itemized
   contributions", the donations we can list with a donor's name, drawn always — a real
   amount or the words "Not reported", never a blank. The reported figure is the filing's
   **cash** column, which is what the Board's totals service serves, so where that column is
   $0 and every named donation was goods and services the figure is not drawn: the page
   shows the in-kind donations and says it holds no official total it can stand behind
   rather than printing a $0 the filing's own Total column contradicts (16 committee-years
   across 2024 to 2026, 11 Sep 2026). The labels are the filing's own words
   (ruled by Eugene, 11 Sep 2026). Where a summary is used without its chart, a fixed sentence directly under the itemized figure says what it is and states
   the naming rule. On most pages it reads exactly:

   > Donations where the filing names who gave. Named donors include people, lobbyists,
   > other campaigns, political committees and funds, and party organisations. Minnesota
   > requires a committee to name a donor once that donor has given more than $200 in
   > total for the year; a committee may name a smaller donor but does not have to.

   On a ballot-question committee's page the last sentence reads instead: "Minnesota
   requires a ballot-question committee to name a donor once that donor has given more
   than $500 in total for the year, which is a higher line than the $200 a candidate's
   committee carries; a committee may name a smaller donor but does not have to."

   The split into named and unnamed money is decided by the server before the page ever
   sees it, and the page never subtracts. When the split is safe, the "Non-itemized
   contributions" figure appears, and away from the chart it carries one sentence of its
   own, the same for every kind of filer and repeating no threshold: "Donations inside the
   committee's reported total whose givers the state's public file does not name". Beside
   the chart both labels are explained once in its opening paragraph instead, and the card
   is figures only. The chart uses that split only after
   the complete named cash rows agree with it. Receipts that are
   not contributions (a public subsidy, interest, a loan) sit under a "Not a contribution"
   heading
   with the state's own label; **a row the state types `Miscellaneous` is not drawn, and
   with no other row the heading is not drawn either** (ruled 11 Sep 2026). There is
   no generic downloads footer after the
   payment section. The Board record link remains in the period panel, and the
   outside-spending card retains its own downloads link and source filename. The official figures
   share [MoneyCards.tsx](https://github.com/alethical-org/alethical/blob/main/apps/frontend/src/components/campaignMoney/MoneyCards.tsx)
   with the legislator profile. Both put the donor chart first, keep the goods-and-services
   explanation under that chart and omit a separate unnamed percentage below the summary.
   Money in, Money out and any additional financial summary card use the same
   grey `c.tile` surface as the profile. Filed reports and Independent spending
   carry no money summaries. Supporting
   explanations remain regular weight even when they contain a dollar amount or date.
   On phones, the committee's money summaries leave 20px between their main
   elements. The non-itemized figure and its explanation stay together with an
   8px gap when that explanation is shown.
   In each case where a split would state something false — the two figures cover
   different periods, the sources disagree, our copy of the donation list is missing
   named money the filing carries, the committee corrected its report after we copied the
   official total, the two figures simply will not line up, there are no named payments,
   or there is no reported total — the page shows the figures it has and a plain sentence
   saying why it will not divide them, never saying which figure is larger. A committee
   whose own report says zero shows $0 with a sentence saying that is the filing's
   zero, not our gap.

   **Only one of those sentences says Minnesota's two publications disagree, and until
   19 August 2026 three of them did.** A committee-year where the donation list holds no
   row at all, and one where a subtraction simply came out negative, both printed "for
   this committee and year they do not agree" — which blamed Minnesota for gaps on our
   side. Seven live committee pages carried it, Kristin Robbins's governor committee
   among them ([#1682](https://github.com/alethical-org/alethical/issues/1682),
   [#1648](https://github.com/alethical-org/alethical/issues/1648)). Each route now says
   only what its own evidence supports; the sentence about a disagreement over donations is
   left to the one check that actually compares the 2 publications about donations. Money out
   has its own such check, described in item 7, and the 2 must not be read as one. The full
   list of states and
   their counts is in
   [`legislator-campaign-money-guide.md`](legislator-campaign-money-guide.md), which
   records the shared figure states and the profile's distinct layout.

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

7. **Money out shows only the official figure.** “Expenditures” is the committee's
   reported money-out total for the period, including a verified $0, with its own period
   note where that differs from the period panel's. A zero carries its own sentence:
   “The committee’s own report states $0 in expenditures. That is the filing’s own zero,
   not a gap in our records.”

   With no official total, the card shows no amount and only **“We do not hold an
   official spending total for this committee for this year”**, which names Alethical's
   data gap rather than claiming that the committee failed to file. The same sentence applies whether
   the named-payment rows contain an amount, a measured zero, no payments, or an
   unavailable amount. Empty and closed committee-years use it too, while the identity
   and money-in card retain their own explanation.

   Calculated sums belong beside their payment rows, never on the summary card. Named
   payments can include transfers to other committees and goods and services; their rows
   remain on the Expenditures tab and the every-payment page. The comparison against
   the filed report still runs and is served, but the card prints no verdict. A held
   official total stays visible even when that comparison is unproved. The shared
   wording and source details are in
   [`legislator-campaign-money-guide.md`](legislator-campaign-money-guide.md), under
   Money out and Where the data comes from.

8. **The donor and payment browser**, under the summaries. The fixed tabs are
   Individuals, Lobbyists, Committees & Funds, Party Units and Expenditures; Other kinds
   appears immediately before Expenditures only when the received Contribution rows need it. Other candidate committees
   sit under Committees & Funds and retain the filed kind on their rows. The donor tabs
   include only receipts typed Contribution. Other receipts remain reachable through the
   **View receipts and expenditures** link following the browser. It opens
   `/money/committees/<slug>/payments?tab=gave&year=<year>`, preserving the chosen
   year. That destination's 2 direction choices expose received and outgoing
   payments. Receipts include non-contribution money, such as loans, so the link
   must not call all received payments contributions.

   Every page must arrive from the same release before counts, sums, grouping or sorting
   claim a complete list. Failed reads keep the load-failed words and withhold those
   figures, never the sentence saying the file names no payments. Each exact printed name
   groups only this committee's payments in this year and category. Different spellings
   stay separate, and repeated-looking rows are kept. Counts say names and payments,
   never donors. A light band uses the chosen donor kind's colour at 12% opacity and
   labels donor totals “Total itemized contributions”; Expenditures uses `#4f5651` at
   12% opacity and reads “Total itemized expenditures”. Neither label has a colon. The
   amount lines up with the payment amounts below, and a goods-and-services note wraps
   beneath it without moving that amount. The outgoing-payment naming
   threshold remains $200 for every filer kind, including ballot-question committees;
   the $500 ballot-question threshold applies to incoming donations instead
   ([Minnesota Statutes 10A.20, subdivision 3(h), (q)](https://www.revisor.mn.gov/statutes/cite/10A.20#stat.10A.20.3),
   retained in [2026 chapter 101, section 14](https://www.revisor.mn.gov/laws/2026/0/101/laws.0.14.0#laws.0.14.0)).

   Search narrows the loaded names without changing the tab's whole count or total.
   Sorts are Largest first, Smallest first, Name A to Z, Newest first and Oldest first.
   A group opens its underlying payments, including dates, filed employer or purpose,
   amounts and donated-goods markers. Known committee numbers open their committee
   addresses. These controls and words are the same components as the legislator tab.
   A year change keeps the category and sort but clears search, open rows and display cap.
   The category and sort ride in the address, such as
   `?year=2025&category=committees&sort=smallest`, so Share, a copied address, reload and
   Browser Back restore the same donor view. Defaults are omitted from the address.
   Changing the category or sort rewrites the current visit's address without adding a
   Back stop, and keeps its saved scroll position. Opening a different committee starts
   at its title; Browser Back restores the category, sort and position left on the source
   visit, even after different choices on the next committee. A fresh address with no
   donor choices starts with Individuals and Largest first. An older `tab=spent` address
   starts with Expenditures unless an explicit category selects something else.
   Section and year controls retain these choices, including the implicit Expenditures
   choice on an older address. The first HTML response keeps them on its Year and Filed reports
   links too; the separate every-payment addresses retain their own existing parameters.

   The section selector uses unboxed 17px labels above a shared thin line. A dark
   3px underline marks the selected section. Controls keep at least a 44px target
   and wrap when needed. The saved `gave`, `filings` and `by` values remain valid.
   An older `tab=spent` link opens Expenditures; `tab=about` opens the selected year's
   grouped outside spending. The separate `/payments?tab=gave|spent&year=…` addresses
   retain their complete received and outgoing lists.

9. **More on this year’s contributions**, after the **View receipts and expenditures** link. This shared
   panel contains **What the committee’s own report says**, **Where itemized individual
   contributions came from**, and **Contributor names also listed for other candidates**,
   in that order. Each row starts closed on a fresh address, and several can stay open.
   Open rows are recorded in the address for the selected committee and year. The
   existing tables and qualifications appear under their row without a repeated title.
   A party unit or political committee or fund omits the candidate-report comparison;
   noncandidate committees omit individual geography. Missing or failed data for an
   eligible row stays visible as that row's own explanation. One unavailable comparison
   does not erase an independently available geography or names result. Opening a row
   reuses the selected-year records already requested, rather than making a new request.
   The whole heading row remains clickable and keyboard-accessible. Its purple
   focus ring surrounds the arrow's rounded 44px area, with the arrow centred and
   no second keyboard stop.

10. **Spending by outside groups**, after the shared contribution panel. It
    follows the selected year and groups spending about this registration number by
    spender, with supporting and opposing separate. Each spender's chip reads
    **Supporting**, **Opposing** or **Not stated**, in the same words the row gives a
    screen reader, rather than the filing's own For and Against. A spender on both sides
    keeps both groups.
    Missing spender numbers group only by exact filed name. Every group can open the
    complete payments from the same source copy. The chart and source dates for the
    committee's own money do not establish the outside file's date or completeness.
    A failed grouped read keeps any independently served figures and says the list
    failed; it never invents a count of spenders.

11. **What this record covers** contains 3 standalone lines:

    - Campaign finance reports filed with the Minnesota Campaign Finance and Public Disclosure Board
    - Campaign finance figures in our copy start in 2015
    - Committees need not name contributors who gave $200 or less in total during the calendar year

    A ballot-question committee uses the same last line with **$500** instead of
    **$200**. Each page states only its own figure, because
    the risk is a reader taking one kind of committee's line for another's. $500 is what
   the law says for a ballot question and what the Board's own guide for those committees
   says, and it went up on 31 Aug 2026 after a check of both. Before that these pages
   printed no figure at all and explained the gap by saying official sources disagreed
   about it, which was not true: the $200 came from a guide written for a different kind
    of committee.

### Filed reports

The `tab=filings` view starts with **Reports this committee has filed**, **All years in
our copy**, the known filed-report count, and **The Board’s record for this committee**.
The Board link stays available while the list loads, is empty, or fails. No report
count is invented while its answer is unknown. The list is separate from the
Campaign money year and contains no selected-year amounts.

One shared list uses thin separators. Report names and periods sit left on wider
screens, with filing metadata right; phone rows stack them. Actual filing dates and
AMENDED labels stay at 15px. A row may show both: the date comes from its filing
record, while AMENDED means the committee filed a revised version. Neither a period
end nor an amendment version supplies a missing filing date. A closed committee's
final report remains visible even if its period ends after today.

The order explanation precedes the list: “Newest first by filing date, or by the
reporting period’s end date when no filing date is available”, or “Newest first by
the reporting period’s end date” when no records carry filing dates. That decision
uses the whole history, not just the loaded rows. Each period uses both dates only
when the Board's calendar supplies the start; otherwise it says “Covers through”.
No January 1 start is guessed. Rows have no link or OPEN action because the Board
serves documents through its own viewer, not stable per-report addresses.

After the list, show “Amended means the committee filed a revised version” when a
loaded row is amended, and “Filing dates appear only where our records include them”
when a loaded row lacks its date. Keep the explanation of where period dates come
from. Print the existing unestablished-filing explanation only when the known
excluded count exceeds 0; those catalogue entries never enter the filed-report count.

Loading says **Loading reports**. A failed initial read offers **Try again**. An empty
read says **No filed reports in our copy**, followed by: “The Board’s report catalogue,
as we last copied it, records no filed report for this committee. That is a fact about
the catalogue and our copy of it, not a statement about the committee.”

**Show more reports** becomes **Loading more reports** while pending and cannot fire
again. A failed next page retains the rows already shown and offers **Try again**,
with “We couldn’t load more reports. The reports already shown are still available.”
The only copy-date footer here is **Minnesota’s report catalogue copied {date}**, from
the report-list response's `as_of`. It stays absent when no successful response has
supplied that date. Donor thresholds and payment-file dates belong to Campaign money.

### Independent spending

The `tab=by` view shows this committee's spending about other committees, with
**Payments from all years in the state’s file** under its heading. It keeps Newest
first and Largest first sorts and 50-row pages. Each row carries the other committee,
direction, purpose, vendor, filed type, payment date, amount and any unpaid part.
Missing fields keep their existing words. A link appears only where the held register
supplies a destination. This file is never added to ordinary expenditures: 491 source
rows coincide with an expenditure row, and the records do not establish whether those
are 1 payment filed twice or 2 payments that coincide.

**How every dollar amount in this section is written**, ruled 1 September 2026 and applied
across the whole design set:

- **Whole dollars, cents cut rather than rounded.** $178,579,449.67 prints as $178,579,449
  and $99.99 prints as $99, so no figure ever reads larger than the money it stands for.
  The filed amount to the cent stays one click away on the Board's own site. The one
  exception is an amount above zero but under a dollar, which keeps its cents: cut to "$0"
  a 50-cent row would read as a committee that reported nothing.
- **One typeface for money.** Every amount is set in the same face as the big totals
  (Libre Franklin). The legislator profile and `/money/payments` also use Libre Franklin
  for dates, registration numbers and counts, with equal-width digits. The shared donor
  and outside-spender components use those same equal-width digits on committee pages.
  The `/money` freshness date, research dates, and filed dates use Libre Franklin with
  equal-width digits too. The committee page also uses Libre Franklin with equal-width digits for registration
  numbers, closed dates, reporting periods, filing dates and payment dates. Dates and
  readable supporting text are at least 15px; reporting periods use dark 20px text.
  Short letter-only labels keep their existing typeface. Search and list screens retain
  their own presentation. Every future Design handoff follows the numeric typography
  rule in [design-principles.md, Type](../design/design-principles.md), even where its
  drawing uses a different numeric font. That rule does not require changing unrelated
  existing screens.
- **A standalone interface unit has no final period, even when it wraps.** A caption,
  date, label, helper, source line or list item containing 1 sentence ends after its
  last word. Separate units do not become a paragraph because they share a card.
  Paragraphs containing 2 or more sentences, legal text and serious warnings retain
  full punctuation. The coverage lines and Board-record sentence follow this rule.

Empty and edge states, each its own honest sentence: a year with no report figures in
our copy (the period panel says “We have no report figures for {year}” and “Our copy of
the state’s files contains no report figures for this committee for {year}. Figures from
another year are not substituted.”; money in
says “Not reported”; money out says Alethical does not hold an official spending total; neither prints
a zero or last year's money under this year's heading); a closed
committee's empty year (it closed, when, and that its final report exists and is public
even though our copy of the figures does not include it); a registration number in neither
our copy of the register nor the state's money files (a fact about our records, never
"this committee does not exist"); and loading placeholders that stop pulsing under reduced
motion and announce themselves to screen readers.

## Every payment (`/money/committees/{name}-{number}/payments`)

The full list behind a committee's figures — every named payment, largest first, with each
payment's own date. The Who gave / Where it went choice and the year are in the address.
The first response reads the dated committee figures and the first 50 payments
concurrently. It does not request whose committee it is: no current member claim
is needed to read this registration’s own payments.
The page loads 50 first, then up to 250 at a time; the capped-list card says the cap is ours,
not the filing's, offers the next 250, and links to the filing itself on the Board's site.
The version that arrives from the server carries the first 50 rows the address asks for, in the
direction and the year it names, so a shared "Where it went" link opens on payments out rather
than on donations in. "Showing X of Y" is a measured count served with the rows, never a guess. The same naming rules apply: a
loan is labelled as reported on its own schedule rather than reading as a gift, transfers
read "Money given to another campaign" and open no name lookup, and a registered filer's
number opens its committee page. Other linked names open payments filed under that exact
spelling; a name alone does not identify a person or business. Names with no supported
destination remain plain text, including a transfer to a committee whose page is not
held. The explanation beneath received and made payments states these 2 destinations;
its existing threshold clause remains absent on ballot-question committee pages.

A failed payment read, including an unavailable response, uses this page's could-not-load
sentence. It never prints a
no-donors or no-payments heading. A first response with a failed payment read keeps the
committee's identity and known figures, carries no successful payment seed, and uses
`Cache-Control: no-store` so a later reader can retry immediately. Successful responses
keep their usual cache windows. The first 50-row read reduces the work inside the
5-second deadline; later pages start after the rows actually received, so no payment is
skipped when the first page is smaller.

## The outside-spending record (`/money/outside-spending`)

Money spent by groups that are **not** the candidate's campaign, supporting or opposing a
committee. Minnesota calls it an independent expenditure, and
[Minnesota Statutes 10A.01](https://www.revisor.mn.gov/statutes/cite/10A.01) subdivision 18
requires it to be made without the candidate's cooperation, so the page's first sentence says
what every row is: what a group spent, not what a campaign received, and not what any of it
achieved. The rows come from
the Minnesota Campaign Finance and Public Disclosure Board's independent-expenditures
download, and **they are never added to the ordinary
payments-out figures anywhere**: 491 of them coincide with a payment in the expenditures file,
and whether that is one payment filed twice or two that coincide is not established.

The page opens with a back arrow labelled **Money in politics**, linked to `/money`. The bare
address is now the complete directory of names in the outside-spending records, rather than an
overview with shortcuts to other lists. Its browsing state lives in the address:
`browse=groups|committees`, `year`, `q` and `page`. Missing values mean groups, all years, no
search and page 1. “All years” leaves `year` out rather than writing `year=all`.

The browsing page is ordered like this:

1. **Year.** “All years” comes first, followed by every distinct filing year in the held
   outside-spending source, newest first. Changing year keeps the browsing choice and search,
   and returns to page 1. The overview figures and their period change with the year.
2. **The browsing task.** **Who spent?** lists groups. **Who was supported or opposed?** lists
   committees named in the filings. Changing between them keeps the year, clears the search,
   and returns to page 1. Neither choice opens `/money/search` or the committee register.
3. **Search and names.** The visible field label is **Search groups** or **Search committees**,
   with no duplicate placeholder. Search matches names only, across the complete name list for
   the chosen period rather than only the 12 names on screen. Names are alphabetical, with a
   stable second sorting rule when 2 printed names match. No name is ranked or accompanied by a
   spending amount. The Committees list explains once: “A campaign committee is the organization
   that handles a candidate’s campaign money”.
4. **Numbered pages.** Every page holds 12 names at every width. Under the names, a centred row
   reads **‹ Previous · Page X of Y · Next ›**. Previous stays in place but cannot be used on the
   first page; Next stays in place but cannot be used on the last page. A changed year, browsing
   choice or search returns to page 1, and a shared out-of-range page is brought back inside the
   available range.
5. **The overview.** The card states the total of the listed payments, the payment count, the
   period, supporting and opposing payment counts, and the count given in goods or services.
   Under the period it says “These figures cover the whole period, whatever name you search for”.
   Search, browsing choice and page never change these figures; year changes the figures and
   period together. Supporting uses cyan and opposing uses ink, never green against red, and
   both figures are written beside the bar so colour carries no meaning. A direction not stated
   gets its own labelled count rather than being forced into either side. An unreadable amount
   withholds the total but not valid counts. The overview and directory always describe the same
   held source copy.
6. **How to read these records, limits and source.** These blocks sit after the names. The source
   is the [Minnesota Campaign Finance and Public Disclosure Board's campaign-finance
   downloads](https://cfb.mn.gov/reports-and-data/self-help/data-downloads/campaign-finance/),
   followed by “On the state’s download page, choose ‘All’ under ‘Itemized independent
   expenditures of over $200’”. “Records copied {date}” uses the actual date of the source copy
   displayed and is absent when that date is unknown.

At 1100 pixels and wider the browsing controls and names sit in the main column and the overview
sits beside them. From 768 through 1099 pixels, and below 768 pixels, the page becomes 1 column:
the overview follows the browsing controls and precedes the names. Below 768 pixels, the year
choices become a labelled menu. On narrow screens, the overview sits between the search controls and names; on desktop it sits beside them.

The list includes every filed name in the held outside-spending source, even if the name is absent
from the committee register. Filed identifiers remain the identity: similar names are not combined.
A name with a usable filed identifier opens its existing payment view and carries the chosen year.
A name without one remains searchable and counted but is plain text, followed by “We cannot open a
separate spending record for this name”.

1. **One group that spent** (`?spender=<registration number>`). The group's register kind as
   a chip, "Registration 41207", its name, and a line saying it is registered with the Board
   to make independent expenditures, with a link to its own money page where one exists. Then
   the figures for that group alone: the subject line (OUTSIDE SPENDING · 2026, or the span of
   years), the total, the ruled count line "12 payments about 5 committees" (singular
   "1 payment about 1 committee"), the direction bar with each side's money, and a period
   note. Rows are headed **The committees this spending was about**.
2. **One committee the spending was about** (`?about=<registration number>`). The same
   shape, headed **The groups that spent**, count line "12 payments by 5 groups". Above the
   figures sits WHOSE COMMITTEE THIS IS. Until a person at Alethical has confirmed the link,
   it names the committee only: "The register records this committee for State
   Representative, District 3B. We have not confirmed which person it belongs to, so this
   page names the committee only. Every figure below is spending about this committee — not
   about a candidate we have identified." A confirmation adds one sentence naming the member
   with a link to their campaign money, and changes no figure: the filings never name a person.

The old 3-choice strip is absent from both payment views. Their **Outside spending** link and
browser Back return to the browsing choice, year, search, page and name position the reader left
when that state is available. A directly opened group or committee address returns instead to the
matching browsing choice and year, with no search and page 1. It never claims another reader's
search history belongs in the subject address. An older chosen year remains visible and selected
in the payment view even when it is outside the 2 newest filing years normally offered there.

Every row shows its own facts and nothing inferred: the counterparty's name (a link with its
REG number where this release holds a page for it; otherwise plain text with "Not in the
register — printed as the filing names it" beside it, because dropping the row would shrink the
record and linking it would invent a page), a SUPPORTING or OPPOSING chip in the filing's own
word, the purpose ("No purpose given in the filing" where blank), the vendor ("paid to …" or
"no vendor named in the filing"), the row's type text ("independent expenditure", or "given in
kind" — in-kind is the row's type, never a chip), the amount in whole dollars with "$1,500 of it
unpaid" under it where part is unpaid, and its own date, "PAID AUG 3, 2026". Two sort buttons,
NEWEST FIRST (the default) and LARGEST FIRST; largest first is honest here because ranking rows
inside one subject is a fact about that subject, and the dek under the heading says the figures
are never set against another group's. A FILING YEAR control offers All years and the 2 current
filing years. Over 50 rows the list pages, "Showing 50 of 1,284 payments", "Page 2 of 26",
Previous and Next, and the note under the rows says the rest are on their own pages — this list
is never a sample of a longer one without saying so.

The browsing page has separate loading, no-match, no-names, no-records and failure states. A name
list failure leaves a successful overview in place. A failed refresh keeps the last successful
names and overview with their own year and copy date. When payments exist but the chosen side has
no names, it says **No group names are recorded for this period** or **No committee names are
recorded for this period**, followed by “We hold spending records for this period, but no names to
list in this view.” A failure never reads as an empty result or a zero.

The payment views keep these states at every width:

- **Nothing on record** (grey, in the body face) with the reason: "No independent expenditure
  about this committee appears in the file we hold for the period above. Minnesota publishes no
  date telling us when a report arrived, so we cannot tell you whether one is still to come. This
  is not a reported zero, and no group has reported spending nothing." With a year chosen the
  card offers **See all years**; with none, a link to the committee's own contributions and
  payments where that page exists.
- **We could not read this part of our records just now** when our copy of the file is stale or
  does not reach the year asked for — a gap of ours, never a zero.
- **Figures as accepted**, an amber note over the last figures the page loaded, when our own
  data service stops answering mid-visit: "We could not reach our own data service just now, so
  these are the last figures we accepted, taken Aug 11, 2026 — held until it answers rather than
  expiring on a timer." With nothing loaded at all, the page says so and shows no figure.
- **We hold nothing under this registration number** for a number in neither our copy of the
  Board's register nor the file — a statement about our records.
- A row whose amount the filing leaves blank withholds every total on the page and keeps every
  count, with a sentence saying why; 0 rows in the live file are like this.

The page ends with the 2 fixed explanations below, then the linked source instruction and the
actual copy date described above:

> **How to read these records**
>
> Choose a group to see which committees its spending supported or opposed. Choose a committee to
> see which groups spent supporting or opposing it. Each payment shows its amount, date, purpose,
> and who was paid, when those details appear in the filing.
>
> **Limits of these records**
>
> These records cover filings held by the Minnesota Campaign Finance and Public Disclosure Board
> from 2015 onward. They do not include spending reported only to other agencies. We cannot tell
> whether each group has finished reporting for a year.
>
> The filings show spending, not whether it changed a vote, a position, or an election result. No
> matching record does not mean nothing was spent.

At phone width (below 768) the columns
stack and each row becomes a card: name, direction, the meta line, then the amount left-aligned
under the name with its date beneath it; nothing is sticky. The server answers the bare address
with its title, its description and the figures above, and search engines may list it; a
subject's or a filtered view is `noindex`, because each committee has its own record page
already.

## The `/read` page (`/read`)

Reached from the top menu's **Read** item; the money landing's research row links to the
newest piece itself rather than to this page. It has moved 3 times: it sat at `/money/reports` until 20 Aug 2026, when the nav gained
its own group and it left the money section
([#1698](https://github.com/alethical-org/alethical/issues/1698)), at `/reports` until the
morning of 27 Aug 2026, when "report" went back to meaning only the document a campaign files
with the state, and at `/read` until that evening, when the menu item became the single word
**Read** and the addresses followed it. All 7 old addresses forward permanently and directly, so a
link shared before any of the moves still opens the right page in one hop. Nothing about either page's contents changed with
either move.

This is the page listing everything Alethical publishes in its own name
([`.claude/rules/grounded-answers.md` rule 13](../../.claude/rules/grounded-answers.md)).
With nothing posted the page says "Nothing published yet". The `/money` Research
feature says "Nothing is published yet", with no count or link.
Neither that line nor the sentence under it takes a full stop, because each stands alone
(the full-stop rule above). A piece's own standfirst, drawn on its card, keeps the one its
author wrote.

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
  accurate reads as current instead of old. A guide's card is never left dateless: a date
  going stale on a listing row is answered by the one-word swap, not by removing the date.
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
checked: its own address and this page, plus the `/money` Research feature when it is
the newest research piece, all on the day it posts. **Search engines see it the same day too (Eugene, 25 Aug 2026):** it goes into the
site map search engines read (`/sitemap.xml`) and its page carries no instruction to skip
it. Nothing about a piece waits.

The cost of that, stated plainly: a figure nobody has recomputed can reach a search result
on the day it posts. What stands in the way is
the checking itself happening promptly, and a correction replacing a wrong figure the moment
it is agreed. Holding a particular piece back stays possible, for a reason Eugene names,
rather than being a step every piece waits behind.

The `/read` page and every piece's page hand their words over in the **very first response
from the server**, before any of the app's own code runs: the listing its cards and a plain
link to every posted piece, a piece its entire text. That puts our own writing on the same
footing as a bill page, which hands its text over straight away too
([#1760](https://github.com/alethical-org/alethical/issues/1760)). This is separate from
whether a search engine may _list_ a piece, which is still Eugene's per-piece decision
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
  entry is marked at a time. The list is headed **CONTENTS** in ink; a screen reader is
  given the piece's own kind instead, "Sections in this research" or "Sections in this
  guide", because that label replaces the visible word rather than joining it.
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
- **The article prints GUIDE only in that line.** The separate Share window names its
  action **Share this guide**. A research piece prints
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
- The section has no sign-in gate for reading records. The name search at `/money/search`
  sends the typed name to Alethical's own server, and to nobody else. Its address carries
  that name so the search can be shared; it is not stored against a reader. Searching
  within a legislator profile's already-loaded payment tab stays in the browser and
  does not change the address.

### Selected-year contribution panel on a committee record

The Campaign money section at `/money/committees/<slug>` uses the same **More on this
year’s contributions** panel as the legislator tab. It follows the **View receipts and expenditures** link
and precedes outside spending. No legislator confirmation is needed to read a
committee's own money. Each result retains its source limits and independent state.

The full row descriptions and qualifications are in the
[legislator campaign-money guide](legislator-campaign-money-guide.md#the-selected-year-contribution-panel).

## Lobbying links and search groups

[Issue 2164](https://github.com/alethical-org/alethical/issues/2164) adds the Lobbyists and
Principals groups after the original campaign search groups. [Issue 2241](https://github.com/alethical-org/alethical/issues/2241)
replaces current-day claims with the displayed copy date and calls the organisations listed
under a lobbyist clients. Each group has its own served count;
no count is added across groups. A successfully searched empty lobbying group is omitted.
An unavailable lobbying group remains visible with the existing could-not-search sentence.
The Principals group includes IDs from both source files; an ID without spending rows is
plain text with the Board-file coverage year. More results open the corresponding numbered
list with the same typed name.

In the Lobbyists donation tab, the employer and payment count stay under the printed name.
Expanding the row reveals each distinct held registration and, when it appears in the copied
list, a link to the organisations that lobbyist represents. A different registered spelling
is stated. A completed lookup absent from the copied list says "not listed on the copy date"
without a link;
a missing number or failed lookup never makes that claim. Committees & Funds use the same
expanded context with their existing linkable committee number. Several numbers under one
printed name remain separate, without choosing a single identity.

Docs check: The lobbying release updates all money entry points, search groups, expanded
registration links, copied-date wording and removal of the old under-development strip. The
complete 5-address behavior is described in [lobbying-guide.md](lobbying-guide.md).

The committee page shares the revised report comparison, contribution locations and
exact-spelling name rows described in [the legislator campaign-money guide](legislator-campaign-money-guide.md).
The generic downloads footer is absent. The Board record link stays in the period
panel; the outside-spending card keeps its downloads link and exact source filename.
Money in, Money out and any additional financial summary card use the same grey
`c.tile` surface as the profile. On phones the boxes grow with their contents; on
wider screens Money in and Money out stretch to equal height.

Docs check: Updated the shared card wording and committee source placement and phone layout.

A party unit or political committee or fund omits the unsupported candidate-report
comparison row. A failed payment read still shows an eligible row's load-failed state,
and an unexpectedly missing candidate comparison remains a failure. Every eligible row
still requires the selected year's agreeing stated-split check. A missing report-comparison
block alone never removes independently available geography or exact-name results.

### Committee refinement source correction (16 September 2026)

The committee coverage block makes no blanket claim that unions do not report to the
Board. [Minnesota Statutes 10A.202, subdivision 2(9)](https://www.revisor.mn.gov/statutes/cite/10A.202#stat.10A.202.2)
expressly addresses labor-organization disclosures for qualifying communications.
The block describes the records held and keeps the annual donor-naming threshold for
the committee’s own kind. Copy dates remain at the foot, separately identifying payment
files and report totals; no example date from a drawing is inserted into the product.

The September refinement retains existing 768px and 1100px responsive behavior in shared
campaign components. It does not impose the drawing’s older 2-band claim on the current
3-band shared typography, nor restore obsolete tabs, made-up amendment dates or per-report
links. The page continues to show one committee’s records, with the current cards, controls,
section order, amounts, chart colours and missing-record protections.

A committee link to an older year keeps that year visible and selected within the
complete newest-first year group. When an older year has no report figures, its alternate-year
link returns to the current year; the current year’s alternate link still offers the
prior year. The first served HTML exposes the same year choices.

The 17 September control, source-copy and punctuation changes are recorded in
[committee-money-refinements-copy.md](https://github.com/alethical-org/alethical/blob/main/docs/design/committee-money-refinements-copy.md),
including the complete old-to-new strings for future Design work.
