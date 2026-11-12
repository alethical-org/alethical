"""Exact dated candidate-report expense/subsidy data; no subsidy tracing.

Published immutable detail is checked at write boundaries. Reads re-hash relevant
originals without reparsing PDFs and never cache source availability. A unique
account/report contributes once, including when several candidacies claim it.
"""

from __future__ import annotations

from collections import defaultdict
from copy import deepcopy
from datetime import UTC, datetime
from types import SimpleNamespace
from typing import Any, NoReturn
from decimal import Decimal, localcontext
import csv
import io
import json
import re
import time
from urllib.parse import parse_qsl, quote, urlencode, urlsplit

from fastapi import HTTPException
from sqlalchemy import select

from alethical.api.problems import problem_exception
from alethical.api.services import finance_versions
from alethical.api.services.election_source_io import (
    SOURCE_WORKERS,
    request_store,
    source_map,
)
from alethical.api.services import election_comparison_reads as results
from alethical.api.services import election_finance_reads as finance
from alethical.api.services import election_external_finance_reads as external
from alethical.api.services.election_analytics import (
    _SourceProof,
    _bulk_accounts,
    _verify_original,
)
from alethical.db import models as m
from alethical.pipeline.election_comparison import digest
from alethical.api.services.election_source_io import (
    reader_store_from_env as raw_file_store_from_env,
)

COLUMNS = ("paid", "unpaid", "in_kind", "total")
PARTIES = ("R", "DFL", "NP", "other", "unknown")
GEOGRAPHIES = ("MN", "out_of_state", "unknown")


def _bad(message) -> NoReturn:
    raise problem_exception(422, "Invalid Expense Query", message)


def _money(values=()):
    return {
        key: format(sum((Decimal(row[key]) for row in values), Decimal(0)), ".2f")
        for key in COLUMNS
    }


def _party(value):
    if value in {"R", "DFL", "NP"}:
        return value
    return "other" if isinstance(value, str) and value.strip() else "unknown"


def _safe_text(value):
    """Escape spreadsheet formulas, while exact decimals use separate columns."""
    value = str(value) if value is not None else ""
    return (
        "'" + value
        if value.lstrip().startswith(("=", "+", "-", "@"))
        or value.startswith(("\t", "\r", "\n"))
        else value
    )


def _source(row):
    return finance._source(row or {})


def _location(item):
    if item is None:
        return None
    # Exact source snippets only. No internal paths or review fields survive.
    return {
        key: item[key]
        for key in ("source_sha256", "page", "line", "text")
        if key in item
    }


def _identity(item):
    if item is None:
        return None
    address = item.get("address") or {}
    return {
        "name": item.get("name"),
        "address": {
            k: address.get(k)
            for k in (
                "lines",
                "street",
                "city",
                "state",
                "postal_code",
                "geography_status",
            )
        },
        "source": [_location(s) for s in item.get("source", [])],
    }


def _public_gap(value):
    return value.replace("_not_filed", "_not_in_source")


def _party_sources(race, candidate):
    """Local roster lacks party: cite the actual official result record instead."""
    if not candidate.get("party"):
        return []
    if str(candidate.get("candidate_stable_id") or "").startswith("local_cand:"):
        records = candidate.get("summary_sources") or [
            {"source_sha256": race.payload.get("source_sha256"), "row_number": row}
            for row in candidate.get("source_rows", [])
        ]
        kind = "official_result"
    else:
        records = [
            {
                "source_sha256": race.payload.get("candidate_source_sha256"),
                "row_number": candidate.get("candidate_source_row"),
            }
        ]
        kind = "candidate_roster"
    return [
        {
            "kind": kind,
            "source_sha256": record["source_sha256"],
            "row_number": record.get("row_number"),
            "candidate_id": candidate["candidate_id"],
            "party_value": candidate["party"],
        }
        for record in records
        if record.get("source_sha256")
    ]


def _public_party_sources(race, candidate, availability):
    return [
        {
            **source,
            "availability": "available"
            if availability.get(source["source_sha256"])
            else "unavailable"
            if source["source_sha256"] in availability
            else "not_checked",
        }
        for source in _party_sources(race, candidate)
    ]


def _payee_id(payee):
    if payee is None or not payee.get("name"):
        return None
    return digest([payee["name"], payee.get("address", {}).get("lines", [])])


def _geography(payee):
    address = payee.get("address", {}) if payee else {}
    if address.get("geography_status") != "filed_us":
        return "unknown"
    return "MN" if address.get("state") == "MN" else "out_of_state"


def _latest(reports, copied_at):
    stubs = [
        {
            "report_key": r.report_key,
            "filing": r.payload["filing"],
            "figures": r.payload.get("figures"),
            "period_start": r.payload.get("period_start"),
            "period_end": r.payload.get("period_end"),
        }
        for r in reports
    ]
    choice = finance._latest(stubs, copied_at)
    return next(
        (r for r in reports if r.report_key == choice["report_key"]), None
    ), choice["state"]


def _effective_options(reports, copied_at):
    """One unambiguous effective amendment per exact regular 2026 series."""
    series = defaultdict(list)
    for report in reports:
        filing = report.payload["filing"]
        if (
            filing.get("filing_year") == 2026
            and filing.get("special_election") is False
            and filing.get("cut_off_date")
            and filing["cut_off_date"] <= copied_at.date().isoformat()
            and filing.get("effective_amendment_index") is not None
        ):
            series[
                (
                    report.registration_number,
                    filing["filing_year"],
                    filing["report_type"],
                    filing["special_election"],
                    filing["cut_off_date"],
                )
            ].append(report)
    result = []
    for versions in series.values():
        maximum = max(
            r.payload["filing"]["effective_amendment_index"] for r in versions
        )
        effective = [
            r
            for r in versions
            if r.payload["filing"]["effective_amendment_index"] == maximum
        ]
        if len(effective) == 1:
            result.append(effective[0])
    return sorted(
        result,
        key=lambda r: (
            r.registration_number,
            r.payload["filing"]["cut_off_date"],
            r.payload["filing"]["report_type"],
            r.report_key,
        ),
    )


def _report_options(context, options, selected, availability):
    groups = defaultdict(list)
    for registration_number in selected:
        groups[registration_number] = []
    for report in options:
        filing = report.payload["filing"]
        chosen = selected.get(report.registration_number, (None, None))[0]
        is_selected = chosen is not None and chosen.report_key == report.report_key
        required = (
            (
                [chosen.document_hash]
                + [
                    chosen.payload[k]["sha256"]
                    for k in ("catalogue_source", "financial_source")
                    if chosen.payload.get(k)
                ]
            )
            if is_selected
            else []
        )
        source_state = (
            (
                "available"
                if all(availability.get(h, False) for h in required)
                else "unavailable"
            )
            if is_selected
            else "not_checked"
        )
        groups[report.registration_number].append(
            {
                "report_key": report.report_key,
                "collection_id": context["collection_id"],
                "filing": {
                    k: filing.get(k)
                    for k in (
                        "filing_year",
                        "report_type",
                        "report_name",
                        "cut_off_date",
                        "special_election",
                        "effective_amendment_index",
                        "amendment_count",
                    )
                },
                "period_start": report.payload.get("period_start"),
                "period_end": report.payload.get("period_end"),
                "period_basis": report.payload.get("period_basis"),
                "document_hash": report.document_hash,
                "selected": is_selected,
                "source_state": source_state,
            }
        )
    return [
        {"registration_number": reg, "reports": rows}
        for reg, rows in sorted(groups.items())
    ]


def _restore_one(store, kind, row):
    try:
        return _verify_original(
            store,
            _SourceProof(
                row.object_key,
                row.compression,
                row.compressed_hash,
                row.compressed_byte_size,
                row.document_hash if kind == "document" else row.content_hash,
                row.byte_size,
                b"%PDF" if kind == "document" else None,
            ),
        )
    except Exception:
        # Store SDK errors can include private object paths. Availability is the
        # public fact; no exception, reviewer or internal identifier is exported.
        return False


def _source_states(
    db,
    document_hashes,
    source_hashes,
    *,
    trace=None,
    document_roles=None,
    document_account_roles=None,
    store=None,
):
    documents = (
        {
            r.document_hash: r
            for r in db.scalars(
                select(m.CampaignFinanceReportDocument).where(
                    m.CampaignFinanceReportDocument.document_hash.in_(document_hashes)
                )
            )
        }
        if document_hashes
        else {}
    )
    sources = (
        {
            r.content_hash: r
            for r in db.scalars(
                select(m.ElectionResultSource).where(
                    m.ElectionResultSource.content_hash.in_(source_hashes)
                )
            )
        }
        if source_hashes
        else {}
    )
    states = {h: False for h in document_hashes | source_hashes}
    try:
        store = request_store(store or raw_file_store_from_env())
    except Exception:
        return states
    jobs = [
        (
            h,
            kind,
            SimpleNamespace(
                **{
                    key: getattr(row, key)
                    for key in (
                        "object_key",
                        "compression",
                        "compressed_hash",
                        "compressed_byte_size",
                        "byte_size",
                        "document_hash" if kind == "document" else "content_hash",
                    )
                }
            ),
        )
        for kind, rows in (("document", documents), ("source", sources))
        for h, row in rows.items()
    ]

    # DB access finishes before workers begin; threads only read loaded metadata
    # and independent temp files. No unbounded fan-out or availability cache.
    def checked(job):
        started = time.perf_counter()
        return (
            job[0],
            job[1],
            _restore_one(store, job[1], job[2]),
            time.perf_counter() - started,
        )

    restored = {}
    for fingerprint, kind, okay, elapsed in source_map(checked, jobs):
        restored[(kind, fingerprint)] = bool(okay)
        if trace is not None:
            trace.setdefault("original_gets", []).append(
                {
                    "sha256": fingerprint,
                    "storage_kind": kind,
                    "available": bool(okay),
                    "seconds": elapsed,
                }
            )
    for fingerprint in states:
        roles = (["document"] if fingerprint in document_hashes else []) + (
            ["source"] if fingerprint in source_hashes else []
        )
        states[fingerprint] = all(
            restored.get((kind, fingerprint), False) for kind in roles
        )
        if states[fingerprint] and document_roles and fingerprint in document_roles:
            row = documents.get(fingerprint)
            assert row is not None  # A successful original restore requires this row.
            identity = (
                row.registration_number,
                row.filing_year,
                row.report_type,
                row.amendment_index,
                row.special_election,
            )
            states[fingerprint] = all(
                identity == expected for expected in document_roles[fingerprint]
            )
        if (
            states[fingerprint]
            and document_account_roles
            and fingerprint in document_account_roles
        ):
            row = documents.get(fingerprint)
            states[fingerprint] = row is not None and all(
                row.registration_number == expected
                for expected in document_account_roles[fingerprint]
            )
    return states


def _source_dependencies(decisions, selected, party_dependencies=()):
    """Diagnostic source graph, including historical attribution dependencies."""
    uses = defaultdict(list)
    seen = set()
    for decision in sorted(decisions, key=lambda d: d.id, reverse=True):
        key = (decision.race_id, decision.candidate_id, decision.registration_number)
        scope = (
            "current_account_evidence"
            if key not in seen
            else "historical_account_evidence"
        )
        seen.add(key)
        for item in decision.evidence:
            kind = (
                "document"
                if item.get("kind") in {"report_cover", "report_excerpt"}
                else "source"
            )
            uses[(kind, item["sha256"])].append(
                {
                    "dependency": scope,
                    "evidence_kind": item.get("kind"),
                    "race_id": decision.race_id,
                    "candidate_id": decision.candidate_id,
                    "registration_number": decision.registration_number,
                }
            )
    for report, state in selected.values():
        if report is None:
            continue
        if report.document_hash:
            uses[("document", report.document_hash)].append(
                {
                    "dependency": "selected_report",
                    "registration_number": report.registration_number,
                    "report_key": report.report_key,
                }
            )
        for key in ("catalogue_source", "financial_source"):
            if report.payload.get(key):
                uses[("source", report.payload[key]["sha256"])].append(
                    {
                        "dependency": "selected_" + key,
                        "registration_number": report.registration_number,
                        "report_key": report.report_key,
                    }
                )
    for dependency in party_dependencies:
        uses[("source", dependency["source_sha256"])].append(
            {k: v for k, v in dependency.items() if k != "source_sha256"}
        )
    return [
        {"storage_kind": kind, "sha256": fingerprint, "uses": values}
        for (kind, fingerprint), values in sorted(uses.items())
    ]


