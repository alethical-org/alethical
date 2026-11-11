from __future__ import annotations

import hashlib
import importlib.util
import json
from pathlib import Path

import pytest


ROOT = Path(__file__).resolve().parents[2]
SPEC = importlib.util.spec_from_file_location(
    "election_comparison_command", ROOT / "scripts" / "election_comparison.py"
)
assert SPEC and SPEC.loader
command = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(command)


@pytest.fixture
def source_set(tmp_path):
    # Synthetic one-precinct fixture. No actual statewide completeness claim.
    precinct = (
        b"MN;01;0005;0335;Attorney General;;0401;Keith Ellison;;;DFL;1;1;384;42.29;908\n"
        b"MN;01;0005;0335;Attorney General;;0302;Ronald J. Schutz;;;R;1;1;524;57.71;908\n"
        b"MN;01;0005;0335;Attorney General;;9901;WRITE-IN;;;WI;1;1;0;0.00;908\n"
    )
    files = {
        "cand.txt": b"03350401;Keith Ellison;0335;Attorney General;88;04;DFL\n03350302;Ronald J. Schutz;0335;Attorney General;88;03;R\n",
        "allracesbyprecinct.txt": precinct,
        "allracesbycounty.txt": precinct.replace(b";0005;", b";;"),
        "PrctTbl.txt": b"01;0005;AITKIN;8;10A;01;09;3001;00460;\n",
        "Cntytbl.txt": b"01;Aitkin;1\n",
        "pctstats.txt": b"MN;01;0005;AITKIN;1;1423;32;621;307;0;0;928\n",
        "home.html": b'<h1>State General Election</h1><p>Tuesday, November 3, 2026</p><p>Results are unofficial until canvassing</p><a href="/Results?ersElectionId=201&amp;scenario=state">Results</a>',
    }
    manifest = []
    for name, body in files.items():
        (tmp_path / name).write_bytes(body)
        manifest.append(
            {
                "file": name,
                "url": "https://electionresults.sos.mn.gov/20261103"
                if name == "home.html"
                else "https://electionresultsfiles.sos.mn.gov/20261103/" + name,
                "sha256": hashlib.sha256(body).hexdigest(),
                "bytes": len(body),
                "fetched_at": "2026-11-11T15:00:00+00:00",
            }
        )
    path = tmp_path / "manifest.json"
    path.write_text(json.dumps(manifest))
    return tmp_path, path


def argv(source_set, action="prepare", output="coverage.json"):
    directory, manifest = source_set
    return [
        action,
        "--directory",
        str(directory),
        "--manifest",
        str(manifest),
        "--election-id",
        "201",
        "--election-date",
        "2026-11-03",
        "--output",
        str(directory / output),
    ]


def replace_source(source_set, name, body):
    directory, manifest = source_set
    (directory / name).write_bytes(body)
    entries = json.loads(manifest.read_text())
    for entry in entries:
        if entry["file"] == name:
            entry.update(sha256=hashlib.sha256(body).hexdigest(), bytes=len(body))
    manifest.write_text(json.dumps(entries))


def test_prepare_is_offline_and_preserves_county_and_precinct_names(
    source_set, monkeypatch, capsys
):
    monkeypatch.setattr(
        command,
        "execute_stage",
        lambda *a, **kw: pytest.fail("Unexpected external write"),
    )
    assert command.main(argv(source_set)) == 0
    report = json.loads(capsys.readouterr().out)
    assert report["executed"] is False
    assert report["coverage"]["races"] == 1
    assert report["coverage"]["reconciled_races"] == 1
    assert report["coverage"]["county_names"] == {"01": "Aitkin"}
    assert report["coverage"]["registered_precincts"] == 1
    assert report["coverage"]["local_coverage"]["publication"] == "not_included"
    assert json.loads((source_set[0] / "coverage.json").read_text()) == report


def test_stage_defaults_to_dry_run_even_with_production_target(
    source_set, monkeypatch, capsys
):
    monkeypatch.setattr(
        command,
        "execute_stage",
        lambda *a, **kw: pytest.fail("Unexpected external write"),
    )
    assert command.main(argv(source_set, "stage") + ["--target", "production"]) == 0
    assert json.loads(capsys.readouterr().out)["executed"] is False


