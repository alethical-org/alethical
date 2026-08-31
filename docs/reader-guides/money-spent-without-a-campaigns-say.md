<!-- describes: apps/frontend/src/lib/researchPieces/moneySpentWithoutACampaignsSay.ts -->
<!-- POSTED 27 Aug 2026, and live at `/read/guides/money-spent-without-a-campaigns-say`.
     This file is where the prose was written and settled before any container
     existed for it, exactly as the 3 guides before it were written, and it stays the source of
     record for the words. The shipped piece is
     `apps/frontend/src/lib/researchPieces/moneySpentWithoutACampaignsSay.ts`, and
     `apps/frontend/src/lib/__tests__/research.test.ts` compares the 2 word for word,
     so an edit here without the matching edit there fails the build, and so does the
     reverse. The words are settled: rule 13's publishing order lets the Alethical team
     direct a change (point 2a) and forbids us editing them on our own initiative.

     WHAT IT IS. The fourth piece written in the set "How the Money Works", following
     `docs/reader-guides/why-2-official-numbers-can-both-be-right.md`. Issue #1752's
     first comment fixes the set's reading order and titles this one "Money spent
     without a campaign's say", folding independent spending, the rule against
     coordinating it, and lobbying disclosure as a separate set of records. A
     **Guide** teaches one piece of how the system works and draws no conclusions.

     NO READER-FACING LINE NUMBERS THIS PIECE OR COUNTS THE SET, per Eugene's ruling
     of 27 Aug 2026 (`docs/architecture/published-writing-decisions.md` §2.12).

     WHICH RULES BIND IT. `.claude/rules/grounded-answers.md` rules 1 to 12. Rule 3 is
     the sharpest here, because this piece names real spenders and the committees they
     spent about: the piece says what each record states and never why it was spent,
     whether anyone saw it, or whether it worked. NOT rule 13.

     THE CROSS-MEMBER FIGURE THIS PIECE REFUSES TO CARRY, AND THE PLANNED CLAIM IT
     DISPROVES. `docs/architecture/published-writing-decisions.md` §2.8 flagged this
     topic's outline claim, that "more than half of it attacks rather than supports",
     as arguably needing rule 13, and left the classification to whoever wrote the
     piece. Measured on the Board's own file, downloaded 27 Aug 2026:

     - By payment count the claim is FALSE and not close. 31,718 of the 41,130 rows
       are marked For and 9,412 are marked Against, so 77% support.
     - By dollars the claim is true: $96,547,924.18 of $178,579,449.67 sits on rows
       marked Against, 54.1%.

     So the outline's sentence is true only of a figure it never names, and the 2
     answers point opposite ways. **The dollar figure is not printed**, because summing
     amounts across every spender and every affected committee in the file is rule 13's
     first special permission, and a guide gets no part of it. The row counts ARE
     printed, on the precedent guide 2 shipped under: a count of rows in a published
     download is a fact about the download, names nobody, and sums no member's money
     (`docs/reader-guides/what-the-records-name.md` prints 583,152 and 337,888 on
     exactly that ground). The piece then says in its own words that a count of
     payments is not a count of money and that the amounts are in the same file, so a
     reader is told the second answer exists rather than being handed our version of
     it. **Classification, therefore: guide only, and §2.8's open question is closed
     by this piece.** The dollar split belongs to a signed research piece if anyone
     wants to publish it.

     HOW EVERY FIGURE AND EVERY QUOTE WAS ESTABLISHED. Everything read at the Board's
     own site or at revisor.mn.gov on 27 Aug 2026. **The independent-spending figures
     were counted from the Board's own published download rather than from our loaded
     copy**, which is stronger than pieces 1 and 2 managed and is the reason the piece
     can date them to the day it was written.

     1. 41,130 payments, back to 2015. Counted from the Board's "Itemized independent
        expenditures of over $200 - All" download, resolved from its campaign finance
        data downloads page on 27 Aug 2026 and read row by row. 19 columns, the same
        count `docs/architecture/campaign-finance-system-design.md` §2.1 measured on
        11 Aug 2026, so the file has not moved between those dates.

     2. 31,718 For and 9,412 Against. Counted over the "For /Against" column of that
        same file. They sum to 41,130 exactly, so no row is blank or carries a third
        value.

     3. Every payment came from a party unit or a political committee or fund, and
        none from a candidate's own committee. Two independent facts, both from the
        Board: the file's "Spender type" column holds only PTU (7,284) and PCF
        (33,846), and the Board's downloads page publishes this dataset in 7 filer
        categories where the other 2 datasets have 8, the missing one being candidates.

     4. Renew Minnesota's 2 payments. Read row by row out of the same file:
        registration 41337; 19 Mar 2026, $61,687.00, For, affected committee "Dippel,
        Tom Senate Committee" (19246), purpose "Advertising - general: Ad Placement",
        vendor Arena LLC of Salt Lake City; 7 Jul 2026, $63,940.00, Against, affected
        committee "Janigo, Kristy Senate Committee" (19214), same purpose wording, same
        vendor. **Chosen because 1 spender on both sides is the only balanced worked
        example available**: any pair drawn from 2 different groups makes the piece
        look like it picked a side, and this pair shows the direction marker doing its
        job without that. The amounts are the 2 "Ad Placement" rows; the same spender
        also filed a $5,500.00 and a $6,500.00 "Ad Production" row on those 2 dates,
        which are left out because 2 numbers per payment would bury the point.

     5. "Independent expenditure" and "approved expenditure", quoted verbatim.
        Minnesota Statutes 10A.01 subdivisions 18 and 4, fetched from revisor.mn.gov
        and read in the page's own text rather than relayed. The 2 sentences the piece
        leans hardest on, "An independent expenditure is not a contribution to that
        candidate or local candidate" and "An approved expenditure is a contribution to
        that candidate or local candidate", are the closing sentences of those 2
        subdivisions.

     6. The $3,000 lobbyist line, the principal, and the 15 March report. Minnesota
        Statutes 10A.01 subdivisions 21 and 33 for the 2 definitions, and the Board's
        Lobbying Handbook (issued January 2026) for the reporting words: "If an
        association or individual is a principal they will need to file an annual report
        with the Board by March 15 each year" and "The annual report provides the amount
        spent by the principal in the preceding calendar year on the four types of
        lobbying; legislative action, administrative action, lobbying the Minnesota
        Public Utilities Commission, and lobbying political subdivisions." The
        handbook's own decision tree supplies "Are you asking for something?".

     7. That a principal's report is a yearly total rather than a list of payments.
        Read off the Board's own "Principal expenditures - 2009 - Present" download on
        27 Aug 2026: 9 columns, 1 row per principal per year, no date, no official, no
        subject. Not printed as a figure; used only to state what the record is shaped
        like, which the handbook's own sentence already says.

     WE HELD NO LOBBYING RECORDS WHEN THIS POSTED, AND WE DO NOW (31 Aug 2026,
     issue 1862). The Board's yearly principal-expenditure file is loaded as dated
     snapshots, and both published pieces were corrected the same day to say so under
     rule 13 point 2a, on Eugene's direction. What did NOT change is this piece's
     shape: the 2 halves' sourcing stays visibly apart, the independent-spending
     figures are counted from a file, and the lobbying half still carries no spending
     figure beyond the 2 statutory thresholds. **No lobbying figure here is given the
     masthead's records-through date**, because the lobbying file is a separate yearly
     filing with its own coverage end, the report due 16 March 2026.

     RESOLVED 28 AUG 2026, and the finding below is kept as the record of what was
     wrong. The data was never withdrawn, only moved: the Board now serves it as
     "Historical spending by principals on lobbying activities" at
     `https://cfb.mn.gov/reports-and-data/searches-and-lists/other-reports-and-lists/current-lists/#/principal-historical-spending/all/`,
     covering 2007 through the report due 16 Mar 2026, with a Total spent column per
     principal per year. The research piece's link now points there, verified rendering
     in a browser rather than by status code, since the dead address returned 200 too.
     The report's $886 million figure is a separate question and is NOT re-verified by
     that fix: summing it means every principal across 11 years, which is its own task.

     A LIVE FINDING ABOUT THE RESEARCH PIECE, REPORTED RATHER THAN FIXED HERE. *The
     Money Only Goes One Way* links "Look up a lobbying principal at the Board" to
     `https://cfb.mn.gov/reports-and-data/viewers/lobbying/principal/`. That address
     answers **HTTP 200 with a page whose only heading reads "This page is not
     available"**, which is the soft-failure shape §2.1 and §9.4 already warn about, so
     nothing about the response looks like an error.
     `https://cfb.mn.gov/reports-and-data/viewers/lobbying/lobbyist/` fails the same
     way. The Board's working tools are named differently and both answer: its
     **Lobbying Organizations Search Tool** at
     `https://cfb.mn.gov/reports-and-data/viewers/lobbying/lobbying-organizations/` and
     its **Lobbyist Search Tool** at
     `https://cfb.mn.gov/reports-and-data/viewers/lobbying/lobbyists/`, plural. This
     piece links the 2 that work. Rule 13's publishing order puts a change to a posted
     piece with Eugene, so nothing here edits the research piece; filed as
     [#1802](https://github.com/alethical-org/alethical/issues/1802). Corroborating
     figure while checking it: the research piece's $886 million for 2015 through 2025
     reproduces to $886,298,059.00 from the Board's own principal expenditures
     download, so its number is right and only its link is broken.

     WHY THIS IS 1 PIECE AND NOT 2, WHICH WAS A REAL DECISION. Independent spending
     and lobbying are 2 separate record systems and either could fill a guide on its
     own. They stay together because the piece's job for lobbying is orientation
     rather than depth: a reader finishing pieces 1 to 3 knows the campaign-money
     records well enough to mistake lobbying for more of the same, and the correction
     is 1 section, not a piece. What was held back, and what a later piece would be
     made of: the 4 lobbying types and the fact that the Board's published file only
     splits them from 2024 onward, everything before that sitting in a single "General
     lobbying amount" column beside PUC. This sentence was changed to "2023" on 27 Aug 2026
     and changed back on 28 Aug 2026: 2023 carries exactly 1 row in each new column, M A
     Mortenson Co's $4,000.00 and $30,000.00, which is 0.03% of that year and 2 rows out of
     1,610. True of those rows, false of the year
     (`docs/architecture/campaign-finance-system-design.md` §2.2, the principal
     expenditures file). Also held back, and CORRECTED
     28 AUG 2026: this comment said political subdivisions and public colleges are
     excluded from the principal report and report to the Office of the State Auditor
     instead, calling it a real hole in the record. The first half is false, measured
     against the Board's own principal expenditure file: 53 genuine public bodies are in
     it, 40 of them spending more than $0, including 19 cities (Duluth, Mankato,
     Burnsville, Roseville, Coon Rapids and 14 more), Martin, Hennepin and Sherburne
     counties, and about a dozen school districts. The largest are the St Paul Port
     Authority at $376,552 and SouthWest Transit at $319,830. So political subdivisions
     file principal reports.

     The public-college half is UNSETTLED rather than confirmed. The University of
     Minnesota does not appear in the file at all, which is consistent with an exclusion
     and is not proof of one: absence is not a rule. Anyone building a piece on this must
     establish why it is missing before writing that public colleges are excluded, which
     is exactly the trap this correction exists to stop, because this item is listed as
     the seed of a future piece and a future piece would have inherited the error.

     Also held back: the $50,000 grass-roots threshold
     that makes an organisation a principal with no lobbyist at all; and the gift
     prohibition.

     WHAT WAS DELIBERATELY LEFT OUT, each for its own reason.

     1. Any dollar total for independent spending, per the classification above.
     2. Any lobbying figure at all, per the sourcing rule above. The 2 statutory
        thresholds are the law rather than a measurement.
     3. Whether an independent expenditure was truly independent. The label is what the
        spender filed, and no record can show what 2 people said to each other. The
        piece says the record carries the claim and stops there.
     4. Any count of what we currently hold. `.claude/rules/grounded-answers.md` rule 12
        requires such a count to be read live rather than pasted, and a markdown draft
        cannot read anything live.

     WHAT THIS PIECE OWNS, so the rest of the set links here rather than re-explaining:
     independent expenditure and the coordination test - approved expenditure and why
     the same money changes name - the For and Against marker - lobbyist - principal -
     the annual principal report.

     WHERE IT LINKS BACK: 1 link, to piece 1, for the registration line every political
     account crosses. It stays a relative link between the drafts HERE, because
     `scripts/check_doc_references.py` requires a relative link inside `docs/` to
     resolve to a real file; the shipped piece points it at the reader-facing address
     `/read/guides/who-has-to-report-their-money`. Pieces 2 and 3 are deliberately not
     linked: nothing here depends on a term either of them owns, and issue #1752's
     linking rules make a link a judgement rather than a habit. The $200 in the file's
     own heading is quoted as the Board's title for the file and no claim is made about
     how that threshold is worked out for spending, which is not established.

     WHERE IT LINKS FORWARD: 1 link to piece 5, in the closing paragraph, added the day
     that piece posted. It used to end "This paragraph gains a link to it the day that
     piece posts", and that sentence came out with the link because it becomes false the
     moment the link exists. The shipped piece holds the address as a literal, for the
     same cycle reason the piece before this one does, and a test asserts it equals piece
     5's real path.
-->

# Money spent without a campaign’s say

*How the Money Works*

Everything in this set so far has been money that went into a campaign’s account and out of
it again. Plenty of the money aimed at Minnesota government never touches one.

Two kinds of it are reported, and they are reported in different places, by different people,
on different clocks. Neither one is the campaign’s to control.

## Spending about a race with the campaign kept out of it

A group can pay for advertising about a candidate without the candidate having anything to do
with it. Doing it on any scale means registering with the Campaign Finance Board first, the
same as [every other kind of political account](who-has-to-report-their-money.md).

The word doing the work is **independent**. The law defines an independent expenditure as one
“expressly advocating the election or defeat of a clearly identified candidate”, made “without
the express or implied consent, authorization, or cooperation of, and not in concert with or
at the request or suggestion of, any candidate”.

Count the ways of being involved that one sentence rules out. Consent, authorization,
cooperation, concert, request, suggestion. All 6.

The same money spent **with** the candidate’s involvement is not the same thing. The law calls
that an approved expenditure and defines it with the same list turned around: made “with the
authorization or expressed or implied consent of, or in cooperation or in concert with, or at
the request or suggestion of” the candidate.

Then the 2 definitions end 1 word apart. “An independent expenditure is **not** a contribution
to that candidate.” “An approved expenditure **is** a contribution to that candidate.” Identical
advertising, bought from the same company on the same day, is 2 different things in the
records, and what decides which is who was in the room.

## What these records show that a contribution record cannot

Minnesota publishes these in one file, headed “Itemized independent expenditures of over
$200”. Counted as the Board served it on 27 August 2026, it holds 41,130 payments going back
to 2015.

Every one of them carries something no contribution record has: a direction. **31,718 payments
are marked For, and 9,412 are marked Against.**

That is a count of payments, not a count of money. One payment in that file can be a hundred
times the size of another, so counting them and adding them up are 2 different questions, and
the amounts are in the same file for anyone who wants the second answer.

Each row also names what the money bought and who was paid. One group, 2 payments, the same
year:

- 19 March 2026, $61,687.00, marked **For**, about Dippel, Tom Senate Committee, for
  “Advertising - general: Ad Placement”, paid to Arena LLC of Salt Lake City.
- 7 July 2026, $63,940.00, marked **Against**, about Janigo, Kristy Senate Committee, same
  wording, same company.

Both were filed by Renew Minnesota, registration 41337. Neither payment went through either
campaign’s books.

Every payment in that file came from a party unit or a political committee or fund. None came
from a candidate’s own committee, which is what the word independent is there to mean.

## What they do not show

3 things, and the last is the one people assume.

- **A row names a committee, not a person.** It says which campaign account the money was
  about, and an account is not a person.
- **The direction is what the spender filed.** No record can show what 2 people said to each
  other, so “independent” on a form is a claim being made, not a thing anyone watched.
- **Nothing says it worked.** The file has the amount, the date, the purpose and the company
  paid. It does not carry the advertisement, who saw it, or what happened next.

## Lobbying is a different set of records

None of the above is about lobbying, and lobbying is not about an election.

The Board’s own handbook puts the test in one question: “Are you asking for something?” A
person paid more than $3,000 in a year to ask Minnesota government for things has to register
as a lobbyist. Whoever is paying for that is called a principal, and a principal has to report
as well.

What a principal files is one report a year, due 15 March, covering the year before. It gives
“the amount spent by the principal in the preceding calendar year on the four types of
lobbying”. A yearly total, in other words, and not a list of payments.

So you can see how much an organization reported spending. You cannot see which bill, which
official, or which day, because none of that reaches the report.

**Alethical holds these yearly totals now.** Since 31 August 2026 we keep our own dated copy
of the Board’s principal spending file, alongside the campaign-money files this set is built
from, so a principal’s yearly total is something we can show and recheck rather than only link
to. Holding it adds nothing the report leaves out.

## Next

Money that has been reported honestly can still be impossible to follow. Once a payment lands
in an account it stops being that payment and becomes part of a balance, and the next thing
paid out of that account is not traceable back to it.

[Why nobody can follow a dollar](why-nobody-can-follow-a-dollar.md) is the next piece in
this set.

---

*Where this comes from.* Independent expenditure and approved expenditure, and the sentences
saying which one counts as a contribution:
[Minnesota Statutes 10A.01](https://www.revisor.mn.gov/statutes/cite/10A.01) subdivisions 18
and 4. The 41,130 payments, the For and Against counts, and Renew Minnesota’s 2 payments: the
Board’s
[itemized independent expenditures download](https://cfb.mn.gov/reports-and-data/self-help/data-downloads/campaign-finance/),
counted as it was served on 27 August 2026, where the same page also shows that this dataset
is published for every kind of political account except candidates, and where the heading
quoted above can be read. Who has to register as a lobbyist, and what a principal is:
Minnesota Statutes 10A.01
subdivisions 21 and 33. What a principal reports and when, and the plain question at the top of
it: the Board’s
[Lobbying Handbook](https://cfb.mn.gov/pdf/publications/handbooks/lobbyist_handbook.pdf)
(issued January 2026). Minnesota’s lobbying registration records, which Alethical does not hold,
are at the Board’s
[Lobbying Organizations Search Tool](https://cfb.mn.gov/reports-and-data/viewers/lobbying/lobbying-organizations/)
and its
[Lobbyist Search Tool](https://cfb.mn.gov/reports-and-data/viewers/lobbying/lobbyists/).
