"""Published Board candidate forms, without inventing campaign accounts.

Readers retain native personal-expenditure fields and their unknown states. A
source-only observation supplies neither a financial amount nor an account link.
"""

from copy import deepcopy
from collections import defaultdict
from typing import Any
from urllib.parse import quote, urlencode

from sqlalchemy import select

from alethical.api.services import election_finance_reads as finance
from alethical.api.problems import problem_exception
from alethical.db import models as m
from alethical.pipeline import election_board_candidate_records as board
from alethical.pipeline.election_comparison import digest


def source_url(election_key, collection_id, source_hash, *, pdf=False):
    return (
        f"/api/v1/finance/elections/{quote(election_key, safe='')}/finance/sources/{source_hash}"
        + ("" if pdf else "/raw")
        + "?"
        + urlencode({"collection_id": collection_id})
    )


def _field(value):
    if value is None:
        return None
    return {
        k: deepcopy(value[k])
        for k in (
            "field_id",
            "page",
            "bounds",
            "label",
            "literal",
            "state",
            "value_type",
            "normalized",
            "currency",
        )
        if k in value
    }


def _report(value, election_key, collection_id):
    return {
        "report_key": value["report_key"],
        "source_sha256": value["source_sha256"],
        "source_url": source_url(
            election_key, collection_id, value["source_sha256"], pdf=True
        ),
        "source": finance._source(value["source"]),
        "report_type": value["catalogue"]["report_type"],
        "amendment": value["catalogue"]["amendment"],
        "latest_amendment": value["latest_amendment"],
        "name": value["name"],
        "office": value["office"],
        "period": deepcopy(value["period"]),
        "received_date": _field(value["received_date"]),
        "certification_date": _field(value["certification_date"]),
        "measures": {k: _field(v) for k, v in value["measures"].items()},
        "nonitemized": {k: _field(v) for k, v in value["nonitemized"].items()},
        "items": [
            {
                "row": row["row"],
                "fields": {k: _field(v) for k, v in row["fields"].items()},
            }
            for row in value["items"]
        ],
    }


def project(proof, collection):
    """Strip private checking receipts before the API or CSV sees observations."""
    rows = []
    for value in proof.records:
        row = {k: value[k] for k in ("record_id", "year", "role")}
        if value.get("state") == "unavailable":
            rows.append(
                {**row, "state": "unavailable", "relationship": None, "reports": []}
            )
            continue
        relation = value["relationship"]
        row.update(
            state="checked",
            relationship=(
                {k: relation[k] for k in ("race_id", "candidate_id")}
                if relation
                else None
            ),
            availability={
                "state": value["availability"]["state"],
                "offered_reports": len(value["availability"]["reports"]),
            },
            financial_status=(
                value["financial"]["state"] if value["financial"] else None
            ),
            reports=[
                _report(report, collection.election_key, collection.id)
                for report in value["reports"]
            ],
            selected_report_key=value["selected_report_key"],
            sources={
                kind: {
                    **finance._source({**ref, "sha256": ref["source_sha256"]}),
                    "retained_source_url": source_url(
                        collection.election_key, collection.id, ref["source_sha256"]
                    ),
                }
                for kind, ref in value["sources"].items()
                if ref is not None
            },
        )
        rows.append(row)
    return {
        "collection_id": collection.id,
        "snapshot_id": collection.candidate_records["snapshot_id"],
        "version": proof.version,
        "report_keys": sorted(
            {
                report["report_key"]
                for record in collection.candidate_records["records"]
                for report in record["reports"]
            }
        ),
        "records": rows,
    }


def load(db, *, collection, snapshot_id, store):
    """Use the caller's already loaded, published collection in the pinned read."""
    if collection is None:
        return None
    section = collection.candidate_records
    if section is None:
        return None
    if section["snapshot_id"] != snapshot_id:
        return {
            "collection_id": collection.id,
            "snapshot_id": section["snapshot_id"],
            "version": digest([collection.id, snapshot_id, "snapshot_changed"]),
            "state": "snapshot_changed",
            "report_keys": sorted(
                {
                    report["report_key"]
                    for record in section["records"]
                    for report in record["reports"]
                }
            ),
            "records": [],
        }
    proof = board.load_verified_section(
        db,
        store,
        section,
        allowed_source_hashes={s["sha256"] for s in collection.sources},
        partial=True,
    )
    return project(proof, collection)


