# How the Campaign money tab works (plain-English guide)

<!-- describes: apps/frontend/src/components/campaignMoney/CampaignMoneyTab.tsx, apps/frontend/src/components/campaignMoney/LegislatorProfileTabs.tsx, apps/frontend/src/lib/legislatorCampaignMoney.ts, apps/frontend/src/screens/redesign/LegislatorProfileWebScreen.tsx, apps/frontend/src/screens/redesign/LegislatorProfileMobileScreen.tsx, apps/frontend/src/navigation/webRoutes.ts, apps/frontend/src/navigation/links.ts, apps/frontend/src/data/api.ts, apps/frontend/src/hooks/useAppQueries.ts, alethical/api/services/legislator_finance.py, alethical/api/routers/public.py -->

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

**Nothing yet, and that is the honest answer rather than a fault.** Minnesota registers
a campaign committee by number and never records which person it belongs to, so
somebody has to read each committee's name and confirm whose it is by hand. Nobody has
done that sitting yet, so all 200 sitting members show the same panel:

> **We have not matched this member to their committee yet**
>
> Minnesota registers campaign committees by number and never records which person each
> one belongs to. This member's committees are on file with the state, and we have not
> yet confirmed which of them is theirs, so we are not showing figures here yet.
> Matching a committee to the wrong person is the worst mistake this page could make,
> so a person checks every match by hand.

![The Campaign money tab before any committee has been matched](../verification/1329-legislator-campaign-money/not-yet-matched-desktop-1280px.png)

Three things that wording is careful about, because a shorter sentence gets each wrong:

- **It never says no committee is registered for this member.** All 200 sitting members
  do appear in the Board's own list of registered filers, so that sentence would be
  false for every one of them.
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

Money from a race for a different office never appears here. Outside spending on a city
mayoral campaign is a real public record, but putting it under a state senator's name
would say something about their legislative work that no filing supports.

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
> in total for the year. Donors who gave $200 or less in total are never named, so their
> money is counted here but nobody knows who they are.

**Read that as the donor's yearly total, never the size of a single gift.** 327,759 of
the 583,152 published donation rows are individually under $200 and are named anyway,
because that donor's yearly total had already passed the line.

Money in that is not a donation — a loan the candidate made to their own campaign, most
often — is listed separately under its own heading, with the state's own label. It is
never added to the donation figure, because the filing carries it on a different
schedule and the Board's own totals exclude it.

### Money out

**Payments we can list**, with a count and a breakdown by the state's own labels for the
kind of payment. There is no second, bigger number here, and the tab says so: Minnesota
publishes payments over $200 but publishes no official total for a committee's spending,
so there is nothing to compare against and no split to draw.

### Outside spending

Money that groups other than the campaign spent supporting or opposing this member is a
separate public record and is never added to the committee's own money. It is being
built by [#1332](https://github.com/alethical-org/alethical/issues/1332) and
[#1454](https://github.com/alethical-org/alethical/issues/1454) and mounts into this
tab; the section below each committee is reserved for it.

---

## When the tab shows no split, and why

The unnamed figure is *worked out* — the official total minus the donations we can list.
Every way that subtraction can go wrong is checked before it is printed, because a wrong
answer here does not look wrong. It looks like a fact about donors. In each case below
both official figures still appear; only the subtraction is withheld, and a sentence
says why.

| What the reader sees | When | How common |
| --- | --- | --- |
| "These two figures cover different stretches of time." | The committee's own report stops earlier than the donation spreadsheet does | 28 of 446 candidate committees in 2026, 0 in 2025 |
| "Minnesota publishes these two figures separately, and for this committee and year they do not agree." | The donations listed add up to more than the committee reported raising | 6 candidate committees in 2026, 10 in 2025 |
| "The state has not published a report for this committee covering this year." | No official total we can stand behind for that year | 14 candidate committees in 2025, 0 in 2026 |
| "We cannot tell whether every donor stayed under the naming threshold or whether donations are missing from the list." | The committee reported money and the spreadsheet names none of it | 212 candidate committees in 2025, 28 in 2026 |

Counts measured against the live release on 12 August 2026. They are evidence, not a
requirement.

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

Underneath the freshness date sits the filing-schedule note, because without it a reader
in September sees "checked yesterday" over figures that stop in July and concludes we
are broken:

> Minnesota publishes campaign money on a filing schedule, not day by day. Members on
> the 2026 ballot filed on 27 July for money raised through 20 July, and file again on
> 26 October. Members not on the ballot do not report their 2026 money until 1 February
> 2027.

---

## What this tab never says

- It never says money caused anything. No filing establishes that a donation changed a
  vote, and the tab shows records and connects nothing.
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
- **The reading and the split** are
  `alethical/api/services/legislator_finance.py`, served by
  `GET /api/v1/legislators/{id}/campaign-finance?year=YYYY`. No money is summed there:
  every figure comes from `alethical/pipeline/campaign_finance_reader.py`.

## What happens to reader data

Nothing is collected by this tab. It needs no sign-in, stores nothing about who read it,
and sends nothing anywhere. Every link out of it goes to the Minnesota Campaign Finance
Board's own site and opens in a new tab.
