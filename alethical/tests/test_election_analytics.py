"""Source rows, exact candidacies and descriptive outcomes must reconcile."""

# ruff: noqa: F811
from copy import deepcopy
from datetime import date, datetime
from decimal import Decimal
import csv
import gzip
import hashlib
import io
import json

import pytest
from sqlalchemy import event, select

from alethical.api.services import election_analytics as reads
from alethical.api.services import election_external_finance_reads as external_reads
from alethical.db import models as m
from alethical.pipeline import election_account_reviews as reviews
from alethical.pipeline.campaign_finance import EXPENDITURE_COLUMNS
from alethical.tests.finance_fixtures import finance_api, finance_db  # noqa: F401
from alethical.tests.test_election_finance_reads import comparison, COLLECTION  # noqa: F401
from alethical.tests.test_election_outside_spending import spending  # noqa: F401
from alethical.tests.test_election_comparison_reads import (
    KEY,
    RACE,
    SOURCE,
    BODY,
    _race,
    _snapshot,
    _current,
)
from alethical.tests.test_election_comparison_storage import MemoryStore
from alethical.tests.test_committee_finance import Published
from alethical.tests.test_election_external_finance import (
    external as external_generation,  # noqa: F401
    stage as stage_external,
    rewrite_original,
    append_binding,
)
from alethical.tests.test_election_external_memo_details import memo_fixture
from alethical.pipeline import election_external_finance as external_storage

BASE = f"/api/v1/finance/elections/{KEY}/analytics"
C = m.CampaignFinanceContributionRow


@pytest.fixture
def db(finance_db):
    """Use one isolated authenticated transaction for real external staging."""
    return finance_db


@pytest.fixture
def checked_external(finance_db, external_generation, monkeypatch):
    return publish_checked_external(finance_db, external_generation, monkeypatch)


def publish_checked_external(finance_db, ctx, monkeypatch, *, confirm=True):
    ctx.snapshot.first_published_at = datetime.fromisoformat(ctx.g["copied_at"])
    current = finance_db.get(m.ElectionComparisonCurrent, ctx.g["election_key"])
    if current is None:
        finance_db.add(
            m.ElectionComparisonCurrent(
                election_key=ctx.g["election_key"], snapshot_id=ctx.snapshot.id
            )
        )
    else:
        current.snapshot_id = ctx.snapshot.id
    stage_external(finance_db, ctx)
    if confirm:
        reviews.record_decision(finance_db, **ctx.args)
    external_storage.publish_generation(
        finance_db, ctx.store, ctx.g["id"], expected_previous=None
    )
    monkeypatch.setattr(external_reads, "raw_file_store_from_env", lambda: ctx.store)
    finance_db.commit()
    return ctx


def test_checked_external_funder_is_readable_without_board_publication(
    finance_api, checked_external
):
    data = _data(finance_api)
    assert data["source_scopes"]["mn_cfb"]["status"] == "not_published"
    assert data["source_scopes"]["external"]["status"] == "available"
    funder = next(f for f in data["funders"] if f.get("authority") == "fec")
    assert funder["source_family"] == "external"
    assert funder["source_account_id"] == "C00000001"
    assert funder["amounts"]["independent_For"]["amount"] == "123.4500"
    assert funder["supported_outcomes"] == {
        "candidacies": 1,
        "elected": 0,
        "not_elected": 0,
        "pending": 1,
    }
    assert funder["registration_number"] is None
    assert all(c["category"] != "PCF" for c in funder["recorded_classifications"])
    assert {m["currency"] for m in funder["source_measures"]} == {"USD"}
    page = _data(finance_api, "records", **_pins(data), funder_id=funder["funder_id"])
    assert len(page["rows"]) == 2
    assert page["rows"][0]["fields"]["Target candidate ID"] == "S6MN00001"
    assert page["rows"][0]["funder_name"] == "Example Committee"
    assert page["rows"][0]["funder_name"] != page["rows"][0]["fields"]["Vendor name"]
    encoded = json.dumps(page)
    for secret in (
        "PRIVATE_REASON",
        "PRIVATE_REVIEWER",
        "PRIVATE_OBJECT_KEY",
        "/private/internal",
    ):
        assert secret not in encoded


@pytest.mark.parametrize("damage", ["missing", "corrupt"])
def test_external_original_loss_invalidates_pin_and_restores_exact_version(
    finance_api, checked_external, damage
):
    ctx = checked_external
    before = _data(finance_api)
    source = next(s for s in ctx.g["sources"] if s["sha256"] == ctx.source_hash)
    key = next(k for k in ctx.store.objects if ctx.source_hash in k)
    original = ctx.store.objects.pop(key)
    if damage == "corrupt":
        ctx.store.objects[key] = b"corrupt retained body"
    response = finance_api.get(f"{BASE}/funders", params=_pins(before))
    assert response.status_code == 409, response.text
    assert finance_api.get(f"{BASE}/funders").status_code == 503
    ctx.store.objects[key] = original
    assert _data(finance_api)["version"] == before["version"]
    assert source["authority"] == "fec"


def test_mixed_authorities_keep_external_when_board_original_is_unavailable(
    finance_db, finance_api, checked_external, monkeypatch
):
    board = retain_analytics_originals(finance_db, Published(finance_db), monkeypatch)
    before = _data(finance_api)
    assert before["source_scopes"]["mn_cfb"]["status"] == "available"
    key = board.retained_keys["contributions"]
    original = board.retained_store.objects.pop(key)
    assert finance_api.get(f"{BASE}/funders", params=_pins(before)).status_code == 409
    after = _data(finance_api)
    assert after["source_scopes"]["mn_cfb"]["status"] == "unavailable"
    assert after["source_scopes"]["external"]["status"] == "available"
    assert len(after["funders"]) == 1
    assert after["funders"][0]["amounts"]["independent_For"]["amount"] == "123.4500"
    source_response = finance_api.get(
        f"{BASE}/sources/contributions", params=_pins(after)
    )
    assert source_response.status_code == 503
    board.retained_store.objects[key] = original
    assert _data(finance_api)["version"] == before["version"]


def test_unconfirmed_external_identity_is_a_gap_not_an_empty_complete_report(
    finance_db, finance_api, external_generation, monkeypatch
):
    publish_checked_external(
        finance_db, external_generation, monkeypatch, confirm=False
    )
    assert finance_api.get(f"{BASE}/funders").status_code == 503
    retain_analytics_originals(finance_db, Published(finance_db), monkeypatch)
    data = _data(finance_api)
    assert data["funders"] == []
    assert data["source_scopes"]["external"]["status"] == "unavailable"
    assert data["source_scopes"]["external"]["coverage"][0]["status"] == "unmatched"
    assert data["complete_election_spending"] is False


def test_external_memo_is_preserved_but_never_summed_as_payment(
    finance_db, finance_api, external_generation, monkeypatch
):
    memo_fixture(external_generation, payment_date="2026-10-01")
    publish_checked_external(finance_db, external_generation, monkeypatch)
    data = _data(finance_api)
    assert data["funders"][0]["amounts"]["independent_For"]["amount"] is None
    measure = next(m for m in data["funders"][0]["source_measures"] if m["nonadditive"])
    assert measure["amount"] is None and measure["attribution"] == "nonadditive_memo"
    rows = _data(finance_api, "records", **_pins(data))["rows"]
    memo = next(r for r in rows if r["nonadditive"])
    assert memo["amount"] == "123.4500"
    assert memo["memo"]["back_reference_transaction_id"] == "parent-transaction"
    response = finance_api.get(
        f"{BASE}/export", params={"format": "csv", **_pins(data)}
    )
    assert response.status_code == 200, response.text
    parsed = list(csv.DictReader(io.StringIO(response.text)))
    detail = next(r for r in parsed if r["Row type"] == "Memo detail")
    assert detail["Memo detail USD"] == "123.4500" and detail["Payment USD"] == ""
    assert detail["Source currency"] == "USD"
    assert "kind=external" in detail["Source URL"]


