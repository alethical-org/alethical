"""External source versions, private review exclusion and whole-period reads."""

# ruff: noqa: F401,F811
from copy import deepcopy
import json
import re

from fastapi import HTTPException
import pytest
from sqlalchemy import event, select

from alethical.api.services import election_external_finance_reads as reads
from alethical.db import models as m
from alethical.pipeline import election_account_reviews as reviews
from alethical.pipeline import election_external_finance as storage
from alethical.tests.test_election_external_finance import (
    db,
    external,
    publish,
    rehash,
    stage,
)


def args(ctx):
    return {
        "election_key": ctx.g["election_key"],
        "race_id": ctx.race.id,
        "candidate_id": ctx.candidate["candidate_id"],
        "store": ctx.store,
    }


def checked(db, ctx):
    stage(db, ctx)
    decision = reviews.record_decision(db, **ctx.args)
    storage.publish_generation(db, ctx.store, ctx.g["id"], expected_previous=None)
    return decision


@pytest.mark.parametrize(
    ("account", "expected"),
    [
        ({"account_id": "group:looks-internal", "issued_id": True}, {}),
        (
            {"account_id": "issued-looking", "issued_id": False},
            {"issued_id": False, "account_id_kind": "publisher_catalogue_group"},
        ),
        (
            {
                "issued_id": False,
                "reviewed_key_basis": {"kind": "publisher_catalogue_group"},
                "publisher_account": {"kind": "physical_section", "issued_id": False},
            },
            {"issued_id": False, "account_id_kind": "publisher_catalogue_group"},
        ),
    ],
)
def test_public_account_identity_keeps_issued_and_legacy_meanings(account, expected):
    assert reads._public_account_identity(account) == expected


def test_section_page_fallback_preserves_explicit_pages_and_foreign_sources():
    original = {"source_sha256": "a" * 64, "locator": {"page": 9}, "quote": "Exact"}
    section = {"source_sha256": "a" * 64, "page": 2}
    assert reads._binding(original, source_section=section)[0]["locator"]["page"] == 9
    assert (
        reads._binding(original | {"locator": {}}, source_section=section)[0][
            "locator"
        ]["page"]
        == 2
    )
    other = original | {"source_sha256": "b" * 64, "locator": {}}
    assert reads._binding(other, source_section=section)[0]["locator"] == {}


def test_no_review_never_exposes_candidate_figures(db, external):
    publish(db, external)
    result = reads.candidate_finance(db, **args(external))
    assert result["accounts"] == result["reports"] == result["payments"] == []
    assert result["coverage"]["status"] == "unmatched"
    assert result["complete_election_spending"] is False


def test_temporary_source_capacity_returns_retry_without_revising_data(
    db, external, monkeypatch
):
    from alethical.pipeline.election_source_files import SourceFileLimitError

    checked(db, external)
    before = reads.candidate_finance(db, **args(external))
    original = reads._availability

    def busy(*args, **kwargs):
        raise SourceFileLimitError("Synthetic temporary capacity")

    monkeypatch.setattr(reads, "_availability", busy)
    with pytest.raises(HTTPException) as failure:
        reads.candidate_finance(db, **args(external), version=before["version"])
    assert failure.value.status_code == 503
    assert failure.value.headers == {"Retry-After": "1"}
    monkeypatch.setattr(reads, "_availability", original)
    assert (
        reads.candidate_finance(db, **args(external), version=before["version"])
        == before
    )


def test_checked_values_history_and_private_data_are_separate(db, external):
    ctx = external
    checked(db, ctx)
    result = reads.candidate_finance(db, **args(ctx))
    assert len(result["accounts"]) == 1 and len(result["reports"]) == 2
    assert sorted(r["effective"] for r in result["reports"]) == [False, True]
    assert len(result["payments"]) == 2
    assert {p["direction"] for p in result["payments"]} == {
        "independent_for",
        "independent_against",
    }
    assert {p["amount"] for p in result["payments"]} == {"123.4500", "0.00"}
    for report in result["reports"]:
        assert {f["measure"]: f["value"] for f in report["figures"]} == {
            "contributions": "0.00",
            "total_disbursements": "12.3400",
        }
    encoded = json.dumps(result)
    for value in (
        "PRIVATE_REVIEWER",
        "PRIVATE_REASON",
        "PRIVATE_OBJECT_KEY",
        "/private/internal",
        "reviewed_by",
        "raw_metadata",
    ):
        assert value not in encoded
    repeated = reads.candidate_finance(db, **args(ctx), version=result["version"])
    assert repeated == result
    page = reads.payment_records(db, **args(ctx), limit=1, offset=1)
    assert len(page["rows"]) == 1 and page["page"] == {
        "total": 2,
        "limit": 1,
        "offset": 1,
        "has_more": False,
    }


