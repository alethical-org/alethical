"""Facts counted from a bill's full text, for tests that must not trust an answer.

Some answer failures cannot be caught by looking at the answer, the passages it
cited, or the citation contract — every one of those can be satisfied by an answer
that is confidently, verifiably wrong. Catching those needs the **whole bill**,
counted independently, which is what lives here.

The motivating case is [#868](https://github.com/alethical-org/alethical/issues/868):
asked which cities and counties get named infrastructure grants in HF 719,
production answers "nineteen cities", names them, and says no counties are named.
Every trust signal fires correctly — the citations are real and the passages do say
what the answer says — because the writer was handed 4 of the bill's 102 passages
with nothing marking them as a sample. The answer is fluent, cited, and wrong twice
over: it undercounts by a factor of five and denies a category the bill names.

Shared deliberately with the [#868](https://github.com/alethical-org/alethical/issues/868)
regression test so the numbers live in exactly one place. Import them; do not
restate them.

Why lower bounds and named examples rather than exact counts
------------------------------------------------------------
An exact count depends on what you call a named recipient. Is the
Moorhead-Clay County Joint Powers Authority a county? Is "grants to Dakota County,
the city of Lakeville, or both" a city grant? A test pinned to an exact number
fails the next time someone answers one of those questions differently — a
definitional argument, not a regression. The bounds below are chosen to sit well
clear of every such judgment call, so only a real regression can breach them.

**And that robustness bought a blind spot, which is worth knowing before you copy
the pattern.** A bound is deaf in the direction it bounds. ``>= 15`` against a hand
count of 17 is satisfied by 16, so when this module's own county pattern quietly
found only 16 — it required capitalised words and so missed *Lake of the Woods
County* — every test stayed green while the prose above said 17 and the code
disagreed. The bound could not see it, because 16 is exactly the kind of number it
was designed to accept.

So: **keep the loose bound for the definitional edge cases, and assert the exact
figure against the bill's own text as well.** The two do different jobs. The bound
survives an argument about what counts as a recipient; the exact assertion catches
the counter being wrong, which is the failure that silently inflates every recall
percentage computed from it. Both are asserted below.

Counted independently twice, from ``bill_version_section.raw_text`` for HF 719's
current version (48 sections, 15,430 words) on Jul 31 2026, once by this session and
once by the #868 session, agreeing on both figures:

* ``grant(s) to the city of X`` matches **98** distinct cities. A looser scan of
  every ``grant(s) to …`` clause reaches ~104, picking up recipients not phrased
  "the city of X" (Lakeville, Austin, Cottage Grove, Moorhead, Hugo, Lake Elmo,
  Sauk Rapids, Mahnomen, Fairmont, Grant).
* ``grant(s) to X County`` matches **17** counties. Including other phrasings and
  the Moorhead-Clay joint-powers body reaches ~21, of which ~20 are real counties.

Both figures are now asserted against the bill's own snapshotted text rather than
trusted, because the pattern that was shipped to produce them found 98 and **16**
(#878 follow-up). The seventeenth is Lake of the Woods County, whose lowercase
connectors no capitals-only pattern can match.
"""

from __future__ import annotations

import re
from dataclasses import dataclass

# Lower bounds, set clear of every definitional edge case above.
HF719_MIN_GRANT_CITIES = 90
HF719_MIN_GRANT_COUNTIES = 15

# What production actually answered on Jul 31 2026, for tests that assert the bug
# is gone rather than merely that some number appears.
HF719_ANSWER_CITY_COUNT_BUG = 19

# Named recipients no reasonable reading excludes. An answer that denies any of
# these, or a list that omits all of them, is wrong however it is phrased.
HF719_GRANT_CITIES: tuple[str, ...] = (
    "Minneapolis",
    "St. Paul",
    "Duluth",
    "Rochester",
    "Bloomington",
)
HF719_GRANT_COUNTIES: tuple[str, ...] = (
    "Hennepin",
    "Ramsey",
    "Anoka",
    "Washington",
)

# The claim to test against, in the words a wrong answer uses. Production denied
# the county category outright; that denial is the sharpest single symptom.
HF719_COUNTIES_ARE_NAMED = True