@pytest.mark.parametrize("currency", [None, "CAD"])
def test_external_unknown_or_non_usd_currency_never_enters_usd_total(
    finance_db, finance_api, external_generation, monkeypatch, currency
):
    ctx = external_generation
    records = json.loads(ctx.originals[ctx.source_hash])["records"]
    payment = ctx.g["payments"][0]
    payment["currency"] = currency
    records[payment["binding"]["locator"]["row"]] = external_storage.payment_facts(
        payment
    )
    rewrite_original(ctx, records)
    publish_checked_external(finance_db, ctx, monkeypatch)
    data = _data(finance_api)
    metric = data["funders"][0]["amounts"]["independent_For"]
    assert metric["amount"] is metric["known_amount_subtotal"] is None
    assert metric["withheld_reason"] == "source_currency_not_usd"
    measure = next(
        m
        for m in data["funders"][0]["source_measures"]
        if m["direction"] == "independent_for"
    )
    assert measure["currency"] == currency and measure["amount"] == "123.4500"
    rows = _data(finance_api, "records", **_pins(data))["rows"]
    assert (
        next(r for r in rows if r["direction"] == "independent_for")["currency"]
        == currency
    )
    response = finance_api.get(
        f"{BASE}/export", params={"format": "csv", **_pins(data)}
    )
    assert response.status_code == 200, response.text
    parsed = list(csv.DictReader(io.StringIO(response.text)))
    payment = next(
        r
        for r in parsed
        if r["Row type"] == "Payment" and r["Direction"] == "independent_for"
    )
    assert (
        payment["Payment USD"] == "" and payment["Native payment amount"] == "123.4500"
    )
    assert payment["Source currency"] == (currency or "")
    assert payment["Currency"] == (currency or "")


def test_external_signed_native_direction_and_superseded_records_keep_meaning(
    finance_db, finance_api, external_generation, monkeypatch
):
    ctx = external_generation
    records = json.loads(ctx.originals[ctx.source_hash])["records"]
    payment = ctx.g["payments"][0]
    payment.update(amount="-12.3400", direction="coordinated_party")
    records[payment["binding"]["locator"]["row"]] = external_storage.payment_facts(
        payment
    )
    historical = deepcopy(payment)
    report = ctx.g["reports"][0]
    historical.update(
        payment_key="e" * 64,
        report_key=report["report_key"],
        source_report_id=report["source_report_id"],
        source_row_id="=literal-row",
        amount="99.00",
    )
    historical["binding"] = append_binding(
        ctx, records, external_storage.payment_facts(historical)
    )
    ctx.g["payments"].append(historical)
    rewrite_original(ctx, records)
    publish_checked_external(finance_db, ctx, monkeypatch)
    data = _data(finance_api)
    funder = data["funders"][0]
    assert funder["supported_outcomes"]["candidacies"] == 0
    assert funder["amounts"]["direct_contributions"]["amount"] is None
    native = {
        m["attribution"]: m
        for m in funder["source_measures"]
        if m["direction"] == "coordinated_party"
    }
    assert native["attributed"]["amount"] == "-12.3400"
    assert native["superseded_report"]["amount"] is None
    page = _data(
        finance_api, "records", **_pins(data), funder_id=funder["funder_id"], limit=1
    )
    assert page["page"]["total"] == 3 and len(page["rows"]) == 1
    filtered = _data(
        finance_api, "records", **_pins(data), resolution="superseded_report"
    )
    assert filtered["rows"][0]["source_row_id"] == "=literal-row"
    response = finance_api.get(
        f"{BASE}/export", params={"format": "csv", **_pins(data)}
    )
    assert response.status_code == 200, response.text
    parsed = list(csv.DictReader(io.StringIO(response.text)))
    previous = next(r for r in parsed if r["Row type"] == "Superseded payment")
    assert (
        previous["Payment USD"] == "" and previous["Superseded payment USD"] == "99.00"
    )
    assert previous["Source row ID"] == "'=literal-row"


def test_checked_local_namespace_uses_actual_recipient_and_keeps_native_measures(
    finance_db, finance_api, external_generation, monkeypatch
):
    ctx = external_generation
    local = next(
        c for c in ctx.g["coverage"] if c["authority_family"] == "county_local"
    )
    namespace = "local:city-00001"
    jurisdiction = {
        "recipient_id": "00001",
        "recipient_type": "municipality",
        "county_ids": ["01"],
        "municipal_fips_code": "00001",
    }
    candidate = {
        **ctx.candidate,
        "candidate_id": local["candidate_id"],
        "candidate_stable_id": local["stable_id"],
        "name": local["name"],
        "party": None,
    }
    ctx.race.office_id, ctx.race.jurisdiction = "1000", "01"
    ctx.race.payload = {
        **ctx.race.payload,
        "office_name": "Mayor",
        "candidate_source_sha256": local["source_sha256"],
        "candidates": [candidate],
    }
    ctx.race.label = "Mayor"
    replacements = {
        "fec": namespace,
        "Federal Election Commission": "City of Example",
        "United States": jurisdiction,
        "https://www.fec.gov": "https://example.gov",
        "https://www.fec.gov/synthetic.json": "https://example.gov/synthetic.json",
        "S6MN00001": local["candidate_id"],
        "Candidate Example": local["name"],
        "synthetic:v1": "synthetic-local:v1",
    }

    def convert(value):
        if isinstance(value, dict):
            return {k: convert(v) for k, v in value.items()}
        if isinstance(value, list):
            return [convert(v) for v in value]
        return (
            deepcopy(replacements.get(value, value))
            if isinstance(value, str)
            else value
        )

    records = convert(json.loads(ctx.originals[ctx.source_hash])["records"])
    original_coverage = deepcopy(ctx.g["coverage"])
    ctx.g = convert(ctx.g)
    ctx.g["coverage"] = original_coverage
    for covered in ctx.g["coverage"]:
        covered["authority"] = (
            namespace if covered["authority_family"] == "county_local" else None
        )
    ctx.args = convert(ctx.args)
    ctx.args.update(
        candidate_id=candidate["candidate_id"],
        identity=reviews.candidate_identity(ctx.race, candidate),
    )
    ctx.args["evidence"] = [
        e for e in ctx.args["evidence"] if e["kind"] != "designation"
    ]
    ctx.args["evidence"][0] = {
        "kind": "ballot",
        "sha256": local["source_sha256"],
        "row_number": 1,
        "literal_row": ctx.originals[local["source_sha256"]].decode().strip(),
    }
    next(c for c in ctx.g["coverage"] if c["authority_family"] == "county_local")[
        "authority"
    ] = namespace

    def local_adapter(raw, source, locator):
        assert (
            source["authority"] == namespace
            and source["url"] == "https://example.gov/synthetic.json"
        )
        facts = json.loads(raw)["records"][locator["row"]]
        return external_storage.CheckedExtraction(
            facts, json.dumps(facts, sort_keys=True)
        )

    external_storage.register_adapter("synthetic-local:v1", local_adapter)

    def refresh_bindings(value):
        if isinstance(value, dict):
            if value.get("adapter") == "synthetic-local:v1":
                facts = deepcopy(records[value["locator"]["row"]])
                value.update(facts=facts, quote=json.dumps(facts, sort_keys=True))
            else:
                for child in value.values():
                    refresh_bindings(child)
        elif isinstance(value, list):
            for child in value:
                refresh_bindings(child)

    refresh_bindings(ctx.g)
    refresh_bindings(ctx.args)
    rewrite_original(ctx, records)
    publish_checked_external(finance_db, ctx, monkeypatch)
    data = _data(finance_api)
    funder = data["funders"][0]
    assert funder["authority"] == namespace and funder["names"] == ["Example Committee"]
    assert funder["registration_number"] is None
    assert funder["amounts"]["independent_For"]["amount"] == "123.4500"
    assert all(m["authority"] == namespace for m in funder["source_measures"])
    assert reads._external_funder_id("fec", "C00000001") != funder["funder_id"]


def test_real_external_payload_shared_record_dedup_keeps_ambiguity_before_filters(
    finance_db, checked_external
):
    ctx = checked_external
    payload = external_reads.bulk_finance(finance_db, election_key=KEY, store=ctx.store)
    # Replay one checked source row associated with two exact current candidacies.
    # No new review is applied: this probes the analytics boundary's ambiguity rule.
    second = deepcopy(payload["candidates"][0])
    second["candidate_id"] = "another-exact-id"
    payload["candidates"].append(second)
    race = deepcopy(ctx.race)
    race.payload = deepcopy(ctx.race.payload)
    race.payload["candidates"].append(
        {**ctx.candidate, "candidate_id": second["candidate_id"]}
    )
    events, _ = reads._external_events(payload, [race])
    assert len(events) == 2
    assert {e["resolution"] for e in events} == {"conflicting_claims"}
    assert all(not e["claims"] and len(e["related_candidacies"]) == 2 for e in events)
    filtered = reads._record_filters(events, second["candidate_id"], None, None)
    assert len(filtered) == 2
    assert all(
        e["resolution"] == "conflicting_claims" and not e["claims"] for e in filtered
    )
    assert reads._metrics(filtered)["independent_For"]["amount"] is None