def test_explicit_stage_receives_all_verified_originals_but_never_publishes(
    source_set, monkeypatch, capsys
):
    calls = []
    monkeypatch.setattr(
        command,
        "execute_stage",
        lambda generation, originals, target: calls.append(
            (generation, originals, target)
        ),
    )
    monkeypatch.setattr(
        command, "execute_publish", lambda *a, **kw: pytest.fail("Stage published")
    )
    assert command.main(argv(source_set, "stage") + ["--execute"]) == 0
    generation, originals, target = calls[0]
    assert target == "local"
    assert len(originals) == 7
    assert generation["precincts"][0]["name"] == "AITKIN"
    assert json.loads(capsys.readouterr().out)["executed"] is True


def test_repeat_read_has_identical_generation_identity(source_set, capsys):
    assert command.main(argv(source_set)) == 0
    first = json.loads(capsys.readouterr().out)["snapshot_id"]
    manifest = source_set[1]
    entries = json.loads(manifest.read_text())
    for entry in entries:
        entry["fetched_at"] = "2026-11-12T15:00:00+00:00"
    manifest.write_text(json.dumps(entries))
    assert command.main(argv(source_set, output="second.json")) == 0
    assert json.loads(capsys.readouterr().out)["snapshot_id"] == first


def test_changed_hash_fails_before_any_external_action(source_set, monkeypatch, capsys):
    (source_set[0] / "cand.txt").write_bytes(b"changed")
    monkeypatch.setattr(
        command,
        "execute_stage",
        lambda *a, **kw: pytest.fail("Unexpected external write"),
    )
    assert command.main(argv(source_set, "stage") + ["--execute"]) == 2
    assert "fingerprint changed" in capsys.readouterr().err


@pytest.mark.parametrize(
    "text",
    [
        b'<h1>Test Results</h1><p>General election November 3, 2026 unofficial</p><a href="?ersElectionId=201">Results</a>',
        b'<h1>CAPTCHA</h1><p>General election November 3, 2026 unofficial</p><a href="?ersElectionId=201">Results</a>',
        b'<h1>General election November 3, 2026</h1><p>Official results</p><a href="?ersElectionId=201">Results</a>',
        b'<h1>General election November 3, 2026 unofficial</h1><a href="?ersElectionId=170">Results</a>',
    ],
)
def test_invalid_status_proof_is_not_promoted_to_real_results(source_set, text, capsys):
    replace_source(source_set, "home.html", text)
    assert command.main(argv(source_set)) == 2
    assert capsys.readouterr().err


def test_incomplete_precinct_register_fails_closed(source_set, capsys):
    replace_source(source_set, "Cntytbl.txt", b"01;Aitkin;2\n")
    assert command.main(argv(source_set)) == 2
    assert "expected counts" in capsys.readouterr().err


def test_duplicate_precinct_statistics_fails_closed(source_set, capsys):
    body = (source_set[0] / "pctstats.txt").read_bytes()
    replace_source(source_set, "pctstats.txt", body + body)
    assert command.main(argv(source_set)) == 2
    assert "duplicate precinct statistics" in capsys.readouterr().err


def test_manifest_cannot_read_a_file_outside_source_directory(source_set, capsys):
    entries = json.loads(source_set[1].read_text())
    entries[0]["file"] = "../outside.txt"
    source_set[1].write_text(json.dumps(entries))
    assert command.main(argv(source_set)) == 2
    assert "inside its directory" in capsys.readouterr().err


def test_report_is_not_overwritten_and_no_write_occurs(source_set, monkeypatch, capsys):
    (source_set[0] / "coverage.json").write_text("prior evidence")
    monkeypatch.setattr(
        command,
        "execute_stage",
        lambda *a, **kw: pytest.fail("Unexpected external write"),
    )
    assert command.main(argv(source_set, "stage") + ["--execute"]) == 2
    assert (source_set[0] / "coverage.json").read_text() == "prior evidence"
    assert "already exists" in capsys.readouterr().err


