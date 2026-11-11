from __future__ import annotations

import hashlib
from dataclasses import replace
from datetime import date, datetime, timezone

import pytest

from alethical.pipeline.candidate_catalogue import (
    ElectionContext,
    parse_candidate_catalogue,
)
from alethical.pipeline.election_results import (
    ElectionResultsError,
    build_races,
    parse_result_file,
    snapshot_document,
)


# Exact public-file excerpts downloaded November 11, 2026. This is one precinct,
# not evidence of statewide completeness. Other scenarios below are synthetic.
PRECINCT = (
    b"MN;01;0005;0335;Attorney General;;0401;Keith Ellison;;;DFL;1;1;384;42.29;908\n"
    b"MN;01;0005;0335;Attorney General;;0302;Ronald J. Schutz;;;R;1;1;524;57.71;908\n"
    b"MN;01;0005;0335;Attorney General;;9901;WRITE-IN;;;WI;1;1;0;0.00;908\n"
)
ROSTER = (
    b"03350401;Keith Ellison;0335;Attorney General;88;04;DFL\n"
    b"03350302;Ronald J. Schutz;0335;Attorney General;88;03;R\n"
)
FETCHED = datetime(2026, 11, 11, 15, tzinfo=timezone.utc)
DAY = date(2026, 11, 3)
EVIDENCE_HASH = hashlib.sha256(
    b"Synthetic fixture status evidence: unofficial"
).hexdigest()


def parse(body=PRECINCT, **kwargs):
    args = {
        "election_id": "201",
        "election_date": DAY,
        "source_url": "https://electionresultsfiles.sos.mn.gov/20261103/allracesbyprecinct.txt",
        "fetched_at": FETCHED,
        "source_stage": "real",
        "source_status": "unofficial",
        "status_evidence_url": "https://electionresults.sos.mn.gov/20261103",
        "status_evidence_sha256": EVIDENCE_HASH,
        "geography": "precinct",
    }
    args.update(kwargs)
    return parse_result_file(body, **args)


def catalogue(body=ROSTER, election_id="201", stage="unverified"):
    return parse_candidate_catalogue(
        body,
        election=ElectionContext(
            election_id,
            DAY,
            "general",
            "https://electionresultsfiles.sos.mn.gov/20261103/cand.txt",
            stage,
        ),
        fetched_at=FETCHED,
    )


def summary(body=PRECINCT):
    # Synthetic whole-race summary for the one-precinct fixture only.
    return parse(
        body.replace(b"MN;01;0005;", b"MN;;;"),
        geography="race",
        source_url="https://electionresultsfiles.sos.mn.gov/20261103/attorneygen.txt",
    )


def test_original_excerpt_retains_source_rows_and_zero_without_outcomes():
    result = parse()
    assert result.source_bytes == PRECINCT
    assert result.source_sha256 == hashlib.sha256(PRECINCT).hexdigest()
    assert result.rows[1].candidate_name == "Ronald J. Schutz"
    assert result.rows[1].precinct_id == "0005"
    assert result.rows[2].votes == 0
    assert result.rows[2].is_write_in_aggregate
    assert result.rows[2].raw_row.encode() == PRECINCT.splitlines()[2]
    assert result.rows[2].row_number == 3
    assert parse() == result
    assert snapshot_document(result)["fetched_at"] == FETCHED.isoformat()


@pytest.mark.parametrize(
    "body",
    [
        b"",
        b"<html>Unavailable</html>",
        PRECINCT + PRECINCT.splitlines()[0],
        PRECINCT.replace(b";384;", b";-1;"),
        PRECINCT.replace(b";384;", b";;"),
        PRECINCT.replace(b";384;", b";unreadable;"),
        PRECINCT.replace(b";42.29;", b";101;"),
        PRECINCT.replace(b";1;1;384;", b";2;1;384;"),
        PRECINCT.replace(b";WRITE-IN;", b";Unknown candidate;"),
        PRECINCT.replace(b";0005;", b";AITKIN;"),
    ],
)
def test_bad_or_duplicate_source_fails_instead_of_becoming_zero(body):
    with pytest.raises(ElectionResultsError):
        parse(body)


def test_conflicting_identity_is_not_added_twice():
    with pytest.raises(ElectionResultsError, match="conflicting candidate identity"):
        parse(
            PRECINCT
            + PRECINCT.splitlines()[0].replace(b"Keith Ellison", b"Another person")
        )


