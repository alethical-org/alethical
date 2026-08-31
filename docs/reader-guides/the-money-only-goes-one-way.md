<!-- describes: apps/frontend/src/lib/researchPieces/moneyOnlyGoesOneWay.ts -->
<!-- A TRANSCRIPTION OF THE PUBLISHED PIECE, taken from the shipped piece on 31 Aug 2026 and
     checked against the live page at `/read/research/the-money-only-goes-one-way`. It is NOT
     a manuscript settled before publication, and the difference is the reason this paragraph
     is first: do not read this file as the stronger thing.

     The 5 guides beside it in this folder were written and settled here before any page
     existed for them, so each of those files is the author's own manuscript and the page is
     the copy. "The Money Only Goes One Way" went the other way round. Its prose is Eugene's,
     transcribed straight into `apps/frontend/src/lib/researchPieces/moneyOnlyGoesOneWay.ts`
     when it posted on 20 Aug 2026, and no file was written for it. So this file pins WHAT
     SHIPPED on 31 Aug 2026. It cannot prove that what shipped is what the author wrote 11
     days earlier, and it does not claim to.

     WHY IT IS WORTH HAVING ANYWAY. Until it existed the piece's words lived in exactly 1
     place, and nothing failed when they changed. Measured on 28 Aug 2026 in
     [issue 1832](https://github.com/alethical-org/alethical/issues/1832): deleting the
     sentence carrying the $886 million lobbying figure failed 0 of 1,735 tests. Deleting a
     whole section failed 2, and both were incidental — one check happened to name a table
     inside it and another listed the section addresses. A later change pinned that single
     $886 million sentence literally, and left every other sentence in the piece unpinned.
     Now `apps/frontend/src/lib/__tests__/research.test.ts` compares this file and the shipped
     piece word for word, so an edit to either one alone fails the build.

     THE WORDS ARE SETTLED. `.claude/rules/grounded-answers.md` rule 13's publishing order
     lets the Alethical team direct a change (point 2a) and forbids us editing them on our own
     initiative. So if this file and the shipped piece ever disagree, this file or the test's
     extractor is what is wrong. Never edit the piece to make the check pass.

     WHAT THE MARKS MEAN HERE, because this piece uses 3 shapes no guide in this folder does.
     A markdown table is the piece's own table, header row first, which is the order the page
     draws the cells in; its pipes are marks and are dropped. A `###` heading is a method
     box's title, which the layout draws after that section's prose and uppercases, so the
     case written here is the case the piece stores. And the paragraph directly under the
     standfirst is the boxed summary at the top of the page, whose "SHORT VERSION" label
     belongs to the layout and is not a word of the piece.

     WHAT IS DELIBERATELY ABSENT. The contents rail's short labels for each section are
     navigation rather than prose, so they are not here and the word-for-word check does not
     cover them, exactly as it does not cover the masthead's dates or the layout's own box
     labels.

     WHERE IT LIVES. This folder is named for guides and this file is Research, which rule 13
     makes a different class with different promises. The folder name is wrong for it. A
     rename would touch all 6 files, the docs index and 2 architecture documents, so it is
     tracked as its own job rather than done here, and no reader ever sees the folder.
-->

# The Money Only Goes One Way

*If you've ever given $50 to a candidate, this is where it went.*

Every number below comes from public Minnesota Campaign Finance Board records, 2015
through 2026. You can look up every one of them yourself. Nothing here is an opinion about
a party.

## Start with your own check

The middle-of-the-road donation to a Minnesota candidate is $200. The middle-of-the-road
candidate for state office raises about $13,000 for the whole campaign.

That's the scale most people picture when they think about political money: a neighbor
running for the legislature, a few hundred donors, a yard sign budget.

Now the actual scale.

Over eleven years, 1,732 campaign accounts for state office took in $108 million between
them. That is accounts rather than people: someone who serves in the House and later runs
for the Senate has 2.

Over those same eleven years, six committees — the four legislative caucuses and the two
state parties — took in $221 million.

Six organizations. Twice the money of every campaign account in the state put together,
counting only the donations with a name attached. Counting every dollar they each reported
taking in, unnamed donors included, it is about 1.4 times.

One caution before the rest. Minnesota only requires a committee to name a donor once that
person has given more than $200 in total during a calendar year, so a large share of all
political money is reported as a lump figure with no names. Across the campaign accounts
of sitting legislators, that unnamed share was 36.5% of the money in 2024 and 41.3% in
2025. Everything that follows below counts only the named donations.

## The one-way valve

Here's the part almost nobody knows.

Candidate committees sent $13.9 million up to those six party and caucus committees. Dues,
transfers, contributions — money leaving a candidate's account and landing in the
machinery's account.

Those same six committees sent $730,338 back down to candidate committees.

Nineteen dollars up for every one dollar down.

One note on that ratio: the up and the down come from 2 different state filings, and the 2
don't fully agree. Counted from either filing alone, the ratio lands between 14.5 to 1 and
19 to 1. The direction never changes.

So where did the rest go? Of the $58.6 million the big six paid out in contributions,
$52.9 million went to other party units — sideways and upward, into state central
committees and federal accounts. 1.2% reached a candidate.

The last slice, $4.9 million, went to political committees and funds — most of it to 3
groups that run their own independent ads.

The money does not trickle down. It pools.

## "But the party spends on the candidate’s behalf"

True, and worth being precise about, because this is the honest counterargument.

Those six committees also spent $54.7 million on independent expenditures — ads and mail
about specific races. That money is spent on campaigns. It just isn't spent by them.

By law it can't be coordinated with the candidate. The candidate doesn't see the script,
doesn't approve the mailer, can't stop it, and often finds out the same day you do.

And here's what it buys: 60% of it was spent attacking someone, not supporting anyone.

Statewide the picture is the same. All independent spending since 2015: $178.6 million, of
which $96.5 million — 54% — was against a candidate rather than for one.

So when money "comes back down," it usually arrives as an attack ad the candidate on the
receiving end never asked for and can’t control.

## Why this isn't a party story

If the machinery were really two opposed teams, the money would sort itself into two
piles. It doesn't.

191 PACs gave to both parties' caucus committees. Not to one side heavily and the other by
accident — to both, on purpose, year after year.

Those 191 both-sides PACs account for $36.4 million of the $64.5 million in PAC money the
four caucuses received. More than half of all PAC money going to legislative caucuses
comes from donors funding both parties.

One small example, because the small ones are the clearest. The Optometry PAC has given
$226,600 since 2015. The split:

| Recipient | Amount |
| --- | --- |
| House Republican caucus (HRCC) | $38,200 |
| DFL House Caucus | $35,250 |
| DFL Senate Caucus | $31,500 |
| Senate Victory Fund (R) | $18,550 |

That is not a PAC picking a side. That's a PAC buying access to whoever wins — and it's a
rounding error next to the ones doing the same thing with real money.

### How we counted the 191

An organization counts as giving to both sides if the Board’s itemized contributions
download records at least one payment of any size to a DFL legislative caucus and at least
one to a Republican legislative caucus, across 2015 to 2026. Each organization is
identified by the name exactly as it appears on the filing. The rule changes the answer:
identifying organizations by registration number instead gives 187 and $39.8 million, and
requiring each side to be at least 5% of what an organization gave gives 170 and $25.9
million. “Both-sides PAC” is our term, not the Board’s. Counted from the download as
Alethical loaded it on 12 August 2026.

## The number that dwarfs all of it

Everything above is about elections. Elections are the small part.

Companies and organizations reported spending $886 million lobbying Minnesota government
from 2015 through 2025.

That is more than every candidate, every caucus, and both state parties combined — with
room to spare. All of them together took in $329.6 million over the same years, so
lobbying is 2.69 times as much.

The biggest spenders:

| Principal | Reported lobbying |
| --- | --- |
| Enbridge Energy | $25.9M |
| MN Chamber of Commerce | $24.4M |
| Xcel Energy | $21.7M |
| Education Minnesota | $11.3M |
| MN Business Partnership | $10.5M |

Note that this list isn't ideological either. Energy companies, a business chamber, and a
teachers' union are on the same page of the same ledger.

Campaign money is what gets spent before the vote. Lobbying is what gets spent after —
every day of every year, whether or not there's an election on.

### How we counted the lobbying total

The Board publishes 1 row per principal per report year, and no multi-year or
all-principals total across those rows, so the 11-year figures here are our own addition
of them, from its Total spent column, taking each organization as the Board’s own
registered entity. Two choices in that counting could have moved these figures, and
neither does. A report year is a calendar year of spending rather than of filing: the
Board’s Lobbying Handbook has each principal filing by 15 March for “the amount spent by
the principal in the preceding calendar year”, so nothing straddles 2 years. And no
registration number in the file carries 2 filed names and no name carries 2 numbers, so
identifying an organization by its filed name, by its registration number, or by name with
case and spacing normalized gives the same 3,056 organizations and the same 5 largest, to
the cent. What the records cannot do is separate the 4 kinds of lobbying before 2024;
everything earlier sits in a single general column. The rows run through the report due 16
March 2026, and are published at
cfb.mn.gov/reports-and-data/self-help/data-downloads/lobbying/.

## What the shape actually looks like

Money enters at the bottom, from people like you, in $200 pieces.

It moves up — from candidates to caucuses, from caucuses to state parties, from state
parties to federal accounts.

Along the way it meets much larger money from PACs and lobbyists, most of which is funding
both parties at once.

What comes back down is a fraction of what went up, and it mostly arrives as advertising
nobody in the race controls, more than half of it negative.

And the largest flow of all never touches an election.

Your $200 didn't buy a seat at the table. It bought a ticket to watch the table.

## What to do about it

Nothing here requires trusting us. It requires looking.

Pick one thing and look it up:

- Your own legislator. Who gave them money, and how much of it came from inside your
  district?
- One PAC name you don't recognize on their report. Search it. See who else it funds —
  including on the other side.
- One company you know operates in your area. Check what it's reported spending on
  lobbying.

You'll find something within twenty minutes. Everyone does. That's not because Minnesota
is unusually corrupt — it's because this information has always been public, and almost
nobody has ever gone and read it.

We're building the tools to make that easier. Until then, the records are open, they're
free, and they don't care who you voted for.

---

*Where these numbers come from.* Minnesota Campaign Finance Board bulk data downloads —
itemized contributions (583,152 records), itemized expenditures, and itemized independent
expenditures over $200 (41,130 records), 2015–2026. Minnesota requires a committee to name
a donor once that person has given more than $200 in total during a calendar year, and
permits it to name smaller donors as well. Money from donors who are not named is reported
as a single figure with no names attached, and this report counts only named payments.
Official filed report totals are the authoritative figures for any individual committee.
[Download the same files from the Board](https://cfb.mn.gov/reports-and-data/self-help/data-downloads/campaign-finance/).

CFB lobbying principal expenditure reports, 2015–2025. Alethical holds no lobbying
records, so every lobbying figure in this report is read from the Board’s own reports
rather than reproduced from our own data.
[Look up a lobbying principal at the Board](https://cfb.mn.gov/reports-and-data/searches-and-lists/other-reports-and-lists/current-lists/#/principal-historical-spending/all/), or
[download the rows these totals are added up from](https://cfb.mn.gov/reports-and-data/self-help/data-downloads/lobbying/).
