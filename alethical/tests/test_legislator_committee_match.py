"""Pins the committee-to-legislator proposal rules (#1354).

Every case below is a real one, taken from the 11 Aug 2026 itemized-contributions download
and production's 200 sitting members. That matters more here than in most test files: the
rule these tests protect is that **nothing links a committee to a legislator without a
person checking it**, and the way that rule dies is not by being deleted but by someone
loosening a proposal rule so that a wrong match becomes confident. So the tests assert the
*timidity* as much as the matching — several of them exist only to fail if a future change
promotes a case to ``strong`` that a person needs to look at.

Named cases and why each one is here:

* **Liz Reyer** — sits in the House with 2 committees: "Reyer, Lizabeth House Committee"
  (382 rows) and "Reyer, Liz Senate Committee" (45 rows). Filtering proposals to her own
  chamber drops the Senate one; filtering to her spelled first name drops the House one,
  which is the larger. Proof that office and given name must be evidence, never filters.
* **Patti and Paul Anderson** — both sit in the House. Their surname pool holds 20
  committees including two "Anderson, Paul Senate Committee" belonging to a former senator.
* **Liish Kozlowski** — the Board files her as "Kozlowski, Alicia". No rule reaches that,
  and a rule loose enough to try would reach wrong answers elsewhere.
* **Erin K. Maye Quade and Scott Van Binsbergen** — production's stored first/last split is
  wrong for both, so a matcher trusting it finds nothing.
* **Michael W. Holmstrom** — the Board files "Holmstrom Jr, Michael"; a Jr and a Sr of one
  name is exactly the confusion this design exists to prevent.
* **Jeff Backer** — "Backer, Jeff W Jr House Committee" puts the suffix on the *given* side.
  Found as a bug in the first version of these rules, which checked only the surname side.
* **Michael V. Nelson** — "V" is a middle initial, not "the fifth". Measured: every "V" in
  the file is one.
* **David Gottfried** — two committees, same name, same office, two registration numbers.
"""

from __future__ import annotations

import pytest

from scripts.review_legislator_campaign_committees import describe
from alethical.pipeline.legislator_committee_match import (
    CommitteeRecord,
    FilerRecord,
    FilerVerdict,
    GivenNameEvidence,
    ProposalTier,
    RosterMember,
    classify_party_unit_name,
    compare_to_filer_directory,
    coverage_counts,
    find_contested_registrations,
    given_name_words,
    index_committees_by_surname,
    normalize_district,
    parse_committee_name,
    propose_all,
    surname_keys,
)

CURRENT_YEARS = ("2025", "2026")


def committee(
    registration: str,
    name: str,
    *,
    kind: str = "PCC",
    first: str = "2022",
    last: str = "2026",
    rows: int = 100,
) -> CommitteeRecord:
    return CommitteeRecord(
        registration_number=registration,
        name=name,
        recipient_type=kind,
        first_year=first,
        last_year=last,
        contribution_rows=rows,
    )


def member(
    full_name: str,
    chamber: str,
    *,
    first: str | None = None,
    last: str | None = None,
    party: str | None = "DFL",
    legislator_id: str | None = None,
    district: str = "01A",
) -> RosterMember:
    return RosterMember(
        legislator_id=legislator_id or full_name.lower().replace(" ", "-"),
        full_name=full_name,
        chamber_slug=chamber,
        first_name=first,
        last_name=last,
        party=party,
        district=district,
    )


def only(members, committees, **kwargs):
    """Propose for a one-member roster and hand back that member's result."""
    return propose_all(members, committees, current_years=CURRENT_YEARS, **kwargs)[0]


# --------------------------------------------------------------------------------------
# Reading the Board's name format


