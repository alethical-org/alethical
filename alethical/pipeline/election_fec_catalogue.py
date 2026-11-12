"""FEC catalogue evidence for immutable filing identity and amendment metadata.

The raw filing supplies financial figures. This adapter supplies only metadata
the official filing catalogue actually records; it never certifies that a set of
pages is complete or that an account belongs to a Minnesota ballot candidacy.
"""

from __future__ import annotations

from datetime import date, datetime
from decimal import Decimal
import hashlib
import json
import re
from urllib.parse import parse_qsl, urlsplit

from alethical.pipeline.election_comparison import ComparisonImportError, digest
from alethical.pipeline.election_external_finance import CheckedExtraction


def _require(ok, message):
    if not ok:
        raise ComparisonImportError(message)


def report_key(committee_id: str, file_number: str) -> str:
    _require(bool(re.fullmatch(r"C[0-9]{8}", committee_id)), "Invalid FEC committee")
    _require(bool(re.fullmatch(r"[1-9][0-9]*", file_number)), "Invalid FEC file number")
    return digest(["fec", committee_id, file_number])


def _unique_object(items):
    result = {}
    for key, value in items:
        _require(key not in result, "Duplicate field in FEC source")
        result[key] = value
    return result


def _number(value):
    # A bool or a rounded JSON float cannot stand in for an official identifier.
    _require(type(value) in {str, int}, "FEC identifier must be an exact integer")
    value = str(value)
    _require(bool(re.fullmatch(r"[1-9][0-9]*", value)), "Invalid FEC identifier")
    return value


def _date(value):
    _require(isinstance(value, str), "Missing FEC report date")
    try:
        result = date.fromisoformat(value)
    except ValueError as error:
        raise ComparisonImportError("Invalid FEC report date") from error
    _require(result.isoformat() == value, "FEC date must retain its exact day")
    return value


def extract_catalogue(body: bytes, source: dict, locator: dict) -> CheckedExtraction:
    """Reconstruct one filing's metadata from a retained API response.

    Quote is a selected-field JSON extraction with the exact source values, not
    prose represented as a quotation. Locator is the source's unique sub_id.
    """
    parsed = urlsplit(source.get("url", ""))
    _require(
        source.get("authority") == "fec"
        and source.get("sha256") == hashlib.sha256(body).hexdigest()
        and parsed.scheme == "https"
        and parsed.hostname == "api.open.fec.gov"
        and parsed.path == "/v1/filings/"
        and parsed.port in {None, 443}
        and not parsed.username
        and not parsed.password
        and not parsed.fragment
        and not {key.lower() for key, _ in parse_qsl(parsed.query)}
        & {"api_key", "key", "token", "access_token"},
        "FEC catalogue needs its retained official source",
    )
    _require(
        set(locator) == {"kind", "sub_id"} and locator["kind"] == "filing",
        "FEC catalogue locator must identify one filing",
    )
    sub_id = _number(locator["sub_id"])
    try:
        payload = json.loads(
            body, parse_float=Decimal, object_pairs_hook=_unique_object
        )
        rows = payload["results"]
        _require(isinstance(rows, list), "FEC catalogue lacks result rows")
        matches = [row for row in rows if _number(row.get("sub_id")) == sub_id]
        _require(len(matches) == 1, "FEC catalogue row is missing or duplicated")
        row = matches[0]
        account = row["committee_id"]
        number = _number(row["file_number"])
        report_key(account, number)
        _require(row["form_type"] in {"F3", "F3X"}, "Unsupported FEC report form")
        start, end = _date(row["coverage_start_date"]), _date(row["coverage_end_date"])
        _require(start <= end, "FEC reporting dates are reversed")
        receipt = row["receipt_date"]
        _require(isinstance(receipt, str), "Missing FEC received date")
        received = datetime.fromisoformat(receipt).date().isoformat()
        report_type = row["report_type"]
        _require(
            isinstance(report_type, str)
            and bool(re.fullmatch(r"[A-Z0-9]{2,3}", report_type)),
            "Missing FEC report type",
        )
        chain = row["amendment_chain"]
        _require(
            isinstance(chain, list) and bool(chain),
            "FEC amendment chain is unavailable",
        )
        chain = [_number(item) for item in chain]
        version = row["amendment_version"]
        _require(
            len(chain) == len(set(chain))
            and chain[-1] == number
            and type(version) is int
            and version == len(chain) - 1,
            "FEC amendment chain does not identify this filing version",
        )
        previous = _number(row["previous_file_number"])
        _require(
            previous == (chain[-2] if len(chain) > 1 else number),
            "FEC predecessor conflicts with the explicit amendment chain",
        )
        latest = _number(row["most_recent_file_number"])
        effective, amended = row["most_recent"], row["is_amended"]
        _require(
            type(effective) is bool
            and type(amended) is bool
            and effective == (latest == number)
            and amended != effective,
            "FEC effective-filing fields disagree",
        )
        _require(
            row["amendment_indicator"] == ("A" if len(chain) > 1 else "N"),
            "FEC amendment indicator conflicts with its chain",
        )
        facts = {
            "authority": "fec",
            "account_id": account,
            "source_report_id": number,
            "series_id": f"fec:{account}:{chain[0]}",
            "report_type": f"{row['form_type']}:{report_type}",
            "period_start": start,
            "period_end": end,
            "received_date": received,
            "predecessor_report_key": report_key(account, previous)
            if len(chain) > 1
            else None,
            "effective": effective,
        }
        fields = (
            "sub_id",
            "committee_id",
            "file_number",
            "form_type",
            "report_type",
            "coverage_start_date",
            "coverage_end_date",
            "receipt_date",
            "amendment_chain",
            "amendment_version",
            "previous_file_number",
            "most_recent_file_number",
            "most_recent",
            "is_amended",
            "amendment_indicator",
        )
        quote = json.dumps(
            {key: row[key] for key in fields}, sort_keys=True, separators=(",", ":")
        )
        return CheckedExtraction(facts=facts, quote=quote)
    except (KeyError, TypeError, ValueError, AttributeError) as error:
        if isinstance(error, ComparisonImportError):
            raise
        raise ComparisonImportError(
            "FEC catalogue fields are incomplete or unsupported"
        ) from error