def test_source_loss_changes_version_and_withholds_figures(db, external):
    ctx = external
    checked(db, ctx)
    before = reads.candidate_finance(db, **args(ctx))
    source = db.get(m.ElectionResultSource, ctx.source_hash)
    ctx.store.objects.pop(source.object_key)
    after = reads.candidate_finance(db, **args(ctx))
    assert after["version"] != before["version"]
    assert after["accounts"] == after["reports"] == after["payments"] == []
    assert after["account_gaps"][0]["state"] == "sources_unavailable"
    with pytest.raises(HTTPException) as exc:
        reads.candidate_finance(db, **args(ctx), version=before["version"])
    assert exc.value.status_code == 409


def test_withdrawal_changes_version_and_old_receipt_cannot_reconfirm(db, external):
    ctx = external
    first = checked(db, ctx)
    before = reads.candidate_finance(db, **args(ctx))
    reviews.record_decision(
        db,
        **{
            **ctx.args,
            "decision": "withdrawn",
            "reason": "PRIVATE withdrawal",
            "expected_previous_id": first.id,
        },
    )
    assert reviews.record_decision(db, **ctx.args).id == first.id
    after = reads.candidate_finance(db, **args(ctx))
    assert after["version"] != before["version"]
    assert after["accounts"] == after["reports"] == after["payments"] == []
    assert after["account_gaps"][0]["state"] == "withdrawn"


def test_unpublished_or_wrong_generation_sources_are_denied_and_history_survives(
    db, external
):
    ctx = external
    stage(db, ctx)
    with pytest.raises(HTTPException) as exc:
        reads.source_body(
            db,
            election_key=ctx.g["election_key"],
            generation_id=ctx.g["id"],
            source_hash=ctx.source_hash,
            store=ctx.store,
        )
    assert exc.value.status_code == 404
    storage.publish_generation(db, ctx.store, ctx.g["id"], expected_previous=None)
    second = deepcopy(ctx.g)
    second["coverage"][0]["next_action"] = "Still pending exact review"
    rehash(second)
    storage.stage_generation(db, ctx.store, second, {})
    storage.publish_generation(
        db, ctx.store, second["id"], expected_previous=ctx.g["id"]
    )
    body, metadata, headers = reads.source_body(
        db,
        election_key=ctx.g["election_key"],
        generation_id=ctx.g["id"],
        source_hash=ctx.source_hash,
        store=ctx.store,
    )
    assert body == ctx.originals[ctx.source_hash]
    assert "object_key" not in metadata
    assert headers["X-Content-Type-Options"] == "nosniff"
    assert headers["Content-Disposition"].startswith("attachment;")
    unrelated = storage.archive_source(
        db, ctx.store, b"another retained but unrelated original"
    )
    with pytest.raises(HTTPException) as exc:
        reads.source_body(
            db,
            election_key=ctx.g["election_key"],
            generation_id=ctx.g["id"],
            source_hash=unrelated,
            store=ctx.store,
        )
    assert exc.value.status_code == 404
    with pytest.raises(HTTPException) as exc:
        reads.source_body(
            db,
            election_key="another-election",
            generation_id=ctx.g["id"],
            source_hash=ctx.source_hash,
            store=ctx.store,
        )
    assert exc.value.status_code == 404


def test_whole_source_period_is_never_prorated(db, external):
    ctx = external
    stage(db, ctx)
    narrow = {**ctx.args, "period_start": __import__("datetime").date(2026, 1, 1)}
    reviews.record_decision(db, **narrow)
    storage.publish_generation(db, ctx.store, ctx.g["id"], expected_previous=None)
    result = reads.candidate_finance(db, **args(ctx))
    assert result["accounts"]
    assert all(
        r["figures"] is None and r["check_status"] == "period_not_covered"
        for r in result["reports"]
    )
    assert all(r["gap"] == "Outside checked account dates" for r in result["reports"])
    # Dated transactions in the checked interval remain exact independent records.
    assert len(result["payments"]) == 2


def test_changed_candidate_is_hidden_and_versions_identity(db, external):
    ctx = external
    checked(db, ctx)
    before = reads.candidate_finance(db, **args(ctx))
    ctx.race.payload["candidates"][0]["name"] = "Another same-ID candidate"
    after = reads.candidate_finance(db, **args(ctx))
    assert after["version"] != before["version"]
    assert after["reports"] == after["accounts"] == []
    assert after["account_gaps"][0]["state"] == "identity_changed"


