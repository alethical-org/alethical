"""Immutable external finance evidence with explicit, source-specific checks.

No acquisition or permissive extraction fallback. Registered trusted code adapters
reconstruct semantic facts from retained original bytes. Typed requests and OCR
remain proposals until an adapter verifies the exact fields and quotation.
"""

from __future__ import annotations

from copy import deepcopy
from dataclasses import dataclass
from datetime import UTC, date, datetime, timedelta
from decimal import Decimal
import hashlib
import json
import re
from urllib.parse import parse_qsl, urlsplit

from sqlalchemy import cast, func, or_, select, text, tuple_
from sqlalchemy.dialects.postgresql import JSONPATH, insert
from sqlalchemy.orm import defer

from alethical.db import models as m
from alethical.pipeline.election_comparison import (
    ComparisonImportError,
    archive_source,
    digest,
    read_source,
)
from alethical.pipeline.candidate_catalogue import (
    ElectionContext,
    parse_candidate_catalogue,
    parse_local_candidate_catalogue,
)
from alethical.pipeline.election_finance_collection import _coverage

STATUSES = {
    "not_collected",
    "retrieval_failed",
    "unreadable",
    "unmatched",
    "source_conflict",
    "catalogue_checked_not_found",
    "confirmed_not_published",
    "below_threshold_certified",
    "not_due",
    "checked",
    "unchecked",
}
OPERATIONAL_COVERAGE = {"not_collected", "retrieval_failed", "unmatched", "unchecked"}
FACTUAL_COVERAGE = STATUSES - OPERATIONAL_COVERAGE
REPORT_STATUSES = OPERATIONAL_COVERAGE | {"checked", "unreadable", "source_conflict"}

DIRECTIONS = {
    "direct_contribution",
    "independent_for",
    "independent_against",
    "coordinated_party",
    "communication_cost",
    "electioneering",
    "other",
    "unknown",
}
ADAPTERS = {}


@dataclass(frozen=True)
class CheckedExtraction:
    facts: dict
    quote: str


def require(condition, message):
    if not condition:
        raise ComparisonImportError(message)


def register_adapter(name, callback):
    """Install trusted application code, never a name imported from input JSON."""
    require(
        isinstance(name, str) and bool(re.fullmatch(r"[a-z0-9_.-]+:v[0-9]+", name)),
        "Adapter needs a versioned identifier",
    )
    require(
        callable(callback) and name not in ADAPTERS,
        "Adapter already registered or invalid",
    )
    ADAPTERS[name] = callback


def fingerprint(value):
    return isinstance(value, str) and re.fullmatch(r"[a-f0-9]{64}", value) is not None


def exact_money(value):
    require(
        isinstance(value, str)
        and re.fullmatch(r"-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?", value) is not None,
        "Money must be an exact decimal string",
    )
    require(Decimal(value).is_finite(), "Money must be finite")
    return value


def ordered_period(item, *, optional=False):
    start, end = item.get("period_start"), item.get("period_end")
    if optional and start is None and end is None:
        return None
    try:
        require(
            isinstance(start, str) and isinstance(end, str), "Period needs both dates"
        )
        require(
            date.fromisoformat(start).isoformat() == start
            and date.fromisoformat(end).isoformat() == end
            and start <= end,
            "Invalid reporting period",
        )
    except ValueError as exc:
        raise ComparisonImportError("Invalid reporting period") from exc
    return start, end


class SealedFinanceReadView(dict):
    """An immutable-row projection, never a complete publication payload."""

    def __init__(self, values, *, scope_key):
        super().__init__(values)
        self.scope_key = scope_key
        self["_read_scope"] = scope_key


class PublishedFinanceReadView(SealedFinanceReadView):
    """Current published records, with public read scope applied."""


class HistoricalFinanceReadView(SealedFinanceReadView):
    """Sealed review dependencies; publication/attribution is not implied."""


def generation_digest(generation):
    require(
        not isinstance(generation, SealedFinanceReadView)
        and "_read_scope" not in generation,
        "A sealed read view cannot identify a complete generation",
    )
    value = {k: v for k, v in generation.items() if k not in {"id", "copied_at"}}
    for field, key in [
        ("sources", lambda r: r["sha256"]),
        ("authorities", lambda r: r["key"]),
        ("accounts", lambda r: (r["authority"], r["account_id"])),
        ("reports", lambda r: r["report_key"]),
        ("payments", lambda r: r["payment_key"]),
        ("coverage", lambda r: r["stable_id"]),
    ]:
        value[field] = sorted(value[field], key=key)
    return digest(value)


def prepare_generation(payload):
    result = deepcopy(payload)
    result["id"] = generation_digest(result)
    validate_generation(result)
    return result


def report_facts(report):
    return {
        k: report.get(k)
        for k in (
            "authority",
            "account_id",
            "source_report_id",
            "series_id",
            "report_type",
            "period_start",
            "period_end",
            "received_date",
            "predecessor_report_key",
            "effective",
        )
    }


def account_facts(account):
    return {
        k: account.get(k)
        for k in (
            "authority",
            "account_id",
            "name",
            "source_candidate_id",
            "candidate_name",
            "issued_id",
            "reviewed_key_basis",
            "jurisdiction",
        )
    }


def payment_facts(payment):
    facts = {
        k: payment.get(k)
        for k in (
            "authority",
            "account_id",
            "source_row_id",
            "source_report_id",
            "date",
            "target_source_candidate_id",
            "payee",
            "purpose",
            "amount",
            "currency",
            "direction",
            "transaction_type",
            "memo",
        )
    }

    if "payee_address" in payment:
        facts["payee_address"] = payment["payee_address"]
    return facts


def supplemental_memo(payment):
    """FEC's source-marked explanatory detail is not another disbursement.

    A reimbursed purchase can precede the report containing the reimbursement.
    The literal flag is verified with every other payment fact against the
    retained original. Other authorities and free-form memo text get no such
    meaning. See FEC's credit-card and staff-reimbursement reporting guidance.
    """
    memo = payment.get("memo")
    return (
        payment.get("authority") == "fec"
        and isinstance(memo, dict)
        and memo.get("code") == "X"
    )


def authority_facts(authority):
    return {k: authority[k] for k in ("key", "name", "jurisdiction", "publisher_url")}


def coverage_facts(row):
    return {
        key: row.get(key)
        for key in ("stable_id", "candidate_id", "source_sha256", "authority", "status")
    }


