"""Propose which Minnesota campaign committee belongs to which legislator (#1354).

Suggestions only. Nothing in this module writes anything, and nothing here decides a
match. Minnesota gives every registered filer a registration number but never links it
to a person, so the only available evidence is the committee's published name, and
`docs/architecture/campaign-finance-system-design.md` §5 (Identity) forbids turning that
evidence into an automatic link: **a candidate joins an Alethical legislator only through
a link a person has checked.**

Why the rules below are deliberately timid rather than clever. Attaching the wrong
committee publishes someone else's money under a legislator's name, which is the worst
error this product can make, so the tiers are built so that every case where the evidence
could plausibly point at two people lands in front of a reviewer. The retired system's
failure was the opposite mistake in the opposite direction — it compared names exactly, so
"Messinger, Alida" and "Messinger, Alida R" were two different people
(`docs/research/base44-campaign-finance-findings.md` §6). Loosening exact comparison into
automatic matching trades one wrong answer for another, so this loosens it only into a
*proposal*.

Measured against the 11 Aug 2026 contributions download and production's 200 sitting
members. Facts the rules depend on, each checked rather than assumed:

* Candidate committees are the rows whose ``Recipient type`` is ``PCC``: 1,732 of 2,783
  committees. The " Committee" name suffix does **not** identify them — 51 political funds
  end in it too ("MAFMIC Political Action Committee"), which is why the type column is
  what this module reads (§5 says the same for the number's numeric range).
* Names read ``Surname, Given [Middle] <Office> Committee``. The office vocabulary is
  closed and short: House 1,078, Senate 473, Dist Court 54, Gov 66, Atty Gen 18, State Aud
  17, Sec of State 11, Sup Court 11, App Court 2. **2 carry no office at all**
  ("Reyes, Peter M Jr Committee", "Brown, Anthony L Committee"), so its absence is handled
  rather than assumed away.
* Within one download every registration number carries exactly one name (2,783 numbers,
  2,783 distinct name pairings). A committee that renames between years is therefore
  invisible in a snapshot: the Board publishes the committee's *current* name against all
  of its history. That is why the confirmed link stores the number and keeps the name only
  as a note about what the reviewer read.
* The file often supplies the nickname itself, in parentheses on 92 committees
  ("Baker, David (Dave)") and in quotes on 5 ("Gordon, James \\"Jimmy\\""). A nickname the
  source publishes is evidence; a nickname this module guessed would not be, which is why
  there is no nickname table here.
"""

from __future__ import annotations

import csv
import enum
import re
import unicodedata
from collections.abc import Iterable, Iterator, Sequence
from dataclasses import dataclass, field

CANDIDATE_COMMITTEE_TYPE = "PCC"
"""The ``Recipient type`` of a candidate's principal campaign committee."""

# Longest first, so "Sup Court" is not read as bare "Court" and "State Aud" is not read as
# a middle name. Every value is a phrase the 11 Aug 2026 download actually publishes.
OFFICE_SUFFIXES: tuple[str, ...] = (
    "Sec of State",
    "Dist Court",
    "Sup Court",
    "App Court",
    "State Aud",
    "Atty Gen",
    "Senate",
    "House",
    "Gov",
)

# The two offices a sitting member of the Minnesota Legislature holds. Every other office
# in the vocabulary above is a race for something else, which is a real thing a legislator
# may have run for and also the easiest way to pick up a stranger of the same name.
LEGISLATIVE_OFFICES: dict[str, str] = {"House": "house", "Senate": "senate"}

# Generational suffixes, which Minnesota puts on **either side of the comma**: on the
# surname in "Holmstrom Jr, Michael Senate Committee", and on the given name in
# "Backer, Jeff W Jr House Committee". 10 committees carry one on the surname and 12 on the
# given name, so both sides are checked. Spelling varies within one file ("Larson Jr,
# Calvin" and "Larson Jr., Calvin" are one person's two committees), so the period is
# optional.
#
# "V" is deliberately absent. It is far more often a middle initial than "the fifth":
# every "V" in the 11 Aug 2026 file is one ("Nelson, Michael V", "Lindstrom, Brent V"), and
# treating it as a suffix would strip a real initial and, worse, flag a clean name as
# needing extra scrutiny for a reason that is not true.
GENERATIONAL_SUFFIX_PATTERN = re.compile(
    r"\s+(Jr|Sr|II|III|IV)\.?$", flags=re.IGNORECASE
)

