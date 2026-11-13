"""Authenticated-boundary reads of published federal/local finance generations.

The parent router applies Finance authentication. No acquisition endpoint exists.
Public dictionaries are explicit allowlists; proposals and private review notes
cannot become checked candidate figures through source capture alone.
"""

from __future__ import annotations

from copy import deepcopy
from functools import wraps
from types import SimpleNamespace
from typing import Any, NoReturn
from urllib.parse import quote, urlencode

from sqlalchemy import cast, func, select
from sqlalchemy.dialects.postgresql import JSONPATH
from sqlalchemy.orm import defer

from alethical.api.problems import problem_exception
from alethical.api.services import finance_versions
from alethical.api.services.election_source_io import request_store, source_map
from alethical.db import models as m
from alethical.pipeline import election_account_reviews as reviews
from alethical.pipeline import election_external_finance as storage
from alethical.pipeline.election_comparison import (
    ComparisonImportError,
    digest,
    read_source,
)
from alethical.pipeline.election_source_files import (
    SourceFileLimitError,
    verified_source_files,
)
from alethical.api.services.election_source_io import (
    reader_store_from_env as raw_file_store_from_env,
)


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


def _public_account_identity(account):
    """Describe a checked account's key without presenting an internal key as issued."""
    if account.get("issued_id") is not False:
        return {}
    basis = account.get("reviewed_key_basis") or {}
    publisher = (
        account.get("publisher_account") or {}
        if basis.get("kind") == "local_filing_context:v1"
        else {}
    )
    if (
        publisher.get("kind") == "physical_section"
        and publisher.get("issued_id") is False
    ):
        return {
            "issued_id": False,
            "account_id_kind": "physical_section",
            "source_section": {
                "source_sha256": basis["original_sha256"],
                "page": basis["cover"]["page"],
            },
        }
    return {"issued_id": False, "account_id_kind": "publisher_catalogue_group"}


def _binding(value, *, reading_context=None, source_section=None):
    result = []
    for binding in storage.bindings(value):
        if not isinstance(binding, dict):
            continue
        locator = deepcopy(binding.get("locator", {}))
        if binding.get("adapter") in storage.LOCAL_READING_ADAPTERS:
            locator = {
                k: deepcopy(locator[k])
                for k in ("page", "row", "field")
                if k in locator
            }
            original = binding.get("locator", {})
            if original.get("field_id"):
                locator["field"] = original["field_id"]
            if (
                "page" not in locator
                and reading_context is not None
                and original.get("receipt_sha256")
            ):
                receipt = reading_context.receipt(original["receipt_sha256"])
                if binding["source_sha256"] == receipt["original_sha256"]:
                    field = next(
                        (
                            f
                            for f in receipt["fields"]
                            if f["field_id"] == original.get("field_id")
                        ),
                        None,
                    )
                    if field is not None:
                        locator["page"] = field["page"]
            if binding["adapter"] == "local_native_form:v1":
                locator["page"] = 1  # The fixed native adapter reads page1 only.
                if original.get("kind") == "payment":
                    row_id = (binding.get("facts") or {}).get("source_row_id", "")
                    if row_id.rsplit(":", 1)[-1].isdigit():
                        locator["row"] = int(row_id.rsplit(":", 1)[-1])
        if (
            "page" not in locator
            and source_section is not None
            and binding["source_sha256"] == source_section["source_sha256"]
        ):
            locator["page"] = source_section["page"]
        result.append(
            {
                "source_sha256": binding["source_sha256"],
                "locator": locator,
                "quote": binding["quote"],
            }
        )
    return result


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
    jobs = [
        (
            h,
            SimpleNamespace(
                **{
                    key: getattr(rows[h], key)
                    for key in (
                        "content_hash",
                        "object_key",
                        "byte_size",
                        "compressed_hash",
                        "compressed_byte_size",
                        "compression",
                    )
                }
            )
            if h in rows
            else None,
        )
        for h in sorted(hashes)
    ]

    def checked(job):
        h, row = job
        try:
            if row is None:
                raise ComparisonImportError("Missing original")
            if row.byte_size > 16 * 1024 * 1024:
                with verified_source_files(store, [row]):
                    pass
            else:
                read_source(store, row)
            return h, True
        except SourceFileLimitError:
            raise
        except Exception:
            return h, False

    # The general I/O pool is wider than the bounded large-file budget. Do not
    # let one report compete with itself for file reservations.
    large = [
        job
        for job in jobs
        if job[1] is not None and job[1].byte_size > 16 * 1024 * 1024
    ]
    small = [
        job for job in jobs if job[1] is None or job[1].byte_size <= 16 * 1024 * 1024
    ]
    available.update(source_map(checked, small))
    available.update(checked(job) for job in large)
    return bodies, available