def validate_generation(g):
    require(
        not isinstance(g, SealedFinanceReadView),
        "A sealed read view cannot be staged or published",
    )
    try:
        require(
            set(g)
            == {
                "format",
                "id",
                "election_key",
                "snapshot_id",
                "copied_at",
                "sources",
                "authorities",
                "accounts",
                "reports",
                "payments",
                "coverage",
            },
            "Generation fields differ from the external finance contract",
        )
        require(
            g["format"] == 1
            and g["id"] == generation_digest(g)
            and fingerprint(g["snapshot_id"]),
            "External generation fingerprint changed",
        )
        require(
            datetime.fromisoformat(g["copied_at"]).tzinfo is not None,
            "Copy time needs a timezone",
        )
        json.dumps(g, allow_nan=False)
        sources = {r["sha256"]: r for r in g["sources"]}
        require(
            bool(sources) and len(sources) == len(g["sources"]),
            "Duplicate or missing original sources",
        )
        authorities = {r["key"]: r for r in g["authorities"]}
        require(len(authorities) == len(g["authorities"]), "Duplicate authority")
        for source in sources.values():
            parsed = urlsplit(source["url"])
            require(
                fingerprint(source["sha256"])
                and parsed.scheme in {"http", "https"}
                and bool(parsed.hostname)
                and not parsed.username
                and not parsed.password,
                "Invalid original source identity",
            )
            require(
                not {key.lower() for key, _ in parse_qsl(parsed.query)}
                & {"api_key", "access_token", "token", "key"},
                "Credentials cannot be retained in a source URL",
            )
            require(
                source.get("authority") in {*authorities, None}
                and isinstance(source["media_type"], str),
                "Source authority is not in this generation",
            )
            require(
                datetime.fromisoformat(source["copied_at"]).tzinfo is not None,
                "Source copy time needs a timezone",
            )
        for authority in authorities.values():
            require(
                authority["key"] != "mn_cfb"
                and (authority["key"] == "fec" or authority["key"].startswith("local:"))
                and len(authority["key"]) <= 160,
                "External authority needs its explicit namespace",
            )
            require(
                authority["status"] in {"checked", "unchecked"}
                and all(
                    isinstance(authority.get(k), str) and authority[k].strip()
                    for k in ("name", "publisher_url")
                )
                and bool(authority.get("jurisdiction")),
                "Authority needs publisher identity",
            )
        accounts = {(r["authority"], r["account_id"]): r for r in g["accounts"]}
        require(len(accounts) == len(g["accounts"]), "Duplicate account identity")
        for account in accounts.values():
            require(
                account["authority"] in authorities
                and isinstance(account["account_id"], str)
                and 0 < len(account["account_id"]) <= 160
                and account["account_id"].strip() == account["account_id"],
                "Account needs an exact source or reviewed scoped identifier",
            )
            require(
                account["status"] in {"checked", "unchecked"},
                "Invalid account check status",
            )
            ordered_period(account, optional=True)
            require(
                type(account["issued_id"]) is bool
                and (account["issued_id"] or bool(account.get("reviewed_key_basis"))),
                "A local account without issued ID needs a reviewed scoped key basis",
            )
        reports = {r["report_key"]: r for r in g["reports"]}
        require(len(reports) == len(g["reports"]), "Duplicate report identity")
        effective = set()
        for report in reports.values():
            require(
                fingerprint(report["report_key"])
                and (report["authority"], report["account_id"]) in accounts
                and report["check_status"] in REPORT_STATUSES,
                "Invalid report account or status",
            )
            require(
                isinstance(report["source_report_id"], str)
                and bool(report["source_report_id"])
                and isinstance(report["series_id"], str)
                and bool(report["series_id"])
                and type(report["effective"]) is bool,
                "Report needs its actual source series and version",
            )
            require(
                report.get("source_sha256") in sources
                or (
                    report.get("source_sha256") is None
                    and report["check_status"] in OPERATIONAL_COVERAGE
                ),
                "Report original is not retained",
            )
            operational = report["check_status"] in OPERATIONAL_COVERAGE
            if report["check_status"] != "checked":
                require(
                    isinstance(report.get("next_action"), str)
                    and report["next_action"].strip(),
                    "Report gap needs an explicit next action",
                )
            if report["check_status"] in {"unreadable", "source_conflict"}:
                require(
                    report.get("binding") and report.get("status_binding"),
                    "Factual report state needs checked identity and status evidence",
                )
            if report["check_status"] not in {"unreadable", "source_conflict"}:
                require(
                    report.get("status_binding") is None,
                    "Report status evidence is only supported for factual unreadable/conflict states",
                )
            ordered_period(report, optional=operational and not report.get("binding"))
            if report["effective"]:
                series = (
                    report["authority"],
                    report["account_id"],
                    report["series_id"],
                )
                require(
                    series not in effective,
                    "An amendment series cannot have multiple effective reports",
                )
                effective.add(series)
            prior = report.get("predecessor_report_key")
            visited = {report["report_key"]}
            while prior is not None:
                require(
                    prior in reports and prior not in visited,
                    "Missing or cyclic report amendment predecessor",
                )
                parent = reports[prior]
                require(
                    all(
                        parent[k] == report[k]
                        for k in ("authority", "account_id", "series_id", "report_type")
                    )
                    and not parent["effective"],
                    "Amendment predecessor belongs to a different or effective series",
                )
                visited.add(prior)
                prior = parent.get("predecessor_report_key")
            figures = report.get("figures")
            if report["check_status"] == "checked":
                require(
                    report.get("binding"), "Checked report needs exact source identity"
                )
            if report["check_status"] != "checked":
                require(
                    figures in (None, []),
                    "Unchecked or conflicting reports cannot supply checked figures",
                )
            else:
                require(
                    isinstance(figures, list),
                    "Checked report figures need their source measures",
                )
                require(
                    len({r["measure"] for r in figures}) == len(figures),
                    "Duplicate report measure",
                )
                for figure in figures:
                    exact_money(figure["value"])
                    require(
                        all(
                            isinstance(figure[k], str) and bool(figure[k].strip())
                            for k in ("measure", "label", "unit", "currency")
                        ),
                        "Figure needs actual source label and units",
                    )
                    ordered_period(figure)
        rows = set()
        for payment in g["payments"]:
            require(
                fingerprint(payment["payment_key"])
                and payment["report_key"] in reports
                and payment["check_status"]
                in {"checked", "unchecked", "source_conflict", "unreadable"},
                "Payment needs its exact source report",
            )
            report = reports[payment["report_key"]]
            require(
                all(
                    payment[k] == report[k]
                    for k in ("authority", "account_id", "source_report_id")
                )
                and payment["source_sha256"] in sources,
                "Payment source account differs from its report",
            )
            row = (
                payment["authority"],
                payment["source_sha256"],
                payment["source_row_id"],
            )
            require(row not in rows, "Duplicate source payment row")
            rows.add(row)
            require(
                payment["direction"] in DIRECTIONS
                and isinstance(payment["transaction_type"], str)
                and bool(payment["transaction_type"]),
                "Payment needs an explicit direction and transaction type",
            )
            if "payee_address" in payment:
                address = payment["payee_address"]
                require(
                    isinstance(address, dict)
                    and set(address)
                    == {"street_1", "street_2", "city", "state", "postal_code"}
                    and all(
                        v is None
                        or (
                            isinstance(v, str)
                            and len(v) <= 200
                            and not any(ord(c) < 32 and c != "\t" for c in v)
                        )
                        for v in address.values()
                    ),
                    "Payment address must contain exact source fields",
                )
            if payment["check_status"] == "checked":
                exact_money(payment["amount"])
                require(
                    report["check_status"] == "checked"
                    and isinstance(payment["date"], str)
                    and date.fromisoformat(payment["date"]).isoformat()
                    == payment["date"]
                    and payment["date"] <= report["period_end"]
                    and (
                        report["period_start"] <= payment["date"]
                        or supplemental_memo(payment)
                    ),
                    "Payment needs checked report dates",
                )
            else:
                require(
                    payment.get("amount") is None,
                    "Unchecked payment money stays in private proposal metadata",
                )
        require(
            len({p["payment_key"] for p in g["payments"]}) == len(g["payments"]),
            "Duplicate payment identity",
        )
        require(
            len({r["stable_id"] for r in g["coverage"]}) == len(g["coverage"]),
            "Duplicate candidate coverage",
        )
        for row in g["coverage"]:
            require(
                row["status"] in STATUSES
                and isinstance(row["next_action"], str)
                and bool(row["next_action"].strip())
                and row.get("authority") in {*authorities, None},
                "Every candidacy needs an explicit coverage state and next action",
            )
            if row["status"] in FACTUAL_COVERAGE:
                require(
                    row.get("binding") and row.get("authority") in authorities,
                    "Factual coverage needs checked authority/source evidence",
                )
    except (KeyError, TypeError, AttributeError, ValueError) as error:
        if isinstance(error, ComparisonImportError):
            raise
        raise ComparisonImportError(
            "External generation has invalid or incomplete fields"
        ) from error