# Titles production stores inside a name. 67 Senate rows read "Senator Erin K. Maye Quade"
# in both full_name and sort_name, so a title has to come off before any comparison.
TITLE_PREFIX_PATTERN = re.compile(
    r"^(Senator|Sen\.?|Representative|Rep\.?)\s+", flags=re.IGNORECASE
)

# "James (Jamie)" and 'James "Jimmy"' — a nickname the Board itself published.
PUBLISHED_NICKNAME_PATTERN = re.compile(r"[(\"]([^)\"]+)[)\"]")


# Party units whose own registered name says which party they are. Minnesota's are named
# "Cass County RPM" (Republican Party of Minnesota) and "44th Senate District DFL", so the
# affiliation is stated by the filer rather than inferred by us. Nothing else is
# classified: 69 of the 568 filers the file types as a "Party Unit" are plainly not party
# units at all ("Xcel Energy Employees PAC", "MN TruckPAC"), and named caucus committees
# like "HRCC" and "Senate Victory Fund" would need us to assert an affiliation the file
# never states, which is the kind of unsourced claim `.claude/rules/grounded-answers.md`
# rule 3 forbids.
PARTY_UNIT_NAME_PATTERNS: tuple[tuple[str, re.Pattern[str]], ...] = (
    ("DFL", re.compile(r"\bDFL\b", flags=re.IGNORECASE)),
    ("R", re.compile(r"\bRPM\b|\bRepublican\b", flags=re.IGNORECASE)),
)


class GivenNameEvidence(enum.Enum):
    """How a committee's given name relates to a legislator's, strongest first.

    Only ``exact`` and ``published_nickname`` are ever strong enough to carry a proposal
    on their own, because only those two are things the source states. Everything below
    them is this module's inference about how people shorten names, and an inference is
    exactly what a person is being asked to check.
    """

    exact = "exact"
    published_nickname = "published_nickname"
    shortened = "shortened"
    middle_name = "middle_name"
    initial = "initial"
    surname_only = "surname_only"


SOURCE_STATED_GIVEN_NAME_EVIDENCE = frozenset(
    {GivenNameEvidence.exact, GivenNameEvidence.published_nickname}
)


class ProposalTier(enum.Enum):
    """How much reading a proposal needs before a person can answer it.

    Neither tier is a decision. ``strong`` means one committee met every source-stated
    test and nothing else competed for it, so a reviewer can check the name and answer.
    ``review`` means at least one signal is this module's inference, or more than one
    committee is in play, so the reviewer has to read the alternatives before answering.
    """

    strong = "strong"
    review = "review"


@dataclass(frozen=True)
class CommitteeRecord:
    """One candidate committee as the source publishes it.

    Deliberately not tied to any table. Today the caller reads these out of a downloaded
    contributions file; when the loader of
    [#1328](https://github.com/alethical-org/alethical/issues/1328) lands, the same records
    come off its imported rows and nothing in this module changes.
    """

    registration_number: str
    name: str
    recipient_type: str
    first_year: str | None = None
    last_year: str | None = None
    contribution_rows: int = 0

    @property
    def is_candidate_committee(self) -> bool:
        return self.recipient_type == CANDIDATE_COMMITTEE_TYPE


@dataclass(frozen=True)
class RosterMember:
    """One sitting legislator, as production stores them.

    ``first_name`` and ``last_name`` are taken as a hint rather than as truth: production
    splits "Scott Van Binsbergen" into first "Scott Van" and last "Binsbergen", and
    "Erin K. Maye Quade" into first "Erin K. Maye" and last "Quade", while the Board files
    both surnames whole ("Van Binsbergen, Scott", "Maye Quade, Erin"). So the surname keys
    below are generated from every split of the full name, and the stored split is only one
    of them.
    """

    legislator_id: str
    full_name: str
    chamber_slug: str
    first_name: str | None = None
    last_name: str | None = None
    district: str | None = None
    party: str | None = None


@dataclass(frozen=True)
class ParsedCommitteeName:
    surname: str
    given: str
    office: str | None
    published_nickname: str | None
    generational_suffix: str | None


