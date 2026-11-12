"""Authenticated-boundary reads of published federal/local finance generations.

The parent router applies Finance authentication. No acquisition endpoint exists.
Public dictionaries are explicit allowlists; proposals and private review notes
cannot become checked candidate figures through source capture alone.
"""

from __future__ import annotations

from copy import deepcopy
from collections import OrderedDict
from pathlib import Path
from typing import Any, NoReturn

from sqlalchemy import cast, func, select
from sqlalchemy.dialects.postgresql import JSONPATH
from sqlalchemy.orm import defer

from alethical.api.problems import problem_exception
from alethical.api.services import finance_versions
from alethical.db import models as m
from alethical.pipeline import election_account_reviews as reviews
from alethical.pipeline import election_external_finance as storage
from alethical.pipeline.election_comparison import (
    ComparisonImportError,
    digest,
    read_source,
)
from alethical.pipeline.raw_file_store import raw_file_store_from_env


def _problem(status, detail) -> NoReturn:
    raise problem_exception(
        status,
        "Conflict"
        if status == 409
        else "Not Found"
        if status == 404
        else "Service Unavailable",
        detail,
    )


def _published_row(db, election_key, generation_id):
    if generation_id is None:
        current = db.get(m.ElectionExternalFinanceCurrent, election_key)
        if current is None:
            _problem(
                503,
                "External finance sources have not been published for this election.",
            )
        generation_id = current.generation_id
    row = db.scalar(
        select(m.ElectionExternalFinanceGeneration)
        .options(defer(m.ElectionExternalFinanceGeneration.payload, raiseload=True))
        .where(m.ElectionExternalFinanceGeneration.id == generation_id)
    )
    if (
        row is None
        or row.election_key != election_key
        or row.first_published_at is None
        or row.sealed_at is None
    ):
        _problem(
            404, "This external finance generation was not published for this election."
        )
    return row


def public_source(source):
    return {
        k: deepcopy(source[k])
        for k in ("sha256", "authority", "url", "media_type", "copied_at")
        if k in source
    }


def _binding(value):
    return [
        {k: deepcopy(b[k]) for k in ("source_sha256", "locator", "quote")}
        for b in storage.bindings(value)
        if isinstance(b, dict)
    ]


def _availability(db, store, hashes):
    bodies, available = {}, {}
    rows = (
        {
            row.content_hash: row
            for row in db.scalars(
                select(m.ElectionResultSource).where(
                    m.ElectionResultSource.content_hash.in_(hashes)
                )
            )
        }
        if hashes
        else {}
    )
    for h in sorted(hashes):
        row = rows.get(h)
        try:
            if row is None:
                raise ComparisonImportError("Missing original")
            read_source(store, row)
            available[h] = True
        except Exception:
            available[h] = False
    return bodies, available


