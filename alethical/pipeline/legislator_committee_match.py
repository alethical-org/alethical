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

**A second source does the work names cannot.** The Board's registered-filer directory
(§9.7 of the design document) states each committee's own **office, district and party** —
none of which the payment files carry. That turns the hardest cases from a judgement about
spelling into a fact about a seat: a committee registered for House 12A is not the committee
of a member who sits in House 33A, and the Board is the one saying so. Measured 11 Aug 2026,
it takes the cases needing a person to read alternatives from **92 down to 56**, and every
one of the 56 that remain has two or more surviving committees — a choice about which of a
member's own committees to show, not a failure to identify them.

Its boundary, because it is narrower than it first looks: **a district separates a stranger
from another district, not a predecessor in the same one.** A member who held this seat
before, for this party, carries the same office, district and party as its current holder.
The directory's own ``Incumbent`` flag is what closes that, so seat agreement counts as
settled only when the Board also says this candidate holds the seat.

Read once and passed in, so this module stays free of network calls and every rule in it
remains testable from plain values.
"""

from __future__ import annotations

import csv
import enum
import re
import unicodedata
from collections.abc import Iterable, Sequence
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


class FilerVerdict(enum.Enum):
    """What the Board's directory says about a committee, relative to one legislator.

    Three outcomes, and the distance between the middle two is the whole point:

    * ``same_seat`` — registered for this member's own office **and** district **and**
      party, **and** flagged as the seat's current holder. The Board corroborating a name
      match on the field that actually identifies a legislator, which is stronger evidence
      than any spelling of a name.
    * ``same_seat_not_current`` — the seat and party agree but the Board does not say this
      candidate holds it, or the registration is closed. A predecessor in the same seat for
      the same party carries the same district as its current holder, so this is the one
      case where seat agreement is not identity. Not ruled out, because a member's own
      closed committee looks exactly like this, but never treated as settled either.
    * ``different_person`` — registered for a **different district in the same office**, or a
      different party in the same seat. Two people, stated by the source. Safe to rule out.
    * ``different_race`` — registered for a **different office**. Possibly the same person
      seeking something else, which is common and real, so never ruled out.
    * ``unknown`` — not in the directory. 1,057 of 1,732 candidate committees are not, so
      this is the ordinary case and carries no information at all.
    """

    same_seat = "same_seat"
    same_seat_not_current = "same_seat_not_current"
    different_person = "different_person"
    different_race = "different_race"
    unknown = "unknown"


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
class FilerRecord:
    """One committee as the Board's registered-filer directory describes it (§9.7).

    This is the source that answers what no name rule can: the directory states each
    committee's **own office, district and party**, none of which the payment files carry.
    A committee registered for House 12A is not the committee of a member who sits in House
    33A, and that is the Board saying so rather than us inferring it.

    ``district`` is absent on 49 of 777 rows (statewide races have no district), and
    ``party`` is present on all 777. Only 675 of the 1,732 candidate committees in the
    contributions file appear here at all, because the directory lists current registrations
    and an older committee falls off it — so **absence proves nothing** and is never read as
    evidence either way.
    """

    registration_number: str
    committee_name: str
    candidate_name: str
    office: str | None
    district: str | None
    party: str | None
    is_incumbent: bool
    is_terminated: bool


# The directory's office wording, mapped to the chamber slugs production stores. Its labels
# are spelled out where the committee names abbreviate them ("Senate" both ways, but
# "District Court" against the name suffix "Dist Court").
FILER_OFFICE_TO_CHAMBER: dict[str, str] = {"House": "house", "Senate": "senate"}

# How production spells a party against how the Board's directory spells it.
ROSTER_PARTY_TO_FILER_PARTY: dict[str, str] = {"DFL": "DFL", "R": "RPM", "RPM": "RPM"}


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
    filer_verdict: str = FilerVerdict.unknown.value


@dataclass
class LegislatorProposals:
    """Every proposal for one legislator, plus what was ruled out and why."""

    member: RosterMember
    proposals: list[Proposal] = field(default_factory=list)
    suppressed_surname_only: int = 0
    no_surname_match: bool = False
    # Committees the Board's own directory registers to a different person, kept so the
    # review screen can show what was discarded and on whose authority.
    ruled_out_by_directory: tuple[tuple[CommitteeRecord, FilerRecord], ...] = ()

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


def member_name_words(member: RosterMember) -> list[str]:
    """Every word of the legislator's name, title stripped, in the order a person says it."""
    return normalize_name_part(_strip_title(member.full_name)).split()