@pytest.mark.parametrize(
    "name, surname, given, office, nickname, suffix",
    [
        ("Youakim, Cheryl House Committee", "Youakim", "Cheryl", "House", None, None),
        ("Walz, Tim Gov Committee", "Walz", "Tim", "Gov", None, None),
        (
            "Baker, David (Dave) House Committee",
            "Baker",
            "David",
            "House",
            "Dave",
            None,
        ),
        (
            'Gordon, James "Jimmy" House Committee',
            "Gordon",
            "James",
            "House",
            "Jimmy",
            None,
        ),
        (
            "Hansen, Richard (Rick) J House Committee",
            "Hansen",
            "Richard J",
            "House",
            "Rick",
            None,
        ),
        # Both offices whose first word alone would be ambiguous.
        (
            "Egan IV, Gregory J Dist Court Committee",
            "Egan",
            "Gregory J",
            "Dist Court",
            None,
            "IV",
        ),
        (
            "Anderson, G Barry Sup Court Committee",
            "Anderson",
            "G Barry",
            "Sup Court",
            None,
            None,
        ),
        (
            "Engen, Elliott State Aud Committee",
            "Engen",
            "Elliott",
            "State Aud",
            None,
            None,
        ),
        (
            'Tangen, George "Chip" Sec of State Committee',
            "Tangen",
            "George",
            "Sec of State",
            "Chip",
            None,
        ),
        # The suffix on the surname side, and on the given side.
        (
            "Holmstrom Jr, Michael Senate Committee",
            "Holmstrom",
            "Michael",
            "Senate",
            None,
            "Jr",
        ),
        ("Backer, Jeff W Jr House Committee", "Backer", "Jeff W", "House", None, "Jr"),
        ("Larson Jr., Calvin Gov Committee", "Larson", "Calvin", "Gov", None, "Jr"),
        # Nickname sits between the given name and its suffix.
        (
            'Scott, Ulric "Todd" C III Senate Committee',
            "Scott",
            "Ulric C",
            "Senate",
            "Todd",
            "III",
        ),
        (
            "L'Heureux, John (Jack) Jr House Committee",
            "L'Heureux",
            "John",
            "House",
            "Jack",
            "Jr",
        ),
        # Multi-word surnames, including a lowercase particle.
        (
            "Maye Quade, Erin Senate Committee",
            "Maye Quade",
            "Erin",
            "Senate",
            None,
            None,
        ),
        (
            "Van Binsbergen, Scott House Committee",
            "Van Binsbergen",
            "Scott",
            "House",
            None,
            None,
        ),
        (
            "de la Paz, Mariah House Committee",
            "de la Paz",
            "Mariah",
            "House",
            None,
            None,
        ),
        (
            "van Mechelen, Erik Sec of State Committee",
            "van Mechelen",
            "Erik",
            "Sec of State",
            None,
            None,
        ),
        # 2 of the 1,732 candidate committees state no office at all.
        ("Reyes, Peter M Jr Committee", "Reyes", "Peter M", None, None, "Jr"),
        ("Brown, Anthony L Committee", "Brown", "Anthony L", None, None, None),
    ],
)
def test_parse_committee_name(name, surname, given, office, nickname, suffix):
    parsed = parse_committee_name(name)
    assert (parsed.surname, parsed.given, parsed.office) == (surname, given, office)
    assert parsed.published_nickname == nickname
    assert parsed.generational_suffix == suffix


def test_a_middle_initial_v_is_not_a_generational_suffix():
    # Measured on the 11 Aug 2026 file: every "V" in a candidate committee name is a middle
    # initial ("Nelson, Michael V", "Lindstrom, Brent V"), never "the fifth". Reading it as
    # a suffix would strip a real initial and flag a clean name as needing extra scrutiny
    # for a reason that is not true.
    parsed = parse_committee_name("Nelson, Michael V House Committee")
    assert parsed.given == "Michael V"
    assert parsed.generational_suffix is None


# --------------------------------------------------------------------------------------
# Reading our own roster, including where production stores it wrongly


def test_surname_keys_survive_a_wrong_stored_split():
    # Production splits "Scott Van Binsbergen" into first "Scott Van" / last "Binsbergen"
    # while the Board files "Van Binsbergen, Scott". Both spellings have to be keys.
    keys = surname_keys(
        member("Scott Van Binsbergen", "house", first="Scott Van", last="Binsbergen")
    )
    assert {"binsbergen", "van binsbergen"} <= keys

    # Same failure, one word further in: production stores first "Erin K. Maye".
    keys = surname_keys(
        member(
            "Senator Erin K. Maye Quade", "senate", first="Erin K. Maye", last="Quade"
        )
    )
    assert {"quade", "maye quade"} <= keys


def test_a_stored_title_is_not_read_as_a_name():
    # 67 Senate rows read "Senator Erin P. Murphy" in full_name.
    assert given_name_words(
        member("Senator Erin P. Murphy", "senate", first="Erin P.", last="Murphy")
    ) == ["erin", "p"]
    assert "senator" not in surname_keys(
        member("Senator Erin P. Murphy", "senate", first="Erin P.", last="Murphy")
    )


# --------------------------------------------------------------------------------------
# A committee only ever becomes ``strong`` when the source states everything


def test_an_exact_current_chamber_match_is_proposed_as_strong():
    result = only(
        [member("Patty Acomb", "house", first="Patty", last="Acomb")],
        [committee("17674", "Acomb, Patty House Committee")],
    )
    assert result.outcome == "matched"
    assert result.proposals[0].tier is ProposalTier.strong
    assert result.proposals[0].given_name_evidence is GivenNameEvidence.exact