def test_bulk_reads_one_generation_and_caches_original_objects(
    db, external, monkeypatch
):
    ctx = external
    checked(db, ctx)
    counts = {"loads": 0, "gets": 0}
    load = storage.load_generation
    get = ctx.store.get

    def counted_load(*a, **kw):
        counts["loads"] += 1
        return load(*a, **kw)

    def counted_get(*a, **kw):
        counts["gets"] += 1
        return get(*a, **kw)

    monkeypatch.setattr(storage, "load_generation", counted_load)
    monkeypatch.setattr(ctx.store, "get", counted_get)
    result = reads.bulk_finance(db, election_key=ctx.g["election_key"], store=ctx.store)
    assert len(result["candidates"]) == 1
    assert len(result["candidates"][0]["payments"]) == 2
    assert "authorities" not in result["candidates"][0]
    assert counts["loads"] == 0
    assert counts["gets"] <= len(ctx.originals)


def test_coverage_evidence_loss_is_unchecked_and_versions_context(db, external):
    from alethical.tests.test_election_external_finance import add_checked_coverage

    ctx = external
    add_checked_coverage(ctx)
    publish(db, ctx)
    before = reads.context(db, election_key=ctx.g["election_key"], store=ctx.store)
    federal = next(r for r in before["coverage"] if r["authority_family"] == "federal")
    assert federal["status"] == "below_threshold_certified"
    assert federal["status_basis"] == "checked_source"
    source = db.get(m.ElectionResultSource, ctx.source_hash)
    ctx.store.objects.pop(source.object_key)
    after = reads.context(db, election_key=ctx.g["election_key"], store=ctx.store)
    assert after["version"] != before["version"]
    federal = next(r for r in after["coverage"] if r["authority_family"] == "federal")
    assert federal["status"] == "unchecked"
    assert federal["status_basis"] == "sources_unavailable"


def test_ytd_and_report_figures_keep_actual_period_and_review_limit(db, external):
    from datetime import date
    from alethical.tests.test_election_external_finance import rewrite_original

    ctx = external
    records = json.loads(ctx.originals[ctx.source_hash])["records"]
    for report in ctx.g["reports"]:
        report["period_start"] = "2026-07-01"
        records[report["binding"]["locator"]["row"]]["period_start"] = "2026-07-01"
        # Actual report-period amount is inside the review; cumulative amount is not.
        figure = report["figures"][0]
        figure["period_start"] = "2026-07-01"
        records[figure["binding"]["locator"]["row"]]["period_start"] = "2026-07-01"
    rewrite_original(ctx, records)
    ctx.args["period_start"] = date(2026, 7, 1)
    checked(db, ctx)
    result = reads.candidate_finance(db, **args(ctx))
    for report in result["reports"]:
        assert report["check_status"] == "checked"
        assert [f["measure"] for f in report["figures"]] == ["contributions"]
        assert report["figures"][0]["period_start"] == "2026-07-01"
        assert report["withheld_measures"] == [
            {"measure": "total_disbursements", "state": "period_not_covered"}
        ]


def test_appended_outcome_review_invalidates_external_version(
    db, external, monkeypatch
):
    from alethical.pipeline import election_outcomes as outcomes

    ctx = external
    checked(db, ctx)
    url = "https://www.sos.mn.gov/fixture-outcome-correction.txt"
    publisher = "https://www.sos.mn.gov/fixture-outcome-publisher"
    lines = [
        ctx.race.label,
        ctx.snapshot.election_date.isoformat(),
        ctx.race.jurisdiction,
        "Results pending",
        "Correction withdraws earlier review",
    ]
    downloads = {url: "\n".join(lines).encode(), publisher: url.encode()}
    monkeypatch.setattr(outcomes, "raw_file_store_from_env", lambda: ctx.store)
    monkeypatch.setattr(
        outcomes,
        "_download",
        lambda target, hosts: (downloads[target], target, "text/plain"),
    )
    capture = outcomes.capture_source(
        db,
        url=url,
        publisher_url=publisher,
        publisher_hosts=["www.sos.mn.gov"],
        authority="Fixture authority",
        store=ctx.store,
    )

    def locator(line):
        return {"line_start": line, "line_end": line, "encoding": "utf-8"}

    def evidence(kind, line, **extra):
        return {
            **outcomes.capture_metadata(capture),
            "kind": kind,
            "identity": outcomes.race_identity(ctx.snapshot, ctx.race),
            "quote": lines[line - 1],
            "locator": locator(line),
            "context": {
                "bindings": [
                    {
                        "field": field,
                        "value": lines[number - 1],
                        "literal": lines[number - 1],
                        "quote": lines[number - 1],
                        "locator": locator(number),
                        "reason": "PRIVATE identity explanation",
                    }
                    for field, number in (
                        ("office", 1),
                        ("election_date", 2),
                        ("jurisdiction", 3),
                    )
                ]
            },
            **extra,
        }

    request = dict(
        snapshot_id=ctx.snapshot.id,
        race_id=ctx.race.id,
        result_status="pending",
        identity=outcomes.race_identity(ctx.snapshot, ctx.race),
        candidate_outcomes=[],
        reason="PRIVATE_REASON",
        reviewed_by="PRIVATE_REVIEWER",
    )
    previous = outcomes.record_decision(
        db,
        **request,
        decision="recorded",
        expected_previous_id=None,
        evidence=[evidence("race_status", 4, status="pending")],
    )
    before = reads.candidate_finance(db, **args(ctx))
    outcomes.record_decision(
        db,
        **request,
        decision="withdrawn",
        expected_previous_id=previous.id,
        evidence=[evidence("withdrawal", 5)],
    )
    after = reads.candidate_finance(db, **args(ctx))
    assert after["version"] != before["version"]
    assert after["reports"] == before["reports"]
    with pytest.raises(HTTPException) as error:
        reads.candidate_finance(db, **args(ctx), version=before["version"])
    assert error.value.status_code == 409


