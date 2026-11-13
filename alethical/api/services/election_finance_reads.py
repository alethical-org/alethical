"""Published report comparisons through exact, dated account review decisions."""

from __future__ import annotations

import hashlib
import json
import tempfile
from datetime import date
from typing import NoReturn
from itertools import islice
from urllib.parse import quote, urlencode

from fastapi import HTTPException

from sqlalchemy import and_, func, or_, select, literal_column
from sqlalchemy.orm import Session

from alethical.api.problems import problem_exception
from alethical.api.services import election_comparison_reads as results
from alethical.api.services import election_outside_spending as outside
from alethical.api.services import finance_versions
from alethical.db import models as m
from alethical.pipeline.election_account_reviews import applicable_accounts
from alethical.api.services.election_source_io import outcome_map as applicable_outcomes
from alethical.pipeline.election_comparison import read_source
from alethical.pipeline.campaign_finance_report_document_store import read_document
from alethical.pipeline.raw_file_store import raw_file_store_from_env

R = m.CampaignFinanceIndependentExpenditureRow


def _unavailable() -> NoReturn:
    raise problem_exception(
        503,
        "Service Unavailable",
        "These financial sources are unavailable. Try again.",
    )


def _missing() -> NoReturn:
    raise problem_exception(
        404, "Not Found", "These financial records are not available"
    )


def _changed() -> NoReturn:
    raise problem_exception(
        409,
        "Records Changed",
        "The comparison changed. Reload before continuing.",
        type_slug="records-changed",
    )


def _source(source):
    fields = {
        "sha256",
        "url",
        "source_url",
        "copied_at",
        "held_at",
        "request_method",
        "request_form",
        "archive_line",
        "kind",
        "bytes",
        "outcome",
        "origin",
    }
    return {key: value for key, value in source.items() if key in fields}


def _collection(db, election_key, collection_id=None):
    query = select(m.ElectionFinanceCollection).where(
        m.ElectionFinanceCollection.election_key == election_key,
        m.ElectionFinanceCollection.first_published_at.is_not(None),
    )
    if collection_id is None:
        query = query.join(
            m.ElectionFinanceCurrent,
            m.ElectionFinanceCurrent.collection_id == m.ElectionFinanceCollection.id,
        ).where(m.ElectionFinanceCurrent.election_key == election_key)
    else:
        query = query.where(m.ElectionFinanceCollection.id == collection_id)
    collection = db.scalar(query)
    if collection is None:
        _missing()
    return collection


def _held_reports(db, collection):
    reports = db.scalars(
        select(m.ElectionFinanceReport).where(
            m.ElectionFinanceReport.collection_id == collection.id
        )
    ).all()
    if len(reports) != collection.coverage.get("reports"):
        _unavailable()
    hashes = {source["sha256"] for source in collection.sources}
    held = set(
        db.scalars(
            select(m.ElectionResultSource.content_hash).where(
                m.ElectionResultSource.content_hash.in_(hashes)
            )
        )
    )
    if held != hashes:
        _unavailable()
    document_hashes = {
        report.document_hash for report in reports if report.document_hash
    }
    documents = {
        doc.document_hash: doc
        for doc in db.scalars(
            select(m.CampaignFinanceReportDocument).where(
                m.CampaignFinanceReportDocument.document_hash.in_(document_hashes)
            )
        )
    }
    if set(documents) != document_hashes:
        _unavailable()
    for report in reports:
        if report.document_hash:
            doc, filing = documents[report.document_hash], report.payload["filing"]
            if (
                doc.registration_number,
                doc.filing_year,
                doc.report_type,
                doc.amendment_index,
                doc.special_election,
            ) != (
                report.registration_number,
                filing["filing_year"],
                filing["report_type"],
                filing["effective_amendment_index"],
                filing["special_election"],
            ):
                _unavailable()
    return reports