def _load(
    db,
    election_key,
    snapshot_id=None,
    *,
    race_id=None,
    candidate_id=None,
    party=None,
    candidate_query="",
    report_keys=(),
    trace=None,
    pinned=False,
    store=None,
):
    election = results.snapshot(db, election_key)
    if election.stage != "general" or election.election_date.year != 2026:
        _bad("Expense reports currently cover the 2026 general election")
    if snapshot_id is not None and snapshot_id != election.id:
        finance._changed()
    current = db.get(m.ElectionFinanceCurrent, election_key)
    collection = (
        finance._collection(db, election_key)
        if current
        else SimpleNamespace(
            id=None, copied_at=election.fetched_at, sealed_at=None, coverage={}
        )
    )
    reports = finance.expense_report_index(db, collection) if current else []
    races = list(
        db.scalars(
            select(m.ElectionComparisonRace)
            .where(m.ElectionComparisonRace.snapshot_id == election.id)
            .order_by(m.ElectionComparisonRace.id)
        )
    )
    accounts, stamp = _bulk_accounts(db, election_key, races, verify_originals=False)
    scope_keys = {
        (race.id, candidate["candidate_id"])
        for race in races
        for candidate in race.payload["candidates"]
        if not candidate.get("is_write_in_aggregate")
        and (race_id is None or race.id == race_id)
        and (candidate_id is None or candidate["candidate_id"] == candidate_id)
        and (party is None or _party(candidate.get("party")) == party)
        and candidate_query.casefold() in candidate["name"].casefold()
    }
    if race_id is not None and not any(r.id == race_id for r in races):
        _bad("Unknown race")
    if candidate_id is not None and not any(
        r.id == race_id
        and any(
            c["candidate_id"] == candidate_id and not c.get("is_write_in_aggregate")
            for c in r.payload["candidates"]
        )
        for r in races
    ):
        _bad("Unknown candidate in this race")
    selected_regs = {
        account["registration_number"]
        for key, links in accounts.items()
        if key in scope_keys
        for account in links["accounts"]
    }
    accounts = {
        key: {
            "accounts": [
                a
                for a in links["accounts"]
                if a["registration_number"] in selected_regs
            ],
            "gaps": links["gaps"],
        }
        for key, links in accounts.items()
        if key in scope_keys
        or any(a["registration_number"] in selected_regs for a in links["accounts"])
        or any(g.get("registration_number") in selected_regs for g in links["gaps"])
    }
    # Historical evidence for this exact candidate scope participates too; unrelated
    # accounts do not cause remote object reads for a filtered report.

    decisions = list(
        db.scalars(
            select(m.ElectionCampaignAccountDecision).where(
                m.ElectionCampaignAccountDecision.election_key == election_key,
                m.ElectionCampaignAccountDecision.authority == "mn_cfb",
            )
        )
    )
    decisions = [
        d
        for d in decisions
        if (d.race_id, d.candidate_id) in scope_keys
        or d.registration_number in selected_regs
    ]
    decision_ids = {d.id for d in decisions}
    stamp = [entry for entry in stamp if entry[0] in decision_ids]
    decisions_by_id = {d.id: d for d in decisions}
    document_hashes, source_hashes = set(), set()
    for decision in decisions:
        for item in decision.evidence:
            (
                document_hashes
                if item.get("kind") in {"report_cover", "report_excerpt"}
                else source_hashes
            ).add(item["sha256"])
    by_account = defaultdict(list)
    for report in reports:
        by_account[report.registration_number].append(report)
    options = _effective_options(reports, collection.copied_at)
    option_by_key = {r.report_key: r for r in options}
    explicit = {}
    for key in report_keys:
        report = option_by_key.get(key)
        if report is None or report.registration_number not in selected_regs:
            if pinned:
                finance._changed()
            _bad(
                "Selected report is not an effective regular 2026 report for this confirmed account scope"
            )
        if (
            report.registration_number in explicit
            and explicit[report.registration_number].report_key != key
        ):
            if pinned:
                finance._changed()
            _bad("Select at most one report per account")
        explicit[report.registration_number] = report
    selected = {}
    for links in accounts.values():
        for account in links["accounts"]:
            reg = account["registration_number"]
            if reg not in selected:
                selected[reg] = (
                    (
                        explicit[reg],
                        "reported"
                        if explicit[reg].payload.get("figures")
                        else "unavailable",
                    )
                    if reg in explicit
                    else _latest(
                        [
                            r
                            for r in by_account[reg]
                            if r.payload["filing"].get("filing_year") == 2026
                        ],
                        collection.copied_at,
                    )
                )
    if collection.sealed_at is not None:
        keys = {
            report.report_key
            for report, state in selected.values()
            if report is not None
        }
        payloads = {
            row.report_key: row
            for row in finance.expense_report_rows(db, collection, report_keys=keys)
        }
        selected = {
            reg: (payloads[report.report_key], state)
            if report is not None
            else (None, state)
            for reg, (report, state) in selected.items()
        }
    for report, state in selected.values():
        if report is not None:
            if report.document_hash:
                document_hashes.add(report.document_hash)
            for key in ("catalogue_source", "financial_source"):
                source = report.payload.get(key)
                if source:
                    source_hashes.add(source["sha256"])
    related_memberships = defaultdict(set)
    for d in decisions:
        related_memberships[(d.race_id, d.candidate_id)].add(d.registration_number)
    party_dependencies = []
    for race in races:
        for candidate in race.payload["candidates"]:
            for reg in related_memberships[(race.id, candidate["candidate_id"])]:
                party_dependencies.extend(
                    {
                        **source,
                        "dependency": "classification_party_evidence",
                        "race_id": race.id,
                        "registration_number": reg,
                    }
                    for source in _party_sources(race, candidate)
                )
    source_hashes.update(item["source_sha256"] for item in party_dependencies)
    if trace is not None:
        trace["dependencies"] = _source_dependencies(
            decisions, selected, party_dependencies
        )
    document_roles = defaultdict(list)
    # A review can cite a prior report while this read selects a later one.
    # Use each immutable decision's account identity, not the current document
    # metadata, to validate both current and historical evidence roles.
    document_account_roles = defaultdict(set)
    for decision in decisions:
        for item in decision.evidence:
            if item.get("kind") in {"report_cover", "report_excerpt"}:
                document_account_roles[item["sha256"]].add(decision.registration_number)
    for report, state in selected.values():
        if report is not None and report.document_hash:
            filing = report.payload["filing"]
            document_roles[report.document_hash].append(
                (
                    report.registration_number,
                    filing["filing_year"],
                    filing["report_type"],
                    filing["effective_amendment_index"],
                    filing["special_election"],
                )
            )
    availability = _source_states(
        db,
        document_hashes,
        source_hashes,
        trace=trace,
        document_roles=document_roles,
        document_account_roles=document_account_roles,
        store=store,
    )
    # Remove links whose source bytes are gone, rather than relying on DB rows.
    for links in accounts.values():
        valid = []
        for account in links["accounts"]:
            decision = decisions_by_id[account["decision_id"]]
            register = [
                item
                for item in decision.evidence
                if item.get("kind") == "committee_register"
                and (item.get("literal_fields") or {}).get("RegisteredEntityID")
                == account["registration_number"]
            ]
            names = {
                item["literal_fields"].get("RegisteredEntityFullName")
                for item in register
                if item["literal_fields"].get("RegisteredEntityFullName")
            }
            parties = {
                item["literal_fields"].get("Party")
                for item in register
                if item["literal_fields"].get("Party")
            }
            account["committee_name"] = next(iter(names)) if len(names) == 1 else None
            account["account_filed_party"] = (
                next(iter(parties)) if len(parties) == 1 else None
            )
            account["account_party_evidence_state"] = (
                "conflicting_register_values"
                if len(parties) > 1
                else "available"
                if parties
                else "not_in_source"
            )
            account["register_party_source"] = [
                {
                    k: item[k]
                    for k in (
                        "kind",
                        "sha256",
                        "url",
                        "source_row",
                        "row_number",
                        "locator",
                    )
                    if k in item
                }
                | {"filed_party": item["literal_fields"].get("Party")}
                for item in register
            ]
            if all(
                availability.get(item["sha256"], False) for item in account["evidence"]
            ):
                valid.append(account)
            else:
                links["gaps"].append(
                    {
                        "registration_number": account["registration_number"],
                        "state": "sources_unavailable",
                    }
                )
        links["accounts"] = valid
    membership_revision = [
        [
            key,
            [a["registration_number"] for a in links["accounts"]],
            [
                {
                    "registration_number": g.get("registration_number"),
                    "state": g["state"],
                }
                for g in links["gaps"]
            ],
        ]
        for key, links in sorted(accounts.items())
    ]
    if trace is not None:
        trace["source_availability"] = availability
    version = digest(
        [
            "expense-report-v1",
            membership_revision,
            [race_id, candidate_id, party, candidate_query, sorted(set(report_keys))],
            election.id,
            collection.id,
            stamp,
            sorted(availability.items()),
        ]
    )[:16]
    return (
        {
            "schema_version": 1,
            "election_key": election_key,
            "election_date": election.election_date.isoformat(),
            "snapshot_id": election.id,
            "collection_id": collection.id,
            "version": version,
            "copied_at": collection.copied_at.isoformat(),
            "currency": "USD",
            "reporting_scope": "selected_effective_reports_with_latest_for_unspecified_accounts"
            if report_keys
            else "latest_effective_report_per_confirmed_account_with_actual_periods",
            "party_basis": "official_election_record_with_account_filed_party_separately_sourced",
            "common_reporting_period": False,
            "_scope_keys": scope_keys,
            "_classification_regs": selected_regs,
            "_read_stamp": [
                election.id,
                collection.id,
                sorted(d.id for d in decisions),
            ],
            "_candidate_authorities": {
                c["stable_id"]: c.get("authority", "unknown")
                for c in collection.coverage.get("candidates", [])
                if c.get("stable_id")
            },
            "complete_election_spending": False,
            "_report_options": [
                r for r in options if r.registration_number in selected_regs
            ],
        },
        races,
        accounts,
        selected,
        availability,
    )


def source_trace(
    db,
    *,
    election_key,
    snapshot_id=None,
    race_id=None,
    candidate_id=None,
    party=None,
    candidate_query="",
    report_keys=(),
):
    """Internal read-only performance trace; parent owns real-store measurement.

    It runs the same current source proof as report reads, using the process-wide
    bounded worker pool. No parser, source-availability cache or private review fields.
    """
    trace = {
        "schema_version": 1,
        "max_workers": SOURCE_WORKERS,
        "availability_cache": "none",
        "original_gets": [],
    }
    started = time.perf_counter()
    _validate_query(
        race_id=race_id,
        candidate_id=candidate_id,
        party=party,
        candidate_query=candidate_query,
        report_keys=report_keys,
        geography=None,
        payee_query="",
        excluded_payee_ids=(),
        limit=50,
        offset=0,
    )
    context, *_ = _load(
        db,
        election_key,
        snapshot_id,
        race_id=race_id,
        candidate_id=candidate_id,
        party=party,
        candidate_query=candidate_query,
        report_keys=report_keys,
        trace=trace,
    )
    trace["context"] = {
        k: context[k]
        for k in ("election_key", "snapshot_id", "collection_id", "version")
    }
    trace["filters"] = {
        "race_id": race_id,
        "candidate_id": candidate_id,
        "party": party,
        "candidate_query": candidate_query,
        "report_keys": sorted(set(report_keys)),
    }
    trace["seconds"] = time.perf_counter() - started
    return trace


def _validate_query(
    *,
    race_id,
    candidate_id,
    party,
    geography,
    payee_query,
    excluded_payee_ids,
    limit,
    offset,
    candidate_query="",
    report_keys=(),
):
    for value in (race_id, candidate_id):
        if value is not None and (
            not isinstance(value, str) or not value or len(value) > 256
        ):
            _bad("Invalid candidacy scope identifier")
    if candidate_id and not race_id:
        _bad("A candidate filter needs its exact race")
    if party is not None and party not in PARTIES:
        _bad("Unknown party group")
    if geography is not None and geography not in GEOGRAPHIES:
        _bad("Unknown filed-address group")
    if (
        not isinstance(payee_query, str)
        or len(payee_query) > 200
        or "\x00" in payee_query
    ):
        _bad("Payee search must be at most 200 characters")
    if (
        not isinstance(candidate_query, str)
        or len(candidate_query) > 200
        or "\x00" in candidate_query
    ):
        _bad("Candidate search must be at most 200 characters without NUL")
    if (
        not isinstance(report_keys, (tuple, list))
        or len(report_keys) > 500
        or any(
            not isinstance(key, str) or re.fullmatch(r"[a-f0-9]{64}", key) is None
            for key in report_keys
        )
    ):
        _bad("Report selection needs at most 500 exact report keys")
    if (
        isinstance(limit, bool)
        or not isinstance(limit, int)
        or not 1 <= limit <= 500
        or isinstance(offset, bool)
        or not isinstance(offset, int)
        or offset < 0
    ):
        _bad("Invalid page bounds")
    if (
        not isinstance(excluded_payee_ids, (tuple, list))
        or len(excluded_payee_ids) > 200
        or any(
            not isinstance(v, str) or not re.fullmatch(r"[a-f0-9]{64}", v)
            for v in excluded_payee_ids
        )
    ):
        _bad("Exclusions need exact source payee identifiers")


