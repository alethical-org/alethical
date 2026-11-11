#!/usr/bin/env python3
"""Record an explicit source review; never confirm a generated name-match proposal.

The input is one complete record_decision request in JSON. Dry-run validates the
request shape only; execution rechecks retained evidence and the expected history
head in a transaction. No command changes a global filing publication.
"""

from __future__ import annotations

import argparse
from datetime import date
import inspect
import json
from pathlib import Path
import re
import sys

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from sqlalchemy import create_engine, select  # noqa: E402
from sqlalchemy.exc import SQLAlchemyError  # noqa: E402
from sqlalchemy.orm import Session  # noqa: E402

from alethical.db import models as m  # noqa: E402
from alethical.db.session import database_url_for_target, NO_PREPARED_STATEMENTS  # noqa: E402
from alethical.pipeline.election_account_reviews import record_decision  # noqa: E402
from alethical.pipeline.election_comparison import ComparisonImportError  # noqa: E402

HASH = re.compile(r"[a-f0-9]{64}\Z")
IDENTITY_FIELDS = {
    "candidate_source_id",
    "name",
    "party",
    "office_id",
    "office_name",
    "district",
    "jurisdiction",
}


def require(condition, message):
    if not condition:
        raise ComparisonImportError(message)


def _object(pairs):
    result = {}
    for key, value in pairs:
        require(key not in result, "Review JSON contains duplicate object fields")
        result[key] = value
    return result


def _invalid_constant(value):
    raise ComparisonImportError("Review JSON must use finite JSON values")


def _text(value, *, nonempty=True):
    return (
        isinstance(value, str)
        and "\x00" not in value
        and (not nonempty or bool(value.strip()))
    )


def _hash(value):
    return isinstance(value, str) and HASH.fullmatch(value) is not None


def _positive(value):
    return type(value) is int and value > 0


def read_request(path: Path) -> dict:
    try:
        value = json.loads(
            path.read_text(encoding="utf-8"),
            object_pairs_hook=_object,
            parse_constant=_invalid_constant,
        )
    except (OSError, UnicodeError) as error:
        raise ComparisonImportError(
            "Could not read the request as a UTF-8 JSON file"
        ) from error
    except json.JSONDecodeError as error:
        raise ComparisonImportError("Review request must contain valid JSON") from error
    require(isinstance(value, dict), "Review request must be an object")
    parameters = inspect.signature(record_decision).parameters
    allowed = set(parameters) - {"db"}
    required = {
        name
        for name, field in parameters.items()
        if name != "db" and field.default is inspect.Parameter.empty
    }
    require(
        not (set(value) - allowed or required - set(value)),
        "Review request fields differ from the review contract",
    )
    for key in ("snapshot_id", "race_id"):
        require(_hash(value[key]), f"{key} must be a complete lowercase SHA256")
    require(
        _text(value["candidate_id"]) and len(value["candidate_id"]) <= 64,
        "candidate_id must be a nonempty source identifier",
    )
    registration = value["registration_number"]
    require(
        _text(registration)
        and len(registration) <= 20
        and registration == registration.strip(),
        "registration_number must be the exact source registration string",
    )
    require(
        value["decision"] in ("confirmed", "rejected", "withdrawn"),
        "decision must be confirmed, rejected or withdrawn",
    )
    require(value.get("authority", "mn_cfb") == "mn_cfb", "authority must be mn_cfb")
    for key in ("reason", "reviewed_by"):
        require(_text(value[key]), f"{key} must be nonempty text")
    previous = value["expected_previous_id"]
    require(
        previous is None or _positive(previous),
        "expected_previous_id must be a positive integer or null",
    )
    require(
        value["decision"] != "withdrawn" or previous is not None,
        "Withdrawal requires expected_previous_id",
    )
    identity = value["identity"]
    require(
        isinstance(identity, dict) and set(identity) == IDENTITY_FIELDS,
        "identity must contain the exact source identity fields",
    )
    for key in IDENTITY_FIELDS:
        require(
            (key == "district" and identity[key] is None)
            or _text(identity[key], nonempty=key not in {"party", "district"}),
            f"identity.{key} has the wrong type",
        )
    require(
        identity["candidate_source_id"] == value["candidate_id"],
        "identity.candidate_source_id differs from candidate_id",
    )
    for key in ("period_start", "period_end"):
        raw = value[key]
        require(
            isinstance(raw, str)
            and re.fullmatch(r"\d{4}-\d{2}-\d{2}", raw) is not None,
            f"{key} must be a date in YYYY-MM-DD form",
        )
        try:
            value[key] = date.fromisoformat(raw)
        except ValueError as error:
            raise ComparisonImportError(
                f"{key} must be a real calendar date"
            ) from error
    require(
        value["period_start"] <= value["period_end"]
        and value["period_start"].year == value["period_end"].year,
        "Attribution dates must be ordered within one calendar year",
    )
    compatible = value.get("compatible_decision_ids")
    require(
        compatible is None
        or isinstance(compatible, list)
        and all(_positive(item) for item in compatible),
        "compatible_decision_ids must be a list of positive integers or null",
    )
    require(
        not compatible or value["decision"] == "confirmed",
        "Compatibility belongs to a confirmation",
    )
    evidence = value["evidence"]
    require(
        isinstance(evidence, list)
        and bool(evidence)
        and all(isinstance(item, dict) for item in evidence),
        "evidence must be a nonempty list of source objects",
    )
    for item in evidence:
        require(
            _text(item.get("kind")) and _hash(item.get("sha256")),
            "Each evidence source needs a kind and complete lowercase SHA256",
        )
        if item["kind"] == "report_cover":
            require(
                _positive(item.get("page")),
                "Report-cover evidence needs a positive page number",
            )
        if item["kind"] in {"committee_register", "candidate_identity"}:
            require(
                _hash(item.get("collection_id")),
                f"{item['kind']} evidence needs a collection SHA256",
            )
        if item["kind"] == "same_person":
            ids = item.get("decision_ids")
            require(
                isinstance(ids, list)
                and bool(ids)
                and all(_positive(identifier) for identifier in ids),
                "Same-person evidence needs positive decision IDs",
            )
    require(
        value["decision"] != "confirmed"
        or {"ballot", "committee_register", "report_cover"}
        <= {item["kind"] for item in evidence},
        "Confirmation needs ballot, committee-register and report-cover evidence",
    )
    return value


