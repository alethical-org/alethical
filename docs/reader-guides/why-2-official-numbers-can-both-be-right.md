<!-- describes: apps/frontend/src/lib/researchPieces/whyTwoOfficialNumbersCanBothBeRight.ts -->
<!-- POSTED 27 Aug 2026, and live at `/read/guides/why-2-official-numbers-can-both-be-right`.
     This file is where the prose was written and settled before any container
     existed for it, exactly as the 2 guides before it were written, and it stays the source of
     record for the words. The shipped piece is
     `apps/frontend/src/lib/researchPieces/whyTwoOfficialNumbersCanBothBeRight.ts`, and
     `apps/frontend/src/lib/__tests__/research.test.ts` compares the 2 word for word,
     so an edit here without the matching edit there fails the build, and so does the
     reverse. The words are settled: rule 13's publishing order lets the Alethical team
     direct a change (point 2a) and forbids us editing them on our own initiative.

     WHAT IT IS. The third piece written in the set "How the Money Works", following
     `docs/reader-guides/who-has-to-report-their-money.md` and
     `docs/reader-guides/what-the-records-name.md`. Issue #1752's first comment fixes
     the set's reading order and titles this one "Why 2 official numbers can both be
     right", which is also the subject piece 2's closing paragraph hands off to. A
     **Guide** teaches one piece of how the system works and draws no conclusions.

     NO READER-FACING LINE NUMBERS THIS PIECE OR COUNTS THE SET, per Eugene's ruling
     of 27 Aug 2026 (`docs/architecture/published-writing-decisions.md` §2.12). The
     position line names the set and stops, and the closing paragraph names the next
     piece's subject and neither its title nor a link (§2.3).

     WHICH RULES BIND IT. `.claude/rules/grounded-answers.md` rules 1 to 12. Rule 12
     is directly about this piece's subject. NOT rule 13: adding figures up across
     members, defining derived classifications and reaching conclusions are permitted
     to signed research only.

     THE TRAP THIS PIECE WAS WRITTEN AROUND: THERE ARE 2 DISAGREEMENTS AND ONLY 1 OF
     THEM MAY BE EXPLAINED HERE.

     1. SAFE, and the whole subject of this piece. Inside a single filing, the
        payments listed by name do not add up to the total the same filing reports,
        because money from givers below the $200 line is 1 unnamed figure. Both
        numbers are printed by the same document and both are correct. Piece 2
        established the unnamed figure; this piece does the arithmetic.

     2. NOT SAFE, and it is nowhere in this piece. That Minnesota's 2 publications
        disagree with each other. [#1647](https://github.com/alethical-org/alethical/issues/1647)
        is explicit that a mid-year difference where we hold more than the filing
        itemizes must NOT be published as Minnesota contradicting itself: the 2
        figures count different populations, which is a definitional artefact rather
        than either publication being wrong. Our own money page shipped a sentence
        naming a direction that was false on 33 of the 76 disagreeing committee-years
        ([PR #1646](https://github.com/alethical-org/alethical/pull/1646)), which is
        why no sentence here names a direction at all. Every comparison in this piece
        is between 2 documents the Board itself published, never between the Board's
        records and ours.

     THE CROSS-MEMBER FIGURE THIS PIECE REFUSES TO CARRY. "37 of the 76 disagreeing
     committee-years" and "$158,606.52, 92.1% of the overstatement" are the
     measurements in `docs/architecture/campaign-finance-system-design.md` §2.3 that
     this piece's subject comes from, and both are figures added up across members,
     which is rule 13's first special permission. Printing either would change this
     piece's label, its address and the checking it needs. So the piece works 1
     committee's own filings instead, and every figure in it is read off a document
     that committee filed.

     HOW EVERY FIGURE AND EVERY QUOTE WAS ESTABLISHED. All read at the Board's own
     site or at the statutes on 27 Aug 2026, none relayed from our own records.

     1. The 3 figures on 1 filing: $381,289.00 itemized, $480,925.83 non-itemized,
        $862,214.83 total. Read off the Republican Party of Minn's own 2026
        Pre-Primary Report (registration 20008), period covered 01/01/2026 through
        07/20/2026, received by the Board July 28, 2026, in its "Schedule A1 - CR
        Contributions Received" block. "Total of itemized", "Total of non-itemized"
        and "Totals" are the form's own labels, quoted rather than paraphrased.
        $381,289.00 + $480,925.83 = $862,214.83, and the summary page states the same
        $862,214.83 on line 2, "Total Contributions Received".

     2. That report was chosen because it has NO amendments, and that was the deciding
        factor. Its catalogue entry carries `amendments: ["0"]`, so a reader who opens
        it sees the same figures this piece prints. The same committee's 2026 1st
        Quarter Report has 2 versions stating different totals ($393,400.12 original,
        $301,000.12 as amended), so none of its money figures appear here; it is used
        only for a name it does not carry, which is true in both of its versions.

     3. $793,775.83 through 31 May, from the same committee's 2026 June Report. Its
        original and its amendment state the identical $793,775.83, $374,495.00 and
        $419,280.83, so this figure does not depend on which version a reader opens.

     4. The 3 report periods, 31 March, 31 May and 20 July. Read off each document's
        own "Period Covered" line, all 3 of which begin 01/01/2026. The report names
        and cut-off dates were cross-checked against the Board's own report catalogue
        for that filer, which lists exactly 3 reports for 2026.

     5. The giver with 2 payments of $200.00, on 26 February and 23 April 2026. Both
        are printed under one name on the 2026 June Report; that name appears nowhere
        in either version of the 2026 1st Quarter Report. Since a giver past $200 for
        the year must have every one of their payments itemized (piece 2's rule), the
        June report's 2 rows are that giver's whole year to 31 May, which is what
        establishes that their total at 31 March was exactly $200.00 and so below the
        line the statute draws at *more than* $200.

     6. Minnesota Statutes 10A.20 subdivision 4, quoted as far as "seven days before
        the filing date". Fetched from revisor.mn.gov, not relayed. The sentence
        continues "except that the report due on January 31 must cover the period from
        January 1 to December 31 of the reporting year", which is the year-end case
        and does not change the quoted fragment's meaning.

     7. "Each reporting period includes all contributions received during the year,
        not just the contributions received since the last report." Checked in all 3
        handbooks, downloaded and searched on 27 Aug 2026, because the piece claims
        the wording is the same for all 3 kinds of account and 1 handbook cannot
        establish that. Present word for word in the Legislative and Constitutional
        Office Candidate Handbook, the Political Party Unit Handbook and the Political
        Committee and Political Fund Handbook. It is in the Independent Expenditure and
        Ballot Question handbook too, which the piece does not claim.

     8. "This report amends a previously filed report for the same period." The Report
        Options line on the cover of the Board's own form, read on the same
        committee's reports.

     A LIVE FINDING ABOUT PIECE 2, REPORTED RATHER THAN FIXED HERE. The Board replaced
     the Political Party Unit Handbook in place on 27 Aug 2026 (server Last-Modified
     27 Aug 2026 21:08:40 GMT; the file's own line now reads "Last Revised 8/22/2026").
     Piece 2's sources block says that handbook was "last revised 7 March 2022", and 2
     sentences piece 2 quotes from its contributions-schedule walkthrough are not in
     the version now served: the form line "Contributions from donors who each gave
     $200 or less" and the instruction "Do not list the donors separately". Piece 2's
     other 3 handbook dates still match. Rule 13's publishing order forbids editing a
     posted piece's words on our own initiative and puts the correction with Eugene
     (points 2, 2a and 7a), so nothing here changes piece 2. The general lesson for
     this set: the Board serves each handbook at 1 permanent address and swaps the
     file underneath it, so a handbook quote is only as good as the revision date
     printed beside it, and the statute is the safer home for anything load-bearing.

     THE FORWARD LINKS ARE PAID, IN BOTH DIRECTIONS. Piece 2's closing paragraph used
     to end "This paragraph gains a link to it the day that piece posts"; this piece
     posted, so that link went in and the sentence explaining its absence came out with
     it, because it becomes false the moment the link exists. This piece's own closing
     paragraph did the same for piece 4 on the same day. Neither is an edit on our own
     initiative, which rule 13 point 2 forbids: each piece's own text instructed it, and
     issue #1752's linking rule 6 plus
     `docs/architecture/published-writing-decisions.md` §2.6 both say a forward link
     goes in when its destination posts and not before. Piece 1's link to piece 2 was
     paid the same way in
     [PR #1801](https://github.com/alethical-org/alethical/pull/1801).

     WHAT WAS DELIBERATELY LEFT OUT, each for its own reason.

     1. Filer 19218's 2026 report, which `campaign-finance-system-design.md` §2.3
        offers as the clean worked case: $8,787.00 apart, $6,587.00 of it with 59
        donors under the threshold at 31 March, one of them at $194.00 whose year total
        is $304.00. Every one of those figures is a comparison between the Board's
        filing and the rows Alethical holds, which is the framing #1647 forbids
        publishing, and none of them can be read off a document the Board serves. The
        giver in this piece makes the identical point out of 2 published filings and
        nothing else.

     2. The donor's name, which is on the June report and is a public record. A private
        person's giving is not needed to explain arithmetic, and printing it would put
        a named individual into our writing for no gain to the reader. The piece gives
        the 2 dates and the 2 amounts, which is what makes it checkable.

     3. Any count of what we currently hold. `.claude/rules/grounded-answers.md` rule 12
        requires such a count to be read live rather than pasted, and a markdown draft
        cannot read anything live. The piece links the Board's register instead, exactly
        as pieces 1 and 2 do.

     4. What happens to a committee that runs in a special election, which files a whole
        second series of reports and whose year has to be assembled from both
        (`campaign-finance-system-design.md` §9.5). It is a real third way 2 official
        numbers differ, it needs more than 2 sentences, and no piece in the set owns it.
        A candidate for a later piece, not a digression here.

     WHAT THIS PIECE OWNS, so the rest of the set links here rather than re-explaining:
     the reporting period and the period-covered line - that every report restates the
     year from 1 January, so a year's reports must never be added together - the
     itemized and non-itemized pair as the filing's own 2 figures - why a giver can be
     unnamed on one report and named on the next - amendment, named as a check to make
     and not explained further.

     WHERE IT LINKS BACK: 1 link to piece 2, for the $200 rule and the money it leaves
     unnamed, and 1 link to piece 1, for what a party unit is. Both are first uses and
     sit in different paragraphs, per issue #1752's linking rules. They stay relative
     links between the drafts HERE, because `scripts/check_doc_references.py` requires a
     relative link inside `docs/` to resolve to a real file. The shipped piece points
     them at the reader-facing addresses, `/read/guides/what-the-records-name` and
     `/read/guides/who-has-to-report-their-money`.

     WHERE IT LINKS FORWARD: 1 link to piece 4, in the closing paragraph, added the day
     that piece posted. The shipped piece holds the address as a literal rather than
     computing it from piece 4's slug: piece 4 would otherwise be imported here while
     importing this file back, which is a module-scope cycle. A test in
     `research.test.ts` asserts the literal equals piece 4's real path.

     NAMED BUT DELIBERATELY NOT EXPLAINED: a group paying for its own advertising about
     a race, which the next piece in the set owns and which this piece's closing
     paragraph exists to set up. Also amendments, which are named as a thing to check
     and are owned by nobody in the set.
-->

# Why 2 official numbers can both be right

*How the Money Works*

Ask a Minnesota campaign account how much money it has taken in this year, and its own
filings hand you several different answers. None of them is a mistake.

A filing answers a narrower question than the one most people are asking. Once you can see
which narrower question a number belongs to, the numbers stop fighting each other.

## Every filing carries 2 totals for the same money

An account has to name a giver only once that person passes $200 for the calendar year, and
everything under that line is reported as a single figure with no names behind it. That is
[the rule, and what it leaves out](what-the-records-name.md).

So every filing ends up with 2 figures for the money that came in: the payments it lists by
name, and all of it.

The Republican Party of Minn is Minnesota’s state Republican party, registered with the Board
as a [party unit](who-has-to-report-their-money.md). Its 2026 report covering 1 January to
20 July prints both figures in the same block, in the form’s own words:

- Total of itemized: $381,289.00
- Total of non-itemized: $480,925.83
- Totals: $862,214.83

“How much had this account raised by 20 July?” is $862,214.83. “How much of that came from
people the records name?” is $381,289.00. Both are correct, and more than half of the money
has nobody’s name on it.

## A later report is not more money

An account that reports more than once a year ends up with several filings covering that same
year. Adding them together is the natural thing to do, and it is wrong.

The law is short about it. A report “must cover the period from January 1 of the reporting
year to seven days before the filing date”.

The Board says the same thing to the people who keep the books, in the handbooks for all 3
kinds of account: “Each reporting period includes all contributions received during the year,
not just the contributions received since the last report.”

So a year’s reports are not consecutive slices of it. Each one is the whole year so far,
drawn again, ending later than the last.

That party unit’s first 3 reports for 2026 all start on 1 January. They stop on 31 March,
31 May and 20 July.

Through 31 May it reported $793,775.83 of contributions. Through 20 July, $862,214.83. Two
official numbers, one account, one year, both right. The second one contains the first. Add
them together and you have counted most of the money twice.

## The line is drawn on the year, and a report stops in the middle of one

The $200 test runs on a giver’s total for the whole calendar year. A report that closes on
31 March can only apply that test to the money that has arrived by 31 March.

So the same person can be unnamed on one report and named on the next, without anything about
their money having changed.

It happens on the reports above. One giver sent that party unit $200.00 on 26 February. On the
report closing 31 March, their total for the year stood at exactly $200.00, and a name is
required only once a giver goes past $200. So no name was required, and the money sat inside
the figure with no names behind it.

The same person sent another $200.00 on 23 April. On the report closing 31 May, they are
listed by name, and both payments are printed under it, February’s included.

February’s $200.00 did not move and did not change. What changed is the question the later
report had to answer.

## What to check before you trust a figure

Three things, and the filing prints all 3 itself.

- **The dates.** Every report says at the top what period it covers. A money figure without
  its dates is not finished.
- **Which of the 2 numbers it is.** The payments with names on them, or all of the money.
- **Which version.** A report can be filed again with corrections, and the newest version is
  the one that counts. The cover of an amended one says so: “This report amends a previously
  filed report for the same period.”

Check those 3 and the contradiction goes away. What is left is 2 answers to 2 different
questions.

## Next

Every figure above is money that arrived in a registered account and was reported by that
account. Some political money never goes near one. A group can pay for its own advertising
about a race without the campaign being involved, and none of that money passes through the
campaign’s books.

[Money spent without a campaign’s say](money-spent-without-a-campaigns-say.md) is the next
piece in this set.

---

*Where this comes from.* The 2 figures on a filing, the 3 reports and the dates they cover,
and the giver’s 2 payments: the Republican Party of Minn’s own 2026 reports to Minnesota’s
Campaign Finance Board, filed under registration number 20008 and read at the Board on
27 August 2026. They are its 1st Quarter Report covering 1 January to 31 March, its June
Report covering 1 January to 31 May, and its Pre-Primary Report covering 1 January to 20 July.
Every registered account’s filed reports are reachable from the Board’s own register, in this
case its register of
[party units](https://cfb.mn.gov/reports-and-data/viewers/campaign-finance/party-unit/). That
every report starts on 1 January, and the words quoted for it:
[Minnesota Statutes 10A.20](https://www.revisor.mn.gov/statutes/cite/10A.20) subdivision 4.
The same rule in the Board’s own words to whoever keeps an account’s books, in the same words
in all 3: its
[Legislative and Constitutional Office Candidate Handbook](https://cfb.mn.gov/pdf/publications/handbooks/candidate_handbook.pdf)
(last revised 30 April 2026), its
[Political Party Unit Handbook](https://cfb.mn.gov/pdf/publications/handbooks/PTU_handbook.pdf)
(last revised 22 August 2026) and its
[Political Committee and Political Fund Handbook](https://cfb.mn.gov/pdf/publications/handbooks/PCF_handbook.pdf)
(last revised 15 June 2026). The $200 naming rule, and that the law draws it at more than
$200: Minnesota Statutes 10A.20 subdivision 3, paragraphs (c) and (p).