def expense_report_index(db, collection):
    """Sealed compact index; genuine unsealed legacy generations validate fully."""
    from types import SimpleNamespace

    if collection.sealed_at is None:
        return expense_report_rows(db, collection)
    index = collection.report_index
    if (
        not isinstance(index, dict)
        or index.get("version") != 1
        or not isinstance(index.get("reports"), list)
        or len(index["reports"]) != collection.coverage.get("reports")
    ):
        _unavailable()
    entries = index["reports"]
    if len({(r["registration_number"], r["report_key"]) for r in entries}) != len(
        entries
    ):
        _unavailable()
    return [
        SimpleNamespace(
            registration_number=r["registration_number"],
            report_key=r["report_key"],
            document_hash=r["document_hash"],
            payload={
                "filing": r["filing"],
                "period_start": r["period_start"],
                "period_end": r["period_end"],
                "period_basis": r["period_basis"],
                "figure_status": r["figure_status"],
                "figures": True if r["figure_status"] == "source_verified" else None,
            },
        )
        for r in entries
    ]


def expense_report_rows(db, collection, *, report_keys=None):
    """Only a DB-sealed generation may use scoped payload reads.

    Sealing binds the index to validated content under a parent lock. Database
    triggers block header/child changes and late INSERT. Unsealed legacy content
    always takes the full old digest path, regardless of optional-field presence.
    """
    from alethical.pipeline.election_finance_collection import collection_digest

    if collection.sealed_at is not None:
        expense_report_index(db, collection)
        expected = {
            row["report_key"]: row for row in collection.report_index["reports"]
        }
        keys = set(expected) if report_keys is None else set(report_keys)
        if not keys <= expected.keys():
            _unavailable()
        if not keys:
            return []
        fingerprint = literal_column(
            "encode(sha256(convert_to(payload::text, 'UTF8')), 'hex')"
        ).label("payload_fingerprint")
        rows = list(
            db.execute(
                select(m.ElectionFinanceReport, fingerprint)
                .where(
                    m.ElectionFinanceReport.collection_id == collection.id,
                    m.ElectionFinanceReport.report_key.in_(keys),
                )
                .execution_options(populate_existing=True)
            )
        )
        if len(rows) != len(keys) or any(
            item.payload_fingerprint
            != expected[item.ElectionFinanceReport.report_key]["payload_hash"]
            for item in rows
        ):
            _unavailable()
        return [item.ElectionFinanceReport for item in rows]
    reports = list(
        db.scalars(
            select(m.ElectionFinanceReport)
            .where(m.ElectionFinanceReport.collection_id == collection.id)
            .execution_options(populate_existing=True)
        )
    )
    if len(reports) != collection.coverage.get("reports"):
        _unavailable()
    restored = {
        "format": 1,
        "election_key": collection.election_key,
        "copied_at": collection.copied_at.isoformat(),
        "sources": collection.sources,
        "coverage": collection.coverage,
        "reports": [
            {
                "registration_number": row.registration_number,
                "report_key": row.report_key,
                "document_hash": row.document_hash,
                "payload": row.payload,
            }
            for row in reports
        ],
    }
    if collection_digest(restored) != collection.id:
        _unavailable()
    return (
        reports
        if report_keys is None
        else [r for r in reports if r.report_key in report_keys]
    )


def _review_ids(db, election_key, race_id):
    # Sequence allocation is not commit order. A lower ID can become visible
    # after a higher ID belonging to another independently locked account.
    # Every visible immutable decision participates, not only MAX(id).
    return list(
        db.scalars(
            select(m.ElectionCampaignAccountDecision.id)
            .where(
                m.ElectionCampaignAccountDecision.election_key == election_key,
                m.ElectionCampaignAccountDecision.race_id == race_id,
            )
            .order_by(m.ElectionCampaignAccountDecision.id)
        )
    )


def _version_token(
    snapshot_id,
    collection_id,
    review_ids,
    payments,
    account_state=None,
    outcome_version=None,
):
    return hashlib.sha256(
        json.dumps(
            [
                snapshot_id,
                collection_id,
                review_ids,
                payments,
                account_state,
                outcome_version,
            ]
        ).encode()
    ).hexdigest()[:16]


def _account_evidence_state(db, election_key, race):
    # A review can cite an older collection or supplemental source outside the
    # current report collection. Pin the same attribution and public locators
    # that readers use, not a second, narrower definition of retained evidence.
    state = []
    for candidate in race.payload["candidates"]:
        links = _accounts(db, election_key, race, candidate)
        state.append(
            {
                "candidate_id": candidate["candidate_id"],
                **links,
                "accounts": [
                    _public_account(db, account) for account in links["accounts"]
                ],
            }
        )
    return state