@dataclass(frozen=True)
class Proposal:
    """One committee suggested for one legislator, with what the suggestion rests on."""

    committee: CommitteeRecord
    parsed: ParsedCommitteeName
    tier: ProposalTier
    given_name_evidence: GivenNameEvidence
    office_matches_chamber: bool
    active_in_current_years: bool
    reasons: tuple[str, ...]
    party_of_party_unit_money: str | None = None
    party_agrees: bool | None = None


@dataclass
class LegislatorProposals:
    """Every proposal for one legislator, plus what was ruled out and why."""

    member: RosterMember
    proposals: list[Proposal] = field(default_factory=list)
    suppressed_surname_only: int = 0
    no_surname_match: bool = False

    @property
    def outcome(self) -> str:
        """``matched`` / ``ambiguous`` / ``unmatched`` — the coverage vocabulary of #1354.

        ``matched`` here means "one committee is proposed and nothing competes with it",
        never "this legislator is linked". A link exists only once a person confirms it.
        """
        if not self.proposals:
            return "unmatched"
        if len(self.proposals) == 1 and self.proposals[0].tier is ProposalTier.strong:
            return "matched"
        return "ambiguous"

    @property
    def unresolved_reason(self) -> str:
        """Why this legislator has no confirmed link yet, in words a reviewer can act on.

        Always a sentence, including for a ``matched`` legislator: a strong proposal is
        still unconfirmed, and reporting it with no reason at all would read as though the
        proposer had nothing to say about a case it had in fact resolved as far as it can.
        """
        if self.no_surname_match:
            return "no committee shares this surname"
        if not self.proposals:
            return "committees share the surname but no given name is close enough"
        if self.outcome == "matched":
            return "one committee proposed and nothing competing; awaiting confirmation"
        if len(self.proposals) > 1:
            return f"{len(self.proposals)} committees are plausible"
        return "the one plausible committee rests on an inferred name or a different office"


def strip_accents(value: str) -> str:
    decomposed = unicodedata.normalize("NFKD", value)
    return "".join(ch for ch in decomposed if not unicodedata.combining(ch))


def normalize_name_part(value: str | None) -> str:
    """Fold a name fragment to comparable words.

    Accents go (so "Pérez" and "Perez" are one name), case goes, and every punctuation
    mark becomes a space — which is what makes "Larson Jr." and "Larson Jr" comparable,
    and "de la Paz" and "De La Paz" one surname.
    """
    if not value:
        return ""
    folded = strip_accents(value).lower()
    return " ".join(re.sub(r"[^a-z0-9]+", " ", folded).split())


def _strip_title(value: str) -> str:
    return TITLE_PREFIX_PATTERN.sub("", value.strip(), count=1)


def parse_committee_name(name: str) -> ParsedCommitteeName:
    """Split ``Surname, Given <Office> Committee`` into its parts.

    Every part is optional except the surname, because the file proves each one can be
    absent: 2 committees carry no office, and a name with no comma would leave no given
    name. Nothing here raises; an unparseable shape yields a record that simply matches
    nobody, which is the safe direction.
    """
    stem = name.strip()
    if stem.endswith(" Committee"):
        stem = stem[: -len(" Committee")]

    office: str | None = None
    for candidate in OFFICE_SUFFIXES:
        if stem.endswith(" " + candidate):
            office = candidate
            stem = stem[: -(len(candidate) + 1)]
            break

    surname_part, _, given_part = stem.partition(",")
    surname_part = surname_part.strip()
    given_part = given_part.strip()

    generational_suffix = None
    suffix_match = GENERATIONAL_SUFFIX_PATTERN.search(surname_part)
    if suffix_match:
        generational_suffix = suffix_match.group(1)
        surname_part = surname_part[: suffix_match.start()].strip()

    # The nickname comes off before the given name's own suffix is looked for, because
    # 'Scott, Ulric "Todd" C III' puts the nickname between the two.
    nickname_match = PUBLISHED_NICKNAME_PATTERN.search(given_part)
    published_nickname = nickname_match.group(1).strip() if nickname_match else None
    if nickname_match:
        given_part = " ".join(PUBLISHED_NICKNAME_PATTERN.sub(" ", given_part).split())

    given_suffix_match = GENERATIONAL_SUFFIX_PATTERN.search(given_part)
    if given_suffix_match:
        generational_suffix = generational_suffix or given_suffix_match.group(1)
        given_part = given_part[: given_suffix_match.start()].strip()

    return ParsedCommitteeName(
        surname=surname_part,
        given=given_part,
        office=office,
        published_nickname=published_nickname,
        generational_suffix=generational_suffix,
    )