def given_name_words(member: RosterMember, surname_key: str | None = None) -> list[str]:
    """The legislator's given words, with the surname taken off.

    Which words count as the surname depends on **which key matched**, not on how
    production split the name. "Erin K. Maye Quade" yields ``["erin", "k", "maye"]``
    against the key "quade" and ``["erin", "k"]`` against the key "maye quade" — and that
    difference is the whole point, because the leftover "maye" in the first case is what
    tells us the key cut through a compound surname. With no key given, the stored last
    name is used, which is what the roster-wide contest check wants.
    """
    words = member_name_words(member)
    surname = normalize_name_part(surname_key or member.last_name).split()
    if surname and len(surname) < len(words) and words[-len(surname) :] == surname:
        return words[: -len(surname)]
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

    # Exact means the *words* agree, not that the first letters do. Comparing only the
    # first word made "Dibble, D Scott" and a hypothetical "Dibble, D Steven" equally exact
    # for Senator D. Scott Dibble, because both first words are "d" -- and a single letter
    # separates nobody. So a real name has to match a real name: at least one word of more
    # than one letter, present on both sides. Initials are then compared below, where they
    # count as the weak evidence they are. (Found by a Codex review, on this actual sitting
    # member; the match happens to be right today and the rule that produced it was not.)
    committee_real_words = {word for word in committee_words if len(word) > 1}
    member_real_words = {word for word in member_given_words if len(word) > 1}
    if committee_real_words & member_real_words and (
        committee_first == member_first
        or (len(committee_first) == 1 and len(member_first) == 1)
    ):
        return GivenNameEvidence.exact
    if nickname and nickname == member_first:
        return GivenNameEvidence.published_nickname
    if committee_first and (
        _is_shortened(member_first, committee_first)
        or _is_shortened(committee_first, member_first)
    ):
        return GivenNameEvidence.shortened
    # The legislator goes by a middle name the Board files second: production's
    # "Bjorn Olson" is the Board's "Olson, Christian Bjorn". Note this reaches fewer cases
    # than it looks like it should -- "Liz Lee" is the Board's "Lee, Kaozouapa Elizabeth",
    # and "Elizabeth" does not begin with "Liz", so she lands in ``surname_only`` and a
    # person reads her three same-surname committees. That is the right outcome; the point
    # here is that the rule is narrower than the example suggests.
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


def normalize_district(district: str | None) -> str:
    """Fold a district label so "05B" and "5B" compare equal.

    Production stores House districts zero-padded ("05B", "45B") and the Board's directory
    does not ("5B", "45B"). Comparing them raw silently matches nothing for the 9 single-digit
    House districts and both single-digit Senate ones.
    """
    return (district or "").strip().upper().lstrip("0")