def test_candidate_reads_select_only_relevant_payloads_and_sources(
    db, external, monkeypatch
):
    ctx = external
    checked(db, ctx)

    def forbidden(*a, **k):
        pytest.fail("candidate request loaded the entire external generation")

    monkeypatch.setattr(storage, "load_generation", forbidden)
    result = reads.candidate_finance(db, **args(ctx))
    assert len(result["reports"]) == 2 and len(result["payments"]) == 2


def test_sealed_unpublished_review_history_keeps_attribution_hold(db, external):
    ctx = external
    stage(db, ctx)
    reviews.record_decision(db, **ctx.args)
    newer = deepcopy(ctx.g)
    newer["coverage"][0]["next_action"] = "Continue collection"
    rehash(newer)
    storage.stage_generation(db, ctx.store, newer, {})
    storage.publish_generation(db, ctx.store, newer["id"], expected_previous=None)
    result = reads.candidate_finance(db, **args(ctx))
    assert result["accounts"] == result["payments"] == []
    assert result["account_gaps"][0]["state"] == "identity_source_changed"


def test_historical_projection_preserves_evidence_named_local_geography(db, external):
    ctx = external
    publish(db, ctx)
    local = next(
        r for r in ctx.g["coverage"] if r["authority_family"] == "county_local"
    )
    evidence = [
        {
            "kind": "ballot",
            "sha256": local["source_sha256"],
            "literal_row": ctx.originals[local["source_sha256"]].decode().strip(),
        }
    ]
    _, view = storage.load_review_view(db, ctx.g["id"], set(), evidence)
    assert view["coverage"] == [local]
    storage.validate_local_recipient(
        view["coverage"][0],
        {
            "county_ids": [local["county_id"]],
            "municipal_fips_code": local["municipal_fips_code"],
        },
    )
    assert view["payments"] == view["reports"] == []


@pytest.mark.parametrize("endpoint", ["bulk", "candidate", "source"])
def test_published_reads_and_historical_reviews_never_load_full_generation(
    db, external, monkeypatch, endpoint
):
    ctx = external
    checked(db, ctx)
    newer = deepcopy(ctx.g)
    newer["coverage"][0]["next_action"] = "Continue exact-source collection"
    rehash(newer)
    storage.stage_generation(db, ctx.store, newer, {})
    storage.publish_generation(
        db, ctx.store, newer["id"], expected_previous=ctx.g["id"]
    )

    def forbidden(*a, **k):
        pytest.fail("read request rehydrated a complete current/historical generation")

    monkeypatch.setattr(storage, "load_generation", forbidden)
    if endpoint == "bulk":
        result = reads.bulk_finance(
            db, election_key=ctx.g["election_key"], store=ctx.store
        )
        assert len(result["candidates"][0]["reports"]) == 2
        assert result["coverage"]
    elif endpoint == "candidate":
        result = reads.candidate_finance(db, **args(ctx))
        assert len(result["reports"]) == 2 and len(result["payments"]) == 2
    else:
        body, _, _ = reads.source_body(
            db,
            election_key=ctx.g["election_key"],
            generation_id=newer["id"],
            source_hash=ctx.source_hash,
            store=ctx.store,
        )
        assert body == ctx.originals[ctx.source_hash]