class _VerifiedBodies(dict):
    def __init__(self, sources):
        super().__init__()
        self.sources = sources


def source_bodies(db, store, generation):
    bodies = _VerifiedBodies({r["sha256"]: r for r in generation["sources"]})
    for source in generation["sources"]:
        row = db.get(m.ElectionResultSource, source["sha256"])
        require(row is not None, "Original source is not retained")
        try:
            bodies[source["sha256"]] = read_source(store, row)
        except Exception as exc:
            raise ComparisonImportError(
                "Retained external original is unavailable or changed"
            ) from exc
    return bodies


def _validate_binding(generation, bodies, binding, expected, *, authority=None):
    require(isinstance(binding, dict), "Checked claim needs an exact source binding")
    require(
        set(binding) == {"source_sha256", "adapter", "locator", "quote", "facts"},
        "Unsupported extraction binding fields",
    )
    sources = getattr(bodies, "sources", None)
    if sources is None:
        sources = {r["sha256"]: r for r in generation["sources"]}
    source = sources.get(binding["source_sha256"])
    require(
        source is not None and binding["source_sha256"] in bodies,
        "Binding source is outside this generation",
    )
    assert source is not None  # The source membership requirement above passed.
    require(
        authority is None or source.get("authority") == authority,
        "Binding belongs to a different filing authority",
    )
    adapter = ADAPTERS.get(binding["adapter"])
    require(adapter is not None, "No supported checked extraction adapter")
    assert adapter is not None
    require(
        isinstance(binding["quote"], str)
        and bool(binding["quote"].strip())
        and isinstance(binding["locator"], dict),
        "Binding needs a literal quote and exact locator",
    )
    try:
        actual = adapter(
            bodies[binding["source_sha256"]],
            deepcopy(source),
            deepcopy(binding["locator"]),
        )
    except Exception as exc:
        raise ComparisonImportError(
            "Source adapter could not verify this extraction"
        ) from exc
    require(
        isinstance(actual, CheckedExtraction)
        and actual.facts == expected == binding["facts"]
        and actual.quote == binding["quote"],
        "Extracted fields or quote differ from retained original",
    )


def bindings(value):
    return value if isinstance(value, list) else [value]


def validate_binding(
    generation, bodies, binding, expected, *, authority=None, joins=()
):
    """Every source identifies the same entity; subsets cover every claim field."""
    covered = set()
    for item in bindings(binding):
        require(
            isinstance(item, dict) and isinstance(item.get("facts"), dict),
            "Missing checked source binding",
        )
        facts = item["facts"]
        require(
            bool(facts) and set(joins) <= set(facts) <= set(expected),
            "Binding does not identify this exact entity",
        )
        require(
            all(expected[k] == v for k, v in facts.items()),
            "Binding fields differ from this claim",
        )
        _validate_binding(generation, bodies, item, facts, authority=authority)
        covered.update(facts)
    require(
        covered == set(expected), "Claim contains fields with no checked source binding"
    )


def bound_to(value, source_hash):
    return any(
        isinstance(b, dict) and b.get("source_sha256") == source_hash
        for b in bindings(value)
    )


def expected_coverage(snapshot, races, bodies):
    """Reuse actual SOS parsing/routing; never infer jurisdiction from a name."""
    stable_ids = {
        c.get("candidate_stable_id")
        for race in races
        for c in race.payload["candidates"]
        if not c.get("is_write_in_aggregate")
    }
    election_ids = {
        s.split(":")[1]
        for s in stable_ids
        if isinstance(s, str) and s.startswith(("cand:", "local_cand:"))
    }
    require(len(election_ids) == 1, "Snapshot needs its exact source election identity")
    rosters = []
    for filename, parser, kind in [
        ("cand.txt", parse_candidate_catalogue, "cand"),
        ("LocalCandTbl.txt", parse_local_candidate_catalogue, "local_cand"),
    ]:
        sources = [
            s
            for s in snapshot.sources
            if s.get("file") == filename or s["url"].endswith("/" + filename)
        ]
        require(
            len(sources) == 1 and sources[0]["sha256"] in bodies,
            "Full external coverage needs both retained ballot rosters",
        )
        source = sources[0]
        rosters.append(
            parser(
                bodies[source["sha256"]],
                election=ElectionContext(
                    next(iter(election_ids)),
                    snapshot.election_date,
                    snapshot.stage,
                    source["url"],
                    "unverified",
                    source_kind="cand" if kind == "cand" else "local_cand",
                ),
                fetched_at=snapshot.fetched_at,
            )
        )
    return [
        {
            "stable_id": r["stable_id"],
            "candidate_id": r["candidate_id"],
            "name": r["name"],
            "office_id": r["office_id"],
            "office": r["office"],
            "party": r["party"],
            "source_sha256": r["source_sha256"],
            "authority_family": r["authority"],
            "county_id": r["county_id"],
            "municipal_fips_code": r["municipal_fips_code"],
            "school_district_number": r["school_district_number"],
        }
        for r in _coverage(rosters, [])["candidates"]
        if r["authority"] in {"federal", "county_local"}
    ]


