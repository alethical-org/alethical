#!/usr/bin/env python3
"""Collect missing effective reports from retained official catalogues into a new folder.

Default is a local request plan. --execute downloads only those public PDFs. No
database access, identity confirmation, staging or publication. Existing source
bytes and document metadata are copied unchanged; only one coordinator writes the
response archive. Superseded amendment history stays in the original catalogue.
"""

from __future__ import annotations

import argparse
import base64
from concurrent.futures import ThreadPoolExecutor, as_completed
from copy import deepcopy
from dataclasses import asdict
from datetime import UTC, date, datetime
import json
from pathlib import Path
import shutil
import sys
import time

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from alethical.pipeline import campaign_finance_filings as f  # noqa: E402
from alethical.pipeline import campaign_finance_report_documents as d  # noqa: E402
from alethical.pipeline import election_finance_collection as s  # noqa: E402


def report_plan(directory: Path, *, available_on: date):
    manifest = json.loads((directory / "recovery-manifest.json").read_text())
    recovery = json.loads((directory / "recovered-evidence.json").read_text())
    entries, bodies = s._read_archive(directory, manifest)
    year = date.fromisoformat(manifest["election_key"].removeprefix("mn-")[:10]).year
    s.require(
        len(recovery) == len(manifest["registration_numbers"])
        and {item["registration_number"] for item in recovery}
        == set(manifest["registration_numbers"]),
        "Recovered committee coverage changed",
    )
    plan = []
    for item in recovery:
        reg = item["registration_number"]
        payload = s._response(
            item["catalogue_source"],
            entries,
            bodies,
            registration=reg,
            tab="reports_data",
        )
        reports, errors = f.parse_catalogue_payload(payload, reg)
        s.require(not errors, f"Unreadable catalogue for {reg}")
        eligible = [
            r
            for r in reports
            if r.filing_year == year
            and r.cut_off_date is not None
            and r.cut_off_date <= available_on
            and r.effective_amendment_index is not None
        ]
        regular = [r for r in eligible if not r.special_election]
        newest = max((r.cut_off_date for r in regular), default=None)
        latest = [r for r in regular if r.cut_off_date == newest]
        known = dict(item.get("documents", {}))
        if len(latest) == 1 and "document" in item:
            known.setdefault(s.catalogue_report_key(latest[0]), item["document"])
        for report in eligible:
            key = s.catalogue_report_key(report)
            if known.get(key, {}).get("outcome") == "served":
                continue
            plan.append(
                {
                    "registration_number": reg,
                    "filing": s.json_value(asdict(report)),
                    "report_key": key,
                }
            )
    s.require(
        len({p["report_key"] for p in plan}) == len(plan), "Duplicate planned report"
    )
    return manifest, recovery, entries, sorted(plan, key=lambda p: p["report_key"])


def fetch_report(request, *, courtesy_seconds):
    """Worker owns its HTTP session; archive mutation belongs to the caller."""
    filing = request["filing"]
    try:
        time.sleep(courtesy_seconds)
        with f.http_session() as http:
            response, outcome, note = d.fetch_document(
                http,
                registration_number=filing["registration_number"],
                filing_year=filing["filing_year"],
                kind=f.FilerKind.candidate_committee,
                report_type=filing["report_type"],
                amendment_index=filing["effective_amendment_index"],
                special_election=filing["special_election"],
            )
        return request, response, {"outcome": outcome.value, "note": note}
    except Exception as exc:
        # Preserve the exact requested identity even when no response arrived.
        return (
            request,
            None,
            {
                "outcome": "request_failed",
                "error": f"{type(exc).__name__}: {exc}",
            },
        )