# The phrasing the bill uses for a named recipient, in the two shapes counted
# above. Deliberately the *tight* patterns — the ones that produced 98 and 17 —
# rather than the looser scans that reach ~104 and ~21, because a recall figure
# has to have a denominator nobody can argue with.
_GRANT_CITY_RE = re.compile(
    r"grants?\s+to\s+the\s+city\s+of\s+([A-Z][A-Za-z.'’-]*(?:\s+[A-Z][A-Za-z.'’-]*){0,2})"
)
# A county's name may contain lowercase connectors, and one of the seventeen does:
# **Lake of the Woods County**. A capitals-only pattern finds sixteen and looks
# entirely correct, which is why this is pinned by a test against the bill's own
# text rather than left to review. Connectors are allowed only *between*
# capitalised words, so a name can never run on into the sentence after it.
_COUNTY_NAME = r"[A-Z][A-Za-z.'’-]*(?:\s+(?:[A-Z][A-Za-z.'’-]*|of|the)){0,3}?"
_GRANT_COUNTY_RE = re.compile(rf"grants?\s+to\s+({_COUNTY_NAME})\s+County\b")


def hf719_grant_recipients(bill_text: str) -> tuple[set[str], set[str]]:
    """(cities, counties) the bill names as grant recipients, read off its own text.

    Derived rather than listed, for the same reason ``passages_total`` is derived
    in the eval's snapshot: a hand-typed list of 98 names goes stale the first time
    the bill text is re-ingested, and a stale denominator turns a recall figure
    into a fiction.

    **Why a recall figure is needed at all** (#878). #868 fixed the retrieval half
    of the HF 719 failure: an enumerate-everything question now reads the whole
    bill, so the honesty gate passes *trivially* — a complete read cannot overclaim
    completeness, and an absence it reports is a real absence. But reading
    everything is not reporting everything. Given all 102 passages the incumbent
    still names 21 cities and no counties, and closes by blaming the text
    ("not specifically named in the provided text") for names the text does
    contain. No gate in the bar catches that, because every gate was written for
    the *partial*-read failure. This counts it.
    """
    return (
        {m.group(1).strip() for m in _GRANT_CITY_RE.finditer(bill_text)},
        {m.group(1).strip() for m in _GRANT_COUNTY_RE.finditer(bill_text)},
    )


# --- the same counting method, for every bill a recall figure is measured on ---
#
# Generalised from HF 719 for [#895](https://github.com/alethical-org/alethical/issues/895),
# which needs recall measured on more than one bill. **Three bills carry a
# *named-recipient* recall measurement, and that is a property of the phrasings below
# rather than a ceiling on enumeration.** Every bill with 25+ retrievable passages was
# scanned for named recipients using these tight phrasings; exactly four (bill, shape)
# pairs clear eight distinct recipients, and they are the three bills below. HF 719 has
# no peer for named places — the next largest set is 14.
#
# **Read that as a fact about "grant to the city of X", not as a limit on what can be
# counted.** The pool scanned holds 565 bills with 25+ passages, 262 with 50+ and 131
# with 100+; three of 565 is unsurprising for place names, because the long bills are
# mostly omnibus policy bills amending statutes and only bonding and appropriation
# bills list towns. A bill can be enumerable without naming a place, and SF 3551 below
# is the proof — it enumerates school district *numbers*. Dollar-figure line items,
# program names, agency names and repealed statute sections are all countable and all
# appear in bills with no city in them. So a fourth case is a matter of writing a
# fourth pattern, not of finding a rarer bill, and anyone reading this as "three is all
# there can ever be" should stop and write the pattern instead.
#
# **Each count below was derived and then read match by match in context**, which is
# not ceremony — every one of the three turned up something a pattern alone gets wrong:
#
# * A survey pattern counted `Office of the` (from "Office of the County Recorder") and
#   `Wildwood` (a park in Stearns County) as counties in a bill considered and rejected.
# * The same pattern truncated `Apple Valley` to `Apple` and `Mendota Heights` to
#   `Mendota`, because a non-greedy name match stops at the first capitalised word.
# * `Forest Lake` is followed in the bill text by `[deleted: …]` revision markup, so an
#   end-anchor allowing only ordinary prose silently dropped it and returned 13 of 14.
# * SF 3551 names **15** school districts but funds **11**. The other four appear for a
#   fund transfer or a separate demonstration grant, so "which districts are named" and
#   "which districts get this money" are different questions with different answers.
#   The fixture asks the second, and the pattern requires the dollar figure.
#
# **The rule those four share, and the one to read before writing a new pattern here:
# a derived denominator stops a *stale* list and does nothing about a *wrong* one.
# Derive, then verify, then assert exactly.** A lower bound cannot catch an off-by-one
# in a denominator (#900), and a pattern cannot tell you it counted the wrong thing.
#
# The sharpest version of "wrong" is not a broken regex — it is **a plausible regex
# over the wrong noun.** Two bills were nearly added to this registry on the strength
# of naming twenty and fourteen counties; reading the matches showed the counties were
# *locations* ("the land is located in Becker County", "restoration project in
# Cottonwood County") and only four were recipients of anything. A gate built on that
# denominator would have measured whether an answer lists places a bill mentions, while
# reporting itself as measuring whether the answer lists who gets the money. Every
# individual match was correct; the noun was wrong. Only reading them catches it.


