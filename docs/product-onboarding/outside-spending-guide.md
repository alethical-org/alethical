# Spending by Outside Groups (plain-English guide)

<!-- describes: apps/frontend/src/components/legislator/OutsideSpendingCard.tsx, apps/frontend/src/lib/outsideSpending.ts, alethical/api/services/independent_spending.py -->

**Spending by Outside Groups** is a block on every Minnesota legislator's profile page.
It shows money that groups other than the legislator's own campaign spent to support or
oppose them.

You do not need an account. Open any legislator's profile
(`/legislators/<name>`) and scroll to the block below their chief-authored bills.

> **This guide is temporary and folds into another one.**
> [#1329](https://github.com/alethical-org/alethical/issues/1329) is building a Campaign
> money tab on the same profile page, and its own guide already reserves a section for this
> block. That guide is `legislator-campaign-money-guide.md`, which will sit in this same
> folder; it is written but not yet merged as of 13 Aug 2026, which is why there is no link
> to it here and no path that would resolve yet. When that
> tab lands and this card moves into it, everything below belongs in that guide's **Outside
> spending** section and this file should be deleted. It exists separately only because this
> block is live on the profile page now and that tab is not, and one guide per surface beats
> two.

---

## 1. Why this money gets its own block

A group that is not a candidate's campaign can spend money to help or hurt that
candidate. Minnesota calls this an **independent expenditure**. The money never reaches
the candidate's campaign and never appears in any report the campaign files.

That is the whole reason the block exists: someone reading only the candidate's own
filing would miss this money entirely and would have no way to know it was missing. So
the block says that in its opening lines, above the figures rather than in a note below
them, because the reader most likely to be misled is the one who reads least.

---

## 2. What the figures mean

The block shows the current calendar year and the one before, each with up to 3 figures.
The years follow the calendar, so nothing here goes stale.

| Figure | What it means |
| --- | --- |
| **Spent supporting them** | Payments Minnesota's filing marks `For` this legislator's committee. |
| **Spent opposing them** | Payments the filing marks `Against` it. |
| **Spent where the filing does not say which** | Payments whose `For` or `Against` cannot be read. |

Each figure carries **its own payment count**, because the payments behind one figure are
not the payments behind another. Below them, the block states the span the payments
actually fall in (for example *Payments made Feb 3, 2025 to Oct 28, 2025*) rather than
assuming a year runs from 1 January, which a special-election filer's report does not.

**The 2 sides are never added, subtracted, or netted against each other**, and they are
never drawn as opposing halves of one shape. That a group spent money opposing a lawmaker
is a fact with a filing behind it; that it changed anything is not, and no label,
ordering or picture here may suggest otherwise. Nothing says the legislator received,
raised, welcomed or coordinated any of it.

### The third figure is usually absent, on purpose

Every one of the 41,130 payments in the current download records `For` or `Against`, and
none is blank (measured 13 Aug 2026). So the third figure is $0 for everybody today, and
the block **hides it while it is $0** rather than showing a permanently empty row, which
would tell a reader Minnesota leaves the question open when it does not.

It exists for the day Minnesota publishes something the code cannot classify. Before
[#1454](https://github.com/alethical-org/alethical/issues/1454) such a payment was
dropped from both sides and the page still read as complete, so the money vanished with
nothing on screen to say so. Guessing a side would have been worse: it would invent a
claim about a named person.

---

## 3. What you see today, and why

**Right now every legislator's block says we cannot show a figure.** That is honest, and
here is the reason.

Minnesota records each of these payments against a **campaign committee**, identified by a
registration number. It never records one against a person. So connecting a payment to a
named legislator needs somebody to confirm, by hand, which committee belongs to which
human being. Nobody has done that review yet: the table holding those confirmations has
0 rows in production.

The block says so in one paragraph rather than showing $0, and it says the same sentence
once rather than repeating it under each year, because the reason is about the person and
holds for every year.

**This is not caution for its own sake.** Senator Omar Fateh is the measured case: he is a
sitting state senator and also ran for Minneapolis Mayor, and the 2025 filings carry 10
separate committees named "Fateh, Omar for Minneapolis Mayor" holding $487,974.82 of
supporting and $162,841.95 of opposing spending. His actual Senate committee has none
since 2022. A page that matched on his name would put roughly $488,000 of a **city
mayoral race** on a **state senator's** legislative profile. Matching only on a confirmed
registration number prints nothing, correctly.

The review that fills those confirmations is
[#1354](https://github.com/alethical-org/alethical/issues/1354). Figures appear for a
legislator the moment theirs lands.

---

## 4. The 4 things the block can say

Read these as 4 different answers, never as 4 ways of saying zero.

1. **Real figures.** We hold the payments and the numbers are exact.
2. **A checked zero** — *No outside group reported spending anything to support or oppose
   this legislator in 2026.* The committee is confirmed, the download covers that year,
   and no group filed a payment over $200 about them. This is a published finding, and it
   is the only case where the block says nothing was spent.
3. **No confirmed committee yet** — today's answer for everybody, explained in §3 above.
4. **A gap in our own copy.** Either our snapshot of the state's files is out of date, or
   we hold a payment whose amount is blank and therefore cannot be added up, or the year
   asked about is one the files do not reach at all. In every one of these the block
   withholds all 3 figures rather than publishing a total that is short by an unknown
   amount.

That last one matters more than it sounds. A figure short by an unknown amount, printed
without a mark, is worse than no figure: it looks verified and is wrong. So a single
unreadable payment withholds the whole block, including for a legislator who holds 2
committees where only one is affected, because the figures shown are sums across all of
them.

If the request itself fails, the block says so and says the failure is at our end.

---

## 5. Where the numbers come from

- **Source:** the Minnesota Campaign Finance and Public Disclosure Board's independent
  expenditure download (`cfb.mn.gov`). The block links straight to it.
- **Freshness:** one date, shown as *Copied from the state on …*, for the whole block. One
  date and not one per year, because both years come out of the same download.
- **Coverage:** the download reaches 2015 through the present. Only payments over $200
  are named, which is Minnesota law rather than a gap in our copy.
- **Your data:** the block reads public records only. It sends nothing about you anywhere,
  needs no account, and stores nothing in your browser.

---

## 6. Related

- The design that commissioned it:
  [campaign-finance-system-design.md](../architecture/campaign-finance-system-design.md)
  §7 (Display rules).
- The rules the wording answers to:
  [grounded-answers.md](../../.claude/rules/grounded-answers.md) rule 3 (grounded
  neutrality) and rule 12 (campaign-finance figures).
- The endpoint behind it:
  [backend-api-system-design.md](../architecture/backend-api-system-design.md),
  `GET /api/v1/legislators/{id}/independent-spending`.
- The same figures for a committee rather than a person:
  `GET /api/v1/committees/{registration_number}/finance`
  ([#1442](https://github.com/alethical-org/alethical/issues/1442)).
