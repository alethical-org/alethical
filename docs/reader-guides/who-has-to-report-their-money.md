<!-- describes: apps/frontend/src/lib/researchPieces/whoHasToReportTheirMoney.ts -->
<!-- POSTED 27 Aug 2026, and live at `/read/guides/who-has-to-report-their-money`.
     This file is where the prose was written and settled before any container
     existed for it, and it stays the source of record for the words. The shipped
     piece is `apps/frontend/src/lib/researchPieces/whoHasToReportTheirMoney.ts`, and
     `apps/frontend/src/lib/__tests__/research.test.ts` compares the 2 word for word,
     so an edit here without the matching edit there fails the build, and so does the
     reverse. The words are settled: rule 13's publishing order lets the Alethical team
     direct a change (point 2a) and forbids us editing them on our own initiative.


     WHAT IT IS. Piece 1 of 5 in the set "How the Money Works" (#1752's comment fixes
     the 5 and their reading order). A **Guide** teaches one piece of how the system
     works and draws no conclusions. The word was "explainer" until 27 Aug 2026
     (`docs/architecture/published-writing-decisions.md` §2.6).

     NO READER-FACING LINE NUMBERS THIS PIECE OR COUNTS THE SET. The position line names
     the set and stops, and the closing paragraph names no title for the next piece.
     Eugene ruled on 27 Aug 2026 that a piece's number is internal talk and never
     reaches a reader, so "piece 1" came off after "piece 1 of 5" had already come off
     earlier the same day. Eugene ratified on 27 Aug 2026 that a set names only its published
     pieces and never its unwritten ones, on the ground that
     `.claude/rules/grounded-answers.md` rule 2 forbids naming what we cannot deliver
     (`docs/architecture/published-writing-decisions.md` §2.3). A printed "of 5" is that
     same promise inside the prose, and it also goes stale if the set turns out to be 4
     pieces or 7. The set framing stays in this comment, which no reader sees.

     THE FORWARD LINK IS PAID. This paragraph used to end "This paragraph gains a link
     to it the day that piece posts." Guide 2 posted on 27 Aug 2026 at
     /read/guides/what-the-records-name, so the link went in and the sentence that
     explained its absence came out with it. That is not an edit on our own initiative,
     which rule 13 point 2 forbids: the piece's own text instructed it, and issue #1752's
     linking rule 6 plus published-writing-decisions.md §2.6 both say a forward link goes
     in when its destination posts and not before.

     WHICH RULES BIND IT. `.claude/rules/grounded-answers.md` rules 1 to 12, like every
     other surface. NOT rule 13: adding figures up across members, defining derived
     classifications and reaching conclusions are permitted to signed research only, and
     a guide must not inherit any of it. A piece that does carry the research trait as
     well is addressed under `/read/research/` and labelled Research, because rule 13
     then binds it in full (§2.6 and §2.7 of the same file); this piece carries only the
     guide trait.

     THE LINE COUNTS WERE CHECKED AT THE BOARD, not taken from our code. The code
     carries 17 and 16 (`CampaignFinanceFilerKind` in alethical/db/models.py, and
     CANDIDATE_LINES / PARTY_UNIT_LINES in alethical/pipeline/campaign_finance_filings.py),
     and 2 of our own records disagree about how well evidenced the 16 is:
     `docs/architecture/campaign-finance-system-design.md` §9.2 measured the 17 across
     all 407 sitting-legislator committee-years but the 16 across 12 sampled filers of
     each kind, noting "rarer labels were not ruled out", and §9.9 still lists that
     sample as an open gap, while the code comment says both were later measured against
     every registered filer. Rather than pick a side, the Board's own financial tab was
     read on 25 Aug 2026 for one filer of each kind: candidate 18472 returned 17 lines
     per year with the 5 contributor lines, party unit 20006 (DFL House Caucus) returned
     16 with a single "Contributions received", and political committee or fund 41100
     (Optometry PAC) returned the same 16. That settles the reader-facing claim, which is
     about the Board's form. It does not settle whether our parser's label set covers
     rarer labels across all 299 party units and 529 committees and funds. That is now
     settled too, by issue #1757 (merged 25 Aug 2026): the full population had already
     been read once on 12 Aug 2026 and was read again on 25 Aug 2026, 828 filers with 0
     errors, and no label outside `PARTY_UNIT_LINES` exists. §9.2 and §9.9 now say so.
     Of the 17 and 16 rows, 1 in each carries a date rather than an amount ("Most recent
     report through"), which is why the prose counts lines and not figures.

     TWO FIGURES WERE DELIBERATELY LEFT OUT, each for its own reason.

     1. The Board's live register counts (775 candidate committees, 299 party units,
        529 political committees and funds on 25 Aug 2026). Left out because
        `.claude/rules/grounded-answers.md` rule 12 requires a count of what we hold to
        be read live and never pasted, and a markdown draft cannot read anything live.
        The piece links the 3 register lists instead, so a reader clicks and sees
        today's number.

     2. The Optometry PAC's total giving since 2015. The live research piece prints $226,600
        beside 4 rows that sum to $123,500, and issue #1687 found that nothing on the
        page says why the two differ. Unverified here, so it is not repeated. The 2
        caucus-side figures that ARE verified carry an explicit statement of what they
        cover.

     THE 2 FIGURES THAT NEED RE-CHECKING BEFORE THE PAGE SHIPS. The $66,750 /
     $56,750 caucus split and the 1,732 candidate committees are pinned to release
     3f2bdf90-a4e3-4cf2-b8f1-6024167da680, the Board's itemized contributions download
     as Alethical loaded it on 12 Aug 2026 (issue #1687). If the built page ships on a
     newer release, recompute them and restate the date in the prose. Rule 12: one
     clearly labelled freshness date per page carrying a money figure.

     WHAT THIS PIECE OWNS, so the other 4 link here rather than re-explaining:
     candidate committee · party unit · legislative caucus · political committee ·
     political fund · PAC · registration threshold · committee-is-not-a-candidate.

     WHERE IT LINKS FORWARD, both waiting on the piece existing:
     the $200 naming rule -> piece 2 · running your own ads about a race -> piece 4.
     Full linking design, including the exact phrases in the live research piece that
     should link here: issue #1752's second comment.

     NAMED BUT DELIBERATELY NOT EXPLAINED, and owned by nobody in the set of 5:
     contribution limits, the public subsidy, in-kind contributions, the political
     contribution refund. Candidates for a 6th piece, not a digression inside this one.
-->

# Who has to report their money

*How the Money Works*

Look up a Minnesota politician’s money and you will not find a person. You will find an
account.

Minnesota keeps 3 kinds of political account, and which kind you are looking at changes
what the records will tell you. Telling them apart is the whole of this piece.

## Nobody registers because they have opinions

You register with the Minnesota Campaign Finance Board when the money crosses a line the
law sets, and not before. A candidate who raises or spends $750 or less in a year does
not have to form a committee at all. Groups have their own lines: $1,500 for a group set
up only to run its own ads about a race, $5,000 for one working on a ballot question.

Below the line, nothing is filed. Above it, everything the account takes in and pays out
becomes public.

## 1. A candidate’s own campaign committee

All of a candidate’s campaign money moves through one account, and only that account.
The Board’s handbook says it plainly: a candidate can have only one campaign committee
for each office sought. The candidate cannot take in or spend campaign money outside it.

## 2. A party unit

A party unit is an official arm of a recognized party. Minnesota recognizes them at 7
levels: the state committee, a legislative caucus, a congressional district, a county, a
legislative district, a city, and a precinct. A county party organization and the state
party are both party units.

Six of them work across the whole state rather than inside one county or district.
The 2 state parties:

- the state DFL (registered as “MN DFL State Central Committee”)
- the state Republican party (registered as “Republican Party of Minn”)

And the 4 legislative caucuses:

- the House DFL caucus (“DFL House Caucus”)
- the House Republican caucus (“HRCC”)
- the Senate DFL caucus (“DFL Senate Caucus”)
- the Senate Republican caucus (“Senate Victory Fund (SVF)”)

**A caucus is not a party.** The word does 2 jobs. It means the legislators of one party
in one chamber, and it means the registered account that raises money for that chamber’s
races. Each of the 4 above is its own account, with its own bank balance and its own
filings. Money sitting in the DFL House Caucus account is not money sitting in the state
DFL’s account.

## 3. A political committee or fund

This is the one most people call a PAC.

A political **committee** is a group whose main purpose is politics. A political **fund**
is a separate pot of political money kept by an organization that exists to do something
else, like a trade association or a union. Same records either way. What differs is what
the organization is for.

Minnesota’s optometrists keep one, registered as “Optometry PAC”. Counting from 2015,
and counting the Board’s itemized contributions download as Alethical loaded it on
12 August 2026, it sent $66,750 to the 2 DFL legislative caucuses and $56,750 to the
2 Republican legislative caucuses.

Both figures count only payments to those 4 accounts, and only the payments Minnesota
requires a name for. Neither one is everything it gave.

And why it gave to both sides is not in the records. A filing says who, how much, and
when. It does not say why, and neither will we.

## The kind decides what you can see

Look up a candidate’s committee on the Board’s own site and you get 17 lines for the
year. Five of them split the incoming money by who it came from: individuals,
lobbyists, other committees and funds, party units, and everything else.

Look up a party unit or a political committee or fund and you get 16 lines. The 5 are
replaced by 1, reading “Contributions received”.

So “where did this money come from?” is a question the records answer for a candidate
and do not answer for a caucus. Same Board, same year, different form.

## An account is not a person

One committee per office sought has a consequence. Somebody who serves in the House and
later runs for the Senate has 2 accounts, not 1.

From 2015 onward, 1,732 candidate committees received a named donation. That is 1,732
accounts. The number of people behind them is smaller, and nothing in those records says
by how much.

Most of those 1,732 cannot be looked up on the Board’s register at all. The register
lists who is registered right now, and an account drops off it once it closes.

So counting committees is not counting candidates.

## Next

Minnesota requires an account to name a donor once that person’s giving passes $200 in
total for the calendar year, and lets it name smaller donors too. Every figure above
sits on one side of that line.

[What the records name, and what they leave out](what-the-records-name.md) is the other
side.

---

*Where this comes from.* Who must register, and at what amount: the Board’s
[campaign finance program overview](https://cfb.mn.gov/citizen-resources/board-programs/overview/campaign-finance/).
One committee per office sought: the Board’s
[Legislative and Constitutional Office Candidate Handbook](https://cfb.mn.gov/pdf/publications/handbooks/candidate_handbook.pdf)
(last revised 30 April 2026) and
[Minnesota Statutes 10A.105](https://www.revisor.mn.gov/statutes/cite/10A.105).
What a party unit is: the Board’s
[Political Party Unit Handbook](https://cfb.mn.gov/pdf/publications/handbooks/PTU_handbook.pdf)
and [Minnesota Statutes 10A.01](https://www.revisor.mn.gov/statutes/cite/10A.01)
subdivision 30. What a political committee or fund is: the Board’s
[Political Committee and Political Fund Handbook](https://cfb.mn.gov/pdf/publications/handbooks/PCF_handbook.pdf)
and Minnesota Statutes 10A.01 subdivisions 27 and 28. Naming a donor at $200:
[Minnesota Statutes 10A.20](https://www.revisor.mn.gov/statutes/cite/10A.20)
subdivision 3. The 6 party units named above, and who is registered today: the Board’s
own registers of
[candidates](https://cfb.mn.gov/reports-and-data/viewers/campaign-finance/candidate/),
[party units](https://cfb.mn.gov/reports-and-data/viewers/campaign-finance/party-unit/)
and
[committees and funds](https://cfb.mn.gov/reports-and-data/viewers/campaign-finance/committee-fund/),
where the reporting forms for each kind can also be read. The optometrists’ figures and
the 1,732 committees: the Board’s
[itemized contributions bulk download](https://cfb.mn.gov/reports-and-data/self-help/data-downloads/campaign-finance/),
as Alethical loaded it on 12 August 2026.
