# Campaign Finance: what we are building, and in what order

*This document explains the approved scope, the order of work, and the reasoning behind it.
GitHub owns current owners, dates, and progress: see the
[campaign finance milestone](https://github.com/alethical-org/alethical/milestone/7).*

Written for everyone on the team, not just people who write code. If a sentence here needs a
technical background to follow, it is a bug in this document. The engineering detail lives in
[`docs/architecture/campaign-finance-system-design.md`](../architecture/campaign-finance-system-design.md).

---

## What this is

Minnesota publishes who gives money to politics and where that money goes. It is public, and
almost nobody reads it, because it arrives as spreadsheets and PDFs.

We are putting that record on alethical.com next to what each legislator actually does, so a
person can look up their representative and see both in one place.

## The one rule that shapes everything

**Record pages show what the filings record, and never say what the money meant. Our signed
reports may name a pattern — only one a reader can recompute from the linked records.**

That a group gave a legislator $5,000 is a fact, and we will show it with a link to the
filing. That the $5,000 bought a vote is not a fact, and no surface of ours will ever say it,
imply it with a diagram, or label it with a phrase like "pay to play". A reader can draw their
own conclusion. We hand them the record, not the verdict.

Between those two sits a third kind of claim: a pattern that really is in the records — for
example, that two groups of candidates are funded in measurably different ways. Since
18 Aug 2026 (Eugene's call), that kind of claim is allowed in exactly one place: a signed,
dated research piece on the `/read` page (`/read/research/<name>`), where the method is printed
beside
the words, every figure links to the record behind it, and the reader can redo the arithmetic
and argue with the counting. What such a piece may do, and everything still banned there — motive
and causation above all — is
[`.claude/rules/grounded-answers.md` rule 13](../../.claude/rules/grounded-answers.md).

This is not caution for its own sake. Being trusted is the only thing this product has. A
record page that editorialized would spend that trust; a report that shows its working earns
it.

---

## First priority

These four come first. The first one has to exist before any of the others can be seen.

### 1. Getting the data in, safely

Nothing is visible until this works.

Minnesota puts its records online as spreadsheets we can download for free. We take a full
copy each time, keep it dated, check it, and then replace the previous copy completely.

That last part matters more than it sounds. The version of this product that already exists,
built on a tool called Base44, added new rows on top of old ones each time. It got that wrong,
and about a quarter of its records are duplicates of other records. Every total it shows is
inflated. Replacing the whole set each time makes that impossible rather than unlikely.

We also keep two things separate that it mixed up: an individual payment, and an official
total from a filing. They are different kinds of fact and adding them together double counts.

### 2. Campaign finance on legislator profiles

Angel's number one.

Every current House and Senate member gets their campaign money on their existing profile
page, for 2025 and 2026: what came in, what went out, and who gave it.

One thing to know about the data. Minnesota only names donors once someone has given more than
$200 in total across a year. Money a campaign does not name appears as a single lump
with no names. Note the 2 things that does *not* mean. Once a donor crosses $200, every later
gift they make is named however small, so most of the named gifts are individually under $200,
and a page must never say that small gifts are never named. And $200 is the point at which a
name becomes *required*, not a line below which nobody is named: a campaign may name a smaller
donor if it wants to, and at least one does, so a page must not say a small donor is never
named either. So a page will
show two numbers: the money we can name, and the official total including the money we cannot.
We say plainly what the gap is, rather than showing one number and letting people assume it is
everything.

### 3. Party and caucus records

The state parties and the four caucuses are the biggest funders in Minnesota politics, and
their money reaches candidates. Their records go in fully.

This can be built at the same time as legislator profiles. Neither waits for the other.

### 4. Making the records clickable

Once legislators and parties are in, the names inside their reports become links. Click a
donor and see everything else they gave to. Click a group and see who funds it.

This is what turns a page of numbers into something a person can follow. It needs the first
three to exist before there is anything to click.

### 5. Independent spending, the simple version

Money spent to support or oppose a candidate, by groups that are not the candidate's campaign.

It matters because **it never appears in a candidate's own report**. Someone reading only the
report is missing part of the picture. On a legislator's page we show three plain figures:
spent supporting them, spent opposing them, and spent where the filing does not say which.

**Built.** It is on every legislator's profile now, and it says plainly that nobody has yet
confirmed which campaign committee belongs to which person, so no figure can be attributed to
anyone until the review in number 2 lands. The third figure appears only when there is money in
it, which today there never is. Full explanation:
the *Spending by outside groups* section of
[How the Campaign money tab works](legislator-campaign-money-guide.md).

### Also in the first wave: our own research (added 18 Aug 2026)

Signed, dated research pieces, each at `/read/research/<name>` and listed on the
`/read` page, reached from the top
menu's **Read** item and from the money landing's "What we found" card: our research on
the records we hold, what they show when added up, every figure linked back to the record
behind it. The listing sat inside the money section, at `/money/reports`, until 20 Aug 2026
([#1698](https://github.com/alethical-org/alethical/issues/1698)), at `/reports` until the
morning of 27 Aug 2026, when "report" went back to meaning only the document a campaign files
with the state, and at `/reading` until that evening, when the menu item became the single word
**Read** and every address followed it
(`docs/architecture/published-writing-decisions.md` §2.6 and §2.13). All 7 old addresses forward
permanently and directly, each to its final `/read` address in 1 hop. This is
the one surface allowed to add records up across members and to name a pattern, under the
conditions in
[`.claude/rules/grounded-answers.md` rule 13](../../.claude/rules/grounded-answers.md).
A piece posts as its author wrote it, before any figure is checked, and goes live on the
site the same day: its own address, the `/read` page, the money landing's count, and the
sitemap search engines read (Eugene, 25 Aug 2026). Nothing waits, including search engines.
Every figure is then checked against our loaded data on the live page, which is now the only
thing standing between a wrong figure and a search result. A figure drawn from records we do not hold yet,
such as lobbying (number 8 below), stays in the piece, and the sources block names those
records and the years they cover. The masthead names no undated figure (Eugene, 20 Aug 2026).

---

## Second priority

### 6. Challengers

Who is running against each sitting legislator, reached from the tool that finds your
legislator by address, with their campaign money shown the same way.

### 7. Exploring independent spending properly

The full version of number 5: who spends it, on whom, and in which races.

### 8. Lobbying

Who is registered to lobby, who they work for, and what their clients spend. Minnesota
publishes all of it and almost nobody looks at it.

The spending half of the data is loaded: since 31 Aug 2026 the Board's
principal-expenditures file (what each organisation spent lobbying, per year) is held
as dated snapshots, so the $886 million figure our research piece publishes rechecks
against data we hold
([#1862](https://github.com/alethical-org/alethical/issues/1862)). The lobbyist and
client registration lists are not loaded yet, and no lobbying page exists — the pages
are their own later design work.

### 9. The money map

A picture of who gave to whom, built from the payments we already hold.

Every line on it is one reported payment with its own amount, date and source. It shows the
shape of the money. It does not claim the same dollars travelled from one end to the other,
because no filing establishes that and it would not be true.

---

## Third priority

### 10. Asking questions of the data

Letting people ask in their own words, answered only from records we hold, with a source on
every answer.

### 11. Letting legislators respond

They can already claim their profile. This lets them explain a vote in their own words, which
is fairer to them and more useful to a reader.

### 12. Social media links

Their public accounts, linked from their profile.

### 13. A tip line

Somewhere to send an anonymous pointer to something worth looking at.

---

## Minnesota only, and we do not say otherwise

Everything above is money reported to Minnesota's Campaign Finance Board: Minnesota races,
Minnesota candidates, Minnesota committees and parties. Money reported to any other body is not
part of this product, is not on this list, and is not named anywhere a reader can see.

That second half is the part worth stating. We do not put "not yet" on a page, or list what we do
not hold beside what we do. Telling someone a thing is not here yet promises them a date, and there
is no date. Every page says what it holds and stops there.

Eugene's call, 12 Aug 2026. It replaces an earlier "deferred" wording on this list, which had
started to read as a plan.

**One exception: this is a record-page promise.** A signed research report
(see "Our own research reports" above) may cite records filed with another body, named and
linked at their source. A report's sources block names
every filing body it used, so a reader can see which promise applies to the page they are
on. Record pages keep the rule above unchanged. Conditions:
[`.claude/rules/grounded-answers.md` rule 13](../../.claude/rules/grounded-answers.md).

---

## Why this order

1. **What has to exist first.** Number 1 gates everything. Nothing else can be seen without it.
2. **Then what Angel asked for.** Legislators, then challengers.
3. **Then what carries the most.** Party and caucus records outrank clickable links, because
   the caucus money is the story and links are how you move through it.
4. **Within the first priority the order is enforced.** After that, things are ordered but can
   move if a reason appears.
5. **Build all of it first, then chase the places our copy looks short.** Decided by Eugene on
   12 Aug 2026, and explained below.

### Build everything first, investigate the data afterwards

We know of 4 committees whose own filings name more donations than the spreadsheet we downloaded
actually contains ([#1386](https://github.com/alethical-org/alethical/issues/1386)). One is a
caucus and 3 are sitting legislators. Every measurement we can take on our own side has been
taken, twice, and the only step left is asking Minnesota's Campaign Finance Board why their own
download disagrees with their own filings. That is an email a person sends, not something anyone
can build, and a reply could take weeks. So the pages and features get built now and that
question gets answered whenever the Board answers it.

**Why that is safe today.** None of this money reaches a reader yet. The downloaded rows are
sitting in our database, and there is no page, no web address and no service that shows any of
them to anybody. A wrong number cannot be read off a screen that does not exist.

**Why it is not safe for the reason you would expect, and this is the condition on the
decision.** The engineering plan says a committee whose two figures do not add up is simply not
published
([campaign-finance-system-design.md §7 (display rules)](https://github.com/alethical-org/alethical/blob/main/docs/architecture/campaign-finance-system-design.md)).
Today that is a sentence in a document with nothing in the software carrying it out. The program
that loads the spreadsheets records that comparison as **"not run"**, because nothing yet fetches
each committee's own reported total to compare against, and only a check that actually *fails*
stops a release, so one that never ran stops nothing
(`alethical/pipeline/campaign_finance.py`). Nothing anywhere else computes it either: no table
keeps a reported total, no part of our service hands this data out, and the "Campaign Finance"
entry in the site's menu is a coming-soon label with no page behind it.

**So the comparison has to be built as part of the money pages themselves**
([#1329](https://github.com/alethical-org/alethical/issues/1329)), using the official totals that
[#1408](https://github.com/alethical-org/alethical/issues/1408) is fetching. If those pages ship
without it, each of the 4 short committees would show the donations we are missing as money that
had no donor, which is a false statement about money the state named
(`.claude/rules/grounded-answers.md` rule 12). Parking the investigation is safe; shipping the
pages without that check is not.

---

## The one thing left that a person has to do

**Nothing can show a legislator's money until someone confirms which campaign committee is
theirs, one legislator at a time.** Minnesota gives every committee a number and never says which
person it belongs to, and we refuse to guess, because attaching the wrong committee publishes
someone else's money under a real politician's name. So this is 200 decisions a person makes and
signs, and it is now the last thing standing between everything else being ready and a page with
money on it.

It is not a research task, and it got smaller today. The proposing work is built and measured
(11 Aug 2026): of the 200 sitting members, **144 have one obvious answer and 56 do not**. It was
108 and 92 this morning, before the state's own list of registered committees was added, which
carries each candidate's district and settles most of the name confusions on its own.

The 56 that remain are not mysteries. Every one is a member with two or more committees of their
own, so the question is which to show rather than who they are: a legislator known by a nickname
the state does not print ("Liish Kozlowski" is filed as "Kozlowski, Alicia"), one known by a middle
name ("Bjorn Olson" is "Olson, Christian Bjorn"), a committee named for a different office the
member once sought, or two committees of the same name filed under different numbers. Someone
reads each one and answers.

Until those answers exist, **every legislator profile shows the same unconfirmed state**, because
0 are confirmed today. The count is not a percentage of a finished thing; it starts at 0 of 200
and drains as answers land. The tool that asks the questions is
`scripts/review_legislator_campaign_committees.py`, and the standard it holds people to is in
[`campaign-finance-system-design.md` §5.1 (what counts as a confirmed match)](../architecture/campaign-finance-system-design.md).

**How the sitting works: one list, one word, then 56 questions.** `review --batch` prints all 144
uncontested legislators as one numbered list, each line naming the legislator, the committee, and
what the evidence rests on ("exact name, Board confirms seat, party money DFL agrees"). Type the
numbers of any to hold back, then the word `confirm`. Nothing is written until that word, and
anything held back joins the 56 in the one-at-a-time pass. So it is one screen to read and one word
to type, followed by 56 individual answers.

**The commands, in the order a sitting runs them.** `PYTHONPATH=.` is required and is not
optional politeness: the package is not installed into the virtual environment, so running the
script by its path puts `scripts/` on the import path instead of the repository root and the run
dies on `ModuleNotFoundError: No module named 'alethical'` before it reads anything. Run all 3
from the repository root. `--download` resolves the Board's contributions link from its page every
time and fetches about 83 MB, which takes a few minutes; pass `--contributions PATH` instead to
reuse a file already on disk. `coverage` and `propose` write nothing, so there is no way to do
harm by looking first.

```bash
# 1. What the proposer found, and how much of the roster it narrowed down. Writes nothing.
PYTHONPATH=. uv run python scripts/review_legislator_campaign_committees.py coverage \
  --download /tmp/contributions.csv --target production

# 2. The 144 uncontested as one numbered list, confirmed together after typing 'confirm'.
PYTHONPATH=. uv run python scripts/review_legislator_campaign_committees.py review --batch \
  --contributions /tmp/contributions.csv --target production --reviewer "Eugene Lopin"

# 3. The rest, one question at a time, answered y / n / s / q.
PYTHONPATH=. uv run python scripts/review_legislator_campaign_committees.py review \
  --contributions /tmp/contributions.csv --target production --reviewer "Eugene Lopin"
```

Re-running `coverage` between sittings is how progress is read: its first block counts what a
person has actually confirmed, and every command skips anything already decided, so a sitting can
stop at any question and the next one resumes there. Verified on 28 Aug 2026 against production
and that day's download: 144 uncontested, 56 contested, 0 confirmed.

**One person signs, and no second reviewer is asked for.** Two people reading the same committee
name share the same evidence, so they share its mistakes; a name that is genuinely ambiguous does
not become clearer for being read twice. What is independent of the reader is the sources, so a
`verify` command re-checks every confirmed link against the state's own records: the registered
committee list, which party's units pay the committee, and the committee's published name, which
can change. A wrong answer therefore surfaces the day the evidence shifts rather than waiting for
somebody to re-read 200 rows. It reports and never repairs, because a contradiction wants a
person's eyes. It is not scheduled and nothing runs it on a clock; it runs inside the data load
([#1328](https://github.com/alethical-org/alethical/issues/1328),
[#1398](https://github.com/alethical-org/alethical/issues/1398)) every time that load runs, using
the records already in hand there. A contradiction never blocks that load — the money data it
publishes is correct whether or not a committee's identity changed — and it is filed as a GitHub
issue so it reaches a person without anyone remembering to look.

---

## Answered, and no longer blocking

The 2 questions that were holding up the first priority
([#1337](https://github.com/alethical-org/alethical/issues/1337)) are settled. Full detail,
with the measurements behind it, is in
[campaign-finance-system-design.md §9 (filed reports and official totals)](https://github.com/alethical-org/alethical/blob/main/docs/architecture/campaign-finance-system-design.md).

- **Where the official totals come from.** The Board runs a service that returns a filer's
  yearly totals, and reading it for every sitting legislator takes about 2 minutes. Those
  totals are how much bigger the real number is: across sitting legislators' committees, the
  donors we can name accounted for 63.5% of the money in 2024 and 58.7% in 2025. The rest is
  small-donor money that has no names attached anywhere.
- **Which corrected version counts.** That same service has already picked the latest version
  for us, so most of the time we never decide. Where we do have to pick a document, the rule is
  the highest amendment number on it.

Two things the answer does not cover, both written up in the design: candidates who ran in a
special election file a second set of reports the service leaves out, and the Board publishes
no promise that this service will keep working, so a release stops rather than guesses when its
checks fail.

**Nobody is on these, and nothing is waiting on them:**

- Whether unions report anywhere we can reach. They are not with the Campaign Finance Board.
- Minnesota before 2015, which the free downloads do not reach.
