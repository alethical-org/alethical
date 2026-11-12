"""Original-backed external claims, explicit identities and immutable history."""

from copy import deepcopy
from datetime import UTC, date, datetime
import hashlib
import json
from types import SimpleNamespace

import pytest
from sqlalchemy import func, select, update
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

from alethical.db import models as m
from alethical.db.session import get_engine
from alethical.pipeline import election_external_finance as s
from alethical.pipeline import election_account_reviews as reviews
from alethical.pipeline.election_comparison import digest
from alethical.tests.test_election_comparison_storage import MemoryStore


@pytest.fixture
def db(seed_database):
    with (
        get_engine()
        .connect()
        .execution_options(isolation_level="REPEATABLE READ") as connection
    ):
        transaction = connection.begin()
        with Session(
            bind=connection, join_transaction_mode="create_savepoint"
        ) as session:
            yield session
        transaction.rollback()


def rehash(g):
    g["id"] = s.generation_digest(g)
    return g


@pytest.fixture
def external(db, monkeypatch):
    store = MemoryStore()
    monkeypatch.setattr(s, "ADAPTERS", {})
    monkeypatch.setattr(reviews, "raw_file_store_from_env", lambda: store)
    now = datetime(2026, 11, 11, 15, tzinfo=UTC)
    ballot = b"00000001;Candidate Example;0001;U.S. Senator;88;01;DFL\n"
    local = b"0000000000001;Local Example;1000;Mayor;01;00001;\n"
    ballot_hash, local_hash = (hashlib.sha256(b).hexdigest() for b in (ballot, local))

    def metadata(h, name):
        return {
            "sha256": h,
            "authority": None,
            "url": "https://electionresultsfiles.sos.mn.gov/20261103/" + name,
            "file": name,
            "media_type": "text/plain",
            "copied_at": now.isoformat(),
        }

    sources = [
        metadata(ballot_hash, "cand.txt"),
        metadata(local_hash, "LocalCandTbl.txt"),
    ]
    snapshot = m.ElectionComparisonSnapshot(
        id=digest("external test ballot"),
        election_key="mn-2026-11-03-general",
        election_date=date(2026, 11, 3),
        stage="general",
        fetched_at=now,
        sources=sources,
        coverage={},
    )
    db.add(snapshot)
    db.flush()
    candidate = {
        "candidate_id": "00000001",
        "candidate_stable_id": "cand:201:2026-11-03:general:88:0001:00000001",
        "name": "Candidate Example",
        "party": "DFL",
        "is_write_in_aggregate": False,
        "votes": 1,
    }
    race = m.ElectionComparisonRace(
        snapshot_id=snapshot.id,
        id=digest("external race"),
        label="U.S. Senator",
        office_id="0001",
        jurisdiction="88",
        result_status="unofficial",
        payload={
            "office_name": "U.S. Senator",
            "district": None,
            "candidate_source_sha256": ballot_hash,
            "candidates": [candidate],
        },
    )
    db.add(race)
    db.flush()
    records = []

    def binding(facts):
        row = len(records)
        records.append(deepcopy(facts))
        return {
            "source_sha256": None,
            "adapter": "synthetic:v1",
            "locator": {"row": row},
            "quote": json.dumps(facts, sort_keys=True),
            "facts": deepcopy(facts),
        }

    authority = {
        "key": "fec",
        "name": "Federal Election Commission",
        "jurisdiction": "United States",
        "publisher_url": "https://www.fec.gov",
        "status": "checked",
    }
    authority["binding"] = binding(s.authority_facts(authority))
    account = {
        "authority": "fec",
        "account_id": "C00000001",
        "name": "Example Committee",
        "source_candidate_id": "S6MN00001",
        "candidate_name": candidate["name"],
        "issued_id": True,
        "reviewed_key_basis": None,
        "jurisdiction": "United States",
        "status": "checked",
    }
    account["binding"] = binding(s.account_facts(account))
    reports = []
    for index in range(2):
        report = {
            "report_key": digest(["synthetic report", index]),
            "authority": "fec",
            "account_id": account["account_id"],
            "source_report_id": str(index + 100),
            "series_id": "cycle-period-1",
            "report_type": "F3:synthetic",
            "period_start": "2025-01-01",
            "period_end": "2026-10-14",
            "received_date": "2026-10-20",
            "predecessor_report_key": reports[0]["report_key"] if index else None,
            "effective": index == 1,
            "source_sha256": None,
            "locator": {"row": len(records)},
            "check_status": "checked",
            "raw_metadata": {
                "reviewed_by": "PRIVATE_REVIEWER",
                "reason": "PRIVATE_REASON",
                "path": "/private/internal",
            },
            "figures": [],
        }
        report["binding"] = binding(s.report_facts(report))
        for measure, value in [
            ("contributions", "0.00"),
            ("total_disbursements", "12.3400"),
        ]:
            figure = {
                "measure": measure,
                "label": measure.replace("_", " "),
                "value": value,
                "unit": "money",
                "currency": "USD",
                "period_start": report["period_start"],
                "period_end": report["period_end"],
            }
            figure["binding"] = binding(
                {
                    **figure,
                    **{
                        k: report[k]
                        for k in ("authority", "account_id", "source_report_id")
                    },
                }
            )
            report["figures"].append(figure)
        reports.append(report)
    payments = []
    for index, direction in enumerate(("independent_for", "independent_against")):
        p = {
            "payment_key": digest(["synthetic payment", index]),
            "authority": "fec",
            "account_id": account["account_id"],
            "source_row_id": str(index + 1),
            "source_report_id": reports[-1]["source_report_id"],
            "report_key": reports[-1]["report_key"],
            "date": "2026-10-01",
            "target_source_candidate_id": account["source_candidate_id"],
            "payee": "Source Payee",
            "purpose": "Literal source purpose",
            "amount": "123.4500" if index == 0 else "0.00",
            "currency": "USD",
            "direction": direction,
            "transaction_type": "periodic_schedule_e",
            "memo": "source memo",
            "source_sha256": None,
            "locator": {"row": len(records)},
            "check_status": "checked",
            "raw_metadata": {"private": "PRIVATE_REASON"},
        }
        p["binding"] = binding(s.payment_facts(p))
        payments.append(p)
    designation = binding(
        {
            "authority": "fec",
            "account_id": account["account_id"],
            "source_candidate_id": account["source_candidate_id"],
            "election_year": 2026,
            "office": "S",
            "state": "MN",
            "district": "00",
        }
    )
    body = json.dumps(
        {"schema": "trusted-synthetic-v1", "records": records}, sort_keys=True
    ).encode()
    source_hash = hashlib.sha256(body).hexdigest()

    def fill(value):
        if isinstance(value, dict):
            for k, v in value.items():
                if k == "source_sha256" and v is None:
                    value[k] = source_hash
                else:
                    fill(v)
        elif isinstance(value, list):
            for v in value:
                fill(v)

    for value in (authority, account, reports, payments, designation):
        fill(value)
    sources = [
        *sources,
        {
            "sha256": source_hash,
            "authority": "fec",
            "url": "https://www.fec.gov/synthetic.json",
            "media_type": "application/json",
            "copied_at": now.isoformat(),
            "object_key": "PRIVATE_OBJECT_KEY",
        },
    ]
    originals = {ballot_hash: ballot, local_hash: local, source_hash: body}

    def adapter(raw, source, locator):
        assert (
            source["authority"] == "fec"
            and source["url"] == "https://www.fec.gov/synthetic.json"
        )
        payload = json.loads(raw)
        assert payload["schema"] == "trusted-synthetic-v1"
        assert set(locator) == {"row"}
        facts = payload["records"][locator["row"]]
        quote = json.dumps(facts, sort_keys=True)
        assert quote in raw.decode()
        return s.CheckedExtraction(facts, quote)

    s.register_adapter("synthetic:v1", adapter)
    expected = s.expected_coverage(snapshot, [race], originals)
    g = s.prepare_generation(
        {
            "format": 1,
            "election_key": snapshot.election_key,
            "snapshot_id": snapshot.id,
            "copied_at": now.isoformat(),
            "sources": sources,
            "authorities": [authority],
            "accounts": [account],
            "reports": reports,
            "payments": payments,
            "coverage": [
                {
                    **r,
                    "authority": "fec" if r["authority_family"] == "federal" else None,
                    "status": "unmatched",
                    "next_action": "Explicit exact-source account review",
                }
                for r in expected
            ],
        }
    )
    args = {
        "snapshot_id": snapshot.id,
        "race_id": race.id,
        "candidate_id": candidate["candidate_id"],
        "registration_number": account["account_id"],
        "authority": "fec",
        "decision": "confirmed",
        "identity": reviews.candidate_identity(race, candidate),
        "period_start": date(2025, 1, 1),
        "period_end": date(2026, 10, 14),
        "evidence": [
            {
                "kind": "ballot",
                "sha256": ballot_hash,
                "row_number": 1,
                "literal_row": ballot.decode().strip(),
            },
            *[
                {
                    "kind": kind,
                    "sha256": source_hash,
                    "generation_id": g["id"],
                    "binding": bind,
                    **extra,
                }
                for kind, bind, extra in [
                    ("authority", authority["binding"], {}),
                    ("committee_register", account["binding"], {}),
                    (
                        "report_cover",
                        reports[-1]["binding"],
                        {"report_key": reports[-1]["report_key"]},
                    ),
                    ("designation", designation, {}),
                ]
            ],
        ],
        "reason": "PRIVATE_REASON",
        "reviewed_by": "PRIVATE_REVIEWER",
        "expected_previous_id": None,
    }
    return SimpleNamespace(
        g=g,
        originals=originals,
        store=store,
        snapshot=snapshot,
        race=race,
        candidate=candidate,
        args=args,
        source_hash=source_hash,
        account=account,
    )