def test_external_bulk_is_built_once_per_request_with_fresh_bounded_original_gets(
    finance_api, checked_external, monkeypatch
):
    ctx = checked_external
    bulk, get = external_reads.bulk_finance, ctx.store.get
    calls, gets = [], []

    def counted_bulk(*args, **kwargs):
        calls.append(1)
        return bulk(*args, **kwargs)

    def counted_get(*args, **kwargs):
        gets.append(args[0])
        return get(*args, **kwargs)

    monkeypatch.setattr(external_reads, "bulk_finance", counted_bulk)
    monkeypatch.setattr(ctx.store, "get", counted_get)
    for _ in range(2):
        calls.clear()
        gets.clear()
        data = _data(finance_api)
        assert data["funders"] and calls == [1]
        # The account original and both ballot originals are freshly fetched
        # once each per request, including the unmatched local coverage row.
        assert len(gets) == len(set(gets)) == 3
        assert {key.rsplit("/", 1)[-1].removesuffix(".gz") for key in gets} == set(
            ctx.originals
        )


def test_external_distinct_source_periods_never_become_one_usd_metric(
    finance_db, checked_external
):
    ctx = checked_external
    payload = external_reads.bulk_finance(finance_db, election_key=KEY, store=ctx.store)
    events, _ = reads._external_events(payload, [ctx.race])
    first = next(e for e in events if e["metric"] == "independent_For")
    second = deepcopy(first)
    second.update(
        report_key="d" * 64,
        source_report_id="separate-period",
        period_start="2026-10-15",
        period_end="2026-10-31",
        date="2026-10-20",
        amount="5.0000",
    )
    # Pure aggregation boundary replay: the second period is not a new applied
    # review, and is never claimed as published source evidence by this test.
    metric = reads._metrics([first, second])["independent_For"]
    assert metric["amount"] is metric["known_amount_subtotal"] is None
    assert metric["withheld_reason"] == "source_specific_reporting_periods"
    measures = reads._native_measures([first, second])
    assert sorted(m["amount"] for m in measures) == ["123.4500", "5.0000"]
    assert len({(m["period_start"], m["period_end"]) for m in measures}) == 2


def retain_analytics_originals(finance_db, publication, monkeypatch):
    # The publication's source rows have actual retained originals, including
    # legitimately empty source datasets, rather than metadata-only promises.
    store = MemoryStore()
    originals, keys = {}, {}
    for dataset, snapshot, model, columns in (
        ("contributions", publication.contributions, C, reads.CONTRIBUTION_COLUMNS),
        (
            "expenditures",
            publication.expenditures,
            m.CampaignFinanceExpenditureRow,
            EXPENDITURE_COLUMNS,
        ),
        (
            "independent_expenditures",
            publication.independent,
            m.CampaignFinanceIndependentExpenditureRow,
            reads.INDEPENDENT_COLUMNS,
        ),
    ):
        text = io.StringIO(newline="")
        writer = csv.writer(text, lineterminator="\r\n")
        writer.writerow([column.source for column in columns])
        for row in finance_db.scalars(
            reads.select(model)
            .where(model.snapshot_id == snapshot.id)
            .order_by(model.row_number)
        ):
            writer.writerow([getattr(row, column.attribute) for column in columns])
        body = text.getvalue().encode("utf-8")
        compressed = gzip.compress(body, mtime=0)
        snapshot.content_hash = hashlib.sha256(body).hexdigest()
        snapshot.byte_size = len(body)
        key = f"analytics-{snapshot.id}-{dataset}.csv.gz"
        keys[dataset] = key
        store.objects[key] = compressed
        finance_db.add(
            m.CampaignFinanceSnapshotBody(
                snapshot_id=snapshot.id,
                object_key=key,
                compression="gzip",
                compressed_hash=hashlib.sha256(compressed).hexdigest(),
                compressed_byte_size=len(compressed),
            )
        )
        originals[dataset] = body
    finance_db.commit()
    # Account review evidence uses the fixture's actual retained ballot and
    # report bytes too; object metadata alone must never keep a link usable.
    ballot = finance_db.get(m.ElectionResultSource, SOURCE)
    if ballot is not None:
        store.objects[ballot.object_key] = gzip.compress(BODY, mtime=0)
    for document in finance_db.scalars(select(m.CampaignFinanceReportDocument)):
        raw = b"%PDF-1.4\nSynthetic retained fixture " + document.report_type.encode()
        if hashlib.sha256(raw).hexdigest() == document.document_hash:
            store.objects[document.object_key] = gzip.compress(raw, mtime=0)
    publication.retained_store = store
    publication.originals = originals
    publication.retained_keys = keys
    monkeypatch.setattr(reads, "raw_file_store_from_env", lambda: store)
    return publication


@pytest.fixture()
def analytics(finance_db, comparison, spending, monkeypatch):
    defaults = dict(
        recipient_reg_num="-101",
        recipient="Candidate committee",
        recipient_type="PCC",
        recipient_subtype="Candidate",
        contributor="Example fund",
        contrib_reg_num="40001",
        contrib_type="Political Committee/Fund",
        receipt_type="Contribution",
        receipt_date=date(2026, 10, 1),
        year=2026,
        amount=Decimal("10"),
    )
    changes = [
        {},
        {},
        {"amount": Decimal("-3")},
        {"amount": None},
        {"receipt_type": "Loan Payable", "amount": Decimal("99")},
        {"receipt_date": None, "amount": Decimal("4")},
        {"recipient_reg_num": "unreviewed", "amount": Decimal("8")},
        {"year": None, "amount": Decimal("7")},
        {"year": 2025, "amount": Decimal("11")},
        {"receipt_date": date(2026, 10, 20), "amount": Decimal("2")},
        {"contrib_reg_num": "40002", "amount": Decimal("13")},
        {"contrib_reg_num": None, "amount": Decimal("1")},
        {"contrib_reg_num": None, "amount": Decimal("1")},
    ]
    for number, change in enumerate(changes, 1):
        finance_db.add(
            C(
                snapshot_id=spending.contributions.id,
                row_number=number,
                **(defaults | change),
            )
        )
    spending.contributions.row_count = len(changes)
    for number, registration in enumerate(("40001", "40002"), 1):
        finance_db.add(
            m.CampaignFinanceExpenditureRow(
                snapshot_id=spending.expenditures.id,
                row_number=number,
                committee_reg_num=registration,
                committee_name="Example fund",
                entity_type="PCF",
                amount=Decimal("1"),
                year=2026,
            )
        )
    spending.expenditures.row_count = 2
    finance_db.commit()
    return retain_analytics_originals(finance_db, spending, monkeypatch)


def _data(client, section="funders", **params):
    response = client.get(f"{BASE}/{section}", params=params)
    assert response.status_code == 200, response.text
    return response.json()["data"]


def _pins(data):
    return {key: data[key] for key in ("snapshot_id", "version")}


@pytest.mark.parametrize(
    "damage",
    [
        "missing",
        "truncated",
        "oversized",
        "compressed_hash",
        "compressed_length",
        "raw_hash",
        "raw_short",
        "raw_long",
        "bad_gzip",
        "crc",
        "compression",
    ],
)
def test_source_bytes_loss_rejects_pins_withholds_fresh_and_recovers(
    finance_api, finance_db, analytics, damage
):
    before = _data(finance_api)
    snapshot = analytics.contributions
    retained = finance_db.get(m.CampaignFinanceSnapshotBody, snapshot.id)
    store = analytics.retained_store
    saved = store.objects[retained.object_key]
    fields = (
        snapshot.content_hash,
        snapshot.byte_size,
        retained.compressed_hash,
        retained.compressed_byte_size,
        retained.compression,
    )
    if damage == "missing":
        del store.objects[retained.object_key]
    elif damage == "truncated":
        store.objects[retained.object_key] = saved[:-1]
    elif damage == "oversized":
        store.objects[retained.object_key] = saved + b"extra"
    elif damage == "compressed_hash":
        retained.compressed_hash = "0" * 64
    elif damage == "compressed_length":
        retained.compressed_byte_size += 1
    elif damage == "raw_hash":
        snapshot.content_hash = "0" * 64
    elif damage == "raw_short":
        snapshot.byte_size -= 1
    elif damage == "raw_long":
        snapshot.byte_size += 1
    elif damage == "bad_gzip":
        broken = b"invalid gzip" + b"x" * len(saved)
        store.objects[retained.object_key] = broken
        retained.compressed_hash = hashlib.sha256(broken).hexdigest()
        retained.compressed_byte_size = len(broken)
    elif damage == "crc":
        broken = saved[:-8] + b"\0" * 8
        store.objects[retained.object_key] = broken
        retained.compressed_hash = hashlib.sha256(broken).hexdigest()
    elif damage == "compression":
        retained.compression = "unknown"
    finance_db.commit()
    for section in ("funders", "candidates", "records", "export"):
        assert (
            finance_api.get(f"{BASE}/{section}", params=_pins(before)).status_code
            == 409
        )
    assert (
        finance_api.get(
            before["sources"]["contributions"]["retained_source_url"]
        ).status_code
        == 409
    )
    assert finance_api.get(f"{BASE}/funders").status_code == 503
    assert finance_api.get(f"{BASE}/candidates").status_code == 503
    store.objects[retained.object_key] = saved
    (
        snapshot.content_hash,
        snapshot.byte_size,
        retained.compressed_hash,
        retained.compressed_byte_size,
        retained.compression,
    ) = fields
    finance_db.commit()
    restored = _data(finance_api)
    assert restored["version"] == before["version"]
    assert restored["funders"] == before["funders"]
    assert (
        finance_api.get(
            before["sources"]["contributions"]["retained_source_url"]
        ).content
        == analytics.originals["contributions"]
    )