def _assemble(
    context,
    races,
    accounts,
    selected,
    availability,
    *,
    race_id=None,
    candidate_id=None,
    party=None,
    candidate_query="",
    report_keys=(),
    geography=None,
    payee_query="",
    excluded_payee_ids=(),
    _csv=False,
):
    full_claims, classification_gaps = defaultdict(list), defaultdict(list)
    csv_account_details = defaultdict(list) if _csv else None
    for race in races:
        for candidate in race.payload["candidates"]:
            if candidate.get("is_write_in_aggregate"):
                continue
            links = accounts.get(
                (race.id, candidate["candidate_id"]), {"accounts": [], "gaps": []}
            )
            for gap in links["gaps"]:
                if gap["state"] in {"sources_unavailable", "identity_changed"}:
                    classification_gaps[gap.get("registration_number")].append(
                        gap["state"]
                    )
            for account in links["accounts"]:
                reg = account["registration_number"]
                if not all(
                    availability.get(item["sha256"], False)
                    for item in account["evidence"]
                ):
                    classification_gaps[reg].append("sources_unavailable")
                    continue
                if any(
                    not availability.get(source["source_sha256"], False)
                    for source in _party_sources(race, candidate)
                ):
                    classification_gaps[reg].append("party_sources_unavailable")
                if csv_account_details is not None:
                    csv_account_details[reg].append(account)
                full_claims[reg].append(
                    {
                        "race_id": race.id,
                        "candidate_id": candidate["candidate_id"],
                        "name": candidate["name"],
                        "filed_party": candidate.get("party"),
                        "party_group": _party(candidate.get("party")),
                        "candidate_source_sha256": race.payload.get(
                            "candidate_source_sha256"
                        ),
                        "party_sources": _public_party_sources(
                            race, candidate, availability
                        ),
                        "account_evidence": [
                            {
                                k: v
                                for k, v in item.items()
                                if k
                                in {
                                    "kind",
                                    "sha256",
                                    "url",
                                    "page",
                                    "lines",
                                    "source_row",
                                    "row_number",
                                    "locator",
                                    "collection_id",
                                    "retained_source_url",
                                }
                            }
                            for item in account["evidence"]
                        ],
                    }
                )
    all_candidates, candidates, account_claims = [], [], defaultdict(list)
    for race in races:
        for candidate in race.payload["candidates"]:
            if candidate.get("is_write_in_aggregate"):
                continue
            row = {
                "race_id": race.id,
                "candidate_id": candidate["candidate_id"],
                "stable_id": candidate.get("candidate_stable_id"),
                "name": candidate["name"],
                "filed_party": candidate.get("party"),
                "party_group": _party(candidate.get("party")),
                "office": race.payload["office_name"],
                "district": race.payload.get("district"),
                "jurisdiction": race.jurisdiction,
                "candidate_source_sha256": race.payload.get("candidate_source_sha256"),
                "party_sources": _public_party_sources(race, candidate, availability),
                "filing_authority": context.get("_candidate_authorities", {}).get(
                    candidate.get("candidate_stable_id"), "unknown"
                ),
                "accounts": [],
                "gaps": [],
            }
            all_candidates.append(row)
            if (
                (race_id and race.id != race_id)
                or (candidate_id and candidate["candidate_id"] != candidate_id)
                or (party and row["party_group"] != party)
                or candidate_query.casefold() not in row["name"].casefold()
            ):
                continue
            links = accounts.get(
                (race.id, candidate["candidate_id"]), {"accounts": [], "gaps": []}
            )
            row["confirmed_account_count"] = len(links["accounts"])
            row["gaps"] = [
                {
                    "state": g["state"],
                    "registration_number": g.get("registration_number"),
                }
                for g in links["gaps"]
            ]
            if not links["accounts"]:
                row["gaps"].append({"state": "no_confirmed_account"})
            for account in links["accounts"]:
                reg = account["registration_number"]
                report, state = selected.get(reg, (None, "no_held_report"))
                if report is None:
                    row["gaps"].append({"state": state, "registration_number": reg})
                    continue
                start, end = (
                    report.payload.get("period_start"),
                    report.payload.get("period_end"),
                )
                if (
                    not start
                    or not end
                    or not account["period_start"]
                    <= start
                    <= end
                    <= account["period_end"]
                ):
                    row["gaps"].append(
                        {
                            "state": "report_period_not_covered",
                            "registration_number": reg,
                        }
                    )
                    continue
                row["accounts"].append(
                    {
                        "registration_number": reg,
                        "committee_name": account.get("committee_name"),
                        "account_filed_party": account.get("account_filed_party"),
                        "account_party_evidence_state": account.get(
                            "account_party_evidence_state", "not_in_source"
                        ),
                        "party_values_differ": bool(
                            account.get("account_filed_party") is not None
                            and account["account_filed_party"] != candidate.get("party")
                        ),
                        "register_party_source": account.get(
                            "register_party_source", []
                        ),
                        "report_key": report.report_key,
                        "checked_on": account["checked_on"],
                        "evidence": [
                            {
                                k: v
                                for k, v in item.items()
                                if k
                                in {
                                    "kind",
                                    "sha256",
                                    "url",
                                    "page",
                                    "lines",
                                    "collection_id",
                                    "source_row",
                                    "row_number",
                                    "locator",
                                    "retained_source_url",
                                }
                            }
                            for item in account["evidence"]
                        ],
                    }
                )
                account_claims[reg].append(
                    {
                        k: row[k]
                        for k in (
                            "race_id",
                            "candidate_id",
                            "name",
                            "filed_party",
                            "party_group",
                        )
                    }
                )
            candidates.append(row)
    candidates.sort(
        key=lambda c: (c["name"].casefold(), c["name"], c["race_id"], c["candidate_id"])
    )
    if race_id and not any(r.id == race_id for r in races):
        _bad("Unknown race")
    if candidate_id and not any(
        c["race_id"] == race_id and c["candidate_id"] == candidate_id
        for c in all_candidates
    ):
        _bad("Unknown candidate in this race")
    account_reports, payments = [], []
    for reg, claims in sorted(account_claims.items()):
        report, _ = selected[reg]
        p = report.payload
        required = [report.document_hash] + [
            p[key]["sha256"]
            for key in ("catalogue_source", "financial_source")
            if p.get(key)
        ]
        original_ok = all(availability.get(h, False) for h in required)
        figures = (
            p.get("figures")
            if original_ok and p.get("figure_status") == "source_verified"
            else None
        )
        display_claims = claims
        claims = full_claims[reg]
        parties = {c["party_group"] for c in claims}
        classification = (
            "membership_sources_unavailable"
            if classification_gaps[reg]
            else "mixed_ballot_parties"
            if len(parties) > 1
            else "ballot_party_not_in_source"
            if not parties or parties == {"unknown"}
            else "single_ballot_party"
        )
        group = (
            next(iter(parties))
            if classification == "single_ballot_party"
            else "unknown"
        )
        base = (
            f"/api/v1/finance/elections/{quote(context['election_key'], safe='')}/finance/sources/{report.document_hash}?"
            + urlencode({"collection_id": context["collection_id"]})
        )
        expense = p.get("campaign_expenses")
        detail_ok = bool(figures and expense and expense.get("status") == "checked")
        entry = {
            "registration_number": reg,
            "report_key": report.report_key,
            "claims": claims,
            "display_claims": display_claims,
            "party_classification_state": classification,
            "party_group": group,
            "filing": {
                k: p["filing"].get(k)
                for k in (
                    "filing_year",
                    "report_type",
                    "report_name",
                    "cut_off_date",
                    "special_election",
                    "effective_amendment_index",
                    "amendment_count",
                )
            },
            "period_start": p.get("period_start"),
            "period_end": p.get("period_end"),
            "period_basis": p.get("period_basis"),
            # The Board's page-1 receipt stamp is separate from cutoff/copy dates
            # and needs this PDF, not unrelated summary/overview evidence.
            "received_date": p.get("cover", {}).get("received_date")
            if availability.get(report.document_hash, False)
            else None,
            "source": {
                "sha256": report.document_hash,
                "document": _source(p.get("document")),
                "retained_source_url": base,
            },
            "figure_status": "checked" if figures else "unavailable",
            "campaign_expenses": dict(
                zip(
                    COLUMNS,
                    [
                        figures["campaign_expenditures"]["cash"],
                        figures["campaign_expenditures"]["unpaid"],
                        figures["campaign_expenditures"]["in_kind"],
                        figures["campaign_expenditures"]["total"],
                    ],
                )
            )
            if figures
            else None,
            "expense_source": {"page": 2, "summary_lines": [11]},
            "public_subsidy": {
                k: v
                for k, v in figures["public_subsidy_payments"].items()
                if k in {"cash", "total", "source_page", "source_lines"}
            }
            if figures and figures.get("public_subsidy_payments")
            else None,
            "public_subsidy_gap": None
            if figures and figures.get("public_subsidy_payments")
            else "public_subsidy_unavailable",
            "detail_status": "checked" if detail_ok else "unavailable",
            "detail_gap": None
            if detail_ok
            else "retained_source_unavailable"
            if not original_ok
            else "parent_figures_unavailable"
            if not figures
            else "expense_detail_not_collected"
            if not expense
            else "expense_detail_unreconciled",
            "itemized_totals": expense.get("itemized_totals") if detail_ok else None,
            "non_itemized_totals": expense.get("non_itemized_totals")
            if detail_ok
            else None,
            "detail_gaps": [
                _public_gap(g) for g in expense.get("gaps", []) if isinstance(g, str)
            ]
            if expense and original_ok
            else [],
        }
        account_reports.append(entry)
        if not detail_ok:
            continue
        for row in expense["rows"]:
            payee = _identity(row.get("payee"))
            pid = _payee_id(payee)
            payments.append(
                {
                    "record_id": row["source_row_id"],
                    "registration_number": reg,
                    "report_key": report.report_key,
                    "claims": claims,
                    "party_group": group,
                    "period_start": entry["period_start"],
                    "period_end": entry["period_end"],
                    "payee_id": pid,
                    "payee": payee,
                    "underlying_vendor": _identity(row.get("underlying_vendor")),
                    "relationship": row["relationship"],
                    "geography": _geography(payee),
                    "date": row["date"],
                    "raw_date": row.get("raw_date"),
                    "purpose": row["purpose"],
                    "amounts": {k: row["amounts"][k] for k in COLUMNS},
                    "raw_amounts": {
                        k: row.get("raw_amounts", {}).get(k) for k in COLUMNS
                    },
                    "source": [_location(loc) for loc in row["source"]],
                    "payee_header_source": _location(row.get("payee_header_source")),
                    "uncertainties": [
                        _public_gap(g) for g in row.get("uncertainties", [])
                    ],
                }
            )
    available_ids = {p["payee_id"] for p in payments if p["payee_id"]}
    if set(excluded_payee_ids) - available_ids:
        _bad("An excluded payee is not in this source-backed report scope")
    baseline = payments
    exclusions = set(excluded_payee_ids)
    adjusted = [p for p in payments if p["payee_id"] not in exclusions]
    # Per-report itemized views use the complete checked rows already in memory,
    # never a paginated or name/geography-filtered payee result. Source report,
    # subsidy and non-itemized amounts remain separate and unchanged.
    baseline_by_report, adjusted_by_report = defaultdict(list), defaultdict(list)
    for payment in baseline:
        baseline_by_report[payment["report_key"]].append(payment["amounts"])
    for payment in adjusted:
        adjusted_by_report[payment["report_key"]].append(payment["amounts"])
    for account in account_reports:
        checked = account["detail_status"] == "checked"
        account["checked_detail_before_exclusions"] = (
            _money(baseline_by_report[account["report_key"]]) if checked else None
        )
        account["checked_detail_after_exclusions"] = (
            _money(adjusted_by_report[account["report_key"]]) if checked else None
        )
    # Selected exclusions remain visible even when every row is off the current
    # payee page or hidden by a detail filter. These are exact source identities;
    # account portions count a shared report once, with its full governing claims.
    excluded_rows = defaultdict(list)
    for payment in baseline:
        if payment["payee_id"] in exclusions:
            excluded_rows[payment["payee_id"]].append(payment)
    excluded_payees: list[dict[str, Any]] = []
    for pid, rows in excluded_rows.items():
        portions = defaultdict(list)
        for payment in rows:
            portions[(payment["registration_number"], payment["report_key"])].append(
                payment
            )
        excluded_payees.append(
            {
                "payee_id": pid,
                "payee": rows[0]["payee"],
                "geography": rows[0]["geography"],
                "payment_count": len(rows),
                "amounts": _money([p["amounts"] for p in rows]),
                "account_reports": [
                    {
                        k: records[0][k]
                        for k in (
                            "registration_number",
                            "report_key",
                            "claims",
                            "party_group",
                            "period_start",
                            "period_end",
                        )
                    }
                    | {
                        "payment_count": len(records),
                        "amounts": _money([p["amounts"] for p in records]),
                    }
                    for _, records in sorted(portions.items())
                ],
            }
        )
    excluded_payees.sort(key=lambda p: (p["payee"]["name"].casefold(), p["payee_id"]))
    visible = [
        p
        for p in adjusted
        if (not geography or p["geography"] == geography)
        and (
            not payee_query
            or payee_query.casefold()
            in ((p["payee"] or {}).get("name") or "").casefold()
        )
    ]
    groups: dict[str, dict[str, Any]] = {}
    for p in visible:
        key = p["payee_id"] or "unknown:" + p["report_key"]
        if key not in groups:
            groups[key] = {
                "payee_id": p["payee_id"],
                "payee": p["payee"],
                "geography": p["geography"],
                "excludable": p["payee_id"] is not None,
                "report_keys": set(),
                "purposes": set(),
                "records": [],
                "source": [],
            }
        g = groups[key]
        g["records"].append(p)
        g["report_keys"].add(p["report_key"])
        g["purposes"].add(p["purpose"])
        g["source"].extend(p["source"])
    payees: list[dict[str, Any]] = []
    for g in groups.values():
        payees.append(
            {
                k: v
                for k, v in g.items()
                if k not in {"records", "report_keys", "purposes"}
            }
            | {
                "report_keys": sorted(g["report_keys"]),
                "purposes": sorted(g["purposes"]),
                "payment_count": len(g["records"]),
                "amounts": _money([p["amounts"] for p in g["records"]]),
            }
        )
    payees.sort(
        key=lambda p: (
            ((p["payee"] or {}).get("name") or "").casefold(),
            p["payee_id"] or "",
            p["report_keys"],
        )
    )

    checked_detail = [a for a in account_reports if a["detail_status"] == "checked"]

    def detail_totals(rows):
        return {
            "available_account_reports": len(checked_detail),
            "amounts": _money([p["amounts"] for p in rows]) if checked_detail else None,
            "payment_count": len(rows),
            "by_party": {
                key: {
                    "available_account_reports": sum(
                        a["party_group"] == key for a in checked_detail
                    ),
                    "amounts": _money(
                        [p["amounts"] for p in rows if p["party_group"] == key]
                    )
                    if any(a["party_group"] == key for a in checked_detail)
                    else None,
                }
                for key in PARTIES
            },
            "by_filed_address": {
                key: _money([p["amounts"] for p in rows if p["geography"] == key])
                if checked_detail
                else None
                for key in GEOGRAPHIES
            },
        }

    checked = [a for a in account_reports if a["campaign_expenses"] is not None]
    subsidy = [a for a in account_reports if a["public_subsidy"] is not None]
    summary = {
        "unit": "unique_confirmed_account_report",
        "candidacy_counts_by_ballot_party": {
            key: sum(c["party_group"] == key for c in candidates) for key in PARTIES
        },
        "party_classification": {
            state: {
                "accounts": sum(
                    a["party_classification_state"] == state for a in checked
                ),
                "amounts": _money(
                    [
                        a["campaign_expenses"]
                        for a in checked
                        if a["party_classification_state"] == state
                    ]
                )
                if any(a["party_classification_state"] == state for a in checked)
                else None,
            }
            for state in (
                "single_ballot_party",
                "mixed_ballot_parties",
                "ballot_party_not_in_source",
                "membership_sources_unavailable",
            )
        },
        "source_report_totals": {
            "available_accounts": len(checked),
            "amounts": _money([a["campaign_expenses"] for a in checked])
            if checked
            else None,
            "by_party": {
                key: {
                    "available_accounts": sum(a["party_group"] == key for a in checked),
                    "amounts": _money(
                        [
                            a["campaign_expenses"]
                            for a in checked
                            if a["party_group"] == key
                        ]
                    )
                    if any(a["party_group"] == key for a in checked)
                    else None,
                }
                for key in PARTIES
            },
        },
        "public_subsidy_receipts": {
            "available_accounts": len(subsidy),
            "amount": format(
                sum(
                    (Decimal(a["public_subsidy"]["total"]) for a in subsidy), Decimal(0)
                ),
                ".2f",
            )
            if subsidy
            else None,
            "by_party": {
                key: {
                    "available_accounts": sum(a["party_group"] == key for a in subsidy),
                    "amount": format(
                        sum(
                            (
                                Decimal(a["public_subsidy"]["total"])
                                for a in subsidy
                                if a["party_group"] == key
                            ),
                            Decimal(0),
                        ),
                        ".2f",
                    )
                    if any(a["party_group"] == key for a in subsidy)
                    else None,
                }
                for key in PARTIES
            },
        },
        "baseline_checked_itemized_detail": detail_totals(baseline),
        "adjusted_checked_itemized_detail": detail_totals(adjusted),
        "visible_checked_itemized_detail": detail_totals(visible),
        "non_itemized_on_checked_detail_reports": _money(
            [a["non_itemized_totals"] for a in checked_detail]
        )
        if checked_detail
        else None,
        "withheld_detail_accounts": sum(
            a["detail_status"] != "checked" for a in account_reports
        ),
        "source_figures_and_detail_are_distinct": True,
        "geography_basis": "filed_payee_address_only_not_economic_location",
        "subsidy_tracing": False,
        "periods": [
            {
                "registration_number": a["registration_number"],
                "report_key": a["report_key"],
                "start": a["period_start"],
                "end": a["period_end"],
            }
            for a in account_reports
        ],
    }
    filters = {
        "race_id": race_id,
        "candidate_id": candidate_id,
        "party": party,
        "candidate_query": candidate_query,
        "report_keys": sorted(set(report_keys)),
        "geography": geography,
        "payee_query": payee_query,
        "excluded_payee_ids": sorted(set(excluded_payee_ids)),
    }
    return {
        **(
            {
                "_csv_baseline_payments": baseline,
                "_csv_account_details": csv_account_details,
            }
            if _csv
            else {}
        ),
        **{k: v for k, v in context.items() if not k.startswith("_")},
        "filters": filters,
        "report_options": _report_options(
            context, context.get("_report_options", []), selected, availability
        ),
        "coverage": {
            "named_candidacies": len(all_candidates),
            "scoped_candidacies": len(candidates),
            "scoped_candidacies_with_confirmed_accounts": sum(
                bool(c["confirmed_account_count"]) for c in candidates
            ),
            "selected_account_reports": len(account_reports),
            "checked_detail_account_reports": sum(
                a["detail_status"] == "checked" for a in account_reports
            ),
        },
        "summary": summary,
        "candidates": candidates,
        "account_reports": account_reports,
        "excluded_payees": excluded_payees,
        "payees": payees,
        "payments": visible,
    }