def stage(db, ctx):
    return s.stage_generation(db, ctx.store, ctx.g, ctx.originals)


def publish(db, ctx):
    stage(db, ctx)
    return s.publish_generation(db, ctx.store, ctx.g["id"], expected_previous=None)


def test_exact_decimals_zero_missing_and_history_are_preserved(db, external):
    ctx = external
    stage(db, ctx)
    _, g = s.load_generation(db, ctx.g["id"])
    assert len(g["reports"]) == 2
    assert [
        r["effective"]
        for r in sorted(g["reports"], key=lambda r: r["source_report_id"])
    ] == [False, True]
    figures = g["reports"][0]["figures"]
    assert {r["measure"]: r["value"] for r in figures} == {
        "contributions": "0.00",
        "total_disbursements": "12.3400",
    }
    assert not any(r["measure"] == "receipts" for r in figures)
    assert s.stage_generation(db, ctx.store, deepcopy(ctx.g), {}) == ctx.g["id"]
    assert (
        db.scalar(select(func.count()).select_from(m.ElectionExternalFinancePayment))
        == 2
    )


@pytest.mark.parametrize(
    "change",
    [
        "hash",
        "value",
        "authority",
        "quote",
        "locator",
        "unsupported",
        "coverage",
        "multiple_effective",
        "lineage",
        "float",
        "duplicate_payment",
    ],
)
def test_invalid_or_unbound_claims_cannot_stage(db, external, change):
    ctx = external
    g = deepcopy(ctx.g)
    originals = dict(ctx.originals)
    if change == "hash":
        originals[ctx.source_hash] += b"changed"
    elif change == "value":
        g["reports"][1]["figures"][0]["value"] = "999.00"
    elif change == "authority":
        g["sources"][-1]["authority"] = None
    elif change == "quote":
        g["reports"][1]["binding"]["quote"] = "operator text"
    elif change == "locator":
        g["reports"][1]["binding"]["locator"] = {"row": 0}
    elif change == "unsupported":
        g["reports"][1]["binding"]["adapter"] = "unsupported:v1"
    elif change == "coverage":
        g["coverage"].pop()
    elif change == "multiple_effective":
        g["reports"][0]["effective"] = True
    elif change == "lineage":
        g["reports"][1]["series_id"] = "unrelated"
    elif change == "float":
        g["payments"][0]["amount"] = 123.45
    else:
        g["payments"][1]["source_row_id"] = g["payments"][0]["source_row_id"]
    rehash(g)
    with pytest.raises(ComparisonImportError):
        s.stage_generation(db, ctx.store, g, originals)
    assert (
        db.scalar(select(func.count()).select_from(m.ElectionExternalFinanceGeneration))
        == 0
    )


from alethical.pipeline.election_comparison import ComparisonImportError  # noqa: E402


def test_unchecked_stage_cannot_confirm_or_supply_checked_figures(
    db, external, monkeypatch
):
    ctx = external
    g = deepcopy(ctx.g)
    g["authorities"][0]["status"] = "unchecked"
    g["accounts"][0]["status"] = "unchecked"
    for report in g["reports"]:
        report.update(
            check_status="unchecked",
            figures=None,
            binding=None,
            next_action="Recover exact source metadata and figures",
        )
    for payment in g["payments"]:
        payment.update(check_status="unchecked", amount=None)
    rehash(g)
    monkeypatch.setattr(s, "ADAPTERS", {})
    s.stage_generation(db, ctx.store, g, ctx.originals)
    s.publish_generation(db, ctx.store, g["id"], expected_previous=None)
    args = deepcopy(ctx.args)
    for e in args["evidence"]:
        if "generation_id" in e:
            e["generation_id"] = g["id"]
    with pytest.raises(ComparisonImportError, match="Unchecked"):
        reviews.record_decision(db, **args)