def test_each_required_source_is_read_once_per_request_and_source_body_reuses_it(
    finance_api, analytics, monkeypatch
):
    store = analytics.retained_store
    original_get = store.get
    calls = []

    def record_get(key, path, *, max_bytes=None):
        calls.append((key, max_bytes))
        return original_get(key, path, max_bytes=max_bytes)

    monkeypatch.setattr(store, "get", record_get)
    data = _data(finance_api)
    assert len(calls) == 5  # 3 bulk originals plus 2 unique account-review originals
    assert len({key for key, _ in calls}) == 5
    assert all(cap is not None and cap > 0 for _, cap in calls)
    calls.clear()
    assert (
        finance_api.get(data["sources"]["contributions"]["retained_source_url"]).content
        == analytics.originals["contributions"]
    )
    assert len(calls) == 5
    assert len({key for key, _ in calls}) == 5
    calls.clear()
    _data(finance_api, **_pins(data))
    assert len(calls) == 5  # no persistent availability cache, including unchanged pins


@pytest.mark.parametrize(
    "dataset", ["contributions", "expenditures", "independent_expenditures"]
)
def test_missing_original_never_becomes_a_complete_empty_search(
    finance_api, analytics, dataset
):
    before = _data(finance_api)
    del analytics.retained_store.objects[analytics.retained_keys[dataset]]
    assert (
        finance_api.get(
            f"{BASE}/funders", params={**_pins(before), "q": "No such funder"}
        ).status_code
        == 409
    )
    assert (
        finance_api.get(f"{BASE}/funders", params={"q": "No such funder"}).status_code
        == 503
    )


def test_missing_retained_metadata_changes_pin_and_requires_a_new_proof(
    finance_api, finance_db, analytics
):
    before = _data(finance_api)
    retained = finance_db.get(m.CampaignFinanceSnapshotBody, analytics.contributions.id)
    saved = {
        key: getattr(retained, key)
        for key in (
            "snapshot_id",
            "object_key",
            "compression",
            "compressed_hash",
            "compressed_byte_size",
        )
    }
    finance_db.delete(retained)
    finance_db.commit()
    assert finance_api.get(f"{BASE}/funders", params=_pins(before)).status_code == 409
    assert finance_api.get(f"{BASE}/funders").status_code == 503
    finance_db.add(m.CampaignFinanceSnapshotBody(**saved))
    finance_db.commit()
    assert _data(finance_api)["version"] == before["version"]