def _components(db, election_key, snapshot_id):
    collection, reports, payment, release = None, None, None, None
    report_state = {"state": "available", "reason": None}
    payment_state = {"state": "available", "reason": None}
    try:
        collection = _collection(db, election_key)
        reports = _held_reports(db, collection)
    except HTTPException as error:
        if error.status_code not in {404, 503}:
            raise
        report_state = {
            "state": "unavailable",
            "reason": "no_published_collection"
            if error.status_code == 404
            else "retained_report_sources_unavailable",
        }
    try:
        payment, release = outside._context(
            db,
            election_key=election_key,
            election_snapshot_id=snapshot_id,
            version=None,
            release_id=None,
        )
    except HTTPException as error:
        if error.status_code != 503:
            raise
        payment_state = {
            "state": "unavailable",
            "reason": "retained_payment_source_unavailable",
        }
    # The opaque revision includes availability, not just the source pointers.
    # A pruned source must invalidate a previously usable page too.
    collection_pointer = db.scalar(
        select(m.ElectionFinanceCurrent.collection_id).where(
            m.ElectionFinanceCurrent.election_key == election_key
        )
    )
    payment_version = finance_versions.current(db, "money")
    stamps = (
        {"id": collection_pointer, **report_state},
        {"version": payment_version, **payment_state},
    )
    return collection, reports, payment, release, report_state, payment_state, stamps


def _context(db, election_key, race_id, snapshot_id, version):
    election = results.snapshot(db, election_key, snapshot_id)
    if election.stage != "general":
        raise problem_exception(
            422,
            "Unsupported Election",
            "Financial report comparisons currently support general elections",
        )
    race = db.get(m.ElectionComparisonRace, (election.id, race_id))
    if race is None:
        _missing()
    collection, reports, payment, release, report_state, payment_state, stamps = (
        _components(db, election_key, election.id)
    )
    review_ids = _review_ids(db, election_key, race_id)
    outcome = applicable_outcomes(db, snapshot_id=election.id, race_ids=[race.id])[
        race.id
    ]
    token = _version_token(
        election.id,
        stamps[0],
        review_ids,
        stamps[1],
        _account_evidence_state(db, election_key, race),
        outcome["outcome_review"]["version"],
    )
    if version is not None and token != version:
        _changed()
    context = {
        "election_key": election_key,
        "race_id": race_id,
        "snapshot_id": election.id,
        "collection_id": collection.id if collection else None,
        "version": token,
        "result_status": outcome["result_status"],
        "outcome_review": outcome["outcome_review"],
        "review_decision_id": review_ids[-1] if review_ids else None,
        "report_availability": report_state,
        "outside_spending_availability": payment_state,
        "payment_release_id": payment["release_id"] if payment else None,
        "payment_version": stamps[1]["version"],
        "payment_source": payment["source"] if payment else None,
        "copied_at": collection.copied_at.isoformat() if collection else None,
        "currency": "USD",
        "complete_election_spending": False,
        "sources": [_source(source) for source in collection.sources]
        if collection
        else [],
        "coverage": {
            key: value
            for key, value in collection.coverage.items()
            if key != "candidates"
        }
        if collection
        else None,
    }
    return context, election, race, collection, reports, release, outcome


def _check_end_version(db, context):
    *_, stamps = _components(db, context["election_key"], context["snapshot_id"])
    review_ids = _review_ids(db, context["election_key"], context["race_id"])
    race = db.get(
        m.ElectionComparisonRace, (context["snapshot_id"], context["race_id"])
    )
    if race is None:
        _changed()
    outcome = applicable_outcomes(
        db, snapshot_id=context["snapshot_id"], race_ids=[race.id]
    )[race.id]
    token = _version_token(
        context["snapshot_id"],
        stamps[0],
        review_ids,
        stamps[1],
        _account_evidence_state(db, context["election_key"], race),
        outcome["outcome_review"]["version"],
    )
    if token != context["version"]:
        _changed()


