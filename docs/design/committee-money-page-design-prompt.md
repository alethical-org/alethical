# Committee money page — design prompt

A frozen design request, written 18 Aug 2026 for
[#1442](https://github.com/alethical-org/alethical/issues/1442). The backend it draws is
live and verified against production
([#1455](https://github.com/alethical-org/alethical/pull/1455),
[#1463](https://github.com/alethical-org/alethical/pull/1463),
[#1485](https://github.com/alethical-org/alethical/pull/1485)). The binding display rules
are `docs/architecture/campaign-finance-system-design.md` §7 and
`.claude/rules/grounded-answers.md` rule 12; every constraint below restates one of them
as a settled fact, so the prompt can be pasted into Claude Design as-is.

**Corrected 31 Aug 2026.** The donation-gap sentence below said donors at $200 or less
are never named. That is false: the threshold is a floor on who a committee *must* name,
never a ban on naming a smaller donor, and one 2026 filer itemises 215 of them. The
sentence now matches `.claude/rules/grounded-answers.md` rule 12
([#1755](https://github.com/alethical-org/alethical/issues/1755)). This file is frozen as
a record of the 18 Aug request, but its body is meant to be pasted verbatim, so a false
sentence in it is a false sentence waiting to be built.

**How to run it:** paste everything below the rule into Claude Design, attaching the two
screenshots from [PR #1499](https://github.com/alethical-org/alethical/pull/1499)
(`not-yet-matched-desktop-1280px.png` and `overview-pointer-desktop-1280px.png`, in that
branch's `docs/verification/1329-legislator-campaign-money/`). This file deliberately
declares no `describes:` code — it is a dated request, not a living spec.

---

## What you are designing

One new page: everything Minnesota's public records show about **one campaign
committee's money, for one year**. It is the first screen in the product that shows real
campaign money, because it needs nobody's confirmation: the state identifies a committee
by a registration number, and the page is keyed on that number.

Design desktop and phone. Match the visual language of the legislator profile's
Campaign money tab — the attached screenshots show the shipped version — and reuse the
profile page's existing cards, type and spacing rather than inventing a new vocabulary.
Where this page needs a state the tab never had, extend that language.

A committee here can be four different things, and the same page renders all of them:

- a **candidate committee** (one person's run for one office),
- a **party unit** — including the legislative caucuses, which are the biggest funders
  in Minnesota,
- a **political committee or fund** (a PAC),
- a **local campaign we hold no filings for** — a city council or mayoral run that
  appears in our records only because someone else spent money supporting or opposing
  it. For these, the committee's own money reads "Not reported" and the only populated
  section is what others spent about it.

**No person's name, photo, or seat appears anywhere on this page.** Connecting a
committee to a person is a separate, human-confirmed step that has not happened yet for
anyone. This page speaks only about the committee.

## Page header

- **Committee name exactly as the state filed it.** Filed names are messy — long,
  inconsistently capitalized, sometimes with stray double spaces ("Fateh, Omar for
  Minneapolis  Mayor") — and the design must survive them without truncating the part
  that distinguishes two similar committees.
- **What kind of committee it is**, in plain words: "Candidate committee", "Party
  unit", "Political committee or fund". For the local-campaign case, a line saying what
  the reader is looking at: this committee files with a local authority, not the state,
  so we hold only what others reported spending about it.
- **The registration number, visible but quiet.** It is the page's address and the
  trace back to the state's own records. It is text, not a number to format: local
  candidates carry an internal 11-digit negative value like `-2139639405`, and the
  design must not choke on the minus sign or the length.
- **A year control** offering every year from 2015 to the current year, newest first.
  Any year can be empty; empty years still render, with the honest state below.
- **One clearly labelled freshness date for the whole page** — the date of our copy of
  Minnesota's records. It is the only freshness date on the page, and it is never
  presented as the period the money covers: the money's own period is always earlier
  and is stated per figure. Include the standing schedule note near it: Minnesota
  publishes campaign money on a filing schedule, not day by day, so figures can
  honestly stop months before the freshness date.

## The three money cards

Every sentence quoted below is settled, tested copy — place it, don't reword it.
Everything unquoted (layout, hierarchy, grouping, emphasis) is yours.

### Money raised

Two numbers, both correct, never combined:

1. **What the committee reported raising**, from its own filed report, with the period
   the filing itself states: "covering through 31 Dec 2025". The period always comes
   from the filing. Never label it as a calendar year and never assume it starts
   1 January — a special-election filer's report can start 11 July, and a committee's
   2026 report can stop 31 March.
2. **The donations the state names**, summed from the state's published list, with the
   payment count and the dates of the payments we hold ("743 payments, dated 2 Jan to
   20 Jul 2025"). This figure is always smaller.

The gap between them is mostly small-donor money the state never names — around 4
dollars in 10 on a typical committee. When the two figures pass our consistency check,
show the unnamed remainder and its share ("52% of the donations the committee
reported"), with this fixed explanation:

> Minnesota only makes candidates name a donor once that donor has given more than
> $200 in total for the year. A donor who gave $200 or less in total for the year need
> not be named, though a committee may name one anyway. The money counted here is the
> money the state's public file does not say who gave.

The threshold is on the donor's **yearly total**, never on the size of one gift —
most named payments are individually under $200 — so no wording anywhere on the page
may say small gifts or small payments go unnamed.

**The split is withheld whenever the subtraction cannot be honest.** In those states
the two official figures still show, but there is no remainder, no share, and no
composition bar — a wrong remainder does not look wrong, it looks like a fact about
donors. Each withheld state has its own fixed sentence:

- *Periods differ* (the committee's report stops earlier than the donation list):
  > These two figures cover different stretches of time. The committee's own report
  > stops earlier than the donation list does, so subtracting one from the other would
  > not tell you anything about donors.
- *No named payments* (the committee reported raising money and the state names none
  of it):
  > This committee reported raising money, and the state's donation list names none of
  > it for this year. We cannot tell whether every donor stayed under the naming
  > threshold or whether donations are missing from the list, so we do not say either.
- *Sources disagree* (the state's two publications contradict each other):
  > Minnesota publishes these two figures separately, and for this committee and year
  > they do not agree: the donations the state lists add up to more than the committee
  > itself reported raising. We show both and work out neither, because we cannot tell
  > which one is right.
- *No reported total* (we hold no official total we can stand behind):
  > We do not have an official total for this committee covering this year that we can
  > stand behind, so there is nothing to compare these donations against. What is
  > listed here is only the donations Minnesota required this committee to name.

**Other money in, beside the donations and never inside them.** Filings carry receipts
that are not contributions — most often a candidate lending money to their own
campaign — and they appear under the state's own labels ("Loan Receivables",
"Miscellaneous Income"), each with its own total and count. Folding a $5,000 self-loan
into a $5,100 donation figure would double a real committee's raised money on its page.

**Figure stand-ins.** A committee-year the state's download does not cover reads
**"Not reported"** — set in body type, never in the size reserved for an amount, and
never rendered as $0. A real case: a committee whose 2025 filing itemizes $2,300 that
the download simply does not carry; "$0 raised" there would be a false statement over a
real filing. When our own copy of the data cannot be read, the card says **"We couldn't
load this"** instead — a fault of ours, worded as ours, and distinct from "Not
reported".

### Money spent

One number: the payments the state names, with count and a breakdown by the filing's
own labels ("Campaign Expenditure", "General Expenditure", "Non-Campaign
Disbursement") — different kinds of committee use different labels for the same thing,
so the labels are shown as filed, not translated. Unpaid obligations, when the filing
carries them, appear as their own labelled figure, not folded into the total.

Minnesota publishes **no official total for spending**, so unlike money raised there is
no second number and no split. The card explains that, per state, with fixed copy:

- Figures shown:
  > Minnesota only publishes payments over $200, and publishes no official total for a
  > committee's spending, so there is no bigger number to compare this against.
- Nothing published for this committee-year:
  > Minnesota only publishes a committee's payments over $200, and it published none
  > for this committee this year. That does not mean the committee spent nothing.
- Our copy unreadable:
  > We could not read this committee's payments out of our copy of Minnesota's file.

### Money others spent about this committee

Independent spending: money third parties reported spending to support or oppose this
committee. Three figures — **supporting**, **opposing**, and **direction not
recorded** — each with its payment count, plus the dates of the payments.

Two ways this card differs from the other two, both deliberate:

- **Here, zero is a real zero.** A committee absent from this file had no independent
  spending reported about it, which is a finding, not a gap. "$0" is correct here. Only
  a failure to read our own copy shows "We couldn't load this".
- **Do not describe these figures as "only the large payments".** The $200 naming rule
  belongs to donations; this file has no such floor, and nearly half its rows are under
  $200.

Nothing on this card may imply the spenders coordinated with the committee — the law
these filings exist under says the opposite.

## The payment lists

Behind the three cards sit three lists of individual payments: **who paid this
committee**, **who it paid**, and **who spent money about it**. Long lists page.

- Each row carries its **own amount, its own date, and the state's own label**, with
  the payer or payee's name exactly as filed.
- **Some names are links; most are not.** A name links only when it belongs to a
  registered committee we hold filings for — the backend says which. A donor's name
  can carry a state ID that belongs to a lobbyist, not a committee, so linking every
  name would produce wrong links, not dead ones. An unlinked name is plain text with no
  link affordance, not a disabled-looking link.
- **The lists carry no totals.** Every figure a reader can quote lives on the cards
  above; the lists are the receipts behind them.
- **Nothing may imply money travelled between committees.** That a party gave a caucus
  $100,000 and the caucus later gave a candidate $5,000 are two documented facts; that
  the same dollars moved is not one, and no filing establishes it. No arrows, no flow
  lines, no "passed on to", no visual chaining of rows. Each payment stands alone with
  its own amount, date and source.

## States to design, each as its own frame variant

Real production examples are given so each state can be drawn with honest proportions;
the figures are from Minnesota's own published files.

1. **Populated, split shown** — the ordinary case. Example: the House Republican
   Campaign Committee (a party unit), 2025: reported $1,747,196.69 covering through
   31 Dec 2025; named donations $1,488,168.08 across 743 payments; payments out
   $725,879.43 across 414. Also draw a candidate committee with a dominant unnamed
   share: one real committee reported $13,900.48 for 2025 against a single named
   payment of $1,000, so a treatment tuned for a thin unnamed sliver is wrong.
2. **Populated, split withheld** — example (periods differ): the same party unit's
   2026 report stops 31 March at $399,275.76 reported, while the donation list runs to
   20 July and names $881,816.24. Both figures show with their own periods; no
   remainder.
3. **Year not reported** — the committee exists and filed, but the state's download
   carries nothing for the year on screen. "Not reported", never $0. The same
   committee's next year can be fully populated, so a reader switching years watches
   money appear; the state must read as a fact about the records, not a fault.
4. **Local campaign, target only** — e.g. "Fateh, Omar for Minneapolis  Mayor": its
   own money reads "Not reported" with the local-filer explanation, and the
   independent-spending card is populated ($34,623.72 supporting on one such
   committee).
5. **Closed committee** — the page says the committee closed, and when. Real case: a
   sitting member's committee terminated 28 July 2026, with money in 2025 and nothing
   in 2026 — a reader switching years watches money disappear, and the explanation
   must be on the screen they land on, not inferable from the one they left.
6. **Couldn't load** — per card, not per page: one card can fail to read while the
   other two show figures. Draw one card in its failed state beside two healthy ones.
7. **Unknown committee** — the address names a registration number our records don't
   hold. The page says the number is not in **our** records; it never says "no such
   committee exists", because the state's own directory decides that, not us.

## How readers arrive, and what not to add

Readers reach this page by clicking a committee's name inside a payment list on another
page, or by a link someone shared. **There is no search on this page, no committee
directory, and no browse path — do not design one.** Arrivals are cold: assume the
reader clicked a name and does not know what a campaign committee is, so the page
carries one plain line of orientation near the top.

Two more standing rules:

- **No comparisons.** Nothing on the page ranks, totals or compares this committee
  against any other. Committees file on different calendars, so any side-by-side
  figure compares filing schedules while looking like it compares money.
- **Cents always show**, on every figure, including the millions: the page's promise is
  that any number on it can be checked against the state's own file, and a rounded
  number cannot be.