def compare_to_filer_directory(
    member: RosterMember, filer: FilerRecord | None
) -> FilerVerdict:
    """Read what the directory says about this committee, for this legislator.

    The one judgement here that could lose real money if taken further: a committee for a
    **different office** is left alone. Liz Reyer sits in House 52A and her live registration
    is a Senate committee for district 52; ruling that out because the office differs would
    discard her own committee. Only a different *district within the same office*, or a
    different party in her own seat, is another person.
    """
    if filer is None:
        return FilerVerdict.unknown
    expected_chamber = FILER_OFFICE_TO_CHAMBER.get(filer.office or "")
    if expected_chamber is None or expected_chamber != member.chamber_slug:
        return FilerVerdict.different_race
    if normalize_district(filer.district) != normalize_district(member.district):
        return FilerVerdict.different_person
    expected_party = ROSTER_PARTY_TO_FILER_PARTY.get(member.party or "")
    if expected_party and filer.party and filer.party != expected_party:
        return FilerVerdict.different_person
    # The seat matching is not yet enough, and this is the boundary the design review named:
    # **a district separates a stranger from another district, but not a predecessor in the
    # same one.** A member who previously held this seat for this party carries the same
    # office, district and party as its current holder, so seat agreement alone cannot tell
    # them apart, and a same-surname predecessor is exactly the father-and-son case this
    # design exists to prevent.
    #
    # What closes it is the directory's own flag. Measured 11 Aug 2026, ``Incumbent`` marks
    # the current holder of the seat the row seeks — Liz Reyer's Senate registration reads 0
    # while she sits in the House — so a predecessor's row is not flagged for the seat its
    # successor now holds, and a closed committee carries a ``TerminationDate``. So the seat
    # only counts as settled when the Board is also saying this candidate holds it.
    if not filer.is_incumbent or filer.is_terminated:
        return FilerVerdict.same_seat_not_current
    return FilerVerdict.same_seat


def classify_party_unit_name(contributor: str) -> str | None:
    """Which party a contributing party unit says it belongs to, or None.

    A name naming both parties, or neither, yields None. This is identity evidence and
    nothing more: that a county party gave money to a committee helps say *whose*
    committee it is. It never says the money bought anything, which
    `.claude/rules/grounded-answers.md` rule 3 forbids asserting.
    """
    hits = {
        party
        for party, pattern in PARTY_UNIT_NAME_PATTERNS
        if pattern.search(contributor)
    }
    return hits.pop() if len(hits) == 1 else None