def verify_evidence(db, store, g):
    validate_generation(g)
    snapshot = db.get(m.ElectionComparisonSnapshot, g["snapshot_id"])
    require(
        snapshot is not None and snapshot.election_key == g["election_key"],
        "External generation belongs to a different election",
    )
    bodies = source_bodies(db, store, g)
    races = db.scalars(
        select(m.ElectionComparisonRace).where(
            m.ElectionComparisonRace.snapshot_id == snapshot.id
        )
    ).all()
    expected = {r["stable_id"]: r for r in expected_coverage(snapshot, races, bodies)}
    actual = {r["stable_id"]: r for r in g["coverage"]}
    require(
        set(expected) == set(actual)
        and all(
            all(actual[k].get(field) == value for field, value in row.items())
            for k, row in expected.items()
        ),
        "Coverage does not reconcile every retained federal/local candidacy",
    )
    authorities = {r["key"]: r for r in g["authorities"]}
    for authority in authorities.values():
        if authority["status"] == "checked":
            validate_binding(
                g,
                bodies,
                authority.get("binding"),
                authority_facts(authority),
                authority=authority["key"],
                joins=("key", "jurisdiction"),
            )
    for row in g["coverage"]:
        if row["status"] in FACTUAL_COVERAGE:
            require(
                authorities[row["authority"]]["status"] == "checked",
                "Coverage authority is not checked",
            )
            validate_binding(
                g,
                bodies,
                row["binding"],
                coverage_facts(row),
                authority=row["authority"],
                joins=("stable_id", "authority", "status"),
            )
    for account in g["accounts"]:
        if account["status"] == "checked":
            require(
                authorities[account["authority"]]["status"] == "checked",
                "Account publisher authority is not checked",
            )
            validate_binding(
                g,
                bodies,
                account.get("binding"),
                account_facts(account),
                authority=account["authority"],
                joins=("authority", "account_id"),
            )
    # Stored rows arrive in hash order. Keep each original's checks together so
    # bounded source parsers do not repeatedly decode interleaved large filings.
    # This changes only verification order, never the generation or its checks.
    for report in sorted(g["reports"], key=lambda r: r.get("source_sha256") or ""):
        if report.get("binding"):
            account = next(
                r
                for r in g["accounts"]
                if (r["authority"], r["account_id"])
                == (report["authority"], report["account_id"])
            )
            require(
                account["status"] == "checked"
                and (
                    ordered_period(account, optional=True) is None
                    or account["period_start"]
                    <= report["period_start"]
                    <= report["period_end"]
                    <= account["period_end"]
                ),
                "Report crosses unchecked account dates",
            )
            require(
                bound_to(report["binding"], report["source_sha256"]),
                "Report binding belongs to another original",
            )
            validate_binding(
                g,
                bodies,
                report["binding"],
                report_facts(report),
                authority=report["authority"],
                joins=(
                    "authority",
                    "account_id",
                    "source_report_id",
                    "period_start",
                    "period_end",
                ),
            )
            if report["check_status"] in {"unreadable", "source_conflict"}:
                validate_binding(
                    g,
                    bodies,
                    report["status_binding"],
                    {
                        k: report[k]
                        for k in (
                            "authority",
                            "account_id",
                            "source_report_id",
                            "check_status",
                            "period_start",
                            "period_end",
                        )
                    },
                    authority=report["authority"],
                    joins=(
                        "authority",
                        "account_id",
                        "source_report_id",
                        "period_start",
                        "period_end",
                    ),
                )
            for figure in report.get("figures") or []:
                require(
                    bound_to(figure["binding"], report["source_sha256"]),
                    "Figure binding belongs to another report",
                )
                validate_binding(
                    g,
                    bodies,
                    figure["binding"],
                    {
                        **{k: v for k, v in figure.items() if k != "binding"},
                        **{
                            k: report[k]
                            for k in ("authority", "account_id", "source_report_id")
                        },
                    },
                    authority=report["authority"],
                    joins=(
                        "authority",
                        "account_id",
                        "source_report_id",
                        "period_start",
                        "period_end",
                    ),
                )
    for payment in sorted(g["payments"], key=lambda r: r["source_sha256"]):
        if payment["check_status"] == "checked":
            require(
                bound_to(payment["binding"], payment["source_sha256"]),
                "Payment binding belongs to another original",
            )
            validate_binding(
                g,
                bodies,
                payment["binding"],
                payment_facts(payment),
                authority=payment["authority"],
                joins=("authority", "account_id", "source_report_id", "source_row_id"),
            )
    return bodies


def load_generation(db, generation_id):
    row = db.get(
        m.ElectionExternalFinanceGeneration, generation_id, populate_existing=True
    )
    require(row is not None, "External generation is not staged")
    result = deepcopy(row.payload)
    result.update(
        id=row.id,
        copied_at=row.copied_at.isoformat(),
        reports=[
            r.payload
            for r in db.scalars(
                select(m.ElectionExternalFinanceReport).where(
                    m.ElectionExternalFinanceReport.generation_id == row.id
                )
            )
        ],
        payments=[
            r.payload
            for r in db.scalars(
                select(m.ElectionExternalFinancePayment)
                .where(m.ElectionExternalFinancePayment.generation_id == row.id)
                .order_by(m.ElectionExternalFinancePayment.key)
            )
        ],
    )
    validate_generation(result)
    return row, result


def _account_path(keys):
    tests = [
        f"(@.authority == {json.dumps(a)} && @.account_id == {json.dumps(k)})"
        for a, k in sorted(keys)
    ]
    return "$.accounts[*] ? (" + " || ".join(tests) + ")" if tests else "$.missing[*]"


def load_candidate_generation(db, row, account_keys, stable_id, extra_hashes):
    return load_published_view(
        db, row, account_keys, stable_id=stable_id, extra_hashes=extra_hashes
    )


