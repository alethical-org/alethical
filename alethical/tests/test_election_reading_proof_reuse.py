"""One call may reuse live originals, never source availability across calls."""

# ruff: noqa: F811
from collections import Counter
from contextlib import contextmanager

import pytest

from alethical.db import models as m
from alethical.pipeline import election_source_readings as r
from alethical.pipeline import election_source_provenance as p
from alethical.pipeline import election_source_files as files
from alethical.pipeline.election_comparison import ComparisonImportError, digest
from alethical.tests.test_election_comparison_storage import db, MemoryStore  # noqa: F401
from alethical.tests.test_election_reading_provenance_integration import (
    provenance_chain,
)
from alethical.tests.test_election_local_sources import packet
from alethical.tests.test_election_source_reading_sections import section
from alethical.tests.test_election_source_readings import check, retain


def chained(db, count=1):
    store = MemoryStore()
    items = []
    for district in range(3, 3 + count):
        body, _, receipt, _ = packet(office=f"County Commissioner District {district}")
        item = provenance_chain(db, store, body, receipt)
        item["decision"] = check(db, store, item["receipt"])
        items.append(item)
    return store, items


def counted_gets(monkeypatch, store):
    gets = Counter()
    original = store.get

    def get(key, path, **kwargs):
        gets[key] += 1
        return original(key, path, **kwargs)

    monkeypatch.setattr(store, "get", get)
    return gets


def prove(db, store, items, **kwargs):
    return r.load_verified_reading_context(
        db,
        store,
        [i["decision"].receipt_sha256 for i in items],
        allowed_source_hashes=set().union(*(i["originals"] for i in items)),
        **kwargs,
    )


def expected_version(db, store, items):
    ids = [i["decision"].receipt_sha256 for i in items]
    versions = {}
    for item in items:
        proof = p.load_verified_provenance(
            db,
            p.source_resolver_for(db, store),
            r.provenance_ids(item["receipt"]),
            allowed_source_hashes=set(item["originals"]),
        )
        versions[item["decision"].receipt_sha256] = proof.version
    return digest(
        {
            "heads": r.reading_heads(db, ids),
            "proof_outcomes": dict.fromkeys(ids, True),
            "provenance": versions,
        }
    )


def test_each_original_is_fetched_once_for_one_complete_closure(db, monkeypatch):
    store, items = chained(db)
    expected = expected_version(db, store, items)
    gets = counted_gets(monkeypatch, store)
    result = prove(db, store, items)
    assert result.version == expected
    assert len(gets) == len(items[0]["originals"])
    assert set(gets.values()) == {1}


def test_distinct_pdf_closures_do_not_allocate_a_whole_request_pool(db, monkeypatch):
    store, items = chained(db, 3)
    expected = expected_version(db, store, items)
    gets = counted_gets(monkeypatch, store)
    result = prove(db, store, list(reversed(items)), partial=True)
    assert result.version == expected
    assert all(result.proof_outcomes.values())
    assert sum(gets.values()) == sum(len(i["originals"]) for i in items)
    for item in items:
        row = db.get(m.ElectionResultSource, item["receipt"]["original_sha256"])
        assert gets[row.object_key] == 1


def test_sibling_sections_share_files_but_are_each_verified_and_closed(db, monkeypatch):
    body, first = section()
    _, second = section(lower=True)
    store = retain(db, body)
    a, b = check(db, store, first), check(db, store, second)
    gets = counted_gets(monkeypatch, store)
    calls, borrowed = [], []
    original = r.verify_receipt_sources

    def verify(receipt, originals, **kwargs):
        calls.append(r.receipt_digest(receipt))
        borrowed.extend(originals.values())
        return original(receipt, originals, **kwargs)

    monkeypatch.setattr(r, "verify_receipt_sources", verify)
    result = r.load_verified_reading_context(
        db, store, [a.receipt_sha256, b.receipt_sha256]
    )
    assert set(calls) == {a.receipt_sha256, b.receipt_sha256}
    assert len(calls) == 2 and sum(gets.values()) == 1
    assert all(result.proof_outcomes.values())
    for original in borrowed:
        with pytest.raises(files.SourceFileError, match="owning context"):
            original.open()
    assert files._BUDGET.snapshot() == (0, 0, 0)