def test_a_nickname_the_board_published_is_strong_but_one_we_inferred_is_not():
    published = only(
        [member("Dave Baker", "house", first="Dave", last="Baker")],
        [committee("17700", "Baker, David (Dave) House Committee")],
    )
    assert (
        published.proposals[0].given_name_evidence
        is GivenNameEvidence.published_nickname
    )
    assert published.proposals[0].tier is ProposalTier.strong

    # "Pam" for "Pamela" is this module's guess about how names shorten. It is very
    # probably right, and it still goes to a person, because the same looseness that gets
    # this one right gets others wrong.
    inferred = only(
        [member("Pam Altendorf", "house", first="Pam", last="Altendorf")],
        [committee("18760", "Altendorf, Pamela House Committee")],
    )
    assert inferred.proposals[0].given_name_evidence is GivenNameEvidence.shortened
    assert inferred.proposals[0].tier is ProposalTier.review
    assert inferred.outcome == "ambiguous"


def test_a_generational_suffix_on_one_side_only_holds_a_match_back():
    # "Holmstrom Jr, Michael Senate Committee" against our "Michael W. Holmstrom" is very
    # probably the same man. A Jr and a Sr of one name is the confusion this design exists
    # to prevent, so probably is not enough.
    surname_side = only(
        [
            member(
                "Senator Michael W. Holmstrom",
                "senate",
                first="Michael W.",
                last="Holmstrom",
                party="R",
            )
        ],
        [committee("19229", "Holmstrom Jr, Michael Senate Committee")],
    )
    assert surname_side.proposals[0].tier is ProposalTier.review
    assert any("Jr" in reason for reason in surname_side.proposals[0].reasons)

    # The same rule has to fire when the Board puts the suffix after the middle initial
    # instead. This case shipped as ``strong`` in the first version of these rules.
    given_side = only(
        [member("Jeff Backer", "house", first="Jeff", last="Backer", party="R")],
        [committee("17735", "Backer, Jeff W Jr House Committee")],
    )
    assert given_side.proposals[0].tier is ProposalTier.review
    assert any("Jr" in reason for reason in given_side.proposals[0].reasons)


def test_a_committee_with_no_recent_money_is_not_proposed_confidently():
    result = only(
        [member("Paul Anderson", "house", first="Paul", last="Anderson", party="R")],
        [
            committee(
                "18036", "Anderson, Paul Senate Committee", first="2016", last="2020"
            )
        ],
    )
    assert result.proposals[0].tier is ProposalTier.review
    assert not result.proposals[0].active_in_current_years


def test_only_a_candidate_committee_can_be_proposed():
    # 51 political funds also end their name in " Committee", so the name suffix cannot be
    # what identifies a candidate's committee. The ``Recipient type`` column is.
    committees = [
        committee("30293", "MAFMIC Political Action Committee", kind="PCF"),
        committee("20003", "MN DFL State Central Committee", kind="PTU"),
    ]
    assert index_committees_by_surname(committees) == {}


# --------------------------------------------------------------------------------------
# The cases that must reach a person


def test_two_committees_means_a_person_looks_even_when_both_names_match_exactly():
    # "Gottfried, David House Committee" exists twice, under two registration numbers, in
    # the same office. Either he re-registered or there are two David Gottfrieds, and
    # nothing in the file says which.
    result = only(
        [member("David Gottfried", "house", first="David", last="Gottfried")],
        [
            committee(
                "19193", "Gottfried, David House Committee", first="2024", rows=141
            ),
            committee(
                "19067",
                "Gottfried, David House Committee",
                first="2024",
                last="2024",
                rows=7,
            ),
        ],
    )
    assert result.outcome == "ambiguous"
    assert len(result.proposals) == 2
    assert all(p.tier is ProposalTier.review for p in result.proposals)


def test_a_sitting_member_running_for_another_office_keeps_both_committees_visible():
    # Liz Reyer sits in the House. Her House committee is filed under "Lizabeth" and holds
    # 382 rows; her Senate committee is filed under "Liz" and holds 45. Filtering on either
    # signal loses one of them, so both are proposed and a person decides.
    result = only(
        [member("Liz Reyer", "house", first="Liz", last="Reyer")],
        [
            committee(
                "18596",
                "Reyer, Lizabeth House Committee",
                first="2020",
                last="2025",
                rows=382,
            ),
            committee("19263", "Reyer, Liz Senate Committee", first="2025", rows=45),
        ],
    )
    assert result.outcome == "ambiguous"
    registrations = {p.committee.registration_number for p in result.proposals}
    assert registrations == {"18596", "19263"}
    senate = next(
        p for p in result.proposals if p.committee.registration_number == "19263"
    )
    assert any("Senate, not House" in reason for reason in senate.reasons)