def load_published_view(
    db,
    row,
    account_keys,
    *,
    stable_id=None,
    extra_hashes=(),
    include_own_payments=False,
    history_report_keys=None,
    history_ballots=(),
):
    """Read a bounded view of immutable, already-validated published evidence.

    This partial view is never a generation suitable for staging/publication.
    PostgreSQL selects the candidate's JSON entries and indexed report/payment rows;
    other candidates' reports, payments and source metadata never enter the request.
    """
    account_keys = set(account_keys)
    historical = history_report_keys is not None
    require(
        row.sealed_at is not None
        and (historical or row.first_published_at is not None),
        "Current read projections require a sealed published generation; history must be sealed",
    )
    history_ballots = set(history_ballots)
    scope_key = digest(
        [
            row.id,
            sorted(account_keys),
            stable_id,
            sorted(extra_hashes),
            include_own_payments,
            sorted(history_report_keys) if historical else None,
            sorted(history_ballots),
        ]
    )
    payload = m.ElectionExternalFinanceGeneration.payload

    def scope(path):
        return func.jsonb_path_query_array(payload, cast(path, JSONPATH))

    account_path = _account_path(account_keys)
    history_coverage_path = (
        "$.coverage[*] ? ("
        + " || ".join(
            f"(@.candidate_id == {json.dumps(candidate_id)} && @.source_sha256 == {json.dumps(h)})"
            for candidate_id, h in sorted(history_ballots)
        )
        + ")"
        if history_ballots
        else "$.missing[*]"
    )
    held = db.execute(
        select(
            payload["format"],
            payload["authorities"],
            scope(account_path),
            scope(history_coverage_path)
            if historical
            else payload["coverage"]
            if stable_id is None
            else scope(
                "$.coverage[*] ? (@.stable_id == " + json.dumps(stable_id) + ")"
            ),
        ).where(m.ElectionExternalFinanceGeneration.id == row.id)
    ).one()
    require(held[0] == 1, "Unsupported published finance format")
    accounts = held[2]
    targets = {
        (a["authority"], a["source_candidate_id"])
        for a in accounts
        if a.get("source_candidate_id")
    }
    payment_conditions = []
    if targets and not historical:
        payment_conditions.append(
            tuple_(
                m.ElectionExternalFinancePayment.authority,
                m.ElectionExternalFinancePayment.payload[
                    "target_source_candidate_id"
                ].astext,
            ).in_(targets)
        )
    if account_keys and include_own_payments and not historical:
        payment_conditions.append(
            tuple_(
                m.ElectionExternalFinancePayment.authority,
                m.ElectionExternalFinancePayment.account_id,
            ).in_(account_keys)
        )
    payments = (
        list(
            db.scalars(
                select(m.ElectionExternalFinancePayment)
                .where(
                    m.ElectionExternalFinancePayment.generation_id == row.id,
                    or_(*payment_conditions),
                )
                .order_by(m.ElectionExternalFinancePayment.key)
            )
        )
        if payment_conditions
        else []
    )
    report_ids = {p.payload["report_key"] for p in payments}
    reports = (
        list(
            db.scalars(
                select(m.ElectionExternalFinanceReport).where(
                    m.ElectionExternalFinanceReport.generation_id == row.id,
                    m.ElectionExternalFinanceReport.key.in_(history_report_keys)
                    if historical
                    else or_(
                        tuple_(
                            m.ElectionExternalFinanceReport.authority,
                            m.ElectionExternalFinanceReport.account_id,
                        ).in_(account_keys),
                        m.ElectionExternalFinanceReport.key.in_(report_ids),
                    ),
                )
            )
        )
        if (history_report_keys if historical else account_keys or report_ids)
        else []
    )
    all_keys = account_keys | {(p.authority, p.account_id) for p in payments}
    if historical:
        require(
            {r.key for r in reports} == set(history_report_keys)
            and {(a["authority"], a["account_id"]) for a in accounts} == account_keys,
            "Historical account or named cover is missing from its generation",
        )
    require(
        all(
            p.key == p.payload.get("payment_key")
            and p.authority == p.payload.get("authority")
            and p.account_id == p.payload.get("account_id")
            for p in payments
        )
        and all(
            r.key == r.payload.get("report_key")
            and r.authority == r.payload.get("authority")
            and r.account_id == r.payload.get("account_id")
            for r in reports
        ),
        "Published child identity differs from its indexed identity",
    )
    if all_keys != account_keys:
        accounts = db.scalar(
            select(scope(_account_path(all_keys))).where(
                m.ElectionExternalFinanceGeneration.id == row.id
            )
        )
    authorities = (
        held[1]
        if stable_id is None and not historical
        else [
            a
            for a in held[1]
            if a["key"]
            in {k[0] for k in all_keys} | {r.get("authority") for r in held[3]}
        ]
    )
    hashes = set(extra_hashes)
    for item in [*accounts, *reports, *payments, *held[3]]:
        item = item.payload if hasattr(item, "payload") else item
        if item.get("source_sha256"):
            hashes.add(item["source_sha256"])
        hashes.update(binding_hashes(item.get("binding")))
        hashes.update(binding_hashes(item.get("status_binding")))
        for figure in item.get("figures") or []:
            hashes.update(binding_hashes(figure.get("binding")))
    for authority in authorities:
        hashes.update(binding_hashes(authority.get("binding")))
    path = (
        "$.sources[*] ? ("
        + " || ".join("@.sha256 == " + json.dumps(h) for h in sorted(hashes))
        + ")"
        if hashes
        else "$.missing[*]"
    )
    sources = db.scalar(
        select(scope(path)).where(m.ElectionExternalFinanceGeneration.id == row.id)
    )
    view_type = HistoricalFinanceReadView if historical else PublishedFinanceReadView
    return row, view_type(
        {
            "format": held[0],
            "id": row.id,
            "election_key": row.election_key,
            "snapshot_id": row.snapshot_id,
            "copied_at": row.copied_at.isoformat(),
            "sources": sources,
            "authorities": authorities,
            "accounts": accounts,
            "coverage": held[3],
            "reports": [r.payload for r in reports],
            "payments": [p.payload for p in payments],
        },
        scope_key=scope_key,
    )


def load_review_view(db, generation_id, account_keys, evidence):
    """Union exact historical review dependencies without payment hydration."""
    row = db.scalar(
        select(m.ElectionExternalFinanceGeneration)
        .options(defer(m.ElectionExternalFinanceGeneration.payload, raiseload=True))
        .where(m.ElectionExternalFinanceGeneration.id == generation_id)
    )
    require(row is not None, "Historical review generation is not retained")
    hashes = {e["sha256"] for e in evidence if e.get("sha256")}
    for item in evidence:
        hashes.update(binding_hashes(item.get("binding")))
        hashes.update(binding_hashes(item.get("status_binding")))
    return load_published_view(
        db,
        row,
        account_keys,
        extra_hashes=hashes,
        history_report_keys={
            e["report_key"]
            for e in evidence
            if e.get("kind") == "report_cover" and e.get("report_key")
        },
        history_ballots={
            (e["literal_row"].split(";")[0], e["sha256"])
            for e in evidence
            if e.get("kind") == "ballot"
            and isinstance(e.get("literal_row"), str)
            and e.get("sha256")
        },
    )


def stage_generation(db, store, generation, originals):
    validate_generation(generation)
    required = {r["sha256"] for r in generation["sources"]}
    require(
        set(originals) <= required
        and all(hashlib.sha256(body).hexdigest() == h for h, body in originals.items()),
        "Original source fingerprint changed",
    )
    with db.begin_nested():
        for body in originals.values():
            archive_source(db, store, body)
        verify_evidence(db, store, generation)
        existing = db.get(m.ElectionExternalFinanceGeneration, generation["id"])
        if existing is not None:
            require(
                existing.sealed_at is not None,
                "Staged external generation is incomplete",
            )
            _, held = load_generation(db, generation["id"])
            require(
                generation_digest(held) == generation_digest(generation),
                "Stored external generation changed",
            )
            return existing.id
        payload = {
            k: v
            for k, v in generation.items()
            if k not in {"id", "copied_at", "reports", "payments"}
        }
        db.add(
            m.ElectionExternalFinanceGeneration(
                id=generation["id"],
                election_key=generation["election_key"],
                snapshot_id=generation["snapshot_id"],
                copied_at=datetime.fromisoformat(generation["copied_at"]),
                payload=payload,
            )
        )
        db.flush()
        for field, model, key in [
            ("reports", m.ElectionExternalFinanceReport, "report_key"),
            ("payments", m.ElectionExternalFinancePayment, "payment_key"),
        ]:
            for item in generation[field]:
                db.add(
                    model(
                        generation_id=generation["id"],
                        key=item[key],
                        authority=item["authority"],
                        account_id=item["account_id"],
                        payload=item,
                    )
                )
        db.flush()
        held = db.get(m.ElectionExternalFinanceGeneration, generation["id"])
        held.sealed_at = datetime.now(UTC)
        db.flush()
    return generation["id"]


def publish_generation(db, store, generation_id, *, expected_previous, restore=False):
    row = db.get(m.ElectionExternalFinanceGeneration, generation_id)
    require(row is not None, "External generation is not staged")
    db.execute(
        text("SELECT pg_advisory_xact_lock(hashtext(:key))"),
        {"key": f"external-election-finance:{row.election_key}"},
    )
    db.execute(
        select(m.ElectionExternalFinanceGeneration.id)
        .where(m.ElectionExternalFinanceGeneration.id == generation_id)
        .with_for_update()
    )
    row, g = load_generation(db, generation_id)
    require(row.sealed_at is not None, "External generation is not sealed")
    current = db.get(
        m.ElectionExternalFinanceCurrent, row.election_key, populate_existing=True
    )
    previous = current.generation_id if current else None
    require(
        previous == expected_previous or previous == generation_id,
        "Published external generation changed",
    )
    verify_evidence(db, store, g)
    require(
        not restore or row.first_published_at is not None,
        "Restore requires an earlier published generation",
    )
    if previous == generation_id:
        return {
            "generation_id": row.id,
            "previous": previous,
            "restore": restore,
            "already_current": True,
        }
    if row.first_published_at is None:
        row.first_published_at = datetime.now(UTC)
    db.execute(
        insert(m.ElectionExternalFinanceCurrent)
        .values(election_key=row.election_key, generation_id=row.id)
        .on_conflict_do_update(
            index_elements=["election_key"], set_={"generation_id": row.id}
        )
    )
    db.flush()
    return {"generation_id": row.id, "previous": previous, "restore": restore}