def test_bulk_sql_keeps_full_coverage_without_hydrating_unrelated_children(
    db, external, monkeypatch
):
    from alethical.tests.test_election_external_finance import (
        append_binding,
        rewrite_original,
    )
    from alethical.pipeline.election_comparison import digest

    ctx = external
    records = json.loads(ctx.originals[ctx.source_hash])["records"]
    account = deepcopy(ctx.g["accounts"][0])
    account.update(
        account_id="C00000002", source_candidate_id=None, candidate_name=None
    )
    account["binding"] = append_binding(ctx, records, storage.account_facts(account))
    report = deepcopy(ctx.g["reports"][1])
    report.update(
        report_key=digest("unrelated report"),
        account_id=account["account_id"],
        source_report_id="200",
        series_id="unrelated-series",
        predecessor_report_key=None,
        figures=[],
    )
    report["binding"] = append_binding(ctx, records, storage.report_facts(report))
    payment = deepcopy(ctx.g["payments"][0])
    payment.update(
        payment_key=digest("unrelated payment"),
        account_id=account["account_id"],
        source_report_id="200",
        report_key=report["report_key"],
        source_row_id="unrelated-row",
        target_source_candidate_id=None,
        direction="unknown",
        raw_metadata={"unrelated_large_payload": "x" * 1_000_000},
    )
    payment["binding"] = append_binding(ctx, records, storage.payment_facts(payment))
    ctx.g["accounts"].append(account)
    ctx.g["reports"].append(report)
    ctx.g["payments"].append(payment)
    rewrite_original(ctx, records)
    checked(db, ctx)
    for row in list(db.identity_map.values()):
        if isinstance(
            row, (m.ElectionExternalFinanceReport, m.ElectionExternalFinancePayment)
        ):
            db.expunge(row)
    loaded, statements, bound_values = [], [], []

    def capture_row(session, instance):
        if isinstance(
            instance,
            (m.ElectionExternalFinanceReport, m.ElectionExternalFinancePayment),
        ):
            loaded.append(instance.key)

    def capture_sql(conn, cursor, statement, parameters, context, many):
        statements.append(" ".join(statement.split()))
        bound_values.extend(parameters.values())

    connection = db.connection()
    event.listen(db, "loaded_as_persistent", capture_row)
    event.listen(connection, "before_cursor_execute", capture_sql)
    try:
        result = reads.bulk_finance(
            db, election_key=ctx.g["election_key"], store=ctx.store
        )
    finally:
        event.remove(db, "loaded_as_persistent", capture_row)
        event.remove(connection, "before_cursor_execute", capture_sql)
    assert {r["stable_id"] for r in result["coverage"]} == {
        r["stable_id"] for r in ctx.g["coverage"]
    }
    assert report["report_key"] not in loaded and payment["payment_key"] not in loaded
    assert {r["payment_key"] for r in result["candidates"][0]["own_payments"]} == {
        r["payment_key"] for r in ctx.g["payments"] if r is not payment
    }
    assert not any(
        re.search(
            r"(?:SELECT|,) election_external_finance_generation\.payload(?:,| FROM| AS)",
            sql,
        )
        for sql in statements
    )
    payment_queries = [
        sql for sql in statements if "FROM election_external_finance_payment" in sql
    ]
    assert len(payment_queries) == 1
    assert "target_source_candidate_id" in bound_values
    assert "account_id) IN" in payment_queries[0]
    # Compare the complete wire response, including exact version/source pins,
    # with the previous full-generation hydration path on the same held records.
    monkeypatch.setattr(
        storage,
        "load_published_view",
        lambda db, row, *a, **kw: storage.load_generation(db, row.id),
    )
    legacy = reads.bulk_finance(db, election_key=ctx.g["election_key"], store=ctx.store)
    assert result == legacy


def test_separate_payer_original_loss_withholds_only_its_payments(db, external):
    import hashlib
    from alethical.pipeline.election_comparison import digest

    ctx = external
    records = []

    def bind(facts):
        row = len(records)
        records.append(deepcopy(facts))
        return {
            "source_sha256": None,
            "adapter": "synthetic:v1",
            "locator": {"row": row},
            "quote": json.dumps(facts, sort_keys=True),
            "facts": deepcopy(facts),
        }

    spender = deepcopy(ctx.g["accounts"][0])
    spender.update(
        account_id="C00000002",
        name="Separate payer",
        source_candidate_id=None,
        candidate_name=None,
    )
    spender["binding"] = bind(storage.account_facts(spender))
    report = deepcopy(ctx.g["reports"][1])
    report.update(
        report_key=digest("separate payer report"),
        account_id=spender["account_id"],
        source_report_id="200",
        series_id="separate-payer-series",
        predecessor_report_key=None,
        source_sha256=None,
        figures=[],
    )
    report["binding"] = bind(storage.report_facts(report))
    payment = deepcopy(ctx.g["payments"][0])
    payment.update(
        payment_key=digest("separate payer payment"),
        account_id=spender["account_id"],
        source_report_id="200",
        report_key=report["report_key"],
        source_sha256=None,
    )
    payment["binding"] = bind(storage.payment_facts(payment))
    body = json.dumps(
        {"schema": "trusted-synthetic-v1", "records": records}, sort_keys=True
    ).encode()
    source_hash = hashlib.sha256(body).hexdigest()
    for item in (spender, report, payment):
        if "source_sha256" in item:
            item["source_sha256"] = source_hash
        item["binding"]["source_sha256"] = source_hash
    ctx.g["accounts"].append(spender)
    ctx.g["reports"].append(report)
    ctx.g["payments"].append(payment)
    source = deepcopy(ctx.g["sources"][-1])
    source["sha256"] = source_hash
    ctx.g["sources"].append(source)
    ctx.originals[source_hash] = body
    rehash(ctx.g)
    for evidence in ctx.args["evidence"]:
        if "generation_id" in evidence:
            evidence["generation_id"] = ctx.g["id"]
    checked(db, ctx)
    before = reads.candidate_finance(db, **args(ctx))
    assert len(before["payments"]) == 3
    source_row = db.get(m.ElectionResultSource, source_hash)
    ctx.store.objects.pop(source_row.object_key)
    after = reads.candidate_finance(db, **args(ctx))
    assert after["accounts"] == before["accounts"]
    assert len(after["payments"]) == 2
    assert all(p["account_id"] != spender["account_id"] for p in after["payments"])
    assert after["version"] != before["version"]


