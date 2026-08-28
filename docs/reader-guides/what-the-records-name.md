<!-- describes: apps/frontend/src/lib/researchPieces/whatTheRecordsName.ts -->
<!-- POSTED 27 Aug 2026, and live at `/read/guides/what-the-records-name`.
     This file is where the prose was written and settled before any container existed
     for it, and it stays the source of record for the words. The shipped piece is
     `apps/frontend/src/lib/researchPieces/whatTheRecordsName.ts`, and
     `apps/frontend/src/lib/__tests__/research.test.ts` compares the 2 word for word, so
     an edit here without the matching edit there fails the build, and so does the
     reverse. The words are settled: rule 13's publishing order lets the Alethical team
     direct a change (point 2a) and forbids us editing them on our own initiative.

     Its address follows `docs/architecture/published-writing-decisions.md` §2.1 (the
     address carries the trait), which is deliberately not copied here: the reading
     section's own prefix moves independently, so §2.1 is the one place that should
     carry it.

     WHAT IT IS. The second piece written in the set "How the Money Works", following
     `docs/reader-guides/who-has-to-report-their-money.md`. Issue #1752's first comment
     fixes the set's reading order and titles this one "What the records name, and what
     they leave out", which is also the phrase piece 1's closing paragraph uses to hand
     off to it. A **Guide** teaches one piece of how the system works and draws no
     conclusions.

     NO READER-FACING LINE NUMBERS THIS PIECE OR COUNTS THE SET, per Eugene's ruling of
     27 Aug 2026 (`docs/architecture/published-writing-decisions.md` §2.12): a piece's
     position in its set is internal talk. The position line names the set and stops,
     and the closing paragraph names no title for the next piece
     (`docs/architecture/published-writing-decisions.md` §2.3).

     WHICH RULES BIND IT. `.claude/rules/grounded-answers.md` rules 1 to 12. Rule 12 is
     directly about this piece's subject and its 2 traps are handled below. NOT rule 13:
     adding figures up across members, defining derived classifications and reaching
     conclusions are permitted to signed research only.

     THE CROSS-MEMBER FIGURE THIS PIECE REFUSES TO CARRY.
     `docs/architecture/published-writing-decisions.md` §2.8 measured that a planned
     piece on the unnamed lump would carry the research trait, because its outline
     states the unnamed money "was 36.5% of the money in 2024 and 41.3% in 2025 across
     sitting legislators' accounts". A share across sitting legislators' accounts is
     rule 13's first special permission, and printing one here would change this piece's
     label, its address and the checking it needs. So every figure in this piece is a
     count of rows in the Board's published download, which is a fact about the
     download, and none is an aggregate about a group of named people. The unnamed
     lump's share of anything is left to a signed research piece.

     HOW EVERY FIGURE WAS ESTABLISHED.

     1. The $200 test, and that it reads on the year's total rather than on one gift.
        Read at the statute, not relayed: `https://www.revisor.mn.gov/statutes/cite/10A.20`
        fetched 27 Aug 2026. Subdivision 3 paragraph (c) requires disclosure of each
        contributor whose contributions "in aggregate within the year exceed $200 for
        legislative or statewide candidates", and the same paragraph carries the running
        total forward: "When a contribution received from a contributor in a reporting
        period is added to previously reported unitemized contributions from the same
        contributor and the aggregate exceeds the disclosure threshold of this paragraph,
        the name, address, and employer, or occupation if self-employed, of the
        contributor must then be listed on the report." Subdivision 2 shows "the year"
        is the calendar year: each report covers "the calendar year through" its own
        cut-off date. Paragraph (p) supplies the lump: "Contributions that are less than
        the itemization amount must be reported as an aggregate total."

     2. That the boundary is *exceed*, so a giver at exactly $200 for the year is not
        named. Same source, same words. The prose therefore says "$200 or less" and
        "more than $200" throughout and never "under $200"; that wording rule is
        `docs/architecture/campaign-finance-system-design.md` §2.3, written because the
        wrong version reached a real design prompt on 11 Aug 2026.

     3. The "itemize them all" and lump-sum instructions, in the Board's own words.
        Read in all 3 handbooks, downloaded and searched 27 Aug 2026, because the piece
        claims the wording is the same for all 3 kinds of account and 1 handbook cannot
        establish that: the Legislative and Constitutional Office Candidate Handbook
        (last revised 30 Apr 2026), the Political Party Unit Handbook (last revised
        7 Mar 2022) and the Political Committee and Political Fund Handbook (last
        revised 15 Jun 2026). All 3 carry the identical sentences, differing only in
        whose report is named: "If one donor has given multiple contributions that total
        more than $200, you must itemize them all, listing each contribution separately
        on the report under the donor's name. Contributions from donors who have given
        $200 or less, in total, should be added together and listed as a lump sum".

     4. The form line and the instruction under it. The Political Party Unit Handbook's
        schedule walkthrough names the line "Contributions from donors who each gave
        $200 or less - Cash and in-kind total:" and instructs "Do not list the donors
        separately." Quoted from that handbook rather than from a form image.

     5. The 2 row counts, and the third that explains them. Measured read-only against
        production on 27 Aug 2026, on release 3f2bdf90-a4e3-4cf2-b8f1-6024167da680, the
        Board's itemized contributions download as Alethical loaded it on 12 August 2026
        (the same release piece 1 pinned, and still the only published release). Its
        contributions snapshot is 8dc821e4-16d5-48d2-b90f-561cb1397883, whose stored
        `row_count` is 583,152 and whose retained file name from the Board is "All -
        Itemized Contributions Received Of Over $200 - Campaign Finance.csv".
        - 583,152 rows in total, 0 with a blank amount.
        - 337,888 of $200 or less. 245,264 of more than $200. 10,129 at exactly $200.00,
          which is why the 2 figures do not sum to the total.
        - 334,234 of the 337,888 sit in a (recipient, contributor, year) group whose
          amounts sum to more than $200. That is the "itemize them all" rule, and it
          leaves 3,654 rows, 1.1%, that it does not explain. Those are not investigated
          here and no sentence in the piece depends on them; the likely causes are name
          spellings that do not group, part-year reports, and filers itemizing more than
          the law requires.
        - 14 rows are for 1 cent. The prose says that rather than naming a smallest
          amount, because the smallest value in the file is a single -$350 row and a
          superlative would have been wrong.

     6. The Board's visible heading for the download, "Itemized contributions received
        of over $200", read on its campaign finance data downloads page on 27 Aug 2026.
        The irony the piece rests on is checkable from that heading alone.

     FOUR WORDING DECISIONS, each taken because the obvious phrasing would have been
     wrong.

     1. The prose says "named payments", never "contributions", of the whole file.
        1.2% of the 583,152 rows carry a receipt type other than `Contribution` (6,639
        `Miscellaneous`, 156 `Miscellaneous Income`, 14 `Loan Payable`), which the filing
        reports on separate schedules, and all 3 counts above are over the whole file
        rather than over the `Contribution` subset. Every row in it is money an account
        received and had to name, so "named payment" is true of all 583,152 while
        "contribution" is true of 576,343.

     2. The statute quote stops at "in aggregate within the year", and the $200 is stated
        in our own words rather than quoted. The statute's own figure clause reads "exceed
        $200 for legislative or statewide candidates or more than $500 for ballot
        questions", so quoting it as far as "$200" would have truncated away the scope
        the words carry. The quoted fragment's meaning is unchanged by where it stops. The
        $200 as the line for all 3 kinds of account comes from the 3 handbooks, which is
        why the piece attributes it to them.

     3. The piece never prints the sentence rule 12 forbids, not even in order to forbid
        it. An earlier draft read "one sentence must never be said about these records:
        that gifts of $200 or less are never named", which puts the false sentence on a
        reader-facing page where a skimmer or a search-engine snippet could lift it out of
        its denial. The shipped wording names the temptation, denies it, and proves it.

     4. The piece does not say what the treasurer's private record contains. The Board's
        recording tiers are 3, not 1: nothing at all need be recorded for an in-kind gift
        of $20 or less, name and address for a gift over $20 up to $200, and the donor's
        employer or occupation only above $200. So a sentence claiming the treasurer holds
        "those details" for the money in the lump would have been false at both ends.

     WHAT WAS DELIBERATELY LEFT OUT, each for its own reason.

     1. Any count of what we currently hold, live. `.claude/rules/grounded-answers.md`
        rule 12 requires such a count to be read live rather than pasted, and a markdown
        draft cannot read anything. The piece links the Board's own register of
        committees and funds instead, exactly as piece 1 does with its 3 registers.

     2. The $500 figure the statute attaches to ballot-question money. Rule 12 forbids
        printing it, so the piece names only that a different figure applies and links
        both sources. **The ground rule 12 gives for that ban does not survive a read of
        the Board's own handbook for those filers, and this is the most valuable thing
        this piece turned up.** Rule 12 and issue #1661 §5 record a disagreement between
        2 sources: the statute says $500 for ballot questions, while the Political
        Committee and Political Fund Handbook, "which by its contents page covers
        ballot-question committees and funds", states $200 with no carve-out. The Board
        publishes a fourth handbook that neither record mentions: the **Independent
        Expenditure and Ballot Question Political Committee and Fund Handbook** (last
        revised 11 Jul 2023), which is its handbook for exactly those filers and states
        $500 for them repeatedly, including a worked example. On that reading the 2
        sources agree and there is no disagreement to resolve. Reported to Eugene and
        commented on issue #1661; rule 12's clause is his to change, not this piece's,
        so the piece prints no figure either way.

     3. The 5 contributor lines on a candidate's own report. Issue #1752's first comment
        folds that topic into this piece. It is not here, on 3 grounds: this piece's
        title and piece 1's hand-off sentence are both about naming rather than about
        classification; establishing how those 5 lines treat the unnamed lump needs a
        filing's financial tab read at the Board, which was not done; and the download's
        own contributor-type column carries 10 values (Individual, Political
        Committee/Fund, Lobbyist, Other, Party Unit, Candidate Committee, Self, blank,
        Unknown/Null, "Registered with Hennepin County"), so it is not the same 5 and a
        sentence equating them would have been wrong. Needs a home: either its own piece
        or a section added here once the financial tab is read.

     4. WITHDRAWN, and the prose above is corrected. This item argued that no account may
        name a smaller giver voluntarily, on the ground that the statute says sub-threshold
        contributions "must be reported as an aggregate total", that all 3 handbooks say
        they "should be added together and listed as a lump sum", and that searching all 4
        handbooks for voluntary or optional itemization returns nothing. Every one of those
        readings is accurate and the conclusion does not follow: the absence of a stated
        permission is not a prohibition, and we have measured the practice happening.

        `docs/architecture/campaign-finance-system-design.md` §2.3 records the measurement:
        "whether a committee names a sub-threshold donor anyway is the committee's own
        choice. The statute sets a floor on who *must* be named and permits naming more."
        Filer 18135's 2026 pre-general itemizes 215 donors at or under $200 in the period,
        $10,136.05 of them, and reconciles to the cent WITHOUT excluding them; filer 18336's
        2026 pre-primary over-corrects by $9,713.50 WITH the exclusion.

        One caveat on those 215, because it is easy to overstate them and an earlier draft of
        this correction did: they are at or under $200 FOR THE PERIOD, and a giver at $150 in
        one period can be at $400 for the year and so required to be named. So the 215 prove
        that committees itemize below the period threshold; they do not each prove a naming
        nobody required. That is why the reader-facing sentence above rests on the statutory
        floor rather than on a figure.

        This piece's own count carries the same evidence and it went unread here. Of the
        337,888 named payments of $200 or less, 334,234 come from a giver whose year total
        to that account exceeds $200. The remaining 3,654 are named payments from givers
        whose total does not, which is naming that nothing required.

        So piece 1's "lets it name smaller donors too" is correct and stays, and
        [issue #1755](https://github.com/alethical-org/alethical/issues/1755) is the live
        record: 4 shipped pages carry the false absolute "are never named" and are queued
        for the same correction this file just took.

     WHAT THIS PIECE OWNS, so the rest of the set links here rather than re-explaining:
     the $200 naming rule (the year's total, not the gift) - the exceed boundary at
     exactly $200 - the lump sum with no donor named - "itemize them all".

     WHERE IT LINKS BACK: 2 links to piece 1, for the 3 kinds of registered account and
     for a political committee or fund. Both are first uses and sit in different
     paragraphs, per issue #1752's linking rules. They stay relative links between the
     drafts HERE, because `scripts/check_doc_references.py` requires a relative link
     inside `docs/` to resolve to a real file. The shipped piece points them at piece 1's
     reader-facing address, `/read/guides/who-has-to-report-their-money`, which is the
     swap this line used to ask the builder for; a test pins both to that address.

     WHERE IT LINKS FORWARD: 1 link to piece 3, in the closing paragraph. This paragraph
     used to end "This paragraph gains a link to it the day that piece posts". Piece 3
     posted at /read/guides/why-2-official-numbers-can-both-be-right, so the link went in
     and the sentence explaining its absence came out with it, because that sentence
     becomes false the moment the link exists. That is not an edit on our own initiative,
     which rule 13 point 2 forbids: the piece's own text instructed it, and issue #1752's
     linking rule 6 plus published-writing-decisions.md §2.6 both say a forward link goes
     in when its destination posts and not before.

     NAMED BUT DELIBERATELY NOT EXPLAINED: reporting periods and why 2 official figures
     disagree, which the next piece in the set owns and which this piece's closing
     paragraph exists to set up. Also the anonymous-collection-jar rule and the
     large-contribution notice, both found in the handbooks while checking the figures
     above, both owned by nobody, and both a digression here rather than a paragraph.
-->

# What the records name, and what they leave out

*How the Money Works*

Look up a Minnesota campaign account and you get a list of names. The list is real. It is
not everyone who gave.

A single number decides who lands on it. This piece is about that number, and about
the money that sits on the other side of it.

## The line is a year, not a gift

The rule sits in the law that says what a filing has to disclose. An account has to name a
giver once that person’s contributions, “in aggregate within the year”, pass $200.

Read that twice. It is a test on one giver’s total for the calendar year. It is not a test
on the size of any single payment.

Minnesota’s Campaign Finance Board publishes a handbook for whoever keeps an account’s
books, and it says what the test means in practice. If one donor’s gifts add up to more
than $200, “you must itemize them all, listing each contribution separately on the report
under the donor’s name.” The handbooks for
[all 3 kinds of account](who-has-to-report-their-money.md) carry that sentence word for
word.

So a $25 gift can carry a name. Not because $25 is a lot. Because the person who gave it
reached $200 with that account by the end of the year.

The law says the total has to exceed $200. So a giver whose total for the year is exactly
$200 does not have to be named.

## More than half the named payments are small

You can watch the rule work in the Board’s own file.

Every named payment is published as one download, under a heading reading “Itemized
contributions received of over $200”. Counting that file as Alethical loaded it on
12 August 2026, it holds 583,152 named payments. Of those, 337,888 are $200 or less, and
14 are for 1 cent.

Almost all of those small payments, 334,234 of the 337,888, come from a giver whose
payments to that same account in that same year add up to more than $200. That is the
itemize-them-all instruction, 334,234 times over.

It is tempting to read the $200 as a rule about small gifts. It is not. More than half of
every named payment Minnesota publishes is a gift of $200 or less.

## What the line leaves out

Now the other side of it.

Somebody who gives $50 once and never gives again never reaches $200. The money is still
reported. The name does not have to be.

Some accounts name them anyway. The $200 is a floor on who a committee **must** name, not
a ceiling on who it may. So a reader who finds a $50 giver named in a filing is not looking
at a mistake.

The handbooks are plain about where it goes. Gifts from donors who gave $200 or less in
total “should be added together and listed as a lump sum”.

So a filing can carry a figure with no names behind it. It is real money, correctly
reported, and nobody was required to name it. It is not a mistake, and it is not something
Alethical failed to collect.

That leaves one thing worth carrying around. Add up the payments in a list of names and
you have not added up the money. You have added up the named part of it.

## What one line cannot tell you

The lump sum gives up more than names.

A named payment says who, how much, and when. Money below the line arrives as a single
total. Nobody outside the campaign can split it by how many people gave, or where they
live, or what they do for work, because none of that reaches the filing. The account keeps
its own private record, and the public file never gets it.

So “how many people gave to this campaign?” is a question these records cannot answer. Not
because the answer is hidden. Because it was never written down anywhere a member of the
public can read.

## One kind of account this does not cover

Minnesota also registers [committees and funds](who-has-to-report-their-money.md) set up
to campaign on a ballot question, which is a vote on a proposal rather than on a person. A
different figure applies to money given to those, so nothing above describes them. The law
and the Board’s own handbook for those accounts are both linked below.

## Next

The lump sum with no names is why 2 official figures about the same account can both be
right. Add up the payments a filing lists, compare that against the total the same filing
reports, and the 2 numbers will not match. Neither one is wrong.

[Why 2 official numbers can both be right](why-2-official-numbers-can-both-be-right.md) is
the next piece in this set.

---

*Where this comes from.* The $200 test, the calendar year, the word exceed, and the lump
sum: [Minnesota Statutes 10A.20](https://www.revisor.mn.gov/statutes/cite/10A.20)
subdivision 3, paragraphs (c) and (p), with the reporting periods in subdivision 2. What
the test means for whoever keeps the books, in the same words in all 3: the Board’s
[Legislative and Constitutional Office Candidate Handbook](https://cfb.mn.gov/pdf/publications/handbooks/candidate_handbook.pdf)
(last revised 30 April 2026), its
[Political Party Unit Handbook](https://cfb.mn.gov/pdf/publications/handbooks/PTU_handbook.pdf)
(last revised 7 March 2022) and its
[Political Committee and Political Fund Handbook](https://cfb.mn.gov/pdf/publications/handbooks/PCF_handbook.pdf)
(last revised 15 June 2026). The reporting form’s own line for the lump sum, and the
instruction not to list its donors: the Political Party Unit Handbook, in its walkthrough
of a contributions schedule. The heading on the download, and the file itself: the Board’s
[campaign finance data downloads](https://cfb.mn.gov/reports-and-data/self-help/data-downloads/campaign-finance/)
page. The counts of payments in it, as Alethical loaded that file on 12 August 2026.
Ballot question committees and funds: Minnesota Statutes 10A.20 subdivision 3 again, and
the Board’s
[Independent Expenditure and Ballot Question Political Committee and Fund Handbook](https://cfb.mn.gov/pdf/publications/handbooks/IE_BQ_handbook.pdf)
(last revised 11 July 2023); who is registered as one today is on the Board’s register of
[committees and funds](https://cfb.mn.gov/reports-and-data/viewers/campaign-finance/committee-fund/).