def _context(
    db,
    *,
    election_key,
    generation_id=None,
    race_id=None,
    candidate_id=None,
    version=None,
    store=None,
    all_scope=False,
    cache=None,
):
    cache = cache if cache is not None else {}
    finance_versions.pin(db)
    store = store or raw_file_store_from_env()
    row = _published_row(db, election_key, generation_id)
    history_query = select(m.ElectionCampaignAccountDecision).where(
        m.ElectionCampaignAccountDecision.election_key == election_key,
        m.ElectionCampaignAccountDecision.authority != "mn_cfb",
    )
    outcome_query = select(m.ElectionOutcomeDecision).where(
        m.ElectionOutcomeDecision.snapshot_id == row.snapshot_id
    )
    race, candidate = None, None
    if race_id is not None:
        race = db.get(m.ElectionComparisonRace, (row.snapshot_id, race_id))
        if race is None:
            _problem(404, "Race not found in this election snapshot.")
        history_query = history_query.where(
            m.ElectionCampaignAccountDecision.race_id == race_id
        )
        outcome_query = outcome_query.where(
            m.ElectionOutcomeDecision.race_id == race_id
        )
        if candidate_id is not None:
            candidate = next(
                (
                    c
                    for c in race.payload["candidates"]
                    if c["candidate_id"] == candidate_id
                    and not c.get("is_write_in_aggregate")
                ),
                None,
            )
            if candidate is None:
                _problem(404, "Named candidacy not found in this race.")
            history_query = history_query.where(
                m.ElectionCampaignAccountDecision.candidate_id == candidate_id
            )
    histories = db.scalars(
        history_query.order_by(m.ElectionCampaignAccountDecision.id)
    ).all()
    account_keys = {(r.authority, r.registration_number) for r in histories}
    # Review-only originals still need public source metadata. They may not be
    # referenced by a current account/report binding (for example, a dated FEC
    # designation), but readers must be able to open the proof behind the join.
    review_hashes = set()
    for review in histories:
        for evidence in review.evidence:
            if evidence.get("sha256"):
                review_hashes.add(evidence["sha256"])
            review_hashes.update(storage.binding_hashes(evidence.get("binding")))
            review_hashes.update(storage.binding_hashes(evidence.get("status_binding")))
    _, g = storage.load_published_view(
        db,
        row,
        account_keys,
        stable_id=candidate.get("candidate_stable_id") if candidate else None,
        extra_hashes=review_hashes,
        include_own_payments=all_scope,
    )
    # All history for each generation is planned before validating a single
    # account. A narrower candidate view never occupies the full-generation cache.
    history_groups = {}
    for review in histories:
        old_id = storage.review_generation_id(review.evidence)
        group = history_groups.setdefault(old_id, {"accounts": set(), "evidence": []})
        group["accounts"].add((review.authority, review.registration_number))
        group["evidence"].extend(review.evidence)
    for old_id, group in history_groups.items():
        cache[("published_review_view", old_id)] = storage.load_review_view(
            db, old_id, group["accounts"], group["evidence"]
        )
    cache["published_review_views_planned"] = True
    # One complete dependency set drives both body checks and version metadata.
    accounts = {(r.authority, r.registration_number) for r in histories}
    relevant = [
        a for a in g["accounts"] if (a["authority"], a["account_id"]) in accounts
    ]
    targets = {
        (a["authority"], a.get("source_candidate_id"))
        for a in relevant
        if a.get("source_candidate_id")
    }
    reports = [r for r in g["reports"] if (r["authority"], r["account_id"]) in accounts]
    payments = [
        p
        for p in g["payments"]
        if (p["authority"], p.get("target_source_candidate_id")) in targets
        or (p["authority"], p["account_id"]) in accounts
    ]
    coverage = (
        g["coverage"]
        if candidate is None
        else [
            r
            for r in g["coverage"]
            if r["stable_id"] == candidate.get("candidate_stable_id")
        ]
    )
    hashes = storage.source_dependencies(g, coverage=coverage, cache=cache)
    if race_id is not None or all_scope:
        hashes.update(
            storage.source_dependencies(
                g,
                account_keys=accounts,
                reports=reports,
                payments=payments,
                cache=cache,
            )
        )
        for review in histories:
            old_id = storage.review_generation_id(review.evidence)
            _, old = storage.cached_review_generation(db, old_id, cache)
            hashes.update(
                storage.source_dependencies(
                    old,
                    account_keys=[(review.authority, review.registration_number)],
                    evidence=review.evidence,
                    cache=cache,
                )
            )
    held_sources = {
        r.content_hash: r
        for r in db.scalars(
            select(m.ElectionResultSource).where(
                m.ElectionResultSource.content_hash.in_(hashes)
            )
        )
    }
    source_rows = [
        [
            h,
            None
            if h not in held_sources
            else [
                held_sources[h].byte_size,
                held_sources[h].compressed_hash,
                held_sources[h].compressed_byte_size,
                held_sources[h].compression,
            ],
        ]
        for h in sorted(hashes)
    ]
    bodies, available = _availability(db, store, hashes)
    outcomes = list(db.scalars(outcome_query.order_by(m.ElectionOutcomeDecision.id)))
    outcome_sources = {
        e.get("sha256") for r in outcomes for e in r.evidence if e.get("sha256")
    }
    # Outcome captures use a capture ID, whose source/publisher metadata also versions loss.
    captures = {
        e.get("capture_id") for r in outcomes for e in r.evidence if e.get("capture_id")
    }
    for capture_id in captures:
        capture = db.get(m.ElectionOutcomeSource, capture_id)
        if capture:
            outcome_sources.update({capture.content_hash, capture.publisher_hash})
    _, outcome_available = _availability(db, store, outcome_sources)
    token = digest(
        {
            "generation": row.id,
            "scope": [race_id, candidate_id, all_scope],
            "identity": reviews.candidate_identity(race, candidate)
            if candidate is not None and race is not None
            else None,
            "sources": sorted(source_rows),
            "reviews": [r.request_key for r in histories],
            "availability": available,
            "outcomes": [r.request_key for r in outcomes],
            "outcome_captures": sorted(captures),
            "outcome_sources": outcome_available,
        }
    )
    if version is not None and token != version:
        _problem(
            409, "These finance sources or reviews changed. Reload this comparison."
        )
    context = {
        "election_key": election_key,
        "generation_id": row.id,
        "snapshot_id": row.snapshot_id,
        "copied_at": row.copied_at.isoformat(),
        "version": token,
        "authorities": [
            {k: deepcopy(a[k]) for k in ("key", "name", "jurisdiction", "status")}
            for a in g["authorities"]
        ],
        "complete_election_spending": False,
    }
    return context, g, race, candidate, histories, bodies, available, store


