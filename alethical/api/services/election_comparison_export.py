"""One pinned race, all selected reports and precincts, in scalar CSV rows.

This composition calls existing checked readers. It does not infer identities,
add overlapping periods, or turn different authorities' measures into one total.
"""

from __future__ import annotations

import csv
import hashlib
import io
import re
from decimal import Decimal
from datetime import UTC, datetime
from urllib.parse import urlencode

from sqlalchemy import select

from alethical.api.problems import problem_exception
from alethical.api.services import election_comparison_reads as results
from alethical.api.services import election_external_finance_reads as external
from alethical.api.services import election_finance_reads as finance
from alethical.api.services import election_outside_spending as outside
from alethical.db import models as m
from alethical.pipeline.election_external_adapters import register_external_adapters
from alethical.pipeline.election_comparison import ComparisonImportError

ORIGIN = "https://alethicalfinance.com"
BOARD_MEASURES = {
    "contributions_received": "Contributions received",
    "campaign_expenditures": "Campaign expenses",
    "all_disbursements": "All disbursements",
    "public_subsidy_payments": "Public subsidy received",
}
COLUMNS = (
    "Row type",
    "Generated",
    "Election",
    "Race ID",
    "Race",
    "Snapshot",
    "Board version",
    "Outcome version",
    "External generation",
    "External version",
    "Candidate ID",
    "Candidate",
    "Party",
    "District",
    "Result status",
    "Outcome",
    "Outcome status",
    "Race votes",
    "Candidate votes",
    "Vote share %",
    "Precinct votes",
    "Vote status",
    "Precinct",
    "Precinct key",
    "County",
    "County ID",
    "Precinct query",
    "County filter",
    "Matching precincts",
    "Authority",
    "Account ID",
    "Account",
    "Report key",
    "Report type",
    "Source report ID",
    "Period start",
    "Period end",
    "Period basis",
    "Received date",
    "Effective amendment",
    "Predecessor",
    "Overlapping selected reports",
    "Measure",
    "Measure ID",
    "Report cash",
    "Report unpaid",
    "Report in-kind",
    "Report total",
    "Measure value",
    "Unit",
    "Currency",
    "Payment key",
    "Payment date",
    "Direction",
    "Transaction type",
    "Funder",
    "Funder account",
    "Funder type",
    "Payee",
    "Payee city",
    "Payee state",
    "Payee ZIP",
    "Purpose",
    "Payment amount",
    "Included unpaid amount",
    "In-kind",
    "Memo",
    "Amount role",
    "Nonadditive",
    "State",
    "Record count",
    "Missing amount count",
    "Gap",
    "Source hash",
    "Source row",
    "Source page",
    "Source field",
    "Source URL",
    "Official source URL",
    "Copied at",
    "Note",
)
MAX_BYTES = 64 * 1024 * 1024


def _problem(status, text):
    raise problem_exception(
        status, "Records Changed" if status == 409 else "Export unavailable", text
    )


def _money(value):
    return None if value is None else Decimal(str(value))


def _cell(value):
    if value is None:
        return ""
    if isinstance(value, bool):
        return "Yes" if value else "No"
    if isinstance(value, Decimal):
        return (
            format(value, ".2f")
            if value == value.quantize(Decimal("0.01"))
            else format(value, "f")
        )
    if isinstance(value, (int, float)):
        return str(value)
    if not isinstance(value, str):
        raise TypeError("CSV fields must be scalar")
    return (
        "'" + value
        if value.lstrip().startswith(("=", "+", "-", "@"))
        or value.startswith(("\t", "\r", "\n"))
        else value
    )


def _words(value):
    """Only allowlisted public gap values reach this helper."""
    if isinstance(value, str):
        return value
    if isinstance(value, list):
        return "; ".join(filter(None, (_words(v) for v in value)))
    if isinstance(value, dict):
        return "; ".join(
            str(value[k])
            for k in ("state", "status", "reason", "gap", "next_action", "measure")
            if value.get(k) is not None
        )
    return ""


