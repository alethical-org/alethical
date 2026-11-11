#!/usr/bin/env python3
"""Prepare retained SOS returns offline; staging and publication are separate.

The default is a dry run. No command downloads election data. A stage execution
archives every verified original before committing its generation. Publication
requires an exact snapshot and expected previous pointer; --restore is explicit.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import sys
from collections import Counter, defaultdict
from datetime import date, datetime
from html.parser import HTMLParser
from pathlib import Path
from typing import Literal
from urllib.parse import urlparse

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from alethical.pipeline.candidate_catalogue import (  # noqa: E402
    ElectionContext,
    parse_candidate_catalogue,
    parse_local_candidate_catalogue,
)
from alethical.pipeline.election_comparison import (  # noqa: E402
    ComparisonImportError,
    archive_source,
    prepare_generation,
    publish_generation,
    stage_generation,
)
from alethical.pipeline.election_results import (  # noqa: E402
    build_races,
    build_local_races,
    parse_result_file,
)


class _VisibleText(HTMLParser):
    def __init__(self):
        super().__init__()
        self.parts = []
        self.hidden = 0

    def handle_starttag(self, tag, attrs):
        if tag in ("script", "style"):
            self.hidden += 1

    def handle_endtag(self, tag):
        if tag in ("script", "style"):
            self.hidden = max(0, self.hidden - 1)

    def handle_data(self, data):
        if not self.hidden:
            self.parts.append(data)


def _require(condition: bool, message: str) -> None:
    if not condition:
        raise ComparisonImportError(message)


def load_sources(
    directory: Path, manifest: Path, election_date: date
) -> tuple[dict, list]:
    """Verify every retained manifest input before reading any figures."""
    entries = json.loads(manifest.read_text(encoding="utf-8"))
    _require(
        isinstance(entries, list) and 0 < len(entries) <= 100,
        "Source manifest must contain 1–100 records",
    )
    sources, metadata = {}, []
    for entry in entries:
        _require(
            isinstance(entry, dict) and "error" not in entry,
            "Manifest includes a failed source",
        )
        url = entry.get("url", "")
        _require(isinstance(url, str), "Invalid source URL")
        parsed = urlparse(url)
        _require(
            parsed.scheme == "https"
            and (
                parsed.netloc
                in {"electionresultsfiles.sos.mn.gov", "electionresults.sos.mn.gov"}
                or url
                == f"https://www.revisor.mn.gov/statutes/{election_date.year}/cite/204C.33"
            ),
            "Only official election sources and the scoped canvass statute belong in this manifest",
        )
        if parsed.netloc == "electionresultsfiles.sos.mn.gov":
            _require(
                parsed.path.startswith(f"/{election_date:%Y%m%d}/")
                and not parsed.query
                and not parsed.fragment,
                "Source URL belongs to another election",
            )
        name = entry.get("file") or Path(parsed.path).name
        _require(
            isinstance(name, str)
            and name not in {".", ".."}
            and Path(name).name == name
            and "/" not in name
            and "\\" not in name,
            "Source filename must stay inside its directory",
        )
        _require(name not in sources, "Duplicate source filename")
        source_path = directory / name
        _require(
            source_path.resolve().parent == directory.resolve(),
            "Source file escapes its directory",
        )
        body = source_path.read_bytes()
        _require(len(body) <= 100_000_000, "Source exceeds the supported size")
        source_hash = entry.get("sha256", "")
        _require(
            isinstance(source_hash, str)
            and bool(re.fullmatch(r"[a-f0-9]{64}", source_hash)),
            "Source fingerprint is missing",
        )
        _require(
            hashlib.sha256(body).hexdigest() == source_hash,
            f"Source fingerprint changed: {name}",
        )
        _require(
            type(entry.get("bytes")) is int and entry["bytes"] == len(body),
            f"Source size changed: {name}",
        )
        meta = {
            k: entry[k]
            for k in (
                "url",
                "sha256",
                "bytes",
                "fetched_at",
                "last_modified",
                "content_type",
            )
            if k in entry
        }
        meta["file"] = name
        if parsed.netloc == "electionresultsfiles.sos.mn.gov":
            _require(
                "fetched_at" in meta, f"Source observation date is missing: {name}"
            )
        if "fetched_at" in meta:
            observed = datetime.fromisoformat(meta["fetched_at"])
            _require(
                observed.tzinfo is not None and observed.utcoffset() is not None,
                "Source observation date needs a timezone",
            )
        sources[name] = {"body": body, "metadata": meta}
        metadata.append(meta)
    return sources, sorted(metadata, key=lambda s: s["file"])


def _status_proof(
    source: dict, election_id: str, election_date: date, stage: str
) -> None:
    _require(
        source["metadata"]["url"]
        == f"https://electionresults.sos.mn.gov/{election_date:%Y%m%d}",
        "Status proof must be this election's results home",
    )
    html = source["body"].decode("utf-8", errors="strict")
    parser = _VisibleText()
    parser.feed(html)
    text = " ".join(" ".join(parser.parts).split()).lower()
    _require(
        not any(
            marker in text
            for marker in ("test results", "test election", "captcha", "access denied")
        ),
        "Status proof is test data or an unavailable page",
    )
    _require("unofficial" in text, "Source does not establish unofficial results")
    _require(
        f"{stage} election" in text,
        "Status proof does not establish the election stage",
    )
    date_text = f"{election_date:%B} {election_date.day}, {election_date.year}".lower()
    _require(date_text in text, "Status proof does not establish the election date")
    _require(
        bool(
            re.search(
                rf"ersElectionId={re.escape(election_id)}(?:[&\"'\s<]|$)",
                html,
                re.IGNORECASE,
            )
        ),
        "Status proof does not establish the results election ID",
    )


def _table(body: bytes, columns: int, label: str) -> list[list[str]]:
    rows = [
        line.split(";")
        for line in body.decode("windows-1252", errors="strict").splitlines()
    ]
    _require(
        bool(rows)
        and all(len(r) == columns and all(x == x.strip() for x in r) for r in rows),
        f"Invalid {label} table",
    )
    return rows


def precinct_voter_check(built: dict, statistics: dict, sources: dict) -> dict:
    """Cross-check known single-seat offices; never correct official vote counts."""
    checked, discrepancies, skipped = 0, [], []
    for race in built["races"]:
        title = race["office_name"]
        single_seat = title in {
            "U.S. Senator",
            "Governor & Lt Governor",
            "Secretary of State",
            "State Auditor",
            "Attorney General",
            "County Sheriff",
            "County Attorney",
        } or title.startswith(
            (
                "U.S. Representative District ",
                "State Senator District ",
                "State Representative District ",
                "County Commissioner District ",
            )
        )
        if not single_seat:
            skipped.append(race["race_id"])
            continue
        grouped = defaultdict(list)
        for row in race["precinct_rows"]:
            grouped[(row["county_id"], row["precinct_id"])].append(row)
        for key, rows in sorted(grouped.items()):
            checked += 1
            stats = statistics[key]
            total = rows[0]["total_votes"]
            if total > stats["total_voted"]:
                discrepancies.append(
                    {
                        "race_id": race["race_id"],
                        "office_id": race["office_id"],
                        "office_name": title,
                        "county_id": key[0],
                        "precinct_id": key[1],
                        "office_votes": total,
                        "total_voted": stats["total_voted"],
                        "excess": total - stats["total_voted"],
                        "result_row_numbers": [r["row_number"] for r in rows],
                        "statistics_row_number": stats["row_number"],
                    }
                )
    return {
        "status": "discrepancies"
        if discrepancies
        else "no_discrepancies_in_checked_scope",
        "checked_precinct_races": checked,
        "discrepancy_count": len(discrepancies),
        "discrepancies": discrepancies,
        "unchecked_race_ids": skipped,
        "scope": "Recognized single-seat federal, state executive, legislative, county sheriff, attorney and district commissioner offices",
        "limitation": "Other offices and multi-seat contests need separate vote limits; this is not canvass validation",
        "sources": [
            {k: v for k, v in sources[name]["metadata"].items() if k != "fetched_at"}
            for name in ("allracesbyprecinct.txt", "pctstats.txt")
        ],
    }


def add_expected_authorities(built: dict, sources: dict, counties: dict, args) -> dict:
    """Expected authority is a sourced routing hint, never certification evidence."""
    law_url = (
        f"https://www.revisor.mn.gov/statutes/{args.election_date.year}/cite/204C.33"
    )
    laws = [v for v in sources.values() if v["metadata"]["url"] == law_url]
    law = laws[0] if len(laws) == 1 else None
    if law:
        parser = _VisibleText()
        parser.feed(law["body"].decode("utf-8", errors="strict"))
        text = " ".join(" ".join(parser.parts).split())
        _require(
            all(
                phrase in text
                for phrase in (
                    "CANVASS OF STATE GENERAL ELECTIONS",
                    "each county and state office voted for only within the county",
                    "each federal office and for each state office voted on in more than one county",
                )
            ),
            "Retained canvass statute does not establish the authority rules",
        )
    counts = Counter()
    for race in built["races"]:
        title = race["office_name"]
        county_ids = sorted({r["county_id"] for r in race["precinct_rows"]})
        authority = {
            "status": "unknown",
            "level": None,
            "name": None,
            "county_ids": county_ids,
            "certification_observed": False,
            "reason": "Authority for this office has not been established from the retained sources",
            "evidence": [],
        }
        federal = title == "U.S. Senator" or title.startswith(
            "U.S. Representative District "
        )
        state = title in {
            "Governor & Lt Governor",
            "Secretary of State",
            "State Auditor",
            "Attorney General",
        } or title.startswith(
            ("State Senator District ", "State Representative District ")
        )
        county = title in {
            "County Sheriff",
            "County Attorney",
            "County Auditor/Treasurer",
            "County Recorder",
            "County Auditor",
            "County Treasurer",
            "County Surveyor",
        } or title.startswith(
            (
                "County Commissioner District ",
                "Special Election for County Commissioner District ",
            )
        )
        if (
            law
            and args.stage == "general"
            and race["coverage"]["reconciled"]
            and county_ids
        ):
            subdivision = None
            if federal or (state and len(county_ids) > 1):
                level, name, subdivision = (
                    "state",
                    "Minnesota State Canvassing Board",
                    "3",
                )
            elif (state or county) and len(county_ids) == 1:
                level, name, subdivision = (
                    "county",
                    f"{counties[county_ids[0]]['name']} County Canvassing Board",
                    "1",
                )
            if subdivision:
                authority.update(
                    status="expected",
                    level=level,
                    name=name,
                    reason="General-election office and county extent matched to the retained canvass statute",
                    evidence=[
                        {
                            "source_sha256": law["metadata"]["sha256"],
                            "source_url": law_url + "#stat.204C.33." + subdivision,
                            "locator": "stat.204C.33." + subdivision,
                        },
                        {
                            "source_sha256": race["source_sha256"],
                            "locator": "county extent in this race's precinct rows",
                            "row_numbers": [
                                next(
                                    r["row_number"]
                                    for r in race["precinct_rows"]
                                    if r["county_id"] == c
                                )
                                for c in county_ids
                            ],
                        },
                    ],
                )
        race["expected_certification_authority"] = authority
        counts[authority["level"] or "unknown"] += 1
    return dict(counts)


def prepare_from_files(args: argparse.Namespace) -> tuple[dict, dict[str, bytes]]:
    sources, metadata = load_sources(args.directory, args.manifest, args.election_date)
    for name in (
        "cand.txt",
        "allracesbyprecinct.txt",
        "allracesbycounty.txt",
        "PrctTbl.txt",
        "Cntytbl.txt",
        "pctstats.txt",
        args.status_file,
    ):
        _require(name in sources, f"Required source is missing: {name}")
    proof = sources[args.status_file]
    _status_proof(proof, args.election_id, args.election_date, args.stage)
    observations = [
        datetime.fromisoformat(s["fetched_at"]) for s in metadata if "fetched_at" in s
    ]
    _require(
        bool(observations), "At least one actual source observation date is required"
    )
    fetched_at = max(observations)

    def result(name: str, geography: Literal["precinct", "county", "race"]):
        source = sources[name]
        return parse_result_file(
            source["body"],
            election_id=args.election_id,
            election_date=args.election_date,
            source_url=source["metadata"]["url"],
            fetched_at=datetime.fromisoformat(source["metadata"]["fetched_at"]),
            source_stage="real",
            source_status="unofficial",
            status_evidence_url=proof["metadata"]["url"],
            status_evidence_sha256=proof["metadata"]["sha256"],
            geography=geography,
        )

    candidate_source = sources["cand.txt"]
    context = ElectionContext(
        args.election_id,
        args.election_date,
        args.stage,
        candidate_source["metadata"]["url"],
        "unverified",
    )
    catalogue = parse_candidate_catalogue(
        candidate_source["body"],
        election=context,
        fetched_at=datetime.fromisoformat(candidate_source["metadata"]["fetched_at"]),
    )
    built = build_races(
        result("allracesbyprecinct.txt", "precinct"),
        catalogue,
        summary=result("allracesbycounty.txt", "county"),
    )

    counties = {}
    for row in _table(sources["Cntytbl.txt"]["body"], 3, "county"):
        _require(
            bool(re.fullmatch(r"[0-9]{2}", row[0]))
            and 1 <= int(row[0]) <= 87
            and row[0] not in counties
            and bool(row[1])
            and row[2].isdigit(),
            "Invalid or duplicate county",
        )
        counties[row[0]] = {"name": row[1], "expected_precincts": int(row[2])}
    precinct_names = {}
    precinct_municipalities = {}
    county_counts = Counter()
    for row in _table(sources["PrctTbl.txt"]["body"], 10, "precinct"):
        key = (row[0], row[1])
        _require(
            row[0] in counties
            and bool(re.fullmatch(r"[0-9]{4}", row[1]))
            and key not in precinct_names
            and bool(row[2]),
            "Invalid or duplicate precinct",
        )
        precinct_names[key] = row[2]
        precinct_municipalities[key] = row[8]
        county_counts[row[0]] += 1
    _require(
        all(county_counts[k] == v["expected_precincts"] for k, v in counties.items()),
        "Precinct register differs from county expected counts",
    )
    statistics_keys = set()
    reported_statistics = 0
    statistics = {}
    for row_number, row in enumerate(
        _table(sources["pctstats.txt"]["body"], 12, "precinct statistics"), start=1
    ):
        key = (row[1], row[2])
        _require(
            row[0] == "MN"
            and key in precinct_names
            and key not in statistics_keys
            and row[4] in {"0", "1"}
            and all(v.isdigit() for v in row[5:]),
            "Invalid or duplicate precinct statistics",
        )
        _require(
            row[3] == precinct_names[key],
            "Precinct name differs between official tables",
        )
        statistics[key] = {"total_voted": int(row[11]), "row_number": row_number}
        statistics_keys.add(key)
        reported_statistics += int(row[4])
    _require(
        statistics_keys == set(precinct_names),
        "Precinct statistics omit registered precincts",
    )

    local_inventory = {
        "publication": "not_included",
        "reason": "Local races are not included in this comparison",
        "sources": {},
    }
    if "LocalCandTbl.txt" in sources:
        local_source = sources["LocalCandTbl.txt"]
        local_context = ElectionContext(
            args.election_id,
            args.election_date,
            args.stage,
            local_source["metadata"]["url"],
            "unverified",
            source_kind="local_cand",
        )
        local = parse_local_candidate_catalogue(
            local_source["body"],
            election=local_context,
            fetched_at=datetime.fromisoformat(local_source["metadata"]["fetched_at"]),
        )
        local_inventory["sources"]["LocalCandTbl.txt"] = {
            "rows": len(local.candidates),
            "sha256": local.source_sha256,
        }
    if "localPrct.txt" in sources:
        local_results = result("localPrct.txt", "precinct")
        _require(
            all(
                (r.county_id, r.precinct_id) in precinct_names
                for r in local_results.rows
            ),
            "Local result references an unknown precinct",
        )
        local_inventory["sources"]["localPrct.txt"] = {
            "rows": len(local_results.rows),
            "sha256": local_results.source_sha256,
        }
    if getattr(args, "include_local", False):
        for name in (
            "LocalCandTbl.txt",
            "localPrct.txt",
            "local.txt",
            "SDRaceQuestions.txt",
            "hospital.txt",
        ):
            _require(name in sources, f"Local source is missing: {name}")
        local_built = build_local_races(
            local_results,
            local,
            summaries=tuple(
                result(name, "race")
                for name in ("local.txt", "SDRaceQuestions.txt", "hospital.txt")
            ),
            precinct_municipalities=precinct_municipalities,
            precinct_register_sha256=sources["PrctTbl.txt"]["metadata"]["sha256"],
        )
        _require(
            not (
                {r["race_id"] for r in built["races"]}
                & {r["race_id"] for r in local_built["races"]}
            ),
            "Local race namespace overlaps main results",
        )
        built["races"].extend(local_built["races"])
        built["excluded_rows"].extend(local_built["excluded_rows"])
        built["excluded_summary_rows"].extend(local_built["excluded_summary_rows"])
        local_inventory.update(
            publication="included",
            reason=None,
            counts=local_built["source_counts"],
            unmatched_roster=local_built["unmatched_roster"],
            reconciled_races=sum(
                r["coverage"]["reconciled"] for r in local_built["races"]
            ),
            named_candidacies=len(local.candidates),
        )
    coverage = {
        "scope": "Minnesota federal, state and county candidate races in the retained general-election files"
        if args.stage == "general"
        else f"Minnesota federal, state and county candidate races in the retained {args.stage}-election files",
        "source_status": "unofficial",
        "certified_outcomes": False,
        "status_evidence_sha256": proof["metadata"]["sha256"],
        "named_candidacies": len(catalogue.candidates),
        "county_names": {k: v["name"] for k, v in counties.items()},
        "counties": [
            {"id": k, **v, "held_precincts": county_counts[k]}
            for k, v in sorted(counties.items())
        ],
        "registered_precincts": len(precinct_names),
        "precinct_statistics_reported": reported_statistics,
        "write_in_only_races": sum(
            r["roster_state"] == "no_named_candidates_in_register"
            for r in built["races"]
        ),
        "local_coverage": local_inventory,
        "expected_certification_authorities": add_expected_authorities(
            built, sources, counties, args
        ),
        "comparison_checks": {
            "within_feed_reconciliation": {
                "status": "complete"
                if all(r["coverage"]["reconciled"] for r in built["races"])
                else "gaps",
                "scope": "Candidate sums, precinct totals and county summaries from the retained results feed",
            },
            "precinct_voter_bound": precinct_voter_check(built, statistics, sources),
            "independent_canvass_validation": {"status": "not_performed"},
        },
        "limitations": [
            "These source files do not establish certified outcomes",
            *(
                [
                    "Local municipal, school and hospital races are not included in this generation"
                ]
                if local_inventory["publication"] != "included"
                else []
            ),
            "Election results do not establish campaign-finance completeness or candidate-to-committee identity",
        ],
    }
    if local_inventory["publication"] == "included":
        coverage["scope"] += "; municipal, school and hospital candidate races included"
        coverage["named_candidacies"] += local_inventory["named_candidacies"]
    generation = prepare_generation(
        election_key=f"mn-{args.election_date.isoformat()}-{args.stage}",
        election_date=args.election_date,
        stage=args.stage,
        fetched_at=fetched_at,
        sources=metadata,
        built=built,
        precinct_names=precinct_names,
        coverage=coverage,
    )
    return generation, {name: source["body"] for name, source in sources.items()}


def compact_report(generation: dict, *, operation: str, executed: bool) -> dict:
    coverage = generation["coverage"]
    return {
        "operation": operation,
        "executed": executed,
        "snapshot_id": generation["id"],
        "election_key": generation["election_key"],
        "source_count": len(generation["sources"]),
        "coverage": {
            k: v
            for k, v in coverage.items()
            if k not in {"excluded_rows", "excluded_summary_rows"}
        },
        "excluded_result_rows": len(coverage.get("excluded_rows", [])),
        "excluded_summary_rows": len(coverage.get("excluded_summary_rows", [])),
        "unreconciled_races": [
            {
                "id": r["id"],
                "label": r["label"],
                "errors": r["payload"]["coverage"]["errors"],
            }
            for r in generation["races"]
            if r["result_status"] != "unofficial"
        ],
    }


def execute_stage(generation: dict, originals: dict[str, bytes], target: str) -> None:
    from sqlalchemy import create_engine
    from sqlalchemy.orm import Session

    from alethical.db.session import NO_PREPARED_STATEMENTS, database_url_for_target
    from alethical.pipeline.raw_file_store import raw_file_store_from_env

    engine = create_engine(
        database_url_for_target(target), connect_args=NO_PREPARED_STATEMENTS
    )
    try:
        store = raw_file_store_from_env()
        with Session(engine) as db:
            for body in originals.values():
                archive_source(db, store, body)
            stage_generation(db, generation)
            db.commit()
    finally:
        engine.dispose()


def execute_publish(
    snapshot_id: str, expected_previous: str | None, target: str, *, restore: bool
) -> dict:
    from sqlalchemy import create_engine
    from sqlalchemy.orm import Session

    from alethical.db.session import NO_PREPARED_STATEMENTS, database_url_for_target

    engine = create_engine(
        database_url_for_target(target), connect_args=NO_PREPARED_STATEMENTS
    )
    try:
        with Session(engine) as db:
            result = publish_generation(
                db, snapshot_id, expected_previous=expected_previous, restore=restore
            )
            db.commit()
            return result
    finally:
        engine.dispose()


def _hash(value: str) -> str:
    if not re.fullmatch(r"[a-f0-9]{64}", value):
        raise argparse.ArgumentTypeError("Expected the complete SHA256 snapshot ID")
    return value


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)
    for name in ("prepare", "stage"):
        command = commands.add_parser(name)
        command.add_argument("--directory", type=Path, required=True)
        command.add_argument("--manifest", type=Path, required=True)
        command.add_argument("--election-id", required=True)
        command.add_argument("--election-date", type=date.fromisoformat, required=True)
        command.add_argument(
            "--stage", choices=("general", "primary", "special"), default="general"
        )
        command.add_argument("--status-file", default="home.html")
        command.add_argument(
            "--include-local",
            action="store_true",
            help="Include reconciled local races from retained local and hospital sources",
        )
        command.add_argument("--output", type=Path, required=True)
        if name == "stage":
            command.add_argument(
                "--target", choices=("local", "production"), default="local"
            )
            command.add_argument("--execute", action="store_true")
    publish = commands.add_parser("publish")
    publish.add_argument("--snapshot-id", type=_hash, required=True)
    publish.add_argument(
        "--expected-previous",
        required=True,
        help="Exact previous snapshot ID or the literal none for first publication",
    )
    publish.add_argument("--target", choices=("local", "production"), default="local")
    publish.add_argument("--restore", action="store_true")
    publish.add_argument("--execute", action="store_true")
    args = parser.parse_args(argv)
    try:
        if args.command == "publish":
            previous = (
                None
                if args.expected_previous == "none"
                else _hash(args.expected_previous)
            )
            report = {
                "operation": "publish",
                "executed": args.execute,
                "target": args.target,
                "current": args.snapshot_id,
                "previous": previous,
                "restore": args.restore,
            }
            if args.execute:
                report.update(
                    execute_publish(
                        args.snapshot_id, previous, args.target, restore=args.restore
                    )
                )
        else:
            _require(
                not args.output.exists(),
                "Output already exists; choose a new report path",
            )
            generation, originals = prepare_from_files(args)
            executed = args.command == "stage" and args.execute
            # Reserve the report path before any external write. Never overwrite
            # prior evidence, even if a stage/publication retry is necessary.
            report = compact_report(generation, operation=args.command, executed=False)
            with args.output.open("x", encoding="utf-8") as handle:
                json.dump(report, handle, indent=2, ensure_ascii=False)
                handle.write("\n")
            if executed:
                execute_stage(generation, originals, args.target)
                report["executed"] = True
                args.output.write_text(
                    json.dumps(report, indent=2, ensure_ascii=False) + "\n",
                    encoding="utf-8",
                )
        print(json.dumps(report, sort_keys=True, ensure_ascii=False))
        return 0
    except (ValueError, OSError, argparse.ArgumentTypeError) as error:
        print(f"Election comparison refused: {error}", file=sys.stderr)
        return 2
    except Exception:
        # Connection errors may embed credentials or SQL parameters. Keep them
        # out of terminal output; the preceding source report remains available.
        print(
            "Election comparison failed; no successful publication is claimed",
            file=sys.stderr,
        )
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