def _public_account(db, account):
    fields = {
        "kind",
        "sha256",
        "url",
        "page",
        "lines",
        "collection_id",
        "source_row",
        "row_number",
        "locator",
    }
    evidence = []
    for item in account["evidence"]:
        public = {key: value for key, value in item.items() if key in fields}
        if item.get("collection_id"):
            collection = db.get(m.ElectionFinanceCollection, item["collection_id"])
            is_document = item.get("kind") in {"report_cover", "report_excerpt"}
            member = (
                db.scalar(
                    select(m.ElectionFinanceReport.report_key)
                    .join(
                        m.CampaignFinanceReportDocument,
                        m.ElectionFinanceReport.document_hash
                        == m.CampaignFinanceReportDocument.document_hash,
                    )
                    .where(
                        m.ElectionFinanceReport.collection_id == item["collection_id"],
                        m.ElectionFinanceReport.document_hash == item.get("sha256"),
                        m.ElectionFinanceReport.registration_number
                        == account["registration_number"],
                        m.CampaignFinanceReportDocument.registration_number
                        == account["registration_number"],
                    )
                    .limit(1)
                )
                is not None
                if is_document
                else collection is not None
                and any(
                    source.get("sha256") == item.get("sha256")
                    for source in collection.sources
                )
            )
            if (
                collection is not None
                and collection.first_published_at is not None
                and member
            ):
                public["source_election_key"] = collection.election_key
                public["source_state"] = "available"
                public["retained_source_url"] = (
                    f"/api/v1/finance/elections/{quote(collection.election_key, safe='')}/finance/sources/{quote(item['sha256'], safe='')}"
                    + ("?" if is_document else "/raw?")
                    + urlencode({"collection_id": collection.id})
                )
            else:
                public["source_state"] = "unavailable"
        evidence.append(public)
    # The reviewed register's name belongs to this exact account. Report-cover
    # names may differ and must not silently replace the registered name.
    names = {
        item["literal_fields"]["RegisteredEntityFullName"]
        for item in account["evidence"]
        if item.get("kind") == "committee_register"
        and isinstance(item.get("literal_fields"), dict)
        and item["literal_fields"].get("RegisteredEntityID")
        == account["registration_number"]
        and isinstance(item["literal_fields"].get("RegisteredEntityFullName"), str)
        and item["literal_fields"]["RegisteredEntityFullName"].strip()
    }
    return {
        **account,
        "committee_name": next(iter(names)) if len(names) == 1 else None,
        "evidence": evidence,
    }


def _accounts(db, election_key, race, candidate):
    if candidate.get("is_write_in_aggregate"):
        return {"state": "write_in_aggregate", "accounts": [], "gaps": []}
    return applicable_accounts(
        db, election_key=election_key, race=race, candidate=candidate
    )


def _report(db, election_key, race, candidate, account, report):
    payload = report.payload
    start, end = payload.get("period_start"), payload.get("period_end")
    attribution = "period_unavailable"
    if start and end:
        check = applicable_accounts(
            db,
            election_key=election_key,
            race=race,
            candidate=candidate,
            period_start=date.fromisoformat(start),
            period_end=date.fromisoformat(end),
        )
        attribution = (
            "checked"
            if any(
                a["decision_id"] == account["decision_id"] for a in check["accounts"]
            )
            else "period_not_covered"
        )
    figures = None
    if attribution == "checked" and payload.get("figure_status") == "source_verified":
        if not report.document_hash or not payload.get("figures"):
            _unavailable()
        original = payload["figures"]
        figures = {
            "contributions_received": original["contributions_received"],
            "campaign_expenditures": original["campaign_expenditures"],
            "all_disbursements": original["total_expenditures"],
        }
        if "public_subsidy_payments" in original:
            figures["public_subsidy_payments"] = original["public_subsidy_payments"]
    return {
        "report_key": report.report_key,
        "registration_number": report.registration_number,
        "filing": payload["filing"],
        "document_hash": report.document_hash,
        "document": _source(payload.get("document", {})),
        "catalogue_source": _source(payload.get("catalogue_source", {})),
        "financial_source": _source(payload.get("financial_source") or {}),
        "period_start": start,
        "period_end": end,
        "period_basis": payload.get("period_basis"),
        "received_date": payload.get("cover", {}).get("received_date"),
        "attribution": attribution,
        "figure_status": "source_verified" if figures else "unavailable",
        "source_figure_status": payload.get("figure_status"),
        "public_subsidy_gap": payload.get("public_subsidy_gap")
        or (
            None
            if figures and "public_subsidy_payments" in figures
            else "Public subsidy figure not held for this report"
        ),
        "figures": figures,
        "unavailable_reason": None
        if figures
        else payload.get("unavailable_reason") or attribution,
        "complete_election_spending": False,
    }