def test_an_unmappable_nickname_is_surfaced_rather_than_guessed_or_dropped():
    # The Board files "Kozlowski, Alicia" for the member production calls "Liish
    # Kozlowski". Nothing derives one from the other, so the committee is shown with its
    # published name and the reviewer decides.
    result = only(
        [member("Liish Kozlowski", "house", first="Liish", last="Kozlowski")],
        [committee("18886", "Kozlowski, Alicia House Committee", rows=203)],
    )
    assert result.outcome == "ambiguous"
    assert result.proposals[0].given_name_evidence is GivenNameEvidence.surname_only
    assert result.proposals[0].committee.registration_number == "18886"


def test_a_legislator_known_by_a_middle_name_is_surfaced():
    # Production's "Bjorn Olson" is the Board's "Olson, Christian Bjorn".
    result = only(
        [member("Bjorn Olson", "house", first="Bjorn", last="Olson", party="R")],
        [committee("18497", "Olson, Christian Bjorn House Committee", first="2020")],
    )
    assert result.proposals[0].given_name_evidence is GivenNameEvidence.middle_name
    assert result.proposals[0].tier is ProposalTier.review


def test_two_sitting_members_sharing_a_surname_do_not_get_each_others_committee():
    # Patti and Paul Anderson both sit in the House, so chamber separates nothing. Neither
    # is proposed confidently while the other's committee is in the same pool.
    roster = [
        member(
            "Patti Anderson",
            "house",
            first="Patti",
            last="Anderson",
            party="R",
            legislator_id="patti",
        ),
        member(
            "Paul Anderson",
            "house",
            first="Paul",
            last="Anderson",
            party="R",
            legislator_id="paul",
        ),
    ]
    committees = [
        committee(
            "18229",
            "Anderson, Patricia House Committee",
            first="2018",
            last="2025",
            rows=279,
        ),
        committee("16807", "Anderson, Paul H House Committee", first="2015", rows=201),
    ]
    results = propose_all(roster, committees, current_years=CURRENT_YEARS)
    assert [r.outcome for r in results] == ["ambiguous", "ambiguous"]
    for result in results:
        assert all(p.tier is ProposalTier.review for p in result.proposals)


def test_a_committee_two_sitting_members_could_claim_is_flagged_as_contested():
    # Both would match "Nelson, Nathan D" on a source-stated given name, so neither may
    # have it proposed confidently. Computed across the roster, because one legislator's
    # row cannot show it.
    roster = [
        member(
            "Nathan Nelson",
            "house",
            first="Nathan",
            last="Nelson",
            party="R",
            legislator_id="a",
        ),
        member(
            "Nathan Nelson",
            "house",
            first="Nathan",
            last="Nelson",
            party="R",
            legislator_id="b",
        ),
    ]
    index = index_committees_by_surname(
        [committee("18412", "Nelson, Nathan D House Committee")]
    )
    assert find_contested_registrations(roster, index) == frozenset({"18412"})

    results = propose_all(
        roster,
        [committee("18412", "Nelson, Nathan D House Committee")],
        current_years=CURRENT_YEARS,
    )
    for result in results:
        assert result.proposals[0].tier is ProposalTier.review
        assert any(
            "another sitting legislator" in r for r in result.proposals[0].reasons
        )


def test_an_inferred_nickname_does_not_make_two_members_contest_each_other():
    # Were a guessed shortening enough to stake a claim, two sitting members sharing one
    # surname would contest every committee in their pool and nothing would ever be
    # proposed. Only a source-stated name counts as a claim.
    roster = [
        member(
            "Josh Heintzeman",
            "house",
            first="Josh",
            last="Heintzeman",
            party="R",
            legislator_id="josh",
        ),
        member(
            "Senator Keri Heintzeman",
            "senate",
            first="Keri",
            last="Heintzeman",
            party="R",
            legislator_id="keri",
        ),
    ]
    committees = [
        committee(
            "17782", "Heintzeman, Joshua House Committee", first="2015", rows=364
        ),
        committee("19205", "Heintzeman, Keri Senate Committee", first="2025", rows=115),
    ]
    index = index_committees_by_surname(committees)
    assert find_contested_registrations(roster, index) == frozenset()

    keri = propose_all(roster, committees, current_years=CURRENT_YEARS)[1]
    assert keri.outcome == "ambiguous"
    assert keri.proposals[0].committee.registration_number == "19205"
    assert keri.proposals[0].given_name_evidence is GivenNameEvidence.exact


