from __future__ import annotations

import hashlib
import json
from dataclasses import FrozenInstanceError, replace
from datetime import date, datetime, timezone
from pathlib import Path

import pytest

from alethical.pipeline.candidate_catalogue import (
    CandidateCatalogueError,
    ElectionContext,
    OfficeCoverage,
    catalogue_document,
    import_candidate_file,
    load_candidate_snapshot,
    main,
    parse_candidate_catalogue,
    parse_local_candidate_catalogue,
)

FIXTURES = Path(__file__).parent / "fixtures" / "candidates"
FETCHED = datetime(2026, 9, 30, 12, tzinfo=timezone.utc)
ELECTION = ElectionContext(
    "201",
    date(2026, 11, 3),
    "general",
    "https://electionresultsfiles.sos.mn.gov/20261103/cand.txt",
    "test",
)
LOCAL = replace(
    ELECTION,
    source_kind="local_cand",
    source_url="https://electionresultsfiles.sos.mn.gov/20261103/LocalCandTbl.txt",
)
BODY = (FIXTURES / "cand-excerpt.txt").read_bytes()
LOCAL_BODY = (FIXTURES / "local_cand-excerpt.txt").read_bytes()
ROW = b"01880301;John Burkel;0188;State Representative District 1A;88;03;R"


def parse(body=BODY, **kwargs):
    return parse_candidate_catalogue(
        body, election=ELECTION, fetched_at=FETCHED, **kwargs
    )


def evidence(group="house:1A", status="complete", **kwargs):
    return OfficeCoverage(
        group,
        status,
        kwargs.get("election_id", "201"),
        kwargs.get("source_sha256", hashlib.sha256(BODY).hexdigest()),
        "https://www.sos.mn.gov/elections-voting/",
        "Operator reviewed separate official evidence of this source's race coverage.",
    )


def test_official_excerpt_preserves_every_field_and_provenance():
    catalogue = parse()
    candidate = catalogue.race("house", "1A").candidates[0]
    assert candidate.candidate_id == "01880301"
    assert candidate.office_id == "0188"
    assert candidate.county_id == "88"
    assert candidate.party_id == "03"
    assert candidate.party_abbreviation == "R"
    assert candidate.raw_row.encode("windows-1252") == ROW
    assert candidate.source_sha256 == hashlib.sha256(BODY).hexdigest()
    assert BODY.splitlines()[candidate.row_number - 1] == ROW
    assert catalogue.source_bytes == BODY
    assert catalogue.election == ELECTION
    assert catalogue.publication_status == "staged_only"
    assert catalogue.race("house", "1A").coverage == "unknown"
    with pytest.raises(FrozenInstanceError):
        candidate.name = "Changed"


def test_tickets_remain_official_names_and_no_people_are_fabricated():
    names = [item.name for item in parse().race("governor").candidates]
    assert "Amy Klobuchar and Ben Schierer" in names
    assert "Amy Klobuchar" not in names
    assert all(" and " in name for name in names)
    document = catalogue_document(parse())
    assert "incumbent" not in document["candidates"][0]
    assert "website" not in document["candidates"][0]


def test_exact_districts_and_neutral_order_independent_of_party_source_order():
    catalogue = parse()
    assert {item.name for item in catalogue.race("house", "1A").candidates} == {
        "John Burkel",
        "Leanna Sandahl",
    }
    assert {item.name for item in catalogue.race("house", "11A").candidates} == {
        "Chris Swanson",
        "Jeff Dotseth",
    }
    assert (
        catalogue.race("house", "01a").candidates
        == catalogue.race("house", "1A").candidates
    )
    reversed_catalogue = parse(b"\n".join(reversed(BODY.splitlines())))
    assert [item.name for item in reversed_catalogue.candidates] == [
        item.name for item in catalogue.candidates
    ]
    for kind, district in [
        ("house", "68A"),
        ("house", "1"),
        ("senate", "1A"),
        ("local", None),
        ("governor", "1"),
    ]:
        with pytest.raises(CandidateCatalogueError):
            catalogue.race(kind, district)


def test_county_scoped_ids_and_unsupported_offices_are_retained():
    candidates = [
        item for item in parse().candidates if item.candidate_id == "03919001"
    ]
    assert len(candidates) == 2
    assert len({item.stable_id for item in candidates}) == 2
    assert {item.county_id for item in candidates} == {"01", "02"}
    assert all(item.office_kind is None for item in candidates)
    assert all(item.office_group.startswith("source:") for item in candidates)
    assert parse().race("house", "2A").coverage == "unknown"
    assert parse().race("house", "2A").candidates == ()
    groups = catalogue_document(parse())["office_groups"]
    assert {item["coverage"] for item in groups} == {"unknown"}