def test_publish_requires_exact_ids_and_does_not_write_by_default(monkeypatch, capsys):
    monkeypatch.setattr(
        command,
        "execute_publish",
        lambda *a, **kw: pytest.fail("Unexpected external write"),
    )
    assert (
        command.main(
            [
                "publish",
                "--snapshot-id",
                "a" * 64,
                "--expected-previous",
                "none",
                "--target",
                "production",
            ]
        )
        == 0
    )
    report = json.loads(capsys.readouterr().out)
    assert report["executed"] is False
    assert report["previous"] is None
    assert report["restore"] is False
    assert (
        command.main(
            ["publish", "--snapshot-id", "a" * 64, "--expected-previous", "short-id"]
        )
        == 2
    )


def test_restore_is_only_forwarded_when_explicit(monkeypatch, capsys):
    calls = []
    monkeypatch.setattr(
        command, "execute_publish", lambda *a, **kw: calls.append((a, kw)) or {}
    )
    assert (
        command.main(
            [
                "publish",
                "--snapshot-id",
                "a" * 64,
                "--expected-previous",
                "b" * 64,
                "--execute",
                "--restore",
            ]
        )
        == 0
    )
    assert calls == [(("a" * 64, "b" * 64, "local"), {"restore": True})]
    assert json.loads(capsys.readouterr().out)["executed"] is True


def test_stage_failure_does_not_claim_success_or_leak_connection_detail(
    source_set, monkeypatch, capsys
):
    def fail(*args, **kwargs):
        raise RuntimeError("simulated database failure containing test password")

    monkeypatch.setattr(command, "execute_stage", fail)
    assert command.main(argv(source_set, "stage") + ["--execute"]) == 1
    output = capsys.readouterr()
    assert "password" not in output.out + output.err
    assert (
        json.loads((source_set[0] / "coverage.json").read_text())["executed"] is False
    )


def test_voter_bound_discrepancy_is_sourced_without_changing_votes(source_set):
    from argparse import Namespace
    from datetime import date

    replace_source(
        source_set, "pctstats.txt", b"MN;01;0005;AITKIN;1;1423;32;621;307;0;0;900\n"
    )
    generation, _ = command.prepare_from_files(
        Namespace(
            directory=source_set[0],
            manifest=source_set[1],
            election_date=date(2026, 11, 3),
            election_id="201",
            stage="general",
            status_file="home.html",
        )
    )
    checks = generation["coverage"]["comparison_checks"]
    assert checks["within_feed_reconciliation"]["status"] == "complete"
    assert checks["independent_canvass_validation"]["status"] == "not_performed"
    bound = checks["precinct_voter_bound"]
    assert bound["discrepancy_count"] == 1
    assert bound["discrepancies"][0]["office_votes"] == 908
    assert bound["discrepancies"][0]["total_voted"] == 900
    assert bound["discrepancies"][0]["result_row_numbers"] == [1, 2, 3]
    assert bound["discrepancies"][0]["statistics_row_number"] == 1
    assert all(len(source["sha256"]) == 64 for source in bound["sources"])
    assert generation["races"][0]["payload"]["total_votes"] == 908
    assert generation["races"][0]["result_status"] == "unofficial"


def test_voter_bound_does_not_assume_multiseat_offices_are_single_seat():
    result = command.precinct_voter_check(
        {
            "races": [
                {
                    "office_name": "School Board Member",
                    "race_id": "school",
                    "precinct_rows": [],
                }
            ]
        },
        {},
        {
            name: {"metadata": {"sha256": "a" * 64}}
            for name in ("allracesbyprecinct.txt", "pctstats.txt")
        },
    )
    assert result["checked_precinct_races"] == 0
    assert result["unchecked_race_ids"] == ["school"]


