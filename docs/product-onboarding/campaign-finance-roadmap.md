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

**We show what the filings record. We never say what the money meant.**

That a group gave a legislator $5,000 is a fact, and we will show it with a link to the
filing. That the $5,000 bought a vote is not a fact, and we will never say it, imply it with a
diagram, or label it with a phrase like "pay to play". A reader can draw their own conclusion.
We hand them the record, not the verdict.

This is not caution for its own sake. Being trusted is the only thing this product has, and a
claim we cannot back is the one thing that would end it.

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
$200 in total. Everything below that appears as a single lump with no names. So a page will
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

### 14. Federal money

Congressional races and federal committees. Deferred on purpose: it is a separate system, a
different set of rules, and a large amount of work for a Minnesota-first product.

---

## Why this order

1. **What has to exist first.** Number 1 gates everything. Nothing else can be seen without it.
2. **Then what Angel asked for.** Legislators, then challengers.
3. **Then what carries the most.** Party and caucus records outrank clickable links, because
   the caucus money is the story and links are how you move through it.
4. **Within the first priority the order is enforced.** After that, things are ordered but can
   move if a reason appears.

---

## Still unanswered

**Someone is on these 2, and the first-priority work needs them**
([#1337](https://github.com/alethical-org/alethical/issues/1337)):

- Where to get filed reports in bulk, rather than one PDF at a time. We need them for the
  official totals, which include the small-donor money that has no names attached. Without a
  route to them, a legislator's page can show the donors we can name but not the true total.
- How to tell which corrected version of a filing replaces which. A filing can be amended
  several times, each version restating the same money, so counting them all would report the
  money several times over.

**Nobody is on these, and nothing is waiting on them:**

- Whether unions report anywhere we can reach. They are not with the Campaign Finance Board.
- Minnesota before 2015, which the free downloads do not reach.
