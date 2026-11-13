"""Scalar CSV rows from the safe Board candidate-record projection only.

Native cash, unpaid, in-kind and total are separate measures, never PCC paid
arithmetic. The caller owns retained-source URL presentation and CSV escaping.
"""

import re

_MEASURES = ("cash", "unpaid", "in_kind", "total")
_LABELS = {
    "cash": "Cash",
    "unpaid": "Unpaid bills",
    "in_kind": "In-kind",
    "total": "Total",
}
_STATES = {
    "value": "Checked",
    "blank": "Blank in source",
    "ambiguous": "Unclear",
    "redacted": "Redacted in source",
    "unreadable": "Unreadable",
    "not_checked": "Not checked",
}


def _words(value):
    return value.replace("_", " ") if isinstance(value, str) else None


def _literal(field):
    return field["literal"] if field is not None else None


def _status(field):
    return _STATES[field["state"]] if field is not None else "Not checked"


def _reference(field):
    if field is None:
        return None
    bounds = ",".join(str(n) for n in field["bounds"])
    return f"{field['field_id']}; state={field['state']}; page={field['page']}; bounds={bounds}"


def _join(values):
    return "\n".join(v for v in values if v is not None and v != "")


def _money(field):
    if field["state"] != "value":
        return None
    return _decimal(field["normalized"])


def _decimal(value):
    # Numeric CSV columns intentionally bypass text escaping. Accept only the
    # exact decimal strings supplied by checked money fields, never formulas.
    if not isinstance(value, str) or not re.fullmatch(r"-?[0-9]+(?:\.[0-9]+)?", value):
        raise ValueError("Board CSV money needs an exact decimal string")
    return value


def _claim(value):
    return {
        "Candidate": value["name"],
        "Candidate ID": value["candidate_id"],
        "Race ID": value["race_id"],
        "Office": value["office"],
        "District": value["district"],
        "Official party": value["filed_party"],
        "Official party group": value["party_group"],
    }


def _source(metadata, retained_url, source_hash):
    return {
        "Source URL": retained_url,
        "Original URL": metadata["url"],
        "Source SHA256": source_hash,
        "Source copied at": metadata["copied_at"],
    }


def _record(record):
    return {
        "Authority": "Minnesota Campaign Finance and Public Disclosure Board",
        "Authority ID": record["record_id"],
        "Source references": f"Board candidate record {record['role']}:{record['record_id']}; year={record['year']}",
    }


def _context(report):
    source = report["source"]
    return {
        **_claim(report["claim"]),
        **_record(report),
        **_source(source, report["source_url"], report["source_sha256"]),
        "Report key": report["report_key"],
        "Report type": report["report_type"],
        "Report year": report["year"],
        "Report copied at": source["copied_at"],
        "Period start": report["period"]["start"],
        "Period end": report["period"]["end"],
        "Period basis": "Filed personal-expenditure report period",
        "Version scope": "Selected native personal report; cumulative reports are separate",
        "Amendment": report["amendment"],
        "Received date": _literal(report.get("received_date")),
    }


def _field_row(base, field):
    return {
        **base,
        "Figure status": _status(field),
        "Source pages": str(field["page"]),
        "Source references": _join([base["Source references"], _reference(field)]),
        "Source text": field["literal"],
        "Currency": field.get("currency"),
    }


def _payment_context(item):
    fields = item["fields"]
    address = {
        name: fields.get(name) for name in ("street", "city", "state", "postal_code")
    }
    return {
        "Source row ID": str(item["row"]),
        "Payee": _literal(fields["payee"]),
        "Payee status": _status(fields["payee"]),
        "Filed address": _join(_literal(f) for f in address.values()),
        **{
            f"Filed {name.replace('_', ' ')}": _literal(f)
            for name, f in address.items()
        },
        "Filed address status": _join(
            f"{name}={f['state']}" for name, f in address.items() if f is not None
        ),
        "Date": _literal(fields["date"]),
        "Purpose": _literal(fields["purpose"]),
        "Source references": _join(
            _reference(fields.get(name))
            for name in ("date", "payee", "purpose", *address)
        ),
    }


