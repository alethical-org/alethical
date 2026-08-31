# How a legislator is matched to their campaign account

Net: Minnesota publishes every campaign account's money and never says which account
belongs to which politician. Alethical refuses to guess, so a person decides each one, by
hand, and signs it. This is the public record of how that is done and where all 200 sitting
members stand. It exists so that anyone can check us without asking us for anything.

The counts and tables below the line are rewritten by a command, never typed. Everything
above it is written by hand and does not move.

## What the problem actually is

Start with what Minnesota gives the public, because the gap is not obvious until you look.

The state publishes a file of every reported campaign donation: who gave, how much, when,
and which account received it. Each account has a registration number. That file is
complete, free, and updated when campaigns file their reports.

What it never contains is a person. Account 18272 received $13,665 in 2026. The file does
not say that account 18272 is Representative Patty Acomb's. It says the account is called
"Acomb, Patty House Committee", which is a name a campaign typed when it registered, not a
link to anybody. Names repeat: Minnesota has 5 sitting legislators named Johnson and 3
named Anderson, and 23 further Johnson accounts belonging to people who are not
legislators at all.

So a site that wants to show a politician's campaign money has to answer a question the
records do not: **which of these accounts is this person's?**

## Why a machine may not answer it

The obvious answer is to match on the name, and it is the wrong answer, for a reason worth
understanding before anything else here makes sense.

**A wrong match is invisible.** The money service we read carries no committee name, no
registration number, and no filer identifier of any kind, so 2 different accounts return
documents identical in structure and different only in their amounts. There is no field to
check a wrong match against, no reconciliation that would fail, and no later step that
could catch it. Attach the wrong account and the money renders perfectly, dated correctly,
reconciled against a real filing, **under the wrong person's photograph**, and nothing
anywhere reports a problem.

That is why no score, no threshold and no agreement between rules ever produces a match
here. A machine proposes; a person decides and signs. The design reasoning is in
[campaign-finance-system-design.md §5.1 (what counts as a confirmed match)](../architecture/campaign-finance-system-design.md)
and is not repeated in this file, because 2 places defining one method is how they come to
disagree.

## What happened on 31 August 2026

Before that day, **0 of 200 sitting legislators had a confirmed account**, so every
legislator profile said the same thing: we have not matched this member to their committee
yet. No campaign money appeared anywhere on the site for any named person.

A person sat down and answered every case. It took 3 rounds, and what made it possible in
one sitting rather than 200 separate readings is that most of the cases share a single
piece of evidence, so they could be read as one list and answered together:

1. **144 members had one account proposed and nothing competing.** One numbered list, every
   row showing its evidence, confirmed together after the reviewer typed the word `confirm`.
2. **56 members had 2 or more accounts in play.** Minnesota's own register named exactly one
   account for the member's own seat in 52 of them, so those became a list too. Two further
   lists followed: accounts the register names for this same member under a different office,
   and accounts the register names for a different person.
3. **The rest were answered one at a time**, which is where the alternatives genuinely had to
   be weighed.

Nothing was written until a person typed a word, every list could have any row held back,
and holding a row back never recorded anything. Three rows were held back and later
answered individually, all 3 because Minnesota prints a formal first name where our records
hold the familiar one: Bernadette for Bernie, Michael for Mike, Daniel for Dan.

**Two accounts were deliberately left open**, and they are named below. Leaving one open is
the honest answer when the records cannot settle it.

## What we claim, and what we do not

**We claim**: a named entity read the evidence for this account and this politician on a
stated day, and decided the account is theirs. Nothing else.

**We do not claim** that the account's money is complete, that Minnesota endorsed our
match, or that any payment means anything about how anybody voted. Those are separate
promises made, or refused, elsewhere: `.claude/rules/grounded-answers.md` rule 3 forbids
turning money into motive, rule 11 forbids vouching for a list being complete, and rule 12
forbids implying that dollars travelled from one account to another.

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
   rather than us inferring it. It lists *current* candidates only, so a finished race has
   no row at all, and an absent row says nothing either way.
3. **The party money.** Which party's organisations pay into the account, compared to the
   party we hold for the member. This has 4 answers and 2 of them are not disagreements:
   the money agrees, it names the other party, no party organisation has ever paid in, or
   we hold no party for the member to compare. A missing comparison says nothing about the
   account and may never read as though it did.