def _latest(reports, copied_at):
    eligible = [
        r
        for r in reports
        if not r["filing"]["special_election"]
        and r["filing"].get("cut_off_date")
        and r["filing"]["cut_off_date"] <= copied_at.date().isoformat()
        and r["filing"].get("effective_amendment_index") is not None
    ]
    if not eligible:
        return {"state": "no_held_report", "report_key": None, "figures": None}
    cutoff = max(report["filing"]["cut_off_date"] for report in eligible)
    eligible = [
        report for report in eligible if report["filing"]["cut_off_date"] == cutoff
    ]
    if len({report["filing"]["report_type"] for report in eligible}) > 1:
        return {"state": "ambiguous_latest_report", "report_key": None, "figures": None}

    def rank(report):
        return (
            report["filing"]["cut_off_date"],
            report["filing"]["effective_amendment_index"],
        )

    maximum = max(rank(r) for r in eligible)
    latest = [r for r in eligible if rank(r) == maximum]
    if len(latest) != 1:
        return {"state": "ambiguous_latest_report", "report_key": None, "figures": None}
    report = latest[0]
    return {
        "state": "reported" if report["figures"] else "unavailable",
        "report_key": report["report_key"],
        "figures": report["figures"],
        "period_start": report["period_start"],
        "period_end": report["period_end"],
    }


def _attribution_filters(release, year, accounts):
    scopes = [
        and_(
            R.affected_committee_reg_num == a["registration_number"],
            R.transaction_date >= date.fromisoformat(a["period_start"]),
            R.transaction_date <= date.fromisoformat(a["period_end"]),
        )
        for a in accounts
        if a["authority"] == "mn_cfb"
    ]
    return (
        [
            R.snapshot_id == release.independent_expenditures.snapshot_id,
            R.year == year,
            or_(*scopes),
        ]
        if scopes
        else [
            R.snapshot_id == release.independent_expenditures.snapshot_id,
            R.row_number < 0,
        ]
    )


def _outside(db, release, year, account_state):
    if release is None:
        return {
            "state": "unavailable",
            "groups": None,
            "total": None,
            "reason": "retained_payment_source_unavailable",
        }
    accounts = account_state["accounts"]
    if not accounts:
        return {"state": account_state["state"], "groups": [], "total": None}
    filters = _attribution_filters(release, year, accounts)
    category, direction = outside._category(), outside._direction()
    rows = (
        db.execute(
            select(
                category.label("category"),
                direction.label("direction"),
                *outside._measure_columns(),
            )
            .where(*filters)
            .group_by(category, direction)
            .order_by(category, direction)
        )
        .mappings()
        .all()
    )
    target = [
        R.snapshot_id == release.independent_expenditures.snapshot_id,
        R.affected_committee_reg_num.in_([a["registration_number"] for a in accounts]),
    ]
    return {
        "state": account_state["state"],
        "total": outside._aggregate(db, *filters),
        "groups": [
            {
                "category": row["category"],
                "direction": row["direction"],
                **outside._measures(row),
            }
            for row in rows
        ],
        "excluded_missing_date": outside._aggregate(
            db, *target, R.year == year, R.transaction_date.is_(None)
        ),
        "excluded_missing_year": outside._aggregate(db, *target, R.year.is_(None)),
        "excluded_outside_reviewed_period": outside._aggregate(
            db, *_outside_reviewed_period_filters(release, year, accounts)
        ),
        "scope": "Source reported calendar year and exact checked account dates",
        "complete_election_spending": False,
    }


def _outside_reviewed_period_filters(release, year, accounts):
    return [
        R.snapshot_id == release.independent_expenditures.snapshot_id,
        R.year == year,
        R.affected_committee_reg_num.in_(
            [a["registration_number"] for a in accounts if a["authority"] == "mn_cfb"]
        ),
        R.transaction_date.is_not(None),
        ~and_(*_attribution_filters(release, year, accounts)),
    ]


