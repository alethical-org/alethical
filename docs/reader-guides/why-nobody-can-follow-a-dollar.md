<!-- describes: apps/frontend/src/lib/researchPieces/whyNobodyCanFollowADollar.ts -->
<!-- POSTED 27 Aug 2026, and live at `/read/guides/why-nobody-can-follow-a-dollar`.
     This file is where the prose was written and settled before any container
     existed for it, exactly as the 4 guides before it were written, and it stays the source of
     record for the words. The shipped piece is
     `apps/frontend/src/lib/researchPieces/whyNobodyCanFollowADollar.ts`, and
     `apps/frontend/src/lib/__tests__/research.test.ts` compares the 2 word for word,
     so an edit here without the matching edit there fails the build, and so does the
     reverse. The words are settled: rule 13's publishing order lets the Alethical team
     direct a change (point 2a) and forbids us editing them on our own initiative.

     WHAT IT IS. The fifth piece written in the set "How the Money Works", following
     `docs/reader-guides/money-spent-without-a-campaigns-say.md`. Issue #1752's first
     comment fixes the set's reading order and titles this one "Why nobody can follow a
     dollar", folding transfers between committees, why money is fungible once it lands,
     and what a picture of the flows can and cannot mean. A **Guide** teaches one piece
     of how the system works and draws no conclusions.

     NO READER-FACING LINE NUMBERS THIS PIECE OR COUNTS THE SET, per Eugene's ruling
     of 27 Aug 2026 (`docs/architecture/published-writing-decisions.md` §2.12).

     IT CARRIES NO "NEXT" SECTION, AND THAT IS DELIBERATE. The 4 pieces before it each
     close by naming the next piece's subject, because a next piece was planned and
     being written. This is the last of the 5 that issue #1752's first comment fixed,
     and nothing commits anyone to a sixth: [issue
     #1771](https://github.com/alethical-org/alethical/issues/1771) records that the set
     had no owner and no dates, and §2.3 forbids naming a piece a reader cannot open.
     `.claude/rules/grounded-answers.md` rule 2 is the same rule pointed at our writing
     schedule. So the piece ends on what the records will and will not support, and the
     day a sixth piece is committed to, this closing paragraph is where its hand-off
     sentence goes.

     WHICH RULES BIND IT. `.claude/rules/grounded-answers.md` rules 1 to 12. **Rule 12's
     "Separate transfers, never a chain" is this piece's entire subject**, restated for a
     reader instead of for a builder: that a party gave a caucus money and the caucus
     later gave a candidate money are 2 documented facts, and that the same dollars
     travelled between them is not a fact and no filing establishes it. Rule 3 is the
     other live one, because the piece names real accounts on both sides of a transfer:
     it says what each filing states and never what anyone intended. NOT rule 13.

     THE CROSS-MEMBER FIGURE THIS PIECE REFUSES TO CARRY. Nothing here sums money
     across accounts. Every dollar figure in the piece is 1 line of 1 filing or 1
     payment, and the only counts are counts of distinct names in a published download.
     The live research piece *The Money Only Goes One Way* is the surface that adds this
     kind of money up, under rule 13, and this guide deliberately reaches none of its
     conclusions and repeats none of its totals.

     HOW EVERY FIGURE WAS ESTABLISHED. All read at the Board's own site on 27 Aug 2026,
     none relayed from our own records.

     1. $1,226,555.63, the DFL House Caucus's cash balance on 1 January 2024, and
        $9,457.38, its contributions to candidate committees for that year. Both read
        off its own 2024 Year-End Report (registration 20006, period covered 01/01/2024
        through 12/31/2024), line 1 and line 7C. **That report has 5 versions and BOTH
        figures are identical in all 5**, checked one by one at amendment indexes 0
        through 4, which is why they are safe to print where its contributions-received
        line is not: that line reads $9,852,936.55 on the original and $9,852,277.08 on
        the newest, so it never appears in the piece.

     2. $704,630.59, the HRCC's cash balance on 1 January 2024. Its own 2024 Year-End
        Report (registration 20010), also 5 versions, also identical in all 5.

     3. $875,000.00 from The PAC for Minnesota's Future to the DFL House Caucus on
        20 September 2024, and $3,000.00 from the DFL House Caucus to Wolgamott, Dan
        House Committee on 30 October 2024. Both read row by row out of the Board's
        "Itemized general expenditures and contributions made of over $200 - All"
        download, resolved from its campaign finance data downloads page and served on
        27 Aug 2026. Both are cash rather than in-kind.

     4. That the $9,457.38 line is made of exactly 3 payments. The same download holds
        3 cash contributions from that caucus to candidate committees in 2024,
        $3,957.38, $3,000.00 and $2,500.00, which sum to $9,457.38 to the cent against
        the filing's own line. **That reconciliation is why the piece can say the 1 line
        and the 1 payment are the same money seen 2 ways** without comparing our records
        to the Board's, which [#1647](https://github.com/alethical-org/alethical/issues/1647)
        forbids: both figures here are the Board's.

     5. 699 and 551 distinct names, the contributors the Board's itemized contributions
        download lists for those 2 accounts in 2024. Counted from the live file served
        27 Aug 2026, which holds 583,218 rows against the 583,152 in the release
        Alethical loaded on 12 Aug 2026, so the Board has added 66 rows since. The piece
        says **names** rather than donors on purpose: the count is of distinct strings in
        a column, and 2 spellings of 1 donor count twice, a caveat
        `docs/reader-guides/what-the-records-name.md` already records for its own counts.

     WHY THE $9,852,277.08 AND THE 699 ARE NEVER PUT SIDE BY SIDE. The named payments in
     the download for that caucus-year sum to more than the filing's
     contributions-received line, which is the pre-amendment artefact
     `docs/architecture/campaign-finance-system-design.md` §2.1 documents. Printing both
     would read as the Board's 2 publications contradicting each other, which #1647
     forbids and which
     `docs/reader-guides/why-2-official-numbers-can-both-be-right.md` was written to
     avoid. So the count of names is used only as a count of names, never as a total.

     ONE THING CHECKED AND SET ASIDE, because it looked like a contradiction and was not.
     The HRCC's 2024 filing reads $0.00 on its contributions-to-candidate line while the
     Board's download carries a $6,000.00 payment from it to a candidate committee dated
     24 July 2024. That payment's "In-kind?" column reads Yes, so it belongs on a
     different line and the 2 records agree. In-kind giving is owned by nobody in the
     set and is a digression here, so the piece uses the other caucus for the worked
     payment and says nothing about it.

     WHAT WAS DELIBERATELY LEFT OUT, each for its own reason.

     1. Any total across accounts, per the classification above.
     2. The words a reader could lift as a label for the pattern. `.claude/rules/grounded-answers.md`
        rule 12 forbids a label that asserts what the flows mean, and
        `docs/reader-guides/what-the-records-name.md`'s fourth wording decision
        established that a catchy false phrase must not be printed even inside its own
        denial, because a skimmer or a search-engine snippet lifts it out. So the piece
        describes the kind of label it will not use and prints none.
     3. The names of the other 2 candidate committees in the $9,457.38 line. One worked
        payment makes the point and the filing's own line covers the rest, so naming 3
        people's committees to illustrate arithmetic is weight the piece does not need.
     3a. A second worked transfer pair from the other side. Both named transfers are
        DFL-side, which is a consequence of picking the caucus-year whose candidate
        payments reconcile exactly against the filing's own line: the HRCC's 2024 cash
        contributions to candidate committees are $0.00, so it has no equivalent pair.
        Balance is carried instead by the 2 opening balances, by the sentence saying the
        answer is the same for any 2 accounts on any side, and by the closing sentence
        that every account works this way for everyone. Worth revisiting if a later
        piece needs a paired example.
     4. Any count of what we currently hold. `.claude/rules/grounded-answers.md` rule 12
        requires such a count to be read live rather than pasted.

     WHAT THIS PIECE OWNS, so the rest of the set links here rather than re-explaining:
     a transfer between committees - fungible money and the account balance - why 2
     filed payments in a row are not a route - what a diagram of the flows may and may
     not imply.

     WHERE IT LINKS BACK: 1 link to piece 1, for what a caucus is, and 1 link to piece
     3, for a report restating the year from 1 January. Both are first uses and sit in
     different paragraphs, per issue #1752's linking rules. They stay relative links
     between the drafts HERE, because `scripts/check_doc_references.py` requires a
     relative link inside `docs/` to resolve to a real file. The shipped piece points
     them at the reader-facing addresses,
     `/read/guides/who-has-to-report-their-money` and
     `/read/guides/why-2-official-numbers-can-both-be-right`.

     WHERE IT LINKS FORWARD: nowhere, per the paragraph above. A test asserts the
     shipped piece carries no section headed "Next" and never says "the next piece in
     this set", so a hand-off cannot be added without a sixth piece to point at.
-->

# Why nobody can follow a dollar

*How the Money Works*

Minnesota’s records tell you what one political account paid another, on which day, down to
the cent. They cannot tell you where any particular dollar ended up.

That is not a gap somebody forgot to fill. It is what happens to money when it goes into a
bank account, and no filing rule could undo it.

Nobody is hiding it, either. The payments in this piece were all disclosed, on time and in
full. What is missing is the link between them, and that was never recorded because there
was never a moment at which anyone could have recorded it.

## Two filings in a row are not a route

Political accounts give to each other constantly. A fund gives to a
[caucus](who-has-to-report-their-money.md), a caucus gives to a party, a party gives to a
candidate. Every one of those payments is filed, dated and public.

Here are 2 of them, both real, both from the same year:

- 20 September 2024. The PAC for Minnesota’s Future gave $875,000.00 to the DFL House
  Caucus.
- 30 October 2024. The DFL House Caucus gave $3,000.00 to Wolgamott, Dan House Committee.

Read together they look like a route: money arrives, money leaves, so the first paid for the
second. That reading is not in either record, and no record anywhere supports it. Pick any 2
accounts on any side and the answer is the same.

## The reason is a bank account

Money is fungible. Once a payment clears, it stops being that payment. It is a balance, and
a balance has no labels on it.

The caucus in that example began 2024 with **$1,226,555.63 already in the account**, raised
in earlier years. So the $3,000.00 that went out in October could have come from September’s
$875,000.00, or from money raised in 2023, or from any of the rest. Every one of those is
possible and none of them is recorded, because there is no field in any filing that ties an
incoming payment to an outgoing one.

The other House caucus is in the same position and always was. The HRCC began 2024 with
$704,630.59 of its own.

Nor is this a matter of the account being crowded. In 2024 the Board’s published file lists
699 different names giving to the DFL House Caucus and 551 giving to the HRCC. Even if a
committee took in exactly one payment and paid out exactly one, the record still would not
say the second was made of the first. Fewer sources would make guessing easier, not the
record fuller.

## What a filing does say about its own payments

Plenty, and it is worth knowing how much.

That same caucus’s 2024 report, which
[covers the year from 1 January](why-2-official-numbers-can-both-be-right.md), puts every cash
payment it made to a candidate’s committee on one line: $9,457.38 for the whole year.
The Board’s published file lists the payments behind that line, and they add to $9,457.38 to
the cent. The $3,000.00 above is one of them.

So the record is exact about what left the account and where it went. It is silent, and
permanently silent, about which money that was.

## What a picture of the flows can and cannot mean

Draw every filed transfer as an arrow and you get something true and useful: who paid whom,
how much, and when. Each arrow is a filed payment standing on its own, and each one is worth
drawing, because seeing which accounts deal with which others is real information.

Two things that picture must not be allowed to say.

- **That an arrow continues.** Money entering an account is not the money leaving it. Two
  arrows meeting at the same box are 2 separate facts, not one longer arrow.
- **That the shape has a meaning.** A short phrase naming what the pattern proves is doing
  something no record does. The arrows are filings. The meaning would be ours, and we would
  be putting our word in the reader’s mouth on the strength of a diagram.

## What the records will and will not support

Sort any sentence about political money into one of 2 piles.

In the record: this account gave that account this amount on this date. Its own report says
so, and its own report is where you can check it.

Not in the record, and not obtainable: whose money paid for what. That one is not waiting on
better disclosure or a longer file. It stopped existing the moment the money hit an account,
and every account works that way, everywhere, for everyone.

The sentence most people want to write is some version of *this money paid for that*. It is
the one sentence these records cannot carry, and the moment to notice that is before writing
it rather than after.

Knowing which pile a sentence belongs in is most of what these records are good for.

---

*Where this comes from.* The 1 January 2024 cash balances, and the year’s contributions to
candidate committees: the DFL House Caucus’s and the HRCC’s own 2024 year-end reports to
Minnesota’s Campaign Finance Board, registration numbers 20006 and 20010, read on 27 August
2026. Both accounts, and the reports every registered account files, are on the Board’s
register of
[party units](https://cfb.mn.gov/reports-and-data/viewers/campaign-finance/party-unit/). The
2 transfers, the payments behind the $9,457.38, and the counts of names: the Board’s
[itemized downloads of contributions received and of expenditures and contributions made](https://cfb.mn.gov/reports-and-data/self-help/data-downloads/campaign-finance/),
counted as they were served on 27 August 2026. Every figure here that comes from a filing is
stated identically in all 5 versions of that filing, which matters because a report can be
filed again with corrections.