def test_cas_restore_append_only_and_original_loss(db, external):
    ctx = external
    publish(db, ctx)
    second = deepcopy(ctx.g)
    second["coverage"][0]["next_action"] = "Another explicit pending collection action"
    rehash(second)
    s.stage_generation(db, ctx.store, second, {})
    with pytest.raises(ComparisonImportError, match="changed"):
        s.publish_generation(db, ctx.store, second["id"], expected_previous=None)
    s.publish_generation(db, ctx.store, second["id"], expected_previous=ctx.g["id"])
    s.publish_generation(
        db, ctx.store, ctx.g["id"], expected_previous=second["id"], restore=True
    )
    assert (
        db.get(m.ElectionExternalFinanceCurrent, ctx.g["election_key"]).generation_id
        == ctx.g["id"]
    )
    for model, where in [
        (
            m.ElectionExternalFinanceGeneration,
            m.ElectionExternalFinanceGeneration.id == ctx.g["id"],
        ),
        (
            m.ElectionExternalFinanceReport,
            m.ElectionExternalFinanceReport.generation_id == ctx.g["id"],
        ),
        (
            m.ElectionExternalFinancePayment,
            m.ElectionExternalFinancePayment.generation_id == ctx.g["id"],
        ),
    ]:
        with pytest.raises(SQLAlchemyError):
            with db.begin_nested():
                db.execute(update(model).where(where).values(payload={}))
    row = db.get(m.ElectionResultSource, ctx.source_hash)
    ctx.store.objects.pop(row.object_key)
    with pytest.raises(ComparisonImportError, match="unavailable"):
        s.publish_generation(db, ctx.store, second["id"], expected_previous=ctx.g["id"])


def test_explicit_review_is_repeat_safe_dated_and_board_rules_stay(db, external):
    ctx = external
    stage(db, ctx)
    first = reviews.record_decision(db, **ctx.args)
    assert reviews.record_decision(db, **ctx.args).id == first.id
    with pytest.raises(ComparisonImportError, match="changed"):
        reviews.record_decision(db, **{**ctx.args, "reason": "Another private reason"})
    with pytest.raises(ComparisonImportError, match="unchecked report dates"):
        reviews.record_decision(db, **{**ctx.args, "period_end": date(2026, 12, 31)})
    with pytest.raises(ComparisonImportError, match="calendar year"):
        reviews.record_decision(db, **{**ctx.args, "authority": "mn_cfb"})
    withdrawn = reviews.record_decision(
        db,
        **{
            **ctx.args,
            "decision": "withdrawn",
            "reason": "Withdrawn private reason",
            "expected_previous_id": first.id,
        },
    )
    assert withdrawn.previous_decision_id == first.id


@pytest.mark.parametrize(
    "change", ["candidate", "ballot_row", "authority", "designation", "name"]
)
def test_wrong_identity_or_incomplete_evidence_never_confirms(db, external, change):
    ctx = external
    stage(db, ctx)
    args = deepcopy(ctx.args)
    if change == "candidate":
        args["identity"]["name"] = "Another person"
    elif change == "ballot_row":
        args["evidence"][0]["literal_row"] = (
            "00000002;Another person;0001;U.S. Senator;88;01;DFL"
        )
    elif change == "authority":
        args["authority"] = "local:unrelated-recipient"
    elif change == "designation":
        args["evidence"] = [e for e in args["evidence"] if e["kind"] != "designation"]
    else:
        args["evidence"][2]["binding"]["facts"]["candidate_name"] = (
            "Different source name"
        )
    with pytest.raises(ComparisonImportError):
        reviews.record_decision(db, **args)


def rewrite_original(ctx, records):
    """Change actual retained synthetic facts, then bind every affected claim anew."""
    old_hash = ctx.source_hash
    body = json.dumps(
        {"schema": "trusted-synthetic-v1", "records": records}, sort_keys=True
    ).encode()
    new_hash = hashlib.sha256(body).hexdigest()

    def replace(value):
        if isinstance(value, dict):
            for key, child in value.items():
                if child == old_hash:
                    value[key] = new_hash
                else:
                    replace(child)
            if value.get("adapter") == "synthetic:v1":
                facts = deepcopy(records[value["locator"]["row"]])
                value.update(facts=facts, quote=json.dumps(facts, sort_keys=True))
        elif isinstance(value, list):
            for child in value:
                replace(child)

    replace(ctx.g)
    replace(ctx.args)
    ctx.originals.pop(old_hash)
    ctx.originals[new_hash] = body
    ctx.source_hash = new_hash
    rehash(ctx.g)
    for item in ctx.args["evidence"]:
        if "generation_id" in item:
            item["generation_id"] = ctx.g["id"]


def append_binding(ctx, records, facts):
    binding = {
        "source_sha256": ctx.source_hash,
        "adapter": "synthetic:v1",
        "locator": {"row": len(records)},
        "quote": json.dumps(facts, sort_keys=True),
        "facts": deepcopy(facts),
    }
    records.append(deepcopy(facts))
    return binding


@pytest.mark.parametrize("plain_copy", [False, True])
@pytest.mark.parametrize("historical", [False, True])
@pytest.mark.parametrize(
    "operation", ["digest", "prepare", "validate", "stage", "evidence"]
)
def test_published_read_projection_cannot_enter_full_generation_gates(
    db, external, plain_copy, historical, operation
):
    ctx = external
    publish(db, ctx)
    row = db.get(m.ElectionExternalFinanceGeneration, ctx.g["id"])
    _, view = s.load_published_view(
        db, row, set(), history_report_keys=set() if historical else None
    )
    value = dict(view) if plain_copy else view
    calls = {
        "digest": lambda: s.generation_digest(value),
        "prepare": lambda: s.prepare_generation(value),
        "validate": lambda: s.validate_generation(value),
        "stage": lambda: s.stage_generation(db, ctx.store, value, {}),
        "evidence": lambda: s.verify_evidence(db, ctx.store, value),
    }
    before = dict(ctx.store.objects)
    with pytest.raises(s.ComparisonImportError):
        calls[operation]()
    assert ctx.store.objects == before


def test_published_read_view_refuses_staged_generation(db, external):
    stage(db, external)
    row = db.get(m.ElectionExternalFinanceGeneration, external.g["id"])
    with pytest.raises(s.ComparisonImportError, match="sealed published"):
        s.load_published_view(db, row, set())


def test_unsealed_history_refused_before_any_projection_query(db):
    row = SimpleNamespace(sealed_at=None, first_published_at=None)
    with pytest.raises(s.ComparisonImportError, match="history must be sealed"):
        s.load_published_view(db, row, set(), history_report_keys=set())


