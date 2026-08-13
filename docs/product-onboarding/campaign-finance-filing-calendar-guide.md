# When a committee's next money report is due (plain English)

<!-- describes: alethical/pipeline/campaign_finance_filing_calendars.py, alethical/api/services/committee_filing_schedule.py -->

*Why a legislator's money page can honestly show nothing for a whole year, and what we
say instead of leaving it blank. Written for everyone on the team. The engineering
detail lives in
[`docs/architecture/campaign-finance-system-design.md`](../architecture/campaign-finance-system-design.md).*

---

## The problem this solves

In Minnesota a politician cannot take political donations personally. They register a
**committee** with the state, and that committee files reports saying who gave it money
and what it spent.

**How often it files depends on whether that politician is on this year's ballot.**

- A legislator **running in 2026** filed a report on 27 July covering 1 January to
  20 July, and files another on 26 October.
- A legislator **not running in 2026** files nothing covering 2026 money at all. Their
  next report is due **1 February 2027**.

So for part of the legislature, a money page shows nothing for 2026 — right next to a
page full of that member's current work on bills. To a reader that looks like the
politician is hiding something, or like our site is broken. Neither is true.

**The fix is one sentence on the page: nothing is due until 1 February 2027.** That
turns an alarming blank into a calm fact.

## The mistake we are most careful to avoid

Getting this wrong in the other direction is far worse. If we guessed that a member was
on the election schedule when they were not, the page would say a report was late when
no report was due. That is a false statement about a named politician, and it is the
thing this whole design is built to prevent.

So when we cannot work out which schedule a committee is on, **we say we do not know and
show no date.** A blank is honest. A wrong deadline is not. This is the same rule the
site follows everywhere: a missing answer and a real answer are different things, and we
never quietly turn the first into the second
([`.claude/rules/grounded-answers.md`](../../.claude/rules/grounded-answers.md) rule 12).

## Where the dates come from

The state's campaign finance regulator, the Minnesota Campaign Finance and Public
Disclosure Board, publishes a **calendar** each year saying exactly when each report is
due and what stretch of time it covers. There are 4 of them, one per kind of filer:

| Who it covers | What it lists for 2026 |
| --- | --- |
| Legislative and district-court candidates **on** the 2026 ballot | 4 money reports: closing 2025 (due 2 Feb 2026), pre-primary (due 27 Jul), pre-general (due 26 Oct), closing 2026 (due 1 Feb 2027) |
| Candidates **not on** the 2026 ballot | 2 money reports, both year-end: closing 2025 (due 2 Feb 2026) and closing 2026 (due 1 Feb 2027). Nothing else at all |
| State parties and legislative caucuses | 7 money reports |
| Political committees and funds | The same 7 |

They are short documents, published once each July, and they do not change. So they are
**typed into our code by hand**
([`campaign_finance_filing_calendars.py`](../../alethical/pipeline/campaign_finance_filing_calendars.py)),
each one recording the web address it was read from and the date it was read. Next
year's update is an edit to that one file, not a new investigation.

Every date in it is copied off the document. None is worked out from the others, even
where the pattern is obvious — a period that begins on 1 January is written down as
1 January **because the document prints it**, not because we assumed it. One kind of
filer's period genuinely does not start there, so assuming would eventually print a
wrong date range that looks perfectly plausible.

## How we work out which calendar a committee is on

Nothing the state publishes says "this committee is on the ballot this year". So we read
it off something the state does publish: **the list of reports it has scheduled for that
committee.**

The Board adds a report to a committee's list the moment that report's filing period
opens, whether or not anybody has filed it yet. That makes the list a **schedule**, not
a record of what has been handed in. So:

1. **The committee has a pre-primary or pre-general report scheduled for this year** →
   it is on the ballot, and its next report comes from the election-year calendar.
2. **It has none, and this year's first pre-election report has already come due** →
   the state never scheduled one for it, so it is not on the ballot, and its next report
   is the year-end one due next February.
3. **It has none, and this year's first pre-election report is not due yet** → we say we
   do not know. Early in the year nobody has one, so having none proves nothing.
4. **The committee has closed** (the politician shut it down and filed a final report) →
   nothing further is due, which the page says outright rather than leaving blank.

Test 3 is the guard that matters. Without it, every committee would read
"not on the ballot" every January.

## What we still cannot say, on purpose

- **Whether a report is late.** We can often tell, but not reliably in older years, and
  telling a reader a politician missed a deadline is the most damaging thing this
  surface could get wrong. So we do not claim it at all.
- **Whether a candidate who lost the primary still owes the October report.** They do
  not — the calendar says so in print — but no record we hold says who lost. So the
  page shows the October date **together with the printed sentence** that candidates who
  lost the primary do not need to file it. Hiding the date would misinform the many who
  advanced; stating it flatly would invent a deadline for the few who did not.
- **A date for a candidate in a special election.** They file a whole separate series of
  reports on their own timetable, which we have not established, so they read as
  unknown.
- **A date for a candidate for governor, attorney general, or an appeals court.** Those
  seats are on a fifth calendar we have not typed in. Their committees read as unknown
  rather than borrowing the legislative dates.
- **What a committee with no activity owes.** None of the 4 calendars says. If we ever
  need that, it has to come from the law itself, cited there.

## What was measured, on 12 August 2026

Against the live copy of the state's records:

- **200** sitting legislators.
- **198** of their committees carry the Board's own "currently in office" marker for a
  House or Senate seat. Of those: **159 on the 2026 ballot**, **38 not on it**, **1
  closed**, and **0 we could not place**.
- **194 of the 200** members match to one of those committees by district and surname.
  The other **6** do not, and that is the name-matching failing rather than anything
  missing from the schedule work.
- **0** of those matches has yet been checked by a person, which is the one thing left
  before a real name can appear beside a real committee's dates
  ([#1354](https://github.com/alethical-org/alethical/issues/1354)). Until then this
  answers per committee registration number, which needs nobody's confirmation.

Counts are what we measured on that day, not promises about what the source will hold
next time.