def _external_identity(payment):
    address = payment.get("payee_address")
    name = payment.get("payee")
    if not name:
        return None, None
    # Neither punctuation nor case is normalized. Unknown addresses cannot join
    # unrelated rows just because the filed names happen to match.
    pid = digest(
        [
            "external-payee-v1",
            payment["authority"],
            name,
            address,
            payment["payment_key"]
            if not address or not any(address.values())
            else None,
        ]
    )
    fields = address or {}
    us = fields.get("state") in set(
        "AL AK AZ AR CA CO CT DE DC FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY AS GU MP PR VI".split()
    )
    return pid, {
        "name": name,
        "address": {
            "lines": [
                fields[k]
                for k in ("street_1", "street_2", "city", "state", "postal_code")
                if fields.get(k)
            ],
            "street": " ".join(
                fields[k] for k in ("street_1", "street_2") if fields.get(k)
            )
            or None,
            "city": fields.get("city"),
            "state": fields.get("state"),
            "postal_code": fields.get("postal_code"),
            "geography_status": "filed_us" if us else "unknown",
        },
        "address_status": "source_checked" if address is not None else "not_checked",
    }


def _external_payee_ids(bulk):
    return {
        _external_identity(p)[0]
        for c in (bulk or {}).get("candidates", [])
        for p in c.get("own_payments", [])
    }


def _payment_measure(payment):
    transaction = payment["transaction_type"]
    if payment["authority"] == "fec" and re.fullmatch(
        r"F3X?:SB[A-Za-z0-9]+", transaction
    ):
        return (
            "fec_schedule_b_disbursements",
            "FEC Schedule B disbursements",
            "itemized_schedule_b",
        )
    if payment["authority"] == "fec" and transaction.endswith(":SE"):
        return (
            "fec_schedule_e_disbursements",
            "FEC Schedule E disbursements",
            "itemized_schedule_e",
        )
    return "source_reported_payment", "Source-reported payment", transaction


def _exact_amount_sum(values):
    numbers = [Decimal(value) for value in values]
    scale = max([2, *[-int(n.as_tuple().exponent) for n in numbers]])
    with localcontext() as ctx:
        ctx.prec = (
            max(
                [
                    28,
                    *[
                        len(n.as_tuple().digits) + abs(int(n.as_tuple().exponent))
                        for n in numbers
                    ],
                ]
            )
            + len(str(len(numbers)))
            + scale
        )
        return format(sum(numbers, Decimal(0)), f".{scale}f")


def _reported_amounts(rows):
    grouped = defaultdict(list)
    for row in rows:
        if not row["nonadditive"]:
            grouped[
                (
                    row["authority"],
                    row["report_key"],
                    row["measure"],
                    row["basis"],
                    row["currency"],
                )
            ].append(row)
    return [
        {
            "authority": key[0],
            "report_key": key[1],
            "measure": key[2],
            "basis": key[3],
            "label": values[0]["measure_label"],
            "period_start": values[0]["period_start"],
            "period_end": values[0]["period_end"],
            "currency": key[4],
            "amount": _exact_amount_sum([p["reported_amount"] for p in values]),
        }
        for key, values in sorted(
            grouped.items(), key=lambda pair: tuple(str(v) for v in pair[0])
        )
    ]


def _adjusted_measures(baseline, rows):
    amounts = {
        (r["authority"], r["report_key"], r["measure"], r["basis"], r["currency"]): r[
            "amount"
        ]
        for r in _reported_amounts(rows)
    }
    return [
        r
        | {
            "amount": amounts.get(
                (
                    r["authority"],
                    r["report_key"],
                    r["measure"],
                    r["basis"],
                    r["currency"],
                ),
                "0.00",
            )
        }
        for r in baseline
    ]