def context(db, *, election_key, generation_id=None, version=None, store=None):
    cache = {}
    ctx, g, _, _, _, _, available, _ = _context(
        db,
        election_key=election_key,
        generation_id=generation_id,
        version=version,
        store=store,
        cache=cache,
    )
    return {
        **ctx,
        "coverage": [
            _public_coverage(r, available, g, cache=cache) for r in g["coverage"]
        ],
    }


def _coverage_hashes(row, generation, *, cache=None):
    return storage.source_dependencies(generation, coverage=[row], cache=cache)


def _public_coverage(row, available, generation, *, cache=None):
    result = {
        k: deepcopy(row[k])
        for k in (
            "stable_id",
            "candidate_id",
            "name",
            "office_id",
            "office",
            "party",
            "source_sha256",
            "authority_family",
            "county_id",
            "municipal_fips_code",
            "school_district_number",
            "authority",
            "status",
            "next_action",
        )
        if k in row
    }

    if row["status"] in storage.OPERATIONAL_COVERAGE:
        result["status_basis"] = "operational"
    elif all(
        available.get(h, False) for h in _coverage_hashes(row, generation, cache=cache)
    ):
        result["status_basis"] = "checked_source"
        result["sources"] = _binding(row["binding"])
    else:
        result.update(
            status="unchecked",
            status_basis="sources_unavailable",
            next_action="Recover retained coverage evidence",
        )
    return result


def _indexes(g):
    result = {
        "accounts": {(a["authority"], a["account_id"]): a for a in g["accounts"]},
        "authorities": {a["key"]: a for a in g["authorities"]},
        "coverage": {r["stable_id"]: r for r in g["coverage"]},
        "reports": {r["report_key"]: r for r in g["reports"]},
        "account_reports": {},
        "target_payments": {},
        "account_payments": {},
    }
    for report in g["reports"]:
        result["account_reports"].setdefault(
            (report["authority"], report["account_id"]), []
        ).append(report)
    for payment in g["payments"]:
        result["account_payments"].setdefault(
            (payment["authority"], payment["account_id"]), []
        ).append(payment)
        result["target_payments"].setdefault(
            (payment["authority"], payment.get("target_source_candidate_id")), []
        ).append(payment)
    return result