def surname_keys(member: RosterMember) -> set[str]:
    """Every surname this legislator's name could reasonably be filed under.

    Production's own first/last split is one candidate, not the answer: it puts the "Van"
    of "Scott Van Binsbergen" in the first name and the "Maye" of "Erin K. Maye Quade" in
    the first name, while the Board files both surnames whole. So every trailing run of
    the full name's words is offered as a surname, and a committee filed under any of them
    is a candidate. Over-generating here is safe — a wrong key finds no committee — while
    under-generating loses a legislator silently.
    """
    keys: set[str] = set()
    stored = normalize_name_part(member.last_name)
    if stored:
        keys.add(stored)

    words = normalize_name_part(_strip_title(member.full_name)).split()
    # A surname is one of the trailing words; leave at least one word as the given name.
    for start in range(1, len(words)):
        keys.add(" ".join(words[start:]))
    return {key for key in keys if key}


def given_name_words(member: RosterMember) -> list[str]:
    """The legislator's given words, in the order a person would say them.

    Read off the full name rather than the stored first name, and with the surname words
    removed, so a bad stored split cannot drop a word. "Erin K. Maye Quade" yields
    ``["erin", "k", "maye"]`` against the surname "quade", and ``["erin", "k"]`` against
    the surname "maye quade" — which is why the caller compares against the whole list.
    """
    words = normalize_name_part(_strip_title(member.full_name)).split()
    stored_surname = normalize_name_part(member.last_name).split()
    if stored_surname and words[-len(stored_surname) :] == stored_surname:
        words = words[: -len(stored_surname)]
    return words


def _is_shortened(short: str, long: str) -> bool:
    """True when ``short`` looks like ``long`` cut off: Pam/Pamela, Liz/Lizabeth.

    Three letters is the floor because two would make "Jo" a shortening of "John",
    "Joseph", "Joanne" and "Jordan" at once. This is an inference either way, which is
    why a hit here can never carry a proposal on its own.
    """
    if len(short) < 3 or len(long) <= len(short):
        return False
    return long.startswith(short)


def classify_given_name(
    parsed: ParsedCommitteeName, member_given_words: Sequence[str]
) -> GivenNameEvidence:
    """How the committee's given name relates to the legislator's.

    Checked strongest first, and the two source-stated kinds are checked before any
    inference so that "Baker, David (Dave)" is recorded as a nickname the Board published
    rather than as this module's guess.
    """
    if not member_given_words:
        return GivenNameEvidence.surname_only

    committee_words = normalize_name_part(parsed.given).split()
    committee_first = committee_words[0] if committee_words else ""
    member_first = member_given_words[0]
    nickname = normalize_name_part(parsed.published_nickname)

    if committee_first and committee_first == member_first:
        return GivenNameEvidence.exact
    if nickname and nickname == member_first:
        return GivenNameEvidence.published_nickname
    if committee_first and (
        _is_shortened(member_first, committee_first)
        or _is_shortened(committee_first, member_first)
    ):
        return GivenNameEvidence.shortened
    # The legislator goes by a middle name the Board files second: production's
    # "Bjorn Olson" is the Board's "Olson, Christian Bjorn", and "Liz Lee" is
    # "Lee, Kaozouapa Elizabeth".
    for word in committee_words[1:]:
        if word == member_first or _is_shortened(member_first, word):
            return GivenNameEvidence.middle_name
    # A single letter matching a first initial. Weak on purpose: one letter separates
    # nobody in a surname pool the size of Johnson's 31 committees.
    if len(committee_first) == 1 and member_first.startswith(committee_first):
        return GivenNameEvidence.initial
    if len(member_first) == 1 and committee_first.startswith(member_first):
        return GivenNameEvidence.initial
    return GivenNameEvidence.surname_only