@pytest.mark.parametrize(
    "kwargs",
    [
        {"source_status": "certified"},
        {"status_evidence_sha256": ""},
        {"fetched_at": datetime(2026, 11, 11)},
        {
            "source_url": "https://electionresultsfiles.sos.mn.gov/20241105/allracesbyprecinct.txt"
        },
        {"status_evidence_url": "https://example.com/results"},
    ],
)
def test_scope_and_status_evidence_are_required(kwargs):
    with pytest.raises(ElectionResultsError):
        parse(**kwargs)


def test_reconciliation_counts_all_candidates_and_write_in_separately():
    result = build_races(parse(), catalogue(), summary=summary())
    race = result["races"][0]
    assert race["race_id"] == "election:201:jurisdiction:88:office:0335"
    assert race["coverage"] == {
        "held_precincts": 1,
        "expected_precincts": 1,
        "reporting_precincts": 1,
        "reconciled": True,
        "errors": [],
    }
    assert len(race["candidates"]) == 3
    assert [c["votes"] for c in race["candidates"]] == [524, 384, 0]
    assert all(c["outcome"] is None for c in race["candidates"])
    assert race["candidates"][2]["candidate_id"] is None
    assert race["candidates"][0]["candidate_id"] == "03350302"


@pytest.mark.parametrize("stage", ["test", "unverified"])
def test_staged_results_cannot_build_public_races(stage):
    with pytest.raises(ElectionResultsError, match="test or unverified"):
        build_races(parse(source_stage=stage), catalogue())


def test_wrong_election_and_test_roster_are_rejected():
    with pytest.raises(ElectionResultsError, match="another election"):
        build_races(parse(), catalogue(election_id="170"))
    with pytest.raises(ElectionResultsError, match="test candidate register"):
        build_races(parse(), catalogue(stage="test"))


def test_missing_candidate_remains_unknown_and_blocks_complete_claim():
    body = b"\n".join(
        row for row in PRECINCT.splitlines() if b"Keith Ellison" not in row
    )
    race = build_races(parse(body), catalogue(), summary=summary())["races"][0]
    assert (
        next(c for c in race["candidates"] if c["name"] == "Keith Ellison")["votes"]
        is None
    )
    assert not race["coverage"]["reconciled"]
    assert any("Missing registered candidate" in e for e in race["coverage"]["errors"])


def test_newer_summary_does_not_silently_replace_old_precinct_votes():
    changed = PRECINCT.replace(b";384;42.29;908", b";385;42.29;909").replace(
        b";908", b";909"
    )
    race = build_races(parse(), catalogue(), summary=summary(changed))["races"][0]
    assert not race["coverage"]["reconciled"]
    assert (
        next(c for c in race["candidates"] if c["name"] == "Keith Ellison")["votes"]
        == 384
    )
    assert any("do not reconcile" in e for e in race["coverage"]["errors"])


def test_name_party_or_district_conflicts_do_not_pass_reconciliation():
    bad = PRECINCT.replace(b"Ronald J. Schutz", b"Ronald J. Schultz")
    race = build_races(parse(bad), catalogue(), summary=summary())["races"][0]
    assert not race["coverage"]["reconciled"]
    assert any(
        "conflicts with candidate register" in e for e in race["coverage"]["errors"]
    )


def test_ballot_question_exclusion_is_visible_and_does_not_join_a_person():
    question = b"MN;01;0005;0351;CONSTITUTIONAL AMENDMENT 1;;9001;YES;;;NP;1;1;700;70.00;1000\n"
    result = build_races(parse(PRECINCT + question), catalogue(), summary=summary())
    assert result["excluded_rows"] == [
        {
            "row_number": 4,
            "office_id": "0351",
            "office_name": "CONSTITUTIONAL AMENDMENT 1",
            "reason": "ballot_question",
        }
    ]
    assert result["races"][0]["coverage"]["reconciled"]


def test_same_candidate_id_in_different_counties_stays_separate():
    roster = b"10009001;Alex Smith;1000;County Commissioner;01;90;NP\n10009001;Alex Smith;1000;County Commissioner;02;90;NP\n"
    body = b"MN;01;0005;1000;County Commissioner;1;9001;Alex Smith;;;NP;1;1;12;100.00;12\nMN;02;0005;1000;County Commissioner;1;9001;Alex Smith;;;NP;1;1;20;100.00;20\n"
    county_summary = parse(
        body.replace(b";0005;", b";;"),
        geography="county",
        source_url="https://electionresultsfiles.sos.mn.gov/20261103/allracesbycounty.txt",
    )
    result = build_races(parse(body), catalogue(roster), summary=county_summary)
    assert len(result["races"]) == 2
    assert [r["candidates"][0]["votes"] for r in result["races"]] == [12, 20]
    assert (
        len({r["candidates"][0]["candidate_stable_id"] for r in result["races"]}) == 2
    )