def _source_capacity_errors(operation):
    @wraps(operation)
    def wrapped(*args, **kwargs):
        try:
            return operation(*args, **kwargs)
        except SourceFileLimitError:
            raise problem_exception(
                503,
                "Service Unavailable",
                "Records are busy",
                headers={"Retry-After": "1"},
            ) from None

    return wrapped


@_source_capacity_errors
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
    store = request_store(store or raw_file_store_from_env())
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
    reading_versions = {}
    for selected in [
        g,
        *[
            value[1]
            for key, value in cache.items()
            if isinstance(key, tuple) and key[0] == "published_review_view"
        ],
    ]:
        state = storage.reading_state(selected, cache)
        if state:
            reading_versions[selected["id"]] = state
            for requirement in storage._reading_requirements(selected, cache).values():
                if requirement:
                    hashes.update(requirement["original_hashes"])
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
    # Verify each selected generation's healthy local readings once, outside the
    # candidate loop. Invalid/withdrawn receipts remain explicit unavailable
    # dependencies; they cannot poison an unrelated checked reading.
    reading_plans = {}
    for selected in [
        g,
        *[
            value[1]
            for key, value in cache.items()
            if isinstance(key, tuple) and key[0] == "published_review_view"
        ],
    ]:
        plan = reading_plans.setdefault(
            selected["id"], {"ids": set(), "sources": set(), "generation": selected}
        )
        plan["sources"].update(source["sha256"] for source in selected["sources"])
        for rid, requirement in storage._reading_requirements(selected, cache).items():
            if (
                requirement
                and storage._current_readings(selected, {rid}, cache)
                and all(available.get(h, False) for h in requirement["original_hashes"])
            ):
                plan["ids"].add(rid)
    from alethical.pipeline import election_source_readings as readings

    cache["source_availability"] = available
    proof_outcomes = {
        selected_id: {rid: False for rid in state}
        for selected_id, state in reading_versions.items()
    }
    cache["local_reading_outcomes"] = proof_outcomes
    reading_proof_versions = {}
    for selected_id, plan in reading_plans.items():
        if plan["ids"]:
            proof = readings.load_verified_reading_context(
                db,
                store,
                plan["ids"],
                allowed_source_hashes=plan["sources"],
                partial=True,
                election_date=storage.reading_election_date(db, plan["generation"]),
            )
            cache[("verified_local_readings", selected_id)] = proof
            reading_proof_versions[selected_id] = proof.version
            proof_outcomes.setdefault(selected_id, {}).update(proof.proof_outcomes)
            for h in proof.failed_sources:
                available[h] = False
    cache["local_reading_views_planned"] = True
    # All source-dependent identity checks finish before the version is minted.
    # The later candidate assembly reuses only this request's verdicts, so an LRU
    # miss/failure cannot change figures after the pin was compared.
    validation_failures = []
    if race_id is not None or all_scope:
        selected_races = (
            {race.id: race}
            if race is not None
            else {
                r.id: r
                for r in db.scalars(
                    select(m.ElectionComparisonRace).where(
                        m.ElectionComparisonRace.snapshot_id == row.snapshot_id
                    )
                )
            }
        )
        cache["selected_races"] = selected_races
        latest_reviews = {}
        for review in histories:
            latest_reviews[
                (
                    review.race_id,
                    review.candidate_id,
                    review.authority,
                    review.registration_number,
                )
            ] = review
        for review in latest_reviews.values():
            selected_race = selected_races.get(review.race_id)
            selected_candidate = (
                next(
                    (
                        c
                        for c in selected_race.payload["candidates"]
                        if c["candidate_id"] == review.candidate_id
                        and not c.get("is_write_in_aggregate")
                    ),
                    None,
                )
                if selected_race is not None
                else None
            )
            if (
                review.decision == "confirmed"
                and selected_race is not None
                and selected_candidate is not None
                and review.identity
                == reviews.candidate_identity(selected_race, selected_candidate)
            ):
                if not storage.account_review_available(
                    db,
                    review,
                    selected_race,
                    selected_candidate,
                    store=store,
                    cache=cache,
                ):
                    validation_failures.append(review.request_key)
    for selected in [
        g,
        *[
            value[1]
            for key, value in cache.items()
            if isinstance(key, tuple) and key[0] == "published_review_view"
        ],
    ]:
        for rid, requirement in storage._reading_requirements(selected, cache).items():
            if requirement and not all(
                available.get(h, False) for h in requirement["original_hashes"]
            ):
                proof_outcomes.setdefault(selected["id"], {})[rid] = False
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
            **(
                {
                    "source_readings": reading_versions,
                    "reading_proof": proof_outcomes,
                    "reading_proof_versions": reading_proof_versions,
                }
                if reading_versions
                else {}
            ),
            **(
                {"validation_failures": sorted(validation_failures)}
                if validation_failures
                else {}
            ),
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