def classify_party_unit_name(contributor: str) -> str | None:
    """Which party a contributing party unit says it belongs to, or None.

    A name naming both parties, or neither, yields None. This is identity evidence and
    nothing more: that a county party gave money to a committee helps say *whose*
    committee it is. It never says the money bought anything, which
    `.claude/rules/grounded-answers.md` rule 3 forbids asserting.
    """
    hits = {
        party for party, pattern in PARTY_UNIT_NAME_PATTERNS if pattern.search(contributor)
    }
    return hits.pop() if len(hits) == 1 else None


def _years_overlap(committee: CommitteeRecord, current_years: Sequence[str]) -> bool:
    if not current_years or committee.first_year is None or committee.last_year is None:
        return False
    return committee.first_year <= max(current_years) and committee.last_year >= min(
        current_years
    )


def propose_for_member(
    member: RosterMember,
    committees_by_surname: dict[str, list[tuple[CommitteeRecord, ParsedCommitteeName]]],
    *,
    current_years: Sequence[str],
    contested_registrations: frozenset[str] = frozenset(),
    party_by_registration: dict[str, str] | None = None,
    max_surname_only: int = 6,
) -> LegislatorProposals:
    """Suggest the committees that could belong to one legislator.

    The four things that hold a proposal down to ``review``, each of them a case the
    11 Aug 2026 data actually contains:

    * **The given name is this module's inference.** "Liish Kozlowski" is the Board's
      "Kozlowski, Alicia" — no rule reaches that, and a rule loose enough to try would
      reach wrong answers elsewhere.
    * **The office is not the chamber the legislator sits in.** Liz Reyer sits in the
      House and has two committees: "Reyer, Lizabeth House Committee" (382 rows) and
      "Reyer, Liz Senate Committee" (45 rows). Filtering to her own chamber would have
      dropped the Senate one; filtering to her spelled first name would have dropped the
      House one, which is the larger. So office is shown to the reviewer, never used to
      discard.
    * **A generational suffix appears on one side only.** "Holmstrom Jr, Michael" against
      our "Michael W. Holmstrom" is very probably the same man, and a Jr and a Sr of one
      name is precisely the confusion this whole design exists to avoid.
    * **Another sitting legislator could claim the same committee.** Checked in the
      caller and passed in, because it cannot be seen from one legislator's row.

    A legislator with more than one surviving candidate is never ``matched``, whatever the
    evidence: "Gottfried, David House Committee" exists twice under two registration
    numbers, and "Wiener, Michael" exists as both a House and a Senate committee.

    One further check comes from a different column of the same file, so it is independent
    of every name rule above: which party's units gave the committee money. Across the 125
    committees these rules proposed on the 11 Aug 2026 download, 115 carry party-unit money
    and its party agreed with our own record on **all 115**, with 0 disagreements. So a
    disagreement is a real signal that the name matched a stranger, and it holds the
    proposal down to ``review``. Agreement is recorded as support and changes no tier,
    because a right answer for a wrong reason is still a wrong reason.
    """
    result = LegislatorProposals(member=member)
    seen: set[str] = set()
    pairs: list[tuple[CommitteeRecord, ParsedCommitteeName]] = []
    for key in surname_keys(member):
        for committee, parsed in committees_by_surname.get(key, ()):
            if committee.registration_number in seen:
                continue
            seen.add(committee.registration_number)
            pairs.append((committee, parsed))

    if not pairs:
        result.no_surname_match = True
        return result

    member_given = given_name_words(member)
    expected_office = next(
        (
            office
            for office, slug in LEGISLATIVE_OFFICES.items()
            if slug == member.chamber_slug
        ),
        None,
    )

    scored: list[Proposal] = []
    surname_only: list[Proposal] = []
    for committee, parsed in pairs:
        evidence = classify_given_name(parsed, member_given)
        office_matches = parsed.office is not None and parsed.office == expected_office
        active = _years_overlap(committee, current_years)

        reasons: list[str] = []
        if evidence not in SOURCE_STATED_GIVEN_NAME_EVIDENCE:
            reasons.append(f"given name is inferred ({evidence.value})")
        if parsed.office is None:
            reasons.append("the committee name states no office")
        elif not office_matches:
            reasons.append(f"committee is for {parsed.office}, not {expected_office}")
        if parsed.generational_suffix:
            reasons.append(
                f"the committee name carries {parsed.generational_suffix} "
                "and our record does not"
            )
        if not active:
            reasons.append("no contributions in the current session's years")
        if committee.registration_number in contested_registrations:
            reasons.append("another sitting legislator could also claim this committee")

        money_party = (party_by_registration or {}).get(committee.registration_number)
        party_agrees: bool | None = None
        if money_party and member.party:
            party_agrees = money_party == member.party
            if not party_agrees:
                reasons.append(
                    f"party units giving to this committee are {money_party}, "
                    f"and we record this legislator as {member.party}"
                )

        tier = ProposalTier.strong if not reasons else ProposalTier.review
        proposal = Proposal(
            committee=committee,
            parsed=parsed,
            tier=tier,
            given_name_evidence=evidence,
            office_matches_chamber=office_matches,
            active_in_current_years=active,
            reasons=tuple(reasons),
            party_of_party_unit_money=money_party,
            party_agrees=party_agrees,
        )
        if evidence is GivenNameEvidence.surname_only:
            surname_only.append(proposal)
        else:
            scored.append(proposal)

    def rank(proposal: Proposal) -> tuple:
        return (
            proposal.tier is not ProposalTier.strong,
            list(GivenNameEvidence).index(proposal.given_name_evidence),
            not proposal.office_matches_chamber,
            not proposal.active_in_current_years,
            -proposal.committee.contribution_rows,
        )

    # A committee sharing only the surname is kept when it is still active, because that
    # is the shape of every unmappable nickname ("Kozlowski, Alicia" for "Liish
    # Kozlowski"). Stale namesakes are dropped and *counted*: silently truncating a
    # surname pool the size of Johnson's 31 would read as "we looked at everything".
    surname_only.sort(key=rank)
    kept_surname_only = [p for p in surname_only if p.active_in_current_years]
    result.suppressed_surname_only = len(surname_only) - len(kept_surname_only)
    if len(kept_surname_only) > max_surname_only:
        result.suppressed_surname_only += len(kept_surname_only) - max_surname_only
        kept_surname_only = kept_surname_only[:max_surname_only]

    result.proposals = sorted(scored + kept_surname_only, key=rank)

    # One strong proposal beside anything else is not strong. Two committees can carry the
    # same name in the same office ("Gottfried, David House Committee", twice), so the
    # existence of a second candidate is itself a reason for a person to look.
    if len(result.proposals) > 1:
        result.proposals = [
            proposal
            if proposal.tier is not ProposalTier.strong
            else Proposal(
                **{
                    **proposal.__dict__,
                    "tier": ProposalTier.review,
                    "reasons": proposal.reasons
                    + (
                        f"{len(result.proposals)} committees are plausible "
                        "for this legislator",
                    ),
                }
            )
            for proposal in result.proposals
        ]
    return result


