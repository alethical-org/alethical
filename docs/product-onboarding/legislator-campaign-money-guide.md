# How the Campaign money tab works (plain-English guide)

<!-- describes: apps/frontend/src/components/campaignMoney/MoneyDetailsBundle.ts, apps/frontend/src/components/campaignMoney/MoneyDetailsOnDemand.tsx, apps/frontend/src/hooks/useCampaignMoneyYearStates.ts, apps/frontend/src/lib/campaignMoneyDetailsPageCopy.ts, apps/frontend/src/lib/campaignMoneyPreferences.ts, apps/frontend/src/lib/groupedOutsideSpendingCopy.ts, apps/frontend/src/data/moneyDetailsReadError.ts -->

<!-- describes: apps/frontend/src/components/campaignMoney/CampaignMoneyTabOnDemand.tsx, apps/frontend/src/components/campaignMoney/YearControl.tsx, apps/frontend/src/components/campaignMoney/GroupedOutsideSpending.tsx, apps/frontend/src/lib/campaignMoneyColors.ts, apps/frontend/src/data/groupedOutsideSpending.ts, apps/frontend/src/lib/groupedOutsideSpending.ts -->

<!-- describes: apps/frontend/src/components/campaignMoney/CommitteeDonations.tsx, apps/frontend/src/components/campaignMoney/DonorBreakdown.tsx, apps/frontend/src/components/campaignMoney/DonorPaymentList.tsx, apps/frontend/src/components/campaignMoney/CommitteeMixHistory.tsx, apps/frontend/src/components/campaignMoney/MoneyCards.tsx, apps/frontend/src/lib/campaignMoneyDetails.ts, apps/frontend/src/data/campaignMoneyDetails.ts, apps/frontend/src/hooks/useCampaignMoneyDetails.ts, apps/frontend/src/components/campaignMoney/CampaignMoneyTab.tsx, apps/frontend/src/components/legislator/OutsideSpendingCard.tsx, apps/frontend/src/lib/outsideSpending.ts, alethical/api/services/independent_spending.py, apps/frontend/src/components/campaignMoney/LegislatorProfileTabs.tsx, apps/frontend/src/lib/legislatorCampaignMoney.ts, apps/frontend/src/screens/redesign/LegislatorProfileWebScreen.tsx, apps/frontend/src/screens/redesign/LegislatorProfileMobileScreen.tsx, apps/frontend/src/navigation/webRoutes.ts, apps/frontend/src/navigation/links.ts, apps/frontend/src/data/api.ts, apps/frontend/src/hooks/useAppQueries.ts, alethical/api/services/legislator_finance.py, alethical/api/services/committee_amount.py, alethical/api/routers/public.py -->

Every current Minnesota House and Senate member's profile page has two tabs:
**Overview**, which is the page as it has always been, and **Campaign money**, which
shows what that member's campaign reported raising and paying out in a calendar year and who is named
as giving it.

