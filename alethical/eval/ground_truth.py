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

Counted independently twice, from ``bill_version_section.raw_text`` for HF 719's
current version (48 sections, 15,430 words) on Jul 31 2026, once by this session and
once by the #868 session, agreeing on both figures:

* ``grant(s) to the city of X`` matches **98** distinct cities. A looser scan of
  every ``grant(s) to …`` clause reaches ~104, picking up recipients not phrased
  "the city of X" (Lakeville, Austin, Cottage Grove, Moorhead, Hugo, Lake Elmo,
  Sauk Rapids, Mahnomen, Fairmont, Grant).
* ``grant(s) to X County`` matches **17** counties. Including other phrasings and
  the Moorhead-Clay joint-powers body reaches ~21, of which ~20 are real counties.
"""

from __future__ import annotations

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