def test_operational_coverage_keeps_ballot_source_links_and_freshness(db, external):
    ctx = external
    checked(db, ctx)
    kwargs = {"election_key": ctx.g["election_key"], "store": ctx.store}
    before = reads.bulk_finance(db, **kwargs)
    coverage = next(
        r for r in before["coverage"] if r["authority_family"] == "county_local"
    )
    ballot_hash = coverage["source_sha256"]
    assert coverage["status"] == "unmatched"
    assert ballot_hash in {s["sha256"] for s in before["sources"]}
    original = db.get(m.ElectionResultSource, ballot_hash)
    body = ctx.store.objects.pop(original.object_key)
    after = reads.bulk_finance(db, **kwargs)
    assert after["version"] != before["version"]
    missing = next(
        r for r in after["coverage"] if r["stable_id"] == coverage["stable_id"]
    )
    assert missing["status_basis"] == "sources_unavailable"
    assert missing["status"] == "unchecked"
    assert after["candidates"] == before["candidates"]
    with pytest.raises(HTTPException) as error:
        reads.bulk_finance(db, **kwargs, version=before["version"])
    assert error.value.status_code == 409
    ctx.store.objects[original.object_key] = body
    assert reads.bulk_finance(db, **kwargs) == before


def test_bulk_keeps_source_links_used_only_by_account_review(db, external):
    import hashlib

    ctx = external
    body = ctx.originals[ctx.source_hash] + b"\n"
    identity_hash = hashlib.sha256(body).hexdigest()
    metadata = deepcopy(ctx.g["sources"][-1])
    metadata["sha256"] = identity_hash
    ctx.g["sources"].append(metadata)
    ctx.originals[identity_hash] = body
    designation = next(e for e in ctx.args["evidence"] if e["kind"] == "designation")
    designation["sha256"] = identity_hash
    designation["binding"]["source_sha256"] = identity_hash
    rehash(ctx.g)
    for evidence in ctx.args["evidence"]:
        if "generation_id" in evidence:
            evidence["generation_id"] = ctx.g["id"]
    checked(db, ctx)
    result = reads.bulk_finance(db, election_key=ctx.g["election_key"], store=ctx.store)
    source = next((s for s in result["sources"] if s["sha256"] == identity_hash), None)
    assert source is not None, "Checked identity source has no reader source link"
    assert source == reads.public_source(metadata)
    assert (
        reads.source_body(
            db,
            election_key=ctx.g["election_key"],
            generation_id=ctx.g["id"],
            source_hash=identity_hash,
            store=ctx.store,
        )[0]
        == body
    )
    held = db.get(m.ElectionResultSource, identity_hash)
    ctx.store.objects.pop(held.object_key)
    after = reads.bulk_finance(db, election_key=ctx.g["election_key"], store=ctx.store)
    assert identity_hash not in {s["sha256"] for s in after["sources"]}
    assert after["version"] != result["version"]
    assert not after["candidates"][0]["accounts"]


def test_bulk_projects_each_referenced_historical_generation_once(
    db, external, monkeypatch
):
    ctx = external
    checked(db, ctx)
    newer = deepcopy(ctx.g)
    newer["coverage"][0]["next_action"] = "Continue exact-source collection"
    rehash(newer)
    storage.stage_generation(db, ctx.store, newer, {})
    storage.publish_generation(
        db, ctx.store, newer["id"], expected_previous=ctx.g["id"]
    )
    loaded = []
    load = storage.load_review_view

    def counted(*a, **kw):
        loaded.append(a[1])
        return load(*a, **kw)

    monkeypatch.setattr(storage, "load_review_view", counted)
    result = reads.bulk_finance(db, election_key=ctx.g["election_key"], store=ctx.store)
    assert len(result["candidates"][0]["reports"]) == 2
    assert loaded == [ctx.g["id"]]