def test_bad_section_does_not_poison_healthy_sibling_with_same_files(db, monkeypatch):
    body, first = section()
    _, second = section(lower=True)
    store = retain(db, body)
    a, b = check(db, store, first), check(db, store, second)
    original = r.verify_receipt_sources

    def verify(receipt, originals, **kwargs):
        if r.receipt_digest(receipt) == a.receipt_sha256:
            raise ComparisonImportError("Synthetic section-specific replay failure")
        return original(receipt, originals, **kwargs)

    monkeypatch.setattr(r, "verify_receipt_sources", verify)
    result = r.load_verified_reading_context(
        db, store, [a.receipt_sha256, b.receipt_sha256], partial=True
    )
    assert result.proof_outcomes == {a.receipt_sha256: False, b.receipt_sha256: True}
    assert result.receipt(b.receipt_sha256) == second
    assert files._BUDGET.snapshot() == (0, 0, 0)


def test_later_shared_source_loss_invalidates_prior_dependent_success(db, monkeypatch):
    store, items = chained(db, 3)
    before = prove(db, store, items)
    source_hash = items[0]["transitive_hash"]
    row = db.get(m.ElectionResultSource, source_hash)
    original_body = store.objects[row.object_key]
    verify = r.verify_receipt_sources
    count = 0

    def fail_later(receipt, originals, **kwargs):
        nonlocal count
        result = verify(receipt, originals, **kwargs)
        count += 1
        if count == 1:
            store.objects[row.object_key] = b"corrupt after the first closure"
        return result

    with monkeypatch.context() as patch:
        patch.setattr(r, "verify_receipt_sources", fail_later)
        unavailable = prove(db, store, items, partial=True)
    assert not any(unavailable.proof_outcomes.values())
    assert source_hash in unavailable.failed_sources
    assert unavailable.version != before.version
    for item in items:
        with pytest.raises(ComparisonImportError):
            unavailable.receipt(item["decision"].receipt_sha256)
    store.objects[row.object_key] = original_body
    assert prove(db, store, items).version == before.version


def test_source_failure_is_scoped_and_new_call_fetches_repaired_bytes(db, monkeypatch):
    store, items = chained(db, 2)
    before = prove(db, store, items)
    first = items[0]
    row = db.get(m.ElectionResultSource, first["receipt"]["original_sha256"])
    good = store.objects[row.object_key]
    store.objects[row.object_key] = b"corrupt unique PDF"
    lost = prove(db, store, items, partial=True)
    assert lost.proof_outcomes == {
        first["decision"].receipt_sha256: False,
        items[1]["decision"].receipt_sha256: True,
    }
    assert lost.version != before.version
    with pytest.raises(ComparisonImportError):
        prove(db, store, items, lock=True)
    store.objects[row.object_key] = good
    gets = counted_gets(monkeypatch, store)
    assert prove(db, store, items).version == before.version
    assert gets[row.object_key] > 0


@pytest.mark.parametrize("failure_at", ["verified_source_files", "_borrow_sources"])
def test_capacity_is_retryable_and_never_a_false_proof(db, monkeypatch, failure_at):
    store, items = chained(db)
    before = prove(db, store, items)

    @contextmanager
    def busy(*args, **kwargs):
        raise files.SourceFileLimitError("Synthetic capacity exhaustion")
        yield

    with monkeypatch.context() as patch:
        patch.setattr(r, failure_at, busy)
        with pytest.raises(files.SourceFileLimitError):
            prove(db, store, items, partial=True)
    assert files._BUDGET.snapshot() == (0, 0, 0)
    assert prove(db, store, items).version == before.version