def join(data, bulk, *, report_keys=(), selected_only=False, excluded_payee_ids=()):
    """One cumulative report per linked candidate record; PCC totals stay exact."""
    if bulk is None:
        return data
    if bulk["collection_id"] != data["collection_id"]:
        finance._changed()
    known = set(bulk["report_keys"])
    requested = set(report_keys) & known
    candidates = {(c["race_id"], c["candidate_id"]): c for c in data["candidates"]}
    records, reports, accepted = [], [], set()
    for record in bulk["records"]:
        relation = record["relationship"]
        if not relation:
            continue
        key = relation["race_id"], relation["candidate_id"]
        if key not in candidates:
            continue
        candidate = candidates[key]
        choices = {r["report_key"]: r for r in record["reports"]}
        explicit = requested & choices.keys()
        if len(explicit) > 1:
            raise problem_exception(
                422, "Invalid Expense Query", "Select one report per candidate record"
            )
        selected_key = (
            next(iter(explicit))
            if explicit
            else None
            if selected_only
            else record["selected_report_key"]
        )
        chosen = choices.get(selected_key)
        if chosen and chosen["amendment"] != chosen["latest_amendment"]:
            raise problem_exception(
                422,
                "Invalid Expense Query",
                "Select the latest amendment of this report",
            )
        accepted.update(explicit)
        candidate.setdefault("board_record_ids", []).append(record["record_id"])
        claim = {
            k: deepcopy(candidate[k])
            for k in (
                "race_id",
                "candidate_id",
                "name",
                "filed_party",
                "party_group",
                "office",
                "district",
                "party_sources",
            )
        }
        records.append({**record, "selected_report_key": selected_key, "claim": claim})
        if chosen:
            reports.append(
                {
                    **chosen,
                    "record_id": record["record_id"],
                    "year": record["year"],
                    "role": record["role"],
                    "claim": claim,
                }
            )
    if accepted != requested:
        raise problem_exception(
            422,
            "Invalid Expense Query",
            "Selected candidate report is unavailable in this scope",
        )
    data["board_candidate_records"] = records
    data["personal_reports"] = reports
    if "filters" in data:
        _join_payments(data, reports, excluded_payee_ids)
    data["board_candidate_coverage"] = {
        "state": bulk.get("state", "checked"),
        "linked_records_in_scope": len(records),
        "selected_reports": len(reports),
        "unavailable_records": sum(
            r.get("state") == "unavailable" for r in bulk["records"]
        ),
        "unassociated_records": sum(
            r.get("state") != "unavailable" and r["relationship"] is None
            for r in bulk["records"]
        ),
    }
    data["version"] = digest(
        [
            data["version"],
            bulk["version"],
            sorted(requested),
            selected_only,
            sorted(set(excluded_payee_ids)),
        ]
    )[:16]
    return data


def _value(field):
    return field.get("normalized") if field and field.get("state") == "value" else None


def _binding(report, field):
    return {
        "source_sha256": report["source_sha256"],
        "locator": {
            "page": field["page"],
            "bounds": field["bounds"],
            "field": field["field_id"],
        },
        "quote": field["literal"],
        "source_copied_at": report["source"].get("copied_at"),
    }


def _identity(report, item):
    fields = item["fields"]
    name = _value(fields.get("payee"))
    address = {
        k: _value(fields.get(k)) for k in ("street", "city", "state", "postal_code")
    }
    # A partially redacted address cannot establish the same payee across rows.
    complete = all(address[k] for k in ("street", "city", "state", "postal_code"))
    identifier = (
        digest(
            [
                "mn-cfb-personal-payee-v1",
                name,
                address,
                None if complete else [report["report_key"], item["row"]],
            ]
        )
        if name
        else None
    )
    us = address["state"] in set(
        "AL AK AZ AR CA CO CT DE DC FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY AS GU MP PR VI".split()
    )
    return identifier, {
        "name": name,
        "address": {**address, "geography_status": "filed_us" if us else "unknown"},
        "field_states": {key: field["state"] for key, field in fields.items() if field},
        "source": [_binding(report, field) for field in fields.values() if field],
    }