def index_committees_by_surname(
    committees: Iterable[CommitteeRecord],
) -> dict[str, list[tuple[CommitteeRecord, ParsedCommitteeName]]]:
    """Group candidate committees under their normalized surname.

    Non-candidate filers are dropped here rather than filtered by the caller, so a party
    unit or a political fund can never reach a legislator's proposal list.
    """
    index: dict[str, list[tuple[CommitteeRecord, ParsedCommitteeName]]] = {}
    for committee in committees:
        if not committee.is_candidate_committee:
            continue
        parsed = parse_committee_name(committee.name)
        key = normalize_name_part(parsed.surname)
        if not key:
            continue
        index.setdefault(key, []).append((committee, parsed))
    return index


def find_contested_registrations(
    members: Sequence[RosterMember],
    committees_by_surname: dict[str, list[tuple[CommitteeRecord, ParsedCommitteeName]]],
) -> frozenset[str]:
    """Committees that more than one sitting legislator has a name-based claim on.

    Cannot be seen from one legislator's row, which is why it is computed across the whole
    roster and fed back in. Only source-stated name evidence counts as a claim: were an
    inferred shortening enough, two sitting members with one surname would contest each
    other's committees constantly and nothing would ever be proposed.
    """
    claims: dict[str, set[str]] = {}
    for member in members:
        member_given = given_name_words(member)
        for key in surname_keys(member):
            for committee, parsed in committees_by_surname.get(key, ()):
                evidence = classify_given_name(parsed, member_given)
                if evidence in SOURCE_STATED_GIVEN_NAME_EVIDENCE:
                    claims.setdefault(
                        committee.registration_number, set()
                    ).add(member.legislator_id)
    return frozenset(
        registration for registration, owners in claims.items() if len(owners) > 1
    )