@pytest.mark.parametrize("entity", ["authorities", "accounts"])
def test_historical_stored_identity_dependency_loss_versions_and_withholds(
    db, external, entity
):
    import hashlib

    ctx = external
    old_binding = deepcopy(ctx.g[entity][0]["binding"])
    body = ctx.originals[ctx.source_hash] + b"\n"
    extra = hashlib.sha256(body).hexdigest()
    metadata = deepcopy(ctx.g["sources"][-1])
    metadata["sha256"] = extra
    ctx.g["sources"].append(metadata)
    ctx.originals[extra] = body
    ctx.g[entity][0]["binding"]["source_sha256"] = extra
    rehash(ctx.g)
    for evidence in ctx.args["evidence"]:
        if "generation_id" in evidence:
            evidence["generation_id"] = ctx.g["id"]
    checked(db, ctx)
    newer = deepcopy(ctx.g)
    newer[entity][0]["binding"] = old_binding
    newer["sources"] = [r for r in newer["sources"] if r["sha256"] != extra]
    rehash(newer)
    storage.stage_generation(db, ctx.store, newer, {})
    storage.publish_generation(
        db, ctx.store, newer["id"], expected_previous=ctx.g["id"]
    )
    before = reads.candidate_finance(db, **args(ctx))
    assert before["accounts"]
    held = db.get(m.ElectionResultSource, extra)
    ctx.store.objects.pop(held.object_key)
    after = reads.candidate_finance(db, **args(ctx))
    assert not after["accounts"] and after["version"] != before["version"]
    with pytest.raises(HTTPException) as error:
        reads.candidate_finance(db, **args(ctx), version=before["version"])
    assert error.value.status_code == 409


def test_factual_coverage_depends_on_exact_ballot_original(db, external):
    from alethical.tests.test_election_external_finance import add_checked_coverage

    ctx = external
    row = add_checked_coverage(ctx)
    publish(db, ctx)
    kwargs = {"election_key": ctx.g["election_key"], "store": ctx.store}
    before = reads.context(db, **kwargs)
    source = db.get(m.ElectionResultSource, row["source_sha256"])
    ctx.store.objects.pop(source.object_key)
    after = reads.context(db, **kwargs)
    federal = next(r for r in after["coverage"] if r["authority_family"] == "federal")
    assert federal["status"] == "unchecked"
    assert after["version"] != before["version"]
    with pytest.raises(HTTPException) as error:
        reads.context(db, **kwargs, version=before["version"])
    assert error.value.status_code == 409


def test_payment_order_and_pages_ignore_physical_storage_order(db, external):
    from sqlalchemy import text

    ctx = external
    checked(db, ctx)
    before = reads.candidate_finance(db, **args(ctx))
    first = before["payments"][0]["payment_key"]
    keys = sorted(p["payment_key"] for p in ctx.g["payments"])
    direction = "DESC" if first == keys[0] else "ASC"
    db.execute(
        text(
            f"CREATE INDEX regression_payment_order ON election_external_finance_payment (generation_id, key {direction})"
        )
    )
    db.execute(
        text("CLUSTER election_external_finance_payment USING regression_payment_order")
    )
    after = reads.candidate_finance(db, **args(ctx), version=before["version"])
    assert after["payments"] == before["payments"]
    assert [p["payment_key"] for p in after["payments"]] == keys
    pages = [
        reads.payment_records(
            db, **args(ctx), limit=1, offset=i, version=before["version"]
        )["rows"][0]
        for i in range(len(keys))
    ]
    assert pages == before["payments"]
    bulk = reads.bulk_finance(db, election_key=ctx.g["election_key"], store=ctx.store)
    assert bulk["candidates"][0]["payments"] == before["payments"]


def test_operational_report_proposal_does_not_publish_invented_source_identity(
    db, external
):
    from alethical.pipeline.election_comparison import digest

    ctx = external
    gap = deepcopy(ctx.g["reports"][0])
    gap.update(
        report_key=digest("operational collection gap"),
        source_report_id="404000",
        series_id="proposal",
        predecessor_report_key=None,
        effective=False,
        check_status="retrieval_failed",
        figures=[],
        binding=None,
        source_sha256=None,
        period_start=None,
        period_end=None,
        next_action="Retry authority catalogue",
    )
    ctx.g["reports"].append(gap)
    rehash(ctx.g)
    for evidence in ctx.args["evidence"]:
        if "generation_id" in evidence:
            evidence["generation_id"] = ctx.g["id"]
    checked(db, ctx)
    result = reads.candidate_finance(db, **args(ctx))
    public = next(r for r in result["reports"] if r["report_key"] == gap["report_key"])
    assert (
        public["check_status"] == "retrieval_failed"
        and public["status_basis"] == "operational"
    )
    assert public["gap"] == "Reports unavailable"
    assert "next_action" not in public
    assert "Retry authority catalogue" not in json.dumps(public)
    assert public["figures"] is None and public["sources"] == []
    assert not {
        "source_report_id",
        "period_start",
        "period_end",
        "received_date",
        "effective",
    } & set(public)