@dataclass(frozen=True)
class EnumerationCase:
    """One bill, one shape of thing it names, and how many of them there are.

    ``expected`` is asserted **exactly** rather than as a bound, and ``exemplars`` are
    recipients no reasonable reading excludes, so a test fails on a regression rather
    than on a definitional argument.
    """

    bill_key: str
    shape: str
    question_asks: str
    pattern: re.Pattern[str]
    expected: int
    exemplars: tuple[str, ...]

    def found_in(self, bill_text: str) -> frozenset[str]:
        return frozenset(m.group(1).strip() for m in self.pattern.finditer(bill_text))


# A recipient name may carry lowercase connectors (Lake of the Woods) and may be
# followed by revision markup rather than prose, so the end-anchor allows a bracket.
_RECIPIENT_NAME = r"[A-Z][A-Za-z.'’-]*(?:\s+(?:[A-Z][A-Za-z.'’-]*|of|the))*?"
_ENDS = r"(?=\s+(?:for|to|in|and)\b|\s*[\[,.;])"

ENUMERATION_CASES: tuple[EnumerationCase, ...] = (
    EnumerationCase(
        bill_key="94-2025-HF719",
        shape="cities",
        question_asks="which cities and counties get named infrastructure grants",
        pattern=_GRANT_CITY_RE,
        expected=98,
        exemplars=HF719_GRANT_CITIES,
    ),
    EnumerationCase(
        bill_key="94-2025-HF719",
        shape="counties",
        question_asks="which cities and counties get named infrastructure grants",
        pattern=_GRANT_COUNTY_RE,
        expected=17,
        exemplars=HF719_GRANT_COUNTIES,
    ),
    EnumerationCase(
        bill_key="94-2025-HF2484",
        shape="cities",
        question_asks="which cities get grants",
        pattern=re.compile(
            rf"grants?\s+to\s+the\s+city\s+of\s+({_RECIPIENT_NAME}){_ENDS}"
        ),
        expected=14,
        # Two multi-word names and the one followed by revision markup, because those
        # are the three the pattern got wrong before it was verified.
        exemplars=("Apple Valley", "Mendota Heights", "Forest Lake", "Anoka"),
    ),
    EnumerationCase(
        bill_key="94-2026-SF3551",
        shape="school districts",
        question_asks="which school districts get supplemental funding, and how much",
        # The dollar figure is part of the pattern on purpose: it is what separates the
        # 11 districts this money goes to from the 4 named for other reasons.
        pattern=re.compile(
            r"\$[\d,]+\s+for\s+Independent\s+School\s+District\s+No\.\s*(\d+)"
        ),
        expected=11,
        exemplars=("13", "535", "695"),
    ),
)


def enumeration_cases_for(bill_key: str) -> tuple[EnumerationCase, ...]:
    return tuple(c for c in ENUMERATION_CASES if c.bill_key == bill_key)


def names_from(candidates: set[str], answer: str) -> set[str]:
    """Which of ``candidates`` the answer actually names. Evidence, not a verdict.

    A literal match on a proper noun is about as safe as machine checking gets —
    there is no paraphrase of "Lake Benton" — so unlike ``covers``, this one does
    not need a judge behind it.

    **Three of HF 719's recipient names sit inside another one**: St. Paul inside
    South St. Paul and West St. Paul, Benton inside Lake Benton, Minnetonka inside
    Minnetonka Beach. A plain substring test credits the short name every time the
    long one appears, so an answer naming only Lake Benton is recorded as having
    named Benton too, and the recall figure reads higher than the answer earned.
    Measured on the re-run's own answers, that inflated three of the four arms
    checked by exactly one name each.

    So the longest names are matched first and each match is *consumed*: a short
    name then counts only where it appears somewhere the long one did not. Word
    boundaries as well, so a city called Grant is not found in the word "grants".
    """
    remaining = answer
    found = set()
    for name in sorted(candidates, key=len, reverse=True):
        pattern = re.compile(rf"\b{re.escape(name)}\b", re.IGNORECASE)
        if pattern.search(remaining):
            found.add(name)
            # Blank out what this name claimed, so a shorter name nested inside it
            # cannot claim the same characters over again.
            remaining = pattern.sub(" ", remaining)
    return found