def _join_external(
    db, data, bulk, races, *, report_keys, excluded_payee_ids, _csv=False, store=None
):
    data["summary"]["authority"] = "mn_cfb"
    data["summary"]["authority_name"] = (
        "Minnesota Campaign Finance and Public Disclosure Board"
    )
    data["authority_reports"] = []
    data["authority_summary"] = []
    data["external_generation_id"] = (bulk or {}).get("generation_id")
    data["external_version"] = (bulk or {}).get("version")
    data["external_status"] = "published" if bulk else "not_published"
    data["filters"].update(
        report_keys=sorted(set(report_keys)),
        excluded_payee_ids=sorted(set(excluded_payee_ids)),
    )
    if not bulk:
        return data
    if bulk["snapshot_id"] != data["snapshot_id"]:
        finance._changed()
    candidates = {
        (r.id, c["candidate_id"]): (r, c)
        for r in races
        for c in r.payload["candidates"]
        if not c.get("is_write_in_aggregate")
    }
    displayed = {(c["race_id"], c["candidate_id"]): c for c in data["candidates"]}
    entries = {(c["race_id"], c["candidate_id"]): c for c in bulk["candidates"]}
    authority_names = {a["key"]: a["name"] for a in bulk["authorities"]}
    memberships = defaultdict(list)
    membership_gaps = defaultdict(list)
    report_memberships = defaultdict(list)
    reports = {}
    own = {}
    party_hashes = {
        s["source_sha256"]
        for key, entry in entries.items()
        if key in candidates
        for s in _party_sources(*candidates[key])
        if entry["accounts"]
    }
    # Reuse this same request's successful fresh-byte checks, never a prior
    # request or metadata-only cache. Local party result rows not in the external
    # dependency closure still need their own exact original read.
    fresh_hashes = {source["sha256"] for source in bulk.get("sources", [])}
    party_availability = {h: True for h in party_hashes & fresh_hashes}
    party_availability.update(
        _source_states(db, set(), party_hashes - fresh_hashes, store=store)
    )
    for key, entry in entries.items():
        if key not in candidates:
            continue
        race, candidate = candidates[key]
        party_evidence = _party_sources(race, candidate)
        party_ok = bool(party_evidence) and all(
            party_availability.get(s["source_sha256"], False) for s in party_evidence
        )
        for gap in entry["account_gaps"]:
            if gap["state"] in {
                "sources_unavailable",
                "identity_changed",
                "identity_source_changed",
                "account_not_in_generation",
            }:
                membership_gaps[(gap["authority"], gap["account_id"])].append(
                    {"race_id": key[0], "candidate_id": key[1], "state": gap["state"]}
                )
        claim = {
            "race_id": key[0],
            "candidate_id": key[1],
            "name": candidate["name"],
            "filed_party": candidate.get("party"),
            "party_group": _party(candidate.get("party")) if party_ok else "unknown",
            "party_sources": _public_party_sources(race, candidate, party_availability),
            "party_sources_available": party_ok,
        }
        accounts = {(a["authority"], a["account_id"]): a for a in entry["accounts"]}
        for account_key, account in accounts.items():
            memberships[account_key].append(
                claim
                | {
                    "period_start": account["period_start"],
                    "period_end": account["period_end"],
                }
            )
        for report in entry["reports"]:
            account_key = (report["authority"], report["account_id"])
            if (
                report.get("effective") is None
                and report.get("amendment_status") == "not_established"
                and key in displayed
            ):
                displayed[key]["gaps"].append(
                    {
                        "state": "amendment_status_not_established",
                        "authority": report["authority"],
                        "account_id": report["account_id"],
                        "report_key": report["report_key"],
                    }
                )
            # Retain operational report gaps, but never choose them as financial rows.
            if report.get("effective") is not True or not report.get("period_end"):
                continue
            if report["authority"] == "fec" and not report.get(
                "report_type", ""
            ).startswith(("F3:", "F3X:")):
                continue
            rk = report["report_key"]
            previous = reports.get(rk)
            if previous is None or report["check_status"] == "checked":
                reports[rk] = report | {"account_name": accounts[account_key]["name"]}
            if report["check_status"] == "checked":
                report_memberships[rk].append(claim)
        for payment in entry.get("own_payments", []):
            own[payment["payment_key"]] = payment
        if key in displayed:
            row = displayed[key]
            row["external_coverage"] = entry["coverage"]
            row["external_account_gaps"] = entry["account_gaps"]
            row["external_accounts"] = [
                {k: v for k, v in a.items() if k != "decision_id"}
                | {"authority_name": authority_names.get(a["authority"])}
                for a in entry["accounts"]
            ]
            row["confirmed_account_count"] += len(entry["accounts"])
            if entry["accounts"]:
                row["gaps"] = [
                    g for g in row["gaps"] if g["state"] != "no_confirmed_account"
                ]
    # Every named candidacy retains coverage even before an account review exists.
    coverage = {c["stable_id"]: c for c in bulk["coverage"]}
    for row in data["candidates"]:
        row.setdefault("external_accounts", [])
        row.setdefault(
            "external_coverage",
            coverage.get(row.get("stable_id"), {"status": "unmatched"}),
        )
    scoped_accounts = {
        key
        for key, claims in memberships.items()
        if any((c["race_id"], c["candidate_id"]) in displayed for c in claims)
    }
    by_account = defaultdict(list)
    for report in reports.values():
        key = (report["authority"], report["account_id"])
        if key in scoped_accounts:
            by_account[key].append(report)
    for account_key in scoped_accounts - by_account.keys():
        for claim in memberships[account_key]:
            row = displayed.get((claim["race_id"], claim["candidate_id"]))
            if row is not None:
                row["gaps"].append(
                    {
                        "state": "no_effective_periodic_report",
                        "authority": account_key[0],
                        "account_id": account_key[1],
                    }
                )
    all_external_keys = {
        r["report_key"] for entry in entries.values() for r in entry["reports"]
    }
    explicit = {}
    for rk in report_keys:
        if rk in all_external_keys and rk not in reports:
            _bad("Selected external report is not an effective periodic report")
        if rk not in reports:
            continue  # Board selection was checked separately.
        report = reports[rk]
        key = (report["authority"], report["account_id"])
        if key not in scoped_accounts:
            _bad("Selected report is outside this candidate scope")
        if key in explicit:
            _bad("Select at most one report per authority account")
        explicit[key] = rk
    selected = {}
    for key, choices in sorted(by_account.items()):
        cutoff = max(r["period_end"] for r in choices)
        latest = [r for r in choices if r["period_end"] == cutoff]
        chosen = (
            reports[explicit[key]]
            if key in explicit
            else latest[0]
            if len(latest) == 1
            else None
        )
        option_rows = []
        for report in sorted(choices, key=lambda r: (r["period_end"], r["report_key"])):
            option_rows.append(
                {
                    "authority": key[0],
                    "account_id": key[1],
                    "report_key": report["report_key"],
                    "report_type": report["report_type"],
                    "period_start": report["period_start"],
                    "period_end": report["period_end"],
                    "received_date": report.get("received_date"),
                    "selected": chosen is not None
                    and report["report_key"] == chosen["report_key"],
                    "filing": {
                        "report_name": report["report_type"],
                        "report_type": report["report_type"],
                        "cut_off_date": report["period_end"],
                    },
                    "period_basis": "source_report_interval",
                    "check_status": report["check_status"],
                    "source_state": "unavailable"
                    if report["check_status"] == "sources_unavailable"
                    else "available",
                }
            )
        data["report_options"].append(
            {
                "authority": key[0],
                "authority_name": authority_names.get(key[0]),
                "account_id": key[1],
                "registration_number": key[1],
                "reports": option_rows,
            }
        )
        if chosen is None:
            for row in displayed.values():
                if any(
                    c["candidate_id"] == row["candidate_id"]
                    and c["race_id"] == row["race_id"]
                    for c in memberships[key]
                ):
                    row["gaps"].append(
                        {
                            "state": "ambiguous_latest_report",
                            "authority": key[0],
                            "account_id": key[1],
                        }
                    )
            continue
        rk = chosen["report_key"]
        claims = report_memberships[rk]
        display_claims = [
            c for c in claims if (c["race_id"], c["candidate_id"]) in displayed
        ]
        # Classify across all source-valid memberships that overlap these exact
        # dates, before display filters. A wholly historical relationship cannot
        # assign this report to that person's party; partial overlap still blocks
        # a conflicting whole-report party allocation.
        full = [
            c
            for c in memberships[key]
            if c["period_start"] <= chosen["period_end"]
            and chosen["period_start"] <= c["period_end"]
        ]
        parties = {c["party_group"] for c in full}
        classification = (
            "membership_sources_unavailable"
            if membership_gaps[key]
            or not all(c["party_sources_available"] for c in full)
            else "mixed_ballot_parties"
            if len(parties) > 1
            else "ballot_party_not_in_source"
            if not parties or parties == {"unknown"}
            else "single_ballot_party"
        )
        group = (
            next(iter(parties))
            if classification == "single_ballot_party"
            else "unknown"
        )
        checked = chosen["check_status"] == "checked" and bool(display_claims)
        entry = {
            k: chosen.get(k)
            for k in (
                "authority",
                "account_id",
                "report_key",
                "source_report_id",
                "report_type",
                "series_id",
                "period_start",
                "period_end",
                "received_date",
                "predecessor_report_key",
                "effective",
                "sources",
            )
        }
        entry.update(
            authority_name=authority_names.get(key[0]),
            account_name=chosen["account_name"],
            claims=full,
            display_claims=display_claims,
            party_group=group,
            party_classification_state=classification,
            membership_gaps=membership_gaps[key],
            check_status=chosen["check_status"]
            if checked
            else "period_not_covered"
            if chosen["check_status"] == "checked"
            else chosen["check_status"],
            reported_measures=chosen["figures"] if checked else None,
            source_field_gaps=deepcopy(chosen.get("source_field_gaps") or [])
            if checked
            else [],
            unavailable_measures=deepcopy(chosen.get("unavailable_measures") or []),
            withheld_measures=deepcopy(chosen.get("withheld_measures") or []),
            public_subsidy=None,
            public_subsidy_gap="no_checked_subsidy_measure",
            detail_status="partial_itemized" if checked else "unavailable",
            detail_gap="itemized_rows_do_not_establish_complete_schedule"
            if checked
            else "report_or_association_unavailable",
            non_itemized_amount=None,
            reconciliation_status="not_compared_across_different_measures",
        )
        data["authority_reports"].append(entry)
        if checked:
            selected[rk] = entry
    rows: list[dict[str, Any]] = []
    for payment in own.values():
        rk = payment["report_key"]
        if rk not in selected:
            continue
        report = selected[rk]
        pid, identity = _external_identity(payment)
        measure, label, basis = _payment_measure(payment)
        rows.append(
            {
                "record_id": payment["payment_key"],
                "source_row_id": payment["source_row_id"],
                "authority": payment["authority"],
                "authority_name": report["authority_name"],
                "account_id": payment["account_id"],
                "registration_number": payment["account_id"],
                "report_key": rk,
                "claims": report["claims"],
                "party_group": report["party_group"],
                "period_start": report["period_start"],
                "period_end": report["period_end"],
                "payee_id": pid,
                "payee": identity,
                "underlying_vendor": None,
                "relationship": "source_reported",
                "geography": _geography(identity),
                "date": payment["date"],
                "purpose": payment["purpose"],
                "amounts": None,
                "reported_amount": payment["amount"],
                "currency": payment["currency"],
                "measure": measure,
                "measure_label": label,
                "basis": basis,
                "amount_role": payment["amount_role"],
                "nonadditive": payment["nonadditive"],
                "transaction_type": payment["transaction_type"],
                "memo": payment["memo"],
                "source": payment["sources"],
                "uncertainties": ["address_not_checked"]
                if payment.get("payee_address") is None
                else [],
            }
        )
    exclusions = set(excluded_payee_ids)
    available = (
        {p["payee_id"] for p in rows}
        | {p["payee_id"] for p in data.get("_csv_baseline_payments", data["payments"])}
        | {p["payee_id"] for p in data["excluded_payees"]}
    )
    if exclusions - available:
        _bad("An excluded payee is not in this source-backed report scope")
    adjusted = [p for p in rows if p["payee_id"] not in exclusions]
    filters = data["filters"]
    visible = [
        p
        for p in adjusted
        if (not filters["geography"] or p["geography"] == filters["geography"])
        and filters["payee_query"].casefold()
        in ((p["payee"] or {}).get("name") or "").casefold()
    ]
    for report in data["authority_reports"]:
        selected_rows = [p for p in rows if p["report_key"] == report["report_key"]]
        report["reported_itemized_before_exclusions"] = (
            _reported_amounts(selected_rows) or None
        )
        before = _reported_amounts(selected_rows)
        after_rows = [p for p in selected_rows if p["payee_id"] not in exclusions]
        report["reported_itemized_after_exclusions"] = (
            _adjusted_measures(before, after_rows) if before else None
        )
        for measure in before:
            relevant = [
                p
                for p in selected_rows
                if p["measure"] == measure["measure"]
                and p["basis"] == measure["basis"]
                and p["currency"] == measure["currency"]
            ]
            adjusted_relevant = [p for p in relevant if p["payee_id"] not in exclusions]
            data["authority_summary"].append(
                {
                    **measure,
                    "authority_name": report["authority_name"],
                    "account_id": report["account_id"],
                    "baseline": measure["amount"],
                    "adjusted": _adjusted_measures([measure], adjusted_relevant)[0][
                        "amount"
                    ],
                    "by_party": {
                        party: {
                            "baseline": _adjusted_measures(
                                [measure],
                                [p for p in relevant if p["party_group"] == party],
                            )[0]["amount"],
                            "adjusted": _adjusted_measures(
                                [measure],
                                [
                                    p
                                    for p in adjusted_relevant
                                    if p["party_group"] == party
                                ],
                            )[0]["amount"],
                        }
                        for party in PARTIES
                    },
                    "by_filed_address": {
                        geo: {
                            "baseline": _adjusted_measures(
                                [measure],
                                [p for p in relevant if p["geography"] == geo],
                            )[0]["amount"],
                            "adjusted": _adjusted_measures(
                                [measure],
                                [p for p in adjusted_relevant if p["geography"] == geo],
                            )[0]["amount"],
                        }
                        for geo in GEOGRAPHIES
                    },
                    "aggregation_scope": "one_authority_account_report_measure_no_cross_report_total",
                }
            )
        report["memo_detail_count"] = sum(p["nonadditive"] for p in selected_rows)

    def grouped_payees(payments):
        grouped = defaultdict(list)
        for p in payments:
            grouped[p["payee_id"] or "unnamed:" + p["report_key"]].append(p)
        return [
            {
                "payee_id": ps[0]["payee_id"],
                "payee": ps[0]["payee"],
                "authority": ps[0]["authority"],
                "authority_name": ps[0]["authority_name"],
                "geography": ps[0]["geography"],
                "excludable": ps[0]["payee_id"] is not None,
                "report_keys": sorted({p["report_key"] for p in ps}),
                "purposes": sorted({p["purpose"] or "" for p in ps}),
                "payment_count": len(ps),
                "amounts": None,
                "reported_amounts": _reported_amounts(ps),
                "memo_detail_count": sum(p["nonadditive"] for p in ps),
                "source": [b for p in ps for b in p["source"]],
            }
            for ps in grouped.values()
        ]

    data["payees"].extend(grouped_payees(visible))
    for group in grouped_payees([p for p in rows if p["payee_id"] in exclusions]):
        group["account_reports"] = [
            {
                "authority": p["authority"],
                "account_id": p["account_id"],
                "report_key": p["report_key"],
                "claims": p["claims"],
                "reported_amounts": _reported_amounts(
                    [
                        r
                        for r in rows
                        if r["payee_id"] == group["payee_id"]
                        and r["report_key"] == p["report_key"]
                    ]
                ),
            }
            for p in {
                r["report_key"]: r for r in rows if r["payee_id"] == group["payee_id"]
            }.values()
        ]
        data["excluded_payees"].append(group)
    data["payments"].extend(visible)
    data["payees"].sort(
        key=lambda p: (
            ((p["payee"] or {}).get("name") or "").casefold(),
            p["payee_id"] or "",
            p["report_keys"],
        )
    )
    data["payments"].sort(key=lambda p: (p["report_key"], p["record_id"]))
    data["coverage"]["scoped_candidacies_with_confirmed_accounts"] = sum(
        bool(c["confirmed_account_count"]) for c in data["candidates"]
    )
    data["coverage"]["external_selected_account_reports"] = len(
        data["authority_reports"]
    )
    data["coverage"]["external_coverage"] = [
        c["external_coverage"] for c in data["candidates"]
    ]
    data["version"] = digest(
        [
            "expense-all-authority-v1",
            data["version"],
            bulk["version"],
            sorted(party_availability.items()),
            sorted(report_keys),
        ]
    )[:16]
    if _csv:
        data["_csv_external_baseline"] = rows
        data["_csv_external_sources"] = bulk.get("sources", [])
    return data