def test_narrower_generation_never_reuses_a_successful_membership(db):
    store, items = chained(db)
    before = prove(db, store, items)
    item = items[0]
    with pytest.raises(ComparisonImportError, match="outside this exact generation"):
        r.load_verified_reading_context(
            db,
            store,
            [item["decision"].receipt_sha256],
            allowed_source_hashes={item["receipt"]["original_sha256"]},
        )
    assert prove(db, store, items).version == before.version


def test_sections_with_shared_provenance_discover_and_replay_chain_once(
    db, monkeypatch
):
    from copy import deepcopy
    from io import BytesIO
    from pypdf import PdfReader, PdfWriter

    first_body, _, template, _ = packet(office="County Commissioner District 3")
    writer = PdfWriter()
    page = PdfReader(BytesIO(first_body)).pages[0]
    writer.add_page(page)
    writer.add_page(page)
    output = BytesIO()
    writer.write(output)
    body = output.getvalue()
    template = r.prepare_receipt(
        body,
        fields=template["fields"],
        document_kind=template["document_kind"],
        source_context=template["source_context"],
    )
    store = MemoryStore()
    first = provenance_chain(db, store, body, template)
    first["decision"] = check(db, store, first["receipt"])
    fields = deepcopy(template["fields"])
    for field in fields:
        field["page"] = 2
    second_receipt = r.prepare_receipt(
        body, fields=fields, document_kind=template["document_kind"]
    )
    second_receipt.update(
        schema=r.SECTION_SCHEMA,
        source_context=deepcopy(first["receipt"]["source_context"]),
        reading_scope={
            "cover": {"page": 2, "bounds": [0, 0, 612, 792]},
            "regions": [{"page": 2, "bounds": [0, 0, 612, 792], "role": "cover"}],
        },
    )
    second = {
        **first,
        "receipt": second_receipt,
        "decision": check(db, store, second_receipt),
    }
    items = [first, second]
    expected = expected_version(db, store, items)
    gets = counted_gets(monkeypatch, store)
    calls = Counter()
    original_plan, original_proof = (
        p.provenance_requirements,
        p.load_verified_provenance,
    )

    def plan(*args, **kwargs):
        calls["plan"] += 1
        return original_plan(*args, **kwargs)

    def proof(*args, **kwargs):
        calls["proof"] += 1
        return original_proof(*args, **kwargs)

    monkeypatch.setattr(p, "provenance_requirements", plan)
    monkeypatch.setattr(p, "load_verified_provenance", proof)
    result = prove(db, store, items)
    assert result.version == expected
    assert (
        result.local_values(first["decision"].receipt_sha256)["report"]["period_start"]
        == result.local_values(second["decision"].receipt_sha256)["report"][
            "period_start"
        ]
    )
    assert calls == {"plan": 1, "proof": 1}
    assert len(gets) == len(first["originals"]) and set(gets.values()) == {1}


def test_bounded_inventory_cache_evicts_without_reusing_other_receipt_plans(
    monkeypatch,
):
    from collections import OrderedDict

    cache = OrderedDict()
    calls = []
    monkeypatch.setattr(r, "provenance_ids", lambda receipt: [receipt["id"]])

    def plan(db, receipt, *, partial):
        calls.append(receipt["id"])
        return {
            "receipt_ids": [receipt["id"]],
            "heads": {receipt["id"]: "synthetic"},
            "subject_keys": [],
            "public_original_hashes": [],
            "gaps": {},
        }

    monkeypatch.setattr(r, "_provenance_requirements", plan)
    for index in range(p.MAX_NODES + 1):
        r._planned_provenance(None, {"id": format(index, "064x")}, cache, partial=True)
    assert sum(len(v["receipt_ids"]) for v in cache.values()) == p.MAX_NODES
    before = len(calls)
    last = {"id": format(p.MAX_NODES, "064x")}
    assert r._planned_provenance(None, last, cache, partial=True)["receipt_ids"] == [
        last["id"]
    ]
    assert len(calls) == before
    first = {"id": "0" * 64}
    assert r._planned_provenance(None, first, cache, partial=True)["receipt_ids"] == [
        first["id"]
    ]
    assert len(calls) == before + 1


