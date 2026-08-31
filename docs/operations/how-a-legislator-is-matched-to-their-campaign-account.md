# How a legislator is matched to their campaign account

Net: Minnesota publishes every campaign account's money and never says which account
belongs to which politician. Alethical refuses to guess, so a person decides each one, by
hand, and signs it. This is the public record of how that is done and where all 200 sitting
members currently stand. It exists so that anyone can check us without asking us for
anything.

The counts and tables below the line are rewritten by a command, never typed. Everything
above it is written by hand and does not move.

## What we claim, and what we do not

**We claim**: a named entity read the evidence for this account and this politician on a
stated day, and decided the account is theirs. Nothing else.

**We do not claim** that the account's money is complete, that Minnesota endorsed our
match, or that any payment means anything about how anybody voted. Those are separate
promises made, or refused, elsewhere: `.claude/rules/grounded-answers.md` rule 3 forbids
turning money into motive, rule 11 forbids vouching for a list being complete, and rule 12
forbids implying that dollars travelled from one account to another.

## Why a person has to do it

Minnesota gives every registered committee a number. Nothing in the state's files links
that number to a person in our database, and the money service we read carries no committee
name, no registration number and no filer identifier at all, so 2 different accounts return
structurally identical documents differing only in their amounts. There is no field to
check a wrong match against and nothing downstream that would fail.

That is the whole reason. It is not that a name match might be wrong. It is that if it is
wrong, **nothing will ever notice**: the money would render perfectly, dated correctly,
reconciled against a real filing, under the wrong person's photograph. Attaching the wrong
account is the worst mistake this product can make, so no score, no threshold and no
agreement between rules ever produces a match.

The design reasoning behind every rule here lives in
[campaign-finance-system-design.md §5.1 (what counts as a confirmed match)](../architecture/campaign-finance-system-design.md),
and is not repeated in this file. Two places defining one method is how they come to
disagree.

## The 3 pieces of evidence

A person reads the same 3 things on every case. Each is a published record, and each can be
checked by anyone.

1. **The filed name.** How the name Minnesota printed on the account compares to the name
   we hold for the member. It matches exactly, or it is a shortened form, or it is a
   nickname the state itself prints in quotes or parentheses, or it shares only the last
   name and the first name had to be inferred. Only the first 2 of those are the state's
   own words; the others are our reading of how names work, which is exactly the part a
   person is being asked to check.
2. **The Board's register of registered candidates.** Whether Minnesota's own list ties
   that account number to this member's seat and party, and names them as its current
   holder. This is the strongest single signal, because it is the state making the link
   rather than us inferring it.
3. **The party money.** Which party's organisations pay into the account, compared to the
   party we hold for the member. This has 4 answers and 2 of them are not disagreements:
   the money agrees, it names the other party, no party organisation has ever paid in, or
   we hold no party for the member to compare. A missing comparison says nothing about the
   account and may never read as though it did.

## Who signs, and what is stored

Every decision is recorded against **Alethical, LLC**, the entity accountable for the
match, which is also the entity a reader is told checked it. A person still answers every
question one at a time or as a reviewed list, and the database refuses a decision that
nothing signed. What the record does not say is which individual answered; if 2 people ever
hold sittings, the reviewing tool can record an individual instead.

Each decision stores the account chosen, its filed name, office and years exactly as they
appeared on screen, the 3 pieces of evidence above, who signed, the minute it happened, any
note the reviewer typed, and the newest payment date in the download it was read from. That
last one is how anybody reproduces a decision: any download carrying data through that date
holds the rows the decision rested on.

**Rejections are stored too.** Deciding that an account is *not* a member's writes its own
record with its own evidence, so "a person checked this and it is not theirs" is never
indistinguishable from "nobody has looked yet".

## How a wrong match would surface

Nobody re-reads 200 rows looking for mistakes, and a second reviewer would not help: 2
people reading one committee name share the whole of their evidence and so share its
mistakes. What is independent of the reader is the sources. So every time new money is
loaded, a check re-reads every confirmed match against Minnesota's register, against which
party's organisations pay the account, and against the account's own published name, which
can change. A contradiction is filed as a task for a person and never repaired
automatically, because a contradiction wants human eyes. It never blocks the money load:
the money is correct whether or not a committee's identity changed.

## How to challenge one

1. Open Minnesota's own campaign finance viewer at
   <https://cfb.mn.gov/reports-and-data/viewers/campaign-finance/candidates/> and look up
   the account number this record names.