def propose_all(
    members: Sequence[RosterMember],
    committees: Iterable[CommitteeRecord],
    *,
    current_years: Sequence[str],
    party_by_registration: dict[str, str] | None = None,
    max_surname_only: int = 6,
) -> list[LegislatorProposals]:
    """Proposals for every legislator. Writes nothing and decides nothing."""
    index = index_committees_by_surname(committees)
    contested = find_contested_registrations(members, index)
    return [
        propose_for_member(
            member,
            index,
            current_years=current_years,
            contested_registrations=contested,
            party_by_registration=party_by_registration,
            max_surname_only=max_surname_only,
        )
        for member in members
    ]


def coverage_counts(results: Sequence[LegislatorProposals]) -> dict[str, int]:
    """Matched / ambiguous / unmatched, as #1354 asks for them.

    These count *proposals*, not links. A separate count of confirmed links comes from the
    table, because the two numbers answer different questions: this one says how much the
    proposer could narrow down, that one says how much a person has actually checked.
    """
    counts = {"matched": 0, "ambiguous": 0, "unmatched": 0}
    for result in results:
        counts[result.outcome] += 1
    counts["total"] = len(results)
    return counts


def read_contributions_csv(
    path: str,
) -> tuple[list[CommitteeRecord], dict[str, str]]:
    """Read the committees and their party-unit money out of a contributions download.

    Returns the distinct committees and, separately, which party's units gave each
    committee the most money. Both in one pass, because the file is 82.6 MB and the two
    facts come from opposite ends of the same row: the recipient columns say who the
    committee is, the contributor column says who paid it.

    Parsed with Python's default reader and ``newline=""`` and nothing else, which
    `campaign-finance-system-design.md` §2.1 (Campaign finance) establishes is the only
    setting that keeps every row in every column: the Board escapes an inner quote with a
    backslash, so ``strict=True`` rejects 18 contribution records outright and
    ``escapechar`` damages 200 more.
    """
    seen: dict[str, dict] = {}
    party_money: dict[str, dict[str, float]] = {}
    csv.field_size_limit(10_000_000)
    with open(path, newline="", encoding="utf-8-sig") as handle:
        for row in csv.DictReader(handle):
            registration = (row.get("Recipient reg num") or "").strip()
            name = (row.get("Recipient") or "").strip()
            if not registration or not name:
                continue
            year = (row.get("Receipt date") or "")[:4] or (row.get("Year") or "").strip()
            entry = seen.setdefault(
                registration,
                {
                    "name": name,
                    "recipient_type": (row.get("Recipient type") or "").strip(),
                    "first_year": year or None,
                    "last_year": year or None,
                    "rows": 0,
                },
            )
            entry["rows"] += 1
            if year:
                if entry["first_year"] is None or year < entry["first_year"]:
                    entry["first_year"] = year
                if entry["last_year"] is None or year > entry["last_year"]:
                    entry["last_year"] = year

            party = classify_party_unit_name(row.get("Contributor") or "")
            if party:
                try:
                    amount = float(row.get("Amount") or 0)
                except ValueError:
                    amount = 0.0
                totals = party_money.setdefault(registration, {})
                totals[party] = totals.get(party, 0.0) + amount

    committees = [
        CommitteeRecord(
            registration_number=registration,
            name=entry["name"],
            recipient_type=entry["recipient_type"],
            first_year=entry["first_year"],
            last_year=entry["last_year"],
            contribution_rows=entry["rows"],
        )
        for registration, entry in seen.items()
    ]
    # The larger side wins rather than requiring unanimity: 2 of the 125 proposed
    # committees hold money from both parties' units, and in both the smaller side is a
    # single donation against a much larger own-party total.
    party_by_registration = {
        registration: max(totals, key=lambda party: totals[party])
        for registration, totals in party_money.items()
        if totals and max(totals.values()) > 0
    }
    return committees, party_by_registration