def test_read_indexes_cannot_cross_narrow_broad_or_historical_scopes(db, external):
    ctx = external
    publish(db, ctx)
    row = db.get(m.ElectionExternalFinanceGeneration, ctx.g["id"])
    keys = {(ctx.account["authority"], ctx.account["account_id"])}
    _, empty = s.load_published_view(db, row, set())
    _, broad = s.load_published_view(db, row, keys, include_own_payments=True)
    _, history = s.load_review_view(db, ctx.g["id"], keys, ctx.args["evidence"])
    cache = {}
    assert not s._review_indexes(empty, cache)["accounts"]
    assert len(s._review_indexes(broad, cache)["reports"]) == 2
    assert len(s._review_indexes(history, cache)["reports"]) == 1
    assert len(cache) == 3
    assert (
        s._review_indexes(broad, cache)["accounts"]
        == s._review_indexes(history, cache)["accounts"]
    )
    assert len(broad["payments"]) == 2 and not history["payments"]
    assert isinstance(broad, s.PublishedFinanceReadView)
    assert isinstance(history, s.HistoricalFinanceReadView)
    assert ctx.g["id"] not in cache
    # Write-side/full validation caching remains a separate namespace.
    _, complete = s.cached_generation(db, ctx.g["id"], cache)
    assert s.generation_digest(complete) == ctx.g["id"]
    assert complete["coverage"] and len(complete["payments"]) == 2


@pytest.mark.parametrize(
    "status",
    [
        "checked",
        "unreadable",
        "source_conflict",
        "catalogue_checked_not_found",
        "confirmed_not_published",
        "below_threshold_certified",
        "not_due",
    ],
)
def test_factual_coverage_cannot_be_asserted_by_operator_json(db, external, status):
    ctx = external
    ctx.g["coverage"][0]["status"] = status
    rehash(ctx.g)
    with pytest.raises(ComparisonImportError, match="[Cc]overage"):
        stage(db, ctx)


@pytest.mark.parametrize(
    "field,value",
    [
        ("state", "WI"),
        ("office", "H"),
        ("district", "02"),
        ("election_year", 2024),
        ("source_candidate_id", "S6MN99999"),
    ],
)
def test_genuinely_wrong_federal_designation_never_confirms(db, external, field, value):
    ctx = external
    records = json.loads(ctx.originals[ctx.source_hash])["records"]
    designation = next(e for e in ctx.args["evidence"] if e["kind"] == "designation")
    records[designation["binding"]["locator"]["row"]][field] = value
    rewrite_original(ctx, records)
    stage(db, ctx)
    with pytest.raises(ComparisonImportError, match="Binding fields differ"):
        reviews.record_decision(db, **ctx.args)


def test_identical_publication_retry_rechecks_sources_and_keeps_receipt(db, external):
    ctx = external
    first = publish(db, ctx)
    repeated = s.publish_generation(db, ctx.store, ctx.g["id"], expected_previous=None)
    assert repeated["generation_id"] == first["generation_id"]
    assert repeated["already_current"] is True
    held = db.get(m.ElectionResultSource, ctx.source_hash)
    ctx.store.objects.pop(held.object_key)
    with pytest.raises(ComparisonImportError, match="unavailable"):
        s.publish_generation(db, ctx.store, ctx.g["id"], expected_previous=None)


@pytest.mark.parametrize("variant", ["valid", "unrelated_report", "missing_cell"])
def test_source_subsets_require_same_filing_and_every_claimed_cell(
    db, external, variant
):
    ctx = external
    report = ctx.g["reports"][1]
    facts = s.report_facts(report)
    joins = {
        k: facts[k]
        for k in (
            "authority",
            "account_id",
            "source_report_id",
            "period_start",
            "period_end",
        )
    }
    first = {
        **joins,
        **{
            k: v
            for k, v in facts.items()
            if k not in {"effective", "received_date", "predecessor_report_key"}
        },
    }
    second = {
        **joins,
        **{
            k: facts[k]
            for k in ("effective", "received_date", "predecessor_report_key")
        },
    }
    if variant == "unrelated_report":
        second["source_report_id"] = "999999"
    elif variant == "missing_cell":
        second.pop("effective")
    records = json.loads(ctx.originals[ctx.source_hash])["records"]
    report["binding"] = [
        append_binding(ctx, records, first),
        append_binding(ctx, records, second),
    ]
    rewrite_original(ctx, records)
    if variant == "valid":
        stage(db, ctx)
    else:
        with pytest.raises(
            ComparisonImportError,
            match="Binding fields differ|no checked source binding",
        ):
            stage(db, ctx)


def add_checked_coverage(ctx, status="below_threshold_certified"):
    row = next(r for r in ctx.g["coverage"] if r["authority_family"] == "federal")
    row.update(status=status, authority="fec")
    records = json.loads(ctx.originals[ctx.source_hash])["records"]
    row["binding"] = append_binding(ctx, records, s.coverage_facts(row))
    rewrite_original(ctx, records)
    return row


def test_source_backed_coverage_status_never_creates_money(db, external):
    ctx = external
    add_checked_coverage(ctx)
    publish(db, ctx)
    _, stored = s.load_generation(db, ctx.g["id"])
    coverage = next(r for r in stored["coverage"] if r["authority_family"] == "federal")
    assert coverage["status"] == "below_threshold_certified"
    assert "amount" not in coverage and "value" not in coverage


def test_append_only_deletion_and_first_publication_cannot_be_rewritten(db, external):
    from sqlalchemy import delete

    ctx = external
    publish(db, ctx)
    for model in (
        m.ElectionExternalFinanceGeneration,
        m.ElectionExternalFinanceReport,
        m.ElectionExternalFinancePayment,
    ):
        with pytest.raises(SQLAlchemyError):
            with db.begin_nested():
                db.execute(delete(model))
    with pytest.raises(SQLAlchemyError):
        with db.begin_nested():
            db.execute(
                update(m.ElectionExternalFinanceGeneration).values(
                    first_published_at=None
                )
            )


def test_full_synthetic_federal_and_local_roster_reconciles_exactly():
    ballot = "".join(
        f"{i:08d};Federal {i};0001;U.S. Senator;88;01;DFL\n" for i in range(1, 22)
    ).encode()
    local = "".join(
        f"{i:013d};Local {i};1000;Mayor;01;00001;\n" for i in range(1, 7459)
    ).encode()
    hashes = [hashlib.sha256(body).hexdigest() for body in (ballot, local)]
    snapshot = SimpleNamespace(
        election_date=date(2026, 11, 3),
        stage="general",
        fetched_at=datetime(2026, 11, 11, tzinfo=UTC),
        sources=[
            {
                "sha256": h,
                "file": filename,
                "url": "https://electionresultsfiles.sos.mn.gov/20261103/" + filename,
            }
            for h, filename in zip(
                hashes, ("cand.txt", "LocalCandTbl.txt"), strict=True
            )
        ],
    )
    races = [
        SimpleNamespace(
            payload={
                "candidates": [
                    {
                        "candidate_stable_id": "cand:201:2026-11-03:general:88:0001:00000001"
                    }
                ]
            }
        )
    ]
    rows = s.expected_coverage(
        snapshot, races, dict(zip(hashes, (ballot, local), strict=True))
    )
    assert len(rows) == len({row["stable_id"] for row in rows}) == 7479
    assert sum(r["authority_family"] == "federal" for r in rows) == 21
    assert sum(r["authority_family"] == "county_local" for r in rows) == 7458