def test_unreported_precincts_are_not_certified_or_treated_as_complete_reporting():
    pending = PRECINCT.replace(b";1;1;", b";0;1;")
    race = build_races(parse(pending), catalogue(), summary=summary(pending))["races"][
        0
    ]
    assert race["coverage"]["reporting_precincts"] == 0
    assert race["source_status"] == "unofficial"
    assert all(c["outcome"] is None for c in race["candidates"])


def test_reporting_mismatch_blocks_reconciled_claim_even_when_votes_agree():
    pending = PRECINCT.replace(b";1;1;", b";0;1;")
    race = build_races(parse(pending), catalogue(), summary=summary())["races"][0]
    assert not race["coverage"]["reconciled"]
    assert any(
        "Precinct reporting does not reconcile" in e for e in race["coverage"]["errors"]
    )


def test_local_geography_fails_closed_until_its_reconciliation_exists():
    local = replace(
        catalogue(),
        election=replace(
            catalogue().election,
            source_kind="local_cand",
            source_url="https://electionresultsfiles.sos.mn.gov/20261103/LocalCandTbl.txt",
        ),
    )
    with pytest.raises(ElectionResultsError, match="local race geography"):
        build_races(parse(), local)


def test_write_in_only_contest_is_retained_without_inventing_a_person():
    extra = b"MN;01;0005;0405;County Attorney;;9901;WRITE-IN;;;WI;1;1;4;100.00;4\n"
    county_summary = parse(
        (PRECINCT + extra).replace(b";0005;", b";;"),
        geography="county",
        source_url="https://electionresultsfiles.sos.mn.gov/20261103/allracesbycounty.txt",
    )
    result = build_races(parse(PRECINCT + extra), catalogue(), summary=county_summary)
    race = next(r for r in result["races"] if r["office_id"] == "0405")
    assert race["race_id"] == "election:201:jurisdiction:01:office:0405"
    assert race["roster_state"] == "no_named_candidates_in_register"
    assert race["coverage"]["reconciled"]
    assert race["candidates"][0]["candidate_id"] is None
    assert race["candidates"][0]["votes"] == 4


# Original public-file Bruno excerpts; one municipality-specific hospital seat.
LOCAL_PRECINCT = (
    b"MN;58;0045;6003;Hospital District Board Member (Bruno);1410;9001;Douglas Blechinger;;;NP;1;1;32;96.97;33\n"
    b"MN;58;0045;6003;Hospital District Board Member (Bruno);1410;9901;WRITE-IN;;;WI;1;1;1;3.03;33\n"
)
LOCAL_ROSTER = b"0829060039001;Douglas Blechinger;6003;Hospital District Board Member (Bruno);58;08290;\n"
LOCAL_SUMMARY = LOCAL_PRECINCT.replace(b"MN;58;0045;", b"MN;;;").replace(
    b";1410;", b";08290;"
)


def local_build(
    precinct=LOCAL_PRECINCT,
    roster=LOCAL_ROSTER,
    summary_body=LOCAL_SUMMARY,
    *,
    more_summaries=(),
    municipalities=None,
):
    from alethical.pipeline.candidate_catalogue import parse_local_candidate_catalogue
    from alethical.pipeline.election_results import build_local_races

    context = ElectionContext(
        "201",
        DAY,
        "general",
        "https://electionresultsfiles.sos.mn.gov/20261103/LocalCandTbl.txt",
        "unverified",
        source_kind="local_cand",
    )
    return build_local_races(
        parse(
            precinct,
            source_url="https://electionresultsfiles.sos.mn.gov/20261103/localPrct.txt",
        ),
        parse_local_candidate_catalogue(roster, election=context, fetched_at=FETCHED),
        summaries=(
            parse(
                summary_body,
                geography="race",
                source_url="https://electionresultsfiles.sos.mn.gov/20261103/hospital.txt",
            ),
            *more_summaries,
        ),
        precinct_municipalities=municipalities or {("58", "0045"): "08290"},
        precinct_register_sha256="e" * 64,
    )