def test_file_closure_limit_stays_per_group_and_cleans_up(db, monkeypatch):
    body, receipt = section()
    store = retain(db, body)
    row = check(db, store, receipt)
    with monkeypatch.context() as patch:
        patch.setattr(files, "MAX_CLOSURE_BYTES", len(body) - 1)
        with pytest.raises(ComparisonImportError, match="unavailable or changed"):
            r.load_verified_reading_context(db, store, [row.receipt_sha256])
    assert files._BUDGET.snapshot() == (0, 0, 0)
    assert r.load_verified_reading_context(
        db, store, [row.receipt_sha256]
    ).proof_outcomes[row.receipt_sha256]


def test_more_than_256_independent_file_groups_are_not_one_oversized_pool(monkeypatch):
    from copy import deepcopy
    from types import SimpleNamespace
    from alethical.tests.test_election_source_files import Store, source

    body, template = section()
    store = Store()
    receipts, closures, rows = {}, {}, {}
    for index in range(p.MAX_NODES + 1):
        original = body + f"\n% independent synthetic section {index}\n".encode()
        metadata = source(store, original)
        h = metadata["content_hash"]
        receipt = deepcopy(template)
        receipt["original_sha256"] = h
        rid = r.receipt_digest(receipt)
        receipts[rid], closures[rid], rows[h] = (
            receipt,
            {h},
            SimpleNamespace(**metadata),
        )
    active, peak, sizes = 0, 0, []
    manager = r.verified_source_files

    @contextmanager
    def observed(store, selected, **kwargs):
        nonlocal active, peak
        selected = list(selected)
        sizes.append(len(selected))
        active += 1
        peak = max(peak, active)
        try:
            with manager(store, selected, **kwargs) as value:
                yield value
        finally:
            active -= 1

    monkeypatch.setattr(r, "verified_source_files", observed)
    verified, values, failed, versions = r._verify_section_groups(
        None, store, receipts, closures, rows, allowed=set(rows), partial=False
    )
    assert set(verified) == set(receipts) and len(verified) == p.MAX_NODES + 1
    assert not values and not failed and not versions
    assert sizes == [1] * len(receipts) and peak == 1 and active == 0
    assert files._BUDGET.snapshot() == (0, 0, 0)


def test_more_than_256_provenance_subjects_keep_global_lock_order(monkeypatch):
    batches = []

    def locked(db, keys):
        batches.append(list(keys))

    monkeypatch.setattr(p, "lock_provenance", locked)
    subjects = [format(index, "064x") for index in range(p.MAX_NODES + 17)]
    plans = [{"subject_keys": [key]} for key in reversed(subjects)]
    r._lock_provenance_plans(None, plans)
    assert [key for batch in batches for key in batch] == subjects
    assert all(len(batch) <= p.MAX_NODES for batch in batches)


def test_wrong_report_type_does_not_mark_valid_shared_html_missing():
    from copy import deepcopy
    from types import SimpleNamespace
    from alethical.tests.test_election_source_files import Store, source

    body, valid = section()
    store = Store()
    pdf = source(store, body)
    html = source(store, b"<html>synthetic publisher</html>", media_type="text/html")
    valid["dependencies"] = [{"sha256": html["content_hash"], "literal": "publisher"}]
    wrong = deepcopy(valid)
    wrong["original_sha256"] = html["content_hash"]
    wrong["dependencies"] = [{"sha256": pdf["content_hash"], "literal": ""}]
    rows = {x["content_hash"]: SimpleNamespace(**x) for x in [pdf, html]}
    good_id, wrong_id = r.receipt_digest(valid), r.receipt_digest(wrong)
    # Distinct roles, identical bytes/closure. A bad reading is not missing bytes.
    receipts = {wrong_id: wrong, good_id: valid}
    verified, _, failed, _ = r._verify_section_groups(
        None,
        store,
        receipts,
        {rid: set(rows) for rid in receipts},
        rows,
        allowed=set(rows),
        partial=True,
    )
    assert set(verified) == {good_id} and not failed
    assert files._BUDGET.snapshot() == (0, 0, 0)