def test_stale_namesakes_are_dropped_and_counted_rather_than_silently_cut():
    # The Johnson pool holds 31 committees. Cutting it without saying so would read as
    # "we considered everything".
    committees = [
        committee("19045", "Johnson, Peter House Committee", first="2024", rows=93)
    ] + [
        committee(
            f"170{index:02d}",
            f"Johnson, Other{index} House Committee",
            first="2015",
            last="2016",
            rows=5,
        )
        for index in range(12)
    ]
    result = only(
        [member("Pete Johnson", "house", first="Pete", last="Johnson")], committees
    )
    assert result.suppressed_surname_only == 12
    assert [p.committee.registration_number for p in result.proposals] == ["19045"]


# --------------------------------------------------------------------------------------
# What a Codex review found: four ways an earlier version of these rules reached ``strong``
# for a committee that could belong to somebody else. Two of them fired on real sitting
# members, which is why these cases are pinned by name.


def test_two_matching_initials_are_not_an_exact_name_match():
    # Senator D. Scott Dibble, real and sitting. The Board files "Dibble, D Scott", and the
    # old rule compared first words only -- "d" against "d" -- so a hypothetical
    # "Dibble, D Steven" belonging to another man was equally exact, and equally strong.
    # A single letter separates nobody.
    dibble = member(
        "Senator D. Scott Dibble",
        "senate",
        first="D. Scott",
        last="Dibble",
        party="DFL",
    )
    right = only(
        [dibble], [committee("15667", "Dibble, D Scott Senate Committee", first="2015")]
    )
    assert right.proposals[0].given_name_evidence is GivenNameEvidence.exact
    assert right.proposals[0].tier is ProposalTier.strong

    wrong = only([dibble], [committee("99001", "Dibble, D Steven Senate Committee")])
    assert wrong.proposals[0].given_name_evidence is not GivenNameEvidence.exact
    assert wrong.proposals[0].tier is ProposalTier.review


def test_a_surname_key_that_cut_through_a_compound_surname_cannot_be_strong():
    # Senator Erin K. Maye Quade generates the keys "quade" and "maye quade", because
    # production stores her last name as just "Quade". Her real committee is filed under the
    # whole surname; an unrelated "Quade, Erin" would match the short key on an exact given
    # name. The leftover "maye" in our own record is what gives that away.
    maye_quade = member(
        "Senator Erin K. Maye Quade", "senate", first="Erin K. Maye", last="Quade"
    )
    hers = only(
        [maye_quade],
        [committee("18724", "Maye Quade, Erin Senate Committee", first="2021")],
    )
    assert hers.proposals[0].tier is ProposalTier.strong

    stranger = only([maye_quade], [committee("99003", "Quade, Erin Senate Committee")])
    assert stranger.proposals[0].tier is ProposalTier.review
    assert any("'maye'" in reason for reason in stranger.proposals[0].reasons)


def test_a_middle_initial_the_board_omits_does_not_hold_a_match_back():
    # The other side of the rule above. 67 Senate rows carry a middle initial the Board
    # drops, and an initial identifies nobody -- demoting on it would cost half the Senate
    # for no gain.
    result = only(
        [
            member(
                "Senator Mark T. Johnson",
                "senate",
                first="Mark T.",
                last="Johnson",
                party="R",
            )
        ],
        [committee("18011", "Johnson, Mark Timothy Senate Committee", first="2016")],
    )
    assert result.proposals[0].given_name_evidence is GivenNameEvidence.exact
    assert result.proposals[0].tier is ProposalTier.strong


def test_a_second_given_name_the_committee_never_confirms_holds_a_match_back():
    # María Isa Pérez-Vega, real and sitting. The Board files "Perez-Vega, Maria", dropping
    # "Isa". The committee is very probably hers and the rule still sends it to a person,
    # because an unrelated Maria Perez Vega would look identical.
    result = only(
        [member("María Isa Pérez-Vega", "house", first="María Isa", last="Pérez-Vega")],
        [
            committee(
                "18746", "Perez-Vega, Maria House Committee", first="2022", last="2025"
            )
        ],
    )
    assert result.proposals[0].tier is ProposalTier.review
    assert any("'isa'" in reason for reason in result.proposals[0].reasons)


def test_a_hidden_stale_namesake_still_stops_a_match_being_strong():
    # The stale-namesake filter runs before the more-than-one-candidate check, so it could
    # hide the alternatives from a strong match. The case that bites: a legislator's own
    # committee goes quiet while a namesake's is active, so the real one is filtered out and
    # the namesake stands alone looking certain.
    result = only(
        [member("Senator Doron Clark", "senate", first="Doron", last="Clark")],
        [
            committee("19196", "Clark, Doron Senate Committee", first="2025", rows=38),
            committee(
                "99008",
                "Clark, Wendy Senate Committee",
                first="2015",
                last="2016",
                rows=9,
            ),
        ],
    )
    assert result.suppressed_surname_only == 1
    assert result.proposals[0].tier is ProposalTier.review
    assert any("share this surname" in reason for reason in result.proposals[0].reasons)