def binding_hashes(value):
    return {
        b["source_sha256"]
        for b in bindings(value)
        if isinstance(b, dict) and b.get("source_sha256")
    }


def source_dependencies(
    g, *, account_keys=(), reports=(), payments=(), coverage=(), evidence=(), cache=None
):
    """One source set for claim availability, identity rechecks and response versions."""
    indexes = _review_indexes(g, cache)
    hashes = set()

    def record(item, *, figures=False):
        if item is None:
            return
        if item.get("source_sha256"):
            hashes.add(item["source_sha256"])
        hashes.update(binding_hashes(item.get("binding")))
        hashes.update(binding_hashes(item.get("status_binding")))
        if figures:
            for figure in item.get("figures") or []:
                record(figure)

    def account(key):
        record(indexes["accounts"].get(key))
        record(indexes["authorities"].get(key[0]))

    for key in account_keys:
        account(key)
    for report in reports:
        record(report, figures=True)
        account((report["authority"], report["account_id"]))
    for payment in payments:
        record(payment)
        record(indexes["reports"].get(payment["report_key"]))
        account((payment["authority"], payment["account_id"]))
    for row in coverage:
        if row["status"] in FACTUAL_COVERAGE:
            record(row)  # Includes the exact retained ballot original.
            record(indexes["authorities"].get(row["authority"]))
    for item in evidence:
        if item.get("sha256"):
            hashes.add(item["sha256"])
        record(item)
        if item.get("kind") == "report_cover":
            record(indexes["reports"].get(item.get("report_key")))
    hashes.discard(None)
    return hashes


def retained_bodies(db, store, generation, hashes, *, source_index=None):
    if source_index is None:
        source_index = {s["sha256"]: s for s in generation["sources"]}
    require(
        all(h in source_index for h in hashes),
        "Review source is outside its external generation",
    )
    result = _VerifiedBodies(source_index)
    for h in hashes:
        row = db.get(m.ElectionResultSource, h)
        require(row is not None, "Review original is not retained")
        try:
            result[h] = read_source(store, row)
        except Exception as exc:
            raise ComparisonImportError(
                "Review original is unavailable or changed"
            ) from exc
    return result


def federal_designation_context(race):
    title = race.payload["office_name"]
    if title == "U.S. Senator":
        return {"office": "S", "state": "MN", "district": "00"}
    match = re.fullmatch(r"U\.S\. Representative District ([1-9][0-9]?)", title)
    require(
        match is not None,
        "Federal designation needs an exact supported Minnesota office",
    )
    assert match is not None
    return {"office": "H", "state": "MN", "district": f"{int(match[1]):02d}"}


def validate_federal_designation(generation, bodies, binding, expected):
    """Join candidate-only Form2 fields after a separate issued designation.

    Generic bindings keep their exact entity joins. Only the trusted paper
    field adapter may omit account_id here, and only after all account-bound
    fragments have proved this exact account/candidate relationship. Input list
    order cannot bypass that validation order. No account ID enters paper facts.
    """
    fields = {
        "authority",
        "account_id",
        "source_candidate_id",
        "election_year",
        "office",
        "state",
        "district",
    }
    require(
        isinstance(expected, dict)
        and set(expected) in (fields, fields | {"designation_role"})
        and expected.get("authority") == "fec",
        "Candidate context needs the complete typed federal designation",
    )
    if "designation_role" in expected:
        require(
            expected["designation_role"] in {"principal", "authorized"},
            "Unsupported candidate account designation role",
        )
    account_bindings, candidate_bindings = [], []
    for item in bindings(binding):
        require(
            isinstance(item, dict) and isinstance(item.get("facts"), dict),
            "Missing checked designation binding",
        )
        (
            account_bindings if "account_id" in item["facts"] else candidate_bindings
        ).append(item)
    require(
        account_bindings,
        "Candidate context requires a separate issued-account designation",
    )
    covered = set()
    for item in account_bindings:
        facts = item["facts"]
        validate_binding(
            generation,
            bodies,
            item,
            {key: expected.get(key) for key in facts},
            authority="fec",
            joins=("authority", "account_id", "source_candidate_id"),
        )
        require(set(facts) <= set(expected), "Designation contains unsupported fields")
        covered.update(facts)
    for item in candidate_bindings:
        facts, locator = item["facts"], item.get("locator", {})
        field = locator.get("field")
        require(
            item.get("adapter") == "fec_form2_pdf:v1"
            and locator.get("kind") == "field"
            and field in {"election_year", "office", "state", "district"}
            and set(facts) == {"authority", "source_candidate_id", field},
            "Only typed candidate-keyed Form2 context may omit the account ID",
        )
        validate_binding(
            generation,
            bodies,
            item,
            {key: expected.get(key) for key in facts},
            authority="fec",
            joins=("authority", "source_candidate_id"),
        )
        covered.update(facts)
    require(
        covered == set(expected),
        "Designation has fields without checked source evidence",
    )


def _assertion_day(value):
    require(
        isinstance(value, str) and re.fullmatch(r"[0-9]{4}-[0-9]{2}-[0-9]{2}", value),
        "Designation assertion needs a literal ISO date",
    )
    try:
        return date.fromisoformat(value)
    except ValueError as exc:
        raise ComparisonImportError(
            "Designation assertion has an invalid date"
        ) from exc


def _ascii_committee_name(value):
    require(
        isinstance(value, str) and bool(value.strip()), "Missing literal committee name"
    )
    return (
        re.sub(r"[ \t\r\n\f\v]+", " ", value)
        .strip(" \t\r\n\f\v")
        .translate(
            str.maketrans("ABCDEFGHIJKLMNOPQRSTUVWXYZ", "abcdefghijklmnopqrstuvwxyz")
        )
    )