def _coverage_gap(status):
    # Collection notes describe private work. Publish only the known source gap.
    return {
        "not_collected": "Reports not collected",
        "retrieval_failed": "Reports unavailable",
        "unreadable": "Report could not be read",
        "unmatched": "Campaign account not confirmed",
        "source_conflict": "Sources disagree",
        "catalogue_checked_not_found": "No report found in the checked catalogue",
        "confirmed_not_published": "Report not published",
        "below_threshold_certified": "Below-threshold filing held",
        "not_due": "Report not yet due",
        "unchecked": "Reports not checked",
        "sources_unavailable": "Source unavailable",
        "period_not_covered": "Outside checked account dates",
        "checked": None,
        "account_confirmed": None,
    }.get(status, "Report figures unavailable")


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
        )
        if k in row
    }

    if not storage.claim_sources_available(
        generation, available, coverage=[row], cache=cache
    ):
        result.update(
            status="unchecked",
            status_basis="sources_unavailable",
        )
    elif row["status"] in storage.OPERATIONAL_COVERAGE:
        result["status_basis"] = "operational"
    else:
        result["status_basis"] = "checked_source"
        result["sources"] = _binding(row["binding"])
    result["gap"] = _coverage_gap(
        "sources_unavailable"
        if result["status_basis"] == "sources_unavailable"
        else result["status"]
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
    reading_context = cache.get(("verified_local_readings", g["id"]))
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
                if not storage.claim_sources_available(
                    g, available, account_keys=[key], cache=cache
                ):
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
                **_public_account_identity(current),
                "period_start": review.period_start.isoformat(),
                "period_end": review.period_end.isoformat(),
                "checked_on": review.reviewed_at.date().isoformat(),
                "decision_id": review.id,
            }
        )
    reports = []
    for account, review in approved:
        source_section = _public_account_identity(account).get("source_section")
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
                        "gap": _coverage_gap(report["check_status"]),
                        "figures": None,
                        "sources": [],
                    }
                )
                continue
            local_fields = bool(storage.local_reading_ids(report))
            source_available = storage.claim_sources_available(
                g,
                available,
                reports=[report],
                cache=cache,
                include_figures=not local_fields,
            )
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
                    | {
                        "sources": _binding(
                            f["binding"],
                            reading_context=reading_context,
                            source_section=source_section,
                        )
                    }
                    for f in report["figures"]
                    if review.period_start.isoformat()
                    <= f["period_start"]
                    <= f["period_end"]
                    <= review.period_end.isoformat()
                    and (
                        not local_fields
                        or storage.claim_sources_available(
                            g,
                            available,
                            reports=[{**report, "figures": [f]}],
                            cache=cache,
                        )
                    )
                ]
                if verified
                else None
            )
            field_gaps = []
            if source_available and local_fields:
                requirements = storage._reading_requirements(g, cache)
                for rid in storage.local_reading_ids(report.get("binding")):
                    requirement = requirements.get(rid)
                    if requirement and storage._current_readings(g, {rid}, cache):
                        for gap in requirement.get("field_gaps", []):
                            field_gaps.append(
                                {
                                    k: deepcopy(gap[k])
                                    for k in ("measure", "label", "state", "literal")
                                }
                                | {
                                    "sources": [
                                        {
                                            "source_sha256": gap["source_sha256"],
                                            "locator": {
                                                "page": gap["page"],
                                                "field": gap["field"],
                                            },
                                            "quote": gap["literal"],
                                        }
                                    ]
                                }
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
                    **{
                        k: deepcopy(report[k])
                        for k in ("version_scope", "amendment_status")
                        if k in report
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
                    **(
                        {
                            "unavailable_measures": [
                                {
                                    "measure": f["measure"],
                                    "state": "sources_unavailable",
                                }
                                for f in report.get("figures") or []
                                if verified
                                and local_fields
                                and not storage.claim_sources_available(
                                    g,
                                    available,
                                    reports=[{**report, "figures": [f]}],
                                    cache=cache,
                                )
                            ],
                            "source_field_gaps": field_gaps,
                        }
                        if local_fields
                        else {}
                    ),
                    "status_basis": "sources_unavailable"
                    if not source_available
                    else "operational"
                    if report["check_status"] in storage.OPERATIONAL_COVERAGE
                    else "checked_source",
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
                        + storage.bindings(report.get("status_binding")),
                        reading_context=reading_context,
                        source_section=source_section,
                    )
                    if source_available
                    else [],
                }
            )
            reports[-1]["gap"] = _coverage_gap(reports[-1]["check_status"])
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
        if not storage.claim_sources_available(
            g, available, payments=[payment], cache=cache
        ):
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
                **{
                    k: deepcopy(report[k])
                    for k in ("version_scope", "amendment_status")
                    if k in report
                },
                "sources": _binding(
                    payment["binding"],
                    reading_context=reading_context,
                    source_section=_public_account_identity(
                        indexes["accounts"][
                            (payment["authority"], payment["account_id"])
                        ]
                    ).get("source_section"),
                ),
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
        else {"status": "unmatched", "gap": _coverage_gap("unmatched")},
        "accounts": accounts,
        "account_gaps": gaps,
        "reports": reports,
        "payments": payments,
        "measure_note": "Each source measure and reporting period stays separate; no overlapping amounts are added",
    }

    # A fresh checked account supersedes a collection-time identity gap. This
    # establishes only the account link, never complete or checked money figures.
    if accounts and result["coverage"]["status"] == "unmatched":
        result["coverage"].update(
            status="account_confirmed", status_basis="checked_account", gap=None
        )

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
    rows = [
        p
        for p in result.pop("payments")
        if p["effective"] is True or not effective_only
    ]
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