2. Compare its seat, party and candidate name to the politician's own page on
   [house.mn.gov](https://www.house.mn.gov/members/) or [senate.mn](https://www.senate.mn/).
3. If they do not agree, write to Alethical. Every decision names the day it was made and
   the snapshot it was made from, so a disagreement can be traced to a specific record
   rather than argued in general.

## Reading the full record yourself

The tables below carry every case whose evidence is weaker than the strongest shape, plus
the strongest ones as a count. The complete per-legislator record, including rejections and
each decision's own timestamp, is in the `legislator_campaign_committee` table, and the
tool that reads and writes it is
[`scripts/review_legislator_campaign_committees.py`](../../scripts/review_legislator_campaign_committees.py).
Its `coverage` and `propose` commands write nothing, so there is no way to do harm by
looking. `record` rewrites the generated section of this file.

## Where all 200 stand

<!-- generated by review_legislator_campaign_committees.py record -->

Read on 2026-08-31 from a contributions download reaching 2026-07-20, against 200 sitting legislators.

| What | How many |
| --- | --- |
| Sitting legislators | 200 |
| Matches a person has confirmed | 144 (covering 144 legislators) |
| Proposals a person has rejected | 0 |
| One account proposed, nothing competing | 144 |
| More than one account in play | 56 |
| No account proposed at all | 0 |

## The 144 with one account and nothing competing

**110 carry the strongest evidence there is**: the filed name matches exactly, the Board's own register confirms the member's seat and party, and the party money agrees. Nothing in that shape is open to argument, so they are a count here rather than 110 rows. Patty Acomb (house 45B), account 18272, is one of them.

**34 are weaker in exactly one way each, and every one is named here.** No case among them carries a signal that contradicts the match; a missing signal and a conflicting signal are different things, and a conflicting one sends a case to the group below instead.

| Legislator | Seat | Account | Filed name | Board's register | Party money |
| --- | --- | --- | --- | --- | --- |
| Alex Falconer | house 49A | 19056 | is a shortened form | confirms this seat and party | agrees |
| Anquam Mahamoud | house 62B | 19091 | matches exactly | confirms this seat and party | none has ever come in |
| Dave Baker | house 16B | 17700 | is a nickname the state prints | confirms this seat and party | agrees |
| Dave Pinto | house 64B | 17675 | shares only the last name | confirms this seat and party | agrees |
| Doron Clark | senate 60 | 19196 | matches exactly | confirms this seat and party | none has ever come in |
| Eric R. Pratt | senate 54 | 17520 | matches exactly | confirms this seat and party | none has ever come in |
| Esther Agbaje | house 59B | 18454 | matches exactly | confirms this seat and party | none has ever come in |
| Ginny Klevorn | house 42B | 17950 | is a nickname the state prints | confirms this seat and party | agrees |
| Greg Davids | house 26B | 12604 | is a shortened form | confirms this seat and party | agrees |
| Jamie Long | house 61B | 18165 | is a nickname the state prints | confirms this seat and party | agrees |
| Jennifer A. McEwen | senate 08 | 18581 | is a shortened form | confirms this seat and party | agrees |
| Jimmy Gordon | house 28A | 19053 | is a nickname the state prints | confirms this seat and party | agrees |
| Joe McDonald | house 29A | 17167 | is a nickname the state prints | confirms this seat and party | agrees |
| Katie Jones | house 61A | 19072 | matches exactly | confirms this seat and party | none has ever come in |
| Kim Hicks | house 25A | 18519 | is a nickname the state prints | confirms this seat and party | agrees |
| Liish Kozlowski | house 08B | 18886 | shares only the last name | confirms this seat and party | agrees |
| Liz Lee | house 67A | 18701 | shares only the last name | confirms this seat and party | agrees |
| Matt D. Klein | senate 53 | 17924 | is a shortened form | confirms this seat and party | agrees |
| Max Rymer | house 28B | 18005 | is a nickname the state prints | confirms this seat and party | agrees |
| Meg Luger-Nikolai | house 64A | 19298 | matches exactly | confirms this seat and party | none has ever come in |
| Mohamud Noor | house 60B | 17693 | matches exactly | confirms this seat and party | none has ever come in |
| Nathan Wesenberg | senate 10 | 18778 | is a shortened form | confirms this seat and party | agrees |
| Pam Altendorf | house 20A | 18760 | is a shortened form | confirms this seat and party | agrees |
| Paul Novotny | house 30B | 18472 | matches exactly | does not list the account | agrees |
| Rick Hansen | house 53B | 16189 | is a nickname the state prints | confirms this seat and party | agrees |
| Robert J. Kupec | senate 04 | 18917 | is a shortened form | confirms this seat and party | agrees |
| Ron Kresha | house 10A | 17500 | is a shortened form | confirms this seat and party | agrees |
| Ron Latz | senate 46 | 16553 | is a shortened form | confirms this seat and party | agrees |
| Samakab Hussein | house 65A | 18767 | matches exactly | confirms this seat and party | none has ever come in |
| Shelley Buck | house 47A | 19259 | matches exactly | confirms this seat and party | none has ever come in |
| Steve Gander | house 01B | 19052 | is a shortened form | confirms this seat and party | none has ever come in |
| Sydney Jordan | house 60A | 18470 | matches exactly | confirms this seat and party | none has ever come in |
| Tom Sexton | house 19B | 19096 | shares only the last name | confirms this seat and party | agrees |
| Zack Stephenson | house 35A | 18129 | shares only the last name | confirms this seat and party | agrees |

### Why an account can be missing from the state's register

The register lists *current* candidates, so a committee that has closed drops out of it. Where Minnesota's own filer record gives a closing date, the absence is explained and is not a gap in our data.

- **Paul Novotny** (house 30B), account 18472: Minnesota's filer record shows the registration closed on 2026-07-28, which is why the register of current candidates does not list it.

## The 56 where more than one account is in play

These are not unidentified people. Almost every one is a member holding more than one account of their own, so the question is which to show. Between them they carry 133 accounts. The Board's own register had already removed 32 wrong accounts across 12 of them before any person read a line, so the narrowing is Minnesota's records rather than our judgement.

| Legislator | Seat | Accounts in play | Why each needs a person |
| --- | --- | --- | --- |
| Alice Mann | senate 50 | 2 | no contributions in the current session's years; committee is for House, not Senate |
| Amanda H. Hemmingsen-Jaeger | senate 47 | 2 | 2 committees are plausible for this legislator; committee is for House, not Senate |
| Andy Smith | house 25B | 2 | 2 committees are plausible for this legislator; given name is inferred (surname_only); committee is for Senate, not House |
| Aric Putnam | senate 14 | 2 | 2 committees are plausible for this legislator; committee is for House, not Senate; no contributions in the current session's years |
| Ben Bakeberg | house 54B | 2 | 2 committees are plausible for this legislator; committee is for Senate, not House |
| Bernie Perryman | house 14A | 2 | given name is inferred (surname_only); committee is for Senate, not House |
| Bjorn Olson | house 22A | 3 | 3 committees are plausible for this legislator; given name is inferred (surname_only); committee is for Senate, not House |
| Calvin K. Bahr | senate 31 | 2 | 2 committees are plausible for this legislator; committee is for House, not Senate; no contributions in the current session's years |
| Carla J. Nelson | senate 24 | 3 | 3 committees are plausible for this legislator; given name is inferred (surname_only); committee is for House, not Senate; party units giving to this committee are DFL, and we record this legislator as R |
| Dan Wolgamott | house 14B | 3 | 3 committees are plausible for this legislator; committee is for Senate, not House; no contributions in the current session's years; given name is inferred (shortened); committee is for State Aud, not House |
| David Gottfried | house 40B | 2 | 2 committees are plausible for this legislator; no contributions in the current session's years |
| Elliott Engen | house 36A | 2 | 2 committees are plausible for this legislator; committee is for State Aud, not House |
| Eric Lucero | senate 30 | 2 | 2 committees are plausible for this legislator; committee is for House, not Senate; no contributions in the current session's years |
| Erin K. Maye Quade | senate 56 | 2 | 2 committees are plausible for this legislator; committee is for House, not Senate; no contributions in the current session's years |
| Erin P. Murphy | senate 64 | 4 | 4 committees are plausible for this legislator; committee is for Gov, not Senate; no contributions in the current session's years; committee is for House, not Senate; given name is inferred (surname_only); party units giving to this committee are R, and we record this legislator as DFL |
| Ethan Cha | house 47B | 2 | 2 committees are plausible for this legislator; committee is for Senate, not House |
| Glenn H. Gruenhagen | senate 17 | 2 | 2 committees are plausible for this legislator; committee is for House, not Senate; no contributions in the current session's years |
| Harry Niska | house 31A | 2 | 2 committees are plausible for this legislator; committee is for Atty Gen, not House; no contributions in the current session's years |
| Huldah Momanyi-Hiltsley | house 38A | 2 | 2 committees are plausible for this legislator; committee is for Senate, not House; no contributions in the current session's years |
| Jason Rarick | senate 11 | 3 | 3 committees are plausible for this legislator; committee is for House, not Senate; no contributions in the current session's years; given name is inferred (surname_only) |
| Jay Xiong | house 67B | 2 | 2 committees are plausible for this legislator; given name is inferred (surname_only); committee is for Senate, not House |
| Jeff R. Howe | senate 13 | 2 | 2 committees are plausible for this legislator; given name is inferred (shortened); committee is for House, not Senate; no contributions in the current session's years |
| Jeremy R. Miller | senate 26 | 2 | 2 committees are plausible for this legislator; given name is inferred (surname_only); committee is for House, not Senate |
| Jessica Hanson | house 55A | 2 | 2 committees are plausible for this legislator; given name is inferred (surname_only); committee is for Senate, not House |
| Jim Carlson | senate 52 | 2 | 2 committees are plausible for this legislator; given name is inferred (surname_only); committee is for House, not Senate |
| Jordan Rasmusson | senate 09 | 2 | 2 committees are plausible for this legislator; committee is for House, not Senate; no contributions in the current session's years |
| Josh Heintzeman | house 06B | 2 | 2 committees are plausible for this legislator; given name is inferred (surname_only); committee is for Senate, not House |
| Josiah Hill | house 33B | 2 | 2 committees are plausible for this legislator; committee is for Senate, not House; no contributions in the current session's years |
| Kaela Berg | house 55B | 2 | 2 committees are plausible for this legislator; committee is for Senate, not House; no contributions in the current session's years |
| Kari Rehrauer | house 35B | 2 | 2 committees are plausible for this legislator; committee is for Senate, not House; no contributions in the current session's years |
| Keri Heintzeman | senate 06 | 2 | 2 committees are plausible for this legislator; given name is inferred (surname_only); committee is for House, not Senate |
| Kristin Robbins | house 37A | 2 | 2 committees are plausible for this legislator; committee is for Gov, not House |
| Lindsey Port | senate 55 | 2 | 2 committees are plausible for this legislator; committee is for House, not Senate; no contributions in the current session's years |
| Lisa Demuth | house 13A | 2 | 2 committees are plausible for this legislator; committee is for Gov, not House |
| Liz Boldon | senate 25 | 2 | 2 committees are plausible for this legislator; committee is for House, not Senate; no contributions in the current session's years |
| Liz Reyer | house 52A | 2 | committee is for Senate, not House; given name is inferred (shortened) |
| Marion Rarick | house 29B | 2 | 2 committees are plausible for this legislator; given name is inferred (surname_only); committee is for Senate, not House |
| Mark T. Johnson | senate 01 | 7 | 7 committees are plausible for this legislator; given name is inferred (surname_only); committee is for House, not Senate; party units giving to this committee are DFL, and we record this legislator as R; committee is for Gov, not Senate |
| Mike Freiberg | house 43B | 2 | 2 committees are plausible for this legislator; committee is for Senate, not House |
| Mike Wiener | house 05B | 2 | 2 committees are plausible for this legislator; given name is inferred (surname_only); committee is for Senate, not House |
| Nathan Nelson | house 11B | 3 | 3 committees are plausible for this legislator; given name is inferred (surname_only); committee is for Senate, not House; party units giving to this committee are DFL, and we record this legislator as R |
| Omar Fateh | senate 62 | 2 | 2 committees are plausible for this legislator; committee is for House, not Senate; no contributions in the current session's years |
| Patti Anderson | house 33A | 2 | 2 committees are plausible for this legislator; given name is inferred (surname_only); committee is for Senate, not House |
| Paul Anderson | house 12A | 4 | 4 committees are plausible for this legislator; committee is for Senate, not House; no contributions in the current session's years; given name is inferred (surname_only) |
| Peggy Bennett | house 23A | 2 | 2 committees are plausible for this legislator; committee is for Gov, not House |
| Pete Johnson | house 08A | 4 | 4 committees are plausible for this legislator; given name is inferred (surname_only); committee is for Senate, not House; party units giving to this committee are R, and we record this legislator as DFL; committee is for Gov, not House |
| Robert D. Farnsworth | senate 07 | 3 | 3 committees are plausible for this legislator; committee is for House, not Senate; no contributions in the current session's years |
| Samantha Vang | house 38B | 2 | 2 committees are plausible for this legislator; given name is inferred (surname_only); committee is for Gov, not House |
| Steve Drazkowski | senate 20 | 2 | no contributions in the current session's years; given name is inferred (shortened); committee is for House, not Senate |
| Steve Green | senate 02 | 2 | 2 committees are plausible for this legislator; committee is for House, not Senate; no contributions in the current session's years |
| Steven Jacob | house 20B | 2 | no contributions in the current session's years; committee is for Senate, not House |
| Tina Liebling | house 24B | 2 | 2 committees are plausible for this legislator; committee is for Gov, not House; no contributions in the current session's years |
| Tom Dippel | house 41B | 3 | 3 committees are plausible for this legislator; committee is for Senate, not House; no contributions in the current session's years |
| Tom Murphy | house 09B | 2 | 2 committees are plausible for this legislator; given name is inferred (surname_only); committee is for Senate, not House |
| Tou Xiong | senate 44 | 3 | 3 committees are plausible for this legislator; committee is for House, not Senate; no contributions in the current session's years; given name is inferred (surname_only) |
| Wayne Johnson | house 41A | 4 | 4 committees are plausible for this legislator; given name is inferred (surname_only); committee is for Senate, not House; committee is for Gov, not House |

<!-- end generated -->
