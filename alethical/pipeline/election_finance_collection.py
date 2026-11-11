"""Immutable, scoped report evidence; no candidate confirmation or global refresh.

Source retention, atomic staging and compare-and-swap publication are separate.
Figures are reconstructed from retained PDFs, never trusted from a recovery JSON.
"""

from __future__ import annotations

import base64
import gzip
import hashlib
import html
import io
import json
import re
import tempfile
from collections import Counter
from dataclasses import asdict
from datetime import UTC, date, datetime
from decimal import Decimal
from pathlib import Path

from sqlalchemy import select, text
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.orm import Session

from alethical.db import models as m
from alethical.pipeline import campaign_finance_filings as f
from alethical.pipeline import campaign_finance_report_documents as d
from alethical.pipeline.campaign_finance_report_document_store import (
    DocumentKeeper,
    read_document,
)
from alethical.pipeline.candidate_catalogue import (
    ElectionContext,
    parse_candidate_catalogue,
    parse_local_candidate_catalogue,
)
from alethical.pipeline.election_comparison import archive_source, digest


class FinanceCollectionError(ValueError):
    """Evidence must remain unavailable when its source cannot be proved."""


def require(condition, message):
    if not condition:
        raise FinanceCollectionError(message)


def file_hash(body):
    return hashlib.sha256(body).hexdigest()


def json_value(value):
    return json.loads(json.dumps(value, default=str))


def collection_digest(collection):
    value = {k: v for k, v in collection.items() if k not in {"id", "copied_at"}}
    value["sources"] = sorted(
        value["sources"], key=lambda r: (r["sha256"], r.get("url", ""))
    )
    value["reports"] = sorted(
        value["reports"], key=lambda r: (r["registration_number"], r["report_key"])
    )
    return digest(value)


def extract_report_evidence(body, reg, latest, parsed, financial):
    from pypdf import PdfReader
    from pypdf.errors import PyPdfError

    try:
        reader = PdfReader(io.BytesIO(body))
        pages = len(reader.pages)
        cover = reader.pages[0].extract_text(extraction_mode="layout") or ""
        summary_text = (
            reader.pages[1].extract_text(extraction_mode="layout") or ""
            if pages >= 2
            else ""
        )
    except (PyPdfError, ValueError, KeyError, IndexError, TypeError, OSError):
        pages, cover, summary_text = 0, "", ""
    lines: list[str] = list(cover.splitlines())
    fields = {}
    for key, label in [
        ("registration_number", "Registration Number"),
        ("committee_name", "Committee Name"),
        ("candidate_name", "Candidate Name"),
        ("office", "Office(?: and District)?"),
    ]:
        found = re.findall(r"^\s*" + label + r":\s*(.+?)\s*$", cover, re.M)
        fields[key] = found[0] if len(found) == 1 else None
    period = re.findall(
        r"Period Covered:\s*(\d{2}/\d{2}/\d{4})\s+through\s+(\d{2}/\d{2}/\d{4})", cover
    )
    errors = []
    if len(period) != 1:
        errors.append("No unique report-cover period")
    else:
        fields["period_start"] = (
            datetime.strptime(period[0][0], "%m/%d/%Y").date().isoformat()
        )
        fields["period_end"] = (
            datetime.strptime(period[0][1], "%m/%d/%Y").date().isoformat()
        )
        if fields["period_end"] != str(latest.cut_off_date):
            errors.append("Report cover and catalogue cutoff differ")
    if fields["registration_number"] != reg:
        errors.append("Report cover registration differs")
    fields["received_date"], date_errors = d.filed_date_from_lines(lines)
    errors += date_errors
    # Exact standard page-2 report lines; all numeric columns must be present.
    # Zero is admitted only when explicitly printed; missing values remain unavailable.
    summary = summary_text.split("Committee Transaction Summary", 1)
    figures = {}
    row_values: dict[int, list[Decimal]] = {}
    if len(summary) != 2:
        errors.append("Missing transaction summary")
    else:
        segment = summary[1].split("Loans and Unpaid Obligations Summary")[0]
        for num in [2, 3, 4, 5, 6, 11, 19]:
            match = re.search(
                r"^\s*" + str(num) + r"\s+(.+?)(?=^\s*\d{1,2}\s+|\Z)",
                segment,
                re.M | re.S,
            )
            if not match:
                errors.append(f"Missing summary row {num}")
                continue
            expected_label = {
                2: r"individual",
                3: r"lobbyist",
                4: r"political",
                5: r"principal|party|political",
                6: r"other",
                11: r"campaign expenditures",
                19: r"total expenditures",
            }[num]
            if not re.search(expected_label, match[1], re.IGNORECASE):
                errors.append(f"Summary row {num} has an unexpected label")
                continue
            values = re.findall(
                r"(?<![\w./])(?:\(?-?\$?\d[\d,]*\.\d{2}\)?)(?!\w)", match[1]
            )
            expected = 3 if num < 7 else 4
            if len(values) != expected:
                errors.append(
                    f"Summary row {num} has {len(values)} numeric cells, expected {expected}"
                )
                continue
            parsed_amounts = [d.parse_money(v) for v in values]
            amounts = [value for value in parsed_amounts if value is not None]
            if len(amounts) != len(parsed_amounts):
                errors.append(f"Unreadable row {num}")
                continue
            if sum(amounts[:-1], Decimal("0")) != amounts[-1]:
                errors.append(f"Summary row {num} does not add up")
                continue
            row_values[num] = amounts
        if all(n in row_values for n in (2, 3, 4, 5, 6)):
            amounts = [
                sum((row_values[n][col] for n in (2, 3, 4, 5, 6)), Decimal("0"))
                for col in range(3)
            ]
            figures["contributions_received"] = {
                **dict(zip(("cash", "in_kind", "total"), map(str, amounts))),
                "source_page": 2,
                "source_lines": [2, 3, 4, 5, 6],
            }
        for key, num in [("campaign_expenditures", 11), ("total_expenditures", 19)]:
            if num in row_values:
                figures[key] = {
                    **dict(
                        zip(
                            ("cash", "unpaid", "in_kind", "total"),
                            map(str, row_values[num]),
                        )
                    ),
                    "source_page": 2,
                    "source_lines": [num],
                }
    # Independent schedule totals must agree with summary columns; no assumed empty schedule.
    schedule_checks = []
    for key, code in [("campaign_expenditures", "B1 - CE")]:
        if key in figures and code in parsed.schedules:
            schedule = parsed.schedules[code]
            totals = [a + b for a, b in zip(schedule.itemized, schedule.non_itemized)]
            observed = row_values[11]
            schedule_checks.append({"schedule": code, "matches": totals == observed})
            if totals != observed:
                errors.append(f"{code} schedule differs from summary")
    cashcheck = {"status": "not_same_period"}
    year = financial.years.get(2026)
    if year and str(year.reported_through) == fields.get("period_end"):
        cashcheck = {"status": "same_period", "results": {}}
        for key in ("campaign_expenditures", "total_expenditures"):
            if key in figures and key in year.amounts:
                summary_row = {"campaign_expenditures": 11, "total_expenditures": 19}[
                    key
                ]
                same = row_values[summary_row][0] == year.amounts[key]
                cashcheck["results"][key] = same
                if not same:
                    errors.append(f"Official financial tab cash differs for {key}")
    return {
        "status": "requires_review"
        if errors or parsed.errors
        else "parsed_with_arithmetic_checks",
        "cover": fields,
        "figures": figures,
        "errors": errors,
        "schedule_checks": schedule_checks,
        "summary_cash_check": cashcheck,
        "parser_errors": parsed.errors,
        "page_count": pages,
        "complete_election_spending": False,
        "identity_confirmation": False,
    }