@pytest.mark.parametrize("change", [None, "county", "type", "number", "missing_type"])
def test_school_recipient_requires_county_number_and_actual_district_type(change):
    expected = {
        "county_id": "01",
        "school_district_number": "0001",
        "municipal_fips_code": None,
        "office": "School Board Member (ISD #1) (Elect 4)",
    }
    jurisdiction = {
        "recipient_id": "0001-01",
        "recipient_type": "school_district",
        "county_ids": ["01"],
        "school_district_number": "0001",
        "school_district_type": "ISD",
    }
    if change == "county":
        jurisdiction.update(
            recipient_id="0001-03", county_ids=["27"], school_district_type="SSD"
        )
    elif change == "type":
        jurisdiction.update(recipient_id="0001-03", school_district_type="SSD")
    elif change == "number":
        jurisdiction["school_district_number"] = "0002"
    elif change == "missing_type":
        jurisdiction.pop("school_district_type")
    if change is None:
        s.validate_local_recipient(expected, jurisdiction)
    else:
        with pytest.raises(ComparisonImportError):
            s.validate_local_recipient(expected, jurisdiction)


def cli_inputs(tmp_path, ctx):
    generation = tmp_path / "generation.json"
    generation.write_text(json.dumps(ctx.g))
    manifest = tmp_path / "originals.json"
    manifest.write_text(
        json.dumps([{"sha256": h, "file": h + ".body"} for h in ctx.originals])
    )
    for h, body in ctx.originals.items():
        (tmp_path / (h + ".body")).write_bytes(body)
    review = tmp_path / "review.json"
    review.write_text(json.dumps(ctx.args, default=lambda v: v.isoformat()))
    return generation, manifest, review


def test_cli_dry_requests_cannot_connect_or_install_input_adapters(
    db, external, tmp_path, monkeypatch, capsys
):
    import sqlalchemy
    from scripts import review_external_election_finance as cli

    monkeypatch.setattr(
        sqlalchemy,
        "create_engine",
        lambda *a, **k: pytest.fail("dry request opened database"),
    )
    generation, manifest, review = cli_inputs(tmp_path, external)
    requests = [
        [
            "stage",
            "--input",
            str(generation),
            "--original-manifest",
            str(manifest),
            "--source-directory",
            str(tmp_path),
        ],
        ["review", "--input", str(review)],
        ["publish", "--generation", external.g["id"], "--expect-empty"],
    ]
    for request in requests:
        assert cli.main(request) == 0
        assert json.loads(capsys.readouterr().out)["executed"] is False
    assert set(s.ADAPTERS) == {"synthetic:v1"}
    generation.write_text('{"adapter_module":"operator.module"}')
    with pytest.raises(ComparisonImportError):
        cli.main(requests[0])


def test_cli_execute_stages_reviews_and_publishes_with_fixed_adapter_bootstrap(
    db, external, tmp_path, monkeypatch, capsys
):
    from contextlib import nullcontext
    import sqlalchemy
    import sqlalchemy.orm
    from alethical.db import session
    from alethical.pipeline import campaign_finance_refresh, raw_file_store
    from scripts import review_external_election_finance as cli

    ctx = external
    generation, manifest, review = cli_inputs(tmp_path, ctx)
    monkeypatch.setattr(
        sqlalchemy,
        "create_engine",
        lambda *a, **k: SimpleNamespace(dispose=lambda: None),
    )
    monkeypatch.setattr(sqlalchemy.orm, "Session", lambda *a, **k: nullcontext(db))
    monkeypatch.setattr(db, "commit", db.flush)
    monkeypatch.setattr(
        session, "database_url_for_target", lambda target: "unused-disposable-test"
    )
    monkeypatch.setattr(
        campaign_finance_refresh, "hold_full_run_lease_until_exit", lambda *a, **k: True
    )
    monkeypatch.setattr(raw_file_store, "raw_file_store_from_env", lambda: ctx.store)
    requests = [
        [
            "stage",
            "--input",
            str(generation),
            "--original-manifest",
            str(manifest),
            "--source-directory",
            str(tmp_path),
        ],
        ["review", "--input", str(review)],
        ["publish", "--generation", ctx.g["id"], "--expect-empty"],
    ]
    for request in requests:
        assert cli.main([*request, "--execute"]) == 0
        assert json.loads(capsys.readouterr().out)["executed"] is True
    assert {"fec_raw:v1", "fec_catalogue:v1", "fec_bulk_summary:v1"} < set(s.ADAPTERS)
    cli.register_builtin_adapters()  # Same fixed code is safe to register twice.
    assert (
        db.get(m.ElectionExternalFinanceCurrent, ctx.g["election_key"]).generation_id
        == ctx.g["id"]
    )


@pytest.mark.parametrize("table", ["reports", "payments"])
def test_staged_and_published_generations_reject_late_child_insert(db, external, table):
    ctx = external
    stage(db, ctx)
    item = deepcopy(ctx.g[table][0])
    key = "report_key" if table == "reports" else "payment_key"
    model = (
        m.ElectionExternalFinanceReport
        if table == "reports"
        else m.ElectionExternalFinancePayment
    )
    item[key] = digest("late unbound child")
    for published in (False, True):
        if published:
            s.publish_generation(db, ctx.store, ctx.g["id"], expected_previous=None)
        with pytest.raises(SQLAlchemyError):
            with db.begin_nested():
                db.add(
                    model(
                        generation_id=ctx.g["id"],
                        key=item[key],
                        authority=item["authority"],
                        account_id=item["account_id"],
                        payload=item,
                    )
                )
                db.flush()

    first = db.get(m.ElectionExternalFinanceGeneration, ctx.g["id"])
    receipt = (first.sealed_at, first.first_published_at)
    newer = deepcopy(ctx.g)
    newer["coverage"][0]["next_action"] = "Another pending action"
    rehash(newer)
    s.stage_generation(db, ctx.store, newer, {})
    s.publish_generation(db, ctx.store, newer["id"], expected_previous=ctx.g["id"])
    with pytest.raises(SQLAlchemyError):
        with db.begin_nested():
            db.add(
                model(
                    generation_id=ctx.g["id"],
                    key=item[key],
                    authority=item["authority"],
                    account_id=item["account_id"],
                    payload=item,
                )
            )
            db.flush()
    s.publish_generation(
        db, ctx.store, ctx.g["id"], expected_previous=newer["id"], restore=True
    )
    assert s.stage_generation(db, ctx.store, ctx.g, {}) == ctx.g["id"]
    assert s.publish_generation(db, ctx.store, ctx.g["id"], expected_previous=None)[
        "already_current"
    ]
    assert (first.sealed_at, first.first_published_at) == receipt