def test_same_source_in_different_elections_never_shares_identity():
    primary = ElectionContext(
        "200",
        date(2026, 8, 11),
        "primary",
        "https://electionresultsfiles.sos.mn.gov/20260811/cand.txt",
        "unverified",
    )
    other = parse_candidate_catalogue(BODY, election=primary, fetched_at=FETCHED)
    assert {item.stable_id for item in other.candidates}.isdisjoint(
        {item.stable_id for item in parse().candidates}
    )


@pytest.mark.parametrize(
    "body",
    [
        b"",
        b"\n",
        b"<html>Unavailable</html>",
        ROW + b";extra",
        b"bad\n" + ROW,
        ROW + b"\n\n" + ROW,
        ROW.replace(b"John Burkel", b""),
        ROW.replace(b"01880301", b"1880301"),
        ROW + b"\x00",
        ROW.replace(b"John", b"Jo\x81n"),
        ROW.replace(b";03;", b";xx;"),
    ],
)
def test_malformed_source_rejects_whole_snapshot(body):
    with pytest.raises(CandidateCatalogueError):
        parse(body)


def test_strict_encoding_preserves_accented_names():
    body = ROW.replace(b"John Burkel", b"Ren\xe9")
    assert parse(body).candidates[0].name == "René"
    with pytest.raises(CandidateCatalogueError):
        parse_candidate_catalogue(
            body,
            election=replace(ELECTION, source_encoding="utf-8"),
            fetched_at=FETCHED,
        )


@pytest.mark.parametrize("second", [ROW, ROW.replace(b"John Burkel", b"Other Person")])
def test_duplicate_identity_rejected_including_conflicting_names(second):
    with pytest.raises(CandidateCatalogueError, match="duplicate"):
        parse(ROW + b"\n" + second)


def test_coverage_requires_separate_election_and_source_scoped_evidence():
    assert parse(coverage=(evidence(),)).race("house", "1A").coverage == "complete"
    assert (
        parse(coverage=(evidence(status="incomplete"),)).race("house", "1A").coverage
        == "incomplete"
    )
    race = parse(coverage=(evidence(group="house:2A"),)).race("house", "2A")
    assert race.candidates == () and race.coverage == "complete"
    assert race.publication_status == "staged_only"
    for item in [
        evidence(election_id="200"),
        evidence(source_sha256="0" * 64),
        replace(evidence(), note=""),
        replace(evidence(), evidence_url=""),
        replace(evidence(), status="empty"),
    ]:
        with pytest.raises(CandidateCatalogueError):
            parse(coverage=(item,))


def test_source_context_cannot_claim_certified_or_use_unrelated_url():
    for changes in (
        {"source_stage": "certified"},
        {"source_url": "https://example.com/cand.txt"},
        {"source_url": "https://electionresultsfiles.sos.mn.gov/20260811/cand.txt"},
        {"election_id": "../bad"},
    ):
        with pytest.raises(CandidateCatalogueError):
            replace(ELECTION, **changes)
    with pytest.raises(CandidateCatalogueError):
        parse_candidate_catalogue(
            BODY, election=ELECTION, fetched_at=FETCHED.replace(tzinfo=None)
        )


def test_local_excerpt_retains_names_and_jurisdiction_without_invented_party():
    catalogue = parse_local_candidate_catalogue(
        LOCAL_BODY, election=LOCAL, fetched_at=FETCHED
    )
    municipal = next(
        item for item in catalogue.candidates if item.name == "Jerry J. Eggert"
    )
    assert municipal.candidate_id == "0013640109001"
    assert municipal.municipal_fips_code == "00136"
    assert municipal.school_district_number is None
    assert municipal.party_id is None and municipal.party_abbreviation is None
    hospital = next(
        item for item in catalogue.candidates if item.name == "Ellen Bomstad"
    )
    assert (
        hospital.municipal_fips_code is None and hospital.school_district_number is None
    )
    assert hospital.office_kind is None
    school = [
        item for item in catalogue.candidates if item.school_district_number == "0001"
    ]
    assert any("ISD #1" in item.office_title for item in school)
    assert any("SSD #1" in item.office_title for item in school)
    assert len({item.stable_id for item in school}) == len(school)
    assert all(item.office_kind is None for item in catalogue.candidates)
    assert catalogue.race("house", "1A").coverage == "unknown"
    with pytest.raises(CandidateCatalogueError):
        parse_candidate_catalogue(LOCAL_BODY, election=LOCAL, fetched_at=FETCHED)
    with pytest.raises(CandidateCatalogueError):
        parse_local_candidate_catalogue(BODY, election=ELECTION, fetched_at=FETCHED)