@pytest.mark.parametrize(
    ("office", "counties", "stage", "expected"),
    [
        ("Attorney General", ["01", "02"], "general", "state"),
        ("State Representative District 1A", ["01"], "general", "county"),
        ("State Senator District 1", ["01", "02"], "general", "state"),
        ("U.S. Representative District 1", ["01"], "general", "state"),
        ("County Sheriff", ["01"], "general", "county"),
        ("County Sheriff", ["01"], "primary", None),
        ("Unknown Office", ["01"], "general", None),
        ("Soil and Water Supervisor District 1", ["01"], "general", None),
    ],
)
def test_expected_authority_is_scoped_to_office_counties_and_general_election(
    office, counties, stage, expected
):
    from argparse import Namespace
    from datetime import date

    law_url = "https://www.revisor.mn.gov/statutes/2026/cite/204C.33"
    # Short excerpts from 204C.33 subdivisions 1 and 3. These establish expected
    # jurisdiction only, never evidence that any actual canvass occurred.
    law = b"CANVASS OF STATE GENERAL ELECTIONS each county and state office voted for only within the county each federal office and for each state office voted on in more than one county"
    race = {
        "office_name": office,
        "coverage": {"reconciled": True},
        "source_sha256": "b" * 64,
        "precinct_rows": [
            {"county_id": county, "row_number": i + 1}
            for i, county in enumerate(counties)
        ],
    }
    command.add_expected_authorities(
        {"races": [race]},
        {
            "law": {
                "body": law,
                "metadata": {"url": law_url, "sha256": hashlib.sha256(law).hexdigest()},
            }
        },
        {"01": {"name": "Aitkin"}, "02": {"name": "Anoka"}},
        Namespace(stage=stage, election_date=date(2026, 11, 3)),
    )
    authority = race["expected_certification_authority"]
    assert authority["level"] == expected
    assert authority["certification_observed"] is False
    assert authority["county_ids"] == counties
    if expected:
        assert len(authority["evidence"]) == 2
        assert "#stat.204C.33." in authority["evidence"][0]["source_url"]
    else:
        assert authority["status"] == "unknown"
        assert authority["evidence"] == []


def test_include_local_requires_complete_retained_sources(source_set, capsys):
    assert command.main(argv(source_set) + ["--include-local"]) == 2
    assert "Local source is missing" in capsys.readouterr().err


def test_include_local_combines_namespaces_and_keeps_questions_separate(
    source_set, capsys
):
    from alethical.tests.test_election_results import (
        LOCAL_PRECINCT,
        LOCAL_ROSTER,
        LOCAL_SUMMARY,
    )

    directory, manifest = source_set
    # Synthetic reuse of the Bruno shape under this fixture's one registered
    # precinct. It proves the command wiring, not actual Aitkin hospital results.
    local = LOCAL_PRECINCT.replace(b"MN;58;0045;", b"MN;01;0005;")
    summary = LOCAL_SUMMARY.replace(b";08290;", b";00460;")
    roster = LOCAL_ROSTER.replace(b"08290", b"00460").replace(b";58;", b";01;")
    question = (
        b"MN;01;0005;5090;School Question;1;0001;YES;;;NP;1;1;1;50;2\n"
        b"MN;01;0005;5090;School Question;1;0002;NO;;;NP;1;1;1;50;2\n"
    )
    bodies = {
        "localPrct.txt": local + question,
        "LocalCandTbl.txt": roster,
        "local.txt": summary,
        "hospital.txt": summary,
        "SDRaceQuestions.txt": question.replace(b"MN;01;0005;", b"MN;;;"),
    }
    entries = json.loads(manifest.read_text())
    for name, body in bodies.items():
        (directory / name).write_bytes(body)
        entries.append(
            {
                "file": name,
                "url": "https://electionresultsfiles.sos.mn.gov/20261103/" + name,
                "sha256": hashlib.sha256(body).hexdigest(),
                "bytes": len(body),
                "fetched_at": "2026-11-11T15:00:00+00:00",
            }
        )
    manifest.write_text(json.dumps(entries))
    assert command.main(argv(source_set) + ["--include-local"]) == 0
    report = json.loads(capsys.readouterr().out)
    assert report["coverage"]["races"] == 2
    assert report["coverage"]["reconciled_races"] == 2
    assert report["coverage"]["named_candidacies"] == 3
    assert report["coverage"]["local_coverage"]["counts"]["ballot_questions"] == 1
    assert (
        report["coverage"]["local_coverage"]["counts"]["municipality_bridge_rows"] == 2
    )
    assert report["coverage"]["local_coverage"]["unmatched_roster"] == []
    assert report["excluded_result_rows"] == 2
    assert report["excluded_summary_rows"] == 2