def test_a_published_nickname_survives_a_differing_legal_first_name():
    # Deliberately still strong, against the Codex finding that suggested demoting it. The
    # Board printing "(Rick)" beside "Richard" is the Board stating what this person is
    # called, which is evidence rather than our inference -- and the unexplained-word rule
    # is applied to our record only, so a fuller legal name in the committee name is not
    # held against it.
    result = only(
        [member("Rick Hansen", "house", first="Rick", last="Hansen")],
        [
            committee(
                "16189",
                "Hansen, Richard (Rick) J House Committee",
                first="2015",
                rows=314,
            )
        ],
    )
    assert (
        result.proposals[0].given_name_evidence is GivenNameEvidence.published_nickname
    )
    assert result.proposals[0].tier is ProposalTier.strong


# --------------------------------------------------------------------------------------
# The Board's registered-filer directory, which states each committee's own seat


def filer(
    registration: str,
    *,
    office: str | None = "House",
    district: str | None = "01A",
    party: str | None = "DFL",
    candidate: str = "Testcase, Sample",
    incumbent: bool = True,
    terminated: bool = False,
) -> FilerRecord:
    return FilerRecord(
        registration_number=registration,
        committee_name=f"{candidate} {office} Committee",
        candidate_name=candidate,
        office=office,
        district=district,
        party=party,
        is_incumbent=incumbent,
        is_terminated=terminated,
    )


def test_a_district_is_compared_with_its_leading_zero_removed():
    # Production zero-pads House districts ("05B") and the Board does not ("5B"). Comparing
    # them raw matches nothing for the 9 single-digit House districts or either single-digit
    # Senate one, silently.
    assert normalize_district("05B") == normalize_district("5B")
    assert normalize_district("01") == normalize_district("1")
    assert normalize_district("45B") == "45B"
    assert normalize_district(None) == ""


@pytest.mark.parametrize(
    "office, district, party, expected",
    [
        # This member's own seat and party, which is the Board naming whose committee it is.
        ("House", "33A", "RPM", FilerVerdict.same_seat),
        # A different district in the same office is a different person, stated by the source.
        ("House", "12A", "RPM", FilerVerdict.different_person),
        # A different party in the same seat, likewise.
        ("House", "33A", "DFL", FilerVerdict.different_person),
        # A different office may well be this member seeking something else, so never ruled out.
        ("Senate", "33", "RPM", FilerVerdict.different_race),
        ("Governor", None, "RPM", FilerVerdict.different_race),
    ],
)
def test_the_directory_verdict_separates_a_different_person_from_a_different_race(
    office, district, party, expected
):
    patti = member(
        "Patti Anderson",
        "house",
        first="Patti",
        last="Anderson",
        party="R",
        legislator_id="patti",
        district="33A",
    )
    assert (
        compare_to_filer_directory(
            patti, filer("x", office=office, district=district, party=party)
        )
        is expected
    )


def test_absence_from_the_directory_says_nothing_either_way():
    # 1,057 of the 1,732 candidate committees are not listed, because the directory holds
    # current registrations and an older committee falls off it. Reading absence as evidence
    # would rule out most of the corpus.
    assert (
        compare_to_filer_directory(member("Anyone Here", "house"), None)
        is FilerVerdict.unknown
    )


def test_a_committee_the_board_registers_to_another_seat_is_ruled_out():
    # The case §5.1 recorded as unreachable from the payment files. Patti Anderson sits in
    # House 33A; "Anderson, Paul H House Committee" is registered to House 12A, so it is
    # another person's, and the Board is the one saying so.
    patti = member(
        "Patti Anderson",
        "house",
        first="Patti",
        last="Anderson",
        party="R",
        legislator_id="patti",
        district="33A",
    )
    result = only(
        [patti],
        [
            committee(
                "18229", "Anderson, Patricia House Committee", first="2018", rows=279
            ),
            committee(
                "16807", "Anderson, Paul H House Committee", first="2015", rows=201
            ),
        ],
        filers_by_registration={
            "18229": filer(
                "18229", district="33A", party="RPM", candidate="Anderson, Patricia"
            ),
            "16807": filer(
                "16807", district="12A", party="RPM", candidate="Anderson, Paul H"
            ),
        },
    )
    assert [p.committee.registration_number for p in result.proposals] == ["18229"]
    assert [c.registration_number for c, _ in result.ruled_out_by_directory] == [
        "16807"
    ]
    assert result.outcome == "matched"