def test_atomic_import_replay_retains_bytes_and_rejects_tampering(tmp_path):
    source = tmp_path / "input.txt"
    source.write_bytes(BODY)
    output = tmp_path / "snapshots"
    path = import_candidate_file(source, output, election=ELECTION, fetched_at=FETCHED)
    assert (path / "source.bin").read_bytes() == BODY
    assert load_candidate_snapshot(path) == parse()
    assert (
        import_candidate_file(source, output, election=ELECTION, fetched_at=FETCHED)
        == path
    )
    with pytest.raises(CandidateCatalogueError, match="different metadata"):
        import_candidate_file(
            source,
            output,
            election=replace(ELECTION, source_stage="unverified"),
            fetched_at=FETCHED,
        )
    document = json.loads((path / "catalogue.json").read_text())
    document["candidates"][0]["name"] = "Changed"
    (path / "catalogue.json").write_text(json.dumps(document))
    with pytest.raises(CandidateCatalogueError):
        import_candidate_file(source, output, election=ELECTION, fetched_at=FETCHED)
    (path / "source.bin").write_bytes(b"broken")
    with pytest.raises(CandidateCatalogueError):
        load_candidate_snapshot(path)
    assert not list(output.rglob(".candidate-import-*"))


def test_bad_import_never_creates_output_and_cli_requires_context(tmp_path):
    source = tmp_path / "bad.txt"
    source.write_bytes(b"<html>error</html>")
    with pytest.raises(CandidateCatalogueError):
        import_candidate_file(
            source, tmp_path / "out", election=ELECTION, fetched_at=FETCHED
        )
    assert not (tmp_path / "out").exists()
    with pytest.raises(SystemExit):
        main([str(source)])


def test_local_import_cli_and_roundtrip(tmp_path, capsys):
    source = tmp_path / "LocalCandTbl.txt"
    source.write_bytes(LOCAL_BODY)
    assert (
        main(
            [
                str(source),
                "--output-directory",
                str(tmp_path / "out"),
                "--election-id",
                "201",
                "--election-date",
                "2026-11-03",
                "--election-type",
                "general",
                "--source-kind",
                "local_cand",
                "--source-url",
                LOCAL.source_url,
                "--source-stage",
                "test",
                "--fetched-at",
                FETCHED.isoformat(),
            ]
        )
        == 0
    )
    saved = load_candidate_snapshot(Path(capsys.readouterr().out.strip()))
    assert saved.election == LOCAL
    assert saved.source_bytes == LOCAL_BODY


def test_regenerated_valid_source_and_json_cannot_replace_original_hash_directory(
    tmp_path,
):
    source = tmp_path / "input.txt"
    source.write_bytes(BODY)
    path = import_candidate_file(
        source, tmp_path / "out", election=ELECTION, fetched_at=FETCHED
    )
    changed = BODY.replace(b"John Burkel", b"Changed Name")
    replacement = parse(changed)
    (path / "source.bin").write_bytes(changed)
    (path / "catalogue.json").write_text(json.dumps(catalogue_document(replacement)))
    with pytest.raises(CandidateCatalogueError, match="directory does not match"):
        load_candidate_snapshot(path)


def test_valid_regenerated_metadata_cannot_relabel_snapshot_election(tmp_path):
    source = tmp_path / "input.txt"
    source.write_bytes(BODY)
    path = import_candidate_file(
        source, tmp_path / "out", election=ELECTION, fetched_at=FETCHED
    )
    primary = ElectionContext(
        "200",
        date(2026, 8, 11),
        "primary",
        "https://electionresultsfiles.sos.mn.gov/20260811/cand.txt",
        "test",
    )
    replacement = parse_candidate_catalogue(BODY, election=primary, fetched_at=FETCHED)
    (path / "catalogue.json").write_text(json.dumps(catalogue_document(replacement)))
    assert (path / "source.bin").read_bytes() == BODY
    with pytest.raises(
        CandidateCatalogueError, match="directory does not match election context"
    ):
        load_candidate_snapshot(path)