@pytest.mark.parametrize(
    "status",
    [
        "not_due",
        "confirmed_not_published",
        "catalogue_checked_not_found",
        "below_threshold_certified",
    ],
)
def test_factual_absence_status_belongs_to_coverage_not_invented_report(
    db, external, status
):
    ctx = external
    report = deepcopy(ctx.g["reports"][0])
    report.update(
        report_key=digest("unsupported report"),
        source_report_id="404000",
        series_id="unsupported status",
        predecessor_report_key=None,
        effective=False,
        check_status=status,
        figures=[],
        binding=None,
    )
    ctx.g["reports"].append(report)
    rehash(ctx.g)
    with pytest.raises(ComparisonImportError):
        stage(db, ctx)


@pytest.mark.parametrize("status", ["unreadable", "source_conflict"])
@pytest.mark.parametrize("bound", [False, True])
def test_factual_report_gaps_need_exact_identity_and_status_evidence(
    db, external, status, bound
):
    ctx = external
    report = ctx.g["reports"][0]
    report.update(
        check_status=status, figures=[], next_action="Recover checked financial figures"
    )
    if bound:
        records = json.loads(ctx.originals[ctx.source_hash])["records"]
        facts = {
            k: report[k]
            for k in (
                "authority",
                "account_id",
                "source_report_id",
                "check_status",
                "period_start",
                "period_end",
            )
        }
        report["status_binding"] = append_binding(ctx, records, facts)
        rewrite_original(ctx, records)
        publish(db, ctx)
    else:
        rehash(ctx.g)
        with pytest.raises(ComparisonImportError):
            stage(db, ctx)


def test_real_two_connection_insert_publication_boundary_keeps_generation_sealed(
    external,
):
    """A second owned disposable server avoids escaping the outer test transaction."""
    from concurrent.futures import ThreadPoolExecutor
    import os
    from pathlib import Path
    import subprocess
    import sys
    import time
    from sqlalchemy import create_engine, text
    from scripts.local_checks import disposable_postgres

    ctx = external
    root = Path(__file__).resolve().parents[2]
    with disposable_postgres(root) as url:
        result = subprocess.run(
            [sys.executable, "-m", "alembic", "-c", "alembic.ini", "upgrade", "head"],
            cwd=root,
            env={**os.environ, "DATABASE_URL": url},
            capture_output=True,
            text=True,
        )
        assert result.returncode == 0, result.stderr
        engine = create_engine(url)
        try:
            with Session(engine) as setup:
                setup.add(
                    m.ElectionComparisonSnapshot(
                        id=ctx.snapshot.id,
                        election_key=ctx.snapshot.election_key,
                        election_date=ctx.snapshot.election_date,
                        stage=ctx.snapshot.stage,
                        fetched_at=ctx.snapshot.fetched_at,
                        sources=ctx.snapshot.sources,
                        coverage={},
                    )
                )
                setup.flush()
                setup.add(
                    m.ElectionComparisonRace(
                        snapshot_id=ctx.snapshot.id,
                        id=ctx.race.id,
                        label=ctx.race.label,
                        office_id=ctx.race.office_id,
                        jurisdiction=ctx.race.jurisdiction,
                        result_status=ctx.race.result_status,
                        payload=ctx.race.payload,
                    )
                )
                setup.flush()
                s.stage_generation(setup, ctx.store, ctx.g, ctx.originals)
                setup.commit()
            for table, model, key in (
                ("reports", m.ElectionExternalFinanceReport, "report_key"),
                ("payments", m.ElectionExternalFinancePayment, "payment_key"),
            ):
                item = deepcopy(ctx.g[table][0])
                item[key] = digest(["late concurrent child", table])
                pid = []

                def late_insert():
                    with Session(engine) as writer:
                        writer.execute(text("SET LOCAL lock_timeout = '10s'"))
                        pid.append(writer.scalar(text("SELECT pg_backend_pid()")))
                        writer.add(
                            model(
                                generation_id=ctx.g["id"],
                                key=item[key],
                                authority=item["authority"],
                                account_id=item["account_id"],
                                payload=item,
                            )
                        )
                        writer.commit()

                with ThreadPoolExecutor(max_workers=1) as pool:
                    with Session(engine) as publisher:
                        s.publish_generation(
                            publisher, ctx.store, ctx.g["id"], expected_previous=None
                        )
                        future = pool.submit(late_insert)
                        deadline = time.monotonic() + 5
                        blocked = False
                        while time.monotonic() < deadline and not future.done():
                            if pid:
                                with engine.connect() as observer:
                                    blocked = observer.scalar(
                                        text(
                                            "SELECT wait_event_type = 'Lock' FROM pg_stat_activity WHERE pid=:pid"
                                        ),
                                        {"pid": pid[0]},
                                    )
                                if blocked:
                                    break
                            time.sleep(0.01)
                        assert blocked, (
                            "Child INSERT must wait for publication's parent-row lock"
                        )
                        publisher.commit()
                    with pytest.raises(SQLAlchemyError):
                        future.result(timeout=5)
            with Session(engine) as verify:
                row, held = s.load_generation(verify, ctx.g["id"])
                assert row.sealed_at and row.first_published_at
                assert s.generation_digest(held) == ctx.g["id"]
                assert len(held["reports"]) == len(ctx.g["reports"])
                assert len(held["payments"]) == len(ctx.g["payments"])
        finally:
            engine.dispose()