def _source_dates(value, generation, available):
    metadata = {source["sha256"]: source for source in generation["sources"]}
    base = (
        "/api/v1/finance/elections/"
        + quote(generation["election_key"], safe="")
        + "/external-finance/sources/"
    )
    pin = urlencode({"generation_id": generation["id"]})

    def visit(item):
        if isinstance(item, dict):
            h = item.get("source_sha256")
            if h in metadata and available.get(h, False) and "locator" in item:
                item["source_copied_at"] = metadata[h]["copied_at"]
                item["source_url"] = metadata[h]["url"]
                item["retained_source_url"] = base + h + "?" + pin
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
            if not storage.claim_sources_available(
                generation, available, payments=[payment], cache=cache
            ):
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
                **{
                    k: deepcopy(report[k])
                    for k in ("version_scope", "amendment_status")
                    if k in report
                },
                "sources": _binding(
                    payment["binding"],
                    reading_context=cache.get(
                        ("verified_local_readings", generation["id"])
                    ),
                    source_section=account.get("source_section"),
                ),
            }
    return [rows[key] for key in sorted(rows)]


def bulk_finance(db, *, election_key, generation_id=None, version=None, store=None):
    """One generation/read scope for analytics, without per-candidate reloads.

    All current relevant originals are checked in this deliberate bulk scope.
    Compressed bytes are cached up to 64 MiB, and decoded bodies are discarded.
    Real-corpus run time remains a measured deployment acceptance requirement.
    """
    store = request_store(store or raw_file_store_from_env())
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
    races = cache.get("selected_races")
    if races is None:
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
    reviewed_coverage = {
        entry["coverage"]["stable_id"]: entry["coverage"]
        for entry in candidates
        if entry["coverage"].get("stable_id")
    }
    return {
        **ctx,
        "coverage": [
            reviewed_coverage.get(r["stable_id"])
            or _public_coverage(r, available, g, cache=cache)
            for r in g["coverage"]
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
        body = read_source(request_store(store or raw_file_store_from_env()), row)
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