def csv_rows(data):
    """Yield existing-column rows without selecting, adding or escaping figures."""
    reports = data.get("personal_reports", [])
    selected = {(r["record_id"], r["year"]) for r in reports}
    candidates = {(c["race_id"], c["candidate_id"]): c for c in data["candidates"]}
    for record in data.get("board_candidate_records", []):
        if (record["record_id"], record["year"]) in selected:
            continue
        relationship = record.get("relationship")
        if not relationship:
            continue
        candidate = candidates[(relationship["race_id"], relationship["candidate_id"])]
        sources = record.get("sources") or {}
        for kind, source in sources.items():
            context = {**_claim(candidate), **_record(record)}
            gap = (
                (record.get("availability") or {}).get("state")
                if kind == "catalogue"
                else record.get("financial_status")
                if kind == "financial"
                else None
            )
            yield {
                **context,
                **_source(source, source["retained_source_url"], source["sha256"]),
                "Row type": "Board candidate record",
                "Metadata field": "Source kind",
                "Metadata value": kind,
                "Source references": _join([context["Source references"], kind]),
                "Figure status": "Source observation; no selected personal-report figures",
                "Gaps": _words(gap),
            }
    baseline = {
        (p["report_key"], str(p["row"])): p
        for p in data.get("personal_baseline_payments", [])
    }
    visible = {
        (p["report_key"], str(p.get("row", p.get("record_id"))))
        for p in data.get("payments", [])
    }
    excluded = set((data.get("filters") or {}).get("excluded_payee_ids", []))
    for report in reports:
        base = _context(report)
        for name in ("received_date", "certification_date"):
            field = report.get(name)
            if field is not None:
                yield {
                    **_field_row(base, field),
                    "Row type": "Board report field",
                    "Measure": name.replace("_", " ").capitalize(),
                    "Measure ID": field["field_id"],
                    "Unit": "date",
                }
        for key, kind, role in (
            ("measures", "Board report measure", "Report total"),
            ("nonitemized", "Board non-itemized measure", "Non-itemized"),
        ):
            for measure in _MEASURES:
                field = report[key][measure]
                yield {
                    **_field_row(base, field),
                    "Row type": kind,
                    "Measure": _LABELS[measure],
                    "Measure ID": measure,
                    "Basis": "Native personal-expenditure field",
                    "Amount role": role,
                    "Reported measure value": _money(field),
                    "Unit": "money",
                }
        if "itemized_before_exclusions" in report:
            totals = [item["fields"]["total"] for item in report["items"]]
            before, after = (
                report["itemized_before_exclusions"],
                report["itemized_after_exclusions"],
            )
            yield {
                **base,
                "Row type": "Board itemized subtotal",
                "Measure": "Itemized total",
                "Measure ID": "total",
                "Basis": "Calculated sum of native itemized total fields",
                "Amount role": "Calculated itemized subtotal",
                "Itemized before exclusions": _decimal(before)
                if before is not None
                else None,
                "Itemized after exclusions": _decimal(after)
                if after is not None
                else None,
                "Figure status": "Calculated"
                if before is not None
                else "Itemized subtotal unavailable",
                "Source pages": _join(dict.fromkeys(str(f["page"]) for f in totals)),
                "Source references": _join(
                    [base["Source references"], *(_reference(f) for f in totals)]
                ),
                "Currency": report["measures"]["total"].get("currency"),
                "Unit": "money",
            }
        for item in report["items"]:
            payment = _payment_context(item)
            key = report["report_key"], str(item["row"])
            if key in baseline:
                pid = baseline[key]["payee_id"]
                payment.update(
                    {
                        "Payee ID": pid,
                        "Excluded payee": "Yes" if pid in excluded else "No",
                    }
                )
                if "payments" in data:
                    payment["Included in filtered view"] = (
                        "Yes" if key in visible else "No"
                    )
            context = {
                **base,
                **payment,
                "Source references": _join(
                    [base["Source references"], payment["Source references"]]
                ),
            }
            for measure in _MEASURES:
                field = item["fields"][measure]
                yield {
                    **_field_row(context, field),
                    "Row type": "Board personal payment",
                    "Measure": _LABELS[measure],
                    "Measure ID": measure,
                    "Basis": "Native personal-expenditure field",
                    "Amount role": "Itemized",
                    "Reported payment amount": _money(field),
                    "Unit": "money",
                }