@pytest.mark.parametrize(
    "failure",
    [None, "missing_reason", "ballot_spoof", "candidate_cross", "source_loss"],
)
def test_source_name_rendering_requires_checked_ballot_and_explicit_review_evidence(
    db, external, failure
):
    from alethical.pipeline.election_external_adapters import register_external_adapters
    from alethical.tests.test_election_fec_candidate_identity import (
        zipped,
        source,
        locator,
        binding,
    )

    ctx = external
    register_external_adapters()
    literal_name = "EXAMPLE, CANDIDATE"
    records = json.loads(ctx.originals[ctx.source_hash])["records"]
    account_row = ctx.account["binding"]["locator"]["row"]
    records[account_row]["candidate_name"] = literal_name
    ctx.account["candidate_name"] = literal_name
    ctx.g["accounts"][0]["candidate_name"] = literal_name
    rewrite_original(ctx, records)
    candidate_id = "S6MN99999" if failure == "candidate_cross" else "S6MN00001"
    body = zipped(f"{candidate_id}|{literal_name}|DFL|2026|MN|S|00|O|C|C00000001|||||")
    metadata = {**source(body), "copied_at": ctx.g["copied_at"]}
    proof = binding(
        body, metadata, locator(body, kind="name_rendering"), "fec_candidate_master:v1"
    )
    ctx.g["sources"].append(metadata)
    ctx.originals[metadata["sha256"]] = body
    rehash(ctx.g)
    for evidence in ctx.args["evidence"]:
        if "generation_id" in evidence:
            evidence["generation_id"] = ctx.g["id"]
    evidence = {
        "kind": "name_rendering",
        "sha256": metadata["sha256"],
        "generation_id": ctx.g["id"],
        "binding": proof,
        "reason": "Only source-declared name order and ASCII case differ",
    }
    if failure == "missing_reason":
        evidence.pop("reason")
    ctx.args["evidence"].append(evidence)
    stage(db, ctx)
    if failure == "ballot_spoof":
        ctx.args["evidence"][0]["literal_row"] = ctx.args["evidence"][0][
            "literal_row"
        ].replace("Candidate Example", "Another Example")
    if failure == "source_loss":
        row = db.get(m.ElectionResultSource, metadata["sha256"])
        ctx.store.objects.pop(row.object_key)
    before = db.scalar(
        select(func.count()).select_from(m.ElectionCampaignAccountDecision)
    )
    args = {
        key: ctx.args[key]
        for key in (
            "registration_number",
            "authority",
            "period_start",
            "period_end",
            "evidence",
            "decision",
        )
    }
    if failure:
        with pytest.raises(ComparisonImportError):
            s.validate_account_review(
                db,
                ctx.store,
                snapshot=ctx.snapshot,
                race=ctx.race,
                candidate=ctx.candidate,
                **args,
            )
    else:
        assert (
            s.validate_account_review(
                db,
                ctx.store,
                snapshot=ctx.snapshot,
                race=ctx.race,
                candidate=ctx.candidate,
                **args,
            )["id"]
            == ctx.g["id"]
        )
        assert ctx.account["candidate_name"] == literal_name
        assert ctx.candidate["name"] == "Candidate Example"
    assert (
        db.scalar(select(func.count()).select_from(m.ElectionCampaignAccountDecision))
        == before
    )


def test_optional_payee_address_requires_exact_source_binding(db, external):
    ctx = external
    ctx.g["payments"][0]["payee_address"] = {
        "street_1": "123 Invented",
        "street_2": None,
        "city": None,
        "state": "MN",
        "postal_code": None,
    }
    rehash(ctx.g)
    with pytest.raises(ComparisonImportError, match="no checked source binding"):
        stage(db, ctx)


def dated_review_inputs(
    db,
    ctx,
    monkeypatch,
    *,
    basis="form2_signed_principal",
    form2_name="EXAMPLE  COMMITTEE",
    f1_overrides=None,
    role=None,
):
    """Retain exact fixture originals without staging or applying any review."""
    from alethical.pipeline.election_external_adapters import register_external_adapters
    from alethical.tests.test_election_fec_paper_identity import (
        paper_pdf,
        source as pdf_source,
    )
    from alethical.tests.test_election_fec_sources import (
        filing,
        organization,
        source as raw_source,
    )

    register_external_adapters()
    role = role or ("principal" if basis == "form2_signed_principal" else "authorized")
    designation = next(e for e in ctx.args["evidence"] if e["kind"] == "designation")
    records = json.loads(ctx.originals[ctx.source_hash])["records"]
    records[designation["binding"]["locator"]["row"]]["designation_role"] = role
    designation["designation_role"] = role
    rewrite_original(ctx, records)
    if basis == "form2_signed_principal":
        body = paper_pdf(
            source_candidate_id="S6MN00001",
            office="Senate",
            district="00",
            principal_account_name=form2_name,
            signed_date="06/16/2026",
        )
        metadata = pdf_source(body)
        adapter = "fec_form2_pdf:v1"
        locators = [
            {"kind": "field", "page": 1, "field": field}
            for field in (
                "signed_date",
                "principal_account_name",
                "election_year",
                "office",
                "state",
                "district",
            )
        ]
    else:
        body = filing(
            organization(
                **(
                    {
                        "2": "C00000001",
                        "4": "Example Committee",
                        "15": "20260813",
                        "21": "20260813",
                        "22": "B",
                        "23": "S6MN00001",
                        "29": "S",
                        "31": "00",
                    }
                    | (f1_overrides or {})
                )
            )
        )
        metadata = raw_source(body)
        adapter, locators = "fec_raw:v1", [{"kind": "identity", "row": 2}]
    metadata.update(
        copied_at=ctx.g["copied_at"],
        media_type="application/pdf"
        if basis == "form2_signed_principal"
        else "text/plain",
    )
    proofs = []
    for locator in locators:
        actual = s.ADAPTERS[adapter](body, metadata, locator)
        proofs.append(
            {
                "adapter": adapter,
                "source_sha256": metadata["sha256"],
                "locator": locator,
                "facts": actual.facts,
                "quote": actual.quote,
            }
        )
    if basis == "form2_signed_principal":
        designation["binding"] = [designation["binding"], *proofs[2:]]
    ctx.g["sources"].append(metadata)
    ctx.originals[metadata["sha256"]] = body
    dated = {
        "kind": "dated_designation",
        "basis": basis,
        "designation_role": role,
        "sha256": metadata["sha256"],
        "binding": proofs[:2] if basis == "form2_signed_principal" else proofs[0],
    }
    ctx.args["evidence"].insert(0, dated)
    rehash(ctx.g)
    for e in ctx.args["evidence"]:
        if e["kind"] != "ballot":
            e["generation_id"] = ctx.g["id"]
    for raw in ctx.originals.values():
        s.archive_source(db, ctx.store, raw)

    def held_generation(db, generation_id, cache=None):
        assert generation_id == ctx.g["id"]
        return None, ctx.g

    monkeypatch.setattr(s, "cached_generation", held_generation)
    return dated


def check_dated_review(db, ctx, *, start):
    return s.validate_account_review(
        db,
        ctx.store,
        snapshot=ctx.snapshot,
        race=ctx.race,
        candidate=ctx.candidate,
        registration_number=ctx.args["registration_number"],
        authority=ctx.args["authority"],
        period_start=start,
        period_end=date(2026, 10, 14),
        evidence=ctx.args["evidence"],
        decision="confirmed",
    )


@pytest.mark.parametrize(
    "basis,start",
    [
        ("form2_signed_principal", date(2026, 6, 16)),
        ("f1_identity_dates", date(2026, 8, 13)),
    ],
)
def test_optional_dated_designation_checks_originals_without_applying_review(
    db, external, monkeypatch, basis, start
):
    dated_review_inputs(db, external, monkeypatch, basis=basis)
    assert check_dated_review(db, external, start=start)["id"] == external.g["id"]
    assert (
        db.scalar(select(func.count()).select_from(m.ElectionCampaignAccountDecision))
        == 0
    )


@pytest.mark.parametrize(
    "basis,start",
    [
        ("form2_signed_principal", date(2026, 6, 15)),
        ("f1_identity_dates", date(2026, 8, 12)),
    ],
)
def test_dated_source_does_not_authorize_an_earlier_interval(
    db, external, monkeypatch, basis, start
):
    dated = dated_review_inputs(db, external, monkeypatch, basis=basis)
    dated["assertion_date"] = "1900-01-01"  # Caller override has no authority.
    with pytest.raises(ComparisonImportError, match="starts before"):
        check_dated_review(db, external, start=start)