def execute_request(request, target):
    engine = create_engine(
        database_url_for_target(target), connect_args=NO_PREPARED_STATEMENTS
    )
    try:
        with Session(engine) as db, db.begin():
            row = record_decision(db, **request)
            current_id = db.scalar(
                select(m.ElectionCampaignAccountDecision.id)
                .where(
                    m.ElectionCampaignAccountDecision.election_key == row.election_key,
                    m.ElectionCampaignAccountDecision.authority == row.authority,
                    m.ElectionCampaignAccountDecision.race_id == row.race_id,
                    m.ElectionCampaignAccountDecision.candidate_id == row.candidate_id,
                    m.ElectionCampaignAccountDecision.registration_number
                    == row.registration_number,
                )
                .order_by(m.ElectionCampaignAccountDecision.id.desc())
                .limit(1)
            )
            receipt = {
                "executed": True,
                "source_validation": "retained_source_references_and_supplied_quotes_checked",
                "decision_id": row.id,
                "previous_decision_id": row.previous_decision_id,
                "current_decision_id": current_id,
                "history_status": "current" if row.id == current_id else "superseded",
            }
        return receipt
    finally:
        engine.dispose()


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--request", type=Path, required=True)
    parser.add_argument("--target", choices=("local", "production"), default="local")
    parser.add_argument("--execute", action="store_true")
    args = parser.parse_args(argv)
    try:
        request = read_request(args.request)
        receipt = {
            "executed": False,
            "source_validation": "not_run",
            "decision": request["decision"],
            "race_id": request["race_id"],
            "candidate_id": request["candidate_id"],
            "registration_number": request["registration_number"],
            "authority": request.get("authority", "mn_cfb"),
        }
        if args.execute:
            receipt.update(execute_request(request, args.target))
    except (ComparisonImportError, ValueError, TypeError) as error:
        print(f"Review not recorded: {error}", file=sys.stderr)
        return 2
    except SQLAlchemyError:
        # Driver errors may contain credentials, SQL parameters and private notes.
        print(
            "Review not recorded: Database operation failed; no success receipt was issued",
            file=sys.stderr,
        )
        return 2
    print(json.dumps(receipt, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