def _read_archive(directory, manifest):
    body = (directory / "responses.jsonl.gz").read_bytes()
    spec = manifest["archive"]
    require(
        file_hash(body) == spec["compressed_sha256"]
        and len(body) == spec["compressed_bytes"],
        "Response archive fingerprint changed",
    )
    entries, bodies = {}, {}
    with gzip.open(directory / "responses.jsonl.gz", "rt", encoding="utf-8") as stream:
        for number, line in enumerate(stream, 1):
            require(
                number <= 100_000 and len(line) < 50_000_000,
                "Oversized response archive",
            )
            entry = json.loads(line)
            require(entry["line"] == number, "Response archive line sequence changed")
            original = base64.b64decode(entry["body_base64"], validate=True)
            require(
                file_hash(original) == entry["sha256"]
                and len(original) == entry["bytes"],
                "Archived response fingerprint changed",
            )
            require(
                entry["url"].startswith("https://cfb.mn.gov/"),
                "Unexpected response authority",
            )
            entries[number] = entry
            bodies[entry["sha256"]] = original
    require(len(entries) == spec["response_count"], "Response archive count changed")
    return entries, bodies


def _response(spec, entries, bodies, *, registration, tab):
    entry = entries.get(spec["archive_line"])
    require(
        entry is not None and entry["sha256"] == spec["sha256"],
        "Response reference changed",
    )
    require(
        entry["status"] == 200
        and entry["form"].get("id") == registration
        and entry["form"].get("tabname") == tab,
        "Response identity changed",
    )
    return json.loads(bodies[entry["sha256"]])


def _source(entry):
    return {
        "sha256": entry["sha256"],
        "url": entry["url"],
        "request_method": "POST",
        "request_form": entry["form"],
        "copied_at": entry["completed_at"],
        "archive_line": entry["line"],
        "kind": entry["what"],
    }