def validate_federal_dated_designation(
    generation,
    bodies,
    evidence,
    *,
    account,
    designation_context,
    designations,
    period_start,
):
    """Check an assertion-date floor, never infer relationship inception.

    A date cannot supply missing issued-account designation evidence. Form2's
    candidate-only fields stay candidate-only; its principal name must belong to
    the same original that supplied the checked election context. Generic entity
    joins remain strict. No URL, copied timestamp or caller date supplies a floor.
    """
    role = evidence.get("designation_role")
    require(
        account.get("authority") == "fec"
        and account.get("issued_id") is True
        and bool(account.get("source_candidate_id"))
        and role in {"principal", "authorized"},
        "Dated designation needs an issued federal account and explicit role",
    )
    require(
        all(
            designation_context.get(key) == account.get(key)
            for key in ("authority", "account_id", "source_candidate_id")
        ),
        "Dated context differs from this exact account and candidate",
    )
    matches = [e for e in designations if e.get("designation_role") == role]
    require(matches, "Dated evidence requires a separate issued-account designation")
    expected = {**designation_context, "designation_role": role}
    for designation in matches:
        validate_federal_designation(
            generation, bodies, designation.get("binding"), expected
        )
    items = bindings(evidence.get("binding"))
    require(
        all(isinstance(i, dict) and isinstance(i.get("facts"), dict) for i in items)
        and all(i.get("source_sha256") == evidence.get("sha256") for i in items),
        "Dated evidence must bind one exact original",
    )
    if evidence.get("basis") == "form2_signed_principal":
        require(
            role == "principal" and len(items) == 2,
            "Form2 dates apply only to its principal committee",
        )
        fields = {}
        for item in items:
            locator = item.get("locator", {})
            field = locator.get("field")
            require(
                item.get("adapter") == "fec_form2_pdf:v1"
                and locator == {"kind": "field", "page": 1, "field": field}
                and field in {"signed_date", "principal_account_name"}
                and field not in fields
                and set(item["facts"]) == {"authority", "source_candidate_id", field},
                "Dated principal evidence needs typed same-PDF Form2 fields",
            )
            facts = {
                "authority": "fec",
                "source_candidate_id": account["source_candidate_id"],
                field: item["facts"][field],
            }
            validate_binding(
                generation,
                bodies,
                item,
                facts,
                authority="fec",
                joins=("authority", "source_candidate_id"),
            )
            fields[field] = facts[field]
        context_fields = {
            item.get("locator", {}).get("field")
            for designation in matches
            for item in bindings(designation.get("binding"))
            if item.get("adapter") == "fec_form2_pdf:v1"
            and item.get("source_sha256") == evidence.get("sha256")
        }
        require(
            {"election_year", "office", "state", "district"} <= context_fields,
            "Form2 date must share the checked designation's election-context original",
        )
        require(
            _ascii_committee_name(fields["principal_account_name"])
            == _ascii_committee_name(account["name"]),
            "Form2 principal committee name differs from this exact account",
        )
        assertion = _assertion_day(fields["signed_date"])
    elif evidence.get("basis") == "f1_identity_dates":
        require(len(items) == 1, "F1 dates need one typed identity original")
        item = items[0]
        facts = item["facts"]
        require(
            item.get("adapter") == "fec_raw:v1"
            and item.get("locator") == {"kind": "identity", "row": 2}
            and {
                "authority",
                "account_id",
                "source_candidate_id",
                "effective_date",
                "signed_date",
                "designation",
                "committee_type",
                "office",
                "state",
                "district",
            }
            <= set(facts),
            "Dated identity requires typed original F1 fields",
        )
        validate_binding(
            generation,
            bodies,
            item,
            facts,
            authority="fec",
            joins=("authority", "account_id", "source_candidate_id"),
        )
        require(
            facts["authority"] == "fec"
            and facts["account_id"] == account["account_id"]
            and facts["source_candidate_id"] == account["source_candidate_id"]
            and facts["designation"] == role
            and facts["committee_type"] == {"principal": "A", "authorized": "B"}[role]
            and facts["office"] == designation_context["office"]
            and facts["state"] == designation_context["state"]
            and (
                facts["district"] == designation_context["district"]
                or designation_context["office"] == "S"
                and facts["district"] is None
                and designation_context["district"] == "00"
            ),
            "F1 date belongs to a different account, candidate, office or role",
        )
        assertion = max(
            _assertion_day(facts["effective_date"]),
            _assertion_day(facts["signed_date"]),
        )
    else:
        raise ComparisonImportError("Unsupported dated designation basis")
    require(
        period_start >= assertion,
        "Reviewed interval starts before its source-backed designation assertion",
    )
    return assertion


def validate_federal_name_rendering(
    generation, bodies, binding, *, source_candidate_id, source_name, ballot_name
):
    """Prove only source-declared family/given order and ASCII case equality.

    Called inside explicit account review after source account/candidate checks
    and with independently checked ballot text. This is no alias approval; all
    original strings remain unchanged in their evidence and account records.
    """
    require(
        isinstance(binding, dict)
        and binding.get("adapter") == "fec_candidate_master:v1"
        and binding.get("locator", {}).get("kind") == "name_rendering",
        "Name rendering needs the source-specific master name schema",
    )
    validate_binding(
        generation,
        bodies,
        binding,
        {
            "authority": "fec",
            "source_candidate_id": source_candidate_id,
            "source_name": source_name,
            "name_order": "family_comma_given",
        },
        authority="fec",
        joins=("authority", "source_candidate_id"),
    )
    require(
        isinstance(source_name, str)
        and isinstance(ballot_name, str)
        and source_name.isascii()
        and ballot_name.isascii()
        and source_name.count(",") == 1
        and ", " in source_name,
        "Name rendering has unsupported text or source order",
    )
    family, given = source_name.split(", ")
    require(
        f"{given} {family}".upper() == ballot_name.upper(),
        "Name rendering differs beyond declared order or case; separate alias evidence required",
    )


def cached_generation(db, generation_id, cache=None):
    if cache is None:
        return load_generation(db, generation_id)
    if generation_id not in cache:
        cache[generation_id] = load_generation(db, generation_id)
    return cache[generation_id]


def cached_review_generation(db, generation_id, cache=None):
    """Only readers supply preplanned historical views; write paths stay full."""
    if cache is not None and cache.get("published_review_views_planned"):
        value = cache.get(("published_review_view", generation_id))
        require(value is not None, "Historical read view was not planned")
        return value
    return cached_generation(db, generation_id, cache)


def validate_local_recipient(expected, jurisdiction):
    require(
        expected is not None
        and expected["county_id"] in jurisdiction.get("county_ids", []),
        "Local recipient does not cover this exact candidacy county",
    )
    for field in ("municipal_fips_code", "school_district_number"):
        if expected.get(field):
            require(
                jurisdiction.get(field) == expected[field],
                "Local recipient differs from ballot geography",
            )
    if expected.get("school_district_number"):
        school = re.search(r"\((ISD|SSD) #([0-9]+)\)", expected["office"])
        require(
            school is not None
            and jurisdiction.get("school_district_type") == school[1]
            and int(school[2]) == int(expected["school_district_number"]),
            "School recipient needs the exact ballot district type and number",
        )


def _review_indexes(g, cache):
    key = ("review_indexes", g["id"], g.get("_read_scope"))
    if cache is not None and key in cache:
        return cache[key]
    result = {
        "sources": {r["sha256"]: r for r in g["sources"]},
        "accounts": {(r["authority"], r["account_id"]): r for r in g["accounts"]},
        "authorities": {r["key"]: r for r in g["authorities"]},
        "reports": {r["report_key"]: r for r in g["reports"]},
        "coverage": {r["stable_id"]: r for r in g["coverage"]},
    }
    if cache is not None:
        cache[key] = result
    return result


def review_generation_id(evidence):
    ids = {e.get("generation_id") for e in evidence if e.get("kind") != "ballot"}
    require(
        len(ids) == 1 and all(fingerprint(value) for value in ids),
        "External review needs one exact retained generation",
    )
    return next(iter(ids))


def _review_period_is_covered(covers, start, end):
    """Every reviewed day needs a checked cover; no money is combined here."""
    cursor = start
    intervals = sorted(
        (date.fromisoformat(r["period_start"]), date.fromisoformat(r["period_end"]))
        for r in covers
    )
    for first, last in intervals:
        if last < cursor:
            continue
        if first > cursor:
            return False
        if last >= end:
            return True
        cursor = last + timedelta(days=1)
    return False