@pytest.mark.parametrize(
    "failure",
    [
        "missing_designation",
        "missing_role",
        "wrong_role",
        "unissued_account",
        "forged_quote",
        "cross_candidate",
        "cross_original",
        "untrusted_adapter",
    ],
)
def test_dated_form2_cannot_supply_or_cross_identity_proofs(
    db, external, monkeypatch, failure
):
    ctx = external
    dated = dated_review_inputs(db, ctx, monkeypatch)
    if failure == "missing_designation":
        ctx.args["evidence"] = [
            e for e in ctx.args["evidence"] if e["kind"] != "designation"
        ]
    elif failure == "missing_role":
        dated.pop("designation_role")
    elif failure == "wrong_role":
        dated["designation_role"] = "authorized"
    elif failure == "unissued_account":
        ctx.g["accounts"][0]["issued_id"] = False
    elif failure == "forged_quote":
        dated["binding"][0]["quote"] += " forged"
    elif failure == "cross_candidate":
        dated["binding"][0]["facts"]["source_candidate_id"] = "S6MN00002"
    elif failure == "cross_original":
        dated["binding"][0]["source_sha256"] = ctx.source_hash
    else:
        dated["binding"][0]["adapter"] = "synthetic:v1"
    with pytest.raises(ComparisonImportError):
        check_dated_review(db, ctx, start=date(2026, 6, 16))


@pytest.mark.parametrize(
    "name", ["Example Committee!", "Example", "Examples Committee"]
)
def test_form2_principal_name_has_no_fuzzy_or_punctuation_match(
    db, external, monkeypatch, name
):
    dated_review_inputs(db, external, monkeypatch, form2_name=name)
    with pytest.raises(ComparisonImportError, match="committee name differs"):
        check_dated_review(db, external, start=date(2026, 6, 16))


def test_form2_date_name_from_an_unrelated_pdf_cannot_borrow_context(
    db, external, monkeypatch
):
    from alethical.tests.test_election_fec_paper_identity import paper_pdf, source

    ctx = external
    dated = dated_review_inputs(db, ctx, monkeypatch)
    body = paper_pdf(
        source_candidate_id="S6MN00001",
        office="Senate",
        district="00",
        principal_account_name="Example Committee",
        signed_date="06/17/2026",
    )
    metadata = source(body) | {
        "copied_at": ctx.g["copied_at"],
        "media_type": "application/pdf",
    }
    dated["sha256"] = metadata["sha256"]
    for item in dated["binding"]:
        actual = s.ADAPTERS["fec_form2_pdf:v1"](body, metadata, item["locator"])
        item.update(
            source_sha256=metadata["sha256"], facts=actual.facts, quote=actual.quote
        )
    ctx.g["sources"].append(metadata)
    s.archive_source(db, ctx.store, body)
    with pytest.raises(ComparisonImportError, match="election-context original"):
        check_dated_review(db, ctx, start=date(2026, 6, 17))


@pytest.mark.parametrize(
    "fields",
    [
        {"2": "C00000002"},
        {"23": "S6MN00002"},
        {"22": "A"},
        {"22": "F"},
        {"29": "H", "31": "01"},
        {"30": "WI"},
    ],
)
def test_f1_dated_assertion_must_match_account_candidate_role_and_office(
    db, external, monkeypatch, fields
):
    dated_review_inputs(
        db, external, monkeypatch, basis="f1_identity_dates", f1_overrides=fields
    )
    with pytest.raises(
        ComparisonImportError, match="different account, candidate, office or role"
    ):
        check_dated_review(db, external, start=date(2026, 8, 13))


def test_f1_later_effective_or_signature_date_sets_conservative_floor(
    db, external, monkeypatch
):
    dated_review_inputs(
        db,
        external,
        monkeypatch,
        basis="f1_identity_dates",
        f1_overrides={"15": "20260814"},
    )
    with pytest.raises(ComparisonImportError, match="starts before"):
        check_dated_review(db, external, start=date(2026, 8, 13))
    assert check_dated_review(db, external, start=date(2026, 8, 14))


@pytest.mark.parametrize("basis", ["form2_signed_principal", "f1_identity_dates"])
def test_dated_assertion_original_loss_is_not_satisfied_by_typed_json(
    db, external, monkeypatch, basis
):
    dated = dated_review_inputs(db, external, monkeypatch, basis=basis)
    row = db.get(m.ElectionResultSource, dated["sha256"])
    original = external.store.objects.pop(row.object_key)
    with pytest.raises(ComparisonImportError, match="unavailable or changed"):
        check_dated_review(db, external, start=date(2026, 8, 14))
    external.store.objects[row.object_key] = original
    assert check_dated_review(db, external, start=date(2026, 8, 14))


def test_f1_principal_role_and_later_signature_date_are_checked(
    db, external, monkeypatch
):
    dated_review_inputs(
        db,
        external,
        monkeypatch,
        basis="f1_identity_dates",
        role="principal",
        f1_overrides={"22": "A", "15": "20260810", "21": "20260813"},
    )
    with pytest.raises(ComparisonImportError, match="starts before"):
        check_dated_review(db, external, start=date(2026, 8, 12))
    assert check_dated_review(db, external, start=date(2026, 8, 13))


@pytest.mark.parametrize(
    "value",
    [None, "2026-2-01", "2026-02-30", "2026-01-01T00:00:00", "20260101", 20260101],
)
def test_assertion_date_requires_an_actual_iso_calendar_date(value):
    with pytest.raises(ComparisonImportError):
        s._assertion_day(value)


def test_committee_name_comparison_changes_ascii_case_and_whitespace_only():
    assert s._ascii_committee_name("EXAMPLE\t Committee ") == s._ascii_committee_name(
        "example committee"
    )
    for value in (
        "Example-Committee",
        "Example Committee Jr.",
        "Example\u00a0Committee",
        "EXAMPL\u212a Committee",
    ):
        assert s._ascii_committee_name(value) != s._ascii_committee_name(
            "Example Committee"
        )


def test_dated_helper_cannot_borrow_another_accounts_valid_designation(
    db, external, monkeypatch
):
    dated = dated_review_inputs(db, external, monkeypatch)
    original = external.g["accounts"][0]
    context = {
        "authority": "fec",
        "account_id": original["account_id"],
        "source_candidate_id": original["source_candidate_id"],
        "election_year": 2026,
        "office": "S",
        "state": "MN",
        "district": "00",
    }
    with pytest.raises(ComparisonImportError, match="exact account and candidate"):
        s.validate_federal_dated_designation(
            external.g,
            external.originals,
            dated,
            account=original | {"account_id": "C00000002"},
            designation_context=context,
            designations=[
                e for e in external.args["evidence"] if e["kind"] == "designation"
            ],
            period_start=date(2026, 6, 16),
        )