def _coverage(rosters, directory_filers):
    candidates = []
    for c in (candidate for roster in rosters for candidate in roster.candidates):
        authority = (
            "county_local"
            if c.stable_id.startswith("local_cand:")
            else "board"
            if c.office_kind
            or c.office_title.startswith(
                ("Judge - ", "Associate Justice - ", "Chief Justice - ")
            )
            else "federal"
            if c.office_title.startswith("U.S.")
            else "county_local"
        )
        candidates.append(
            {
                "candidate_id": c.candidate_id,
                "stable_id": c.stable_id,
                "county_id": c.county_id,
                "office_id": c.office_id,
                "office": c.office_title,
                "name": c.name,
                "party": c.party_abbreviation,
                "source_sha256": c.source_sha256,
                "source_row": c.row_number,
                "municipal_fips_code": c.municipal_fips_code,
                "school_district_number": c.school_district_number,
                "authority": authority,
                "authority_scope": "candidate_own_campaign_reports",
                "outside_support_scope": "Separate source filings may report support or opposition regardless of candidate report authority",
                "link_state": "not_confirmed_by_collection",
                "gap": "Candidate-to-committee confirmation is separate"
                if authority == "board"
                else "Finance sources for this authority have not been recovered in this collection",
            }
        )
    return {
        "named_candidacies": len(candidates),
        "authority_counts": dict(Counter(c["authority"] for c in candidates)),
        "candidates": candidates,
        "directory_filers": len(directory_filers),
        "candidate_attribution": False,
        "complete_election_spending": False,
    }


def _identity_sources(manifest_path: Path, registrations: set[str]):
    """Read explicit Board identity responses, never infer or confirm a link."""
    sources, bodies = [], {}
    entries = json.loads(manifest_path.read_text())
    require(
        isinstance(entries, list) and bool(entries), "Empty identity source manifest"
    )
    seen = set()
    for entry in sorted(entries, key=lambda e: e.get("subtype") == "registered_site"):
        if entry.get("subtype") == "registered_site":
            reg = entry["registration_number"]
            parents = [
                s
                for s in sources
                if s["sha256"] == entry["parent_sha256"]
                and s["registration_number"] == reg
                and s.get("subtype") != "registered_site"
            ]
            require(
                len(parents) == 1, "Registered site needs its retained Board parent"
            )
            parent = parents[0]
            require(
                parent["request_form"].get("tabname") == "officers"
                and entry["parent_locator"] == "/tabcontent",
                "Registered site parent must be the officers source",
            )
            content = json.loads(bodies[parent["sha256"]])["tabcontent"]
            links = [
                html.unescape(value)
                for value in re.findall(
                    r"href=[\"\x27](https?://[^\"\x27]+)[\"\x27]", content
                )
            ]
            require(
                entry["requested_url"] in links
                and entry["request_method"] == "GET"
                and re.match(r"https?://", entry["url"]),
                "Registered site URL is not in the Board source",
            )
            filename = entry["local_file"]
            require(
                Path(filename).name == filename,
                "Identity source path escapes its folder",
            )
            body = (manifest_path.parent / filename).read_bytes()
            require(
                file_hash(body) == entry["sha256"],
                "Identity source fingerprint changed",
            )
            require(
                datetime.fromisoformat(entry["copied_at"]).tzinfo is not None,
                "Identity source copy date needs a timezone",
            )
            source = {k: v for k, v in entry.items() if k != "local_file"}
            source["kind"] = "candidate_identity"
            sources.append(source)
            bodies[source["sha256"]] = body
            continue
        reg, form = entry["registration_number"], entry["request_form"]
        tab = form.get("tabname")
        require(
            reg in registrations
            and entry["url"] == f.viewer_url(f.FilerKind.candidate_committee)
            and entry["request_method"] == "POST"
            and form.get("id") == reg
            and tab
            in {
                "information",
                "officers",
                "election_economic_interest_statement",
                "ltgc_election_economic_interest_statement",
            },
            "Identity source request does not identify the recovered committee",
        )
        filename = entry["local_file"]
        require(
            Path(filename).name == filename, "Identity source path escapes its folder"
        )
        body = (manifest_path.parent / filename).read_bytes()
        require(
            file_hash(body) == entry["sha256"], "Identity source fingerprint changed"
        )
        copied = datetime.fromisoformat(entry["copied_at"])
        require(copied.tzinfo is not None, "Identity source copy date needs a timezone")
        payload = json.loads(body)
        if tab == "information":
            rows = payload.get("data")
            require(
                isinstance(rows, list)
                and len(rows) == 1
                and rows[0].get("RegisteredEntityID") == reg,
                "Identity response registration differs from request",
            )
        elif tab != "officers":
            require(
                payload.get("data", {}).get("filinginfo", {}).get("RegisteredEntityID")
                == reg,
                "Identity response registration differs from request",
            )
        else:
            require(bool(payload.get("tabcontent")), "Empty officers identity response")
        key = (reg, tab, entry["sha256"])
        require(key not in seen, "Duplicate identity source")
        seen.add(key)
        source = {
            key: entry[key]
            for key in (
                "sha256",
                "url",
                "request_method",
                "request_form",
                "copied_at",
                "registration_number",
            )
        }
        source["kind"] = "candidate_identity"
        sources.append(source)
        bodies[source["sha256"]] = body
    return sources, bodies