def validate_account_review(
    db,
    store,
    *,
    snapshot,
    race,
    candidate,
    registration_number,
    authority,
    period_start,
    period_end,
    evidence,
    decision,
    cache=None,
):
    """Exact original-backed external identity; no Board behavior is changed."""
    from alethical.pipeline.election_account_reviews import _validate_quotes

    generation_id = review_generation_id(evidence)
    _, g = cached_review_generation(db, generation_id, cache)
    require(
        g["snapshot_id"] == snapshot.id and g["election_key"] == snapshot.election_key,
        "Review generation belongs to another ballot snapshot",
    )
    indexes = _review_indexes(g, cache)
    publisher = indexes["authorities"].get(authority)
    account = indexes["accounts"].get((authority, registration_number))
    require(
        publisher is not None and account is not None,
        "External review account or authority is not in this generation",
    )
    kinds = {e.get("kind") for e in evidence}
    if decision == "confirmed":
        require(
            {"ballot", "authority", "committee_register", "report_cover"} <= kinds,
            "External confirmation needs ballot, publisher, account and report cover",
        )
        require(
            publisher["status"] == account["status"] == "checked",
            "Unchecked source capture cannot confirm an account",
        )
        require(
            account.get("jurisdiction") == publisher["jurisdiction"],
            "Account belongs to another exact authority jurisdiction",
        )
        if authority == "fec":
            require(
                "designation" in kinds and bool(account.get("source_candidate_id")),
                "Federal confirmation needs exact candidate designation",
            )
        else:
            require(
                authority.startswith("local:")
                and isinstance(publisher["jurisdiction"], dict),
                "Local review needs typed recipient jurisdiction",
            )
            jurisdiction = publisher["jurisdiction"]
            require(
                jurisdiction.get("recipient_id") and jurisdiction.get("recipient_type"),
                "Local recipient needs exact type and source ID",
            )
            expected = indexes["coverage"].get(candidate.get("candidate_stable_id"))
            validate_local_recipient(expected, jurisdiction)
        if account.get("candidate_name") != candidate["name"]:
            require(
                any(
                    (
                        e.get("kind") == "alias"
                        or (authority == "fec" and e.get("kind") == "name_rendering")
                    )
                    and isinstance(e.get("reason"), str)
                    and e["reason"].strip()
                    for e in evidence
                ),
                "Name variation needs separate exact alias or name-rendering evidence and reason",
            )
    hashes = source_dependencies(
        g,
        account_keys=[(authority, registration_number)],
        evidence=evidence,
        cache=cache,
    )
    bodies = retained_bodies(db, store, g, hashes, source_index=indexes["sources"])
    if decision == "confirmed":
        validate_binding(
            g,
            bodies,
            publisher["binding"],
            authority_facts(publisher),
            authority=authority,
            joins=("key", "jurisdiction"),
        )
        validate_binding(
            g,
            bodies,
            account["binding"],
            account_facts(account),
            authority=authority,
            joins=("authority", "account_id"),
        )
    covers = []
    for e in evidence:
        kind = e.get("kind")
        if kind == "ballot":
            require(
                e["sha256"] == race.payload["candidate_source_sha256"]
                and isinstance(e.get("literal_row"), str)
                and e["literal_row"].split(";")[:4]
                == [
                    candidate["candidate_id"],
                    candidate["name"],
                    race.office_id,
                    race.payload["office_name"],
                ],
                "Ballot evidence differs from this exact source candidacy",
            )
            _validate_quotes(db, e, registration_number)
            continue
        require(
            e["sha256"] in binding_hashes(e.get("binding")),
            "Review original is absent from its checked bindings",
        )
        if kind == "authority":
            expected = authority_facts(publisher)
            joins = ("key", "jurisdiction")
        elif kind == "committee_register":
            expected, joins = account_facts(account), ("authority", "account_id")
        elif kind == "report_cover":
            report = indexes["reports"].get(e.get("report_key"))
            require(
                report is not None
                and (report["authority"], report["account_id"])
                == (authority, registration_number)
                and report["check_status"] == "checked"
                and report["source_sha256"] == e["sha256"],
                "Report cover belongs to another account or unchecked report",
            )
            covers.append(report)
            expected = report_facts(report)
            joins = (
                "authority",
                "account_id",
                "source_report_id",
                "period_start",
                "period_end",
            )
        elif kind == "designation":
            expected = {
                "authority": authority,
                "account_id": registration_number,
                "source_candidate_id": account["source_candidate_id"],
                "election_year": snapshot.election_date.year,
                **federal_designation_context(race),
            }
            if e.get("designation_role") is not None:
                expected["designation_role"] = e["designation_role"]
            validate_federal_designation(g, bodies, e.get("binding"), expected)
            continue
        elif kind == "dated_designation":
            require(
                authority == "fec",
                "Dated designation is supported only for federal accounts",
            )
            validate_federal_dated_designation(
                g,
                bodies,
                e,
                account=account,
                designation_context={
                    "authority": authority,
                    "account_id": registration_number,
                    "source_candidate_id": account["source_candidate_id"],
                    "election_year": snapshot.election_date.year,
                    **federal_designation_context(race),
                },
                designations=[
                    item for item in evidence if item.get("kind") == "designation"
                ],
                period_start=period_start,
            )
            continue
        elif kind == "name_rendering":
            require(
                authority == "fec"
                and isinstance(e.get("reason"), str)
                and bool(e["reason"].strip()),
                "Name rendering requires explicit federal review evidence and reason",
            )
            validate_federal_name_rendering(
                g,
                bodies,
                e.get("binding"),
                source_candidate_id=account.get("source_candidate_id"),
                source_name=account.get("candidate_name"),
                ballot_name=candidate["name"],
            )
            continue
        elif kind == "alias":
            expected = {
                "authority": authority,
                "account_id": registration_number,
                "source_candidate_id": account.get("source_candidate_id"),
                "source_name": account.get("candidate_name"),
                "ballot_name": candidate["name"],
            }
            joins = ("authority", "account_id")
        elif kind == "same_person":
            expected = {
                "authority": authority,
                "account_id": registration_number,
                "decision_ids": e.get("decision_ids"),
            }
            joins = ("authority", "account_id")
        else:
            raise ComparisonImportError("Unsupported external review evidence kind")
        validate_binding(
            g, bodies, e.get("binding"), expected, authority=authority, joins=joins
        )
    if decision == "confirmed":
        require(
            _review_period_is_covered(covers, period_start, period_end),
            "Review interval crosses unchecked report dates",
        )
    return g


def account_review_available(db, row, race, candidate, *, store=None, cache=None):
    from alethical.pipeline.raw_file_store import raw_file_store_from_env

    try:
        snapshot_id = next(
            e["generation_id"] for e in row.evidence if e.get("generation_id")
        )
        generation, _ = cached_review_generation(db, snapshot_id, cache)
        snapshot = db.get(m.ElectionComparisonSnapshot, generation.snapshot_id)
        require(
            snapshot is not None and race.snapshot_id == snapshot.id,
            "Review ballot snapshot changed",
        )
        validate_account_review(
            db,
            store or raw_file_store_from_env(),
            snapshot=snapshot,
            race=race,
            candidate=candidate,
            registration_number=row.registration_number,
            authority=row.authority,
            period_start=row.period_start,
            period_end=row.period_end,
            evidence=row.evidence,
            decision=row.decision,
            cache=cache,
        )
        return True
    except (ComparisonImportError, KeyError, TypeError, StopIteration):
        return False