def payee_ids(bulk):
    return {
        _identity(report, item)[0]
        for record in (bulk or {}).get("records", [])
        for report in record["reports"]
        for item in report["items"]
    } - {None}


def _join_payments(data, reports, excluded_payee_ids):
    # Use the same exact-decimal and filed-location helpers as existing reports.
    from alethical.api.services import election_expense_analytics as analytics

    rows: list[dict[str, Any]] = []
    for report in reports:
        for item in report["items"]:
            fields = item["fields"]
            pid, identity = _identity(report, item)
            rows.append(
                {
                    "authority": "mn_cfb",
                    "authority_name": "Minnesota Campaign Finance and Public Disclosure Board",
                    "subject_kind": "board_candidate_record",
                    "board_record_id": report["record_id"],
                    "record_id": str(item["row"]),
                    "row": item["row"],
                    "report_key": report["report_key"],
                    "claims": [report["claim"]],
                    "party_group": report["claim"]["party_group"],
                    "period_start": report["period"]["start"],
                    "period_end": report["period"]["end"],
                    "payee_id": pid,
                    "payee": identity,
                    "geography": analytics._geography(identity),
                    "date": _value(fields.get("date")),
                    "purpose": _value(fields.get("purpose")),
                    "field_states": {
                        key: field["state"] for key, field in fields.items() if field
                    },
                    "amounts": None,
                    "reported_amount": _value(fields.get("total")),
                    "currency": "USD",
                    "measure": "mn_cfb_personal_itemized_total",
                    "measure_label": "Personal expenditures",
                    "basis": "itemized_personal_expenditures",
                    "nonadditive": False,
                    "amount_role": "reported_payment",
                    "transaction_type": "personal_expenditure",
                    "underlying_vendor": None,
                    "relationship": "source_reported",
                    "source": [
                        _binding(report, field) for field in fields.values() if field
                    ],
                    "uncertainties": [
                        f"{key}_{field['state']}"
                        for key, field in fields.items()
                        if field and field["state"] != "value"
                    ],
                }
            )
    exclusions = set(excluded_payee_ids)
    available = (
        {p["payee_id"] for p in rows}
        | {p["payee_id"] for p in data.get("_csv_baseline_payments", data["payments"])}
        | {p["payee_id"] for p in data["excluded_payees"]}
    )
    if exclusions - available:
        raise problem_exception(
            422,
            "Invalid Expense Query",
            "An excluded payee is not in this source-backed report scope",
        )
    data["filters"]["excluded_payee_ids"] = sorted(exclusions)

    def amount(payments):
        return (
            None
            if any(p["reported_amount"] is None for p in payments)
            else analytics._exact_amount_sum(p["reported_amount"] for p in payments)
        )

    def measures(payments):
        grouped = defaultdict(list)
        for p in payments:
            grouped[p["report_key"]].append(p)
        return [
            {
                **{
                    k: ps[0][k]
                    for k in (
                        "authority",
                        "report_key",
                        "measure",
                        "basis",
                        "period_start",
                        "period_end",
                        "currency",
                    )
                },
                "label": "Personal expenditures",
                "amount": amount(ps),
                "unavailable_states": sorted(
                    {
                        p["field_states"].get("total", "not_checked")
                        for p in ps
                        if p["reported_amount"] is None
                    }
                ),
            }
            for ps in grouped.values()
        ]

    def groups(payments):
        grouped = defaultdict(list)
        for p in payments:
            grouped[p["payee_id"] or "unnamed:" + p["report_key"]].append(p)
        return [
            {
                "payee_id": ps[0]["payee_id"],
                "payee": group_identity(ps),
                "authority": "mn_cfb",
                "authority_name": ps[0]["authority_name"],
                "geography": analytics._geography(group_identity(ps)),
                "excludable": ps[0]["payee_id"] is not None,
                "report_keys": sorted({p["report_key"] for p in ps}),
                "purposes": sorted({p["purpose"] or "" for p in ps}),
                "purpose_unavailable_states": sorted(
                    {
                        p["field_states"].get("purpose", "not_checked")
                        for p in ps
                        if p["purpose"] is None
                    }
                ),
                "payment_count": len(ps),
                "amounts": None,
                "reported_amounts": measures(ps),
                "source": [b for p in ps for b in p["source"]],
            }
            for ps in grouped.values()
        ]

    def group_identity(payments):
        # Unidentified rows share a report group, never an inferred vendor or
        # the first row's address. Preserve only facts common to every row.
        identities = [p["payee"] for p in payments]
        if len(identities) == 1:
            return identities[0]

        def common(values, fallback=None):
            return values[0] if all(v == values[0] for v in values) else fallback

        fields = set().union(*(i["field_states"] for i in identities))
        address_keys = set().union(*(i["address"] for i in identities))
        address = {
            key: common([i["address"].get(key) for i in identities])
            for key in address_keys
        }
        if not address.get("state"):
            address["geography_status"] = "unknown"
        return {
            "name": common([i["name"] for i in identities]),
            "address": address,
            "field_states": {
                key: common([i["field_states"].get(key) for i in identities], "mixed")
                for key in fields
            },
            "source": [binding for i in identities for binding in i["source"]],
        }

    for report in reports:
        own = [p for p in rows if p["report_key"] == report["report_key"]]
        after = [p for p in own if p["payee_id"] not in exclusions]
        report["itemized_before_exclusions"] = amount(own) if own else None
        report["itemized_after_exclusions"] = amount(after) if own else None
        report["itemized_payment_count"] = len(own)
        report["itemized_unknown_amounts"] = sum(
            p["reported_amount"] is None for p in own
        )
        report["by_filed_address"] = (
            {
                geo: {
                    "before": amount([p for p in own if p["geography"] == geo]),
                    "after": amount([p for p in after if p["geography"] == geo]),
                }
                for geo in ("MN", "out_of_state", "unknown")
            }
            if own
            else None
        )
    filters = data["filters"]
    visible = [
        p
        for p in rows
        if p["payee_id"] not in exclusions
        and (not filters.get("geography") or p["geography"] == filters["geography"])
        and filters.get("payee_query", "").casefold()
        in ((p["payee"] or {}).get("name") or "").casefold()
    ]
    data["payees"].extend(groups(visible))
    data["payments"].extend(visible)
    for group in groups([p for p in rows if p["payee_id"] in exclusions]):
        group["account_reports"] = [
            {
                "subject_kind": "board_candidate_record",
                "board_record_id": report["record_id"],
                "report_key": report["report_key"],
                "claims": [report["claim"]],
                "reported_amounts": measures(
                    [
                        p
                        for p in rows
                        if p["report_key"] == report["report_key"]
                        and p["payee_id"] == group["payee_id"]
                    ]
                ),
            }
            for report in reports
            if report["report_key"] in group["report_keys"]
        ]
        data["excluded_payees"].append(group)
    data["payees"].sort(
        key=lambda p: (
            ((p["payee"] or {}).get("name") or "").casefold(),
            p["payee_id"] or "",
            p["report_keys"],
        )
    )
    data["payments"].sort(key=lambda p: (p["report_key"], str(p["record_id"])))
    data["personal_baseline_payments"] = rows


def pdf_member(db, collection, document_hash):
    """Historical published membership allows originals, never withdrawn figures."""
    section = collection.candidate_records
    if section is None or document_hash not in {
        s["sha256"] for s in collection.sources
    }:
        return False
    receipt_ids = {
        report["reading_receipt_id"]
        for record in section["records"]
        for report in record["reports"]
    }
    return (
        db.scalar(
            select(m.ElectionSourceReadingDecision.id)
            .where(
                m.ElectionSourceReadingDecision.receipt_sha256.in_(receipt_ids),
                m.ElectionSourceReadingDecision.schema_id == board.READING_SCHEMA,
                m.ElectionSourceReadingDecision.original_sha256 == document_hash,
            )
            .limit(1)
        )
        is not None
    )