def prepare_collection(
    directory: Path,
    *,
    roster_directory: Path,
    directory_file: Path,
    directory_metadata: Path,
    identity_manifest: Path | None = None,
):
    """Read a bounded recovery bundle and independently reconstruct its figures.

    Returns (collection, source bodies by hash, PDF bodies by hash). No database
    or network access. Earlier catalogue entries retain explicit unavailable figures.
    """
    manifest = json.loads((directory / "recovery-manifest.json").read_text())
    recovery = json.loads((directory / "recovered-evidence.json").read_text())
    election_key = manifest["election_key"]
    match = re.fullmatch(r"mn-(\d{4}-\d{2}-\d{2})-general", election_key)
    if match is None:
        raise FinanceCollectionError("Unsupported election key")
    election_day = date.fromisoformat(match[1])
    copied = datetime.fromisoformat(manifest["completed_at"])
    require(copied.tzinfo is not None, "Copy date needs a timezone")
    entries, bodies = _read_archive(directory, manifest)
    roster_manifest = json.loads(
        (roster_directory / "source-manifest.json").read_text()
    )
    roster_source = next(
        s
        for s in roster_manifest
        if s.get("file") == "cand.txt" or s["url"].endswith("/cand.txt")
    )
    roster_bytes = (roster_directory / "cand.txt").read_bytes()
    require(
        file_hash(roster_bytes) == roster_source["sha256"],
        "Candidate roster fingerprint changed",
    )
    roster = parse_candidate_catalogue(
        roster_bytes,
        election=ElectionContext(
            "201", election_day, "general", roster_source["url"], "unverified"
        ),
        fetched_at=datetime.fromisoformat(roster_source["fetched_at"]),
    )
    rosters = [roster]
    local_source = next(
        (
            source
            for source in roster_manifest
            if source["url"].endswith("/LocalCandTbl.txt")
        ),
        None,
    )
    if local_source:
        local_bytes = (roster_directory / "LocalCandTbl.txt").read_bytes()
        require(
            file_hash(local_bytes) == local_source["sha256"],
            "Local candidate roster fingerprint changed",
        )
        local_roster = parse_local_candidate_catalogue(
            local_bytes,
            election=ElectionContext(
                "201",
                election_day,
                "general",
                local_source["url"],
                "unverified",
                source_kind="local_cand",
            ),
            fetched_at=datetime.fromisoformat(local_source["fetched_at"]),
        )
        rosters.append(local_roster)
        bodies[local_roster.source_sha256] = local_bytes
    directory_body = directory_file.read_bytes()
    directory_meta = json.loads(directory_metadata.read_text())
    require(
        file_hash(directory_body) == directory_meta["source_hash"],
        "Candidate directory fingerprint changed",
    )
    filers, errors = f.parse_directory_payload(
        json.loads(directory_body), f.FilerKind.candidate_committee
    )
    require(not errors, "Candidate directory is unreadable")
    bodies[roster.source_sha256] = roster_bytes
    bodies[file_hash(directory_body)] = directory_body
    sources = [_source(e) for e in entries.values() if e["what"] != "report_document"]
    sources += [
        {
            "sha256": roster.source_sha256,
            "url": roster_source["url"],
            "copied_at": roster_source["fetched_at"],
            "kind": "candidate_roster",
        },
        {
            "sha256": directory_meta["source_hash"],
            "url": directory_meta["url"],
            "request_method": "POST",
            "request_form": directory_meta["form"],
            "copied_at": directory_meta["copied_at"],
            "kind": "candidate_directory",
        },
    ]
    if local_source:
        sources.append(
            {
                "sha256": local_source["sha256"],
                "url": local_source["url"],
                "copied_at": local_source["fetched_at"],
                "kind": "local_candidate_roster",
            }
        )
    wanted = set(manifest["registration_numbers"])
    if identity_manifest is not None:
        identity_sources, identity_bodies = _identity_sources(identity_manifest, wanted)
        sources.extend(identity_sources)
        bodies.update(identity_bodies)
        copied = max(
            copied, *(datetime.fromisoformat(s["copied_at"]) for s in identity_sources)
        )
    require(
        len(wanted) == len(recovery)
        and {r["registration_number"] for r in recovery} == wanted,
        "Recovered committee coverage changed",
    )
    coverage = _coverage(rosters, filers)
    coverage["candidate_roster_sources"] = [
        {
            "kind": entry.election.source_kind,
            "sha256": entry.source_sha256,
            "named_candidacies": len(entry.candidates),
        }
        for entry in rosters
    ]
    coverage["local_candidate_roster_included"] = bool(local_source)
    reports, documents = [], {}
    for item in recovery:
        reg = item["registration_number"]
        payload = _response(
            item["catalogue_source"],
            entries,
            bodies,
            registration=reg,
            tab="reports_data",
        )
        catalogue, errors = f.parse_catalogue_payload(payload, reg)
        require(not errors, f"Unreadable catalogue for {reg}")
        selected = [r for r in catalogue if r.filing_year == election_day.year]
        financial = (
            f.parse_financial_tab(
                _response(
                    item["financial_source"],
                    entries,
                    bodies,
                    registration=reg,
                    tab="financial",
                ),
                f.FilerKind.candidate_committee,
                [election_day.year, election_day.year + 1],
            )
            if "financial_source" in item
            else f.FinancialTab()
        )
        eligible = [
            r
            for r in selected
            if not r.special_election
            and r.cut_off_date
            and r.cut_off_date <= copied.date()
            and r.effective_amendment_index is not None
        ]
        cutoffs = [r.cut_off_date for r in eligible if r.cut_off_date is not None]
        newest = max(cutoffs, default=None)
        newest_reports = [r for r in eligible if r.cut_off_date == newest]
        ambiguous_latest = len({r.report_type for r in newest_reports}) > 1
        if newest_reports and not ambiguous_latest:
            amendment = max(
                r.effective_amendment_index
                for r in newest_reports
                if r.effective_amendment_index is not None
            )
            newest_reports = [
                r for r in newest_reports if r.effective_amendment_index == amendment
            ]
            ambiguous_latest = len(newest_reports) != 1
        latest = newest_reports[0] if newest_reports and not ambiguous_latest else None
        for report in selected:
            document_hash = None
            summary_year = financial.years.get(report.filing_year)
            data = {
                "schema_version": 1,
                "registration_number": reg,
                "filing": json_value(asdict(report)),
                "catalogue_source": item["catalogue_source"],
                "financial_source": item.get("financial_source"),
                "official_summary": {
                    "reported_through": str(summary_year.reported_through)
                    if summary_year and summary_year.reported_through
                    else None,
                    "matches_report_period": bool(
                        summary_year
                        and summary_year.reported_through == report.cut_off_date
                    ),
                    "amounts": json_value(summary_year.amounts)
                    if summary_year
                    else None,
                    "errors": financial.errors,
                },
                "currency": "USD",
                "figures": None,
                "figure_status": "unavailable",
                "unavailable_reason": "This catalogue report document has not been recovered",
                "identity_confirmation": False,
                "complete_election_spending": False,
            }
            if report == latest and item.get("document", {}).get("outcome") == "served":
                if (
                    report.effective_amendment_index is None
                    or report.cut_off_date is None
                ):
                    raise FinanceCollectionError(
                        "Latest report lacks an exact series or cutoff"
                    )
                doc = item["document"]
                filename = doc["local_file"]
                require(
                    Path(filename).name == filename,
                    "Document path escapes recovery folder",
                )
                pdf = (directory / filename).read_bytes()
                require(
                    file_hash(pdf) == doc["sha256"] and pdf.startswith(b"%PDF"),
                    "Report document fingerprint changed",
                )
                if doc.get("origin") == "official_live":
                    original = entries.get(doc["archive_line"])
                    expected = d.document_form(
                        registration_number=reg,
                        filing_year=report.filing_year,
                        kind=f.FilerKind.candidate_committee,
                        report_type=report.report_type,
                        amendment_index=report.effective_amendment_index,
                        special_election=report.special_election,
                    )
                    require(
                        original is not None
                        and original["sha256"] == doc["sha256"]
                        and original["form"] == expected,
                        "PDF request identity changed",
                    )
                else:
                    require(
                        doc.get("origin") == "held_report_document"
                        and bool(doc.get("held_at")),
                        "Unknown PDF origin",
                    )
                parsed = d.parse_report_document(pdf)
                extraction = json_value(
                    extract_report_evidence(pdf, reg, report, parsed, financial)
                )
                document_hash = doc["sha256"]
                documents[document_hash] = pdf
                data.update(
                    {
                        "document": doc,
                        "extraction": extraction,
                        "cover": extraction["cover"],
                        "period_start": extraction["cover"].get("period_start"),
                        "period_end": extraction["cover"].get("period_end"),
                        "period_basis": "calendar_year_to_date"
                        if extraction["cover"].get("period_start")
                        == f"{election_day.year}-01-01"
                        else "reported_period",
                    }
                )
                period_start = extraction["cover"].get("period_start")
                period_end = extraction["cover"].get("period_end")
                valid_period = (
                    isinstance(period_start, str)
                    and bool(period_start)
                    and isinstance(period_end, str)
                    and bool(period_end)
                    and date.fromisoformat(period_start).year == election_day.year
                    and date.fromisoformat(period_start) <= report.cut_off_date
                    and period_end == str(report.cut_off_date)
                )
                if (
                    extraction["status"] == "parsed_with_arithmetic_checks"
                    and valid_period
                    and set(extraction["figures"])
                    == {
                        "contributions_received",
                        "campaign_expenditures",
                        "total_expenditures",
                    }
                ):
                    data.update(
                        figures=extraction["figures"],
                        figure_status="source_verified",
                        unavailable_reason=None,
                    )
                else:
                    data["unavailable_reason"] = (
                        "; ".join(extraction["errors"] + extraction["parser_errors"])
                        or "Report period or required summary figures could not be verified"
                    )
            elif ambiguous_latest and report.cut_off_date == newest:
                data["unavailable_reason"] = "ambiguous_latest_report"
            elif report == latest:
                data["unavailable_reason"] = (
                    item.get("document", {}).get("note")
                    or item.get("error")
                    or "Latest report document is unavailable"
                )
            key = digest(
                [
                    reg,
                    report.filing_year,
                    report.report_type,
                    report.effective_amendment_index,
                    report.special_election,
                    document_hash,
                ]
            )
            reports.append(
                {
                    "registration_number": reg,
                    "report_key": key,
                    "document_hash": document_hash,
                    "payload": data,
                }
            )
    coverage.update(
        {
            "requested_registrations": sorted(wanted),
            "recovered_committees": len(wanted),
            "reports": len(reports),
            "reports_with_figures": sum(
                r["payload"]["figures"] is not None for r in reports
            ),
            "report_status_counts": dict(
                Counter(r["payload"]["figure_status"] for r in reports)
            ),
            "scope_note": "Latest recovered report figures per committee; earlier catalogue periods remain listed. Candidate attribution requires a separate confirmed decision.",
        }
    )
    source_hashes = {s["sha256"] for s in sources}
    originals = {h: bodies[h] for h in source_hashes}
    collection = {
        "format": 1,
        "election_key": election_key,
        "copied_at": copied.isoformat(),
        "sources": sources,
        "coverage": coverage,
        "reports": reports,
    }
    collection["id"] = collection_digest(collection)
    validate_collection(collection)
    return collection, originals, documents