def candidate_finance(
    db,
    *,
    election_key,
    race_id,
    candidate_id,
    generation_id=None,
    version=None,
    store=None,
):
    cache = {}
    ctx, g, race, candidate, histories, bodies, available, store = _context(
        db,
        election_key=election_key,
        generation_id=generation_id,
        race_id=race_id,
        candidate_id=candidate_id,
        version=version,
        store=store,
        cache=cache,
    )
    return _candidate_records(
        db, (ctx, g, race, candidate, histories, bodies, available, store), cache=cache
    )


def _candidate_records(db, state, *, cache=None, indexes=None):
    ctx, g, race, candidate, histories, bodies, available, store = state
    cache = cache if cache is not None else {}
    indexes = indexes if indexes is not None else _indexes(g)
    race_id, candidate_id = race.id, candidate["candidate_id"]
    latest = {}
    for review in histories:
        latest[(review.authority, review.registration_number)] = review
    accounts, gaps = [], []
    approved = []
    for key, review in latest.items():
        current = indexes["accounts"].get(key)
        state = review.decision
        if state == "confirmed":
            state = (
                "identity_changed"
                if review.identity != reviews.candidate_identity(race, candidate)
                else "sources_unavailable"
                if not storage.account_review_available(
                    db, review, race, candidate, store=store, cache=cache
                )
                else "checked"
            )
            if current is None or current.get("status") != "checked":
                state = "account_not_in_generation"
            if state == "checked":
                needed = storage.source_dependencies(g, account_keys=[key], cache=cache)
                if not all(available.get(h, False) for h in needed):
                    state = "sources_unavailable"
            if state == "checked":
                # A new source candidate/designation cannot inherit an older review.
                old_id = next(
                    e["generation_id"]
                    for e in review.evidence
                    if e.get("generation_id")
                )
                old_row, old = storage.cached_review_generation(db, old_id, cache)
                prior = next(
                    (
                        a
                        for a in old["accounts"]
                        if (a["authority"], a["account_id"]) == key
                    ),
                    None,
                )
                if (
                    old_row.first_published_at is None
                    or prior is None
                    or storage.account_facts(prior) != storage.account_facts(current)
                ):
                    state = "identity_source_changed"
        if state != "checked":
            gaps.append({"authority": key[0], "account_id": key[1], "state": state})
            continue
        approved.append((current, review))
        accounts.append(
            {
                "authority": key[0],
                "account_id": key[1],
                "name": current["name"],
                "source_candidate_id": current.get("source_candidate_id"),
                "period_start": review.period_start.isoformat(),
                "period_end": review.period_end.isoformat(),
                "checked_on": review.reviewed_at.date().isoformat(),
                "decision_id": review.id,
            }
        )
    reports = []
    for account, review in approved:
        for report in indexes["account_reports"].get(
            (account["authority"], account["account_id"]), []
        ):
            within = (
                report.get("period_start")
                and review.period_start.isoformat()
                <= report["period_start"]
                <= report["period_end"]
                <= review.period_end.isoformat()
            )
            if not report.get("binding"):
                reports.append(
                    {
                        "report_key": report["report_key"],
                        "authority": report["authority"],
                        "account_id": report["account_id"],
                        "check_status": report["check_status"],
                        "status_basis": "operational",
                        "next_action": report["next_action"],
                        "figures": None,
                        "sources": [],
                    }
                )
                continue
            needed = storage.source_dependencies(g, reports=[report], cache=cache)
            source_available = all(available.get(h, False) for h in needed)
            verified = (
                bool(within)
                and report["check_status"] == "checked"
                and source_available
            )
            figures = (
                [
                    {
                        k: deepcopy(f[k])
                        for k in (
                            "measure",
                            "label",
                            "value",
                            "unit",
                            "currency",
                            "period_start",
                            "period_end",
                            "basis",
                            "source_column",
                        )
                        if k in f
                    }
                    | {"sources": _binding(f["binding"])}
                    for f in report["figures"]
                    if review.period_start.isoformat()
                    <= f["period_start"]
                    <= f["period_end"]
                    <= review.period_end.isoformat()
                ]
                if verified
                else None
            )
            reports.append(
                {
                    **{
                        k: deepcopy(report.get(k))
                        for k in (
                            "report_key",
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
                            "source_sha256",
                        )
                    },
                    "figures": figures,
                    "withheld_measures": [
                        {"measure": f["measure"], "state": "period_not_covered"}
                        for f in report.get("figures") or []
                        if verified
                        and not review.period_start.isoformat()
                        <= f["period_start"]
                        <= f["period_end"]
                        <= review.period_end.isoformat()
                    ],
                    "status_basis": "sources_unavailable"
                    if not source_available
                    else "operational"
                    if report["check_status"] in storage.OPERATIONAL_COVERAGE
                    else "checked_source",
                    **(
                        {"next_action": report["next_action"]}
                        if report.get("next_action")
                        else {}
                    ),
                    "check_status": "sources_unavailable"
                    if not source_available
                    else "checked"
                    if verified
                    else report["check_status"]
                    if report["check_status"] != "checked"
                    else "period_not_covered"
                    if not within
                    else "sources_unavailable",
                    "sources": _binding(
                        storage.bindings(report.get("binding"))
                        + storage.bindings(report.get("status_binding"))
                    )
                    if source_available
                    else [],
                }
            )
    payments: list[dict[str, Any]] = []
    target_payments = {
        p["payment_key"]: p
        for account, _ in approved
        for p in indexes["target_payments"].get(
            (account["authority"], account.get("source_candidate_id")), []
        )
    }
    for payment in target_payments.values():
        report = indexes["reports"].get(payment["report_key"])
        is_memo = storage.supplemental_memo(payment)
        matches = [
            (a, r)
            for a, r in approved
            if a.get("source_candidate_id") is not None
            and payment.get("target_source_candidate_id") == a["source_candidate_id"]
            and a["authority"] == payment["authority"]
            and payment.get("date") is not None
            and (
                (
                    report is not None
                    and r.period_start.isoformat()
                    <= report["period_start"]
                    <= report["period_end"]
                    <= r.period_end.isoformat()
                )
                if is_memo
                else r.period_start.isoformat()
                <= payment["date"]
                <= r.period_end.isoformat()
            )
        ]
        if (
            not matches
            or payment["check_status"] != "checked"
            or report is None
            or report["check_status"] != "checked"
        ):
            continue
        needed = storage.source_dependencies(g, payments=[payment], cache=cache)
        if not all(available.get(h, False) for h in needed):
            continue
        payments.append(
            {
                **{
                    k: deepcopy(payment.get(k))
                    for k in (
                        "payment_key",
                        "authority",
                        "account_id",
                        "source_row_id",
                        "source_report_id",
                        "report_key",
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
                },
                "payee_address": deepcopy(payment.get("payee_address")),
                "payer": {
                    k: indexes["accounts"][
                        (payment["authority"], payment["account_id"])
                    ][k]
                    for k in ("authority", "account_id", "name")
                }
                if indexes["accounts"][(payment["authority"], payment["account_id"])][
                    "status"
                ]
                == "checked"
                else None,
                "amount_role": "supplemental_memo" if is_memo else "reported_payment",
                "nonadditive": is_memo,
                "period_start": report["period_start"],
                "period_end": report["period_end"],
                "effective": report["effective"],
                "sources": _binding(payment["binding"]),
            }
        )
    payments.sort(key=lambda payment: payment["payment_key"])
    coverage = indexes["coverage"].get(candidate.get("candidate_stable_id"))
    result = {
        **ctx,
        "race_id": race_id,
        "candidate_id": candidate_id,
        "coverage": _public_coverage(coverage, available, g, cache=cache)
        if coverage
        else {"status": "unmatched", "next_action": "Check this exact ballot identity"},
        "accounts": accounts,
        "account_gaps": gaps,
        "reports": reports,
        "payments": payments,
        "measure_note": "Each source measure and reporting period stays separate; no overlapping amounts are added",
    }

    _source_dates(result, g, available)
    return result


def payment_records(db, *, limit=100, offset=0, effective_only=True, **kwargs):
    if (
        type(limit) is not int
        or type(offset) is not int
        or not 1 <= limit <= 200
        or offset < 0
    ):
        _problem(400, "Invalid payment page.")
    result = candidate_finance(db, **kwargs)
    rows = [p for p in result.pop("payments") if p["effective"] or not effective_only]
    return {
        **result,
        "rows": rows[offset : offset + limit],
        "page": {
            "total": len(rows),
            "offset": offset,
            "limit": limit,
            "has_more": offset + limit < len(rows),
        },
    }


class _ReadCache:
    """Bounded per-request compressed cache; never retained across requests."""

    def __init__(self, store, limit=64 * 1024 * 1024):
        self.store, self.limit, self.size, self.entries = store, limit, 0, OrderedDict()

    def get(self, key, path, *, max_bytes=None):
        if key in self.entries:
            body = self.entries.pop(key)
            self.entries[key] = body
            if max_bytes is not None and len(body) > max_bytes:
                raise ComparisonImportError("Source exceeds retained length")
            Path(path).write_bytes(body)
            return
        self.store.get(key, path, max_bytes=max_bytes)
        body = Path(path).read_bytes()
        if len(body) <= self.limit:
            while self.entries and self.size + len(body) > self.limit:
                _, old = self.entries.popitem(last=False)
                self.size -= len(old)
            self.entries[key] = body
            self.size += len(body)


def _source_dates(value, generation, available):
    metadata = {source["sha256"]: source for source in generation["sources"]}

    def visit(item):
        if isinstance(item, dict):
            h = item.get("source_sha256")
            if h in metadata and available.get(h, False) and "locator" in item:
                item["source_copied_at"] = metadata[h]["copied_at"]
                item["source_url"] = metadata[h]["url"]
            for child in list(item.values()):
                visit(child)
        elif isinstance(item, list):
            for child in item:
                visit(child)

    visit(value)


def _own_payments(entry, indexes, generation, available, cache):
    """Own-account detail needs the entire containing report's checked interval.

    This is separate from candidate-targeted support, even when both refer to
    the same literal row. No direction or expense classification is invented.
    """
    checked = {
        r["report_key"] for r in entry["reports"] if r["check_status"] == "checked"
    }
    rows = {}
    for account in entry["accounts"]:
        key = (account["authority"], account["account_id"])
        for payment in indexes["account_payments"].get(key, []):
            if (
                payment["report_key"] not in checked
                or payment["check_status"] != "checked"
            ):
                continue
            needed = storage.source_dependencies(
                generation, payments=[payment], cache=cache
            )
            if not all(available.get(h, False) for h in needed):
                continue
            report = indexes["reports"][payment["report_key"]]
            memo = storage.supplemental_memo(payment)
            rows[payment["payment_key"]] = {
                k: deepcopy(payment.get(k))
                for k in (
                    "payment_key",
                    "authority",
                    "account_id",
                    "source_row_id",
                    "source_report_id",
                    "report_key",
                    "date",
                    "payee",
                    "purpose",
                    "amount",
                    "currency",
                    "direction",
                    "transaction_type",
                    "memo",
                    "payee_address",
                )
            } | {
                "payer": {k: account[k] for k in ("authority", "account_id", "name")},
                "amount_role": "supplemental_memo" if memo else "reported_payment",
                "nonadditive": memo,
                "period_start": report["period_start"],
                "period_end": report["period_end"],
                "effective": report["effective"],
                "sources": _binding(payment["binding"]),
            }
    return [rows[key] for key in sorted(rows)]


def bulk_finance(db, *, election_key, generation_id=None, version=None, store=None):
    """One generation/read scope for analytics, without per-candidate reloads.

    All current relevant originals are checked in this deliberate bulk scope.
    Compressed bytes are cached up to 64 MiB, and decoded bodies are discarded.
    Real-corpus run time remains a measured deployment acceptance requirement.
    """
    store = _ReadCache(store or raw_file_store_from_env())
    cache = {}
    state = _context(
        db,
        election_key=election_key,
        generation_id=generation_id,
        version=version,
        store=store,
        all_scope=True,
        cache=cache,
    )
    ctx, g, _, _, histories, bodies, available, store = state
    grouped = {}
    for review in histories:
        grouped.setdefault((review.race_id, review.candidate_id), []).append(review)
    races = {
        r.id: r
        for r in db.scalars(
            select(m.ElectionComparisonRace).where(
                m.ElectionComparisonRace.snapshot_id == g["snapshot_id"]
            )
        )
    }
    candidates = []
    indexes = _indexes(g)
    for (race_id, candidate_id), history in sorted(grouped.items()):
        race = races.get(race_id)
        candidate = (
            next(
                (
                    c
                    for c in race.payload["candidates"]
                    if c["candidate_id"] == candidate_id
                    and not c.get("is_write_in_aggregate")
                ),
                None,
            )
            if race is not None
            else None
        )
        if candidate is not None:
            entry = _candidate_records(
                db,
                (ctx, g, race, candidate, history, bodies, available, store),
                cache=cache,
                indexes=indexes,
            )
            entry["own_payments"] = _own_payments(entry, indexes, g, available, cache)
            _source_dates(entry["own_payments"], g, available)
            candidates.append({k: v for k, v in entry.items() if k not in ctx})
    return {
        **ctx,
        "coverage": [
            _public_coverage(r, available, g, cache=cache) for r in g["coverage"]
        ],
        "candidates": candidates,
        "authorities": [
            {k: a[k] for k in ("key", "name", "jurisdiction", "publisher_url")}
            for a in g["authorities"]
            if a["status"] == "checked"
            and a.get("binding")
            and all(
                available.get(h, False) for h in storage.binding_hashes(a["binding"])
            )
        ],
        "sources": [
            public_source(source)
            for source in g["sources"]
            if available.get(source["sha256"], False)
        ],
        "measure_note": "Historical and overlapping reports remain separate; no totals are inferred",
    }


def source_body(db, *, election_key, generation_id, source_hash, store=None):
    finance_versions.pin(db)
    row = _published_row(db, election_key, generation_id)
    if not storage.fingerprint(source_hash):
        _problem(404, "Source not found in this published generation.")
    selected = db.scalar(
        select(
            func.jsonb_path_query_array(
                m.ElectionExternalFinanceGeneration.payload,
                cast('$.sources[*] ? (@.sha256 == "' + source_hash + '")', JSONPATH),
            )
        ).where(m.ElectionExternalFinanceGeneration.id == row.id)
    )
    metadata = selected[0] if selected and len(selected) == 1 else None
    if metadata is None:
        _problem(404, "Source not found in this published generation.")
    try:
        row = db.get(m.ElectionResultSource, source_hash)
        if row is None:
            raise ComparisonImportError("Missing original")
        body = read_source(store or raw_file_store_from_env(), row)
    except Exception:
        _problem(503, "This retained source is unavailable. Try again.")
    media_type = metadata["media_type"]
    extension = {
        "application/pdf": "pdf",
        "application/json": "json",
        "text/plain": "txt",
        "text/html": "html",
    }.get(media_type, "bin")
    return (
        body,
        public_source(metadata),
        {
            "Content-Type": "application/octet-stream",
            "Content-Disposition": f'attachment; filename="external-finance-{source_hash}.{extension}"',
            "X-Content-Type-Options": "nosniff",
        },
    )