def test_internal_collection_notes_stay_out_of_candidate_and_bulk_reads(db, external):
    ctx = external
    for row in ctx.g["coverage"]:
        row["next_action"] = (
            "PRIVATE_COLLECTION_NOTE source capture owned by another task"
        )
    rehash(ctx.g)
    for evidence in ctx.args["evidence"]:
        if "generation_id" in evidence:
            evidence["generation_id"] = ctx.g["id"]
    checked(db, ctx)
    candidate = reads.candidate_finance(db, **args(ctx))
    bulk = reads.bulk_finance(db, election_key=ctx.g["election_key"], store=ctx.store)
    for public in (candidate, bulk):
        assert "PRIVATE_COLLECTION_NOTE" not in json.dumps(public)
        assert "next_action" not in json.dumps(public)
    assert candidate["coverage"]["status"] == "account_confirmed"
    assert candidate["coverage"]["gap"] is None
    federal = next(
        row for row in bulk["coverage"] if row["authority_family"] == "federal"
    )
    assert federal["status"] == "account_confirmed"
    assert federal["gap"] is None
    local = next(
        row for row in bulk["coverage"] if row["authority_family"] == "county_local"
    )
    assert local["gap"] == "Campaign account not confirmed"


def test_factual_report_state_loss_withholds_status_and_invalidates_version(
    db, external
):
    import hashlib

    ctx = external
    report = ctx.g["reports"][0]
    report.update(
        check_status="unreadable", figures=[], next_action="Recover checked figures"
    )
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
    body = json.dumps(
        {"schema": "trusted-synthetic-v1", "records": [facts]}, sort_keys=True
    ).encode()
    h = hashlib.sha256(body).hexdigest()
    metadata = deepcopy(ctx.g["sources"][-1])
    metadata["sha256"] = h
    ctx.g["sources"].append(metadata)
    ctx.originals[h] = body
    report["status_binding"] = {
        "source_sha256": h,
        "adapter": "synthetic:v1",
        "locator": {"row": 0},
        "quote": json.dumps(facts, sort_keys=True),
        "facts": facts,
    }
    rehash(ctx.g)
    for evidence in ctx.args["evidence"]:
        if "generation_id" in evidence:
            evidence["generation_id"] = ctx.g["id"]
    checked(db, ctx)
    before = reads.candidate_finance(db, **args(ctx))
    public = next(
        r for r in before["reports"] if r["report_key"] == report["report_key"]
    )
    assert (
        public["check_status"] == "unreadable"
        and public["status_basis"] == "checked_source"
    )
    assert h in {source["source_sha256"] for source in public["sources"]}
    held = db.get(m.ElectionResultSource, h)
    ctx.store.objects.pop(held.object_key)
    after = reads.candidate_finance(db, **args(ctx))
    assert after["accounts"] == before["accounts"]
    public = next(
        r for r in after["reports"] if r["report_key"] == report["report_key"]
    )
    assert public["check_status"] == "sources_unavailable"
    assert after["version"] != before["version"]
    with pytest.raises(HTTPException) as error:
        reads.candidate_finance(db, **args(ctx), version=before["version"])
    assert error.value.status_code == 409


def test_bulk_own_account_payment_without_target_is_checked_separately(db, external):
    from alethical.tests.test_election_external_finance import rewrite_original

    ctx = external
    p = ctx.g["payments"][0]
    p.update(
        target_source_candidate_id=None,
        direction="unknown",
        transaction_type="F3:SB17",
        payee_address={
            "street_1": "123 Example",
            "street_2": None,
            "city": "St. Paul",
            "state": "MN",
            "postal_code": "05501",
        },
    )
    records = json.loads(ctx.originals[ctx.source_hash])["records"]
    records[p["binding"]["locator"]["row"]] = storage.payment_facts(p)
    rewrite_original(ctx, records)
    checked(db, ctx)
    result = reads.bulk_finance(db, election_key=ctx.g["election_key"], store=ctx.store)
    entry = result["candidates"][0]
    assert len(entry["payments"]) == 1
    own = next(x for x in entry["own_payments"] if x["payment_key"] == p["payment_key"])
    assert own["payee_address"]["postal_code"] == "05501"
    assert own["direction"] == "unknown"
    assert own["payer"]["name"] == "Example Committee"
    assert result["authorities"][0]["name"] == "Federal Election Commission"
    assert "raw_metadata" not in json.dumps(result)


def test_bulk_own_account_requires_whole_report_interval(db, external):
    from datetime import date

    ctx = external
    ctx.args["period_start"] = date(2026, 1, 1)
    checked(db, ctx)
    result = reads.bulk_finance(db, election_key=ctx.g["election_key"], store=ctx.store)
    assert result["candidates"][0]["payments"]
    assert result["candidates"][0]["own_payments"] == []