def validate_collection(collection):
    """Validate prepared/stored records before a pointer can expose their figures."""
    try:
        require(
            collection["format"] == 1
            and collection["id"] == collection_digest(collection),
            "Collection fingerprint changed",
        )
        require(
            re.fullmatch(r"mn-\d{4}-\d{2}-\d{2}-general", collection["election_key"])
            is not None,
            "Invalid election key",
        )
        require(
            datetime.fromisoformat(collection["copied_at"]).tzinfo is not None,
            "Copy date needs a timezone",
        )
        sources = {s["sha256"] for s in collection["sources"]}
        require(
            sources and all(re.fullmatch(r"[a-f0-9]{64}", h) for h in sources),
            "Missing source hashes",
        )
        coverage = collection["coverage"]
        for source in collection["sources"]:
            if source.get("kind") == "candidate_identity":
                if source.get("subtype") == "registered_site":
                    require(
                        any(
                            parent["sha256"] == source["parent_sha256"]
                            and parent.get("kind") == "candidate_identity"
                            and parent.get("registration_number")
                            == source["registration_number"]
                            and parent.get("url")
                            == f.viewer_url(f.FilerKind.candidate_committee)
                            and parent.get("request_form", {}).get("tabname")
                            == "officers"
                            for parent in collection["sources"]
                        ),
                        "Registered site needs its retained Board parent",
                    )
                    continue
                require(
                    source["registration_number"] in coverage["requested_registrations"]
                    and source["url"] == f.viewer_url(f.FilerKind.candidate_committee)
                    and source["request_method"] == "POST"
                    and source["request_form"].get("id")
                    == source["registration_number"]
                    and datetime.fromisoformat(source["copied_at"]).tzinfo is not None,
                    "Identity source is not bound to a recovered committee",
                )
        candidates = coverage["candidates"]
        require(
            len(candidates) == coverage["named_candidacies"]
            and len({c["stable_id"] for c in candidates}) == len(candidates),
            "Candidate coverage changed",
        )
        require(
            dict(Counter(c["authority"] for c in candidates))
            == coverage["authority_counts"],
            "Authority coverage changed",
        )
        require(
            coverage["candidate_attribution"] is False
            and coverage["complete_election_spending"] is False,
            "Collection cannot confirm identities or complete election spending",
        )
        require(
            all(
                c["link_state"] == "not_confirmed_by_collection" and c["gap"]
                for c in candidates
            ),
            "Missing candidate coverage gap",
        )
        reports = collection["reports"]
        require(
            len(reports) == coverage["reports"]
            and len({(r["registration_number"], r["report_key"]) for r in reports})
            == len(reports),
            "Report coverage changed",
        )
        require(
            sum(r["payload"]["figures"] is not None for r in reports)
            == coverage["reports_with_figures"],
            "Figure coverage changed",
        )
        require(
            dict(Counter(r["payload"]["figure_status"] for r in reports))
            == coverage["report_status_counts"],
            "Report status counts changed",
        )
        for row in reports:
            p, filing = row["payload"], row["payload"]["filing"]
            require(
                p["registration_number"]
                == row["registration_number"]
                == filing["registration_number"],
                "Report registration changed",
            )
            key = digest(
                [
                    row["registration_number"],
                    filing["filing_year"],
                    filing["report_type"],
                    filing["effective_amendment_index"],
                    filing["special_election"],
                    row["document_hash"],
                ]
            )
            require(key == row["report_key"], "Report identity fingerprint changed")
            require(
                p["identity_confirmation"] is False
                and p["complete_election_spending"] is False,
                "Unsupported report attribution",
            )
            require(
                p["catalogue_source"]["sha256"] in sources and p["currency"] == "USD",
                "Report source missing",
            )
            if p["figures"] is None:
                require(
                    p["figure_status"] == "unavailable"
                    and bool(p["unavailable_reason"]),
                    "Unavailable figures need a reason",
                )
                continue
            require(
                p["figure_status"] == "source_verified"
                and p["unavailable_reason"] is None
                and row["document_hash"] == p["document"]["sha256"],
                "Figures require their exact document",
            )
            extraction = p["extraction"]
            require(
                extraction["status"] == "parsed_with_arithmetic_checks"
                and not extraction["errors"]
                and not extraction["parser_errors"]
                and extraction["figures"] == p["figures"],
                "Unverified parser output cannot supply figures",
            )
            require(
                p["period_start"] == extraction["cover"].get("period_start")
                and date.fromisoformat(p["period_start"]).year == filing["filing_year"]
                and p["period_end"] == filing["cut_off_date"]
                and p["period_basis"]
                == (
                    "calendar_year_to_date"
                    if p["period_start"] == f"{filing['filing_year']}-01-01"
                    else "reported_period"
                ),
                "Unknown report period",
            )
            require(
                date.fromisoformat(p["period_start"])
                <= date.fromisoformat(p["period_end"])
                <= datetime.fromisoformat(collection["copied_at"]).date(),
                "Invalid report dates",
            )
            require(
                set(p["figures"])
                == {
                    "contributions_received",
                    "campaign_expenditures",
                    "total_expenditures",
                },
                "Required figures missing",
            )
            for name, figure in p["figures"].items():
                parts = (
                    ("cash", "in_kind")
                    if name == "contributions_received"
                    else ("cash", "in_kind", "unpaid")
                )
                require(
                    all(
                        isinstance(figure[k], str)
                        and re.fullmatch(r"-?\d+\.\d{2}", figure[k])
                        for k in (*parts, "total")
                    ),
                    "Money must be exact USD decimals",
                )
                require(
                    sum(Decimal(figure[k]) for k in parts) == Decimal(figure["total"]),
                    "Report money does not add up",
                )
                require(
                    figure["source_page"] == 2
                    and figure["source_lines"]
                    == {
                        "contributions_received": [2, 3, 4, 5, 6],
                        "campaign_expenditures": [11],
                        "total_expenditures": [19],
                    }[name],
                    "Figure source changed",
                )
    except (KeyError, TypeError, AttributeError) as error:
        raise FinanceCollectionError(
            "Collection is missing required evidence"
        ) from error