def test_real_hospital_excerpt_uses_official_precinct_municipality_bridge():
    built = local_build()
    race = built["races"][0]
    assert race["coverage"]["reconciled"] is True
    assert race["jurisdiction_kind"] == "hospital_municipal_seat"
    assert race["jurisdiction_id"] == "hospital_municipal_seat:8290"
    assert race["geography_bridge"][0]["hospital_district_id"] == "1410"
    assert race["geography_bridge"][0]["municipality_fips"] == "08290"
    assert race["precinct_rows"][0]["district"] == "1410"
    assert race["candidates"][0]["candidate_id"] == "0829060039001"
    assert [c["votes"] for c in race["candidates"]] == [32, 1]
    assert all(c["outcome"] is None for c in race["candidates"])
    assert race["seats_to_elect"] is None
    assert ":local:" in race["race_id"]


def test_local_summary_duplicates_preserve_both_sources_without_double_counting():
    duplicate = parse(
        LOCAL_SUMMARY,
        geography="race",
        source_url="https://electionresultsfiles.sos.mn.gov/20261103/local.txt",
    )
    race = local_build(more_summaries=(duplicate,))["races"][0]
    assert race["coverage"]["reconciled"] is True
    assert race["candidates"][0]["votes"] == 32
    assert len(race["candidates"][0]["summary_sources"]) == 2


def test_local_summary_conflicting_duplicate_refuses_to_choose_version():
    conflicting = parse(LOCAL_SUMMARY.replace(b";32;", b";31;"), geography="race")
    with pytest.raises(ElectionResultsError, match="conflicting duplicate"):
        local_build(more_summaries=(conflicting,))


def test_local_missing_geography_bridge_is_not_joined_by_candidate_name():
    with pytest.raises(
        ElectionResultsError, match="missing or ambiguous summary geography"
    ):
        local_build(municipalities={("58", "0045"): "99999"})


def test_local_name_conflict_makes_race_unavailable_without_erasing_source():
    race = local_build(
        roster=LOCAL_ROSTER.replace(b"Douglas Blechinger", b"Different Person")
    )["races"][0]
    assert race["coverage"]["reconciled"] is False
    assert "named register" in " ".join(race["coverage"]["errors"])
    assert race["precinct_rows"][0]["candidate_name"] == "Douglas Blechinger"


def test_local_multi_seat_school_keeps_all_candidates_and_explicit_seat_count():
    # Synthetic school contest: votes are selections, not distinct voters.
    precinct = (
        b"MN;01;0005;5000;School Board Member (ISD #1) (Elect 2);1;9001;One;;;NP;1;1;12;60;20\n"
        b"MN;01;0005;5000;School Board Member (ISD #1) (Elect 2);1;9002;Two;;;NP;1;1;8;40;20\n"
        b"MN;01;0005;5000;School Board Member (ISD #1) (Elect 2);1;9901;WRITE-IN;;;WI;1;1;0;0;20\n"
    )
    roster = (
        b"0000150009001;One;5000;School Board Member (ISD #1) (Elect 2);02;;0001\n"
        b"0000150009002;Two;5000;School Board Member (ISD #1) (Elect 2);02;;0001\n"
    )
    summary_body = (
        precinct.replace(b"MN;01;0005;", b"MN;;;")
        .replace(b";1;900", b";0001;900")
        .replace(b";1;9901", b";0001;9901")
    )
    race = local_build(
        precinct, roster, summary_body, municipalities={("01", "0005"): "00460"}
    )["races"][0]
    assert race["coverage"]["reconciled"] is True
    assert race["seats_to_elect"] == 2
    assert race["jurisdiction_kind"] == "school_district"
    assert len(race["candidates"]) == 3
    # A school subdistrict can have precincts outside the catalogue's county.
    assert race["county_ids"] == ["01"]
    assert race["candidates"][0]["candidate_stable_id"].split(":")[4] == "02"


def test_local_questions_are_accounted_separately_from_candidates():
    question = (
        b"MN;58;0045;6090;Hospital Question;1410;0001;YES;;;NP;1;1;10;50;20\n"
        b"MN;58;0045;6090;Hospital Question;1410;0002;NO;;;NP;1;1;10;50;20\n"
    )
    built = local_build(
        LOCAL_PRECINCT + question,
        summary_body=LOCAL_SUMMARY + question.replace(b"MN;58;0045;", b"MN;;;"),
    )
    assert len(built["races"]) == 1
    assert len(built["excluded_rows"]) == 2
    assert len(built["excluded_summary_rows"]) == 2
    assert built["source_counts"]["ballot_questions"] == 1
