# How the Campaign money tab works (plain-English guide)

<!-- describes: apps/frontend/src/components/campaignMoney/CampaignMoneyTab.tsx, apps/frontend/src/components/legislator/OutsideSpendingCard.tsx, apps/frontend/src/lib/outsideSpending.ts, alethical/api/services/independent_spending.py, apps/frontend/src/components/campaignMoney/LegislatorProfileTabs.tsx, apps/frontend/src/lib/legislatorCampaignMoney.ts, apps/frontend/src/screens/redesign/LegislatorProfileWebScreen.tsx, apps/frontend/src/screens/redesign/LegislatorProfileMobileScreen.tsx, apps/frontend/src/navigation/webRoutes.ts, apps/frontend/src/navigation/links.ts, apps/frontend/src/data/api.ts, apps/frontend/src/hooks/useAppQueries.ts, alethical/api/services/legislator_finance.py, alethical/api/services/committee_amount.py, alethical/api/routers/public.py -->

Every current Minnesota House and Senate member's profile page has two tabs:
**Overview**, which is the page as it has always been, and **Campaign money**, which
shows what that member's campaign raised and spent in a calendar year and who is named
as giving it.

Built for [#1329](https://github.com/alethical-org/alethical/issues/1329). The rules it
answers to are
[campaign-finance-system-design.md §7 (Display rules)](https://github.com/alethical-org/alethical/blob/main/docs/architecture/campaign-finance-system-design.md)
and
[grounded-answers.md rule 12 (campaign-finance display)](https://github.com/alethical-org/alethical/blob/main/.claude/rules/grounded-answers.md).

---

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
read.** The first line is always the same shape, "Checked by Alethical on 31 August 2026",
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

Two buttons, top right: **this calendar year and the one before it**. Today that reads
2026 and 2025, and on 1 January 2027 it will read 2027 and 2026 without anyone editing
anything. The years are read off the calendar deliberately, because a written-down pair
would hide a new year from every reader and nothing would announce it.

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

Two figures, and they are different things:

- **Total this committee reported to the state.** The committee's own report, with the
  date it runs to stated underneath, and a link to the state's site where its filed
  reports can be looked up by registration number.
- **Donations with a donor's name.** The state publishes a spreadsheet of the donations
  it required each committee to name. This is what that spreadsheet holds for the year,
  with how many payments and the dates of the first and last one.

**Donations with nobody's name on them** is the difference between the two, shown as a
dollar figure and as a share. On a typical member roughly 4 dollars in 10 land here. The
sentence under it is fixed and says exactly this:

> Minnesota only makes candidates name a donor once that donor has given more than $200
> in total for the year. A campaign may name a smaller donor but does not have to, and for
> this money the state's public file does not say who gave it.

**Read that as the donor's yearly total, never the size of a single gift.** 327,759 of
the 583,152 published donation rows are individually under $200 and are named anyway,
because that donor's yearly total had already passed the line.

**And read it as a floor, not a ban.** The sentence used to end "Donors who gave $200 or
less in total are never named", which is not what the rule says: the $200 is the point at
which a campaign *has to* name someone, and a campaign may name a smaller donor if it
chooses. At least one does, so a reader who opened that filing and found a $75 donor listed
by name would have caught our page saying it was impossible
([#1755](https://github.com/alethical-org/alethical/issues/1755), corrected 27 Aug 2026).

Money in that is not a donation — a loan the candidate made to their own campaign, most
often — is listed separately under its own heading, with the state's own label. It is
never added to the donation figure, because the filing carries it on a different
schedule and the Board's own totals exclude it.

### Money out

**Payments out this committee reported to the state**, where we hold that figure, above
**Payments we can list** with its count and its breakdown by the state's own labels for
the kind of payment. Two figures, exactly as money in has 2, and never subtracted:
`.claude/rules/grounded-answers.md` rule 12 wants a second number beside every money
figure, and until 31 Aug 2026 money out was the only figure on this tab with none.

**And a sentence saying whether anybody compared that figure against the report the
committee itself filed with Minnesota.** This is the wording both money-out surfaces share,
and it lives here; the committee page's own guide
([`campaign-money-section-guide.md`](campaign-money-section-guide.md) item 6) points at this
paragraph rather than restating it. Three outcomes:

- **The two agree: no sentence at all**, and the card draws exactly as it did before. An
  ordinary case gets no decoration.
- **The two disagree**: the page says it compared them, that the committee's own filing
  itemizes a different amount of money out from the one the state's payments file holds, and
  that we show what each says and work out neither because we cannot tell which is right. It
  never says which of the 2 figures is the larger one, because the disagreements run both
  ways and any wording that picked a side would be wrong about a third of the time.
- **Nobody has compared them yet**: the page says so, and says it cannot rule out that the
  filing names payments our copy is missing. Three different reasons land here and all 3 get
  this sentence, because none of them is a pass: we hold no copy of the filing's report
  document, our own reader read a document and could not prove itself against figures we
  already trust, or the comparison has not been run over the payments currently published.

**This is a different comparison from the direction-flip note the committee page draws, and
the 2 must not be read as one.** That one is our listed payments against the committee's
*reported total*. This one is the committee's own *itemized* money-out subtotal, read off the
filed report document, against the payments the state's file holds for the same period --
like against like, which is why it can find a shortfall the other cannot. Measured on the
live release, 2 Sep 2026, across all 4,124 committee-years of 2024, 2025 and 2026 the check
reaches: 3,304 agree and 217 disagree, 481 we hold no filing document for, and 122 our own
reader could not prove itself on. Of the 217, **40 are the filing naming money out our rows
do not hold**, $492,182.50 of it, and 16 of those hold not one payment row while the filing
names money out; the other 177 are our rows exceeding the filing's itemized figure,
$1,698,395.18 of it. **33 of the 217 sit on a committee somebody has confirmed for a sitting
legislator**, so they render on this tab as well as on a committee page, 6 of the 33 being
the direction where the filing names more than we hold. A further 24 of the
we-hold-no-document cases and 18 of the reader-could-not-prove-itself cases sit on a
confirmed committee. Whether a person loaded any of those pages nothing we hold can say.

**And the answers are only as fresh as the last run of the check.** Each answer is tied to the
exact copy of Minnesota's download it was made about, so publishing a new copy retires all of
them at once and every committee-year reads "nobody has compared these yet" until somebody
re-runs it. That is honest and it is not the intended steady state; the fix is
[#1922](https://github.com/alethical-org/alethical/issues/1922).
Full measurement:
[`campaign-finance-system-design.md`](../architecture/campaign-finance-system-design.md) §9.9
(checks this design asks for), and
[#1650](https://github.com/alethical-org/alethical/issues/1650).

**And under "Payments we can list", where there is any, how much of it was goods and
services rather than money.** Minnesota's payments file marks each payment cash or in kind,
and this tab drew no such line until
[#1894](https://github.com/alethical-org/alethical/issues/1894) because the legislator route
sent no figure for it, while the donations half of the same card has named its own in-kind
amount since [#1332](https://github.com/alethical-org/alethical/issues/1332). The line states
the amount and explains nothing: it never claims the goods and services are why the 2
money-out figures differ. Absent whenever the amount is not above zero, which is both a
committee-year whose payments we hold none of and one whose payments are all cash -- never a
drawn "$0.00", for the same reason nothing else here is.

**What used to be here, and it was false.** The tab said Minnesota "publishes no official
total for a committee's spending". Minnesota publishes one: the filed report's own "Total
Expenditures and Disbursements" line, held in `cf_filing_figure.total_expenditures` for
**3,630 filer-years**, which the committee page had always printed 2 clicks away. The
committee route served it and the legislator route did not, so the tab drew nothing and
then explained the absence by blaming Minnesota. Both halves are fixed
([#1875](https://github.com/alethical-org/alethical/issues/1875)): the route serves it,
the tab draws it, and the sentence beneath says the 2 are separate claims never subtracted.

**Where the figure is genuinely absent, the sentence says the gap is ours.** Counted
across the 242 confirmed committees on 31 Aug 2026: for 2025 the figure can be shown on
199, is held back on 7, and does not exist in our copy on 36; for 2026 it can be shown on
168 and does not exist on 74. The 7 held back are **special-election filer-years**, of
which the live snapshot holds 39 in total: we have the number and refuse to stand behind
it, because a special-election filing's totals copy cannot speak for a whole year. Rep. Xp
Lee's committee 19223 for 2025 is one of them and holds $16,923.32 we will not publish.
Nothing is drawn as a zero in any of those cases, because a missing figure and a zero are
different facts.

**And read "payments over $200" the way this guide already reads the donor threshold —
as a floor on who a committee must name, never as a filter on the file.** 41,978 of the
96,772 payment rows for 2024 to 2026 are individually $200.00 or less (157,121 of 377,860
across the whole file), because a committee must name a recipient once the year's payments
to them pass $200 and may name a smaller one if it chooses. Same correction as
[#1755](https://github.com/alethical-org/alethical/issues/1755) made for donors.

### Spending by outside groups

A group that is not a candidate's campaign can spend money to help or hurt that
candidate. Minnesota calls this an **independent expenditure**. **The money never reaches
the campaign and never appears in any report the campaign files**, so somebody reading
only the committee cards above would miss it entirely and have no way to know it was
missing. That is why this block sits on the same tab, below them, and never has its
figures added to theirs.

It shows the current calendar year and the one before, each with up to 3 figures.

| Figure | What it means |
| --- | --- |
| **Spent supporting them** | Payments Minnesota's filing marks `For` this legislator's committee. |
| **Spent opposing them** | Payments the filing marks `Against` it. |
| **Spent where the filing does not say which** | Payments whose `For` or `Against` cannot be read. |

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
is the *donor's yearly total* on the donations file described further up this guide, and it
does not apply here. This block says "told the state" rather than calling its figures all
outside spending, because nothing can know about spending nobody filed.

**Why it says nothing today, and it is the same reason as the committee cards.** Minnesota
records each payment against a committee, never against a person. Senator Omar Fateh is the
measured case: he is a sitting state senator and also ran for Minneapolis Mayor, and the
2025 filings carry 10 separate committees named "Fateh, Omar for Minneapolis Mayor" holding
$487,974.82 of supporting and $162,841.95 of opposing spending, while his Senate committee
has had none since 2022. A page matching on his name would put roughly $488,000 of a city
mayoral race on a state senator's legislative profile.

**The 4 answers this block can give**, which are 4 different things and not 4 ways of
saying zero:

1. **Real figures**, each to the cent.
2. **A checked zero** — no outside group reported spending anything about this legislator
   that year. The committee is confirmed and the download covers the year, so this is a
   published finding.
3. **No confirmed committee yet** — **0 of the 200 sitting members, as of the end of the
   31 August 2026 review sitting.** All 200 had at least one confirmed account on that day.
   This read "56 of the 200" earlier the same day, while that sitting was still running.
   The count is not fixed at 0 afterwards: withdrawing a member's only confirmation puts
   them straight back into this state and this panel back on their profile, which is what
   [#1902](https://github.com/alethical-org/alethical/issues/1902) made possible.
4. **A gap in our own copy** — a stale snapshot, a payment whose amount is blank, or a year
   the files do not reach. All 3 figures are withheld rather than published short by an
   unknown amount, because a figure short by an unknown amount and printed without a mark
   looks verified and is wrong.

Its own freshness date is shown as *Copied from the state on …*. The 2 years are 2 separate
requests, so if a new download becomes current between them the block shows **no** date
rather than one that is true of only some of the figures under it.

Built by [#1332](https://github.com/alethical-org/alethical/issues/1332) and
[#1454](https://github.com/alethical-org/alethical/issues/1454).

---

## When the tab shows no split, and why

The unnamed figure is *worked out* — the official total minus the donations we can list.
Every way that subtraction can go wrong is checked before it is printed, because a wrong
answer here does not look wrong. It looks like a fact about donors. In each case below
both official figures still appear; only the subtraction is withheld, and a sentence
says why.

| What the reader sees | When | How common |
| --- | --- | --- |
| "These two figures cover different stretches of time." | The committee's own report stops earlier than the donation spreadsheet does | 16 committee-years |
| "Minnesota publishes these two figures separately, and for this committee and year they do not agree." | The comparison against the committee's own filed report found the two official figures differ, in **either** direction | 62 committee-years, and **42** once the part-year correction below is applied |
| "The state's separate list of donations holds none of them for this year — so the names are missing from what we can show you, not from what the committee filed." | The filing names donors and our copy of the donation spreadsheet carries no row at all for that committee-year | 14 committee-years |
| "This committee filed its report for this year and then corrected it." | A subtraction refuses to run and the Board's catalogue records that the committee refiled the year's report | 1 committee-year |
| "These two figures will not line up, and we cannot tell why." | A subtraction refuses to run and nothing we hold says why | 0 committee-years |
| "The state has not published a report for this committee covering this year." | No official total we can stand behind for that year | 7,442 committee-years |
| "We cannot tell whether every donor stayed under the naming threshold or whether donations are missing from the list." | The committee reported money and the spreadsheet names none of it, and nobody has read the filing to find out which | 468 committee-years |

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

**Three of those rows used to be one, and the shared sentence was false on two of them.**
Until 19 August 2026 a committee-year with no donation rows at all, and one whose two
figures simply would not subtract, both printed the disagreement sentence — which says
Minnesota's own publications contradict each other about a named committee. Neither had
any evidence for that: an empty spreadsheet has nothing on our side to disagree with the
filing, and a subtraction coming out negative tells you the two numbers will not subtract
and nothing about why. Splitting them apart is
[#1682](https://github.com/alethical-org/alethical/issues/1682) and
[#1648](https://github.com/alethical-org/alethical/issues/1648).

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

**The disagreement row used to name a direction and it was the wrong one on 33 of those
76.** It said the listed donations "add up to more than the committee reported raising",
which is true of one of the two ways a page reaches that sentence and the reverse of the
truth on the other. The committee's own filed report naming money the spreadsheet does
not hold is the more serious of the two, because that money would otherwise be counted as
having no donor at all. Filer 20010's 2025 is the plain case: its filing itemizes
$1,493,418.08 and the spreadsheet holds $1,488,168.08. The sentence on screen now names
no direction, and a test pins that it never does again.

**Nobody had read it on a legislator's tab when it was fixed, and the first version of
this paragraph wrongly implied nobody could read it anywhere.** This tab only draws once a
person has confirmed which committee belongs to a member, and **on 19 August 2026 no such
confirmation existed** — `legislator_campaign_committee` held 0 rows in production, so
every member's tab showed the "nobody has confirmed which committee is theirs" panel and
never reached a split or its explanation. **The committee pages were a different story**:
they arrived on 17 August 2026, they key on a registration number rather than a person, and
they printed these same sentences. So this was a wrong sentence sitting in shipped code,
fixed before the first confirmation made it visible, rather than a wrong sentence a reader
saw. Recorded this way round because the difference is the whole distance between a near
miss and a published falsehood, and the first telling of it took the credit for the wrong
one.

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
  threshold is never itemized, so silence here is silence, not a zero.
- **"$0.00"** appears only where a committee genuinely reported nothing and the
  spreadsheet names nothing, and the two therefore agree.
- **A load failure gets its own message** and never falls through to "Not reported",
  because a fault on our side must not read as a named person having filed nothing.

---

## Dates, which are three separate things on this page

1. **Each payment list states the dates of the payments in it** — "Payments dated 6 Jan
   2026 to 20 Jul 2026". Those are the payments we hold, and the page never turns them
   into a claim about what period a filing covers.
2. **Each official total states the day its report runs to** — "covering through 31 Mar
   2026". A total whose coverage date falls outside the year on screen is not shown at
   all, because the Board's own service answers a request for a year it has no report
   for with the *previous* year's figures and nothing in the answer says so.
3. **One freshness date for the whole tab** — the day we downloaded Minnesota's files.
   It is not the period the money covers, and the tab says so in those words.

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

| The reader is told | When |
| --- | --- |
| It is on this year's ballot, so it is on the election-year schedule, and its next report is named with its due date and the stretch of time it covers | The state has scheduled a pre-primary or pre-general report for it this year |
| It is not on this year's ballot, so it is on the schedule for candidates who are not running, which asks for a report once a year rather than around each election | The year's election reports have come due and the state scheduled none for it |
| It closed its registration with the state on a named day, so no further report is due from it | The Board's filer record carries a termination date |

**The other 3 are our own unfinished work, and every one says so:**

| The reader is told | When |
| --- | --- |
| We cannot say, because it filed for a special election and special elections run on their own set of periods we have not written down | It has a special-election report this year |
| We cannot say, because we have not yet copied in the filing calendar covering this committee for this year | The year is one we have not transcribed, or the seat is a statewide or appellate one on a calendar this batch left out |
| We cannot say, because our copy of the state's own list of filings cannot answer it | No filings copied at all, this committee absent from the copy we have, or a copy taken too early to settle the question |

**Keeping those two halves apart is the whole point.** "We have not typed in that
calendar" and "nothing is due yet" are different facts, and letting the first read like
the second tells a reader something false about a named politician's duty to report.
That is [grounded-answers.md rule 12](https://github.com/alethical-org/alethical/blob/main/.claude/rules/grounded-answers.md)'s
missing-versus-zero rule applied to dates instead of to money. All 3 of ours share a
closing line — *"That gap is on our side and says nothing about this committee's own
filing"* — so they read as one class.

**Two things this wording never does, each pinned by its own test:**

- **It never says a report is late.** The signal that marks an unfiled report can only
  be read in the current year, so the claim cannot be supported, and telling a reader
  that a named politician missed a deadline they may not even have is the worst thing
  this tab could produce.
- **It never prints the pre-general date without the exemption the Board prints beside
  it.** That exemption reads *"Candidates who lost the primary election do not need to
  file this report."* Everyone who got past the primary owes the report and everyone who
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
- It never draws a chart of the named-versus-unnamed split. §7 describes one; it was
  left out of the first build deliberately, because a new chart implies a precision this
  data does not have while the plain figures do not. Raised as an open design question
  on [#1329](https://github.com/alethical-org/alethical/issues/1329).

---

## Where the data comes from

- **The donations and payments** come from Minnesota Campaign Finance Board bulk
  downloads, loaded by [#1328](https://github.com/alethical-org/alethical/issues/1328).
- **The official totals** come from the Board's own per-committee reports, loaded by
  [#1408](https://github.com/alethical-org/alethical/issues/1408).
- **The match between a member and a committee** is a row a named person wrote and
  signed ([#1354](https://github.com/alethical-org/alethical/issues/1354)). No score, no
  threshold and no name match ever creates one.
- **The figure the money-out comparison reads** is the committee's own filed report
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

Nothing is collected by this tab. It needs no sign-in, stores nothing about who read it,
and sends nothing anywhere. Every link out of it goes to the Minnesota Campaign Finance
Board's own site and opens in a new tab.