def test_the_board_naming_the_seat_settles_a_name_no_rule_could_derive():
    # "Liish Kozlowski" and "Kozlowski, Alicia" have no derivable relationship, so on names
    # alone this can only ever go to a person. The Board registering that committee to House
    # 08B, DFL — her seat and her party — answers the question the name could not.
    liish = member(
        "Liish Kozlowski",
        "house",
        first="Liish",
        last="Kozlowski",
        party="DFL",
        district="08B",
    )
    on_names_alone = only(
        [liish], [committee("18886", "Kozlowski, Alicia House Committee", rows=203)]
    )
    assert on_names_alone.proposals[0].tier is ProposalTier.review

    with_directory = only(
        [liish],
        [committee("18886", "Kozlowski, Alicia House Committee", rows=203)],
        filers_by_registration={
            "18886": filer(
                "18886", district="08B", party="DFL", candidate="Kozlowski, Alicia"
            )
        },
    )
    assert with_directory.proposals[0].filer_verdict == FilerVerdict.same_seat.value
    assert with_directory.proposals[0].tier is ProposalTier.strong
    assert with_directory.outcome == "matched"


def test_a_different_office_is_never_cleared_by_the_directory():
    # Liz Reyer sits in House 52A and is registered for Senate 52. The Board agreeing it is
    # hers does not make it her House money: §7 (Display rules) forbids a race for another
    # office appearing under her profile, so a person still decides which to link.
    result = only(
        [member("Liz Reyer", "house", first="Liz", last="Reyer", district="52A")],
        [
            committee(
                "18596",
                "Reyer, Lizabeth House Committee",
                first="2020",
                last="2025",
                rows=382,
            ),
            committee("19263", "Reyer, Liz Senate Committee", first="2025", rows=45),
        ],
        filers_by_registration={
            "19263": filer(
                "19263",
                office="Senate",
                district="52",
                party="DFL",
                candidate="Reyer, Liz",
            )
        },
    )
    assert result.outcome == "ambiguous"
    senate = next(
        p for p in result.proposals if p.committee.registration_number == "19263"
    )
    assert senate.filer_verdict == FilerVerdict.different_race.value
    assert any("Senate, not House" in reason for reason in senate.reasons)


def test_two_surviving_committees_still_need_a_person_even_with_the_board_agreeing():
    # The directory answers *whose* a committee is. It cannot answer which of a member's own
    # committees their profile should show, which is a product decision §7 reserves.
    result = only(
        [
            member(
                "Ben Bakeberg",
                "house",
                first="Ben",
                last="Bakeberg",
                party="R",
                district="54B",
            )
        ],
        [
            committee(
                "18905",
                "Bakeberg, Ben House Committee",
                first="2022",
                last="2025",
                rows=169,
            ),
            committee(
                "19239", "Bakeberg, Ben Senate Committee", first="2025", rows=114
            ),
        ],
        filers_by_registration={
            "18905": filer(
                "18905", district="54B", party="RPM", candidate="Bakeberg, Ben"
            ),
            "19239": filer(
                "19239",
                office="Senate",
                district="54",
                party="RPM",
                candidate="Bakeberg, Ben",
            ),
        },
    )
    assert result.outcome == "ambiguous"
    assert len(result.proposals) == 2


def test_the_directory_agreeing_never_clears_the_committee_name_s_own_office():
    # The directory's office and the committee *name's* office suffix are two different
    # fields and can disagree. When they do, the name still holds the proposal back: §7
    # (Display rules) forbids money from a race for another office appearing under a
    # legislator's profile, and the name is what a reviewer reads on the screen.
    #
    # This case exists because a mutation test caught the gap: letting a ``same_seat``
    # verdict clear the different-office reason passed every other test in this file.
    result = only(
        [
            member(
                "Peggy Bennett",
                "house",
                first="Peggy",
                last="Bennett",
                party="R",
                district="23A",
            )
        ],
        [committee("19340", "Bennett, Peggy Gov Committee", first="2026", rows=48)],
        filers_by_registration={
            "19340": filer(
                "19340", district="23A", party="RPM", candidate="Bennett, Peggy"
            )
        },
    )
    proposal = result.proposals[0]
    assert proposal.filer_verdict == FilerVerdict.same_seat.value
    assert proposal.tier is ProposalTier.review
    assert any("Gov, not House" in reason for reason in proposal.reasons)


