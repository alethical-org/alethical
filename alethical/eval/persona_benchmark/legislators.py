"""The three legislators in the pilot, and why each was picked.

Selected by querying the local Postgres fixture (loaded by
``scripts/load_sample_data.py`` from ``alethical/tests/fixtures/`` — a real,
checked-in snapshot of actual Minnesota House/Senate records, not synthetic
data; ``house-member-15518.json`` and ``senate-member-10002.json`` are two of
those fixture files, and their filenames are the same real member IDs used
below) for sponsorship/vote/committee counts per legislator, then checking
each candidate's official House/Senate page for a real first-person quote
archive. See the benchmark report for the full stratification query.

All three IDs, party labels, and profile URLs below were independently
verified with a live fetch of the cited page on 2026-08-15, not copied from
the database without checking — see the "verified" note on each entry. One
mismatch surfaced doing this: the fixture's stored
``legislator_service_period.profile_url`` for Schultz
(house.mn.gov/members/profile/15624) actually resolves to a different real
legislator (Rep. Natalie Zeleznikar), so it is not used below. The correct
profile ID (15597) was instead confirmed from the byline on his own press
releases. This is flagged again in the benchmark report as a discovered data
gap, not silently corrected in the database.
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass


@dataclass(frozen=True)
class LegislatorProfile:
    id: uuid.UUID
    full_name: str
    party: str
    chamber: str
    profile_url: str
    selection_reason: str
    style_corpus_available: bool


# Isaac Schultz (R) -- quote-rich, distinctive/combative style. Chief-authored
# 3 bills, co-authored 47 more, 51 vote records, 0 committee memberships in
# the fixture. Also the current hardcoded ISAAC_SCHULTZ_ID demo legislator in
# legislator_chat.py, so Baseline A for this legislator is literally today's
# production demo behavior.
SCHULTZ = LegislatorProfile(
    id=uuid.UUID("da8ee5cc-0f9d-4854-b5bc-1b0fd8307f78"),
    full_name="Isaac Schultz",
    party="R",
    chamber="house",
    profile_url="https://www.house.mn.gov/members/profile/15597",
    selection_reason=(
        "quote-rich, distinctive/combative rhetorical style; richest sponsorship+vote "
        "record in the fixture; is the existing hardcoded demo legislator"
    ),
    style_corpus_available=True,
)

# Michael Howard (DFL) -- quote-rich, but a measured/coalition-building style
# rather than an obviously colorful one: the contrast case for whether style
# transfer only works on "loud" voices. 1 co-authored sponsorship in the
# fixture, 53 vote records, 3 committee memberships (Housing Finance and
# Policy, Taxes, Rules and Legislative Administration).
HOWARD = LegislatorProfile(
    id=uuid.UUID("498f83f6-5b27-4bab-9b26-464719a46606"),
    full_name="Michael Howard",
    party="DFL",
    chamber="house",
    profile_url="https://www.house.mn.gov/members/profile/15518",
    selection_reason=(
        "quote-rich but a less obviously distinctive, measured/coalition-oriented "
        "style; has real committee-membership data unlike Schultz"
    ),
    style_corpus_available=True,
)

# Jim Abeler (R, Senate) -- quote-poor on his own official channel: no
# press-release archive was found on senate.mn. He does have real
# legislative data (53 vote records, 4 committee memberships across
# Education Policy, Health and Human Services, Housing and Homelessness
# Prevention, and Human Services) despite 0 sponsorships in the fixture.
# News outlets have quoted him (e.g. a letter to a federal official on
# immigration enforcement), but those are not his own official channel, so
# per "prefer primary/official sources" they are deliberately excluded from
# the style-exemplar corpus rather than substituted in. His style corpus is
# therefore empty by design -- Condition B for Abeler has nothing to inject
# and must fall back to Condition A's behavior. That fallback is itself the
# test case for this legislator, not a limitation to work around.
ABELER = LegislatorProfile(
    id=uuid.UUID("d40983e1-b739-4d1f-853c-8473e6df38c7"),
    full_name="Jim Abeler",
    party="R",
    chamber="senate",
    profile_url="https://www.senate.mn/members/member_bio.html?leg_id=10002",
    selection_reason=(
        "quote-poor on official channels but data-rich on votes/committees; tests "
        "whether Variant B degrades safely to Baseline A when no exemplars exist"
    ),
    style_corpus_available=False,
)

PILOT_LEGISLATORS: tuple[LegislatorProfile, ...] = (SCHULTZ, HOWARD, ABELER)