def _candidate_coverage(collection, race, candidate):
    if candidate.get("is_write_in_aggregate"):
        return {"state": "write_in_aggregate"}
    if collection is None:
        return {"state": "collection_unavailable"}
    stable_id = candidate.get("candidate_stable_id")
    if not stable_id:
        return {"state": "candidate_source_identity_unavailable"}
    matches = [
        row
        for row in collection.coverage.get("candidates", [])
        if row.get("stable_id") == stable_id
    ]
    if len(matches) > 1:
        return {"state": "ambiguous_coverage"}
    if not matches:
        return {"state": "not_in_collection_roster"}
    row = matches[0]
    if not row.get("source_sha256") or not race.payload.get("candidate_source_sha256"):
        return {"state": "roster_source_unavailable"}
    if row.get("source_sha256") != race.payload.get("candidate_source_sha256"):
        return {"state": "roster_version_mismatch"}
    # LocalCandTbl has no party column; local result files explicitly say NP.
    # Preserve both source values. This narrow allowance supplies filing-authority
    # coverage only and cannot confirm a candidate-to-account relationship.
    party_matches = row.get("party") == candidate.get("party") or (
        stable_id.startswith("local_cand:")
        and row.get("party") is None
        and candidate.get("party") == "NP"
    )
    if (
        row.get("candidate_id"),
        row.get("name"),
        row.get("office_id"),
        row.get("office"),
    ) != (
        candidate.get("candidate_id"),
        candidate.get("name"),
        race.office_id,
        race.payload.get("office_name"),
    ) or not party_matches:
        return {"state": "candidate_identity_mismatch"}
    fields = {
        "candidate_id",
        "stable_id",
        "county_id",
        "office_id",
        "office",
        "name",
        "party",
        "source_sha256",
        "source_row",
        "municipal_fips_code",
        "school_district_number",
        "authority",
        "authority_scope",
        "outside_support_scope",
        "link_state",
        "gap",
    }
    return {
        "state": "matched",
        "collection_id": collection.id,
        **{key: value for key, value in row.items() if key in fields},
    }


def comparison(db: Session, *, election_key, race_id, snapshot_id=None, version=None):
    context, election, race, collection, reports, release, outcome = _context(
        db, election_key, race_id, snapshot_id, version
    )
    candidates = []
    source_hashes = set()
    for candidate in race.payload["candidates"]:
        links = _accounts(db, election_key, race, candidate)
        candidate_coverage = _candidate_coverage(collection, race, candidate)
        report_state = (
            "unavailable"
            if reports is None
            else "not_collected"
            if not links["accounts"]
            and candidate_coverage.get("state") == "matched"
            and candidate_coverage.get("authority") in {"federal", "county_local"}
            and candidate_coverage.get("gap")
            else links["state"]
        )
        accounts = []
        for account in links["accounts"]:
            source_hashes.update(item.get("sha256") for item in account["evidence"])
            if reports is None:
                accounts.append(
                    {
                        **_public_account(db, account),
                        "reports": None,
                        "latest_report": {
                            "state": "unavailable",
                            "report_key": None,
                            "figures": None,
                        },
                    }
                )
                continue
            entries = [
                _report(db, election_key, race, candidate, account, report)
                for report in reports
                if report.registration_number == account["registration_number"]
                and account["authority"] == "mn_cfb"
            ]
            entries.sort(
                key=lambda r: (r["filing"].get("cut_off_date") or "", r["report_key"]),
                reverse=True,
            )
            source_hashes.update(
                entry[field].get("sha256")
                for entry in entries
                for field in ("catalogue_source", "financial_source", "document")
            )
            accounts.append(
                {
                    **_public_account(db, account),
                    "reports": entries,
                    "latest_report": _latest(entries, collection.copied_at),
                }
            )
        candidates.append(
            {
                **candidate,
                **outcome["candidates"][candidate["candidate_id"]],
                "account_state": links["state"],
                "account_gaps": links["gaps"],
                "accounts": accounts,
                "finance_coverage": candidate_coverage,
                "report_state": report_state,
                "outside_spending": _outside(
                    db, release, election.election_date.year, links
                ),
            }
        )
    context["sources"] = [
        source for source in context["sources"] if source.get("sha256") in source_hashes
    ]
    _check_end_version(db, context)
    return {
        **context,
        "race_id": race.id,
        "race_label": race.label,
        "candidates": candidates,
        "measure_note": "Each report keeps its own dates and totals; overlapping reports and accounts are not added together",
    }