def retain_collection_sources(db: Session, store, collection, originals, documents):
    """Append-only retention, committed before staging. Does not publish anything."""
    validate_collection(collection)
    require(
        {s["sha256"] for s in collection["sources"]} == set(originals),
        "Source body coverage changed",
    )
    required_docs = {
        r["document_hash"] for r in collection["reports"] if r["document_hash"]
    }
    require(required_docs == set(documents), "PDF body coverage changed")
    require(
        all(file_hash(b) == h for h, b in {**originals, **documents}.items()),
        "Retention body fingerprint changed",
    )
    with tempfile.TemporaryDirectory(prefix="election-finance-retain-") as directory:
        keeper = DocumentKeeper(db=db, store=store, directory=directory)
        for row in collection["reports"]:
            h = row["document_hash"]
            if not h:
                continue
            filing = row["payload"]["filing"]
            action = keeper.keep(
                document_hash=h,
                body=documents[h],
                registration_number=row["registration_number"],
                filing_year=filing["filing_year"],
                report_type=filing["report_type"],
                amendment_index=filing["effective_amendment_index"],
                special_election=filing["special_election"],
            )
            require(action != "failed", "Could not retain report document")
            stored = db.get(m.CampaignFinanceReportDocument, h, populate_existing=True)
            require(
                stored is not None
                and read_document(store, stored, directory) == documents[h],
                "Retained PDF read-back failed",
            )
            _document_matches(stored, row)
    for h, body in originals.items():
        require(archive_source(db, store, body) == h, "Retained response changed")
    db.commit()