def _link(election, source_hash, kind, **pins):
    return f"{ORIGIN}/elections/{election}/sources/{source_hash}?" + urlencode(
        {"kind": kind, **pins}
    )


def _external_pins(values, candidates):
    pins = {}
    for value in values or ():
        candidate, separator, token = value.rpartition(":")
        if (
            not separator
            or candidate not in candidates
            or candidate in pins
            or not re.fullmatch(r"[a-f0-9]{64}", token)
        ):
            _problem(
                422, "External versions must identify distinct candidates in this race"
            )
        pins[candidate] = token
    return pins


def _latest_external(reports):
    eligible = [r for r in reports if r.get("effective") and r.get("period_end")]
    if not eligible:
        return None
    end = max(r["period_end"] for r in eligible)
    latest = [r for r in eligible if r["period_end"] == end]
    return latest[0]["report_key"] if len(latest) == 1 else None


def export_csv(
    db,
    *,
    election_key,
    race_id,
    snapshot_id,
    version=None,
    outcome_version=None,
    report_keys=(),
    q="",
    county=None,
    external_generation_id=None,
    external_versions=(),
):
    detail = results.race_detail(
        db, election_key=election_key, race_id=race_id, snapshot_id=snapshot_id
    )
    if (
        outcome_version is not None
        and detail["race"]["outcome_review"]["version"] != outcome_version
    ):
        _problem(409, "The election outcome changed. Reload this comparison.")
    board = finance.comparison(
        db,
        election_key=election_key,
        race_id=race_id,
        snapshot_id=snapshot_id,
        version=version,
    )
    race = detail["race"]
    candidates = {c["candidate_id"]: c for c in race["candidates"]}
    named = {key for key, c in candidates.items() if not c.get("is_write_in_aggregate")}
    pins = _external_pins(external_versions, named)
    external_data = []
    external_sources = {}
    current_external = db.get(m.ElectionExternalFinanceCurrent, election_key)
    if external_generation_id or current_external:
        try:
            register_external_adapters()
        except ComparisonImportError:
            _problem(503, "External finance records are temporarily unavailable")
        published = external._published_row(db, election_key, external_generation_id)
        if published.snapshot_id != snapshot_id:
            _problem(
                409,
                "External finance belongs to another election snapshot. Reload this comparison.",
            )
        external_generation_id = published.id
        store = external.request_store(external.raw_file_store_from_env())
        for candidate_id in sorted(named):
            cache = {}
            state = external._context(
                db,
                election_key=election_key,
                race_id=race_id,
                candidate_id=candidate_id,
                generation_id=external_generation_id,
                version=pins.get(candidate_id),
                store=store,
                cache=cache,
            )
            entry = external._candidate_records(db, state, cache=cache)
            external_sources.update(
                {source["sha256"]: source for source in state[1]["sources"]}
            )
            if entry["snapshot_id"] != snapshot_id:
                _problem(
                    409,
                    "External finance belongs to another election snapshot. Reload this comparison.",
                )
            external_generation_id = entry["generation_id"]
            external_data.append(entry)
    elif pins:
        _problem(409, "These external finance records are no longer available")

    common = {
        "Election": election_key,
        "Race ID": race_id,
        "Race": race["label"],
        "Snapshot": snapshot_id,
        "Board version": board["version"],
        "Outcome version": race["outcome_review"]["version"],
        "External generation": external_generation_id,
        "Result status": race["result_status"],
        "District": race.get("district"),
    }
    rows = []
    retained_size = 0

    def add(kind, **fields):
        nonlocal retained_size
        row = {**common, "Row type": kind, **fields}
        # Bound retained row memory before serializing, not after collecting a huge race.
        retained_size += sum(
            len(_cell(value).encode("utf-8")) * 2 + 3 for value in row.values()
        ) + len(COLUMNS)
        if retained_size > MAX_BYTES:
            _problem(503, "This complete export exceeds the download size limit")
        rows.append(row)

    def who(ids):
        return {
            "Candidate ID": "; ".join(sorted(ids)),
            "Candidate": "; ".join(candidates[c]["name"] for c in sorted(ids)),
            "Party": "; ".join(
                sorted({candidates[c].get("party") or "Not available" for c in ids})
            ),
        }

    references = {}

    def source(
        kind, h, *, subject=None, metadata=None, locator=None, collection_id=None
    ):
        if not h:
            return {}
        if not re.fullmatch(r"[a-f0-9]{64}", h):
            _problem(503, "This source reference is unavailable")
        metadata, locator = metadata or {}, locator or {}
        source_pins = (
            {"snapshot_id": snapshot_id}
            if kind == "election"
            else {"generation_id": external_generation_id}
            if kind == "external"
            else {
                "election_snapshot_id": snapshot_id,
                "version": board["payment_version"],
                "release_id": board["payment_release_id"],
            }
            if kind == "outside"
            else {"collection_id": collection_id or board["collection_id"]}
        )
        fields = {
            "Source hash": h,
            "Source URL": _link(election_key, h, kind, **source_pins),
            "Source row": locator.get(
                "row", locator.get("record", locator.get("sub_id"))
            ),
            "Source page": locator.get("page"),
            "Source field": locator.get("field", locator.get("column")),
        }
        key = (kind, h, source_pins.get("collection_id", ""))
        references.setdefault(
            key,
            {
                "metadata": metadata,
                "fields": {
                    **fields,
                    "Source row": None,
                    "Source page": None,
                    "Source field": None,
                },
                "pins": source_pins,
            },
        )
        if subject:
            add("Evidence", **subject, **fields)
        return fields

    # Only referenced race sources are exported, never every source in the election.
    election_sources = {s["sha256"]: s for s in detail["sources"]}
    for key in ("source_sha256", "candidate_source_sha256", "summary_source_sha256"):
        h = race.get(key)
        if h:
            source("election", h, metadata=election_sources.get(h))
    add(
        "Race",
        **{
            "Race votes": race.get("total_votes"),
            "State": race.get("precinct_voter_bound_status"),
            "Note": "Whole-race official returns; precinct filters do not change candidate totals",
        },
    )
    for cid, candidate in candidates.items():
        add(
            "Candidate",
            **who({cid}),
            **{
                "Candidate votes": candidate.get("votes"),
                "Vote share %": (
                    Decimal(candidate["votes"]) * 100 / Decimal(race["total_votes"])
                ).quantize(Decimal("0.01"))
                if candidate.get("votes") is not None
                and race.get("total_votes") is not None
                and race["total_votes"] > 0
                else None,
                "Vote status": "reported"
                if candidate.get("votes") is not None
                else "not_available",
                "Outcome": candidate.get("outcome"),
                "Outcome status": candidate.get("outcome_status"),
                **source(
                    "election",
                    race.get("candidate_source_sha256") or race.get("source_sha256"),
                    metadata=election_sources.get(
                        race.get("candidate_source_sha256") or race.get("source_sha256")
                    ),
                    locator={"row": candidate.get("candidate_source_row")},
                ),
            },
        )
    for evidence in race["outcome_review"].get("evidence", []):
        subject = {
            "Candidate ID": evidence.get("candidate_id"),
            "Outcome": evidence.get("outcome"),
            "State": evidence.get("status"),
        }
        for hash_key in ("sha256", "publisher_sha256"):
            h = evidence.get(hash_key)
            source(
                "election",
                h,
                subject=subject,
                metadata=election_sources.get(h),
                locator=evidence.get("locator"),
            )
    for diagnostic in race.get("diagnostics", []):
        add(
            "Gap",
            **{
                "State": "source_discrepancy",
                "County ID": diagnostic.get("county_id"),
                "Precinct key": diagnostic.get("precinct_id"),
                "Gap": "Reported office votes exceed separately reported voters; exact returns retained",
            },
        )

    inventory = {}
    defaults = set()

    def register(report, authority, account_id, account_name, cid, kind):
        key = report["report_key"]
        item = inventory.setdefault(
            key,
            {
                "report": report,
                "authority": authority,
                "account_id": account_id,
                "account_name": account_name,
                "candidates": set(),
                "kind": kind,
                "variants": {},
            },
        )
        identity_fields = (
            "report_key",
            "period_start",
            "period_end",
            "document_hash",
            "source_sha256",
            "source_report_id",
            "series_id",
            "received_date",
            "filing",
        )
        if (item["authority"], item["account_id"]) != (authority, account_id) or any(
            item["report"].get(field) != report.get(field) for field in identity_fields
        ):
            _problem(409, "A report has conflicting checked source identities")
        item["candidates"].add(cid)
        item["variants"][cid] = report
        if report.get("figures") and not item["report"].get("figures"):
            item["report"] = report

    def figure_rows(item):
        combined = {}
        for cid, variant in item["variants"].items():
            values = variant.get("figures") or ({} if item["kind"] == "report" else [])
            entries = (
                values.items()
                if isinstance(values, dict)
                else ((f["measure"], f) for f in values)
            )
            for measure, figure in entries:
                identity = (
                    measure,
                    figure.get("period_start"),
                    figure.get("period_end"),
                    figure.get("basis"),
                    figure.get("source_column"),
                )
                entry = combined.setdefault(identity, (measure, figure, set()))
                if entry[1] != figure:
                    _problem(
                        409, "A report measure has conflicting checked source values"
                    )
                entry[2].add(cid)
        return combined.values()

    for candidate in board["candidates"]:
        cid = candidate["candidate_id"]
        add(
            "Coverage",
            **who({cid}),
            **{
                "Authority": candidate.get("finance_coverage", {}).get("authority"),
                "State": candidate.get("report_state"),
                "Gap": _words(candidate.get("finance_coverage"))
                or _words(candidate.get("account_gaps")),
            },
        )
        for account in candidate["accounts"]:
            if account["authority"] != "mn_cfb":
                continue
            add(
                "Account association",
                **who({cid}),
                **{
                    "Authority": "mn_cfb",
                    "Account ID": account["registration_number"],
                    "Account": account.get("committee_name"),
                    "Period start": account.get("period_start"),
                    "Period end": account.get("period_end"),
                    "State": "checked",
                },
            )
            for report in account.get("reports") or []:
                register(
                    report,
                    "mn_cfb",
                    account["registration_number"],
                    account.get("committee_name"),
                    cid,
                    "report",
                )
            latest = account["latest_report"].get("report_key")
            if latest:
                defaults.add(latest)
            elif not report_keys:
                add(
                    "Gap",
                    **who({cid}),
                    **{
                        "Authority": "mn_cfb",
                        "Account ID": account["registration_number"],
                        "State": account["latest_report"]["state"],
                    },
                )
            for evidence in account.get("evidence", []):
                h = evidence.get("sha256")
                if h:
                    source(
                        "report"
                        if evidence.get("kind") in {"report_cover", "report_excerpt"}
                        else "election"
                        if evidence.get("kind") == "ballot"
                        else "finance",
                        h,
                        subject=who({cid})
                        | {
                            "Authority": "mn_cfb",
                            "Account ID": account["registration_number"],
                        },
                        locator=evidence,
                        collection_id=evidence.get("collection_id"),
                    )
    for entry in external_data:
        cid = entry["candidate_id"]
        add(
            "Version",
            **who({cid}),
            **{
                "External version": entry["version"],
                "Authority": "external",
                "State": entry["coverage"]["status"],
                "Gap": _words(entry.get("account_gaps")) or _words(entry["coverage"]),
            },
        )
        for binding in entry["coverage"].get("sources", []):
            source(
                "external",
                binding["source_sha256"],
                subject=who({cid}) | {"State": entry["coverage"]["status"]},
                locator=binding.get("locator"),
            )
        accounts = {(a["authority"], a["account_id"]): a for a in entry["accounts"]}
        for a in accounts.values():
            add(
                "Account association",
                **who({cid}),
                **{
                    "Authority": a["authority"],
                    "Account ID": a["account_id"],
                    "Account": a["name"],
                    "Period start": a["period_start"],
                    "Period end": a["period_end"],
                    "State": "checked",
                },
            )
            held = [
                r
                for r in entry["reports"]
                if (r["authority"], r["account_id"])
                == (a["authority"], a["account_id"])
            ]
            latest = _latest_external(held)
            if latest:
                defaults.add(latest)
            elif not report_keys:
                add(
                    "Gap",
                    **who({cid}),
                    **{
                        "Authority": a["authority"],
                        "Account ID": a["account_id"],
                        "State": "latest_report_unavailable_or_ambiguous",
                    },
                )
                for unavailable in held:
                    add(
                        "Gap",
                        **who({cid}),
                        **{
                            "Authority": a["authority"],
                            "Account ID": a["account_id"],
                            "Report key": unavailable["report_key"],
                            "State": unavailable.get("check_status"),
                            "Gap": unavailable.get("next_action"),
                        },
                    )
        for report in entry["reports"]:
            a = accounts[(report["authority"], report["account_id"])]
            register(
                report,
                report["authority"],
                report["account_id"],
                a["name"],
                cid,
                "external",
            )
    selected = set(report_keys) if report_keys else defaults
    if len(selected) != len(report_keys) and report_keys:
        _problem(422, "Select each report only once")
    if selected - inventory.keys():
        _problem(422, "Selected reports must belong to checked accounts in this race")
    for key in sorted(selected):
        item = inventory[key]
        r = item["report"]
        overlaps = sorted(
            k
            for k in selected
            if k != key
            and (inventory[k]["authority"], inventory[k]["account_id"])
            == (item["authority"], item["account_id"])
            and r.get("period_start")
            and r.get("period_end")
            and inventory[k]["report"].get("period_start")
            and inventory[k]["report"].get("period_end")
            and r["period_start"] <= inventory[k]["report"]["period_end"]
            and inventory[k]["report"]["period_start"] <= r["period_end"]
        )
        fields = {
            **who(item["candidates"]),
            "Authority": item["authority"],
            "Account ID": item["account_id"],
            "Account": item["account_name"],
            "Report key": key,
            "Report type": r.get("report_type")
            or r.get("filing", {}).get("report_type"),
            "Source report ID": r.get("source_report_id"),
            "Period start": r.get("period_start"),
            "Period end": r.get("period_end"),
            "Period basis": r.get("period_basis"),
            "Received date": r.get("received_date"),
            "Effective amendment": r.get(
                "effective", r.get("filing", {}).get("effective_amendment_index")
            ),
            "Predecessor": r.get("predecessor_report_key"),
            "Overlapping selected reports": "; ".join(overlaps),
            "Nonadditive": True,
            "State": r.get("check_status", r.get("figure_status")),
            "Note": "Each report and measure stands alone; overlapping periods and different measures are not added",
        }
        add("Report", **fields)
        for cid, variant in item["variants"].items():
            add(
                "Report association",
                **fields
                | who({cid})
                | {"State": variant.get("attribution", variant.get("check_status"))},
            )
        if item["kind"] == "report":
            h = r.get("document_hash")
            sf = source("report", h, metadata=r.get("document"))
            for k in ("catalogue_source", "financial_source"):
                meta = r.get(k) or {}
                source(
                    "finance",
                    meta.get("sha256"),
                    subject={"Report key": key, "Authority": item["authority"]},
                    metadata=meta,
                )
            for measure, amount, figure_candidates in figure_rows(item):
                add(
                    "Figure",
                    **fields
                    | who(figure_candidates)
                    | sf
                    | {
                        "Measure": BOARD_MEASURES.get(measure, measure),
                        "Measure ID": measure,
                        "Currency": "USD",
                        "Report cash": _money(amount.get("cash")),
                        "Report unpaid": _money(amount.get("unpaid")),
                        "Report in-kind": _money(amount.get("in_kind")),
                        "Report total": _money(amount.get("total")),
                        "Source page": amount.get("source_page"),
                    },
                )
            for gap in (r.get("unavailable_reason"), r.get("public_subsidy_gap")):
                if gap:
                    add("Gap", **fields | {"Gap": gap})
        else:
            source("external", r.get("source_sha256"))
            for binding in r.get("sources", []):
                source(
                    "external",
                    binding["source_sha256"],
                    subject={"Report key": key},
                    locator=binding.get("locator"),
                )
            for _, figure, figure_candidates in figure_rows(item):
                add(
                    "Figure",
                    **fields
                    | {
                        **who(figure_candidates),
                        "Measure": figure.get("label") or figure["measure"],
                        "Measure ID": figure["measure"],
                        "Measure value": _money(figure["value"]),
                        "Unit": figure["unit"],
                        "Currency": figure.get("currency"),
                        "Period start": figure["period_start"],
                        "Period end": figure["period_end"],
                        "Period basis": figure.get("basis"),
                        "Source field": figure.get("source_column"),
                    },
                )
                for binding in figure.get("sources", []):
                    source(
                        "external",
                        binding["source_sha256"],
                        subject={"Report key": key, "Measure": figure["measure"]},
                        locator=binding.get("locator"),
                    )
            for gap in r.get("withheld_measures", []):
                add("Gap", **fields | {"Gap": _words(gap)})

    # Read all matching precinct pages, keeping the original page's exact scope.
    offset = 0
    total = None
    while True:
        page = results.precincts(
            db,
            election_key=election_key,
            race_id=race_id,
            snapshot_id=snapshot_id,
            q=q,
            county=county,
            limit=100,
            offset=offset,
        )
        if total is None:
            total = page["page"]["total"]
        if (
            total != page["page"]["total"]
            or page["outcome_review"] != detail["race"]["outcome_review"]
        ):
            _problem(409, "These election records changed. Reload this comparison.")
        for precinct in page["precincts"]:
            h = precinct.get("source_sha256") or race.get("source_sha256")
            for row in precinct.get("rows", []):
                add(
                    "Precinct candidate",
                    **{
                        "Candidate ID": row.get("candidate_id"),
                        "Candidate": row.get("candidate_name", row.get("name")),
                        "Party": row.get("party"),
                        "Precinct votes": row.get("votes"),
                        "Vote status": "reported"
                        if row.get("votes") is not None
                        else "not_available",
                        "Precinct": precinct["name"],
                        "Precinct key": precinct["key"],
                        "County": precinct.get("county_name"),
                        "County ID": precinct["county"],
                        **source(
                            "election",
                            row.get("source_sha256") or h,
                            metadata=election_sources.get(
                                row.get("source_sha256") or h
                            ),
                            locator={"row": row.get("row_number")},
                        ),
                    },
                )
        offset += len(page["precincts"])
        if not page["page"]["has_more"]:
            break
        if not page["precincts"] or offset >= total:
            _problem(503, "The complete precinct export is unavailable")
    if offset != total:
        _problem(503, "The complete precinct export is unavailable")

    # Existing attribution filters, one query per scope/candidate, no repeated source reads per page.
    context, election, race_record, _, _, release, _ = finance._context(
        db, election_key, race_id, snapshot_id, board["version"]
    )
    board_payments = {}
    if release:
        R = finance.R
        for candidate in board["candidates"]:
            cid = candidate["candidate_id"]
            links = finance._accounts(db, election_key, race_record, candidate)
            for scope, filterer in (
                ("checked_account_and_period", finance._attribution_filters),
                ("outside_checked_period", finance._outside_reviewed_period_filters),
            ):
                filters = filterer(
                    release, election.election_date.year, links["accounts"]
                )
                for row in db.scalars(
                    select(R)
                    .where(*filters)
                    .order_by(R.row_number)
                    .execution_options(yield_per=200)
                ):
                    key = row.row_number
                    record = board_payments.setdefault(
                        key,
                        {
                            "row": row,
                            "candidates": set(),
                            "scopes": set(),
                            "associations": {},
                        },
                    )
                    record["candidates"].add(cid)
                    record["scopes"].add(scope)
                    record["associations"].setdefault(cid, set()).add(scope)
            groups = candidate["outside_spending"]
            add(
                "Outside availability",
                **who({cid}),
                **{
                    "Authority": "mn_cfb",
                    "State": groups["state"],
                    "Record count": (groups.get("total") or {}).get("record_count"),
                    "Missing amount count": (groups.get("total") or {}).get(
                        "missing_amount_count"
                    ),
                    "Note": "Payment rows carry amounts once; unpaid is included in the reported amount",
                },
            )
            for gap in (
                "excluded_missing_date",
                "excluded_missing_year",
                "excluded_outside_reviewed_period",
            ):
                if groups.get(gap, {}).get("record_count"):
                    add(
                        "Gap",
                        **who({cid}),
                        **{
                            "Authority": "mn_cfb",
                            "State": gap,
                            "Record count": groups[gap]["record_count"],
                            "Missing amount count": groups[gap].get(
                                "missing_amount_count"
                            ),
                        },
                    )
        if board_payments or any(
            c["outside_spending"].get("total") is not None for c in board["candidates"]
        ):
            sf = source(
                "outside",
                board["payment_source"]["content_hash"],
                metadata=board["payment_source"],
            )
            for key, item in sorted(board_payments.items()):
                row = item["row"]
                checked_ids = {
                    cid
                    for cid, scopes in item["associations"].items()
                    if "checked_account_and_period" in scopes
                }
                for cid, scopes in item["associations"].items():
                    add(
                        "Payment association",
                        **who({cid}),
                        **{
                            "Payment key": f"{board['payment_source']['content_hash']}:{key}",
                            "Authority": "mn_cfb",
                            "State": "; ".join(sorted(scopes)),
                        },
                    )
                add(
                    "Outside payment",
                    **who(checked_ids or item["candidates"]),
                    **sf
                    | {
                        "Authority": "mn_cfb",
                        "Payment key": f"{board['payment_source']['content_hash']}:{key}",
                        "Source row": key,
                        "State": "; ".join(sorted(item["scopes"])),
                        "Payment date": row.transaction_date.isoformat()
                        if row.transaction_date
                        else None,
                        "Direction": row.for_against,
                        "Transaction type": row.type,
                        "Funder": row.spender,
                        "Funder account": row.spender_reg_num,
                        "Funder type": row.spender_type,
                        "Account ID": row.affected_committee_reg_num,
                        "Account": row.affected_committee_name,
                        "Payee": row.vendor_name,
                        "Payee city": row.vendor_city,
                        "Payee state": row.vendor_state,
                        "Payee ZIP": row.vendor_zip,
                        "Purpose": row.purpose,
                        "Payment amount": row.amount,
                        "Included unpaid amount": row.unpaid_amount,
                        "In-kind": row.in_kind,
                        "Currency": "USD",
                        "Period basis": "source_reported_calendar_year",
                        "Amount role": "independent_spending",
                        "Nonadditive": not bool(checked_ids),
                    },
                )
    else:
        add(
            "Gap",
            **{
                "Authority": "mn_cfb",
                "State": "outside_spending_unavailable",
                "Gap": _words(board["outside_spending_availability"]),
            },
        )
    external_payments = {}
    for entry in external_data:
        for payment in entry["payments"]:
            if not payment.get("effective"):
                continue
            item = external_payments.setdefault(
                payment["payment_key"], {"payment": payment, "candidates": set()}
            )
            if item["payment"] != payment:
                _problem(409, "A payment has conflicting source records")
            item["candidates"].add(entry["candidate_id"])
    for key, item in sorted(external_payments.items()):
        p = item["payment"]
        payee = p.get("payee") or {}
        fields = {
            **who(item["candidates"]),
            "Authority": p["authority"],
            "Account ID": p["account_id"],
            "Report key": p["report_key"],
            "Payment key": key,
            "Source report ID": p.get("source_report_id"),
            "Effective amendment": p.get("effective"),
            "Payment date": p.get("date"),
            "Direction": p.get("direction"),
            "Transaction type": p.get("transaction_type"),
            "Payee": payee.get("name") if isinstance(payee, dict) else payee,
            "Purpose": p.get("purpose"),
            "Payment amount": _money(p.get("amount")),
            "Currency": p.get("currency"),
            "Period start": p.get("period_start"),
            "Period end": p.get("period_end"),
            "Memo": p["memo"].get("text")
            if isinstance(p.get("memo"), dict)
            else p.get("memo"),
            "Amount role": p["amount_role"],
            "Nonadditive": p["nonadditive"],
            "State": "checked",
        }
        add("External payment", **fields)
        for binding in p["sources"]:
            source(
                "external",
                binding["source_sha256"],
                subject={"Payment key": key},
                locator=binding.get("locator"),
            )

    # Successful CSV requires exact bytes for every source it cites, including zeros.
    for (kind, h, _), ref in sorted(references.items()):
        if kind == "election":
            _, meta = results.source_body(
                db, election_key=election_key, snapshot_id=snapshot_id, source_hash=h
            )
        elif kind == "report":
            finance.source_pdf(
                db,
                election_key=election_key,
                collection_id=ref["pins"]["collection_id"],
                document_hash=h,
            )
            meta = ref["metadata"]
        elif kind == "finance":
            _, meta = finance.source_body(
                db,
                election_key=election_key,
                collection_id=ref["pins"]["collection_id"],
                source_hash=h,
            )
        elif kind == "outside":
            body = outside.source_body(
                db,
                election_key=election_key,
                election_snapshot_id=snapshot_id,
                version=board["payment_version"],
                release_id=release.id,
            )
            if hashlib.sha256(body).hexdigest() != h:
                _problem(409, "The outside spending source changed")
            meta = ref["metadata"]
        else:
            original = db.get(m.ElectionResultSource, h)
            if h not in external_sources or original is None:
                _problem(503, "This retained external source is unavailable")
            try:
                external.read_source(store, original)
            except Exception:
                _problem(503, "This retained external source is unavailable")
            meta = external.public_source(external_sources[h])
        add(
            "Source",
            **ref["fields"]
            | {
                "Official source URL": meta.get("url", meta.get("source_url")),
                "Copied at": meta.get("copied_at", meta.get("fetched_at")),
            },
        )
    finance._check_end_version(db, context)
    final = results.race_detail(
        db, election_key=election_key, race_id=race_id, snapshot_id=snapshot_id
    )
    if final["race"]["outcome_review"] != race["outcome_review"]:
        _problem(409, "The election outcome changed")
    metadata = {
        **common,
        "Row type": "Metadata",
        "Generated": datetime.now(UTC).isoformat(),
        "Precinct query": " ".join(q.split()),
        "County filter": county,
        "Matching precincts": total,
        "Copied at": detail["copied_at"],
        "Note": "Exact USD cents; blank is unknown, zero is reported zero. Whole-race candidate votes and filtered precinct votes are separate. Reports, authorities and measures are not summed. Outside spending uses its own source dates. Shared account and payment amounts appear once.",
    }
    stream = io.StringIO(newline="")
    writer = csv.DictWriter(stream, fieldnames=COLUMNS, extrasaction="raise")
    writer.writeheader()
    for row in [metadata, *rows]:
        writer.writerow({k: _cell(v) for k, v in row.items()})
        if stream.tell() > MAX_BYTES:
            _problem(503, "This complete export exceeds the download size limit")
    body = stream.getvalue().encode("utf-8-sig")
    if len(body) > MAX_BYTES:
        _problem(503, "This complete export exceeds the download size limit")
    return body