## Who signs, and what is stored

Every decision is recorded against **Alethical, LLC**, the entity accountable for the
match, which is also the entity a reader is told checked it. A person still answers every
question, and the database refuses a decision that nothing signed. What the record does not
say is which individual answered; if 2 people ever hold sittings, the reviewing tool can
record an individual instead.

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

The tables below carry every decision grouped by the evidence behind it, every rejection
named, everything left open, and every note a reviewer typed. The complete per-decision
record, including each decision's own timestamp, is in the
`legislator_campaign_committee` table, and the tool that reads and writes it is
[`scripts/review_legislator_campaign_committees.py`](../../scripts/review_legislator_campaign_committees.py).
Its `coverage` and `propose` commands write nothing, so there is no way to do harm by
looking. `record` rewrites the generated section of this file.

## Where all 200 stand

<!-- generated by review_legislator_campaign_committees.py record -->

Read on 2026-08-31 from a contributions download reaching 2026-07-20, against 200 sitting legislators.

| What | How many |
| --- | --- |
| Sitting legislators | 200 |
| Legislators with at least one confirmed account | 200 |
| Accounts confirmed as a member's own | 242 |
| Accounts checked and ruled out | 33 |
| Accounts read and left undecided | 2 |

## What every confirmation rests on

**195 of the 242 rest on Minnesota's own register** naming that account for that member's own seat and party and flagging them as its current holder. That is the state making the link rather than us inferring it, and it is the strongest evidence available on any of these.

**230 of the 242 carry the member's own name** as the state filed it: the same name, a shortening of it, a nickname the state itself prints in quotes, or a middle name. The remaining 12 share only a last name, and every one of those also has the register confirming the seat or the party money agreeing.

| Accounts | Filed name | Minnesota's register | Party money |
| --- | --- | --- | --- |
| 151 | matches exactly | confirms this seat and party | agrees |
| 22 | matches exactly | does not list the account | agrees |
| 14 | matches exactly | confirms this seat and party | none has ever come in |
| 11 | is a shortened form | confirms this seat and party | agrees |
| 9 | shares only the last name | confirms this seat and party | agrees |
| 8 | is a nickname the state prints | confirms this seat and party | agrees |
| 6 | matches exactly | registers it for another office | none has ever come in |
| 6 | matches exactly | does not list the account | none has ever come in |
| 5 | matches exactly | registers it for another office | agrees |
| 3 | is a shortened form | does not list the account | agrees |
| 2 | shares only the last name | registers it for another office | agrees |
| 1 | is a shortened form | confirms this seat and party | none has ever come in |
| 1 | is a middle name the state prints | confirms this seat and party | agrees |
| 1 | is a nickname the state prints | registers it for another office | agrees |
| 1 | is a shortened form | registers it for another office | none has ever come in |
| 1 | shares only the last name | does not list the account | agrees |

## What every rejection rests on

A rejection is a claim we publish, not a shrug: it records that a person checked this account and it belongs to somebody else. **33 of the 33 carry only a shared last name**, which is the shape a stranger's account takes; not one rejection was made against an account filed under the member's own name.