Built for [#1329](https://github.com/alethical-org/alethical/issues/1329). The rules it
answers to are
[campaign-finance-system-design.md §7 (Display rules)](https://github.com/alethical-org/alethical/blob/main/docs/architecture/campaign-finance-system-design.md)
and
[grounded-answers.md rule 12 (campaign-finance display)](https://github.com/alethical-org/alethical/blob/main/.claude/rules/grounded-answers.md).

---

## Changes in the September 2026 build

The profile redesign is tracked in [issue 2140](https://github.com/alethical-org/alethical/issues/2140).
This guide describes its donation lists, year choices and charts.

On 12 September 2026 Eugene approved chart categories matching the donor tabs, with
candidate committees included in Committees & Funds, and keeping the existing
whole-dollar display. Each payment's original kind remains available. The donut, its
legend and the history bars use the final shared solid colour map.

The chart, grouped payment lists and outside-spending cards share 1 code download,
requested when a money view opens. Loading or failure of that download stays within
the details section; accepted official figures and the refund cards remain visible.

The shared missing official money-out wording comes from
[pull request 2155](https://github.com/alethical-org/alethical/pull/2155). The ordinary
full-replacement refresh for 2022–2026 uses the intact saved directory of 1,603 filers
and the existing missing-record checks. It adds no protected historical store. Its
replacement remains held because the new Board totals feed omits an existing 2026
record. Year choices alone do not claim that historical totals have been loaded or
passed their checks.

## What every profile shows today

**Figures, on every sitting member's profile — and this section described the opposite
until 31 August 2026.** Minnesota registers a campaign committee by number and never
records which person it belongs to, so somebody has to read each committee's name and
confirm whose it is by hand. **That reading has now been done for all 200 sitting
members**: `legislator_campaign_committee` holds 275 reviewed accounts, 242 of them
confirmed and 33 rejected, every one reviewed on 31 August 2026, and **0 sitting members
are left unmatched.** Counted against production on 31 August 2026. The 2 numbers add to the
275 only while nothing has been withdrawn: since
[#1902](https://github.com/alethical-org/alethical/issues/1902) a confirmation can be taken
back, which is a third answer the row can hold, and 0 rows held it when this was counted.

Until that sitting, every profile showed the panel below instead, and it is still the
panel a member with no confirmed account would get:

> **We have not matched this member to their committee yet**
>
> Minnesota registers campaign committees by number and never records which person each
> one belongs to. This member's committees are on file with the state, and we have not
> yet confirmed which of them is theirs, so we are not showing figures here yet.
> Matching a committee to the wrong person is the worst mistake this page could make,
> so a person checks every match by hand.

![The Campaign money tab before any committee has been matched](../verification/1329-legislator-campaign-money/not-yet-matched-desktop-1280px.png)

Three things that wording is careful about, because a shorter sentence gets each wrong:

- **It never says no committee is registered for this member.** Measured when this was
  written, all 200 sitting members appeared in the Board's own list of registered filers,
  so that sentence would have been false for every one of them. It is now false for 199:
  Paul Novotny (house 30B) closed his committee on 28 July 2026, and a closed registration
  drops out of the list of current candidates. The wording is unaffected, because the
  reason it never says that sentence is that a blank page is our unfinished work, and
  199 of 200 still make it factually wrong as well.
- **It says the unfinished work is ours.** A reader must not take a blank page as
  something the member did.
- **It says nothing about the other 199 members.** "No figures are on any profile" is
  true today and false the moment the first match is confirmed, and a sentence with an
  expiry date built into it is one somebody has to remember to change.

**The tab appears for every member regardless.** Hiding it until a match is confirmed
was proposed and rejected: two profiles side by side, one with a money tab and one
without, tell a reader the second member has no campaign money, when the truth is an
unfinished clerical job of ours.

---

## Getting to it

- The **Campaign money** tab sits next to **Overview** at the top of every legislator
  profile.
- Its own web address is `/legislators/<name>?tab=money`, and the year rides along as
  `&year=2025`. So a link somebody sends you opens on the same tab and the same year
  they were looking at.
- The Overview tab carries a short **Campaign money** card pointing at the tab. It
  deliberately carries **no figure**: a number there would drag a second "as of" date
  onto the Overview tab, which is the problem the two tabs exist to avoid.

![The Overview tab's pointer to the Campaign money tab](../verification/1329-legislator-campaign-money/overview-pointer-desktop-1280px.png)

---

## What the tab shows once a member is matched

A member can hold more than one committee, because Minnesota registers one per office.
17 sitting members tie to more than one, and 8 have 2 or more live at the same time. So
the tab shows **one card per committee**, each headed with the office it is for, the
year, and the committee's registration number.

**The cards are never added together, and a member with more than one is told so before
they read a single figure.** Above their cards the tab says:

> This member has 2 campaign committees for their seat in the Legislature, and each one
> reports to the state separately. Each is shown on its own below and we never add them
> together: when a candidate closes one committee and opens another, the money left over
> moves across, and the state records that move as a donation to the new committee. So
> the same money is in both reports, and one combined figure would count it twice.

**This is a real double count, not a theoretical one.** Looking at every candidate rather
than only sitting members, 20 hold more than one committee across 40 committees, and 9 of
them have moved $121,241.64 between their own committees across 30 payments. For 2 of
those candidate-years the moved money is **all** of it, read from the Board's own records
on 28 August 2026:

- **Diane Napper.** Her Senate committee (19520) reports one named donation for 2026:
  $3,000.00 on 15 June 2026, from her own House committee (19121). Her House committee
  reports nothing at all for 2026. So a combined figure would read $3,000.00, and every
  dollar of it is money she moved from one of her own accounts to the other.
- **Frank Pafko.** The same shape. His House committee (19512) reports $2,851.97 on
  16 June 2026, from his own Senate committee (18920), which reports nothing for the year.

**The moved money is never subtracted out of a committee's own figure either.** It really
did arrive, the committee's own filed report says so, and taking it back out would leave
our number disagreeing with the state's. What the page does instead is show each account
on its own and say plainly that they are not added
([#1663](https://github.com/alethical-org/alethical/issues/1663)).

**Money from a race for a different office never appears here.** A member may have run
for Attorney General or Governor, and those committees are real public records, but
putting that money under their legislative profile says something about their work in the
Legislature that no filing supports. The page leaves those out and says so in a line
carrying no figure, so a reader who knows about that campaign is told the money exists
rather than concluding we missed it.

The test is whether the committee is for a **legislative** office, not whether it matches
the seat the member holds now. Liz Reyer sits in the House and has a live Senate
committee as well; filtering to her own chamber would have thrown away a real committee
of hers. A committee with no office recorded is kept, because a blank field is not
evidence of another race and hiding a member's real money is the worse of the two
mistakes available.

### Who checked this match, at the foot of every account

**Every account box ends with the day a person confirmed it is this member's, and what they
read.** The first line is always the same shape, "Checked by Alethical on Aug 31, 2026",
and the 3 lines under it come off that decision's own stored record: how the filed name
related to the member's, what Minnesota's register of registered candidates said about the
account, and what the party money said.

**Read off the decision, never recomputed.** A later download can rename a committee or move
a candidate's register row, and the card still describes what the reviewer actually saw. The
point of showing it is that a reader can hold us to the decision we made rather than to what
today's records would suggest.

**The weakest cases say so.** Where Minnesota's register has no row for the account, the card
says the register of current candidates does not list it, and never anything that reads as
the state agreeing. Where only the last name matched, it says the first name is filed
differently. Measured against the 242 accounts confirmed on 31 August 2026: 195 have the
register confirming the member's seat, 22 have no register row at all, and 12 share only a
last name.

**Party money keeps its 4 answers here too**, because 2 of them are not disagreements: the
money agrees, it names the other party, no party organisation has ever paid in, or we hold no
party for this member to compare. A missing comparison never renders as a conflict.

**A decision with no stored basis shows nothing.** The 4 columns holding that basis landed
the day before the first sitting, so every decision on the site has one; a decision written
before them would print no lines at all rather than a vaguer version.

### The year switch

The buttons offer **every calendar year from 2015 through the current year**, newest
first. In 2026 that is 12 years; in 2027 it becomes 13. The year in
`/legislators/<name>?tab=money&year=2025` controls the committee figures, donation lists
and outside spending together. There is no All years sum or cross-member comparison.

A dashed outline identifies a year for which the answers from our data service say the
shown committees have named donations only, without an official total. It is not a fixed
cut-off such as “before 2025”. A button promises a way to read that year's records, not
that we hold a complete report for it. The answers used to style these buttons never
renew or replace the current committee-confirmation check.

Calendar years, because that is the unit Minnesota's own reports use. This is not the
same control as the session pill on the Overview tab, which counts a two-year
legislature.

Early in a year the newest option can be genuinely empty, and it says so rather than
showing a zero.

**An empty year says which of 2 things is true, and never the wrong one.** A committee is
left out of a year when the download shows it reporting no money that year, and that is a
fact about Minnesota's file rather than about the registration:

- **Nothing reported for 2026.** The heading, when the Board's filer record carries no
  closing date for the committee. The sentence says the committee reported no money that
  year and adds, in these words, that this is not a statement that the committee has
  closed, because a committee can be registered and report nothing for a year.
- **This committee has closed.** The heading only when the Board's own record gives a
  closing date, and the sentence names the day.

The distinction is not decoration. On 31 August 2026, the day the first 144 matches were
confirmed, 23 profiles landed on an empty 2026 and the panel told every one of their
readers that "the years it covers do not include 2026 ... a committee is registered for a
particular race and does not run forever". Minnesota's filer record had **22 of those 23
committees open, with no closing date**, so 22 named politicians' pages asserted a
registration had ended when it had not. The 1 it was right about is Paul Novotny's, closed
28 July 2026. A closing date is now the only thing that licenses the stronger sentence, and
its absence covers 2 cases we cannot tell apart, still open and missing from the filer list
we hold, which is why both get the same honest wording.

### Money in

Two figures, and they are different things. Their labels are the filing's own words, ruled
by Eugene on 11 Sep 2026:

- **Total contributions.** The committee's own report, drawn only when we hold its total.
  The date the report runs to, and the link to the state's site where its filed reports
  can be looked up by registration number, sit once in a filing stamp above the money-in
  and money-out blocks rather than under either figure: one filing produces both, so
  stating it per figure would state one fact twice.
- **Itemized contributions.** The state publishes a spreadsheet of the donations it
  required each committee to name. This is what that spreadsheet holds for the year, with
  the dates of the first and last payment. Always drawn: a real amount, or the words
  "Not reported", never a blank. Directly under it, before the goods-and-services line
  where one draws, a fixed sentence says what the figure is and states the naming rule.
  It is the one place on the card that rule is stated, and on a legislator's committee it
  reads exactly:

  > Donations where the filing names who gave. Named donors include people, lobbyists,
  > other campaigns, political committees and funds, and party organisations. Minnesota
  > requires a committee to name a donor once that donor has given more than $200 in
  > total for the year; a committee may name a smaller donor but does not have to.

  The committee page prints a second version of it for a ballot-question committee, whose
  line is $500 ([`campaign-money-section-guide.md`](campaign-money-section-guide.md)
  under Money in); a legislator's committee is never one.

The official figures and evidence use the shared
[MoneyCards.tsx](https://github.com/alethical-org/alethical/blob/main/apps/frontend/src/components/campaignMoney/MoneyCards.tsx),
and both `/legislators/<name>?tab=money` and `/money/committees/{name}-{number}` put
the same donor chart before the summary and the same grouped payment tabs below it.
The committee address scopes every figure to its own registration, without requiring
a legislator match. It keeps its own year choices, Track, Share and Filings controls;
the profile's mix-by-year chart stays on the profile.

**Non-itemized contributions** appears only when the server supplies a checked split.
The profile shows its dollar amount in the summary and its share in the donor chart;
there is no separate percentage below the summary amount. The fixed sentence says:

> Donations inside the committee's reported total whose givers the state's public file
> does not name.

It repeats no threshold, because the itemized sentence above it has already stated the
rule once and one fact at 2 places on a card is the repeat Eugene ruled out.

**Read the $200 as the donor's yearly total, never the size of a single gift.** 327,759 of
the 583,152 published donation rows are individually under $200 and are named anyway,
because that donor's yearly total had already passed the line.

**And read it as a floor, not a ban.** Never write that donors who gave $200 or less in total
"are never named": the $200 is the point at which a campaign _has to_ name someone, and a
campaign may name a smaller donor if it chooses. At least one does, so a page saying it was
impossible is caught by any reader who opens that filing and finds a $75 donor listed by name
([#1755](https://github.com/alethical-org/alethical/issues/1755)).

Money in that is not a donation — a public subsidy, interest, a loan — is listed
separately under its own heading, "Not a donation", with the state's own label. It is never
added to the donation figure, because the filing carries it on a different schedule and the
Board's own totals exclude it. **A row the state types `Miscellaneous` is not drawn** (ruled
by Eugene, 11 Sep 2026), and when that was the only such row the heading is not drawn
either. Every other kind still is.

The link at the foot of the card, **Minnesota's campaign-finance downloads**, opens the
Board's downloads page (`https://cfb.mn.gov/reports-and-data/self-help/data-downloads/campaign-finance/`).
The address the server sends is the bulk download itself, which streams a 9 MB statewide
spreadsheet with no page behind it, so the card strips the `?download=` part and links to
the page that download lives on.

### Who gave, by kind of donor

**The donor breakdown is the prominent chart inside each committee's card**, before the
compact summary figures and grouped payment list. It explains where the money came from
by cash amount, not by number of names. Its labels carry the kind, amount, percentage and
count of printed names, so the circle is not the only way to read it. Choosing a named
kind opens its matching contribution tab. The categories have the same names and order
as those tabs, including Candidate Committee together with Political Committee/Fund in
**Committees & Funds**. The count uses exact printed names across that combined category,
so a name appearing under both source kinds counts once. Amounts keep the existing
whole-dollar format; the underlying sums retain every decimal place.

When the server marks the split as `shown`, the base is the committee's official cash
contribution total. The named cash slices and the unnamed cash slice must add exactly to
that total before anything is drawn. A zero unnamed amount does not draw an empty slice.
When the server says `no_reported_total`, the heading says “named donations only” and the
base is the cash contributions in the complete named list. It shows no unnamed slice.

A missing list, a failed download, a changed release during paging, an unreadable amount,
a negative cash amount or an unknown cash-versus-goods marker prevents a chart from
pretending to be complete. Other withheld split states retain their own explanation.
No named rows gets its own sentence rather than a circle claiming a reported zero.

**Goods and services stay out of every cash slice.** Their value remains in the named
contribution figure and payment list, with each such payment marked. The explanatory
sentence appears once beneath the chart, not again in the summary. An all-goods year
does not turn into a cash chart showing a misleading zero.

### The names and payments under each committee

The fixed tabs are **Individuals, Lobbyists, Committees & Funds, Party Units, and
Expenditures**. They stay visible when empty. An **Other kinds** tab appears only when a
contribution has another kind. Candidate Committee rows sit in Committees & Funds and
keep the “Candidate committee” label. The original kind remains on each payment even
though the chart and tab combine those 2 committee kinds.

Only rows the state labels `Contribution` enter the contribution tabs, name counts or
donor charts. Subsidies, interest and loans are not gifts. Expenditures holds the
committee's ordinary payments out, never the separate independent-spending file.

**Each group is one exact printed name within one committee, year and tab.** Different
spellings stay different groups, even when they look like the same person. Employer
text is shown as filed and never used to join names. A row with no name stays accessible
as “Name not given in the filing” and does not add a made-up person to the name count.
The tab count says names; the count line separately says how many payment rows it holds.
Neither claims a number of distinct people.

The list first shows 10 groups, with a button to show the rest. This is only a display
choice: every page of received and made payments must arrive before the list publishes
counts or totals. Requests fetch up to 250 rows at a time, require the same release
throughout and check the final row count. A failed or incomplete read shows a retry
message, not the first page's subtotal as though it were the whole year. Repeated-looking
payments are kept, never silently removed.

Search narrows names inside the chosen tab. The 5 orders are largest amount, smallest
amount, name A to Z, newest date and oldest date. A missing date always goes last. A
group's newest or oldest payment controls its date order. Search and the 10-group display
limit do not change the whole-tab name count, payment count or total.

Opening a group's amount and expand control shows every underlying payment, with its
own date and amount; missing dates say so. Payments out also show the filed purpose,
kind and location where those fields exist. Goods-and-services rows carry their marker.
All amounts are summed with exact decimal arithmetic inside this committee alone.

A registered committee's name is an ordinary link to
`/money/committees/{name}-{number}` only when the current responses say that number has
a page. It can be opened in a new tab or copied. Private donor and vendor names are plain
text on this profile; the expand control is separate from any committee link. Donor
overlap and individual donor profiles are outside this build. The existing exact-name
lookup at `/money/payments?name=…&role=contributor` remains a separate feature, not proof
that 2 records belong to the same person.

### How the mix changed by year

Below outside spending, each committee has its own history from 2015 through the current
year. Each year's bar uses that year's named cash contributions only. Unnamed money and
goods and services never enter those shares. Its categories match the donor tabs and
the selected-year chart. A year with no named rows is labelled as
such, and a year whose cash amounts cannot support a chart says a breakdown is unavailable.

The history starts loading after the selected year's received and made lists finish.
It appears only after all requested years arrive from the same release as the selected
lists. A partial history is withheld rather than drawn with missing years. Choosing a
year changes the selected year above. Every committee has its own history; the bars and
amounts are never combined across a member's committees.

### Money out

**When an official total is held, the card shows “Expenditures”**, the committee's
reported money-out total for the period, including a verified $0. Its own period note
appears only where it differs from the filing stamp's. No named-payment sum sits beside
an official total, and the card prints no comparison verdict or rows by payment kind.

**When the official total is missing, the card shows no amount and only this sentence:**
“We do not hold an official spending total for this committee for this year.” This
describes Alethical's records, not a failure by the committee to file. The same sentence
applies whether the named-payment rows contain an amount, a measured zero, no payments,
or an unavailable amount. Empty and closed committee-years use it too, while their
identity and money-in card retain their own explanation.

**A sum we calculate belongs beside its payment rows, never in the summary card.** The
card prints neither a named-payment total nor a second sentence about whether that sum
exists. An official $0 remains a figure and carries its own sentence: “The committee’s
own report states $0 in expenditures. That is the filing’s own zero, not a gap in our
records.”

Counted across the 242 confirmed committees on 31 Aug 2026: for 2025 the figure can be
shown on 199, is held back on 7, and does not exist in our copy on 36; for 2026 it can be
shown on 168 and does not exist on 74. The 7 held back are **special-election
filer-years**, of which the live snapshot holds 39 in total: we have the number and refuse
to stand behind it, because a special-election filing's totals copy cannot speak for a whole
year. Rep. Xp Lee's committee 19223 for 2025 is one of them and holds $16,923.32 we will not
publish. Since 11 Sep 2026 a second reason holds a figure back: a cash line of $0 beside
donations that were all goods and services (§ Missing, zero, and broken below), which moves
1 of the 242 confirmed committees, Po Vang's 19490 for 2026, from shown to held back.

**Never write that Minnesota "publishes no official total for a committee's spending".**
Minnesota publishes one: the filed report's own "Total Expenditures and Disbursements"
line, held in `cf_filing_figure.total_expenditures` for **3,630 filer-years**, which is
the figure this card draws
([#1875](https://github.com/alethical-org/alethical/issues/1875): the tab once drew
nothing and blamed Minnesota for the absence, while only the committee route served it).

**The comparison against the committee's own filed report still runs**, and its verdict per
committee-year is still stored and served (`stated_spending_state`); the card just no longer
prints it. A held official total stays visible even when that comparison is unproved;
the comparison does not decide whether the total exists. Its mechanics are under "Where
the data comes from" below.

### Refunds the state paid to donors

Directly below each confirmed committee's card is a separate card headed **Refunds
the state paid to this committee's donors**. It shows the state's payments back to
that committee's donors, never money the committee received. Each committee keeps
its own card, and no year or page total is calculated.

The introduction reads:

> Minnesota pays a resident back for a gift to a state candidate, up to $75 a year for
> 1 person and $150 for a married couple filing together. This is money the state
> returned to donors, not money the committee received.

The table keeps **Year**, **Contributions refunded**, and **Amount refunded** in
3 columns, including on a phone. It lists all held refund years newest first,
regardless of the campaign-money year selected above it. Amounts use the tab's
existing dollar formatting. The source amount $14,216.47 therefore displays as
$14,216, with its cents preserved in the data.

The Board identifies a candidate by printed name, office and district, and party,
not a registration number. The importer attaches a row only when those fields
match the confirmed committee's register entry exactly. A published year with no
matching row prints nothing. Near-matches stay in the import's review record and
never become hints on a person's profile.

**Not published** is reserved for a year for which the Board published no summary.
It spans both figure columns, followed by **The Board published no summary for
{year}** beneath that row. It appears only between 2 years with matching rows.
**Not yet copied by Alethical** is the separate state for a known year whose file
Alethical does not hold. Neither state becomes a zero. Abeler's oldest matching
refund row is 2017, so his card has no 2016 gap. Dibble's Senate committee (15667)
has matching 2015 and 2017 rows, so its card does show 2016.

A reported amount with a blank count keeps its amount and reads **Count not
published** in the count cell. Abeler's 2024 therefore reads **Count not published**
and **$10,508**. A missing count is never rendered as zero or an empty cell. The Board's
[2024 candidate summary](https://cfb.mn.gov/pdf/publications/public_subsidy/historical/2024_refunds_cand.pdf)
has 334 candidate rows, all with blank counts, and 5 total rows. Senate district
numbers belong to the office column and are never treated as refund counts.

The note **The Board counts a married couple filing jointly as one contribution**
appears when the source files for the reported rows carry that counting note.
A second line reads
**Rows from the Board's yearly refund summary whose candidate name, office and
party match this committee's registration exactly**. The only link in the card is
**Board summary files last copied {newest copy date}**, pointing to the Board's
program page recorded by the import. Year cells are not links. Adding this source
information to an already-held file does not change its copy date or its figures.

When no candidate row matches, the card keeps its heading, introduction, and
copied-files link, and says:

> The Board's refund summaries name no row for this committee's candidate, office
> and party.

The refund history remains under **Nothing reported for {year}**, because that
message concerns the selected campaign-money year. It remains tied to each
confirmed committee and disappears when the member's committee match is withheld,
the first read is loading, or that read failed. It never brings a campaign for a
non-legislative office onto this profile.

The table has an off-screen caption, **Refunds by year**, column headers and a row
header for every year. The no-summary row preserves its year header while its
message occupies the 2 figure columns.

Docs check: This section follows the per-committee refunds response and the accepted
card decisions in [issue 2147](https://github.com/alethical-org/alethical/issues/2147),
including the approved gap and blank-count corrections. The complete guide was
reread; the superseded spending-card and protected-history claims were corrected.

### Spending by outside groups

A group that is not a candidate's campaign can spend money to help or hurt that
candidate. Minnesota calls this an **independent expenditure**. **The money never reaches
the campaign and never appears in any report the campaign files**, so somebody reading
only the committee cards above would miss it entirely and have no way to know it was
missing. That is why this block sits on the same tab, below them, and never has its
figures added to theirs.

**It was on no page at all between 18 and 2 September 2026, and this section described it
as visible throughout.** [#1329](https://github.com/alethical-org/alethical/issues/1329)
moved campaign money onto its own tab, deleted the block's 2 renders from the desktop and
phone profiles, and imported the card and its data request into the new tab without ever
drawing it. So every reader who opened a money tab paid for 2 requests whose answers were
thrown away, and `grep -rn "<OutsideSpendingCard" apps/frontend/src` returned nothing for
15 days. The card's own tests passed the whole time, because a component's unit tests
cannot see whether anything renders it. The guard is now
`apps/frontend/src/components/campaignMoney/__tests__/campaignMoneyTabDrawsOutsideSpending.test.tsx`,
which mounts the tab and looks for this block's heading in the output; 6 of its 7 cases
fail if the render is deleted again, and an import-only reference satisfies none of them
([#1932](https://github.com/alethical-org/alethical/issues/1932)).

It follows the selected calendar year and shows up to 3 separate direction figures.

| Figure                                        | What it means                                                        |
| --------------------------------------------- | -------------------------------------------------------------------- |
| **Spent supporting them**                     | Payments Minnesota's filing marks `For` this legislator's committee. |
| **Spent opposing them**                       | Payments the filing marks `Against` it.                              |
| **Spent where the filing does not say which** | Payments whose `For` or `Against` cannot be read.                    |

Each figure carries **its own payment count**, because the payments behind one figure are
not the payments behind another. Below them the block states the span the payments
actually fall in, rather than assuming a year runs from 1 January, which a
special-election filer's report does not.

**And it names the committees the figures cover.** The figures add up every committee
somebody has confirmed belongs to this legislator, and a bare total would hide two things:
a member can hold several committees while only 1 has been reviewed, so the total can be a
fraction of their money presented as all of it, and a member can hold committees for
different offices, which the total would combine.

**The 2 sides are never added, subtracted or netted against each other**, and never drawn
as opposing halves of one shape. That a group spent money opposing a lawmaker is a fact
with a filing behind it; that it changed anything is not. Nothing here says the legislator
received, raised, welcomed or coordinated any of it.

**The third figure is usually absent, on purpose.** Every one of the 41,130 payments in the
current download records `For` or `Against` and none is blank, so that figure is $0 for
everybody today and is hidden while it is. A permanently empty row would tell a reader
Minnesota leaves the question open when it does not. It exists for the day Minnesota
publishes something the code cannot classify: before
[#1454](https://github.com/alethical-org/alethical/issues/1454) such a payment was dropped
from both sides while the page still read as complete.

**There is no $200 floor on this file.** 17,194 of its 41,130 payments are under $200 and
13,393 are under $100, the smallest being $0.00. The $200 that does exist in Minnesota law
is the _donor's yearly total_ on the donations file described further up this guide, and it
does not apply here. This block says "told the state" rather than calling its figures all
outside spending, because nothing can know about spending nobody filed.

**A figure is reachable only through a confirmed committee, and it is the same rule as the
committee cards.** Minnesota records each payment against a committee, never against a
person. Senator Omar Fateh is the measured case: he is a sitting state senator and also ran
for Minneapolis Mayor, and the 2025 filings carry 10 separate committees named "Fateh, Omar
for Minneapolis Mayor" holding $487,974.82 of supporting and $162,841.95 of opposing
spending, while his Senate committee has had none since 2022. A page matching on his name
would put roughly $488,000 of a city mayoral race on a state senator's legislative profile.
What keeps that money off his profile is the **office** test, not the year: a committee for
another race stays out however it is dated, and its exclusion is counted rather than hidden.

**A confirmed committee counts for every year, whatever years it reported raising money
in.** The reviewed years stored against a match are what the reviewer saw in the
_donations_ download — the last year the committee reported raising money. This is a
different download, recording what other groups spent about the committee, and a committee
that raised nothing in a year can still have money spent about it that year. Each payment
carries its own year, which is what keeps a year's money inside its own year.

Reading the donations period across to this file did 2 harms, both measured against
production on 2 September 2026 across all 200 sitting members. **36 members were told
"Nobody has confirmed theirs yet" while the same tab said "We have confirmed which
committee is this member's"** — one page contradicting itself about a named politician,
because every confirmed committee of theirs had last reported donations before 2026. And
**2 of the 36 had real 2026 spending withheld**: Sen. Carla Nelson's committee 17105, $1,800.00
supporting and $4,021.68 opposing across 5 payments, and Rep. Heather Keeler's committee
18552, $483.33 opposing across 1 payment. A committee page shows both figures and always
did, applying no such period test, so the 2 routes disagreed about the same committee-year
and this one was the wrong half ([#1932](https://github.com/alethical-org/alethical/issues/1932)).
The year still has to be one the download reaches, which is a fact about the file and is
checked separately.

**The 4 answers this block can give**, which are 4 different things and not 4 ways of
saying zero:

1. **Real figures**, using the tab's shared amount formatter.
2. **A checked zero** — no outside group reported spending anything about this legislator
   that year. The committee is confirmed and the download covers the year, so this is a
   published finding.
3. **No confirmed committee yet** — **0 of the 200 sitting members, as of the end of the
   31 August 2026 review sitting.** All 200 had at least one confirmed account on that day.
   This read "56 of the 200" earlier the same day, while that sitting was still running.
   The count is not fixed at 0 afterwards: withdrawing a member's only confirmation puts
   them straight back into this state and this panel back on their profile, which is what
   [#1902](https://github.com/alethical-org/alethical/issues/1902) made possible.
   **This answer now means only what it says**, which it did not until 2 September 2026:
   36 members whose committees somebody had confirmed were getting it because their
   reviewed donation years ended before 2026, per the correction above.
4. **A gap in our own copy** — a stale snapshot, a payment whose amount is blank, or a year
   the files do not reach. All 3 figures are withheld rather than published short by an
   unknown amount, because a figure short by an unknown amount and printed without a mark
   looks verified and is wrong.

Under each direction, the accepted redesign groups the selected year's payments by the
committee that spent them. Opening a group shows the payments behind it. Supporting,
opposing and any unspecified direction remain separate, including when the same spender
appears in more than 1 direction. No amount is moved between directions or combined with
the candidate's own receipts or ordinary payments out.

The shared payment-file freshness note appears once at the foot of the tab. It does
not date the separately copied report totals. The outside-spending card
does not repeat a download date. Its payment dates still describe its own source rows.
The complete grouped answer supplies each spender's amount and count. Opening a group
loads its complete payment list from the same published copy. Existing direction totals
stay visible if grouped details cannot load; a partial list never supplies a total.

Built by [#1332](https://github.com/alethical-org/alethical/issues/1332) and
[#1454](https://github.com/alethical-org/alethical/issues/1454).

---

## When the tab shows no split, and why

The unnamed figure is _worked out_ — the official total minus the donations we can list.
Every way that subtraction can go wrong is checked before it is printed, because a wrong
answer here does not look wrong. It looks like a fact about donors. In each case below
both official figures still appear; only the subtraction is withheld, and a sentence
says why.

| What the reader sees                                                                                                                                               | When                                                                                                                   | How common                                                                    |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| "These two figures cover different stretches of time."                                                                                                             | The committee's own report stops earlier than the donation spreadsheet does                                            | 16 committee-years                                                            |
| "Minnesota publishes these two figures separately, and for this committee and year they do not agree."                                                             | The comparison against the committee's own filed report found the two official figures differ, in **either** direction | 62 committee-years, and **42** once the part-year correction below is applied |
| "The state's separate list of donations holds none of them for this year — so the names are missing from what we can show you, not from what the committee filed." | The filing names donors and our copy of the donation spreadsheet carries no row at all for that committee-year         | 14 committee-years                                                            |
| "This committee filed its report for this year and then corrected it."                                                                                             | A subtraction refuses to run and the Board's catalogue records that the committee refiled the year's report            | 1 committee-year                                                              |
| "These two figures will not line up, and we cannot tell why."                                                                                                      | A subtraction refuses to run and nothing we hold says why                                                              | 0 committee-years                                                             |
| "The state has not published a report for this committee covering this year."                                                                                      | No official total we can stand behind for that year                                                                    | 7,442 committee-years                                                         |
| "We cannot tell whether every donor stayed under the naming threshold or whether donations are missing from the list."                                             | The committee reported money and the spreadsheet names none of it, and nobody has read the filing to find out which    | 468 committee-years                                                           |

Counts measured against the live release on 19 August 2026, across every committee-year
the release covers rather than candidate committees alone. They are evidence, not a
requirement. Read them together: the 7,442 is mostly committee-years whose official total
was never published rather than a failure of anything, and 3,062 committee-years do show a
full split.

**And 20 of those 62 were never a disagreement, which is the correction of 28 August 2026.**
Minnesota names only the donors who had passed $200 by a report's own cut-off date. Its
separate donation spreadsheet carries the whole year's naming decision. So on a report
covering part of a year the two figures count different sets of donors, for a reason that is
nobody's mistake, and the check read the difference as the state contradicting itself. It now
accepts either reading of the same named money on a part-year report, which takes 20
committee-years out of this row. The 37 pages that carried the sentence for this reason
included the committees of Amy Klobuchar, Lisa Demuth, Keith Ellison and Steve Simon, both
legislative caucuses and both major state parties.

Two things this correction deliberately does not do. It leaves the other 27 differences
standing, because a difference the threshold does not explain is a real finding and 17 of
those 27 are our records holding more named money than the filing itemized for reasons
nothing we hold accounts for. And it never rescues a shortfall: dropping donors only makes
our figure smaller, so a filing that already names more than we hold moves further away, and
the largest genuine gaps stay visible.

**Those 3 rows stay 3, because 1 shared sentence is false on 2 of them.** A committee-year
with no donation rows at all, and one whose two figures simply will not subtract, never
print the disagreement sentence — which says Minnesota's own publications contradict each
other about a named committee. Neither has any evidence for that: an empty spreadsheet has
nothing on our side to disagree with the filing, and a subtraction coming out negative tells
you the two numbers will not subtract and nothing about why. Both printed it until
19 August 2026; [#1682](https://github.com/alethical-org/alethical/issues/1682) and
[#1648](https://github.com/alethical-org/alethical/issues/1648) split them apart.

**Seven live committee pages printed it**, measured on production 19 August 2026 —
Kristin Robbins's governor committee (2025), IBEW - COPE (2024, 2025 and 2026), the Great
River Energy Action Team (2025), the 2nd Congressional District RPM (2025), and Wynfred
Russell's House committee (2026). The legislator tab this guide describes reached none of
them, because it needs a confirmed member-to-committee match and **on 19 August there were
none**; the committee pages shipped on 17 August need no such match, and they share this
wording. So this was a live wrong sentence about named committees, not a near miss.
**That shield is gone**: the 31 August 2026 review sitting confirmed 242 accounts covering
all 200 sitting members, so the tab now draws for everybody and any wording still wrong on
it is read rather than merely shipped.

**The disagreement row names no direction, and a test pins that it never does.** Any
direction is wrong on 33 of those 76: "add up to more than the committee reported raising"
is true of one of the two ways a page reaches that sentence and the reverse of the truth
on the other. The committee's own filed report naming money the spreadsheet does not hold
is the more serious of the two, because that money would otherwise be counted as having no
donor at all. Filer 20010's 2025 is the plain case: its filing itemizes $1,493,418.08 and
the spreadsheet holds $1,488,168.08.

**Nobody read it on a legislator's tab, and readers of committee pages did.** This tab only draws once a
person has confirmed which committee belongs to a member, and **on 19 August 2026 no such
confirmation existed** — `legislator_campaign_committee` held 0 rows in production, so
every member's tab showed the "nobody has confirmed which committee is theirs" panel and
never reached a split or its explanation. **The committee pages were a different story**:
they arrived on 17 August 2026, they key on a registration number rather than a person, and
they printed these same sentences. So on this tab it was a wrong sentence sitting in shipped
code, fixed before the first confirmation made it visible; on the committee pages it was a
wrong sentence a reader saw. Reach is recorded per surface because that difference is the
whole distance between a near miss and a published falsehood.

**Do not read that as still true: the emptiness was a date, not a property.** The
31 August 2026 review sitting put 275 reviewed accounts in that table, 242 of them
confirmed, covering all 200 sitting members. Every sentence on this tab is now read on a
named politician's page, so "no reader can reach it" has stopped being available as a
reason a wrong string is only a near miss.

The sharpest real case is the House Republican Campaign Committee's 2026: it reported
$399,275.76 through 31 March, and the donation spreadsheet names $881,816.24 of
donations through 20 July. Subtracting one from the other prints **minus $482,540.48**
of unnamed money, produced entirely by the two sources covering different months. So the
tab prints both figures and no subtraction.

---

## Missing, zero, and broken are three different things

- **"Not reported"** means the state's spreadsheet names nothing for this committee this
  year. It is never shown as "$0". A committee whose donors all stayed under the naming
  threshold need not be itemized, so silence here is silence, not a zero.
- **“$0” on an Expenditures line** is the official total the filing states, with its own
  sentence distinguishing that zero from a gap. A calculated named-payment zero stays
  beside the payment rows, never on the summary card.
- **“We do not hold an official spending total for this committee for this year.”**
  means Alethical lacks the official money-out figure. It never means the committee
  failed to report, and the Expenditures line is omitted.
- **A "Total contributions" figure is the filing's cash column, and it is not drawn where
  that column is $0 and every named donation was goods and services.** The Board's totals
  service serves the filing's Cash column: Citizens for Education Shakopee's 2025 year-end
  states "Cash 0.00, In-kind 3,868.19, Total 3,868.19", and the service serves $0.00. That
  zero is not the filing's total, so the page shows the itemized in-kind figure with the
  goods-and-services sentence and no "Total contributions" line, and says it holds no
  official total it can stand behind. 16 committee-years across 2024 to 2026 (11 Sep 2026).
- **A load failure gets its own message** and never falls through to "Not reported",
  because a fault on our side must not read as a named person having filed nothing.

---

## How a dollar amount is written

**The current formatter uses whole dollars, with cents cut rather than rounded.** $178,579,449.67 prints as
$178,579,449 and $99.99 prints as $99, so a figure here can never read larger than the
money it stands for. Rounding would break that on about half of all values, and reading
high about a named politician's money is the direction that does damage. The filed amount
to the cent is one click away on the Board's own site, which every money card links to.

**One exception, and truncation is what creates it.** An amount above zero but under a
dollar keeps its cents, so a 50-cent row prints $0.50. Cut to "$0" it would read as a
committee that reported nothing, which is the missing-versus-zero confusion the list
above exists to prevent.

**The profile uses Libre Franklin for amounts, dates, registration numbers and counts.**
Lines containing numbers use a heavier weight and equal-width digits, so changing a
number does not move the figures beside it. The filing's period uses a slightly lighter
weight. JetBrains Mono remains on short lettered labels, such as WHAT A PERSON CHECKED
and DONATED GOODS OR SERVICES.

**A line that stands on its own carries no full stop at the end.** That covers a caption,
a date or meta line, a label, a one-line description, and any stack of those — including
the sentences saying what a person checked before attaching a committee to a legislator.
An explaining paragraph inside a card keeps every full stop it has, however short it is.

---

## Dates, which are three separate things on this page

1. **Each payment list states the dates of the payments in it** — "Payments dated Jan 6,
   2026 to Jul 20, 2026". Those are the payments we hold, and the page never turns them
   into a claim about what period a filing covers.
2. **Each official total states the day its report runs to** — "covering through Mar 31,
   2026". A total whose coverage date falls outside the year on screen is not shown at
   all, because the Board's own service answers a request for a year it has no report
   for with the _previous_ year's figures and nothing in the answer says so.
3. **One shared freshness date at the foot of the tab** — shown only when the displayed
   campaign-payment and outside-spending files support the same download date. The note
   names payment files and explains that report totals are copied separately. It is not
   the period the money covers. If payment-file dates differ or a date is missing, the tab explains
   that it cannot state a shared date and lets the reader check the records again.

**A fourth kind of time exists and is deliberately not printed here.** Our data service
also reports when it last confirmed that these committees are still this member's, and
that one governs whether the cards are shown at all rather than what any date on screen
says. It is kept out of the 3 above because it describes our own checking rather than
Minnesota's records, and a reader has no use for it while the cards are being drawn
normally. What it does when it runs out is the section below.

---

## When the tab stops showing the committees, because the match is too old to repeat

These cards are on this member's page **because a person at Alethical confirmed which
committees are theirs**, and that decision can be taken back. So the tab only repeats it
while it has been able to check the match inside the last 20 minutes.

Past that it asks our data service again. If that answer arrives, nothing changes on
screen and the clock starts over. If it cannot be got, the cards are replaced by a short
paragraph saying we are not showing this member's committees right now, that somebody did
confirm them, and that this says nothing about what the member raised or spent.

Three things about it are deliberate:

- **It is not the "nobody has checked yet" panel.** Somebody has, and showing that panel
  would state something plainly false about this member.
- **A reader in ordinary use never sees it.** The recheck takes under a second. The reader
  who reaches it is one whose connection, or our service, has failed.
- **Withholding a match is not the same as hiding a figure.** Every dollar figure carries
  the period it covers and the day we copied it, so an old one is labelled rather than
  wrong. A claim about whose committee this is carries no such date and goes wrong
  silently the moment somebody corrects it, which is why only that one expires.

The 20 minutes, and the arithmetic that produces it, are in
[`docs/operations/page-load-performance-decisions.md`](../operations/page-load-performance-decisions.md)
under "How old a current claim can be, end to end"
([issue 2023](https://github.com/alethical-org/alethical/issues/2023)).

---

## Why a year has nothing to show, in the 6 different ways it can happen

Minnesota publishes campaign money **on a filing schedule, not day by day**. So a member
whose card is thin, or blank, is usually a member the state has not asked for a report
from yet. Without that said out loud, a reader in September sees "checked yesterday"
over figures that stop in July and concludes we are broken.

Until 27 August 2026 the tab said it **once, at the bottom, for everybody**: one fixed
paragraph reciting Minnesota's calendar in general, which left a reader to work out
which half of it applied to the member on screen. It also spelled 2026's dates out in
its own words, so on 1 January 2027 it would have quietly described a finished election
year and nothing would have announced it
([#1642](https://github.com/alethical-org/alethical/issues/1642)).

Now **each committee card carries its own sentence**, and there are 6 of them because
there are 6 genuinely different reasons. Every date in every one is read off the Board's
own published calendar for that committee and that year, so no date on screen is written
into our wording.

**Three of the 6 are facts about the committee:**

| The reader is told                                                                                                                                                 | When                                                                          |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------- |
| It is on this year's ballot, so it is on the election-year schedule, and its next report is named with its due date and the stretch of time it covers              | The state has scheduled a pre-primary or pre-general report for it this year  |
| It is not on this year's ballot, so it is on the schedule for candidates who are not running, which asks for a report once a year rather than around each election | The year's election reports have come due and the state scheduled none for it |
| It closed its registration with the state on a named day, so no further report is due from it                                                                      | The Board's filer record carries a termination date                           |

**The other 3 are our own unfinished work, and every one says so:**

| The reader is told                                                                                                                    | When                                                                                                                    |
| ------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| We cannot say, because it filed for a special election and special elections run on their own set of periods we have not written down | It has a special-election report this year                                                                              |
| We cannot say, because we have not yet copied in the filing calendar covering this committee for this year                            | The year is one we have not transcribed, or the seat is a statewide or appellate one on a calendar this batch left out  |
| We cannot say, because our copy of the state's own list of filings cannot answer it                                                   | No filings copied at all, this committee absent from the copy we have, or a copy taken too early to settle the question |

**Keeping those two halves apart is the whole point.** "We have not typed in that
calendar" and "nothing is due yet" are different facts, and letting the first read like
the second tells a reader something false about a named politician's duty to report.
That is [grounded-answers.md rule 12](https://github.com/alethical-org/alethical/blob/main/.claude/rules/grounded-answers.md)'s
missing-versus-zero rule applied to dates instead of to money. All 3 of ours share a
closing line — _"That gap is on our side and says nothing about this committee's own
filing"_ — so they read as one class.

**Two things this wording never does, each pinned by its own test:**

- **It never says a report is late.** The signal that marks an unfiled report can only
  be read in the current year, so the claim cannot be supported, and telling a reader
  that a named politician missed a deadline they may not even have is the worst thing
  this tab could produce.
- **It never prints the pre-general date without the exemption the Board prints beside
  it.** That exemption reads _"Candidates who lost the primary election do not need to
  file this report."_ Everyone who got past the primary owes the report and everyone who
  lost does not, and no record we hold says which happened. The date alone would invent
  a deadline for the losers; hiding the date would give the wrong answer to everyone
  else. So the exemption travels with the date, on its own line under it.

**One thing to expect and not mistake for a fault:** only Minnesota's 2026 calendars
have been transcribed, so switching the year to 2025 puts most committees into the
"we have not copied in that calendar" sentence. That is the honest answer, and copying
in another year's calendars is an edit to one file.

The states come from `alethical/api/services/committee_filing_schedule.py`, which reads
the Board's own filer record and its own report catalogue. The words come from
`apps/frontend/src/lib/legislatorCampaignMoney.ts`. That split is deliberate: the data
describes records and the page frames them.

---

## What this tab never says

- It never says money caused anything. No filing establishes that a donation changed a
  vote, and the tab shows records and connects nothing.
- It never adds a member's committees together into one figure, and it cannot: every
  amount the server sends is stamped with the committee that reported it, and adding 2
  stamped with different committees makes the code stop rather than answer. A separate
  check fails the build if the app is ever taught to do the same sum in the browser
  ([#1663](https://github.com/alethical-org/alethical/issues/1663)).
- It never ranks or compares members. Members sit on two different filing calendars, so
  on any day in 2026 one member's part-year total sits beside another member's figure
  covering different months, with nothing on screen to say so. Each member's figures
  carry their own dates instead.
- It never draws an unnamed cash slice unless the server supplies a checked split and
  the complete named cash rows agree with it. A chart does not loosen the figure checks.
- It never turns matching printed donor names into a donor identity or a claim that
  donations caused a vote.

---

## Where the data comes from

- **The donations and payments** come from Minnesota Campaign Finance Board bulk
  downloads covering 2015 through the current loaded year. A year button does not promise
  a newer download exists. These were loaded by [#1328](https://github.com/alethical-org/alethical/issues/1328).
- **The official totals** come from the Board's per-committee financial responses, with
  saved filed-report documents used for the checks, loaded by
  [#1408](https://github.com/alethical-org/alethical/issues/1408). Choosing an older year
  does not fetch a new state report or prove that an official total is held for it.
- **The match between a member and a committee** is a row a named person wrote and
  signed ([#1354](https://github.com/alethical-org/alethical/issues/1354)). No score, no
  threshold and no name match ever creates one.
- **The figure the money-out comparison reads** (a verdict the route serves and, since
  11 Sep 2026, the card no longer prints) is the committee's own filed report
  document, kept in our own store, so the comparison asks the Board for nothing. It is read
  by `stated_spending` in `alethical/pipeline/campaign_finance_report_documents.py`, the
  comparison is run by `alethical/pipeline/campaign_finance_stated_spending.py`, and its one
  verdict per committee-year is stored in `cf_stated_spending` and read back by
  `alethical/api/services/committee_stated_spending.py`
  ([#1645](https://github.com/alethical-org/alethical/issues/1645),
  [#1650](https://github.com/alethical-org/alethical/issues/1650)). The verdict is read,
  never computed while a page is drawn: reading a filing costs a document read, and a page
  that did it live would compare a different document each time the store changed.
  **Independent expenditures are in neither figure**, because Minnesota publishes what a
  committee spent for or against a named candidate as a separate download, so a comparison
  that looked for those payments in the ordinary payments file would invent a shortfall
  wherever a committee spends that way
  ([`campaign-finance-system-design.md`](../architecture/campaign-finance-system-design.md)
  §2.1, campaign finance).
- **The reading and the split** are
  `alethical/api/services/legislator_finance.py`, served by
  `GET /api/v1/legislators/{id}/campaign-finance?year=YYYY`. No money is summed there:
  every figure comes from `alethical/pipeline/campaign_finance_reader.py`, and every
  figure is stamped with the committee that reported it so a person's committees cannot
  be added together (`alethical/api/services/committee_amount.py`).

## What happens to reader data

The tab needs no sign-in and stores nothing about who read it. Payment requests go to
Alethical's own data service; searching the loaded names stays in the browser. Committee
names with a known destination open `/money/committees/{name}-{number}`. Official-source
links open the Minnesota Campaign Finance Board's website.