def _external_review_stamp(db, election_key):
    return list(
        db.scalars(
            select(m.ElectionCampaignAccountDecision.id)
            .where(
                m.ElectionCampaignAccountDecision.election_key == election_key,
                m.ElectionCampaignAccountDecision.authority != "mn_cfb",
            )
            .order_by(m.ElectionCampaignAccountDecision.id)
        )
    )


def _build(
    db,
    *,
    election_key,
    snapshot_id=None,
    version=None,
    race_id=None,
    candidate_id=None,
    party=None,
    candidate_query="",
    report_keys=(),
    geography=None,
    payee_query="",
    excluded_payee_ids=(),
    limit=50,
    offset=0,
    _csv=False,
):
    _validate_query(
        race_id=race_id,
        candidate_id=candidate_id,
        party=party,
        candidate_query=candidate_query,
        report_keys=report_keys,
        geography=geography,
        payee_query=payee_query,
        excluded_payee_ids=excluded_payee_ids,
        limit=limit,
        offset=offset,
    )
    for value, pattern in ((snapshot_id, r"[a-f0-9]{64}"), (version, r"[a-f0-9]{16}")):
        if value is not None and (
            not isinstance(value, str) or not re.fullmatch(pattern, value)
        ):
            _bad("Invalid report version pin")
    # The review stamp is already a database read. Pin before it so a fresh
    # request never opens READ COMMITTED before the nested finance readers.
    finance_versions.pin(db)
    try:
        store = request_store(raw_file_store_from_env())
    except Exception:
        store = None  # Existing source-unavailable handling remains in each reader.
    external_stamp = _external_review_stamp(db, election_key)
    external_pointer = db.get(m.ElectionExternalFinanceCurrent, election_key)
    external_data = (
        external.bulk_finance(db, election_key=election_key, store=store)
        if external_pointer
        else None
    )
    external_keys = {
        r["report_key"]
        for c in (external_data or {}).get("candidates", [])
        for r in c["reports"]
    }
    board_report_keys = [key for key in report_keys if key not in external_keys]
    loaded = _load(
        db,
        election_key,
        snapshot_id,
        race_id=race_id,
        candidate_id=candidate_id,
        party=party,
        candidate_query=candidate_query,
        report_keys=board_report_keys,
        pinned=version is not None,
        store=store,
    )
    # Only the Board portion enters Board arithmetic. External IDs are namespaced.
    board_exclusions = [
        pid
        for pid in excluded_payee_ids
        if pid not in _external_payee_ids(external_data)
    ]
    try:
        data = _assemble(
            *loaded,
            race_id=race_id,
            candidate_id=candidate_id,
            party=party,
            candidate_query=candidate_query,
            report_keys=board_report_keys,
            geography=geography,
            payee_query=payee_query,
            excluded_payee_ids=board_exclusions,
            _csv=_csv,
        )

        data = _join_external(
            db,
            data,
            external_data,
            loaded[1],
            report_keys=report_keys,
            excluded_payee_ids=excluded_payee_ids,
            _csv=_csv,
            store=store,
        )
    except HTTPException as exc:
        if version is not None and exc.status_code == 422:
            finance._changed()
        raise
    if version is not None and version != data["version"]:
        finance._changed()
    election = results.snapshot(db, election_key)
    current_pointer = db.get(m.ElectionFinanceCurrent, election_key)
    current_id = finance._collection(db, election_key).id if current_pointer else None
    review_ids = sorted(
        row.id
        for row in db.execute(
            select(
                m.ElectionCampaignAccountDecision.id,
                m.ElectionCampaignAccountDecision.race_id,
                m.ElectionCampaignAccountDecision.candidate_id,
                m.ElectionCampaignAccountDecision.registration_number,
            ).where(
                m.ElectionCampaignAccountDecision.election_key == election_key,
                m.ElectionCampaignAccountDecision.authority == "mn_cfb",
            )
        )
        if (row.race_id, row.candidate_id) in loaded[0]["_scope_keys"]
        or row.registration_number in loaded[0]["_classification_regs"]
    )
    if [election.id, current_id, review_ids] != loaded[0]["_read_stamp"]:
        finance._changed()
    if _external_review_stamp(db, election_key) != external_stamp:
        finance._changed()
    end_external = db.get(
        m.ElectionExternalFinanceCurrent, election_key, populate_existing=True
    )
    if (end_external.generation_id if end_external else None) != (
        external_data or {}
    ).get("generation_id"):
        finance._changed()
    return data


def report(db, *, limit=50, offset=0, **kwargs):
    data = _build(db, limit=limit, offset=offset, **kwargs)
    all_candidates = data.pop("candidates")
    data.pop("payees")
    data.pop("payments")
    return {
        **data,
        "candidates": all_candidates[offset : offset + limit],
        "page": {"limit": limit, "offset": offset, "total": len(all_candidates)},
    }


def payees(db, *, limit=50, offset=0, **kwargs):
    data = _build(db, limit=limit, offset=offset, **kwargs)
    rows = data.pop("payees")
    data.pop("candidates")
    data.pop("payments")
    return {
        **data,
        "payees": rows[offset : offset + limit],
        "page": {"limit": limit, "offset": offset, "total": len(rows)},
    }


def payments(
    db,
    *,
    payee_id=None,
    unnamed_report_key=None,
    report_key=None,
    authority=None,
    measure=None,
    limit=50,
    offset=0,
    **kwargs,
):
    if payee_id is not None and (
        not isinstance(payee_id, str) or not re.fullmatch(r"[a-f0-9]{64}", payee_id)
    ):
        _bad("Unknown payee identifier")
    if unnamed_report_key is not None and (
        not isinstance(unnamed_report_key, str)
        or not re.fullmatch(r"[a-f0-9]{64}", unnamed_report_key)
    ):
        _bad("Unknown report identifier")
    if payee_id is not None and unnamed_report_key is not None:
        _bad("Select a payee or an unnamed report group")
    if report_key is not None and (
        not isinstance(report_key, str)
        or re.fullmatch(r"[a-f0-9]{64}", report_key) is None
    ):
        _bad("Unknown report identifier")
    for value, maximum in ((authority, 160), (measure, 200)):
        if value is not None and (
            not isinstance(value, str)
            or not 1 <= len(value) <= maximum
            or any(ord(c) < 32 for c in value)
        ):
            _bad("Invalid source measure scope")
    data = _build(db, limit=limit, offset=offset, **kwargs)
    rows = data.pop("payments")
    if report_key is not None:
        if report_key not in {
            r["report_key"]
            for r in [*data["account_reports"], *data["authority_reports"]]
        }:
            _bad("Report is not in the selected detail scope")
        rows = [p for p in rows if p["report_key"] == report_key]
    if authority is not None:
        rows = [p for p in rows if p.get("authority", "mn_cfb") == authority]
    if measure is not None:
        rows = [
            p
            for p in rows
            if p.get("measure", "mn_cfb_campaign_expenditures") == measure
        ]
    data["filters"].update(report_key=report_key, authority=authority, measure=measure)
    data.pop("candidates")
    data.pop("payees")
    if payee_id is not None:
        if not any(p["payee_id"] == payee_id for p in rows):
            _bad("Payee is not in the filtered detail")
        rows = [p for p in rows if p["payee_id"] == payee_id]
    if unnamed_report_key is not None:
        rows = [
            p
            for p in rows
            if p["payee_id"] is None and p["report_key"] == unnamed_report_key
        ]
        if not rows:
            _bad("Unnamed payee group is not in the filtered detail")
    data["filters"]["payee_id"] = payee_id
    data["filters"]["unnamed_report_key"] = unnamed_report_key
    return {
        **data,
        "payments": rows[offset : offset + limit],
        "page": {"limit": limit, "offset": offset, "total": len(rows)},
    }


_CSV_PARTIES = {
    "R": "Republican",
    "DFL": "Democratic-Farmer-Labor",
    "NP": "Nonpartisan",
    "other": "Other parties",
    "unknown": "Unknown party",
}
_CSV_GEOGRAPHIES = {
    "MN": "Minnesota",
    "out_of_state": "Out of state",
    "unknown": "Unknown",
}
_CSV_AMOUNT_FAMILIES = (
    "Report",
    "Non-itemized",
    "Payee baseline",
    "Payee after exclusions",
    "Payment",
)
_CSV_COLUMNS = (
    "Row type",
    "Metadata field",
    "Metadata value",
    "Candidate",
    "Account party group",
    "Account filed party",
    "Payee",
    "Filed address",
    "Filed geography",
    "Period start",
    "Period end",
    "Payee baseline paid USD",
    "Payee baseline unpaid USD",
    "Payee baseline in-kind USD",
    "Payee baseline total USD",
    "Payee after exclusions paid USD",
    "Payee after exclusions unpaid USD",
    "Payee after exclusions in-kind USD",
    "Payee after exclusions total USD",
    "Public subsidy USD",
    "Displayed candidates",
    "Governing candidates",
    "Candidate ID",
    "Race ID",
    "Office",
    "District",
    "Official party",
    "Official party group",
    "Party assignment",
    "Account",
    "Committee",
    "Report key",
    "Report label",
    "Report type",
    "Report year",
    "Report cutoff",
    "Received date",
    "Report copied at",
    "Amendment",
    "Period basis",
    "Payee status",
    "Payee ID",
    "Filed street",
    "Filed city",
    "Filed state",
    "Filed postal code",
    "Filed address status",
    "Underlying vendor",
    "Underlying vendor address",
    "Relationship",
    "Date",
    "Purpose",
    "Excluded payee",
    "Matches detail filters",
    "Included in filtered view",
    "Figure status",
    "Detail status",
    "Subsidy status",
    "Gaps",
    "Candidate count",
    "Account count",
    "Payment count",
    "Report paid USD",
    "Report unpaid USD",
    "Report in-kind USD",
    "Report total USD",
    "Non-itemized paid USD",
    "Non-itemized unpaid USD",
    "Non-itemized in-kind USD",
    "Non-itemized total USD",
    "Payment paid USD",
    "Payment unpaid USD",
    "Payment in-kind USD",
    "Payment total USD",
    "Source URL",
    "Original URL",
    "Source SHA256",
    "Source pages",
    "Source lines",
    "Source references",
    "Source text",
    "Source row ID",
    "Authority",
    "Authority ID",
    "Measure",
    "Measure ID",
    "Basis",
    "Amount role",
    "Reported measure value",
    "Reported payment amount",
    "Memo detail amount",
    "Itemized before exclusions",
    "Itemized after exclusions",
    "Source copied at",
    "Currency",
    "Unit",
)


def _csv_words(value):
    return value.replace("_", " ") if isinstance(value, str) else ""


def _csv_join(values):
    return "\n".join(
        dict.fromkeys(
            str(value) for value in values if value is not None and value != ""
        )
    )


def _csv_amounts(family, amounts):
    return {
        f"{family} {column.replace('_', '-')} USD": (amounts or {}).get(column)
        for column in COLUMNS
    }