def unexplained_member_words(
    parsed: ParsedCommitteeName, member_given_words: Sequence[str]
) -> list[str]:
    """Words in *our* record of the person that the committee name does not account for.

    This is the guard against a surname key that is a shortened ending of the real one.
    ``surname_keys`` deliberately offers every trailing run of a legislator's name, which
    is what finds "Van Binsbergen, Scott" for a member production stored as first "Scott
    Van" / last "Binsbergen". The cost is that a *shorter* key can find a different person:
    Senator Erin K. Maye Quade generates the key "quade", so a committee filed by an
    unrelated "Quade, Erin" would match her on an exact given name. (Found by a Codex
    review; the earlier code comment claimed over-generating keys was safe because a wrong
    key finds no committee, which is false when the wrong key finds a namesake.)

    Three exclusions, each of which would otherwise make this rule fire on something another
    rule already describes:

    * **The first given word never counts.** How it relates to the committee's is exactly
      what ``GivenNameEvidence`` reports, so flagging it here counts one fact twice. It also
      made the rule fire on every ordinary shortening — "Pam" against "Altendorf, Pamela"
      read as an unexplained word — which is a nickname, not a surname key cutting through a
      compound name, and this rule is about the latter.
    * **Single letters never count.** A middle initial the Board omits ("Senator Mark T.
      Johnson" against "Johnson, Mark Timothy") identifies nobody.
    * **Only our side is checked.** A fuller legal name in the committee name is the Board
      being more precise than us, not a discrepancy.

    What is left is the case this exists for: a whole word stranded between the given name
    and the surname the key matched, which means either the key cut through a compound
    surname (Senator Erin K. Maye Quade matched on the key "quade", leaving "maye") or the
    person carries a second given name the committee never confirms (María Isa Pérez-Vega
    against "Perez-Vega, Maria", leaving "isa").
    """
    committee_words = set(normalize_name_part(parsed.given).split())
    nickname = normalize_name_part(parsed.published_nickname)
    if nickname:
        committee_words.add(nickname)
    return [
        word
        for word in member_given_words[1:]
        if len(word) > 1 and word not in committee_words
    ]


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
    filers_by_registration: dict[str, FilerRecord] | None = None,
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
    of every name rule above: which party's units gave the committee money. Across the 108
    committees these rules propose confidently on the 11 Aug 2026 download, 100 carry
    party-unit money and its party agreed with our own record on **all 100**, with 0
    disagreements, while all 19 disagreements anywhere in the run fell on a namesake. So a
    disagreement is a real signal that the name matched a stranger, and it holds the
    proposal down to ``review``. Agreement is recorded as support and changes no tier,
    because a right answer for a wrong reason is still a wrong reason.
    """
    result = LegislatorProposals(member=member)
    seen: set[str] = set()
    pairs: list[tuple[CommitteeRecord, ParsedCommitteeName, str]] = []
    # Longest key first, so a committee reachable under both "maye quade" and "quade" is
    # kept under the longer one -- the reading that explains more of the person's name.
    for key in sorted(surname_keys(member), key=len, reverse=True):
        for committee, parsed in committees_by_surname.get(key, ()):
            if committee.registration_number in seen:
                continue
            seen.add(committee.registration_number)
            pairs.append((committee, parsed, key))

    if not pairs:
        result.no_surname_match = True
        return result

    expected_office = next(
        (
            office
            for office, slug in LEGISLATIVE_OFFICES.items()
            if slug == member.chamber_slug
        ),
        None,
    )

    # Rule out the committees the Board itself says belong to somebody else, before any
    # name rule runs. This is the only step here that discards a candidate, and it is safe
    # to because it rests on the source stating a different district in the same office, or
    # a different party in the same seat, rather than on anything inferred. It is what
    # separates Patti Anderson (House 33A) from "Anderson, Paul H House Committee", which the
    # directory registers to House 12A -- the case §5.1 previously recorded as unreachable.
    ruled_out: list[tuple[CommitteeRecord, FilerRecord]] = []
    if filers_by_registration:
        surviving = []
        for committee, parsed, matched_key in pairs:
            filer = filers_by_registration.get(committee.registration_number)
            if (
                compare_to_filer_directory(member, filer)
                is FilerVerdict.different_person
            ):
                assert filer is not None  # only reachable with a directory row
                ruled_out.append((committee, filer))
            else:
                surviving.append((committee, parsed, matched_key))
        result.ruled_out_by_directory = tuple(ruled_out)
        pairs = surviving

    scored: list[Proposal] = []
    surname_only: list[Proposal] = []
    for committee, parsed, matched_key in pairs:
        member_given = given_name_words(member, matched_key)
        evidence = classify_given_name(parsed, member_given)
        office_matches = parsed.office is not None and parsed.office == expected_office
        active = _years_overlap(committee, current_years)
        filer = (filers_by_registration or {}).get(committee.registration_number)
        verdict = compare_to_filer_directory(member, filer)

        # Three of the reasons below are all the same worry in different clothes: **we
        # cannot tell which of several same-named people this committee belongs to.** The
        # name is inferred, or a word of our record is unexplained, or a generational suffix
        # sits on one side only. A directory row naming this member's own office, district
        # and party answers that worry outright, because it is the Board stating whose
        # committee this is on the field that actually identifies a legislator. So those
        # three are grouped and cleared together, rather than two of them being cleared and
        # the third left to hold a proposal back for a question already answered.
        #
        # Nothing else is cleared. A committee for a different office stays a different race
        # whoever it belongs to, because §7 (Display rules) forbids that money appearing
        # under a legislator's profile; a quiet committee stays quiet; a party-money
        # disagreement stays a conflict worth reading; and two surviving committees stay a
        # choice only a person may make.
        whose_committee_answered = verdict is FilerVerdict.same_seat
        identity_doubts: list[str] = []
        if evidence not in SOURCE_STATED_GIVEN_NAME_EVIDENCE:
            identity_doubts.append(f"given name is inferred ({evidence.value})")
        for word in unexplained_member_words(parsed, member_given):
            identity_doubts.append(
                f"our record of this person says {word!r} and the committee name does not"
            )
        if parsed.generational_suffix:
            identity_doubts.append(
                f"the committee name carries {parsed.generational_suffix} "
                "and our record does not"
            )

        reasons: list[str] = [] if whose_committee_answered else list(identity_doubts)
        if parsed.office is None:
            reasons.append("the committee name states no office")
        elif not office_matches:
            reasons.append(f"committee is for {parsed.office}, not {expected_office}")
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
            filer_verdict=verdict.value,
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

    # Two things stop a proposal being strong, and both are about the *company it keeps*
    # rather than about the proposal itself.
    #
    # One strong proposal beside any other candidate is not strong: two committees can
    # carry the same name in the same office ("Gottfried, David House Committee", twice).
    #
    # And a suppressed same-surname committee counts too, which is less obvious. The filter
    # above drops stale namesakes so a pool the size of Johnson's 31 stays readable, but
    # that filter runs *before* this check, so it could hide the alternatives from a strong
    # match. The case that bites: a legislator whose own committee has gone quiet while a
    # namesake's is active — the real one is filtered out and the namesake stands alone
    # looking certain. So the mere existence of another person with this surname sends it to
    # a person. Costs 13 extra reads of 200; found by a Codex review.
    #
    # **Unless the Board's directory says whose committee it is.** That worry is entirely
    # about not knowing which of several same-named people a committee belongs to, and a
    # directory row naming this member's own office, district and party answers exactly
    # that. A stale namesake elsewhere in the state is then beside the point. This does not
    # extend to the more-than-one-candidate reason: two committees that both survive are a
    # choice about which of a member's own committees to link, which §7 (Display rules)
    # requires a person to make, since money from a race for another office may not appear
    # under their profile.
    shared_surname_answered = any(
        proposal.filer_verdict == FilerVerdict.same_seat.value
        for proposal in result.proposals
    )
    extra_reasons: tuple[str, ...] = ()
    if len(result.proposals) > 1:
        extra_reasons += (
            f"{len(result.proposals)} committees are plausible for this legislator",
        )
    if result.suppressed_surname_only and not shared_surname_answered:
        extra_reasons += (
            f"{result.suppressed_surname_only} other committees share this surname, "
            "so another person of this name exists",
        )
    if extra_reasons:
        result.proposals = [
            proposal
            if proposal.tier is not ProposalTier.strong
            else Proposal(
                **{
                    **proposal.__dict__,
                    "tier": ProposalTier.review,
                    "reasons": proposal.reasons + extra_reasons,
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
        for key in surname_keys(member):
            member_given = given_name_words(member, key)
            for committee, parsed in committees_by_surname.get(key, ()):
                evidence = classify_given_name(parsed, member_given)
                if evidence in SOURCE_STATED_GIVEN_NAME_EVIDENCE:
                    claims.setdefault(committee.registration_number, set()).add(
                        member.legislator_id
                    )
    return frozenset(
        registration for registration, owners in claims.items() if len(owners) > 1
    )


def propose_all(
    members: Sequence[RosterMember],
    committees: Iterable[CommitteeRecord],
    *,
    current_years: Sequence[str],
    party_by_registration: dict[str, str] | None = None,
    filers_by_registration: dict[str, FilerRecord] | None = None,
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
            filers_by_registration=filers_by_registration,
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
            year = (row.get("Receipt date") or "")[:4] or (
                row.get("Year") or ""
            ).strip()
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
    # The larger side wins rather than requiring unanimity: 2 of the confidently proposed
    # committees hold money from both parties' units, and in both the smaller side is a
    # single donation against a much larger own-party total.
    party_by_registration = {
        registration: max(totals, key=lambda party: totals[party])
        for registration, totals in party_money.items()
        if totals and max(totals.values()) > 0
    }
    return committees, party_by_registration