def test_raw_stream_is_bounded_without_whole_body_reads(tmp_path, monkeypatch):
    import tracemalloc

    raw = b"source record\n" * (32 * 1024 * 1024 // 14)
    raw_size = len(raw)
    raw_hash = hashlib.sha256(raw).hexdigest()
    compressed = gzip.compress(raw, mtime=0)
    del raw
    store = MemoryStore()
    store.objects["large.gz"] = compressed
    proof = reads._SourceProof(
        "large.gz",
        "gzip",
        hashlib.sha256(compressed).hexdigest(),
        len(compressed),
        raw_hash,
        raw_size,
    )
    gzip_open = reads.gzip.open
    sizes = []

    class TracedReader:
        def __init__(self, *args):
            self.handle = gzip_open(*args)

        def __enter__(self):
            return self

        def __exit__(self, *args):
            self.handle.close()

        def read(self, size):
            sizes.append(size)
            return self.handle.read(size)

    monkeypatch.setattr(reads.gzip, "open", TracedReader)
    monkeypatch.setattr(
        reads.Path,
        "read_bytes",
        lambda path: pytest.fail("Ordinary source proof buffered an entire file"),
    )
    tracemalloc.start()
    try:
        assert reads._verify_original(store, proof)
        _, peak = tracemalloc.get_traced_memory()
    finally:
        tracemalloc.stop()
    assert sizes and max(sizes) <= reads.SOURCE_CHUNK_BYTES
    assert peak < 8 * reads.SOURCE_CHUNK_BYTES
    sizes.clear()
    short = reads._SourceProof(
        "large.gz", "gzip", proof.compressed_hash, len(compressed), raw_hash, 16
    )
    assert not reads._verify_original(store, short)
    assert max(sizes) <= 17  # stop at the recorded cap plus one, not the 32 MiB member


@pytest.mark.parametrize("kind", ["ballot", "report_cover"])
def test_actual_account_evidence_loss_invalidates_pin_and_dated_relationship(
    finance_api, finance_db, analytics, comparison, kind
):
    before = _data(finance_api)
    item = next(e for e in comparison["decision"].evidence if e["kind"] == kind)
    model = (
        m.CampaignFinanceReportDocument
        if kind == "report_cover"
        else m.ElectionResultSource
    )
    source = finance_db.get(model, item["sha256"])
    stored = analytics.retained_store.objects[source.object_key]
    analytics.retained_store.objects[source.object_key] = b"corrupt account original"
    assert finance_api.get(f"{BASE}/funders", params=_pins(before)).status_code == 409
    after = _data(finance_api)
    assert all(f["supported_outcomes"]["candidacies"] == 0 for f in after["funders"])
    assert all(
        f["amounts"]["direct_contributions"]["amount"] is None for f in after["funders"]
    )
    assert {
        r["resolution"] for r in _data(finance_api, "records", **_pins(after))["rows"]
    } >= {"no_confirmed_account"}
    analytics.retained_store.objects[source.object_key] = stored
    assert _data(finance_api)["version"] == before["version"]


@pytest.mark.parametrize("historical", [False, True])
def test_review_cover_account_role_drift_invalidates_pins_and_recovers(
    finance_api, finance_db, analytics, comparison, historical, monkeypatch
):
    prior = finance_db.scalar(
        select(m.CampaignFinanceReportDocument).where(
            m.CampaignFinanceReportDocument.report_type == "P",
            m.CampaignFinanceReportDocument.registration_number == "-101",
        )
    )
    evidence = deepcopy(comparison["args"]["evidence"])
    evidence[-1]["sha256"] = prior.document_hash
    decision = reviews.record_decision(
        finance_db,
        **{
            **comparison["args"],
            "evidence": evidence,
            "expected_previous_id": comparison["decision"].id,
        },
    )
    finance_db.flush()
    if historical:
        current_args = dict(comparison["args"])
        current_args["expected_previous_id"] = decision.id
        reviews.record_decision(finance_db, **current_args)
        finance_db.flush()
    get = analytics.retained_store.get
    gets = []

    def counted_get(*args, **kwargs):
        gets.append(args[0])
        return get(*args, **kwargs)

    monkeypatch.setattr(analytics.retained_store, "get", counted_get)
    before = _data(finance_api, "candidates")
    expected_gets = sorted(gets)
    assert len(gets) == len(set(gets))
    before_candidate = next(c for c in before["candidates"] if c["candidate_id"] == "a")
    assert before_candidate["account_links"]["accounts"]
    # Exact bytes still pass: only the retained document's account role changes.
    prior.registration_number = "-999"
    finance_db.flush()
    gets.clear()
    after = _data(finance_api, "candidates")
    assert sorted(gets) == expected_gets
    assert after["version"] != before["version"]
    assert finance_api.get(f"{BASE}/funders", params=_pins(before)).status_code == 409
    candidate = next(c for c in after["candidates"] if c["candidate_id"] == "a")
    if historical:
        assert candidate["account_links"] == before_candidate["account_links"]
        assert candidate["amounts"] == before_candidate["amounts"]
    else:
        assert candidate["account_links"]["accounts"] == []
        assert candidate["account_links"]["gaps"] == [
            {"registration_number": "-101", "state": "sources_unavailable"}
        ]
        assert candidate["amounts"]["direct_contributions"]["amount"] is None
        assert candidate["supported"] is False
    prior.registration_number = "-101"
    finance_db.flush()
    restored = _data(finance_api, "candidates")
    assert restored["version"] == before["version"]
    assert restored["candidates"] == before["candidates"]


def test_funders_sort_by_name_before_pagination(finance_api, finance_db, analytics):
    row = finance_db.get(C, (analytics.contributions.id, 12))
    row.contributor = "alpha fund"
    row = finance_db.get(C, (analytics.contributions.id, 13))
    row.contributor = "Zulu fund"
    finance_db.commit()

    all_rows = _data(finance_api)["funders"]
    assert all_rows[0]["names"] == ["alpha fund"]
    assert all_rows[-1]["names"] == ["Zulu fund"]
    first = _data(finance_api, limit=2, offset=0)
    second = _data(finance_api, limit=2, offset=2, **_pins(first))
    assert first["funders"] == all_rows[:2]
    assert second["funders"] == all_rows[2:4]
    assert len({r["funder_id"] for r in all_rows}) == len(all_rows)


def test_distinct_support_keeps_repeated_rows_refunds_and_unknown_amount(
    finance_api, analytics
):
    data = _data(finance_api)
    funder = next(f for f in data["funders"] if f["funder_id"] == "registration:40001")
    assert funder["supported_outcomes"] == {
        "candidacies": 1,
        "elected": 0,
        "not_elected": 0,
        "pending": 1,
    }
    direct = funder["amounts"]["direct_contributions"]
    assert direct == {
        "state": "amount_unavailable",
        "record_count": 4,
        "amount": None,
        "known_amount_subtotal": "17.0000",
        "missing_amount_count": 1,
    }
    assert funder["amounts"]["independent_For"]["amount"] == "20.0000"
    assert funder["amounts"]["independent_unknown"]["amount"] is None
    assert funder["opposed_outcomes"]["candidacies"] == 0
    assert funder["support_count_review"]["state"] == "review_negative_records"
    evidence = finance_api.get(funder["evidence_url"]).json()["data"]["rows"]
    direct_rows = [
        r
        for r in evidence
        if r["metric"] == "direct_contributions" and r["resolution"] == "attributed"
    ]
    assert [r["row_number"] for r in direct_rows] == [1, 2, 3, 4]
    assert direct_rows[0]["fields"] == direct_rows[1]["fields"]
    assert all(
        r["source"]["snapshot_id"] == str(analytics.contributions.id)
        for r in direct_rows
    )
    assert "private-reviewer" not in json.dumps(data)


def test_never_merge_identical_names_or_missing_registration_numbers(
    finance_api, analytics
):
    data = _data(finance_api)
    identical_names = [f for f in data["funders"] if f["names"] == ["Example fund"]]
    assert {f["funder_id"] for f in identical_names} >= {
        "registration:40001",
        "registration:40002",
    }
    unnamed_ids = [
        f["funder_id"] for f in identical_names if not f["source_registration_values"]
    ]
    assert len(unnamed_ids) == 2 and len(set(unnamed_ids)) == 2
    assert "PAC" not in json.dumps(data)
    classifications = next(
        f for f in data["funders"] if f["funder_id"] == "registration:40001"
    )["recorded_classifications"]
    assert {c["recorded_type"] for c in classifications} == {
        "PCF",
        "Political Committee/Fund",
    }
    assert (
        next(f for f in data["funders"] if f["funder_id"] == "registration:40001")[
            "identity_evidence"
        ][0]["row_number"]
        == 1
    )


def test_source_partition_preserves_non_contributions_missing_year_and_missing_amount(
    finance_api, analytics
):
    data = _data(finance_api)
    direct = [b for b in data["reconciliation"] if b["dataset"] == "contributions"]
    assert (
        sum(b["record_count"] for b in direct)
        + data["other_source_years"]["contributions"]["record_count"]
        == 13
    )
    amounts = sum(
        (Decimal(b["known_amount_subtotal"] or "0") for b in direct), Decimal(0)
    )
    assert amounts == Decimal("152")
    assert sum(b["missing_amount_count"] for b in direct) == 1
    assert {b["resolution"] for b in direct} == {
        "attributed",
        "other_receipt_type",
        "missing_date",
        "missing_year",
        "no_confirmed_account",
        "outside_reviewed_period",
    }
    assert (
        next(b for b in direct if b["resolution"] == "other_receipt_type")["amount"]
        == "99.0000"
    )
    candidates = _data(finance_api, "candidates")["candidates"]
    assert len(candidates) == 2
    assert candidates[1]["amounts"]["direct_contributions"]["amount"] is None
    assert candidates[1]["account_links"]["accounts"] == []


def test_period_edges_and_exact_funder_filter_do_not_hide_global_inventory(
    finance_api, analytics
):
    all_data = _data(finance_api)
    data = _data(
        finance_api,
        start_date="2026-10-01",
        end_date="2026-10-01",
        funder_id="registration:40002",
    )
    assert [f["funder_id"] for f in data["funders"]] == ["registration:40002"]
    assert data["funders"][0]["amounts"]["direct_contributions"]["amount"] == "13.0000"
    assert any(
        b["resolution"] == "outside_selected_period" for b in data["reconciliation"]
    )
    assert sum(b["record_count"] for b in data["reconciliation"]) == sum(
        b["record_count"] for b in all_data["reconciliation"]
    )
    assert (
        finance_api.get(
            f"{BASE}/funders",
            params={"start_date": "2026-11-01", "end_date": "2026-10-01"},
        ).status_code
        == 422
    )


def test_same_funder_for_and_against_is_separate_not_opponent_support(
    finance_api, finance_db, analytics
):
    row = finance_db.get(
        m.CampaignFinanceIndependentExpenditureRow, (analytics.independent.id, 3)
    )
    row.affected_committee_reg_num = "-101"
    row.spender_type = "PCF"
    finance_db.commit()
    funder = next(
        f
        for f in _data(finance_api)["funders"]
        if f["funder_id"] == "registration:40001"
    )
    assert funder["amounts"]["independent_Against"]["amount"] == "20.0000"
    assert funder["supported_outcomes"]["candidacies"] == 1
    assert funder["opposed_outcomes"]["candidacies"] == 1
    candidate = _data(finance_api, "candidates", funder_id="registration:40001")[
        "candidates"
    ][0]
    assert candidate["supported"] is True and candidate["opposed"] is True


def test_candidate_ids_are_scoped_by_race_and_conflicting_claims_not_duplicated(
    finance_api, finance_db, analytics, comparison
):
    other = _race(finance_db, race_id="8" * 64)
    other.payload = deepcopy(comparison["race"].payload)
    other_args = {
        **comparison["args"],
        "race_id": other.id,
        "identity": reviews.candidate_identity(other, other.payload["candidates"][0]),
        "compatible_decision_ids": [comparison["decision"].id],
        "evidence": [
            *comparison["args"]["evidence"],
            {
                "kind": "same_person",
                "sha256": SOURCE,
                "decision_ids": [comparison["decision"].id],
            },
        ],
    }
    decision = reviews.record_decision(finance_db, **other_args)
    # The contract permits explicit compatible account claims; analytics still
    # never duplicates a source payment across races when attribution conflicts.
    finance_db.commit()
    data = _data(finance_api)
    assert any(b["resolution"] == "conflicting_claims" for b in data["reconciliation"])
    assert all(f["supported_outcomes"]["candidacies"] == 0 for f in data["funders"])
    candidate_rows = _data(finance_api, "candidates")["candidates"]
    assert len([c for c in candidate_rows if c["candidate_id"] == "a"]) == 2
    assert decision.id > comparison["decision"].id


@pytest.mark.parametrize("change", ["withdrawal", "source", "collection"])
def test_changed_review_or_missing_identity_evidence_invalidates_pages(
    finance_api, finance_db, analytics, comparison, change
):
    before = _data(finance_api)
    if change == "withdrawal":
        reviews.record_decision(
            finance_db,
            **{
                **comparison["args"],
                "decision": "withdrawn",
                "expected_previous_id": comparison["decision"].id,
            },
        )
    elif change == "source":
        finance_db.delete(finance_db.get(m.ElectionResultSource, SOURCE))
    else:
        from sqlalchemy.exc import SQLAlchemyError

        # A published generation cannot be downgraded to simulate source loss.
        # Exercise the database refusal; withdrawal and missing-source cases
        # below still prove stale-page invalidation after actual state changes.
        with pytest.raises(SQLAlchemyError, match="immutable"):
            with finance_db.begin_nested():
                finance_db.get(
                    m.ElectionFinanceCollection, COLLECTION
                ).first_published_at = None
                finance_db.flush()
        current = _data(finance_api)
        assert current["version"] == before["version"]
        assert current["funders"] == before["funders"]
        return
    finance_db.commit()
    assert (
        finance_api.get(
            f"{BASE}/funders", params={**_pins(before), "offset": 1}
        ).status_code
        == 409
    )
    assert finance_api.get(f"{BASE}/records", params=_pins(before)).status_code == 409
    current = _data(finance_api)
    assert current["version"] != before["version"]
    assert all(f["supported_outcomes"]["candidacies"] == 0 for f in current["funders"])


def test_csv_formula_like_names_are_data_and_original_evidence_stays_exact(
    finance_api, finance_db, analytics
):
    literal = '=HYPERLINK("https://example.test/", "source name")'
    row = finance_db.get(C, (analytics.contributions.id, 1))
    row.contributor, row.in_kind_descr = literal, "+SUM(1,1)"
    finance_db.commit()
    data = _data(finance_api)
    response = finance_api.get(
        f"{BASE}/export", params={**_pins(data), "format": "csv", "q": literal}
    )
    assert response.status_code == 200
    records = list(csv.DictReader(io.StringIO(response.text)))
    metadata = {
        r["Context field"]: r["Context value"]
        for r in records
        if r["Row type"] == "Metadata"
    }
    assert metadata["filters: q"] == "'" + literal
    assert all(
        not cell.startswith(("=", "+", "@", "\t", "\r")) for cell in records[0].values()
    )
    first = next(
        record
        for record in records
        if record["Row type"] == "Payment"
        and record["Dataset"] == "contributions"
        and record["Source record"] == "1"
    )
    assert all(
        not cell.startswith(("=", "+", "@", "\t", "\r")) for cell in first.values()
    )
    assert first["Filed: Contributor"] == "'" + literal
    assert first["Filed: In-kind descr"] == "'+SUM(1,1)"
    assert row.contributor == literal


def test_pagination_exports_are_deterministic_pinned_and_private(
    finance_api, finance_db, analytics
):
    data = _data(finance_api, limit=1)
    assert data["page"]["has_more"]
    next_page = _data(finance_api, **_pins(data), offset=1, limit=1)
    assert next_page["funders"][0]["funder_id"] != data["funders"][0]["funder_id"]
    assert finance_api.get(f"{BASE}/funders", params={"offset": 1}).status_code == 422
    assert (
        finance_api.get(
            f"{BASE}/records", params={**_pins(data), "candidate_id": "a"}
        ).status_code
        == 422
    )
    for format in ("json", "csv"):
        params = {**_pins(data), "format": format}
        first = finance_api.get(f"{BASE}/export", params=params)
        assert first.status_code == 200, first.text
        assert first.content == finance_api.get(f"{BASE}/export", params=params).content
        assert "2026-11-03" in first.headers["content-disposition"]
        assert "private" in first.headers["cache-control"]
        if format == "json":
            payload = first.json()
            assert len(payload["rows"]) == 21
            assert all("row_number" in row["source"] for row in payload["rows"])
        else:
            rows = list(csv.DictReader(io.StringIO(first.text)))
            assert sum(row["Row type"] == "Payment" for row in rows) == 21
            assert rows[0]["Row type"] == "Metadata"
        assert (
            finance_api.get(
                f"{BASE}/export", params=params, headers={"Authorization": ""}
            ).status_code
            == 401
        )
    analytics.contributions.row_count += 1
    finance_db.commit()
    assert finance_api.get(f"{BASE}/funders").status_code == 503


def test_batch_account_queries_do_not_grow_with_candidate_count(
    finance_api, finance_db, analytics, comparison
):
    def query_count():
        statements = []

        def capture(conn, cursor, statement, params, context, many):
            statements.append(statement)

        bind = finance_db.get_bind()
        event.listen(bind, "before_cursor_execute", capture)
        try:
            _data(finance_api)
        finally:
            event.remove(bind, "before_cursor_execute", capture)
        return len(statements)

    baseline = query_count()
    payload = deepcopy(comparison["race"].payload)
    payload["candidates"] += [
        {**payload["candidates"][1], "candidate_id": f"extra-{number}"}
        for number in range(200)
    ]
    comparison["race"].payload = payload
    finance_db.commit()
    assert query_count() <= baseline + 1


def test_exact_retained_download_checks_hash_and_access(
    finance_api, finance_db, analytics, monkeypatch
):
    store = analytics.retained_store
    body = analytics.originals["contributions"]
    key = analytics.retained_keys["contributions"]
    data = _data(finance_api)
    source = data["sources"]["contributions"]
    url = source["retained_source_url"]
    from urllib.parse import urlsplit, parse_qs, urlencode

    exported = finance_api.get(
        f"{BASE}/export",
        params={**_pins(data), "format": "csv"},
        headers={
            "Host": "attacker.invalid",
            "X-Forwarded-Host": "attacker.invalid",
            "Origin": "https://attacker.invalid",
        },
    )
    csv_rows = list(csv.DictReader(io.StringIO(exported.text)))
    row = next(
        r
        for r in csv_rows
        if r["Row type"] == "Payment" and r["Dataset"] == "contributions"
    )
    app_url = urlsplit(row["Source URL"])
    assert app_url.netloc == "alethicalfinance.com" and app_url.scheme == "https"
    assert app_url.path == f"/elections/{KEY}/sources/contributions"
    query = parse_qs(app_url.query)
    assert query == {
        "kind": ["analytics"],
        "snapshot_id": [data["snapshot_id"]],
        "version": [data["version"]],
    }
    private_url = f"{BASE}/sources/contributions?" + urlencode(
        {k: v[0] for k, v in query.items() if k != "kind"}
    )
    assert finance_api.get(private_url).content == body
    assert (
        finance_api.get(private_url, headers={"Authorization": ""}).status_code == 401
    )
    assert row["Source SHA256"] == hashlib.sha256(body).hexdigest()

    assert finance_api.get(url).content == body
    assert finance_api.get(url, headers={"Authorization": ""}).status_code == 401
    store.objects[key] = b"corrupt"
    assert finance_api.get(url).status_code == 409
    assert finance_api.get(f"{BASE}/funders").status_code == 503


@pytest.mark.parametrize(
    "registration,source_type",
    [
        ("0", "Individual"),
        ("-1", "Political Committee/Fund"),
        ("40001", "Lobbyist"),
        ("40001", "Individual"),
        ("99999", "Political Committee/Fund"),
    ],
)
def test_unregistered_sentinels_and_other_register_ids_never_merge(
    finance_api, finance_db, analytics, registration, source_type
):
    for number, name in ((1, "Different donor 1"), (2, "Different donor 2")):
        row = finance_db.get(C, (analytics.contributions.id, number))
        row.contrib_reg_num, row.contrib_type, row.contributor = (
            registration,
            source_type,
            name,
        )
    independent = finance_db.get(
        m.CampaignFinanceIndependentExpenditureRow, (analytics.independent.id, 1)
    )
    independent.spender_reg_num, independent.spender = registration, "Outside spender"
    finance_db.commit()
    data = _data(finance_api)
    changed = [
        f
        for f in data["funders"]
        if any(name.startswith("Different donor") for name in f["names"])
    ]
    assert len(changed) == 2
    assert all(
        f["identity_state"] == "unresolved_source_record"
        and f["funder_id"].startswith("record:")
        for f in changed
    )
    assert all(
        f["registration_number"] is None
        and f["source_registration_values"] == [registration]
        for f in changed
    )
    assert all("Outside spender" not in f["names"] for f in changed)


@pytest.mark.parametrize("amount", ["0", "-10", None])
def test_nonpositive_or_unknown_payments_never_establish_support(
    finance_api, finance_db, analytics, amount
):
    for number in (1, 2, 3, 4):
        finance_db.get(C, (analytics.contributions.id, number)).amount = (
            Decimal(amount) if amount is not None else None
        )
    for number in (1, 2):
        finance_db.get(
            m.CampaignFinanceIndependentExpenditureRow,
            (analytics.independent.id, number),
        ).amount = Decimal(amount) if amount is not None else None
    finance_db.commit()
    funder = next(
        f
        for f in _data(finance_api)["funders"]
        if f["funder_id"] == "registration:40001"
    )
    assert funder["supported_outcomes"]["candidacies"] == 0
    candidate = _data(finance_api, "candidates", funder_id="registration:40001")[
        "candidates"
    ][0]
    assert candidate["supported"] is False and candidate["opposed"] is False
    assert funder["amounts"]["direct_contributions"]["record_count"] == 4
    assert funder["amounts"]["direct_contributions"]["amount"] == (
        format(Decimal(amount) * 4, ".4f") if amount is not None else None
    )


def test_race_drilldown_keeps_excluded_account_payments_and_rejects_unknown_candidate(
    finance_api, analytics
):
    data = _data(finance_api, race_id=RACE)
    params = {**_pins(data), "race_id": RACE, "candidate_id": "a"}
    records = _data(finance_api, "records", **params)["rows"]
    assert any(row["resolution"] == "outside_reviewed_period" for row in records)
    assert any(row["resolution"] == "missing_date" for row in records)
    assert all(row["account_reviews"] for row in records)
    assert (
        finance_api.get(
            f"{BASE}/records", params={**params, "candidate_id": "absent"}
        ).status_code
        == 404
    )


def test_outcome_revision_changes_count_and_invalidates_previous_page(
    finance_api, analytics, monkeypatch
):
    before = _data(finance_api)
    original = reads._outcomes

    def certified(db, snapshot_id, races):
        data = original(db, snapshot_id, races)
        data[RACE]["candidates"]["a"].update(
            outcome="elected", outcome_status="certified"
        )
        data[RACE]["outcome_review"]["version"] = "changed-outcome-review"
        return data

    monkeypatch.setattr(reads, "_outcomes", certified)
    assert finance_api.get(f"{BASE}/funders", params=_pins(before)).status_code == 409
    funder = next(
        f
        for f in _data(finance_api)["funders"]
        if f["funder_id"] == "registration:40001"
    )
    assert funder["supported_outcomes"] == {
        "candidacies": 1,
        "elected": 1,
        "not_elected": 0,
        "pending": 0,
    }


def test_same_candidate_source_id_in_two_races_counts_two_candidacies(
    finance_api, finance_db, analytics, comparison
):
    args = comparison["args"]
    reviews.record_decision(
        finance_db,
        **{
            **args,
            "period_end": date(2026, 9, 1),
            "expected_previous_id": comparison["decision"].id,
            "reason": "Earlier exact candidacy interval",
        },
    )
    other = _race(finance_db, race_id="8" * 64)
    other.payload = deepcopy(comparison["race"].payload)
    reviews.record_decision(
        finance_db,
        **{
            **args,
            "race_id": other.id,
            "identity": reviews.candidate_identity(
                other, other.payload["candidates"][0]
            ),
            "period_start": date(2026, 9, 2),
            "reason": "Separate exact candidacy interval",
        },
    )
    for number in (1, 2):
        finance_db.get(C, (analytics.contributions.id, number)).receipt_date = date(
            2026, 8, 1
        )
    finance_db.commit()
    funder = next(
        f
        for f in _data(finance_api)["funders"]
        if f["funder_id"] == "registration:40001"
    )
    assert funder["supported_outcomes"] == {
        "candidacies": 2,
        "elected": 0,
        "not_elected": 0,
        "pending": 2,
    }
    first_race = next(
        f
        for f in _data(finance_api, race_id=RACE)["funders"]
        if f["funder_id"] == "registration:40001"
    )
    assert first_race["amounts"]["direct_contributions"]["amount"] == "20.0000"
    assert first_race["amounts"]["independent_For"]["amount"] is None
    assert first_race["supported_outcomes"]["candidacies"] == 1


def test_new_finance_release_invalidates_old_record_pages(
    finance_api, finance_db, analytics, monkeypatch
):
    before = _data(finance_api)
    retain_analytics_originals(finance_db, Published(finance_db), monkeypatch)
    assert finance_api.get(f"{BASE}/records", params=_pins(before)).status_code == 409
    assert _data(finance_api)["version"] != before["version"]


def test_bulk_account_semantics_match_existing_exact_review_reader(
    finance_db, analytics, comparison
):
    links, _ = reads._bulk_accounts(finance_db, KEY, [comparison["race"]])
    for candidate in comparison["race"].payload["candidates"]:
        if candidate.get("is_write_in_aggregate"):
            continue
        expected = reviews.applicable_accounts(
            finance_db, election_key=KEY, race=comparison["race"], candidate=candidate
        )
        actual = links[(RACE, candidate["candidate_id"])]
        assert actual["gaps"] == expected["gaps"]
        assert [
            {key: value for key, value in account.items() if key != "evidence"}
            for account in actual["accounts"]
        ] == [
            {
                key: value
                for key, value in account.items()
                if key not in {"evidence", "authority"}
            }
            for account in expected["accounts"]
        ]


def test_new_result_snapshot_invalidates_pagination_without_carrying_account_identity(
    finance_api, finance_db, analytics
):
    before = _data(finance_api)
    snapshot_id = "9" * 64
    _snapshot(finance_db, snapshot_id=snapshot_id)
    race = _race(finance_db, snapshot_id=snapshot_id)
    payload = deepcopy(race.payload)
    payload["office_name"] = "Attorney General"
    for candidate in payload["candidates"]:
        candidate["party"] = None
    # A changed source identity must not inherit a checked account relationship.
    payload["candidates"][0]["name"] = "Different candidate with reused source ID"
    race.payload = payload
    _current(finance_db, snapshot_id)
    finance_db.commit()
    assert finance_api.get(f"{BASE}/records", params=_pins(before)).status_code == 409
    current = _data(finance_api)
    assert current["snapshot_id"] == snapshot_id
    assert all(f["supported_outcomes"]["candidacies"] == 0 for f in current["funders"])


def test_combined_record_filters_reconcile_and_export_only_selected_context(
    finance_api, finance_db, analytics, comparison
):
    other = _race(finance_db, race_id="8" * 64)
    other.payload = deepcopy(comparison["race"].payload)
    finance_db.commit()
    data = _data(finance_api)
    filters = {
        **_pins(data),
        "race_id": RACE,
        "candidate_id": "a",
        "metric": "independent_For",
        "resolution": "attributed",
    }
    records = _data(finance_api, "records", **filters)
    assert records["filters"]["candidate_id"] == "a"
    assert records["filters"]["metric"] == "independent_For"
    assert records["filters"]["resolution"] == "attributed"
    assert records["filtered_reconciliation"] == reads._buckets(records["rows"])
    assert records["filtered_reconciliation"][0]["amount"] == "20.0000"
    assert records["reconciliation"] == data["reconciliation"]
    exported = finance_api.get(f"{BASE}/export", params=filters).json()
    assert exported["filters"] == records["filters"]
    assert exported["filtered_reconciliation"] == records["filtered_reconciliation"]
    assert len(exported["candidacies"]) == 1
    assert exported["candidacies"][0]["candidate"]["candidate_id"] == "a"
    assert set(exported["outcomes"]) == {RACE}
    assert set(exported["outcomes"][RACE]["candidates"]) == {"a"}
    assert exported["candidacy_context_scope"] == "selected_candidate"
    csv_rows = list(
        csv.DictReader(
            io.StringIO(
                finance_api.get(
                    f"{BASE}/export", params={**filters, "format": "csv"}
                ).text
            )
        )
    )
    assert csv_rows[0]["Row type"] == "Metadata"
    context = {
        r["Context field"]: r["Context value"]
        for r in csv_rows
        if r["Row type"] == "Metadata"
    }
    assert context["filters: candidate id"] == exported["filters"]["candidate_id"]
    assert context["filters: metric"] == exported["filters"]["metric"]
    assert context["filtered reconciliation 1: amount"] == "20.0000"
    payments = [row for row in csv_rows if row["Row type"] == "Payment"]
    assert len(payments) == len(exported["rows"]) == 3
    assert [row["Payment USD"] for row in payments] == ["10.0000", "10.0000", "0.0000"]
    candidates = [r for r in csv_rows if r["Row type"] == "Candidate"]
    assert len(candidates) == 1 and candidates[0]["Candidate ID"] == "a"


def test_empty_exports_keep_complete_context_without_inventing_payment(
    finance_api, analytics
):
    data = _data(finance_api)
    filters = {
        **_pins(data),
        "race_id": RACE,
        "candidate_id": "a",
        "metric": "independent_Against",
        "resolution": "attributed",
    }
    exported = finance_api.get(f"{BASE}/export", params=filters).json()
    assert exported["rows"] == []
    assert exported["filtered_reconciliation"] == []
    assert exported["filters"]["candidate_id"] == "a"
    assert len(exported["candidacies"]) == 1
    response = finance_api.get(f"{BASE}/export", params={**filters, "format": "csv"})
    csv_rows = list(csv.DictReader(io.StringIO(response.text)))
    assert csv_rows[0]["Row type"] == "Metadata"
    assert csv_rows[0]["Version"].lstrip("'") == data["version"]
    assert not any(r["Row type"] == "Payment" for r in csv_rows)
    metadata = {
        r["Context field"]: r["Context value"]
        for r in csv_rows
        if r["Row type"] == "Metadata"
    }
    assert metadata["filters: candidate id"] == "a"
    assert metadata["filtered reconciliation"] == "No entries"
    assert {r["Dataset"] for r in csv_rows if r["Row type"] == "Source"} == set(
        exported["sources"]
    )
    candidate = next(r for r in csv_rows if r["Row type"] == "Candidate")
    assert candidate["Outcome status"] == "pending"
    assert candidate["Contributions status"] == "no records"
    assert candidate["Contributions USD"] == ""
    assert all(r["Payment USD"] == "" for r in csv_rows)


def test_funder_live_search_matches_names_before_paging_without_merging_ids(
    finance_api, finance_db, analytics
):
    for number in (1, 11):
        finance_db.get(
            C, (analytics.contributions.id, number)
        ).contributor = "Alpha donor"
    finance_db.commit()
    baseline = _data(finance_api)
    page = _data(finance_api, q="  aLpHa  ", limit=1)
    assert page["filters"]["q"] == "aLpHa"
    assert page["version"] == baseline["version"]
    assert page["page"]["total"] == 2
    assert page["page"]["has_more"]
    second = _data(finance_api, **_pins(page), q="alpha", limit=1, offset=1)
    assert {page["funders"][0]["funder_id"], second["funders"][0]["funder_id"]} == {
        "registration:40001",
        "registration:40002",
    }
    evidence = finance_api.get(page["funders"][0]["evidence_url"]).json()["data"]
    assert evidence["filters"]["q"] == "aLpHa"
    export = finance_api.get(
        f"{BASE}/export", params={**_pins(page), "q": "alpha"}
    ).json()
    assert {row["funder_id"] for row in export["rows"]} == {
        "registration:40001",
        "registration:40002",
    }
    assert any(row["funder_name"] == "Example fund" for row in export["rows"])
    assert len(export["candidacies"]) == 1
    assert set(export["outcomes"][RACE]["candidates"]) == {"a"}
    assert export["candidacy_context_scope"] == "related_to_selected_records"
    assert _data(finance_api, q="no such funder")["funders"] == []
    empty = finance_api.get(
        f"{BASE}/export", params={**_pins(page), "q": "no such funder"}
    ).json()
    assert empty["rows"] == empty["candidacies"] == []
    assert empty["outcomes"] == {}
    assert _data(finance_api, q="   ")["page"]["total"] == baseline["page"]["total"]
    assert (
        finance_api.get(f"{BASE}/funders", params={"q": "x" * 201}).status_code == 422
    )
    assert (
        finance_api.get(f"{BASE}/funders", params={"q": "bad\x00query"}).status_code
        == 422
    )


def test_funder_search_only_matches_names_in_the_selected_race(
    finance_api, finance_db, analytics
):
    finance_db.get(C, (analytics.contributions.id, 7)).contributor = "Unlinked alias"
    finance_db.commit()
    assert _data(finance_api, q="unlinked alias")["funders"]
    assert _data(finance_api, q="unlinked alias", race_id=RACE)["funders"] == []


def test_candidate_wire_preserves_positive_support_negative_net_and_ballot_scope(
    finance_api, finance_db, analytics, comparison
):
    payload = deepcopy(comparison["race"].payload)
    payload["candidate_source_sha256"] = SOURCE
    payload["candidates"][0]["candidate_source_row"] = 37
    comparison["race"].payload = payload
    # Same checked identity; only literal ballot locator fields were populated.
    for number, amount in [(1, "10"), (2, "-30"), (3, "0"), (4, "0")]:
        finance_db.get(C, (analytics.contributions.id, number)).amount = Decimal(amount)
    finance_db.commit()
    data = _data(finance_api, "candidates", funder_id="registration:40001")
    row = data["candidates"][0]
    assert Decimal(row["amounts"]["direct_contributions"]["amount"]) < 0
    assert row["supported"] is True and row["opposed"] is False
    assert row["result_status"] == "unofficial"
    assert row["outcome"] is None and row["outcome_status"] == "pending"
    assert row["district"] == payload.get("district")
    assert row["candidate_source_sha256"] == SOURCE
    assert row["candidate_source_row"] == 37


def test_flat_funder_csv_keeps_single_payment_and_distinct_summary_amounts(
    finance_api, analytics
):
    data = _data(finance_api)
    response = finance_api.get(
        f"{BASE}/export", params={**_pins(data), "format": "csv"}
    )
    assert response.status_code == 200
    rows = list(csv.DictReader(io.StringIO(response.text)))
    assert rows[0]["Row type"] == "Metadata"
    assert rows[1]["Row type"] == "Funder"
    assert not {"export_context", "filters", "claims", "source_fields"} & rows[0].keys()
    payments = [r for r in rows if r["Row type"] == "Payment"]
    assert len(payments) == 21
    assert (
        len(
            {(r["Dataset"], r["Source snapshot"], r["Source record"]) for r in payments}
        )
        == 21
    )
    assert all(r["Contributions USD"] == "" for r in payments)
    assert any(r["Payment USD"].startswith("-") for r in payments)
    assert all(r["Payment USD"] == "" for r in rows if r["Row type"] != "Payment")
    assert any(r["Row type"] == "Funder" for r in rows)
    assert any(r["Row type"] == "Candidate" for r in rows)
    assert all(
        r["Source URL"].startswith("https://alethicalfinance.com/elections/")
        for r in payments
    )


def test_flat_csv_preserves_every_source_field_and_all_amount_states(
    finance_api, finance_db, analytics
):
    data = _data(finance_api)
    args = _pins(data)
    original = finance_api.get(f"{BASE}/export", params=args).json()
    exported = finance_api.get(f"{BASE}/export", params={**args, "format": "csv"})
    rows = list(csv.DictReader(io.StringIO(exported.text)))
    payments = {
        (r["Dataset"], r["Source record"]): r
        for r in rows
        if r["Row type"] == "Payment"
    }
    assert len(payments) == len(original["rows"])
    for payment_record in original["rows"]:
        payment = payments[
            (payment_record["dataset"], str(payment_record["row_number"]))
        ]
        assert payment["Payment USD"] == (payment_record["amount"] or "")
        assert payment["Source snapshot"] == payment_record["source"]["snapshot_id"]
        assert (
            payment["Source SHA256"].lstrip("'")
            == payment_record["source"]["content_hash"]
        )
        assert payment["Source copied at"] == payment_record["source"]["copied_at"]
        assert payment["Attribution"] == payment_record["resolution"].replace("_", " ")
        for name, value in payment_record["fields"].items():
            column = (
                "Payment USD"
                if name == "Amount"
                else "Included unpaid USD"
                if name == "Unpaid amount"
                else f"Filed: {name}"
            )
            expected = (
                (value if value is not None else "")
                if name in {"Amount", "Unpaid amount"}
                else reads._csv_text(value)
            )
            assert payment[column] == expected, (name, payment_record["row_number"])
    summaries = {r["Funder ID"]: r for r in rows if r["Row type"] == "Funder"}
    for funder in data["funders"]:
        row = summaries[funder["funder_id"]]
        for metric, label in reads._CSV_MEASURES.items():
            value = funder["amounts"][metric]
            assert row[f"{label} USD"] == (value["amount"] or "")
            assert row[f"{label} known subtotal USD"] == (
                value["known_amount_subtotal"] or ""
            )
            assert row[f"{label} status"] == value["state"].replace("_", " ")
            assert int(row[f"{label} missing amounts"]) == value["missing_amount_count"]
        for direction, field in [
            ("Supported", "supported_outcomes"),
            ("Opposed", "opposed_outcomes"),
        ]:
            for key, value in funder[field].items():
                assert int(row[f"{direction} {key.replace('_', ' ')}"]) == value
    assert (
        "private-reviewer" not in exported.text
        and "/private/source.pdf" not in exported.text
    )


def test_csv_has_one_build_and_same_database_reads_as_json(
    finance_api, finance_db, analytics, monkeypatch
):
    data = _data(finance_api)
    original = reads._build
    builds = []

    def counted(*args, **kwargs):
        builds.append(1)
        return original(*args, **kwargs)

    monkeypatch.setattr(reads, "_build", counted)
    bind = finance_db.get_bind()
    counts = []
    for format in ["json", "csv"]:
        statements = []

        def record(conn, cursor, statement, params, context, many):
            statements.append(statement)

        event.listen(bind, "before_cursor_execute", record)
        try:
            body, _ = reads.export(
                finance_db, election_key=KEY, **_pins(data), format=format
            )
            assert body
        finally:
            event.remove(bind, "before_cursor_execute", record)
        counts.append(len(statements))
    assert builds == [1, 1]
    assert counts[0] == counts[1] > 0


@pytest.mark.parametrize(
    "value",
    [
        "=SUM(1,1)",
        "+cmd",
        "-cmd",
        "@SUM(1,1)",
        "\t=SUM(1,1)",
        "\r=SUM(1,1)",
        " \n=SUM(1,1)",
        "00001234",
        "12345678901234567890",
    ],
)
def test_csv_text_protects_formulas_and_literal_identifiers(value):
    assert reads._csv_text(value) == "'" + value


@pytest.mark.parametrize(
    "dataset",
    [
        "other",
        "https://attacker.invalid",
        "//attacker.invalid",
        "../../private",
        "contributions?token=private",
    ],
)
def test_csv_analytics_app_link_refuses_arbitrary_dataset(dataset):
    assert (
        reads._app_source(
            {"election_key": KEY, "snapshot_id": "a" * 64, "version": "b" * 16},
            None,
            dataset=dataset,
        )
        is None
    )