def _csv_address(identity):
    identity = identity or {}
    address = identity.get("address") or {}
    return {
        "Payee": identity.get("name"),
        "Payee status": "Shown" if identity.get("name") else "Payee not shown",
        "Filed street": address.get("street"),
        "Filed city": address.get("city"),
        "Filed state": address.get("state"),
        "Filed postal code": address.get("postal_code"),
        "Filed address": _csv_join(address.get("lines") or []),
        "Filed address status": "Address not shown"
        if not address.get("lines")
        else "Street address not shown"
        if not address.get("street")
        else "Address shown",
    }


def _csv_locations(locations):
    locations = [loc for loc in locations if loc]
    return {
        "Source pages": _csv_join(loc.get("page") for loc in locations),
        "Source lines": _csv_join(
            f"Page {loc.get('page', 'not shown')}, line {loc['line']}"
            for loc in locations
            if loc.get("line") is not None
        ),
        "Source references": _csv_join(
            "; ".join(
                value
                for value in (
                    f"SHA256 {loc['source_sha256']}"
                    if loc.get("source_sha256")
                    else "",
                    f"page {loc['page']}" if loc.get("page") is not None else "",
                    f"line {loc['line']}" if loc.get("line") is not None else "",
                )
                if value
            )
            for loc in locations
        ),
        "Source text": _csv_join(loc.get("text") for loc in locations),
    }


def _csv_payment_locations(payment):
    return [
        *payment["source"],
        payment.get("payee_header_source"),
        *((payment.get("payee") or {}).get("source") or []),
        *((payment.get("underlying_vendor") or {}).get("source") or []),
    ]


# Canonical Finance address: docs/architecture/alethical-finance-architecture.md.
# Exported links must work away from the API and must never trust request Host.
_FINANCE_PUBLIC_ORIGIN = "https://alethicalfinance.com"


def _csv_source_url(url):
    """Only typed, pinned retained-source paths become app-opening links."""
    if not isinstance(url, str):
        return None
    try:
        parsed = urlsplit(url)
    except ValueError:
        return None
    if parsed.scheme or parsed.netloc or parsed.fragment:
        return None
    match = re.fullmatch(
        r"/api/v1/finance/elections/(mn-[0-9]{4}-[0-9]{2}-[0-9]{2}-(?:general|primary|special))/(finance/)?sources/([a-f0-9]{64})(/raw)?",
        parsed.path,
    )
    if not match or (match[4] and not match[2]):
        return None
    pin = "collection_id" if match[2] else "snapshot_id"
    try:
        entries = parse_qsl(parsed.query, keep_blank_values=True, strict_parsing=True)
    except ValueError:
        return None
    if (
        len(entries) != 1
        or entries[0][0] != pin
        or not re.fullmatch(r"[a-f0-9]{64}", entries[0][1])
    ):
        return None
    kind = "finance" if match[4] else "report" if match[2] else "election"
    return (
        f"{_FINANCE_PUBLIC_ORIGIN}/elections/{match[1]}/sources/{match[3]}?"
        + urlencode({"kind": kind, pin: entries[0][1]})
    )


def _csv_detail_flags(payment, filters):
    excluded = payment["payee_id"] in filters["excluded_payee_ids"]
    matches = (
        not filters["geography"] or payment["geography"] == filters["geography"]
    ) and (
        not filters["payee_query"]
        or filters["payee_query"].casefold()
        in ((payment["payee"] or {}).get("name") or "").casefold()
    )
    return {
        "Excluded payee": "Yes" if excluded else "No",
        "Matches detail filters": "Yes" if matches else "No",
        "Included in filtered view": "Yes" if matches and not excluded else "No",
    }


def _external_csv_rows(data):
    generation = data.get("external_generation_id")
    if not generation:
        return
    metadata = {s["sha256"]: s for s in data.get("_csv_external_sources", [])}
    used = set()
    reports = {r["report_key"]: r for r in data["authority_reports"]}

    def context(report):
        return {
            "Authority": report["authority_name"],
            "Authority ID": report["authority"],
            "Account": report["account_id"],
            "Committee": report["account_name"],
            "Report key": report["report_key"],
            "Report type": report["report_type"],
            "Period start": report["period_start"],
            "Period end": report["period_end"],
            "Received date": report["received_date"],
            "Account party group": "Party cannot be assigned"
            if report["party_classification_state"]
            in {"mixed_ballot_parties", "membership_sources_unavailable"}
            else _CSV_PARTIES[report["party_group"]],
            "Party assignment": {
                "mixed_ballot_parties": "Shared account, different ballot parties",
                "single_ballot_party": "One official party",
                "ballot_party_not_in_source": "Official party not shown",
                "membership_sources_unavailable": "Account membership source unavailable",
            }[report["party_classification_state"]],
            "Governing candidates": _csv_join(c["name"] for c in report["claims"]),
            "Displayed candidates": _csv_join(
                c["name"] for c in report["display_claims"]
            ),
        }

    def source(bindings):
        for b in bindings or []:
            used.add(b["source_sha256"])
        b = next(iter(bindings or []), {})
        h = b.get("source_sha256")
        original = metadata.get(h, {})
        return {
            "Source SHA256": h,
            "Source URL": f"https://alethicalfinance.com/elections/{quote(data['election_key'], safe='')}/sources/{h}?"
            + urlencode({"kind": "external", "generation_id": generation})
            if h
            else None,
            "Original URL": original.get("url"),
            "Source copied at": original.get("copied_at"),
            "Source row ID": (b.get("locator") or {}).get("row"),
            "Source pages": _csv_join(
                binding.get("locator", {}).get("page") for binding in bindings or []
            ),
            "Source references": _csv_join(
                binding.get("locator", {}).get("field") for binding in bindings or []
            ),
            "Source text": _csv_join(
                binding.get("quote") for binding in bindings or []
            ),
        }

    for report in reports.values():
        base = context(report)
        yield (
            base
            | source(report["sources"])
            | {
                "Row type": "External account report",
                "Figure status": _csv_words(report["check_status"]),
                "Detail status": _csv_words(report["detail_status"]),
                "Gaps": _csv_words(report["detail_gap"]),
                "Subsidy status": "No checked subsidy measure",
            }
        )
        for figure in report["reported_measures"] or []:
            yield (
                base
                | source(figure["sources"])
                | {
                    "Row type": "External report measure",
                    "Measure": figure["label"],
                    "Measure ID": figure["measure"],
                    "Basis": figure.get("basis"),
                    "Period start": figure["period_start"],
                    "Period end": figure["period_end"],
                    "Reported measure value": figure["value"],
                    "Currency": figure.get("currency"),
                    "Unit": figure["unit"],
                }
            )
        for gap in (
            (report.get("source_field_gaps") or [])
            + (report.get("unavailable_measures") or [])
            + (report.get("withheld_measures") or [])
        ):
            yield (
                base
                | source(gap.get("sources"))
                | {
                    "Row type": "External measure gap",
                    "Measure": gap.get("label"),
                    "Measure ID": gap["measure"],
                    "Figure status": {
                        "blank": "Blank in source",
                        "ambiguous": "Unclear",
                        "unreadable": "Unreadable",
                        "not_checked": "Not checked",
                        "unit_not_in_source": "Unit not reported",
                        "sources_unavailable": "Source unavailable",
                        "period_not_covered": "Outside checked account dates",
                    }.get(gap["state"], _csv_words(gap["state"])),
                }
            )
    for row in data["authority_summary"]:
        yield context(reports[row["report_key"]]) | {
            "Row type": "External itemized subtotal",
            "Measure": row["label"],
            "Measure ID": row["measure"],
            "Basis": row["basis"],
            "Currency": row["currency"],
            "Unit": "money",
            "Itemized before exclusions": row["baseline"],
            "Itemized after exclusions": row["adjusted"],
        }
        for kind, values in (
            ("Party", row["by_party"]),
            ("Filed geography", row["by_filed_address"]),
        ):
            for label, amount in values.items():
                yield context(reports[row["report_key"]]) | {
                    "Row type": "External itemized " + kind.lower(),
                    "Measure": row["label"],
                    "Measure ID": row["measure"],
                    "Basis": row["basis"],
                    "Account party group" if kind == "Party" else "Filed geography": (
                        "Party cannot be assigned"
                        if kind == "Party"
                        and label == "unknown"
                        and reports[row["report_key"]]["party_classification_state"]
                        in {"mixed_ballot_parties", "membership_sources_unavailable"}
                        else _CSV_PARTIES[label]
                        if kind == "Party"
                        else _CSV_GEOGRAPHIES[label]
                    ),
                    "Currency": row["currency"],
                    "Unit": "money",
                    "Itemized before exclusions": amount["baseline"],
                    "Itemized after exclusions": amount["adjusted"],
                }
    for payment in data.get("_csv_external_baseline", []):
        payee = payment["payee"] or {}
        address = payee.get("address") or {}
        yield (
            context(reports[payment["report_key"]])
            | source(payment["source"])
            | _csv_detail_flags(payment, data["filters"])
            | {
                "Row type": "External memo detail"
                if payment["nonadditive"]
                else "External payment",
                "Payee": payee.get("name"),
                "Payee ID": payment["payee_id"],
                "Filed address": _csv_join(address.get("lines") or []),
                "Filed state": address.get("state"),
                "Filed postal code": address.get("postal_code"),
                "Filed geography": payment["geography"],
                "Filed address status": payee.get("address_status"),
                "Date": payment["date"],
                "Purpose": payment["purpose"],
                "Measure": payment["measure_label"],
                "Measure ID": payment["measure"],
                "Basis": payment["basis"],
                "Amount role": _csv_words(payment["amount_role"]),
                "Currency": payment["currency"],
                "Unit": "money",
                "Memo detail amount"
                if payment["nonadditive"]
                else "Reported payment amount": payment["reported_amount"],
                "Source row ID": payment["source_row_id"],
            }
        )
    for candidate in data["candidates"]:
        coverage = candidate.get("external_coverage") or {}
        yield {
            "Row type": "External coverage",
            "Candidate": candidate["name"],
            "Candidate ID": candidate["candidate_id"],
            "Race ID": candidate["race_id"],
            "Authority ID": coverage.get("authority"),
            "Figure status": _csv_words(coverage.get("status")),
            "Gaps": coverage.get("next_action"),
        }
    for h in sorted(used):
        yield {"Row type": "External source"} | source([{"source_sha256": h}])