def outside_records(
    db: Session,
    *,
    election_key,
    race_id,
    candidate_id,
    snapshot_id,
    version,
    limit,
    offset,
    spender_type=None,
    direction=None,
    scope="attributed",
):
    context, election, race, _, _, release, _ = _context(
        db, election_key, race_id, snapshot_id, version
    )
    candidate = next(
        (c for c in race.payload["candidates"] if c["candidate_id"] == candidate_id),
        None,
    )
    if candidate is None:
        _missing()
    if release is None:
        _unavailable()
    links = _accounts(db, election_key, race, candidate)
    source_hashes = {
        item.get("sha256")
        for account in links["accounts"]
        for item in account["evidence"]
    }
    context["sources"] = [
        source for source in context["sources"] if source.get("sha256") in source_hashes
    ]
    filters = (
        _outside_reviewed_period_filters
        if scope == "outside_reviewed_period"
        else _attribution_filters
    )(release, election.election_date.year, links["accounts"])
    if spender_type is not None:
        filters.append(outside._category() == spender_type)
    if direction is not None:
        filters.append(outside._direction() == direction)
    total = db.execute(select(func.count()).select_from(R).where(*filters)).scalar_one()
    rows = db.scalars(
        select(R).where(*filters).order_by(R.row_number).limit(limit).offset(offset)
    ).all()
    _check_end_version(db, context)
    return {
        **context,
        "candidate_id": candidate_id,
        "account_state": links["state"],
        "filters": {
            "spender_type": spender_type,
            "direction": direction,
            "scope": scope,
        },
        "rows": [
            {
                **outside._record(row),
                "resolution": "outside_checked_period"
                if scope == "outside_reviewed_period"
                else "checked_account_and_period",
            }
            for row in rows
        ],
        "page": {
            "total": total,
            "limit": limit,
            "offset": offset,
            "has_more": offset + len(rows) < total,
        },
    }


def source_pdf(db: Session, *, election_key, collection_id, document_hash):
    finance_versions.pin(db)
    collection = _collection(db, election_key, collection_id)
    report = db.scalar(
        select(m.ElectionFinanceReport)
        .where(
            m.ElectionFinanceReport.collection_id == collection.id,
            m.ElectionFinanceReport.document_hash == document_hash,
        )
        .limit(1)
    )
    if report is None:
        _missing()
    document = db.get(m.CampaignFinanceReportDocument, document_hash)
    if document is None:
        _unavailable()
    try:
        with tempfile.TemporaryDirectory(prefix="finance-report-read-") as directory:
            body = read_document(raw_file_store_from_env(), document, directory)
        if (
            len(body) != document.byte_size
            or hashlib.sha256(body).hexdigest() != document_hash
            or not body.startswith(b"%PDF")
        ):
            _unavailable()
    except Exception as error:
        # Storage adapters include cloud-provider exceptions. No internal object
        # key or provider detail belongs in an authenticated download response.
        raise problem_exception(
            503,
            "Service Unavailable",
            "This retained report is unavailable. Try again.",
        ) from error
    return body


def source_body(db: Session, *, election_key, collection_id, source_hash):
    finance_versions.pin(db)
    collection = _collection(db, election_key, collection_id)
    metadata = next(
        (
            source
            for source in collection.sources
            if source.get("sha256") == source_hash
        ),
        None,
    )
    if metadata is None:
        _missing()
    row = db.get(m.ElectionResultSource, source_hash)
    if row is None:
        _unavailable()
    try:
        body = read_source(raw_file_store_from_env(), row)
    except Exception as error:
        raise problem_exception(
            503,
            "Service Unavailable",
            "This retained source is unavailable. Try again.",
        ) from error
    return body, {**_source(metadata), "collection_id": collection.id}


def source_lines(
    db: Session, *, election_key, collection_id, source_hash, start, limit
):
    body, metadata = source_body(
        db,
        election_key=election_key,
        collection_id=collection_id,
        source_hash=source_hash,
    )
    encoding = (
        "windows-1252"
        if metadata.get("kind") in {"candidate_roster", "local_candidate_roster"}
        else "utf-8"
    )
    try:
        lines = body.decode(encoding, errors="strict").splitlines()
    except UnicodeDecodeError as error:
        raise problem_exception(
            503,
            "Service Unavailable",
            "The source text is unavailable. Download the original file.",
        ) from error
    return {
        "election_key": election_key,
        "collection_id": collection_id,
        "source": metadata,
        "encoding": encoding,
        "lines": [
            {"number": number, "text": line}
            for number, line in enumerate(
                islice(lines, start - 1, start - 1 + limit), start
            )
        ],
        "page": {
            "total": len(lines),
            "start": start,
            "limit": limit,
            "has_more": start - 1 + limit < len(lines),
        },
    }