| Legislator | Account | Filed as | Minnesota's register |
| --- | --- | --- | --- |
| Andy Smith (house 25B) | 19281 | Smith, Nat Senate Committee | registers it for another office |
| Bjorn Olson (house 22A) | 19200 | Olson, Rick Senate Committee | registers it for another office |
| Bjorn Olson (house 22A) | 19535 | Olson, Bradley (Brad) Senate Committee | registers it for another office |
| Carla J. Nelson (senate 24) | 18412 | Nelson, Nathan D House Committee | registers it for another office |
| Carla J. Nelson (senate 24) | 19471 | Nelson, Lowell (Rusty) House Committee | registers it for another office |
| Erin P. Murphy (senate 64) | 18818 | Murphy, Tom House Committee | registers it for another office |
| Jason Rarick (senate 11) | 17357 | Rarick, Marion Olivia House Committee | registers it for another office |
| Jay Xiong (house 67B) | 18715 | Xiong, Tou Senate Committee | registers it for another office |
| Jeremy R. Miller (senate 26) | 19285 | Miller, Jackson House Committee | registers it for another office |
| Jessica Hanson (house 55A) | 19219 | Hanson, Angie Senate Committee | registers it for another office |
| Jim Carlson (senate 52) | 19294 | Carlson, Shelly House Committee | registers it for another office |
| Josh Heintzeman (house 06B) | 19205 | Heintzeman, Keri Senate Committee | registers it for another office |
| Keri Heintzeman (senate 06) | 17782 | Heintzeman, Joshua House Committee | registers it for another office |
| Marion Rarick (house 29B) | 18406 | Rarick, Jason Senate Committee | registers it for another office |
| Mark T. Johnson (senate 01) | 17398 | Johnson, Brian L House Committee | registers it for another office |
| Mark T. Johnson (senate 01) | 19078 | Johnson, Wayne House Committee | registers it for another office |
| Mark T. Johnson (senate 01) | 19123 | Johnson, Jessica L House Committee | registers it for another office |
| Mark T. Johnson (senate 01) | 19045 | Johnson, Peter House Committee | registers it for another office |
| Mark T. Johnson (senate 01) | 19046 | Johnson, Curtis House Committee | registers it for another office |
| Mark T. Johnson (senate 01) | 19247 | Johnson, Jeff Gov Committee | does not list the account |
| Nathan Nelson (house 11B) | 17105 | Nelson, Carla J Senate Committee | registers it for another office |
| Nathan Nelson (house 11B) | 19199 | Nelson, Angela Senate Committee | registers it for another office |
| Patti Anderson (house 33A) | 17362 | Anderson, Bruce D Senate Committee | does not list the account |
| Paul Anderson (house 12A) | 17362 | Anderson, Bruce D Senate Committee | does not list the account |
| Pete Johnson (house 08A) | 18011 | Johnson, Mark Timothy Senate Committee | registers it for another office |
| Pete Johnson (house 08A) | 19332 | Johnson, Cherie Senate Committee | registers it for another office |
| Pete Johnson (house 08A) | 19247 | Johnson, Jeff Gov Committee | does not list the account |
| Samantha Vang (house 38B) | 19490 | Vang, Po Gov Committee | registers it for another office |
| Tom Murphy (house 09B) | 18443 | Murphy, Erin Senate Committee | registers it for another office |
| Tou Xiong (senate 44) | 18191 | Xiong, Jay House Committee | registers it for another office |
| Wayne Johnson (house 41A) | 18011 | Johnson, Mark Timothy Senate Committee | registers it for another office |
| Wayne Johnson (house 41A) | 19332 | Johnson, Cherie Senate Committee | registers it for another office |
| Wayne Johnson (house 41A) | 19247 | Johnson, Jeff Gov Committee | does not list the account |

## What is still open

2 accounts were read and deliberately left undecided. Leaving one open is the honest answer when the records cannot settle it, and nothing on the site claims anything about these either way.

| Legislator | Account | Filed as | Why it is open |
| --- | --- | --- | --- |
| Paul Anderson (house 12A) | 18036 | Anderson, Paul Senate Committee | the records do not separate this member from another person of the same name |
| Paul Anderson (house 12A) | 18670 | Anderson, Paul Senate Committee | the records do not separate this member from another person of the same name |

## What the reviewer wrote down

Each decision stores a note in the reviewer's own words alongside the evidence the tool printed. These are those notes, with how many decisions each covers.

| Decisions | Answer | The note |
| --- | --- | --- |
| 144 | confirmed | Read all 144 lines in one sitting against the printed evidence for each |
| 52 | confirmed | Read all 52 rows and checked the Board's own register row against each member's seat and party |
| 31 | confirmed | Read all 33 rows and checked each account is filed under this member's own name from a race that has ended; held back 2 where a middle initial separates 2 people of the same name |
| 28 | rejected | Read all 31 rows and checked the Board names a different candidate on each; held back 3 where it names the same person by their formal first name |
| 12 | confirmed | Read all 12 rows and checked the Board names this same member as the candidate on each |
| 3 | rejected | Minnesota names Jeff Johnson as this account's candidate |
| 2 | rejected | Minnesota names Bruce D Anderson as this account's candidate |
| 1 | confirmed | Minnesota files this account as Perryman, Bernadette Ann, which is her own name |
| 1 | confirmed | Minnesota's register names Perryman, Bernadette A for Senate 14, her own Senate run |
| 1 | confirmed | Minnesota's register names Wiener, Michael for Senate 5, his own Senate run |

<!-- end generated -->