def _csv_body(data):
    """Flat, numeric-column-safe spreadsheet data; no JSON cells or extra reads."""
    output = io.StringIO(newline="")
    writer = csv.DictWriter(output, fieldnames=_CSV_COLUMNS, lineterminator="\n")
    writer.writeheader()
    numeric = {
        "Candidate count",
        "Account count",
        "Payment count",
        "Amendment",
        "Report year",
        "Public subsidy USD",
        "Reported measure value",
        "Reported payment amount",
        "Memo detail amount",
        "Itemized before exclusions",
        "Itemized after exclusions",
    } | {
        f"{family} {column.replace('_', '-')} USD"
        for family in _CSV_AMOUNT_FAMILIES
        for column in COLUMNS
    }
    identifiers = {
        "Account",
        "Candidate ID",
        "Report key",
        "Payee ID",
        "Source SHA256",
        "Source row ID",
        "Race ID",
        "Filed postal code",
    }

    def write(row):
        cells = {}
        for key, value in row.items():
            if isinstance(value, (dict, list, tuple, set)):
                raise ValueError("CSV cells must be plain scalar values")
            if key in numeric:
                cells[key] = value
            else:
                # CSV cannot set spreadsheet cell types. Protect numeric IDs from
                # lost leading zeros/precision, alongside ordinary formula safety.
                text = str(value) if value is not None else ""
                cells[key] = (
                    "'" + text
                    if key in identifiers
                    and text.isdecimal()
                    and (text.startswith("0") or len(text) > 15)
                    else _safe_text(text)
                )
        writer.writerow(cells)

    metadata_rows = []
    candidate_rows = []
    account_rows = []

    def meta(key, value):
        metadata_rows.append(
            {"Row type": "Metadata", "Metadata field": key, "Metadata value": value}
        )

    def evidence_references(evidence):
        references = []
        for item in evidence:
            url = item.get("retained_source_url") or item.get("url")
            if not url and item.get("kind") in {"candidate_roster", "official_result"}:
                url = (
                    f"/api/v1/finance/elections/{quote(data['election_key'], safe='')}/sources/{item['source_sha256']}?"
                    + urlencode({"snapshot_id": data["snapshot_id"]})
                )
            parts = [
                _csv_words(item.get("kind")),
                _csv_source_url(url)
                or (
                    url if isinstance(url, str) and url.startswith("https://") else None
                ),
                item.get("sha256") or item.get("source_sha256"),
            ]
            if item.get("availability"):
                parts.append("source " + item["availability"])
            for key in ("page", "line", "row_number"):
                if item.get(key) is not None:
                    parts.append(f"{key.replace('_', ' ')} {item[key]}")
            if item.get("lines"):
                parts.append("lines " + ", ".join(map(str, item["lines"])))
            locator = item.get("locator")
            if isinstance(locator, dict):
                parts.extend(
                    f"{key} {value}"
                    for key, value in locator.items()
                    if key
                    in {"page", "line", "row", "record", "column", "field", "path"}
                    and isinstance(value, (str, int))
                )
            references.append(
                "; ".join(
                    str(part) for part in parts if part is not None and part != ""
                )
            )
        return _csv_join(references)

    meta("CSV schema", "2 - plain spreadsheet columns")
    meta(
        "Amount columns",
        "Paid means cash paid; unpaid and in-kind stay separate. Total adds those amounts. Public subsidy is a separate receipt, not vendor spending.",
    )
    meta(
        "Non-itemized",
        "Report amounts without individual payee rows; keep separate from checked payee detail.",
    )
    for key in (
        "election_key",
        "election_date",
        "generated_at",
        "snapshot_id",
        "collection_id",
        "version",
        "copied_at",
        "reporting_scope",
    ):
        meta(key.replace("_", " ").capitalize(), data.get(key))
    meta(
        "How to total",
        "Use one amount family: Payee baseline for checked itemized baseline; Payee after exclusions for its adjusted view; Payment for source payment detail. Report totals already include itemized and non-itemized amounts. Never add these alternative families together, or add Total to its components.",
    )
    meta(
        "Row types",
        "Candidate rows count candidacies; Account report rows count unique accounts and hold source totals, subsidy and non-itemized amounts; Payee summary and Payment rows describe the same itemized detail using separate amount columns.",
    )
    meta(
        "Detail filters",
        "Complete checked baseline is retained. Filter Included in filtered view to Yes for the current payee/geography/exclusion view; filter Matches detail filters to Yes for the same view before exclusions.",
    )
    meta(
        "Excluded payments",
        "Excluded payees remain in baseline detail with Excluded payee=Yes. Their Payee after exclusions cells are blank; source totals and public subsidy are unchanged.",
    )
    meta(
        "Unavailable amounts",
        "Blank source amount cells are unavailable, not zero. Literal checked zero remains 0.00. Unreconciled detail is withheld.",
    )
    meta(
        "Periods",
        "Each account/report has its actual period; there is no common-period or complete-election-spending total. Do not add overlapping cumulative reports.",
    )
    meta(
        "Party and shared accounts",
        "Money uses all source-valid account memberships, including nonmatching candidates. Governing names describe relationships, not a dollar allocation. Shared money is counted once.",
    )
    meta(
        "Filed address geography",
        "Filed payee address only, not where work or economic benefit occurred. Unknown geography does not prove an omitted filing.",
    )
    meta(
        "Underlying vendors",
        "Underlying vendor is separate from the paid payee. Do not add it as another payment or infer reimbursement vendors.",
    )
    meta(
        "Sources",
        "Source URL opens the exact retained original in Finance; sign in if needed. Original URL may be a generic official viewer. Source pages, lines, references and text locate the evidence.",
    )
    meta(
        "Spreadsheet text",
        "A leading apostrophe protects formulas or numeric identifiers from spreadsheet conversion; it is not part of the source value. Board amounts retain exact USD cents. Other authorities retain source precision, with Currency and Unit shown separately.",
    )
    for key, value in data["filters"].items():
        values = value if isinstance(value, list) else [value]
        for item in values or [""]:
            meta("Filter: " + key.replace("_", " "), item)
    for key, value in data["coverage"].items():
        if not isinstance(value, (dict, list)):
            meta("Coverage: " + key.replace("_", " "), value)
    for label, value in (
        (
            "Available source-total accounts",
            data["summary"]["source_report_totals"]["available_accounts"],
        ),
        (
            "Available subsidy accounts",
            data["summary"]["public_subsidy_receipts"]["available_accounts"],
        ),
        ("Withheld detail accounts", data["summary"]["withheld_detail_accounts"]),
        (
            "Checked baseline payment count",
            data["summary"]["baseline_checked_itemized_detail"]["payment_count"],
        ),
    ):
        meta(label, value)

    account_details = defaultdict(list)
    candidates_by_key = {
        (c["race_id"], c["candidate_id"]): c for c in data["candidates"]
    }
    for candidate in data["candidates"]:
        for account in candidate["accounts"]:
            account_details[account["registration_number"]].append(account)
        source_hash = candidate.get("candidate_source_sha256")
        source_url = (
            (
                f"/api/v1/finance/elections/{quote(data['election_key'], safe='')}/sources/{source_hash}?"
                + urlencode({"snapshot_id": data["snapshot_id"]})
            )
            if source_hash
            else None
        )
        candidate_rows.append(
            {
                "Row type": "Candidate",
                "Candidate": candidate["name"],
                "Candidate ID": candidate["candidate_id"],
                "Race ID": candidate["race_id"],
                "Office": candidate["office"],
                "District": candidate.get("district"),
                "Official party": candidate.get("filed_party"),
                "Official party group": _CSV_PARTIES[candidate["party_group"]],
                "Candidate count": 1,
                "Account": _csv_join(
                    a["registration_number"] for a in candidate["accounts"]
                ),
                "Gaps": _csv_join(
                    _csv_words(gap.get("state")) for gap in candidate["gaps"]
                ),
                "Source URL": _csv_source_url(source_url),
                "Source SHA256": source_hash,
                "Source references": evidence_references(
                    candidate.get("party_sources", [])
                ),
            }
        )

    context_by_report = {}
    for account in data["account_reports"]:
        filing, source = account["filing"], account["source"]
        shown = account.get("display_claims", account["claims"])
        names = list(dict.fromkeys(claim["name"] for claim in shown))
        details = data.get("_csv_account_details", account_details)[
            account["registration_number"]
        ]
        group = account["party_group"]
        assignment = account["party_classification_state"]
        common = {
            "Candidate": names[0]
            if len(account["claims"]) == 1 and len(names) == 1
            else "Shared campaign account",
            "Candidate ID": _csv_join(c["candidate_id"] for c in shown),
            "Race ID": _csv_join(c["race_id"] for c in shown),
            "Office": _csv_join(
                candidates_by_key.get((c["race_id"], c["candidate_id"]), {}).get(
                    "office"
                )
                for c in shown
            ),
            "District": _csv_join(
                candidates_by_key.get((c["race_id"], c["candidate_id"]), {}).get(
                    "district"
                )
                for c in shown
            ),
            "Displayed candidates": _csv_join(names),
            "Governing candidates": _csv_join(
                f"{c['name']} ({c.get('filed_party') or 'Party not shown'}; race {c['race_id']}; candidate {c['candidate_id']})"
                for c in account["claims"]
            ),
            "Account": account["registration_number"],
            "Committee": _csv_join(d.get("committee_name") for d in details),
            "Account filed party": _csv_join(
                [d.get("account_filed_party") for d in details]
                + [
                    e.get("filed_party")
                    for d in details
                    for e in d.get("register_party_source", [])
                ]
            ),
            "Account party group": "Party cannot be assigned"
            if assignment in {"mixed_ballot_parties", "membership_sources_unavailable"}
            else _CSV_PARTIES[group],
            "Party assignment": {
                "mixed_ballot_parties": "Shared account, different ballot parties",
                "single_ballot_party": "One official party",
                "ballot_party_not_in_source": "Official party not shown",
                "membership_sources_unavailable": "Account membership source unavailable",
            }[assignment],
            "Report key": account["report_key"],
            "Report label": filing.get("report_name"),
            "Report type": filing.get("report_type"),
            "Report year": filing.get("filing_year"),
            "Report cutoff": filing.get("cut_off_date"),
            "Received date": account.get("received_date"),
            "Report copied at": (source.get("document") or {}).get("copied_at"),
            "Amendment": filing.get("effective_amendment_index"),
            "Period start": account.get("period_start"),
            "Period end": account.get("period_end"),
            "Period basis": _csv_words(account.get("period_basis")),
            "Source URL": _csv_source_url(source.get("retained_source_url")),
            "Original URL": (source.get("document") or {}).get("url"),
            "Source SHA256": source.get("sha256"),
            "Figure status": _csv_words(account["figure_status"]),
            "Detail status": _csv_words(account["detail_status"]),
            "Subsidy status": "checked"
            if account["public_subsidy"] is not None
            else "unavailable",
            "Gaps": _csv_join(
                _csv_words(value)
                for value in [
                    account.get("detail_gap"),
                    account.get("public_subsidy_gap"),
                    *account.get("detail_gaps", []),
                ]
            ),
        }
        context_by_report[account["report_key"]] = common
        expense = account.get("expense_source") or {}
        subsidy = account["public_subsidy"] or {}
        account_rows.append(
            common
            | {
                "Row type": "Account report",
                "Account count": 1,
                **_csv_amounts("Report", account["campaign_expenses"]),
                **_csv_amounts("Non-itemized", account["non_itemized_totals"]),
                "Public subsidy USD": subsidy.get("total"),
                "Source references": evidence_references(
                    [
                        e
                        for claim in account["claims"]
                        for e in claim.get("account_evidence", [])
                    ]
                    + [
                        e
                        for item in details
                        for e in item.get("register_party_source", [])
                    ]
                ),
                "Source pages": _csv_join(
                    [expense.get("page"), subsidy.get("source_page")]
                ),
                "Source lines": _csv_join(
                    [
                        "Campaign expenses: "
                        + ", ".join(map(str, expense.get("summary_lines", []))),
                        "Public subsidy: "
                        + ", ".join(map(str, subsidy.get("source_lines", []))),
                    ]
                ),
            }
        )

    baseline = data.get("_csv_baseline_payments", data["payments"])
    exclusions = set(data["filters"]["excluded_payee_ids"])
    grouped = defaultdict(list)
    for payment in baseline:
        grouped[
            (payment["report_key"], payment["payee_id"], payment["geography"])
        ].append(payment)

    def detail(payment):
        return {
            **_csv_address(payment["payee"]),
            **_csv_detail_flags(payment, data["filters"]),
            "Payee ID": payment["payee_id"],
            "Filed geography": _CSV_GEOGRAPHIES[payment["geography"]],
            "Gaps": _csv_join(
                [
                    context_by_report[payment["report_key"]]["Gaps"],
                    *(_csv_words(value) for value in payment.get("uncertainties", [])),
                ]
            ),
        }

    write(
        {
            "Row type": "Metadata",
            "Metadata field": "Start here",
            "Metadata value": "Payee summary rows show before/after exclusions. Account report rows hold subsidy/source totals. Payment rows give detail. Use one amount family; do not add summaries to detail. More instructions and scope are at the end.",
        }
    )
    for (report_key, _, _), payments in grouped.items():
        first = payments[0]
        write(
            context_by_report[report_key]
            | detail(first)
            | _csv_locations(
                [loc for p in payments for loc in _csv_payment_locations(p)]
            )
            | {
                "Row type": "Payee summary",
                "Payment count": len(payments),
                "Purpose": _csv_join(p.get("purpose") for p in payments),
                "Gaps": _csv_join(
                    [
                        context_by_report[report_key]["Gaps"],
                        *(
                            _csv_words(value)
                            for p in payments
                            for value in p.get("uncertainties", [])
                        ),
                    ]
                ),
                **_csv_amounts(
                    "Payee baseline", _money([p["amounts"] for p in payments])
                ),
                **_csv_amounts(
                    "Payee after exclusions",
                    None
                    if first["payee_id"] in exclusions
                    else _money([p["amounts"] for p in payments]),
                ),
            }
        )
    for row in account_rows:
        write(row)
    for payment in baseline:
        vendor = payment.get("underlying_vendor") or {}
        write(
            context_by_report[payment["report_key"]]
            | detail(payment)
            | _csv_locations(_csv_payment_locations(payment))
            | {
                "Row type": "Payment",
                "Date": payment.get("date"),
                "Purpose": payment.get("purpose"),
                "Underlying vendor": vendor.get("name"),
                "Underlying vendor address": _csv_join(
                    (vendor.get("address") or {}).get("lines") or []
                ),
                "Relationship": _csv_words(payment.get("relationship")),
                "Source row ID": payment["record_id"],
                **_csv_amounts("Payment", payment["amounts"]),
            }
        )
    for row in candidate_rows:
        write(row)
    for row in metadata_rows:
        write(row)
    for row in _external_csv_rows(data):
        write(row)
    return output.getvalue()


def export(db, *, format="json", **kwargs):
    if format not in {"json", "csv"}:
        _bad("Unknown export format")
    data = _build(db, _csv=True, **kwargs) if format == "csv" else _build(db, **kwargs)
    data["generated_at"] = datetime.now(UTC).isoformat()
    if format == "json":
        body = (
            json.dumps(data, sort_keys=True, ensure_ascii=False, separators=(",", ":"))
            + "\n"
        )
    else:
        body = _csv_body(data)
    return body, f"campaign-expenses-{data['election_date']}-{data['version']}.{format}"