def _document_matches(document, row):
    filing = row["payload"]["filing"]
    require(
        document is not None
        and (
            document.registration_number,
            document.filing_year,
            document.report_type,
            document.amendment_index,
            document.special_election,
        )
        == (
            row["registration_number"],
            filing["filing_year"],
            filing["report_type"],
            filing["effective_amendment_index"],
            filing["special_election"],
        ),
        "Retained PDF belongs to a different report",
    )


def _require_retained(db, collection):
    hashes = {s["sha256"] for s in collection["sources"]}
    held = set(
        db.scalars(
            select(m.ElectionResultSource.content_hash).where(
                m.ElectionResultSource.content_hash.in_(hashes)
            )
        )
    )
    require(held == hashes, "Retain every source before staging figures")
    for row in collection["reports"]:
        if row["document_hash"]:
            _document_matches(
                db.get(m.CampaignFinanceReportDocument, row["document_hash"]), row
            )
        else:
            require(row["payload"]["figures"] is None, "Figures have no retained PDF")


def _stored_collection(db, identifier):
    row = db.get(m.ElectionFinanceCollection, identifier, populate_existing=True)
    require(row is not None, "Collection is not staged")
    reports = [
        {
            "registration_number": r.registration_number,
            "report_key": r.report_key,
            "document_hash": r.document_hash,
            "payload": r.payload,
        }
        for r in db.scalars(
            select(m.ElectionFinanceReport)
            .where(m.ElectionFinanceReport.collection_id == identifier)
            .execution_options(populate_existing=True)
        )
    ]
    return {
        "format": 1,
        "id": row.id,
        "election_key": row.election_key,
        "copied_at": row.copied_at.isoformat(),
        "sources": row.sources,
        "coverage": row.coverage,
        "reports": reports,
    }