def test_a_quiet_committee_is_not_promoted_by_the_directory_either():
    result = only(
        [member("Someone Quiet", "house", first="Someone", last="Quiet")],
        [
            committee(
                "18000", "Quiet, Someone House Committee", first="2016", last="2020"
            )
        ],
        filers_by_registration={
            "18000": filer(
                "18000", district="01A", party="DFL", candidate="Quiet, Someone"
            )
        },
    )
    assert result.proposals[0].filer_verdict == FilerVerdict.same_seat.value
    assert result.proposals[0].tier is ProposalTier.review
    assert result.proposals[0].reasons == (
        "no contributions in the current session's years",
    )


# --------------------------------------------------------------------------------------
# The cross-check that comes from a different column of the same file


def test_party_unit_names_are_classified_only_when_the_filer_states_one_party():
    assert classify_party_unit_name("Cass County RPM") == "R"
    assert classify_party_unit_name("44th Senate District DFL") == "DFL"
    assert classify_party_unit_name("MN DFL State Central Committee") == "DFL"
    # Not a party unit at all, though the file types 69 such filers as one.
    assert classify_party_unit_name("Xcel Energy Employees PAC") is None
    # A caucus committee whose name states no party. Asserting one would be a claim the
    # source never makes.
    assert classify_party_unit_name("Senate Victory Fund (SVF)") is None
    assert classify_party_unit_name("HRCC") is None


def test_party_money_agreeing_supports_a_match_without_changing_its_tier():
    result = only(
        [member("Patty Acomb", "house", first="Patty", last="Acomb", party="DFL")],
        [committee("17674", "Acomb, Patty House Committee")],
        party_by_registration={"17674": "DFL"},
    )
    assert result.proposals[0].party_agrees is True
    assert result.proposals[0].tier is ProposalTier.strong


def test_no_party_on_record_is_never_shown_to_a_reviewer_as_a_disagreement():
    # The shipped bug this pins: the review screen tested ``party_agrees`` for truth, so a
    # legislator we hold no party for read as "DISAGREES with our record" -- telling the
    # reviewer something false at the exact moment they decide. Three states, not two.
    no_party = only(
        [member("Sen. Bobby Joe Champion", "senate", party=None)],
        [committee("17316", "Champion, Bobby Joe Senate Committee", first="2015")],
        party_by_registration={"17316": "DFL"},
    ).proposals[0]
    assert no_party.party_agrees is None
    assert "we hold no party for this legislator to compare" in describe(no_party)
    assert "DISAGREES" not in describe(no_party)

    disagrees = only(
        [member("Patty Acomb", "house", first="Patty", last="Acomb", party="DFL")],
        [committee("17674", "Acomb, Patty House Committee")],
        party_by_registration={"17674": "R"},
    ).proposals[0]
    assert "DISAGREES with our record" in describe(disagrees)


def test_party_money_disagreeing_sends_an_otherwise_perfect_match_to_a_person():
    # The name, office and years all line up, which is exactly when a wrong match is most
    # dangerous. That the party units paying this committee are the other party is evidence
    # the name found a stranger.
    result = only(
        [member("Patty Acomb", "house", first="Patty", last="Acomb", party="DFL")],
        [committee("17674", "Acomb, Patty House Committee")],
        party_by_registration={"17674": "R"},
    )
    assert result.proposals[0].party_agrees is False
    assert result.proposals[0].tier is ProposalTier.review
    assert result.outcome == "ambiguous"


# --------------------------------------------------------------------------------------
# Coverage is a count, and it counts proposals rather than links


def test_coverage_counts_name_the_three_outcomes():
    roster = [
        member("Patty Acomb", "house", first="Patty", last="Acomb", legislator_id="a"),
        member(
            "Pam Altendorf", "house", first="Pam", last="Altendorf", legislator_id="b"
        ),
        member("Nobody Here", "house", first="Nobody", last="Here", legislator_id="c"),
    ]
    committees = [
        committee("17674", "Acomb, Patty House Committee"),
        committee("18760", "Altendorf, Pamela House Committee"),
    ]
    results = propose_all(roster, committees, current_years=CURRENT_YEARS)
    assert coverage_counts(results) == {
        "matched": 1,
        "ambiguous": 1,
        "unmatched": 1,
        "total": 3,
    }
    assert results[2].no_surname_match is True
    assert results[2].unresolved_reason == "no committee shares this surname"


def test_a_strong_proposal_still_reports_why_it_is_unconfirmed():
    # A matched legislator is not a linked legislator, so the unresolved list has to say
    # something about them. Reporting no reason would read as though the proposer had
    # nothing to say about a case it had in fact taken as far as it can.
    result = only(
        [member("Patty Acomb", "house", first="Patty", last="Acomb")],
        [committee("17674", "Acomb, Patty House Committee")],
    )
    assert result.outcome == "matched"
    assert result.unresolved_reason == (
        "one committee proposed and nothing competing; awaiting confirmation"
    )