def collect(directory, output, *, available_on, plan_file=None, execute=False):
    manifest, recovery, entries, plan = report_plan(
        directory, available_on=available_on
    )
    if plan_file is not None:
        expected = json.loads(plan_file.read_text())
        s.require(
            sorted(expected, key=lambda p: p["report_key"]) == plan,
            "Requested plan differs from retained catalogue gaps",
        )
    if not execute:
        return {"executed": False, "report_count": len(plan), "requests": plan}
    s.require(output is not None, "A new output directory is required")
    output.mkdir(parents=True, exist_ok=False)
    recovery = deepcopy(recovery)
    by_reg = {item["registration_number"]: item for item in recovery}
    for item in recovery:
        documents = [item.get("document", {}), *item.get("documents", {}).values()]
        for doc in documents:
            if not doc.get("local_file"):
                continue
            filename = doc["local_file"]
            s.require(Path(filename).name == filename, "Document path escapes recovery")
            body = (directory / filename).read_bytes()
            s.require(s.file_hash(body) == doc["sha256"], "Existing PDF changed")
            shutil.copy2(directory / filename, output / filename)
    archive = f.ResponseArchive(str(output / "responses.jsonl.gz"))
    standard = {
        "line",
        "what",
        "url",
        "form",
        "status",
        "sha256",
        "bytes",
        "started_at",
        "completed_at",
        "body_base64",
    }
    outcomes = {}
    started = time.monotonic()
    try:
        for entry in entries.values():
            response = f.Response(
                entry["url"],
                entry["form"],
                entry["status"],
                base64.b64decode(entry["body_base64"], validate=True),
                entry["sha256"],
                datetime.fromisoformat(entry["started_at"]),
                datetime.fromisoformat(entry["completed_at"]),
            )
            line = archive.write(
                entry["what"],
                response,
                **{key: value for key, value in entry.items() if key not in standard},
            )
            s.require(line == entry["line"], "Existing archive references changed")
        # Public service limit: at most 2 requests and a 0.25-second wait per worker.
        with ThreadPoolExecutor(max_workers=2) as pool:
            futures = [
                pool.submit(fetch_report, p, courtesy_seconds=0.25) for p in plan
            ]
            for future in as_completed(futures):
                request, response, result = future.result()
                doc = {"filing": request["filing"], **result}
                if response is not None:
                    line = archive.write(
                        "report_document",
                        response,
                        registration_number=request["registration_number"],
                    )
                    filename = f"{request['report_key']}.pdf"
                    (output / filename).write_bytes(response.body)
                    doc.update(
                        origin="official_live",
                        url=response.url,
                        request_method="POST",
                        request_form=response.form,
                        sha256=response.content_hash,
                        copied_at=response.completed_at.isoformat(),
                        status=response.status_code,
                        bytes=len(response.body),
                        archive_line=line,
                        local_file=filename,
                    )
                by_reg[request["registration_number"]].setdefault("documents", {})[
                    request["report_key"]
                ] = doc
                (output / f"{request['report_key']}-evidence.json").write_text(
                    json.dumps(doc, indent=2) + "\n"
                )
                outcome = result["outcome"]
                outcomes[outcome] = outcomes.get(outcome, 0) + 1
                if sum(outcomes.values()) % 20 == 0:
                    print(
                        json.dumps(
                            {
                                "finished": sum(outcomes.values()),
                                "total": len(plan),
                                "outcomes": outcomes,
                            }
                        ),
                        flush=True,
                    )
    finally:
        archive_hash, size, count = archive.close()
    manifest.update(
        completed_at=datetime.now(UTC).isoformat(),
        scope="Every available effective catalogue period; cumulative reports are separate",
        previous_archive=manifest["archive"],
        archive={
            "compressed_sha256": archive_hash,
            "compressed_bytes": size,
            "response_count": count,
            "object_key": f.archive_object_key(archive_hash),
        },
        supplemental_report_count=len(plan),
        supplemental_outcomes=outcomes,
        workers=2,
        courtesy_seconds_per_request=0.25,
        production_writes=False,
        supplemental_elapsed_seconds=time.monotonic() - started,
    )
    (output / "recovery-manifest.json").write_text(
        json.dumps(manifest, indent=2) + "\n"
    )
    (output / "recovered-evidence.json").write_text(
        json.dumps(recovery, indent=2) + "\n"
    )
    (output / "request-plan.json").write_text(json.dumps(plan, indent=2) + "\n")
    return {
        "executed": True,
        "report_count": len(plan),
        "outcomes": outcomes,
        "output": str(output),
    }


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--directory", type=Path, required=True)
    parser.add_argument("--output", type=Path)
    parser.add_argument(
        "--available-on", type=date.fromisoformat, default=datetime.now(UTC).date()
    )
    parser.add_argument("--plan-file", type=Path)
    parser.add_argument("--execute", action="store_true")
    args = parser.parse_args(argv)
    print(
        json.dumps(
            collect(
                args.directory,
                args.output,
                available_on=args.available_on,
                plan_file=args.plan_file,
                execute=args.execute,
            ),
            indent=2,
        )
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