def stage_collection(db: Session, collection):
    """Stage all report/coverage rows atomically; caller commits. Pointer is untouched."""
    validate_collection(collection)
    _require_retained(db, collection)
    with db.begin_nested():
        if db.get(m.ElectionFinanceCollection, collection["id"]):
            validate_collection(_stored_collection(db, collection["id"]))
            return collection["id"]
        db.add(
            m.ElectionFinanceCollection(
                id=collection["id"],
                election_key=collection["election_key"],
                copied_at=datetime.fromisoformat(collection["copied_at"]),
                sources=collection["sources"],
                coverage=collection["coverage"],
            )
        )
        db.flush()
        for row in collection["reports"]:
            db.add(m.ElectionFinanceReport(collection_id=collection["id"], **row))
        db.flush()
        validate_collection(_stored_collection(db, collection["id"]))
    return collection["id"]


def publish_collection(db: Session, identifier, *, expected_previous, restore=False):
    """Explicit CAS publication/restore; never replaces global filing/payment state."""
    collection = _stored_collection(db, identifier)
    db.execute(
        text("SELECT pg_advisory_xact_lock(hashtext(:key))"),
        {"key": f"election-finance:{collection['election_key']}"},
    )
    current = db.get(
        m.ElectionFinanceCurrent, collection["election_key"], populate_existing=True
    )
    previous = current.collection_id if current else None
    require(
        previous == expected_previous,
        "Published collection changed; recheck the current pointer",
    )
    validate_collection(collection)
    _require_retained(db, collection)
    if previous and not restore:
        older = db.get(m.ElectionFinanceCollection, previous)
        if older is None:
            raise FinanceCollectionError("Published collection is not retained")
        require(
            older.copied_at <= datetime.fromisoformat(collection["copied_at"]),
            "Older collection requires explicit restore",
        )
    candidate = db.get(m.ElectionFinanceCollection, identifier)
    if candidate is None:
        raise FinanceCollectionError("Collection is not staged")
    if candidate.first_published_at is None:
        candidate.first_published_at = datetime.now(UTC)
        db.flush()
    db.execute(
        insert(m.ElectionFinanceCurrent)
        .values(election_key=collection["election_key"], collection_id=identifier)
        .on_conflict_do_update(
            index_elements=["election_key"], set_={"collection_id": identifier}
        )
    )
    return {
        "election_key": collection["election_key"],
        "previous": previous,
        "current": identifier,
    }
